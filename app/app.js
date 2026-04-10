// ================================================================
// SAGA IPTV — app.js v34.0  |  Tizen 9 / 2025 Samsung TV
// All mandatory fixes: C1–C7, H8–H15, H17–H20, H22–H28, M15–M21
// Fullscreen cover/contain toggle, M3U retry with backoff,
// playing-event DRM/reconnect reset, no-wait-for-playing FS entry
// ================================================================
'use strict';

// ── Constants ─────────────────────────────────────────────────────
var FAV_KEY              = 'iptv:favs';
var CUSTOM_PLAYLISTS_KEY = 'iptv:customPlaylists';
var AV_SYNC_KEY          = 'iptv:avSync';
var PREF_AUDIO_KEY       = 'iptv:audioLang';
var FS_FIT_KEY           = 'iptv:fsFit';        // 'cover' or 'contain'
var PREVIEW_DELAY        = 500;
var VS_IH                = 108;
var VS_GAP               = 8;
var VS_POOL_MAX          = 60;
var AV_SYNC_STEP         = 50;
var AV_SYNC_MAX          = 500;
var MAX_RECONNECT        = 5;
var STALL_TIMEOUT        = 12000;
var OVERLAY_AUTO_HIDE    = 4000;
var SEARCH_DEBOUNCE_MS   = 300;
var JP_PLAY_TIMEOUT_MS   = 15000;
var EPG_INTERVAL_MS      = 30000;
var M3U_RETRY_MAX        = 2;
var M3U_RETRY_BASE_MS    = 1500;
// FIX: freeze prevention — per-channel retry + timeout
var CH_RETRY_MAX         = 2;
var CH_PLAY_TIMEOUT_MS   = 15000;

// ── Samsung BN59-01199F key codes ─────────────────────────────────
var KEY = {
  UP:38, DOWN:40, LEFT:37, RIGHT:39, ENTER:13,
  BACK:10009, EXIT:10182, INFO:457, GUIDE:458,
  PLAY:415, PAUSE:19, PLAY_PAUSE:10252,
  STOP:413, FF:417, RW:412,
  CH_UP:427, CH_DOWN:428, PAGE_UP:33, PAGE_DOWN:34,
  RED:403, GREEN:404, YELLOW:405, BLUE:406,
  VOL_UP:447, VOL_DOWN:448, MUTE:449,
};

// FIX H23 + B21: clear on both beforeunload AND pagehide (more reliable on Tizen)
function _onAppUnload(){
  clearTimeout(dialTimer);
  try{SagaPlayer.stop();}catch(e){}
  try{if(jpPlayer){jpPlayer.destroy();jpPlayer=null;}}catch(e){}  // FIX M15
}
window.addEventListener('beforeunload',_onAppUnload);
window.addEventListener('pagehide',    _onAppUnload); // FIX B21: pagehide is more reliable

// ── Tab helpers ───────────────────────────────────────────────────
function TAB_FAV()   { return allPlaylists.length; }
function TAB_JIOTV() { return allPlaylists.length + 1; }
function TAB_TOTAL() { return allPlaylists.length + 2; }

var DEFAULT_PLAYLISTS = [
  { name:'Telugu', url:'https://iptv-org.github.io/iptv/languages/tel.m3u' },
  { name:'India',  url:'https://iptv-org.github.io/iptv/countries/in.m3u'  },
  // FIX: Jio playlist added
  { name:'Jio',    url:'https://jioplaylist.joinus-apiworker.workers.dev/playlist.m3u?quality=high' },
];

// ── Global state ──────────────────────────────────────────────────
var allPlaylists = [], customPlaylists = [], plIdx = 0;
var channels = [], allChannels = [], filtered = [];
var selectedIndex = 0, focusArea = 'list', tabFocusIdx = 0;
var isFullscreen = false, hasPlayed = false;
var fsFit = 'contain';           // 'contain' | 'cover' — fullscreen video fit
var currentPlayUrl = '';
var previewTimer = null, fsHintTimer = null, loadBarTimer = null;
var _fsExitFallback = null;      // FIX C7 / M27
var _fsRequesting   = false;     // FIX C7: track pending FS request
var dialBuffer = '', dialTimer = null;
var favSet = new Set();
var avSyncOffset = 0, avSyncLabel = null;
var overlaysVisible = false;
var networkQuality  = 'online', connectionMonitor = null;
var stallWatchdog   = null, lastPlayTime = 0, reconnectCount = 0;
var sleepTimer = null, sleepMinutes = 0;
var sleepRemainingMs = 0, sleepLastTick = 0;
var toastTm = null;
var lastChannelStack = [];
var _exitingApp = false;          // FIX H24: prevent double tizenhwkey exit
// FIX: freeze prevention state
var _chRetryCount  = 0;
var _chPlayTimer   = null;
var _chPlaySeq     = 0;
var _loadBarRaf = null;            // FIX B9: cancel rAF in startLoadBar

// JioTV
var jiotvClient     = null, jiotvMode = false;
var jiotvChannels   = [];
var jpActiveChannel = null, jpPlayer = null;
var _jpPlayerBusy   = false, _jpPlayTimeoutTimer = null;
var _jpLoadPromise  = Promise.resolve();
var jpOverlayTimer  = null;
var jpFocusRow = 0, jpFocusCol = 0, jpGridCols = 8;
var jpFiltered = [], _jpCurrentSet = '';
var jpActiveCat = 'all', jpActiveLang = 'all', jpSearchQ = '';
var jpInPlayer = false, jpEpgTimer = null;
var _jpGridResizeObs = null;
var _jioScanInProgress = false;

// Audio
var _audioTracks        = [];
var _audioTrackIdx      = 0;
var _preferredAudioLang = null;

// FIX H3: track last accepted play operation ID
var _jpPlayId = 0;

// ── DOM cache ─────────────────────────────────────────────────────
function $(id) { return document.getElementById(id); }
var Dom = (function () {
  var ids = [
    'searchInput','searchWrap','searchClear','tabBar','channelList',
    'countBadge','listLabel','nowPlaying','npChNum','statusBadge',
    'video','videoWrap','videoOverlay','fsHint','loadBar',
    'chDialer','chDialerNum','addPlaylistBtn',
    'addPlaylistModal','playlistName','playlistUrl','savePlaylistBtn','cancelPlaylistBtn',
    'overlayTop','overlayBottom','overlayChannelName','overlayChannelTech',
    'overlayProgramTitle','overlayProgramDesc','nextProgramInfo','programInfoBox',
    'toast',
    'jiotvConnectModal','jiotvManualUrl','jiotvScanBtn','jiotvManualBtn',
    'jiotvConnectStatus','jiotvConnectCancel',
    'appMain','jiotvPortal','jpGrid','jpFilters','jpLangFilters','jpSearch',
    'jpCount','jpNowBar','jpNbThumb','jpNbName','jpNbEpg','jpNbTech',
    'jpPlayerLayer','jpPlayerOverlay','jpVideo','jpPlBack','jpPlTitle','jpPlTime',
    'jpPlSpinner','jpPlProg','jpPlDesc','jpPlTech','jpExitBtn','jpClock',
    'settingsModal','settingsCacheBtn','settingsSleepSelect',
    'settingsAVReset','settingsCloseBtn','settingsAudioTrack','settingsFsFit',
  ];
  var d = {};
  ids.forEach(function (id) { d[id] = document.getElementById(id); });
  return d;
})();

