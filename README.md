# YoliaWatching

Twitch / YouTube 聊天室互動桌寵，透過 OBS Browser Source 顯示在直播畫面上。  
觀眾在聊天室輸入指令或關鍵詞，角色會做出對應動畫反應。

---

## 使用者教學（雲端版，不需安裝任何程式）

整個流程大約 15 分鐘。完成後只需要把一個網址加到 OBS，不需要在電腦安裝任何東西。

---

### 步驟一：建立 Firebase 專案

Firebase 是 Google 的免費雲端服務，用來存放你的設定並提供 OBS overlay 的網址。

1. 前往 [console.firebase.google.com](https://console.firebase.google.com)，登入 Google 帳號
2. 點「**新增專案**」→ 輸入一個名稱（例如 `my-yolia`）→ 可關閉 Google Analytics → 點「建立專案」
3. 左側選單 → **建構** → **Realtime Database** → 點「**建立資料庫**」
   - 選擇離你最近的位置（亞洲建議選 asia-southeast1）
   - 安全性規則選「**以測試模式啟動**」→ 啟用
4. 左側點齒輪 ⚙ → **專案設定** → 捲到「**你的應用程式**」→ 點 `</>` 新增 Web 應用程式
   - 輸入任意暱稱（例如 `overlay`）→ 點「註冊應用程式」
   - 複製畫面出現的 `firebaseConfig` 物件，稍後要用

   ```js
   // 範例，你的數值會不同
   const firebaseConfig = {
     apiKey: "AIzaSyXXXXXXXXXXXXXX",
     authDomain: "my-yolia.firebaseapp.com",
     databaseURL: "https://my-yolia-default-rtdb.asia-southeast1.firebasedatabase.app",
     projectId: "my-yolia",
     storageBucket: "my-yolia.firebasestorage.app",
     messagingSenderId: "123456789",
     appId: "1:123456789:web:abcdef"
   };
   ```

5. 左側選單 → **建構** → **Authentication** → 點「**開始使用**」
   - 「Sign-in method」頁籤 → 點「**Email/Password**」→ 啟用 → 儲存
   - 「Users」頁籤 → 「**新增使用者**」→ 輸入你要用來登入控制面板的 Email 和密碼
   - 這組帳密就是之後打開 `/panel` 時要輸入的登入資訊，忘記密碼可以回這裡的 Users 頁籤重設

---

### 步驟二：Fork 這個 repo

1. 登入 [GitHub](https://github.com)（沒有帳號請先免費註冊）
2. 進入本 repo 頁面 → 右上角點「**Fork**」→「**Create fork**」

---

### 步驟三：取得 Service Account 金鑰（一次性）

這把金鑰讓 GitHub 有權限部署到你的 Firebase，只需要設定一次。全程在網頁上點選，**不需要安裝任何軟體或下指令**。

1. Firebase Console → 齒輪 ⚙ → **專案設定** → **服務帳戶** 頁籤
2. 點「**產生新的私密金鑰**」→ 確認 → 會下載一個 `.json` 檔案
3. 用文字編輯器打開這個 `.json` 檔案，全選複製內容（下一步要貼上）

---

### 步驟四：填入 GitHub Secrets

在你 Fork 的 repo 頁面：**Settings** → **Secrets and variables** → **Actions** → **New repository secret**

逐一新增以下 5 個 secret（名稱要完全一樣）：

| Secret 名稱 | 填入的值 |
|---|---|
| `FIREBASE_PROJECT_ID` | firebaseConfig 裡的 `projectId`（例如 `my-yolia`） |
| `FIREBASE_API_KEY` | firebaseConfig 裡的 `apiKey` |
| `FIREBASE_MESSAGING_SENDER_ID` | firebaseConfig 裡的 `messagingSenderId` |
| `FIREBASE_APP_ID` | firebaseConfig 裡的 `appId` |
| `FIREBASE_SERVICE_ACCOUNT` | 步驟三下載的 `.json` 檔案**完整內容**（整份貼上，不用額外處理） |

> **注意：** `databaseURL` 如果不是預設格式（`https://PROJECT_ID-default-rtdb.firebaseio.com`），請額外新增一個 `FIREBASE_DATABASE_URL` secret，填入你的實際 URL。亞洲區域（asia-southeast1）通常需要這個。

---

### 步驟五：觸發部署

在你 Fork 的 repo 頁面點 **Actions** → 左側 **Deploy to Firebase** → 右側「**Run workflow**」→「**Run workflow**」。

等待約 1 分鐘，出現綠色勾勾代表部署成功。  
你的 overlay 網址是：`https://YOUR_PROJECT_ID.web.app`

---

### 步驟六：設定 OBS

1. 在 OBS 左下「來源」→ 點 **+** → **瀏覽器（Browser）**
2. 填入：
   - URL：`https://YOUR_PROJECT_ID.web.app`
   - 寬度：`1920`　高度：`1080`
3. 往下找到「**Custom CSS**」欄位，貼入以下內容（**必填**，讓背景透明）：
   ```css
   body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }
   ```
4. 點 OK

---

### 步驟七：設定頻道與 API Key

打開控制面板：`https://YOUR_PROJECT_ID.web.app/panel`

會先看到登入畫面，輸入步驟一設定的 Email／密碼即可進入。

進入「**設定**」頁：

**Twitch（不需要 token，填頻道名就好）：**
- 勾選「啟用 Twitch 聊天監聽」
- 填入你的 Twitch 頻道名稱（例如 `altheayolia`）

**YouTube（需要 API Key）：**
- 勾選「啟用 YouTube 聊天監聽」
- 填入頻道 handle（例如 `@altheayolia`）
- 填入 YouTube Data API Key（取得方式見下方）

設定後角色立即生效，OBS 畫面會自動更新，不需重新整理。

---

### 取得 YouTube Data API Key

1. 前往 [Google Cloud Console](https://console.cloud.google.com)
2. 點左上角選單 → **API 和服務** → **程式庫**
3. 搜尋「**YouTube Data API v3**」→ 點進去 → **啟用**
4. 左側 → **憑證** → **+ 建立憑證** → **API 金鑰**
5. 複製產生的金鑰，填入控制面板的「YOUTUBE_API_KEY」欄位

> YouTube API 每日有 10,000 quota 限制，直播中約消耗 500–2,000 quota/小時。不開播時程式每 15 分鐘才查詢一次，避免浪費 quota。

---

### 互動設定（桌寵設定頁）

控制面板 → **桌寵設定** 可以設定觀眾如何與角色互動：

| 類型 | 說明 |
|---|---|
| **門檻** | 幽視值累積到門檻時，角色切換狀態（idle / peek / cheer） |
| **關鍵詞** | 訊息包含指定詞語時觸發動畫（例如「安安」→ 揮手） |
| **指令** | 觀眾輸入 `!指令` 觸發動畫，可設定消耗幽視值 |

幽視值（0–100）隨每則聊天訊息 +1，指令可以加減或消耗。

---

## 開發者說明

### 架構

```
YoliaWatching/
├── yuupeek/          Electron 桌面版（本機執行）
│   ├── main.js       Electron 主程序，HTTP server（port 3000），聊天室連線
│   ├── src/
│   │   ├── chatListener.js    Twitch (tmi.js) + YouTube polling（Node.js）
│   │   ├── chatProcessor.js   純函數訊息處理邏輯（isomorphic）
│   │   └── obsServer.js       HTTP + WebSocket server，panel API
│   └── renderer/
│       ├── obs-overlay.html   OBS overlay 頁面
│       ├── panel.html         控制面板（DataAdapter 模式，兩個版本共用）
│       └── character.js       Canvas 動畫引擎（isomorphic）
│
└── web/              Firebase 雲端版
    ├── public/
    │   ├── index.html         OBS overlay（內建 Twitch + YouTube 監聽器）
    │   ├── panel.html         控制面板（sync.js 從 yuupeek/renderer/ 同步過來）
    │   ├── character.js       同上（sync.js 同步）
    │   └── chatProcessor.js   同上（sync.js 從 yuupeek/src/ 同步）
    ├── firebase.json
    ├── database.rules.json
    ├── sync.js                部署前自動同步共用檔案
    └── gen-firebase-config.js 從環境變數產生 firebase-config.js（CI 用）
```

**雲端版的關鍵設計**：`web/public/index.html` 本身就是聊天室監聽器，直接在 OBS Browser Source 的瀏覽器環境裡連線 Twitch IRC（native WebSocket）和輪詢 YouTube Data API，從 Firebase RTDB 讀取設定，不需要任何後端。

`chatProcessor.js` 和 `character.js` 是 isomorphic，Electron 版和雲端版共用同一份原始碼，由 `sync.js` 在部署前複製。

---

### 本機開發（Electron）

```bash
cd yuupeek
npm install
npm start
```

啟動後：
- 控制面板：`http://localhost:3000/panel`
- OBS overlay：`http://localhost:3000`

---

### 本機測試（雲端版 UI）

```bash
cd yuupeek
npm run test-ui
```

---

### 發布新版本（Electron）

1. 更新 `yuupeek/package.json` 的 `version`
2. Commit
3. 設定環境變數 `GH_TOKEN`（GitHub Personal Access Token，需有 `repo` 權限）
4. 執行：

```bash
cd yuupeek
npm run release
```

自動打 tag、打包 Windows 安裝檔、上傳到 GitHub Releases。

### 部署雲端版

Push 到 main 自動觸發 GitHub Actions 部署。  
手動觸發：Actions → Deploy to Firebase → Run workflow。

共用檔案修改後（`character.js`、`panel.html`、`chatProcessor.js`），CI 的 `sync.js` 會自動同步，不需要手動複製。
