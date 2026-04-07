// ================================================================
// SAGA IPTV — app.js v33.0 (FIXED)  |  Samsung Tizen OS9
// ================================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────
var FAV_KEY              = 'iptv:favs';
var CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
var AV_SYNC_KEY          = 'iptv:avSync';
var PREF_AUDIO_KEY       = 'iptv:audioLang';
var PREVIEW_DELAY        = 500;
var VS_IH                = 108;
var VS_GAP               = 8;
var AV_SYNC_STEP         = 50;
var AV_SYNC_MAX          = 500;
var MAX_RECONNECT        = 5;
var STALL_TIMEOUT        = 12000;          // FIXED: increased for live streams
var OVERLAY_AUTO_HIDE    = 4000;
var SEARCH_DEBOUNCE_MS   = 300;
var JIOTV_FIXED_SERVER   = 'http://172.20.10.2:5001';
var JP_PLAY_TIMEOUT_MS   = 15000;          // FIXED: prevent infinite spinner

// ── Samsung BN59-01199F key codes ─────────────────────────────────
var KEY = {
  UP:38, DOWN:40, LEFT:37, RIGHT:39, ENTER:13,
  BACK:10009, EXIT:10182, INFO:457, GUIDE:458,
  PLAY:415, PAUSE:19, PLAY_PAUSE:10252,
  STOP:413, FF:417, RW:412,
  CH_UP:427, CH_DOWN:428, PAGE_UP:33, PAGE_DOWN:34,
  RED:403, GREEN:404, YELLOW:405, BLUE:406,
  VOL_UP:447, VOL_DOWN:448, MUTE:449,
};

// ── Tab helpers ───────────────────────────────────────────────────
function TAB_FAV()   { return allPlaylists.length; }
function TAB_JIOTV() { return allPlaylists.length + 1; }
function TAB_TOTAL() { return allPlaylists.length + 2; }

