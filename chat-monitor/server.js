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

// chat-monitor 完全獨立,不依賴 yuupeek/ 資料夾同時存在——只讀自己資料夾底下的 .env(沒有就是
// no-op,不會出錯)。
if (fs.existsSync(path.join(__dirname, '.env'))) {
  require('dotenv').config({ path: path.join(__dirname, '.env'), quiet: true });
}

const db = require('./db');
const { createTwitchConnector } = require('./connectors/twitch');
const { createYoutubeConnector } = require('./connectors/youtube');
const { createSoopConnector } = require('./connectors/soop');
const Labels = require('./public/labels.js');

const PORT = process.env.CHAT_MONITOR_PORT || 3100;
const PUBLIC_DIR = path.join(__dirname, 'public');

// 第一次啟動(settings 表是空的)用 db.js 的 DEFAULT_CONFIG 當預設值就好。
db.seedSettingsIfEmpty();

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

// 每個 event_type 的模擬預設值——直接照抄 docs/event-types.md 記錄的真實抓包/程式碼推導格式
// (欄位名稱、有沒有值、字串長怎樣),不是隨便塞。目的是讓使用者(或呼叫 API 的外部工具)什麼都
// 不用填就能得到格式正確的假事件——不用自己去查文件、手寫 extra 的 JSON 結構,這是「根據處理方
// 的格式模擬」這個要求的落地方式。username 統一用通用的「模擬XX」字樣(不直接照抄文件裡真實
// 使用者的暱稱),避免看起來像是真的有人做了這個動作。
// message 故意在好幾個類型明寫 null(raid/submysterygift/supersticker/emoticon/三種 SOOP 抖內/
// subscribe)——這幾種真實情況下這個欄位就是沒有訊息文字(只有金額/人數/使用者名稱),不寫的話
// 會落到 buildSimulatedEvent() 的通用備援文字,畫面上會多出真實事件不會出現的一句話,失去
// 「照真實格式模擬」的意義。
const SIMULATE_FIXTURES = {
  // --- Twitch(見 docs/event-types.md「Twitch」章節)---
  chat_highlight: { message: '(頻道點數兌換的醒目留言內容)' },
  cheer: { message: 'Cheer100 加油加油！', amount: '100', extra: { badges: { bits: '1000' }, color: '#FF0000', messageParts: null } },
  sub: { amount: null, extra: { plan: '1000', multimonthDuration: null } }, // 一般單月新訂閱沒有 amount,見 sub 章節
  resub: { message: '感謝陪伴這麼久！', amount: '2', extra: { plan: '1000', streakMonths: 2, multimonthDuration: null } },
  subgift: { username: '模擬贈送者', message: '→ 模擬收禮者', amount: null, extra: { recipient: '模擬收禮者' } },
  submysterygift: { message: null, amount: '5' },
  raid: { message: null, amount: '42' }, // amount 語意是觀眾數,不是金額
  announcement: { message: '這是一則公告內容（原生 /announce）', extra: { msgId: 'announcement', color: 'PRIMARY' } },
  usernotice_other: { extra: { msgId: 'viewermilestone', color: null } },

  // --- YouTube(見 docs/event-types.md「YouTube」章節)---
  superchat: { message: '這是一則 Super Chat 留言', amount: 'NT$70.00', extra: { color: '#00E5FF', sticker: null, messageParts: null } },
  supersticker: { message: null, amount: 'NT$100.00', extra: { color: '#FF6D00', sticker: ':some-sticker:', messageParts: null } },
  membership_gift: { username: '模擬贈送者', message: '「模擬會籍方案」會籍', amount: '1', extra: { planName: '模擬會籍方案' } },
  membership_gift_received: { username: '模擬領取者', message: '← 模擬贈送者', amount: null, extra: { fromUsername: '模擬贈送者' } },

  // --- SOOP(見 docs/event-types.md「SOOP」章節)---
  emoticon: { message: null, extra: { userId: 'simuser(1)', emoticonId: '65863a0325db1' } },
  text_donation: { message: null, amount: '7', extra: { fanClubOrdinal: '0' } },
  video_donation: { message: null, amount: '7', extra: { fanClubOrdinal: '0' } },
  ad_balloon_donation: { message: null, amount: '1', extra: { fanClubOrdinal: '13972' } },
  subscribe: { message: null, amount: '2', extra: { tier: 1 } }, // amount 語意是月數,不是金額
  gift_item: { username: '模擬贈送者', message: '→ 模擬收禮者', amount: null, extra: { toUsername: '模擬收禮者', fromUserId: '1234567', toUserId: '7654321', itemType: 101 } },
  notification: { username: null, message: '主播自訂的系統通知文字' }, // 系統通知沒有發送者,見 notification 章節
};

