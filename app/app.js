// ================================================================
// SAGA IPTV — app.js v27.0  |  Samsung Tizen OS9
// 55-inch TV · JioTV Grid Portal · Full remote nav · IP Privacy
// ================================================================
'use strict';

// ── Constants ────────────────────────────────────────────────────
const FAV_KEY              = 'iptv:favs';
const CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
const AV_SYNC_KEY          = 'iptv:avSync';
const JIOTV_SERVER_KEY     = 'jiotv:server';     // never displayed
const PREVIEW_DELAY        = 600;
const VS_IH                = 108;  // must match CSS --item-h
const VS_GAP               = 8;    // must match CSS --item-gap
const AV_SYNC_STEP         = 50;
const AV_SYNC_MAX          = 500;
const MAX_RECONNECT        = 5;

// ── Samsung BN59-01199F key codes ────────────────────────────────
const KEY = {
  UP:38,DOWN:40,LEFT:37,RIGHT:39,ENTER:13,
  BACK:10009,EXIT:10182,INFO:457,GUIDE:458,
  PLAY:415,PAUSE:19,PLAY_PAUSE:10252,
  STOP:413,FF:417,RW:412,
  CH_UP:427,CH_DOWN:428,PAGE_UP:33,PAGE_DOWN:34,
  RED:403,GREEN:404,YELLOW:405,BLUE:406,
  VOL_UP:447,VOL_DOWN:448,MUTE:449,
};

// ── Tab helpers ───────────────────────────────────────────────────
function TAB_FAV()   { return allPlaylists.length; }
function TAB_JIOTV() { return allPlaylists.length + 1; }
function TAB_TOTAL() { return allPlaylists.length + 2; }

// ── State ─────────────────────────────────────────────────────────
let allPlaylists = [], customPlaylists = [], plIdx = 0;
let channels = [], allChannels = [], filtered = [];
let selectedIndex = 0;
let focusArea = 'list'; // list|tabs|search|addBtn|avLeft|avRight
let tabFocusIdx = 0;
let isFullscreen = false, hasPlayed = false;
let player = null, currentPlayUrl = '';
let previewTimer = null, fsHintTimer = null, loadBarTimer = null;
let dialBuffer = '', dialTimer = null;
let favSet = new Set();
let avSyncOffset = 0, avSyncLabel = null;
let overlaysVisible = false;
let networkQuality = 'online', connectionMonitor = null;
let stallWatchdog = null, lastPlayTime = 0, reconnectCount = 0;
let sleepTimer = null, sleepMinutes = 0;
let epgInterval = null;
var  toastTm = null;

// JioTV state
let jiotvClient = null, jiotvMode = false;
let jiotvChannels = [];         // raw channel list for portal
let jpActiveChannel = null;     // currently playing tile
let jpPlayer = null;            // shaka for JioTV player layer
let jpOverlayTimer = null;
let jpFocusRow = 0, jpFocusCol = 0;
let jpGridCols = 0;
let jpFiltered = [];
let jpActiveCat = 'all', jpActiveLang = 'all';
let jpSearch = '';
let jpInPlayer = false;         // inside fullscreen JioTV player
let jpEpgInterval = null;

// ── DOM refs ──────────────────────────────────────────────────────
const $ = id => document.getElementById(id);

const searchInput    = $('searchInput');
const searchWrap     = $('searchWrap');
const searchClear    = $('searchClear');
const tabBar         = $('tabBar');
const channelListEl  = $('channelList');
const countBadge     = $('countBadge');
const listLabel      = $('listLabel');
const nowPlayingEl   = $('nowPlaying');
const npChNumEl      = $('npChNum');
const statusBadge    = $('statusBadge');
const video          = $('video');
const videoWrap      = $('videoWrap');
const videoOverlay   = $('videoOverlay');
const fsHint         = $('fsHint');
const loadBar        = $('loadBar');
const chDialer       = $('chDialer');
const chDialerNum    = $('chDialerNum');
const addPlaylistBtn = $('addPlaylistBtn');
const playlistModal  = $('addPlaylistModal');
const playlistNameEl = $('playlistName');
const playlistUrlEl  = $('playlistUrl');
const savePlaylistBtn    = $('savePlaylistBtn');
const cancelPlaylistBtn  = $('cancelPlaylistBtn');
const overlayTop         = $('overlayTop');
const overlayBottom      = $('overlayBottom');
const overlayChannelName = $('overlayChannelName');
const overlayChannelTech = $('overlayChannelTech');
const overlayProgramTitle= $('overlayProgramTitle');
const overlayProgramDesc = $('overlayProgramDesc');
const nextProgramInfo    = $('nextProgramInfo');
const programInfoBox     = $('programInfoBox');
const toastEl            = $('toast');

// JioTV modal
const jiotvModal      = $('jiotvLoginModal');
const jiotvServerUrl  = $('jiotvServerUrl');
const jiotvConnectBtn = $('jiotvConnectBtn');
const jiotvCancelBtn  = $('jiotvCancelBtn');
const jiotvScanBtn    = $('jiotvScanBtn');
const jiotvLoginStatus= $('jiotvLoginStatus');
const jiotvAccountInfo= $('jiotvAccountInfo');

// JioTV portal
const jiotvPortal  = $('jiotvPortal');
const appMain      = $('appMain');
const jpGrid       = $('jpGrid');
const jpFilters    = $('jpFilters');
const jpLangFilters= $('jpLangFilters');
const jpSearch_el  = $('jpSearch');
const jpCount      = $('jpCount');
const jpNowBar     = $('jpNowBar');
const jpNbThumb    = $('jpNbThumb');
const jpNbName     = $('jpNbName');
const jpNbEpg      = $('jpNbEpg');
const jpNbTech     = $('jpNbTech');
const jpPlayerLayer   = $('jpPlayerLayer');
const jpPlayerOverlay = $('jpPlayerOverlay');
const jpVideo         = $('jpVideo');
const jpPlBack        = $('jpPlBack');
const jpPlTitle       = $('jpPlTitle');
const jpPlTime        = $('jpPlTime');
const jpPlSpinner     = $('jpPlSpinner');
const jpPlProg        = $('jpPlProg');
const jpPlDesc        = $('jpPlDesc');
const jpPlTech        = $('jpPlTech');
const jpFsHint        = $('jpFsHint');
const jpExitBtn       = $('jpExitBtn');
const jpClock         = $('jpClock');

// ── localStorage ─────────────────────────────────────────────────
function lsSet(k,v){ try{localStorage.setItem(k,v);}catch(e){} }
function lsGet(k)  { try{return localStorage.getItem(k);}catch(e){return null;} }

// ── Favourites ────────────────────────────────────────────────────
(function(){ try{ var r=lsGet(FAV_KEY); if(r) favSet=new Set(JSON.parse(r)); }catch(e){} })();
function saveFavs()  { lsSet(FAV_KEY, JSON.stringify([...favSet])); }
function isFav(ch)   { return favSet.has(ch.url); }
function toggleFav(ch) {
  if(favSet.has(ch.url)) favSet.delete(ch.url); else favSet.add(ch.url);
  saveFavs();
  if(plIdx===TAB_FAV()) showFavourites(); else VS.rebuildVisible();
  showToast(isFav(ch) ? '★ Added to Favourites' : '✕ Removed from Favourites');
}
function showFavourites() {
  filtered = allChannels.filter(c => favSet.has(c.url));
  selectedIndex = 0; renderList();
  setLbl('FAVOURITES', filtered.length);
  setStatus(filtered.length ? filtered.length+' favourites' : 'No favourites yet', 'idle');
}

// ── Toast ─────────────────────────────────────────────────────────
function showToast(msg, dur) {
  if(!toastEl) return;
  toastEl.textContent = msg; toastEl.style.opacity = '1';
  clearTimeout(toastTm);
  toastTm = setTimeout(() => { toastEl.style.opacity = '0'; }, dur || 2800);
}

