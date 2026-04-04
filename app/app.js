// ================================================================
// SAGA IPTV — app.js v26.0  |  Samsung Tizen OS9
// 55-inch TV optimised · Remote-first · JioTV Go fixed
// All elements navigable via Samsung BN59-01199F remote
// ================================================================
'use strict';

// ── Constants ────────────────────────────────────────────────────
const FAV_KEY              = 'iptv:favs';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const AV_SYNC_KEY          = 'iptv:avSync';
const JIOTV_SERVER_KEY     = 'jiotv:server';
const PREVIEW_DELAY        = 600;

const DEFAULT_PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

// ── Samsung BN59-01199F key codes ────────────────────────────────
const KEY = {
  UP:38, DOWN:40, LEFT:37, RIGHT:39, ENTER:13,
  BACK:10009, EXIT:10182,
  INFO:457, GUIDE:458,
  PLAY:415, PAUSE:19, PLAY_PAUSE:10252,
  STOP:413, FF:417, RW:412,
  CH_UP:427, CH_DOWN:428,
  PAGE_UP:33, PAGE_DOWN:34,
  RED:403, GREEN:404, YELLOW:405, BLUE:406,
  VOL_UP:447, VOL_DOWN:448, MUTE:449,
};

// ── Tab index helpers ─────────────────────────────────────────────
function TAB_FAV()   { return allPlaylists.length; }
function TAB_JIOTV() { return allPlaylists.length + 1; }
function TAB_TOTAL() { return allPlaylists.length + 2; }

// ── Virtual scroll constants — must match CSS --item-h / --item-gap
const VS_IH  = 108;   // matches --item-h: 108px
const VS_GAP =   8;   // matches --item-gap: 8px

// ── State ─────────────────────────────────────────────────────────
let allPlaylists    = [];
let customPlaylists = [];
let plIdx           = 0;

let channels    = [];
let allChannels = [];
let filtered    = [];
let selectedIndex = 0;

// focusArea: 'list' | 'tabs' | 'search' | 'addBtn' | 'avLeft' | 'avRight'
let focusArea   = 'list';
let tabFocusIdx = 0;

let isFullscreen = false;
let hasPlayed    = false;

let player         = null;
let currentPlayUrl = '';

let previewTimer   = null;
let fsHintTimer    = null;
let loadBarTimer   = null;

let dialBuffer = '';
let dialTimer  = null;

let favSet     = new Set();
let avSyncOffset = 0;
let avSyncLabel  = null;

let overlaysVisible = false;
let networkQuality  = 'online';
let connectionMonitor = null;

let stallWatchdog   = null;
let lastPlayTime    = 0;
let reconnectCount  = 0;
const MAX_RECONNECT = 5;

let sleepTimer   = null;
let sleepMinutes = 0;

let epgInterval  = null;
var  toastTm     = null;

// JioTV
let jiotvClient = null;
let jiotvMode   = false;

// AV sync constants
const AV_SYNC_STEP = 50;
const AV_SYNC_MAX  = 500;

// ── DOM refs ──────────────────────────────────────────────────────
const $  = id => document.getElementById(id);

const searchInput        = $('searchInput');
const searchWrap         = $('searchWrap');
const searchClear        = $('searchClear');
const tabBar             = $('tabBar');
const channelListEl      = $('channelList');
const countBadge         = $('countBadge');
const listLabel          = $('listLabel');
const nowPlayingEl       = $('nowPlaying');
const npChNumEl          = $('npChNum');
const statusBadge        = $('statusBadge');
const video              = $('video');
const videoWrap          = $('videoWrap');
const videoOverlay       = $('videoOverlay');
const fsHint             = $('fsHint');
const loadBar            = $('loadBar');
const chDialer           = $('chDialer');
const chDialerNum        = $('chDialerNum');
const addPlaylistBtn     = $('addPlaylistBtn');
const playlistModal      = $('addPlaylistModal');
const playlistNameEl     = $('playlistName');
const playlistUrlEl      = $('playlistUrl');
const savePlaylistBtn    = $('savePlaylistBtn');
const cancelPlaylistBtn  = $('cancelPlaylistBtn');
const overlayTop         = $('overlayTop');
const overlayBottom      = $('overlayBottom');
const overlayChannelName = $('overlayChannelName');
const overlayChannelTech = $('overlayChannelTech');
const overlayProgramTitle= $('overlayProgramTitle');
const overlayProgramDesc = $('overlayProgramDesc');
const nextProgramInfo    = $('nextProgramInfo');
const programInfoBox     = $('programInfoBox');
const toastEl            = $('toast');

// JioTV Modal
const jiotvModal      = $('jiotvLoginModal');
const jiotvServerUrl  = $('jiotvServerUrl');
const jiotvConnectBtn = $('jiotvConnectBtn');
const jiotvCancelBtn  = $('jiotvCancelBtn');
const jiotvScanBtn    = $('jiotvScanBtn');
const jiotvLoginStatus= $('jiotvLoginStatus');
const jiotvAccountInfo= $('jiotvAccountInfo');

// ── localStorage helpers ──────────────────────────────────────────
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
function lsGet(k)    { try { return localStorage.getItem(k); } catch (e) { return null; } }

// ── Favourites ────────────────────────────────────────────────────
(function () {
  try { var r = lsGet(FAV_KEY); if (r) favSet = new Set(JSON.parse(r)); } catch (e) {}
})();
function saveFavs()  { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)   { return favSet.has(ch.url); }
function toggleFav(ch) {
  if (favSet.has(ch.url)) favSet.delete(ch.url); else favSet.add(ch.url);
  saveFavs();
  if (plIdx === TAB_FAV()) showFavourites();
  else VS.rebuildVisible();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(c => favSet.has(c.url));
  selectedIndex = 0; renderList();
  setLbl('FAVOURITES', filtered.length);
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, dur) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(() => { toastEl.style.opacity = '0'; }, dur || 2800);
}

// ── Status / load bar ─────────────────────────────────────────────
function setStatus(t, c) {
  statusBadge.textContent = t;
  statusBadge.className   = 'status-badge ' + (c || 'idle');
}
function setLbl(label, count) {
  if (listLabel) listLabel.textContent = count !== undefined ? label + ' · ' + count : label;
}
function startLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '0%';
  loadBar.classList.add('active');
  var w = 0;
  var tick = function () {
    w = Math.min(w + Math.random() * 9, 85);
    loadBar.style.width = w + '%';
    if (w < 85) loadBarTimer = setTimeout(tick, 200);
  };
  loadBarTimer = setTimeout(tick, 80);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '100%';
  setTimeout(() => { loadBar.classList.remove('active'); loadBar.style.width = '0%'; }, 440);
}
function refreshLbl() {
  if      (jiotvMode)              setLbl('JIOTV', channels.length);
  else if (plIdx === TAB_FAV())    setLbl('FAVOURITES', filtered.length);
  else                             setLbl('CHANNELS', channels.length);
}

