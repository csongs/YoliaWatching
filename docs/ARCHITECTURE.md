# ARCHITECTURE — 系統全貌（事實檔）

> 本檔只記「已查證的事實」，每條附出處。架構「建議」一律放 docs/decisions/ 的 ADR，不放這裡。
> 查證日期：2026-07-07。標「⚠ 未親自複核」者為 agent 掃描結果，使用前建議抽查。
> 讀者指引：要改聊天邏輯→讀 §4、§7；要動動畫/素材→讀 §5、§8；要動 RTDB→讀 §6、§9；動部署→讀 §3。

## 1. 一句話

觀眾在 Twitch / YouTube / SOOP 聊天室發言 → overlay 網頁解析訊息 → 幽視值（yolia_see，0–100）
與狀態機驅動 canvas 角色動畫 → 顯示在 OBS Browser Source 上。

## 2. 兩個版本

| | 雲端版（主力） | 桌面版（次要） |
|---|---|---|
| 位置 | `web/` | `yuupeek/` |
| 執行環境 | 使用者自己的 Firebase 專案（Hosting + RTDB） | Electron，本機 HTTP server（port 3000） |
| overlay | `web/public/index.html`（雲端版專屬檔） | `yuupeek/renderer/obs-overlay.html` |
| 控制面板 | `/panel`（= 同步過去的 `panel.html`） | `http://localhost:3000/panel` |
| 聊天連線 | overlay 頁面內（瀏覽器直連） | `yuupeek/src/chatListener.js`（Node，tmi.js + googleapis + soop-extension） |
| 設定存放 | RTDB `/config` | 本機 `config.json` + `%APPDATA%\YoliaWatching\animations.json`；角色包存同目錄 `packs.json`（ADR-004；dev 模式=yuupeek/，已 gitignore） |
| 版本發布 | push main → GitHub Actions 部署 | electron-builder → GitHub Releases（`npm run release`） |

共用核心（isomorphic，單一源頭在 yuupeek/，經 sync.js 複製到 web/public/）：
- `yuupeek/renderer/character.js` — canvas 動畫引擎
- `yuupeek/src/chatProcessor.js` — 訊息處理純函數
- `yuupeek/src/packFormat.js` — 角色包格式驗證/合併/市集 index 相容(規格 docs/specs/character-pack-format.md)
- `yuupeek/src/youtubePollPolicy.js` — YouTube 找直播節奏/quota 錯誤判斷(2026-07-25 從
  chatListener.js 與 index.html 各自手刻的重複邏輯收斂而來)
- `yuupeek/src/defaultAnimations.js` — 預設動畫表(2026-07-25 收斂;main.js/index.html 直接引用,
  character.js 的內建 fallback 也從這裡衍生,不再各自手抄)
- `yuupeek/renderer/panel.html` — 控制面板（內建 DataAdapter：web 模式走 Firebase，桌面模式走 localhost API；見 panel.html 的 `initApp()`，約 L816–916）

桌面版專屬(electron 無關,可獨立單元測試)：
- `yuupeek/src/packStore.js` — packs.json 讀寫+啟用中包合併(2026-07-25 從 main.js 拆出;
  main.js 本身因 require('electron') 無法在 jest 下跑,拆出的模組才有測試)

## 3. 部署模型（雲端版）

**每個使用者擁有自己的 Firebase 專案**——fork 本 repo → 填 6 個 GitHub Secrets → CI 部署。
沒有任何中央伺服器；Spark 免費方案的 quota 是「每使用者各自一份」。

流程（[.github/workflows/deploy.yml](../.github/workflows/deploy.yml)，push main 或手動觸發）：
1. `web/gen-firebase-config.js` → 由 secrets 產生 `web/public/firebase-config.js`
   （必填：`FIREBASE_PROJECT_ID`、`FIREBASE_API_KEY`、`FIREBASE_MESSAGING_SENDER_ID`、`FIREBASE_APP_ID`；
   可選：`FIREBASE_AUTH_DOMAIN`、`FIREBASE_DATABASE_URL`、`FIREBASE_STORAGE_BUCKET`，缺省自動推導）
