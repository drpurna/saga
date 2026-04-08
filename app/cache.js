// ================================================================
// SAGA IPTV — cache.js v3.0  |  All mandatory fixes applied
// FIX H9:  LRU cap on _imgSeen (max 500 entries)
// FIX M25: LS_QUOTA_WARN raised to 4.5 MB
// FIX C6:  clearAllM3U returns Promise, caller awaits it
// ================================================================
'use strict';

var AppCache = (function () {

  var M3U_TTL       = 30 * 60 * 1000;
  var JIOTV_TTL     =  5 * 60 * 1000;
  var LS_QUOTA_WARN = 4.5 * 1024 * 1024; // FIX M25: raised from 3.5 MB
  var IDB_NAME      = 'saga-cache';
  var IDB_VER       = 1;
  var IDB_STORE     = 'payloads';
  var IDB_RETRY_MAX = 2;
  var IMG_CONCUR    = 4;
  var IMG_SEEN_MAX  = 500; // FIX H9: LRU cap

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
        req.onerror   = function () { _dbFail = true; resolve(null); };
        req.onblocked = function () { _dbFail = true; resolve(null); };
      } catch (e) { _dbFail = true; resolve(null); }
    });
    return _dbInit;
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
          tx.onerror    = function () {
            if (attempt < IDB_RETRY_MAX) {
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

  function idbDelete(key) {
    delete _memCache[key];
    return openDB().then(function (db) {
      if (!db) return;
      try { db.transaction(IDB_STORE, 'readwrite').objectStore(IDB_STORE).delete(key); } catch (e) {}
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

  // FIX C6: setM3U is async-safe — caller must await clearAllM3U before calling
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

  // FIX C6: returns a Promise that resolves only after IDB clear completes
  function clearAllM3U() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('plCache:') || k.startsWith('plCacheTime:'))) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    delete _memCache['plCache'];  // clear any mem-cached entries
    return openDB().then(function (db) {
      if (!db) return;
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

  // ── Image preload — FIX H9: LRU cap on _imgSeen ───────────────
  var _imgQueue   = [];
  var _imgActive  = 0;
  var _imgSeen    = [];  // array acting as LRU queue (oldest first)
  var _imgSeenSet = new Set();

  function _imgLRUAdd(url) {
    if (_imgSeenSet.has(url)) return false;
    if (_imgSeen.length >= IMG_SEEN_MAX) {
      // evict oldest
      var evicted = _imgSeen.shift();
      _imgSeenSet.delete(evicted);
    }
    _imgSeen.push(url);
    _imgSeenSet.add(url);
    return true;
  }

  function preloadImages(urls) {
    if (!Array.isArray(urls)) return;
    urls.forEach(function (url) {
      if (!url || typeof url !== 'string') return;
      if (_imgLRUAdd(url)) _imgQueue.push(url);
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
  function lsNearQuota() { return lsUsageBytes() > LS_QUOTA_WARN; }

  // IDB recovery once per minute if failed
  openDB();
  (function retry() {
    if (!_dbFail) { setTimeout(retry, 60000); return; }
    setTimeout(function () {
      _dbFail = false; _dbInit = null;
      openDB().then(function (db) {
        if (db) console.log('[Cache] IDB recovered');
        else { _dbFail = true; setTimeout(retry, 60000); }
      });
    }, 60000);
  })();

  return {
    getM3U:           getM3U,
    setM3U:           setM3U,
    clearM3U:         clearM3U,
    clearAllM3U:      clearAllM3U,
    getJioChannels:   getJioChannels,
    setJioChannels:   setJioChannels,
    clearJioChannels: clearJioChannels,
    preloadImages:    preloadImages,
    lsUsageBytes:     lsUsageBytes,
    lsNearQuota:      lsNearQuota,
  };
})();

if (typeof window !== 'undefined') window.AppCache = AppCache;
