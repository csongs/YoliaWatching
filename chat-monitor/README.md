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
改設定一律回到這個頁面改。右側是聊天視窗，每則訊息前面標 `[平台][類型]`。工具列的
「🔍 搜尋歷史訊息」會開一個獨立彈跳視窗，查 SQLite 裡**全部**歷史紀錄（`GET /api/search`），
不是只在畫面上目前這批即時訊息裡篩選，也不會影響右側正在即時顯示的內容——兩個是分開的 UI。
四個條件都選用，任填幾個就用幾個（AND 組合）：
- **關鍵字**：比對使用者名稱或訊息內容任一個命中。
- **開始/結束時間**：`<input type=datetime-local>`，旁邊「現在」按鈕直接帶入當下時間，方便
  「從剛剛某個時間點開始」這種用法；兩個都留空就不限時間範圍。
- **訊息類型**：複選下拉選單（`<select multiple>`，Ctrl/Cmd+點選可選多個），依平台分組，
  每個平台第一個選項是「全部訊息(含一般聊天)」（值是 `平台:*`，跟
  `CHAT_MONITOR_RAW_CAPTURE_SKIP` 的 `platform:*` 萬用字元同樣的慣例），其餘是該平台專屬的
  特殊事件（例如 Twitch 的「醒目留言(頻道點數兌換)」、YouTube 的「Super Chat」，選項來自
  [public/labels.js](public/labels.js) 的 `EVENT_TYPE_LABELS`，`platform` 欄位標哪個事件
  屬於哪個平台）。**可以跨平台混搭選**，例如「YouTube 全部訊息」+「Twitch 醒目留言」；
  選多個之間是 **OR 條件**（符合其中任一筆就算，後端組成 `(platform=? AND event_type=?) OR ...`
  這種查詢，`platform:*` 只比對 `platform` 不比對 `event_type`），跟關鍵字/時間範圍之間才是
  AND；什麼都不選＝不限類型。這個設計是因為 `chat`（一般聊天）這個 `event_type` 三個平台
  共用，沒辦法只靠 `event_type` 分辨是哪個平台的一般聊天，所以「全部訊息」選項改成只篩
  `platform` 欄位。

四個條件全部留空按搜尋不會出東西（`server.js` 擋掉，避免變成撈出整張表）。

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

輸出到 `release/YoliaChatMonitor-source-v{版號}/`（資料夾版）與同目錄的
`YoliaChatMonitor-source-v{版號}.zip`——都被 `.gitignore` 排除，不會被 commit。版號讀
[package.json](package.json) 的 `"version"` 欄位（跟 demo 頁右上角、`/api/version` 顯示的
是同一個來源，只有這裡一個地方要改），檔名帶版號方便拿到的人一眼看出版本、多個版本的 zip
也不會互相覆蓋。裡面是完整原始碼＋`install.bat`（自動抓 Node.js、裝套件）＋`start.bat`
（啟動並開瀏覽器）＋中文使用說明，拿到的人不用裝 Node.js、不用 clone repo，解壓縮後雙擊
`install.bat` 再雙擊 `start.bat` 即可。`install.bat`/`start.bat`/使用說明.txt 的可編輯來源在
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
  的 `0045` 見 [docs/event-types.md](docs/event-types.md)；其餘常見的 `unknown_0012`/`0014`/`0054`/`0090`/`0094`/`0110`
  2026-08-14 已經對照另一個獨立反推同一套協定的 Java 函式庫查出真實身分——都是使用者旗標/
  暱稱變更、管理功能狀態、內部握手之類跟聊天內容無關的封包，決定不接成正式事件，細節見
  [docs/event-types.md](docs/event-types.md)）。兩個變數預設都關閉，不影響正常監聽。
- `CHAT_MONITOR_RAW_CAPTURE_SKIP`：逗號分隔的 `platform:eventType` 清單，列在裡面的
  事件類型即使 `CHAT_MONITOR_RAW_CAPTURE=1` 也不會寫進 `raw-capture.jsonl`——欄位對應
  已經拿真實樣本核對過的類型（[docs/event-types.md](docs/event-types.md) 標「✅ 真實
  抓包」的那些）繼續收只是灌水，先跳過讓檔案聚焦在還沒驗證過的類型上。`platform:*`
  可以整個平台跳過。例：`CHAT_MONITOR_RAW_CAPTURE_SKIP=youtube:membership,twitch:sub`。
  之後想重新驗證某個類型，直接從這個清單刪掉那一項即可，不用改程式碼。

## 各事件類型與驗證狀態（2026-08-15）

