# Chat Integration Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Allow Twitch and YouTube Live viewers to trigger YuuPeek animations and affect yuushi via chat commands, with a local HTTP+WebSocket server for OBS Browser Source.

**Architecture:** Extend the existing Electron `main.js` with three new concerns gated by `config.json` flags: an OBS HTTP/WebSocket server (`obsServer.js`), a chat listener (`chatListener.js`), and an OBS overlay page (`obs-overlay.html`). One state machine instance drives both the Electron overlay and all WebSocket clients.

**Tech Stack:** Node.js/Electron, Jest, `tmi.js` (Twitch IRC), `googleapis` (YouTube Live Chat), `ws` (WebSocket server), `dotenv` (.env loading)

---

### Task 1: Install Dependencies and Create Config Files

**Files:**
- Modify: `yuupeek/package.json`
- Create: `yuupeek/config.json`
- Create: `yuupeek/commands.json`
- Create: `yuupeek/.env` (template only — add real values manually)
- Modify: `yuupeek/.gitignore` (or create if missing)

**Step 1: Install new packages**

Run inside `yuupeek/`:
```
npm install tmi.js googleapis ws dotenv
```
Expected: packages appear in `node_modules/`, `package.json` dependencies updated.

**Step 2: Create `config.json`**

```json
{
  "modes": {
    "overlay": true,
    "obs": true
  },
  "obs": {
    "port": 3000
  },
  "twitch": {
    "enabled": true,
    "channel": "your_channel"
  },
  "youtube": {
    "enabled": true,
    "videoId": "LIVE_VIDEO_ID"
  }
}
```

**Step 3: Create `commands.json`**

```json
{
  "!cheer": { "state": "cheer", "yuushi": 10 },
  "!cry":   { "state": "cry",   "yuushi": -15 },
  "!feed":  { "state": "eat",   "yuushi": 0 },
  "!poke":  {                   "yuushi": -5 }
}
```

**Step 4: Create `.env` template**

```
TWITCH_OAUTH=oauth:your_token_here
YOUTUBE_API_KEY=your_api_key_here
```

**Step 5: Ensure `.gitignore` includes `.env`**

Check if `yuupeek/.gitignore` exists. If not, create it. Make sure it contains:
```
.env
node_modules/
```

**Step 6: Commit**

```bash
git add yuupeek/config.json yuupeek/commands.json yuupeek/.gitignore yuupeek/package.json yuupeek/package-lock.json
git commit -m "feat: add chat integration config files and dependencies"
```

---

### Task 2: `src/chatListener.js` — Command Parsing Logic (TDD)

**Files:**
- Create: `yuupeek/src/__tests__/chatListener.test.js`
- Create: `yuupeek/src/chatListener.js`

**Step 1: Write failing tests for `applyCommand`**

Create `yuupeek/src/__tests__/chatListener.test.js`:

```js
const { applyCommand } = require('../chatListener');

const commands = {
  '!cheer': { state: 'cheer', yuushi: 10 },
  '!cry':   { state: 'cry',   yuushi: -15 },
  '!poke':  { yuushi: -5 },
  '!eat':   { state: 'eat' },
};

function makeSm(yuushi = 50) {
  return {
    yuushi,
    state: 'idle',
    computeState() {
      if (this.yuushi >= 80) return 'cheer';
      if (this.yuushi >= 40) return 'peek';
      return 'idle';
    },
  };
}

test('unknown command does nothing', () => {
  const sm = makeSm();
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!unknown');
  expect(broadcast).not.toHaveBeenCalled();
  expect(sm.yuushi).toBe(50);
});

test('command with yuushi delta adjusts yuushi', () => {
  const sm = makeSm(50);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!cheer');
  expect(sm.yuushi).toBe(60);
  expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ value: 60 }));
});

test('yuushi clamps at 100', () => {
  const sm = makeSm(95);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!cheer');
  expect(sm.yuushi).toBe(100);
});

test('yuushi clamps at 0', () => {
  const sm = makeSm(5);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!cry');
  expect(sm.yuushi).toBe(0);
});

test('command with state sets sm.state', () => {
  const sm = makeSm(50);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!cheer');
  expect(sm.state).toBe('cheer');
});

test('command without state leaves state at computeState()', () => {
  const sm = makeSm(50);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!poke');
  expect(sm.state).toBe('peek'); // 45 yuushi → peek
});

test('command text with leading/trailing whitespace is trimmed', () => {
  const sm = makeSm(50);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '  !poke  ');
  expect(sm.yuushi).toBe(45);
});

test('only first word is matched (ignores trailing args)', () => {
  const sm = makeSm(50);
  const broadcast = jest.fn();
  applyCommand(sm, commands, broadcast, '!poke target extra');
  expect(sm.yuushi).toBe(45);
});
```

