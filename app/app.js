// ========== DOM Elements ==========
const browseView = document.getElementById('browseView');
const playerView = document.getElementById('playerView');
const categoryTabs = document.getElementById('categoryTabs');
const rowsContainer = document.getElementById('rowsContainer');
const backButton = document.getElementById('backButton');
const video = document.getElementById('video');
const nowPlayingTitle = document.getElementById('nowPlayingTitle');
const playerStatus = document.getElementById('playerStatus');

let channels = [];
let groupedChannels = {}; // { category: [channels] }
let categories = [];
let currentCategory = 'All';
let rows = []; // references to row elements
let tiles = []; // flat array of tile elements for focus management
let focusedRowIndex = 0;
let focusedTileIndex = 0; // index within current row
let hls = null;
let currentChannel = null;

const PLAYLIST_URL = 'https://iptv-org.github.io/iptv/languages/tel.m3u';

// ========== Utility Functions ==========
function setPlayerStatus(text) {
  playerStatus.textContent = text;
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

// ========== Build UI ==========
function buildUI() {
  // Group channels by category
  groupedChannels = {};
  channels.forEach(ch => {
    const cat = ch.group;
    if (!groupedChannels[cat]) groupedChannels[cat] = [];
    groupedChannels[cat].push(ch);
  });
  categories = Object.keys(groupedChannels).sort();

  // Build category tabs
  categoryTabs.innerHTML = '';
  const allTab = document.createElement('button');
  allTab.classList.add('category-tab', 'active');
  allTab.textContent = 'All';
  allTab.dataset.category = 'All';
  allTab.addEventListener('click', () => filterByCategory('All'));
  categoryTabs.appendChild(allTab);

  categories.forEach(cat => {
    const tab = document.createElement('button');
    tab.classList.add('category-tab');
    tab.textContent = cat;
    tab.dataset.category = cat;
    tab.addEventListener('click', () => filterByCategory(cat));
    categoryTabs.appendChild(tab);
  });

  // Build rows for all categories initially
  renderRows('All');
}

function renderRows(category) {
  rowsContainer.innerHTML = '';
  rows = [];
  tiles = [];

  let categoriesToRender = category === 'All' ? categories : [category];

  categoriesToRender.forEach(cat => {
    const channelList = groupedChannels[cat];
    if (!channelList || channelList.length === 0) return;

    const row = document.createElement('div');
    row.className = 'row';
    row.dataset.category = cat;

    const title = document.createElement('h2');
    title.className = 'row-title';
    title.textContent = cat;
    row.appendChild(title);

    const tileContainer = document.createElement('div');
    tileContainer.className = 'tile-container';

    channelList.forEach((ch, idx) => {
      const tile = document.createElement('div');
      tile.className = 'tile';
      tile.dataset.category = cat;
      tile.dataset.index = idx;
      tile.dataset.channel = JSON.stringify(ch); // store channel data

      const icon = document.createElement('img');
      icon.className = 'tile-icon';
      icon.src = ch.logo || '';
      icon.alt = ch.name;
      icon.loading = 'lazy';

      const name = document.createElement('div');
      name.className = 'tile-name';
      name.textContent = ch.name;

      const group = document.createElement('div');
      group.className = 'tile-group';
      group.textContent = ch.group;

      tile.appendChild(icon);
      tile.appendChild(name);
      tile.appendChild(group);

      tile.addEventListener('click', () => {
        // On click, play this channel
        playChannel(ch);
      });
      tile.addEventListener('dblclick', () => {
        // Double-click toggles fullscreen (but we're going to player view anyway)
        // Actually in player view we handle fullscreen. Here we just play.
        playChannel(ch);
      });

      tileContainer.appendChild(tile);
      tiles.push(tile); // flat list for focus management
    });

    row.appendChild(tileContainer);
    rowsContainer.appendChild(row);
    rows.push(row);
  });

  // Set initial focus
  if (tiles.length > 0) {
    setFocus(0, 0);
  }
}

function filterByCategory(category) {
  currentCategory = category;
  // Update active tab
  document.querySelectorAll('.category-tab').forEach(tab => {
    tab.classList.remove('active');
    if (tab.dataset.category === category) tab.classList.add('active');
  });
  renderRows(category);
}

// ========== Focus Management ==========
function setFocus(rowIdx, tileIdx) {
  // Remove focus from all tiles
  tiles.forEach(t => t.classList.remove('focused'));

  // Find the actual tile element based on row and tile index
  // We need to map rowIdx to the actual row in the current rendered rows
  if (rows.length === 0) return;

  // Ensure indices are within bounds
  if (rowIdx < 0) rowIdx = 0;
  if (rowIdx >= rows.length) rowIdx = rows.length - 1;

  const row = rows[rowIdx];
  const tileContainer = row.querySelector('.tile-container');
  const tilesInRow = Array.from(tileContainer.children);
  if (tilesInRow.length === 0) return;

  if (tileIdx < 0) tileIdx = 0;
  if (tileIdx >= tilesInRow.length) tileIdx = tilesInRow.length - 1;

  const targetTile = tilesInRow[tileIdx];
  targetTile.classList.add('focused');
  targetTile.scrollIntoView({ block: 'nearest', inline: 'center' });

  focusedRowIndex = rowIdx;
  focusedTileIndex = tileIdx;
}

function moveFocus(dx, dy) {
  if (rows.length === 0) return;

  let newRowIdx = focusedRowIndex + dy;
  let newTileIdx = focusedTileIndex + dx;

  // Clamp row index
  if (newRowIdx < 0) newRowIdx = 0;
  if (newRowIdx >= rows.length) newRowIdx = rows.length - 1;

  // Get tile count in new row
  const newRow = rows[newRowIdx];
  const tileContainer = newRow.querySelector('.tile-container');
  const tilesInNewRow = Array.from(tileContainer.children);
  if (tilesInNewRow.length === 0) return;

  // Clamp tile index
  if (newTileIdx < 0) newTileIdx = 0;
  if (newTileIdx >= tilesInNewRow.length) newTileIdx = tilesInNewRow.length - 1;

  setFocus(newRowIdx, newTileIdx);
}

// ========== Playback ==========
function playChannel(channel) {
  currentChannel = channel;
  nowPlayingTitle.textContent = channel.name;
  setPlayerStatus('Buffering...');

  // Hide browse, show player
  browseView.classList.add('hidden');
  playerView.classList.remove('hidden');

  // Focus back button for remote (optional)
  backButton.focus();

  // Stop any existing playback
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();

  const url = channel.url;
  const isHls = /\.m3u8($|\?)/i.test(url) || url.toLowerCase().includes('m3u8');

  try {
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
            setPlayerStatus(`HLS fatal: ${data.type || 'unknown'}`);
          }
        });
        return;
      }
      setPlayerStatus('HLS not supported');
      return;
    }

    video.src = url;
    video.play().catch(() => {});
  } catch (err) {
    setPlayerStatus(`Play error: ${err.message}`);
  }
}

