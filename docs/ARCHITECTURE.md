# ARCHITECTURE — 系統全貌（事實檔）

> 本檔只記「已查證的事實」，每條附出處。架構「建議」一律放 docs/decisions/ 的 ADR，不放這裡。
> 首次查證：2026-07-07；2026-07-25 一次架構審查 session（7 輪）後全文複查一次。
> **2026-08-16 大改**：拿掉 Firebase 雲端版（原 `web/`），聊天連線改由獨立的 chat-monitor
> process 負責，桌寵（`yuupeek/`）只當它的 WebSocket 唯讀 client。全文依新架構重寫，
> 舊的「兩個版本」「RTDB schema」等章節已不適用，內容整段替換而非保留對照。
> **行號一律標「約」——每次改動都可能讓行號漂移幾行，抓不到時用附近的函數名/註解關鍵字
> 搜尋，不要照抄行號硬找。**
> 讀者指引：要改聊天邏輯→讀 §4、§7；要動動畫/素材→讀 §5、§8；要動設定存放→讀 §6；
> 動部署→讀 §3。

## 1. 一句話

觀眾在 Twitch / YouTube / SOOP 聊天室發言 → **chat-monitor**（獨立 Node process）監聽並廣播
→ 桌寵（Electron，`yuupeek/`）當 WebSocket client 收下 → 幽視值（yolia_see，0–100）與狀態機
驅動 canvas 角色動畫 → 顯示在 OBS Browser Source 上。

## 2. 兩個合作的 process（不是「兩個版本」）

這不是「選一個用」的兩個版本，是**必須同時跑**的兩個獨立 process：

| | chat-monitor（聊天來源） | yuupeek（桌寵本體） |
|---|---|---|
| 位置 | `chat-monitor/` | `yuupeek/` |
| 執行環境 | 獨立 Node process（`node server.js`），非 Electron | Electron，本機 HTTP server（port 3000） |
| 職責 | 監聽 Twitch/YouTube/SOOP，寫入本機 SQLite（`events`/`settings`/`prefs` 表），
  WebSocket 廣播每個新事件 | 訂閱 chat-monitor 的 WebSocket，過濾出一般聊天文字驅動
  幽視值/動畫；OBS overlay、控制面板都由這裡的本機 server 服務 |
| 平台頻道/API key 設定 | 自己的網頁（預設 `http://127.0.0.1:3100`） | 不管這塊，UI 已拿掉（見 §9） |
| overlay | 無（不面對 OBS） | `yuupeek/renderer/obs-overlay.html` |
| 控制面板 | 自己的 `demo.html`（監看用，非桌寵控制面板） | `http://localhost:3000/panel` |
| 設定存放 | SQLite（`chat-monitor/data/events.sqlite`，位置可在畫面上改） | 本機 `config.json` + `%APPDATA%\YoliaWatching\animations.json`；
  角色包存同目錄 `packs.json`（ADR-004；dev 模式=`yuupeek/`，已 gitignore） |
| 啟動方式 | 使用者手動 `npm start`（不會被 yuupeek 自動拉起，2026-08-16 決策：兩者刻意解耦，
  代價是使用者要記得兩支都開） | `npm start`（Electron） |
| 版本發布 | 不對外發布，內部工具（`package.json` 標 `"private": true`） | electron-builder → GitHub Releases（`npm run release`） |

**啟動順序很重要**：chat-monitor 沒開，桌寵完全收不到聊天訊息（不會報錯，只是安靜——見 §9
的重連行為）。

共用核心（isomorphic，單一源頭在 `yuupeek/`，2026-08-16 起不再有任何 sync 複製機制——
之前 `web/sync.js` 複製到 `web/public/` 的那套隨 Firebase 版一起拿掉了）：
- `yuupeek/renderer/character.js` — canvas 動畫引擎
- `yuupeek/src/chatProcessor.js` — 訊息處理純函數
- `yuupeek/src/packFormat.js` — 角色包格式驗證/合併/市集 index 相容(規格 docs/specs/character-pack-format.md)
- `yuupeek/src/defaultAnimations.js` — 預設動畫表
- `yuupeek/renderer/panel.html` — 控制面板

桌面版專屬(electron 無關,可獨立單元測試)：
- `yuupeek/src/packStore.js` — packs.json 讀寫+啟用中包合併
- `yuupeek/src/chatMonitorClient.js` — chat-monitor 的 WebSocket client（2026-08-16 新增，
  取代已刪除的 `chatListener.js`）

## 3. 部署模型

**沒有雲端部署**。桌寵是 electron-builder 打包成 Windows 安裝檔，發布到 GitHub Releases
（`npm run release`）；chat-monitor 是內部工具，不對外發布，使用者（目前只有維護者自己）
直接 `git clone` + `npm install` + `npm start` 跑。

