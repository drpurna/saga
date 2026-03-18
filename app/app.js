class IPTVApp {
    constructor() {
        this.channels = [];
        this.currentChannel = null;
        this.hls = null;
        this.videoPlayer = document.getElementById('video-player');
        this.playerContainer = document.getElementById('player-container');
        this.content = document.getElementById('content');
        this.splashScreen = document.getElementById('splash-screen');
        this.sidePanel = document.getElementById('side-panel');
        this.menuToggle = document.getElementById('menu-toggle');
        this.searchOverlay = document.getElementById('search-overlay');
        this.searchInput = document.getElementById('search-input');
        this.searchButton = document.getElementById('search-button');
        this.startTime = Date.now();

        this.init();
    }

    async init() {
        await this.loadChannels();
        this.renderSidePanel();
        this.renderRows();
        this.setupEventListeners();
        this.hideSplash();
    }

    hideSplash() {
        const elapsed = Date.now() - this.startTime;
        const minDisplay = 1500;
        const delay = Math.max(0, minDisplay - elapsed);

        setTimeout(() => {
            if (this.splashScreen) {
                this.splashScreen.classList.add('hidden');
                setTimeout(() => {
                    if (this.splashScreen && this.splashScreen.parentNode) {
                        this.splashScreen.parentNode.removeChild(this.splashScreen);
                    }
                }, 500);
            }
        }, delay);
    }

    async loadChannels() {
        try {
            const response = await fetch('https://iptv-org.github.io/iptv/languages/tel.m3u');
            const m3u = await response.text();
            this.channels = this.parseM3U(m3u);
        } catch {
            console.warn('M3U fetch failed, using fallback data');
            this.channels = this.getFallbackChannels();
        }
    }

    parseM3U(m3u) {
        const lines = m3u.split('\n');
        const channels = [];
        let current = {};
        lines.forEach(line => {
            line = line.trim();
            if (line.startsWith('#EXTINF:')) {
                const nameMatch = line.match(/,([^,]+)$/);
                const name = nameMatch ? nameMatch[1] : 'Unknown';
                const groupMatch = line.match(/group-title="([^"]+)"/);
                const category = groupMatch ? groupMatch[1].toLowerCase() : 'general';
                const logoMatch = line.match(/tvg-logo="([^"]+)"/);
                const logoUrl = logoMatch ? logoMatch[1] : null;
                const chnoMatch = line.match(/tvg-chno="([^"]+)"/);
                const chno = chnoMatch ? chnoMatch[1] : null;
                current = {
                    name,
                    category,
                    logoUrl,
                    chno,
                    program: 'Live'
                };
            } else if (line && !line.startsWith('#')) {
                current.streamUrl = line;
                current.id = channels.length + 1;
                if (!current.chno) {
                    current.chno = String(100 + channels.length);
                }
                channels.push(current);
                current = {};
            }
        });
        return channels;
    }

    getFallbackChannels() {
        return [
            { id:1, name:'BBC News', category:'news', logoUrl:null, chno:'101', program:'World News', streamUrl:'' },
            { id:2, name:'Sky Sports', category:'sports', logoUrl:null, chno:'202', program:'Football Live', streamUrl:'' },
            { id:3, name:'HBO', category:'movies', logoUrl:null, chno:'305', program:'Movie: Inception', streamUrl:'' },
            { id:4, name:'Comedy Central', category:'entertainment', logoUrl:null, chno:'410', program:'Stand-up', streamUrl:'' },
            { id:5, name:'CNN', category:'news', logoUrl:null, chno:'102', program:'Breaking News', streamUrl:'' },
            { id:6, name:'ESPN', category:'sports', logoUrl:null, chno:'203', program:'NBA Tonight', streamUrl:'' },
            { id:7, name:'Fox News', category:'news', logoUrl:null, chno:'103', program:'The Story', streamUrl:'' },
            { id:8, name:'Nat Geo', category:'entertainment', logoUrl:null, chno:'411', program:'Wildlife', streamUrl:'' }
        ];
    }

    renderSidePanel() {
        const items = this.sidePanel.querySelectorAll('.panel-item[data-category]');
        items.forEach(item => {
            item.addEventListener('click', () => {
                const category = item.dataset.category;
                this.filterByCategory(category);
                this.closePanel();
            });
        });
    }

    filterByCategory(category) {
        this.currentCategory = category;
        this.sidePanel.querySelectorAll('.panel-item').forEach(item => {
            item.classList.toggle('active', item.dataset.category === category);
        });
        const targetRow = document.getElementById(`row-${category}`);
        if (targetRow) {
            targetRow.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }

    renderRows() {
        const categories = {
            recommended: this.channels.slice(0, 10),
            news: this.channels.filter(c => c.category === 'news'),
            sports: this.channels.filter(c => c.category === 'sports'),
            movies: this.channels.filter(c => c.category === 'movies'),
            entertainment: this.channels.filter(c => c.category === 'entertainment')
        };

        const categoryNames = {
            recommended: 'Recommended',
            news: 'News',
            sports: 'Sports',
            movies: 'Movies',
            entertainment: 'Entertainment'
        };

        let html = '';
        for (let [cat, channels] of Object.entries(categories)) {
            if (channels.length === 0) continue;
            html += `
                <div class="category-row" id="row-${cat}">
                    <div class="row-header">
                        <h2 class="row-title">${categoryNames[cat] || cat}</h2>
                        <span class="row-link" data-focusable="true">More ›</span>
                    </div>
                    <div class="channel-strip" id="strip-${cat}">
                        ${channels.map(ch => {
                            return `
                            <div class="channel-item" data-channel-id="${ch.id}" data-focusable="true">
                                <div class="channel-thumb">
                                    ${ch.logoUrl 
                                        ? `<img class="channel-logo" src="${ch.logoUrl}" alt="${ch.name}" loading="lazy" onerror="this.classList.add('error'); this.style.display='none'; this.parentElement.querySelector('.fallback-emoji').style.display='block';">` 
                                        : ''}
                                    <span class="fallback-emoji" style="${ch.logoUrl ? 'display:none;' : 'display:block;'}">📺</span>
                                    <span class="channel-number">${ch.chno}</span>
                                </div>
                                <div class="channel-info">
                                    <div class="channel-name">${ch.name}</div>
                                    <div class="channel-program">${ch.program}</div>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                </div>
            `;
        }
        this.content.innerHTML = html;

        document.querySelectorAll('.channel-item').forEach(el => {
            el.addEventListener('click', () => this.playChannel(el.dataset.channelId));
            el.addEventListener('tv-enter', () => this.playChannel(el.dataset.channelId));
        });

        document.querySelectorAll('.row-link').forEach(el => {
            el.addEventListener('click', (e) => e.stopPropagation());
        });

        if (window.navigationModule) window.navigationModule.rescan();
    }

    playChannel(channelId) {
        const channel = this.channels.find(c => c.id == channelId);
        if (!channel || !channel.streamUrl) {
            alert('Stream not available');
            return;
        }
        this.currentChannel = channel;
        this.showPlayer();
        this.loadStream(channel.streamUrl);
    }

    showPlayer() {
        this.playerContainer.classList.remove('hidden');
        this.videoPlayer.focus();
    }

    hidePlayer() {
        this.playerContainer.classList.add('hidden');
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        this.videoPlayer.pause();
        this.videoPlayer.src = '';
    }

    loadStream(url) {
        if (Hls.isSupported()) {
            this.hls = new Hls({
                maxBufferLength: 10,
                maxMaxBufferLength: 20,
                liveSyncDurationCount: 3,
                liveMaxLatencyDurationCount: 5
            });
            this.hls.loadSource(url);
            this.hls.attachMedia(this.videoPlayer);
            this.hls.on(Hls.Events.MANIFEST_PARSED, () => {
                this.videoPlayer.play().catch(e => console.warn('Autoplay prevented:', e));
            });
            this.hls.on(Hls.Events.ERROR, (event, data) => {
                console.error('HLS error:', data);
                alert('Stream error – try another channel');
            });
        } else if (this.videoPlayer.canPlayType('application/vnd.apple.mpegurl')) {
            this.videoPlayer.src = url;
            this.videoPlayer.play().catch(e => console.warn('Autoplay prevented:', e));
        } else {
            alert('Unsupported stream format');
        }
    }

    // Search
    openSearch() {
        this.searchOverlay.classList.remove('hidden');
        this.searchInput.focus();
        if (window.navigationModule) window.navigationModule.rescan();
    }

    closeSearch() {
        this.searchOverlay.classList.add('hidden');
        this.searchInput.value = '';
        this.searchButton.focus();
        if (window.navigationModule) window.navigationModule.rescan();
    }

    performSearch(query) {
        if (!query.trim()) {
            this.renderRows();
            return;
        }
        const filtered = this.channels.filter(ch => 
            ch.name.toLowerCase().includes(query.toLowerCase()) ||
            (ch.category && ch.category.toLowerCase().includes(query.toLowerCase()))
        );
        this.content.innerHTML = `
            <div class="category-row">
                <div class="row-header">
                    <h2 class="row-title">Search Results: "${query}"</h2>
                </div>
                <div class="channel-strip">
                    ${filtered.map(ch => `
                        <div class="channel-item" data-channel-id="${ch.id}" data-focusable="true">
                            <div class="channel-thumb">
                                ${ch.logoUrl 
                                    ? `<img class="channel-logo" src="${ch.logoUrl}" alt="${ch.name}" loading="lazy" onerror="this.classList.add('error'); this.style.display='none'; this.parentElement.querySelector('.fallback-emoji').style.display='block';">` 
                                    : ''}
                                <span class="fallback-emoji" style="${ch.logoUrl ? 'display:none;' : 'display:block;'}">📺</span>
                                <span class="channel-number">${ch.chno}</span>
                            </div>
                            <div class="channel-info">
                                <div class="channel-name">${ch.name}</div>
                                <div class="channel-program">${ch.program}</div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
        document.querySelectorAll('.channel-item').forEach(el => {
            el.addEventListener('click', () => this.playChannel(el.dataset.channelId));
            el.addEventListener('tv-enter', () => this.playChannel(el.dataset.channelId));
        });
        if (window.navigationModule) window.navigationModule.rescan();
    }

    // UI helpers
    togglePanel() {
        this.sidePanel.classList.toggle('open');
        if (this.sidePanel.classList.contains('open')) {
            const firstItem = this.sidePanel.querySelector('.panel-item');
            if (firstItem) firstItem.focus();
        }
        if (window.navigationModule) window.navigationModule.rescan();
    }

    closePanel() {
        this.sidePanel.classList.remove('open');
        this.menuToggle.focus();
        if (window.navigationModule) window.navigationModule.rescan();
    }

    setupEventListeners() {
        // Menu toggle
        this.menuToggle.addEventListener('click', () => this.togglePanel());
        this.menuToggle.addEventListener('tv-enter', () => this.togglePanel());

        // Close panel when clicking outside
        document.addEventListener('click', (e) => {
            if (this.sidePanel.classList.contains('open') &&
                !this.sidePanel.contains(e.target) &&
                !this.menuToggle.contains(e.target)) {
                this.closePanel();
            }
        });

        // Player close
        document.querySelector('.close-player').addEventListener('click', () => this.hidePlayer());
        document.querySelector('.close-player').addEventListener('tv-enter', () => this.hidePlayer());

        // Search button
        this.searchButton.addEventListener('click', () => this.openSearch());
        this.searchButton.addEventListener('tv-enter', () => this.openSearch());

        // Search close button
        const closeBtn = this.searchOverlay.querySelector('.search-close');
        closeBtn.addEventListener('click', () => this.closeSearch());
        closeBtn.addEventListener('tv-enter', () => this.closeSearch());

        // Search input Enter
        this.searchInput.addEventListener('keydown', (e) => {
            if (e.keyCode === 13) {
                e.preventDefault();
                this.performSearch(this.searchInput.value);
                this.closeSearch();
            }
        });

        // Remote red key (403) opens/closes search
        window.addEventListener('tv-red', () => {
            if (this.searchOverlay.classList.contains('hidden')) {
                this.openSearch();
            } else {
                this.closeSearch();
            }
        });

        // Global back button
        window.addEventListener('tv-back', () => {
            if (!this.playerContainer.classList.contains('hidden')) {
                this.hidePlayer();
            } else if (this.sidePanel.classList.contains('open')) {
                this.closePanel();
            } else if (!this.searchOverlay.classList.contains('hidden')) {
                this.closeSearch();
            }
        });

        // Passive scroll
        document.addEventListener('scroll', () => {}, { passive: true });
    }
}

new IPTVApp();