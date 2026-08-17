// chatMonitorClient 測試(2026-08-16 新增,取代 chatListener.test.js——聊天來源改接
// chat-monitor 的 WebSocket,不再自己連 Twitch/YouTube/SOOP)。'ws' 全部 mock,
// 用 __instances 存住建立過的 client,測試手動呼叫 handlers 模擬 chat-monitor 送來的訊息。
// 2026-08-16 二次收斂:互動規則改事件類型導向,這裡不再只轉發 event_type==='chat',
// 而是把每個事件都交給規則引擎(chatProcessor.processEvent)決定要不要反應。
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

function emitEvent(data) {
  latestSocket().emit('message', JSON.stringify({ type: 'event', data }));
}

function emitChat(text, username = '觀眾', platform = 'twitch') {
  emitEvent({ event_type: 'chat', message: text, username, platform });
}

beforeEach(() => { WebSocket.__instances.length = 0; jest.useFakeTimers(); });
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); });

test('沒有任何規則配到 → 不廣播(不再像舊版自動 +1)', () => {
  const { client, sm, broadcasts } = makeClient();
  client.start();
  emitChat('安安');
  expect(sm.yolia_see).toBe(0);
  expect(broadcasts).toHaveLength(0);
  client.stop();
});

test('catch-all 規則(不填 match)才會讓一般聊天 +1', () => {
  const { client, sm, broadcasts } = makeClient([
    { id: 'base', eventTypes: ['chat'], energyDelta: 1 },
  ]);
  client.start();
  emitChat('安安');
  expect(sm.yolia_see).toBe(1);
  expect(broadcasts[0]).toMatchObject({ value: 1, animOnly: false });
  client.stop();
});

test('非 chat 事件(例如 cheer)只要有規則配到就會觸發,不再被過濾掉', () => {
  const { client, sm, broadcasts } = makeClient([
    { id: 'r1', eventTypes: ['donation'], action: 'cheer', energyDelta: 10 },
  ]);
  client.start();
  emitEvent({ event_type: 'cheer', message: 'Cheer100', username: '觀眾', platform: 'twitch', amount: '100' });
  expect(sm.yolia_see).toBe(10);
  expect(broadcasts[0]).toMatchObject({ state: 'cheer', animOnly: true });
  client.stop();
});

test('沒有規則的事件類型仍然被忽略(不是每個事件都會做事,要規則配到才算)', () => {
  const { broadcasts, client } = makeClient([{ id: 'r1', eventTypes: ['donation'], action: 'cheer' }]);
  client.start();
  emitEvent({ event_type: 'raid', message: null, username: '觀眾', platform: 'twitch', amount: '5' });
  expect(broadcasts).toHaveLength(0);
  client.stop();
});

test('指令動畫(matchMode:prefix):animOnly 廣播+3 秒後 resetState 廣播', () => {
  const { client, broadcasts } = makeClient([
    { id: 'c1', eventTypes: ['chat'], matchMode: 'prefix', match: '!跳', action: 'jump' },
  ]);
  client.start();
  emitChat('!跳');
  expect(broadcasts[0]).toMatchObject({ state: 'jump', animOnly: true });
  jest.advanceTimersByTime(3000);
  expect(broadcasts[1]).toMatchObject({ state: 'idle' });
  client.stop();
});

test('updateHandlers 後新規則生效', () => {
  const { client, broadcasts } = makeClient();
  client.start();
  client.updateHandlers([{ id: 'c1', eventTypes: ['chat'], matchMode: 'prefix', match: '!新', action: 'cry' }]);
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
