module.exports = {
  name: "Smart TV",
  async start(ctx) {
    // Load the app from GitHub Pages with cache‑busting
    const url = "https://drpurna.github.io/tizentv/app/index.html?v=" + Date.now();
    ctx.openApp({
      url: url,
      fullscreen: true
    });
  }
};