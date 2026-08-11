// YouTube 連接器——沿用 yuupeek/src/chatListener.js 找直播/輪詢 liveChatMessages 的邏輯,
// 额外把 snippet.type 攤開成事件類型(production 版 chatListener.js 目前只讀
// displayMessage,SuperChat/會員事件會被吃掉,demo 這裡補上)。
// youtubePollPolicy 用 lib/ 底下的副本(chat-monitor 要能整包獨立打包給別人測試,
// 不能依賴 yuupeek/ 資料夾同時存在——見 lib/youtubePollPolicy.js 開頭的說明)。
const { google } = require('googleapis');
const YoutubePollPolicy = require('../lib/youtubePollPolicy');

const { LIVE_CHECK_INTERVAL_MS, RETRY_INTERVAL_MS } = YoutubePollPolicy;

function createYoutubeConnector({ channel, apiKey }, onEvent, onStatus) {
  let stopped = true;
  let timer = null;
  let youtubeClient = null;
  let liveVideoId = null;
  let resolvedChanId = null;
  let lastSearchAt = 0;
  let pageToken = null;
  let paused = false;

  function getErrorReason(e) {
    return e?.errors?.[0]?.reason || e?.response?.data?.error?.errors?.[0]?.reason || '';
  }

  async function resolveLiveVideoId(youtube) {
    if (!resolvedChanId) {
      if (channel.startsWith('UC')) {
        resolvedChanId = channel;
      } else {
        const handle = channel.startsWith('@') ? channel : `@${channel}`;
        const res = await youtube.channels.list({ part: ['id'], forHandle: handle });
        resolvedChanId = res.data.items?.[0]?.id ?? null;
        if (!resolvedChanId) return null;
      }
    }
    const searchRes = await youtube.search.list({
      part: ['id'], channelId: resolvedChanId, eventType: 'live', type: 'video', maxResults: 1,
    });
    return searchRes.data.items?.[0]?.id?.videoId ?? null;
  }

  // snippet.type 決定事件分類;superChatDetails/superStickerDetails 帶 amountDisplayString + tier。
  function classifyItem(item) {
    const type = item.snippet?.type;
    const username = item.authorDetails?.displayName ?? '';
    const base = { username, receivedAt: item.snippet?.publishedAt || new Date().toISOString() };

    switch (type) {
      case 'superChatEvent': {
        const d = item.snippet.superChatDetails;
        return { ...base, eventType: 'superchat', message: d?.userComment ?? null, amount: d?.amountDisplayString ?? null, extra: { tier: d?.tier ?? null } };
      }
      case 'superStickerEvent': {
        const d = item.snippet.superStickerDetails;
        return { ...base, eventType: 'supersticker', message: null, amount: d?.amountDisplayString ?? null, extra: { tier: d?.tier ?? null, sticker: d?.superStickerMetadata?.altText ?? null } };
      }
      case 'newSponsorEvent': {
        const d = item.snippet.newSponsorDetails;
        return { ...base, eventType: 'membership_new', message: null, amount: null, extra: { level: d?.memberLevelName ?? null } };
      }
      case 'memberMilestoneChatEvent': {
        const d = item.snippet.memberMilestoneChatDetails;
        return { ...base, eventType: 'membership_milestone', message: d?.userComment ?? null, amount: String(d?.memberMonth ?? ''), extra: { level: d?.memberLevelName ?? null } };
      }
      case 'membershipGiftingEvent': {
        const d = item.snippet.membershipGiftingDetails;
        return { ...base, eventType: 'membership_gift', message: null, amount: String(d?.giftMembershipsCount ?? ''), extra: { level: d?.giftMembershipsLevelName ?? null } };
      }
      case 'giftMembershipReceivedEvent': {
        const d = item.snippet.giftMembershipReceivedDetails;
        return { ...base, eventType: 'membership_gift_received', message: null, amount: null, extra: { gifterName: d?.gifterChannelId ?? null } };
      }
      case 'textMessageEvent':
      default:
        return { ...base, eventType: 'chat', message: item.snippet?.displayMessage ?? '', amount: null, extra: null };
    }
  }

  async function fetchOnce() {
    if (!channel) return { delayMs: RETRY_INTERVAL_MS };
    if (paused) return { stop: true };
    const effectiveKey = apiKey || process.env.YOUTUBE_API_KEY;
    if (!effectiveKey) {
      onStatus({ live: false, error: '尚未設定 YouTube API Key（見左側「平台設定」）' });
      return { delayMs: RETRY_INTERVAL_MS };
    }
    if (!youtubeClient) youtubeClient = google.youtube({ version: 'v3', auth: effectiveKey });
    const youtube = youtubeClient;

    try {
      if (!liveVideoId) {
        const now = Date.now();
        const check = YoutubePollPolicy.shouldCheckLiveNow(now, lastSearchAt, LIVE_CHECK_INTERVAL_MS);
        if (!check.ready) return { delayMs: check.delayMs };
        lastSearchAt = now;
        liveVideoId = await resolveLiveVideoId(youtube);
        if (!liveVideoId) {
          onStatus({ live: false, error: null });
          return { delayMs: LIVE_CHECK_INTERVAL_MS };
        }
      }

      const videoRes = await youtube.videos.list({ part: ['liveStreamingDetails'], id: [liveVideoId] });
      const chatId = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        liveVideoId = null; lastSearchAt = 0;
        onStatus({ live: false, error: null });
        return { delayMs: RETRY_INTERVAL_MS };
      }
      onStatus({ live: true, error: null });

      const chatRes = await youtube.liveChatMessages.list({
        liveChatId: chatId, part: ['snippet', 'authorDetails'],
        ...(pageToken ? { pageToken } : {}),
      });

      // 跟 chatListener.js 同一個決定:第一次呼叫(pageToken 為 null)不處理 items,只拿 nextPageToken 當起點,
      // 避免「剛連上就把開播以來的歷史訊息全部灌進來」——這同時也是 restart 後不重複寫入的關鍵。
      if (pageToken) {
        for (const item of chatRes.data.items ?? []) {
          onEvent({ platform: 'youtube', dedupKey: item.id, ...classifyItem(item) });
        }
      }

      pageToken = chatRes.data.nextPageToken ?? null;
      return { delayMs: chatRes.data.pollingIntervalMillis ?? 5000 };
    } catch (e) {
      if (YoutubePollPolicy.classifyYoutubeError({ reason: getErrorReason(e), message: e.message }).quota) {
        paused = true;
        onStatus({ live: false, error: '已超過 YouTube API 配額' });
        return { stop: true };
      }
      onStatus({ live: false, error: e.message });
      return { delayMs: 5000 };
    }
  }

  async function loop() {
    if (stopped) return;
    const { delayMs, stop } = await fetchOnce();
    if (stop || stopped) return;
    timer = setTimeout(loop, delayMs ?? RETRY_INTERVAL_MS);
  }

  function start() {
    if (!channel) { onStatus({ live: false, error: '未設定 YouTube 頻道/handle' }); return; }
    stopped = false;
    liveVideoId = null; resolvedChanId = null; lastSearchAt = 0; pageToken = null; paused = false;
    timer = setTimeout(loop, 0);
  }

  function stop() {
    stopped = true;
    if (timer) clearTimeout(timer);
  }

  return { start, stop };
}

module.exports = { createYoutubeConnector };
