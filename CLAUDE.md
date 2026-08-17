# YoliaWatching — 給 Claude 的路由檔

直播互動桌寵：觀眾聊天訊息驅動 OBS overlay 上的角色動畫（幽視值 0–100 ＋門檻狀態機＋關鍵詞＋指令）。
單一架構：**Electron 桌面版**（`yuupeek/`）。聊天連線不是桌寵自己接的——由獨立的
**chat-monitor**（`chat-monitor/`，另一個 Node process）監聽 Twitch/YouTube/SOOP，
桌寵透過 WebSocket 當它的唯讀 client（2026-08-16 收斂，見 docs/ARCHITECTURE.md）。
Firebase 雲端版（原 `web/`）已於同次收斂移除，這是內部工具，不以「陌生實況主自架」為目標。
與維護者溝通預設使用繁體中文。

## 動手前先讀（按任務選，通常只需讀 1–2 份）

| 你要做的事 | 必讀 |
|---|---|
| 任何程式改動（一律） | [docs/PLAYBOOK.md](docs/PLAYBOOK.md) — 工作制度、驗證步驟、格式演進規則 |
| 理解系統全貌／資料流／聊天事件怎麼進來 | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| 角色包、動畫格式、spritecook 匯入 | [docs/specs/character-pack-format.md](docs/specs/character-pack-format.md) |
| 動畫編輯器 UI | [docs/designs/animation-editor.md](docs/designs/animation-editor.md) |
| AI 生成素材管線 | [docs/designs/generation-pipeline.md](docs/designs/generation-pipeline.md) |
| 角色市集／角色包上下架 | [docs/designs/marketplace.md](docs/designs/marketplace.md) |
| 「為什麼當初這樣設計」 | docs/decisions/ 下的 ADR（檔名即主題） |
| 接續上一個 session 的工作 | [docs/HANDOFF.md](docs/HANDOFF.md) |

## 鐵律（違反任一條＝這次改動不合格）

1. **格式只加不改**：動畫格式 `{ folder, frames, ms, loop }` 的既有欄位，其語意與型別不可
   變更。只能「新增可選欄位」，且舊版讀到新資料必須仍能運作（規則細節與範例見 PLAYBOOK
   §格式演進）。
2. **互動規則是事件類型導向**：規則格式 `{ id, eventTypes[], matchMode?, match?, minEnergy?,
   energyDelta?, speech?, action? }`（2026-08-16 收斂，取代舊的 keyword/command 二分）。
   `eventTypes` 對齊 chat-monitor 的 `event_type`/`category` 詞彙（見
   `yuupeek/src/chatMonitorEventTypes.js`），可混粗略分類與細項、可複選；不填 `match` 代表
   該類事件一發生就算觸發。門檻（threshold）規則面板目前不開放編輯，但資料與判斷邏輯都還在
   （`computeState`），改動時不要誤刪。
3. **測試必須全綠**：`cd yuupeek && npm test`（2026-08-16 收斂後基線全綠；
   出現任何紅字＝改動不合格，回報中原文貼出錯誤）。
4. **預設動畫單一源頭在 `yuupeek/src/defaultAnimations.js`**：`main.js` 直接引用；
   `character.js` 的內建 fallback 表改用 `frames()` 從呼叫端傳入的 `defaultAnimations`
   選項衍生，不再手抄——兩個 `createCharacter()` 呼叫點（`obs-overlay.html`、`test.html`）
   都要載入 `defaultAnimations.js` 並傳入這個選項。改預設幀序只改一處即可。
5. **文件中的規格數字要標來源**：quota、方案限制、價格等，寫進 docs/ 時必須附
   來源（檔案路徑或 URL）與日期；查不到就明寫「未查證」，不可編造。

## 常用指令

```bash
# 以下每行都從 repo 根目錄起算（不要連續照抄 cd）
cd chat-monitor && npm install   # 首次
cd chat-monitor && npm start     # 聊天監聽（先開這個，桌寵才收得到訊息；http://127.0.0.1:3100）
cd yuupeek && npm install        # 首次
cd yuupeek && npm start          # 桌面版（panel: http://localhost:3000/panel）
cd yuupeek && npm test           # 單元測試（改動完成的必要條件）
cd yuupeek && npm run test-ui    # 角色/動畫沙盒頁 test.html（http://localhost:3001，不需聊天室）
```

## 已知技術債（改到附近時處理，不要順手大改）

- `detector.js` 未接線（藍圖功能，檔頭有註記，勿當活程式碼改）。
- OBS overlay 的 yolia_see 數字/進度條目前隱藏（`display:none`），機制本身照跑，只是不顯示——
  見 `obs-overlay.html` 的 `#hud` 區塊註解。
- 其餘小項見 docs/HANDOFF.md「剩餘已知後續」。