**Step 2: Run tests to verify they fail**

Run: `cd yuupeek && npx jest src/__tests__/chatListener.test.js`
Expected: FAIL — `Cannot find module '../chatListener'`

**Step 3: Write minimal `chatListener.js` to pass tests**

Create `yuupeek/src/chatListener.js`:

```js
const STATE_DURATION_MS = 3000;

function applyCommand(sm, commands, broadcast, text) {
  const word = text.trim().split(' ')[0];
  const cmd = commands[word];
  if (!cmd) return;

  if (cmd.yuushi !== undefined) {
    sm.yuushi = Math.max(0, Math.min(100, sm.yuushi + cmd.yuushi));
  }

  if (cmd.state) {
    sm.state = cmd.state;
    setTimeout(() => {
      sm.state = sm.computeState();
      broadcast({ value: sm.yuushi, state: sm.state });
    }, STATE_DURATION_MS);
  } else {
    sm.state = sm.computeState();
  }

  broadcast({ value: sm.yuushi, state: sm.state });
}

function createChatListener(config, commands, sm, broadcast) {
  return {
    start() {},
    stop() {},
  };
}

module.exports = { applyCommand, createChatListener };
```

**Step 4: Run tests to verify they pass**

Run: `cd yuupeek && npx jest src/__tests__/chatListener.test.js`
Expected: 8 tests PASS

**Step 5: Commit**

```bash
git add yuupeek/src/chatListener.js yuupeek/src/__tests__/chatListener.test.js
git commit -m "feat: add chatListener command parsing logic with tests"
```

---

### Task 3: Twitch Chat Connection

**Files:**
- Modify: `yuupeek/src/chatListener.js`

**Step 1: Add Twitch connection to `createChatListener`**

Replace the `createChatListener` function in `chatListener.js` (keep `applyCommand` unchanged):

```js
const tmi = require('tmi.js');

function createChatListener(config, commands, sm, broadcast) {
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
    twitchClient.on('message', (_channel, _tags, message) => {
      applyCommand(sm, commands, broadcast, message);
    });
    twitchClient.connect().catch(console.error);
  }

  return {
    start() {
      startTwitch();
    },
    stop() {
      twitchClient?.disconnect();
      if (youtubeInterval) clearInterval(youtubeInterval);
    },
  };
}
```

Note: `youtubeInterval` is declared here for use in Task 4.

**Step 2: Manual smoke test (optional)**

Fill in `.env` with a real Twitch OAuth token and channel name. Run `npm start` with `modes.obs = false` and `modes.overlay = true`. Type a command in your Twitch chat — check the Electron overlay responds.

**Step 3: Commit**

```bash
git add yuupeek/src/chatListener.js
git commit -m "feat: add Twitch IRC chat listener"
```

---

### Task 4: YouTube Live Chat Polling

**Files:**
- Modify: `yuupeek/src/chatListener.js`

**Step 1: Add YouTube polling to `start()`**

Inside `createChatListener`, add after `startTwitch()`:

