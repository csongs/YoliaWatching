# PLAYBOOK — 工作制度（每次改動都適用）

> 讀者：在這個 repo 工作的任何 AI session（含較小的模型）與人類協作者。
> 原則：規則必須「可檢查」——每條都有具體動作或判準，做沒做得到一翻兩瞪眼。
> 事實標註慣例（全 docs/ 通用）：**【事實】**=已查證，附出處；**【建議】**=判斷，可推翻；**【未查證】**=不確定，用前先查。
> **2026-08-16**：Firebase 雲端版（原 `web/`）已移除，聊天連線改由獨立的 `chat-monitor/`
> process 負責。本檔跟著全文改寫，舊版提到「RTDB」「web/public/ 副本」「雲端 overlay」的
> 規則已不適用。

## 0. 開工儀式（每個 session 開頭，2 分鐘）

1. 讀 CLAUDE.md 的鐵律與路由表。
2. 接續舊工作 → 先讀 docs/HANDOFF.md「目前狀態」與「地雷區」。
3. 動手前，確認要碰的檔案屬於哪個 process：`yuupeek/`（桌寵本體）還是 `chat-monitor/`
   （聊天監聽，獨立 npm 專案，不會被 `yuupeek/npm test` 覆蓋到，改完要自己在
   `chat-monitor/` 下跑跑看）。

## 1. 完工定義（DoD——全部打勾才算完成）

- [ ] `cd yuupeek && npm test` **必須全綠**（2026-08-16 起基線 9 suites 全綠）。
      出現任何紅字 → 回報中原文貼出錯誤，不可含糊帶過。
- [ ] 改了共用檔（character.js / chatProcessor.js / panel.html）→ 執行 `cd yuupeek && npm run test-ui`，
      開 `http://localhost:3001`（角色沙盒頁 test.html），確認頁面載入、角色會動。
      【已知例外，不算失敗】此沙盒必然出現兩種 console 紅字：WebSocket 對 3001 的重連錯誤、
      `/panel/api/pet-config` 404（test-server 沒有這兩個功能）。這兩種以外的紅字才是問題。
- [ ] 改了動畫格式或互動規則格式 → 對照 §3 檢查表，確認舊資料讀新程式不會壞。
- [ ] 改了行為 → 同步更新 docs/ARCHITECTURE.md 的對應小節（只改受影響的行，不重寫整份）。
- [ ] 做了「為什麼選 A 不選 B」等級的決策 → 補一份 docs/decisions/ADR-NNN（短的也要，20 行可）。
- [ ] docs/HANDOFF.md 補狀態：做了什麼、剩什麼、新踩到的雷。
- [ ] 最終回報分開寫明：「已驗證的」與「沒驗證的」。禁止寫「應該可以」「理論上沒問題」
      這類字眼替代驗證——沒驗證就寫「未驗證」。

## 2. 驗證手冊

| 要驗什麼 | 怎麼驗 | 通過標準 |
|---|---|---|
| 訊息處理邏輯 | `cd yuupeek && npm test`（jest，9 個測試檔在 yuupeek/src/__tests__/） | 全綠（DoD 第一條） |
| 角色動畫/行為 | `npm run test-ui` → http://localhost:3001（test.html 沙盒，不需聊天室）。注意：沙盒**吃不到** animations.json 的自訂動畫（test-server 不提供），只能驗內建動畫與 character.js 程式改動 | 動畫播放正常；console 紅字僅限 DoD 列的兩種已知例外 |
| 桌面版整體（不含聊天） | `cd yuupeek && npm start` → http://localhost:3000/panel | 面板可開、可存設定 |
| 桌面版含聊天室端到端 | 先 `cd chat-monitor && npm start`，再 `cd yuupeek && npm start`，panel「模組狀態」分頁看聊天室連線燈號 | 燈號顯示已連線；OBS Browser Source 指到 http://localhost:3000 能收到聊天反應 |
| 模擬聊天訊息（不用真的聊天） | chat-monitor 有模擬事件 API（`POST /api/simulate/:eventType`，或開 `http://127.0.0.1:3100/simulate.html`），送一筆 `event_type:"chat"` 的事件，桌寵這邊應該立刻反應（幽視值變化、動畫觸發）。細節見 chat-monitor/README.md「模擬事件」 | 幽視值變化、動畫觸發、泡泡文字正確 |
| chat-monitor 本身（連線/事件分類） | 獨立的 npm 專案，沒有 jest 測試；用上面的模擬事件 API 或真的開台驗證，見 chat-monitor/README.md | 見 chat-monitor 自己的驗證方式 |

