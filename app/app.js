// ================================================================
// IPTV Pro — app.js v13.0 | Samsung Tizen OS9 TV
// JIO removed. All playlist fetches direct (no proxy).
// ================================================================

const FAV_KEY = 'iptv:favs';
const PLAYLIST_KEY = 'iptv:lastPl';
const PREVIEW_DELAY = 700;

const PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];
const FAV_IDX = 2;  // Favs is the 3rd tab

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

// ── State ───────────────────────────────────────────────────────
let channels      = [];
let allChannels   = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list';
let plIdx         = 0;
let isFullscreen  = false;
let hasPlayed     = false;
let player        = null;
let arIdx         = 0;
let preFullscreenArMode = null;   // store AR mode before fullscreen
let fsHintTimer   = null;
let loadBarTimer  = null;
let previewTimer  = null;
let dialBuffer    = '';
let dialTimer     = null;
let toastEl       = null;
let toastTm       = null;
let favSet        = new Set();

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
  if (plIdx === FAV_IDX) showFavourites();
  VS.refresh();
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
  statusBadge.className   = 'status-badge ' + (c || 'idle');
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
    // Remove anything inside parentheses (including the parentheses)
    .replace(/\s*\([^)]*\)/g, '')
    // Also strip brackets
    .replace(/\s*\[[^\]]*\]/g, '')
    // Remove common tags like 4K, UHD, etc.
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi, '')
    .replace(/[\|\-–—]+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function parseM3U(text) {
  const lines = String(text || '').split(/\r?\n/);
  const out   = [];
  let meta    = null;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith('#EXTINF')) {
      const namePart = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const gm = line.match(/group-title="([^"]+)"/i);
      const lm = line.match(/tvg-logo="([^"]+)"/i);
      meta = {
        name:  cleanName(namePart) || namePart,
        group: gm ? gm[1] : 'Other',
        logo:  lm ? lm[1] : '',
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

// ── Virtual scroll ──────────────────────────────────────────────
const VS = {
  ITEM_H: 88, OVERSCAN: 6,
  c: null, inner: null, vh: 0, st: 0, total: 0,
  rs: -1, re: -1, nodes: [], raf: null,

  init(el) {
    this.c = el;
    this.inner = document.createElement('div');
    this.inner.id = 'vsInner';
    this.c.appendChild(this.inner);
    this.vh = this.c.clientHeight || 700;
    this.c.addEventListener('scroll', () => {
      if (this.raf) return;
      this.raf = requestAnimationFrame(() => {
        this.raf = null; this.st = this.c.scrollTop; this.paint();
      });
    }, { passive: true });
  },

  setData(n) {
    this.total = n; this.rs = -1; this.re = -1;
    this.inner.textContent = ''; this.nodes = [];
    this.inner.style.cssText = `position:relative;width:100%;height:${n * this.ITEM_H}px;`;
    this.st = this.c.scrollTop; this.vh = this.c.clientHeight || 700;
    this.paint();
  },

  scrollToIndex(idx) {
    const top = idx * this.ITEM_H, bot = top + this.ITEM_H, st = this.c.scrollTop;
    if (top < st) this.c.scrollTop = top;
    else if (bot > st + this.vh) this.c.scrollTop = bot - this.vh;
    this.st = this.c.scrollTop; this.paint();
  },

  scrollToIndexCentered(idx) {
    const center = idx * this.ITEM_H - (this.vh / 2) + (this.ITEM_H / 2);
    this.c.scrollTop = Math.max(0, center);
    this.st = this.c.scrollTop; this.rs = -1; this.re = -1; this.paint();
  },

  paint() {
    if (!this.total) return;
    const H = this.ITEM_H, os = this.OVERSCAN;
    const start = Math.max(0, Math.floor(this.st / H) - os);
    const end   = Math.min(this.total - 1, Math.ceil((this.st + this.vh) / H) + os);
    if (start === this.rs && end === this.re) return;
    this.rs = start; this.re = end;

    this.nodes = this.nodes.filter(nd => {
      if (nd._i < start || nd._i > end) { this.inner.removeChild(nd); return false; }
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
      if (on !== nd._on) { nd._on = on; nd.classList.toggle('active', on); }
    }
  },

  build(i) {
    const ch = filtered[i];
    const li = document.createElement('li');
    li._i = i; li._on = false;
    li.style.cssText = `position:absolute;top:${i * this.ITEM_H}px;left:0;right:0;height:${this.ITEM_H}px;`;

    const logo = ch.logo
      ? `<div class="ch-logo"><img src="${esc(ch.logo)}" onerror="this.parentNode.innerHTML='&lt;div class=&quot;ch-logo ch-logo-fb&quot;&gt;${esc(initials(ch.name))}&lt;/div&gt;'"></div>`
      : `<div class="ch-logo ch-logo-fb">${esc(initials(ch.name))}</div>`;

    li.innerHTML = `
      ${logo}
      <div class="ch-info"><div class="ch-name">${esc(ch.name)}</div></div>
      ${isFav(ch) ? '<div class="ch-fav">★</div>' : ''}
      <div class="ch-num">${i + 1}</div>
    `;

    if (i === selectedIndex) { li._on = true; li.classList.add('active'); }
    li.addEventListener('click', () => { selectedIndex = i; VS.refresh(); schedulePreview(); });
    return li;
  },

  refresh() { this.rs = -1; this.re = -1; this.paint(); }
};

// ── Render list ─────────────────────────────────────────────────
function renderList() {
  countBadge.textContent = String(filtered.length);
  if (!filtered.length) {
    VS.setData(0);
    const li = document.createElement('li');
    li.style.cssText = 'position:absolute;top:0;left:0;right:0;padding:24px 16px;';
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
  if (filtered.length === 1) { selectedIndex = 0; VS.refresh(); schedulePreview(); }
}
function clearSearch() { searchInput.value = ''; applySearch(); setFocus('list'); }
searchInput.addEventListener('input', applySearch);

// ── XHR fetch (avoids fetch() CORS quirks on Tizen) ─────────────
function xhrFetch(url, ms, cb) {
  let done = false;
  const xhr = new XMLHttpRequest();

  const tid = setTimeout(() => {
    if (done) return;
    done = true; xhr.abort();
    cb(new Error('Timeout ' + ms + 'ms'), null);
  }, ms);

  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4 || done) return;
    done = true; clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };

  xhr.onerror = function () {
    if (done) return;
    done = true; clearTimeout(tid);
    cb(new Error('Network error'), null);
  };

  xhr.open('GET', url, true);
  xhr.send();
}

// ── jsDelivr mirror for raw.githubusercontent.com ───────────────
function mirrorUrl(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    const p = u.pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    return `https://cdn.jsdelivr.net/gh/${p[0]}/${p[1]}@${p[2]}/${p.slice(3).join('/')}`;
  } catch (e) { return null; }
}

