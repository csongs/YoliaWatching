// event_type -> 中文標籤 + 分類(chat/donation/system) 對照表。
// 這份是 chat-monitor/public/labels.js 的 EVENT_TYPE_LABELS 的小抄本——兩個是各自獨立的
// npm 專案(2026-08-16 決策:chat-monitor 維持獨立 process,不合併),沒有共用模組機制,
// 只好各留一份;chat-monitor 那邊新增/改分類時記得回來對一次。
// 分類供互動規則的 eventTypes 欄位「粗略選」用(例如選 "donation" 涵蓋所有平台的抖內/
// 訂閱事件,不用每個平台的細項都列一次);細類供「精準選」用(例如只要 Twitch 的 cheer)。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ChatMonitorEventTypes = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const EVENT_TYPES = [
    // 注意:這裡故意不放 { value:'chat', ... }——"chat" 本身已經是粗略分類的值
    // (CATEGORY_LABELS 的 "chat"),跟細項共用同一個字串會讓面板的多選框同時選到「粗略分類」
    // 跟「細項」兩個不同 <option> 卻是同一個 value,存檔時變成 eventTypes:["chat","chat"]
    // 這種重複值(2026-08-16 實測踩到)。一般聊天文字用粗略分類的 "chat" 選就好,不需要
    // 額外的細項條目。
    // --- Twitch ---
    { value: 'chat_highlight', label: '醒目留言(頻道點數兌換)', category: 'chat' },
    { value: 'cheer', label: 'Bits 抖內', category: 'donation' },
    { value: 'sub', label: '新訂閱', category: 'donation' },
    { value: 'resub', label: '續訂', category: 'donation' },
    { value: 'subgift', label: '贈送訂閱', category: 'donation' },
    { value: 'submysterygift', label: '神秘箱訂閱(大量贈送)', category: 'donation' },
    { value: 'raid', label: '帶觀眾過來(Raid)', category: 'system' },
    { value: 'announcement', label: '公告(/announce)', category: 'system' },
    { value: 'usernotice_other', label: '其他系統通知(未分類)', category: 'system' },
    // --- YouTube ---
    { value: 'superchat', label: 'Super Chat(付費醒目訊息)', category: 'donation' },
    { value: 'supersticker', label: 'Super Sticker(付費貼圖)', category: 'donation' },
    { value: 'membership_gift', label: '贈送會籍(購買方)', category: 'donation' },
    { value: 'membership_gift_received', label: '贈送會籍(領取方)', category: 'donation' },
    // --- SOOP ---
    { value: 'emoticon', label: '表情訊息', category: 'chat' },
    { value: 'text_donation', label: '文字/語音抖內(별풍선)', category: 'donation' },
    { value: 'video_donation', label: '影片抖內', category: 'donation' },
    { value: 'ad_balloon_donation', label: '廣告氣球抖內', category: 'donation' },
    { value: 'subscribe', label: '訂閱(구독)', category: 'donation' },
    { value: 'gift_item', label: '贈送禮物(快播Plus/訂閱禮物券等)', category: 'donation' },
    { value: 'notification', label: '系統通知', category: 'system' },
  ];

  const CATEGORY_LABELS = {
    chat:     '一般聊天(粗略,涵蓋所有平台)',
    donation: '抖內/贊助(粗略,涵蓋所有平台)',
    system:   '系統通知(粗略,涵蓋所有平台)',
  };

  const CATEGORY_MAP = Object.fromEntries(EVENT_TYPES.map((t) => [t.value, t.category]));

  function categoryFor(eventType) {
    return CATEGORY_MAP[eventType] ?? 'chat';
  }

  return { EVENT_TYPES, CATEGORY_LABELS, categoryFor };
});
