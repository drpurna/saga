// ================================================================
// SAGA IPTV — jiotv.js v6.1 (FIXED: timeout on directConnect)
// ================================================================
'use strict';

var JioTVClient = (function () {
  var FIXED_SERVER = 'http://172.20.10.2:5001';
  var CATEGORY_MAP = { 1:'Entertainment',2:'Movies',3:'Kids',4:'Sports',5:'Lifestyle',6:'Infotainment',7:'News',8:'Music',10:'Devotional',12:'Business',13:'Weather',15:'JioDive',16:'Regional',17:'Shopping',18:'Comedy',19:'Drama' };

  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var done = false;
      var tid = setTimeout(function () { if (!done) { done=true; xhr.abort(); reject(new Error('Timeout')); } }, timeout || 12000);
      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = false;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4 || done) return;
        done = true; clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { reject(new Error('Invalid JSON')); }
        } else if (xhr.status === 0) reject(new Error('Server unreachable'));
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = function () { if (!done) { done=true; clearTimeout(tid); reject(new Error('Network error')); } };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
  }

  function JioTVClient(opts) {
    this.serverUrl = ((opts && opts.serverUrl) || FIXED_SERVER).replace(/\/+$/, '');
    this.timeout = (opts && opts.timeout > 0) ? opts.timeout : 12000;
    this.logged_in = false;
    this._cache = null;
    this._epgFailCount = 0;
  }
  var P = JioTVClient.prototype;

  JioTVClient.FIXED_SERVER = FIXED_SERVER;

  // FIXED: directConnect with internal timeout race
  JioTVClient.directConnect = async function (serverUrl) {
    var url = (serverUrl || FIXED_SERVER).replace(/\/+$/, '');
    var client = new JioTVClient({ serverUrl: url, timeout: 12000 });
    // race with 5s timeout
    var timeoutPromise = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('Connect timeout')); }, 5000); });
    var statusPromise = client.checkStatus();
    await Promise.race([statusPromise, timeoutPromise]);
    if (client.logged_in) return client;
    throw new Error('JioTV Go not reachable');
  };

  P.checkStatus = async function () {
    var result = { status: false, channelCount: 0, reason: '' };
    try {
      var d = await fetchJSON(this.serverUrl + '/channels', null, 8000);
      var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : null;
      if (list !== null) {
        this.logged_in = true;
        this._cache = list;
        result.status = true;
        result.channelCount = list.length;
      } else result.reason = (d && d.error) ? String(d.error) : 'Unexpected response';
    } catch (e) { result.reason = e.message; }
    this.logged_in = result.status;
    return result;
  };

  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var d = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = Array.isArray(d) ? d : (d && Array.isArray(d.result)) ? d.result : [];
    this._cache = list;
    return list;
  };

  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      var id = String(ch.channel_id || ch.id || '').trim();
      var name = String(ch.channel_name || ch.name || 'Unknown').trim();
      var logo = String(ch.logoUrl || ch.logo_url || ch.logo || '').trim();
      var lang = String(ch.channelLanguage || ch.language || '').trim();
      return { name: name || ('Channel ' + id), group: CATEGORY_MAP[catId] || 'Other', logo: logo, url: id ? (base + '/live/' + id + '.m3u8') : '', jioId: id, isHD: !!(ch.isHD || ch.is_hd), lang: lang, source: 'jiotv' };
    }).filter(function (ch) { return ch.jioId && ch.url; });
  };

  P.getStreamInfo = async function (channelId) {
    if (!channelId) return { url: '', isDRM: false };
    try {
      var d = await fetchJSON(this.serverUrl + '/stream/' + channelId, null, this.timeout);
      if (d && d.url) { d.isDRM = !!(d.drm_url || d.key); return d; }
    } catch (e) { console.warn('[JioTV] getStreamInfo error:', e.message); }
    return { url: this.serverUrl + '/live/' + channelId + '.m3u8', isDRM: false };
  };

  P.getNowPlaying = async function (channelId) {
    if (!channelId) return null;
    if (this._epgFailCount > 5) { this._epgFailCount = Math.max(0, this._epgFailCount - 1); return null; }
    try {
      var d = await fetchJSON(this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId), null, 6000);
      this._epgFailCount = 0;
      return (d && d.result) ? d.result : null;
    } catch (e) { this._epgFailCount++; return null; }
  };

  P.invalidateCache = function () { this._cache = null; };
  P.getStreamUrl = function (id) { return this.serverUrl + '/live/' + id + '.m3u8'; };
  P.getPlaylistUrl = function () { return this.serverUrl + '/playlist.m3u'; };

  JioTVClient.isSafeM3UURL = function (url) {
    try { var u = new URL(url); if (u.protocol !== 'http:' && u.protocol !== 'https:') return false; var h = u.hostname; if (/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.)/.test(h)) return false; if (h === 'localhost') return false; return true; } catch(e) { return false; }
  };
  return JioTVClient;
})();
if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;