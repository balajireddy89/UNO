class UIRenderer {
  constructor() {
    this.shopTab = 'cardBack';
    this.leaderboardTab = 'wins';
    this.activeWildCardId = null; // cache wild card playing ID
  }

  // Render the circular game board and player seats
  renderGameBoard(state) {
    const active = state.players.filter(p => !p.isSpectator);
    const selfId = app.user ? app.user.id : (app.gameMode === 'offline' ? 'local_0' : 'practice_human');
    
    // 0. Render Lobby UI if game has not started yet
    if (!state.gameStarted) {
      document.getElementById('lobby-code-val').innerText = state.roomId;
      document.getElementById('lobby-players-count').innerText = active.length;
      document.getElementById('lobby-max-players').innerText = state.settings.maxPlayers;
      
      const isCreator = selfId === state.creatorId;
      this.setLobbySettingsInputs(state.settings, isCreator);
      
      const startBtn = document.getElementById('btn-start-game');
      const readyBtn = document.getElementById('btn-ready');
      
      if (isCreator) {
        startBtn.style.display = 'block';
      } else {
        startBtn.style.display = 'none';
      }
      
      const listContainer = document.getElementById('lobby-players-list');
      listContainer.innerHTML = '';
      
      state.players.forEach(p => {
        const isHost = p.id === state.creatorId;
        const hostBadge = isHost ? '<span class="slot-badge host">Host</span>' : '';
        const aiBadge = p.isAI ? '<span class="slot-badge ai">Bot</span>' : '';
        const specBadge = p.isSpectator ? '<span class="slot-badge spectator">Spectator</span>' : '';
        
        let statusText = '';
        let kickBtn = '';
        
        if (p.isSpectator) {
          statusText = '<span class="ready-status-text ready">Watching</span>';
        } else {
          statusText = p.isReady ? 
            '<span class="ready-status-text ready">READY</span>' : 
            '<span class="ready-status-text not-ready">NOT READY</span>';
            
          if (isCreator && p.isAI) {
            kickBtn = `<button class="btn btn-sm btn-outline" style="color:var(--red-color); border-color:var(--red-glow);" onclick="socket.removeAi('${p.id}')">Remove</button>`;
          }
        }
        
        const avatarSrc = `assets/avatars/${p.avatar || 'default_avatar_1'}.svg`;
        
        const slotHtml = `
          <div class="lobby-player-slot">
            <div class="slot-left">
              <img src="${avatarSrc}" alt="Avatar" class="slot-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23444%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>U</text></svg>'">
              <span class="slot-name">${p.username}</span>
              ${hostBadge}
              ${aiBadge}
              ${specBadge}
            </div>
            <div class="slot-right">
              ${statusText}
              ${kickBtn}
            </div>
          </div>
        `;
        listContainer.innerHTML += slotHtml;
      });
      return;
    }

    // Find my seat index
    let myIdx = active.findIndex(p => p.id === selfId);
    if (myIdx === -1) myIdx = 0; // fallback if spectator or offline

    // 1. Render Opponent Seats circularly
    const seatsContainer = document.getElementById('player-seats');
    seatsContainer.innerHTML = '';

    // Arrange other players around the table, starting from me at the bottom
    active.forEach((p, idx) => {
      // Don't draw ourselves on the seat circle if we are playing and have our hand shelf
      const isSelf = p.id === selfId && app.gameMode !== 'offline';
      if (isSelf) return;

      const seatDiv = document.createElement('div');
      seatDiv.className = `player-seat`;
      seatDiv.id = `seat-${p.id}`;

      // Calculate relative seat position based on index offset
      const offsetIdx = (idx - myIdx + active.length) % active.length;
      
      // Calculate coordinates on ellipse circumference (x radius: 36%, y radius: 32%)
      const angle = (offsetIdx / active.length) * Math.PI * 2 + Math.PI / 2;
      const left = 50 + Math.cos(angle) * 36;
      const top = 50 + Math.sin(angle) * 28;
      
      seatDiv.style.left = `${left}%`;
      seatDiv.style.top = `${top}%`;
      seatDiv.style.transform = `translate(-50%, -50%)`;

      // Active status and timers
      const isCurrentTurn = state.currentPlayerIdx === idx;
      if (isCurrentTurn) {
        seatDiv.classList.add('active-turn');
      }

      // Offline check (only relevant for online games)
      const isOffline = p.isOffline ? '<span class="seat-status-indicator" style="color:var(--red-color);">OFFLINE</span>' : '';
      
      // UNO shout indicator
      const unoCall = p.unoCalled ? `<div class="seat-uno-shout">UNO!</div>` : '';

      // Call Out Action Button: visible if player has 1 card left and didn't call UNO
      let calloutBtn = '';
      const showCallout = p.cardCount === 1 && !p.unoCalled && !p.isAI && (state.currentPlayerIdx !== idx) && !state.gameEnded;
      if (showCallout) {
        calloutBtn = `
          <button class="btn btn-sm btn-primary pulse-btn" style="position:absolute; top:-28px; font-size:0.65rem;" onclick="ui.handleCalloutClick('${p.id}')">
            🚨 Call Out
          </button>
        `;
      }

      // Set avatar cosmetic skin if unlocked
      const avatarSrc = `assets/avatars/${p.avatar || 'default_avatar_1'}.svg`;

      seatDiv.innerHTML = `
        ${calloutBtn}
        ${unoCall}
        <div class="seat-avatar-wrapper">
          <img src="${avatarSrc}" alt="Avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23444%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>U</text></svg>'">
          <span class="card-count-badge">${p.cardCount}</span>
        </div>
        <span class="seat-name">${p.username}</span>
        ${isOffline}
        ${isCurrentTurn && !state.gameEnded ? `
          <div class="seat-timer-progress">
            <div id="timer-bar-${p.id}" class="seat-timer-bar" style="width: 100%"></div>
          </div>
        ` : ''}
      `;
      
      seatsContainer.appendChild(seatDiv);
    });

    // 2. Render Discard Pile
    const discardPile = document.getElementById('discard-pile');
    discardPile.innerHTML = '';
    if (state.topCard) {
      const cardNode = this.createCardDOM(state.topCard);
      cardNode.classList.add('play-animation');
      
      // If color choice active, apply color glow to top card
      if (state.colorChoice) {
        cardNode.className = `game-card card-${state.colorChoice} play-animation card-glow-pulse`;
      }
      discardPile.appendChild(cardNode);
    } else {
      discardPile.innerHTML = `<div class="empty-discard-placeholder">Empty</div>`;
    }

    // 3. Update Draw Pile counts
    document.getElementById('deck-count-val').innerText = state.deckCount;

    // Apply card skin from active profile
    const drawBack = document.querySelector('#draw-pile .card-back-render');
    if (drawBack && app.user) {
      const skins = { default_classic: 'classic', neon_glow: 'neon', cyber_grid: 'cyberpunk', holo_foil: 'holographic' };
      const backType = skins[app.user.cardBack] || 'classic';
      drawBack.className = `card-back-render card-back-${backType}`;
    }

    // 4. Stacking indicator banner
    const stackBanner = document.getElementById('penalty-notification');
    if (state.stackCount > 0) {
      stackBanner.innerText = `+${state.stackCount} Penalty Accumulating!`;
      stackBanner.style.display = 'block';
    } else {
      stackBanner.style.display = 'none';
    }

    // 5. Render client hand shelf
    const mySeat = active.find(p => p.id === selfId);
    const handCards = document.getElementById('client-hand-cards');
    handCards.innerHTML = '';

    if (mySeat && mySeat.hand) {
      document.getElementById('hand-count-val').innerText = mySeat.hand.length;
      
      // Angle fans rotation
      mySeat.hand.forEach((c, index) => {
        const cardNode = this.createCardDOM(c);
        
        // Calculate tilt fan angles for clean cards aesthetics
        const mid = (mySeat.hand.length - 1) / 2;
        const angle = (index - mid) * 3; // 3 deg rotation gap
        cardNode.style.setProperty('--hover-rot', `${angle}deg`);
        cardNode.style.transform = `rotate(${angle}deg)`;
        
        // If my turn, allow clicks
        if (state.isMyTurn && !state.gameEnded && (state.pendingSevenSwap === null)) {
          cardNode.onclick = () => this.handlePlayClick(c.id);
        } else {
          cardNode.style.cursor = 'not-allowed';
        }
        
        handCards.appendChild(cardNode);
      });
    }

    // 6. Action turn controls
    const passBtn = document.getElementById('btn-pass-turn');
    const unoBtn = document.getElementById('btn-call-uno');
    
    // Pass button: only active if they drew a card but cannot/does not play it
    const showPass = state.isMyTurn && !state.gameEnded; // simple toggle
    passBtn.style.display = showPass ? 'block' : 'none';

    // UNO call button: visible if player holds 2 cards (before playing) or 1 card
    const myCardsCount = mySeat ? mySeat.cardCount : 0;
    const showUno = myCardsCount <= 2 && !state.gameEnded && !state.isSpectator;
    unoBtn.style.display = showUno ? 'block' : 'none';

    // Direction indicators rotation circle
    const dirRing = document.getElementById('direction-ring');
    const dirIndicator = document.getElementById('direction-indicator');
    if (state.direction === 1) {
      dirRing.className = 'direction-ring clockwise';
      dirIndicator.innerText = 'Clockwise ↻';
      dirIndicator.className = 'dir-clockwise';
    } else {
      dirRing.className = 'direction-ring counter';
      dirIndicator.innerText = 'Counter-Clockwise ↺';
      dirIndicator.className = 'dir-counter';
    }

    // Countdown turn timerHUD badge
    document.getElementById('turn-countdown-indicator').innerText = `${state.timeLeft}s`;

    // 7. Handle Seven Swapping Overlay Selection Mode
    const sevenModal = document.getElementById('modal-seven-swap');
    if (state.pendingSevenSwap === selfId) {
      sevenModal.style.display = 'flex';
      const oppsList = document.getElementById('swap-opponents-list');
      oppsList.innerHTML = '';

      active.forEach(p => {
        if (p.id !== selfId) {
          const btn = document.createElement('button');
          btn.className = 'btn btn-secondary btn-block';
          btn.innerText = `${p.username} (${p.cardCount} cards)`;
          btn.onclick = () => {
            sevenModal.style.display = 'none';
            if (app.gameMode === 'online') {
              socket.chooseSevenSwap(p.id);
            } else {
              app.executeOfflinePlay(selfId, this.activeSevenCardId, null, p.id);
            }
          };
          oppsList.appendChild(btn);
        }
      });
    } else {
      sevenModal.style.display = 'none';
    }
  }

  // Create standard HTML card nodes
  createCardDOM(card) {
    const cardDiv = document.createElement('div');
    const colorClass = `card-${card.color}`;
    cardDiv.className = `game-card ${colorClass}`;
    cardDiv.id = `card-${card.id}`;

    // Mini symbol tl
    const tl = document.createElement('span');
    tl.className = 'card-corner corner-tl';
    tl.innerText = card.display;
    cardDiv.appendChild(tl);

    // Center Large value
    const center = document.createElement('span');
    center.className = 'card-center';
    
    // Symbol checking for special icons
    if (card.type === 'skip') {
      center.className = 'card-center card-center-symbol';
      center.innerText = '⊘';
    } else if (card.type === 'reverse') {
      center.className = 'card-center card-center-symbol';
      center.innerText = '⇄';
    } else if (card.type === 'draw2') {
      center.className = 'card-center card-center-text';
      center.innerText = '+2';
    } else if (card.type === 'wild4') {
      center.className = 'card-center card-center-text';
      center.innerText = '+4';
    } else if (card.type === 'wild') {
      center.className = 'card-center card-center-text';
      center.innerText = 'W';
    } else {
      center.innerText = card.value;
    }
    
    cardDiv.appendChild(center);

    // Mini symbol br
    const br = document.createElement('span');
    br.className = 'card-corner corner-br';
    br.innerText = card.display;
    cardDiv.appendChild(br);

    return cardDiv;
  }

  // Countdown timer indicators ticks
  updateCountdownTimer(currentPlayerId, timeLeft) {
    const seat = document.getElementById(`seat-${currentPlayerId}`);
    const turnCount = document.getElementById('turn-countdown-indicator');
    
    if (turnCount) {
      turnCount.innerText = `${timeLeft}s`;
    }

    if (seat) {
      const bar = seat.querySelector('.seat-timer-bar');
      if (bar) {
        const limit = app.gameState ? app.gameState.settings.turnTimerLimit : (app.offlineState ? app.offlineState.settings.turnTimerLimit : 30);
        const percent = Math.round((timeLeft / limit) * 100);
        bar.style.width = `${percent}%`;

        // apply danger colors warnings
        if (timeLeft <= 5) {
          bar.className = 'seat-timer-bar critical';
        } else if (timeLeft <= 10) {
          bar.className = 'seat-timer-bar warning';
        } else {
          bar.className = 'seat-timer-bar';
        }
      }
    }
  }

  // Draw Card click
  handleDrawClick() {
    if (app.gameMode === 'online') {
      socket.drawCard();
    } else {
      const active = app.offlineState.players;
      const current = active[app.offlineState.currentPlayerIdx];
      app.executeOfflineDraw(current.id);
    }
  }

  // Pass Turn click
  handlePassClick() {
    if (app.gameMode === 'online') {
      socket.passTurn();
    } else {
      const active = app.offlineState.players;
      const current = active[app.offlineState.currentPlayerIdx];
      app.executeOfflinePass(current.id);
    }
  }

  // UNO click
  handleUnoClick() {
    if (app.gameMode === 'online') {
      socket.callUno();
    } else {
      const selfId = app.user ? app.user.id : 'practice_human';
      app.offlineState.unoState[selfId].unoCalled = true;
      audio.playUno();
      app.showToast('info', 'You called UNO!');
      this.renderGameBoard(app.offlineState);
    }
  }

  // Call Out click
  handleCalloutClick(victimId) {
    if (app.gameMode === 'online') {
      socket.calloutPlayer(victimId);
    } else {
      app.drawCardsLocal(app.offlineState.players.find(p => p.id === victimId), 2);
      app.showToast('warning', `You CALLED OUT opponent for forgetting UNO! They drew 2 cards.`);
      audio.playNotify();
      this.renderGameBoard(app.offlineState);
    }
  }

  // Card placement validations and modals trigger
  handlePlayClick(cardId) {
    // Look up card details
    let playerHand = [];
    if (app.gameMode === 'online') {
      const selfSeat = app.gameState.players.find(p => p.id === app.user.id);
      playerHand = selfSeat ? selfSeat.hand : [];
    } else {
      const active = app.offlineState.players;
      const current = active[app.offlineState.currentPlayerIdx];
      playerHand = current ? current.hand : [];
    }

    const card = playerHand.find(c => c.id === cardId);
    if (!card) return;

    // Rules validation checks before prompting wild choice
    const topCard = app.gameMode === 'online' ? app.gameState.topCard : app.offlineState.discardPile[app.offlineState.discardPile.length - 1];
    const settings = app.gameMode === 'online' ? app.gameState.settings : app.offlineState.settings;
    const targetColor = app.gameMode === 'online' ? app.gameState.colorChoice : app.offlineState.colorChoice;
    const stackCount = app.gameMode === 'online' ? app.gameState.stackCount : app.offlineState.stackCount;

    const isValidPlay = (c) => {
      if (settings.stackDraws && stackCount > 0) {
        if (topCard.type === 'draw2' && c.type === 'draw2') return true;
        if (topCard.type === 'wild4' && c.type === 'wild4') return true;
        return false;
      }
      if (c.color === 'wild') return true;
      const activeColor = targetColor || topCard.color;
      if (c.color === activeColor) return true;
      if (c.type === topCard.type && c.type !== 'number') return true;
      if (c.type === 'number' && topCard.type === 'number' && c.value === topCard.value) return true;
      return false;
    };

    if (!isValidPlay(card)) {
      app.showToast('error', 'Invalid card play choice.');
      return;
    }

    this.activePlayCardId = cardId;

    if (card.color === 'wild') {
      // Trigger wild color picker modal
      document.getElementById('modal-wild-choice').style.display = 'flex';
    } else if (settings.sevenZero && card.type === 'number' && card.value === 7) {
      // Prompt swap target
      this.activeSevenCardId = cardId;
      const selfId = app.user ? app.user.id : (app.gameMode === 'offline' ? 'local_0' : 'practice_human');
      const activePlayers = app.gameMode === 'online' ? app.gameState.players : app.offlineState.players;
      
      const sevenModal = document.getElementById('modal-seven-swap');
      sevenModal.style.display = 'flex';
      const oppsList = document.getElementById('swap-opponents-list');
      oppsList.innerHTML = '';

      activePlayers.forEach(p => {
        if (p.id !== selfId && !p.isSpectator) {
          const btn = document.createElement('button');
          btn.className = 'btn btn-secondary btn-block';
          btn.innerText = `${p.username} (${p.cardCount} cards)`;
          btn.onclick = () => {
            sevenModal.style.display = 'none';
            if (app.gameMode === 'online') {
              socket.playCard(cardId, null, false, p.id);
            } else {
              app.executeOfflinePlay(selfId, cardId, null, p.id);
            }
          };
          oppsList.appendChild(btn);
        }
      });
    } else {
      // Normal card placement
      const selfId = app.user ? app.user.id : 'practice_human';
      if (app.gameMode === 'online') {
        socket.playCard(cardId, null, false);
      } else {
        const active = app.offlineState.players;
        const current = active[app.offlineState.currentPlayerIdx];
        app.executeOfflinePlay(current.id, cardId, null);
      }
    }
  }

  // Select Wild color callback
  selectWildColor(color) {
    document.getElementById('modal-wild-choice').style.display = 'none';
    const selfId = app.user ? app.user.id : 'practice_human';
    if (app.gameMode === 'online') {
      socket.playCard(this.activePlayCardId, color, false);
    } else {
      const active = app.offlineState.players;
      const current = active[app.offlineState.currentPlayerIdx];
      app.executeOfflinePlay(current.id, this.activePlayCardId, color);
    }
  }

  // Draw card Deal slide animation helper
  animateDrawCards(cards) {
    // Add visual dealing templates if necessary.
    // Standard DOM card addition handles animations automatically via cards.css .deal-animation
  }

  // Floating emotes reaction engine
  renderFloatingEmote(userId, emoji) {
    let seat = document.getElementById(`seat-${userId}`);
    if (userId === (app.user ? app.user.id : 'practice_human') && app.gameMode !== 'offline') {
      // Float from bottom HUD center if it's us
      seat = document.querySelector('.client-hand-shelf-container');
    }

    if (seat) {
      const bubble = document.createElement('div');
      bubble.className = 'seat-emote-bubble';
      bubble.innerText = emoji;
      
      // Relative offset positioning
      bubble.style.left = '50%';
      bubble.style.transform = 'translateX(-50%)';
      
      seat.appendChild(bubble);
      bubble.addEventListener('animationend', () => {
        bubble.remove();
      });
    }
  }

  toggleEmoteRing() {
    const ring = document.getElementById('emote-ring');
    ring.style.display = ring.style.display === 'none' ? 'flex' : 'none';
  }

  sendEmote(emoji) {
    this.toggleEmoteRing();
    if (app.gameMode === 'online') {
      socket.sendEmote(emoji);
    } else {
      const selfId = app.user ? app.user.id : 'practice_human';
      this.renderFloatingEmote(selfId, emoji);
    }
  }

  // Lobby Settings update events
  onRuleChange() {
    // Only creator of online room can modify rules
    if (app.gameMode === 'online') {
      if (app.gameState && app.gameState.creatorId !== app.user.id) return;
      
      const settings = {
        stackDraws: document.getElementById('rule-stacking').checked,
        jumpIn: document.getElementById('rule-jumpin').checked,
        sevenZero: document.getElementById('rule-sevenzero').checked,
        turnTimerLimit: parseInt(document.getElementById('rule-timer').value, 10)
      };
      socket.updateRules(settings);
    }
  }

  showAddAiDialog() {
    const difficulty = prompt('Enter AI Difficulty level: easy, medium, or hard', 'medium');
    if (difficulty && ['easy', 'medium', 'hard'].includes(difficulty.toLowerCase())) {
      socket.addAi(difficulty.toLowerCase());
    } else if (difficulty) {
      alert('Invalid level. Please choose easy, medium, or hard.');
    }
  }

  // Exit game checks
  confirmExitGame() {
    const check = confirm('Are you sure you want to quit the match?');
    if (check) {
      if (app.gameMode === 'online') {
        socket.leaveRoom();
      } else {
        app.clearOfflineTimer();
        app.navigateTo('home');
      }
    }
  }

  // End round modal display
  showGameOverModal(data) {
    document.getElementById('game-over-winner-name').innerText = data.winnerName;
    document.getElementById('game-over-coins').innerText = `+${data.rewards.coinsEarned}`;
    document.getElementById('game-over-xp').innerText = `+${data.rewards.xpEarned}`;

    if (app.user) {
      document.getElementById('game-over-stats-report').innerText = `Career progression updated successfully.`;
    } else {
      document.getElementById('game-over-stats-report').innerText = `Guest profile does not persist progression history.`;
    }

    document.getElementById('modal-game-over').style.display = 'flex';
  }

  // Lobby settings inputs values setting
  setLobbySettingsInputs(settings, isCreator) {
    const stack = document.getElementById('rule-stacking');
    const jump = document.getElementById('rule-jumpin');
    const sz = document.getElementById('rule-sevenzero');
    const timer = document.getElementById('rule-timer');

    stack.checked = settings.stackDraws;
    jump.checked = settings.jumpIn;
    sz.checked = settings.sevenZero;
    timer.value = settings.turnTimerLimit;

    // Enable/disable for non-hosts
    stack.disabled = !isCreator;
    jump.disabled = !isCreator;
    sz.disabled = !isCreator;
    timer.disabled = !isCreator;
  }

  // Chats updates appending
  appendChatMessage(data) {
    const lobbyLogs = document.getElementById('lobby-chat-messages');
    const gameLogs = document.getElementById('game-chat-messages');

    const createMsgNode = () => {
      const div = document.createElement('div');
      if (data.sender === 'SYSTEM') {
        div.className = 'chat-msg system';
        div.innerHTML = `<span class="sender">${data.sender}:</span>${data.message}`;
      } else {
        div.className = 'chat-msg';
        div.innerHTML = `<span class="sender">${data.sender}:</span>${data.message}`;
      }
      return div;
    };

    if (lobbyLogs && app.currentView === 'lobby') {
      lobbyLogs.appendChild(createMsgNode());
      lobbyLogs.scrollTop = lobbyLogs.scrollHeight;
      audio.playNotify();
    }
    if (gameLogs && app.currentView === 'game') {
      gameLogs.appendChild(createMsgNode());
      gameLogs.scrollTop = gameLogs.scrollHeight;
      audio.playNotify();
    }
  }

  sendLobbyChat() {
    const input = document.getElementById('lobby-chat-input');
    const val = input.value.trim();
    if (val.length > 0) {
      socket.sendChat(val);
      input.value = '';
    }
  }

  sendGameChat() {
    const input = document.getElementById('game-chat-input');
    const val = input.value.trim();
    if (val.length > 0) {
      if (app.gameMode === 'online') {
        socket.sendChat(val);
      } else {
        // Echo locally
        this.appendChatMessage({ sender: 'You', message: val });
      }
      input.value = '';
    }
  }

  toggleGameChat() {
    const chatDrawer = document.getElementById('game-chat-overlay');
    chatDrawer.classList.toggle('open');
  }

  // Avatar selector modal triggers
  openAvatarSelector() {
    const modal = document.getElementById('modal-avatar-select');
    modal.style.display = 'flex';
    const grid = document.getElementById('avatars-picker-grid');
    grid.innerHTML = '';

    const avatars = ['default_avatar_1', 'ninja_mask', 'astro_helmet', 'cyber_glitch'];

    avatars.forEach(av => {
      const isUnlocked = app.user.unlockedAvatars.includes(av);
      const isEquipped = app.user.avatar === av;

      const div = document.createElement('div');
      div.className = `avatar-pick-item ${isEquipped ? 'active' : ''}`;
      if (!isUnlocked) {
        div.style.opacity = '0.35';
        div.title = 'Locked - Unlock in the shop!';
      } else {
        div.onclick = () => this.equipAvatarLocal(av);
      }

      div.innerHTML = `<img src="assets/avatars/${av}.svg" alt="Avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23444%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>U</text></svg>'">`;
      grid.appendChild(div);
    });
  }

  closeAvatarSelector() {
    document.getElementById('modal-avatar-select').style.display = 'none';
  }

  async equipAvatarLocal(avatarKey) {
    this.closeAvatarSelector();
    try {
      const res = await fetch(`/api/shop/equip?token=${app.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'avatar', itemKey: avatarKey })
      });
      if (res.ok) {
        app.showToast('success', 'Avatar equipped.');
        app.renderProfileScreen();
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Friends request responses
  async sendFriendRequest() {
    const input = document.getElementById('friend-search-input');
    const username = input.value.trim();
    if (username.length < 3) {
      app.showToast('error', 'Username is too short.');
      return;
    }

    try {
      const res = await fetch(`/api/social/request?token=${app.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendUsername: username })
      });
      const data = await res.json();
      if (res.ok) {
        app.showToast('success', data.status === 'accepted' ? 'Friend request accepted!' : 'Friend request sent.');
        input.value = '';
        app.renderProfileScreen();
      } else {
        app.showToast('error', data.error);
      }
    } catch (e) {
      app.showToast('error', 'Request failed.');
    }
  }

  async respondFriendRequest(friendId, accept) {
    try {
      const res = await fetch(`/api/social/respond?token=${app.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ friendId, accept })
      });
      if (res.ok) {
        app.showToast('success', accept ? 'Request accepted!' : 'Request declined.');
        app.renderProfileScreen();
      }
    } catch (e) {
      console.error(e);
    }
  }

  inviteFriendToLobby(friendUsername) {
    if (app.activeRoomCode) {
      socket.sendChat(`/invite ${friendUsername}`);
      app.showToast('success', `Sent invite message to ${friendUsername}!`);
    }
  }

  // Shop actions
  switchShopTab(tabType) {
    const tabs = document.querySelectorAll('.shop-tab');
    tabs.forEach(t => t.classList.remove('active'));
    
    // Find target
    const btn = Array.from(tabs).find(t => t.onclick.toString().includes(tabType));
    if (btn) btn.classList.add('active');

    app.renderShopTabItems(tabType);
  }

  async buyShopItem(type, itemKey, price) {
    try {
      const res = await fetch(`/api/shop/buy?token=${app.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, itemKey, price })
      });
      const data = await res.json();
      
      if (res.ok) {
        app.showToast('success', 'Unlocked item successfully!');
        app.user = data.user;
        document.getElementById('shop-coins-val').innerText = app.user.coins;
        app.renderShopTabItems(type);
      } else {
        app.showToast('error', data.error);
      }
    } catch (e) {
      console.error(e);
    }
  }

  async equipShopItem(type, itemKey) {
    try {
      const res = await fetch(`/api/shop/equip?token=${app.token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, itemKey })
      });
      const data = await res.json();

      if (res.ok) {
        app.showToast('success', 'Item equipped!');
        app.user = data.user;
        app.renderShopTabItems(type);
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Leaderboard tabs toggling
  switchLeaderboardTab(tabType) {
    const tabs = document.querySelectorAll('.leaderboard-tab');
    tabs.forEach(t => t.classList.remove('active'));

    const btn = Array.from(tabs).find(t => t.onclick.toString().includes(tabType));
    if (btn) btn.classList.add('active');

    app.renderLeaderboardScreen(tabType);
  }

  // Admin moderation callbacks
  async adminBanUser(userId) {
    const reason = prompt('Enter ban reason:');
    if (!reason) return;
    
    try {
      const res = await fetch('/api/admin/ban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': app.token },
        body: JSON.stringify({ userId, reason })
      });
      if (res.ok) {
        app.showToast('success', 'User banned.');
        app.renderAdminScreen();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async adminUnbanUser(userId) {
    try {
      const res = await fetch('/api/admin/unban', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': app.token },
        body: JSON.stringify({ userId })
      });
      if (res.ok) {
        app.showToast('success', 'User unbanned.');
        app.renderAdminScreen();
      }
    } catch (e) {
      console.error(e);
    }
  }

  async adminResolveReport(reportId) {
    try {
      const res = await fetch('/api/admin/resolve-report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': app.token },
        body: JSON.stringify({ reportId })
      });
      if (res.ok) {
        app.showToast('success', 'Report marked resolved.');
        app.renderAdminScreen();
      }
    } catch (e) {
      console.error(e);
    }
  }
}

const ui = new UIRenderer();
window.ui = ui;
