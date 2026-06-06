require('dotenv').config();
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const crypto = require('crypto');
const db = require('./lib/db');
const { GameSession } = require('./lib/game');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

// Sessions in memory
const activeSessions = new Map(); // token -> user profile
const socketConnections = new Map(); // userId -> WS client
const activeRooms = new Map(); // roomCode -> GameSession

// Helper to authenticate requests via Authorization header or query parameter
async function authenticateUser(req, res, next) {
  const token = req.headers.authorization || req.query.token;
  if (!token) return res.status(401).json({ error: 'Authentication token required.' });
  
  const user = activeSessions.get(token);
  if (!user) return res.status(401).json({ error: 'Invalid or expired session.' });

  const ban = await db.isBanned(user.id);
  if (ban) {
    return res.status(403).json({ error: `You are banned: ${ban.reason}` });
  }

  req.user = user;
  next();
}

// REST Endpoints
app.post('/api/auth/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  if (username.length < 3) return res.status(400).json({ error: 'Username must be at least 3 characters.' });

  try {
    const user = await db.createUser(username, password, false);
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, user);
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });

  const user = await db.authenticate(username, password);
  if (!user) return res.status(400).json({ error: 'Invalid username or password.' });

  const ban = await db.isBanned(user.id);
  if (ban) return res.status(403).json({ error: `Account is banned: ${ban.reason}` });

  const token = crypto.randomBytes(32).toString('hex');
  activeSessions.set(token, user);
  res.json({ token, user });
});

