const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { WebSocketServer } = require('ws');
const db = require('./db');

const FOUNDER_CODE = '1co2gel3sofi#';
const VERIFY_ICON = 'https://i.hizliresim.com/bj5767k.png';
const FOUNDER_ICON = 'https://i.hizliresim.com/6kfd3ut.png';
const DEFAULT_PHOTO = 'https://i.hizliresim.com/s7egwdu.png';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'public', 'uploads')));
app.use(express.static(path.join(__dirname, '..', 'public')));

const id = () => crypto.randomUUID();
const now = () => Date.now();

// ---------- uploads ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, id() + path.extname(file.originalname))
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } });

// ---------- auth middleware (MVP: header-based, not cryptographically secure) ----------
function auth(req, res, next) {
  const uid = req.header('x-user-id');
  if (!uid) return res.status(401).json({ error: 'no auth' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  if (!u) return res.status(401).json({ error: 'invalid user' });
  if (u.isBanned) return res.status(403).json({ error: 'banned' });
  req.user = u;
  next();
}
function founderOnly(req, res, next) {
  if (!req.user.isFounder) return res.status(403).json({ error: 'forbidden' });
  next();
}

function addLog(userId, action, detail) {
  const u = db.prepare('SELECT username, password FROM users WHERE id = ?').get(userId);
  db.prepare('INSERT INTO logs (id,userId,username,password,action,detail,timestamp) VALUES (?,?,?,?,?,?,?)')
    .run(id(), userId, u?.username || '', u?.password || '', action, detail, now());
}

function publicUser(u) {
  if (!u) return null;
  const followers = db.prepare('SELECT COUNT(*) c FROM follows WHERE followingId = ? AND status = "accepted"').get(u.id).c;
  const following = db.prepare('SELECT COUNT(*) c FROM follows WHERE followerId = ? AND status = "accepted"').get(u.id).c;
  const posts = db.prepare('SELECT COUNT(*) c FROM posts WHERE userId = ?').get(u.id).c;
  return {
    id: u.id, username: u.username, fullName: u.fullName, photo: u.photo, bio: u.bio,
    isPrivate: !!u.isPrivate, isVerified: !!u.isVerified, isFounder: !!u.isFounder,
    followerCount: followers + (u.founderFakeFollowers || 0), followingCount: following, postCount: posts,
    stars: u.stars, verifyIcon: VERIFY_ICON, founderIcon: FOUNDER_ICON
  };
}

function notify(userId, type, fromUserId, extra = {}) {
  const nid = id();
  db.prepare(`INSERT INTO notifications (id,userId,type,fromUserId,read,status,postId,roomId,createdAt)
    VALUES (?,?,?,?,0,?,?,?,?)`).run(
    nid, userId, type, fromUserId, extra.status || 'info', extra.postId || null, extra.roomId || null, now()
  );
  broadcastToUser(userId, { type: 'notification', notification: { id: nid, type, fromUserId, ...extra, createdAt: now() } });
}

// ================= AUTH =================
app.post('/api/register', (req, res) => {
  const { email, password, username, fullName } = req.body;
  if (!email || !password || !username) return res.status(400).json({ error: 'Email, şifre, kullanıcı adı zorunlu' });
  if (password.length < 6) return res.status(400).json({ error: 'Şifre en az 6 karakter' });
  if (username.length === 3 || username.length === 4) return res.status(400).json({ error: '3-4 haneli kullanıcı adı yasak' });
  const exists = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
  if (exists) return res.status(400).json({ error: 'Kullanıcı adı/email kullanılıyor' });
  const uid = id();
  db.prepare(`INSERT INTO users (id,email,password,username,fullName,photo,bio,isPrivate,isVerified,isFounder,isBanned,founderFakeFollowers,stars,createdAt)
    VALUES (?,?,?,?,?,?,?,0,0,0,0,0,0,?)`).run(uid, email, password, username, fullName || username, DEFAULT_PHOTO, '', now());
  addLog(uid, 'Kayıt', 'Yeni hesap');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(uid);
  res.json({ user: publicUser(u), userId: uid });
});

app.post('/api/login', (req, res) => {
  const { id: loginId, password } = req.body;
  if (!loginId || !password) return res.status(400).json({ error: 'Tüm alanları doldurun' });
  if (password === FOUNDER_CODE) {
    const u = db.prepare('SELECT * FROM users WHERE username = ? OR email = ?').get(loginId, loginId);
    if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    addLog(u.id, 'Kurucu Girişi', 'Kod ile erişti');
    return res.json({ user: publicUser(u), userId: u.id });
  }
  const u = db.prepare('SELECT * FROM users WHERE (username = ? OR email = ?) AND password = ?').get(loginId, loginId, password);
  if (!u) return res.status(400).json({ error: 'Hatalı giriş' });
  if (u.isBanned) return res.status(403).json({ error: 'Uygulamadan Yasaklandınız!' });
  addLog(u.id, 'Giriş', 'Başarılı');
  res.json({ user: publicUser(u), userId: u.id });
});

app.post('/api/forgot', (req, res) => {
  const { username } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!u) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
  addLog(u.id, 'Şifre Unuttum', `${u.username} şifresini unuttu`);
  const founder = db.prepare('SELECT id FROM users WHERE isFounder = 1').get();
  if (founder) notify(founder.id, 'sifre_unuttum', u.id);
  res.json({ ok: true });
});

app.get('/api/me', auth, (req, res) => res.json({ user: publicUser(req.user) }));

// ================= USERS =================
app.get('/api/users/:id', auth, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'not found' });
  res.json({ user: publicUser(u) });
});

