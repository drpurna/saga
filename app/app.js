// ================================================================
// SAGA IPTV — app.js v23.0  |  Samsung Tizen OS9  |  BN59-01199F
// Tab order: M3U playlists → ★ Favs → Xtream → JioTV
// ================================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────
const FAV_KEY              = 'iptv:favs';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const AV_SYNC_KEY          = 'iptv:avSync';
const PREVIEW_DELAY        = 600;

const DEFAULT_PLAYLISTS = [
  { name: 'Telugu', url: 'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name: 'India',  url: 'https://iptv-org.github.io/iptv/countries/in.m3u'  },
];

const AR_MODES = [
  { cls: '',         label: 'Native' },
  { cls: 'ar-fill',  label: 'Fill'   },
  { cls: 'ar-cover', label: 'Crop'   },
  { cls: 'ar-wide',  label: 'Wide'   },
];

// ── Samsung BN59-01199F key codes ─────────────────────────────────
const KEY = {
  UP:33, DOWN:34, LEFT:37, RIGHT:39, ENTER:13,   // note: PgUp/Dn mapped below
  BACK:10009, EXIT:10182, INFO:457, GUIDE:458,
  PLAY:415, PAUSE:19, PLAY_PAUSE:10252,
  STOP:413, FF:417, RW:412,
  CH_UP:427, CH_DOWN:428,
  PAGE_UP:33, PAGE_DOWN:34,
  RED:403, GREEN:404, YELLOW:405, BLUE:406,
  VOL_UP:447, VOL_DOWN:448, MUTE:449,
};
// re-assign navigation keys properly
KEY.UP    = 38; KEY.DOWN  = 40;
KEY.LEFT  = 37; KEY.RIGHT = 39;

// ── Tab index layout ──────────────────────────────────────────────
// 0 … N-1   = M3U playlists
// N          = ★ Favs
// N+1        = Xtream
// N+2        = JioTV
// helpers computed each time from allPlaylists.length:
function TAB_FAV()    { return allPlaylists.length; }
function TAB_XTREAM() { return allPlaylists.length + 1; }
function TAB_JIOTV()  { return allPlaylists.length + 2; }
function TAB_TOTAL()  { return allPlaylists.length + 3; }

// ── Playlists ─────────────────────────────────────────────────────
let allPlaylists    = [];
let customPlaylists = [];
let plIdx           = 0;
let lastM3uIndex    = 0;

// ── AV Sync ───────────────────────────────────────────────────────
let avSyncOffset = 0, avSyncLabel = null;
const AV_SYNC_STEP = 50, AV_SYNC_MAX = 500;

// ── Sleep timer ───────────────────────────────────────────────────
let sleepTimer = null, sleepMinutes = 0;

// ── Stall watchdog ────────────────────────────────────────────────
let stallWatchdog = null, lastPlayTime = 0, reconnectCount = 0;
const MAX_RECONNECT = 5;

// ── DOM ───────────────────────────────────────────────────────────
const searchInput        = document.getElementById('searchInput');
const searchWrap         = document.getElementById('searchWrap');
const searchClear        = document.getElementById('searchClear');
const tabBar             = document.getElementById('tabBar');
const channelListEl      = document.getElementById('channelList');
const countBadge         = document.getElementById('countBadge');
const listLabel          = document.getElementById('listLabel');
const nowPlayingEl       = document.getElementById('nowPlaying');
const npChNumEl          = document.getElementById('npChNum');
const statusBadge        = document.getElementById('statusBadge');
const video              = document.getElementById('video');
const videoWrap          = document.getElementById('videoWrap');
const videoOverlay       = document.getElementById('videoOverlay');
const fsHint             = document.getElementById('fsHint');
const loadBar            = document.getElementById('loadBar');
const chDialer           = document.getElementById('chDialer');
const chDialerNum        = document.getElementById('chDialerNum');
const arBtn              = document.getElementById('arBtn');
const addPlaylistBtn     = document.getElementById('addPlaylistBtn');
const playlistModal      = document.getElementById('addPlaylistModal');
const playlistNameEl     = document.getElementById('playlistName');
const playlistUrlEl      = document.getElementById('playlistUrl');
const savePlaylistBtn    = document.getElementById('savePlaylistBtn');
const cancelPlaylistBtn  = document.getElementById('cancelPlaylistBtn');
const overlayTop         = document.getElementById('overlayTop');
const overlayBottom      = document.getElementById('overlayBottom');
const overlayChannelName = document.getElementById('overlayChannelName');
const overlayChannelTech = document.getElementById('overlayChannelTech');
const overlayProgramTitle= document.getElementById('overlayProgramTitle');
const overlayProgramDesc = document.getElementById('overlayProgramDesc');
const nextProgramInfo    = document.getElementById('nextProgramInfo');
const programInfoBox     = document.getElementById('programInfoBox');
const toastEl            = document.getElementById('toast');

// ── Xtream ────────────────────────────────────────────────────────
let xtreamClient = null, xtreamMode = false;
let xtreamCategories = [], xtreamChannelList = [];

const xtreamModal       = document.getElementById('xtreamLoginModal');
const xtreamServerUrl   = document.getElementById('xtreamServerUrl');
const xtreamUsername    = document.getElementById('xtreamUsername');
const xtreamPassword    = document.getElementById('xtreamPassword');
const xtreamLoginBtn    = document.getElementById('xtreamLoginBtn');
const xtreamCancelBtn   = document.getElementById('xtreamCancelBtn');
const xtreamLoginStatus = document.getElementById('xtreamLoginStatus');
const xtreamAccountInfo = document.getElementById('xtreamAccountInfo');

// ── JioTV ─────────────────────────────────────────────────────────
let jiotvClient = null, jiotvMode = false;

const jiotvModal       = document.getElementById('jiotvLoginModal');
const jiotvServerUrl   = document.getElementById('jiotvServerUrl');
const jiotvUsername    = document.getElementById('jiotvUsername');
const jiotvPassword    = document.getElementById('jiotvPassword');
const jiotvLoginBtn    = document.getElementById('jiotvLoginBtn');
const jiotvCancelBtn   = document.getElementById('jiotvCancelBtn');
const jiotvLoginStatus = document.getElementById('jiotvLoginStatus');
const jiotvAccountInfo = document.getElementById('jiotvAccountInfo');

// ── App state ─────────────────────────────────────────────────────
let channels = [], allChannels = [], filtered = [];
let selectedIndex = 0, focusArea = 'list';
let isFullscreen = false, hasPlayed = false;
let player = null, arIdx = 0, preFullscreenArMode = null;
let fsHintTimer = null, loadBarTimer = null, previewTimer = null;
let dialBuffer = '', dialTimer = null;
let favSet = new Set();
let networkQuality = 'online', connectionMonitor = null;
let overlaysVisible = false, currentPlayUrl = '';
var toastTm = null;

// ── localStorage ──────────────────────────────────────────────────
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch(e){} }
function lsGet(k)    { try { return localStorage.getItem(k); } catch(e){ return null; } }

