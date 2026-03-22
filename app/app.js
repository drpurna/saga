// ================================================================
// IPTV v1.0.2 — app.js (original working + HLS.js)
// ================================================================

const playlistUrlEl = document.getElementById('playlistUrl');
const loadBtn       = document.getElementById('loadBtn');
const defaultBtn    = document.getElementById('defaultBtn');
const searchInput   = document.getElementById('searchInput');
const channelListEl = document.getElementById('channelList');
const countBadge    = document.getElementById('countBadge');
const nowPlayingEl  = document.getElementById('nowPlaying');
const nowGroupEl    = document.getElementById('nowGroup');
const statusTextEl  = document.getElementById('statusText');
const video         = document.getElementById('video');
const videoWrap     = document.getElementById('videoWrap');

// Default playlists
const DEFAULT_PLAYLISTS = [
  { name: 'Telugu',  url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'Hindi',   url: 'https://iptv-org.github.io/iptv/languages/hin.m3u' },
  { name: 'English', url: 'https://iptv-org.github.io/iptv/languages/eng.m3u' },
  { name: 'Distro',  url: 'https://github.com/iptv-org/iptv/blob/master/streams/in_distro.m3u' },
  { name: 'News',    url: 'https://iptv-org.github.io/iptv/categories/news.m3u' },
  { name: 'Sports',  url: 'https://iptv-org.github.io/iptv/categories/sports.m3u' },
  { name: 'Movies',  url: 'https://iptv-org.github.io/iptv/categories/movies.m3u' },
];

let channels      = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list';
let hls           = null;
let plIdx         = 0;
let isFullscreen  = false;
let lastTap       = 0;

// Restore last used playlist
const STORAGE_KEY = 'iptv:lastPlaylist';
const savedUrl = (() => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; } })();
playlistUrlEl.value = savedUrl || DEFAULT_PLAYLISTS[0].url;

// Status
function setStatus(text) {
  statusTextEl.textContent = text;
}

// M3U parser
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  let currentMeta = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXTINF')) {
      const namePart = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      currentMeta = {
        name:  namePart || 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Other',
      };
      continue;
    }
    if (!line.startsWith('#')) {
      out.push({
        name:  currentMeta?.name  || line,
        group: currentMeta?.group || 'Other',
        url:   line,
      });
      currentMeta = null;
    }
  }
  return out;
}

// Render list
function renderList() {
  channelListEl.innerHTML = '';
  countBadge.textContent = filtered.length;
  if (!filtered.length) {
    const li = document.createElement('li');
    li.textContent = 'No channels';
    channelListEl.appendChild(li);
    return;
  }
  filtered.forEach((ch, idx) => {
    const li = document.createElement('li');
    if (idx === selectedIndex) li.classList.add('active');
    li.innerHTML = `<div class="ch-name">${escHtml(ch.name)}</div><div class="meta">${escHtml(ch.group)}</div>`;
    li.onclick = () => {
      selectedIndex = idx;
      renderList();
      playSelected();
    };
    channelListEl.appendChild(li);
  });
  const active = channelListEl.querySelector('li.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Search
function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  filtered = !q ? [...channels] : channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  renderList();
}

// XHR fetch
function xhrFetch(url, timeoutMs, callback) {
  let done = false;
  const xhr = new XMLHttpRequest();
  const tid = setTimeout(() => {
    if (done) return;
    done = true;
    xhr.abort();
    callback(new Error('Timeout'), null);
  }, timeoutMs);
  xhr.onreadystatechange = function () {
    if (xhr.readyState !== 4) return;
    if (done) return;
    done = true;
    clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) {
      callback(null, xhr.responseText);
    } else {
      callback(new Error('HTTP ' + xhr.status), null);
    }
  };
  xhr.onerror = function () {
    if (done) return;
    done = true;
    clearTimeout(tid);
    callback(new Error('Network error'), null);
  };
  xhr.open('GET', url, true);
  xhr.send();
}

