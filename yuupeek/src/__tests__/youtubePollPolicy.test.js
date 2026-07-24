const { LIVE_CHECK_INTERVAL_MS, RETRY_INTERVAL_MS, shouldCheckLiveNow, classifyYoutubeError } = require('../youtubePollPolicy');

describe('shouldCheckLiveNow', () => {
  test('間隔內未到:not ready,回傳剩餘等待時間', () => {
    const r = shouldCheckLiveNow(100_000, 90_000, LIVE_CHECK_INTERVAL_MS);
    expect(r).toEqual({ ready: false, delayMs: LIVE_CHECK_INTERVAL_MS - 10_000 });
  });

  test('間隔已到:ready,delayMs 為 0', () => {
    const now = 90_000 + LIVE_CHECK_INTERVAL_MS;
    expect(shouldCheckLiveNow(now, 90_000, LIVE_CHECK_INTERVAL_MS)).toEqual({ ready: true, delayMs: 0 });
  });

  test('lastSearchAt=0(從未查過)但還沒過 intervalMs:not ready', () => {
    expect(shouldCheckLiveNow(1000, 0, LIVE_CHECK_INTERVAL_MS)).toEqual({ ready: false, delayMs: LIVE_CHECK_INTERVAL_MS - 1000 });
  });

  test('缺省 intervalMs 用 LIVE_CHECK_INTERVAL_MS', () => {
    expect(shouldCheckLiveNow(LIVE_CHECK_INTERVAL_MS, 0)).toEqual({ ready: true, delayMs: 0 });
  });
});

describe('classifyYoutubeError', () => {
  test('googleapis reason=quotaExceeded → quota', () => {
    expect(classifyYoutubeError({ reason: 'quotaExceeded', message: 'The request cannot be completed' }).quota).toBe(true);
  });

  test('message 含 quota(不分大小寫) → quota', () => {
    expect(classifyYoutubeError({ message: 'Quota exceeded for quota metric' }).quota).toBe(true);
  });

  test('fetch 版 status=403 → quota', () => {
    expect(classifyYoutubeError({ status: 403, message: 'YouTube API 403' }).quota).toBe(true);
  });

  test('其他錯誤(如暫時性 500)不算 quota', () => {
    expect(classifyYoutubeError({ status: 500, message: 'YouTube API 500' }).quota).toBe(false);
  });

  test('無參數呼叫不丟例外,回傳 quota:false', () => {
    expect(classifyYoutubeError()).toEqual({ quota: false });
  });
});

test('RETRY_INTERVAL_MS 小於 LIVE_CHECK_INTERVAL_MS(重試比找直播節奏快)', () => {
  expect(RETRY_INTERVAL_MS).toBeLessThan(LIVE_CHECK_INTERVAL_MS);
});
