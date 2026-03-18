/* =========================
   IPTV ENGINE v6 (TV-GRADE)
========================= */
const App = (() => {

const S = {
  channels: [],
  rows: [],
  flat: [],
  focusRow: 0,
  focusCol: 0,
  currentIndex: 0,
  rowScroll: {},
  player: null,
  isFullscreen: false,
  prebufferIndex: null,
  dom: {
    rows: document.getElementById("rows"),
    overlay: document.getElementById("overlay"),
    player: document.getElementById("player"),
    ui: document.getElementById("ui")
  }
};

const CONFIG = {
  PLAYLIST: localStorage.getItem("custom_playlist") || "https://iptv-org.github.io/iptv/languages/tel.m3u",
  BUFFER: "300",
  TILE_WIDTH: 260,
  VISIBLE_COUNT: 6,
  APP_VERSION: "1.0.0"
};

/* ---------- CACHE VERSION ----------
   Clears old cache when APP_VERSION changes */
if(localStorage.getItem("app_version") !== CONFIG.APP_VERSION){
  localStorage.clear();
  localStorage.setItem("app_version", CONFIG.APP_VERSION);
}

/* =========================
   INIT
========================= */
async function init(){
  try { S.player = webapis.avplay; } catch(e){ console.warn("AVPlay not available", e); }

  const playlistText = await fetch(CONFIG.PLAYLIST).then(r => r.text());
  S.channels = parse(playlistText);
  build();
  render();
  setFocus();
}

/* =========================
   PARSE M3U
========================= */
function parse(text){
  const lines = text.split("\n");
  let res=[], meta={};
  for(let l of lines){
    l = l.trim();
    if(l.startsWith("#EXTINF")){
      meta.name = l.split(",").pop();
      const g = l.match(/group-title="([^"]+)"/);
      const logo = l.match(/tvg-logo="([^"]+)"/);
      meta.group = g ? g[1] : "Other";
      meta.logo = logo ? logo[1] : "";
    } else if(l && !l.startsWith("#")){
      res.push({...meta, url:l});
    }
  }
  return res;
}

/* =========================
   BUILD ROWS ALPHABETICALLY
========================= */
function build(){
  const map={};
  S.channels.forEach(ch=>{ if(!map[ch.group]) map[ch.group]=[]; map[ch.group].push(ch); });
  const groups = Object.keys(map).sort((a,b)=>a.localeCompare(b));
  S.rows = groups.map(g=>({title:g, items:map[g]}));
  S.flat = S.channels;
}

/* =========================
   RENDER ROWS + CARDS
========================= */
function render(){
  const frag = document.createDocumentFragment();
  S.rows.forEach((row, r)=>{
    const rowEl = div("row");
    const title = div("row-title", row.title);
    const items = div("row-items");

    row.items.forEach((ch,c)=>{
      const card = div("card");
      card._r = r;
      card._c = c;
      if(ch.logo){
        const img = new Image();
        img.src = ch.logo;
        img.loading="lazy";
        img.onerror=()=>{ img.src=""; };
        card.appendChild(img);
      } else {
        card.textContent = ch.name;
      }
      items.appendChild(card);
    });

    rowEl.appendChild(title);
    rowEl.appendChild(items);
    frag.appendChild(rowEl);
  });

  S.dom.rows.innerHTML = "";
  S.dom.rows.appendChild(frag);
}

/* =========================
   FOCUS + SCROLL
========================= */
function setFocus(){
  document.querySelectorAll(".card.active").forEach(e=>e.classList.remove("active"));
  const rowEl = S.dom.rows.children[S.focusRow];
  if(!rowEl) return;
  const items = rowEl.children[1];
  const el = items.children[S.focusCol];
  if(el) el.classList.add("active");
  scrollRow(items);
  showOverlay();
}

