// player.js - Handles video playback using Shaka Player

let player = null;
let currentVideoElement = null;

function initPlayer(videoElement) {
    if (!videoElement) {
        console.error('initPlayer: No video element provided');
        return false;
    }

    currentVideoElement = videoElement;

    // Check if Shaka Player is available
    if (typeof shaka === 'undefined') {
        console.error('Shaka Player library not loaded');
        return false;
    }

    if (!shaka.Player.isBrowserSupported()) {
        console.warn('Shaka Player not supported in this browser');
        return false;
    }

    // Destroy existing player if any
    if (player) {
        player.destroy();
        player = null;
    }

    // Create new player instance
    player = new shaka.Player(videoElement);
    player.addEventListener('error', onPlayerError);
    player.addEventListener('buffering', onBuffering);
    console.log('Shaka Player initialized');
    return true;
}

async function playStream(streamUrl) {
    if (!player) {
        console.error('Player not initialized');
        return false;
    }

    if (!streamUrl) {
        console.error('No stream URL provided');
        return false;
    }

    try {
        console.log('Loading stream:', streamUrl);
        await player.load(streamUrl);
        console.log('Playback started successfully');
        return true;
    } catch (error) {
        console.error('Playback error:', error);
        // Show user-friendly error
        if (currentVideoElement) {
            currentVideoElement.poster = '';
        }
        return false;
    }
}

function stopStream() {
    if (player) {
        player.unload();
        console.log('Stream stopped');
    }
}

function onPlayerError(event) {
    const error = event.detail;
    console.error('Shaka error code:', error.code, 'details:', error);
    // Attempt to recover for certain errors
    if (error.code === 1002 || error.code === 1003) { // NETWORK or MANIFEST error
        console.log('Attempting to recover...');
        setTimeout(() => {
            if (player && player.getManifestUri()) {
                player.load(player.getManifestUri()).catch(e => console.warn('Recovery failed', e));
            }
        }, 3000);
    }
}

function onBuffering(event) {
    console.log('Buffering event:', event.buffering);
    // Optionally show/hide a loading spinner in your UI
}

// Clean up when page unloads
window.addEventListener('beforeunload', () => {
    if (player) {
        player.destroy();
        player = null;
    }
});