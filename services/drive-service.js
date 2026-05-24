// Fix DNS for Windows
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const https = require('https');

// Storage for downloaded Drive videos
const DRIVE_IMPORT_DIR = path.join(__dirname, '..', 'storage', 'drive-imports');
if (!fs.existsSync(DRIVE_IMPORT_DIR)) {
  fs.mkdirSync(DRIVE_IMPORT_DIR, { recursive: true });
}

// Video file extensions to ACCEPT
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.flv', '.wmv']);

// Photo/image extensions to IGNORE
const PHOTO_EXTENSIONS = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.heic', '.heif',
  '.tiff', '.tif', '.svg', '.raw', '.cr2', '.nef', '.arw'
]);

// Document/other extensions to IGNORE
const IGNORE_EXTENSIONS = new Set([
  '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx',
  '.txt', '.zip', '.rar', '.7z', '.apk', '.exe'
]);

/**
 * Parse Google Drive URL → extract file or folder ID + type
 * Supports:
 *   - File:   drive.google.com/file/d/FILE_ID/view
 *   - Folder: drive.google.com/drive/folders/FOLDER_ID
 *   - Open:   drive.google.com/open?id=ID
 */
function parseDriveUrl(url) {
  try {
    const urlObj = new URL(url.trim());

    // Folder URL: /drive/folders/FOLDER_ID or /drive/u/0/folders/FOLDER_ID
    const folderMatch = urlObj.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    if (folderMatch) {
      return { type: 'folder', id: folderMatch[1] };
    }

    // File URL: /file/d/FILE_ID/view
    const fileMatch = urlObj.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    if (fileMatch) {
      return { type: 'file', id: fileMatch[1] };
    }

    // Open URL: ?id=ID
    const openId = urlObj.searchParams.get('id');
    if (openId) {
      return { type: 'file', id: openId }; // assume file, will verify via API
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Get OAuth2 client with user's tokens
 */
function getOAuthClient(user) {
  const oauth2Client = new google.auth.OAuth2(
    process.env.YOUTUBE_CLIENT_ID,
    process.env.YOUTUBE_CLIENT_SECRET,
    `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`
  );
  oauth2Client.setCredentials({
    access_token: user.accessToken,
    refresh_token: user.refreshToken
  });
  return oauth2Client;
}

/**
 * Classify a file by its name/mimetype
 * Returns: 'video', 'photo', 'other'
 */
function classifyFile(file) {
  const name = (file.name || '').toLowerCase();
  const mime = (file.mimeType || '').toLowerCase();
  const ext = path.extname(name);

  if (mime.startsWith('video/') || VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (mime.startsWith('image/') || PHOTO_EXTENSIONS.has(ext)) return 'photo';
  return 'other';
}

/**
 * List all files in a Google Drive folder
 * Returns classified list of files
 */
async function listFolderContents(user, folderId) {
  const auth = getOAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  const allFiles = [];
  let pageToken = null;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      pageSize: 100,
      pageToken: pageToken || undefined
    });

    allFiles.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  // Classify files
  const videos = [];
  const photos = [];
  const others = [];

  for (const file of allFiles) {
    const type = classifyFile(file);
    if (type === 'video') videos.push({ ...file, fileType: 'video' });
    else if (type === 'photo') photos.push({ ...file, fileType: 'photo' });
    else others.push({ ...file, fileType: 'other' });
  }

  return { videos, photos, others, total: allFiles.length };
}

/**
 * Get info about a single Drive file
 */
async function getFileInfo(user, fileId) {
  const auth = getOAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  const response = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, modifiedTime'
  });

  const file = response.data;
  const fileType = classifyFile(file);
  return { ...file, fileType };
}

/**
 * Download a single file from Google Drive
 * Returns local file path
 */
async function downloadFile(user, fileId, fileName) {
  const auth = getOAuthClient(user);
  const drive = google.drive({ version: 'v3', auth });

  // Clean filename for local storage
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const localPath = path.join(DRIVE_IMPORT_DIR, `${Date.now()}_${safeName}`);

  console.log(`📥 Downloading from Drive: ${fileName}`);

  const response = await drive.files.get(
    { fileId, alt: 'media' },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    const dest = fs.createWriteStream(localPath);
    let downloadedBytes = 0;

    response.data
      .on('data', (chunk) => {
        downloadedBytes += chunk.length;
        process.stdout.write(`\r📥 ${fileName}: ${(downloadedBytes / 1024 / 1024).toFixed(1)} MB`);
      })
      .on('end', () => {
        console.log(`\n✅ Downloaded: ${fileName} (${(downloadedBytes / 1024 / 1024).toFixed(1)} MB)`);
        resolve(localPath);
      })
      .on('error', (err) => {
        fs.unlink(localPath, () => {}); // cleanup partial
        reject(err);
      })
      .pipe(dest);
  });
}

/**
 * Main: Scan a Drive URL and return file info without downloading
 */
async function scanDriveUrl(user, driveUrl) {
  const parsed = parseDriveUrl(driveUrl);

  if (!parsed) {
    throw new Error('Invalid Google Drive URL. Please paste a valid Drive folder or file link.');
  }

  if (parsed.type === 'folder') {
    const contents = await listFolderContents(user, parsed.id);
    return {
      type: 'folder',
      folderId: parsed.id,
      ...contents
    };
  } else {
    // Single file
    const fileInfo = await getFileInfo(user, parsed.id);
    if (fileInfo.fileType !== 'video') {
      return {
        type: 'file',
        fileId: parsed.id,
        videos: [],
        photos: fileInfo.fileType === 'photo' ? [fileInfo] : [],
        others: fileInfo.fileType === 'other' ? [fileInfo] : [],
        total: 1,
        message: `This file is a ${fileInfo.fileType}, not a video. Only video files can be uploaded.`
      };
    }
    return {
      type: 'file',
      fileId: parsed.id,
      videos: [fileInfo],
      photos: [],
      others: [],
      total: 1
    };
  }
}

/**
 * Download a video and return the local path
 */
async function downloadVideo(user, fileId, fileName) {
  return await downloadFile(user, fileId, fileName);
}

/**
 * Clean up downloaded file after processing
 */
function cleanupFile(localPath) {
  try {
    if (fs.existsSync(localPath)) {
      fs.unlinkSync(localPath);
      console.log(`🗑️ Cleaned up: ${path.basename(localPath)}`);
    }
  } catch (e) {
    console.warn('Cleanup warning:', e.message);
  }
}

module.exports = {
  parseDriveUrl,
  scanDriveUrl,
  downloadVideo,
  cleanupFile,
  classifyFile,
  VIDEO_EXTENSIONS,
  PHOTO_EXTENSIONS,
  DRIVE_IMPORT_DIR
};
