// ================================================================
// IPTV Pro — app.js v11.4 | Samsung Tizen OS9 TV
// ================================================================
// v11.4 Changes (on top of v11.3):
// • Dual-layer token persistence:
//     Layer 1 — localStorage (fast read on boot)
//     Layer 2 — tizen.filesystem wgt-storage/jiotoken.json (survives
//               hard power-off flush loss, app redeploy wipes LS only)
// • flushCriticalStorage() called on:
//     – visibilitychange → hidden
//     – pagehide
//     – tizenhwkey 'back'
//     – every successful token write / refresh
// • loadTokenFromDisk() fallback in init() if localStorage empty
// • Jio channel list also backed up to wgt-storage/jiochannels.json
//   (channels load instantly on next boot even if LS wiped)
// ================================================================
// v11.3 Changes:
// • FIX: Jio modal phone/OTP input — remote number keys no longer
//        hijacked by channel dialer (focusArea='modal')
// • FIX: Fullscreen no longer forces object-fit:cover
// • FIX: Removed applyAutoAspect() auto-Wide forcing on SD streams
// • FIX: toggleFav() + showFavourites() missing closing braces
// • NEW: Proxy keep-alive ping every 10 min
// • AR modes: Native | Fill | Crop | Wide
// ================================================================

/* ── Constants ───────────────────────────────────────────── */
const PROXY          = 'https://houser-3q3n.onrender.com';
const JIO_API_BASE   = PROXY + '/jio';
const FAV_KEY        = 'iptv:favs';
const PLAYLIST_KEY   = 'iptv:lastPl';
const JIO_TOKEN_KEY  = 'jioToken';
const JIO_CH_KEY     = 'jioChannels';
const JIO_CH_TTL     = 30 * 60 * 1000;
const PREVIEW_DELAY  = 700;
const PREFETCH_DELAY = 1000;
const FS_TOKEN_FILE  = 'jiotoken.json';
const FS_CH_FILE     = 'jiochannels.json';

const PLAYLISTS = [
  { name:'Telugu', url:'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name:'India',  url:'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];
const FAV_IDX = 2;
const JIO_IDX = 3;

/* ── AR modes ────────────────────────────────────────────── */
const AR_MODES = [
  { cls:'',         label:'Native' },
  { cls:'ar-fill',  label:'Fill'   },
  { cls:'ar-cover', label:'Crop'   },
  { cls:'ar-wide',  label:'Wide'   },
];

/* ── DOM refs ────────────────────────────────────────────── */
const searchInput   = document.getElementById('searchInput');
const searchWrap    = document.getElementById('searchWrap');
const tabBar        = document.getElementById('tabBar');
const channelListEl = document.getElementById('channelList');
const countBadge    = document.getElementById('countBadge');
const nowPlayingEl  = document.getElementById('nowPlaying');
const npChNumEl     = document.getElementById('npChNum');
const statusBadge   = document.getElementById('statusBadge');
const video         = document.getElementById('video');
const videoWrap     = document.getElementById('videoWrap');
const videoOverlay  = document.getElementById('videoOverlay');
const fsHint        = document.getElementById('fsHint');
const loadBar       = document.getElementById('loadBar');
const chDialer      = document.getElementById('chDialer');
const chDialerNum   = document.getElementById('chDialerNum');
const arBtn         = document.getElementById('arBtn');

/* ── State ───────────────────────────────────────────────── */
let channels = [], allChannels = [], filtered = [];
let selectedIndex = 0, focusArea = 'list', plIdx = 0;
let isFullscreen = false, hasPlayed = false;
let player = null;
let arIdx  = 0;
let fsHintTimer = null, loadBarTimer = null;
let previewTimer = null, prefetchTimer = null;
let dialBuffer = '', dialTimer = null;
let jioChannels = [], jioToken = null;
let prefetchCache = {};

/* ================================================================
TIZEN FILESYSTEM — Dual-layer persistence
Writes critical data to wgt-storage so it survives:
  - Hard power-off (localStorage flush loss)
  - localStorage wipe on redeploy
================================================================ */
const FS = {
  _resolve(cb, errCb) {
    if (!window.tizen || !tizen.filesystem) { if(errCb) errCb('no-tizen'); return; }
    tizen.filesystem.resolve('wgt-storage', cb, errCb || (()=>{}), 'rw');
  },

  write(filename, data) {
    try {
      this._resolve(dir => {
        try {
          // Delete old file first to avoid append issues
          try { dir.deleteFile('wgt-storage/' + filename); } catch(e) {}
          const file   = dir.createFile(filename);
          file.openStream('w', stream => {
            stream.write(typeof data === 'string' ? data : JSON.stringify(data));
            stream.close();
          }, e => console.warn('[FS] write stream err', e), 'UTF-8');
        } catch(e) { console.warn('[FS] write err', e); }
      });
    } catch(e) {}
  },

  read(filename, cb) {
    try {
      this._resolve(dir => {
        try {
          tizen.filesystem.resolve('wgt-storage/' + filename, file => {
            file.openStream('r', stream => {
              const raw = stream.read(file.fileSize);
              stream.close();
              try { cb(JSON.parse(raw)); } catch(e) { cb(null); }
            }, () => cb(null), 'UTF-8');
          }, () => cb(null), 'r');
        } catch(e) { cb(null); }
      }, () => cb(null));
    } catch(e) { cb(null); }
  },
};

/* ── Critical storage flush ──────────────────────────────── */
// Called on visibility hidden, pagehide, back key — ensures data
// is committed to disk before TV powers off
function flushCriticalStorage() {
  try {
    if (jioToken) {
      localStorage.setItem(JIO_TOKEN_KEY, JSON.stringify(jioToken));
      FS.write(FS_TOKEN_FILE, jioToken);
    }
    if (jioChannels.length) {
      const payload = { channels: jioChannels, time: Date.now() };
      localStorage.setItem(JIO_CH_KEY, JSON.stringify(jioChannels));
      localStorage.setItem(JIO_CH_KEY + ':time', String(Date.now()));
      FS.write(FS_CH_FILE, payload);
    }
    // Re-write favs and device ID to force LS flush
    saveFavs();
    const did = localStorage.getItem('_did');
    if (did) localStorage.setItem('_did', did);
  } catch(e) {}
}

// Hook flush to all exit/suspend events
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushCriticalStorage();
});
window.addEventListener('pagehide', flushCriticalStorage);
// Tizen hardware back key
document.addEventListener('tizenhwkey', e => {
  if (e.keyName === 'back') flushCriticalStorage();
});

