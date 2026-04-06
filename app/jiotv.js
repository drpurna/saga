// ================================================================
// SAGA IPTV — jiotv.js v5.3  |  Direct connect (no probe)
// JioTV Go v3.17+ · Default IP 172.20.10.2:5001
// ================================================================
'use strict';

var JioTVClient = (function () {

  var DEFAULT_JIOTV_SERVER = 'http://172.20.10.2:5001';

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',      3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News',      8:'Music',
    10:'Devotional',   12:'Business',   13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',   18:'Comedy',   19:'Drama',
  };

  // ── XHR with abort ────────────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var ms  = (timeout > 0 ? timeout : 12000);
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
          reject(new Error('Server unreachable'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { clearTimeout(tid); reject(new Error('Network error')); };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // ── Probe (kept for discovery but not used in main flow) ──────
  function probe(baseUrl, timeout) {
    return new Promise(function (resolve) {
      if (!baseUrl || typeof baseUrl !== 'string') { resolve(false); return; }
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); resolve(false); }, timeout || 2000);
      try {
        xhr.open('GET', baseUrl + '/channels', true);
        xhr.onreadystatechange = function () {
          if (xhr.readyState !== 4) return;
          clearTimeout(tid);
          resolve(xhr.status >= 200 && xhr.status < 500);
        };
        xhr.onerror = function () { clearTimeout(tid); resolve(false); };
        xhr.send(null);
      } catch (e) { clearTimeout(tid); resolve(false); }
    });
  }

  // ── WebRTC IP sniff ───────────────────────────────────────────
  function getLocalIP() {
    return new Promise(function (resolve) {
      try {
        var pc   = new RTCPeerConnection({ iceServers: [] });
        var done = false;
        function finish(ip) { if (!done) { done = true; try { pc.close(); } catch(e){} resolve(ip); } }
        pc.createDataChannel('');
        pc.createOffer().then(function (o) { pc.setLocalDescription(o); }).catch(function() { finish(null); });
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) return;
          var m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.254.')) finish(m[1]);
        };
        setTimeout(function () { finish(null); }, 2800);
      } catch (e) { resolve(null); }
    });
  }

  // ── Subnet list ───────────────────────────────────────────────
  function buildSubnets(ip) {
    var primary = '172.20.10';
    var list    = [primary];
    if (ip) {
      var sub = ip.split('.').slice(0, 3).join('.');
      if (sub !== primary) list.push(sub);
    }
    ['172.20.9','172.20.11','172.20.0','192.168.1','192.168.0','10.0.0','10.0.1']
      .forEach(function (s) { if (list.indexOf(s) < 0) list.push(s); });
    return list;
  }

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

  async function discoverServer(savedUrl) {
    if (savedUrl && await probe(savedUrl, 2000)) return savedUrl;
    if (await probe(DEFAULT_JIOTV_SERVER, 2000)) return DEFAULT_JIOTV_SERVER;
    var localIp = await getLocalIP();
    var subnets  = buildSubnets(localIp);
    for (var s = 0; s < subnets.length; s++) {
      var found = await scanSubnet(subnets[s], 1, 200, 30, 1000);
      if (found) return found;
    }
    return null;
  }

  // ── Constructor ───────────────────────────────────────────────
  function JioTVClient(opts) {
    if (!opts || !opts.serverUrl) throw new Error('serverUrl required');
    this.serverUrl = opts.serverUrl.replace(/\/+$/, '');
    this.timeout   = (opts.timeout > 0 ? opts.timeout : 12000);
    this.logged_in = false;
    this._cache    = null;
    this._epgFailCount = 0;
  }

  var P = JioTVClient.prototype;
  JioTVClient.discover = discoverServer;
  JioTVClient.probe    = probe;
  JioTVClient.DEFAULT_SERVER = DEFAULT_JIOTV_SERVER;

  // ✅ Direct connect: skips probe, goes straight to checkStatus
  JioTVClient.directConnect = async function (serverUrl) {
    var client = new JioTVClient({ serverUrl: serverUrl, timeout: 12000 });
    var res = await client.checkStatus();
    if (res.status) return client;
    throw new Error('Connection failed: ' + res.reason);
  };

  // ── Status check ─────────────────────────────────────────────
  P.checkStatus = async function () {
    var result = { status: false, channelCount: 0, reason: '' };
    try {
      var d    = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
      if (list !== null) {
        this.logged_in = true; this._cache = list;
        result.status = true; result.channelCount = list.length;
      } else {
        result.reason = (d && d.error) ? String(d.error) : 'Unexpected response';
      }
    } catch (e) {
      result.reason = e.message;
    }
    this.logged_in = result.status;
    return result;
  };

  // ── Channels ──────────────────────────────────────────────────
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d    = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : [];
    this._cache = list; return list;
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
        name:   name || 'Channel ' + id,
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   logo,
        url:    id ? base + '/live/' + id + '.m3u8' : '',
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

  // ── EPG with exponential backoff ──────────────────────────────
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
      this._epgFailCount = 0;
      return (d && d.result) ? d.result : null;
    } catch (e) {
      this._epgFailCount++;
      return null;
    }
  };

  // ── URL validation helper (prevent SSRF) ──────────────────────
  JioTVClient.isSafeM3UURL = function (url) {
    try {
      var u = new URL(url);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
      var h = u.hostname;
      if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(h)) return false;
      if (h === 'localhost') return false;
      return true;
    } catch (e) { return false; }
  };

  P.invalidateCache = function () { this._cache = null; };
  P.getStreamUrl    = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl  = function ()   { return this.serverUrl + '/playlist.m3u'; };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;