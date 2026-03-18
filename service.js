module.exports = {

  name: "Tizen TV",

  async start(ctx){

    // ---------- SAFE STORAGE (SERVICE SIDE) ----------
    const storage = {
      get(key, fallback = null) {
        try {
          const v = localStorage.getItem(key);
          return v ? JSON.parse(v) : fallback;
        } catch (e) {
          return fallback;
        }
      },
      set(key, value) {
        try {
          localStorage.setItem(key, JSON.stringify(value));
        } catch (e) {}
      }
    };

    // ---------- DEFAULT CONFIG ----------
    const DEFAULT_PLAYLIST = "https://iptv-org.github.io/iptv/languages/tel.m3u";

    // Load saved data
    const playlist = storage.get("playlist_url", DEFAULT_PLAYLIST);
    const lastChannel = storage.get("last_channel", null);
    const lastPosition = storage.get("last_position", 0);

    // ---------- APP LAUNCH ----------
    ctx.openApp({
      url: ctx.modulePath + "/app/index.html",
      fullscreen: true,
      data: {
        playlist,
        lastChannel,
        lastPosition,
        launchedAt: Date.now()
      }
    });

    // ---------- OPTIONAL HOOKS ----------
    ctx.on?.("appExit", () => {
      // future: analytics / cleanup
      console.log("App closed");
    });

    ctx.on?.("appError", (err) => {
      console.error("App error:", err);
    });

  }

}
