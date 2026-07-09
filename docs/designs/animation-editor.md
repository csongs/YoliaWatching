# 設計：角色工房（動畫編輯＋指令綁定）

> 狀態：設計稿（2026-07-07），尚未實作。資料格式一律以 docs/specs/character-pack-format.md 為準；
> 本檔只設計 UI 流程與實作切分。實作前讀 PLAYBOOK §3、§8C。
> 增補（2026-07-07）：擴充包（base:"builtin"，粉絲幫內建角色加動作）的 UI 增量與 Phase 1
> 工單修訂見 docs/designs/fan-extension-pack.md（以該檔為準）＋ ADR-003。

## 0. 範圍決策

- 【建議→採納】做成 **panel.html 的新分頁「角色工房」**（沿用登入、DataAdapter、toast），
  不開獨立頁面（理由見 ADR-001 決策 3）。
- v1 **僅支援 web 模式**：桌面模式下分頁顯示「此功能目前僅雲端版支援」。
  （panel.html 是共用檔，桌面模式必須優雅降級，不可報錯。判斷用現有的 `IS_WEB` 旗標。）
  → 2026-07-10 起桌面版亦支援（ADR-004），降級提示已移除。
- 邏輯全部放模組（packFormat.js 等），panel 內嵌 script 只做 DOM 接線——這是 ADR-001
  留的「未來可拆」退路，也是可測試性的前提。

## 1. 分頁資訊架構（四個區塊，由上而下）

```
┌ 角色工房 ────────────────────────────────────────────┐
│ ① 我的角色包                                          │
│    [內建 Yolia]（不可刪，啟用=activePackId 設 null）    │
│    [包A 預覽圖] 幽靈小妹 v1.0.0 by xxx   (●啟用)(匯出)(刪除) │
│    ＋匯入角色包 ▾（spritesheet / 逐幀圖檔 / .yolia.json）│
│ ② 動畫清單（選中某包時出現）                            │
│    idle    8幀 125ms 循環   (編輯)(刪除)                │
│    attack  6幀 125ms 單次   (編輯)(刪除)                │
│    ＋新增動畫（同樣三種來源）                            │
│ ③ 幀編輯器（選中某動畫時出現）                          │
│    [預覽畫布 ▶ 循環播放中]  速度 ms[125] 循環[✓]        │
│    幀序列：[0][1][2][3][4][5]  ← 點選幀後：             │
│    (左移)(右移)(複製)(刪除)                             │
│ ④ 建議綁定（包內含 defaultInteractions 時出現）          │
│    [✓] 指令 !attack → attack   [ ] 關鍵詞 好可愛 → happy │
│    (套用勾選項) → 寫入 config.interactions，之後到       │
│    「桌寵設定」分頁管理（不重造第二套互動編輯器）          │
└───────────────────────────────────────────────────────┘
```

設計原則：**互動（triggers）的編輯繼續住在既有「桌寵設定」分頁**，角色工房只做
「把包的建議綁定灌進去」的一次性動作。兩套 UI 編同一份 `config.interactions` 會造成
競寫與心智混亂——不做。

## 2. 匯入精靈（來源 A：spritesheet，最常用路徑）

1. 選檔（input type=file，accept="image/png"）。非 PNG → 明確錯誤：「請下載 PNG spritesheet
   （spritecook 預設給 webp，要選 spritesheet 格式）」。
2. 自動猜幀寬 = 圖高（規格 §7）→ 立即顯示切片結果縮圖列。
3. 「切得不對？」→ 幀寬輸入框，改了即重切重繪。整除檢查失敗顯示：
   「圖寬 W 不能被幀寬 F 整除，請確認幀寬」。
4. 指定狀態名：下拉選單（引擎已知狀態＋自訂輸入），預設依序建議 idle → wave → cheer…
5. ms 預設：來源 A（spritesheet）125（spritecook 慣例 fps 8）、來源 B（逐幀圖）150
   （引擎預設）——與規格 §7 一致；loop 預設依名稱慣例（規格 §7）。
6. 「加入包」→ 進 ②清單；重複 1–6 加更多動畫；最後「儲存包」→ 填 manifest
   （名稱/作者/授權下拉：CC0 / CC-BY-4.0 / 自訂）→ validatePack → 寫 `/packs/<key>`。
7. 詢問「立即啟用？」→ 是則寫 `config.activePackId`。

來源 B（逐幀圖）：多選檔案，按檔名自然排序 → 步驟 4 起相同。
來源 C（.yolia.json）：讀檔 → validatePack → 顯示摘要（名稱/動畫數/總大小/授權）→ 入庫。

## 3. 幀編輯器的實作要點

- 預覽：**不要**實例化 createCharacter（它綁定位移/HUD/wander 整套行為）。
  用獨立小畫布：`setInterval(() => drawImage(frames[i++ % n]), ms)`，約 20 行。
