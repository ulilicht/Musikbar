# Musikbar

macOS menubar app to control Music Assistant.

## Architecture

- **Stack**: React frontend running in Tauri v2 (macOS menubar application).
- **Single Source of Truth for Versions**: See `package.json` and `src-tauri/Cargo.toml`.
- **Context**: See `context/` if available (local only folder, not in git). 

## Music Assistant API Insights

- **Protocol**: WebSocket (`/ws`) handles both events and commands.
  - **Auth**: Must send `{ command: 'auth', args: { token: ... } }` immediately upon connecting.
  - **Message IDs**: Request `message_id` is an integer or string, but response `message_id` is returned as a **String** (`"1"`). Always compare loosely (`==`) or normalize to string.
- **Key Commands**:
  - Play Media: `player_queues/play_media` (Args: `queue_id` (=player_id), `media` (=uri)). **Never** use `players/cmd/play_media`.
  - Recents: `music/recently_played_items`.
  - Queues: `player_queues/all` (Required for metadata).
- **Metadata Logic**:
  - Regular MA playback: `queue.current_item` from the corresponding Queue object is the reliable source.
  - External / Audio Sources (e.g. Spotify Connect, AirPlay): When active (`player.active_source !== player.player_id` or `media_type === 'audio_source'`), the player's queue is inactive (`queue.active === false`) with stale data. In that case, `player.current_media` contains the real-time metadata (title, artist, album, image_url).
- **Full API Reference**: See `context/ma-api-docs/music-assistant-api.md` (generated via `npm run docs:update`).

## Development & Maintenance

- `npm run dev`: Start Vite development server.
- `npm run start`: Run Tauri in development mode (`tauri dev`).
- `npm run build`: Build web assets with Vite.
- `npm run make`: Build the full Tauri menubar application bundle.
- `npm run docs:update`: Fetch latest API schema and regenerate `context/ma-api-docs/music-assistant-api.md` from the live Music Assistant server.
- `npm run context:lint`: Validate documentation in `context/` against OKF v0.2.
