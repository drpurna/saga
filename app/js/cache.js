// ================================================================
// SAGA IPTV — cache.js v7.0 Performance Edition
// Multi-tier: MemCache(LRU) → IndexedDB → LocalStorage fallback
// Playlist TTL: 3.5 days (twice-a-week refresh per spec)
// ================================================================
'use strict';

var AppCache = (function () {

  var PL_TTL         = 3.5 * 24 * 60 * 60 * 1000; // 3.5 days — refresh ~twice a week
  var EPG_TTL        = 4  * 60 * 60 * 1000;        // 4 hours
  var IDB_NAME       = 'saga-cache-v7';
  var IDB_VER        = 1;
  var IDB_STORE      = 'payloads';
  var IMG_CONCUR     = 4;
  var MEM_MAX        = 60;

  var _memCache   = new Map();
  var _db         = null;
  var _dbFail     = false;
  var _dbFailedAt = 0;
  var _dbInit     = null;

  // ── LRU MemCache ──────────────────────────────────────────────
  function memSet(key, value, ts) {
    if (_memCache.has(key)) _memCache.delete(key);
    if (_memCache.size >= MEM_MAX) _memCache.delete(_memCache.keys().next().value);
    _memCache.set(key, { value: value, ts: ts || Date.now() });
  }
  function memGet(key) {
    var rec = _memCache.get(key);
    if (!rec) return null;
    _memCache.delete(key); _memCache.set(key, rec); // refresh LRU
    return rec;
  }

  // ── IndexedDB ─────────────────────────────────────────────────
  function openDB() {
    if (_dbFail && Date.now() - _dbFailedAt < 90000) return Promise.resolve(null);
    if (_db) return Promise.resolve(_db);
    if (_dbInit) return _dbInit;
    _dbFail = false;
    _dbInit = new Promise(function (resolve) {
      try {
        var req = indexedDB.open(IDB_NAME, IDB_VER);
        req.onupgradeneeded = function (e) {
          var db = e.target.result;
          if (!db.objectStoreNames.contains(IDB_STORE)) {
            var s = db.createObjectStore(IDB_STORE, { keyPath: 'key' });
            s.createIndex('ts', 'ts', { unique: false });
          }
        };
        req.onsuccess = function (e) {
          _db = e.target.result;
          _db.onversionchange = function () { _db.close(); _db = null; _dbInit = null; };
          resolve(_db);
        };
        req.onerror = req.onblocked = function (e) {
          _dbFail = true; _dbFailedAt = Date.now(); _dbInit = null; resolve(null);
        };
      } catch (e) { _dbFail = true; _dbFailedAt = Date.now(); _dbInit = null; resolve(null); }
    });
    return _dbInit;
  }

  function idbSet(key, value) {
    return openDB().then(function (db) {
      if (!db) { memSet(key, value); return false; }
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).put({ key: key, value: value, ts: Date.now() });
          tx.oncomplete = function () { memSet(key, value); resolve(true); };
          tx.onerror = function () { memSet(key, value); resolve(false); };
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
          var tx = db.transaction(IDB_STORE, 'readonly');
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
    _memCache.delete(key);
    return openDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).delete(key);
          tx.oncomplete = resolve; tx.onerror = resolve;
        } catch (e) { resolve(); }
      });
    });
  }

  // ── LS helpers ────────────────────────────────────────────────
  function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch(e) { return false; } }
  function lsGet(k)    { try { return localStorage.getItem(k); } catch(e) { return null; } }
  function lsRemove(k) { try { localStorage.removeItem(k); } catch(e) {} }

  // ── M3U / Playlist cache — 3.5-day TTL ───────────────────────
  function getM3U(url) {
    var ck = 'pl7:' + url, ctk = 'pt7:' + url;
    // Fast path: LS hit
    var ts = parseInt(lsGet(ctk) || '0', 10);
    if (Date.now() - ts <= PL_TTL) {
      var data = lsGet(ck);
      if (data && data.length > 100) return Promise.resolve(data);
    }
    // IDB path
    return idbGet(ck).then(function (rec) {
      if (rec && rec.value && (Date.now() - (rec.ts || 0)) <= PL_TTL) return rec.value;
      return null;
    });
  }

  function setM3U(url, text) {
    var ck = 'pl7:' + url, ctk = 'pt7:' + url;
    lsSet(ctk, String(Date.now()));
    if (!lsSet(ck, text)) { lsRemove(ck); lsRemove(ctk); return idbSet(ck, text); }
    return Promise.resolve(true);
  }

  function clearM3U(url) {
    var ck = 'pl7:' + url, ctk = 'pt7:' + url;
    lsRemove(ck); lsRemove(ctk); return idbDel(ck);
  }

  function clearAllM3U() {
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && (k.startsWith('pl7:') || k.startsWith('pt7:') ||
                  k.startsWith('plCache:') || k.startsWith('plTime:'))) keys.push(k);
      }
      keys.forEach(function (k) { localStorage.removeItem(k); });
    } catch (e) {}
    _memCache.forEach(function (_, k) { if (k.startsWith('pl7:') || k.startsWith('plCache:')) _memCache.delete(k); });
    return openDB().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        try {
          var tx = db.transaction(IDB_STORE, 'readwrite');
          tx.objectStore(IDB_STORE).clear();
          tx.oncomplete = resolve; tx.onerror = resolve;
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
  function setEPG(key, data) { return idbSet('epg:' + key, data); }

  // ── Channel list cache — stored as JSON blob ──────────────────
  function getChannelCache(key) {
    return idbGet('ch7:' + key).then(function (rec) {
      if (rec && rec.value) return rec.value;
      return lsGet('ch7ls:' + key) || null;
    });
  }
  function setChannelCache(key, jsonStr) {
    if (!lsSet('ch7ls:' + key, jsonStr)) lsRemove('ch7ls:' + key);
    return idbSet('ch7:' + key, jsonStr);
  }

  // ── Image preload pipeline ─────────────────────────────────────
  var _imgQueue = [], _imgActive = 0, _imgSeen = new Set();
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
    (visible || []).forEach(function(u) { if (u && !_imgSeen.has(u)) { _imgSeen.add(u); _imgQueue.push(u); }});
    (next || []).forEach(function(u) { if (u && !_imgSeen.has(u)) { _imgSeen.add(u); _imgQueue.push(u); }});
    if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(_drainImg, {timeout:500});
    else setTimeout(_drainImg, 100);
  }

  // ── Boot IDB ──────────────────────────────────────────────────
  openDB();

  return { getM3U, setM3U, clearM3U, clearAllM3U, getEPG, setEPG,
           getChannelCache, setChannelCache, preloadImages };
})();
if (typeof module !== 'undefined') module.exports = AppCache;
