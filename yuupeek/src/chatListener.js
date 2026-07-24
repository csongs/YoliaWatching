const tmi = require('tmi.js');
const { google } = require('googleapis');
const { buildHandlers, computeState, processMessage: processMsg, planMessageEffects } = require('./chatProcessor');
const YoutubePollPolicy = require('./youtubePollPolicy');

function createChatListener(config, sm, broadcast) {
  let thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
  let handlers   = buildHandlers(config.interactions ?? []);

  function processMessage(text, username, source) {
    const r = processMsg(text, username, handlers, sm.yolia_see, thresholds);
    sm.yolia_see = r.yolia_see;
    sm.state     = r.state;
    if (!r.costDenied) console.log(`[${source}] → yolia_see:${sm.yolia_see} state:${sm.state}`);

    // 「何時套用什麼」的決策收在 chatProcessor.planMessageEffects(雲端 overlay 共用同一份);
    // 這裡只負責把 patch 餵給 broadcast,以及桌面版特有的 sm.state 持久化(供 getStatus 等讀取)。
    const { immediate, delayed } = planMessageEffects(r, sm.yolia_see);
    broadcast(immediate);
    if (delayed) {
      setTimeout(() => {
        sm.state = delayed.patch.state;
        broadcast(delayed.patch);
      }, delayed.delayMs);
    }
  }

  let twitchClient     = null;
  let youtubeInterval  = null;
  let youtubePaused    = false;
  let youtubeErrorMessage = null;

  function getYouTubeErrorReason(error) {
    return error?.errors?.[0]?.reason
      || error?.response?.data?.error?.errors?.[0]?.reason
      || '';
  }

  function startTwitch() {
    if (!config.twitch?.enabled || !config.twitch?.channel) return;
    twitchClient = new tmi.Client({
      identity: { username: config.twitch.channel, password: process.env.TWITCH_OAUTH },
      channels: [config.twitch.channel],
    });
    twitchClient.on('message', (_channel, tags, message) => {
      const username = tags['display-name'] || tags.username || '';
      processMessage(message, username, 'Twitch');
    });
    twitchClient.connect()
      .then(() => console.log(`[Twitch] connected to #${config.twitch.channel}`))
      .catch((e) => console.error('[Twitch] connection failed:', e.message));
  }

  let liveVideoId    = null;
  let resolvedChanId = null;
  let notLiveLogged  = false;
  let lastSearchAt   = 0;
  // 找直播節奏/quota 判斷收斂在 youtubePollPolicy.js(桌面與雲端 overlay 共用同一份純函數,
  // sync.js 複製到 web/public);要立即偵測用面板「我開播了」(checkYouTubeLiveNow)。
  const { LIVE_CHECK_INTERVAL_MS, RETRY_INTERVAL_MS } = YoutubePollPolicy;
  let youtubeClient  = null;

  async function resolveLiveVideoId(youtube) {
    const ch = config.youtube.channel;
    if (!resolvedChanId) {
      if (ch.startsWith('UC')) {
        resolvedChanId = ch;
        console.log('[YouTube] using channel ID:', resolvedChanId);
      } else {
        const handle = ch.startsWith('@') ? ch : `@${ch}`;
        console.log('[YouTube] resolving channel handle:', handle);
        const res = await youtube.channels.list({ part: ['id'], forHandle: handle });
        resolvedChanId = res.data.items?.[0]?.id ?? null;
        if (!resolvedChanId) { console.log('[YouTube] channel not found:', handle); return null; }
        console.log('[YouTube] channel ID:', resolvedChanId);
      }
    }
    const searchRes = await youtube.search.list({
      part: ['id'], channelId: resolvedChanId,
      eventType: 'live', type: 'video', maxResults: 1,
    });
    return searchRes.data.items?.[0]?.id?.videoId ?? null;
  }

  async function fetchYouTubeMessages(pageToken) {
    if (!config.youtube?.enabled || !config.youtube?.channel) return { pageToken, delayMs: RETRY_INTERVAL_MS };
    if (youtubePaused) return { pageToken, stop: true };
    if (!process.env.YOUTUBE_API_KEY) {
      console.error('[YouTube] YOUTUBE_API_KEY not set');
      return { pageToken, delayMs: RETRY_INTERVAL_MS };
    }

    if (!youtubeClient) youtubeClient = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    const youtube = youtubeClient;

    try {
      if (!liveVideoId) {
        const now = Date.now();
        const check = YoutubePollPolicy.shouldCheckLiveNow(now, lastSearchAt, LIVE_CHECK_INTERVAL_MS);
        if (!check.ready) return { pageToken: null, delayMs: check.delayMs };
        lastSearchAt = now;
        liveVideoId  = await resolveLiveVideoId(youtube);
        if (!liveVideoId) {
          if (!notLiveLogged) { console.log('[YouTube] no live stream found, next check in 15 min (use panel「我開播了」to check now)'); notLiveLogged = true; }
          return { pageToken: null, delayMs: LIVE_CHECK_INTERVAL_MS };
        }
        notLiveLogged = false;
      }

      const videoRes = await youtube.videos.list({ part: ['liveStreamingDetails'], id: [liveVideoId] });
      const chatId   = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        console.log('[YouTube] live stream ended, watching for next stream…');
        liveVideoId = null; notLiveLogged = false; lastSearchAt = 0;   // 歸零:30 秒後立刻搜一次(接續開下一台),之後回 15 分鐘節奏
        return { pageToken: null, delayMs: RETRY_INTERVAL_MS };
      }
      if (!pageToken) console.log(`[YouTube] connected to live chat ${chatId}`);

      const chatRes = await youtube.liveChatMessages.list({
        liveChatId: chatId,
        part: ['snippet', 'authorDetails'],
        ...(pageToken ? { pageToken } : {}),
      });

      if (pageToken) {
        for (const item of chatRes.data.items ?? []) {
          const text     = item.snippet?.displayMessage ?? '';
          const username = item.authorDetails?.displayName ?? '';
          processMessage(text, username, 'YouTube');
        }
      }

      return { pageToken: chatRes.data.nextPageToken ?? null, delayMs: chatRes.data.pollingIntervalMillis ?? 5000 };
    } catch (e) {
      if (YoutubePollPolicy.classifyYoutubeError({ reason: getYouTubeErrorReason(e), message: e.message }).quota) {
        youtubePaused       = true;
        youtubeErrorMessage = '已超過 YouTube API 配額，YouTube 聊天監聽已停止。';
        console.error('[YouTube] quota exceeded, stop polling:', e.message);
        return { pageToken, stop: true };
      }
      console.error('YouTube chat error:', e.message);
      return { pageToken, delayMs: 5000 };
    }
  }

  // ── SOOP ──────────────────────────────────────────────────────────────────────
  let soopChat = null;

  async function startSoop() {
    if (!config.soop?.enabled || !config.soop?.channel) return;
    if (config.soop.apiMode === 'official') {
      console.log('[SOOP] 官方 API 模式尚未實作，請改用社群模式 (B)');
      return;
    }
    try {
      const { SoopClient, SoopChatEvent } = await import('soop-extension');
      const client = new SoopClient();
      soopChat = client.chat({ streamerId: config.soop.channel });
      soopChat.on(SoopChatEvent.CHAT, (res) => {
        processMessage(res.comment, res.username, 'SOOP');
      });
      soopChat.on(SoopChatEvent.DISCONNECT, () => {
        console.log('[SOOP] stream ended');
        soopChat = null;
      });
      await soopChat.connect();
      console.log(`[SOOP] connected to ${config.soop.channel}`);
    } catch (e) {
      console.error('[SOOP] failed:', e.message);
      soopChat = null;
    }
  }

  let stopped = false;
  let ytPageToken = null;
  let ytBusy = false;   // 抓取進行中(手動觸發撞上時忽略,靠 lastSearchAt=0 讓該輪立即搜)

  async function scheduleYt() {
    if (stopped || ytBusy) return;
    ytBusy = true;
    const { pageToken, delayMs } = await fetchYouTubeMessages(ytPageToken);
    ytPageToken = pageToken;
    ytBusy = false;
    if (!stopped) youtubeInterval = setTimeout(scheduleYt, delayMs ?? RETRY_INTERVAL_MS);
  }

  return {
    start() {
      stopped = false;
      startTwitch();
      startSoop().catch(e => console.error('[SOOP]', e.message));
      ytPageToken = null;
      youtubeInterval = setTimeout(scheduleYt, 0);
    },
    stop() {
      stopped = true;
      twitchClient?.disconnect();
      if (youtubeInterval) clearTimeout(youtubeInterval);
      soopChat = null;
    },
    // 面板「我開播了」:清除找直播的節流,立刻查一次(不等 15 分鐘)。
    // 配額已爆(youtubePaused)時查了也是白查,直接回 false 讓面板顯示原因。
    checkYouTubeLiveNow() {
      if (stopped || youtubePaused) return false;
      lastSearchAt  = 0;
      notLiveLogged = false;
      if (youtubeInterval) clearTimeout(youtubeInterval);
      youtubeInterval = setTimeout(scheduleYt, 0);
      return true;
    },
    updateHandlers(interactions) {
      thresholds = (interactions ?? []).filter(i => i.trigger === 'threshold');
      handlers   = buildHandlers(interactions ?? []);
    },
    getStatus() {
      return {
        twitch:  { connected: twitchClient?.readyState?.() === 'OPEN' },
        youtube: { live: liveVideoId !== null, error: youtubeErrorMessage },
        soop:    { connected: soopChat !== null },
      };
    },
  };
}

// 設定變更(或啟動)時決定要不要有監聽器:停掉舊的,三平台任一 enabled 就開新的,否則回 null。
// 抽出來給 main.js 三個呼叫點(啟動時/saveConfig/saveEnv)共用,原本各自複製這 8 行邏輯。
function restartChatListener(prev, config, sm, broadcast) {
  prev?.stop();
  if (config.twitch?.enabled || config.youtube?.enabled || config.soop?.enabled) {
    const next = createChatListener(config, sm, broadcast);
    next.start();
    return next;
  }
  return null;
}

module.exports = { createChatListener, restartChatListener };
