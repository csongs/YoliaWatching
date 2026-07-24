# 設計:粉絲投稿動作 → 角色工坊 Phase 1 + 擴充包

> 狀態:設計稿(2026-07-07,維護者已核可設計)。**已實作**(角色工房/擴充包/桌面版
> 支援全部落地,見 ADR-003、ADR-004);本檔保留作為設計理由紀錄,現況以
> docs/ARCHITECTURE.md 為準。
> 格式細節一律以 docs/specs/character-pack-format.md 為準(含 2026-07-07 的 `base` 欄位修訂);
> 決策理由見 ADR-003;工坊 UI 佈局沿用 docs/designs/animation-editor.md,本檔只記**增量**與工單。
> 範例素材:`yuupeek/assets/sprites/sample/00_hurt_sheet.png`(1712×214,單列 8 幀,
> 每幀 214×214,Nano Banana 2 生成)——這就是匯入來源 A 的標準輸入。
> (同名 webp 是動畫預覽,匯入器不收;sample 原先只放在 web/public/assets/ 下,
> 該目錄是 .gitignore 的建置產物,2026-07-07 已複製進源頭目錄納入版控。)

## 1. 使用流程(誰做什麼)

**粉絲端(零系統接觸)**:照「投稿指南」(工單 7)產出素材——單列橫向 PNG spritesheet、
透明背景、每幀近方形、圖寬=幀寬×幀數整除。透過場外管道(Discord/噗浪/信箱)把檔案交給
實況主。【事實】系統沒有、也不該有粉絲上傳入口:RTDB 僅 ADMIN_EMAIL 可寫、無中央伺服器
(ADR-001 紅線)、Hosting 檔案只能經 repo 部署。

**實況主端**:panel 登入 → 「角色工房」分頁 → 匯入精靈選 PNG → 自動切片(猜幀寬=圖高)
+縮圖預覽確認(可手動改幀寬重切)→ 取狀態名(如 `hurt`)、設 ms/loop → 加進「粉絲動作集」
**擴充包**(base:"builtin")→ 儲存 → 啟用。之後到既有「桌寵設定」分頁把指令(如 `!痛`)
綁到 `hurt`。觀眾輸入指令,overlay 的 Yolia 播放粉絲畫的動作。

## 2. 對 animation-editor.md 的增量(擴充包模式)

- 匯入精靈開頭多一個選擇:**「全新角色」或「為內建角色加動作」**(後者=建立/加入
  base:"builtin" 的擴充包,免 idle)。
- 包清單卡片標示包型別(換角包/擴充包)。
- overlay 套用順序:先「內建 DEFAULT_ANIMATIONS + config/animations」打底,擴充包疊上去;
  換角包則走規格 §5 的 idle 映射。停用(activePackId=null)或 pack 讀取失敗 → 回打底狀態
  + console.warn(失敗不壞現狀)。
- 【地雷】panel 互動綁定下拉 STATE_OPTIONS(panel.html 約 L640–664)在 web 模式來自
  `config/animations`,**不含 pack 狀態** → 匯入的 `hurt` 會綁不了指令。修法:載入下拉
  選項時同時讀啟用中 pack 的動畫名合併進去。

## 3. 工單(Phase 1,七件事)

1. `yuupeek/src/packFormat.js` + `__tests__/packFormat.test.js`(新,isomorphic UMD 仿
   chatProcessor.js):validatePack(含 base 規則,規格 §8)、packToAnimations(規格 §5
   兩種包型)、applyDefaultInteractions、切片純函數(整除檢查、座標計算,規格 §7)。
2. character.js `setAnimations` 支援 `srcs`(規格 §4,<10 行,舊 folder 路徑一字不動)
   + character.test.js 補案例。
3. `web/database.rules.json` 加 `/packs`(讀公開、寫 admin,同 config;PLAYBOOK §3 規則 3)。
4. `web/public/index.html`:config 訂閱內處理 activePackId 變更 → `once('value')` 讀
   `/packs/<key>` → packToAnimations → setAnimations(套用順序見 §2)。
5. panel.html 角色工房分頁(佈局照 animation-editor.md §1–§3 + 本檔 §2 增量):包清單、
   動畫清單、匯入精靈(來源 A/B/C)、幀編輯器(預覽播放+左移/右移/複製/刪除、顯式儲存鈕);
   web DataAdapter 加 getPacks/savePack/deletePack/setActivePack;桌面模式顯示
   「此功能目前僅雲端版支援」(IS_WEB,優雅降級);STATE_OPTIONS 合併 pack 狀態(§2 地雷)。
6. `web/sync.js`:packFormat.js 若以 `<script src>` 載入則加入 FILES 清單。
7. 文件:新增粉絲投稿指南(格式要求+以 sample 圖為範例;README 連結);實作後更新
   ARCHITECTURE.md 對應小節與 HANDOFF.md(PLAYBOOK §1)。

## 4. 錯誤處理與相容性

- 舊 overlay 不讀 /packs、無視 activePackId → 行為與升級前一致(規格 §4 已論證)。
- 刪包時若互動仍綁著包內狀態名 → 引擎查無動畫維持現行「未知狀態」行為(不炸);
  UI 刪包前提示「有 N 個互動綁定此包的動畫」。
- 驗證錯誤=繁中人話進 toast;RTDB 寫入失敗顯示 Firebase 錯誤原文(animation-editor.md §6)。
- 包大小照規格上限 4 MB:214px 幀約 20–25 KB/幀(base64),一動作 8 幀 ≈200 KB,
  擴充包容納十幾個粉絲動作仍寬裕。

## 5. 驗證(PLAYBOOK §1/§2)

- `cd yuupeek && npm test`:packFormat 新 suite(base 規則、idle 映射、切片純函數、
  驗證通過/失敗案例)+ character 補 srcs 案例;不得新增基線外紅字(chatListener 紅字是
  既有基線)。
- `npm run test-ui` 沙盒:頁面載入、內建動畫照常(沙盒讀不到 pack,只驗 character.js 不退步)。
- 手動端到端(部署後):匯入 00_hurt_sheet.png → 建擴充包 → 啟用 → overlay console
  `onMessage('!痛','測試員')` 播 hurt;停用 → 回內建;舊資料庫(無 /packs)→ 一切照舊。