// ── M3U parser ────────────────────────────────────────────────────
function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*\([^)]*\)/g, '').replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi, '')
    .replace(/[\|\-–—]+\s*$/g, '').replace(/\s{2,}/g, ' ').replace(/>/g, '').trim();
}
function parseM3U(text) {
  var lines = String(text || '').split(/\r?\n/), out = [], meta = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      var np = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      var gm = line.match(/group-title="([^"]+)"/i);
      var lm = line.match(/tvg-logo="([^"]+)"/i);
      meta = { name: cleanName(np) || np, group: gm ? gm[1] : 'Other', logo: lm ? lm[1] : '' };
    } else if (!line.startsWith('#') && meta) {
      out.push({ name: meta.name, group: meta.group, logo: meta.logo, url: line });
      meta = null;
    }
  }
  return out;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Channel tech info ─────────────────────────────────────────────
function updateChannelTech() {
  if (!player || !overlayChannelTech) return;
  try {
    var s  = player.getStats ? player.getStats() : null;
    var tr = player.getVariantTracks ? player.getVariantTracks() : [];
    var vt = tr.find(t => t.active);
    var parts = [];
    var w  = vt ? (vt.width  || 0) : 0;
    var h  = vt ? (vt.height || 0) : 0;
    var bw = s  ? (s.streamBandwidth || 0) : 0;
    var fps   = vt ? (vt.frameRate   || 0) : 0;
    var codec = vt ? (vt.videoCodec  || '') : '';
    if (w && h)  parts.push(w + '×' + h);
    if (bw)      parts.push((bw / 1e6).toFixed(1) + ' Mbps');
    if (fps)     parts.push(Math.round(fps) + ' fps');
    if (codec)   parts.push(codec);
    overlayChannelTech.textContent = parts.join(' · ');
  } catch (e) {}
}

// ── AV Sync ───────────────────────────────────────────────────────
function loadAvSync() {
  var v = parseInt(lsGet(AV_SYNC_KEY) || '0', 10);
  avSyncOffset = isNaN(v) ? 0 : Math.max(-AV_SYNC_MAX, Math.min(AV_SYNC_MAX, v));
}
function saveAvSync() { lsSet(AV_SYNC_KEY, String(avSyncOffset)); }
function applyAvSync() {
  if (!video || !hasPlayed || avSyncOffset === 0) return;
  try {
    if (video.readyState >= 2) {
      var t = video.currentTime - (avSyncOffset / 1000);
      if (t >= 0) video.currentTime = t;
    }
  } catch (e) {}
  updateAvSyncLabel();
}
function adjustAvSync(sign) {
  avSyncOffset = Math.max(-AV_SYNC_MAX, Math.min(AV_SYNC_MAX, avSyncOffset + sign * AV_SYNC_STEP));
  saveAvSync(); applyAvSync();
  showToast('AV Sync: ' + (avSyncOffset === 0 ? '0 ms' : (avSyncOffset > 0 ? '+' : '') + avSyncOffset + ' ms'));
  updateAvSyncLabel();
}
function resetAvSync() {
  avSyncOffset = 0; saveAvSync(); updateAvSyncLabel();
  showToast('AV Sync: 0');
}
function updateAvSyncLabel() {
  if (!avSyncLabel) return;
  avSyncLabel.textContent = avSyncOffset === 0 ? 'AV: 0' : 'AV: ' + (avSyncOffset > 0 ? '+' : '') + avSyncOffset + 'ms';
  avSyncLabel.style.color = avSyncOffset === 0 ? 'var(--text-muted)' : 'var(--gold)';
}
function buildAvSyncBar() {
  var ctrl = document.querySelector('.player-controls');
  if (!ctrl) return;
  var wrap = document.createElement('div');
  wrap.id = 'avSyncWrap';

  var bM = document.createElement('button');
  bM.className = 'av-btn';
  bM.id = 'avBtnLeft';
  bM.textContent = '◁ Audio';
  bM.addEventListener('click', () => adjustAvSync(-1));

  avSyncLabel = document.createElement('span');
  avSyncLabel.className = 'av-label';
  avSyncLabel.addEventListener('click', resetAvSync);
  updateAvSyncLabel();

  var bP = document.createElement('button');
  bP.className = 'av-btn';
  bP.id = 'avBtnRight';
  bP.textContent = 'Audio ▷';
  bP.addEventListener('click', () => adjustAvSync(+1));

  wrap.appendChild(bM);
  wrap.appendChild(avSyncLabel);
  wrap.appendChild(bP);
  ctrl.insertBefore(wrap, ctrl.firstChild);
}

// ── Sleep timer ───────────────────────────────────────────────────
function setSleepTimer(m) {
  clearSleepTimer(); sleepMinutes = m;
  if (!m) { showToast('Sleep timer: Off'); return; }
  showToast('Sleep timer: ' + m + ' min');
  sleepTimer = setTimeout(() => {
    video.pause();
    if (player) player.unload();
    stopStallWatchdog();
    setStatus('Sleep — stopped', 'idle');
    showToast('Goodnight! Stopped.', 4000);
    sleepTimer = null; sleepMinutes = 0;
  }, m * 60000);
}
function clearSleepTimer() { if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; } }

// ── Stall watchdog ────────────────────────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog(); reconnectCount = 0; lastPlayTime = Date.now();
  stallWatchdog = setInterval(() => {
    if (video.paused || !hasPlayed || !currentPlayUrl) return;
    if (Date.now() - lastPlayTime > 9000) {
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        setStatus('Reconnecting (' + reconnectCount + '/' + MAX_RECONNECT + ')…', 'loading');
        startLoadBar();
        doPlay(currentPlayUrl).then(() => { reconnectCount = 0; }).catch(() => {});
      } else {
        setStatus('Stream lost', 'error'); stopStallWatchdog();
      }
      lastPlayTime = Date.now();
    }
  }, 4000);
}
function stopStallWatchdog() { if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; } }
video.addEventListener('timeupdate', () => { if (!video.paused) lastPlayTime = Date.now(); });

