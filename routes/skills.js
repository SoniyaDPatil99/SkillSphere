const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads/certificates');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'cert-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

// JWT middleware
function auth(req, res, next) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized.' });
  }

  try {
    const token = header.split(' ')[1];
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// POST /api/skills — Post a skill (with proof-based verification)
router.post('/', auth, upload.single('proof_file'), async (req, res) => {
  let {
    title,
    category,
    description,
    level,
    how_learned,
    experience_duration,
    why_teach,
    proof_link,
    teaching_mode,
    availability,
    price_type,
    price_value,
    demo_session,
    is_draft
  } = req.body;

  // If a file was uploaded, save its path to proof_file
  let proof_file = null;
  if (req.file) {
    proof_file = `/uploads/certificates/${req.file.filename}`;
  }

  // Trim and parse inputs
  title = title?.trim();
  category = category?.trim();
  description = description?.trim();
  level = level?.trim();
  how_learned = how_learned?.trim() || "";
  experience_duration = experience_duration?.trim() || "";
  why_teach = why_teach?.trim() || "";
  proof_link = proof_link?.trim();
  teaching_mode = teaching_mode || 'Online';
  availability = availability || 'Both';
  price_type = price_type || 'Free';
  price_value = price_value?.trim();
  demo_session = demo_session === 'true' || demo_session === true ? 1 : 0;
  is_draft = is_draft === 'true' || is_draft === true ? 1 : 0;

  // Reduced validation for drafts
  if (!is_draft) {
    if (!title || !category || !description || !level || !how_learned || !experience_duration || !why_teach) {
      return res.status(400).json({ error: 'All required fields must be filled for a published skill.' });
    }
  } else {
    if (!title) return res.status(400).json({ error: 'Skill title is required for a draft.' });
  }

  // If proof exists (either file or link) → approved, else pending (unless draft)
  let status = (proof_file || proof_link) ? 'approved' : 'pending';
  if (is_draft) status = 'pending'; // Drafts are effectively pending but not public

  try {
    const [result] = await db.query(
      `INSERT INTO skills 
      (user_id, title, category, description, level, how_learned, experience_duration, why_teach, 
       proof_file, proof_link, status, is_verified, teaching_mode, availability, price_type, price_value, demo_session, is_draft)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user.id,
        title,
        category || 'Other',
        description || '',
        level || 'Beginner',
        how_learned,
        experience_duration,
        why_teach,
        proof_file || null,
        proof_link || null,
        status,
        (status === 'approved' ? 1 : 0),
        teaching_mode,
        availability,
        price_type,
        price_value || null,
        demo_session,
        is_draft
      ]
    );

    res.status(201).json({
      message: is_draft ? 'Draft saved successfully!' : (status === 'approved' ? 'Skill posted and verified successfully!' : 'Skill posted successfully and is pending review.'),
      skillId: result.insertId,
      status
    });
  } catch (err) {
    console.error('Post Skill Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/skills/mine — Get logged-in user's skills
router.get('/mine', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT *,
        (CASE 
          WHEN status = 'approved' AND (
            (proof_file IS NOT NULL AND TRIM(proof_file) != '') OR
            (proof_link IS NOT NULL AND TRIM(proof_link) != '')
          ) THEN 1
          ELSE 0
        END) AS is_verified
      FROM skills WHERE user_id = ? ORDER BY created_at DESC`,
      [req.user.id]
    );

    res.json(rows);
  } catch (err) {
    console.error('Get My Skills Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// PUT /api/skills/:id — Update an existing skill (keeps current ownership and draft state)
router.put('/:id', auth, upload.single('proof_file'), async (req, res) => {
  const skillId = req.params.id;

  try {
    const [rows] = await db.query('SELECT * FROM skills WHERE id = ? AND user_id = ? LIMIT 1', [skillId, req.user.id]);
    if (!rows || rows.length === 0) return res.status(404).json({ error: 'Skill not found.' });

    const existing = rows[0];
    const existingIsDraft = !!existing.is_draft;

    let {
      title,
      category,
      description,
      level,
      how_learned,
      experience_duration,
      why_teach,
      proof_link,
      teaching_mode,
      availability,
      price_type,
      price_value,
      demo_session,
      is_draft,
      keep_existing_proof_file,
      removed_proof
    } = req.body;

    // Handle proof_file: new upload, keep existing, or remove
    let proof_file = null;
    if (req.file) {
      // New file uploaded
      proof_file = `/uploads/certificates/${req.file.filename}`;
    } else if (keep_existing_proof_file === 'true') {
      // Keep existing proof_file
      proof_file = existing.proof_file || null;
    } else if (removed_proof === 'true') {
      // User removed the proof
      proof_file = null;
      proof_link = null;
    } else {
      // Keep existing if no action taken
      proof_file = existing.proof_file || null;
    }

    // Trim and parse inputs
    title = title?.trim();
    category = category?.trim();
    description = description?.trim();
    level = level?.trim();
    how_learned = how_learned?.trim() || "";
    experience_duration = experience_duration?.trim() || "";
    why_teach = why_teach?.trim() || "";
    proof_link = proof_link?.trim();
    teaching_mode = teaching_mode || 'Online';
    availability = availability || 'Both';
    price_type = price_type || 'Free';
    price_value = price_value?.trim();
    demo_session = demo_session === 'true' || demo_session === true ? 1 : 0;
    is_draft = is_draft === 'true' || is_draft === true ? 1 : 0;

    // Validation respects draft state
    if (!existingIsDraft) {
      if (!title || !category || !description || !level || !how_learned || !experience_duration || !why_teach) {
        return res.status(400).json({ error: 'All required fields must be filled for a published skill.' });
      }
    } else {
      if (!title) return res.status(400).json({ error: 'Skill title is required for a draft.' });
    }

    // Status: proof (file OR link) implies approved (unless draft)
    let status = (proof_file || proof_link) ? 'approved' : 'pending';
    if (is_draft) status = 'pending';

    await db.query(
      `UPDATE skills SET
        title = ?,
        category = ?,
        description = ?,
        level = ?,
        how_learned = ?,
        experience_duration = ?,
        why_teach = ?,
        proof_file = ?,
        proof_link = ?,
        status = ?,
        is_verified = ?,
        teaching_mode = ?,
        availability = ?,
        price_type = ?,
        price_value = ?,
        demo_session = ?,
        is_draft = ?
      WHERE id = ? AND user_id = ?`,
      [
        title,
        category || 'Other',
        description || '',
        level || 'Beginner',
        how_learned,
        experience_duration,
        why_teach,
        proof_file || null,
        proof_link || null,
        status,
        (status === 'approved' ? 1 : 0),
        teaching_mode,
        availability,
        price_type,
        price_value || null,
        demo_session,
        is_draft,
        skillId,
        req.user.id
      ]
    );

    res.json({
      message: 'Skill updated successfully!',
      status
    });
  } catch (err) {
    console.error('Update Skill Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

// DELETE /api/skills/:id
router.delete('/:id', auth, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM skills WHERE id = ? AND user_id = ?',
      [req.params.id, req.user.id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Skill not found.' });
    }

    res.json({ message: 'Skill removed successfully.' });
  } catch (err) {
    console.error('Delete Skill Error:', err.message);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;