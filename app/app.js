// ================================================================
// IPTV Pro — app.js v17.0 | Samsung Tizen OS9 TV
// M3U playlists, Xtream tab, AV sync tweaks, auto‑login fallback
// ================================================================

const FAV_KEY = 'iptv:favs';
const PLAYLIST_KEY = 'iptv:lastPl';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const PREVIEW_DELAY = 700;

const DEFAULT_PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

let allPlaylists = [];
let customPlaylists = [];
let plIdx = 0;               // index in allPlaylists (for M3U) or Xtream/Favs
let xtreamTabIndex = -1;     // will be set dynamically
let lastM3uIndex = 0;

const AR_MODES = [
  { cls: '',          label: 'Native' },
  { cls: 'ar-fill',   label: 'Fill'   },
  { cls: 'ar-cover',  label: 'Crop'   },
  { cls: 'ar-wide',   label: 'Wide'   },
];

// ── DOM refs ────────────────────────────────────────────────────
const searchInput    = document.getElementById('searchInput');
const searchWrap     = document.getElementById('searchWrap');
const tabBar         = document.getElementById('tabBar');
const channelListEl  = document.getElementById('channelList');
const countBadge     = document.getElementById('countBadge');
const nowPlayingEl   = document.getElementById('nowPlaying');
const npChNumEl      = document.getElementById('npChNum');
const statusBadge    = document.getElementById('statusBadge');
const video          = document.getElementById('video');
const videoWrap      = document.getElementById('videoWrap');
const videoOverlay   = document.getElementById('videoOverlay');
const fsHint         = document.getElementById('fsHint');
const loadBar        = document.getElementById('loadBar');
const chDialer       = document.getElementById('chDialer');
const chDialerNum    = document.getElementById('chDialerNum');
const arBtn          = document.getElementById('arBtn');
const addPlaylistBtn = document.getElementById('addPlaylistBtn');
const playlistModal  = document.getElementById('addPlaylistModal');
const playlistName   = document.getElementById('playlistName');
const playlistUrl    = document.getElementById('playlistUrl');
const savePlaylistBtn= document.getElementById('savePlaylistBtn');
const cancelPlaylistBtn = document.getElementById('cancelPlaylistBtn');

// Overlay elements
const overlayTop = document.getElementById('overlayTop');
const overlayBottom = document.getElementById('overlayBottom');
const overlayChannelName = document.getElementById('overlayChannelName');
const overlayChannelTech = document.getElementById('overlayChannelTech');
const overlayProgramTitle = document.getElementById('overlayProgramTitle');
const overlayProgramDesc = document.getElementById('overlayProgramDesc');
const progressBar = document.getElementById('progressBar');
const nextProgramInfo = document.getElementById('nextProgramInfo');

// ── State ───────────────────────────────────────────────────────
let channels      = [];
let allChannels   = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list';
let isFullscreen  = false;
let hasPlayed     = false;
let player        = null;
let arIdx         = 0;
let preFullscreenArMode = null;
let fsHintTimer   = null;
let loadBarTimer  = null;
let previewTimer  = null;
let dialBuffer    = '';
let dialTimer     = null;
let toastEl       = null;
let toastTm       = null;
let favSet        = new Set();
let networkQuality = 'online';
let connectionMonitor = null;
let progressInterval = null;
let currentProgramDuration = 300;
let overlaysVisible = true;

// ── Xtream specific state ──────────────────────────────────────
let xtreamClient = null;
let xtreamMode = false;
let xtreamCategories = [];
let xtreamChannels = [];

// ── Xtream DOM elements ────────────────────────────────────────
const xtreamModal = document.getElementById('xtreamLoginModal');
const xtreamServerUrl = document.getElementById('xtreamServerUrl');
const xtreamUsername = document.getElementById('xtreamUsername');
const xtreamPassword = document.getElementById('xtreamPassword');
const xtreamLoginBtn = document.getElementById('xtreamLoginBtn');
const xtreamCancelBtn = document.getElementById('xtreamCancelBtn');
const xtreamLoginStatus = document.getElementById('xtreamLoginStatus');
const xtreamAccountInfo = document.getElementById('xtreamAccountInfo');

// ── localStorage helpers ────────────────────────────────────────
function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('[ls] set failed', key, e.name); }
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

// ── Favourites ──────────────────────────────────────────────────
(function loadFavs() {
  try {
    const r = lsGet(FAV_KEY);
    if (r) favSet = new Set(JSON.parse(r));
  } catch (e) {}
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
  setStatus(filtered.length ? `${filtered.length} favourites` : 'No favourites yet', 'idle');
}

// ── Toast ───────────────────────────────────────────────────────
function showToast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.id = 'toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(() => { toastEl.style.opacity = '0'; }, 2200);
}

// ── Status / load-bar ───────────────────────────────────────────
function setStatus(t, c) {
  statusBadge.textContent = t;
  statusBadge.className = 'status-badge ' + (c || 'idle');
}

function startLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '0%';
  loadBar.classList.add('active');
  let w = 0;
  const tick = () => {
    w = Math.min(w + Math.random() * 9, 85);
    loadBar.style.width = w + '%';
    if (w < 85) loadBarTimer = setTimeout(tick, 220);
  };
  loadBarTimer = setTimeout(tick, 100);
}

function finishLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '100%';
  setTimeout(() => { loadBar.classList.remove('active'); loadBar.style.width = '0%'; }, 400);
}

