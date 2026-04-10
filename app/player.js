// ================================================================
// SAGA IPTV — player.js v11.0 (Custom ABR that actually works)
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
  var _currentNetworkQuality = 'online';
  var _customAbrInterval = null;
  var _allTracks = [];
  var _currentTrackId = null;
  var _rebufferingCount = 0;
  var _lastBandwidth = 20000000;
  var _stallDetection = false;

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

  // ── Shaka config: disable ABR, we control manually ──────────
  function _baseConfig() {
    return {
      streaming: {
        lowLatencyMode: false,
        inaccurateManifestTolerance: 0,
        bufferingGoal: 15,
        rebufferingGoal: 2,
        bufferBehind: 30,
        stallEnabled: true,
        stallThreshold: 0.5,
        stallSkip: 0.5,
        autoCorrectDrift: true,
        gapDetectionThreshold: 1.0,
        gapPadding: 0.2,
        durationBackoff: 1,
        retryParameters: { maxAttempts: 6, baseDelay: 300, backoffFactor: 1.5, fuzzFactor: 0.3, timeout: 20000 },
      },
      abr: {
        enabled: false,   // 🔥 Disable Shaka ABR, we control
        defaultBandwidthEstimate: 20000000,
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
    };
  }

  // ── Get current bandwidth estimate from Shaka ───────────────
  function _getCurrentBandwidth() {
    if (!_player) return _lastBandwidth;
    try {
      var stats = _player.getStats();
      if (stats && stats.estimatedBandwidth) {
        _lastBandwidth = stats.estimatedBandwidth;
        return _lastBandwidth;
      }
    } catch(e) {}
    return _lastBandwidth;
  }

  // ── Select best track based on bandwidth (upgrade only) ──────
  function _selectBestTrackForBandwidth() {
    if (!_player || !_allTracks.length) return;
    var bw = _getCurrentBandwidth();
    // Find the highest bandwidth track that is ≤ bw * 1.2 (allow a bit of overhead)
    var bestCandidate = null;
    for (var i = 0; i < _allTracks.length; i++) {
      var track = _allTracks[i];
      if (track.bandwidth <= bw * 1.2) {
        if (!bestCandidate || track.bandwidth > bestCandidate.bandwidth) {
          bestCandidate = track;
        }
      }
    }
    // If no candidate (bw too low), pick the lowest bandwidth track
    if (!bestCandidate && _allTracks.length) {
      bestCandidate = _allTracks.reduce(function(a,b) { return a.bandwidth < b.bandwidth ? a : b; }, _allTracks[0]);
    }
    if (bestCandidate && bestCandidate.id !== _currentTrackId) {
      // Only upgrade or downgrade if bandwidth is significantly lower than current
      var currentTrack = _allTracks.find(function(t) { return t.id === _currentTrackId; });
      var shouldSwitch = false;
      if (!currentTrack) shouldSwitch = true;
      else if (bestCandidate.bandwidth > currentTrack.bandwidth) shouldSwitch = true; // upgrade
      else if (bestCandidate.bandwidth < currentTrack.bandwidth * 0.7) shouldSwitch = true; // downgrade only if 30% lower
      
      if (shouldSwitch) {
        try {
          _player.selectVariantTrack(bestCandidate, false);
          _currentTrackId = bestCandidate.id;
          console.log('[CustomABR] Switched to', bestCandidate.width+'x'+bestCandidate.height, bestCandidate.bandwidth, 'bw='+bw);
          CB.onTechUpdate();
        } catch(e) {}
      }
    }
  }

  // ── Periodically update tracks list and select best ──────────
  function _refreshTracksAndSelect() {
    if (!_player) return;
    try {
      var tracks = _player.getVariantTracks();
      if (tracks && tracks.length && JSON.stringify(tracks) !== JSON.stringify(_allTracks)) {
        _allTracks = tracks;
        _selectBestTrackForBandwidth();
      }
    } catch(e) {}
  }

  function _startCustomAbr() {
    if (_customAbrInterval) clearInterval(_customAbrInterval);
    _customAbrInterval = setInterval(function() {
      if (!_player || !_currentUrl) return;
      _refreshTracksAndSelect();
    }, 4000); // check every 4 seconds
  }

  function _stopCustomAbr() {
    if (_customAbrInterval) {
      clearInterval(_customAbrInterval);
      _customAbrInterval = null;
    }
  }

  // ── Apply network quality (affects streaming settings) ──────
  function setNetworkQuality(quality) {
    _currentNetworkQuality = (quality === 'slow') ? 'slow' : 'online';
    if (!_player) return;
    var isSlow = (_currentNetworkQuality === 'slow');
    try {
      _player.configure({
        streaming: {
          bufferingGoal: isSlow ? 8 : 15,
          rebufferingGoal: isSlow ? 1 : 2,
        },
      });
      // If slow, we might want to force lower max resolution via track selection
      // But custom ABR will handle based on bandwidth.
      console.log('[SagaPlayer] Network quality:', _currentNetworkQuality);
    } catch(e) {}
  }

  function setMaxResolution(width, height) { /* not used with custom ABR */ }

  function _setupVideoElement(video) {
    if (!video) return;
    video.setAttribute('preload', 'auto');
    video.setAttribute('disableRemotePlayback', 'true');
    video.style.willChange = 'transform';
    video.style.transform = 'translateZ(0)';
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
      _player.addEventListener('buffering', function(ev) { 
        CB.onBuffering(ev.buffering);
        if (ev.buffering) {
          _rebufferingCount++;
          if (_rebufferingCount > 2) {
            // If repeated rebuffering, maybe bandwidth is overestimated, force lower track
            setTimeout(function() {
              if (_allTracks.length) {
                var lowest = _allTracks.reduce(function(a,b) { return a.bandwidth < b.bandwidth ? a : b; }, _allTracks[0]);
                if (lowest && lowest.id !== _currentTrackId) {
                  try {
                    _player.selectVariantTrack(lowest, false);
                    _currentTrackId = lowest.id;
                    console.log('[CustomABR] Rebuffering -> downgraded to lowest');
                  } catch(e) {}
                }
              }
            }, 1000);
          }
        } else {
          _rebufferingCount = Math.max(0, _rebufferingCount - 1);
        }
      });
      _player.addEventListener('adaptation', function() { CB.onTechUpdate(); });
      _player.addEventListener('variantchanged', function() { CB.onTechUpdate(); });

      _player.addEventListener('manifestparsed', function() {
        _refreshTracksAndSelect();
        _startCustomAbr();
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
    _stopCustomAbr();
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
    _allTracks = [];
    _currentTrackId = null;
    _rebufferingCount = 0;
    _stopCustomAbr();
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
          setNetworkQuality(_currentNetworkQuality); // apply before load
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });
          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; }
          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true;
          // After load, wait a bit for manifest to be parsed, then tracks will be available
          setTimeout(function() {
            _refreshTracksAndSelect();
            _startCustomAbr();
          }, 1000);
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
            _currentUrl = m3u; _lastLoadSucceeded = true; CB.onTechUpdate();
            setTimeout(function() { _refreshTracksAndSelect(); _startCustomAbr(); }, 1000);
            return;
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
    _stopCustomAbr();
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
      if (s && s.estimatedBandwidth) p.push((s.estimatedBandwidth/1e6).toFixed(1)+' Mbps');
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
