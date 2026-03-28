// xtream.js – combined non‑module Xtream classes

// ==================== XtreamCache ====================
class XtreamCache {
  constructor(defaultTTL = 300000) {
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }
  set(key, value, ttl = null) {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expiry });
  }
  delete(key) { this.cache.delete(key); }
  clear() { this.cache.clear(); }
  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }
  async getOrSet(key, fetcher, ttl = null) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    const value = await fetcher();
    this.set(key, value, ttl);
    return value;
  }
}

// ==================== XtreamAuth ====================
class XtreamAuth {
  constructor() {
    this.cache = new XtreamCache(3600000);
    this.currentConfig = null;
    this.userInfo = null;
  }
  storeCredentials(config) {
    try {
      localStorage.setItem('xtream:server', config.serverUrl);
      localStorage.setItem('xtream:username', config.username);
      localStorage.setItem('xtream:password', config.password);
      this.currentConfig = config;
    } catch (e) {
      console.warn('[XtreamAuth] Failed to store credentials:', e);
    }
  }
  loadCredentials() {
    try {
      const serverUrl = localStorage.getItem('xtream:server');
      const username = localStorage.getItem('xtream:username');
      const password = localStorage.getItem('xtream:password');
      if (serverUrl && username && password) {
        this.currentConfig = { serverUrl, username, password };
        return this.currentConfig;
      }
    } catch (e) {
      console.warn('[XtreamAuth] Failed to load credentials:', e);
    }
    return null;
  }
  clearCredentials() {
    try {
      localStorage.removeItem('xtream:server');
      localStorage.removeItem('xtream:username');
      localStorage.removeItem('xtream:password');
      this.currentConfig = null;
      this.userInfo = null;
      this.cache.clear();
    } catch (e) {
      console.warn('[XtreamAuth] Failed to clear credentials:', e);
    }
  }
  isAuthenticated() { return this.userInfo !== null && this.userInfo.auth === 1; }
  getUserInfo() { return this.userInfo; }
  setUserInfo(info) { this.userInfo = info; }
  getExpiryDate() {
    if (!this.userInfo || !this.userInfo.exp_date) return null;
    return new Date(parseInt(this.userInfo.exp_date, 10) * 1000);
  }
  isExpired() {
    const expiry = this.getExpiryDate();
    if (!expiry) return false;
    return expiry < new Date();
  }
  getDaysRemaining() {
    const expiry = this.getExpiryDate();
    if (!expiry) return null;
    const diff = expiry - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }
  getExpiryMessage() {
    if (!this.userInfo) return '';
    if (this.isExpired()) return 'Account expired';
    const days = this.getDaysRemaining();
    return `Valid for ${days} days`;
  }
}

// ==================== XtreamClient ====================
class XtreamClient {
  constructor(config) {
    this.config = {
      timeout: 30000,
      retryAttempts: 3,
      retryDelay: 1000,
      cacheTTL: 300000,
      ...config
    };
    this.serverUrl = this.config.serverUrl.replace(/\/$/, '');
    this.username = this.config.username;
    this.password = this.config.password;
    this.apiPath = '/player_api.php';
    this.cache = new XtreamCache(this.config.cacheTTL);
  }
  buildUrl(action, params = {}) {
    const url = new URL(`${this.serverUrl}${this.apiPath}`);
    url.searchParams.set('username', this.username);
    url.searchParams.set('password', this.password);
    url.searchParams.set('action', action);
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        url.searchParams.set(key, String(value));
      }
    });
    return url.toString();
  }
  async fetchWithRetry(url, attempt = 1) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);
    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      const data = await response.json();
      if (data && data.user_info === undefined && data.auth === 0) {
        throw new Error('Invalid credentials');
      }
      return data;
    } catch (error) {
      clearTimeout(timeoutId);
      if (attempt < this.config.retryAttempts) {
        const delay = this.config.retryDelay * Math.pow(2, attempt - 1);
        console.warn(`[Xtream] Retry ${attempt}/${this.config.retryAttempts} after ${delay}ms`);
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.fetchWithRetry(url, attempt + 1);
      }
      throw error;
    }
  }
  async call(action, params = {}, useCache = true) {
    const cacheKey = `${action}:${JSON.stringify(params)}`;
    if (useCache && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }
    const url = this.buildUrl(action, params);
    const data = await this.fetchWithRetry(url);
    this.cache.set(cacheKey, data);
    return data;
  }
  async getUserInfo(useCache = true) { return this.call('get_user_and_server_info', {}, useCache); }
  async getLiveCategories(useCache = true) { return this.call('get_live_categories', {}, useCache); }
  async getLiveStreams(categoryId = null, useCache = true) {
    const params = {};
    if (categoryId !== null && categoryId !== undefined) params.category_id = categoryId;
    return this.call('get_live_streams', params, useCache);
  }
  async getVodCategories(useCache = true) { return this.call('get_vod_categories', {}, useCache); }
  async getVodStreams(categoryId = null, useCache = true) {
    const params = {};
    if (categoryId !== null && categoryId !== undefined) params.category_id = categoryId;
    return this.call('get_vod_streams', params, useCache);
  }
  async getSeriesCategories(useCache = true) { return this.call('get_series_categories', {}, useCache); }
  async getSeries(categoryId = null, useCache = true) {
    const params = {};
    if (categoryId !== null && categoryId !== undefined) params.category_id = categoryId;
    return this.call('get_series', params, useCache);
  }
  async getSeriesInfo(seriesId, useCache = true) {
    return this.call('get_series_info', { series_id: seriesId }, useCache);
  }
  async getShortEpg(streamId, limit = 5, useCache = true) {
    return this.call('get_short_epg', { stream_id: streamId, limit }, useCache);
  }
  getLiveStreamUrl(streamId, extension = 'ts') {
    return `${this.serverUrl}/live/${this.username}/${this.password}/${streamId}.${extension}`;
  }
  getVodStreamUrl(vodId, extension = 'mp4') {
    return `${this.serverUrl}/movie/${this.username}/${this.password}/${vodId}.${extension}`;
  }
  getSeriesStreamUrl(seriesId, episodeId, extension = 'mp4') {
    return `${this.serverUrl}/series/${this.username}/${this.password}/${seriesId}/${episodeId}.${extension}`;
  }
  getM3uPlaylistUrl(type = 'm3u_plus', output = 'ts') {
    return `${this.serverUrl}/get.php?username=${this.username}&password=${this.password}&type=${type}&output=${output}`;
  }
  getXmltvUrl() {
    return `${this.serverUrl}/xmltv.php?username=${this.username}&password=${this.password}`;
  }
  clearCache() { this.cache.clear(); }
  invalidateCache(action, params = {}) {
    const cacheKey = `${action}:${JSON.stringify(params)}`;
    this.cache.delete(cacheKey);
  }
}

// Attach to global scope
window.XtreamCache = XtreamCache;
window.XtreamAuth = XtreamAuth;
window.XtreamClient = XtreamClient;