// ── M3U helpers ─────────────────────────────────────────────────
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
  const lines = String(text || '').split(/\r?\n/);
  const out = [];
  let meta = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const namePart = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const gm = line.match(/group-title="([^"]+)"/i);
      const lm = line.match(/tvg-logo="([^"]+)"/i);
      meta = {
        name: cleanName(namePart) || namePart,
        group: gm ? gm[1] : 'Other',
        logo: lm ? lm[1] : '',
      };
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
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function initials(n) {
  return String(n || '')
    .replace(/[^a-zA-Z0-9]/g, ' ').trim()
    .split(/\s+/).slice(0, 2)
    .map(w => w[0] || '').join('').toUpperCase() || '?';
}

// ── Program info (simulated) ───────────────────────────────────
function getProgramInfo(channelName) {
  const programs = [
    { time: 'Now', title: 'Live Broadcast', desc: 'Currently airing' },
    { time: '20:00', title: 'Prime Time', desc: 'Evening programming' },
    { time: '21:30', title: 'Late Night Show', desc: 'Entertainment' },
    { time: '19:00', title: 'News Hour', desc: 'Latest updates' },
    { time: '18:00', title: 'Kids Corner', desc: 'Family friendly' },
    { time: '22:00', title: 'Movie Night', desc: 'Blockbuster films' },
    { time: '17:00', title: 'Sports Update', desc: 'Live scores' },
    { time: '16:00', title: 'Music Mix', desc: 'Top hits' }
  ];
  const hash = channelName.split('').reduce((a, b) => { a = ((a << 5) - a) + b.charCodeAt(0); return a & a; }, 0);
  const index = Math.abs(hash) % programs.length;
  const program = programs[index];
  const nextIndex = (index + 1) % programs.length;
  const nextProgram = programs[nextIndex];
  return {
    current: program,
    next: nextProgram
  };
}

function updateOverlayInfo(channelName, channelIndex) {
  if (overlayChannelName) overlayChannelName.textContent = channelName;
  if (npChNumEl) npChNumEl.textContent = 'CH ' + (channelIndex + 1);
  const program = getProgramInfo(channelName);
  if (overlayProgramTitle) overlayProgramTitle.textContent = program.current.title;
  if (overlayProgramDesc) overlayProgramDesc.textContent = program.current.desc;
  if (nextProgramInfo) nextProgramInfo.textContent = `Next: ${program.next.title} at ${program.next.time}`;
}

function startProgressSimulation(duration = 300) {
  if (progressInterval) clearInterval(progressInterval);
  let startTime = Date.now();
  progressInterval = setInterval(() => {
    const elapsed = (Date.now() - startTime) / 1000;
    const percent = Math.min(100, (elapsed / duration) * 100);
    if (progressBar) progressBar.style.width = `${percent}%`;
    if (percent >= 100) {
      startTime = Date.now();
      const currentChannel = filtered[selectedIndex];
      if (currentChannel) {
        const program = getProgramInfo(currentChannel.name);
        if (overlayProgramTitle) overlayProgramTitle.textContent = program.current.title;
        if (overlayProgramDesc) overlayProgramDesc.textContent = program.current.desc;
        if (nextProgramInfo) nextProgramInfo.textContent = `Next: ${program.next.title} at ${program.next.time}`;
      }
    }
  }, 100);
}

function updateChannelTech() {
  if (!player) return;
  try {
    const stats = player.getStats();
    const videoTrack = player.getVariantTracks ? player.getVariantTracks().find(t => t.active) : null;
    const bitrate = stats ? stats.streamBandwidth || 0 : 0;
    const width = videoTrack ? videoTrack.width || 0 : 0;
    const height = videoTrack ? videoTrack.height || 0 : 0;
    const fps = videoTrack ? videoTrack.frameRate || 0 : 0;
    if (overlayChannelTech) {
      overlayChannelTech.innerHTML = `${width}x${height} · ${(bitrate / 1e6).toFixed(1)} Mbps · ${Math.round(fps)} fps`;
    }
  } catch (e) {
    console.warn('Failed to get tech info', e);
  }
}

