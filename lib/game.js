const crypto = require('crypto');

// Generate standard deck of 108 cards
function createDeck() {
  const colors = ['red', 'yellow', 'green', 'blue'];
  const deck = [];

  const createCard = (color, type, value = null, display = '') => ({
    id: crypto.randomUUID(),
    color,
    type,
    value,
    display: display || (value !== null ? value.toString() : type.toUpperCase())
  });

  // 4 Colors
  colors.forEach(color => {
    // One '0' card per color
    deck.push(createCard(color, 'number', 0));
    
    // Two of '1' through '9'
    for (let v = 1; v <= 9; v++) {
      deck.push(createCard(color, 'number', v));
      deck.push(createCard(color, 'number', v));
    }

    // Two of Skips, Reverses, Draw Twos
    for (let i = 0; i < 2; i++) {
      deck.push(createCard(color, 'skip'));
      deck.push(createCard(color, 'reverse'));
      deck.push(createCard(color, 'draw2', null, '+2'));
    }
  });

  // 4 Wilds and 4 Wild Draw Fours
  for (let i = 0; i < 4; i++) {
    deck.push(createCard('wild', 'wild', null, 'WILD'));
    deck.push(createCard('wild', 'wild4', null, '+4'));
  }

  return deck;
}

class GameSession {
  constructor(roomId, creatorId, settings = {}) {
    this.roomId = roomId;
    this.creatorId = creatorId;
    
    // Game Rules Settings
    this.settings = {
      maxPlayers: settings.maxPlayers || 4,
      spectators: settings.spectators !== undefined ? settings.spectators : true,
      stackDraws: settings.stackDraws !== undefined ? settings.stackDraws : true,
      jumpIn: settings.jumpIn !== undefined ? settings.jumpIn : false,
      sevenZero: settings.sevenZero !== undefined ? settings.sevenZero : false,
      turnTimerLimit: settings.turnTimerLimit || 30 // default 30 seconds
    };

    this.players = []; // { id, username, hand: [], isReady: false, isSpectator: false, isAI: false, difficulty: 'medium' }
    this.deck = [];
    this.discardPile = [];
    
    this.currentPlayerIdx = 0;
    this.direction = 1; // 1 = Clockwise, -1 = Counter-Clockwise
    
    this.gameStarted = false;
    this.gameEnded = false;
    this.winnerId = null;
    
    this.stackCount = 0; // Accumulated draw penalty
    this.colorChoice = null; // Chosen color for Wild / Wild Draw 4
    
    // UNO Call State
    this.unoState = {}; // userId -> { unoCalled: boolean, timestamp: number }
    this.pendingSevenSwap = null; // userId waiting to choose player to swap with

    this.turnStartTime = 0;
    this.durationSeconds = 0;
    this.gameStartTime = 0;

    this.chatMessages = [];
  }

  addPlayer(id, username, isSpectator = false, isAI = false, difficulty = 'medium') {
    if (this.gameStarted) {
      if (this.settings.spectators && isSpectator) {
        this.players.push({ id, username, hand: [], isReady: false, isSpectator: true, isAI, difficulty });
        return true;
      }
      return false; // Can't join active game as player
    }

    if (this.players.filter(p => !p.isSpectator).length >= this.settings.maxPlayers && !isSpectator) {
      return false; // Room Full
    }

    this.players.push({
      id,
      username,
      hand: [],
      isReady: isAI || id === this.creatorId, // Creator and AI are auto-ready
      isSpectator,
      isAI,
      difficulty
    });
    return true;
  }

  removePlayer(userId) {
    const idx = this.players.findIndex(p => p.id === userId);
    if (idx === -1) return false;

    const player = this.players[idx];
    this.players.splice(idx, 1);

    // If game was active, put their cards back in the deck
    if (this.gameStarted && !player.isSpectator) {
      this.deck.push(...player.hand);
      player.hand = [];

      // Check if we have enough players to continue
      const activePlayers = this.players.filter(p => !p.isSpectator);
      if (activePlayers.length < 2) {
        this.gameEnded = true;
        this.winnerId = activePlayers[0]?.id || null;
      } else {
        // Adjust currentPlayerIdx if needed
        if (this.currentPlayerIdx >= activePlayers.length) {
          this.currentPlayerIdx = 0;
        }
      }
    }

    // Reassign creator if creator left
    if (userId === this.creatorId && this.players.length > 0) {
      // Prioritize human players
      const human = this.players.find(p => !p.isAI);
      this.creatorId = human ? human.id : this.players[0].id;
    }

    return true;
  }

