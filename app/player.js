// ================================================================
// SAGA IPTV — player.js v4.0
// All existing FIX tags preserved.
// FIX B5:  visibilitychange only resumes if last load succeeded
// FIX B6:  DRM fallback stores & reuses original streamInfo
// FIX B7:  AbortController removed; timeout unload kept
// FIX B8:  unique load ID per _load() call; stale loads silently abort
// ================================================================
'use strict';

var SagaPlayer = (function () {

  // ── Private state ─────────────────────────────────────────────
  var _player           = null;
  var _videoEl          = null;
  var _loadPromise      = Promise.resolve();
  var _currentUrl       = '';
  var _lastStreamInfo   = null;    // FIX B6: store original streamInfo for DRM retry
  var _drmLevelIdx      = 0;
  var _initialised      = false;
  var _unloading        = false;   // FIX C5/H19: prevent double unload
  var _lastLoadSucceeded = false;  // FIX B5: track whether last load completed
  var _loadSeq          = 0;       // FIX B8: monotonic load ID
  var BUSY_TIMEOUT      = 12000;

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

  // ── Shaka base config ─────────────────────────────────────────
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
      if (!shaka.Player.isBrowserSupported()) { CB.onError('Player unsupported', 0); return; }
      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());
      _player.addEventListener('error',          _handleError);
      _player.addEventListener('buffering',      function (ev) { CB.onBuffering(ev.buffering); });
      _player.addEventListener('adaptation',     CB.onTechUpdate);
      _player.addEventListener('variantchanged', CB.onTechUpdate);
      // FIX C2: signal playing event to app.js for reconnect reset
      if (_videoEl) {
        _videoEl.addEventListener('playing', function () {
          CB.onStatus('playing_event');
        });
      }
      // FIX H12: no _paused flag — check video.paused directly
      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);
    } catch (err) {
      _initialised = false;
      console.error('[Player] init failed:', err);
      CB.onError('Player init failed', 0);
    }
  }

  // FIX H12 + FIX B5: only resume if last load actually succeeded
  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) {
      _videoEl.pause();
    } else {
      // FIX B5: don't resume if the stream never started playing
      if (_lastLoadSucceeded && _currentUrl && _videoEl.paused) {
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

  // ── DRM error handler — FIX B6: reuse stored streamInfo ───────
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
        // FIX B6: pass _lastStreamInfo so DRM server URL is preserved in retry
        var retryInfo = _lastStreamInfo;
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, retryInfo, true); });
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
      // FIX H18: validate 32-char hex
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

  // ── Core load — FIX C4, C5, H19, B7, B8 ─────────────────────
  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl    = url;
    // FIX B6: store streamInfo for DRM retry
    if (!isDrmRetry) _lastStreamInfo = streamInfo;
    // FIX C4: reset DRM level on fresh (non-retry) load
    if (!isDrmRetry) _drmLevelIdx = 0;

    // FIX B8: assign unique sequence ID; stale loads abort themselves
    var mySeq = ++_loadSeq;

    // FIX B7: AbortController removed — timeout triggers unload directly
    var drmCfg    = _buildDrmConfig(streamInfo);
    var timeoutId = null;
    _lastLoadSucceeded = false; // FIX B5: reset before load

    try {
      await new Promise(function (resolve, reject) {
        timeoutId = setTimeout(function () {
          // FIX C5 + B7: unload on timeout to cancel Shaka (no AbortController needed)
          if (_player && !_unloading) {
            _unloading = true;
            _player.unload().catch(function(){}).then(function(){ _unloading = false; });
          }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);

        (async function doLoad() {
          // FIX B8: check load is still current before doing anything
          if (mySeq !== _loadSeq) { resolve(); return; }

          // FIX H19: prevent double unload
          if (!_unloading) {
            _unloading = true;
            await _player.unload().catch(function(){});
            _unloading = false;
          }

          // FIX B8: check again after async unload
          if (mySeq !== _loadSeq) { resolve(); return; }

          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });

          await _player.load(url);

          // FIX B8: check after load (another play() may have been called)
          if (mySeq !== _loadSeq) { resolve(); return; }

          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true; // FIX B5: mark success
          CB.onTechUpdate();
        })().then(function () { clearTimeout(timeoutId); resolve(); })
            .catch(function (e) { clearTimeout(timeoutId); reject(e); });
      });

    } catch (err) {
      _lastLoadSucceeded = false; // FIX B5
      if (err.message === 'LOAD_TIMEOUT') {
        CB.onError('Load timeout', 0); throw err;
      }
      // Fallback A: .ts → .m3u8
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            await _player.load(m3u);
            await _videoEl.play().catch(function(){});
            _currentUrl = m3u; _lastLoadSucceeded = true; CB.onTechUpdate(); return;
          }
        } catch (eA) {}
      }
      // Fallback B: native video (non-DRM)
      if (!drmCfg) {
        try {
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            _videoEl.src = url; _videoEl.load();
            await _videoEl.play().catch(function(){});
            _lastLoadSucceeded = true; return;
          }
        } catch (eB) {}
      }
      CB.onError('Play error', 0);
      throw err;
    }
  }

  // ── Public: play ──────────────────────────────────────────────
  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _loadPromise = _loadPromise.then(function () {
      return _load(url, streamInfo, false);
    }).catch(function (err) {
      console.warn('[Player] play error:', err && err.message);
    });
    return _loadPromise;
  }

  // ── Public: stop ──────────────────────────────────────────────
  function stop() {
    _currentUrl = '';
    _lastLoadSucceeded = false; // FIX B5
    _loadSeq++;                  // FIX B8: invalidate any in-flight load
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

  // ── Public: set max resolution for ABR (FIX: auto quality) ───
  function setMaxResolution(width, height) {
    if (!_player) return;
    try {
      if (!width || !height) {
        // Remove restriction
        _player.configure({ abr: { restrictions: { maxWidth: Infinity, maxHeight: Infinity } } });
      } else {
        // FIX auto quality: restrict Shaka ABR to max resolution
        _player.configure({ abr: { restrictions: { maxWidth: width, maxHeight: height } } });
      }
    } catch(e) { console.warn('[Player] setMaxResolution:', e.message); }
  }

  // Force ABR to re-evaluate and upgrade if possible
function upgradeQuality() {
  if (!_player) return false;
  try {
    // Get current variant tracks
    var tracks = _player.getVariantTracks();
    if (!tracks || tracks.length === 0) return false;
    
    // Find the highest bandwidth track that's not already active
    var bestTrack = null;
    var bestBandwidth = 0;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (t.bandwidth > bestBandwidth && !t.active) {
        bestBandwidth = t.bandwidth;
        bestTrack = t;
      }
    }
    if (bestTrack) {
      _player.selectVariantTrack(bestTrack, true); // true = clear other tracks
      console.log('[Player] Upgraded to track:', bestTrack.bandwidth, 'bps');
      return true;
    }
  } catch(e) { console.warn('[Player] upgradeQuality failed', e); }
  return false;
}

