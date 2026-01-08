import React, { useState, useEffect } from 'react';
import './Settings.css';

const Settings = () => {
    const [serverUrl, setServerUrl] = useState('http://homeassistant.local:8095');
    const [token, setToken] = useState('');
    const [favouritesSource, setFavouritesSource] = useState('recents');
    const [autostart, setAutostart] = useState(true);
    const [shownShortcuts, setShownShortcuts] = useState({ ma: true, spotify: true, apple: false });
    const [status, setStatus] = useState('');

    useEffect(() => {
        // Load initial settings
        window.ipcRenderer.invoke('get-settings').then(settings => {
            if (settings.musicAssistantUrl) setServerUrl(settings.musicAssistantUrl);
            if (settings.musicAssistantToken) setToken(settings.musicAssistantToken);
            if (settings.favouritesSource) setFavouritesSource(settings.favouritesSource);
            if (typeof settings.autostart !== 'undefined') setAutostart(settings.autostart);
            if (settings.shownShortcuts) setShownShortcuts(settings.shownShortcuts);
        });
    }, []);

    const handleSave = async () => {
        setStatus('Saving...');
        await window.ipcRenderer.invoke('save-settings', {
            musicAssistantUrl: serverUrl,
            musicAssistantToken: token,
            favouritesSource: favouritesSource,
            favouritesSource: favouritesSource,
            autostart: autostart,
            shownShortcuts: shownShortcuts
        });
        setStatus('Saved!');
        setTimeout(() => setStatus(''), 2000);
    };

    return (
        <div className="settings-container">
            <h1>Settings</h1>

            <div className="settings-section">
                <h2>Server</h2>
                <div className="settings-group">
                    <div className="form-group">
                        <label>Server URL</label>
                        <input 
                            type="text" 
                            value={serverUrl} 
                            onChange={(e) => setServerUrl(e.target.value)} 
                            placeholder="http://homeassistant.local:8095"
                        />
                    </div>
                    <div className="form-group">
                        <label>Token</label>
                        <input 
                            type="password" 
                            value={token} 
                            onChange={(e) => setToken(e.target.value)} 
                            placeholder="Long-lived access token"
                        />
                    </div>
                </div>
                <p className="description">
                    A long-lived access token is required. You can obtain it from your profile page in Music Assistant. <a href="http://homeassistant.local:8095/#/settings/profile" onClick={(e) => { e.preventDefault(); window.ipcRenderer.invoke('open-external', 'http://homeassistant.local:8095/#/settings/profile'); }}>
                        Open User Profile
                    </a>
                </p>
            </div>

            <div className="settings-section">
                <h2>System</h2>
                <div className="settings-group">
                    <div className="form-group">
                        <label>Auto-start on login</label>
                        <input 
                            type="checkbox" 
                            checked={autostart} 
                            onChange={(e) => setAutostart(e.target.checked)} 
                        />
                    </div>
                </div>
            </div>

            <div className="settings-section">
                <h2>Favourites</h2>
                <div className="settings-group">
                    <div className="form-group">
                        <label>Favourite Section</label>
                        <select value={favouritesSource} onChange={(e) => setFavouritesSource(e.target.value)}>
                            <option value="recents">Recently Played</option>
                            <option value="radio">Radio Stations</option>
                            <option value="favorites_playlist">Playlist Favourites</option>
                            <option value="random_artist">Random Artists</option>
                        </select>
                    </div>
                </div>
            </div>
            
            <div className="settings-section">
                <h2>Shortcuts</h2>
                <div className="settings-group">
                    <p className="description">Displays a shortcut to the App in Musikbar</p>
                    <div className="form-group">
                        <label>Music Assistant</label>
                        <input 
                            type="checkbox" 
                            checked={shownShortcuts.ma} 
                            onChange={(e) => setShownShortcuts({...shownShortcuts, ma: e.target.checked})} 
                        />
                    </div>
                    <div className="form-group">
                        <label>Spotify</label>
                        <input 
                            type="checkbox" 
                            checked={shownShortcuts.spotify} 
                            onChange={(e) => setShownShortcuts({...shownShortcuts, spotify: e.target.checked})} 
                        />
                    </div>
                    <div className="form-group">
                        <label>Apple Music</label>
                        <input 
                            type="checkbox" 
                            checked={shownShortcuts.apple} 
                            onChange={(e) => setShownShortcuts({...shownShortcuts, apple: e.target.checked})} 
                        />
                    </div>
                </div>
            </div>

            <div className="settings-actions">
                 <span className="status-message">{status}</span>
                <button className="primary-button" onClick={handleSave}>Save</button>
            </div>
        </div>
    );
};

export default Settings;
