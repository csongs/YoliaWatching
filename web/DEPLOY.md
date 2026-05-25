# YuuPeek Web 部署步驟

## 前置條件
- Node.js 已安裝
- 擁有 Google 帳號

---

## 步驟一：建立 Firebase 專案

1. 開啟 https://console.firebase.google.com
2. 點「新增專案」→ 輸入名稱 → 建立
3. 左側 → **Realtime Database** → 建立資料庫 → 選「以測試模式啟動」
4. 左側 → **專案設定（齒輪）** → 「你的應用程式」→ 點 `</>` 新增 Web 應用程式
5. 複製出現的 `firebaseConfig` 物件，備用

---

## 步驟二：填入設定檔

```bash
cp web/public/firebase-config.example.js web/public/firebase-config.js
```

開啟 `web/public/firebase-config.js`，把步驟一的內容填進去。

---

## 步驟三：安裝 Firebase CLI

```bash
npm install -g firebase-tools
firebase login
```

---

## 步驟四：連結專案

```bash
cd e:\code\YoliaWatching\web
firebase use yolia-watching
```

---

## 步驟五：部署

```bash
firebase deploy --only hosting,database
```

部署時 `sync.js` 會自動同步：
- `character.js`
- `assets/sprites/**`

---

## 步驟六：設定 Electron 同步到 Firebase

取得資料庫密碼：
Firebase Console → 專案設定 → 服務帳戶 → 資料庫密碼 → 顯示

在 Electron 的 `.env` 加入：

```
FIREBASE_DB_URL=https://your-project-default-rtdb.firebaseio.com
FIREBASE_DB_SECRET=你的資料庫密碼
```

---

## 步驟七：OBS 設定

新增 Browser Source：
- URL：`https://your-project.web.app`
- 寬度：`1920`、高度：`1080`

---

## 資料流

```
Electron（本機執行）
  → 監聽 Twitch / YouTube 聊天
  → WebSocket    → OBS 本地（localhost:3000）
  → Firebase DB  → OBS 雲端（your-project.web.app）
```