function exitPlayer() {
  // Stop playback
  if (hls) {
    hls.destroy();
    hls = null;
  }
  video.pause();
  video.removeAttribute('src');
  video.load();

  // Show browse, hide player
  playerView.classList.add('hidden');
  browseView.classList.remove('hidden');

  // Restore focus to the tile that was playing
  if (tiles.length > 0) {
    // We need to find the tile corresponding to currentChannel
    // For simplicity, we'll focus the first tile. But we could search.
    setFocus(focusedRowIndex, focusedTileIndex);
  }
}

// ========== Playlist Loading ==========
async function loadPlaylist() {
  setPlayerStatus('Loading playlist...');
  try {
    let text;
    let usedUrl = PLAYLIST_URL;

    // Simple fetch without mirror for brevity (you can add mirror logic)
    const res = await fetch(PLAYLIST_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();

    channels = parseM3U(text);
    buildUI();
    setPlayerStatus(`Loaded ${channels.length} channels`);
  } catch (err) {
    console.error(err);
    setPlayerStatus(`Load failed: ${err.message}`);
  }
}

// ========== Event Listeners ==========
backButton.addEventListener('click', exitPlayer);

video.addEventListener('playing', () => setPlayerStatus('Playing'));
video.addEventListener('pause', () => setPlayerStatus('Paused'));
video.addEventListener('waiting', () => setPlayerStatus('Buffering...'));
video.addEventListener('error', () => setPlayerStatus('Playback error'));

// Remote / keyboard navigation
window.addEventListener('keydown', (e) => {
  const key = e.key;
  const code = e.keyCode;

  // If player is visible, handle back and media keys
  if (!playerView.classList.contains('hidden')) {
    if (key === 'Escape' || key === 'Back' || key === 'MediaStop' || code === 413) {
      exitPlayer();
      e.preventDefault();
      return;
    }
    // Media keys control video
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
      setPlayerStatus('Stopped');
      e.preventDefault();
      return;
    }
    return; // ignore other keys in player
  }

  // Browse view navigation
  if (key === 'ArrowUp') {
    moveFocus(0, -1);
    e.preventDefault();
    return;
  }
  if (key === 'ArrowDown') {
    moveFocus(0, 1);
    e.preventDefault();
    return;
  }
  if (key === 'ArrowLeft') {
    moveFocus(-1, 0);
    e.preventDefault();
    return;
  }
  if (key === 'ArrowRight') {
    moveFocus(1, 0);
    e.preventDefault();
    return;
  }
  if (key === 'Enter') {
    // Play the focused tile
    const focusedTile = document.querySelector('.tile.focused');
    if (focusedTile) {
      const channelData = focusedTile.dataset.channel;
      if (channelData) {
        playChannel(JSON.parse(channelData));
      }
    }
    e.preventDefault();
    return;
  }

  // Green key reloads playlist
  if (key === 'ColorF1Green' || code === 404) {
    loadPlaylist();
    e.preventDefault();
    return;
  }
});

// Initial load
loadPlaylist();