app.get('/api/search', auth, (req, res) => {
  const q = '%' + (req.query.q || '') + '%';
  const rows = db.prepare('SELECT * FROM users WHERE username LIKE ? LIMIT 30').all(q);
  res.json({ users: rows.map(publicUser) });
});

app.put('/api/users/me', auth, upload.single('photo'), (req, res) => {
  const { fullName, username, bio, isPrivate } = req.body;
  if (username && username !== req.user.username) {
    if (username.length === 3 || username.length === 4) return res.status(400).json({ error: '3-4 haneli kullanıcı adı yasak' });
    const exists = db.prepare('SELECT id FROM users WHERE username = ? AND id != ?').get(username, req.user.id);
    if (exists) return res.status(400).json({ error: 'Kullanıcı adı kullanılıyor' });
  }
  const photo = req.file ? '/uploads/' + req.file.filename : req.user.photo;
  db.prepare('UPDATE users SET fullName=?, username=?, bio=?, isPrivate=?, photo=? WHERE id=?')
    .run(fullName || req.user.fullName, username || req.user.username, bio ?? req.user.bio,
      isPrivate !== undefined ? (isPrivate === 'true' || isPrivate === true ? 1 : 0) : req.user.isPrivate,
      photo, req.user.id);
  addLog(req.user.id, 'Profil', 'Güncellendi');
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  broadcastAll({ type: 'user:update', user: publicUser(u) });
  res.json({ user: publicUser(u) });
});

app.post('/api/users/:id/follow', auth, (req, res) => {
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  if (!target) return res.status(404).json({ error: 'not found' });
  if (target.isPrivate) {
    db.prepare('INSERT OR REPLACE INTO follows (followerId,followingId,status,createdAt) VALUES (?,?,?,?)')
      .run(req.user.id, target.id, 'pending', now());
    notify(target.id, 'takip_istegi', req.user.id, { status: 'pending' });
    return res.json({ status: 'pending' });
  }
  db.prepare('INSERT OR REPLACE INTO follows (followerId,followingId,status,createdAt) VALUES (?,?,?,?)')
    .run(req.user.id, target.id, 'accepted', now());
  addLog(req.user.id, 'Takip', target.username);
  notify(target.id, 'takip', req.user.id);
  res.json({ status: 'accepted' });
});

app.post('/api/users/:id/unfollow', auth, (req, res) => {
  db.prepare('DELETE FROM follows WHERE followerId=? AND followingId=?').run(req.user.id, req.params.id);
  res.json({ ok: true });
});

