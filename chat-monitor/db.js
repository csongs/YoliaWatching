// SQLite 儲存層——事件歷史 + 平台設定都存在同一個檔案。DB 檔案位置固定在
// chat-monitor/data/events.sqlite,demo 頁面會顯示這個絕對路徑,方便 user 直接刪檔清空一切
// (事件歷史 + 設定一起清空,重開伺服器會用內建預設值重新 seed 設定)。
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'events.sqlite');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
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
`);

// dedup_key 必須是「同一事件重送時會算出相同值」的東西——每平台的組法見各 connector。
// 用 INSERT OR IGNORE + UNIQUE(platform, dedup_key) 擋掉 reconnect/restart 造成的重複寫入。
const insertStmt = db.prepare(`
  INSERT OR IGNORE INTO events
    (platform, source_detail, event_type, dedup_key, username, message, amount, extra_json, received_at)
  VALUES
    (@platform, @sourceDetail, @eventType, @dedupKey, @username, @message, @amount, @extraJson, @receivedAt)
`);

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
const DEFAULT_CONFIG = {
  twitch: { channel: '', oauthToken: '' },
  youtube: { channel: '' },
  soop: { channel: '', apiMode: 'community' },
};

const upsertSettingsStmt = db.prepare(`
  INSERT INTO settings (platform, enabled, config_json, updated_at)
  VALUES (@platform, @enabled, @configJson, datetime('now'))
  ON CONFLICT(platform) DO UPDATE SET
    enabled = excluded.enabled,
    config_json = excluded.config_json,
    updated_at = excluded.updated_at
`);

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
const upsertPrefStmt = db.prepare(`
  INSERT INTO prefs (key, value_json) VALUES (@key, @valueJson)
  ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
`);

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
  insertEvent, getRecentEvents, getStats, DB_PATH,
  seedSettingsIfEmpty, getSettings, saveSettings,
  getPrefs, savePrefs,
};
