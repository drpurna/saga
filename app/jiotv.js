// ================================================================
// SAGA IPTV — jiotv.js v1.0
// JioTV Go API integration (self-hosted server by rabilrbl)
// https://github.com/rabilrbl/jiotv_go
// ================================================================

'use strict';

var JioTVClient = (function () {

  var CATEGORY_MAP = {
    1:'Entertainment', 2:'Movies',  3:'Kids',    4:'Sports',
    5:'Lifestyle',     6:'Infotainment', 7:'News', 8:'Music',
    10:'Devotional',   12:'Business', 13:'Weather', 15:'JioDive',
  };

  // ── Fetch helper ─────────────────────────────────────────────
  function fetchJSON(url, opts, timeout) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      var tid = setTimeout(function () { xhr.abort(); reject(new Error('Timeout')); }, timeout || 12000);
      xhr.open((opts && opts.method) || 'GET', url, true);
      xhr.setRequestHeader('Accept', 'application/json');
      if (opts && opts.body) xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.withCredentials = true;
      xhr.onreadystatechange = function () {
        if (xhr.readyState !== 4) return;
        clearTimeout(tid);
        if (xhr.status >= 200 && xhr.status < 400) {
          try { resolve(JSON.parse(xhr.responseText)); }
          catch (e) { reject(new Error('Invalid JSON')); }
        } else {
          reject(new Error('HTTP ' + xhr.status));
        }
      };
      xhr.onerror = function () { clearTimeout(tid); reject(new Error('Network error')); };
      xhr.send(opts && opts.body ? JSON.stringify(opts.body) : null);
    });
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

  // ── Auth ────────────────────────────────────────────────────
  P.login = async function (username, password) {
    var data = await fetchJSON(this.serverUrl + '/login', {
      method: 'POST', body: { username: username, password: password }
    }, this.timeout);
    if (data && (data.status === true || data.status === 'true')) {
      this.logged_in = true; return data;
    }
    throw new Error(data && data.message ? data.message : 'Login failed');
  };

  P.checkStatus = async function () {
    try {
      var data = await fetchJSON(this.serverUrl + '/checkStatus', null, this.timeout);
      this.logged_in = !!(data && (data.status === true || data.status === 'true'));
    } catch (e) { this.logged_in = false; }
    return this.logged_in;
  };

  P.logout = async function () {
    try { await fetchJSON(this.serverUrl + '/logout', null, this.timeout); } catch (e) {}
    this.logged_in = false;
  };

  // ── Channels ────────────────────────────────────────────────
  // GET /channels → { code:200, result:[...] }
  P.getChannels = async function (force) {
    if (this._cache && !force) return this._cache;
    var data = await fetchJSON(this.serverUrl + '/channels', null, this.timeout);
    var list = (data && Array.isArray(data.result)) ? data.result
             : Array.isArray(data) ? data : [];
    this._cache = list;
    return list;
  };

  // Returns SAGA-format channel objects
  P.getChannelsFormatted = async function () {
    var list = await this.getChannels(true);
    var base = this.serverUrl;
    return list.map(function (ch) {
      var catId = ch.channelCategoryId || ch.category_id || 0;
      return {
        name:   String(ch.name || ch.channel_name || 'Unknown'),
        group:  CATEGORY_MAP[catId] || 'Other',
        logo:   ch.logoUrl || ch.logo_url || ch.logo || '',
        url:    base + '/play/' + ch.id + '/auto',
        jioId:  ch.id,
        isHD:   !!(ch.isHD || ch.is_hd),
        source: 'jiotv',
      };
    });
  };

  // ── EPG ─────────────────────────────────────────────────────
  // GET /epg/now?channel_id=XXX
  P.getNowPlaying = async function (channelId) {
    var data = await fetchJSON(
      this.serverUrl + '/epg/now?channel_id=' + encodeURIComponent(channelId),
      null, this.timeout);
    return (data && data.result) ? data.result : null;
  };

  // GET /epg/all?channel_id=XXX  (full schedule)
  P.getSchedule = async function (channelId) {
    var data = await fetchJSON(
      this.serverUrl + '/epg/all?channel_id=' + encodeURIComponent(channelId),
      null, this.timeout);
    return (data && Array.isArray(data.result)) ? data.result : [];
  };

  // ── Helpers ─────────────────────────────────────────────────
  P.getStreamUrl  = function (channelId, q) { return this.serverUrl + '/play/' + channelId + '/' + (q || 'auto'); };
  P.getPlaylistUrl= function ()             { return this.serverUrl + '/playlist.m3u'; };

  return JioTVClient;
})();

if (typeof window !== 'undefined') window.JioTVClient = JioTVClient;
