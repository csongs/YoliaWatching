const tmi = require('tmi.js');
const { google } = require('googleapis');


const DEFAULT_GREETINGS = ['安安', '午安', '早安', '晚安'];

function buildGreetRe(greetings) {
  if (!greetings?.length) return null;
  const escaped = greetings.map(g => g.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(escaped.join('|'));
}

function applyCommand(sm, commands, broadcast, text, source = 'Chat', username = '', greetRe = null, greetResponse = '{user} {word}') {
  const trimmed = text.trim();
  const word = trimmed.split(' ')[0];
  const cmd = commands[word];

  if (!cmd) {
    // Non-command chat message: +1 yolia_see
    sm.yolia_see = Math.min(100, sm.yolia_see + 1);
    sm.state = sm.computeState();
    const matched = greetRe ? (trimmed.match(greetRe)?.[0] ?? null) : null;
    if (matched) {
      const speech = username
        ? greetResponse.replace('{user}', username).replace('{word}', matched)
        : matched;
      broadcast({ value: sm.yolia_see, state: 'wave', animOnly: true, speech });
    } else {
      broadcast({ value: sm.yolia_see, state: sm.state });
    }
    return;
  }

  if (cmd.yolia_see !== undefined) {
    sm.yolia_see = Math.max(0, Math.min(100, sm.yolia_see + cmd.yolia_see));
  }

  const speech = username ? `${username}: ${word}` : word;

  if (cmd.state) {
    sm.state = cmd.state;
    console.log(`[${source}] ${word} -> yolia_see: ${sm.yolia_see} state: ${sm.state}`);
    broadcast({ value: sm.yolia_see, state: sm.state, animOnly: true, speech });
    sm.state = sm.computeState();
    return;
  } else {
    sm.state = sm.computeState();
  }

  console.log(`[${source}] ${word} -> yolia_see: ${sm.yolia_see} state: ${sm.state}`);
  broadcast({ value: sm.yolia_see, state: sm.state, speech });
}

function createChatListener(config, commands, sm, broadcast) {
  const greetRe       = buildGreetRe(config.greetings ?? DEFAULT_GREETINGS);
  const greetResponse = config.greetingResponse ?? '{user} {word}';

  let twitchClient = null;
  let youtubeInterval = null;

  function startTwitch() {
    if (!config.twitch?.enabled || !config.twitch?.channel) return;
    twitchClient = new tmi.Client({
      identity: {
        username: config.twitch.channel,
        password: process.env.TWITCH_OAUTH,
      },
      channels: [config.twitch.channel],
    });
    twitchClient.on('message', (_channel, tags, message) => {
      const username = tags['display-name'] || tags.username || '';
      applyCommand(sm, commands, broadcast, message, 'Twitch', username, greetRe, greetResponse);
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
        liveVideoId = await resolveLiveVideoId(youtube);
        if (!liveVideoId) {
          if (!notLiveLogged) { console.log('[YouTube] no live stream found, will retry in 30s…'); notLiveLogged = true; }
          return { pageToken: null, delayMs: SEARCH_INTERVAL_MS };
        }
        notLiveLogged = false;
      }

      const videoRes = await youtube.videos.list({
        part: ['liveStreamingDetails'],
        id: [liveVideoId],
      });
      const chatId = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
      if (!chatId) {
        console.log('[YouTube] live stream ended, watching for next stream…');
        liveVideoId = null;
        notLiveLogged = false;
        lastSearchAt = 0;
        return { pageToken: null, delayMs: SEARCH_INTERVAL_MS };
      }
      if (!pageToken) console.log(`[YouTube] connected to live chat ${chatId}`);

      const chatRes = await youtube.liveChatMessages.list({
        liveChatId: chatId,
        part: ['snippet', 'authorDetails'],
        ...(pageToken ? { pageToken } : {}),
      });

      // Skip backlog on first connect (no pageToken); only process new messages
      if (pageToken) {
        for (const item of chatRes.data.items ?? []) {
          const text     = item.snippet?.displayMessage ?? '';
          const username = item.authorDetails?.displayName ?? '';
          applyCommand(sm, commands, broadcast, text, 'YouTube', username, greetRe, greetResponse);
        }
      }

      const delayMs = chatRes.data.pollingIntervalMillis ?? 5000;
      return { pageToken: chatRes.data.nextPageToken ?? null, delayMs };
    } catch (e) {
      console.error('YouTube chat error:', e.message);
      return { pageToken, delayMs: 5000 };
    }
  }

  return {
    start() {
      startTwitch();
      let ytPageToken = null;
      const scheduleYt = async () => {
        const { pageToken, delayMs } = await fetchYouTubeMessages(ytPageToken);
        ytPageToken = pageToken;
        youtubeInterval = setTimeout(scheduleYt, delayMs ?? SEARCH_INTERVAL_MS);
      };
      youtubeInterval = setTimeout(scheduleYt, 0);
    },
    stop() {
      twitchClient?.disconnect();
      if (youtubeInterval) clearTimeout(youtubeInterval);
    },
    getStatus() {
      return {
        twitch: { connected: twitchClient?.readyState?.() === 'OPEN' },
        youtube: { live: liveVideoId !== null },
      };
    },
  };
}

module.exports = { applyCommand, createChatListener, buildGreetRe };