2026-08-16 之前有過一套「Firebase 雲端版」（fork repo → 填 GitHub Secrets → CI 部署到自己的
Firebase 專案，零安裝）。這條路線已整個移除（`web/`、`.github/workflows/deploy.yml`、
`database.rules.json` 等都刪了）——移除原因是這個專案已定調為內部工具，不追求讓陌生實況主
零安裝自架；換掉 Firebase 也順便解決了 §9 提到的 API key 公開曝露問題。

## 4. 執行時資料流

```
Twitch IRC (tmi.js)                                          ┐
YouTube 網頁聊天室爬蟲 (youtube-chat-next，免 API Key)         ├─ chat-monitor/connectors/*.js
SOOP WebSocket (soop-extension，社群協定)                      ┘  （獨立 process，見 §7）
        │
        ▼
db.insertEvent(evt)  → SQLite events 表(chat-monitor/db.js，dedup_key 防重複)
        │
        ▼
broadcast({ type:'event', data: evt })  → ws://127.0.0.1:3100/ws（chat-monitor/server.js）
        │
        ▼ (yuupeek/src/chatMonitorClient.js 訂閱這條 WS，evt.event_type !== 'chat' 一律忽略——
        │  這次收斂範圍只到一般聊天文字，斗內/訂閱/Raid 等事件桌寵目前完全不處理，見 CLAUDE.md 鐵律 2)
        ▼
ChatProcessor.processMessage(text, username, ...)  → { yolia_see, state, animOnly, speech, costDenied, resetState }
        ▼
ChatProcessor.planMessageEffects(r, yolia_see)   → { immediate, delayed }
        ▼
main.js 的 broadcastState()  → obsServer 的本機 WS → obs-overlay.html
        ▼
char.applyUpdate(...)              → canvas 動畫 + HUD + 對話泡泡
```

- 訊息處理邏輯（[chatProcessor.js](../yuupeek/src/chatProcessor.js)）：
  先判指令（句首詞完全匹配，走 cost/幽視值增減/動畫/回應規則）；**非指令訊息一律先 +1 幽視值**
  （含關鍵詞命中者——關鍵詞再疊加自己的 yolia_see 增減）。門檻（threshold）由 `computeState()`
  把幽視值映射到狀態。這段邏輯完全沒變，只是訊息來源從「桌寵自己接 IRC/API」換成「chat-monitor
  轉發」。
- chat-monitor 斷線/沒開：`chatMonitorClient.js` 每 3 秒重試連線，不報錯彈窗；panel「模組狀態」
  分頁有一個連線燈號（見 §9）。**不補開機前錯過的訊息**——這跟舊版 Twitch/YouTube 斷線重連
  本來就不回放歷史的行為一致，不是退步。

## 5. 動畫引擎（character.js）

- 動畫格式：`{ folder, frames: number[], ms?: number, loop: boolean }`
  - 幀圖路徑 = `<assetBase>/<folder>/<index 兩位數補零>.png`（character.js `frames()` L24–27）
  - `frames` 是**索引陣列**（可重複、可跳號，如 `[0,2,4,5,4,2,0]`），不是張數
  - `ms` 缺省 150（`FRAME_MS`）；`loop:false` 播完回 baseState
- 內建 fallback 動畫表（config 載入前／載入失敗時用）在 `createCharacter()` 內建構，
  由呼叫端傳入的 `defaultAnimations` 選項（單一源頭 `yuupeek/src/defaultAnimations.js`）
  經 `frames()` 衍生，不是手抄表；
  **runtime 覆蓋入口 = `setAnimations(cfg)`**，接受 `{ 狀態名: {folder, frames, ms, loop} }`，
  可新增任意新狀態名。
- `setAnimations` 支援兩種格式：`{folder, frames[]}`（assetBase 相對路徑）與
  `{srcs[]}`（完整 URL/data URL，角色包用；規格見
  docs/specs/character-pack-format.md）；值為 `null` 時移除該狀態（角色包停用時清殘留用）。
- 畫布 128×139（`DISPLAY_W/H`），`drawFrame` 把整張 PNG 拉伸繪滿畫布。
- 位置行為（追隨狀態移動、跳躍連擊、閒晃 wander）都在此檔，與動畫格式無關。

## 6. 設定資料存放（現行）

沒有 RTDB 了，設定分散在兩個各自獨立的本機儲存：

**yuupeek（桌寵設定，JSON 檔）**：
```
config.json（%APPDATA%\YoliaWatching\，dev 模式在 yuupeek/）
├─ modes: { obs, test }
├─ interactions: [ { id, trigger:"threshold"|"keyword"|"command", ... } ]   （互動規則，panel「桌寵設定」可編輯）
├─ obs: { port, scale }
├─ greetingAnimations: [ {frames[], ms, weight} ]
├─ activePackId / activePackIds: 角色包啟用清單（ADR-004，packFormat.mergeActivePacks 合併）
└─ animations（透過 animations.json 分開存，不在 config.json 裡）

animations.json（同目錄）— 動畫覆蓋/新增，只存跟 DEFAULT_ANIMATIONS 不同的部分
packs.json（同目錄）— 完整角色包內容（packStore.js 讀寫）
```