app.post('/api/auth/guest', async (req, res) => {
  const { username } = req.body;
  const guestName = username ? username.trim() : `Guest_${Math.floor(1000 + Math.random() * 9000)}`;
  
  try {
    const user = await db.createUser(guestName, '', true);
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.set(token, user);
    res.json({ token, user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/user/profile', authenticateUser, async (req, res) => {
  // Fresh reload of user from database
  const user = await db.getUserById(req.user.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  
  // Fetch match history for user from Supabase
  const { data: matchesList } = await db.supabase
    .from('history')
    .select('*')
    .order('playedAt', { ascending: false });

  const matches = (matchesList || []).filter(m => 
    m.players.some(p => p.userId === user.id)
  );

  res.json({ user, matches });
});

app.get('/api/user/leaderboard', async (req, res) => {
  const type = req.query.type || 'wins';
  res.json(await db.getLeaderboard(type));
});

// Shop endpoints
app.post('/api/shop/buy', authenticateUser, async (req, res) => {
  const { type, itemKey, price } = req.body;
  try {
    const user = await db.unlockCosmetic(req.user.id, type, itemKey, price);
    activeSessions.set(req.query.token, user); // Update session record
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/shop/equip', authenticateUser, async (req, res) => {
  const { type, itemKey } = req.body;
  try {
    const user = await db.equipCosmetic(req.user.id, type, itemKey);
    activeSessions.set(req.query.token, user); // Update session record
    res.json({ user });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Friends list
app.get('/api/social/friends', authenticateUser, async (req, res) => {
  res.json(await db.getFriends(req.user.id));
});

app.post('/api/social/request', authenticateUser, async (req, res) => {
  const { friendUsername } = req.body;
  try {
    const result = await db.sendFriendRequest(req.user.id, friendUsername);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/social/respond', authenticateUser, async (req, res) => {
  const { friendId, accept } = req.body;
  try {
    await db.handleFriendRequest(req.user.id, friendId, accept);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Admin Moderation endpoints
function requireAdmin(req, res, next) {
  if (!req.user.isAdmin) {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

app.get('/api/admin/stats', authenticateUser, requireAdmin, async (req, res) => {
  const dbStats = await db.getAdminStats();
  const serverStats = {
    activeRooms: activeRooms.size,
    activeConnections: socketConnections.size,
    roomsList: Array.from(activeRooms.values()).map(r => ({
      roomCode: r.roomId,
      playersCount: r.players.length,
      spectatorsCount: r.players.filter(p => p.isSpectator).length,
      gameStarted: r.gameStarted,
      gameEnded: r.gameEnded
    }))
  };
  res.json({ ...dbStats, ...serverStats });
});

app.get('/api/admin/users', authenticateUser, requireAdmin, async (req, res) => {
  res.json(await db.getAllUsersForAdmin());
});

app.post('/api/admin/ban', authenticateUser, requireAdmin, async (req, res) => {
  const { userId, reason, expiresAt } = req.body;
  try {
    await db.banUser(userId, reason, expiresAt);
    // Boot banned user WebSocket if active
    const socket = socketConnections.get(userId);
    if (socket) {
      socket.send(JSON.stringify({ type: 'banned', reason }));
      socket.close();
    }
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/admin/unban', authenticateUser, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  try {
    await db.unbanUser(userId);
    res.json({ success: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.get('/api/admin/reports', authenticateUser, requireAdmin, async (req, res) => {
  res.json(await db.getReports());
});

app.post('/api/admin/resolve-report', authenticateUser, requireAdmin, async (req, res) => {
  const { reportId } = req.body;
  await db.resolveReport(reportId);
  res.json({ success: true });
});

// Clean up disconnected players session helper (room-level)
const disconnectTimeouts = new Map(); // userId -> Timeout

// WebSockets Server Implementation
wss.on('connection', (ws, req) => {
  let user = null;
  let roomCode = null;

  const sendToClient = (type, data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type, data }));
    }
  };

  const broadcastToRoom = (type, data, excludeSelf = false) => {
    if (!roomCode) return;
    const session = activeRooms.get(roomCode);
    if (!session) return;

    session.players.forEach(p => {
      if (p.isAI || p.isSpectator) return;
      const pSocket = socketConnections.get(p.id);
      if (pSocket && pSocket.readyState === WebSocket.OPEN) {
        if (excludeSelf && p.id === user.id) return;
        
        // Custom payload - sanitize player hands unless it's the player themselves
        let payload = data;
        if (type === 'game_state_update') {
          payload = session.getSanitizedState(p.id);
        }

        pSocket.send(JSON.stringify({ type, data: payload }));
      }
    });
  };

  ws.on('message', async (messageString) => {
    try {
      const { type, token, data } = JSON.parse(messageString);

      // Require token for authorization
      user = activeSessions.get(token);
      if (!user) {
        sendToClient('error', { message: 'Invalid authentication session.' });
        ws.close();
        return;
      }

      const ban = await db.isBanned(user.id);
      if (ban) {
        sendToClient('error', { message: `Account is banned: ${ban.reason}` });
        ws.close();
        return;
      }

      // Map socket connection
      socketConnections.set(user.id, ws);

      // Reconnection check: Cancel disconnect timeout if they had one
      if (disconnectTimeouts.has(user.id)) {
        clearTimeout(disconnectTimeouts.get(user.id));
        disconnectTimeouts.delete(user.id);
        // Find existing room player was in
        for (const [code, r] of activeRooms.entries()) {
          const inRoom = r.players.some(p => p.id === user.id);
          if (inRoom) {
            roomCode = code;
            broadcastToRoom('chat_message', {
              sender: 'SYSTEM',
              message: `${user.username} has reconnected.`,
              timestamp: Date.now()
            });
            broadcastToRoom('game_state_update', null);
            break;
          }
        }
      }

      switch (type) {
        case 'join_lobby': {
          const { code, isSpectator, settings } = data;
          roomCode = code.toUpperCase().trim();
          
          let session = activeRooms.get(roomCode);
          if (!session) {
            // Create a new session
            session = new GameSession(roomCode, user.id, settings);
            activeRooms.set(roomCode, session);
          }

          const joined = session.addPlayer(user.id, user.username, isSpectator);
          if (!joined) {
            sendToClient('join_failed', { message: 'Lobby full, or game already started.' });
            roomCode = null;
            return;
          }

          sendToClient('join_success', { roomCode });
          broadcastToRoom('chat_message', {
            sender: 'SYSTEM',
            message: `${user.username} joined the lobby ${isSpectator ? 'as a spectator' : ''}.`,
            timestamp: Date.now()
          });
          broadcastToRoom('game_state_update', null);
          break;
        }

        case 'leave_lobby': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            session.removePlayer(user.id);
            broadcastToRoom('chat_message', {
              sender: 'SYSTEM',
              message: `${user.username} left the lobby.`,
              timestamp: Date.now()
            });
            
            // Clean up empty room
            if (session.players.length === 0) {
              activeRooms.delete(roomCode);
            } else {
              broadcastToRoom('game_state_update', null);
            }
          }
          roomCode = null;
          break;
        }

        case 'player_ready': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            session.setPlayerReady(user.id, data.ready);
            broadcastToRoom('game_state_update', null);
          }
          break;
        }

        case 'toggle_spectator': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && !session.gameStarted) {
            const success = session.toggleSpectator(user.id);
            if (success) {
              const p = session.players.find(pl => pl.id === user.id);
              broadcastToRoom('chat_message', {
                sender: 'SYSTEM',
                message: `${user.username} is now a ${p.isSpectator ? 'spectator' : 'player'}.`,
                timestamp: Date.now()
              });
              broadcastToRoom('game_state_update', null);
            } else {
              sendToClient('toast', { type: 'error', message: 'Lobby is full. Cannot switch to player.' });
            }
          }
          break;
        }

        case 'add_ai_opponent': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && session.creatorId === user.id && !session.gameStarted) {
            const aiId = `ai_${crypto.randomUUID().slice(0, 8)}`;
            const aiName = `AI_${data.difficulty.toUpperCase()}_${Math.floor(10 + Math.random() * 90)}`;
            session.addPlayer(aiId, aiName, false, true, data.difficulty);
            broadcastToRoom('game_state_update', null);
          }
          break;
        }

        case 'remove_ai_opponent': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && session.creatorId === user.id && !session.gameStarted) {
            session.removePlayer(data.aiId);
            broadcastToRoom('game_state_update', null);
          }
          break;
        }

        case 'configure_rules': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && session.creatorId === user.id && !session.gameStarted) {
            session.settings = { ...session.settings, ...data.settings };
            broadcastToRoom('game_state_update', null);
          }
          break;
        }

        case 'start_game': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && session.creatorId === user.id) {
            const success = session.startGame();
            if (success) {
              broadcastToRoom('game_started', null);
              broadcastToRoom('game_state_update', null);
            } else {
              sendToClient('error', { message: 'Must have at least 2 ready players to start.' });
            }
          }
          break;
        }

        case 'play_card': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            const { cardId, chosenColor, isJumpIn, swapTargetId } = data;
            const success = session.playCard(user.id, cardId, chosenColor, isJumpIn, swapTargetId);
            if (success) {
              broadcastToRoom('card_played', { userId: user.id, username: user.username });
              
              if (session.gameEnded) {
                await handleGameOver(session);
              } else {
                broadcastToRoom('game_state_update', null);
                // Trigger AI turns if next player is AI
                triggerAiCycle(session);
              }
            } else {
              sendToClient('error', { message: 'Invalid card play.' });
            }
          }
          break;
        }

        case 'draw_card': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            const result = session.drawCard(user.id);
            if (result) {
              sendToClient('card_drawn', { cards: result.cards });
              broadcastToRoom('player_drew', { userId: user.id, username: user.username, count: result.cards.length }, true);
              
              // If stacking, drawing instantly ends turn, otherwise client has option to play or pass
              if (result.stackCleared || !result.canPlay) {
                // Done on server, update clients
                broadcastToRoom('game_state_update', null);
                triggerAiCycle(session);
              } else {
                // Player can play it
                broadcastToRoom('game_state_update', null);
              }
            }
          }
          break;
        }

        case 'pass_turn': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            const success = session.passTurn(user.id);
            if (success) {
              broadcastToRoom('game_state_update', null);
              triggerAiCycle(session);
            }
          }
          break;
        }

        case 'seven_swap_choose': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session && session.pendingSevenSwap === user.id) {
            session.swapHands(user.id, data.targetUserId);
            session.advanceTurn(1);
            broadcastToRoom('chat_message', {
              sender: 'SYSTEM',
              message: `${user.username} swapped hands with ${session.players.find(p => p.id === data.targetUserId)?.username || 'another player'}.`,
              timestamp: Date.now()
            });
            broadcastToRoom('game_state_update', null);
            triggerAiCycle(session);
          }
          break;
        }

        case 'call_uno': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            const success = session.callUno(user.id);
            if (success) {
              broadcastToRoom('uno_called', { userId: user.id, username: user.username });
              broadcastToRoom('game_state_update', null);
            }
          }
          break;
        }

        case 'callout_player': {
          if (!roomCode) return;
          const session = activeRooms.get(roomCode);
          if (session) {
            const success = session.callOutPlayer(user.id, data.victimId);
            if (success) {
              const victim = session.players.find(p => p.id === data.victimId);
              broadcastToRoom('chat_message', {
                sender: 'SYSTEM',
                message: `${user.username} CALLED OUT ${victim?.username || 'player'} for forgetting to shout UNO! They drew 2 cards.`,
                timestamp: Date.now()
              });
              broadcastToRoom('game_state_update', null);
            }
          }
          break;
        }

        case 'emoji_reaction': {
          if (!roomCode) return;
          broadcastToRoom('emoji_reaction', {
            userId: user.id,
            emoji: data.emoji
          });
          break;
        }

        case 'chat_message': {
          if (!roomCode) return;
          const sanitizedMsg = data.message.trim().slice(0, 150);
          if (sanitizedMsg.length > 0) {
            broadcastToRoom('chat_message', {
              sender: user.username,
              message: sanitizedMsg,
              timestamp: Date.now()
            });
          }
          break;
        }

        case 'report_user': {
          const { reportedUserId, reason } = data;
          try {
            await db.createReport(user.id, reportedUserId, reason, roomCode || '');
            sendToClient('toast', { type: 'success', message: 'Report submitted. Moderators will review.' });
          } catch (e) {
            sendToClient('toast', { type: 'error', message: 'Failed to report.' });
          }
          break;
        }
      }
    } catch (err) {
      console.error('WebSocket message parsing error:', err);
    }
  });

  ws.on('close', () => {
    if (user) {
      socketConnections.delete(user.id);

      // Handle disconnection delay (60s) before deleting player
      if (roomCode) {
        const session = activeRooms.get(roomCode);
        if (session) {
          broadcastToRoom('chat_message', {
            sender: 'SYSTEM',
            message: `${user.username} has disconnected. Reconnection window: 60s.`,
            timestamp: Date.now()
          });

          const timeout = setTimeout(() => {
            session.removePlayer(user.id);
            if (session.players.length === 0) {
              activeRooms.delete(session.roomId);
            } else {
              broadcastToRoom('chat_message', {
                sender: 'SYSTEM',
                message: `${user.username} failed to reconnect in time and was removed.`,
                timestamp: Date.now()
              });
              if (session.gameStarted && !session.gameEnded) {
                const active = session.getActivePlayers();
                if (active.length < 2) {
                  session.gameEnded = true;
                  session.winnerId = active[0]?.id || null;
                  handleGameOver(session);
                } else {
                  broadcastToRoom('game_state_update', null);
                  triggerAiCycle(session);
                }
              } else {
                broadcastToRoom('game_state_update', null);
              }
            }
            disconnectTimeouts.delete(user.id);
          }, 60000);

          disconnectTimeouts.set(user.id, timeout);
        }
      }
    }
  });
});

