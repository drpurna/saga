// ================================================================
// IPTV — app.js v5.0  |  Samsung TV 2025 / TizenBrew
// Virtual Scroll · Favourites · Aspect Ratio · Remote Dial
// Red = playlist cycle · Green = fav toggle · Clean name strip
// ================================================================

(function checkHLS(){
  if(window.Hls) console.log('[IPTV] HLS.js',window.Hls.version);
  else           console.error('[IPTV] HLS.js MISSING');
})();

/* ── DOM ──────────────────────────────────────────────────── */
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

/* ── Playlists ───────────────────────────────────────────── */
const PLAYLISTS = [
  { name:'Telugu', url:'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name:'India',  url:'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];
const FAV_IDX       = 2;
const FAV_KEY       = 'iptv:favs';
const PLAYLIST_KEY  = 'iptv:lastPl';

/* ── HLS config ──────────────────────────────────────────── */
const HLS_CFG = {
  enableWorker:false, lowLatencyMode:false,
  backBufferLength:30, maxBufferLength:60, maxMaxBufferLength:120,
  maxBufferSize:60*1000*1000, maxBufferHole:0.5, nudgeMaxRetry:5,
  startLevel:-1, abrEwmaDefaultEstimate:1500000,
  manifestLoadingMaxRetry:4, manifestLoadingRetryDelay:500,
  levelLoadingMaxRetry:4,    levelLoadingRetryDelay:500,
  fragLoadingMaxRetry:6,     fragLoadingRetryDelay:500,
  xhrSetup:function(xhr){ xhr.timeout=15000; },
};

/* ── State ───────────────────────────────────────────────── */
let channels      = [];
let allChannels   = [];
let filtered      = [];
let selectedIndex = 0;
let focusArea     = 'list';
let hls           = null;
let plIdx         = 0;
let isFullscreen  = false;
let hasPlayed     = false;
let fsHintTimer   = null;
let loadBarTimer  = null;
let dialBuffer    = '';
let dialTimer     = null;

/* Aspect ratio cycle: contain → fill → cover → wide */
const AR_MODES = [
  { cls:'',         label:'⛶ Fit',   obj:'contain' },
  { cls:'ar-fill',  label:'⛶ Fill',  obj:'fill'    },
  { cls:'ar-cover', label:'⛶ Crop',  obj:'cover'   },
  { cls:'ar-wide',  label:'⛶ Wide',  obj:'contain' },
];
let arIdx = 0;

/* ── Favourites ──────────────────────────────────────────── */
let favSet = new Set();
(function loadFavs(){
  try{ const r=localStorage.getItem(FAV_KEY); if(r) favSet=new Set(JSON.parse(r)); }catch(e){}
})();
function saveFavs(){ try{ localStorage.setItem(FAV_KEY,JSON.stringify([...favSet])); }catch(e){} }
function isFav(ch){ return favSet.has(ch.url); }
function toggleFav(ch){
  favSet.has(ch.url) ? favSet.delete(ch.url) : favSet.add(ch.url);
  saveFavs();
  if(plIdx===FAV_IDX) showFavourites();
  VS.refresh();
  showToast(favSet.has(ch.url) ? '★  Added to Favourites' : '✕  Removed from Favourites');
}
function showFavourites(){
  filtered=allChannels.filter(c=>favSet.has(c.url));
  selectedIndex=0; renderList();
  setStatus(filtered.length ? filtered.length+' favourites' : 'No favourites yet','idle');
}

/* ── Toast ───────────────────────────────────────────────── */
let toastEl=null, toastTm=null;
function showToast(msg){
  if(!toastEl){ toastEl=document.createElement('div'); toastEl.id='toast'; document.body.appendChild(toastEl); }
  toastEl.textContent=msg; toastEl.style.opacity='1';
  clearTimeout(toastTm); toastTm=setTimeout(()=>{ toastEl.style.opacity='0'; },2200);
}

/* ── Status / load bar ───────────────────────────────────── */
function setStatus(t,c){ statusBadge.textContent=t; statusBadge.className='status-badge '+(c||'idle'); }
function startLoadBar(){
  clearTimeout(loadBarTimer); loadBar.style.width='0%'; loadBar.classList.add('active');
  let w=0;
  const tick=()=>{ w=Math.min(w+Math.random()*9,85); loadBar.style.width=w+'%'; if(w<85) loadBarTimer=setTimeout(tick,220); };
  loadBarTimer=setTimeout(tick,100);
}
function finishLoadBar(){
  clearTimeout(loadBarTimer); loadBar.style.width='100%';
  setTimeout(()=>{ loadBar.classList.remove('active'); loadBar.style.width='0%'; },400);
}

/* ── Clean channel name ──────────────────────────────────── */
function cleanName(raw){
  return raw
    /* remove resolution tags like 576p 720p 1080p 1080i 4K UHD HD SD FHD */
    .replace(/\b(4K|UHD|FHD|SD|HD|[0-9]{3,4}[piP])\b/g,'')
    /* remove bracketed/parenthesised quality markers */
    .replace(/[\[(][^\])]*(576|720|1080|2160|HD|SD|FHD|UHD|4K)[^\])]*[\])]/gi,'')
    /* collapse multiple spaces */
    .replace(/\s{2,}/g,' ')
    .trim();
}

