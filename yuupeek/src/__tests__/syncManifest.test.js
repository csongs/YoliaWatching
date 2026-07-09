// sync 守門(維護者決策 2026-07-10):HTML 引用的本地 js 必須在 sync.js 清單內,
// 漏登記=此測試紅字,而不是部署後靜默 404。
// 背景:共用檔源頭在 yuupeek/,部署時由 web/sync.js 複製進 web/public/(Hosting 只部署該目錄);
// 桌面模式的 loadScript('/src/...')/'/renderer/...' 讀源頭檔,不經 sync,刻意不在檢查範圍。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// 部署時由其他機制產生、不經 sync.js 的檔案
const GENERATED = new Set(['firebase-config.js']);

function syncedBasenames() {
  const src = read('web/sync.js');
  const names = new Set();
  for (const m of src.matchAll(/'web\/public\/([\w./-]+\.js)'/g)) names.add(path.basename(m[1]));
  return names;
}

function referencedLocalJs(html) {
  const names = new Set();
  for (const m of html.matchAll(/<script src="\.\/([\w./-]+\.js)"/g)) names.add(path.basename(m[1]));
  for (const m of html.matchAll(/loadScript\('\/([\w-]+\.js)'\)/g)) names.add(m[1]);
  return names;
}

test('index.html/panel.html 引用的本地 js 都在 sync 清單或生成清單內', () => {
  const synced = syncedBasenames();
  const refs = new Set([
    ...referencedLocalJs(read('web/public/index.html')),
    ...referencedLocalJs(read('yuupeek/renderer/panel.html')),
  ]);
  const missing = [...refs].filter(n => !synced.has(n) && !GENERATED.has(n));
  expect(missing).toEqual([]);
});

test('sync 清單裡的每個來源檔都存在', () => {
  const src = read('web/sync.js');
  for (const m of src.matchAll(/'(yuupeek\/[\w./-]+\.js)'/g)) {
    expect(fs.existsSync(path.join(ROOT, m[1]))).toBe(true);
  }
});
