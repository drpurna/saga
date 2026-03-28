// ================================================================
// SAGA IPTV — app.js v20.0 | Samsung Tizen OS9 TV
// Tile-style channel list, persistent clock, remote improvements
// ================================================================

const FAV_KEY              = 'iptv:favs';
const PLAYLIST_KEY         = 'iptv:lastPl';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const AV_SYNC_KEY          = 'iptv:avSync';
const PREVIEW_DELAY        = 700;

const DEFAULT_PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

let allPlaylists    = [];
let customPlaylists = [];
let plIdx           = 0;
let xtreamTabIndex  = -1;
let lastM3uIndex    = 0;

const AR_MODES = [
  { cls: '',          label: 'Native' },
  { cls: 'ar-fill',   label: 'Fill'   },
  { cls: 'ar-cover',  label: 'Crop'   },
  { cls: 'ar-wide',   label: 'Wide'   },
];

// ── AV Sync ──────────────────────────────────────────────────────
let avSyncOffset   = 0;       // ms; negative = audio leads; positive = audio lags
let avSyncLabel    = null;
const AV_SYNC_STEP = 50;
const AV_SYNC_MAX  = 500;

// ── Sleep timer ──────────────────────────────────────────────────
let sleepTimer   = null;
let sleepMinutes = 0;

// ── Auto-reconnect / stall watchdog ─────────────────────────────
let stallWatchdog  = null;
let lastPlayTime   = 0;
let reconnectCount = 0;
const MAX_RECONNECT = 5;

// ── DOM refs ─────────────────────────────────────────────────────
const searchInput       = document.getElementById('searchInput');
const searchWrap        = document.getElementById('searchWrap');
const tabBar            = document.getElementById('tabBar');
const channelListEl     = document.getElementById('channelList');
const countBadge        = document.getElementById('countBadge');
const nowPlayingEl      = document.getElementById('nowPlaying');
const npChNumEl         = document.getElementById('npChNum');
const statusBadge       = document.getElementById('statusBadge');
const video             = document.getElementById('video');
const videoWrap         = document.getElementById('videoWrap');
const videoOverlay      = document.getElementById('videoOverlay');
const fsHint            = document.getElementById('fsHint');
const loadBar           = document.getElementById('loadBar');
const chDialer          = document.getElementById('chDialer');
const chDialerNum       = document.getElementById('chDialerNum');
const arBtn             = document.getElementById('arBtn');
const addPlaylistBtn    = document.getElementById('addPlaylistBtn');
const playlistModal     = document.getElementById('addPlaylistModal');
const playlistName      = document.getElementById('playlistName');
const playlistUrl       = document.getElementById('playlistUrl');
const savePlaylistBtn   = document.getElementById('savePlaylistBtn');
const cancelPlaylistBtn = document.getElementById('cancelPlaylistBtn');

const overlayTop          = document.getElementById('overlayTop');
const overlayBottom       = document.getElementById('overlayBottom');
const overlayChannelName  = document.getElementById('overlayChannelName');
const overlayChannelTech  = document.getElementById('overlayChannelTech');
const overlayProgramTitle = document.getElementById('overlayProgramTitle');
const overlayProgramDesc  = document.getElementById('overlayProgramDesc');
const nextProgramInfo     = document.getElementById('nextProgramInfo');

// ── State ─────────────────────────────────────────────────────────
let channels       = [];
let allChannels    = [];
let filtered       = [];
let selectedIndex  = 0;
let focusArea      = 'list';
let isFullscreen   = false;
let hasPlayed      = false;
let player         = null;
let arIdx          = 0;
let preFullscreenArMode = null;
let fsHintTimer    = null;
let loadBarTimer   = null;
let previewTimer   = null;
let dialBuffer     = '';
let dialTimer      = null;
let toastEl        = null;
let toastTm        = null;
let favSet         = new Set();
let networkQuality = 'online';
let connectionMonitor = null;
let overlaysVisible   = true;
let currentPlayUrl    = '';

// ── Xtream state ──────────────────────────────────────────────────
let xtreamClient      = null;
let xtreamMode        = false;
let xtreamCategories  = [];
let xtreamChannelList = [];

