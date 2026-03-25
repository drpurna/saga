// ================================================================
// IPTV — app.js v10.1 | Samsung Tizen TV
// Proxy : https://houser-3q3n.onrender.com  (Singapore IP)
// Fix   : +91 prefix in btoa() for Jio OTP API
// ================================================================

const PROXY        = 'https://houser-3q3n.onrender.com';
const JIO_SEND_OTP   = 'https://jiotvapi.media.jio.com/userservice/apis/v1/loginotp/send';
const JIO_VERIFY_OTP = 'https://jiotvapi.media.jio.com/userservice/apis/v1/loginotp/verify';
const JIO_REFRESH_AT = 'https://auth.media.jio.com/tokenservice/apis/v1/refreshtoken?langId=6';
const JIO_REFRESH_SSO= 'https://tv.media.jio.com/apis/v2.0/loginotp/refresh?langId=6';
const JIO_CHANNELS   = 'https://jiotv.data.cdn.jio.com/apis/v3.0/getMobileChannelList/get/?os=android&devicetype=phone&usertype=tvYR7NSNn7rymo3F';
const JIO_STREAM     = 'https://jiotvapi.media.jio.com/playback/apis/v1.1/geturl?langId=6';
const JIO_CAT={5:'Entertainment',6:'Movies',7:'Kids',8:'Sports',9:'Lifestyle',10:'Infotainment',12:'News',13:'Music',15:'Devotional',16:'Business',17:'Educational',18:'Shopping'};

const searchInput   =document.getElementById('searchInput');
const searchWrap    =document.getElementById('searchWrap');
const tabBar        =document.getElementById('tabBar');
const channelListEl =document.getElementById('channelList');
const countBadge    =document.getElementById('countBadge');
const nowPlayingEl  =document.getElementById('nowPlaying');
const npChNumEl     =document.getElementById('npChNum');
const statusBadge   =document.getElementById('statusBadge');
const video         =document.getElementById('video');
const videoWrap     =document.getElementById('videoWrap');
const videoOverlay  =document.getElementById('videoOverlay');
const fsHint        =document.getElementById('fsHint');
const loadBar       =document.getElementById('loadBar');
const chDialer      =document.getElementById('chDialer');
const chDialerNum   =document.getElementById('chDialerNum');
const arBtn         =document.getElementById('arBtn');

const PLAYLISTS=[{name:'Telugu',url:'https://iptv-org.github.io/iptv/languages/tel.m3u'},{name:'India',url:'https://iptv-org.github.io/iptv/countries/in.m3u'}];
const FAV_IDX=2,JIO_IDX=3,TOTAL_TABS=4;
const FAV_KEY='iptv:favs',PLAYLIST_KEY='iptv:lastPl',JIO_CRED_KEY='iptv:jioCred';
const SHAKA_CFG={streaming:{bufferingGoal:30,rebufferingGoal:4,bufferBehind:20,retryParameters:{maxAttempts:4,baseDelay:500,backoffFactor:2,fuzzFactor:0.5,timeout:12000}},manifest:{retryParameters:{maxAttempts:3,baseDelay:500,backoffFactor:2,fuzzFactor:0.5,timeout:15000}},abr:{enabled:true,defaultBandwidthEstimate:1000000}};
const AR_MODES=[{cls:'',label:'Fit'},{cls:'ar-fill',label:'Fill'},{cls:'ar-cover',label:'Crop'},{cls:'ar-wide',label:'Wide'}];
let arIdx=0,arManuallySet=false;
let channels=[],allChannels=[],filtered=[],selectedIndex=0;
let focusArea='list',shakaPlayer=null,plIdx=0;
let isFullscreen=false,hasPlayed=false;
let fsHintTimer=null,loadBarTimer=null,previewTimer=null;
const PREVIEW_DELAY=700;
let dialBuffer='',dialTimer=null;
let jioChannels=[],jioCred=null,jioModalOpen=false;

let favSet=new Set();
(function(){try{const r=localStorage.getItem(FAV_KEY);if(r)favSet=new Set(JSON.parse(r));}catch(e){}})();
function saveFavs(){try{localStorage.setItem(FAV_KEY,JSON.stringify([...favSet]));}catch(e){}}
function favKey(ch){return ch.channelId?'jio:'+ch.channelId:(ch.url||'');}
function isFav(ch){return favSet.has(favKey(ch));}
function showFavourites(){filtered=allChannels.filter(c=>favSet.has(favKey(c)));selectedIndex=0;renderList();setStatus(filtered.length?filtered.length+' favourites':'No favourites yet','idle');}
function toggleFav(ch){const k=favKey(ch);favSet.has(k)?favSet.delete(k):favSet.add(k);saveFavs();if(plIdx===FAV_IDX)showFavourites();VS.refresh();showToast(isFav(ch)?'\u2605 Added':'\u2715 Removed');}

