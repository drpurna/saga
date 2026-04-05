// ================================================================
// SAGA IPTV — app.js v28.0  |  Samsung Tizen OS9
// 55-inch TV · JioTV Grid Portal · Crash-safe · Premium UX
// ================================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────
var FAV_KEY              = 'iptv:favs';
var CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
var AV_SYNC_KEY          = 'iptv:avSync';
var JIOTV_SERVER_KEY     = 'jiotv:server';
var PREVIEW_DELAY        = 500;
var VS_IH                = 108;   // MUST match CSS --item-h
var VS_GAP               = 8;     // MUST match CSS --item-gap
var AV_SYNC_STEP         = 50;
var AV_SYNC_MAX          = 500;
var MAX_RECONNECT        = 5;
var STALL_TIMEOUT        = 9000;
var OVERLAY_AUTO_HIDE    = 4000;
var M3U_CACHE_TTL        = 10 * 60 * 1000;

// ── Samsung BN59-01199F remote key codes ──────────────────────────
var KEY = {
  UP:38, DOWN:40, LEFT:37, RIGHT:39, ENTER:13,
  BACK:10009, EXIT:10182, INFO:457, GUIDE:458,
  PLAY:415, PAUSE:19, PLAY_PAUSE:10252,
  STOP:413, FF:417, RW:412,
  CH_UP:427, CH_DOWN:428, PAGE_UP:33, PAGE_DOWN:34,
  RED:403, GREEN:404, YELLOW:405, BLUE:406,
  VOL_UP:447, VOL_DOWN:448, MUTE:449,
};

// ── Tab index helpers ──────────────────────────────────────────────
function TAB_FAV()   { return allPlaylists.length; }
function TAB_JIOTV() { return allPlaylists.length + 1; }
function TAB_TOTAL() { return allPlaylists.length + 2; }

// ── Default playlists ──────────────────────────────────────────────
var DEFAULT_PLAYLISTS = [
  { name:'Telugu', url:'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name:'India',  url:'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

// ── App state ──────────────────────────────────────────────────────
var allPlaylists = [], customPlaylists = [], plIdx = 0;
var channels = [], allChannels = [], filtered = [];
var selectedIndex = 0;
var focusArea  = 'list';  // 'list'|'tabs'|'search'|'addBtn'|'avLeft'|'avRight'
var tabFocusIdx = 0;
var isFullscreen = false, hasPlayed = false;
var player = null, currentPlayUrl = '';
var _playerBusy = false;  // guard against concurrent load calls
var previewTimer = null, fsHintTimer = null, loadBarTimer = null;
var dialBuffer = '', dialTimer = null;
var favSet = new Set();
var avSyncOffset = 0, avSyncLabel = null;
var overlaysVisible = false;
var networkQuality = 'online', connectionMonitor = null;
var stallWatchdog = null, lastPlayTime = 0, reconnectCount = 0;
var sleepTimer = null, sleepMinutes = 0;
var toastTm = null;

// JioTV portal state
var jiotvClient   = null;
var jiotvMode     = false;
var jiotvChannels = [];
var jpActiveChannel = null;
var jpPlayer        = null;
var _jpPlayerBusy   = false;
var jpOverlayTimer  = null;
var jpFocusRow = 0, jpFocusCol = 0, jpGridCols = 8;
var jpFiltered = [];
var jpActiveCat  = 'all', jpActiveLang = 'all', jpSearchQ = '';
var jpInPlayer   = false;
var jpEpgTimer   = null;

// ── DOM helpers ────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls)  e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

// Cached refs — all guarded; null if element missing
var Dom = {
  searchInput:    $('searchInput'),
  searchWrap:     $('searchWrap'),
  searchClear:    $('searchClear'),
  tabBar:         $('tabBar'),
  channelList:    $('channelList'),
  countBadge:     $('countBadge'),
  listLabel:      $('listLabel'),
  nowPlaying:     $('nowPlaying'),
  npChNum:        $('npChNum'),
  statusBadge:    $('statusBadge'),
  video:          $('video'),
  videoWrap:      $('videoWrap'),
  videoOverlay:   $('videoOverlay'),
  fsHint:         $('fsHint'),
  loadBar:        $('loadBar'),
  chDialer:       $('chDialer'),
  chDialerNum:    $('chDialerNum'),
  addPlaylistBtn: $('addPlaylistBtn'),
  playlistModal:  $('addPlaylistModal'),
  playlistName:   $('playlistName'),
  playlistUrl:    $('playlistUrl'),
  savePlaylistBtn:    $('savePlaylistBtn'),
  cancelPlaylistBtn:  $('cancelPlaylistBtn'),
  overlayTop:         $('overlayTop'),
  overlayBottom:      $('overlayBottom'),
  overlayChName:      $('overlayChannelName'),
  overlayChTech:      $('overlayChannelTech'),
  overlayProgTitle:   $('overlayProgramTitle'),
  overlayProgDesc:    $('overlayProgramDesc'),
  nextProgInfo:       $('nextProgramInfo'),
  programInfoBox:     $('programInfoBox'),
  toast:          $('toast'),
  // JioTV modal
  jiotvModal:     $('jiotvLoginModal'),
  jiotvServer:    $('jiotvServerUrl'),
  jiotvConnect:   $('jiotvConnectBtn'),
  jiotvCancel:    $('jiotvCancelBtn'),
  jiotvScan:      $('jiotvScanBtn'),
  jiotvStatus:    $('jiotvLoginStatus'),
  jiotvAccount:   $('jiotvAccountInfo'),
  // Portal
  appMain:        $('appMain'),
  portal:         $('jiotvPortal'),
  jpGrid:         $('jpGrid'),
  jpFilters:      $('jpFilters'),
  jpLangFilters:  $('jpLangFilters'),
  jpSearchEl:     $('jpSearch'),
  jpCount:        $('jpCount'),
  jpNowBar:       $('jpNowBar'),
  jpNbThumb:      $('jpNbThumb'),
  jpNbName:       $('jpNbName'),
  jpNbEpg:        $('jpNbEpg'),
  jpNbTech:       $('jpNbTech'),
  jpPlayerLayer:  $('jpPlayerLayer'),
  jpPlayerOvl:    $('jpPlayerOverlay'),
  jpVideo:        $('jpVideo'),
  jpPlBack:       $('jpPlBack'),
  jpPlTitle:      $('jpPlTitle'),
  jpPlTime:       $('jpPlTime'),
  jpPlSpinner:    $('jpPlSpinner'),
  jpPlProg:       $('jpPlProg'),
  jpPlDesc:       $('jpPlDesc'),
  jpPlTech:       $('jpPlTech'),
  jpExitBtn:      $('jpExitBtn'),
  jpClock:        $('jpClock'),
};

// ── Safe localStorage ──────────────────────────────────────────────
function lsSet(k, v) {
  try { localStorage.setItem(k, v); return true; }
  catch (e) { return false; }
}
function lsGet(k) {
  try { return localStorage.getItem(k); }
  catch (e) { return null; }
}
function lsRemove(k) {
  try { localStorage.removeItem(k); }
  catch (e) {}
}

// ── Favourites ─────────────────────────────────────────────────────
(function initFavs() {
  try {
    var raw = lsGet(FAV_KEY);
    if (raw) favSet = new Set(JSON.parse(raw));
  } catch (e) { favSet = new Set(); }
})();

function saveFavs() { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)  { return ch && ch.url && favSet.has(ch.url); }
function toggleFav(ch) {
  if (!ch || !ch.url) return;
  if (favSet.has(ch.url)) favSet.delete(ch.url); else favSet.add(ch.url);
  saveFavs();
  if (plIdx === TAB_FAV()) showFavourites();
  else VS.rebuildVisible();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(function (c) { return favSet.has(c.url); });
  selectedIndex = 0;
  renderList();
  setLbl('FAVOURITES', filtered.length);
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, dur) {
  if (!Dom.toast) return;
  Dom.toast.textContent = msg;
  Dom.toast.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(function () { Dom.toast.style.opacity = '0'; }, dur || 2800);
}

// ── Status / load bar ──────────────────────────────────────────────
function setStatus(t, c) {
  if (!Dom.statusBadge) return;
  Dom.statusBadge.textContent = t;
  Dom.statusBadge.className   = 'status-badge ' + (c || 'idle');
}
function setLbl(label, count) {
  if (Dom.listLabel)
    Dom.listLabel.textContent = count !== undefined ? label + ' · ' + count : label;
}
function startLoadBar() {
  clearTimeout(loadBarTimer);
  if (!Dom.loadBar) return;
  Dom.loadBar.style.width = '0%';
  Dom.loadBar.classList.add('active');
  var w = 0;
  var tick = function () {
    w = Math.min(w + Math.random() * 9, 85);
    Dom.loadBar.style.width = w + '%';
    if (w < 85) loadBarTimer = setTimeout(tick, 200);
  };
  loadBarTimer = setTimeout(tick, 80);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer);
  if (!Dom.loadBar) return;
  Dom.loadBar.style.width = '100%';
  setTimeout(function () {
    Dom.loadBar.classList.remove('active');
    Dom.loadBar.style.width = '0%';
  }, 440);
}
function refreshLbl() {
  if      (jiotvMode)              setLbl('JIOTV', channels.length);
  else if (plIdx === TAB_FAV())    setLbl('FAVOURITES', filtered.length);
  else                             setLbl('CHANNELS', channels.length);
}

// ── HTML escape ────────────────────────────────────────────────────
function esc(s) {
  return String(s || '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── M3U parser ─────────────────────────────────────────────────────
var RE_CLEAN = /\s*\([^)]*\)|\s*\[[^\]]*\]|\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b|[\|\-–—]+\s*$|\s{2,}|>/gi;
function cleanName(raw) {
  return String(raw || '').replace(RE_CLEAN, ' ').trim();
}
function parseM3U(text) {
  var lines  = String(text || '').split(/\r?\n/);
  var out    = [];
  var meta   = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.charAt(0) === '#') {
      if (line.startsWith('#EXTINF')) {
        var np = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
        var gm = line.match(/group-title="([^"]+)"/i);
        var lm = line.match(/tvg-logo="([^"]+)"/i);
        meta = {
          name:  cleanName(np) || np,
          group: gm ? gm[1] : 'Other',
          logo:  lm ? lm[1] : '',
        };
      }
    } else if (meta) {
      out.push({ name: meta.name, group: meta.group, logo: meta.logo, url: line });
      meta = null;
    }
  }
  return out;
}