2. `web/gen-database-rules.js` → 把 `ADMIN_EMAIL` secret 注入 `database.rules.json`
3. `google-github-actions/auth@v2` 以 `FIREBASE_SERVICE_ACCOUNT` 認證
4. `firebase deploy --only hosting,database` —— **此步會自動執行 firebase.json 的 predeploy**：
   `node sync.js`（複製共用檔）→ `node gen-panel-email.js`（把 ADMIN_EMAIL 注入 panel.html 的 `ALLOWED_EMAILS`）

⚠ **常見誤判**：`web/public/` 在 git 裡只有 `index.html` 和 `firebase-config.example.js`，
`character.js`/`chatProcessor.js`/`panel.html`/`assets/` 都「不存在」——這是**正常的**。
它們是 predeploy 產物，被 [.gitignore](../.gitignore) L15–19 刻意排除。
不要據此判斷「線上版 404 癱瘓」或「CI 少了同步步驟」。（2026-07-07 曾有 agent 這樣誤判。）

部署後 URL：`https://<PROJECT_ID>.web.app/`（overlay）、`/panel`（面板，cleanUrls 開啟）。
Hosting headers：全站 `Cache-Control: no-cache`（[web/firebase.json](../web/firebase.json) L7–9）。

## 4. 執行時資料流（雲端版）

```
Twitch IRC (wss://irc-ws.chat.twitch.tv:443, 匿名 justinfan 或 oauth)
YouTube Data API v3 (輪詢)                                            ┐
SOOP WebSocket (社群協定；live API 有 CORS，瀏覽器不可用 → 實質僅桌面版) ┘
        │ 三個監聽器都跑在 overlay 頁面內（web/public/index.html）
        ▼
onMessage(text, username)                        index.html 約 L74
        ▼
ChatProcessor.processMessage(...)  → { yolia_see, state, animOnly, speech, costDenied, resetState }
        ▼
char.applyUpdate(...)              → canvas 動畫 + HUD + 對話泡泡

RTDB /config ──(on('value') 整節點訂閱, index.html 約 L351)──▶ overlay 熱更新
     ▲
     └──(update()) panel.html（登入後）
```

- overlay 訂閱的是 **整個 `/config` 節點**：任何欄位變更都會整包重推。
  → 大資料（如 base64 圖）**不可**放進 `/config`，否則每次改設定都重新下載全部。
- 訊息處理邏輯（[chatProcessor.js](../yuupeek/src/chatProcessor.js)）：
  先判指令（句首詞完全匹配，走 cost/幽視值增減/動畫/回應規則）；**非指令訊息一律先 +1 幽視值**
  （含關鍵詞命中者——關鍵詞再疊加自己的 yolia_see 增減）。門檻（threshold）由 `computeState()`
  把幽視值映射到狀態。

## 5. 動畫引擎（character.js）

- 動畫格式：`{ folder, frames: number[], ms?: number, loop: boolean }`
  - 幀圖路徑 = `<assetBase>/<folder>/<index 兩位數補零>.png`（character.js `frames()` L24–27）
  - `frames` 是**索引陣列**（可重複、可跳號，如 `[0,2,4,5,4,2,0]`），不是張數
  - `ms` 缺省 150（`FRAME_MS`）；`loop:false` 播完回 baseState
- 內建 fallback 動畫表（config 載入前／載入失敗時用）在 `createCharacter()` 內建構，
  由呼叫端傳入的 `defaultAnimations` 選項（單一源頭 `yuupeek/src/defaultAnimations.js`，
  2026-07-25 收斂,見 §11）經 `frames()` 衍生，不是手抄表；
  **runtime 覆蓋入口 = `setAnimations(cfg)`**，接受 `{ 狀態名: {folder, frames, ms, loop} }`，
  可新增任意新狀態名。
