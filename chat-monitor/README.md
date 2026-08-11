# chat-monitor — 聊天/抖內/特殊訊息 測試工具

獨立的小工具，跟 `yuupeek/`（桌面版）、`web/`（雲端版）平行，不會被 `web/sync.js` 或
`electron-builder` 打包進正式產物。用來即時觀察 Twitch / YouTube / SOOP 三個平台會送出
哪些聊天、抖內、特殊訊息事件，並把它們存進本機 SQLite 方便之後查閱格式。

## 啟動

```bash
cd chat-monitor
npm install      # 第一次
npm start        # http://127.0.0.1:3100
```

打開 `http://127.0.0.1:3100` 後，左側「平台設定」分頁（Twitch / YouTube / SOOP）就是
唯一要設定的地方——頻道名稱、金鑰（Twitch OAuth Token / YouTube API Key）、SOOP 連線
方式、啟用開關，填完按「儲存並套用」即可，全部存進 SQLite 的 `settings` 表，不用手動編輯
任何 `.env` 或 `.json` 檔。第一次啟動（`settings` 表是空的）會自動帶入
`yuupeek/config.json` 的頻道名稱 + `yuupeek/.env` 的金鑰當預設值，之後這兩個檔案就與
本工具無關了——改設定一律回到這個頁面改。右側是聊天視窗，每則訊息前面標 `[平台][類型]`。

金鑰目前以明碼存在本機 SQLite（伺服器只綁 `127.0.0.1`，不對外開放）；如果要用不同帳號
測試，直接在對應分頁覆寫金鑰欄位即可。

## SQLite 存在哪裡

`chat-monitor/data/events.sqlite`（demo 頁面左側也會顯示這個絕對路徑）。
想清空歷史：**關掉伺服器後直接刪除這個檔案**（連同可能的 `-wal` / `-shm`）即可，
下次啟動會自動重建空白資料庫。平台設定（頻道名稱、啟用狀態）也存在同一個檔案，
一併刪除後會用 `yuupeek/config.json` 的既有設定重新帶入一次。

`data/` 整個目錄已加進 `.gitignore`，不會被 commit。

## 三平台涵蓋的事件類型

| 平台 | 一般聊天 | 特殊聊天類型 | 抖內/贊助類 |
|---|---|---|---|
| Twitch | `chat` | `chat_highlight`（頻道點數兌換的「醒目留言」） | `cheer`(bits)、`sub`/`resub`/`subgift`/`submysterygift`、`raid` |
| YouTube | `chat` | — | `superchat`、`supersticker`、`membership_new`/`_milestone`/`_gift`/`_gift_received` |
| SOOP（社群模式） | `chat`、`emoticon` | `notification`(系統通知) | `text_donation`、`video_donation`、`ad_balloon_donation`、`subscribe` |
| SOOP（官方模式） | 尚未實作（跟 `yuupeek/src/chatListener.js` 現況一致，需要 SOOP 官方 API key） | | |

各類型的中文標籤與「等級/金額怎麼看」的說明集中在 [public/labels.js](public/labels.js)
（server 與前端共用同一份，避免兩邊漂移），demo 頁面下方也有一份可讀版本。

## 避免 restart 後重複寫入

每筆事件都算一個 `dedup_key`（Twitch/YouTube 用平台原生的訊息 id；SOOP 沒有 id，
用「類型+收到時間+使用者+內容」組出來），配合 `UNIQUE(platform, dedup_key)` +
`INSERT OR IGNORE`，同一事件重複送達（例如 reconnect）不會寫成兩筆。
另外 YouTube 輪詢跟 `yuupeek/src/chatListener.js` 用同一個規則：連線後的第一次
`liveChatMessages.list` 只拿 `nextPageToken` 當起點、不處理裡面的訊息，避免「一連上就把
開播以來的歷史訊息全部灌進來」。代價是：如果伺服器重開，重開期間漏掉的訊息不會補上
（漏訊息而不是重複訊息，這個工具的用途是觀察格式，這個取捨可接受）。

## 已知的錯誤狀態

- SOOP「主播目前沒開台」不是異常，[connectors/soop.js](connectors/soop.js) 會先用
  `client.live.detail()` 自己查一次直播狀態，未開台就直接回報乾淨的狀態訊息並每 30 秒
  重新查一次，不會呼叫到 soop-extension 內部那段一定會印出完整 stack trace 的
  `connect()` 錯誤路徑。真的連線失敗等非預期錯誤才會落到 try/catch，這種情況
  soop-extension 自己仍會印一份 log（外部無法關掉），但 demo 頁的狀態列一樣看得到乾淨訊息。

## 已知限制

- SOOP 官方 API 模式沒有實作（`yuupeek/` 裡目前也還沒有這個串接的文件可抄）。
- Twitch 的頻道點數兌換只能偵測「醒目留言」這種會出現在一般聊天訊息裡、帶
  `custom-reward-id` tag 的兌換項目；不會出現在聊天訊息裡的其他兌換（例如純粹的音效/
  特效類獎勵）不會被聽到，因為那些不走 IRC 聊天訊息，需要另外接 EventSub。
