# 設計：素材生成管線（spritecook prompt → 一鍵生成）

> 狀態：設計稿（2026-07-07）。階段一（prompt 指南）寫完即可用；階段二（平台內生成）
> 動工前有一個必做的 CORS 驗證步驟。格式一律走 docs/specs/character-pack-format.md 的匯入器。

## 階段一：給使用者的 spritecook 操作指南＋prompt 範本（零開發，文件即產品）

落點【建議】：內容放進 README.md 新章節「自製角色」或 panel 角色工房分頁的說明連結。
以下範本可直接複製使用。

### 操作流程（spritecook.ai Web 版）

1. 先生成**一張靜態角色**（這是後續所有動畫的母體，成敗在這一步）：
   - 尺寸選 64×64 或 128×128（【事實】支援 16–512px，預設 64×64）
   - 背景選透明（預設即是）
2. 對同一個角色 asset 逐一生成各動作動畫（一次一個動作）：
   - 幀數必須是偶數（pixel 模式 2–16）；建議統一 8 幀
   - 輸出格式**務必選 PNG spritesheet**（預設 webp，匯入器不收）
3. 記下每個動畫的幀寬（或直接讓匯入器自動猜）→ 到控制面板「角色工房」匯入（來源 A）。

### prompt 範本（英文對模型效果較穩；【】內自行替換）

母體角色（靜態）：
```
【chibi ghost girl】 mascot character, full body, facing left,
standing pose, simple flat colors, clean silhouette,
transparent background, pixel art
```
要點：`facing left` 對應本專案角色慣例（內建 Yolia 靠畫面右緣、臉朝左）；
`full body`＋`clean silhouette` 避免裁切與碎邊。

各動作（image-to-animation，對母體 asset 逐一執行）：

| 目標狀態 | motion prompt | 建議幀數 | loop |
|---|---|---|---|
| idle | subtle breathing idle animation, gentle bobbing | 8 | ✓ |
| wave | waving one hand greeting | 8 | ✗ |
| cheer | jumping cheer with sparkles, excited | 8 | ✗ |
| cry | crying, tears, drooping posture | 8 | ✗ |
| eat | eating snack, chewing happily | 8 | ✗ |
| jump | single hop jump | 6 | ✗ |
| run_left | running to the left | 8 | ✓ |
| run_right | running to the right | 8 | ✓ |
| peek | leaning forward, peeking curiously | 8 | ✗ |

注意（易錯）：
- run_left/run_right 的命名＝**畫面上的移動方向**（run_left 播放時角色向畫面左移；
  character.js applyUpdate 的 RUN_SHIFT 邏輯，引擎不做鏡像翻轉）。上表 prompt 與此同視角。
  生成後在匯入器預覽確認方向，反了就把兩個狀態名對調，或用水平翻轉。
- 只生成一個 run 方向也行：匯入時複製動畫＋水平翻轉得到另一方向
  （翻轉為匯入器建議功能，canvas scale(-1,1)，未實作前就生成兩個方向）。
- 狀態可以不齊：缺的狀態自動回退到該包的 idle（規格 §5），先求有再求全。

### 成本【事實＋未查證】

官方 API 範例顯示一次動畫 credits_used: 20；價格表與免費額度**未查證**，
使用者自行到 spritecook.ai 確認。10 個動作 ≈ 200 credits。

## 階段二：平台內一鍵生成（panel 直接呼叫 spritecook API）

### 動工前的必做驗證（spike，做完才准往下）

【未查證】兩件事，同一個 spike 一起驗：
1. spritecook API 是否允許瀏覽器跨域呼叫（CORS）。驗證法：在任意頁面 console 以 fetch 打
   `POST https://api.spritecook.ai/v1/api/generate-sync`（帶測試 key），看是否被 CORS 擋。
2. `output_format:"spritesheet"` 時回應的實際欄位結構（`spritesheet_url`、metadata 是否如
   ADR-002 記載）——下方一鍵流程步驟 4 依賴它們，ADR-002 已把此項列為未查證。
- 允許 → 走「panel 直連」設計（下述）。
- 不允許 → **不要架代理伺服器**（違反 ADR-001 紅線 2）。退回「半自動」：panel 生成
  prompt＋一鍵複製＋開新分頁到 spritecook，使用者下載後拖回匯入器。半自動版本
  無論如何都先做——它是 CORS 被擋時的最終形態，也是直連版的 UI 基礎。

### 金鑰處理（安全設計，與現有慣例刻意不同）

【事實】RTDB `/config` 全世界可讀，youtubeApiKey 存那裡是因為 **overlay** 需要它。
生成用的 spritecook API key 只有 **panel**（登入後才開）用得到，overlay 用不到。
→ 【規則】spritecook key 存 `localStorage`（panel 網域下），**禁止寫入 RTDB**。
換瀏覽器要重填，UI 註明即可。任何 PR 把生成金鑰寫進 RTDB＝違規。

### 一鍵流程（UI 在角色工房分頁加「AI 生成」按鈕）

1. 表單:角色描述（自由文字）＋風格預設（下拉:pixel / detailed）＋要生成的動作勾選
   （§階段一表格為預設全勾）。
2. 呼叫 generate-sync 產母體 → 顯示結果，使用者「滿意/重生成」（每次重生成都花 credits，
   UI 要顯示預估 credits）。
3. 滿意後逐動作呼叫 animate-sync（`output_format:"spritesheet"`）→ 進度列（一次一個，
   失敗可單獨重試）。
4. 每個回應含 `spritesheet_url` 與 metadata（frame_count/frame_width/height/fps）→
   fetch 圖檔 → 直接餵規格 §7 切片器（幀寬用 metadata，不用猜）→ 組 pack → 存 `/packs`。
5. 全程不落地任何中間檔；`source` 欄位記 tool/prompt/assetIds 以便重生成。

### 備選供應商（spritecook 停服或不合用時的替換池）

【模型知識，截至 2026-01，串接前一律重新查證】

| 服務 | 定位 | 換用成本 |
|---|---|---|
| PixelLab（pixellab.ai） | 像素角色動畫生成 API（有骨架/動作概念） | 改階段二的 API 呼叫層；輸出若非單列 strip 要調切片參數 |
| Retro Diffusion | 像素風生成 API | 同上 |
| 通用圖像模型（gpt-image-1 / Imagen / SDXL+pixel LoRA，經 Replicate/fal.ai） | 品質高但**多幀一致性不保證**，需以 grid prompt＋事後手工裁切 | 大：等於回到手動匯入；只當最後備援 |

隔離已由格式規格 §10 保證：換供應商只改「AI 生成」按鈕背後的呼叫層與預設參數，
匯入器與格式零改動。

## 驗收與風險（按審查範本）

- 可行性：階段一＝純文件；階段二＝panel 內 fetch＋現成切片器，無新依賴。動到的檔案：
  panel.html（角色工房分頁內加區塊）、可能新增 `web/public/genPipeline.js`（或併入 editor 模組）。
- 依賴風險：spritecook 改版/停服 → 階段一換 prompt 文案、階段二換供應商；已匯入資產不受影響。
- 部署影響：無 schema 變更（pack 流程已由編輯器設計涵蓋）；純新增 UI。
- Firebase 限制：生成流量不經 Firebase（browser ↔ spritecook 直連）；儲存同 pack 評估
 （ADR-002 末節）。
- 誠實條款：品質是品味題——生成結果好不好看，AI 不能替使用者拍板；UI 一律「預覽→
  使用者決定採用/重生成」，絕不自動採用。
