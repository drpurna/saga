// ================================================================
// SAGA IPTV — app.js v22.0 | Samsung Tizen OS9 TV
// BN59-01199F remote · GPU list · Channel dial fix · Premium UI
// ================================================================

'use strict';

// ── Constants ─────────────────────────────────────────────────────
const FAV_KEY              = 'iptv:favs';
const PLAYLIST_KEY         = 'iptv:lastPl';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const AV_SYNC_KEY          = 'iptv:avSync';
const PREVIEW_DELAY        = 600;

const DEFAULT_PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

// Aspect ratio modes
const AR_MODES = [
  { cls: '',         label: 'Native' },
  { cls: 'ar-fill',  label: 'Fill'   },
  { cls: 'ar-cover', label: 'Crop'   },
  { cls: 'ar-wide',  label: 'Wide'   },
];

// ── Samsung BN59-01199F Keycodes ──────────────────────────────────
// Verified against Samsung Smart TV key registry
const KEY = {
  UP:           38,
  DOWN:         40,
  LEFT:         37,
  RIGHT:        39,
  ENTER:        13,
  BACK:         10009,
  EXIT:         10182,
  INFO:         457,
  GUIDE:        458,
  PLAY:         415,
  PAUSE:        19,
  PLAY_PAUSE:   10252,
  STOP:         413,
  FF:           417,
  RW:           412,
  CH_UP:        427,
  CH_DOWN:      428,
  PAGE_UP:      33,
  PAGE_DOWN:    34,
  RED:          403,
  GREEN:        404,
  YELLOW:       405,
  BLUE:         406,
  VOL_UP:       447,
  VOL_DOWN:     448,
  MUTE:         449,
  // Number keys (keyboard row)
  D0: 48, D1: 49, D2: 50, D3: 51, D4: 52,
  D5: 53, D6: 54, D7: 55, D8: 56, D9: 57,
  // Numpad
  N0: 96, N1: 97, N2: 98, N3: 99, N4: 100,
  N5: 101,N6: 102,N7: 103,N8: 104,N9: 105,
};

// ── Playlists ─────────────────────────────────────────────────────
let allPlaylists    = [];
let customPlaylists = [];
let plIdx           = 0;
let xtreamTabIndex  = -1;
let lastM3uIndex    = 0;

// ── AV Sync ───────────────────────────────────────────────────────
let avSyncOffset   = 0;
let avSyncLabel    = null;
const AV_SYNC_STEP = 50;
const AV_SYNC_MAX  = 500;

// ── Sleep timer ───────────────────────────────────────────────────
let sleepTimer   = null;
let sleepMinutes = 0;

// ── Auto-reconnect / stall watchdog ──────────────────────────────
let stallWatchdog  = null;
let lastPlayTime   = 0;
let reconnectCount = 0;
const MAX_RECONNECT = 5;

// ── DOM refs ──────────────────────────────────────────────────────
const searchInput        = document.getElementById('searchInput');
const searchWrap         = document.getElementById('searchWrap');
const searchClear        = document.getElementById('searchClear');
const tabBar             = document.getElementById('tabBar');
const channelListEl      = document.getElementById('channelList');
const countBadge         = document.getElementById('countBadge');
const listLabel          = document.getElementById('listLabel');
const nowPlayingEl       = document.getElementById('nowPlaying');
const npChNumEl          = document.getElementById('npChNum');
const statusBadge        = document.getElementById('statusBadge');
const video              = document.getElementById('video');
const videoWrap          = document.getElementById('videoWrap');
const videoOverlay       = document.getElementById('videoOverlay');
const fsHint             = document.getElementById('fsHint');
const loadBar            = document.getElementById('loadBar');
const chDialer           = document.getElementById('chDialer');
const chDialerNum        = document.getElementById('chDialerNum');
const arBtn              = document.getElementById('arBtn');
const addPlaylistBtn     = document.getElementById('addPlaylistBtn');
const playlistModal      = document.getElementById('addPlaylistModal');
const playlistName       = document.getElementById('playlistName');
const playlistUrl        = document.getElementById('playlistUrl');
const savePlaylistBtn    = document.getElementById('savePlaylistBtn');
const cancelPlaylistBtn  = document.getElementById('cancelPlaylistBtn');
const overlayTop         = document.getElementById('overlayTop');
const overlayBottom      = document.getElementById('overlayBottom');
const overlayChannelName = document.getElementById('overlayChannelName');
const overlayChannelTech = document.getElementById('overlayChannelTech');
const overlayProgramTitle= document.getElementById('overlayProgramTitle');
const overlayProgramDesc = document.getElementById('overlayProgramDesc');
const nextProgramInfo    = document.getElementById('nextProgramInfo');
const programInfoBox     = document.getElementById('programInfoBox');

// ── State ─────────────────────────────────────────────────────────
let channels        = [];
let allChannels     = [];
let filtered        = [];
let selectedIndex   = 0;
let focusArea       = 'list';
let isFullscreen    = false;
let hasPlayed       = false;
let player          = null;
let arIdx           = 0;
let preFullscreenArMode = null;
let fsHintTimer     = null;
let loadBarTimer    = null;
let previewTimer    = null;
let dialBuffer      = '';
let dialTimer       = null;
let favSet          = new Set();
let networkQuality  = 'online';
let connectionMonitor = null;
let overlaysVisible = false;
let currentPlayUrl  = '';

// ── Xtream state ──────────────────────────────────────────────────
let xtreamClient      = null;
let xtreamMode        = false;
let xtreamCategories  = [];
let xtreamChannelList = [];

// ── Xtream DOM ────────────────────────────────────────────────────
const xtreamModal        = document.getElementById('xtreamLoginModal');
const xtreamServerUrl    = document.getElementById('xtreamServerUrl');
const xtreamUsername     = document.getElementById('xtreamUsername');
const xtreamPassword     = document.getElementById('xtreamPassword');
const xtreamLoginBtn     = document.getElementById('xtreamLoginBtn');
const xtreamCancelBtn    = document.getElementById('xtreamCancelBtn');
const xtreamLoginStatus  = document.getElementById('xtreamLoginStatus');
const xtreamAccountInfo  = document.getElementById('xtreamAccountInfo');