// ── Favourites ────────────────────────────────────────────────────
(function(){ try { var r=lsGet(FAV_KEY); if(r) favSet=new Set(JSON.parse(r)); }catch(e){} })();
function saveFavs()  { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)   { return favSet.has(ch.url); }
function toggleFav(ch) {
  if (favSet.has(ch.url)) favSet.delete(ch.url); else favSet.add(ch.url);
  saveFavs();
  if (plIdx === TAB_FAV()) showFavourites();
  else VS.rebuildVisible();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(function(c){ return favSet.has(c.url); });
  selectedIndex = 0; renderList();
  setLbl('FAVOURITES', filtered.length);
  setStatus(filtered.length ? filtered.length + ' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, dur) {
  if (!toastEl) return;
  toastEl.textContent = msg; toastEl.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(function(){ toastEl.style.opacity='0'; }, dur||2200);
}

// ── Status / load bar ─────────────────────────────────────────────
function setStatus(t, c) { statusBadge.textContent = t; statusBadge.className = 'status-badge '+(c||'idle'); }
function setLbl(label, count) {
  if (listLabel) listLabel.textContent = count !== undefined ? label+' · '+count : label;
}
function startLoadBar() {
  clearTimeout(loadBarTimer);
  loadBar.style.width = '0%'; loadBar.classList.add('active');
  var w = 0;
  var tick = function(){ w=Math.min(w+Math.random()*9,85); loadBar.style.width=w+'%'; if(w<85) loadBarTimer=setTimeout(tick,200); };
  loadBarTimer = setTimeout(tick, 80);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer); loadBar.style.width='100%';
  setTimeout(function(){ loadBar.classList.remove('active'); loadBar.style.width='0%'; }, 440);
}

// ── M3U parser ────────────────────────────────────────────────────
function cleanName(raw) {
  return String(raw||'')
    .replace(/\s*\([^)]*\)/g,'').replace(/\s*\[[^\]]*\]/g,'')
    .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi,'')
    .replace(/[\|\-–—]+\s*$/g,'').replace(/\s{2,}/g,' ').replace(/>/g,'').trim();
}
function parseM3U(text) {
  var lines=String(text||'').split(/\r?\n/), out=[], meta=null;
  for (var i=0;i<lines.length;i++) {
    var line=lines[i].trim(); if(!line) continue;
    if (line.startsWith('#EXTINF')) {
      var np = line.includes(',') ? line.split(',').slice(1).join(',').trim() : 'Unknown';
      var gm = line.match(/group-title="([^"]+)"/i);
      var lm = line.match(/tvg-logo="([^"]+)"/i);
      meta = { name:cleanName(np)||np, group:gm?gm[1]:'Other', logo:lm?lm[1]:'' };
    } else if (!line.startsWith('#') && meta) {
      out.push({ name:meta.name, group:meta.group, logo:meta.logo, url:line });
      meta=null;
    }
  }
  return out;
}
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Channel tech info ─────────────────────────────────────────────
function updateChannelTech() {
  if (!player||!overlayChannelTech) return;
  try {
    var s=player.getStats?player.getStats():null, tr=player.getVariantTracks?player.getVariantTracks():[];
    var vt=tr.find(function(t){return t.active;});
    var parts=[];
    var w=vt?(vt.width||0):0, h=vt?(vt.height||0):0;
    var bw=s?(s.streamBandwidth||0):0, fps=vt?(vt.frameRate||0):0, codec=vt?(vt.videoCodec||''):'';
    if(w&&h) parts.push(w+'×'+h);
    if(bw)   parts.push((bw/1e6).toFixed(1)+' Mbps');
    if(fps)  parts.push(Math.round(fps)+' fps');
    if(codec)parts.push(codec);
    overlayChannelTech.textContent = parts.join(' · ');
  } catch(e){}
}

// ── AV Sync ───────────────────────────────────────────────────────
function loadAvSync() { var v=parseInt(lsGet(AV_SYNC_KEY)||'0',10); avSyncOffset=isNaN(v)?0:Math.max(-AV_SYNC_MAX,Math.min(AV_SYNC_MAX,v)); }
function saveAvSync() { lsSet(AV_SYNC_KEY,String(avSyncOffset)); }
function applyAvSync() {
  if(!video||!hasPlayed||avSyncOffset===0) return;
  try{ if(video.readyState>=2){ var t=video.currentTime-(avSyncOffset/1000); if(t>=0) video.currentTime=t; } }catch(e){}
  updateAvSyncLabel();
}
function adjustAvSync(sign) {
  avSyncOffset=Math.max(-AV_SYNC_MAX,Math.min(AV_SYNC_MAX,avSyncOffset+sign*AV_SYNC_STEP));
  saveAvSync(); applyAvSync();
  showToast('AV Sync: '+(avSyncOffset===0?'0 ms':(avSyncOffset>0?'+':'')+avSyncOffset+' ms'));
  updateAvSyncLabel();
}
function resetAvSync() { avSyncOffset=0; saveAvSync(); updateAvSyncLabel(); showToast('AV Sync: 0'); }
function updateAvSyncLabel() {
  if(!avSyncLabel) return;
  avSyncLabel.textContent = avSyncOffset===0?'AV: 0':'AV: '+(avSyncOffset>0?'+':'')+avSyncOffset+'ms';
  avSyncLabel.style.color = avSyncOffset===0?'var(--text-muted)':'var(--gold)';
}
function buildAvSyncBar() {
  var ctrl=document.querySelector('.player-controls'); if(!ctrl) return;
  var wrap=document.createElement('div'); wrap.id='avSyncWrap';
  var bM=document.createElement('button'); bM.className='ar-btn'; bM.textContent='◁ Audio'; bM.addEventListener('click',function(){adjustAvSync(-1);});
  avSyncLabel=document.createElement('span');
  avSyncLabel.style.cssText='font-size:12px;min-width:58px;text-align:center;cursor:pointer;white-space:nowrap;font-family:var(--font-ui);font-weight:800;color:var(--text-muted);';
  avSyncLabel.addEventListener('click',resetAvSync); updateAvSyncLabel();
  var bP=document.createElement('button'); bP.className='ar-btn'; bP.textContent='Audio ▷'; bP.addEventListener('click',function(){adjustAvSync(+1);});
  wrap.appendChild(bM); wrap.appendChild(avSyncLabel); wrap.appendChild(bP);
  ctrl.insertBefore(wrap,ctrl.firstChild);
}

// ── Sleep timer ───────────────────────────────────────────────────
function setSleepTimer(m) {
  clearSleepTimer(); sleepMinutes=m;
  if(!m){showToast('Sleep timer: Off');return;}
  showToast('Sleep timer: '+m+' min');
  sleepTimer=setTimeout(function(){
    video.pause(); if(player) player.unload(); stopStallWatchdog();
    setStatus('Sleep — stopped','idle'); showToast('Goodnight! Stopped.',4000);
    sleepTimer=null; sleepMinutes=0;
  },m*60000);
}
function clearSleepTimer(){ if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=null;} }

// ── Stall watchdog ────────────────────────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog(); reconnectCount=0; lastPlayTime=Date.now();
  stallWatchdog=setInterval(function(){
    if(video.paused||!hasPlayed||!currentPlayUrl) return;
    if(Date.now()-lastPlayTime>9000){
      if(reconnectCount<MAX_RECONNECT){
        reconnectCount++;
        setStatus('Reconnecting ('+reconnectCount+'/'+MAX_RECONNECT+')...','loading');
        startLoadBar();
        doPlay(currentPlayUrl).then(function(){reconnectCount=0;}).catch(function(){});
      } else { setStatus('Stream lost','error'); stopStallWatchdog(); }
      lastPlayTime=Date.now();
    }
  },4000);
}
function stopStallWatchdog(){ if(stallWatchdog){clearInterval(stallWatchdog);stallWatchdog=null;} }
video.addEventListener('timeupdate',function(){ if(!video.paused) lastPlayTime=Date.now(); });

