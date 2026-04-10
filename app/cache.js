// ================================================================
// SAGA IPTV — cache.js v5.0
// Fixes applied: B1,B2,C5,H9,M21,M25,M26
// #5  IDB quota recovery — catch QuotaExceededError, evict+retry
// #21 IMG_SEEN_MAX → 2000, use Map for O(1) LRU
// #26 lsNearQuota → 4.8 MB threshold
// ================================================================
'use strict';

var AppCache = (function () {

  var M3U_TTL       = 30 * 60 * 1000;
  var JIOTV_TTL     =  5 * 60 * 1000;
  var LS_QUOTA_WARN = 4.8 * 1024 * 1024; // #26: raised to 4.8 MB
  var IDB_NAME      = 'saga-cache';
  var IDB_VER       = 1;
  var IDB_STORE     = 'payloads';
  var IDB_RETRY_MAX = 2;
  var IMG_CONCUR    = 4;
  var IMG_SEEN_MAX  = 2000; // #21: increased to 2000

  var _memCache = {};
  var _db       = null;
  var _dbFail   = false;
  var _dbInit   = null;

  // ── IndexedDB ─────────────────────────────────────────────────
  function openDB() {
    if (_dbFail) return Promise.resolve(null);
    if (_db)     return Promise.resolve(_db);
    if (_dbInit) return _dbInit;
    _dbInit = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE))
            db.createObjectStore(IDB_STORE, { keyPath: 'key' });
        };
        req.onsuccess = function (e) {
          _db = e.target.result;
          _db.onerror = function (ev) { console.warn('[Cache] IDB error', ev); };
          resolve(_db);
        };
        // FIX B1: reset _dbInit on failure so openDB() reruns on retry
        req.onerror   = function () { _dbFail = true; _dbInit = null; resolve(null); };
        req.onblocked = function () { _dbFail = true; _dbInit = null; resolve(null); };
      } catch (e) { _dbFail = true; _dbInit = null; resolve(null); }
    });
    return _dbInit;
  }

  // #5: evict oldest N IDB entries to free quota
  function evictOldestIDBEntries(n) {
    return openDB().then(function (db) {
      if (!db) return Promise.resolve();
      return new Promise(function (resolve) {
        try {
          var tx    = db.transaction(IDB_STORE, 'readwrite');
          var store = tx.objectStore(IDB_STORE);
          var all   = [];
          var req   = store.openCursor();
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (cursor) { all.push({ key: cursor.key, ts: cursor.value.ts || 0 }); cursor.continue(); }
            else {
              // sort oldest first, delete top n
              all.sort(function (a, b) { return a.ts - b.ts; });
              all.slice(0, n).forEach(function (entry) { store.delete(entry.key); });
              tx.oncomplete = function () { resolve(); };
            }
          };
          req.onerror = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function idbSet(key, value, attempt) {
    attempt = attempt || 0;
    return openDB().then(function (db) {
      if (!db) { _memCache[key] = { value: value, ts: Date.now() }; return true; }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put({ key: key, value: value, ts: Date.now() });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror    = function (e) {
            // #5: catch QuotaExceededError, evict then retry
            var err = e.target && e.target.error;
            var isQuota = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
            if (isQuota && attempt < 1) {
              evictOldestIDBEntries(20).then(function () {
                idbSet(key, value, attempt + 1).then(resolve);
              });
            } else if (attempt < IDB_RETRY_MAX) {
              setTimeout(function () { idbSet(key, value, attempt + 1).then(resolve); }, 200);
            } else {
              _memCache[key] = { value: value, ts: Date.now() }; resolve(false);
            }
          };
        } catch (e) { _memCache[key] = { value: value, ts: Date.now() }; resolve(false); }
      });
    });
  }

  function idbGet(key) {
    if (_memCache[key]) return Promise.resolve(_memCache[key]);
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx  = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = function () { resolve(req.result || null); };
          req.onerror   = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  // FIX B2: returns awaitable Promise
  function idbDelete(key) {
    delete _memCache[key];
    return openDB().then(function (db) {
      if (!db) return Promise.resolve();
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  // ── localStorage ─────────────────────────────────────────────
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; }
    catch (e) { _evictOldest(); try { localStorage.setItem(k, v); return true; } catch (e2) { return false; } }
  }
  function lsGet(k)    { try { return localStorage.getItem(k); }  catch(e) { return null; } }
  function lsRemove(k) { try { localStorage.removeItem(k); }       catch(e) {} }

  function _evictOldest() {
    try {
      var caches = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith('plCache:')) {
          var ctk = 'plCacheTime:' + k.slice(8);
          var ts  = parseInt(localStorage.getItem(ctk) || '0', 10);
          caches.push({ key: k, timeKey: ctk, ts: ts });
        }
      }
      caches.sort(function (a, b) { return a.ts - b.ts; });
      caches.slice(0, 3).forEach(function (c) {
        localStorage.removeItem(c.key);
        localStorage.removeItem(c.timeKey);
      });
    } catch (e) {}
  }

  // ── M3U cache ─────────────────────────────────────────────────
  function getM3U(url) {
    var ck  = 'plCache:' + url;
    var ctk = 'plCacheTime:' + url;
    var ts  = parseInt(lsGet(ctk) || '0', 10);
    if (Date.now() - ts <= M3U_TTL) {
      var data = lsGet(ck);
      if (data && data.length > 100) return Promise.resolve(data);
    }
    return idbGet(ck).then(function (rec) {
      if (rec && rec.value && (Date.now() - rec.ts) <= M3U_TTL) return rec.value;
      return null;
    });
  }

  function setM3U(url, text) {
    var ck  = 'plCache:' + url;
    var ctk = 'plCacheTime:' + url;
    lsSet(ctk, String(Date.now()));
    var ok = lsSet(ck, text);
    if (!ok) { lsRemove(ck); lsRemove(ctk); return idbSet(ck, text); }
    return Promise.resolve(true);
  }

  function clearM3U(url) {
    var ck = 'plCache:' + url, ctk = 'plCacheTime:' + url;
    lsRemove(ck); lsRemove(ctk);
    return idbDelete(ck);
  }

  // FIX C6: returns Promise resolving after IDB clear
  function clearAllM3U() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('plCache:') || k.startsWith('plCacheTime:'))) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    Object.keys(_memCache).forEach(function (k) {
      if (k.startsWith('plCache:')) delete _memCache[k];
    });
    return openDB().then(function (db) {
      if (!db) return Promise.resolve();
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).clear();
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  // ── JioTV channel cache ───────────────────────────────────────
  var JIOTV_KEY = 'jiotv:channels';
  function getJioChannels() {
    return idbGet(JIOTV_KEY).then(function (rec) {
      if (!rec || Date.now() - rec.ts > JIOTV_TTL) return null;
      return rec.value;
    });
  }
  function setJioChannels(list)  { return idbSet(JIOTV_KEY, list); }
  function clearJioChannels()    { return idbDelete(JIOTV_KEY); }

  // ── Image preload — #21: Map-based LRU, size 2000 ─────────────
  var _imgQueue   = [];
  var _imgActive  = 0;
  var _imgLRU     = new Map(); // #21: Map preserves insertion order for LRU

  function _imgLRUAdd(url) {
    if (_imgLRU.has(url)) return false; // already seen
    if (_imgLRU.size >= IMG_SEEN_MAX) {
      // evict oldest (first key in Map)
      var oldest = _imgLRU.keys().next().value;
      _imgLRU.delete(oldest);
    }
    _imgLRU.set(url, 1);
    return true;
  }

  // #22: priority queue — visible items (first param) loaded first
  function preloadImages(visibleUrls, nextUrls) {
    var all = (visibleUrls || []).concat(nextUrls || []);
    all.forEach(function (url) {
      if (!url || typeof url !== 'string') return;
      if (_imgLRUAdd(url)) _imgQueue.push(url); // #42: LRU check before push
    });
    _drainImgQueue();
  }
  function _drainImgQueue() {
    while (_imgActive < IMG_CONCUR && _imgQueue.length > 0) {
      var url = _imgQueue.shift();
      _imgActive++;
      var img = new Image();
      img.onload = img.onerror = function () { _imgActive--; _drainImgQueue(); };
      img.src = url;
    }
  }

  // ── Storage usage ─────────────────────────────────────────────
  function lsUsageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) total += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch (e) {}
    return total;
  }
  // #26: only evict on actual write failure (threshold used for warnings only)
  function lsNearQuota() { return lsUsageBytes() > LS_QUOTA_WARN; }

  // IDB recovery
  openDB();
  (function scheduleRecovery() {
    setTimeout(function () {
      if (!_dbFail) { scheduleRecovery(); return; }
      _dbFail = false; _dbInit = null; _db = null; // FIX B1
      openDB().then(function (db) {
        if (db) { console.log('[Cache] IDB recovered'); scheduleRecovery(); }
        else    { _dbFail = true; scheduleRecovery(); }
      });
    }, 60000);
  })();

  return {
    getM3U:              getM3U,
    setM3U:              setM3U,
    clearM3U:            clearM3U,
    clearAllM3U:         clearAllM3U,
    getJioChannels:      getJioChannels,
    setJioChannels:      setJioChannels,
    clearJioChannels:    clearJioChannels,
    preloadImages:       preloadImages,
    lsUsageBytes:        lsUsageBytes,
    lsNearQuota:         lsNearQuota,
    evictOldestIDBEntries: evictOldestIDBEntries,
  };
})();

if (typeof window !== 'undefined') window.AppCache = AppCache;
