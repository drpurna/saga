// ================================================================
// IPTV Pro — app.js v12.0 | Samsung Tizen OS9 TV
// Full replacement for broken app.js
// ================================================================

const PROXY = 'https://houser-af7j.onrender.com';
const FAV_KEY = 'iptv:favs';
const PLAYLIST_KEY = 'iptv:lastPl';
const JIO_TOKEN_KEY = 'jioToken';
const JIO_CH_KEY = 'jioChannels';
const JIO_CH_TTL = 30 * 60 * 1000;
const PREVIEW_DELAY = 700;
const PREFETCH_DELAY = 1000;
const FS_TOKEN_FILE = 'jiotoken.json';
const FS_CH_FILE = 'jiochannels.json';

const PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India', url: 'https://iptv-org.github.io/iptv/countries/in.m3u' },
];
const FAV_IDX = 2;
const JIO_IDX = 3;

const AR_MODES = [
  { cls: '', label: 'Native' },
  { cls: 'ar-fill', label: 'Fill' },
  { cls: 'ar-cover', label: 'Crop' },
  { cls: 'ar-wide', label: 'Wide' },
];

const DEVICE = {
  model: 'BRAVIA_ATV3',
  manufacturer: 'Sony',
  osVersion: '11',
  sdkVersion: '30',
  appVersion: '7.0.4',
  get uniqueId() {
    let id = lsGet('_did');
    if (!id) {
      id = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : ((r & 0x3) | 0x8);
        return v.toString(16);
      });
      lsSet('_did', id);
    }
    return id;
  }
};

const ANDROID_HEADERS = {
  'User-Agent': `JioTV/${DEVICE.appVersion} Android/${DEVICE.osVersion} ${DEVICE.manufacturer} ${DEVICE.model} okhttp/4.9.2`,
  'x-platform': 'androidtv',
  'x-app-version': DEVICE.appVersion,
  'x-device-type': 'tv',
  'x-os-version': DEVICE.osVersion,
  'x-unique-id': DEVICE.uniqueId,
  'x-subscriber-id': DEVICE.uniqueId,
  devicetype: 'tv',
  os: 'android',
  appname: 'RJIL_JioTV',
  Accept: 'application/json',
  'Content-Type': 'application/json',
};

const searchInput = document.getElementById('searchInput');
const searchWrap = document.getElementById('searchWrap');
const tabBar = document.getElementById('tabBar');
const channelListEl = document.getElementById('channelList');
const countBadge = document.getElementById('countBadge');
const nowPlayingEl = document.getElementById('nowPlaying');
const npChNumEl = document.getElementById('npChNum');
const statusBadge = document.getElementById('statusBadge');
const video = document.getElementById('video');
const videoWrap = document.getElementById('videoWrap');
const videoOverlay = document.getElementById('videoOverlay');
const fsHint = document.getElementById('fsHint');
const loadBar = document.getElementById('loadBar');
const chDialer = document.getElementById('chDialer');
const chDialerNum = document.getElementById('chDialerNum');
const arBtn = document.getElementById('arBtn');

let channels = [];
let allChannels = [];
let filtered = [];
let selectedIndex = 0;
let focusArea = 'list';
let plIdx = 0;
let isFullscreen = false;
let hasPlayed = false;
let player = null;
let arIdx = 0;
let fsHintTimer = null;
let loadBarTimer = null;
let previewTimer = null;
let prefetchTimer = null;
let dialBuffer = '';
let dialTimer = null;
let jioChannels = [];
let jioToken = null;
let prefetchCache = {};
let tokenRefreshTimer = null;
let toastEl = null;
let toastTm = null;
let favSet = new Set();

function lsSet(key, value) {
  try { localStorage.setItem(key, value); } catch (e) { console.warn('[ls] set failed', key, e.name); }
}
function lsGet(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}
function lsRemove(key) {
  try { localStorage.removeItem(key); } catch (e) {}
}

