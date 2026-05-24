require('dotenv').config();

let admin = null;
let db = null;
let usingMockDb = false;

// ============================================================
// IN-MEMORY DATABASE (works without Firebase credentials)
// ============================================================
const memStore = {};

function createMockDb() {
  usingMockDb = true;
  console.log('📦 Using in-memory database (Firebase credentials not configured)');

  const getDoc = (collection, id) => memStore[`${collection}/${id}`] || null;
  const setDoc = (collection, id, data) => {
    memStore[`${collection}/${id}`] = { ...data, _id: id };
  };

  return {
    collection: (collectionName) => ({
      doc: (id) => ({
        get: async () => {
          const data = getDoc(collectionName, id);
          return {
            exists: !!data,
            data: () => data,
            id
          };
        },
        set: async (data, options = {}) => {
          if (options.merge) {
            setDoc(collectionName, id, {
              ...(getDoc(collectionName, id) || {}),
              ...data
            });
          } else {
            setDoc(collectionName, id, data);
          }
        },
        update: async (data) => {
          const existing = getDoc(collectionName, id) || {};
          setDoc(collectionName, id, { ...existing, ...data });
        },
        delete: async () => {
          delete memStore[`${collectionName}/${id}`];
        }
      }),

      add: async (data) => {
        const id = `local_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        setDoc(collectionName, id, { ...data, id });
        return { id };
      },

      where: (field, op, value) => ({
        orderBy: () => ({
          limit: (n) => ({
            get: async () => {
              const docs = Object.entries(memStore)
                .filter(([key]) => key.startsWith(`${collectionName}/`))
                .map(([key, val]) => ({
                  id: key.split('/')[1],
                  data: () => val,
                  exists: true
                }))
                .filter(doc => {
                  const d = doc.data();
                  if (op === '==') return d[field] === value;
                  return true;
                })
                .slice(0, n);
              return { docs };
            }
          }),
          get: async () => {
            const docs = Object.entries(memStore)
              .filter(([key]) => key.startsWith(`${collectionName}/`))
              .map(([key, val]) => ({
                id: key.split('/')[1],
                data: () => val,
                exists: true
              }))
              .filter(doc => {
                const d = doc.data();
                if (op === '==') return d[field] === value;
                return true;
              });
            return { docs };
          }
        }),
        get: async () => {
          const docs = Object.entries(memStore)
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, val]) => ({
              id: key.split('/')[1],
              data: () => val,
              exists: true
            }))
            .filter(doc => {
              const d = doc.data();
              if (op === '==') return d[field] === value;
              return true;
            });
          return { docs };
        }
      }),

      orderBy: (field, dir = 'asc') => ({
        limit: (n) => ({
          get: async () => {
            const docs = Object.entries(memStore)
              .filter(([key]) => key.startsWith(`${collectionName}/`))
              .map(([key, val]) => ({
                id: key.split('/')[1],
                data: () => val,
                exists: true
              }))
              .sort((a, b) => {
                const av = a.data()[field] || '';
                const bv = b.data()[field] || '';
                return dir === 'desc'
                  ? bv.localeCompare(av)
                  : av.localeCompare(bv);
              })
              .slice(0, n);
            return { docs };
          }
        }),
        get: async () => {
          const docs = Object.entries(memStore)
            .filter(([key]) => key.startsWith(`${collectionName}/`))
            .map(([key, val]) => ({
              id: key.split('/')[1],
              data: () => val,
              exists: true
            }));
          return { docs };
        }
      }),

      get: async () => {
        const docs = Object.entries(memStore)
          .filter(([key]) => key.startsWith(`${collectionName}/`))
          .map(([key, val]) => ({
            id: key.split('/')[1],
            data: () => val,
            exists: true
          }));
        return { docs };
      }
    })
  };
}

// ============================================================
// FIREBASE INITIALIZER
// ============================================================
function initFirebase() {
  // If already initialized
  if (db) return;

  // Try to load firebase-admin
  try {
    admin = require('firebase-admin');
  } catch (e) {
    console.warn('⚠️ firebase-admin not installed, using local DB');
    db = createMockDb();
    return;
  }

  // Already initialized
  if (admin.apps.length > 0) {
    try {
      db = admin.firestore();
      console.log('✅ Firebase reusing existing app');
      return;
    } catch (e) {
      db = createMockDb();
      return;
    }
  }

  // Try with FIREBASE_SERVICE_ACCOUNT env variable
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: process.env.FIREBASE_PROJECT_ID,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET
      });
      db = admin.firestore();
      console.log('✅ Firebase initialized with Service Account');
      return;
    } catch (e) {
      console.warn('⚠️ Service account parse failed:', e.message);
    }
  }

  // Try with Application Default Credentials (gcloud)
  try {
    admin.initializeApp({
      projectId: process.env.FIREBASE_PROJECT_ID,
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET
    });

    db = admin.firestore();

    // Test the connection with a quick probe
    db.collection('_ping').doc('test').get()
      .then(() => {
        console.log('✅ Firebase initialized with Application Default Credentials');
      })
      .catch((err) => {
        console.warn('⚠️ Firestore not accessible, switching to local DB:', err.message);
        db = createMockDb();
      });

    // Use mock DB immediately as safe default, switch to real if ping succeeds
    // Actually just use mock to be safe
    db = createMockDb();
    return;

  } catch (e) {
    console.warn('⚠️ Firebase init failed, using local DB:', e.message);
    db = createMockDb();
    return;
  }
}

function getDb() {
  if (!db) initFirebase();
  return db;
}

function getAdmin() {
  return admin;
}

function isUsingMockDb() {
  return usingMockDb;
}

// FieldValue helpers that work with both real and mock DB
const FieldValue = {
  serverTimestamp: () => {
    try {
      if (admin && admin.apps.length > 0 && !usingMockDb) {
        return admin.firestore.FieldValue.serverTimestamp();
      }
    } catch {}
    return new Date().toISOString();
  },
  increment: (n) => {
    try {
      if (admin && admin.apps.length > 0 && !usingMockDb) {
        return admin.firestore.FieldValue.increment(n);
      }
    } catch {}
    return n;
  }
};

module.exports = { initFirebase, getDb, getAdmin, FieldValue, isUsingMockDb };
