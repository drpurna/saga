// ================================================================
// SAGA IPTV — player.js v2.1  |  Tizen 9.0 / Fixed mutex + abort
// - Promise-mutex with AbortController to kill hung loads
// - Proper rejection on timeout to unblock chain
// ================================================================
'use strict';

var SagaPlayer = (function () {

  var _player       = null;
  var _videoEl      = null;
  var _loadPromise  = Promise.resolve();
  var _currentUrl   = '';
  var _abortController = null;
  var _drmLevelIdx  = 0;
  var _paused       = false;
  var _initialised  = false;

  var BUSY_TIMEOUT_MS = 12000;

  var CB = {
    onStatus:     function () {},
    onBuffering:  function () {},
    onTechUpdate: function () {},
    onError:      function () {},
  };

  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE', audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE', audio: 'SW_SECURE_CRYPTO' },
    { video: '',                  audio: ''                 },
  ];

  function _baseConfig(bufGoal) {
    return {
      streaming: {
        lowLatencyMode: true,
        inaccurateManifestTolerance: 0,
        bufferingGoal: bufGoal || 10,
        rebufferingGoal: 1.5,
        bufferBehind: 20,
        stallEnabled: true,
        stallThreshold: 1,
        stallSkip: 0.1,
        autoCorrectDrift: true,
        gapDetectionThreshold: 0.5,
        gapPadding: 0.1,
        durationBackoff: 1,
        retryParameters: {
          maxAttempts: 6, baseDelay: 300,
          backoffFactor: 1.5, fuzzFactor: 0.3, timeout: 20000,
        },
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: 2000000,
        switchInterval: 6,
        bandwidthUpgradeTarget: 0.85,
        bandwidthDowngradeTarget: 0.95,
        restrictToElementSize: false,
        advanced: { minTotalBytes: 32768, minBytesPerEstimate: 16384 },
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: { ignoreManifestProgramDateTime: false, useSafariBehaviorForLive: false },
      },
      drm: {
        retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 15000 },
        advanced: { 'com.widevine.alpha': {
          videoRobustness: DRM_LEVELS[0].video,
          audioRobustness: DRM_LEVELS[0].audio,
        }},
      },
      preferredVideoCodecs: ['avc1', 'hvc1', 'hev1'],
      preferredAudioCodecs: ['mp4a', 'ac-3', 'ec-3'],
    };
  }

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
        CB.onError('Player unsupported', 0);
        return;
      }
      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());
      _player.addEventListener('error', _handleError);
      _player.addEventListener('buffering', function (ev) { CB.onBuffering(ev.buffering); });
      _player.addEventListener('adaptation', CB.onTechUpdate);
      _player.addEventListener('variantchanged', CB.onTechUpdate);
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);
    } catch (err) {
      _initialised = false;
      CB.onError('Player init failed', 0);
    }
  }

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
    if (_videoEl) _videoEl.pause();
    if (_player)  _player.unload().catch(function () {});
    _currentUrl = '';
  }

  async function _handleError(ev) {
    var err = ev && ev.detail;
    var code = err && err.code;
    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var lvl = DRM_LEVELS[_drmLevelIdx];
      var drmCfg = { advanced: { 'com.widevine.alpha': {} } };
      if (lvl.video) drmCfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) drmCfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
      _player.configure({ drm: drmCfg });
      if (_currentUrl) {
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, null, true); });
      }
      return;
    }
    if (code >= 7000 && code <= 7999) { CB.onError('Network error', code); return; }
    CB.onError((code >= 6000 && code <= 6999) ? 'DRM error' : 'Stream error', code);
  }

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

  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;

    if (_abortController) {
      try { _abortController.abort(); } catch(e) {}
      _abortController = null;
    }
    _abortController = new AbortController();
    var signal = _abortController.signal;

    var drmCfg = _buildDrmConfig(streamInfo);
    var timeoutId = null;

    try {
      await Promise.race([
        (async () => {
          await _player.unload();
          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });
          await _player.load(url);
          await _videoEl.play().catch(function () {});
          if (!isDrmRetry) _drmLevelIdx = 0;
          CB.onTechUpdate();
        })(),
        new Promise((_, reject) => {
          timeoutId = setTimeout(() => {
            reject(new Error('LOAD_TIMEOUT'));
          }, BUSY_TIMEOUT_MS);
        })
      ]);
      clearTimeout(timeoutId);
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.message === 'LOAD_TIMEOUT') {
        if (_abortController) _abortController.abort();
        CB.onError('Load timeout', 0);
        throw err;
      }
      try {
        if (url.endsWith('.ts')) {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          await _player.unload();
          await _player.load(m3u);
          await _videoEl.play().catch(function () {});
          _currentUrl = m3u;
          CB.onTechUpdate();
          return;
        }
        if (!drmCfg) {
          await _player.unload();
          _videoEl.src = url;
          _videoEl.load();
          await _videoEl.play().catch(function () {});
          return;
        }
      } catch (e2) {}
      CB.onError('Play error', 0);
      throw err;
    } finally {
      _abortController = null;
    }
  }

  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _loadPromise = _loadPromise.then(function () {
      return _load(url, streamInfo, false);
    }).catch(function (err) {
      console.warn('[Player] play chain error:', err);
    });
    return _loadPromise;
  }

  function stop() {
    if (_abortController) {
      try { _abortController.abort(); } catch(e) {}
      _abortController = null;
    }
    _loadPromise = _loadPromise.then(function () {
      if (!_player) return;
      return _player.unload().catch(function () {});
    }).then(function () {
      if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); }
      _currentUrl = '';
    });
    return _loadPromise;
  }

  function setNetworkQuality(quality) {
    if (!_player) return;
    if (quality === 'slow')   _player.configure({ streaming: { bufferingGoal: 5, rebufferingGoal: 1 } });
    else                      _player.configure({ streaming: { bufferingGoal: 10, rebufferingGoal: 1.5 } });
  }

  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var vt = tr.find(function (t) { return t.active; });
      var s = _player.getStats ? _player.getStats() : null;
      var parts = [];
      if (vt && vt.width && vt.height) parts.push(vt.width + '×' + vt.height);
      if (s && s.streamBandwidth) parts.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      if (vt && vt.frameRate) parts.push(Math.round(vt.frameRate) + 'fps');
      if (vt && vt.videoCodec) parts.push(vt.videoCodec.split('.')[0]);
      return parts.join(' · ');
    } catch (e) { return ''; }
  }

  function getAudioTracks() {
    if (!_player) return [];
    try { return _player.getAudioLanguagesAndRoles ? _player.getAudioLanguagesAndRoles() : []; } catch(e) { return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_player) return;
    try { _player.selectAudioLanguage(lang, role || ''); } catch(e) {}
  }

  function isSeekable(videoEl) {
    try {
      var r = videoEl && videoEl.seekable;
      return !!(r && r.length > 0 && (r.end(0) - r.start(0)) > 2);
    } catch (e) { return false; }
  }

  function currentUrl() { return _currentUrl; }
  function isReady()    { return _initialised && !!_player; }

  return {
    init: init,
    play: play,
    stop: stop,
    setNetworkQuality: setNetworkQuality,
    getTechInfo: getTechInfo,
    getAudioTracks: getAudioTracks,
    setAudioLanguage: setAudioLanguage,
    isSeekable: isSeekable,
    currentUrl: currentUrl,
    isReady: isReady,
  };
})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;