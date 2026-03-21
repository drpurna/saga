// ================================================================
// IPTV v1.0.2 — app.js with HLS.js integration
// Based on original working structure.
// Changes over original:
//   - XHR instead of fetch (more reliable on Tizen)
//   - Default playlists list with cycle button
//   - focusArea tracks 'url'/'search' to fix input trap
//   - Escape/Back key always returns focus to list
//   - Double-click video = fullscreen toggle
//   - countBadge, nowGroup filled in
//   - HLS.js integration for better streaming reliability
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

// HLS.js instance reference
let hls = null;
let currentHlsUrl = null;

// ── Default playlists ──
const DEFAULT_PLAYLISTS = [
  { name: 'Telugu',  url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'Hindi',   url: 'https://iptv-org.github.io/iptv/languages/hin.m3u' },
  { name: 'English', url: 'https://iptv-org.github.io/iptv/languages/eng.m3u' },
  { name: 'Kids',    url: 'https://iptv-org.github.io/iptv/categories/kids.m3u' },
  { name: 'News',    url: 'https://iptv-org.github.io/iptv/categories/news.m3u' },
  { name: 'Sports',  url: 'https://iptv-org.github.io/iptv/categories/sports.m3u' },
  { name: 'Movies',  url: 'https://iptv-org.github.io/iptv/categories/movies.m3u' },
];

let channels      = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list'; // 'list' | 'url' | 'search' | 'player'
let plIdx         = 0;
let isFullscreen  = false;
let lastTap       = 0;

// HLS.js configuration optimized for Tizen TVs
const HLS_CONFIG = {
    enableWorker: true,                    // Use Web Worker for better performance
    lowLatencyMode: true,                  // Reduce latency for live streams
    maxBufferLength: 30,                   // Maximum buffer length in seconds
    maxMaxBufferLength: 600,               // Maximum max buffer length
    backBufferLength: 60,                  // Keep 60 seconds of back buffer
    liveBackBufferLength: 60,              // Live stream back buffer
    maxBufferSize: 60 * 1000 * 1000,       // 60MB max buffer size
    maxBufferHole: 0.5,                    // Maximum buffer hole in seconds
    maxFragLookUpTolerance: 0.25,          // Fragment lookup tolerance
    
    // ABR (Adaptive Bitrate) settings
    abrEwmaFastLive: 3,                    // Fast EWMA for live
    abrEwmaSlowLive: 9,                    // Slow EWMA for live
    abrEwmaFastVoD: 3,                     // Fast EWMA for VOD
    abrEwmaSlowVoD: 9,                     // Slow EWMA for VOD
    abrEwmaDefaultEstimate: 5e5,           // 500kbps default
    abrBandWidthFactor: 0.95,              // Bandwidth factor
    abrBandWidthUpFactor: 0.7,             // Bandwidth up factor
    
    // Load policies for Tizen network stability
    manifestLoadPolicy: {
        default: {
            maxTimeToFirstByteMs: 10000,    // 10 seconds
            maxLoadTimeMs: 20000,           // 20 seconds
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 1, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
        }
    },
    playlistLoadPolicy: {
        default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 20000,
            timeoutRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
        }
    },
    fragLoadPolicy: {
        default: {
            maxTimeToFirstByteMs: 10000,
            maxLoadTimeMs: 120000,           // 2 minutes for fragments
            timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
            errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 }
        }
    },
    
    // Tizen TV specific
    capLevelToPlayerSize: true,              // Cap quality to video element size
    capLevelOnFPSDrop: true,                 // Reduce quality on FPS drop
    stretchShortVideoTrack: true,            // Stretch video to fill
    enableSoftwareAES: true,                 // Software AES decryption
    progressive: false,                      // Disable progressive for better compatibility
    
    // Debug (disable in production)
    debug: false
};

// ── Restore last used playlist ──
const STORAGE_KEY = 'iptv:lastPlaylist';
const savedUrl = (() => { try { return localStorage.getItem(STORAGE_KEY) || ''; } catch(e) { return ''; } })();
playlistUrlEl.value = savedUrl || DEFAULT_PLAYLISTS[0].url;

// ─────────────────────────────────────────────
// HLS.js Management
// ─────────────────────────────────────────────
function initHls() {
    if (hls) {
        try {
            hls.destroy();
        } catch(e) {
            console.error('Error destroying HLS instance:', e);
        }
        hls = null;
    }
    
    if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls(HLS_CONFIG);
        setupHlsEvents();
        return true;
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        // Native HLS support (some Tizen models)
        return 'native';
    }
    return false;
}