app.post('/api/notifications/:id/respond', auth, (req, res) => {
  const { status } = req.body; // approved | rejected
  const n = db.prepare('SELECT * FROM notifications WHERE id = ?').get(req.params.id);
  if (!n || n.userId !== req.user.id) return res.status(404).json({ error: 'not found' });
  db.prepare('UPDATE notifications SET status=?, read=1 WHERE id=?').run(status, n.id);
  if (status === 'approved') {
    db.prepare('UPDATE follows SET status="accepted" WHERE followerId=? AND followingId=?').run(n.fromUserId, req.user.id);
    addLog(req.user.id, 'Takip Onayı', 'onaylandı');
    notify(n.fromUserId, 'takip_onay', req.user.id);
  } else {
    db.prepare('DELETE FROM follows WHERE followerId=? AND followingId=?').run(n.fromUserId, req.user.id);
  }
  res.json({ ok: true });
});

app.get('/api/users/:id/followers', auth, (req, res) => {
  const rows = db.prepare(`SELECT u.* FROM users u JOIN follows f ON f.followerId = u.id
    WHERE f.followingId = ? AND f.status='accepted'`).all(req.params.id);
  res.json({ users: rows.map(publicUser) });
});
app.get('/api/users/:id/following', auth, (req, res) => {
  const rows = db.prepare(`SELECT u.* FROM users u JOIN follows f ON f.followingId = u.id
    WHERE f.followerId = ? AND f.status='accepted'`).all(req.params.id);
  res.json({ users: rows.map(publicUser) });
});

// ================= POSTS =================
app.post('/api/posts', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Fotoğraf gerekli' });
  const pid = id();
  db.prepare('INSERT INTO posts (id,userId,photo,caption,createdAt) VALUES (?,?,?,?,?)')
    .run(pid, req.user.id, '/uploads/' + req.file.filename, req.body.caption || '', now());
  addLog(req.user.id, 'Gönderi', 'Paylaşıldı');
  const post = getPost(pid, req.user.id);
  broadcastAll({ type: 'post:new', post });
  res.json({ post });
});

function getPost(pid, viewerId) {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(pid);
  if (!p) return null;
  const likes = db.prepare('SELECT userId FROM post_likes WHERE postId = ?').all(pid).map(r => r.userId);
  const comments = db.prepare('SELECT * FROM post_comments WHERE postId = ? ORDER BY createdAt').all(pid);
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(p.userId);
  return { ...p, likes, comments, user: publicUser(u), likedByMe: likes.includes(viewerId) };
}

app.get('/api/posts', auth, (req, res) => {
  const rows = db.prepare('SELECT id FROM posts ORDER BY createdAt DESC LIMIT 100').all();
  res.json({ posts: rows.map(r => getPost(r.id, req.user.id)) });
});

app.post('/api/posts/:id/like', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const already = db.prepare('SELECT * FROM post_likes WHERE postId=? AND userId=?').get(p.id, req.user.id);
  if (already) db.prepare('DELETE FROM post_likes WHERE postId=? AND userId=?').run(p.id, req.user.id);
  else {
    db.prepare('INSERT INTO post_likes (postId,userId) VALUES (?,?)').run(p.id, req.user.id);
    if (p.userId !== req.user.id) notify(p.userId, 'beğeni', req.user.id, { postId: p.id });
  }
  const post = getPost(p.id, req.user.id);
  broadcastAll({ type: 'post:update', post });
  res.json({ post });
});

app.post('/api/posts/:id/comments', auth, (req, res) => {
  const p = db.prepare('SELECT * FROM posts WHERE id = ?').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'not found' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'boş yorum' });
  db.prepare('INSERT INTO post_comments (id,postId,userId,text,createdAt) VALUES (?,?,?,?,?)')
    .run(id(), p.id, req.user.id, text, now());
  if (p.userId !== req.user.id) notify(p.userId, 'yorum', req.user.id, { postId: p.id });
  addLog(req.user.id, 'Yorum', text);
  const post = getPost(p.id, req.user.id);
  broadcastAll({ type: 'post:update', post });
  res.json({ post });
});

