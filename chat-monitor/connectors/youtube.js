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
const { debugLog } = require('../lib/debugLog');
const { RAW_CAPTURE, rawCapture } = require('../lib/rawCapture');

const NOT_LIVE_RETRY_MS = 30_000; // 套件的 start() 失敗或 loop 結束後不會自動重試,連接器自己排下一次嘗試

// 2026-08-13:YouTube 原始回應裡,會員留言(liveChatMembershipItemRenderer)常帶著 headerSubtext
// 欄位(例如「已加入會員 46 個月」這類文字),但 youtube-chat-next 自己的 parser(dist/parser.js
// 的 parseActionToChatItem())遇到 messageRenderer 同時有 message 欄位(使用者自己打的留言)時
// 只取 message,headerSubtext 就整個被丟掉,ChatItem 上完全看不到——這不是我們漏接,是套件在
// parse 階段就把資料丟了。用 monkey-patch 補回來:parseChatData() 執行完之後,自己重新掃一次
// 原始 actions 把 headerSubtext 文字挖出來,用 id 對回對應的 ChatItem,不影響套件原本的行為。
// 這是修補第三方套件的內部實作細節,不是公開 API,套件更新後這段可能需要跟著調整。
function patchMembershipHeaders() {
  const parserModule = require('youtube-chat-next/dist/parser.js');
  if (parserModule.__yoliaPatchedForMembershipHeader) return;
  const originalParseChatData = parserModule.parseChatData;
  parserModule.parseChatData = function patchedParseChatData(data) {
    const [items, continuation, timeoutMs] = originalParseChatData(data);
    const actions = data?.continuationContents?.liveChatContinuation?.actions ?? [];
    for (const action of actions) {
      const renderer = action?.addChatItemAction?.item?.liveChatMembershipItemRenderer;
      const runs = renderer?.headerSubtext?.runs;
      if (!renderer?.id || !runs) continue;
      const item = items.find((i) => i.id === renderer.id);
      if (item) item.membershipHeader = runs.map((r) => r.text ?? '').join('');
    }
    return [items, continuation, timeoutMs];
  };
  parserModule.__yoliaPatchedForMembershipHeader = true;
}
patchMembershipHeaders();

// author.badge.label 目前只見過這兩種格式(2026-08-13,237 筆真實樣本):「New member」/
// 「Member (N months)」。格式不認得就回傳 null,不要亂猜。
function parseMembershipMonths(badgeLabel) {
  if (!badgeLabel) return null;
  if (/new member/i.test(badgeLabel)) return 0;
  const match = badgeLabel.match(/member\s*\((\d+)\s*months?\)/i);
  return match ? Number(match[1]) : null;
}

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
    if (item.isMembership) {
      // 2026-08-13 用 CHAT_MONITOR_RAW_CAPTURE 實測 237 筆真實會員留言發現:author.badge.label
      // 每一則會員訊息都有(不用等罕見的加入/里程碑系統通知),格式穩定只有「New member」/
      // 「Member (N months)」兩種,比 membershipHeader(patchMembershipHeaders() 補的
      // headerSubtext,同一批樣本一次都沒出現過,因為那個欄位只有系統通知才有)可靠得多,
      // 改成主要來源;membershipHeader 保留當補充,萬一哪天真的遇到系統通知可能有更完整的文字。
      const badgeLabel = item.author?.badge?.label ?? null;
      const months = parseMembershipMonths(badgeLabel);
      const header = item.membershipHeader ? String(item.membershipHeader).trim() : '';
      const monthsText = months === 0 ? '新加入會員' : months !== null ? `會員 ${months} 個月` : (header || null);
      const displayMessage = monthsText ? (text ? `[${monthsText}] ${text}` : `[${monthsText}]`) : text;
      return {
        ...base,
        eventType: 'chat',
        message: displayMessage,
        amount: null,
        extra: { isMembership: true, membershipMonths: months, membershipBadge: badgeLabel, membershipHeader: header || null },
      };
    }
    return { ...base, eventType: 'chat', message: text, amount: null, extra: null };
  }

  function toYoutubeId(ch) {
    if (ch.startsWith('UC')) return { channelId: ch };
    return { handle: ch.startsWith('@') ? ch : `@${ch}` };
  }

  function scheduleRetry() {
    if (stopped) return;
    retryTimer = setTimeout(attemptStart, NOT_LIVE_RETRY_MS);
  }

  // 之前只有 SOOP 有連線層級的 debugLog(連上/斷線/錯誤),Twitch/YouTube 完全沒有,三平台
  // 除錯能見度不對稱(user 發現的落差)——這裡補齊,跟 soop.js 同樣的詳細程度。
  function attachHandlers(chat) {
    chat.on('start', (liveId) => { debugLog('youtube', 'started', { liveId }); onStatus({ live: true, error: null }); });
    chat.on('chat', (item) => {
      // CHAT_MONITOR_RAW_CAPTURE=1 才會寫,一般聊天(沒有 superchat 也不是會員)跳過,只存
      // youtube-chat-next 解析完的完整 ChatItem(比我們自己 classifyItem() 篩選過的欄位更完整,
      // 之後要查有沒有漏掉的欄位可以直接比對)。
      if (RAW_CAPTURE && (item.superchat || item.isMembership)) rawCapture('youtube', item.superchat ? 'superchat' : 'membership', item);
      onEvent({ platform: 'youtube', dedupKey: item.id, ...classifyItem(item) });
    });
    chat.on('error', (err) => {
      // 沒開台是預期狀態,不當錯誤顯示;loop 結束(含 5 次連續錯誤後套件自己 stop)一律交給
      // 'end' 事件觸發重試,這裡只負責更新狀態列文字,避免 'error' 跟 'end' 都排一次重試。
      if (err instanceof NotLiveError) { onStatus({ live: false, error: null }); return; }
      debugLog('youtube', 'error', { message: err?.message || String(err) });
      onStatus({ live: false, error: err?.message || String(err) });
    });
    chat.on('end', (reason) => {
      debugLog('youtube', 'ended', { reason: reason ?? null });
      onStatus({ live: false, error: null });
      scheduleRetry();
    });
  }

  async function attemptStart() {
    if (stopped) return;
    liveChat = new LiveChat(toYoutubeId(channel));
    attachHandlers(liveChat);
    const ok = await liveChat.start();
    debugLog('youtube', 'start() result', { ok });
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
