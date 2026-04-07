// ================================================================
// SAGA IPTV — jiotv.js v7.0  |  LAN Auto-scan + Manual Fallback
// - Auto-scan: tries 172.20.10.2:5001, then WebRTC subnet scan
// - Manual entry: saved to localStorage, never re-asked if working
// - No OTP modal, no fake scan button — fully transparent
// - EPG backoff: fail-counter with reset on success
// - XHR done-guard prevents double-resolve on timeout races
// ================================================================
'use strict';

var JioTVClient = (function () {

  var DEFAULT_PORT = 5001;
  var DEFAULT_IP   = '172.20.10.2';
  var SAVED_URL_KEY = 'jiotv:server';

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',      3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News',      8:'Music',
    10:'Devotional',   12:'Business',   13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',   18:'Comedy',   19:'Drama',
  };

  // ── XHR helper — done-guard prevents double-resolve ───────────
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
          catch (e) { reject(new Error('Invalid JSON')); }
        } else {
          reject(new Error(xhr.status === 0 ? 'Server unreachable' : 'HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        if (done) return; done = true; clearTimeout(tid);
        reject(new Error('Network error'));
      };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // ── Fast TCP probe via GET /channels ──────────────────────────
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
        xhr.onerror = function () {
          if (done) return; done = true; clearTimeout(tid); resolve(false);
        };
        xhr.send(null);
      } catch (e) { if (!done) { done = true; clearTimeout(tid); resolve(false); } }
    });
  }

  // ── WebRTC — detect TV's own LAN IP ──────────────────────────
  function getLocalIP() {
    return new Promise(function (resolve) {
      try {
        var pc   = new RTCPeerConnection({ iceServers: [] });
        var done = false;
        function finish(ip) {
          if (done) return; done = true;
          try { pc.close(); } catch(e) {}
          resolve(ip);
        }
        pc.createDataChannel('');
        pc.createOffer()
          .then(function (o) { return pc.setLocalDescription(o); })
          .catch(function () { finish(null); });
        pc.onicecandidate = function (ev) {
          if (!ev || !ev.candidate) return;
          var m = ev.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.254.')) finish(m[1]);
        };
        setTimeout(function () { finish(null); }, 2500);
      } catch(e) { resolve(null); }
    });
  }

  // ── Build ordered subnet list for scanning ────────────────────
  function _buildSubnets(detectedIp) {
    var primary = DEFAULT_IP.split('.').slice(0, 3).join('.');  // 172.20.10
    var list    = [primary];
    if (detectedIp) {
      var sub = detectedIp.split('.').slice(0, 3).join('.');
      if (list.indexOf(sub) < 0) list.push(sub);
    }
    // Common hotspot/router subnets as fallback
    ['172.20.9','172.20.11','192.168.43','192.168.1','192.168.0','10.0.0','10.42.0']
      .forEach(function (s) { if (list.indexOf(s) < 0) list.push(s); });
    return list;
  }

  // ── Parallel batch scan of one /24 subnet ─────────────────────
  function _scanSubnet(subnet, batchSize, probeMs) {
    return new Promise(function (resolve) {
      var found    = null;
      var batchIdx = 0;
      var total    = Math.ceil(254 / batchSize);

      function nextBatch() {
        if (found || batchIdx >= total) { resolve(found); return; }
        var promises = [];
        var start    = 1 + batchIdx * batchSize;
        for (var i = start; i < start + batchSize && i <= 254; i++) {
          (function (host) {
            var url = 'http://' + subnet + '.' + host + ':' + DEFAULT_PORT;
            promises.push(probe(url, probeMs).then(function (ok) { return ok ? url : null; }));
          })(i);
        }
        batchIdx++;
        Promise.all(promises).then(function (results) {
          for (var j = 0; j < results.length; j++) {
            if (results[j]) { found = results[j]; resolve(found); return; }
          }
          nextBatch();
        });
      }
      nextBatch();
    });
  }

  // ── Public: full LAN discovery (async, returns URL or null) ───
  async function discover(onProgress) {
    // Step 1: try saved URL
    var saved = _loadSaved();
    if (saved) {
      if (onProgress) onProgress('Trying saved server…');
      if (await probe(saved, 2000)) return saved;
    }

    // Step 2: try hardcoded default IP first (fastest path)
    var defaultUrl = 'http://' + DEFAULT_IP + ':' + DEFAULT_PORT;
    if (onProgress) onProgress('Trying ' + defaultUrl + '…');
    if (await probe(defaultUrl, 2000)) return defaultUrl;

    // Step 3: scan subnets using TV's detected IP
    if (onProgress) onProgress('Scanning LAN…');
    var localIp = await getLocalIP();
    var subnets  = _buildSubnets(localIp);

    for (var s = 0; s < subnets.length; s++) {
      if (onProgress) onProgress('Scanning ' + subnets[s] + '.0/24…');
      var found = await _scanSubnet(subnets[s], 25, 900);
      if (found) return found;
    }
    return null;
  }

  // ── Saved URL helpers ─────────────────────────────────────────
  function _loadSaved() {
    try { return localStorage.getItem(SAVED_URL_KEY) || null; } catch(e) { return null; }
  }
  function _saveUrl(url) {
    try { localStorage.setItem(SAVED_URL_KEY, url); } catch(e) {}
  }
  function _clearSaved() {
    try { localStorage.removeItem(SAVED_URL_KEY); } catch(e) {}
  }

  // ── Constructor ───────────────────────────────────────────────
  function JioTVClient(opts) {
    this.serverUrl     = (opts && opts.serverUrl || '').replace(/\/+$/, '');
    this.timeout       = (opts && opts.timeout > 0) ? opts.timeout : 12000;
    this.logged_in     = false;
    this._cache        = null;
    this._epgFailCount = 0;
  }

  var P = JioTVClient.prototype;

  // ── Static API ────────────────────────────────────────────────
  JioTVClient.discover    = discover;
  JioTVClient.probe       = probe;
  JioTVClient.loadSaved   = _loadSaved;
  JioTVClient.saveUrl     = _saveUrl;
  JioTVClient.clearSaved  = _clearSaved;
  JioTVClient.DEFAULT_URL = 'http://' + DEFAULT_IP + ':' + DEFAULT_PORT;

  // ── Status check — /channels is truth for v3.17+ ─────────────
  P.checkStatus = async function () {
    var result = { status: false, channelCount: 0, reason: '' };
    try {
      var d    = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
      if (list !== null) {
        this.logged_in      = true;
        this._cache         = list;
        result.status       = true;
        result.channelCount = list.length;
      } else {
        result.reason = (d && d.error) ? String(d.error) : 'Unexpected response';
      }
    } catch (e) {
      result.reason = e.message;
    }
    this.logged_in = result.status;
    return result;
  };

  // ── Channel list ──────────────────────────────────────────────
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d    = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : [];
    this._cache = list;
    return list;
  };

  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      var id    = String(ch.channel_id  || ch.id         || '').trim();
      var name  = String(ch.channel_name || ch.name      || 'Unknown').trim();
      var logo  = String(ch.logoUrl || ch.logo_url || ch.logo || '').trim();
      var lang  = String(ch.channelLanguage || ch.language || '').trim();
      return {
        name:   name || ('Channel ' + id),
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   logo,
        url:    id ? (base + '/live/' + id + '.m3u8') : '',
        jioId:  id,
        isHD:   !!(ch.isHD || ch.is_hd),
        lang:   lang,
        source: 'jiotv',
      };
    }).filter(function (ch) { return ch.jioId && ch.url; });
  };

  // ── Stream info ───────────────────────────────────────────────
  P.getStreamInfo = async function (channelId) {
    if (!channelId) return { url: '', isDRM: false };
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) { d.isDRM = !!(d.drm_url || d.key); return d; }
    } catch (e) {
      console.warn('[JioTV] getStreamInfo(' + channelId + '):', e.message);
    }
    return { url: this.serverUrl + '/live/' + channelId + '.m3u8', isDRM: false };
  };

  // ── EPG with proper backoff reset ─────────────────────────────
  P.getNowPlaying = async function (channelId) {
    if (!channelId) return null;
    if (this._epgFailCount > 5) {
      this._epgFailCount = Math.max(0, this._epgFailCount - 1);
      return null;
    }
    try {
      var d = await fetchJSON(
        this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId),
        null, 6000
      );
      this._epgFailCount = 0;   // always reset on any success
      return (d && d.result) ? d.result : null;
    } catch (e) {
      this._epgFailCount++;
      return null;
    }
  };

  // ── Helpers ───────────────────────────────────────────────────
  P.invalidateCache = function ()   { this._cache = null; };
  P.getStreamUrl    = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl  = function ()   { return this.serverUrl + '/playlist.m3u'; };

  // ── SSRF guard for user-added M3U URLs ───────────────────────
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
