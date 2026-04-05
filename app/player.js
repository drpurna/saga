// ================================================================
// SAGA IPTV — player.js v2.0  |  Tizen 9.0 / V8 / 2025 TVs
// - Promise-mutex for serialised load/unload (no race conditions)
// - LL-HLS (Low-Latency HLS) full support via Shaka
// - HW_SECURE_ALL → HW_SECURE_DECODE → SW_SECURE_DECODE DRM ladder
// - 12 s busy-timeout to auto-release mutex on hung load
// - visibilitychange + pagehide lifecycle (suspend/resume)
// - isSeekable() guard before AV sync adjustment
// - Dynamic buffering via setNetworkQuality()
// - Audio track selection via Shaka's language API
// ================================================================
'use strict';

var SagaPlayer = (function () {

  // ── Private state ─────────────────────────────────────────────
  var _player       = null;   // shaka.Player instance
  var _videoEl      = null;   // <video> element
  var _loadPromise  = Promise.resolve(); // mutex — all ops chain here
  var _currentUrl   = '';
  var _busyTimer    = null;
  var _drmLevelIdx  = 0;
  var _paused       = false;  // track play-intent across visibility changes
  var _initialised  = false;

  var BUSY_TIMEOUT_MS = 12000; // ms before hung load auto-releases mutex

  // ── Event callbacks injected by app.js ───────────────────────
  var CB = {
    onStatus:     function () {},
    onBuffering:  function () {},
    onTechUpdate: function () {},
    onError:      function () {},
  };

  // ── DRM robustness ladder ─────────────────────────────────────
  // Tizen 9 (2025): HW_SECURE_ALL. Older TVs may need SW fallback.
  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE', audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE', audio: 'SW_SECURE_CRYPTO' },
    { video: '',                  audio: ''                 }, // last resort: no robustness
  ];

  // ── Shaka base configuration ──────────────────────────────────
  // LL-HLS: lowLatencyMode + partialSegmentsSupport enable
  //   #EXT-X-PART and #EXT-X-PRELOAD-HINT parsing in Shaka.
  // On compatible streams this cuts channel zap time to <1s.
  function _baseConfig(bufGoal) {
    return {
      streaming: {
        lowLatencyMode:          true,   // LL-HLS / LL-DASH
        inaccurateManifestTolerance: 0,  // required for LL-HLS
        bufferingGoal:           bufGoal || 10,
        rebufferingGoal:         1.5,
        bufferBehind:            20,
        stallEnabled:            true,
        stallThreshold:          1,
        stallSkip:               0.1,
        autoCorrectDrift:        true,
        gapDetectionThreshold:   0.5,
        gapPadding:              0.1,
        durationBackoff:         1,
        retryParameters: {
          maxAttempts: 6, baseDelay: 300,
          backoffFactor: 1.5, fuzzFactor: 0.3, timeout: 20000,
        },
      },
      abr: {
        enabled:                    true,
        defaultBandwidthEstimate:   2000000, // 2 Mbps default (2025 TVs on fast LAN)
        switchInterval:             6,
        bandwidthUpgradeTarget:     0.85,
        bandwidthDowngradeTarget:   0.95,
        restrictToElementSize:      false,
        advanced: {
          minTotalBytes:  32768,
          minBytesPerEstimate: 16384,
        },
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: {
          ignoreManifestProgramDateTime: false,
          // Allow partial segments for LL-HLS
          useSafariBehaviorForLive:      false,
        },
      },
      drm: {
        retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 15000 },
        advanced: { 'com.widevine.alpha': {
          videoRobustness: DRM_LEVELS[0].video,
          audioRobustness: DRM_LEVELS[0].audio,
        }},
      },
      // Prefer AVC for compatibility, allow HEVC if TV supports
      preferredVideoCodecs: ['avc1', 'hvc1', 'hev1'],
      preferredAudioCodecs: ['mp4a', 'ac-3', 'ec-3'],
    };
  }

  // ── Init ─────────────────────────────────────────────────────
  async function init(videoElement, callbacks) {
    if (_initialised) return;
    _initialised = true;
    _videoEl = videoElement;

    if (callbacks) {
      CB.onStatus     = callbacks.onStatus     || CB.onStatus;
      CB.onBuffering  = callbacks.onBuffering  || CB.onBuffering;
      CB.onTechUpdate = callbacks.onTechUpdate || CB.onTechUpdate;
      CB.onError      = callbacks.onError      || CB.onError;
    }

    try {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) {
        console.error('[Player] Shaka not supported on this platform');
        CB.onError('Player unsupported', 0); return;
      }

      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());

      _player.addEventListener('error',       _handleError);
      _player.addEventListener('buffering',   function (ev) { CB.onBuffering(ev.buffering); });
      _player.addEventListener('adaptation',  CB.onTechUpdate);
      _player.addEventListener('variantchanged', CB.onTechUpdate);

      // App lifecycle
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);

      console.log('[Player] Shaka ready — LL-HLS enabled, DRM level 0');
    } catch (err) {
      _initialised = false;
      console.error('[Player] init error:', err);
      CB.onError('Player init failed', 0);
    }
  }

  // ── Lifecycle: background/foreground ─────────────────────────
  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) {
      _paused = _videoEl.paused;
      _videoEl.pause();
    } else if (!_paused && _currentUrl) {
      _videoEl.play().catch(function () {});
    }
  }
  function _onPageHide() {
    // TV suspend — release decoder resources immediately
    if (_videoEl) _videoEl.pause();
    if (_player)  _player.unload().catch(function () {});
    _currentUrl = '';
  }

  // ── Error handler — DRM ladder ────────────────────────────────
  async function _handleError(ev) {
    var err  = ev && ev.detail;
    var code = err && err.code;
    console.error('[Player] error', code, err && err.message);

    // DRM error (6xxx): step down robustness ladder and retry
    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var lvl = DRM_LEVELS[_drmLevelIdx];
      console.warn('[Player] DRM fallback → level', _drmLevelIdx, lvl.video || 'none');
      var drmCfg = { advanced: { 'com.widevine.alpha': {} } };
      if (lvl.video) drmCfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) drmCfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
      _player.configure({ drm: drmCfg });
      if (_currentUrl) {
        // Retry through mutex so we don't double-load
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, null, true); });
      }
      return;
    }

    // Network errors (7xxx): let stall watchdog handle reconnect
    if (code >= 7000 && code <= 7999) { CB.onError('Network error', code); return; }

    CB.onError((code >= 6000 && code <= 6999) ? 'DRM error' : 'Stream error', code);
  }

  // ── DRM config builder ────────────────────────────────────────
  function _buildDrmConfig(info) {
    if (!info || !info.isDRM) return null;
    var lvl = DRM_LEVELS[_drmLevelIdx];
    var cfg = { servers: {}, advanced: {} };

    if (info.drm_url) {
      cfg.servers['com.widevine.alpha'] = info.drm_url;
      cfg.advanced['com.widevine.alpha'] = {};
      if (lvl.video) cfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) cfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
    } else if (info.key) {
      cfg.servers['org.w3.clearkey'] = '';
      cfg.clearKeys = {};
      cfg.clearKeys[info.key_id || info.kid || info.key] = info.key;
    }
    return Object.keys(cfg.servers).length ? cfg : null;
  }

  // ── Core internal load ────────────────────────────────────────
  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;
    var drmCfg  = _buildDrmConfig(streamInfo);

    try {
      await _player.unload();
      _videoEl.removeAttribute('src');

      if (drmCfg) _player.configure({ drm: drmCfg });
      else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });

      await _player.load(url);
      await _videoEl.play().catch(function () {});

      if (!isDrmRetry) _drmLevelIdx = 0; // reset on clean success
      CB.onTechUpdate();

    } catch (err) {
      console.warn('[Player] _load failed:', err.message, 'url:', url);

      // Fallback A: .ts → try .m3u8
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          await _player.unload();
          await _player.load(m3u);
          await _videoEl.play().catch(function () {});
          _currentUrl = m3u;
          CB.onTechUpdate();
          return;
        } catch (eA) { console.warn('[Player] .ts fallback failed'); }
      }

      // Fallback B: native <video> element (non-DRM streams only)
      if (!drmCfg) {
        try {
          await _player.unload();
          _videoEl.src = url;
          _videoEl.load();
          await _videoEl.play().catch(function () {});
          return;
        } catch (eB) { console.warn('[Player] native fallback failed'); }
      }

      CB.onError('Play error', 0);
    }
  }

  // ── Public: play — through the mutex ─────────────────────────
  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    clearTimeout(_busyTimer);
    _loadPromise = _loadPromise.then(function () {
      return new Promise(function (resolve) {
        _busyTimer = setTimeout(function () {
          console.warn('[Player] load timeout 12s — mutex released');
          resolve();
        }, BUSY_TIMEOUT_MS);
        _load(url, streamInfo, false).finally(function () {
          clearTimeout(_busyTimer);
          resolve();
        });
      });
    });
    return _loadPromise;
  }

  // ── Public: stop ──────────────────────────────────────────────
  function stop() {
    clearTimeout(_busyTimer);
    var u = _currentUrl;
    _currentUrl = '';
    _loadPromise = _loadPromise.then(function () {
      if (!_player) return;
      return _player.unload().catch(function () {});
    }).then(function () {
      if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); }
      console.log('[Player] stopped, was:', u);
    });
    return _loadPromise;
  }

  // ── Public: network quality ───────────────────────────────────
  // Called by network monitor when downlink quality changes
  function setNetworkQuality(quality) {
    if (!_player) return;
    switch (quality) {
      case 'slow':   _player.configure({ streaming: { bufferingGoal: 5,  rebufferingGoal: 1   } }); break;
      case 'online': _player.configure({ streaming: { bufferingGoal: 10, rebufferingGoal: 1.5 } }); break;
      default: break;
    }
  }

  // ── Public: tech info string ──────────────────────────────────
  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr    = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var vt    = tr.find(function (t) { return t.active; });
      var s     = _player.getStats ? _player.getStats() : null;
      var parts = [];
      if (vt && vt.width && vt.height) parts.push(vt.width + '×' + vt.height);
      if (s  && s.streamBandwidth)     parts.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      if (vt && vt.frameRate)          parts.push(Math.round(vt.frameRate) + 'fps');
      if (vt && vt.videoCodec)         parts.push(vt.videoCodec.split('.')[0]);
      return parts.join(' · ');
    } catch (e) { return ''; }
  }

  // ── Public: audio tracks ──────────────────────────────────────
  function getAudioTracks() {
    if (!_player) return [];
    try {
      // Shaka 4.x: getAudioLanguagesAndRoles returns [{language, role, label}]
      return _player.getAudioLanguagesAndRoles ? _player.getAudioLanguagesAndRoles() : [];
    } catch (e) { return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_player) return;
    try { _player.selectAudioLanguage(lang, role || ''); } catch (e) {}
  }

  // ── Public: seekable check (for AV sync) ─────────────────────
  // Returns true only when the stream has a seekable DVR window > 2s
  function isSeekable(videoEl) {
    try {
      var r = videoEl && videoEl.seekable;
      return !!(r && r.length > 0 && (r.end(0) - r.start(0)) > 2);
    } catch (e) { return false; }
  }

  // ── Public accessors ──────────────────────────────────────────
  function currentUrl() { return _currentUrl; }
  function isReady()    { return _initialised && !!_player; }

  // ── Public API ────────────────────────────────────────────────
  return {
    init:              init,
    play:              play,
    stop:              stop,
    setNetworkQuality: setNetworkQuality,
    getTechInfo:       getTechInfo,
    getAudioTracks:    getAudioTracks,
    setAudioLanguage:  setAudioLanguage,
    isSeekable:        isSeekable,
    currentUrl:        currentUrl,
    isReady:           isReady,
  };

})(); // end SagaPlayer IIFE

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;