const FS = {
  _resolve(cb, errCb) {
    if (!window.tizen || !tizen.filesystem) {
      if (errCb) errCb('no-tizen');
      return;
    }
    tizen.filesystem.resolve('wgt-storage', cb, errCb || (() => {}), 'rw');
  },

  write(filename, data) {
    this._resolve(dir => {
      try {
        try { dir.deleteFile(filename); } catch (e) {}
        const file = dir.createFile(filename);
        file.openStream(
          'w',
          stream => {
            stream.write(typeof data === 'string' ? data : JSON.stringify(data));
            stream.close();
          },
          e => console.warn('[FS] write stream err', e),
          'UTF-8'
        );
      } catch (e) {
        console.warn('[FS] write err', e);
      }
    }, e => console.warn('[FS] resolve err', e));
  },

  read(filename, cb) {
    this._resolve(dir => {
      try {
        const file = dir.resolve(filename);
        file.openStream(
          'r',
          stream => {
            const raw = stream.read(file.fileSize);
            stream.close();
            try { cb(JSON.parse(raw)); }
            catch (e) { cb(null); }
          },
          () => cb(null),
          'UTF-8'
        );
      } catch (e) {
        cb(null);
      }
    }, () => cb(null));
  }
};

function flushCriticalStorage() {
  try {
    if (jioToken) {
      lsSet(JIO_TOKEN_KEY, JSON.stringify(jioToken));
      FS.write(FS_TOKEN_FILE, jioToken);
    }

    if (jioChannels.length) {
      const payload = { channels: jioChannels, time: Date.now() };
      lsSet(JIO_CH_KEY, JSON.stringify(jioChannels));
      lsSet(JIO_CH_KEY + ':time', String(payload.time));
      FS.write(FS_CH_FILE, payload);
    }

    saveFavs();
    const did = lsGet('_did');
    if (did) lsSet('_did', did);
  } catch (e) {
    console.warn('[flush]', e);
  }
}

(function loadFavs() {
  try {
    const r = lsGet(FAV_KEY);
    if (r) favSet = new Set(JSON.parse(r));
  } catch (e) {}
})();

function saveFavs() {
  lsSet(FAV_KEY, JSON.stringify([...favSet]));
}

function isFav(ch) {
  return favSet.has(ch.url || ch.channelId);
}

function toggleFav(ch) {
  const k = ch.url || ch.channelId;
  if (favSet.has(k)) favSet.delete(k);
  else favSet.add(k);
  saveFavs();
  if (plIdx === FAV_IDX) showFavourites();
  VS.refresh();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed');
}

function showFavourites() {
  filtered = allChannels.filter(c => favSet.has(c.url || c.channelId));
  selectedIndex = 0;
  renderList();
  setStatus(filtered.length ? `${filtered.length} favourites` : 'No favourites yet', 'idle');
}

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
  setTimeout(() => {
    loadBar.classList.remove('active');
    loadBar.style.width = '0%';
  }, 400);
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/\s*[\\[(][^\\])]*[\])]/g, '')
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
      out.push({
        name: meta.name,
        group: meta.group,
        logo: meta.logo,
        url: line,
      });
      meta = null;
    }
  }

  return out;
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function initials(n) {
  return String(n || '')
    .replace(/[^a-zA-Z0-9]/g, ' ')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase() || '?';
}