// ── Status/loadbar ────────────────────────────────────────────────
function setStatus(t,c) { statusBadge.textContent=t; statusBadge.className='status-badge '+(c||'idle'); }
function setLbl(label,count) { if(listLabel) listLabel.textContent = count!==undefined ? label+' · '+count : label; }
function startLoadBar() {
  clearTimeout(loadBarTimer); loadBar.style.width='0%'; loadBar.classList.add('active');
  var w=0;
  var tick=function(){ w=Math.min(w+Math.random()*9,85); loadBar.style.width=w+'%'; if(w<85)loadBarTimer=setTimeout(tick,200); };
  loadBarTimer=setTimeout(tick,80);
}
function finishLoadBar() {
  clearTimeout(loadBarTimer); loadBar.style.width='100%';
  setTimeout(()=>{ loadBar.classList.remove('active'); loadBar.style.width='0%'; }, 440);
}
function refreshLbl() {
  if(jiotvMode)           setLbl('JIOTV', channels.length);
  else if(plIdx===TAB_FAV()) setLbl('FAVOURITES', filtered.length);
  else                    setLbl('CHANNELS', channels.length);
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
  for(var i=0;i<lines.length;i++){
    var line=lines[i].trim(); if(!line) continue;
    if(line.startsWith('#EXTINF')){
      var np=line.includes(',')?line.split(',').slice(1).join(',').trim():'Unknown';
      var gm=line.match(/group-title="([^"]+)"/i);
      var lm=line.match(/tvg-logo="([^"]+)"/i);
      meta={name:cleanName(np)||np,group:gm?gm[1]:'Other',logo:lm?lm[1]:''};
    } else if(!line.startsWith('#')&&meta){
      out.push({name:meta.name,group:meta.group,logo:meta.logo,url:line});
      meta=null;
    }
  }
  return out;
}
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

// ── Channel tech info ─────────────────────────────────────────────
function updateChannelTech() {
  if(!player||!overlayChannelTech) return;
  try {
    var s=player.getStats?player.getStats():null;
    var tr=player.getVariantTracks?player.getVariantTracks():[];
    var vt=tr.find(t=>t.active);
    var parts=[];
    if(vt&&vt.width&&vt.height) parts.push(vt.width+'×'+vt.height);
    if(s&&s.streamBandwidth) parts.push((s.streamBandwidth/1e6).toFixed(1)+' Mbps');
    if(vt&&vt.frameRate) parts.push(Math.round(vt.frameRate)+' fps');
    if(vt&&vt.videoCodec) parts.push(vt.videoCodec);
    overlayChannelTech.textContent = parts.join(' · ');
  } catch(e){}
}

// ── AV Sync ───────────────────────────────────────────────────────
function loadAvSync() { var v=parseInt(lsGet(AV_SYNC_KEY)||'0',10); avSyncOffset=isNaN(v)?0:Math.max(-AV_SYNC_MAX,Math.min(AV_SYNC_MAX,v)); }
function saveAvSync() { lsSet(AV_SYNC_KEY,String(avSyncOffset)); }
function applyAvSync() {
  if(!video||!hasPlayed||avSyncOffset===0) return;
  try{ if(video.readyState>=2){ var t=video.currentTime-(avSyncOffset/1000); if(t>=0)video.currentTime=t; } }catch(e){}
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
  var bM=document.createElement('button'); bM.className='av-btn'; bM.id='avBtnLeft'; bM.textContent='◁ Audio';
  bM.addEventListener('click',()=>adjustAvSync(-1));
  avSyncLabel=document.createElement('span'); avSyncLabel.className='av-label';
  avSyncLabel.addEventListener('click',resetAvSync); updateAvSyncLabel();
  var bP=document.createElement('button'); bP.className='av-btn'; bP.id='avBtnRight'; bP.textContent='Audio ▷';
  bP.addEventListener('click',()=>adjustAvSync(+1));
  wrap.appendChild(bM); wrap.appendChild(avSyncLabel); wrap.appendChild(bP);
  ctrl.insertBefore(wrap,ctrl.firstChild);
}

// ── Sleep timer ───────────────────────────────────────────────────
function setSleepTimer(m) {
  clearSleepTimer(); sleepMinutes=m;
  if(!m){showToast('Sleep timer: Off');return;}
  showToast('Sleep timer: '+m+' min');
  sleepTimer=setTimeout(()=>{
    video.pause(); if(player)player.unload(); stopStallWatchdog(); clearSleepTimer();
    setStatus('Sleep — stopped','idle'); showToast('Goodnight!',4000);
    sleepTimer=null; sleepMinutes=0;
  },m*60000);
}
function clearSleepTimer(){ if(sleepTimer){clearTimeout(sleepTimer);sleepTimer=null;} }

// ── Stall watchdog ────────────────────────────────────────────────
function startStallWatchdog() {
  stopStallWatchdog(); reconnectCount=0; lastPlayTime=Date.now();
  stallWatchdog=setInterval(()=>{
    if(video.paused||!hasPlayed||!currentPlayUrl) return;
    if(Date.now()-lastPlayTime>9000){
      if(reconnectCount<MAX_RECONNECT){
        reconnectCount++; setStatus('Reconnecting ('+reconnectCount+'/'+MAX_RECONNECT+')…','loading'); startLoadBar();
        doPlay(currentPlayUrl).then(()=>{reconnectCount=0;}).catch(()=>{});
      } else { setStatus('Stream lost','error'); stopStallWatchdog(); }
      lastPlayTime=Date.now();
    }
  },4000);
}
function stopStallWatchdog(){ if(stallWatchdog){clearInterval(stallWatchdog);stallWatchdog=null;} }
video.addEventListener('timeupdate',()=>{ if(!video.paused) lastPlayTime=Date.now(); });

// ═══════════════════════════════════════════════════════════════
// VIRTUAL SCROLL
// ═══════════════════════════════════════════════════════════════
var VS = {
  IH:VS_IH, GAP:VS_GAP, OS:4,
  c:null, inner:null, vh:0, st:0, total:0,
  pool:[], nodes:{}, raf:null,

  init(el){
    this.c=el; el.innerHTML='';
    this.inner=document.createElement('ul');
    this.inner.id='vsInner';
    this.inner.style.cssText='position:relative;width:100%;margin:0;padding:0;list-style:none;';
    el.appendChild(this.inner);
    this.vh=el.clientHeight||900;
    el.addEventListener('scroll',()=>{
      if(this.raf)return;
      this.raf=requestAnimationFrame(()=>{ this.raf=null; this.st=this.c.scrollTop; this.paint(); });
    },{passive:true});
    if(window.ResizeObserver) new ResizeObserver(()=>{ this.vh=this.c.clientHeight||900; this.paint(); }).observe(el);
  },
  setData(n){
    this.total=n;
    for(var k in this.nodes){ var nd=this.nodes[k]; nd.style.display='none'; nd._i=-1; this.pool.push(nd); }
    this.nodes={};
    this.inner.style.height=n>0?(n*(this.IH+this.GAP)-this.GAP+20)+'px':'0';
    this.c.scrollTop=0; this.st=0; this.vh=this.c.clientHeight||900; this.paint();
  },
  scrollTo(idx){
    var top=idx*(this.IH+this.GAP), bot=top+this.IH, pad=24;
    if(top<this.st+pad)           this.c.scrollTop=Math.max(0,top-pad);
    else if(bot>this.st+this.vh-pad) this.c.scrollTop=bot-this.vh+pad;
    this.st=this.c.scrollTop; this.paint();
  },
  centerOn(idx){
    this.c.scrollTop=Math.max(0,idx*(this.IH+this.GAP)-(this.vh/2)+(this.IH/2));
    this.st=this.c.scrollTop; this.paint();
  },
  paint(){
    if(!this.total) return;
    var H=this.IH+this.GAP, os=this.OS;
    var s=Math.max(0,Math.floor(this.st/H)-os);
    var e=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);
    for(var oi in this.nodes){
      var ii=parseInt(oi,10);
      if(ii<s||ii>e){ var nd=this.nodes[oi]; nd.style.display='none'; nd._i=-1; this.pool.push(nd); delete this.nodes[oi]; }
    }
    for(var i=s;i<=e;i++){
      if(this.nodes[i]) continue;
      var li=this.pool.pop()||this.mkNode();
      this.build(li,i); if(!li.parentNode)this.inner.appendChild(li);
      li.style.display=''; this.nodes[i]=li;
    }
    for(var j in this.nodes){
      var n=this.nodes[j], on=(parseInt(j,10)===selectedIndex);
      if(on!==n._on){n._on=on;n.classList.toggle('active',on);}
    }
  },
  mkNode(){
    var li=document.createElement('li'); li._i=-1; li._on=false;
    li.style.cssText='position:absolute;will-change:transform;transform:translateZ(0);backface-visibility:hidden;';
    this.inner.appendChild(li);
    li.addEventListener('click',()=>{ if(li._i<0)return; selectedIndex=li._i; VS.refresh(); cancelPreview(); schedulePreview(); });
    return li;
  },
  build(li,i){
    li._i=i; li._on=false;
    var top=i*(this.IH+this.GAP)+10;
    li.style.cssText=['position:absolute','left:12px','right:12px','top:'+top+'px','height:'+this.IH+'px',
      'display:flex','align-items:center','gap:16px','padding:0 18px',
      'border-radius:18px','overflow:hidden','will-change:transform','transform:translateZ(0)','backface-visibility:hidden'].join(';');
    var ch=filtered[i];
    var PH="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";
    li.innerHTML=
      '<div class="ch-logo"><img src="'+esc(ch.logo||PH)+'" onerror="this.onerror=null;this.src=\''+PH+'\'" loading="lazy"></div>'+
      '<div class="ch-info"><div class="ch-name">'+esc(ch.name)+'</div></div>'+
      (isFav(ch)?'<div class="ch-fav">★</div>':'')+
      '<div class="ch-num">'+(i+1)+'</div>';
    if(i===selectedIndex){li._on=true;li.classList.add('active');} else li.classList.remove('active');
  },
  refresh(){ for(var j in this.nodes){var n=this.nodes[j],on=(parseInt(j,10)===selectedIndex);if(on!==n._on){n._on=on;n.classList.toggle('active',on);}} },
  rebuildVisible(){ for(var j in this.nodes) this.build(this.nodes[j],parseInt(j,10)); },
};