/* ── M3U parser ──────────────────────────────────────────── */
function parseM3U(text){
  const lines=text.split(/\r?\n/); const out=[]; let meta=null;
  for(const raw of lines){
    const line=raw.trim(); if(!line) continue;
    if(line.startsWith('#EXTINF')){
      const namePart=line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      const gm=line.match(/group-title="([^"]+)"/i);
      const lm=line.match(/tvg-logo="([^"]+)"/i);
      meta={ name:cleanName(namePart)||namePart, group:gm?gm[1]:'Other', logo:lm?lm[1]:'' };
      continue;
    }
    if(!line.startsWith('#')&&meta){ out.push({name:meta.name,group:meta.group,logo:meta.logo,url:line}); meta=null; }
  }
  return out;
}

function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function initials(n){ return n.replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?'; }

/* ================================================================
   VIRTUAL SCROLL ENGINE v2
   – requestAnimationFrame throttled scroll listener
   – Node pool: never removes/adds more than necessary
   – No transition on li — eliminates jank entirely
   ================================================================ */
const VS = {
  ITEM_H:  72,   /* ← must match CSS --item-h */
  OVERSCAN: 8,   /* extra rows above + below viewport */
  c:null, inner:null, vh:0, st:0, total:0,
  rs:-1, re:-1, nodes:[], raf:null,

  init(el){
    this.c=el;
    this.inner=document.createElement('div');
    this.inner.id='vsInner';
    this.c.appendChild(this.inner);
    this.vh=this.c.clientHeight||700;
    this.c.addEventListener('scroll',()=>{
      if(this.raf) return;
      this.raf=requestAnimationFrame(()=>{
        this.raf=null;
        this.st=this.c.scrollTop;
        this._paint();
      });
    },{passive:true});
  },

  setData(n){
    this.total=n; this.rs=-1; this.re=-1;
    /* fast DOM clear */
    this.inner.textContent='';
    this.nodes=[];
    this.inner.style.cssText='position:relative;width:100%;height:'+(n*this.ITEM_H)+'px;';
    this.st=this.c.scrollTop;
    this.vh=this.c.clientHeight||700;
    this._paint();
  },

  scrollToIndex(idx){
    const top=idx*this.ITEM_H, bot=top+this.ITEM_H, vh=this.vh, st=this.c.scrollTop;
    if(top<st)         this.c.scrollTop=top;
    else if(bot>st+vh) this.c.scrollTop=bot-vh;
    this.st=this.c.scrollTop;
    this._paint();
  },

  _paint(){
    if(!this.total) return;
    const H=this.ITEM_H, os=this.OVERSCAN;
    const start=Math.max(0,Math.floor(this.st/H)-os);
    const end=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);
    if(start===this.rs&&end===this.re) return;
    this.rs=start; this.re=end;

    /* remove nodes outside window */
    this.nodes=this.nodes.filter(nd=>{
      if(nd._i<start||nd._i>end){ this.inner.removeChild(nd); return false; }
      return true;
    });

    /* add missing */
    const have=new Set(this.nodes.map(n=>n._i));
    const frag=document.createDocumentFragment();
    for(let i=start;i<=end;i++){
      if(!have.has(i)){ frag.appendChild(this._build(i)); }
    }
    if(frag.childNodes.length) this.inner.appendChild(frag);
    this.nodes=[...this.inner.children];

    /* sync active */
    const sel=selectedIndex;
    for(const nd of this.nodes){
      const on=nd._i===sel;
      if(on!==nd._on){ nd._on=on; nd.classList.toggle('active',on); }
      if(nd._nm) nd._nm.style.color=on?'#000':'';
      if(nd._nu) nd._nu.style.color=on?'#bbb':'';
    }
  },

  _build(i){
    const ch=filtered[i];
    const li=document.createElement('li');
    li._i=i; li._on=false;
    li.style.cssText='position:absolute;top:'+(i*this.ITEM_H)+'px;left:0;right:0;height:'+this.ITEM_H+'px;';

    const ini=esc(initials(ch.name));
    const logo=ch.logo
      ? '<div class="ch-logo"><img src="'+esc(ch.logo)+'" alt="" loading="lazy"'
        +' onerror="this.style.display=\'none\';this.nextSibling.style.display=\'flex\'"'
        +' onload="this.nextSibling.style.display=\'none\'"><span class="ch-logo-fb" style="display:none">'+ini+'</span></div>'
      : '<div class="ch-logo"><span class="ch-logo-fb">'+ini+'</span></div>';

    li.innerHTML=logo
      +'<div class="ch-info"><div class="ch-name">'+esc(ch.name)+'</div></div>'
      +(isFav(ch)?'<span class="ch-fav">★</span>':'')
      +'<div class="ch-num">'+(i+1)+'</div>';

    li._nm=li.querySelector('.ch-name');
    li._nu=li.querySelector('.ch-num');

    if(i===selectedIndex){ li._on=true; li.classList.add('active'); if(li._nm)li._nm.style.color='#000'; if(li._nu)li._nu.style.color='#bbb'; }

    li.addEventListener('click',()=>{ selectedIndex=i; VS.refresh(); playSelected(); });
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
    li.style.cssText='position:absolute;top:0;left:0;right:0;padding:20px 14px;';
    li.innerHTML='<div class="ch-info"><div class="ch-name" style="color:#2a2a2a;font-size:18px">No channels</div></div>';
    VS.inner.appendChild(li);
    return;
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
    filtered=!q ? channels.slice()
      : channels.filter(c=>c.name.toLowerCase().includes(q)||c.group.toLowerCase().includes(q));
    selectedIndex=0; renderList();
  },120);
}
function commitSearch(){ setFocus('list'); if(filtered.length===1){ selectedIndex=0; VS.refresh(); playSelected(); } }
function clearSearch(){ searchInput.value=''; applySearch(); setFocus('list'); }
searchInput.addEventListener('input',applySearch);

