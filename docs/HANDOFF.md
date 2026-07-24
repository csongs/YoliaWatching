# HANDOFF — session 交接檔

> 用途：任何 session（不論模型大小）中斷或收尾時，把「做到哪、接下來做什麼」寫在這裡。
> 下一個 session 開場：先讀 CLAUDE.md，再讀本檔的「目前狀態」。
> 維護規則：完成一項就把狀態改成 ✅ 並補一句結果；新發現的坑寫進「地雷區」。

## 目前狀態（2026-07-25，架構審查後的四項收斂重構）

- 起因:`/mattpocock-skills:improve-codebase-architecture` 掃過角色包/市集熱點與
  聊天監聽子系統,列出 4 個「重複邏輯收斂成單一 interface」的候選,維護者核准全做。
  全程只收斂既有邏輯的**位置**,格式/行為刻意不變(RTDB schema、動畫格式皆未動)。
- **① `yuupeek/src/youtubePollPolicy.js`(新檔,isomorphic,已加進 sync.js)**:
  `shouldCheckLiveNow`/`classifyYoutubeError` 收斂桌面 `chatListener.js` 與雲端
  `index.html` 原本各自手刻的「15 分鐘找直播節奏」「quota 錯誤判斷」——上一版
  (2026-07-12 那次)兩邊各改一次,這次起兩邊都呼叫同一份純函數。**順手補的行為修正**:
  雲端 overlay 原本 quota 爆掉後沒有停止狀態,「我開播了」還會再打一次註定失敗的請求;
  現在跟桌面版一樣有 `quotaStopped` 旗標擋掉。
- **② `packFormat.js` 新增 `packKeyOf`/`resolveActivePackIds`/`packIdsCompatFields`/
  `selectPack`**:收斂 `activePackId`↔`activePackIds` 相容折算(原本 main.js/
  obsServer.js/panel.html 兩個 adapter/index.html 共 6 處各自手刻)與「換角包一次只能
  一個」互斥規則(原本 workshop.js/market.js 各刻一份,`mergeActivePacks` 本身不知道
  這條規則,任何新呼叫端理論上可悄悄同時啟用兩個換角包)。7 個呼叫端全部改呼叫這 4 個
  函數,touchpoints:main.js、obsServer.js、panel.html 兩個 adapter、workshop.js、
  market.js、web overlay(index.html)。
- **③ `packFormat.js` 新增 `guessIndexUrl`/`extractIndexUrlFromFirebaseConfig`**:
  market.js 的 `resolveIndex` 原本把「市集位址→候選 index.json URL」的純字串邏輯
  跟 fetch/try-catch 編排混在一起,且完全沒測試(雖然 `window.Market._resolveIndex`
  早就掛了測試鉤子)。純字串部分搬進 packFormat.js,market.js 只留 I/O 編排。
  `normalizeIndex` 一併搬過去(原本已是純函數,只是位置不對)。
- **④(範圍縮小)`yuupeek/src/packStore.js`(新檔,electron 無關)**:原候選是把
  main.js 的 panelHandlers 整個拆成 configStore/packStore/broadcastPolicy/
  listenerLifecycle 四塊;實際只做了 packStore 這塊——main.js 需要 `require('electron')`
  才能跑,這個 repo 目前沒有任何 main.js 的自動化測試,沒有安全網驗證更大範圍的拆分。
  packStore 這塊本身不依賴 electron(只用 fs),已補 `packStore.test.js`。
  **剩下三塊(configStore/broadcastPolicy/listenerLifecycle)還沒拆**,建議之後真的要拆時
  先跑 `/grilling` 談好新 interface 邊界,再動手(理由同上:main.js 無測試安全網)。
- 驗證:`cd yuupeek && npm test` 10 suites / 131 tests 全綠(含新增的
  `youtubePollPolicy.test.js`、`packStore.test.js`,以及 `packFormat.test.js` 補的
  pack-selection/index-format 測試)。`main.js` 只能 `node --check` 語法檢查
  (此沙盒環境 `ELECTRON_RUN_AS_NODE=1`,無法真的開視窗跑桌面版;維護者本機
  `npm start` 建議手動驗一次工房勾選/市集安裝/YouTube 面板「我開播了」)。

