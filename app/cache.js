// ================================================================
// SAGA IPTV — cache.js v6.0 Enterprise
// Multi-tier: MemCache → LocalStorage → IndexedDB
// Features: LRU eviction, quota recovery, image preload pipeline,
//           TTL management, IDB health monitor, version migration
// ================================================================
'use strict';

var AppCache = (function () {

  var M3U_TTL        = 30 * 60 * 1000;   // 30 min
  var JIOTV_TTL      =  5 * 60 * 1000;   // 5 min
  var EPG_TTL        = 60 * 60 * 1000;   // 1 hr
  var LS_QUOTA_WARN  = 4.5 * 1024 * 1024;
  var IDB_NAME       = 'saga-cache-v6';
  var IDB_VER        = 2;
  var IDB_STORE      = 'payloads';
  var IDB_META_STORE = 'meta';
  var IDB_RETRY_MAX  = 3;
  var IMG_CONCUR     = 6;
  var IMG_SEEN_MAX   = 4000;
  var MEM_MAX        = 80;               // max mem-cache entries

  var _memCache   = new Map();           // LRU map
  var _db         = null;
  var _dbFail     = false;
  var _dbInit     = null;
  var _dbFailedAt = 0;

  // ── LRU MemCache ──────────────────────────────────────────────
  function memSet(key, value, ts) {
    if (_memCache.has(key)) _memCache.delete(key);
    if (_memCache.size >= MEM_MAX) {
      var oldest = _memCache.keys().next().value;
      _memCache.delete(oldest);
    }
    _memCache.set(key, { value: value, ts: ts || Date.now() });
  }

  function memGet(key) {
    if (!_memCache.has(key)) return null;
    var rec = _memCache.get(key);
    // refresh LRU position
    _memCache.delete(key);
    _memCache.set(key, rec);
    return rec;
  }

  function memDel(key) { _memCache.delete(key); }

  // ── IndexedDB ─────────────────────────────────────────────────
  function openDB() {
    if (_dbFail) {
      // allow retry after 90s cool-down
      if (Date.now() - _dbFailedAt < 90000) return Promise.resolve(null);
      _dbFail = false; _dbInit = null; _db = null;
    }
    if (_db)     return Promise.resolve(_db);
    if (_dbInit) return _dbInit;

    _dbInit = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            var s = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            s.createIndex('ts', 'ts', { unique: false });
          }
          if (!db.objectStoreNames.contains(IDB_META_STORE)) {
            db.createObjectStore(IDB_META_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = function (e) {
          _db = e.target.result;
          _db.onerror = function (ev) { console.warn('[Cache] IDB error', ev); };
          _db.onversionchange = function () { _db.close(); _db = null; _dbInit = null; };
          resolve(_db);
        };
        req.onerror   = function (e) { _fail(resolve, 'onerror', e); };
        req.onblocked = function (e) { _fail(resolve, 'blocked', e); };
      } catch (e) { _fail(resolve, 'exception', e); }
    });
    return _dbInit;
  }

  function _fail(resolve, reason, e) {
    console.warn('[Cache] IDB open failed:', reason, e);
    _dbFail = true; _dbFailedAt = Date.now(); _dbInit = null;
    resolve(null);
  }

  function evictOldestIDB(n) {
    return openDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx    = db.transaction(IDB_STORE, 'readwrite');
          var store = tx.objectStore(IDB_STORE);
          var idx   = store.index('ts');
          var del   = 0;
          var req   = idx.openCursor(null, 'next');
          req.onsuccess = function (e) {
            var cursor = e.target.result;
            if (cursor && del < n) {
              store.delete(cursor.primaryKey);
              del++;
              cursor.continue();
            }
          };
          tx.oncomplete = function () { resolve(); };
          tx.onerror    = function () { resolve(); };
        } catch (e) { resolve(); }
      });
    });
  }

  function idbSet(key, value, attempt) {
    attempt = attempt || 0;
    return openDB().then(function (db) {
      if (!db) { memSet(key, value); return false; }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put({ key: key, value: value, ts: Date.now() });
          tx.oncomplete = function () { memSet(key, value); resolve(true); };
          tx.onerror    = function (e) {
            var err = e.target && e.target.error;
            var isQ = err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED');
            if (isQ && attempt < 1) {
              evictOldestIDB(30).then(function () { idbSet(key, value, attempt + 1).then(resolve); });
            } else if (attempt < IDB_RETRY_MAX) {
              setTimeout(function () { idbSet(key, value, attempt + 1).then(resolve); }, 300 * (attempt + 1));
            } else {
              memSet(key, value); resolve(false);
            }
          };
        } catch (e) { memSet(key, value); resolve(false); }
      });
    });
  }

  function idbGet(key) {
    var mem = memGet(key);
    if (mem) return Promise.resolve(mem);
    return openDB().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        try {
          var tx  = db.transaction(IDB_STORE, 'readonly');
          var req = tx.objectStore(IDB_STORE).get(key);
          req.onsuccess = function () {
            var rec = req.result || null;
            if (rec) memSet(rec.key, rec.value, rec.ts);
            resolve(rec);
          };
          req.onerror = function () { resolve(null); };
        } catch (e) { resolve(null); }
      });
    });
  }

  function idbDel(key) {
    memDel(key);
    return openDB().then(function (db) {
      if (!db) return;
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

  // ── LocalStorage helpers ───────────────────────────────────────
  function lsSet(k, v) {
    try { localStorage.setItem(k, v); return true; } catch (e) { return false; }
  }
  function lsGet(k)    { try { return localStorage.getItem(k); }  catch(e) { return null; } }
  function lsRemove(k) { try { localStorage.removeItem(k); }       catch(e) {} }

  // ── M3U cache (LS → IDB fallback) ────────────────────────────
  function getM3U(url) {
    var ck = 'plCache:' + url, ctk = 'plTime:' + url;
    var ts = parseInt(lsGet(ctk) || '0', 10);
    if (Date.now() - ts <= M3U_TTL) {
      var data = lsGet(ck);
      if (data && data.length > 100) return Promise.resolve(data);
    }
    return idbGet(ck).then(function (rec) {
      if (rec && rec.value && (Date.now() - (rec.ts || 0)) <= M3U_TTL) return rec.value;
      return null;
    });
  }

  function setM3U(url, text) {
    var ck = 'plCache:' + url, ctk = 'plTime:' + url;
    lsSet(ctk, String(Date.now()));
    if (!lsSet(ck, text)) { lsRemove(ck); lsRemove(ctk); return idbSet(ck, text); }
    return Promise.resolve(true);
  }

  function clearM3U(url) {
    var ck = 'plCache:' + url, ctk = 'plTime:' + url;
    lsRemove(ck); lsRemove(ctk);
    return idbDel(ck);
  }

  function clearAllM3U() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('plCache:') || k.startsWith('plTime:'))) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    var delKeys = [];
    _memCache.forEach(function (_, k) { if (k.startsWith('plCache:')) delKeys.push(k); });
    delKeys.forEach(function (k) { _memCache.delete(k); });
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

  // ── EPG cache ─────────────────────────────────────────────────
  function getEPG(key) {
    return idbGet('epg:' + key).then(function (rec) {
      if (rec && (Date.now() - (rec.ts || 0)) <= EPG_TTL) return rec.value;
      return null;
    });
  }

  function setEPG(key, data) {
    return idbSet('epg:' + key, data);
  }

  // ── Image preload pipeline ─────────────────────────────────────
  var _imgQueue   = [];
  var _imgActive  = 0;
  var _imgSeen    = new Map();

  function _imgAdd(url) {
    if (!url || typeof url !== 'string' || !url.startsWith('http')) return;
    if (_imgSeen.has(url)) return;
    if (_imgSeen.size >= IMG_SEEN_MAX) {
      var oldest = _imgSeen.keys().next().value;
      _imgSeen.delete(oldest);
    }
    _imgSeen.set(url, 1);
    _imgQueue.push(url);
  }

  function _drainImg() {
    while (_imgActive < IMG_CONCUR && _imgQueue.length > 0) {
      var url = _imgQueue.shift();
      _imgActive++;
      var img = new Image();
      img.onload = img.onerror = function () { _imgActive--; _drainImg(); };
      img.src = url;
    }
  }

  function preloadImages(visible, next) {
    (visible || []).forEach(_imgAdd);
    (next || []).forEach(_imgAdd);
    _drainImg();
  }

  // ── Diagnostics ───────────────────────────────────────────────
  function lsUsageBytes() {
    var total = 0;
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) total += (k.length + (localStorage.getItem(k) || '').length) * 2;
      }
    } catch(e) {}
    return total;
  }
  function lsNearQuota() { return lsUsageBytes() > LS_QUOTA_WARN; }
  function memStats()    { return { size: _memCache.size, maxSize: MEM_MAX }; }
  function dbHealthy()   { return !_dbFail && _db !== null; }

  // ── Init ──────────────────────────────────────────────────────
  openDB();

  // Periodic IDB health check every 2 min
  setInterval(function () {
    if (_dbFail) { _dbFail = false; _dbInit = null; openDB(); }
  }, 120000);

  return {
    getM3U, setM3U, clearM3U, clearAllM3U,
    getEPG, setEPG,
    preloadImages,
    lsUsageBytes, lsNearQuota, memStats, dbHealthy,
    evictOldestIDB
  };

})();

if (typeof module !== 'undefined') module.exports = AppCache;