// ── Playlist loading ─────────────────────────────────────────────
// Strategy: direct fetch → CDN mirror fallback
function loadPlaylist(urlOv) {
  cancelPreview();

  if (plIdx === FAV_IDX && !urlOv) {
    showFavourites();
    return;
  }

  const rawUrl = urlOv || PLAYLISTS[plIdx].url;
  const cacheKey = 'plCache:' + rawUrl;
  const cacheTimeKey = 'plCacheTime:' + rawUrl;

  // Serve from cache if < 10 min old
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

// ── Shaka player ─────────────────────────────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if (!shaka.Player.isBrowserSupported()) { console.error('[IPTV] Shaka not supported'); return; }

  player = new shaka.Player(video);
  player.configure({
    streaming: {
      bufferingGoal: 10, rebufferingGoal: 2, bufferBehind: 20,
      stallEnabled: true, stallThreshold: 1,
      retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2 },
    },
    abr: { enabled: true },
  });

  player.addEventListener('error', e => {
    console.error('[Shaka]', e.detail);
    setStatus('Stream error', 'error');
    finishLoadBar();
  });
}

async function doPlay(url) {
  if (!player) await initShaka();
  try {
    await player.unload();
    video.removeAttribute('src');
    await player.load(url);
    await video.play().catch(() => {});
  } catch (err) {
    console.error('[Shaka] load error', err);
    setStatus('Play error', 'error');
    finishLoadBar();
  }
}

