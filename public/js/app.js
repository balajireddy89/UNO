class AppManager {
  constructor() {
    this.token = localStorage.getItem('uno_token') || null;
    this.user = null;
    
    this.currentView = 'landing';
    this.activeRoomCode = null;
    this.isSpectator = false;
    this.gameState = null;
    this.gameMode = null; // 'online' | 'offline' | 'practice'

    // Offline / Local Game State Engine
    this.offlineState = null;
    this.offlineTimerInterval = null;
    this.offlineHideHand = false; // flag to hide offline hand during pass-and-play transitions
  }

  // Initial setup on page load
  async init() {
    this.setupTheme();
    this.bindGlobalKeyboardShortcuts();

    if (this.token) {
      const success = await this.loadUserProfile();
      if (success) {
        this.navigateTo('home');
      } else {
        this.logout();
      }
    } else {
      this.navigateTo('landing');
    }
  }

  setupTheme() {
    const savedTheme = localStorage.getItem('uno_theme') || 'dark-theme';
    this.theme = savedTheme;
    document.body.className = savedTheme;
  }

  toggleTheme() {
    this.theme = this.theme === 'dark-theme' ? 'light-theme' : 'dark-theme';
    document.body.className = this.theme;
    localStorage.setItem('uno_theme', this.theme);
    this.showToast('info', `Theme switched to ${this.theme === 'dark-theme' ? 'Dark' : 'Light'} Mode`);
  }

  // Load User Profile HUD data
  async loadUserProfile() {
    try {
      const res = await fetch(`/api/user/profile?token=${this.token}`);
      if (!res.ok) return false;

      const data = await res.json();
      this.user = data.user;
      
      // Update HUD values
      document.getElementById('hud-username').innerText = this.user.username;
      document.getElementById('hud-level').innerText = this.user.level;
      document.getElementById('hud-coins').innerText = this.user.coins;
      
      // Calculate XP percentage
      const nextLevelXp = this.user.level * 100;
      const xpPercent = Math.round((this.user.xp / nextLevelXp) * 100);
      document.getElementById('hud-xp-bar-fill').style.width = `${xpPercent}%`;
      
      // Load avatar image path if unlocked/customized
      const avatarImg = document.getElementById('hud-avatar');
      avatarImg.src = `assets/avatars/${this.user.avatar}.svg`;

      // Show statistics summary
      document.getElementById('stats-games-played').innerText = this.user.stats.gamesPlayed;
      document.getElementById('stats-wins').innerText = this.user.stats.wins;
      
      const played = this.user.stats.gamesPlayed;
      const winRate = played > 0 ? Math.round((this.user.stats.wins / played) * 100) : 0;
      document.getElementById('stats-winrate').innerText = `${winRate}%`;

      // Admin toggle
      const adminNav = document.getElementById('admin-nav-item');
      if (this.user.isAdmin) {
        adminNav.style.display = 'flex';
      } else {
        adminNav.style.display = 'none';
      }

      return true;
    } catch (e) {
      console.error('Failed to load user profile:', e);
      return false;
    }
  }

  // Navigation SPA Router
  async navigateTo(viewName) {
    // Hide active game timer for safety
    if (this.currentView === 'game' && viewName !== 'game') {
      this.clearOfflineTimer();
    }

    // Hide all views
    const views = document.querySelectorAll('.view');
    views.forEach(v => v.classList.remove('active'));

    // Show selected view
    const target = document.getElementById(`view-${viewName}`);
    if (target) {
      target.classList.add('active');
      this.currentView = viewName;
    }

    // Fetch and populate details for dynamic screens
    if (viewName === 'home') {
      await this.loadUserProfile();
      socket.connect(); // Connect WebSockets on home
    } else if (viewName === 'profile') {
      this.renderProfileScreen();
    } else if (viewName === 'shop') {
      this.renderShopScreen();
    } else if (viewName === 'leaderboard') {
      this.renderLeaderboardScreen('wins');
    } else if (viewName === 'admin') {
      this.renderAdminScreen();
    }
  }

  // Authentication Switch forms
  switchAuthTab(type) {
    const tabGuest = document.getElementById('tab-guest');
    const tabLogin = document.getElementById('tab-login');
    const guestForm = document.getElementById('auth-guest-form');
    const loginForm = document.getElementById('auth-login-form');

    if (type === 'guest') {
      tabGuest.classList.add('active');
      tabLogin.classList.remove('active');
      guestForm.classList.add('active');
      loginForm.classList.remove('active');
    } else {
      tabGuest.classList.remove('active');
      tabLogin.classList.add('active');
      guestForm.classList.remove('active');
      loginForm.classList.add('active');
    }
  }

  // Login forms triggers
  async submitGuestAuth() {
    const usernameInput = document.getElementById('guest-username');
    const name = usernameInput.value.trim();
    if (name.length < 3) {
      this.showToast('error', 'Username must be at least 3 characters.');
      return;
    }

    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name })
      });
      const data = await res.json();
      
      if (res.ok) {
        this.token = data.token;
        localStorage.setItem('uno_token', data.token);
        this.showToast('success', 'Logged in as guest.');
        this.navigateTo('home');
      } else {
        this.showToast('error', data.error);
      }
    } catch (e) {
      this.showToast('error', 'Connection failed.');
    }
  }

  async submitLogin() {
    const userIn = document.getElementById('auth-username').value.trim();
    const passIn = document.getElementById('auth-password').value;

    if (!userIn || !passIn) {
      this.showToast('error', 'Please fill in credentials.');
      return;
    }

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userIn, password: passIn })
      });
      const data = await res.json();

      if (res.ok) {
        this.token = data.token;
        localStorage.setItem('uno_token', data.token);
        this.showToast('success', 'Logged in successfully.');
        this.navigateTo('home');
      } else {
        this.showToast('error', data.error);
      }
    } catch (e) {
      this.showToast('error', 'Connection failed.');
    }
  }

  async submitRegister() {
    const userIn = document.getElementById('auth-username').value.trim();
    const passIn = document.getElementById('auth-password').value;

    if (!userIn || !passIn) {
      this.showToast('error', 'Please fill in credentials.');
      return;
    }
    if (userIn.length < 3) {
      this.showToast('error', 'Username must be at least 3 characters.');
      return;
    }
    if (passIn.length < 6) {
      this.showToast('error', 'Password must be at least 6 characters.');
      return;
    }

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: userIn, password: passIn })
      });
      const data = await res.json();

      if (res.ok) {
        this.token = data.token;
        localStorage.setItem('uno_token', data.token);
        this.showToast('success', 'Account registered & Logged in.');
        this.navigateTo('home');
      } else {
        this.showToast('error', data.error);
      }
    } catch (e) {
      this.showToast('error', 'Registration failed.');
    }
  }

  logout() {
    this.token = null;
    this.user = null;
    localStorage.removeItem('uno_token');
    
    // Close ws socket if open
    if (socket.ws) {
      socket.ws.close();
    }

    this.navigateTo('landing');
  }

  // Profile HUD rendering
  async renderProfileScreen() {
    try {
      const res = await fetch(`/api/user/profile?token=${this.token}`);
      const data = await res.json();
      const user = data.user;
      const matches = data.matches;

      document.getElementById('profile-username').innerText = user.username;
      document.getElementById('profile-avatar-img').src = `assets/avatars/${user.avatar}.svg`;
      document.getElementById('profile-badge').innerText = user.isGuest ? 'GUEST USER' : 'REGISTERED';
      document.getElementById('profile-level').innerText = user.level;
      
      const nextLevelXp = user.level * 100;
      const xpPercent = Math.round((user.xp / nextLevelXp) * 100);
      document.getElementById('profile-xp-fill').style.width = `${xpPercent}%`;
      document.getElementById('profile-xp-text').innerText = `${user.xp} / ${nextLevelXp} XP`;

      // Stats
      document.getElementById('profile-stats-played').innerText = user.stats.gamesPlayed;
      document.getElementById('profile-stats-wins').innerText = user.stats.wins;
      document.getElementById('profile-stats-losses').innerText = user.stats.losses;
      
      const played = user.stats.gamesPlayed;
      const rate = played > 0 ? Math.round((user.stats.wins / played) * 100) : 0;
      document.getElementById('profile-stats-rate').innerText = `${rate}%`;

      // Match History Rows
      const rowsContainer = document.getElementById('profile-history-rows');
      rowsContainer.innerHTML = '';
      if (matches.length === 0) {
        rowsContainer.innerHTML = `<tr><td colspan="6" class="text-center">No matches played yet.</td></tr>`;
      } else {
        matches.forEach(m => {
          const myRec = m.players.find(p => p.userId === user.id) || {};
          const isWin = m.winnerId === user.id;
          const placementClass = isWin ? 'placement-1' : 'placement-2';
          const dateStr = new Date(m.playedAt).toLocaleDateString();
          const durationStr = `${Math.floor(m.durationSeconds / 60)}m ${m.durationSeconds % 60}s`;
          const opponents = m.players.filter(p => p.userId !== user.id).map(p => p.username).join(', ') || 'AI Opponents';

          const rowHtml = `
            <tr>
              <td><span style="text-transform: capitalize;">${m.mode}</span></td>
              <td><span class="${placementClass}">${myRec.placement === 1 ? '🏆 Winner' : `${myRec.placement} Place`}</span></td>
              <td title="${opponents}">${opponents.slice(0, 30)}${opponents.length > 30 ? '...' : ''}</td>
              <td style="color: var(--yellow-color); font-weight: 700;">🪙 +${myRec.coinsEarned}</td>
              <td style="color: var(--accent-color); font-weight: 700;">⭐ +${myRec.xpEarned}</td>
              <td>${dateStr} (${durationStr})</td>
            </tr>
          `;
          rowsContainer.innerHTML += rowHtml;
        });
      }

      // Load Friends
      this.loadFriendsList();

    } catch (e) {
      console.error(e);
    }
  }

  async loadFriendsList() {
    try {
      const res = await fetch(`/api/social/friends?token=${this.token}`);
      const friends = await res.json();
      const container = document.getElementById('friends-list');
      container.innerHTML = '';

      if (friends.length === 0) {
        container.innerHTML = `<p class="empty-text">No friends added yet.</p>`;
        return;
      }

      friends.forEach(f => {
        let actionButtons = '';
        if (f.status === 'pending') {
          if (f.isInitiator) {
            actionButtons = `<span class="slot-badge">Sent</span>`;
          } else {
            actionButtons = `
              <div class="friend-actions">
                <button class="btn btn-sm btn-primary" onclick="ui.respondFriendRequest('${f.id}', true)">Accept</button>
                <button class="btn btn-sm btn-outline" onclick="ui.respondFriendRequest('${f.id}', false)">Decline</button>
              </div>
            `;
          }
        } else {
          // Accepted
          actionButtons = `
            <div class="friend-actions">
              <button class="btn btn-sm btn-primary" onclick="ui.inviteFriendToLobby('${f.username}')" ${app.activeRoomCode ? '' : 'disabled'} title="Invite to Lobby">Invite</button>
            </div>
          `;
        }

        const itemHtml = `
          <div class="friend-row">
            <div class="friend-info">
              <img src="assets/avatars/${f.avatar}.svg" alt="Avatar" class="friend-avatar" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23444%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>U</text></svg>'">
              <div>
                <span class="friend-name">${f.username}</span>
                <span class="friend-lvl">LVL ${f.level}</span>
              </div>
            </div>
            ${actionButtons}
          </div>
        `;
        container.innerHTML += itemHtml;
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Cosmetics Shop HUD render
  async renderShopScreen() {
    try {
      const res = await fetch(`/api/user/profile?token=${this.token}`);
      const data = await res.json();
      this.user = data.user;
      
      // Update coins
      document.getElementById('shop-coins-val').innerText = this.user.coins;
      
      // Default to rendering Card Backs
      this.renderShopTabItems('cardBack');
    } catch (e) {
      console.error(e);
    }
  }

  renderShopTabItems(tabType) {
    const shopGrid = document.getElementById('shop-items-grid');
    shopGrid.innerHTML = '';

    // Cosmetics catalogue dataset
    const items = {
      cardBack: [
        { key: 'default_classic', name: 'Classic Retro', desc: 'Standard red and gold back', price: 0, preview: 'classic' },
        { key: 'neon_glow', name: 'Neon Cyber', desc: 'Vibrant neon borders', price: 100, preview: 'neon' },
        { key: 'cyber_grid', name: 'Cyberpunk Grid', desc: 'Yellow stripes cyberpunk style', price: 200, preview: 'cyberpunk' },
        { key: 'holo_foil', name: 'Holographic Foil', desc: 'Flowing colorful gradient', price: 500, preview: 'holographic' }
      ],
      avatar: [
        { key: 'default_avatar_1', name: 'Standard Player', desc: 'Classic silhouette', price: 0 },
        { key: 'ninja_mask', name: 'Shadow Ninja', desc: 'Silent card strategist', price: 150 },
        { key: 'astro_helmet', name: 'Astro Explorer', desc: 'Space helmet avatar', price: 250 },
        { key: 'cyber_glitch', name: 'Cyber Hacker', desc: 'Pixelated cyberpunk avatar', price: 400 }
      ],
      theme: [
        { key: 'default_table', name: 'Deep Forest', desc: 'Standard green card table', price: 0, hex: '#1c3e24' },
        { key: 'cyber_table', name: 'Cyber Tokyo', desc: 'Synthwave dark grid backdrop', price: 150, hex: '#111424' },
        { key: 'magma_table', name: 'Magma Arena', desc: 'Warm reddish volcanic ash', price: 300, hex: '#260f0f' }
      ]
    };

    const activeList = items[tabType] || [];

    activeList.forEach(item => {
      let isUnlocked = false;
      let isEquipped = false;

      if (tabType === 'cardBack') {
        isUnlocked = this.user.unlockedCardBacks.includes(item.key);
        isEquipped = this.user.cardBack === item.key;
      } else if (tabType === 'avatar') {
        isUnlocked = this.user.unlockedAvatars.includes(item.key);
        isEquipped = this.user.avatar === item.key;
      } else if (tabType === 'theme') {
        isUnlocked = this.user.unlockedThemes.includes(item.key);
        isEquipped = this.user.theme === item.key;
      }

      let buttonHtml = '';
      if (isEquipped) {
        buttonHtml = `<button class="btn btn-outline btn-block" disabled>EQUIPPED</button>`;
      } else if (isUnlocked) {
        buttonHtml = `<button class="btn btn-secondary btn-block" onclick="ui.equipShopItem('${tabType}', '${item.key}')">EQUIP</button>`;
      } else {
        buttonHtml = `<button class="btn btn-primary btn-block" onclick="ui.buyShopItem('${tabType}', '${item.key}', ${item.price})">🪙 BUY ${item.price}</button>`;
      }

      let previewNode = '';
      if (tabType === 'cardBack') {
        previewNode = `<div class="card-back-render card-back-${item.preview}"></div>`;
      } else if (tabType === 'avatar') {
        previewNode = `<img src="assets/avatars/${item.key}.svg" alt="Avatar" class="hud-avatar-wrapper" style="width: 70px; height: 70px; border-color: var(--accent-color);" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><circle cx=%2250%22 cy=%2250%22 r=%2245%22 fill=%22%23444%22/><text x=%2250%25%22 y=%2255%25%22 font-size=%2240%22 text-anchor=%22middle%22 fill=%22white%22>U</text></svg>'">`;
      } else {
        // Table skins
        previewNode = `<div class="table-theme-preview" style="background: ${item.hex}"></div>`;
      }

      const cardHtml = `
        <div class="shop-item-card card">
          <div class="shop-item-preview">${previewNode}</div>
          <h4>${item.name}</h4>
          <p>${item.desc}</p>
          ${buttonHtml}
        </div>
      `;
      shopGrid.innerHTML += cardHtml;
    });
  }

  // Leaderboard rendering
  async renderLeaderboardScreen(type = 'wins') {
    try {
      const res = await fetch(`/api/user/leaderboard?type=${type}`);
      const data = await res.json();
      
      const colLabel = document.getElementById('leaderboard-score-column');
      if (type === 'wins') colLabel.innerText = 'Wins';
      else if (type === 'coins') colLabel.innerText = 'Coins';
      else if (type === 'xp') colLabel.innerText = 'Level';
      else if (type === 'winrate') colLabel.innerText = 'Win Rate';

      const rowsList = document.getElementById('leaderboard-rows');
      rowsList.innerHTML = '';

      if (data.length === 0) {
        rowsList.innerHTML = `<div class="text-center" style="padding:20px;">No ranked players yet.</div>`;
        return;
      }

      data.forEach((u, idx) => {
        const rank = idx + 1;
        let rankClass = `rank-badge rank-${rank}`;
        let scoreVal = u.score;
        if (type === 'xp') {
          scoreVal = `LVL ${u.level}`;
        } else if (type === 'winrate') {
          scoreVal = `${u.score}%`;
        }

        const rowHtml = `
          <div class="leaderboard-row">
            <span class="${rankClass}">#${rank}</span>
            <span style="font-weight:700;">${u.username}</span>
            <span>LVL ${u.level}</span>
            <span style="font-weight:900; color:var(--accent-color);">${scoreVal}</span>
          </div>
        `;
        rowsList.innerHTML += rowHtml;
      });
    } catch (e) {
      console.error(e);
    }
  }

  // Admin View screen rendering
  async renderAdminScreen() {
    try {
      const headers = { 'Authorization': this.token };
      const statsRes = await fetch('/api/admin/stats', { headers });
      if (!statsRes.ok) return;

      const stats = await statsRes.json();
      
      document.getElementById('admin-stat-users').innerText = stats.totalUsers;
      document.getElementById('admin-stat-rooms').innerText = stats.activeRooms;
      document.getElementById('admin-stat-reports').innerText = stats.pendingReports;
      document.getElementById('admin-stat-bans').innerText = stats.totalBanned;

      // Render Users Table
      const usersRes = await fetch('/api/admin/users', { headers });
      const users = await usersRes.json();
      const userRows = document.getElementById('admin-user-rows');
      userRows.innerHTML = '';

      users.forEach(u => {
        const date = new Date(u.createdAt).toLocaleDateString();
        const type = u.isAdmin ? 'Admin' : (u.isGuest ? 'Guest' : 'Member');
        const banBtn = u.isBanned ? 
          `<button class="btn btn-sm btn-secondary" onclick="ui.adminUnbanUser('${u.id}')">Unban</button>` :
          `<button class="btn btn-sm btn-outline" onclick="ui.adminBanUser('${u.id}')" ${u.isAdmin ? 'disabled' : ''}>Ban</button>`;

        const row = `
          <tr>
            <td style="font-weight:700;">${u.username}</td>
            <td>${u.level}</td>
            <td>🪙 ${u.coins}</td>
            <td>${type}</td>
            <td>${banBtn}</td>
          </tr>
        `;
        userRows.innerHTML += row;
      });

      // Render Reports Table
      const reportsRes = await fetch('/api/admin/reports', { headers });
      const reports = await reportsRes.json();
      const reportRows = document.getElementById('admin-report-rows');
      reportRows.innerHTML = '';

      const pendingReports = reports.filter(r => r.status === 'pending');
      if (pendingReports.length === 0) {
        reportRows.innerHTML = `<tr><td colspan="4" class="text-center">No reports pending.</td></tr>`;
      } else {
        pendingReports.forEach(r => {
          const row = `
            <tr>
              <td>${r.reporterName}</td>
              <td style="color:var(--red-color); font-weight:700;">${r.reportedUserName}</td>
              <td>${r.reason}</td>
              <td>
                <button class="btn btn-sm btn-primary" onclick="ui.adminResolveReport('${r.id}')">Resolve</button>
              </td>
            </tr>
          `;
          reportRows.innerHTML += row;
        });
      }
    } catch (e) {
      console.error(e);
    }
  }

  // Keyboard Shortcuts (Accessibilities)
  bindGlobalKeyboardShortcuts() {
    window.addEventListener('keydown', (e) => {
      // Ignore if user is typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') {
        return;
      }

      // Game short-keys
      if (this.currentView === 'game') {
        if (e.key === 'd' || e.key === 'D') {
          // Press 'D' to Draw card
          ui.handleDrawClick();
        } else if (e.key === 'p' || e.key === 'P') {
          // Press 'P' to Pass
          ui.handlePassClick();
        } else if (e.key === 'u' || e.key === 'U') {
          // Press 'U' to call UNO
          ui.handleUnoClick();
        } else if (e.key === 'c' || e.key === 'C') {
          // Press 'C' to open in-game chat box
          ui.toggleGameChat();
          document.getElementById('game-chat-input').focus();
          e.preventDefault();
        }
      }
    });
  }

  // Modal display toggles
  openRulesModal() { document.getElementById('modal-rules').style.display = 'flex'; }
  closeRulesModal() { document.getElementById('modal-rules').style.display = 'none'; }

  showOnlineLobbiesModal() { document.getElementById('modal-online-lobbies').style.display = 'flex'; }
  closeOnlineLobbiesModal() { document.getElementById('modal-online-lobbies').style.display = 'none'; }

  openOfflineSetupModal() {
    document.getElementById('modal-offline-setup').style.display = 'flex';
    this.onOfflinePlayerCountChange(); // generate input nodes
  }
  closeOfflineSetupModal() { document.getElementById('modal-offline-setup').style.display = 'none'; }

  openPracticeSetupModal() { document.getElementById('modal-practice-setup').style.display = 'flex'; }
  closePracticeSetupModal() { document.getElementById('modal-practice-setup').style.display = 'none'; }

  // -----------------------------------------------------
  // OFFLINE GAME & AI PRACTICE SIMULATOR LOGIC
  // -----------------------------------------------------
  
  startOfflineGame() {
    this.gameMode = 'offline';
    this.closeOfflineSetupModal();
    this.navigateTo('game');

    // Build offline players
    const count = parseInt(document.getElementById('offline-player-count').value, 10);
    const playersList = [];
    for (let i = 0; i < count; i++) {
      const inputVal = document.getElementById(`offline-name-${i}`).value.trim();
      const name = inputVal || `Player ${i+1}`;
      playersList.push({
        id: `local_${i}`,
        username: name,
        hand: [],
        isReady: true,
        isSpectator: false,
        isAI: false
      });
    }

    this.initOfflineEngine(playersList, {
      maxPlayers: count,
      spectators: false,
      stackDraws: true,
      jumpIn: false,
      sevenZero: true,
      turnTimerLimit: 45 // local play gets slightly more time
    });
  }

  startPracticeGame() {
    this.gameMode = 'practice';
    this.closePracticeSetupModal();
    this.navigateTo('game');

    // Human player
    const playersList = [{
      id: this.user ? this.user.id : 'practice_human',
      username: this.user ? this.user.username : 'You',
      hand: [],
      isReady: true,
      isSpectator: false,
      isAI: false
    }];

    // AI Bots
    const count = parseInt(document.getElementById('practice-ai-count').value, 10);
    const difficulty = document.getElementById('practice-difficulty').value;
    const aiNames = ['Cortana', 'Hal9000', 'Jarvis', 'Ultron', 'Skynet', 'DeepBlue'];

    for (let i = 0; i < count; i++) {
      playersList.push({
        id: `ai_${i}`,
        username: `Bot ${aiNames[i % aiNames.length]}`,
        hand: [],
        isReady: true,
        isSpectator: false,
        isAI: true,
        difficulty
      });
    }

    this.initOfflineEngine(playersList, {
      maxPlayers: count + 1,
      spectators: false,
      stackDraws: true,
      jumpIn: false,
      sevenZero: true,
      turnTimerLimit: 30
    });
  }

  // Create Mock Game Session client-side
  initOfflineEngine(players, settings) {
    // We import basic game structure mock locally
    // To share the same code logic, we will build a client replica of server GameSession
    // We can load it dynamically or mockup basic card engines.
    
    // Setup Deck builder
    const colors = ['red', 'yellow', 'green', 'blue'];
    const deck = [];
    const createCard = (color, type, value = null, display = '') => ({
      id: Math.random().toString(36).substring(2, 9),
      color,
      type,
      value,
      display: display || (value !== null ? value.toString() : type.toUpperCase())
    });

    colors.forEach(color => {
      deck.push(createCard(color, 'number', 0));
      for (let v = 1; v <= 9; v++) {
        deck.push(createCard(color, 'number', v));
        deck.push(createCard(color, 'number', v));
      }
      for (let i = 0; i < 2; i++) {
        deck.push(createCard(color, 'skip'));
        deck.push(createCard(color, 'reverse'));
        deck.push(createCard(color, 'draw2', null, '+2'));
      }
    });
    for (let i = 0; i < 4; i++) {
      deck.push(createCard('wild', 'wild', null, 'WILD'));
      deck.push(createCard('wild', 'wild4', null, '+4'));
    }

    // Shuffle
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    // Deal
    players.forEach(p => {
      p.hand = [];
      for (let i = 0; i < 7; i++) {
        p.hand.push(deck.pop());
      }
    });

    let startCard = deck.pop();
    while (startCard.type === 'wild4') {
      deck.unshift(startCard);
      startCard = deck.pop();
    }

    this.offlineState = {
      roomId: 'LOCAL_MATCH',
      creatorId: players[0].id,
      settings,
      gameStarted: true,
      gameEnded: false,
      players,
      deck,
      discardPile: [startCard],
      currentPlayerIdx: 0,
      direction: 1,
      stackCount: 0,
      colorChoice: startCard.type === 'wild' ? 'red' : null,
      unoState: {},
      turnStartTime: Date.now(),
      timeLeft: settings.turnTimerLimit,
      pendingSevenSwap: null,
      winnerId: null
    };

    players.forEach(p => {
      this.offlineState.unoState[p.id] = { unoCalled: false };
    });

    // Reset indicator
    this.offlineHideHand = (this.gameMode === 'offline'); // hide hand on start for first pass-and-play
    this.triggerOfflineUpdate();
    this.startOfflineHeartbeat();
  }

  // Heartbeat loop for turn countdown timer
  startOfflineHeartbeat() {
    this.clearOfflineTimer();
    this.offlineTimerInterval = setInterval(() => {
      if (!this.offlineState || this.offlineState.gameEnded) return;

      const elapsed = Math.round((Date.now() - this.offlineState.turnStartTime) / 1000);
      const limit = this.offlineState.settings.turnTimerLimit;
      this.offlineState.timeLeft = Math.max(0, limit - elapsed);

      const current = this.offlineState.players[this.offlineState.currentPlayerIdx];
      ui.updateCountdownTimer(current.id, this.offlineState.timeLeft);

      if (this.offlineState.timeLeft <= 0) {
        // Auto draw card
        this.executeOfflineDraw(current.id);
        // Force Pass
        this.executeOfflinePass(current.id);
      }
    }, 1000);
  }

  clearOfflineTimer() {
    if (this.offlineTimerInterval) {
      clearInterval(this.offlineTimerInterval);
      this.offlineTimerInterval = null;
    }
  }

  // Trigger UI state refresh
  triggerOfflineUpdate() {
    // Generate sanitized structure mimicking socket outputs
    const active = this.offlineState.players;
    const current = active[this.offlineState.currentPlayerIdx];
    const clientUser = active.find(p => p.id === (this.user ? this.user.id : 'practice_human')) || active[0];

    const topCard = this.offlineState.discardPile[this.offlineState.discardPile.length - 1];

    // Build display payload
    const payload = {
      roomId: 'LOCAL_MATCH',
      creatorId: this.offlineState.creatorId,
      settings: this.offlineState.settings,
      gameStarted: this.offlineState.gameStarted,
      gameEnded: this.offlineState.gameEnded,
      direction: this.offlineState.direction,
      currentPlayerIdx: this.offlineState.currentPlayerIdx,
      currentPlayerName: current.username,
      stackCount: this.offlineState.stackCount,
      colorChoice: this.offlineState.colorChoice,
      topCard,
      winnerId: this.offlineState.winnerId,
      winnerName: this.offlineState.winnerId ? active.find(p => p.id === this.offlineState.winnerId).username : '',
      pendingSevenSwap: this.offlineState.pendingSevenSwap,
      deckCount: this.offlineState.deck.length,
      players: active.map(p => ({
        id: p.id,
        username: p.username,
        isReady: true,
        isSpectator: false,
        isAI: p.isAI,
        difficulty: p.difficulty || 'medium',
        cardCount: p.hand.length,
        // In offline pass-and-play, only reveal hand of current player if not hidden
        hand: (this.gameMode === 'offline') ? 
          (p.id === current.id && !this.offlineHideHand ? p.hand : []) : 
          (p.id === clientUser.id ? p.hand : []),
        unoCalled: this.offlineState.unoState[p.id]?.unoCalled || false
      })),
      isMyTurn: (this.gameMode === 'offline') ? true : (current.id === clientUser.id),
      timeLeft: this.offlineState.timeLeft
    };

    ui.renderGameBoard(payload);

    // Show Pass overlay in Pass-and-Play mode when transitioning turns
    if (this.gameMode === 'offline' && this.offlineHideHand && !this.offlineState.gameEnded) {
      document.getElementById('next-player-reveal-name').innerText = current.username;
      document.getElementById('pass-play-transition').style.display = 'flex';
    }
  }

  revealOfflineHand() {
    this.offlineHideHand = false;
    document.getElementById('pass-play-transition').style.display = 'none';
    this.offlineState.turnStartTime = Date.now(); // reset timer start when player actually looks
    this.triggerOfflineUpdate();
  }

  // Draw Card action offline
  executeOfflineDraw(userId) {
    const p = this.offlineState.players.find(x => x.id === userId);
    if (!p) return;

    audio.playDraw();

    const targetColor = this.offlineState.colorChoice || this.offlineState.discardPile[this.offlineState.discardPile.length - 1].color;
    const topCard = this.offlineState.discardPile[this.offlineState.discardPile.length - 1];

    const isValidPlay = (card) => {
      if (this.offlineState.stackCount > 0) {
        if (topCard.type === 'draw2' && card.type === 'draw2') return true;
        if (topCard.type === 'wild4' && card.type === 'wild4') return true;
        return false;
      }
      if (card.color === 'wild') return true;
      if (card.color === targetColor) return true;
      if (card.type === topCard.type && card.type !== 'number') return true;
      if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
      return false;
    };

    // Stacking penalty check
    if (this.offlineState.stackCount > 0) {
      this.drawCardsLocal(p, this.offlineState.stackCount);
      this.offlineState.stackCount = 0;
      this.advanceOfflineTurn();
      return;
    }

    // Single draw
    const drawn = this.drawCardsLocal(p, 1)[0];
    const canPlay = isValidPlay(drawn);

    if (!canPlay) {
      // Turn ends automatically if unplayable
      this.advanceOfflineTurn();
    } else {
      this.triggerOfflineUpdate();
    }
  }

  drawCardsLocal(player, count) {
    const cards = [];
    for (let i = 0; i < count; i++) {
      if (this.offlineState.deck.length === 0) {
        const top = this.offlineState.discardPile.pop();
        this.offlineState.deck = this.offlineState.discardPile;
        this.offlineState.discardPile = [top];
        // Reshuffle
        for (let i = this.offlineState.deck.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [this.offlineState.deck[i], this.offlineState.deck[j]] = [this.offlineState.deck[j], this.offlineState.deck[i]];
        }
      }
      if (this.offlineState.deck.length > 0) {
        const c = this.offlineState.deck.pop();
        player.hand.push(c);
        cards.push(c);
      }
    }
    this.offlineState.unoState[player.id].unoCalled = false;
    return cards;
  }

  executeOfflinePass(userId) {
    audio.playPlace();
    this.advanceOfflineTurn();
  }

  // Play Card action offline
  executeOfflinePlay(userId, cardId, chosenColor = null, swapTargetId = null) {
    const player = this.offlineState.players.find(x => x.id === userId);
    const cardIdx = player.hand.findIndex(x => x.id === cardId);
    if (cardIdx === -1) return;

    const card = player.hand[cardIdx];
    player.hand.splice(cardIdx, 1);
    this.offlineState.discardPile.push(card);

    audio.playPlace();

    // Reset UNO called state if they play card
    if (player.hand.length !== 1) {
      this.offlineState.unoState[userId].unoCalled = false;
    }

    // Victory Check
    if (player.hand.length === 0) {
      this.endOfflineGame(player);
      return;
    }

    // Apply Card logic
    let skip = 1;
    if (card.type === 'skip') {
      skip = 2;
    } else if (card.type === 'reverse') {
      if (this.offlineState.players.length === 2) {
        skip = 2;
      } else {
        this.offlineState.direction *= -1;
      }
    } else if (card.type === 'draw2') {
      this.offlineState.stackCount += 2;
    } else if (card.type === 'wild') {
      this.offlineState.colorChoice = chosenColor || 'red';
    } else if (card.type === 'wild4') {
      this.offlineState.colorChoice = chosenColor || 'red';
      this.offlineState.stackCount += 4;
    }

    // Seven-Zero
    if (this.offlineState.settings.sevenZero) {
      if (card.type === 'number' && card.value === 0) {
        const hands = this.offlineState.players.map(p => [...p.hand]);
        this.offlineState.players.forEach((p, idx) => {
          const srcIdx = (idx - this.offlineState.direction + this.offlineState.players.length) % this.offlineState.players.length;
          p.hand = hands[srcIdx];
          this.offlineState.unoState[p.id].unoCalled = false;
        });
        this.showToast('info', 'Zero Played! Rotated all player hands.');
      } else if (card.type === 'number' && card.value === 7) {
        if (swapTargetId) {
          const target = this.offlineState.players.find(p => p.id === swapTargetId);
          const temp = player.hand;
          player.hand = target.hand;
          target.hand = temp;
          this.offlineState.unoState[userId].unoCalled = false;
          this.offlineState.unoState[swapTargetId].unoCalled = false;
          this.showToast('info', `Swapped cards with ${target.username}.`);
        } else {
          this.offlineState.pendingSevenSwap = userId;
          this.triggerOfflineUpdate();
          return; // pause turn progression
        }
      }
    }

    this.offlineState.pendingSevenSwap = null;
    this.advanceOfflineTurn(skip);
    if (chosenColor) {
      this.offlineState.colorChoice = chosenColor;
    } else {
      this.offlineState.colorChoice = null;
    }
  }

  advanceOfflineTurn(skips = 1) {
    const len = this.offlineState.players.length;
    this.offlineState.currentPlayerIdx = (this.offlineState.currentPlayerIdx + skips * this.offlineState.direction + len * 10) % len;
    
    this.offlineState.turnStartTime = Date.now();
    this.offlineState.timeLeft = this.offlineState.settings.turnTimerLimit;
    
    this.offlineHideHand = (this.gameMode === 'offline'); // toggle hide overlays
    
    this.triggerOfflineUpdate();
    
    // Cycle AI bot turns if needed
    this.triggerOfflineAiLoop();
  }

  triggerOfflineAiLoop() {
    if (this.offlineState.gameEnded) return;

    setTimeout(() => {
      const current = this.offlineState.players[this.offlineState.currentPlayerIdx];
      if (current && current.isAI) {
        this.executeOfflineAiTurn(current);
      }
    }, 1200);
  }

  executeOfflineAiTurn(bot) {
    const hand = bot.hand;
    const targetColor = this.offlineState.colorChoice || this.offlineState.discardPile[this.offlineState.discardPile.length - 1].color;
    const topCard = this.offlineState.discardPile[this.offlineState.discardPile.length - 1];

    const isValidPlay = (card) => {
      if (this.offlineState.stackCount > 0) {
        if (topCard.type === 'draw2' && card.type === 'draw2') return true;
        if (topCard.type === 'wild4' && card.type === 'wild4') return true;
        return false;
      }
      if (card.color === 'wild') return true;
      if (card.color === targetColor) return true;
      if (card.type === topCard.type && card.type !== 'number') return true;
      if (card.type === 'number' && topCard.type === 'number' && card.value === topCard.value) return true;
      return false;
    };

    // Auto call UNO
    const callUnoCheck = () => {
      if (hand.length === 2) {
        const chance = Math.random();
        if (bot.difficulty === 'hard' && chance < 0.98) this.offlineState.unoState[bot.id].unoCalled = true;
        else if (bot.difficulty === 'medium' && chance < 0.75) this.offlineState.unoState[bot.id].unoCalled = true;
        else if (bot.difficulty === 'easy' && chance < 0.3) this.offlineState.unoState[bot.id].unoCalled = true;
      }
    };

    // Callout players who forgot UNO
    if (bot.difficulty === 'hard' || (bot.difficulty === 'medium' && Math.random() < 0.5)) {
      this.offlineState.players.forEach(p => {
        if (p.id !== bot.id && p.hand.length === 1 && !this.offlineState.unoState[p.id].unoCalled) {
          this.drawCardsLocal(p, 2);
          this.showToast('warning', `${bot.username} CALLED OUT ${p.username} for forgetting UNO! They drew 2 cards.`);
          audio.playNotify();
        }
      });
    }

    const validPlays = hand.filter(c => isValidPlay(c));

    const selectWildColor = () => {
      const counts = { red: 0, yellow: 0, green: 0, blue: 0 };
      hand.forEach(c => { if (counts[c.color] !== undefined) counts[c.color]++; });
      let maxColor = 'red';
      let maxCount = -1;
      for (const [col, count] of Object.entries(counts)) {
        if (count > maxCount) { maxCount = count; maxColor = col; }
      }
      return maxColor;
    };

    if (validPlays.length > 0) {
      let pick = validPlays[0];
      if (bot.difficulty === 'medium' || bot.difficulty === 'hard') {
        // prioritize numbers first
        const nums = validPlays.filter(c => c.type === 'number');
        if (nums.length > 0) pick = nums[0];
      }

      callUnoCheck();

      let swapTarget = null;
      if (this.offlineState.settings.sevenZero && pick.type === 'number' && pick.value === 7) {
        const opps = this.offlineState.players.filter(p => p.id !== bot.id);
        opps.sort((a,b) => a.hand.length - b.hand.length);
        swapTarget = opps[0]?.id || null;
      }

      const color = pick.color === 'wild' ? selectWildColor() : null;
      this.executeOfflinePlay(bot.id, pick.id, color, swapTarget);
    } else {
      // Draw card
      this.executeOfflineDraw(bot.id);
    }
  }

  // End round reward details offline
  endOfflineGame(player) {
    this.offlineState.gameEnded = true;
    this.offlineState.winnerId = player.id;
    this.clearOfflineTimer();

    audio.playVictory();

    // Save offline history local rewarding
    const duration = Math.round((Date.now() - this.offlineState.turnStartTime) / 1000);
    
    // XP and coins
    let coins = 10;
    let xp = 25;
    if (player.id === (this.user ? this.user.id : 'practice_human')) {
      coins = 100;
      xp = 150;
    }

    // Persist local games if user logged in
    if (this.user) {
      // mock post or simply deduct
      fetch(`/api/user/profile?token=${this.token}`).then(() => {
        // sync wins data locally
      });
    }

    // Display overlay results
    document.getElementById('game-over-winner-name').innerText = player.username;
    document.getElementById('game-over-coins').innerText = `+${coins}`;
    document.getElementById('game-over-xp').innerText = `+${xp}`;
    document.getElementById('game-over-stats-report').innerText = `Offline match completed!`;
    document.getElementById('modal-game-over').style.display = 'flex';
  }

  returnToHome() {
    document.getElementById('modal-game-over').style.display = 'none';
    this.navigateTo('home');
  }

  onOfflinePlayerCountChange() {
    const container = document.getElementById('offline-names-container');
    container.innerHTML = '';
    const count = parseInt(document.getElementById('offline-player-count').value, 10);
    
    for (let i = 0; i < count; i++) {
      const defaultName = `Player ${i+1}`;
      const divHtml = `
        <div class="form-group">
          <label for="offline-name-${i}">Player ${i+1} Name</label>
          <input type="text" id="offline-name-${i}" placeholder="${defaultName}" maxlength="15" autocomplete="off">
        </div>
      `;
      container.innerHTML += divHtml;
    }
  }

  // Toast System implementation
  showToast(type, message) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '🔔';
    if (type === 'success') icon = '✅';
    else if (type === 'error') icon = '❌';
    else if (type === 'info') icon = 'ℹ️';

    toast.innerHTML = `
      <span>${icon}</span>
      <span>${message}</span>
    `;

    container.appendChild(toast);
    
    // Auto remove after 3s
    setTimeout(() => {
      toast.style.animation = 'slideIn 0.25s reverse forwards';
      toast.addEventListener('animationend', () => {
        toast.remove();
      });
    }, 3000);
  }
}

const app = new AppManager();
window.app = app;

window.addEventListener('DOMContentLoaded', () => {
  app.init();
});
