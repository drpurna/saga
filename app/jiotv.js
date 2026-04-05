// ================================================================
// SAGA IPTV — jiotv.js v4.0  |  Tizen OS9
// JioTV Go v3.17+ — server-auth only (OTP done on phone)
// IP privacy: server URL stored locally, never displayed after connect
// ================================================================
'use strict';

var JioTVClient = (function () {

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',      3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News',      8:'Music',
    10:'Devotional',   12:'Business',   13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',   18:'Comedy',   19:'Drama',
  };

  // ── XHR helper ───────────────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var ms  = timeout || 12000;
      var tid = setTimeout(function () { xhr.abort(); reject(new Error('Timeout')); }, ms);
      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try   { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        } else if (xhr.status === 0) {
          reject(new Error('Cannot reach server'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { clearTimeout(tid); reject(new Error('Network error')); };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // ── Fast probe (no JSON needed) ──────────────────────────────
  function probe(baseUrl, timeout) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); resolve(false); }, timeout || 1500);
      xhr.open('GET', baseUrl + '/channels', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        resolve(xhr.status >= 200 && xhr.status < 500);
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
        var done = false;
        pc.createDataChannel('');
        pc.createOffer().then(function (o) { pc.setLocalDescription(o); });
        pc.onicecandidate = function (e) {
          if (done || !e || !e.candidate) return;
          var m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.')) {
            done = true; pc.close(); resolve(m[1]);
          }
        };
        setTimeout(function () { if (!done) resolve(null); }, 2500);
      } catch (e) { resolve(null); }
    });
  }

  // ── Subnet list ──────────────────────────────────────────────
  function buildSubnets(ip) {
    var primary = '172.20.10';
    var list = [primary];
    if (ip) {
      var sub = ip.split('.').slice(0, 3).join('.');
      if (sub !== primary) list.push(sub);
    }
    ['172.20.9','172.20.11','172.20.0','192.168.1','192.168.0','10.0.0','10.0.1']
      .forEach(function (s) { if (list.indexOf(s) === -1) list.push(s); });
    return list;
  }

  // ── Parallel batch scan ──────────────────────────────────────
  function scanSubnet(subnet, start, end, batch, ms) {
    return new Promise(function (resolve) {
      var found = null, idx = 0, total = Math.ceil((end - start + 1) / batch);
      function next() {
        if (found || idx >= total) { resolve(found); return; }
        var promises = [], base = start + idx * batch;
        for (var i = base; i < base + batch && i <= end; i++) {
          (function (host) {
            var url = 'http://' + subnet + '.' + host + ':5001';
            promises.push(probe(url, ms).then(function (ok) { return ok ? url : null; }));
          })(i);
        }
        idx++;
        Promise.all(promises).then(function (res) {
          for (var j = 0; j < res.length; j++) if (res[j]) { found = res[j]; resolve(found); return; }
          next();
        });
      }
      next();
    });
  }

  // ── Auto-discovery ───────────────────────────────────────────
  async function discoverServer(savedUrl) {
    if (savedUrl && await probe(savedUrl, 2000)) return savedUrl;
    var localIp = await getLocalIP();
    var subnets = buildSubnets(localIp);
    for (var s = 0; s < subnets.length; s++) {
      var found = await scanSubnet(subnets[s], 1, 200, 30, 1000);
      if (found) return found;
    }
    return null;
  }

  // ── Constructor ──────────────────────────────────────────────
  function JioTVClient(opts) {
    if (!opts || !opts.serverUrl) throw new Error('serverUrl required');
    this.serverUrl = opts.serverUrl.replace(/\/$/, '');
    this.timeout   = opts.timeout  || 12000;
    this.logged_in = false;
    this._cache    = null;
  }

  var P = JioTVClient.prototype;
  JioTVClient.discover = discoverServer;
  JioTVClient.probe    = probe;

  // ── Status — uses /channels as truth (v3.17+ has no /status) ─
  P.checkStatus = async function () {
    try {
      var d = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
      if (list !== null) { this.logged_in = true; this._cache = list; return { status: true, channelCount: list.length }; }
      if (d && d.error) { this.logged_in = false; return { status: false, reason: d.error }; }
      this.logged_in = false; return { status: false, reason: 'Unexpected response' };
    } catch (e) { this.logged_in = false; return { status: false, reason: e.message }; }
  };

  // ── Channels ─────────────────────────────────────────────────
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : [];
    this._cache = list; return list;
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
        url:    base + '/live/' + id + '.m3u8',    // direct .m3u8 for Tizen
        jioId:  id,
        isHD:   !!(ch.isHD || ch.is_hd),
        lang:   ch.channelLanguage || ch.language || '',
        source: 'jiotv',
      };
    });
  };

  // ── Stream info ──────────────────────────────────────────────
  P.getStreamInfo = async function (channelId) {
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) { d.isDRM = !!(d.drm_url || d.key); return d; }
    } catch (e) {}
    return { url: this.serverUrl + '/live/' + channelId + '.m3u8', isDRM: false };
  };

  // ── EPG ──────────────────────────────────────────────────────
  P.getNowPlaying = async function (channelId) {
    try {
      var d = await fetchJSON(this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId), null, 6000);
      return (d && d.result) ? d.result : null;
    } catch (e) { return null; }
  };

  P.getStreamUrl   = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl = function ()   { return this.serverUrl + '/playlist.m3u'; };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;