/* ── Favourites ──────────────────────────────────────────── */
let favSet = new Set();
(function(){
  try { const r = localStorage.getItem(FAV_KEY); if(r) favSet = new Set(JSON.parse(r)); } catch(e){}
})();
function saveFavs(){ try{ localStorage.setItem(FAV_KEY, JSON.stringify([...favSet])); }catch(e){} }
function isFav(ch){ return favSet.has(ch.url || ch.channelId); }

function toggleFav(ch){
  const k = ch.url || ch.channelId;
  favSet.has(k) ? favSet.delete(k) : favSet.add(k);
  saveFavs();
  if(plIdx === FAV_IDX) showFavourites();
  VS.refresh();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed');
}

function showFavourites(){
  filtered = allChannels.filter(c => favSet.has(c.url || c.channelId));
  selectedIndex = 0; renderList();
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

/* ── Toast ───────────────────────────────────────────────── */
let toastEl = null, toastTm = null;
function showToast(msg){
  if(!toastEl){ toastEl = document.createElement('div'); toastEl.id='toast'; document.body.appendChild(toastEl); }
  toastEl.textContent = msg; toastEl.style.opacity = '1';
  clearTimeout(toastTm); toastTm = setTimeout(() => toastEl.style.opacity = '0', 2200);
}

/* ── Status / load bar ───────────────────────────────────── */
function setStatus(t,c){ statusBadge.textContent = t; statusBadge.className = 'status-badge ' + (c||'idle'); }
function startLoadBar(){
  clearTimeout(loadBarTimer); loadBar.style.width = '0%'; loadBar.classList.add('active');
  let w = 0;
  const tick = () => { w = Math.min(w + Math.random()*9, 85); loadBar.style.width = w+'%'; if(w<85) loadBarTimer = setTimeout(tick, 220); };
  loadBarTimer = setTimeout(tick, 100);
}
function finishLoadBar(){
  clearTimeout(loadBarTimer); loadBar.style.width = '100%';
  setTimeout(() => { loadBar.classList.remove('active'); loadBar.style.width = '0%'; }, 400);
}

/* ── Clean channel name ──────────────────────────────────── */
function cleanName(raw){
  return raw
    .replace(/\s*[\[(][^\]*)]*[\])]/g,'')
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi,'')
    .replace(/[\|\-–—]+\s*$/g,'')
    .replace(/\s{2,}/g,' ')
    .trim();
}