// ── Xtream DOM ────────────────────────────────────────────────────
const xtreamModal       = document.getElementById('xtreamLoginModal');
const xtreamServerUrl   = document.getElementById('xtreamServerUrl');
const xtreamUsername    = document.getElementById('xtreamUsername');
const xtreamPassword    = document.getElementById('xtreamPassword');
const xtreamLoginBtn    = document.getElementById('xtreamLoginBtn');
const xtreamCancelBtn   = document.getElementById('xtreamCancelBtn');
const xtreamLoginStatus = document.getElementById('xtreamLoginStatus');
const xtreamAccountInfo = document.getElementById('xtreamAccountInfo');

// ── localStorage helpers ──────────────────────────────────────────
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('[ls] set failed', key, e.name); }
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── Favourites ────────────────────────────────────────────────────
(function loadFavs() {
  try { const r = lsGet(FAV_KEY); if (r) favSet = new Set(JSON.parse(r)); } catch (e) {}
})();
function saveFavs() { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)  { return favSet.has(ch.url); }
function toggleFav(ch) {
  const k = ch.url;
  if (favSet.has(k)) favSet.delete(k); else favSet.add(k);
  saveFavs();
  if (plIdx === allPlaylists.length + 1) showFavourites();
  if (VS.refresh) VS.refresh();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed');
}
function showFavourites() {
  filtered = allChannels.filter(c => favSet.has(c.url));
  selectedIndex = 0;
  renderList();
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, duration) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
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
    if (w < 85) loadBarTimer = setTimeout(tick, 220);
  };
  loadBarTimer = setTimeout(tick, 100);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '100%';
  setTimeout(function() { loadBar.classList.remove('active'); loadBar.style.width = '0%'; }, 400);
}

// ── M3U helpers ───────────────────────────────────────────────────
function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*\([^)]*\)/g, '')
    .replace(/\s*\[[^\]]*\]/g, '')
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi, '')
    .replace(/[\|\-–—]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
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
      var gm = line.match(/group-title="([^"]+)"/i);
      var lm = line.match(/tvg-logo="([^"]+)"/i);
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
function initials(n) {
  return String(n||'').replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).slice(0,2).map(function(w){return w[0]||'';}).join('').toUpperCase()||'?';
}