// ══════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL  — GPU compositing, pool recycling, no layout thrash
// ══════════════════════════════════════════════════════════════════
var VS = {
  IH: 82, GAP: 7, OS: 4,          // item height, gap, overscan
  c:null, inner:null, vh:0, st:0, total:0,
  pool:[], nodes:{}, raf:null,

  init: function(el) {
    this.c = el; el.innerHTML='';
    this.inner = document.createElement('ul');
    this.inner.id='vsInner';
    this.inner.style.cssText='position:relative;width:100%;margin:0;padding:0;list-style:none;';
    el.appendChild(this.inner);
    this.vh = el.clientHeight||720;
    var self=this;
    el.addEventListener('scroll',function(){
      if(self.raf) return;
      self.raf=requestAnimationFrame(function(){ self.raf=null; self.st=self.c.scrollTop; self.paint(); });
    },{passive:true});
    if(window.ResizeObserver) new ResizeObserver(function(){ self.vh=self.c.clientHeight||720; self.paint(); }).observe(el);
  },

  setData: function(n) {
    this.total=n;
    for (var k in this.nodes){ var nd=this.nodes[k]; nd.style.display='none'; nd._i=-1; this.pool.push(nd); }
    this.nodes={};
    this.inner.style.height = n>0?(n*(this.IH+this.GAP)-this.GAP+16)+'px':'0';
    this.c.scrollTop=0; this.st=0; this.vh=this.c.clientHeight||720;
    this.paint();
  },

  scrollTo: function(idx) {
    var top=idx*(this.IH+this.GAP), bot=top+this.IH, pad=20;
    if(top<this.st+pad)            this.c.scrollTop=Math.max(0,top-pad);
    else if(bot>this.st+this.vh-pad) this.c.scrollTop=bot-this.vh+pad;
    this.st=this.c.scrollTop; this.paint();
  },

  centerOn: function(idx) {
    this.c.scrollTop=Math.max(0,idx*(this.IH+this.GAP)-(this.vh/2)+(this.IH/2));
    this.st=this.c.scrollTop; this.paint();
  },

  paint: function() {
    if(!this.total) return;
    var H=this.IH+this.GAP, os=this.OS;
    var s=Math.max(0,Math.floor(this.st/H)-os);
    var e=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);
    // recycle out-of-window nodes
    for(var oi in this.nodes){
      var ii=parseInt(oi,10);
      if(ii<s||ii>e){ var nd=this.nodes[oi]; nd.style.display='none'; nd._i=-1; this.pool.push(nd); delete this.nodes[oi]; }
    }
    // add missing nodes
    for(var i=s;i<=e;i++){
      if(this.nodes[i]) continue;
      var li=this.pool.pop()||this.mkNode();
      this.build(li,i);
      if(!li.parentNode) this.inner.appendChild(li);
      li.style.display=''; this.nodes[i]=li;
    }
    // sync active class
    for(var j in this.nodes){
      var n=this.nodes[j], on=(parseInt(j,10)===selectedIndex);
      if(on!==n._on){ n._on=on; n.classList.toggle('active',on); }
    }
  },

  mkNode: function() {
    var li=document.createElement('li'); li._i=-1; li._on=false;
    li.style.cssText='position:absolute;will-change:transform;transform:translateZ(0);backface-visibility:hidden;';
    this.inner.appendChild(li);
    li.addEventListener('click',function(){
      if(li._i<0) return;
      selectedIndex=li._i; VS.refresh(); cancelPreview(); schedulePreview();
    });
    return li;
  },

  build: function(li, i) {
    li._i=i; li._on=false;
    var top=i*(this.IH+this.GAP)+8;
    li.style.cssText=[
      'position:absolute','left:10px','right:10px','top:'+top+'px','height:'+this.IH+'px',
      'display:flex','align-items:center','gap:14px','padding:0 14px',
      'border-radius:16px','overflow:hidden',
      'will-change:transform','transform:translateZ(0)','backface-visibility:hidden',
    ].join(';');
    var ch=filtered[i];
    var PH="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";
    li.innerHTML=
      '<div class="ch-logo"><img src="'+esc(ch.logo||PH)+'" onerror="this.onerror=null;this.src=\''+PH+'\'" loading="lazy"></div>'+
      '<div class="ch-info"><div class="ch-name">'+esc(ch.name)+'</div></div>'+
      (isFav(ch)?'<div class="ch-fav">★</div>':'')+
      '<div class="ch-num">'+(i+1)+'</div>';
    if(i===selectedIndex){li._on=true;li.classList.add('active');}
    else li.classList.remove('active');
  },

  refresh: function() {
    for(var j in this.nodes){ var n=this.nodes[j],on=(parseInt(j,10)===selectedIndex); if(on!==n._on){n._on=on;n.classList.toggle('active',on);} }
  },

  rebuildVisible: function() { for(var j in this.nodes) this.build(this.nodes[j],parseInt(j,10)); }
};

// ── Render list ───────────────────────────────────────────────────
function renderList() {
  if(countBadge) countBadge.textContent=String(filtered.length);
  VS.setData(filtered.length);
  if(filtered.length) VS.scrollTo(selectedIndex);
}

// ── Search ────────────────────────────────────────────────────────
var sdTm=null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm=setTimeout(function(){
    var q=searchInput.value.trim().toLowerCase();
    filtered=!q?channels.slice():channels.filter(function(c){ return c.name.toLowerCase().includes(q)||(c.group||'').toLowerCase().includes(q); });
    selectedIndex=0; renderList();
    if(q) setLbl('SEARCH',filtered.length); else refreshLbl();
  },120);
}
function commitSearch(){ setFocus('list'); if(filtered.length===1){selectedIndex=0;VS.refresh();schedulePreview();} }
function clearSearch(){ searchInput.value=''; searchWrap.classList.remove('active'); applySearch(); setFocus('list'); }
searchInput.addEventListener('input',function(){ searchWrap.classList.toggle('active',searchInput.value.length>0); applySearch(); });
if(searchClear) searchClear.addEventListener('click',clearSearch);

function refreshLbl() {
  if(jiotvMode)         setLbl('JIOTV',channels.length);
  else if(xtreamMode)   setLbl('XTREAM',channels.length);
  else if(plIdx===TAB_FAV()) setLbl('FAVOURITES',filtered.length);
  else setLbl('CHANNELS',channels.length);
}

// ── XHR fetch ─────────────────────────────────────────────────────
function xhrFetch(url, ms, cb) {
  var done=false, xhr=new XMLHttpRequest();
  var tid=setTimeout(function(){if(done)return;done=true;xhr.abort();cb(new Error('Timeout'),null);},ms);
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4||done)return; done=true; clearTimeout(tid);
    if(xhr.status>=200&&xhr.status<400) cb(null,xhr.responseText);
    else cb(new Error('HTTP '+xhr.status),null);
  };
  xhr.onerror=function(){if(done)return;done=true;clearTimeout(tid);cb(new Error('Network error'),null);};
  xhr.open('GET',url,true); xhr.send();
}
function mirrorUrl(url) {
  try{
    var u=new URL(url); if(u.hostname!=='raw.githubusercontent.com') return null;
    var p=u.pathname.split('/').filter(Boolean); if(p.length<4) return null;
    return 'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/');
  }catch(e){return null;}
}