/* ── M3U parser ──────────────────────────────────────────── */
function parseM3U(text){
  const lines = text.split(/\r?\n/); const out = []; let meta = null;
  for(const raw of lines){
    const line = raw.trim(); if(!line) continue;
    if(line.startsWith('#EXTINF')){
      const namePart = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const gm = line.match(/group-title="([^"]+)"/i);
      const lm = line.match(/tvg-logo="([^"]+)"/i);
      meta = { name: cleanName(namePart)||namePart, group: gm?gm[1]:'Other', logo: lm?lm[1]:'' };
      continue;
    }
    if(!line.startsWith('#') && meta){ out.push({name:meta.name,group:meta.group,logo:meta.logo,url:line}); meta=null; }
  }
  return out;
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function initials(n){ return n.replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?'; }

/* ================================================================
VIRTUAL SCROLL ENGINE v3
================================================================ */
const VS = {
  ITEM_H:88, OVERSCAN:6,
  c:null, inner:null, vh:0, st:0, total:0, rs:-1, re:-1, nodes:[], raf:null,
  init(el){
    this.c = el;
    this.inner = document.createElement('div'); this.inner.id='vsInner';
    this.c.appendChild(this.inner);
    this.vh = this.c.clientHeight||700;
    this.c.addEventListener('scroll',()=>{
      if(this.raf) return;
      this.raf = requestAnimationFrame(()=>{ this.raf=null; this.st=this.c.scrollTop; this._paint(); });
    },{passive:true});
  },
  setData(n){
    this.total=n; this.rs=-1; this.re=-1;
    this.inner.textContent=''; this.nodes=[];
    this.inner.style.cssText='position:relative;width:100%;height:'+(n*this.ITEM_H)+'px;';
    this.st=this.c.scrollTop; this.vh=this.c.clientHeight||700; this._paint();
  },
  scrollToIndex(idx){
    const top=idx*this.ITEM_H, bot=top+this.ITEM_H, vh=this.vh, st=this.c.scrollTop;
    if(top<st) this.c.scrollTop=top;
    else if(bot>st+vh) this.c.scrollTop=bot-vh;
    this.st=this.c.scrollTop; this._paint();
  },
  scrollToIndexCentered(idx){
    const center=idx*this.ITEM_H-(this.vh/2)+(this.ITEM_H/2);
    this.c.scrollTop=Math.max(0,center); this.st=this.c.scrollTop; this.rs=-1; this.re=-1; this._paint();
  },
  _paint(){
    if(!this.total) return;
    const H=this.ITEM_H, os=this.OVERSCAN;
    const start=Math.max(0,Math.floor(this.st/H)-os);
    const end=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);
    if(start===this.rs && end===this.re) return;
    this.rs=start; this.re=end;
    this.nodes=this.nodes.filter(nd=>{ if(nd._i<start||nd._i>end){ this.inner.removeChild(nd); return false; } return true; });
    const have=new Set(this.nodes.map(n=>n._i));
    const frag=document.createDocumentFragment();
    for(let i=start;i<=end;i++){ if(!have.has(i)) frag.appendChild(this._build(i)); }
    if(frag.childNodes.length) this.inner.appendChild(frag);
    this.nodes=[...this.inner.children];
    const sel=selectedIndex;
    for(const nd of this.nodes){
      const on=nd._i===sel;
      if(on!==nd._on){ nd._on=on; nd.classList.toggle('active',on); if(nd._nm) nd._nm.style.color=on?'#000':''; if(nd._nu) nd._nu.style.color=on?'#999':''; }
    }
  },
  _build(i){
    const ch=filtered[i];
    const li=document.createElement('li');
    li._i=i; li._on=false;
    li.style.cssText='position:absolute;top:'+(i*this.ITEM_H)+'px;left:0;right:0;height:'+this.ITEM_H+'px;';
    const ini=esc(initials(ch.name));
    const logo=ch.logo
      ? '<div class="ch-logo"><img src="'+esc(ch.logo)+'" loading="lazy" onerror="this.style.display=\'none\'"></div>'
      : '<div class="ch-logo"><span class="ch-logo-fb">'+ini+'</span></div>';
    li.innerHTML=logo+'<div class="ch-info"><div class="ch-name">'+esc(ch.name)+'</div></div>'+(isFav(ch)?'<span class="ch-fav">★</span>':'')+'<span class="ch-num">'+(i+1)+'</span>';
    li._nm=li.querySelector('.ch-name'); li._nu=li.querySelector('.ch-num');
    if(i===selectedIndex){ li._on=true; li.classList.add('active'); if(li._nm) li._nm.style.color='#000'; if(li._nu) li._nu.style.color='#999'; }
    li.addEventListener('focus', ()=>{ schedulePrefetch(i); });
    li.addEventListener('click',()=>{ selectedIndex=i; VS.refresh(); schedulePreview(); });
    return li;
  },
  refresh(){ this.rs=-1; this.re=-1; this._paint(); },
};

/* ── Render list ─────────────────────────────────────────── */
function renderList(){
  countBadge.textContent=filtered.length;
  if(!filtered.length){
    VS.setData(0);
    const li=document.createElement('li');
    li.style.cssText='position:absolute;top:0;left:0;right:0;padding:24px 16px;';
    li.innerHTML='<span style="color:#444">No channels</span>';
    VS.inner.appendChild(li); return;
  }
  VS.setData(filtered.length);
  VS.scrollToIndex(selectedIndex);
}

/* ── Search ──────────────────────────────────────────────── */
let sdTm=null;
function applySearch(){
  clearTimeout(sdTm);
  sdTm=setTimeout(()=>{
    const q=searchInput.value.trim().toLowerCase();
    filtered=!q?channels.slice():channels.filter(c=>c.name.toLowerCase().includes(q)||c.group.toLowerCase().includes(q));
    selectedIndex=0; renderList();
  },120);
}
function commitSearch(){ setFocus('list'); if(filtered.length===1){ selectedIndex=0; VS.refresh(); schedulePreview(); } }
function clearSearch(){ searchInput.value=''; applySearch(); setFocus('list'); }
searchInput.addEventListener('input',applySearch);

/* ── XHR with mirror fallback ────────────────────────────── */
function xhrFetch(url,ms,cb){
  let done=false;
  const xhr=new XMLHttpRequest();
  const tid=setTimeout(()=>{ if(done)return; done=true; xhr.abort(); cb(new Error('Timeout'),null); },ms);
  xhr.onreadystatechange=function(){ if(xhr.readyState!==4||done)return; done=true; clearTimeout(tid); xhr.status>=200&&xhr.status<400?cb(null,xhr.responseText):cb(new Error('HTTP '+xhr.status),null); };
  xhr.onerror=function(){ if(done)return; done=true; clearTimeout(tid); cb(new Error('Net'),null); };
  xhr.open('GET',url,true); xhr.send();
}
function mirrorUrl(url){
  try{
    const u=new URL(url);
    if(u.hostname!=='raw.githubusercontent.com') return null;
    const p=u.pathname.split('/').filter(Boolean); if(p.length<4) return null;
    return 'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/');
  }catch(e){ return null; }
}

