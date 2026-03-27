// ================================================================
// IPTV Pro — app.js v12.5 | Samsung Tizen OS9 TV
// Merged working playlist loading (from reference) with Jio login,
// modal navigation, and red button reload.
// ================================================================

const PROXY = 'https://houser-af7j.onrender.com';
const FAV_KEY = 'iptv:favs';
const PLAYLIST_KEY = 'iptv:lastPl';
const JIO_CRED_KEY = 'iptv:jioCred';
const PREVIEW_DELAY = 700;
const PREFETCH_DELAY = 1000;

const PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India', url: 'https://iptv-org.github.io/iptv/countries/in.m3u' },
];
const FAV_IDX = 2;
const JIO_IDX = 3;

// CORS proxies for Jio API (tried in order)
const PROXY_LIST = [
  url => 'https://corsproxy.io/?url=' + encodeURIComponent(url),
  url => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(url),
];
let proxyIdx = 0;

// Jio API endpoints
const JIO = {
  SEND_OTP:    'https://tv.media.jio.com/apis/v2.0/loginotp/sendotp',
  VERIFY_OTP:  'https://tv.media.jio.com/apis/v2.0/loginotp/verifyotp',
  REFRESH_AT:  'https://auth.media.jio.com/tokenservice/apis/v1/refreshtoken?langId=6',
  REFRESH_SSO: 'https://tv.media.jio.com/apis/v2.0/loginotp/refresh?langId=6',
  CHANNELS:    'https://jiotv.data.cdn.jio.com/apis/v3.0/getMobileChannelList/get/?os=android&devicetype=phone&usertype=tvYR7NSNn7rymo3F',
  STREAM:      'https://jiotvapi.media.jio.com/playback/apis/v1.1/geturl?langId=6',
};

const JIO_CAT = {
  1: 'Entertainment', 2: 'Movies', 3: 'Sports', 4: 'News', 5: 'Music',
  6: 'Kids', 7: 'Lifestyle', 8: 'Education', 9: 'Devotional', 10: 'Infotainment'
};

