require('dotenv').config();
const express = require('express');
const router = express.Router();
const { getDb } = require('../firebase-config');

// Admin auth middleware
function adminAuth(req, res, next) {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tubebot-admin-2024';
  
  // Check session
  if (req.session && req.session.isAdmin) return next();
  
  // Check Authorization header (for API calls)
  const authHeader = req.headers['x-admin-key'];
  if (authHeader === ADMIN_PASSWORD) return next();
  
  return res.status(401).json({ success: false, error: 'Admin authentication required' });
}

// POST /api/admin/login
router.post('/login', (req, res) => {
  const { password } = req.body;
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'tubebot-admin-2024';
  
  if (password === ADMIN_PASSWORD) {
    req.session.isAdmin = true;
    req.session.adminLoginTime = new Date().toISOString();
    return res.json({ success: true, message: 'Admin logged in' });
  }
  return res.status(401).json({ success: false, error: 'Wrong password' });
});

// POST /api/admin/logout
router.post('/logout', (req, res) => {
  req.session.isAdmin = false;
  res.json({ success: true });
});

// GET /api/admin/status — Check if admin is logged in
router.get('/status', (req, res) => {
  res.json({ isAdmin: !!(req.session && req.session.isAdmin) });
});

// GET /api/admin/stats — Overall platform stats
router.get('/stats', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    
    const [usersSnap, videosSnap, logsSnap] = await Promise.all([
      db.collection('users').get(),
      db.collection('videos').get(),
      db.collection('upload_logs').get()
    ]);
    
    const users = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const videos = videosSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    
    const successLogs = logs.filter(l => l.success);
    const failedLogs = logs.filter(l => !l.success);
    
    const today = new Date().toISOString().split('T')[0];
    const todayLogs = logs.filter(l => l.timestamp && l.timestamp.startsWith(today));
    
    res.json({
      success: true,
      stats: {
        totalUsers: users.length,
        activeUsers: users.filter(u => u.accessToken).length,
        totalVideos: videos.length,
        totalUploads: successLogs.length,
        failedUploads: failedLogs.length,
        todayUploads: todayLogs.filter(l => l.success).length,
        successRate: logs.length > 0 ? Math.round((successLogs.length / logs.length) * 100) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/users — List all users
router.get('/users', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('users').get();
    const users = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        displayName: data.displayName || 'Unknown',
        email: data.email || '',
        photoURL: data.photoURL || null,
        totalVideos: data.totalVideos || 0,
        todayVideos: data.todayVideos || 0,
        lastUploadAt: data.lastUploadAt || null,
        lastLogin: data.lastLogin || null,
        createdAt: data.createdAt || null,
        isActive: data.isActive !== false,
        hasYouTube: !!data.accessToken,
        settings: data.settings || {}
      };
    });
    
    users.sort((a, b) => new Date(b.lastLogin || 0) - new Date(a.lastLogin || 0));
    res.json({ success: true, users });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PATCH /api/admin/users/:userId — Toggle user active status
router.patch('/users/:userId', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { isActive } = req.body;
    
    const db = getDb();
    await db.collection('users').doc(userId).update({
      isActive: !!isActive,
      updatedAt: new Date().toISOString()
    });
    
    res.json({ success: true, message: `User ${isActive ? 'activated' : 'deactivated'}` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/users/:userId — Remove a user
router.delete('/users/:userId', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const db = getDb();
    await db.collection('users').doc(userId).delete();
    res.json({ success: true, message: 'User removed' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/videos — All videos across all users
router.get('/videos', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('videos').get();
    const videos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    videos.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    res.json({ success: true, videos: videos.slice(0, 100) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/logs — Upload activity logs
router.get('/logs', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('upload_logs').get();
    const logs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    logs.sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0));
    res.json({ success: true, logs: logs.slice(0, 200) });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/trigger-upload — Manually trigger scheduler
router.post('/trigger-upload', adminAuth, async (req, res) => {
  try {
    const scheduler = require('../services/scheduler');
    // Run for all users immediately
    scheduler.processScheduledUpload('manual');
    res.json({ success: true, message: 'Upload triggered for all users!' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/scheduler — Scheduler status
router.get('/scheduler', adminAuth, (req, res) => {
  try {
    const scheduler = require('../services/scheduler');
    const status = scheduler.getSchedulerStatus();
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;