const VS = {
  ITEM_H: 88,
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
    const vh = this.vh;
    const st = this.c.scrollTop;

    if (top < st) this.c.scrollTop = top;
    else if (bot > st + vh) this.c.scrollTop = bot - vh;

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
    li.style.cssText = `position:absolute;top:${i * this.ITEM_H}px;left:0;right:0;height:${this.ITEM_H}px;`;

    const logo = ch.logo
      ? `<div class="ch-logo"><img src="${esc(ch.logo)}" onerror="this.parentNode.innerHTML='&lt;div class=&quot;ch-logo ch-logo-fb&quot;&gt;${esc(initials(ch.name))}&lt;/div&gt;'"></div>`
      : `<div class="ch-logo ch-logo-fb">${esc(initials(ch.name))}</div>`;

    li.innerHTML = `
      ${logo}
      <div class="ch-info">
        <div class="ch-name">${esc(ch.name)}</div>
      </div>
      ${isFav(ch) ? '<div class="ch-fav">★</div>' : ''}
      <div class="ch-num">${i + 1}</div>
    `;

    if (i === selectedIndex) {
      li._on = true;
      li.classList.add('active');
    }

    li.addEventListener('focus', () => schedulePrefetch(i));
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

let sdTm = null;

function applySearch() {
  clearTimeout(sdTm);
  sdTm = setTimeout(() => {
    const q = searchInput.value.trim().toLowerCase();
    filtered = !q
      ? channels.slice()
      : channels.filter(c =>
          c.name.toLowerCase().includes(q) ||
          (c.group || '').toLowerCase().includes(q)
        );
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

function xhrFetch(url, ms, cb) {
  let done = false;
  const xhr = new XMLHttpRequest();

  const tid = setTimeout(() => {
    if (done) return;
    done = true;
    xhr.abort();
    cb(new Error('Timeout'), null);
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
    cb(new Error('Net'), null);
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

function loadPlaylist(urlOv) {
  cancelPreview();

  if (plIdx === FAV_IDX && !urlOv) {
    showFavourites();
    return;
  }

  const rawUrl = urlOv || PLAYLISTS[plIdx].url;
  // Route through proxy to avoid CORS issues on Tizen TV
  const url = PROXY + '/playlist?url=' + encodeURIComponent(rawUrl);
  const cacheKey = 'plCache:' + rawUrl;
  const cacheTimeKey = 'plCacheTime:' + rawUrl;

  try {
    const cached = lsGet(cacheKey);
    const cacheTime = parseInt(lsGet(cacheTimeKey) || '0', 10);
    if (cached && (Date.now() - cacheTime) < 10 * 60 * 1000) {
      onLoaded(cached, true);
      return;
    }
  } catch (e) {}

  setStatus('Loading…', 'loading');
  startLoadBar();

  xhrFetch(url, 35000, (err, text) => {
    if (err) {
      // Fallback: try direct URL then mirror
      xhrFetch(rawUrl, 25000, (e2, t2) => {
        if (!e2) {
          lsSet(cacheKey, t2);
          lsSet(cacheTimeKey, String(Date.now()));
          finishLoadBar();
          onLoaded(t2, false);
          return;
        }
        const m = mirrorUrl(rawUrl);
        if (m) {
          setStatus('Retrying…', 'loading');
          xhrFetch(m, 25000, (e3, t3) => {
            finishLoadBar();
            if (e3) setStatus('Failed', 'error');
            else onLoaded(t3, false);
          });
        } else {
          finishLoadBar();
          setStatus('Failed', 'error');
        }
      });
      return;
    }

    lsSet(cacheKey, text);
    lsSet(cacheTimeKey, String(Date.now()));
    finishLoadBar();
    onLoaded(text, false);
  });

  function onLoaded(text, fromCache) {
    channels = parseM3U(text);
    const seen = new Set(allChannels.map(c => c.url));
    channels.forEach(c => {
      if (!seen.has(c.url)) allChannels.push(c);
    });
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    lsSet(PLAYLIST_KEY, String(plIdx));
    setStatus(`Ready · ${channels.length} ch${fromCache ? ' (cached)' : ''}`, 'idle');
    setFocus('list');
  }
}

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

function resetAspectRatio() {
  video.classList.remove('ar-fill', 'ar-cover', 'ar-wide');
  arIdx = 0;
  arBtn.textContent = '⛶ Native';
  arBtn.className = 'ar-btn';
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

function setARFocus(on) {
  arBtn.classList.toggle('focused', on);
}

function cancelPreview() {
  clearTimeout(previewTimer);
  previewTimer = null;
}

function schedulePreview() {
  cancelPreview();
  previewTimer = setTimeout(() => {
    previewTimer = null;
    startPreview(selectedIndex);
  }, PREVIEW_DELAY);
}

function schedulePrefetch(idx) {
  clearTimeout(prefetchTimer);
  prefetchTimer = setTimeout(async () => {
    const ch = filtered[idx];
    if (!ch || !ch.channelId || prefetchCache[ch.channelId]) return;
    try {
      const url = await jioGetStreamUrl(ch.channelId);
      prefetchCache[ch.channelId] = url;
      ch._prefetchUrl = url;
    } catch (e) {}
  }, PREFETCH_DELAY);
}

async function startPreview(idx) {
  if (!filtered.length) return;

  const ch = filtered[idx];
  if (!ch) return;

  resetAspectRatio();
  nowPlayingEl.textContent = ch.name;
  npChNumEl.textContent = 'CH ' + (idx + 1);
  videoOverlay.classList.add('hidden');
  hasPlayed = true;
  setStatus('Buffering…', 'loading');
  startLoadBar();

  let url = ch.url || ch._prefetchUrl;

  if (ch.channelId && !url) {
    try {
      if (prefetchCache[ch.channelId]) {
        url = prefetchCache[ch.channelId];
      } else {
        setStatus('Fetching stream…', 'loading');
        url = await jioGetStreamUrl(ch.channelId);
        prefetchCache[ch.channelId] = url;
      }
      ch.url = url;
    } catch (err) {
      finishLoadBar();
      setStatus('Jio error: ' + err.message, 'error');
      return;
    }
  }

  await doPlay(url);
}

function playSelected() {
  cancelPreview();
  startPreview(selectedIndex);
}

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
}

function toggleFS() {
  isFullscreen ? exitFS() : enterFS();
}

document.addEventListener('fullscreenchange', () => {
  isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
  }
});

document.addEventListener('webkitfullscreenchange', () => {
  isFullscreen = !!(document.webkitFullscreenElement || document.fullscreenElement);
  if (!isFullscreen) {
    document.body.classList.remove('fullscreen');
    fsHint.classList.remove('visible');
  }
});

video.addEventListener('dblclick', toggleFS);

function moveSel(d) {
  if (!filtered.length) return;
  cancelPreview();
  selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + d));
  VS.scrollToIndex(selectedIndex);
  VS.refresh();
  schedulePrefetch(selectedIndex);
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

function switchTab(idx) {
  plIdx = idx;
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  if (idx === JIO_IDX) handleJioTab();
  else loadPlaylist();
}

tabBar.querySelectorAll('.tab').forEach((b, i) => {
  b.addEventListener('click', () => switchTab(i));
});

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
    cancelPreview();
    selectedIndex = idx;
    VS.scrollToIndexCentered(idx);
    playSelected();
    showToast(`CH ${idx + 1} · ${filtered[idx].name}`);
  }, 1500);
}

function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'ChannelUp', 'ChannelDown', 'Back',
        '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
      ].forEach(k => {
        try { tizen.tvinputdevice.registerKey(k); } catch (e) {}
      });
    }
  } catch (e) {}
}