**chat-monitor（聊天監聽設定，SQLite）**：見 [chat-monitor/db.js](../chat-monitor/db.js) 的
`settings` 表（每平台一列：`enabled` + `config_json` 存頻道/apiMode）、`prefs` 表（畫面選項）。
桌寵完全不碰這個資料庫，也不管這些設定——平台頻道/API key 一律去 chat-monitor 自己的頁面設。

角色包上下架的「市集」功能（`workshop.js`/`market.js`）連的是**另一個外部平台**（ADR-005，
非本機 SQLite 也非本機 JSON），跟這次收斂無關，未受影響。

## 7. 聊天平台接入細節（chat-monitor，全部在 `chat-monitor/connectors/`）

| 平台 | 機制 | 需要 API Key/Token？ |
|---|---|---|
| Twitch | `tmi.js` 原生 WebSocket IRC，無 token 時匿名 `justinfan*`（唯讀即可收訊息） | 否 |
| YouTube | `youtube-chat-next`（免 API Key 的公開網頁聊天室爬蟲），取代了舊版
  `googleapis` 官方 API 做法——**2026-08-12 換套件後不再有 quota 問題，也不需要
  YOUTUBE_API_KEY**（[connectors/youtube.js](../chat-monitor/connectors/youtube.js)
  檔頭記載換套件原因；舊版的 quota 節流邏輯 `youtubePollPolicy.js` 已隨之刪除，
  yuupeek 那份鏡像也一併刪了，見 §11） | 否 |
| SOOP | 社群協定：先 POST `player_live_api.php` 拿 CHDOMAIN/CHPT，再連 WebSocket
  自訂封包協定（`soop-extension` 套件） | 官方 API 模式（`apiMode:"official"`）尚未實作 |

三個 connector 的輸出統一收斂成 SQLite `events` 表的一列（欄位定義與各平台 `event_type`
分類見 [chat-monitor/docs/event-types.md](../chat-monitor/docs/event-types.md)），
再透過 WebSocket 廣播給 yuupeek（§4）。**這次收斂只用得到 `event_type === 'chat'`**——
斗內/訂閱/Raid 等分類資訊 chat-monitor 都抓了，只是桌寵這端目前選擇不理它們。

## 8. 素材管線

- 源頭：`yuupeek/assets/sprites/frames/<動作資料夾>/<NN>.png`；⚠ 未親自複核：81 個 PNG、共約 3.5 MB。
- overlay 的 assetBase = `./assets/sprites/frames`（`obs-overlay.html`）。
- 資料夾與狀態對照（動畫名 ≠ 資料夾名，如 peek→`review/`、eat→`cilantro/`）：見 `defaultAnimations.js`。
- `running/`、`waiting/` 資料夾未被任何動畫引用（⚠ 未親自複核）。
- `tools/frame-preview.html` 是幀預覽工具。**在版控內**（Initial commit 即追蹤）；.gitignore
  雖寫了 `tools/`，但 .gitignore 對已追蹤檔案無效——ignore 規則從未生效。要真排除得
  `git rm --cached`，去留由維護者決定。

## 9. 安全模型

【事實】
- **API key 公開曝露的問題已經不存在了**（2026-08-16 隨 Firebase 移除連帶解決）：
  YouTube 改用免 Key 的爬蟲套件（§7），Twitch 匿名連線本來就不需要 key，SOOP 社群模式
  也不需要——現在系統裡沒有任何需要保密的聊天平台憑證。
- chat-monitor 的本機 HTTP/WS server 綁 `127.0.0.1:3100`（可用 `CHAT_MONITOR_PORT` 環境變數
  改)，**無任何驗證機制**（[chat-monitor/server.js](../chat-monitor/server.js) `server.listen()`）。
  設計上可接受（單機內部工具），前提跟 obsServer 一樣是只有本機能連得到。
- yuupeek 的 obsServer（本機控制面板 API，含 config/pack 讀寫）同樣**無任何驗證機制**，
  同樣只綁 `127.0.0.1`（`obsServer.js` `start()`；2026-07-25 曾修過一次「原本沒指定 host
  導致同區網其他裝置能連到」的問題，2026-08-16 決策沿用同一個限制，不開放區網控制面板）。
- 桌寵完全不知道 chat-monitor 的資料庫在哪裡、長怎樣——兩者之間唯一的介面是那條 WebSocket，
  桌寵是純唯讀 client，連不上就每 3 秒重試（`chatMonitorClient.js`），panel「模組狀態」分頁
  顯示連線燈號。

