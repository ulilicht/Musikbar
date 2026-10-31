---
type: Architecture
title: Musikbar Architecture
description: Overview of the macOS menubar application architecture, Tauri v2 shell, and React state synchronization.
tags: [architecture, tauri, react, state-model]
status: stable
generated:
  by: agent:antigravity
  at: "2026-10-31"
---

# Musikbar Architecture

Musikbar is a lightweight macOS menubar application designed to control Music Assistant.

## 1. High-Level Overview

- **Host & Shell**: [Tauri v2](https://v2.tauri.app/) (Rust backend for system tray, autostart, window management).
- **Frontend UI**: React (built with Vite).
- **Single Source of Truth for Dependencies**: `package.json` and `src-tauri/Cargo.toml`.

## 2. Directory Layout

- `src-tauri/`: Rust backend, system tray setup, window positioning, and plugins (autostart, store).
- `src/`: React frontend application.
  - `src/react/App.jsx`: Main interface logic, active player selection, zone mapping.
  - `src/react/MusicAssistantClient.jsx`: WebSocket connection, authentication, command dispatching, event listener system.
  - `src/react/Settings.jsx`: Server URL, access token, and app preferences.
  - `src/react/api/tauri.js`: Bridge to Tauri plugins (`@tauri-apps/plugin-store`, autostart).
- `context/`: Reference documentation for developers and AI agents.
- `scripts/`: Maintenance scripts (e.g., updating API documentation).

## 3. State & Event Model

- `MusicAssistantClient` establishes a persistent WebSocket connection to `<MUSIC_ASSISTANT_URL>/ws`.
- State synchronization:
  - Players state is maintained in `client.players`.
  - Queues state is maintained in `client.queues`.
  - Server events (`player_updated`, `queue_updated`, `queue_time_updated`) trigger reactive updates in the UI.
- Local configuration (server URL, token) is persisted via Tauri plugin store (`settings.json`).