// ══════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL — GPU compositing, node pooling
// VS_IH must equal CSS --item-h  (108px)
// VS_GAP must equal CSS --item-gap (8px)
// ══════════════════════════════════════════════════════════════════
var VS = {
  IH: VS_IH, GAP: VS_GAP, OS: 4,
  c: null, inner: null, vh: 0, st: 0, total: 0,
  pool: [], nodes: {}, raf: null,

  init: function (el) {
    this.c = el; el.innerHTML = '';
    this.inner = document.createElement('ul');
    this.inner.id = 'vsInner';
    this.inner.style.cssText = 'position:relative;width:100%;margin:0;padding:0;list-style:none;';
    el.appendChild(this.inner);
    this.vh = el.clientHeight || 900;
    el.addEventListener('scroll', () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => { this.raf = null; this.st = this.c.scrollTop; this.paint(); });
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(() => { this.vh = this.c.clientHeight || 900; this.paint(); }).observe(el);
    }
  },

  setData: function (n) {
    this.total = n;
    for (var k in this.nodes) {
      var nd = this.nodes[k]; nd.style.display = 'none'; nd._i = -1; this.pool.push(nd);
    }
    this.nodes = {};
    this.inner.style.height = n > 0 ? (n * (this.IH + this.GAP) - this.GAP + 20) + 'px' : '0';
    this.c.scrollTop = 0; this.st = 0; this.vh = this.c.clientHeight || 900;
    this.paint();
  },

  scrollTo: function (idx) {
    var top = idx * (this.IH + this.GAP);
    var bot = top + this.IH;
    var pad = 24;
    if      (top < this.st + pad)              this.c.scrollTop = Math.max(0, top - pad);
    else if (bot > this.st + this.vh - pad)    this.c.scrollTop = bot - this.vh + pad;
    this.st = this.c.scrollTop; this.paint();
  },

  centerOn: function (idx) {
    this.c.scrollTop = Math.max(0, idx * (this.IH + this.GAP) - (this.vh / 2) + (this.IH / 2));
    this.st = this.c.scrollTop; this.paint();
  },

  paint: function () {
    if (!this.total) return;
    var H  = this.IH + this.GAP;
    var os = this.OS;
    var s  = Math.max(0, Math.floor(this.st / H) - os);
    var e  = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);

    // Recycle out-of-range nodes
    for (var oi in this.nodes) {
      var ii = parseInt(oi, 10);
      if (ii < s || ii > e) {
        var nd = this.nodes[oi]; nd.style.display = 'none'; nd._i = -1;
        this.pool.push(nd); delete this.nodes[oi];
      }
    }
    // Build in-range nodes
    for (var i = s; i <= e; i++) {
      if (this.nodes[i]) continue;
      var li = this.pool.pop() || this.mkNode();
      this.build(li, i);
      if (!li.parentNode) this.inner.appendChild(li);
      li.style.display = ''; this.nodes[i] = li;
    }
    // Sync active class
    for (var j in this.nodes) {
      var n  = this.nodes[j];
      var on = (parseInt(j, 10) === selectedIndex);
      if (on !== n._on) { n._on = on; n.classList.toggle('active', on); }
    }
  },

  mkNode: function () {
    var li = document.createElement('li'); li._i = -1; li._on = false;
    li.style.cssText = 'position:absolute;will-change:transform;transform:translateZ(0);backface-visibility:hidden;';
    this.inner.appendChild(li);
    li.addEventListener('click', () => {
      if (li._i < 0) return;
      selectedIndex = li._i; VS.refresh(); cancelPreview(); schedulePreview();
    });
    return li;
  },

  build: function (li, i) {
    li._i = i; li._on = false;
    var top = i * (this.IH + this.GAP) + 10;
    li.style.cssText = [
      'position:absolute', 'left:12px', 'right:12px', 'top:' + top + 'px', 'height:' + this.IH + 'px',
      'display:flex', 'align-items:center', 'gap:16px', 'padding:0 18px',
      'border-radius:18px', 'overflow:hidden',
      'will-change:transform', 'transform:translateZ(0)', 'backface-visibility:hidden',
    ].join(';');

    var ch  = filtered[i];
    var PH  = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";
    li.innerHTML =
      '<div class="ch-logo"><img src="' + esc(ch.logo || PH) + '" onerror="this.onerror=null;this.src=\'' + PH + '\'" loading="lazy"></div>' +
      '<div class="ch-info"><div class="ch-name">' + esc(ch.name) + '</div></div>' +
      (isFav(ch) ? '<div class="ch-fav">★</div>' : '') +
      '<div class="ch-num">' + (i + 1) + '</div>';

    if (i === selectedIndex) { li._on = true; li.classList.add('active'); }
    else li.classList.remove('active');
  },

  refresh: function () {
    for (var j in this.nodes) {
      var n  = this.nodes[j];
      var on = (parseInt(j, 10) === selectedIndex);
      if (on !== n._on) { n._on = on; n.classList.toggle('active', on); }
    }
  },
  rebuildVisible: function () {
    for (var j in this.nodes) this.build(this.nodes[j], parseInt(j, 10));
  },
};

// ── Render list ───────────────────────────────────────────────────
function renderList() {
  if (countBadge) countBadge.textContent = String(filtered.length);
  VS.setData(filtered.length);
  if (filtered.length) VS.scrollTo(selectedIndex);
}

// ── Search ────────────────────────────────────────────────────────
var sdTm = null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm = setTimeout(() => {
    var q = searchInput.value.trim().toLowerCase();
    filtered = !q
      ? channels.slice()
      : channels.filter(c => c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
    selectedIndex = 0; renderList();
    if (q) setLbl('SEARCH', filtered.length); else refreshLbl();
  }, 120);
}
function commitSearch() {
  setFocus('list');
  if (filtered.length === 1) { selectedIndex = 0; VS.refresh(); schedulePreview(); }
}
function clearSearch() {
  searchInput.value = '';
  searchWrap.classList.remove('active');
  applySearch();
  setFocus('list');
}
searchInput.addEventListener('input', () => {
  searchWrap.classList.toggle('active', searchInput.value.length > 0);
  applySearch();
});
if (searchClear) searchClear.addEventListener('click', clearSearch);

// ── XHR fetch + CDN mirror ────────────────────────────────────────
function xhrFetch(url, ms, cb) {
  var done = false, xhr = new XMLHttpRequest();
  var tid = setTimeout(() => { if (done) return; done = true; xhr.abort(); cb(new Error('Timeout'), null); }, ms);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4 || done) return;
    done = true; clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };
  xhr.onerror = () => { if (done) return; done = true; clearTimeout(tid); cb(new Error('Network error'), null); };
  xhr.open('GET', url, true); xhr.send();
}
function mirrorUrl(url) {
  try {
    var u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    var p = u.pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    return 'https://cdn.jsdelivr.net/gh/' + p[0] + '/' + p[1] + '@' + p[2] + '/' + p.slice(3).join('/');
  } catch (e) { return null; }
}

// ── M3U playlist loading ──────────────────────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();
  var rawUrl = urlOv || (plIdx < allPlaylists.length ? allPlaylists[plIdx].url : null);
  if (!rawUrl) return;

  var ck  = 'plCache:' + rawUrl;
  var ctk = 'plCacheTime:' + rawUrl;
  try {
    var cached = lsGet(ck), ct = parseInt(lsGet(ctk) || '0', 10);
    if (cached && cached.length > 100 && (Date.now() - ct) < 600000) {
      onLoaded(cached, true); return;
    }
  } catch (e) {}

  setStatus('Loading…', 'loading'); startLoadBar();
  xhrFetch(rawUrl, 30000, (err, text) => {
    if (!err && text && text.length > 100) { persist(text); finishLoadBar(); onLoaded(text, false); return; }
    var mirror = mirrorUrl(rawUrl);
    if (mirror) {
      setStatus('Retrying mirror…', 'loading');
      xhrFetch(mirror, 30000, (e2, t2) => {
        finishLoadBar();
        if (!e2 && t2 && t2.length > 100) { persist(t2); onLoaded(t2, false); }
        else setStatus('Failed — check network', 'error');
      });
    } else { finishLoadBar(); setStatus('Failed', 'error'); }
  });

  function persist(t) { try { lsSet(ck, t); lsSet(ctk, String(Date.now())); } catch (e) {} }
  function onLoaded(t, fromCache) {
    channels = parseM3U(t); allChannels = channels.slice(); filtered = channels.slice();
    selectedIndex = 0; renderList(); refreshLbl();
    lsSet('iptv:lastM3uIndex', String(plIdx));
    setStatus('Ready · ' + channels.length + ' ch' + (fromCache ? ' (cached)' : ''), 'idle');
    setFocus('list');
  }
}