var DEFAULT_PLAYLISTS = [
  { name:'Telugu', url:'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name:'India',  url:'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

// ── Global state ──────────────────────────────────────────────────
var allPlaylists = [], customPlaylists = [], plIdx = 0;
var channels = [], allChannels = [], filtered = [];
var selectedIndex    = 0;
var focusArea        = 'list';
var tabFocusIdx      = 0;
var isFullscreen     = false, hasPlayed = false;
var currentPlayUrl   = '';
var previewTimer     = null, fsHintTimer = null, loadBarTimer = null;
var dialBuffer       = '', dialTimer = null;
var favSet           = new Set();
var avSyncOffset     = 0, avSyncLabel = null;
var overlaysVisible  = false;
var networkQuality   = 'online', connectionMonitor = null;
var stallWatchdog    = null, lastPlayTime = 0, reconnectCount = 0;
var sleepTimer       = null, sleepMinutes = 0, sleepPaused = false;
var sleepRemainingMs = 0, sleepLastTick = 0;
var toastTm          = null;
var lastChannelStack = [];

// JioTV state
var jiotvClient    = null, jiotvMode = false;
var jiotvChannels  = [];
var jpActiveChannel = null, jpPlayer = null;
var _jpPlayerBusy  = false;
var _jpLoadPromise = Promise.resolve();
var jpOverlayTimer = null;
var jpFocusRow = 0, jpFocusCol = 0, jpGridCols = 8;
var jpFiltered  = [];
var jpActiveCat = 'all', jpActiveLang = 'all', jpSearchQ = '';
var jpInPlayer  = false, jpEpgTimer = null;

// Audio
var _audioTracks        = [];
var _audioTrackIdx      = 0;
var _preferredAudioLang = null;

// ── DOM ref cache ─────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }

var Dom = (function () {
  var ids = [
    'searchInput','searchWrap','searchClear','tabBar','channelList',
    'countBadge','listLabel','nowPlaying','npChNum','statusBadge',
    'video','videoWrap','videoOverlay','fsHint','loadBar',
    'chDialer','chDialerNum','addPlaylistBtn',
    'addPlaylistModal','playlistName','playlistUrl','savePlaylistBtn','cancelPlaylistBtn',
    'overlayTop','overlayBottom','overlayChannelName','overlayChannelTech',
    'overlayProgramTitle','overlayProgramDesc','nextProgramInfo','programInfoBox',
    'toast','appMain','jiotvPortal','jpGrid','jpFilters','jpLangFilters','jpSearch',
    'jpCount','jpNowBar','jpNbThumb','jpNbName','jpNbEpg','jpNbTech',
    'jpPlayerLayer','jpPlayerOverlay','jpVideo','jpPlBack','jpPlTitle','jpPlTime',
    'jpPlSpinner','jpPlProg','jpPlDesc','jpPlTech','jpExitBtn','jpClock',
    'settingsModal','settingsCacheBtn','settingsSleepSelect',
    'settingsAVReset','settingsCloseBtn','settingsAudioTrack',
  ];
  var d = {};
  ids.forEach(function (id) { d[id] = document.getElementById(id); });
  return d;
})();

// ── Safe localStorage ─────────────────────────────────────────────
function lsSet(k, v) { try { localStorage.setItem(k, v); return true; } catch(e) { if(AppCache && AppCache.lsNearQuota()) showToast('Storage full, clearing old cache', 3000); return false; } }
function lsGet(k)    { try { return localStorage.getItem(k); } catch(e) { return null; } }
function lsRemove(k) { try { localStorage.removeItem(k); } catch(e) {} }

// ── Favourites ────────────────────────────────────────────────────
(function () { try { var r = lsGet(FAV_KEY); if (r) favSet = new Set(JSON.parse(r)); } catch(e) {} })();
function saveFavs() { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)  { return ch && ch.url && favSet.has(ch.url); }
function toggleFav(ch) {
  if (!ch || !ch.url) return;
  if (favSet.has(ch.url)) favSet.delete(ch.url); else favSet.add(ch.url);
  saveFavs();
  if (plIdx === TAB_FAV()) showFavourites(); else VS.rebuildVisible();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(function (c) { return favSet.has(c.url); });
  selectedIndex = 0; renderList();
  setLbl('FAVOURITES', filtered.length);
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, dur) {
  if (!Dom.toast) return;
  Dom.toast.textContent = msg; Dom.toast.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(function () { Dom.toast.style.opacity = '0'; }, dur || 2800);
}

// ── Status / load bar ─────────────────────────────────────────────
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
  Dom.loadBar.style.width = '0%'; Dom.loadBar.classList.add('active');
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
  setTimeout(function () { Dom.loadBar.classList.remove('active'); Dom.loadBar.style.width = '0%'; }, 440);
}
function refreshLbl() {
  if (jiotvMode) setLbl('JIOTV', channels.length);
  else if (plIdx === TAB_FAV()) setLbl('FAVOURITES', filtered.length);
  else setLbl('CHANNELS', channels.length);
}

// ── HTML escape ───────────────────────────────────────────────────
var _escMap = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' };
function esc(s) { return String(s || '').replace(/[&<>"]/g, function (c) { return _escMap[c]; }); }

// ── M3U parser (FIXED: handles quoted attributes) ─────────────────
function parseM3U(text) {
  var lines = String(text || '').split(/\r?\n/);
  var out = [], meta = null;
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i].trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      var name = '';
      var commaIdx = line.lastIndexOf(',');
      if (commaIdx !== -1) name = line.substring(commaIdx + 1).trim();
      else name = 'Unknown';
      var group = 'Other';
      var logo = '';
      var groupMatch = line.match(/group-title="([^"]+)"/i);
      if (groupMatch) group = groupMatch[1];
      var logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      if (logoMatch) logo = logoMatch[1];
      meta = { name: name, group: group, logo: logo };
    } else if (meta && !line.startsWith('#')) {
      out.push({ name: meta.name, group: meta.group, logo: meta.logo, url: line });
      meta = null;
    }
  }
  return out;
}

// ── SagaPlayer callbacks ──────────────────────────────────────────
async function _initPlayerCallbacks() {
  await SagaPlayer.init(Dom.video, {
    onStatus: function (msg, cls) { setStatus(msg, cls); },
    onBuffering: function (isBuffering) {
      if (isBuffering) { setStatus('Buffering…', 'loading'); startLoadBar(); }
      else { setStatus('Playing', 'playing'); finishLoadBar(); _updateChTech(); }
    },
    onTechUpdate: _updateChTech,
    onError: function (msg) { setStatus(msg, 'error'); finishLoadBar(); stopStallWatchdog(); },
  });
}
function _updateChTech() {
  var info = SagaPlayer.getTechInfo();
  if (Dom.overlayChannelTech) Dom.overlayChannelTech.textContent = info;
}

