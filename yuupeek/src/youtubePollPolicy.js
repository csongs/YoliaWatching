(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.YoutubePollPolicy = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // search.list 每日獨立上限 100 次(developers.google.com/youtube/v3/determine_quota_cost,
  // 2026-07-12 查)——30 秒輪詢 50 分鐘就會用光一天的額度,故未開播時 15 分鐘查一次,
  // 桌面版與雲端 overlay 共用這份節奏。
  const LIVE_CHECK_INTERVAL_MS = 15 * 60 * 1000;
  const RETRY_INTERVAL_MS      = 30_000;   // 缺設定/暫時性狀況的重排間隔(不打 search)

  // 距離上次找直播是否已經過了 intervalMs;沒到就回傳還要等多久。
  function shouldCheckLiveNow(now, lastSearchAt, intervalMs = LIVE_CHECK_INTERVAL_MS) {
    const elapsed = now - lastSearchAt;
    if (elapsed < intervalMs) return { ready: false, delayMs: intervalMs - elapsed };
    return { ready: true, delayMs: 0 };
  }

  // 呼叫端把各自平台的錯誤形狀攤平成這個 shape 再問:
  // 桌面版(googleapis)給 reason,雲端版(fetch)給 status,兩邊都可以給 message。
  function classifyYoutubeError({ reason = '', status = null, message = '' } = {}) {
    const msg = String(message).toLowerCase();
    const quota = reason === 'quotaExceeded' || msg.includes('quota') || status === 403;
    return { quota };
  }

  return { LIVE_CHECK_INTERVAL_MS, RETRY_INTERVAL_MS, shouldCheckLiveNow, classifyYoutubeError };
});