// ── Channel tech info ─────────────────────────────────────────────
function updateChannelTech() {
  if (!player) return;
  try {
    var stats = player.getStats ? player.getStats() : null;
    var tracks = player.getVariantTracks ? player.getVariantTracks() : [];
    var vt = tracks.find(function(t){ return t.active; });
    var bitrate = stats ? (stats.streamBandwidth || 0) : 0;
    var width   = vt ? (vt.width  || 0) : 0;
    var height  = vt ? (vt.height || 0) : 0;
    var fps     = vt ? (vt.frameRate || 0) : 0;
    var codec   = vt ? (vt.videoCodec || '') : '';
    if (overlayChannelTech) {
      var parts = [];
      if (width && height) parts.push(width + 'x' + height);
      if (bitrate) parts.push((bitrate/1e6).toFixed(1)+' Mbps');
      if (fps) parts.push(Math.round(fps)+' fps');
      if (codec) parts.push(codec);
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
  if (!video || !hasPlayed) return;
  if (avSyncOffset === 0) return;
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
  var label = avSyncOffset === 0 ? 'AV Sync: 0 ms' : 'AV Sync: ' + (avSyncOffset > 0 ? '+' : '') + avSyncOffset + ' ms';
  showToast(label);
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
  avSyncLabel.style.color = avSyncOffset === 0 ? '#aaa' : '#f0c400';
}

function buildAvSyncBar() {
  var controls = document.querySelector('.player-controls');
  if (!controls) return;
  var wrap = document.createElement('div');
  wrap.id = 'avSyncWrap';
  wrap.style.cssText = 'display:flex;align-items:center;gap:4px;margin-right:6px;';

  var btnM = document.createElement('button');
  btnM.className = 'ar-btn';
  btnM.textContent = '◁ Audio';
  btnM.title = 'Audio leads video — shift audio forward 50 ms';
  btnM.addEventListener('click', function() { adjustAvSync(-1); });

  avSyncLabel = document.createElement('span');
  avSyncLabel.style.cssText = 'font-size:11px;color:#aaa;min-width:68px;text-align:center;cursor:pointer;white-space:nowrap;';
  avSyncLabel.title = 'Click to reset AV sync';
  avSyncLabel.addEventListener('click', resetAvSync);
  updateAvSyncLabel();

  var btnP = document.createElement('button');
  btnP.className = 'ar-btn';
  btnP.textContent = 'Audio ▷';
  btnP.title = 'Audio lags video — shift audio back 50 ms';
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
    sleepTimer = null;
    sleepMinutes = 0;
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

// ── Stall watchdog / auto-reconnect ──────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog();
  reconnectCount = 0;
  lastPlayTime   = Date.now();
  stallWatchdog  = setInterval(function() {
    if (video.paused || !hasPlayed || !currentPlayUrl) return;
    if (Date.now() - lastPlayTime > 9000) {
      if (reconnectCount < MAX_RECONNECT) {
        reconnectCount++;
        console.warn('[watchdog] Stall — reconnecting ' + reconnectCount + '/' + MAX_RECONNECT);
        setStatus('Reconnecting (' + reconnectCount + '/' + MAX_RECONNECT + ')...', 'loading');
        startLoadBar();
        doPlay(currentPlayUrl).then(function() {
          reconnectCount = 0;
        }).catch(function(){});
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

// ── Virtual scroll (tile style) ──────────────────────────────────
var VS = {
  ITEM_H: 130,
  OVERSCAN: 6,
  c: null, inner: null, vh: 0, st: 0,
  total: 0, rs: -1, re: -1, nodes: [], raf: null,

  init: function(el) {
    this.c = el;
    this.inner = document.createElement('div');
    this.inner.id = 'vsInner';
    this.c.appendChild(this.inner);
    this.vh = this.c.clientHeight || 700;
    var self = this;
    this.c.addEventListener('scroll', function() {
      if (self.raf) return;
      self.raf = requestAnimationFrame(function() {
        self.raf = null;
        self.st = self.c.scrollTop;
        self.paint();
      });
    }, { passive: true });
  },

  setData: function(n) {
    this.total = n; this.rs = -1; this.re = -1;
    this.inner.textContent = ''; this.nodes = [];
    this.inner.style.cssText = 'position:relative;width:100%;height:' + (n * this.ITEM_H) + 'px;';
    this.st = this.c.scrollTop;
    this.vh = this.c.clientHeight || 700;
    this.paint();
  },

  scrollToIndex: function(idx) {
    var top = idx * this.ITEM_H;
    var bottom = top + this.ITEM_H;
    var scrollTop = this.c.scrollTop;
    var visibleHeight = this.vh;
    var padding = 24;

    if (top < scrollTop + padding) {
      this.c.scrollTop = Math.max(0, top - padding);
    } else if (bottom > scrollTop + visibleHeight - padding) {
      this.c.scrollTop = bottom - visibleHeight + padding;
    }
    this.st = this.c.scrollTop;
    this.paint();
  },

  scrollToIndexCentered: function(idx) {
    var center = idx * this.ITEM_H - (this.vh / 2) + (this.ITEM_H / 2);
    this.c.scrollTop = Math.max(0, center);
    this.st = this.c.scrollTop;
    this.rs = -1; this.re = -1;
    this.paint();
  },

  paint: function() {
    if (!this.total) return;
    var H  = this.ITEM_H, os = this.OVERSCAN;
    var start = Math.max(0, Math.floor(this.st / H) - os);
    var end   = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);
    if (start === this.rs && end === this.re) return;
    this.rs = start; this.re = end;

    this.nodes = this.nodes.filter(function(nd) {
      if (nd._i < start || nd._i > end) {
        if (nd.parentNode) nd.parentNode.removeChild(nd);
        return false;
      }
      return true;
    });

    var have = new Set(this.nodes.map(function(n){ return n._i; }));
    var frag = document.createDocumentFragment();
    for (var i = start; i <= end; i++) {
      if (!have.has(i)) frag.appendChild(this.build(i));
    }
    if (frag.childNodes.length) this.inner.appendChild(frag);
    this.nodes = Array.from(this.inner.children);

    for (var j = 0; j < this.nodes.length; j++) {
      var nd = this.nodes[j];
      var on = (nd._i === selectedIndex);
      if (on !== nd._on) { nd._on = on; nd.classList.toggle('active', on); }
    }
  },

  build: function(i) {
    var ch = filtered[i];
    var li = document.createElement('li');
    li._i = i; li._on = false;
    li.style.cssText = 'position:absolute;top:' + (i * this.ITEM_H) + 'px;left:0;right:0;height:auto;min-height:' + this.ITEM_H + 'px;';

    var logo = ch.logo
      ? '<div class="ch-logo"><img src="' + esc(ch.logo) + '" onerror="this.parentNode.innerHTML=\'<div class=\\\"ch-logo ch-logo-fb\\\">' + esc(initials(ch.name)) + '</div>\'"></div>'
      : '<div class="ch-logo ch-logo-fb">' + esc(initials(ch.name)) + '</div>';

    li.innerHTML = logo +
      '<div class="ch-info"><div class="ch-name">' + esc(ch.name) + '</div>' +
      (ch.group ? '<div class="ch-group">' + esc(ch.group) + '</div>' : '') +
      '</div>' +
      (isFav(ch) ? '<div class="ch-fav">★</div>' : '') +
      '<div class="ch-num">' + (i + 1) + '</div>';

    if (i === selectedIndex) { li._on = true; li.classList.add('active'); }
    li.addEventListener('click', function() { selectedIndex = i; VS.refresh(); schedulePreview(); });
    return li;
  },

  refresh: function() { this.rs = -1; this.re = -1; this.paint(); }
};

// ── Render list ───────────────────────────────────────────────────
function renderList() {
  countBadge.textContent = String(filtered.length);
  if (!filtered.length) {
    VS.setData(0);
    var li = document.createElement('li');
    li.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:24px 16px;text-align:center;';
    li.textContent = 'No channels';
    VS.inner.appendChild(li);
    return;
  }
  VS.setData(filtered.length);
  VS.scrollToIndex(selectedIndex);
}

// ── Search ────────────────────────────────────────────────────────
var sdTm = null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm = setTimeout(function() {
    var q = searchInput.value.trim().toLowerCase();
    filtered = !q ? channels.slice()
      : channels.filter(function(c){ return c.name.toLowerCase().includes(q) || (c.group||'').toLowerCase().includes(q); });
    selectedIndex = 0;
    renderList();
  }, 120);
}
function commitSearch() {
  setFocus('list');
  if (filtered.length === 1) { selectedIndex = 0; VS.refresh(); schedulePreview(); }
}
function clearSearch() { searchInput.value = ''; applySearch(); setFocus('list'); }
searchInput.addEventListener('input', applySearch);

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
  } catch(e) {}

  setStatus('Loading...', 'loading');
  startLoadBar();

  function tryDirect() {
    xhrFetch(rawUrl, 30000, function(err, text) {
      if (!err && text && text.length > 100) { persist(text); finishLoadBar(); onLoaded(text, false); return; }
      var mirror = mirrorUrl(rawUrl);
      if (mirror) {
        setStatus('Retrying mirror...', 'loading');
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
    try { lsSet(cacheKey, text); lsSet(cacheTimeKey, String(Date.now())); } catch(e) {}
  }
  function onLoaded(text, fromCache) {
    channels = parseM3U(text);
    allChannels = channels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
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
    networkQuality = 'offline'; indicator.classList.add('offline'); indicator.title = 'No internet';
  } else if (navigator.connection && navigator.connection.downlink) {
    var speed = navigator.connection.downlink;
    if (speed < 1) {
      networkQuality = 'slow'; indicator.classList.add('slow'); indicator.title = 'Slow (' + speed.toFixed(1) + ' Mbps)';
    } else {
      networkQuality = 'online'; indicator.classList.add('online'); indicator.title = 'OK (' + speed.toFixed(1) + ' Mbps)';
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
  window.addEventListener('online', updateNetworkIndicator);
  window.addEventListener('offline', updateNetworkIndicator);
  connectionMonitor = setInterval(updateNetworkIndicator, 10000);
}
function stopNetworkMonitoring() {
  if (navigator.connection) navigator.connection.removeEventListener('change', updateNetworkIndicator);
  window.removeEventListener('online', updateNetworkIndicator);
  window.removeEventListener('offline', updateNetworkIndicator);
  if (connectionMonitor) clearInterval(connectionMonitor);
}

// ── Clock ──────────────────────────────────────────────────────────
function updateClock() {
  var now = new Date();
  var te = document.getElementById('currentTime');
  var de = document.getElementById('currentDate');
  var clk = document.getElementById('clockDisplay');
  var timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  var dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
  if (te) te.textContent = timeStr;
  if (de) de.textContent = dateStr;
  if (clk) clk.textContent = timeStr;
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
      bufferingGoal:          12,
      rebufferingGoal:        2,
      bufferBehind:           20,
      stallEnabled:           true,
      stallThreshold:         1,
      stallSkip:              0.1,
      autoCorrectDrift:       true,
      gapDetectionThreshold:  0.5,
      gapPadding:             0.1,
      durationBackoff:        1,
      retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2, fuzzFactor: 0.5, timeout: 30000 },
    },
    abr: {
      enabled:                      true,
      defaultBandwidthEstimate:     500000,
      switchInterval:               8,
      bandwidthUpgradeTarget:       0.85,
      bandwidthDowngradeTarget:     0.95,
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
    else { setStatus('Playing', 'playing'); finishLoadBar(); }
  });
  player.addEventListener('adaptation', updateChannelTech);
  player.addEventListener('variantchanged', updateChannelTech);
}

// ── Play with TS→M3U8 fallback ────────────────────────────────────
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
    setStatus('Play error', 'error');
    finishLoadBar();
    stopStallWatchdog();
  }
}

// ── Aspect ratio ──────────────────────────────────────────────────
function resetAspectRatio() {
  video.classList.remove('ar-fill','ar-cover','ar-wide');
  video.style.objectFit = '';
  arIdx = 0;
  arBtn.textContent = '⛶ Native';
  arBtn.className = 'ar-btn';
}
function cycleAR() {
  video.classList.remove('ar-fill','ar-cover','ar-wide');
  video.style.objectFit = '';
  arIdx = (arIdx + 1) % AR_MODES.length;
  var m = AR_MODES[arIdx];
  if (m.cls) video.classList.add(m.cls);
  arBtn.textContent = '⛶ ' + m.label;
  arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  showToast('Aspect: ' + m.label);
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

  // Hide overlays when playing a channel
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
    video.classList.remove('ar-fill','ar-cover','ar-wide');
    if (m.cls) video.classList.add(m.cls);
    arIdx = restoreMode;
    arBtn.textContent = '⛶ ' + m.label;
    arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  }
  if (overlayTop && overlayBottom && overlaysVisible) {
    overlayTop.classList.add('info-visible');
    overlayBottom.classList.add('info-visible');
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
  arBtn.textContent = '⛶ ' + AR_MODES[1].label;
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
document.addEventListener('fullscreenchange', onFsChange);
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

// ── Channel dialer ────────────────────────────────────────────────
function commitChannelNumber() {
  var num = parseInt(dialBuffer, 10);
  dialBuffer = '';
  chDialer.classList.remove('visible');
  if (!filtered.length || isNaN(num)) return;
  var idx = Math.max(0, Math.min(filtered.length - 1, num - 1));
  cancelPreview();
  selectedIndex = idx;
  VS.scrollToIndexCentered(idx);
  playSelected();
  showToast('CH ' + (idx + 1) + ' · ' + filtered[idx].name);
}
function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d;
  chDialerNum.textContent = dialBuffer;
  chDialer.classList.add('visible');
  dialTimer = setTimeout(function() { dialTimer = null; commitChannelNumber(); }, 1200);
}

// ── Navigation ────────────────────────────────────────────────────
function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview();
  // Clear any pending channel number input
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
    searchWrap.classList.remove('active');
    if (document.activeElement === searchInput) searchInput.blur();
  }
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
  if (customPlaylists.some(function(p){ return p.url.toLowerCase() === url.toLowerCase(); })) return false;
  customPlaylists.push({ name: name.trim(), url: url.trim() });
  saveCustomPlaylists();
  rebuildAllPlaylists();
  return true;
}
function rebuildAllPlaylists() {
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);
  if (plIdx >= allPlaylists.length) plIdx = 0;
  rebuildTabs();
  if (plIdx < allPlaylists.length) loadPlaylist(); else { plIdx = 0; loadPlaylist(); }
}
function rebuildTabs() {
  tabBar.innerHTML = '';
  for (var i = 0; i < allPlaylists.length; i++) {
    var btn = document.createElement('button');
    btn.className = 'tab';
    if (!xtreamMode && i === plIdx) btn.classList.add('active');
    btn.textContent = allPlaylists[i].name;
    (function(idx){ btn.addEventListener('click', function(){ switchTab(idx); }); })(i);
    tabBar.appendChild(btn);
  }
  var xBtn = document.createElement('button');
  xBtn.className = 'tab xtream-tab';
  if (xtreamMode && plIdx === allPlaylists.length) xBtn.classList.add('active');
  xBtn.textContent = 'Xtream';
  xBtn.addEventListener('click', function(){ switchTab(allPlaylists.length); });
  tabBar.appendChild(xBtn);
  xtreamTabIndex = allPlaylists.length;

  var fBtn = document.createElement('button');
  fBtn.className = 'tab fav-tab';
  if (!xtreamMode && plIdx === allPlaylists.length + 1) fBtn.classList.add('active');
  fBtn.textContent = '★ Favs';
  fBtn.addEventListener('click', function(){ switchTab(allPlaylists.length + 1); });
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
  xtreamServerUrl.value = ''; xtreamUsername.value = ''; xtreamPassword.value = '';
  xtreamLoginStatus.textContent = ''; xtreamAccountInfo.textContent = '';
  xtreamModal.style.display = 'flex';
}
function closeXtreamLogin() { xtreamModal.style.display = 'none'; }