// ── Channel tech info ──────────────────────────────────────────────
function updateChannelTech() {
  if (!player || !Dom.overlayChTech) return;
  try {
    var s  = player.getStats ? player.getStats() : null;
    var tr = player.getVariantTracks ? player.getVariantTracks() : [];
    var vt = tr.find(function (t) { return t.active; });
    var parts = [];
    if (vt && vt.width && vt.height) parts.push(vt.width + '×' + vt.height);
    if (s  && s.streamBandwidth)     parts.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
    if (vt && vt.frameRate)          parts.push(Math.round(vt.frameRate) + ' fps');
    if (vt && vt.videoCodec)         parts.push(vt.videoCodec);
    Dom.overlayChTech.textContent = parts.join(' · ');
  } catch (e) {}
}

// ── AV Sync ────────────────────────────────────────────────────────
function loadAvSync() {
  var v = parseInt(lsGet(AV_SYNC_KEY) || '0', 10);
  avSyncOffset = isNaN(v) ? 0 : Math.max(-AV_SYNC_MAX, Math.min(AV_SYNC_MAX, v));
}
function saveAvSync() { lsSet(AV_SYNC_KEY, String(avSyncOffset)); }
function applyAvSync() {
  if (!Dom.video || !hasPlayed || avSyncOffset === 0) return;
  try {
    if (Dom.video.readyState >= 2) {
      var t = Dom.video.currentTime - (avSyncOffset / 1000);
      if (t >= 0) Dom.video.currentTime = t;
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
function resetAvSync() { avSyncOffset = 0; saveAvSync(); updateAvSyncLabel(); showToast('AV Sync: 0'); }
function updateAvSyncLabel() {
  if (!avSyncLabel) return;
  avSyncLabel.textContent = avSyncOffset === 0 ? 'AV: 0' : 'AV: ' + (avSyncOffset > 0 ? '+' : '') + avSyncOffset + 'ms';
  avSyncLabel.style.color  = avSyncOffset === 0 ? 'var(--text-muted)' : 'var(--gold)';
}
function buildAvSyncBar() {
  var ctrl = document.querySelector('.player-controls');
  if (!ctrl) return;
  var wrap = document.createElement('div');
  wrap.id   = 'avSyncWrap';
  var bM = document.createElement('button'); bM.className = 'av-btn'; bM.id = 'avBtnLeft';  bM.textContent = '◁ Audio';
  var bP = document.createElement('button'); bP.className = 'av-btn'; bP.id = 'avBtnRight'; bP.textContent = 'Audio ▷';
  avSyncLabel = document.createElement('span'); avSyncLabel.className = 'av-label';
  bM.addEventListener('click', function () { adjustAvSync(-1); });
  bP.addEventListener('click', function () { adjustAvSync(+1); });
  avSyncLabel.addEventListener('click', resetAvSync);
  updateAvSyncLabel();
  wrap.appendChild(bM); wrap.appendChild(avSyncLabel); wrap.appendChild(bP);
  ctrl.insertBefore(wrap, ctrl.firstChild);
}

// ── Sleep timer ────────────────────────────────────────────────────
function setSleepTimer(m) {
  clearSleepTimer(); sleepMinutes = m;
  if (!m) { showToast('Sleep timer: Off'); return; }
  showToast('Sleep timer: ' + m + ' min');
  sleepTimer = setTimeout(function () {
    if (Dom.video) Dom.video.pause();
    if (player) player.unload().catch(function(){});
    stopStallWatchdog(); clearSleepTimer();
    setStatus('Sleep — stopped', 'idle');
    showToast('Goodnight!', 4000);
    sleepTimer = null; sleepMinutes = 0;
  }, m * 60000);
}
function clearSleepTimer() { if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; } }

// ── Stall watchdog ─────────────────────────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog(); reconnectCount = 0; lastPlayTime = Date.now();
  stallWatchdog = setInterval(function () {
    if (!Dom.video || Dom.video.paused || !hasPlayed || !currentPlayUrl) return;
    if (Date.now() - lastPlayTime > STALL_TIMEOUT) {
      lastPlayTime = Date.now();
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        setStatus('Reconnecting (' + reconnectCount + '/' + MAX_RECONNECT + ')…', 'loading');
        startLoadBar();
        doPlay(currentPlayUrl, null, true).catch(function () {});
      } else {
        setStatus('Stream lost', 'error');
        stopStallWatchdog();
      }
    }
  }, 4000);
}
function stopStallWatchdog() { if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; } }
if (Dom.video) {
  Dom.video.addEventListener('timeupdate', function () {
    if (Dom.video && !Dom.video.paused) lastPlayTime = Date.now();
  });
}

// ══════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL — GPU-composited, node-pooled
// IH and GAP must equal CSS --item-h and --item-gap
// ══════════════════════════════════════════════════════════════════
var VS = {
  IH: VS_IH, GAP: VS_GAP, OS: 4,
  c: null, inner: null, vh: 0, st: 0, total: 0,
  pool: [], nodes: {}, raf: null,

  init: function (el) {
    this.c = el;
    el.innerHTML = '';
    this.inner = document.createElement('ul');
    this.inner.id = 'vsInner';
    this.inner.style.cssText = 'position:relative;width:100%;margin:0;padding:0;list-style:none;';
    el.appendChild(this.inner);
    this.vh = el.clientHeight || 900;
    var self = this;
    el.addEventListener('scroll', function () {
      if (self.raf) return;
      self.raf = requestAnimationFrame(function () {
        self.raf = null; self.st = self.c.scrollTop; self.paint();
      });
    }, { passive: true });
    if (window.ResizeObserver) {
      new ResizeObserver(function () { self.vh = self.c.clientHeight || 900; self.paint(); }).observe(el);
    }
  },

  setData: function (n) {
    this.total = n;
    var k;
    for (k in this.nodes) {
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
    if      (top < this.st + pad)            this.c.scrollTop = Math.max(0, top - pad);
    else if (bot > this.st + this.vh - pad)  this.c.scrollTop = bot - this.vh + pad;
    this.st = this.c.scrollTop; this.paint();
  },

  centerOn: function (idx) {
    this.c.scrollTop = Math.max(0, idx * (this.IH + this.GAP) - (this.vh / 2) + (this.IH / 2));
    this.st = this.c.scrollTop; this.paint();
  },

  paint: function () {
    if (!this.total) return;
    var H  = this.IH + this.GAP, os = this.OS;
    var s  = Math.max(0, Math.floor(this.st / H) - os);
    var e  = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);
    var oi, ii, nd;
    for (oi in this.nodes) {
      ii = parseInt(oi, 10);
      if (ii < s || ii > e) {
        nd = this.nodes[oi]; nd.style.display = 'none'; nd._i = -1;
        this.pool.push(nd); delete this.nodes[oi];
      }
    }
    var i, li;
    for (i = s; i <= e; i++) {
      if (this.nodes[i]) continue;
      li = this.pool.pop() || this.mkNode();
      this.build(li, i);
      if (!li.parentNode) this.inner.appendChild(li);
      li.style.display = '';
      this.nodes[i] = li;
    }
    var j, n, on;
    for (j in this.nodes) {
      n  = this.nodes[j];
      on = (parseInt(j, 10) === selectedIndex);
      if (on !== n._on) { n._on = on; n.classList.toggle('active', on); }
    }
  },

  mkNode: function () {
    var li = document.createElement('li');
    li._i = -1; li._on = false;
    li.style.cssText = 'position:absolute;will-change:transform;transform:translateZ(0);backface-visibility:hidden;';
    this.inner.appendChild(li);
    li.addEventListener('click', function () {
      if (li._i < 0) return;
      selectedIndex = li._i; VS.refresh(); cancelPreview(); schedulePreview();
    });
    return li;
  },

  build: function (li, i) {
    li._i = i; li._on = false;
    var top = i * (this.IH + this.GAP) + 10;
    li.style.cssText = [
      'position:absolute','left:12px','right:12px','top:' + top + 'px','height:' + this.IH + 'px',
      'display:flex','align-items:center','gap:16px','padding:0 18px',
      'border-radius:18px','overflow:hidden',
      'will-change:transform','transform:translateZ(0)','backface-visibility:hidden',
    ].join(';');
    var ch = filtered[i];
    if (!ch) return;
    var PH = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";
    li.innerHTML =
      '<div class="ch-logo"><img src="' + esc(ch.logo || PH) + '" onerror="this.onerror=null;this.src=\'' + PH + '\'" loading="lazy"></div>' +
      '<div class="ch-info"><div class="ch-name">' + esc(ch.name) + '</div></div>' +
      (isFav(ch) ? '<div class="ch-fav">★</div>' : '') +
      '<div class="ch-num">' + (i + 1) + '</div>';
    if (i === selectedIndex) { li._on = true; li.classList.add('active'); }
    else li.classList.remove('active');
  },

  refresh: function () {
    var j, n, on;
    for (j in this.nodes) {
      n  = this.nodes[j];
      on = (parseInt(j, 10) === selectedIndex);
      if (on !== n._on) { n._on = on; n.classList.toggle('active', on); }
    }
  },

  rebuildVisible: function () {
    var j;
    for (j in this.nodes) this.build(this.nodes[j], parseInt(j, 10));
  },
};

