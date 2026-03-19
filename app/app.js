const grid = document.getElementById("grid");
const loader = document.getElementById("loader");
const player = document.getElementById("playerContainer");

let channels = [];
let categories = {};
let flatChannels = [];

const PLAYLISTS = [
  { name: "Telugu", url: "https://iptv-org.github.io/iptv/languages/tel.m3u" },
  { name: "India", url: "https://iptv-org.github.io/iptv/countries/in.m3u" }
];

const cache = {};

/* INIT */
renderPlaylists();
setTimeout(() => document.querySelector(".playlist-btn")?.click(), 300);

/* PLAYLIST BAR */
function renderPlaylists() {
  const bar = document.getElementById("playlistBar");
  bar.innerHTML = "";

  PLAYLISTS.forEach(p => {
    const btn = document.createElement("div");
    btn.className = "playlist-btn";
    btn.innerText = p.name;
    btn.tabIndex = 0;

    btn.onclick = () => loadPlaylist(p, btn);

    bar.appendChild(btn);
  });
}

/* LOAD PLAYLIST */
async function loadPlaylist(p, btn) {

  loader.style.display = "block";
  grid.innerHTML = "";

  document.querySelectorAll(".playlist-btn")
    .forEach(b => b.classList.remove("active"));
  btn.classList.add("active");

  if (cache[p.url]) {
    channels = cache[p.url];
    finish();
    return;
  }

  try {
    const res = await fetch(p.url);
    const text = await res.text();

    channels = parseM3U(text);
    cache[p.url] = channels;

    finish();

  } catch (e) {
    alert("Playlist failed");
  }
}

/* PARSER */
function parseM3U(data) {

  const lines = data.split("\n");
  const result = [];
  let ch = {};

  lines.forEach(line => {

    if (line.startsWith("#EXTINF")) {

      const name = line.split(",")[1];
      const logo = (line.match(/tvg-logo="(.*?)"/) || [])[1] || "";
      const group = (line.match(/group-title="(.*?)"/) || [])[1] || "Other";

      ch = { name, logo, group };

    } else if (line.startsWith("http")) {

      ch.url = line.trim();

      if (ch.url.includes(".m3u8")) {
        result.push(ch);
      }

      ch = {};
    }
  });

  return result.slice(0, 500);
}

/* BUILD CATEGORY */
function buildCategories() {

  categories = {};
  flatChannels = [];

  channels.forEach(ch => {

    let cat = ch.group || "Other";

    if (cat.toLowerCase().includes("religion"))
      cat = "Devotional";

    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(ch);

    flatChannels.push(ch);
  });
}

/* RENDER */
function render() {

  grid.innerHTML = "";

  Object.keys(categories).forEach(cat => {

    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "row-title";
    title.innerText = cat;

    const items = document.createElement("div");
    items.className = "row-items";

    categories[cat].forEach((ch, index) => {

      const globalIndex = flatChannels.indexOf(ch);

      const card = document.createElement("div");
      card.className = "card";
      card.tabIndex = 0;

      const img = document.createElement("img");
      img.src = ch.logo || "https://via.placeholder.com/300x150?text=TV";
      img.onerror = () => img.src = "https://via.placeholder.com/300x150?text=TV";

      card.appendChild(img);

      card.onclick = () => play(ch.url, globalIndex);

      items.appendChild(card);
    });

    row.appendChild(title);
    row.appendChild(items);
    grid.appendChild(row);
  });
}

/* FINISH */
function finish() {
  buildCategories();
  render();
  loader.style.display = "none";
}

/* PLAY ENGINE WITH AUTO-SKIP */
function play(url, index = 0) {

  if (!url) return;

  player.style.display = "block";
  loader.style.display = "block";

  try {
    webapis.avplay.stop();
    webapis.avplay.close();
  } catch(e) {}

  try {
    webapis.avplay.open(url);

    webapis.avplay.setListener({

      onbufferingstart: () => loader.style.display = "block",
      onbufferingcomplete: () => loader.style.display = "none",

      onstreamcompleted: () => playNext(index),

      onerror: () => playNext(index)

    });

    webapis.avplay.prepareAsync(() => {
      webapis.avplay.play();
    });

    // TIMEOUT FAIL SAFE
    setTimeout(() => {
      if (loader.style.display === "block") {
        playNext(index);
      }
    }, 8000);

  } catch (e) {
    playNext(index);
  }
}

/* AUTO SKIP */
function playNext(currentIndex) {

  for (let i = currentIndex + 1; i < flatChannels.length; i++) {

    const next = flatChannels[i];

    if (next && next.url) {
      play(next.url, i);
      return;
    }
  }

  alert("No playable channels");
}

/* REMOTE EXIT */
document.addEventListener("keydown", e => {

  if (e.key === "Return") {

    player.style.display = "none";

    try {
      webapis.avplay.stop();
    } catch(e) {}

  }
});