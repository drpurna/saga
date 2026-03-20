let channels = [];
let categories = {};
let currentFocus = null;

const videoContainer = document.getElementById("video");
const grid = document.getElementById("grid");
const ui = document.getElementById("ui");
const overlay = document.getElementById("overlay");
const loader = document.getElementById("loader");

// STORAGE
function getPlaylists() {
  return JSON.parse(localStorage.getItem("playlists") || "[]");
}

function savePlaylists(p) {
  localStorage.setItem("playlists", JSON.stringify(p));
}

// LOAD CHANNELS
async function loadChannels() {

  try {
    const res = await fetch("https://iptv-org.github.io/iptv/languages/tel.m3u");
    const text = await res.text();
    channels = parseM3U(text);
  } catch {}

  buildCategories();
  render();
}

// PARSE
function parseM3U(text) {
  const lines = text.split("\n");
  const result = [];

  let name="", group="Other", logo="";

  for (let line of lines) {

    if (line.startsWith("#EXTINF")) {
      name = line.split(",").pop();

      const g = line.match(/group-title="(.*?)"/);
      group = g ? g[1] : "Other";

      const l = line.match(/tvg-logo="(.*?)"/);
      logo = l ? l[1] : "";
    }

    else if (line.startsWith("http")) {
      result.push({ name, group, logo, url: line.trim() });
    }
  }

  return result.slice(0,200);
}

// CATEGORY
function buildCategories() {

  categories = {
    Devotional: [],
    News: [],
    Movies: [],
    Sports: [],
    Entertainment: [],
    "My Channels": [],
    Others: []
  };

  channels.forEach(ch => {

    const n = ch.name.toLowerCase();

    if (n.includes("bhakti") || n.includes("devotional")) categories.Devotional.push(ch);
    else if (n.includes("news")) categories.News.push(ch);
    else if (n.includes("movie")) categories.Movies.push(ch);
    else if (n.includes("sport")) categories.Sports.push(ch);
    else if (n.includes("tv")) categories.Entertainment.push(ch);
    else categories.Others.push(ch);
  });

  let manual = [];
  getPlaylists().forEach(p => manual = manual.concat(p.channels));
  categories["My Channels"] = manual;
}

// RENDER
function render() {

  grid.innerHTML = "";

  Object.keys(categories).forEach(group => {

    if (!categories[group].length) return;

    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("div");
    title.className = "row-title";
    title.innerText = group;

    const items = document.createElement("div");
    items.className = "row-items";

    categories[group].forEach(ch => {

      const card = document.createElement("div");
      card.className = "card";
      card.tabIndex = 0;

      if (ch.logo) {
        const img = document.createElement("img");
        img.src = ch.logo;
        img.onerror = () => card.innerText = ch.name;
        card.appendChild(img);
      } else {
        card.innerText = ch.name;
      }

      card.onclick = () => play(ch);

      card.addEventListener("focus", () => {
        currentFocus = card;
        card.scrollIntoView({ behavior:"smooth", inline:"center" });
      });

      items.appendChild(card);
    });

    row.appendChild(title);
    row.appendChild(items);
    grid.appendChild(row);
  });

  setTimeout(()=>document.querySelector(".card")?.focus(),200);
}

// PLAY
function play(ch) {

  overlay.innerText = ch.name;
  overlay.style.opacity = 1;
  setTimeout(()=>overlay.style.opacity=0,3000);

  ui.style.display = "none";
  loader.style.display = "block";

  videoContainer.innerHTML = "";

  const video = document.createElement("video");
  video.src = ch.url;
  video.autoplay = true;
  video.controls = true;

  video.style.width = "100%";
  video.style.height = "100%";

  video.onplaying = () => loader.style.display = "none";
  video.onerror = () => loader.style.display = "none";

  videoContainer.appendChild(video);
}

// ADD PLAYLIST
document.getElementById("addPlaylistBtn").onclick = addPlaylist;

function addPlaylist() {

  const url = prompt("Enter M3U URL");
  if (!url) return;

  loader.style.display = "block";

  fetch(url)
    .then(r => r.text())
    .then(text => {

      const parsed = parseM3U(text);

      let p = getPlaylists();
      p.push({ name: url, url, channels: parsed });

      savePlaylists(p);

      loader.style.display = "none";

      buildCategories();
      render();
    })
    .catch(()=> loader.style.display="none");
}

// SETTINGS
const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const playlistList = document.getElementById("playlistList");

settingsBtn.onclick = openSettings;

function openSettings() {

  settingsPanel.classList.add("active");

  const playlists = getPlaylists();
  playlistList.innerHTML = "";

  playlists.forEach((p,i)=>{

    const item = document.createElement("div");
    item.className = "settings-item";

    item.innerHTML = `<span>${p.name}</span>
      <button onclick="removePlaylist(${i})">Remove</button>`;

    playlistList.appendChild(item);
  });
}

function removePlaylist(i) {
  let p = getPlaylists();
  p.splice(i,1);
  savePlaylists(p);
  openSettings();
  buildCategories();
  render();
}

// REMOTE
document.addEventListener("keydown", e => {

  if (settingsPanel.classList.contains("active")) {
    if (e.key==="Return"||e.key==="Escape") {
      settingsPanel.classList.remove("active");
    }
    return;
  }

  const f = document.activeElement;

  if (e.key==="Enter" && currentFocus) currentFocus.click();

  if (e.key==="Escape"||e.key==="Return") {
    ui.style.display="block";
    videoContainer.innerHTML="";
  }

  if (e.key==="ColorF0Red") addPlaylist();

  if (!f.classList.contains("card")) return;

  if (e.key==="ArrowRight") f.nextElementSibling?.focus();
  if (e.key==="ArrowLeft") f.previousElementSibling?.focus();

  if (e.key==="ArrowDown")
    f.closest(".row")?.nextElementSibling?.querySelector(".card")?.focus();

  if (e.key==="ArrowUp")
    f.closest(".row")?.previousElementSibling?.querySelector(".card")?.focus();

});

// INIT
loadChannels();