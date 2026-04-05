// ================================================================
// SAGA IPTV — cache.js v1.0  |  App Shell Cache + Smart Prefetch
// Handles: M3U cache, JioTV channel cache, image preload queue,
// localStorage quota guard, IndexedDB for large payloads
// ================================================================
'use strict';

var AppCache = (function () {

  // ── Config ───────────────────────────────────────────────────
  var M3U_TTL       = 10 * 60 * 1000;   // 10 min
  var JIOTV_TTL     =  5 * 60 * 1000;   // 5 min
  var LS_QUOTA_WARN = 4 * 1024 * 1024;  // 4 MB warn threshold
  var IDB_NAME      = 'saga-cache';
  var IDB_VER       = 1;
  var IDB_STORE     = 'payloads';

  // ── IndexedDB (for large M3U files > localStorage quota) ─────
  var _db = null;

  function openDB() {
    return new Promise(function (resolve) {
      if (_db) { resolve(_db); return; }
      try {
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            db.createObjectStore(IDB_STORE, { keyPath: 'key' });
          }
        };
        req.onsuccess = function (e) { _db = e.target.result; resolve(_db); };
        req.onerror   = function ()  { resolve(null); };  // graceful fallback
      } catch (e) { resolve(null); }
    });
  }

  function idbSet(key, value) {
    return openDB().then(function (db) {
      if (!db) return false;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put({ key: key, value: value, ts: Date.now() });
          tx.oncomplete = function () { resolve(true); };
          tx.onerror    = function () { resolve(false); };
        } catch (e) { resolve(false); }
      });
    });
  }

  function idbGet(key) {
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
    return openDB().then(function (db) {
      if (!db) return;
      try {
        var tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).delete(key);
      } catch (e) {}
    });
  }

  // ── localStorage helpers with quota guard ─────────────────────
  function lsSet(k, v) {
    try {
      localStorage.setItem(k, v);
      return true;
    } catch (e) {
      // Quota exceeded — evict oldest M3U caches and retry
      _evictOldest();
      try { localStorage.setItem(k, v); return true; } catch (e2) { return false; }
    }
  }

  function lsGet(k) {
    try { return localStorage.getItem(k); } catch (e) { return null; }
  }

  function lsRemove(k) {
    try { localStorage.removeItem(k); } catch (e) {}
  }

  // Evict oldest playlist caches when quota is hit
  function _evictOldest() {
    try {
      var caches = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.startsWith('plCache:')) {
          var timeKey = 'plCacheTime:' + k.slice(8);
          var ts = parseInt(localStorage.getItem(timeKey) || '0', 10);
          caches.push({ key: k, timeKey: timeKey, ts: ts });
        }
      }
      caches.sort(function (a, b) { return a.ts - b.ts; });
      // Remove oldest two entries
      caches.slice(0, 2).forEach(function (c) {
        localStorage.removeItem(c.key);
        localStorage.removeItem(c.timeKey);
      });
    } catch (e) {}
  }

  // ── M3U cache (localStorage with IDB fallback for large files) ─
  function getM3U(url) {
    var ck  = 'plCache:' + url;
    var ctk = 'plCacheTime:' + url;
    var ts  = parseInt(lsGet(ctk) || '0', 10);
    if (Date.now() - ts > M3U_TTL) return Promise.resolve(null);
    var data = lsGet(ck);
    if (data && data.length > 100) return Promise.resolve(data);
    // Fallback to IDB
    return idbGet(ck).then(function (rec) {
      if (rec && rec.value && (Date.now() - rec.ts) < M3U_TTL) return rec.value;
      return null;
    });
  }

  function setM3U(url, text) {
    var ck  = 'plCache:' + url;
    var ctk = 'plCacheTime:' + url;
    var now = String(Date.now());
    lsSet(ctk, now);
    var ok = lsSet(ck, text);
    if (!ok) {
      // localStorage full — use IDB
      lsRemove(ck); lsRemove(ctk);
      return idbSet(ck, text);
    }
    return Promise.resolve(true);
  }

  function clearM3U(url) {
    var ck  = 'plCache:' + url;
    var ctk = 'plCacheTime:' + url;
    lsRemove(ck); lsRemove(ctk);
    return idbDelete(ck);
  }

  // ── JioTV channel cache (IDB — can be several hundred KB) ─────
  var JIOTV_IDB_KEY = 'jiotv:channels';

  function getJioChannels() {
    return idbGet(JIOTV_IDB_KEY).then(function (rec) {
      if (!rec) return null;
      if (Date.now() - rec.ts > JIOTV_TTL) return null;
      return rec.value;  // array of formatted channel objects
    });
  }

  function setJioChannels(list) {
    return idbSet(JIOTV_IDB_KEY, list);
  }

  function clearJioChannels() {
    return idbDelete(JIOTV_IDB_KEY);
  }

  // ── Image preload queue (non-blocking, low priority) ──────────
  var _imgQueue   = [];
  var _imgActive  = 0;
  var IMG_CONCUR  = 4;
  var _imgCache   = new Set();

  function preloadImages(urls) {
    urls.forEach(function (url) {
      if (!url || _imgCache.has(url)) return;
      _imgCache.add(url);
      _imgQueue.push(url);
    });
    _drainImgQueue();
  }

  function _drainImgQueue() {
    while (_imgActive < IMG_CONCUR && _imgQueue.length > 0) {
      var url = _imgQueue.shift();
      _imgActive++;
      var img = new Image();
      img.onload  = img.onerror = function () { _imgActive--; _drainImgQueue(); };
      img.src = url;
    }
  }

  // ── localStorage usage estimate ───────────────────────────────
  function lsUsage() {
    try {
      var total = 0;
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k) total += k.length + (localStorage.getItem(k) || '').length;
      }
      return total * 2; // UTF-16 bytes
    } catch (e) { return 0; }
  }

  function lsNearQuota() {
    return lsUsage() > LS_QUOTA_WARN;
  }

  // ── Warm up IDB on page load ──────────────────────────────────
  openDB();

  // ── Public API ────────────────────────────────────────────────
  return {
    getM3U:          getM3U,
    setM3U:          setM3U,
    clearM3U:        clearM3U,
    getJioChannels:  getJioChannels,
    setJioChannels:  setJioChannels,
    clearJioChannels:clearJioChannels,
    preloadImages:   preloadImages,
    lsUsage:         lsUsage,
    lsNearQuota:     lsNearQuota,
  };
})();

if (typeof window !== 'undefined') window.AppCache = AppCache;
