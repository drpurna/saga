let channels = [];
let categories = {};
let currentFocus = null;

const videoContainer = document.getElementById("video");
const ui = document.getElementById("ui");

// ===================== LOAD =====================
async function loadChannels() {
  ui.innerHTML = "Loading channels...";

  let text = "";

  try {
    const res = await fetch(
      "https://corsproxy.io/?https://iptv-org.github.io/iptv/languages/tel.m3u"
    );
    text = await res.text();
  } catch (e) {
    console.log("Fetch failed, fallback used");
  }

  if (text) {
    channels = parseM3U(text);
  }

  if (!channels.length) {
    channels = [
      {
        name: "Test Stream",
        group: "Test",
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8"
      }
    ];
  }

  buildCategories();
  render();
}

// ===================== PARSE =====================
function parseM3U(text) {
  const lines = text.split("\n");
  const res = [];

  let name = "", group = "Other";

  for (let line of lines) {
    if (line.startsWith("#EXTINF")) {
      name = line.split(",").pop();

      const g = line.match(/group-title="(.*?)"/);
      group = g ? g[1] : "Other";
    } 
    else if (line.startsWith("http")) {
      res.push({ name, group, url: line.trim() });
    }
  }

  return res.slice(0, 100);
}

// ===================== CATEGORY =====================
function buildCategories() {
  categories = {};

  channels.forEach(ch => {
    if (!categories[ch.group]) {
      categories[ch.group] = [];
    }
    categories[ch.group].push(ch);
  });
}

// ===================== RENDER =====================
function render() {
  ui.innerHTML = "";

  Object.keys(categories).forEach(group => {
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
      card.innerText = ch.name;

      card.onclick = () => play(ch);

      card.onfocus = () => {
        currentFocus = card;
      };

      items.appendChild(card);
    });

    row.appendChild(title);
    row.appendChild(items);
    ui.appendChild(row);
  });

  // Auto focus first card
  setTimeout(() => {
    const first = document.querySelector(".card");
    if (first) first.focus();
  }, 300);
}

// ===================== PLAY =====================
function play(ch) {
  console.log("Playing:", ch.name);

  ui.style.display = "none";

  if (window.webapis && webapis.avplay) {
    playAV(ch.url);
  } else {
    playHTML5(ch.url);
  }
}

// ===================== AVPLAY =====================
function playAV(url) {
  try {
    webapis.avplay.stop();
    webapis.avplay.close();
  } catch (e) {}

  try {
    webapis.avplay.open(url);
    webapis.avplay.prepareAsync(() => {
      webapis.avplay.play();
    });
  } catch (e) {
    console.log("AVPlay failed, fallback");
    playHTML5(url);
  }
}

// ===================== HTML5 =====================
function playHTML5(url) {
  videoContainer.innerHTML = "";

  const video = document.createElement("video");
  video.src = url;
  video.autoplay = true;
  video.controls = true;

  video.style.width = "100%";
  video.style.height = "100%";

  video.onerror = () => {
    alert("Stream not supported");
  };

  videoContainer.appendChild(video);
}

// ===================== REMOTE =====================
document.addEventListener("keydown", e => {

  if (e.key === "Enter" && currentFocus) {
    currentFocus.click();
  }

  if (e.key === "Escape") {
    ui.style.display = "block";
    videoContainer.innerHTML = "";
  }

});

// ===================== INIT =====================
loadChannels();