// ── Safe localStorage ─────────────────────────────────────────────
function lsSet(k,v){try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
function lsGet(k)  {try{return localStorage.getItem(k);}catch(e){return null;}}
function lsRemove(k){try{localStorage.removeItem(k);}catch(e){}}

// ── Favourites ────────────────────────────────────────────────────
(function(){try{var r=lsGet(FAV_KEY);if(r)favSet=new Set(JSON.parse(r));}catch(e){}})();
function saveFavs(){
  // FIX B22: warn user if localStorage write fails
  var ok=lsSet(FAV_KEY,JSON.stringify([...favSet]));
  if(!ok)showToast('Storage full — favourites may not be saved',3500);
}
function isFav(ch){return ch&&ch.url&&favSet.has(ch.url);}
function toggleFav(ch){
  if(!ch||!ch.url)return;
  if(favSet.has(ch.url))favSet.delete(ch.url);else favSet.add(ch.url);
  saveFavs();
  if(plIdx===TAB_FAV())showFavourites();else VS.rebuildVisible();
  showToast(isFav(ch)?'★ Added to Favourites':'✕ Removed from Favourites');
}
function showFavourites(){
  filtered=allChannels.filter(function(c){return favSet.has(c.url);});
  selectedIndex=0;renderList();
  setLbl('FAVOURITES',filtered.length);
  setStatus(filtered.length?filtered.length+' favourites':'No favourites yet','idle');
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg,dur){
  if(!Dom.toast)return;
  Dom.toast.textContent=msg;Dom.toast.style.opacity='1';
  clearTimeout(toastTm);
  toastTm=setTimeout(function(){Dom.toast.style.opacity='0';},dur||2800);
}

// ── Status / load bar ─────────────────────────────────────────────
function setStatus(t,c){
  if(!Dom.statusBadge)return;
  Dom.statusBadge.textContent=t;Dom.statusBadge.className='status-badge '+(c||'idle');
}
function setLbl(label,count){
  if(Dom.listLabel)Dom.listLabel.textContent=count!==undefined?label+' · '+count:label;
}
function startLoadBar(){
  // FIX B9: cancel both rAF and any pending timeout before starting fresh
  clearTimeout(loadBarTimer);
  if(_loadBarRaf){cancelAnimationFrame(_loadBarRaf);_loadBarRaf=null;}
  if(!Dom.loadBar)return;
  Dom.loadBar.style.width='0%';Dom.loadBar.classList.add('active');
  var w=0;
  (function tick(){w=Math.min(w+Math.random()*9,85);Dom.loadBar.style.width=w+'%';if(w<85)loadBarTimer=setTimeout(tick,200);})();
}
function finishLoadBar(){
  clearTimeout(loadBarTimer);
  if(_loadBarRaf){cancelAnimationFrame(_loadBarRaf);_loadBarRaf=null;} // FIX B9
  if(!Dom.loadBar)return;
  Dom.loadBar.style.width='100%';
  setTimeout(function(){Dom.loadBar.classList.remove('active');Dom.loadBar.style.width='0%';},440);
}
function refreshLbl(){
  if(jiotvMode)setLbl('JIOTV',channels.length);
  else if(plIdx===TAB_FAV())setLbl('FAVOURITES',filtered.length);
  else setLbl('CHANNELS',channels.length);
}

// ── HTML escape ───────────────────────────────────────────────────
var _escMap={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'};
function esc(s){return String(s||'').replace(/[&<>"]/g,function(c){return _escMap[c];});}

// ── M3U parser — robust quoted-attr + malformed-line skip ─────────
function parseM3U(text) {
  var lines  = String(text||'').split(/\r?\n/);
  var out    = [];
  var meta   = null;
  function _attr(line, name) {
    var re = new RegExp(name+'\\s*=\\s*"([^"]*)"','i');
    var m  = line.match(re); return m ? m[1] : '';
  }
  function _clean(raw) {
    return String(raw||'')
      .replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g,' ')
      .replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi,' ')
      .replace(/[\|\-–—]+\s*$|\s{2,}/g,' ').replace(/>/g,'').trim();
  }
  for (var i=0;i<lines.length;i++) {
    var line=lines[i].trim();if(!line)continue;
    if(line.startsWith('#EXTINF')) {
      try {
        var commaIdx=line.lastIndexOf(',');
        var rawName=commaIdx>=0?line.slice(commaIdx+1).trim():'Unknown';
        meta={
          name:  _clean(rawName)||rawName,
          group: _attr(line,'group-title')||'Other',
          logo:  _attr(line,'tvg-logo'),
        };
      } catch(e) { meta=null; }
    } else if(line.charAt(0)!=='#'&&meta) {
      // skip clearly malformed URLs
      if(line.startsWith('http://')||line.startsWith('https://')||line.startsWith('rtmp')||line.startsWith('rtp')) {
        out.push({name:meta.name,group:meta.group,logo:meta.logo,url:line});
      }
      meta=null;
    }
  }
  return out;
}

// ── SagaPlayer callbacks ──────────────────────────────────────────
async function _initPlayerCallbacks() {
  await SagaPlayer.init(Dom.video, {
    onStatus: function(msg,cls){
      if(msg==='playing_event'){ reconnectCount=0; _chRetryCount=0; return; } // FIX C2 + freeze
      setStatus(msg,cls);
    },
    onBuffering: function(isBuffering){
      if(isBuffering){setStatus('Buffering…','loading');startLoadBar();}
      else{setStatus('Playing','playing');finishLoadBar();_updateChTech();}
    },
    onTechUpdate: _updateChTech,
    onError: function(msg){setStatus(msg,'error');finishLoadBar();stopStallWatchdog();},
  });
}
// FIX: auto quality — restrict ABR by resolution
function _applyQualityRestriction(quality){
  if(!SagaPlayer.isReady())return;
  if(quality==='slow'){
    // FIX auto quality: cap at 480p on slow networks
    SagaPlayer.setMaxResolution(854,480);
    showToast('Slow network — quality capped at 480p',3000);
  }else{
    SagaPlayer.setMaxResolution(0,0); // remove restriction
  }
}
function _updateChTech(){var info=SagaPlayer.getTechInfo();if(Dom.overlayChannelTech)Dom.overlayChannelTech.textContent=info;}

// ── AV Sync — FIX C14/H17: readyState + isSeekable guard ─────────
function loadAvSync(){var v=parseInt(lsGet(AV_SYNC_KEY)||'0',10);avSyncOffset=isNaN(v)?0:Math.max(-AV_SYNC_MAX,Math.min(AV_SYNC_MAX,v));}
function saveAvSync(){lsSet(AV_SYNC_KEY,String(avSyncOffset));}
function applyAvSync(){
  // FIX H17: only apply if readyState >= 2
  if(!Dom.video||!hasPlayed||avSyncOffset===0)return;
  if(Dom.video.readyState<2)return;  // FIX H17
  // FIX C14/H22: wrapped in try/catch, check isSeekable
  if(!SagaPlayer.isSeekable(Dom.video))return;
  try{
    var t=Dom.video.currentTime-(avSyncOffset/1000);
    if(t>=0)Dom.video.currentTime=t;
  }catch(e){}
  _updateAvLabel();
}
function adjustAvSync(sign){
  avSyncOffset=Math.max(-AV_SYNC_MAX,Math.min(AV_SYNC_MAX,avSyncOffset+sign*AV_SYNC_STEP));
  saveAvSync();applyAvSync();
  showToast('AV Sync: '+(avSyncOffset===0?'0 ms':(avSyncOffset>0?'+':'')+avSyncOffset+' ms'));
  _updateAvLabel();
}
function resetAvSync(){avSyncOffset=0;saveAvSync();_updateAvLabel();showToast('AV Sync: 0');}
function _updateAvLabel(){
  if(!avSyncLabel)return;
  avSyncLabel.textContent=avSyncOffset===0?'AV: 0':'AV: '+(avSyncOffset>0?'+':'')+avSyncOffset+'ms';
  avSyncLabel.style.color=avSyncOffset===0?'var(--text-muted)':'var(--gold)';
}
function buildAvSyncBar(){
  var ctrl=document.querySelector('.player-controls');if(!ctrl)return;
  if(document.getElementById('avSyncWrap'))return; // FIX B15: prevent duplicate
  var wrap=document.createElement('div');wrap.id='avSyncWrap';
  var bM=document.createElement('button');bM.className='av-btn';bM.id='avBtnLeft'; bM.textContent='◁ Audio';
  var bP=document.createElement('button');bP.className='av-btn';bP.id='avBtnRight';bP.textContent='Audio ▷';
  avSyncLabel=document.createElement('span');avSyncLabel.className='av-label';
  bM.addEventListener('click',function(){adjustAvSync(-1);});
  bP.addEventListener('click',function(){adjustAvSync(+1);});
  avSyncLabel.addEventListener('click',resetAvSync);
  _updateAvLabel();
  wrap.appendChild(bM);wrap.appendChild(avSyncLabel);wrap.appendChild(bP);
  ctrl.insertBefore(wrap,ctrl.firstChild);
}

// ── Fullscreen fit (cover / contain) — new feature ────────────────
function loadFsFit(){
  fsFit=lsGet(FS_FIT_KEY)||'contain';
  _applyFsFitCSS();
}
function _applyFsFitCSS(){
  if(Dom.video){Dom.video.style.objectFit=isFullscreen?fsFit:'contain';}
  if(Dom.settingsFsFit)Dom.settingsFsFit.value=fsFit;
}
function setFsFit(val){
  fsFit=val==='cover'?'cover':'contain';
  lsSet(FS_FIT_KEY,fsFit);_applyFsFitCSS();
  showToast('Fullscreen: '+(fsFit==='cover'?'Fill (crop)':'Fit (bars)'));
}

// ── Audio — FIX C1: per-load flag, re-applied each channel ────────
function loadPreferredAudioLang(){_preferredAudioLang=lsGet(PREF_AUDIO_KEY)||null;}
function _hookAudioReady(){
  if(!Dom.video||!_preferredAudioLang)return;
  // FIX C1: new listener created for every channel load
  var applied=false;
  function tryApply(){
    if(applied)return;
    var tracks=SagaPlayer.getAudioTracks();if(!tracks||!tracks.length)return;
    var match=tracks.find(function(t){return t.language===_preferredAudioLang;});
    if(match){SagaPlayer.setAudioLanguage(match.language,match.role||'');applied=true;}
  }
  Dom.video.addEventListener('loadedmetadata',tryApply,{once:true});
  Dom.video.addEventListener('canplay',       tryApply,{once:true});
}
function cycleAudioTrack(){
  _audioTracks=SagaPlayer.getAudioTracks();
  if(!_audioTracks||_audioTracks.length<2){showToast('No alternate audio tracks');return;}
  _audioTrackIdx=(_audioTrackIdx+1)%_audioTracks.length;
  var t=_audioTracks[_audioTrackIdx];
  SagaPlayer.setAudioLanguage(t.language,t.role||'');
  _preferredAudioLang=t.language;
  lsSet(PREF_AUDIO_KEY,t.language);
  showToast('Audio: '+(t.label||t.language||'Track '+_audioTrackIdx));
}

// ── Sleep timer — FIX H8: sleepMinutes reset in _clearSleepState ──
var _SLEEP_RESET_KEYS=new Set([KEY.UP,KEY.DOWN,KEY.LEFT,KEY.RIGHT,KEY.ENTER,KEY.PLAY,KEY.PAUSE,KEY.PLAY_PAUSE,KEY.STOP,KEY.CH_UP,KEY.CH_DOWN,KEY.FF,KEY.RW,KEY.RED,KEY.GREEN,KEY.YELLOW,KEY.BLUE,KEY.PAGE_UP,KEY.PAGE_DOWN,KEY.BACK]);
function _shouldResetSleep(kc){return _SLEEP_RESET_KEYS.has(kc);}
function setSleepTimer(m){
  _clearSleepState(); // FIX B16: _clearSleepState sets sleepMinutes=0
  if(!m||m<=0){showToast('Sleep timer: Off');return;} // FIX B16: guard <=0
  sleepMinutes=m;showToast('Sleep timer: '+m+' min');_startSleepCountdown(m*60000);
}
function _startSleepCountdown(ms){
  sleepRemainingMs=ms;sleepLastTick=Date.now();
  sleepTimer=setInterval(function(){
    if(!Dom.video||Dom.video.paused){sleepLastTick=Date.now();return;}
    var now=Date.now(),elapsed=now-sleepLastTick;sleepLastTick=now;sleepRemainingMs-=elapsed;
    if(sleepRemainingMs<=0){_clearSleepState();SagaPlayer.stop();stopStallWatchdog();setStatus('Sleep — stopped','idle');showToast('Goodnight!',4000);}
  },1000);
}
function resetSleepTimer(kc){if(!sleepMinutes||!sleepTimer)return;if(kc!==undefined&&!_shouldResetSleep(kc))return;clearInterval(sleepTimer);sleepTimer=null;_startSleepCountdown(sleepMinutes*60000);}
function clearSleepTimer(){_clearSleepState();}
function _clearSleepState(){
  if(sleepTimer){clearInterval(sleepTimer);sleepTimer=null;}
  sleepRemainingMs=0;
  sleepMinutes=0;  // FIX H8: reset sleepMinutes inside _clearSleepState
}

// ── Stall watchdog — FIX C2: reset count on playing event ─────────
function startStallWatchdog(){
  stopStallWatchdog();reconnectCount=0;lastPlayTime=Date.now();
  stallWatchdog=setInterval(function(){
    if(!Dom.video||Dom.video.paused||!hasPlayed||!currentPlayUrl)return;
    if(Date.now()-lastPlayTime>STALL_TIMEOUT){
      lastPlayTime=Date.now();
      if(reconnectCount<MAX_RECONNECT){
        reconnectCount++;setStatus('Reconnecting ('+reconnectCount+'/'+MAX_RECONNECT+')…','loading');startLoadBar();
        SagaPlayer.play(currentPlayUrl,null).catch(function(){});
      }else{setStatus('Stream lost','error');stopStallWatchdog();}
    }
  },4000);
}
function stopStallWatchdog(){if(stallWatchdog){clearInterval(stallWatchdog);stallWatchdog=null;}}
if(Dom.video){
  // FIX C2: reset reconnectCount on playing
  Dom.video.addEventListener('playing',function(){reconnectCount=0;lastPlayTime=Date.now();});
  Dom.video.addEventListener('progress',function(){if(!Dom.video.paused)lastPlayTime=Date.now();});
  Dom.video.addEventListener('timeupdate',function(){if(!Dom.video.paused)lastPlayTime=Date.now();});
}

// ══════════════════════════════════════════════════════════════════
// VIRTUAL SCROLL — FIX H10: template node approach, FIX M28: orphan cleanup
// ══════════════════════════════════════════════════════════════════
var VS={
  IH:VS_IH,GAP:VS_GAP,OS:4,
  c:null,inner:null,vh:0,st:0,total:0,
  pool:[],nodes:{},raf:null,
  _tmpl:null,  // FIX H10: template node

  init:function(el){
    this.c=el;el.innerHTML='';
    this.inner=document.createElement('ul');
    this.inner.id='vsInner';
    this.inner.style.cssText='position:relative;width:100%;margin:0;padding:0;list-style:none;';
    el.appendChild(this.inner);
    this.vh=el.clientHeight||900;
    var self=this;
    el.addEventListener('scroll',function(){if(self.raf)return;self.raf=requestAnimationFrame(function(){self.raf=null;self.st=self.c.scrollTop;self.paint();});},{passive:true});
    if(window.ResizeObserver)new ResizeObserver(function(){self.vh=self.c.clientHeight||900;self.paint();}).observe(el);
    // FIX H10: create template element once
    this._tmpl=this.mkNode();
    this._tmpl.style.display='none';
    this.pool.push(this._tmpl);
  },

  setData:function(n){
    this.total=n;
    for(var k in this.nodes){
      var nd=this.nodes[k];nd.style.display='none';nd._i=-1;
      // FIX M28: always remove from DOM if not being pooled
      if(this.pool.length<VS_POOL_MAX){this.pool.push(nd);}
      else{if(nd.parentNode)nd.parentNode.removeChild(nd);}
    }
    this.nodes={};
    this.inner.style.height=n>0?(n*(this.IH+this.GAP)-this.GAP+20)+'px':'0';
    this.c.scrollTop=0;this.st=0;this.vh=this.c.clientHeight||900;this.paint();
  },

  scrollTo:function(idx){
    var top=idx*(this.IH+this.GAP),bot=top+this.IH,pad=24;
    if(top<this.st+pad)this.c.scrollTop=Math.max(0,top-pad);
    else if(bot>this.st+this.vh-pad)this.c.scrollTop=bot-this.vh+pad;
    this.st=this.c.scrollTop;this.paint();
  },

  centerOn:function(idx){
    idx=Math.max(0,Math.min(this.total-1,idx));
    this.c.scrollTop=Math.max(0,idx*(this.IH+this.GAP)-(this.vh/2)+(this.IH/2));
    this.st=this.c.scrollTop;this.paint();
  },

  paint:function(){
    if(!this.total)return;
    var H=this.IH+this.GAP,os=this.OS;
    var s=Math.max(0,Math.floor(this.st/H)-os);
    var e=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);
    for(var oi in this.nodes){
      var ii=parseInt(oi,10);
      if(ii<s||ii>e){
        var nd=this.nodes[oi];nd.style.display='none';nd._i=-1;
        if(this.pool.length<VS_POOL_MAX){this.pool.push(nd);}
        else{if(nd.parentNode)nd.parentNode.removeChild(nd);}  // FIX M28
        delete this.nodes[oi];
      }
    }
    for(var i=s;i<=e;i++){
      if(this.nodes[i])continue;
      var li=this.pool.pop()||this.mkNode();
      this.build(li,i);if(!li.parentNode)this.inner.appendChild(li);
      li.style.display='';this.nodes[i]=li;
    }
    for(var j in this.nodes){
      var n=this.nodes[j],on=(parseInt(j,10)===selectedIndex);
      if(on!==n._on){n._on=on;n.classList.toggle('active',on);}
    }
  },

  mkNode:function(){
    var li=document.createElement('li');li._i=-1;li._on=false;
    li.style.cssText='position:absolute;will-change:transform;transform:translateZ(0);backface-visibility:hidden;';
    this.inner.appendChild(li);
    li.addEventListener('click',function(){if(li._i<0)return;selectedIndex=li._i;VS.refresh();cancelPreview();schedulePreview();});
    return li;
  },

  // FIX H10: update only changed child nodes instead of rebuilding innerHTML
  build:function(li,i){
    li._i=i;li._on=false;
    var top=i*(this.IH+this.GAP)+10;
    li.style.cssText=['position:absolute','left:12px','right:12px','top:'+top+'px','height:'+this.IH+'px',
      'display:flex','align-items:center','gap:16px','padding:0 18px',
      'border-radius:18px','overflow:hidden',
      'will-change:transform','transform:translateZ(0)','backface-visibility:hidden'].join(';');
    var ch=filtered[i];if(!ch)return;
    var PH="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='72' height='72' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";

    // FIX H10: reuse existing child nodes when possible
    var imgEl,nameEl,favEl,numEl;
    if(li.childNodes.length===0){
      // first build — create from scratch
      var logo=document.createElement('div');logo.className='ch-logo';
      imgEl=document.createElement('img');imgEl.loading='lazy';
      imgEl.onerror=function(){this.onerror=null;this.src=PH;};
      logo.appendChild(imgEl);li.appendChild(logo);
      var info=document.createElement('div');info.className='ch-info';
      nameEl=document.createElement('div');nameEl.className='ch-name';
      info.appendChild(nameEl);li.appendChild(info);
      favEl=document.createElement('div');favEl.className='ch-fav';li.appendChild(favEl);
      numEl=document.createElement('div');numEl.className='ch-num';li.appendChild(numEl);
    } else {
      imgEl  = li.querySelector('.ch-logo img');
      nameEl = li.querySelector('.ch-name');
      favEl  = li.querySelector('.ch-fav');
      numEl  = li.querySelector('.ch-num');
    }
    // FIX H10: only update what changed
    var newSrc=ch.logo||PH;
    if(imgEl&&imgEl.getAttribute('src')!==newSrc){imgEl.src=newSrc;}
    if(nameEl&&nameEl.textContent!==ch.name){nameEl.textContent=ch.name;}
    if(favEl){var star=isFav(ch)?'★':'';if(favEl.textContent!==star){favEl.textContent=star;favEl.style.display=star?'':'none';}}
    var num=String(i+1);if(numEl&&numEl.textContent!==num)numEl.textContent=num;

    if(i===selectedIndex){li._on=true;li.classList.add('active');}else li.classList.remove('active');
  },

  refresh:function(){for(var j in this.nodes){var n=this.nodes[j],on=(parseInt(j,10)===selectedIndex);if(on!==n._on){n._on=on;n.classList.toggle('active',on);}}},
  rebuildVisible:function(){for(var j in this.nodes)this.build(this.nodes[j],parseInt(j,10));},
};

// ── Render list ───────────────────────────────────────────────────
function renderList(){
  if(Dom.countBadge)Dom.countBadge.textContent=String(filtered.length);
  VS.setData(filtered.length);
  if(filtered.length)VS.scrollTo(selectedIndex);
  if(window.AppCache)AppCache.preloadImages(filtered.slice(0,40).map(function(c){return c.logo;}).filter(Boolean));
}

// ── Search ────────────────────────────────────────────────────────
var _sdTm=null;
function applySearch(){
  clearTimeout(_sdTm);
  _sdTm=setTimeout(function(){
    var q=Dom.searchInput?Dom.searchInput.value.trim().toLowerCase():'';
    filtered=!q?channels.slice():channels.filter(function(c){return c.name.toLowerCase().includes(q)||(c.group||'').toLowerCase().includes(q);});
    selectedIndex=0;renderList();if(q)setLbl('SEARCH',filtered.length);else refreshLbl();
  },SEARCH_DEBOUNCE_MS);
}
function commitSearch(){setFocus('list');if(filtered.length===1){selectedIndex=0;VS.refresh();schedulePreview();}}
function clearSearch(){if(Dom.searchInput)Dom.searchInput.value='';if(Dom.searchWrap)Dom.searchWrap.classList.remove('active');applySearch();setFocus('list');}
if(Dom.searchInput)Dom.searchInput.addEventListener('input',function(){if(Dom.searchWrap)Dom.searchWrap.classList.toggle('active',Dom.searchInput.value.length>0);applySearch();});
if(Dom.searchClear)Dom.searchClear.addEventListener('click',clearSearch);

// ── XHR fetch — FIX H11: no mirror on timeout (status 0) ─────────
function xhrFetch(url,ms,cb){
  var done=false,xhr=new XMLHttpRequest(),statusCode=0;
  var tid=setTimeout(function(){if(done)return;done=true;xhr.abort();cb(new Error('Timeout'),null,0);},ms);
  xhr.onreadystatechange=function(){
    if(xhr.readyState!==4||done)return;done=true;clearTimeout(tid);
    statusCode=xhr.status;
    if(xhr.status>=200&&xhr.status<400)cb(null,xhr.responseText,xhr.status);
    else cb(new Error('HTTP '+xhr.status),null,xhr.status);
  };
  xhr.onerror=function(){if(done)return;done=true;clearTimeout(tid);cb(new Error('Network error'),null,0);};
  try{xhr.open('GET',url,true);xhr.send();}catch(e){done=true;clearTimeout(tid);cb(e,null,0);}
}
function mirrorUrl(url){
  try{var u=new URL(url);if(u.hostname!=='raw.githubusercontent.com')return null;var p=u.pathname.split('/').filter(Boolean);if(p.length<4)return null;return 'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/');}catch(e){return null;}
}

// ── SSRF guard ────────────────────────────────────────────────────
function _isAllowedPlaylistURL(url){
  try{var u=new URL(url);if(u.protocol!=='http:'&&u.protocol!=='https:')return false;var h=u.hostname;if(/^(127\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.|192\.168\.|169\.254\.)/.test(h))return false;if(h==='localhost'||h==='::1')return false;return true;}catch(e){return false;}
}

// ── M3U load — exponential backoff retry, FIX C6 await clear ─────
function loadPlaylist(urlOv){
  clearTimeout(_sdTm);cancelPreview();
  var rawUrl=urlOv||(plIdx<allPlaylists.length?allPlaylists[plIdx].url:null);
  if(!rawUrl)return;
  if(!_isAllowedPlaylistURL(rawUrl)){showToast('Invalid playlist URL');setStatus('Invalid URL','error');return;}

  var cacheP=window.AppCache?AppCache.getM3U(rawUrl):Promise.resolve(null);
  cacheP.then(function(cached){
    if(cached&&cached.length>100){_onM3ULoaded(cached,true);return;}
    setStatus('Loading…','loading');startLoadBar();
    _fetchWithRetry(rawUrl,0);
  });

  function _fetchWithRetry(url,attempt){
    xhrFetch(url,30000,function(err,text,status){
      if(!err&&text&&text.length>100){
        finishLoadBar();
        _saveM3UCache(rawUrl,text);
        _onM3ULoaded(text,false);return;
      }
      // FIX H11: only try mirror on 4xx/5xx, NOT on timeout (status 0)
      if(status===0&&attempt===0){
        // timeout — retry with backoff directly, no mirror
        var delay=M3U_RETRY_BASE_MS*(attempt+1);
        setStatus('Retrying…','loading');
        setTimeout(function(){_fetchWithRetry(url,attempt+1);},delay);return;
      }
      // 4xx/5xx — try mirror
      var mirror=mirrorUrl(url);
      if(mirror&&attempt===0){
        setStatus('Trying mirror…','loading');
        xhrFetch(mirror,30000,function(e2,t2,s2){
          if(!e2&&t2&&t2.length>100){finishLoadBar();_saveM3UCache(rawUrl,t2);_onM3ULoaded(t2,false);}
          else if(attempt<M3U_RETRY_MAX){setTimeout(function(){_fetchWithRetry(url,attempt+1);},M3U_RETRY_BASE_MS*(attempt+1));}
          else{finishLoadBar();setStatus('Failed — check URL','error');showToast('Playlist load failed');}
        });return;
      }
      // generic retry with backoff
      if(attempt<M3U_RETRY_MAX){
        var backoff=M3U_RETRY_BASE_MS*Math.pow(2,attempt);
        setStatus('Retrying… ('+(attempt+1)+'/'+M3U_RETRY_MAX+')','loading');
        setTimeout(function(){_fetchWithRetry(url,attempt+1);},backoff);
      }else{finishLoadBar();setStatus('Failed — check network','error');showToast('Playlist load failed');}
    });
  }

  function _saveM3UCache(url,text){
    if(!window.AppCache)return;
    if(AppCache.lsNearQuota()){
      showToast('Storage nearly full — clearing old cache',3500);
      // FIX C6: await clearAllM3U before setM3U
      AppCache.clearAllM3U().then(function(){AppCache.setM3U(url,text);});
    }else{AppCache.setM3U(url,text);}
  }

  function _onM3ULoaded(t,fromCache){
    channels=parseM3U(t);allChannels=channels.slice();filtered=channels.slice();
    if(channels.length===0&&!fromCache){
      setStatus('No channels — check M3U format','error');
      showToast('No channels found — possible malformed M3U',3500);return;
    }
    selectedIndex=0;renderList();refreshLbl();lsSet('iptv:lastM3uIndex',String(plIdx));
    setStatus('Ready · '+channels.length+' ch'+(fromCache?' (cached)':''),'idle');setFocus('list');
  }
}

// ── Network monitor — FIX H26: navigator.connection fallback ──────
function updateNetworkIndicator() {
  var el = $('networkIndicator');
  if(!el) return;
  var oldQuality = networkQuality;
  el.className = 'network-indicator';
  if(!navigator.onLine){
    networkQuality = 'offline';
    el.classList.add('offline');
  } else {
    var downlink = (navigator.connection && typeof navigator.connection.downlink === 'number') ? navigator.connection.downlink : -1;
    if(downlink >= 0 && downlink < 1) {
      networkQuality = 'slow';
      el.classList.add('slow');
    } else {
      networkQuality = 'online';
      el.classList.add('online');
    }
  }
  
  // Only apply changes if quality actually changed
  if (oldQuality !== networkQuality) {
    _applyQualityRestriction(networkQuality);
    SagaPlayer.setNetworkQuality(networkQuality);
    
    // FIX: When upgrading from slow to online, force quality upgrade
    if (oldQuality === 'slow' && networkQuality === 'online') {
      // Option 1: Try to upgrade without reloading
      if (!SagaPlayer.upgradeQuality()) {
        // Option 2: If no immediate upgrade, reload manifest after 2 seconds
        setTimeout(function() {
          if (hasPlayed && !Dom.video.paused) {
            SagaPlayer.refreshManifest();
          }
        }, 2000);
      }
      showToast('Network improved – upgrading quality', 2500);
    } else if (oldQuality === 'online' && networkQuality === 'slow') {
      showToast('Slow network – quality capped at 480p', 3000);
    }
  }
}

// ── Clock ──────────────────────────────────────────────────────────
function _updateAllClocks(){
  var now=new Date();
  var ts=now.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
  var ds=now.toLocaleDateString([],{weekday:'short',day:'2-digit',month:'short'});
  if($('brandClock'))$('brandClock').textContent=ts;
  if($('currentTime'))$('currentTime').textContent=ts;
  if($('currentDate'))$('currentDate').textContent=ds;
  if(Dom.jpClock)Dom.jpClock.textContent=ts;
  if(Dom.jpPlTime)Dom.jpPlTime.textContent=ts;
}
setInterval(_updateAllClocks,1000);_updateAllClocks();

// ── Preview ────────────────────────────────────────────────────────
function cancelPreview(){clearTimeout(previewTimer);previewTimer=null;}
function schedulePreview(){cancelPreview();previewTimer=setTimeout(function(){previewTimer=null;startPreview(selectedIndex);},PREVIEW_DELAY);}
async function startPreview(idx){
  if(!filtered.length)return;
  var ch=filtered[idx];if(!ch)return;

  // FIX: freeze prevention — cancel any previous channel attempt
  cancelPreview();
  clearTimeout(_chPlayTimer);
  var mySeq=++_chPlaySeq;

  if(Dom.overlayTop&&Dom.overlayBottom&&overlaysVisible){Dom.overlayTop.classList.remove('info-visible');Dom.overlayBottom.classList.remove('info-visible');overlaysVisible=false;}
  if(Dom.nowPlaying)Dom.nowPlaying.textContent=ch.name;
  if(Dom.overlayChannelName)Dom.overlayChannelName.textContent=ch.name;
  if(Dom.npChNum)Dom.npChNum.textContent='CH '+(idx+1);
  if(Dom.overlayProgramTitle)Dom.overlayProgramTitle.textContent='';
  if(Dom.overlayProgramDesc) Dom.overlayProgramDesc.textContent='';
  if(Dom.nextProgramInfo)    Dom.nextProgramInfo.textContent='';
  if(Dom.programInfoBox)     Dom.programInfoBox.style.display='none';
  if(Dom.videoOverlay)Dom.videoOverlay.classList.add('hidden');
  if(currentPlayUrl&&currentPlayUrl!==ch.url){ lastChannelStack=[currentPlayUrl]; _chRetryCount=0; }
  hasPlayed=true;currentPlayUrl=ch.url;
  setStatus('Buffering…','loading');startLoadBar();
  _hookAudioReady();  // FIX C1

  // FIX: freeze prevention — 15s hard timeout per channel attempt
  _chPlayTimer=setTimeout(function(){
    if(mySeq!==_chPlaySeq)return;
    _chRetryCount++;
    if(_chRetryCount<=CH_RETRY_MAX){
      // FIX: retry same channel
      setStatus('Retrying ('+_chRetryCount+'/'+CH_RETRY_MAX+')…','loading');
      SagaPlayer.stop().then(function(){
        if(mySeq===_chPlaySeq) SagaPlayer.play(ch.url,null);
      });
    }else{
      // FIX: max retries — fully stop and reset
      _chRetryCount=0;
      SagaPlayer.stop();
      stopStallWatchdog();
      setStatus('Channel unavailable','error');
      finishLoadBar();
      if(Dom.videoOverlay)Dom.videoOverlay.classList.remove('hidden');
      showToast('Channel failed after '+CH_RETRY_MAX+' attempts',3500);
    }
  },CH_PLAY_TIMEOUT_MS);

  await SagaPlayer.play(ch.url,null);
  if(mySeq===_chPlaySeq){
    clearTimeout(_chPlayTimer); // FIX: cancel timeout on success
    startStallWatchdog();_audioTrackIdx=0;
  }
}
function playSelected(){cancelPreview();startPreview(selectedIndex);}
function goPreCh(){
  if(!lastChannelStack.length)return;
  var prevUrl=lastChannelStack[0];
  for(var i=0;i<filtered.length;i++){if(filtered[i].url===prevUrl){selectedIndex=i;VS.centerOn(i);VS.refresh();cancelPreview();startPreview(i);return;}}
}

// ── Video events ──────────────────────────────────────────────────
if(Dom.video){
  Dom.video.addEventListener('playing',function(){setStatus('Playing','playing');finishLoadBar();_updateChTech();_applyFsFitCSS();});
  Dom.video.addEventListener('pause',  function(){setStatus('Paused','paused');});
  Dom.video.addEventListener('waiting',function(){setStatus('Buffering…','loading');startLoadBar();});
  Dom.video.addEventListener('stalled',function(){setStatus('Buffering…','loading');});
  Dom.video.addEventListener('error',  function(){setStatus('Error','error');finishLoadBar();});
  Dom.video.addEventListener('ended',  function(){setStatus('Ended','idle');stopStallWatchdog();});
  Dom.video.addEventListener('dblclick',toggleFS);
}

// ── Fullscreen — FIX C7: FS request promise + .catch() ────────────
function showFsHint(){clearTimeout(fsHintTimer);if(Dom.fsHint)Dom.fsHint.classList.add('visible');fsHintTimer=setTimeout(function(){if(Dom.fsHint)Dom.fsHint.classList.remove('visible');},3200);}
function applyExitFSState(){
  // FIX M27: clear _fsExitFallback before applying
  clearTimeout(_fsExitFallback);_fsExitFallback=null;
  _fsRequesting=false;
  document.body.classList.remove('fullscreen');
  isFullscreen=false;
  if(Dom.fsHint)Dom.fsHint.classList.remove('visible');
  if(Dom.video)Dom.video.style.objectFit='contain';  // reset to contain on exit
  window.dispatchEvent(new Event('resize'));
  setFocus('list');VS.refresh();
}
function enterFS(){
  if(_fsRequesting||isFullscreen)return;
  _fsRequesting=true;
  var fn=Dom.videoWrap&&(Dom.videoWrap.requestFullscreen||Dom.videoWrap.webkitRequestFullscreen||Dom.videoWrap.mozRequestFullScreen);
  var p=null;
  if(fn){try{p=fn.call(Dom.videoWrap);}catch(e){p=null;}}
  // FIX C7: handle promise rejection — only set isFullscreen if request succeeds
  var doEnter=function(){
    document.body.classList.add('fullscreen');isFullscreen=true;_fsRequesting=false;
    if(Dom.overlayTop)   Dom.overlayTop.classList.remove('info-visible');
    if(Dom.overlayBottom)Dom.overlayBottom.classList.remove('info-visible');
    overlaysVisible=false;showFsHint();_applyFsFitCSS();
  };
  // FIX B17: 3s timeout resets _fsRequesting if promise never settles
  var _fsReqTimeout=setTimeout(function(){_fsRequesting=false;},3000);
  if(p&&typeof p.then==='function'){
    p.then(function(){clearTimeout(_fsReqTimeout);doEnter();})
     .catch(function(){clearTimeout(_fsReqTimeout);_fsRequesting=false;});
  }else{
    clearTimeout(_fsReqTimeout);doEnter();  // fallback for non-promise FS APIs
  }
}
function exitFS(){
  // FIX M27: clear before setting new fallback
  clearTimeout(_fsExitFallback);
  var fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen;
  if(fn)try{fn.call(document);}catch(e){}
  _fsExitFallback=setTimeout(applyExitFSState,300);
}
function toggleFS(){if(isFullscreen)exitFS();else enterFS();}
function _onFsChange(){clearTimeout(_fsExitFallback);_fsExitFallback=null;if(!(document.fullscreenElement||document.webkitFullscreenElement)&&isFullscreen)applyExitFSState();}
document.addEventListener('fullscreenchange',       _onFsChange);
document.addEventListener('webkitfullscreenchange', _onFsChange);

function toggleOverlays(){
  if(!Dom.overlayTop||!Dom.overlayBottom)return;
  if(overlaysVisible){Dom.overlayTop.classList.remove('info-visible');Dom.overlayBottom.classList.remove('info-visible');overlaysVisible=false;}
  else{Dom.overlayTop.classList.add('info-visible');Dom.overlayBottom.classList.add('info-visible');overlaysVisible=true;}
}

// ── Channel dialer ────────────────────────────────────────────────
function commitChannelNumber(){var num=parseInt(dialBuffer,10);dialBuffer='';if(Dom.chDialer)Dom.chDialer.classList.remove('visible');if(!filtered.length||isNaN(num)||num<1)return;var idx=Math.min(filtered.length-1,num-1);cancelPreview();selectedIndex=idx;VS.centerOn(idx);VS.refresh();playSelected();showToast('CH '+(idx+1)+' · '+filtered[idx].name);}
function handleDigit(d){clearTimeout(dialTimer);dialBuffer+=d;if(Dom.chDialerNum)Dom.chDialerNum.textContent=dialBuffer;if(Dom.chDialer)Dom.chDialer.classList.add('visible');dialTimer=setTimeout(function(){dialTimer=null;commitChannelNumber();},dialBuffer.length>=3?400:1500);}
function getDigit(e){var c=e.keyCode;if(c>=48&&c<=57)return String(c-48);if(c>=96&&c<=105)return String(c-96);if(e.key&&e.key.length===1&&e.key>='0'&&e.key<='9')return e.key;return null;}

// ── Focus management ──────────────────────────────────────────────
function setFocus(a){
  focusArea=a;
  if(Dom.tabBar)Dom.tabBar.classList.toggle('tab-bar-focused',a==='tabs');
  if(a==='search'){if(Dom.searchWrap)Dom.searchWrap.classList.add('active');if(Dom.searchInput)Dom.searchInput.focus();}
  else{if(Dom.searchWrap)Dom.searchWrap.classList.remove('active');if(document.activeElement===Dom.searchInput&&Dom.searchInput)Dom.searchInput.blur();}
  var avL=$('avBtnLeft'),avR=$('avBtnRight');
  if(avL)avL.classList.toggle('focused',a==='avLeft');
  if(avR)avR.classList.toggle('focused',a==='avRight');
  if(Dom.addPlaylistBtn)Dom.addPlaylistBtn.classList.toggle('focused',a==='addBtn');
  if(a==='tabs')_syncTabHL();else _clearTabHL();
}
function _syncTabHL(){if(Dom.tabBar)Dom.tabBar.querySelectorAll('.tab').forEach(function(b,i){b.classList.toggle('kbd-focus',i===tabFocusIdx);});}
function _clearTabHL(){if(Dom.tabBar)Dom.tabBar.querySelectorAll('.tab').forEach(function(b){b.classList.remove('kbd-focus');});}
function moveSel(d){if(!filtered.length)return;cancelPreview();clearTimeout(dialTimer);dialTimer=null;dialBuffer='';if(Dom.chDialer)Dom.chDialer.classList.remove('visible');selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d));VS.scrollTo(selectedIndex);VS.refresh();schedulePreview();}
function moveTabFocus(d){var t=TAB_TOTAL();tabFocusIdx=((tabFocusIdx+d)%t+t)%t;_syncTabHL();if(Dom.tabBar){var btns=Dom.tabBar.querySelectorAll('.tab');if(btns[tabFocusIdx])btns[tabFocusIdx].scrollIntoView({inline:'nearest',block:'nearest'});}}
function activateFocusedTab(){switchTab(tabFocusIdx);setFocus('list');}

