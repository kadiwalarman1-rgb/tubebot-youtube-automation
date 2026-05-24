/**
 * TubeBot - Global JavaScript Utilities
 * Shared functions used across all pages
 */

// ============================================
// NOTIFICATION SYSTEM
// ============================================

/**
 * Show a notification toast
 * @param {string} message - Message to display
 * @param {string} type - 'success' | 'error' | 'warning' | 'info'
 * @param {number} duration - Duration in ms (default 4000)
 */
function showNotification(message, type = 'info', duration = 4000) {
  const area = document.getElementById('notificationsArea');
  if (!area) return;

  const notification = document.createElement('div');
  notification.classList.add('notification', type);
  notification.textContent = message;

  area.appendChild(notification);

  // Auto-remove
  setTimeout(() => {
    notification.style.opacity = '0';
    notification.style.transform = 'translateY(-10px)';
    notification.style.transition = 'all 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, duration);
}

// ============================================
// API HELPERS
// ============================================

/**
 * Make an API call with error handling
 */
async function apiCall(url, options = {}) {
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });

    if (!response.ok && response.status === 401) {
      // Unauthorized - redirect to login
      window.location.href = '/';
      return null;
    }

    return await response.json();
  } catch (error) {
    console.error(`API Error [${url}]:`, error);
    return null;
  }
}

// ============================================
// USER SETTINGS (Local Storage Fallback)
// ============================================

const LOCAL_SETTINGS_KEY = 'tubebot_settings';

function getLocalSettings() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_SETTINGS_KEY)) || {};
  } catch {
    return {};
  }
}

function saveLocalSettings(settings) {
  try {
    localStorage.setItem(LOCAL_SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

// ============================================
// DATE / TIME HELPERS
// ============================================

function formatDate(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  
  return date.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
  });
}

function formatNumber(num) {
  if (!num || isNaN(num)) return '0';
  if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const date = new Date(dateStr);
  return date.toLocaleTimeString('en-IN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  });
}

// ============================================
// COUNTDOWN UTILITIES
// ============================================

/**
 * Create a countdown that updates an element
 */
function createCountdown(targetTime, elementId, onComplete = null) {
  const el = document.getElementById(elementId);
  if (!el) return null;

  function update() {
    const now = new Date();
    const diff = new Date(targetTime) - now;

    if (diff <= 0) {
      el.textContent = '00:00:00';
      if (onComplete) onComplete();
      return;
    }

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    const seconds = Math.floor((diff % (1000 * 60)) / 1000);

    el.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  update();
  return setInterval(update, 1000);
}

// ============================================
// STATUS HELPERS
// ============================================

function getStatusEmoji(status) {
  const map = {
    'scheduled': '📅',
    'creating': '⏳',
    'generating_content': '🤖',
    'generating_audio': '🎙️',
    'creating_video': '🎬',
    'creating_thumbnail': '🖼️',
    'ready': '✅',
    'uploading': '📤',
    'uploaded': '🎉',
    'failed': '❌'
  };
  return map[status] || '⏳';
}

function getStatusLabel(status) {
  const map = {
    'scheduled': 'Scheduled',
    'creating': 'Creating',
    'generating_content': 'AI Writing',
    'generating_audio': 'Voice Gen',
    'creating_video': 'FFmpeg',
    'creating_thumbnail': 'Thumbnail',
    'ready': 'Ready',
    'uploading': 'Uploading',
    'uploaded': 'Live on YT',
    'failed': 'Failed'
  };
  return map[status] || status;
}

// ============================================
// VIDEO RENDERING
// ============================================

function createVideoCard(video) {
  const statusEmoji = getStatusEmoji(video.status);
  const statusLabel = getStatusLabel(video.status);
  const dateStr = formatDate(video.createdAt);

  return `
    <div class="video-item" id="video-${video.id}">
      <div class="video-thumb">
        ${video.thumbnailUrl 
          ? `<img src="${video.thumbnailUrl}" alt="${video.title || 'Video'}" 
               onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" />`
          : ''}
        <div class="video-thumb-placeholder" style="${video.thumbnailUrl ? 'display:none' : 'display:flex'}">🎬</div>
      </div>
      <div class="video-details">
        <div class="video-title">${video.title || 'Processing...'}</div>
        <div class="video-meta">
          <span class="status-badge status-${video.status}">${statusEmoji} ${statusLabel}</span>
          <span>${dateStr}</span>
        </div>
        ${video.youtubeUrl 
          ? `<a href="${video.youtubeUrl}" target="_blank" class="yt-link">▶ Watch on YouTube</a>` 
          : ''}
      </div>
      <div class="video-actions">
        ${video.status === 'ready' && !video.youtubeVideoId
          ? `<button class="btn-small btn-primary" onclick="uploadVideo('${video.id}')">📤 Upload</button>`
          : ''}
        <button class="btn-small btn-ghost" onclick="deleteVideo('${video.id}')" title="Delete">🗑️</button>
      </div>
    </div>
  `;
}

// ============================================
// FIREBASE CLIENT-SIDE CONFIG
// ============================================

const firebaseClientConfig = {
  apiKey: "AIzaSyCzE8qc4C-CYdc00XTYJ1AC0s8TD_hjJmE",
  authDomain: "tube-bot-d5160.firebaseapp.com",
  projectId: "tube-bot-d5160",
  storageBucket: "tube-bot-d5160.firebasestorage.app",
  messagingSenderId: "60195252278",
  appId: "1:60195252278:web:7ff24198f71a58a7065097"
};

// ============================================
// LOADING STATES
// ============================================

function setLoading(buttonId, loading, originalText = null) {
  const btn = document.getElementById(buttonId);
  if (!btn) return;

  if (loading) {
    btn.dataset.originalText = btn.innerHTML;
    btn.innerHTML = '<span class="step-icon spinning">⏳</span> Loading...';
    btn.disabled = true;
    btn.style.opacity = '0.7';
  } else {
    btn.innerHTML = originalText || btn.dataset.originalText || 'Button';
    btn.disabled = false;
    btn.style.opacity = '1';
  }
}

// ============================================
// SIDEBAR TOGGLE (shared)
// ============================================

function toggleSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.toggle('open');
  if (overlay) overlay.classList.toggle('show');
}

function closeSidebar() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (sidebar) sidebar.classList.remove('open');
  if (overlay) overlay.classList.remove('show');
}

// ============================================
// ERROR BOUNDARY
// ============================================

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
});

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error);
});

// ============================================
// INIT ON DOM READY
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  // Animate cards on scroll
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = '1';
        entry.target.style.transform = 'translateY(0)';
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1 });

  document.querySelectorAll('.card, .stat-card').forEach(card => {
    card.style.opacity = '0';
    card.style.transform = 'translateY(20px)';
    card.style.transition = 'opacity 0.4s ease, transform 0.4s ease';
    observer.observe(card);
  });
});