// ── Aspect ratio ─────────────────────────────────────────────────
function resetAspectRatio() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  arIdx = 0; arBtn.textContent = '⛶ Native'; arBtn.className = 'ar-btn';
}

function cycleAR() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
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
  previewTimer = setTimeout(() => { previewTimer = null; startPreview(selectedIndex); }, PREVIEW_DELAY);
}

async function startPreview(idx) {
  if (!filtered.length) return;
  const ch = filtered[idx];
  if (!ch) return;

  resetAspectRatio();
  nowPlayingEl.textContent = ch.name;
  npChNumEl.textContent    = 'CH ' + (idx + 1);
  videoOverlay.classList.add('hidden');
  hasPlayed = true;
  setStatus('Buffering…', 'loading');
  startLoadBar();

  await doPlay(ch.url);
}

function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ─────────────────────────────────────────────────
video.addEventListener('playing', () => { setStatus('Playing', 'playing'); finishLoadBar(); });
video.addEventListener('pause',   () => setStatus('Paused', 'paused'));
video.addEventListener('waiting', () => { setStatus('Buffering…', 'loading'); startLoadBar(); });
video.addEventListener('stalled', () => setStatus('Buffering…', 'loading'));
video.addEventListener('error',   () => { setStatus('Error', 'error'); finishLoadBar(); });

// ── Fullscreen ───────────────────────────────────────────────────
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

  // Store current AR mode before forcing fill
  preFullscreenArMode = arIdx;
  // Switch to Fill mode (index 1) if not already
  if (arIdx !== 1) {
    video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
    video.classList.add('ar-fill');
    arIdx = 1;
    arBtn.textContent = '⛶ ' + AR_MODES[1].label;
    arBtn.className = 'ar-btn ar-fill';
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

  // Restore previous AR mode if it was stored
  if (preFullscreenArMode !== null) {
    const restoreMode = preFullscreenArMode;
    preFullscreenArMode = null;
    video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
    const m = AR_MODES[restoreMode];
    if (m.cls) video.classList.add(m.cls);
    arIdx = restoreMode;
    arBtn.textContent = '⛶ ' + m.label;
    arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
  }
}

function toggleFS() { isFullscreen ? exitFS() : enterFS(); }

document.addEventListener('fullscreenchange', () => {
  isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
    // If fullscreen exited without exitFS (e.g. via ESC), also restore AR mode
    if (preFullscreenArMode !== null) {
      const restoreMode = preFullscreenArMode;
      preFullscreenArMode = null;
      video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
      const m = AR_MODES[restoreMode];
      if (m.cls) video.classList.add(m.cls);
      arIdx = restoreMode;
      arBtn.textContent = '⛶ ' + m.label;
      arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
    }
  }
});
document.addEventListener('webkitfullscreenchange', () => {
  isFullscreen = !!(document.webkitFullscreenElement || document.fullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
    if (preFullscreenArMode !== null) {
      const restoreMode = preFullscreenArMode;
      preFullscreenArMode = null;
      video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
      const m = AR_MODES[restoreMode];
      if (m.cls) video.classList.add(m.cls);
      arIdx = restoreMode;
      arBtn.textContent = '⛶ ' + m.label;
      arBtn.className = 'ar-btn' + (m.cls ? ' ' + m.cls : '');
    }
  }
});
video.addEventListener('dblclick', toggleFS);

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
    searchWrap.classList.add('active'); searchInput.focus();
  } else {
    searchWrap.classList.remove('active');
    if (document.activeElement === searchInput) searchInput.blur();
  }
}

function switchTab(idx) {
  plIdx = idx;
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  loadPlaylist();
}

tabBar.querySelectorAll('.tab').forEach((b, i) => b.addEventListener('click', () => switchTab(i)));

// ── Channel dialer ───────────────────────────────────────────────
function handleDigit(d) {
  clearTimeout(dialTimer);
  dialBuffer += d;
  chDialerNum.textContent = dialBuffer;
  chDialer.classList.add('visible');

  dialTimer = setTimeout(() => {
    const num = parseInt(dialBuffer, 10);
    dialBuffer = '';
    chDialer.classList.remove('visible');
    if (!filtered.length || isNaN(num)) return;
    const idx = Math.max(0, Math.min(filtered.length - 1, num - 1));
    cancelPreview(); selectedIndex = idx;
    VS.scrollToIndexCentered(idx); playSelected();
    showToast(`CH ${idx + 1} · ${filtered[idx].name}`);
  }, 1500);
}