- 幀序列操作只有四個：左移/右移/複製/刪除（v1 不做拖拽排序——複雜度不值）。
  操作對象是 `srcs` 陣列本身（data URL 重複引用同字串即可，無額外成本——JS 字串共享）。
- 「另存頻率變體」不做：規格的 frames 陣列本來就允許重複索引表達節奏，
  data URL 模式下直接複製幀達成同效果。
- 儲存策略：**顯式儲存按鈕**（不沿用桌寵設定的 800ms auto-save debounce）。
  理由：pack 是大物件（可到 MB 級），auto-save 會頻繁整包寫 RTDB 又觸發 overlay 重載。
  未儲存離開 → confirm 提示。

## 4. 觸發器充分性分析（門檻/關鍵詞/指令夠嗎？）

【事實】既有 trigger 綁動畫的方式：keyword/command 用 `animation` 欄位、threshold 用
`state` 欄位（欄位名不同！），值都是狀態名；panel 下拉自動列出 getAnimations 的 keys。

【結論／建議】聊天驅動的場景三種已足夠，**不需要為角色包發明第四種聊天觸發**。
但有兩個真實缺口，屬「非聊天觸發」：

| 缺口 | 是什麼 | 建議 |
|---|---|---|
| 手動觸發 | 主播自己在 panel 按按鈕播動畫（soundboard 式；也是「在真 overlay 上驗證動畫」的工具） | **採納為第四種觸發，phase 2 實作**。機制：新頂層節點 `/events = { manualPlay: { animation, nonce } }`，overlay 訂閱 `/events`，nonce 變了就播一次（animOnly）。rules：read 公開、write 同 admin。不放 `/config`（它是事件不是設定，且 config 訂閱會整包重推）。panel 在角色工房加一排「試播」按鈕 |
| 定時/隨機閒置變體 | 同一狀態多組動畫加權隨機（greetingAnimations 已是 wave 專屬版） | 不做第四種 trigger。未來做法是把 greetingAnimations 一般化成動畫的 optional `variants` 欄位（additive），另開 ADR。v1 不做 |

追蹤/訂閱等平台事件（follow、sub、raid）需要各平台 EventSub/Webhook 與 token，
超出「聊天訊息」架構，明確列為**不在此設計範圍**；若未來要做，先寫 ADR 評估。

## 5. 實作切分（給執行 session 的工單）

Phase 1——編輯器 MVP（可獨立交付，估 M～L）：
1. `yuupeek/src/packFormat.js` ＋ `packFormat.test.js`（規格 §8、§5、§9；純函數先行）
2. `character.js` 的 `setAnimations` 支援 `srcs`（規格 §4；改動 <10 行）＋ character.test.js 補案例
3. `web/database.rules.json` 加 `/packs`（讀公開/寫 admin）
4. `web/public/index.html`：config 訂閱內處理 `activePackId` 變更 → once 讀 pack →
   `packToAnimations` → setAnimations；pack 讀取失敗 → console.warn ＋維持現狀
5. panel.html 新分頁（§1–§3 的 UI）；web DataAdapter 加 `getPacks/savePack/deletePack/setActivePack`
6. `web/sync.js`：若 packFormat.js 以 `<script src>` 載入，加入 FILES 清單
7. 驗證（PLAYBOOK §2）：npm test 全綠；test-ui 沙盒不受影響；手動流程——匯入一張
   spritesheet → 啟用 → overlay 換角色；停用 → 回內建 Yolia；舊資料庫（無 packs 節點）→ 一切照舊

Phase 2（各自獨立小工單）：
- 手動觸發 `/events`（§4）＋試播按鈕
- defaultInteractions 套用 UI（§1 ④；packFormat.js 的 applyDefaultInteractions 已在 Phase 1 寫好）
- 匯出 .yolia.json（Blob 下載，市集的前置）
- 桌面版支援評估（pack 存 %APPDATA%？obsServer 加 routes？先寫 ADR 再動）
  → 已評估採納：ADR-004（2026-07-10，packs.json＋obsServer routes＋getAnimations 合併廣播）

## 6. 風險與相容性（按審查範本）

- 向後相容：全部 additive（§5 步驟 4 的「失敗維持現狀」是關鍵護欄）。舊 overlay 遇到
  新資料的降級路徑已在規格 §4 論證。
- panel.html 膨脹風險：分頁的 script 若超過 ~300 行，抽成 `editor-ui.js` 並經 sync.js 同步。
- RTDB 寫入大小：pack 上限 4 MB（規格 §2）；儲存失敗要把 Firebase 錯誤訊息原文顯示給使用者。
- 先例參考：repo 內有 `tools/frame-preview.html`（幀預覽原型）。它**在版控內**
 （Initial commit 即追蹤；.gitignore 的 `tools/` 規則對已追蹤檔無效），實作前可直接參考。
