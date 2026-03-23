module.exports = {
  name: 'iptv',
  version: '1.0.2',
  description: 'Premium IPTV player with HLS.js for TizenBrew — Samsung TV 2K/4K',

  async start(ctx) {
    ctx.openApp({
      url: ctx.modulePath + '/app/index.html',
      fullscreen: true,
      title: 'IPTV Player'
    });
  },

  async stop(ctx) {
    console.log('IPTV stopped');
  }
};