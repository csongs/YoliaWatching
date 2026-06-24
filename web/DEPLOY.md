# YoliaWatching Web 部署說明

## 方法 A：GitHub Fork（推薦，自動部署）

Push 到 main 就自動部署，不需要在本機安裝任何工具。

### 步驟一：Fork 專案

前往 GitHub → 點右上角 **Fork**

---

### 步驟二：建立 Firebase 專案

1. 開啟 https://console.firebase.google.com
2. 點「新增專案」→ 輸入名稱 → 建立（可關閉 GA）
3. 左側 → **Realtime Database** → 建立資料庫 → 選「以測試模式啟動」
4. 左側 → **專案設定（齒輪）** → 滾到「你的應用程式」→ 點 `</>` 新增 Web 應用程式
5. 記下出現的 `firebaseConfig` 物件內容

---

### 步驟三：取得 Firebase Token

在本機（或任何有 Node.js 的機器）執行一次：

```bash
npx firebase-tools login:ci
```

複製輸出的 token（格式：`1//0xxx...`）

---

### 步驟四：設定 GitHub Secrets

在你 Fork 的 repo → **Settings → Secrets and variables → Actions → New repository secret**

| Secret 名稱 | 從哪裡取得 |
|---|---|
| `FIREBASE_PROJECT_ID` | Firebase 專案設定 → 專案 ID |
| `FIREBASE_API_KEY` | firebaseConfig → `apiKey` |
| `FIREBASE_MESSAGING_SENDER_ID` | firebaseConfig → `messagingSenderId` |
| `FIREBASE_APP_ID` | firebaseConfig → `appId` |
| `FIREBASE_TOKEN` | 步驟三取得的 token |

> `authDomain`、`databaseURL`、`storageBucket` 會從 `FIREBASE_PROJECT_ID` 自動推導，不需要填。

---

### 步驟五：觸發部署

對 repo 做任何 commit push 到 main，或是到 **Actions → Deploy to Firebase → Run workflow**。

部署成功後，你的 URL 是：`https://YOUR_PROJECT_ID.web.app`

---

### 步驟六：設定 OBS

新增 Browser Source：
- URL：`https://YOUR_PROJECT_ID.web.app`
- 寬度：`1920`、高度：`1080`
- Custom CSS：`body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }`

---

### 步驟七：設定頻道

打開 `https://YOUR_PROJECT_ID.web.app/panel`：
- 設定 → 填入 Twitch 頻道名稱、YouTube 頻道、API Key
- 設定完成後 OBS 畫面會自動套用

---

## 方法 B：本機手動部署

需要 Node.js 與 Firebase CLI。

```bash
# 安裝 Firebase CLI
npm install -g firebase-tools
firebase login

# 填入設定
cp web/public/firebase-config.example.js web/public/firebase-config.js
# 編輯 firebase-config.js，填入你的 Firebase 設定

# 部署
cd web
firebase deploy --only hosting,database --project YOUR_PROJECT_ID
```

---

## 資料流

```
OBS Browser Source（https://your-project.web.app）
  ├── 從 Firebase RTDB 讀取 config（頻道名、API Key、互動設定）
  ├── 直接連線 Twitch IRC（WebSocket）
  ├── 直接輪詢 YouTube Data API
  └── 處理聊天訊息、渲染角色

Firebase Realtime Database /config
  ├── 由 panel 頁面寫入
  └── 由 OBS overlay 即時讀取
```

不需要安裝 Electron，OBS overlay 本身就是聊天室監聽器。
