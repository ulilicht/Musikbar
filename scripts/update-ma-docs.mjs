#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const contextDir = path.resolve(rootDir, 'context');

// Simple .env parser without external dependencies
function loadEnv() {
  const envFiles = [path.resolve(rootDir, '.env.local'), path.resolve(rootDir, '.env')];
  const env = { ...process.env };

  for (const file of envFiles) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx !== -1) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, '');
          if (!env[key]) env[key] = val;
        }
      }
      break;
    }
  }
  return env;
}

const env = loadEnv();
const primaryUrl = env.MUSIC_ASSISTANT_URL;
const localUrl = env.MUSIC_ASSISTANT_LOCAL_URL;
const token = env.MUSIC_ASSISTANT_TOKEN || '';

if (!primaryUrl) {
  console.error('Error: MUSIC_ASSISTANT_URL is not set.');
  console.error('Please configure your .env.local file based on .env.example.');
  process.exit(1);
}

async function fetchWithFallback(subpath, options = {}) {
  const urlsToTry = [
    `${primaryUrl.replace(/\/$/, '')}${subpath}`
  ];
  if (localUrl) {
    urlsToTry.push(`${localUrl.replace(/\/$/, '')}${subpath}`);
  }

  let lastError = null;
  for (const url of urlsToTry) {
    try {
      const res = await fetch(url, options);
      if (res.ok) {
        return { res, url };
      }
      lastError = new Error(`HTTP ${res.status} from ${url}`);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

async function main() {
  console.log(`Connecting to Music Assistant...`);
  console.log(`Primary URL: ${primaryUrl}`);
  console.log(`LAN Fallback: ${localUrl}`);

  // 1. Fetch Server Info
  let serverInfo = {};
  try {
    const { res: infoRes, url: infoUrl } = await fetchWithFallback('/info');
    serverInfo = await infoRes.json();
    console.log(`Connected to Music Assistant v${serverInfo.server_version} (via ${infoUrl})`);
  } catch (err) {
    console.warn(`Could not reach /info: ${err.message}. Proceeding anyway.`);
  }

  // 2. Fetch Commands JSON
  let commands = [];
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const { res: cmdRes, url: cmdUrl } = await fetchWithFallback('/api-docs/commands.json', { headers });
    commands = await cmdRes.json();
    console.log(`Fetched ${commands.length} commands from ${cmdUrl}`);
  } catch (err) {
    console.error(`Failed to fetch /api-docs/commands.json: ${err.message}`);
    process.exit(1);
  }

  // 3. Filter and structure commands
  const maDocsDir = path.resolve(contextDir, 'ma-api-docs');
  if (!fs.existsSync(maDocsDir)) {
    fs.mkdirSync(maDocsDir, { recursive: true });
  }

  // Prioritize categories relevant for Musikbar
  const relevantPrefixes = ['players/', 'player_queues/', 'music/'];
  const relevantCommands = commands.filter(c =>
    relevantPrefixes.some(p => c.command.startsWith(p))
  );

  const categories = {};
  for (const cmd of commands) {
    const cat = cmd.category || 'General';
    if (!categories[cat]) categories[cat] = [];
    categories[cat].push(cmd);
  }

  const generatedDate = new Date().toISOString().split('T')[0];
  const versionStr = serverInfo.server_version ? `v${serverInfo.server_version}` : 'latest';

  let markdown = `---
type: API Reference
title: Music Assistant API Reference (${versionStr})
description: Reference documentation for Music Assistant WebSocket and HTTP API commands, data types, and playback logic.
tags: [music-assistant, api, websocket, schema]
status: stable
generated:
  by: process:update-ma-docs.mjs
  at: "${generatedDate}"
---

# Music Assistant API Reference (${versionStr})

> Auto-generated on ${generatedDate} by \`scripts/update-ma-docs.mjs\` from live Music Assistant instance.
> To re-fetch latest schema: run \`npm run docs:update\`.

## 1. Connection & Protocol

- **Base URL**: Configured via \`MUSIC_ASSISTANT_URL\` in \`.env.local\` (e.g. \`http://<host>:8095\` or reverse proxy)
- **Websocket Endpoint**: \`ws://<host>:<port>/ws\` (or \`wss://\` via proxy)
  - Used for real-time events and bidirectional commands in Musikbar.
  - **Auth**: Client must send \`{ "command": "auth", "args": { "token": "<TOKEN>" } }\` immediately on connect.
  - **IDs**: Request \`message_id\` is sent as an integer/string, but responses return \`message_id\` as a string (e.g. \`"1"\`). Always use loose equality \`==\` or string matching.
- **HTTP Endpoint**: \`POST /api\`
  - Headers: \`Authorization: Bearer <TOKEN>\`, \`Content-Type: application/json\`
  - Body: \`{ "command": "category/command_name", "args": { ... } }\`
- **Live Docs**: \`/api-docs\` (Swagger UI: \`/api-docs/swagger\`, OpenAPI: \`/api-docs/openapi.json\`).

---

## 2. Core Musikbar Logic & Metadata Handling

1. **Regular MA Playback**:
   - Primary state source: \`player_queues/all\`.
   - Track metadata: \`queue.current_item\` from the queue matching the player.
2. **External Audio Sources (AirPlay, Spotify Connect, etc.)**:
   - Condition: \`player.active_source !== player.player_id\` or \`media_type === 'audio_source'\`.
   - The player's queue is inactive (\`queue.active === false\`) with stale data.
   - Real-time metadata (title, artist, album, image_url) must be read from \`player.current_media\`.
3. **Queue Playback**:
   - Always use \`player_queues/play_media\` (with \`queue_id\` and \`media\`), NOT \`players/cmd/play_media\`.
4. **Player Filtering**:
   - Only audio player types (\`player\`, \`stereo_pair\`, \`group\`) are shown. Non-audio device types like \`light\` (e.g. Philips Hue entertainment zones), \`visualizer\`, \`display\`, \`source\`, \`protocol\` are filtered out.
   - Players with \`enabled === false\`, \`hide_in_ui === true\`, or \`hide_player_in_ui\` containing \`always\` are hidden.

---

## 3. Essential Commands for Musikbar

`;

  // Format relevant commands detailed table
  for (const prefix of ['players/', 'player_queues/', 'music/']) {
    const groupCmds = relevantCommands.filter(c => c.command.startsWith(prefix));
    const title = prefix.replace('/', '').toUpperCase();
    markdown += `### ${title} Commands\n\n`;
    markdown += `| Command | Parameters | Return Type | Description |\n`;
    markdown += `| :--- | :--- | :--- | :--- |\n`;

    for (const c of groupCmds) {
      const params = (c.parameters || [])
        .map(p => `\`${p.name}\`${p.required ? ' (req)' : ''}`)
        .join(', ') || 'None';
      const ret = c.return_type ? `\`${c.return_type}\`` : 'void';
      const desc = (c.summary || c.description || '').replace(/\n/g, ' ').slice(0, 100);
      markdown += `| \`${c.command}\` | ${params} | ${ret} | ${desc} |\n`;
    }
    markdown += `\n`;
  }

  // Add all commands catalog list grouped by category
  markdown += `---

## 4. Full Command Catalog (${commands.length} Commands)

<details>
<summary>Click to view all available commands on MA ${versionStr}</summary>

`;

  for (const [cat, catCmds] of Object.entries(categories)) {
    markdown += `### ${cat}\n`;
    for (const c of catCmds) {
      markdown += `- \`${c.command}\`${c.summary ? `: ${c.summary}` : ''}\n`;
    }
    markdown += `\n`;
  }

  markdown += `</details>\n`;

  const outputPath = path.resolve(maDocsDir, 'music-assistant-api.md');
  fs.writeFileSync(outputPath, markdown, 'utf8');
  console.log(`Successfully wrote documentation to ${outputPath}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

