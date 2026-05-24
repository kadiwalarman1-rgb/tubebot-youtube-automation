// Fix DNS for Windows (prevents ENOTFOUND errors)
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

require('dotenv').config();
const cron = require('node-cron');
const { getDb } = require('../firebase-config');
const videoCreator = require('./video-creator');

// Scheduled tasks storage
const scheduledTasks = {};
let isInitialized = false;

/**
 * Get all users with their upload settings
 */
async function getAllUsers() {
  try {
    const db = getDb();
    const usersSnapshot = await db.collection('users').get();
    return usersSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error fetching users:', error.message);
    return [];
  }
}

/**
 * Auto create and upload video for a user
 */
async function autoCreateAndUpload(user) {
  const userId = user.id || user.uid;
  const displayName = user.displayName || 'Unknown User';
  
  console.log(`🤖 Auto scheduler triggered for: ${displayName}`);

  try {
    // Check if user has YouTube connected
    if (!user.accessToken) {
      console.log(`⚠️ Skipping ${displayName} - YouTube not connected`);
      return;
    }

    // Check today's upload count
    const today = new Date().toISOString().split('T')[0];
    const maxDailyUploads = 3;
    const todayUploads = user.lastUploadDate === today ? (user.todayVideos || 0) : 0;

    if (todayUploads >= maxDailyUploads) {
      console.log(`⚠️ Skipping ${displayName} - Daily limit reached (${todayUploads}/${maxDailyUploads})`);
      return;
    }

    const db = getDb();

    // Create video record
    const videoRef = await db.collection('videos').add({
      userId,
      status: 'scheduled',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      scheduledUpload: true
    });

    const videoId = videoRef.id;
    console.log(`🎬 Creating video ${videoId} for ${displayName}`);

    // Create video
    const videoData = await videoCreator.createVideo(user, videoId);
    
    console.log(`📤 Uploading video to YouTube for ${displayName}`);

    // Upload to YouTube
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

    // Auto-refresh handler
    oauth2Client.on('tokens', async (tokens) => {
      if (tokens.access_token) {
        await db.collection('users').doc(userId).update({
          accessToken: tokens.access_token,
          ...(tokens.refresh_token && { refreshToken: tokens.refresh_token })
        });
      }
    });

    const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

    const fullVideoPath = path.join(__dirname, '..', videoData.videoPath);
    
    if (!fs.existsSync(fullVideoPath) || fs.statSync(fullVideoPath).size === 0) {
      throw new Error('Video file is empty or missing');
    }

    const uploadResponse = await youtube.videos.insert({
      part: 'snippet,status',
      requestBody: {
        snippet: {
          title: videoData.title.includes('#Shorts') ? videoData.title : `${videoData.title} #Shorts`,
          description: videoData.description + (videoData.description.includes('#Shorts') ? '' : '\n\n#Shorts'),
          tags: ['Shorts', ...(videoData.tags || [])],
          categoryId: '24', // Entertainment
          defaultLanguage: 'hi',
          defaultAudioLanguage: 'hi'
        },
        status: {
          privacyStatus: user.settings?.privacy || 'public',
          selfDeclaredMadeForKids: false
        }
      },
      media: {
        body: fs.createReadStream(fullVideoPath)
      }
    });

    const youtubeVideoId = uploadResponse.data.id;

    // Upload thumbnail (silently skip if no permission - needs 50+ subscribers)
    if (videoData.thumbnailPath) {
      const fullThumbPath = path.join(__dirname, '..', videoData.thumbnailPath);
      if (fs.existsSync(fullThumbPath) && fs.statSync(fullThumbPath).size > 0) {
        try {
          await youtube.thumbnails.set({
            videoId: youtubeVideoId,
            media: { body: fs.createReadStream(fullThumbPath) }
          });
          console.log('✅ Thumbnail uploaded');
        } catch (thumbErr) {
          console.log('ℹ️ Thumbnail skipped (needs 50+ subscribers)');
        }
      }
    }

    // Update video record
    await db.collection('videos').doc(videoId).update({
      youtubeVideoId,
      youtubeUrl: `https://youtube.com/watch?v=${youtubeVideoId}`,
      status: 'uploaded',
      uploadedAt: new Date().toISOString()
    });

    // Update user stats
    const updatedTodayCount = todayUploads + 1;
    await db.collection('users').doc(userId).update({
      totalVideos: (user.totalVideos || 0) + 1,
      todayVideos: updatedTodayCount,
      lastUploadDate: today,
      lastUploadAt: new Date().toISOString()
    });

    console.log(`✅ Auto upload successful for ${displayName}: https://youtube.com/watch?v=${youtubeVideoId}`);

    // Log upload event
    await db.collection('upload_logs').add({
      userId,
      videoId,
      youtubeVideoId,
      title: videoData.title,
      success: true,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Auto upload failed for ${displayName}:`, error.message);
    
    // Log failure
    try {
      const db = getDb();
      await db.collection('upload_logs').add({
        userId,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
    } catch (logError) {
      console.error('Failed to log error:', logError.message);
    }
  }
}

/**
 * Process all users for scheduled upload
 */
async function processScheduledUpload(scheduledTime) {
  console.log(`⏰ Scheduled upload triggered at ${scheduledTime}`);
  
  try {
    const users = await getAllUsers();
    
    if (users.length === 0) {
      console.log('No users found for scheduled upload');
      return;
    }

    // Process users with a delay between each to avoid rate limits
    for (const user of users) {
      const uploadTimes = user.settings?.uploadTimes || ['10:00', '14:00', '19:00'];
      
      if (uploadTimes.includes(scheduledTime)) {
        await autoCreateAndUpload(user);
        // Wait 30 seconds between users
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
    }
  } catch (error) {
    console.error('Scheduler error:', error.message);
  }
}

/**
 * Initialize the cron scheduler
 */
function initScheduler() {
  if (isInitialized) {
    console.log('Scheduler already initialized');
    return;
  }

  console.log('⏰ Initializing scheduler...');

  // 10:00 AM upload
  scheduledTasks['10:00'] = cron.schedule('0 10 * * *', () => {
    processScheduledUpload('10:00');
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  // 2:00 PM upload
  scheduledTasks['14:00'] = cron.schedule('0 14 * * *', () => {
    processScheduledUpload('14:00');
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  // 7:00 PM upload
  scheduledTasks['19:00'] = cron.schedule('0 19 * * *', () => {
    processScheduledUpload('19:00');
  }, {
    scheduled: true,
    timezone: 'Asia/Kolkata'
  });

  isInitialized = true;
  console.log('✅ Scheduler initialized: 10:00 AM, 2:00 PM, 7:00 PM IST daily');
}

/**
 * Get scheduler status
 */
function getSchedulerStatus() {
  const now = new Date();
  const times = ['10:00', '14:00', '19:00'];
  
  const nextUpload = times.reduce((next, timeStr) => {
    const [hours, minutes] = timeStr.split(':').map(Number);
    const uploadTime = new Date();
    uploadTime.setHours(hours, minutes, 0, 0);
    
    if (uploadTime <= now) {
      uploadTime.setDate(uploadTime.getDate() + 1);
    }
    
    return (!next || uploadTime < next) ? uploadTime : next;
  }, null);

  return {
    initialized: isInitialized,
    scheduledTimes: times,
    nextUpload: nextUpload?.toISOString() || null,
    activeTasks: Object.keys(scheduledTasks).length
  };
}

/**
 * Stop all scheduled tasks
 */
function stopScheduler() {
  Object.values(scheduledTasks).forEach(task => task.destroy());
  isInitialized = false;
  console.log('Scheduler stopped');
}

module.exports = {
  initScheduler,
  stopScheduler,
  getSchedulerStatus,
  processScheduledUpload,
  autoCreateAndUpload
};
