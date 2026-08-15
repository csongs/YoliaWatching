// YouTube 連接器——改用 youtube-chat-next(github.com/LucasSantana-Dev/youtube-chat-next)這個
// 免 API Key 的公開網頁聊天室爬蟲套件,取代先前的 googleapis 官方 API 做法(search.list 每日只有
// 100 次配額,逼得未開播時要 15 分鐘才查一次;見已刪除的 lib/youtubePollPolicy.js)。換套件後
// YouTube 分頁不再需要填 API Key,只要 handle 或頻道 ID。
//
// 代價(2026-08-12 查證,youtube-chat-next 3.1.0 型別定義):官方 API 能把付費/會籍事件細分成
// superChatEvent / superStickerEvent / newSponsorEvent / memberMilestoneChatEvent /
// membershipGiftingEvent / giftMembershipReceivedEvent 六種,這個套件是爬公開網頁聊天室,ChatItem
// 只給 superchat?:{amount,color,sticker?} 與 isMembership:boolean 兩個欄位,沒有 tier 數字也分不出
// 一般會籍留言是「新加入/連續」哪一種——這部分維持只有 chat(帶 extra.isMembership)、
// superchat、supersticker 三種事件,不產生 membership_new/_milestone。
// 2026-08-15:贈送會籍(membershipGiftingEvent/giftMembershipReceivedEvent 對應的兩個事件)例外
// ——用真實抓包樣本核對過,YouTube 原始封包裡這兩個是獨立的 action 類型(不是 ChatItem 的欄位,
// 見下面 patchYoutubeParser() 的 monkey-patch),繞開套件本身的限制另外接上,產生
// membership_gift(購買方)/membership_gift_received(領取方)兩種事件。
const { LiveChat, NotLiveError } = require('youtube-chat-next');
const { debugLog } = require('../lib/debugLog');
const { RAW_CAPTURE, rawCapture } = require('../lib/rawCapture');

const NOT_LIVE_RETRY_MS = 30_000; // 套件的 start() 失敗或 loop 結束後不會自動重試,連接器自己排下一次嘗試

// 2026-08-13:YouTube 原始回應裡,會籍留言(liveChatMembershipItemRenderer)常帶著 headerSubtext
// 欄位(例如「已加入會籍 46 個月」這類文字),但 youtube-chat-next 自己的 parser(dist/parser.js
// 的 parseActionToChatItem())遇到 messageRenderer 同時有 message 欄位(使用者自己打的留言)時
// 只取 message,headerSubtext 就整個被丟掉,ChatItem 上完全看不到——這不是我們漏接,是套件在
// parse 階段就把資料丟了。用 monkey-patch 補回來:parseChatData() 執行完之後,自己重新掃一次
// 原始 actions 把 headerSubtext 文字挖出來,用 id 對回對應的 ChatItem,不影響套件原本的行為。
// 這是修補第三方套件的內部實作細節,不是公開 API,套件更新後這段可能需要跟著調整。
//
// 2026-08-15:同一個 monkey-patch 點順便處理「贈送會籍」。YouTube 原始封包裡贈送會籍有專屬的
// action 類型:liveChatSponsorshipsGiftPurchaseAnnouncementRenderer(購買方,一次贈送 N 份時只
// 觸發這一個事件)、liveChatSponsorshipsGiftRedemptionAnnouncementRenderer(領取方,每個實際
// 領到的人各自觸發一個)。youtube-chat-next 的 rendererFromAction() 完全沒有這兩種的分支,回傳
// null,連 ChatItem 都不會被建出來——一般的 chat.on('chat', ...) 永遠不會為這種事件觸發。
// 2026-08-14 用 CHAT_MONITOR_RAW_CAPTURE 實測抓到真實樣本(使用者「@瓢箪_400」贈送 1 份、
// 「@cherub1189」領取,兩個 action 相隔約 10 秒送達)核對過欄位路徑:
//   - 購買方:header.liveChatSponsorshipsHeaderRenderer.authorName(購買者)、
//     .primaryText.runs 是「Sent {count} {社群名稱} gift memberships」樣板,count 是純數字獨立
//     一個 run(不管顯示語系文字部分怎麼變,數字本身跟語系無關,用「純數字」找出那個 run,不用
//     比對樣板文字本身)。
//   - 領取方:authorName 本身就是領取者、message.runs 是「received a gift membership by {贈送
//     者}」,贈送者名字是最後一個 run。這兩個 renderer 直接掛在 addChatItemAction.item 底下,
//     不像會籍留言需要另外對 id——這裡直接把它們組成「假的」ChatItem 塞進 items 陣列,讓它們
//     跟其他事件走同一條 chat.on('chat', ...) → classifyItem() 路徑,不用另外接一條 pipeline。
function extractGiftCount(runs) {
  const numericRun = (runs ?? []).find((r) => /^\d+$/.test((r.text ?? '').trim()));
  return numericRun ? Number(numericRun.text.trim()) : null;
}