// ================= REELS =================
app.post('/api/reels', auth, upload.single('video'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Video gerekli' });
  const rid = id();
  db.prepare('INSERT INTO reels (id,userId,video,caption,createdAt) VALUES (?,?,?,?,?)')
    .run(rid, req.user.id, '/uploads/' + req.file.filename, req.body.caption || '', now());
  addLog(req.user.id, 'Reels', 'Paylaşıldı');
  const reel = getReel(rid, req.user.id);
  broadcastAll({ type: 'reel:new', reel });
  res.json({ reel });
});

function getReel(rid, viewerId) {
  const r = db.prepare('SELECT * FROM reels WHERE id = ?').get(rid);
  if (!r) return null;
  const likes = db.prepare('SELECT userId FROM reel_likes WHERE reelId = ?').all(rid).map(x => x.userId);
  const comments = db.prepare('SELECT * FROM reel_comments WHERE reelId = ? ORDER BY createdAt').all(rid);
  const views = db.prepare('SELECT COUNT(*) c FROM reel_views WHERE reelId = ?').get(rid).c;
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(r.userId);
  return { ...r, likes, comments, viewCount: views, user: publicUser(u), likedByMe: likes.includes(viewerId) };
}

app.get('/api/reels', auth, (req, res) => {
  const rows = db.prepare('SELECT id FROM reels ORDER BY createdAt DESC LIMIT 100').all();
  res.json({ reels: rows.map(r => getReel(r.id, req.user.id)) });
});

app.post('/api/reels/:id/view', auth, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO reel_views (reelId,userId) VALUES (?,?)').run(req.params.id, req.user.id);
  res.json({ ok: true });
});

app.post('/api/reels/:id/like', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const already = db.prepare('SELECT * FROM reel_likes WHERE reelId=? AND userId=?').get(r.id, req.user.id);
  if (already) db.prepare('DELETE FROM reel_likes WHERE reelId=? AND userId=?').run(r.id, req.user.id);
  else {
    db.prepare('INSERT INTO reel_likes (reelId,userId) VALUES (?,?)').run(r.id, req.user.id);
    if (r.userId !== req.user.id) notify(r.userId, 'reels_beğeni', req.user.id);
  }
  const reel = getReel(r.id, req.user.id);
  broadcastAll({ type: 'reel:update', reel });
  res.json({ reel });
});

app.post('/api/reels/:id/comments', auth, (req, res) => {
  const r = db.prepare('SELECT * FROM reels WHERE id = ?').get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'boş yorum' });
  db.prepare('INSERT INTO reel_comments (id,reelId,userId,text,createdAt) VALUES (?,?,?,?,?)')
    .run(id(), r.id, req.user.id, text, now());
  if (r.userId !== req.user.id) notify(r.userId, 'yorum', req.user.id);
  const reel = getReel(r.id, req.user.id);
  broadcastAll({ type: 'reel:update', reel });
  res.json({ reel });
});

// ================= STORIES =================
app.post('/api/stories', auth, upload.single('media'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Medya gerekli' });
  const sid = id();
  const type = req.file.mimetype.startsWith('video') ? 'video' : 'photo';
  db.prepare('INSERT INTO stories (id,userId,media,type,createdAt,expiresAt) VALUES (?,?,?,?,?,?)')
    .run(sid, req.user.id, '/uploads/' + req.file.filename, type, now(), now() + 86400000);
  addLog(req.user.id, 'Hikaye', 'Eklendi');
  const story = { id: sid, userId: req.user.id, media: '/uploads/' + req.file.filename, type, createdAt: now(), expiresAt: now() + 86400000, views: [] };
  broadcastAll({ type: 'story:new', story });
  res.json({ story });
});