/* ── XHR ─────────────────────────────────────────────────── */
function xhrFetch(url,ms,cb){
  let done=false;
  const xhr=new XMLHttpRequest();
  const tid=setTimeout(()=>{ if(done)return; done=true; xhr.abort(); cb(new Error('Timeout'),null); },ms);
  xhr.onreadystatechange=function(){ if(xhr.readyState!==4||done)return; done=true; clearTimeout(tid); xhr.status>=200&&xhr.status<400?cb(null,xhr.responseText):cb(new Error('HTTP '+xhr.status),null); };
  xhr.onerror=function(){ if(done)return; done=true; clearTimeout(tid); cb(new Error('Net'),null); };
  xhr.open('GET',url,true); xhr.send();
}
function mirror(url){
  try{ const u=new URL(url); if(u.hostname!=='raw.githubusercontent.com')return null;
    const p=u.pathname.split('/').filter(Boolean); if(p.length<4)return null;
    return 'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/');
  }catch(e){return null;}
}

/* ── Load playlist ───────────────────────────────────────── */
function loadPlaylist(urlOv){
  if(plIdx===FAV_IDX&&!urlOv){ showFavourites(); return; }
  const url=urlOv||PLAYLISTS[plIdx].url;
  setStatus('Loading…','loading'); startLoadBar();
  xhrFetch(url,25000,(err,text)=>{
    if(err){
      const m=mirror(url);
      if(m){ setStatus('Retrying…','loading'); xhrFetch(m,25000,(e2,t2)=>{ finishLoadBar(); e2?setStatus('Failed','error'):onLoaded(t2); }); }
      else { finishLoadBar(); setStatus('Failed','error'); }
      return;
    }
    finishLoadBar(); onLoaded(text);
  });
}
function onLoaded(text){
  channels=parseM3U(text);
  const seen=new Set(allChannels.map(c=>c.url));
  channels.forEach(c=>{ if(!seen.has(c.url)) allChannels.push(c); });
  filtered=channels.slice(); selectedIndex=0; renderList();
  try{ localStorage.setItem(PLAYLIST_KEY,String(plIdx)); }catch(e){}
  setStatus('Ready · '+channels.length+' ch','idle');
  setFocus('list');
}

