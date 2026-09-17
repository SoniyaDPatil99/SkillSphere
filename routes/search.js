const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../db');
const https = require('https');
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

// Helper: fetch from YouTube Data API v3
function fetchYouTube(query) {
  return new Promise((resolve, reject) => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    if (!apiKey) {
      console.log('YouTube API Key missing in process.env');
      return resolve([]);
    }

    const searchQuery = encodeURIComponent(`${query} tutorial for beginners`);
    const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${searchQuery}&type=video&maxResults=3&relevanceLanguage=en&key=${apiKey}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) {
            console.error('YouTube API Error:', parsed.error.message);
            return resolve([]);
          }
          if (!parsed.items || parsed.items.length === 0) {
            console.log(`No YouTube videos found for: ${query}`);
            return resolve([]);
          }
          const videos = parsed.items.map(item => ({
            title: item.snippet.title,
            channel: item.snippet.channelTitle,
            thumbnail: item.snippet.thumbnails.medium.url,
            url: `https://www.youtube.com/watch?v=${item.id.videoId}`
          }));
          console.log(`Successfully fetched ${videos.length} YouTube videos for: ${query}`);
          resolve(videos);
        } catch (e) {
          console.error('Error parsing YouTube API response:', e.message);
          resolve([]);
        }
      });
    }).on('error', (err) => {
      console.error('HTTPS request error for YouTube API:', err.message);
      resolve([]);
    });
  });
}

// GET /api/search?q=keyword&category=category
router.get('/', auth, async (req, res) => {
  const { q = '', category = '' } = req.query;
  console.log(`[Search Hit] q: "${q}", category: "${category}"`);
  try {
    let query = `
      SELECT 
        s.*,
        u.name AS teacher_name, 
        u.bio AS teacher_bio, 
        u.location AS teacher_location,
        (
          CASE 
            WHEN s.status = 'approved' AND (
              (s.proof_link IS NOT NULL AND TRIM(s.proof_link) != '') OR
              (s.proof_file IS NOT NULL AND TRIM(s.proof_file) != '')
            )
            THEN 1
            ELSE 0
          END
        ) AS is_verified
      FROM skills s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id != ?
        AND s.is_draft = FALSE
    `;

    const params = [req.user.id];

    if (q) {
      query += ' AND (s.title LIKE ? OR s.description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }

    if (category) {
      query += ' AND s.category = ?';
      params.push(category);
    }

    query += ' ORDER BY is_verified DESC, s.created_at DESC';

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (err) {
    console.error('Search Error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/search/categories
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT DISTINCT category FROM skills WHERE category IS NOT NULL AND TRIM(category) != '' ORDER BY category"
    );
    res.json(rows.map(r => r.category));
  } catch (err) {
    console.error('Categories Error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

// GET /api/search/youtube?q=skill — YouTube fallback
router.get('/youtube', auth, async (req, res) => {
  const { q = '' } = req.query;
  if (!q.trim()) return res.json([]);

  try {
    const videos = await fetchYouTube(q.trim());
    res.json(videos);
  } catch (err) {
    console.error('YouTube fetch error:', err);
    res.json([]);
  }
});

// GET /api/search/suggestions?skill=...&level=...&category=...
router.get('/suggestions', auth, async (req, res) => {
  const { skill = '', level = '', category = '' } = req.query;
  const userId = req.user.id;

  if (!skill) return res.json([]);

  try {
    let query = `
      SELECT 
        u.id,
        u.name,
        u.bio,
        u.location,
        u.avatar_url,
        u.last_seen,
        s.id AS skill_id,
        s.title AS skill_title,
        s.category,
        s.level,
        s.status,
        s.proof_link,
        s.proof_file,
        (
          CASE 
            WHEN s.status = 'approved' AND (
              (s.proof_link IS NOT NULL AND TRIM(s.proof_link) != '') OR
              (s.proof_file IS NOT NULL AND TRIM(s.proof_file) != '')
            )
            THEN 1
            ELSE 0
          END
        ) AS is_verified,
        (
          (CASE WHEN LOWER(s.title) = LOWER(?) THEN 10 ELSE 0 END) +
          (CASE WHEN LOWER(s.title) LIKE LOWER(?) THEN 6 ELSE 0 END) +
          (CASE WHEN LOWER(s.description) LIKE LOWER(?) THEN 4 ELSE 0 END) +
          (CASE WHEN ? != '' AND s.category = ? THEN 3 ELSE 0 END) +
          (CASE WHEN ? != '' AND s.level = ? THEN 2 ELSE 0 END) +
          (CASE 
            WHEN s.status = 'approved' AND (
              (s.proof_link IS NOT NULL AND TRIM(s.proof_link) != '') OR
              (s.proof_file IS NOT NULL AND TRIM(s.proof_file) != '')
            ) THEN 3 ELSE 0 
          END) +
          (CASE WHEN u.bio IS NOT NULL AND TRIM(u.bio) != '' THEN 1 ELSE 0 END) +
          (CASE WHEN u.location IS NOT NULL AND TRIM(u.location) != '' THEN 1 ELSE 0 END)
        ) AS match_score
      FROM skills s
      JOIN users u ON s.user_id = u.id
      WHERE s.user_id != ?
        AND s.is_draft = FALSE
        AND (
          LOWER(s.title) LIKE LOWER(?) OR
          LOWER(s.description) LIKE LOWER(?) OR
          LOWER(s.category) LIKE LOWER(?)
        )
      HAVING match_score > 0
      ORDER BY match_score DESC, is_verified DESC, s.created_at DESC
      LIMIT 10
    `;

    const [rows] = await db.query(query, [
      skill,                 // exact title
      `%${skill}%`,          // partial title
      `%${skill}%`,          // description
      category, category,    // category scoring
      level, level,          // level scoring
      userId,                // exclude self
      `%${skill}%`,          // where title
      `%${skill}%`,          // where description
      `%${skill}%`           // where category
    ]);

    res.json(rows);
  } catch (err) {
    console.error('Suggestions Error:', err);
    res.status(500).json({ error: 'Server error.' });
  }
});

module.exports = router;