// ── Render list ────────────────────────────────────────────────────
function renderList() {
  if (Dom.countBadge) Dom.countBadge.textContent = String(filtered.length);
  VS.setData(filtered.length);
  if (filtered.length) VS.scrollTo(selectedIndex);
  // Kick off logo preload for visible range
  if (window.AppCache) {
    var logos = filtered.slice(0, 40).map(function (c) { return c.logo; }).filter(Boolean);
    AppCache.preloadImages(logos);
  }
}

// ── Search ─────────────────────────────────────────────────────────
var _sdTm = null;
function applySearch() {
  clearTimeout(_sdTm);
  _sdTm = setTimeout(function () {
    var q = Dom.searchInput ? Dom.searchInput.value.trim().toLowerCase() : '';
    if (!q) {
      filtered = channels.slice();
    } else {
      filtered = channels.filter(function (c) {
        return c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q);
      });
    }
    selectedIndex = 0;
    renderList();
    if (q) setLbl('SEARCH', filtered.length); else refreshLbl();
  }, 120);
}
function commitSearch() {
  setFocus('list');
  if (filtered.length === 1) { selectedIndex = 0; VS.refresh(); schedulePreview(); }
}
function clearSearch() {
  if (Dom.searchInput) Dom.searchInput.value = '';
  if (Dom.searchWrap)  Dom.searchWrap.classList.remove('active');
  applySearch();
  setFocus('list');
}
if (Dom.searchInput) {
  Dom.searchInput.addEventListener('input', function () {
    if (Dom.searchWrap) Dom.searchWrap.classList.toggle('active', Dom.searchInput.value.length > 0);
    applySearch();
  });
}
if (Dom.searchClear) Dom.searchClear.addEventListener('click', clearSearch);

// ── XHR fetch + CDN mirror ─────────────────────────────────────────
function xhrFetch(url, ms, cb) {
  var done = false, xhr = new XMLHttpRequest();
  var tid  = setTimeout(function () {
    if (done) return; done = true; xhr.abort(); cb(new Error('Timeout'), null);
  }, ms);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4 || done) return;
    done = true; clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };
  xhr.onerror = function () {
    if (done) return; done = true; clearTimeout(tid); cb(new Error('Network error'), null);
  };
  try { xhr.open('GET', url, true); xhr.send(); }
  catch (e) { done = true; clearTimeout(tid); cb(e, null); }
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

// ── M3U playlist loading — AppCache aware ─────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();
  var rawUrl = urlOv || (plIdx < allPlaylists.length ? allPlaylists[plIdx].url : null);
  if (!rawUrl) return;

  // 1. Try AppCache (IDB + localStorage)
  var cachePromise = window.AppCache
    ? AppCache.getM3U(rawUrl)
    : Promise.resolve(null);

  cachePromise.then(function (cached) {
    if (cached && cached.length > 100) {
      onLoaded(cached, true); return;
    }
    // 2. Fetch from network
    setStatus('Loading…', 'loading'); startLoadBar();
    xhrFetch(rawUrl, 30000, function (err, text) {
      if (!err && text && text.length > 100) {
        finishLoadBar();
        if (window.AppCache) AppCache.setM3U(rawUrl, text);
        onLoaded(text, false); return;
      }
      var mirror = mirrorUrl(rawUrl);
      if (mirror) {
        setStatus('Retrying mirror…', 'loading');
        xhrFetch(mirror, 30000, function (e2, t2) {
          finishLoadBar();
          if (!e2 && t2 && t2.length > 100) {
            if (window.AppCache) AppCache.setM3U(rawUrl, t2);
            onLoaded(t2, false);
          } else {
            setStatus('Failed — check network', 'error');
          }
        });
      } else {
        finishLoadBar();
        setStatus('Failed', 'error');
      }
    });
  });

  function onLoaded(t, fromCache) {
    channels = parseM3U(t);
    allChannels = channels.slice();
    filtered    = channels.slice();
    selectedIndex = 0;
    renderList();
    refreshLbl();
    lsSet('iptv:lastM3uIndex', String(plIdx));
    setStatus('Ready · ' + channels.length + ' ch' + (fromCache ? ' (cached)' : ''), 'idle');
    setFocus('list');
  }
}

// ── Network indicator ──────────────────────────────────────────────
function updateNetworkIndicator() {
  var el = $('networkIndicator'); if (!el) return;
  el.className = 'network-indicator';
  if (!navigator.onLine) {
    networkQuality = 'offline'; el.classList.add('offline');
  } else if (navigator.connection && navigator.connection.downlink) {
    var sp = navigator.connection.downlink;
    if (sp < 1) { networkQuality = 'slow';   el.classList.add('slow'); }
    else         { networkQuality = 'online'; el.classList.add('online'); }
  } else {
    networkQuality = 'online'; el.classList.add('online');
  }
  if (player) {
    player.configure({ streaming: {
      bufferingGoal:    networkQuality === 'slow' ? 5  : 12,
      rebufferingGoal:  networkQuality === 'slow' ? 1  : 2,
    }});
  }
}
function startNetworkMonitoring() {
  updateNetworkIndicator();
  if (navigator.connection)
    navigator.connection.addEventListener('change', updateNetworkIndicator);
  window.addEventListener('online',  updateNetworkIndicator);
  window.addEventListener('offline', updateNetworkIndicator);
  connectionMonitor = setInterval(updateNetworkIndicator, 10000);
}

// ── Clock ──────────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var ts  = now.toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  var ds  = now.toLocaleDateString([], { weekday:'short', day:'2-digit', month:'short' });
  if ($('brandClock')) $('brandClock').textContent = ts;
  if ($('currentTime')) $('currentTime').textContent = ts;
  if ($('currentDate')) $('currentDate').textContent = ds;
  if (Dom.jpClock)  Dom.jpClock.textContent  = ts;
  if (Dom.jpPlTime) Dom.jpPlTime.textContent = ts;
}
setInterval(updateClock, 1000);
updateClock();

// ── Shaka player init ──────────────────────────────────────────────
async function initShaka() {
  if (player) return;  // already initialised
  try {
    shaka.polyfill.installAll();
    if (!shaka.Player.isBrowserSupported()) {
      console.error('[SAGA] Shaka not supported'); return;
    }
    player = new shaka.Player(Dom.video);
    player.configure({
      streaming: {
        bufferingGoal: 12, rebufferingGoal: 2, bufferBehind: 20,
        stallEnabled: true, stallThreshold: 1, stallSkip: 0.1,
        autoCorrectDrift: true, gapDetectionThreshold: 0.5, gapPadding: 0.1,
        durationBackoff: 1,
        retryParameters: { maxAttempts:6, baseDelay:500, backoffFactor:2, fuzzFactor:0.5, timeout:30000 },
      },
      abr: { enabled:true, defaultBandwidthEstimate:500000, switchInterval:8,
             bandwidthUpgradeTarget:0.85, bandwidthDowngradeTarget:0.95 },
      manifest: { retryParameters: { maxAttempts:5, baseDelay:1000, backoffFactor:2 } },
      drm: {
        retryParameters: { maxAttempts:4, baseDelay:500, backoffFactor:2, timeout:15000 },
        advanced: { 'com.widevine.alpha': { videoRobustness:'HW_SECURE_ALL', audioRobustness:'HW_SECURE_CRYPTO' } },
      },
    });
    player.addEventListener('error', function (ev) {
      var err  = ev && ev.detail, code = err && err.code;
      var msg  = (code >= 6000 && code <= 6999) ? 'DRM error'
               : (code >= 7000 && code <= 7999) ? 'Network error' : 'Stream error';
      console.error('[SAGA] Shaka', code, err && err.message);
      setStatus(msg, 'error'); finishLoadBar(); _playerBusy = false;
    });
    player.addEventListener('buffering', function (ev) {
      if (ev.buffering) { setStatus('Buffering…', 'loading'); startLoadBar(); }
      else              { setStatus('Playing',    'playing');  finishLoadBar(); }
    });
    player.addEventListener('adaptation',    updateChannelTech);
    player.addEventListener('variantchanged', updateChannelTech);
  } catch (e) {
    console.error('[SAGA] initShaka', e);
  }
}

// ── DRM config ─────────────────────────────────────────────────────
function buildDrmConfig(info) {
  if (!info || !info.isDRM) return null;
  var cfg = { servers: {} };
  if (info.drm_url) {
    cfg.servers['com.widevine.alpha'] = info.drm_url;
    cfg.advanced = { 'com.widevine.alpha': { videoRobustness:'HW_SECURE_ALL', audioRobustness:'HW_SECURE_CRYPTO' } };
  } else if (info.key && info.iv) {
    cfg.servers['org.w3.clearkey'] = '';
    cfg.clearKeys = {};
    var kid = info.key_id || info.kid || info.key;
    cfg.clearKeys[kid] = info.key;
  }
  return Object.keys(cfg.servers).length ? cfg : null;
}

