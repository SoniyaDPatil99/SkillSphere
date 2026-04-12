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

// GET /api/connections — Get all ACCEPTED connections
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.id,
        c.connected_at,
        s.title AS skill_title,
        CASE
          WHEN c.user1_id = ? THEN u2.id
          ELSE u1.id
        END AS partner_id,
        CASE
          WHEN c.user1_id = ? THEN u2.name
          ELSE u1.name
        END AS partner_name,
        CASE
          WHEN c.user1_id = ? THEN u2.bio
          ELSE u1.bio
        END AS partner_bio,
        CASE
          WHEN c.user1_id = ? THEN 'learner'
          ELSE 'mentor'
        END AS my_role
      FROM connections c
      JOIN users u1 ON c.user1_id = u1.id
      JOIN users u2 ON c.user2_id = u2.id
      LEFT JOIN skills s ON c.skill_id = s.id
      WHERE (c.user1_id = ? OR c.user2_id = ?)
        AND c.status = 'accepted'
      ORDER BY c.connected_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/connections/pending — Get all pending requests (incoming + outgoing)
router.get('/pending', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        c.id,
        c.created_at,
        c.status,
        CASE
          WHEN c.user1_id = ? THEN 'outgoing'
          ELSE 'incoming'
        END AS direction,
        CASE
          WHEN c.user1_id = ? THEN u2.id
          ELSE u1.id
        END AS partner_id,
        CASE
          WHEN c.user1_id = ? THEN u2.name
          ELSE u1.name
        END AS partner_name,
        CASE
          WHEN c.user1_id = ? THEN u2.bio
          ELSE u1.bio
        END AS partner_bio
      FROM connections c
      JOIN users u1 ON c.user1_id = u1.id
      JOIN users u2 ON c.user2_id = u2.id
      WHERE (c.user1_id = ? OR c.user2_id = ?)
        AND c.status = 'pending'
      ORDER BY c.created_at DESC
    `, [req.user.id, req.user.id, req.user.id, req.user.id, req.user.id, req.user.id]);

    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// POST /api/connections/request — Send a connection request
router.post('/request', auth, async (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res.status(400).json({ error: 'userId is required.' });
  }

  if (userId === req.user.id) {
    return res.status(400).json({ error: 'Cannot send a request to yourself.' });
  }

  try {
    // Prevent duplicate pending or accepted connections in either direction
    const [existing] = await db.query(
      `SELECT id FROM connections
       WHERE (
         (user1_id = ? AND user2_id = ?) OR
         (user1_id = ? AND user2_id = ?)
       ) AND status IN ('pending', 'accepted')`,
      [req.user.id, userId, userId, req.user.id]
    );

    if (existing.length > 0) {
      return res.status(409).json({ error: 'Connection request already exists or users are already connected.' });
    }

    await db.query(
      'INSERT INTO connections (user1_id, user2_id, status, created_at) VALUES (?, ?, ?, NOW())',
      [req.user.id, userId, 'pending']
    );

    res.json({ message: 'Request sent' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to send request' });
  }
});

// PATCH /api/connections/:id/accept — Accept a pending connection request
router.patch('/:id/accept', auth, async (req, res) => {
  const { id } = req.params;

  try {
    // Only the recipient (user2_id) can accept the request
    const [rows] = await db.query(
      `SELECT * FROM connections WHERE id = ? AND user2_id = ? AND status = 'pending'`,
      [id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Pending request not found or you are not authorized to accept it.' });
    }

    await db.query(
      `UPDATE connections SET status = 'accepted', connected_at = NOW() WHERE id = ?`,
      [id]
    );

    res.json({ message: 'Connection accepted.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to accept request.' });
  }
});

module.exports = router;