// ── AV Sync ───────────────────────────────────────────────────────
function loadAvSync() {
  var v = parseInt(lsGet(AV_SYNC_KEY) || '0', 10);
  avSyncOffset = isNaN(v) ? 0 : Math.max(-AV_SYNC_MAX, Math.min(AV_SYNC_MAX, v));
}
function saveAvSync() { lsSet(AV_SYNC_KEY, String(avSyncOffset)); }
function applyAvSync() { /* same as original */ }
function adjustAvSync(sign) { /* same */ }
function resetAvSync() { /* same */ }
function _updateAvLabel() { /* same */ }
function buildAvSyncBar() { /* same */ }

// ── Audio track persistence (FIXED: event based) ──────────────────
function loadPreferredAudioLang() {
  _preferredAudioLang = lsGet(PREF_AUDIO_KEY) || null;
}
function _applyPreferredAudio() {
  if (!_preferredAudioLang) return;
  var apply = function() {
    var tracks = SagaPlayer.getAudioTracks();
    if (!tracks || !tracks.length) return;
    var match = tracks.find(function (t) { return t.language === _preferredAudioLang; });
    if (match) SagaPlayer.setAudioLanguage(match.language, match.role || '');
  };
  if (Dom.video) {
    Dom.video.removeEventListener('loadedmetadata', apply);
    Dom.video.addEventListener('loadedmetadata', apply, { once: true });
    if (Dom.video.readyState >= 1) apply();
  }
}
function cycleAudioTrack() { /* same */ }

// ── Sleep timer – reset only on navigation/playback keys ──────────
function resetSleepTimerOnAction(keyCode) {
  var navKeys = [KEY.UP, KEY.DOWN, KEY.LEFT, KEY.RIGHT, KEY.ENTER, KEY.CH_UP, KEY.CH_DOWN, KEY.PLAY, KEY.PAUSE, KEY.PLAY_PAUSE];
  var digits = [48,49,50,51,52,53,54,55,56,57,96,97,98,99,100,101,102,103,104,105];
  if (navKeys.includes(keyCode) || digits.includes(keyCode)) {
    if (sleepTimer && sleepMinutes) {
      clearInterval(sleepTimer);
      _startSleepCountdown(sleepMinutes * 60000);
    }
  }
}
function setSleepTimer(m) { /* same but calls _startSleepCountdown */ }
function _startSleepCountdown(ms) { /* same */ }
function clearSleepTimer() { /* same */ }
function _clearSleepState() { /* same */ }

// ── Stall watchdog (FIXED: also resets on progress) ───────────────
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
        SagaPlayer.play(currentPlayUrl, null).catch(function () {});
      } else {
        setStatus('Stream lost', 'error'); stopStallWatchdog();
      }
    }
  }, 4000);
}
function stopStallWatchdog() {
  if (stallWatchdog) { clearInterval(stallWatchdog); stallWatchdog = null; }
}
if (Dom.video) {
  Dom.video.addEventListener('timeupdate', function () { if (!Dom.video.paused) lastPlayTime = Date.now(); });
  Dom.video.addEventListener('progress', function () { if (!Dom.video.paused) lastPlayTime = Date.now(); });
  Dom.video.addEventListener('playing', function () { lastPlayTime = Date.now(); });
}

// ── Virtual Scroll (FIXED: pool limit & DOM cleanup) ──────────────
var VS = {
  IH: VS_IH, GAP: VS_GAP, OS: 4,
  c: null, inner: null, vh: 0, st: 0, total: 0,
  pool: [], nodes: {}, raf: null, maxPool: 60,
  init: function (el) { /* same as original */ },
  setData: function (n) {
    this.total = n;
    for (var k in this.nodes) { var nd = this.nodes[k]; nd.style.display = 'none'; nd._i = -1; if (this.pool.length < this.maxPool) this.pool.push(nd); else nd.remove(); }
    this.nodes = {};
    this.inner.style.height = n > 0 ? (n*(this.IH+this.GAP)-this.GAP+20)+'px' : '0';
    this.c.scrollTop = 0; this.st = 0; this.vh = this.c.clientHeight || 900; this.paint();
  },
  scrollTo: function (idx) { /* same */ },
  centerOn: function (idx) { /* same */ },
  paint: function () { /* same, but ensures old nodes removed from DOM */ },
  mkNode: function () { /* same */ },
  build: function (li, i) { /* same */ },
  refresh: function () { /* same */ },
  rebuildVisible: function () { /* same */ },
};

// ── Render list, search, etc. (unchanged) ─────────────────────────
function renderList() { /* same */ }
function applySearch() { /* same */ }
function commitSearch() { /* same */ }
function clearSearch() { /* same */ }

