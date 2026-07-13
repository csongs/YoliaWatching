# 設計：角色市集（含授權與計費評估）

> 狀態：設計稿（2026-07-07）。前置依賴：character-pack-format.md（.yolia.json 就是流通單位）、
> animation-editor.md Phase 2 的「匯出」。本檔含大量【建議】，動工前逐段確認仍成立。

## 0. 核心架構判斷

市集是本專案唯一需要「中央」的功能。但【建議→採納】**不建中央伺服器**（ADR-001 紅線 2），
用「GitHub repo 當註冊中心＋CDN 供檔」達成：

```
創作者 ──(PR: 上傳 .yolia.json)──▶ GitHub repo「YoliaWatching-packs」（待建立）
                                        │ CI 驗證＋生成 index.json
使用者 panel「市集」分頁 ◀──(fetch index.json / pack 檔)── jsDelivr CDN（免費、有快取）
        │ 安裝 = validatePack → 寫進自己的 RTDB /packs → 一鍵啟用
        ▼
   自己的 overlay（與市集零耦合：安裝後即使 registry 消失，角色照常用）
```

為什麼這樣對【建議】：
- 零成本、零維運：沒有伺服器、沒有資料庫、沒有 quota 池被搶（ADR-001 的「每人一份」性質不變）。
- 審核＝PR review：品質與安全把關落在 GitHub 的現成流程上，維護者一人可運轉。
- 與使用者技能同構：這個產品的使用者本來就會 fork repo、按 GitHub 按鈕。
- 可逃生：registry 只是靜態檔案倉庫，任何人可 fork 鏡像，沒有綁架風險。

## 1. Registry repo 規格（YoliaWatching-packs，待建立）

```
packs/<pack-id>/
    pack.yolia.json      ← 最新版全量檔（history 靠 git）
    preview.png          ← CI 從 pack 的 preview 欄位抽出（列表頁用，避免載整包）
index.json               ← CI 生成：[{ id, name, author, version, license, sizeBytes,
                                       description, previewUrl, packUrl }]
README.md                ← 投稿規則＋角色圖鑑（CI 生成表格）
.github/workflows/validate.yml ← PR 時跑（下述驗證）；merge 到 main 時重建 index.json
```

CI 驗證（PR 必過，全部可用 node 腳本＋packFormat.js 實作——**與主 repo 共用同一份
validatePack**，複製過去或以 submodule 引用，實作時擇一並在該 repo README 註明）：
1. validatePack 全過（結構、尺寸上限、狀態名規則）。
2. **自足性**：所有 `srcs` 與 `preview` 必須是 `data:image/` URL——**禁止 https 外連**。
   理由：外連圖會在直播中途因外站掛掉而破圖，且可被用來追蹤使用者 IP。
   （注意：這條比主 repo 的 validatePack 嚴——格式規格允許 https，市集不允許。）
3. `license` ∈ 允許清單（CC0-1.0 / CC-BY-4.0 / CC-BY-NC-4.0；清單可擴充）。
4. id 前綴＝投稿者 GitHub username（`<username>.<pack-name>`），防止佔用他人名。
   比對前先把 username 轉小寫（GitHub username 可含大寫，pack id regex 只允許小寫）。
5. 同 id 再投稿視為更新：version 必須遞增（semver 比較）。

供檔 URL【事實：jsDelivr 對公開 GitHub repo 免費代理】：
`https://cdn.jsdelivr.net/gh/<owner>/YoliaWatching-packs@main/packs/<id>/pack.yolia.json`
（jsDelivr 有檔案大小上限，模型記憶約 20 MB／檔【未查證】，pack 上限 4 MB 之下無虞；
 保底方案 raw.githubusercontent.com 直連。）

## 2. Panel「市集」分頁（主 repo 的實作）

1. 開分頁 → fetch index.json（加 `?t=時間戳` 破快取或接受 jsDelivr ~12h 快取延遲，擇一並註明）。
2. 卡片列表：preview.png＋名稱/作者/授權/大小；點入看描述與動畫清單。
3. 「安裝」→ fetch pack → **本地再跑一次 validatePack**（不信任 registry，防線在自己端）
   → 寫 `/packs/<key>` → 詢問是否啟用。
