# Project Context:

Musikbar is a Mac menubar app to control Music Assistant.

## Architecture

- **Frontend**: React (in Tauri).
- Packaged for Mac with Tauri.

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

## Debugging API Responses

Credentials are in `ai-assistants/music-assistant-docs/.env`.

**Quick Node.js Script** (Node 22+ has global WebSocket):

```javascript
const url = "ws://<HOST>:8095/ws";
const token = "<TOKEN>";

const ws = new WebSocket(url);
let id = 1;

ws.onopen = () =>
  ws.send(
    JSON.stringify({
      message_id: id++,
      command: "auth",
      args: { token, client_id: "debug" },
    })
  );

ws.onmessage = (e) => {
  const data = JSON.parse(e.data);
  // Use loose equality for message_id (response is string "1", request is int 1)
  if (data.message_id == 1) {
    console.log("Auth OK");
    ws.send(JSON.stringify({ message_id: id++, command: "players/all" }));
  }
  if (data.result) console.log(JSON.stringify(data.result, null, 2));
};

setTimeout(() => process.exit(0), 5000);
```

Run with `node debug.js`. Key fields to check:

- `supported_features`: Base player capabilities.
- `source_list[].can_next_previous`: Active source capabilities (e.g., Spotify Connect).
- `hide_player_in_ui`: Visibility flags (`when_unavailable`, `when_synced`).
- `group_childs`: Array of player IDs synced to this player.
