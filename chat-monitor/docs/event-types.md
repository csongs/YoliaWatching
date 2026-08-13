# 事件類型對照表：raw data → event_type → UI 呈現

給要分析/擴充 chat-monitor 的人看的參考筆記：三個平台每一種事件，原始資料長怎樣、
被分類成哪個 `event_type`、以及在 demo 頁面怎麼顯示。

## 怎麼看這份文件

- 每個事件都標了資料來源：
  - **✅ 真實抓包**：從 `data/raw-capture.jsonl`（`CHAT_MONITOR_RAW_CAPTURE=1` 存下的真實事件）複製，只刪掉不影響結構的個資（頻道 ID 等不影響閱讀的留著方便核對）。
  - **🔧 程式碼推導**：目前還沒抓到真實樣本，根據 connector 程式碼的欄位對應手動建構，**未經真實資料驗證**，欄位型別/格式可能跟真實情況有出入。
  - 兩種都會標抓包/撰寫日期。清單以 2026-08-13 的 `raw-capture.jsonl`（約 330 行）為準，之後跑久了應該會補到更多真實樣本，尤其是 SOOP 的抖內/訂閱類事件。
- 各事件類型的驗證狀態總表在 [README.md](../README.md#各事件類型驗證狀態2026-08-13)，這份文件是它的細節版（附實際 raw data）。

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
- **時間戳**：一律同色（`.time`），要不要顯示由工具列「顯示時間戳」勾選框整批切換（CSS class，不重繪）。

---

## Twitch

Connector：[connectors/twitch.js](../connectors/twitch.js)（`tmi.js`，IRC）。

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

存進 `events` 表：`message` = USERNOTICE 附帶的留言（可為 `null`）；`amount` = `null`（新訂閱沒有月數概念）；`extra` = `{ plan: tags['msg-param-sub-plan'] }`（`"Prime"` 或 tier 數字字串 `"1000"`/`"2000"`/`"3000"`）。

UI 呈現：「新訂閱」標籤 + 橘色底，因為 `amount` 是 `null` 所以不顯示金額數字。

### resub — 續訂

分類：`donation`。**這個事件曾經有 bug**：tmi.js 把 `msg-param-streak-months`（連續訂閱月數，使用者可關閉分享則為 0）當成事件的 `months` 參數傳出來，但畫面上該顯示的其實是 `msg-param-cumulative-months`（累積總月數）——已修正為直接讀完整 tags 裡的 `msg-param-cumulative-months`，`streakMonths` 只留在 `extra` 當參考。

🔧 程式碼推導範例（2026-08-13 撰寫；目前 `raw-capture.jsonl` 尚未捕到真實 resub，欄位依 Twitch USERNOTICE 慣例 + 前述 bug 修正邏輯建構）：

```json
{
  "display-name": "SomeResubber",
  "login": "someresubber",
  "msg-id": "resub",
  "msg-param-cumulative-months": "5",
  "msg-param-streak-months": "0",
  "msg-param-should-share-streak": false,
  "msg-param-sub-plan": "1000",
  "system-msg": "SomeResubber subscribed for 5 months!",
  "user-id": "987654321"
}
```

存進 `events` 表：`message` = 續訂留言（可為 `null`）；`amount` = `String(cumulativeMonths ?? streakMonths ?? '')`；`extra` = `{ plan, streakMonths }`。

UI 呈現：「續訂」標籤 + 橘色底 + **「已訂閱 5 個月」**（`formatAmount()` 對 `resub` 的特殊格式，不是 `+5`）。

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

### raid — 突襲(Raid)

分類：`system`。

🔧 程式碼推導範例（尚未抓到真實 raid，欄位依 tmi.js `raided` 事件參數建構）：

```
username: "someraider", viewers: 42
```

（`raided` 事件 tmi.js 只給 `(channel, username, viewers)` 三個參數，沒有完整 tags 物件可存，所以沒有 raw JSON 可展示。）

存進 `events` 表：`message` = `null`；`amount` = `String(viewers)`；`extra` = `null`；`dedupKey` 用 `` `raid:${username}:${Math.floor(Date.now()/5000)}` ``（5 秒內同一人視為同一次事件去重，因為這個事件沒有 tmi.js 提供的訊息 id）。

UI 呈現：「突襲(Raid)」標籤，灰色斜體行（`system` 分類），+viewers 數字。

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

**已知限制**：這個套件只給得出 `superchat`/`isMembership` 布林值等有限欄位，分不出官方 API 才有的「新加入/連續/贈禮會員」「Super Sticker vs Super Chat 的 tier」等細節，見 [labels.js](../public/labels.js) 的 `PLATFORM_DONATION_NOTES`。

### chat — 一般訊息（含會員留言）

分類：`chat`。YouTube 沒有獨立的「會員留言」`event_type`——會員留言仍然是 `event_type: 'chat'`，靠 `extra.isMembership` 旗標與 `message` 前綴的 `[會員 N 個月]`/`[新加入會員]` 標記區分，不是另外分類，因為套件給的資訊不足以支撐一個獨立事件類型（沒有金額、沒有明確的「加入」時刻）。

✅ 真實抓包範例（2026-08-13，一般會員留言，非新加入/里程碑）：

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
- `message` = `` `[新加入會員] 我覺得踢萬值得妳第十名的喜歡！` ``（月數文字前綴 + 純文字內容，`displayMessage`）
- `amount` = `null`
- `extra` = `{ isMembership: true, membershipMonths: 0, membershipBadge: "New member", membershipHeader: null, messageParts }`；`messageParts` 若訊息帶表情符號，前綴文字也會被塞進陣列第一個 `{type:'text'}` 元素，跟 `message` 顯示一致。

一般非會員聊天（無表情符號）：`extra` 直接是 `null`；帶表情符號則 `extra: { messageParts }`。

UI 呈現：無類型標籤（`chat` 省略）；月數前綴直接印在訊息文字裡（不是獨立的 UI 元素），例如「**蕭翔澤-p4z** [新加入會員] 我覺得...」。

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

**已知落差**：`item.superchat` 跟 `item.isMembership`可能同時為真（2026-08-14 真實遇到過，一位「Member (1 year)」的會員發了一筆 `¥500` 的 Super Chat）——`classifyItem()` 目前優先走 `superchat` 分支直接 `return`，不會再檢查 `isMembership`，所以這種情況 `extra` 完全沒有 `membershipMonths`/`membershipBadge`，demo 頁看不出這位付費者同時是會員。

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

存進 `events` 表：`message` = `res.comment`；`amount` = `null`；`extra` = `{ userId: res.userId }`。

**2026-08-14 發現**：SOOP 的表情符號不是只有獨立的 `emoticon` 事件才會出現——使用者也可以在一般聊天訊息裡直接打 `/코드명/` 這種斜線包住的代碼（例如 `/하트/`、`/하트뿜뿜/`，同一則訊息裡常常重複打好幾次），在真正的 SOOP 網頁上這些代碼會被客戶端換成圖片貼圖，但我們的 `res.comment` 拿到的還是原始文字代碼，不是圖片。跟獨立的 `emoticon` 事件（`emoticonId` 是數字/雜湊 ID）不是同一套 ID 系統——這批是人類可讀的中文/韓文代碼字串，說不定比 `emoticonId` 更有機會反查到官方素材路徑，但目前還沒去查。

UI 呈現：無類型標籤（`chat` 省略）。**注意**：SOOP 一般聊天目前沒有表情符號圖片渲染（`extra` 沒有 `messageParts`），因為沒找到 SOOP 表情符號的公開圖片網址規則（見 README 已知限制），跟 Twitch/YouTube 不同——上面這種 `/코드/` 訊息目前就是照樣顯示斜線包住的原始文字，不會變成愛心圖片。

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
回傳 `404`。推測 SOOP 有至少兩套表情符號 ID 系統——內建表情符號用小整數 ID（`233` 這種,
`onerror` fallback 到的 `ogq_default.svg` 暗示另一套可能是 OGQ 這個第三方貼圖市集的雜湊
ID），`soop-extension` 的 `SoopChatEvent.EMOTICON`（協定類型 `0109`,見
`parseEmoticon()`)給的剛好是雜湊 ID 那一套,不是能直接套用上面網址規則的小整數 ID。
**目前還沒有辦法把 `emoticonId` 換成正確的圖片網址,圖片渲染還沒接上**,需要再找到
雜湊 ID 系統的網址規則(或 OGQ 的圖片解析方式)才能繼續。

