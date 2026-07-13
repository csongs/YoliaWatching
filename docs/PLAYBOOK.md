# PLAYBOOK — 工作制度（每次改動都適用）

> 讀者：在這個 repo 工作的任何 AI session（含較小的模型）與人類協作者。
> 原則：規則必須「可檢查」——每條都有具體動作或判準，做沒做得到一翻兩瞪眼。
> 事實標註慣例（全 docs/ 通用）：**【事實】**=已查證，附出處；**【建議】**=判斷，可推翻；**【未查證】**=不確定，用前先查。

## 0. 開工儀式（每個 session 開頭，2 分鐘）

1. 讀 CLAUDE.md 的鐵律與路由表。
2. 接續舊工作 → 先讀 docs/HANDOFF.md「目前狀態」與「地雷區」。
3. 動手前，列出這次會碰的檔案清單，逐一問：「這是 yuupeek/ 源頭還是 web/public/ 副本？」
   （副本清單：web/public/ 下的 character.js、chatProcessor.js、panel.html、assets/——都不准直接改。）

## 1. 完工定義（DoD——全部打勾才算完成）

- [ ] `cd yuupeek && npm test` **不得新增紅字**。已知紅字基線（2026-07-07）：`chatListener.test.js`
      整個 suite 載入失敗（測舊 API；修復工單見 HANDOFF 待辦），其餘 4 個 suite 必須全綠。
      出現基線以外的紅字 → 回報中原文貼出錯誤，不可含糊帶過。
- [ ] 改了共用檔（character.js / chatProcessor.js / panel.html）→ 執行 `cd yuupeek && npm run test-ui`，
      開 `http://localhost:3001`（角色沙盒頁 test.html），確認頁面載入、角色會動。
      【已知例外，不算失敗】此沙盒必然出現兩種 console 紅字：WebSocket 對 3001 的重連錯誤、
      `/panel/api/pet-config` 404（test-server 沒有這兩個功能）。這兩種以外的紅字才是問題。
- [ ] 改了 RTDB 相關 → 對照 §3 檢查表；新頂層節點必有對應 rules。
- [ ] 改了行為 → 同步更新 docs/ARCHITECTURE.md 的對應小節（只改受影響的行，不重寫整份）。
- [ ] 做了「為什麼選 A 不選 B」等級的決策 → 補一份 docs/decisions/ADR-NNN（短的也要，20 行可）。
- [ ] docs/HANDOFF.md 補狀態：做了什麼、剩什麼、新踩到的雷。
- [ ] 最終回報分開寫明：「已驗證的」與「沒驗證的」。禁止寫「應該可以」「理論上沒問題」
      這類字眼替代驗證——沒驗證就寫「未驗證」。

## 2. 驗證手冊

| 要驗什麼 | 怎麼驗 | 通過標準 |
|---|---|---|
| 訊息處理邏輯 | `cd yuupeek && npm test`（jest，5 個測試檔在 yuupeek/src/__tests__/）。注意【事實】：chatProcessor.js **目前沒有專屬測試檔**（stateMachine 有，別搞混）——首次改動 chatProcessor 時先新建 `__tests__/chatProcessor.test.js` | 除已知紅字基線（DoD 第一條）外全綠 |
| 角色動畫/行為 | `npm run test-ui` → http://localhost:3001（test.html 沙盒，不需聊天室）。注意：沙盒**吃不到** RTDB／animations.json 的自訂動畫（test-server 不提供），只能驗內建動畫與 character.js 程式改動 | 動畫播放正常；console 紅字僅限 DoD 列的兩種已知例外 |
| 桌面版整體 | `cd yuupeek && npm start` → http://localhost:3000/panel | 面板可開、可存設定 |
| 雲端 overlay | **沒有本機一鍵驗證**。方式：(a) 共用邏輯靠上面兩項；(b) 端到端＝部署到維護者自己的 Firebase 後開 `https://<id>.web.app` | 見下方「模擬聊天」 |
| 模擬聊天訊息 | 雲端 overlay 頁：DevTools console 執行 `onMessage('安安', '測試員')`、`onMessage('!加油', '測試員')`（`onMessage` 是 index.html 頂層函數）。本機沙盒 test.html 的對應函數名是 `processMessage`（頁面頂層，簽名見 test.html 約 L267，呼叫前先看一眼） | 幽視值變化、動畫觸發、泡泡文字正確 |
| 部署產物 | 手動跑 `cd web && node sync.js`，檢查 web/public/ 出現副本（驗完可留著，.gitignore 已排除） | 檔案齊、內容=源頭 |