let toastEl=null,toastTm=null;
function showToast(msg){if(!toastEl){toastEl=document.createElement('div');toastEl.id='toast';document.body.appendChild(toastEl);}toastEl.textContent=msg;toastEl.style.opacity='1';clearTimeout(toastTm);toastTm=setTimeout(()=>{toastEl.style.opacity='0';},2400);}

function setStatus(t,c){statusBadge.textContent=t;statusBadge.className='status-badge '+(c||'idle');}
function startLoadBar(){clearTimeout(loadBarTimer);loadBar.style.width='0%';loadBar.classList.add('active');let w=0;const tick=()=>{w=Math.min(w+Math.random()*9,85);loadBar.style.width=w+'%';if(w<85)loadBarTimer=setTimeout(tick,220);};loadBarTimer=setTimeout(tick,100);}
function finishLoadBar(){clearTimeout(loadBarTimer);loadBar.style.width='100%';setTimeout(()=>{loadBar.classList.remove('active');loadBar.style.width='0%';},400);}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}
function initials(n){return n.replace(/[^a-zA-Z0-9]/g,' ').trim().split(/\s+/).slice(0,2).map(w=>w[0]||'').join('').toUpperCase()||'?';}
function cleanName(raw){return raw.replace(/\s*[\\[(][^\\]*)]*[\])]/g,'').replace(/\b(4K|UHD|FHD|HLS|HEVC|H264|H\.264|SD|HD|576[piP]?|720[piP]?|1080[piP]?|2160[piP]?)\b/gi,'').replace(/[\|\-\u2013\u2014]+\s*$/g,'').replace(/\s{2,}/g,' ').trim();}
function parseM3U(text){const lines=text.split(/\r?\n/),out=[];let meta=null;for(const raw of lines){const line=raw.trim();if(!line)continue;if(line.startsWith('#EXTINF')){const np=line.includes(',')?line.split(',').slice(1).join(',').trim():'Unknown';const gm=line.match(/group-title="([^"]+)"/i),lm=line.match(/tvg-logo="([^"]+)"/i);meta={name:cleanName(np)||np,group:gm?gm[1]:'Other',logo:lm?lm[1]:''};continue;}if(!line.startsWith('#')&&meta){out.push({name:meta.name,group:meta.group,logo:meta.logo,url:line});meta=null;}}return out;}

function proxyXHR(method,targetUrl,headers,body,timeoutMs){
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();
    xhr.timeout=timeoutMs||20000;
    xhr.open(method,PROXY+'/proxy?url='+encodeURIComponent(targetUrl),true);
    xhr.setRequestHeader('Content-Type','application/json');
    if(headers)Object.keys(headers).forEach(k=>{if(k==='Content-Type')return;try{xhr.setRequestHeader(k,headers[k]);}catch(e){}});
    xhr.onload=function(){
      if(xhr.status===204){resolve({});return;}
      if(xhr.status>=200&&xhr.status<400){try{resolve(JSON.parse(xhr.responseText));}catch(e){resolve({_raw:xhr.responseText});}return;}
      const err=new Error('HTTP '+xhr.status);
      try{const j=JSON.parse(xhr.responseText);err.message=j.message||j.result||j.errorMessage||('HTTP '+xhr.status);}catch(pe){}
      reject(err);
    };
    xhr.onerror=()=>reject(new Error('Cannot reach proxy — check internet'));
    xhr.ontimeout=()=>reject(new Error('Timed out — open houser-3q3n.onrender.com on phone first'));
    xhr.send(body?JSON.stringify(body):null);
  });
}

function jioHdr(withAuth){
  const h={'appname':'RJIL_JioTV','os':'android','devicetype':'phone','versionCode':'315','versionName':'7.0.4','os_version':'13','User-Agent':'okhttp/4.9.2'};
  if(withAuth&&jioCred){h['authToken']=jioCred.accessToken||jioCred.ssoToken||'';h['accessToken']=jioCred.accessToken||jioCred.ssoToken||'';h['ssoToken']=jioCred.ssoToken||'';h['uniqueId']=jioCred.uniqueId||'';h['subscriberId']=jioCred.subscriberId||'';h['crm']=jioCred.crm||jioCred.subscriberId||'';h['appKey']='NzNiMDhlYzQyNjJm';h['channelPartnerID']='JIOTV';h['cId']='com.jio.media.jiotv';h['lId']='6';h['dm']='1';}
  return h;
}