- `setAnimations` 支援兩種格式：`{folder, frames[]}`（assetBase 相對路徑）與
  `{srcs[]}`（完整 URL/data URL，2026-07-07 加，角色包用；規格見
  docs/specs/character-pack-format.md）；值為 `null` 時移除該狀態（角色包停用時清殘留用）。
- 畫布 128×139（`DISPLAY_W/H`），`drawFrame` 把整張 PNG 拉伸繪滿畫布。
- 位置行為（追隨狀態移動、跳躍連擊、閒晃 wander）都在此檔，與動畫格式無關。

## 6. RTDB schema（現行，全部在 `/config` 下）

```
/config                         .read: 公開   .write: 僅 ADMIN_EMAIL（rules 層強制）
├─ twitch:  { enabled, channel }
├─ youtube: { enabled, channel }
├─ soop:    { enabled, channel, apiMode: "community"|"official" }
├─ twitchOauth: string          （選填；空 = 匿名連線）
├─ youtubeApiKey: string
├─ soopApiKey: string           （官方模式用；官方模式尚未實作）
├─ obs: { scale: number }       （panel 預設 2）
├─ interactions: [              （三種 trigger 共用一個陣列）
│    { id:"t_xxxx", trigger:"threshold", min:number, state:string }
│    { id:"k_xxxx", trigger:"keyword",  match:string|string[], animation, yolia_see, response }
│    { id:"c_xxxx", trigger:"command",  match:string|string[], animation, yolia_see, cost?, response }
│  ]
├─ animations: { <狀態名>: {folder, frames[], ms, loop} }   （覆蓋/新增動畫）
├─ greetingAnimations: [ {frames[], ms, weight} ]           （wave 加權隨機變體；panel 無編輯 UI）
├─ activePackId: string|null    （舊單包欄位;勾選制後=activePackIds[0],供舊 overlay 相容）
└─ activePackIds: string[]      （2026-07-11 勾選制:同時啟用的包 id 清單;缺省=只用內建。
                                  合併順序由 packFormat.mergeActivePacks 統一:換角包墊底、擴充疊後）

/packs/<packId 的「.」換「_」>    .read: 公開   .write: 僅 ADMIN_EMAIL
    = 完整 .yolia.json 內容（Character Pack v1,規格 docs/specs/character-pack-format.md）

/events   .read: 公開   .write: 僅 ADMIN_EMAIL   （2026-07-10 增,手動試播）
└─ manualPlay: { animation, nonce }   （nonce 變更即播一次;事件不放 /config 免整包重推）

/state    規則保留但未使用（.read: true, .write: false）
$other    一律拒絕（.read/.write: false）←新增頂層節點必須改 rules
```

出處：[web/database.rules.json](../web/database.rules.json)、panel.html DataAdapter（約 L826–874）、
index.html 訂閱處理（約 L351–383）、[yuupeek/default.config.json](../yuupeek/default.config.json)。

## 7. 聊天平台接入細節（雲端版，全部在 index.html）

| 平台 | 機制 | 位置 | 已知限制 |
|---|---|---|---|
| Twitch | 原生 WebSocket IRC，無 token 時匿名 `justinfan*`（唯讀即可收訊息） | 約 L113–154 | 斷線 5 秒重連；無 quota 問題 |
| YouTube | Data API v3：`channels?forHandle` → `search?eventType=live` → `videos` → `liveChat/messages` 依 `pollingIntervalMillis` 輪詢 | 約 L156–245 | quota 規則（developers.google.com/youtube/v3/determine_quota_cost，2026-07-12 查）：**search.list 獨立上限每天 100 次**，其他端點共用 10,000 units/天（channels/videos 各 1 unit；liveChat/messages 單價官方未列【未查證】）。未開播時每 15 分鐘查一次（桌面版 2026-07-12 起同步，原 30 秒會在 50 分鐘內用光 search 額度）；panel「YouTube 設定」的**「我開播了」鈕**可立即觸發偵測（雲端走 `/events/checkLive` nonce、桌面走 `POST /panel/api/youtube/check`）。**收到 403/quota 即永久停止輪詢**（約 L235）——重啟條件很窄：重整頁面，或變更 youtube 的 enabled/channel/apiKey 三者之一（其他 config 欄位變更不會重啟，以這三欄組 key 判斷） |
| SOOP | 先 POST `player_live_api.php` 拿 CHDOMAIN/CHPT，再連 WebSocket 自訂封包協定 | 約 L236–338 | **live API 被 CORS 擋，瀏覽器內不可用**（程式碼自己印出「僅支援 Electron 版」，約 L323–325）；桌面版走 `soop-extension` npm 套件 |

