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

    client.on('resub', (_ch, username, months, message, userstate) => {
      onEvent({
        platform: 'twitch', eventType: 'resub',
        dedupKey: userstate?.id || `resub:${username}:${months}:${Date.now()}`,
        username, message: message || null, amount: String(months ?? ''),
        receivedAt: new Date().toISOString(),
        extra: { plan: userstate?.['msg-param-sub-plan'] ?? null },
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