已確認的內建表情符號代碼 → 小整數 ID 對照（使用者從真實 DOM 截圖比對出來的，目前只有這一組）：
`/댄스2_s/` → `233`。`/응원3_s/`、`/응원5_s/`、`/축하해_s/` 這幾個也在真實聊天室看過對應的圖示，
但還沒有確認實際的數字 ID（螢幕截圖看得到圖案，但抓不到 `<img src>` 的實際數值）。內建表情符號
應該有一份完整的代碼→ID 對照表存在 SOOP 網頁前端某處（manifest JSON 或類似的靜態資源），
比一個一個從瀏覽器 DOM 挖數字更有效率，但目前還沒找到，也還沒去找——不確定的東西不亂猜/亂試
（大量嘗試數字 ID 對第三方 CDN 送請求也不禮貌）。

UI 呈現：「表情訊息」標籤，`message` 是 `null`，demo 頁這行**只會顯示使用者名稱，看不到表情符號本身**（原因見上，不是還沒接的小事，是目前抓到的 ID 系統跟已知網址規則對不起來）。

### text_donation — 文字/語音抖內(별풍선)

分類：`donation`。

🔧 程式碼推導範例：

```
{ fromUsername: "somedonor", amount: "10", fanClubOrdinal: 3 }
```

存進 `events` 表：`message` = `null`；`amount` = `res.amount`（星球數量字串）；`extra` = `{ fanClubOrdinal }`（粉絲團加入順位，數字越小代表越早加入）。

