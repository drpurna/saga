// ================================================================
// SAGA IPTV — jiotv.js v3.0  |  Tizen OS9
// JioTV Go v3.17+ — server-auth only (OTP done on phone)
// Fixed: correct status endpoint, better error messages, robust
// channel fetch, DRM stream support
// ================================================================
'use strict';

var JioTVClient = (function () {

  // ── Category map ─────────────────────────────────────────────
  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',     3:'Kids',      4:'Sports',
    5:'Lifestyle',     6:'Infotainment',7:'News',      8:'Music',
    10:'Devotional',   12:'Business',  13:'Weather',  15:'JioDive',
    16:'Regional',     17:'Shopping',  18:'Comedy',   19:'Drama',
  };

  // ── XHR fetch helper ─────────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var ms  = timeout || 12000;
      var tid = setTimeout(function () { xhr.abort(); reject(new Error('Timeout after ' + ms + 'ms')); }, ms);

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
          catch (e) { reject(new Error('Invalid JSON from server')); }
        } else if (xhr.status === 0) {
          reject(new Error('Cannot reach server (CORS or offline)'));
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { clearTimeout(tid); reject(new Error('Network error')); };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  // ── Reachability probe (fast, no JSON parse needed) ──────────
  function probe(baseUrl, timeout) {
    return new Promise(function (resolve) {
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); resolve(false); }, timeout || 1200);
      // Use /channels — it's available on all JioTV Go versions
      xhr.open('GET', baseUrl + '/channels', true);
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        resolve(xhr.status >= 200 && xhr.status < 500); // accept any non-error status
      };
      xhr.onerror = function () { clearTimeout(tid); resolve(false); };
      xhr.send(null);
    });
  }

  // ── WebRTC local IP detection ─────────────────────────────────
  function getLocalIP() {
    return new Promise(function (resolve) {
      try {
        var pc  = new RTCPeerConnection({ iceServers: [] });
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
        setTimeout(function () { if (!done) { done = true; resolve(null); } }, 2500);
      } catch (e) { resolve(null); }
    });
  }

  // ── Build subnet scan list ────────────────────────────────────
  // 172.20.10 is always first (user's confirmed hotspot subnet)
  function buildSubnets(detectedIp) {
    var primary = '172.20.10';
    var list    = [primary];
    if (detectedIp) {
      var sub = detectedIp.split('.').slice(0, 3).join('.');
      if (sub !== primary) list.push(sub);
    }
    ['172.20.9','172.20.11','172.20.0','192.168.1','192.168.0','10.0.0','10.0.1']
      .forEach(function (s) { if (list.indexOf(s) === -1) list.push(s); });
    return list;
  }

  // ── Parallel batch subnet scan ────────────────────────────────
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

  // ── Auto-discovery ────────────────────────────────────────────
  async function discoverServer(savedUrl) {
    // 1. Try saved URL first (fast check)
    if (savedUrl) {
      var ok = await probe(savedUrl, 2000);
      if (ok) return savedUrl;
    }
    // 2. Detect local IP for subnet hint
    var localIp  = await getLocalIP();
    var subnets  = buildSubnets(localIp);
    // 3. Scan each subnet in order
    for (var s = 0; s < subnets.length; s++) {
      var found = await scanSubnet(subnets[s], 1, 200, 30, 1000);
      if (found) return found;
    }
    return null;
  }

  // ── Constructor ───────────────────────────────────────────────
  function JioTVClient(opts) {
    if (!opts || !opts.serverUrl) throw new Error('serverUrl required');
    this.serverUrl = opts.serverUrl.replace(/\/$/, '');
    this.timeout   = opts.timeout  || 12000;
    this.logged_in = false;
    this._cache    = null;
  }

  var P = JioTVClient.prototype;

  // Expose statics
  JioTVClient.discover = discoverServer;
  JioTVClient.probe    = probe;

  // ── Status check ─────────────────────────────────────────────
  // JioTV Go v3.17+ does not have a reliable /checkStatus endpoint.
  // We determine login state by whether /channels returns actual data.
  P.checkStatus = async function () {
    try {
      var d = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      // Response is either {result:[...]} or [...] depending on version
      var list = Array.isArray(d)           ? d
               : (d && Array.isArray(d.result)) ? d.result
               : null;
      // If we got any array back (even empty), server is running.
      // A non-logged-in server typically returns an error object, not an array.
      if (list !== null) {
        this.logged_in = true;
        this._cache    = list;
        return { status: true, channelCount: list.length };
      }
      // Got JSON but not an array — might be {error:...} meaning not logged in
      if (d && d.error) {
        this.logged_in = false;
        return { status: false, reason: d.error };
      }
      this.logged_in = false;
      return { status: false, reason: 'Unexpected response' };
    } catch (e) {
      this.logged_in = false;
      return { status: false, reason: e.message };
    }
  };

  // ── Channels ─────────────────────────────────────────────────
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
      var id    = String(ch.channel_id || ch.id || '');
      var name  = String(ch.channel_name || ch.name || 'Unknown');
      var logo  = ch.logoUrl || ch.logo_url || ch.logo || '';
      return {
        name:   name,
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   logo,
        url:    base + '/stream/' + id + '/auto',
        jioId:  id,
        isHD:   !!(ch.isHD || ch.is_hd),
        source: 'jiotv',
      };
    });
  };

  // ── Stream info (DRM-aware) ───────────────────────────────────
  P.getStreamInfo = async function (channelId) {
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) {
        d.isDRM = !!(d.drm_url || d.key);
        return d;
      }
    } catch (e) {
      console.warn('[JioTV] getStreamInfo failed:', e.message);
    }
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
