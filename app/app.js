/* =========================
   IPTV ENGINE v3 FINAL
========================= */

const App = (() => {

const S = {
  channels: [],
  rows: [],
  groups: [],
  flat: [],

  focusRow: 0,
  focusCol: 0,
  currentIndex: 0,

  player: null,

  visibleStart: 0,
  VISIBLE_ROWS: 6,

  dom: {
    rows: document.getElementById("rows"),
    overlay: document.getElementById("overlay")
  }
};

const CONFIG = {
  PLAYLIST: "https://iptv-org.github.io/iptv/languages/tel.m3u",
  CACHE_KEY: "iptv_cache_v1",
  BUFFER: "300"
};

/* INIT */
async function init() {

  try { S.player = webapis.avplay; } catch(e){}

  let text = localStorage.getItem(CONFIG.CACHE_KEY);

  if (!text) {
    text = await fetch(CONFIG.PLAYLIST).then(r=>r.text());
    localStorage.setItem(CONFIG.CACHE_KEY, text);
  }

  S.channels = parse(text);
  build();

  renderWindow();
  setFocus();
}

/* PARSE */
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

/* BUILD */
function build() {
  const map = {};

  S.channels.forEach(ch => {
    if (!map[ch.group]) map[ch.group] = [];
    map[ch.group].push(ch);
  });

  S.groups = Object.keys(map);

  S.rows = S.groups.map(g => ({
    title: g,
    items: map[g]
  }));

  S.flat = S.channels;
}

/* VIRTUAL RENDER */
function renderWindow() {

  const start = S.visibleStart;
  const end = Math.min(start + S.VISIBLE_ROWS, S.rows.length);

  const frag = document.createDocumentFragment();

  for (let r = start; r < end; r++) {

    const row = S.rows[r];

    const rowEl = div("row");

    const title = div("row-title", row.title);

    const items = div("row-items");

    row.items.forEach((ch, c) => {

      const card = div("card");
      card._r = r;
      card._c = c;

      if (ch.logo) {
        const img = new Image();
        img.src = ch.logo;
        img.loading = "lazy";
        card.appendChild(img);
      } else {
        card.textContent = ch.name;
      }

      items.appendChild(card);
    });

    rowEl.appendChild(title);
    rowEl.appendChild(items);
    frag.appendChild(rowEl);
  }

  S.dom.rows.innerHTML = "";
  S.dom.rows.appendChild(frag);
}

/* FOCUS */
function setFocus() {

  document.querySelectorAll(".card.active")
    .forEach(e=>e.classList.remove("active"));

  const vr = S.focusRow - S.visibleStart;

  const rowEl = S.dom.rows.children[vr];
  if (!rowEl) return;

  const items = rowEl.children[1];
  const el = items.children[S.focusCol];

  if (el) {
    el.classList.add("active");
    el.scrollIntoView({block:"center", inline:"center"});
  }
}

/* PLAYER */
function play(index) {

  const ch = S.flat[index];
  if (!ch || !S.player) return;

  S.currentIndex = index;
  showOverlay(ch.name);

  try {
    S.player.stop();
    S.player.close();
  } catch(e){}

  try {
    S.player.open(ch.url);

    S.player.setDisplayRect(0,0,1920,1080);
    S.player.setStreamingProperty("BUFFERING_TIME", CONFIG.BUFFER);

    S.player.prepareAsync(
      ()=> S.player.play(),
      e=>console.log("AVPlay error", e)
    );

  } catch(e){}
}

/* ZAP */
function zap(dir) {
  let i = S.currentIndex + dir;

  if (i < 0) i = S.flat.length - 1;
  if (i >= S.flat.length) i = 0;

  play(i);
}

/* OVERLAY */
let t;
function showOverlay(txt) {
  const o = S.dom.overlay;
  o.textContent = txt;
  o.style.opacity = 1;

  clearTimeout(t);
  t = setTimeout(()=>o.style.opacity=0,2000);
}

/* INPUT */
let last = 0;

function onKey(e) {

  const now = Date.now();
  if (now - last < 70) return;
  last = now;

  switch(e.key) {

    case "ArrowDown":
      S.focusRow++;
      S.focusCol = 0;
      break;

    case "ArrowUp":
      S.focusRow--;
      S.focusCol = 0;
      break;

    case "ArrowRight":
      S.focusCol++;
      break;

    case "ArrowLeft":
      S.focusCol--;
      break;

    case "Enter":
      const row = S.rows[S.focusRow];
      const ch = row.items[S.focusCol];
      play(S.flat.indexOf(ch));
      return;

    case "ChannelUp":
      zap(1);
      return;

    case "ChannelDown":
      zap(-1);
      return;
  }

  clamp();
  adjustWindow();
  setFocus();
}

/* WINDOW SHIFT */
function adjustWindow() {

  if (S.focusRow < S.visibleStart) {
    S.visibleStart = S.focusRow;
    renderWindow();
  }

  if (S.focusRow >= S.visibleStart + S.VISIBLE_ROWS) {
    S.visibleStart = S.focusRow - S.VISIBLE_ROWS + 1;
    renderWindow();
  }
}

/* HELPERS */
function clamp() {
  S.focusRow = Math.max(0, Math.min(S.focusRow, S.rows.length - 1));

  const maxCol = S.rows[S.focusRow].items.length - 1;
  S.focusCol = Math.max(0, Math.min(S.focusCol, maxCol));
}

function div(cls, txt) {
  const d = document.createElement("div");
  if (cls) d.className = cls;
  if (txt) d.textContent = txt;
  return d;
}

/* START */
window.addEventListener("keydown", onKey);

return { init };

})();

App.init();