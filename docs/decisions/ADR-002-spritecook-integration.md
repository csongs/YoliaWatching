# ADR-002：spritecook 整合——只在匯入層適配，引擎與格式零依賴

- 狀態：已採納（2026-07-07）
- 依賴文件：docs/specs/character-pack-format.md（格式細節）、docs/designs/generation-pipeline.md（prompt 與 API 串接）

## spritecook 是什麼（【事實】，2026-07-07 線上查證）

- 公開網路服務 [spritecook.ai](https://www.spritecook.ai)：AI 像素圖／遊戲素材生成。
  Web App＋REST API（`api.spritecook.ai/v1/api/*`）＋託管 MCP server。**不是本機工具**，
  D:\code 全磁碟與本 repo 皆無相關程式碼（已搜尋確認）。
- 靜態圖：透明背景 PNG，16–512px（預設 64×64）。
- 動畫：對既有 asset 做 image-to-animation。輸出格式 webp（預設）/ gif / **PNG spritesheet**；
  幀數必須是**偶數**（pixel 模式 2–16、detailed 2–24，預設 8）。
- spritesheet 排列＝**單列橫向 strip**：第 i 幀在 `(i × frame_width, 0)`（出處：官方 Godot skill，
  含驗證式 `frame_count × frame_width == spritesheet_width`）。
- metadata（API 回應內，非 sidecar 檔）：`frame_count`、`fps`（僅輸出欄位，官方範例皆 8，
  不可指定）、`frame_width/height`、`animation_mode`。
- **沒有**：逐幀 PNG zip 匯出、獨立 JSON sidecar 檔、loop 欄位。
- 輸出幀尺寸可能**大於**原素材（自動加邊距；官方文件例：512 源 → 640 幀）。
- 一次 API 呼叫產一個動作動畫；多動作＝對同一 asset 多次呼叫。有 credits 計費
  （官方範例一次動畫 credits_used: 20；價格表【未查證】）。
- 未查證項：選 `output_format:"spritesheet"` 時回應欄位結構、Web App 下載按鈕的實際選項、
  API 的瀏覽器 CORS 政策。實作 API 串接前先驗證（見 generation-pipeline.md 階段二）。

## 問題

現有動畫格式 `{folder, frames[], ms, loop}`（逐幀 PNG、repo 內靜態檔）能否直接吃
spritecook 產出？

**結論【事實推導】：不能直接相容，需要轉換層。** 差異三點：
1. 圖的形態：單列 spritesheet vs 逐幀檔案。
2. 圖的位置：外部服務下載 vs repo 內 Hosting 路徑（自訂素材根本沒有上傳點）。
3. 節奏語意：fps（且不可指定）vs 每幀 ms；loop 資訊 spritecook 沒有。

## 決策：轉換發生在「匯入那一刻」，之後系統內只有自家格式

管線：`spritecook spritesheet PNG →（panel 匯入器：切片＋轉 data URL＋補 ms/loop）→
Character Pack v1（.yolia.json）→ RTDB /packs/<id> → overlay setAnimations`。

- 引擎唯一改動＝`setAnimations` 接受 `srcs` 陣列（additive，規格 §4）。
- spritecook 專屬知識只存在兩處：**匯入器的預設猜測**（單列切片、fps→ms）與
  **文件（prompt 範本、操作教學）**。程式核心（packFormat.js、character.js）
  出現「spritecook」字樣即為違規（規格 §10）。

## 考慮過的替代方案

| 方案 | 內容 | 不採納原因（v1） |
|---|---|---|
| 引擎直繪 spritesheet（drawImage 帶 source rect） | 存整張 sheet＋rect 表，省儲存、單次解碼 | 動到 drawFrame 核心路徑，風險大於效益（像素風逐幀 data URL 總量本來就小）；repo 裡 frames.js 正是上一次 spritesheet 嘗試的遺骸。留作 v2 選項：若實測包體過大再開 ADR |
| sheet 存 RTDB、overlay 執行時切片 | 匯入器更薄 | 每次 overlay 啟動都要切片；舊版 overlay 完全無法降級（看不到任何格式它認得的東西）；除錯困難 |
| 幀圖 commit 進使用者 fork（GitHub API）再走 Hosting | 資產進版控、最耐久 | 需要 GitHub token 進 panel＋教學成本；現行市集設計（marketplace.md）不需要它；若未來出現「素材要進版控長期保存」的需求，另開 ADR 評估 |
| 逐幀 data URL 存 RTDB（採納案） | 引擎改動最小、舊版可降級、離線可打包 | — |

## 風險與隔離

| 風險 | 影響 | 隔離手段 |
|---|---|---|
| spritecook 改 sheet 排列/尺寸規則 | 匯入器切錯 | 切片 UI 必顯示切果讓使用者確認＋可手動輸幀寬（規格 §7 步驟 5）；改版只動匯入器 |
| spritecook 停服 | 不能再生成新素材 | 已匯入的包零依賴照常用；匯入來源 B（逐幀圖）/C（現成包）不受影響；生成改走備選供應商（generation-pipeline.md §備選） |
| 只出偶數幀 | 動畫節奏受限 | 編輯器本來就能重排 frames 順序（複製/刪幀），非阻塞 |
| 預設輸出是 webp | 使用者下載錯格式，匯入器不支援 | 教學明寫「下載 PNG spritesheet」；匯入器對非 PNG 給明確錯誤訊息 |
| credits 費用 | 使用者成本 | 使用者自帶帳號自付（與 YouTube API key 同模式，ADR-001 紅線 2） |

## 對現有使用者的部署影響（向後相容檢查）

- 不動任何既有欄位；`/packs` 是新頂層節點（rules 需同步加，PLAYBOOK §3 規則 3）。
- 舊 overlay＋新資料：看不懂 `srcs`/activePackId → 全部靜默忽略 → 行為與升級前一致。
- 新 overlay＋舊資料：無 activePackId → 不啟用 pack → 行為不變。
- Firebase quota【建議，估算】：一個包 ~0.1–1.5 MB；overlay 每次啟動讀一次
  ＋panel 編輯時讀寫。以每天開 OBS 10 次、包 1 MB 計＝10 MB/天 ≈ 300 MB/月，
  在 RTDB 10 GB/月下載額度內（數字為 2026-01 模型知識，上線前複核）。