// 模擬事件——不進 insertEvent()/SQLite(不跟真實歷史混在一起,「搜尋歷史訊息」也不會撈到假資料),
// 直接組一個跟 db.insertEvent() 回傳列同形狀的物件,原封不動走 broadcast(),讓 demo.js 完全不用
// 改就能照樣渲染——這是「模擬」機制存在的意義:外部工具(curl/瀏覽器 console/獨立小工具)呼叫這
// 支 API 就能在畫面上預覽任何事件類型長怎樣,不用真的等一筆抖內或訂閱發生。
// simulated:true 這個額外欄位是唯一跟真實事件的差異,demo.js 用它加一個「模擬」標籤區分。
// 三層覆寫順序:呼叫端傳的 overrides > SIMULATE_FIXTURES 的格式正確預設 > 通用備援值——用
// `!== undefined` 而不是 `??`,是因為 fixture 故意把某些欄位設成 null(例如 notification 的
// username、sub 的 amount)代表「這個類型真實情況就是沒有這個值」,不能被 `??` 當成「沒設定」
// 又跳到下一層備援。
function buildSimulatedEvent(eventType, overrides = {}) {
  const info = Labels.EVENT_TYPE_LABELS[eventType];
  if (!info) throw new Error(`未知的 event type: ${eventType}`);
  const fixture = SIMULATE_FIXTURES[eventType] || {};
  const pick = (key, fallback) => (overrides[key] !== undefined ? overrides[key] : (fixture[key] !== undefined ? fixture[key] : fallback));
  const now = new Date().toISOString();
  const extra = pick('extra', null);
  return {
    id: `sim-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    platform: overrides.platform || info.platform || 'youtube',
    source_detail: null,
    event_type: eventType,
    dedup_key: null,
    username: pick('username', '模擬使用者'),
    message: pick('message', `這是「${info.label}」的模擬訊息，用來預覽樣式`),
    amount: pick('amount', info.category === 'donation' ? '100' : null),
    extra_json: extra ? JSON.stringify(extra) : null,
    received_at: now,
    created_at: now,
    simulated: true,
  };
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

  if (url.pathname.startsWith('/api/simulate/') && req.method === 'POST') {
    const eventType = decodeURIComponent(url.pathname.split('/')[3] || '');
    try {
      const body = JSON.parse((await readBody(req)) || '{}');
      const evt = buildSimulatedEvent(eventType, body);
      broadcast({ type: 'event', data: evt });
      return sendJson(res, 200, evt);
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

  if (url.pathname === '/api/search' && req.method === 'GET') {
    const q = (url.searchParams.get('q') || '').trim();
    const from = (url.searchParams.get('from') || '').trim();
    const to = (url.searchParams.get('to') || '').trim();
    // type 是逗號分隔的 "平台:類型" 或 "平台:*"(該平台全部訊息,含一般聊天)清單(demo 頁的
    // 類型下拉選單是複選,OR 條件),拆成 { platform, eventType } 陣列給 db.js;eventType 是
    // null 代表「不限這個平台的類型」。空字串 split 完會變成 [''],用 filter(Boolean) 濾掉。
    const typeFilters = (url.searchParams.get('type') || '')
      .split(',').map((s) => s.trim()).filter(Boolean)
      .map((token) => {
        const [platform, eventType] = token.split(':');
        return { platform, eventType: eventType === '*' ? null : eventType };
      });
    // 四個條件全空就不查——不然會變成撈出全部歷史,不是「搜尋」;至少要有一個才查。
    if (!q && !from && !to && typeFilters.length === 0) return sendJson(res, 200, []);
    const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000);
    return sendJson(res, 200, db.searchEvents({ q, from, to, typeFilters, limit }));
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