> 這份表是三平台事件的**唯一**權威清單——涵蓋哪些事件類型、驗證到什麼程度、需不需要
> Token/Key，都只記在這裡，不會在別的章節重複一份。原始資料長怎樣、欄位怎麼對應，那是
> 另一件事，記在 [docs/event-types.md](docs/event-types.md)，這份表只放連結過去，不重貼
> raw data。還沒實作、屬於「以後可能要做」的功能構想（例如 Cheermote 圖片、頻道點數兌換
> 無文字版），不在這份表裡——那些追蹤在 [GitHub Issues](https://github.com/csongs/YoliaWatching/issues)，
> 這份表只收「程式碼已經有的事件類型，測到什麼程度」。

「驗證過」指的是實際連上真實頻道、看過真實事件跑過一次確認欄位正確——不是「程式碼邏輯看起來
合理」或「型別定義這樣寫」就算數。狀態欄用這幾種值：

| 值 | 意思 |
|---|---|
| ✅ 驗證過 / ⚠️ 部分驗證 / ⚠️ 沒驗證過 / ❌ 完全沒測過 | 程度差異見各列說明 |
| 📦 套件不支援 | 平台本身有這個概念，但目前用的函式庫/爬蟲技術上拿不到，不是漏測 |
| 🚫 平台無此功能 | 概念上就不存在 |

各類型的中文標籤與「等級/金額怎麼看」的說明集中在 [public/labels.js](public/labels.js)
（server 與前端共用同一份，避免兩邊漂移），demo 頁面下方也有一份可讀版本。

SOOP 另有「官方模式」（需要 SOOP 官方 API Key）完全未實作，跟 `yuupeek/src/chatListener.js`
現況一致——這是整條連線模式的選擇，不是單一事件，不放進下面的表，追蹤在 GitHub Issues。

「原始封包/事件」欄放的是**轉換前**的原始識別方式——YouTube 是 InnerTube 的 renderer 名稱、
Twitch 是 IRC 指令/`msg-id`、SOOP 是協定數字代碼（`\t` 後面 4 碼）。標「未查證」的是 `soop-extension`
函式庫自己內部完成轉換、我們沒有另外去比對底層數字代碼是什麼的（不是不存在，是沒必要查——函式庫已經
處理好了）；有寫出數字代碼的都是我們自己繞過函式庫、或拿 soopapi 交叉核對過的。

| 平台 | 事件 | `event_type` | 原始封包/事件 | 狀態 | 需要 Token/Key？ | 說明 |
|---|---|---|---|---|---|---|
| YouTube | 一般聊天 | `chat` | `liveChatTextMessageRenderer` | ✅ 驗證過 | 否 | 多次收到真實訊息 |
| YouTube | Super Chat（文字） | `superchat` | `liveChatPaidMessageRenderer` | ✅ 驗證過 | 否 | 真實樣本確認 `amount`/`color` 欄位；跟 `isMembership` 可能同時為真時目前只走 `superchat` 分支，會員資訊會遺失（已知落差，見 `docs/event-types.md`） |
| YouTube | Super Sticker（貼圖） | `supersticker` | `liveChatPaidMessageRenderer`（`sticker` 有值） | ⚠️ 沒驗證過 | 否 | 還沒抓到真實樣本；2026-08-15 之前跟 `superchat` 共用同一個 raw capture tag，加 `youtube:superchat` 進 skip 會連這個一起濾掉——已經拆成獨立的 `youtube:supersticker` tag，現在可以只 skip 文字版、繼續收貼圖版 |
| YouTube | 會員留言 | `chat`（`extra.isMembership`） | `liveChatMembershipItemRenderer` | ✅ 驗證過 | 否 | 129 則真實會員聊天，欄位正確 |
| YouTube | 會員月數 | `chat`（`extra.membershipMonths`） | `liveChatMembershipItemRenderer`（`authorBadges`） | ✅ 驗證過 | 否 | 237 筆真實驗證，含「New member」/「Member (N months)」/「Member (N year(s))」三種格式 |
| YouTube | 里程碑通知文字 | `chat`（`extra.membershipHeader`） | `liveChatMembershipItemRenderer`（`headerSubtext`） | ⚠️ 沒驗證過 | 否 | 只確認一般會員聊天正確回傳 `null`，沒遇過真正的里程碑事件 |
| YouTube | 訂閱（一般訂閱，非贈送） | — | 無對應 renderer | 📦 套件不支援 | 否 | `youtube-chat-next` 資料源沒有這個資訊，換官方 API 才有可能；追蹤在 GitHub Issues |
| YouTube | 贈送會籍(購買方) | `membership_gift` | `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer` | ✅ 驗證過 | 否 | 2026-08-15 真實封包驗證，`amount` = 份數，`extra.planName` = 會籍方案名稱（截圖對照真實畫面確認過文字意思）；不是 `ChatItem` 欄位，繞開套件另外處理原始 action，見 `connectors/youtube.js` 的 `patchYoutubeParser()` |
| YouTube | 贈送會籍(領取方) | `membership_gift_received` | `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer` | ✅ 驗證過 | 否 | 同上，只有一筆真實樣本，贈送者名字用「message.runs 最後一個 run」抓，還沒有多筆樣本驗證這個位置一定固定 |
| YouTube | 聊天表情符號圖片渲染 | `chat`（`extra.messageParts`） | `liveChatTextMessageRenderer`（`message.runs`） | ✅ 驗證過 | 否 | 真實 `:face-blue-smiling:` 樣本驗證過 |
| Twitch | 一般聊天 | `chat` | `PRIVMSG` | ✅ 驗證過 | 否 | 多次收到真實訊息 |
| Twitch | 頻道點數兌換（醒目留言，有文字） | `chat_highlight` | `PRIVMSG`（`custom-reward-id` tag） | ⚠️ 沒驗證過 | 否 | 跟一般 `PRIVMSG` 走同一路徑理論上沒問題，但沒有專門拿真實兌換訊息驗證過 |
| Twitch | Bits 抖內 | `cheer` | `PRIVMSG`（`bits` tag） | ⚠️ 沒驗證過 | 否 | 沒有實際看過一筆真的 cheer 事件 |
| Twitch | 新訂閱 | `sub` | `USERNOTICE`（`msg-id=sub`） | ✅ 驗證過 | 否 | 抓到真實封包（Prime/付費 Tier 1），2026-08-15 使用者對照 demo 頁跟 Twitch 原文抓到「預先訂閱多個月」漏掉月數的落差並修正（`msg-param-multimonth-duration`） |
| Twitch | 續訂月數 | `resub` | `USERNOTICE`（`msg-id=resub`） | ⚠️ 沒驗證過 | 否 | `cumulative-months` 修法是查 `tmi.js` 原始碼推論，沒等到真實事件確認 |
| Twitch | 贈送訂閱 | `subgift`/`submysterygift` | `USERNOTICE`（`msg-id=subgift`/`submysterygift`） | ⚠️ 部分驗證 | 否 | 抓到真實連續贈送封包，沒在 demo 頁看過渲染結果 |
| Twitch | Raid | `raid` | `USERNOTICE`（`msg-id=raid`，`tmi.js` 轉成 `raided` 事件） | ⚠️ 沒驗證過 | 否 | 沒有實際看過一筆真的 raid 事件 |
| Twitch | 公告 | `announcement` | `USERNOTICE`（`msg-id=announcement`） | ⚠️ 部分驗證 | 否 | 抓到真實公告封包，證實是原生 `/announce`，沒在 demo 頁看過渲染結果 |
| Twitch | 其他系統通知 | `usernotice_other` | `USERNOTICE`（其他 `msg-id`） | ⚠️ 部分驗證 | 否 | 目前只真實遇過 `viewermilestone`（連續觀看場次里程碑）這個子類型 |
| Twitch | 使用者名稱顏色 | `chat`/`cheer`（`extra.color`） | `PRIVMSG`/`USERNOTICE`（`color` tag） | ❌ 完全沒測過 | 否 | `tags.color` 是 IRC 原生欄位，邏輯上直接讀，沒在 demo 頁看過實際顏色 |
| Twitch | 聊天表情符號圖片渲染 | `chat`/`cheer`（`extra.messageParts`） | `PRIVMSG`（`emotes` tag） | ⚠️ 部分驗證 | 否 | CDN 網址規則驗證過，切割邏輯只用模擬資料測過 |
| SOOP | 一般聊天 | `chat` | `soop-extension` `CHAT`（底層代碼未查證） | ✅ 驗證過 | 否 | 大量真實訊息 |
| SOOP | 系統通知 | `notification` | `soop-extension` `NOTIFICATION`（底層代碼未查證） | ✅ 驗證過 | 否 | 2026-08-15 抓到真實通知（BJ 自訂的贈禮項目說明），`res.notification` 是字串，欄位對應正確，demo 頁顯示正常 |
| SOOP | 表情訊息 | `emoticon` | `soop-extension` `EMOTICON`（底層代碼未查證） | ⚠️ 部分驗證 | 否 | `emoticonId` 是 OGQ 雜湊 ID，換不出圖片網址；圖片渲染缺口追蹤在 GitHub Issues |
| SOOP | 訂閱月數 | `subscribe` | 協定代碼 `0093`（`FOLLOW_ITEM_EFFECT`，已對照 soopapi） | ⚠️ 沒驗證過 | 否 | 可能只在續訂觸發，新訂閱疑似另一協定類型（`0091`／`FOLLOW_ITEM`，已抓到真實樣本但還沒接成事件）；追蹤在 GitHub Issues |
| SOOP | 文字/語音抖內 | `text_donation` | `soop-extension` `TEXT_DONATION`（底層代碼未查證） | ✅ 部分驗證 | 否 | 抓到真實連續送星球封包（27 顆同一人），沒在 demo 頁看過渲染結果 |
| SOOP | 廣告氣球抖內 | `ad_balloon_donation` | `soop-extension` `AD_BALLOON_DONATION`（底層代碼未查證） | ✅ 部分驗證 | 否 | 抓到真實封包，沒在 demo 頁看過渲染結果 |
| SOOP | 影片抖內 | `video_donation` | `soop-extension` `VIDEO_DONATION`（底層代碼未查證） | ❌ 完全沒測過 | 否 | 欄位結構跟已驗證的其他抖內管道相同，這個管道本身還沒實測 |
| SOOP | 使用者名稱顏色 | `chat`（`extra.color`） | `chat` 封包 `parts[9]`/`[10]`（monkey-patch 補的，非 `soop-extension` 原生解析） | ✅ 驗證過 | 否 | 約 20 筆真實訊息核對，`parts[9]`/`[10]` 欄位索引正確 |
| SOOP | 聊天表情符號圖片渲染（`/代碼/`） | `chat`（`extra.messageParts`） | `chat` 封包文字比對（不是獨立封包類型） | ⚠️ 部分驗證 | 否 | 兩套目錄轉換邏輯、圖片網址都驗證過，沒在 demo 頁看過渲染結果 |
| SOOP | 贈送禮物 | `gift_item` | 協定代碼 `0045`（`SEND_QUICK_VIEW`，自己反推接上，非 `soop-extension` 支援） | ✅ 部分驗證 | 否 | 送禮者/收禮者暱稱對照真實截圖確認正確；`itemType` 對應表未知，追蹤在 GitHub Issues |

每種事件的原始資料長怎樣、對應哪個 `event_type`、demo 頁怎麼渲染，細節版整理在
[docs/event-types.md](docs/event-types.md)。

## 避免 restart 後重複寫入

每筆事件都算一個 `dedup_key`（Twitch/YouTube 用平台原生的訊息 id；SOOP 沒有 id，
用「類型+收到時間+使用者+內容」組出來），配合 `UNIQUE(platform, dedup_key)` +
`INSERT OR IGNORE`，同一事件重複送達（例如 reconnect）不會寫成兩筆。
YouTube 這邊是即時輪詢（`youtube-chat-next`），不會回放開播以來的歷史訊息；代價是：
如果伺服器重開，重開期間漏掉的訊息不會補上（漏訊息而不是重複訊息，這個工具的用途是
觀察格式，這個取捨可接受）。

## 狀態列行為說明

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

## 已知限制／未實作構想

未實作的功能構想、還需要進一步確認的協定細節，追蹤在
[GitHub Issues](https://github.com/csongs/YoliaWatching/issues)（`enhancement`／
`needs-verification`／`limitation` 標籤），不在這裡重複列一份——README 只保留「現在程式碼
實際上做得到什麼」（見上面「各事件類型與驗證狀態」），至於「以後可能要做什麼」一律去
Issues 找，避免同一件事要維護兩個地方。目前追蹤中的項目大致有：YouTube 一般會員留言分不出
「新加入/連續/贈禮」是哪一種（贈送會籍這個動作本身已經另外接上，見上面 `membership_gift`/
`membership_gift_received`，這裡剩下的是「已經在聊天的會員，事後回頭看是不是被贈送的」分不出來）、
YouTube superchat+會員同時為真時的顯示落差、SOOP 官方 API 模式、SOOP `gift_item` 的
`itemType` 對應表、SOOP `subscribe` 新訂閱協定未確認、SOOP OGQ 表情貼圖無圖片渲染、Twitch
頻道點數兌換（無文字版）需要 EventSub、Twitch Cheermote 圖片/動畫需要 Client-ID。
