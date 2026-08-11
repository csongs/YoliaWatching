// 手動複製自 yuupeek/src/youtubePollPolicy.js(2026-08-11)——chat-monitor 是要能單獨打包給
// 別人測試的獨立工具,不能依賴 yuupeek/ 資料夾同時存在,所以這裡是刻意的一份副本,不是
// require 源頭。這個節奏公式很少改,如果 yuupeek 那邊調整了輪詢間隔/配額判斷,記得手動同步過來。
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.YoutubePollPolicy = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  // search.list 每日獨立上限 100 次(developers.google.com/youtube/v3/determine_quota_cost,
  // 2026-07-12 查)——30 秒輪詢 50 分鐘就會用光一天的額度,故未開播時 15 分鐘查一次。
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