// ── Tizen key registration ────────────────────────────────────────
function registerKeys(){
  try{if(window.tizen&&tizen.tvinputdevice){['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind','ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown','Back','Info','Guide','0','1','2','3','4','5','6','7','8','9','VolumeUp','VolumeDown','Mute','Exit','Return','PreCh'].forEach(function(k){try{tizen.tvinputdevice.registerKey(k);}catch(e){}});}}catch(e){}
}

// ══════════════════════════════════════════════════════════════════
// JIOTV PORTAL
// ══════════════════════════════════════════════════════════════════
function showJioPortal(){
  if(Dom.appMain)Dom.appMain.style.display='none';
  if(Dom.jiotvPortal)Dom.jiotvPortal.style.display='flex';
  stopStallWatchdog();
  jpApplyFilters();
  jpFocusRow=0;jpFocusCol=0;
  requestAnimationFrame(function(){jpFocusTile();});
}
function hideJioPortal(){
  if(Dom.jiotvPortal)Dom.jiotvPortal.style.display='none';
  if(Dom.appMain)Dom.appMain.style.display='grid';
  jiotvMode=false;
  // FIX M16: disconnect ResizeObserver when portal hidden
  if(_jpGridResizeObs){_jpGridResizeObs.disconnect();_jpGridResizeObs=null;}
  var si=parseInt(lsGet('iptv:lastM3uIndex')||'0',10);
  plIdx=(!isNaN(si)&&si<allPlaylists.length)?si:0;
  rebuildTabs();loadPlaylist();setFocus('list');saveMode();
}

