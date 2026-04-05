// ================================================================
// SAGA IPTV — player.js v1.0  |  Shaka Player wrapper
// Fixes: race condition via _loadPromise mutex, _playerBusy timeout,
// HW/SW DRM fallback, seekable check for AV sync, visibilitychange
// lifecycle, audio track API placeholder
// ================================================================
'use strict';

var SagaPlayer = (function () {

  var _shakaPlayer   = null;
  var _videoEl       = null;
  var _loadPromise   = Promise.resolve();  // serialises all load/unload ops
  var _currentUrl    = '';
  var _busyTimeout   = null;
  var BUSY_TIMEOUT_MS = 12000;            // reset if load hangs > 12s

  // External callbacks set by app.js
  var _onStatus      = function () {};
  var _onBuffering   = function () {};
  var _onTechUpdate  = function () {};
  var _onError       = function () {};

  // ── DRM robustness levels ─────────────────────────────────────
  // Tizen 2017+ may not support HW_SECURE_ALL. We try HW first,
  // then fall back to SW_SECURE_CRYPTO automatically.
  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',       audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE',    audio: 'SW_SECURE_CRYPTO' },
  ];

  // ── Shaka config ──────────────────────────────────────────────
  function _baseConfig(bufGoal) {
    return {
      streaming: {
        bufferingGoal: bufGoal || 12,
        rebufferingGoal: 2,
        bufferBehind: 20,
        stallEnabled: true,
        stallThreshold: 1,
        stallSkip: 0.1,
        autoCorrectDrift: true,
        gapDetectionThreshold: 0.5,
        gapPadding: 0.1,
        durationBackoff: 1,
        retryParameters: {
          maxAttempts: 6, baseDelay: 500,
          backoffFactor: 2, fuzzFactor: 0.5, timeout: 30000,
        },
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 500000,
        switchInterval: 8,
        bandwidthUpgradeTarget: 0.85,
        bandwidthDowngradeTarget: 0.95,
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 1000, backoffFactor: 2 },
      },
      drm: {
        retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 15000 },
        advanced: { 'com.widevine.alpha': {
          videoRobustness: DRM_LEVELS[0].video,
          audioRobustness: DRM_LEVELS[0].audio,
        }},
      },
    };
  }

  // ── Init ─────────────────────────────────────────────────────
  async function init(videoElement, callbacks) {
    if (_shakaPlayer) return;
    _videoEl = videoElement;
    if (callbacks) {
      _onStatus     = callbacks.onStatus     || _onStatus;
      _onBuffering  = callbacks.onBuffering  || _onBuffering;
      _onTechUpdate = callbacks.onTechUpdate || _onTechUpdate;
      _onError      = callbacks.onError      || _onError;
    }

    try {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        console.error('[Player] Shaka not supported'); return;
      }
      _shakaPlayer = new shaka.Player(_videoEl);
      _shakaPlayer.configure(_baseConfig());

      _shakaPlayer.addEventListener('error',   _handleError);
      _shakaPlayer.addEventListener('buffering', function (ev) {
        _onBuffering(ev.buffering);
      });
      _shakaPlayer.addEventListener('adaptation',    _onTechUpdate);
      _shakaPlayer.addEventListener('variantchanged', _onTechUpdate);

      // App lifecycle: pause/resume on visibility change
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);

      console.log('[Player] Shaka initialised');
    } catch (e) {
      console.error('[Player] init failed', e);
    }
  }

  // ── Lifecycle ────────────────────────────────────────────────
  function _onVisibilityChange() {
    if (!_shakaPlayer || !_videoEl) return;
    if (document.hidden) {
      // Background: pause but keep Shaka loaded
      _videoEl.pause();
    } else {
      // Foreground: resume if was playing
      if (_currentUrl) _videoEl.play().catch(function () {});
    }
  }
  function _onPageHide() {
    if (_videoEl) _videoEl.pause();
    // Unload to free decoder resources on Tizen suspend
    if (_shakaPlayer) _shakaPlayer.unload().catch(function () {});
  }

  // ── Error handler with DRM fallback ──────────────────────────
  var _drmLevelIdx = 0;

  async function _handleError(ev) {
    var err  = ev && ev.detail;
    var code = err && err.code;
    console.error('[Player] Shaka error', code, err && err.message);

    // DRM error — try next robustness level
    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var level = DRM_LEVELS[_drmLevelIdx];
      console.warn('[Player] DRM fallback → level', _drmLevelIdx, level);
      _shakaPlayer.configure({
        drm: { advanced: { 'com.widevine.alpha': {
          videoRobustness: level.video,
          audioRobustness: level.audio,
        }}},
      });
      // Retry same URL with updated config
      if (_currentUrl) {
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, null); });
        return;
      }
    }

    var msg = (code >= 6000 && code <= 6999) ? 'DRM error'
            : (code >= 7000 && code <= 7999) ? 'Network error' : 'Stream error';
    _onError(msg, code);
  }

  // ── DRM config builder ────────────────────────────────────────
  function _buildDrmConfig(info) {
    if (!info || !info.isDRM) return null;
    var cfg = { servers: {}, advanced: {} };
    var level = DRM_LEVELS[_drmLevelIdx];
    if (info.drm_url) {
      cfg.servers['com.widevine.alpha'] = info.drm_url;
      cfg.advanced['com.widevine.alpha'] = {
        videoRobustness: level.video,
        audioRobustness: level.audio,
      };
    } else if (info.key && info.iv) {
      cfg.servers['org.w3.clearkey'] = '';
      cfg.clearKeys = {};
      cfg.clearKeys[info.key_id || info.kid || info.key] = info.key;
    }
    return Object.keys(cfg.servers).length ? cfg : null;
  }

  // ── Core load (internal, called through mutex) ────────────────
  async function _load(url, streamInfo) {
    if (!_shakaPlayer || !_videoEl) return;
    _currentUrl = url;

    var drmCfg = _buildDrmConfig(streamInfo);
    try {
      await _shakaPlayer.unload();
      _videoEl.removeAttribute('src');

      if (drmCfg) _shakaPlayer.configure({ drm: drmCfg });
      else         _shakaPlayer.configure({ drm: { servers: {} } });

      await _shakaPlayer.load(url);
      await _videoEl.play().catch(function () {});
      _drmLevelIdx = 0;  // reset DRM level on success

    } catch (err) {
      console.warn('[Player] load failed:', err.message);

      // Fallback 1: .ts → .m3u8
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          await _shakaPlayer.unload();
          await _shakaPlayer.load(m3u);
          await _videoEl.play().catch(function () {});
          _currentUrl = m3u; return;
        } catch (e2) {}
      }

      // Fallback 2: native video (non-DRM only)
      if (!drmCfg) {
        try {
          await _shakaPlayer.unload();
          _videoEl.src = url;
          _videoEl.load();
          await _videoEl.play().catch(function () {});
          return;
        } catch (e3) {}
      }

      _onError('Play error', 0);
    }
  }

  // ── Public: play — serialised through _loadPromise mutex ─────
  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    // Cancel busy timeout from previous call
    clearTimeout(_busyTimeout);
    // Chain new load onto the promise — prevents concurrent loads
    _loadPromise = _loadPromise.then(function () {
      return new Promise(function (resolve) {
        // Safety timeout: if load hangs, resolve so next call isn't blocked
        _busyTimeout = setTimeout(function () {
          console.warn('[Player] load timeout — releasing mutex');
          resolve();
        }, BUSY_TIMEOUT_MS);
        _load(url, streamInfo).finally(function () {
          clearTimeout(_busyTimeout);
          resolve();
        });
      });
    });
    return _loadPromise;
  }

  // ── Public: stop/unload ───────────────────────────────────────
  function stop() {
    clearTimeout(_busyTimeout);
    _currentUrl = '';
    _loadPromise = _loadPromise.then(function () {
      if (!_shakaPlayer) return;
      return _shakaPlayer.unload().catch(function () {});
    }).then(function () {
      if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); }
    });
    return _loadPromise;
  }

  // ── Public: adjust buffer for network quality ─────────────────
  function setNetworkQuality(quality) {
    if (!_shakaPlayer) return;
    _shakaPlayer.configure({ streaming: {
      bufferingGoal:   quality === 'slow' ? 5  : 12,
      rebufferingGoal: quality === 'slow' ? 1  : 2,
    }});
  }

  // ── Public: tech info ─────────────────────────────────────────
  function getTechInfo() {
    if (!_shakaPlayer) return '';
    try {
      var tr    = _shakaPlayer.getVariantTracks ? _shakaPlayer.getVariantTracks() : [];
      var vt    = tr.find(function (t) { return t.active; });
      var s     = _shakaPlayer.getStats ? _shakaPlayer.getStats() : null;
      var parts = [];
      if (vt && vt.width && vt.height) parts.push(vt.width + '×' + vt.height);
      if (s  && s.streamBandwidth)     parts.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      if (vt && vt.frameRate)          parts.push(Math.round(vt.frameRate) + ' fps');
      if (vt && vt.videoCodec)         parts.push(vt.videoCodec);
      return parts.join(' · ');
    } catch (e) { return ''; }
  }

  // ── Public: audio tracks ──────────────────────────────────────
  function getAudioTracks() {
    if (!_shakaPlayer || !_shakaPlayer.getAudioLanguagesAndRoles) return [];
    try { return _shakaPlayer.getAudioLanguagesAndRoles(); } catch (e) { return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_shakaPlayer) return;
    try { _shakaPlayer.selectAudioLanguage(lang, role); } catch (e) {}
  }

  // ── Public: AV sync helper ────────────────────────────────────
  // Returns true if video is seekable (not a pure live non-DVR stream)
  function isSeekable(videoEl) {
    try {
      var r = videoEl && videoEl.seekable;
      return r && r.length > 0 && (r.end(0) - r.start(0)) > 2;
    } catch (e) { return false; }
  }

  // ── Public: getters ───────────────────────────────────────────
  function currentUrl() { return _currentUrl; }
  function isReady()    { return !!_shakaPlayer; }

  return {
    init:             init,
    play:             play,
    stop:             stop,
    setNetworkQuality:setNetworkQuality,
    getTechInfo:      getTechInfo,
    getAudioTracks:   getAudioTracks,
    setAudioLanguage: setAudioLanguage,
    isSeekable:       isSeekable,
    currentUrl:       currentUrl,
    isReady:          isReady,
  };
})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;
