const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

class Database {
  constructor() {
    this.useFallback = false;
    this._initialized = false;
    this.localDbPath = path.join(__dirname, '../db.json');
    
    if (process.env.SUPABASE_URL && process.env.SUPABASE_KEY) {
      this.supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
    } else {
      console.warn('⚠️ SUPABASE_URL or SUPABASE_KEY missing in .env. Falling back to local JSON database.');
      this.useFallback = true;
    }
  }

  async init() {
    if (this._initialized) return;
    this._initialized = true;

    if (!this.useFallback && this.supabase) {
      try {
        // Run a quick check to see if the public.users table exists
        const { error } = await this.supabase
          .from('users')
          .select('id')
          .limit(1);

        if (error) {
          if (error.code === 'PGRST205' || error.message.includes('relation "public.users" does not exist')) {
            console.warn('⚠️ Supabase database tables not found. Falling back to local JSON database.');
            this.useFallback = true;
          } else {
            console.error('Supabase connection error:', error.message);
            console.warn('Falling back to local JSON database.');
            this.useFallback = true;
          }
        } else {
          console.log('✅ Connected to Supabase cloud database successfully.');
        }
      } catch (e) {
        console.error('Unexpected Supabase connection error. Falling back to local JSON database.', e);
        this.useFallback = true;
      }
    }
  }

