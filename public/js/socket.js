class WebSocketManager {
  constructor() {
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectTimer = null;
  }

  // Connect to the WebSockets server
  connect() {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const loc = window.location;
    const wsProto = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${loc.host}`;

    console.log(`Connecting to WebSocket at ${wsUrl}`);
    this.ws = new WebSocket(wsUrl);

    this.ws.onopen = () => {
      console.log('WebSocket connection established.');
      this.reconnectAttempts = 0;
      
      // Auto reconnecting to room if session was active
      if (app.token && app.activeRoomCode) {
        this.joinRoom(app.activeRoomCode, app.isSpectator);
      }
    };

    this.ws.onmessage = (event) => {
      try {
        const { type, data } = JSON.parse(event.data);
        this.handleMessage(type, data);
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    this.ws.onclose = (event) => {
      console.warn('WebSocket connection closed.', event.reason);
      if (app.token && this.reconnectAttempts < this.maxReconnectAttempts) {
        app.showToast('info', 'Disconnected. Attempting reconnection...');
        this.reconnectAttempts++;
        this.reconnectTimer = setTimeout(() => this.connect(), 2000);
      } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        app.showToast('error', 'Unable to reconnect. Returning to home.');
        app.navigateTo('home');
      }
    };

    this.ws.onerror = (err) => {
      console.error('WebSocket encountered an error:', err);
    };
  }

  // Safe wrapper for sending JSON
  send(type, data = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('WebSocket is not open. Queueing or ignoring message.');
      return;
    }

    const payload = {
      type,
      token: app.token,
      data
    };
    this.ws.send(JSON.stringify(payload));
  }

  // Action emitters
  joinRoom(code, isSpectator = false) {
    app.isSpectator = isSpectator;
    this.send('join_lobby', { code, isSpectator });
  }

  leaveRoom() {
    this.send('leave_lobby');
    app.activeRoomCode = null;
    app.isSpectator = false;
    app.navigateTo('home');
  }

  toggleReady() {
    const readyBtn = document.getElementById('btn-ready');
    const isReady = readyBtn.classList.toggle('active');
    readyBtn.innerText = isReady ? 'READY!' : 'READY';
    readyBtn.style.backgroundColor = isReady ? 'var(--green-color)' : 'var(--yellow-color)';
    
    this.send('player_ready', { ready: isReady });
  }

  addAi(difficulty) {
    this.send('add_ai_opponent', { difficulty });
  }

  removeAi(aiId) {
    this.send('remove_ai_opponent', { aiId });
  }

  updateRules(settings) {
    this.send('configure_rules', { settings });
  }

  startGame() {
    this.send('start_game');
  }

  playCard(cardId, chosenColor = null, isJumpIn = false, swapTargetId = null) {
    this.send('play_card', { cardId, chosenColor, isJumpIn, swapTargetId });
  }

  drawCard() {
    this.send('draw_card');
  }

  passTurn() {
    this.send('pass_turn');
  }

  chooseSevenSwap(targetUserId) {
    this.send('seven_swap_choose', { targetUserId });
  }

  callUno() {
    this.send('call_uno');
  }

  calloutPlayer(victimId) {
    this.send('callout_player', { victimId });
  }

  sendChat(message) {
    this.send('chat_message', { message });
  }

  sendEmote(emoji) {
    this.send('emoji_reaction', { emoji });
  }

  quickPlay() {
    // Generates a mock quickmatch code or hits a public matchmaking route
    const code = 'QUICK' + Math.floor(10 + Math.random() * 90);
    this.joinRoom(code, false);
  }

  joinRoomByCode() {
    const codeInput = document.getElementById('join-room-code-input');
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 3) {
      app.showToast('error', 'Room code must be at least 3 letters.');
      return;
    }
    this.joinRoom(code, false);
  }

  createCustomRoom() {
    const maxSel = document.getElementById('create-max-players');
    const maxPlayers = parseInt(maxSel.value, 10);
    const spectators = document.getElementById('create-spectate').checked;
    
    // Generate random code
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    app.isSpectator = false;
    this.send('join_lobby', {
      code,
      isSpectator: false,
      settings: { maxPlayers, spectators }
    });
  }

  // Handle incoming server messages
  handleMessage(type, data) {
    switch (type) {
      case 'join_success':
        app.activeRoomCode = data.roomCode;
        app.closeOnlineLobbiesModal();
        app.navigateTo('lobby');
        // Clear chat
        const lobbyChat = document.getElementById('lobby-chat-messages');
        if (lobbyChat) lobbyChat.innerHTML = '';
        const gameChat = document.getElementById('game-chat-messages');
        if (gameChat) gameChat.innerHTML = '';
        break;

      case 'join_failed':
        app.showToast('error', data.message);
        break;

      case 'game_started':
        app.navigateTo('game');
        app.showToast('success', 'Game Started! Shuffling & Dealing cards.');
        audio.playVictory(); // Starting chime
        break;

      case 'game_state_update':
        app.gameState = data;
        ui.renderGameBoard(data);
        break;

      case 'timer_tick':
        if (app.gameState) {
          app.gameState.timeLeft = data.timeLeft;
          ui.updateCountdownTimer(data.currentPlayerId, data.timeLeft);
        }
        break;

      case 'card_played':
        audio.playPlace();
        break;

      case 'player_drew':
        audio.playDraw();
        break;

      case 'card_drawn':
        // Synthesize draws
        audio.playDraw();
        // Trigger dealing/draw cards animation in ui
        ui.animateDrawCards(data.cards);
        break;

      case 'uno_called':
        audio.playUno();
        app.showToast('info', `${data.username} shouted UNO!`);
        break;

      case 'emoji_reaction':
        ui.renderFloatingEmote(data.userId, data.emoji);
        break;

      case 'chat_message':
        ui.appendChatMessage(data);
        break;

      case 'game_over':
        audio.playVictory();
        ui.showGameOverModal(data);
        break;

      case 'toast':
        app.showToast(data.type, data.message);
        break;

      case 'banned':
        alert(`Your account has been banned: ${data.reason}`);
        app.logout();
        break;

      case 'error':
        app.showToast('error', data.message);
        break;
    }
  }
}

const socket = new WebSocketManager();
window.socket = socket;
