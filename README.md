# 🤖 TubeBot — YouTube Automation Bot

<div align="center">

![TubeBot](https://img.shields.io/badge/TubeBot-AI%20Powered-ff2d2d?style=for-the-badge&logo=youtube&logoColor=white)
![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)

**Fully automated YouTube Shorts creator & uploader powered by Groq AI + Google Drive**

[Live Demo](#) • [Admin Panel](#admin-panel) • [Setup Guide](#setup)

</div>

---

## ✨ Features

| Feature | Description |
|---------|-------------|
| 🤖 **AI Script Generator** | Groq LLaMA 70B generates viral Hindi/Hinglish scripts |
| 🎙️ **Hindi TTS Audio** | Google Text-to-Speech for natural Hindi voice |
| 🎬 **Auto Video Creation** | FFmpeg creates animated 1080x1920 YouTube Shorts |
| 📁 **Google Drive Import** | Paste a Drive link → auto-download videos → upload |
| 📸 **Smart Photo Filter** | Photos automatically detected and skipped |
| ⏰ **Auto Scheduler** | 3x daily uploads at 10AM, 2PM, 7PM IST |
| 👑 **Admin Panel** | Full user management, stats, logs |
| 📊 **Dashboard** | Live stats, scheduler status, recent videos |

---

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- FFmpeg installed ([Download](https://ffmpeg.org/download.html))
- [Groq API Key](https://console.groq.com) (free)
- Google Cloud OAuth credentials

### Installation

```bash
# Clone repo
git clone https://github.com/kadiwalarman1-rgb/tubebot-youtube-automation.git
cd tubebot-youtube-automation

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your API keys

# Start server
node server.js
```

Open **http://localhost:3000** in your browser.

---

## ⚙️ Environment Setup

Copy `.env.example` to `.env` and fill in:

```env
GROQ_API_KEY=          # Get from console.groq.com (free)
YOUTUBE_CLIENT_ID=     # Google Cloud Console → OAuth 2.0
YOUTUBE_CLIENT_SECRET= # Google Cloud Console → OAuth 2.0
ADMIN_PASSWORD=        # Your admin panel password
SESSION_SECRET=        # Any random long string
```

### Google OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project → Enable **YouTube Data API v3** + **Google Drive API**
3. Create OAuth 2.0 credentials
4. Add redirect URI: `http://localhost:3000/auth/google/callback`

---

## 📁 Google Drive Import

1. Go to Dashboard → scroll to **📁 Google Drive Import**
2. Paste a Google Drive folder or file link
3. Click **🔍 Scan Link** — see videos found, photos skipped
4. Click **🚀 Start Upload** — auto-uploads to YouTube!

**Supported URL formats:**
- `https://drive.google.com/drive/folders/FOLDER_ID`
- `https://drive.google.com/file/d/FILE_ID/view`

---

## 👑 Admin Panel

Access at **http://localhost:3000/admin**

| Feature | Description |
|---------|-------------|
| 📊 Dashboard | Platform-wide stats and health |
| 👥 Users | Enable/disable users |
| 🎬 Videos | All videos across all users |
| 📋 Logs | Full upload success/failure history |
| ⏰ Scheduler | Manual trigger, schedule status |

---

## 🏗️ Architecture

```
TubeBot/
├── server.js              # Express server
├── routes/
│   ├── auth.js            # Google OAuth
│   ├── youtube.js         # YouTube upload API
│   ├── video.js           # Video creation API
│   ├── drive.js           # Google Drive import API
│   └── admin.js           # Admin panel API
├── services/
│   ├── groq.js            # AI script generation
│   ├── video-creator.js   # FFmpeg video creation
│   ├── scheduler.js       # Auto-upload scheduler
│   └── drive-service.js   # Drive download engine
├── public/                # Frontend assets
├── dashboard.html         # User dashboard
├── admin.html             # Admin panel
└── storage/               # Generated videos/audio
```

---

## 📦 Tech Stack

- **Backend:** Node.js + Express
- **AI:** Groq (LLaMA 3.3 70B)
- **Video:** FFmpeg (YouTube Shorts 1080x1920)
- **Audio:** Google Text-to-Speech (gTTS)
- **Auth:** Google OAuth 2.0
- **APIs:** YouTube Data API v3, Google Drive API v3
- **DB:** Firebase Firestore (optional, falls back to in-memory)

---

## 📄 License

MIT License — Free to use and modify.

---

<div align="center">
Made with ❤️ by <a href="https://github.com/kadiwalarman1-rgb">Arman Kadiwal</a>
</div>