  setPlayerReady(userId, ready) {
    const p = this.players.find(p => p.id === userId);
    if (p) {
      p.isReady = ready;
    }
  }

  startGame() {
    const activePlayers = this.players.filter(p => !p.isSpectator);
    if (activePlayers.length < 2) return false;

    this.deck = createDeck();
    this.shuffleDeck();

    // Deal 7 cards to each active player
    activePlayers.forEach(p => {
      p.hand = [];
      for (let i = 0; i < 7; i++) {
        p.hand.push(this.deck.pop());
      }
      this.unoState[p.id] = { unoCalled: false, timestamp: 0 };
    });

    // Flip starting card
    let startCard = this.deck.pop();
    // Re-shuffle if starting card is Wild Draw Four
    while (startCard.type === 'wild4') {
      this.deck.unshift(startCard);
      this.shuffleDeck();
      startCard = this.deck.pop();
    }

    this.discardPile = [startCard];
    this.gameStarted = true;
    this.gameEnded = false;
    this.currentPlayerIdx = 0;
    this.direction = 1;
    this.stackCount = 0;
    this.colorChoice = null;
    this.pendingSevenSwap = null;
    this.gameStartTime = Date.now();
    this.resetTurnTimer();

    // If start card is an Action/Wild card, apply it
    this.applyStartingCardEffects(startCard);

    return true;
  }