// ── doPlay — safe, concurrency-guarded ────────────────────────────
async function doPlay(url, streamInfo, isReconnect) {
  if (!url) return;
  if (_playerBusy && !isReconnect) return;   // prevent double-tap race
  _playerBusy = true;
  currentPlayUrl = url; reconnectCount = isReconnect ? reconnectCount : 0;
  if (!player) await initShaka();
  if (!player) { _playerBusy = false; return; }

  var drmCfg = streamInfo ? buildDrmConfig(streamInfo) : null;
  try {
    await player.unload();
    Dom.video.removeAttribute('src');
    if (drmCfg) player.configure({ drm: drmCfg });
    else         player.configure({ drm: { servers: {} } });
    await player.load(url);
    await Dom.video.play().catch(function () {});
    updateChannelTech();
    if (avSyncOffset !== 0) setTimeout(applyAvSync, 1500);
    if (!isReconnect) startStallWatchdog();
  } catch (err) {
    console.warn('[SAGA] doPlay:', err.message);
    // Fallback 1: .ts → .m3u8
    if (url.endsWith('.ts')) {
      try {
        var m3u = url.replace(/\.ts$/, '.m3u8');
        await player.unload(); await player.load(m3u);
        await Dom.video.play().catch(function () {});
        currentPlayUrl = m3u; updateChannelTech(); startStallWatchdog();
        _playerBusy = false; return;
      } catch (e2) {}
    }
    // Fallback 2: native video element (non-DRM)
    if (!drmCfg) {
      try {
        await player.unload();
        Dom.video.src = url; Dom.video.load();
        await Dom.video.play().catch(function () {});
        startStallWatchdog(); _playerBusy = false; return;
      } catch (e3) {}
    }
    setStatus('Play error', 'error'); finishLoadBar(); stopStallWatchdog();
  } finally {
    _playerBusy = false;
  }
}

// ── Preview ────────────────────────────────────────────────────────
function cancelPreview()   { clearTimeout(previewTimer); previewTimer = null; }
function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(function () { previewTimer = null; startPreview(selectedIndex); }, PREVIEW_DELAY);
}
async function startPreview(idx) {
  if (!filtered.length) return;
  var ch = filtered[idx]; if (!ch) return;

  if (overlayTop && overlayBottom && overlaysVisible) {
    Dom.overlayTop.classList.remove('info-visible');
    Dom.overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  }
  if (Dom.nowPlaying)     Dom.nowPlaying.textContent     = ch.name;
  if (Dom.overlayChName)  Dom.overlayChName.textContent  = ch.name;
  if (Dom.npChNum)        Dom.npChNum.textContent        = 'CH ' + (idx + 1);
  if (Dom.overlayProgTitle) Dom.overlayProgTitle.textContent = '';
  if (Dom.overlayProgDesc)  Dom.overlayProgDesc.textContent  = '';
  if (Dom.nextProgInfo)     Dom.nextProgInfo.textContent     = '';
  if (Dom.programInfoBox)   Dom.programInfoBox.style.display  = 'none';
  if (Dom.videoOverlay) Dom.videoOverlay.classList.add('hidden');

  hasPlayed = true;
  setStatus('Buffering…', 'loading');
  startLoadBar();
  await doPlay(ch.url, null, false);
}
function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ───────────────────────────────────────────────────
if (Dom.video) {
  Dom.video.addEventListener('playing', function () { setStatus('Playing','playing'); finishLoadBar(); updateChannelTech(); });
  Dom.video.addEventListener('pause',   function () { setStatus('Paused',  'paused'); });
  Dom.video.addEventListener('waiting', function () { setStatus('Buffering…','loading'); startLoadBar(); });
  Dom.video.addEventListener('stalled', function () { setStatus('Buffering…','loading'); });
  Dom.video.addEventListener('error',   function () { setStatus('Error',   'error');  finishLoadBar(); });
  Dom.video.addEventListener('ended',   function () { setStatus('Ended',   'idle');   stopStallWatchdog(); });
  Dom.video.addEventListener('dblclick', function () { toggleFS(); });
}

// ── Fullscreen (M3U mode) ──────────────────────────────────────────
function showFsHint() {
  clearTimeout(fsHintTimer);
  if (Dom.fsHint) Dom.fsHint.classList.add('visible');
  fsHintTimer = setTimeout(function () {
    if (Dom.fsHint) Dom.fsHint.classList.remove('visible');
  }, 3200);
}
function applyExitFSState() {
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
  if (Dom.fsHint) Dom.fsHint.classList.remove('visible');
}
function enterFS() {
  var fn = Dom.videoWrap && (Dom.videoWrap.requestFullscreen || Dom.videoWrap.webkitRequestFullscreen || Dom.videoWrap.mozRequestFullScreen);
  if (fn) try { fn.call(Dom.videoWrap); } catch (e) {}
  document.body.classList.add('fullscreen');
  isFullscreen = true;
  if (Dom.overlayTop)    Dom.overlayTop.classList.remove('info-visible');
  if (Dom.overlayBottom) Dom.overlayBottom.classList.remove('info-visible');
  overlaysVisible = false;
  showFsHint();
}
function exitFS() {
  var fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (fn) try { fn.call(document); } catch (e) {}
  applyExitFSState();
}
function toggleFS() { if (isFullscreen) exitFS(); else enterFS(); }
function onFsChange() {
  var f = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!f && isFullscreen) applyExitFSState();
}
document.addEventListener('fullscreenchange',       onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

// ── Info overlays ──────────────────────────────────────────────────
function toggleOverlays() {
  if (!Dom.overlayTop || !Dom.overlayBottom) return;
  if (overlaysVisible) {
    Dom.overlayTop.classList.remove('info-visible');
    Dom.overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  } else {
    Dom.overlayTop.classList.add('info-visible');
    Dom.overlayBottom.classList.add('info-visible');
    overlaysVisible = true;
  }
}

// ── Channel dialer ─────────────────────────────────────────────────
function commitChannelNumber() {
  var num = parseInt(dialBuffer, 10);
  dialBuffer = '';
  if (Dom.chDialer) Dom.chDialer.classList.remove('visible');
  if (!filtered.length || isNaN(num) || num < 1) return;
  var idx = Math.min(filtered.length - 1, num - 1);
  cancelPreview(); selectedIndex = idx; VS.centerOn(idx); VS.refresh(); playSelected();
  showToast('CH ' + (idx + 1) + ' · ' + filtered[idx].name);
}
function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d;
  if (Dom.chDialerNum) Dom.chDialerNum.textContent = dialBuffer;
  if (Dom.chDialer)    Dom.chDialer.classList.add('visible');
  dialTimer = setTimeout(function () { dialTimer = null; commitChannelNumber(); },
    dialBuffer.length >= 3 ? 400 : 1500);
}
function getDigit(e) {
  var c = e.keyCode;
  if (c >= 48 && c <= 57)  return String(c - 48);
  if (c >= 96 && c <= 105) return String(c - 96);
  if (e.key && e.key.length === 1 && e.key >= '0' && e.key <= '9') return e.key;
  return null;
}

// ── Focus management ───────────────────────────────────────────────
function setFocus(a) {
  focusArea = a;
  if (Dom.tabBar) Dom.tabBar.classList.toggle('tab-bar-focused', a === 'tabs');
  if (a === 'search') {
    if (Dom.searchWrap)  Dom.searchWrap.classList.add('active');
    if (Dom.searchInput) Dom.searchInput.focus();
  } else {
    if (Dom.searchWrap)  Dom.searchWrap.classList.remove('active');
    if (document.activeElement === Dom.searchInput && Dom.searchInput) Dom.searchInput.blur();
  }
  var avL = $('avBtnLeft'), avR = $('avBtnRight');
  if (avL) avL.classList.toggle('focused', a === 'avLeft');
  if (avR) avR.classList.toggle('focused', a === 'avRight');
  if (Dom.addPlaylistBtn) Dom.addPlaylistBtn.classList.toggle('focused', a === 'addBtn');
  if (a === 'tabs') syncTabHighlight(); else clearTabHighlight();
}
function syncTabHighlight() {
  if (Dom.tabBar)
    Dom.tabBar.querySelectorAll('.tab').forEach(function (b, i) {
      b.classList.toggle('kbd-focus', i === tabFocusIdx);
    });
}
function clearTabHighlight() {
  if (Dom.tabBar)
    Dom.tabBar.querySelectorAll('.tab').forEach(function (b) { b.classList.remove('kbd-focus'); });
}
function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview();
  clearTimeout(dialTimer); dialTimer = null; dialBuffer = '';
  if (Dom.chDialer) Dom.chDialer.classList.remove('visible');
  selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + d));
  VS.scrollTo(selectedIndex); VS.refresh(); schedulePreview();
}
function moveTabFocus(d) {
  var total = TAB_TOTAL();
  tabFocusIdx = ((tabFocusIdx + d) % total + total) % total;
  syncTabHighlight();
  if (Dom.tabBar) {
    var btns = Dom.tabBar.querySelectorAll('.tab');
    if (btns[tabFocusIdx]) btns[tabFocusIdx].scrollIntoView({ inline:'nearest', block:'nearest' });
  }
}
function activateFocusedTab() { switchTab(tabFocusIdx); setFocus('list'); }

// ── Tizen key registration ─────────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      ['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
       'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown',
       'Back','Info','Guide','0','1','2','3','4','5','6','7','8','9',
       'VolumeUp','VolumeDown','Mute','Exit','Return','PreCh',
      ].forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
    }
  } catch (e) {}
}

