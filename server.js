// Fix DNS resolution - prefer IPv4 over IPv6 (fixes ENOTFOUND on Windows)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const path = require('path');
const cron = require('node-cron');

// Import routes
const authRoutes = require('./routes/auth');
const youtubeRoutes = require('./routes/youtube');
const videoRoutes = require('./routes/video');
const driveRoutes = require('./routes/drive');
const adminRoutes = require('./routes/admin');

// Import services
const scheduler = require('./services/scheduler');
const { initFirebase } = require('./firebase-config');

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize Firebase Admin
initFirebase();

// Middleware
app.use(cors({
  origin: function(origin, callback) {
    // Allow all origins in production, or specific in dev
    const allowed = [
      process.env.BASE_URL,
      'http://localhost:3000',
      'http://127.0.0.1:3000'
    ].filter(Boolean);
    if (!origin || allowed.some(a => origin.startsWith(a)) || process.env.NODE_ENV === 'production') {
      callback(null, true);
    } else {
      callback(null, true); // Allow all for now
    }
  },
  credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'fallback-secret-key',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// Passport initialization
app.use(passport.initialize());
app.use(passport.session());

// Passport configuration
require('./routes/auth');

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/videos', express.static(path.join(__dirname, 'storage/videos')));
app.use('/thumbnails', express.static(path.join(__dirname, 'storage/thumbnails')));

// Routes
app.use('/auth', authRoutes);
app.use('/api/youtube', youtubeRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/drive', driveRoutes);
app.use('/api/admin', adminRoutes);

// Serve HTML pages
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'dashboard.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/settings', (req, res) => {
  res.sendFile(path.join(__dirname, 'settings.html'));
});

// API: Get current user session
app.get('/api/user', async (req, res) => {
  if (req.session && req.session.user) {
    try {
      const { getDb } = require('./firebase-config');
      const db = getDb();
      const userDoc = await db.collection('users').doc(req.session.user.uid).get();
      const userData = userDoc.exists ? userDoc.data() : {};
      res.json({ success: true, user: { ...req.session.user, ...userData } });
    } catch (err) {
      res.json({ success: true, user: req.session.user });
    }
  } else {
    res.json({ success: false, user: null });
  }
});

// API: Update user settings
app.post('/api/user/settings', async (req, res) => {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Not authenticated' });
  }
  try {
    const { getDb } = require('./firebase-config');
    const db = getDb();
    const { settings } = req.body;
    await db.collection('users').doc(req.session.user.uid).update({
      settings,
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true, message: 'Settings saved' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// API: Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    success: false, 
    error: err.message || 'Internal server error' 
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ success: false, error: 'Route not found' });
});

// Create storage directories
const fs = require('fs');
['storage/videos', 'storage/thumbnails', 'storage/audio'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) {
    fs.mkdirSync(fullPath, { recursive: true });
  }
});

// Initialize scheduler
scheduler.initScheduler();

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 YouTube Automation Server running on port ${PORT}`);
  console.log(`📺 Open http://localhost:${PORT} in your browser`);
  console.log(`⏰ Scheduler initialized - Videos will auto-upload at 10:00 AM, 2:00 PM, 7:00 PM`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
