const searchInput = document.getElementById('searchInput');
const channelListEl = document.getElementById('channelList');
const nowPlayingEl = document.getElementById('nowPlaying');
const statusTextEl = document.getElementById('statusText');
const video = document.getElementById('video');
const categoryBar = document.getElementById('categoryBar');

let channels = [];
let filtered = [];
let selectedIndex = 0;
let focusArea = 'list'; // list | player
let hls = null;

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/languages/tel.m3u';

function setStatus(text) {
  statusTextEl.textContent = text;
}

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
      const logoMatch = line.match(/tvg-logo="([^"]+)"/i);
      currentMeta = {
        name: namePart || 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Other',
        logo: logoMatch ? logoMatch[1] : null,
      };
      continue;
    }

    if (!line.startsWith('#')) {
      const item = {
        name: currentMeta?.name || line,
        group: currentMeta?.group || 'Other',
        logo: currentMeta?.logo || null,
        url: line,
      };
      out.push(item);
      currentMeta = null;
    }
  }
  return out;
}

function updateCategoryBar(allChannels) {
  const groups = [...new Set(allChannels.map(ch => ch.group))].sort();
  categoryBar.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.textContent = 'All';
  allBtn.classList.add('category-btn', 'active');
  allBtn.dataset.group = '';
  allBtn.addEventListener('click', () => {
    filterByGroup('');
    highlightCategory(allBtn);
  });
  categoryBar.appendChild(allBtn);

  groups.forEach(group => {
    const btn = document.createElement('button');
    btn.textContent = group;
    btn.classList.add('category-btn');
    btn.dataset.group = group;
    btn.addEventListener('click', () => {
      filterByGroup(group);
      highlightCategory(btn);
    });
    categoryBar.appendChild(btn);
  });
}

function filterByGroup(group) {
  filtered = group ? channels.filter(ch => ch.group === group) : [...channels];
  selectedIndex = 0;
  renderList();
}

function highlightCategory(activeBtn) {
  document.querySelectorAll('.category-btn').forEach(btn => btn.classList.remove('active'));
  activeBtn.classList.add('active');
}

function renderList() {
  channelListEl.innerHTML = '';
  if (!filtered.length) {
    const li = document.createElement('li');
    li.textContent = 'No channels';
    channelListEl.appendChild(li);
    return;
  }

  filtered.forEach((ch, idx) => {
    const li = document.createElement('li');
    if (idx === selectedIndex) li.classList.add('active');

    const iconHtml = ch.logo ? `<img class="channel-icon" src="${ch.logo}" alt="" loading="lazy">` : '';
    li.innerHTML = `
      <div class="channel-item">
        ${iconHtml}
        <div class="channel-info">
          <div>${ch.name}</div>
          <div class="meta">${ch.group}</div>
        </div>
      </div>
    `;

    li.addEventListener('click', () => {
      selectedIndex = idx;
      renderList();
      playSelected();
    });

    li.addEventListener('dblclick', () => {
      toggleFullscreen();
    });

    channelListEl.appendChild(li);
  });

  const active = channelListEl.querySelector('li.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    video.requestFullscreen().catch(err => console.warn('Fullscreen failed:', err));
  } else {
    document.exitFullscreen();
  }
}

function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  filtered = !q
    ? [...channels]
    : channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
  renderList();
}

function githubRawToJsdelivr(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length < 4) return null;
    const owner = parts[0];
    const repo = parts[1];
    const branch = parts[2];
    const filePath = parts.slice(3).join('/');
    return `https://cdn.jsdelivr.net/gh/${owner}/${repo}@${branch}/${filePath}`;
  } catch (_) {
    return null;
  }
}