// Force a manifest reload to re-evaluate ABR (useful after network change)
async function refreshManifest() {
  if (!_player || !_currentUrl) return;
  try {
    var wasPlaying = !_videoEl.paused;
    var currentTime = _videoEl.currentTime;
    await _player.unload();
    await _player.load(_currentUrl);
    if (wasPlaying && currentTime > 0) {
      _videoEl.currentTime = currentTime;
      await _videoEl.play();
    }
    console.log('[Player] Manifest reloaded for quality upgrade');
  } catch(e) { console.warn('[Player] refreshManifest failed', e); }
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

  function getAudioTracks() {
    if (!_player) return [];
    try { return _player.getAudioLanguagesAndRoles ? _player.getAudioLanguagesAndRoles() : []; } catch(e) { return []; }
  }
  function setAudioLanguage(lang, role) {
    if (!_player) return;
    try { _player.selectAudioLanguage(lang, role || ''); } catch(e) {}
  }

  // FIX H22: seekable.length check
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
  setMaxResolution: setMaxResolution,
  upgradeQuality: upgradeQuality,      // new
  refreshManifest: refreshManifest,    // new
  getTechInfo: getTechInfo,
  getAudioTracks: getAudioTracks,
  setAudioLanguage: setAudioLanguage,
  isSeekable: isSeekable,
  currentUrl: currentUrl,
  isReady: isReady,
};

})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;