// ── M3U playlist loading ──────────────────────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();
  var rawUrl=urlOv||(plIdx<allPlaylists.length?allPlaylists[plIdx].url:null);
  if(!rawUrl) return;
  var ck='plCache:'+rawUrl, ctk='plCacheTime:'+rawUrl;
  try{
    var cached=lsGet(ck), ct=parseInt(lsGet(ctk)||'0',10);
    if(cached&&cached.length>100&&(Date.now()-ct)<600000){onLoaded(cached,true);return;}
  }catch(e){}
  setStatus('Loading...','loading'); startLoadBar();
  xhrFetch(rawUrl,30000,function(err,text){
    if(!err&&text&&text.length>100){persist(text);finishLoadBar();onLoaded(text,false);return;}
    var mirror=mirrorUrl(rawUrl);
    if(mirror){
      setStatus('Retrying mirror...','loading');
      xhrFetch(mirror,30000,function(e2,t2){
        finishLoadBar();
        if(!e2&&t2&&t2.length>100){persist(t2);onLoaded(t2,false);}
        else setStatus('Failed — check network','error');
      });
    } else {finishLoadBar();setStatus('Failed','error');}
  });
  function persist(t){ try{lsSet(ck,t);lsSet(ctk,String(Date.now()));}catch(e){} }
  function onLoaded(t,cache){
    channels=parseM3U(t); allChannels=channels.slice(); filtered=channels.slice();
    selectedIndex=0; renderList(); refreshLbl();
    lsSet('iptv:lastM3uIndex',String(plIdx));
    setStatus('Ready · '+channels.length+' ch'+(cache?' (cached)':''),'idle');
    setFocus('list');
  }
}

// ── Network monitor ───────────────────────────────────────────────
function updateNetworkIndicator() {
  var el=document.getElementById('networkIndicator'); if(!el) return;
  el.className='network-indicator';
  if(!navigator.onLine){networkQuality='offline';el.classList.add('offline');el.title='Offline';}
  else if(navigator.connection&&navigator.connection.downlink){
    var sp=navigator.connection.downlink;
    if(sp<1){networkQuality='slow';el.classList.add('slow');el.title='Slow · '+sp.toFixed(1)+' Mbps';}
    else{networkQuality='online';el.classList.add('online');el.title='Online · '+sp.toFixed(1)+' Mbps';}
  } else{networkQuality='online';el.classList.add('online');el.title='Online';}
  if(player) player.configure({streaming:{bufferingGoal:networkQuality==='slow'?5:12,rebufferingGoal:networkQuality==='slow'?1:2}});
}
function startNetworkMonitoring() {
  updateNetworkIndicator();
  if(navigator.connection) navigator.connection.addEventListener('change',updateNetworkIndicator);
  window.addEventListener('online',updateNetworkIndicator);
  window.addEventListener('offline',updateNetworkIndicator);
  connectionMonitor=setInterval(updateNetworkIndicator,10000);
}

// ── Clock ─────────────────────────────────────────────────────────
function updateClock() {
  var now=new Date();
  var ts=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  var ds=now.toLocaleDateString([],{weekday:'short',day:'2-digit',month:'short'});
  var c=document.getElementById('brandClock'),te=document.getElementById('currentTime'),de=document.getElementById('currentDate');
  if(c) c.textContent=ts; if(te) te.textContent=ts; if(de) de.textContent=ds;
}
setInterval(updateClock,1000); updateClock();

// ── Shaka ─────────────────────────────────────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if(!shaka.Player.isBrowserSupported()){console.error('[SAGA] Shaka unsupported');return;}
  player=new shaka.Player(video);
  player.configure({
    streaming:{bufferingGoal:12,rebufferingGoal:2,bufferBehind:20,stallEnabled:true,stallThreshold:1,stallSkip:0.1,autoCorrectDrift:true,gapDetectionThreshold:0.5,gapPadding:0.1,durationBackoff:1,retryParameters:{maxAttempts:5,baseDelay:500,backoffFactor:2,fuzzFactor:0.5,timeout:30000}},
    abr:{enabled:true,defaultBandwidthEstimate:500000,switchInterval:8,bandwidthUpgradeTarget:0.85,bandwidthDowngradeTarget:0.95},
    manifest:{retryParameters:{maxAttempts:5,baseDelay:1000,backoffFactor:2}},
  });
  player.addEventListener('error',function(e){
    var code=e.detail&&e.detail.code;
    setStatus(code>=7000&&code<=7999?'Network error':'Stream error','error');
    finishLoadBar();
  });
  player.addEventListener('buffering',function(ev){
    if(ev.buffering){setStatus('Buffering...','loading');startLoadBar();}
    else{setStatus('Playing','playing');finishLoadBar();}
  });
  player.addEventListener('adaptation',updateChannelTech);
  player.addEventListener('variantchanged',updateChannelTech);
}

// ── Play ──────────────────────────────────────────────────────────
async function doPlay(url) {
  if(!url) return;
  currentPlayUrl=url; reconnectCount=0;
  if(!player) await initShaka(); if(!player) return;
  try {
    await player.unload(); video.removeAttribute('src');
    await player.load(url); await video.play().catch(function(){});
    updateChannelTech();
    if(avSyncOffset!==0) setTimeout(applyAvSync,1500);
    startStallWatchdog();
  } catch(err) {
    // .ts → .m3u8 fallback
    if(url.endsWith('.ts')){
      try{
        var m3u=url.replace(/\.ts$/,'.m3u8');
        await player.unload(); await player.load(m3u); await video.play().catch(function(){});
        currentPlayUrl=m3u; updateChannelTech(); startStallWatchdog(); return;
      }catch(e2){}
    }
    // native src fallback
    try{ await player.unload(); video.src=url; video.load(); await video.play().catch(function(){}); startStallWatchdog(); }
    catch(e3){ setStatus('Play error','error'); finishLoadBar(); stopStallWatchdog(); }
  }
}

// ── Aspect ratio ──────────────────────────────────────────────────
var AR_ICON='<svg viewBox="0 0 24 24" fill="none" width="13" height="13"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/></svg> ';
function resetAspectRatio(){ video.classList.remove('ar-fill','ar-cover','ar-wide'); video.style.objectFit=''; arIdx=0; arBtn.innerHTML=AR_ICON+'Native'; arBtn.className='ar-btn'; }
function cycleAR(){
  video.classList.remove('ar-fill','ar-cover','ar-wide'); video.style.objectFit='';
  arIdx=(arIdx+1)%AR_MODES.length; var m=AR_MODES[arIdx];
  if(m.cls) video.classList.add(m.cls);
  arBtn.innerHTML=AR_ICON+m.label; arBtn.className='ar-btn'+(m.cls?' '+m.cls:'');
  showToast('Aspect: '+m.label);
}
arBtn.addEventListener('click',cycleAR);
function setARFocus(on){ arBtn.classList.toggle('focused',on); }

