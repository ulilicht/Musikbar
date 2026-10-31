import React, { useState, useEffect, useRef } from 'react';
import './Settings.css';
import { api } from './api/tauri';
import { getCurrentWindow } from '@tauri-apps/api/window';
import MusicAssistantClient from './MusicAssistantClient';
import { Check, Eye, EyeOff, ExternalLink, RotateCw, AlertCircle, CheckCircle } from 'react-feather';

const MacToggle = ({ id, checked, onChange, disabled = false }) => (
    <label className="mac-switch" htmlFor={id}>
        <input
            id={id}
            type="checkbox"
            role="switch"
            checked={checked}
            onChange={onChange}
            disabled={disabled}
        />
        <span className="mac-switch-slider" />
    </label>
);

const Settings = () => {
    const [serverUrl, setServerUrl] = useState('http://homeassistant.local:8095');
    const [token, setToken] = useState('');
    const [showToken, setShowToken] = useState(false);
    const [favouritesSource, setFavouritesSource] = useState('recents');
    const [autostart, setAutostart] = useState(true);
    const [shownShortcuts, setShownShortcuts] = useState({ ma: true, spotify: true, apple: false });
    const [status, setStatus] = useState('');
    const [appVersion, setAppVersion] = useState('');
    const [testState, setTestState] = useState({ testing: false, result: null });
    
    const initialLoadedRef = useRef(false);

    useEffect(() => {
        // Load initial settings
        api.getSettings().then(settings => {
            if (settings.musicAssistantUrl) setServerUrl(settings.musicAssistantUrl);
            if (settings.musicAssistantToken) setToken(settings.musicAssistantToken);
            if (settings.favouritesSource) setFavouritesSource(settings.favouritesSource);
            if (typeof settings.autostart !== 'undefined') setAutostart(settings.autostart);
            if (settings.shownShortcuts) setShownShortcuts(settings.shownShortcuts);
            initialLoadedRef.current = true;
        });

        // Load app version
        api.getAppVersion().then(v => setAppVersion(v));
    }, []);

    const showSavedIndicator = () => {
        setStatus('Saved');
        setTimeout(() => setStatus(''), 2200);
    };

    const saveField = async (fieldsToUpdate) => {
        try {
            await api.saveSettings(fieldsToUpdate);
            showSavedIndicator();
        } catch (err) {
            console.error('Failed to save settings:', err);
            setStatus(`Save error: ${err?.message || err}`);
            setTimeout(() => setStatus(''), 5000);
        }
    };

    const handleUrlBlur = () => {
        saveField({ musicAssistantUrl: serverUrl.trim() });
    };

    const handleTokenBlur = () => {
        saveField({ musicAssistantToken: token.trim() });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.target.blur();
        }
    };

    const handleAutostartChange = async (e) => {
        const nextVal = e.target.checked;
        setAutostart(nextVal);
        try {
            await api.saveSettings({ autostart: nextVal });
            showSavedIndicator();
        } catch (err) {
            console.error('Failed to change autostart:', err);
            setAutostart(!nextVal);
            setStatus(`Error: ${err?.message || err}`);
            setTimeout(() => setStatus(''), 5000);
        }
    };

    const handleFavouritesSourceChange = (e) => {
        const nextVal = e.target.value;
        setFavouritesSource(nextVal);
        saveField({ favouritesSource: nextVal });
    };

    const handleShortcutToggle = (key) => {
        const updated = { ...shownShortcuts, [key]: !shownShortcuts[key] };
        setShownShortcuts(updated);
        saveField({ shownShortcuts: updated });
    };

    const handleTestConnection = () => {
        if (!serverUrl) return;
        setTestState({ testing: true, result: null });

        const client = new MusicAssistantClient(serverUrl.trim(), token.trim());
        let finished = false;

        const cleanup = () => {
            finished = true;
            try {
                client.disconnect();
                if (typeof client.removeAllListeners === 'function') {
                    client.removeAllListeners();
                }
            } catch (_) {}
        };

        const timeoutId = setTimeout(() => {
            if (!finished) {
                cleanup();
                setTestState({ testing: false, result: { success: false, message: 'Connection timed out (5s)' } });
            }
        }, 5000);

        client.on('systemReady', () => {
            if (!finished) {
                clearTimeout(timeoutId);
                cleanup();
                setTestState({ testing: false, result: { success: true, message: 'Connection successful' } });
            }
        });

        client.on('connectionError', (err) => {
            if (!finished) {
                clearTimeout(timeoutId);
                cleanup();
                const errMsg = err?.message || (typeof err === 'string' ? err : 'Unable to connect');
                setTestState({ testing: false, result: { success: false, message: errMsg } });
            }
        });

        try {
            client.connect();
        } catch (err) {
            clearTimeout(timeoutId);
            cleanup();
            setTestState({ testing: false, result: { success: false, message: err?.message || 'Connection error' } });
        }
    };

    const profileUrl = serverUrl.trim() 
        ? `${serverUrl.trim().replace(/\/+$/, '')}/#/settings/profile` 
        : 'http://homeassistant.local:8095/#/settings/profile';

    const handleDragMouseDown = (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button, input, select, a, .clickable, .settings-status-pill')) return;
        try {
            getCurrentWindow().startDragging();
        } catch (err) {
            console.warn('startDragging error:', err);
        }
    };

    return (
        <div className="settings-window">
            {/* macOS Unified Title Bar */}
            <div 
                className="settings-titlebar" 
                data-tauri-drag-region 
                onMouseDown={handleDragMouseDown}
            >
                <span className="settings-title" data-tauri-drag-region>Settings</span>
                {status && (
                    <div className="settings-status-pill">
                        <Check size={11} strokeWidth={3} />
                        <span>{status}</span>
                    </div>
                )}
            </div>

            <div className="settings-content">
                {/* Section: Server */}
                <div className="settings-section">
                    <div className="settings-section-header">Server Connection</div>
                    <div className="settings-group">
                        <div className="settings-row">
                            <label htmlFor="serverUrl" className="settings-label">Server URL</label>
                            <div className="settings-input-wrapper">
                                <input
                                    id="serverUrl"
                                    type="text"
                                    className="mac-input"
                                    value={serverUrl}
                                    onChange={(e) => setServerUrl(e.target.value)}
                                    onBlur={handleUrlBlur}
                                    onKeyDown={handleKeyDown}
                                    placeholder="http://homeassistant.local:8095"
                                    spellCheck={false}
                                    autoCapitalize="off"
                                />
                            </div>
                        </div>

                        <div className="settings-row">
                            <label htmlFor="serverToken" className="settings-label">Access Token</label>
                            <div className="settings-input-wrapper with-icon">
                                <input
                                    id="serverToken"
                                    type={showToken ? 'text' : 'password'}
                                    className="mac-input"
                                    value={token}
                                    onChange={(e) => setToken(e.target.value)}
                                    onBlur={handleTokenBlur}
                                    onKeyDown={handleKeyDown}
                                    placeholder="Long-lived access token"
                                    spellCheck={false}
                                    autoCapitalize="off"
                                />
                                <button
                                    type="button"
                                    className="input-inline-btn"
                                    onClick={() => setShowToken(!showToken)}
                                    title={showToken ? 'Hide token' : 'Show token'}
                                >
                                    {showToken ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                        </div>

                        <div className="settings-row">
                            <span className="settings-label">Connection</span>
                            <div className="action-with-result">
                                {testState.result && (
                                    <span className={`test-result-badge ${testState.result.success ? 'success' : 'error'}`}>
                                        {testState.result.success ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                        {testState.result.message}
                                    </span>
                                )}
                                <button
                                    type="button"
                                    className="mac-btn"
                                    onClick={handleTestConnection}
                                    disabled={testState.testing || !serverUrl}
                                >
                                    {testState.testing && <RotateCw size={11} className="spin-icon" />}
                                    <span>{testState.testing ? 'Testing…' : 'Test Connection'}</span>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="settings-section-footnote">
                        A long-lived access token is required. Obtain it from your Music Assistant profile:{' '}
                        <a
                            href={profileUrl}
                            className="footnote-link"
                            onClick={(e) => { e.preventDefault(); api.openExternal(profileUrl); }}
                        >
                            Open Profile <ExternalLink size={10} className="inline-icon" />
                        </a>
                    </div>
                </div>

                {/* Section: General */}
                <div className="settings-section">
                    <div className="settings-section-header">General</div>
                    <div className="settings-group">
                        <div className="settings-row" onClick={() => handleAutostartChange({ target: { checked: !autostart } })}>
                            <div className="settings-label-group">
                                <span className="settings-label">Start at login</span>
                                <span className="settings-sublabel">Launch Musikbar automatically when you sign in</span>
                            </div>
                            <div onClick={(e) => e.stopPropagation()}>
                                <MacToggle
                                    id="autostartToggle"
                                    checked={autostart}
                                    onChange={handleAutostartChange}
                                />
                            </div>
                        </div>

                        <div className="settings-row">
                            <label htmlFor="favouritesSourceSelect" className="settings-label">Default favourites</label>
                            <div className="mac-select-wrapper">
                                <select
                                    id="favouritesSourceSelect"
                                    className="mac-select"
                                    value={favouritesSource}
                                    onChange={handleFavouritesSourceChange}
                                >
                                    <option value="recents">Recently Played</option>
                                    <option value="radio">Radio Stations</option>
                                    <option value="favorites_playlist">Playlist Favourites</option>
                                    <option value="random_artist">Random Artists</option>
                                </select>
                                <span className="mac-select-chevron" aria-hidden="true">
                                    <svg width="8" height="11" viewBox="0 0 8 11" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1.5 4L4 1.5L6.5 4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                                        <path d="M1.5 7L4 9.5L6.5 7" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Section: Menu Bar Shortcuts */}
                <div className="settings-section">
                    <div className="settings-section-header">Menu Bar Shortcuts</div>
                    <div className="settings-group">
                        <div className="settings-row" onClick={() => handleShortcutToggle('ma')}>
                            <span className="settings-label">Music Assistant</span>
                            <div onClick={(e) => e.stopPropagation()}>
                                <MacToggle
                                    id="shortcutMa"
                                    checked={shownShortcuts.ma}
                                    onChange={() => handleShortcutToggle('ma')}
                                />
                            </div>
                        </div>

                        <div className="settings-row" onClick={() => handleShortcutToggle('spotify')}>
                            <span className="settings-label">Spotify</span>
                            <div onClick={(e) => e.stopPropagation()}>
                                <MacToggle
                                    id="shortcutSpotify"
                                    checked={shownShortcuts.spotify}
                                    onChange={() => handleShortcutToggle('spotify')}
                                />
                            </div>
                        </div>

                        <div className="settings-row" onClick={() => handleShortcutToggle('apple')}>
                            <span className="settings-label">Apple Music</span>
                            <div onClick={(e) => e.stopPropagation()}>
                                <MacToggle
                                    id="shortcutApple"
                                    checked={shownShortcuts.apple}
                                    onChange={() => handleShortcutToggle('apple')}
                                />
                            </div>
                        </div>
                    </div>
                    <div className="settings-section-footnote">
                        Quick-launch buttons displayed at the bottom of the popover.
                    </div>
                </div>

                {/* Section: About */}
                <div className="settings-section">
                    <div className="settings-section-header">About</div>
                    <div className="settings-group">
                        <div className="settings-row">
                            <span className="settings-label">Musikbar</span>
                            <span className="settings-version-badge">v{appVersion || '2.2.1'}</span>
                        </div>
                        <div className="settings-row clickable" onClick={() => api.openExternal('https://github.com/ulilicht/Musikbar/issues/new')}>
                            <span className="settings-label">Report an Issue</span>
                            <ExternalLink size={12} className="row-chevron" />
                        </div>
                        <div className="settings-row clickable" onClick={() => api.openExternal('https://github.com/ulilicht/Musikbar')}>
                            <span className="settings-label">GitHub Repository</span>
                            <ExternalLink size={12} className="row-chevron" />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Settings;