function setupHlsEvents() {
    if (!hls) return;
    
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
        console.log('HLS manifest parsed');
        setStatus('Playing');
        
        // Get available quality levels
        if (hls.levels && hls.levels.length > 1) {
            console.log(`Available qualities: ${hls.levels.length}`);
            // Start with auto quality
            hls.currentLevel = -1;
        }
        
        video.play().catch(err => {
            console.error('Play error:', err);
            setStatus(`Play error: ${err.message}`);
        });
    });
    
    hls.on(window.Hls.Events.MANIFEST_LOADING, () => {
        setStatus('Loading manifest...');
    });
    
    hls.on(window.Hls.Events.MANIFEST_LOADED, (event, data) => {
        console.log('Manifest loaded, duration:', data.totalduration);
    });
    
    hls.on(window.Hls.Events.LEVEL_LOADED, (event, data) => {
        console.log(`Level ${data.level} loaded, details:`, data.details);
    });
    
    hls.on(window.Hls.Events.BUFFER_APPENDING, () => {
        setStatus('Buffering...');
    });
    
    hls.on(window.Hls.Events.BUFFER_APPENDED, () => {
        if (video.paused && video.readyState >= 2) {
            setStatus('Ready');
        }
    });
    
    hls.on(window.Hls.Events.FRAG_LOADED, (event, data) => {
        console.log(`Fragment loaded: ${data.frag.sn}`);
    });
    
    hls.on(window.Hls.Events.LEVEL_SWITCHING, (event, data) => {
        console.log(`Switching to level ${data.level}`);
        const level = hls.levels[data.level];
        if (level) {
            setStatus(`Quality: ${level.height}p`);
        }
    });
    
    hls.on(window.Hls.Events.ERROR, (event, data) => {
        console.error('HLS Error:', data);
        
        if (data.fatal) {
            switch (data.type) {
                case window.Hls.ErrorTypes.NETWORK_ERROR:
                    setStatus('Network error, retrying...');
                    console.log('Network error, attempting recovery');
                    hls.startLoad();
                    break;
                case window.Hls.ErrorTypes.MEDIA_ERROR:
                    setStatus('Media error, recovering...');
                    console.log('Media error, attempting recovery');
                    hls.recoverMediaError();
                    break;
                default:
                    setStatus(`Fatal error: ${data.type}`);
                    console.error('Fatal error, destroying player');
                    destroyHls();
                    break;
            }
        } else {
            // Non-fatal error
            const detail = data.details || 'unknown';
            setStatus(`Stream issue: ${detail}`);
            console.warn('Non-fatal error:', detail);
        }
    });
}

function destroyHls() {
    if (hls) {
        try {
            hls.destroy();
        } catch(e) {
            console.error('Error destroying HLS:', e);
        }
        hls = null;
    }
    currentHlsUrl = null;
}

function playHlsStream(url) {
    destroyHls();
    
    const hlsSupported = initHls();
    
    if (hlsSupported === true) {
        // Use HLS.js
        hls.loadSource(url);
        hls.attachMedia(video);
        currentHlsUrl = url;
        setStatus('Loading HLS stream...');
    } else if (hlsSupported === 'native') {
        // Use native HLS support
        video.src = url;
        video.play().catch(err => {
            console.error('Native play error:', err);
            setStatus(`Play error: ${err.message}`);
        });
        setStatus('Playing (native HLS)');
    } else {
        setStatus('HLS not supported on this device');
        console.error('HLS not supported');
    }
}

// ─────────────────────────────────────────────
// STATUS
// ─────────────────────────────────────────────
function setStatus(text) {
    statusTextEl.textContent = text;
    console.log(`[STATUS] ${text}`);
}

// ─────────────────────────────────────────────
// M3U PARSER  (original — untouched)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// RENDER LIST  (original logic, adds countBadge)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// SEARCH  (original)
// ─────────────────────────────────────────────
function applySearch() {
    const q = searchInput.value.trim().toLowerCase();
    filtered = !q
        ? [...channels]
        : channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));

    if (selectedIndex >= filtered.length) selectedIndex = Math.max(0, filtered.length - 1);
    renderList();
}

