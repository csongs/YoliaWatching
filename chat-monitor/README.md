# chat-monitor — 聊天/抖內/特殊訊息 測試工具

獨立的小工具，跟 `yuupeek/`（桌面版）、`web/`（雲端版）平行，不會被 `web/sync.js` 或
`electron-builder` 打包進正式產物，執行期也完全不依賴 `yuupeek/`（或任何其他資料夾）同時
存在——`chat-monitor` 資料夾單獨複製到別的地方一樣能跑。用來即時觀察 Twitch / YouTube /
SOOP 三個平台會送出哪些聊天、抖內、特殊訊息事件，並把它們存進本機 SQLite 方便之後查閱格式。

## 啟動

```bash
cd chat-monitor
npm install      # 第一次
npm start        # http://127.0.0.1:3100
```

打開 `http://127.0.0.1:3100` 後，左側「平台設定」分頁（Twitch / YouTube / SOOP）就是
唯一要設定的地方——頻道名稱、金鑰（Twitch OAuth Token）、SOOP 連線方式、啟用開關，填完按
「儲存並套用」即可，全部存進 SQLite 的 `settings` 表，不用手動編輯任何 `.env` 或 `.json` 檔。
第一次啟動（`settings` 表是空的）頻道名稱會帶入 `db.js` 內建的預設值（這個專案自己的實況主
`altheayolia`）；如果 `chat-monitor/.env` 有設 `TWITCH_OAUTH`，Twitch 的金鑰也會一併帶入，
純粹圖方便，不填一樣能用。改設定一律回到這個頁面改。右側是聊天視窗，每則訊息前面標
`[平台][類型]`。

