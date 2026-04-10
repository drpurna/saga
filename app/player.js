// ================================================================
// SAGA IPTV — player.js v11.0 (Enterprise: ABR disabled, forced highest quality)
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
  var _qualityLockInterval = null;
  var _bestTrackId      = null;

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

  // ── Configuration: ABR disabled, aggressive stall handling ──
  function _baseConfig() {
    return {
      streaming: {
        lowLatencyMode: false,
        inaccurateManifestTolerance: 0,
        bufferingGoal: 20,
        rebufferingGoal: 3,
        bufferBehind: 30,
        stallEnabled: true,
        stallThreshold: 0.3,          // detect stall faster
        stallSkip: 1.0,               // skip up to 1 second of stuck data
        autoCorrectDrift: true,
        gapDetectionThreshold: 2.0,   // tolerate larger gaps
        gapPadding: 0.5,
        durationBackoff: 1,
        retryParameters: { maxAttempts: 8, baseDelay: 200, backoffFactor: 1.2, fuzzFactor: 0.2, timeout: 15000 },
      },
      abr: {
        enabled: false,               // 🔥 COMPLETELY DISABLE ABR
        defaultBandwidthEstimate: 50000000, // 50 Mbps (irrelevant but high)
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: { ignoreManifestProgramDateTime: true, useSafariBehaviorForLive: false },
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

  // ── Select the track with highest resolution (width * height) ──
  function _selectHighestResolutionTrack() {
    if (!_player) return;
    try {
      var tracks = _player.getVariantTracks();
      if (!tracks.length) return;

      var bestTrack = null;
      var bestArea = -1;
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        var area = (t.width || 0) * (t.height || 0);
        // Also prefer higher bandwidth if resolutions are equal
        if (area > bestArea || (area === bestArea && t.bandwidth > (bestTrack ? bestTrack.bandwidth : 0))) {
          bestArea = area;
          bestTrack = t;
        }
      }
      if (bestTrack && bestTrack.id !== _bestTrackId) {
        _player.selectVariantTrack(bestTrack, true); // clear buffer to apply immediately
        _bestTrackId = bestTrack.id;
        console.log('[SagaPlayer] 🔥 Forced highest quality:', bestTrack.width + 'x' + bestTrack.height, bestTrack.bandwidth + ' bps');
        CB.onTechUpdate();
      }
    } catch(e) { console.warn('[SagaPlayer] Track selection error:', e); }
  }

  // ── Periodic lock (every 4 seconds) ──
  function _startQualityLock() {
    if (_qualityLockInterval) clearInterval(_qualityLockInterval);
    _qualityLockInterval = setInterval(function() {
      if (_player && _currentUrl) {
        _selectHighestResolutionTrack();
      }
    }, 4000);
  }

  function _stopQualityLock() {
    if (_qualityLockInterval) {
      clearInterval(_qualityLockInterval);
      _qualityLockInterval = null;
    }
  }

  function _setupVideoElement(video) {
    if (!video) return;
    video.setAttribute('preload', 'auto');
    video.setAttribute('disableRemotePlayback', 'true');
    // Force GPU compositing
    video.style.willChange = 'transform';
    video.style.transform = 'translateZ(0)';
    // Ensure CSS object-fit is respected (app.js controls this)
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
      _player.addEventListener('adaptation', function() {
        // If ABR somehow tries to change, force our track again
        setTimeout(_selectHighestResolutionTrack, 50);
      });
      _player.addEventListener('variantchanged', function() {
        setTimeout(_selectHighestResolutionTrack, 50);
      });

      // When manifest loads, select best track and start locking
      _player.addEventListener('manifestparsed', function() {
        _selectHighestResolutionTrack();
        _startQualityLock();
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
    _bestTrackId = null;
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
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });
          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; }
          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true;
          // After load, wait a bit for tracks to be available
          setTimeout(function() {
            _selectHighestResolutionTrack();
            _startQualityLock();
          }, 500);
          CB.onTechUpdate();
        })().then(function(){ clearTimeout(timeoutId); resolve(); })
          .catch(function(e){ clearTimeout(timeoutId); reject(e); });
      });
    } catch (err) {
      _lastLoadSucceeded = false;
      _stopQualityLock();
      if (err.message === 'LOAD_TIMEOUT') { CB.onError('Load timeout', 0); throw err; }
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            await _player.load(m3u);
            await _videoEl.play().catch(function(){});
            _currentUrl = m3u; _lastLoadSucceeded = true;
            setTimeout(function() { _selectHighestResolutionTrack(); _startQualityLock(); }, 500);
            CB.onTechUpdate(); return;
          }
        } catch(eA) {}
      }
      if (!drmCfg) {
        try {
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            _videoEl.src = url; _videoEl.load();
            await _videoEl.play().catch(function(){});
            _lastLoadSucceeded = true;
            return;
          }
        } catch(eB) {}
      }
      CB.onError('Play error', 0);
      throw err;
    }
  }

  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _stopQualityLock();
    _loadPromise = _loadPromise.then(function(){ return _load(url, streamInfo, false); })
      .catch(function(err){ console.warn('[Player] play error:', err && err.message); });
    return _loadPromise;
  }

  function stop() {
    _stopQualityLock();
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

  // These are kept for compatibility with app.js but ABR is disabled
  function setNetworkQuality(quality) { /* not used */ }
  function setMaxResolution(width, height) { /* not needed */ }

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
