/*!
 * SAGA IPTV — EPG Module v2
 * Fetches real XMLTV data from iptv-org India EPG.
 * Parses current programme for a channel by name matching.
 * Uses AppCache (IDB) for 4-hour persistence.
 */
(function(global){
'use strict';

var EPG_URL = 'https://iptv-org.github.io/epg/guides/in/epg.xml';
var EPG_KEY = 'saga:epgv2';
var EPG_TTL = 4 * 60 * 60 * 1000; // 4 hours

var _guide  = null;   /* { channelId: [{title,start,stop}] } */
var _loading = false;
var _callbacks = [];

/* ── Parse XMLTV string synchronously ── */
function parseXMLTV(xmlStr) {
  var guide = {};
  try {
    var parser = new DOMParser();
    var doc = parser.parseFromString(xmlStr, 'text/xml');
    var progs = doc.querySelectorAll('programme');
    var now = Date.now();

    /* Build channel display-name → id map */
    var nameToId = {};
    doc.querySelectorAll('channel').forEach(function(ch) {
      var id = ch.getAttribute('id') || '';
      var dn = ch.querySelector('display-name');
      if (dn) nameToId[(dn.textContent || '').toLowerCase().trim()] = id;
    });

    progs.forEach(function(p) {
      var chId = p.getAttribute('channel') || '';
      var start = parseEpgDate(p.getAttribute('start') || '');
      var stop  = parseEpgDate(p.getAttribute('stop')  || '');
      if (!chId || !start || !stop) return;
      /* Only keep currently-airing or upcoming (within 4h) */
      if (stop < now - 60000) return;
      if (start > now + EPG_TTL) return;
      var titleEl = p.querySelector('title');
      var descEl  = p.querySelector('desc');
      var entry = {
        title: titleEl ? (titleEl.textContent || '') : '',
        desc:  descEl  ? (descEl.textContent  || '') : '',
        start: start,
        stop:  stop
      };
      if (!guide[chId]) guide[chId] = [];
      guide[chId].push(entry);
    });

    /* Also index by display-name for fuzzy lookup */
    guide.__nameToId = nameToId;
  } catch(e) {
    console.warn('[EPG] parse error', e);
  }
  return guide;
}

function parseEpgDate(s) {
  /* YYYYMMDDHHMMSS +HHMM or Z */
  if (!s || s.length < 14) return 0;
  var d = s.slice(0,4)+'-'+s.slice(4,6)+'-'+s.slice(6,8)+'T'+
          s.slice(8,10)+':'+s.slice(10,12)+':'+s.slice(12,14);
  var tz = s.slice(14).trim();
  if (tz && tz !== 'Z') d += tz.replace(/(\d{2})(\d{2})/, '$1:$2');
  return new Date(d).getTime() || 0;
}

/* ── Load EPG (from cache or network) ── */
function loadEPG(cb) {
  if (_guide) { cb(_guide); return; }
  if (cb) _callbacks.push(cb);
  if (_loading) return;
  _loading = true;

  function dispatch(g) {
    _guide = g;
    _loading = false;
    _callbacks.forEach(function(fn) { try { fn(g); } catch(e){} });
    _callbacks = [];
  }

  /* Try IDB cache first */
  function tryCache() {
    if (typeof AppCache === 'undefined') { fetchFresh(); return; }
    AppCache.getEPG(EPG_KEY).then(function(rec) {
      if (rec && rec.value && (Date.now() - (rec.ts||0)) < EPG_TTL) {
        try {
          dispatch(JSON.parse(rec.value));
          return;
        } catch(e) {}
      }
      fetchFresh();
    }).catch(fetchFresh);
  }

  function fetchFresh() {
    /* Fetch plain XML (iptv-org also serves uncompressed XML) */
    var xmlUrl = 'https://iptv-org.github.io/epg/guides/in/epg.xml';
    fetch(xmlUrl, { signal: AbortSignal.timeout ? AbortSignal.timeout(15000) : undefined })
      .then(function(r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      })
      .then(function(txt) {
        var g = parseXMLTV(txt);
        if (typeof AppCache !== 'undefined') {
          AppCache.setEPG(EPG_KEY, JSON.stringify(g));
        }
        dispatch(g);
      })
      .catch(function(e) {
        console.warn('[EPG] fetch failed:', e);
        dispatch({});
      });
  }

  tryCache();
}

/* ── Public API ── */
global.SagaEPG = {
  /* Get current programme for a channel by display name */
  getCurrent: function(channelName, cb) {
    loadEPG(function(guide) {
      if (!guide || !channelName) { cb(null); return; }
      var now = Date.now();
      var norm = channelName.toLowerCase().trim();

      /* Try exact display-name match first */
      var nameToId = guide.__nameToId || {};
      var chId = nameToId[norm];

      /* Fuzzy: find best matching id */
      if (!chId) {
        var bestScore = 0;
        for (var key in nameToId) {
          if (key.indexOf(norm) >= 0 || norm.indexOf(key) >= 0) {
            var score = Math.min(key.length, norm.length) /
                        Math.max(key.length, norm.length);
            if (score > bestScore) { bestScore = score; chId = nameToId[key]; }
          }
        }
      }

      if (!chId) { cb(null); return; }
      var progs = guide[chId] || [];
      for (var i = 0; i < progs.length; i++) {
        if (progs[i].start <= now && now < progs[i].stop) {
          cb(progs[i]);
          return;
        }
      }
      cb(null);
    });
  },

  /* Pre-warm EPG cache in background */
  prefetch: function() {
    loadEPG(function() { /* no-op — just warm the cache */ });
  },

  /* Force refresh */
  clear: function() {
    _guide = null;
    if (typeof AppCache !== 'undefined') AppCache.setEPG(EPG_KEY, '');
  }
};

})(window);
