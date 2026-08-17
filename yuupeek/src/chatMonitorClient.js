// 聊天來源改接 chat-monitor(獨立 process,見 chat-monitor/README.md)——這裡不再自己連
// Twitch IRC / YouTube API / SOOP,只當 chat-monitor 的 ws://.../ws 的唯讀 client。
// 取代原本的 chatListener.js(2026-08-16 收斂:即時事件走 WS,不碰 chat-monitor 的
// SQLite)。互動規則改成事件類型導向(同次收斂,見 chatProcessor.js)——這裡把每個
// event_type 都轉發給規則引擎,規則本身有沒有配到、要不要理會斗內/訂閱/Raid 等事件,
// 交給使用者在面板設定的 eventTypes 決定,這層不再自己過濾。
const WebSocket = require('ws');
const { buildEventHandlers, processEvent, planMessageEffects } = require('./chatProcessor');
const { categoryFor } = require('./chatMonitorEventTypes');

const RECONNECT_MS = 3000;

function createChatMonitorClient(config, sm, broadcast, opts = {}) {
  const url = opts.url ?? `ws://127.0.0.1:${process.env.CHAT_MONITOR_PORT || 3100}/ws`;
  let thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
  let handlers   = buildEventHandlers(config.interactions ?? []);
  let ws = null;
  let connected = false;
  let stopped = true;
  let reconnectTimer = null;

  function handleEvent(raw) {
    if (!raw) return;
    const evt = {
      eventType: raw.event_type,
      category:  categoryFor(raw.event_type),
      message:   raw.message,
      username:  raw.username,
    };
    const r = processEvent(evt, handlers, sm.yolia_see, thresholds);
    if (!r) return; // 沒有規則配到這個事件,什麼都不做

    sm.yolia_see = r.yolia_see;
    sm.state     = r.state;
    if (!r.costDenied) console.log(`[${raw.platform ?? 'chat-monitor'}] ${raw.event_type} → yolia_see:${sm.yolia_see} state:${sm.state}`);

    // 「何時套用什麼」的決策收在 chatProcessor.planMessageEffects;這裡只負責把 patch
    // 餵給 broadcast,以及桌面版特有的 sm.state 持久化。
    const { immediate, delayed } = planMessageEffects(r, sm.yolia_see);
    broadcast(immediate);
    if (delayed) {
      setTimeout(() => {
        sm.state = delayed.patch.state;
        broadcast(delayed.patch);
      }, delayed.delayMs);
    }
  }

  function scheduleReconnect() {
    if (stopped || reconnectTimer) return;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, RECONNECT_MS);
  }

  function connect() {
    if (stopped) return;
    ws = new WebSocket(url);
    ws.on('open', () => {
      connected = true;
      console.log(`[chat-monitor] connected ${url}`);
    });
    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw); } catch { return; }
      if (msg.type === 'event') handleEvent(msg.data);
    });
    ws.on('close', () => {
      connected = false;
      ws = null;
      scheduleReconnect();
    });
    // ws 沒有 error listener 時,連線失敗(例如 chat-monitor 沒開)會變成 uncaught exception;
    // 'close' 事件本來就會接著觸發,這裡不用重複處理,只是需要有個 listener 接住不讓它炸掉。
    ws.on('error', () => {});
  }

  return {
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      ws?.removeAllListeners?.();
      ws?.close();
      ws = null;
      connected = false;
    },
    updateHandlers(interactions) {
      thresholds = (interactions ?? []).filter(i => i.trigger === 'threshold');
      handlers   = buildEventHandlers(interactions ?? []);
    },
    getStatus() {
      return { connected };
    },
  };
}

module.exports = { createChatMonitorClient };
