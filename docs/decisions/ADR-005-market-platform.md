# ADR-005:市集改為中央 Firebase 平台(Google SSO+帳號審核制)

- 狀態:已採納(2026-07-10,維護者拍板)
- 取代:docs/designs/marketplace.md 的「GitHub registry」路線(該稿保留,PR 投稿流改為
  自架備援選項;已建好的 ../YoliaWatching-packs 骨架保留,market.js 支援兩種 index 格式)
- 設計細節:docs/designs/market-platform.md

## 問題

GitHub PR 投稿對一般創作者門檻太高(要會 fork/PR)。維護者要的體驗:
**創作者上傳 PNG → 網頁上命名、試播 → 發布**,平台有帳號審核把關。

## 決策

建立獨立的中央市集平台(第二個 Firebase 專案,維護者擁有,與各實況主的專案分開):

1. **登入**:Google SSO(Firebase Auth)。
2. **審核制**:新帳號申請後為 `pending`,管理員核准變 `approved` 才能發包;
   **審帳號不審包**(過審後發包/更新免審,問題事後下架)。
3. **管理員**:預設=平台 Firebase 擁有者,可於平台 UI 增減其他管理員。
4. **投稿型態**:PNG spritesheet 直接上傳,平台頁內建切片/命名/試播預覽
   (重用主 repo packFormat.js 的切片與驗證邏輯)。
5. **供檔**:平台 RTDB 直接供檔(公開讀);實況主端市集分頁把 registry URL 指向
   平台的 REST 端點。流量走維護者專案的免費額度
   (【模型知識,未查證】RTDB 下載 10GB/月;一包 0.2–1MB,約萬次安裝/月見頂,
   屆時再議混合 GitHub CDN 供檔)。
6. **零伺服器**:純靜態頁+Auth+RTDB rules 做權限,Spark 免費方案,月費 $0。

## 與 ADR-001 的關係(紅線鬆動的知情決策)

ADR-001 紅線 2「無中央伺服器」在**實況主核心功能**上不變(overlay/panel 照舊
每人自己的 Firebase,市集掛了不影響直播)。市集平台是**附加服務**:仍無自建
伺服器(純 Firebase 託管),但確實是維護者營運的中央點——維運責任(審核、
下架、額度)由維護者知情承擔。逃生口:market.js 的 registry URL 可設定,
任何人可退回 GitHub registry 或自架平台。

## 考慮過的替代方案

| 方案 | 不採納原因 |
|---|---|
| GitHub PR registry(原 marketplace.md) | 對非工程師創作者門檻過高;維護者明確要 SSO+審核+網頁上傳體驗 |
| 各實況主自己的 /submissions 投稿匣 | 只解決「粉絲投給單一實況主」,不解決跨頻道流通;且每個實況主都要開公開寫入 |
| 混合(平台收件+GitHub 供檔) | 多一段同步機制;流量在現階段規模不是瓶頸,簡單優先,見頂再遷移 |