// ── localStorage helpers ──────────────────────────────────────────
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('[ls] set failed', key, e.name); }
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── Favourites ────────────────────────────────────────────────────
(function loadFavs() {
  try { var r = lsGet(FAV_KEY); if (r) favSet = new Set(JSON.parse(r)); } catch (e) {}
})();
function saveFavs() { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)  { return favSet.has(ch.url); }
function toggleFav(ch) {
  var k = ch.url;
  if (favSet.has(k)) favSet.delete(k); else favSet.add(k);
  saveFavs();
  if (plIdx === allPlaylists.length + 1) showFavourites();
  if (VS.refresh) VS.refresh();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(function(c) { return favSet.has(c.url); });
  selectedIndex = 0;
  renderList();
  if (listLabel) listLabel.textContent = 'FAVOURITES · ' + filtered.length;
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ──────────────────────────────────────────────────────────
var toastEl = document.getElementById('toast');
var toastTm = null;
function showToast(msg, duration) {
  if (!toastEl) return;
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(function() { toastEl.style.opacity = '0'; }, duration || 2200);
}

// ── Status / load-bar ─────────────────────────────────────────────
function setStatus(t, c) {
  statusBadge.textContent = t;
  statusBadge.className = 'status-badge ' + (c || 'idle');
}
function startLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '0%';
  loadBar.classList.add('active');
  var w = 0;
  var tick = function() {
    w = Math.min(w + Math.random() * 9, 85);
    loadBar.style.width = w + '%';
    if (w < 85) loadBarTimer = setTimeout(tick, 200);
  };
  loadBarTimer = setTimeout(tick, 80);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '100%';
  setTimeout(function() { loadBar.classList.remove('active'); loadBar.style.width = '0%'; }, 450);
}

// ── M3U helpers ───────────────────────────────────────────────────
function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi, '')
    .replace(/[\|\-–—]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/>/g, '')
    .trim();
}
function parseM3U(text) {
  var lines = String(text || '').split(/\r?\n/);
  var out   = [];
  var meta  = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      var namePart = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      var gm  = line.match(/group-title="([^"]+)"/i);
      var lm  = line.match(/tvg-logo="([^"]+)"/i);
      meta = { name: cleanName(namePart) || namePart, group: gm ? gm[1] : 'Other', logo: lm ? lm[1] : '' };
      continue;
    }
    if (!line.startsWith('#') && meta) {
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
  if (!player) return;
  try {
    var stats  = player.getStats ? player.getStats() : null;
    var tracks = player.getVariantTracks ? player.getVariantTracks() : [];
    var vt     = tracks.find(function(t) { return t.active; });
    var bitrate = stats ? (stats.streamBandwidth || 0) : 0;
    var width   = vt ? (vt.width  || 0) : 0;
    var height  = vt ? (vt.height || 0) : 0;
    var fps     = vt ? (vt.frameRate || 0) : 0;
    var codec   = vt ? (vt.videoCodec || '') : '';
    if (overlayChannelTech) {
      var parts = [];
      if (width && height) parts.push(width + '×' + height);
      if (bitrate) parts.push((bitrate / 1e6).toFixed(1) + ' Mbps');
      if (fps)     parts.push(Math.round(fps) + ' fps');
      if (codec)   parts.push(codec);
      overlayChannelTech.textContent = parts.join(' · ');
    }
  } catch (e) { console.warn('[tech]', e); }
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
      var target = video.currentTime - (avSyncOffset / 1000);
      if (target >= 0) video.currentTime = target;
    }
  } catch (e) { console.warn('[avSync]', e); }
  updateAvSyncLabel();
}
function adjustAvSync(sign) {
  avSyncOffset = Math.max(-AV_SYNC_MAX, Math.min(AV_SYNC_MAX, avSyncOffset + sign * AV_SYNC_STEP));
  saveAvSync();
  applyAvSync();
  showToast('AV Sync: ' + (avSyncOffset === 0 ? '0 ms' : (avSyncOffset > 0 ? '+' : '') + avSyncOffset + ' ms'));
  updateAvSyncLabel();
}
function resetAvSync() {
  avSyncOffset = 0;
  saveAvSync();
  updateAvSyncLabel();
  showToast('AV Sync reset to 0');
}
function updateAvSyncLabel() {
  if (!avSyncLabel) return;
  avSyncLabel.textContent = avSyncOffset === 0 ? 'AV: 0' : 'AV: ' + (avSyncOffset > 0 ? '+' : '') + avSyncOffset + 'ms';
  avSyncLabel.style.color = avSyncOffset === 0 ? 'var(--text-muted)' : 'var(--gold)';
}
function buildAvSyncBar() {
  var controls = document.querySelector('.player-controls');
  if (!controls) return;
  var wrap = document.createElement('div');
  wrap.id = 'avSyncWrap';
  var btnM = document.createElement('button');
  btnM.className = 'ar-btn';
  btnM.textContent = '◁ Audio';
  btnM.title = 'Audio leads video — shift audio 50ms';
  btnM.addEventListener('click', function() { adjustAvSync(-1); });
  avSyncLabel = document.createElement('span');
  avSyncLabel.style.cssText = 'font-size:11px;min-width:60px;text-align:center;cursor:pointer;white-space:nowrap;font-family:var(--font-ui);font-weight:700;color:var(--text-muted);';
  avSyncLabel.title = 'Click to reset AV sync';
  avSyncLabel.addEventListener('click', resetAvSync);
  updateAvSyncLabel();
  var btnP = document.createElement('button');
  btnP.className = 'ar-btn';
  btnP.textContent = 'Audio ▷';
  btnP.title = 'Audio lags video — shift audio 50ms';
  btnP.addEventListener('click', function() { adjustAvSync(+1); });
  wrap.appendChild(btnM);
  wrap.appendChild(avSyncLabel);
  wrap.appendChild(btnP);
  controls.insertBefore(wrap, controls.firstChild);
}

// ── Sleep timer ───────────────────────────────────────────────────
function setSleepTimer(minutes) {
  clearSleepTimer();
  sleepMinutes = minutes;
  if (!minutes) { showToast('Sleep timer: Off'); return; }
  showToast('Sleep timer: ' + minutes + ' min');
  sleepTimer = setTimeout(function() {
    video.pause();
    if (player) player.unload();
    stopStallWatchdog();
    setStatus('Sleep timer — stopped', 'idle');
    showToast('Goodnight! Playback stopped.', 4000);
    sleepTimer = null; sleepMinutes = 0;
  }, minutes * 60000);
}
function clearSleepTimer() {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
}
function cycleSleepTimer() {
  var opts = [0, 15, 30, 60, 90];
  var idx  = opts.indexOf(sleepMinutes);
  setSleepTimer(opts[(idx + 1) % opts.length]);
}

// ── Stall watchdog ────────────────────────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog();
  reconnectCount = 0;
  lastPlayTime   = Date.now();
  stallWatchdog  = setInterval(function() {
    if (video.paused || !hasPlayed || !currentPlayUrl) return;
    if (Date.now() - lastPlayTime > 9000) {
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        setStatus('Reconnecting (' + reconnectCount + '/' + MAX_RECONNECT + ')...', 'loading');
        startLoadBar();
        doPlay(currentPlayUrl).then(function() { reconnectCount = 0; }).catch(function(){});
      } else {
        setStatus('Stream lost — try another channel', 'error');
        stopStallWatchdog();
      }
      lastPlayTime = Date.now();
    }
  }, 4000);
}
function stopStallWatchdog() {
  if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
}
video.addEventListener('timeupdate', function() {
  if (!video.paused) lastPlayTime = Date.now();
});

