/**
 * Firebase Client-Side SDK Configuration
 * Used in browser for Google Sign-In flow
 */

// Firebase config (client-side)
const firebaseConfig = {
  apiKey: "AIzaSyCzE8qc4C-CYdc00XTYJ1AC0s8TD_hjJmE",
  authDomain: "tube-bot-d5160.firebaseapp.com",
  projectId: "tube-bot-d5160",
  storageBucket: "tube-bot-d5160.firebasestorage.app",
  messagingSenderId: "60195252278",
  appId: "1:60195252278:web:7ff24198f71a58a7065097"
};

// NOTE: Firebase client auth is handled server-side via Passport.js + Google OAuth.
// This file is kept for reference; the actual auth flow goes through /auth/google.
// If you want client-side Firebase SDK, import it via CDN in your HTML.
window.__FIREBASE_CONFIG__ = firebaseConfig;