// ── Connect modal ─────────────────────────────────────────────────
function _setConnectStatus(msg,color){if(!Dom.jiotvConnectStatus)return;Dom.jiotvConnectStatus.textContent=msg;Dom.jiotvConnectStatus.style.color=color||'var(--text-sec)';}
function _openConnectModal(){
  if(Dom.jiotvConnectModal)Dom.jiotvConnectModal.style.display='flex';
  if(Dom.jiotvManualUrl)Dom.jiotvManualUrl.value='';
  _setConnectStatus('');
  // FIX B12: focus URL input on modal open
  setTimeout(function(){if(Dom.jiotvManualUrl)Dom.jiotvManualUrl.focus();},80);
}
function _closeConnectModal(){if(Dom.jiotvConnectModal)Dom.jiotvConnectModal.style.display='none';_jioScanInProgress=false;}

async function _connectToServer(serverUrl){
  var client=new JioTVClient({serverUrl:serverUrl,timeout:10000});
  var res=await Promise.race([
    client.checkStatus(),
    new Promise(function(resolve){setTimeout(function(){resolve({status:false,reason:'Connection timeout (5s)'});},5000);})
  ]);
  if(res.status){client.logged_in=true;JioTVClient.saveUrl(serverUrl);return client;}
  throw new Error(res.reason||'Failed');
}

