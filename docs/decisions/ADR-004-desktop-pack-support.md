# ADR-004:桌面版角色工房——pack 存本機 packs.json,經 obsServer 廣播

- 狀態:已採納(2026-07-10,維護者核可)
- 依賴文件:docs/specs/character-pack-format.md(格式)、ADR-003(擴充包)、
  docs/designs/animation-editor.md §5 Phase 2(本 ADR 即該條「桌面版支援評估」的結論)

## 問題

角色工坊 v1 僅雲端版支援(animation-editor.md §0),導致**本機沒有任何零依賴的路
可以測試角色包功能**——雲端版的後端就是 Firebase(ADR-001),本機測必然要
emulator(需 Java)或連正式專案。維護者需要 `npm start` 就能完整測匯入→啟用→播放。

## 決策

桌面版完整支援角色工房,資料與傳輸全走既有桌面機制:

1. **儲存**:packs 整包存 `<userDataDir>/packs.json`(仿 animations.json 模式;
   dev 模式 userDataDir=yuupeek/,該檔加入 .gitignore)。`activePackId` 存
   config.json 頂層欄位(語意對應雲端 RTDB 的 `config/activePackId`)。
2. **API**:obsServer 加 5 條 route(`/panel/api/packs` GET/POST、
   `/panel/api/packs/delete` POST、`/panel/api/active-pack` GET/POST),
   panel 桌面 DataAdapter 的 5 個 stub 換成 fetch 實作。介面簽名與 web adapter
   完全一致,workshop.js **零修改**。
3. **套用**:main.js 用 `PackFormat.packToAnimations`(UMD,Node 可 require)
   合併「DEFAULT + userAnimations + 啟用中包」;`getAnimations()` 回傳合併結果
   (同時餵 panel 下拉與 `/commands.json`,新開 overlay 自動拿到);啟用/停用/
   存包時廣播 `setAnimations`,追蹤上一包的狀態鍵、以 `null` 值清除殘留
   (引擎 null-delete 已於 2026-07-09 支援)。
4. **panel.html**:桌面 init 分支 loadScript `/src/packFormat.js` 與
   `/renderer/workshop.js`(obsServer 既有靜態檔案服務直接可供,零新增服務邏輯);
   移除「僅雲端版支援」降級提示。

## 考慮過的替代方案

| 方案 | 不採納原因 |
|---|---|
| 不做 pack 實體,匯入時把 srcs 動畫直接寫進 animations.json | 失去包的管理單位(啟用/停用/刪除整包)、與格式規格脫節、雲端/桌面行為分歧 |
| 桌面版也連 Firebase(共用 web adapter) | 桌面版要塞 Firebase 設定+登入,違反本機零依賴定位;測試仍離不開雲端 |
| Firebase Emulator 接線 | 需要 Java 依賴+程式碼加 emulator 偵測;只解決「測試」不解決「桌面版功能缺口」 |

## 相容性

全部 additive:無 packs.json=行為與現在相同;雲端版程式碼零改動;
config.json 新欄位 `activePackId` 為 optional,舊版桌面程式讀到會靜默忽略
(PLAYBOOK §3 規則 2/4)。附帶效益:桌面版成為雲端版部署前的驗證替身
(workshop.js/packFormat.js/character.js 全共用)。