// ── Render list ───────────────────────────────────────────────────
function renderList() { if(countBadge) countBadge.textContent=String(filtered.length); VS.setData(filtered.length); if(filtered.length) VS.scrollTo(selectedIndex); }

// ── Search ────────────────────────────────────────────────────────
var sdTm=null;
function applySearch() {
  clearTimeout(sdTm);
  sdTm=setTimeout(()=>{
    var q=searchInput.value.trim().toLowerCase();
    filtered=!q?channels.slice():channels.filter(c=>c.name.toLowerCase().includes(q)||(c.group||'').toLowerCase().includes(q));
    selectedIndex=0; renderList();
    if(q) setLbl('SEARCH',filtered.length); else refreshLbl();
  },120);
}
function commitSearch() { setFocus('list'); if(filtered.length===1){selectedIndex=0;VS.refresh();schedulePreview();} }
function clearSearch()  { searchInput.value=''; searchWrap.classList.remove('active'); applySearch(); setFocus('list'); }
searchInput.addEventListener('input',()=>{ searchWrap.classList.toggle('active',searchInput.value.length>0); applySearch(); });
if(searchClear) searchClear.addEventListener('click',clearSearch);

// ── XHR fetch + CDN mirror ────────────────────────────────────────
function xhrFetch(url,ms,cb) {
  var done=false, xhr=new XMLHttpRequest();
  var tid=setTimeout(()=>{if(done)return;done=true;xhr.abort();cb(new Error('Timeout'),null);},ms);
  xhr.onreadystatechange=function(){if(xhr.readyState!==4||done)return;done=true;clearTimeout(tid);if(xhr.status>=200&&xhr.status<400)cb(null,xhr.responseText);else cb(new Error('HTTP '+xhr.status),null);};
  xhr.onerror=()=>{if(done)return;done=true;clearTimeout(tid);cb(new Error('Network error'),null);};
  xhr.open('GET',url,true); xhr.send();
}
function mirrorUrl(url) {
  try{ var u=new URL(url); if(u.hostname!=='raw.githubusercontent.com')return null; var p=u.pathname.split('/').filter(Boolean); if(p.length<4)return null; return 'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/'); }catch(e){return null;}
}

// ── M3U playlist loading ──────────────────────────────────────────
function loadPlaylist(urlOv) {
  cancelPreview();
  var rawUrl=urlOv||(plIdx<allPlaylists.length?allPlaylists[plIdx].url:null);
  if(!rawUrl) return;
  var ck='plCache:'+rawUrl, ctk='plCacheTime:'+rawUrl;
  try{ var cached=lsGet(ck),ct=parseInt(lsGet(ctk)||'0',10); if(cached&&cached.length>100&&(Date.now()-ct)<600000){onLoaded(cached,true);return;} }catch(e){}
  setStatus('Loading…','loading'); startLoadBar();
  xhrFetch(rawUrl,30000,(err,text)=>{
    if(!err&&text&&text.length>100){persist(text);finishLoadBar();onLoaded(text,false);return;}
    var mirror=mirrorUrl(rawUrl);
    if(mirror){ setStatus('Retrying mirror…','loading'); xhrFetch(mirror,30000,(e2,t2)=>{finishLoadBar();if(!e2&&t2&&t2.length>100){persist(t2);onLoaded(t2,false);}else setStatus('Failed — check network','error');}); }
    else{finishLoadBar();setStatus('Failed','error');}
  });
  function persist(t){try{lsSet(ck,t);lsSet(ctk,String(Date.now()));}catch(e){}}
  function onLoaded(t,fromCache){
    channels=parseM3U(t);allChannels=channels.slice();filtered=channels.slice();
    selectedIndex=0;renderList();refreshLbl();
    lsSet('iptv:lastM3uIndex',String(plIdx));
    setStatus('Ready · '+channels.length+' ch'+(fromCache?' (cached)':''),'idle');
    setFocus('list');
  }
}

// ── Network monitor ───────────────────────────────────────────────
function updateNetworkIndicator() {
  var el=$('networkIndicator'); if(!el)return;
  el.className='network-indicator';
  if(!navigator.onLine){networkQuality='offline';el.classList.add('offline');}
  else if(navigator.connection&&navigator.connection.downlink){
    var sp=navigator.connection.downlink;
    if(sp<1){networkQuality='slow';el.classList.add('slow');}
    else{networkQuality='online';el.classList.add('online');}
  }else{networkQuality='online';el.classList.add('online');}
  if(player)player.configure({streaming:{bufferingGoal:networkQuality==='slow'?5:12,rebufferingGoal:networkQuality==='slow'?1:2}});
}
function startNetworkMonitoring() {
  updateNetworkIndicator();
  if(navigator.connection)navigator.connection.addEventListener('change',updateNetworkIndicator);
  window.addEventListener('online',updateNetworkIndicator);
  window.addEventListener('offline',updateNetworkIndicator);
  connectionMonitor=setInterval(updateNetworkIndicator,10000);
}

// ── Clock ─────────────────────────────────────────────────────────
function updateClock() {
  var now=new Date();
  var ts=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  var ds=now.toLocaleDateString([],{weekday:'short',day:'2-digit',month:'short'});
  var c=$('brandClock'),te=$('currentTime'),de=$('currentDate');
  if(c)c.textContent=ts; if(te)te.textContent=ts; if(de)de.textContent=ds;
  if(jpClock)jpClock.textContent=ts;
  if(jpPlTime)jpPlTime.textContent=ts;
}
setInterval(updateClock,1000); updateClock();

// ── Shaka ─────────────────────────────────────────────────────────
async function initShaka() {
  shaka.polyfill.installAll();
  if(!shaka.Player.isBrowserSupported()){console.error('[SAGA] Shaka unsupported');return;}
  player=new shaka.Player(video);
  player.configure({
    streaming:{bufferingGoal:12,rebufferingGoal:2,bufferBehind:20,stallEnabled:true,stallThreshold:1,stallSkip:0.1,autoCorrectDrift:true,gapDetectionThreshold:0.5,gapPadding:0.1,durationBackoff:1,retryParameters:{maxAttempts:6,baseDelay:500,backoffFactor:2,fuzzFactor:0.5,timeout:30000}},
    abr:{enabled:true,defaultBandwidthEstimate:500000,switchInterval:8,bandwidthUpgradeTarget:0.85,bandwidthDowngradeTarget:0.95},
    manifest:{retryParameters:{maxAttempts:5,baseDelay:1000,backoffFactor:2}},
    drm:{retryParameters:{maxAttempts:4,baseDelay:500,backoffFactor:2,timeout:15000},advanced:{'com.widevine.alpha':{videoRobustness:'HW_SECURE_ALL',audioRobustness:'HW_SECURE_CRYPTO'}}},
  });
  player.addEventListener('error',ev=>{
    var err=ev.detail,code=err&&err.code;
    var msg=code>=6000&&code<=6999?'DRM error':code>=7000&&code<=7999?'Network error':'Stream error';
    setStatus(msg,'error'); finishLoadBar();
  });
  player.addEventListener('buffering',ev=>{ if(ev.buffering){setStatus('Buffering…','loading');startLoadBar();}else{setStatus('Playing','playing');finishLoadBar();} });
  player.addEventListener('adaptation',updateChannelTech);
  player.addEventListener('variantchanged',updateChannelTech);
}

// ── DRM config ────────────────────────────────────────────────────
function buildDrmConfig(info) {
  if(!info||!info.isDRM) return null;
  var cfg={servers:{}};
  if(info.drm_url){cfg.servers['com.widevine.alpha']=info.drm_url;cfg.advanced={'com.widevine.alpha':{videoRobustness:'HW_SECURE_ALL',audioRobustness:'HW_SECURE_CRYPTO'}};}
  else if(info.key&&info.iv){cfg.servers['org.w3.clearkey']='';cfg.clearKeys={};var kid=info.key_id||info.kid||info.key;cfg.clearKeys[kid]=info.key;}
  return Object.keys(cfg.servers).length?cfg:null;
}

