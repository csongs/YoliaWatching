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
唯一要設定的地方——頻道名稱、SOOP 連線方式、啟用開關，填完按「儲存並套用」即可，全部存進
SQLite 的 `settings` 表，不用手動編輯任何 `.env` 或 `.json` 檔。第一次啟動（`settings`
表是空的）頻道名稱會帶入 `db.js` 內建的預設值（這個專案自己的實況主 `altheayolia`）。
改設定一律回到這個頁面改。右側是聊天視窗，每則訊息前面標 `[平台][類型]`。

YouTube 這邊改用 [youtube-chat-next](https://github.com/LucasSantana-Dev/youtube-chat-next)
（爬公開網頁聊天室，免 API Key）取代官方 `googleapis`，所以 YouTube 分頁只要填 handle
（`@xxx`）或頻道 ID（`UCxxxx`），不用填金鑰。

Twitch 也不用填金鑰——匿名連線即可讀聊天（見下面「Twitch 免 Token（匿名）模式」）。畫面上
沒有 Token 輸入欄位；真的需要用已登入身分連線（除錯/進階用途）可以在
`chat-monitor/.env` 設 `TWITCH_OAUTH`，連接器會直接讀這個環境變數，不會存進 SQLite
也不會顯示在畫面上。

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
  的封包類型（`unknown_<type code>`）也記下來，方便之後補齊套件沒解析的事件（`gift_item`
  的 `0045` 見「已知限制」；其餘常見的 `unknown_0012`/`0014`/`0054`/`0090`/`0094`/`0110`
  2026-08-14 已經對照另一個獨立反推同一套協定的 Java 函式庫查出真實身分——都是使用者旗標/
  暱稱變更、管理功能狀態、內部握手之類跟聊天內容無關的封包，決定不接成正式事件，細節見
  [docs/event-types.md](docs/event-types.md)）。兩個變數預設都關閉，不影響正常監聽。
- `CHAT_MONITOR_RAW_CAPTURE_SKIP`：逗號分隔的 `platform:eventType` 清單，列在裡面的
  事件類型即使 `CHAT_MONITOR_RAW_CAPTURE=1` 也不會寫進 `raw-capture.jsonl`——欄位對應
  已經拿真實樣本核對過的類型（[docs/event-types.md](docs/event-types.md) 標「✅ 真實
  抓包」的那些）繼續收只是灌水，先跳過讓檔案聚焦在還沒驗證過的類型上。`platform:*`
  可以整個平台跳過。例：`CHAT_MONITOR_RAW_CAPTURE_SKIP=youtube:membership,twitch:sub`。
  之後想重新驗證某個類型，直接從這個清單刪掉那一項即可，不用改程式碼。

## 三平台涵蓋的事件類型

| 平台 | 一般聊天 | 特殊聊天類型 | 抖內/贊助類 |
|---|---|---|---|
| Twitch | `chat` | `chat_highlight`（頻道點數兌換的「醒目留言」） | `cheer`(bits)、`sub`/`resub`/`subgift`/`submysterygift`、`raid` |
| YouTube | `chat`（會員留言會多帶 `extra.isMembership`） | — | `superchat`、`supersticker` |
| SOOP（社群模式） | `chat`、`emoticon` | `notification`(系統通知) | `text_donation`、`video_donation`、`ad_balloon_donation`、`subscribe`、`gift_item`(快播Plus/訂閱禮物券等,自己反推封包格式接的,見已知限制) |
| SOOP（官方模式） | 尚未實作（跟 `yuupeek/src/chatListener.js` 現況一致，需要 SOOP 官方 API key） | | |

各類型的中文標籤與「等級/金額怎麼看」的說明集中在 [public/labels.js](public/labels.js)
（server 與前端共用同一份，避免兩邊漂移），demo 頁面下方也有一份可讀版本。

每種事件的原始資料長怎樣、對應哪個 `event_type`、demo 頁怎麼渲染，細節版整理在
[docs/event-types.md](docs/event-types.md)。

## 各事件類型驗證狀態（2026-08-13）

「驗證過」指的是實際連上真實頻道、看過真實事件跑過一次確認欄位正確——不是「程式碼邏輯看起來
合理」或「型別定義這樣寫」就算數。這份清單記錄目前到哪個程度，之後遇到對應事件時可以順便驗證、
更新這裡。

| 平台 | 事件 | 狀態 | 說明 |
|---|---|---|---|
| YouTube | 一般聊天 | ✅ 驗證過 | 多次收到真實訊息 |
| YouTube | Super Chat/Sticker | ⚠️ 沒驗證過 | 照套件型別定義寫的，沒收過真實 Super Chat 確認金額/顏色欄位 |
| YouTube | 會員留言（`isMembership`） | ✅ 驗證過 | 129 則真實會員聊天，欄位正確 |
| YouTube | 會員月數（`membershipMonths`，來自 `badge.label`） | ✅ 驗證過 | 237 筆真實會員留言，正則 100% 正確解析「New member」/「Member (N months)」；2026-08-14 額外抓到「Member (1 year)」格式（滿一年後改用「年」當單位），已補上解析，換算成 12 個月 |
| YouTube | 里程碑通知文字（`membershipHeader`，來自 `headerSubtext`） | ⚠️ 沒驗證過 | patch 邏輯有跑，但只確認「一般會員聊天正確回傳 null」，沒遇過真正的里程碑事件確認欄位內容；現在只是補充來源，不是主要依賴 |
| YouTube | 訂閱／贈送訂閱 | 🚫 不支援 | `youtube-chat-next` 資料源頭沒有這個資訊，是已知限制不是漏測 |
| Twitch | 一般聊天 | ✅ 驗證過 | 多次收到真實訊息 |
| Twitch | Bits 抖內（`cheer`） | ⚠️ 沒驗證過 | 沒有實際看過一筆真的 cheer 事件跑過 |
| Twitch | 續訂月數（`resub`） | ⚠️ 沒驗證過 | `cumulative-months` 修法是查 `tmi.js` 原始碼推論，修完沒等到真實 resub 事件確認顯示結果 |
| Twitch | 新訂閱（`sub`） | ⚠️ 部分驗證 | 2026-08-13 已用 `CHAT_MONITOR_RAW_CAPTURE` 抓到真實 `sub` 封包（Prime 與付費 Tier 1 各一筆），`msg-param-sub-plan` 欄位存在且正確，但沒有實際在 demo 頁看過渲染結果 |
| Twitch | 贈送訂閱（`subgift`/`submysterygift`） | ⚠️ 部分驗證 | 2026-08-13 抓到真實連續贈送（5 筆 `subgift` + 1 筆 `submysterygift`），`msg-param-recipient-user-name`/`msg-param-mass-gift-count` 欄位都在，但沒有實際在 demo 頁看過渲染結果 |
| Twitch | 公告（`announcement`） | ⚠️ 部分驗證 | 2026-08-13 抓到真實公告封包（來自 StreamBoostMaxBot，`msg-param-color` 存在），證實真的是原生 `/announce`，但沒有實際在 demo 頁看過渲染結果 |
| Twitch | 其他系統通知（`usernotice_other`） | ⚠️ 部分驗證 | 2026-08-13 抓到一種先前完全沒見過的類型 `viewermilestone`（連續觀看場次里程碑），確認有正確落入這個備援分類，但沒有針對性驗證過其他 `msgid` 子類型 |
| SOOP | 一般聊天 | ✅ 驗證過 | 大量真實訊息 |
| SOOP | 訂閱月數（`subscribe`） | ⚠️ 沒驗證過 | `res.amount` 修法用模擬封包跑過 `parseSubscribe()` 解構邏輯確認位置，沒有真實訂閱事件驗證顯示結果；另外發現這個事件可能只在續訂觸發，新訂閱是另一個協定類型，見「已知限制」 |
| SOOP | 文字/語音抖內（`text_donation`） | ✅ 部分驗證 | 2026-08-14 抓到真實連續送星球封包（27 顆，同一人），`amount`/`fromUsername`/`fanClubOrdinal` 欄位都正確，但沒有實際在 demo 頁看過渲染結果 |
| SOOP | 廣告氣球抖內（`ad_balloon_donation`） | ✅ 部分驗證 | 2026-08-14 抓到真實封包，`fromUsername`/`amount`/`fanClubOrdinal` 欄位都正確，但沒有實際在 demo 頁看過渲染結果 |
| SOOP | 影片抖內（`video_donation`） | ❌ 完全沒測過 | 欄位結構跟已驗證的 `text_donation`/`ad_balloon_donation` 相同（只是抖內管道不同），這個管道本身還沒實測過 |
| SOOP | 表情訊息（`emoticon`） | ⚠️ 部分驗證 | 2026-08-14 抓到真實封包，`emoticonId`/`userId`/`username` 欄位都在，但查出這個 `emoticonId` 是 OGQ 雜湊 ID，換不出圖片網址，圖片渲染沒接上（跟下面 `chat` 訊息裡的 `/代碼/` 圖片渲染是不同系統） |
| SOOP | 聊天表情符號圖片渲染（`chat` 的 `/代碼/`） | ⚠️ 部分驗證 | 2026-08-14 用真實抓到的 `/하트//하트//하트/`（經典目錄）、`/ㅗㅜㅑ//락//ㅗㅜㅑ//락/`（signature emoticon 目錄）驗證過兩套目錄合併後轉換邏輯都正確、圖片網址也 curl 驗證過能載入，但沒有實際在 demo 頁看過渲染結果 |
| SOOP | 贈送禮物（`gift_item`） | ✅ 部分驗證 | 送禮者/收禮者暱稱對照過真實截圖確認正確；2026-08-14 交叉核對 soopapi 修正了送禮者/收禮者 userId 欄位（原本誤標）、補上 `itemType` 欄位，但 `itemType` 數字對應的道具名稱、`amount` 欄位還是不知道 |

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

## Twitch 免 Token（匿名）模式

**2026-08-13 之前這個模式其實是壞的**，不是「能用但功能少」：`tmi.js` 的匿名登入需要
username 符合 `justinfan#####` 格式、由套件自己產生，配上它內部固定送出的特殊密碼
（見 `node_modules/tmi.js/lib/client.js` 的 `_.justinfan()`/`isJustinfan()`）；原本沒填
Token 時，程式碼仍然把 `identity.username` 設成頻道名稱、密碼留空，兩邊都不符合「匿名連線」
的判斷條件，變成送出沒有 `PASS` 的 `NICK`，Twitch 直接回「Improperly formatted auth」
（user 實測撞到過，還連帶讓整個伺服器當機——見 stop() 那個未接 `.catch()` 的修復）。
已修正：沒有 Token 時完全不傳 `identity`，讓 `tmi.js` 自己走內建的匿名登入流程，實測
（隔離環境）確認連線穩定、不再報錯。

**修好之後匿名模式收得到什麼**：連線本身確認正常。訂閱/Bits 等 `USERNOTICE`/帶 `bits` tag
的 `PRIVMSG` 依 Twitch IRC 協定是廣播給聊天室裡所有人的，不是只有登入的使用者看得到，
理論上匿名連線應該跟有 Token 一樣收得到——但這是根據協定推論，**這個 session 沒有實際
等到一筆真實 cheer/sub 事件在匿名連線下跑過確認**，測試當下頻道剛好沒人聊天/斗內。
之前 UI 上「留空可匿名讀取聊天，但收不到訂閱/Bits 以外資訊」這句話的說法沒有查證來源，
既然连線機制本身都是壞的，這個附帶說法的可信度也存疑，已從畫面上拿掉。

## 表情符號圖片（2026-08-13）

聊天訊息裡的表情符號/emoji，只要來源有給圖片網址就會實際渲染成 `<img>`（不是文字
shortcode），存在事件的 `extra.messageParts`（文字/表情圖片交錯的陣列），`message`
欄位仍然保留純文字版本當退回值跟搜尋用。

- **YouTube**：`youtube-chat-next` 的 `EmojiItem` 本來就帶 `url`（見
  `dist/types/data.d.ts`），之前 `messageToText()` 直接把網址丟掉只留 alt 文字，現在留著。
  用真實抓到的資料（`data/raw-capture.jsonl` 裡的 `:face-blue-smiling:` 樣本）驗證過解析
  邏輯正確。
- **Twitch**：從 `tags.emotes`（`tmi.js` 解析過的表情位置，見
  `node_modules/tmi.js/lib/parser.js` 的 `parseComplexTag`）算出文字/表情的交錯位置，
  圖片網址用 Twitch 官方公開、多年沒變的 CDN 規則自己組
  （`https://static-cdn.jtvnw.net/emoticons/v2/{id}/default/dark/{scale}.0`，跟
  Helix `Get Channel/Global Emotes` API 回傳的網址同樣式）。2026-08-13 用
  `CHAT_MONITOR_RAW_CAPTURE` 抓到真實 `chat_highlight` 訊息（帶新格式的長雜湊 emote id
  `emotesv2_893ee80f475246b0bd0a3fa5205f33cc`），curl 驗證過 CDN 網址對這個真實 id 回傳
  `200 image/png`，證實網址規則對新舊兩種 id 格式都成立；但**切割邏輯本身（位置區間對應到
  正確的文字/表情片段）仍然只用手動模擬資料驗證過，還沒拿這筆真實訊息實際跑過 `demo.js`
  確認渲染結果正確**。
- **SOOP**：一般 `chat` 訊息裡可以直接打 `/코드명/`（例如 `/하트/`、`/갱응원/`）這種斜線包住的
  表情符號代碼，2026-08-14 找到兩套目錄、**都已經接上圖片渲染**（`connectors/soop.js` 的
  `buildEmoticonMessageParts()`，連線時背景抓一次）：全站共用的「經典」靜態目錄
  `res.sooplive.com/images/chat/emoticon/big/list.json`（123 筆）＋主播專屬的
  「signature emoticon」API `live.sooplive.com/api/signature_emoticon_api.php`（使用者從
  瀏覽器開發者工具「網路」分頁找到的真實請求，照目前連線頻道抓，測試頻道另外 44 筆，含動畫
  版）——兩套合併後，認得的代碼會變成 `<img>`，不認得的照樣顯示原始文字，不是全有全無。
  獨立的 `emoticon` 事件（`emoticonId`）是完全不同的系統——查到那是 OGQ（第三方貼圖市集）的
  雜湊 ID，跟上面兩套代碼都對不起來，OGQ 圖片網域也不一樣
  （`ogq-sticker-global-cdn-z01.sooplive.com`），這部分還是沒有圖片渲染，是目前唯一還沒解掉
  的表情符號缺口。細節見 [docs/event-types.md](docs/event-types.md) 的 `chat`／`emoticon` 章節。

## 已知限制

- YouTube 改用 `youtube-chat-next` 爬公開網頁聊天室後，分不出會員留言是「新加入/連續/
  贈禮」（官方 API 才有這個分類）。**月數本身查得到**——2026-08-13 用
  `CHAT_MONITOR_RAW_CAPTURE` 實測 237 筆真實會員留言發現 `author.badge.label` 每則都有
  「New member」/「Member (N months)」文字，已改成從這裡解析 `extra.membershipMonths`；
  滿一年後格式會變成「Member (N year(s))」（2026-08-14 真實抓到「Member (1 year)」才發現，
  已補上解析，換算成 12 的倍數）。「這個月是不是剛好是贈禮/里程碑那一則」還是分不出來，
  只知道當下累積月數。Super Chat/Sticker 也只有金額字串跟顏色，沒有官方 API 的 tier 數字。
  細節見 [connectors/youtube.js](connectors/youtube.js) 開頭註解。
- 同一則訊息同時是 Super Chat**又**是會員（`superchat` 跟 `isMembership` 兩個欄位都為真，
  2026-08-14 真實遇到過）時，目前 `classifyItem()` 只會走 `superchat` 分支——`event_type`
  是 `superchat`，`extra` 完全沒有 `membershipMonths`/`membershipBadge` 這幾個欄位，
  demo 頁看不出這位付費的人同時是會員、也看不出月數。還沒有處理，屬於已知落差。
- SOOP 官方 API 模式沒有實作（`yuupeek/` 裡目前也還沒有這個串接的文件可抄）。
- SOOP 的 `gift_item`（贈送禮物）不是 `soop-extension` 有支援的事件類型，是自己抓封包反推
  格式接上去的（2026-08-13，用 `CHAT_MONITOR_DEBUG=1` 抓包 + 比對實際截圖核對）。2026-08-14
  用另一個獨立反推同一套協定的非官方 Java 函式庫
  [getCurrentThread/soopapi](https://github.com/getCurrentThread/soopapi) 交叉核對，補上/修正了
  幾個欄位（原本誤標成「送禮者 userId」的其實是收禮者 userId；原本「意義不明」的欄位其實是
  `itemType` 整數代碼），但禮物項目本身的文字名稱（例如「快播Plus 7天券」）跟 `itemType`
  數字對應表還是不知道，`amount` 欄位仍然是空的。細節見
  [connectors/soop.js](connectors/soop.js) 的 `GIFT_ITEM_TYPE` 註解與
  [docs/event-types.md](docs/event-types.md)。
- SOOP `subscribe` 事件可能只在「續訂」時觸發，「新訂閱」可能是完全沒被監聽到的另一個協定
  類型——2026-08-14 交叉核對 soopapi 發現 `soop-extension` 認定的 `SUBSCRIBE`（協定類型 93）
  在 soopapi 裡叫 `FOLLOW_ITEM_EFFECT`（續訂），真正的「New Subscription」是另一個類型
  91（`FOLLOW_ITEM`），`soop-extension` 沒有處理，還沒確認實際行為，見
  [docs/event-types.md](docs/event-types.md) 的 `subscribe` 章節。
- SOOP 一般聊天訊息裡的 `/代碼/` 表情符號已經接上圖片渲染（2026-08-14，見上面「表情符號
  圖片」章節），涵蓋全站共用「經典」目錄＋主播專屬 signature emoticon 目錄兩套；獨立的
  `emoticon` 事件（OGQ 雜湊 ID，網域是完全不同的 `ogq-sticker-global-cdn-z01.sooplive.com`）
  還是沒有圖片渲染，是唯一還沒解掉的表情符號缺口，細節見
  [docs/event-types.md](docs/event-types.md) 的 `chat`／`emoticon` 章節。
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
