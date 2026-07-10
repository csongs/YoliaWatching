# 設計:中央市集平台(YoliaWatching-market)

> 狀態:設計稿(2026-07-10,ADR-005 已採納)。落點:獨立 repo `../YoliaWatching-market/`
> +獨立 Firebase 專案(維護者建立)。主 repo 只改 market.js 的 index 相容層。

## 1. RTDB schema(平台專案)

```
/users/<uid>              .read: 本人或 admin   .write: 見規則
├─ email, name            (Google 帳號帶入)
├─ handle                 (創作者代號,包 id 前綴;申請時自選,小寫英數連字號)
├─ status                 "pending" | "approved" | "banned"
└─ role                   "creator" | "admin"

/packs/<packId 的「.」換「_」>   .read: 公開   .write: 見規則
└─ = 完整 .yolia.json + ownerUid + publishedAt/updatedAt

/index/<同上 key>          .read: 公開   .write: 與 /packs 同步寫入
└─ { id, name, author, version, license, description, sizeBytes, ownerUid }
   (市集列表只抓這個小節點,不抓整包;packUrl 由讀取端組 REST URL)
```

rules 要點(全部宣告式,無伺服器):
- `isAdmin = root.child('users/'+auth.uid+'/role').val() === 'admin'`
- /users/$uid 建立:僅本人、status 必為 pending、role 必為 creator(自我申請);
  status/role/handle 變更:僅 admin。
- /packs、/index 寫入:`(本人 approved 且 ownerUid==auth.uid 且 RTDB key 前綴==handle_
  且 id 前綴==handle. 且 author==handle)` 或 admin(key 綁 handle 防佔用他人命名空間,
  2026-07-10 審查修正)。單包 4MB 上限由前端 validatePack 把關——
  **RTDB rules 沒有位元組大小函數,rules 層不驗大小**;approved 帳號屬半信任,濫用即停權。
- 首任 admin:維護者部署後在 Firebase console 手動把自己的 role 設 admin(一次性 bootstrap)。

## 2. 平台頁面(靜態,Hosting)

| 頁 | 登入 | 內容 |
|---|---|---|
| 瀏覽(index.html) | 不用 | /index 卡片列表;點入詳情=拉整包+**試播預覽**(小畫布循環播) |
| 創作者(creator.html) | Google SSO | pending→等待畫面;approved→我的包列表+「上傳新動作」精靈:選 PNG→切片(重用 packFormat.sliceGeometry+workshop 的 canvas 切圖)→命名/ms/loop→**試播**→包資訊→發布(寫 /packs+/index) |
| 管理(admin.html) | admin | 待審帳號(核准/封鎖)、包管理(下架)、admin 增減 |

共用:packFormat.js 副本(驗證/切片/compareVersions 同源)。

## 3. 主 repo 整合(唯一改動)

market.js 的 index 相容層:registry URL 回傳**陣列**(GitHub registry 格式)或
**物件**(平台 /index.json REST 格式)都接受;物件時 `Object.values()` 並以
`<registry 根>/packs/<key>.json` 組 packUrl(index URL 的查詢字串原樣帶上——
emulator 靠 `?ns=` 選庫)。

市集位址欄**貼什麼都盡量接**(2026-07-11 對 emulator 實測,依序嘗試):
1. 含 `/index.json` → 原樣抓(平台首頁底部顯示的 Registry URL;emulator 必走這條)。
2. 資料庫根網址(可帶 `?ns=`)→ 補 `/index.json` 再抓。
3. 平台**網站網址**(如 `https://xxx.web.app`)→ 抓站上部署的 `firebase-config.js`
   挖 `databaseURL`。前提:平台 firebase.json 對該檔開 CORS(已設);
   **hosting emulator 不套用自訂標頭**(firebase-tools issue #3860,查於 2026-07-11),
   此路徑僅正式部署可用。
全部失敗時顯示導引錯誤(教使用者去平台首頁底部抄 Registry URL)。

## 4. 風險

| 風險 | 對策 |
|---|---|
| 惡意/侵權內容過審後上架 | 審帳號制的代價;admin 一鍵下架+封鎖;平台 README 免責 |
| 下載額度見頂(【未查證】10GB/月) | 屆時開 ADR 遷移混合供檔(平台收件+GitHub CDN);index 與包分離已為此鋪路 |
| 首任 admin bootstrap 忘記做 | 部署文件第一步明寫;admin 頁在無 admin 時顯示 bootstrap 指引 |
| rules 寫錯=權限洞 | rules 附單元測試(@firebase/rules-unit-testing)或至少手動測試矩陣文件 |

## 5. 驗收

創作者流:Google 登入→申請→(admin 核准)→上傳 PNG→命名試播→發布→
實況主市集分頁看到→安裝→啟用。管理流:核准/下架/加 admin。
匿名流:瀏覽+詳情試播不需登入。
