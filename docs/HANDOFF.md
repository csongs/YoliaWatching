# HANDOFF — session 交接檔

> 用途：任何 session（不論模型大小）中斷或收尾時，把「做到哪、接下來做什麼」寫在這裡。
> 下一個 session 開場：先讀 CLAUDE.md，再讀本檔的「目前狀態」。
> 維護規則：完成一項就把狀態改成 ✅ 並補一句結果；新發現的坑寫進「地雷區」。

## 目前狀態（2026-07-09，Task 10 文件更新）

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
