// 從環境變數產生 public/firebase-config.js
// 由 GitHub Actions 呼叫，不需要手動執行
const fs  = require('fs');
const pid = process.env.FIREBASE_PROJECT_ID;

if (!pid)                                    throw new Error('FIREBASE_PROJECT_ID is required');
if (!process.env.FIREBASE_API_KEY)           throw new Error('FIREBASE_API_KEY is required');
if (!process.env.FIREBASE_MESSAGING_SENDER_ID) throw new Error('FIREBASE_MESSAGING_SENDER_ID is required');
if (!process.env.FIREBASE_APP_ID)            throw new Error('FIREBASE_APP_ID is required');

const config = {
  apiKey:            process.env.FIREBASE_API_KEY,
  authDomain:        process.env.FIREBASE_AUTH_DOMAIN        || `${pid}.firebaseapp.com`,
  databaseURL:       process.env.FIREBASE_DATABASE_URL       || `https://${pid}-default-rtdb.firebaseio.com`,
  projectId:         pid,
  storageBucket:     process.env.FIREBASE_STORAGE_BUCKET     || `${pid}.firebasestorage.app`,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.FIREBASE_APP_ID,
};

fs.writeFileSync(
  'public/firebase-config.js',
  `const FIREBASE_CONFIG = ${JSON.stringify(config, null, 2)};\n`
);
console.log('[gen-firebase-config] done →', config.projectId);