  shuffleDeck() {
    for (let i = this.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.deck[i], this.deck[j]] = [this.deck[j], this.deck[i]];
    }
  }

  applyStartingCardEffects(card) {
    const players = this.players.filter(p => !p.isSpectator);
    if (card.type === 'skip') {
      this.advanceTurn(1);
    } else if (card.type === 'reverse') {
      if (players.length === 2) {
        this.advanceTurn(1); // Acts as a Skip
      } else {
        this.direction *= -1;
      }
    } else if (card.type === 'draw2') {
      if (this.settings.stackDraws) {
        this.stackCount = 2;
      } else {
        // First player draws 2 and skips turn
        const victim = players[this.currentPlayerIdx];
        this.drawCardsForPlayer(victim.id, 2);
        this.advanceTurn(1);
      }
    } else if (card.type === 'wild') {
      // Just wait for player 0 to choose color (defaults to red/blue initially, or set random)
      const colors = ['red', 'yellow', 'green', 'blue'];
      this.colorChoice = colors[Math.floor(Math.random() * colors.length)];
    }
  }

  resetTurnTimer() {
    this.turnStartTime = Date.now();
  }

  getActivePlayers() {
    return this.players.filter(p => !p.isSpectator);
  }

  getCurrentPlayer() {
    const active = this.getActivePlayers();
    return active[this.currentPlayerIdx];
  }

  getNextPlayerIndex(offset = 1) {
    const active = this.getActivePlayers();
    if (active.length === 0) return 0;
    return (this.currentPlayerIdx + offset * this.direction + active.length * 10) % active.length;
  }

  advanceTurn(skips = 1) {
    this.currentPlayerIdx = this.getNextPlayerIndex(skips);
    this.resetTurnTimer();
    this.colorChoice = null; // Clear chosen color for next player's action
  }

  isValidPlay(card, userId, isJumpIn = false) {
    const player = this.players.find(p => p.id === userId);
    if (!player || player.isSpectator || this.gameEnded) return false;
    
    // Jump-in can be played out of turn, normal plays must be on your turn
    const isMyTurn = this.getCurrentPlayer().id === userId;
    if (!isMyTurn && !isJumpIn) return false;

    // Check if player actually holds this card
    const hasCard = player.hand.some(c => c.id === card.id);
    if (!hasCard) return false;

    const topCard = this.discardPile[this.discardPile.length - 1];

    // Jump-in Rules (exact card match color & type/value)
    if (isJumpIn) {
      if (!this.settings.jumpIn) return false;
      // Exact type match, and if numbers, exact number match. Also exact color match.
      const matchColor = card.color === topCard.color || (card.color === 'wild' && topCard.color === 'wild');
      const matchValue = card.type === topCard.type && card.value === topCard.value;
      return matchColor && matchValue;
    }

    // Stacking Rules active?
    if (this.settings.stackDraws && this.stackCount > 0) {
      // Can stack +2 on +2
      if (topCard.type === 'draw2' && card.type === 'draw2') return true;
      // Can stack +4 on +4
      if (topCard.type === 'wild4' && card.type === 'wild4') return true;
      return false; // Any other card is invalid while drawing is stacked
    }

    // Standard Matching Rules
    if (card.color === 'wild' || card.type === 'wild' || card.type === 'wild4') return true;
    
    const targetColor = this.colorChoice || topCard.color;
    if (card.color === targetColor) return true;
    if (card.type === topCard.type && card.type !== 'number') return true;
    if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;

    return false;
  }

  playCard(userId, cardId, chosenColor = null, isJumpIn = false, swapTargetId = null) {
    const player = this.players.find(p => p.id === userId);
    if (!player) return false;

    const cardIdx = player.hand.findIndex(c => c.id === cardId);
    if (cardIdx === -1) return false;

    const card = player.hand[cardIdx];

    if (!this.isValidPlay(card, userId, isJumpIn)) return false;

    // Remove from hand
    player.hand.splice(cardIdx, 1);
    this.discardPile.push(card);

    // If it was a Jump-in, adjust the current turn to the jump-in player
    if (isJumpIn) {
      const active = this.getActivePlayers();
      this.currentPlayerIdx = active.findIndex(p => p.id === userId);
      this.resetTurnTimer();
    }

    // Reset UNO called state if they got cards back or play card
    if (player.hand.length !== 1) {
      this.unoState[userId].unoCalled = false;
    }

    const players = this.getActivePlayers();

    // Check Victory condition
    if (player.hand.length === 0) {
      this.gameEnded = true;
      this.winnerId = userId;
      this.durationSeconds = Math.round((Date.now() - this.gameStartTime) / 1000);
      return true;
    }

    // Apply Card Effects
    let nextSkips = 1;

    if (card.type === 'skip') {
      nextSkips = 2;
    } else if (card.type === 'reverse') {
      if (players.length === 2) {
        nextSkips = 2; // In 2-player game, reverse works as a skip
      } else {
        this.direction *= -1;
      }
    } else if (card.type === 'draw2') {
      if (this.settings.stackDraws) {
        this.stackCount += 2;
      } else {
        const nextVictim = players[this.getNextPlayerIndex(1)];
        this.drawCardsForPlayer(nextVictim.id, 2);
        nextSkips = 2;
      }
    } else if (card.type === 'wild') {
      this.colorChoice = chosenColor || 'red';
    } else if (card.type === 'wild4') {
      this.colorChoice = chosenColor || 'red';
      if (this.settings.stackDraws) {
        this.stackCount += 4;
      } else {
        const nextVictim = players[this.getNextPlayerIndex(1)];
        this.drawCardsForPlayer(nextVictim.id, 4);
        nextSkips = 2;
      }
    }

    // Seven-Zero Rules
    if (this.settings.sevenZero) {
      if (card.type === 'number' && card.value === 0) {
        this.rotateHands();
      } else if (card.type === 'number' && card.value === 7) {
        // Pause turns and record swap state if we don't have a target yet
        if (swapTargetId && players.some(p => p.id === swapTargetId && p.id !== userId && !p.isSpectator)) {
          this.swapHands(userId, swapTargetId);
        } else {
          // If the playing player is an AI, choose swap target immediately
          if (player.isAI) {
            const opponent = players.find(p => p.id !== userId && !p.isSpectator);
            if (opponent) this.swapHands(userId, opponent.id);
          } else {
            this.pendingSevenSwap = userId;
            return true; // Wait for target selection event
          }
        }
      }
    }

    // Advance turn
    this.advanceTurn(nextSkips);
    if (this.colorChoice && card.color === 'wild') {
      // Set active color to wildcard
    } else {
      this.colorChoice = null;
    }

    return true;
  }

  rotateHands() {
    const players = this.getActivePlayers();
    if (players.length < 2) return;

    // Rotate hands in direction of play
    // direction = 1: p0 -> p1, p1 -> p2, p[last] -> p0
    // direction = -1: p0 -> p[last], p1 -> p0, etc.
    const hands = players.map(p => [...p.hand]);
    
    players.forEach((p, idx) => {
      const sourceIdx = (idx - this.direction + players.length) % players.length;
      p.hand = hands[sourceIdx];
      // Reset UNO status for safety
      this.unoState[p.id].unoCalled = false;
    });
  }

  swapHands(userId1, userId2) {
    const p1 = this.players.find(p => p.id === userId1);
    const p2 = this.players.find(p => p.id === userId2);
    if (p1 && p2) {
      const tempHand = p1.hand;
      p1.hand = p2.hand;
      p2.hand = tempHand;
      this.unoState[userId1].unoCalled = false;
      this.unoState[userId2].unoCalled = false;
    }
    this.pendingSevenSwap = null;
  }

  drawCard(userId) {
    const player = this.players.find(p => p.id === userId);
    if (!player || player.isSpectator || this.gameEnded) return null;

    const isMyTurn = this.getCurrentPlayer().id === userId;
    if (!isMyTurn) return null;

    // Reset UNO called state
    this.unoState[userId].unoCalled = false;

    // Check Stacking Penalty
    if (this.settings.stackDraws && this.stackCount > 0) {
      const cardsDrawn = this.drawCardsForPlayer(userId, this.stackCount);
      this.stackCount = 0;
      // Drawing a stack ends turn instantly
      this.advanceTurn(1);
      return { cards: cardsDrawn, stackCleared: true };
    }

    // Single card draw
    const cardsDrawn = this.drawCardsForPlayer(userId, 1);
    const drawnCard = cardsDrawn[0];

    // Standard UNO rule: if drawn card matches discard pile, player can play it immediately
    const canPlayDrawn = this.isValidPlay(drawnCard, userId, false);

    // If drawn card cannot be played or they choose not to (we handle play trigger on client),
    // they can click "Pass" which moves turn. Let's return the drawn card.
    return { cards: cardsDrawn, canPlay: canPlayDrawn };
  }

  passTurn(userId) {
    const isMyTurn = this.getCurrentPlayer().id === userId;
    if (!isMyTurn || this.gameEnded) return false;
    this.advanceTurn(1);
    return true;
  }

  drawCardsForPlayer(userId, count) {
    const player = this.players.find(p => p.id === userId);
    if (!player) return [];

    const cards = [];
    for (let i = 0; i < count; i++) {
      if (this.deck.length === 0) {
        // Recycle discard pile
        const topCard = this.discardPile.pop();
        this.deck = this.discardPile;
        this.discardPile = [topCard];
        this.shuffleDeck();
      }

      if (this.deck.length > 0) {
        const c = this.deck.pop();
        player.hand.push(c);
        cards.push(c);
      }
    }
    
    // Clear UNO call since hand size is updated
    this.unoState[userId].unoCalled = false;

    return cards;
  }

  // UNO Call Routines
  callUno(userId) {
    const player = this.players.find(p => p.id === userId);
    if (!player || player.isSpectator) return false;

    // Can only call UNO if hand size is <= 2
    if (player.hand.length > 2) return false;

    this.unoState[userId] = {
      unoCalled: true,
      timestamp: Date.now()
    };
    return true;
  }

  callOutPlayer(callerId, victimId) {
    const victim = this.players.find(p => p.id === victimId);
    if (!victim || victim.isSpectator || victim.hand.length !== 1) return false;

    const state = this.unoState[victimId];
    if (!state.unoCalled) {
      // Victim failed to call UNO! Force them to draw 2 cards
      this.drawCardsForPlayer(victimId, 2);
      this.unoState[victimId].unoCalled = false; // Reset
      return true;
    }
    return false;
  }

  // AI Logic
  runAiTurn() {
    if (this.gameEnded || !this.gameStarted) return null;

    const currentPlayer = this.getCurrentPlayer();
    if (!currentPlayer || !currentPlayer.isAI) return null;

    // Check if AI is stuck waiting for 7 swap target
    if (this.pendingSevenSwap === currentPlayer.id) {
      const players = this.getActivePlayers();
      const opponent = players.find(p => p.id !== currentPlayer.id && !p.isSpectator);
      if (opponent) {
        this.swapHands(currentPlayer.id, opponent.id);
        this.advanceTurn(1);
        return { type: 'swap', target: opponent.username };
      }
    }

    const hand = currentPlayer.hand;
    const validPlays = hand.filter(c => this.isValidPlay(c, currentPlayer.id, false));
    const difficulty = currentPlayer.difficulty; // 'easy' | 'medium' | 'hard'

    // Determine color choice for Wild cards
    const getAiColorChoice = () => {
      const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 };
      hand.forEach(c => {
        if (colorCounts[c.color] !== undefined) colorCounts[c.color]++;
      });
      let maxColor = 'red';
      let maxCount = -1;
      for (const [col, count] of Object.entries(colorCounts)) {
        if (count > maxCount) {
          maxCount = count;
          maxColor = col;
        }
      }
      return maxColor;
    };

    // Auto-call UNO if AI is down to 1 card
    const shouldCallUno = () => {
      const chance = Math.random();
      if (difficulty === 'hard') return chance < 0.98;
      if (difficulty === 'medium') return chance < 0.75;
      return chance < 0.35; // Easy forgets often
    };

    // Check if someone else can be called out
    if (difficulty === 'hard' || (difficulty === 'medium' && Math.random() < 0.5)) {
      const active = this.getActivePlayers();
      for (const p of active) {
        if (p.id !== currentPlayer.id && p.hand.length === 1 && !this.unoState[p.id].unoCalled) {
          // Call them out!
          this.callOutPlayer(currentPlayer.id, p.id);
          return { type: 'callout', victim: p.username };
        }
      }
    }

    if (validPlays.length > 0) {
      let cardToPlay = null;

      if (difficulty === 'easy') {
        // Choose random
        cardToPlay = validPlays[Math.floor(Math.random() * validPlays.length)];
      } else if (difficulty === 'medium') {
        // Prioritize number cards, then actions, then wilds
        const numbers = validPlays.filter(c => c.type === 'number');
        const actions = validPlays.filter(c => ['skip', 'reverse', 'draw2'].includes(c.type));
        const wilds = validPlays.filter(c => ['wild', 'wild4'].includes(c.type));

        if (numbers.length > 0) {
          cardToPlay = numbers[Math.floor(Math.random() * numbers.length)];
        } else if (actions.length > 0) {
          cardToPlay = actions[Math.floor(Math.random() * actions.length)];
        } else {
          cardToPlay = wilds[0];
        }
      } else {
        // HARD AI
        // 1. If stacked penalty active, stack Draw card if available
        if (this.stackCount > 0) {
          const drawCards = validPlays.filter(c => c.type === 'draw2' || c.type === 'wild4');
          if (drawCards.length > 0) {
            cardToPlay = drawCards[0];
          }
        }
        
        if (!cardToPlay) {
          // 2. See if next opponent is critical (hand size <= 2). If so, prioritize block cards (+2, Skip, Reverse, +4)
          const nextIdx = this.getNextPlayerIndex(1);
          const nextPlayer = this.getActivePlayers()[nextIdx];
          const isNextCritical = nextPlayer && nextPlayer.hand.length <= 2;

          if (isNextCritical) {
            const blocks = validPlays.filter(c => ['skip', 'reverse', 'draw2', 'wild4'].includes(c.type));
            if (blocks.length > 0) {
              cardToPlay = blocks[0];
            }
          }
        }

        if (!cardToPlay) {
          // 3. Normal smart selection: play cards of our dominant color, save Wilds for emergencies
          const normalPlays = validPlays.filter(c => c.color !== 'wild');
          if (normalPlays.length > 0) {
            // Pick card that matches dominant colors in hand
            const colorCounts = { red: 0, yellow: 0, green: 0, blue: 0 };
            hand.forEach(c => { if (colorCounts[c.color] !== undefined) colorCounts[c.color]++; });
            normalPlays.sort((a, b) => colorCounts[b.color] - colorCounts[a.color]);
            cardToPlay = normalPlays[0];
          } else {
            cardToPlay = validPlays[0]; // Wildcard
          }
        }
      }

      if (cardToPlay) {
        // If hand size will drop to 1, trigger AI calling UNO
        if (hand.length === 2 && shouldCallUno()) {
          this.callUno(currentPlayer.id);
        }

        const chosenColor = (cardToPlay.color === 'wild') ? getAiColorChoice() : null;
        
        // Handle 7 Swap for AI if playing a 7
        let swapTarget = null;
        if (this.settings.sevenZero && cardToPlay.type === 'number' && cardToPlay.value === 7) {
          // Hard AI swaps with player who has fewest cards
          const active = this.getActivePlayers().filter(p => p.id !== currentPlayer.id);
          active.sort((a, b) => a.hand.length - b.hand.length);
          if (active.length > 0) swapTarget = active[0].id;
        }

        const success = this.playCard(currentPlayer.id, cardToPlay.id, chosenColor, false, swapTarget);
        if (success) {
          return {
            type: 'play',
            cardName: cardToPlay.display,
            color: cardToPlay.color,
            cardType: cardToPlay.type,
            chosenColor
          };
        }
      }
    }

    // No valid plays, draw card
    const result = this.drawCard(currentPlayer.id);
    if (result && result.cards && result.cards.length > 0) {
      const drawn = result.cards[0];
      
      // If we drew standard card and it's playable, let's play it (if smart)
      if (result.canPlay) {
        const shouldPlayDrawn = (difficulty === 'easy') ? Math.random() < 0.5 : Math.random() < 0.9;
        if (shouldPlayDrawn) {
          if (hand.length === 2 && shouldCallUno()) {
            this.callUno(currentPlayer.id);
          }
          const chosenColor = (drawn.color === 'wild') ? getAiColorChoice() : null;
          this.playCard(currentPlayer.id, drawn.id, chosenColor, false);
          return { type: 'drawPlay', cardName: drawn.display, chosenColor };
        }
      }

      // Pass
      this.passTurn(currentPlayer.id);
      return { type: 'drawPass', cardName: drawn.display };
    }

    // Fallback: Pass turn
    this.passTurn(currentPlayer.id);
    return { type: 'pass' };
  }

  toggleSpectator(userId) {
    const p = this.players.find(p => p.id === userId);
    if (!p || this.gameStarted) return false;

    if (p.isSpectator) {
      // Switch to player: check max players limit
      const activeCount = this.players.filter(pl => !pl.isSpectator).length;
      if (activeCount >= this.settings.maxPlayers) {
        return false;
      }
      p.isSpectator = false;
      p.isReady = false; // Reset ready status to require explicit ready
    } else {
      // Switch to spectator: spectators are always ready
      p.isSpectator = true;
      p.isReady = true;
      p.hand = [];
    }
    return true;
  }

  // Get sanitized state for client view
  getSanitizedState(userId) {
    const active = this.getActivePlayers();
    const isMyTurn = this.gameStarted && active[this.currentPlayerIdx]?.id === userId;
    
    return {
      roomId: this.roomId,
      creatorId: this.creatorId,
      settings: this.settings,
      gameStarted: this.gameStarted,
      gameEnded: this.gameEnded,
      direction: this.direction,
      currentPlayerIdx: this.currentPlayerIdx,
      currentPlayerName: active[this.currentPlayerIdx]?.username || '',
      stackCount: this.stackCount,
      colorChoice: this.colorChoice,
      topCard: this.discardPile[this.discardPile.length - 1] || null,
      winnerId: this.winnerId,
      winnerName: this.winnerId ? this.players.find(p => p.id === this.winnerId)?.username : '',
      pendingSevenSwap: this.pendingSevenSwap,
      deckCount: this.deck.length,
      players: this.players.map(p => ({
        id: p.id,
        username: p.username,
        isReady: p.isReady,
        isSpectator: p.isSpectator,
        isAI: p.isAI,
        difficulty: p.difficulty,
        cardCount: p.hand.length,
        hand: p.id === userId ? p.hand : [], // Only show hand if it's the requesting player
        unoCalled: this.unoState[p.id]?.unoCalled || false
      })),
      isMyTurn,
      timeLeft: Math.max(0, this.settings.turnTimerLimit - Math.round((Date.now() - this.turnStartTime) / 1000))
    };
  }
}

module.exports = { GameSession };
