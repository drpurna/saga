let channels = [];
let grouped = {};
let focusEl = null;
let current = { row: 0, col: 0 };
let player, video;

/* ---------- ERROR DEBUG ---------- */
window.onerror = function(msg, url, line) {
  document.body.innerHTML = `
    <div style="color:red;padding:20px">
      ERROR: ${msg}<br>Line: ${line}
    </div>
  `;
};

/* ---------- LOAD CHANNELS (SAFE) ---------- */
async function loadChannels() {
  const cached = localStorage.getItem("channels");

  if (cached) return JSON.parse(cached);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(
      "https://iptv-org.github.io/iptv/languages/telugu.m3u",
      { signal: controller.signal }
    );

    clearTimeout(timeout);

    const text = await res.text();

    const parsed = text.split("#EXTINF").slice(1).map(e => ({
      name: e.match(/,(.*)/)?.[1],
      logo: e.match(/tvg-logo="(.*?)"/)?.[1],
      url: e.split("\n")[1],
      group: e.match(/group-title="(.*?)"/)?.[1] || "Other"
    }));

    localStorage.setItem("channels", JSON.stringify(parsed));

    return parsed;

  } catch (err) {
    console.log("Using fallback channels");

    return [
      {
        name: "Test Stream",
        logo: "https://via.placeholder.com/300x200",
        url: "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8",
        group: "Demo"
      }
    ];
  }
}

/* ---------- GROUP ---------- */
function groupChannels(list) {
  return {
    Live: list
  };
}

/* ---------- BUILD UI ONCE ---------- */
function buildUI() {
  const app = document.getElementById("app");

  Object.keys(grouped).forEach((key, r) => {
    const row = document.createElement("div");
    row.className = "row";

    const title = document.createElement("h2");
    title.innerText = key;

    const scroll = document.createElement("div");
    scroll.className = "row-scroll";

    grouped[key].forEach((c, i) => {
      const tile = document.createElement("div");
      tile.className = "tile";
      tile.dataset.row = r;
      tile.dataset.col = i;
      tile.dataset.url = c.url;

      tile.innerHTML = `
        <img src="${c.logo}">
        <p>${c.name}</p>
      `;

      scroll.appendChild(tile);
    });

    row.appendChild(title);
    row.appendChild(scroll);
    app.appendChild(row);
  });

  setFocus(document.querySelector(".tile"));
}

/* ---------- FOCUS ENGINE ---------- */
function setFocus(el) {
  if (!el) return;

  if (focusEl) focusEl.classList.remove("active");

  el.classList.add("active");
  focusEl = el;

  el.scrollIntoView({
    behavior: "smooth",
    block: "center",
    inline: "center"
  });
}

/* ---------- NAVIGATION ---------- */
function moveFocus(dir) {
  let r = current.row;
  let c = current.col;

  if (dir === "right") c++;
  if (dir === "left") c--;
  if (dir === "down") { r++; c = 0; }
  if (dir === "up") { r--; c = 0; }

  const next = document.querySelector(
    `.tile[data-row="${r}"][data-col="${c}"]`
  );

  if (next) {
    current = { row: r, col: c };
    setFocus(next);
  }
}

/* ---------- PLAYER ---------- */
function initPlayer() {
  video = document.createElement("video");
  video.style.width = "100%";
  video.style.height = "100%";

  document.body.innerHTML = "";
  document.body.appendChild(video);

  player = new shaka.Player(video);
}

async function play(url) {
  if (!player) initPlayer();

  try {
    await player.load(url);
  } catch {
    video.src = url;
  }
}

/* ---------- PRELOAD ---------- */
function preload(channels) {
  channels.slice(0, 2).forEach(c => {
    const v = document.createElement("video");
    v.src = c.url;
    v.preload = "auto";
  });
}

/* ---------- REMOTE ---------- */
window.addEventListener("keydown", (e) => {
  switch (e.keyCode) {
    case 39: moveFocus("right"); break;
    case 37: moveFocus("left"); break;
    case 40: moveFocus("down"); break;
    case 38: moveFocus("up"); break;
    case 13: play(focusEl.dataset.url); break;
  }
});

/* ---------- INIT ---------- */
(async function init() {
  try {
    channels = await loadChannels();
    grouped = groupChannels(channels);

    buildUI();
    preload(channels);

  } catch (e) {
    console.log("Init error", e);
  }

  // NEVER BLOCK SPLASH
  setTimeout(() => {
    const splash = document.getElementById("splash");
    if (splash) {
      splash.style.opacity = "0";
      setTimeout(() => splash.remove(), 500);
    }
  }, 1500);
})();
