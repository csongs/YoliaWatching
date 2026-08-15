// Twitch 連接器——沿用 yuupeek/src/chatListener.js 的連線方式(tmi.js, IRC, TWITCH_OAUTH),
// 但這裡只負責「聽到什麼就標記類型往外送」,不呼叫 chatProcessor(demo 頁不需要幽視值)。
const tmi = require('tmi.js');
const { debugLog } = require('../lib/debugLog');
const { RAW_CAPTURE, rawCapture } = require('../lib/rawCapture');

// Twitch 表情符號(emotes)的 CDN 網址是長期穩定、公開文件記載的規則(dev.twitch.tv 的
// Get Channel/Global Emotes API 回傳的圖片網址就是這個樣式),不用另外查證——
// https://static-cdn.jtvnw.net/emoticons/v2/{emote id}/default/dark/{scale}.0
const TWITCH_EMOTE_CDN = (id, scale = 2) => `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/${scale}.0`;

// tmi.js 把 IRC 的 emotes tag(格式像 "25:0-4,12-16/1902:6-10")解析成
// { "25": ["0-4","12-16"], "1902": ["6-10"] } (見 node_modules/tmi.js/lib/parser.js 的
// parseComplexTag)——位置是 UTF-16 code unit offset,跟 JS 字串的 slice() 用同一套索引,
// 不用另外轉換。沒有表情符號時 tags.emotes 是 null,回傳 null 不用建結構化版本。
function buildEmoteMessageParts(message, emotesTag) {
  if (!emotesTag) return null;
  const ranges = [];
  for (const [emoteId, positions] of Object.entries(emotesTag)) {
    if (!positions) continue;
    for (const pos of positions) {
      const [start, end] = String(pos).split('-').map(Number);
      if (Number.isFinite(start) && Number.isFinite(end)) ranges.push({ emoteId, start, end });
    }
  }
  if (ranges.length === 0) return null;
  ranges.sort((a, b) => a.start - b.start);
  const parts = [];
  let cursor = 0;
  for (const r of ranges) {
    if (r.start > cursor) parts.push({ type: 'text', text: message.slice(cursor, r.start) });
    parts.push({ type: 'emoji', url: TWITCH_EMOTE_CDN(r.emoteId), alt: message.slice(r.start, r.end + 1) });
    cursor = r.end + 1;
  }
  if (cursor < message.length) parts.push({ type: 'text', text: message.slice(cursor) });
  return parts;
}

