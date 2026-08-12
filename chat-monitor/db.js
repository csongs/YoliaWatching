// SQLite 儲存層——事件歷史 + 平台設定都存在同一個檔案。存放位置預設在 chat-monitor/data/,
// 使用者可以在畫面上用「瀏覽並選擇位置」換到別的資料夾(見 openDatabase()/switchLocation())。
// 「換到哪裡」這個選擇本身不能存進 SQLite 裡——都還沒開資料庫,要去哪裡讀這個選擇本身?——所以
// 另外用一個固定位置、跟 events.sqlite 分開的小 JSON 檔案(LOCATION_CONFIG_PATH)記錄。
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const LOCATION_CONFIG_PATH = path.join(__dirname, 'db-location.json');

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    source_detail TEXT,
    event_type TEXT NOT NULL,
    dedup_key TEXT NOT NULL,
    username TEXT,
    message TEXT,
    amount TEXT,
    extra_json TEXT,
    received_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(platform, dedup_key)
  );
  CREATE INDEX IF NOT EXISTS idx_events_received_at ON events(received_at);

  CREATE TABLE IF NOT EXISTS settings (
    platform TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    config_json TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS prefs (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
  );
`;

function readLocationConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(LOCATION_CONFIG_PATH, 'utf8'));
    if (raw.folder) return { folder: raw.folder, chosen: !!raw.chosen };
  } catch { /* 沒有這個檔案,或壞掉——當作還沒選過,用預設值 */ }
  return { folder: DEFAULT_DATA_DIR, chosen: false };
}

function writeLocationConfig(folder, chosen) {
  fs.writeFileSync(LOCATION_CONFIG_PATH, JSON.stringify({ folder, chosen }, null, 2));
}

let db, DB_PATH, insertStmt, upsertSettingsStmt, upsertPrefStmt;

// 開啟(或換到)指定資料夾底下的 events.sqlite——資料夾裡如果已經有這個檔案就直接沿用(合併歷史,
// 不會覆蓋或清空),沒有就建立新的空白資料庫,CREATE TABLE IF NOT EXISTS 兩種情況都安全。
// 新連線確認開成功、schema 也建好之後才關掉舊連線;中途失敗(例如資料夾沒有寫入權限)會直接
// throw,舊連線維持原樣不受影響,不會讓整個 app 陷入沒資料庫可用的狀態。
function openDatabase(folder) {
  fs.mkdirSync(folder, { recursive: true });
  const newPath = path.join(folder, 'events.sqlite');
  const newDb = new Database(newPath);
  newDb.pragma('journal_mode = WAL');
  newDb.exec(SCHEMA_SQL);

  const newInsertStmt = newDb.prepare(`
    INSERT OR IGNORE INTO events
      (platform, source_detail, event_type, dedup_key, username, message, amount, extra_json, received_at)
    VALUES
      (@platform, @sourceDetail, @eventType, @dedupKey, @username, @message, @amount, @extraJson, @receivedAt)
  `);
  const newUpsertSettingsStmt = newDb.prepare(`
    INSERT INTO settings (platform, enabled, config_json, updated_at)
    VALUES (@platform, @enabled, @configJson, datetime('now'))
    ON CONFLICT(platform) DO UPDATE SET
      enabled = excluded.enabled,
      config_json = excluded.config_json,
      updated_at = excluded.updated_at
  `);
  const newUpsertPrefStmt = newDb.prepare(`
    INSERT INTO prefs (key, value_json) VALUES (@key, @valueJson)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
  `);

  if (db) db.close();
  db = newDb;
  DB_PATH = newPath;
  insertStmt = newInsertStmt;
  upsertSettingsStmt = newUpsertSettingsStmt;
  upsertPrefStmt = newUpsertPrefStmt;
}

openDatabase(readLocationConfig().folder);

function getLocationInfo() {
  return { folder: path.dirname(DB_PATH), chosen: readLocationConfig().chosen, defaultFolder: DEFAULT_DATA_DIR };
}

function switchLocation(folder) {
  openDatabase(folder); // 失敗會直接 throw,呼叫端(server.js)接住轉成 400 回應
  writeLocationConfig(folder, true);
  return getLocationInfo();
}

function confirmDefaultLocation() {
  writeLocationConfig(path.dirname(DB_PATH), true);
  return getLocationInfo();
}

// dedup_key 必須是「同一事件重送時會算出相同值」的東西——每平台的組法見各 connector。
// 用 INSERT OR IGNORE + UNIQUE(platform, dedup_key) 擋掉 reconnect/restart 造成的重複寫入。
function insertEvent(evt) {
  const row = {
    platform: evt.platform,
    sourceDetail: evt.sourceDetail ?? null,
    eventType: evt.eventType,
    dedupKey: evt.dedupKey,
    username: evt.username ?? null,
    message: evt.message ?? null,
    amount: evt.amount ?? null,
    extraJson: evt.extra ? JSON.stringify(evt.extra) : null,
    receivedAt: evt.receivedAt,
  };
  const result = insertStmt.run(row);
  if (result.changes === 0) return null; // 重複事件,已存在,略過
  return db.prepare('SELECT * FROM events WHERE id = ?').get(result.lastInsertRowid);
}

function getRecentEvents(limit = 200) {
  return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit).reverse();
}

function getStats() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM events').get();
  let fileSizeBytes = 0;
  try { fileSizeBytes = fs.statSync(DB_PATH).size; } catch { /* 檔案還沒建立(第一次寫入前) */ }
  return { count: row.count, path: DB_PATH, fileSizeBytes };
}

// ── 平台設定 ──────────────────────────────────────────────────────────────
// 三個平台各一列,config_json 存平台專屬欄位(channel/apiMode 等),不用另開一堆欄位。
// 頻道預設值是這個專案(YoliaWatching)自己的實況主 altheayolia——chat-monitor 是這個專案
// 內部用的觀察工具,不是給不認識的陌生人的通用產品,直接把預設值寫死在這裡最單純,也不用
// 依賴 yuupeek/ 資料夾同時存在才能 seed;協作者要測別的頻道,進「平台設定」分頁改掉存檔即可。
// 啟用開關預設仍是 false,不會一解壓縮就自動連線。
const DEFAULT_CONFIG = {
  twitch: { channel: 'altheayolia', oauthToken: '' },
  youtube: { channel: '@altheayolia' },
  soop: { channel: 'altheayolia', apiMode: 'community' },
};

function seedSettingsIfEmpty(seed = {}) {
  const existing = db.prepare('SELECT COUNT(*) AS count FROM settings').get().count;
  if (existing > 0) return;
  for (const platform of Object.keys(DEFAULT_CONFIG)) {
    const cfg = { ...DEFAULT_CONFIG[platform], ...(seed[platform]?.config ?? {}) };
    upsertSettingsStmt.run({
      platform,
      enabled: seed[platform]?.enabled ? 1 : 0,
      configJson: JSON.stringify(cfg),
    });
  }
}

function getSettings() {
  const rows = db.prepare('SELECT * FROM settings').all();
  const out = {};
  for (const platform of Object.keys(DEFAULT_CONFIG)) {
    const row = rows.find((r) => r.platform === platform);
    out[platform] = row
      ? { enabled: !!row.enabled, ...JSON.parse(row.config_json) }
      : { enabled: false, ...DEFAULT_CONFIG[platform] };
  }
  return out;
}

function saveSettings(platform, { enabled, ...config }) {
  if (!DEFAULT_CONFIG[platform]) throw new Error(`unknown platform: ${platform}`);
  const current = getSettings()[platform];
  const merged = { ...DEFAULT_CONFIG[platform], ...current, ...config };
  delete merged.enabled;
  upsertSettingsStmt.run({ platform, enabled: enabled ? 1 : 0, configJson: JSON.stringify(merged) });
  return getSettings()[platform];
}

// ── 介面偏好設定(跟平台無關,例如「顯示時間戳」這種畫面選項)──────────────────
// 跟 settings 表分開,是因為 settings 的 saveSettings()/API 綁定 CONNECTOR_FACTORIES,
// 存檔會觸發 restartConnector(platform)——這裡存的是純畫面選項,不該觸發任何連線重啟。
function getPrefs() {
  const rows = db.prepare('SELECT * FROM prefs').all();
  const out = {};
  for (const row of rows) out[row.key] = JSON.parse(row.value_json);
  return out;
}

function savePrefs(patch) {
  for (const [key, value] of Object.entries(patch)) {
    upsertPrefStmt.run({ key, valueJson: JSON.stringify(value) });
  }
  return getPrefs();
}

module.exports = {
  insertEvent, getRecentEvents, getStats,
  get DB_PATH() { return DB_PATH; },
  getLocationInfo, switchLocation, confirmDefaultLocation,
  seedSettingsIfEmpty, getSettings, saveSettings,
  getPrefs, savePrefs,
};