```js
const { google } = require('googleapis');

async function fetchYouTubeMessages(pageToken) {
  if (!config.youtube?.enabled || !config.youtube?.videoId) return pageToken;
  if (!process.env.YOUTUBE_API_KEY) return pageToken;

  const youtube = google.youtube({ version: 'v3', auth: process.env.YOUTUBE_API_KEY });

  try {
    // Get the live chat ID from the video
    const videoRes = await youtube.videos.list({
      part: ['liveStreamingDetails'],
      id: [config.youtube.videoId],
    });
    const chatId = videoRes.data.items?.[0]?.liveStreamingDetails?.activeLiveChatId;
    if (!chatId) return pageToken;

    const chatRes = await youtube.liveChatMessages.list({
      liveChatId: chatId,
      part: ['snippet'],
      ...(pageToken ? { pageToken } : {}),
    });

    for (const item of chatRes.data.items ?? []) {
      const text = item.snippet?.displayMessage ?? '';
      applyCommand(sm, commands, broadcast, text);
    }

    return chatRes.data.nextPageToken ?? null;
  } catch (e) {
    console.error('YouTube chat error:', e.message);
    return pageToken;
  }
}
```

Then in `start()`, after `startTwitch()`:

```js
let ytPageToken = null;
youtubeInterval = setInterval(async () => {
  ytPageToken = await fetchYouTubeMessages(ytPageToken);
}, 5000);
```

**Step 2: Commit**

```bash
git add yuupeek/src/chatListener.js
git commit -m "feat: add YouTube Live Chat polling"
```

---

### Task 5: `src/obsServer.js` — HTTP + WebSocket Server (TDD)

**Files:**
- Create: `yuupeek/src/__tests__/obsServer.test.js`
- Create: `yuupeek/src/obsServer.js`

**Step 1: Write failing tests**

Create `yuupeek/src/__tests__/obsServer.test.js`:

```js
const http = require('http');
const WebSocket = require('ws');
const { createObsServer } = require('../obsServer');

let server;
let port;

beforeEach(async () => {
  server = createObsServer({ port: 0 }, __dirname); // port 0 = random free port
  await server.start();
  port = server.port();
});

afterEach(async () => {
  await server.stop();
});

test('GET / returns 200 with HTML content', (done) => {
  http.get(`http://localhost:${port}/`, (res) => {
    expect(res.statusCode).toBe(200);
    done();
  });
});

test('broadcast sends JSON to all connected WebSocket clients', (done) => {
  const ws = new WebSocket(`ws://localhost:${port}`);
  ws.on('open', () => {
    server.broadcast({ value: 72, state: 'cheer' });
  });
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    expect(msg).toEqual({ value: 72, state: 'cheer' });
    ws.close();
    done();
  });
});

test('broadcast does not throw when no clients connected', () => {
  expect(() => server.broadcast({ value: 50, state: 'idle' })).not.toThrow();
});
```

**Step 2: Run tests to verify they fail**

Run: `cd yuupeek && npx jest src/__tests__/obsServer.test.js`
Expected: FAIL — `Cannot find module '../obsServer'`

**Step 3: Write `obsServer.js`**

Create `yuupeek/src/obsServer.js`:

```js
const http = require('http');
const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');

const MIME = {
  '.html': 'text/html',
  '.js':   'text/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.gif':  'image/gif',
};

function createObsServer(obsConfig, rootDir) {
  // rootDir defaults to the yuupeek project root
  const root = rootDir ?? path.join(__dirname, '..');
  let httpServer = null;
  let wss = null;

  const requestHandler = (req, res) => {
    let filePath;
    if (req.url === '/' || req.url === '/index.html') {
      filePath = path.join(root, 'renderer', 'obs-overlay.html');
    } else {
      filePath = path.join(root, req.url);
    }

    // Prevent path traversal
    if (!filePath.startsWith(root)) {
      res.writeHead(403);
      res.end();
      return;
    }

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      const ext = path.extname(filePath);
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    });
  };

  return {
    start() {
      return new Promise((resolve) => {
        httpServer = http.createServer(requestHandler);
        wss = new WebSocket.Server({ server: httpServer });
        httpServer.listen(obsConfig.port ?? 3000, resolve);
      });
    },
    stop() {
      return new Promise((resolve) => {
        wss?.close();
        httpServer?.close(resolve);
      });
    },
    port() {
      return httpServer?.address()?.port;
    },
    broadcast(data) {
      const msg = JSON.stringify(data);
      wss?.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) client.send(msg);
      });
    },
  };
}