寫測試的判準：改了 chatProcessor.js 的行為 → **必須**加測試案例（目前無 chatProcessor.test.js，
首次改動時新建）；
改了 character.js 的純邏輯（如格式解析）→ 加測試；純視覺行為（位移、繪圖）→ 用沙盒頁人工驗，回報中註明。

## 3. 格式演進規則（本 repo 最重要的工程約束）

背景【事實】：使用者升級 = GitHub「Sync fork」→ CI 重新部署。RTDB 裡躺著的是**舊資料**，
OBS 裡可能還開著**舊頁面**。所以任何時刻都可能出現「新程式讀舊資料」與「舊程式讀新資料」。

**規則（違反任一條 = 改動不合格）：**
1. 既有欄位的名稱、型別、取值範圍、語意，一律不准改。
2. 新欄位一律 optional，且**讀取端**要有預設值容錯（`?? 預設值` 或 `if (!x) return`）。
3. 新增 RTDB 頂層節點 → 同一次改動內更新 `web/database.rules.json`（`$other` 預設全拒，忘了=靜默讀不到）。
4. 舊程式讀到「不認識的資料」必須是**靜默忽略**而非壞掉。現有程式已有這個性質，要保持：
   - `buildHandlers()` 只挑 `trigger === 'command' / 'keyword'`，未知 trigger 的物件自然被無視。
   - `setAnimations()` 檢查 `def?.folder && Array.isArray(def.frames)`，不合格式的項目自然跳過。
5. 資料遷移只准做「讀取端正規化」：寫一個純函數（放共用模組，如 chatProcessor.js 或新模組），
   讀進來先 normalize 再用。**禁止**在 panel 儲存時改寫舊資料形狀（使用者可能同時開著舊版 overlay）。

**範例：**
- ✅ 好：animations 項目新增 optional `srcs`（完整 URL 陣列）。新 overlay：有 `srcs` 用 `srcs`，
  沒有就照舊組 folder 路徑。舊 overlay：`setAnimations` 看不到 folder 就跳過該項 → 該狀態回退內建動畫，
  **降級但不壞**。（注意：這是格式層的相容範例；實務上 data URL 幀圖一律存 `/packs` 節點，
  **不放** `config/animations`——大資料進 /config 違反 ADR-001 紅線 1。config/animations 裡的
  `srcs` 僅限少量 https URL 的情境。）
- ❌ 壞：把 `frames` 從「索引陣列」改成「張數」——舊 overlay 把數字當陣列用，直接壞。
- ❌ 壞：panel 存檔時把舊的 `match: "安安"`（字串）統一改寫成陣列——正在跑的舊 overlay 沒差，
  但這是寫入端遷移，一旦新格式有 bug，使用者的原始資料已被污染、無法回退。

**真的需要 breaking change 時**：新名字新欄位並存（如 `frames2`）→ 讀取端優先吃新欄位 →
在 ADR 記錄棄用計畫 → 至少隔一個「使用者可感知的版本公告」才移除舊欄位讀取。

## 4. 下結論前查證（誤判防治）

實例【事實】：2026-07-07 一個盤點 agent 斷言「CI 沒呼叫 sync.js，線上版 404 癱瘓」。
錯。`firebase deploy` 會自動執行 `web/firebase.json` 的 `predeploy`（裡面就有 `node sync.js`），
而 web/public/ 的「缺檔」是 .gitignore 刻意排除的建置產物。

**規則：宣稱「X 壞了／缺了／沒被呼叫／是 dead code」之前，走完對應檢查鏈：**
- 「CI 缺步驟」→ 查三處：workflow yml、`firebase.json` 的 predeploy、`package.json` 的 pre/post scripts。
- 「檔案不存在」→ 先查 `.gitignore`（根目錄與子目錄的都要看）。
- 「dead code」→ grep 不到 import 還不夠，再排除：字串拼接載入（如 `${assetBase}/${folder}`）、
  HTML 的 `<script src>`、動態 require、測試檔引用。全排除才可下「dead」結論，並寫出你排除了哪些。
- 「線上壞了」→ 除非親自打開 URL 或看到錯誤記錄，一律寫「疑似」，不寫斷言。

## 5. 哪些事不准自己拍板（升級判準）

以下情況**停下來**，把選項與 trade-off 寫清楚讓維護者決定（表格：選項/優點/風險/推薦），
不要自行執行：

1. 格式的 breaking change（RTDB schema、動畫格式、角色包格式）。
2. 安全相關：database.rules.json 放寬、auth 流程、金鑰的存放位置改變。
3. 刪除或覆寫使用者資料／素材（RTDB 資料、assets 圖檔）。
4. 涉及錢與法務：付費機制、授權條款、第三方服務綁定。
5. 品味題（UI 視覺風格、文案語氣、角色個性、定價）：AI 的判斷不可靠。
   給 2–3 個具體選項＋各自效果描述；若流程無法等待回覆，選「最容易撤銷」的選項，
   並在 HANDOFF.md 記「此處是暫定，等維護者確認」。

