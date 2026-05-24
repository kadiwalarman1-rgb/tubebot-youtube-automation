require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { exec, execSync } = require('child_process');
const { promisify } = require('util');
const { v7: uuidv7 } = require('uuid');
const { getDb } = require('../firebase-config');
const groqService = require('./groq');

const execAsync = promisify(exec);

// Storage paths
const STORAGE_BASE = path.join(__dirname, '..', 'storage');
const VIDEO_DIR = path.join(STORAGE_BASE, 'videos');
const AUDIO_DIR = path.join(STORAGE_BASE, 'audio');
const THUMBNAIL_DIR = path.join(STORAGE_BASE, 'thumbnails');

// Ensure directories exist
[VIDEO_DIR, AUDIO_DIR, THUMBNAIL_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// FFmpeg path (detected once at startup)
let FFMPEG_PATH = null;

/**
 * Find and cache FFmpeg path (checks Windows common locations)
 */
function checkFFmpeg() {
  if (FFMPEG_PATH) return FFMPEG_PATH;
  
  const candidates = [
    'ffmpeg',                                    // In PATH
    'C:\\ProgramData\\chocolatey\\bin\\ffmpeg.exe', // Chocolatey
    'C:\\ffmpeg\\bin\\ffmpeg.exe',                 // Manual install
    'C:\\MinGW\\bin\\ffmpeg.exe',                  // MinGW
    'C:\\Program Files\\ffmpeg\\bin\\ffmpeg.exe',
    'C:\\Program Files (x86)\\ffmpeg\\bin\\ffmpeg.exe',
    '/usr/bin/ffmpeg',                            // Linux/Mac
    '/usr/local/bin/ffmpeg'
  ];

  for (const candidate of candidates) {
    try {
      execSync(`"${candidate}" -version`, { stdio: 'ignore' });
      FFMPEG_PATH = candidate;
      console.log(`✅ FFmpeg found at: ${candidate}`);
      return FFMPEG_PATH;
    } catch {}
  }
  
  console.warn('⚠️ FFmpeg not found on this system.');
  return null;
}

/**
 * Check if Python/gTTS is available
 */
async function checkGTTS() {
  const pythonPaths = ['python', 'python3', 'D:\\python\\python.exe', '/usr/bin/python3'];
  for (const pyPath of pythonPaths) {
    try {
      await execAsync(`"${pyPath}" -c "import gtts; print('ok')"`);
      return pyPath;
    } catch {}
  }
  console.warn('⚠️ gTTS not available. Audio creation will use fallback mode.');
  return null;
}

/**
 * Generate Hindi audio using gTTS
 */
async function generateAudio(script, audioId) {
  const audioPath = path.join(AUDIO_DIR, `${audioId}.mp3`);
  
  // Try gTTS with auto-detected python
  const pythonPath = await checkGTTS();
  
  if (pythonPath) {
    try {
      // Write script to temp file to avoid shell quoting issues
      const tmpScript = path.join(AUDIO_DIR, `${audioId}_script.txt`);
      const cleanScript = script.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, ' ').trim();
      fs.writeFileSync(tmpScript, cleanScript, 'utf8');

      const pyCode = [
        'from gtts import gTTS',
        `with open(r'${tmpScript.replace(/\\/g, '/')}', encoding='utf-8') as f:`,
        '    text = f.read()',
        `tts = gTTS(text=text, lang='hi', slow=False)`,
        `tts.save(r'${audioPath.replace(/\\/g, '/')}')`,
        `print('ok')`
      ].join('\n');

      const pyFile = path.join(AUDIO_DIR, `${audioId}_gen.py`);
      fs.writeFileSync(pyFile, pyCode, 'utf8');

      await execAsync(`"${pythonPath}" "${pyFile}"`, { timeout: 60000 });
      
      // Cleanup temp files
      [tmpScript, pyFile].forEach(f => { try { fs.unlinkSync(f); } catch {} });

      console.log('✅ Hindi audio generated with gTTS');
      return audioPath;
    } catch (err) {
      console.warn('gTTS failed:', err.message);
    }
  }

  // Fallback: Create silent audio with FFmpeg
  const ffmpegPath = checkFFmpeg();
  if (ffmpegPath) {
    try {
      const duration = Math.max(30, script.split(' ').length * 0.4);
      await execAsync(`"${ffmpegPath}" -f lavfi -i anullsrc=r=22050:cl=mono -t ${duration} -q:a 9 -acodec libmp3lame "${audioPath}" -y`, { timeout: 60000 });
      console.log('✅ Silent audio fallback created');
      return audioPath;
    } catch (err) {
      console.warn('FFmpeg audio failed:', err.message);
    }
  }

  // Minimal MP3 stub as last resort
  console.log('⚠️ Using minimal audio fallback');
  const silentMp3 = Buffer.from([
    0xFF, 0xFB, 0x90, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
  ]);
  fs.writeFileSync(audioPath, silentMp3);
  return audioPath;
}

