// ================================================================
// SAGA IPTV — player.js v6.0  |  Dynamic Upscaling + Stable ABR
//
// Key features:
// - Fast start (1.5 Mbps initial estimate)
// - Measures real bandwidth every 2.5s, smoothed over 8 samples
// - Upgrades only when buffer > 6s AND bandwidth has 15% headroom
// - Downgrades immediately if buffer < 3s or bandwidth drops below 85%
// - Cooldown after rebuffering (5s without upgrades)
// - Fast ramp: 3s after play, jumps to highest sustainable quality
// - Works for both M3U playlists and JioTV (via setNetworkQuality)
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
  var _bwSamples         = [];          // rolling bandwidth samples (Kbps)
  var _BW_SAMPLES_MAX    = 8;
  var _lastBufCheck      = 0;
  var _bufGoodStreak     = 0;
  var _bufBadStreak      = 0;
  var _lastVariantIdx    = -1;
  var _abrFrozen         = false;
  var _abrFrozenUntil    = 0;
  var _lastBytesLoaded   = 0;
  var _lastBytesTime     = 0;
  var _lastSwitchTime    = 0;
  var _lastRebufferTime  = 0;
  var _inRebufferCooldown = false;

  // ── Tuned constants for dynamic upscaling ─────────────────────
  var BUSY_TIMEOUT       = 14000;
  var ABR_INTERVAL_MS    = 2500;         // check every 2.5s
  var BUF_LOW_S          = 3.0;          // downgrade if buffer < 3s
  var BUF_GOOD_S         = 6.0;          // upgrade if buffer > 6s
  var BUF_GOOD_TICKS     = 2;            // need 2 consecutive good checks (~5s)
  var BUF_BAD_TICKS      = 1;            // downgrade immediately on low buffer
  var MIN_SWITCH_GAP     = 3000;         // min 3s between quality changes
  var ABR_FREEZE_MS      = 15000;        // freeze after manual switch
  var STALL_BACKOFF_MS   = 5000;         // after rebuffer, wait 5s before upgrades
  var UPGRADE_HEADROOM   = 1.15;         // need 15% extra bandwidth to upgrade
  var DOWNGRADE_THRESH   = 0.85;         // downgrade if bandwidth < 85% of current
  var FAST_RAMP_DELAY    = 3000;         // 3s after start, try to jump up

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

  // ── Base Shaka config – optimised for fast start + stable upscaling ──
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
        gapDetectionThreshold:      0.5,
        gapPadding:                 0.1,
        durationBackoff:            1,
        retryParameters: {
          maxAttempts:   6,
          baseDelay:     500,
          backoffFactor: 1.8,
          fuzzFactor:    0.4,
          timeout:       25000,
        },
      },
      abr: {
        enabled:                  true,
        defaultBandwidthEstimate: 1500000,   // 1.5 Mbps – fast start
        switchInterval:           3,          // allow switching every 3s
        bandwidthUpgradeTarget:   0.75,       // upgrade when using 75% of bw
        bandwidthDowngradeTarget: 0.88,       // downgrade at 88% utilization
        restrictToElementSize:    false,
        advanced: {
          minTotalBytes:       65536,
          minBytesPerEstimate: 32768,
          safeMarginPercent:   0.05,
        },
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: {
          ignoreManifestProgramDateTime: false,
          useSafariBehaviorForLive:      false,
          ignoreManifestTimestampsInSegmentsMode: true,
        },
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

  // ── Initialisation ─────────────────────────────────────────────
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

      _player.addEventListener('error',          _handleError);
      _player.addEventListener('buffering',      _onBuffering);
      _player.addEventListener('adaptation',     _onAdaptation);
      _player.addEventListener('variantchanged', _onVariantChanged);

      if (_videoEl) {
        _videoEl.addEventListener('playing', function () {
          CB.onStatus('playing_event');
          _resetAbrCounters();
        });
        _videoEl.addEventListener('progress', _onVideoProgress);
      }

      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);

      _startAbrWatcher();
    } catch (err) {
      _initialised = false;
      console.error('[Player] init failed:', err);
      CB.onError('Player init failed', 0);
    }
  }

  // ── ABR Engine Core ───────────────────────────────────────────
  function _resetAbrCounters() {
    _bufGoodStreak = 0;
    _bufBadStreak  = 0;
    _lastBytesLoaded = 0;
    _lastBytesTime   = 0;
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
    var cutoff = Date.now() - 45000;
    _bwSamples = _bwSamples.filter(function (s) { return s.t > cutoff; });
    if (_bwSamples.length > _BW_SAMPLES_MAX) {
      _bwSamples = _bwSamples.slice(-_BW_SAMPLES_MAX);
    }
  }

  function _getSmoothedBandwidthKbps() {
    if (_bwSamples.length === 0) return 0;
    var now = Date.now();
    var wSum = 0, vSum = 0;
    _bwSamples.forEach(function (s, i) {
      var w = i + 1;
      if ((now - s.t) < 10000) w *= 2;
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
      return tracks.filter(function (t) {
        if (seen[t.bandwidth]) return false;
        seen[t.bandwidth] = true;
        return true;
      }).sort(function (a, b) { return a.bandwidth - b.bandwidth; });
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
      var label = _fmtVariant(track);
      CB.onQuality(label);
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

    if (estBps > 0 && estBps > curBw * DOWNGRADE_THRESH) {
      return; // still enough bandwidth, don't downgrade
    }

    console.log('[ABR] ⬇ Degrade:', reason,
      '→', _fmtVariant(target),
      '(was', _fmtVariant(variants[curIdx]) + ')');
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

    console.log('[ABR] ⬆ Upgrade:', reason,
      '→', _fmtVariant(target),
      '(was', _fmtVariant(variants[curIdx]) + ')');
    _selectVariant(target);
    _resetPostSwitchState();
  }

  function _abrTick() {
    if (!_player || !_videoEl || !_lastLoadSucceeded) return;
    if (_videoEl.paused || document.hidden) return;

    var now = Date.now();

    if (_abrFrozen && now > _abrFrozenUntil) {
      _abrFrozen = false;
    }
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
            _degradeQuality('buf < ' + bufAhead.toFixed(1) + 's');
          }
        } else if (bufAhead > BUF_GOOD_S) {
          _bufGoodStreak++;
          _bufBadStreak = 0;
          if (_bufGoodStreak >= BUF_GOOD_TICKS) {
            _bufGoodStreak = 0;
            _upgradeQuality('buf ' + bufAhead.toFixed(1) + 's');
          }
        } else {
          _bufBadStreak  = Math.max(0, _bufBadStreak  - 1);
          _bufGoodStreak = Math.max(0, _bufGoodStreak - 1);
        }
      }
    }

    CB.onTechUpdate();
  }

  function _onAdaptation() {
    _lastSwitchTime = Date.now();
    CB.onTechUpdate();
  }

  function _onVariantChanged() {
    CB.onTechUpdate();
  }

  function _onBuffering(ev) {
    CB.onBuffering(ev.buffering);
    if (ev.buffering) {
      _lastRebufferTime = Date.now();
      _inRebufferCooldown = true;
      setTimeout(function() {
        _inRebufferCooldown = false;
        console.log('[ABR] Cooldown ended');
      }, STALL_BACKOFF_MS);
      _bufBadStreak = BUF_BAD_TICKS;
    } else {
      _bufBadStreak = Math.max(0, _bufBadStreak - 1);
    }
  }

  function _onVideoProgress() {
    // placeholder – stats already used
  }

  function _startAbrWatcher() {
    if (_abrWatcher) clearInterval(_abrWatcher);
    _abrWatcher = setInterval(_abrTick, ABR_INTERVAL_MS);
  }

  function _stopAbrWatcher() {
    if (_abrWatcher) { clearInterval(_abrWatcher); _abrWatcher = null; }
  }

  // ── Fast ramp – jump to best sustainable quality after 3s ─────
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
        if (variants[i].bandwidth <= estBps * 0.9) {
          target = variants[i];
          break;
        }
      }
      if (target && target.bandwidth > variants[0].bandwidth) {
        console.log('[ABR] Fast ramp: jumping to', _fmtVariant(target));
        _selectVariant(target);
      }
    }, FAST_RAMP_DELAY);
  }

  // ── Public: setNetworkQuality (used by app.js) ────────────────
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
        _player.configure({
          streaming: { bufferingGoal: 8, rebufferingGoal: 2 },
          abr: { bandwidthDowngradeTarget: 0.85, switchInterval: 3 },
        });
        var curEst = _getSmoothedBandwidthKbps();
        var biasedEst = curEst > 0 ? Math.round(curEst * 0.6) : 1500;
        _player.configure({ abr: { defaultBandwidthEstimate: biasedEst * 1000 } });
      } else {
        _player.configure({
          streaming: { bufferingGoal: 20, rebufferingGoal: 2 },
          abr: { bandwidthDowngradeTarget: 0.92, switchInterval: 3 },
        });
        var curEst2 = _getSmoothedBandwidthKbps();
        if (curEst2 > 0) {
          var biasedUp = Math.round(curEst2 * 1.15);
          _player.configure({ abr: { defaultBandwidthEstimate: biasedUp * 1000 } });
        }
      }
    } catch(e) { console.warn('[Player] setNetworkQuality:', e.message); }
  }

  function setMaxResolution(width, height) {
    if (!_player) return;
    try {
      if (!width || !height) {
        _player.configure({
          abr: { enabled: true, restrictions: { maxWidth: Infinity, maxHeight: Infinity } },
        });
        _abrFrozen = false;
        _bufGoodStreak = 0;
        _bufBadStreak = 0;
      } else {
        _player.configure({ abr: { restrictions: { maxWidth: width, maxHeight: height } } });
        _abrFrozen = true;
        _abrFrozenUntil = Date.now() + 3600000;
      }
    } catch(e) {}
  }

  function selectQuality(label) {
    if (!_player) return;
    if (label === 'auto') { setMaxResolution(0, 0); return; }
    var variants = _getSortedVariants();
    if (!variants.length) return;
    var target = null;
    if (label === 'best') {
      target = variants[variants.length - 1];
    } else if (label === 'worst') {
      target = variants[0];
    } else {
      var h = parseInt(label, 10);
      if (!isNaN(h)) {
        target = variants.reduce(function (best, v) {
          if (!v.height) return best;
          var d  = Math.abs(v.height - h);
          var bd = best ? Math.abs(best.height - h) : Infinity;
          return d < bd ? v : best;
        }, null);
      }
    }
    if (target) {
      _abrFrozen = true;
      _abrFrozenUntil = Date.now() + ABR_FREEZE_MS;
      _selectVariant(target);
    }
  }

  function getQualityLevels() {
    var variants = _getSortedVariants();
    if (!variants.length) return [];
    return variants.map(function (v) {
      var label = v.height ? (v.height + 'p') : ((v.bandwidth / 1000000).toFixed(1) + ' Mbps');
      return { label: label, height: v.height || 0, bandwidth: v.bandwidth, active: !!v.active };
    });
  }

  // ── Visibility & unload ───────────────────────────────────────
  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) {
      _videoEl.pause();
      _stopAbrWatcher();
    } else {
      _startAbrWatcher();
      if (_lastLoadSucceeded && _currentUrl && _videoEl.paused) {
        _videoEl.play().catch(function () {});
      }
    }
  }

  function _onPageHide() {
    _stopAbrWatcher();
    if (_videoEl) _videoEl.pause();
    if (_player && !_unloading) {
      _unloading = true;
      _player.unload().catch(function(){}).then(function(){ _unloading = false; });
    }
    _currentUrl = '';
  }

  // ── DRM error handler ─────────────────────────────────────────
  async function _handleError(ev) {
    var err  = ev && ev.detail;
    var code = err && err.code;
    console.error('[Player] Shaka error', code, err && err.message);

    if (code >= 6000 && code <= 6999 && _drmLevelIdx < DRM_LEVELS.length - 1) {
      _drmLevelIdx++;
      var lvl = DRM_LEVELS[_drmLevelIdx];
      var drmCfg = { advanced: { 'com.widevine.alpha': {} } };
      if (lvl.video) drmCfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) drmCfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
      _player.configure({ drm: drmCfg });
      if (_currentUrl) {
        var retryInfo = _lastStreamInfo;
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, retryInfo, true); });
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
    if (info.drm_url && typeof info.drm_url === 'string') {
      cfg.servers['com.widevine.alpha'] = info.drm_url;
      cfg.advanced['com.widevine.alpha'] = {};
      if (lvl.video) cfg.advanced['com.widevine.alpha'].videoRobustness = lvl.video;
      if (lvl.audio) cfg.advanced['com.widevine.alpha'].audioRobustness = lvl.audio;
    } else if (info.key && info.iv) {
      var kid = info.key_id || info.kid || info.key;
      var key = info.key;
      if (kid && key &&
          /^[0-9a-fA-F]{32}$/.test(kid.replace(/-/g,'')) &&
          /^[0-9a-fA-F]{32}$/.test(key.replace(/-/g,''))) {
        cfg.servers['org.w3.clearkey'] = '';
        cfg.clearKeys = {};
        cfg.clearKeys[kid.replace(/-/g,'')] = key.replace(/-/g,'');
      }
    }
    return Object.keys(cfg.servers).length ? cfg : null;
  }

  // ── Core load with timeout, fallbacks, fast ramp ──────────────
  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;
    if (!isDrmRetry) _lastStreamInfo = streamInfo;
    if (!isDrmRetry) _drmLevelIdx = 0;

    var mySeq = ++_loadSeq;
    var drmCfg = _buildDrmConfig(streamInfo);
    var timeoutId = null;
    _lastLoadSucceeded = false;

    _bwSamples    = [];
    _bufGoodStreak = 0;
    _bufBadStreak  = 0;
    _lastSwitchTime = 0;
    _abrFrozen     = false;
    _inRebufferCooldown = false;

    try {
      await new Promise(function (resolve, reject) {
        timeoutId = setTimeout(function () {
          if (_player && !_unloading) {
            _unloading = true;
            _player.unload().catch(function(){}).then(function(){ _unloading = false; });
          }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);

        (async function doLoad() {
          if (mySeq !== _loadSeq) { resolve(); return; }
          if (!_unloading) {
            _unloading = true;
            await _player.unload().catch(function(){});
            _unloading = false;
          }
          if (mySeq !== _loadSeq) { resolve(); return; }

          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });

          if (!isDrmRetry) {
            _player.configure({ abr: {
              enabled: true,
              restrictions: { maxWidth: Infinity, maxHeight: Infinity },
            }});
          }

          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; }
          await _videoEl.play().catch(function(){});
          _scheduleFastRamp();   // <-- fast ramp after start
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true;
          CB.onTechUpdate();
        })().then(function () { clearTimeout(timeoutId); resolve(); })
          .catch(function (e) { clearTimeout(timeoutId); reject(e); });
      });
    } catch (err) {
      _lastLoadSucceeded = false;
      if (err.message === 'LOAD_TIMEOUT') {
        CB.onError('Load timeout', 0); throw err;
      }
      if (url.endsWith('.ts')) {
        try {
          var m3u = url.replace(/\.ts$/, '.m3u8');
          if (!_unloading) { _unloading = true; await _player.unload().catch(function(){}); _unloading = false; }
          if (mySeq === _loadSeq) {
            await _player.load(m3u);
            await _videoEl.play().catch(function(){});
            _scheduleFastRamp();
            _currentUrl = m3u; _lastLoadSucceeded = true; CB.onTechUpdate(); return;
          }
        } catch (eA) {}
      }
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

  function play(url, streamInfo) {
    if (!url) return Promise.resolve();
    _loadPromise = _loadPromise.then(function () {
      return _load(url, streamInfo, false);
    }).catch(function (err) {
      console.warn('[Player] play error:', err && err.message);
    });
    return _loadPromise;
  }

  function stop() {
    _currentUrl        = '';
    _lastLoadSucceeded = false;
    _loadSeq++;
    _resetAbrCounters();
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

  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr     = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var active = tr.find(function (t) { return t.active; });
      var stats  = _player.getStats ? _player.getStats() : null;
      var buf    = _getBufferAhead();
      var estKbps= _getSmoothedBandwidthKbps();
      var parts  = [];
      if (active && active.width && active.height) parts.push(active.width + '×' + active.height);
      if (stats && stats.streamBandwidth) parts.push((stats.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      if (active && active.frameRate) parts.push(Math.round(active.frameRate) + 'fps');
      if (active && active.videoCodec) parts.push(active.videoCodec.split('.')[0]);
      if (buf >= 0) parts.push('buf ' + buf.toFixed(1) + 's');
      if (estKbps > 0) parts.push('↕' + (estKbps / 1000).toFixed(1) + ' Mbps');
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
      if (!r || r.length === 0) return false;
      return (r.end(0) - r.start(0)) > 2;
    } catch (e) { return false; }
  }

  function currentUrl() { return _currentUrl; }
  function isReady()    { return _initialised && !!_player; }

  return {
    init:              init,
    play:              play,
    stop:              stop,
    setNetworkQuality: setNetworkQuality,
    setMaxResolution:  setMaxResolution,
    selectQuality:     selectQuality,
    getQualityLevels:  getQualityLevels,
    getTechInfo:       getTechInfo,
    getAudioTracks:    getAudioTracks,
    setAudioLanguage:  setAudioLanguage,
    isSeekable:        isSeekable,
    currentUrl:        currentUrl,
    isReady:           isReady,
  };

})();

if (typeof window !== 'undefined') window.SagaPlayer = SagaPlayer;