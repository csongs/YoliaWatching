// 部署前自動同步從 yuupeek/ 共用的檔案
const fs   = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

// 單一檔案同步
const FILES = [
  ['yuupeek/renderer/character.js', 'web/public/character.js'],
  ['yuupeek/renderer/panel.html',   'web/public/panel.html'],
  ['yuupeek/src/chatProcessor.js',  'web/public/chatProcessor.js'],
  ['yuupeek/src/packFormat.js',     'web/public/packFormat.js'],
  ['yuupeek/src/youtubePollPolicy.js', 'web/public/youtubePollPolicy.js'],
  ['yuupeek/renderer/workshop.js',  'web/public/workshop.js'],
  ['yuupeek/renderer/market.js',    'web/public/market.js'],
];

for (const [src, dst] of FILES) {
  const srcPath = path.join(ROOT, src);
  const dstPath = path.join(ROOT, dst);
  fs.mkdirSync(path.dirname(dstPath), { recursive: true });
  fs.copyFileSync(srcPath, dstPath);
  console.log(`synced: ${src}`);
}

// 資料夾同步（Sprites）
const DIRS = [
  ['yuupeek/assets', 'web/public/assets'],
];

for (const [src, dst] of DIRS) {
  const srcPath = path.join(ROOT, src);
  const dstPath = path.join(ROOT, dst);
  fs.cpSync(srcPath, dstPath, { recursive: true });
  console.log(`synced: ${src}/`);
}
