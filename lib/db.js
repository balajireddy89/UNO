const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, '..', 'db.json');

class Database {
  constructor() {
    this.data = {
      users: {},
      friendships: [],
      history: [],
      reports: [],
      bans: {}
    };
    this.load();
  }

  // Load database from file with fallback
  load() {
    try {
      if (fs.existsSync(DB_FILE)) {
        const fileContent = fs.readFileSync(DB_FILE, 'utf8');
        this.data = JSON.parse(fileContent);
        
        // Ensure structure matches expectations
        if (!this.data.users) this.data.users = {};
        if (!this.data.friendships) this.data.friendships = [];
        if (!this.data.history) this.data.history = [];
        if (!this.data.reports) this.data.reports = [];
        if (!this.data.bans) this.data.bans = {};
      } else {
        this.save();
      }
    } catch (err) {
      console.error('Error loading database, initializing empty db:', err);
      this.save();
    }
  }

  // Atomic save to prevent file corruption
  save() {
    try {
      const tempPath = `${DB_FILE}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tempPath, DB_FILE);
    } catch (err) {
      console.error('Database write error:', err);
    }
  }

  // Cryptography Helpers
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

  // User Methods
  createUser(username, password = '', isGuest = false) {
    const normalizedUsername = username.trim().toLowerCase();
    
    // Check if user already exists
    if (!isGuest && this.getUserByUsername(normalizedUsername)) {
      throw new Error('Username already taken.');
    }

    const userId = crypto.randomUUID();
    const newUser = {
      id: userId,
      username: username.trim(),
      normalizedUsername,
      passwordHash: isGuest ? '' : this.hashPassword(password),
      isGuest,
      coins: 100, // starting coins
      xp: 0,
      level: 1,
      isAdmin: false,
      avatar: 'default_avatar_1',
      cardBack: 'default_classic',
      theme: 'default_table',
      unlockedAvatars: ['default_avatar_1'],
      unlockedCardBacks: ['default_classic'],
      unlockedThemes: ['default_table'],
      stats: {
        wins: 0,
        losses: 0,
        gamesPlayed: 0
      },
      createdAt: new Date().toISOString()
    };

    // Make the first registered user an admin for easy testing/demo purposes
    if (!isGuest && Object.keys(this.data.users).length === 0) {
      newUser.isAdmin = true;
    }

    this.data.users[userId] = newUser;
    this.save();
    return newUser;
  }

  getUserById(id) {
    return this.data.users[id] || null;
  }

  getUserByUsername(username) {
    const normalized = username.trim().toLowerCase();
    return Object.values(this.data.users).find(u => u.normalizedUsername === normalized) || null;
  }

  authenticate(username, password) {
    const user = this.getUserByUsername(username);
    if (!user) return null;
    if (user.isGuest) return null;
    if (this.verifyPassword(password, user.passwordHash)) {
      return user;
    }
    return null;
  }

  addXpAndCoins(userId, xpGained, coinsGained) {
    const user = this.getUserById(userId);
    if (!user) return null;

    user.xp += xpGained;
    user.coins += coinsGained;

    // Calculate level progression (simple formula: 100 XP * level for next level)
    let nextLevelXp = user.level * 100;
    while (user.xp >= nextLevelXp) {
      user.xp -= nextLevelXp;
      user.level += 1;
      nextLevelXp = user.level * 100;
    }

    this.save();
    return user;
  }

  updateStats(userId, isWin) {
    const user = this.getUserById(userId);
    if (!user) return;

    user.stats.gamesPlayed += 1;
    if (isWin) {
      user.stats.wins += 1;
    } else {
      user.stats.losses += 1;
    }
    this.save();
  }

  // Cosmetics Unlock / Shop
  unlockCosmetic(userId, type, itemKey, price) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found');
    if (user.coins < price) throw new Error('Insufficient coins');

    user.coins -= price;

    if (type === 'avatar') {
      if (!user.unlockedAvatars.includes(itemKey)) {
        user.unlockedAvatars.push(itemKey);
      }
    } else if (type === 'cardBack') {
      if (!user.unlockedCardBacks.includes(itemKey)) {
        user.unlockedCardBacks.push(itemKey);
      }
    } else if (type === 'theme') {
      if (!user.unlockedThemes.includes(itemKey)) {
        user.unlockedThemes.push(itemKey);
      }
    }

    this.save();
    return user;
  }

  equipCosmetic(userId, type, itemKey) {
    const user = this.getUserById(userId);
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

    this.save();
    return user;
  }

  // Match History
  saveMatchHistory(winnerId, mode, players, durationSeconds) {
    const matchId = crypto.randomUUID();
    const matchRecord = {
      id: matchId,
      winnerId,
      mode, // 'online' | 'offline' | 'practice'
      players: players.map(p => ({
        userId: p.id,
        username: p.username,
        score: p.score, // card points left in hand
        placement: p.placement, // 1st, 2nd, etc.
        coinsEarned: p.coinsEarned || 0,
        xpEarned: p.xpEarned || 0
      })),
      durationSeconds,
      playedAt: new Date().toISOString()
    };

    this.data.history.push(matchRecord);

    // Update individual user stats
    players.forEach(p => {
      this.updateStats(p.id, p.id === winnerId);
      this.addXpAndCoins(p.id, p.xpEarned || 0, p.coinsEarned || 0);
    });

    this.save();
    return matchRecord;
  }

  // Leaderboards
  getLeaderboard(type = 'wins') {
    const users = Object.values(this.data.users);
    
    if (type === 'wins') {
      return users
        .map(u => ({ id: u.id, username: u.username, score: u.stats.wins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'coins') {
      return users
        .map(u => ({ id: u.id, username: u.username, score: u.coins, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'xp') {
      // Sort by level first, then XP
      return users
        .map(u => ({ id: u.id, username: u.username, score: u.level * 1000 + u.xp, level: u.level }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    } else if (type === 'winrate') {
      return users
        .map(u => {
          const played = u.stats.gamesPlayed;
          const rate = played > 0 ? Math.round((u.stats.wins / played) * 100) : 0;
          return { id: u.id, username: u.username, score: rate, level: u.level, gamesPlayed: played };
        })
        .filter(u => u.gamesPlayed >= 3) // minimum 3 games played to appear on win rate board
        .sort((a, b) => b.score - a.score)
        .slice(0, 10);
    }
    return [];
  }

  // Social Methods (Friends)
  sendFriendRequest(userId, friendUsername) {
    const friend = this.getUserByUsername(friendUsername);
    if (!friend) throw new Error('User not found.');
    if (friend.id === userId) throw new Error('Cannot add yourself.');

    const exists = this.data.friendships.find(
      f => (f.userId === userId && f.friendId === friend.id) || 
           (f.userId === friend.id && f.friendId === userId)
    );

    if (exists) {
      if (exists.status === 'pending') {
        if (exists.userId === friend.id) {
          // Auto-accept if they had sent request to us
          exists.status = 'accepted';
          this.save();
          return { status: 'accepted', friend };
        }
        throw new Error('Friend request already pending.');
      }
      throw new Error('Already friends.');
    }

    this.data.friendships.push({
      userId,
      friendId: friend.id,
      status: 'pending'
    });
    this.save();
    return { status: 'pending', friend };
  }

  getFriends(userId) {
    const friendships = this.data.friendships.filter(
      f => f.userId === userId || f.friendId === userId
    );

    const friendsList = [];
    for (const f of friendships) {
      const isSender = f.userId === userId;
      const targetId = isSender ? f.friendId : f.userId;
      const friendUser = this.getUserById(targetId);
      
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

  handleFriendRequest(userId, friendId, accept) {
    const index = this.data.friendships.findIndex(
      f => f.status === 'pending' &&
           ((f.userId === friendId && f.friendId === userId) ||
            (f.userId === userId && f.friendId === friendId))
    );

    if (index === -1) throw new Error('No pending request found.');

    if (accept) {
      this.data.friendships[index].status = 'accepted';
    } else {
      this.data.friendships.splice(index, 1);
    }
    this.save();
  }

  // Admin and Moderation Methods
  createReport(reporterId, reportedUserId, reason, roomCode = '') {
    const report = {
      id: crypto.randomUUID(),
      reporterId,
      reporterName: this.getUserById(reporterId)?.username || 'Unknown',
      reportedUserId,
      reportedUserName: this.getUserById(reportedUserId)?.username || 'Unknown',
      reason,
      roomCode,
      status: 'pending', // 'pending' | 'resolved'
      createdAt: new Date().toISOString()
    };
    this.data.reports.push(report);
    this.save();
    return report;
  }

  getReports() {
    return this.data.reports;
  }

  resolveReport(reportId) {
    const report = this.data.reports.find(r => r.id === reportId);
    if (report) {
      report.status = 'resolved';
      this.save();
    }
  }

  banUser(userId, reason, expiresAt = null) {
    const user = this.getUserById(userId);
    if (!user) throw new Error('User not found');
    if (user.isAdmin) throw new Error('Cannot ban an administrator');

    this.data.bans[userId] = {
      userId,
      username: user.username,
      reason,
      bannedAt: new Date().toISOString(),
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null
    };
    this.save();
  }

  unbanUser(userId) {
    if (this.data.bans[userId]) {
      delete this.data.bans[userId];
      this.save();
    }
  }

  isBanned(userId) {
    const ban = this.data.bans[userId];
    if (!ban) return null;

    if (ban.expiresAt && new Date() > new Date(ban.expiresAt)) {
      // Ban has expired automatically
      delete this.data.bans[userId];
      this.save();
      return null;
    }

    return ban;
  }

  getBans() {
    return Object.values(this.data.bans);
  }

  getAdminStats() {
    return {
      totalUsers: Object.keys(this.data.users).length,
      totalBanned: Object.keys(this.data.bans).length,
      totalReports: this.data.reports.length,
      pendingReports: this.data.reports.filter(r => r.status === 'pending').length
    };
  }

  getAllUsersForAdmin() {
    return Object.values(this.data.users).map(u => ({
      id: u.id,
      username: u.username,
      isGuest: u.isGuest,
      coins: u.coins,
      xp: u.xp,
      level: u.level,
      isAdmin: u.isAdmin,
      createdAt: u.createdAt,
      stats: u.stats,
      isBanned: !!this.data.bans[u.id]
    }));
  }
}

module.exports = new Database();