// ── Virtual scroll (unchanged) ─────────────────────────────────
const VS = {
  ITEM_H: 98,
  OVERSCAN: 6,
  c: null,
  inner: null,
  vh: 0,
  st: 0,
  total: 0,
  rs: -1,
  re: -1,
  nodes: [],
  raf: null,

  init(el) {
    this.c = el;
    this.inner = document.createElement('div');
    this.inner.id = 'vsInner';
    this.c.appendChild(this.inner);
    this.vh = this.c.clientHeight || 700;
    this.c.addEventListener('scroll', () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null;
        this.st = this.c.scrollTop;
        this.paint();
      });
    }, { passive: true });
  },

  setData(n) {
    this.total = n;
    this.rs = -1;
    this.re = -1;
    this.inner.textContent = '';
    this.nodes = [];
    this.inner.style.cssText = `position:relative;width:100%;height:${n * this.ITEM_H}px;`;
    this.st = this.c.scrollTop;
    this.vh = this.c.clientHeight || 700;
    this.paint();
  },

  scrollToIndex(idx) {
    const top = idx * this.ITEM_H;
    const bot = top + this.ITEM_H;
    const st = this.c.scrollTop;
    if (top < st) this.c.scrollTop = top;
    else if (bot > st + this.vh) this.c.scrollTop = bot - this.vh;
    this.st = this.c.scrollTop;
    this.paint();
  },

  scrollToIndexCentered(idx) {
    const center = idx * this.ITEM_H - (this.vh / 2) + (this.ITEM_H / 2);
    this.c.scrollTop = Math.max(0, center);
    this.st = this.c.scrollTop;
    this.rs = -1;
    this.re = -1;
    this.paint();
  },

  paint() {
    if (!this.total) return;
    const H = this.ITEM_H;
    const os = this.OVERSCAN;
    const start = Math.max(0, Math.floor(this.st / H) - os);
    const end = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);
    if (start === this.rs && end === this.re) return;
    this.rs = start;
    this.re = end;

    this.nodes = this.nodes.filter(nd => {
      if (nd._i < start || nd._i > end) {
        this.inner.removeChild(nd);
        return false;
      }
      return true;
    });

    const have = new Set(this.nodes.map(n => n._i));
    const frag = document.createDocumentFragment();
    for (let i = start; i <= end; i++) {
      if (!have.has(i)) frag.appendChild(this.build(i));
    }
    if (frag.childNodes.length) this.inner.appendChild(frag);
    this.nodes = [...this.inner.children];

    for (const nd of this.nodes) {
      const on = nd._i === selectedIndex;
      if (on !== nd._on) {
        nd._on = on;
        nd.classList.toggle('active', on);
      }
    }
  },

  build(i) {
    const ch = filtered[i];
    const li = document.createElement('li');
    li._i = i;
    li._on = false;
    li.style.cssText = `position:absolute;top:${i * this.ITEM_H}px;left:0;right:0;height:auto;min-height:${this.ITEM_H}px;`;

    const logo = ch.logo
      ? `<div class="ch-logo"><img src="${esc(ch.logo)}" onerror="this.parentNode.innerHTML='&lt;div class=&quot;ch-logo ch-logo-fb&quot;&gt;${esc(initials(ch.name))}&lt;/div&gt;'"></div>`
      : `<div class="ch-logo ch-logo-fb">${esc(initials(ch.name))}</div>`;

    const program = getProgramInfo(ch.name);
    const programHtml = `
      <div class="ch-program">
        <span class="program-time">${program.current.time}</span>
        <span class="program-title">${esc(program.current.title)}</span>
      </div>
    `;

    li.innerHTML = `
      ${logo}
      <div class="ch-info">
        <div class="ch-name">${esc(ch.name)}</div>
        ${programHtml}
      </div>
      ${isFav(ch) ? '<div class="ch-fav">★</div>' : ''}
      <div class="ch-num">${i + 1}</div>
    `;

    if (i === selectedIndex) {
      li._on = true;
      li.classList.add('active');
    }
    li.addEventListener('click', () => {
      selectedIndex = i;
      VS.refresh();
      schedulePreview();
    });
    return li;
  },

  refresh() {
    this.rs = -1;
    this.re = -1;
    this.paint();
  }
};

// ── Render list ─────────────────────────────────────────────────
function renderList() {
  countBadge.textContent = String(filtered.length);
  if (!filtered.length) {
    VS.setData(0);
    const li = document.createElement('li');
    li.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:24px 16px;text-align:center;';
    li.textContent = 'No channels';
    VS.inner.appendChild(li);
    return;
  }
  VS.setData(filtered.length);
  VS.scrollToIndex(selectedIndex);
}

// ── Search ───────────────────────────────────────────────────────
let sdTm = null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm = setTimeout(() => {
    const q = searchInput.value.trim().toLowerCase();
    filtered = !q
      ? channels.slice()
      : channels.filter(c => c.name.toLowerCase().includes(q) || (c.group || '').toLowerCase().includes(q));
    selectedIndex = 0;
    renderList();
  }, 120);
}
function commitSearch() {
  setFocus('list');
  if (filtered.length === 1) {
    selectedIndex = 0;
    VS.refresh();
    schedulePreview();
  }
}
function clearSearch() {
  searchInput.value = '';
  applySearch();
  setFocus('list');
}
searchInput.addEventListener('input', applySearch);

// ── XHR fetch ───────────────────────────────────────────────────
function xhrFetch(url, ms, cb) {
  let done = false;
  const xhr = new XMLHttpRequest();
  const tid = setTimeout(() => {
    if (done) return;
    done = true;
    xhr.abort();
    cb(new Error('Timeout ' + ms + 'ms'), null);
  }, ms);

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4 || done) return;
    done = true;
    clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };

  xhr.onerror = function () {
    if (done) return;
    done = true;
    clearTimeout(tid);
    cb(new Error('Network error'), null);
  };

  xhr.open('GET', url, true);
  xhr.send();
}

function mirrorUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    const p = u.pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    return `https://cdn.jsdelivr.net/gh/${p[0]}/${p[1]}@${p[2]}/${p.slice(3).join('/')}`;
  } catch (e) {
    return null;
  }
}

