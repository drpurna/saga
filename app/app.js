/* =========================
   IPTV ENGINE v6 – FULL PRODUCTION READY
   Features: YouTube-style splash, fullscreen, AVPlay, pre-buffer, remote nav, search
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
      ui: document.getElementById("ui"),
      header: document.getElementById("header"),
      searchBtn: document.getElementById("searchBtn"),
      addBtn: document.getElementById("addBtn")
    },
    storage: {
      get(key, fallback = null) {
        try {
          const v = localStorage.getItem(key);
          return v ? JSON.parse(v) : fallback;
        } catch { return fallback; }
      },
      set(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
      }
    }
  };

  const CONFIG = {
    PLAYLIST: S.storage.get("custom_playlist") || "https://iptv-org.github.io/iptv/languages/tel.m3u",
    BUFFER: "300",
    VISIBLE_TILES: 6
  };

  /* =========================
     INIT
  ========================== */
  async function init() {
    showSplash();

    try { S.player = webapis.avplay; } catch(e){ console.warn("AVPlay not available", e); }

    const text = await fetch(CONFIG.PLAYLIST).then(r => r.text());
    S.channels = parse(text);
    buildRows();
    renderRows();
    setFocus();

    // Splash fade after 1.5s
    setTimeout(hideSplash, 1500);
  }

  /* =========================
     SPLASH SCREEN
  ========================== */
  function showSplash() {
    const splash = document.createElement("div");
    splash.id = "splash";

    const inner = document.createElement("div");
    inner.className = "splash-inner";

    const logo = document.createElement("div");
    logo.className = "splash-logo";

    const text = document.createElement("div");
    text.className = "splash-text";
    text.textContent = "Tizen TV";

    inner.appendChild(logo);
    inner.appendChild(text);
    splash.appendChild(inner);

    // Splash styling
    splash.style.position = "fixed";
    splash.style.inset = 0;
    splash.style.background = "#000";
    splash.style.display = "flex";
    splash.style.justifyContent = "center";
    splash.style.alignItems = "center";
    splash.style.flexDirection = "column";
    splash.style.zIndex = 1000;
    splash.style.opacity = 1;
    splash.style.transition = "opacity 0.8s ease";

    logo.style.width = "120px";
    logo.style.height = "120px";
    logo.style.borderRadius = "50%";
    logo.style.background = "#fff";
    logo.style.marginBottom = "20px";

    text.style.color = "#fff";
    text.style.fontSize = "48px";
    text.style.fontWeight = "900";
    text.style.fontFamily = "Arial Black, Arial, sans-serif";

    document.body.appendChild(splash);
  }

  function hideSplash() {
    const splash = document.getElementById("splash");
    if(!splash) return;
    splash.style.opacity = 0;
    setTimeout(() => {
      splash.remove();
      S.dom.ui.style.display = "block";
      setFocus();
    }, 800);
  }

  /* =========================
     PARSE PLAYLIST
  ========================== */
  function parse(text) {
    const lines = text.split("\n");
    let res = [], meta = {};
    for (let l of lines) {
      l = l.trim();
      if (l.startsWith("#EXTINF")) {
        meta.name = l.split(",").pop();
        const g = l.match(/group-title="([^"]+)"/);
        const logo = l.match(/tvg-logo="([^"]+)"/);
        meta.group = g ? g[1] : "Other";
        meta.logo = logo ? logo[1] : "";
      } else if (l && !l.startsWith("#")) {
        res.push({...meta, url:l});
      }
    }
    return res;
  }

  /* =========================
     BUILD ROWS
  ========================== */
  function buildRows() {
    const map = {};
    S.channels.forEach(ch => {
      if (!map[ch.group]) map[ch.group] = [];
      map[ch.group].push(ch);
    });
    const groups = Object.keys(map).sort((a,b)=>a.localeCompare(b));
    S.rows = groups.map(g => ({ title: g, items: map[g] }));
    S.flat = S.channels;
  }

  /* =========================
     RENDER ROWS
  ========================== */
  function renderRows() {
    const frag = document.createDocumentFragment();
    S.rows.forEach((row, r) => {
      const rowEl = div("row");
      const title = div("row-title", row.title);
      const items = div("row-items");

      row.items.forEach((ch, c) => {
        const card = div("card");
        card._r = r; card._c = c;
        card.tabIndex = 0;

        if(ch.logo){
          const img = new Image();
          img.src = ch.logo;
          img.alt = ch.name;
          card.appendChild(img);
        } else card.textContent = ch.name;

        card.addEventListener("click", () => play(getFlatIndex(r,c)));
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
  ========================== */
  function setFocus() {
    document.querySelectorAll(".card.active").forEach(e=>e.classList.remove("active"));

    const rowEl = S.dom.rows.children[S.focusRow];
    if(!rowEl) return;
    const items = rowEl.children[1];
    const el = items.children[S.focusCol];
    if(el) el.classList.add("active");

    scrollRow(items);
    updateOverlay();
  }

  function scrollRow(items) {
    if (!S.rowScroll[S.focusRow]) S.rowScroll[S.focusRow] = 0;

    let scroll = S.rowScroll[S.focusRow];
    const visible = CONFIG.VISIBLE_TILES;

    if(S.focusCol >= scroll + visible) scroll = S.focusCol - visible + 1;
    if(S.focusCol < scroll) scroll = S.focusCol;

    S.rowScroll[S.focusRow] = scroll;
    const offset = scroll * 280;
    items.style.transform = `translateX(${-offset}px)`;
  }

  function updateOverlay() {
    if(S.isFullscreen) return;
    const ch = S.rows[S.focusRow].items[S.focusCol];
    if(ch) {
      S.dom.overlay.textContent = ch.name;
      S.dom.overlay.style.opacity = 1;
      setTimeout(()=>S.dom.overlay.style.opacity=0, 1500);
    }
  }

  function getFlatIndex(r,c) {
    const row = S.rows[r];
    return S.flat.indexOf(row.items[c]);
  }

  /* =========================
     AVPLAY PLAYER
  ========================== */
  function play(index) {
    const ch = S.flat[index];
    if(!ch || !S.player) return;

    S.currentIndex = index;
    S.isFullscreen = true;

    // Hide grid and overlay
    S.dom.ui.style.display = "none";
    S.dom.overlay.style.opacity = 0;

    try { S.player.stop(); S.player.close(); } catch(e){}

    try {
      S.player.open(ch.url);
      S.player.setDisplayRect(0,0,1920,1080);
      S.player.setStreamingProperty("BUFFERING_TIME", CONFIG.BUFFER);
      S.player.prepareAsync(()=>S.player.play(), err=>console.error(err));
      prebufferNext(index);
    } catch(e){ console.error("AVPlay play error",e);}
  }

  function stopPlayer() {
    try { S.player.stop(); S.player.close(); } catch(e){}
    S.isFullscreen = false;

    // Show UI grid again
    S.dom.ui.style.display = "block";
    setFocus();
  }

  /* =========================
     PREBUFFER NEXT CHANNEL
  ========================== */
  function prebufferNext(index){
    const nextIndex = (index+1) % S.flat.length;
    const nextCh = S.flat[nextIndex];
    if(!nextCh) return;

    try {
      if(S.prebufferIndex!==nextIndex){
        const pb = webapis.avplay;
        pb.open(nextCh.url);
        pb.setDisplayRect(-1920,-1080,1,1);
        pb.prepareAsync(()=>{}, ()=>{});
        S.prebufferIndex = nextIndex;
      }
    } catch{}
  }

  /* =========================
     ZAPPING
  ========================== */
  function zap(dir){
    let i = S.currentIndex + dir;
    if(i <0) i=S.flat.length-1;
    if(i>=S.flat.length) i=0;
    play(i);
  }

  /* =========================
     REMOTE INPUT
  ========================== */
  function onKey(e){
    if(S.isFullscreen){
      switch(e.key){
        case "ChannelUp": case "ArrowUp": zap(1); return;
        case "ChannelDown": case "ArrowDown": zap(-1); return;
        case "Return": case "Escape": stopPlayer(); return;
      }
      return;
    }

    switch(e.key){
      case "ArrowDown": S.focusRow++; S.focusCol=0; break;
      case "ArrowUp": S.focusRow--; S.focusCol=0; break;
      case "ArrowRight": S.focusCol++; break;
      case "ArrowLeft": S.focusCol--; break;
      case "Enter": const row=S.rows[S.focusRow]; const ch=row.items[S.focusCol]; play(S.flat.indexOf(ch)); return;
      case "ColorF1Green": loadPlaylistPrompt(); return;
      case "ColorF2Yellow": searchPrompt(); return;
    }

    clampFocus();
    setFocus();
  }

  function clampFocus(){
    S.focusRow = Math.max(0, Math.min(S.focusRow,S.rows.length-1));
    const max = S.rows[S.focusRow].items.length-1;
    S.focusCol = Math.max(0, Math.min(S.focusCol,max));
  }

  function div(cls, txt){
    const d=document.createElement("div");
    if(cls)d.className=cls;
    if(txt)d.textContent=txt;
    return d;
  }

  function searchPrompt(){
    const q = prompt("Search channel:");
    if(!q) return;
    S.rows.forEach((row,r)=>{
      row.items.forEach((ch,c)=>{
        if(ch.name.toLowerCase().includes(q.toLowerCase())){
          S.focusRow=r; S.focusCol=c; setFocus();
        }
      });
    });
  }

  function loadPlaylistPrompt(){
    const url = prompt("Enter M3U URL:");
    if(!url) return;
    S.storage.set("custom_playlist", url);
    location.reload();
  }

  window.addEventListener("keydown", onKey);

  return { init };
})();

App.init();