// ══════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL — GPU-accelerated, smooth on Tizen OS9
// Uses transform:translateY for GPU compositing, no layout thrash
// ══════════════════════════════════════════════════════════════════
var VS = {
  ITEM_H: 96,    // Must match CSS --item-h value + gap (86px item + 10px gap)
  GAP:    8,     // Gap between items
  OVERSCAN: 4,
  c: null, inner: null, vh: 0, st: 0,
  total: 0, rs: -1, re: -1,
  nodePool: [],   // Recycled nodes
  activeNodes: {},// Map: index -> node
  raf: null,

  init: function(el) {
    this.c = el;
    // Clear any existing children
    el.innerHTML = '';
    this.inner = document.createElement('ul');
    this.inner.id = 'vsInner';
    this.inner.style.cssText = 'position:relative;width:100%;margin:0;padding:0;list-style:none;';
    this.c.appendChild(this.inner);
    this.vh = this.c.clientHeight || 720;
    var self = this;
    this.c.addEventListener('scroll', function() {
      if (self.raf) return;
      self.raf = requestAnimationFrame(function() {
        self.raf = null;
        self.st = self.c.scrollTop;
        self.paint();
      });
    }, { passive: true });
    // Watch for resize
    if (window.ResizeObserver) {
      new ResizeObserver(function() {
        self.vh = self.c.clientHeight || 720;
        self.rs = -1; self.re = -1;
        self.paint();
      }).observe(el);
    }
  },

  setData: function(n) {
    this.total = n;
    this.rs = -1; this.re = -1;
    // Return all active nodes to pool
    for (var idx in this.activeNodes) {
      var nd = this.activeNodes[idx];
      nd.style.display = 'none';
      nd._i = -1;
      this.nodePool.push(nd);
    }
    this.activeNodes = {};
    // Set inner height
    var totalH = n > 0 ? (n * (this.ITEM_H + this.GAP) - this.GAP + 16) : 0;
    this.inner.style.height = totalH + 'px';
    this.c.scrollTop = 0;
    this.st = 0;
    this.vh = this.c.clientHeight || 720;
    this.paint();
  },

  scrollToIndex: function(idx) {
    var itemTop = idx * (this.ITEM_H + this.GAP);
    var itemBot = itemTop + this.ITEM_H;
    var st      = this.c.scrollTop;
    var pad     = 20;
    if (itemTop < st + pad) {
      this.c.scrollTop = Math.max(0, itemTop - pad);
    } else if (itemBot > st + this.vh - pad) {
      this.c.scrollTop = itemBot - this.vh + pad;
    }
    this.st = this.c.scrollTop;
    this.paint();
  },

  scrollToIndexCentered: function(idx) {
    var center = idx * (this.ITEM_H + this.GAP) - (this.vh / 2) + (this.ITEM_H / 2);
    this.c.scrollTop = Math.max(0, center);
    this.st = this.c.scrollTop;
    this.rs = -1; this.re = -1;
    this.paint();
  },

  paint: function() {
    if (!this.total) return;
    var H   = this.ITEM_H + this.GAP;
    var os  = this.OVERSCAN;
    var start = Math.max(0, Math.floor(this.st / H) - os);
    var end   = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);

    // Remove items out of window
    for (var oldIdx in this.activeNodes) {
      var oi = parseInt(oldIdx, 10);
      if (oi < start || oi > end) {
        var nd = this.activeNodes[oi];
        nd.style.display = 'none';
        nd._i = -1;
        this.nodePool.push(nd);
        delete this.activeNodes[oi];
      }
    }

    // Add new items
    for (var i = start; i <= end; i++) {
      if (this.activeNodes[i]) continue;
      var li = this.nodePool.pop() || this.createNode();
      this.buildItem(li, i);
      if (li._pooled) { li.style.display = ''; li._pooled = false; }
      else this.inner.appendChild(li);
      this.activeNodes[i] = li;
    }

    // Update active class
    for (var idx2 in this.activeNodes) {
      var n2  = this.activeNodes[idx2];
      var on2 = (parseInt(idx2, 10) === selectedIndex);
      if (on2 !== n2._on) {
        n2._on = on2;
        n2.classList.toggle('active', on2);
      }
    }
  },

  createNode: function() {
    var li = document.createElement('li');
    li._i = -1; li._on = false; li._pooled = true;
    li.style.display = 'none';
    // GPU compositing hint
    li.style.willChange = 'transform';
    li.style.backfaceVisibility = 'hidden';
    li.style.transform = 'translateZ(0)';
    this.inner.appendChild(li);
    var self = this;
    li.addEventListener('click', function() {
      if (li._i < 0) return;
      selectedIndex = li._i;
      self.refresh();
      cancelPreview();
      schedulePreview();
    });
    return li;
  },

  buildItem: function(li, i) {
    li._i = i; li._on = false;
    // Position via top (layout in CSS is position:absolute)
    var topPx = i * (this.ITEM_H + this.GAP) + 8; // 8px top padding
    li.style.cssText = [
      'position:absolute',
      'left:10px',
      'right:10px',
      'top:' + topPx + 'px',
      'height:' + this.ITEM_H + 'px',
      'display:flex',
      'align-items:center',
      'gap:14px',
      'padding:0 14px',
      'border-radius:14px',
      'will-change:transform',
      'backface-visibility:hidden',
      'transform:translateZ(0)',
    ].join(';');

    var ch = filtered[i];
    var PLACEHOLDER = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='62' height='62' viewBox='0 0 24 24' fill='none' stroke='%23505060' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";

    li.innerHTML =
      '<div class="ch-logo">' +
        '<img src="' + esc(ch.logo || PLACEHOLDER) + '" ' +
          'onerror="this.onerror=null;this.src=\'' + PLACEHOLDER + '\'" ' +
          'loading="lazy">' +
      '</div>' +
      '<div class="ch-info">' +
        '<div class="ch-name">' + esc(ch.name) + '</div>' +
        (ch.group ? '<div class="ch-group">' + esc(ch.group) + '</div>' : '') +
      '</div>' +
      (isFav(ch) ? '<div class="ch-fav">★</div>' : '') +
      '<div class="ch-num">' + (i + 1) + '</div>';

    if (i === selectedIndex) { li._on = true; li.classList.add('active'); }
    else li.classList.remove('active');
  },

  refresh: function() {
    for (var idx in this.activeNodes) {
      var nd  = this.activeNodes[idx];
      var i   = parseInt(idx, 10);
      var on  = (i === selectedIndex);
      if (on !== nd._on) { nd._on = on; nd.classList.toggle('active', on); }
    }
  },

  // Rebuild visible items (e.g. after fav toggle)
  rebuildVisible: function() {
    for (var idx in this.activeNodes) {
      this.buildItem(this.activeNodes[idx], parseInt(idx, 10));
    }
  }
};

// ── Render list ───────────────────────────────────────────────────
function renderList() {
  if (countBadge) countBadge.textContent = String(filtered.length);
  VS.setData(filtered.length);
  if (filtered.length) VS.scrollToIndex(selectedIndex);
}