module.exports = { createObsServer };
```

**Step 4: Run tests to verify they pass**

Run: `cd yuupeek && npx jest src/__tests__/obsServer.test.js`
Expected: 3 tests PASS

**Step 5: Commit**

```bash
git add yuupeek/src/obsServer.js yuupeek/src/__tests__/obsServer.test.js
git commit -m "feat: add OBS HTTP+WebSocket server with tests"
```

---

### Task 6: `renderer/obs-overlay.html` — OBS Browser Source Page

**Files:**
- Create: `yuupeek/renderer/obs-overlay.html`

**Step 1: Create the overlay page**

Create `yuupeek/renderer/obs-overlay.html`:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: transparent; overflow: hidden; width: 100vw; height: 100vh; }
    #character { position: fixed; bottom: 60px; right: 40px; }
    #char-canvas { display: block; }
    #hud {
      position: fixed;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
    }
    #yuushi-val { color: white; font-size: 11px; font-family: monospace; text-shadow: 0 1px 2px #000; }
    #bar-track { width: 60px; height: 6px; background: rgba(0,0,0,.4); border-radius: 3px; overflow: hidden; }
    #bar-fill   { height: 100%; width: 0%; background: #4af; border-radius: 3px; transition: width .3s; }
    #bar-fill.peek  { background: #fa4; }
    #bar-fill.angry { background: #f44; }
  </style>
</head>
<body>
  <div id="hud">
    <span id="yuushi-val">0</span>
    <div id="bar-track"><div id="bar-fill"></div></div>
  </div>
  <div id="character"><canvas id="char-canvas"></canvas></div>

  <script>
    // Sprite paths served by obsServer at /assets/...
    const ANIMATIONS = {
      idle:      { srcs: frames('idle',          [0, 2, 4, 5, 4, 2, 0, 0, 1, 0]), loop: true },
      peek:      { srcs: frames('review',        [2,2,2,2, 4,2,2,2, 3, 3, 3]), loop: true, ms: 250 },
      cheer:     { srcs: frames('cheer',         [0,2,3,5,0,5]), loop: true },
      cry:       { srcs: frames('cry',           [0,7,7,7,0,1,1,1,0,0]), loop: true },
      eat:       { srcs: frames('cilantro',      8), loop: false, ms: 250 },
      shocked:   { srcs: frames('jumping',       5), loop: false },
      run_left:  { srcs: frames('running-left',  [0, 3, 4, 5, 7]), loop: true },
      run_right: { srcs: frames('running-right', [0, 3, 4, 5, 7]), loop: true },
    };

    function frames(state, n) {
      const indices = Array.isArray(n) ? n : Array.from({ length: n }, (_, i) => i);
      return indices.map(i => `/assets/sprites/frames/${state}/${String(i).padStart(2, '0')}.png`);
    }

    const FRAME_MS  = 150;
    const DISPLAY_W = 128;
    const DISPLAY_H = 139;

    const cache = {};
    Object.values(ANIMATIONS).flatMap(a => a.srcs).forEach(src => {
      if (cache[src]) return;
      const img = new Image(); img.src = src; cache[src] = img;
    });

    const charEl  = document.getElementById('character');
    const canvas  = document.getElementById('char-canvas');
    const ctx     = canvas.getContext('2d');
    const hudEl   = document.getElementById('hud');
    const valEl   = document.getElementById('yuushi-val');
    const barFill = document.getElementById('bar-fill');

    canvas.width  = DISPLAY_W;
    canvas.height = DISPLAY_H;

    const REST_RIGHT  = 40;
    const PEEK_RIGHT  = 240;
    const ANGRY_RIGHT = 380;

    let posRight = REST_RIGHT;
    let posBottom = 60;
    let targetRight = REST_RIGHT;

    charEl.style.right  = posRight  + 'px';
    charEl.style.bottom = posBottom + 'px';

    function updateHud() {
      hudEl.style.right  = posRight + 'px';
      hudEl.style.bottom = (posBottom + DISPLAY_H + 8) + 'px';
    }
    updateHud();

    function setTargetForState(state) {
      if (state === 'cheer')                       targetRight = ANGRY_RIGHT;
      else if (state === 'peek')                   targetRight = PEEK_RIGHT;
      else if (state === 'cry' || state === 'eat') { /* stay */ }
      else                                         targetRight = REST_RIGHT;
    }

    const RUN_STATES = new Set(['run_left', 'run_right']);

    let currentState = 'idle';
    let baseState    = 'idle';
    let frameIdx     = 0;
    let animDone     = false;
    let lastFrameAt  = 0;

    function drawFrame() {
      const { srcs } = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
      const img = cache[srcs[frameIdx]];
      ctx.clearRect(0, 0, DISPLAY_W, DISPLAY_H);
      if (img?.complete && img.naturalWidth) ctx.drawImage(img, 0, 0, DISPLAY_W, DISPLAY_H);
    }

    setInterval(() => {
      if (animDone) return;
      const anim = ANIMATIONS[currentState] ?? ANIMATIONS.idle;
      const ms   = anim.ms ?? FRAME_MS;
      const now  = performance.now();
      if (now - lastFrameAt < ms) return;
      lastFrameAt = now;
      const next = frameIdx + 1;
      if (next >= anim.srcs.length) {
        if (!anim.loop) { animDone = true; return; }
        frameIdx = 0;
      } else {
        frameIdx = next;
      }
      drawFrame();
    }, 16);

    setInterval(() => {
      const diff = targetRight - posRight;
      if (Math.abs(diff) > 0.5) {
        posRight += diff * 0.04;
        charEl.style.right = posRight + 'px';
        updateHud();
        if (Math.abs(diff) > 5 && !animDone) setState(diff > 0 ? 'run_left' : 'run_right');
      } else if (RUN_STATES.has(currentState)) {
        setState(baseState);
      }
    }, 30);

    function setState(state) {
      if (currentState === state) return;
      currentState = state;
      frameIdx     = 0;
      animDone     = false;
      lastFrameAt  = 0;
      drawFrame();
    }

    function applyUpdate({ value, state }) {
      valEl.textContent   = value;
      barFill.style.width = value + '%';
      barFill.className   = value >= 80 ? 'angry' : value >= 40 ? 'peek' : '';
      charEl.className    = `state-${state}`;
      baseState = state;
      setTargetForState(state);
      const playingOneShot = !(ANIMATIONS[currentState]?.loop ?? true) && !animDone;
      if (!RUN_STATES.has(currentState) && !playingOneShot) setState(state);
    }

    // WebSocket connection — port is injected by obsServer at serve time
    const WS_PORT = document.currentScript?.dataset?.wsPort ?? location.port ?? 3000;
    const ws = new WebSocket(`ws://${location.hostname}:${WS_PORT}`);
    ws.onmessage = (e) => applyUpdate(JSON.parse(e.data));
    ws.onclose   = () => setTimeout(() => location.reload(), 3000); // auto-reconnect

    window.addEventListener('load', drawFrame);
  </script>