  // Local File Database Helper Methods
  readLocalDb() {
    try {
      if (!fs.existsSync(this.localDbPath)) {
        const initial = { users: {}, friendships: [], history: [], reports: [], bans: {} };
        fs.writeFileSync(this.localDbPath, JSON.stringify(initial, null, 2));
        return initial;
      }
      const raw = fs.readFileSync(this.localDbPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.error('Error reading local JSON database:', e);
      return { users: {}, friendships: [], history: [], reports: [], bans: {} };
    }
  }

  writeLocalDb(data) {
    try {
      fs.writeFileSync(this.localDbPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error writing to local JSON database:', e);
    }
  }

  // Cryptography Helpers (remain local for performance and security)
  hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
  }

  verifyPassword(password, storedPassword) {
    try {
      const [salt, hash] = storedPassword.split(':');
      const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
      return hash === verifyHash;
    } catch (e) {
      return false;
    }
  }

  // Map database flat columns to match the app user schema
  mapUserFields(dbUser) {
    if (!dbUser) return null;
    return {
      id: dbUser.id,
      username: dbUser.username,
      normalizedUsername: dbUser.normalizedUsername,
      passwordHash: dbUser.passwordHash,
      isGuest: dbUser.isGuest,
      coins: dbUser.coins,
      xp: dbUser.xp,
      level: dbUser.level,
      isAdmin: dbUser.isAdmin,
      avatar: dbUser.avatar,
      cardBack: dbUser.cardBack,
      theme: dbUser.theme,
      unlockedAvatars: dbUser.unlockedAvatars,
      unlockedCardBacks: dbUser.unlockedCardBacks,
      unlockedThemes: dbUser.unlockedThemes,
      stats: {
        wins: dbUser.stats_wins !== undefined ? dbUser.stats_wins : (dbUser.stats?.wins || 0),
        losses: dbUser.stats_losses !== undefined ? dbUser.stats_losses : (dbUser.stats?.losses || 0),
        gamesPlayed: dbUser.stats_gamesPlayed !== undefined ? dbUser.stats_gamesPlayed : (dbUser.stats?.gamesPlayed || 0)
      },
      createdAt: dbUser.createdAt
    };
  }

  // User Methods
  async createUser(username, password = '', isGuest = false) {
    await this.init();
    if (this.useFallback) {
      return this.createUserLocal(username, password, isGuest);
    }

    const normalizedUsername = username.trim().toLowerCase();
    
    // Check if user already exists
    if (!isGuest) {
      const existing = await this.getUserByUsername(normalizedUsername);
      if (existing) {
        throw new Error('Username already taken.');
      }
    }

    const userId = crypto.randomUUID();
    
    // Check if it's the first registered user to make them admin
    let isAdmin = false;
    if (!isGuest) {
      const { count } = await this.supabase
        .from('users')
        .select('*', { count: 'exact', head: true })
        .eq('isGuest', false);
      
      if (count === 0) {
        isAdmin = true;
      }
    }

    const newUser = {
      id: userId,
      username: username.trim(),
      normalizedUsername,
      passwordHash: isGuest ? '' : this.hashPassword(password),
      isGuest,
      coins: 100,
      xp: 0,
      level: 1,
      isAdmin,
      avatar: 'default_avatar_1',
      cardBack: 'default_classic',
      theme: 'default_table',
      unlockedAvatars: ['default_avatar_1'],
      unlockedCardBacks: ['default_classic'],
      unlockedThemes: ['default_table'],
      stats_wins: 0,
      stats_losses: 0,
      stats_gamesPlayed: 0,
      createdAt: new Date().toISOString()
    };

    const { data, error } = await this.supabase
      .from('users')
      .insert([newUser])
      .select()
      .single();

    if (error) {
      console.error('Supabase createUser error:', error);
      throw new Error('Failed to create user record.');
    }

    return this.mapUserFields(data);
  }

  async createUserLocal(username, password = '', isGuest = false) {
    const data = this.readLocalDb();
    const normalizedUsername = username.trim().toLowerCase();

    if (!isGuest) {
      const existing = Object.values(data.users).find(u => u.normalizedUsername === normalizedUsername);
      if (existing) {
        throw new Error('Username already taken.');
      }
    }

    const userId = crypto.randomUUID();
    let isAdmin = false;
    if (!isGuest) {
      const registeredCount = Object.values(data.users).filter(u => !u.isGuest).length;
      if (registeredCount === 0) isAdmin = true;
    }

    const newUser = {
      id: userId,
      username: username.trim(),
      normalizedUsername,
      passwordHash: isGuest ? '' : this.hashPassword(password),
      isGuest,
      coins: 100,
      xp: 0,
      level: 1,
      isAdmin,
      avatar: 'default_avatar_1',
      cardBack: 'default_classic',
      theme: 'default_table',
      unlockedAvatars: ['default_avatar_1'],
      unlockedCardBacks: ['default_classic'],
      unlockedThemes: ['default_table'],
      stats_wins: 0,
      stats_losses: 0,
      stats_gamesPlayed: 0,
      createdAt: new Date().toISOString()
    };

    data.users[userId] = newUser;
    this.writeLocalDb(data);

    return this.mapUserFields(newUser);
  }

  async getUserById(id) {
    await this.init();
    if (this.useFallback) {
      return this.getUserByIdLocal(id);
    }

    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('id', id)
      .maybeSingle();

    if (error) console.error('GetUserById error:', error);
    return this.mapUserFields(data);
  }

  async getUserByIdLocal(id) {
    const data = this.readLocalDb();
    return this.mapUserFields(data.users[id]);
  }

  async getUserByUsername(username) {
    await this.init();
    if (this.useFallback) {
      return this.getUserByUsernameLocal(username);
    }

    const normalized = username.trim().toLowerCase();
    const { data, error } = await this.supabase
      .from('users')
      .select('*')
      .eq('normalizedUsername', normalized)
      .maybeSingle();

    if (error) console.error('GetUserByUsername error:', error);
    return this.mapUserFields(data);
  }

  async getUserByUsernameLocal(username) {
    const data = this.readLocalDb();
    const normalized = username.trim().toLowerCase();
    const user = Object.values(data.users).find(u => u.normalizedUsername === normalized);
    return this.mapUserFields(user);
  }

  async authenticate(username, password) {
    const user = await this.getUserByUsername(username);
    if (!user) return null;
    if (user.isGuest) return null;
    if (this.verifyPassword(password, user.passwordHash)) {
      return user;
    }
    return null;
  }

  async addXpAndCoins(userId, xpGained, coinsGained) {
    await this.init();
    if (this.useFallback) {
      return this.addXpAndCoinsLocal(userId, xpGained, coinsGained);
    }

    const user = await this.getUserById(userId);
    if (!user) return null;

    let newXp = user.xp + xpGained;
    let newCoins = user.coins + coinsGained;
    let newLevel = user.level;

    let nextLevelXp = newLevel * 100;
    while (newXp >= nextLevelXp) {
      newXp -= nextLevelXp;
      newLevel += 1;
      nextLevelXp = newLevel * 100;
    }

    const { data, error } = await this.supabase
      .from('users')
      .update({
        xp: newXp,
        coins: newCoins,
        level: newLevel
      })
      .eq('id', userId)
      .select()
      .single();

    if (error) {
      console.error('AddXpAndCoins error:', error);
      return null;
    }

    return this.mapUserFields(data);
  }

  async addXpAndCoinsLocal(userId, xpGained, coinsGained) {
    const data = this.readLocalDb();
    const user = data.users[userId];
    if (!user) return null;

    user.xp += xpGained;
    user.coins += coinsGained;

    let nextLevelXp = user.level * 100;
    while (user.xp >= nextLevelXp) {
      user.xp -= nextLevelXp;
      user.level += 1;
      nextLevelXp = user.level * 100;
    }

    this.writeLocalDb(data);
    return this.mapUserFields(user);
  }

  async updateStats(userId, isWin) {
    await this.init();
    if (this.useFallback) {
      return this.updateStatsLocal(userId, isWin);
    }

    const user = await this.getUserById(userId);
    if (!user) return;

    const newGamesPlayed = user.stats.gamesPlayed + 1;
    const newWins = isWin ? user.stats.wins + 1 : user.stats.wins;
    const newLosses = isWin ? user.stats.losses : user.stats.losses + 1;

    await this.supabase
      .from('users')
      .update({
        stats_gamesPlayed: newGamesPlayed,
        stats_wins: newWins,
        stats_losses: newLosses
      })
      .eq('id', userId);
  }

  async updateStatsLocal(userId, isWin) {
    const data = this.readLocalDb();
    const user = data.users[userId];
    if (!user) return;

    user.stats_gamesPlayed += 1;
    if (isWin) {
      user.stats_wins += 1;
    } else {
      user.stats_losses += 1;
    }

    this.writeLocalDb(data);
  }

  // Cosmetics Unlock / Shop
  async unlockCosmetic(userId, type, itemKey, price) {
    await this.init();
    if (this.useFallback) {
      return this.unlockCosmeticLocal(userId, type, itemKey, price);
    }

    const user = await this.getUserById(userId);
    if (!user) throw new Error('User not found');
    if (user.coins < price) throw new Error('Insufficient coins');

    const updatedCoins = user.coins - price;
    const updatePayload = { coins: updatedCoins };

    if (type === 'avatar') {
      const list = [...user.unlockedAvatars];
      if (!list.includes(itemKey)) list.push(itemKey);
      updatePayload.unlockedAvatars = list;
    } else if (type === 'cardBack') {
      const list = [...user.unlockedCardBacks];
      if (!list.includes(itemKey)) list.push(itemKey);
      updatePayload.unlockedCardBacks = list;
    } else if (type === 'theme') {
      const list = [...user.unlockedThemes];
      if (!list.includes(itemKey)) list.push(itemKey);
      updatePayload.unlockedThemes = list;
    }

    const { data, error } = await this.supabase
      .from('users')
      .update(updatePayload)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error('Failed to unlock item.');
    return this.mapUserFields(data);
  }

  async unlockCosmeticLocal(userId, type, itemKey, price) {
    const data = this.readLocalDb();
    const user = data.users[userId];
    if (!user) throw new Error('User not found');
    if (user.coins < price) throw new Error('Insufficient coins');

    user.coins -= price;

    if (type === 'avatar') {
      if (!user.unlockedAvatars.includes(itemKey)) user.unlockedAvatars.push(itemKey);
    } else if (type === 'cardBack') {
      if (!user.unlockedCardBacks.includes(itemKey)) user.unlockedCardBacks.push(itemKey);
    } else if (type === 'theme') {
      if (!user.unlockedThemes.includes(itemKey)) user.unlockedThemes.push(itemKey);
    }

    this.writeLocalDb(data);
    return this.mapUserFields(user);
  }

  async equipCosmetic(userId, type, itemKey) {
    await this.init();
    if (this.useFallback) {
      return this.equipCosmeticLocal(userId, type, itemKey);
    }

    const user = await this.getUserById(userId);
    if (!user) throw new Error('User not found');

    const updatePayload = {};

    if (type === 'avatar') {
      if (!user.unlockedAvatars.includes(itemKey)) throw new Error('Avatar not unlocked');
      updatePayload.avatar = itemKey;
    } else if (type === 'cardBack') {
      if (!user.unlockedCardBacks.includes(itemKey)) throw new Error('Card back not unlocked');
      updatePayload.cardBack = itemKey;
    } else if (type === 'theme') {
      if (!user.unlockedThemes.includes(itemKey)) throw new Error('Table theme not unlocked');
      updatePayload.theme = itemKey;
    }

    const { data, error } = await this.supabase
      .from('users')
      .update(updatePayload)
      .eq('id', userId)
      .select()
      .single();

    if (error) throw new Error('Failed to equip item.');
    return this.mapUserFields(data);
  }

  async equipCosmeticLocal(userId, type, itemKey) {
    const data = this.readLocalDb();
    const user = data.users[userId];
    if (!user) throw new Error('User not found');

    if (type === 'avatar') {
      if (!user.unlockedAvatars.includes(itemKey)) throw new Error('Avatar not unlocked');
      user.avatar = itemKey;
    } else if (type === 'cardBack') {
      if (!user.unlockedCardBacks.includes(itemKey)) throw new Error('Card back not unlocked');
      user.cardBack = itemKey;
    } else if (type === 'theme') {
      if (!user.unlockedThemes.includes(itemKey)) throw new Error('Table theme not unlocked');
      user.theme = itemKey;
    }

    this.writeLocalDb(data);
    return this.mapUserFields(user);
  }

  // Match History
  async saveMatchHistory(winnerId, mode, players, durationSeconds) {
    await this.init();
    if (this.useFallback) {
      return this.saveMatchHistoryLocal(winnerId, mode, players, durationSeconds);
    }

    const matchId = crypto.randomUUID();
    const matchRecord = {
      id: matchId,
      winnerId,
      mode,
      players: players.map(p => ({
        userId: p.id,
        username: p.username,
        score: p.score,
        placement: p.placement,
        coinsEarned: p.coinsEarned || 0,
        xpEarned: p.xpEarned || 0
      })),
      durationSeconds,
      playedAt: new Date().toISOString()
    };

    // Insert history
    await this.supabase.from('history').insert([matchRecord]);

    // Update individual user stats
    for (const p of players) {
      await this.updateStats(p.id, p.id === winnerId);
      await this.addXpAndCoins(p.id, p.xpEarned || 0, p.coinsEarned || 0);
    }

    return matchRecord;
  }

  async saveMatchHistoryLocal(winnerId, mode, players, durationSeconds) {
    const data = this.readLocalDb();
    const matchId = crypto.randomUUID();
    const matchRecord = {
      id: matchId,
      winnerId,
      mode,
      players: players.map(p => ({
        userId: p.id,
        username: p.username,
        score: p.score,
        placement: p.placement,
        coinsEarned: p.coinsEarned || 0,
        xpEarned: p.xpEarned || 0
      })),
      durationSeconds,
      playedAt: new Date().toISOString()
    };

    data.history.push(matchRecord);
    this.writeLocalDb(data);

    for (const p of players) {
      await this.updateStatsLocal(p.id, p.id === winnerId);
      await this.addXpAndCoinsLocal(p.id, p.xpEarned || 0, p.coinsEarned || 0);
    }

    return matchRecord;
  }

  // Leaderboards
  async getLeaderboard(type = 'wins') {
    await this.init();
    if (this.useFallback) {
      return this.getLeaderboardLocal(type);
    }

    const { data, error } = await this.supabase
      .from('users')
      .select('id, username, level, stats_wins, stats_losses, stats_gamesPlayed, coins, xp');

    if (error || !data) return [];

    const mappedUsers = data.map(u => this.mapUserFields(u));

    if (type === 'wins') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.stats.wins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'coins') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.coins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'xp') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.level * 1000 + u.xp, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'winrate') {
      return mappedUsers
        .map(u => {
          const played = u.stats.gamesPlayed;
          const rate = played > 0 ? Math.round((u.stats.wins / played) * 100) : 0;
          return { id: u.id, username: u.username, score: rate, level: u.level, gamesPlayed: played };
        })
        .filter(u => u.gamesPlayed >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    }
    return [];
  }

  async getLeaderboardLocal(type = 'wins') {
    const data = this.readLocalDb();
    const mappedUsers = Object.values(data.users).map(u => this.mapUserFields(u));

    if (type === 'wins') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.stats.wins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'coins') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.coins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'xp') {
      return mappedUsers
        .map(u => ({ id: u.id, username: u.username, score: u.level * 1000 + u.xp, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'winrate') {
      return mappedUsers
        .map(u => {
          const played = u.stats.gamesPlayed;
          const rate = played > 0 ? Math.round((u.stats.wins / played) * 100) : 0;
          return { id: u.id, username: u.username, score: rate, level: u.level, gamesPlayed: played };
        })
        .filter(u => u.gamesPlayed >= 3)
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    }
    return [];
  }

  // Social Methods (Friends)
  async sendFriendRequest(userId, friendUsername) {
    await this.init();
    if (this.useFallback) {
      return this.sendFriendRequestLocal(userId, friendUsername);
    }

    const friend = await this.getUserByUsername(friendUsername);
    if (!friend) throw new Error('User not found.');
    if (friend.id === userId) throw new Error('Cannot add yourself.');

    // Query both friendships in a simple way
    const { data: friendships } = await this.supabase
      .from('friendships')
      .select('*')
      .or(`userId.eq.${userId},friendId.eq.${userId}`);

    const exists = (friendships || []).find(
      f => (f.userId === userId && f.friendId === friend.id) || 
           (f.userId === friend.id && f.friendId === userId)
    );

    if (exists) {
      if (exists.status === 'pending') {
        if (exists.userId === friend.id) {
          // Auto-accept if they had sent request to us
          await this.supabase
            .from('friendships')
            .update({ status: 'accepted' })
            .eq('id', exists.id);
          
          return { status: 'accepted', friend };
        }
        throw new Error('Friend request already pending.');
      }
      throw new Error('Already friends.');
    }

    await this.supabase.from('friendships').insert([
      { userId, friendId: friend.id, status: 'pending' }
    ]);

    return { status: 'pending', friend };
  }

  async sendFriendRequestLocal(userId, friendUsername) {
    const data = this.readLocalDb();
    const friend = Object.values(data.users).find(u => u.normalizedUsername === friendUsername.trim().toLowerCase());
    if (!friend) throw new Error('User not found.');
    if (friend.id === userId) throw new Error('Cannot add yourself.');

    const exists = data.friendships.find(
      f => (f.userId === userId && f.friendId === friend.id) || 
           (f.userId === friend.id && f.friendId === userId)
    );

    if (exists) {
      if (exists.status === 'pending') {
        if (exists.userId === friend.id) {
          exists.status = 'accepted';
          this.writeLocalDb(data);
          return { status: 'accepted', friend: this.mapUserFields(friend) };
        }
        throw new Error('Friend request already pending.');
      }
      throw new Error('Already friends.');
    }

    data.friendships.push({ userId, friendId: friend.id, status: 'pending' });
    this.writeLocalDb(data);

    return { status: 'pending', friend: this.mapUserFields(friend) };
  }

  async getFriends(userId) {
    await this.init();
    if (this.useFallback) {
      return this.getFriendsLocal(userId);
    }

    const { data: friendships } = await this.supabase
      .from('friendships')
      .select('*')
      .or(`userId.eq.${userId},friendId.eq.${userId}`);

    if (!friendships) return [];

    const friendsList = [];
    for (const f of friendships) {
      const isSender = f.userId === userId;
      const targetId = isSender ? f.friendId : f.userId;
      const friendUser = await this.getUserById(targetId);
      
      if (friendUser) {
        friendsList.push({
          id: friendUser.id,
          username: friendUser.username,
          avatar: friendUser.avatar,
          level: friendUser.level,
          status: f.status,
          isInitiator: isSender
        });
      }
    }
    return friendsList;
  }

  async getFriendsLocal(userId) {
    const data = this.readLocalDb();
    const friendships = data.friendships.filter(f => f.userId === userId || f.friendId === userId);
    
    const friendsList = [];
    for (const f of friendships) {
      const isSender = f.userId === userId;
      const targetId = isSender ? f.friendId : f.userId;
      const friendUser = data.users[targetId];
      
      if (friendUser) {
        friendsList.push({
          id: friendUser.id,
          username: friendUser.username,
          avatar: friendUser.avatar,
          level: friendUser.level,
          status: f.status,
          isInitiator: isSender
        });
      }
    }
    return friendsList;
  }

  async handleFriendRequest(userId, friendId, accept) {
    await this.init();
    if (this.useFallback) {
      return this.handleFriendRequestLocal(userId, friendId, accept);
    }

    const { data: friendships } = await this.supabase
      .from('friendships')
      .select('*')
      .eq('status', 'pending')
      .or(`userId.eq.${userId},friendId.eq.${userId}`);

    const request = (friendships || []).find(
      f => (f.userId === friendId && f.friendId === userId) ||
           (f.userId === userId && f.friendId === friendId)
    );

    if (!request) throw new Error('No pending request found.');

    if (accept) {
      await this.supabase
        .from('friendships')
        .update({ status: 'accepted' })
        .eq('id', request.id);
    } else {
      await this.supabase
        .from('friendships')
        .delete()
        .eq('id', request.id);
    }
  }

  async handleFriendRequestLocal(userId, friendId, accept) {
    const data = this.readLocalDb();
    const idx = data.friendships.findIndex(
      f => f.status === 'pending' && 
           ((f.userId === friendId && f.friendId === userId) ||
            (f.userId === userId && f.friendId === friendId))
    );

    if (idx === -1) throw new Error('No pending request found.');

    if (accept) {
      data.friendships[idx].status = 'accepted';
    } else {
      data.friendships.splice(idx, 1);
    }
    this.writeLocalDb(data);
  }

  // Admin and Moderation Methods
  async createReport(reporterId, reportedUserId, reason, roomCode = '') {
    await this.init();
    if (this.useFallback) {
      return this.createReportLocal(reporterId, reportedUserId, reason, roomCode);
    }

    const reporter = await this.getUserById(reporterId);
    const reported = await this.getUserById(reportedUserId);
    
    const report = {
      id: crypto.randomUUID(),
      reporterId,
      reporterName: reporter?.username || 'Unknown',
      reportedUserId,
      reportedUserName: reported?.username || 'Unknown',
      reason,
      roomCode,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    await this.supabase.from('reports').insert([report]);
    return report;
  }

  async createReportLocal(reporterId, reportedUserId, reason, roomCode = '') {
    const data = this.readLocalDb();
    const reporter = data.users[reporterId];
    const reported = data.users[reportedUserId];

    const report = {
      id: crypto.randomUUID(),
      reporterId,
      reporterName: reporter?.username || 'Unknown',
      reportedUserId,
      reportedUserName: reported?.username || 'Unknown',
      reason,
      roomCode,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    data.reports.push(report);
    this.writeLocalDb(data);
    return report;
  }

  async getReports() {
    await this.init();
    if (this.useFallback) {
      return this.getReportsLocal();
    }

    const { data } = await this.supabase
      .from('reports')
      .select('*')
      .order('createdAt', { ascending: false });
    
    return data || [];
  }

  async getReportsLocal() {
    const data = this.readLocalDb();
    return [...data.reports].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async resolveReport(reportId) {
    await this.init();
    if (this.useFallback) {
      return this.resolveReportLocal(reportId);
    }

    await this.supabase
      .from('reports')
      .update({ status: 'resolved' })
      .eq('id', reportId);
  }

  async resolveReportLocal(reportId) {
    const data = this.readLocalDb();
    const report = data.reports.find(r => r.id === reportId);
    if (report) {
      report.status = 'resolved';
      this.writeLocalDb(data);
    }
  }

  async banUser(userId, reason, expiresAt = null) {
    await this.init();
    if (this.useFallback) {
      return this.banUserLocal(userId, reason, expiresAt);
    }

    const user = await this.getUserById(userId);
    if (!user) throw new Error('User not found');
    if (user.isAdmin) throw new Error('Cannot ban an administrator');

    const banRecord = {
      userId,
      username: user.username,
      reason,
      bannedAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
    };

    await this.supabase.from('bans').upsert([banRecord]);
  }

  async banUserLocal(userId, reason, expiresAt = null) {
    const data = this.readLocalDb();
    const user = data.users[userId];
    if (!user) throw new Error('User not found');
    if (user.isAdmin) throw new Error('Cannot ban an administrator');

    data.bans[userId] = {
      userId,
      username: user.username,
      reason,
      bannedAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
    };

    this.writeLocalDb(data);
  }

  async unbanUser(userId) {
    await this.init();
    if (this.useFallback) {
      return this.unbanUserLocal(userId);
    }

    await this.supabase
      .from('bans')
      .delete()
      .eq('userId', userId);
  }

  async unbanUserLocal(userId) {
    const data = this.readLocalDb();
    delete data.bans[userId];
    this.writeLocalDb(data);
  }

  async isBanned(userId) {
    await this.init();
    if (this.useFallback) {
      return this.isBannedLocal(userId);
    }

    const { data: ban } = await this.supabase
      .from('bans')
      .select('*')
      .eq('userId', userId)
      .maybeSingle();

    if (!ban) return null;

    if (ban.expiresAt && new Date() > new Date(ban.expiresAt)) {
      // Ban has expired automatically
      await this.unbanUser(userId);
      return null;
    }

    return ban;
  }

  async isBannedLocal(userId) {
    const data = this.readLocalDb();
    const ban = data.bans[userId];
    if (!ban) return null;

    if (ban.expiresAt && new Date() > new Date(ban.expiresAt)) {
      await this.unbanUserLocal(userId);
      return null;
    }
    return ban;
  }

  async getBans() {
    await this.init();
    if (this.useFallback) {
      return this.getBansLocal();
    }

    const { data } = await this.supabase.from('bans').select('*');
    return data || [];
  }

  async getBansLocal() {
    const data = this.readLocalDb();
    return Object.values(data.bans);
  }

  async getAdminStats() {
    await this.init();
    if (this.useFallback) {
      return this.getAdminStatsLocal();
    }

    const { count: usersCount } = await this.supabase
      .from('users')
      .select('*', { count: 'exact', head: true });
    
    const { count: bansCount } = await this.supabase
      .from('bans')
      .select('*', { count: 'exact', head: true });
      
    const { data: reports } = await this.supabase
      .from('reports')
      .select('status');

    const totalReports = reports ? reports.length : 0;
    const pendingReports = reports ? reports.filter(r => r.status === 'pending').length : 0;

    return {
      totalUsers: usersCount || 0,
      totalBanned: bansCount || 0,
      totalReports,
      pendingReports
    };
  }

  async getAdminStatsLocal() {
    const data = this.readLocalDb();
    const totalUsers = Object.keys(data.users).length;
    const totalBanned = Object.keys(data.bans).length;
    const totalReports = data.reports.length;
    const pendingReports = data.reports.filter(r => r.status === 'pending').length;

    return {
      totalUsers,
      totalBanned,
      totalReports,
      pendingReports
    };
  }

  async getAllUsersForAdmin() {
    await this.init();
    if (this.useFallback) {
      return this.getAllUsersForAdminLocal();
    }

    const { data: users } = await this.supabase.from('users').select('*');
    const { data: bans } = await this.supabase.from('bans').select('userId');
    
    if (!users) return [];

    const bannedUserIds = (bans || []).map(b => b.userId);

    return users.map(u => {
      const mapped = this.mapUserFields(u);
      return {
        id: mapped.id,
        username: mapped.username,
        isGuest: mapped.isGuest,
        coins: mapped.coins,
        xp: mapped.xp,
        level: mapped.level,
        isAdmin: mapped.isAdmin,
        createdAt: mapped.createdAt,
        stats: mapped.stats,
        isBanned: bannedUserIds.includes(mapped.id)
      };
    });
  }

  async getAllUsersForAdminLocal() {
    const data = this.readLocalDb();
    return Object.values(data.users).map(u => {
      const mapped = this.mapUserFields(u);
      return {
        id: mapped.id,
        username: mapped.username,
        isGuest: mapped.isGuest,
        coins: mapped.coins,
        xp: mapped.xp,
        level: mapped.level,
        isAdmin: mapped.isAdmin,
        createdAt: mapped.createdAt,
        stats: mapped.stats,
        isBanned: !!data.bans[mapped.id]
      };
    });
  }
}

module.exports = new Database();