// ── Preview ───────────────────────────────────────────────────────
function cancelPreview(){ clearTimeout(previewTimer); previewTimer=null; }
function schedulePreview(){ cancelPreview(); previewTimer=setTimeout(function(){previewTimer=null;startPreview(selectedIndex);},PREVIEW_DELAY); }
async function startPreview(idx) {
  if(!filtered.length) return;
  var ch=filtered[idx]; if(!ch) return;
  if(overlayTop&&overlayBottom&&overlaysVisible){ overlayTop.classList.remove('info-visible'); overlayBottom.classList.remove('info-visible'); overlaysVisible=false; }
  resetAspectRatio();
  nowPlayingEl.textContent=ch.name;
  if(overlayChannelName) overlayChannelName.textContent=ch.name;
  if(npChNumEl) npChNumEl.textContent='CH '+(idx+1);
  if(!xtreamMode&&!jiotvMode){
    if(overlayProgramTitle) overlayProgramTitle.textContent='';
    if(overlayProgramDesc)  overlayProgramDesc.textContent='';
    if(nextProgramInfo)     nextProgramInfo.textContent='';
    if(programInfoBox)      programInfoBox.style.display='none';
  }
  videoOverlay.classList.add('hidden');
  hasPlayed=true; setStatus('Buffering...','loading'); startLoadBar();
  await doPlay(ch.url);
  if(xtreamMode) setTimeout(updateXtreamEpg,1200);
  if(jiotvMode&&ch.jioId) setTimeout(function(){updateJioEpg(ch.jioId);},1200);
}
function playSelected(){ cancelPreview(); startPreview(selectedIndex); }

// ── Video events ──────────────────────────────────────────────────
video.addEventListener('playing',function(){setStatus('Playing','playing');finishLoadBar();updateChannelTech();});
video.addEventListener('pause',  function(){setStatus('Paused','paused');});
video.addEventListener('waiting',function(){setStatus('Buffering...','loading');startLoadBar();});
video.addEventListener('stalled',function(){setStatus('Buffering...','loading');});
video.addEventListener('error',  function(){setStatus('Error','error');finishLoadBar();});
video.addEventListener('ended',  function(){setStatus('Ended','idle');stopStallWatchdog();});

// ── Fullscreen ────────────────────────────────────────────────────
function showFsHint(){ clearTimeout(fsHintTimer); fsHint.classList.add('visible'); fsHintTimer=setTimeout(function(){fsHint.classList.remove('visible');},3000); }
function applyExitFSState(){
  document.body.classList.remove('fullscreen'); isFullscreen=false; fsHint.classList.remove('visible');
  if(preFullscreenArMode!==null){
    video.style.objectFit=''; var rm=preFullscreenArMode; preFullscreenArMode=null;
    var m=AR_MODES[rm]; video.classList.remove('ar-fill','ar-cover','ar-wide'); if(m.cls) video.classList.add(m.cls);
    arIdx=rm; arBtn.innerHTML=AR_ICON+m.label; arBtn.className='ar-btn'+(m.cls?' '+m.cls:'');
  }
}
function enterFS(){
  var fn=videoWrap.requestFullscreen||videoWrap.webkitRequestFullscreen||videoWrap.mozRequestFullScreen;
  if(fn) try{fn.call(videoWrap);}catch(e){}
  document.body.classList.add('fullscreen'); isFullscreen=true; preFullscreenArMode=arIdx;
  video.style.objectFit='fill'; arIdx=1; arBtn.innerHTML=AR_ICON+'Fill'; arBtn.className='ar-btn ar-fill';
  if(overlayTop) overlayTop.classList.remove('info-visible');
  if(overlayBottom) overlayBottom.classList.remove('info-visible');
  overlaysVisible=false; showFsHint();
}
function exitFS(){
  var fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen;
  if(fn) try{fn.call(document);}catch(e){}
  applyExitFSState();
}
function toggleFS(){ if(isFullscreen) exitFS(); else enterFS(); }
function onFsChange(){ var f=!!(document.fullscreenElement||document.webkitFullscreenElement); if(!f&&isFullscreen) applyExitFSState(); }
document.addEventListener('fullscreenchange',onFsChange);
document.addEventListener('webkitfullscreenchange',onFsChange);
video.addEventListener('dblclick',toggleFS);

// ── Overlays ──────────────────────────────────────────────────────
function toggleOverlays(){
  if(!overlayTop||!overlayBottom) return;
  if(overlaysVisible){ overlayTop.classList.remove('info-visible'); overlayBottom.classList.remove('info-visible'); overlaysVisible=false; }
  else{ overlayTop.classList.add('info-visible'); overlayBottom.classList.add('info-visible'); overlaysVisible=true; }
}

// ── Channel dialer ────────────────────────────────────────────────
function commitChannelNumber(){
  var num=parseInt(dialBuffer,10); dialBuffer=''; chDialer.classList.remove('visible');
  if(!filtered.length||isNaN(num)||num<1) return;
  var idx=Math.min(filtered.length-1,num-1);
  cancelPreview(); selectedIndex=idx; VS.centerOn(idx); VS.refresh(); playSelected();
  showToast('CH '+(idx+1)+' · '+filtered[idx].name);
}
function handleDigit(d){
  clearTimeout(dialTimer); dialBuffer+=d; chDialerNum.textContent=dialBuffer; chDialer.classList.add('visible');
  dialTimer=setTimeout(function(){dialTimer=null;commitChannelNumber();},dialBuffer.length>=3?400:1500);
}
function getDigit(e){
  var c=e.keyCode;
  if(c>=48&&c<=57) return String(c-48);
  if(c>=96&&c<=105) return String(c-96);
  if(e.key&&e.key.length===1&&e.key>='0'&&e.key<='9') return e.key;
  return null;
}

// ── Navigation ────────────────────────────────────────────────────
function moveSel(d){
  if(!filtered.length) return;
  cancelPreview(); clearTimeout(dialTimer); dialTimer=null; dialBuffer=''; chDialer.classList.remove('visible');
  selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d));
  VS.scrollTo(selectedIndex); VS.refresh(); schedulePreview();
}
function setFocus(a){
  focusArea=a; setARFocus(a==='ar');
  if(a==='search'){ searchWrap.classList.add('active'); searchInput.focus(); }
  else{ searchWrap.classList.remove('active'); if(document.activeElement===searchInput) searchInput.blur(); }
}

// ── Tizen key registration ────────────────────────────────────────
function registerKeys(){
  try{
    if(window.tizen&&tizen.tvinputdevice){
      ['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
       'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown',
       'Back','Info','Guide','0','1','2','3','4','5','6','7','8','9',
       'VolumeUp','VolumeDown','Mute','Exit','Return','PreCh'].forEach(function(k){
        try{tizen.tvinputdevice.registerKey(k);}catch(e){}
      });
    }
  }catch(e){}
}

