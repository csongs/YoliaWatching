const tmi = require('tmi.js');
const { google } = require('googleapis');

function buildHandlers(interactions) {
  const kwInteractions = interactions.filter(i => i.trigger === 'keyword');
  const commandMap = {};
  for (const i of interactions.filter(i => i.trigger === 'command')) {
    if (i.match) commandMap[i.match] = i;
  }
  let keywordRe = null;
  if (kwInteractions.length) {
    const allWords = kwInteractions.flatMap(i => Array.isArray(i.match) ? i.match : [i.match]);
    const escaped  = allWords.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    keywordRe = new RegExp(escaped.join('|'));
  }
  return { kwInteractions, commandMap, keywordRe };
}

function createChatListener(config, sm, broadcast) {
  const { kwInteractions, commandMap, keywordRe } = buildHandlers(config.interactions ?? []);

  function processMessage(text, username, source) {
    const trimmed = text.trim();
    const word    = trimmed.split(' ')[0];
    const cmd     = commandMap[word];

    if (cmd) {
      // Cost gate
      if (cmd.cost !== undefined && sm.yolia_see < cmd.cost) {
        const diff   = Math.ceil(cmd.cost - sm.yolia_see);
        const speech = username
          ? `${username} 幽視值不足，還差 ${diff}！`
          : `幽視值不足，還差 ${diff}！`;
        broadcast({ value: sm.yolia_see, state: sm.state, speech });
        return;
      }
      if (cmd.cost      !== undefined) sm.yolia_see = Math.max(0, sm.yolia_see - cmd.cost);
      if (cmd.yolia_see !== undefined) sm.yolia_see = Math.max(0, Math.min(100, sm.yolia_see + cmd.yolia_see));
      sm.state = sm.computeState();

      const speech = cmd.response
        ? cmd.response.replace('{user}', username)
        : username ? `${username}: ${word}` : word;

      console.log(`[${source}] ${word} → yolia_see:${sm.yolia_see} anim:${cmd.animation ?? sm.state}`);
      broadcast({ value: sm.yolia_see, state: cmd.animation ?? sm.state, animOnly: !!cmd.animation, speech });
      if (cmd.animation) {
        setTimeout(() => { sm.state = sm.computeState(); broadcast({ value: sm.yolia_see, state: sm.state }); }, 3000);
      }
      return;
    }

    // Non-command: +1 yolia_see
    sm.yolia_see = Math.min(100, sm.yolia_see + 1);
    sm.state     = sm.computeState();

    const matched = keywordRe ? trimmed.match(keywordRe)?.[0] : null;
    if (matched) {
      const kw = kwInteractions.find(i => (Array.isArray(i.match) ? i.match : [i.match]).includes(matched));
      if (kw?.yolia_see) {
        sm.yolia_see = Math.max(0, Math.min(100, sm.yolia_see + kw.yolia_see));
        sm.state = sm.computeState();
      }
      const speech = (kw?.response ?? '')
        .replace('{user}', username)
        .replace('{word}', matched)
        || (username ? `${username} ${matched}` : matched);
      broadcast({ value: sm.yolia_see, state: kw?.animation ?? 'wave', animOnly: true, speech });
    } else {
      broadcast({ value: sm.yolia_see, state: sm.state });
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

    const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

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

  let stopped = false;

  return {
    start() {
      stopped = false;
      startTwitch();
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
    },
    getStatus() {
      return {
        twitch:  { connected: twitchClient?.readyState?.() === 'OPEN' },
        youtube: { live: liveVideoId !== null, error: youtubeErrorMessage },
      };
    },
  };
}

module.exports = { createChatListener };
