import React from 'react';
import './App.css';
import MenuBarContainer from "./MenuBarContainer/MenuBarContainer";
import ErrorBoundary from "./ErrorBoundary/ErrorBoundary";
import Settings from './Settings';
import MusicAssistantClient from './MusicAssistantClient';
import { Settings as SettingsIcon } from 'react-feather';

class App extends React.Component {
    constructor(props) {
        super(props);
        this.musicAssistant = null; // Will init after config load
        this.didAutoSelectZoneOnFirstLaunch = false;
        this.state = {
            view: 'loading', // 'loading' | 'main' | 'settings' | 'setup_required'
            isReady: false,
            config: null,
            selectedZoneUdn: '',
            nowPlaying: {},
            availableZones: [],
            favourites: [] 
        };
    }

    componentDidMount() {
        // Listen for route changes (hash)
        window.addEventListener('hashchange', this.handleHashChange.bind(this));
        
        // Listen for config updates
        window.ipcRenderer.on('settings-updated', this.loadConfig.bind(this));

        // Initial load
        this.handleHashChange();
        this.loadConfig();
    }
    
    componentWillUnmount() {
         window.removeEventListener('hashchange', this.handleHashChange.bind(this));
         window.ipcRenderer.removeAllListeners('settings-updated');
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
        const settings = await window.ipcRenderer.invoke('get-settings');
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
        
        this.musicAssistant.connect();
        this.setState({ view: 'loading' });
    }

    handleSystemReady(ready) {
        console.log('EVENT: systemReady', ready);
        this.setState({ isReady: ready });
        if (ready) {
            this.setState({ view: 'main' });
            this.loadFavourites();
        }
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
        // Map MA Player -> UI Zone
        // UI expects: { name, udn, isZone: ?, isPlaying }
        // We'll treat every player as a "Zone" for now.
        return players.map(p => {
            const queue = queues.find(q => q.queue_id === p.player_id);
            if (!queue) {
               console.warn(`[App] No queue found for player ${p.name} (${p.player_id})`);
            }
            return {
                name: p.name,
                udn: p.player_id,
                isZone: p.type === 'group' || p.type === 'stereo_pair',
                isPlaying: p.state === 'playing',
                _raw: p, // Keep raw player
                _queue: queue // Keep raw queue
            };
        }).sort((a, b) => a.name.localeCompare(b.name));
    }
    
    getSelectedZone(zones = this.state.availableZones) {
        return zones.find(zone => zone.udn === this.state.selectedZoneUdn);
    }
    
    loadNowPlaying(zoneObj) {
        if (!zoneObj || !zoneObj._raw) return;
        const player = zoneObj._raw;
        const queue = zoneObj._queue;
        
        // Map MA Player state to UI NowPlaying
        // { artist, track, image, isPlaying, isLoading, isMuted, volume, canPlayPause, canPlayNext }
        
        // Check if a plugin source is active (AirPlay, Spotify Connect, etc.)
        // When a plugin is active, the queue contains stale data, use player state instead
        const isPluginActive = player.active_source && 
            player.active_source !== player.player_id &&
            player.current_media?.media_type === 'plugin_source';
        
        const features = player.supported_features || [];
        const canPlayPause = features.includes('pause') || features.includes('play_pause');
        let canPlayNext = features.includes('next');
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
        
        // Determine playing state: use player.state for plugins, queue.state for normal MA playback
        const isPlaying = isPluginActive 
            ? player.state === 'playing' 
            : (queue ? queue.state === 'playing' : player.state === 'playing');

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
        // Check if a plugin source is active (AirPlay, Spotify Connect, etc.)
        // When a plugin is active, the queue contains stale data from the last MA playback,
        // but player.current_media has the actual current metadata from the plugin.
        const isPluginActive = player.active_source && 
            player.active_source !== player.player_id &&
            player.current_media?.media_type === 'plugin_source';
        
        // If a plugin is active, prefer player.current_media
        if (isPluginActive && player.current_media) {
            const media = player.current_media;
            return {
                artist: media.artist || '',
                track: media.title || '',
                image: media.image_url || ''
            };
        }
        
        // Try Queue Item for regular MA playback
        if (queue && queue.current_item) {
            const item = queue.current_item;
            return {
                artist: item.artist ? item.artist.name : (item.artists ? item.artists.map(a=>a.name).join(', ') : ''),
                track: item.name || '',
                image: item.image ? (item.image.path || item.image) : ''
            };
        }
        
        // console.log('[App] No current_item in queue', queue);
        
        // Fallback to player current_media
        const media = player.current_media;
        if (!media) return { artist: '', track: '', image: '' };
        
        return {
            artist: media.artist || '',
            track: media.title || '',
            image: media.image_url || ''
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
                 let imageUrl = '';
                 const serverUrl = this.state.config?.musicAssistantUrl || '';
                 
                 // First, try the direct image property (used by recently_played_items)
                 if (item.image) {
                     if (typeof item.image === 'string') {
                         imageUrl = item.image;
                     } else if (item.image.path) {
                         imageUrl = item.image.remotely_accessible 
                             ? item.image.path 
                             : serverUrl + item.image.path;
                     }
                 }
                 // Fallback: check metadata.images (used by library items like radios, playlists, artists)
                 else if (item.metadata?.images?.length > 0) {
                     const firstImage = item.metadata.images[0];
                     if (firstImage.path) {
                         imageUrl = firstImage.remotely_accessible 
                             ? firstImage.path 
                             : serverUrl + firstImage.path;
                     }
                 }
                 
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

    async handleFavouritesSourceChange(source) {
        // Get current settings and update only the favouritesSource
        const currentSettings = await window.ipcRenderer.invoke('get-settings');
        await window.ipcRenderer.invoke('save-settings', {
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
                            <button className="ma-button" onClick={() => window.ipcRenderer.send('open-settings')}>
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
