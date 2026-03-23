// ================================================================
// IPTV PRO — app.js v2.0
// TizenBrew / Samsung TV - with local HLS.js
// ================================================================

/* ── Verify HLS.js loaded locally ─────────────────────────── */
(function checkHLS() {
  if (window.Hls) {
    console.log('[IPTV Pro] HLS.js loaded successfully from local file');
    console.log('[IPTV Pro] HLS.js version:', window.Hls.version);
  } else {
    console.error('[IPTV Pro] HLS.js failed to load from local file');
  }
})();

/* ── DOM Elements ─────────────────────────────────────────── */
const searchInput   = document.getElementById('searchInput');
const tabBar        = document.getElementById('tabBar');
const channelListEl = document.getElementById('channelList');
const countBadge    = document.getElementById('countBadge');
const nowPlayingEl  = document.getElementById('nowPlaying');
const nowGroupEl    = document.getElementById('nowGroup');
const statusBadge   = document.getElementById('statusBadge');
const video         = document.getElementById('video');
const videoWrap     = document.getElementById('videoWrap');
const videoOverlay  = document.getElementById('videoOverlay');
const fsHint        = document.getElementById('fsHint');
const loadBar       = document.getElementById('loadBar');

/* ── Playlists ───────────────────────────────────────────── */
const PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
  { name: 'Sports', url: 'https://iptv-org.github.io/iptv/categories/sports.m3u' },
  { name: 'Movies', url: 'https://iptv-org.github.io/iptv/categories/movies.m3u' },
];

/* ── HLS config — tuned for Tizen ───────────────────────── */
const HLS_CONFIG = {
  enableWorker:             false,   // Tizen: no Web Worker support
  lowLatencyMode:           false,
  backBufferLength:         30,
  maxBufferLength:          60,
  maxMaxBufferLength:       120,
  maxBufferSize:            60 * 1000 * 1000,
  maxBufferHole:            0.5,
  nudgeMaxRetry:            5,
  startLevel:               -1,     // auto quality
  abrEwmaDefaultEstimate:   1500000,
  manifestLoadingMaxRetry:  4,
  manifestLoadingRetryDelay:500,
  levelLoadingMaxRetry:     4,
  levelLoadingRetryDelay:   500,
  fragLoadingMaxRetry:      6,
  fragLoadingRetryDelay:    500,
  xhrSetup: function(xhr) { 
    xhr.timeout = 15000; 
  },
};

/* ── State ───────────────────────────────────────────────── */
let channels      = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list';
let hls           = null;
let plIdx         = 0;
let isFullscreen  = false;
let hasPlayed     = false;
let fsHintTimer   = null;
let loadBarTimer  = null;

const STORAGE_KEY = 'iptv:lastPl';
try { 
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) plIdx = Math.min(parseInt(saved, 10) || 0, PLAYLISTS.length - 1);
} catch(_) {}

/* ── Status ──────────────────────────────────────────────── */
function setStatus(text, cls) {
  statusBadge.textContent = text;
  statusBadge.className   = 'status-badge ' + (cls || 'idle');
}

/* ── Load bar ────────────────────────────────────────────── */
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

/* ── M3U parser (tvg-logo support) ──────────────────────── */
function parseM3U(text) {
  const lines = text.split(/\r?\n/);
  const out   = [];
  let meta    = null;
  
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    
    if (line.startsWith('#EXTINF')) {
      const namePart   = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const groupMatch = line.match(/group-title="([^"]+)"/i);
      const logoMatch  = line.match(/tvg-logo="([^"]+)"/i);
      meta = {
        name:  namePart || 'Unknown',
        group: groupMatch ? groupMatch[1] : 'Other',
        logo:  logoMatch  ? logoMatch[1]  : '',
      };
      continue;
    }
    
    if (!line.startsWith('#') && meta) {
      out.push({ 
        name: meta.name, 
        group: meta.group, 
        logo: meta.logo, 
        url: line 
      });
      meta = null;
    }
  }
  return out;
}

