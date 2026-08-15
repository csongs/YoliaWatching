# 事件類型對照表：raw data → event_type → UI 呈現

給要分析/擴充 chat-monitor 的人看的參考筆記：三個平台每一種事件，原始資料長怎樣、
被分類成哪個 `event_type`、以及在 demo 頁面怎麼顯示。

## 怎麼看這份文件

- 每個事件都標了資料來源：
  - **✅ 真實抓包**：從 `data/raw-capture.jsonl`（`CHAT_MONITOR_RAW_CAPTURE=1` 存下的真實事件）複製，只刪掉不影響結構的個資（頻道 ID 等不影響閱讀的留著方便核對）。
  - **🔧 程式碼推導**：目前還沒抓到真實樣本，根據 connector 程式碼的欄位對應手動建構，**未經真實資料驗證**，欄位型別/格式可能跟真實情況有出入。
  - 兩種都會標抓包/撰寫日期。清單以 2026-08-13 的 `raw-capture.jsonl`（約 330 行）為準，之後跑久了應該會補到更多真實樣本，尤其是 SOOP 的抖內/訂閱類事件。
- 各事件類型的驗證狀態總表（含 `event_type`、需不需要 Token/Key）**只**維護在 [README.md](../README.md#各事件類型與驗證狀態2026-08-15)——這份文件不重複記錄「驗證到什麼程度」這種判斷性結論，只放實際 raw data 跟欄位對應，兩份文件各管各的，改狀態只需要改 README 那一份。
- 未實作的功能構想／待確認的協定細節追蹤在 [GitHub Issues](https://github.com/csongs/YoliaWatching/issues)，這份文件跟 README 都不重複列成一份清單。

## 共通結構：events 表 → UI

所有平台的事件最後都收斂成同一張 SQLite `events` 表（見 [db.js](../db.js)）的一列：

| 欄位 | 說明 |
|---|---|
| `platform` | `twitch` / `youtube` / `soop` |
| `event_type` | 見下面各平台清單，決定 [labels.js](../public/labels.js) 的中文標籤與分類（`chat`/`donation`/`system`） |
| `username` | 顯示名稱（沒有則為 `null`，例如 SOOP `notification`） |
| `message` | 純文字內容（沒有則為 `null`，例如抖內事件） |
| `amount` | 金額或月數字串（只有訂閱/抖內類事件有值） |
| `extra_json` | 事件專屬欄位的 JSON 字串，各事件不同，見下面各節 |
| `received_at` | ISO 時間字串 |

demo 頁（[demo.js](../public/demo.js) 的 `renderLine()`）怎麼把一列事件畫成一行聊天記錄：

- **平台色塊**：`<span class="tag {platform}">` 用 CSS 變數 `--twitch`(#9147ff) / `--youtube`(#ff3b3b) / `--soop`(#1bc47d) 上色。
- **類型標籤**：`event_type !== 'chat'` 才顯示（例如「Bits 抖內」「訂閱(구독)」），一般聊天每則都一樣的標籤是雜訊，省略。標籤文字來自 `labels.js` 的 `EVENT_TYPE_LABELS[type].label`。
- **整行底色**：`category === 'donation'` → 淡橘色底 + 左邊橘色豎線；`category === 'system'` → 灰色斜體；`category === 'chat'` → 無特殊底色。
- **金額**：`formatAmount()` —— `event_type` 是 `resub` 或 SOOP `subscribe` 時顯示「已訂閱 N 個月」，其他有 `amount` 的事件顯示「+N」（橘色粗體）。
- **訊息內容**：`renderMessageBody()` —— 有 `extra.messageParts`（文字/表情圖片交錯陣列）就渲染 `<img class="chat-emoji">` 圖片，否則退回純文字 `message` 欄位。
- **換行**：`message` 欄位可能包含真的換行字元（2026-08-14 確認：SOOP 的 `res.comment` 對某些使用者用「巨集/多行留言」功能送出的訊息，例如裝飾用的 ASCII art 邊框，會帶真實的 `\r\n`，不是我們自己加的），`.chat-line` 的 CSS 加了 `white-space: pre-wrap` 讓這些換行真的顯示出來，而不是被瀏覽器預設行為擠成一行。
- **使用者名稱顏色**（2026-08-14）：Twitch（`tags.color`，IRC 原生欄位）跟 SOOP（`randomNicknameColorDarkmode`，soop-extension 沒有解析，monkey-patch `SoopChat.prototype.parseChat` 補回來，見 [connectors/soop.js](../connectors/soop.js) 的 `patchChatColor()`）都有使用者自訂的暱稱顏色，存進 `extra.color`；demo.js 的 `usernameColorStyle()` 驗證是合法的 hex color 格式才會套用到 `.uname` 的 `style="color:..."`，格式不對就不上色（防止外部資料被當成任意 CSS/HTML 注入）。YouTube 沒有這個概念，`extra.color` 不會出現。**SOOP 這個欄位已經用真實封包驗證過**（2026-08-14，開 `RAW_CAPTURE` 抓了約 20 筆真實訊息核對）：`parts[9]`/`parts[10]` 穩定是同一個人、同色系的兩種深淺（例如 `158304`/`63B566`），第一次接上時漏了在前面補 `#`（SOOP 原始格式是 `63B566` 不是 `#63B566`），demo.js 的驗證邏輯會直接擋掉沒有 `#` 開頭的字串，導致畫面上完全沒顏色（user 實測回報過）——已修正，`connectors/soop.js` 現在會在存進 `extra.color` 之前補上 `#`。
- **時間戳**：一律同色（`.time`），要不要顯示由工具列「顯示時間戳」勾選框整批切換（CSS class，不重繪）。

---

## Twitch

Connector：[connectors/twitch.js](../connectors/twitch.js)（`tmi.js`，IRC）。

### 填了 Twitch OAuth Token 會多出什麼（2026-08-14 註記）

**結論：目前完全沒有差別。** 這裡列的所有事件都是走 IRC（`tmi.js`），而 IRC 層級的能力
匿名連線跟有 Token 連線是**一樣的**——`tmi.js` 在送 `PASS`/`NICK` 之前就已經無條件送出
`CAP REQ`（IRC 擴充能力宣告），不會因為有沒有認證而縮減，這是「Twitch 免 Token（匿名）
模式」那次修復時查證過的（見 [README.md](../README.md) 同名章節）。也就是說：`chat`、
`cheer`、`sub`、`resub`、`subgift`、`submysterygift`、`raid`、`announcement` 這些事件，
理論上有沒有 Token 收到的內容完全一樣（cheer/sub/resub/raid 在純匿名模式下的實際接收情況
還沒有真實驗證過，見 README 驗證狀態表，但差異點不在「有沒有 Token」，是這幾種事件本身
還沒等到真實案例）。

Token 唯一可能有意義的地方，是**完全獨立於 IRC 之外的另一條管道**：Twitch EventSub
（需要對應授權範圍的 OAuth token，用 WebSocket 訂閱，不是 `tmi.js`）。這裡目前**沒有實作**
EventSub，所以就算填了 Token 也不會多任何功能——這份筆記只是先記錄「如果之後要做，能多什麼」：

- **頻道點數兌換（沒有附聊天訊息的那種）**：2026-08-14 使用者截圖實際遇到（「Csongs 兌換了
  『安안』200 點」，沒有文字輸入的兌換項目）——這種不會出現在 IRC 聊天訊息裡（跟已經支援的
  `chat_highlight` 不同，`chat_highlight` 是「兌換時**有**附文字」的情況，走一般 PRIVMSG 帶
  `custom-reward-id` tag，不需要 EventSub 就能收到），需要 EventSub 的
  `channel.channel_points_custom_reward_redemption.add`，授權範圍
  `channel:read:redemptions`。
- 其他 EventSub 才有的事件類別（沒有具體核對過細節，只是列出 Twitch EventSub 文件裡存在
  這些類別，供之後評估要不要做）：極限開播（Hype Train）進度、頻道投票（Poll）、頻道預測
  （Prediction）、新關注者（Follow，需要 `moderator:read:followers`）。訂閱/續訂/贈送訂閱
  這幾個 EventSub 也有對應事件，但這裡已經用 IRC USERNOTICE 拿到了，改用 EventSub 拿同樣的
  資訊沒有額外好處。

### chat — 一般訊息

分類：`chat`。純文字聊天訊息，`tags.bits` 沒有值、也不是頻道點數兌換訊息時的預設分類。

✅ 真實抓包範例（2026-08-13，帶表情符號，`chat_with_emotes` 抓包標記，實際 `event_type` 仍是 `chat`）：

```json
{
  "badge-info": {"predictions": "會", "subscriber": "7"},
  "badges": {"predictions": "blue-1", "subscriber": "6", "football-fest-2026": "1"},
  "color": "#1E90FF",
  "display-name": "AeROsMIth3345678",
  "emote-only": true,
  "emotes": {"emotesv2_4017cea4554e4305a17742f55cc556e8": ["0-10"]},
  "id": "89aab52a-3dd5-4c6a-9fcf-d3cefc9e195f",
  "user-id": "883441377",
  "username": "aerosmith3345678"
}
```

存進 `events` 表：
- `message` = tmi.js 傳出的純文字訊息本體（例如表情符號的 shortcode 文字）
- `amount` = `null`
- `extra` = `{ badges, color, messageParts }`，`messageParts` 由 [`buildEmoteMessageParts()`](../connectors/twitch.js) 用 `tags.emotes` 的位置區間把訊息切成 `[{type:'text',text},{type:'emoji',url,alt}]` 交錯陣列；沒有表情符號時 `messageParts` 為 `null`。emoji 圖片網址規則：`https://static-cdn.jtvnw.net/emoticons/v2/{emoteId}/default/dark/2.0`（Twitch 官方 CDN 規則，已用真實 emote id 以 curl 驗證回傳 `200 image/png`）。

UI 呈現：無類型標籤（`chat` 被省略），`messageParts` 有值時訊息文字裡的表情符號會渲染成 `<img class="chat-emoji">` 內嵌圖片（高度 1.4em，跟文字對齊）。

### chat_highlight — 醒目留言（頻道點數兌換）

分類：`chat`。`tags['msg-id'] === 'highlighted-message'` 或帶 `custom-reward-id`（頻道點數兌換）時的分類，**不是金流抖內**。

✅ 真實抓包範例（2026-08-13）：

```json
{
  "badge-info": {"subscriber": "6"},
  "badges": {"subscriber": "6", "hype-train": "2"},
  "color": "#FF69B4",
  "display-name": "薛怒",
  "emotes": {"emotesv2_893ee80f475246b0bd0a3fa5205f33cc": ["11-21", "34-44", "57-67"]},
  "id": "be48187d-7d11-498c-a728-498bd7cc9727",
  "msg-id": "highlighted-message",
  "user-id": "661046161",
  "username": "alanisgoood"
}
```

存進 `events` 表：同 `chat`（`message`/`amount: null`/`extra.messageParts`），只差 `event_type` 是 `chat_highlight`。

UI 呈現：顯示「醒目留言(頻道點數兌換)」標籤；因為分類仍是 `chat`（不是 `donation`），整行**沒有**橘色底線——這是刻意的，避免使用者誤以為是金流抖內。

### cheer — Bits 抖內

分類：`donation`。`tags.bits` 有值時的分類。

🔧 程式碼推導範例（2026-08-13 撰寫，尚未抓到真實 cheer 事件）：

```json
{
  "badge-info": {"subscriber": "3"},
  "badges": {"bits": "1000"},
  "bits": "100",
  "color": "#FF0000",
  "display-name": "SomeCheerer",
  "id": "example-id-0001",
  "user-id": "123456789",
  "username": "somecheerer"
}
```

存進 `events` 表：`message` = 訊息文字（cheer 訊息本身可以帶文字，例如 `Cheer100 go go go`）；`amount` = `String(tags.bits)`；`extra` = `{ badges, color, messageParts }`（跟 `chat` 同樣的表情符號結構）。

UI 呈現：「Bits 抖內」標籤 + 橘色底 + `+100`（橘色粗體，`formatAmount()` 的一般抖內格式，不是月數格式）。

### sub — 新訂閱

分類：`donation`。

✅ 真實抓包範例（2026-08-13）：

```json
{
  "badge-info": {"subscriber": "1"},
  "badges": {"subscriber": "0", "premium": "1"},
  "display-name": "kkwycl",
  "login": "kkwycl",
  "msg-id": "sub",
  "msg-param-sub-plan-name": "Channel Subscription (roger9527)",
  "msg-param-sub-plan": "Prime",
  "msg-param-was-gifted": "false",
  "system-msg": "kkwycl subscribed with Prime.",
  "user-id": "836848134"
}
```

另一筆真實範例（一般付費 Tier 1，非 Prime）：`msg-param-sub-plan: "1000"`，`system-msg: "醬醬1 subscribed at Tier 1."`。

**2026-08-15 補上「預先訂閱多個月」**：使用者截圖回報 Twitch 原文顯示「已預先訂閱層級 1 x 3 個月」，但畫面上看不到這個月數——查證後這是 `msg-param-multimonth-duration` 這個 tag（一次預先買 N 個月，不是累積訂閱月數，跟 `resub` 的 `msg-param-cumulative-months` 是不同概念），原本完全沒讀取。真實抓包範例（`display-name: "學讓"`）：`msg-param-multimonth-duration: "3"`。**注意**：只有真的一次買多個月時這個 tag 才是數字字串，一般單月新訂閱時 tmi.js 解析後這個 tag 會變成 `boolean`（`true`/`false`，同一批樣本裡另外兩筆都是這樣），所以 [`connectors/twitch.js`](../connectors/twitch.js) 只在 `typeof === 'string' && /^\d+$/.test(...)` 成立時才當作月數，其餘一律當沒有。

存進 `events` 表：`message` = USERNOTICE 附帶的留言（可為 `null`）；`amount` = `String(multimonthDuration)`（一次預先買多個月時）或 `null`（一般單月新訂閱，沒有月數概念）；`extra` = `{ plan: tags['msg-param-sub-plan'], multimonthDuration }`（`plan` 是 `"Prime"` 或 tier 數字字串 `"1000"`/`"2000"`/`"3000"`）。

UI 呈現：「新訂閱」標籤 + 橘色底；`amount` 有值時顯示「預先訂閱 N 個月」（跟 `resub`/SOOP `subscribe` 的「已訂閱 N 個月」語意不同，用詞特意分開，見 [demo.js](../public/demo.js) 的 `formatAmount()`），一般單月新訂閱不顯示金額數字。

### resub — 續訂

分類：`donation`。**這個事件曾經有 bug**：tmi.js 把 `msg-param-streak-months`（連續訂閱月數，使用者可關閉分享則為 0）當成事件的 `months` 參數傳出來，但畫面上該顯示的其實是 `msg-param-cumulative-months`（累積總月數）——已修正為直接讀完整 tags 裡的 `msg-param-cumulative-months`，`streakMonths` 只留在 `extra` 當參考。

✅ 真實抓包範例（2026-08-15，`display-name: "赵远舟"`）：

```json
{
  "display-name": "赵远舟",
  "login": "apple824",
  "msg-id": "resub",
  "msg-param-cumulative-months": "2",
  "msg-param-streak-months": "2",
  "msg-param-multimonth-duration": "6",
  "msg-param-multimonth-tenure": true,
  "msg-param-should-share-streak": true,
  "msg-param-sub-plan": "1000",
  "system-msg": "赵远舟 subscribed at Tier 1. They've subscribed for 2 months, currently on a 2 month streak!"
}
```

**2026-08-15 補上「續訂順便預先付多個月」**：跟 `sub` 的「預先訂閱多個月」是同一個 tag（`msg-param-multimonth-duration`）、同一種情況——這筆真實樣本裡 `cumulative-months` 是 `"2"`（累積訂閱總月數）、`multimonth-duration` 是 `"6"`（這次續訂順便一次付了 6 個月），是兩個不同的數字，原本完全沒讀後者。跟 `sub` 一樣的型別檢查：只有真的是數字字串才當月數，不適用時 tmi.js 解析後會是 `boolean`（這筆樣本裡 `msg-param-multimonth-tenure` 就是 `true`，不是數字）。

存進 `events` 表：`message` = 續訂留言（可為 `null`）；`amount` = `String(cumulativeMonths ?? streakMonths ?? '')`（累積總月數，這裡是 `"2"`）；`extra` = `{ plan, streakMonths, multimonthDuration }`（`multimonthDuration` 這裡是 `6`，抓不到時為 `null`）。

UI 呈現：「續訂」標籤 + 橘色底 + **「已訂閱 2 個月（一次續訂 6 個月）」**（`formatAmount()` 對 `resub`/`subscribe` 的特殊格式；沒有 `multimonthDuration` 時只顯示「已訂閱 N 個月」，不加後面那段）。

### subgift — 贈送訂閱

分類：`donation`。

✅ 真實抓包範例（2026-08-13，同一位使用者連續贈送多份，這裡取一筆）：

```json
{
  "badge-info": {"subscriber": "12"},
  "badges": {"subscriber": "12", "sub-gifter": "1"},
  "display-name": "賴清的不乾淨",
  "login": "pkluke124",
  "msg-id": "subgift",
  "msg-param-community-gift-id": "15684924108020656564",
  "msg-param-months": "2",
  "msg-param-recipient-display-name": "thomas920601",
  "msg-param-recipient-user-name": "thomas920601",
  "msg-param-sub-plan": "1000",
  "system-msg": "賴清的不乾淨 gifted a Tier 1 sub to thomas920601!"
}
```

存進 `events` 表：`message` = `` `→ ${recipient}` ``（tmi.js 事件參數給的收禮者登入名）；`amount` = `null`；`extra` = `{ recipient }`。

UI 呈現：「贈送訂閱」標籤 + 橘色底 + 訊息顯示「→ thomas920601」，沒有金額數字。

### submysterygift — 神秘箱訂閱（大量贈送）

分類：`donation`。同一次贈送多份訂閱時，Twitch 除了逐筆送出上面的 `subgift`，還會多送一個彙總事件。

✅ 真實抓包範例（2026-08-13，緊接在上面 5 筆 `subgift` 之後）：

```json
{
  "display-name": "賴清的不乾淨",
  "login": "pkluke124",
  "msg-id": "submysterygift",
  "msg-param-mass-gift-count": "5",
  "msg-param-sender-count": "5",
  "msg-param-sub-plan": "1000",
  "msg-param-goal-current-contributions": "6206",
  "msg-param-goal-target-contributions": "7400",
  "system-msg": "賴清的不乾淨 is gifting 5 Tier 1 Subs to 羅傑's community! They've gifted a total of 5 in the channel!"
}
```

存進 `events` 表：`message` = `null`；`amount` = `String(numbOfSubs)`（這筆是 `"5"`）；`extra` = `null`。

UI 呈現：「神秘箱訂閱(大量贈送)」標籤 + 橘色底 + `+5`。**注意**：這個事件跟同一次贈送觸發的多筆 `subgift` 會同時出現在聊天記錄裡（各自一行），不是互斥關係。

### raid — 帶觀眾過來(Raid)

分類：`system`。

🔧 程式碼推導範例（尚未抓到真實 raid，欄位依 tmi.js `raided` 事件參數建構）：

```
username: "someraider", viewers: 42
```

（`raided` 事件 tmi.js 只給 `(channel, username, viewers)` 三個參數，沒有完整 tags 物件可存，所以沒有 raw JSON 可展示。）

存進 `events` 表：`message` = `null`；`amount` = `String(viewers)`；`extra` = `null`；`dedupKey` 用 `` `raid:${username}:${Math.floor(Date.now()/5000)}` ``（5 秒內同一人視為同一次事件去重，因為這個事件沒有 tmi.js 提供的訊息 id）。

UI 呈現：「帶觀眾過來(Raid)」標籤，灰色斜體行（`system` 分類），+viewers 數字。

### announcement — 公告(/announce)

分類：`system`。Twitch 原生 `/announce` 指令送出的公告，之前完全沒有監聽，訊息會整個消失（不進 SQLite）——已修正為監聽 `usernotice` 事件並依 `msgid` 分流。

✅ 真實抓包範例（2026-08-13，來自頻道的 Bot 帳號，證實是真的原生公告而非機器人自己發的一般訊息）：

```json
{
  "badges": {"moderator": "1"},
  "color": null,
  "display-name": "StreamBoostMaxBot",
  "id": "d658dd45-bf22-4f73-b38e-4faead1ec50e",
  "mod": true,
  "msg-id": "announcement",
  "msg-param-color": "ORANGE",
  "system-msg": null,
  "user-type": "mod"
}
```

存進 `events` 表：`message` = 公告內文；`amount` = `null`；`extra` = `{ msgId: 'announcement', color: tags['msg-param-color'] }`（`color` 是 Twitch 公告的顯示色，例如 `"ORANGE"`/`"PRIMARY"`/`"BLUE"` 等，demo 頁目前沒有用這個欄位上色，只存起來）。

UI 呈現：「公告(/announce)」標籤，灰色斜體行。

### usernotice_other — 其他系統通知（未分類）

分類：`system`。所有 tmi.js `usernotice` 事件裡，`msgid` 不是 `announcement` 的其他類型的統一備援分類（例如下面這個真實遇到的「watch streak」里程碑，Twitch 還會不斷新增這類 USERNOTICE 子類型，不逐一列舉，全部落到這裡）。

✅ 真實抓包範例（2026-08-13，`msg-id: "viewermilestone"`，連續觀看場次里程碑，屬於之前完全沒見過、程式碼裡也沒特別處理的類型）：

```json
{
  "display-name": "社宅匿名檢舉員",
  "login": "cyanide0731",
  "msg-id": "viewermilestone",
  "msg-param-category": "watch-streak",
  "msg-param-copoReward": "450",
  "msg-param-value": "7",
  "system-msg": "社宅匿名檢舉員 watched 7 consecutive streams and sparked a watch streak!"
}
```

存進 `events` 表：`message` = USERNOTICE 附帶訊息（可為 `null`）；`amount` = `null`；`extra` = `{ msgId: 'viewermilestone', color: null }`（`msgId` 保留原始值，方便之後想針對特定子類型另外處理時回頭查）。

UI 呈現：「其他系統通知(未分類)」標籤，灰色斜體行。

---

## YouTube

Connector：[connectors/youtube.js](../connectors/youtube.js)（`youtube-chat-next`，爬公開網頁聊天室，免 API Key）。

**已知限制**：這個套件只給得出 `superchat`/`isMembership` 布林值等有限欄位，分不出「Super Sticker vs Super Chat 的 tier」等細節，見 [labels.js](../public/labels.js) 的 `PLATFORM_DONATION_NOTES`。一般會籍留言（見下面 `chat`）仍然分不出「新加入/連續/贈禮」是哪一種；但「贈送會籍」這個動作本身（贈送方觸發、每個實際領取的人各自觸發）已經另外接上，見下面 `membership_gift`/`membership_gift_received` 兩節——這兩個不是 `ChatItem` 的欄位，是繞開套件本身解析邏輯、直接處理原始 action 才拿到的。

### chat — 一般訊息（含會籍留言）

分類：`chat`。YouTube 沒有獨立的「會籍留言」`event_type`——會籍留言仍然是 `event_type: 'chat'`，靠 `extra.isMembership` 旗標區分，不是另外分類，因為套件給的資訊不足以支撐一個獨立事件類型（沒有金額、沒有明確的「加入」時刻）。2026-08-14 之前 `message` 會被加上 `[會籍 N 個月]`/`[新加入會籍]` 這種文字前綴，使用者反應每則訊息都重複顯示太雜訊，已經拿掉——現在 `message` 就是單純的留言文字本身，跟一般聊天訊息顯示方式一致，月數/徽章資料只留在 `extra` 裡。

✅ 真實抓包範例（2026-08-13，一般會籍留言，非新加入/里程碑）：

```json
{
  "author": {
    "name": "@蕭翔澤-p4z",
    "badge": {"label": "New member", "thumbnail": {"url": "https://yt3.ggpht.com/..."}}
  },
  "message": [{"text": "我覺得踢萬值得妳第十名的喜歡！"}],
  "isMembership": true,
  "timestamp": "2026-08-13T11:41:49.728Z"
}
```

`author.badge.label` 目前見過三種格式：`"New member"` → 0 個月；`"Member (N months)"` → N 個月（237 筆真實樣本核對過）；`"Member (N year(s))"` → N×12 個月（2026-08-14 抓到一筆 `"Member (1 year)"` 才補上，YouTube 滿一年後改用「年」當單位）。由 [`parseMembershipMonths()`](../connectors/youtube.js) 解析。

存進 `events` 表：
- `message` = `` `我覺得踢萬值得妳第十名的喜歡！` ``（純文字內容，沒有任何前綴，即上面範例的 `text`）
- `amount` = `null`
- `extra` = `{ isMembership: true, membershipMonths: 0, membershipBadge: "New member", membershipHeader: null, messageParts }`（`messageParts` 就是訊息本身的表情符號交錯陣列，沒有額外塞前綴 part）

一般非會籍聊天（無表情符號）：`extra` 直接是 `null`；帶表情符號則 `extra: { messageParts }`。

UI 呈現：無類型標籤（`chat` 省略），會籍留言在畫面上**跟一般聊天訊息完全一樣**，看不出誰有會籍／第幾個月——這是使用者明確要求拿掉前綴後的結果，月數資料還在 `extra.membershipMonths`，之後如果要重新顯示（例如做成一個小徽章而不是文字前綴）可以直接從那裡取。

### superchat — Super Chat（付費醒目訊息）

分類：`donation`。`item.superchat` 有值、且 `superchat.sticker` 為空時的分類。

✅ 真實抓包範例（2026-08-13）：

```json
{
  "author": {"name": "@傻笑9487"},
  "message": [{"text": "更正 多蘭那個叫做同性緣"}],
  "superchat": {"amount": "NT$70.00", "color": "#00E5FF"}
}
```

存進 `events` 表：`message` = 純文字內容；`amount` = `"NT$70.00"`（含幣別符號的字串，不是數字，套件沒有拆開 amountMicros/currency）；`extra` = `{ color: "#00E5FF", sticker: null, messageParts }`。

UI 呈現：「Super Chat(付費醒目訊息)」標籤 + 橘色底 + `+NT$70.00`（`formatAmount()` 對非 `resub`/`subscribe` 類型的通用 `+amount` 格式，注意這裡是原始幣別字串直接接在 `+` 後面，不是重新格式化過的數字）。

**已知落差**：`item.superchat` 跟 `item.isMembership`可能同時為真（2026-08-14 真實遇到過，一位有「Member (1 year)」會籍的人發了一筆 `¥500` 的 Super Chat）——`classifyItem()` 目前優先走 `superchat` 分支直接 `return`，不會再檢查 `isMembership`，所以這種情況 `extra` 完全沒有 `membershipMonths`/`membershipBadge`，demo 頁看不出這位付費者同時有會籍。

### supersticker — Super Sticker（付費貼圖）

分類：`donation`。`item.superchat.sticker` 有值時的分類（貼圖本身沒有文字內容）。

🔧 程式碼推導範例（尚未抓到真實 Super Sticker，欄位依 `youtube-chat-next` 的 `superchat.sticker` 結構建構）：

```json
{
  "author": {"name": "@somefan"},
  "message": [],
  "superchat": {"amount": "NT$100.00", "color": "#FF6D00", "sticker": {"alt": ":some-sticker:", "url": "https://..."}}
}
```

存進 `events` 表：`message` = `null`（貼圖沒有文字，`classifyItem()` 特意不塞純文字版本）；`amount` = 金額字串；`extra` = `{ color, sticker: superchat.sticker.alt, messageParts: null }`（貼圖圖片本身目前**沒有**渲染進 `messageParts`，只存了 `alt` 文字說明，demo 頁看不到貼圖圖片，只看得到金額跟使用者名稱）。

UI 呈現：「Super Sticker(付費貼圖)」標籤 + 橘色底 + 金額，訊息內容留空。

### membership_gift — 贈送會籍（購買方）

分類：`donation`。原始 action 類型是 `liveChatSponsorshipsGiftPurchaseAnnouncementRenderer`，**不是** `ChatItem` 的欄位——`youtube-chat-next` 的 parser 完全沒有處理這種 renderer 的分支，遇到會直接回傳 `null`、整個事件被丟掉；這裡繞開套件本身的解析邏輯，在 [`patchYoutubeParser()`](../connectors/youtube.js) monkey-patch 裡直接重新掃一次原始 `actions`，把它組成一個「假的」`ChatItem`（帶 `giftPurchase: { count }` 標記）塞進 `items` 陣列，讓它跟其他事件走同一條 `classifyItem()` 路徑。一次贈送 N 份只會觸發**一個**這種事件（不是重複 N 次）。

✅ 真實抓包範例（2026-08-14，使用者「@瓢箪_400」贈送 1 份）：

```json
{
  "addChatItemAction": {
    "item": {
      "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer": {
        "id": "ChwKGkNPVFBuS3J0b0pZREZZbE1UQWdkOGhJbFVB",
        "timestampUsec": "1786735755115732",
        "authorExternalChannelId": "UCoQE7Td1ZVS8Z2bo2EJweQg",
        "header": {
          "liveChatSponsorshipsHeaderRenderer": {
            "authorName": {"simpleText": "@瓢箪_400"},
            "primaryText": {
              "runs": [
                {"text": "Sent ", "bold": true},
                {"text": "1", "bold": true},
                {"text": " ", "bold": true},
                {"text": "鈴原るる【にじさんじ所属】", "bold": true},
                {"text": " gift memberships", "bold": true}
              ]
            }
          }
        }
      }
    }
  }
}
```

`primaryText.runs` 是「Sent {count} {方案名稱} gift memberships」這種樣板文字，`count` 是獨立的一個 run（不管顯示語系怎麼變，數字本身不受語系影響）——[`extractGiftCount()`](../connectors/youtube.js) 找 `runs` 裡第一個文字內容是純數字（`/^\d+$/`）的 run，不比對樣板文字本身，跨語系應該也能用（只用一筆英文樣本驗證過，其他語系尚未實測）。`鈴原るる【にじさんじ所属】` 這段（真實樣本裡數字 run 後面、最後一個 run 前面的部分）不是頻道/社群名稱，是**會籍方案名稱**——2026-08-15 使用者截圖對照真實 YouTube 畫面（顯示「贈送了 1 個『鈴原るる【にじさんじ所属】』會籍」）確認過；[`extractGiftPlanName()`](../connectors/youtube.js) 取「數字 run 之後、最後一個 run 之前」的所有 run 文字合併，只用這一筆樣本反推位置，其他語系的樣板順序未必一樣。

存進 `events` 表：`username` = 贈送者（`header.liveChatSponsorshipsHeaderRenderer.authorName.simpleText`）；`message` = `` `「鈴原るる【にじさんじ所属】」會籍` ``（抓不到方案名稱時為 `null`）；`amount` = `String(count)`（這裡是 `"1"`，只有份數，YouTube 原始封包沒有揭露單價/總金額）；`extra` = `{ planName: "鈴原るる【にじさんじ所属】" }`（抓不到方案名稱時 `extra` 為 `null`）。

UI 呈現：「贈送會籍(購買方)」標籤 + 橘色底 + `+1` + 訊息顯示「「鈴原るる【にじさんじ所属】」會籍」。

### membership_gift_received — 贈送會籍（領取方）

分類：`donation`。原始 action 類型是 `liveChatSponsorshipsGiftRedemptionAnnouncementRenderer`，處理方式跟上面 `membership_gift` 一樣是繞開套件、直接處理原始 action。一次贈送 N 份會對應觸發 N 個這種事件，每個實際領到的人各一個，緊接在對應的 `membership_gift` 事件之後送達（這筆真實樣本相隔約 10 秒）。

✅ 真實抓包範例（2026-08-14，緊接在上面 `membership_gift` 範例之後，「@cherub1189」領取）：

```json
{
  "addChatItemAction": {
    "item": {
      "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer": {
        "id": "ChwKGkNOT013ckR0b0pZREZSZDVxd0lkeUhnd2xR",
        "timestampUsec": "1786735756347018",
        "authorExternalChannelId": "UCuQzh_trznsrVFDlLjvy9cQ",
        "authorName": {"simpleText": "@cherub1189"},
        "message": {
          "runs": [
            {"text": "received a gift membership by ", "italics": true},
            {"text": "@瓢箪_400", "bold": true, "italics": true}
          ]
        }
      }
    }
  }
}
```

跟 `membership_gift` 的結構不一樣：`authorName` 本身就是**領取者**（不是贈送者），贈送者名字要從 `message.runs` 裡挖——目前的做法是直接取最後一個 run 的文字（這筆真實樣本裡就是加粗那個 `@瓢箪_400`），只用這一筆樣本驗證過位置一定是最後一個。

存進 `events` 表：`username` = 領取者（`authorName.simpleText`）；`message` = `` `← @瓢箪_400` ``（贈送者名字，比照 Twitch `gift_item`/`subgift` 用箭頭指出對方的呈現方式）；`amount` = `null`；`extra` = `{ fromUsername: "@瓢箪_400" }`。

UI 呈現：「贈送會籍(領取方)」標籤 + 橘色底，訊息顯示「← @瓢箪_400」，沒有金額數字。

---

## SOOP

Connector：[connectors/soop.js](../connectors/soop.js)（`soop-extension`，社群模式，無官方 API）。

**已知限制**：目前只用匿名（未登入）連線，SOOP 伺服器會不定期主動斷線（見程式碼註解），且截至目前 `raw-capture.jsonl` 只捕到未知封包類型（下面的 `unknown_*`），還沒真的捕到 `chat`/`emoticon`/抖內/`subscribe` 這幾種常見事件的真實資料——**以下這幾種全部是 🔧 程式碼推導**，等真的抓到後應該回來補真實範例。

### chat — 一般訊息

分類：`chat`。

✅ 真實抓包範例（2026-08-13，來自 SQLite `events` 表，非 `raw-capture.jsonl`——一般 `chat` 沒有開 raw capture）：

```json
{ "username": "우수현S2사자", "message": "/하트//하트//하트/", "extra": { "userId": "sam96645(3)" } }
```

存進 `events` 表：`message` = `res.comment`；`amount` = `null`；`extra` = `{ userId: res.userId, messageParts }`。

**2026-08-14 發現＋接上圖片渲染（兩套目錄都接了）**：SOOP 的表情符號不是只有獨立的 `emoticon` 事件才會出現——使用者也可以在一般聊天訊息裡直接打 `/코드명/` 這種斜線包住的代碼（例如 `/하트/`、`/락/`，同一則訊息裡常常重複打好幾次），在真正的 SOOP 網頁上這些代碼會被客戶端換成圖片貼圖。SOOP 實際上有**兩套完全獨立的代碼目錄**，`connectors/soop.js` 的 [`buildEmoticonMessageParts()`](../connectors/soop.js) 會把兩套合併成同一份 `{ "/代碼/": 完整圖片網址 }` 查表：

1. **全站共用「經典表情符號」**：公開靜態 JSON，跟頻道無關，`https://res.sooplive.com/images/chat/emoticon/big/list.json`（`{ "/代碼/": "檔名.png" }`，123 筆，例如 `/하트/`→`79.png`）。
2. **主播專屬「signature emoticon」**：2026-08-14 使用者從瀏覽器開發者工具「網路」分頁找到的真實 API，要照目前連線的頻道 id 分開抓——
   `https://live.sooplive.com/api/signature_emoticon_api.php?work=list&v=tier&szBjId={streamerId}`，
   回傳 `{ result, data: { tier1, tier2 }, img_path, ... }`，每筆 `{ title, mobile_img, tier_type, move_img, ... }`，圖片網址 = `img_path + mobile_img`；`tier2` 且 `move_img==='Y'` 的是動畫（webp）——之前使用者截圖看到「`/하트뿜뿜/` 是動畫、不在經典目錄裡」，原因就是它屬於這一套，不是第三套系統。以測試頻道 `rud9281`為例，這套目錄有 44 筆，涵蓋 `/락/`、`/ㅗㅜㅑ/`、`/갱응원/` 這些之前對不上的代碼。

兩套目錄合併起來（測試頻道當下共 167 筆）之後，之前對不上的 `/ㅗㅜㅑ//락//ㅗㅜㅑ//락/` 全部四段都能正確換成圖片了，網址也 curl 驗證過真的能載入。經典目錄跟頻道無關只抓一次、整個程序共用；signature emoticon 目錄照 `channel` 設定抓，換頻道（`restartConnector()`）會重新抓。兩套都對不上的代碼（目前已知只剩 OGQ 貼圖市集那套，見下面 `emoticon` 章節）才會保留原始文字。抓不到任一目錄（離線/API 失效）就整段退回純文字，不影響聊天監聽本身。

UI 呈現：無類型標籤（`chat` 省略）；`messageParts` 有值時，認得的 `/代碼/` 片段會渲染成 `<img class="chat-emoji">`（跟 Twitch/YouTube 共用同一段 `demo.js` 渲染邏輯），不認得的代碼跟其他純文字一樣直接顯示。

### emoticon — 表情訊息

分類：`chat`。使用者只送表情符號、沒有文字內容時的獨立事件類型。

✅ 真實抓包範例（2026-08-14）：

```json
{ "userId": "trhd012q", "username": "히리언니", "emoticonId": "65863a0325db1" }
{ "userId": "enclin1004(2)", "username": "무막", "emoticonId": "6520fc16c376a" }
```

存進 `events` 表：`message` = `null`；`amount` = `null`；`extra` = `{ userId, emoticonId }`。

**2026-08-14 圖片網址研究進度**：使用者從真實 SOOP 網頁的 DOM 截出表情符號圖片標籤，找到
CDN 網址規則：`https://res.sooplive.com/images/chat/emoticon/big/{id}.webp`（`.png` 版本
同樣有效，`onerror` 會 fallback 到 `ogq_default.svg`）——curl 驗證過 `id=233`
回傳 `200 image/webp`/`200 image/png`，`id=1`、`id=999999` 回傳 `404`，證實是一份固定的
表情符號目錄，不是任意數字都成立。**但這個網址規則對不上我們實際抓到的 `emoticonId`**：
上面兩筆真實樣本的 `emoticonId` 是類似雜湊值的字串（`65863a0325db1`），curl 這兩個值一樣
回傳 `404`。

找到另一個不同語言的 SOOP 聊天協定重寫專案交叉核對後確認了原因：
[getCurrentThread/soopapi](https://github.com/getCurrentThread/soopapi)（非官方 Java 函式庫，
獨立反推同一套 WebSocket 協定，附完整協定類型代碼對照表，比這裡用的 `soop-extension` 詳細
很多）——`soop-extension` 的 `EMOTICON` 事件其實對應協定類型 `109`（`OGQ_EMOTICON`），
`emoticonId` 給的是 OGQ（一個第三方貼圖／表情符號市集，被 SOOP 整合進聊天室）的
`groupId`（雜湊格式），跟畫面上打 `/댄스2_s/` 這種內建表情符號代碼用的小整數 ID 是**完全不同的
兩套系統、不同的圖片來源**。soopapi 的文件進一步指出：真正帶圖片網址的是「贈送 OGQ 表情符號包」
事件（協定類型 `118`，`OGQ_EMOTICON_GIFT`，`soop-extension` 沒有實作，會落到 `UNKNOWN`），
它的 `ogqImageUrl` 欄位範例長這樣：`//ogq-sticker-global-cdn-z01.sooplive.com/...`——
**是完全不同的 CDN 網域**，不是 `res.sooplive.com`。也就是說一般「使用表情符號」的封包
（我們的 `emoticon` 事件）本身並不包含圖片網址，圖片網址只有在「整包贈送」的封包裡才會出現；
`emoticonId`（OGQ 的 `groupId`）本身無法單獨換成圖片網址，還需要知道對應的 `subId`/`version`
或找到 OGQ／SOOP 的圖片解析 API 才能繼續，**目前還沒有辦法把 `emoticonId` 換成正確的圖片網址，
圖片渲染還沒接上**。

**表情符號代碼 → 圖片網址對照表，兩套都找到了**（2026-08-14，完整過程見上面 `chat` 章節）：

1. 全站共用「經典表情符號」：`https://res.sooplive.com/images/chat/emoticon/big/list.json`，
   公開靜態 JSON，123 筆，例如 `/하트/`、`/최고/`、`/ㅋㅋ/`。
2. 主播專屬「signature emoticon」：`https://live.sooplive.com/api/signature_emoticon_api.php?work=list&v=tier&szBjId={streamerId}`，
   使用者從瀏覽器開發者工具「網路」分頁找到的真實 API，回傳該主播的完整表情符號清單（含
   動畫版，`tier2`/`move_img==='Y'`）；`/하트뿜뿜/`、`/갱응원/`、`/락/`、`/ㅗㅜㅑ/` 這些
   之前對不上「經典」目錄的代碼，全部都在這一套裡面（不是第三套系統，是誤以為的）。

兩套都已經接上 `connectors/soop.js`（見上面 `chat` 章節的 `buildEmoticonMessageParts()`），
但都是**針對 `chat` 事件裡打字輸入的 `/代碼/`**。獨立的 `emoticon` 事件（上面範例，`emoticonId`
是雜湊字串）**還是沒有圖片渲染**——這個事件對應 SOOP 協定裡的 `OGQ_EMOTICON`（協定類型
`109`），跟前面兩套代碼系統完全無關，是第三方 OGQ 貼圖市集：

找到另一個不同語言的 SOOP 聊天協定重寫專案交叉核對後確認了原因：
[getCurrentThread/soopapi](https://github.com/getCurrentThread/soopapi)（非官方 Java 函式庫，
獨立反推同一套 WebSocket 協定，附完整協定類型代碼對照表，比這裡用的 `soop-extension` 詳細
很多）——`emoticonId` 給的是 OGQ（第三方貼圖／表情符號市集，被 SOOP 整合進聊天室）的
`groupId`（雜湊格式）。soopapi 的文件指出：真正帶圖片網址的是「贈送 OGQ 表情符號包」事件
（協定類型 `118`，`OGQ_EMOTICON_GIFT`，`soop-extension` 沒有實作，會落到 `UNKNOWN`），它的
`ogqImageUrl` 欄位範例長這樣：`//ogq-sticker-global-cdn-z01.sooplive.com/...`——**是完全
不同的 CDN 網域**，不是 `res.sooplive.com`／`static.file.sooplive.com`。也就是說一般「使用
表情符號」的封包（我們的 `emoticon` 事件）本身並不包含圖片網址，圖片網址只有在「整包贈送」
的封包裡才會出現；`emoticonId`（OGQ 的 `groupId`）本身無法單獨換成圖片網址，**這部分依然
沒有解法**，還需要知道對應的 `subId`/`version` 或找到 OGQ／SOOP 的圖片解析 API 才能繼續。

UI 呈現：「表情訊息」標籤，`message` 是 `null`，demo 頁這行**只會顯示使用者名稱，看不到表情符號本身**——這個獨立的 `emoticon` 事件（OGQ 雜湊 ID）本身沒有解決，跟上面 `chat` 事件裡的 `/代碼/` 圖片渲染是兩回事，不要搞混。

### text_donation — 文字/語音抖內(별풍선)

分類：`donation`。

✅ 真實抓包範例（2026-08-14，同一位使用者連續送出 1～27 顆星球，這裡取其中一筆）：

```json
{ "to": "rud9281", "from": "raira8383", "fromUsername": "한갱S2굼씨", "amount": "7", "fanClubOrdinal": "0" }
```

存進 `events` 表：`message` = `null`；`amount` = `res.amount`（星球數量，字串格式的整數）；`extra` = `{ fanClubOrdinal }`（粉絲團加入順位，這筆是 `"0"`，數字越小代表越早加入）。欄位對應跟原本推導的一致，已用真實資料驗證過。

UI 呈現：「文字/語音抖內(별풍선)」標籤 + 橘色底 + `+7`。

### video_donation — 影片抖內

分類：`donation`。欄位結構與 `text_donation` 完全相同，只是抖內管道不同（伴隨影片播放的抖內），事件類型分開。

UI 呈現：同 `text_donation`，標籤文字為「影片抖內」。

### ad_balloon_donation — 廣告氣球抖內

分類：`donation`。欄位結構同上，第三種抖內管道。

✅ 真實抓包範例（2026-08-14）：

```json
{ "to": "rud9281", "from": "tpgur0910", "fromUsername": "크랙왕이상호", "amount": "1", "fanClubOrdinal": "13972" }
```

存進 `events` 表：`message` = `null`；`amount` = `res.amount`；`extra` = `{ fanClubOrdinal: "13972" }`（欄位跟 `text_donation` 一致，已用真實資料驗證正確）。

UI 呈現：同上，標籤文字為「廣告氣球抖內」。

### subscribe — 訂閱(구독)

分類：`donation`。**這個事件曾經有 bug**：`soop-extension` 的 `.d.ts` 型別宣告裡寫的欄位是 `monthCount`，但實際 `parseSubscribe()` 執行期回傳的物件裡月數欄位其實叫 `amount`——型別宣告跟實作對不起來，讀 `monthCount` 永遠是 `undefined`（使用者實測回報「訂閱2個月但顯示沒有兩個月」），已修正為讀 `res.amount`。

🔧 程式碼推導範例（依修正後的欄位對應建構）：

```
{ fromUsername: "somesubscriber", amount: 2, tier: 1 }
```

存進 `events` 表：`message` = `null`；`amount` = `res.amount`（**注意**：`amount` 這個共通欄位在這裡代表的是「月數」，不是金額——跟 `text_donation`/`video_donation` 的 `amount` 語意不同，靠 `event_type` 分辨，见下面 UI 呈現的特殊格式）；`extra` = `{ tier }`。

UI 呈現：「訂閱(구독)」標籤 + 橘色底 + **「已訂閱 2 個月」**（`formatAmount()` 對 `subscribe` 的特殊格式，跟 Twitch `resub` 共用同一段邏輯，不是 `+2`）。

**2026-08-14 交叉核對 [soopapi](https://github.com/getCurrentThread/soopapi)（另一個獨立反推同一套協定的 Java 函式庫）發現的疑點**：`soop-extension` 的 `SUBSCRIBE` 對應協定類型 `93`，但 soopapi 把 `93` 標成 `FOLLOW_ITEM_EFFECT`（「Continuous Subscription」/續訂），**真正的「New Subscription」（首次訂閱）是另一個類型 `91`（`FOLLOW_ITEM`）**——`soop-extension` 沒有處理類型 `91`，會落到 `UNKNOWN`（如果真的發生，應該會被我們的 `RAW_CAPTURE` 記成 `unknown_0091`，但目前還沒抓到過）。也就是說：**這裡的 `subscribe` 事件說不定只在「續訂」時觸發，第一次訂閱可能完全沒有被監聽到**，兩個獨立函式庫（`soop-extension`／`soopapi`）對協定類型 `93` 的定性不一致，目前無法判斷哪個對，需要真的抓到一筆「新訂閱」跟一筆「續訂」分別核對協定類型才能確認，先記錄這個疑點。

### gift_item — 贈送禮物（快播Plus/訂閱禮物券等）

分類：`donation`。**`soop-extension` 完全沒有解析這個事件類型**——它的 `ChatType` enum 沒有涵蓋道具型贈禮（跟已支援的星球/影片/廣告氣球抖內是不同的封包類型 `0045`／十進位 `45`），收到時整個內容會直接落到 `UNKNOWN` 事件、被套件丟掉。這是自己反推封包格式接上去的：

> 2026-08-13 一開始用 `CHAT_MONITOR_DEBUG` 抓包 + 比對使用者截圖（快播Plus 7天券，from 미오탱 to 정글대마법사）反推出欄位對應，只核對過送禮者/收禮者暱稱，`parts[6]`/`parts[7]` 當時意義不明。
>
> 2026-08-14 用 [getCurrentThread/soopapi](https://github.com/getCurrentThread/soopapi)（另一個獨立反推同一套協定的非官方 Java 函式庫）交叉核對：它把協定類型 `45` 命名為 `SEND_QUICK_VIEW`（「Send Quick View Gift」），對應的 `QuickViewEvent` 欄位是 `senderId`/`senderNickname`/`receiverId`/`receiverNickname`/`itemType`（整數）。這個函式庫拿到的 `parts` 陣列比這裡少一格（它已經把封包最前面的表頭拆掉，這裡的 `parts` 還留著表頭在 `[0]`），換算索引後跟原本用截圖核對過的「送禮者/收禮者暱稱」位置（`[3]`/`[5]`）完全吻合——但也發現原本把 `parts[4]` 誤標成「送禮者 userId」，其實對應的是**收禮者** userId（`senderId`/`senderNickname`、`receiverId`/`receiverNickname` 兩兩一組，送禮者 userId 其實在 `parts[2]`，原本沒有抓這個欄位）。已修正欄位對應，並補上原本「意義不明」的 `parts[6]`（`itemType`，整數的禮物種類代碼，目前不知道數字對應的道具名稱，例如快播Plus 幾天券)。

🔧 程式碼推導範例（依修正後的欄位對應建構；`raw-capture.jsonl` 裡目前沒有保留當初那筆真實樣本，因為 `RAW_CAPTURE` 功能是在那之後才做的，之後真的再抓到會補真實樣本）：

```json
["S2026...:00450012...", "12345", "9876543", "미오탱", "1122334", "정글대마법사", "101", "?"]
```

（`[1]` 疑似房間或直播編號、`[2]` 送禮者 userId、`[3]` 送禮者暱稱、`[4]` 收禮者 userId、`[5]` 收禮者暱稱、`[6]` itemType、`[7]` 意義仍不明）

存進 `events` 表：`username` = `parts[3]`（送禮者暱稱）；`message` = `` `→ ${parts[5]}` ``（`→ 收禮者`，比照 Twitch `subgift` 的呈現方式）；`amount` = `null`（禮物項目名稱本身還是沒解出來，只有數字代碼）；`extra` = `{ toUsername: parts[5], fromUserId: parts[2], toUserId: parts[4], itemType: parts[6], raw: parts }`。

UI 呈現：「贈送禮物(快播Plus/訂閱禮物券等)」標籤 + 橘色底，訊息顯示「→ 정글대마법사」，**沒有金額數字**（因為禮物項目名稱/數量沒解出來，只有不知道對應表的 `itemType` 數字代碼）。

### notification — 系統通知

分類：`system`。SOOP 平台本身推送的系統通知文字（開台公告等，沒有對應到特定使用者）。

✅ 真實抓包範例（2026-08-15，BJ 自訂的贈禮項目說明，不是開台公告，但證實 `res.notification` 欄位對應正確）：

```json
{
  "notification": "버추얼api 10개:눈덩이 ,30개:메뉴추천 , 70개:하트 ,170개:꽃에물주기 , 1021개:케이크난사\r\n",
  "receivedTime": "2026-08-15T03:52:11.357Z"
}
```

存進 `events` 表：`username` = `null`（系統通知沒有發送者）；`message` = `res.notification`；`amount` = `null`；`extra` = `null`。demo 頁確認顯示正常。

UI 呈現：「系統通知」標籤，灰色斜體行，沒有使用者名稱前綴（因為 `username` 是 `null`）。

### unknown_* — 未解析的封包類型（尚未接上事件系統，僅供除錯）

**不是**一個正式的 `event_type`，不會出現在 `events` 表或 demo 頁裡——這是 `RAW_CAPTURE` 開啟時，`SoopChatEvent.UNKNOWN` 收到、但類型代碼不是 `gift_item` 的 `0045` 時，單純寫進 `raw-capture.jsonl` 供之後研究用的原始封包片段。

**2026-08-14 用 [getCurrentThread/soopapi](https://github.com/getCurrentThread/soopapi)（另一個獨立反推同一套 SOOP 聊天 WebSocket 協定的非官方 Java 函式庫，附完整協定類型代碼對照表）交叉核對，這幾個之前完全不認識的類型代碼現在都能對上名字了**（`soop-extension` 沒有實作這些類型的 decoder，收到都會落到 `UNKNOWN`；下面每種都用真實抓到的樣本反推欄位，索引都對得上）：

| 類型代碼 | soopapi 命名 | 中文意思 | 這裡的用途 |
|---|---|---|---|
| `0012` | `SET_USER_FLAG` | 使用者旗標變更（進場資訊/等級旗標，例如 `196640\|163840` 這種 `primary\|secondary` 格式） | 最常見，之前猜是「使用者進場」廣播，方向大致對但更精確地說是旗標變更通知，跟聊天內容無關，不打算接成正式事件 |
| `0014` | `SET_NICKNAME` | 暱稱變更 | 見下方真實樣本，確認是「使用者改暱稱」通知，跟聊天內容無關 |
| `0054` | `BAN_WORD` | 主播設定的禁字清單同步 | 跟聊天內容無關，不打算接 |
| `0090` | `KICK_MSG_STATE` | 「隱藏踢人訊息」開關狀態 | 管理功能狀態，不打算接 |
| `0094` | `TRANSLATION_STATE` | 聊天室即時翻譯功能開關狀態 | 平台功能狀態，不打算接 |
| `0110` | `EMOTICON_TICKET` | 剛加入頻道時收到的握手回應（固定 `value=1`） | 內部連線流程的一部分，不是聊天事件 |

以上都跟「聊天/抖內/特殊訊息」這個工具關心的範圍無關（使用者旗標/暱稱變更、管理功能狀態、內部握手），**決定不接成正式事件類型**，維持落在 `unknown_*` 只記錄不處理即可；記在這裡純粹是把「這是什麼」搞清楚，不再是霧裡看花的未知封包。

**另外兩個只查得到名字、還沒有真實樣本**（跟上面 6 個不一樣，`.env` 裡 `CHAT_MONITOR_RAW_CAPTURE_SKIP` 原本的註解誤植成「已經對照 soopapi 查出真實身分」，2026-08-15 修正——這兩個只是查了 soopapi 的靜態代碼表對出名字，`raw-capture.jsonl` 裡從來沒有真的抓到過，欄位長怎樣完全沒驗證過）：

| 類型代碼 | soopapi 命名 | 中文意思 |
|---|---|---|
| `0008` | `SET_DUMB` | 禁言/靜音某使用者（채금） |
| `0013` | `SET_SUB_BJ` | 設定副 BJ（協同主播） |

✅ `unknown_0014`（`SET_NICKNAME`）真實抓包範例（2026-08-14），對照 `SetNicknameEvent` 欄位（`userId, newNickname, changeType, flag, oldNickname`，注意 soopapi 的 `parts` 陣列比這裡少一格，因為它已經先把封包表頭拆掉）：

```json
["...00140006600", "sam96645", "우한갱S2사자", "1", "2952871968|294912", "우수현S2사자", ""]
```

`parts[1]` = `userId`（`sam96645`，對得上同時間點聊天記錄裡「우수현S2사자」訊息的 `userId`：`sam96645(3)`）／`parts[2]` = `newNickname`（`우한갱S2사자`，改名後的新暱稱）／`parts[3]` = `changeType`（`"1"`）／`parts[4]` = `flag`（`2952871968|294912`）／`parts[5]` = `oldNickname`（`우수현S2사자`，改名前的舊暱稱——正好對得上同一場直播稍早聊天記錄裡的原本暱稱）。**完全解開了**，之前猜「跟粉絲團稱號有關」不對，是單純的改暱稱通知。

✅ `unknown_0110`（`EMOTICON_TICKET`）真實抓包範例：`["...", "1", ""]`——`parts[1] = "1"`，跟 soopapi 文件描述的「頻道加入直後收到，固定 value=1」完全吻合。

✅ `unknown_0012`（`SET_USER_FLAG`）真實抓包範例：`["...", "196640|163840", "ypj2004", "포이즌필", "0", "0", "65568|163840", ""]`——`parts[1]`=oldFlag、`parts[2]`=userId(`ypj2004`)、`parts[3]`=userNickname(`포이즌필`)、`parts[6]`=newFlag，`oldFlag`/`newFlag` 都是 `數字|數字` 格式（`soopapi` 的 `UserLevel` 型別用來解析這種格式，這裡沒有進一步解讀數字代表什麼等級）。

✅ `unknown_0054`（`BAN_WORD`）／`unknown_0090`（`KICK_MSG_STATE`）／`unknown_0094`（`TRANSLATION_STATE`）也都抓到過真實樣本，欄位結構跟 soopapi 的對應 decoder 一致，細節不逐一展開（跟聊天內容無關，不打算接成事件，有需要可以直接查 `raw-capture.jsonl`）。

---

## 已知的其他缺口

- SOOP `subscribe` 還沒抓到真實資料（`notification` 已經在 2026-08-15 抓到真實樣本，見上面對應章節），上面沒有 ✅ 標記的範例都是程式碼推導，欄位型別（尤其是 `amount` 是字串還是數字）有可能猜錯。
- SOOP `subscribe` 事件可能只在「續訂」時觸發，「新訂閱」可能是完全沒被監聽到的另一個協定類型（`0091`），見 `subscribe` 章節的說明——還沒確認。
- SOOP 一般聊天訊息裡的 `/代碼/` 表情符號（2026-08-14 已接上圖片渲染，見 `chat` 章節）涵蓋「經典」全站共用目錄（123 筆）+ 主播專屬 signature emoticon 目錄（照頻道抓，測試頻道 44 筆）兩套；獨立的 `emoticon` 事件（OGQ 雜湊 ID）仍然完全沒有圖片渲染，見 `emoticon` 章節，是目前唯一還沒解掉的表情符號缺口。
- YouTube `supersticker` 沒有真實範例，貼圖圖片本身也沒有渲染進 `messageParts`。
- YouTube 同一則訊息「既是 Super Chat 又有會籍」時，`extra` 目前不會帶會籍資訊，見 `superchat` 章節。
- Twitch `raid`／`cheer`／`resub` 沒有真實範例。
- Twitch 完全匿名模式下 cheer/sub/resub/raid 是否正常接收，只驗證過協定邏輯（tmi.js 不因認證方式改變 CAP REQ 範圍），沒有在真正匿名連線下實測收到過這幾種事件。
