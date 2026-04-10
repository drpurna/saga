// ================================================================
// SAGA IPTV — player.js v10.0 (Full adaptive ABR + network quality)
// ================================================================
'use strict';

var SagaPlayer = (function () {

  var _player           = null;
  var _videoEl          = null;
  var _loadPromise      = Promise.resolve();
  var _currentUrl       = '';
  var _lastStreamInfo   = null;
  var _drmLevelIdx      = 0;
  var _initialised      = false;
  var _unloading        = false;
  var _lastLoadSucceeded = false;
  var _loadSeq          = 0;
  var BUSY_TIMEOUT      = 12000;
  var _currentNetworkQuality = 'online'; // 'online' or 'slow'

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

  // ── Base Shaka config (ABR fully adaptive) ──────────────────
  function _baseConfig() {
    // Start with a reasonable estimate (will be adjusted by network quality)
    var bwEstimate = (_currentNetworkQuality === 'slow') ? 2000000 : 20000000; // 2 Mbps vs 20 Mbps
    return {
      streaming: {
        lowLatencyMode: false,
        inaccurateManifestTolerance: 0,
        bufferingGoal: 15,
        rebufferingGoal: 2,
        bufferBehind: 30,
        stallEnabled: true,
        stallThreshold: 0.5,      // detect stall after 0.5s
        stallSkip: 0.5,           // skip stuck segments
        autoCorrectDrift: true,
        gapDetectionThreshold: 1.0,
        gapPadding: 0.2,
        durationBackoff: 1,
        retryParameters: { maxAttempts: 6, baseDelay: 300, backoffFactor: 1.5, fuzzFactor: 0.3, timeout: 20000 },
      },
      abr: {
        enabled: true,
        defaultBandwidthEstimate: bwEstimate,
        switchInterval: 3,                    // re-evaluate every 3 seconds
        bandwidthUpgradeTarget: 0.7,          // upgrade when bandwidth >= 70% of next tier
        bandwidthDowngradeTarget: 0.6,        // downgrade when bandwidth <= 60% of current tier
        restrictToElementSize: false,
        restrictions: {
          maxWidth: (_currentNetworkQuality === 'slow') ? 1280 : 4096,
          maxHeight: (_currentNetworkQuality === 'slow') ? 720 : 2160,
        },
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

  // ── Apply network quality changes to the player (live) ──────
  function _applyNetworkQuality() {
    if (!_player) return;
    var isSlow = (_currentNetworkQuality === 'slow');
    var bwEstimate = isSlow ? 2000000 : 20000000;
    var maxWidth = isSlow ? 1280 : 4096;
    var maxHeight = isSlow ? 720 : 2160;
    try {
      _player.configure({
        abr: {
          defaultBandwidthEstimate: bwEstimate,
          restrictions: { maxWidth: maxWidth, maxHeight: maxHeight },
        },
        streaming: {
          bufferingGoal: isSlow ? 8 : 15,
          rebufferingGoal: isSlow ? 1 : 2,
        },
      });
      console.log('[SagaPlayer] Network quality set to', _currentNetworkQuality, '→ BW', bwEstimate);
    } catch(e) { /* ignore */ }
  }

  function _setupVideoElement(video) {
    if (!video) return;
    video.setAttribute('preload', 'auto');
    video.setAttribute('disableRemotePlayback', 'true');
    video.style.willChange = 'transform';
    video.style.transform = 'translateZ(0)';
  }

  // ── Public: set network quality (called from app.js) ─────────
  function setNetworkQuality(quality) {
    _currentNetworkQuality = (quality === 'slow') ? 'slow' : 'online';
    _applyNetworkQuality();
  }

  // ── Optional: cap resolution (used by app.js) ────────────────
  function setMaxResolution(width, height) {
    if (!_player) return;
    try {
      if (!width || !height) {
        _player.configure({ abr: { restrictions: { maxWidth: Infinity, maxHeight: Infinity } } });
      } else {
        _player.configure({ abr: { restrictions: { maxWidth: width, maxHeight: height } } });
      }
    } catch(e) {}
  }

  async function init(videoElement, callbacks) {
    if (_initialised) return;
    _initialised = true;
    _videoEl = videoElement;
    _setupVideoElement(_videoEl);
    if (callbacks) {
      CB.onStatus     = callbacks.onStatus     || CB.onStatus;
      CB.onBuffering  = callbacks.onBuffering  || CB.onBuffering;
      CB.onTechUpdate = callbacks.onTechUpdate || CB.onTechUpdate;
      CB.onError      = callbacks.onError      || CB.onError;
    }
    try {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) { CB.onError('Player unsupported', 0); return; }
      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());
      _player.addEventListener('error', _handleError);
      _player.addEventListener('buffering', function(ev) { CB.onBuffering(ev.buffering); });
      _player.addEventListener('adaptation', function() { CB.onTechUpdate(); });
      _player.addEventListener('variantchanged', function() { CB.onTechUpdate(); });

      // Force an initial high quality (optional, ABR will adapt anyway)
      _player.addEventListener('manifestparsed', function() {
        // Let ABR do its job, but if we have a high estimate, it will pick high.
        // Optionally we could select the best track once, but ABR will override.
        // We'll rely on ABR.
      });

      if (_videoEl) {
        _videoEl.addEventListener('playing', function() { CB.onStatus('playing_event'); });
      }
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);
    } catch (err) {
      _initialised = false;
      CB.onError('Player init failed', 0);
    }
  }

  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) _videoEl.pause();
    else if (_lastLoadSucceeded && _currentUrl && _videoEl.paused) _videoEl.play().catch(function(){});
  }

  function _onPageHide() {
    if (_videoEl) _videoEl.pause();
    if (_player && !_unloading) {
      _unloading = true;
      _player.unload().catch(function(){}).then(function(){ _unloading = false; });
    }
    _currentUrl = '';
  }

  async function _handleError(ev) {
    var err = ev && ev.detail, code = err && err.code;
    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var lvl = DRM_LEVELS[_drmLevelIdx];
      var drmCfg = { advanced: { 'com.widevine.alpha': {} } };
      if (lvl.video) drmCfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) drmCfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
      _player.configure({ drm: drmCfg });
      if (_currentUrl) {
        var retryInfo = _lastStreamInfo;
        _loadPromise = _loadPromise.then(function(){ return _load(_currentUrl, retryInfo, true); });
      }
      return;
    }
    if (code >= 7000 && code <= 7999) CB.onError('Network error', code);
    else CB.onError((code >= 6000 && code <= 6999) ? 'DRM error' : 'Stream error', code);
  }

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

  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;
    if (!isDrmRetry) { _lastStreamInfo = streamInfo; _drmLevelIdx = 0; }
    var mySeq = ++_loadSeq;
    var drmCfg = _buildDrmConfig(streamInfo);
    var timeoutId = null;
    _lastLoadSucceeded = false;
    try {
      await new Promise(function(resolve, reject) {
        timeoutId = setTimeout(function() {
          if (_player && !_unloading) {
            _unloading = true;
            _player.unload().catch(function(){}).then(function(){ _unloading = false; });
          }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);
        (async function doLoad() {
          if (mySeq !== _loadSeq) { resolve(); return; }
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq !== _loadSeq) { resolve(); return; }
          _videoEl.removeAttribute('src');
          // Re-apply network quality settings before load (in case they changed)
          _applyNetworkQuality();
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });
          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; }
          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true;
          CB.onTechUpdate();
        })().then(function(){ clearTimeout(timeoutId); resolve(); })
          .catch(function(e){ clearTimeout(timeoutId); reject(e); });
      });
    } catch (err) {
      _lastLoadSucceeded = false;
      if (err.message === 'LOAD_TIMEOUT') { CB.onError('Load timeout', 0); throw err; }
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            await _player.load(m3u);
            await _videoEl.play().catch(function(){});
            _currentUrl = m3u; _lastLoadSucceeded = true; CB.onTechUpdate(); return;
          }
        } catch(eA) {}
      }
      if (!drmCfg) {
        try {
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            _videoEl.src = url; _videoEl.load();
            await _videoEl.play().catch(function(){});
            _lastLoadSucceeded = true; return;
          }
        } catch(eB) {}
      }
      CB.onError('Play error', 0);
      throw err;
    }
  }

  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _loadPromise = _loadPromise.then(function(){ return _load(url, streamInfo, false); })
      .catch(function(err){ console.warn('[Player] play error:', err && err.message); });
    return _loadPromise;
  }

  function stop() {
    _currentUrl = '';
    _lastLoadSucceeded = false;
    _loadSeq++;
    _loadPromise = _loadPromise.then(function(){
      if (!_player || _unloading) return;
      _unloading = true;
      return _player.unload().catch(function(){});
    }).then(function(){
      _unloading = false;
      if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); }
    });
    return _loadPromise;
  }

  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var vt = tr.find(function(t){ return t.active; });
      var s = _player.getStats ? _player.getStats() : null;
      var p = [];
      if (vt && vt.width && vt.height) p.push(vt.width+'×'+vt.height);
      if (s && s.streamBandwidth) p.push((s.streamBandwidth/1e6).toFixed(1)+' Mbps');
      if (vt && vt.frameRate) p.push(Math.round(vt.frameRate)+'fps');
      if (vt && vt.videoCodec) p.push(vt.videoCodec.split('.')[0]);
      return p.join(' · ');
    } catch(e){ return ''; }
  }

  function getAudioTracks() {
    if (!_player) return [];
    try { return _player.getAudioLanguagesAndRoles ? _player.getAudioLanguagesAndRoles() : []; } catch(e){ return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_player) return;
    try { _player.selectAudioLanguage(lang, role||''); } catch(e){}
  }
  function isSeekable(videoEl) {
    try {
      var r = videoEl && videoEl.seekable;
      if (!r || r.length===0) return false;
      return (r.end(0)-r.start(0))>2;
    } catch(e){ return false; }
  }
  function currentUrl() { return _currentUrl; }
  function isReady() { return _initialised && !!_player; }

  return {
    init: init, play: play, stop: stop,
    setNetworkQuality: setNetworkQuality,
    setMaxResolution: setMaxResolution,
    getTechInfo: getTechInfo,
    getAudioTracks: getAudioTracks,
    setAudioLanguage: setAudioLanguage,
    isSeekable: isSeekable,
    currentUrl: currentUrl,
    isReady: isReady,
  };

})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;