// ── Network monitor ───────────────────────────────────────────────
function updateNetworkIndicator() {
  var el = $('networkIndicator'); if (!el) return;
  el.className = 'network-indicator';
  if (!navigator.onLine) {
    networkQuality = 'offline'; el.classList.add('offline'); el.title = 'Offline';
  } else if (navigator.connection && navigator.connection.downlink) {
    var sp = navigator.connection.downlink;
    if (sp < 1) { networkQuality = 'slow'; el.classList.add('slow'); el.title = 'Slow · ' + sp.toFixed(1) + ' Mbps'; }
    else         { networkQuality = 'online'; el.classList.add('online'); el.title = 'Online · ' + sp.toFixed(1) + ' Mbps'; }
  } else { networkQuality = 'online'; el.classList.add('online'); el.title = 'Online'; }
  if (player) player.configure({ streaming: { bufferingGoal: networkQuality === 'slow' ? 5 : 12, rebufferingGoal: networkQuality === 'slow' ? 1 : 2 } });
}
function startNetworkMonitoring() {
  updateNetworkIndicator();
  if (navigator.connection) navigator.connection.addEventListener('change', updateNetworkIndicator);
  window.addEventListener('online',  updateNetworkIndicator);
  window.addEventListener('offline', updateNetworkIndicator);
  connectionMonitor = setInterval(updateNetworkIndicator, 10000);
}

// ── Clock ─────────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var ts  = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var ds  = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
  var c = $('brandClock'), te = $('currentTime'), de = $('currentDate');
  if (c)  c.textContent  = ts;
  if (te) te.textContent = ts;
  if (de) de.textContent = ds;
}
setInterval(updateClock, 1000); updateClock();

// ── Shaka init ────────────────────────────────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) { console.error('[SAGA] Shaka unsupported'); return; }
  player = new shaka.Player(video);
  player.configure({
    streaming: {
      bufferingGoal: 12, rebufferingGoal: 2, bufferBehind: 20,
      stallEnabled: true, stallThreshold: 1, stallSkip: 0.1,
      autoCorrectDrift: true, gapDetectionThreshold: 0.5, gapPadding: 0.1,
      durationBackoff: 1,
      retryParameters: { maxAttempts: 6, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 30000 },
    },
    abr: { enabled: true, defaultBandwidthEstimate: 500000, switchInterval: 8, bandwidthUpgradeTarget: 0.85, bandwidthDowngradeTarget: 0.95 },
    manifest: { retryParameters: { maxAttempts: 5, baseDelay: 1000, backoffFactor: 2 } },
    drm: {
      retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 15000 },
      advanced: { 'com.widevine.alpha': { videoRobustness: 'HW_SECURE_ALL', audioRobustness: 'HW_SECURE_CRYPTO' } },
    },
  });
  player.addEventListener('error', ev => {
    var err  = ev.detail, code = err && err.code;
    var msg  = code >= 6000 && code <= 6999 ? 'DRM error'
             : code >= 7000 && code <= 7999 ? 'Network error' : 'Stream error';
    console.error('[SAGA] Shaka error', code, err && err.message);
    setStatus(msg, 'error'); finishLoadBar();
  });
  player.addEventListener('buffering', ev => {
    if (ev.buffering) { setStatus('Buffering…', 'loading'); startLoadBar(); }
    else              { setStatus('Playing',    'playing');  finishLoadBar(); }
  });
  player.addEventListener('adaptation',     updateChannelTech);
  player.addEventListener('variantchanged',  updateChannelTech);
}

// ── DRM config builder ────────────────────────────────────────────
function buildDrmConfig(info) {
  if (!info || !info.isDRM) return null;
  var cfg = { servers: {} };
  if (info.drm_url) {
    cfg.servers['com.widevine.alpha'] = info.drm_url;
    cfg.advanced = { 'com.widevine.alpha': { videoRobustness: 'HW_SECURE_ALL', audioRobustness: 'HW_SECURE_CRYPTO' } };
  } else if (info.key && info.iv) {
    cfg.servers['org.w3.clearkey'] = '';
    cfg.clearKeys = {};
    var kid = info.key_id || info.kid || info.key;
    cfg.clearKeys[kid] = info.key;
  }
  return Object.keys(cfg.servers).length ? cfg : null;
}

// ── Play ──────────────────────────────────────────────────────────
var _currentStreamInfo = null;
async function doPlay(url, streamInfo) {
  if (!url) return;
  currentPlayUrl = url; reconnectCount = 0; _currentStreamInfo = streamInfo || null;
  if (!player) await initShaka();
  if (!player) return;

  var drmCfg = streamInfo ? buildDrmConfig(streamInfo) : null;
  try {
    await player.unload(); video.removeAttribute('src');
    if (drmCfg) { player.configure({ drm: drmCfg }); console.log('[SAGA] DRM', Object.keys(drmCfg.servers)); }
    else         { player.configure({ drm: { servers: {} } }); }
    await player.load(url);
    await video.play().catch(() => {});
    updateChannelTech();
    if (avSyncOffset !== 0) setTimeout(applyAvSync, 1500);
    startStallWatchdog();
  } catch (err) {
    console.warn('[SAGA] doPlay err:', err.message);
    // Fallback 1: try .m3u8 if .ts was given
    if (url.endsWith('.ts')) {
      try {
        var m3u = url.replace(/\.ts$/, '.m3u8');
        await player.unload(); await player.load(m3u);
        await video.play().catch(() => {}); currentPlayUrl = m3u;
        updateChannelTech(); startStallWatchdog(); return;
      } catch (e2) {}
    }
    // Fallback 2: native video src (non-DRM streams)
    if (!drmCfg) {
      try {
        await player.unload(); video.src = url; video.load();
        await video.play().catch(() => {}); startStallWatchdog(); return;
      } catch (e3) {}
    }
    setStatus('Play error', 'error'); finishLoadBar(); stopStallWatchdog();
  }
}

