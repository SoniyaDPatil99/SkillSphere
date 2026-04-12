const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const router = express.Router();

function auth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    req.user = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// POST /api/requests — Send mentorship request
router.post('/', auth, async (req, res) => {
  const { receiver_id, skill_id, message } = req.body;

  if (!receiver_id || !skill_id) {
    return res.status(400).json({ error: 'receiver_id and skill_id are required.' });
  }

  // Prevent self-request
  if (Number(receiver_id) === Number(req.user.id)) {
    return res.status(400).json({ error: 'You cannot send a request to yourself.' });
  }

  try {
    // Check if same request already exists (pending or already accepted)
    const [existing] = await db.query(
      `SELECT id, status 
       FROM requests 
       WHERE sender_id = ? AND receiver_id = ? AND skill_id = ?
       ORDER BY created_at DESC`,
      [req.user.id, receiver_id, skill_id]
    );

    if (existing.length > 0) {
      const latest = existing[0];

      if (latest.status === 'pending') {
        return res.status(409).json({ error: 'Request already sent and still pending.' });
      }

      if (latest.status === 'accepted') {
        return res.status(409).json({ error: 'You are already connected for this skill.' });
      }
    }

    await db.query(
      'INSERT INTO requests (sender_id, receiver_id, skill_id, message) VALUES (?, ?, ?, ?)',
      [req.user.id, receiver_id, skill_id, message?.trim() || null]
    );

    res.status(201).json({ message: 'Mentorship request sent!' });
  } catch (err) {
    console.error('Send Request Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/requests/sent
router.get('/sent', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT r.*, u.name AS receiver_name, s.title AS skill_title
      FROM requests r
      JOIN users u ON r.receiver_id = u.id
      JOIN skills s ON r.skill_id = s.id
      WHERE r.sender_id = ?
      ORDER BY r.created_at DESC
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('Sent Requests Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/requests/received
router.get('/received', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT r.*, u.name AS sender_name, s.title AS skill_title
      FROM requests r
      JOIN users u ON r.sender_id = u.id
      JOIN skills s ON r.skill_id = s.id
      WHERE r.receiver_id = ?
      ORDER BY r.created_at DESC
      `,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('Received Requests Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PATCH /api/requests/:id — Accept or reject request
router.patch('/:id', auth, async (req, res) => {
  const { status } = req.body;

  if (!['accepted', 'rejected'].includes(status)) {
    return res.status(400).json({ error: 'Status must be accepted or rejected.' });
  }

  try {
    const [rows] = await db.query(
      'SELECT * FROM requests WHERE id = ? AND receiver_id = ?',
      [req.params.id, req.user.id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Request not found.' });
    }

    const request = rows[0];

    // Prevent updating already handled requests
    if (request.status !== 'pending') {
      return res.status(400).json({ error: `This request is already ${request.status}.` });
    }

    // Update request status
    await db.query(
      'UPDATE requests SET status = ? WHERE id = ?',
      [status, req.params.id]
    );

    // If accepted, create connection
    if (status === 'accepted') {
      const [connCheck] = await db.query(
        `
        SELECT id 
        FROM connections 
        WHERE (user1_id = ? AND user2_id = ?) 
           OR (user1_id = ? AND user2_id = ?)
        `,
        [request.sender_id, request.receiver_id, request.receiver_id, request.sender_id]
      );

      if (connCheck.length === 0) {
        await db.query(
          'INSERT INTO connections (user1_id, user2_id, skill_id, status, connected_at) VALUES (?, ?, ?, ?, NOW())',
          [request.sender_id, request.receiver_id, request.skill_id, 'accepted']
        );
      }
    }

    res.json({ message: `Request ${status} successfully.` });
  } catch (err) {
    console.error('Respond Request Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;