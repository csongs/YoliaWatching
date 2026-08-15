# YoliaWatching

Twitch / YouTube / SOOP 聊天室互動桌寵，透過 OBS Browser Source 顯示在直播畫面上。
觀眾在聊天室輸入指令或關鍵詞，角色會做出對應動畫反應。

內部工具，不是給陌生實況主自架的通用產品（2026-08-16 定調，見 docs/decisions/）。
沒有雲端部署——本機跑兩支各自獨立的程式，缺一不可：

| | 做什麼 | 指令 |
|---|---|---|
| **chat-monitor** | 監聽 Twitch/YouTube/SOOP 聊天室，轉發給桌寵 | `cd chat-monitor && npm start`（先開這個） |
| **yuupeek** | 桌寵本體：動畫、OBS overlay、控制面板 | `cd yuupeek && npm start` |

---

## 本機執行

```bash
cd chat-monitor
npm install
npm start
# → http://127.0.0.1:3100，這裡設定 Twitch/YouTube/SOOP 頻道與 API key

cd yuupeek
npm install
npm start
# → 控制面板 http://localhost:3000/panel
# → OBS overlay http://localhost:3000
```

chat-monitor 沒開著，桌寵完全收不到聊天訊息（不會報錯，只是安靜——panel「模組狀態」分頁
有連線燈號可以確認）。

### 設定聊天頻道

打開 `http://127.0.0.1:3100`，「平台設定」分頁：

- **Twitch**：不需要 token，填頻道名稱即可（例如 `altheayolia`）。
- **YouTube**：不需要 API Key（改用免登入的網頁聊天室爬蟲），填頻道 handle（例如
  `@altheayolia`）。
- **SOOP**：填 BJ ID，目前只支援社群模式。

### 設定 OBS

1. 左下「來源」→ **+** → **瀏覽器（Browser）**
2. URL：`http://localhost:3000`　寬度 `1920`　高度 `1080`
3. **Custom CSS**（必填，否則背景是白色）：
   ```css
   body { background-color: rgba(0, 0, 0, 0); margin: 0px auto; overflow: hidden; }
   ```
4. 點 OK，角色即出現在畫面上

### 互動設定（桌寵設定頁）

控制面板 → **桌寵設定** 可以設定觀眾如何與角色互動：

| 類型 | 說明 |
|---|---|
| **門檻** | 幽視值累積到門檻時，角色切換狀態（idle / peek / cheer） |
| **關鍵詞** | 訊息包含指定詞語時觸發動畫（例如「安安」→ 揮手） |
| **指令** | 觀眾輸入 `!指令` 觸發動畫，可設定消耗幽視值 |

幽視值（0–100）隨每則一般聊天訊息 +1，指令可以加減或消耗。斗內/訂閱/Raid 等特殊事件
chat-monitor 抓得到，但桌寵這端目前刻意不處理（範圍決策，見 CLAUDE.md）。

---

## 開發者說明

### 架構

```
YoliaWatching/
├── chat-monitor/     獨立 Node process，聊天來源
│   ├── server.js     HTTP + WebSocket server（port 3100）
│   ├── connectors/    Twitch (tmi.js) / YouTube (youtube-chat-next) / SOOP (soop-extension)
│   └── db.js          SQLite 儲存（events 歷史 + 平台設定）
│
└── yuupeek/          Electron 桌寵本體
    ├── main.js        Electron 主程序，HTTP server（port 3000）
    ├── src/
    │   ├── chatMonitorClient.js  chat-monitor 的 WebSocket 唯讀 client
    │   ├── chatProcessor.js      純函數訊息處理邏輯
    │   └── obsServer.js          HTTP + WebSocket server，panel API
    └── renderer/
        ├── obs-overlay.html      OBS overlay 頁面
        ├── panel.html            控制面板
        └── character.js          Canvas 動畫引擎
```

**關鍵設計**：桌寵不自己連聊天室——chat-monitor 監聽三個平台、寫進本機 SQLite，再用
WebSocket 把每個新事件廣播出去；`yuupeek/src/chatMonitorClient.js` 訂閱這條 WS，只挑一般
聊天文字（`event_type==='chat'`）餵給 `chatProcessor.js` 驅動幽視值/動畫。詳細資料流見
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

---

### 本機測試（角色/動畫沙盒）

test.html 角色沙盒頁（port 3001，不需聊天室；驗內建動畫與 character.js 改動）：

```bash
cd yuupeek
npm run test-ui
```

### 發布新版本（Electron）

1. 更新 `yuupeek/package.json` 的 `version`
2. Commit
3. 設定環境變數 `GH_TOKEN`（GitHub Personal Access Token，需有 `repo` 權限）
4. 執行：

```bash
cd yuupeek
npm run release
```

自動打 tag、打包 Windows 安裝檔、上傳到 GitHub Releases。chat-monitor 不對外發布，是內部
工具，`git clone` 後照上面「本機執行」的步驟跑即可。

## 粉絲投稿:幫角色加新動作

粉絲可以畫 spritesheet 投稿新動作(透過任何場外管道交給實況主),實況主在
控制面板「角色工房」匯入並綁定指令。格式要求見
[docs/fan-submission-guide.md](docs/fan-submission-guide.md)。
