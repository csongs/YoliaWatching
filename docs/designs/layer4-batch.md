# 設計:匯出/試播/市集/AI 教學 批次(2026-07-10,維護者已核可)

> 增量設計:試播機制以 docs/designs/animation-editor.md §4 為基底、市集以
> docs/designs/marketplace.md 為基底,本檔只記本次拍板的差異與落地細節。
> 4d 生成教學:docs/designs/generation-pipeline.md 階段二擱置(工具已改 Nano Banana 2)。

## 4a. 匯出 .yolia.json

工房包清單每張卡加「匯出」:`validatePack` 防呆(庫內資料可能被場外改過)→
`Blob(JSON.stringify(pack, null, 2))` → `<a download="<id>.yolia.json">`。雲端/桌面通用。

## 4b. 手動試播

- 雲端:新 RTDB 頂層節點 `/events = { manualPlay: { animation, nonce } }`
  (事件不放 /config;rules 讀公開/寫 admin,鐵律 3)。overlay 訂閱 `/events`:
  首次快照只記 nonce 不觸發(重整不重播);nonce 變更且 animation 存在 →
  `char.applyUpdate({ state, animOnly: true })`(引擎 playOnce 播完自動回 baseState,
  循環動畫也只播一輪,免 reset 計時器)。
- 桌面:`POST /panel/api/play` → main.js `obsServer.broadcast({ value, state, animOnly: true })`。
- adapter 統一介面:`api.playAnimation(name) → Promise<{ok}>`。
- UI:工房包清單上方加「試播」卡,按鈕=getAnimations() 的 keys(data-act 委派)。

## 4c. 市集(panel 分頁+registry 骨架)

- panel 新分頁「市集」(web+桌面同用;安裝走既有 api.savePack):
  fetch `<registryUrl>`(index.json)→ 卡片(名稱/作者/授權/大小/描述)→
  「安裝」= fetch packUrl → 本地 `validatePack` 重驗(不信任 registry)→ savePack →
  問啟用。已安裝顯示標記;`compareVersions(index.version, installed.version) > 0` 顯示「可更新」。
  fetch 失敗顯示「無法連線市集」,不影響其他功能。
- **registry URL 儲存【拍板】**:`localStorage['yolia.marketplaceUrl']`,分頁內有輸入框可改;
  預設 `https://cdn.jsdelivr.net/gh/csongs/YoliaWatching-packs@main/index.json`
  (owner=package.json publish 設定)。不進 RTDB/config——市集是 panel 端功能,
  overlay 用不到,與 generation-pipeline.md 金鑰同理;免 schema/rules 變更。
- `compareVersions(a,b)` 放 packFormat.js(semver 欄位屬格式範疇,isomorphic+可測)。
- 邏輯放新共用檔 `yuupeek/renderer/market.js`(仿 workshop.js:data-act 委派、esc、
  sync 清單登記;syncManifest 守門測試自動涵蓋)。
- **registry 骨架落點【拍板】**:主 repo 外的兄弟資料夾 `../YoliaWatching-packs/`
  (marketplace.md §4:不放主 repo)。內容:README(投稿規則+「投稿者自行保證散布權」
  免責)、`packs/demo.starter/pack.yolia.json` 示範包(極小合法包,非 Yolia 素材)、
  `scripts/packFormat.js`(複製)+`validate.js`(validatePack+自足性:srcs 全 data URL,
  比主 repo 嚴)+`build-index.js`(產 index.json)、`.github/workflows/validate.yml`。
  本地 git init;開 GitHub repo 與 push 由維護者執行。

## 4d. AI 生成教學(文件版)

- 新 `docs/guides/ai-generation-nano-banana.md`:Nano Banana 2 產單列 spritesheet 的
  prompt 範本與全流程(生成→工房匯入→綁指令);以 `yuupeek/assets/sprites/sample/`
  的實際產出為範例;模型參數/品質【未查證】照實標註。
- generation-pipeline.md 頂部加狀態:階段二擱置(綁 spritecook;維護者已改用
  Nano Banana 2,一鍵生成需先做 API 查證 spike)。
- docs/fan-submission-guide.md 加教學連結。

## 相容性

全 additive:`/events` 新節點(rules 同改),舊 overlay 不訂閱、靜默忽略;
market.js/試播 UI 只加分頁與按鈕;packFormat 只加 `compareVersions`。

## 驗證

- 單元:compareVersions(packFormat.test.js)、registry scripts 自測(validate 拒外連/壞包)。
- 手動:桌面 npm start——試播按鈕播動畫;市集 URL 指向本地假 index 測安裝流程;
  匯出檔可再匯入(來源 C 迴圈驗證)。雲端 e2e 照舊待部署後。