/* ── Load playlist (30-min localStorage cache) ───────────── */
function loadPlaylist(urlOv){
  cancelPreview();
  if(plIdx===FAV_IDX&&!urlOv){ showFavourites(); return; }
  const url=urlOv||PLAYLISTS[plIdx].url;
  const cacheKey='plCache:'+url;
  const cacheTimeKey='plCacheTime:'+url;
  try{
    const cached=localStorage.getItem(cacheKey);
    const cacheTime=parseInt(localStorage.getItem(cacheTimeKey)||'0',10);
    if(cached && (Date.now()-cacheTime)<JIO_CH_TTL){ onLoaded(cached,true); return; }
  }catch(e){}
  setStatus('Loading…','loading'); startLoadBar();
  xhrFetch(url,25000,(err,text)=>{
    if(err){
      const m=mirrorUrl(url);
      if(m){ setStatus('Retrying…','loading'); xhrFetch(m,25000,(e2,t2)=>{ finishLoadBar(); e2?setStatus('Failed','error'):onLoaded(t2); }); }
      else{ finishLoadBar(); setStatus('Failed','error'); }
      return;
    }
    try{ localStorage.setItem(cacheKey,text); localStorage.setItem(cacheTimeKey,String(Date.now())); }catch(e){}
    finishLoadBar(); onLoaded(text);
  });
}
function onLoaded(text, fromCache){
  channels=parseM3U(text);
  const seen=new Set(allChannels.map(c=>c.url));
  channels.forEach(c=>{ if(!seen.has(c.url)) allChannels.push(c); });
  filtered=channels.slice(); selectedIndex=0; renderList();
  try{ localStorage.setItem(PLAYLIST_KEY,String(plIdx)); }catch(e){}
  setStatus('Ready · '+channels.length+' ch'+(fromCache?' (cached)':''),'idle');
  setFocus('list');
}

/* ================================================================
SHAKA PLAYER
================================================================ */
async function initShaka(){
  shaka.polyfill.installAll();
  if(!shaka.Player.isBrowserSupported()){ console.error('[IPTV] Shaka not supported'); return; }
  player = new shaka.Player(video);
  player.configure({
    streaming: {
      bufferingGoal: 30, rebufferingGoal: 2, bufferBehind: 20,
      retryParameters: { maxAttempts:4, baseDelay:500, backoffFactor:2 },
    },
    abr: { enabled: true },
  });
  player.addEventListener('error', e => { console.error('[Shaka]', e.detail); setStatus('Stream error','error'); finishLoadBar(); });
  console.log('[IPTV] Shaka', shaka.Player.version, 'ready');
}
async function doPlay(url){
  if(!player){ await initShaka(); }
  try{
    await player.unload();
    video.removeAttribute('src');
    await player.load(url);
    video.play().catch(()=>{});
  }catch(err){
    console.error('[Shaka] load error',err);
    setStatus('Play error','error'); finishLoadBar();
  }
}

/* ── Aspect ratio ────────────────────────────────────────── */
function resetAspectRatio(){
  video.classList.remove('ar-fill','ar-cover','ar-wide');
  arIdx=0; arBtn.textContent='⛶ Native'; arBtn.className='ar-btn';
}
function cycleAR(){
  video.classList.remove('ar-fill','ar-cover','ar-wide');
  arIdx=(arIdx+1)%AR_MODES.length;
  const m=AR_MODES[arIdx];
  if(m.cls) video.classList.add(m.cls);
  arBtn.textContent='⛶ '+m.label;
  arBtn.className='ar-btn'+(m.cls?' '+m.cls:'');
  showToast('Aspect: '+m.label);
}
arBtn.addEventListener('click',cycleAR);
function setARFocus(on){ arBtn.classList.toggle('focused',on); }

/* ── Preview / prefetch ──────────────────────────────────── */
function cancelPreview(){ clearTimeout(previewTimer); previewTimer=null; }
function schedulePreview(){
  cancelPreview();
  previewTimer=setTimeout(()=>{ previewTimer=null; startPreview(selectedIndex); }, PREVIEW_DELAY);
}
function schedulePrefetch(idx){
  clearTimeout(prefetchTimer);
  prefetchTimer=setTimeout(async ()=>{
    const ch=filtered[idx];
    if(!ch||!ch.channelId||prefetchCache[ch.channelId]) return;
    try{ const url=await jioGetStreamUrl(ch.channelId); prefetchCache[ch.channelId]=url; ch._prefetchUrl=url; }catch(e){}
  }, PREFETCH_DELAY);
}
async function startPreview(idx){
  if(!filtered.length) return;
  const ch=filtered[idx]; if(!ch) return;
  resetAspectRatio();
  nowPlayingEl.textContent=ch.name;
  npChNumEl.textContent='CH '+(idx+1);
  videoOverlay.classList.add('hidden');
  hasPlayed=true; setStatus('Buffering…','loading'); startLoadBar();
  let url = ch.url || ch._prefetchUrl;
  if(ch.channelId && !url){
    try{
      if(prefetchCache[ch.channelId]){ url=prefetchCache[ch.channelId]; }
      else{ setStatus('Fetching stream…','loading'); url=await jioGetStreamUrl(ch.channelId); prefetchCache[ch.channelId]=url; }
      ch.url=url;
    }catch(err){ finishLoadBar(); setStatus('Jio error: '+err.message,'error'); return; }
  }
  await doPlay(url);
}
function playSelected(){ cancelPreview(); startPreview(selectedIndex); }