倒過來說：不在上列的（加測試、修 bug、加 optional 欄位、文件更新、重構不改行為）→
直接做完並回報，不要停下來問。

## 6. Git 與備份

- **不准主動 commit / push。** 特別注意【事實】：**push 到 main 會觸發 GitHub Actions
  真的部署到維護者的 Firebase**（.github/workflows/deploy.yml）。改動一律停在工作區，
  由維護者決定何時 commit/push。維護者明確要求時才例外。
- 大改既有檔案（會刪除或重寫該檔 >30% 內容）→ 先備份：
  `cp <檔案> docs/backups/<檔名>.<YYYY-MM-DD>.bak`。小改靠 git diff 即可。
- 需要維護者 commit 時，在回報中給出建議的 commit 切分與訊息（繁中可）。

## 7. 文件維護制度

- **單一事實源**：部署教學＝README.md（web/DEPLOY.md 已過時待修）；系統事實＝ARCHITECTURE.md；
  決策與理由＝docs/decisions/；未實作的設計＝docs/designs/；session 交接＝HANDOFF.md。
  同一件事不要寫在兩處，第二處只放連結。
- ADR 規則：要推翻舊決策，寫新 ADR 並在舊 ADR 頂部加一行「已被 ADR-NNN 取代」，不刪舊檔。
- docs/plans/ 是 2026-05 的歷史計畫，唯讀參考，不要更新它。
- 已知過時文件（待修清單）：
  - web/DEPLOY.md：FIREBASE_TOKEN → 實際是 FIREBASE_SERVICE_ACCOUNT。
  - yuupeek/README.md 的 interactions 範例：用了舊欄位 `keywords`/`command`/`state`，
    實際格式是 `match`/`animation`（以 panel 產生、chatProcessor 消費的為準）。
  - 根 README.md 對 `npm run test-ui` 的描述（「雲端版 UI」）不準：實際是 test.html 角色沙盒。
  - 根 README.md 步驟四寫「5 個 secret」但表格實列 6 個（含 ADMIN_EMAIL）——正確數字是 6。

## 8. 常見任務食譜

**A. 新增一個動畫狀態（含素材）**
1. 幀圖放 `yuupeek/assets/sprites/frames/<新資料夾>/00.png…NN.png`（兩位數補零）。
2. 進 RTDB `config/animations` 加 `<狀態名>: { folder, frames: [索引], ms, loop }`
   （或桌面版 animations.json）。不需要改 character.js——`setAnimations` 會吃掉新狀態。
3. 若要成為「預設」動畫：改 `yuupeek/main.js` 與 `web/public/index.html` **兩份** DEFAULT_ANIMATIONS；
   若改的是既有預設動畫的幀序，還要檢查第三份副本＝character.js L29–39 內建表（fallback 用）。
4. 驗證：新狀態存進 RTDB／animations.json 後，看 panel 下拉選單是否出現新狀態名
   （panel 由 getAnimations 自動帶入）。注意 test-ui 沙盒**驗不到** config 來的新動畫
   （它讀不到 RTDB/animations.json）；端到端要在部署後的 overlay 上驗。

**B. 新增/修改互動（指令、關鍵詞、門檻）**
1. 邏輯在 `yuupeek/src/chatProcessor.js`（純函數）；預設值在 `yuupeek/default.config.json`。
2. 改邏輯必加測試；跑 `npm test`。
3. 驗證：雲端 overlay console `onMessage('!新指令', '測試員')`（本機沙盒的函數名是 `processMessage`）。

**C. 新增 RTDB 頂層節點（如未來的 /packs）**
1. `web/database.rules.json` 加節點規則（想清楚讀寫權限，預設：讀公開、寫僅 admin）。
2. panel.html 的 web DataAdapter 加對應 get/save 方法；桌面版 obsServer.js 加對應 route（若桌面版需要）。
3. overlay（index.html）加讀取。大資料節點用 `once('value')` 一次讀，**不要**掛在 `/config` 訂閱裡。
4. 驗證：部署前先在 Firebase console 手動塞測試資料。

**D. 改 character.js**
1. 先讀 docs/specs/character-pack-format.md §引擎擴充（若與格式相關）。
2. 保持 `createCharacter(options)` 既有參數與回傳 API 的相容（桌面 obs-overlay.html、test.html、
   雲端 index.html 三個呼叫端）。
3. `npm test` + test-ui 沙盒過。