## 8. 素材管線

- 源頭：`yuupeek/assets/sprites/frames/<動作資料夾>/<NN>.png`；⚠ 未親自複核：81 個 PNG、共約 3.5 MB。
- 部署：sync.js 把整個 `yuupeek/assets/` 複製到 `web/public/assets/`；
  overlay 的 assetBase = `./assets/sprites/frames`（index.html 約 L103）。
- 資料夾與狀態對照（動畫名 ≠ 資料夾名，如 peek→`review/`、eat→`cilantro/`）：見 `defaultAnimations.js`。
- `running/`、`waiting/` 資料夾未被任何動畫引用（⚠ 未親自複核）。
- `tools/frame-preview.html` 是幀預覽工具。**在版控內**（Initial commit 即追蹤）；.gitignore L21–22
  雖寫了 `tools/`，但 .gitignore 對已追蹤檔案無效——ignore 規則從未生效。要真排除得
  `git rm --cached`，去留由維護者決定。

## 9. 安全模型

【事實】
- RTDB rules：`/config` 全世界可讀；寫入需 `auth.token.email == ADMIN_EMAIL`（部署時注入）。
- 因此 `youtubeApiKey`、`twitchOauth`、`soopApiKey` 是**公開可讀**的。
  這是架構必然：overlay（OBS Browser Source）沒有登入能力，卻要自己輪詢 YouTube。
- panel 的 `ALLOWED_EMAILS` 檢查是 client-side UX（擋畫面），真正的權限在 rules 層。
- 登入方式：Email/Password + Google OAuth（panel.html 約 L356–373）。
- 桌面版 obsServer（本機控制面板 API，含 config/pack 讀寫）**無任何驗證機制**——這是設計上
  可接受的（單使用者本機工具），但前提是只有本機能連得到。2026-07-25 查證修正：
  `httpServer.listen()` 原本沒指定 host，Node 預設綁所有網卡，同一 WiFi/區網的其他裝置
  可以連到這個無驗證的 API；已改成明綁 `127.0.0.1`（obsServer.js `start()`）。

【風險與現行緩解】（緩解屬建議性質，執行前確認）
- YouTube API key 洩漏 → 他人盜用 quota。緩解：使用者可在 Google Cloud Console 給 key 加
  HTTP referrer 限制（限自己的 `*.web.app`）。README 尚未教這步（未查證 Google 現行 UI 路徑）。
- twitchOauth 洩漏 → 可以該身分發言。緩解：留空即用匿名模式（功能不減，僅收訊息）。

## 10. 測試與本機開發

- 測試：`cd yuupeek && npm test`（jest@30 + jsdom）。11 個測試檔在 `yuupeek/src/__tests__/`：
  `character`、`chatListener`（2026-07-10 重寫，對齊 createChatListener API）、
  `chatProcessor`（2026-07-10 建）、`defaultAnimations`（2026-07-25 新增）、`detector`、
  `obsServer`、`packFormat`、`packStore`（2026-07-25 新增，electron 無關）、`stateMachine`、
  `syncManifest`（sync 清單守門）、`youtubePollPolicy`（2026-07-25 新增）。
  【事實，2026-07-25 實測】基線**全綠**（11 suites / 149 tests）。main.js 因
  `require('electron')` 無法在 jest 下跑，沒有對應測試檔（拆出去的 packStore.js 例外）。
