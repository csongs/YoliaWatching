// 將 yuupeek/config.json 匯入 Firebase Realtime Database
// 用法：node import-config.js

const fs   = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'yuupeek', 'config.json'), 'utf8'));

let youtubeApiKey = '';
try {
  const env = fs.readFileSync(path.join(ROOT, 'yuupeek', '.env'), 'utf8');
  const m = env.match(/YOUTUBE_API_KEY=(.+)/);
  if (m) youtubeApiKey = m[1].trim();
} catch {}

const data = {
  twitch:             cfg.twitch             ?? {},
  youtube:            cfg.youtube            ?? {},
  youtubeApiKey,
  interactions:       cfg.interactions       ?? [],
  greetingAnimations: cfg.greetingAnimations ?? [],
  obs:                cfg.obs                ?? { scale: 2 },
};

const out = path.join(__dirname, 'config-export.json');
fs.writeFileSync(out, JSON.stringify(data, null, 2), 'utf8');
console.log('已產生：' + out);
console.log('');
console.log('接著執行：');
console.log('  cd web && firebase database:set /config config-export.json');