## 10. 測試與本機開發

- 測試：`cd yuupeek && npm test`（jest@30 + jsdom）。9 個測試檔在 `yuupeek/src/__tests__/`：
  `character`、`chatMonitorClient`（2026-08-16 新增，取代 `chatListener`）、`chatProcessor`、
  `defaultAnimations`、`detector`、`obsServer`、`packFormat`、`packStore`、`stateMachine`。
  【事實，2026-08-16 實測】基線**全綠**（9 suites / 134 tests）。main.js 因 `require('electron')`
  無法在 jest 下跑，沒有對應測試檔（拆出去的 packStore.js 例外）。
- chat-monitor 沒有 jest 測試（獨立 npm 專案，跟 yuupeek 的測試基線分開；它自己的品質保證
  方式是模擬事件 API，見 chat-monitor/README.md）。
- 桌面版：先 `cd chat-monitor && npm start`，再 `cd yuupeek && npm start`；角色沙盒本機測試：
  `npm run test-ui`（`yuupeek/test-server.js` 在 port 3001 服務 test.html；沙盒讀不到
  animations.json 的自訂動畫，也不接 chat-monitor，純測動畫本身，詳 PLAYBOOK §2）。

## 11. 技術債與地雷

| 項目 | 查證結論 | 出處 |
|---|---|---|
| Firebase 雲端版 | **已移除**（2026-08-16，決策記錄：chat-monitor 升格為正式聊天來源、
  維持獨立 process、產品定位改為內部工具）——`web/`、`.github/workflows/deploy.yml`、
  `database.rules.json` 全刪，`yuupeek/src/chatListener.js`、`youtubePollPolicy.js`
  一併刪除（YouTube 改走免 Key 爬蟲套件後這份 quota 節流邏輯整個用不到了） | 親自複核 |
| `yuupeek/src/detector.js` | **production 未接線**：只有 `detector.test.js` 引用，main.js 沒有 require。功能（視窗標題偵測）在桌面版藍圖內但未啟用。留著，檔頭已加註記 | 親自複核 |
| `DEFAULT_ANIMATIONS` 鏡像 | **已解決**（2026-07-25）：單一源頭收斂到 `yuupeek/src/defaultAnimations.js`，`main.js` 直接引用；`character.js` 內建 fallback 表改用 `frames()` 從呼叫端傳入的 `defaultAnimations` 選項衍生 | 親自複核 |
| SOOP 官方 API 模式 | `apiMode:"official"` 尚未實作（`chat-monitor/connectors/soop.js`） | 親自複核 |
| greetingAnimations | 有 runtime 支援、無 panel 編輯 UI（改 `%APPDATA%\YoliaWatching\config.json`——**不要**改安裝目錄的 default.config.json，那是隨程式更新的預設檔） | 親自複核＋審查修正 |
| panel 無法編輯動畫 | panel 的 DataAdapter 只有 `getAnimations`（唯讀，供下拉選單）。寫入路徑存在但 panel UI 沒接：`obsServer.js`（POST /panel/api/animations）＋ `main.js` 的 `saveAnimations` | 親自複核＋審查修正 |
| 斗內/訂閱/Raid 等事件未接進互動規則 | 刻意的範圍縮小，不是遺漏——見 CLAUDE.md 鐵律 2、§7 | 2026-08-16 決策記錄 |

## 12. 給修改者的快速對照

| 想改什麼 | 動哪裡 | 別忘了 |
|---|---|---|
| 訊息→動畫的規則邏輯 | `yuupeek/src/chatProcessor.js` | 跑 `npm test` |
| 角色動作/渲染 | `yuupeek/renderer/character.js` | 跑 `npm test` |
| 面板 UI | `yuupeek/renderer/panel.html` | 平台頻道/API key 設定已不在這裡，別加回去（去 chat-monitor） |
| 聊天連線本身（Twitch/YouTube/SOOP） | `chat-monitor/connectors/*.js` | 這是獨立 npm 專案，改完要在 `chat-monitor/` 下自己 `npm start` 測，不會被 yuupeek 的 `npm test` 覆蓋到 |
| 桌寵怎麼收 chat-monitor 的事件 | `yuupeek/src/chatMonitorClient.js` | 目前只處理 `event_type==='chat'`，擴大範圍前先讀 CLAUDE.md 鐵律 2 |
| 預設動畫幀序 | `yuupeek/src/defaultAnimations.js` | 單一源頭，改這裡即可 |
| 預設互動 | `yuupeek/default.config.json` | 桌面版預設 |
| 部署流程 | electron-builder（`yuupeek/package.json` 的 `build`/`release` script） | 沒有雲端部署了 |