寫測試的判準：改了 chatProcessor.js 的行為 → **必須**加測試案例；
改了 character.js 的純邏輯（如格式解析）→ 加測試；純視覺行為（位移、繪圖）→ 用沙盒頁人工驗，回報中註明。

## 3. 格式演進規則（本 repo 最重要的工程約束）

背景【事實】：桌寵讀的是本機 config.json/animations.json，理論上單機沒有「舊資料 vs 新程式」
的跨裝置問題；但角色包（`.yolia.json`，見 docs/specs/character-pack-format.md）會被分享/安裝
到別人的環境，仍然可能出現「新程式讀舊格式角色包」，格式相容規則依然適用。

**規則（違反任一條 = 改動不合格）：**
1. 既有欄位的名稱、型別、取值範圍、語意，一律不准改。
2. 新欄位一律 optional，且**讀取端**要有預設值容錯（`?? 預設值` 或 `if (!x) return`）。
3. 舊程式讀到「不認識的資料」必須是**靜默忽略**而非壞掉。現有程式已有這個性質，要保持：
   - `buildHandlers()` 只挑 `trigger === 'command' / 'keyword'`，未知 trigger 的物件自然被無視。
   - `setAnimations()` 檢查 `def?.folder && Array.isArray(def.frames)`，不合格式的項目自然跳過。
4. 資料遷移只准做「讀取端正規化」：寫一個純函數（放共用模組，如 chatProcessor.js 或新模組），
   讀進來先 normalize 再用。**禁止**在儲存時改寫舊資料形狀。

**範例：**
- ✅ 好：animations 項目新增 optional `srcs`（完整 URL 陣列）。有 `srcs` 用 `srcs`，
  沒有就照舊組 folder 路徑。舊格式：`setAnimations` 看不到 folder 就跳過該項 → 該狀態回退內建動畫，
  **降級但不壞**。
- ❌ 壞：把 `frames` 從「索引陣列」改成「張數」——舊資料把數字當陣列用，直接壞。
- ❌ 壞：儲存時把舊的 `match: "安安"`（字串）統一改寫成陣列——一旦新格式有 bug，
  使用者的原始資料已被污染、無法回退。

**真的需要 breaking change 時**：新名字新欄位並存（如 `frames2`）→ 讀取端優先吃新欄位 →
在 ADR 記錄棄用計畫 → 至少隔一個「使用者可感知的版本公告」才移除舊欄位讀取。

## 4. 下結論前查證（誤判防治）

**規則：宣稱「X 壞了／缺了／沒被呼叫／是 dead code」之前，走完對應檢查鏈：**
- 「檔案不存在」→ 先查 `.gitignore`（根目錄與子目錄的都要看）。
- 「dead code」→ grep 不到 import 還不夠，再排除：字串拼接載入（如 `${assetBase}/${folder}`）、
  HTML 的 `<script src>`、動態 require、測試檔引用。全排除才可下「dead」結論，並寫出你排除了哪些。
- 「chat-monitor 沒開/連不上」→ 桌寵這端是靜默重試（`chatMonitorClient.js`，3 秒一次），
  不會報錯彈窗，別誤判成「WebSocket 邏輯壞了」，先確認 chat-monitor process 有沒有真的在跑。

## 5. 哪些事不准自己拍板（升級判準）

以下情況**停下來**，把選項與 trade-off 寫清楚讓維護者決定（表格：選項/優點/風險/推薦），
不要自行執行：

1. 格式的 breaking change（動畫格式、角色包格式、chat-monitor 的 SQLite schema）。
2. 安全相關：chat-monitor/obsServer 的本機 server 開放區網、auth 流程、金鑰的存放位置改變。
3. 刪除或覆寫使用者資料／素材（config.json/animations.json/packs.json、chat-monitor 的
   events.sqlite、assets 圖檔）。