// ── Master keydown ────────────────────────────────────────────────
window.addEventListener('keydown',function(e){
  var k=e.key, kc=e.keyCode;

  // Close any open modal first
  var anyModal=(xtreamModal&&xtreamModal.style.display==='flex')||(playlistModal&&playlistModal.style.display==='flex')||(jiotvModal&&jiotvModal.style.display==='flex');
  if(anyModal){
    if(k==='Escape'||k==='Back'||kc===KEY.BACK||kc===KEY.EXIT||kc===27){
      closeAllModals(); e.preventDefault(); return;
    }
    return;
  }

  // Digit → dialer
  var dig=getDigit(e);
  if(dig!==null&&focusArea!=='search'){ handleDigit(dig); e.preventDefault(); return; }

  // Dialer shortcuts
  if(chDialer.classList.contains('visible')){
    if(kc===KEY.ENTER||k==='Enter'){ clearTimeout(dialTimer);dialTimer=null;commitChannelNumber();e.preventDefault();return; }
    if(k==='Back'||k==='Escape'||kc===KEY.BACK||kc===27){ clearTimeout(dialTimer);dialTimer=null;dialBuffer='';chDialer.classList.remove('visible');e.preventDefault();return; }
  }

  // Back
  if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){
    if(isFullscreen)         {exitFS();e.preventDefault();return;}
    if(focusArea==='ar')     {setFocus('list');e.preventDefault();return;}
    if(focusArea==='search') {clearSearch();e.preventDefault();return;}
    try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(e2){}
    e.preventDefault();return;
  }

  // Info / Guide
  if(k==='Info'||kc===KEY.INFO||k==='Guide'||kc===KEY.GUIDE){ toggleOverlays();e.preventDefault();return; }

  // AR focus
  if(focusArea==='ar'){
    if(k==='Enter'||kc===KEY.ENTER){cycleAR();e.preventDefault();return;}
    if(k==='ArrowLeft'||kc===KEY.LEFT||k==='ArrowDown'||kc===KEY.DOWN){setFocus('list');e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT||k==='ArrowUp'||kc===KEY.UP){cycleAR();e.preventDefault();return;}
    e.preventDefault();return;
  }

  // Search focus
  if(focusArea==='search'){
    if(k==='Enter'||kc===KEY.ENTER){commitSearch();e.preventDefault();return;}
    if(k==='ArrowDown'||k==='ArrowUp'||kc===KEY.DOWN||kc===KEY.UP){commitSearch();e.preventDefault();return;}
    return;
  }

  // Arrow navigation
  if(k==='ArrowUp'   ||kc===KEY.UP)   {if(isFullscreen)showFsHint();else moveSel(-1);e.preventDefault();return;}
  if(k==='ArrowDown' ||kc===KEY.DOWN) {if(isFullscreen)showFsHint();else moveSel(1); e.preventDefault();return;}
  if(k==='ArrowLeft' ||kc===KEY.LEFT) {if(isFullscreen)exitFS();else setFocus('list');e.preventDefault();return;}
  if(k==='ArrowRight'||kc===KEY.RIGHT){if(isFullscreen)showFsHint();else setFocus('ar');e.preventDefault();return;}

  // Enter → play + fullscreen
  if(k==='Enter'||kc===KEY.ENTER){
    if(isFullscreen){exitFS();e.preventDefault();return;}
    if(focusArea==='list'){playSelected();setTimeout(function(){if(hasPlayed)enterFS();},700);}
    e.preventDefault();return;
  }

  if(k==='PageUp'  ||kc===KEY.PAGE_UP)  {moveSel(-10);e.preventDefault();return;}
  if(k==='PageDown'||kc===KEY.PAGE_DOWN){moveSel(10); e.preventDefault();return;}

  if(k==='MediaPlayPause'||kc===KEY.PLAY_PAUSE){if(video.paused)video.play().catch(function(){});else video.pause();e.preventDefault();return;}
  if(k==='MediaPlay'     ||kc===KEY.PLAY)  {video.play().catch(function(){});e.preventDefault();return;}
  if(k==='MediaPause'    ||kc===KEY.PAUSE) {video.pause();e.preventDefault();return;}
  if(k==='MediaStop'     ||kc===KEY.STOP)  {
    cancelPreview();if(player)player.unload();stopStallWatchdog();clearSleepTimer();
    video.pause();video.removeAttribute('src');setStatus('Stopped','idle');finishLoadBar();e.preventDefault();return;
  }

  if(k==='MediaFastForward'||kc===KEY.FF   ||k==='ChannelUp'  ||kc===KEY.CH_UP)  {moveSel(1); e.preventDefault();return;}
  if(k==='MediaRewind'     ||kc===KEY.RW   ||k==='ChannelDown'||kc===KEY.CH_DOWN){moveSel(-1);e.preventDefault();return;}

  // Colour buttons — RED cycles all tabs including Favs/Xtream/JioTV
  if(k==='ColorF0Red'   ||kc===KEY.RED)   {switchTab((plIdx+1)%TAB_TOTAL());e.preventDefault();return;}
  if(k==='ColorF1Green' ||kc===KEY.GREEN) {if(filtered.length&&focusArea==='list')toggleFav(filtered[selectedIndex]);e.preventDefault();return;}
  if(k==='ColorF2Yellow'||kc===KEY.YELLOW){setFocus('search');e.preventDefault();return;}
  if(k==='ColorF3Blue'  ||kc===KEY.BLUE)  {if(hasPlayed)toggleFS();e.preventDefault();return;}

  if(k==='VolumeUp'  ||kc===KEY.VOL_UP)  {video.volume=Math.min(1,video.volume+0.05);e.preventDefault();return;}
  if(k==='VolumeDown'||kc===KEY.VOL_DOWN){video.volume=Math.max(0,video.volume-0.05);e.preventDefault();return;}
  if(k==='Mute'      ||kc===KEY.MUTE)    {video.muted=!video.muted;e.preventDefault();return;}
});

document.addEventListener('tizenhwkey',function(e){
  if(e.keyName==='back'){ if(isFullscreen){exitFS();return;} try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(ex){} }
});

// ── Modals ────────────────────────────────────────────────────────
function closeAllModals(){
  if(playlistModal) playlistModal.style.display='none';
  if(xtreamModal)   xtreamModal.style.display='none';
  if(jiotvModal)    jiotvModal.style.display='none';
}
function openAddPlaylistModal(){ playlistNameEl.value=''; playlistUrlEl.value=''; playlistModal.style.display='flex'; }
function handleSavePlaylist(){
  var name=playlistNameEl?playlistNameEl.value.trim():'', url=playlistUrlEl?playlistUrlEl.value.trim():'';
  if(!name||!url){showToast('Please enter both name and URL');return;}
  if(addCustomPlaylist(name,url)){showToast('"'+name+'" added');playlistModal.style.display='none';}
  else showToast('Already exists or invalid URL');
}

// ── Playlist management ───────────────────────────────────────────
function loadCustomPlaylists(){
  try{ var s=lsGet(CUSTOM_PLAYLISTS_KEY); customPlaylists=s?JSON.parse(s):[]; }catch(e){customPlaylists=[];}
}
function saveCustomPlaylists(){ lsSet(CUSTOM_PLAYLISTS_KEY,JSON.stringify(customPlaylists)); }
function addCustomPlaylist(name,url){
  if(!name||!url) return false;
  if(customPlaylists.some(function(p){return p.url.toLowerCase()===url.toLowerCase();})) return false;
  customPlaylists.push({name:name,url:url}); saveCustomPlaylists(); rebuildAllPlaylists(); return true;
}
function rebuildAllPlaylists(){
  allPlaylists=DEFAULT_PLAYLISTS.concat(customPlaylists);
  if(plIdx>=allPlaylists.length) plIdx=0;
  rebuildTabs(); loadPlaylist();
}