// ══════════════════════════════════════════════════════════════════
// JIOTV PORTAL
// ══════════════════════════════════════════════════════════════════

function showJioPortal() {
  if (Dom.appMain) Dom.appMain.style.display = 'none';
  if (Dom.portal)  Dom.portal.style.display  = 'flex';
  jpBuildGrid();
  jpFocusRow = 0; jpFocusCol = 0;
  requestAnimationFrame(function () { jpFocusTile(); });
}
function hideJioPortal() {
  if (Dom.portal)  Dom.portal.style.display  = 'none';
  if (Dom.appMain) Dom.appMain.style.display = 'grid';
  jiotvMode = false;
  var si = parseInt(lsGet('iptv:lastM3uIndex') || '0', 10);
  plIdx = (!isNaN(si) && si < allPlaylists.length) ? si : 0;
  rebuildTabs(); loadPlaylist(); setFocus('list'); saveMode();
}

// ── Grid filter + build ────────────────────────────────────────────
function jpApplyFilters() {
  var q = jpSearchQ.toLowerCase();
  jpFiltered = jiotvChannels.filter(function (ch) {
    if (jpActiveCat  !== 'all' && ch.group !== jpActiveCat)  return false;
    if (jpActiveLang !== 'all' && ch.lang  !== jpActiveLang) return false;
    if (q && !ch.name.toLowerCase().includes(q)) return false;
    return true;
  });
  jpBuildGrid();
}

var PH_TILE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";

function jpBuildGrid() {
  if (!Dom.jpGrid) return;
  // Use DocumentFragment for one-shot DOM insert
  var frag = document.createDocumentFragment();
  jpFiltered.forEach(function (ch, i) {
    var tile = document.createElement('div');
    tile.className = 'jp-tile';
    tile.dataset.idx = String(i);
    if (jpActiveChannel && ch.jioId === jpActiveChannel.jioId) tile.classList.add('playing');
    tile.innerHTML =
      '<div class="jp-tile-logo"><img src="' + esc(ch.logo || PH_TILE) + '" onerror="this.onerror=null;this.src=\'' + PH_TILE + '\'" loading="lazy"></div>' +
      '<div class="jp-tile-name">' + esc(ch.name) + '</div>' +
      '<div class="jp-tile-group">' + esc(ch.group || '') + '</div>' +
      (ch.isHD ? '<div class="jp-tile-hd">HD</div>' : '') +
      '<div class="jp-tile-live">LIVE</div>';
    tile.addEventListener('click', function () { jpPlayChannel(ch, i); });
    frag.appendChild(tile);
  });
  Dom.jpGrid.innerHTML = '';
  Dom.jpGrid.appendChild(frag);
  if (Dom.jpCount) Dom.jpCount.textContent = jpFiltered.length + ' channels';

  // Calc columns after layout
  requestAnimationFrame(function () {
    var tiles = Dom.jpGrid.querySelectorAll('.jp-tile');
    if (tiles.length > 0) {
      var r1 = tiles[0].getBoundingClientRect();
      var gR = Dom.jpGrid.getBoundingClientRect();
      jpGridCols = Math.max(1, Math.round(gR.width / (r1.width + 14)));
    }
    jpFocusTile();
    // Preload tile logos
    if (window.AppCache) {
      var logos = jpFiltered.slice(0, 60).map(function (c) { return c.logo; }).filter(Boolean);
      AppCache.preloadImages(logos);
    }
  });
}

function jpFocusTile() {
  if (!Dom.jpGrid) return;
  var tiles = Dom.jpGrid.querySelectorAll('.jp-tile');
  tiles.forEach(function (t) { t.classList.remove('focused'); });
  var idx = Math.max(0, Math.min(tiles.length - 1, jpFocusRow * jpGridCols + jpFocusCol));
  if (tiles[idx]) {
    tiles[idx].classList.add('focused');
    tiles[idx].scrollIntoView({ block:'nearest', inline:'nearest' });
    jpFocusRow = Math.floor(idx / Math.max(1, jpGridCols));
    jpFocusCol = idx % Math.max(1, jpGridCols);
  }
}
function jpGetFocusIdx() { return jpFocusRow * jpGridCols + jpFocusCol; }
function jpMoveFocus(dr, dc) {
  if (!Dom.jpGrid) return;
  var tiles = Dom.jpGrid.querySelectorAll('.jp-tile');
  var total = tiles.length; if (!total) return;
  var rows    = Math.ceil(total / jpGridCols);
  var newRow  = Math.max(0, Math.min(rows - 1, jpFocusRow + dr));
  var newCol  = Math.max(0, Math.min(jpGridCols - 1, jpFocusCol + dc));
  var newIdx  = newRow * jpGridCols + newCol;
  // Clamp to last tile in partial last row
  if (newIdx >= total) {
    newCol = (total - 1) - newRow * jpGridCols;
    newIdx = newRow * jpGridCols + newCol;
  }
  if (newIdx < 0) newIdx = 0;
  jpFocusRow = newRow;
  jpFocusCol = Math.max(0, newCol);
  jpFocusTile();
}
function jpActivateFilter(filterEl) {
  var type = filterEl.dataset.type, val = filterEl.dataset.filter;
  if (type === 'cat') {
    jpActiveCat = val;
    if (Dom.jpFilters)
      Dom.jpFilters.querySelectorAll('.jp-filter').forEach(function (b) {
        b.classList.toggle('active', b.dataset.filter === val && b.dataset.type === 'cat');
      });
  } else {
    jpActiveLang = val;
    if (Dom.jpLangFilters)
      Dom.jpLangFilters.querySelectorAll('.jp-filter').forEach(function (b) {
        b.classList.toggle('active', b.dataset.filter === val && b.dataset.type === 'lang');
      });
  }
  jpFocusRow = 0; jpFocusCol = 0;
  jpApplyFilters();
}

// ── JioTV player layer ─────────────────────────────────────────────
async function jpPlayChannel(ch, gridIdx) {
  if (_jpPlayerBusy) return;
  _jpPlayerBusy = true;
  jpActiveChannel = ch;
  jpInPlayer = true;

  if (Dom.jpPlayerLayer) Dom.jpPlayerLayer.style.display = 'block';
  if (Dom.jpPlayerOvl)   Dom.jpPlayerOvl.classList.add('visible');
  if (Dom.jpPlTitle)     Dom.jpPlTitle.textContent = ch.name;
  if (Dom.jpPlSpinner)   Dom.jpPlSpinner.classList.add('active');

  // Mark playing tile
  if (Dom.jpGrid) {
    Dom.jpGrid.querySelectorAll('.jp-tile').forEach(function (t) { t.classList.remove('playing'); });
    var tiles = Dom.jpGrid.querySelectorAll('.jp-tile');
    if (gridIdx !== undefined && tiles[gridIdx]) tiles[gridIdx].classList.add('playing');
  }

  jpUpdateNowBar(ch);

  try {
    if (!jpPlayer) {
      shaka.polyfill.installAll();
      jpPlayer = new shaka.Player(Dom.jpVideo);
      jpPlayer.configure({
        streaming: { bufferingGoal:12, rebufferingGoal:2, stallEnabled:true, stallThreshold:1, stallSkip:0.1,
          retryParameters: { maxAttempts:6, baseDelay:500, backoffFactor:2, fuzzFactor:0.5, timeout:30000 } },
        drm: { retryParameters: { maxAttempts:4, baseDelay:500, backoffFactor:2, timeout:15000 },
          advanced: { 'com.widevine.alpha': { videoRobustness:'HW_SECURE_ALL', audioRobustness:'HW_SECURE_CRYPTO' } } },
      });
      jpPlayer.addEventListener('error', function () {
        if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.remove('active');
        _jpPlayerBusy = false;
      });
      jpPlayer.addEventListener('buffering', function (ev) {
        if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.toggle('active', ev.buffering);
        if (!ev.buffering) jpUpdateTechInfo();
      });
      jpPlayer.addEventListener('variantchanged', jpUpdateTechInfo);
      jpPlayer.addEventListener('adaptation',     jpUpdateTechInfo);
    }

    var info    = await jiotvClient.getStreamInfo(ch.jioId);
    var playUrl = (info && info.url) ? info.url : ch.url;
    var drmCfg  = buildDrmConfig(info);

    await jpPlayer.unload();
    Dom.jpVideo.removeAttribute('src');
    if (drmCfg) jpPlayer.configure({ drm: drmCfg });
    else         jpPlayer.configure({ drm: { servers: {} } });
    await jpPlayer.load(playUrl);
    await Dom.jpVideo.play().catch(function () {});

    jpShowOverlay();
    setTimeout(function () { if (jpInPlayer) jpHideOverlay(); }, OVERLAY_AUTO_HIDE);

    // EPG
    clearTimeout(jpEpgTimer);
    jpEpgTimer = setTimeout(function () { jpFetchEpg(ch.jioId); }, 800);
    // Repeating EPG refresh
    function schedEpg() { jpEpgTimer = setTimeout(function () { if (jpInPlayer) { jpFetchEpg(ch.jioId); schedEpg(); } }, 30000); }
    schedEpg();

  } catch (err) {
    console.error('[JioTV] jpPlayChannel:', err.message);
    if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.remove('active');
    showToast('Stream error: ' + err.message);
    // Try native fallback
    try {
      Dom.jpVideo.src = ch.url; Dom.jpVideo.load();
      await Dom.jpVideo.play().catch(function () {});
    } catch (e2) {}
  } finally {
    _jpPlayerBusy = false;
  }
}

