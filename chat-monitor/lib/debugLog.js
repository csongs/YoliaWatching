// 共用的除錯 log 工具——預設關閉,平常雙擊 start.bat 不會多印東西干擾聊天視窗。設定環境變數
// CHAT_MONITOR_DEBUG=1(可以寫進 chat-monitor/.env)才會印,同時印到 console 跟寫進
// chat-monitor/data/debug.log(data/ 已在 .gitignore,不會被 commit),方便診斷完把整份 log
// 檔案丟出來看,不用一直開著黑色視窗盯著。
const fs = require('fs');
const path = require('path');

const DEBUG = process.env.CHAT_MONITOR_DEBUG === '1' || process.env.CHAT_MONITOR_DEBUG === 'true';
const LOG_PATH = path.join(__dirname, '..', 'data', 'debug.log');

function debugLog(...args) {
  if (!DEBUG) return;
  const body = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
  const line = `[${new Date().toISOString()}] ${body}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, line + '\n');
  } catch { /* 寫檔失敗不影響監聽本身,console.log 那份還在 */ }
}

module.exports = { DEBUG, debugLog };