async function fetchTextWithTimeout(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function loadPlaylist() {
  setStatus('Loading playlist...');
  try {
    let text;
    let usedUrl = PLAYLIST_URL;

    try {
      text = await fetchTextWithTimeout(PLAYLIST_URL, 15000);
    } catch (primaryErr) {
      const mirrorUrl = githubRawToJsdelivr(PLAYLIST_URL);
      if (!mirrorUrl) throw primaryErr;
      setStatus('Primary URL failed, trying mirror...');
      text = await fetchTextWithTimeout(mirrorUrl, 15000);
      usedUrl = mirrorUrl;
    }

    channels = parseM3U(text);
    filtered = [...channels];
    selectedIndex = 0;
    renderList();
    updateCategoryBar(channels);

    setStatus(`Loaded ${channels.length} channels`);
  } catch (err) {
    console.error(err);
    if (err?.name === 'AbortError') {
      setStatus('Load failed: timeout (network/TLS blocked?)');
      return;
    }
    setStatus(`Load failed: ${err.message || 'unknown error'}`);
  }
}

function playSelected() {
  if (!filtered.length) return;
  const ch = filtered[selectedIndex];
  if (!ch) return;

  nowPlayingEl.textContent = ch.name;
  setStatus('Buffering...');

  try {
    if (hls) {
      hls.destroy();
      hls = null;
    }

    const url = ch.url;
    const isHls = /\.m3u8($|\?)/i.test(url) || url.toLowerCase().includes('m3u8');

    if (isHls) {
      if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls({ enableWorker: true });
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (data?.fatal) {
            setStatus(`HLS fatal: ${data.type || 'unknown'}`);
          }
        });
        return;
      }
      setStatus('HLS not supported on this runtime');
      return;
    }

    video.src = url;
    video.play().catch(() => {});
  } catch (err) {
    setStatus(`Play error: ${err.message}`);
  }
}

function moveSelection(delta) {
  if (!filtered.length) return;
  selectedIndex += delta;
  if (selectedIndex < 0) selectedIndex = 0;
  if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1;
  renderList();
}

video.addEventListener('playing', () => setStatus('Playing'));
video.addEventListener('pause', () => setStatus('Paused'));
video.addEventListener('waiting', () => setStatus('Buffering...'));
video.addEventListener('error', () => setStatus('Playback error'));

searchInput.addEventListener('input', applySearch);

// Tizen key registration
(function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay',
        'MediaPause',
        'MediaPlayPause',
        'MediaStop',
        'MediaFastForward',
        'MediaRewind',
        'ColorF1Green',
        'ColorF2Yellow',
        'ColorF3Blue',
      ].forEach(k => {
        try { tizen.tvinputdevice.registerKey(k); } catch (_) {}
      });
    }
  } catch (_) {}
})();

window.addEventListener('keydown', (e) => {
  const key = e.key;
  const code = e.keyCode;

  if (key === 'ArrowUp') {
    if (focusArea === 'list') moveSelection(-1);
    e.preventDefault();
    return;
  }
  if (key === 'ArrowDown') {
    if (focusArea === 'list') moveSelection(1);
    e.preventDefault();
    return;
  }
  if (key === 'ArrowLeft') {
    focusArea = 'list';
    e.preventDefault();
    return;
  }
  if (key === 'ArrowRight') {
    focusArea = 'player';
    e.preventDefault();
    return;
  }
  if (key === 'Enter') {
    if (focusArea === 'list') {
      playSelected();
    } else if (focusArea === 'player') {
      toggleFullscreen();
    }
    e.preventDefault();
    return;
  }

  if (key === 'MediaPlayPause' || code === 10252) {
    if (video.paused) video.play().catch(() => {});
    else video.pause();
    e.preventDefault();
    return;
  }
  if (key === 'MediaPlay' || code === 415) {
    video.play().catch(() => {});
    e.preventDefault();
    return;
  }
  if (key === 'MediaPause' || code === 19) {
    video.pause();
    e.preventDefault();
    return;
  }
  if (key === 'MediaStop' || code === 413) {
    video.pause();
    video.removeAttribute('src');
    video.load();
    setStatus('Stopped');
    e.preventDefault();
    return;
  }

  if (key === 'ColorF1Green' || code === 404) {
    loadPlaylist();
    e.preventDefault();
    return;
  }
});

loadPlaylist();