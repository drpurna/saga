// ================================================================
// SAGA IPTV — jiotv.js v8.0  |  All mandatory fixes applied
// FIX H13: EPG fail counter — no decrement, only cap+reset
// FIX M20: scan limited to 2 subnets, larger batch delay
// FIX (M3U fallback): /channels JSON failure → try /playlist.m3u
// ================================================================
'use strict';

var JioTVClient = (function () {

  var DEFAULT_PORT  = 5001;
  var DEFAULT_IP    = '172.20.10.2';
  var SAVED_URL_KEY = 'jiotv:server';
  var EPG_FAIL_CAP  = 5;  // FIX H13: no longer decrements

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',      3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News',      8:'Music',
    10:'Devotional',   12:'Business',   13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',   18:'Comedy',   19:'Drama',
  };

  // ── XHR with done-guard ───────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr  = new XMLHttpRequest();
      var done = false;
      var ms   = timeout > 0 ? timeout : 12000;
      var tid  = setTimeout(function () {
        if (done) return; done = true; xhr.abort(); reject(new Error('Timeout'));
      }, ms);
      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true; clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try   { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON from ' + url)); }
        } else {
          reject(new Error(xhr.status === 0 ? 'Server unreachable' : 'HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        if (done) return; done = true; clearTimeout(tid); reject(new Error('Network error'));
      };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // Fetch raw text (for M3U fallback)
  function fetchText(url, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr  = new XMLHttpRequest();
      var done = false;
      var ms   = timeout > 0 ? timeout : 15000;
      var tid  = setTimeout(function () { if (done) return; done = true; xhr.abort(); reject(new Error('Timeout')); }, ms);
      xhr.open('GET', url, true);
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true; clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) resolve(xhr.responseText);
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = function () { if (done) return; done = true; clearTimeout(tid); reject(new Error('Network')); };
      xhr.send(null);
    });
  }

  // ── Fast probe ────────────────────────────────────────────────
  function probe(baseUrl, timeoutMs) {
    return new Promise(function (resolve) {
      if (!baseUrl) { resolve(false); return; }
      var xhr  = new XMLHttpRequest();
      var done = false;
      var tid  = setTimeout(function () {
        if (done) return; done = true; xhr.abort(); resolve(false);
      }, timeoutMs || 1500);
      try {
        xhr.open('GET', baseUrl + '/channels', true);
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4 || done) return;
          done = true; clearTimeout(tid);
          resolve(xhr.status >= 200 && xhr.status < 500);
        };
        xhr.onerror = function () { if (done) return; done = true; clearTimeout(tid); resolve(false); };
        xhr.send(null);
      } catch (e) { if (!done) { done = true; clearTimeout(tid); resolve(false); } }
    });
  }

  // ── WebRTC LAN IP detection ───────────────────────────────────
  function getLocalIP() {
    return new Promise(function (resolve) {
      try {
        var pc   = new RTCPeerConnection({ iceServers: [] });
        var done = false;
        function finish(ip) { if (done) return; done = true; try { pc.close(); } catch(e){} resolve(ip); }
        pc.createDataChannel('');
        pc.createOffer().then(function (o) { return pc.setLocalDescription(o); }).catch(function(){ finish(null); });
        pc.onicecandidate = function (ev) {
          if (!ev || !ev.candidate) return;
          var m = ev.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.254.')) finish(m[1]);
        };
        setTimeout(function () { finish(null); }, 2500);
      } catch(e) { resolve(null); }
    });
  }

  // FIX M20: limited to 2 subnets, larger delay between batches
  function _buildSubnets(detectedIp) {
    var primary = DEFAULT_IP.split('.').slice(0, 3).join('.');
    var list    = [primary];
    if (detectedIp) {
      var sub = detectedIp.split('.').slice(0, 3).join('.');
      if (list.indexOf(sub) < 0) list.push(sub);
    }
    // FIX M20: only add 2 fallback subnets (reduced from 7)
    ['192.168.43', '192.168.1'].forEach(function (s) {
      if (list.length < 4 && list.indexOf(s) < 0) list.push(s);
    });
    return list.slice(0, 2); // FIX M20: hard limit to 2 subnets
  }

  function _scanSubnet(subnet, batchSize, probeMs) {
    return new Promise(function (resolve) {
      var found = null, batchIdx = 0, total = Math.ceil(254 / batchSize);
      function nextBatch() {
        if (found || batchIdx >= total) { resolve(found); return; }
        var promises = [], start = 1 + batchIdx * batchSize;
        for (var i = start; i < start + batchSize && i <= 254; i++) {
          (function (host) {
            var url = 'http://' + subnet + '.' + host + ':' + DEFAULT_PORT;
            promises.push(probe(url, probeMs).then(function (ok) { return ok ? url : null; }));
          })(i);
        }
        batchIdx++;
        Promise.all(promises).then(function (res) {
          for (var j = 0; j < res.length; j++) if (res[j]) { found = res[j]; resolve(found); return; }
          // FIX M20: 200ms delay between batches to reduce flood
          setTimeout(nextBatch, 200);
        });
      }
      nextBatch();
    });
  }

  async function discover(onProgress) {
    var saved = _loadSaved();
    if (saved) {
      if (onProgress) onProgress('Trying saved server…');
      if (await probe(saved, 2000)) return saved;
    }
    var defaultUrl = 'http://' + DEFAULT_IP + ':' + DEFAULT_PORT;
    if (onProgress) onProgress('Trying ' + defaultUrl + '…');
    if (await probe(defaultUrl, 2000)) return defaultUrl;

    if (onProgress) onProgress('Scanning LAN…');
    var localIp = await getLocalIP();
    var subnets  = _buildSubnets(localIp);

    for (var s = 0; s < subnets.length; s++) {
      if (onProgress) onProgress('Scanning ' + subnets[s] + '.0/24…');
      var found = await _scanSubnet(subnets[s], 20, 1000);
      if (found) return found;
    }
    return null;
  }

  // ── Saved URL ─────────────────────────────────────────────────
  function _loadSaved() { try { return localStorage.getItem(SAVED_URL_KEY) || null; } catch(e) { return null; } }
  function _saveUrl(url) { try { localStorage.setItem(SAVED_URL_KEY, url); } catch(e) {} }
  function _clearSaved() { try { localStorage.removeItem(SAVED_URL_KEY); } catch(e) {} }

  // ── Constructor ───────────────────────────────────────────────
  function JioTVClient(opts) {
    this.serverUrl     = (opts && opts.serverUrl || '').replace(/\/+$/, '');
    this.timeout       = (opts && opts.timeout > 0) ? opts.timeout : 12000;
    this.logged_in     = false;
    this._cache        = null;
    this._epgFailCount = 0;
  }

  var P = JioTVClient.prototype;
  JioTVClient.discover    = discover;
  JioTVClient.probe       = probe;
  JioTVClient.loadSaved   = _loadSaved;
  JioTVClient.saveUrl     = _saveUrl;
  JioTVClient.clearSaved  = _clearSaved;
  JioTVClient.DEFAULT_URL = 'http://' + DEFAULT_IP + ':' + DEFAULT_PORT;

  // ── Status check — /channels is truth ─────────────────────────
  P.checkStatus = async function () {
    var result = { status: false, channelCount: 0, reason: '' };
    try {
      var d    = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
      if (list !== null) {
        this.logged_in = true; this._cache = list;
        result.status = true; result.channelCount = list.length;
      } else {
        // FIX: invalid JSON shape — report clearly
        result.reason = (d && d.error) ? String(d.error) : 'Server returned unexpected format. Try M3U mode.';
      }
    } catch (e) {
      result.reason = e.message;
    }
    this.logged_in = result.status;
    return result;
  };

  // ── Channel list — FIX: M3U fallback on bad JSON ──────────────
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d = null;
    try {
      d = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    } catch (e) {
      console.warn('[JioTV] /channels fetch error:', e.message);
    }

    var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
    if (list !== null) { this._cache = list; return list; }

    // FIX: fallback to /playlist.m3u if JSON is missing/malformed
    console.warn('[JioTV] Invalid /channels response — trying M3U fallback');
    try {
      var m3uText = await fetchText(this.serverUrl + '/playlist.m3u', 20000);
      if (m3uText && m3uText.includes('#EXTINF')) {
        // Parse M3U into pseudo-channel objects
        var lines   = m3uText.split(/\r?\n/);
        var parsed  = [], meta = null;
        for (var i = 0; i < lines.length; i++) {
          var line = lines[i].trim(); if (!line) continue;
          if (line.startsWith('#EXTINF')) {
            var commaIdx = line.lastIndexOf(',');
            var name = commaIdx >= 0 ? line.slice(commaIdx + 1).trim() : 'Channel';
            var gm = line.match(/group-title="([^"]+)"/i);
            var lm = line.match(/tvg-logo="([^"]+)"/i);
            var im = line.match(/tvg-id="([^"]+)"/i);
            meta = { name: name, group: gm ? gm[1] : 'Other', logo: lm ? lm[1] : '', id: im ? im[1] : '' };
          } else if (meta && !line.startsWith('#')) {
            parsed.push({ channel_name: meta.name, channelCategoryId: 0, id: meta.id || String(parsed.length + 1), logoUrl: meta.logo, channelLanguage: '', isHD: false, _m3uUrl: line });
            meta = null;
          }
        }
        this._cache = parsed; return parsed;
      }
    } catch (e2) {
      console.warn('[JioTV] M3U fallback also failed:', e2.message);
    }
    this._cache = []; return [];
  };

  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      var id    = String(ch.channel_id || ch.id || '').trim();
      var name  = String(ch.channel_name || ch.name || 'Unknown').trim();
      var logo  = String(ch.logoUrl || ch.logo_url || ch.logo || '').trim();
      var lang  = String(ch.channelLanguage || ch.language || '').trim();
      // Use _m3uUrl if available (M3U fallback path)
      var url   = ch._m3uUrl || (id ? (base + '/live/' + id + '.m3u8') : '');
      return {
        name:   name || ('Channel ' + id),
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   logo, url: url, jioId: id,
        isHD:   !!(ch.isHD || ch.is_hd),
        lang:   lang, source: 'jiotv',
      };
    }).filter(function (ch) { return ch.url; });
  };

  // ── Stream info ───────────────────────────────────────────────
  P.getStreamInfo = async function (channelId) {
    if (!channelId) return { url: '', isDRM: false };
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) { d.isDRM = !!(d.drm_url || d.key); return d; }
    } catch (e) { console.warn('[JioTV] getStreamInfo:', e.message); }
    return { url: this.serverUrl + '/live/' + channelId + '.m3u8', isDRM: false };
  };

  // FIX H13: no decrement — counter only increases up to cap, resets on success
  P.getNowPlaying = async function (channelId) {
    if (!channelId) return null;
    if (this._epgFailCount >= EPG_FAIL_CAP) return null; // FIX H13: no decrement, just skip
    try {
      var d = await fetchJSON(
        this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId),
        null, 6000
      );
      this._epgFailCount = 0; // FIX H13: reset on any success
      return (d && d.result) ? d.result : null;
    } catch (e) {
      this._epgFailCount++;
      return null;
    }
  };

  P.invalidateCache = function ()   { this._cache = null; };
  P.getStreamUrl    = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl  = function ()   { return this.serverUrl + '/playlist.m3u'; };

  JioTVClient.isSafeM3UURL = function (url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      var h = u.hostname;
      if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(h)) return false;
      if (h === 'localhost' || h === '::1') return false;
      return true;
    } catch (e) { return false; }
  };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;