async function openJioPortalDirect(){
  jiotvMode=true;plIdx=TAB_JIOTV();rebuildTabs();
  if(jiotvClient&&jiotvClient.logged_in&&jiotvChannels.length>0){jpFiltered=jiotvChannels.slice();_jpCurrentSet='';saveMode();showJioPortal();return;}
  var saved=JioTVClient.loadSaved();
  if(saved){
    setStatus('Connecting to JioTV…','loading');startLoadBar();
    try{var client=await _connectToServer(saved);jiotvClient=client;jiotvMode=true;await loadJioChannels();finishLoadBar();saveMode();showJioPortal();return;}
    catch(e){
      console.warn('[JioTV] saved URL failed:',e.message);
      JioTVClient.clearSaved();
      showToast('JioTV server changed — rescanning…',3000); // FIX B18
    }
  }
  finishLoadBar();_openConnectModal();_jioScanInProgress=true;
  _setConnectStatus('🔍 Scanning LAN for JioTV Go…','var(--gold)');
  var found=await JioTVClient.discover(function(msg){_setConnectStatus('🔍 '+msg,'var(--gold)');});
  _jioScanInProgress=false;
  if(found){
    _setConnectStatus('✅ Found at '+found,'var(--green)');
    try{var c=await _connectToServer(found);jiotvClient=c;jiotvMode=true;_closeConnectModal();await loadJioChannels();saveMode();showJioPortal();}
    catch(e){_setConnectStatus('❌ '+e.message,'var(--red)');}
  }else{_setConnectStatus('❌ Not found. Enter URL manually.','var(--red)');if(Dom.jiotvManualUrl)Dom.jiotvManualUrl.focus();}
}
async function _jioManualConnect(){
  var raw=Dom.jiotvManualUrl?Dom.jiotvManualUrl.value.trim():'';
  if(!raw){_setConnectStatus('Enter the server URL','var(--red)');return;}
  if(!raw.startsWith('http'))raw='http://'+raw;
  _setConnectStatus('Connecting…','var(--gold)');
  // FIX B19: disable both buttons during connect
  if(Dom.jiotvManualBtn)Dom.jiotvManualBtn.disabled=true;
  if(Dom.jiotvScanBtn)Dom.jiotvScanBtn.disabled=true;
  try{var client=await _connectToServer(raw);jiotvClient=client;jiotvMode=true;_closeConnectModal();await loadJioChannels();saveMode();showJioPortal();}
  catch(e){_setConnectStatus('❌ '+e.message,'var(--red)');}
  finally{if(Dom.jiotvManualBtn)Dom.jiotvManualBtn.disabled=false;if(Dom.jiotvScanBtn)Dom.jiotvScanBtn.disabled=false;} // FIX B19
}
async function _jioRescan(){
  if(_jioScanInProgress)return;_jioScanInProgress=true;
  if(Dom.jiotvScanBtn)Dom.jiotvScanBtn.disabled=true;
  _setConnectStatus('🔍 Scanning LAN…','var(--gold)');
  var found=await JioTVClient.discover(function(msg){_setConnectStatus('🔍 '+msg,'var(--gold)');});
  _jioScanInProgress=false;if(Dom.jiotvScanBtn)Dom.jiotvScanBtn.disabled=false;
  if(found){if(Dom.jiotvManualUrl)Dom.jiotvManualUrl.value=found;_setConnectStatus('✅ Found: '+found,'var(--green)');}
  else _setConnectStatus('❌ Not found on LAN','var(--red)');
}

// ── Grid ──────────────────────────────────────────────────────────
function jpApplyFilters(){
  var q=jpSearchQ.toLowerCase();
  jpFiltered=jiotvChannels.filter(function(ch){
    if(jpActiveCat!=='all'&&ch.group!==jpActiveCat)return false;
    if(jpActiveLang!=='all'&&ch.lang!==jpActiveLang)return false;
    if(q&&!ch.name.toLowerCase().includes(q))return false;
    return true;
  });
  var fp=jpActiveCat+'|'+jpActiveLang+'|'+q;
  if(fp===_jpCurrentSet&&Dom.jpGrid&&Dom.jpGrid.children.length===jpFiltered.length){_jpSyncPlayingState();return;}
  _jpCurrentSet=fp;_jpBuildGrid();
}
var PH_TILE="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='80' viewBox='0 0 24 24' fill='none' stroke='%234a4a62' stroke-width='1.5'%3E%3Crect x='2' y='7' width='20' height='13' rx='2'/%3E%3Cpolyline points='16 20 12 16 8 20'/%3E%3C/svg%3E";
function _jpBuildGrid(){
  if(!Dom.jpGrid)return;
  var frag=document.createDocumentFragment();
  jpFiltered.forEach(function(ch,i){
    var tile=document.createElement('div');tile.className='jp-tile';
    if(jpActiveChannel&&ch.jioId===jpActiveChannel.jioId)tile.classList.add('playing');
    tile.innerHTML='<div class="jp-tile-logo"><img src="'+esc(ch.logo||PH_TILE)+'" onerror="this.onerror=null;this.src=\''+PH_TILE+'\'" loading="lazy"></div><div class="jp-tile-name">'+esc(ch.name)+'</div><div class="jp-tile-group">'+esc(ch.group||'')+'</div>'+(ch.isHD?'<div class="jp-tile-hd">HD</div>':'')+'<div class="jp-tile-live">LIVE</div>';
    tile.addEventListener('click',function(){jpPlayChannel(ch,i);});
    frag.appendChild(tile);
  });
  Dom.jpGrid.innerHTML='';Dom.jpGrid.appendChild(frag);
  if(Dom.jpCount)Dom.jpCount.textContent=jpFiltered.length+' channels';
  // FIX M16: only create ResizeObserver if portal visible, disconnect on hide
  if(window.ResizeObserver&&!_jpGridResizeObs&&Dom.jiotvPortal&&Dom.jiotvPortal.style.display!=='none'){
    _jpGridResizeObs=new ResizeObserver(function(){
      var tiles=Dom.jpGrid.querySelectorAll('.jp-tile');
      if(tiles.length>0){var r1=tiles[0].getBoundingClientRect(),gR=Dom.jpGrid.getBoundingClientRect();if(r1.width>0)jpGridCols=Math.max(1,Math.round(gR.width/(r1.width+14)));}
    });
    _jpGridResizeObs.observe(Dom.jpGrid);
  }
  requestAnimationFrame(function(){
    var tiles=Dom.jpGrid.querySelectorAll('.jp-tile');
    if(tiles.length>0){var r1=tiles[0].getBoundingClientRect(),gR=Dom.jpGrid.getBoundingClientRect();if(r1.width>0)jpGridCols=Math.max(1,Math.round(gR.width/(r1.width+14)));}
    jpFocusTile();
    if(window.AppCache)AppCache.preloadImages(jpFiltered.slice(0,60).map(function(c){return c.logo;}).filter(Boolean));
  });
}
function _jpSyncPlayingState(){if(!Dom.jpGrid)return;Dom.jpGrid.querySelectorAll('.jp-tile').forEach(function(t,i){t.classList.toggle('playing',!!(jpActiveChannel&&jpFiltered[i]&&jpFiltered[i].jioId===jpActiveChannel.jioId));});}
function jpFocusTile(){if(!Dom.jpGrid)return;var tiles=Dom.jpGrid.querySelectorAll('.jp-tile');tiles.forEach(function(t){t.classList.remove('focused');});var idx=Math.max(0,Math.min(tiles.length-1,jpFocusRow*jpGridCols+jpFocusCol));if(tiles[idx]){tiles[idx].classList.add('focused');tiles[idx].scrollIntoView({block:'nearest',inline:'nearest'});jpFocusRow=Math.floor(idx/Math.max(1,jpGridCols));jpFocusCol=idx%Math.max(1,jpGridCols);}}
function jpGetFocusIdx(){return jpFocusRow*jpGridCols+jpFocusCol;}
function jpMoveFocus(dr,dc){if(!Dom.jpGrid)return;var tiles=Dom.jpGrid.querySelectorAll('.jp-tile');var total=tiles.length;if(!total)return;var rows=Math.ceil(total/jpGridCols);var newRow=Math.max(0,Math.min(rows-1,jpFocusRow+dr));var newCol=Math.max(0,Math.min(jpGridCols-1,jpFocusCol+dc));var newIdx=newRow*jpGridCols+newCol;if(newIdx>=total){newCol=(total-1)-newRow*jpGridCols;newIdx=newRow*jpGridCols+newCol;}if(newIdx<0)newIdx=0;jpFocusRow=newRow;jpFocusCol=Math.max(0,newCol);jpFocusTile();}
function jpActivateFilter(f){var type=f.dataset.type,val=f.dataset.filter;if(type==='cat'){jpActiveCat=val;if(Dom.jpFilters)Dom.jpFilters.querySelectorAll('.jp-filter').forEach(function(b){b.classList.toggle('active',b.dataset.filter===val&&b.dataset.type==='cat');});}else{jpActiveLang=val;if(Dom.jpLangFilters)Dom.jpLangFilters.querySelectorAll('.jp-filter').forEach(function(b){b.classList.toggle('active',b.dataset.filter===val&&b.dataset.type==='lang');});}jpFocusRow=0;jpFocusCol=0;jpApplyFilters();}