// ── Search ────────────────────────────────────────────────────────
var sdTm = null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm = setTimeout(function() {
    var q = searchInput.value.trim().toLowerCase();
    filtered = !q ? channels.slice()
      : channels.filter(function(c) {
          return c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q);
        });
    selectedIndex = 0;
    renderList();
    if (listLabel) listLabel.textContent = q ? ('SEARCH · ' + filtered.length) : 'CHANNELS · ' + filtered.length;
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
searchInput.addEventListener('input', function() {
  searchWrap.classList.toggle('active', searchInput.value.length > 0);
  applySearch();
});
if (searchClear) searchClear.addEventListener('click', clearSearch);

// ── XHR fetch ─────────────────────────────────────────────────────
function xhrFetch(url, ms, cb) {
  var done = false, xhr = new XMLHttpRequest();
  var tid = setTimeout(function() {
    if (done) return; done = true; xhr.abort(); cb(new Error('Timeout ' + ms + 'ms'), null);
  }, ms);
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4 || done) return;
    done = true; clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };
  xhr.onerror = function() {
    if (done) return; done = true; clearTimeout(tid); cb(new Error('Network error'), null);
  };
  xhr.open('GET', url, true);
  xhr.send();
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

// ── Playlist loading ──────────────────────────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();
  if (plIdx === allPlaylists.length + 1 && !urlOv) { showFavourites(); return; }
  var rawUrl = urlOv || (plIdx < allPlaylists.length ? allPlaylists[plIdx].url : null);
  if (!rawUrl) return;

  var cacheKey     = 'plCache:' + rawUrl;
  var cacheTimeKey = 'plCacheTime:' + rawUrl;
  try {
    var cached    = lsGet(cacheKey);
    var cacheTime = parseInt(lsGet(cacheTimeKey) || '0', 10);
    if (cached && cached.length > 100 && (Date.now() - cacheTime) < 600000) {
      onLoaded(cached, true); return;
    }
  } catch (e) {}

  setStatus('Loading...', 'loading');
  startLoadBar();

  function tryDirect() {
    xhrFetch(rawUrl, 30000, function(err, text) {
      if (!err && text && text.length > 100) { persist(text); finishLoadBar(); onLoaded(text, false); return; }
      var mirror = mirrorUrl(rawUrl);
      if (mirror) {
        setStatus('Retrying via mirror...', 'loading');
        xhrFetch(mirror, 30000, function(err2, text2) {
          finishLoadBar();
          if (!err2 && text2 && text2.length > 100) { persist(text2); onLoaded(text2, false); }
          else setStatus('Failed — check network', 'error');
        });
      } else { finishLoadBar(); setStatus('Failed — no mirror', 'error'); }
    });
  }
  tryDirect();

  function persist(text) {
    try { lsSet(cacheKey, text); lsSet(cacheTimeKey, String(Date.now())); } catch (e) {}
  }
  function onLoaded(text, fromCache) {
    channels    = parseM3U(text);
    allChannels = channels.slice();
    filtered    = channels.slice();
    selectedIndex = 0;
    renderList();
    if (listLabel) listLabel.textContent = 'CHANNELS · ' + channels.length;
    lsSet(PLAYLIST_KEY, String(plIdx));
    setStatus('Ready · ' + channels.length + ' ch' + (fromCache ? ' (cached)' : ''), 'idle');
    setFocus('list');
  }
}

// ── Network monitor ───────────────────────────────────────────────
function updateNetworkIndicator() {
  var indicator = document.getElementById('networkIndicator');
  if (!indicator) return;
  indicator.className = 'network-indicator';
  if (!navigator.onLine) {
    networkQuality = 'offline';
    indicator.classList.add('offline');
    indicator.title = 'No internet';
  } else if (navigator.connection && navigator.connection.downlink) {
    var speed = navigator.connection.downlink;
    if (speed < 1) {
      networkQuality = 'slow'; indicator.classList.add('slow'); indicator.title = 'Slow · ' + speed.toFixed(1) + ' Mbps';
    } else {
      networkQuality = 'online'; indicator.classList.add('online'); indicator.title = 'Online · ' + speed.toFixed(1) + ' Mbps';
    }
  } else {
    networkQuality = 'online'; indicator.classList.add('online'); indicator.title = 'Online';
  }
  if (player) {
    if (networkQuality === 'slow') player.configure({ streaming: { bufferingGoal: 5, rebufferingGoal: 1 } });
    else player.configure({ streaming: { bufferingGoal: 12, rebufferingGoal: 2 } });
  }
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
  var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
  var clk  = document.getElementById('brandClock');
  var timeEl = document.getElementById('currentTime');
  var dateEl = document.getElementById('currentDate');
  if (clk)    clk.textContent    = timeStr;
  if (timeEl) timeEl.textContent = timeStr;
  if (dateEl) dateEl.textContent = dateStr;
}
setInterval(updateClock, 1000);
updateClock();

// ── Shaka player ──────────────────────────────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) { console.error('[SAGA] Shaka not supported'); return; }

  player = new shaka.Player(video);
  player.configure({
    streaming: {
      bufferingGoal:         12,
      rebufferingGoal:        2,
      bufferBehind:          20,
      stallEnabled:          true,
      stallThreshold:         1,
      stallSkip:            0.1,
      autoCorrectDrift:      true,
      gapDetectionThreshold: 0.5,
      gapPadding:            0.1,
      durationBackoff:         1,
      retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 30000 },
    },
    abr: {
      enabled:                   true,
      defaultBandwidthEstimate:  500000,
      switchInterval:              8,
      bandwidthUpgradeTarget:    0.85,
      bandwidthDowngradeTarget:  0.95,
    },
    manifest: {
      retryParameters: { maxAttempts: 5, baseDelay: 1000, backoffFactor: 2 },
    },
  });

  player.addEventListener('error', function(e) {
    console.error('[Shaka]', e.detail);
    var code = e.detail && e.detail.code;
    setStatus(code >= 7000 && code <= 7999 ? 'Network error...' : 'Stream error', 'error');
    finishLoadBar();
  });
  player.addEventListener('buffering', function(evt) {
    if (evt.buffering) { setStatus('Buffering...', 'loading'); startLoadBar(); }
    else               { setStatus('Playing', 'playing');      finishLoadBar(); }
  });
  player.addEventListener('adaptation',     updateChannelTech);
  player.addEventListener('variantchanged', updateChannelTech);
}

// ── Play ──────────────────────────────────────────────────────────
async function doPlay(url) {
  if (!url) return;
  currentPlayUrl = url;
  reconnectCount = 0;
  if (!player) await initShaka();
  if (!player) return;
  try {
    await player.unload();
    video.removeAttribute('src');
    await player.load(url);
    await video.play().catch(function(){});
    updateChannelTech();
    if (avSyncOffset !== 0) setTimeout(applyAvSync, 1500);
    startStallWatchdog();
  } catch (err) {
    console.warn('[Shaka] load error, trying m3u8 fallback', err);
    if (url.endsWith('.ts')) {
      var m3u8url = url.replace(/\.ts$/, '.m3u8');
      try {
        await player.unload();
        await player.load(m3u8url);
        await video.play().catch(function(){});
        currentPlayUrl = m3u8url;
        updateChannelTech();
        if (avSyncOffset !== 0) setTimeout(applyAvSync, 1500);
        startStallWatchdog();
        return;
      } catch (err2) { console.error('[Shaka] m3u8 fallback failed', err2); }
    }
    // Try plain video src as last resort
    try {
      await player.unload();
      video.src = url;
      video.load();
      await video.play().catch(function(){});
      startStallWatchdog();
    } catch (err3) {
      setStatus('Play error', 'error');
      finishLoadBar();
      stopStallWatchdog();
    }
  }
}