function jioSendOTP(mobile){
  const b64=btoa('+91'+mobile);
  return proxyXHR('POST',JIO_SEND_OTP,jioHdr(false),{number:b64},25000)
    .then(data=>{console.log('[Jio] sendOTP OK',JSON.stringify(data));return '__ok__';});
}
function jioVerifyOTP(mobile,otp){
  const b64=btoa('+91'+mobile);
  return proxyXHR('POST',JIO_VERIFY_OTP,jioHdr(false),
    {number:b64,OTP:String(otp),deviceInfo:{consumptionDeviceName:'SM-G930F',info:{type:'android',platform:{name:'SM-G930F'},androidId:'a7c3f9b2d1e84f56'}}},25000)
  .then(data=>{
    const acc=data.authToken||data.accessToken||'';
    const sso=data.ssoToken||'';
    if(!acc&&!sso)throw new Error(data.message||data.errorMessage||'Wrong OTP — please retry');
    const sub=(data.sessionAttributes&&data.sessionAttributes.user&&data.sessionAttributes.user.subscriberId)||'';
    const uid=(data.sessionAttributes&&data.sessionAttributes.user&&data.sessionAttributes.user.unique)||'';
    return{accessToken:acc,ssoToken:sso,refreshToken:data.refreshToken||'',subscriberId:sub,uniqueId:uid,crm:sub,accessTokenExpiry:Date.now()+(60*60000)};
  });
}
function jioRefreshTokens(){
  if(!jioCred)return Promise.reject(new Error('No credentials'));
  return proxyXHR('POST',JIO_REFRESH_AT,jioHdr(true),{refreshToken:jioCred.refreshToken||''},15000)
    .then(data=>{const t=data.authToken||data.accessToken;if(!t)throw new Error('No token');jioCred.accessToken=t;jioCred.accessTokenExpiry=Date.now()+(60*60000);jioSaveCred();})
    .catch(()=>proxyXHR('POST',JIO_REFRESH_SSO,jioHdr(true),{},15000)
      .then(data=>{const t=data.ssoToken||data.authToken;if(!t)throw new Error('Session expired');jioCred.ssoToken=t;jioCred.accessTokenExpiry=Date.now()+(90*60000);jioSaveCred();}));
}
function jioGetStreamUrl(channelId){
  const r=(jioCred.accessTokenExpiry&&jioCred.accessTokenExpiry-Date.now()<300000)?jioRefreshTokens().catch(()=>{}):Promise.resolve();
  return r.then(()=>proxyXHR('POST',JIO_STREAM,jioHdr(true),{channel_id:String(channelId),liveurl:'1'},15000))
    .then(data=>{const u=data.result||data.url||data.stream_url||data.streamUrl||'';if(!u)throw new Error(data.message||'No stream URL');return u;});
}
function loadJioChannels(){
  setStatus('Loading Jio\u2026','loading');startLoadBar();
  const r=(jioCred&&jioCred.accessTokenExpiry&&jioCred.accessTokenExpiry-Date.now()<300000)?jioRefreshTokens().catch(()=>{}):Promise.resolve();
  return r.then(()=>proxyXHR('GET',JIO_CHANNELS,jioHdr(true),null,30000))
    .then(data=>{
      const list=Array.isArray(data)?Array.isArray(data.result)?data.result:Array.isArray(data.channels)?data.channels:[];
      if(!list.length)throw new Error('Empty channel list');
      jioChannels=list.map(ch=>({name:ch.channel_name||ch.channelName||'Unknown',logo:ch.logoUrl||ch.logo_url||'',channelId:String(ch.channel_id||ch.channelId||''),group:JIO_CAT[ch.channelCategoryId]||'Jio TV',isHD:!!(ch.isHD||ch.is_hd),url:null})).filter(c=>c.channelId);
      jioChannels.forEach(c=>{if(!allChannels.find(x=>x.channelId===c.channelId))allChannels.push(c);});
      channels=jioChannels.slice();filtered=channels.slice();selectedIndex=0;
      finishLoadBar();renderList();setFocus('list');
      setStatus('Jio \u00b7 '+channels.length+' ch','idle');return true;
    }).catch(err=>{finishLoadBar();setStatus('Jio error: '+err.message,'error');return false;});
}
function jioSaveCred(){try{localStorage.setItem(JIO_CRED_KEY,JSON.stringify(jioCred));}catch(e){}}
function jioClearCred(){try{localStorage.removeItem(JIO_CRED_KEY);}catch(e){}jioCred=null;jioChannels=[];}
function jioLoadCred(){try{const r=localStorage.getItem(JIO_CRED_KEY);if(!r)return null;const c=JSON.parse(r);return(c&&(c.ssoToken||c.accessToken))?c:null;}catch(e){return null;}}
function handleJioTab(){if(jioChannels.length){channels=jioChannels.slice();filtered=channels.slice();selectedIndex=0;renderList();setStatus('Jio \u00b7 '+channels.length+' ch','idle');setFocus('list');return;}if(jioCred){loadJioChannels().then(ok=>{if(!ok){jioClearCred();showJioLoginModal();}});return;}showJioLoginModal();}
function initJio(){try{const c=jioLoadCred();if(!c)return;jioCred=c;if(plIdx===JIO_IDX)loadJioChannels();}catch(e){}}

