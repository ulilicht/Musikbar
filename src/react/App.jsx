import React from 'react';
import './App.css';
import MenuBarContainer from "./MenuBarContainer/MenuBarContainer";
import ErrorBoundary from "./ErrorBoundary/ErrorBoundary";
import Settings from './Settings';
import MusicAssistantClient from './MusicAssistantClient';
import { api } from './api/tauri';
import { Settings as SettingsIcon } from 'react-feather';

class App extends React.Component {
    constructor(props) {
        super(props);
        this.musicAssistant = null; // Will init after config load
        this.didAutoSelectZoneOnFirstLaunch = false;
        this.unlistenSettings = null;
        this.state = {
            view: 'loading', // 'loading' | 'main' | 'settings' | 'setup_required' | 'error'
            isReady: false,
            config: null,
            selectedZoneUdn: '',
            nowPlaying: {},
            availableZones: [],
            leavingZoneUdns: [],
            favourites: [],
            error: null
        };
    }

    componentDidMount() {
        // Listen for route changes (hash)
        window.addEventListener('hashchange', this.handleHashChange.bind(this));
        
        // Listen for config updates
        api.onSettingsUpdated(this.loadConfig.bind(this)).then(unlisten => {
            this.unlistenSettings = unlisten;
        });

        // Initial load
        this.handleHashChange();
        this.loadConfig();
    }
    
    componentWillUnmount() {
         window.removeEventListener('hashchange', this.handleHashChange.bind(this));
         if (this.unlistenSettings) this.unlistenSettings();
    }

    handleHashChange() {
        const hash = window.location.hash;
        if (hash === '#settings') {
            this.setState({ view: 'settings' });
        } else {
            // Only switch back to main if we have config, otherwise check config again
             if (this.state.view === 'settings') {
                 // Potentially reloading main view
                 this.loadConfig();
             }
        }
    }

    async loadConfig() {
        const settings = await api.getSettings();
        this.setState({ config: settings }, () => {
            if (this.state.isReady) {
                this.loadFavourites();
            }
        });

        if (this.state.view === 'settings') return;

        if (settings.musicAssistantUrl && settings.musicAssistantToken) {
            // We have config, initialize MA
            this.initializeClient(settings.musicAssistantUrl, settings.musicAssistantToken);
        } else {
            this.setState({ view: 'setup_required' });
        }
    }
    
    initializeClient(url, token) {
        if (this.musicAssistant) {
            // Already initialized, check if we need to reconnect (e.g. url changed)?
            // For simplicity, for now we assume reload on big config changes or just reconnect if simple
             if (this.musicAssistant.url !== url || this.musicAssistant.token !== token) {
                 // Re-init (simple way: just reload window or handle disconnect)
                 // Let's create new instance
                 this.musicAssistant.removeAllListeners();
                 // Close old ws?
             } else {
                 return; // No change
             }
        }
        
        this.musicAssistant = new MusicAssistantClient(url, token);
        window.musicAssistant = this.musicAssistant; // For debugging

        this.musicAssistant.on('systemReady', this.handleSystemReady.bind(this));
        this.musicAssistant.on('stateChanged', this.handleStateChanged.bind(this));
        this.musicAssistant.on('connectionError', this.handleConnectionError.bind(this));
        
        this.musicAssistant.connect();
        this.setState({ view: 'loading', error: null, isReady: false });
    }

    handleSystemReady(ready) {
        console.log('EVENT: systemReady', ready);
        this.setState({ isReady: ready });
        if (ready) {
            this.setState({ view: 'main', error: null });
            this.loadFavourites();
        }
    }

    handleConnectionError(error) {
        this.setState({
            view: 'error',
            error: error,
            isReady: false
        });
    }