// 2026-08-15:唯一一筆真實樣本(英文介面)的 primaryText.runs 是「Sent {count} {方案名稱}
// gift memberships」這種樣板,方案名稱夾在數字 run 之後、最後一個 run(結尾的「gift
// memberships」字樣,使用者截圖對照真實 YouTube 畫面確認這段文字是「XX 會籍」的方案名稱,
// 不是頻道/社群名稱)之前——只用這一筆樣本反推位置,其他語系的樣板文字順序未必一樣,之後抓到
// 別的語系樣本要回頭確認這個位置假設還成不成立。
function extractGiftPlanName(runs) {
  if (!runs?.length) return null;
  const countIdx = runs.findIndex((r) => /^\d+$/.test((r.text ?? '').trim()));
  if (countIdx === -1 || countIdx + 1 >= runs.length) return null;
  const name = runs.slice(countIdx + 1, runs.length - 1).map((r) => r.text ?? '').join('').trim();
  return name || null;
}

function patchYoutubeParser() {
  const parserModule = require('youtube-chat-next/dist/parser.js');
  if (parserModule.__yoliaPatchedYoutubeParser) return;
  const originalParseChatData = parserModule.parseChatData;
  parserModule.parseChatData = function patchedParseChatData(data) {
    const [items, continuation, timeoutMs] = originalParseChatData(data);
    const actions = data?.continuationContents?.liveChatContinuation?.actions ?? [];
    for (const action of actions) {
      // 2026-08-15:這整段是我們自己疊加在套件原本解析結果上的邏輯,套件本身沒處理過這些
      // renderer,遇到什麼詭異結構都有可能——之前發生過伺服器在收到某個未知封包後整個沒了
      // 反應(沒開 CHAT_MONITOR_DEBUG,原因沒留下 log),不確定是不是這裡丟例外造成的,但這段
      // 本來就不該讓「這一筆解析失敗」變成「整個連線掛掉」。包一層 try/catch,單一 action 出錯
      // 只跳過那一筆,不影響 originalParseChatData() 已經正確解析出來的 items,也不影響後續
      // action 繼續處理。
      try {
        const item = action?.addChatItemAction?.item;
        const membershipRenderer = item?.liveChatMembershipItemRenderer;
        const runs = membershipRenderer?.headerSubtext?.runs;
        if (membershipRenderer?.id && runs) {
          const existing = items.find((i) => i.id === membershipRenderer.id);
          if (existing) existing.membershipHeader = runs.map((r) => r.text ?? '').join('');
        }

        const purchaseRenderer = item?.liveChatSponsorshipsGiftPurchaseAnnouncementRenderer;
        const redemptionRenderer = item?.liveChatSponsorshipsGiftRedemptionAnnouncementRenderer;
        if (RAW_CAPTURE && purchaseRenderer) rawCapture('youtube', 'liveChatSponsorshipsGiftPurchaseAnnouncementRenderer', action);
        if (RAW_CAPTURE && redemptionRenderer) rawCapture('youtube', 'liveChatSponsorshipsGiftRedemptionAnnouncementRenderer', action);

        // 「XX 和他們的觀眾剛剛加入」這種類似 Twitch Raid 的系統訊息(YT 社群俗稱「降落」),
        // 原始封包類型是 liveChatViewerEngagementMessageRenderer——youtube-chat-next 的型別
        // 定義有列出這個 key(dist/types/yt-response.d.ts),但 rendererFromAction() 完全沒有
        // 處理它的分支,一樣會被丟掉、chat.on('chat', ...) 不會觸發。chat-downloader 的
        // youtube.py 註記這個 renderer 也被拿來顯示「Live Chat 重播已開啟」之類的其他系統訊息,
        // 不是只有降落專用,還沒有真實樣本核對過欄位長怎樣、能不能分辨是哪一種——先只抓原始封包,
        // 不嘗試解析,等真的抓到之後再回頭比照 membership_gift 的做法設計解析邏輯。
        const engagementRenderer = item?.liveChatViewerEngagementMessageRenderer;
        if (RAW_CAPTURE && engagementRenderer) rawCapture('youtube', 'liveChatViewerEngagementMessageRenderer', action);

        // 2026-08-15:「新會員加入」的慶祝橫幅(畫面最上面那條跑馬燈)其實走完全不同的 action
        // 類型——addLiveChatTickerItemAction(不是 addChatItemAction),裡面有
        // liveChatTickerSponsorItemRenderer(新會員/贈送)、liveChatTickerPaidStickerItemRenderer、
        // liveChatTickerPaidMessageItemRenderer(這兩個是 Super Sticker/Chat 的跑馬燈版本,
        // inline 版已經抓得到,這裡只是想確認 ticker 版欄位有沒有差異)三種——用 chat-downloader
        // 的 youtube.py 查到這個分類,youtube-chat-next 的 rendererFromAction() 完全沒檢查過
        // addLiveChatTickerItemAction,這整條 action 目前完全沒被看過。`.item` 這層巢狀結構是
        // 照 addChatItemAction 的慣例推測的,還沒有真實樣本驗證過路徑對不對——先只抓原始封包,
        // 不嘗試解析,這正是我們一直在找的「YT 有沒有加入瞬間通知」的候選位置。
        const tickerItem = action?.addLiveChatTickerItemAction?.item;
        const tickerRendererKeys = [
          'liveChatTickerSponsorItemRenderer',
          'liveChatTickerPaidStickerItemRenderer',
          'liveChatTickerPaidMessageItemRenderer',
        ];
        if (RAW_CAPTURE && tickerItem) {
          const tickerKey = tickerRendererKeys.find((k) => tickerItem[k]);
          if (tickerKey) rawCapture('youtube', tickerKey, action);
        }

        const header = purchaseRenderer?.header?.liveChatSponsorshipsHeaderRenderer;
        if (purchaseRenderer?.id && header?.authorName?.simpleText) {
          items.push({
            id: purchaseRenderer.id,
            author: { name: header.authorName.simpleText, channelId: purchaseRenderer.authorExternalChannelId },
            message: [],
            isMembership: false,
            isOwner: false,
            isVerified: false,
            isModerator: false,
            timestamp: new Date(Number(purchaseRenderer.timestampUsec) / 1000),
            giftPurchase: { count: extractGiftCount(header.primaryText?.runs), planName: extractGiftPlanName(header.primaryText?.runs) },
          });
        }

        if (redemptionRenderer?.id && redemptionRenderer.authorName?.simpleText) {
          const gifterRun = redemptionRenderer.message?.runs?.[redemptionRenderer.message.runs.length - 1];
          items.push({
            id: redemptionRenderer.id,
            author: { name: redemptionRenderer.authorName.simpleText, channelId: redemptionRenderer.authorExternalChannelId },
            message: [],
            isMembership: false,
            isOwner: false,
            isVerified: false,
            isModerator: false,
            timestamp: new Date(Number(redemptionRenderer.timestampUsec) / 1000),
            giftRedemption: { fromUsername: gifterRun?.text?.trim() || null },
          });
        }
      } catch (err) {
        debugLog('youtube', 'patchYoutubeParser action failed', { message: err?.message || String(err) });
      }
    }
    return [items, continuation, timeoutMs];
  };
  parserModule.__yoliaPatchedYoutubeParser = true;
}
patchYoutubeParser();