function jpShowOverlay() {
  if (Dom.jpPlayerOvl) Dom.jpPlayerOvl.classList.add('visible');
  clearTimeout(jpOverlayTimer);
  jpOverlayTimer = setTimeout(function () { jpHideOverlay(); }, OVERLAY_AUTO_HIDE);
}
function jpHideOverlay() {
  if (Dom.jpPlayerOvl) Dom.jpPlayerOvl.classList.remove('visible');
}

function jpExitPlayer() {
  jpInPlayer = false;
  _jpPlayerBusy = false;
  clearTimeout(jpEpgTimer);
  clearTimeout(jpOverlayTimer);
  if (jpPlayer) jpPlayer.unload().catch(function () {});
  if (Dom.jpVideo) Dom.jpVideo.removeAttribute('src');
  if (Dom.jpPlayerLayer) Dom.jpPlayerLayer.style.display = 'none';
  if (Dom.jpPlayerOvl)   Dom.jpPlayerOvl.classList.remove('visible');
  if (Dom.jpPlSpinner)   Dom.jpPlSpinner.classList.remove('active');
  requestAnimationFrame(function () { jpFocusTile(); });
}

function jpUpdateNowBar(ch) {
  if (!Dom.jpNowBar) return;
  Dom.jpNowBar.style.display = 'flex';
  if (Dom.jpNbThumb)
    Dom.jpNbThumb.innerHTML = '<img src="' + esc(ch.logo || PH_TILE) + '" onerror="this.src=\'' + PH_TILE + '\'" style="width:100%;height:100%;object-fit:contain">';
  if (Dom.jpNbName) Dom.jpNbName.textContent = ch.name;
  if (Dom.jpNbEpg)  Dom.jpNbEpg.textContent  = '';
}
function jpUpdateTechInfo() {
  if (!jpPlayer) return;
  try {
    var tr    = jpPlayer.getVariantTracks ? jpPlayer.getVariantTracks() : [];
    var vt    = tr.find(function (t) { return t.active; });
    var s     = jpPlayer.getStats ? jpPlayer.getStats() : null;
    var parts = [];
    if (vt && vt.width && vt.height) parts.push(vt.width + '×' + vt.height);
    if (s  && s.streamBandwidth)     parts.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
    var info = parts.join(' · ');
    if (Dom.jpPlTech) Dom.jpPlTech.textContent = info;
    if (Dom.jpNbTech)  Dom.jpNbTech.textContent  = info;
  } catch (e) {}
}
async function jpFetchEpg(channelId) {
  if (!jiotvClient || !channelId || !jpInPlayer) return;
  try {
    var ep = await jiotvClient.getNowPlaying(channelId);
    if (ep) {
      var title = ep.title || ep.showname || '';
      var desc  = ep.description || '';
      if (Dom.jpPlProg) Dom.jpPlProg.textContent = title;
      if (Dom.jpPlDesc) Dom.jpPlDesc.textContent = desc;
      if (Dom.jpNbEpg)  Dom.jpNbEpg.textContent  = title;
    }
  } catch (e) {}
}

// ── Portal event delegation ────────────────────────────────────────
if (Dom.jpFilters)
  Dom.jpFilters.addEventListener('click', function (e) {
    var f = e.target.closest('.jp-filter'); if (f) jpActivateFilter(f);
  });
if (Dom.jpLangFilters)
  Dom.jpLangFilters.addEventListener('click', function (e) {
    var f = e.target.closest('.jp-filter'); if (f) jpActivateFilter(f);
  });
if (Dom.jpSearchEl) {
  Dom.jpSearchEl.addEventListener('input', function () {
    jpSearchQ = Dom.jpSearchEl.value;
    jpFocusRow = 0; jpFocusCol = 0;
    jpApplyFilters();
  });
  // Allow typing on Tizen virtual keyboard
  Dom.jpSearchEl.addEventListener('focus', function () {
    Dom.jpSearchEl.style.pointerEvents = 'auto';
    Dom.jpSearchEl.style.userSelect = 'text';
  });
}
if (Dom.jpExitBtn) Dom.jpExitBtn.addEventListener('click', hideJioPortal);
if (Dom.jpPlBack)  Dom.jpPlBack.addEventListener('click',  jpExitPlayer);

