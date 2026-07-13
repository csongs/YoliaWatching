# YoliaWatching — 給 Claude 的路由檔

直播互動桌寵：觀眾聊天訊息驅動 OBS overlay 上的角色動畫（幽視值 0–100 ＋門檻狀態機＋關鍵詞＋指令）。
**主力＝Firebase 雲端版**（`web/`，使用者 fork → 填 GitHub Secrets → CI 部署到使用者自己的 Firebase 專案）。
**次要＝Electron 桌面版**（`yuupeek/`）。與維護者溝通預設使用繁體中文。

## 動手前先讀（按任務選，通常只需讀 1–2 份）

| 你要做的事 | 必讀 |
|---|---|
| 任何程式改動（一律） | [docs/PLAYBOOK.md](docs/PLAYBOOK.md) — 工作制度、驗證步驟、格式演進規則 |
| 理解系統全貌／資料流／RTDB schema | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 角色包、動畫格式、spritecook 匯入 | [docs/specs/character-pack-format.md](docs/specs/character-pack-format.md) |
| 動畫編輯器 UI | [docs/designs/animation-editor.md](docs/designs/animation-editor.md) |
| AI 生成素材管線 | [docs/designs/generation-pipeline.md](docs/designs/generation-pipeline.md) |
| 角色市集／角色包上下架 | [docs/designs/marketplace.md](docs/designs/marketplace.md) |
| 「為什麼當初這樣設計」 | docs/decisions/ 下的 ADR（檔名即主題） |
| 接續上一個 session 的工作 | [docs/HANDOFF.md](docs/HANDOFF.md) |

## 鐵律（違反任一條＝這次改動不合格）

1. **改共用檔要改源頭**：`character.js`、`chatProcessor.js`、`panel.html` 的源頭在
   `yuupeek/renderer/` 與 `yuupeek/src/`。`web/public/` 下的同名檔案是部署時由
   `web/sync.js` 複製覆蓋的副本——直接改副本，下次部署就被沖掉。
   例外：`web/public/index.html` 是雲端版專屬檔（不在 sync 清單內），可直接改。
2. **格式只加不改**：RTDB `/config` 的既有欄位、動畫格式 `{ folder, frames, ms, loop }`
   的既有欄位，其語意與型別不可變更。只能「新增可選欄位」，且舊版 overlay 讀到新資料
   必須仍能運作（規則細節與範例見 PLAYBOOK §格式演進）。
3. **新增 RTDB 頂層節點時，必須同時修改 `web/database.rules.json`**：
   rules 的 `$other` 預設拒絕一切讀寫——忘了加規則，新功能會整個讀不到資料且不報錯。
4. **測試不得新增紅字**：`cd yuupeek && npm test`。已知紅字基線（2026-07-07）：
   `chatListener.test.js` 整個 suite 載入失敗（它測的是重構前的舊 API，待重寫，見 HANDOFF 待辦）。
   除它以外必須全綠；把它修好之後，請把本條改回「必須全綠」。
5. **預設動畫有三份副本要一起評估**：`web/public/index.html` 與 `yuupeek/main.js` 的兩份
   `DEFAULT_ANIMATIONS`（手動鏡像，必須同改），加上 `character.js` L29–39 的內建表
   （config 載入前與載入失敗時的 fallback，同值但少 watch_excited）——改預設幀序時三處都要檢查。
6. **文件中的規格數字要標來源**：quota、方案限制、價格等，寫進 docs/ 時必須附
   來源（檔案路徑或 URL）與日期；查不到就明寫「未查證」，不可編造。

## 常用指令

```bash
# 以下每行都從 repo 根目錄起算（不要連續照抄 cd）
cd yuupeek && npm install      # 首次
cd yuupeek && npm start        # 桌面版（panel: http://localhost:3000/panel）
cd yuupeek && npm test         # 單元測試（改動完成的必要條件）
cd yuupeek && npm run test-ui  # 角色/動畫沙盒頁 test.html（http://localhost:3001，不需聊天室）
# 雲端部署：push 到 main 自動觸發 GitHub Actions「Deploy to Firebase」
```

## 已知技術債（改到附近時處理，不要順手大改）

- `web/DEPLOY.md` 內容過時（仍教 `FIREBASE_TOKEN`，實際 CI 已改用 `FIREBASE_SERVICE_ACCOUNT`；
  正確流程以 README.md 為準）。
- `detector.js`、`frames.js` 疑似 dead code——查證結論見 docs/ARCHITECTURE.md §技術債。
- 測試基線有已知紅字（`chatListener.test.js`，見鐵律 4）；`chatProcessor.js` 尚無測試檔。
- API keys（`youtubeApiKey` 等）存於公開可讀的 RTDB `/config`——架構上必然
  （overlay 無登入能力），緩解方式見 docs/ARCHITECTURE.md §安全模型。