// ── Aspect ratio ──────────────────────────────────────────────────
function resetAspectRatio() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  video.style.objectFit = '';
  arIdx = 0;
  arBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg> Native';
  arBtn.className = 'ar-btn';
}
function cycleAR() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  video.style.objectFit = '';
  arIdx = (arIdx + 1) % AR_MODES.length;
  var m = AR_MODES[arIdx];
  if (m.cls) video.classList.add(m.cls);
  arBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg> ' + m.label;
  arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  showToast('Aspect ratio: ' + m.label);
}
arBtn.addEventListener('click', cycleAR);
function setARFocus(on) { arBtn.classList.toggle('focused', on); }

// ── Preview ───────────────────────────────────────────────────────
function cancelPreview() { clearTimeout(previewTimer); previewTimer = null; }
function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(function() { previewTimer = null; startPreview(selectedIndex); }, PREVIEW_DELAY);
}
async function startPreview(idx) {
  if (!filtered.length) return;
  var ch = filtered[idx];
  if (!ch) return;

  // Hide overlays
  if (overlayTop && overlayBottom && overlaysVisible) {
    overlayTop.classList.remove('info-visible');
    overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  }

  resetAspectRatio();
  nowPlayingEl.textContent = ch.name;
  if (overlayChannelName) overlayChannelName.textContent = ch.name;
  if (npChNumEl) npChNumEl.textContent = 'CH ' + (idx + 1);
  if (!xtreamMode) {
    if (overlayProgramTitle) overlayProgramTitle.textContent = '';
    if (overlayProgramDesc)  overlayProgramDesc.textContent  = '';
    if (nextProgramInfo)     nextProgramInfo.textContent     = '';
    if (programInfoBox) programInfoBox.style.display = 'none';
  }

  videoOverlay.classList.add('hidden');
  hasPlayed = true;
  setStatus('Buffering...', 'loading');
  startLoadBar();
  await doPlay(ch.url);
  if (xtreamMode) setTimeout(updateXtreamEpg, 1200);
}
function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ──────────────────────────────────────────────────
video.addEventListener('playing', function() { setStatus('Playing', 'playing'); finishLoadBar(); updateChannelTech(); });
video.addEventListener('pause',   function() { setStatus('Paused', 'paused'); });
video.addEventListener('waiting', function() { setStatus('Buffering...', 'loading'); startLoadBar(); });
video.addEventListener('stalled', function() { setStatus('Buffering...', 'loading'); });
video.addEventListener('error',   function() { setStatus('Error', 'error'); finishLoadBar(); });
video.addEventListener('ended',   function() { setStatus('Ended', 'idle'); stopStallWatchdog(); });

// ── Fullscreen ────────────────────────────────────────────────────
function showFsHint() {
  clearTimeout(fsHintTimer);
  fsHint.classList.add('visible');
  fsHintTimer = setTimeout(function() { fsHint.classList.remove('visible'); }, 3000);
}
function applyExitFSState() {
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
  fsHint.classList.remove('visible');
  if (preFullscreenArMode !== null) {
    video.style.objectFit = '';
    var restoreMode = preFullscreenArMode;
    preFullscreenArMode = null;
    var m = AR_MODES[restoreMode];
    video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
    if (m.cls) video.classList.add(m.cls);
    arIdx = restoreMode;
    arBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg> ' + m.label;
    arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  }
}
function enterFS() {
  var fn = videoWrap.requestFullscreen || videoWrap.webkitRequestFullscreen || videoWrap.mozRequestFullScreen;
  if (fn) { try { fn.call(videoWrap); } catch(e){} }
  document.body.classList.add('fullscreen');
  isFullscreen = true;
  preFullscreenArMode = arIdx;
  video.style.objectFit = 'fill';
  arIdx = 1;
  arBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" width="14" height="14"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg> Fill';
  arBtn.className = 'ar-btn ar-fill';
  if (overlayTop && overlayBottom) {
    overlayTop.classList.remove('info-visible');
    overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  }
  showFsHint();
}
function exitFS() {
  var fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (fn) { try { fn.call(document); } catch(e){} }
  applyExitFSState();
}
function toggleFS() { if (isFullscreen) exitFS(); else enterFS(); }
function onFsChange() {
  var isFs = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFs && isFullscreen) applyExitFSState();
}
document.addEventListener('fullscreenchange',       onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);
video.addEventListener('dblclick', toggleFS);

// ── Overlay toggle ────────────────────────────────────────────────
function toggleOverlays() {
  if (!overlayTop || !overlayBottom) return;
  if (overlayTop.classList.contains('info-visible')) {
    overlayTop.classList.remove('info-visible');
    overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  } else {
    overlayTop.classList.add('info-visible');
    overlayBottom.classList.add('info-visible');
    overlaysVisible = true;
  }
}

// ══════════════════════════════════════════════════════════════════
// CHANNEL DIALER — Fixed for Samsung BN59-01199F
// Problem: numeric keys send keyCode 48-57 (row) OR 96-105 (numpad)
// Also TV remote sends key name '0'-'9' via tizen input device events
// ══════════════════════════════════════════════════════════════════
function commitChannelNumber() {
  var num = parseInt(dialBuffer, 10);
  dialBuffer = '';
  chDialer.classList.remove('visible');
  if (!filtered.length || isNaN(num) || num < 1) return;
  var idx = Math.min(filtered.length - 1, num - 1);
  cancelPreview();
  selectedIndex = idx;
  VS.scrollToIndexCentered(idx);
  VS.refresh();
  playSelected();
  showToast('CH ' + (idx + 1) + ' · ' + filtered[idx].name);
}

function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d;
  chDialerNum.textContent = dialBuffer;
  chDialer.classList.add('visible');
  // Auto-commit after 1.5s of no new digit, or immediately if 3 digits entered
  if (dialBuffer.length >= 3) {
    dialTimer = setTimeout(function() { dialTimer = null; commitChannelNumber(); }, 400);
  } else {
    dialTimer = setTimeout(function() { dialTimer = null; commitChannelNumber(); }, 1500);
  }
}

function getDigitFromEvent(e) {
  var c = e.keyCode;
  // Keyboard row: 0–9
  if (c >= 48 && c <= 57) return String(c - 48);
  // Numpad: 0–9
  if (c >= 96 && c <= 105) return String(c - 96);
  // Samsung remote may use key.name '0'-'9' with keyCode 48–57 already handled
  // but some firmwares map differently — also check e.key
  if (e.key && e.key.length === 1 && e.key >= '0' && e.key <= '9') return e.key;
  return null;
}

