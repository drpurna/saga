module.exports = {
  name: "iptv",
  async start(ctx) {
    ctx.openApp({
      url: ctx.modulePath + "/app/index.html",
      fullscreen: true,
    });
  },
};