function enterModal() {
  focusArea = 'modal';
}

function exitModal() {
  focusArea = 'list';
}

window.addEventListener('keydown', e => {
  const k = e.key;
  const c = e.keyCode;

  if (focusArea === 'modal') {
    if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
      const modal = document.getElementById('jioModal');
      if (modal && modal.style.display !== 'none') {
        modal.style.display = 'none';
        exitModal();
        if (plIdx === JIO_IDX && !jioChannels.length) switchTab(0);
      }
      e.preventDefault();
    }
    return;
  }

  if ((c >= 48 && c <= 57) || (c >= 96 && c <= 105)) {
    if (focusArea !== 'search') {
      handleDigit(String(c >= 96 ? c - 96 : c - 48));
      e.preventDefault();
      return;
    }
  }

  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
    if (isFullscreen) {
      exitFS();
      e.preventDefault();
      return;
    }

    if (focusArea === 'ar') {
      setFocus('list');
      e.preventDefault();
      return;
    }

    if (focusArea === 'search') {
      clearSearch();
      e.preventDefault();
      return;
    }

    flushCriticalStorage();
    try {
      if (window.tizen) tizen.application.getCurrentApplication().exit();
    } catch (e2) {}
    e.preventDefault();
    return;
  }

  if (focusArea === 'ar') {
    if (k === 'Enter' || c === 13) {
      cycleAR();
      e.preventDefault();
      return;
    }
    if (k === 'ArrowLeft' || c === 37 || k === 'ArrowDown' || c === 40) {
      setFocus('list');
      e.preventDefault();
      return;
    }
    if (k === 'ArrowRight' || c === 39 || k === 'ArrowUp' || c === 38) {
      cycleAR();
      e.preventDefault();
      return;
    }
    e.preventDefault();
    return;
  }

  if (focusArea === 'search') {
    if (k === 'Enter' || c === 13) {
      commitSearch();
      e.preventDefault();
      return;
    }
    if (k === 'ArrowDown' || k === 'ArrowUp' || c === 40 || c === 38) {
      commitSearch();
      e.preventDefault();
      return;
    }
    return;
  }

  if (k === 'ArrowUp' || c === 38) {
    isFullscreen ? showFsHint() : moveSel(-1);
    e.preventDefault();
    return;
  }

  if (k === 'ArrowDown' || c === 40) {
    isFullscreen ? showFsHint() : moveSel(1);
    e.preventDefault();
    return;
  }

  if (k === 'ArrowLeft' || c === 37) {
    if (isFullscreen) {
      exitFS();
      e.preventDefault();
      return;
    }
    setFocus('list');
    e.preventDefault();
    return;
  }

  if (k === 'ArrowRight' || c === 39) {
    if (isFullscreen) {
      showFsHint();
      e.preventDefault();
      return;
    }
    setFocus('ar');
    e.preventDefault();
    return;
  }

  if (k === 'Enter' || c === 13) {
    if (isFullscreen) {
      exitFS();
      e.preventDefault();
      return;
    }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(() => { if (hasPlayed) enterFS(); }, 600);
    }
    e.preventDefault();
    return;
  }

  if (k === 'PageUp') {
    moveSel(-10);
    e.preventDefault();
    return;
  }

  if (k === 'PageDown') {
    moveSel(10);
    e.preventDefault();
    return;
  }

  if (k === 'MediaPlayPause' || c === 10252) {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    e.preventDefault();
    return;
  }

  if (k === 'MediaPlay' || c === 415) {
    video.play().catch(() => {});
    e.preventDefault();
    return;
  }

  if (k === 'MediaPause' || c === 19) {
    video.pause();
    e.preventDefault();
    return;
  }

  if (k === 'MediaStop' || c === 413) {
    cancelPreview();
    if (player) player.unload();
    video.pause();
    video.removeAttribute('src');
    setStatus('Stopped', 'idle');
    finishLoadBar();
    e.preventDefault();
    return;
  }

  if (k === 'MediaFastForward' || c === 417 || k === 'ChannelUp' || c === 427) {
    moveSel(1);
    e.preventDefault();
    return;
  }

  if (k === 'MediaRewind' || c === 412 || k === 'ChannelDown' || c === 428) {
    moveSel(-1);
    e.preventDefault();
    return;
  }

  if (k === 'ColorF0Red' || c === 403) {
    switchTab((plIdx + 1) % (PLAYLISTS.length + 2));
    e.preventDefault();
    return;
  }

  if (k === 'ColorF1Green' || c === 404) {
    if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]);
    e.preventDefault();
    return;
  }

  if (k === 'ColorF2Yellow' || c === 405) {
    setFocus('search');
    e.preventDefault();
    return;
  }

  if (k === 'ColorF3Blue' || c === 406) {
    if (hasPlayed) toggleFS();
    e.preventDefault();
  }
});

