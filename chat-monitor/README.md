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

## 除錯與抓包（環境變數，可寫進 chat-monitor/.env）

- `CHAT_MONITOR_DEBUG=1`：三個平台一致——連上/斷線/錯誤都會印，同時印到 console 跟寫進
  `data/debug.log`。SOOP 額外印斷線時的原始 WebSocket close code；YouTube 額外印
  `start()`/`end()` 的結果跟原因。（2026-08-13 前只有 SOOP 有這個層級的 log，Twitch/YouTube
  完全沒有，已補齊到同樣詳細程度。）
- `CHAT_MONITOR_RAW_CAPTURE=1`：把「一般聊天以外」的所有事件，存進
  `data/raw-capture.jsonl`（JSON Lines，一行一筆）——存的是各平台函式庫給我們的**原始**
  回應物件（`res`/`tags`/`ChatItem`），不是我們自己篩選/重新命名過的欄位，所以像 SOOP
  `subscribe` 那種「我們自己讀錯欄位名稱」的 bug，比對這份原始紀錄就看得出來，不用像
  `gift_item`/徽章那幾次一樣，另外寫一次性診斷腳本連線抓包。SOOP 這邊額外會把完全不認識
  的封包類型（`unknown_<type code>`）也記下來，方便之後補齊套件沒解析的事件（已知的舊
  類型見「已知限制」的 `gift_item` 說明；2026-08-13 實測另外抓到一個新的 `unknown_0012`，
  疑似「使用者進入聊天室」的廣播通知，尚未解讀）。兩個變數預設都關閉，不影響正常監聽。

## 三平台涵蓋的事件類型

| 平台 | 一般聊天 | 特殊聊天類型 | 抖內/贊助類 |
|---|---|---|---|
| Twitch | `chat` | `chat_highlight`（頻道點數兌換的「醒目留言」） | `cheer`(bits)、`sub`/`resub`/`subgift`/`submysterygift`、`raid` |
| YouTube | `chat`（會員留言會多帶 `extra.isMembership`） | — | `superchat`、`supersticker` |
| SOOP（社群模式） | `chat`、`emoticon` | `notification`(系統通知) | `text_donation`、`video_donation`、`ad_balloon_donation`、`subscribe`、`gift_item`(快播Plus/訂閱禮物券等,自己反推封包格式接的,見已知限制) |
| SOOP（官方模式） | 尚未實作（跟 `yuupeek/src/chatListener.js` 現況一致，需要 SOOP 官方 API key） | | |

各類型的中文標籤與「等級/金額怎麼看」的說明集中在 [public/labels.js](public/labels.js)
（server 與前端共用同一份，避免兩邊漂移），demo 頁面下方也有一份可讀版本。

## 各事件類型驗證狀態（2026-08-13）

「驗證過」指的是實際連上真實頻道、看過真實事件跑過一次確認欄位正確——不是「程式碼邏輯看起來
合理」或「型別定義這樣寫」就算數。這份清單記錄目前到哪個程度，之後遇到對應事件時可以順便驗證、
更新這裡。

| 平台 | 事件 | 狀態 | 說明 |
|---|---|---|---|
| YouTube | 一般聊天 | ✅ 驗證過 | 多次收到真實訊息 |
| YouTube | Super Chat/Sticker | ⚠️ 沒驗證過 | 照套件型別定義寫的，沒收過真實 Super Chat 確認金額/顏色欄位 |
| YouTube | 會員留言（`isMembership`） | ✅ 驗證過 | 129 則真實會員聊天，欄位正確 |
| YouTube | 會員月數（`membershipHeader`） | ⚠️ 沒驗證過 | patch 邏輯有跑，但只確認「一般會員聊天正確回傳 null」，沒遇過真正的里程碑事件確認欄位內容 |
| YouTube | 訂閱／贈送訂閱 | 🚫 不支援 | `youtube-chat-next` 資料源頭沒有這個資訊，是已知限制不是漏測 |
| Twitch | 一般聊天 | ✅ 驗證過 | 多次收到真實訊息 |
| Twitch | Bits 抖內（`cheer`） | ⚠️ 沒驗證過 | 沒有實際看過一筆真的 cheer 事件跑過 |
| Twitch | 續訂月數（`resub`） | ⚠️ 沒驗證過 | `cumulative-months` 修法是查 `tmi.js` 原始碼推論，修完沒等到真實 resub 事件確認顯示結果 |
| Twitch | 新訂閱（`sub`） | ❌ 完全沒測過 | 寫完就沒特別驗證 |
| Twitch | 贈送訂閱（`subgift`/`submysterygift`） | ⚠️ 沒驗證過 | 「→ 收禮者」顯示邏輯寫了，沒有真實事件確認 |
| Twitch | 公告（`announcement`/`usernotice_other`） | ❌ 完全沒測過 | 剛加上去就因為測試環境撞到正式資料庫緊急關掉，連跑都沒跑過 |
| SOOP | 一般聊天 | ✅ 驗證過 | 大量真實訊息 |
| SOOP | 訂閱月數（`subscribe`） | ⚠️ 沒驗證過 | `res.amount` 修法用模擬封包跑過 `parseSubscribe()` 解構邏輯確認位置，沒有真實訂閱事件驗證顯示結果 |
| SOOP | 抖內（`text_donation`/`video_donation`/`ad_balloon_donation`） | ❌ 完全沒測過 | 連接器邏輯一開始就寫了，沒有 specifically 見過真實抖內事件跑過 |
| SOOP | 贈送禮物（`gift_item`） | ✅ 部分驗證 | 送禮者/收禮者暱稱對照過真實截圖確認正確，但金額/禮物項目名稱是空的、原始封包 `[6]`/`[7]` 欄位意義不明，這部分沒驗證 |

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
- **Twitch cheer 目前只有 bits 數字，沒有 Cheermote 圖片/動畫**（2026-08-13 使用者提供的
  研究方向，尚未實作，先記錄）：官方 Helix API `GET /helix/bits/cheermotes`
  （<https://dev.twitch.tv/docs/api/reference/#get-cheermotes>）能拿到每一階 tier 對應的
  圖片網址（dark/light、animated/static、多種尺寸），比自己畫圖或猜測可靠；更進階可以用
  EventSub `channel.bits.use` 訂閱拿結構化事件（fragments 已經把文字跟 cheermote 位置拆好，
  不用自己寫 regex 解析）。實作門檻：這兩者都需要 Twitch 開發者帳號的 **Client-ID**（Helix
  App/User Access Token 都要搭 Client-ID），跟現在 `connectors/twitch.js` 只用 `tmi.js`
  走 IRC、只填 OAuth Token 的方式不同，需要額外的憑證管理流程；使用者已決定暫不實作。
