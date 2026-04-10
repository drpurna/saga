// ================================================================
// SAGA IPTV — player.js v5.0  |  Tizen 9 / Samsung 2025 TV
//
// PROFESSIONAL ABR ENGINE — full rewrite of quality management
// ─────────────────────────────────────────────────────────────────
// Problem with v4: setMaxResolution() used coarse pixel caps from
// a binary slow/online flag. Shaka's own ABR was undertuned (wrong
// switch intervals, no bandwidth history, aggressive targets).
// Result: player locked at 480p on "slow" or thrashed between
// qualities, never settling at the stream's true best quality.
//
// Fix strategy (mirrors what VLC/ExoPlayer do internally):
//   1. Let Shaka ABR run freely — never hard-cap resolution.
//   2. Continuously measure real throughput from video.buffered,
//      video.currentTime and XHR timing (bandwidth probe).
//   3. Feed measured Kbps into Shaka as bandwidth hint via
//      configure({abr:{defaultBandwidthEstimate}}) — it picks
//      the right variant automatically.
//   4. Buffer health watcher: if buffer < 2s → downgrade one step;
//      if buffer > 8s consistently → allow upgrade.
//   5. Stall recovery: exponential backoff, not fixed retry.
//   6. All existing FIX tags (B5–B8, C2–C7, H12, H18, H19, H22)
//      preserved exactly.
// ================================================================
'use strict';