// ── Navigation ────────────────────────────────────────────────────
function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview();
  clearTimeout(dialTimer);
  dialTimer = null;
  dialBuffer = '';
  chDialer.classList.remove('visible');
  selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + d));
  VS.scrollToIndex(selectedIndex);
  VS.refresh();
  schedulePreview();
}
function setFocus(a) {
  focusArea = a;
  setARFocus(a === 'ar');
  if (a === 'search') {
    searchWrap.classList.add('active');
    searchInput.focus();
  } else {
    if (a !== 'search') searchWrap.classList.remove('active');
    if (document.activeElement === searchInput) searchInput.blur();
  }
}

// ── Register Tizen keys ───────────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      var keys = [
        'MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
        'ChannelUp','ChannelDown','Back','Info','Guide',
        '0','1','2','3','4','5','6','7','8','9',
        'VolumeUp','VolumeDown','Mute',
        'Exit','ChannelList','Return','PreCh','ADSUBT','Settings',
      ];
      keys.forEach(function(k) {
        try { tizen.tvinputdevice.registerKey(k); } catch(e) {}
      });
    }
  } catch(e) {}
}

// ── Master keydown handler ────────────────────────────────────────
window.addEventListener('keydown', function(e) {
  var k  = e.key;
  var kc = e.keyCode;

  // ── Modal intercept ─────────────────────────────────────────────
  var xtreamOpen  = xtreamModal  && xtreamModal.style.display  === 'flex';
  var playlistOpen= playlistModal && playlistModal.style.display === 'flex';
  if (xtreamOpen || playlistOpen) {
    if (k === 'Escape' || k === 'Back' || kc === KEY.BACK || kc === KEY.EXIT || kc === 27) {
      closeXtreamLogin();
      closeAddPlaylistModal();
      e.preventDefault(); return;
    }
    // Let other keys through for text input
    return;
  }

  // ── Digit keys → channel dialer ─────────────────────────────────
  var digit = getDigitFromEvent(e);
  if (digit !== null && focusArea !== 'search') {
    handleDigit(digit);
    e.preventDefault(); return;
  }

  // ── Dialer active: Enter confirms, Back cancels ─────────────────
  if (chDialer.classList.contains('visible')) {
    if (kc === KEY.ENTER || k === 'Enter') {
      clearTimeout(dialTimer); dialTimer = null;
      commitChannelNumber();
      e.preventDefault(); return;
    }
    if (k === 'Back' || k === 'Escape' || kc === KEY.BACK || kc === 27) {
      clearTimeout(dialTimer); dialTimer = null;
      dialBuffer = ''; chDialer.classList.remove('visible');
      e.preventDefault(); return;
    }
  }

  // ── Back / Escape ────────────────────────────────────────────────
  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || kc === KEY.BACK || kc === 27) {
    if (isFullscreen)           { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'ar')     { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search') { clearSearch(); e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch(e2){}
    e.preventDefault(); return;
  }

  // ── Info / Guide overlays ────────────────────────────────────────
  if (k === 'Info' || kc === KEY.INFO || k === 'Guide' || kc === KEY.GUIDE) {
    toggleOverlays(); e.preventDefault(); return;
  }

  // ── AR controls focus ────────────────────────────────────────────
  if (focusArea === 'ar') {
    if (k === 'Enter' || kc === KEY.ENTER) { cycleAR(); e.preventDefault(); return; }
    if (k === 'ArrowLeft' || kc === KEY.LEFT || k === 'ArrowDown' || kc === KEY.DOWN) {
      setFocus('list'); e.preventDefault(); return;
    }
    if (k === 'ArrowRight' || kc === KEY.RIGHT || k === 'ArrowUp' || kc === KEY.UP) {
      cycleAR(); e.preventDefault(); return;
    }
    e.preventDefault(); return;
  }

  // ── Search focus ─────────────────────────────────────────────────
  if (focusArea === 'search') {
    if (k === 'Enter'     || kc === KEY.ENTER)               { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || kc === KEY.DOWN || kc === KEY.UP) {
      commitSearch(); e.preventDefault(); return;
    }
    return; // Let keypresses through to input
  }

  // ── Navigation ───────────────────────────────────────────────────
  if (k === 'ArrowUp'   || kc === KEY.UP)   { if (isFullscreen) showFsHint(); else moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || kc === KEY.DOWN) { if (isFullscreen) showFsHint(); else moveSel(1);  e.preventDefault(); return; }
  if (k === 'ArrowLeft' || kc === KEY.LEFT) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    setFocus('list'); e.preventDefault(); return;
  }
  if (k === 'ArrowRight'|| kc === KEY.RIGHT) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    setFocus('ar'); e.preventDefault(); return;
  }

  // ── Enter → play + fullscreen ────────────────────────────────────
  if (k === 'Enter' || kc === KEY.ENTER) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(function() { if (hasPlayed) enterFS(); }, 700);
    }
    e.preventDefault(); return;
  }

  // ── Page up/down ─────────────────────────────────────────────────
  if (k === 'PageUp'   || kc === KEY.PAGE_UP)   { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown' || kc === KEY.PAGE_DOWN) { moveSel(10);  e.preventDefault(); return; }

  // ── Media keys ───────────────────────────────────────────────────
  if (k === 'MediaPlayPause' || kc === KEY.PLAY_PAUSE) {
    if (video.paused) video.play().catch(function(){}); else video.pause();
    e.preventDefault(); return;
  }
  if (k === 'MediaPlay'  || kc === KEY.PLAY)  { video.play().catch(function(){}); e.preventDefault(); return; }
  if (k === 'MediaPause' || kc === KEY.PAUSE) { video.pause(); e.preventDefault(); return; }
  if (k === 'MediaStop'  || kc === KEY.STOP)  {
    cancelPreview();
    if (player) player.unload();
    stopStallWatchdog(); clearSleepTimer();
    video.pause(); video.removeAttribute('src');
    setStatus('Stopped', 'idle'); finishLoadBar();
    e.preventDefault(); return;
  }

  // ── Channel up/down & media FF/RW ────────────────────────────────
  if (k === 'MediaFastForward'|| kc === KEY.FF   || k === 'ChannelUp'  || kc === KEY.CH_UP)   { moveSel(1);  e.preventDefault(); return; }
  if (k === 'MediaRewind'     || kc === KEY.RW   || k === 'ChannelDown'|| kc === KEY.CH_DOWN) { moveSel(-1); e.preventDefault(); return; }

  // ── Colour buttons ───────────────────────────────────────────────
  if (k === 'ColorF0Red'    || kc === KEY.RED)    { switchTab((plIdx + 1) % (allPlaylists.length + 2)); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || kc === KEY.GREEN)  { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || kc === KEY.YELLOW) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || kc === KEY.BLUE)   { if (hasPlayed) toggleFS(); e.preventDefault(); return; }

  // ── Volume ───────────────────────────────────────────────────────
  if (k === 'VolumeUp'   || kc === KEY.VOL_UP)   { video.volume = Math.min(1, video.volume + 0.05); e.preventDefault(); return; }
  if (k === 'VolumeDown' || kc === KEY.VOL_DOWN) { video.volume = Math.max(0, video.volume - 0.05); e.preventDefault(); return; }
  if (k === 'Mute'       || kc === KEY.MUTE)     { video.muted = !video.muted; e.preventDefault(); return; }
});

