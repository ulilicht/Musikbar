
import { invoke } from '@tauri-apps/api/core';
import { load } from '@tauri-apps/plugin-store';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { open } from '@tauri-apps/plugin-shell';

// Store instance - will be initialized lazily
let storeInstance = null;

async function getStore() {
    if (!storeInstance) {
        storeInstance = await load('settings.json', { autoSave: true });
    }
    return storeInstance;
}

export const api = {
    getSettings: async () => {
        const store = await getStore();
        // Replicate logic: read from store, return defaults if missing
        const musicAssistantUrl = await store.get('musicAssistantUrl');
        const musicAssistantToken = await store.get('musicAssistantToken');
        const favouritesSource = (await store.get('favouritesSource')) || 'recents';
        const shownShortcuts = (await store.get('shownShortcuts')) || { ma: true, spotify: true, apple: false };
        const autostart = await isEnabled();

        return {
            musicAssistantUrl,
            musicAssistantToken,
            favouritesSource,
            shownShortcuts,
            autostart
        };
    },

    saveSettings: async (settings) => {
        const store = await getStore();
        if (settings.musicAssistantUrl !== undefined) await store.set('musicAssistantUrl', settings.musicAssistantUrl);
        if (settings.musicAssistantToken !== undefined) await store.set('musicAssistantToken', settings.musicAssistantToken);
        if (settings.favouritesSource !== undefined) await store.set('favouritesSource', settings.favouritesSource);
        if (settings.shownShortcuts !== undefined) await store.set('shownShortcuts', settings.shownShortcuts);
        
        if (settings.autostart !== undefined) {
            const current = await isEnabled();
            if (settings.autostart && !current) {
                await enable();
            } else if (!settings.autostart && current) {
                await disable();
            }
        }

        await store.save();
        
        // Emit event so other windows (or this one) can update
        const { emit } = await import('@tauri-apps/api/event');
        await emit('settings-updated');
        
        return true;
    },

    openExternal: async (url) => {
        await open(url);
    },

    openSpotify: async () => {
         await invoke('open_spotify');
    },

    openAppleMusic: async () => {
        await invoke('open_apple_music');
    },
    
    openSettings: async () => {
        await invoke('open_settings');
    },

    onSettingsUpdated: async (callback) => {
        const { listen } = await import('@tauri-apps/api/event');
        const unlisten = await listen('settings-updated', callback);
        return unlisten; 
    }
};
