// ================================================================
// SAGA IPTV — player.js v6.1  |  Aggressive ABR + Force Upgrade
// ================================================================
'use strict';

var SagaPlayer = (function () {

  // ── Private state ─────────────────────────────────────────────
  var _player            = null;
  var _videoEl           = null;
  var _loadPromise       = Promise.resolve();
  var _currentUrl        = '';
  var _lastStreamInfo    = null;
  var _drmLevelIdx       = 0;
  var _initialised       = false;
  var _unloading         = false;
  var _lastLoadSucceeded = false;
  var _loadSeq           = 0;

  // ── ABR engine state ──────────────────────────────────────────
  var _abrWatcher        = null;
  var _bwSamples         = [];
  var _BW_SAMPLES_MAX    = 6;          // fewer samples for faster reaction
  var _bufGoodStreak     = 0;
  var _bufBadStreak      = 0;
  var _abrFrozen         = false;
  var _abrFrozenUntil    = 0;
  var _lastSwitchTime    = 0;
  var _lastRebufferTime  = 0;
  var _inRebufferCooldown = false;
  var _forceUpgradeDone  = false;      // track if we've forced once

  // ── Tuned for aggressive upscaling ────────────────────────────
  var BUSY_TIMEOUT       = 14000;
  var ABR_INTERVAL_MS    = 2000;        // check every 2s
  var BUF_LOW_S          = 2.5;         // downgrade if buffer < 2.5s
  var BUF_GOOD_S         = 4.0;         // upgrade if buffer > 4s
  var BUF_GOOD_TICKS     = 1;           // upgrade immediately on good buffer
  var BUF_BAD_TICKS      = 1;           // downgrade immediately on low buffer
  var MIN_SWITCH_GAP     = 2000;        // min 2s between switches
  var ABR_FREEZE_MS      = 15000;
  var STALL_BACKOFF_MS   = 4000;        // cooldown after rebuffer
  var UPGRADE_HEADROOM   = 1.05;        // only 5% headroom needed
  var DOWNGRADE_THRESH   = 0.85;
  var FAST_RAMP_DELAY    = 3000;        // 3s fast ramp
  var FORCE_UPGRADE_DELAY = 5000;       // 5s force upgrade if still low

  var CB = {
    onStatus:     function () {},
    onBuffering:  function () {},
    onTechUpdate: function () {},
    onError:      function () {},
    onQuality:    function () {},
  };

  // ── DRM ladder ────────────────────────────────────────────────
  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE', audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE', audio: 'SW_SECURE_CRYPTO' },
    { video: '',                  audio: ''                 },
  ];

  function _baseConfig() {
    return {
      streaming: {
        lowLatencyMode:             false,
        inaccurateManifestTolerance: 2,
        bufferingGoal:              20,
        rebufferingGoal:             2,
        bufferBehind:               30,
        stallEnabled:               true,
        stallThreshold:             2,
        stallSkip:                  0.3,
        autoCorrectDrift:           true,
        retryParameters: { maxAttempts: 6, baseDelay: 500, backoffFactor: 1.8, fuzzFactor: 0.4, timeout: 25000 },
      },
      abr: {
        enabled:                  true,
        defaultBandwidthEstimate: 3000000,   // 3 Mbps – start higher
        switchInterval:           2,          // allow switching every 2s
        bandwidthUpgradeTarget:   0.70,       // upgrade when using 70% of bw
        bandwidthDowngradeTarget: 0.90,
        restrictToElementSize:    false,
        advanced: { minTotalBytes: 32768, minBytesPerEstimate: 16384, safeMarginPercent: 0.02 },
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: { ignoreManifestProgramDateTime: false, useSafariBehaviorForLive: false },
      },
      drm: {
        retryParameters: { maxAttempts: 4, baseDelay: 500, backoffFactor: 2, timeout: 15000 },
        advanced: { 'com.widevine.alpha': { videoRobustness: DRM_LEVELS[0].video, audioRobustness: DRM_LEVELS[0].audio } },
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
      CB.onQuality    = callbacks.onQuality    || CB.onQuality;
    }
    try {
      shaka.polyfill.installAll();
      if (!shaka.Player.isBrowserSupported()) { CB.onError('Player unsupported', 0); return; }

      _player = new shaka.Player(_videoEl);
      _player.configure(_baseConfig());

      _player.addEventListener('error', _handleError);
      _player.addEventListener('buffering', _onBuffering);
      _player.addEventListener('adaptation', _onAdaptation);
      _player.addEventListener('variantchanged', _onVariantChanged);

      if (_videoEl) {
        _videoEl.addEventListener('playing', function () {
          CB.onStatus('playing_event');
          _resetAbrCounters();
        });
      }

      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);

      _startAbrWatcher();
      console.log('[ABR] Player initialised with aggressive settings');
    } catch (err) {
      _initialised = false;
      console.error('[Player] init failed:', err);
      CB.onError('Player init failed', 0);
    }
  }

  function _resetAbrCounters() {
    _bufGoodStreak = 0;
    _bufBadStreak  = 0;
    _forceUpgradeDone = false;
  }

  function _getBufferAhead() {
    if (!_videoEl) return -1;
    try {
      var buf = _videoEl.buffered;
      var ct  = _videoEl.currentTime;
      if (!buf || buf.length === 0) return -1;
      for (var i = 0; i < buf.length; i++) {
        if (ct >= buf.start(i) && ct <= buf.end(i)) {
          return buf.end(i) - ct;
        }
      }
      return -1;
    } catch(e) { return -1; }
  }

  function _getMeasuredBandwidthKbps() {
    if (!_player) return 0;
    try {
      var stats = _player.getStats();
      if (!stats) return 0;
      var bps = stats.estimatedBandwidth || stats.streamBandwidth || 0;
      return bps > 0 ? Math.round(bps / 1000) : 0;
    } catch(e) { return 0; }
  }

  function _addBwSample(kbps) {
    _bwSamples.push({ v: kbps, t: Date.now() });
    var cutoff = Date.now() - 30000;
    _bwSamples = _bwSamples.filter(function (s) { return s.t > cutoff; });
    if (_bwSamples.length > _BW_SAMPLES_MAX) _bwSamples = _bwSamples.slice(-_BW_SAMPLES_MAX);
  }

  function _getSmoothedBandwidthKbps() {
    if (_bwSamples.length === 0) return 0;
    var now = Date.now();
    var wSum = 0, vSum = 0;
    _bwSamples.forEach(function (s, i) {
      var w = i + 1;
      if ((now - s.t) < 8000) w *= 2;
      wSum += w;
      vSum += s.v * w;
    });
    return wSum > 0 ? Math.round(vSum / wSum) : 0;
  }

  function _getSortedVariants() {
    if (!_player) return [];
    try {
      var tracks = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var seen = {};
      var variants = tracks.filter(function (t) {
        if (seen[t.bandwidth]) return false;
        seen[t.bandwidth] = true;
        return true;
      }).sort(function (a, b) { return a.bandwidth - b.bandwidth; });
      if (variants.length) {
        console.log('[ABR] Available variants:', variants.map(function(v) {
          return (v.height ? v.height+'p' : '?') + ' ' + (v.bandwidth/1e6).toFixed(1)+'Mbps';
        }).join(', '));
      }
      return variants;
    } catch(e) { return []; }
  }

  function _getActiveVariantIdx(variants) {
    if (!_player) return -1;
    try {
      var tracks = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var active = tracks.find(function (t) { return t.active; });
      if (!active) return -1;
      for (var i = 0; i < variants.length; i++) {
        if (variants[i].bandwidth === active.bandwidth) return i;
      }
      return -1;
    } catch(e) { return -1; }
  }

  function _fmtVariant(t) {
    if (!t) return '?';
    var parts = [];
    if (t.width && t.height) parts.push(t.height + 'p');
    if (t.bandwidth) parts.push((t.bandwidth / 1000000).toFixed(1) + ' Mbps');
    return parts.join(' ');
  }

  function _selectVariant(track) {
    if (!_player || !track) return;
    try {
      _player.selectVariantTrack(track, false, 0.5);
      _lastSwitchTime = Date.now();
      console.log('[ABR] ✅ Selected variant:', _fmtVariant(track));
      CB.onQuality(_fmtVariant(track));
      CB.onTechUpdate();
    } catch(e) {
      console.warn('[ABR] selectVariant failed:', e.message);
    }
  }

  function _resetPostSwitchState() {
    _bufGoodStreak = 0;
    _bufBadStreak = 0;
    _lastSwitchTime = Date.now();
  }

  function _degradeQuality(reason) {
    if (!_player) return;
    var variants = _getSortedVariants();
    if (variants.length < 2) return;
    var curIdx = _getActiveVariantIdx(variants);
    if (curIdx <= 0) return;
    var target = variants[curIdx - 1];
    var curBw = variants[curIdx].bandwidth;
    var estKbps = _getSmoothedBandwidthKbps();
    var estBps = estKbps * 1000;

    if (estBps > 0 && estBps > curBw * DOWNGRADE_THRESH) return;

    console.log('[ABR] ⬇ Degrade:', reason, '→', _fmtVariant(target));
    _selectVariant(target);
    _resetPostSwitchState();
  }

  function _upgradeQuality(reason) {
    if (!_player) return;
    var variants = _getSortedVariants();
    if (variants.length < 2) return;
    var curIdx = _getActiveVariantIdx(variants);
    if (curIdx < 0 || curIdx >= variants.length - 1) return;
    var target = variants[curIdx + 1];
    var targetBps = target.bandwidth;
    var estKbps = _getSmoothedBandwidthKbps();
    var estBps = estKbps * 1000;

    if (estBps > 0 && estBps < targetBps * UPGRADE_HEADROOM) {
      console.log('[ABR] ⬆ Upgrade blocked: est', (estBps/1e6).toFixed(1),
        'Mbps < target', (targetBps/1e6).toFixed(1), 'Mbps *', UPGRADE_HEADROOM);
      return;
    }

    console.log('[ABR] ⬆ Upgrade:', reason, '→', _fmtVariant(target));
    _selectVariant(target);
    _resetPostSwitchState();
  }

  function _abrTick() {
    if (!_player || !_videoEl || !_lastLoadSucceeded) return;
    if (_videoEl.paused || document.hidden) return;

    var now = Date.now();

    if (_abrFrozen && now > _abrFrozenUntil) _abrFrozen = false;
    if (_inRebufferCooldown) return;

    var bufAhead = _getBufferAhead();
    var measuredKbps = _getMeasuredBandwidthKbps();
    if (measuredKbps > 0) _addBwSample(measuredKbps);

    var estKbps = _getSmoothedBandwidthKbps();
    if (estKbps > 0 && !_abrFrozen) {
      try {
        _player.configure({ abr: { defaultBandwidthEstimate: estKbps * 1000 } });
      } catch(e) {}
    }

    if (!_abrFrozen && (now - _lastSwitchTime) > MIN_SWITCH_GAP) {
      if (bufAhead >= 0) {
        if (bufAhead < BUF_LOW_S) {
          _bufBadStreak++;
          _bufGoodStreak = 0;
          if (_bufBadStreak >= BUF_BAD_TICKS) {
            _bufBadStreak = 0;
            _degradeQuality('buffer ' + bufAhead.toFixed(1) + 's');
          }
        } else if (bufAhead > BUF_GOOD_S) {
          _bufGoodStreak++;
          _bufBadStreak = 0;
          if (_bufGoodStreak >= BUF_GOOD_TICKS) {
            _bufGoodStreak = 0;
            _upgradeQuality('buffer ' + bufAhead.toFixed(1) + 's');
          }
        } else {
          _bufBadStreak = Math.max(0, _bufBadStreak - 1);
          _bufGoodStreak = Math.max(0, _bufGoodStreak - 1);
        }
      }
    }

    CB.onTechUpdate();
  }

  function _onAdaptation() { _lastSwitchTime = Date.now(); CB.onTechUpdate(); }
  function _onVariantChanged() { CB.onTechUpdate(); }

  function _onBuffering(ev) {
    CB.onBuffering(ev.buffering);
    if (ev.buffering) {
      _lastRebufferTime = Date.now();
      _inRebufferCooldown = true;
      setTimeout(function() { _inRebufferCooldown = false; console.log('[ABR] Cooldown ended'); }, STALL_BACKOFF_MS);
      _bufBadStreak = BUF_BAD_TICKS;
    } else {
      _bufBadStreak = Math.max(0, _bufBadStreak - 1);
    }
  }

  function _startAbrWatcher() {
    if (_abrWatcher) clearInterval(_abrWatcher);
    _abrWatcher = setInterval(_abrTick, ABR_INTERVAL_MS);
  }

  function _stopAbrWatcher() {
    if (_abrWatcher) { clearInterval(_abrWatcher); _abrWatcher = null; }
  }

  // Fast ramp and force upgrade
  function _scheduleFastRamp() {
    if (!_player || !_videoEl) return;
    setTimeout(function() {
      if (!_lastLoadSucceeded || _videoEl.paused) return;
      var variants = _getSortedVariants();
      if (variants.length < 2) return;
      var estKbps = _getSmoothedBandwidthKbps();
      var estBps = estKbps * 1000;
      if (estBps === 0) return;

      var target = null;
      for (var i = variants.length - 1; i >= 0; i--) {
        if (variants[i].bandwidth <= estBps * 0.95) {
          target = variants[i];
          break;
        }
      }
      if (target && target.bandwidth > variants[0].bandwidth) {
        console.log('[ABR] Fast ramp: jumping to', _fmtVariant(target));
        _selectVariant(target);
      } else {
        console.log('[ABR] Fast ramp: no better variant fits, est', (estBps/1e6).toFixed(1), 'Mbps');
      }
    }, FAST_RAMP_DELAY);
  }

  function _scheduleForceUpgrade() {
    setTimeout(function() {
      if (!_lastLoadSucceeded || _videoEl.paused) return;
      if (_forceUpgradeDone) return;
      var variants = _getSortedVariants();
      if (variants.length < 2) return;
      var curIdx = _getActiveVariantIdx(variants);
      if (curIdx === variants.length - 1) {
        console.log('[ABR] Already at highest quality');
        _forceUpgradeDone = true;
        return;
      }
      // Force to the highest variant regardless of bandwidth estimate
      var highest = variants[variants.length - 1];
      console.log('[ABR] Force upgrade: moving from', _fmtVariant(variants[curIdx]), 'to', _fmtVariant(highest));
      _selectVariant(highest);
      _forceUpgradeDone = true;
    }, FORCE_UPGRADE_DELAY);
  }

  // ── Public API ────────────────────────────────────────────────
  function setNetworkQuality(quality) {
    if (!_player) return;
    try {
      if (quality === 'offline') {
        _stopAbrWatcher();
        _player.configure({ streaming: { bufferingGoal: 5, rebufferingGoal: 1 } });
        return;
      }
      if (!_abrWatcher) _startAbrWatcher();
      if (quality === 'slow') {
        _player.configure({ streaming: { bufferingGoal: 8, rebufferingGoal: 2 }, abr: { bandwidthDowngradeTarget: 0.85, switchInterval: 3 } });
      } else {
        _player.configure({ streaming: { bufferingGoal: 20, rebufferingGoal: 2 }, abr: { bandwidthDowngradeTarget: 0.92, switchInterval: 2 } });
      }
    } catch(e) { console.warn('[Player] setNetworkQuality:', e.message); }
  }

  function setMaxResolution(width, height) { /* keep same */ }
  function selectQuality(label) { /* keep same */ }
  function getQualityLevels() { /* keep same */ }

  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) { _videoEl.pause(); _stopAbrWatcher(); }
    else { _startAbrWatcher(); if (_lastLoadSucceeded && _currentUrl && _videoEl.paused) _videoEl.play().catch(function(){}); }
  }

  function _onPageHide() {
    _stopAbrWatcher();
    if (_videoEl) _videoEl.pause();
    if (_player && !_unloading) { _unloading = true; _player.unload().catch(function(){}).then(function(){ _unloading = false; }); }
    _currentUrl = '';
  }

  async function _handleError(ev) { /* keep existing DRM fallback */ }
  function _buildDrmConfig(info) { /* keep existing */ }

  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;
    if (!isDrmRetry) _lastStreamInfo = streamInfo;
    if (!isDrmRetry) _drmLevelIdx = 0;

    var mySeq = ++_loadSeq;
    var drmCfg = _buildDrmConfig(streamInfo);
    var timeoutId = null;
    _lastLoadSucceeded = false;
    _forceUpgradeDone = false;

    _bwSamples = [];
    _bufGoodStreak = 0;
    _bufBadStreak = 0;
    _lastSwitchTime = 0;
    _abrFrozen = false;
    _inRebufferCooldown = false;

    try {
      await new Promise(function (resolve, reject) {
        timeoutId = setTimeout(function () {
          if (_player && !_unloading) { _unloading = true; _player.unload().catch(function(){}).then(function(){ _unloading = false; }); }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);

        (async function doLoad() {
          if (mySeq !== _loadSeq) { resolve(); return; }
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq !== _loadSeq) { resolve(); return; }

          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });

          if (!isDrmRetry) {
            _player.configure({ abr: { enabled: true, restrictions: { maxWidth: Infinity, maxHeight: Infinity } } });
          }

          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; }
          await _videoEl.play().catch(function(){});
          _scheduleFastRamp();
          _scheduleForceUpgrade();   // new: force upgrade after 5s
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true;
          CB.onTechUpdate();
        })().then(function () { clearTimeout(timeoutId); resolve(); })
          .catch(function (e) { clearTimeout(timeoutId); reject(e); });
      });
    } catch (err) {
      _lastLoadSucceeded = false;
      if (err.message === 'LOAD_TIMEOUT') { CB.onError('Load timeout', 0); throw err; }
      // fallback logic omitted for brevity (keep original)
      CB.onError('Play error', 0);
      throw err;
    }
  }

  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _loadPromise = _loadPromise.then(function () { return _load(url, streamInfo, false); });
    return _loadPromise;
  }

  function stop() {
    _currentUrl = ''; _lastLoadSucceeded = false; _loadSeq++;
    _resetAbrCounters();
    _loadPromise = _loadPromise.then(function () {
      if (!_player || _unloading) return;
      _unloading = true;
      return _player.unload().catch(function(){});
    }).then(function () { _unloading = false; if (_videoEl) { _videoEl.pause(); _videoEl.removeAttribute('src'); } });
    return _loadPromise;
  }

  function getTechInfo() { /* keep existing */ }
  function getAudioTracks() { /* keep existing */ }
  function setAudioLanguage(lang, role) { /* keep existing */ }
  function isSeekable(videoEl) { /* keep existing */ }
  function currentUrl() { return _currentUrl; }
  function isReady() { return _initialised && !!_player; }

  return {
    init: init,
    play: play,
    stop: stop,
    setNetworkQuality: setNetworkQuality,
    setMaxResolution: setMaxResolution,
    selectQuality: selectQuality,
    getQualityLevels: getQualityLevels,
    getTechInfo: getTechInfo,
    getAudioTracks: getAudioTracks,
    setAudioLanguage: setAudioLanguage,
    isSeekable: isSeekable,
    currentUrl: currentUrl,
    isReady: isReady,
  };

})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;