UI 呈現：「文字/語音抖內(별풍선)」標籤 + 橘色底 + `+10`。

### video_donation — 影片抖內

分類：`donation`。欄位結構與 `text_donation` 完全相同，只是抖內管道不同（伴隨影片播放的抖內），事件類型分開。

UI 呈現：同 `text_donation`，標籤文字為「影片抖內」。

### ad_balloon_donation — 廣告氣球抖內

分類：`donation`。欄位結構同上，第三種抖內管道。

UI 呈現：同上，標籤文字為「廣告氣球抖內」。

### subscribe — 訂閱(구독)

分類：`donation`。**這個事件曾經有 bug**：`soop-extension` 的 `.d.ts` 型別宣告裡寫的欄位是 `monthCount`，但實際 `parseSubscribe()` 執行期回傳的物件裡月數欄位其實叫 `amount`——型別宣告跟實作對不起來，讀 `monthCount` 永遠是 `undefined`（使用者實測回報「訂閱2個月但顯示沒有兩個月」），已修正為讀 `res.amount`。

🔧 程式碼推導範例（依修正後的欄位對應建構）：

```
{ fromUsername: "somesubscriber", amount: 2, tier: 1 }
```

存進 `events` 表：`message` = `null`；`amount` = `res.amount`（**注意**：`amount` 這個共通欄位在這裡代表的是「月數」，不是金額——跟 `text_donation`/`video_donation` 的 `amount` 語意不同，靠 `event_type` 分辨，见下面 UI 呈現的特殊格式）；`extra` = `{ tier }`。

UI 呈現：「訂閱(구독)」標籤 + 橘色底 + **「已訂閱 2 個月」**（`formatAmount()` 對 `subscribe` 的特殊格式，跟 Twitch `resub` 共用同一段邏輯，不是 `+2`）。

### gift_item — 贈送禮物（快播Plus/訂閱禮物券等）

分類：`donation`。**`soop-extension` 完全沒有解析這個事件類型**——它的 `ChatType` enum 沒有涵蓋道具型贈禮（跟已支援的星球/影片/廣告氣球抖內是不同的封包類型 `0045`），收到時整個內容會直接落到 `UNKNOWN` 事件、被套件丟掉。這是自己反推封包格式接上去的：

