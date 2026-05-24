const express = require('express');
const { getDb, FieldValue } = require('../firebase-config');
const videoCreator = require('../services/video-creator');
const router = express.Router();

// Middleware: require auth
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

// POST /api/video/create - Create a new video
router.post('/create', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { topic, uploadAfter } = req.body;

    console.log(`🎬 Starting video creation for user: ${user.displayName}`);

    // Create video entry in Firestore
    const db = getDb();
    const videoRef = await db.collection('videos').add({
      userId: user.uid,
      status: 'creating',
      topic: topic || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    });

    const videoId = videoRef.id;

    // Start video creation asynchronously
    res.json({ 
      success: true, 
      videoId, 
      message: 'Video creation started!',
      status: 'creating'
    });

    // Create video in background
    setImmediate(async () => {
      try {
        const result = await videoCreator.createVideo(user, videoId, topic);
        
        console.log(`✅ Video created: ${videoId}`);
        
        // Auto upload if requested
        if (uploadAfter && user.accessToken) {
          await autoUploadVideo(user, result, videoId);
        }
      } catch (err) {
        console.error(`❌ Video creation failed for ${videoId}:`, err.message);
        const db = getDb();
        await db.collection('videos').doc(videoId).update({
          status: 'failed',
          error: err.message,
          updatedAt: new Date().toISOString()
        });
      }
    });

  } catch (error) {
    console.error('Create video error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Auto upload helper
async function autoUploadVideo(user, videoData, videoId) {
  try {
    const { google } = require('googleapis');
    const fs = require('fs');
    const path = require('path');

    const oauth2Client = new google.auth.OAuth2(
      process.env.YOUTUBE_CLIENT_ID,
      process.env.YOUTUBE_CLIENT_SECRET
    );
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });
    const fullVideoPath = path.join(__dirname, '..', videoData.videoPath);

    if (!fs.existsSync(fullVideoPath)) {
      throw new Error('Video file not found for upload');
    }

    const uploadResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: videoData.title,
          description: videoData.description,
          tags: videoData.tags,
          categoryId: '24',
          defaultLanguage: 'hi'
        },
        status: {
          privacyStatus: 'public',
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(fullVideoPath)
      }
    });

    const youtubeVideoId = uploadResponse.data.id;
    
    // Upload thumbnail
    if (videoData.thumbnailPath) {
      const fullThumbPath = path.join(__dirname, '..', videoData.thumbnailPath);
      if (fs.existsSync(fullThumbPath)) {
        await youtube.thumbnails.set({
          videoId: youtubeVideoId,
          media: { body: fs.createReadStream(fullThumbPath) }
        });
      }
    }

    // Update Firestore
    const db = getDb();
    await db.collection('videos').doc(videoId).update({
      youtubeVideoId,
      youtubeUrl: `https://youtube.com/watch?v=${youtubeVideoId}`,
      status: 'uploaded',
      uploadedAt: new Date().toISOString()
    });

    // Update user stats
    const today = new Date().toISOString().split('T')[0];
    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.data() || {};
    const todayCount = userData.lastUploadDate === today ? (userData.todayVideos || 0) : 0;

    await db.collection('users').doc(user.uid).update({
      totalVideos: (userData.totalVideos || 0) + 1,
      todayVideos: todayCount + 1,
      lastUploadDate: today,
      lastUploadAt: new Date().toISOString()
    });

    console.log(`🚀 Video auto-uploaded to YouTube: https://youtube.com/watch?v=${youtubeVideoId}`);
  } catch (error) {
    console.error('Auto upload error:', error.message);
    const db = getDb();
    await db.collection('videos').doc(videoId).update({
      status: 'created',
      uploadError: error.message
    });
  }
}

// GET /api/video/status/:videoId - Get video creation status
router.get('/status/:videoId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const videoDoc = await db.collection('videos').doc(req.params.videoId).get();
    
    if (!videoDoc.exists) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    res.json({ success: true, video: { id: videoDoc.id, ...videoDoc.data() } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/video/list - List all videos
router.get('/list', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = req.session.user;
    
    const snapshot = await db.collection('videos')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const videos = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ success: true, videos });
  } catch (error) {
    console.error('List videos error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/video/upload/:videoId - Manually trigger upload
router.post('/upload/:videoId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = req.session.user;
    const videoDoc = await db.collection('videos').doc(req.params.videoId).get();

    if (!videoDoc.exists) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const videoData = videoDoc.data();

    if (!user.accessToken) {
      return res.status(401).json({ 
        success: false, 
        error: 'YouTube not connected. Please login with Google first.',
        needsAuth: true 
      });
    }

    res.json({ success: true, message: 'Upload started...' });

    setImmediate(async () => {
      await autoUploadVideo(user, videoData, req.params.videoId);
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// DELETE /api/video/:videoId - Delete a video
router.delete('/:videoId', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const videoDoc = await db.collection('videos').doc(req.params.videoId).get();
    
    if (!videoDoc.exists) {
      return res.status(404).json({ success: false, error: 'Video not found' });
    }

    const videoData = videoDoc.data();
    
    // Delete local files
    const fs = require('fs');
    const path = require('path');
    
    if (videoData.videoPath) {
      const fullPath = path.join(__dirname, '..', videoData.videoPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    if (videoData.thumbnailPath) {
      const fullPath = path.join(__dirname, '..', videoData.thumbnailPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }
    if (videoData.audioPath) {
      const fullPath = path.join(__dirname, '..', videoData.audioPath);
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
    }

    await db.collection('videos').doc(req.params.videoId).delete();

    res.json({ success: true, message: 'Video deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
module.exports.autoUploadVideo = autoUploadVideo;