function storeCredentials(server, user, pass) {
  lsSet('xtream:server', server); lsSet('xtream:username', user); lsSet('xtream:password', pass);
}
function clearXtreamCredentials() {
  ['xtream:server','xtream:username','xtream:password'].forEach(function(k){
    try { localStorage.removeItem(k); } catch(e){}
  });
}

async function xtreamLogin() {
  var serverUrl = xtreamServerUrl.value.trim();
  var username  = xtreamUsername.value.trim();
  var password  = xtreamPassword.value.trim();
  if (!serverUrl || !username || !password) {
    xtreamLoginStatus.textContent = 'Please fill in all fields';
    xtreamLoginStatus.style.color = '#ff4444'; return;
  }
  xtreamLoginBtn.disabled = true;
  xtreamLoginStatus.textContent = 'Connecting...';
  xtreamLoginStatus.style.color = '#e5b400';
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
      xtreamAccountInfo.innerHTML = '✅ ' + username + ' · Exp: ' + expDate.toLocaleDateString() + ' (' + daysLeft + 'd) · Max: ' + ui.max_connections;
      xtreamLoginStatus.textContent = 'Loading channels...';
      plIdx = allPlaylists.length;
      rebuildTabs();
      await loadXtreamChannels();
      closeXtreamLogin();
      showToast('Welcome ' + username + '!');
      saveMode();
    } else {
      throw new Error('Authentication failed');
    }
  } catch(error) {
    console.error('[Xtream] Login failed:', error);
    xtreamLoginStatus.textContent = 'Login failed: ' + error.message;
    xtreamLoginStatus.style.color = '#ff4444';
  } finally {
    xtreamLoginBtn.disabled = false;
  }
}

