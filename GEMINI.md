# Project Context: Raumbar -> Music Assistant Migration

## Architecture

- **Frontend**: React (in Electron).
- **Backend**: `MusicAssistantClient` (WebSocket) replaced `node-raumkernel`.
- **Bridge**: `electron/preload.js` initializes `window.musicAssistant`.

## Music Assistant API Insights

- **Protocol**: WebSocket is used for both events and commands.
  - **Auth**: Must send `{ command: 'auth', args: { token: ... } }` immediately on connect.
  - **IDs**: Request `message_id` is an **Internet**, but Response `message_id` is a **String** ("1").
- **Key Commands**:
  - Play Media: `player_queues/play_media` (Args: `queue_id` (=player_id), `media` (=uri)). **NOT** `players/cmd/play_media`.
  - Recents: `music/recently_played_items`.
  - Queues: `player_queues/all` (Required for metadata).
- **Metadata**:
  - Player state (`active_source`) is often stale.
  - **Reliable Source**: `queue.current_item` from the corresponding Queue object.

## Codebase Map

- `src/react/MusicAssistantClient.js`: formatting, auth, WS handling.
- `src/react/App.js`: Main UI logic. Maps `players` + `queues` using `mapPlayersToZones`.
- `electron/preload.js`: Config entry point (Env vars: `MUSIC_ASSISTANT_URL`, `TOKEN`).
