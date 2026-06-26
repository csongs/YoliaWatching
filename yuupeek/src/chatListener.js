const tmi = require('tmi.js');
const { google } = require('googleapis');
const { buildHandlers, computeState, processMessage: processMsg } = require('./chatProcessor');

function createChatListener(config, sm, broadcast) {
  let thresholds = (config.interactions ?? []).filter(i => i.trigger === 'threshold');
  let handlers   = buildHandlers(config.interactions ?? []);

  function processMessage(text, username, source) {
    const r = processMsg(text, username, handlers, sm.yolia_see, thresholds);
    sm.yolia_see = r.yolia_see;
    sm.state     = r.state;

    if (r.costDenied) {
      broadcast({ value: sm.yolia_see, state: sm.state, speech: r.speech });
      setTimeout(() => broadcast({ value: sm.yolia_see, state: sm.state }), 3000);
      return;
    }

    console.log(`[${source}] → yolia_see:${sm.yolia_see} state:${sm.state}`);
    broadcast({ value: sm.yolia_see, state: sm.state, animOnly: r.animOnly, speech: r.speech });
    if (r.resetState !== null) {
      setTimeout(() => { sm.state = r.resetState; broadcast({ value: sm.yolia_see, state: sm.state }); }, 3000);
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

  function isYouTubeQuotaError(error) {
    const reason  = getYouTubeErrorReason(error);
    const message = (error?.message ?? '').toLowerCase();
    return reason === 'quotaExceeded' || message.includes('quota');
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
  const SEARCH_INTERVAL_MS = 30_000;
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
    if (!config.youtube?.enabled || !config.youtube?.channel) return { pageToken, delayMs: SEARCH_INTERVAL_MS };
    if (youtubePaused) return { pageToken, stop: true };
    if (!process.env.YOUTUBE_API_KEY) {
      console.error('[YouTube] YOUTUBE_API_KEY not set');
      return { pageToken, delayMs: SEARCH_INTERVAL_MS };
    }

    if (!youtubeClient) youtubeClient = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });
    const youtube = youtubeClient;

    try {
      if (!liveVideoId) {
        const now = Date.now();
        if (now - lastSearchAt < SEARCH_INTERVAL_MS) return { pageToken: null, delayMs: SEARCH_INTERVAL_MS - (now - lastSearchAt) };
        lastSearchAt = now;
        liveVideoId  = await resolveLiveVideoId(youtube);
        if (!liveVideoId) {
          if (!notLiveLogged) { console.log('[YouTube] no live stream found, will retry in 30s…'); notLiveLogged = true; }
          return { pageToken: null, delayMs: SEARCH_INTERVAL_MS };
        }
        notLiveLogged = false;
      }

      const videoRes = await youtube.videos.list({ part: ['liveStreamingDetails'], id: [liveVideoId] });
      const chatId   = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        console.log('[YouTube] live stream ended, watching for next stream…');
        liveVideoId = null; notLiveLogged = false; lastSearchAt = 0;
        return { pageToken: null, delayMs: SEARCH_INTERVAL_MS };
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
      if (isYouTubeQuotaError(e)) {
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

  return {
    start() {
      stopped = false;
      startTwitch();
      startSoop().catch(e => console.error('[SOOP]', e.message));
      let ytPageToken = null;
      const scheduleYt = async () => {
        if (stopped) return;
        const { pageToken, delayMs } = await fetchYouTubeMessages(ytPageToken);
        ytPageToken = pageToken;
        if (!stopped) youtubeInterval = setTimeout(scheduleYt, delayMs ?? SEARCH_INTERVAL_MS);
      };
      youtubeInterval = setTimeout(scheduleYt, 0);
    },
    stop() {
      stopped = true;
      twitchClient?.disconnect();
      if (youtubeInterval) clearTimeout(youtubeInterval);
      soopChat = null;
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

module.exports = { createChatListener };