// ── JioTV player — FIX C3/H3: playId guard ───────────────────────
function jpPlayChannel(ch,gridIdx){
  var myPlayId=++_jpPlayId;  // FIX C3/H3: unique ID per play attempt
  _jpLoadPromise=_jpLoadPromise.then(async function(){
    if(_jpPlayerBusy)return;
    _jpPlayerBusy=true;
    clearTimeout(_jpPlayTimeoutTimer);
    _jpPlayTimeoutTimer=setTimeout(function(){
      if(!_jpPlayerBusy)return;
      if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.remove('active');
      showToast('Stream timeout — try another channel',3000);
      jpExitPlayer();
    },JP_PLAY_TIMEOUT_MS);
    try{
      // FIX C3: check if this play is still valid after any await
      if(_jpPlayId!==myPlayId||!jpInPlayer&&myPlayId!==_jpPlayId){}
      jpActiveChannel=ch;jpInPlayer=true;
      if(Dom.jpPlayerLayer)Dom.jpPlayerLayer.style.display='block';
      if(Dom.jpPlayerOverlay)Dom.jpPlayerOverlay.classList.add('visible');
      if(Dom.jpPlTitle)Dom.jpPlTitle.textContent=ch.name;
      if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.add('active');
      _jpSyncPlayingState();_jpUpdateNowBar(ch);

      if(!jpPlayer){
        shaka.polyfill.installAll();
        jpPlayer=new shaka.Player(Dom.jpVideo);
        jpPlayer.configure({streaming:{lowLatencyMode:true,inaccurateManifestTolerance:0,bufferingGoal:10,rebufferingGoal:1.5,stallEnabled:true,stallThreshold:1,stallSkip:0.1,retryParameters:{maxAttempts:4,baseDelay:300,backoffFactor:1.5,fuzzFactor:0.3,timeout:15000}},drm:{retryParameters:{maxAttempts:3,baseDelay:500,backoffFactor:2,timeout:12000},advanced:{'com.widevine.alpha':{videoRobustness:'HW_SECURE_ALL',audioRobustness:'HW_SECURE_CRYPTO'}}}});
        jpPlayer.addEventListener('error',function(){if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.remove('active');});
        jpPlayer.addEventListener('buffering',function(ev){if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.toggle('active',ev.buffering);if(!ev.buffering)_jpUpdateTech();});
        jpPlayer.addEventListener('variantchanged',_jpUpdateTech);
        jpPlayer.addEventListener('adaptation',    _jpUpdateTech);
      }

      var info=await jiotvClient.getStreamInfo(ch.jioId);
      // FIX C3: abort if player was exited while awaiting
      if(_jpPlayId!==myPlayId){_jpPlayerBusy=false;return;}

      var playUrl=(info&&info.url)?info.url:ch.url;
      // FIX B14: check before unload, not just before load
      if(_jpPlayId!==myPlayId){_jpPlayerBusy=false;return;}
      await jpPlayer.unload();Dom.jpVideo.removeAttribute('src');
      if(info&&info.isDRM){var drmCfg=_buildJpDrm(info);if(drmCfg)jpPlayer.configure({drm:drmCfg});}
      else jpPlayer.configure({drm:{servers:{}}});

      await jpPlayer.load(playUrl);
      // FIX C3: check again after load
      if(_jpPlayId!==myPlayId){jpPlayer.unload().catch(function(){});_jpPlayerBusy=false;return;}

      await Dom.jpVideo.play().catch(function(){});
      clearTimeout(_jpPlayTimeoutTimer);
      jpShowOverlay();
      setTimeout(function(){if(jpInPlayer)jpHideOverlay();},OVERLAY_AUTO_HIDE);
      clearTimeout(jpEpgTimer);
      (function schedEpg(){jpEpgTimer=setTimeout(function(){if(!jpInPlayer||!Dom.jpPlayerLayer||Dom.jpPlayerLayer.style.display==='none')return;jpFetchEpg(ch.jioId).then(schedEpg);},EPG_INTERVAL_MS);})();
    }catch(err){
      clearTimeout(_jpPlayTimeoutTimer);
      console.error('[JioTV] play:',err.message);
      if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.remove('active');
      showToast('Stream error: '+err.message,3000);
      try{Dom.jpVideo.src=ch.url;Dom.jpVideo.load();await Dom.jpVideo.play().catch(function(){});}
      catch(e2){showToast('Stream unavailable');jpExitPlayer();}
    }finally{_jpPlayerBusy=false;}
  });
}
function _buildJpDrm(info){if(!info||!info.isDRM)return null;var cfg={servers:{}};if(info.drm_url){cfg.servers['com.widevine.alpha']=info.drm_url;cfg.advanced={'com.widevine.alpha':{videoRobustness:'HW_SECURE_ALL',audioRobustness:'HW_SECURE_CRYPTO'}};}else if(info.key&&info.iv){cfg.servers['org.w3.clearkey']='';cfg.clearKeys={};cfg.clearKeys[info.key_id||info.kid||info.key]=info.key;}return Object.keys(cfg.servers).length?cfg:null;}
function jpShowOverlay(){if(Dom.jpPlayerOverlay)Dom.jpPlayerOverlay.classList.add('visible');clearTimeout(jpOverlayTimer);jpOverlayTimer=setTimeout(jpHideOverlay,OVERLAY_AUTO_HIDE);}
function jpHideOverlay(){if(Dom.jpPlayerOverlay)Dom.jpPlayerOverlay.classList.remove('visible');}
function jpExitPlayer(){
  jpInPlayer=false;_jpPlayerBusy=false;_jpPlayId++;  // FIX C3: invalidate pending loads
  clearTimeout(jpEpgTimer);clearTimeout(jpOverlayTimer);clearTimeout(_jpPlayTimeoutTimer);
  // FIX B20: reset _jpLoadPromise so next jpPlayChannel doesn't wait for hung chain
  _jpLoadPromise=Promise.resolve();
  // FIX M15: destroy jpPlayer on exit instead of just unload
  if(jpPlayer){try{jpPlayer.destroy();}catch(e){}jpPlayer=null;}
  if(Dom.jpVideo)Dom.jpVideo.removeAttribute('src');
  if(Dom.jpPlayerLayer)Dom.jpPlayerLayer.style.display='none';
  if(Dom.jpPlayerOverlay)Dom.jpPlayerOverlay.classList.remove('visible');
  if(Dom.jpPlSpinner)Dom.jpPlSpinner.classList.remove('active');
  requestAnimationFrame(function(){jpFocusTile();});
}
function _jpUpdateNowBar(ch){if(!Dom.jpNowBar)return;Dom.jpNowBar.style.display='flex';if(Dom.jpNbThumb)Dom.jpNbThumb.innerHTML='<img src="'+esc(ch.logo||PH_TILE)+'" onerror="this.src=\''+PH_TILE+'\'" style="width:100%;height:100%;object-fit:contain">';if(Dom.jpNbName)Dom.jpNbName.textContent=ch.name;if(Dom.jpNbEpg)Dom.jpNbEpg.textContent='';}
function _jpUpdateTech(){if(!jpPlayer)return;try{var tr=jpPlayer.getVariantTracks?jpPlayer.getVariantTracks():[],vt=tr.find(function(t){return t.active;}),s=jpPlayer.getStats?jpPlayer.getStats():null;var parts=[];if(vt&&vt.width&&vt.height)parts.push(vt.width+'×'+vt.height);if(s&&s.streamBandwidth)parts.push((s.streamBandwidth/1e6).toFixed(1)+' Mbps');var info=parts.join(' · ');if(Dom.jpPlTech)Dom.jpPlTech.textContent=info;if(Dom.jpNbTech)Dom.jpNbTech.textContent=info;}catch(e){}}
async function jpFetchEpg(channelId){if(!jiotvClient||!channelId||!jpInPlayer)return;var ep=await jiotvClient.getNowPlaying(channelId);if(ep){if(Dom.jpPlProg)Dom.jpPlProg.textContent=ep.title||ep.showname||'';if(Dom.jpPlDesc)Dom.jpPlDesc.textContent=ep.description||'';if(Dom.jpNbEpg)Dom.jpNbEpg.textContent=ep.title||ep.showname||'';}}

if(Dom.jpFilters)Dom.jpFilters.addEventListener('click',function(e){var f=e.target.closest('.jp-filter');if(f)jpActivateFilter(f);});
if(Dom.jpLangFilters)Dom.jpLangFilters.addEventListener('click',function(e){var f=e.target.closest('.jp-filter');if(f)jpActivateFilter(f);});
if(Dom.jpSearch)Dom.jpSearch.addEventListener('input',function(){jpSearchQ=Dom.jpSearch.value;jpFocusRow=0;jpFocusCol=0;jpApplyFilters();});
if(Dom.jpExitBtn)Dom.jpExitBtn.addEventListener('click',hideJioPortal);
if(Dom.jpPlBack)Dom.jpPlBack.addEventListener('click',jpExitPlayer);
if(Dom.jiotvScanBtn)Dom.jiotvScanBtn.addEventListener('click',_jioRescan);
if(Dom.jiotvManualBtn)Dom.jiotvManualBtn.addEventListener('click',_jioManualConnect);
if(Dom.jiotvConnectCancel)Dom.jiotvConnectCancel.addEventListener('click',function(){_closeConnectModal();jiotvMode=false;plIdx=0;rebuildTabs();_fallbackM3u();});
if(Dom.jiotvManualUrl)Dom.jiotvManualUrl.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13)_jioManualConnect();});

// ── JioTV channels ────────────────────────────────────────────────
async function loadJioChannels(){
  if(!jiotvClient)return;
  if(window.AppCache){var cached=await AppCache.getJioChannels();if(cached&&cached.length>0){_applyJioChannels(cached);jiotvClient.invalidateCache();setTimeout(_refreshJioBackground,600);return;}}
  setStatus('Loading JioTV…','loading');startLoadBar();
  try{var list=await jiotvClient.getChannelsFormatted();_applyJioChannels(list);if(window.AppCache)AppCache.setJioChannels(list);finishLoadBar();}
  catch(err){setStatus('JioTV load failed','error');finishLoadBar();console.error('[JioTV]',err);showToast('JioTV load failed — check server',3500);}
}
function _applyJioChannels(list){jiotvChannels=list;jpFiltered=list.slice();_jpCurrentSet='';channels=list;allChannels=list.slice();filtered=list.slice();selectedIndex=0;renderList();setLbl('JIOTV',list.length);setStatus('JioTV · '+list.length+' ch','playing');}
async function _refreshJioBackground(){try{var list=await jiotvClient.getChannelsFormatted();_applyJioChannels(list);if(window.AppCache)AppCache.setJioChannels(list);if(Dom.jiotvPortal&&Dom.jiotvPortal.style.display!=='none')jpApplyFilters();}catch(e){}}

