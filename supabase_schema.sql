-- SUPABASE POSTGRESQL TABLE SCHEMAS FOR UNO MULTIPLAYER CARD GAME

-- 1. USERS TABLE
CREATE TABLE IF NOT EXISTS public.users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL,
    "normalizedUsername" TEXT NOT NULL UNIQUE,
    "passwordHash" TEXT NOT NULL,
    "isGuest" BOOLEAN DEFAULT false,
    coins INTEGER DEFAULT 100,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 1,
    "isAdmin" BOOLEAN DEFAULT false,
    avatar TEXT DEFAULT 'default_avatar_1',
    "cardBack" TEXT DEFAULT 'default_classic',
    theme TEXT DEFAULT 'default_table',
    "unlockedAvatars" JSONB DEFAULT '["default_avatar_1"]'::jsonb,
    "unlockedCardBacks" JSONB DEFAULT '["default_classic"]'::jsonb,
    "unlockedThemes" JSONB DEFAULT '["default_table"]'::jsonb,
    stats_wins INTEGER DEFAULT 0,
    stats_losses INTEGER DEFAULT 0,
    "stats_gamesPlayed" INTEGER DEFAULT 0,
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. FRIENDSHIPS TABLE
CREATE TABLE IF NOT EXISTS public.friendships (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "friendId" TEXT NOT NULL,
    status TEXT NOT NULL -- 'pending' | 'accepted'
);

-- 3. MATCH HISTORY TABLE
CREATE TABLE IF NOT EXISTS public.history (
    id UUID PRIMARY KEY,
    "winnerId" TEXT NOT NULL,
    mode TEXT NOT NULL, -- 'online' | 'offline' | 'practice'
    players JSONB NOT NULL, -- json array of players with placements & rewards
    "durationSeconds" INTEGER NOT NULL,
    "playedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 4. REPORTS TABLE
CREATE TABLE IF NOT EXISTS public.reports (
    id UUID PRIMARY KEY,
    "reporterId" TEXT NOT NULL,
    "reporterName" TEXT NOT NULL,
    "reportedUserId" TEXT NOT NULL,
    "reportedUserName" TEXT NOT NULL,
    reason TEXT NOT NULL,
    "roomCode" TEXT NOT NULL,
    status TEXT NOT NULL, -- 'pending' | 'resolved'
    "createdAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. BANS TABLE
CREATE TABLE IF NOT EXISTS public.bans (
    "userId" TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    reason TEXT NOT NULL,
    "bannedAt" TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    "expiresAt" TIMESTAMP WITH TIME ZONE
);

-- Indexing for normalized username lookups (fast registrations/logins)
CREATE INDEX IF NOT EXISTS idx_users_normalized_username ON public.users("normalizedUsername");