    handleStateChanged(stateData) {
        if (!this.state.isReady) return;

        const { players, queues } = stateData;
        const availableZones = this.mapPlayersToZones(players, queues || []);

        this.setState({ availableZones });

        // Auto-select logic
        let selectedZoneObj = this.getSelectedZone(availableZones);
        if (!this.didAutoSelectZoneOnFirstLaunch || !selectedZoneObj) {
            this.didAutoSelectZoneOnFirstLaunch = true;
            let autoSelectZone = null;
            if (localStorage.selectedZoneName) {
                autoSelectZone = availableZones.find(zone => zone.name === localStorage.selectedZoneName);
            }
            if (!autoSelectZone && availableZones.length > 0) {
                autoSelectZone = availableZones[0];
            }
            
            if (autoSelectZone) {
                this.setZone(autoSelectZone);
                selectedZoneObj = autoSelectZone; // Update local ref
            }
        } else {
             // If we already have a selection, update its nowPlaying status from the new data
             // We need to re-find the updated player object in the new list
             const updatedSelectedZone = availableZones.find(z => z.udn === this.state.selectedZoneUdn);
             if (updatedSelectedZone) {
                 this.loadNowPlaying(updatedSelectedZone);
             }
        }
    }
    
    mapPlayersToZones(players, queues = []) {
        if (!Array.isArray(players)) {
            console.error('[App] players is not an array', players);
            return [];
        }

        // Collect all child player IDs across all sync groups and group players
        const syncedChildIds = new Set();
        players.forEach(pl => {
            if (pl.synced_to) {
                syncedChildIds.add(pl.player_id);
            }
            if (Array.isArray(pl.group_childs)) {
                pl.group_childs.forEach(cid => {
                    if (cid !== pl.player_id) syncedChildIds.add(cid);
                });
            }
            if (Array.isArray(pl.group_members)) {
                pl.group_members.forEach(mid => {
                    if (mid !== pl.player_id) syncedChildIds.add(mid);
                });
            }
        });

        // Map MA Player -> UI Zone
        // UI expects: { name, udn, isZone: ?, isPlaying }
        // Filter out players based on sync status and visibility settings
        return players.filter(p => {
             // Synced child/follower players in a group should never be shown separately
             if (syncedChildIds.has(p.player_id)) {
                 return false;
             }

             // Default hidden flags if missing (safety check)
             const hiddenFlags = p.hide_player_in_ui || [];

             // Check if hidden because unavailable
             if (!p.available && hiddenFlags.includes('when_unavailable')) {
                 return false;
             }
             
             // Check if hidden because synced
             if (p.synced_to) {
                 return false;
             }
             
             return true;
        }).map(p => {
            const queue = queues.find(q => q.queue_id === p.player_id);
            if (!queue) {
               // console.warn(`[App] No queue found for player ${p.name} (${p.player_id})`);
            }
            
            // Resolve group member names from player IDs
            let groupMemberNames = [];
            if (Array.isArray(p.group_childs) && p.group_childs.length > 0) {
                groupMemberNames = p.group_childs.map(childId => {
                    const childPlayer = players.find(pl => pl.player_id === childId);
                    return childPlayer ? childPlayer.name : childId;
                });
            }
            
            // Build display name: for groups, show all member names joined with +
            const displayName = groupMemberNames.length > 0 
                ? groupMemberNames.join(' + ')
                : p.name;
            
            return {
                name: displayName,
                udn: p.player_id,
                isZone: p.type === 'group' || p.type === 'stereo_pair',
                isGroup: (p.type === 'group' || p.type === 'stereo_pair') || (groupMemberNames.length > 0),
                isPlaying: p.state === 'playing',
                _raw: p, // Keep raw player
                _queue: queue // Keep raw queue
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
    }
    
    getSelectedZone(zones = this.state.availableZones) {
        return zones.find(zone => zone.udn === this.state.selectedZoneUdn);
    }
    
    resolveImageUrl(imageUrl) {
        if (!imageUrl || typeof imageUrl !== 'string') return '';
        const configuredUrl = this.state.config?.musicAssistantUrl;
        if (!configuredUrl) return imageUrl;

        const cleanConfigUrl = configuredUrl.replace(/\/+$/, '');

        // Relative path: e.g. /imageproxy/...
        if (imageUrl.startsWith('/')) {
            return cleanConfigUrl + imageUrl;
        }

        // Check if the URL points to a local/private IP or localhost (often returned by MA backend)
        try {
            const urlObj = new URL(imageUrl);
            const host = urlObj.hostname;
            const isLocal = host.startsWith('192.168.') ||
                            host.startsWith('10.') ||
                            host.startsWith('172.16.') ||
                            host.startsWith('172.17.') ||
                            host.startsWith('172.18.') ||
                            host.startsWith('172.19.') ||
                            host.startsWith('172.2') ||
                            host.startsWith('172.3') ||
                            host === 'localhost' ||
                            host === '127.0.0.1';

            if (isLocal) {
                const targetObj = new URL(cleanConfigUrl);
                urlObj.protocol = targetObj.protocol;
                urlObj.hostname = targetObj.hostname;
                urlObj.port = targetObj.port;
                return urlObj.toString();
            }
        } catch (e) {
            // Not a parseable URL, return as is
        }

        return imageUrl;
    }

    loadNowPlaying(zoneObj) {
        if (!zoneObj || !zoneObj._raw) return;
        const player = zoneObj._raw;
        const queue = zoneObj._queue;
        
        // Map MA Player state to UI NowPlaying
        // { artist, track, image, isPlaying, isLoading, isMuted, volume, canPlayPause, canPlayNext }

        const features = player.supported_features || [];
        const activeSource = player.source_list?.find(s => s.id === player.active_source);
        const sourceCanPlayPause = activeSource ? Boolean(activeSource.can_play_pause) : false;
        const sourceCanNextPrevious = activeSource ? Boolean(activeSource.can_next_previous) : false;

        const isPlaying = player.state === 'playing' || player.playback_state === 'playing';
        const isPaused = player.state === 'paused' || player.playback_state === 'paused';
        const hasQueueItem = Boolean(queue && (queue.current_item || (queue.items && queue.items > 0)));

        const canPlayPause = features.includes('pause') ||
                             features.includes('play_pause') ||
                             sourceCanPlayPause ||
                             isPlaying ||
                             (isPaused && hasQueueItem);

        let canPlayNext = features.includes('next') ||
                          features.includes('next_previous') ||
                          sourceCanNextPrevious;

        // Logic to determine if we can play next based on queue if player doesn't validly report it
        if (!canPlayNext && queue) {
             const itemCount = typeof queue.items === 'number' ? queue.items : (Array.isArray(queue.items) ? queue.items.length : 0);
             const currentIndex = (queue.current_index !== undefined && queue.current_index !== null) ? queue.current_index : -1;
             if (itemCount > currentIndex + 1) {
                 canPlayNext = true;
             }
        }
        
        const metadata = this.extractMetadata(player, queue);
        // console.log('[App] Loaded metadata for', zoneObj.name, metadata);

        this.setState({
            nowPlaying: {
                // Metadata priority: Queue Item -> Player Metadata
                 ...metadata,
                
                isPlaying: isPlaying,
                isLoading: false, 
                isMuted: player.volume_muted,
                volume: player.volume_level,
                canPlayPause: canPlayPause,
                canPlayNext: canPlayNext
            }
        });
    }
    
    extractMetadata(player, queue) {
        // Check if an external source / plugin source is active (AirPlay, Spotify Connect, etc.)
        // When an external source is active, the queue contains stale data from the last MA playback,
        // but player.current_media has the actual current metadata from the source.
        const isExternalSourceActive = Boolean(
            (player.active_source && player.active_source !== player.player_id) ||
            player.current_media?.media_type === 'audio_source' ||
            player.current_media?.media_type === 'plugin_source' ||
            (queue && queue.active === false && (player.state === 'playing' || player.playback_state === 'playing'))
        );
        
        // If an external source is active, prefer player.current_media
        if (isExternalSourceActive && player.current_media) {
            const media = player.current_media;
            return {
                artist: media.artist || '',
                track: media.title || '',
                image: this.resolveImageUrl(media.image_url || '')
            };
        }
        
        // Try Queue Item for regular MA playback
        if (queue && queue.active !== false && queue.current_item) {
            const item = queue.current_item;
            const mediaItem = item.media_item;
            const isRadio = mediaItem?.media_type === 'radio' || item.streamdetails?.media_type === 'radio';
            
            // Artist resolution: item.artist -> item.artists -> mediaItem.artists -> mediaItem.artist
            let artist = '';
            if (item.artist) {
                artist = typeof item.artist === 'string' ? item.artist : (item.artist.name || '');
            } else if (Array.isArray(item.artists) && item.artists.length > 0) {
                artist = item.artists.map(a => typeof a === 'string' ? a : (a.name || '')).filter(Boolean).join(', ');
            } else if (mediaItem) {
                if (mediaItem.artist) {
                    artist = typeof mediaItem.artist === 'string' ? mediaItem.artist : (mediaItem.artist.name || '');
                } else if (Array.isArray(mediaItem.artists) && mediaItem.artists.length > 0) {
                    artist = mediaItem.artists.map(a => typeof a === 'string' ? a : (a.name || '')).filter(Boolean).join(', ');
                }
            }
            if (!artist && item.streamdetails?.stream_metadata?.artist) {
                artist = item.streamdetails.stream_metadata.artist;
            }
            if (!artist && player.current_media?.artist) {
                artist = player.current_media.artist;
            }

            // Track title resolution: for radio, prefer current ICY stream title over station name
            let track = '';
            if (isRadio && item.streamdetails?.stream_metadata?.title) {
                track = item.streamdetails.stream_metadata.title;
            } else if (isRadio && player.current_media?.title && player.current_media?.media_type === 'radio') {
                track = player.current_media.title;
            } else {
                track = (mediaItem && mediaItem.name) || item.name || player.current_media?.title || '';
            }

            // Image resolution
            let rawImage = '';
            if (item.image) {
                rawImage = typeof item.image === 'string' ? item.image : (item.image.path || '');
            } else if (mediaItem?.metadata?.images?.length > 0) {
                rawImage = mediaItem.metadata.images[0].path || '';
            } else if (item.streamdetails?.stream_metadata?.image_url) {
                rawImage = item.streamdetails.stream_metadata.image_url;
            } else if (player.current_media?.image_url) {
                rawImage = player.current_media.image_url;
            }

            return {
                artist: artist || '',
                track: track || '',
                image: this.resolveImageUrl(rawImage)
            };
        }
        
        // Fallback to player current_media
        const media = player.current_media;
        if (!media) return { artist: '', track: '', image: '' };
        
        return {
            artist: media.artist || '',
            track: media.title || '',
            image: this.resolveImageUrl(media.image_url || '')
        };
    }

    loadFavourites() { // Renamed from loadRecentlyPlayed to be more generic, though logic inside needs update
        const source = this.state.config?.favouritesSource || 'recents';
        
        // Map settings values to recommendation category IDs
        const categoryMap = {
            'recents': 'recently_played',
            'radio': 'favorite_radio',
            'favorites_playlist': 'favorite_playlists',
            'random_artist': 'random_artists'
        };
        
        const categoryId = categoryMap[source] || 'recently_played';
        const limit = 20;

        this.musicAssistant.getRecommendationsByCategory(categoryId, limit).then(items => {
             // Map to favorites format: { name, image, id, class }
             // MA items have different image locations:
             // - Recently played: item.image (string or { path, ... })
             // - Library items (radios, playlists, artists): item.metadata.images (array of { path, type, ... })
             const mapped = items.map(item => {
                 let rawImagePath = '';
                 if (item.image) {
                     rawImagePath = typeof item.image === 'string' ? item.image : (item.image.path || '');
                 } else if (item.metadata?.images?.length > 0) {
                     rawImagePath = item.metadata.images[0].path || '';
                 }
                 const imageUrl = this.resolveImageUrl(rawImagePath);
                 
                 return {
                     name: item.name,
                     image: imageUrl,
                     id: item.item_id || item.uri, // Some items might not have item_id
                     uri: item.uri, // Use URI for playing back
                     class: item.media_type, // reusing 'class' field for media type
                     _mediaItem: item // Store full object for play_media to expand albums/playlists
                 };
             });
             
             this.setState({ favourites: mapped });
        }).catch(e => {
            console.error('Failed to load favourites', e);
            this.setState({ favourites: [] });
        });
    }

    // --- Actions ---

    setMute() {
        const zone = this.getSelectedZone();
        if (zone) this.musicAssistant.setMute(zone.udn, !this.state.nowPlaying.isMuted);
    }

    playFavourite(item) {
        // Playing a media item (track/album/playlist) on the current player
        const zone = this.getSelectedZone();
        if (!zone) return;
        
        // Pass full media object for albums/playlists to expand tracks
        // Fallback to URI for items without stored object
        const media = item._mediaItem || item.uri || item.id;
        
        this.musicAssistant.sendCommand('player_queues/play_media', { 
            queue_id: zone.udn, 
            media: media
        }).catch(e => {
            console.error('Failed to play media', e);
        });
    }

    setZone(zone) {
        this.setState({ selectedZoneUdn: zone.udn });
        localStorage.selectedZoneName = zone.name;
        this.loadNowPlaying(zone);
    }

    setVolume(targetVolume) {
        const zone = this.getSelectedZone();
        if (zone) this.musicAssistant.setVolume(zone.udn, targetVolume);
    }

    setPause() {
        const zone = this.getSelectedZone();
        if (zone) this.musicAssistant.playPause(zone.udn);
    }

    setNext() {
        const zone = this.getSelectedZone();
        if (zone) this.musicAssistant.next(zone.udn);
    }

    joinZone(targetZone) {
        const selectedZone = this.getSelectedZone();
        if (!selectedZone || !targetZone || !this.musicAssistant) return;

        // Trigger leaving animation on the joined target zone immediately
        this.setState(prevState => ({
            leavingZoneUdns: [...prevState.leavingZoneUdns, targetZone.udn]
        }));

        this.musicAssistant.joinPlayer(selectedZone.udn, targetZone.udn).then(() => {
            return this.musicAssistant.sendCommand('players/all');
        }).then(freshPlayers => {
            if (Array.isArray(freshPlayers)) {
                freshPlayers.forEach(p => {
                    this.musicAssistant.players[p.player_id] = p;
                });
                this.musicAssistant.emitState();
            }
        }).catch(err => {
            console.error('Failed to join zone', err);
            // Revert animation state on error
            this.setState(prevState => ({
                leavingZoneUdns: prevState.leavingZoneUdns.filter(id => id !== targetZone.udn)
            }));
        });

        // Clean up leaving state after animation completes
        setTimeout(() => {
            this.setState(prevState => ({
                leavingZoneUdns: prevState.leavingZoneUdns.filter(id => id !== targetZone.udn)
            }));
        }, 600);
    }

    ungroupZone(zone) {
        const targetZone = zone || this.getSelectedZone();
        if (!targetZone || !this.musicAssistant) return;
        const player = targetZone._raw;
        if (!player) return;

        // Find all child players joined to this group/leader
        const children = [];
        if (Array.isArray(player.group_childs)) {
            player.group_childs.forEach(id => {
                if (id !== player.player_id) children.push(id);
            });
        }
        if (Array.isArray(player.group_members)) {
            player.group_members.forEach(id => {
                if (id !== player.player_id && !children.includes(id)) children.push(id);
            });
        }
        const allPlayers = Object.values(this.musicAssistant.players || {});
        allPlayers.forEach(p => {
            if (p.synced_to === player.player_id && !children.includes(p.player_id)) {
                children.push(p.player_id);
            }
        });

        this.musicAssistant.ungroupPlayer(player.player_id, children).then(() => {
            return this.musicAssistant.sendCommand('players/all');
        }).then(freshPlayers => {
            if (Array.isArray(freshPlayers)) {
                freshPlayers.forEach(p => {
                    this.musicAssistant.players[p.player_id] = p;
                });
                this.musicAssistant.emitState();
            }
        }).catch(err => {
            console.error('Failed to ungroup zone', err);
        });
    }

    transferQueue(targetZone) {
        const selectedZone = this.getSelectedZone();
        if (!selectedZone || !targetZone || !this.musicAssistant) return;
        this.musicAssistant.transferQueue(selectedZone.udn, targetZone.udn, true).then(() => {
            this.setZone(targetZone);
        }).catch(err => {
            console.error('Failed to transfer queue', err);
        });
    }

    async handleFavouritesSourceChange(source) {
        // Get current settings and update only the favouritesSource
        const currentSettings = await api.getSettings();
        await api.saveSettings({
            ...currentSettings,
            favouritesSource: source
        });
        // Update local config and reload favourites
        this.setState({
            config: { ...this.state.config, favouritesSource: source }
        }, () => {
            this.loadFavourites();
        });
    }

    render() {
        if (this.state.view === 'settings') {
            return <Settings />;
        }

        if (this.state.view === 'setup_required') {
            return (
                <div className="app">
                    <div className="card-wrapper rounded setup-required">
                        <h2>Welcome to Musikbar!</h2>
                        <p>Please configure your Music Assistant connection.</p>
                        <div className="ma-button-wrapper">
                            <button className="ma-button" onClick={() => api.openSettings()}>
                                <div className="ma-button-icon">
                                    <SettingsIcon />
                                </div>
                                <div className="ma-button-text">Open Settings</div>
                            </button>
                        </div>
                    </div>
                </div>
            )
        }

        if (this.state.view === 'error') {
            return (
                <div className="app">
                    <div className="card-wrapper rounded setup-required">
                        <h2>Connection issue</h2>
                        <p>{this.state.error?.message || 'Unable to connect to Music Assistant.'}</p>
                        {this.state.error?.detail ? (
                            <div className="error-details">{this.state.error.detail}</div>
                        ) : null}
                        <div className="ma-button-wrapper">
                            <button className="ma-button" onClick={() => api.openSettings()}>
                                <div className="ma-button-icon">
                                    <SettingsIcon />
                                </div>
                                <div className="ma-button-text">Open Settings</div>
                            </button>
                        </div>
                    </div>
                </div>
            )
        }

        const shouldRender = this.state.isReady && (this.state.nowPlaying !== undefined);
        return (
            <div className="app">
                <ErrorBoundary>
                    {shouldRender ?
                        <MenuBarContainer availableZones={this.state.availableZones}
                                          nowPlaying={this.state.nowPlaying}
                                          selectedZoneUdn={this.state.selectedZoneUdn}
                                          setZone={this.setZone.bind(this)}
                                          setVolume={this.setVolume.bind(this)}
                                          setMute={this.setMute.bind(this)}
                                          favourites={this.state.favourites}
                                          favouritesSource={this.state.config?.favouritesSource || 'recents'}
                                          onFavouritesSourceChange={this.handleFavouritesSourceChange.bind(this)}
                                          setPause={this.setPause.bind(this)}
                                          setNext={this.setNext.bind(this)}
                                          joinZone={this.joinZone.bind(this)}
                                          ungroupZone={this.ungroupZone.bind(this)}
                                          transferQueue={this.transferQueue.bind(this)}
                                          leavingZoneUdns={this.state.leavingZoneUdns}
                                          playFavourite={this.playFavourite.bind(this)}
                                          musicAssistantUrl={this.state.config?.musicAssistantUrl}
                                          shownShortcuts={this.state.config?.shownShortcuts || { ma: true, spotify: true, apple: false }}
                        /> : <div className="loading">
                            Connecting...
                        </div>}
                </ErrorBoundary>
            </div>
        );
    }
}


export default App;