// ── Tab builder — order: M3U… | ★ Favs | Xtream | JioTV ──────────
function rebuildTabs(){
  tabBar.innerHTML='';
  // M3U playlist tabs
  for(var i=0;i<allPlaylists.length;i++){
    var btn=document.createElement('button');
    btn.className='tab';
    if(!xtreamMode&&!jiotvMode&&i===plIdx) btn.classList.add('active');
    btn.textContent=allPlaylists[i].name;
    (function(idx){btn.addEventListener('click',function(){switchTab(idx);});})(i);
    tabBar.appendChild(btn);
  }
  // Favs
  var fBtn=document.createElement('button');
  fBtn.className='tab fav-tab';
  if(!xtreamMode&&!jiotvMode&&plIdx===TAB_FAV()) fBtn.classList.add('active');
  fBtn.innerHTML='★ Favs';
  fBtn.addEventListener('click',function(){switchTab(TAB_FAV());});
  tabBar.appendChild(fBtn);
  // Xtream
  var xBtn=document.createElement('button');
  xBtn.className='tab xtream-tab';
  if(xtreamMode) xBtn.classList.add('active');
  xBtn.textContent='Xtream';
  xBtn.addEventListener('click',function(){switchTab(TAB_XTREAM());});
  tabBar.appendChild(xBtn);
  // JioTV
  var jBtn=document.createElement('button');
  jBtn.className='tab jiotv-tab';
  if(jiotvMode) jBtn.classList.add('active');
  jBtn.textContent='JioTV';
  jBtn.addEventListener('click',function(){switchTab(TAB_JIOTV());});
  tabBar.appendChild(jBtn);
}

function switchTab(idx){
  var tFav=TAB_FAV(), tX=TAB_XTREAM(), tJ=TAB_JIOTV();
  if(idx<tFav){
    xtreamMode=false; jiotvMode=false; lastM3uIndex=idx; plIdx=idx;
    rebuildTabs(); loadPlaylist(); saveMode();
  } else if(idx===tFav){
    xtreamMode=false; jiotvMode=false; plIdx=tFav;
    rebuildTabs(); showFavourites();
  } else if(idx===tX){
    jiotvMode=false;
    if(!xtreamMode){
      if(xtreamClient&&xtreamClient.logged_in){ xtreamMode=true; plIdx=tX; rebuildTabs(); loadXtreamChannels(); }
      else openXtreamLogin();
    }
  } else if(idx===tJ){
    xtreamMode=false;
    if(!jiotvMode){
      if(jiotvClient&&jiotvClient.logged_in){ jiotvMode=true; plIdx=tJ; rebuildTabs(); loadJioChannels(); }
      else openJioLogin();
    }
  }
}

// ── Xtream ────────────────────────────────────────────────────────
function openXtreamLogin(){
  xtreamServerUrl.value=''; xtreamUsername.value=''; xtreamPassword.value='';
  xtreamLoginStatus.textContent=''; xtreamAccountInfo.textContent='';
  xtreamModal.style.display='flex';
}

function storeXtreamCreds(s,u,p){ lsSet('xtream:server',s); lsSet('xtream:username',u); lsSet('xtream:password',p); }
function clearXtreamCreds(){ ['xtream:server','xtream:username','xtream:password'].forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});}

async function xtreamLogin(){
  var sv=xtreamServerUrl.value.trim(), un=xtreamUsername.value.trim(), pw=xtreamPassword.value.trim();
  if(!sv||!un||!pw){xtreamLoginStatus.textContent='Fill in all fields';xtreamLoginStatus.style.color='var(--red)';return;}
  xtreamLoginBtn.disabled=true;
  xtreamLoginStatus.textContent='Connecting…'; xtreamLoginStatus.style.color='var(--gold)';
  try{
    var c=new XtreamClient({serverUrl:sv,username:un,password:pw,timeout:15000});
    var res=await c.getUserInfo(false);
    var ui=res&&res.user_info?res.user_info:res;
    if(ui&&(ui.auth===1||ui.auth==='1')){
      xtreamClient=c; xtreamClient.logged_in=true; xtreamMode=true;
      storeXtreamCreds(sv,un,pw);
      var exp=new Date(parseInt(ui.exp_date,10)*1000);
      var dl=Math.ceil((exp-new Date())/86400000);
      xtreamAccountInfo.innerHTML='✅ '+un+' · Exp: '+exp.toLocaleDateString()+' ('+dl+'d) · Max: '+ui.max_connections;
      xtreamLoginStatus.textContent='Loading channels…'; xtreamLoginStatus.style.color='var(--gold)';
      plIdx=TAB_XTREAM(); rebuildTabs();
      await loadXtreamChannels();
      xtreamModal.style.display='none';
      showToast('Welcome, '+un+'!'); saveMode();
    } else throw new Error('Auth failed');
  } catch(err){
    xtreamLoginStatus.textContent='Login failed: '+err.message; xtreamLoginStatus.style.color='var(--red)';
  } finally{ xtreamLoginBtn.disabled=false; }
}

async function loadXtreamChannels(){
  if(!xtreamClient) return;
  setStatus('Loading Xtream…','loading'); startLoadBar();
  try{
    var res=await Promise.all([xtreamClient.getLiveCategories(true),xtreamClient.getLiveStreams(null,true)]);
    xtreamCategories=res[0]; xtreamChannelList=res[1];
    var conv=xtreamChannelList.map(function(ch){
      return{name:ch.name,group:ch.category_name||'Uncategorized',logo:ch.stream_icon||'',
             url:xtreamClient.getLiveStreamUrl(ch.stream_id),streamId:ch.stream_id,epgChannelId:ch.epg_channel_id,streamType:'live'};
    });
    channels=conv; allChannels=conv.slice(); filtered=conv.slice(); selectedIndex=0;
    renderList(); setLbl('XTREAM',conv.length); setStatus('Xtream · '+conv.length+' ch','playing'); finishLoadBar();
  }catch(err){ setStatus('Failed to load channels','error'); finishLoadBar(); }
}

async function loadSavedXtream(){
  var sv=lsGet('xtream:server'),un=lsGet('xtream:username'),pw=lsGet('xtream:password');
  if(!sv||!un||!pw) return false;
  try{
    var c=new XtreamClient({serverUrl:sv,username:un,password:pw,timeout:10000});
    var res=await c.getUserInfo(false); var ui=res&&res.user_info?res.user_info:res;
    if(ui&&(ui.auth===1||ui.auth==='1')){
      xtreamClient=c; xtreamClient.logged_in=true; xtreamMode=true;
      plIdx=TAB_XTREAM(); rebuildTabs(); await loadXtreamChannels();
      showToast('Welcome back, '+un); saveMode(); return true;
    }
  }catch(e){ clearXtreamCreds(); }
  return false;
}

function atob_safe(s){ if(!s)return''; try{return decodeURIComponent(escape(atob(s)));}catch(e){return s;} }

async function updateXtreamEpg(){
  if(!xtreamMode||!xtreamClient) return;
  var ch=filtered[selectedIndex]; if(!ch||!ch.streamId) return;
  try{
    var d=await xtreamClient.getShortEpg(ch.streamId,3,true);
    var list=Array.isArray(d)?d:(d&&Array.isArray(d.epg_listings))?d.epg_listings:[];
    if(list.length>0){
      var cur=list[0],nxt=list[1];
      if(overlayProgramTitle) overlayProgramTitle.textContent=atob_safe(cur.title)||'No program info';
      if(overlayProgramDesc)  overlayProgramDesc.textContent =atob_safe(cur.description)||'';
      if(nextProgramInfo) nextProgramInfo.textContent=nxt?'Next: '+atob_safe(nxt.title)+' at '+new Date(nxt.start_timestamp*1000).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}):'';
      if(programInfoBox) programInfoBox.style.display='';
    }else{ if(overlayProgramTitle) overlayProgramTitle.textContent='No EPG'; if(programInfoBox) programInfoBox.style.display='none'; }
  }catch(e){}
}

