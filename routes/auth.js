const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();
const multer = require('multer');
const path = require('path');

// Helper function to generate token
function generateToken(user) {
  if (!process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET is missing in .env file');
  }

  return jwt.sign(
    { id: user.id },
    process.env.JWT_SECRET,
    { expiresIn: '7d' }
  );
}
// POST /api/auth/register
router.post('/register', async (req, res) => {
  let { name, email, password, bio, location } = req.body;

  // Trim inputs
  name = name?.trim();
  email = email?.trim().toLowerCase();
  bio = bio?.trim();
  location = location?.trim();

  // ✅ NEW: Email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  // ✅ NEW: Strong password validation
  const passwordRegex =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&.#])[A-Za-z\d@$!%*?&.#]{8,}$/;

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Name, email, and password are required.' });
  }

  // ✅ NEW: Email format check
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Please enter a valid email address.' });
  }

  // ✅ NEW: Strong password check
  if (!passwordRegex.test(password)) {
    return res.status(400).json({
      error:
        'Password must be at least 8 characters and include uppercase, lowercase, number, and special character.'
    });
  }

  try {
    const [existing] = await db.query('SELECT id FROM users WHERE email = ?', [email]);

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const hashed = await bcrypt.hash(password, 12);

    const [result] = await db.query(
      'INSERT INTO users (name, email, password, bio, location) VALUES (?, ?, ?, ?, ?)',
      [name, email, hashed, bio || null, location || null]
    );

    const user = {
      id: result.insertId,
      name,
      email
    };

    const token = generateToken(user);

    res.status(201).json({
      message: 'Account created!',
      token,
      user
    });
  } catch (err) {
    console.error('Register Error:', err.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  let { email, password } = req.body;

  email = email?.trim().toLowerCase();

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const [rows] = await db.query('SELECT * FROM users WHERE email = ?', [email]);

    if (rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = rows[0];
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const token = generateToken(user);

    res.json({
      message: 'Logged in!',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email
      }
    });
  } catch (err) {
    console.error('Login Error:', err.message);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const [rows] = await db.query(
      'SELECT id, name, email, bio, location, avatar_url, created_at FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    res.json(rows[0]);
  } catch (err) {
    console.error('Auth Me Error:', err.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});


// keep simple (same as your old working)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

// ✅ RESTORED OLD AVATAR ROUTE
router.post('/avatar', upload.single('avatar'), async (req, res) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const filename = req.file.filename;

    await db.query(
      'UPDATE users SET avatar_url = ? WHERE id = ?',
      [filename, decoded.id]
    );

    res.json({
      message: 'Profile image uploaded successfully',
      avatar_url: filename
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Upload failed' });
  }
});
// PUT /api/auth/profile
router.put('/profile', async (req, res) => {
  const auth = req.headers.authorization;

  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided.' });
  }

  try {
    const token = auth.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let { name, bio, location } = req.body;

    name = name?.trim();
    bio = bio?.trim();
    location = location?.trim();

    if (!name) {
      return res.status(400).json({ error: 'Name is required.' });
    }

    if (name.length < 2) {
      return res.status(400).json({ error: 'Name must be at least 2 characters.' });
    }

    await db.query(
      'UPDATE users SET name = ?, bio = ?, location = ? WHERE id = ?',
      [name, bio || null, location || null, decoded.id]
    );

    const [rows] = await db.query(
      'SELECT id, name, email, bio, location, avatar_url, created_at FROM users WHERE id = ?',
      [decoded.id]
    );

    res.json({
      message: 'Profile updated successfully!',
      user: rows[0]
    });
  } catch (err) {
    console.error('Update Profile Error:', err.message);
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
});

// GET /api/auth/profile/:userId — Fetch any user's profile with stats and skills
router.get('/profile/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const [userRows] = await db.query(
      'SELECT id, name, email, bio, location, avatar_url, last_seen, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (userRows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    const user = userRows[0];

    // Fetch stats
    const [[skillCount]] = await db.query('SELECT COUNT(*) as count FROM skills WHERE user_id = ? AND is_draft = FALSE', [userId]);
    const [[requestCount]] = await db.query('SELECT COUNT(*) as count FROM mentor_requests WHERE user_id = ?', [userId]);
    const [[connCount]] = await db.query('SELECT COUNT(*) as count FROM connections WHERE user1_id = ? OR user2_id = ?', [userId, userId]);

    // Fetch skills with verification status
    const [skills] = await db.query(`
      SELECT *, 
        (CASE 
          WHEN status = 'approved' AND proof_link IS NOT NULL AND TRIM(proof_link) != '' THEN 1
          ELSE 0
        END) AS is_verified
      FROM skills 
      WHERE user_id = ? AND is_draft = FALSE 
      ORDER BY created_at DESC`, [userId]
    );
    
    // Fetch requests
    const [requests] = await db.query('SELECT * FROM mentor_requests WHERE user_id = ? ORDER BY created_at DESC', [userId]);

    res.json({
      user,
      stats: {
        skills: skillCount.count,
        requests: requestCount.count,
        connections: connCount.count,
        profile_completeness: (user.bio ? 35 : 0) + (user.location ? 35 : 0) + (user.avatar_url ? 30 : 0)
      },
      skills,
      requests
    });
  } catch (err) {
    console.error('Fetch Profile Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/auth/notifications — Fetch real notifications from existing data
router.get('/notifications', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided.' });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    // Fetch incoming requests
    const [requests] = await db.query(
      `SELECT r.id, r.created_at, u.name 
       FROM requests r JOIN users u ON r.sender_id = u.id 
       WHERE r.receiver_id = ? AND r.status = 'pending' ORDER BY r.created_at DESC LIMIT 5`, [userId]
    );

    // Fetch unread messages
    const [messages] = await db.query(
      `SELECT m.id, m.sent_at as created_at, u.name 
       FROM messages m JOIN users u ON m.sender_id = u.id 
       WHERE m.receiver_id = ? AND m.is_read = FALSE ORDER BY m.sent_at DESC LIMIT 5`, [userId]
    );

    // Fetch recent connections
    const [connections] = await db.query(
      `SELECT c.id, c.connected_at as created_at, u.name
       FROM connections c 
       JOIN users u ON (u.id = CASE WHEN c.user1_id = ? THEN c.user2_id ELSE c.user1_id END)
       WHERE c.user1_id = ? OR c.user2_id = ? ORDER BY c.connected_at DESC LIMIT 5`, [userId, userId, userId]
    );

    // Unify and sort
    let notifications = [];
    requests.forEach(r => notifications.push({
      type: 'request', icon: '📨', title: 'New Request',
      message: `You received a matching request from ${r.name}.`,
      time: r.created_at
    }));
    messages.forEach(m => notifications.push({
      type: 'message', icon: '💬', title: 'Unread Message',
      message: `You have a new message from ${m.name}.`,
      time: m.created_at
    }));
    connections.forEach(c => notifications.push({
      type: 'connection', icon: '🤝', title: 'New Connection',
      message: `You are now connected with ${c.name}.`,
      time: c.created_at
    }));

    notifications.sort((a, b) => new Date(b.time) - new Date(a.time));
    res.json(notifications.slice(0, 5));
  } catch (err) {
    console.error('Fetch Notifications Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/auth/nav-notifications — Fetch structured data for unified navbar dropdowns
router.get('/nav-notifications', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return res.status(401).json({ error: 'No token provided.' });

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    // Fetch incoming requests
    const [requests] = await db.query(
      `SELECT r.id, r.created_at, u.name, u.avatar_url, s.title as skill_title
       FROM requests r 
       JOIN users u ON r.sender_id = u.id 
       JOIN skills s ON r.skill_id = s.id
       WHERE r.receiver_id = ? AND r.status = 'pending' 
       ORDER BY r.created_at DESC LIMIT 5`, [userId]
    );

    // Fetch unread messages
    const [messages] = await db.query(
      `SELECT m.id, m.sent_at as created_at, m.content, u.name, u.avatar_url, u.id as sender_id
       FROM messages m 
       JOIN users u ON m.sender_id = u.id 
       WHERE m.receiver_id = ? AND m.is_read = FALSE 
       ORDER BY m.sent_at DESC LIMIT 5`, [userId]
    );

    res.json({ requests, messages });
  } catch (err) {
    console.error('Fetch Nav Notifications Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;