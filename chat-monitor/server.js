// 獨立測試工具的伺服器——不依附 yuupeek 的 Electron 主程序或 obsServer.js,單純用
// node server.js 啟動,也不依賴 yuupeek/ 資料夾同時存在。
// 連線邏輯(tmi.js/youtube-chat-next/soop-extension 的用法)參考 yuupeek/src/chatListener.js,
// 但輸出目標從「幽視值狀態機」換成「SQLite 事件歷史 + demo 頁面」。
const path = require('path');
const fs = require('fs');
const http = require('http');
const { execFile } = require('child_process');
const { WebSocketServer } = require('ws');
const { DEBUG, debugLog } = require('./lib/debugLog');

// 跳出 Windows 原生的「瀏覽資料夾」對話方塊,讓使用者選 SQLite 要存在哪裡——這個工具本來就只給
// Windows 用(install.bat/start.bat 是 .bat),用 PowerShell 內建的 System.Windows.Forms 就好,
// 不用多裝任何套件。用 execFile(非同步)而不是 execFileSync:對話方塊開著的這段時間如果用同步
// 版本會整個 Node event loop 卡住,其他 API 請求、WebSocket 廣播、聊天監聽全部跟著凍結,
// 使用者選多久這個 server 就假死多久——非同步版本只有這一支 request 在等,其他事情照常運作。
function browseForFolder() {
  const script = `
    Add-Type -AssemblyName System.Windows.Forms
    $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
    $dialog.Description = '選擇 chat-monitor 的 SQLite 資料庫存放資料夾'
    if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) {
      Write-Output $dialog.SelectedPath
    }
  `;
  return new Promise((resolve, reject) => {
    execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout.trim() || null); // 使用者按取消,SelectedPath 不會印出東西
    });
  });
}

// 只在「第一次啟動、settings 表還是空的」這個情境下當方便的預設值來源(見下面
// loadSeedFromYuupeekConfig);找不到 yuupeek/.env 也不會出錯(dotenv 對不存在的路徑
// 就是 no-op),打包給別人測試時可以完全不帶 yuupeek/ 資料夾,直接在 demo 頁面填自己的金鑰。
require('dotenv').config({ path: path.join(__dirname, '..', 'yuupeek', '.env'), quiet: true });
if (fs.existsSync(path.join(__dirname, '.env'))) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), override: true, quiet: true });
}

const db = require('./db');
const { createTwitchConnector } = require('./connectors/twitch');
const { createYoutubeConnector } = require('./connectors/youtube');
const { createSoopConnector } = require('./connectors/soop');

const PORT = process.env.CHAT_MONITOR_PORT || 3100;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 開機時如果 settings 表是空的,從 yuupeek/config.json(頻道名稱)+ yuupeek/.env(金鑰)
// 撈現成的值當預設值,省得每次都要重新輸入——純粹是「第一次啟動」的方便,種進 SQLite 之後,
// 之後所有讀寫都只認 DB 裡的值,demo 頁面「平台設定」分頁就是唯一的設定介面,不用再回頭改
// .env 或 config.json。
// 只在 yuupeek/config.json 真的有這個平台的區塊時才回傳該平台的 seed——不能每個平台都無條件
// 回傳(即使是空字串的 channel),否則 db.seedSettingsIfEmpty() 合併時那個空字串會蓋掉
// db.js DEFAULT_CONFIG 裡寫死的頻道預設值(打包給別人的版本沒有 yuupeek/ 可讀,只能靠 DEFAULT_CONFIG)。
function loadSeedFromYuupeekConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'yuupeek', 'config.json'), 'utf8')); } catch { /* 沒有就用空預設 */ }
  const seed = {};
  if (cfg.twitch) seed.twitch = { enabled: !!cfg.twitch.enabled, config: { channel: cfg.twitch.channel ?? '', oauthToken: process.env.TWITCH_OAUTH ?? '' } };
  if (cfg.youtube) seed.youtube = { enabled: !!cfg.youtube.enabled, config: { channel: cfg.youtube.channel ?? '' } };
  if (cfg.soop) seed.soop = { enabled: !!cfg.soop.enabled, config: { channel: cfg.soop.channel ?? '', apiMode: cfg.soop.apiMode ?? 'community' } };
  return seed;
}
db.seedSettingsIfEmpty(loadSeedFromYuupeekConfig());

// ── 連線管理:每平台最多一個 connector 實例,設定變更時整組換新的 ─────────────
const CONNECTOR_FACTORIES = {
  twitch: createTwitchConnector,
  youtube: createYoutubeConnector,
  soop: createSoopConnector,
};