// ── Play ──────────────────────────────────────────────────────────
async function doPlay(url,streamInfo) {
  if(!url) return;
  currentPlayUrl=url; reconnectCount=0;
  if(!player) await initShaka(); if(!player) return;
  var drmCfg=streamInfo?buildDrmConfig(streamInfo):null;
  try {
    await player.unload(); video.removeAttribute('src');
    if(drmCfg){player.configure({drm:drmCfg});}else{player.configure({drm:{servers:{}}});}
    await player.load(url); await video.play().catch(()=>{});
    updateChannelTech(); if(avSyncOffset!==0) setTimeout(applyAvSync,1500); startStallWatchdog();
  } catch(err) {
    if(url.endsWith('.ts')){ try{var m3u=url.replace(/\.ts$/,'.m3u8');await player.unload();await player.load(m3u);await video.play().catch(()=>{});currentPlayUrl=m3u;updateChannelTech();startStallWatchdog();return;}catch(e2){} }
    if(!drmCfg){ try{await player.unload();video.src=url;video.load();await video.play().catch(()=>{});startStallWatchdog();return;}catch(e3){} }
    setStatus('Play error','error'); finishLoadBar(); stopStallWatchdog();
  }
}

// ── Preview ───────────────────────────────────────────────────────
function cancelPreview()   { clearTimeout(previewTimer); previewTimer=null; }
function schedulePreview() { cancelPreview(); previewTimer=setTimeout(()=>{previewTimer=null;startPreview(selectedIndex);},PREVIEW_DELAY); }
async function startPreview(idx) {
  if(!filtered.length) return;
  var ch=filtered[idx]; if(!ch) return;
  if(overlayTop&&overlayBottom&&overlaysVisible){overlayTop.classList.remove('info-visible');overlayBottom.classList.remove('info-visible');overlaysVisible=false;}
  nowPlayingEl.textContent=ch.name;
  if(overlayChannelName) overlayChannelName.textContent=ch.name;
  if(npChNumEl) npChNumEl.textContent='CH '+(idx+1);
  if(!jiotvMode){if(overlayProgramTitle)overlayProgramTitle.textContent='';if(overlayProgramDesc)overlayProgramDesc.textContent='';if(nextProgramInfo)nextProgramInfo.textContent='';if(programInfoBox)programInfoBox.style.display='none';}
  videoOverlay.classList.add('hidden');
  hasPlayed=true; setStatus('Buffering…','loading'); startLoadBar();
  await doPlay(ch.url,null);
}
function playSelected() { cancelPreview(); startPreview(selectedIndex); }

// ── Video events ──────────────────────────────────────────────────
video.addEventListener('playing',()=>{setStatus('Playing','playing');finishLoadBar();updateChannelTech();});
video.addEventListener('pause',  ()=>{setStatus('Paused','paused');});
video.addEventListener('waiting',()=>{setStatus('Buffering…','loading');startLoadBar();});
video.addEventListener('stalled',()=>{setStatus('Buffering…','loading');});
video.addEventListener('error',  ()=>{setStatus('Error','error');finishLoadBar();});
video.addEventListener('ended',  ()=>{setStatus('Ended','idle');stopStallWatchdog();});

// ── Fullscreen (M3U) ──────────────────────────────────────────────
function showFsHint(){ clearTimeout(fsHintTimer);fsHint.classList.add('visible');fsHintTimer=setTimeout(()=>fsHint.classList.remove('visible'),3200); }
function applyExitFSState(){ document.body.classList.remove('fullscreen');isFullscreen=false;fsHint.classList.remove('visible'); }
function enterFS(){ var fn=videoWrap.requestFullscreen||videoWrap.webkitRequestFullscreen||videoWrap.mozRequestFullScreen;if(fn)try{fn.call(videoWrap);}catch(e){}document.body.classList.add('fullscreen');isFullscreen=true;if(overlayTop)overlayTop.classList.remove('info-visible');if(overlayBottom)overlayBottom.classList.remove('info-visible');overlaysVisible=false;showFsHint(); }
function exitFS(){ var fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen;if(fn)try{fn.call(document);}catch(e){}applyExitFSState(); }
function toggleFS(){ if(isFullscreen)exitFS();else enterFS(); }
function onFsChange(){ var f=!!(document.fullscreenElement||document.webkitFullscreenElement);if(!f&&isFullscreen)applyExitFSState(); }
document.addEventListener('fullscreenchange',onFsChange);
document.addEventListener('webkitfullscreenchange',onFsChange);
video.addEventListener('dblclick',toggleFS);

function toggleOverlays() {
  if(!overlayTop||!overlayBottom) return;
  if(overlaysVisible){overlayTop.classList.remove('info-visible');overlayBottom.classList.remove('info-visible');overlaysVisible=false;}
  else{overlayTop.classList.add('info-visible');overlayBottom.classList.add('info-visible');overlaysVisible=true;}
}

// ── Channel dialer ────────────────────────────────────────────────
function commitChannelNumber() {
  var num=parseInt(dialBuffer,10); dialBuffer=''; chDialer.classList.remove('visible');
  if(!filtered.length||isNaN(num)||num<1) return;
  var idx=Math.min(filtered.length-1,num-1);
  cancelPreview(); selectedIndex=idx; VS.centerOn(idx); VS.refresh(); playSelected();
  showToast('CH '+(idx+1)+' · '+filtered[idx].name);
}
function handleDigit(d){ clearTimeout(dialTimer); dialBuffer+=d; chDialerNum.textContent=dialBuffer; chDialer.classList.add('visible'); dialTimer=setTimeout(()=>{dialTimer=null;commitChannelNumber();},dialBuffer.length>=3?400:1500); }
function getDigit(e){ var c=e.keyCode; if(c>=48&&c<=57)return String(c-48); if(c>=96&&c<=105)return String(c-96); if(e.key&&e.key.length===1&&e.key>='0'&&e.key<='9')return e.key; return null; }

// ── Focus management ──────────────────────────────────────────────
function setFocus(a) {
  focusArea=a;
  tabBar.classList.toggle('tab-bar-focused',a==='tabs');
  if(a==='search'){searchWrap.classList.add('active');searchInput.focus();}
  else{searchWrap.classList.remove('active');if(document.activeElement===searchInput)searchInput.blur();}
  var avL=$('avBtnLeft'),avR=$('avBtnRight');
  if(avL)avL.classList.toggle('focused',a==='avLeft');
  if(avR)avR.classList.toggle('focused',a==='avRight');
  if(addPlaylistBtn)addPlaylistBtn.classList.toggle('focused',a==='addBtn');
  if(a==='tabs')syncTabHighlight(); else clearTabHighlight();
}
function syncTabHighlight(){ tabBar.querySelectorAll('.tab').forEach((b,i)=>b.classList.toggle('kbd-focus',i===tabFocusIdx)); }
function clearTabHighlight(){ tabBar.querySelectorAll('.tab').forEach(b=>b.classList.remove('kbd-focus')); }
function moveSel(d){ if(!filtered.length)return; cancelPreview(); clearTimeout(dialTimer);dialTimer=null;dialBuffer='';chDialer.classList.remove('visible'); selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d)); VS.scrollTo(selectedIndex);VS.refresh();schedulePreview(); }
function moveTabFocus(d){ var total=TAB_TOTAL(); tabFocusIdx=((tabFocusIdx+d)%total+total)%total; syncTabHighlight(); var btns=tabBar.querySelectorAll('.tab'); if(btns[tabFocusIdx])btns[tabFocusIdx].scrollIntoView({inline:'nearest',block:'nearest'}); }
function activateFocusedTab(){ switchTab(tabFocusIdx); setFocus('list'); }

// ── Tizen key registration ────────────────────────────────────────
function registerKeys() {
  try{
    if(window.tizen&&tizen.tvinputdevice){
      ['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
       'ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown',
       'Back','Info','Guide','0','1','2','3','4','5','6','7','8','9',
       'VolumeUp','VolumeDown','Mute','Exit','Return','PreCh'].forEach(k=>{try{tizen.tvinputdevice.registerKey(k);}catch(e){}});
    }
  }catch(e){}
}

// ═══════════════════════════════════════════════════════════════
// JIOTV PORTAL
// ═══════════════════════════════════════════════════════════════