// ══════════════════════════════════════════════════════════════════
// MASTER KEY HANDLER
// ══════════════════════════════════════════════════════════════════
window.addEventListener('keydown', function (e) {
  var k = e.key, kc = e.keyCode;

  // ── JioTV Portal ────────────────────────────────────────────
  if (Dom.portal && Dom.portal.style.display !== 'none') {

    // Player layer active
    if (jpInPlayer) {
      var isNav = (kc === KEY.UP || kc === KEY.DOWN || kc === KEY.LEFT || kc === KEY.RIGHT ||
                   k === 'ArrowUp' || k === 'ArrowDown' || k === 'ArrowLeft' || k === 'ArrowRight' ||
                   kc === KEY.ENTER || k === 'Enter');
      if (isNav) { jpShowOverlay(); e.preventDefault(); return; }
      if (k === 'Escape' || k === 'Back' || k === 'GoBack' || kc === KEY.BACK || kc === 27) {
        jpExitPlayer(); e.preventDefault(); return;
      }
      if (k === 'Info' || kc === KEY.INFO) {
        if (Dom.jpPlayerOvl && Dom.jpPlayerOvl.classList.contains('visible')) jpHideOverlay();
        else jpShowOverlay();
        e.preventDefault(); return;
      }
      if (k === 'ColorF3Blue' || kc === KEY.BLUE) { hideJioPortal(); e.preventDefault(); return; }
      e.preventDefault(); return;
    }

    // Grid navigation
    if (k === 'ArrowUp'    || kc === KEY.UP)    { jpMoveFocus(-1, 0); e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { jpMoveFocus(+1, 0); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { jpMoveFocus(0, -1); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT) { jpMoveFocus(0, +1); e.preventDefault(); return; }
    if (k === 'Enter' || kc === KEY.ENTER) {
      var idx = jpGetFocusIdx();
      if (jpFiltered[idx]) jpPlayChannel(jpFiltered[idx], idx);
      e.preventDefault(); return;
    }
    if (k === 'Escape' || k === 'Back' || k === 'GoBack' || kc === KEY.BACK || kc === 27) {
      hideJioPortal(); e.preventDefault(); return;
    }
    if (k === 'ColorF3Blue'   || kc === KEY.BLUE)   { hideJioPortal(); e.preventDefault(); return; }
    if (k === 'ColorF2Yellow' || kc === KEY.YELLOW) {
      if (Dom.jpSearchEl) Dom.jpSearchEl.focus();
      e.preventDefault(); return;
    }
    if (k === 'MediaStop' || kc === KEY.STOP) { hideJioPortal(); e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── Modal open ──────────────────────────────────────────────
  var anyModal = (Dom.playlistModal && Dom.playlistModal.style.display === 'flex') ||
                 (Dom.jiotvModal    && Dom.jiotvModal.style.display    === 'flex');
  if (anyModal) {
    if (k === 'Escape' || k === 'Back' || kc === KEY.BACK || kc === KEY.EXIT || kc === 27) {
      closeAllModals(); e.preventDefault(); return;
    }
    if (k === 'Enter' || kc === KEY.ENTER) {
      if (Dom.jiotvModal    && Dom.jiotvModal.style.display    === 'flex') { jiotvConnectAction(); e.preventDefault(); return; }
      if (Dom.playlistModal && Dom.playlistModal.style.display === 'flex') { handleSavePlaylist(); e.preventDefault(); return; }
      var foc = document.activeElement;
      if (foc && foc.tagName === 'BUTTON') { foc.click(); e.preventDefault(); return; }
    }
    if (k === 'Tab') return;
    return;
  }

  // ── Digit dialer ────────────────────────────────────────────
  var dig = getDigit(e);
  if (dig !== null && focusArea !== 'search' && focusArea !== 'tabs') {
    handleDigit(dig); e.preventDefault(); return;
  }
  if (Dom.chDialer && Dom.chDialer.classList.contains('visible')) {
    if (kc === KEY.ENTER || k === 'Enter') { clearTimeout(dialTimer); dialTimer = null; commitChannelNumber(); e.preventDefault(); return; }
    if (k === 'Back' || k === 'Escape' || kc === KEY.BACK || kc === 27) {
      clearTimeout(dialTimer); dialTimer = null; dialBuffer = '';
      Dom.chDialer.classList.remove('visible'); e.preventDefault(); return;
    }
  }

  // ── Back / Escape ───────────────────────────────────────────
  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || kc === KEY.BACK || kc === 27) {
    if (isFullscreen)                   { exitFS();        e.preventDefault(); return; }
    if (focusArea === 'tabs')           { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search')         { clearSearch();   e.preventDefault(); return; }
    if (focusArea === 'avLeft' || focusArea === 'avRight') { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'addBtn')         { setFocus('list'); e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (ex) {}
    e.preventDefault(); return;
  }

  if (k === 'Info' || kc === KEY.INFO || k === 'Guide' || kc === KEY.GUIDE) {
    toggleOverlays(); e.preventDefault(); return;
  }

  // ── Tabs focus ───────────────────────────────────────────────
  if (focusArea === 'tabs') {
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { moveTabFocus(-1); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT) { moveTabFocus(+1); e.preventDefault(); return; }
    if (k === 'Enter'      || kc === KEY.ENTER) { activateFocusedTab(); e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowUp'    || kc === KEY.UP)    { e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── Search focus ─────────────────────────────────────────────
  if (focusArea === 'search') {
    if (k === 'Enter' || kc === KEY.ENTER) { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || kc === KEY.DOWN || kc === KEY.UP) { commitSearch(); e.preventDefault(); return; }
    return;
  }

  // ── AV Sync focus ────────────────────────────────────────────
  if (focusArea === 'avLeft') {
    if (k === 'Enter'      || kc === KEY.ENTER) { adjustAvSync(-1); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT) { setFocus('avRight'); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { setFocus('list');   e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { setFocus('list');   e.preventDefault(); return; }
    e.preventDefault(); return;
  }
  if (focusArea === 'avRight') {
    if (k === 'Enter'      || kc === KEY.ENTER) { adjustAvSync(+1); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { setFocus('avLeft'); e.preventDefault(); return; }
    if (k === 'ArrowRight' || kc === KEY.RIGHT) { setFocus('list');   e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { setFocus('list');   e.preventDefault(); return; }
    e.preventDefault(); return;
  }
  if (focusArea === 'addBtn') {
    if (k === 'Enter'      || kc === KEY.ENTER) { openAddPlaylistModal(); e.preventDefault(); return; }
    if (k === 'ArrowDown'  || kc === KEY.DOWN)  { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowLeft'  || kc === KEY.LEFT)  { setFocus('tabs'); e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── List focus (default) ─────────────────────────────────────
  if (k === 'ArrowUp'   || kc === KEY.UP)   { if (isFullscreen) showFsHint(); else moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || kc === KEY.DOWN) { if (isFullscreen) showFsHint(); else moveSel(+1); e.preventDefault(); return; }
  if (k === 'ArrowLeft' || kc === KEY.LEFT) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    tabFocusIdx = plIdx; setFocus('tabs'); e.preventDefault(); return;
  }
  if (k === 'ArrowRight' || kc === KEY.RIGHT) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    if ($('avBtnLeft')) { setFocus('avLeft'); e.preventDefault(); return; }
    e.preventDefault(); return;
  }
  if (k === 'Enter' || kc === KEY.ENTER) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(function () { if (hasPlayed) enterFS(); }, 700);
    }
    e.preventDefault(); return;
  }
  if (k === 'PageUp'   || kc === KEY.PAGE_UP)   { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown' || kc === KEY.PAGE_DOWN)  { moveSel(+10); e.preventDefault(); return; }

  if (k === 'MediaPlayPause' || kc === KEY.PLAY_PAUSE) { if (Dom.video) { if (Dom.video.paused) Dom.video.play().catch(function(){}); else Dom.video.pause(); } e.preventDefault(); return; }
  if (k === 'MediaPlay'  || kc === KEY.PLAY)  { if (Dom.video) Dom.video.play().catch(function(){});  e.preventDefault(); return; }
  if (k === 'MediaPause' || kc === KEY.PAUSE) { if (Dom.video) Dom.video.pause();                     e.preventDefault(); return; }
  if (k === 'MediaStop'  || kc === KEY.STOP)  {
    cancelPreview(); if (player) player.unload().catch(function(){}); stopStallWatchdog(); clearSleepTimer();
    if (Dom.video) { Dom.video.pause(); Dom.video.removeAttribute('src'); }
    setStatus('Stopped', 'idle'); finishLoadBar(); e.preventDefault(); return;
  }
  if (k === 'MediaFastForward' || kc === KEY.FF    || k === 'ChannelUp'   || kc === KEY.CH_UP)   { moveSel(+1); e.preventDefault(); return; }
  if (k === 'MediaRewind'      || kc === KEY.RW    || k === 'ChannelDown' || kc === KEY.CH_DOWN)  { moveSel(-1); e.preventDefault(); return; }

  if (k === 'ColorF0Red'    || kc === KEY.RED)    { switchTab((plIdx + 1) % TAB_TOTAL()); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || kc === KEY.GREEN)  { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || kc === KEY.YELLOW) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || kc === KEY.BLUE)   { if (hasPlayed) toggleFS(); e.preventDefault(); return; }

  if (k === 'VolumeUp'   || kc === KEY.VOL_UP)   { if (Dom.video) Dom.video.volume = Math.min(1, Dom.video.volume + 0.05); e.preventDefault(); return; }
  if (k === 'VolumeDown' || kc === KEY.VOL_DOWN)  { if (Dom.video) Dom.video.volume = Math.max(0, Dom.video.volume - 0.05); e.preventDefault(); return; }
  if (k === 'Mute'       || kc === KEY.MUTE)      { if (Dom.video) Dom.video.muted  = !Dom.video.muted; e.preventDefault(); return; }
});

document.addEventListener('tizenhwkey', function (e) {
  if (e.keyName === 'back') {
    if (Dom.portal && Dom.portal.style.display !== 'none') {
      if (jpInPlayer) jpExitPlayer(); else hideJioPortal();
      return;
    }
    if (isFullscreen) { exitFS(); return; }
    var anyModal = (Dom.playlistModal && Dom.playlistModal.style.display === 'flex') ||
                   (Dom.jiotvModal    && Dom.jiotvModal.style.display    === 'flex');
    if (anyModal) { closeAllModals(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (ex) {}
  }
});

// ── Modals ─────────────────────────────────────────────────────────
function closeAllModals() {
  if (Dom.playlistModal) Dom.playlistModal.style.display = 'none';
  if (Dom.jiotvModal)    Dom.jiotvModal.style.display    = 'none';
  setFocus('list');
}
function openAddPlaylistModal() {
  if (Dom.playlistName) Dom.playlistName.value = '';
  if (Dom.playlistUrl)  Dom.playlistUrl.value  = '';
  if (Dom.playlistModal) Dom.playlistModal.style.display = 'flex';
  setTimeout(function () { if (Dom.playlistName) Dom.playlistName.focus(); }, 120);
}
function handleSavePlaylist() {
  var name = Dom.playlistName ? Dom.playlistName.value.trim() : '';
  var url  = Dom.playlistUrl  ? Dom.playlistUrl.value.trim()  : '';
  if (!name || !url) { showToast('Please enter both name and URL'); return; }
  if (addCustomPlaylist(name, url)) { showToast('"' + name + '" added'); Dom.playlistModal.style.display = 'none'; }
  else showToast('Already exists or invalid URL');
}

// ── Playlist management ────────────────────────────────────────────
function loadCustomPlaylists() {
  try { var s = lsGet(CUSTOM_PLAYLISTS_KEY); customPlaylists = s ? JSON.parse(s) : []; }
  catch (e) { customPlaylists = []; }
}
function saveCustomPlaylists() { lsSet(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists)); }
function addCustomPlaylist(name, url) {
  if (!name || !url) return false;
  if (customPlaylists.some(function (p) { return p.url.toLowerCase() === url.toLowerCase(); })) return false;
  customPlaylists.push({ name: name, url: url });
  saveCustomPlaylists();
  rebuildAllPlaylists();
  return true;
}
function rebuildAllPlaylists() {
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);
  if (plIdx >= TAB_FAV()) plIdx = 0;
  rebuildTabs(); loadPlaylist();
}

// ── Tab builder ────────────────────────────────────────────────────
function rebuildTabs() {
  if (!Dom.tabBar) return;
  Dom.tabBar.innerHTML = '';
  allPlaylists.forEach(function (pl, i) {
    var btn = document.createElement('button');
    btn.className = 'tab';
    if (!jiotvMode && i === plIdx) btn.classList.add('active');
    btn.textContent = pl.name;
    btn.dataset.tabIdx = String(i);
    btn.addEventListener('click', function () { switchTab(i); });
    Dom.tabBar.appendChild(btn);
  });
  var fBtn = document.createElement('button');
  fBtn.className = 'tab fav-tab';
  fBtn.dataset.tabIdx = String(TAB_FAV());
  if (!jiotvMode && plIdx === TAB_FAV()) fBtn.classList.add('active');
  fBtn.textContent = '★ Favs';
  fBtn.addEventListener('click', function () { switchTab(TAB_FAV()); });
  Dom.tabBar.appendChild(fBtn);

  var jBtn = document.createElement('button');
  jBtn.className = 'tab jiotv-tab';
  jBtn.dataset.tabIdx = String(TAB_JIOTV());
  if (jiotvMode) jBtn.classList.add('active');
  jBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="opacity:0.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> JioTV';
  jBtn.addEventListener('click', function () { switchTab(TAB_JIOTV()); });
  Dom.tabBar.appendChild(jBtn);

  if (focusArea === 'tabs') syncTabHighlight();
}

function switchTab(idx) {
  var tFav = TAB_FAV(), tJ = TAB_JIOTV();
  if (idx < tFav) {
    jiotvMode = false; plIdx = idx; rebuildTabs(); loadPlaylist(); saveMode();
  } else if (idx === tFav) {
    jiotvMode = false; plIdx = tFav; rebuildTabs(); showFavourites(); saveMode();
  } else if (idx === tJ) {
    if (jiotvClient && jiotvClient.logged_in) openJioPortalDirect();
    else openJioLogin();
  }
  setFocus('list');
}
function openJioPortalDirect() {
  jiotvMode = true; plIdx = TAB_JIOTV(); rebuildTabs();
  if (jiotvChannels.length === 0) {
    loadJioChannels().then(function () { showJioPortal(); });
  } else {
    jpFiltered = jiotvChannels.slice();
    showJioPortal();
  }
  saveMode();
}

// ── JioTV connect modal ────────────────────────────────────────────
function setJioStatus(msg, color) {
  if (!Dom.jiotvStatus) return;
  Dom.jiotvStatus.textContent = msg;
  Dom.jiotvStatus.style.color  = color || 'var(--text-sec)';
}
function openJioLogin() {
  var saved = lsGet(JIOTV_SERVER_KEY) || '';
  // Privacy: never show the actual IP — use placeholder
  if (Dom.jiotvServer) Dom.jiotvServer.value = saved ? '••• (saved — tap Scan to re-detect)' : '';
  setJioStatus('', '');
  if (Dom.jiotvAccount) Dom.jiotvAccount.textContent = '';
  if (Dom.jiotvModal) Dom.jiotvModal.style.display = 'flex';
  setTimeout(function () { if (!saved && Dom.jiotvServer) Dom.jiotvServer.focus(); }, 120);

  if (!saved) {
    setJioStatus('🔍 Scanning 172.20.10.1–200…', 'var(--gold)');
    JioTVClient.discover(null).then(function (found) {
      if (found) {
        lsSet(JIOTV_SERVER_KEY, found);
        if (Dom.jiotvServer) Dom.jiotvServer.value = '';
        setJioStatus('✅ Server found on your network', 'var(--green)');
      } else {
        setJioStatus('⚠️ Not found. Enter URL manually.', 'var(--red)');
      }
    });
  }
}
async function jiotvConnectAction() {
  var fieldVal = Dom.jiotvServer ? Dom.jiotvServer.value.trim() : '';
  // If field shows placeholder, use saved value
  var sv = (fieldVal.startsWith('•') || fieldVal === '') ? (lsGet(JIOTV_SERVER_KEY) || '') : fieldVal;
  if (!sv) { setJioStatus('Server URL required', 'var(--red)'); return; }
  if (!sv.startsWith('http')) sv = 'http://' + sv;
  lsSet(JIOTV_SERVER_KEY, sv);
  if (Dom.jiotvServer) Dom.jiotvServer.value = '••• (connecting…)';
  if (Dom.jiotvConnect) Dom.jiotvConnect.disabled = true;
  setJioStatus('Connecting…', 'var(--gold)');
  try {
    var alive = await JioTVClient.probe(sv, 4000);
    if (!alive) {
      setJioStatus('❌ Cannot reach server. Check URL and ensure JioTV Go is running.', 'var(--red)');
      if (Dom.jiotvServer) Dom.jiotvServer.value = '';
      return;
    }
    var c = new JioTVClient({ serverUrl: sv, timeout: 12000 });
    setJioStatus('Checking login status…', 'var(--gold)');
    var res = await c.checkStatus();
    if (!res.status) {
      setJioStatus('⚠️ Server found but not logged in. Open JioTV Go on your phone and login via OTP first, then retry.', 'var(--gold)');
      if (Dom.jiotvServer) Dom.jiotvServer.value = '';
      return;
    }
    jiotvClient = c; jiotvClient.logged_in = true; jiotvMode = true;
    if (Dom.jiotvAccount) Dom.jiotvAccount.textContent = '✅ Connected · ' + res.channelCount + ' channels';
    setJioStatus('Loading channels…', 'var(--gold)');
    plIdx = TAB_JIOTV(); rebuildTabs();
    await loadJioChannels();
    if (Dom.jiotvModal) Dom.jiotvModal.style.display = 'none';
    showToast('JioTV connected! ' + res.channelCount + ' ch');
    saveMode();
    showJioPortal();
  } catch (err) {
    setJioStatus('Failed: ' + err.message, 'var(--red)');
    if (Dom.jiotvServer) Dom.jiotvServer.value = '';
  } finally {
    if (Dom.jiotvConnect) Dom.jiotvConnect.disabled = false;
  }
}

// ── Load JioTV channels — AppCache aware ───────────────────────────
async function loadJioChannels() {
  if (!jiotvClient) return;

  // 1. Try IDB cache
  if (window.AppCache) {
    var cached = await AppCache.getJioChannels();
    if (cached && cached.length > 0) {
      jiotvChannels = cached;
      jpFiltered    = cached.slice();
      channels = cached; allChannels = cached.slice(); filtered = cached.slice();
      selectedIndex = 0; renderList(); setLbl('JIOTV', cached.length);
      setStatus('JioTV · ' + cached.length + ' ch (cached)', 'playing');
      // Refresh in background (invalidate client cache first)
      jiotvClient.invalidateCache();
      _refreshJioInBackground();
      return;
    }
  }

  // 2. Fetch live
  setStatus('Loading JioTV…', 'loading'); startLoadBar();
  try {
    var list = await jiotvClient.getChannelsFormatted();
    _applyJioChannels(list);
    if (window.AppCache) AppCache.setJioChannels(list);
    finishLoadBar();
  } catch (err) {
    setStatus('JioTV load failed', 'error'); finishLoadBar();
    console.error('[JioTV] loadJioChannels:', err);
  }
}
function _applyJioChannels(list) {
  jiotvChannels = list; jpFiltered = list.slice();
  channels = list; allChannels = list.slice(); filtered = list.slice();
  selectedIndex = 0; renderList(); setLbl('JIOTV', list.length);
  setStatus('JioTV · ' + list.length + ' ch', 'playing');
}
async function _refreshJioInBackground() {
  try {
    var list = await jiotvClient.getChannelsFormatted();
    _applyJioChannels(list);
    if (window.AppCache) AppCache.setJioChannels(list);
    // Rebuild grid if portal is open
    if (Dom.portal && Dom.portal.style.display !== 'none') {
      jpApplyFilters();
    }
  } catch (e) {}
}

async function loadSavedJiotv() {
  var sv = lsGet(JIOTV_SERVER_KEY); if (!sv) return false;
  try {
    var alive = await JioTVClient.probe(sv, 3000);
    if (!alive) {
      showToast('JioTV: scanning LAN…');
      var found = await JioTVClient.discover(sv);
      if (found) { lsSet(JIOTV_SERVER_KEY, found); sv = found; }
      else return false;
    }
    var c   = new JioTVClient({ serverUrl: sv, timeout: 10000 });
    var res = await c.checkStatus();
    if (res.status) {
      jiotvClient = c; jiotvClient.logged_in = true; jiotvMode = true;
      plIdx = TAB_JIOTV(); rebuildTabs();
      await loadJioChannels();
      showToast('JioTV reconnected'); saveMode(); return true;
    }
  } catch (e) { console.warn('[JioTV] loadSaved:', e.message); }
  return false;
}

// ── Mode save/restore ──────────────────────────────────────────────
function saveMode() {
  if (jiotvMode) lsSet('iptv:mode', 'jiotv');
  else { lsSet('iptv:mode', 'm3u'); lsSet('iptv:lastM3uIndex', String(plIdx)); }
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
  plIdx  = (!isNaN(si) && si < allPlaylists.length) ? si : 0;
  rebuildTabs(); loadPlaylist();
}

// ── Boot ────────────────────────────────────────────────────────────
(async function init() {
  registerKeys();
  loadAvSync();
  loadCustomPlaylists();
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);

  VS.init(Dom.channelList);
  await initShaka();
  buildAvSyncBar();
  startNetworkMonitoring();
  await loadMode();

  if (Dom.overlayTop)    Dom.overlayTop.classList.remove('info-visible');
  if (Dom.overlayBottom) Dom.overlayBottom.classList.remove('info-visible');
  overlaysVisible = false;

  // Playlist modal events
  if (Dom.addPlaylistBtn)    Dom.addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if (Dom.savePlaylistBtn)   Dom.savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if (Dom.cancelPlaylistBtn) Dom.cancelPlaylistBtn.addEventListener('click', function () {
    Dom.playlistModal.style.display = 'none'; setFocus('list');
  });
  if (Dom.playlistModal) Dom.playlistModal.addEventListener('click', function (e) {
    if (e.target === Dom.playlistModal) { Dom.playlistModal.style.display = 'none'; setFocus('list'); }
  });
  [Dom.playlistName, Dom.playlistUrl].forEach(function (inp) {
    if (inp) inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.keyCode === 13) handleSavePlaylist(); });
  });

  // JioTV modal events
  if (Dom.jiotvConnect) Dom.jiotvConnect.addEventListener('click', jiotvConnectAction);
  if (Dom.jiotvCancel)  Dom.jiotvCancel.addEventListener('click',  closeAllModals);
  if (Dom.jiotvModal)   Dom.jiotvModal.addEventListener('click', function (e) {
    if (e.target === Dom.jiotvModal) closeAllModals();
  });
  if (Dom.jiotvServer) {
    Dom.jiotvServer.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.keyCode === 13) jiotvConnectAction();
    });
    // Clear placeholder on focus so user can type a URL
    Dom.jiotvServer.addEventListener('focus', function () {
      if (Dom.jiotvServer.value.startsWith('•')) Dom.jiotvServer.value = '';
    });
  }
  if (Dom.jiotvScan) {
    Dom.jiotvScan.addEventListener('click', function () {
      setJioStatus('🔍 Scanning LAN…', 'var(--gold)');
      Dom.jiotvScan.disabled = true;
      JioTVClient.discover(null).then(function (found) {
        Dom.jiotvScan.disabled = false;
        if (found) {
          lsSet(JIOTV_SERVER_KEY, found);
          if (Dom.jiotvServer) Dom.jiotvServer.value = '';
          setJioStatus('✅ Server found on your network', 'var(--green)');
        } else {
          setJioStatus('❌ Not found. Enter manually.', 'var(--red)');
        }
      });
    });
  }

  // Auto-show portal if JioTV mode restored
  if (jiotvMode && jiotvChannels.length > 0) {
    setTimeout(function () { showJioPortal(); }, 300);
  }
})();
