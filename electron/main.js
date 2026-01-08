const { app, Menu, Tray, dialog, powerMonitor, ipcMain, BrowserWindow } = require('electron');
const { menubar } = require('menubar');
const path = require('path');
const shell = require('electron').shell;

let store; 
(async () => {
    const { default: Store } = await import('electron-store');
    store = new Store();
})();

let mb;
let settingsWindow = null;

const startUrl = process.env.ELECTRON_START_URL || `file://${path.join(__dirname, "../build/index.html")}`;
const isDevelopmentMode = process.env.RAUMBAR_DEVELOPMENT_MODE === "true";

function createMenubar() {
    const iconPath = path.join(__dirname, '..', 'public', 'speaker-icon.Template@2x.png');

    const tray = new Tray(iconPath);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Settings...', type: 'normal', click: () => {
                openSettings();
            }
        },
        {
            label: 'Report issue', type: 'normal', click: () => {
                shell.openExternal('https://github.com/ulilicht/Musikbar/issues')
            }
        },
        { label: 'Quit Musikbar', type: 'radio', role: 'quit' },
    ])

    mb = menubar({
        index: startUrl,
        tray: tray,
        browserWindow: {
            webPreferences: {
                preload: path.join(__dirname, 'preload.js'),
                contextIsolation: false,
                nodeIntegration: true
            },
            vibrancy: 'hud',
            visualEffectState: "active",
            alwaysOnTop: true,
            transparent: true
        },
        preloadWindow: true
    });

    tray.on('right-click', function (event) {
        tray.popUpContextMenu(contextMenu);
    });

    mb.on('show', () => {
        if (mb.window) {
            mb.window.setOpacity(1); // reset the opacity which was set with the fade-out effect.
        }
    });

    mb.on('focus-lost', () => fadeOut(mb));


    powerMonitor.on('resume', () => {
        if (mb.window) mb.window.reload(); // Reconnect if connection was lost while suspended
    });
}

function openSettings() {
    if (settingsWindow) {
        settingsWindow.focus();
        return;
    }

    settingsWindow = new BrowserWindow({
        width: 600,
        height: 500,
        title: "Musikbar Settings",
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            contextIsolation: false,
            nodeIntegration: true,
        },
        autoHideMenuBar: true,
        resizable: false, 
        fullscreenable: false,
        backgroundColor: '#f2f2f2'
    });

    // In dev mode, we might want to load the same URL but with a hash
    // In prod, it's file://.../index.html
    const settingsUrl = startUrl.split('#')[0] + '#settings';
    settingsWindow.loadURL(settingsUrl);

    if (isDevelopmentMode) {
        settingsWindow.webContents.openDevTools();
    }

    settingsWindow.on('closed', () => {
        settingsWindow = null;
    });
}

// IPC Handlers
ipcMain.handle('get-settings', async () => {
    return {
        musicAssistantUrl: store.get('musicAssistantUrl'),
        musicAssistantToken: store.get('musicAssistantToken'),
        favouritesSource: store.get('favouritesSource', 'recents'), // Default to 'recents'
        autostart: store.get('autostart', true), // Default to true
        shownShortcuts: store.get('shownShortcuts', { ma: true, spotify: true, apple: false })
    };
});

ipcMain.handle('save-settings', async (event, settings) => {
    if (settings.musicAssistantUrl) store.set('musicAssistantUrl', settings.musicAssistantUrl);
    if (settings.musicAssistantToken) store.set('musicAssistantToken', settings.musicAssistantToken);
    if (settings.favouritesSource) store.set('favouritesSource', settings.favouritesSource);
    if (settings.shownShortcuts) store.set('shownShortcuts', settings.shownShortcuts);
    
    if (typeof settings.autostart !== 'undefined') {
        store.set('autostart', settings.autostart);
        if (!isDevelopmentMode) {
             app.setLoginItemSettings({
                openAtLogin: settings.autostart,
                openAsHidden: true
            });
        }
    }
    
    // Notify main window to reload config
    if (mb && mb.window) {
        mb.window.webContents.send('settings-updated');
    }
    return true;
});

ipcMain.handle('open-external', async (event, url) => {
    await shell.openExternal(url);
});

ipcMain.handle('open-spotify', async () => {
    shell.openPath('/Applications/Spotify.app')
        .then(message => message.length > 0 && dialog.showErrorBox('Could not open Spotify', 'Please make sure Spotify is installed in /Applications/Spotify.app'));
});

ipcMain.handle('open-apple-music', async () => {
    shell.openPath('/System/Applications/Music.app')
        .then(message => message.length > 0 && dialog.showErrorBox('Could not open Apple Music', 'Please make sure Apple Music is installed in /System/Applications/Music.app'));
});

ipcMain.on('open-settings', () => {
    openSettings();
});


app.on('ready', createMenubar);


// Startup Logic for Autostart
// Note: Store is initialized asynchronously, so we poll until it's ready.
if (!isDevelopmentMode) {
    let attempts = 0;
    const maxAttempts = 50; // 5 seconds max (50 * 100ms)
    
    const enforceAutostart = setInterval(() => {
        attempts++;
        if (store) {
            clearInterval(enforceAutostart);
            const shouldAutostart = store.get('autostart', true);
            app.setLoginItemSettings({
                openAtLogin: shouldAutostart,
                openAsHidden: true
            });
            console.log(`[Autostart] Enforced state: ${shouldAutostart}`);
        } else if (attempts >= maxAttempts) {
            clearInterval(enforceAutostart);
            console.error('[Autostart] Store failed to initialize, skipping autostart enforcement');
        }
    }, 100);
}


function fadeOut(mb) {
    const step = 0.1;
    const fadeEveryXSeconds = 15;
    if (!mb.window) {
        return;
    }
    
    // Don't fade out if we have settings open? Nah, independent.

    let opacity = mb.window.getOpacity();

    const interval = setInterval(() => {
        mb.window.setOpacity(opacity);
        opacity -= step;

        if (opacity <= 0.2) {
            clearInterval(interval);
            mb.hideWindow();
        }
    }, fadeEveryXSeconds);
}