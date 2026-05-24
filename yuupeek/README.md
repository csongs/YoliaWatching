# YoliaWatching

Twitch / YouTube 聊天室監控桌寵，透過 OBS Browser Source 顯示在直播畫面上。

---

## 啟動（開發模式）

```bash
npm install
npm start
```

啟動後開啟控制面板：`http://localhost:3000/panel`

---

## 設定檔說明

### default.config.json（預設值，隨程式更新）

程式內建預設值，安裝後位於程式目錄。**請勿直接編輯**，改以控制面板調整。

### config.json（使用者設定，更新後保留）

位於 `%APPDATA%\YoliaWatching\config.json`，只儲存與預設值不同的設定，格式如下：

```json
{
  "obs": {
    "port": 3000,
    "scale": 2
  },
  "twitch": {
    "enabled": true,
    "channel": "你的頻道名稱"
  },
  "youtube": {
    "enabled": false,
    "channel": "@你的頻道handle"
  },
  "interactions": [
    {
      "id": "t_ab12",
      "trigger": "threshold",
      "min": 80,
      "state": "cheer"
    },
    {
      "id": "k_cd34",
      "trigger": "keyword",
      "keywords": "安安,午安,早安",
      "state": "wave",
      "response": "{user} 安安~"
    },
    {
      "id": "c_ef56",
      "trigger": "command",
      "command": "!加油",
      "state": "cheer",
      "yolia_see": 10,
      "cost": 0
    }
  ],
  "greetingAnimations": [
    { "frames": [0,1,2,3,2,1,0], "ms": 200, "weight": 80 },
    { "frames": [4,5,6,7,6,5,4], "ms": 200, "weight": 20 }
  ]
}
```

**interactions 三種觸發類型：**

| trigger | 說明 |
|---|---|
| `threshold` | 幽視值門檻，`min` 以上時進入指定 `state` |
| `keyword` | 觀眾訊息含關鍵字時觸發，多關鍵字用逗號分隔 |
| `command` | 指令觸發，可設定 `yolia_see` 增減與 `cost` 消耗門檻 |

### animations.json（動畫自訂，更新後保留）

位於 `%APPDATA%\YoliaWatching\animations.json`，只儲存與內建不同的動畫設定。

---

## .env

放在 `%APPDATA%\YoliaWatching\.env`，不進版本庫。

```
TWITCH_OAUTH=oauth:xxxxxxxxxxxxxxxxxxxxxxxx
YOUTUBE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXX
```

### Twitch OAuth Token

1. 前往 [twitchtokengenerator.com](https://twitchtokengenerator.com/)
2. 選擇 **Bot Chat Token**
3. 授權後複製 **ACCESS TOKEN**
4. 填入 `TWITCH_OAUTH`，格式為 `oauth:你的token`

### YouTube Data API Key

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案 → 啟用 **YouTube Data API v3**
3. 建立憑證 → **API 金鑰**
4. 填入 `YOUTUBE_API_KEY`

> YouTube API 每日有 10,000 quota 限制，直播中約消耗 500–2,000 quota/小時。

---

## OBS Browser Source

將 `http://localhost:3000` 加入 OBS（建議 1920×1080，背景透明）。

右鍵 Source → **Interact** 可操作控制按鈕及拖曳角色。

---

## 發布新版本

### 前置需求

- 設定環境變數 `GH_TOKEN`（GitHub Personal Access Token，需有 `repo` 權限）

### 流程

1. 更新 `package.json` 的 `version` 欄位（例如 `1.0.3`）
2. Commit 版本變更
3. 執行發布指令：

```bash
cd yuupeek
npm run release
```

`npm run release` 會自動：
- 打 git tag（例如 `v1.0.3`）並 push 到 GitHub
- 打包 Windows 安裝檔（`.exe`）
- 上傳到 GitHub Releases

### 本機測試打包（不發布）

```bash
npm run build        # 產生安裝檔到 dist/
npm run build:dir    # 解壓資料夾到 dist/win-unpacked/（較快）
```