// Helper: cycle AI players turns
function triggerAiCycle(session) {
  setTimeout(async () => {
    let nextPlayer = session.getCurrentPlayer();
    if (nextPlayer && nextPlayer.isAI && session.gameStarted && !session.gameEnded) {
      const aiAction = session.runAiTurn();
      if (aiAction) {
        // Broadcast corresponding announcements
        if (aiAction.type === 'play') {
          session.players.forEach(p => {
            const pSocket = socketConnections.get(p.id);
            if (pSocket && pSocket.readyState === WebSocket.OPEN) {
              pSocket.send(JSON.stringify({
                type: 'chat_message',
                data: {
                  sender: 'SYSTEM',
                  message: `${nextPlayer.username} played ${aiAction.cardName}${aiAction.chosenColor ? ` (Colors set to ${aiAction.chosenColor.toUpperCase()})` : ''}`,
                  timestamp: Date.now()
                }
              }));
            }
          });
        } else if (aiAction.type === 'drawPlay') {
          session.players.forEach(p => {
            const pSocket = socketConnections.get(p.id);
            if (pSocket && pSocket.readyState === WebSocket.OPEN) {
              pSocket.send(JSON.stringify({
                type: 'chat_message',
                data: {
                  sender: 'SYSTEM',
                  message: `${nextPlayer.username} drew and immediately played ${aiAction.cardName}`,
                  timestamp: Date.now()
                }
              }));
            }
          });
        } else if (aiAction.type === 'drawPass') {
          session.players.forEach(p => {
            const pSocket = socketConnections.get(p.id);
            if (pSocket && pSocket.readyState === WebSocket.OPEN) {
              pSocket.send(JSON.stringify({
                type: 'chat_message',
                data: {
                  sender: 'SYSTEM',
                  message: `${nextPlayer.username} drew a card and passed.`,
                  timestamp: Date.now()
                }
              }));
            }
          });
        }
      }

      if (session.gameEnded) {
        await handleGameOver(session);
      } else {
        // Send state updates
        session.players.forEach(p => {
          if (p.isAI) return;
          const pSocket = socketConnections.get(p.id);
          if (pSocket && pSocket.readyState === WebSocket.OPEN) {
            pSocket.send(JSON.stringify({ type: 'game_state_update', data: session.getSanitizedState(p.id) }));
          }
        });
        
        // Loop again if the next player is ALSO an AI
        triggerAiCycle(session);
      }
    }
  }, 1200); // 1.2s delay for realism
}