async function loadXtreamChannels() {
  if (!xtreamClient) return;
  setStatus('Loading Xtream channels...', 'loading');
  startLoadBar();
  try {
    var results = await Promise.all([
      xtreamClient.getLiveCategories(true),
      xtreamClient.getLiveStreams(null, true),
    ]);
    var cats    = results[0];
    var streams = results[1];
    xtreamCategories  = cats;
    xtreamChannelList = streams;

    var converted = streams.map(function(ch) {
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
    setStatus('Xtream: ' + converted.length + ' channels', 'playing');
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

function switchToM3uMode() {
  xtreamMode = false; xtreamClient = null;
  xtreamCategories = []; xtreamChannelList = [];
  clearXtreamCredentials();
  plIdx = lastM3uIndex;
  rebuildTabs(); loadPlaylist();
  showToast('Switched to M3U mode');
  saveMode();
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
      var cur  = list[0], nxt = list[1];
      if (overlayProgramTitle) overlayProgramTitle.textContent = atob_safe(cur.title) || 'No program info';
      if (overlayProgramDesc)  overlayProgramDesc.textContent  = atob_safe(cur.description) || '';
      if (nextProgramInfo) {
        if (nxt) {
          var t = new Date(nxt.start_timestamp * 1000).toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
          nextProgramInfo.textContent = 'Next: ' + atob_safe(nxt.title) + ' at ' + t;
        } else {
          nextProgramInfo.textContent = '';
        }
      }
    } else {
      if (overlayProgramTitle) overlayProgramTitle.textContent = 'No EPG';
      if (overlayProgramDesc)  overlayProgramDesc.textContent  = '';
      if (nextProgramInfo)     nextProgramInfo.textContent     = '';
    }
  } catch(error) {
    console.warn('[Xtream] EPG failed:', error);
    if (overlayProgramTitle) overlayProgramTitle.textContent = 'EPG unavailable';
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
  if (xtreamMode) {
    lsSet('iptv:mode', 'xtream');
  } else {
    lsSet('iptv:mode', 'm3u');
    lsSet('iptv:lastM3uIndex', String(plIdx));
  }
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

// ── Remote keys ───────────────────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      var keys = [
        'MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
        'ChannelUp','ChannelDown','Back','Info',
        '0','1','2','3','4','5','6','7','8','9',
        'VolumeUp', 'VolumeDown', 'Mute',
        'Exit', 'Guide', 'ChannelList', 'Return', 'PreCh', 'ADSUBT', 'Settings'
      ];
      keys.forEach(function(k) {
        try { tizen.tvinputdevice.registerKey(k); } catch(e) {}
      });
    }
  } catch(e) {}
}

