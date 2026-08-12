// 事件類型的顯示標籤與說明——server.js(組裝 extra 時)與 demo.js(畫聊天視窗)共用同一份,
// 用 UMD 包裝(跟 chatProcessor.js / youtubePollPolicy.js 同慣例)避免兩邊各抄一份而漂移。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.ChatMonitorLabels = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const PLATFORM_LABELS = {
    twitch: 'TWITCH',
    youtube: 'YT',
    soop: 'SOOP',
  };

  // event_type -> 中文標籤 + 分類(chat=一般聊天可能觸發互動 / donation=金流 / system=進出場等)
  const EVENT_TYPE_LABELS = {
    // --- Twitch ---
    chat:                 { label: '一般訊息', category: 'chat' },
    chat_highlight:       { label: '醒目留言(頻道點數兌換)', category: 'chat' },
    cheer:                { label: 'Bits 抖內', category: 'donation' },
    sub:                  { label: '新訂閱', category: 'donation' },
    resub:                { label: '續訂', category: 'donation' },
    subgift:               { label: '贈送訂閱', category: 'donation' },
    submysterygift:        { label: '神秘箱訂閱(大量贈送)', category: 'donation' },
    raid:                  { label: '突襲(Raid)', category: 'system' },

    // --- YouTube ---
    superchat:              { label: 'Super Chat(付費醒目訊息)', category: 'donation' },
    supersticker:           { label: 'Super Sticker(付費貼圖)', category: 'donation' },

    // --- SOOP ---
    emoticon:               { label: '表情訊息', category: 'chat' },
    text_donation:          { label: '文字/語音抖內(별풍선)', category: 'donation' },
    video_donation:          { label: '影片抖內', category: 'donation' },
    ad_balloon_donation:     { label: '廣告氣球抖內', category: 'donation' },
    subscribe:               { label: '訂閱(구독)', category: 'donation' },
    notification:            { label: '系統通知', category: 'system' },
  };

  function labelFor(eventType) {
    return EVENT_TYPE_LABELS[eventType]?.label ?? eventType;
  }

  function categoryFor(eventType) {
    return EVENT_TYPE_LABELS[eventType]?.category ?? 'chat';
  }

  function platformLabel(platform) {
    return PLATFORM_LABELS[platform] ?? String(platform).toUpperCase();
  }

  // 給 DEMO 頁「說明」面板用——各平台「等級/金額」概念不一樣,不是同一把尺,
  // 這裡只給既有實作(soop-extension / tmi.js tags / youtube-chat-next)已經能觀察到的欄位說明,
  // 不編造未查證的官方定價或門檻數字。
  const PLATFORM_DONATION_NOTES = [
    {
      platform: 'twitch',
      title: 'Twitch',
      note: 'Bits 抖內(cheer)以「幾個 bits」計價,訊息上會顯示數字,無固定分級;'
          + '訂閱分 Tier 1/2/3(由實況主設定價格),續訂會額外帶「已訂閱幾個月」。'
          + '「醒目留言」是頻道點數(Channel Points)兌換的其中一種預設兌換項目,不是金流抖內。',
    },
    {
      platform: 'youtube',
      title: 'YouTube',
      note: 'Super Chat / Super Sticker 依實際付款金額分色階(金額越高,訊息在聊天室置頂時間越久、顏色越顯眼);'
          + '這裡監聽的是公開網頁聊天室(youtube-chat-next,免 API Key),只能拿到金額字串與顏色,拿不到'
          + '官方 API 才有的 amountMicros/tier 數字;會員(Membership)也只知道「是不是會員」,分不出'
          + '新加入/連續/贈禮是哪一種(欄位含義依 youtube-chat-next 3.1.0 型別定義,2026-08-12 查)。',
    },
    {
      platform: 'soop',
      title: 'SOOP',
      note: '抖內以「별풍선(星球)」虛擬幣計價,文字/語音/影片/廣告氣球是不同的抖內管道,'
          + '金額換算與粉絲團加入順位(fanClubOrdinal)由 soop-extension 函式庫回傳的欄位而來;'
          + '訂閱(구독)另外帶月數與 tier。以上欄位含義依 soop-extension README(未查證官方原始定義)。',
    },
  ];

  return { PLATFORM_LABELS, EVENT_TYPE_LABELS, labelFor, categoryFor, platformLabel, PLATFORM_DONATION_NOTES };
});