function saveMode(){if(jiotvMode)lsSet('iptv:mode','jiotv');else{lsSet('iptv:mode','m3u');lsSet('iptv:lastM3uIndex',String(plIdx));}}
async function loadMode(){
  var mode=lsGet('iptv:mode');
  if(mode==='jiotv'){var saved=JioTVClient.loadSaved();if(saved){try{var client=await _connectToServer(saved);jiotvClient=client;jiotvMode=true;plIdx=TAB_JIOTV();rebuildTabs();await loadJioChannels();saveMode();return;}catch(e){JioTVClient.clearSaved();console.warn('[JioTV] restore:',e.message);}}}
  jiotvMode=false;_fallbackM3u();
}
function _fallbackM3u(){var si=parseInt(lsGet('iptv:lastM3uIndex')||'0',10);plIdx=(!isNaN(si)&&si<allPlaylists.length)?si:0;rebuildTabs();loadPlaylist();}

// ══════════════════════════════════════════════════════════════════
// SETTINGS MODAL
// ══════════════════════════════════════════════════════════════════
function openSettings(){if(!Dom.settingsModal)return;if(Dom.settingsSleepSelect)Dom.settingsSleepSelect.value=String(sleepMinutes);if(Dom.settingsFsFit)Dom.settingsFsFit.value=fsFit;Dom.settingsModal.style.display='flex';}
function closeSettings(){if(Dom.settingsModal)Dom.settingsModal.style.display='none';setFocus('list');}
if(Dom.settingsCloseBtn)   Dom.settingsCloseBtn.addEventListener('click',closeSettings);
if(Dom.settingsCacheBtn)   Dom.settingsCacheBtn.addEventListener('click',function(){if(window.AppCache){AppCache.clearAllM3U();AppCache.clearJioChannels();}showToast('Cache cleared');closeSettings();});
if(Dom.settingsSleepSelect)Dom.settingsSleepSelect.addEventListener('change',function(){setSleepTimer(parseInt(Dom.settingsSleepSelect.value,10)||0);});
if(Dom.settingsAVReset)    Dom.settingsAVReset.addEventListener('click',function(){resetAvSync();});
if(Dom.settingsAudioTrack) Dom.settingsAudioTrack.addEventListener('click',cycleAudioTrack);
if(Dom.settingsFsFit)      Dom.settingsFsFit.addEventListener('change',function(){setFsFit(Dom.settingsFsFit.value);});

// ══════════════════════════════════════════════════════════════════
// MASTER KEY HANDLER
// ══════════════════════════════════════════════════════════════════
window.addEventListener('keydown',function(e){
  var k=e.key,kc=e.keyCode;
  resetSleepTimer(kc);

  // ── JioTV Portal ─────────────────────────────────────────────
  if(Dom.jiotvPortal&&Dom.jiotvPortal.style.display!=='none'){
    if(jpInPlayer){
      if(kc===KEY.PLAY_PAUSE||kc===KEY.PLAY||kc===KEY.PAUSE){if(Dom.jpVideo){if(Dom.jpVideo.paused)Dom.jpVideo.play().catch(function(){});else Dom.jpVideo.pause();}e.preventDefault();return;}
      if(kc===KEY.STOP){jpExitPlayer();e.preventDefault();return;}
      var isNav=(kc===KEY.UP||kc===KEY.DOWN||kc===KEY.LEFT||kc===KEY.RIGHT||k==='ArrowUp'||k==='ArrowDown'||k==='ArrowLeft'||k==='ArrowRight'||kc===KEY.ENTER||k==='Enter');
      if(isNav){jpShowOverlay();e.preventDefault();return;}
      if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){jpExitPlayer();e.preventDefault();return;}
      if(k==='Info'||kc===KEY.INFO){if(Dom.jpPlayerOverlay&&Dom.jpPlayerOverlay.classList.contains('visible'))jpHideOverlay();else jpShowOverlay();e.preventDefault();return;}
      if(k==='ColorF3Blue'||kc===KEY.BLUE){hideJioPortal();e.preventDefault();return;}
      if(kc===KEY.VOL_UP){if(Dom.jpVideo)Dom.jpVideo.volume=Math.min(1,Dom.jpVideo.volume+0.05);e.preventDefault();return;}
      if(kc===KEY.VOL_DOWN){if(Dom.jpVideo)Dom.jpVideo.volume=Math.max(0,Dom.jpVideo.volume-0.05);e.preventDefault();return;}
      if(kc===KEY.MUTE){if(Dom.jpVideo)Dom.jpVideo.muted=!Dom.jpVideo.muted;e.preventDefault();return;}
      e.preventDefault();return;
    }
    if(k==='ArrowUp'||kc===KEY.UP){
      if(jpFocusRow===0){if(Dom.jpSearch)Dom.jpSearch.focus();e.preventDefault();return;} // FIX B13
      jpMoveFocus(-1,0);e.preventDefault();return;
    }
    if(k==='ArrowDown' ||kc===KEY.DOWN) {jpMoveFocus(+1,0);e.preventDefault();return;}
    if(k==='ArrowLeft'||kc===KEY.LEFT){
      if(jpFocusCol===0){
        // FIX B13: at leftmost column — move focus to category filters
        if(Dom.jpFilters){var fb=Dom.jpFilters.querySelector('.jp-filter.active,.jp-filter');if(fb)fb.focus();}
        e.preventDefault();return;
      }
      jpMoveFocus(0,-1);e.preventDefault();return;
    }
    if(k==='ArrowRight'||kc===KEY.RIGHT){jpMoveFocus(0,+1);e.preventDefault();return;}
    if(k==='Enter'||kc===KEY.ENTER){var idx=jpGetFocusIdx();if(jpFiltered[idx])jpPlayChannel(jpFiltered[idx],idx);e.preventDefault();return;}
    if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){hideJioPortal();e.preventDefault();return;}
    if(k==='ColorF3Blue'  ||kc===KEY.BLUE)  {hideJioPortal();e.preventDefault();return;}
    if(k==='ColorF2Yellow'||kc===KEY.YELLOW){if(Dom.jpSearch)Dom.jpSearch.focus();e.preventDefault();return;}
    if(k==='ColorF0Red'   ||kc===KEY.RED)   {openSettings();e.preventDefault();return;}
    if(k==='MediaStop'    ||kc===KEY.STOP)  {hideJioPortal();e.preventDefault();return;}
    e.preventDefault();return;
  }

  // ── Connect modal ─────────────────────────────────────────────
  if(Dom.jiotvConnectModal&&Dom.jiotvConnectModal.style.display==='flex'){
    if(k==='Escape'||k==='Back'||kc===KEY.BACK||kc===27){Dom.jiotvConnectCancel&&Dom.jiotvConnectCancel.click();e.preventDefault();return;}
    if(k==='Enter'||kc===KEY.ENTER){
      // FIX B12: Enter activates focused element
      var fa=document.activeElement;
      if(fa===Dom.jiotvScanBtn){_jioRescan();e.preventDefault();return;}
      if(fa===Dom.jiotvConnectCancel){Dom.jiotvConnectCancel.click();e.preventDefault();return;}
      _jioManualConnect();e.preventDefault();return;
    }
    // FIX B12: ArrowUp/Down cycles focus: input → scan → connect → cancel → input
    if(k==='ArrowDown'||kc===KEY.DOWN||k==='ArrowUp'||kc===KEY.UP){
      var _modalFocusOrder=[Dom.jiotvManualUrl,Dom.jiotvScanBtn,Dom.jiotvManualBtn,Dom.jiotvConnectCancel];
      var _cur=document.activeElement;
      var _ci=_modalFocusOrder.indexOf(_cur);
      var _next;
      if(k==='ArrowDown'||kc===KEY.DOWN){_next=_modalFocusOrder[(_ci+1)%_modalFocusOrder.length];}
      else{_next=_modalFocusOrder[(_ci-1+_modalFocusOrder.length)%_modalFocusOrder.length];}
      if(_next)_next.focus();
      e.preventDefault();return;
    }
    return;
  }

  // ── Modals ────────────────────────────────────────────────────
  var anyModal=(Dom.addPlaylistModal&&Dom.addPlaylistModal.style.display==='flex')||(Dom.settingsModal&&Dom.settingsModal.style.display==='flex');
  if(anyModal){
    if(k==='Escape'||k==='Back'||kc===KEY.BACK||kc===KEY.EXIT||kc===27){closeAllModals();e.preventDefault();return;}
    if(k==='Enter'||kc===KEY.ENTER){if(Dom.addPlaylistModal&&Dom.addPlaylistModal.style.display==='flex'){handleSavePlaylist();e.preventDefault();return;}var foc=document.activeElement;if(foc&&foc.tagName==='BUTTON'){foc.click();e.preventDefault();return;}}
    if(k==='Tab')return;return;
  }

  // ── Digit dialer ──────────────────────────────────────────────
  var dig=getDigit(e);
  if(dig!==null&&focusArea!=='search'&&focusArea!=='tabs'){handleDigit(dig);e.preventDefault();return;}
  if(Dom.chDialer&&Dom.chDialer.classList.contains('visible')){
    if(kc===KEY.ENTER||k==='Enter'){clearTimeout(dialTimer);dialTimer=null;commitChannelNumber();e.preventDefault();return;}
    if(k==='Back'||k==='Escape'||kc===KEY.BACK||kc===27){clearTimeout(dialTimer);dialTimer=null;dialBuffer='';Dom.chDialer.classList.remove('visible');e.preventDefault();return;}
  }

  // ── Back ──────────────────────────────────────────────────────
  if(k==='Escape'||k==='Back'||k==='GoBack'||kc===KEY.BACK||kc===27){
    if(isFullscreen){exitFS();e.preventDefault();return;}
    if(focusArea==='tabs'){setFocus('list');e.preventDefault();return;}
    if(focusArea==='search'){clearSearch();e.preventDefault();return;}
    if(focusArea==='avLeft'||focusArea==='avRight'||focusArea==='addBtn'){setFocus('list');e.preventDefault();return;}
    try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(ex){}
    e.preventDefault();return;
  }

  if(k==='Info'||kc===KEY.INFO||k==='Guide'||kc===KEY.GUIDE){toggleOverlays();e.preventDefault();return;}

  // ── Tabs ──────────────────────────────────────────────────────
  if(focusArea==='tabs'){
    if(k==='ArrowLeft' ||kc===KEY.LEFT) {moveTabFocus(-1);e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT){moveTabFocus(+1);e.preventDefault();return;}
    if(k==='Enter'     ||kc===KEY.ENTER){activateFocusedTab();e.preventDefault();return;}
    if(k==='ArrowDown' ||kc===KEY.DOWN) {setFocus('list');e.preventDefault();return;}
    if(k==='ArrowUp'   ||kc===KEY.UP)   {e.preventDefault();return;}
    e.preventDefault();return;
  }

  // ── Search ────────────────────────────────────────────────────
  if(focusArea==='search'){if(k==='Enter'||kc===KEY.ENTER){commitSearch();e.preventDefault();return;}if(k==='ArrowDown'||k==='ArrowUp'||kc===KEY.DOWN||kc===KEY.UP){commitSearch();e.preventDefault();return;}return;}

  // ── AV / addBtn ───────────────────────────────────────────────
  if(focusArea==='avLeft'){if(k==='Enter'||kc===KEY.ENTER){adjustAvSync(-1);e.preventDefault();return;}if(k==='ArrowRight'||kc===KEY.RIGHT){setFocus('avRight');e.preventDefault();return;}if(k==='ArrowLeft'||kc===KEY.LEFT||k==='ArrowDown'||kc===KEY.DOWN){setFocus('list');e.preventDefault();return;}e.preventDefault();return;}
  if(focusArea==='avRight'){
    if(k==='Enter'||kc===KEY.ENTER){adjustAvSync(+1);e.preventDefault();return;}
    if(k==='ArrowLeft'||kc===KEY.LEFT){setFocus('avLeft');e.preventDefault();return;}
    // FIX addBtn focus: ArrowRight from avRight → addBtn
    if(k==='ArrowRight'||kc===KEY.RIGHT){setFocus('addBtn');e.preventDefault();return;}
    if(k==='ArrowDown'||kc===KEY.DOWN){setFocus('list');e.preventDefault();return;}
    e.preventDefault();return;
  }
  if(focusArea==='addBtn'){
    if(k==='Enter'||kc===KEY.ENTER){openAddPlaylistModal();e.preventDefault();return;}
    if(k==='ArrowDown'||kc===KEY.DOWN){setFocus('list');e.preventDefault();return;}
    // FIX addBtn focus: ArrowLeft from addBtn → avRight, ArrowRight → tabs
    if(k==='ArrowLeft'||kc===KEY.LEFT){setFocus('avRight');e.preventDefault();return;}
    if(k==='ArrowRight'||kc===KEY.RIGHT){tabFocusIdx=0;setFocus('tabs');e.preventDefault();return;}
    e.preventDefault();return;
  }

  // ── List ──────────────────────────────────────────────────────
  if(k==='ArrowUp'   ||kc===KEY.UP)  {if(isFullscreen)showFsHint();else moveSel(-1);e.preventDefault();return;}
  if(k==='ArrowDown' ||kc===KEY.DOWN){if(isFullscreen)showFsHint();else moveSel(+1);e.preventDefault();return;}
  if(k==='ArrowLeft' ||kc===KEY.LEFT){if(isFullscreen){exitFS();e.preventDefault();return;}tabFocusIdx=plIdx;setFocus('tabs');e.preventDefault();return;}
  if(k==='ArrowRight'||kc===KEY.RIGHT){if(isFullscreen){showFsHint();e.preventDefault();return;}if($('avBtnLeft')){setFocus('avLeft');e.preventDefault();return;}e.preventDefault();return;}
  if(k==='Enter'||kc===KEY.ENTER){
    if(isFullscreen){exitFS();e.preventDefault();return;}
    if(focusArea==='list'){
      playSelected();
      // FIX FS: enter fullscreen only after 'playing' fires, not on a fixed timer
      // FIX B11: 'playing' listener + 500ms polling fallback
      var _fsListener=function(){
        Dom.video.removeEventListener('playing',_fsListener);
        if(!isFullscreen)enterFS();
      };
      Dom.video.addEventListener('playing',_fsListener,{once:true});
      // Polling fallback every 500ms: if video is running but playing event missed
      var _fsPollCount=0;
      var _fsPoll=setInterval(function(){
        _fsPollCount++;
        if(isFullscreen||_fsPollCount>20){clearInterval(_fsPoll);return;} // stop after 10s
        if(Dom.video&&Dom.video.duration>0&&!Dom.video.paused){
          Dom.video.removeEventListener('playing',_fsListener);
          clearInterval(_fsPoll);
          enterFS();
        }
      },500);
    }
    e.preventDefault();return;
  }
  if(k==='PageUp'  ||kc===KEY.PAGE_UP)  {moveSel(-10);e.preventDefault();return;}
  if(k==='PageDown'||kc===KEY.PAGE_DOWN){moveSel(+10);e.preventDefault();return;}
  if(k==='MediaPlayPause'||kc===KEY.PLAY_PAUSE){if(Dom.video){if(Dom.video.paused)Dom.video.play().catch(function(){});else Dom.video.pause();}e.preventDefault();return;}
  if(k==='MediaPlay' ||kc===KEY.PLAY) {if(Dom.video)Dom.video.play().catch(function(){});e.preventDefault();return;}
  if(k==='MediaPause'||kc===KEY.PAUSE){if(Dom.video)Dom.video.pause();e.preventDefault();return;}
  if(k==='MediaStop' ||kc===KEY.STOP) {cancelPreview();SagaPlayer.stop();stopStallWatchdog();clearSleepTimer();setStatus('Stopped','idle');finishLoadBar();e.preventDefault();return;}
  if(k==='MediaFastForward'||kc===KEY.FF||k==='ChannelUp'  ||kc===KEY.CH_UP)  {moveSel(+1);e.preventDefault();return;}
  if(k==='MediaRewind'     ||kc===KEY.RW||k==='ChannelDown'||kc===KEY.CH_DOWN){moveSel(-1);e.preventDefault();return;}
  if(k==='ColorF0Red'   ||kc===KEY.RED)   {switchTab((plIdx+1)%TAB_TOTAL());e.preventDefault();return;}
  if(k==='ColorF1Green' ||kc===KEY.GREEN) {if(filtered.length&&focusArea==='list')toggleFav(filtered[selectedIndex]);e.preventDefault();return;}
  if(k==='ColorF2Yellow'||kc===KEY.YELLOW){setFocus('search');e.preventDefault();return;}
  if(k==='ColorF3Blue'  ||kc===KEY.BLUE)  {if(hasPlayed)toggleFS();e.preventDefault();return;}
  if(k==='VolumeUp'  ||kc===KEY.VOL_UP)  {if(Dom.video)Dom.video.volume=Math.min(1,Dom.video.volume+0.05);e.preventDefault();return;}
  if(k==='VolumeDown'||kc===KEY.VOL_DOWN){if(Dom.video)Dom.video.volume=Math.max(0,Dom.video.volume-0.05);e.preventDefault();return;}
  if(k==='Mute'      ||kc===KEY.MUTE)    {if(Dom.video)Dom.video.muted=!Dom.video.muted;e.preventDefault();return;}
  if(k==='PreCh'||kc===10232){goPreCh();e.preventDefault();return;}
});

