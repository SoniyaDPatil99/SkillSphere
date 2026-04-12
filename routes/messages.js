const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'Unauthorized.' });
  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token.' });
  }
}

// ✅ FIXED: Safe connection check (prevents NaN crash)
async function areConnected(userId, partnerId) {
  const u1 = Number(userId);
  const u2 = Number(partnerId);

  // 🔥 CRITICAL FIX
  if (!u1 || !u2 || isNaN(u1) || isNaN(u2)) {
    console.error("Invalid IDs in areConnected:", u1, u2);
    return false;
  }

  const [rows] = await db.query(
    'SELECT id FROM connections WHERE (user1_id = ? AND user2_id = ?) OR (user1_id = ? AND user2_id = ?)',
    [u1, u2, u2, u1]
  );

  return rows.length > 0;
}

// POST /api/messages — Send a message
router.post('/', auth, async (req, res) => {
  const receiverId = Number(req.body.receiver_id);
  const { content } = req.body;

  if (!receiverId || isNaN(receiverId) || !content)
    return res.status(400).json({ error: 'receiver_id and content are required.' });

  try {
    const connected = await areConnected(req.user.id, receiverId);
    if (!connected)
      return res.status(403).json({ error: 'You can only chat with your connections.' });

    const [result] = await db.query(
      'INSERT INTO messages (sender_id, receiver_id, content, is_delivered, is_read, is_deleted) VALUES (?, ?, ?, FALSE, FALSE, FALSE)',
      [req.user.id, receiverId, content]
    );

    res.status(201).json({
      message: 'Message sent.',
      messageId: result.insertId
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/messages/delivered/:partnerId
router.patch('/delivered/:partnerId', auth, async (req, res) => {
  const partnerId = Number(req.params.partnerId);

  if (!partnerId || isNaN(partnerId))
    return res.status(400).json({ error: 'Invalid partner ID.' });

  try {
    const connected = await areConnected(req.user.id, partnerId);
    if (!connected)
      return res.status(403).json({ error: 'Not connected with this user.' });

    await db.query(
      'UPDATE messages SET is_delivered = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_delivered = FALSE',
      [partnerId, req.user.id]
    );

    res.json({ message: 'Messages marked as delivered.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/messages/seen/:partnerId
router.patch('/seen/:partnerId', auth, async (req, res) => {
  const partnerId = Number(req.params.partnerId);

  if (!partnerId || isNaN(partnerId))
    return res.status(400).json({ error: 'Invalid partner ID.' });

  try {
    const connected = await areConnected(req.user.id, partnerId);
    if (!connected)
      return res.status(403).json({ error: 'Not connected with this user.' });

    await db.query(
      'UPDATE messages SET is_read = TRUE, is_delivered = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_read = FALSE',
      [partnerId, req.user.id]
    );

    const io = req.app.get('io');
    if (io) {
      io.to(`user_${partnerId}`).emit('messages_seen', {
        by: String(req.user.id)
      });
    }

    res.json({ message: 'Messages marked as seen.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/messages/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM messages WHERE id = ? AND sender_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Message not found or not yours.' });
    }

    await db.query(
      'UPDATE messages SET is_deleted = TRUE, content = "You deleted this message" WHERE id = ?',
      [req.params.id]
    );


    res.json({ message: 'Message deleted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// ✅ FIX: ADD THIS ROUTE (YOU DID NOT HAVE IT)
router.get('/unread-count', auth, async (req, res) => {
  try {
    const userId = Number(req.user.id);

    if (!userId || isNaN(userId)) {
      return res.json({ unread_count: 0 });
    }

    const [rows] = await db.query(
      `SELECT COUNT(*) AS unread_count 
       FROM messages 
       WHERE receiver_id = ? AND is_read = FALSE`,
      [userId]
    );

    res.json({ unread_count: rows[0].unread_count });

  } catch (err) {
    console.error("Unread count error:", err);
    res.json({ unread_count: 0 }); // 🔥 never crash
  }
});

// GET /api/messages/:partnerId

  router.get('/:partnerId', auth, async (req, res) => {
  const partnerId = Number(req.params.partnerId);

  if (!partnerId || isNaN(partnerId))
    return res.json([]); // 🔥 prevents crash

  try {
    const connected = await areConnected(req.user.id, partnerId);
    if (!connected)
      return res.status(403).json({ error: 'Not connected with this user.' });

    const [rows] = await db.query(`
      SELECT m.*, u.name AS sender_name
      FROM messages m
      JOIN users u ON m.sender_id = u.id
      WHERE (m.sender_id = ? AND m.receiver_id = ?)
         OR (m.sender_id = ? AND m.receiver_id = ?)
      ORDER BY m.sent_at ASC
    `, [req.user.id, partnerId, partnerId, req.user.id]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;