const VS={ITEM_H:88,OVERSCAN:6,c:null,inner:null,vh:0,st:0,total:0,rs:-1,re:-1,nodes:[],raf:null,
  init(el){this.c=el;this.inner=document.createElement('div');this.inner.id='vsInner';this.c.appendChild(this.inner);const mv=()=>{this.vh=this.c.clientHeight||this.c.offsetHeight||700;if(this.vh<10)requestAnimationFrame(mv);};requestAnimationFrame(mv);this.c.addEventListener('scroll',()=>{if(this.raf)return;this.raf=requestAnimationFrame(()=>{this.raf=null;this.st=this.c.scrollTop;this._paint();});},{passive:true});window.addEventListener('resize',()=>{this.vh=this.c.clientHeight||700;this.rs=-1;this.re=-1;this._paint();});},
  setData(n){this.total=n;this.rs=-1;this.re=-1;this.inner.textContent='';this.nodes=[];this.inner.style.cssText='position:relative;width:100%;height:'+(n*this.ITEM_H)+'px;';this.c.scrollTop=0;this.st=0;this.vh=this.c.clientHeight||700;this._paint();},
  scrollToIndex(idx){const top=idx*this.ITEM_H,bot=top+this.ITEM_H,st=this.c.scrollTop;if(top<st)this.c.scrollTop=top;else if(bot>st+this.vh)this.c.scrollTop=bot-this.vh;this.st=this.c.scrollTop;this._paint();},
  scrollToIndexCentered(idx){const center=idx*this.ITEM_H-(this.vh/2)+(this.ITEM_H/2);this.c.scrollTop=Math.max(0,center);this.st=this.c.scrollTop;this.rs=-1;this.re=-1;this._paint();},
  _paint(){if(!this.total)return;if(this.vh<10){this.vh=this.c.clientHeight||700;if(this.vh<10){requestAnimationFrame(()=>this._paint());return;}}const H=this.ITEM_H,os=this.OVERSCAN;const start=Math.max(0,Math.floor(this.st/H)-os);const end=Math.min(this.total-1,Math.ceil((this.st+this.vh)/H)+os);if(start===this.rs&&end===this.re)return;this.rs=start;this.re=end;this.nodes=this.nodes.filter(nd=>{if(nd._i<start||nd._i>end){this.inner.removeChild(nd);return false;}return true;});const have=new Set(this.nodes.map(n=>n._i));const frag=document.createDocumentFragment();for(let i=start;i<=end;i++)if(!have.has(i))frag.appendChild(this._build(i));if(frag.childNodes.length)this.inner.appendChild(frag);this.nodes=[...this.inner.children];const sel=selectedIndex;for(const nd of this.nodes){const on=nd._i===sel;if(on!==nd._on){nd._on=on;nd.classList.toggle('active',on);if(nd._nm)nd._nm.style.color=on?'#000':'';if(nd._nu)nd._nu.style.color=on?'#999':'';}}},
  _build(i){const ch=filtered[i],li=document.createElement('li');li._i=i;li._on=false;li.style.cssText='position:absolute;top:'+(i*this.ITEM_H)+'px;left:0;right:0;height:'+this.ITEM_H+'px;';const ini=esc(initials(ch.name));const logo=ch.logo?`<div class="ch-logo"><img src="${esc(ch.logo)}" alt="" loading="lazy" onerror="this.style.display='none';this.nextSibling.style.display='flex'"/><span class="ch-logo-fb" style="display:none">${ini}</span></div>`:`<div class="ch-logo"><span class="ch-logo-fb">${ini}</span></div>`;li.innerHTML=logo+`<div class="ch-info"><div class="ch-name">${esc(ch.name)}</div></div>`+(isFav(ch)?'<span class="ch-fav">\u2605</span>':'')+`<span class="ch-num">${i+1}</span>`;li._nm=li.querySelector('.ch-name');li._nu=li.querySelector('.ch-num');if(i===selectedIndex){li._on=true;li.classList.add('active');if(li._nm)li._nm.style.color='#000';if(li._nu)li._nu.style.color='#999';}li.addEventListener('click',()=>{selectedIndex=i;VS.refresh();schedulePreview();});return li;},
  refresh(){this.rs=-1;this.re=-1;this._paint();}
};

