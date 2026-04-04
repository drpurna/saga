// ================================================================
// SAGA IPTV — jiotv.js v2.0  |  v3.17+ compatible
// Auto-discovery 172.20.10.x · DRM stream info · EPG auto-load
// ================================================================
'use strict';

var JioTVClient = (function () {

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',  3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News', 8:'Music',
    10:'Devotional',   12:'Business',13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',18:'Comedy',   19:'Drama',
  };

  // ── XHR fetch ────────────────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); reject(new Error('Timeout')); }, timeout || 12000);
      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        } else { reject(new Error('HTTP ' + xhr.status)); }
      };
      xhr.onerror = function () { clearTimeout(tid); reject(new Error('Network error')); };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // Fast reachability probe
  function probe(baseUrl, timeout) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); resolve(false); }, timeout || 900);
      xhr.open('GET', baseUrl + '/channels', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        resolve(xhr.status >= 200 && xhr.status < 400);
      };
      xhr.onerror = function () { clearTimeout(tid); resolve(false); };
      xhr.send(null);
    });
  }

  // ── WebRTC local IP ──────────────────────────────────────────
  function getLocalIP() {
    return new Promise(function (resolve) {
      try {
        var pc = new RTCPeerConnection({ iceServers: [] });
        pc.createDataChannel('');
        pc.createOffer().then(function (o) { pc.setLocalDescription(o); });
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) return;
          var m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.')) { pc.close(); resolve(m[1]); }
        };
        setTimeout(function () { resolve(null); }, 2500);
      } catch (e) { resolve(null); }
    });
  }

  // ── Subnet list — 172.20.10 always FIRST, scan it completely before others ──
  function buildSubnets(detectedIp) {
    // 172.20.10 is hardcoded first — user's confirmed subnet
    var list = ['172.20.10'];
    if (detectedIp) {
      var sub = detectedIp.split('.').slice(0, 3).join('.');
      // Add detected only if different
      if (sub !== '172.20.10') list.push(sub);
    }
    // Common fallbacks — only reached if 172.20.10 scan finds nothing
    ['172.20.9','172.20.11','172.20.0','192.168.1','192.168.0','10.0.0']
      .forEach(function (s) { if (list.indexOf(s) === -1) list.push(s); });
    return list;
  }

  // Scan one subnet in parallel batches
  function scanSubnet(subnet, start, end, batchSize, probeMs) {
    return new Promise(function (resolve) {
      var found = null, batchIdx = 0, batches = Math.ceil((end - start + 1) / batchSize);
      function nextBatch() {
        if (found || batchIdx >= batches) { resolve(found); return; }
        var promises = [], base = start + batchIdx * batchSize;
        for (var i = base; i < base + batchSize && i <= end; i++) {
          (function (ip) {
            var url = 'http://' + subnet + '.' + ip + ':5001';
            promises.push(probe(url, probeMs).then(function (ok) { return ok ? url : null; }));
          })(i);
        }
        batchIdx++;
        Promise.all(promises).then(function (res) {
          for (var j = 0; j < res.length; j++) { if (res[j]) { found = res[j]; resolve(found); return; } }
          nextBatch();
        });
      }
      nextBatch();
    });
  }

  // Full discovery: saved → WebRTC subnet → scan 1-200
  async function discoverServer(savedUrl) {
    if (savedUrl && await probe(savedUrl, 1500)) return savedUrl;
    var localIp = await getLocalIP();
    var subnets = buildSubnets(localIp);
    for (var s = 0; s < subnets.length; s++) {
      var found = await scanSubnet(subnets[s], 1, 200, 30, 900);
      if (found) return found;
    }
    return null;
  }

  // ── Constructor ──────────────────────────────────────────────
  function JioTVClient(opts) {
    if (!opts || !opts.serverUrl) throw new Error('serverUrl required');
    this.serverUrl = opts.serverUrl.replace(/\/$/, '');
    this.timeout   = opts.timeout || 12000;
    this.logged_in = false;
    this._cache    = null;
  }

  var P = JioTVClient.prototype;

  // Static helpers
  JioTVClient.discover = discoverServer;
  JioTVClient.probe    = probe;

  // ── Auth ─────────────────────────────────────────────────────
  P.checkStatus = async function () {
    try {
      var d = await fetchJSON(this.serverUrl + '/checkStatus', null, this.timeout);
      this.logged_in = !!(d && (d.status === true || d.status === 'true'));
    } catch (e) { this.logged_in = false; }
    return this.logged_in;
  };

  P.login = async function (username, password) {
    var d = await fetchJSON(this.serverUrl + '/login',
      { method: 'POST', body: { username: username, password: password } }, this.timeout);
    if (d && (d.status === true || d.status === 'true')) { this.logged_in = true; return d; }
    throw new Error(d && d.message ? d.message : 'Login failed');
  };

  P.logout = async function () {
    try { await fetchJSON(this.serverUrl + '/logout', null, this.timeout); } catch (e) {}
    this.logged_in = false;
  };

  // ── Channels ─────────────────────────────────────────────────
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = (d && Array.isArray(d.result)) ? d.result : (Array.isArray(d) ? d : []);
    this._cache = list;
    return list;
  };

  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      var id    = String(ch.channel_id || ch.id || '');
      return {
        name:   String(ch.channel_name || ch.name || 'Unknown'),
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   ch.logoUrl || ch.logo_url || ch.logo || '',
        url:    base + '/stream/' + id + '/auto',
        jioId:  id,
        isHD:   !!(ch.isHD || ch.is_hd),
        source: 'jiotv',
      };
    });
  };

  // ── DRM stream info (v3.17) ───────────────────────────────────
  // Returns { url, drm_url?, key?, iv?, isDRM }
  P.getStreamInfo = async function (channelId) {
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) {
        d.isDRM = !!(d.drm_url || d.key);
        return d;
      }
    } catch (e) {}
    return { url: this.serverUrl + '/stream/' + channelId + '/auto', isDRM: false };
  };

  // ── EPG ──────────────────────────────────────────────────────
  P.getNowPlaying = async function (channelId) {
    try {
      var d = await fetchJSON(
        this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId),
        null, 6000);
      return (d && d.result) ? d.result : null;
    } catch (e) { return null; }
  };

  P.getSchedule = async function (channelId) {
    try {
      var d = await fetchJSON(
        this.serverUrl + '/epg?channel_id=' + encodeURIComponent(channelId),
        null, 8000);
      return (d && Array.isArray(d.result)) ? d.result : [];
    } catch (e) { return []; }
  };

  // ── Helpers ──────────────────────────────────────────────────
  P.getStreamUrl   = function (id) { return this.serverUrl + '/stream/' + id + '/auto'; };
  P.getPlaylistUrl = function ()   { return this.serverUrl + '/playlist.m3u'; };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;