// ── Keyboard/remote handler ───────────────────────────────────────
window.addEventListener('keydown', function(e) {
  var k = e.key, c = e.keyCode;

  // Close any open modal first
  if (xtreamModal.style.display === 'flex' || playlistModal.style.display === 'flex') {
    if (k === 'Escape' || k === 'Back' || k === 'Return' || k === 'Exit' || c === 27 || c === 10009 || c === 10182) {
      closeXtreamLogin();
      closeAddPlaylistModal();
      e.preventDefault();
      return;
    }
  }

  if ((c >= 48 && c <= 57) || (c >= 96 && c <= 105)) {
    if (focusArea !== 'search' && xtreamModal.style.display !== 'flex' && playlistModal.style.display !== 'flex') {
      handleDigit(String(c >= 96 ? c - 96 : c - 48));
      e.preventDefault();
      return;
    }
  }

  if (chDialer.classList.contains('visible')) {
    if (k === 'Enter' || c === 13) { clearTimeout(dialTimer); dialTimer = null; commitChannelNumber(); e.preventDefault(); return; }
    if (k === 'Back' || k === 'Escape' || c === 27 || c === 10009) {
      clearTimeout(dialTimer); dialTimer = null; dialBuffer = ''; chDialer.classList.remove('visible'); e.preventDefault(); return;
    }
  }

  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
    if (isFullscreen)           { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'ar')     { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search') { clearSearch(); e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch(e2){}
    e.preventDefault(); return;
  }

  if (k === 'Info' || c === 457) { toggleOverlays(); e.preventDefault(); return; }

  if (focusArea === 'ar') {
    if (k === 'Enter' || c === 13) { cycleAR(); e.preventDefault(); return; }
    if (k === 'ArrowLeft' || c === 37 || k === 'ArrowDown' || c === 40) { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowRight' || c === 39 || k === 'ArrowUp' || c === 38) { cycleAR(); e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  if (focusArea === 'search') {
    if (k === 'Enter' || c === 13) { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || c === 40 || c === 38) { commitSearch(); e.preventDefault(); return; }
    return;
  }

  if (k === 'ArrowUp'   || c === 38) { if (isFullscreen) showFsHint(); else moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || c === 40) { if (isFullscreen) showFsHint(); else moveSel(1);  e.preventDefault(); return; }

  if (k === 'ArrowLeft' || c === 37) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    setFocus('list'); e.preventDefault(); return;
  }
  if (k === 'ArrowRight' || c === 39) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    setFocus('ar'); e.preventDefault(); return;
  }

  if (k === 'Enter' || c === 13) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') { playSelected(); setTimeout(function(){ if (hasPlayed) enterFS(); }, 600); }
    e.preventDefault(); return;
  }

  if (k === 'PageUp')   { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown') { moveSel(10);  e.preventDefault(); return; }

  if (k === 'MediaPlayPause' || c === 10252) {
    if (video.paused) video.play().catch(function(){}); else video.pause(); e.preventDefault(); return;
  }
  if (k === 'MediaPlay'  || c === 415) { video.play().catch(function(){}); e.preventDefault(); return; }
  if (k === 'MediaPause' || c === 19)  { video.pause(); e.preventDefault(); return; }

  if (k === 'MediaStop' || c === 413) {
    cancelPreview();
    if (player) player.unload();
    stopStallWatchdog(); clearSleepTimer();
    video.pause(); video.removeAttribute('src');
    setStatus('Stopped', 'idle'); finishLoadBar();
    e.preventDefault(); return;
  }

  if (k === 'MediaFastForward'|| c === 417 || k === 'ChannelUp'  || c === 427) { moveSel(1);  e.preventDefault(); return; }
  if (k === 'MediaRewind'     || c === 412 || k === 'ChannelDown'|| c === 428) { moveSel(-1); e.preventDefault(); return; }

  if (k === 'ColorF0Red'    || c === 403) { switchTab((plIdx + 1) % (allPlaylists.length + 2)); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || c === 404) { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || c === 405) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || c === 406) { if (hasPlayed) toggleFS(); e.preventDefault(); return; }

  // Additional remote keys
  if (k === 'VolumeUp' || c === 447) {
    video.volume = Math.min(1, video.volume + 0.05);
    e.preventDefault();
    return;
  }
  if (k === 'VolumeDown' || c === 448) {
    video.volume = Math.max(0, video.volume - 0.05);
    e.preventDefault();
    return;
  }
  if (k === 'Mute' || c === 449) {
    video.muted = !video.muted;
    e.preventDefault();
    return;
  }
  if (k === 'Guide' || c === 457) {
    toggleOverlays();
    e.preventDefault();
    return;
  }
});

