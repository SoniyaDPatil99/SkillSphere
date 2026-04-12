const express = require('express');
const cors = require('cors');
const path = require('path');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();
const db = require('./db');


const authRoutes = require('./routes/auth');
const skillRoutes = require('./routes/skills');
const searchRoutes = require('./routes/search');
const requestRoutes = require('./routes/requests');
const connectionRoutes = require('./routes/connections');
const messageRoutes = require('./routes/messages');
const mentorRequestRoutes = require('./routes/mentor-requests');

const app = express();
const server = http.createServer(app);

// Track online users
const onlineUsers = new Map();

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.set('io', io);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));


// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/skills', skillRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/connections', connectionRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/mentor-requests', mentorRequestRoutes);

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/search', (req, res) => res.sendFile(path.join(__dirname, 'public', 'search.html')));
app.get('/requests', (req, res) => res.sendFile(path.join(__dirname, 'public', 'requests.html')));
app.get('/connections', (req, res) => res.sendFile(path.join(__dirname, 'public', 'connections.html')));
app.get('/chat', (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));

// ================= SOCKET LOGIC =================
io.on('connection', (socket) => {
  console.log('🟢 User connected:', socket.id);

  socket.on('join_user_room', async (userId) => {
    try {
      socket.userId = String(userId);
      socket.join(`user_${userId}`);
      onlineUsers.set(String(userId), socket.id);
      console.log(`📌 User ${userId} joined room user_${userId}`);
      io.emit('user_online', { userId: String(userId) });
    } catch (err) {
      console.error('join_user_room error:', err);
    }
  });

  socket.on('send_message', async (data) => {
    try {
      const { receiver_id, sender_id } = data;
      io.to(`user_${receiver_id}`).emit('receive_message', data);
      if (onlineUsers.has(String(receiver_id))) {
        await db.query(
          'UPDATE messages SET is_delivered = TRUE WHERE sender_id = ? AND receiver_id = ? AND is_delivered = FALSE',
          [sender_id, receiver_id]
        );
        io.to(`user_${sender_id}`).emit('messages_delivered', { by: String(receiver_id) });
      }
    } catch (err) {
      console.error('Socket send_message error:', err);
    }
  });

  socket.on('typing', (data) => {
    try {
      io.to(`user_${data.receiver_id}`).emit('user_typing', { sender_id: String(data.sender_id) });
    } catch (err) {
      console.error('typing error:', err);
    }
  });

  socket.on('stop_typing', (data) => {
    try {
      io.to(`user_${data.receiver_id}`).emit('user_stop_typing', { sender_id: String(data.sender_id) });
    } catch (err) {
      console.error('stop_typing error:', err);
    }
  });

  socket.on('check_user_status', async (partnerId) => {
    try {
      const isOnline = onlineUsers.has(String(partnerId));
      let lastSeen = null;
      const [rows] = await db.query('SELECT last_seen FROM users WHERE id = ?', [partnerId]);
      if (rows.length > 0) lastSeen = rows[0].last_seen;
      socket.emit('user_status_result', { userId: String(partnerId), isOnline, lastSeen });
    } catch (err) {
      console.error('check_user_status error:', err);
    }
  });

  socket.on('message_deleted', (data) => {
    try {
      io.to(`user_${data.receiver_id}`).emit('message_deleted_live', { messageId: data.messageId });
    } catch (err) {
      console.error('message_deleted error:', err);
    }
  });

  socket.on('disconnect', async () => {
    console.log('🔴 User disconnected:', socket.id);
    if (socket.userId) {
      onlineUsers.delete(String(socket.userId));
      try {
        await db.query('UPDATE users SET last_seen = NOW() WHERE id = ?', [socket.userId]);
      } catch (err) {
        console.error('last_seen update error:', err);
      }
      io.emit('user_offline', { userId: String(socket.userId), lastSeen: new Date().toISOString() });
    }
  });
});
// =================================================

const DEFAULT_PORT = 3000;
const requestedPort = process.env.PORT ? Number(process.env.PORT) : DEFAULT_PORT;
const isExplicitNonDefaultPort = !!process.env.PORT && requestedPort !== DEFAULT_PORT;

function startServer(port, attempt = 0) {
  server.listen(port, () => {
    console.log(`\n🚀 SkillSphere running at http://localhost:${port}\n`);
  });

  server.once('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      // If user explicitly set PORT, don't auto-change it.
      if (isExplicitNonDefaultPort) {
        console.error(`\n❌ Port ${port} is already in use. Set PORT to a free port and retry.\n`);
        process.exit(1);
      }

      const nextPort = port + 1;
      if (attempt >= 4) {
        console.error(`\n❌ Ports ${requestedPort}-${nextPort} are in use. Please free a port or set PORT.\n`);
        process.exit(1);
      }

      console.warn(`\n⚠️ Port ${port} in use. Retrying on ${nextPort}...\n`);
      startServer(nextPort, attempt + 1);
      return;
    }

    console.error('\n❌ Server failed to start:', err, '\n');
    process.exit(1);
  });
}

startServer(requestedPort);