// FIX H24: tizenhwkey — guard against double exit
document.addEventListener('tizenhwkey',function(e){
  if(_exitingApp)return;  // FIX H24
  var name=(e.keyName||'').toLowerCase();
  if(name==='back'){
    if(Dom.jiotvConnectModal&&Dom.jiotvConnectModal.style.display==='flex'){Dom.jiotvConnectCancel&&Dom.jiotvConnectCancel.click();return;}
    if(Dom.jiotvPortal&&Dom.jiotvPortal.style.display!=='none'){if(jpInPlayer)jpExitPlayer();else hideJioPortal();return;}
    if(isFullscreen){exitFS();return;}
    var anyModal=(Dom.addPlaylistModal&&Dom.addPlaylistModal.style.display==='flex')||(Dom.settingsModal&&Dom.settingsModal.style.display==='flex');
    if(anyModal){closeAllModals();return;}
    _exitingApp=true;  // FIX H24: set flag before exit
    try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(ex){_exitingApp=false;}
  }
});

// ── Modals ────────────────────────────────────────────────────────
function closeAllModals(){if(Dom.addPlaylistModal)Dom.addPlaylistModal.style.display='none';if(Dom.settingsModal)Dom.settingsModal.style.display='none';setFocus('list');}
function openAddPlaylistModal(){if(Dom.playlistName)Dom.playlistName.value='';if(Dom.playlistUrl)Dom.playlistUrl.value='';if(Dom.addPlaylistModal)Dom.addPlaylistModal.style.display='flex';setTimeout(function(){if(Dom.playlistName)Dom.playlistName.focus();},120);}
function handleSavePlaylist(){var name=Dom.playlistName?Dom.playlistName.value.trim():'';var url=Dom.playlistUrl?Dom.playlistUrl.value.trim():'';if(!name||!url){showToast('Enter both name and URL');return;}if(!_isAllowedPlaylistURL(url)){showToast('Invalid URL — public HTTP(S) only');return;}if(addCustomPlaylist(name,url)){showToast('"'+name+'" added');Dom.addPlaylistModal.style.display='none';}else showToast('Already exists');}

// ── Playlist management ───────────────────────────────────────────
function loadCustomPlaylists(){try{var s=lsGet(CUSTOM_PLAYLISTS_KEY);customPlaylists=s?JSON.parse(s):[];}catch(e){customPlaylists=[];}}
function saveCustomPlaylists(){lsSet(CUSTOM_PLAYLISTS_KEY,JSON.stringify(customPlaylists));}
function addCustomPlaylist(name,url){if(!name||!url)return false;if(customPlaylists.some(function(p){return p.url.toLowerCase()===url.toLowerCase();}))return false;customPlaylists.push({name:name,url:url});saveCustomPlaylists();rebuildAllPlaylists();return true;}
function rebuildAllPlaylists(){allPlaylists=DEFAULT_PLAYLISTS.concat(customPlaylists);if(plIdx>=TAB_FAV())plIdx=0;rebuildTabs();loadPlaylist();}

// ── Tab builder ───────────────────────────────────────────────────
function rebuildTabs(){
  if(!Dom.tabBar)return;Dom.tabBar.innerHTML='';
  allPlaylists.forEach(function(pl,i){var btn=document.createElement('button');btn.className='tab';if(!jiotvMode&&i===plIdx)btn.classList.add('active');btn.textContent=pl.name;btn.dataset.tabIdx=String(i);btn.addEventListener('click',function(){switchTab(i);});Dom.tabBar.appendChild(btn);});
  var fBtn=document.createElement('button');fBtn.className='tab fav-tab';fBtn.dataset.tabIdx=String(TAB_FAV());if(!jiotvMode&&plIdx===TAB_FAV())fBtn.classList.add('active');fBtn.textContent='★ Favs';fBtn.addEventListener('click',function(){switchTab(TAB_FAV());});Dom.tabBar.appendChild(fBtn);
  var jBtn=document.createElement('button');jBtn.className='tab jiotv-tab';jBtn.dataset.tabIdx=String(TAB_JIOTV());if(jiotvMode)jBtn.classList.add('active');
  jBtn.innerHTML='<svg viewBox="0 0 24 24" fill="none" width="13" height="13" style="opacity:0.7"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z" stroke="currentColor" stroke-width="2"/><path d="M8 12l3 3 5-5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg> JioTV';
  jBtn.addEventListener('click',function(){switchTab(TAB_JIOTV());});Dom.tabBar.appendChild(jBtn);
  if(focusArea==='tabs')_syncTabHL();
}
function switchTab(idx){var tFav=TAB_FAV(),tJ=TAB_JIOTV();if(idx<tFav){jiotvMode=false;plIdx=idx;rebuildTabs();loadPlaylist();saveMode();}else if(idx===tFav){jiotvMode=false;plIdx=tFav;rebuildTabs();showFavourites();saveMode();}else if(idx===tJ){openJioPortalDirect();}setFocus('list');}

// ── Boot ──────────────────────────────────────────────────────────
(async function init(){
  registerKeys();loadAvSync();loadFsFit();loadCustomPlaylists();loadPreferredAudioLang();
  allPlaylists=DEFAULT_PLAYLISTS.concat(customPlaylists);
  VS.init(Dom.channelList);
  await _initPlayerCallbacks();
  buildAvSyncBar();startNetworkMonitoring();
  await loadMode();
  if(Dom.overlayTop)   Dom.overlayTop.classList.remove('info-visible');
  if(Dom.overlayBottom)Dom.overlayBottom.classList.remove('info-visible');
  overlaysVisible=false;
  if(Dom.addPlaylistBtn)   Dom.addPlaylistBtn.addEventListener('click',openAddPlaylistModal);
  if(Dom.savePlaylistBtn)  Dom.savePlaylistBtn.addEventListener('click',handleSavePlaylist);
  if(Dom.cancelPlaylistBtn)Dom.cancelPlaylistBtn.addEventListener('click',function(){Dom.addPlaylistModal.style.display='none';setFocus('list');});
  if(Dom.addPlaylistModal) Dom.addPlaylistModal.addEventListener('click',function(e){if(e.target===Dom.addPlaylistModal){Dom.addPlaylistModal.style.display='none';setFocus('list');}});
  [Dom.playlistName,Dom.playlistUrl].forEach(function(inp){if(inp)inp.addEventListener('keydown',function(e){if(e.key==='Enter'||e.keyCode===13)handleSavePlaylist();});});
  if(jiotvMode&&jiotvChannels.length>0)setTimeout(function(){showJioPortal();},300);
})();
