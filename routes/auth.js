const express = require('express');
const passport = require('passport');
const { Strategy: GoogleStrategy } = require('passport-google-oauth20');
const { getDb, FieldValue } = require('../firebase-config');
const router = express.Router();

// Configure Passport Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.YOUTUBE_CLIENT_ID || 'placeholder-client-id',
  clientSecret: process.env.YOUTUBE_CLIENT_SECRET || 'placeholder-client-secret',
  callbackURL: `${process.env.BASE_URL || 'http://localhost:3000'}/auth/google/callback`,
  scope: [
    'profile',
    'email',
    'https://www.googleapis.com/auth/youtube',
    'https://www.googleapis.com/auth/youtube.upload',
    'https://www.googleapis.com/auth/youtube.readonly',
    'https://www.googleapis.com/auth/drive.readonly'
  ]
}, async (accessToken, refreshToken, profile, done) => {
  const userData = {
    id: profile.id,
    uid: profile.id,
    email: profile.emails?.[0]?.value || '',
    displayName: profile.displayName,
    photoURL: profile.photos?.[0]?.value || null,
    accessToken,
    refreshToken,
    lastLogin: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    totalVideos: 0,
    todayVideos: 0,
    settings: {
      niche: 'Entertainment & Comedy',
      uploadTimes: ['10:00', '14:00', '19:00'],
      privacy: 'public',
      language: 'Hindi'
    }
  };

  // Try to save to Firebase (gracefully fallback if unavailable)
  try {
    const db = getDb();
    const userRef = db.collection('users').doc(profile.id);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      await userRef.set({ ...userData, createdAt: new Date().toISOString() });
      console.log(`✅ New user created: ${profile.displayName}`);
    } else {
      await userRef.update(userData);
      console.log(`✅ User logged in: ${profile.displayName}`);
    }

    try {
      const updatedDoc = await userRef.get();
      if (updatedDoc.exists) {
        return done(null, { ...userData, ...updatedDoc.data() });
      }
    } catch (_) {}

  } catch (firebaseError) {
    // Firebase not configured — login still works using session only
    console.warn('⚠️ Firebase unavailable, using session-only mode:', firebaseError.message?.split('\n')[0]);
  }

  // Always allow login even without Firebase
  return done(null, userData);
}));

// Serialize/Deserialize user for session
passport.serializeUser((user, done) => {
  done(null, user.id || user.uid);
});

passport.deserializeUser(async (id, done) => {
  try {
    const db = getDb();
    const userDoc = await db.collection('users').doc(id).get();
    if (userDoc.exists) {
      done(null, { id, ...userDoc.data() });
    } else {
      // User not in DB but session exists — reconstruct minimal user
      done(null, { id, uid: id });
    }
  } catch (error) {
    // Firebase unavailable — still keep session alive
    console.warn('deserializeUser Firebase error (non-fatal):', error.message?.split('\n')[0]);
    done(null, { id, uid: id });
  }
});

// ==================== ROUTES ====================

// Initiate Google OAuth
router.get('/google', (req, res, next) => {
  passport.authenticate('google', {
    scope: [
      'profile',
      'email',
      'https://www.googleapis.com/auth/youtube',
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/drive.readonly'
    ],
    accessType: 'offline',
    prompt: 'consent'
  })(req, res, next);
});

// Google OAuth Callback
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/?error=auth_failed' }),
  async (req, res) => {
    try {
      // Store user in session
      req.session.user = {
        uid: req.user.id || req.user.uid,
        email: req.user.email,
        displayName: req.user.displayName,
        photoURL: req.user.photoURL,
        accessToken: req.user.accessToken,
        refreshToken: req.user.refreshToken
      };
      
      await new Promise((resolve, reject) => {
        req.session.save((err) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Redirect to dashboard
      res.redirect('/dashboard');
    } catch (error) {
      console.error('Callback error:', error);
      res.redirect('/?error=session_error');
    }
  }
);

// YouTube specific OAuth (alias for same flow)
router.get('/youtube', (req, res) => {
  res.redirect('/auth/google');
});

router.get('/youtube/callback', (req, res) => {
  res.redirect('/auth/google/callback');
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ success: false, error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ success: true, message: 'Logged out successfully' });
  });
});

// Disconnect YouTube (revoke tokens)
router.post('/disconnect-youtube', async (req, res) => {
  try {
    if (!req.session.user) {
      return res.status(401).json({ success: false, error: 'Not authenticated' });
    }

    const db = getDb();
    await db.collection('users').doc(req.session.user.uid).update({
      accessToken: null,
      refreshToken: null,
      youtubeConnected: false,
      updatedAt: new Date().toISOString()
    });

    req.session.user.accessToken = null;
    req.session.user.refreshToken = null;

    res.json({ success: true, message: 'YouTube disconnected successfully' });
  } catch (error) {
    console.error('Disconnect error:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Check auth status
router.get('/status', (req, res) => {
  if (req.session && req.session.user) {
    res.json({
      authenticated: true,
      user: {
        uid: req.session.user.uid,
        email: req.session.user.email,
        displayName: req.session.user.displayName,
        photoURL: req.session.user.photoURL,
        youtubeConnected: !!(req.session.user.accessToken)
      }
    });
  } else {
    res.json({ authenticated: false, user: null });
  }
});

module.exports = router;