4. 涉及錢與法務：付費機制、授權條款、第三方服務綁定。
5. 品味題（UI 視覺風格、文案語氣、角色個性、定價）：AI 的判斷不可靠。
   給 2–3 個具體選項＋各自效果描述；若流程無法等待回覆，選「最容易撤銷」的選項，
   並在 HANDOFF.md 記「此處是暫定，等維護者確認」。
6. 擴大聊天事件的處理範圍（目前只接 `event_type==='chat'`，見 CLAUDE.md 鐵律 2）——
   要不要接斗內/訂閱/Raid 進互動規則系統是產品範圍決策，不是技術細節，先問。

倒過來說：不在上列的（加測試、修 bug、加 optional 欄位、文件更新、重構不改行為）→
直接做完並回報，不要停下來問。

## 6. Git 與備份

- **不准主動 commit / push。** 改動一律停在工作區，由維護者決定何時 commit/push。
  維護者明確要求時才例外。
- 大改既有檔案（會刪除或重寫該檔 >30% 內容）→ 先備份：
  `cp <檔案> docs/backups/<檔名>.<YYYY-MM-DD>.bak`。小改靠 git diff 即可。
- 需要維護者 commit 時，在回報中給出建議的 commit 切分與訊息（繁中可）。

## 7. 文件維護制度

- **單一事實源**：系統事實＝ARCHITECTURE.md；決策與理由＝docs/decisions/；
  未實作的設計＝docs/designs/；session 交接＝HANDOFF.md。
  同一件事不要寫在兩處，第二處只放連結。
- ADR 規則：要推翻舊決策，寫新 ADR 並在舊 ADR 頂部加一行「已被 ADR-NNN 取代」，不刪舊檔。
- docs/plans/ 是 2026-05 的歷史計畫，唯讀參考，不要更新它。
- 已知過時文件（待修清單）：
  - yuupeek/README.md 的 interactions 範例：用了舊欄位 `keywords`/`command`/`state`，
    實際格式是 `match`/`animation`（以 panel 產生、chatProcessor 消費的為準）。

## 8. 常見任務食譜

**A. 新增一個動畫狀態（含素材）**
1. 幀圖放 `yuupeek/assets/sprites/frames/<新資料夾>/00.png…NN.png`（兩位數補零）。
2. 進 panel「桌寵設定」或直接改 animations.json 加 `<狀態名>: { folder, frames: [索引], ms, loop }`。
   不需要改 character.js——`setAnimations` 會吃掉新狀態。
3. 若要成為「預設」動畫：改 `yuupeek/src/defaultAnimations.js`（單一源頭，只有這一份）。
4. 驗證：新狀態存進 animations.json 後，看 panel 下拉選單是否出現新狀態名
   （panel 由 getAnimations 自動帶入）。注意 test-ui 沙盒**驗不到** animations.json 來的新動畫；
   端到端要在 `npm start` 的桌寵上驗。

**B. 新增/修改互動（指令、關鍵詞、門檻）**
1. 邏輯在 `yuupeek/src/chatProcessor.js`（純函數）；預設值在 `yuupeek/default.config.json`。
2. 改邏輯必加測試；跑 `npm test`。
3. 驗證：用 chat-monitor 的模擬事件 API 送一筆 `chat` 事件（見 §2），或真的在聊天室打字。

**C. 改 character.js**
1. 先讀 docs/specs/character-pack-format.md §引擎擴充（若與格式相關）。
2. 保持 `createCharacter(options)` 既有參數與回傳 API 的相容（`obs-overlay.html`、`test.html`
   兩個呼叫端）。
3. `npm test` + test-ui 沙盒過。

**D. 改 chat-monitor 的聊天事件分類/連接器**
1. 邏輯在 `chat-monitor/connectors/*.js`；欄位對照表在 `chat-monitor/docs/event-types.md`。
2. 這是獨立 npm 專案，`yuupeek && npm test` 測不到，改完自己在 `chat-monitor/` 下
   `npm start` 驗，或用模擬事件 API（§2）。
3. 若新增/改了 `event_type`，桌寵這端目前只認 `chat`，其他類型不會有任何反應——這是預期
   行為，不是漏接（CLAUDE.md 鐵律 2）。