// Helper: Handle End of Game Rewards and Record saving
async function handleGameOver(session) {
  const winner = session.players.find(p => p.id === session.winnerId);
  const activePlayers = session.players.filter(p => !p.isSpectator);
  
  // Calculate scoring (sum of values left in opponent hands)
  // Number cards = face value, action cards (Skip, Reverse, Draw2) = 20 pts, Wild/Wild4 = 50 pts
  let scoreTotal = 0;
  activePlayers.forEach(p => {
    if (p.id !== session.winnerId) {
      p.hand.forEach(c => {
        if (c.type === 'number') scoreTotal += c.value;
        else if (['skip', 'reverse', 'draw2'].includes(c.type)) scoreTotal += 20;
        else scoreTotal += 50;
      });
    }
  });

  // Calculate rewards
  const results = activePlayers.map(p => {
    let coinsEarned = 10; // Participation reward
    let xpEarned = 25;

    if (p.id === session.winnerId) {
      coinsEarned = 100;
      xpEarned = 100 + scoreTotal;
    } else {
      // 2nd place gets 50 coins (closest to 0 cards)
      const handSizes = activePlayers
        .filter(x => x.id !== session.winnerId)
        .map(x => ({ id: x.id, len: x.hand.length }))
        .sort((a, b) => a.len - b.len);
      
      if (handSizes[0] && handSizes[0].id === p.id) {
        coinsEarned = 50;
        xpEarned = 50;
      }
    }

    return {
      id: p.id,
      username: p.username,
      score: p.hand.length,
      placement: p.id === session.winnerId ? 1 : (coinsEarned === 50 ? 2 : 3),
      coinsEarned,
      xpEarned
    };
  });

  // Persist game rewards to database (excluding AI)
  const humanPlayers = results.filter(r => !r.id.startsWith('ai_'));
  const winnerIsHuman = winner && !winner.isAI;

  await db.saveMatchHistory(
    winnerIsHuman ? winner.id : 'ai_winner',
    'online',
    humanPlayers,
    session.durationSeconds
  );

  // Broadcast game results
  session.players.forEach(p => {
    if (p.isAI) return;
    const pSocket = socketConnections.get(p.id);
    if (pSocket && pSocket.readyState === WebSocket.OPEN) {
      pSocket.send(JSON.stringify({
        type: 'game_over',
        data: {
          winnerName: winner?.username || 'AI opponent',
          score: scoreTotal,
          duration: session.durationSeconds,
          rewards: results.find(r => r.id === p.id) || { coinsEarned: 0, xpEarned: 0 }
        }
      }));
    }
  });
}