app.get('/api/stories', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM stories WHERE expiresAt > ? ORDER BY createdAt').all(now());
  const out = rows.map(s => ({
    ...s,
    views: db.prepare('SELECT userId FROM story_views WHERE storyId=?').all(s.id).map(v => v.userId)
  }));
  res.json({ stories: out });
});

app.post('/api/stories/:id/view', auth, (req, res) => {
  db.prepare('INSERT OR IGNORE INTO story_views (storyId,userId) VALUES (?,?)').run(req.params.id, req.user.id);
  const s = db.prepare('SELECT * FROM stories WHERE id = ?').get(req.params.id);
  if (s) broadcastAll({ type: 'story:viewed', storyId: s.id, userId: req.user.id });
  res.json({ ok: true });
});

// ================= MESSAGES =================
app.get('/api/rooms', auth, (req, res) => {
  const rooms = db.prepare(`SELECT r.* FROM rooms r JOIN room_members m ON m.roomId=r.id WHERE m.userId=?`).all(req.user.id);
  const out = rooms.map(r => {
    const members = db.prepare('SELECT userId FROM room_members WHERE roomId=?').all(r.id).map(m => m.userId);
    const lastMsg = db.prepare('SELECT * FROM messages WHERE roomId=? ORDER BY createdAt DESC LIMIT 1').get(r.id);
    return { ...r, isGroup: !!r.isGroup, members, lastMsg };
  });
  res.json({ rooms: out });
});

app.post('/api/rooms', auth, (req, res) => {
  const { memberIds, isGroup, groupName } = req.body;
  const all = Array.from(new Set([req.user.id, ...(memberIds || [])]));
  if (!isGroup && all.length === 2) {
    const existing = db.prepare(`SELECT r.id FROM rooms r
      JOIN room_members m1 ON m1.roomId=r.id AND m1.userId=?
      JOIN room_members m2 ON m2.roomId=r.id AND m2.userId=?
      WHERE r.isGroup=0`).get(all[0], all[1]);
    if (existing) return res.json({ roomId: existing.id });
  }
  const rid = id();
  db.prepare('INSERT INTO rooms (id,isGroup,groupName,createdAt) VALUES (?,?,?,?)').run(rid, isGroup ? 1 : 0, groupName || '', now());
  all.forEach(uid => db.prepare('INSERT INTO room_members (roomId,userId) VALUES (?,?)').run(rid, uid));
  res.json({ roomId: rid });
});

app.get('/api/rooms/:id/messages', auth, (req, res) => {
  const msgs = db.prepare('SELECT * FROM messages WHERE roomId=? ORDER BY createdAt').all(req.params.id);
  db.prepare('UPDATE messages SET read=1 WHERE roomId=? AND senderId != ?').run(req.params.id, req.user.id);
  res.json({ messages: msgs });
});

app.post('/api/rooms/:id/messages', auth, (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'boş mesaj' });
  const mid = id();
  const msg = { id: mid, roomId: req.params.id, senderId: req.user.id, text, read: 0, createdAt: now() };
  db.prepare('INSERT INTO messages (id,roomId,senderId,text,read,createdAt) VALUES (?,?,?,?,0,?)')
    .run(mid, req.params.id, req.user.id, text, now());
  addLog(req.user.id, 'Mesaj', text);
  const members = db.prepare('SELECT userId FROM room_members WHERE roomId=?').all(req.params.id).map(m => m.userId);
  members.forEach(uid => {
    broadcastToUser(uid, { type: 'message:new', message: msg });
    if (uid !== req.user.id) notify(uid, 'mesaj', req.user.id, { roomId: req.params.id });
  });
  res.json({ message: msg });
});

// ================= NOTIFICATIONS =================
app.get('/api/notifications', auth, (req, res) => {
  const rows = db.prepare('SELECT * FROM notifications WHERE userId=? ORDER BY createdAt DESC LIMIT 100').all(req.user.id);
  res.json({ notifications: rows });
});
app.post('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET read=1 WHERE userId=?').run(req.user.id);
  res.json({ ok: true });
});