function renderList(){countBadge.textContent=filtered.length;if(!filtered.length){VS.setData(0);const li=document.createElement('li');li.style.cssText='position:absolute;top:0;left:0;right:0;padding:24px 16px;color:#444;';li.textContent='No channels';VS.inner.appendChild(li);return;}VS.setData(filtered.length);VS.scrollToIndex(selectedIndex);}

let sdTm=null;
function applySearch(){clearTimeout(sdTm);sdTm=setTimeout(()=>{const q=searchInput.value.trim().toLowerCase();const src=plIdx===JIO_IDX?jioChannels:plIdx===FAV_IDX?allChannels.filter(c=>favSet.has(favKey(c))):channels;filtered=!q?src.slice():src.filter(c=>c.name.toLowerCase().includes(q)||(c.group||'').toLowerCase().includes(q));selectedIndex=0;renderList();},120);}
function commitSearch(){setFocus('list');if(filtered.length===1){selectedIndex=0;VS.refresh();schedulePreview();}}
function clearSearch(){searchInput.value='';applySearch();setFocus('list');}
searchInput.addEventListener('input',applySearch);

function xhrFetch(url,ms,cb){let done=false;const xhr=new XMLHttpRequest();const tid=setTimeout(()=>{if(done)return;done=true;xhr.abort();cb(new Error('Timeout'),null);},ms);xhr.onreadystatechange=function(){if(xhr.readyState!==4||done)return;done=true;clearTimeout(tid);xhr.status>=200&&xhr.status<400?cb(null,xhr.responseText):cb(new Error('HTTP '+xhr.status),null);};xhr.onerror=function(){if(done)return;done=true;clearTimeout(tid);cb(new Error('Network error'),null);};xhr.open('GET',url,true);xhr.send();}
function mirrorUrl(url){try{const u=new URL(url);if(u.hostname!=='raw.githubusercontent.com')return null;const p=u.pathname.split('/').filter(Boolean);if(p.length<4)return null;return'https://cdn.jsdelivr.net/gh/'+p[0]+'/'+p[1]+'@'+p[2]+'/'+p.slice(3).join('/');}catch(e){return null;}}
function loadPlaylist(urlOv){cancelPreview();if(plIdx===FAV_IDX&&!urlOv){showFavourites();return;}const url=urlOv||PLAYLISTS[plIdx].url;setStatus('Loading\u2026','loading');startLoadBar();xhrFetch(url,25000,(err,text)=>{if(err){const m=mirrorUrl(url);if(m){setStatus('Retrying\u2026','loading');xhrFetch(m,25000,(e2,t2)=>{finishLoadBar();e2?setStatus('Failed','error'):onLoaded(t2);});}else{finishLoadBar();setStatus('Failed','error');}return;}finishLoadBar();onLoaded(text);});}
function onLoaded(text){channels=parseM3U(text);const seen=new Set(allChannels.map(c=>c.url));channels.forEach(c=>{if(!seen.has(c.url))allChannels.push(c);});filtered=channels.slice();selectedIndex=0;renderList();try{localStorage.setItem(PLAYLIST_KEY,String(plIdx));}catch(e){}setStatus('Ready \u00b7 '+channels.length+' ch','idle');setFocus('list');}

function setAR(idx,label){video.classList.remove('ar-fill','ar-cover','ar-wide');arIdx=idx;const m=AR_MODES[idx];if(m.cls)video.classList.add(m.cls);arBtn.textContent='\u26f6 '+m.label;arBtn.className='ar-btn'+(m.cls?' '+m.cls:'');if(label)showToast(label);}
function resetAspectRatio(){arManuallySet=false;setAR(0);}
function applyAutoAspect(){if(arManuallySet)return;const W=video.videoWidth,H=video.videoHeight;if(!W||!H)return;if(H<=576){const wi=AR_MODES.findIndex(m=>m.cls==='ar-wide');if(arIdx!==wi)setAR(wi,'Auto Wide ('+H+'p)');}else if(Math.abs(W/H-16/9)<0.08){const ci=AR_MODES.findIndex(m=>m.cls==='ar-cover');if(arIdx!==ci)setAR(ci,'Auto Fill');}else{if(arIdx!==0)setAR(0,'Auto Fit');}}
function cycleAR(){arManuallySet=true;video.classList.remove('ar-fill','ar-cover','ar-wide');arIdx=(arIdx+1)%AR_MODES.length;const m=AR_MODES[arIdx];if(m.cls)video.classList.add(m.cls);arBtn.textContent='\u26f6 '+m.label;arBtn.className='ar-btn'+(m.cls?' '+m.cls:'');showToast('Aspect: '+m.label);}
arBtn.addEventListener('click',cycleAR);
function setARFocus(on){arBtn.classList.toggle('focused',on);}