function githubRawToJsdelivr(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return null;
    return `https://cdn.jsdelivr.net/gh/${parts[0]}/${parts[1]}@${parts[2]}/${parts.slice(3).join('/')}`;
  } catch (_) { return null; }
}

// Load playlist
function loadPlaylist(urlOverride) {
  const url = (urlOverride || playlistUrlEl.value).trim();
  if (!url) { setStatus('Enter a playlist URL'); return; }
  playlistUrlEl.value = url;
  setStatus('Loading playlist...');
  loadBtn.disabled = true;
  xhrFetch(url, 20000, (err, text) => {
    if (err) {
      const mirror = githubRawToJsdelivr(url);
      if (mirror) {
        setStatus('Trying mirror...');
        xhrFetch(mirror, 20000, (err2, text2) => {
          loadBtn.disabled = false;
          if (err2) { setStatus(`Load failed: ${err2.message}`); return; }
          onLoaded(text2, url);
        });
      } else {
        loadBtn.disabled = false;
        setStatus(`Load failed: ${err.message}`);
      }
      return;
    }
    loadBtn.disabled = false;
    onLoaded(text, url);
  });
}

function onLoaded(text, url) {
  channels = parseM3U(text);
  filtered = [...channels];
  selectedIndex = 0;
  renderList();
  try { localStorage.setItem(STORAGE_KEY, url); } catch (_) {}
  setStatus(`Loaded ${channels.length} channels`);
  setFocusArea('list');
}

// Playback with HLS.js
function playSelected() {
  if (!filtered.length) return;
  const ch = filtered[selectedIndex];
  if (!ch) return;
  nowPlayingEl.textContent = ch.name;
  nowGroupEl.textContent   = ch.group || '';
  setStatus('Buffering...');
  try {
    if (hls) { hls.destroy(); hls = null; }
    const url = ch.url;
    const isHls = /\.m3u8($|\?)/i.test(url) || url.toLowerCase().includes('m3u8');
    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: false });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => video.play().catch(() => {}));
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (data?.fatal) setStatus(`Stream error: ${data.type || 'unknown'}`);
        });
        return;
      }
      setStatus('HLS not supported');
      return;
    }
    video.src = url;
    video.play().catch(() => {});
  } catch (err) {
    setStatus(`Play error: ${err.message}`);
  }
}

// Navigation
function moveSelection(delta) {
  if (!filtered.length) return;
  selectedIndex += delta;
  if (selectedIndex < 0) selectedIndex = 0;
  if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1;
  renderList();
}

// Focus area
function setFocusArea(area) {
  focusArea = area;
  if (area === 'url') {
    playlistUrlEl.focus();
  } else if (area === 'search') {
    searchInput.focus();
  } else {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
      document.activeElement.blur();
    }
  }
}

// Fullscreen
function enterFullscreen() {
  const el = videoWrap;
  const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
  if (fn) { fn.call(el); return; }
  document.body.classList.add('fullscreen');
  isFullscreen = true;
}
function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
  if (fn) { fn.call(document); return; }
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
}
function toggleFullscreen() { isFullscreen ? exitFullscreen() : enterFullscreen(); }

document.addEventListener('fullscreenchange', () => {
  isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
  if (!isFullscreen) document.body.classList.remove('fullscreen');
});
document.addEventListener('webkitfullscreenchange', () => {
  isFullscreen = !!(document.webkitFullscreenElement || document.fullscreenElement);
  if (!isFullscreen) document.body.classList.remove('fullscreen');
});

video.addEventListener('dblclick', toggleFullscreen);
video.addEventListener('click', () => {
  const now = Date.now();
  if (now - lastTap < 400) toggleFullscreen();
  lastTap = now;
});

video.addEventListener('playing', () => setStatus('Playing'));
video.addEventListener('pause',   () => setStatus('Paused'));
video.addEventListener('waiting', () => setStatus('Buffering...'));
video.addEventListener('stalled', () => setStatus('Buffering...'));
video.addEventListener('error',   () => setStatus('Playback error'));