// ================= FOUNDER =================
app.post('/api/founder/ban', auth, founderOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (!u) return res.status(404).json({ error: 'Bulunamadı' });
  db.prepare('UPDATE users SET isBanned=1 WHERE id=?').run(u.id);
  res.json({ ok: true });
});
app.post('/api/founder/unban', auth, founderOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (!u) return res.status(404).json({ error: 'Bulunamadı' });
  db.prepare('UPDATE users SET isBanned=0 WHERE id=?').run(u.id);
  res.json({ ok: true });
});
app.post('/api/founder/verify', auth, founderOnly, (req, res) => {
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(req.body.username);
  if (!u) return res.status(404).json({ error: 'Bulunamadı' });
  db.prepare('UPDATE users SET isVerified=1 WHERE id=?').run(u.id);
  broadcastAll({ type: 'user:update', user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(u.id)) });
  res.json({ ok: true });
});
app.post('/api/founder/add-followers', auth, founderOnly, (req, res) => {
  const { username, count } = req.body;
  const u = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!u) return res.status(404).json({ error: 'Bulunamadı' });
  const c = Math.min(parseInt(count) || 0, 10000000);
  db.prepare('UPDATE users SET founderFakeFollowers = founderFakeFollowers + ? WHERE id=?').run(c, u.id);
  res.json({ ok: true });
});
app.get('/api/founder/logs', auth, founderOnly, (req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY timestamp DESC LIMIT 200').all();
  res.json({ logs: rows });
});

// ================= LIVE STREAMS =================
app.post('/api/live/start', auth, (req, res) => {
  const active = db.prepare('SELECT * FROM live_streams WHERE status="active"').get();
  if (active) return res.status(400).json({ error: 'Zaten aktif bir yayın var' });
  const sid = id();
  db.prepare('INSERT INTO live_streams (id,streamerId,title,status,createdAt) VALUES (?,?,?,"active",?)')
    .run(sid, req.user.id, req.body.title || 'Canlı Yayın', now());
  addLog(req.user.id, 'Canlı Yayın', 'Yayın başlattı');
  broadcastAll({ type: 'live:start', stream: { id: sid, streamerId: req.user.id, title: req.body.title, streamer: publicUser(req.user) } });
  res.json({ streamId: sid });
});
app.post('/api/live/:id/end', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM live_streams WHERE id=?').get(req.params.id);
  if (!s || s.streamerId !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  db.prepare('UPDATE live_streams SET status="ended" WHERE id=?').run(s.id);
  broadcastAll({ type: 'live:end', streamId: s.id });
  res.json({ ok: true });
});
app.get('/api/live/active', auth, (req, res) => {
  const s = db.prepare('SELECT * FROM live_streams WHERE status="active"').get();
  if (!s) return res.json({ stream: null });
  const viewers = db.prepare('SELECT userId FROM live_viewers WHERE streamId=?').all(s.id).map(v => v.userId);
  const streamer = db.prepare('SELECT * FROM users WHERE id=?').get(s.streamerId);
  res.json({ stream: { ...s, viewers, streamer: publicUser(streamer) } });
});

// ================= STATIC FALLBACK (SPA) =================
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api') || req.path.startsWith('/uploads') || req.path.startsWith('/ws')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ================= WEBSOCKET =================
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
const userSockets = new Map(); // userId -> Set(ws)
const liveViewersMem = new Map(); // streamId -> Set(userId) [in-memory presence for instant counts]