function showJioPortal() {
  appMain.style.display='none';
  jiotvPortal.style.display='flex';
  jpBuildGrid();
  // set focus to grid first tile
  jpFocusRow=0; jpFocusCol=0;
  jpFocusTile();
}
function hideJioPortal() {
  jiotvPortal.style.display='none';
  appMain.style.display='grid';
  jiotvMode=false;
  // Switch back to last M3U tab
  var si=parseInt(lsGet('iptv:lastM3uIndex')||'0',10);
  plIdx=(!isNaN(si)&&si<allPlaylists.length)?si:0;
  rebuildTabs(); loadPlaylist(); setFocus('list');
  saveMode();
}

// Apply filters and rebuild grid tiles
function jpApplyFilters() {
  var q=jpSearch.toLowerCase();
  jpFiltered=jiotvChannels.filter(ch=>{
    if(jpActiveCat!=='all'&&ch.group!==jpActiveCat) return false;
    if(jpActiveLang!=='all'&&ch.lang!==jpActiveLang) return false;
    if(q&&!ch.name.toLowerCase().includes(q)) return false;
    return true;
  });
  jpBuildGrid();
}

// Build the grid DOM
function jpBuildGrid() {
  jpGrid.innerHTML='';
  if(jpCount) jpCount.textContent=jpFiltered.length+' channels';
  var PH="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";

  jpFiltered.forEach((ch,i)=>{
    var tile=document.createElement('div');
    tile.className='jp-tile';
    tile.dataset.idx=String(i);
    if(jpActiveChannel&&ch.jioId===jpActiveChannel.jioId) tile.classList.add('playing');

    tile.innerHTML=
      '<div class="jp-tile-logo"><img src="'+esc(ch.logo||PH)+'" onerror="this.onerror=null;this.src=\''+PH+'\'" loading="lazy"></div>'+
      '<div class="jp-tile-name">'+esc(ch.name)+'</div>'+
      '<div class="jp-tile-group">'+esc(ch.group||'')+'</div>'+
      (ch.isHD?'<div class="jp-tile-hd">HD</div>':'')+
      '<div class="jp-tile-live">LIVE</div>';

    tile.addEventListener('click',()=>{ jpPlayChannel(ch,i); });
    jpGrid.appendChild(tile);
  });

  // Recalc columns for keyboard nav
  requestAnimationFrame(()=>{
    var tiles=jpGrid.querySelectorAll('.jp-tile');
    if(tiles.length>0){
      var firstRect=tiles[0].getBoundingClientRect();
      var gridRect=jpGrid.getBoundingClientRect();
      jpGridCols=Math.max(1,Math.round(gridRect.width/(firstRect.width+14)));
    }
    jpFocusTile();
  });
}

function jpFocusTile() {
  var tiles=jpGrid.querySelectorAll('.jp-tile');
  tiles.forEach(t=>t.classList.remove('focused'));
  var idx=jpFocusRow*jpGridCols+jpFocusCol;
  if(idx<0) idx=0;
  if(idx>=tiles.length) idx=tiles.length-1;
  if(tiles[idx]){
    tiles[idx].classList.add('focused');
    tiles[idx].scrollIntoView({block:'nearest',inline:'nearest'});
    // Recalc row/col in case of reflow
    jpFocusRow=Math.floor(idx/Math.max(1,jpGridCols));
    jpFocusCol=idx%Math.max(1,jpGridCols);
  }
}
function jpGetFocusIdx(){ return jpFocusRow*jpGridCols+jpFocusCol; }
function jpMoveFocus(dr,dc){
  var tiles=jpGrid.querySelectorAll('.jp-tile');
  var total=tiles.length; if(!total) return;
  var rows=Math.ceil(total/jpGridCols);
  var newRow=Math.max(0,Math.min(rows-1,jpFocusRow+dr));
  var newCol=Math.max(0,Math.min(jpGridCols-1,jpFocusCol+dc));
  var newIdx=newRow*jpGridCols+newCol;
  if(newIdx>=total) newCol=total-1-newRow*jpGridCols;
  jpFocusRow=newRow; jpFocusCol=Math.max(0,newCol);
  jpFocusTile();
}
function jpActivateFilter(el) {
  var type=el.dataset.type, val=el.dataset.filter;
  if(type==='cat'){
    jpActiveCat=val;
    jpFilters.querySelectorAll('.jp-filter').forEach(b=>b.classList.toggle('active',b.dataset.filter===val&&b.dataset.type==='cat'));
  } else {
    jpActiveLang=val;
    jpLangFilters.querySelectorAll('.jp-filter').forEach(b=>b.classList.toggle('active',b.dataset.filter===val&&b.dataset.type==='lang'));
  }
  jpFocusRow=0; jpFocusCol=0;
  jpApplyFilters();
}

// ── JioTV player layer ─────────────────────────────────────────────
async function jpPlayChannel(ch,gridIdx) {
  jpActiveChannel=ch;
  jpInPlayer=true;
  jpPlayerLayer.style.display='block';
  jpPlayerOverlay.classList.add('visible');
  if(jpPlTitle) jpPlTitle.textContent=ch.name;
  if(jpPlSpinner) jpPlSpinner.classList.add('active');

  // Mark tile as playing
  jpGrid.querySelectorAll('.jp-tile').forEach(t=>t.classList.remove('playing'));
  var tiles=jpGrid.querySelectorAll('.jp-tile');
  if(gridIdx!==undefined&&tiles[gridIdx]) tiles[gridIdx].classList.add('playing');

  // Update now-bar
  jpUpdateNowBar(ch);

  try {
    // Init shaka on jpVideo if needed
    if(!jpPlayer) {
      shaka.polyfill.installAll();
      jpPlayer=new shaka.Player(jpVideo);
      jpPlayer.configure({streaming:{bufferingGoal:12,rebufferingGoal:2,stallEnabled:true,stallThreshold:1,stallSkip:0.1,retryParameters:{maxAttempts:6,baseDelay:500,backoffFactor:2,fuzzFactor:0.5,timeout:30000}},drm:{retryParameters:{maxAttempts:4,baseDelay:500,backoffFactor:2,timeout:15000},advanced:{'com.widevine.alpha':{videoRobustness:'HW_SECURE_ALL',audioRobustness:'HW_SECURE_CRYPTO'}}}});
      jpPlayer.addEventListener('error',()=>{ if(jpPlSpinner) jpPlSpinner.classList.remove('active'); });
      jpPlayer.addEventListener('buffering',ev=>{
        if(jpPlSpinner) jpPlSpinner.classList.toggle('active',ev.buffering);
        jpUpdateTechInfo();
      });
      jpPlayer.addEventListener('variantchanged',jpUpdateTechInfo);
    }

    var info=await jiotvClient.getStreamInfo(ch.jioId);
    var playUrl=info&&info.url?info.url:ch.url;
    var drmCfg=buildDrmConfig(info);

    await jpPlayer.unload(); jpVideo.removeAttribute('src');
    if(drmCfg){jpPlayer.configure({drm:drmCfg});}else{jpPlayer.configure({drm:{servers:{}}});}
    await jpPlayer.load(playUrl);
    await jpVideo.play().catch(()=>{});

    // Overlay: show briefly then hide
    jpShowOverlay();
    setTimeout(()=>{ if(jpInPlayer) jpHideOverlay(); },3000);

    // EPG
    setTimeout(()=>{ jpFetchEpg(ch.jioId); },800);
    if(jpEpgInterval) clearInterval(jpEpgInterval);
    jpEpgInterval=setInterval(()=>{ if(jpInPlayer&&ch.jioId) jpFetchEpg(ch.jioId); },30000);

  } catch(err) {
    console.error('[JioTV] jpPlayChannel',err);
    if(jpPlSpinner) jpPlSpinner.classList.remove('active');
    showToast('Stream error: '+err.message);
  }
}

function jpShowOverlay() {
  jpPlayerOverlay.classList.add('visible');
  clearTimeout(jpOverlayTimer);
  jpOverlayTimer=setTimeout(()=>jpHideOverlay(),4000);
}
function jpHideOverlay() { jpPlayerOverlay.classList.remove('visible'); }

function jpExitPlayer() {
  jpInPlayer=false;
  if(jpEpgInterval){clearInterval(jpEpgInterval);jpEpgInterval=null;}
  clearTimeout(jpOverlayTimer);
  if(jpPlayer){jpPlayer.unload().catch(()=>{});}
  jpVideo.removeAttribute('src');
  jpPlayerLayer.style.display='none';
  jpPlayerOverlay.classList.remove('visible');
  jpFocusTile();
}

