// chatListener 測試(2026-07-10 重寫,對齊 createChatListener API;舊版測重構前的
// applyCommand/buildGreetRe,備份於 docs/backups/chatListener.test.js.2026-07-10.bak)。
// 外部依賴全部 mock:tmi.js(Twitch)、googleapis(YouTube);SOOP 走 dynamic import,
// 測試中 config.soop.enabled=false 使 startSoop 早退,不會真的 import。
jest.mock('tmi.js', () => {
  const instances = [];
  class Client {
    constructor(opts) { this.opts = opts; this.handlers = {}; instances.push(this); }
    on(evt, cb) { this.handlers[evt] = cb; }
    connect() { return Promise.resolve(); }
    disconnect() { this.disconnected = true; }
    readyState() { return 'OPEN'; }
  }
  return { Client, __instances: instances };
});
jest.mock('googleapis', () => ({ google: { youtube: jest.fn(() => ({})) } }));

const tmi = require('tmi.js');
const { createChatListener } = require('../chatListener');

function makeListener(interactions = [], smInit = { yolia_see: 0, state: 'idle' }) {
  const config = {
    twitch: { enabled: true, channel: 'tester' },
    youtube: { enabled: false },
    soop: { enabled: false },
    interactions,
  };
  const sm = { ...smInit };
  const broadcasts = [];
  const listener = createChatListener(config, sm, (p) => broadcasts.push(p));
  return { listener, sm, broadcasts };
}

function emitTwitch(text, username = '觀眾') {
  const client = tmi.__instances[tmi.__instances.length - 1];
  client.handlers['message'](null, { 'display-name': username }, text);
}

beforeEach(() => { tmi.__instances.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('一般訊息:+1 並廣播 value/state', () => {
  const { listener, sm, broadcasts } = makeListener();
  listener.start();
  emitTwitch('安安');
  expect(sm.yolia_see).toBe(1);
  expect(broadcasts[0]).toMatchObject({ value: 1, animOnly: false });
  listener.stop();
});

test('指令動畫:animOnly 廣播+3 秒後 resetState 廣播', () => {
  const { listener, broadcasts } = makeListener([
    { trigger: 'command', match: '!跳', animation: 'jump' },
  ]);
  listener.start();
  emitTwitch('!跳');
  expect(broadcasts[0]).toMatchObject({ state: 'jump', animOnly: true });
  jest.advanceTimersByTime(3000);
  expect(broadcasts[1]).toMatchObject({ state: 'idle' });
  listener.stop();
});

test('cost 不足:costDenied 提示廣播+3 秒後回復廣播', () => {
  const { listener, broadcasts } = makeListener([
    { trigger: 'command', match: '!貴', animation: 'cheer', cost: 50 },
  ]);
  listener.start();
  emitTwitch('!貴');
  expect(broadcasts[0].speech).toContain('幽視值不足');
  jest.advanceTimersByTime(3000);
  expect(broadcasts).toHaveLength(2);
  listener.stop();
});

test('updateHandlers 後新指令生效', () => {
  const { listener, broadcasts } = makeListener();
  listener.start();
  listener.updateHandlers([{ trigger: 'command', match: '!新', animation: 'cry' }]);
  emitTwitch('!新');
  expect(broadcasts[0]).toMatchObject({ state: 'cry', animOnly: true });
  listener.stop();
});

test('getStatus 形狀與 stop 斷線', () => {
  const { listener } = makeListener();
  listener.start();
  const s = listener.getStatus();
  expect(s).toMatchObject({
    twitch:  { connected: true },
    youtube: { live: false, error: null },
    soop:    { connected: false },
  });
  listener.stop();
  expect(tmi.__instances[0].disconnected).toBe(true);
});

test('YouTube 未開播:15 分鐘查一次,checkYouTubeLiveNow 立即再查', async () => {
  const { google } = require('googleapis');
  const searchList = jest.fn().mockResolvedValue({ data: { items: [] } });   // 一直沒開播
  google.youtube.mockReturnValue({
    search: { list: searchList },
    videos: { list: jest.fn().mockResolvedValue({ data: { items: [] } }) },
    liveChatMessages: { list: jest.fn() },
  });
  process.env.YOUTUBE_API_KEY = 'test-key';
  const config = {
    twitch: { enabled: false }, soop: { enabled: false }, interactions: [],
    youtube: { enabled: true, channel: 'UCxxxx' },   // UC 開頭:不打 channels.list
  };
  const listener = createChatListener(config, { yolia_see: 0, state: 'idle' }, () => {});
  listener.start();

  await jest.advanceTimersByTimeAsync(0);
  expect(searchList).toHaveBeenCalledTimes(1);        // 啟動即查一次

  await jest.advanceTimersByTimeAsync(60_000);
  expect(searchList).toHaveBeenCalledTimes(1);        // 一分鐘內不重查(舊版 30 秒會爆 search 配額)

  expect(listener.checkYouTubeLiveNow()).toBe(true);  // 「我開播了」
  await jest.advanceTimersByTimeAsync(0);
  expect(searchList).toHaveBeenCalledTimes(2);        // 立即再查

  await jest.advanceTimersByTimeAsync(15 * 60 * 1000);
  expect(searchList).toHaveBeenCalledTimes(3);        // 例行 15 分鐘節奏

  listener.stop();
  delete process.env.YOUTUBE_API_KEY;
});