// ── Playlist loading (M3U) ───────────────────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();

  if (plIdx === allPlaylists.length + 1 && !urlOv) {
    showFavourites();
    return;
  }

  const rawUrl = urlOv || (plIdx < allPlaylists.length ? allPlaylists[plIdx].url : null);
  if (!rawUrl) return;

  const cacheKey = 'plCache:' + rawUrl;
  const cacheTimeKey = 'plCacheTime:' + rawUrl;

  try {
    const cached = lsGet(cacheKey);
    const cacheTime = parseInt(lsGet(cacheTimeKey) || '0', 10);
    if (cached && cached.length > 100 && (Date.now() - cacheTime) < 10 * 60 * 1000) {
      onLoaded(cached, true);
      return;
    }
  } catch (e) {}

  setStatus('Loading…', 'loading');
  startLoadBar();

  function tryDirect() {
    xhrFetch(rawUrl, 30000, (err, text) => {
      if (!err && text && text.length > 100) {
        persist(text);
        finishLoadBar();
        onLoaded(text, false);
        return;
      }
      console.warn('[playlist] direct failed', err && err.message);
      const mirror = mirrorUrl(rawUrl);
      if (mirror) {
        setStatus('Retrying mirror…', 'loading');
        xhrFetch(mirror, 30000, (err2, text2) => {
          finishLoadBar();
          if (!err2 && text2 && text2.length > 100) {
            persist(text2);
            onLoaded(text2, false);
          } else {
            setStatus('Failed — check network', 'error');
          }
        });
      } else {
        finishLoadBar();
        setStatus('Failed — no mirror available', 'error');
      }
    });
  }

  tryDirect();

  function persist(text) {
    try {
      lsSet(cacheKey, text);
      lsSet(cacheTimeKey, String(Date.now()));
    } catch (e) {}
  }

  function onLoaded(text, fromCache) {
    channels = parseM3U(text);
    allChannels = channels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    lsSet(PLAYLIST_KEY, String(plIdx));
    setStatus(`Ready · ${channels.length} ch${fromCache ? ' (cached)' : ''}`, 'idle');
    setFocus('list');
  }
}

// ── Network status monitor ─────────────────────────────────────
function updateNetworkIndicator() {
  const indicator = document.getElementById('networkIndicator');
  if (!indicator) return;
  indicator.className = 'network-indicator';
  if (!navigator.onLine) {
    networkQuality = 'offline';
    indicator.classList.add('offline');
    indicator.title = 'No internet connection';
  } else if (navigator.connection && navigator.connection.downlink) {
    const speed = navigator.connection.downlink;
    if (speed < 1) {
      networkQuality = 'slow';
      indicator.classList.add('slow');
      indicator.title = `Slow network (${speed.toFixed(1)} Mbps)`;
    } else {
      networkQuality = 'online';
      indicator.classList.add('online');
      indicator.title = `Network OK (${speed.toFixed(1)} Mbps)`;
    }
  } else {
    networkQuality = 'online';
    indicator.classList.add('online');
    indicator.title = 'Network online';
  }

  if (player) {
    if (networkQuality === 'slow') {
      player.configure({ streaming: { bufferingGoal: 5, rebufferingGoal: 1 } });
    } else if (networkQuality === 'online') {
      player.configure({ streaming: { bufferingGoal: 10, rebufferingGoal: 2 } });
    }
  }
}

function startNetworkMonitoring() {
  updateNetworkIndicator();
  if (navigator.connection) {
    navigator.connection.addEventListener('change', updateNetworkIndicator);
  }
  window.addEventListener('online', updateNetworkIndicator);
  window.addEventListener('offline', updateNetworkIndicator);
  connectionMonitor = setInterval(updateNetworkIndicator, 10000);
}

function stopNetworkMonitoring() {
  if (navigator.connection) {
    navigator.connection.removeEventListener('change', updateNetworkIndicator);
  }
  window.removeEventListener('online', updateNetworkIndicator);
  window.removeEventListener('offline', updateNetworkIndicator);
  if (connectionMonitor) clearInterval(connectionMonitor);
}

// ── Time and date update ────────────────────────────────────────
function updateClock() {
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'short', day: '2-digit', month: 'short' });
  const timeEl = document.getElementById('currentTime');
  const dateEl = document.getElementById('currentDate');
  if (timeEl) timeEl.textContent = timeStr;
  if (dateEl) dateEl.textContent = dateStr;
}
setInterval(updateClock, 1000);
updateClock();

// ── Weather (optional) ─────────────────────────────────────────
async function fetchWeather(lat, lon) {
  // Uncomment and add your API key from openweathermap.org if desired
  // const apiKey = 'YOUR_API_KEY';
  // const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=metric&appid=${apiKey}`;
  // try {
  //   const res = await fetch(url);
  //   const data = await res.json();
  //   const temp = Math.round(data.main.temp);
  //   const desc = data.weather[0].description;
  //   document.getElementById('weatherTemp').textContent = `${temp}°C`;
  //   document.getElementById('weatherDesc').textContent = desc;
  // } catch (e) {
  //   console.warn('Weather fetch failed', e);
  // }
  const weatherInfo = document.getElementById('weatherInfo');
  if (weatherInfo) weatherInfo.style.display = 'none';
}

// ── Shaka player (with AV sync tweaks) ──────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) {
    console.error('[IPTV] Shaka not supported');
    return;
  }

  player = new shaka.Player(video);
  player.configure({
    streaming: {
      bufferingGoal: 10,
      rebufferingGoal: 2,
      bufferBehind: 20,
      stallEnabled: true,
      stallThreshold: 1,
      autoCorrectDrift: true,          // AV sync improvement
      gapDetectionThreshold: 0.5,      // helps with sync
      durationBackoff: 1,
      retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2 },
    },
    abr: { enabled: true },
  });

  player.addEventListener('error', e => {
    console.error('[Shaka]', e.detail);
    setStatus('Stream error', 'error');
    finishLoadBar();
  });
  
  player.addEventListener('playing', () => {
    updateChannelTech();
  });
}

async function doPlay(url) {
  if (!player) await initShaka();
  try {
    await player.unload();
    video.removeAttribute('src');
    await player.load(url);
    await video.play().catch(() => {});
    updateChannelTech();
    startProgressSimulation(currentProgramDuration);
  } catch (err) {
    console.error('[Shaka] load error', err);
    setStatus('Play error', 'error');
    finishLoadBar();
  }
}