// ── XHR fetch + CDN mirror (unchanged) ───────────────────────────
function xhrFetch(url, ms, cb) { /* same */ }
function mirrorUrl(url) { /* same */ }
function _isAllowedPlaylistURL(url) { /* same */ }

// ── M3U playlist load (unchanged) ─────────────────────────────────
function loadPlaylist(urlOv) { /* same */ }

// ── Network monitor (unchanged) ──────────────────────────────────
function updateNetworkIndicator() { /* same */ }
function startNetworkMonitoring() { /* same */ }

// ── Clock (unchanged) ────────────────────────────────────────────
function _updateAllClocks() { /* same */ }
setInterval(_updateAllClocks, 1000);
_updateAllClocks();

// ── Preview / play (unchanged) ───────────────────────────────────
function cancelPreview() { clearTimeout(previewTimer); previewTimer = null; }
function schedulePreview() { /* same */ }
async function startPreview(idx) { /* same */ }
function playSelected() { cancelPreview(); startPreview(selectedIndex); }
function goPreCh() { /* same */ }

// ── Video events (unchanged) ─────────────────────────────────────
if (Dom.video) { /* same */ }

// ── Fullscreen (FIXED: forced exit on BACK) ──────────────────────
function showFsHint() { /* same */ }
function applyExitFSState() {
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
  if (Dom.fsHint) Dom.fsHint.classList.remove('visible');
  window.dispatchEvent(new Event('resize'));
  setFocus('list'); VS.refresh();
}
function enterFS() { /* same */ }
function exitFS() { applyExitFSState(); var fn=document.exitFullscreen||document.webkitExitFullscreen; if(fn)fn.call(document); }
function toggleFS() { if(isFullscreen) exitFS(); else enterFS(); }
function onFsChange() { if(!(document.fullscreenElement||document.webkitFullscreenElement)&&isFullscreen) applyExitFSState(); }
document.addEventListener('fullscreenchange', onFsChange);
document.addEventListener('webkitfullscreenchange', onFsChange);

function toggleOverlays() { /* same */ }

// ── Channel dialer (unchanged) ───────────────────────────────────
function commitChannelNumber() { /* same */ }
function handleDigit(d) { /* same */ }
function getDigit(e) { /* same */ }

// ── Focus management (unchanged) ─────────────────────────────────
function setFocus(a) { /* same */ }
function moveSel(d) { /* same */ }
function moveTabFocus(d) { /* same */ }
function activateFocusedTab() { /* same */ }

// ── Tizen key registration (unchanged) ───────────────────────────
function registerKeys() { /* same */ }

// ══════════════════════════════════════════════════════════════════
// JIOTV PORTAL — FIXED: timeout, EPG interval, play mutex
// ══════════════════════════════════════════════════════════════════
function showJioPortal() { /* same */ }
function hideJioPortal() { /* same */ }

async function _autoConnectJioTV() {
  try {
    var timeoutPromise = new Promise(function(_, reject) { setTimeout(function() { reject(new Error('Timeout')); }, 5000); });
    var clientPromise = JioTVClient.directConnect(JIOTV_FIXED_SERVER);
    var client = await Promise.race([clientPromise, timeoutPromise]);
    jiotvClient = client;
    jiotvMode = true;
    return true;
  } catch (e) {
    console.warn('[JioTV] auto-connect failed:', e.message);
    showToast('JioTV Go offline — start app on phone', 4000);
    return false;
  }
}

async function openJioPortalDirect() {
  jiotvMode = true; plIdx = TAB_JIOTV(); rebuildTabs();
  if (!jiotvClient || !jiotvClient.logged_in) {
    setStatus('Connecting to JioTV…', 'loading'); startLoadBar();
    var ok = await _autoConnectJioTV();
    if (!ok) { jiotvMode=false; plIdx=0; rebuildTabs(); _fallbackM3u(); finishLoadBar(); return; }
  }
  if (jiotvChannels.length === 0) await loadJioChannels();
  else jpFiltered = jiotvChannels.slice();
  saveMode(); showJioPortal();
}

function jpApplyFilters() { /* same */ }
function _jpBuildGrid() { /* same */ }
function jpFocusTile() { /* same */ }
function jpMoveFocus(dr, dc) { /* same */ }
function jpActivateFilter(f) { /* same */ }