async function wakeProxy() {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 55000);

  try {
    await fetch(PROXY + '/ping', { signal: ctrl.signal });
  } catch (e) {
    console.warn('[proxy warm-up failed]', e.message);
  } finally {
    clearTimeout(tid);
  }
}

async function fetchWithRetry(url, opts = {}, retries = 2, baseDelay = 3000) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 60000);

    try {
      const r = await fetch(url, { ...opts, signal: ctrl.signal });
      clearTimeout(tid);
      return r;
    } catch (err) {
      clearTimeout(tid);
      if (attempt === retries) throw err;
      const delay = baseDelay * Math.pow(2, attempt);
      await new Promise(res => setTimeout(res, delay));
    }
  }
}

async function jioApi(path, options = {}) {
  const r = await fetchWithRetry(PROXY + path, {
    ...options,
    headers: {
      ...ANDROID_HEADERS,
      ...(options.headers || {}),
    },
  });

  if (!r.ok) {
    let msg = 'HTTP ' + r.status;
    try {
      const data = await r.json();
      msg = data.error || data.message || msg;
    } catch (e) {}
    throw new Error(msg);
  }

  return r.json();
}

async function jioRequestOtp(mobile) {
  const data = await jioApi('/jio/sendotp', {
    method: 'POST',
    body: JSON.stringify({
      number: '+91' + mobile,
      deviceInfo: {
        model: DEVICE.model,
        manufacturer: DEVICE.manufacturer,
        osVersion: DEVICE.osVersion,
        uniqueId: DEVICE.uniqueId,
        deviceType: 'tv',
      },
    }),
  });

  // Accept any field name the backend may return for the request/session ID
  const rid = data.requestId || data.OtpReqId || data.reqId || data.sessionId || data.id;
  if (!rid) throw new Error('No requestId in OTP response');
  return rid;
}