loadBtn.addEventListener('click', () => loadPlaylist());
defaultBtn.addEventListener('click', () => {
  plIdx = (plIdx + 1) % DEFAULT_PLAYLISTS.length;
  const pl = DEFAULT_PLAYLISTS[plIdx];
  defaultBtn.textContent = pl.name;
  playlistUrlEl.value = pl.url;
  loadPlaylist(pl.url);
});
searchInput.addEventListener('input', applySearch);

// Tizen key registration
(function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay', 'MediaPause', 'MediaPlayPause', 'MediaStop',
        'MediaFastForward', 'MediaRewind',
        'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
        'ChannelUp', 'ChannelDown', 'Back',
      ].forEach(k => { try { tizen.tvinputdevice.registerKey(k); } catch (_) {} });
    }
  } catch (_) {}
})();

// Key handling
window.addEventListener('keydown', (e) => {
  const key = e.key;
  const code = e.keyCode;
  if (key === 'Escape' || key === 'Back' || code === 10009 || code === 27) {
    if (focusArea === 'url' || focusArea === 'search') {
      setFocusArea('list');
      e.preventDefault();
      return;
    }
    if (isFullscreen) {
      exitFullscreen();
      e.preventDefault();
      return;
    }
    try { tizen.application.getCurrentApplication().exit(); } catch (_) {}
    e.preventDefault();
    return;
  }
  if (focusArea === 'url' || focusArea === 'search') {
    if (key === 'Enter' || code === 13) {
      if (focusArea === 'url') loadPlaylist();
      setFocusArea('list');
      e.preventDefault();
    }
    return;
  }
  if (key === 'ArrowUp' || code === 38) { if (focusArea === 'list') moveSelection(-1); e.preventDefault(); return; }
  if (key === 'ArrowDown' || code === 40) { if (focusArea === 'list') moveSelection(1); e.preventDefault(); return; }
  if (key === 'ArrowLeft' || code === 37) { if (isFullscreen) exitFullscreen(); else setFocusArea('list'); e.preventDefault(); return; }
  if (key === 'ArrowRight' || code === 39) { focusArea = 'player'; e.preventDefault(); return; }
  if (key === 'Enter' || code === 13) {
    if (focusArea === 'list') playSelected();
    if (focusArea === 'player') toggleFullscreen();
    e.preventDefault(); return;
  }
  if (key === 'PageUp')   { moveSelection(-10); e.preventDefault(); return; }
  if (key === 'PageDown') { moveSelection(10);  e.preventDefault(); return; }
  if (key === 'MediaPlayPause' || code === 10252) {
    video.paused ? video.play().catch(() => {}) : video.pause();
    e.preventDefault(); return;
  }
  if (key === 'MediaPlay' || code === 415) { video.play().catch(() => {}); e.preventDefault(); return; }
  if (key === 'MediaPause' || code === 19) { video.pause(); e.preventDefault(); return; }
  if (key === 'MediaStop' || code === 413) {
    if (hls) { hls.destroy(); hls = null; }
    video.pause();
    video.removeAttribute('src');
    video.load();
    setStatus('Stopped');
    e.preventDefault(); return;
  }
  if (key === 'MediaFastForward' || code === 417) { moveSelection(1); playSelected(); e.preventDefault(); return; }
  if (key === 'MediaRewind' || code === 412) { moveSelection(-1); playSelected(); e.preventDefault(); return; }
  if (key === 'ChannelUp'   || code === 427) { moveSelection(1); playSelected(); e.preventDefault(); return; }
  if (key === 'ChannelDown' || code === 428) { moveSelection(-1); playSelected(); e.preventDefault(); return; }
  if (key === 'ColorF0Red'    || code === 403) { setFocusArea('url'); e.preventDefault(); return; }
  if (key === 'ColorF1Green'  || code === 404) { loadPlaylist(); e.preventDefault(); return; }
  if (key === 'ColorF2Yellow' || code === 405) { setFocusArea('search'); e.preventDefault(); return; }
  if (key === 'ColorF3Blue'   || code === 406) { defaultBtn.click(); e.preventDefault(); return; }
});

// Start
loadPlaylist(playlistUrlEl.value);