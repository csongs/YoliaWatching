# YoliaWatching
桌面寵物，監控你是否在偷看 LoL 直播。支援 Electron 透明 overlay 及 OBS Browser Source 兩種模式。

指令列表與即時測試請開啟 **test 頁面**：`http://localhost:3000/renderer/test.html`

---

## 啟動

```bash
npm install
npm start
```

---

## config.json

```json
{
  "modes": {
    "pet": true,      // Electron 透明 overlay（桌面寵物）
    "obs": true,      // 啟動 OBS Browser Source 伺服器
    "test": false     // 啟動時自動開啟 test 頁面
  },
  "obs": {
    "port": 3000,
    "scale": 2        // 角色尺寸倍率（1 / 1.5 / 2 … 4）
  },
  "yoliaStates": [
    { "min": 80, "state": "cheer" },
    { "min": 40, "state": "peek"  },
    { "min": 0,  "state": "idle"  }
  ],
  "twitch": {
    "enabled": true,
    "channel": "頻道名稱"       // 你的 Twitch 頻道 ID
  },
  "youtube": {
    "enabled": false,
    "channel": "@頻道handle"    // 你的 YouTube 頻道 handle，例如 @altheayolia
  },
  "greetings": ["安安", "午安", "早安", "晚安"],  // 觸發揮手動畫的關鍵詞
  "greetingResponse": "{user} 安安~",              // 對話泡泡格式，{user}=觀眾名，{word}=符合的詞
  "greetingAnimations": [                          // 揮手動畫變體（依 weight 隨機抽選）
    { "frames": [0,1,2,3,2,1,0], "ms": 200, "weight": 80 },
    { "frames": [4,5,6,7,6,5,4], "ms": 200, "weight": 20 }
  ],
  "commands": {
    "!加油": { "state": "cheer", "yolia_see": 10  },
    "!哭":   { "state": "cry",   "yolia_see": -15 }
  }
}
```

**yoliaStates**：依 `yolia_see` 值決定角色狀態，由高到低匹配，可自由新增或調整門檻。

**greetings**：觀眾訊息包含這些詞時觸發揮手動畫。設為 `[]` 可停用。

**greetingResponse**：對話泡泡文字模板。`{user}` 替換為觀眾名，`{word}` 替換為符合的關鍵詞。

**greetingAnimations**：揮手動畫變體，依 `weight` 比例隨機抽選。`frames` 為 `waving/` 資料夾的幀號，`ms` 為每幀毫秒。

**commands**：聊天室指令自訂。`state` 為觸發的動畫，`yolia_see` 為數值增減（可省略）。非指令的一般訊息每則 +1。

---

## .env

放在 `.env`，不進版本庫。

```
TWITCH_OAUTH=oauth:xxxxxxxxxxxxxxxxxxxxxxxx
YOUTUBE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXX
```

### Twitch OAuth Token
用來讓程式連線讀取你的聊天室。

1. 前往 [twitchtokengenerator.com](https://twitchtokengenerator.com/)
2. 選擇 **Bot Chat Token**
3. 授權後複製 **ACCESS TOKEN**
4. 填入 `TWITCH_OAUTH`，格式為 `oauth:你的token`

**測試方式（不需要真的開播）**

在 OBS 串流設定中，把原本的 Stream Key 最後加上 `?bandwidthtest=true`：
```
live_12345678_xxxxxxxxxxxx?bandwidthtest=true
```
如果是帳號直連模式，可勾選「**啟用頻寬測試模式 (Enable Bandwidth Test Mode)**」，效果相同。
這樣可以模擬開播但不會實際對觀眾直播，程式即可偵測到聊天室。

### YouTube Data API Key
用來查詢頻道直播狀態並讀取 Live Chat。

1. 前往 [Google Cloud Console](https://console.cloud.google.com/)
2. 建立專案 → 啟用 **YouTube Data API v3**
3. 建立憑證 → **API 金鑰**
4. 填入 `YOUTUBE_API_KEY`

> YouTube API 每日有 10,000 quota 限制。本程式在直播中約用 500–2,000 quota/小時，離線時每 30 秒查詢一次直播狀態。

---

## OBS Browser Source

將 `http://localhost:3000` 加入 OBS（建議 1920×1080，背景透明）。

右鍵 Source → **Interact** 可操作 HUD 按鈕及拖曳角色。