/* ── Video events ────────────────────────────────────────── */
video.addEventListener('playing',()=>{ setStatus('Playing','playing'); finishLoadBar(); });
video.addEventListener('pause', ()=>setStatus('Paused','paused'));
video.addEventListener('waiting',()=>{ setStatus('Buffering…','loading'); startLoadBar(); });
video.addEventListener('stalled',()=>setStatus('Buffering…','loading'));
video.addEventListener('error', ()=>{ setStatus('Error','error'); finishLoadBar(); });

/* ── Fullscreen ──────────────────────────────────────────── */
function showFsHint(){ clearTimeout(fsHintTimer); fsHint.classList.add('visible'); fsHintTimer=setTimeout(()=>fsHint.classList.remove('visible'),3000); }
function enterFS(){ const fn=videoWrap.requestFullscreen||videoWrap.webkitRequestFullscreen||videoWrap.mozRequestFullScreen; if(fn){ try{ fn.call(videoWrap); }catch(e){} } document.body.classList.add('fullscreen'); isFullscreen=true; showFsHint(); }
function exitFS(){ const fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen; if(fn){ try{ fn.call(document); }catch(e){} } document.body.classList.remove('fullscreen'); isFullscreen=false; fsHint.classList.remove('visible'); }
function toggleFS(){ isFullscreen?exitFS():enterFS(); }
document.addEventListener('fullscreenchange',()=>{ isFullscreen=!!(document.fullscreenElement||document.webkitFullscreenElement); if(!isFullscreen){ document.body.classList.remove('fullscreen'); fsHint.classList.remove('visible'); } });
document.addEventListener('webkitfullscreenchange',()=>{ isFullscreen=!!(document.webkitFullscreenElement||document.fullscreenElement); if(!isFullscreen){ document.body.classList.remove('fullscreen'); fsHint.classList.remove('visible'); } });
video.addEventListener('dblclick',toggleFS);

/* ── Navigation ──────────────────────────────────────────── */
function moveSel(d){
  if(!filtered.length) return;
  cancelPreview();
  selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d));
  VS.scrollToIndex(selectedIndex); VS.refresh();
  schedulePrefetch(selectedIndex);
  schedulePreview();
}
function setFocus(a){
  focusArea=a; setARFocus(a==='ar');
  if(a==='search'){ searchWrap.classList.add('active'); searchInput.focus(); }
  else{ searchWrap.classList.remove('active'); if(document.activeElement===searchInput) searchInput.blur(); }
}

/* ── Tab switch ──────────────────────────────────────────── */
function switchTab(idx){
  plIdx=idx;
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
  if(idx===JIO_IDX) handleJioTab(); else loadPlaylist();
}
tabBar.querySelectorAll('.tab').forEach((b,i)=>b.addEventListener('click',()=>switchTab(i)));

/* ── Number dial ─────────────────────────────────────────── */
function handleDigit(d){
  clearTimeout(dialTimer); dialBuffer+=d; chDialerNum.textContent=dialBuffer; chDialer.classList.add('visible');
  dialTimer=setTimeout(()=>{
    const num=parseInt(dialBuffer,10); dialBuffer=''; chDialer.classList.remove('visible');
    if(!filtered.length||isNaN(num)) return;
    const idx=Math.max(0,Math.min(filtered.length-1,num-1));
    cancelPreview(); selectedIndex=idx; VS.scrollToIndexCentered(idx); playSelected();
    showToast('CH '+(idx+1)+' — '+filtered[idx].name);
  },1500);
}

/* ── Tizen key registration ──────────────────────────────── */
(function(){
  try{
    if(window.tizen&&tizen.tvinputdevice){
      ['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
       'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown','Back',
       '0','1','2','3','4','5','6','7','8','9']
      .forEach(k=>{ try{ tizen.tvinputdevice.registerKey(k); }catch(e){} });
    }
  }catch(e){}
})();

/* ── Modal focus helpers ─────────────────────────────────── */
function enterModal(){ focusArea='modal'; }
function exitModal(){  focusArea='list';  }