// ── Aspect ratio ─────────────────────────────────────────────────
function resetAspectRatio() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  video.style.objectFit = '';
  arIdx = 0;
  arBtn.textContent = '⛶ Native';
  arBtn.className = 'ar-btn';
}

function cycleAR() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  video.style.objectFit = '';
  arIdx = (arIdx + 1) % AR_MODES.length;
  const m = AR_MODES[arIdx];
  if (m.cls) video.classList.add(m.cls);
  arBtn.textContent = '⛶ ' + m.label;
  arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  showToast('Aspect: ' + m.label);
}

arBtn.addEventListener('click', cycleAR);
function setARFocus(on) { arBtn.classList.toggle('focused', on); }

// ── Preview ──────────────────────────────────────────────────────
function cancelPreview() { clearTimeout(previewTimer); previewTimer = null; }

function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(() => {
    previewTimer = null;
    startPreview(selectedIndex);
  }, PREVIEW_DELAY);
}

async function startPreview(idx) {
  if (!filtered.length) return;
  const ch = filtered[idx];
  if (!ch) return;

  resetAspectRatio();
  nowPlayingEl.textContent = ch.name;
  updateOverlayInfo(ch.name, idx);
  videoOverlay.classList.add('hidden');
  hasPlayed = true;
  setStatus('Buffering…', 'loading');
  startLoadBar();

  await doPlay(ch.url);
}

function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ─────────────────────────────────────────────────
video.addEventListener('playing', () => {
  setStatus('Playing', 'playing');
  finishLoadBar();
});
video.addEventListener('pause', () => setStatus('Paused', 'paused'));
video.addEventListener('waiting', () => {
  setStatus('Buffering…', 'loading');
  startLoadBar();
});
video.addEventListener('stalled', () => setStatus('Buffering…', 'loading'));
video.addEventListener('error', () => {
  setStatus('Error', 'error');
  finishLoadBar();
});

// ── Fullscreen with overlays toggle ─────────────────────────────
function showFsHint() {
  clearTimeout(fsHintTimer);
  fsHint.classList.add('visible');
  fsHintTimer = setTimeout(() => fsHint.classList.remove('visible'), 3000);
}