document.addEventListener('tizenhwkey', function(e) {
  if (e.keyName === 'back') {
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch(ex){}
  }
});

// ── Modals ────────────────────────────────────────────────────────
function openAddPlaylistModal() { playlistName.value=''; playlistUrl.value=''; playlistModal.style.display='flex'; }
function closeAddPlaylistModal() { playlistModal.style.display='none'; }
function handleSavePlaylist() {
  var name = playlistName.value.trim(), url = playlistUrl.value.trim();
  if (!name || !url) { showToast('Please enter both name and URL'); return; }
  if (addCustomPlaylist(name, url)) { showToast('"' + name + '" added'); closeAddPlaylistModal(); }
  else showToast('Already exists or invalid');
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

  if (overlayTop && overlayBottom) {
    overlayTop.classList.remove('info-visible');
    overlayBottom.classList.remove('info-visible');
    overlaysVisible = false;
  }

  if (addPlaylistBtn)     addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if (savePlaylistBtn)    savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if (cancelPlaylistBtn)  cancelPlaylistBtn.addEventListener('click', closeAddPlaylistModal);
  if (playlistModal)      playlistModal.addEventListener('click', function(e){ if (e.target===playlistModal) closeAddPlaylistModal(); });

  if (xtreamLoginBtn) xtreamLoginBtn.addEventListener('click', xtreamLogin);
  if (xtreamCancelBtn)xtreamCancelBtn.addEventListener('click', closeXtreamLogin);
  if (xtreamModal)    xtreamModal.addEventListener('click', function(e){ if(e.target===xtreamModal) closeXtreamLogin(); });

  video.addEventListener('playing', startEpgUpdater);
  video.addEventListener('pause',   stopEpgUpdater);
  video.addEventListener('ended',   stopEpgUpdater);
})();