const connectors = { twitch: null, youtube: null, soop: null };
const status = {
  twitch: { connected: false, error: null },
  youtube: { live: false, error: null },
  soop: { connected: false, error: null },
};

function handleEvent(evt) {
  const saved = db.insertEvent(evt);
  if (!saved) return; // 重複事件(dedup_key 已存在),不廣播
  broadcast({ type: 'event', data: saved });
}

function handleStatus(platform, patch) {
  status[platform] = { ...status[platform], ...patch };
  debugLog(platform, 'status ->', status[platform]);
  broadcast({ type: 'status', platform, data: status[platform] });
}

function startConnector(platform) {
  const settings = db.getSettings()[platform];
  if (!settings.enabled) return;
  debugLog(platform, 'connector start', { channel: settings.channel });
  const factory = CONNECTOR_FACTORIES[platform];
  const connector = factory(settings, handleEvent, (patch) => handleStatus(platform, patch));
  connectors[platform] = connector;
  connector.start();
}

function stopConnector(platform) {
  connectors[platform]?.stop();
  connectors[platform] = null;
  status[platform] = platform === 'youtube' ? { live: false, error: null } : { connected: false, error: null };
}

function restartConnector(platform) {
  stopConnector(platform);
  startConnector(platform);
}

for (const platform of Object.keys(CONNECTOR_FACTORIES)) startConnector(platform);

// ── HTTP + WS ────────────────────────────────────────────────────────────
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function sendJson(res, status_, obj) {
  res.writeHead(status_, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? '/demo.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, rel);
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); res.end(); return; }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/version' && req.method === 'GET') {
    return sendJson(res, 200, { version: require('./package.json').version, debug: DEBUG });
  }

  if (url.pathname === '/api/settings' && req.method === 'GET') {
    return sendJson(res, 200, db.getSettings());
  }

  if (url.pathname.startsWith('/api/settings/') && req.method === 'POST') {
    const platform = url.pathname.split('/')[3];
    if (!CONNECTOR_FACTORIES[platform]) return sendJson(res, 404, { error: 'unknown platform' });
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const saved = db.saveSettings(platform, body);
      restartConnector(platform);
      return sendJson(res, 200, saved);
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/status' && req.method === 'GET') {
    return sendJson(res, 200, status);
  }

  if (url.pathname === '/api/history' && req.method === 'GET') {
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 2000);
    return sendJson(res, 200, db.getRecentEvents(limit));
  }

  if (url.pathname === '/api/db-info' && req.method === 'GET') {
    return sendJson(res, 200, db.getStats());
  }

  if (url.pathname === '/api/db-location' && req.method === 'GET') {
    return sendJson(res, 200, db.getLocationInfo());
  }

  if (url.pathname === '/api/db-location/browse' && req.method === 'POST') {
    try {
      const folder = await browseForFolder();
      return sendJson(res, 200, { folder });
    } catch (e) {
      return sendJson(res, 500, { error: '無法開啟資料夾選擇視窗：' + e.message });
    }
  }

  if (url.pathname === '/api/db-location' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      if (!body.folder) return sendJson(res, 400, { error: '缺少 folder' });
      debugLog('db', 'switching location', { folder: body.folder });
      return sendJson(res, 200, db.switchLocation(body.folder));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/db-location/confirm-default' && req.method === 'POST') {
    return sendJson(res, 200, db.confirmDefaultLocation());
  }

  if (url.pathname === '/api/prefs' && req.method === 'GET') {
    return sendJson(res, 200, db.getPrefs());
  }

  if (url.pathname === '/api/prefs' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      return sendJson(res, 200, db.savePrefs(body));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }

  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'not found' });

  return serveStatic(req, res, url.pathname);
});

const wss = new WebSocketServer({ server, path: '/ws' });
function broadcast(msg) {
  const payload = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(payload);
  }
}

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[chat-monitor] http://127.0.0.1:${PORT}`);
  console.log(`[chat-monitor] SQLite: ${db.DB_PATH}`);
  console.log(`[chat-monitor] debug 模式: ${DEBUG ? '開啟(log 同時寫進 data/debug.log)' : '關閉(設 CHAT_MONITOR_DEBUG=1 開啟)'}`);
});

process.on('SIGINT', () => {
  for (const platform of Object.keys(CONNECTOR_FACTORIES)) stopConnector(platform);
  process.exit(0);
});