/* =========================
   HORIZONTAL SCROLL
========================= */
function scrollRow(items){
  if(!S.rowScroll[S.focusRow]) S.rowScroll[S.focusRow]=0;
  let scroll = S.rowScroll[S.focusRow];

  if(S.focusCol >= scroll + CONFIG.VISIBLE_COUNT) scroll = S.focusCol - CONFIG.VISIBLE_COUNT + 1;
  if(S.focusCol < scroll) scroll = S.focusCol;

  S.rowScroll[S.focusRow]=scroll;
  items.style.transform=`translateX(${-scroll*CONFIG.TILE_WIDTH}px)`;
}

/* =========================
   SHOW OVERLAY (CHANNEL NAME)
========================= */
function showOverlay(){
  const row = S.rows[S.focusRow];
  if(!row) return;
  const ch = row.items[S.focusCol];
  if(!ch) return;
  S.dom.overlay.textContent = ch.name;
  S.dom.overlay.style.opacity = "1";
  setTimeout(()=>{S.dom.overlay.style.opacity="0";},1500);
}

/* =========================
   PLAYER (AVPLAY)
========================= */
function play(index){
  const ch = S.flat[index];
  if(!ch || !S.player) return;
  S.currentIndex=index;
  S.isFullscreen=true;
  S.dom.ui.style.display="none";

  try{ S.player.stop(); S.player.close(); } catch(e){}

  try{
    S.player.open(ch.url);
    S.player.setDisplayRect(0,0,1920,1080);
    S.player.setStreamingProperty("BUFFERING_TIME", CONFIG.BUFFER);
    S.player.prepareAsync(()=>S.player.play(), err=>console.log(err));
  } catch(e){ console.log("play error",e); }

  // Prebuffer next channel
  prebuffer((index+1)%S.flat.length);
}

/* =========================
   PREBUFFER NEXT CHANNEL
========================= */
function prebuffer(index){
  const ch = S.flat[index];
  if(!ch || !S.player) return;
  if(S.prebufferIndex===index) return;
  S.prebufferIndex=index;
  // AVPlay can only have one instance, optional: keep next channel metadata ready
}

/* =========================
   STOP PLAYER
========================= */
function stopPlayer(){
  try{ S.player.stop(); S.player.close(); } catch(e){}
  S.isFullscreen=false;
  S.dom.ui.style.display="block";
}

/* =========================
   CHANNEL ZAPPING
========================= */
function zap(dir){
  let i=S.currentIndex+dir;
  if(i<0) i=S.flat.length-1;
  if(i>=S.flat.length) i=0;
  play(i);
}

/* =========================
   REMOTE INPUT HANDLER
========================= */
function onKey(e){
  if(S.isFullscreen){
    switch(e.key){
      case "ChannelUp":
      case "ArrowUp": zap(1); return;
      case "ChannelDown":
      case "ArrowDown": zap(-1); return;
      case "Return":
      case "Escape": stopPlayer(); return;
    }
    return;
  }

  // GRID NAV
  switch(e.key){
    case "ArrowDown": S.focusRow++; S.focusCol=0; break;
    case "ArrowUp": S.focusRow--; S.focusCol=0; break;
    case "ArrowRight": S.focusCol++; break;
    case "ArrowLeft": S.focusCol--; break;
    case "Enter": 
      const row=S.rows[S.focusRow];
      const ch=row.items[S.focusCol];
      play(S.flat.indexOf(ch));
      return;
    case "ColorF1Green": init(); return; // reload
  }

  clamp();
  setFocus();
}

/* =========================
   CLAMP NAVIGATION
========================= */
function clamp(){
  S.focusRow=Math.max(0, Math.min(S.focusRow, S.rows.length-1));
  const max=S.rows[S.focusRow].items.length-1;
  S.focusCol=Math.max(0, Math.min(S.focusCol,max));
}

/* =========================
   HELPER
========================= */
function div(cls,txt){
  const d=document.createElement("div");
  if(cls) d.className=cls;
  if(txt) d.textContent=txt;
  return d;
}

/* =========================
   START
========================= */
window.addEventListener("keydown", onKey);
return { init };
})();

App.init();