function jpUpdateNowBar(ch) {
  jpNowBar.style.display='flex';
  var PH="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='56' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3C/svg%3E";
  jpNbThumb.innerHTML='<img src="'+esc(ch.logo||PH)+'" onerror="this.src=\''+PH+'\'" style="width:100%;height:100%;object-fit:contain">';
  jpNbName.textContent=ch.name;
  jpNbEpg.textContent='';
}
function jpUpdateTechInfo() {
  if(!jpPlayer) return;
  try {
    var tr=jpPlayer.getVariantTracks?jpPlayer.getVariantTracks():[];
    var vt=tr.find(t=>t.active);
    var s=jpPlayer.getStats?jpPlayer.getStats():null;
    var parts=[];
    if(vt&&vt.width&&vt.height) parts.push(vt.width+'×'+vt.height);
    if(s&&s.streamBandwidth) parts.push((s.streamBandwidth/1e6).toFixed(1)+' Mbps');
    var info=parts.join(' · ');
    if(jpPlTech) jpPlTech.textContent=info;
    if(jpNbTech)  jpNbTech.textContent=info;
  } catch(e){}
}
async function jpFetchEpg(channelId) {
  if(!jiotvClient||!channelId) return;
  try {
    var ep=await jiotvClient.getNowPlaying(channelId);
    if(ep){
      var title=ep.title||ep.showname||'';
      var desc=ep.description||'';
      if(jpPlProg)jpPlProg.textContent=title;
      if(jpPlDesc)jpPlDesc.textContent=desc;
      if(jpNbEpg)jpNbEpg.textContent=title;
    }
  }catch(e){}
}

// Filter click handlers
if(jpFilters) jpFilters.addEventListener('click',e=>{ var f=e.target.closest('.jp-filter'); if(f)jpActivateFilter(f); });
if(jpLangFilters) jpLangFilters.addEventListener('click',e=>{ var f=e.target.closest('.jp-filter'); if(f)jpActivateFilter(f); });
if(jpSearch_el) {
  jpSearch_el.addEventListener('input',()=>{
    jpSearch=jpSearch_el.value;
    jpFocusRow=0;jpFocusCol=0;
    jpApplyFilters();
  });
}
if(jpExitBtn) jpExitBtn.addEventListener('click',hideJioPortal);
if(jpPlBack) jpPlBack.addEventListener('click',jpExitPlayer);

// ═══════════════════════════════════════════════════════════════
// MASTER KEY HANDLER
// ═══════════════════════════════════════════════════════════════
window.addEventListener('keydown',function(e){
  var k=e.key, kc=e.keyCode;

  // ── JioTV Portal active ───────────────────────────────────────
  if(jiotvPortal.style.display!=='none'){
    // Inside player layer
    if(jpInPlayer){
      if(k==='ArrowUp'||kc===KEY.UP||k==='ArrowDown'||kc===KEY.DOWN||k==='ArrowLeft'||kc===KEY.LEFT||k==='ArrowRight'||kc===KEY.RIGHT||k==='Enter'||kc===KEY.ENTER){
        jpShowOverlay(); e.preventDefault(); return;
      }
      if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){
        jpExitPlayer(); e.preventDefault(); return;
      }
      if(k==='Info'||kc===KEY.INFO){
        if(jpPlayerOverlay.classList.contains('visible'))jpHideOverlay();else jpShowOverlay();
        e.preventDefault(); return;
      }
      if(k==='ColorF3Blue'||kc===KEY.BLUE){ hideJioPortal(); e.preventDefault(); return; }
      e.preventDefault(); return;
    }

    // Portal grid navigation
    if(k==='ArrowUp'   ||kc===KEY.UP)   { jpMoveFocus(-1,0); e.preventDefault(); return; }
    if(k==='ArrowDown' ||kc===KEY.DOWN) { jpMoveFocus(+1,0); e.preventDefault(); return; }
    if(k==='ArrowLeft' ||kc===KEY.LEFT) { jpMoveFocus(0,-1); e.preventDefault(); return; }
    if(k==='ArrowRight'||kc===KEY.RIGHT){ jpMoveFocus(0,+1); e.preventDefault(); return; }
    if(k==='Enter'||kc===KEY.ENTER){
      var idx=jpGetFocusIdx();
      if(jpFiltered[idx]) jpPlayChannel(jpFiltered[idx],idx);
      e.preventDefault(); return;
    }
    if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){
      hideJioPortal(); e.preventDefault(); return;
    }
    if(k==='ColorF3Blue'||kc===KEY.BLUE){ hideJioPortal(); e.preventDefault(); return; }
    if(k==='ColorF2Yellow'||kc===KEY.YELLOW){ if(jpSearch_el){jpSearch_el.focus();} e.preventDefault(); return; }
    e.preventDefault(); return;
  }

  // ── Modal open ────────────────────────────────────────────────
  var anyModal=(playlistModal&&playlistModal.style.display==='flex')||(jiotvModal&&jiotvModal.style.display==='flex');
  if(anyModal){
    if(k==='Escape'||k==='Back'||kc===KEY.BACK||kc===KEY.EXIT||kc===27){closeAllModals();e.preventDefault();return;}
    if(k==='Enter'||kc===KEY.ENTER){
      if(jiotvModal&&jiotvModal.style.display==='flex'){jiotvConnectAction();e.preventDefault();return;}
      if(playlistModal&&playlistModal.style.display==='flex'){handleSavePlaylist();e.preventDefault();return;}
      var focused=document.activeElement;if(focused&&focused.tagName==='BUTTON'){focused.click();e.preventDefault();return;}
    }
    if(k==='Tab') return;
    return;
  }

  // ── Digit dialer ──────────────────────────────────────────────
  var dig=getDigit(e);
  if(dig!==null&&focusArea!=='search'&&focusArea!=='tabs'){handleDigit(dig);e.preventDefault();return;}

  if(chDialer.classList.contains('visible')){
    if(kc===KEY.ENTER||k==='Enter'){clearTimeout(dialTimer);dialTimer=null;commitChannelNumber();e.preventDefault();return;}
    if(k==='Back'||k==='Escape'||kc===KEY.BACK||kc===27){clearTimeout(dialTimer);dialTimer=null;dialBuffer='';chDialer.classList.remove('visible');e.preventDefault();return;}
  }

  // ── Back/Escape ───────────────────────────────────────────────
  if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){
    if(isFullscreen){exitFS();e.preventDefault();return;}
    if(focusArea==='tabs'){setFocus('list');e.preventDefault();return;}
    if(focusArea==='search'){clearSearch();e.preventDefault();return;}
    if(focusArea==='avLeft'||focusArea==='avRight'){setFocus('list');e.preventDefault();return;}
    if(focusArea==='addBtn'){setFocus('list');e.preventDefault();return;}
    try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(e2){}
    e.preventDefault();return;
  }

  if(k==='Info'||kc===KEY.INFO||k==='Guide'||kc===KEY.GUIDE){toggleOverlays();e.preventDefault();return;}

  // ── Tabs focus ────────────────────────────────────────────────
  if(focusArea==='tabs'){
    if(k==='ArrowLeft' ||kc===KEY.LEFT) {moveTabFocus(-1);e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT){moveTabFocus(+1);e.preventDefault();return;}
    if(k==='Enter'     ||kc===KEY.ENTER){activateFocusedTab();e.preventDefault();return;}
    if(k==='ArrowDown' ||kc===KEY.DOWN) {setFocus('list');e.preventDefault();return;}
    if(k==='ArrowUp'   ||kc===KEY.UP)   {e.preventDefault();return;}
    e.preventDefault();return;
  }

  // ── Search focus ──────────────────────────────────────────────
  if(focusArea==='search'){
    if(k==='Enter'||kc===KEY.ENTER){commitSearch();e.preventDefault();return;}
    if(k==='ArrowDown'||k==='ArrowUp'||kc===KEY.DOWN||kc===KEY.UP){commitSearch();e.preventDefault();return;}
    return;
  }

  // ── AV Sync ───────────────────────────────────────────────────
  if(focusArea==='avLeft'){
    if(k==='Enter'||kc===KEY.ENTER){adjustAvSync(-1);e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT){setFocus('avRight');e.preventDefault();return;}
    if(k==='ArrowLeft' ||kc===KEY.LEFT) {setFocus('list');e.preventDefault();return;}
    if(k==='ArrowDown' ||kc===KEY.DOWN) {setFocus('list');e.preventDefault();return;}
    e.preventDefault();return;
  }
  if(focusArea==='avRight'){
    if(k==='Enter'||kc===KEY.ENTER){adjustAvSync(+1);e.preventDefault();return;}
    if(k==='ArrowLeft' ||kc===KEY.LEFT) {setFocus('avLeft');e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT){setFocus('list'); e.preventDefault();return;}
    if(k==='ArrowDown' ||kc===KEY.DOWN) {setFocus('list'); e.preventDefault();return;}
    e.preventDefault();return;
  }
  if(focusArea==='addBtn'){
    if(k==='Enter'||kc===KEY.ENTER){openAddPlaylistModal();e.preventDefault();return;}
    if(k==='ArrowDown'||kc===KEY.DOWN){setFocus('list');e.preventDefault();return;}
    if(k==='ArrowLeft'||kc===KEY.LEFT){setFocus('tabs');e.preventDefault();return;}
    e.preventDefault();return;
  }

  // ── List focus (default) ──────────────────────────────────────
  if(k==='ArrowUp'   ||kc===KEY.UP)   {if(isFullscreen)showFsHint();else moveSel(-1);e.preventDefault();return;}
  if(k==='ArrowDown' ||kc===KEY.DOWN) {if(isFullscreen)showFsHint();else moveSel(+1);e.preventDefault();return;}
  if(k==='ArrowLeft' ||kc===KEY.LEFT) {if(isFullscreen){exitFS();e.preventDefault();return;} tabFocusIdx=plIdx;setFocus('tabs');e.preventDefault();return;}
  if(k==='ArrowRight'||kc===KEY.RIGHT){if(isFullscreen){showFsHint();e.preventDefault();return;} if($('avBtnLeft')&&!isFullscreen){setFocus('avLeft');e.preventDefault();return;} e.preventDefault();return;}
  if(k==='Enter'||kc===KEY.ENTER){
    if(isFullscreen){exitFS();e.preventDefault();return;}
    if(focusArea==='list'){playSelected();setTimeout(()=>{if(hasPlayed)enterFS();},700);}
    e.preventDefault();return;
  }
  if(k==='PageUp'  ||kc===KEY.PAGE_UP)  {moveSel(-10);e.preventDefault();return;}
  if(k==='PageDown'||kc===KEY.PAGE_DOWN){moveSel(+10);e.preventDefault();return;}
  if(k==='MediaPlayPause'||kc===KEY.PLAY_PAUSE){if(video.paused)video.play().catch(()=>{});else video.pause();e.preventDefault();return;}
  if(k==='MediaPlay' ||kc===KEY.PLAY)  {video.play().catch(()=>{});e.preventDefault();return;}
  if(k==='MediaPause'||kc===KEY.PAUSE) {video.pause();e.preventDefault();return;}
  if(k==='MediaStop' ||kc===KEY.STOP)  {cancelPreview();if(player)player.unload();stopStallWatchdog();clearSleepTimer();video.pause();video.removeAttribute('src');setStatus('Stopped','idle');finishLoadBar();e.preventDefault();return;}
  if(k==='MediaFastForward'||kc===KEY.FF||k==='ChannelUp'  ||kc===KEY.CH_UP)  {moveSel(+1);e.preventDefault();return;}
  if(k==='MediaRewind'     ||kc===KEY.RW||k==='ChannelDown'||kc===KEY.CH_DOWN){moveSel(-1);e.preventDefault();return;}
  if(k==='ColorF0Red'   ||kc===KEY.RED)   {switchTab((plIdx+1)%TAB_TOTAL());e.preventDefault();return;}
  if(k==='ColorF1Green' ||kc===KEY.GREEN) {if(filtered.length&&focusArea==='list')toggleFav(filtered[selectedIndex]);e.preventDefault();return;}
  if(k==='ColorF2Yellow'||kc===KEY.YELLOW){setFocus('search');e.preventDefault();return;}
  if(k==='ColorF3Blue'  ||kc===KEY.BLUE)  {if(hasPlayed)toggleFS();e.preventDefault();return;}
  if(k==='VolumeUp'  ||kc===KEY.VOL_UP)   {video.volume=Math.min(1,video.volume+0.05);e.preventDefault();return;}
  if(k==='VolumeDown'||kc===KEY.VOL_DOWN)  {video.volume=Math.max(0,video.volume-0.05);e.preventDefault();return;}
  if(k==='Mute'      ||kc===KEY.MUTE)      {video.muted=!video.muted;e.preventDefault();return;}
});