/* ── Keyboard / remote ───────────────────────────────────── */
window.addEventListener('keydown',e=>{
  const k=e.key, c=e.keyCode;

  // MODAL MODE: all keys pass through to focused input; Back closes modal
  if(focusArea==='modal'){
    if(k==='Escape'||k==='Back'||k==='GoBack'||c===10009||c===27){
      const modal=document.getElementById('jioModal');
      if(modal&&modal.style.display!=='none'){
        modal.style.display='none';
        exitModal();
        if(plIdx===JIO_IDX&&!jioChannels.length) switchTab(0);
      }
      e.preventDefault();
    }
    return;
  }

  if((c>=48&&c<=57)||(c>=96&&c<=105)){
    if(focusArea!=='search'){ handleDigit(String(c>=96?c-96:c-48)); e.preventDefault(); return; }
  }

  if(k==='Escape'||k==='Back'||k==='GoBack'||c===10009||c===27){
    if(isFullscreen){ exitFS(); e.preventDefault(); return; }
    if(focusArea==='ar'){ setFocus('list'); e.preventDefault(); return; }
    if(focusArea==='search'){ clearSearch(); e.preventDefault(); return; }
    flushCriticalStorage();
    try{ if(window.tizen) tizen.application.getCurrentApplication().exit(); }catch(e){}
    e.preventDefault(); return;
  }

  if(focusArea==='ar'){
    if(k==='Enter'||c===13){ cycleAR(); e.preventDefault(); return; }
    if(k==='ArrowLeft'||c===37||k==='ArrowDown'||c===40){ setFocus('list'); e.preventDefault(); return; }
    if(k==='ArrowRight'||c===39||k==='ArrowUp'||c===38){ cycleAR(); e.preventDefault(); return; }
    e.preventDefault(); return;
  }
  if(focusArea==='search'){
    if(k==='Enter'||c===13){ commitSearch(); e.preventDefault(); return; }
    if(k==='ArrowDown'||k==='ArrowUp'||c===40||c===38){ commitSearch(); }
    else return;
  }

  if(k==='ArrowUp' ||c===38){ isFullscreen?showFsHint():moveSel(-1); e.preventDefault(); return; }
  if(k==='ArrowDown'||c===40){ isFullscreen?showFsHint():moveSel(1);  e.preventDefault(); return; }
  if(k==='ArrowLeft'||c===37){ isFullscreen?exitFS():setFocus('list'); e.preventDefault(); return; }
  if(k==='ArrowRight'||c===39){ if(isFullscreen){ showFsHint(); e.preventDefault(); return; } setFocus('ar'); e.preventDefault(); return; }
  if(k==='Enter'||c===13){
    if(isFullscreen){ exitFS(); e.preventDefault(); return; }
    if(focusArea==='list'){ playSelected(); setTimeout(()=>{ if(hasPlayed) enterFS(); },600); }
    e.preventDefault(); return;
  }
  if(k==='PageUp') { moveSel(-10); e.preventDefault(); return; }
  if(k==='PageDown'){ moveSel(10);  e.preventDefault(); return; }
  if(k==='MediaPlayPause'||c===10252){ video.paused?video.play().catch(()=>{}):video.pause(); e.preventDefault(); return; }
  if(k==='MediaPlay'  ||c===415)  { video.play().catch(()=>{}); e.preventDefault(); return; }
  if(k==='MediaPause' ||c===19)   { video.pause(); e.preventDefault(); return; }
  if(k==='MediaStop'  ||c===413)  { cancelPreview(); if(player) player.unload(); video.pause(); video.removeAttribute('src'); setStatus('Stopped','idle'); finishLoadBar(); e.preventDefault(); return; }
  if(k==='MediaFastForward'||c===417){ moveSel(1);  e.preventDefault(); return; }
  if(k==='MediaRewind'     ||c===412){ moveSel(-1); e.preventDefault(); return; }
  if(k==='ChannelUp'  ||c===427){ moveSel(1);  e.preventDefault(); return; }
  if(k==='ChannelDown'||c===428){ moveSel(-1); e.preventDefault(); return; }
  if(k==='ColorF0Red' ||c===403){ switchTab((plIdx+1)%(PLAYLISTS.length+2)); e.preventDefault(); return; }
  if(k==='ColorF1Green'||c===404){ if(filtered.length&&focusArea==='list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  if(k==='ColorF2Yellow'||c===405){ setFocus('search'); e.preventDefault(); return; }
  if(k==='ColorF3Blue' ||c===406){ if(hasPlayed) toggleFS(); e.preventDefault(); return; }
});

/* ================================================================
ANDROID TV DEVICE SPOOF
================================================================ */
const DEVICE = {
  model       : 'BRAVIA_ATV3',
  manufacturer: 'Sony',
  osVersion   : '11',
  sdkVersion  : '30',
  appVersion  : '7.0.4',
  uniqueId    : (()=>{
    let id=localStorage.getItem('_did');
    if(!id){ id='xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{ const r=Math.random()*16|0; return (c==='x'?r:(r&0x3|0x8)).toString(16); }); localStorage.setItem('_did',id); }
    return id;
  })(),
};
const ANDROID_HEADERS = {
  'User-Agent'     : `JioTV/${DEVICE.appVersion} (Android ${DEVICE.osVersion}; ${DEVICE.manufacturer} ${DEVICE.model}) okhttp/4.9.2`,
  'x-platform'    : 'androidtv',
  'x-app-version' : DEVICE.appVersion,
  'x-device-type' : 'tv',
  'x-os-version'  : DEVICE.osVersion,
  'x-unique-id'   : DEVICE.uniqueId,
  'x-subscriber-id': DEVICE.uniqueId,
  'devicetype'    : 'tv',
  'os'            : 'android',
  'appname'       : 'RJIL_JioTV',
  'Accept'        : 'application/json',
  'Content-Type'  : 'application/json',
};

/* ================================================================
JIO TV — Direct API via proxy
================================================================ */
async function jioApi(path, options={}){
  const controller=new AbortController();
  const tid=setTimeout(()=>controller.abort(),15000);
  try{
    const res=await fetch(PROXY+path,{
      ...options,
      headers:{ ...ANDROID_HEADERS, ...(options.headers||{}) },
      signal:controller.signal
    });
    clearTimeout(tid);
    if(!res.ok) throw new Error('HTTP '+res.status);
    return await res.json();
  }catch(err){ clearTimeout(tid); throw err; }
}

async function jioRequestOtp(mobile){
  const data=await jioApi('/jio/sendotp',{
    method:'POST',
    body:JSON.stringify({ number:'+91'+mobile, deviceInfo:{ model:DEVICE.model, manufacturer:DEVICE.manufacturer, osVersion:DEVICE.osVersion, uniqueId:DEVICE.uniqueId, deviceType:'tv' } })
  });
  return data.requestId||data.OtpReqId;
}
async function jioVerifyOtp(mobile,otp,requestId){
  const data=await jioApi('/jio/verifyotp',{
    method:'POST',
    body:JSON.stringify({ number:'+91'+mobile, otp, requestId, deviceInfo:{ model:DEVICE.model, manufacturer:DEVICE.manufacturer, osVersion:DEVICE.osVersion, uniqueId:DEVICE.uniqueId, deviceType:'tv' } })
  });
  return { ssoToken:data.ssoToken||data.access_token, refreshToken:data.refreshToken||data.refresh_token, expires:Date.now()+((data.tokenValidity||3600)*1000) };
}
async function jioGetStreamUrl(channelId){
  if(!jioToken) throw new Error('Not logged in');
  const data=await jioApi('/jio/channel/'+channelId+'?quality=HD',{ headers:{'ssotoken':jioToken.ssoToken} });
  const url=data?.result?.bitrates?.auto||data?.url;
  if(!url) throw new Error('No stream URL');
  return url;
}
async function jioRefreshToken(){
  if(!jioToken?.refreshToken) return false;
  try{
    const data=await jioApi('/jio/refreshtoken',{ method:'POST', body:JSON.stringify({refreshToken:jioToken.refreshToken}) });
    jioToken.ssoToken=data.ssoToken||data.access_token;
    jioToken.expires=Date.now()+((data.tokenValidity||3600)*1000);
    // Write to both layers immediately on every refresh
    localStorage.setItem(JIO_TOKEN_KEY,JSON.stringify(jioToken));
    FS.write(FS_TOKEN_FILE, jioToken);
    return true;
  }catch(e){ return false; }
}

async function loadJioChannels(){
  if(!jioToken) return false;
  try{
    const cached=localStorage.getItem(JIO_CH_KEY);
    const cacheTime=parseInt(localStorage.getItem(JIO_CH_KEY+':time')||'0',10);
    if(cached&&(Date.now()-cacheTime)<JIO_CH_TTL){
      jioChannels=JSON.parse(cached);
      channels=jioChannels.slice(); filtered=channels.slice(); selectedIndex=0; renderList();
      setStatus('Jio TV · '+channels.length+' ch (cached)','idle'); return true;
    }
    const data=await jioApi('/jio/channels',{ headers:{'ssotoken':jioToken.ssoToken} });
    jioChannels=(data.result||data.channels||[]).map(ch=>({ name:ch.channelName, logo:ch.logoUrl||'', channelId:ch.channelId, group:'Jio TV', url:null }));
    // Write to both layers
    try{
      localStorage.setItem(JIO_CH_KEY,JSON.stringify(jioChannels));
      localStorage.setItem(JIO_CH_KEY+':time',String(Date.now()));
      FS.write(FS_CH_FILE, { channels:jioChannels, time:Date.now() });
    }catch(e){}
    channels=jioChannels.slice(); filtered=channels.slice(); selectedIndex=0; renderList();
    setStatus('Jio TV · '+channels.length+' ch','idle');
    return true;
  }catch(err){
    if(await jioRefreshToken()){ return loadJioChannels(); }
    setStatus('Jio error: '+err.message,'error'); return false;
  }
}

/* ── Jio Login Modal ─────────────────────────────────────── */
function showJioLoginModal(){
  const modal      = document.getElementById('jioModal');
  const step1      = document.getElementById('jioLoginStep1');
  const step2      = document.getElementById('jioLoginStep2');
  const statusDiv  = document.getElementById('jioStatus');
  const mobileInput= document.getElementById('jioMobile');
  const otpInput   = document.getElementById('jioOtp');
  const reqBtn     = document.getElementById('jioRequestOtp');
  const verifyBtn  = document.getElementById('jioVerifyOtp');
  const closeBtn   = document.getElementById('jioCloseModal');

  step1.style.display='block'; step2.style.display='none';
  statusDiv.innerHTML=''; mobileInput.value=''; otpInput.value='';
  let requestId=null;

  enterModal();
  modal.style.display='flex';
  setTimeout(()=>mobileInput.focus(),150);

  reqBtn.onclick=async()=>{
    const mobile=mobileInput.value.trim();
    if(!/^\d{10}$/.test(mobile)){ statusDiv.innerHTML='<span style="color:#e50000">Enter valid 10-digit number</span>'; return; }
    statusDiv.innerHTML='Sending OTP…';
    try{
      requestId=await jioRequestOtp(mobile);
      statusDiv.innerHTML='OTP sent ✓';
      step1.style.display='none'; step2.style.display='block';
      setTimeout(()=>otpInput.focus(),100);
    }catch(err){ statusDiv.innerHTML='<span style="color:#e50000">'+err.message+'</span>'; }
  };

  verifyBtn.onclick=async()=>{
    const mobile=mobileInput.value.trim(); const otp=otpInput.value.trim();
    if(!otp){ statusDiv.innerHTML='Enter OTP'; return; }
    statusDiv.innerHTML='Verifying…';
    try{
      const t=await jioVerifyOtp(mobile,otp,requestId);
      jioToken=t;
      // Write to both layers on fresh login
      localStorage.setItem(JIO_TOKEN_KEY,JSON.stringify(jioToken));
      FS.write(FS_TOKEN_FILE, jioToken);
      statusDiv.innerHTML='✓ Login successful! Loading channels…';
      modal.style.display='none';
      exitModal();
      scheduleTokenRefresh();
      await loadJioChannels(); setFocus('list');
    }catch(err){ statusDiv.innerHTML='<span style="color:#e50000">'+err.message+'</span>'; }
  };

  closeBtn.onclick=()=>{
    modal.style.display='none';
    exitModal();
    if(plIdx===JIO_IDX&&!jioChannels.length) switchTab(0);
  };
}

async function handleJioTab(){
  if(jioChannels.length){ channels=jioChannels.slice(); filtered=channels.slice(); selectedIndex=0; renderList(); setStatus('Jio TV · '+channels.length+' ch','idle'); setFocus('list'); return; }
  const stored=localStorage.getItem(JIO_TOKEN_KEY);
  if(stored){
    try{
      const t=JSON.parse(stored);
      if(t.expires>Date.now()){ jioToken=t; await loadJioChannels(); return; }
      jioToken=t;
      if(await jioRefreshToken()){ await loadJioChannels(); return; }
      localStorage.removeItem(JIO_TOKEN_KEY);
    }catch(e){}
  }
  // Layer 2 fallback: try reading from tizen.filesystem
  FS.read(FS_TOKEN_FILE, async diskToken => {
    if(diskToken && diskToken.ssoToken){
      jioToken=diskToken;
      if(jioToken.expires > Date.now()){
        // Restore to localStorage too
        localStorage.setItem(JIO_TOKEN_KEY, JSON.stringify(jioToken));
        // Also try loading cached channels from disk
        FS.read(FS_CH_FILE, async diskCh => {
          if(diskCh?.channels?.length && (Date.now()-diskCh.time)<JIO_CH_TTL){
            jioChannels=diskCh.channels;
            localStorage.setItem(JIO_CH_KEY, JSON.stringify(jioChannels));
            localStorage.setItem(JIO_CH_KEY+':time', String(diskCh.time));
            channels=jioChannels.slice(); filtered=channels.slice(); selectedIndex=0; renderList();
            setStatus('Jio TV · '+channels.length+' ch (disk cache)','idle');
          } else {
            await loadJioChannels();
          }
        });
        scheduleTokenRefresh();
        return;
      }
      // Disk token expired — try refresh
      if(await jioRefreshToken()){ await loadJioChannels(); return; }
    }
    showJioLoginModal();
  });
}

/* ── Token auto-refresh (15 min before expiry) ───────────── */
function scheduleTokenRefresh(){
  if(!jioToken?.expires) return;
  const delay=jioToken.expires-Date.now()-(15*60*1000);
  if(delay>0) setTimeout(async()=>{ await jioRefreshToken(); scheduleTokenRefresh(); },delay);
}

/* ── Init ────────────────────────────────────────────────── */
(async function init(){
  try{ const s=localStorage.getItem(PLAYLIST_KEY); if(s) plIdx=Math.min(parseInt(s,10)||0,PLAYLISTS.length+1); }catch(e){}
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===plIdx));
  VS.init(channelListEl);
  await initShaka();
  if(plIdx===JIO_IDX) handleJioTab(); else loadPlaylist();
  // Pre-warm Jio token silently (localStorage first, disk fallback)
  try{
    const stored=localStorage.getItem(JIO_TOKEN_KEY);
    if(stored){
      const t=JSON.parse(stored);
      if(t.expires>Date.now()){ jioToken=t; scheduleTokenRefresh(); }
    } else {
      // No LS token — try disk silently (handles hard power-off scenario)
      FS.read(FS_TOKEN_FILE, t => {
        if(t?.ssoToken && t.expires>Date.now()){
          jioToken=t;
          localStorage.setItem(JIO_TOKEN_KEY, JSON.stringify(t));
          scheduleTokenRefresh();
          console.log('[IPTV] Token restored from disk');
        }
      });
    }
  }catch(e){}
  // Proxy keep-alive ping every 10 min
  setInterval(()=>{ fetch(PROXY+'/ping').catch(()=>{}); }, 10*60*1000);
})();
