# SkillSphere — Verified Peer Learning & Skill Mentorship Platform

A full-stack startup-style web platform where users can connect, learn, and teach verified skills.

## Tech Stack
- **Frontend**: HTML, CSS (custom dark theme), Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Database**: MySQL
- **Auth**: JWT + bcrypt

## Features
- User registration & login with JWT auth
- Skill Verification System (mentors must prove expertise before teaching)
- Browse & search verified skills
- Send/accept/reject mentorship requests
- Connections system (accepted requests become connections)
- 1-to-1 chat (only between connected users)

## Setup

### 1. Clone and install
```bash
npm install
```

### 2. Create .env file
```bash
cp .env.example .env
# Edit .env and set your MySQL password
```

### 3. Set up database
```bash
node setup.js
```

### 4. Start the server
```bash
npm start
# or for development:
npm run dev
```

## 🚀 Live Demo

[Visit SkillSphere] (https://skillsphere-75sp.onrender.com)

## Folder Structure
```
public/           # Frontend HTML pages + CSS
routes/           # Express API routes
db.js             # MySQL connection pool
server.js         # Express app entry point
setup.js          # DB setup script
schema.sql        # MySQL schema
```

## API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register user |
| POST | /api/auth/login | Login |
| GET | /api/auth/me | Get current user |
| POST | /api/skills | Post a skill (verified) |
| GET | /api/skills/mine | My skills |
| GET | /api/search | Search skills |
| POST | /api/requests | Send mentorship request |
| PATCH | /api/requests/:id | Accept/reject request |
| GET | /api/connections | Get all connections |
| POST | /api/messages | Send message |
| GET | /api/messages/:partnerId | Get conversation |