/* ── Aspect ratio ────────────────────────────────────────── */
function cycleAR(){
  /* remove all ar classes */
  video.classList.remove('ar-fill','ar-cover','ar-wide');
  arIdx=(arIdx+1)%AR_MODES.length;
  const m=AR_MODES[arIdx];
  if(m.cls) video.classList.add(m.cls);
  arBtn.textContent=m.label;
  arBtn.className='ar-btn '+m.cls;
  showToast('Aspect: '+m.label.replace('⛶ ',''));
}
arBtn.addEventListener('click',cycleAR);

/* ── Playback ────────────────────────────────────────────── */
function playSelected(){
  if(!filtered.length) return;
  const ch=filtered[selectedIndex]; if(!ch) return;
  nowPlayingEl.textContent=ch.name;
  npChNumEl.textContent='CH '+(selectedIndex+1);
  videoOverlay.classList.add('hidden');
  hasPlayed=true; setStatus('Buffering…','loading'); startLoadBar();
  try{
    if(hls){ hls.destroy(); hls=null; }
    video.removeAttribute('src'); video.load();
    const url=ch.url;
    const isHLS=/\.m3u8($|\?)/i.test(url)||url.toLowerCase().includes('m3u8');
    if(isHLS){
      if(video.canPlayType('application/vnd.apple.mpegurl')&&!window.Hls){ video.src=url; video.play().catch(()=>{}); return; }
      if(window.Hls&&window.Hls.isSupported()){
        hls=new window.Hls(HLS_CFG);
        hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{ video.play().catch(()=>{}); });
        hls.on(window.Hls.Events.ERROR,(_,d)=>{
          if(!d.fatal) return;
          if(d.type===window.Hls.ErrorTypes.NETWORK_ERROR){ setStatus('Net error','error'); hls.startLoad(); }
          else if(d.type===window.Hls.ErrorTypes.MEDIA_ERROR){ setStatus('Recovering…','loading'); hls.recoverMediaError(); }
          else{ setStatus('Stream error','error'); finishLoadBar(); hls.destroy(); hls=null; }
        });
        hls.loadSource(url); hls.attachMedia(video); return;
      }
      setStatus('HLS unsupported','error'); return;
    }
    video.src=url; video.play().catch(()=>{});
  }catch(e){ finishLoadBar(); setStatus('Play error','error'); }
}

