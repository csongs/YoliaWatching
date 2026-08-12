// 獨立測試工具的伺服器——不依附 yuupeek 的 Electron 主程序或 obsServer.js,單純用
// node server.js 啟動,也不依賴 yuupeek/ 資料夾同時存在。
// 連線邏輯(tmi.js/youtube-chat-next/soop-extension 的用法)參考 yuupeek/src/chatListener.js,
// 但輸出目標從「幽視值狀態機」換成「SQLite 事件歷史 + demo 頁面」。
const path = require('path');
const fs = require('fs');
const http = require('http');
const { WebSocketServer } = require('ws');
const { DEBUG, debugLog } = require('./lib/debugLog');

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
function loadSeedFromYuupeekConfig() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'yuupeek', 'config.json'), 'utf8')); } catch { /* 沒有就用空預設 */ }
  return {
    twitch: { enabled: !!cfg.twitch?.enabled, config: { channel: cfg.twitch?.channel ?? '', oauthToken: process.env.TWITCH_OAUTH ?? '' } },
    youtube: { enabled: !!cfg.youtube?.enabled, config: { channel: cfg.youtube?.channel ?? '' } },
    soop: { enabled: !!cfg.soop?.enabled, config: { channel: cfg.soop?.channel ?? '', apiMode: cfg.soop?.apiMode ?? 'community' } },
  };
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