// ── Preview ───────────────────────────────────────────────────────
function cancelPreview()   { clearTimeout(previewTimer); previewTimer = null; }
function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(() => { previewTimer = null; startPreview(selectedIndex); }, PREVIEW_DELAY);
}
async function startPreview(idx) {
  if (!filtered.length) return;
  var ch = filtered[idx]; if (!ch) return;

  if (overlayTop && overlayBottom && overlaysVisible) {
    overlayTop.classList.remove('info-visible');
    overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  }
  nowPlayingEl.textContent = ch.name;
  if (overlayChannelName) overlayChannelName.textContent = ch.name;
  if (npChNumEl)          npChNumEl.textContent = 'CH ' + (idx + 1);
  if (!jiotvMode) {
    if (overlayProgramTitle) overlayProgramTitle.textContent = '';
    if (overlayProgramDesc)  overlayProgramDesc.textContent  = '';
    if (nextProgramInfo)     nextProgramInfo.textContent     = '';
    if (programInfoBox)      programInfoBox.style.display    = 'none';
  }
  videoOverlay.classList.add('hidden');
  hasPlayed = true; setStatus('Buffering…', 'loading'); startLoadBar();

  if (jiotvMode && ch.jioId && jiotvClient) {
    try {
      var info    = await jiotvClient.getStreamInfo(ch.jioId);
      var playUrl = info && info.url ? info.url : ch.url;
      await doPlay(playUrl, info);
      setTimeout(() => updateJioEpg(ch.jioId), 800);
    } catch (e) {
      await doPlay(ch.url, null);
    }
  } else {
    await doPlay(ch.url, null);
  }
}
function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ──────────────────────────────────────────────────
video.addEventListener('playing', () => { setStatus('Playing', 'playing'); finishLoadBar(); updateChannelTech(); });
video.addEventListener('pause',   () => { setStatus('Paused',  'paused');  });
video.addEventListener('waiting', () => { setStatus('Buffering…', 'loading'); startLoadBar(); });
video.addEventListener('stalled', () => { setStatus('Buffering…', 'loading'); });
video.addEventListener('error',   () => { setStatus('Error',   'error');   finishLoadBar(); });
video.addEventListener('ended',   () => { setStatus('Ended',   'idle');    stopStallWatchdog(); });

// ── Fullscreen ────────────────────────────────────────────────────
function showFsHint() {
  clearTimeout(fsHintTimer); fsHint.classList.add('visible');
  fsHintTimer = setTimeout(() => fsHint.classList.remove('visible'), 3200);
}
function applyExitFSState() {
  document.body.classList.remove('fullscreen'); isFullscreen = false; fsHint.classList.remove('visible');
}
function enterFS() {
  var fn = videoWrap.requestFullscreen || videoWrap.webkitRequestFullscreen || videoWrap.mozRequestFullScreen;
  if (fn) try { fn.call(videoWrap); } catch (e) {}
  document.body.classList.add('fullscreen'); isFullscreen = true;
  if (overlayTop)    overlayTop.classList.remove('info-visible');
  if (overlayBottom) overlayBottom.classList.remove('info-visible');
  overlaysVisible = false; showFsHint();
}
function exitFS() {
  var fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (fn) try { fn.call(document); } catch (e) {}
  applyExitFSState();
}
function toggleFS() { if (isFullscreen) exitFS(); else enterFS(); }
function onFsChange() { var f = !!(document.fullscreenElement || document.webkitFullscreenElement); if (!f && isFullscreen) applyExitFSState(); }
document.addEventListener('fullscreenchange',        onFsChange);
document.addEventListener('webkitfullscreenchange',  onFsChange);
video.addEventListener('dblclick', toggleFS);

// ── Info overlays ─────────────────────────────────────────────────
function toggleOverlays() {
  if (!overlayTop || !overlayBottom) return;
  if (overlaysVisible) {
    overlayTop.classList.remove('info-visible'); overlayBottom.classList.remove('info-visible'); overlaysVisible = false;
  } else {
    overlayTop.classList.add('info-visible');    overlayBottom.classList.add('info-visible');    overlaysVisible = true;
  }
}

// ── Channel dialer ────────────────────────────────────────────────
function commitChannelNumber() {
  var num = parseInt(dialBuffer, 10); dialBuffer = ''; chDialer.classList.remove('visible');
  if (!filtered.length || isNaN(num) || num < 1) return;
  var idx = Math.min(filtered.length - 1, num - 1);
  cancelPreview(); selectedIndex = idx; VS.centerOn(idx); VS.refresh(); playSelected();
  showToast('CH ' + (idx + 1) + ' · ' + filtered[idx].name);
}
function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d; chDialerNum.textContent = dialBuffer; chDialer.classList.add('visible');
  dialTimer = setTimeout(() => { dialTimer = null; commitChannelNumber(); }, dialBuffer.length >= 3 ? 400 : 1500);
}
function getDigit(e) {
  var c = e.keyCode;
  if (c >= 48 && c <= 57)  return String(c - 48);
  if (c >= 96 && c <= 105) return String(c - 96);
  if (e.key && e.key.length === 1 && e.key >= '0' && e.key <= '9') return e.key;
  return null;
}

// ── Focus management ──────────────────────────────────────────────
function setFocus(a) {
  focusArea = a;
  tabBar.classList.toggle('tab-bar-focused', a === 'tabs');

  if (a === 'search') { searchWrap.classList.add('active'); searchInput.focus(); }
  else                { searchWrap.classList.remove('active'); if (document.activeElement === searchInput) searchInput.blur(); }

  // AV button highlighting
  var avL = $('avBtnLeft'), avR = $('avBtnRight');
  if (avL) avL.classList.toggle('focused', a === 'avLeft');
  if (avR) avR.classList.toggle('focused', a === 'avRight');

  if (a === 'addBtn') { if (addPlaylistBtn) addPlaylistBtn.classList.add('focused'); }
  else                { if (addPlaylistBtn) addPlaylistBtn.classList.remove('focused'); }

  if (a === 'tabs') syncTabHighlight(); else clearTabHighlight();
}

function syncTabHighlight() {
  tabBar.querySelectorAll('.tab').forEach((b, i) => b.classList.toggle('kbd-focus', i === tabFocusIdx));
}
function clearTabHighlight() {
  tabBar.querySelectorAll('.tab').forEach(b => b.classList.remove('kbd-focus'));
}

// ── Navigation helpers ────────────────────────────────────────────
function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview(); clearTimeout(dialTimer); dialTimer = null; dialBuffer = ''; chDialer.classList.remove('visible');
  selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + d));
  VS.scrollTo(selectedIndex); VS.refresh(); schedulePreview();
}
function moveTabFocus(d) {
  var total = TAB_TOTAL();
  tabFocusIdx = ((tabFocusIdx + d) % total + total) % total;
  syncTabHighlight();
  var btns = tabBar.querySelectorAll('.tab');
  if (btns[tabFocusIdx]) btns[tabFocusIdx].scrollIntoView({ inline: 'nearest', block: 'nearest' });
}
function activateFocusedTab() { switchTab(tabFocusIdx); setFocus('list'); }

// ── Tizen key registration ────────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
        'ChannelUp','ChannelDown',
        'Back','Info','Guide','0','1','2','3','4','5','6','7','8','9',
        'VolumeUp','VolumeDown','Mute','Exit','Return','PreCh',
      ].forEach(k => { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
    }
  } catch (e) {}
}