/* ── Navigation ──────────────────────────────────────────── */
function moveSel(d){
  if(!filtered.length) return;
  selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d));
  VS.scrollToIndex(selectedIndex); VS.refresh();
}
function setFocus(a){
  focusArea=a;
  if(a==='search'){ searchWrap.classList.add('active'); searchInput.focus(); }
  else{ searchWrap.classList.remove('active'); if(document.activeElement===searchInput) searchInput.blur(); }
}

/* ── Tab switch ──────────────────────────────────────────── */
function switchTab(idx){
  plIdx=idx;
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===idx));
  loadPlaylist();
}
tabBar.querySelectorAll('.tab').forEach((b,i)=>b.addEventListener('click',()=>switchTab(i)));

/* ── Number dial ─────────────────────────────────────────── */
function handleDigit(d){
  clearTimeout(dialTimer);
  dialBuffer+=d; chDialerNum.textContent=dialBuffer; chDialer.classList.add('visible');
  dialTimer=setTimeout(()=>{
    const num=parseInt(dialBuffer,10); dialBuffer=''; chDialer.classList.remove('visible');
    if(!filtered.length) return;
    const idx=Math.max(0,Math.min(filtered.length-1,num-1));
    selectedIndex=idx; VS.scrollToIndex(idx); VS.refresh();
    playSelected(); setTimeout(()=>{ if(hasPlayed) enterFS(); },600);
  },1500);
}

/* ── Fullscreen ──────────────────────────────────────────── */
function showFsHint(){ clearTimeout(fsHintTimer); fsHint.classList.add('visible'); fsHintTimer=setTimeout(()=>fsHint.classList.remove('visible'),3000); }
function enterFS(){
  const fn=videoWrap.requestFullscreen||videoWrap.webkitRequestFullscreen||videoWrap.mozRequestFullScreen;
  if(fn){ try{ fn.call(videoWrap); }catch(e){} }
  document.body.classList.add('fullscreen'); isFullscreen=true; showFsHint();
}
function exitFS(){
  const fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen;
  if(fn){ try{ fn.call(document); }catch(e){} }
  document.body.classList.remove('fullscreen'); isFullscreen=false; fsHint.classList.remove('visible');
}
function toggleFS(){ isFullscreen?exitFS():enterFS(); }

document.addEventListener('fullscreenchange',()=>{ isFullscreen=!!(document.fullscreenElement||document.webkitFullscreenElement); if(!isFullscreen){ document.body.classList.remove('fullscreen'); fsHint.classList.remove('visible'); } });
document.addEventListener('webkitfullscreenchange',()=>{ isFullscreen=!!(document.webkitFullscreenElement||document.fullscreenElement); if(!isFullscreen){ document.body.classList.remove('fullscreen'); fsHint.classList.remove('visible'); } });
video.addEventListener('dblclick',toggleFS);

/* ── Video events ────────────────────────────────────────── */
video.addEventListener('playing',()=>{ setStatus('Playing','playing'); finishLoadBar(); });
video.addEventListener('pause',  ()=>setStatus('Paused','paused'));
video.addEventListener('waiting',()=>{ setStatus('Buffering…','loading'); startLoadBar(); });
video.addEventListener('stalled',()=>setStatus('Buffering…','loading'));
video.addEventListener('error',  ()=>{ setStatus('Error','error'); finishLoadBar(); });

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