document.addEventListener('tizenhwkey',e=>{
  if(e.keyName==='back'){
    if(jiotvPortal.style.display!=='none'){if(jpInPlayer)jpExitPlayer();else hideJioPortal();return;}
    if(isFullscreen){exitFS();return;}
    try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(ex){}
  }
});

// ── Modals ────────────────────────────────────────────────────────
function closeAllModals() {
  if(playlistModal)playlistModal.style.display='none';
  if(jiotvModal)jiotvModal.style.display='none';
  setFocus('list');
}
function openAddPlaylistModal() {
  if(playlistNameEl)playlistNameEl.value='';
  if(playlistUrlEl)playlistUrlEl.value='';
  playlistModal.style.display='flex';
  setTimeout(()=>{if(playlistNameEl)playlistNameEl.focus();},120);
}
function handleSavePlaylist() {
  var name=(playlistNameEl?playlistNameEl.value.trim():'');
  var url=(playlistUrlEl?playlistUrlEl.value.trim():'');
  if(!name||!url){showToast('Please enter both name and URL');return;}
  if(addCustomPlaylist(name,url)){showToast('"'+name+'" added');playlistModal.style.display='none';}
  else showToast('Already exists or invalid URL');
}

// ── Playlist management ───────────────────────────────────────────
function loadCustomPlaylists(){try{var s=lsGet(CUSTOM_PLAYLISTS_KEY);customPlaylists=s?JSON.parse(s):[];}catch(e){customPlaylists=[];}}
function saveCustomPlaylists(){lsSet(CUSTOM_PLAYLISTS_KEY,JSON.stringify(customPlaylists));}
function addCustomPlaylist(name,url){
  if(!name||!url)return false;
  if(customPlaylists.some(p=>p.url.toLowerCase()===url.toLowerCase()))return false;
  customPlaylists.push({name,url});saveCustomPlaylists();rebuildAllPlaylists();return true;
}
function rebuildAllPlaylists(){
  allPlaylists=DEFAULT_PLAYLISTS.concat(customPlaylists);
  if(plIdx>=TAB_FAV())plIdx=0;
  rebuildTabs();loadPlaylist();
}

// ── Tabs ─────────────────────────────────────────────────────────
function rebuildTabs() {
  tabBar.innerHTML='';
  allPlaylists.forEach((pl,i)=>{
    var btn=document.createElement('button');btn.className='tab';
    if(!jiotvMode&&i===plIdx)btn.classList.add('active');
    btn.textContent=pl.name;btn.dataset.tabIdx=String(i);
    btn.addEventListener('click',()=>switchTab(i));tabBar.appendChild(btn);
  });
  var fBtn=document.createElement('button');fBtn.className='tab fav-tab';fBtn.dataset.tabIdx=String(TAB_FAV());
  if(!jiotvMode&&plIdx===TAB_FAV())fBtn.classList.add('active');fBtn.textContent='★ Favs';
  fBtn.addEventListener('click',()=>switchTab(TAB_FAV()));tabBar.appendChild(fBtn);
  var jBtn=document.createElement('button');jBtn.className='tab jiotv-tab';jBtn.dataset.tabIdx=String(TAB_JIOTV());
  if(jiotvMode)jBtn.classList.add('active');
  jBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="opacity:0.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> JioTV';
  jBtn.addEventListener('click',()=>switchTab(TAB_JIOTV()));tabBar.appendChild(jBtn);
  if(focusArea==='tabs')syncTabHighlight();
}

function switchTab(idx) {
  var tFav=TAB_FAV(),tJ=TAB_JIOTV();
  if(idx<tFav){jiotvMode=false;plIdx=idx;rebuildTabs();loadPlaylist();saveMode();}
  else if(idx===tFav){jiotvMode=false;plIdx=tFav;rebuildTabs();showFavourites();saveMode();}
  else if(idx===tJ){
    if(jiotvClient&&jiotvClient.logged_in){openJioPortalDirect();}
    else{openJioLogin();}
  }
  setFocus('list');
}
function openJioPortalDirect() {
  jiotvMode=true; plIdx=TAB_JIOTV(); rebuildTabs();
  // Load channels if not yet loaded
  if(jiotvChannels.length===0){
    loadJioChannels().then(()=>showJioPortal());
  } else {
    jpFiltered=jiotvChannels.slice();
    showJioPortal();
  }
  saveMode();
}

// ── JioTV connection (modal) ─────────────────────────────────────
function setJioStatus(msg,color){if(!jiotvLoginStatus)return;jiotvLoginStatus.textContent=msg;jiotvLoginStatus.style.color=color||'var(--text-sec)';}

