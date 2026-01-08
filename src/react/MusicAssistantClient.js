import EventEmitter from "events";

class MusicAssistantClient extends EventEmitter {
  constructor(url, token) {
    super();
    this.url = url;
    this.token = token;
    this.ws = null;
    this.players = {};
    this.queues = {};
    this.isConnected = false;
    this.connectionId = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
  }

  connect() {
    // Construct WebSocket URL from HTTP URL
    const wsUrl = this.url.replace("http", "ws") + "/ws";

    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log("MA WebSocket connected");
      this.isConnected = true;
      this.authenticate();
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleMessage(data);
      } catch (e) {
        console.error("Error parsing MA message", e);
      }
    };

    this.ws.onclose = () => {
      console.log("MA WebSocket closed");
      this.isConnected = false;
      this.emit("systemReady", false);
      // Simple reconnect logic
      setTimeout(() => this.connect(), 5000);
    };

    this.ws.onerror = (err) => {
      console.error("MA WebSocket error", err);
    };
  }

  authenticate() {
    // Try 'auth' command with token
    this.sendCommand('auth', { token: this.token, client_id: 'musikbar' })
      .then(() => {
        this.emit('systemReady', true);
        this.startListening();
      })
      .catch(err => {
        console.error('Authentication failed', err);
        // Optionally, emit an error event or handle reconnection
        // For now, just log the error.
      });
  }

  startListening() {
    // Fetch initial players and queues
    Promise.all([
        this.sendCommand('players/all'),
        this.fetchQueues()
    ]).then(([players, queues]) => {
        if (Array.isArray(players)) {
            players.forEach(p => this.players[p.player_id] = p);
        }
        // Queues are handled by fetchQueues implicitly updating this.queues if we change implementation, 
        // but here we just get the result. 
        // Actually, let's keep it simple: fetchQueues will populate this.queues if we structure it that way,
        // or we just assign here.
        // Let's stick to the current pattern:
        // But wait, fetchQueues needs to return them for Promise.all
        this.emitState();
    }).catch(err => console.error('Failed to fetch initial state', err));
  }

  fetchQueues() {
      return this.sendCommand('player_queues/all')
          .then(queues => {
              if (Array.isArray(queues)) {
                  queues.forEach(q => this.queues[q.queue_id] = q);
              }
              return queues;
          });
  }

  handleMessage(data) {
    if (data.event) {
      this.handleEvent(data);
      return;
    }

    // Handle Command Responses
    // MA returns message_id as string sometimes, we store as number.
    const msgId = Number(data.message_id);
    if (!isNaN(msgId) && this.pendingRequests.has(msgId)) {
      const { resolve, reject } = this.pendingRequests.get(msgId);
      this.pendingRequests.delete(msgId);

      // MA error format
      if (data.error) {
        reject(new Error(data.error));
      } else {
        // Success
        resolve(data.result !== undefined ? data.result : data);
      }
    }
  }

  handleEvent(data) {
    const { event, data: eventData } = data;

    if (event === 'player_added') {
      this.players[eventData.player_id] = eventData;
      // Fetch queues again to ensure we have the queue for this new player
      this.fetchQueues().then(() => this.emitState());
    } else if (event === 'player_updated') {
      this.players[eventData.player_id] = {
        ...this.players[eventData.player_id],
        ...eventData
      };
      this.emitState();
    } else if (event === 'player_removed') {
      delete this.players[eventData.player_id];
      this.emitState();
    } else if (event === 'queue_updated') {
      this.queues[eventData.queue_id] = {
        ...this.queues[eventData.queue_id],
        ...eventData
      };
      this.emitState();
    }
  }

  emitState() {
    // Combine into the format the UI expects (or a simplified one)
    // For now, we emit the raw-ish objects but structured for easy UI consumption
    const state = {
      players: Object.values(this.players),
      queues: Object.values(this.queues)
    };
    this.emit("stateChanged", state);
  }

  async sendCommand(command, args = {}) {
    if (!this.isConnected || !this.ws) {
      throw new Error('WebSocket not connected');
    }

    const id = this.messageId++;
    const payload = {
      message_id: id,
      command: command,
      args: args
    };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        this.pendingRequests.delete(id);
        reject(e);
      }

      // Timeout safety
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command ${command} timed out`));
        }
      }, 5000);
    });
  }

  // --- Public API for App.js ---

  async getPlayers() {
    return Object.values(this.players);
  }

  play(playerId) {
    return this.sendCommand("players/cmd/play", { player_id: playerId });
  }

  pause(playerId) {
    return this.sendCommand("players/cmd/pause", { player_id: playerId });
  }

  playPause(playerId) {
    return this.sendCommand("players/cmd/play_pause", { player_id: playerId });
  }

  next(playerId) {
    return this.sendCommand("players/cmd/next", { player_id: playerId });
  }

  previous(playerId) {
    return this.sendCommand("players/cmd/previous", { player_id: playerId });
  }

  setVolume(playerId, volume) {
    return this.sendCommand("players/cmd/volume_set", {
      player_id: playerId,
      volume_level: volume,
    });
  }

  setMute(playerId, muted) {
    return this.sendCommand("players/cmd/volume_mute", {
      player_id: playerId,
      is_muted: muted,
    });
  }

  async getRecentlyPlayed(limit = 20) {
    try {
      return await this.sendCommand("music/recently_played_items", { limit });
    } catch (e) {
      console.error("Failed to get recents", e);
      return [];
    }
  }

  async getRadios(limit = 20) {
      try {
          // Correct MA API endpoint: music/radios/library_items
          const res = await this.sendCommand("music/radios/library_items");
          return Array.isArray(res) ? res.slice(0, limit) : (res.items || []).slice(0, limit);
      } catch (e) {
          console.error("Failed to get radios", e);
          return [];
      }
  }

  async getPlaylists(limit = 20) {
      try {
          // Correct MA API endpoint: music/playlists/library_items
          const res = await this.sendCommand("music/playlists/library_items");
          return Array.isArray(res) ? res.slice(0, limit) : (res.items || []).slice(0, limit);
      } catch (e) {
          console.error("Failed to get playlists", e);
          return [];
      }
  }

  async getArtists(limit = 20) {
       try {
          // Correct MA API endpoint: music/artists/library_items
          const res = await this.sendCommand("music/artists/library_items");
          let items = Array.isArray(res) ? res : (res.items || []);
          
          // Simple shuffle for random artists
          items = items.sort(() => 0.5 - Math.random());
          return items.slice(0, limit);
       } catch(e) {
           console.error("Failed to get artists", e);
           return [];
       }
  }
}

export default MusicAssistantClient;