// ─────────────────────────────────────────────
// FETCH — XHR (replaces fetch+AbortController
// which is unreliable on some Tizen firmware)
// ─────────────────────────────────────────────
function xhrFetch(url, timeoutMs, callback) {
    let done  = false;
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

// ─────────────────────────────────────────────
// LOAD PLAYLIST
// ─────────────────────────────────────────────
function loadPlaylist(urlOverride) {
    const url = (urlOverride || playlistUrlEl.value).trim();
    if (!url) { setStatus('Enter a playlist URL'); return; }

    playlistUrlEl.value = url;
    setStatus('Loading playlist...');
    loadBtn.disabled = true;

    xhrFetch(url, 20000, (err, text) => {
        if (err) {
            // Try jsDelivr mirror for GitHub raw URLs
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
    channels      = parseM3U(text);
    filtered      = [...channels];
    selectedIndex = 0;
    renderList();
    try { localStorage.setItem(STORAGE_KEY, url); } catch (_) {}
    setStatus(`Loaded ${channels.length} channels`);
    // Return focus to list after loading
    setFocusArea('list');
}

// ─────────────────────────────────────────────
// PLAYBACK with HLS.js
// ─────────────────────────────────────────────
function playSelected() {
    if (!filtered.length) return;
    const ch = filtered[selectedIndex];
    if (!ch) return;

    nowPlayingEl.textContent = ch.name;
    nowGroupEl.textContent   = ch.group || '';
    setStatus(`Loading: ${ch.name}`);

    try {
        const url = ch.url;
        const isHls = /\.m3u8($|\?)/i.test(url) || url.toLowerCase().includes('m3u8');

        if (isHls) {
            // Use HLS.js for HLS streams
            playHlsStream(url);
        } else {
            // Direct streams (MP4, etc.)
            destroyHls();
            video.src = url;
            video.play().catch(err => {
                console.error('Direct play error:', err);
                setStatus(`Play error: ${err.message}`);
            });
            setStatus('Playing direct stream');
        }
    } catch (err) {
        setStatus(`Play error: ${err.message}`);
        console.error('Playback error:', err);
    }
}

// ─────────────────────────────────────────────
// Quality Management (for HLS streams)
// ─────────────────────────────────────────────
function getAvailableQualities() {
    if (!hls || !hls.levels) return [];
    
    return hls.levels.map((level, index) => ({
        index: index,
        bitrate: level.bitrate,
        width: level.width,
        height: level.height,
        name: level.name || `${level.height}p`,
        isCurrent: hls.currentLevel === index
    }));
}

function setQuality(levelIndex) {
    if (hls && levelIndex >= -1 && levelIndex < hls.levels.length) {
        hls.currentLevel = levelIndex;
        const level = hls.levels[levelIndex];
        setStatus(levelIndex === -1 ? 'Auto quality' : `Quality: ${level.height}p`);
    }
}

function cycleQuality() {
    if (!hls || !hls.levels || hls.levels.length <= 1) return;
    
    let nextLevel = (hls.currentLevel + 1) % (hls.levels.length + 1) - 1;
    if (nextLevel < -1) nextLevel = -1;
    setQuality(nextLevel);
}

// ─────────────────────────────────────────────
// SELECTION NAV  (original)
// ─────────────────────────────────────────────
function moveSelection(delta) {
    if (!filtered.length) return;
    selectedIndex += delta;
    if (selectedIndex < 0) selectedIndex = 0;
    if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1;
    renderList();
}

// ─────────────────────────────────────────────
// FOCUS AREA HELPER
// ─────────────────────────────────────────────
function setFocusArea(area) {
    focusArea = area;
    if (area === 'url') {
        playlistUrlEl.focus();
    } else if (area === 'search') {
        searchInput.focus();
    } else {
        // blur any active input so arrow keys work on the list
        if (document.activeElement && document.activeElement.tagName === 'INPUT') {
            document.activeElement.blur();
        }
    }
}

// ─────────────────────────────────────────────
// FULLSCREEN
// ─────────────────────────────────────────────
function enterFullscreen() {
    const el = videoWrap;
    const fn = el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen;
    if (fn) { fn.call(el); return; }
    // CSS fallback for Tizen
    document.body.classList.add('fullscreen');
    isFullscreen = true;
}

function exitFullscreen() {
    const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
    if (fn) { fn.call(document); return; }
    document.body.classList.remove('fullscreen');
    isFullscreen = false;
}

function toggleFullscreen() {
    isFullscreen ? exitFullscreen() : enterFullscreen();
}

document.addEventListener('fullscreenchange', () => {
    isFullscreen = !!(document.fullscreenElement || document.webkitFullscreenElement);
    if (!isFullscreen) document.body.classList.remove('fullscreen');
});
document.addEventListener('webkitfullscreenchange', () => {
    isFullscreen = !!(document.webkitFullscreenElement || document.fullscreenElement);
    if (!isFullscreen) document.body.classList.remove('fullscreen');
});

// Double-click / double-tap video = fullscreen
video.addEventListener('dblclick', toggleFullscreen);
video.addEventListener('click', () => {
    const now = Date.now();
    if (now - lastTap < 400) toggleFullscreen();
    lastTap = now;
});

// ─────────────────────────────────────────────
// VIDEO EVENTS
// ─────────────────────────────────────────────
video.addEventListener('playing', () => setStatus('Playing'));
video.addEventListener('pause',   () => setStatus('Paused'));
video.addEventListener('waiting', () => setStatus('Buffering...'));
video.addEventListener('stalled', () => setStatus('Buffering...'));
video.addEventListener('error',   (e) => {
    console.error('Video error:', e);
    setStatus('Playback error');
});

// ─────────────────────────────────────────────
// BUTTON EVENTS
// ─────────────────────────────────────────────
loadBtn.addEventListener('click', () => {
    loadPlaylist();
});

defaultBtn.addEventListener('click', () => {
    plIdx = (plIdx + 1) % DEFAULT_PLAYLISTS.length;
    const pl = DEFAULT_PLAYLISTS[plIdx];
    defaultBtn.textContent  = pl.name;
    playlistUrlEl.value     = pl.url;
    loadPlaylist(pl.url);
});

searchInput.addEventListener('input', applySearch);

// ─────────────────────────────────────────────
// TIZEN KEY REGISTRATION
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// KEYDOWN — Enhanced with HLS controls
// ─────────────────────────────────────────────
window.addEventListener('keydown', (e) => {
    const key  = e.key;
    const code = e.keyCode;

    // ── Escape / Back: always return to list ──
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

    // ── While an input has focus, let it type; only intercept Enter ──
    if (focusArea === 'url' || focusArea === 'search') {
        if (key === 'Enter' || code === 13) {
            if (focusArea === 'url') loadPlaylist();
            setFocusArea('list');
            e.preventDefault();
        }
        return; // all other keys: let input handle
    }

    // ── Arrows ──
    if (key === 'ArrowUp' || code === 38) {
        if (focusArea === 'list') moveSelection(-1);
        e.preventDefault(); return;
    }
    if (key === 'ArrowDown' || code === 40) {
        if (focusArea === 'list') moveSelection(1);
        e.preventDefault(); return;
    }
    if (key === 'ArrowLeft' || code === 37) {
        if (isFullscreen) exitFullscreen();
        else setFocusArea('list');
        e.preventDefault(); return;
    }
    if (key === 'ArrowRight' || code === 39) {
        focusArea = 'player';
        e.preventDefault(); return;
    }

    // ── Enter ──
    if (key === 'Enter' || code === 13) {
        if (focusArea === 'list')   playSelected();
        if (focusArea === 'player') toggleFullscreen();
        e.preventDefault(); return;
    }

    // ── Page jump ──
    if (key === 'PageUp')   { moveSelection(-10); e.preventDefault(); return; }
    if (key === 'PageDown') { moveSelection(10);  e.preventDefault(); return; }

    // ── Media keys ──
    if (key === 'MediaPlayPause' || code === 10252) {
        video.paused ? video.play().catch(() => {}) : video.pause();
        e.preventDefault(); return;
    }
    if (key === 'MediaPlay' || code === 415) {
        video.play().catch(() => {}); e.preventDefault(); return;
    }
    if (key === 'MediaPause' || code === 19) {
        video.pause(); e.preventDefault(); return;
    }
    if (key === 'MediaStop' || code === 413) {
        destroyHls();
        video.pause();
        video.removeAttribute('src');
        video.load();
        setStatus('Stopped');
        e.preventDefault(); return;
    }
    if (key === 'MediaFastForward' || code === 417) {
        moveSelection(1); playSelected(); e.preventDefault(); return;
    }
    if (key === 'MediaRewind' || code === 412) {
        moveSelection(-1); playSelected(); e.preventDefault(); return;
    }
    if (key === 'ChannelUp'   || code === 427) { moveSelection(1);  playSelected(); e.preventDefault(); return; }
    if (key === 'ChannelDown' || code === 428) { moveSelection(-1); playSelected(); e.preventDefault(); return; }

    // ── Colour buttons ──
    if (key === 'ColorF0Red'    || code === 403) { setFocusArea('url');    e.preventDefault(); return; }
    if (key === 'ColorF1Green'  || code === 404) { loadPlaylist();         e.preventDefault(); return; }
    if (key === 'ColorF2Yellow' || code === 405) { setFocusArea('search'); e.preventDefault(); return; }
    if (key === 'ColorF3Blue'   || code === 406) { defaultBtn.click();     e.preventDefault(); return; }
    
    // ── Extra: 'Q' key to cycle quality (for debugging) ──
    if (key === 'q' || key === 'Q') {
        cycleQuality();
        e.preventDefault(); return;
    }
});

// ─────────────────────────────────────────────
// INIT — load last/default playlist on start
// ─────────────────────────────────────────────
// Check if HLS.js is available
if (typeof window.Hls === 'undefined') {
    console.error('HLS.js not loaded!');
    setStatus('HLS.js not available');
} else {
    console.log('HLS.js version:', window.Hls.version);
    setStatus('Ready');
}

loadPlaylist(playlistUrlEl.value);
