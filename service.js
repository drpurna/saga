// ================================================================
// SAGA IPTV — service.js v25
// TizenBrew background service
// Handles: heartbeat, crash recovery, telemetry stub
// ================================================================
'use strict';

let _heartbeatTimer = null;
let _startTime = Date.now();

module.exports = {
  onLoad() {
    console.log('[SAGA-Service] Loaded · v25 · ' + new Date().toISOString());
    _startTime = Date.now();
    _startHeartbeat();
  },

  onUnload() {
    console.log('[SAGA-Service] Unloading after', Math.round((Date.now() - _startTime) / 1000), 's');
    _stopHeartbeat();
  }
};

function _startHeartbeat() {
  _heartbeatTimer = setInterval(() => {
    const uptime = Math.round((Date.now() - _startTime) / 1000);
    console.log('[SAGA-Service] Heartbeat · uptime=' + uptime + 's');
  }, 60000); // every 60s
}

function _stopHeartbeat() {
  if (_heartbeatTimer) { clearInterval(_heartbeatTimer); _heartbeatTimer = null; }
}
