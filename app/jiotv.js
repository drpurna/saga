// ================================================================
// SAGA IPTV — jiotv.js v5.0  |  Tizen OS9
// JioTV Go v3.17+ · IP privacy · Robust error handling
// ================================================================
'use strict';

var JioTVClient = (function () {

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',      3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News',      8:'Music',
    10:'Devotional',   12:'Business',   13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',   18:'Comedy',   19:'Drama',
  };

  // ── XHR with abort + timeout ──────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var ms  = (timeout > 0 ? timeout : 12000);
      var tid = setTimeout(function () {
        xhr.abort();
        reject(new Error('Timeout (' + ms + 'ms)'));
      }, ms);

      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      }
      xhr.withCredentials = false;

      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try   { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON response')); }
        } else if (xhr.status === 0) {
          reject(new Error('Server unreachable (CORS or offline)'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () {
        clearTimeout(tid);
        reject(new Error('Network error'));
      };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // ── Fast TCP-like probe via GET /channels ─────────────────────
  // Returns true if server is alive (any non-error HTTP status)
  function probe(baseUrl, timeout) {
    return new Promise(function (resolve) {
      if (!baseUrl) { resolve(false); return; }
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); resolve(false); }, timeout || 1500);
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
        function finish(ip) { if (!done) { done = true; pc.close(); resolve(ip); } }
        pc.createDataChannel('');
        pc.createOffer().then(function (o) { pc.setLocalDescription(o); });
        pc.onicecandidate = function (e) {
          if (!e || !e.candidate) return;
          var m = e.candidate.candidate.match(/(\d+\.\d+\.\d+\.\d+)/);
          if (m && !m[1].startsWith('127.') && !m[1].startsWith('169.254.')) {
            finish(m[1]);
          }
        };
        setTimeout(function () { finish(null); }, 2800);
      } catch (e) { resolve(null); }
    });
  }

  // ── Build ordered subnet list ─────────────────────────────────
  function buildSubnets(detectedIp) {
    var primary = '172.20.10';  // user's confirmed hotspot
    var list    = [primary];
    if (detectedIp) {
      var sub = detectedIp.split('.').slice(0, 3).join('.');
      if (sub !== primary) list.push(sub);
    }
    // Common fallbacks, added only if not already present
    ['172.20.9','172.20.11','172.20.0','192.168.1','192.168.0','10.0.0','10.0.1']
      .forEach(function (s) { if (list.indexOf(s) === -1) list.push(s); });
    return list;
  }

  // ── Parallel batch scan of one subnet ────────────────────────
  function scanSubnet(subnet, start, end, batchSize, probeMs) {
    return new Promise(function (resolve) {
      var found    = null;
      var batchIdx = 0;
      var batches  = Math.ceil((end - start + 1) / batchSize);

      function nextBatch() {
        if (found || batchIdx >= batches) { resolve(found); return; }
        var promises = [];
        var base = start + batchIdx * batchSize;
        for (var i = base; i < base + batchSize && i <= end; i++) {
          (function (host) {
            var url = 'http://' + subnet + '.' + host + ':5001';
            promises.push(
              probe(url, probeMs).then(function (ok) { return ok ? url : null; })
            );
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

  // ── Auto-discovery ────────────────────────────────────────────
  async function discoverServer(savedUrl) {
    // 1. Saved URL — quick probe
    if (savedUrl && await probe(savedUrl, 2000)) return savedUrl;
    // 2. Detect local subnet via WebRTC
    var localIp = await getLocalIP();
    var subnets  = buildSubnets(localIp);
    // 3. Scan each subnet (30 hosts/batch, 1s timeout/host)
    for (var s = 0; s < subnets.length; s++) {
      var found = await scanSubnet(subnets[s], 1, 200, 30, 1000);
      if (found) return found;
    }
    return null;
  }

  // ── Constructor ───────────────────────────────────────────────
  function JioTVClient(opts) {
    if (!opts || !opts.serverUrl) throw new Error('serverUrl required');
    this.serverUrl  = opts.serverUrl.replace(/\/+$/, '');
    this.timeout    = (opts.timeout > 0 ? opts.timeout : 12000);
    this.logged_in  = false;
    this._cache     = null;
  }

  var P = JioTVClient.prototype;
  JioTVClient.discover = discoverServer;
  JioTVClient.probe    = probe;

  // ── Login status — use /channels as truth ─────────────────────
  // JioTV Go v3.17+ removed /checkStatus; /channels returns [] when
  // not logged in and an array of channel objects when logged in.
  P.checkStatus = async function () {
    var result = { status: false, channelCount: 0, reason: '' };
    try {
      var d    = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d
               : (d && Array.isArray(d.result)) ? d.result
               : null;

      if (list !== null) {
        this.logged_in    = true;
        this._cache       = list;
        result.status       = true;
        result.channelCount = list.length;
      } else if (d && d.error) {
        result.reason = String(d.error);
      } else {
        result.reason = 'Unexpected server response';
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
    var list = Array.isArray(d) ? d
             : (d && Array.isArray(d.result)) ? d.result
             : [];
    this._cache = list;
    return list;
  };

  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      var id    = String(ch.channel_id || ch.id || '');
      var name  = String(ch.channel_name || ch.name || 'Unknown').trim();
      var logo  = ch.logoUrl || ch.logo_url || ch.logo || '';
      var lang  = String(ch.channelLanguage || ch.language || '').trim();
      return {
        name:   name,
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   logo,
        // Direct .m3u8 — works best with Shaka on Tizen
        url:    base + '/live/' + id + '.m3u8',
        jioId:  id,
        isHD:   !!(ch.isHD || ch.is_hd),
        lang:   lang,
        source: 'jiotv',
      };
    });
  };

  // ── Stream info (DRM-aware) ───────────────────────────────────
  P.getStreamInfo = async function (channelId) {
    try {
      var d = await fetchJSON(
        this.serverUrl + '/stream/' + channelId, null, this.timeout
      );
      if (d && d.url) {
        d.isDRM = !!(d.drm_url || d.key);
        return d;
      }
    } catch (e) {
      console.warn('[JioTV] getStreamInfo(' + channelId + '):', e.message);
    }
    // Fallback: direct .m3u8
    return { url: this.serverUrl + '/live/' + channelId + '.m3u8', isDRM: false };
  };

  // ── EPG ───────────────────────────────────────────────────────
  P.getNowPlaying = async function (channelId) {
    try {
      var d = await fetchJSON(
        this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId),
        null, 6000
      );
      return (d && d.result) ? d.result : null;
    } catch (e) { return null; }
  };

  // ── Helpers ───────────────────────────────────────────────────
  P.getStreamUrl   = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl = function ()   { return this.serverUrl + '/playlist.m3u'; };
  P.invalidateCache = function ()  { this._cache = null; };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;