let previewLock=false;
function cancelPreview(){clearTimeout(previewTimer);previewTimer=null;}
async function destroyPlayer(){if(!shakaPlayer)return;try{await shakaPlayer.destroy();}catch(e){}shakaPlayer=null;}
function schedulePreview(){cancelPreview();previewTimer=setTimeout(()=>{previewTimer=null;if(!previewLock)startPreview(selectedIndex);},PREVIEW_DELAY);}

function startPreview(idx){
  if(!filtered.length)return;
  const ch=filtered[idx];if(!ch)return;
  if(ch.channelId){
    if(!jioCred){showJioLoginModal();return;}
    setStatus('Fetching stream\u2026','loading');startLoadBar();
    jioGetStreamUrl(ch.channelId)
      .then(url=>doPlayPreview({...ch,url},idx))
      .catch(err=>{
        if(/401|token|auth|expire/i.test(err.message)){
          jioRefreshTokens().then(()=>jioGetStreamUrl(ch.channelId)).then(url=>doPlayPreview({...ch,url},idx))
            .catch(()=>{jioClearCred();finishLoadBar();setStatus('Session expired','error');setTimeout(showJioLoginModal,1500);});
        }else{finishLoadBar();setStatus('Stream error: '+err.message,'error');}
      });
    return;
  }
  doPlayPreview(ch,idx);
}

async function doPlayPreview(ch,idx){
  resetAspectRatio();
  nowPlayingEl.textContent=ch.name;npChNumEl.textContent='CH '+(idx+1);
  videoOverlay.classList.add('hidden');hasPlayed=true;
  setStatus('Buffering\u2026','loading');startLoadBar();
  previewLock=true;await destroyPlayer();video.removeAttribute('src');video.load();previewLock=false;
  const url=ch.url;if(!url){setStatus('No stream URL','error');finishLoadBar();return;}
  video.addEventListener('loadedmetadata',()=>applyAutoAspect(),{once:true});
  if(!window.shaka||!shaka.Player.isBrowserSupported()){setStatus('Shaka unsupported','error');finishLoadBar();return;}
  try{
    shakaPlayer=new shaka.Player();await shakaPlayer.attach(video);shakaPlayer.configure(SHAKA_CFG);
    shakaPlayer.addEventListener('error',e=>{const err=e.detail;if(err.severity===shaka.util.Error.Severity.CRITICAL){setStatus('Error '+err.code,'error');finishLoadBar();}});
    shakaPlayer.addEventListener('buffering',e=>{if(e.buffering){setStatus('Buffering\u2026','loading');startLoadBar();}});
    await shakaPlayer.load(url);video.play().catch(()=>{});
  }catch(e){finishLoadBar();setStatus('Play error: '+(e.message||'unknown'),'error');}
}
function playSelected(){cancelPreview();startPreview(selectedIndex);}

function moveSel(d){if(!filtered.length)return;cancelPreview();selectedIndex=Math.max(0,Math.min(filtered.length-1,selectedIndex+d));VS.scrollToIndex(selectedIndex);VS.refresh();schedulePreview();}
function setFocus(a){focusArea=a;setARFocus(a==='ar');if(a==='search'){searchWrap.classList.add('active');searchInput.focus();}else{searchWrap.classList.remove('active');if(document.activeElement===searchInput)searchInput.blur();}}
function switchTab(idx){plIdx=idx;document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===idx));idx===JIO_IDX?handleJioTab():loadPlaylist();}
tabBar.querySelectorAll('.tab').forEach((b,i)=>b.addEventListener('click',()=>switchTab(i)));

function handleDigit(d){clearTimeout(dialTimer);dialBuffer+=d;chDialerNum.textContent=dialBuffer;chDialer.classList.add('visible');dialTimer=setTimeout(()=>{const num=parseInt(dialBuffer,10);dialBuffer='';chDialer.classList.remove('visible');if(!filtered.length||isNaN(num))return;const idx=Math.max(0,Math.min(filtered.length-1,num-1));cancelPreview();selectedIndex=idx;VS.scrollToIndexCentered(idx);playSelected();showToast('CH '+(idx+1)+' \u2014 '+filtered[idx].name);},1500);}