/**
 * Create thumbnail using Jimp (pure JS, no native build needed)
 */
async function createThumbnail(thumbnailText, thumbnailSubtext, thumbnailId) {
  const thumbnailPath = path.join(THUMBNAIL_DIR, `${thumbnailId}.jpg`);

  try {
    const Jimp = require('jimp');
    const width = 1280;
    const height = 720;

    // Create dark background image
    const img = new Jimp(width, height, 0x0a0a0fff); // #0a0a0f

    // Helper: fill rectangle with color
    function fillRect(image, x, y, w, h, hex) {
      for (let py = y; py < y + h && py < height; py++) {
        for (let px = x; px < x + w && px < width; px++) {
          image.setPixelColor(Jimp.cssColorToHex(hex), px, py);
        }
      }
    }

    // Dark background gradient (simulate with color blocks)
    for (let py = 0; py < height; py++) {
      const ratio = py / height;
      const r = Math.floor(10 + ratio * 16);
      const g = Math.floor(10 + ratio * 2);
      const b = Math.floor(15 + ratio * 10);
      const color = Jimp.rgbaToInt(r, g, b, 255);
      for (let px = 0; px < width; px++) {
        img.setPixelColor(color, px, py);
      }
    }

    // Red left accent bar (20px wide)
    for (let py = 0; py < height; py++) {
      const ratio = py / height;
      const r = Math.floor(255 - ratio * 51);
      const color = Jimp.rgbaToInt(r, 0, 0, 255);
      for (let px = 0; px < 20; px++) {
        img.setPixelColor(color, px, py);
      }
    }

    // Red top bar (8px)
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < width; px++) {
        img.setPixelColor(Jimp.rgbaToInt(255, 45, 45, 255), px, py);
      }
    }

    // Red bottom bar (70px)
    for (let py = height - 70; py < height; py++) {
      for (let px = 0; px < width; px++) {
        img.setPixelColor(Jimp.rgbaToInt(220, 30, 30, 245), px, py);
      }
    }

    // Add text using Jimp font
    const fontLarge = await Jimp.loadFont(Jimp.FONT_SANS_64_WHITE);
    const fontMedium = await Jimp.loadFont(Jimp.FONT_SANS_32_WHITE);
    const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_16_WHITE);

    // Main title (centered)
    const mainTitle = thumbnailText.toUpperCase().substring(0, 28);
    const titleWidth = Jimp.measureText(fontLarge, mainTitle);
    const titleX = Math.max(30, (width - titleWidth) / 2);
    img.print(fontLarge, titleX, height / 2 - 80, mainTitle);

    // Subtitle
    if (thumbnailSubtext) {
      const subWidth = Jimp.measureText(fontMedium, thumbnailSubtext);
      const subX = Math.max(30, (width - subWidth) / 2);
      img.print(fontMedium, subX, height / 2 + 20, thumbnailSubtext);
    }

    // Bottom bar text
    const bottomText = 'SUBSCRIBE  •  LIKE  •  SHARE';
    const botWidth = Jimp.measureText(fontMedium, bottomText);
    const botX = Math.max(30, (width - botWidth) / 2);
    img.print(fontMedium, botX, height - 50, bottomText);

    // Save as JPEG
    await img.quality(92).writeAsync(thumbnailPath);
    console.log('✅ Thumbnail created with Jimp');
    return thumbnailPath;

  } catch (jimpError) {
    console.warn('Jimp thumbnail failed, using SVG fallback:', jimpError.message);

    // SVG fallback — always works, no dependencies
    const svgPath = thumbnailPath.replace(/\.jpg$/, '.svg');
    
    const width = 1280;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Dark gradient background
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#0a0a0f');
    gradient.addColorStop(0.5, '#1a0a1a');
    gradient.addColorStop(1, '#0f0a1f');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Red accent bar on left
    const barGrad = ctx.createLinearGradient(0, 0, 0, height);
    barGrad.addColorStop(0, '#ff2d2d');
    barGrad.addColorStop(1, '#cc0000');
    ctx.fillStyle = barGrad;
    ctx.fillRect(0, 0, 20, height);

    // Decorative red glow effect
    const glowGrad = ctx.createRadialGradient(100, height / 2, 0, 100, height / 2, 300);
    glowGrad.addColorStop(0, 'rgba(255, 45, 45, 0.15)');
    glowGrad.addColorStop(1, 'rgba(255, 45, 45, 0)');
    ctx.fillStyle = glowGrad;
    ctx.fillRect(0, 0, width, height);

    // Grid pattern overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.03)';
    ctx.lineWidth = 1;
    for (let x = 40; x < width; x += 80) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 40; y < height; y += 80) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // YouTube-style red banner at top
    ctx.fillStyle = '#ff2d2d';
    ctx.fillRect(0, 0, width, 8);

    // Emoji decoration
    ctx.font = 'bold 120px Arial';
    ctx.fillStyle = 'rgba(255, 200, 0, 0.15)';
    ctx.fillText('😂', width - 200, 200);
    ctx.fillText('🎬', 50, 600);

    // Main title text
    const mainText = thumbnailText.toUpperCase();
    const fontSize = mainText.length > 20 ? 72 : mainText.length > 15 ? 90 : 110;
    
    ctx.font = `bold ${fontSize}px Arial`;
    ctx.textAlign = 'center';
    
    // Text shadow
    ctx.shadowColor = '#ff2d2d';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#FFD700';
    
    // Word wrap
    const words = mainText.split(' ');
    let lines = [];
    let currentLine = '';
    const maxWidth = width - 120;
    
    for (const word of words) {
      const testLine = currentLine ? `${currentLine} ${word}` : word;
      const metrics = ctx.measureText(testLine);
      if (metrics.width > maxWidth && currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        currentLine = testLine;
      }
    }
    if (currentLine) lines.push(currentLine);
    
    const lineHeight = fontSize * 1.2;
    const totalHeight = lines.length * lineHeight;
    let startY = (height / 2) - (totalHeight / 2) + fontSize / 2;
    if (thumbnailSubtext) startY -= 50;
    
    lines.forEach((line, i) => {
      ctx.fillText(line, width / 2, startY + i * lineHeight);
    });

    // Subtitle text
    if (thumbnailSubtext) {
      ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
      ctx.shadowBlur = 15;
      ctx.font = 'bold 52px Arial';
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(thumbnailSubtext, width / 2, startY + lines.length * lineHeight + 30);
    }

    // Bottom bar
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 45, 45, 0.9)';
    ctx.fillRect(0, height - 70, width, 70);
    
    ctx.font = 'bold 32px Arial';
    ctx.fillStyle = '#FFFFFF';
    ctx.textAlign = 'center';
    ctx.fillText('🔔 SUBSCRIBE • LIKE • SHARE', width / 2, height - 25);

    // Save thumbnail
    const buffer = canvas.toBuffer('image/jpeg', { quality: 0.95 });
    fs.writeFileSync(thumbnailPath, buffer);
    
    console.log('✅ Thumbnail created with Canvas');
    return thumbnailPath;
    
    const svgContent = `<svg width="1280" height="720" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" style="stop-color:#0a0a0f"/>
          <stop offset="100%" style="stop-color:#1a0a1a"/>
        </linearGradient>
      </defs>
      <rect width="1280" height="720" fill="url(#bg)"/>
      <rect width="20" height="720" fill="#ff2d2d"/>
      <rect width="1280" height="8" fill="#ff2d2d"/>
      <rect y="280" width="1280" height="12" fill="rgba(255,45,45,0.3)"/>
      <text x="640" y="260" font-family="Arial Black,Arial" font-size="96" font-weight="900" fill="#FFD700" text-anchor="middle">${thumbnailText.substring(0, 22).toUpperCase()}</text>
      <text x="640" y="380" font-family="Arial" font-size="48" font-weight="bold" fill="white" text-anchor="middle">${thumbnailSubtext}</text>
      <text x="640" y="460" font-family="Arial" font-size="36" fill="rgba(255,255,255,0.6)" text-anchor="middle">Hindi Entertainment</text>
      <rect y="650" width="1280" height="70" fill="#cc2222"/>
      <text x="640" y="695" font-family="Arial" font-size="28" font-weight="bold" fill="white" text-anchor="middle">&#128276; SUBSCRIBE  •  LIKE  •  SHARE</text>
    </svg>`;
    fs.writeFileSync(svgPath, svgContent, 'utf8');
    console.log('✅ SVG thumbnail created as fallback');
    return svgPath;
  }
}

