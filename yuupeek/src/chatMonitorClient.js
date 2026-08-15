// 聊天來源改接 chat-monitor(獨立 process,見 chat-monitor/README.md)——這裡不再自己連
// Twitch IRC / YouTube API / SOOP,只當 chat-monitor 的 ws://.../ws 的唯讀 client。
// 取代原本的 chatListener.js(2026-08-16 收斂,決策記錄見該次對話:即時事件走 WS,
// 不碰 chat-monitor 的 SQLite;這次只接 event_type==='chat',斗內/訂閱/Raid 等事件先不管)。
const WebSocket = require('ws');
const { buildHandlers, processMessage: processMsg, planMessageEffects } = require('./chatProcessor');

const RECONNECT_MS = 3000;

function createChatMonitorClient(config, sm, broadcast, opts = {}) {
  const url = opts.url ?? `ws://127.0.0.1:${process.env.CHAT_MONITOR_PORT || 3100}/ws`;
  let thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
  let handlers   = buildHandlers(config.interactions ?? []);
  let ws = null;
  let connected = false;
  let stopped = true;
  let reconnectTimer = null;

  function processMessage(text, username, source) {
    const r = processMsg(text, username, handlers, sm.yolia_see, thresholds);
    sm.yolia_see = r.yolia_see;
    sm.state     = r.state;
    if (!r.costDenied) console.log(`[${source}] → yolia_see:${sm.yolia_see} state:${sm.state}`);

    // 「何時套用什麼」的決策收在 chatProcessor.planMessageEffects(雲端 overlay 共用同一份時期
    // 留下的模式);這裡只負責把 patch 餵給 broadcast,以及桌面版特有的 sm.state 持久化。
    const { immediate, delayed } = planMessageEffects(r, sm.yolia_see);
    broadcast(immediate);
    if (delayed) {
      setTimeout(() => {
        sm.state = delayed.patch.state;
        broadcast(delayed.patch);
      }, delayed.delayMs);
    }
  }

  // 這次收斂範圍只到「一般聊天文字」——斗內/訂閱/Raid 等 event_type 目前直接忽略,
  // 不驅動任何動畫/幽視值變化(現有 interactions 的 threshold/keyword/command 三種規則
  // 本來就只設計給聊天文字用,事件類需要新的規則格式,留給以後單獨做)。
  function handleEvent(evt) {
    if (!evt || evt.event_type !== 'chat') return;
    processMessage(evt.message ?? '', evt.username ?? '', evt.platform ?? 'chat-monitor');
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
      handlers   = buildHandlers(interactions ?? []);
    },
    getStatus() {
      return { connected };
    },
  };
}

module.exports = { createChatMonitorClient };
