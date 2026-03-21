module.exports = {
  name: 'iptv',
  version: '1.0.2',
  description: 'Premium IPTV player with HLS.js for TizenBrew — Samsung TV 2K/4K',
  
  async start(ctx) {
    const currentVersion = this.version;
    const storedVersion = await ctx.getStorage('cachedVersion');
    const timestamp = Date.now();
    
    const isNewVersion = storedVersion !== currentVersion;
    
    if (isNewVersion) {
      console.log(`🔄 New version detected: ${storedVersion} → ${currentVersion}`);
      await ctx.clearAppCache();
      await ctx.setStorage('cachedVersion', currentVersion);
      await ctx.setStorage('lastUpdate', timestamp);
      await ctx.setStorage('forceReload', true);
      console.log('✅ Cache cleared for new version');
    } else {
      console.log(`✅ Using cached version v${currentVersion}`);
    }
    
    ctx.openApp({
      url: `${ctx.modulePath}/app/index.html?v=${currentVersion}`,
      fullscreen: true,
      title: `IPTV Player v${currentVersion}`,
      headers: {
        'Cache-Control': 'max-age=86400',
        'Pragma': 'cache'
      }
    });
    
    if (await ctx.getStorage('forceReload')) {
      await ctx.setStorage('forceReload', false);
    }
  },

  async load(ctx) {
    const currentVersion = this.version;
    const storedVersion = await ctx.getStorage('cachedVersion');
    
    console.log(`📦 Loading IPTV v${currentVersion}`);
    
    if (storedVersion !== currentVersion) {
      console.log(`✨ Update available: ${storedVersion || 'none'} → ${currentVersion}`);
      await ctx.setStorage('cachedVersion', currentVersion);
      await ctx.setStorage('pendingUpdate', true);
    }
  },

  async update(ctx) {
    console.log(`🔄 Updating IPTV: ${ctx.oldVersion || 'unknown'} → ${this.version}`);
    await ctx.setStorage('cachedVersion', this.version);
    await ctx.setStorage('pendingUpdate', true);
    await ctx.setStorage('lastUpdate', Date.now());
    console.log('✅ Update prepared');
  },

  async uninstall(ctx) {
    console.log('🗑️ Uninstalling IPTV...');
    await ctx.clearStorage();
    await ctx.clearAppCache();
    console.log('✅ IPTV uninstalled');
  },

  async stop(ctx) {
    console.log('⏹️ IPTV app stopped');
  }
};