// tags.id 是 Twitch IRC 幫每則訊息/USERNOTICE 蓋的訊息 UUID,拿來當 dedup key 最穩。
function createTwitchConnector({ channel }, onEvent, onStatus) {
  let client = null;

  function emitChat(tags, message) {
    const username = tags['display-name'] || tags.username || '';
    let eventType = 'chat';
    let amount = null;
    if (tags.bits) {
      eventType = 'cheer';
      amount = String(tags.bits);
    } else if (tags['msg-id'] === 'highlighted-message' || tags['custom-reward-id']) {
      eventType = 'chat_highlight';
    }
    // CHAT_MONITOR_RAW_CAPTURE=1 才會寫,一般聊天(eventType 還是 'chat')通常跳過,只存特殊
    // 訊息的完整原始 tags(不是我們自己挑過的欄位)——像 resub 那個 streak/cumulative 月數
    // 搞混的 bug,只看我們自己輸出的結果看不出來,得比對 Twitch 原始送來的完整 tags。
    // 例外:帶表情符號的一般聊天也記——buildEmoteMessageParts() 的位置切割邏輯目前只用
    // 手動模擬資料驗證過,沒有真實 Twitch 訊息核對過,這裡先把原始 tags.emotes 記下來,
    // 之後才能拿真實資料驗證切出來的 messageParts 對不對。
    if (RAW_CAPTURE && (eventType !== 'chat' || tags.emotes)) rawCapture('twitch', eventType !== 'chat' ? eventType : 'chat_with_emotes', tags);
    onEvent({
      platform: 'twitch',
      eventType,
      dedupKey: tags.id || `${username}:${message}:${Date.now()}`,
      username,
      message,
      amount,
      receivedAt: new Date().toISOString(),
      extra: { badges: tags.badges ?? null, color: tags.color ?? null, messageParts: buildEmoteMessageParts(message, tags.emotes) },
    });
  }

  function start() {
    if (!channel) { onStatus({ connected: false, error: '未設定 Twitch 頻道名稱' }); return; }
    // 畫面上不再提供 Token 輸入欄位(2026-08-14 拿掉)——匿名模式已經修好、能正常運作(見下面
    // identity 判斷邏輯),一般使用不需要 Token。真的需要認證連線(例如想直接驗證 cheer/sub 在
    // 已登入狀態下的行為)可以在 chat-monitor/.env 設 TWITCH_OAUTH,純粹給進階/除錯用途,
    // 不會出現在設定頁面上。
    //
    // tmi.js 真正的匿名模式需要 username 符合 justinfan##### 格式,配上它內部固定送出的特殊密碼
    // (見 node_modules/tmi.js/lib/client.js:1180 的 _.justinfan() 與 1199-1201 的
    // isJustinfan 判斷)——完全不能自己指定 username。原本沒 token 時仍然把 identity.username
    // 設成頻道名稱、password 留空,兩邊都不符合 tmi.js 判斷「這是匿名連線」的條件,變成
    // 送出沒有 PASS 的 NICK,Twitch 直接回「Improperly formatted auth」(user 實測撞到過,
    // 還連帶讓整個伺服器當機)——「留空可匿名讀取」這個功能其實從來沒有真的成立過。
    // 改成沒有 token 時完全不傳 identity,讓 tmi.js 自己產生 justinfan 使用者名稱走它內建
    // 的匿名登入流程。
    const token = process.env.TWITCH_OAUTH;
    client = new tmi.Client({
      ...(token ? { identity: { username: channel, password: token } } : {}),
      channels: [channel],
    });

    client.on('message', (_ch, tags, message) => emitChat(tags, message));

    client.on('subscription', (_ch, username, _method, message, userstate) => {
      // 2026-08-15:使用者截圖回報「新訂閱」畫面上看不出 Twitch 原文顯示的「x 3 個月」
      // （一次預先訂閱多個月,不是續訂,tag 是 msg-param-multimonth-duration,跟 resub 的
      // msg-param-cumulative-months 是不同概念)——原本完全沒讀這個欄位,amount 固定 null。
      // 用真實抓包核對過:這個 tag 只有真的一次買多個月時才會是數字字串(例如 "3"),一般單月
      // 新訂閱這個 tag 在 tmi.js 解析後會變成 boolean(true/false,不是數字字串)——只在確定是
      // 合法數字字串時才當作月數,其餘一律當沒有,避免把 true/false 誤判成月數。
      const multimonthRaw = userstate?.['msg-param-multimonth-duration'];
      const multimonthDuration = typeof multimonthRaw === 'string' && /^\d+$/.test(multimonthRaw) ? Number(multimonthRaw) : null;
      if (RAW_CAPTURE) rawCapture('twitch', 'sub', userstate);
      onEvent({
        platform: 'twitch', eventType: 'sub',
        dedupKey: userstate?.id || `sub:${username}:${Date.now()}`,
        username, message: message || null, amount: multimonthDuration != null ? String(multimonthDuration) : null,
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null, multimonthDuration },
      });
    });

    client.on('resub', (_ch, username, streakMonths, message, userstate) => {
      // tmi.js 把 msg-param-streak-months(連續訂閱月數)當成 months 參數傳出來,不是累積訂閱
      // 月數——使用者可以在 Twitch 選擇不分享連續訂閱紀錄,這種情況 streak-months 會是 0,但
      // Twitch 自己畫面上顯示的月數(例如「進入第 2 個月了」)其實是 msg-param-cumulative-months
      // 這個 tag,tmi.js 沒有把它當獨立參數傳出來(見 node_modules/tmi.js/lib/client.js:699 只取
      // streak-months),得自己從 userstate(完整 tags)裡讀,不能信 streakMonths 這個參數
      // (user 實測回報顯示成「續訂 0 個月」,截圖對比 Twitch 原文正確數字是 2)。
      const cumulativeMonths = userstate?.['msg-param-cumulative-months'];
      // 2026-08-15:續訂當下也可能順便一次預先付好幾個月(跟 sub 的 msg-param-multimonth-duration
      // 是同一個 tag、同一種情況,真實抓包核對過——同一筆 resub 裡 cumulative-months="2"、
      // multimonth-duration="6",代表這次續訂累積滿 2 個月,但一次付了 6 個月)。這裡累積月數
      // (amount)已經有在讀,額外把預先月數放進 extra,不覆蓋 amount——兩個是不同的數字,不能
      // 互相取代。跟 sub 一樣的型別檢查:只有真的是數字字串才當月數,tmi.js 解析後不適用時會是
      // boolean。
      const multimonthRaw = userstate?.['msg-param-multimonth-duration'];
      const multimonthDuration = typeof multimonthRaw === 'string' && /^\d+$/.test(multimonthRaw) ? Number(multimonthRaw) : null;
      if (RAW_CAPTURE) rawCapture('twitch', 'resub', userstate);
      onEvent({
        platform: 'twitch', eventType: 'resub',
        dedupKey: userstate?.id || `resub:${username}:${cumulativeMonths ?? streakMonths}:${Date.now()}`,
        username, message: message || null, amount: String(cumulativeMonths ?? streakMonths ?? ''),
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null, streakMonths: streakMonths ?? null, multimonthDuration },
      });
    });

    client.on('subgift', (_ch, username, _streakMonths, recipient, _methods, userstate) => {
      if (RAW_CAPTURE) rawCapture('twitch', 'subgift', userstate);
      onEvent({
        platform: 'twitch', eventType: 'subgift',
        dedupKey: userstate?.id || `subgift:${username}:${recipient}:${Date.now()}`,
        username, message: `→ ${recipient}`, amount: null,
        receivedAt: new Date().toISOString(),
        extra: { recipient },
      });
    });

    client.on('submysterygift', (_ch, username, numbOfSubs, _methods, userstate) => {
      if (RAW_CAPTURE) rawCapture('twitch', 'submysterygift', userstate);
      onEvent({
        platform: 'twitch', eventType: 'submysterygift',
        dedupKey: userstate?.id || `mysterygift:${username}:${Date.now()}`,
        username, message: null, amount: String(numbOfSubs ?? ''),
        receivedAt: new Date().toISOString(),
        extra: null,
      });
    });

    // tmi.js 對沒特別處理的 USERNOTICE 類型(例如 Twitch 原生的 /announce 公告)一律丟進這個
    // 統一備援事件(見 node_modules/tmi.js/lib/client.js 693-712 的 switch default),原本
    // 完全沒監聽,這種訊息會直接消失、連 SQLite 都不會寫進去(不是分類錯誤,是整個漏接)。
    // msgid === 'announcement' 才是真的原生公告,其他不認識的 msgid 先歸類成 usernotice_other,
    // extra.msgId 留著原始值方便之後回頭查是什麼。
    client.on('usernotice', (msgid, _ch, tags, msg) => {
      const username = tags?.['display-name'] || tags?.['login'] || '';
      if (RAW_CAPTURE) rawCapture('twitch', `usernotice_${msgid}`, tags);
      onEvent({
        platform: 'twitch',
        eventType: msgid === 'announcement' ? 'announcement' : 'usernotice_other',
        dedupKey: tags?.id || `usernotice:${msgid}:${username}:${Date.now()}`,
        username, message: msg || null, amount: null,
        receivedAt: new Date().toISOString(),
        extra: { msgId: msgid, color: tags?.['msg-param-color'] ?? null },
      });
    });

    client.on('raided', (_ch, username, viewers) => {
      onEvent({
        platform: 'twitch', eventType: 'raid',
        dedupKey: `raid:${username}:${Math.floor(Date.now() / 5000)}`,
        username, message: null, amount: String(viewers ?? ''),
        receivedAt: new Date().toISOString(),
        extra: null,
      });
    });

    // 之前只有 SOOP 有連線層級的 debugLog(連上/斷線/錯誤),Twitch/YouTube 完全沒有,
    // 三平台的除錯能見度不對稱(user 發現的落差)——這裡補齊,跟 soop.js 同樣的詳細程度。
    client.on('connected', () => { debugLog('twitch', 'connected'); onStatus({ connected: true, error: null }); });
    client.on('disconnected', (reason) => { debugLog('twitch', 'disconnected', { reason: reason || null }); onStatus({ connected: false, error: reason || null }); });
    // tmi.js 預設會自己重連(見 node_modules/tmi.js/lib/client.js 的 reconnect 選項),不像
    // SOOP/YouTube 連接器要自己排程重試,但重連當下值得記錄,方便比對是不是跟 SOOP 一樣
    // 頻繁斷線。
    client.on('reconnect', () => debugLog('twitch', 'reconnecting'));

    client.connect().catch((e) => {
      debugLog('twitch', 'connect() threw', { message: e.message });
      onStatus({ connected: false, error: e.message });
    });
  }

  function stop() {
    // tmi.js 的 disconnect() 回傳 Promise,連線已經在關閉中(例如剛因為 auth 失敗被伺服器踢掉)
    // 又呼叫一次會 reject(「Cannot disconnect from server. Socket is not opened or connection
    // is already closing.」)——原本沒接 .catch(),變成未處理的 rejection,Node 預設行為是直接
    // 讓整個程序當掉(不只 Twitch,YouTube/SOOP 一起死,user 實測回報過整個 server 崩潰)。
    client?.disconnect().catch((e) => debugLog('twitch', 'disconnect() threw', { message: e?.message }));
    client = null;
  }

  return { start, stop };
}

module.exports = { createTwitchConnector };
