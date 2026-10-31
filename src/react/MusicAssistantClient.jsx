class SimpleEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, handler) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(handler);
    return this;
  }

  off(event, handler) {
    if (!this.listeners.has(event)) {
      return this;
    }
    this.listeners.get(event).delete(handler);
    if (this.listeners.get(event).size === 0) {
      this.listeners.delete(event);
    }
    return this;
  }

  removeAllListeners(event) {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  emit(event, ...args) {
    if (!this.listeners.has(event)) {
      return false;
    }
    for (const handler of this.listeners.get(event)) {
      handler(...args);
    }
    return true;
  }
}

class MusicAssistantClient extends SimpleEventEmitter {
  constructor(url, token) {
    super();
    this.url = url;
    this.token = token;
    this.ws = null;
    this.players = {};
    this.queues = {};
    this.serverInfo = null;
    this.isConnected = false;
    this.shouldReconnect = true;
    this.reconnectTimer = null;
    this.sleepCheckTimer = null;
    this.lastHeartbeat = Date.now();
    this.lifecycleListenersAttached = false;
    this.authFailed = false;
    this.connectionId = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
  }

  setupLifecycleListeners() {
    if (this.lifecycleListenersAttached) return;
    this.lifecycleListenersAttached = true;

    this.onOnline = () => {
      console.log("[MusicAssistantClient] Network online event detected. Verifying connection...");
      this.checkConnectionOrReconnect();
    };

    this.onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        this.checkConnectionOrReconnect();
      }
    };

    window.addEventListener("online", this.onOnline);
    document.addEventListener("visibilitychange", this.onVisibilityChange);

    this.lastHeartbeat = Date.now();
    if (!this.sleepCheckTimer) {
      this.sleepCheckTimer = setInterval(() => {
        const now = Date.now();
        const elapsed = now - this.lastHeartbeat;
        this.lastHeartbeat = now;
        // If elapsed time between 2s ticks exceeds 5s, the computer just woke from sleep!
        if (elapsed > 5000) {
          console.log(`[MusicAssistantClient] Wake from sleep detected (${elapsed}ms). Reconnecting if needed...`);
          this.checkConnectionOrReconnect();
        }
      }, 2000);
    }
  }

  checkConnectionOrReconnect() {
    if (this.authFailed) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.log("[MusicAssistantClient] Connection inactive, reconnecting...");
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = null;
      }
      this.connect();
    }
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.sleepCheckTimer) {
      clearInterval(this.sleepCheckTimer);
      this.sleepCheckTimer = null;
    }
    if (this.lifecycleListenersAttached) {
      window.removeEventListener("online", this.onOnline);
      document.removeEventListener("visibilitychange", this.onVisibilityChange);
      this.lifecycleListenersAttached = false;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }
    this.isConnected = false;
    for (const [id, req] of this.pendingRequests.entries()) {
      if (req.timeoutId) clearTimeout(req.timeoutId);
      req.reject(new Error("Client disconnected"));
    }
    this.pendingRequests.clear();
  }

  connect() {
    // Cancel any existing reconnect timer and close existing socket
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      try {
        this.ws.onopen = null;
        this.ws.onclose = null;
        this.ws.onerror = null;
        this.ws.onmessage = null;
        this.ws.close();
      } catch (e) {
        // ignore
      }
      this.ws = null;
    }

    this.shouldReconnect = true;
    this.authFailed = false;
    this.setupLifecycleListeners();

    // Construct WebSocket URL from HTTP URL (sanitizing trailing slashes)
    const cleanUrl = (this.url || "").replace(/\/+$/, "");
    const wsUrl = cleanUrl.replace(/^http/, "ws") + "/ws";

    try {
      this.ws = new WebSocket(wsUrl);
    } catch (e) {
      console.error("[MusicAssistantClient] Failed to construct WebSocket", e);
      this.ws = null;
      this.isConnected = false;
      this.emit("systemReady", false);
      if (this.shouldReconnect && !this.authFailed) {
        this.emitConnectionError("connection", "Unable to reach the server. Check URL/port.", e?.message || "WebSocket error");
        this.reconnectTimer = setTimeout(() => this.connect(), 4000);
      }
      return;
    }

    this.ws.onopen = () => {
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

    this.ws.onclose = (event) => {
      this.isConnected = false;
      this.emit("systemReady", false);

      // Immediately reject pending requests so they do not linger and trigger timeout error screens
      for (const [id, req] of this.pendingRequests.entries()) {
        if (req.timeoutId) clearTimeout(req.timeoutId);
        req.reject(new Error(`WebSocket closed (${event?.reason || "connection lost"})`));
      }
      this.pendingRequests.clear();

      if (this.shouldReconnect && !this.authFailed) {
        this.emitConnectionError("connection", "Unable to reach the server. Reconnecting...", event?.reason || "WebSocket closed");
        if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
        this.reconnectTimer = setTimeout(() => this.connect(), 4000);
      }
    };

    this.ws.onerror = (err) => {
      console.error("MA WebSocket error", err);
      for (const [id, req] of this.pendingRequests.entries()) {
        if (req.timeoutId) clearTimeout(req.timeoutId);
        req.reject(new Error("WebSocket error"));
      }
      this.pendingRequests.clear();

      if (this.shouldReconnect && !this.authFailed) {
        this.emitConnectionError("connection", "Unable to reach the server. Check URL/port.", err?.message || "WebSocket error");
      }
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
        this.authFailed = true;
        this.shouldReconnect = false;
        this.emitConnectionError("auth", "Authentication failed. Please update your token.", err?.message || "Authentication failed");
        if (this.ws) {
          try {
            this.ws.close();
          } catch (e) {
            // ignore
          }
        }
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
    }).catch(err => {
        console.error('Failed to fetch initial state', err);
        if (this.isAuthErrorMessage(err?.message)) {
            this.authFailed = true;
            this.shouldReconnect = false;
            this.emitConnectionError("auth", "Authentication failed. Please update your token.", err?.message || "Authentication failed");
            if (this.ws) {
                try {
                    this.ws.close();
                } catch (e) {
                    // ignore
                }
            }
        }
    });
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
    if (data.server_id && data.server_version) {
      this.serverInfo = data;
      console.log(`[MusicAssistantClient] Connected to MA server ${data.server_version} (schema ${data.schema_version})`);
      return;
    }

    if (data.event) {
      this.handleEvent(data);
      return;
    }

    // Handle Command Responses
    // MA returns message_id as string sometimes, we store as number.
    const msgId = Number(data.message_id);
    if (!isNaN(msgId) && this.pendingRequests.has(msgId)) {
      const { resolve, reject, timeoutId } = this.pendingRequests.get(msgId);
      if (timeoutId) clearTimeout(timeoutId);
      this.pendingRequests.delete(msgId);

      // MA error format
      if (data.error) {
        const message = String(data.error);
        if (this.isAuthErrorMessage(message)) {
          this.authFailed = true;
          this.shouldReconnect = false;
          this.emitConnectionError("auth", "Authentication failed. Please update your token.", message);
          if (this.ws) {
            try {
              this.ws.close();
            } catch (e) {
              // ignore
            }
          }
        }
        reject(new Error(message));
      } else {
        // Success
        const result = data.result !== undefined ? data.result : data;
        const resultErrorMessage = this.extractErrorMessage(result);
        if (resultErrorMessage && this.isAuthErrorMessage(resultErrorMessage)) {
          this.authFailed = true;
          this.shouldReconnect = false;
          this.emitConnectionError("auth", "Authentication failed. Please update your token.", resultErrorMessage);
          if (this.ws) {
            try {
              this.ws.close();
            } catch (e) {
              // ignore
            }
          }
          reject(new Error(resultErrorMessage));
          return;
        }
        if (result === false) {
          reject(new Error("Authentication failed"));
        } else {
          resolve(result);
        }
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

  emitConnectionError(type, message, detail) {
    this.emit("connectionError", {
      type: type || "unknown",
      message: message || "Connection error",
      detail: detail || ""
    });
  }

  isAuthErrorMessage(message) {
    if (!message) return false;
    const normalized = message.toLowerCase();
    return normalized.includes("auth") || normalized.includes("unauthorized") || normalized.includes("forbidden");
  }

  extractErrorMessage(result) {
    if (!result) return "";
    if (typeof result === "string") return result;
    if (typeof result === "object") {
      if (typeof result.error === "string") return result.error;
      if (typeof result.message === "string") return result.message;
      if (typeof result.details === "string") return result.details;
      if (typeof result.detail === "string") return result.detail;
      if (typeof result.error_code === "number" && typeof result.details === "string") {
        return `${result.error_code}: ${result.details}`;
      }
    }
    return "";
  }

  async sendCommand(command, args = {}) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket not connected');
    }

    const id = this.messageId++;
    const payload = {
      message_id: id,
      command: command,
      args: args
    };

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`Command ${command} timed out`));
        }
      }, 30000);

      this.pendingRequests.set(id, { resolve, reject, command, timeoutId });

      try {
        this.ws.send(JSON.stringify(payload));
      } catch (e) {
        clearTimeout(timeoutId);
        this.pendingRequests.delete(id);
        reject(e);
      }
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

  joinPlayer(targetPlayerId, playerToJoinId) {
    const idsToAdd = Array.isArray(playerToJoinId) ? playerToJoinId : [playerToJoinId];
    return this.sendCommand("players/cmd/set_members", {
      target_player: targetPlayerId,
      player_ids_to_add: idsToAdd,
    });
  }

  transferQueue(sourceQueueId, targetQueueId, autoPlay = true) {
    return this.sendCommand("player_queues/transfer", {
      source_queue_id: sourceQueueId,
      target_queue_id: targetQueueId,
      auto_play: autoPlay,
    });
  }

  ungroupPlayer(leaderPlayerId, childPlayerIds = []) {
    if (Array.isArray(childPlayerIds) && childPlayerIds.length > 0) {
      return this.sendCommand("players/cmd/set_members", {
        target_player: leaderPlayerId,
        player_ids_to_remove: childPlayerIds,
      });
    }
    return this.sendCommand("players/cmd/ungroup", {
      player_id: leaderPlayerId,
    });
  }

  /**
   * Fetch all recommendations from the unified endpoint.
   * Returns an array of folder objects, each containing items.
   */
  async getRecommendations() {
    try {
      return await this.sendCommand("music/recommendations");
    } catch (e) {
      console.error("Failed to get recommendations", e);
      return [];
    }
  }

  /**
   * Get items from a specific recommendation category.
   * @param {string} categoryId - The item_id of the folder (e.g., 'recently_played', 'favorite_radio')
   * @param {number} limit - Maximum number of items to return
   * @returns {Promise<Array>} Array of media items
   */
  async getRecommendationsByCategory(categoryId, limit = 20) {
    try {
      const recommendations = await this.getRecommendations();
      const folder = recommendations.find(f => f.item_id === categoryId);
      if (folder && Array.isArray(folder.items) && folder.items.length > 0) {
        return folder.items.slice(0, limit);
      }
      // In MA 2.9+ / 2.10+, music/recommendations returns folder shells with empty items: []
      // Fallback directly to specific library endpoints
      return await this.fetchCategoryFallback(categoryId, limit);
    } catch (e) {
      console.warn(`Failed to get recommendations for category '${categoryId}', trying fallback:`, e);
      return await this.fetchCategoryFallback(categoryId, limit);
    }
  }

  async fetchCategoryFallback(categoryId, limit = 20) {
    try {
      if (categoryId === 'recently_played') {
        const res = await this.sendCommand("music/recently_played_items", { limit });
        return Array.isArray(res) ? res.slice(0, limit) : (res?.items || []).slice(0, limit);
      }
      if (categoryId === 'favorite_radio') {
        const res = await this.sendCommand("music/radios/library_items", { favorite: true });
        return Array.isArray(res) ? res.slice(0, limit) : (res?.items || []).slice(0, limit);
      }
      if (categoryId === 'favorite_playlists') {
        const res = await this.sendCommand("music/playlists/library_items", { favorite: true });
        return Array.isArray(res) ? res.slice(0, limit) : (res?.items || []).slice(0, limit);
      }
      if (categoryId === 'random_artists') {
        const res = await this.sendCommand("music/artists/library_items", { favorite: true });
        let items = Array.isArray(res) ? res : (res?.items || []);
        items = [...items].sort(() => 0.5 - Math.random());
        return items.slice(0, limit);
      }
    } catch (err) {
      console.error(`Fallback failed for category '${categoryId}'`, err);
    }
    return [];
  }
}

export default MusicAssistantClient;