> 2026-08-13 用 `CHAT_MONITOR_DEBUG` 抓包 + 比對使用者截圖（快播Plus 7天券，from 미오탱 to 정글대마법사）反推出來的欄位對應——**只有這一筆真實樣本核對過**，沒有官方文件，`parts[6]`/`parts[7]` 意義不明（可能是禮物項目/數量代碼），所以完整原始欄位陣列會存進 `extra.raw`，之後想重新解讀還查得到。

🔧 程式碼推導範例（依上述反推邏輯建構的 `parts` 陣列結構，欄位順序如程式碼註解所述；`raw-capture.jsonl` 裡目前沒有保留當初那筆真實樣本，因為 RAW_CAPTURE 功能是在那之後才做的）：

```json
["S2026...:00450012...", "12345", "streamerId", "미오탱", "9876543", "정글대마법사", "?", "?"]
```

存進 `events` 表：`username` = `parts[3]`（送禮者）；`message` = `` `→ ${parts[5]}` ``（`→ 收禮者`，比照 Twitch `subgift` 的呈現方式）；`amount` = `null`（禮物項目名稱/數量沒解出來）；`extra` = `{ toUsername: parts[5], fromUserId: parts[4], raw: parts }`。

UI 呈現：「贈送禮物(快播Plus/訂閱禮物券等)」標籤 + 橘色底，訊息顯示「→ 정글대마법사」，**沒有金額數字**（因為 `amount` 欄位還沒解出來）。

### notification — 系統通知

分類：`system`。SOOP 平台本身推送的系統通知文字（開台公告等，沒有對應到特定使用者）。

🔧 程式碼推導範例：

```
{ notification: "방송이 시작되었습니다" }
```

存進 `events` 表：`username` = `null`（系統通知沒有發送者）；`message` = `res.notification`；`amount` = `null`；`extra` = `null`。

UI 呈現：「系統通知」標籤，灰色斜體行，沒有使用者名稱前綴（因為 `username` 是 `null`）。

### unknown_* — 未解析的封包類型（尚未接上事件系統，僅供除錯）

**不是**一個正式的 `event_type`，不會出現在 `events` 表或 demo 頁裡——這是 `RAW_CAPTURE` 開啟時，`SoopChatEvent.UNKNOWN` 收到、但類型代碼不是 `gift_item` 的 `0045` 時，單純寫進 `raw-capture.jsonl` 供之後研究用的原始封包片段。目前已經抓到但還沒解出來的類型代碼：`0012`（最常見，疑似「使用者進入聊天室」廣播）／`0014`（2026-08-14 新發現，見下面樣本）／`0054`／`0090`／`0094`／`0110`（各自的欄位含義都還不知道，`raw-capture.jsonl` 裡有完整 `parts` 陣列可查）。

✅ `unknown_0014` 真實抓包範例（2026-08-14）：

```json
["...00140006600", "sam96645", "우한갱S2사자", "1", "2952871968|294912", "우수현S2사자", ""]
```

`parts[1]`（`sam96645`）跟 `parts[5]`（`우수현S2사자`）分別對得上同時間點聊天記錄裡「우수현S2사자」訊息的 `userId`（`sam96645(3)`）與暱稱——`parts[2]`（`우한갱S2사자`）是另一個不同的暱稱，猜測跟粉絲團/應援團的稱號或暱稱異動有關，但只有這一筆樣本，還不確定。

---

## 已知的其他缺口

- SOOP `chat`/`emoticon`/三種抖內/`subscribe`/`notification` 都還沒抓到真實資料，上面的範例全部是程式碼推導，欄位型別（尤其是 `amount` 是字串還是數字）有可能猜錯。
- SOOP 表情符號沒有實作圖片渲染（`messageParts`），因為沒找到公開的圖片網址規則。
- YouTube `supersticker` 沒有真實範例，貼圖圖片本身也沒有渲染進 `messageParts`。
- Twitch `raid`／`cheer`／`resub` 沒有真實範例。
- Twitch 完全匿名模式下 cheer/sub/resub/raid 是否正常接收，只驗證過協定邏輯（tmi.js 不因認證方式改變 CAP REQ 範圍），沒有在真正匿名連線下實測收到過這幾種事件。