async function jioVerifyOtp(mobile, otp, requestId) {
  const data = await jioApi('/jio/verifyotp', {
    method: 'POST',
    body: JSON.stringify({
      number: '+91' + mobile,
      otp,
      requestId,
      deviceInfo: {
        model: DEVICE.model,
        manufacturer: DEVICE.manufacturer,
        osVersion: DEVICE.osVersion,
        uniqueId: DEVICE.uniqueId,
        deviceType: 'tv',
      },
    }),
  });

  // Accept all possible token field names JioTV API may return
  const ssoToken = data.ssoToken || data.access_token || data.authToken || data.token;
  const refreshToken = data.refreshToken || data.refresh_token;
  if (!ssoToken) throw new Error('No auth token in verify response');

  return {
    ssoToken,
    refreshToken,
    expires: Date.now() + ((data.tokenValidity || 3600) * 1000),
  };
}

async function jioGetStreamUrl(channelId) {
  if (!jioToken) throw new Error('Not logged in');

  const data = await jioApi('/jio/channel/' + channelId + '?quality=HD', {
    headers: { ssotoken: jioToken.ssoToken },
  });

  const url = data?.result?.bitrates?.auto || data?.url || data?.result?.url;
  if (!url) throw new Error('No stream URL');
  return url;
}

async function jioRefreshToken() {
  if (!jioToken?.refreshToken) return false;

  try {
    const data = await jioApi('/jio/refreshtoken', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: jioToken.refreshToken }),
    });

    jioToken.ssoToken = data.ssoToken || data.access_token || jioToken.ssoToken;
    jioToken.refreshToken = data.refreshToken || data.refresh_token || jioToken.refreshToken;
    jioToken.expires = Date.now() + ((data.tokenValidity || 3600) * 1000);

    lsSet(JIO_TOKEN_KEY, JSON.stringify(jioToken));
    FS.write(FS_TOKEN_FILE, jioToken);
    return true;
  } catch (e) {
    return false;
  }
}