function openJioLogin() {
  var saved=lsGet(JIOTV_SERVER_KEY)||'';
  // Privacy: show a placeholder, not the actual IP
  if(jiotvServerUrl){jiotvServerUrl.value=saved?'••• (saved, tap Scan to re-detect)':'';}
  setJioStatus('','');if(jiotvAccountInfo)jiotvAccountInfo.textContent='';
  jiotvModal.style.display='flex';
  setTimeout(()=>{if(!saved&&jiotvServerUrl)jiotvServerUrl.focus();},120);
  if(!saved){
    setJioStatus('🔍 Scanning 172.20.10.1–200…','var(--gold)');
    JioTVClient.discover(null).then(found=>{
      if(found&&jiotvServerUrl&&!lsGet(JIOTV_SERVER_KEY)){jiotvServerUrl.value='';lsSet(JIOTV_SERVER_KEY,found);setJioStatus('✅ Server found on your network','var(--green)');}
      else if(!found)setJioStatus('⚠️ Not found. Enter URL manually.','var(--red)');
    });
  }
}

async function jiotvConnectAction() {
  // Resolve actual URL: if field shows placeholder, use stored; else use field value
  var fieldVal=(jiotvServerUrl?jiotvServerUrl.value.trim():'');
  var sv=fieldVal.startsWith('•')||fieldVal===''?lsGet(JIOTV_SERVER_KEY)||'':fieldVal;
  if(!sv){setJioStatus('Server URL required','var(--red)');return;}
  if(!sv.startsWith('http'))sv='http://'+sv;
  lsSet(JIOTV_SERVER_KEY,sv); // save before display (field shows masked below)
  if(jiotvServerUrl)jiotvServerUrl.value='••• (connecting…)';
  if(jiotvConnectBtn)jiotvConnectBtn.disabled=true;
  setJioStatus('Connecting…','var(--gold)');
  try {
    var alive=await JioTVClient.probe(sv,4000);
    if(!alive){setJioStatus('❌ Cannot reach server. Check URL and ensure JioTV Go is running.','var(--red)');if(jiotvConnectBtn)jiotvConnectBtn.disabled=false;if(jiotvServerUrl)jiotvServerUrl.value='';return;}
    var c=new JioTVClient({serverUrl:sv,timeout:12000});
    setJioStatus('Checking login status…','var(--gold)');
    var res=await c.checkStatus();
    if(!res.status){setJioStatus('⚠️ Server found but not logged in. Open the JioTV Go app on your phone and login via OTP first, then try again.','var(--gold)');if(jiotvConnectBtn)jiotvConnectBtn.disabled=false;if(jiotvServerUrl)jiotvServerUrl.value='';return;}
    jiotvClient=c;jiotvClient.logged_in=true;jiotvMode=true;
    if(jiotvAccountInfo)jiotvAccountInfo.textContent='✅ Connected · '+res.channelCount+' channels';
    setJioStatus('Loading channels…','var(--gold)');
    plIdx=TAB_JIOTV();rebuildTabs();
    await loadJioChannels();
    jiotvModal.style.display='none';
    showToast('JioTV connected! '+res.channelCount+' ch');
    saveMode();
    showJioPortal();
  }catch(err){
    setJioStatus('Failed: '+err.message,'var(--red)');
    if(jiotvServerUrl)jiotvServerUrl.value='';
  }finally{if(jiotvConnectBtn)jiotvConnectBtn.disabled=false;}
}

async function loadJioChannels() {
  if(!jiotvClient)return;
  setStatus('Loading JioTV…','loading');startLoadBar();
  try{
    jiotvChannels=await jiotvClient.getChannelsFormatted();
    jpFiltered=jiotvChannels.slice();
    // Also populate the M3U-style channels for sidebar (if ever used in list mode)
    channels=jiotvChannels;allChannels=jiotvChannels.slice();filtered=jiotvChannels.slice();
    selectedIndex=0;renderList();setLbl('JIOTV',jiotvChannels.length);
    setStatus('JioTV · '+jiotvChannels.length+' ch','playing');finishLoadBar();
  }catch(err){setStatus('JioTV load failed','error');finishLoadBar();console.error('[JioTV]',err);}
}

async function loadSavedJiotv() {
  var sv=lsGet(JIOTV_SERVER_KEY);if(!sv)return false;
  try{
    var alive=await JioTVClient.probe(sv,3000);
    if(!alive){showToast('JioTV: scanning LAN…');var found=await JioTVClient.discover(sv);if(found){lsSet(JIOTV_SERVER_KEY,found);sv=found;}else return false;}
    var c=new JioTVClient({serverUrl:sv,timeout:10000});
    var res=await c.checkStatus();
    if(res.status){jiotvClient=c;jiotvClient.logged_in=true;jiotvMode=true;plIdx=TAB_JIOTV();rebuildTabs();await loadJioChannels();showToast('JioTV reconnected');saveMode();return true;}
  }catch(e){console.warn('[JioTV] loadSaved:',e.message);}
  return false;
}

// ── Mode save/restore ─────────────────────────────────────────────
function saveMode(){if(jiotvMode)lsSet('iptv:mode','jiotv');else{lsSet('iptv:mode','m3u');lsSet('iptv:lastM3uIndex',String(plIdx));}}
async function loadMode(){
  var mode=lsGet('iptv:mode');
  if(mode==='jiotv'){var ok=await loadSavedJiotv();if(!ok){jiotvMode=false;fallbackM3u();}}
  else fallbackM3u();
}
function fallbackM3u(){var si=parseInt(lsGet('iptv:lastM3uIndex')||'0',10);plIdx=(!isNaN(si)&&si<allPlaylists.length)?si:0;rebuildTabs();loadPlaylist();}

// ── EPG (M3U/sidebar) ─────────────────────────────────────────────
function startEpgUpdater(){if(epgInterval)clearInterval(epgInterval);epgInterval=setInterval(()=>{if(video.paused)return;},30000);}
function stopEpgUpdater(){if(epgInterval){clearInterval(epgInterval);epgInterval=null;}}
video.addEventListener('playing',startEpgUpdater);
video.addEventListener('pause',stopEpgUpdater);
video.addEventListener('ended',stopEpgUpdater);

// ── Default playlists ─────────────────────────────────────────────
const DEFAULT_PLAYLISTS=[
  {name:'Telugu',url:'https://iptv-org.github.io/iptv/languages/tel.m3u'},
  {name:'India', url:'https://iptv-org.github.io/iptv/countries/in.m3u'},
];

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

  if(overlayTop)overlayTop.classList.remove('info-visible');
  if(overlayBottom)overlayBottom.classList.remove('info-visible');
  overlaysVisible=false;

  // Playlist modal
  if(addPlaylistBtn)   addPlaylistBtn.addEventListener('click',openAddPlaylistModal);
  if(savePlaylistBtn)  savePlaylistBtn.addEventListener('click',handleSavePlaylist);
  if(cancelPlaylistBtn)cancelPlaylistBtn.addEventListener('click',()=>{playlistModal.style.display='none';setFocus('list');});
  if(playlistModal)    playlistModal.addEventListener('click',e=>{if(e.target===playlistModal){playlistModal.style.display='none';setFocus('list');}});
  [playlistNameEl,playlistUrlEl].forEach(el=>{if(el)el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.keyCode===13)handleSavePlaylist();});});

  // JioTV modal
  if(jiotvConnectBtn)jiotvConnectBtn.addEventListener('click',jiotvConnectAction);
  if(jiotvCancelBtn) jiotvCancelBtn.addEventListener('click',closeAllModals);
  if(jiotvModal)     jiotvModal.addEventListener('click',e=>{if(e.target===jiotvModal)closeAllModals();});
  if(jiotvServerUrl) jiotvServerUrl.addEventListener('keydown',e=>{if(e.key==='Enter'||e.keyCode===13)jiotvConnectAction();});
  // Focus: when input is focused, clear placeholder so user can type
  if(jiotvServerUrl) jiotvServerUrl.addEventListener('focus',()=>{if(jiotvServerUrl.value.startsWith('•'))jiotvServerUrl.value='';});

  if(jiotvScanBtn){
    jiotvScanBtn.addEventListener('click',()=>{
      setJioStatus('🔍 Scanning LAN…','var(--gold)');jiotvScanBtn.disabled=true;
      JioTVClient.discover(null).then(found=>{
        jiotvScanBtn.disabled=false;
        if(found){lsSet(JIOTV_SERVER_KEY,found);setJioStatus('✅ Server found on network','var(--green)');if(jiotvServerUrl)jiotvServerUrl.value='';}
        else{setJioStatus('❌ Not found. Enter manually.','var(--red)');}
      });
    });
  }

  // JioTV portal: if we restored jiotv mode, show portal instead of app main
  if(jiotvMode&&jiotvChannels.length>0){
    setTimeout(()=>{showJioPortal();},300);
  }
})();
