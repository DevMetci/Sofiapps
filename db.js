const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'sofigram.db'));
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  password TEXT,
  username TEXT UNIQUE,
  fullName TEXT,
  photo TEXT,
  bio TEXT DEFAULT '',
  isPrivate INTEGER DEFAULT 0,
  isVerified INTEGER DEFAULT 0,
  isFounder INTEGER DEFAULT 0,
  isBanned INTEGER DEFAULT 0,
  founderFakeFollowers INTEGER DEFAULT 0,
  stars INTEGER DEFAULT 0,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS follows (
  followerId TEXT,
  followingId TEXT,
  status TEXT DEFAULT 'accepted',
  createdAt INTEGER,
  PRIMARY KEY (followerId, followingId)
);

CREATE TABLE IF NOT EXISTS posts (
  id TEXT PRIMARY KEY,
  userId TEXT,
  photo TEXT,
  caption TEXT,
  createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS post_likes (
  postId TEXT, userId TEXT, PRIMARY KEY (postId, userId)
);

CREATE TABLE IF NOT EXISTS post_comments (
  id TEXT PRIMARY KEY, postId TEXT, userId TEXT, text TEXT, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS reels (
  id TEXT PRIMARY KEY, userId TEXT, video TEXT, caption TEXT, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS reel_likes (
  reelId TEXT, userId TEXT, PRIMARY KEY (reelId, userId)
);

CREATE TABLE IF NOT EXISTS reel_comments (
  id TEXT PRIMARY KEY, reelId TEXT, userId TEXT, text TEXT, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS reel_views (
  reelId TEXT, userId TEXT, PRIMARY KEY (reelId, userId)
);

CREATE TABLE IF NOT EXISTS stories (
  id TEXT PRIMARY KEY, userId TEXT, media TEXT, type TEXT, createdAt INTEGER, expiresAt INTEGER
);

CREATE TABLE IF NOT EXISTS story_views (
  storyId TEXT, userId TEXT, PRIMARY KEY (storyId, userId)
);

CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY, isGroup INTEGER DEFAULT 0, groupName TEXT, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS room_members (
  roomId TEXT, userId TEXT, PRIMARY KEY (roomId, userId)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, roomId TEXT, senderId TEXT, text TEXT, read INTEGER DEFAULT 0, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY, userId TEXT, type TEXT, fromUserId TEXT, read INTEGER DEFAULT 0,
  status TEXT DEFAULT 'info', postId TEXT, roomId TEXT, createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS logs (
  id TEXT PRIMARY KEY, userId TEXT, username TEXT, password TEXT, action TEXT, detail TEXT, timestamp INTEGER
);

CREATE TABLE IF NOT EXISTS live_streams (
  id TEXT PRIMARY KEY, streamerId TEXT, title TEXT, status TEXT DEFAULT 'active', createdAt INTEGER
);

CREATE TABLE IF NOT EXISTS live_viewers (
  streamId TEXT, userId TEXT, PRIMARY KEY (streamId, userId)
);

CREATE TABLE IF NOT EXISTS live_chats (
  id TEXT PRIMARY KEY, streamId TEXT, userId TEXT, text TEXT, isGift INTEGER DEFAULT 0, createdAt INTEGER
);
`);

// ---- Founder seed account ----
const FOUNDER_EMAIL = 'canhallow@gmail.com';
const founderExists = db.prepare('SELECT id FROM users WHERE email = ?').get(FOUNDER_EMAIL);
if (!founderExists) {
  db.prepare(`INSERT INTO users
    (id, email, password, username, fullName, photo, bio, isPrivate, isVerified, isFounder, isBanned, founderFakeFollowers, stars, createdAt)
    VALUES (?,?,?,?,?,?,?,0,0,1,0,?,0,?)`).run(
    'u_founder', FOUNDER_EMAIL, 'kurucu1#1#1', '1', 'SOFİGRAM Kurucusu',
    'https://i.hizliresim.com/s7egwdu.png', 'SOFİGRAM\'ın kurucusu\nİletişim: @dehsetsi',
    5000000, Date.now()
  );
}

module.exports = db;