4. 「更新」：比較已安裝 version 與 index 的 version。
5. 分享自己的角色：「匯出 .yolia.json」＋連結到 registry 的投稿教學（開 PR）。
   v1 不做 in-panel 上傳（需要 GitHub token，成本高）；投稿量大再考慮 issue-form 半自動化。

離線／中國區網路等 fetch 失敗情境：顯示「無法連線市集」，**不影響**已安裝角色與其餘功能。

## 3. 授權與計費（deliverable 8 的誠實評估）

### 技術現實（先講死，避免未來自欺）

【事實】overlay 是純前端：任何已安裝的角色包都躺在使用者自己的 RTDB（公開可讀節點）
與瀏覽器記憶體裡。**「防拷」在此架構下不存在**。付費角色的任何方案都是「信任制＋
法律授權」，不是技術 DRM。要真 DRM 就要中央伺服器簽發、限時 URL、綁定驗證——
違反 ADR-001 全部三條紅線，且一人維護撐不起客服與金流糾紛。

### 分階段建議

| 階段 | 內容 | 需要的 infra | 判定 |
|---|---|---|---|
| P1 免費市集 | 上述 registry；授權限 CC 系 | GitHub（零成本） | ✅ 做 |
| P2 付費＝外部商店 | 創作者到 Booth / Gumroad / itch.io 賣 .yolia.json 檔；買家用「匯入來源 C」安裝；registry 可放「付費區」條目（只列連結與預覽，不放檔案） | 零（金流由外部平台負責，抽成也歸它們） | ✅ 市集有人氣後做，僅文件與 index 欄位小改 |
| P3 平台內金流 | Stripe＋中央服務＋授權簽發 | Blaze＋Functions＋客服＋稅務 | ❌ 明確不做，除非專案性質改變（多人團隊／公司化）。屆時開新 ADR，先讀本節技術現實 |

### AI 生成素材的授權地雷【未查證，發佈前必查】

spritecook（或任何生成服務）的 ToS 對「生成物的所有權、再散布、商用」的規定尚未查證。
Registry 投稿規則必須含：「投稿者自行保證擁有散布權」；維護者在 README 掛免責聲明。
在查證 spritecook ToS 前，**不要**在官方文件鼓勵「用 spritecook 生成後上架市集」的組合。

## 4. 對主 repo 的改動清單（實作時的邊界）

- panel.html：市集分頁（fetch＋卡片＋安裝流程）。
- packFormat.js：無改動（validatePack 直接複用）——市集不引入新格式邏輯。
- RTDB：無 schema 變更（安裝寫的還是 /packs，編輯器 Phase 1 已建立）。
- database.rules.json：無變更。
- registry repo：全新獨立 repo，**不放在主 repo 內**（主 repo 是每個使用者 fork 的東西，
  塞角色檔會讓所有 fork 變肥）。

## 5. Firebase／規模極限（按審查範本）

- 中央端：GitHub/jsDelivr 承擔全部流量，Firebase 零涉入。Spark 不需升級（呼應 ADR-001）。
- 使用者端：裝 N 個包＝N×(0.1–1.5MB) RTDB 儲存；1GB 上限下數百個包，實務不會碰到。
- registry 規模極限【建議估算】：純靜態方案撐到「數百個包、數千使用者」沒有問題；
  瓶頸會先出現在 PR 審核人力，屆時再談自動化審核或治理，不是技術問題。

## 6. 風險表

| 風險 | 對策 |
|---|---|
| registry 被投稿惡意內容（誤導性 pack、令人反感的圖） | PR 人工審核＋CI 硬驗證（自足性、尺寸）；pack 是純資料（PNG data URL），無腳本執行面 |
| jsDelivr 快取延遲（新包上架後最長 ~12h 才可見） | 接受（上架不是即時性需求），或 index 用 raw.githubusercontent 直連 |
| 名稱蟑螂／冒名 | id 前綴強制＝GitHub username（CI 驗 PR 作者） |
| 維護者審核過載 | 這是「成功的煩惱」；到時開 ADR 談治理，勿預先過度設計 |