/* ── HTML escape ─────────────────────────────────────────── */
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/* ── Logo HTML ───────────────────────────────────────────── */
function logoHtml(ch) {
  const initials = esc(ch.name.replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).slice(0,2).map(w => w[0] || '').join('').toUpperCase() || '?');
  
  if (ch.logo) {
    return `<div class="ch-logo">
      <img src="${esc(ch.logo)}" alt="" loading="lazy"
           onerror="this.style.display='none';this.nextSibling.style.display='flex'"
           onload="this.nextSibling.style.display='none'">
      <span class="ch-logo-fb" style="display:none">${initials}</span>
    </div>`;
  }
  return `<div class="ch-logo"><span class="ch-logo-fb">${initials}</span></div>`;
}

/* ── Render channel list ─────────────────────────────────── */
function renderList() {
  channelListEl.innerHTML = '';
  countBadge.textContent  = filtered.length;
  
  if (!filtered.length) {
    const li = document.createElement('li');
    li.innerHTML = '<div class="ch-info"><div class="ch-name" style="color:#333">No channels</div></div>';
    channelListEl.appendChild(li);
    return;
  }
  
  const frag = document.createDocumentFragment();
  filtered.forEach((ch, idx) => {
    const li = document.createElement('li');
    if (idx === selectedIndex) li.classList.add('active');
    li.innerHTML = logoHtml(ch) +
      `<div class="ch-info">
         <div class="ch-name">${esc(ch.name)}</div>
         <div class="ch-group">${esc(ch.group)}</div>
       </div>
       <div class="ch-num">${idx + 1}</div>`;
    li.addEventListener('click', () => { 
      selectedIndex = idx; 
      renderList(); 
      playSelected(); 
    });
    frag.appendChild(li);
  });
  channelListEl.appendChild(frag);
  
  const active = channelListEl.querySelector('li.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

/* ── Search ──────────────────────────────────────────────── */
function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  filtered = !q
    ? [...channels]
    : channels.filter(c => c.name.toLowerCase().includes(q) || c.group.toLowerCase().includes(q));
  selectedIndex = 0;
  renderList();
}

/* ── XHR fetch (Tizen-safe) ──────────────────────────────── */
function xhrFetch(url, timeoutMs, cb) {
  let done = false;
  const xhr = new XMLHttpRequest();
  const tid = setTimeout(() => {
    if (done) return; 
    done = true; 
    xhr.abort(); 
    cb(new Error('Timeout'), null);
  }, timeoutMs);
  
  xhr.onreadystatechange = function() {
    if (xhr.readyState !== 4 || done) return;
    done = true; 
    clearTimeout(tid);
    if (xhr.status >= 200 && xhr.status < 400) cb(null, xhr.responseText);
    else cb(new Error('HTTP ' + xhr.status), null);
  };
  
  xhr.onerror = function() {
    if (done) return; 
    done = true; 
    clearTimeout(tid); 
    cb(new Error('Network error'), null);
  };
  
  xhr.open('GET', url, true);
  xhr.send();
}

function githubMirror(url) {
  try {
    const u = new URL(url);
    if (u.hostname !== 'raw.githubusercontent.com') return null;
    const p = u.pathname.split('/').filter(Boolean);
    if (p.length < 4) return null;
    return `https://cdn.jsdelivr.net/gh/${p[0]}/${p[1]}@${p[2]}/${p.slice(3).join('/')}`;
  } catch(_) { 
    return null; 
  }
}

/* ── Load playlist ───────────────────────────────────────── */
function loadPlaylist(urlOverride) {
  const url = urlOverride || PLAYLISTS[plIdx].url;
  setStatus('Loading...', 'loading');
  startLoadBar();
  
  xhrFetch(url, 25000, (err, text) => {
    if (err) {
      const mirror = githubMirror(url);
      if (mirror) {
        setStatus('Retrying...', 'loading');
        xhrFetch(mirror, 25000, (err2, text2) => {
          finishLoadBar();
          if (err2) { 
            setStatus('Failed', 'error'); 
            return; 
          }
          onLoaded(text2);
        });
      } else {
        finishLoadBar();
        setStatus('Failed', 'error');
      }
      return;
    }
    finishLoadBar();
    onLoaded(text);
  });
}

function onLoaded(text) {
  channels      = parseM3U(text);
  filtered      = [...channels];
  selectedIndex = 0;
  renderList();
  
  try { 
    localStorage.setItem(STORAGE_KEY, String(plIdx)); 
  } catch(_) {}
  
  setStatus('Ready ' + channels.length + ' channels', 'idle');
  setFocus('list');
}

/* ── Playback ────────────────────────────────────────────── */
function playSelected() {
  if (!filtered.length) return;
  const ch = filtered[selectedIndex];
  if (!ch) return;

  nowPlayingEl.textContent = ch.name;
  nowGroupEl.textContent   = ch.group || '';
  videoOverlay.classList.add('hidden');
  hasPlayed = true;
  setStatus('Buffering...', 'loading');
  startLoadBar();

  try {
    if (hls) { 
      hls.destroy(); 
      hls = null; 
    }
    video.removeAttribute('src');
    video.load();

    const url   = ch.url;
    const isHLS = /\.m3u8($|\?)/i.test(url) || url.toLowerCase().includes('m3u8');

    if (isHLS) {
      if (video.canPlayType('application/vnd.apple.mpegurl') && !window.Hls) {
        video.src = url;
        video.play().catch(() => {});
        return;
      }
      
      if (window.Hls && window.Hls.isSupported()) {
        hls = new window.Hls(HLS_CONFIG);
        hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
          video.play().catch(() => {});
        });
        hls.on(window.Hls.Events.ERROR, (_, data) => {
          if (!data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
            setStatus('Net error', 'error'); 
            hls.startLoad();
          } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
            setStatus('Recovering...', 'loading'); 
            hls.recoverMediaError();
          } else {
            setStatus('Stream error', 'error'); 
            finishLoadBar();
            hls.destroy(); 
            hls = null;
          }
        });
        hls.loadSource(url);
        hls.attachMedia(video);
        return;
      }
      setStatus('HLS not supported', 'error');
      return;
    }

    video.src = url;
    video.play().catch(() => {});
  } catch(err) {
    finishLoadBar();
    setStatus('Play error', 'error');
  }
}

