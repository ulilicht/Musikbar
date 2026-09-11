import React, { useState, useRef, useEffect } from 'react';
import {Pause, Play, Volume2, VolumeX, Speaker, Layers, Loader, Music, FastForward, ChevronDown, Link, ArrowRightCircle} from 'react-feather';
import './MenuBarContainer.css';
import { api } from '../api/tauri';
import RangeSlider from '../components/RangeSlider';

// Lucide Icon 'unlink' (ISC License)
// Copyright (c) 2026 Lucide Icons and Contributors (https://lucide.dev)
const Unlink = ({ size = 24, color = 'currentColor', ...props }) => (
    <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" />
        <path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" />
        <line x1="8" x2="8" y1="2" y2="5" />
        <line x1="2" x2="5" y1="8" y2="8" />
        <line x1="16" x2="16" y1="19" y2="22" />
        <line x1="19" x2="22" y1="16" y2="16" />
    </svg>
);

class VolumeSlider extends React.Component {
    constructor(props) {
        super(props);
        this.state = {
            volumeValueInternal: props.nowPlaying.volume
        };
        this.mouseWheelEventInProgress = false;
    }

    setVolumeValueInternal(value) {
        this.setState({
            volumeValueInternal: value
        });
    }

    changeVolume() {
        this.props.setVolume(this.state.volumeValueInternal);
    }

    componentDidUpdate(prevProps) {
        if (this.props.nowPlaying.volume && (this.props.nowPlaying.volume !== prevProps.nowPlaying.volume)) {
            this.setVolumeValueInternal(this.props.nowPlaying.volume);
        }
    }

    onWheel(event) {
        if (event.deltaX !== 0) {
            const scrollIncrement = Math.sign(event.deltaX) * 0.3;
            this.setVolumeValueInternal(this.state.volumeValueInternal - scrollIncrement);


            // when adjusting the volume with mousewheel, send the change only every 1 second to outside.
            if (this.mouseWheelEventInProgress === false) {
                this.mouseWheelEventInProgress = true;
                setTimeout(() => {
                    this.mouseWheelEventInProgress = false;
                    this.changeVolume();
                }, 1000);
            }
        }
    }

    render() {
        return (
            <div className='volume-slider rounded module-bg' onWheel={(e) => this.onWheel(e)}>
                <div className='volume-slider-headline'>Volume</div>
                <div className='volume-slider-inner'>
                    <button type='button' className='icon' onClick={() => this.props.setMute()}>
                        <div style={{display: this.props.nowPlaying.isMuted ? 'inline-block' : 'none'}}>
                            <VolumeX/>
                        </div>
                        <div style={{display: this.props.nowPlaying.isMuted ? 'none' : 'inline-block'}}>
                            <Volume2/>
                        </div>
                    </button>
                    <div className='volume-slider-range'>
                        <RangeSlider
                            min={0}
                            max={100}
                            value={this.state.volumeValueInternal}
                            onChange={value => this.setVolumeValueInternal(value)}
                            onChangeComplete={() => this.changeVolume()}
                        />
                    </div>
                </div>
            </div>
        )
    }
}

const CurrentlyPlaying = (props) => {
    let playIcon = '';
    if (props.nowPlaying.isLoading) {
        playIcon = <Loader className='currently-playing-loading'/>
    } else {
        playIcon = props.nowPlaying.isPlaying ? <Pause/> : <Play/>
    }



    const shouldShowPlayPause = props.nowPlaying.canPlayPause || props.nowPlaying.isPlaying || props.nowPlaying.isLoading;


    return (
        <div className='currently-playing rounded module-bg'>
            <div className='currently-playing-image'>
                <img 
                    src={props.nowPlaying.image || './default-cover.png'} 
                    width="80" 
                    alt={props.nowPlaying.track}
                    draggable="false"
                    onError={(e) => { e.target.src = './default-cover.png'; }}
                />
            </div>
            <div className='currently-playing-content'>
                <div>
                    <h4>{props.nowPlaying.track}</h4>
                    <p>{props.nowPlaying.artist}</p>
                </div>
            </div>
            <div className='currently-playing-controls'>
                {shouldShowPlayPause ? <button type='button' onClick={() => props.setPause()}>
                    {playIcon}
                </button> : ''}
                {props.nowPlaying.canPlayNext ?
                    <button className='currently-playing-controls-next' type='button' onClick={() => props.setNext()}>
                        {<FastForward/>}
                    </button> : ''}
            </div>
        </div>
    )
}

