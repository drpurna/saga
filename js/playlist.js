// playlist.js - Fetches and parses the dynamic M3U playlist from GitHub Releases

const PLAYLIST_URL = 'https://github.com/drpurna/saga/releases/latest/download/channels.m3u';

async function loadChannels() {
    try {
        console.log('Fetching playlist from:', PLAYLIST_URL);
        const response = await fetch(PLAYLIST_URL);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const m3uText = await response.text();
        const channels = parseM3U(m3uText);
        console.log(`Loaded ${channels.length} channels`);
        return channels;
    } catch (err) {
        console.error('Failed to load playlist:', err);
        return [];
    }
}

function parseM3U(data) {
    const lines = data.split(/\r?\n/);
    const channels = [];
    let current = {};

    for (let line of lines) {
        line = line.trim();
        if (line.startsWith('#EXTINF')) {
            // Extract channel name from #EXTINF line
            const match = line.match(/#EXTINF:-?\d+(?:.*?),(.+)/);
            if (match && match[1]) {
                current.name = match[1].trim();
            }
        } else if (line && !line.startsWith('#')) {
            current.url = line;
            if (current.name && current.url) {
                channels.push({ name: current.name, url: current.url });
                current = {};
            }
        }
    }
    return channels;
}