// ── Remote key registration ──────────────────────────────────────
function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay','MediaPause','MediaPlayPause','MediaStop',
        'MediaFastForward','MediaRewind',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
        'ChannelUp','ChannelDown','Back',
        '0','1','2','3','4','5','6','7','8','9'
      ].forEach(k => { try { tizen.tvinputdevice.registerKey(k); } catch (e) {} });
    }
  } catch (e) {}
}

// ── Keyboard / remote ────────────────────────────────────────────
window.addEventListener('keydown', e => {
  const k = e.key, c = e.keyCode;

  if ((c >= 48 && c <= 57) || (c >= 96 && c <= 105)) {
    if (focusArea !== 'search') { handleDigit(String(c >= 96 ? c - 96 : c - 48)); e.preventDefault(); return; }
  }

  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
    if (isFullscreen)          { exitFS();       e.preventDefault(); return; }
    if (focusArea === 'ar')    { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search'){ clearSearch();  e.preventDefault(); return; }
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (e2) {}
    e.preventDefault(); return;
  }

  if (focusArea === 'ar') {
    if (k === 'Enter' || c === 13)                                                     { cycleAR();      e.preventDefault(); return; }
    if (k === 'ArrowLeft' || c === 37 || k === 'ArrowDown'  || c === 40)               { setFocus('list'); e.preventDefault(); return; }
    if (k === 'ArrowRight'|| c === 39 || k === 'ArrowUp'    || c === 38)               { cycleAR();      e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  if (focusArea === 'search') {
    if (k === 'Enter' || c === 13)                                                      { commitSearch(); e.preventDefault(); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || c === 40 || c === 38)                  { commitSearch(); e.preventDefault(); return; }
    return;
  }

  if (k === 'ArrowUp'   || c === 38) { isFullscreen ? showFsHint() : moveSel(-1); e.preventDefault(); return; }
  if (k === 'ArrowDown' || c === 40) { isFullscreen ? showFsHint() : moveSel(1);  e.preventDefault(); return; }

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
    if (focusArea === 'list') { playSelected(); setTimeout(() => { if (hasPlayed) enterFS(); }, 600); }
    e.preventDefault(); return;
  }

  if (k === 'PageUp')   { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown') { moveSel(10);  e.preventDefault(); return; }

  if (k === 'MediaPlayPause' || c === 10252) { if (video.paused) video.play().catch(()=>{}); else video.pause(); e.preventDefault(); return; }
  if (k === 'MediaPlay'  || c === 415)       { video.play().catch(()=>{}); e.preventDefault(); return; }
  if (k === 'MediaPause' || c === 19)        { video.pause(); e.preventDefault(); return; }

  if (k === 'MediaStop' || c === 413) {
    cancelPreview(); if (player) player.unload();
    video.pause(); video.removeAttribute('src');
    setStatus('Stopped', 'idle'); finishLoadBar();
    e.preventDefault(); return;
  }

  if (k === 'MediaFastForward'|| c === 417 || k === 'ChannelUp'  || c === 427) { moveSel(1);  e.preventDefault(); return; }
  if (k === 'MediaRewind'     || c === 412 || k === 'ChannelDown'|| c === 428) { moveSel(-1); e.preventDefault(); return; }

  if (k === 'ColorF0Red'    || c === 403) { switchTab((plIdx + 1) % (PLAYLISTS.length + 1)); e.preventDefault(); return; }
  if (k === 'ColorF1Green'  || c === 404) { if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if (k === 'ColorF2Yellow' || c === 405) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue'   || c === 406) { if (hasPlayed) toggleFS(); e.preventDefault(); }
});

document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') {
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch (ex) {}
  }
});

// ── Boot ─────────────────────────────────────────────────────────
(async function init() {
  registerKeys();

  try {
    const s = lsGet(PLAYLIST_KEY);
    if (s) plIdx = Math.min(parseInt(s, 10) || 0, PLAYLISTS.length);
  } catch (e) {}

  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === plIdx));

  VS.init(channelListEl);
  await initShaka();

  loadPlaylist();
})();