function scheduleTokenRefresh() {
  clearTimeout(tokenRefreshTimer);

  if (!jioToken?.expires) return;

  const delay = jioToken.expires - Date.now() - 30 * 60 * 1000;
  if (delay > 0) {
    tokenRefreshTimer = setTimeout(async () => {
      await jioRefreshToken();
      scheduleTokenRefresh();
    }, delay);
  }
}

async function loadJioChannels() {
  if (!jioToken) return false;

  try {
    const cached = lsGet(JIO_CH_KEY);
    const cacheTime = parseInt(lsGet(JIO_CH_KEY + ':time') || '0', 10);

    if (cached && (Date.now() - cacheTime) < JIO_CH_TTL) {
      jioChannels = JSON.parse(cached);
      channels = jioChannels.slice();
      filtered = channels.slice();
      selectedIndex = 0;
      renderList();
      setStatus(`Jio TV · ${channels.length} ch (cached)`, 'idle');
      return true;
    }

    setStatus('Loading Jio channels…', 'loading');
    startLoadBar();

    const data = await jioApi('/jio/channels', {
      headers: { ssotoken: jioToken.ssoToken },
    });

    const list = data?.result || data?.channels || [];
    jioChannels = list.map(ch => ({
      name: ch.channelName || ch.name || ('CH ' + ch.channelId),
      logo: ch.logoUrl || ch.logo || '',
      channelId: ch.channelId,
      group: 'Jio TV',
      url: null,
    }));

    lsSet(JIO_CH_KEY, JSON.stringify(jioChannels));
    lsSet(JIO_CH_KEY + ':time', String(Date.now()));
    FS.write(FS_CH_FILE, { channels: jioChannels, time: Date.now() });

    channels = jioChannels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    finishLoadBar();
    setStatus(`Jio TV · ${channels.length} ch`, 'idle');
    return true;
  } catch (err) {
    finishLoadBar();
    if (await jioRefreshToken()) return loadJioChannels();
    setStatus('Jio error: ' + err.message, 'error');
    return false;
  }
}

function showJioLoginModal() {
  const modal = document.getElementById('jioModal');
  const step1 = document.getElementById('jioLoginStep1');
  const step2 = document.getElementById('jioLoginStep2');
  const statusDiv = document.getElementById('jioStatus');
  const mobileInput = document.getElementById('jioMobile');
  const otpInput = document.getElementById('jioOtp');
  const reqBtn = document.getElementById('jioRequestOtp');
  const verifyBtn = document.getElementById('jioVerifyOtp');
  const closeBtn = document.getElementById('jioCloseModal');

  if (!modal || !step1 || !step2 || !statusDiv || !mobileInput || !otpInput || !reqBtn || !verifyBtn) {
    console.error('[JioModal] Missing HTML elements');
    return;
  }

  let requestId = null;
  let confirmedMobile = null;

  step1.style.display = 'block';
  step2.style.display = 'none';
  statusDiv.textContent = '';
  mobileInput.value = '';
  otpInput.value = '';
  reqBtn.disabled = false;
  verifyBtn.disabled = false;
  modal.style.display = 'flex';
  enterModal();

  setTimeout(() => mobileInput.focus(), 150);

  reqBtn.onclick = async () => {
    const mobile = mobileInput.value.trim();

    if (!/^\d{10}$/.test(mobile)) {
      statusDiv.textContent = 'Enter valid 10-digit number';
      return;
    }

    reqBtn.disabled = true;
    statusDiv.textContent = 'Waking server…';

    try {
      await wakeProxy();
      statusDiv.textContent = 'Sending OTP…';
      requestId = await jioRequestOtp(mobile);
      confirmedMobile = mobile;
      statusDiv.textContent = 'OTP sent ✓';
      step1.style.display = 'none';
      step2.style.display = 'block';
      setTimeout(() => otpInput.focus(), 100);
    } catch (err) {
      statusDiv.textContent = err.message || 'OTP request failed';
      reqBtn.disabled = false;
    }
  };

  verifyBtn.onclick = async () => {
    const mobile = confirmedMobile || mobileInput.value.trim();
    const otp = otpInput.value.trim();

    if (!otp) {
      statusDiv.textContent = 'Enter OTP';
      return;
    }

    if (!requestId || !mobile) {
      statusDiv.textContent = 'Please request OTP first';
      step1.style.display = 'block';
      step2.style.display = 'none';
      reqBtn.disabled = false;
      return;
    }

    verifyBtn.disabled = true;
    statusDiv.textContent = 'Verifying…';

    try {
      const t = await jioVerifyOtp(mobile, otp, requestId);
      jioToken = t;
      lsSet(JIO_TOKEN_KEY, JSON.stringify(jioToken));
      FS.write(FS_TOKEN_FILE, jioToken);
      statusDiv.textContent = 'Login successful! Loading channels…';
      modal.style.display = 'none';
      exitModal();
      scheduleTokenRefresh();
      await loadJioChannels();
      setFocus('list');
    } catch (err) {
      statusDiv.textContent = err.message || 'Verification failed';
      verifyBtn.disabled = false;
    }
  };

  if (closeBtn) {
    closeBtn.onclick = () => {
      modal.style.display = 'none';
      exitModal();
      if (plIdx === JIO_IDX && !jioChannels.length) switchTab(0);
    };
  }
}