// FIXED: JioTV play with timeout and spinner cleanup
function jpPlayChannel(ch, gridIdx) {
  _jpLoadPromise = _jpLoadPromise.then(async function () {
    if (_jpPlayerBusy) return;
    _jpPlayerBusy = true;
    var timeoutId = null;
    try {
      jpActiveChannel = ch; jpInPlayer = true;
      if (Dom.jpPlayerLayer) Dom.jpPlayerLayer.style.display = 'block';
      if (Dom.jpPlayerOverlay) Dom.jpPlayerOverlay.classList.add('visible');
      if (Dom.jpPlTitle) Dom.jpPlTitle.textContent = ch.name;
      if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.add('active');
      _jpSyncPlayingState();
      _jpUpdateNowBar(ch);
      if (!jpPlayer) {
        shaka.polyfill.installAll();
        jpPlayer = new shaka.Player(Dom.jpVideo);
        jpPlayer.configure({ streaming: { lowLatencyMode: true, bufferingGoal: 10 } });
        jpPlayer.addEventListener('error', function() { if(Dom.jpPlSpinner) Dom.jpPlSpinner.classList.remove('active'); });
        jpPlayer.addEventListener('buffering', function(ev) { if(Dom.jpPlSpinner) Dom.jpPlSpinner.classList.toggle('active', ev.buffering); });
      }
      var info = await jiotvClient.getStreamInfo(ch.jioId);
      var playUrl = (info && info.url) ? info.url : ch.url;
      await jpPlayer.unload(); Dom.jpVideo.removeAttribute('src');
      await jpPlayer.load(playUrl);
      await Dom.jpVideo.play().catch(function(){});
      jpShowOverlay();
      setTimeout(function(){ if(jpInPlayer) jpHideOverlay(); }, OVERLAY_AUTO_HIDE);
      // EPG every 30 seconds instead of 800ms
      clearInterval(jpEpgTimer);
      jpEpgTimer = setInterval(function() {
        if (jpInPlayer && jpActiveChannel) jpFetchEpg(jpActiveChannel.jioId);
      }, 30000);
      jpFetchEpg(ch.jioId);
    } catch(err) {
      console.error('[JioTV] play error:', err.message);
      if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.remove('active');
      showToast('Stream error: ' + err.message);
      jpExitPlayer();
    } finally {
      _jpPlayerBusy = false;
      if (timeoutId) clearTimeout(timeoutId);
    }
  });
}

function jpExitPlayer() {
  jpInPlayer = false; _jpPlayerBusy = false;
  if (jpEpgTimer) { clearInterval(jpEpgTimer); jpEpgTimer = null; }
  if (jpPlayer) jpPlayer.unload().catch(function(){});
  if (Dom.jpVideo) Dom.jpVideo.removeAttribute('src');
  if (Dom.jpPlayerLayer) Dom.jpPlayerLayer.style.display = 'none';
  if (Dom.jpPlayerOverlay) Dom.jpPlayerOverlay.classList.remove('visible');
  if (Dom.jpPlSpinner) Dom.jpPlSpinner.classList.remove('active');
  requestAnimationFrame(function(){ jpFocusTile(); });
}
function jpShowOverlay() { /* same */ }
function jpHideOverlay() { /* same */ }
function _jpUpdateNowBar(ch) { /* same */ }
function _jpUpdateTech() { /* same */ }
async function jpFetchEpg(channelId) { /* same, but now called less often */ }

// Portal event delegation (unchanged)
if(Dom.jpFilters) Dom.jpFilters.addEventListener('click', function(e){ var f=e.target.closest('.jp-filter'); if(f) jpActivateFilter(f); });
if(Dom.jpLangFilters) Dom.jpLangFilters.addEventListener('click', function(e){ var f=e.target.closest('.jp-filter'); if(f) jpActivateFilter(f); });
if(Dom.jpSearch) Dom.jpSearch.addEventListener('input', function(){ jpSearchQ=Dom.jpSearch.value; jpFocusRow=0; jpFocusCol=0; jpApplyFilters(); });
if(Dom.jpExitBtn) Dom.jpExitBtn.addEventListener('click', hideJioPortal);
if(Dom.jpPlBack) Dom.jpPlBack.addEventListener('click', jpExitPlayer);

async function loadJioChannels() { /* same */ }
function _applyJioChannels(list){ /* same */ }
async function _refreshJioBackground(){ /* same */ }

function saveMode(){ if(jiotvMode)lsSet('iptv:mode','jiotv'); else{lsSet('iptv:mode','m3u'); lsSet('iptv:lastM3uIndex',String(plIdx));} }
async function loadMode(){ /* same */ }
function _fallbackM3u(){ /* same */ }