const AR_MODES = [
  { cls: '', label: 'Fit' },
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
let arManuallySet = false;
let fsHintTimer = null;
let loadBarTimer = null;
let previewTimer = null;
let prefetchTimer = null;
let dialBuffer = '';
let dialTimer = null;
let jioChannels = [];
let jioCred = null;
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

function flushCriticalStorage() {
  try {
    if (jioCred) lsSet(JIO_CRED_KEY, JSON.stringify(jioCred));
    saveFavs();
    const did = lsGet('_did');
    if (did) lsSet('_did', did);
  } catch (e) { console.warn('[flush]', e); }
}

// ================== FAVOURITES ==================
(function loadFavs() {
  try { const r = lsGet(FAV_KEY); if (r) favSet = new Set(JSON.parse(r)); } catch (e) {}
})();

function saveFavs() {
  lsSet(FAV_KEY, JSON.stringify([...favSet]));
}

function favKey(ch) {
  return ch.channelId ? 'jio:' + ch.channelId : (ch.url || '');
}

function isFav(ch) {
  return favSet.has(favKey(ch));
}

function showFavourites() {
  filtered = allChannels.filter(c => favSet.has(favKey(c)));
  selectedIndex = 0;
  renderList();
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

function toggleFav(ch) {
  const k = favKey(ch);
  if (favSet.has(k)) favSet.delete(k);
  else favSet.add(k);
  saveFavs();
  if (plIdx === FAV_IDX) showFavourites();
  VS.refresh();
  showToast(isFav(ch) ? '★ Added' : '✕ Removed');
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

// ================== VIRTUAL SCROLL ==================
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

// ================== SEARCH ==================
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

// ================== XHR WRAPPER (for M3U playlists) ==================
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

// ================== PLAYLIST LOADING (RELIABLE) ==================
function loadPlaylist(urlOv, forceRefresh = false) {
  cancelPreview();

  if (plIdx === FAV_IDX && !urlOv) {
    showFavourites();
    return;
  }

  const url = urlOv || PLAYLISTS[plIdx].url;
  const cacheKey = 'plCache:' + url;
  const cacheTimeKey = 'plCacheTime:' + url;

  if (!forceRefresh) {
    try {
      const cached = lsGet(cacheKey);
      const cacheTime = parseInt(lsGet(cacheTimeKey) || '0', 10);
      if (cached && (Date.now() - cacheTime) < 10 * 60 * 1000) {
        onLoaded(cached, true);
        return;
      }
    } catch (e) {}
  }

  setStatus('Loading…', 'loading');
  startLoadBar();

  xhrFetch(url, 25000, (err, text) => {
    if (err) {
      const m = mirrorUrl(url);
      if (m) {
        setStatus('Retrying…', 'loading');
        xhrFetch(m, 25000, (e2, t2) => {
          finishLoadBar();
          if (e2) setStatus('Failed', 'error');
          else onLoaded(t2, false);
        });
      } else {
        finishLoadBar();
        setStatus('Failed', 'error');
      }
      return;
    }

    lsSet(cacheKey, text);
    lsSet(cacheTimeKey, String(Date.now()));
    finishLoadBar();
    onLoaded(text, false);
  });

  function onLoaded(text, fromCache) {
    channels = parseM3U(text);
    if (!channels.length) {
      setStatus('Playlist empty or invalid', 'error');
      showToast('No channels found in the playlist.');
      filtered = [];
      renderList();
      return;
    }

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

// ================== RELOAD (RED BUTTON) ==================
function reloadCurrentPlaylist() {
  if (plIdx === FAV_IDX) {
    showFavourites();
  } else if (plIdx === JIO_IDX) {
    handleJioTab(true);
  } else {
    loadPlaylist(null, true);
  }
  showToast('Reloading…');
}

// ================== PROXY XHR (for Jio APIs) ==================
function proxyXHR(method, targetUrl, headers, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const attempt = (pIdx, retried) => {
      const proxyUrl = PROXY_LIST[pIdx](targetUrl);
      const xhr = new XMLHttpRequest();
      xhr.timeout = timeoutMs || 20000;
      xhr.open(method, proxyUrl, true);

      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('x-requested-with', 'XMLHttpRequest');

      if (headers) {
        const fwd = Object.keys(headers)
          .filter(k => k !== 'Content-Type')
          .map(k => k + ':' + headers[k]).join(',');
        if (fwd) try { xhr.setRequestHeader('x-cors-headers', fwd); } catch(e) {}
      }

      xhr.onload = function () {
        const raw = xhr.responseText;
        console.log('[Proxy' + pIdx + ']', method, targetUrl.split('/').pop(), '→', xhr.status, raw.slice(0, 200));
        if (xhr.status >= 200 && xhr.status < 400) {
          try { resolve(JSON.parse(raw)); } catch(e) { resolve({ _raw: raw }); }
          return;
        }
        if (!retried && pIdx + 1 < PROXY_LIST.length) {
          console.warn('[Proxy] Switching to proxy ' + (pIdx + 1));
          proxyIdx = pIdx + 1;
          attempt(pIdx + 1, true);
        } else {
          const err = new Error('HTTP ' + xhr.status);
          try { const j = JSON.parse(raw); err.message = j.message || j.result || j.errorMessage || ('HTTP ' + xhr.status); } catch(pe) {}
          reject(err);
        }
      };
      xhr.onerror = function () {
        console.warn('[Proxy' + pIdx + '] Network error');
        if (!retried && pIdx + 1 < PROXY_LIST.length) {
          proxyIdx = pIdx + 1;
          attempt(pIdx + 1, true);
        } else {
          reject(new Error('All proxies failed — check internet'));
        }
      };
      xhr.ontimeout = function () {
        if (!retried && pIdx + 1 < PROXY_LIST.length) {
          proxyIdx = pIdx + 1;
          attempt(pIdx + 1, true);
        } else {
          reject(new Error('Request timed out'));
        }
      };
      xhr.send(body ? JSON.stringify(body) : null);
    };
    attempt(proxyIdx, false);
  });
}

// ================== JIO API HELPERS ==================
function jioHdr(withAuth) {
  const h = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'os': 'android',
    'devicetype': 'phone',
    'versionCode': '315',
    'versionName': '7.0.4',
    'os_version': '13',
    'User-Agent': 'okhttp/4.9.2',
    'appKey': 'NzNiMDhlYzQyNjJm',
    'channelPartnerID': 'JIOTV',
    'cId': 'com.jio.media.jiotv',
    'lId': '6',
    'dm': '1',
  };
  if (withAuth && jioCred) {
    h['authToken'] = jioCred.accessToken || jioCred.ssoToken || '';
    h['ssoToken'] = jioCred.ssoToken || '';
    h['crm'] = jioCred.crm || '';
    h['uniqueId'] = jioCred.uniqueId || '';
  }
  return h;
}

function jioSendOTP(mobile) {
  console.log('[Jio] Sending OTP to', mobile);
  return proxyXHR('POST', JIO.SEND_OTP, jioHdr(false),
    { number: mobile, multipleLogin: true, countryCode: 91 }, 25000
  ).then(data => {
    console.log('[Jio] sendOTP:', JSON.stringify(data));
    if (data.OTPId || data.otpId) return data.OTPId || data.otpId;
    if (data.result && (data.result + '').toLowerCase().includes('sent')) return data.OTPId || '__ok__';
    throw new Error(data.result || data.message || data.errorMessage || 'OTP send failed');
  });
}

function jioVerifyOTP(mobile, otp, otpId) {
  const body = { number: mobile, OTP: String(otp), getClientConfig: 'true' };
  if (otpId && otpId !== '__ok__') body.OTPId = otpId;
  return proxyXHR('POST', JIO.VERIFY_OTP, jioHdr(false), body, 25000)
    .then(data => {
      console.log('[Jio] verifyOTP:', JSON.stringify(data));
      const sso = data.ssoToken || data.authToken || '';
      const acc = data.authToken || data.accessToken || sso || '';
      if (!sso && !acc) throw new Error(data.result || data.message || data.errorMessage || 'Wrong OTP');
      const expiryMin = parseInt(data.tokenExpiryMinutes || data.tokenExpiry || '60', 10) || 60;
      return {
        ssoToken: sso,
        accessToken: acc,
        refreshToken: data.refreshToken || '',
        uniqueId: data.uniqueId || data.unique_id || '',
        subscriberId: data.subscriberId || data.crm || '',
        crm: data.crm || data.subscriberId || '',
        accessTokenExpiry: Date.now() + (expiryMin * 60000),
      };
    });
}

function jioRefreshTokens() {
  if (!jioCred) return Promise.reject(new Error('No credentials'));
  return proxyXHR('POST', JIO.REFRESH_AT, jioHdr(true), { refreshToken: jioCred.refreshToken || '' }, 15000)
    .then(data => {
      const t = data.authToken || data.accessToken;
      if (!t) throw new Error('No token in refresh response');
      jioCred.accessToken = t;
      jioCred.accessTokenExpiry = Date.now() + (60 * 60000);
      jioSaveCred();
      console.log('[Jio] accessToken refreshed');
    })
    .catch(e => {
      console.warn('[Jio] AT refresh failed:', e.message);
      return proxyXHR('POST', JIO.REFRESH_SSO, jioHdr(true), {}, 15000)
        .then(data => {
          const t = data.ssoToken || data.authToken;
          if (!t) throw new Error('Session expired — please log in again');
          jioCred.ssoToken = t;
          jioCred.accessTokenExpiry = Date.now() + (90 * 60000);
          jioSaveCred();
        });
    });
}

function jioGetStreamUrl(channelId) {
  const doRefresh = (jioCred && jioCred.accessTokenExpiry && jioCred.accessTokenExpiry - Date.now() < 300000)
    ? jioRefreshTokens().catch(() => {})
    : Promise.resolve();
  return doRefresh.then(() =>
    proxyXHR('POST', JIO.STREAM, jioHdr(true), { channel_id: String(channelId), liveurl: '1' }, 15000)
  ).then(data => {
    const url = data.result || data.url || data.stream_url || data.streamUrl || '';
    if (!url) throw new Error(data.message || data.errorMessage || 'No stream URL');
    return url;
  });
}

function loadJioChannels() {
  setStatus('Loading Jio channels…', 'loading');
  startLoadBar();
  const doRefresh = (jioCred && jioCred.accessTokenExpiry && jioCred.accessTokenExpiry - Date.now() < 300000)
    ? jioRefreshTokens().catch(() => {})
    : Promise.resolve();
  return doRefresh.then(() =>
    proxyXHR('GET', JIO.CHANNELS, jioHdr(true), null, 30000)
  ).then(data => {
    const list = Array.isArray(data) ? data
      : Array.isArray(data.result) ? data.result
      : Array.isArray(data.channels) ? data.channels : [];
    if (!list.length) throw new Error('Channel list empty');
    jioChannels = list.map(ch => ({
      name: ch.channel_name || ch.channelName || ch.name || 'Unknown',
      logo: ch.logoUrl || ch.logo_url || ch.logo || '',
      channelId: String(ch.channel_id || ch.channelId || ''),
      group: JIO_CAT[ch.channelCategoryId] || JIO_CAT[ch.category_id] || 'Jio TV',
      isHD: !!(ch.isHD || ch.is_hd),
      url: null,
    })).filter(ch => ch.channelId);
    jioChannels.forEach(c => { if (!allChannels.find(x => x.channelId === c.channelId)) allChannels.push(c); });
    channels = jioChannels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    finishLoadBar();
    renderList();
    setFocus('list');
    setStatus('Jio TV · ' + channels.length + ' ch', 'idle');
    return true;
  }).catch(err => {
    finishLoadBar();
    console.error('[Jio] loadChannels:', err);
    setStatus('Jio error: ' + err.message, 'error');
    return false;
  });
}

function jioSaveCred() {
  try { localStorage.setItem(JIO_CRED_KEY, JSON.stringify(jioCred)); } catch(e) {}
}

function jioClearCred() {
  try { localStorage.removeItem(JIO_CRED_KEY); } catch(e) {}
  jioCred = null;
  jioChannels = [];
}

function jioLoadCred() {
  try {
    const raw = localStorage.getItem(JIO_CRED_KEY);
    if (!raw) return null;
    const c = JSON.parse(raw);
    if (!c || (!c.ssoToken && !c.accessToken)) return null;
    return c;
  } catch(e) { return null; }
}

function handleJioTab(forceRefresh = false) {
  if (!forceRefresh && jioChannels.length) {
    channels = jioChannels.slice();
    filtered = channels.slice();
    selectedIndex = 0;
    renderList();
    setStatus('Jio TV · ' + channels.length + ' ch', 'idle');
    setFocus('list');
    return;
  }

  if (jioCred) {
    loadJioChannels().then(ok => { if (!ok) { jioClearCred(); showJioLoginModal(); } });
    return;
  }
  showJioLoginModal();
}

function initJio() {
  try {
    const c = jioLoadCred();
    if (!c) return;
    jioCred = c;
    if (plIdx === JIO_IDX) loadJioChannels();
  } catch(e) { console.warn('[Jio] initJio:', e.message); }
}

// ================== SHAKA PLAYER ==================
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
  arBtn.textContent = '⛶ Fit';
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
  if (idx === JIO_IDX) {
    handleJioTab();
  } else {
    setStatus('Loading…', 'loading');
    loadPlaylist();
  }
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

// ================== MODAL NAVIGATION ==================
let modalFocusableElements = [];
let currentModalFocusIndex = -1;

function getFocusableElements(container) {
  return Array.from(container.querySelectorAll('input, button'));
}

function updateModalFocusable() {
  const modal = document.getElementById('jioModal');
  if (!modal || modal.style.display !== 'flex') return;
  const step1 = document.getElementById('jioLoginStep1');
  const step2 = document.getElementById('jioLoginStep2');
  const visibleContainer = step1.style.display !== 'none' ? step1 : step2;
  modalFocusableElements = getFocusableElements(visibleContainer);
  if (modalFocusableElements.length === 0) return;
  const active = document.activeElement;
  const index = modalFocusableElements.findIndex(el => el === active);
  currentModalFocusIndex = index >= 0 ? index : 0;
  modalFocusableElements[currentModalFocusIndex].focus();
}

function focusModalElement(delta) {
  if (modalFocusableElements.length === 0) return;
  currentModalFocusIndex = (currentModalFocusIndex + delta + modalFocusableElements.length) % modalFocusableElements.length;
  modalFocusableElements[currentModalFocusIndex].focus();
}

// Override enterModal to set up focus management
const originalEnterModal = enterModal;
enterModal = function() {
  originalEnterModal();
  setTimeout(() => { updateModalFocusable(); }, 50);
};

const originalExitModal = exitModal;
exitModal = function() {
  originalExitModal();
  modalFocusableElements = [];
  currentModalFocusIndex = -1;
};

function bindModalEvents() {
  const step1 = document.getElementById('jioLoginStep1');
  const step2 = document.getElementById('jioLoginStep2');
  if (!step1 || !step2) return;

  const observer = new MutationObserver(() => {
    if (step1.style.display === 'none' && step2.style.display === 'block') {
      updateModalFocusable();
    }
  });
  observer.observe(step1, { attributes: true, attributeFilter: ['style'] });
  observer.observe(step2, { attributes: true, attributeFilter: ['style'] });
}

// ================== JIO LOGIN MODAL ==================
function showJioLoginModal() {
  const modal = document.getElementById('jioModal');
  const step1 = document.getElementById('jioLoginStep1');
  const step2 = document.getElementById('jioLoginStep2');
  const statusDiv = document.getElementById('jioStatus');
  const mobileIn = document.getElementById('jioMobile');
  const otpIn = document.getElementById('jioOtp');
  const reqBtn = document.getElementById('jioRequestOtp');
  const verifyBtn = document.getElementById('jioVerifyOtp');
  const resendBtn = document.getElementById('jioResendOtp');
  const closeBtn = document.getElementById('jioCloseModal');

  if (!modal || !step1 || !step2 || !statusDiv || !mobileIn || !otpIn || !reqBtn || !verifyBtn) {
    console.error('[JioModal] Missing HTML elements');
    return;
  }

  let otpId = '';
  let pendingMobile = '';

  step1.style.display = 'block';
  step2.style.display = 'none';
  statusDiv.innerHTML = '';
  mobileIn.value = '';
  otpIn.value = '';
  reqBtn.disabled = false;
  verifyBtn.disabled = false;
  modal.style.display = 'flex';
  enterModal();

  setTimeout(() => mobileIn.focus(), 150);

  function st(msg, type) {
    const color = type === 'error' ? '#e50000' : type === 'ok' ? '#00c06a' : '#f0c400';
    statusDiv.innerHTML = '<span style="color:' + color + '">' + esc(msg) + '</span>';
  }

  reqBtn.onclick = function () {
    const mobile = mobileIn.value.replace(/\D/g, '');
    if (mobile.length !== 10) { st('Enter valid 10-digit mobile number', 'error'); return; }
    st('Sending OTP via proxy…', 'wait');
    reqBtn.disabled = true;
    jioSendOTP(mobile)
      .then(id => {
        otpId = id;
        pendingMobile = mobile;
        st('OTP sent to +91 ' + mobile, 'ok');
        step1.style.display = 'none';
        step2.style.display = 'block';
        setTimeout(() => { try { otpIn.focus(); } catch(e) {} }, 150);
      })
      .catch(err => {
        console.error('[Jio] sendOTP:', err);
        st('Error: ' + err.message, 'error');
        reqBtn.disabled = false;
      });
  };

  verifyBtn.onclick = function () {
    const otp = otpIn.value.replace(/\D/g, '');
    if (otp.length < 4) { st('Enter the OTP from your SMS', 'error'); return; }
    st('Verifying…', 'wait');
    verifyBtn.disabled = true;
    jioVerifyOTP(pendingMobile, otp, otpId)
      .then(cred => {
        jioCred = cred;
        jioSaveCred();
        st('✓ Logged in! Loading channels…', 'ok');
        setTimeout(() => {
          modal.style.display = 'none';
          loadJioChannels().then(ok => { if (!ok) showToast('Channels failed — tap Jio TV again'); });
        }, 600);
      })
      .catch(err => {
        console.error('[Jio] verifyOTP:', err);
        st('Error: ' + err.message, 'error');
        verifyBtn.disabled = false;
      });
  };

  if (resendBtn) {
    resendBtn.onclick = function () {
      step2.style.display = 'none';
      step1.style.display = 'block';
      otpIn.value = '';
      reqBtn.disabled = false;
      st('Re-enter your number to resend OTP', 'wait');
    };
  }

  if (closeBtn) {
    closeBtn.onclick = function () {
      modal.style.display = 'none';
      exitModal();
      if (plIdx === JIO_IDX && !jioCred) switchTab(0);
    };
  }
}

// ================== KEYDOWN HANDLER ==================
window.addEventListener('keydown', e => {
  const k = e.key;
  const c = e.keyCode;

  if (focusArea === 'modal') {
    const modal = document.getElementById('jioModal');
    if (!modal || modal.style.display === 'none') {
      setFocus('list');
      return;
    }

    if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
      modal.style.display = 'none';
      exitModal();
      if (plIdx === JIO_IDX && !jioCred) switchTab(0);
      e.preventDefault();
      return;
    }

    if (k === 'ArrowUp' || c === 38) {
      focusModalElement(-1);
      e.preventDefault();
      return;
    }
    if (k === 'ArrowDown' || c === 40) {
      focusModalElement(1);
      e.preventDefault();
      return;
    }

    if (k === 'Enter' || c === 13) {
      const focused = document.activeElement;
      if (focused && (focused.tagName === 'BUTTON' || (focused.tagName === 'INPUT' && focused.type === 'button'))) {
        focused.click();
      } else if (focused && focused.tagName === 'INPUT' && focused.type !== 'button') {
        const step1 = document.getElementById('jioLoginStep1');
        const step2 = document.getElementById('jioLoginStep2');
        const visibleContainer = step1.style.display !== 'none' ? step1 : step2;
        const buttons = getFocusableElements(visibleContainer).filter(el => el.tagName === 'BUTTON');
        if (buttons.length) buttons[0].click();
      }
      e.preventDefault();
      return;
    }

    e.preventDefault();
    return;
  }

  // Normal mode
  if ((c >= 48 && c <= 57) || (c >= 96 && c <= 105)) {
    if (focusArea !== 'search') {
      handleDigit(String(c >= 96 ? c - 96 : c - 48));
      e.preventDefault();
      return;
    }
  }

  if (k === 'Escape' || k === 'Back' || k === 'GoBack' || c === 10009 || c === 27) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'ar') { setFocus('list'); e.preventDefault(); return; }
    if (focusArea === 'search') { clearSearch(); e.preventDefault(); return; }
    flushCriticalStorage();
    try { if (window.tizen) tizen.application.getCurrentApplication().exit(); } catch(ex) {}
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
    setFocus('list'); e.preventDefault(); return;
  }
  if (k === 'ArrowRight' || c === 39) {
    if (isFullscreen) { showFsHint(); e.preventDefault(); return; }
    setFocus('ar'); e.preventDefault(); return;
  }

  if (k === 'Enter' || c === 13) {
    if (isFullscreen) { exitFS(); e.preventDefault(); return; }
    if (focusArea === 'list') {
      playSelected();
      setTimeout(() => { if (hasPlayed) enterFS(); }, 600);
    }
    e.preventDefault(); return;
  }

  if (k === 'PageUp') { moveSel(-10); e.preventDefault(); return; }
  if (k === 'PageDown') { moveSel(10); e.preventDefault(); return; }

  if (k === 'MediaPlayPause' || c === 10252) {
    video.paused ? video.play().catch(() => {}) : video.pause();
    e.preventDefault(); return;
  }
  if (k === 'MediaPlay' || c === 415) { video.play().catch(() => {}); e.preventDefault(); return; }
  if (k === 'MediaPause' || c === 19) { video.pause(); e.preventDefault(); return; }
  if (k === 'MediaStop' || c === 413) {
    cancelPreview();
    if (player) player.unload();
    video.pause();
    video.removeAttribute('src');
    setStatus('Stopped', 'idle');
    finishLoadBar();
    e.preventDefault(); return;
  }

  if (k === 'MediaFastForward' || c === 417 || k === 'ChannelUp' || c === 427) { moveSel(1); e.preventDefault(); return; }
  if (k === 'MediaRewind' || c === 412 || k === 'ChannelDown' || c === 428) { moveSel(-1); e.preventDefault(); return; }

  // RED BUTTON: reload current playlist
  if (k === 'ColorF0Red' || c === 403) { reloadCurrentPlaylist(); e.preventDefault(); return; }

  if (k === 'ColorF1Green' || c === 404) {
    if (filtered.length && focusArea === 'list') toggleFav(filtered[selectedIndex]);
    e.preventDefault(); return;
  }
  if (k === 'ColorF2Yellow' || c === 405) { setFocus('search'); e.preventDefault(); return; }
  if (k === 'ColorF3Blue' || c === 406) { if (hasPlayed) toggleFS(); e.preventDefault(); }
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCriticalStorage();
});

window.addEventListener('pagehide', flushCriticalStorage);

document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') flushCriticalStorage();
});

// ================== INITIALIZATION ==================
(async function init() {
  registerKeys();
  bindModalEvents();

  try {
    const s = lsGet(PLAYLIST_KEY);
    if (s) plIdx = Math.min(parseInt(s, 10) || 0, PLAYLISTS.length + 1);
  } catch (e) {}

  document.querySelectorAll('.tab').forEach((t, i) => {
    t.classList.toggle('active', i === plIdx);
  });

  VS.init(channelListEl);
  await initShaka();

  if (plIdx === JIO_IDX) {
    initJio();
    if (!jioCred && !jioChannels.length) setTimeout(handleJioTab, 200);
  } else {
    loadPlaylist();
    initJio();
  }

  setInterval(() => {
    fetch(PROXY + '/ping').catch(() => {});
  }, 8 * 60 * 1000);
})();
