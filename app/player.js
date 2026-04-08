// ================================================================
// SAGA IPTV — player.js v3.0  |  Tizen 9 / V8 / 2025 Samsung TV
// All mandatory fixes applied (tagged C1–C7, H12, H19, H22, M15)
// ================================================================
'use strict';

var SagaPlayer = (function () {

  // ── Private state ─────────────────────────────────────────────
  var _player        = null;
  var _videoEl       = null;
  var _loadPromise   = Promise.resolve();
  var _currentUrl    = '';
  var _drmLevelIdx   = 0;
  var _initialised   = false;
  var _unloading     = false;  // FIX C5/H19: prevent double unload
  var BUSY_TIMEOUT   = 12000;

  var CB = {
    onStatus:     function () {},
    onBuffering:  function () {},
    onTechUpdate: function () {},
    onError:      function () {},
  };

  // ── DRM ladder ────────────────────────────────────────────────
  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE', audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE', audio: 'SW_SECURE_CRYPTO' },
    { video: '',                  audio: ''                 },
  ];

  // ── Base Shaka config ─────────────────────────────────────────
  function _baseConfig(bufGoal) {
    return {
      streaming: {
        lowLatencyMode: true, inaccurateManifestTolerance: 0,
        bufferingGoal: bufGoal || 10, rebufferingGoal: 1.5,
        bufferBehind: 20, stallEnabled: true, stallThreshold: 1,
        stallSkip: 0.1, autoCorrectDrift: true,
        gapDetectionThreshold: 0.5, gapPadding: 0.1, durationBackoff: 1,
        retryParameters: { maxAttempts: 6, baseDelay: 300, backoffFactor: 1.5, fuzzFactor: 0.3, timeout: 20000 },
      },
      abr: {
        enabled: true, defaultBandwidthEstimate: 2000000, switchInterval: 6,
        bandwidthUpgradeTarget: 0.85, bandwidthDowngradeTarget: 0.95,
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
        CB.onError('Player unsupported', 0); return;
      }
      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());
      _player.addEventListener('error',        _handleError);
      _player.addEventListener('buffering',    function (ev) { CB.onBuffering(ev.buffering); });
      _player.addEventListener('adaptation',   CB.onTechUpdate);
      _player.addEventListener('variantchanged', CB.onTechUpdate);

      // FIX C2: reset reconnectCount on playing (reported via onStatus)
      if (_videoEl) {
        _videoEl.addEventListener('playing', function () {
          CB.onStatus('playing_event');  // app.js handles reconnect reset
        });
      }

      // FIX H12: visibilitychange — check video.paused directly, no _paused flag
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);
    } catch (err) {
      _initialised = false;
      console.error('[Player] init failed:', err);
      CB.onError('Player init failed', 0);
    }
  }

  // FIX H12: removed _paused flag — read video.paused directly
  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) {
      _videoEl.pause();
    } else {
      if (!_videoEl.paused && _currentUrl) return; // already playing
      if (_currentUrl && _videoEl.paused) {
        _videoEl.play().catch(function () {});
      }
    }
  }
  function _onPageHide() {
    if (_videoEl) _videoEl.pause();
    if (_player && !_unloading) {
      _unloading = true;
      _player.unload().catch(function () {}).then(function () { _unloading = false; });
    }
    _currentUrl = '';
  }

  // ── Error handler with DRM ladder ─────────────────────────────
  async function _handleError(ev) {
    var err  = ev && ev.detail;
    var code = err && err.code;
    console.error('[Player] Shaka error', code, err && err.message);

    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var lvl = DRM_LEVELS[_drmLevelIdx];
      console.warn('[Player] DRM fallback → level', _drmLevelIdx, lvl.video || 'none');
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

  // ── DRM config builder — FIX H18: validate clearKeys ─────────
  function _buildDrmConfig(info) {
    if (!info || !info.isDRM) return null;
    var lvl = DRM_LEVELS[_drmLevelIdx];
    var cfg = { servers: {}, advanced: {} };
    if (info.drm_url && typeof info.drm_url === 'string') {
      cfg.servers['com.widevine.alpha'] = info.drm_url;
      cfg.advanced['com.widevine.alpha'] = {};
      if (lvl.video) cfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) cfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
    } else if (info.key && info.iv) {
      // FIX H18: validate that key_id and key are 32-char hex strings
      var kid = info.key_id || info.kid || info.key;
      var key = info.key;
      if (kid && key && /^[0-9a-fA-F]{32}$/.test(kid.replace(/-/g,'')) && /^[0-9a-fA-F]{32}$/.test(key.replace(/-/g,''))) {
        cfg.servers['org.w3.clearkey'] = '';
        cfg.clearKeys = {};
        cfg.clearKeys[kid.replace(/-/g,'')] = key.replace(/-/g,'');
      }
    }
    return Object.keys(cfg.servers).length ? cfg : null;
  }

  // ── Core load — FIX C4: DRM reset; FIX C5: unload on timeout ─
  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;

    // FIX C4: reset DRM level at start of every fresh play() call
    if (!isDrmRetry) _drmLevelIdx = 0;

    var drmCfg    = _buildDrmConfig(streamInfo);
    var abortCtrl = null;
    var timeoutId = null;

    // Build AbortController if available
    if (typeof AbortController !== 'undefined') {
      abortCtrl = new AbortController();
    }

    try {
      await new Promise(function (resolve, reject) {
        timeoutId = setTimeout(function () {
          // FIX C5: abort AND unload Shaka on timeout to actually cancel load
          if (abortCtrl) try { abortCtrl.abort(); } catch(e) {}
          if (_player && !_unloading) {
            _unloading = true;
            _player.unload().catch(function(){}).then(function(){ _unloading = false; });
          }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);

        var loadWork = (async function () {
          // FIX H19: prevent double unload
          if (!_unloading) {
            _unloading = true;
            await _player.unload().catch(function(){});
            _unloading = false;
          }
          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });
          await _player.load(url);
          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          CB.onTechUpdate();
        })();

        loadWork.then(function () { clearTimeout(timeoutId); resolve(); })
                .catch(function (e) { clearTimeout(timeoutId); reject(e); });
      });

    } catch (err) {
      if (err.message === 'LOAD_TIMEOUT') {
        CB.onError('Load timeout', 0);
        throw err;
      }
      // Fallback A: .ts → .m3u8
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          await _player.load(m3u);
          await _videoEl.play().catch(function(){});
          _currentUrl = m3u; CB.onTechUpdate(); return;
        } catch (eA) {}
      }
      // Fallback B: native video (non-DRM)
      if (!drmCfg) {
        try {
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          _videoEl.src = url; _videoEl.load();
          await _videoEl.play().catch(function(){});
          return;
        } catch (eB) {}
      }
      CB.onError('Play error', 0);
      throw err;
    }
  }

  // ── Public: play — promise-mutex ──────────────────────────────
  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    // FIX C4: reset DRM level queued in _load, but set flag here too for clarity
    _loadPromise = _loadPromise.then(function () {
      return _load(url, streamInfo, false);
    }).catch(function (err) {
      console.warn('[Player] play chain error:', err && err.message);
    });
    return _loadPromise;
  }

  // ── Public: stop ──────────────────────────────────────────────
  function stop() {
    _currentUrl = '';
    _loadPromise = _loadPromise.then(function () {
      if (!_player || _unloading) return;
      _unloading = true;
      return _player.unload().catch(function(){});
    }).then(function () {
      _unloading = false;
      if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); }
    });
    return _loadPromise;
  }

  // ── Public: network quality ───────────────────────────────────
  function setNetworkQuality(quality) {
    if (!_player) return;
    if (quality === 'slow') _player.configure({ streaming: { bufferingGoal: 5,  rebufferingGoal: 1   } });
    else                    _player.configure({ streaming: { bufferingGoal: 10, rebufferingGoal: 1.5 } });
  }

  // ── Public: tech info ─────────────────────────────────────────
  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var vt = tr.find(function (t) { return t.active; });
      var s  = _player.getStats ? _player.getStats() : null;
      var p  = [];
      if (vt && vt.width && vt.height) p.push(vt.width + '×' + vt.height);
      if (s  && s.streamBandwidth)     p.push((s.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      if (vt && vt.frameRate)          p.push(Math.round(vt.frameRate) + 'fps');
      if (vt && vt.videoCodec)         p.push(vt.videoCodec.split('.')[0]);
      return p.join(' · ');
    } catch (e) { return ''; }
  }

  // ── Public: audio tracks ──────────────────────────────────────
  function getAudioTracks() {
    if (!_player) return [];
    try { return _player.getAudioLanguagesAndRoles ? _player.getAudioLanguagesAndRoles() : []; } catch(e) { return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_player) return;
    try { _player.selectAudioLanguage(lang, role || ''); } catch(e) {}
  }

  // FIX H22: added seekable.length check
  function isSeekable(videoEl) {
    try {
      var r = videoEl && videoEl.seekable;
      if (!r || r.length === 0) return false;
      return (r.end(0) - r.start(0)) > 2;
    } catch (e) { return false; }
  }

  function currentUrl() { return _currentUrl; }
  function isReady()    { return _initialised && !!_player; }

  return {
    init: init, play: play, stop: stop,
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