// Global active match heartbeat loop (30s Turn limit execution)
setInterval(() => {
  activeRooms.forEach(async (session) => {
    if (session.gameStarted && !session.gameEnded) {
      const active = session.getActivePlayers();
      const current = active[session.currentPlayerIdx];

      if (current) {
        const elapsed = Math.round((Date.now() - session.turnStartTime) / 1000);
        
        // Broadcast time updates to human players
        session.players.forEach(p => {
          if (p.isAI || p.isSpectator) return;
          const pSocket = socketConnections.get(p.id);
          if (pSocket && pSocket.readyState === WebSocket.OPEN) {
            pSocket.send(JSON.stringify({
              type: 'timer_tick',
              data: {
                currentPlayerId: current.id,
                timeLeft: Math.max(0, session.settings.turnTimerLimit - elapsed)
              }
            }));
          }
        });

        // Auto force turn draw/pass if limit exceeded
        if (elapsed >= session.settings.turnTimerLimit) {
          if (current.isAI) return; // handled separately

          const result = session.drawCard(current.id);
          if (result) {
            const socket = socketConnections.get(current.id);
            if (socket && socket.readyState === WebSocket.OPEN) {
              socket.send(JSON.stringify({ type: 'card_drawn', data: { cards: result.cards } }));
            }

            session.players.forEach(p => {
              if (p.isAI || p.isSpectator) return;
              const pSocket = socketConnections.get(p.id);
              if (pSocket && pSocket.readyState === WebSocket.OPEN) {
                pSocket.send(JSON.stringify({
                  type: 'chat_message',
                  data: {
                    sender: 'SYSTEM',
                    message: `${current.username} ran out of time! Automatically drew a card.`,
                    timestamp: Date.now()
                  }
                }));
              }
            });

            // End turn
            session.passTurn(current.id);

            // Update clients
            session.players.forEach(p => {
              if (p.isAI) return;
              const pSocket = socketConnections.get(p.id);
              if (pSocket && pSocket.readyState === WebSocket.OPEN) {
                pSocket.send(JSON.stringify({ type: 'game_state_update', data: session.getSanitizedState(p.id) }));
              }
            });

            triggerAiCycle(session);
          }
        }
      }
    }
  });
}, 1000);

server.listen(PORT, () => {
  console.log(`UNO Multiplayer Server running on port ${PORT}`);
});
