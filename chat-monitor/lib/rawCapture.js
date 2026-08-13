// 常駐版的「抓包」工具——把之前每次要查未知欄位就手寫一次性診斷腳本(SOOP 徽章/gift_item 那幾次)
// 變成內建功能。預設關閉,設環境變數 CHAT_MONITOR_RAW_CAPTURE=1(可寫進 chat-monitor/.env)才會寫,
// 寫進 chat-monitor/data/raw-capture.jsonl(JSON Lines,一行一筆,方便之後 grep/逐行讀)。
// 刻意只跳過「一般聊天」,其餘所有特殊事件(cheer/sub/donation/會員/未知封包等)都收——連已經
// 確定會解析的事件也收原始欄位,因為「我們的解析邏輯本身讀錯欄位」這類 bug(例如 SOOP 訂閱月數
// 讀 monthCount 結果實際欄位叫 amount)只有比對原始資料才抓得到,單看我們自己輸出的結果看不出來。
//
// 2026-08-14:抓了一陣子之後,有些 eventType(欄位對應已經拿真實樣本核對過,見
// docs/event-types.md 標「✅ 真實抓包」的項目)再繼續收只是让 raw-capture.jsonl 一直塞進
// 重複的東西——用 CHAT_MONITOR_RAW_CAPTURE_SKIP(逗號分隔的 "platform:eventType",
// 例如 "twitch:sub,twitch:announcement";"platform:*" 可以整個平台跳過)讓使用者自己決定
// 哪些先不收,不寫死在程式碼裡——之後想重新驗證某個類型,直接從 .env 拿掉那一項就好,
// 不用改程式碼。沒設這個變數就是全部都收(原本的行為)。
const fs = require('fs');
const path = require('path');

const RAW_CAPTURE = process.env.CHAT_MONITOR_RAW_CAPTURE === '1' || process.env.CHAT_MONITOR_RAW_CAPTURE === 'true';
const CAPTURE_PATH = path.join(__dirname, '..', 'data', 'raw-capture.jsonl');

const SKIP_SET = new Set(
  (process.env.CHAT_MONITOR_RAW_CAPTURE_SKIP || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
);

function isSkipped(platform, eventType) {
  return SKIP_SET.has(`${platform}:${eventType}`) || SKIP_SET.has(`${platform}:*`);
}

function rawCapture(platform, eventType, raw) {
  if (!RAW_CAPTURE || isSkipped(platform, eventType)) return;
  const line = JSON.stringify({ capturedAt: new Date().toISOString(), platform, eventType, raw });
  try {
    fs.mkdirSync(path.dirname(CAPTURE_PATH), { recursive: true });
    fs.appendFileSync(CAPTURE_PATH, line + '\n');
  } catch { /* 寫檔失敗不影響監聽本身 */ }
}

module.exports = { RAW_CAPTURE, rawCapture };