- 桌面版：`npm start`；角色沙盒本機測試：`npm run test-ui`（`yuupeek/test-server.js` 在
  port 3001 服務 test.html；沙盒讀不到 RTDB/animations.json 的自訂動畫，且必有兩種已知
  console 紅字——WS 重連與 pet-config 404，詳 PLAYBOOK §2）。
- 雲端版沒有自動化測試（overlay/panel 的瀏覽器行為無 CI 驗證）。

## 11. 技術債與地雷（2026-07-07 查證結論）

| 項目 | 查證結論 | 出處 |
|---|---|---|
| `yuupeek/src/frames.js` | **已刪除**（2026-07-10，刪前 grep 確認零引用；舊 spritesheet 定位表，git 歷史可挖） | 親自複核 |
| `yuupeek/src/detector.js` | **production 未接線**：只有 `detector.test.js` 引用，main.js 沒有 require。功能（視窗標題偵測）在桌面版藍圖內但未啟用。留著，檔頭已加註記（2026-07-10） | 親自複核 |
| `DEFAULT_ANIMATIONS` 鏡像 | **已解決**（2026-07-25）：單一源頭收斂到 `yuupeek/src/defaultAnimations.js`（isomorphic，經 sync.js 同步），`main.js`/`index.html` 直接引用；`character.js` 內建 fallback 表改用 `frames()` 從呼叫端傳入的 `defaultAnimations` 選項衍生，不再手抄第三份 | 親自複核 |
| `web/DEPLOY.md` | 已改為一頁式指向 README（2026-07-10；單一事實源，不再重複部署步驟） | 親自複核 |
| SOOP 官方 API 模式 | `apiMode:"official"` 尚未實作（index.html 約 L249–251 直接 return） | 親自複核 |
| greetingAnimations | 有 runtime 支援、無 panel 編輯 UI（雲端：直接改 RTDB；桌面：改 `%APPDATA%\YoliaWatching\config.json`——**不要**改安裝目錄的 default.config.json，那是隨程式更新的預設檔） | 親自複核＋審查修正 |
| web 版 panel 無 saveAnimations | panel 的 web DataAdapter 只有 `getAnimations`（唯讀，供下拉選單；L851）。桌面版的寫入不在 panel adapter（L899 也是 GET），而在 `obsServer.js` L205 起（POST /panel/api/animations）＋ `main.js` 的 saveAnimations（約 L209–228）。**雲端版目前無法在 UI 編輯動畫** | 親自複核＋審查修正 |
| chatListener.test.js 紅字 | **已修復**（2026-07-10 重寫對齊 createChatListener API；基線恢復全綠，見 §10） | 2026-07-10 實測 |

## 12. 給修改者的快速對照

| 想改什麼 | 動哪裡 | 別忘了 |
|---|---|---|
| 訊息→動畫的規則邏輯 | `yuupeek/src/chatProcessor.js` | 是共用檔；跑 `npm test` |
| 角色動作/渲染 | `yuupeek/renderer/character.js` | 是共用檔；桌面版與雲端版都吃它 |
| 面板 UI | `yuupeek/renderer/panel.html` | 是共用檔；web/桌面雙模式都要通（DataAdapter） |
| 雲端 overlay（聊天監聽、Firebase 訂閱） | `web/public/index.html` | 雲端專屬檔，可直接改 |
| 預設動畫幀序 | `yuupeek/src/defaultAnimations.js` | 單一源頭，改這裡即可，不必再到處找副本 |
| RTDB 結構 | schema 見 §6 | 新頂層節點要改 `web/database.rules.json`；格式只加不改 |
| 預設互動 | `yuupeek/default.config.json` | 桌面版預設；雲端版首次資料可用 `web/import-config.js` 匯入（用法未查證） |
| 部署流程 | `.github/workflows/deploy.yml` + `web/firebase.json` predeploy | predeploy 也算部署步驟 |
