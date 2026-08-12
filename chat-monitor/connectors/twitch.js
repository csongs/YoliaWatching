// Twitch 連接器——沿用 yuupeek/src/chatListener.js 的連線方式(tmi.js, IRC, TWITCH_OAUTH),
// 但這裡只負責「聽到什麼就標記類型往外送」,不呼叫 chatProcessor(demo 頁不需要幽視值)。
const tmi = require('tmi.js');

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
      onEvent({
        platform: 'twitch', eventType: 'resub',
        dedupKey: userstate?.id || `resub:${username}:${cumulativeMonths ?? streakMonths}:${Date.now()}`,
        username, message: message || null, amount: String(cumulativeMonths ?? streakMonths ?? ''),
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null, streakMonths: streakMonths ?? null },
      });
    });

    client.on('subgift', (_ch, username, _streakMonths, recipient, _methods, userstate) => {
      onEvent({
        platform: 'twitch', eventType: 'subgift',
        dedupKey: userstate?.id || `subgift:${username}:${recipient}:${Date.now()}`,
        username, message: `→ ${recipient}`, amount: null,
        receivedAt: new Date().toISOString(),
        extra: { recipient },
      });
    });

    client.on('submysterygift', (_ch, username, numbOfSubs, _methods, userstate) => {
      onEvent({
        platform: 'twitch', eventType: 'submysterygift',
        dedupKey: userstate?.id || `mysterygift:${username}:${Date.now()}`,
        username, message: null, amount: String(numbOfSubs ?? ''),
        receivedAt: new Date().toISOString(),
        extra: null,
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

    client.on('connected', () => onStatus({ connected: true, error: null }));
    client.on('disconnected', (reason) => onStatus({ connected: false, error: reason || null }));

    client.connect().catch((e) => onStatus({ connected: false, error: e.message }));
  }

  function stop() {
    client?.disconnect();
    client = null;
  }

  return { start, stop };
}

module.exports = { createTwitchConnector };
