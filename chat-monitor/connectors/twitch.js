// Twitch 連接器——沿用 yuupeek/src/chatListener.js 的連線方式(tmi.js, IRC, TWITCH_OAUTH),
// 但這裡只負責「聽到什麼就標記類型往外送」,不呼叫 chatProcessor(demo 頁不需要幽視值)。
const tmi = require('tmi.js');
const { debugLog } = require('../lib/debugLog');
const { RAW_CAPTURE, rawCapture } = require('../lib/rawCapture');

// tags.id 是 Twitch IRC 幫每則訊息/USERNOTICE 蓋的訊息 UUID,拿來當 dedup key 最穩。
function createTwitchConnector({ channel, oauthToken }, onEvent, onStatus) {
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
    // CHAT_MONITOR_RAW_CAPTURE=1 才會寫,一般聊天(eventType 還是 'chat')跳過,只存特殊訊息的
    // 完整原始 tags(不是我們自己挑過的欄位)——像 resub 那個 streak/cumulative 月數搞混的 bug,
    // 只看我們自己輸出的結果看不出來,得比對 Twitch 原始送來的完整 tags。
    if (RAW_CAPTURE && eventType !== 'chat') rawCapture('twitch', eventType, tags);
    onEvent({
      platform: 'twitch',
      eventType,
      dedupKey: tags.id || `${username}:${message}:${Date.now()}`,
      username,
      message,
      amount,
      receivedAt: new Date().toISOString(),
      extra: { badges: tags.badges ?? null, color: tags.color ?? null },
    });
  }

  function start() {
    if (!channel) { onStatus({ connected: false, error: '未設定 Twitch 頻道名稱' }); return; }
    client = new tmi.Client({
      identity: { username: channel, password: oauthToken || process.env.TWITCH_OAUTH },
      channels: [channel],
    });

    client.on('message', (_ch, tags, message) => emitChat(tags, message));

    client.on('subscription', (_ch, username, _method, message, userstate) => {
      if (RAW_CAPTURE) rawCapture('twitch', 'sub', userstate);
      onEvent({
        platform: 'twitch', eventType: 'sub',
        dedupKey: userstate?.id || `sub:${username}:${Date.now()}`,
        username, message: message || null, amount: null,
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null },
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
      if (RAW_CAPTURE) rawCapture('twitch', 'resub', userstate);
      onEvent({
        platform: 'twitch', eventType: 'resub',
        dedupKey: userstate?.id || `resub:${username}:${cumulativeMonths ?? streakMonths}:${Date.now()}`,
        username, message: message || null, amount: String(cumulativeMonths ?? streakMonths ?? ''),
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null, streakMonths: streakMonths ?? null },
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
