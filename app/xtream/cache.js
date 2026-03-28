// xtream/cache.js
// In-memory cache for API responses

class XtreamCache {
  constructor(defaultTTL = 300000) { // 5 minutes default
    this.cache = new Map();
    this.defaultTTL = defaultTTL;
  }

  /**
   * Get cached value
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null
   */
  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }
    
    return item.value;
  }

  /**
   * Set cached value
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [ttl] - TTL in ms (override default)
   */
  set(key, value, ttl = null) {
    const expiry = Date.now() + (ttl || this.defaultTTL);
    this.cache.set(key, { value, expiry });
  }

  /**
   * Delete cached value
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Check if key exists and not expired
   * @param {string} key - Cache key
   * @returns {boolean}
   */
  has(key) {
    const item = this.cache.get(key);
    if (!item) return false;
    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  /**
   * Get or set with async function
   * @param {string} key - Cache key
   * @param {Function} fetcher - Async function to get value
   * @param {number} [ttl] - TTL in ms
   * @returns {Promise<any>}
   */
  async getOrSet(key, fetcher, ttl = null) {
    const cached = this.get(key);
    if (cached !== null) return cached;
    
    const value = await fetcher();
    this.set(key, value, ttl);
    return value;
  }
}

export default XtreamCache;