function enterFS() {
  const fn = videoWrap.requestFullscreen || videoWrap.webkitRequestFullscreen || videoWrap.mozRequestFullScreen;
  if (fn) {
    try { fn.call(videoWrap); } catch (e) {}
  }
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
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (fn) {
    try { fn.call(document); } catch (e) {}
  }
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
  fsHint.classList.remove('visible');

  if (preFullscreenArMode !== null) {
    video.style.objectFit = '';
    const restoreMode = preFullscreenArMode;
    preFullscreenArMode = null;
    const m = AR_MODES[restoreMode];
    video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
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

function toggleFS() { isFullscreen ? exitFS() : enterFS(); }

document.addEventListener('fullscreenchange', () => {
  isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
    if (preFullscreenArMode !== null) {
      video.style.objectFit = '';
      const restoreMode = preFullscreenArMode;
      preFullscreenArMode = null;
      const m = AR_MODES[restoreMode];
      video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
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
});
document.addEventListener('webkitfullscreenchange', () => {
  isFullscreen = !!(document.webkitFullscreenElement || document.fullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
    if (preFullscreenArMode !== null) {
      video.style.objectFit = '';
      const restoreMode = preFullscreenArMode;
      preFullscreenArMode = null;
      const m = AR_MODES[restoreMode];
      video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
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
});
video.addEventListener('dblclick', toggleFS);

// ── Toggle overlays with Info button ────────────────────────────
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

// ── Channel dialer with commit ───────────────────────────────────
function commitChannelNumber() {
  const num = parseInt(dialBuffer, 10);
  dialBuffer = '';
  chDialer.classList.remove('visible');
  if (!filtered.length || isNaN(num)) return;
  const idx = Math.max(0, Math.min(filtered.length - 1, num - 1));
  cancelPreview();
  selectedIndex = idx;
  VS.scrollToIndexCentered(idx);
  playSelected();
  showToast(`CH ${idx + 1} · ${filtered[idx].name}`);
}

function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d;
  chDialerNum.textContent = dialBuffer;
  chDialer.classList.add('visible');
  dialTimer = setTimeout(() => {
    commitChannelNumber();
  }, 800);
}

// ── Navigation ───────────────────────────────────────────────────
function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview();
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

// ── Playlist management (M3U) ────────────────────────────────────
function loadCustomPlaylists() {
  try {
    const stored = lsGet(CUSTOM_PLAYLISTS_KEY);
    if (stored) customPlaylists = JSON.parse(stored);
    else customPlaylists = [];
  } catch (e) {
    customPlaylists = [];
  }
}

function saveCustomPlaylists() {
  lsSet(CUSTOM_PLAYLISTS_KEY, JSON.stringify(customPlaylists));
}

function addCustomPlaylist(name, url) {
  if (!name.trim() || !url.trim()) return false;
  const exists = customPlaylists.some(p => p.url.toLowerCase() === url.toLowerCase());
  if (exists) return false;
  customPlaylists.push({ name: name.trim(), url: url.trim() });
  saveCustomPlaylists();
  rebuildAllPlaylists();
  return true;
}

function rebuildAllPlaylists() {
  allPlaylists = [...DEFAULT_PLAYLISTS, ...customPlaylists];
  if (plIdx >= allPlaylists.length) plIdx = 0;
  rebuildTabs();
  if (plIdx < allPlaylists.length) {
    loadPlaylist();
  } else {
    plIdx = 0;
    loadPlaylist();
  }
}

function rebuildTabs() {
  tabBar.innerHTML = '';

  // M3U playlists
  for (let i = 0; i < allPlaylists.length; i++) {
    const playlist = allPlaylists[i];
    const btn = document.createElement('button');
    btn.className = 'tab';
    if (!xtreamMode && i === plIdx) btn.classList.add('active');
    btn.textContent = playlist.name;
    btn.addEventListener('click', (function(idx) {
      return function() { switchTab(idx); };
    })(i));
    tabBar.appendChild(btn);
  }

  // Xtream tab
  const xtreamBtn = document.createElement('button');
  xtreamBtn.className = 'tab xtream-tab';
  if (xtreamMode && plIdx === allPlaylists.length) xtreamBtn.classList.add('active');
  xtreamBtn.textContent = 'Xtream';
  xtreamBtn.addEventListener('click', () => switchTab(allPlaylists.length));
  tabBar.appendChild(xtreamBtn);
  xtreamTabIndex = allPlaylists.length;

  // Favourites tab
  const favBtn = document.createElement('button');
  favBtn.className = 'tab fav-tab';
  if (!xtreamMode && plIdx === allPlaylists.length + 1) favBtn.classList.add('active');
  favBtn.textContent = '★ Favs';
  favBtn.addEventListener('click', () => switchTab(allPlaylists.length + 1));
  tabBar.appendChild(favBtn);
}

function switchTab(idx) {
  const totalM3U = allPlaylists.length;

  // M3U playlist tab
  if (idx < totalM3U) {
    if (xtreamMode) {
      xtreamMode = false;
      lastM3uIndex = idx;
      plIdx = idx;
      rebuildTabs();
      loadPlaylist();
    } else {
      plIdx = idx;
      rebuildTabs();
      loadPlaylist();
    }
    saveMode();
  }
  // Xtream tab
  else if (idx === totalM3U) {
    if (!xtreamMode) {
      if (xtreamClient && xtreamClient.logged_in) {
        xtreamMode = true;
        plIdx = totalM3U;
        rebuildTabs();
        loadXtreamChannels();
      } else {
        openXtreamLogin();
      }
    }
  }
  // Favourites tab
  else if (idx === totalM3U + 1) {
    showFavourites();
    plIdx = idx;
    rebuildTabs();
  }
}

// ── Xtream Functions ─────────────────────────────────────────────
function openXtreamLogin() {
  xtreamServerUrl.value = '';
  xtreamUsername.value = '';
  xtreamPassword.value = '';
  xtreamLoginStatus.textContent = '';
  xtreamAccountInfo.textContent = '';
  xtreamModal.style.display = 'flex';
}

function closeXtreamLogin() {
  xtreamModal.style.display = 'none';
}

function storeCredentials(server, user, pass) {
  localStorage.setItem('xtream:server', server);
  localStorage.setItem('xtream:username', user);
  localStorage.setItem('xtream:password', pass);
}

function clearXtreamCredentials() {
  localStorage.removeItem('xtream:server');
  localStorage.removeItem('xtream:username');
  localStorage.removeItem('xtream:password');
}

async function xtreamLogin() {
  const serverUrl = xtreamServerUrl.value.trim();
  const username = xtreamUsername.value.trim();
  const password = xtreamPassword.value.trim();

  if (!serverUrl || !username || !password) {
    xtreamLoginStatus.textContent = 'Please fill in all fields';
    xtreamLoginStatus.style.color = '#ff4444';
    return;
  }

  xtreamLoginStatus.textContent = 'Connecting...';
  xtreamLoginStatus.style.color = '#e5b400';

  try {
    const client = new XtreamClient({ serverUrl, username, password, timeout: 15000 });
    const userInfo = await client.getUserInfo(false);
    if (userInfo && userInfo.auth === 1) {
      xtreamClient = client;
      xtreamMode = true;
      storeCredentials(serverUrl, username, password);

      const expDate = new Date(parseInt(userInfo.exp_date, 10) * 1000);
      const daysLeft = Math.ceil((expDate - new Date()) / (1000 * 60 * 60 * 24));
      xtreamAccountInfo.innerHTML = `✅ Logged in as ${username}<br>Expires: ${expDate.toLocaleDateString()} (${daysLeft} days left)<br>Max connections: ${userInfo.max_connections}`;
      xtreamLoginStatus.textContent = 'Loading channels...';
      xtreamLoginStatus.style.color = '#e5b400';

      plIdx = allPlaylists.length; // Xtream tab index
      rebuildTabs();
      await loadXtreamChannels();

      closeXtreamLogin();
      showToast(`Welcome ${username}!`);
      saveMode();
    } else {
      throw new Error('Invalid credentials');
    }
  } catch (error) {
    console.error('[Xtream] Login failed:', error);
    xtreamLoginStatus.textContent = `Login failed: ${error.message}`;
    xtreamLoginStatus.style.color = '#ff4444';
  }
}

async function loadXtreamChannels() {
  if (!xtreamClient) return;
  setStatus('Loading Xtream channels…', 'loading');
  startLoadBar();
  try {
    const [categories, channels] = await Promise.all([
      xtreamClient.getLiveCategories(true),
      xtreamClient.getLiveStreams(null, true)
    ]);
    xtreamCategories = categories;
    xtreamChannels = channels;

    const convertedChannels = channels.map(ch => ({
      name: ch.name,
      group: ch.category_name || 'Uncategorized',
      logo: ch.stream_icon || '',
      url: xtreamClient.getLiveStreamUrl(ch.stream_id),
      streamId: ch.stream_id,
      epgChannelId: ch.epg_channel_id,
      streamType: 'live'
    }));

    channels = convertedChannels;
    allChannels = channels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    setStatus(`Xtream: ${channels.length} channels`, 'playing');
    finishLoadBar();
    setTimeout(() => updateXtreamEpg(), 1000);
  } catch (error) {
    console.error('[Xtream] Failed to load channels:', error);
    setStatus('Failed to load channels', 'error');
    finishLoadBar();
  }
}

async function loadSavedXtream() {
  const savedServer = localStorage.getItem('xtream:server');
  const savedUsername = localStorage.getItem('xtream:username');
  const savedPassword = localStorage.getItem('xtream:password');
  if (savedServer && savedUsername && savedPassword) {
    try {
      const client = new XtreamClient({ serverUrl: savedServer, username: savedUsername, password: savedPassword, timeout: 10000 });
      const userInfo = await client.getUserInfo(false);
      if (userInfo && userInfo.auth === 1) {
        xtreamClient = client;
        xtreamMode = true;
        plIdx = allPlaylists.length; // Xtream tab index
        rebuildTabs();
        await loadXtreamChannels();
        showToast(`Welcome back, ${savedUsername}`);
        saveMode();
        return true;
      }
    } catch (error) {
      console.warn('[Xtream] Auto-login failed:', error);
      clearXtreamCredentials();
    }
  }
  return false;
}

function switchToM3uMode() {
  xtreamMode = false;
  xtreamClient = null;
  xtreamCategories = [];
  xtreamChannels = [];
  clearXtreamCredentials();
  plIdx = lastM3uIndex;
  rebuildTabs();
  loadPlaylist();
  showToast('Switched to M3U mode');
  saveMode();
}

async function updateXtreamEpg() {
  if (!xtreamMode || !xtreamClient || !filtered[selectedIndex]) return;
  const currentChannel = filtered[selectedIndex];
  if (!currentChannel.streamId) return;

  try {
    const epg = await xtreamClient.getShortEpg(currentChannel.streamId, 3, true);
    if (epg && epg.length > 0) {
      const current = epg[0];
      const next = epg[1];
      if (overlayProgramTitle) overlayProgramTitle.textContent = current.title || 'No program info';
      if (overlayProgramDesc) overlayProgramDesc.textContent = current.description || '';
      if (nextProgramInfo && next) {
        const nextTime = new Date(next.start_timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        nextProgramInfo.textContent = `Next: ${next.title} at ${nextTime}`;
      }
      if (progressBar && current.start_timestamp && current.end_timestamp) {
        const now = Date.now() / 1000;
        const start = current.start_timestamp;
        const end = current.end_timestamp;
        const total = end - start;
        const elapsed = now - start;
        const percent = Math.min(100, Math.max(0, (elapsed / total) * 100));
        progressBar.style.width = `${percent}%`;
      }
    }
  } catch (error) {
    console.warn('[Xtream] EPG fetch failed:', error);
  }
}

// Override startPreview to fetch EPG on channel change
const originalStartPreview = startPreview;
startPreview = async function(idx) {
  await originalStartPreview(idx);
  if (xtreamMode) setTimeout(() => updateXtreamEpg(), 1000);
};

// Periodic EPG update
let epgInterval = null;
function startEpgUpdater() {
  if (epgInterval) clearInterval(epgInterval);
  epgInterval = setInterval(() => {
    if (xtreamMode && !video.paused) updateXtreamEpg();
  }, 30000);
}

function stopEpgUpdater() {
  if (epgInterval) {
    clearInterval(epgInterval);
    epgInterval = null;
  }
}

// ── Mode persistence ────────────────────────────────────────────
function saveMode() {
  if (xtreamMode) {
    lsSet('iptv:mode', 'xtream');
  } else {
    lsSet('iptv:mode', 'm3u');
    lsSet('iptv:lastM3uIndex', String(plIdx));
  }
}

function loadMode() {
  const mode = lsGet('iptv:mode');
  if (mode === 'xtream') {
    if (!loadSavedXtream()) {
      // fallback to M3U
      xtreamMode = false;
      const savedIdx = lsGet('iptv:lastM3uIndex');
      plIdx = savedIdx ? parseInt(savedIdx, 10) : 0;
      if (isNaN(plIdx) || plIdx >= allPlaylists.length) plIdx = 0;
      rebuildTabs();
      loadPlaylist();
    }
  } else {
    xtreamMode = false;
    const savedIdx = lsGet('iptv:lastM3uIndex');
    plIdx = savedIdx ? parseInt(savedIdx, 10) : 0;
    if (isNaN(plIdx) || plIdx >= allPlaylists.length) plIdx = 0;
    rebuildTabs();
    loadPlaylist();
  }
}

// ── Remote key registration ──────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'ChannelUp', 'ChannelDown', 'Back', 'Info',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ].forEach(k => {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  } catch (e) {}
}

// ── Keyboard / remote handler ────────────────────────────────────
window.addEventListener('keydown', e => {
  const k = e.key, c = e.keyCode;

  if ((c >= 48 && c <= 57) || (c >= 96 && c <= 105)) {
    if (focusArea !== 'search') {
      handleDigit(String(c >= 96 ? c - 96 : c - 48));
      e.preventDefault();
      return;
    }
  }

  if (chDialer.classList.contains('visible')) {
    if (k === 'Enter' || c === 13) {
      clearTimeout(dialTimer);
      commitChannelNumber();
      e.preventDefault();
      return;
    }
    if (k === 'Back' || k === 'Escape' || c === 27 || c === 10009) {
      clearTimeout(dialTimer);
      dialBuffer = '';
      chDialer.classList.remove('visible');
      e.preventDefault();
      return;
    }
  }

  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'ar') { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search') { clearSearch(); e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e2) {}
    e.preventDefault();
    return;
  }

  if (k === 'Info' || c === 457) {
    toggleOverlays();
    e.preventDefault();
    return;
  }

  if (focusArea === 'ar') {
    if (k === 'Enter' || c === 13) { cycleAR(); e.preventDefault(); return; }
    if (k === 'ArrowLeft' || c === 37 || k === 'ArrowDown' || c === 40) { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowRight' || c === 39 || k === 'ArrowUp' || c === 38) { cycleAR(); e.preventDefault(); return; }
    e.preventDefault();
    return;
  }

  if (focusArea === 'search') {
    if (k === 'Enter' || c === 13) { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || c === 40 || c === 38) { commitSearch(); e.preventDefault(); return; }
    return;
  }

  if (k === 'ArrowUp' || c === 38) { isFullscreen ? showFsHint() : moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || c === 40) { isFullscreen ? showFsHint() : moveSel(1); e.preventDefault(); return; }

  if (k === 'ArrowLeft' || c === 37) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    setFocus('list');
    e.preventDefault();
    return;
  }
  if (k === 'ArrowRight' || c === 39) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    setFocus('ar');
    e.preventDefault();
    return;
  }

  if (k === 'Enter' || c === 13) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(() => { if (hasPlayed) enterFS(); }, 600);
    }
    e.preventDefault();
    return;
  }

  if (k === 'PageUp') { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown') { moveSel(10); e.preventDefault(); return; }

  if (k === 'MediaPlayPause' || c === 10252) {
    if (video.paused) video.play().catch(()=>{}); else video.pause();
    e.preventDefault();
    return;
  }
  if (k === 'MediaPlay' || c === 415) { video.play().catch(()=>{}); e.preventDefault(); return; }
  if (k === 'MediaPause' || c === 19) { video.pause(); e.preventDefault(); return; }

  if (k === 'MediaStop' || c === 413) {
    cancelPreview(); if (player) player.unload();
    video.pause(); video.removeAttribute('src');
    setStatus('Stopped', 'idle'); finishLoadBar();
    e.preventDefault();
    return;
  }

  if (k === 'MediaFastForward'|| c === 417 || k === 'ChannelUp'  || c === 427) { moveSel(1); e.preventDefault(); return; }
  if (k === 'MediaRewind'     || c === 412 || k === 'ChannelDown'|| c === 428) { moveSel(-1); e.preventDefault(); return; }

  if (k === 'ColorF0Red'    || c === 403) { switchTab((plIdx + 1) % (allPlaylists.length + 2)); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || c === 404) { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || c === 405) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || c === 406) { if (hasPlayed) toggleFS(); e.preventDefault(); }
});

