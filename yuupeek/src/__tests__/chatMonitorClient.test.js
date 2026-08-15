// chatMonitorClient 測試(2026-08-16 新增,取代 chatListener.test.js——聊天來源改接
// chat-monitor 的 WebSocket,不再自己連 Twitch/YouTube/SOOP)。'ws' 全部 mock,
// 用 __instances 存住建立過的 client,測試手動呼叫 handlers 模擬 chat-monitor 送來的訊息。
jest.mock('ws', () => {
  const instances = [];
  class WebSocket {
    constructor(url) { this.url = url; this.handlers = {}; this.closed = false; instances.push(this); }
    on(evt, cb) { this.handlers[evt] = cb; }
    close() { this.closed = true; }
    removeAllListeners() { this.handlers = {}; }
    emit(evt, ...args) { this.handlers[evt]?.(...args); }
  }
  return Object.assign(WebSocket, { __instances: instances });
});

const WebSocket = require('ws');
const { createChatMonitorClient } = require('../chatMonitorClient');

function latestSocket() {
  return WebSocket.__instances[WebSocket.__instances.length - 1];
}

function makeClient(interactions = [], smInit = { yolia_see: 0, state: 'idle' }) {
  const config = { interactions };
  const sm = { ...smInit };
  const broadcasts = [];
  const client = createChatMonitorClient(config, sm, (p) => broadcasts.push(p));
  return { client, sm, broadcasts };
}

function emitChat(text, username = '觀眾', platform = 'twitch') {
  latestSocket().emit('message', JSON.stringify({
    type: 'event',
    data: { event_type: 'chat', message: text, username, platform },
  }));
}

beforeEach(() => { WebSocket.__instances.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('一般聊天訊息:+1 並廣播 value/state', () => {
  const { client, sm, broadcasts } = makeClient();
  client.start();
  emitChat('安安');
  expect(sm.yolia_see).toBe(1);
  expect(broadcasts[0]).toMatchObject({ value: 1, animOnly: false });
  client.stop();
});

test('event_type 不是 chat 就忽略(這次收斂範圍不含斗內/訂閱等事件)', () => {
  const { broadcasts, client } = makeClient();
  client.start();
  latestSocket().emit('message', JSON.stringify({
    type: 'event',
    data: { event_type: 'cheer', message: 'Cheer100', username: '觀眾', platform: 'twitch', amount: '100' },
  }));
  expect(broadcasts).toHaveLength(0);
  client.stop();
});

test('指令動畫:animOnly 廣播+3 秒後 resetState 廣播', () => {
  const { client, broadcasts } = makeClient([
    { trigger: 'command', match: '!跳', animation: 'jump' },
  ]);
  client.start();
  emitChat('!跳');
  expect(broadcasts[0]).toMatchObject({ state: 'jump', animOnly: true });
  jest.advanceTimersByTime(3000);
  expect(broadcasts[1]).toMatchObject({ state: 'idle' });
  client.stop();
});

test('updateHandlers 後新指令生效', () => {
  const { client, broadcasts } = makeClient();
  client.start();
  client.updateHandlers([{ trigger: 'command', match: '!新', animation: 'cry' }]);
  emitChat('!新');
  expect(broadcasts[0]).toMatchObject({ state: 'cry', animOnly: true });
  client.stop();
});

test('getStatus:open 後 connected 為 true,close 後回 false 並排程重連', () => {
  const { client } = makeClient();
  client.start();
  expect(client.getStatus()).toMatchObject({ connected: false });
  latestSocket().emit('open');
  expect(client.getStatus()).toMatchObject({ connected: true });
  latestSocket().emit('close');
  expect(client.getStatus()).toMatchObject({ connected: false });
  jest.advanceTimersByTime(3000);
  expect(WebSocket.__instances.length).toBe(2); // 重連建立了第二個 socket
  client.stop();
});

test('stop() 關閉連線且不再重連', () => {
  const { client } = makeClient();
  client.start();
  const first = latestSocket();
  client.stop();
  expect(first.closed).toBe(true);
  jest.advanceTimersByTime(10_000);
  expect(WebSocket.__instances.length).toBe(1); // stop 之後 close 事件不會再排程重連
});