</body>
</html>
```

**Step 2: Commit**

```bash
git add yuupeek/renderer/obs-overlay.html
git commit -m "feat: add OBS browser source overlay page"
```

---

### Task 7: Wire Everything Into `main.js`

**Files:**
- Modify: `yuupeek/main.js`

**Step 1: Replace `main.js` contents**

The full updated `main.js`:

```js
require('dotenv').config();
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs   = require('fs');
const { getAllWindowTitles, matchesStream, matchesBaron } = require('./src/detector');
const { createStateMachine } = require('./src/stateMachine');
const { createChatListener }  = require('./src/chatListener');
const { createObsServer }     = require('./src/obsServer');

const config   = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.json'), 'utf8'));
const commands = JSON.parse(fs.readFileSync(path.join(__dirname, 'commands.json'), 'utf8'));

let win;
let tray;
const sm = createStateMachine();

function broadcastState() {
  const payload = { value: sm.yuushi, state: sm.state };
  if (win) win.webContents.send('yuushi-update', payload);
  if (obsServer) obsServer.broadcast(payload);
}

// ── OBS server ────────────────────────────────────────────────────────────────
let obsServer = null;
if (config.modes?.obs) {
  obsServer = createObsServer(config.obs, __dirname);
  obsServer.start().then(() => {
    console.log(`OBS overlay: http://localhost:${obsServer.port()}`);
  });
}

