// YouTube 連接器——改用 youtube-chat-next(github.com/LucasSantana-Dev/youtube-chat-next)這個
// 免 API Key 的公開網頁聊天室爬蟲套件,取代先前的 googleapis 官方 API 做法(search.list 每日只有
// 100 次配額,逼得未開播時要 15 分鐘才查一次;見已刪除的 lib/youtubePollPolicy.js)。換套件後
// YouTube 分頁不再需要填 API Key,只要 handle 或頻道 ID。
//
// 代價(2026-08-12 查證,youtube-chat-next 3.1.0 型別定義):官方 API 能把付費/會員事件細分成
// superChatEvent / superStickerEvent / newSponsorEvent / memberMilestoneChatEvent /
// membershipGiftingEvent / giftMembershipReceivedEvent 六種,這個套件是爬公開網頁聊天室,ChatItem
// 只給 superchat?:{amount,color,sticker?} 與 isMembership:boolean 兩個欄位,沒有 tier 數字也分不出
// 「新加入/連續/贈禮」——因此這裡只留 chat(一般會員留言會多帶 extra.isMembership)、superchat、
// supersticker 三種事件,不再產生 membership_new/_milestone/_gift/_gift_received。
const { LiveChat, NotLiveError } = require('youtube-chat-next');

const NOT_LIVE_RETRY_MS = 30_000; // 套件的 start() 失敗或 loop 結束後不會自動重試,連接器自己排下一次嘗試

function createYoutubeConnector({ channel }, onEvent, onStatus) {
  let stopped = true;
  let liveChat = null;
  let retryTimer = null;

  function messageToText(message) {
    return (message ?? []).map((m) => ('text' in m ? m.text : m.emojiText || m.alt || '')).join('');
  }

  // superchat.sticker 有值代表是 Super Sticker,否則是文字 Super Chat——套件把兩者合併成同一個
  // 欄位,跟官方 API 分成 superChatEvent/superStickerEvent 兩種事件不同。
  function classifyItem(item) {
    const username = item.author?.name ?? '';
    const base = { username, receivedAt: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString() };
    const text = messageToText(item.message);

    if (item.superchat) {
      const isSticker = !!item.superchat.sticker;
      return {
        ...base,
        eventType: isSticker ? 'supersticker' : 'superchat',
        message: isSticker ? null : text,
        amount: item.superchat.amount ?? null,
        extra: { color: item.superchat.color ?? null, sticker: item.superchat.sticker?.alt ?? null },
      };
    }
    return {
      ...base,
      eventType: 'chat',
      message: text,
      amount: null,
      extra: item.isMembership ? { isMembership: true } : null,
    };
  }

  function toYoutubeId(ch) {
    if (ch.startsWith('UC')) return { channelId: ch };
    return { handle: ch.startsWith('@') ? ch : `@${ch}` };
  }

  function scheduleRetry() {
    if (stopped) return;
    retryTimer = setTimeout(attemptStart, NOT_LIVE_RETRY_MS);
  }

  function attachHandlers(chat) {
    chat.on('start', () => onStatus({ live: true, error: null }));
    chat.on('chat', (item) => onEvent({ platform: 'youtube', dedupKey: item.id, ...classifyItem(item) }));
    chat.on('error', (err) => {
      // 沒開台是預期狀態,不當錯誤顯示;loop 結束(含 5 次連續錯誤後套件自己 stop)一律交給
      // 'end' 事件觸發重試,這裡只負責更新狀態列文字,避免 'error' 跟 'end' 都排一次重試。
      if (err instanceof NotLiveError) { onStatus({ live: false, error: null }); return; }
      onStatus({ live: false, error: err?.message || String(err) });
    });
    chat.on('end', () => {
      onStatus({ live: false, error: null });
      scheduleRetry();
    });
  }

  async function attemptStart() {
    if (stopped) return;
    liveChat = new LiveChat(toYoutubeId(channel));
    attachHandlers(liveChat);
    const ok = await liveChat.start();
    if (!ok) scheduleRetry();
  }

  function start() {
    if (!channel) { onStatus({ live: false, error: '未設定 YouTube 頻道/handle' }); return; }
    stopped = false;
    attemptStart();
  }

  function stop() {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    liveChat?.stop('connector stopped');
    liveChat = null;
  }

  return { start, stop };
}

module.exports = { createYoutubeConnector };