const Zone = (props) => {
    const [isHovered, setIsHovered] = useState(false);
    const { zone, isSelected, selectedZone, nowPlaying, joinZone, transferQueue, ungroupZone, isLeaving, onClick } = props;

    // Actions are only relevant when:
    // 1. Music is actively playing on the selected zone
    // 2. This zone is NOT the selected zone
    const isPlaying = Boolean(nowPlaying && nowPlaying.isPlaying);
    const isOtherZone = !isSelected && Boolean(selectedZone);

    const targetPlayer = zone._raw;
    const selectedPlayer = selectedZone?._raw;

    // Check if already joined/synced together
    const isAlreadyJoined = Boolean(
        selectedPlayer && targetPlayer && (
            selectedPlayer.group_childs?.includes(targetPlayer.player_id) ||
            selectedPlayer.group_members?.includes(targetPlayer.player_id) ||
            targetPlayer.synced_to === selectedPlayer.player_id ||
            selectedPlayer.synced_to === targetPlayer.player_id
        )
    );

    // Can Join:
    // Available, not already joined, and MA can_group_with allows grouping
    const canJoin = Boolean(
        isPlaying &&
        isOtherZone &&
        targetPlayer?.available &&
        !isAlreadyJoined &&
        (
            selectedPlayer?.can_group_with?.includes(targetPlayer.player_id) ||
            targetPlayer?.can_group_with?.includes(selectedPlayer?.player_id) ||
            selectedPlayer?.supported_features?.includes('set_members') ||
            targetPlayer?.supported_features?.includes('set_members')
        )
    );

    // Can Transfer Queue:
    // Available, not already joined
    const canTransfer = Boolean(
        isPlaying &&
        isOtherZone &&
        targetPlayer?.available &&
        !isAlreadyJoined
    );

    // Can Ungroup:
    // This zone is an active group (has joined members)
    const canUngroup = Boolean(zone.isGroup);

    const hasActions = canJoin || canTransfer || canUngroup;

    return (
        <div 
            className={`zone ${isLeaving ? 'zone--leaving' : ''}`}
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
        >
            <button type='button' className={isSelected ? 'active' : ''}>
                {zone.isGroup ? <Layers/> : <Speaker/>}
            </button>
            <div className="zone-name">{zone.name}</div>
            {isHovered && hasActions ? (
                <div className="zone-actions">
                    {canUngroup && (
                        <button 
                            type="button" 
                            className="zone-action-btn zone-action-btn--ungroup"
                            title="Dissolve group"
                            onClick={(e) => {
                                e.stopPropagation();
                                ungroupZone && ungroupZone(zone);
                            }}
                        >
                            <Unlink size={13} />
                        </button>
                    )}
                    {canJoin && (
                        <button 
                            type="button" 
                            className="zone-action-btn"
                            title={`Join with ${selectedZone?.name || 'current room'}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                joinZone && joinZone(zone);
                            }}
                        >
                            <Link size={13} />
                        </button>
                    )}
                    {canTransfer && (
                        <button 
                            type="button" 
                            className="zone-action-btn"
                            title={`Transfer queue to ${zone.name}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                transferQueue && transferQueue(zone);
                            }}
                        >
                            <ArrowRightCircle size={13} />
                        </button>
                    )}
                </div>
            ) : (
                <div className="zone-isPlaying">{zone.isPlaying && <Music/>}</div>
            )}
        </div>
    );
};

const ZoneSelector = (props) => {
    const selectedZone = props.zones.find(z => z.udn === props.selectedZoneUdn);
    return (
        <div className='zone-selector'>
            <div className='divider'/>
            <div className='zone-headline'>Zones</div>
            {props.zones.map((zone) => {
                const isLeaving = Array.isArray(props.leavingZoneUdns) && props.leavingZoneUdns.includes(zone.udn);
                return (
                    <Zone 
                        key={zone.udn} 
                        isSelected={zone.udn === props.selectedZoneUdn} 
                        zone={zone}
                        selectedZone={selectedZone}
                        nowPlaying={props.nowPlaying}
                        joinZone={props.joinZone}
                        ungroupZone={props.ungroupZone}
                        transferQueue={props.transferQueue}
                        isLeaving={isLeaving}
                        onClick={() => props.setZone(zone)}
                    />
                );
            })}
        </div>
    );
};

const Favourite = (props) => {
    return (
        <div 
            className='favourite' 
            role="button"
            tabIndex={0}
            onClick={props.onClick} 
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    props.onClick && props.onClick();
                }
            }}
            onMouseEnter={() => props.onHover && props.onHover(props.favourite.name)}
            onMouseLeave={() => props.onHover && props.onHover(null)}
            title={props.favourite.name}
        >
             <img 
                src={props.favourite.image || './default-cover.png'} 
                alt={props.favourite.name} 
                className="favourite-image"
                draggable="false"
                onError={(e) => { e.target.src = './default-cover.png'; }}
            />
        </div>
    );
}

const FAVOURITES_SOURCE_OPTIONS = [
    { value: 'recents', label: 'Recently Played' },
    { value: 'radio', label: 'Radio Stations' },
    { value: 'favorites_playlist', label: 'Playlist Favourites' },
    { value: 'random_artist', label: 'Random Artists' }
];