// author.badge.label 目前見過三種格式:「New member」/「Member (N months)」(2026-08-13,237
// 筆真實樣本)/「Member (N year(s))」(2026-08-13 額外抓到一筆「Member (1 year)」,YouTube 滿一年
// 後改用「年」當單位,不是一直累加月份——原本只認 months,這種格式會被漏判成格式不認得的 null)。
// 格式不認得就回傳 null,不要亂猜。
function parseMembershipMonths(badgeLabel) {
  if (!badgeLabel) return null;
  if (/new member/i.test(badgeLabel)) return 0;
  const monthsMatch = badgeLabel.match(/member\s*\((\d+)\s*months?\)/i);
  if (monthsMatch) return Number(monthsMatch[1]);
  const yearsMatch = badgeLabel.match(/member\s*\((\d+)\s*years?\)/i);
  if (yearsMatch) return Number(yearsMatch[1]) * 12;
  return null;
}

function createYoutubeConnector({ channel }, onEvent, onStatus) {
  let stopped = true;
  let liveChat = null;
  let retryTimer = null;

  function messageToText(message) {
    return (message ?? []).map((m) => ('text' in m ? m.text : m.emojiText || m.alt || '')).join('');
  }

  // 除了純文字版(messageToText,存進 message 欄位,永遠有,方便搜尋/舊版相容),額外建一份
  // 「文字/表情圖片」交錯的結構化版本——youtube-chat-next 的 EmojiItem 本來就帶 url(見
  // dist/types/data.d.ts 的 ImageItem),之前 messageToText 直接把圖片網址丟掉只留 alt 文字,
  // 現在留著給 demo 頁面渲染真的圖片。沒有任何表情符號時回傳 null,不用每則純文字訊息都多存
  // 一份幾乎重複的資料。
  function messageToParts(message) {
    if (!message?.length) return null;
    const hasEmoji = message.some((m) => !('text' in m));
    if (!hasEmoji) return null;
    return message.map((m) => ('text' in m
      ? { type: 'text', text: m.text }
      : { type: 'emoji', url: m.url, alt: m.emojiText || m.alt || '' }));
  }

  // superchat.sticker 有值代表是 Super Sticker,否則是文字 Super Chat——套件把兩者合併成同一個
  // 欄位,跟官方 API 分成 superChatEvent/superStickerEvent 兩種事件不同。
  function classifyItem(item) {
    const username = item.author?.name ?? '';
    const base = { username, receivedAt: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString() };
    const text = messageToText(item.message);
    const messageParts = messageToParts(item.message);

    if (item.giftPurchase) {
      return {
        ...base,
        eventType: 'membership_gift',
        message: item.giftPurchase.planName ? `「${item.giftPurchase.planName}」會籍` : null,
        amount: item.giftPurchase.count != null ? String(item.giftPurchase.count) : null,
        extra: item.giftPurchase.planName ? { planName: item.giftPurchase.planName } : null,
      };
    }
    if (item.giftRedemption) {
      return {
        ...base,
        eventType: 'membership_gift_received',
        message: item.giftRedemption.fromUsername ? `← ${item.giftRedemption.fromUsername}` : null,
        amount: null,
        extra: { fromUsername: item.giftRedemption.fromUsername },
      };
    }
    if (item.superchat) {
      const isSticker = !!item.superchat.sticker;
      return {
        ...base,
        eventType: isSticker ? 'supersticker' : 'superchat',
        message: isSticker ? null : text,
        amount: item.superchat.amount ?? null,
        extra: { color: item.superchat.color ?? null, sticker: item.superchat.sticker?.alt ?? null, messageParts: isSticker ? null : messageParts },
      };
    }
    if (item.isMembership) {
      // 2026-08-13 用 CHAT_MONITOR_RAW_CAPTURE 實測 237 筆真實會籍留言發現:author.badge.label
      // 每一則會籍訊息都有(不用等罕見的加入/里程碑系統通知),格式穩定只有「New member」/
      // 「Member (N months)」兩種,比 membershipHeader(patchYoutubeParser() 補的
      // headerSubtext,同一批樣本一次都沒出現過,因為那個欄位只有系統通知才有)可靠得多,
      // 改成主要來源;membershipHeader 保留當補充,萬一哪天真的遇到系統通知可能有更完整的文字。
      const badgeLabel = item.author?.badge?.label ?? null;
      const months = parseMembershipMonths(badgeLabel);
      const header = item.membershipHeader ? String(item.membershipHeader).trim() : '';
      // 2026-08-14 之前這裡會把「[會籍 N 個月]」這種文字前綴直接塞進 message/messageParts,
      // 使用者反應每則訊息都重複顯示月數太雜訊、不需要——改成 message 就是單純留言文字本身,
      // 跟一般聊天訊息一樣,月數/徽章資料只留在 extra 裡供之後需要的地方自己取用,不影響顯示。
      // 2026-08-15:順便存徽章圖示網址(author.badge.thumbnail.url)——之前只存文字標籤
      // (membershipBadge),圖示完全沒讀取。這個頻道目前只看過「New member」/
      // 「Member (N months)」/「Member (N year(s))」三種文字,從沒出現過像 Twitch 那種明確的
      // Tier 1/2/3 字樣;如果這個頻道其實有分付費階級,YouTube 應該是靠徽章圖案本身的美術設計
      // 區分,不是文字——圖示網址存起來,demo 頁顯示出來後,以後比對不同人的圖示網址有沒有差異,
      // 才有機會確認這個頻道到底有沒有多階級,目前還沒查證。
      const badgeIcon = item.author?.badge?.thumbnail?.url ?? null;
      return {
        ...base,
        eventType: 'chat',
        message: text,
        amount: null,
        extra: { isMembership: true, membershipMonths: months, membershipBadge: badgeLabel, membershipBadgeIcon: badgeIcon, membershipHeader: header || null, messageParts },
      };
    }
    return { ...base, eventType: 'chat', message: text, amount: null, extra: messageParts ? { messageParts } : null };
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
      // CHAT_MONITOR_RAW_CAPTURE=1 才會寫,一般聊天(沒有 superchat 也不是會籍)跳過,只存
      // youtube-chat-next 解析完的完整 ChatItem(比我們自己 classifyItem() 篩選過的欄位更完整,
      // 之後要查有沒有漏掉的欄位可以直接比對)。
      // 2026-08-15:superchat 拆成 superchat(文字)/supersticker(貼圖)兩個 tag,不要合併——
      // 文字版已經有真實樣本驗證過(可以加進 CHAT_MONITOR_RAW_CAPTURE_SKIP 減少灌水),貼圖版
      // 完全沒抓到過,合併成同一個 tag 的話 skip 掉文字版會連貼圖版一起濾掉。
      let captureTag = null;
      if (item.superchat) captureTag = item.superchat.sticker ? 'supersticker' : 'superchat';
      else if (item.isMembership) captureTag = 'membership';
      if (RAW_CAPTURE && captureTag) rawCapture('youtube', captureTag, item);
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
