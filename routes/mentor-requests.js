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

// POST /api/mentor-requests — save a mentor request
router.post('/', auth, async (req, res) => {
  const { skill_name } = req.body;
  if (!skill_name || !skill_name.trim()) {
    return res.status(400).json({ error: 'skill_name is required.' });
  }
  try {
    // Check if user already requested this skill
    const [existing] = await db.query(
      'SELECT id FROM mentor_requests WHERE user_id = ? AND skill_name = ?',
      [req.user.id, skill_name.trim()]
    );
    if (existing.length > 0) {
      return res.status(409).json({ error: 'You already requested a mentor for this skill.' });
    }
    await db.query(
      'INSERT INTO mentor_requests (user_id, skill_name) VALUES (?, ?)',
      [req.user.id, skill_name.trim()]
    );
    res.json({ message: 'Mentor request saved successfully.' });
  } catch (err) {
    console.error('mentor-requests POST error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/mentor-requests/mine — user's own mentor requests
router.get('/mine', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, skill_name, created_at FROM mentor_requests WHERE user_id = ? ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error('mentor-requests GET mine error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/mentor-requests/:id — delete a mentor request
router.delete('/:id', auth, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM mentor_requests WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );
    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found.' });
    }
    res.json({ message: 'Request deleted successfully.' });
  } catch (err) {
    console.error('mentor-requests DELETE error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/mentor-requests/trending — top requested skills
router.get('/trending', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT skill_name, COUNT(*) as count
      FROM mentor_requests
      GROUP BY skill_name
      ORDER BY count DESC
      LIMIT 12
    `);
    res.json(rows);
  } catch (err) {
    console.error('mentor-requests GET trending error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;