// ── Chat listener ─────────────────────────────────────────────────────────────
let chatListener = null;
if (config.twitch?.enabled || config.youtube?.enabled) {
  chatListener = createChatListener(config, commands, sm, broadcastState);
  chatListener.start();
}

// ── Electron overlay ──────────────────────────────────────────────────────────
app.whenReady().then(() => {
  if (config.modes?.overlay) {
    const { width, height } = screen.getPrimaryDisplay().workAreaSize;

    win = new BrowserWindow({
      width,
      height,
      x: 0,
      y: 0,
      transparent: true,
      frame: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
      },
    });

    win.setIgnoreMouseEvents(true, { forward: true });
    win.loadFile('renderer/index.html');
    win.setVisibleOnAllWorkspaces(true);
  }

  // System tray — always present so there is a way to quit
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('YuuPeek 👁️');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '👁️ YuuPeek', enabled: false },
    { type: 'separator' },
    { label: '結束', click: () => app.quit() },
  ]));

  // Detection loop every 2s
  setInterval(async () => {
    const titles   = await getAllWindowTitles();
    const detected = matchesStream(titles);
    sm.tick(detected);
    broadcastState();

    if (detected && matchesBaron(titles)) {
      if (win) win.webContents.send('baron-event');
    }
  }, 2000);
});

ipcMain.on('punish', () => {
  sm.punish();
  broadcastState();
});

ipcMain.on('set-yuushi', (_e, v) => {
  sm.yuushi = Math.max(0, Math.min(100, v));
  sm.state  = sm.computeState();
  broadcastState();
});

ipcMain.on('feed', () => {
  sm.yuushi = Math.max(0, sm.yuushi - 15);
  broadcastState();
  // temporarily override state to 'eat', restore after 3s
  win?.webContents.send('yuushi-update', { value: sm.yuushi, state: 'eat' });
  obsServer?.broadcast({ value: sm.yuushi, state: 'eat' });
  setTimeout(() => {
    sm.state = sm.computeState();
    broadcastState();
  }, 3000);
});

ipcMain.on('set-click-through', (_e, on) => {
  win?.setIgnoreMouseEvents(on, { forward: true });
});

ipcMain.on('quit', () => app.quit());

app.on('window-all-closed', () => {});
```

**Step 2: Run all tests to verify nothing broke**

Run: `cd yuupeek && npx jest`
Expected: All tests PASS (stateMachine + detector + chatListener + obsServer)

**Step 3: Manual smoke test — overlay only**

In `config.json` set `modes.obs = false`. Run `npm start`. Confirm the Electron overlay appears and behaves as before.

**Step 4: Manual smoke test — OBS mode**

In `config.json` set `modes.overlay = false` and `modes.obs = true`. Run `npm start`. Open `http://localhost:3000` in a browser. Confirm YuuPeek sprite appears and animates.

**Step 5: Manual smoke test — both modes**

Set both to `true`. Confirm both the Electron overlay and the browser page animate in sync.

**Step 6: Commit**

```bash
git add yuupeek/main.js
git commit -m "feat: wire obsServer and chatListener into main, gate by config.json modes"
```

---

### Task 8: Final Checks and Cleanup

**Step 1: Run full test suite**

Run: `cd yuupeek && npx jest --coverage`
Expected: All tests pass.

**Step 2: Verify `.env` is not tracked**

Run: `git status`
Expected: `.env` does not appear (covered by `.gitignore`).

**Step 3: Update `electron-builder` files list to exclude `.env`**

In `package.json`, the `build.files` array already uses explicit paths (`main.js`, `src/**`, etc.) so `.env` is not bundled. Confirm `config.json` and `commands.json` are included:

```json
"files": [
  "main.js",
  "preload.js",
  "src/**",
  "renderer/**",
  "assets/**",
  "config.json",
  "commands.json"
]
```

If `config.json`/`commands.json` are missing from the list, add them.

**Step 4: Commit if `package.json` changed**

```bash
git add yuupeek/package.json
git commit -m "chore: include config.json and commands.json in electron-builder bundle"
```
