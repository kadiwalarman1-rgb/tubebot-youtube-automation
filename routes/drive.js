// Fix DNS for Windows
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const express = require('express');
const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const driveService = require('../services/drive-service');

// Auth middleware
function requireAuth(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ success: false, error: 'Authentication required' });
  }
  next();
}

// Active import jobs (in-memory)
const importJobs = {};

/**
 * POST /api/drive/scan
 * Scan a Drive URL and return list of videos/photos found
 */
router.post('/scan', requireAuth, async (req, res) => {
  try {
    const { driveUrl } = req.body;
    const user = req.session.user;

    if (!driveUrl) {
      return res.status(400).json({ success: false, error: 'Drive URL is required' });
    }

    if (!user.accessToken) {
      return res.status(401).json({
        success: false,
        error: 'Please re-login to grant Google Drive access',
        needsReauth: true
      });
    }

    console.log(`🔍 Scanning Drive URL: ${driveUrl}`);
    const result = await driveService.scanDriveUrl(user, driveUrl);

    res.json({
      success: true,
      ...result,
      summary: {
        videosFound: result.videos.length,
        photosSkipped: result.photos.length,
        othersSkipped: result.others.length,
        total: result.total
      }
    });

  } catch (error) {
    console.error('Drive scan error:', error.message);

    if (error.message.includes('insufficientPermissions') || error.code === 403) {
      return res.status(403).json({
        success: false,
        error: 'Drive access not granted. Please re-login and allow Google Drive access.',
        needsReauth: true
      });
    }

    if (error.message.includes('notFound') || error.code === 404) {
      return res.status(404).json({
        success: false,
        error: 'File or folder not found. Make sure the link is correct and shared with you.'
      });
    }

    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/drive/import
 * Start importing and uploading videos from a Drive URL
 * Returns a jobId to track progress
 */
router.post('/import', requireAuth, async (req, res) => {
  try {
    const { driveUrl, privacy = 'public' } = req.body;
    const user = req.session.user;

    if (!driveUrl) {
      return res.status(400).json({ success: false, error: 'Drive URL is required' });
    }

    // Create a job ID for tracking
    const jobId = `drive_job_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    importJobs[jobId] = {
      jobId,
      status: 'scanning',
      driveUrl,
      userId: user.uid,
      createdAt: new Date().toISOString(),
      progress: { current: 0, total: 0, percent: 0 },
      results: [],
      logs: ['🔍 Scanning Drive URL...']
    };

    // Send jobId immediately so client can poll
    res.json({ success: true, jobId });

    // Run import in background (non-blocking)
    runImportJob(jobId, user, driveUrl, privacy).catch(err => {
      importJobs[jobId].status = 'failed';
      importJobs[jobId].error = err.message;
      importJobs[jobId].logs.push(`❌ Fatal error: ${err.message}`);
    });

  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Background import job runner
 */
async function runImportJob(jobId, user, driveUrl, privacy) {
  const job = importJobs[jobId];
  const log = (msg) => {
    console.log(msg);
    job.logs.push(msg);
  };

  try {
    // Step 1: Scan
    job.status = 'scanning';
    const scanResult = await driveService.scanDriveUrl(user, driveUrl);

    const videos = scanResult.videos;
    const photosSkipped = scanResult.photos.length;
    const othersSkipped = scanResult.others.length;

    log(`✅ Scan complete: ${videos.length} videos found`);
    if (photosSkipped > 0) log(`📸 ${photosSkipped} photo(s) automatically skipped`);
    if (othersSkipped > 0) log(`📄 ${othersSkipped} other file(s) skipped`);

    if (videos.length === 0) {
      job.status = 'done';
      job.progress = { current: 0, total: 0, percent: 100 };
      log('⚠️ No videos found in the provided link.');
      return;
    }

    job.progress.total = videos.length;
    job.status = 'importing';

    // Step 2: Download and upload each video
    for (let i = 0; i < videos.length; i++) {
      const video = videos[i];
      job.progress.current = i + 1;
      job.progress.percent = Math.round(((i) / videos.length) * 100);

      log(`\n📥 [${i + 1}/${videos.length}] Processing: ${video.name}`);

      let localPath = null;
      try {
        // Download from Drive
        log(`⬇️ Downloading ${video.name}...`);
        localPath = await driveService.downloadVideo(user, video.id, video.name);
        log(`✅ Downloaded: ${video.name}`);

        // Upload to YouTube using Drive API client
        const oauth2Client = new google.auth.OAuth2(
          process.env.YOUTUBE_CLIENT_ID,
          process.env.YOUTUBE_CLIENT_SECRET,
          `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
        );
        oauth2Client.setCredentials({
          access_token: user.accessToken,
          refresh_token: user.refreshToken
        });

        // Auto-refresh tokens
        oauth2Client.on('tokens', (tokens) => {
          if (tokens.access_token) {
            user.accessToken = tokens.access_token;
          }
        });

        const youtube = google.youtube({ version: 'v3', auth: oauth2Client });

        // Generate AI title from filename
        const videoName = path.parse(video.name).name.replace(/[_-]/g, ' ');
        const aiTitle = `${videoName} #Shorts`;
        const aiDescription = `${videoName}\n\nAuto-uploaded by TubeBot AI 🤖\n\n#Shorts #Hindi #Viral #Entertainment`;
        const aiTags = ['Shorts', 'Hindi', 'Viral', 'Entertainment', 'India', 'Trending'];

        log(`📤 Uploading to YouTube: ${aiTitle}`);

        const uploadResponse = await youtube.videos.insert({
          part: 'snippet,status',
          requestBody: {
            snippet: {
              title: aiTitle.substring(0, 100),
              description: aiDescription,
              tags: aiTags,
              categoryId: '24',
              defaultLanguage: 'hi',
              defaultAudioLanguage: 'hi'
            },
            status: {
              privacyStatus: privacy || 'public',
              selfDeclaredMadeForKids: false
            }
          },
          media: {
            body: fs.createReadStream(localPath)
          }
        });

        const ytId = uploadResponse.data.id;
        const ytUrl = `https://youtube.com/shorts/${ytId}`;

        log(`✅ Uploaded! ${ytUrl}`);

        job.results.push({
          fileName: video.name,
          youtubeId: ytId,
          youtubeUrl: ytUrl,
          status: 'uploaded'
        });

      } catch (videoError) {
        log(`❌ Failed to process ${video.name}: ${videoError.message}`);
        job.results.push({
          fileName: video.name,
          status: 'failed',
          error: videoError.message
        });
      } finally {
        // Cleanup downloaded file
        if (localPath) driveService.cleanupFile(localPath);
      }

      // Small delay between uploads to avoid rate limits
      if (i < videos.length - 1) {
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    job.progress.percent = 100;
    job.status = 'done';
    log(`\n🎉 Import complete! ${job.results.filter(r => r.status === 'uploaded').length}/${videos.length} videos uploaded.`);

  } catch (error) {
    job.status = 'failed';
    job.error = error.message;
    log(`❌ Import failed: ${error.message}`);
    throw error;
  }
}

/**
 * GET /api/drive/status/:jobId
 * Poll job progress
 */
router.get('/status/:jobId', requireAuth, (req, res) => {
  const job = importJobs[req.params.jobId];

  if (!job) {
    return res.status(404).json({ success: false, error: 'Job not found' });
  }

  res.json({
    success: true,
    jobId: job.jobId,
    status: job.status,
    progress: job.progress,
    results: job.results,
    logs: job.logs.slice(-20), // last 20 log lines
    error: job.error || null
  });
});

/**
 * GET /api/drive/jobs
 * List recent import jobs for this user
 */
router.get('/jobs', requireAuth, (req, res) => {
  const userJobs = Object.values(importJobs)
    .filter(j => j.userId === req.session.user.uid)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 10);

  res.json({ success: true, jobs: userJobs });
});

module.exports = router;
