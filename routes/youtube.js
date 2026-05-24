const express = require('express');
const { google } = require('googleapis');
const { getDb, FieldValue } = require('../firebase-config');
const router = express.Router();

// Middleware to check authentication
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

// Get YouTube OAuth2 client with user tokens
function getOAuthClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
  );

  if (user.accessToken) {
    oauth2Client.setCredentials({
      access_token: user.accessToken,
      refresh_token: user.refreshToken
    });
  }

  return oauth2Client;
}

// GET /api/youtube/channel - Get channel info
router.get('/channel', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    
    if (!user.accessToken) {
      return res.json({ 
        success: false, 
        error: 'YouTube not connected',
        needsAuth: true 
      });
    }

    const oauth2Client = getOAuthClient(user);
    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const response = await youtube.channels.list({
      part: 'snippet,statistics',
      mine: true
    });

    if (response.data.items && response.data.items.length > 0) {
      const channel = response.data.items[0];
      const channelData = {
        id: channel.id,
        title: channel.snippet.title,
        description: channel.snippet.description,
        thumbnail: channel.snippet.thumbnails?.default?.url,
        subscriberCount: parseInt(channel.statistics.subscriberCount || 0),
        videoCount: parseInt(channel.statistics.videoCount || 0),
        viewCount: parseInt(channel.statistics.viewCount || 0)
      };

      // Cache channel info in Firestore
      const db = getDb();
      await db.collection('users').doc(user.uid).update({
        channelInfo: channelData,
        updatedAt: new Date().toISOString()
      });

      res.json({ success: true, channel: channelData });
    } else {
      res.json({ success: false, error: 'No YouTube channel found' });
    }
  } catch (error) {
    console.error('Channel fetch error:', error);
    if (error.code === 401 || error.message.includes('invalid_grant')) {
      return res.status(401).json({ 
        success: false, 
        error: 'Token expired. Please reconnect YouTube.',
        needsAuth: true 
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// POST /api/youtube/upload - Upload video to YouTube
router.post('/upload', requireAuth, async (req, res) => {
  try {
    const user = req.session.user;
    const { videoPath, thumbnailPath, title, description, tags, privacy, videoId } = req.body;

    if (!user.accessToken) {
      return res.status(401).json({ 
        success: false, 
        error: 'YouTube not connected',
        needsAuth: true 
      });
    }

    if (!videoPath) {
      return res.status(400).json({ success: false, error: 'Video path required' });
    }

    const fs = require('fs');
    const path = require('path');

    const fullVideoPath = path.join(__dirname, '..', videoPath);
    if (!fs.existsSync(fullVideoPath)) {
      return res.status(404).json({ success: false, error: 'Video file not found' });
    }

    const oauth2Client = getOAuthClient(user);
    
    // Auto-refresh token if needed
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.refresh_token) {
        const db = getDb();
        await db.collection('users').doc(user.uid).update({
          accessToken: tokens.access_token,
          refreshToken: tokens.refresh_token
        });
        req.session.user.accessToken = tokens.access_token;
        req.session.user.refreshToken = tokens.refresh_token;
      }
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    // Prepare video metadata
    const videoMetadata = {
      snippet: {
        title: title || 'Auto Generated Video',
        description: description || 'Created with YouTube Automation',
        tags: tags || ['entertainment', 'hindi', 'comedy', 'funny'],
        categoryId: '24', // Entertainment
        defaultLanguage: 'hi',
        defaultAudioLanguage: 'hi'
      },
      status: {
        privacyStatus: privacy || 'public',
        selfDeclaredMadeForKids: false
      }
    };

    console.log(`📤 Starting YouTube upload: ${title}`);

    // Upload video
    const uploadResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: videoMetadata,
      media: {
        body: fs.createReadStream(fullVideoPath)
      }
    });

    const youtubeVideoId = uploadResponse.data.id;
    console.log(`✅ Video uploaded to YouTube: ${youtubeVideoId}`);

    // Upload thumbnail if provided (requires 50+ subscribers)
    if (thumbnailPath) {
      const fullThumbnailPath = path.join(__dirname, '..', thumbnailPath);
      if (fs.existsSync(fullThumbnailPath)) {
        try {
          await youtube.thumbnails.set({
            videoId: youtubeVideoId,
            media: { body: fs.createReadStream(fullThumbnailPath) }
          });
          console.log('✅ Thumbnail uploaded');
        } catch (thumbError) {
          // Silently skip - channel needs 50+ subscribers for custom thumbnails
          console.log('ℹ️ Thumbnail skipped (need 50+ subscribers for custom thumbnails)');
        }
      }
    }

    // Update Firestore with YouTube video ID
    const db = getDb();
    if (videoId) {
      await db.collection('videos').doc(videoId).update({
        youtubeVideoId,
        youtubeUrl: `https://youtube.com/watch?v=${youtubeVideoId}`,
        status: 'uploaded',
        uploadedAt: new Date().toISOString()
      });
    }

    // Update user stats
    const today = new Date().toISOString().split('T')[0];
    const userRef = db.collection('users').doc(user.uid);
    const userDoc = await userRef.get();
    const userData = userDoc.data() || {};
    
    const lastUploadDate = userData.lastUploadDate;
    const todayCount = lastUploadDate === today ? (userData.todayVideos || 0) : 0;

    await userRef.update({
      totalVideos: (userData.totalVideos || 0) + 1,
      todayVideos: todayCount + 1,
      lastUploadDate: today,
      lastUploadAt: new Date().toISOString()
    });

    res.json({
      success: true,
      youtubeVideoId,
      youtubeUrl: `https://youtube.com/watch?v=${youtubeVideoId}`,
      message: 'Video uploaded to YouTube successfully!'
    });

  } catch (error) {
    console.error('YouTube upload error:', error);
    if (error.code === 401 || error.message?.includes('invalid_grant')) {
      return res.status(401).json({ 
        success: false, 
        error: 'YouTube token expired. Please reconnect.',
        needsAuth: true 
      });
    }
    res.status(500).json({ success: false, error: error.message });
  }
});

// GET /api/youtube/stats - Get upload stats
router.get('/stats', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = req.session.user;
    const today = new Date().toISOString().split('T')[0];

    const userDoc = await db.collection('users').doc(user.uid).get();
    const userData = userDoc.data() || {};

    // Calculate today's video count
    const todayVideos = userData.lastUploadDate === today ? (userData.todayVideos || 0) : 0;

    // Get recent videos
    let recentVideos = [];
    try {
      const videosSnapshot = await db.collection('videos')
        .where('userId', '==', user.uid)
        .orderBy('createdAt', 'desc')
        .limit(10)
        .get();
      
      recentVideos = videosSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
    } catch (err) {
      console.warn('Could not fetch recent videos:', err.message);
    }

    // Calculate next upload time
    const uploadTimes = userData.settings?.uploadTimes || ['10:00', '14:00', '19:00'];
    const nextUpload = getNextUploadTime(uploadTimes);

    res.json({
      success: true,
      stats: {
        todayVideos,
        totalVideos: userData.totalVideos || 0,
        lastUploadAt: userData.lastUploadAt || null,
        nextUploadAt: nextUpload,
        channelInfo: userData.channelInfo || null,
        recentVideos
      }
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Helper: Calculate next upload time
function getNextUploadTime(uploadTimes) {
  const now = new Date();
  const today = new Date();
  
  for (const timeStr of uploadTimes.sort()) {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const uploadTime = new Date(today);
    uploadTime.setHours(hours, minutes, 0, 0);
    
    if (uploadTime > now) {
      return uploadTime.toISOString();
    }
  }
  
  // Next upload is tomorrow at first scheduled time
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const [hours, minutes] = uploadTimes[0].split(':').map(Number);
  tomorrow.setHours(hours, minutes, 0, 0);
  return tomorrow.toISOString();
}

// GET /api/youtube/videos - Get user's YouTube videos
router.get('/videos', requireAuth, async (req, res) => {
  try {
    const db = getDb();
    const user = req.session.user;
    
    const videosSnapshot = await db.collection('videos')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const videos = videosSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    res.json({ success: true, videos });
  } catch (error) {
    console.error('Videos fetch error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

module.exports = router;