/**
 * Create YouTube SHORT video using FFmpeg
 * Format: 1080x1920 vertical, max 55 seconds
 * FIX: Proper filter_complex with [vout] label + -map "[vout]" to avoid black screen
 */
async function createVideoWithFFmpeg(videoId, displayTexts, audioPath, title) {
  const videoPath = path.join(VIDEO_DIR, `${videoId}.mp4`);
  const ffmpegPath = checkFFmpeg();

  if (!ffmpegPath) {
    console.warn('⚠️ FFmpeg not available, creating placeholder');
    fs.writeFileSync(videoPath, Buffer.alloc(1024));
    return videoPath;
  }

  // Get audio duration, cap at 55s for YouTube Shorts
  let audioDuration = 45;
  try {
    const probeResult = await execAsync(
      `"${ffmpegPath}" -i "${audioPath}" 2>&1`
    ).catch(e => ({ stdout: (e.stdout || '') + (e.stderr || '') }));
    const match = (probeResult.stdout || '').match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (match) {
      const secs = parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseFloat(match[3]);
      if (secs > 0) audioDuration = Math.min(Math.ceil(secs), 55);
    }
  } catch {}

  console.log(`🎬 Video duration: ${audioDuration}s`);

  // Safe escape for FFmpeg drawtext — NO quotes, colons, brackets inside text
  const esc = (t) => String(t || '')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/\\/g, '/')
    .replace(/'/g, '\u2019')   // curly apostrophe - safe
    .replace(/[:"[\],;=@]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 38);

  const safeTitle = esc(title) || 'TubeBot Short';
  const segDur = Math.max(3, Math.floor(audioDuration / Math.max(displayTexts.length, 1)));

  // Per-segment drawtext filters (content lines, shown one by one)
  const segTexts = displayTexts.slice(0, 8).map((text, i) => {
    const t0 = i * segDur;
    const t1 = Math.min((i + 1) * segDur, audioDuration);
    const safe = esc(text);
    return `drawtext=fontsize=46:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2+50:`
         + `text='${safe}':enable='between(t\\,${t0}\\,${t1})':`
         + `shadowcolor=black:shadowx=3:shadowy=3:box=1:boxcolor=black@0.55:boxborderw=16`;
  });

  // Static overlay elements
  const staticFilters = [
    // Dark purple-blue animated background strips (decorative, using drawbox)
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x1a1040@0.0:t=fill`,           // base (no-op, bg comes from lavfi)
    // Top red bar
    `drawbox=x=0:y=0:w=iw:h=82:color=0xff2d2d@0.95:t=fill`,
    // Bottom red bar
    `drawbox=x=0:y=ih-105:w=iw:h=105:color=0xcc0000@0.95:t=fill`,
    // Left accent stripe
    `drawbox=x=0:y=82:w=8:h=ih-187:color=0xff5555@0.5:t=fill`,
    // Right accent stripe
    `drawbox=x=iw-8:y=82:w=8:h=ih-187:color=0xff5555@0.5:t=fill`,
    // Brand name top
    `drawtext=fontsize=36:fontcolor=white:x=(w-text_w)/2:y=20:text='▶ TubeBot AI':shadowcolor=black:shadowx=2:shadowy=2`,
    // Title below top bar (gold)
    `drawtext=fontsize=44:fontcolor=0xFFD700:x=(w-text_w)/2:y=100:text='${safeTitle}':shadowcolor=black:shadowx=3:shadowy=3:box=1:boxcolor=black@0.35:boxborderw=12`,
    // CTA bottom
    `drawtext=fontsize=36:fontcolor=white:x=(w-text_w)/2:y=ih-68:text='SUBSCRIBE and LIKE':shadowcolor=black:shadowx=2:shadowy=2`,
  ];

  const allFilters = [...staticFilters, ...segTexts].join(',');

  // ── Method 1: Full animated video with text overlays ──
  // Key fix: use -map "[vout]" not -map 0:v after filter_complex
  const cmd1 = [
    `"${ffmpegPath}" -y`,
    `-f lavfi -i "color=c=0x1a1040:size=1080x1920:rate=25"`,
    `-i "${audioPath}"`,
    `-filter_complex "[0:v]${allFilters}[vout]"`,
    `-map "[vout]" -map 1:a`,
    `-c:v libx264 -preset fast -crf 22`,
    `-c:a aac -b:a 128k`,
    `-t ${audioDuration}`,
    `-movflags +faststart`,
    `-pix_fmt yuv420p`,
    `"${videoPath}"`
  ].join(' ');

  try {
    console.log('🎬 Creating Short (Method 1: Full animated)...');
    await execAsync(cmd1, { timeout: 300000 });
    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 50000) {
      console.log(`✅ Short created! Size: ${Math.round(fs.statSync(videoPath).size / 1024)}KB, Duration: ${audioDuration}s`);
      return videoPath;
    }
    throw new Error('Output too small or missing');
  } catch (err1) {
    console.warn('⚠️ Method 1 failed:', err1.message.substring(0, 120));
  }

  // ── Method 2: Simple color + audio, no text (always works if FFmpeg exists) ──
  const cmd2 = [
    `"${ffmpegPath}" -y`,
    `-f lavfi -i "color=c=0x0d0d2b:size=1080x1920:rate=25"`,
    `-i "${audioPath}"`,
    `-filter_complex "[0:v]drawbox=x=0:y=0:w=iw:h=80:color=0xff2d2d@0.9:t=fill,drawtext=fontsize=50:fontcolor=0xFFD700:x=(w-text_w)/2:y=240:text='${safeTitle}':shadowcolor=black:shadowx=3:shadowy=3[vout]"`,
    `-map "[vout]" -map 1:a`,
    `-c:v libx264 -preset ultrafast -crf 26`,
    `-c:a aac -b:a 96k`,
    `-t ${audioDuration}`,
    `-movflags +faststart`,
    `-pix_fmt yuv420p`,
    `"${videoPath}"`
  ].join(' ');

  try {
    console.log('🎬 Creating Short (Method 2: Simple)...');
    await execAsync(cmd2, { timeout: 180000 });
    if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 5000) {
      console.log('✅ Short created (Method 2)');
      return videoPath;
    }
  } catch (err2) {
    console.warn('⚠️ Method 2 failed:', err2.message.substring(0, 80));
  }

  // ── Method 3: Bare minimum — just color + audio, no filters ──
  const cmd3 = [
    `"${ffmpegPath}" -y`,
    `-f lavfi -i "color=c=black:size=1080x1920:rate=25"`,
    `-i "${audioPath}"`,
    `-map 0:v -map 1:a`,
    `-c:v libx264 -preset ultrafast -crf 30`,
    `-c:a aac -b:a 64k`,
    `-t ${audioDuration}`,
    `-pix_fmt yuv420p`,
    `"${videoPath}"`
  ].join(' ');

  try {
    console.log('🎬 Creating Short (Method 3: Bare minimum)...');
    await execAsync(cmd3, { timeout: 120000 });
    console.log('✅ Short created (Method 3 - bare)');
    return videoPath;
  } catch (err3) {
    console.error('❌ All methods failed:', err3.message.substring(0, 80));
    throw new Error('FFmpeg video creation failed. Check FFmpeg installation.');
  }
}



/**
 * Main function: Create a complete video
 */

async function createVideo(user, videoId, topicHint = null) {
  const db = getDb();
  const videoRef = db.collection('videos').doc(videoId);

  try {
    // Step 1: Generate AI content
    console.log('📝 Step 1: Generating AI content...');
    await videoRef.update({ 
      status: 'generating_content',
      updatedAt: new Date().toISOString()
    });
    
    const content = await groqService.generateVideoContent(topicHint);
    
    await videoRef.update({
      topic: content.topic,
      title: content.title,
      description: content.description,
      tags: content.tags,
      script: content.script,
      displayTexts: content.displayTexts,
      status: 'generating_audio',
      updatedAt: new Date().toISOString()
    });

    // Step 2: Generate Hindi audio
    console.log('🎙️ Step 2: Generating Hindi audio with gTTS...');
    const audioId = `audio_${videoId}_${Date.now()}`;
    const audioPath = await generateAudio(content.script, audioId);
    const relativeAudioPath = audioPath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');

    await videoRef.update({
      audioPath: relativeAudioPath,
      status: 'creating_video',
      updatedAt: new Date().toISOString()
    });

    // Step 3: Create video with FFmpeg
    console.log('🎬 Step 3: Creating video with FFmpeg...');
    const videoFilePath = await createVideoWithFFmpeg(
      videoId, 
      content.displayTexts,
      audioPath,
      content.title
    );
    const relativeVideoPath = videoFilePath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');

    await videoRef.update({
      videoPath: relativeVideoPath,
      status: 'creating_thumbnail',
      updatedAt: new Date().toISOString()
    });

    // Step 4: Create thumbnail
    console.log('🖼️ Step 4: Creating thumbnail...');
    const thumbnailId = `thumb_${videoId}_${Date.now()}`;
    const thumbnailFilePath = await createThumbnail(
      content.thumbnailText,
      content.thumbnailSubtext,
      thumbnailId
    );
    const relativeThumbnailPath = thumbnailFilePath.replace(path.join(__dirname, '..'), '').replace(/\\/g, '/');

    // Step 5: Update Firestore with completed video
    const videoUrl = `/${relativeVideoPath.replace(/^\//, '')}`;
    const thumbnailUrl = `/${relativeThumbnailPath.replace(/^\//, '')}`;

    await videoRef.update({
      thumbnailPath: relativeThumbnailPath,
      thumbnailUrl,
      videoUrl,
      status: 'ready',
      updatedAt: new Date().toISOString(),
      completedAt: new Date().toISOString()
    });

    console.log(`✅ Video creation complete: ${videoId}`);

    return {
      videoId,
      title: content.title,
      description: content.description,
      tags: content.tags,
      videoPath: relativeVideoPath,
      audioPath: relativeAudioPath,
      thumbnailPath: relativeThumbnailPath,
      videoUrl,
      thumbnailUrl,
      script: content.script
    };

  } catch (error) {
    console.error(`❌ Video creation failed: ${error.message}`);
    await videoRef.update({
      status: 'failed',
      error: error.message,
      updatedAt: new Date().toISOString()
    });
    throw error;
  }
}

module.exports = {
  createVideo,
  generateAudio,
  createThumbnail,
  createVideoWithFFmpeg
};
