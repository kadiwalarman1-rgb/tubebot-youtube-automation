require('dotenv').config();
const express = require('express');
const os = require('os');
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

// GET /api/admin/users/:userId — Get single user details
router.get('/users/:userId', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const doc = await db.collection('users').doc(req.params.userId).get();
    if (!doc.exists) return res.status(404).json({ success: false, error: 'User not found' });

    const user = { id: doc.id, ...doc.data() };
    // Remove sensitive tokens from response
    const safeUser = { ...user };
    if (safeUser.accessToken) safeUser.accessToken = safeUser.accessToken.substring(0, 20) + '...';
    if (safeUser.refreshToken) safeUser.refreshToken = '***hidden***';

    // Get user's videos
    const videosSnap = await db.collection('videos').where('userId', '==', req.params.userId).get();
    const videos = videosSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0))
      .slice(0, 10);

    // Get user's upload logs
    const logsSnap = await db.collection('upload_logs').where('userId', '==', req.params.userId).get();
    const logs = logsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
      .sort((a, b) => new Date(b.timestamp || 0) - new Date(a.timestamp || 0))
      .slice(0, 20);

    res.json({ success: true, user: safeUser, videos, logs });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// PUT /api/admin/users/:userId — Edit user settings fully
router.put('/users/:userId', adminAuth, async (req, res) => {
  try {
    const { userId } = req.params;
    const { displayName, settings, isActive, notes } = req.body;
    const db = getDb();

    const updateData = {
      updatedAt: new Date().toISOString(),
      updatedByAdmin: true
    };
    if (displayName !== undefined) updateData.displayName = displayName;
    if (isActive !== undefined) updateData.isActive = isActive;
    if (notes !== undefined) updateData.adminNotes = notes;
    if (settings) {
      // Merge settings carefully
      const userDoc = await db.collection('users').doc(userId).get();
      const existing = userDoc.exists ? (userDoc.data().settings || {}) : {};
      updateData.settings = { ...existing, ...settings };
    }

    await db.collection('users').doc(userId).update(updateData);
    res.json({ success: true, message: 'User updated successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:userId/reset-count — Reset today's upload count
router.post('/users/:userId/reset-count', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('users').doc(req.params.userId).update({
      todayVideos: 0,
      lastUploadDate: null,
      updatedAt: new Date().toISOString()
    });
    res.json({ success: true, message: "Today's upload count reset!" });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/admin/users/:userId/trigger — Force upload for one specific user
router.post('/users/:userId/trigger', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(req.params.userId).get();
    if (!userDoc.exists) return res.status(404).json({ success: false, error: 'User not found' });

    const user = { id: userDoc.id, ...userDoc.data() };
    if (!user.accessToken) {
      return res.status(400).json({ success: false, error: 'User has not connected YouTube yet' });
    }

    const scheduler = require('../services/scheduler');
    // Run async in background
    scheduler.autoCreateAndUpload(user).catch(e => console.error('Admin trigger error:', e.message));

    res.json({ success: true, message: `Upload triggered for ${user.displayName}! Check logs in a few minutes.` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/admin/system — Server & system info
router.get('/system', adminAuth, (req, res) => {
  const uptimeSecs = process.uptime();
  const hours = Math.floor(uptimeSecs / 3600);
  const mins = Math.floor((uptimeSecs % 3600) / 60);

  const memUsed = process.memoryUsage();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  res.json({
    success: true,
    system: {
      nodeVersion: process.version,
      platform: os.platform(),
      uptime: `${hours}h ${mins}m`,
      uptimeSecs: Math.floor(uptimeSecs),
      memory: {
        heapUsed: Math.round(memUsed.heapUsed / 1024 / 1024) + ' MB',
        heapTotal: Math.round(memUsed.heapTotal / 1024 / 1024) + ' MB',
        rss: Math.round(memUsed.rss / 1024 / 1024) + ' MB',
        systemTotal: Math.round(totalMem / 1024 / 1024) + ' MB',
        systemFree: Math.round(freeMem / 1024 / 1024) + ' MB',
        systemUsedPercent: Math.round(((totalMem - freeMem) / totalMem) * 100) + '%'
      },
      cpu: os.cpus()[0]?.model || 'Unknown',
      hostname: os.hostname(),
      env: process.env.NODE_ENV || 'development',
      port: process.env.PORT || 3000,
      baseUrl: process.env.BASE_URL || 'http://localhost:3000'
    }
  });
});

// DELETE /api/admin/videos/:videoId — Delete a video record
router.delete('/videos/:videoId', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    await db.collection('videos').doc(req.params.videoId).delete();
    res.json({ success: true, message: 'Video record deleted' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/admin/logs/clear — Clear all logs
router.delete('/logs/clear', adminAuth, async (req, res) => {
  try {
    const db = getDb();
    const snap = await db.collection('upload_logs').get();
    const batch = [];
    snap.docs.forEach(doc => batch.push(db.collection('upload_logs').doc(doc.id).delete()));
    await Promise.all(batch);
    res.json({ success: true, message: `Cleared ${snap.docs.length} log entries` });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.adminAuth = adminAuth;