/* ── Navigation ──────────────────────────────────────────── */
function moveSelection(delta) {
  if (!filtered.length) return;
  selectedIndex = Math.max(0, Math.min(filtered.length - 1, selectedIndex + delta));
  renderList();
}

function setFocus(area) {
  focusArea = area;
  if (area === 'search') {
    searchInput.focus();
  } else {
    if (document.activeElement === searchInput) searchInput.blur();
  }
}

/* ── Tab switching ───────────────────────────────────────── */
function switchTab(idx) {
  plIdx = idx;
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === idx));
  loadPlaylist();
}

tabBar.querySelectorAll('.tab').forEach((btn, i) => btn.addEventListener('click', () => switchTab(i)));

/* ── Fullscreen ──────────────────────────────────────────── */
function showFsHint() {
  clearTimeout(fsHintTimer);
  fsHint.classList.add('visible');
  fsHintTimer = setTimeout(() => fsHint.classList.remove('visible'), 3000);
}

function enterFullscreen() {
  const fn = videoWrap.requestFullscreen || videoWrap.webkitRequestFullscreen || videoWrap.mozRequestFullScreen;
  if (fn) { 
    try { 
      fn.call(videoWrap); 
    } catch(_) {} 
  }
  document.body.classList.add('fullscreen');
  isFullscreen = true;
  showFsHint();
}

function exitFullscreen() {
  const fn = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
  if (fn) { 
    try { 
      fn.call(document); 
    } catch(_) {} 
  }
  document.body.classList.remove('fullscreen');
  isFullscreen = false;
  fsHint.classList.remove('visible');
}