/* ── Keyboard / remote ───────────────────────────────────── */
window.addEventListener('keydown',e=>{
  const k=e.key, c=e.keyCode;

  /* digits */
  if((c>=48&&c<=57)||(c>=96&&c<=105)){
    if(focusArea!=='search'){ handleDigit(String(c>=96?c-96:c-48)); e.preventDefault(); return; }
  }

  /* back */
  if(k==='Escape'||k==='Back'||k==='GoBack'||c===10009||c===27){
    if(isFullscreen){ exitFS(); e.preventDefault(); return; }
    if(focusArea==='search'){ clearSearch(); e.preventDefault(); return; }
    try{ if(window.tizen) tizen.application.getCurrentApplication().exit(); }catch(e){}
    e.preventDefault(); return;
  }

  /* search mode */
  if(focusArea==='search'){
    if(k==='Enter'||c===13){ commitSearch(); e.preventDefault(); return; }
    if(k==='ArrowDown'||k==='ArrowUp'||c===40||c===38){ commitSearch(); }
    else return;
  }

  /* arrows */
  if(k==='ArrowUp'   ||c===38){ isFullscreen?showFsHint():moveSel(-1); e.preventDefault(); return; }
  if(k==='ArrowDown' ||c===40){ isFullscreen?showFsHint():moveSel(1);  e.preventDefault(); return; }
  if(k==='ArrowLeft' ||c===37){ isFullscreen?exitFS():setFocus('list'); e.preventDefault(); return; }
  if(k==='ArrowRight'||c===39){ if(!isFullscreen&&hasPlayed) enterFS(); e.preventDefault(); return; }

  /* enter */
  if(k==='Enter'||c===13){
    if(isFullscreen){ exitFS(); e.preventDefault(); return; }
    if(focusArea==='list'){ playSelected(); setTimeout(()=>{ if(hasPlayed) enterFS(); },600); }
    e.preventDefault(); return;
  }

  /* page */
  if(k==='PageUp')  { moveSel(-10); e.preventDefault(); return; }
  if(k==='PageDown'){ moveSel(10);  e.preventDefault(); return; }

  /* media */
  if(k==='MediaPlayPause'  ||c===10252){ video.paused?video.play().catch(()=>{}):video.pause(); e.preventDefault(); return; }
  if(k==='MediaPlay'       ||c===415)  { video.play().catch(()=>{}); e.preventDefault(); return; }
  if(k==='MediaPause'      ||c===19)   { video.pause(); e.preventDefault(); return; }
  if(k==='MediaStop'       ||c===413)  { if(hls){hls.destroy();hls=null;} video.pause(); video.removeAttribute('src'); video.load(); setStatus('Stopped','idle'); finishLoadBar(); e.preventDefault(); return; }
  if(k==='MediaFastForward'||c===417)  { moveSel(1);  playSelected(); e.preventDefault(); return; }
  if(k==='MediaRewind'     ||c===412)  { moveSel(-1); playSelected(); e.preventDefault(); return; }
  if(k==='ChannelUp'       ||c===427)  { moveSel(1);  playSelected(); e.preventDefault(); return; }
  if(k==='ChannelDown'     ||c===428)  { moveSel(-1); playSelected(); e.preventDefault(); return; }

  /* colour buttons */
  /* RED = cycle playlist tab */
  if(k==='ColorF0Red'   ||c===403){ switchTab((plIdx+1)%(PLAYLISTS.length+1)); e.preventDefault(); return; }
  /* GREEN = toggle favourite */
  if(k==='ColorF1Green' ||c===404){ if(filtered.length&&focusArea==='list') toggleFav(filtered[selectedIndex]); e.preventDefault(); return; }
  /* YELLOW = search */
  if(k==='ColorF2Yellow'||c===405){ setFocus('search'); e.preventDefault(); return; }
  /* BLUE = fullscreen */
  if(k==='ColorF3Blue'  ||c===406){ if(hasPlayed) toggleFS(); e.preventDefault(); return; }
});

/* ── Init ────────────────────────────────────────────────── */
(function init(){
  try{ const s=localStorage.getItem(PLAYLIST_KEY); if(s) plIdx=Math.min(parseInt(s,10)||0,PLAYLISTS.length-1); }catch(e){}
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===plIdx));
  VS.init(channelListEl);
  loadPlaylist();
})();