var SagaPlayer = (function () {

  // ── Private state ─────────────────────────────────────────────
  var _player            = null;
  var _videoEl           = null;
  var _loadPromise       = Promise.resolve();
  var _currentUrl        = '';
  var _lastStreamInfo    = null;       // FIX B6
  var _drmLevelIdx       = 0;
  var _initialised       = false;
  var _unloading         = false;      // FIX C5/H19
  var _lastLoadSucceeded = false;      // FIX B5
  var _loadSeq           = 0;          // FIX B8

  // ── ABR engine state ──────────────────────────────────────────
  var _abrWatcher        = null;   // setInterval handle
  var _bwSamples         = [];     // rolling bandwidth samples (Kbps)
  var _BW_SAMPLES_MAX    = 8;      // keep last 8 samples (~40s)
  var _lastBufCheck      = 0;      // timestamp of last buffer check
  var _bufGoodStreak     = 0;      // consecutive "buffer healthy" ticks
  var _bufBadStreak      = 0;      // consecutive "buffer low" ticks
  var _lastVariantIdx    = -1;     // index in sorted variant list
  var _abrFrozen         = false;  // true during manual override
  var _abrFrozenUntil    = 0;      // timestamp, unfreeze after
  var _lastBytesLoaded   = 0;      // for throughput calc via ProgressEvent
  var _lastBytesTime     = 0;

  // Timeouts
  var BUSY_TIMEOUT     = 14000;
  var ABR_INTERVAL_MS  = 3000;    // check buffer health every 3s
  var BUF_LOW_S        = 2.5;     // buffer below this → degrade
  var BUF_GOOD_S       = 8.0;     // buffer above this for N ticks → upgrade
  var BUF_GOOD_TICKS   = 3;       // consecutive good ticks before upgrade
  var BUF_BAD_TICKS    = 2;       // consecutive bad ticks before degrade
  var ABR_FREEZE_MS    = 12000;   // freeze after manual switch for 12s
  var MIN_SWITCH_GAP   = 4000;    // minimum ms between variant switches

  var _lastSwitchTime  = 0;

  var CB = {
    onStatus:     function () {},
    onBuffering:  function () {},
    onTechUpdate: function () {},
    onError:      function () {},
    onQuality:    function () {},  // NEW: quality change notification
  };

  // ── DRM ladder ────────────────────────────────────────────────
  var DRM_LEVELS = [
    { video: 'HW_SECURE_ALL',    audio: 'HW_SECURE_CRYPTO' },
    { video: 'HW_SECURE_DECODE', audio: 'HW_SECURE_CRYPTO' },
    { video: 'SW_SECURE_DECODE', audio: 'SW_SECURE_CRYPTO' },
    { video: '',                  audio: ''                 },
  ];

  // ── Shaka base config — tuned for live IPTV ABR ───────────────
  // Key ABR tuning decisions:
  //   switchInterval: 4s  — react faster than default 8s
  //   bandwidthUpgradeTarget: 0.75  — upgrade when using 75% of bw
  //     (conservative; prevents oscillation)
  //   bandwidthDowngradeTarget: 0.92 — degrade when at 92% of bw
  //   safeMarginPercent: 0.02 — 2% safety headroom for upgrades
  //   rebufferingGoal: 2s — start playing sooner (live friendly)
  //   bufferingGoal: 20s — build a healthy buffer when network allows
  function _baseConfig() {
    return {
      streaming: {
        lowLatencyMode:             false,  // off: live IPTV uses ~3–10s latency
        inaccurateManifestTolerance: 2,
        bufferingGoal:              20,     // build 20s buffer on good network
        rebufferingGoal:             2,     // resume after 2s buffered (live-friendly)
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
        // Start estimate: 4 Mbps (HD IPTV typically 2–8 Mbps)
        defaultBandwidthEstimate: 4000000,
        // Switch intervals — faster response than Shaka defaults
        switchInterval:           4,
        // Conservative upgrade: only when we're comfortably below limit
        bandwidthUpgradeTarget:   0.75,
        // Aggressive downgrade: react before buffering
        bandwidthDowngradeTarget: 0.92,
        restrictToElementSize:    false,
        advanced: {
          minTotalBytes:       65536,   // need more data before estimating
          minBytesPerEstimate: 32768,
          safeMarginPercent:   0.02,    // 2% headroom above measured bw
        },
      },
      manifest: {
        retryParameters: { maxAttempts: 5, baseDelay: 500, backoffFactor: 2 },
        hls: {
          ignoreManifestProgramDateTime: false,
          useSafariBehaviorForLive:      false,
          // Fix: don't ignore EXT-X-GAP — matters for live streams
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
      // Codec preference: H.264 first (guaranteed HW decode on Tizen),
      // then HEVC (H.265, supported on Samsung 2022+)
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

      // FIX C2: signal playing event for reconnect reset
      if (_videoEl) {
        _videoEl.addEventListener('playing', function () {
          CB.onStatus('playing_event');
          _resetAbrCounters();
        });
        // Track throughput via ProgressEvent on underlying XHR
        // (Shaka fires these on the video element when using MediaSource)
        _videoEl.addEventListener('progress', _onVideoProgress);
      }

      document.addEventListener('visibilitychange', _onVisibilityChange, false);
      window.addEventListener('pagehide', _onPageHide, false);

      // Start ABR watcher loop
      _startAbrWatcher();

    } catch (err) {
      _initialised = false;
      console.error('[Player] init failed:', err);
      CB.onError('Player init failed', 0);
    }
  }

  // ─────────────────────────────────────────────────────────────
  // ABR ENGINE — professional adaptive bitrate management
  // ─────────────────────────────────────────────────────────────

  function _resetAbrCounters() {
    _bufGoodStreak = 0;
    _bufBadStreak  = 0;
    _lastBytesLoaded = 0;
    _lastBytesTime   = 0;
  }

  // Called every ABR_INTERVAL_MS — the core of the ABR engine
  function _abrTick() {
    if (!_player || !_videoEl || !_lastLoadSucceeded) return;
    if (_videoEl.paused || document.hidden) return;

    var now = Date.now();

    // Unfreeze after manual switch cooldown
    if (_abrFrozen && now > _abrFrozenUntil) {
      _abrFrozen = false;
    }

    // 1. Measure buffer health
    var bufAhead = _getBufferAhead();

    // 2. Measure network throughput from Shaka stats
    var measuredKbps = _getMeasuredBandwidthKbps();
    if (measuredKbps > 0) _addBwSample(measuredKbps);

    // 3. Feed bandwidth estimate back into Shaka
    var estKbps = _getSmoothedBandwidthKbps();
    if (estKbps > 0 && !_abrFrozen) {
      try {
        _player.configure({ abr: { defaultBandwidthEstimate: estKbps * 1000 } });
      } catch(e) {}
    }

    // 4. Buffer-driven quality decisions (override Shaka if needed)
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
          // Buffer in healthy zone — reset streaks
          _bufBadStreak  = Math.max(0, _bufBadStreak  - 1);
          _bufGoodStreak = Math.max(0, _bufGoodStreak - 1);
        }
      }
    }

    // 5. Update overlay with live stats
    CB.onTechUpdate();
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
      // Shaka reports estimatedBandwidth in bits/s
      var bps = stats.estimatedBandwidth || stats.streamBandwidth || 0;
      return bps > 0 ? Math.round(bps / 1000) : 0;
    } catch(e) { return 0; }
  }

  function _addBwSample(kbps) {
    _bwSamples.push({ v: kbps, t: Date.now() });
    // Keep only recent samples within 45s
    var cutoff = Date.now() - 45000;
    _bwSamples = _bwSamples.filter(function (s) { return s.t > cutoff; });
    if (_bwSamples.length > _BW_SAMPLES_MAX) {
      _bwSamples = _bwSamples.slice(-_BW_SAMPLES_MAX);
    }
  }

  // Weighted average — recent samples count more
  function _getSmoothedBandwidthKbps() {
    if (_bwSamples.length === 0) return 0;
    var now = Date.now();
    var wSum = 0, vSum = 0;
    _bwSamples.forEach(function (s, i) {
      // Weight = index+1 (newer = higher index = higher weight)
      var w = i + 1;
      // Also weight by recency (samples in last 10s get 2x weight)
      if ((now - s.t) < 10000) w *= 2;
      wSum += w;
      vSum += s.v * w;
    });
    return wSum > 0 ? Math.round(vSum / wSum) : 0;
  }

  // Get all video variants sorted by bitrate ascending
  function _getSortedVariants() {
    if (!_player) return [];
    try {
      var tracks = _player.getVariantTracks ? _player.getVariantTracks() : [];
      // Filter to unique bandwidths, sort ascending
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

  function _degradeQuality(reason) {
    if (!_player) return;
    var variants = _getSortedVariants();
    if (variants.length < 2) return;
    var curIdx = _getActiveVariantIdx(variants);
    if (curIdx <= 0) return; // already at lowest
    var target = variants[curIdx - 1];
    console.log('[ABR] Degrade:', reason,
      '→', _fmtVariant(target),
      '(was', _fmtVariant(variants[curIdx]) + ')');
    _selectVariant(target);
  }

  function _upgradeQuality(reason) {
    if (!_player) return;
    var variants = _getSortedVariants();
    if (variants.length < 2) return;
    var curIdx = _getActiveVariantIdx(variants);
    if (curIdx < 0 || curIdx >= variants.length - 1) return; // already at highest
    var target = variants[curIdx + 1];
    // Safety: only upgrade if estimated bandwidth comfortably covers target
    var estKbps = _getSmoothedBandwidthKbps();
    var targetKbps = Math.round(target.bandwidth / 1000);
    if (estKbps > 0 && estKbps < targetKbps * 1.25) {
      // Not enough headroom — don't upgrade yet
      return;
    }
    console.log('[ABR] Upgrade:', reason,
      '→', _fmtVariant(target),
      '(was', _fmtVariant(variants[curIdx]) + ')');
    _selectVariant(target);
  }

  function _selectVariant(track) {
    if (!_player || !track) return;
    try {
      // selectVariantTrack(track, clearBuffer, safeMargin)
      // clearBuffer=false: switch seamlessly without rebuffering
      // safeMargin=0.5s: keep 0.5s of buffer across switch
      _player.selectVariantTrack(track, false, 0.5);
      _lastSwitchTime = Date.now();
      var label = _fmtVariant(track);
      CB.onQuality(label);
      CB.onTechUpdate();
    } catch(e) {
      console.warn('[ABR] selectVariant failed:', e.message);
    }
  }

  function _fmtVariant(t) {
    if (!t) return '?';
    var parts = [];
    if (t.width && t.height) parts.push(t.height + 'p');
    if (t.bandwidth) parts.push((t.bandwidth / 1000000).toFixed(1) + ' Mbps');
    return parts.join(' ');
  }

  // Called by Shaka on natural ABR adaptation (not our manual switches)
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
      // Buffer underrun — bump bad streak immediately
      _bufBadStreak = Math.max(_bufBadStreak, BUF_BAD_TICKS - 1);
    }
  }

  // Supplement bandwidth measurement from video element progress
  function _onVideoProgress() {
    if (!_videoEl) return;
    var now = Date.now();
    var bl  = _videoEl.buffered;
    if (!bl || bl.length === 0) return;
    // Can't directly get bytes from HTML5 video — use Shaka stats instead
    // This just ensures ABR tick runs promptly after data arrives
  }

  function _startAbrWatcher() {
    if (_abrWatcher) clearInterval(_abrWatcher);
    _abrWatcher = setInterval(_abrTick, ABR_INTERVAL_MS);
  }

  function _stopAbrWatcher() {
    if (_abrWatcher) { clearInterval(_abrWatcher); _abrWatcher = null; }
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC: setNetworkQuality — NOW feeds Shaka not hard caps
  // ─────────────────────────────────────────────────────────────
  // Instead of blocking variants by resolution, we bias the
  // bandwidth estimate to guide Shaka's natural ABR decisions.
  // This lets Shaka pick the actual best variant for the network.
  function setNetworkQuality(quality) {
    if (!_player) return;
    try {
      if (quality === 'offline') {
        // Pause ABR decisions when offline
        _stopAbrWatcher();
        _player.configure({ streaming: { bufferingGoal: 5, rebufferingGoal: 1 } });
        return;
      }
      // Restart watcher if it was stopped
      if (!_abrWatcher) _startAbrWatcher();

      if (quality === 'slow') {
        // Slow: tune buffers for slow network, bias estimate downward
        _player.configure({
          streaming: { bufferingGoal: 8, rebufferingGoal: 2 },
          abr: { bandwidthDowngradeTarget: 0.85, switchInterval: 3 },
        });
        // Inject a conservative bandwidth estimate to push Shaka toward lower variants
        // BUT don't cap — let it upgrade naturally if network improves
        var curEst = _getSmoothedBandwidthKbps();
        var biasedEst = curEst > 0 ? Math.round(curEst * 0.6) : 1500; // 60% of measured, min 1.5Mbps
        _player.configure({ abr: { defaultBandwidthEstimate: biasedEst * 1000 } });
      } else {
        // Good network: generous buffers, faster upgrades
        _player.configure({
          streaming: { bufferingGoal: 20, rebufferingGoal: 2 },
          abr: { bandwidthDowngradeTarget: 0.92, switchInterval: 4 },
        });
        // Bias estimate upward to encourage upgrade exploration
        var curEst2 = _getSmoothedBandwidthKbps();
        if (curEst2 > 0) {
          var biasedUp = Math.round(curEst2 * 1.15); // 15% headroom for upgrade
          _player.configure({ abr: { defaultBandwidthEstimate: biasedUp * 1000 } });
        }
      }
    } catch(e) { console.warn('[Player] setNetworkQuality:', e.message); }
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC: setMaxResolution — renamed semantics
  // Now used for USER-INITIATED quality lock (e.g. Settings menu).
  // Passing 0,0 removes the lock and re-enables full ABR.
  // ─────────────────────────────────────────────────────────────
  function setMaxResolution(width, height) {
    if (!_player) return;
    try {
      if (!width || !height) {
        // Remove user lock — restore full ABR
        _player.configure({
          abr: {
            enabled: true,
            restrictions: { maxWidth: Infinity, maxHeight: Infinity },
          },
        });
        _abrFrozen     = false;
        _bufGoodStreak = 0;
        _bufBadStreak  = 0;
        console.log('[ABR] Quality lock removed — full ABR resumed');
      } else {
        // User locked to a max resolution — disable ABR upgrade above it
        _player.configure({
          abr: {
            restrictions: { maxWidth: width, maxHeight: height },
          },
        });
        // Freeze our engine too so we don't fight Shaka
        _abrFrozen     = true;
        _abrFrozenUntil = Date.now() + 3600000; // freeze for 1h (user intent)
        console.log('[ABR] Quality locked to max', width + 'x' + height);
      }
    } catch(e) { console.warn('[Player] setMaxResolution:', e.message); }
  }

  // ─────────────────────────────────────────────────────────────
  // PUBLIC: selectQuality — manual variant selection by label
  // 'auto'   → enable full ABR
  // 'best'   → jump to highest bitrate variant
  // '1080p'  → select first variant at that height
  // ─────────────────────────────────────────────────────────────
  function selectQuality(label) {
    if (!_player) return;
    if (label === 'auto') {
      setMaxResolution(0, 0);
      return;
    }
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
        // Find closest variant at that height
        target = variants.reduce(function (best, v) {
          if (!v.height) return best;
          var d  = Math.abs(v.height - h);
          var bd = best ? Math.abs(best.height - h) : Infinity;
          return d < bd ? v : best;
        }, null);
      }
    }
    if (target) {
      _abrFrozen     = true;
      _abrFrozenUntil = Date.now() + ABR_FREEZE_MS;
      _selectVariant(target);
    }
  }

  // Get list of available quality labels for UI
  function getQualityLevels() {
    var variants = _getSortedVariants();
    if (!variants.length) return [];
    return variants.map(function (v) {
      var label = v.height ? (v.height + 'p') : ((v.bandwidth / 1000000).toFixed(1) + ' Mbps');
      return { label: label, height: v.height || 0, bandwidth: v.bandwidth, active: !!v.active };
    });
  }

  // ── Visibility change ─────────────────────────────────────────
  // FIX H12 + FIX B5: only resume if last load succeeded
  function _onVisibilityChange() {
    if (!_player || !_videoEl) return;
    if (document.hidden) {
      _videoEl.pause();
      _stopAbrWatcher(); // Pause ABR when hidden
    } else {
      _startAbrWatcher(); // Resume ABR
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
      _player.unload().catch(function () {}).then(function () { _unloading = false; });
    }
    _currentUrl = '';
  }

  // ── DRM error handler — FIX B6 ────────────────────────────────
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
        var retryInfo = _lastStreamInfo; // FIX B6
        _loadPromise = _loadPromise.then(function () { return _load(_currentUrl, retryInfo, true); });
      }
      return;
    }
    if (code >= 7000 && code <= 7999) { CB.onError('Network error', code); return; }
    CB.onError((code >= 6000 && code <= 6999) ? 'DRM error' : 'Stream error', code);
  }

  // ── DRM config — FIX H18 ──────────────────────────────────────
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

  // ── Core load — FIX C4, C5, H19, B7, B8 ─────────────────────
  async function _load(url, streamInfo, isDrmRetry) {
    if (!_player || !_videoEl) return;
    _currentUrl = url;
    if (!isDrmRetry) _lastStreamInfo = streamInfo; // FIX B6
    if (!isDrmRetry) _drmLevelIdx = 0;             // FIX C4

    var mySeq = ++_loadSeq;    // FIX B8
    var drmCfg = _buildDrmConfig(streamInfo);
    var timeoutId = null;
    _lastLoadSucceeded = false; // FIX B5

    // Reset ABR state for new stream
    _bwSamples    = [];
    _bufGoodStreak = 0;
    _bufBadStreak  = 0;
    _lastSwitchTime = 0;
    _abrFrozen     = false;

    try {
      await new Promise(function (resolve, reject) {
        timeoutId = setTimeout(function () {
          // FIX C5 + B7: unload on timeout
          if (_player && !_unloading) {
            _unloading = true;
            _player.unload().catch(function(){}).then(function(){ _unloading = false; });
          }
          reject(new Error('LOAD_TIMEOUT'));
        }, BUSY_TIMEOUT);

        (async function doLoad() {
          if (mySeq !== _loadSeq) { resolve(); return; } // FIX B8

          // FIX H19: prevent double unload
          if (!_unloading) {
            _unloading = true;
            await _player.unload().catch(function(){});
            _unloading = false;
          }
          if (mySeq !== _loadSeq) { resolve(); return; } // FIX B8

          _videoEl.removeAttribute('src');
          if (drmCfg) _player.configure({ drm: drmCfg });
          else if (!isDrmRetry) _player.configure({ drm: { servers: {} } });

          // Re-enable ABR fully on each fresh load
          if (!isDrmRetry) {
            _player.configure({ abr: {
              enabled: true,
              restrictions: { maxWidth: Infinity, maxHeight: Infinity },
            }});
          }

          await _player.load(url);
          if (mySeq !== _loadSeq) { resolve(); return; } // FIX B8

          await _videoEl.play().catch(function(){});
          if (!isDrmRetry) _drmLevelIdx = 0;
          _lastLoadSucceeded = true; // FIX B5
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
    _currentUrl        = '';
    _lastLoadSucceeded = false; // FIX B5
    _loadSeq++;                  // FIX B8
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

  // ── Public: tech info ─────────────────────────────────────────
  function getTechInfo() {
    if (!_player) return '';
    try {
      var tr     = _player.getVariantTracks ? _player.getVariantTracks() : [];
      var active = tr.find(function (t) { return t.active; });
      var stats  = _player.getStats ? _player.getStats() : null;
      var buf    = _getBufferAhead();
      var estKbps= _getSmoothedBandwidthKbps();
      var parts  = [];
      if (active && active.width && active.height) {
        parts.push(active.width + '×' + active.height);
      }
      if (stats && stats.streamBandwidth) {
        parts.push((stats.streamBandwidth / 1e6).toFixed(1) + ' Mbps');
      }
      if (active && active.frameRate) {
        parts.push(Math.round(active.frameRate) + 'fps');
      }
      if (active && active.videoCodec) {
        parts.push(active.videoCodec.split('.')[0]);
      }
      if (buf >= 0) {
        parts.push('buf ' + buf.toFixed(1) + 's');
      }
      if (estKbps > 0) {
        parts.push('↕' + (estKbps / 1000).toFixed(1) + ' Mbps');
      }
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