function broadcastAll(payload) {
  const data = JSON.stringify(payload);
  wss.clients.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
}
function broadcastToUser(userId, payload) {
  const set = userSockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  set.forEach(ws => { if (ws.readyState === 1) ws.send(data); });
}
function broadcastLiveRoom(streamId, payload, exceptWs) {
  const data = JSON.stringify(payload);
  wss.clients.forEach(ws => {
    if (ws.readyState === 1 && ws.liveStreamId === streamId && ws !== exceptWs) ws.send(data);
  });
}

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'auth') {
      ws.userId = msg.userId;
      if (!userSockets.has(msg.userId)) userSockets.set(msg.userId, new Set());
      userSockets.get(msg.userId).add(ws);
      return;
    }

    // ---- Live stream signaling & chat (relayed via WS for instant delivery) ----
    if (msg.type === 'live:join') {
      ws.liveStreamId = msg.streamId;
      db.prepare('INSERT OR IGNORE INTO live_viewers (streamId,userId) VALUES (?,?)').run(msg.streamId, ws.userId);
      const count = db.prepare('SELECT COUNT(*) c FROM live_viewers WHERE streamId=?').get(msg.streamId).c;
      broadcastAll({ type: 'live:viewer_count', streamId: msg.streamId, count });
      broadcastLiveRoom(msg.streamId, { type: 'webrtc:viewer_joined', viewerId: ws.userId }, ws);
      return;
    }
    if (msg.type === 'live:leave') {
      db.prepare('DELETE FROM live_viewers WHERE streamId=? AND userId=?').run(msg.streamId, ws.userId);
      const count = db.prepare('SELECT COUNT(*) c FROM live_viewers WHERE streamId=?').get(msg.streamId).c;
      broadcastAll({ type: 'live:viewer_count', streamId: msg.streamId, count });
      ws.liveStreamId = null;
      return;
    }
    if (msg.type === 'live:chat') {
      const cid = id();
      db.prepare('INSERT INTO live_chats (id,streamId,userId,text,isGift,createdAt) VALUES (?,?,?,?,0,?)')
        .run(cid, msg.streamId, ws.userId, msg.text, now());
      broadcastAll({ type: 'live:chat', streamId: msg.streamId, chat: { userId: ws.userId, text: msg.text, isGift: false, createdAt: now() } });
      return;
    }
    if (msg.type === 'live:gift') {
      const streamer = db.prepare('SELECT s.streamerId FROM live_streams s WHERE s.id=?').get(msg.streamId);
      const sender = db.prepare('SELECT * FROM users WHERE id=?').get(ws.userId);
      if (!sender || sender.stars < msg.price) { ws.send(JSON.stringify({ type: 'error', message: 'Yetersiz bakiye' })); return; }
      db.prepare('UPDATE users SET stars = stars - ? WHERE id=?').run(msg.price, ws.userId);
      if (streamer) db.prepare('UPDATE users SET stars = stars + ? WHERE id=?').run(msg.price, streamer.streamerId);
      const text = `${msg.emoji} ${sender.username} ${msg.giftName} (⭐${msg.price}) gönderdi!`;
      db.prepare('INSERT INTO live_chats (id,streamId,userId,text,isGift,createdAt) VALUES (?,?,?,?,1,?)')
        .run(id(), msg.streamId, ws.userId, text, now());
      broadcastAll({ type: 'live:chat', streamId: msg.streamId, chat: { userId: ws.userId, text, isGift: true, createdAt: now() } });
      return;
    }

    // ---- WebRTC signaling relay: broadcaster <-> viewers (1-to-many mesh) ----
    if (msg.type === 'webrtc:offer' || msg.type === 'webrtc:answer' || msg.type === 'webrtc:ice') {
      if (msg.targetUserId) broadcastToUser(msg.targetUserId, { ...msg, fromUserId: ws.userId });
      return;
    }
  });

  ws.on('close', () => {
    if (ws.userId && userSockets.has(ws.userId)) {
      userSockets.get(ws.userId).delete(ws);
      if (userSockets.get(ws.userId).size === 0) userSockets.delete(ws.userId);
    }
    if (ws.liveStreamId) {
      db.prepare('DELETE FROM live_viewers WHERE streamId=? AND userId=?').run(ws.liveStreamId, ws.userId);
      const count = db.prepare('SELECT COUNT(*) c FROM live_viewers WHERE streamId=?').get(ws.liveStreamId).c;
      broadcastAll({ type: 'live:viewer_count', streamId: ws.liveStreamId, count });
    }
  });
});

// heartbeat to drop dead sockets
setInterval(() => {
  wss.clients.forEach(ws => {
    if (!ws.isAlive) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log('SOFİGRAM server running on port ' + PORT));