// ═══════════════════════════════════════════════════════════════════
// MASTER KEY HANDLER
// ═══════════════════════════════════════════════════════════════════
window.addEventListener('keydown', function (e) {
  var k  = e.key;
  var kc = e.keyCode;

  // ── Modal open: constrained nav ───────────────────────────────
  var anyModal = (playlistModal && playlistModal.style.display === 'flex') ||
                 (jiotvModal    && jiotvModal.style.display    === 'flex');
  if (anyModal) {
    if (k === 'Escape' || k === 'Back' || kc === KEY.BACK || kc === KEY.EXIT || kc === 27) {
      closeAllModals(); e.preventDefault(); return;
    }
    if (k === 'Enter' || kc === KEY.ENTER) {
      if (jiotvModal    && jiotvModal.style.display    === 'flex') { jiotvConnectAction(); e.preventDefault(); return; }
      if (playlistModal && playlistModal.style.display === 'flex') { handleSavePlaylist(); e.preventDefault(); return; }
      var focused = document.activeElement;
      if (focused && focused.tagName === 'BUTTON') { focused.click(); e.preventDefault(); return; }
    }
    // Allow Tab to cycle focus within modal
    if (k === 'Tab') return;
    return;
  }

  // ── Digit — channel dialer ────────────────────────────────────
  var dig = getDigit(e);
  if (dig !== null && focusArea !== 'search' && focusArea !== 'tabs') {
    handleDigit(dig); e.preventDefault(); return;
  }

  // ── Dialer visible ────────────────────────────────────────────
  if (chDialer.classList.contains('visible')) {
    if (kc === KEY.ENTER || k === 'Enter') { clearTimeout(dialTimer); dialTimer = null; commitChannelNumber(); e.preventDefault(); return; }
    if (k === 'Back' || k === 'Escape' || kc === KEY.BACK || kc === 27) { clearTimeout(dialTimer); dialTimer = null; dialBuffer = ''; chDialer.classList.remove('visible'); e.preventDefault(); return; }
  }

  // ── Back / Escape ─────────────────────────────────────────────
  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || kc === KEY.BACK || kc === 27) {
    if (isFullscreen)          { exitFS();      e.preventDefault(); return; }
    if (focusArea === 'tabs')  { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search'){ clearSearch(); e.preventDefault(); return; }
    if (focusArea === 'avLeft' || focusArea === 'avRight') { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'addBtn'){ setFocus('list'); e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e2) {}
    e.preventDefault(); return;
  }

  // ── Info / Guide ──────────────────────────────────────────────
  if (k === 'Info' || kc === KEY.INFO || k === 'Guide' || kc === KEY.GUIDE) {
    toggleOverlays(); e.preventDefault(); return;
  }

  // ── TABS focus area ───────────────────────────────────────────
  if (focusArea === 'tabs') {
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { moveTabFocus(-1);        e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT) { moveTabFocus(+1);        e.preventDefault(); return; }
    if (k === 'Enter'      || kc === KEY.ENTER) { activateFocusedTab();    e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { setFocus('list');        e.preventDefault(); return; }
    if (k === 'ArrowUp'    || kc === KEY.UP)    { e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── SEARCH focus area ─────────────────────────────────────────
  if (focusArea === 'search') {
    if (k === 'Enter' || kc === KEY.ENTER)                                          { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || kc === KEY.DOWN || kc === KEY.UP)   { commitSearch(); e.preventDefault(); return; }
    return; // let keyboard type into input
  }

  // ── AV SYNC focus areas ───────────────────────────────────────
  if (focusArea === 'avLeft') {
    if (k === 'Enter' || kc === KEY.ENTER)    { adjustAvSync(-1); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT){ setFocus('avRight'); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT) { setFocus('list');   e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN) { setFocus('list');   e.preventDefault(); return; }
    e.preventDefault(); return;
  }
  if (focusArea === 'avRight') {
    if (k === 'Enter' || kc === KEY.ENTER)   { adjustAvSync(+1); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT){ setFocus('avLeft'); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT){ setFocus('list');  e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN){ setFocus('list');  e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── ADD BUTTON focus ──────────────────────────────────────────
  if (focusArea === 'addBtn') {
    if (k === 'Enter' || kc === KEY.ENTER)    { openAddPlaylistModal(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || kc === KEY.DOWN) { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowLeft' || kc === KEY.LEFT) { setFocus('tabs'); e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── LIST focus area (default) ─────────────────────────────────
  if (k === 'ArrowUp'   || kc === KEY.UP)   { if (isFullscreen) showFsHint(); else moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || kc === KEY.DOWN) { if (isFullscreen) showFsHint(); else moveSel(+1); e.preventDefault(); return; }

  if (k === 'ArrowLeft' || kc === KEY.LEFT) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    tabFocusIdx = plIdx; setFocus('tabs'); e.preventDefault(); return;
  }
  if (k === 'ArrowRight' || kc === KEY.RIGHT) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    // Right from list → focus AV sync left button (if player bar visible)
    if ($('avBtnLeft') && !isFullscreen) { setFocus('avLeft'); e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  if (k === 'Enter' || kc === KEY.ENTER) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(() => { if (hasPlayed) enterFS(); }, 700);
    }
    e.preventDefault(); return;
  }

  if (k === 'PageUp'   || kc === KEY.PAGE_UP)   { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown' || kc === KEY.PAGE_DOWN)  { moveSel(+10); e.preventDefault(); return; }

  // Media keys
  if (k === 'MediaPlayPause' || kc === KEY.PLAY_PAUSE) { if (video.paused) video.play().catch(() => {}); else video.pause(); e.preventDefault(); return; }
  if (k === 'MediaPlay'      || kc === KEY.PLAY)        { video.play().catch(() => {});  e.preventDefault(); return; }
  if (k === 'MediaPause'     || kc === KEY.PAUSE)       { video.pause();                 e.preventDefault(); return; }
  if (k === 'MediaStop'      || kc === KEY.STOP) {
    cancelPreview(); if (player) player.unload(); stopStallWatchdog(); clearSleepTimer();
    video.pause(); video.removeAttribute('src'); setStatus('Stopped', 'idle'); finishLoadBar();
    e.preventDefault(); return;
  }
  if (k === 'MediaFastForward' || kc === KEY.FF    || k === 'ChannelUp'   || kc === KEY.CH_UP)   { moveSel(+1); e.preventDefault(); return; }
  if (k === 'MediaRewind'      || kc === KEY.RW    || k === 'ChannelDown' || kc === KEY.CH_DOWN)  { moveSel(-1); e.preventDefault(); return; }

  // Color buttons
  if (k === 'ColorF0Red'    || kc === KEY.RED)    { switchTab((plIdx + 1) % TAB_TOTAL()); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || kc === KEY.GREEN)  { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || kc === KEY.YELLOW) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || kc === KEY.BLUE)   { if (hasPlayed) toggleFS(); e.preventDefault(); return; }

  // Volume
  if (k === 'VolumeUp'   || kc === KEY.VOL_UP)   { video.volume = Math.min(1, video.volume + 0.05); e.preventDefault(); return; }
  if (k === 'VolumeDown' || kc === KEY.VOL_DOWN)  { video.volume = Math.max(0, video.volume - 0.05); e.preventDefault(); return; }
  if (k === 'Mute'       || kc === KEY.MUTE)      { video.muted  = !video.muted;                     e.preventDefault(); return; }
});

// Tizen HW back key
document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') {
    if (isFullscreen) { exitFS(); return; }
    var anyModal = (playlistModal && playlistModal.style.display === 'flex') ||
                   (jiotvModal    && jiotvModal.style.display    === 'flex');
    if (anyModal) { closeAllModals(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (ex) {}
  }
});

// ── Modal helpers ─────────────────────────────────────────────────
function closeAllModals() {
  if (playlistModal) playlistModal.style.display = 'none';
  if (jiotvModal)    jiotvModal.style.display    = 'none';
  setFocus('list');
}

function openAddPlaylistModal() {
  if (playlistNameEl) playlistNameEl.value = '';
  if (playlistUrlEl)  playlistUrlEl.value  = '';
  playlistModal.style.display = 'flex';
  setTimeout(() => { if (playlistNameEl) playlistNameEl.focus(); }, 120);
}
function handleSavePlaylist() {
  var name = (playlistNameEl ? playlistNameEl.value.trim() : '');
  var url  = (playlistUrlEl  ? playlistUrlEl.value.trim()  : '');
  if (!name || !url) { showToast('Please enter both name and URL'); return; }
  if (addCustomPlaylist(name, url)) { showToast('"' + name + '" added'); playlistModal.style.display = 'none'; }
  else showToast('Already exists or invalid URL');
}

// ── Playlist management ───────────────────────────────────────────
function loadCustomPlaylists() { try { var s = lsGet(CUSTOM_PLAYLISTS_KEY); customPlaylists = s ? JSON.parse(s) : []; } catch (e) { customPlaylists = []; } }
function saveCustomPlaylists() { lsSet(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists)); }
function addCustomPlaylist(name, url) {
  if (!name || !url) return false;
  if (customPlaylists.some(p => p.url.toLowerCase() === url.toLowerCase())) return false;
  customPlaylists.push({ name, url }); saveCustomPlaylists(); rebuildAllPlaylists(); return true;
}
function rebuildAllPlaylists() {
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);
  if (plIdx >= TAB_FAV()) plIdx = 0;
  rebuildTabs(); loadPlaylist();
}

// ── Tab builder ───────────────────────────────────────────────────
function rebuildTabs() {
  tabBar.innerHTML = '';

  allPlaylists.forEach((pl, i) => {
    var btn = document.createElement('button');
    btn.className = 'tab';
    if (!jiotvMode && i === plIdx) btn.classList.add('active');
    btn.textContent = pl.name;
    btn.dataset.tabIdx = String(i);
    btn.addEventListener('click', () => switchTab(i));
    tabBar.appendChild(btn);
  });

  var fBtn = document.createElement('button');
  fBtn.className = 'tab fav-tab';
  fBtn.dataset.tabIdx = String(TAB_FAV());
  if (!jiotvMode && plIdx === TAB_FAV()) fBtn.classList.add('active');
  fBtn.textContent = '★ Favs';
  fBtn.addEventListener('click', () => switchTab(TAB_FAV()));
  tabBar.appendChild(fBtn);

  var jBtn = document.createElement('button');
  jBtn.className = 'tab jiotv-tab';
  jBtn.dataset.tabIdx = String(TAB_JIOTV());
  if (jiotvMode) jBtn.classList.add('active');
  jBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="opacity:0.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg> JioTV';
  jBtn.addEventListener('click', () => switchTab(TAB_JIOTV()));
  tabBar.appendChild(jBtn);

  if (focusArea === 'tabs') syncTabHighlight();
}

function switchTab(idx) {
  var tFav = TAB_FAV(), tJ = TAB_JIOTV();
  if (idx < tFav) {
    jiotvMode = false; plIdx = idx;
    rebuildTabs(); loadPlaylist(); saveMode();
  } else if (idx === tFav) {
    jiotvMode = false; plIdx = tFav;
    rebuildTabs(); showFavourites(); saveMode();
  } else if (idx === tJ) {
    if (jiotvClient && jiotvClient.logged_in) {
      jiotvMode = true; plIdx = tJ;
      rebuildTabs(); loadJioChannels(); saveMode();
    } else {
      openJioLogin();
    }
  }
  setFocus('list');
}

// ── JioTV ─────────────────────────────────────────────────────────

function setJioStatus(msg, color) {
  if (!jiotvLoginStatus) return;
  jiotvLoginStatus.textContent = msg;
  jiotvLoginStatus.style.color = color || 'var(--text-sec)';
}

function openJioLogin() {
  var saved = lsGet(JIOTV_SERVER_KEY) || '';
  if (jiotvServerUrl) jiotvServerUrl.value = saved;
  setJioStatus('', '');
  if (jiotvAccountInfo) jiotvAccountInfo.textContent = '';
  if (jiotvModal) jiotvModal.style.display = 'flex';
  setTimeout(() => { if (jiotvServerUrl) jiotvServerUrl.focus(); }, 120);

  // Auto-scan if no saved server
  if (!saved) {
    setJioStatus('🔍 Scanning 172.20.10.1–200 for JioTV Go…', 'var(--gold)');
    JioTVClient.discover(null).then(found => {
      if (found && jiotvServerUrl && !jiotvServerUrl.value) {
        jiotvServerUrl.value = found;
        setJioStatus('✅ Found: ' + found, 'var(--green)');
      } else if (!found) {
        setJioStatus('⚠️ Not found. Enter URL manually.', 'var(--red)');
      }
    });
  }
}

// Connect to JioTV Go — no credentials needed, server handles OTP auth
async function jiotvConnectAction() {
  var sv = (jiotvServerUrl ? jiotvServerUrl.value.trim() : '');
  if (!sv) { setJioStatus('Server URL required', 'var(--red)'); return; }

  // Normalise URL
  if (!sv.startsWith('http')) sv = 'http://' + sv;
  if (jiotvServerUrl) jiotvServerUrl.value = sv;

  if (jiotvConnectBtn) jiotvConnectBtn.disabled = true;
  setJioStatus('Connecting…', 'var(--gold)');

  try {
    var c = new JioTVClient({ serverUrl: sv, timeout: 12000 });

    // 1. Check if server is reachable
    var alive = await JioTVClient.probe(sv, 4000);
    if (!alive) {
      setJioStatus('❌ Cannot reach server. Check URL and ensure JioTV Go is running.', 'var(--red)');
      if (jiotvConnectBtn) jiotvConnectBtn.disabled = false;
      return;
    }

    // 2. Check login status via /channels
    setJioStatus('Server found. Checking login status…', 'var(--gold)');
    var statusResult = await c.checkStatus();

    if (!statusResult.status) {
      // Server is running but user hasn't logged in on the phone
      var hostname = sv.replace(/https?:\/\//, '').split(':')[0];
      setJioStatus(
        '⚠️ Server running but not logged in. Open http://' + hostname + ':5001 in your phone browser and login via OTP first, then try again.',
        'var(--gold)'
      );
      if (jiotvConnectBtn) jiotvConnectBtn.disabled = false;
      return;
    }

    // 3. Success — load channels
    jiotvClient = c;
    jiotvClient.logged_in = true;
    jiotvMode = true;
    lsSet(JIOTV_SERVER_KEY, sv);

    if (jiotvAccountInfo) jiotvAccountInfo.textContent = '✅ Connected · ' + statusResult.channelCount + ' channels found';
    setJioStatus('Loading channels…', 'var(--gold)');

    plIdx = TAB_JIOTV(); rebuildTabs();
    await loadJioChannels();

    if (jiotvModal) jiotvModal.style.display = 'none';
    showToast('JioTV connected! ' + statusResult.channelCount + ' ch');
    saveMode();
  } catch (err) {
    setJioStatus('Failed: ' + err.message, 'var(--red)');
    console.error('[JioTV] connect error:', err);
  } finally {
    if (jiotvConnectBtn) jiotvConnectBtn.disabled = false;
  }
}

async function loadJioChannels() {
  if (!jiotvClient) return;
  setStatus('Loading JioTV…', 'loading'); startLoadBar();
  try {
    var list = await jiotvClient.getChannelsFormatted();
    channels = list; allChannels = list.slice(); filtered = list.slice(); selectedIndex = 0;
    renderList(); setLbl('JIOTV', list.length); setStatus('JioTV · ' + list.length + ' ch', 'playing'); finishLoadBar();
  } catch (err) {
    setStatus('JioTV load failed', 'error'); finishLoadBar();
    console.error('[JioTV] loadChannels:', err);
  }
}

// Auto-reconnect saved JioTV on boot
async function loadSavedJiotv() {
  var sv = lsGet(JIOTV_SERVER_KEY);
  if (!sv) return false;

  try {
    // Fast probe first
    var alive = await JioTVClient.probe(sv, 3000);
    if (!alive) {
      // Server might have moved — scan LAN
      showToast('JioTV: scanning LAN…');
      var found = await JioTVClient.discover(sv);
      if (found) { lsSet(JIOTV_SERVER_KEY, found); sv = found; }
      else return false;
    }

    var c   = new JioTVClient({ serverUrl: sv, timeout: 10000 });
    var res = await c.checkStatus();
    if (res.status) {
      jiotvClient = c; jiotvClient.logged_in = true; jiotvMode = true;
      plIdx = TAB_JIOTV(); rebuildTabs(); await loadJioChannels();
      showToast('JioTV reconnected'); saveMode(); return true;
    }
  } catch (e) { console.warn('[JioTV] loadSaved:', e.message); }
  return false;
}

async function updateJioEpg(channelId) {
  if (!jiotvMode || !jiotvClient || !channelId) return;
  try {
    var ep = await jiotvClient.getNowPlaying(channelId);
    if (ep && overlayProgramTitle) {
      overlayProgramTitle.textContent = ep.title || ep.showname || '';
      if (overlayProgramDesc) overlayProgramDesc.textContent = ep.description || '';
      if (programInfoBox)     programInfoBox.style.display   = '';
    }
  } catch (e) {}
}

// ── EPG updater ───────────────────────────────────────────────────
function startEpgUpdater() {
  if (epgInterval) clearInterval(epgInterval);
  epgInterval = setInterval(() => {
    if (video.paused) return;
    if (jiotvMode) { var ch = filtered[selectedIndex]; if (ch && ch.jioId) updateJioEpg(ch.jioId); }
  }, 30000);
}
function stopEpgUpdater() { if (epgInterval) { clearInterval(epgInterval); epgInterval = null; } }
video.addEventListener('playing', startEpgUpdater);
video.addEventListener('pause',   stopEpgUpdater);
video.addEventListener('ended',   stopEpgUpdater);

// ── Mode save / restore ───────────────────────────────────────────
function saveMode() {
  if (jiotvMode) lsSet('iptv:mode', 'jiotv');
  else          { lsSet('iptv:mode', 'm3u'); lsSet('iptv:lastM3uIndex', String(plIdx)); }
}
async function loadMode() {
  var mode = lsGet('iptv:mode');
  if (mode === 'jiotv') {
    var ok = await loadSavedJiotv();
    if (!ok) { jiotvMode = false; fallbackM3u(); }
  } else {
    fallbackM3u();
  }
}
function fallbackM3u() {
  var si = parseInt(lsGet('iptv:lastM3uIndex') || '0', 10);
  plIdx = (!isNaN(si) && si < allPlaylists.length) ? si : 0;
  rebuildTabs(); loadPlaylist();
}

// ── Boot ──────────────────────────────────────────────────────────
(async function init() {
  registerKeys();
  loadAvSync();
  loadCustomPlaylists();
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);

  VS.init(channelListEl);
  await initShaka();
  buildAvSyncBar();
  startNetworkMonitoring();
  await loadMode();

  // Clear overlays on boot
  if (overlayTop)    overlayTop.classList.remove('info-visible');
  if (overlayBottom) overlayBottom.classList.remove('info-visible');
  overlaysVisible = false;

  // ── Playlist modal events ─────────────────────────────────────
  if (addPlaylistBtn)    addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if (savePlaylistBtn)   savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if (cancelPlaylistBtn) cancelPlaylistBtn.addEventListener('click', () => { playlistModal.style.display = 'none'; setFocus('list'); });
  if (playlistModal)     playlistModal.addEventListener('click', e => { if (e.target === playlistModal) { playlistModal.style.display = 'none'; setFocus('list'); } });
  [playlistNameEl, playlistUrlEl].forEach(el => {
    if (el) el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.keyCode === 13) handleSavePlaylist(); });
  });

  // ── JioTV modal events ────────────────────────────────────────
  if (jiotvConnectBtn) jiotvConnectBtn.addEventListener('click', jiotvConnectAction);
  if (jiotvCancelBtn)  jiotvCancelBtn.addEventListener('click',  () => { closeAllModals(); });
  if (jiotvModal)      jiotvModal.addEventListener('click', e => { if (e.target === jiotvModal) closeAllModals(); });
  if (jiotvServerUrl)  jiotvServerUrl.addEventListener('keydown', e => { if (e.key === 'Enter' || e.keyCode === 13) jiotvConnectAction(); });

  if (jiotvScanBtn) {
    jiotvScanBtn.addEventListener('click', () => {
      setJioStatus('🔍 Scanning 172.20.10.1–200…', 'var(--gold)');
      jiotvScanBtn.disabled = true;
      JioTVClient.discover(null).then(found => {
        jiotvScanBtn.disabled = false;
        if (found) {
          if (jiotvServerUrl) jiotvServerUrl.value = found;
          setJioStatus('✅ Found: ' + found, 'var(--green)');
        } else {
          setJioStatus('❌ Not found. Enter URL manually.', 'var(--red)');
        }
      });
    });
  }
})();