function showFsHint(){clearTimeout(fsHintTimer);fsHint.classList.add('visible');fsHintTimer=setTimeout(()=>fsHint.classList.remove('visible'),3000);}
function enterFS(){const fn=videoWrap.requestFullscreen||videoWrap.webkitRequestFullscreen||videoWrap.mozRequestFullScreen;if(fn){try{fn.call(videoWrap);}catch(e){}}document.body.classList.add('fullscreen');isFullscreen=true;showFsHint();}
function exitFS(){const fn=document.exitFullscreen||document.webkitExitFullscreen||document.mozCancelFullScreen;if(fn){try{fn.call(document);}catch(e){}}document.body.classList.remove('fullscreen');isFullscreen=false;fsHint.classList.remove('visible');}
function toggleFS(){isFullscreen?exitFS():enterFS();}
document.addEventListener('fullscreenchange',()=>{isFullscreen=!!(document.fullscreenElement||document.webkitFullscreenElement);if(!isFullscreen){document.body.classList.remove('fullscreen');fsHint.classList.remove('visible');}});
document.addEventListener('webkitfullscreenchange',()=>{isFullscreen=!!(document.webkitFullscreenElement||document.fullscreenElement);if(!isFullscreen){document.body.classList.remove('fullscreen');fsHint.classList.remove('visible');}});
video.addEventListener('dblclick',toggleFS);
video.addEventListener('playing',()=>{setStatus('Playing','playing');finishLoadBar();});
video.addEventListener('pause',()=>setStatus('Paused','paused'));
video.addEventListener('waiting',()=>{setStatus('Buffering\u2026','loading');startLoadBar();});
video.addEventListener('stalled',()=>setStatus('Buffering\u2026','loading'));
video.addEventListener('error',()=>{setStatus('Error','error');finishLoadBar();});

(function(){try{if(window.tizen&&tizen.tvinputdevice){['MediaPlay','MediaPause','MediaPlayPause','MediaStop','MediaFastForward','MediaRewind','ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue','ChannelUp','ChannelDown','Back','0','1','2','3','4','5','6','7','8','9'].forEach(k=>{try{tizen.tvinputdevice.registerKey(k);}catch(e){}});}}catch(e){}})();

function handleModalKey(e){
  const step1Vis=document.getElementById('jioLoginStep1').style.display!=='none';
  const inp=step1Vis?document.getElementById('jioMobile'):document.getElementById('jioOtp');
  const c=e.keyCode,k=e.key;
  if((c>=48&&c<=57)||(c>=96&&c<=105)){inp.value+=String(c>=96?c-96:c-48);e.preventDefault();e.stopImmediatePropagation();return;}
  if(k==='Backspace'||c===8){inp.value=inp.value.slice(0,-1);e.preventDefault();e.stopImmediatePropagation();return;}
  if(k==='Enter'||c===13){step1Vis?document.getElementById('jioRequestOtp').click():document.getElementById('jioVerifyOtp').click();e.preventDefault();e.stopImmediatePropagation();return;}
  if(k==='Escape'||k==='Back'||c===10009||c===27){if(!step1Vis){document.getElementById('jioLoginStep2').style.display='none';document.getElementById('jioLoginStep1').style.display='block';document.getElementById('jioOtp').value='';}else{document.getElementById('jioCloseModal').click();}e.preventDefault();e.stopImmediatePropagation();return;}
  e.preventDefault();e.stopImmediatePropagation();
}

window.addEventListener('keydown',e=>{
  if(jioModalOpen){handleModalKey(e);return;}
  const k=e.key,c=e.keyCode;
  if((c>=48&&c<=57)||(c>=96&&c<=105)){if(focusArea!=='search'){handleDigit(String(c>=96?c-96:c-48));e.preventDefault();return;}}
  if(k==='Escape'||k==='Back'||k==='GoBack'||c===10009||c===27){if(isFullscreen){exitFS();e.preventDefault();return;}if(focusArea==='ar'){setFocus('list');e.preventDefault();return;}if(focusArea==='search'){clearSearch();e.preventDefault();return;}try{if(window.tizen)tizen.application.getCurrentApplication().exit();}catch(ex){}e.preventDefault();return;}
  if(focusArea==='ar'){cycleAR();e.preventDefault();return;}
  if(focusArea==='search'){if(k==='Enter'||c===13){commitSearch();e.preventDefault();return;}if(k==='ArrowDown'||k==='ArrowUp'||c===40||c===38){commitSearch();}else return;}
  if(k==='ArrowUp'||c===38){isFullscreen?showFsHint():moveSel(-1);e.preventDefault();return;}
  if(k==='ArrowDown'||c===40){isFullscreen?showFsHint():moveSel(1);e.preventDefault();return;}
  if(k==='ArrowLeft'||c===37){isFullscreen?exitFS():setFocus('list');e.preventDefault();return;}
  if(k==='ArrowRight'||c===39){if(isFullscreen){showFsHint();e.preventDefault();return;}setFocus('ar');e.preventDefault();return;}
  if(k==='Enter'||c===13){if(isFullscreen){exitFS();e.preventDefault();return;}if(focusArea==='list'){playSelected();setTimeout(()=>{if(hasPlayed)enterFS();},600);}e.preventDefault();return;}
  if(k==='PageUp'){moveSel(-10);e.preventDefault();return;}
  if(k==='PageDown'){moveSel(10);e.preventDefault();return;}
  if(k==='MediaPlayPause'||c===10252){video.paused?video.play().catch(()=>{}):video.pause();e.preventDefault();return;}
  if(k==='MediaPlay'||c===415){video.play().catch(()=>{});e.preventDefault();return;}
  if(k==='MediaPause'||c===19){video.pause();e.preventDefault();return;}
  if(k==='MediaStop'||c===413){cancelPreview();destroyPlayer();video.pause();video.removeAttribute('src');video.load();setStatus('Stopped','idle');finishLoadBar();e.preventDefault();return;}
  if(k==='MediaFastForward'||c===417){moveSel(1);e.preventDefault();return;}
  if(k==='MediaRewind'||c===412){moveSel(-1);e.preventDefault();return;}
  if(k==='ChannelUp'||c===427){moveSel(1);e.preventDefault();return;}
  if(k==='ChannelDown'||c===428){moveSel(-1);e.preventDefault();return;}
  if(k==='ColorF0Red'||c===403){switchTab((plIdx+1)%TOTAL_TABS);e.preventDefault();return;}
  if(k==='ColorF1Green'||c===404){if(filtered.length&&focusArea==='list')toggleFav(filtered[selectedIndex]);e.preventDefault();return;}
  if(k==='ColorF2Yellow'||c===405){setFocus('search');e.preventDefault();return;}
  if(k==='ColorF3Blue'||c===406){if(hasPlayed)toggleFS();e.preventDefault();return;}
});