var epgInterval=null;
function startEpgUpdater(){ if(epgInterval)clearInterval(epgInterval); epgInterval=setInterval(function(){if((xtreamMode||jiotvMode)&&!video.paused){ if(xtreamMode) updateXtreamEpg(); }},30000); }
function stopEpgUpdater(){ if(epgInterval){clearInterval(epgInterval);epgInterval=null;} }

// ── JioTV ─────────────────────────────────────────────────────────
function openJioLogin(){
  jiotvServerUrl.value=''; jiotvUsername.value=''; jiotvPassword.value='';
  jiotvLoginStatus.textContent=''; jiotvAccountInfo.textContent='';
  jiotvModal.style.display='flex';
}

function storeJiotvCreds(s,u,p){ lsSet('jiotv:server',s); lsSet('jiotv:username',u); lsSet('jiotv:password',p); }
function clearJiotvCreds(){ ['jiotv:server','jiotv:username','jiotv:password'].forEach(function(k){try{localStorage.removeItem(k);}catch(e){}});}

async function jiotvLoginAction(){
  var sv=jiotvServerUrl.value.trim(), un=jiotvUsername.value.trim(), pw=jiotvPassword.value.trim();
  if(!sv){jiotvLoginStatus.textContent='Server URL required';jiotvLoginStatus.style.color='var(--red)';return;}
  jiotvLoginBtn.disabled=true;
  jiotvLoginStatus.textContent='Connecting…'; jiotvLoginStatus.style.color='var(--gold)';
  try{
    var c=new JioTVClient({serverUrl:sv,timeout:12000});
    // Check if server already logged in first
    var alive=await c.checkStatus();
    if(!alive){
      // Try to login with credentials
      if(!un||!pw) throw new Error('Server not logged in — enter credentials');
      await c.login(un,pw);
    }
    jiotvClient=c; jiotvClient.logged_in=true; jiotvMode=true;
    storeJiotvCreds(sv,un,pw);
    jiotvAccountInfo.textContent='✅ Connected to '+sv;
    jiotvLoginStatus.textContent='Loading channels…'; jiotvLoginStatus.style.color='var(--gold)';
    plIdx=TAB_JIOTV(); rebuildTabs();
    await loadJioChannels();
    jiotvModal.style.display='none';
    showToast('JioTV connected!'); saveMode();
  }catch(err){
    jiotvLoginStatus.textContent='Failed: '+err.message; jiotvLoginStatus.style.color='var(--red)';
  }finally{ jiotvLoginBtn.disabled=false; }
}

async function loadJioChannels(){
  if(!jiotvClient) return;
  setStatus('Loading JioTV…','loading'); startLoadBar();
  try{
    var list=await jiotvClient.getChannelsFormatted();
    channels=list; allChannels=list.slice(); filtered=list.slice(); selectedIndex=0;
    renderList(); setLbl('JIOTV',list.length); setStatus('JioTV · '+list.length+' ch','playing'); finishLoadBar();
  }catch(err){ setStatus('JioTV load failed','error'); finishLoadBar(); console.error('[JioTV]',err); }
}

async function loadSavedJiotv(){
  var sv=lsGet('jiotv:server'); if(!sv) return false;
  try{
    var c=new JioTVClient({serverUrl:sv,timeout:10000});
    var alive=await c.checkStatus();
    if(alive){
      jiotvClient=c; jiotvClient.logged_in=true; jiotvMode=true;
      plIdx=TAB_JIOTV(); rebuildTabs(); await loadJioChannels();
      showToast('JioTV reconnected'); saveMode(); return true;
    }
  }catch(e){ clearJiotvCreds(); }
  return false;
}

async function updateJioEpg(channelId){
  if(!jiotvMode||!jiotvClient||!channelId) return;
  try{
    var ep=await jiotvClient.getNowPlaying(channelId);
    if(ep&&overlayProgramTitle){
      overlayProgramTitle.textContent=ep.title||ep.showname||'';
      if(overlayProgramDesc) overlayProgramDesc.textContent=ep.description||'';
      if(programInfoBox) programInfoBox.style.display='';
    }
  }catch(e){}
}

// ── Mode persistence ──────────────────────────────────────────────
function saveMode(){
  if(jiotvMode)       lsSet('iptv:mode','jiotv');
  else if(xtreamMode) lsSet('iptv:mode','xtream');
  else               {lsSet('iptv:mode','m3u');lsSet('iptv:lastM3uIndex',String(plIdx));}
}
async function loadMode(){
  var mode=lsGet('iptv:mode');
  if(mode==='jiotv'){
    var ok=await loadSavedJiotv();
    if(!ok){ jiotvMode=false; fallbackM3u(); }
  } else if(mode==='xtream'){
    var ok2=await loadSavedXtream();
    if(!ok2){ xtreamMode=false; fallbackM3u(); }
  } else {
    fallbackM3u();
  }
}
function fallbackM3u(){
  var si=parseInt(lsGet('iptv:lastM3uIndex')||'0',10);
  plIdx=(!isNaN(si)&&si<allPlaylists.length)?si:0;
  rebuildTabs(); loadPlaylist();
}

// ── Boot ──────────────────────────────────────────────────────────
(async function init(){
  registerKeys();
  loadAvSync();
  loadCustomPlaylists();
  allPlaylists=DEFAULT_PLAYLISTS.concat(customPlaylists);

  VS.init(channelListEl);
  await initShaka();
  buildAvSyncBar();
  startNetworkMonitoring();
  await loadMode();

  if(overlayTop)    overlayTop.classList.remove('info-visible');
  if(overlayBottom) overlayBottom.classList.remove('info-visible');
  overlaysVisible=false;

  // Playlist modal
  if(addPlaylistBtn)    addPlaylistBtn.addEventListener('click',openAddPlaylistModal);
  if(savePlaylistBtn)   savePlaylistBtn.addEventListener('click',handleSavePlaylist);
  if(cancelPlaylistBtn) cancelPlaylistBtn.addEventListener('click',function(){playlistModal.style.display='none';});
  if(playlistModal)     playlistModal.addEventListener('click',function(e){if(e.target===playlistModal)playlistModal.style.display='none';});
  [playlistNameEl,playlistUrlEl].forEach(function(el){ if(el) el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13)handleSavePlaylist();}); });

  // Xtream modal
  if(xtreamLoginBtn)  xtreamLoginBtn.addEventListener('click',xtreamLogin);
  if(xtreamCancelBtn) xtreamCancelBtn.addEventListener('click',function(){xtreamModal.style.display='none';});
  if(xtreamModal)     xtreamModal.addEventListener('click',function(e){if(e.target===xtreamModal)xtreamModal.style.display='none';});
  [xtreamServerUrl,xtreamUsername,xtreamPassword].forEach(function(el){ if(el) el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13)xtreamLogin();}); });

  // JioTV modal
  if(jiotvLoginBtn)  jiotvLoginBtn.addEventListener('click',jiotvLoginAction);
  if(jiotvCancelBtn) jiotvCancelBtn.addEventListener('click',function(){jiotvModal.style.display='none';});
  if(jiotvModal)     jiotvModal.addEventListener('click',function(e){if(e.target===jiotvModal)jiotvModal.style.display='none';});
  [jiotvServerUrl,jiotvUsername,jiotvPassword].forEach(function(el){ if(el) el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13)jiotvLoginAction();}); });

  video.addEventListener('playing',startEpgUpdater);
  video.addEventListener('pause',  stopEpgUpdater);
  video.addEventListener('ended',  stopEpgUpdater);
})();