YouTube 這邊改用 [youtube-chat-next](https://github.com/LucasSantana-Dev/youtube-chat-next)
（爬公開網頁聊天室，免 API Key）取代官方 `googleapis`，所以 YouTube 分頁只要填 handle
（`@xxx`）或頻道 ID（`UCxxxx`），不用填金鑰。

金鑰目前以明碼存在本機 SQLite（伺服器只綁 `127.0.0.1`，不對外開放）；如果要用不同帳號
測試，直接在對應分頁覆寫金鑰欄位即可。

## 打包給別人測試

```bash
npm run package
```

輸出到 `release/YoliaChatMonitor-source/`（資料夾版）與同目錄的
`YoliaChatMonitor-source.zip`——都被 `.gitignore` 排除，不會被 commit。裡面是完整原始碼
＋`install.bat`（自動抓 Node.js、裝套件）＋`start.bat`（啟動並開瀏覽器）＋中文使用說明，
拿到的人不用裝 Node.js、不用 clone repo，解壓縮後雙擊 `install.bat` 再雙擊 `start.bat`
即可。`install.bat`/`start.bat`/使用說明.txt 的可編輯來源在
[packaging/](packaging/)——改這三個檔案，不要直接改 `release/` 底下打包出來的副本
（下次 `npm run package` 會整個蓋掉）。

## SQLite 存在哪裡

預設在 `chat-monitor/data/events.sqlite`，但存放位置可以換——demo 頁面「SQLite 歷史紀錄」
面板有「變更存放位置…」按鈕，會跳出 Windows 原生的資料夾選擇視窗，選到的資料夾如果已經有
`events.sqlite` 會直接沿用（合併歷史，不會覆蓋）。目前實際用的路徑一律看 demo 頁面左側顯示
的絕對路徑，不要假設一定是預設位置。這個選擇存在 `chat-monitor/db-location.json`（跟
`events.sqlite` 分開存，已加進 `.gitignore`）。

想清空歷史：**關掉伺服器後直接刪除 events.sqlite**（連同可能的 `-wal` / `-shm`）即可，
下次啟動會在同一個資料夾自動重建空白資料庫。平台設定（頻道名稱、啟用狀態）也存在同一個
檔案，一併刪除後會用內建的預設頻道設定（`db.js` 的 `DEFAULT_CONFIG`）重新帶入一次。

`data/` 整個目錄已加進 `.gitignore`，不會被 commit。

## 三平台涵蓋的事件類型

| 平台 | 一般聊天 | 特殊聊天類型 | 抖內/贊助類 |
|---|---|---|---|
| Twitch | `chat` | `chat_highlight`（頻道點數兌換的「醒目留言」） | `cheer`(bits)、`sub`/`resub`/`subgift`/`submysterygift`、`raid` |
| YouTube | `chat`（會員留言會多帶 `extra.isMembership`） | — | `superchat`、`supersticker` |
| SOOP（社群模式） | `chat`、`emoticon` | `notification`(系統通知) | `text_donation`、`video_donation`、`ad_balloon_donation`、`subscribe`、`gift_item`(快播Plus/訂閱禮物券等,自己反推封包格式接的,見已知限制) |
| SOOP（官方模式） | 尚未實作（跟 `yuupeek/src/chatListener.js` 現況一致，需要 SOOP 官方 API key） | | |

各類型的中文標籤與「等級/金額怎麼看」的說明集中在 [public/labels.js](public/labels.js)
（server 與前端共用同一份，避免兩邊漂移），demo 頁面下方也有一份可讀版本。

## 避免 restart 後重複寫入

每筆事件都算一個 `dedup_key`（Twitch/YouTube 用平台原生的訊息 id；SOOP 沒有 id，
用「類型+收到時間+使用者+內容」組出來），配合 `UNIQUE(platform, dedup_key)` +
`INSERT OR IGNORE`，同一事件重複送達（例如 reconnect）不會寫成兩筆。
YouTube 這邊是即時輪詢（`youtube-chat-next`），不會回放開播以來的歷史訊息；代價是：
如果伺服器重開，重開期間漏掉的訊息不會補上（漏訊息而不是重複訊息，這個工具的用途是
觀察格式，這個取捨可接受）。

## 已知的錯誤狀態

- SOOP「主播目前沒開台」不是異常，[connectors/soop.js](connectors/soop.js) 會先用
  `client.live.detail()` 自己查一次直播狀態，未開台就直接回報乾淨的狀態訊息並每 30 秒
  重新查一次，不會呼叫到 soop-extension 內部那段一定會印出完整 stack trace 的
  `connect()` 錯誤路徑。真的連線失敗等非預期錯誤才會落到 try/catch，這種情況
  soop-extension 自己仍會印一份 log（外部無法關掉），但 demo 頁的狀態列一樣看得到乾淨訊息。

## 已知限制

- YouTube 改用 `youtube-chat-next` 爬公開網頁聊天室後，分不出會員留言是「新加入/連續/
  贈禮」（官方 API 才有這個分類），只能知道 `isMembership` 是不是會員；Super Chat/Sticker
  也只有金額字串跟顏色，沒有官方 API 的 tier 數字。細節見
  [connectors/youtube.js](connectors/youtube.js) 開頭註解。
- SOOP 官方 API 模式沒有實作（`yuupeek/` 裡目前也還沒有這個串接的文件可抄）。
- SOOP 的 `gift_item`（贈送禮物）不是 `soop-extension` 有支援的事件類型，是自己抓封包反推
  格式接上去的（2026-08-13，用 `CHAT_MONITOR_DEBUG=1` 抓包 + 比對實際截圖核對），沒有官方
  文件，只驗證過送禮者／收禮者暱稱正確；`amount` 欄位目前是空的（原始封包裡還有兩個意義不明
  的欄位，猜測跟禮物項目/數量有關，但沒把握，都存在 `extra.raw` 裡供之後回頭查）。細節見
  [connectors/soop.js](connectors/soop.js) 的 `GIFT_ITEM_TYPE` 註解。
- Twitch 的頻道點數兌換只能偵測「醒目留言」這種會出現在一般聊天訊息裡、帶
  `custom-reward-id` tag 的兌換項目；不會出現在聊天訊息裡的其他兌換（例如純粹的音效/
  特效類獎勵）不會被聽到，因為那些不走 IRC 聊天訊息，需要另外接 EventSub。