function showJioLoginModal(){
  const modal=document.getElementById('jioModal');
  const step1=document.getElementById('jioLoginStep1');
  const step2=document.getElementById('jioLoginStep2');
  const statDiv=document.getElementById('jioStatus');
  const mobileIn=document.getElementById('jioMobile');
  const otpIn=document.getElementById('jioOtp');
  const reqBtn=document.getElementById('jioRequestOtp');
  const verBtn=document.getElementById('jioVerifyOtp');
  const closeBtn=document.getElementById('jioCloseModal');
  const resndBtn=document.getElementById('jioResendOtp');
  step1.style.display='block';step2.style.display='none';
  statDiv.innerHTML='';mobileIn.value='';otpIn.value='';
  reqBtn.disabled=false;verBtn.disabled=false;
  let pendingMobile='';
  function st(msg,type){const col=type==='error'?'#e50000':type==='ok'?'#00c06a':'#f0c400';statDiv.innerHTML='<span style="color:'+col+'">'+esc(msg)+'</span>';}
  reqBtn.onclick=function(){
    const mobile=mobileIn.value.replace(/\D/g,'');
    if(mobile.length!==10){st('Enter valid 10-digit number','error');return;}
    st('Sending OTP\u2026','wait');reqBtn.disabled=true;
    jioSendOTP(mobile)
      .then(()=>{pendingMobile=mobile;st('OTP sent to +91 '+mobile,'ok');step1.style.display='none';step2.style.display='block';otpIn.value='';setTimeout(()=>{try{otpIn.focus();}catch(e){}},150);})
      .catch(err=>{st('Error: '+err.message,'error');reqBtn.disabled=false;});
  };
  verBtn.onclick=function(){
    const otp=otpIn.value.replace(/\D/g,'');
    if(otp.length<4){st('Enter OTP from SMS','error');return;}
    st('Verifying\u2026','wait');verBtn.disabled=true;
    jioVerifyOTP(pendingMobile,otp)
      .then(cred=>{jioCred=cred;jioSaveCred();st('\u2713 Logged in!','ok');setTimeout(()=>{jioModalOpen=false;modal.style.display='none';loadJioChannels().then(ok=>{if(!ok)showToast('Tap Jio TV again');});},600);})
      .catch(err=>{st('Error: '+err.message,'error');verBtn.disabled=false;});
  };
  if(resndBtn)resndBtn.onclick=function(){step2.style.display='none';step1.style.display='block';otpIn.value='';reqBtn.disabled=false;st('Re-enter number','wait');};
  closeBtn.onclick=function(){jioModalOpen=false;modal.style.display='none';if(plIdx===JIO_IDX&&!jioCred)switchTab(0);};
  jioModalOpen=true;
  modal.style.display='flex';
  setTimeout(()=>{try{mobileIn.focus();}catch(e){}},150);
}

(function init(){
  if(window.shaka)shaka.polyfill.installAll();
  try{const s=localStorage.getItem(PLAYLIST_KEY);if(s)plIdx=Math.min(parseInt(s,10)||0,TOTAL_TABS-1);}catch(e){}
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('active',i===plIdx));
  VS.init(channelListEl);
  if(plIdx===JIO_IDX){initJio();if(!jioCred)setTimeout(handleJioTab,200);}
  else{loadPlaylist();initJio();}
})();