## 前次狀態（2026-07-12，YouTube 直播偵測改 15 分鐘+「我開播了」）

- 查證(2026-07-12,determine_quota_cost):**search.list 改為獨立每日 100 次上限**,
  其他端點共用 10,000 units/天。桌面版原本未開播 30 秒搜一次=50 分鐘用光額度 → bug。
- 桌面 chatListener:未開播改 15 分鐘查一次(LIVE_CHECK_INTERVAL_MS,與雲端一致),
  暫時性狀況用 RETRY_INTERVAL_MS=30 秒;新增 `checkYouTubeLiveNow()`(清節流立即查,
  配額爆掉回 false);輪詢迴圈加 ytBusy 防手動觸發造成雙迴圈。
- 「我開播了」按鈕(panel「YouTube 設定」卡,兩模式):桌面 `POST /panel/api/youtube/check`;
  雲端寫 `/events/checkLive` nonce → overlay 首快照抑制後觸發 `checkNow()`。
- 雲端 overlay `startYouTube` 回傳值改 `{stop, checkNow}`(原本是 stop 函數)。
- `liveChat/messages` 單價官方未列(【未查證】);長期選項 `liveChatMessages.streamList`
  (官方建議,免輪詢)記入 backlog,暫不做。
- 驗證:jest 92 tests 全綠(+1 時序測試:15 分鐘節流+手動觸發立即查)。

## 前次狀態（2026-07-11 二，角色包勾選制+市集試播）

- **角色包改勾選制**(維護者 UI 回饋):工房清單內建只標「內建」徽章無操作鈕;
  每個包一個啟用勾選框,**擴充包可同時勾多個**,換角包一次限一個(勾新的自動取消舊的)。
- 資料格式(只加不改):`config.activePackIds: string[]` 新可選欄位;
  `activePackId` 保留=清單第一個(舊 overlay 相容)。合併邏輯統一在
  `packFormat.mergeActivePacks`(換角包墊底、擴充依勾選順序疊後,壞包跳過回報)。
  touchpoints:main.js(config 讀寫+廣播)、obsServer active-pack 路由(收陣列,
  相容舊單包 body)、web overlay(多 packRef 訂閱)、panel 兩個 adapter、workshop.js。
- **市集試播**:卡片「試播」→ 抓包+validatePack → 卡片內小畫布循環播,可切動畫,
  只播 data:image/ 幀(不對外站發請求);安裝後「立即啟用」改為附加到勾選清單。
- 驗證:jest 8 suites/91 tests 全綠(+5 mergeActivePacks);node 假 DOM 驅動
  workshop 勾選流程 7 項全過;市集渲染煙霧測試過。瀏覽器實測待維護者。

## 前次狀態（2026-07-11，平台本機免登入測試模式）

- 平台 repo 新增 `dev.js`(零依賴):`node dev.js` 同時端出三頁+假資料庫
  (RTDB 風格 REST 存 `.local-data.json`)。localhost 無 firebase-config.js 時
  common.js 走 **MOCK 分支**:免登入固定為「本機測試員」(已核准 admin),
  rules 不驗;panel 市集位址直接貼 `http://127.0.0.1:5000`。要測 rules/SSO
  才用 emulator(config projectId 用 demo- 開頭觸發,需 Java)。