function toggleFullscreen() { 
  isFullscreen ? exitFullscreen() : enterFullscreen(); 
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

video.addEventListener('dblclick', toggleFullscreen);

/* ── Video events ────────────────────────────────────────── */
video.addEventListener('playing', () => { 
  setStatus('Playing', 'playing'); 
  finishLoadBar(); 
});
video.addEventListener('pause',   () => setStatus('Paused', 'paused'));
video.addEventListener('waiting', () => { 
  setStatus('Buffering...', 'loading'); 
  startLoadBar(); 
});
video.addEventListener('stalled', () => setStatus('Buffering...', 'loading'));
video.addEventListener('error',   () => { 
  setStatus('Error', 'error'); 
  finishLoadBar(); 
});

/* ── Tizen key registration ──────────────────────────────── */
(function registerKeys() {
  try {
    if (window.tizen && tizen.tvinputdevice) {
      [
        'MediaPlay','MediaPause','MediaPlayPause','MediaStop',
        'MediaFastForward','MediaRewind',
        'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
        'ChannelUp','ChannelDown','Back',
      ].forEach(k => { 
        try { 
          tizen.tvinputdevice.registerKey(k); 
        } catch(_) {} 
      });
    }
  } catch(_) {}
})();

/* ── Keyboard handler ────────────────────────────────────── */
window.addEventListener('keydown', (e) => {
  const key  = e.key;
  const code = e.keyCode;

  // Back / Escape
  if (key === 'Escape' || key === 'Back' || key === 'GoBack' || code === 10009 || code === 27) {
    if (isFullscreen) { 
      exitFullscreen(); 
      e.preventDefault(); 
      return; 
    }
    if (focusArea === 'search') {
      searchInput.value = '';
      applySearch();
      setFocus('list');
      e.preventDefault(); 
      return;
    }
    try { 
      if (window.tizen) tizen.application.getCurrentApplication().exit(); 
    } catch(_) {}
    e.preventDefault(); 
    return;
  }

  // Search input active — let typing through, intercept Enter only
  if (focusArea === 'search') {
    if (key === 'Enter' || code === 13) { 
      setFocus('list'); 
      e.preventDefault(); 
    }
    return;
  }

  // Arrow keys
  if (key === 'ArrowUp'   || code === 38) { 
    if (isFullscreen) { 
      showFsHint(); 
    } else { 
      moveSelection(-1); 
    } 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ArrowDown' || code === 40) { 
    if (isFullscreen) { 
      showFsHint(); 
    } else { 
      moveSelection(1);  
    } 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ArrowLeft' || code === 37) { 
    if (isFullscreen) { 
      exitFullscreen(); 
    } else { 
      setFocus('list'); 
    } 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ArrowRight'|| code === 39) { 
    if (!isFullscreen && hasPlayed) { 
      enterFullscreen(); 
    } 
    e.preventDefault(); 
    return; 
  }

  // Enter — play + auto fullscreen
  if (key === 'Enter' || code === 13) {
    if (isFullscreen) { 
      exitFullscreen(); 
      e.preventDefault(); 
      return; 
    }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(() => { 
        if (hasPlayed) enterFullscreen(); 
      }, 600);
    }
    e.preventDefault(); 
    return;
  }

  if (key === 'PageUp')   { 
    moveSelection(-10); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'PageDown') { 
    moveSelection(10);  
    e.preventDefault(); 
    return; 
  }

  // Media keys
  if (key === 'MediaPlayPause' || code === 10252) { 
    video.paused ? video.play().catch(() => {}) : video.pause(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'MediaPlay'      || code === 415)   { 
    video.play().catch(() => {}); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'MediaPause'     || code === 19)    { 
    video.pause(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'MediaStop'      || code === 413)   {
    if (hls) { 
      hls.destroy(); 
      hls = null; 
    }
    video.pause(); 
    video.removeAttribute('src'); 
    video.load();
    setStatus('Stopped', 'idle'); 
    finishLoadBar();
    e.preventDefault(); 
    return;
  }
  if (key === 'MediaFastForward' || code === 417) { 
    moveSelection(1);  
    playSelected(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'MediaRewind'      || code === 412) { 
    moveSelection(-1); 
    playSelected(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ChannelUp'        || code === 427) { 
    moveSelection(1);  
    playSelected(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ChannelDown'      || code === 428) { 
    moveSelection(-1); 
    playSelected(); 
    e.preventDefault(); 
    return; 
  }

  // Color buttons
  if (key === 'ColorF0Red'    || code === 403) { 
    loadPlaylist(); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ColorF1Green'  || code === 404) { 
    switchTab((plIdx + 1) % PLAYLISTS.length); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ColorF2Yellow' || code === 405) { 
    setFocus('search'); 
    e.preventDefault(); 
    return; 
  }
  if (key === 'ColorF3Blue'   || code === 406) { 
    if (hasPlayed) toggleFullscreen(); 
    e.preventDefault(); 
    return; 
  }
});

/* ── Init ────────────────────────────────────────────────── */
(function init() {
  document.querySelectorAll('.tab').forEach((t, i) => t.classList.toggle('active', i === plIdx));
  loadPlaylist();
})();