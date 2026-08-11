// SOOP 連接器——社群模式(apiMode:'community')使用 soop-extension(跟 yuupeek/src/chatListener.js
// 同一顆套件),但這裡把它已經有實作、production 版沒接的事件全部攤開:表情/文字抖內/影片抖內/
// 廣告氣球抖內/訂閱/系統通知(soop-extension/dist/chat/event.d.ts 裡列的事件清單)。
// 官方模式(apiMode:'official')跟 chatListener.js 現況一致——尚未實作,直接回報原因。
const RETRY_INTERVAL_MS = 30_000; // 主播還沒開台時多久查一次(跟 youtube connector 的 RETRY_INTERVAL_MS 同數量級)

// soop-extension 的事件物件沒有唯一 id 欄位,dedup key 用「事件類型+收到時間+使用者+內容」組出來
// (同一次連線內幾乎不可能撞相同的四元組;reconnect 不會重送歷史,所以夠用)。
function dedupKeyFor(type, res) {
  const who = res.username ?? res.fromUsername ?? '';
  const what = res.comment ?? res.amount ?? res.notification ?? res.emoticonId ?? '';
  return `${type}:${res.receivedTime ?? ''}:${who}:${what}`;
}

function createSoopConnector({ channel, apiMode = 'community' }, onEvent, onStatus) {
  let soopChat = null;
  let stopped = true;
  let timer = null;
  let SoopClientCtor = null;
  let SoopChatEvent = null;

  // 「主播目前沒開台」是已知且很常見的狀態,不是異常——soop-extension 的 connect() 在這種情況下
  // 會自己 throw + console.error 一份完整 stack trace(它内部 errorHandling() 的固定行為,見
  // node_modules/soop-extension/dist/chat/chat.js:326-330,我們無法從外部關掉那個 log)。
  // 用 client.live.detail() 自己先查一次直播狀態,已知的「未開台」直接走乾淨的狀態訊息 + 排程重試,
  // 完全不呼叫 connect(),就不會觸發那段 log;真的遇到非預期錯誤才落到下面的 try/catch。
  async function isLive(client) {
    const detail = await client.live.detail(channel);
    return detail?.CHANNEL?.RESULT !== 0;
  }

  async function attempt() {
    if (stopped) return;
    try {
      const client = new SoopClientCtor();
      if (!(await isLive(client))) {
        onStatus({ connected: false, error: '目前未開台（尚未偵測到直播）' });
        timer = setTimeout(attempt, RETRY_INTERVAL_MS);
        return;
      }

      soopChat = client.chat({ streamerId: channel });

      const emit = (type, res, fields) => onEvent({
        platform: 'soop', sourceDetail: 'community', eventType: type,
        dedupKey: dedupKeyFor(type, res),
        receivedAt: res.receivedTime || new Date().toISOString(),
        ...fields,
      });

      soopChat.on(SoopChatEvent.CHAT, (res) => emit('chat', res, {
        username: res.username, message: res.comment, amount: null, extra: { userId: res.userId },
      }));
      soopChat.on(SoopChatEvent.EMOTICON, (res) => emit('emoticon', res, {
        username: res.username, message: null, amount: null, extra: { userId: res.userId, emoticonId: res.emoticonId },
      }));
      soopChat.on(SoopChatEvent.TEXT_DONATION, (res) => emit('text_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      soopChat.on(SoopChatEvent.VIDEO_DONATION, (res) => emit('video_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      soopChat.on(SoopChatEvent.AD_BALLOON_DONATION, (res) => emit('ad_balloon_donation', res, {
        username: res.fromUsername, message: null, amount: res.amount, extra: { fanClubOrdinal: res.fanClubOrdinal },
      }));
      soopChat.on(SoopChatEvent.SUBSCRIBE, (res) => emit('subscribe', res, {
        username: res.fromUsername, message: null, amount: res.monthCount, extra: { tier: res.tier },
      }));
      soopChat.on(SoopChatEvent.NOTIFICATION, (res) => emit('notification', res, {
        username: null, message: res.notification, amount: null, extra: null,
      }));

      soopChat.on(SoopChatEvent.CONNECT, () => onStatus({ connected: true, error: null }));
      soopChat.on(SoopChatEvent.DISCONNECT, () => {
        // 直播結束是預期中的事件(soop-extension 正常 emit,不是錯誤路徑),回到輪詢下一場開台。
        onStatus({ connected: false, error: null });
        soopChat = null;
        if (!stopped) timer = setTimeout(attempt, RETRY_INTERVAL_MS);
      });

      await soopChat.connect();
    } catch (e) {
      // 這裡才是真的沒預期到的狀況(網路錯誤等)——soop-extension 仍會自己印一份 log,
      // 我們額外把訊息餵進 status API 讓 demo 頁看得到乾淨版本。
      onStatus({ connected: false, error: e.message });
      soopChat = null;
      if (!stopped) timer = setTimeout(attempt, RETRY_INTERVAL_MS);
    }
  }

  async function start() {
    stopped = false;
    if (apiMode === 'official') {
      onStatus({ connected: false, error: '官方 API 模式尚未實作，請改用社群模式' });
      return;
    }
    if (!channel) { onStatus({ connected: false, error: '未設定 SOOP 主播 ID(streamerId)' }); return; }

    if (!SoopClientCtor) {
      const mod = await import('soop-extension');
      SoopClientCtor = mod.SoopClient;
      SoopChatEvent = mod.SoopChatEvent;
    }
    attempt();
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
    soopChat = null; // soop-extension 未提供 disconnect() API;停止監聽靠不再接收事件(下次 start 會建立新 client)
  }

  return { start, stop };
}

module.exports = { createSoopConnector };