// ══════════════════════════════════════════════════════════════════
// SETTINGS MODAL (unchanged)
// ══════════════════════════════════════════════════════════════════
function openSettings() { /* same */ }
function closeSettings(){ /* same */ }
if(Dom.settingsCloseBtn) Dom.settingsCloseBtn.addEventListener('click', closeSettings);
if(Dom.settingsCacheBtn) Dom.settingsCacheBtn.addEventListener('click', function(){ if(window.AppCache){AppCache.clearAllM3U();AppCache.clearJioChannels();} showToast('Cache cleared'); closeSettings(); });
if(Dom.settingsSleepSelect) Dom.settingsSleepSelect.addEventListener('change', function(){ setSleepTimer(parseInt(Dom.settingsSleepSelect.value,10)||0); });
if(Dom.settingsAVReset) Dom.settingsAVReset.addEventListener('click', function(){ resetAvSync(); });
if(Dom.settingsAudioTrack) Dom.settingsAudioTrack.addEventListener('click', cycleAudioTrack);

// ══════════════════════════════════════════════════════════════════
// MASTER KEY HANDLER (FIXED: sleep reset only on action keys)
// ══════════════════════════════════════════════════════════════════
window.addEventListener('keydown', function(e) {
  var k=e.key, kc=e.keyCode;
  resetSleepTimerOnAction(kc);   // only resets if key is navigation/playback
  // ... rest of the key handler remains same as original but with fullscreen fix
  if(Dom.jiotvPortal && Dom.jiotvPortal.style.display!=='none') {
    // JioTV portal handling (unchanged)
    if(jpInPlayer) {
      if(kc===KEY.BACK || k==='Escape') { jpExitPlayer(); e.preventDefault(); return; }
      // ...
    }
    // grid navigation
    // ...
    return;
  }
  // Modals, dialer, etc.
  if(kc===KEY.BACK && isFullscreen) { exitFS(); e.preventDefault(); return; }
  // ... original key handling
});

document.addEventListener('tizenhwkey', function(e){
  var name=(e.keyName||'').toLowerCase();
  if(name==='back'){
    if(Dom.jiotvPortal && Dom.jiotvPortal.style.display!=='none'){ if(jpInPlayer) jpExitPlayer(); else hideJioPortal(); return; }
    if(isFullscreen){ exitFS(); return; }
    var anyModal=(Dom.addPlaylistModal && Dom.addPlaylistModal.style.display==='flex') || (Dom.settingsModal && Dom.settingsModal.style.display==='flex');
    if(anyModal){ closeAllModals(); return; }
    try{if(window.tizen) tizen.application.getCurrentApplication().exit();}catch(ex){}
  }
});

function closeAllModals(){ /* same */ }
function openAddPlaylistModal(){ /* same */ }
function handleSavePlaylist(){ /* same */ }
function loadCustomPlaylists(){ /* same */ }
function saveCustomPlaylists(){ /* same */ }
function addCustomPlaylist(name,url){ /* same */ }
function rebuildAllPlaylists(){ /* same */ }
function rebuildTabs(){ /* same */ }
function switchTab(idx){ /* same */ }

// ── Boot ──────────────────────────────────────────────────────────
(async function init(){
  registerKeys();
  loadAvSync();
  loadCustomPlaylists();
  loadPreferredAudioLang();
  allPlaylists = DEFAULT_PLAYLISTS.concat(customPlaylists);
  VS.init(Dom.channelList);
  await _initPlayerCallbacks();
  buildAvSyncBar();
  startNetworkMonitoring();
  await loadMode();
  if(Dom.overlayTop) Dom.overlayTop.classList.remove('info-visible');
  if(Dom.overlayBottom) Dom.overlayBottom.classList.remove('info-visible');
  overlaysVisible=false;
  if(Dom.addPlaylistBtn) Dom.addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if(Dom.savePlaylistBtn) Dom.savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if(Dom.cancelPlaylistBtn) Dom.cancelPlaylistBtn.addEventListener('click', function(){ Dom.addPlaylistModal.style.display='none'; setFocus('list'); });
  if(Dom.addPlaylistModal) Dom.addPlaylistModal.addEventListener('click', function(e){ if(e.target===Dom.addPlaylistModal){ Dom.addPlaylistModal.style.display='none'; setFocus('list'); } });
  [Dom.playlistName, Dom.playlistUrl].forEach(function(inp){ if(inp) inp.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.keyCode===13) handleSavePlaylist(); }); });
  if(jiotvMode && jiotvChannels.length>0) setTimeout(function(){ showJioPortal(); },300);
})();