/* =========================
   CORE STATE
========================= */
const STATE = {
  channels: [],
  groups: [],
  rows: {},
  flat: [],

  focusRow: 0,
  focusCol: 0,
  currentIndex: 0,

  player: null,
  playing: false
};

const PLAYLIST = "https://iptv-org.github.io/iptv/languages/tel.m3u";

const rowsEl = document.getElementById("rows");
const overlay = document.getElementById("overlay");

/* =========================
   INIT
========================= */
init();

async function init() {
  try {
    STATE.player = webapis.avplay;
  } catch (e) {
    console.log("AVPlay unavailable");
  }

  const text = await fetch(PLAYLIST).then(r => r.text());
  STATE.channels = parseM3U(text);
  build();

  render();
  focus();
}

/* =========================
   PARSER
========================= */
function parseM3U(text) {
  const lines = text.split("\n");
  let result = [];
  let meta = {};

  for (let line of lines) {
    line = line.trim();

    if (line.startsWith("#EXTINF")) {
      meta.name = line.split(",").pop();

      const g = line.match(/group-title="([^"]+)"/);
      const l = line.match(/tvg-logo="([^"]+)"/);

      meta.group = g ? g[1] : "Other";
      meta.logo = l ? l[1] : "";
    }
    else if (line && !line.startsWith("#")) {
      result.push({ ...meta, url: line });
    }
  }
  return result;
}

/* =========================
   DATA BUILD
========================= */
function build() {
  STATE.rows = {};

  STATE.channels.forEach(ch => {
    if (!STATE.rows[ch.group]) STATE.rows[ch.group] = [];
    STATE.rows[ch.group].push(ch);
  });

  STATE.groups = Object.keys(STATE.rows);
  STATE.flat = STATE.channels;
}

/* =========================
   UI RENDER
========================= */
function render() {
  rowsEl.innerHTML = "";

  STATE.groups.forEach((g, r) => {

    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = g;

    const items = document.createElement("div");
    items.className = "row-items";

    STATE.rows[g].forEach((ch, c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.r = r;
      card.dataset.c = c;

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

    row.appendChild(title);
    row.appendChild(items);
    rowsEl.appendChild(row);
  });
}

/* =========================
   FOCUS ENGINE
========================= */
function focus() {
  document.querySelectorAll(".card").forEach(el => el.classList.remove("active"));

  const el = document.querySelector(
    `[data-r="${STATE.focusRow}"][data-c="${STATE.focusCol}"]`
  );

  if (el) {
    el.classList.add("active");
    el.scrollIntoView({ block: "center", inline: "center" });
  }
}

/* =========================
   PLAYER ENGINE (AVPLAY)
========================= */
function play(index) {
  const ch = STATE.flat[index];
  if (!ch || !STATE.player) return;

  STATE.currentIndex = index;

  showOverlay(ch.name);

  try {
    STATE.player.stop();
    STATE.player.close();
  } catch (e) {}

  try {
    STATE.player.open(ch.url);

    STATE.player.setDisplayRect(0, 0, 1920, 1080);
    STATE.player.setStreamingProperty("BUFFERING_TIME", "500");

    STATE.player.prepareAsync(
      () => {
        STATE.player.play();
        STATE.playing = true;
      },
      e => console.log("AVPlay error", e)
    );

  } catch (e) {
    console.log("play error", e);
  }
}

/* =========================
   ZAPPING ENGINE
========================= */
function zap(dir) {
  let i = STATE.currentIndex + dir;

  if (i < 0) i = STATE.flat.length - 1;
  if (i >= STATE.flat.length) i = 0;

  play(i);
}

/* =========================
   OVERLAY
========================= */
let overlayTimer = null;

function showOverlay(name) {
  overlay.textContent = name;
  overlay.style.opacity = 1;

  clearTimeout(overlayTimer);
  overlayTimer = setTimeout(() => {
    overlay.style.opacity = 0;
  }, 3000);
}

/* =========================
   INPUT ENGINE
========================= */
window.addEventListener("keydown", e => {

  switch (e.key) {

    case "ArrowRight":
      STATE.focusCol++;
      break;

    case "ArrowLeft":
      STATE.focusCol--;
      break;

    case "ArrowDown":
      STATE.focusRow++;
      STATE.focusCol = 0;
      break;

    case "ArrowUp":
      STATE.focusRow--;
      STATE.focusCol = 0;
      break;

    case "Enter":
      const ch = STATE.rows[STATE.groups[STATE.focusRow]][STATE.focusCol];
      const idx = STATE.flat.findIndex(c => c.url === ch.url);
      play(idx);
      return;

    case "ChannelUp":
      zap(1);
      return;

    case "ChannelDown":
      zap(-1);
      return;
  }

  /* bounds */
  STATE.focusRow = Math.max(0, Math.min(STATE.focusRow, STATE.groups.length - 1));
  const maxCol = STATE.rows[STATE.groups[STATE.focusRow]].length - 1;
  STATE.focusCol = Math.max(0, Math.min(STATE.focusCol, maxCol));

  focus();
});