const Favourites = (props) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [hoveredFavouriteName, setHoveredFavouriteName] = useState(null);
    const dropdownRef = useRef(null);

    // Close dropdown when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsDropdownOpen(false);
            }
        };

        if (isDropdownOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isDropdownOpen]);

    const handleSourceChange = (value) => {
        setIsDropdownOpen(false);
        if (props.onFavouritesSourceChange) {
            props.onFavouritesSourceChange(value);
        }
    };

    // Get the label for the currently selected source
    const selectedSourceLabel = FAVOURITES_SOURCE_OPTIONS.find(
        option => option.value === props.favouritesSource
    )?.label || 'Favourites';

    return (
        <div>
            <div className='divider'/>
            <div className='favourites-header'>
                <div className='favourites-headline-wrapper' ref={dropdownRef}>
                    <div 
                        className='favourites-headline favourites-headline-clickable'
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    >
                        <span>{selectedSourceLabel}</span>
                        <ChevronDown className={`favourites-dropdown-arrow ${isDropdownOpen ? 'open' : ''}`} />
                    </div>
                    {isDropdownOpen && (
                        <div className='favourites-dropdown-menu'>
                            {FAVOURITES_SOURCE_OPTIONS.map(option => (
                                <div 
                                    key={option.value}
                                    className={`favourites-dropdown-item ${props.favouritesSource === option.value ? 'active' : ''}`}
                                    onClick={() => handleSourceChange(option.value)}
                                >
                                    {option.label}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
                {hoveredFavouriteName && (
                    <span className='favourites-hover-title'>{hoveredFavouriteName}</span>
                )}
            </div>
            <div className="favourites">
                {props.favourites.map((favourite, i) => {
                    return (
                        <Favourite 
                            key={favourite.id} 
                            favourite={favourite}
                            onClick={() => props.playFavourite(favourite)}
                            onHover={setHoveredFavouriteName}
                        />)
                })}
            </div>
        </div>
    )
}

const OpenMusicAssistantButton = (props) => {
    if (!props.url) return null;
    return (
        <div className="ma-button-wrapper">
             <div className='divider'/>
            <button className="ma-button" onClick={() => api.openExternal(props.url)}>
                <div className="ma-button-icon">
                    <Music />
                </div>
                <div className="ma-button-text">Open Music Assistant</div>
            </button>
        </div>
    );
}

const OpenSpotifyButton = () => {
    return (
        <div className="ma-button-wrapper">
             <div className='divider'/>
            <button className="ma-button" onClick={() => api.openSpotify()}>
                <div className="ma-button-icon">
                    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" width="24" height="24">
                         <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-.96 15.72 1.62.54.3.719 1.02.42 1.619-.3.48-1.02.66-1.56.36z"></path>
                    </svg>
                </div>
                <div className="ma-button-text">Open Spotify</div>
            </button>
        </div>
    );
}

const OpenAppleMusicButton = () => {
    return (
        <div className="ma-button-wrapper">
             <div className='divider'/>
            <button className="ma-button" onClick={() => api.openAppleMusic()}>
                <div className="ma-button-icon">
                    <Music />
                </div>
                <div className="ma-button-text">Open Apple Music</div>
            </button>
        </div>
    );
}

export default class MenuBarContainer extends React.Component {
    render() {
        if (this.props.selectedZoneUdn) {
            return (
                <div className='card-wrapper rounded'>
                    <CurrentlyPlaying nowPlaying={this.props.nowPlaying} setPause={this.props.setPause}
                                      setNext={this.props.setNext}/>
                    <VolumeSlider nowPlaying={this.props.nowPlaying} setMute={this.props.setMute}
                                  setVolume={this.props.setVolume}/>
                    <ZoneSelector zones={this.props.availableZones} selectedZoneUdn={this.props.selectedZoneUdn}
                                  setZone={this.props.setZone}
                                  nowPlaying={this.props.nowPlaying}
                                  joinZone={this.props.joinZone}
                                  ungroupZone={this.props.ungroupZone}
                                  transferQueue={this.props.transferQueue}
                                  leavingZoneUdns={this.props.leavingZoneUdns}/>
                    <Favourites 
                        favourites={this.props.favourites} 
                        playFavourite={this.props.playFavourite}
                        favouritesSource={this.props.favouritesSource}
                        onFavouritesSourceChange={this.props.onFavouritesSourceChange}
                    />
                    {this.props.shownShortcuts.ma && <OpenMusicAssistantButton url={this.props.musicAssistantUrl} />}
                    {this.props.shownShortcuts.spotify && <OpenSpotifyButton />}
                    {this.props.shownShortcuts.apple && <OpenAppleMusicButton />}
                </div>
            )
        } else {
            return (
                <div className='card-wrapper rounded'>
                    <ZoneSelector zones={this.props.availableZones} 
                                  setZone={this.props.setZone}
                                  nowPlaying={this.props.nowPlaying}
                                  joinZone={this.props.joinZone}
                                  ungroupZone={this.props.ungroupZone}
                                  transferQueue={this.props.transferQueue}
                                  leavingZoneUdns={this.props.leavingZoneUdns}/>
                    {this.props.shownShortcuts.ma && <OpenMusicAssistantButton url={this.props.musicAssistantUrl} />}
                    {this.props.shownShortcuts.spotify && <OpenSpotifyButton />}
                    {this.props.shownShortcuts.apple && <OpenAppleMusicButton />}
                </div>
            )
        }
    }
}

