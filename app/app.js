const video = document.getElementById('video');
const rowsContainer = document.getElementById('rowsContainer');
const nowPlayingEl = document.getElementById('nowPlaying');
const statusTextEl = document.getElementById('statusText');

const searchIcon = document.getElementById('searchIcon');
const searchOverlay = document.getElementById('searchOverlay');
const searchInput = document.getElementById('searchInput');
const searchResults = document.getElementById('searchResults');

let channels = [];
let rows = {};
let rowKeys = [];

let focus = { row: 0, col: 0 };
let focusArea = "rows";

const PLAYLIST = "https://iptv-org.github.io/iptv/languages/tel.m3u";

async function init() {
  const text = await fetch(PLAYLIST).then(r => r.text());
  channels = parseM3U(text);
  buildRows();
  renderRows();
  updateFocus();
}

function parseM3U(text) {
  const lines = text.split(/\n/);
  const out = [];
  let meta = {};

  for (let line of lines) {
    line = line.trim();
    if (!line) continue;

    if (line.startsWith("#EXTINF")) {
      meta.name = line.split(",").pop();
      const g = line.match(/group-title="([^"]+)"/);
      const l = line.match(/tvg-logo="([^"]+)"/);
      meta.group = g ? g[1] : "Other";
      meta.logo = l ? l[1] : null;
    } else if (!line.startsWith("#")) {
      out.push({ ...meta, url: line });
    }
  }
  return out;
}

function buildRows() {
  rows = {};
  channels.forEach(ch => {
    if (!rows[ch.group]) rows[ch.group] = [];
    rows[ch.group].push(ch);
  });
  rowKeys = Object.keys(rows);
}

function renderRows() {
  rowsContainer.innerHTML = "";

  rowKeys.forEach((key, r) => {
    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = key;

    const items = document.createElement("div");
    items.className = "row-items";

    rows[key].forEach((ch, c) => {
      const card = document.createElement("div");
      card.className = "card";
      card.dataset.r = r;
      card.dataset.c = c;
      card.dataset.name = ch.name;

      if (ch.logo) {
        const img = document.createElement("img");
        img.src = ch.logo;
        img.onerror = () => img.remove();
        card.appendChild(img);
      }

      items.appendChild(card);
    });

    row.appendChild(title);
    row.appendChild(items);
    rowsContainer.appendChild(row);
  });
}

function updateFocus() {
  document.querySelectorAll(".card").forEach(el => el.classList.remove("active"));
  searchIcon.classList.remove("active");

  if (focusArea === "rows") {
    const el = document.querySelector(`[data-r="${focus.row}"][data-c="${focus.col}"]`);
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
  }

  if (focusArea === "search") {
    searchIcon.classList.add("active");
  }
}

function play() {
  const ch = rows[rowKeys[focus.row]][focus.col];
  if (!ch) return;

  nowPlayingEl.textContent = ch.name;
  statusTextEl.textContent = "Playing";

  if (window.Hls && ch.url.includes(".m3u8")) {
    const hls = new Hls();
    hls.loadSource(ch.url);
    hls.attachMedia(video);
    hls.on(Hls.Events.MANIFEST_PARSED, () => video.play());
  } else {
    video.src = ch.url;
    video.play();
  }
}

/* 🔍 Search */
searchIcon.onclick = () => {
  focusArea = "overlay";
  searchOverlay.classList.remove("hidden");
  searchInput.focus();
};

searchInput.oninput = () => {
  const q = searchInput.value.toLowerCase();
  const results = channels.filter(c => c.name.toLowerCase().includes(q));

  searchResults.innerHTML = results.map(c => `
    <div class="card">
      ${c.logo ? `<img src="${c.logo}">` : ""}
    </div>
  `).join('');
};

/* 🎮 Remote */
window.addEventListener("keydown", e => {

  if (focusArea === "overlay") {
    if (e.key === "Backspace" || e.key === "Escape") {
      searchOverlay.classList.add("hidden");
      focusArea = "rows";
      updateFocus();
    }
    return;
  }

  if (e.key === "ArrowUp" && focus.row === 0) {
    focusArea = "search";
    updateFocus();
    return;
  }

  if (focusArea === "search") {
    if (e.key === "Enter") {
      searchOverlay.classList.remove("hidden");
      focusArea = "overlay";
      searchInput.focus();
    }
    if (e.key === "ArrowDown") {
      focusArea = "rows";
      updateFocus();
    }
    return;
  }

  switch (e.key) {
    case "ArrowRight": focus.col++; break;
    case "ArrowLeft": focus.col--; break;
    case "ArrowDown": focus.row++; focus.col = 0; break;
    case "ArrowUp": focus.row--; focus.col = 0; break;
    case "Enter": play(); break;
  }

  focus.row = Math.max(0, Math.min(focus.row, rowKeys.length - 1));
  const maxCol = rows[rowKeys[focus.row]].length - 1;
  focus.col = Math.max(0, Math.min(focus.col, maxCol));

  updateFocus();
});

init();