// Hardware back key (Tizen)
document.addEventListener('tizenhwkey', function(e) {
  if (e.keyName === 'back') {
    if (isFullscreen) { exitFS(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch(ex){}
  }
});

// ── Modals ────────────────────────────────────────────────────────
function openAddPlaylistModal() {
  if (playlistName) playlistName.value = '';
  if (playlistUrl)  playlistUrl.value  = '';
  if (playlistModal) playlistModal.style.display = 'flex';
}
function closeAddPlaylistModal() {
  if (playlistModal) playlistModal.style.display = 'none';
}
function handleSavePlaylist() {
  var name = playlistName ? playlistName.value.trim() : '';
  var url  = playlistUrl  ? playlistUrl.value.trim()  : '';
  if (!name || !url) { showToast('Please enter both name and URL'); return; }
  if (addCustomPlaylist(name, url)) { showToast('"' + name + '" added'); closeAddPlaylistModal(); }
  else showToast('Already exists or invalid URL');
}

// ── Playlist management ───────────────────────────────────────────
function loadCustomPlaylists() {
  try {
    var stored = lsGet(CUSTOM_PLAYLISTS_KEY);
    customPlaylists = stored ? JSON.parse(stored) : [];
  } catch(e) { customPlaylists = []; }
}
function saveCustomPlaylists() { lsSet(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists)); }
function addCustomPlaylist(name, url) {
  if (!name.trim() || !url.trim()) return false;
  if (customPlaylists.some(function(p) { return p.url.toLowerCase() === url.toLowerCase(); })) return false;
  customPlaylists.push({ name: name.trim(), url: url.trim() });
  saveCustomPlaylists();
  rebuildAllPlaylists();
  return true;
}
function rebuildAllPlaylists() {
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);
  if (plIdx >= allPlaylists.length) plIdx = 0;
  rebuildTabs();
  loadPlaylist();
}
function rebuildTabs() {
  tabBar.innerHTML = '';
  for (var i = 0; i < allPlaylists.length; i++) {
    var btn = document.createElement('button');
    btn.className = 'tab';
    if (!xtreamMode && i === plIdx) btn.classList.add('active');
    btn.textContent = allPlaylists[i].name;
    (function(idx) { btn.addEventListener('click', function() { switchTab(idx); }); })(i);
    tabBar.appendChild(btn);
  }
  var xBtn = document.createElement('button');
  xBtn.className = 'tab xtream-tab';
  if (xtreamMode && plIdx === allPlaylists.length) xBtn.classList.add('active');
  xBtn.textContent = 'Xtream';
  xBtn.addEventListener('click', function() { switchTab(allPlaylists.length); });
  tabBar.appendChild(xBtn);
  xtreamTabIndex = allPlaylists.length;

  var fBtn = document.createElement('button');
  fBtn.className = 'tab fav-tab';
  if (!xtreamMode && plIdx === allPlaylists.length + 1) fBtn.classList.add('active');
  fBtn.textContent = '★ Favs';
  fBtn.addEventListener('click', function() { switchTab(allPlaylists.length + 1); });
  tabBar.appendChild(fBtn);
}
function switchTab(idx) {
  var totalM3U = allPlaylists.length;
  if (idx < totalM3U) {
    xtreamMode = false; lastM3uIndex = idx; plIdx = idx;
    rebuildTabs(); loadPlaylist(); saveMode();
  } else if (idx === totalM3U) {
    if (!xtreamMode) {
      if (xtreamClient && xtreamClient.logged_in) {
        xtreamMode = true; plIdx = totalM3U; rebuildTabs(); loadXtreamChannels();
      } else { openXtreamLogin(); }
    }
  } else if (idx === totalM3U + 1) {
    showFavourites(); plIdx = idx; rebuildTabs();
  }
}

// ── Xtream ────────────────────────────────────────────────────────
function openXtreamLogin() {
  if (xtreamServerUrl) xtreamServerUrl.value = '';
  if (xtreamUsername)  xtreamUsername.value  = '';
  if (xtreamPassword)  xtreamPassword.value  = '';
  if (xtreamLoginStatus) xtreamLoginStatus.textContent = '';
  if (xtreamAccountInfo) xtreamAccountInfo.textContent = '';
  if (xtreamModal) xtreamModal.style.display = 'flex';
}
function closeXtreamLogin() { if (xtreamModal) xtreamModal.style.display = 'none'; }

function storeCredentials(server, user, pass) {
  lsSet('xtream:server', server); lsSet('xtream:username', user); lsSet('xtream:password', pass);
}
function clearXtreamCredentials() {
  ['xtream:server','xtream:username','xtream:password'].forEach(function(k) {
    try { localStorage.removeItem(k); } catch(e){}
  });
}

async function xtreamLogin() {
  var serverUrl = xtreamServerUrl ? xtreamServerUrl.value.trim() : '';
  var username  = xtreamUsername  ? xtreamUsername.value.trim()  : '';
  var password  = xtreamPassword  ? xtreamPassword.value.trim()  : '';
  if (!serverUrl || !username || !password) {
    if (xtreamLoginStatus) { xtreamLoginStatus.textContent = 'Please fill in all fields'; xtreamLoginStatus.style.color = 'var(--red)'; }
    return;
  }
  if (xtreamLoginBtn) xtreamLoginBtn.disabled = true;
  if (xtreamLoginStatus) { xtreamLoginStatus.textContent = 'Connecting...'; xtreamLoginStatus.style.color = 'var(--gold)'; }
  try {
    var client   = new XtreamClient({ serverUrl: serverUrl, username: username, password: password, timeout: 15000 });
    var response = await client.getUserInfo(false);
    var ui   = response && response.user_info ? response.user_info : response;
    var auth = ui && (ui.auth === 1 || ui.auth === '1');
    if (auth) {
      xtreamClient = client;
      xtreamClient.logged_in = true;
      xtreamMode = true;
      storeCredentials(serverUrl, username, password);
      var expDate  = new Date(parseInt(ui.exp_date, 10) * 1000);
      var daysLeft = Math.ceil((expDate - new Date()) / 86400000);
      if (xtreamAccountInfo) xtreamAccountInfo.innerHTML = '✅ ' + username + ' · Exp: ' + expDate.toLocaleDateString() + ' (' + daysLeft + 'd) · Max: ' + ui.max_connections;
      if (xtreamLoginStatus) { xtreamLoginStatus.textContent = 'Loading channels...'; xtreamLoginStatus.style.color = 'var(--gold)'; }
      plIdx = allPlaylists.length;
      rebuildTabs();
      await loadXtreamChannels();
      closeXtreamLogin();
      showToast('Welcome, ' + username + '!');
      saveMode();
    } else {
      throw new Error('Authentication failed');
    }
  } catch(error) {
    console.error('[Xtream] Login failed:', error);
    if (xtreamLoginStatus) { xtreamLoginStatus.textContent = 'Login failed: ' + error.message; xtreamLoginStatus.style.color = 'var(--red)'; }
  } finally {
    if (xtreamLoginBtn) xtreamLoginBtn.disabled = false;
  }
}