async function handleJioTab() {
  if (jioChannels.length) {
    channels = jioChannels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    setStatus(`Jio TV · ${channels.length} ch`, 'idle');
    setFocus('list');
    return;
  }

  const stored = lsGet(JIO_TOKEN_KEY);
  if (stored) {
    try {
      const t = JSON.parse(stored);
      if (t.expires > Date.now()) {
        jioToken = t;
        await loadJioChannels();
        return;
      }

      jioToken = t;
      if (await jioRefreshToken()) {
        await loadJioChannels();
        return;
      }

      lsRemove(JIO_TOKEN_KEY);
    } catch (e) {}
  }

  FS.read(FS_TOKEN_FILE, async diskToken => {
    if (diskToken && diskToken.ssoToken) {
      jioToken = diskToken;

      if (jioToken.expires > Date.now()) {
        lsSet(JIO_TOKEN_KEY, JSON.stringify(jioToken));

        FS.read(FS_CH_FILE, async diskCh => {
          if (diskCh?.channels?.length && (Date.now() - diskCh.time) < JIO_CH_TTL) {
            jioChannels = diskCh.channels;
            channels = jioChannels.slice();
            filtered = channels.slice();
            selectedIndex = 0;
            renderList();
            setStatus(`Jio TV · ${channels.length} ch (cached)`, 'idle');
            setFocus('list');
          } else {
            await loadJioChannels();
          }
        });
        return;
      }
    }

    showJioLoginModal();
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCriticalStorage();
});

window.addEventListener('pagehide', flushCriticalStorage);

document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') flushCriticalStorage();
});

(async function init() {
  registerKeys();

  try {
    const s = lsGet(PLAYLIST_KEY);
    if (s) plIdx = Math.min(parseInt(s, 10) || 0, PLAYLISTS.length + 1);
  } catch (e) {}

  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', i === plIdx);
  });

  VS.init(channelListEl);
  await initShaka();

  if (plIdx === JIO_IDX) handleJioTab();
  else loadPlaylist();

  try {
    const stored = lsGet(JIO_TOKEN_KEY);
    if (stored) {
      const t = JSON.parse(stored);
      if (t.expires > Date.now()) {
        jioToken = t;
        scheduleTokenRefresh();
      }
    }
  } catch (e) {}

  setInterval(() => {
    fetch(PROXY + '/ping').catch(() => {});
  }, 8 * 60 * 1000);
})();
