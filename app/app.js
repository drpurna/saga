// 🔴 ERROR HANDLER (no more silent crash)
window.onerror = function(msg, url, line) {
  document.body.innerHTML =
    "<pre style='color:red'>" + msg + " at line " + line + "</pre>";
};

const PLAYLIST = "https://iptv-org.github.io/iptv/languages/tel.m3u";

let video, player;
let channels = [];

// INIT
window.onload = () => {
  setupUI();      // ✅ ALWAYS render UI first
  loadChannels(); // then load data
};

// CREATE VIDEO ELEMENT
function setupUI() {

  const videoBox = document.getElementById("video");
  const grid = document.getElementById("grid");

  // Video
  video = document.createElement("video");
  video.style.width = "100%";
  video.style.height = "100%";
  video.autoplay = true;
  videoBox.appendChild(video);

  // Initial message
  grid.innerHTML = "<h2>Loading channels...</h2>";

  // AVPlay safe init
  try {
    if (window.webapis && webapis.avplay) {
      player = webapis.avplay;
    }
  } catch {}
}

// LOAD PLAYLIST
async function loadChannels() {

  let text = "";

  try {
    const res = await fetch(PLAYLIST);
    text = await res.text();
  } catch (e) {
    document.getElementById("grid").innerHTML =
      "<h2>Failed to load playlist</h2>";
    return;
  }

  channels = parse(text);

  if (!channels.length) {
    document.getElementById("grid").innerHTML =
      "<h2>No channels found</h2>";
    return;
  }

  render();
}

// PARSE M3U
function parse(txt) {
  const lines = txt.split("\n");
  let res = [], meta = {};

  for (let l of lines) {
    l = l.trim();

    if (l.startsWith("#EXTINF")) {
      meta.name = l.split(",").pop();
    }
    else if (l && !l.startsWith("#")) {
      res.push({ ...meta, url: l });
    }
  }

  return res.slice(0, 30); // keep small
}

// RENDER UI
function render() {

  const grid = document.getElementById("grid");
  grid.innerHTML = "";

  channels.forEach((ch) => {

    const card = document.createElement("div");
    card.className = "card";
    card.textContent = ch.name;

    // ✅ CLICK WORKS GUARANTEED
    card.onclick = () => {
      play(ch.url);
    };

    grid.appendChild(card);
  });
}

// PLAY ENGINE
function play(url) {

  console.log("PLAY:", url);

  document.body.classList.add("fullscreen");

  // AVPlay for HLS
  if (url.includes(".m3u8") && player) {

    try {
      player.stop();
      player.close();
    } catch {}

    try {
      player.open(url);
      player.setDisplayRect(0, 0, 1920, 1080);

      player.prepareAsync(() => {
        player.play();
      });

      return;

    } catch {
      console.log("AVPlay failed");
    }
  }

  // HTML5 fallback
  video.src = url;
  video.play().catch(() => {
    alert("Stream not supported");
  });
}