async function loadXtreamChannels() {
  if (!xtreamClient) return;
  setStatus('Loading Xtream...', 'loading');
  startLoadBar();
  try {
    var results = await Promise.all([
      xtreamClient.getLiveCategories(true),
      xtreamClient.getLiveStreams(null, true),
    ]);
    xtreamCategories  = results[0];
    xtreamChannelList = results[1];
    var converted = xtreamChannelList.map(function(ch) {
      return {
        name:         ch.name,
        group:        ch.category_name || 'Uncategorized',
        logo:         ch.stream_icon   || '',
        url:          xtreamClient.getLiveStreamUrl(ch.stream_id),
        streamId:     ch.stream_id,
        epgChannelId: ch.epg_channel_id,
        streamType:   'live',
      };
    });
    channels    = converted;
    allChannels = converted.slice();
    filtered    = converted.slice();
    selectedIndex = 0;
    renderList();
    if (listLabel) listLabel.textContent = 'XTREAM · ' + converted.length;
    setStatus('Xtream · ' + converted.length + ' channels', 'playing');
    finishLoadBar();
  } catch(error) {
    console.error('[Xtream] Channel load failed:', error);
    setStatus('Failed to load channels', 'error');
    finishLoadBar();
  }
}

async function loadSavedXtream() {
  var savedServer   = lsGet('xtream:server');
  var savedUsername = lsGet('xtream:username');
  var savedPassword = lsGet('xtream:password');
  if (!savedServer || !savedUsername || !savedPassword) return false;
  try {
    var client   = new XtreamClient({ serverUrl: savedServer, username: savedUsername, password: savedPassword, timeout: 10000 });
    var response = await client.getUserInfo(false);
    var ui   = response && response.user_info ? response.user_info : response;
    var auth = ui && (ui.auth === 1 || ui.auth === '1');
    if (auth) {
      xtreamClient = client;
      xtreamClient.logged_in = true;
      xtreamMode = true;
      plIdx = allPlaylists.length;
      rebuildTabs();
      await loadXtreamChannels();
      showToast('Welcome back, ' + savedUsername);
      saveMode();
      return true;
    }
  } catch(error) {
    console.warn('[Xtream] Auto-login failed:', error);
    clearXtreamCredentials();
  }
  return false;
}

function atob_safe(str) {
  if (!str) return '';
  try { return decodeURIComponent(escape(atob(str))); } catch(e) { return str; }
}

async function updateXtreamEpg() {
  if (!xtreamMode || !xtreamClient) return;
  var ch = filtered[selectedIndex];
  if (!ch || !ch.streamId) return;
  try {
    var epgData = await xtreamClient.getShortEpg(ch.streamId, 3, true);
    var list = Array.isArray(epgData) ? epgData
             : (epgData && Array.isArray(epgData.epg_listings)) ? epgData.epg_listings : [];
    if (list.length > 0) {
      var cur = list[0], nxt = list[1];
      if (overlayProgramTitle) overlayProgramTitle.textContent = atob_safe(cur.title) || 'No program info';
      if (overlayProgramDesc)  overlayProgramDesc.textContent  = atob_safe(cur.description) || '';
      if (nextProgramInfo) {
        nextProgramInfo.textContent = nxt
          ? 'Next: ' + atob_safe(nxt.title) + ' at ' + new Date(nxt.start_timestamp * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' })
          : '';
      }
      if (programInfoBox) programInfoBox.style.display = '';
    } else {
      if (overlayProgramTitle) overlayProgramTitle.textContent = 'No EPG';
      if (overlayProgramDesc)  overlayProgramDesc.textContent  = '';
      if (nextProgramInfo)     nextProgramInfo.textContent     = '';
    }
  } catch(error) {
    console.warn('[Xtream] EPG failed:', error);
  }
}

var epgInterval = null;
function startEpgUpdater() {
  if (epgInterval) clearInterval(epgInterval);
  epgInterval = setInterval(function() { if (xtreamMode && !video.paused) updateXtreamEpg(); }, 30000);
}
function stopEpgUpdater() { if (epgInterval) { clearInterval(epgInterval); epgInterval = null; } }

// ── Mode persistence ──────────────────────────────────────────────
function saveMode() {
  if (xtreamMode) { lsSet('iptv:mode', 'xtream'); }
  else { lsSet('iptv:mode', 'm3u'); lsSet('iptv:lastM3uIndex', String(plIdx)); }
}
async function loadMode() {
  var mode = lsGet('iptv:mode');
  if (mode === 'xtream') {
    var ok = await loadSavedXtream();
    if (!ok) {
      xtreamMode = false;
      var si = parseInt(lsGet('iptv:lastM3uIndex') || '0', 10);
      plIdx = (!isNaN(si) && si < allPlaylists.length) ? si : 0;
      rebuildTabs(); loadPlaylist();
    }
  } else {
    xtreamMode = false;
    var si2 = parseInt(lsGet('iptv:lastM3uIndex') || '0', 10);
    plIdx = (!isNaN(si2) && si2 < allPlaylists.length) ? si2 : 0;
    rebuildTabs(); loadPlaylist();
  }
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

  // Ensure overlays start hidden
  if (overlayTop)    overlayTop.classList.remove('info-visible');
  if (overlayBottom) overlayBottom.classList.remove('info-visible');
  overlaysVisible = false;

  // Button listeners
  if (addPlaylistBtn)    addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if (savePlaylistBtn)   savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if (cancelPlaylistBtn) cancelPlaylistBtn.addEventListener('click', closeAddPlaylistModal);
  if (playlistModal)     playlistModal.addEventListener('click', function(e) { if (e.target === playlistModal) closeAddPlaylistModal(); });

  if (xtreamLoginBtn)  xtreamLoginBtn.addEventListener('click', xtreamLogin);
  if (xtreamCancelBtn) xtreamCancelBtn.addEventListener('click', closeXtreamLogin);
  if (xtreamModal)     xtreamModal.addEventListener('click', function(e) { if (e.target === xtreamModal) closeXtreamLogin(); });

  video.addEventListener('playing', startEpgUpdater);
  video.addEventListener('pause',   stopEpgUpdater);
  video.addEventListener('ended',   stopEpgUpdater);

  // Enter key in modal inputs
  [playlistName, playlistUrl].forEach(function(el) {
    if (el) el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.keyCode === 13) handleSavePlaylist();
    });
  });
  [xtreamServerUrl, xtreamUsername, xtreamPassword].forEach(function(el) {
    if (el) el.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.keyCode === 13) xtreamLogin();
    });
  });
})();
