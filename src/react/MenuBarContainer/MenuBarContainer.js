import Slider from 'react-rangeslider';
import React, { useState, useRef, useEffect } from 'react';
import {Pause, Play, Volume2, VolumeX, Speaker, Loader, Music, FastForward, ChevronDown} from 'react-feather';
import 'react-rangeslider/lib/index.css';
import './MenuBarContainer.css';

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
                        <Slider
                            min={0}
                            max={100}
                            value={this.state.volumeValueInternal}
                            tooltip={false}
                            orientation="horizontal"
                            onChange={value => this.setVolumeValueInternal(value)}
                            onChangeComplete={value => this.changeVolume(value)}
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



    const shouldShowPlayPause = props.nowPlaying.canPlayPause || props.nowPlaying.isLoading;


    return (
        <div className='currently-playing rounded module-bg'>
            <div className='currently-playing-image'>
                <img 
                    src={props.nowPlaying.image || './default-cover.png'} 
                    width="80" 
                    alt={props.nowPlaying.track}
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
    return (
        <div className='zone' onClick={props.onClick}>
            <button type='button' className={props.isSelected ? 'active' : ''}><Speaker/></button>
            <div className="zone-name">{props.zone.name} </div>
            <div className="zone-isPlaying">{props.zone.isPlaying && <Music/>}</div>
        </div>
    )
}

const ZoneSelector = (props) => {
    return (
        <div className='zone-selector'>
            <div className='divider'/>
            <div className='zone-headline'>Zones</div>
            {props.zones.map((zone, i) => {
                return (<Zone key={zone.udn} isSelected={zone.udn === props.selectedZoneUdn} zone={zone}
                              onClick={() => props.setZone(zone)}/>)
            })}
        </div>
    )
}

const Favourite = (props) => {
    return (
        <div 
            className='favourite' 
            onClick={props.onClick} 
            onMouseEnter={() => props.onHover && props.onHover(props.favourite.name)}
            onMouseLeave={() => props.onHover && props.onHover(null)}
            title={props.favourite.name}
        >
             <img 
                src={props.favourite.image || './default-cover.png'} 
                alt={props.favourite.name} 
                className="favourite-image"
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

    return (
        <div>
            <div className='divider'/>
            <div className='favourites-header'>
                <div className='favourites-headline-wrapper' ref={dropdownRef}>
                    <div 
                        className='favourites-headline favourites-headline-clickable'
                        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                    >
                        <span>Favourites</span>
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
            <button className="ma-button" onClick={() => window.ipcRenderer.invoke('open-external', props.url)}>
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
            <button className="ma-button" onClick={() => window.ipcRenderer.invoke('open-spotify')}>
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
            <button className="ma-button" onClick={() => window.ipcRenderer.invoke('open-apple-music')}>
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
                                  setZone={this.props.setZone}/>
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
                    <ZoneSelector zones={this.props.availableZones} setZone={this.props.setZone}/>
                    {this.props.shownShortcuts.ma && <OpenMusicAssistantButton url={this.props.musicAssistantUrl} />}
                    {this.props.shownShortcuts.spotify && <OpenSpotifyButton />}
                    {this.props.shownShortcuts.apple && <OpenAppleMusicButton />}
                </div>
            )
        }
    }
}