- panel 市集位址改「貼什麼都盡量接」:index.json 原樣/資料庫根自動補/網站網址
  自動探測 firebase-config.js(正式部署限定——hosting emulator 不套自訂標頭,
  firebase-tools #3860);錯誤訊息導引抄首頁底部的 Registry URL。
- 端到端驗證(2026-07-11,node 驅動 mock 分支):免登入→發布→瀏覽→
  panel 貼網站網址解析→抓包→下架,7 項全過;主 repo 測試 86 全綠。

## 前次狀態（2026-07-10 深夜二，中央市集平台 ADR-005）

- 市集路線改版:GitHub registry → **中央 Firebase 平台**(維護者拍板,ADR-005;
  原 registry 骨架保留為自架備援)。新 repo `../YoliaWatching-market/`(已 git init):
  瀏覽頁(卡片+試播)、創作者頁(Google SSO→申請→審核→PNG 上傳/切片/命名/試播/發布)、
  管理頁(審帳號/停權/下架/增減 admin);rules 強制「id 前綴=handle」防冒名;
  零伺服器,Spark $0。
- 主 repo 唯一改動:market.js 的 `normalizeIndex`——同時吃 GitHub 陣列格式與
  平台物件格式(packUrl 自動組 `<根>/packs/<key>.json`)。
- **待維護者**:照 ../YoliaWatching-market/README.md 部署(建 Firebase 專案→填 config→
  deploy→bootstrap 首任 admin);開 GitHub repo push;實測創作者流與管理流。
- 未驗證:平台三頁全部未經瀏覽器實測(本環境無法);rules 權限矩陣需部署後手動驗
  (README 已列驗收流程)。

## 前次狀態（2026-07-10 深夜，layer4 批次：匯出/試播/市集/AI 教學）

- **匯出**：工房包卡「匯出」鈕（validatePack 防呆 → Blob 下載 .yolia.json）。
- **手動試播**：RTDB 新頂層節點 `/events`（rules 同改）；overlay 訂閱 nonce 觸發
  animOnly 播放（首快照不觸發）；桌面走 `POST /panel/api/play` → WS 廣播；
  工房頂部「試播」卡（getAnimations keys）。
- **市集**：panel 新「市集」分頁（yuupeek/renderer/market.js，sync 已登記）：
  fetch index.json → 卡片 → 安裝（本地 validatePack 重驗＋id 比對）→ 問啟用；
  已安裝/可更新標記（packFormat.compareVersions）；registry URL 存 localStorage
  （`yolia.marketplaceUrl`），**無預設值**——未設定時顯示設定提示（填中央平台的
  index.json 位址，見 ADR-005）。
- ~~registry 骨架~~：GitHub registry 路線被 ADR-005 中央平台取代，
  `../YoliaWatching-packs/` 已於 2026-07-10 經維護者確認刪除（未曾 push）。
  market.js 仍支援陣列型 index，自架 registry 可按 marketplace.md 重建。
- **AI 教學**：docs/guides/ai-generation-nano-banana.md（Nano Banana 2 手動流程）；
  generation-pipeline.md 階段二擱置註記；粉絲指南已連結。
- 未驗證：試播/市集 UI 為靜態追蹤；維護者桌面實測（試播按鈕、市集指本地假 index 裝
  demo 包、匯出再匯入迴圈）；雲端 e2e 照舊待部署。

## 前次狀態（2026-07-10 晚，小尾巴+技術債清理）

- **測試基線恢復全綠**（8 suites / 84 tests）：chatListener.test.js 重寫（舊版備份於
  docs/backups/）、新建 chatProcessor.test.js、新建 syncManifest.test.js（sync 清單守門:
  HTML 引用的 js 漏登記 sync.js 即紅字）。CLAUDE.md 鐵律 4 已改回「必須全綠」。
- 角色包小尾巴清畢：validatePack srcs 字元集收緊+4MB 精確位元組(spec §8 同步)、
  web overlay 殘留清除改用 buildAnimationsUpdate(修 prototype-prop 邊界)、
  工房編輯器單一重繪出口(孤兒計時器/manifest 還原修復)、isValidStateName 去重、
  桌面版非啟用包不再廣播。
- dead code:frames.js 已刪(grep 零引用)、detector.js 檔頭加未接線註記。
- 文件:web/DEPLOY.md 改一頁式指向 README;README 修 test-ui 描述與 secrets 數量(6)。
- 未驗證:工房 UI 修改僅靜態追蹤(無 DOM 測試框架);維護者桌面實測清單仍待跑
  (見 docs/superpowers/plans/2026-07-10-desktop-pack-support.md Task 5)。

## 前次狀態（2026-07-10，桌面版角色工房支援）

- 桌面版角色工房已支援（ADR-004）：packs 存 `<userDataDir>/packs.json`、activePackId 存
  config.json、obsServer 加 5 條 `/panel/api/packs*`/`active-pack` 路由、panel 桌面 adapter
  換 fetch 實作並載入共用 workshop.js/packFormat.js（obsServer 靜態服務直接供應）、
  合併/清殘留邏輯=packFormat.js 新純函數 `buildAnimationsUpdate`（含測試）。
  已驗證：npm test 63/63（僅既有 chatListener 基線紅字）、路由測試、sync.js。
  未驗證：維護者 `npm start` 手動清單（見 docs/superpowers/plans/2026-07-10-desktop-pack-support.md Task 5）。

## 前次狀態（2026-07-09，Task 10 文件更新）

- 角色工坊 Phase 1 + 擴充包(base:"builtin")已實作:packFormat.js(含測試)、
  character.js srcs、/packs rules、overlay activePackId、panel 角色工房分頁+workshop.js、
  粉絲投稿指南。已驗證:npm test(packFormat+character 綠)、桌面版降級、test-ui 沙盒。
  未驗證:雲端 e2e(需部署後手動:匯入 sample sheet → 啟用 → onMessage 觸發)。
  設計:docs/designs/fan-extension-pack.md、ADR-003。

  最終審查修正後續(2026-07-09):
  - late-resolve config race 已由 latestConfig 大致修好,見 web/public/index.html。
  - 剩餘已知後續:`s in baseline` prototype-prop 邊界情況(web/public/index.html 的 purge 過濾)。
  - 剩餘已知後續:編輯器開著時移除另一個動畫,殘留孤兒 preview interval(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:renderEditor 在 ms/loop 變更時會還原未儲存的 manifest 輸入(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:PackFormat 可考慮匯出 isValidStateName,去重 addAnim 內建的 regex(yuupeek/renderer/workshop.js)。
  - 剩餘已知後續:validatePack 的 srcs 字元集可再收緊,作為縱深防禦(yuupeek/src/packFormat.js)。
  - 剩餘已知後續:4MB 上限目前用 UTF-16 字串長度當代理值,非精確位元組數。
  - 編輯啟用中的包現在即時生效(overlay 改為訂閱啟用中的 /packs 節點,見 web/public/index.html)。

| # | 交付項 | 檔案 | 狀態 |
|---|--------|------|------|
| 0 | CLAUDE.md 路由 | CLAUDE.md | ✅ |
| 1 | 架構全貌 | docs/ARCHITECTURE.md | ✅ 含技術債查證結論 |
| 2 | 平台定位評估 | docs/decisions/ADR-001-platform-positioning.md | ✅ |
| 3 | 工作制度（給弱模型） | docs/PLAYBOOK.md | ✅ |
| 4 | 角色包格式規格 | docs/specs/character-pack-format.md | ✅ 基石文件 |
| 5 | spritecook 整合 | docs/decisions/ADR-002-spritecook-integration.md | ✅ spritecook=spritecook.ai，已線上查證格式 |
| 6 | 動畫編輯器設計 | docs/designs/animation-editor.md | ✅ 含第四種觸發（手動）分析 |
| 7 | 生成管線設計 | docs/designs/generation-pipeline.md | ✅ 含 prompt 範本、CORS spike 前置 |
| 8 | 市集設計 | docs/designs/marketplace.md | ✅ GitHub registry 方案，Spark 免升級 |
| 9 | 對抗審查＋read-back | （無檔案，流程） | ✅ 25 發現全修（含 3 嚴重）、37 宣稱抽驗通過、連結兩輪全綠 |
| 10 | 一頁總結 | 回覆訊息＋本檔 | ✅ |

另：記憶系統已建立（user-profile、session-conduct-preferences 兩則＋索引）。

## 本 session 已確認的關鍵事實（下一個 session 不用重查）

- 動畫 runtime 格式：`{ folder, frames: number[], ms, loop }`，逐幀 PNG，
  路徑 = `assetBase/<folder>/<兩位數補零>.png`。定義在 [character.js](../yuupeek/renderer/character.js) 的
  `setAnimations()`（約 L329）。
- 雲端版 overlay 的 assetBase = `./assets/sprites/frames`（[index.html](../web/public/index.html) 約 L103）。
- `config/animations`（RTDB）已能覆蓋/新增動畫；panel 的動畫下拉選單自動吃
  `getAnimations()` 的 keys（panel.html 約 L663）。
- 缺口 A：web 版 panel 的 api adapter **沒有 saveAnimations**（桌面版有），雲端版無法在 UI 編動畫。
- 缺口 B：自訂 sprite 圖檔目前只能放 repo 靜態檔（要 redeploy 才會生效），沒有上傳機制。
- `setAnimations` 只支援「assetBase 相對路徑 + folder + 幀索引」，不支援完整 URL 或 data URL
  ——這是角色包功能唯一需要動 character.js 的地方。
- 共用檔（character.js / chatProcessor.js / panel.html）原始碼在 yuupeek/，
  web/public/ 的副本由 web/sync.js 部署時複製。
- 文件矛盾：web/DEPLOY.md 還在教 FIREBASE_TOKEN，實際 CI 已改用 FIREBASE_SERVICE_ACCOUNT
  （README 是對的）。→ 待修。

## 地雷區（會咬人的細節）

- web/public/index.html 的 `DEFAULT_ANIMATIONS` 與 yuupeek/main.js 的 `DEFAULT_ANIMATIONS`
  是**手動鏡像**的兩份，改一邊必須改另一邊（index.html L56 有註解）。
- overlay 是 `db.ref('config').on('value')` 訂閱**整個 config 節點**——任何塞進 config
  的大資料（例如 base64 圖）都會在每次任何設定變更時整包重新下載。大資料要放 config 以外的節點。
- YouTube 輪詢遇到 403/quota 會**永久停止**（index.html 約 L224）；重啟條件很窄：重整頁面，
  或變更 youtube 的 enabled/channel/apiKey 三者之一（改其他設定欄位救不回來）。
- **測試基線非全綠**：`chatListener.test.js` 整個 suite 載入失敗（測重構前舊 API），
  其餘 4 suite（22 tests）全過（2026-07-07 實測）。這不是你弄壞的；見下方待辦。
- `npm run test-ui`（port 3001 沙盒）console **必有**兩種紅字（WS 重連、pet-config 404），
  是 test-server 功能缺口，不算驗證失敗；且沙盒讀不到 RTDB/animations.json 的自訂動畫。
- chatProcessor.js 沒有專屬測試檔（chatListener.test.js 不是它的測試）。

## 待辦（工單）

1. **重寫 `yuupeek/src/__tests__/chatListener.test.js`**：改測現行 API（`createChatListener`），
   或先確認舊函數（applyCommand/buildGreetRe）是否該回到 chatListener.js。修好後把
   CLAUDE.md 鐵律 4 與 PLAYBOOK DoD 第一條改回「必須全綠」。
2. **新建 `yuupeek/src/__tests__/chatProcessor.test.js`**：至少涵蓋指令 cost 不足、關鍵詞 +1
   疊加、未知 trigger 靜默忽略三個案例。
3. 修三處過時文件（清單見 PLAYBOOK §7）：web/DEPLOY.md、yuupeek/README.md 互動範例、
   根 README 的 test-ui 描述與「5 個 secret」。

## 給未來 session 的信（2026-07-07 制度建立 session 已完整收尾）

制度與設計文件已全部落地且經過對抗審查。接下來的正確順序：

1. **維護者先做**：review 本次產出（全部未 commit，`git status` 可見），確認後自行 commit。
   注意 PLAYBOOK §6：push main 會觸發真部署（本次只有 docs/ 與 CLAUDE.md，部署無害但要知情）。
2. **第一張工單**：修測試基線（本檔「待辦」1、2；已有現成 task chip 可一鍵開工）。
   基線全綠後才開始功能開發，否則 DoD 判準會一直帶著例外。
3. **功能開發起點**：docs/designs/animation-editor.md §5 的 Phase 1 清單（從 packFormat.js
   ＋測試開始，那是純函數、風險最低、其他一切的地基）。
4. 每個新 session：CLAUDE.md 會自動載入，照它的路由表讀對應文件再動手。
