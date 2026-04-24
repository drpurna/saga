/*══════════════════════════════════════════════════════════════
  SAGA IPTV v15 — Performance Edition
  Samsung Tizen OS9 · AVPlay prepareAsync (non-blocking!)
  Twice-a-week playlist refresh · Instant cache startup
  Zero-jank remote · Diff-patch strip · Aggressive ABR
══════════════════════════════════════════════════════════════*/
(function(){'use strict';

/* ── rIC polyfill ── */
if(typeof requestIdleCallback==='undefined'){
  window.requestIdleCallback=function(cb,o){return setTimeout(function(){cb({timeRemaining:function(){return 50}})},o&&o.timeout?Math.min(o.timeout,32):16)};
  window.cancelIdleCallback=clearTimeout;
}

/* ── Tizen key registration ── */
(function(){
  try{if(!window.tizen||!tizen.tvinputdevice)return;
    ['ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
     'MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind',
     'ChannelUp','ChannelDown','VolumeUp','VolumeDown','VolumeMute',
     'Menu','Info','Tools','Extra',
     '0','1','2','3','4','5','6','7','8','9',
     'Exit','Return','Back','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Enter'
    ].forEach(function(k){try{tizen.tvinputdevice.registerKey(k)}catch(e){}});
  }catch(e){}
})();

/* ════════════════════════════════════════════
   CONSTANTS
════════════════════════════════════════════ */
var CW=240,CH=144,CGAP=12;
var VPORT=7;
var AUTO_HIDE_MS=4000;
var PLAY_DEB=110;
/* Twice-a-week = 3.5 days */
var PL_REFRESH_INTERVAL=3.5*24*60*60*1000;
var PL_REFRESH_KEY='saga:lastRefreshV15';
var CH_CACHE_KEY='saga:chCacheV15';
var CH_CACHE_TTL=3.5*24*60*60*1000;

var ASPECTS=['Contain','Stretch (default)','Cover'];
var LS={FAVS:'saga:favs',PL:'saga:pl',CFG:'saga:cfg',LCHU:'saga:lchu'};
var GROUP_MAP={
  'news':'News','news channels':'News','live news':'News',
  'sports':'Sports','live sports':'Sports','cricket':'Sports','football':'Sports',
  'entertainment':'Entertainment','general entertainment':'Entertainment',
  'movies':'Movies','kids':'Entertainment','music':'Entertainment','movie':'Movies','films':'Movies','vod':'Movies'
};
var BUILTINS=[
  {name:'Telugu',url:'https://iptv-org.github.io/iptv/languages/tel.m3u',builtIn:true,_src:'telugu'},
  {name:'Jio',   url:'https://jioplaylist.joinus-apiworker.workers.dev/playlist.m3u',builtIn:true,_src:'jio'},
  {name:'YuppTV',url:'https://yupptv.yecic62314.workers.dev/',builtIn:true,_src:'yupp'},
  {name:'CricHD',url:'https://raw.githubusercontent.com/abusaeeidx/CricHd-playlists-Auto-Update-permanent/main/CricHd.m3u',builtIn:true,_src:'crichd'}
];

/* ── DOM refs ── */
var $=function(id){return document.getElementById(id)};
var QA=function(s,r){return[].slice.call((r||document).querySelectorAll(s))};
var video=$('video'),vig=$('vig'),topBar=$('topBar'),navTabs=$('navTabs');
var bottomPanel=$('bottomPanel'),nowInfo=$('nowInfo'),nowName=$('nowName');
var nowGroup=$('nowGroup'),nowQ=$('nowQ'),nowEngine=$('nowEngine');
var epgRow=$('epgRow'),epgTime=$('epgTime'),epgProg=$('epgProg');
var rowLabel=$('rowLabel'),rowCount=$('rowCount');
var yellowPopup=$('yellowPopup'),ypForm=$('ypForm');
var settingsOv=$('settingsOv'),soSide=$('soSide'),soMain=$('soMain');
var mDial=$('mDial'),dnum=$('dnum');
var volHudEl=$('volHud'),volFill=$('volFill'),volPct=$('volPct'),volIco=$('volIco');
var sBuf=$('sBuf'),sTxt=$('sTxt'),sBw=$('sBw'),sClock=$('sClock');
var statusBar=$('statusBar'),topClock=$('topClock');
var engBadge=$('engBadge'),bufSpinner=$('bufSpinner');
var avCont=$('avContainer');
var cc=$('cc'),ccx;
try{ccx=cc.getContext('2d',{willReadFrequently:true})}catch(e){ccx=cc.getContext('2d')}

/* ── State ── */
var shakaPlayer=null,avplay=null;
var ENGINE='none';
var avReady=false;
var allChs=[],viewChs=[];
var curUrl='',isPlaying=false,isMuted=false,aspectMode=1;
var favs=new Set(),pls=[],searchQ='';
var activeTab='Telugu',showFavs=false;
var col=0,renderFrom=0;
var hideTimer=null,uiVisible=true;
var zone='rows';
var tabIdx=0,ypIdx=0,soSideIdx=0,soMainIdx=0,soSideZone=true;
var dialStr='',dialTimer=null,rDialStr='',rDialTimer=null;
var playTimer=null,volTimer=null,osdTimer=null,engBadgeTimer=null;
var currentVol=50;
var cfg={hq:true,muteSwitch:false,buf:10,osd:true,engine:'auto'};

/* ════════════════════════════════════════════
   UTILS
════════════════════════════════════════════ */
function esc(s){if(!s)return'';return String(s).replace(/[&<>'"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]})}
function lsGet(k){try{return localStorage.getItem(k)}catch(e){return null}}
function lsSet(k,v){try{localStorage.setItem(k,v)}catch(e){}}
function setSt(msg,state){if(sTxt)sTxt.textContent=msg||'';if(sBuf)sBuf.className=state?('sdot '+state):'sdot'}

/* ════════════════════════════════════════════
   AUTO-HIDE UI
════════════════════════════════════════════ */
function wakeUI(){
  if(!uiVisible){
    uiVisible=true;
    topBar.classList.remove('hide');bottomPanel.classList.remove('hide');
    vig.classList.remove('dim');statusBar.classList.remove('hide');
  }
  resetOsd();resetHideTimer();
}
function setPlaying(val){
  isPlaying=val;
  if(val)resetHideTimer();
  else{clearTimeout(hideTimer);if(!uiVisible){uiVisible=true;topBar.classList.remove('hide');bottomPanel.classList.remove('hide');vig.classList.remove('dim');statusBar.classList.remove('hide');}}
}
function hideUI(){
  if(!isPlaying||zone==='yp'||zone==='settings'||zone==='dialer'||zone==='search'||zone==='exit')return;
  uiVisible=false;topBar.classList.add('hide');bottomPanel.classList.add('hide');vig.classList.add('dim');statusBar.classList.add('hide');
}
function resetHideTimer(){clearTimeout(hideTimer);if(isPlaying)hideTimer=setTimeout(hideUI,AUTO_HIDE_MS)}

/* ════════════════════════════════════════════
   VOLUME
════════════════════════════════════════════ */
function getSysVol(){try{if(window.tizen&&tizen.tvaudiocontrol)return tizen.tvaudiocontrol.getVolume()}catch(e){}return Math.round(video.volume*100)}
function setSysVol(v){v=Math.max(0,Math.min(100,v));try{if(window.tizen&&tizen.tvaudiocontrol){tizen.tvaudiocontrol.setVolume(v);return}}catch(e){}video.volume=v/100}
function volUp(){currentVol=Math.min(100,getSysVol()+5);setSysVol(currentVol);showVol()}
function volDown(){currentVol=Math.max(0,getSysVol()-5);setSysVol(currentVol);showVol()}
function showVol(){
  currentVol=getSysVol();
  volFill.style.width=currentVol+'%';volPct.textContent=currentVol;
  volIco.textContent=currentVol===0?'🔇':currentVol<40?'🔉':'🔊';
  volHudEl.classList.add('on');clearTimeout(volTimer);volTimer=setTimeout(function(){volHudEl.classList.remove('on')},1600);
}

/* ════════════════════════════════════════════
   STORAGE
════════════════════════════════════════════ */
function loadStore(){
  try{var r=lsGet(LS.FAVS);if(r)favs=new Set(JSON.parse(r))}catch(e){}
  try{var r2=lsGet(LS.PL);if(r2)pls=JSON.parse(r2)}catch(e){}
  try{var r3=lsGet(LS.CFG);if(r3)Object.assign(cfg,JSON.parse(r3))}catch(e){}
}
function saveFavs(){lsSet(LS.FAVS,JSON.stringify(Array.from(favs)))}
function savePls(){lsSet(LS.PL,JSON.stringify(pls.filter(function(p){return!p.builtIn})))}
function saveCfg(){lsSet(LS.CFG,JSON.stringify(cfg))}

/* ════════════════════════════════════════════
   CHANNEL CACHE — 3.5-day TTL, instant startup
════════════════════════════════════════════ */
function saveChCache(){
  requestIdleCallback(function(){
    try{AppCache.setChannelCache(CH_CACHE_KEY,JSON.stringify({ts:Date.now(),chs:allChs,tab:activeTab}))}catch(e){}
  },{timeout:3000});
}
function loadChCache(){
  return AppCache.getChannelCache(CH_CACHE_KEY).then(function(raw){
    if(!raw)return null;
    try{var d=JSON.parse(raw);if(d&&d.chs&&d.chs.length>0&&(Date.now()-(d.ts||0))<CH_CACHE_TTL)return d}catch(e){}
    return null;
  }).catch(function(){return null});
}

/* ════════════════════════════════════════════
   COLOUR EXTRACTOR
════════════════════════════════════════════ */
function extractColour(img,cb){
  try{
    ccx.clearRect(0,0,8,8);ccx.drawImage(img,0,0,8,8);
    var d=ccx.getImageData(0,0,8,8).data,r=0,g=0,b=0,n=0;
    for(var i=0;i<d.length;i+=4){
      if(d[i+3]<40)continue;
      var mx=Math.max(d[i],d[i+1],d[i+2]),mn=Math.min(d[i],d[i+1],d[i+2]);
      var w=.15+(mx>0?(mx-mn)/mx*.85:0);r+=d[i]*w;g+=d[i+1]*w;b+=d[i+2]*w;n+=w;
    }
    if(n<1){cb(null);return}
    cb('rgb('+Math.round(r/n*.28)+','+Math.round(g/n*.28)+','+Math.round(b/n*.28)+')');
  }catch(e){cb(null)}
}

/* ════════════════════════════════════════════
   PARSERS
════════════════════════════════════════════ */
function parseJsonChannels(txt,srcTag){
  var data=JSON.parse(txt);if(!Array.isArray(data))data=[data];
  var out=[];
  for(var i=0;i<data.length;i++){
    var it=data[i];if(!it)continue;
    var url=it.m3u8||it.url||it.stream_url||it.stream||it.link;if(!url)continue;
    out.push({name:String(it.name||it.title||it.channel_name||'Channel').trim(),url:url,
      logo:it.logo||it.logo_url||it.image||'',group:it.group||it.category||it.genre||'General',
      _src:srcTag,_col:null,_tab:undefined});
  }
  return out;
}
function parseHtmlChannels(html,srcTag,group){
  var tmp=document.createElement('div');tmp.innerHTML=html;
  var out=[],anchors=tmp.querySelectorAll('a[href]');
  for(var i=0;i<anchors.length;i++){
    var a=anchors[i],href=a.getAttribute('href')||'';
    if(href.indexOf('dtv=')<0||href.indexOf('http')<0)continue;
    var imgEl=a.querySelector('img'),logo=imgEl?imgEl.getAttribute('src'):'';
    var name='',h=a.querySelector('h3,h2,h1,strong,span');
    if(h)name=h.textContent.trim();
    if(!name&&imgEl)name=imgEl.getAttribute('alt')||'';
    if(!name)name=a.textContent.trim().replace(/\s+/g,' ').slice(0,60);
    name=name.replace(/\s*(PROMO|Premium|HD|SD|Free|Paid|Live)$/i,'').trim()||'Channel';
    out.push({name:name,url:href,logo:logo||'',group:group||'Sports',_src:srcTag,_col:null,_tab:undefined});
  }
  return out;
}
function parseM3UChunked(txt,onDone){
  var lines=txt.split(/\r?\n/),out=[],cur=null,i=0;
  function chunk(){
    var end=Math.min(i+800,lines.length);
    for(;i<end;i++){
      var l=lines[i].trim();
      if(l.indexOf('#EXTINF')===0){
        var ci=l.lastIndexOf(','),name=ci>=0?l.slice(ci+1).trim():'Channel';
        name=name.replace(/\s*\([^)]*\)|\s*\[[^\]]*\]/g,'').trim()||'Channel';
        var logoM=l.match(/tvg-logo="([^"]*)"/i),grpM=l.match(/group-title="([^"]*)"/i);
        cur={name:name,_col:null,_tab:undefined,logo:logoM?logoM[1]:'',group:grpM?grpM[1]:'General',url:''};
      }else if(l&&l.charAt(0)!=='#'&&cur){
        if(l.indexOf('http')===0){cur.url=l;out.push(cur);cur=null}
      }
    }
    if(i<lines.length)requestIdleCallback(chunk,{timeout:32});else onDone(out);
  }
  chunk();
}

/* ════════════════════════════════════════════
   CATEGORY
════════════════════════════════════════════ */
function canonicalTab(ch){
  if(ch._tab!==undefined)return ch._tab;
  var t=null,s=ch._src||'';
  if(s==='telugu')t='Telugu';else if(s==='jio')t='Jio';else if(s==='yupp')t='YuppTV';else if(s==='crichd')t='CricHD';
  else{
    var g=(ch.group||'').toLowerCase().trim();
    if(GROUP_MAP[g])t=GROUP_MAP[g];
    else if(g.indexOf('news')>=0)t='News';
    else if(g.indexOf('sport')>=0||g.indexOf('cricket')>=0)t='Sports';
    else if(g.indexOf('entertain')>=0||g.indexOf('movie')>=0||g.indexOf('music')>=0||g.indexOf('kids')>=0)t='Entertainment';
    else if(s&&!['telugu','jio','yupp','crichd'].includes(s))t=s;
  }
  ch._tab=t;return t;
}
function getViewChs(){
  var arr=[],q=searchQ?searchQ.toLowerCase():'';
  for(var i=0;i<allChs.length;i++){
    var ch=allChs[i];
    if(showFavs){if(favs.has(ch.url)&&(!q||ch.name.toLowerCase().indexOf(q)>=0))arr.push(ch);continue}
    var ct=canonicalTab(ch);
    if(ct===activeTab&&(!q||ch.name.toLowerCase().indexOf(q)>=0))arr.push(ch);
  }
  return arr;
}

/* ════════════════════════════════════════════
   PLAYLIST LOADER — 3.5-day cache
════════════════════════════════════════════ */
function loadPl(url,name,force,srcTag){
  if(!srcTag)srcTag='';
  setSt('Loading '+name+'…','buf');
  return new Promise(function(resolve){
    function doFetch(){
      setSt('Fetching '+name+'…','buf');
      var ctrl=new AbortController(),tid=setTimeout(function(){try{ctrl.abort()}catch(ex){}},25000);
      fetch(url,{signal:ctrl.signal}).then(function(resp){
        clearTimeout(tid);if(!resp.ok)throw new Error('HTTP '+resp.status);return resp.text();
      }).then(function(txt){AppCache.setM3U(url,txt);process(txt);
      }).catch(function(e){clearTimeout(tid);setSt('Error: '+name+' — '+String(e.message||e).slice(0,35),'err');resolve([])});
    }
    function process(txt){
      var trimmed=txt.trim();
      var isHtml=(trimmed.charAt(0)==='<');
      var isJson=(!isHtml&&(trimmed.charAt(0)==='['||trimmed.charAt(0)==='{'));
      if(isHtml){
        var grp=(srcTag==='crichd')?'Sports':(srcTag==='yupp')?'Entertainment':'General';
        var parsed=parseHtmlChannels(txt,srcTag||name.toLowerCase(),grp);
        if(!parsed.length){setSt('No channels in '+name,'err');resolve([]);return}
        merge(parsed);resolve(parsed);
      }else if(isJson){
        try{var p2=parseJsonChannels(txt,srcTag||name.toLowerCase())}catch(je){setSt('JSON error '+name,'err');resolve([]);return}
        merge(p2);resolve(p2);
      }else{
        parseM3UChunked(txt,function(p3){
          if(!p3.length){setSt('No channels in '+name,'err');resolve([]);return}
          for(var i=0;i<p3.length;i++)p3[i]._src=srcTag||p3[i]._src||name.toLowerCase();
          merge(p3);resolve(p3);
        });
      }
    }
    function merge(parsed){
      var seen=new Set(allChs.map(function(c){return c.url}));
      var fresh=parsed.filter(function(c){return!seen.has(c.url)});
      allChs=allChs.concat(fresh);
      rebuildNavTabs();viewChs=getViewChs();renderAll();
      setSt(allChs.length+' channels','ok');
      saveChCache();
      var logos=[];for(var k=0;k<Math.min(VPORT*2,parsed.length);k++){if(parsed[k].logo)logos.push(parsed[k].logo)}
      AppCache.preloadImages(logos,[]);
    }
    if(!force){AppCache.getM3U(url).then(function(cached){if(cached)process(cached);else doFetch()}).catch(doFetch);}
    else doFetch();
  });
}

/* ════════════════════════════════════════════
   NAV TABS — centred via CSS flex on #navTabs
════════════════════════════════════════════ */
function rebuildNavTabs(){
  var builtInNames=['Telugu','Jio','YuppTV','CricHD','Favourites'];
  var extraCats=['News','Sports','Entertainment'];
  var customNames=pls.filter(function(p){return!p.builtIn}).map(function(p){return p.name});
  var seen=new Set(),order=['Telugu','Jio','YuppTV','CricHD'];
  allChs.forEach(function(ch){
    var t=canonicalTab(ch);
    if(t&&!builtInNames.includes(t)&&!extraCats.includes(t)&&!order.includes(t))order.push(t);
  });
  extraCats.forEach(function(c){if(!order.includes(c)&&allChs.some(function(ch){return canonicalTab(ch)===c}))order.push(c)});
  order.push('Favourites');
  customNames.forEach(function(n){if(!order.includes(n))order.push(n)});
  var tabs=[];order.forEach(function(t){if(!seen.has(t)){seen.add(t);tabs.push(t)}});
  var tabCounts={};
  allChs.forEach(function(ch){var t=canonicalTab(ch);if(t)tabCounts[t]=(tabCounts[t]||0)+1});
  tabCounts['Favourites']=favs.size;

  navTabs.innerHTML='';
  var frag=document.createDocumentFragment();
  tabs.forEach(function(t){
    var btn=document.createElement('button');
    btn.className='ntab'+(t===activeTab?' on':'');
    btn.dataset.g=t;btn.tabIndex=0;btn.textContent=t;
    var cnt=tabCounts[t]||0;
    if(cnt>0){var sp=document.createElement('span');sp.className='tab-count';sp.textContent=String(cnt);btn.appendChild(sp)}
    btn.addEventListener('click',function(){
      if(t==='Favourites'){showFavs=true;activeTab='Favourites'}else{showFavs=false;activeTab=t}
      viewChs=getViewChs();col=0;renderFrom=0;renderAll();rebuildNavTabs();
    });
    frag.appendChild(btn);
  });
  navTabs.appendChild(frag);
}
function setTab(t){
  showFavs=(t==='Favourites');activeTab=t;
  viewChs=getViewChs();col=0;renderFrom=0;renderAll();rebuildNavTabs();
}

/* ════════════════════════════════════════════
   VIRTUAL STRIP — diff-patch, no innerHTML wipe
   Only rebuilds DOM when window shifts.
   On same window, only class toggles (no layout).
════════════════════════════════════════════ */
var _stripNodes=[];
var _stripFrom=-99;

function renderAll(){
  rowLabel.textContent=showFavs?'Favourites':activeTab;
  rowCount.textContent=viewChs.length;
  var strip=$('strip');if(!strip)return;
  var newFrom=Math.max(0,Math.min(viewChs.length-VPORT,col>0?col-3:0));
  var localIdx=col-1-newFrom;
  var off=Math.max(0,(localIdx-2)*(CW+CGAP));
  if(newFrom!==_stripFrom||_stripNodes.length!==Math.min(VPORT,viewChs.length-newFrom)){
    _stripFrom=renderFrom=newFrom;
    _rebuildStrip(strip);
  }else{
    _syncStripClasses();
  }
  strip.style.transform='translateX(-'+off+'px) translateZ(0)';
  _focusCard();
}
function _rebuildStrip(strip){
  strip.innerHTML='';_stripNodes=[];
  var frag=document.createDocumentFragment();
  for(var i=_stripFrom;i<Math.min(_stripFrom+VPORT,viewChs.length);i++){
    var node=_makeCard(i);frag.appendChild(node);_stripNodes.push({i:i,node:node});
  }
  strip.appendChild(frag);
}
function _syncStripClasses(){
  for(var k=0;k<_stripNodes.length;k++){
    var e=_stripNodes[k],n=e.node,i=e.i,isSel=(i===col-1);
    n.classList.toggle('sel',isSel);
    n.classList.toggle('playing',!!(viewChs[i]&&curUrl===viewChs[i].url));
    n.tabIndex=isSel?0:-1;
  }
}
function _focusCard(){
  requestAnimationFrame(function(){
    for(var k=0;k<_stripNodes.length;k++){
      if(_stripNodes[k].i===col-1){_stripNodes[k].node.focus({preventScroll:true});break}
    }
  });
}
function _makeCard(idx){
  var ch=viewChs[idx];
  var div=document.createElement('div');
  div.className='card'+(curUrl&&curUrl===ch.url?' playing':'')+(idx===col-1?' sel':'');
  div.tabIndex=idx===col-1?0:-1;div.dataset.i=idx;
  var inner=document.createElement('div');inner.className='card-inner';
  var bg=document.createElement('div');bg.className='card-bg';
  var num=document.createElement('div');num.className='card-num';num.textContent=idx+1;
  var badges=document.createElement('div');badges.className='card-badges';
  if(ch.name.match(/HD|4K/i)){var bHD=document.createElement('span');bHD.className='badge b-hd';bHD.textContent='HD';badges.appendChild(bHD)}
  var fav=document.createElement('div');fav.className='card-fav';fav.textContent='★';if(favs.has(ch.url))fav.style.display='block';
  var grad=document.createElement('div');grad.className='card-grad';
  var nm=document.createElement('div');nm.className='card-name';nm.textContent=ch.name;grad.appendChild(nm);
  if(ch.logo){
    var img=new Image();img.className='card-img';img.alt=ch.name;img.crossOrigin='anonymous';img.loading='lazy';
    img.onload=function(){bg.style.backgroundImage='url('+this.src+')';bg.classList.add('on');
      if(!ch._col)extractColour(img,function(c){if(c){ch._col=c;inner.style.background=c}})};
    img.onerror=function(){if(!inner.querySelector('.card-fb')){var fb=document.createElement('div');fb.className='card-fb';fb.textContent='📺';inner.insertBefore(fb,inner.firstChild)}};
    img.src=ch.logo;inner.appendChild(img);
  }else{
    var fb2=document.createElement('div');fb2.className='card-fb';fb2.textContent='📺';inner.appendChild(fb2);
  }
  if(ch._col)inner.style.background=ch._col;
  inner.appendChild(bg);inner.appendChild(grad);
  div.appendChild(num);div.appendChild(badges);div.appendChild(fav);div.appendChild(inner);
  div.addEventListener('click',function(){col=idx+1;renderAll();immediatePlay()});
  return div;
}
function getFocusedCh(){return col>0&&viewChs[col-1]?viewChs[col-1]:null}

/* ════════════════════════════════════════════
   NOW INFO + EPG
════════════════════════════════════════════ */
function updateNowInfo(ch){
  nowName.textContent=ch.name;
  var g=canonicalTab(ch)||ch.group||'';
  if(g){nowGroup.textContent=g;nowGroup.style.display=''}else nowGroup.style.display='none';
  nowInfo.classList.add('vis');lsSet(LS.LCHU,ch.url);
}
function showEngine(eng){
  var label={'avplay':'AVPlay','shaka':'Shaka','hlsjs':'HLS.js','native':'Direct','none':'—'}[eng]||eng.toUpperCase();
  nowEngine.textContent=label;nowEngine.style.display='';
  engBadge.textContent=label;engBadge.classList.add('show');
  clearTimeout(engBadgeTimer);engBadgeTimer=setTimeout(function(){engBadge.classList.remove('show')},2800);
}
function fetchEPGForChannel(name){
  if(typeof SagaEPG==='undefined'){epgRow.style.display='none';return}
  SagaEPG.getCurrent(name,function(prog){
    if(prog){epgTime.textContent=new Date(prog.start).toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});epgProg.textContent=prog.title;epgRow.style.display=''}
    else epgRow.style.display='none';
  });
}
function scheduleOsdHide(){
  clearTimeout(osdTimer);nowInfo.classList.add('vis');
  if(!cfg.osd)return;
  osdTimer=setTimeout(function(){if(isPlaying)nowInfo.classList.remove('vis')},5500);
}
function resetOsd(){
  if(isPlaying){nowInfo.classList.add('vis');if(cfg.osd){clearTimeout(osdTimer);osdTimer=setTimeout(function(){if(isPlaying)nowInfo.classList.remove('vis')},5500)}}
}

/* ════════════════════════════════════════════
   ASPECT
════════════════════════════════════════════ */
function cycleAspect(){
  aspectMode=(aspectMode+1)%ASPECTS.length;
  if(aspectMode===0)video.style.objectFit='contain';
  else if(aspectMode===1)video.style.objectFit='fill';
  else video.style.objectFit='cover';
  setSt('Aspect: '+ASPECTS[aspectMode],'');
  try{if(avplay&&ENGINE==='avplay'){avplay.setDisplayMethod(aspectMode===0?'PLAYER_DISPLAY_MODE_LETTER_BOX':aspectMode===2?'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO':'PLAYER_DISPLAY_MODE_FULL_SCREEN')}}catch(e){}
}
function toggleFav(){
  var ch=getFocusedCh();if(!ch)return;
  if(favs.has(ch.url)){favs.delete(ch.url);setSt('Removed from favourites','')}else{favs.add(ch.url);setSt('Added to favourites','ok')}
  saveFavs();rebuildNavTabs();_syncStripClasses();
}

/* ════════════════════════════════════════════
   ╔═══════════════════════════════════════╗
   ║   AVPLAY ENGINE — prepareAsync        ║
   ║   NON-BLOCKING: UI never freezes      ║
   ║   Aggressive ABR: SET_MODE=MAX        ║
   ╚═══════════════════════════════════════╝
════════════════════════════════════════════ */
function initAVPlay(){
  try{if(window.webapis&&webapis.avplay){avplay=webapis.avplay;avReady=true;setSt('AVPlay ready','ok');return true}}catch(e){}
  avReady=false;return false;
}
function avplayStop(){
  _avplayRetried=false;if(!avplay)return;
  try{var st=avplay.getState();if(st==='PLAYING'||st==='PAUSED'||st==='READY')avplay.stop();avplay.close()}catch(e){}
  avCont.style.display='none';video.style.display='';
}
var _avplayRetried=false;

function playWithAVPlay(ch){
  var url=ch.url;_avplayRetried=false;
  avplayStop();
  try{
    video.style.display='none';avCont.style.display='block';
    avplay.open(url);

    /* setDisplayRect MUST be after open(), before prepareAsync */
    avplay.setDisplayRect(0,0,1920,1080);
    avplay.setDisplayMethod(
      aspectMode===0?'PLAYER_DISPLAY_MODE_LETTER_BOX':
      aspectMode===2?'PLAYER_DISPLAY_MODE_AUTO_ASPECT_RATIO':
      'PLAYER_DISPLAY_MODE_FULL_SCREEN'
    );

    /* ── Aggressive streaming properties ──
       PREBUFFER_MODE=FALSE: start playing as soon as minimal data is ready
       ADAPTIVE_INFO SET_MODE=MAX: always try highest bitrate immediately
       INITIAL_BUFFERING_TIME: only buffer 2s before starting
       REBUFFERING_TIME: only needs 1s to recover from stall              */
    try{avplay.setStreamingProperty('PREBUFFER_MODE','FALSE')}catch(e){}
    try{avplay.setStreamingProperty('ADAPTIVE_INFO','BITRATE_LIMIT=0|START_BITRATE=0|SET_MODE=MAX')}catch(e){}
    try{avplay.setStreamingProperty('INITIAL_BUFFERING_TIME','2000')}catch(e){}
    try{avplay.setStreamingProperty('REBUFFERING_TIME','1000')}catch(e){}

    if(url.indexOf('sanwalyaarpya')>=0||url.indexOf('calm-sun')>=0||url.indexOf('crichd')>=0){
      try{avplay.setStreamingProperty('CUSTOM_MESSAGE','Referer:https://profamouslife.com/')}catch(e){}
      try{avplay.setStreamingProperty('USERAGENT','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')}catch(e){}
    }

    /* Listener BEFORE prepareAsync — required by Samsung docs */
    avplay.setListener({
      onbufferingstart:function(){setSt('Buffering…','buf');bufSpinner.classList.add('on')},
      onbufferingprogress:function(pct){if(pct>0&&pct<100)setSt('Buffering '+pct+'%','buf')},
      onbufferingcomplete:function(){
        setSt('Streaming · '+ch.name+' [AVPlay]','ok');
        setPlaying(true);bufSpinner.classList.remove('on');
        showEngine('avplay');_syncStripClasses();scheduleOsdHide();
      },
      onerror:function(errCode){bufSpinner.classList.remove('on');setSt('AVPlay error '+errCode,'buf');setPlaying(false);_avplayHandleError(ch,errCode)},
      onstreamcompleted:function(){setSt('Stream ended','');setPlaying(false);bufSpinner.classList.remove('on')},
      oncurrentplaytime:function(ms){
        if(isPlaying&&ENGINE==='avplay'&&ms%3000<500){
          try{var info=avplay.getCurrentStreamInfo();if(info){for(var si=0;si<info.length;si++){if(info[si].property==='bandwidth'){var bw=parseInt(info[si].value)||0;if(bw>0)sBw.textContent=(bw/1000000).toFixed(1)+'M';break}}}}catch(e){}
        }
      }
    });

    ENGINE='avplay';
    setSt('Connecting [AVPlay]…','buf');bufSpinner.classList.add('on');
    updateNowInfo(ch);

    /* ══ KEY FIX: prepareAsync — non-blocking, UI stays responsive ══
       Samsung official API: AVPlay.prepareAsync(successCallback, errorCallback)
       The success callback fires on a worker thread when buffering is ready.
       DO NOT use prepare() — it blocks the main thread causing the freeze/lag. */
    avplay.prepareAsync(
      function(){/* success — called when buffer is ready */
        try{avplay.play()}catch(e2){avplayStop();playWithShaka(ch,false)}
      },
      function(err){/* error during prepare */
        setSt('AVPlay prepareAsync failed: '+String(err).slice(0,35),'buf');
        bufSpinner.classList.remove('on');setPlaying(false);avplayStop();playWithShaka(ch,false);
      }
    );

  }catch(ex){
    setSt('AVPlay failed: '+String(ex.message||ex).slice(0,40),'buf');
    avplayStop();playWithShaka(ch,false);
  }
}

function _avplayHandleError(ch,errCode){
  if(_avplayRetried){_avplayRetried=false;avplayStop();setSt('AVPlay error '+errCode+' — trying Shaka…','buf');playWithShaka(ch,false);return}
  _avplayRetried=true;setSt('Retrying [AVPlay + desktop UA]…','buf');avplayStop();
  try{
    video.style.display='none';avCont.style.display='block';
    avplay.open(ch.url);avplay.setDisplayRect(0,0,1920,1080);avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_FULL_SCREEN');
    try{avplay.setStreamingProperty('PREBUFFER_MODE','FALSE')}catch(e){}
    try{avplay.setStreamingProperty('ADAPTIVE_INFO','BITRATE_LIMIT=0|START_BITRATE=0|SET_MODE=MAX')}catch(e){}
    try{avplay.setStreamingProperty('USERAGENT','Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36')}catch(e){}
    if(ch.url.indexOf('sanwalyaarpya')>=0||ch.url.indexOf('calm-sun')>=0){try{avplay.setStreamingProperty('CUSTOM_MESSAGE','Referer:https://profamouslife.com/')}catch(e){}}
    avplay.setListener({
      onbufferingstart:function(){setSt('Buffering (retry)…','buf');bufSpinner.classList.add('on')},
      onbufferingprogress:function(){},
      onbufferingcomplete:function(){setSt('Streaming · '+ch.name+' [AVPlay]','ok');setPlaying(true);bufSpinner.classList.remove('on');showEngine('avplay');_syncStripClasses();scheduleOsdHide();_avplayRetried=false},
      onerror:function(ec){bufSpinner.classList.remove('on');_avplayRetried=true;_avplayHandleError(ch,ec)},
      onstreamcompleted:function(){setSt('Stream ended','');setPlaying(false);bufSpinner.classList.remove('on')},
      oncurrentplaytime:function(){}
    });
    avplay.prepareAsync(
      function(){try{avplay.play()}catch(e2){avplayStop();playWithShaka(ch,false)}},
      function(){_avplayRetried=false;avplayStop();setSt('AVPlay retry failed — Shaka…','buf');playWithShaka(ch,false)}
    );
    ENGINE='avplay';bufSpinner.classList.add('on');
  }catch(ex){_avplayRetried=false;avplayStop();setSt('AVPlay retry failed','buf');playWithShaka(ch,false)}
}

/* ════════════════════════════════════════════
   SHAKA ENGINE — aggressive ABR
════════════════════════════════════════════ */
function initShaka(){
  return new Promise(function(resolve){
    try{shaka.polyfill.installAll()}catch(ex){}
    if(typeof shaka==='undefined'||!shaka.Player.isBrowserSupported()){setSt('Shaka not supported','err');resolve(false);return}
    shakaPlayer=new shaka.Player(video);

    shakaPlayer.getNetworkingEngine().registerRequestFilter(function(type,req){
      var u=req.uris&&req.uris[0]?req.uris[0]:'';
      if(u.indexOf('crichd')>=0||u.indexOf('sanwalyaarpya')>=0||u.indexOf('calm-sun')>=0||
         u.indexOf('rojoni')>=0||u.indexOf('abusaeeidx')>=0||u.indexOf('streamglobal')>=0){
        req.headers['Referer']='https://crichd.vip/';req.headers['Origin']='https://crichd.vip';
        req.headers['User-Agent']='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
      }
      if(u.indexOf('yuppparoriglin.akamaized.net')>=0||u.indexOf('yuppcdn.net')>=0||u.indexOf('yupptv')>=0){
        req.headers['Referer']='https://www.yupptv.com/';req.headers['Origin']='https://www.yupptv.com';
      }
    });

    shakaPlayer.configure({
      abr:{
        enabled:true,
        defaultBandwidthEstimate:10000000,  /* assume 10 Mbps → start at HD */
        switchInterval:3,                    /* re-evaluate every 3s */
        bandwidthUpgradeTarget:0.70,         /* upgrade when using 70% of capacity → fast climb */
        bandwidthDowngradeTarget:0.95,       /* downgrade only at 95% → very reluctant to drop */
        restrictToElementCapabilities:true
      },
      streaming:{
        bufferingGoal:cfg.buf,
        rebufferingGoal:1,
        stallEnabled:true,stallThreshold:0.4,stallSkip:0.25,
        jumpLargeGaps:true,
        retryParameters:{maxAttempts:3,baseDelay:250,backoffFactor:1.4,fuzzFactor:0.2,timeout:18000},
        safeSeekOffset:1,lowLatencyMode:false,inaccurateManifestTolerance:10
      },
      preferredVideoCodecs:['vp09','vp9','avc1','hvc1','hev1'],
      preferredDecodingAttributes:['smooth','powerEfficient'],
    });

    shakaPlayer.addEventListener('adaptation',updateQ);
    shakaPlayer.addEventListener('variantchanged',updateQ);
    shakaPlayer.addEventListener('buffering',function(e){
      if(e.buffering){setSt('Buffering…','buf');bufSpinner.classList.add('on')}
      else{bufSpinner.classList.remove('on');var ch=getFocusedCh();if(ch)setSt('Streaming · '+ch.name,'ok')}
    });
    shakaPlayer.addEventListener('error',function(e){
      var msg=(e.detail&&e.detail.message)||'Stream error';
      setSt(msg.slice(0,55),'err');setPlaying(false);bufSpinner.classList.remove('on');
    });
    video.addEventListener('playing',function(){
      setPlaying(true);bufSpinner.classList.remove('on');
      var ch=getFocusedCh();if(ch)setSt('Streaming · '+ch.name+' [Shaka]','ok');
      showEngine('shaka');_syncStripClasses();
      if(cfg.hq)setTimeout(lockHQ,3000);updateQ();scheduleOsdHide();
    });
    video.addEventListener('error',function(){setSt('Video error','err');setPlaying(false);bufSpinner.classList.remove('on')});
    setSt('Shaka ready','');resolve(true);
  });
}
function playWithShaka(ch,tryAVFirst){
  if(tryAVFirst===undefined)tryAVFirst=true;
  if(tryAVFirst&&avReady&&cfg.engine!=='shaka'){playWithAVPlay(ch);return}
  avplayStop();video.style.display='';ENGINE='shaka';
  if(!shakaPlayer){setSt('Shaka not initialised','err');return}
  updateNowInfo(ch);setSt('Connecting [Shaka]…','buf');bufSpinner.classList.add('on');
  var loadUrl=ch.url;
  if(ch._src==='yupp'&&ch.url.indexOf('dtv=')>=0){var m=ch.url.match(/[?&]dtv=([^&\s]+)/);if(m){try{loadUrl=decodeURIComponent(m[1])}catch(e){loadUrl=m[1]}}}
  shakaPlayer.load(loadUrl).then(function(){return video.play()}).then(function(){
    setPlaying(true);bufSpinner.classList.remove('on');
    setSt('Streaming · '+ch.name+' [Shaka]','ok');showEngine('shaka');
    if(cfg.hq)setTimeout(lockHQ,3000);updateQ();_syncStripClasses();
    fetchEPGForChannel(ch.name);scheduleOsdHide();
    if(cfg.muteSwitch)setTimeout(function(){video.muted=isMuted},600);
  }).catch(function(err){
    setSt('Shaka failed: '+String(err.message||err).slice(0,40),'err');
    setPlaying(false);bufSpinner.classList.remove('on');tryHlsPlay(ch);
  });
}
function updateQ(){
  if(!shakaPlayer)return;
  try{var tracks=shakaPlayer.getVariantTracks(),a=null;for(var i=0;i<tracks.length;i++){if(tracks[i].active){a=tracks[i];break}}if(a){nowQ.textContent=(a.height?a.height+'p':'Auto')+' · '+(a.bandwidth/1000000).toFixed(1)+'M';nowQ.style.display=''}}catch(e){}
}
function lockHQ(){
  if(!shakaPlayer||!isPlaying)return;
  try{var t=shakaPlayer.getVariantTracks();if(!t.length)return;var best=t[0];for(var i=1;i<t.length;i++){if(t[i].bandwidth>best.bandwidth)best=t[i]}shakaPlayer.selectVariantTrack(best,false)}catch(e){}
}
function recfg(){if(!shakaPlayer)return;shakaPlayer.configure({abr:{enabled:!cfg.hq},streaming:{bufferingGoal:cfg.buf}})}

/* ════════════════════════════════════════════
   HLS.JS + DIRECT FALLBACKS
════════════════════════════════════════════ */
function tryHlsPlay(ch){
  setSt('Trying HLS.js…','buf');bufSpinner.classList.add('on');
  function doPlay(){
    if(typeof Hls==='undefined'||!Hls.isSupported()){tryDirectPlay(ch);return}
    if(window._hlsInstance){try{window._hlsInstance.destroy()}catch(e){}}
    var h=new Hls({maxBufferLength:cfg.buf,maxMaxBufferLength:cfg.buf*2,enableWorker:false,
      xhrSetup:function(xhr,url){
        if(url.indexOf('sanwalyaarpya')>=0||url.indexOf('calm-sun')>=0)xhr.setRequestHeader('Referer','https://profamouslife.com/');
        if(url.indexOf('yuppparoriglin')>=0||url.indexOf('yuppcdn')>=0)xhr.setRequestHeader('Referer','https://www.yupptv.com/');
      }});
    window._hlsInstance=h;video.style.display='';h.loadSource(ch.url);h.attachMedia(video);
    h.on(Hls.Events.MANIFEST_PARSED,function(){
      video.play().then(function(){setPlaying(true);ENGINE='hlsjs';setSt('Streaming · '+ch.name+' [HLS.js]','ok');bufSpinner.classList.remove('on');showEngine('hlsjs');_syncStripClasses();scheduleOsdHide()
      }).catch(function(){setSt('HLS.js play failed','err');bufSpinner.classList.remove('on');tryDirectPlay(ch)});
    });
    h.on(Hls.Events.ERROR,function(ev,data){if(data.fatal){bufSpinner.classList.remove('on');setSt('HLS.js error','err');h.destroy();tryDirectPlay(ch)}});
  }
  if(typeof loadHlsJs==='function')loadHlsJs().then(function(H){if(H)doPlay();else tryDirectPlay(ch)});else doPlay();
}
function tryDirectPlay(ch){
  setSt('Direct play…','buf');
  try{video.style.display='';avplayStop();video.src=ch.url;video.load();
    video.play().then(function(){setPlaying(true);ENGINE='native';setSt('Streaming · '+ch.name+' [Direct]','ok');showEngine('native');_syncStripClasses()
    }).catch(function(){setSt('All engines failed: '+ch.name,'err')});
  }catch(e){setSt('All engines failed','err')}
}

/* ════════════════════════════════════════════
   PLAY DEBOUNCE
════════════════════════════════════════════ */
function immediatePlay(){clearTimeout(playTimer);playTimer=setTimeout(_doPlay,PLAY_DEB)}
function _doPlay(){
  var ch=getFocusedCh();if(!ch||!ch.url)return;
  if(ch.url===curUrl&&isPlaying)return;
  curUrl=ch.url;if(cfg.muteSwitch&&isPlaying)video.muted=true;
  setPlaying(false);nowQ.style.display='none';updateNowInfo(ch);
  if(cfg.engine==='shaka'){playWithShaka(ch,false);return}
  if(cfg.engine==='avplay'&&avReady){playWithAVPlay(ch);return}
  if(ch._src==='crichd'){playWithShaka(ch,false);return}
  if(avReady)playWithAVPlay(ch);else playWithShaka(ch,false);
}

/* ════════════════════════════════════════════
   SEARCH
════════════════════════════════════════════ */
var searchOpen=false;
function openSearch(){$('searchOv').classList.add('open');searchOpen=true;zone='search';wakeUI();clearTimeout(hideTimer);var inp=$('searchInp');if(inp){inp.value=searchQ||'';inp.focus();_updateSC()}}
function closeSearch(){$('searchOv').classList.remove('open');searchOpen=false;zone='rows';resetHideTimer();syncFocus()}
function _updateSC(){var sc=$('searchCount');if(sc)sc.textContent=viewChs.length+' results'}
$('searchBtn').addEventListener('click',openSearch);
(function(){
  var si=$('searchInp'),_st=null;
  si.addEventListener('input',function(){clearTimeout(_st);_st=setTimeout(function(){searchQ=si.value.trim();viewChs=getViewChs();col=Math.min(col,viewChs.length);renderAll();_updateSC()},280)});
  si.addEventListener('keydown',function(e){
    if(e.keyCode===27||e.keyCode===10009){e.preventDefault();if(si.value){si.value='';searchQ='';viewChs=getViewChs();renderAll();_updateSC()}else closeSearch();return}
    if(e.keyCode===13){e.preventDefault();closeSearch();if(viewChs.length>0){col=1;renderAll();immediatePlay()}}
  });
  $('searchClose').addEventListener('click',function(){searchQ='';si.value='';viewChs=getViewChs();renderAll();closeSearch()});
})();

/* ════════════════════════════════════════════
   EXIT
════════════════════════════════════════════ */
var exitFocusYes=true;
function openExit(){$('exitOv').classList.add('on');zone='exit';exitFocusYes=true;_ueF();wakeUI();clearTimeout(hideTimer)}
function closeExit(){$('exitOv').classList.remove('on');zone='rows';resetHideTimer();syncFocus()}
function _ueF(){var y=$('exitYes'),n=$('exitNo');if(y)y.classList.toggle('focused',exitFocusYes);if(n)n.classList.toggle('focused',!exitFocusYes);if(exitFocusYes&&y)y.focus({preventScroll:true});else if(n)n.focus({preventScroll:true})}
function doExit(){try{if(window.tizen&&tizen.application)tizen.application.getCurrentApplication().exit()}catch(e){}try{window.close()}catch(e){}}
$('exitYes').addEventListener('click',doExit);$('exitNo').addEventListener('click',closeExit);

/* ════════════════════════════════════════════
   QUICK ACTIONS
════════════════════════════════════════════ */
function openYP(){yellowPopup.classList.add('on');zone='yp';ypIdx=0;wakeUI();clearTimeout(hideTimer);setTimeout(function(){var it=QA('.yp-act',$('ypActs'));if(it[0])it[0].focus({preventScroll:true})},25)}
function closeYP(){yellowPopup.classList.remove('on');ypForm.classList.remove('on');zone='rows';resetHideTimer();syncFocus()}
$('ypClose').addEventListener('click',closeYP);
$('ypa-refresh').addEventListener('click',function(){AppCache.clearAllM3U();allChs=[];lsSet(PL_REFRESH_KEY,String(Date.now()));setSt('Force refreshing…','buf');loadAll(true);closeYP()});
$('ypa-dialer').addEventListener('click',function(){closeYP();openDial()});
$('ypa-settings').addEventListener('click',function(){closeYP();openSettings()});
$('ypa-favs').addEventListener('click',function(){closeYP();setTab('Favourites')});
$('ypa-add').addEventListener('click',function(){ypForm.classList.toggle('on');if(ypForm.classList.contains('on'))setTimeout(function(){$('ypName').focus()},40)});
$('ypSave').addEventListener('click',function(){
  var n=($('ypName').value||'').trim(),u=($('ypUrl').value||'').trim();
  if(!n||!u){setSt('Enter name and URL','err');return}
  if(pls.some(function(p){return p.url===u})){setSt('Already added','err');return}
  var pl={name:n,url:u,builtIn:false,_src:n.toLowerCase()};pls.push(pl);savePls();
  loadPl(u,n,false,n.toLowerCase()).then(function(){rebuildNavTabs();setSt('Loaded: '+n,'ok')});
  $('ypName').value='';$('ypUrl').value='';ypForm.classList.remove('on');closeYP();
});
$('ypCancel').addEventListener('click',function(){ypForm.classList.remove('on')});

/* ════════════════════════════════════════════
   SETTINGS
════════════════════════════════════════════ */
function openSettings(){settingsOv.classList.add('on');zone='settings';soSideIdx=0;soMainIdx=0;soSideZone=true;$('settingsBtn').classList.add('active');renderSettingsSect('playback');wakeUI();clearTimeout(hideTimer);setTimeout(function(){var it=QA('.so-nav',soSide);if(it[0])it[0].focus({preventScroll:true})},40)}
function closeSettings(){settingsOv.classList.remove('on');zone='rows';$('settingsBtn').classList.remove('active');resetHideTimer();syncFocus()}
$('soClose').addEventListener('click',closeSettings);$('settingsBtn').addEventListener('click',openSettings);
QA('.so-nav',soSide).forEach(function(n){n.addEventListener('click',function(){QA('.so-nav',soSide).forEach(function(x){x.classList.remove('on')});n.classList.add('on');renderSettingsSect(n.dataset.s);soSideZone=false;soMainIdx=0;setTimeout(function(){var it=QA('[tabindex="0"]',soMain);if(it[0])it[0].focus({preventScroll:true})},25)})});

function renderSettingsSect(s){
  var nav=soSide.querySelector('.so-nav[data-s="'+s+'"]');
  if(nav){QA('.so-nav',soSide).forEach(function(x){x.classList.remove('on')});nav.classList.add('on')}
  if(s==='playback'){
    var engines=[{val:'auto',label:'Auto',desc:'AVPlay first (prepareAsync), Shaka fallback'},{val:'avplay',label:'AVPlay',desc:'Samsung native — non-blocking, best performance'},{val:'shaka',label:'Shaka',desc:'Web player — best for CricHD header injection'}];
    var bufOpts=[{val:6,label:'6 s',desc:'Ultra Low Latency'},{val:8,label:'8 s',desc:'Low Latency'},{val:10,label:'10 s',desc:'Balanced (default)'},{val:18,label:'18 s',desc:'Stable / slow connection'}];
    var html='<div style="font-size:17px;font-weight:700;color:var(--w0);margin-bottom:11px">Player Engine</div>';
    engines.forEach(function(e){var active=cfg.engine===e.val;html+='<div class="opt-row'+(active?' opt-row-on':'')+'" tabindex="0" data-engine="'+e.val+'"><div class="opt-check">'+(active?'●':'○')+'</div><div class="opt-info"><div class="opt-label">'+e.label+'</div><div class="opt-desc">'+e.desc+'</div></div></div>'});
    html+='<div style="height:22px"></div><div style="font-size:17px;font-weight:700;color:var(--w0);margin-bottom:11px">Buffer Size (Shaka)</div>';
    bufOpts.forEach(function(b){var active=cfg.buf==b.val;html+='<div class="opt-row'+(active?' opt-row-on':'')+'" tabindex="0" data-buf="'+b.val+'"><div class="opt-check">'+(active?'●':'○')+'</div><div class="opt-info"><div class="opt-label">'+b.label+'</div><div class="opt-desc">'+b.desc+'</div></div></div>'});
    html+='<div style="height:22px"></div>'+
      '<div class="srow" tabindex="0"><div class="srow-l"><div class="srow-t">Force Highest Quality</div><div class="srow-d">Lock max bitrate — prevents quality drops</div></div><label class="tog"><input type="checkbox" id="cfgHQ"'+(cfg.hq?' checked':'')+'><span class="tog-t"></span></label></div>'+
      '<div class="srow" tabindex="0"><div class="srow-l"><div class="srow-t">Mute on Channel Switch</div><div class="srow-d">Silence during zap, restores after 600ms</div></div><label class="tog"><input type="checkbox" id="cfgMute"'+(cfg.muteSwitch?' checked':'')+'><span class="tog-t"></span></label></div>';
    soMain.innerHTML=html;
    QA('[data-engine]',soMain).forEach(function(el){el.addEventListener('click',function(){cfg.engine=el.dataset.engine;saveCfg();renderSettingsSect('playback')})});
    QA('[data-buf]',soMain).forEach(function(el){el.addEventListener('click',function(){cfg.buf=parseInt(el.dataset.buf);saveCfg();recfg();renderSettingsSect('playback')})});
    wireSettings();
  }else if(s==='display'){
    soMain.innerHTML='<div class="srow" tabindex="0"><div class="srow-l"><div class="srow-t">OSD Auto-hide</div><div class="srow-d">Channel info fades after 5.5s during playback</div></div><label class="tog"><input type="checkbox" id="cfgOsd"'+(cfg.osd?' checked':'')+'><span class="tog-t"></span></label></div><div style="margin-top:18px;font-size:17px;font-weight:700;color:var(--w0);margin-bottom:7px">Aspect Ratio</div><button class="so-btn" id="soAspect" tabindex="0">⬜ Cycle: '+ASPECTS[aspectMode]+'</button>';
    wireSettings();var ab=$('soAspect');if(ab)ab.addEventListener('click',function(){cycleAspect();ab.textContent='⬜ Cycle: '+ASPECTS[aspectMode]});
  }else if(s==='sources'){
    var allSrc=BUILTINS.concat(pls.filter(function(p){return!p.builtIn}));
    var html='';
    allSrc.forEach(function(p,i){html+='<div class="src-card" tabindex="0" data-i="'+i+'"><div class="src-dot" style="'+(p.builtIn?'background:rgba(255,255,255,.32)':'')+'"></div><div class="src-i"><div class="src-n">'+esc(p.name)+(p.builtIn?' <small style="opacity:.32;font-size:12px">(built-in)</small>':'')+'</div><div class="src-u">'+esc(p.url)+'</div></div>'+(p.builtIn?'':'<button class="src-del" data-del="'+i+'" title="Remove">✕</button>')+'</div>'});
    soMain.innerHTML=html+'<button class="so-btn" id="soAddSrc" tabindex="0">➕ Add Custom Playlist</button><button class="so-btn" id="soRefresh" tabindex="0">↺ Force Refresh All</button>';
    soMain.querySelectorAll('.src-card').forEach(function(el){el.addEventListener('click',function(e){if(e.target.closest('[data-del]'))return;var src=allSrc[parseInt(el.dataset.i)];if(src){loadPl(src.url,src.name,false,src._src||src.name.toLowerCase()).then(function(){setSt('Loaded: '+src.name,'ok')});closeSettings()}})});
    soMain.querySelectorAll('[data-del]').forEach(function(btn){btn.addEventListener('click',function(e){e.stopPropagation();var customPls=pls.filter(function(p){return!p.builtIn});var idx=parseInt(btn.dataset.del)-BUILTINS.length;if(idx>=0&&idx<customPls.length){var rm=customPls[idx];pls=pls.filter(function(p){return p.builtIn||p.url!==rm.url});savePls();allChs=allChs.filter(function(c){return c._src!==rm.name.toLowerCase()});rebuildNavTabs();if(activeTab===rm.name)setTab('Telugu');renderSettingsSect('sources')}})});
    var rb=$('soRefresh');if(rb)rb.addEventListener('click',function(){AppCache.clearAllM3U();allChs=[];lsSet(PL_REFRESH_KEY,String(Date.now()));setSt('Refreshing…','buf');loadAll(true);closeSettings()});
    var ab2=$('soAddSrc');if(ab2)ab2.addEventListener('click',function(){closeSettings();openYP();setTimeout(function(){var a=$('ypa-add');if(a)a.click()},90)});
  }else if(s==='about'){
    soMain.innerHTML='<div style="padding:6px 0"><div style="font-size:32px;font-weight:900;color:#fff;margin-bottom:5px">TV+</div><div style="font-size:14px;color:rgba(255,255,255,.35);margin-bottom:22px;letter-spacing:.3px">Native Edition v15 · Samsung Tizen OS9 · AVPlay prepareAsync + Shaka</div><div style="font-size:15px;color:rgba(255,255,255,.58);line-height:2.0"><b style="color:rgba(255,255,255,.82)">Remote Keys</b><br>↑↓←→ Navigate · OK Play<br>CH▲▼ Prev / Next channel<br>RED Next tab · GREEN Aspect · YELLOW Quick actions<br>BLUE Search · MENU Settings<br>0–9 Quick channel jump · BACK Close / exit</div><div style="margin-top:26px;font-size:12px;color:rgba(255,255,255,.20)">Built-in: Telugu · Jio · YuppTV · CricHD<br>Engines: AVPlay (prepareAsync) · Shaka · HLS.js · Direct<br>Playlist cache: 3.5 days (refreshes ~twice a week)</div></div>';
  }
}
function wireSettings(){
  var hq=$('cfgHQ'),mu=$('cfgMute'),os=$('cfgOsd');
  if(hq)hq.onchange=function(){cfg.hq=this.checked;saveCfg();recfg()};
  if(mu)mu.onchange=function(){cfg.muteSwitch=this.checked;saveCfg()};
  if(os)os.onchange=function(){cfg.osd=this.checked;saveCfg()};
}

/* ════════════════════════════════════════════
   DIALER
════════════════════════════════════════════ */
function openDial(){mDial.classList.add('on');zone='dialer';dialStr='';dnum.textContent='—';wakeUI();clearTimeout(hideTimer)}
function closeDial(){mDial.classList.remove('on');zone='rows';resetHideTimer();syncFocus()}
QA('.dk',$('mDial')).forEach(function(b){b.addEventListener('click',function(){dialPush(b.dataset.d)})});
function dialPush(d){
  if(d==='clr')dialStr=dialStr.slice(0,-1);else if(d==='go'){dialGo();return}else if(dialStr.length<4)dialStr+=d;
  dnum.textContent=dialStr||'—';clearTimeout(dialTimer);if(dialStr.length>=3)dialTimer=setTimeout(dialGo,1300);
}
function dialGo(){var n=parseInt(dialStr,10);dialStr='';dnum.textContent='—';closeDial();if(!isNaN(n)&&n>=1&&n<=viewChs.length){col=n;renderAll();immediatePlay()}else setSt('Channel '+n+' not found','err')}

var chHudEl=$('chHud'),chHudNum=$('chHudNum'),chHudName=$('chHudName'),chHudTimer=null;
function showChHud(str){clearTimeout(chHudTimer);chHudNum.textContent=str||'—';var n=parseInt(str,10);chHudName.textContent=(n>=1&&n<=viewChs.length&&viewChs[n-1])?viewChs[n-1].name:'';chHudEl.classList.add('on');chHudTimer=setTimeout(function(){chHudEl.classList.remove('on');chHudTimer=null},1100)}
function hideChHud(){clearTimeout(chHudTimer);chHudTimer=null;chHudEl.classList.remove('on')}
function remoteDigit(d){rDialStr+=d;clearTimeout(rDialTimer);showChHud(rDialStr);setSt('CH: '+rDialStr+'…','');rDialTimer=setTimeout(function(){var n=parseInt(rDialStr,10);rDialStr='';hideChHud();if(!isNaN(n)&&n>=1&&n<=viewChs.length){col=n;renderAll();immediatePlay()}else setSt('Channel not found','err')},1300)}

/* ════════════════════════════════════════════
   FOCUS SYNC
════════════════════════════════════════════ */
function syncFocus(){
  requestAnimationFrame(function(){
    if(zone==='tabs'){var tabs=QA('.ntab',navTabs);if(tabs[tabIdx])tabs[tabIdx].focus({preventScroll:true})}
    else _focusCard();
  });
}

/* ════════════════════════════════════════════
   CLOCK + BANDWIDTH
════════════════════════════════════════════ */
function tick(){var t=new Date().toLocaleTimeString('en-IN',{hour:'2-digit',minute:'2-digit',hour12:true});topClock.textContent=t;sClock.textContent=t}
tick();setInterval(tick,9000);
setInterval(function(){if(!isPlaying||ENGINE!=='shaka'||!shakaPlayer)return;try{var bw=shakaPlayer.getStats().estimatedBandwidth||0;if(bw>0)sBw.textContent=(bw/1000000).toFixed(1)+'M'}catch(e){}},2500);
function hideSplash(){$('splash').classList.add('off');setTimeout(function(){$('splash').style.display='none'},500)}

/* ════════════════════════════════════════════
   KEYMAP — Tizen OS9 full remote
════════════════════════════════════════════ */
var KC={UP:38,DN:40,LT:37,RT:39,TUP:48888,TDN:48889,TLT:48886,TRT:48887,ENTER:13,BACK:10009,PLAY:415,PAUSE:19,PP:10252,STOP:413,FF:417,REW:412,RED:403,GREEN:404,YELLOW:405,BLUE:406,CHUP:427,CHDN:428,VOL_UP:447,VOL_DN:448,MUTE:449,MENU:457,INFO:10134,TOOLS:10135,EXTRA:10253,INFO2:10133};
function isUp(kc,k){return kc===KC.UP||kc===KC.TUP||k==='ArrowUp'||k==='Up'}
function isDn(kc,k){return kc===KC.DN||kc===KC.TDN||k==='ArrowDown'||k==='Down'}
function isLt(kc,k){return kc===KC.LT||kc===KC.TLT||k==='ArrowLeft'||k==='Left'}
function isRt(kc,k){return kc===KC.RT||kc===KC.TRT||k==='ArrowRight'||k==='Right'}
function isOK(kc,k){return kc===KC.ENTER||k==='Enter'}
function isBack(kc,k){return kc===KC.BACK||k==='Escape'||k==='BrowserBack'||kc===10009}
function isSettings(kc,k){return kc===KC.MENU||kc===KC.INFO2||kc===KC.TOOLS||kc===KC.EXTRA||k==='Menu'||k==='Info'||k==='Tools'}
function isDig(e){var kc=e.keyCode;return(kc>=48&&kc<=57)||(kc>=96&&kc<=105)||(e.key&&e.key.length===1&&e.key>='0'&&e.key<='9')}
function getDig(e){if(e.key&&e.key.length===1&&e.key>='0'&&e.key<='9')return e.key;if(e.keyCode>=96&&e.keyCode<=105)return String(e.keyCode-96);return String(e.keyCode-48)}

window.addEventListener('keydown',function(e){
  var kc=e.keyCode,k=e.key;
  if(kc===KC.VOL_UP||k==='VolumeUp'){e.preventDefault();volUp();wakeUI();return}
  if(kc===KC.VOL_DN||k==='VolumeDown'){e.preventDefault();volDown();wakeUI();return}
  if(kc===KC.MUTE||k==='VolumeMute'){e.preventDefault();wakeUI();try{if(window.tizen&&tizen.tvaudiocontrol){tizen.tvaudiocontrol.setMute(!tizen.tvaudiocontrol.isMute());showVol();return}}catch(ex){}isMuted=!isMuted;video.muted=isMuted;return}
  if(isSettings(kc,k)){e.preventDefault();wakeUI();if(zone==='settings')closeSettings();else openSettings();return}
  wakeUI();
  var yn=$('ypName'),yu=$('ypUrl');
  if(document.activeElement===yn||document.activeElement===yu){if(isBack(kc,k)){e.preventDefault();$('ypCancel').click()}return}
  var si=$('searchInp');
  if(document.activeElement===si){if(isBack(kc,k)){e.preventDefault();if(si.value){si.value='';searchQ='';viewChs=getViewChs();renderAll();_updateSC()}else closeSearch()}return}

  if(zone==='exit'){
    if(isBack(kc,k)||kc===KC.BLUE){e.preventDefault();closeExit();return}
    if(isLt(kc,k)||isRt(kc,k)){e.preventDefault();exitFocusYes=!exitFocusYes;_ueF();return}
    if(isOK(kc,k)){e.preventDefault();if(exitFocusYes)doExit();else closeExit();return}
    return;
  }
  if(zone==='dialer'){
    if(isDig(e)){e.preventDefault();dialPush(getDig(e));return}
    if(isOK(kc,k)){e.preventDefault();dialGo();return}
    if(isBack(kc,k)){e.preventDefault();closeDial();return}
    return;
  }
  if(zone==='search'){
    if(isBack(kc,k)){e.preventDefault();closeSearch();return}
    if(isOK(kc,k)){e.preventDefault();if(si)si.focus();return}
    if(isLt(kc,k)&&col>1){e.preventDefault();col--;renderAll();return}
    if(isRt(kc,k)&&col<viewChs.length){e.preventDefault();col++;renderAll();return}
    return;
  }
  if(zone==='yp'){
    if(isBack(kc,k)){e.preventDefault();closeYP();return}
    var showingForm=ypForm.classList.contains('on');
    if(!showingForm){
      var items=QA('.yp-act',$('ypActs'));
      if(isUp(kc,k)){e.preventDefault();if(ypIdx===0){$('ypClose').focus({preventScroll:true})}else{ypIdx--;if(items[ypIdx])items[ypIdx].focus({preventScroll:true})}return}
      if(isDn(kc,k)){e.preventDefault();ypIdx=Math.min(items.length-1,ypIdx+1);if(items[ypIdx])items[ypIdx].focus({preventScroll:true});return}
      if(isOK(kc,k)){e.preventDefault();if(document.activeElement===$('ypClose'))closeYP();else if(items[ypIdx])items[ypIdx].click();return}
    }else{
      if(isUp(kc,k)||isDn(kc,k)){e.preventDefault();var inp2=QA('.yp-inp,#ypSave,#ypCancel',ypForm),fi=-1;for(var qi=0;qi<inp2.length;qi++){if(inp2[qi]===document.activeElement){fi=qi;break}}if(isUp(kc,k)&&fi>0)inp2[fi-1].focus({preventScroll:true});else if(isDn(kc,k)&&fi<inp2.length-1)inp2[fi+1].focus({preventScroll:true});return}
    }
    return;
  }
  if(zone==='settings'){
    if(isBack(kc,k)){e.preventDefault();closeSettings();return}
    var sideItems=QA('.so-nav',soSide),mainItems=QA('[tabindex="0"]',soMain);
    if(isUp(kc,k)){e.preventDefault();if(soSideZone){if(soSideIdx===0){$('soClose').focus({preventScroll:true})}else{soSideIdx--;if(sideItems[soSideIdx])sideItems[soSideIdx].focus({preventScroll:true})}}else{soMainIdx=Math.max(0,soMainIdx-1);if(mainItems[soMainIdx]){mainItems[soMainIdx].focus({preventScroll:true});mainItems[soMainIdx].scrollIntoView({block:'nearest'})}}return}
    if(isDn(kc,k)){e.preventDefault();if(soSideZone){soSideIdx=Math.min(sideItems.length-1,soSideIdx+1);if(sideItems[soSideIdx])sideItems[soSideIdx].focus({preventScroll:true})}else{soMainIdx=Math.min(mainItems.length-1,soMainIdx+1);if(mainItems[soMainIdx]){mainItems[soMainIdx].focus({preventScroll:true});mainItems[soMainIdx].scrollIntoView({block:'nearest'})}}return}
    if(isRt(kc,k)&&soSideZone){e.preventDefault();soSideZone=false;soMainIdx=0;if(mainItems[0])mainItems[0].focus({preventScroll:true});return}
    if(isLt(kc,k)&&!soSideZone){e.preventDefault();soSideZone=true;if(sideItems[soSideIdx])sideItems[soSideIdx].focus({preventScroll:true});return}
    if(isOK(kc,k)){e.preventDefault();var f=document.activeElement;if(f&&f.classList.contains('srow')){var cb2=f.querySelector('input[type=checkbox]');if(cb2){cb2.checked=!cb2.checked;cb2.dispatchEvent(new Event('change',{bubbles:true}))}}else if(f&&(f.dataset.engine||f.dataset.buf||f.classList.contains('opt-row')))f.click();else if(f&&f.classList.contains('so-nav'))f.click();else if(f)f.click();return}
    return;
  }
  if(zone==='tabs'){
    var tabs2=QA('.ntab',navTabs);
    if(isLt(kc,k)){e.preventDefault();tabIdx=Math.max(0,tabIdx-1);if(tabs2[tabIdx])tabs2[tabIdx].focus({preventScroll:true});return}
    if(isRt(kc,k)){e.preventDefault();tabIdx=Math.min(tabs2.length-1,tabIdx+1);if(tabs2[tabIdx])tabs2[tabIdx].focus({preventScroll:true});return}
    if(isOK(kc,k)){e.preventDefault();if(tabs2[tabIdx])tabs2[tabIdx].click();zone='rows';syncFocus();return}
    if(isDn(kc,k)){e.preventDefault();zone='rows';syncFocus();return}
    if(isBack(kc,k)){e.preventDefault();zone='rows';syncFocus();return}
    return;
  }
  if(zone==='rows'){
    if(isUp(kc,k)){e.preventDefault();zone='tabs';var tabBtns=QA('.ntab',navTabs);for(var ti=0;ti<tabBtns.length;ti++){if(tabBtns[ti].dataset.g===activeTab){tabIdx=ti;break}}if(tabBtns[tabIdx])tabBtns[tabIdx].focus({preventScroll:true});return}
    if(isDn(kc,k)){e.preventDefault();return}
    if(isLt(kc,k)){e.preventDefault();if(col>0){col--;renderAll()}return}
    if(isRt(kc,k)){e.preventDefault();if(col<viewChs.length){col++;renderAll()}return}
    if(isOK(kc,k)){e.preventDefault();immediatePlay();return}
    if(isBack(kc,k)){e.preventDefault();openExit();return}
  }
  switch(true){
    case kc===KC.RED:e.preventDefault();var tabs3=QA('.ntab',navTabs),ci3=0;for(var ti3=0;ti3<tabs3.length;ti3++){if(tabs3[ti3].dataset.g===activeTab){ci3=ti3;break}}if(tabs3[(ci3+1)%tabs3.length])tabs3[(ci3+1)%tabs3.length].click();break;
    case kc===KC.GREEN:e.preventDefault();cycleAspect();break;
    case kc===KC.YELLOW:e.preventDefault();openYP();break;
    case kc===KC.BLUE:e.preventDefault();openSearch();break;
    case kc===KC.PLAY||k==='MediaPlay':e.preventDefault();if(ENGINE==='avplay'&&avplay){try{avplay.play()}catch(e2){}}else video.play().catch(function(){});break;
    case kc===KC.PAUSE||k==='MediaPause':e.preventDefault();if(ENGINE==='avplay'&&avplay){try{avplay.pause()}catch(e2){}}else video.pause();break;
    case kc===KC.PP||k==='MediaPlayPause':e.preventDefault();if(ENGINE==='avplay'&&avplay){try{var st2=avplay.getState();if(st2==='PLAYING')avplay.pause();else avplay.play()}catch(e2){}}else{if(video.paused)video.play().catch(function(){});else video.pause()}break;
    case kc===KC.STOP||k==='MediaStop':e.preventDefault();if(ENGINE==='avplay')avplayStop();else if(shakaPlayer){shakaPlayer.unload();setPlaying(false);curUrl=''}setSt('Stopped','');break;
    case kc===KC.FF||k==='MediaFastForward':e.preventDefault();if(ENGINE==='avplay'&&avplay){try{avplay.seekTo(Math.min(avplay.getDuration(),(avplay.getCurrentTime()||0)+30000))}catch(e2){}}else if(video&&isFinite(video.duration))video.currentTime=Math.min(video.duration,video.currentTime+30);break;
    case kc===KC.REW||k==='MediaRewind':e.preventDefault();if(ENGINE==='avplay'&&avplay){try{avplay.seekTo(Math.max(0,(avplay.getCurrentTime()||0)-30000))}catch(e2){}}else if(video)video.currentTime=Math.max(0,(video.currentTime||0)-30);break;
    case kc===KC.CHUP||k==='ChannelUp'||k==='PageUp':e.preventDefault();if(col>1){col--;renderAll();immediatePlay()}break;
    case kc===KC.CHDN||k==='ChannelDown'||k==='PageDown':e.preventDefault();if(col<viewChs.length){col++;renderAll();immediatePlay()}break;
    case k==='f'||k==='F':e.preventDefault();toggleFav();break;
    case k==='d'||k==='D':e.preventDefault();openDial();break;
    case k==='s'||k==='S':e.preventDefault();openSearch();break;
    case isDig(e)&&(zone==='rows'||zone==='tabs'):e.preventDefault();remoteDigit(getDig(e));break;
  }
});
$('root').addEventListener('click',wakeUI);

/* ════════════════════════════════════════════
   TWICE-A-WEEK REFRESH CHECK
   Fires 60s after boot — only if 3.5 days elapsed.
   No refresh on normal launch = instant startup.
════════════════════════════════════════════ */
function checkPeriodicRefresh(){
  var last=parseInt(lsGet(PL_REFRESH_KEY)||'0',10);
  if(Date.now()-last>=PL_REFRESH_INTERVAL){
    setTimeout(function(){
      AppCache.clearAllM3U();lsSet(PL_REFRESH_KEY,String(Date.now()));
      allChs=[];setSt('Periodic refresh (twice-a-week)…','buf');
      loadAll(true).then(function(){setSt('Refresh complete — '+allChs.length+' channels','ok')});
    },60000);
  }
}

/* ════════════════════════════════════════════
   LOAD ALL — sequential, cached
════════════════════════════════════════════ */
function loadAll(force){
  if(force===undefined)force=false;allChs=[];
  var chain=Promise.resolve();
  BUILTINS.forEach(function(pl){chain=chain.then(function(){return loadPl(pl.url,pl.name,force,pl._src)})});
  return chain.then(function(){
    var customs=pls.filter(function(p){return!p.builtIn}),c2=Promise.resolve();
    customs.forEach(function(pl){c2=c2.then(function(){return loadPl(pl.url,pl.name,force,pl.name.toLowerCase())})});
    return c2;
  }).then(function(){
    rebuildNavTabs();setTab(activeTab);
    var lastUrl=lsGet(LS.LCHU);
    if(lastUrl){for(var li=0;li<viewChs.length;li++){if(viewChs[li].url===lastUrl){col=li+1;renderAll();break}}}
    hideSplash();resetHideTimer();currentVol=getSysVol();
    setSt('Ready — '+allChs.length+' channels','ok');checkPeriodicRefresh();
  });
}

/* ════════════════════════════════════════════
   CLEANUP
════════════════════════════════════════════ */
window.addEventListener('beforeunload',function(){
  clearTimeout(hideTimer);clearTimeout(playTimer);clearTimeout(volTimer);
  clearTimeout(osdTimer);clearTimeout(engBadgeTimer);clearTimeout(dialTimer);
  clearTimeout(rDialTimer);clearTimeout(chHudTimer);
});

/* ════════════════════════════════════════════
   BOOT — instant cache → network in background
════════════════════════════════════════════ */
(function boot(){
  loadStore();
  pls=pls.filter(function(p){return!p.builtIn&&!BUILTINS.some(function(b){return b.url===p.url})});
  $('splMsg').textContent='Initialising player…';
  initAVPlay();
  if(typeof SagaEPG!=='undefined')SagaEPG.prefetch();
  initShaka().then(function(){
    $('splMsg').textContent='Loading channels…';
    rebuildNavTabs();
    return loadChCache().then(function(cached){
      if(cached&&cached.chs&&cached.chs.length>0){
        /* Instant display from cache — no network needed */
        allChs=cached.chs;
        rebuildNavTabs();setTab(cached.tab||'Telugu');
        var lastUrl=lsGet(LS.LCHU);
        if(lastUrl){for(var li=0;li<viewChs.length;li++){if(viewChs[li].url===lastUrl){col=li+1;renderAll();break}}}
        hideSplash();currentVol=getSysVol();
        setSt('Ready — '+allChs.length+' channels (cached)','ok');
        /* Only periodic refresh — no forced background fetch every launch */
        checkPeriodicRefresh();
        return Promise.resolve();
      }
      /* First launch or cache expired */
      return loadAll(false);
    });
  }).catch(function(err){setSt('Boot error: '+String(err),'err');hideSplash()});
})();