document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') {
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (ex) {}
  }
});

// ── Modal handlers ─────────────────────────────────────────────
function openAddPlaylistModal() {
  playlistName.value = '';
  playlistUrl.value = '';
  playlistModal.style.display = 'flex';
}

function closeAddPlaylistModal() {
  playlistModal.style.display = 'none';
}

function handleSavePlaylist() {
  const name = playlistName.value.trim();
  const url = playlistUrl.value.trim();
  if (!name || !url) {
    showToast('Please enter both name and URL');
    return;
  }
  if (addCustomPlaylist(name, url)) {
    showToast(`Playlist "${name}" added`);
    closeAddPlaylistModal();
  } else {
    showToast('Playlist already exists or invalid URL');
  }
}

// ── Boot ─────────────────────────────────────────────────────────
(async function init() {
  registerKeys();

  loadCustomPlaylists();
  allPlaylists = [...DEFAULT_PLAYLISTS, ...customPlaylists];

  VS.init(channelListEl);
  await initShaka();

  startNetworkMonitoring();

  loadMode();   // sets xtreamMode, plIdx, loads either Xtream or M3U

  // Initialize overlays (visible by default)
  if (overlayTop && overlayBottom) {
    overlayTop.classList.add('info-visible');
    overlayBottom.classList.add('info-visible');
    overlaysVisible = true;
  }

  // Modal event listeners
  if (addPlaylistBtn) addPlaylistBtn.addEventListener('click', openAddPlaylistModal);
  if (savePlaylistBtn) savePlaylistBtn.addEventListener('click', handleSavePlaylist);
  if (cancelPlaylistBtn) cancelPlaylistBtn.addEventListener('click', closeAddPlaylistModal);
  if (playlistModal) playlistModal.addEventListener('click', (e) => {
    if (e.target === playlistModal) closeAddPlaylistModal();
  });

  // Xtream modal listeners
  if (xtreamLoginBtn) xtreamLoginBtn.addEventListener('click', xtreamLogin);
  if (xtreamCancelBtn) xtreamCancelBtn.addEventListener('click', closeXtreamLogin);
  if (xtreamModal) xtreamModal.addEventListener('click', (e) => {
    if (e.target === xtreamModal) closeXtreamLogin();
  });

  // EPG updater
  video.addEventListener('playing', startEpgUpdater);
  video.addEventListener('pause', stopEpgUpdater);
  video.addEventListener('ended', stopEpgUpdater);

  // Optional weather
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(pos => {
      fetchWeather(pos.coords.latitude, pos.coords.longitude);
    }, () => {
      fetchWeather(51.5074, -0.1278);
    });
  } else {
    fetchWeather(51.5074, -0.1278);
  }
})();
