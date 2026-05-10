# Chat Integration Design — 2026-05-10

## Goal

Allow Twitch and YouTube Live viewers to trigger YuuPeek animations and affect the yuushi value via chat commands. The pet is displayed in OBS as a Browser Source served from a local HTTP server. The existing Electron desktop overlay continues to work alongside it.

## Config Files

### `config.json`
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

### `commands.json`
```json
{
  "!cheer": { "state": "cheer", "yuushi": 10 },
  "!cry":   { "state": "cry",   "yuushi": -15 },
  "!feed":  { "state": "eat",   "yuushi": 0 },
  "!poke":  {                   "yuushi": -5 }
}
```

Each command may have `state` (triggers a one-shot animation) and/or `yuushi` (positive or negative delta, clamped to 0–100). Both fields are optional.

### `.env` (not committed)
```
TWITCH_OAUTH=oauth:xxxxxxxx
YOUTUBE_API_KEY=xxxxxxxxxxxxxxxx
```

## Module Architecture

```
yuupeek/
├── main.js                    ← reads config.json, conditionally starts each subsystem
├── config.json                ← new
├── commands.json              ← new
├── .env                       ← new (gitignored)
├── src/
│   ├── detector.js            ← unchanged
│   ├── stateMachine.js        ← unchanged
│   ├── config.js              ← unchanged (thresholds)
│   ├── chatListener.js        ← new: Twitch + YouTube chat
│   └── obsServer.js           ← new: HTTP server + WebSocket
└── renderer/
    ├── index.html             ← unchanged (Electron overlay)
    ├── app.js                 ← unchanged
    └── obs-overlay.html       ← new: OBS browser source page
```

### Startup logic in `main.js`
```
read config.json
├── modes.overlay = true → create BrowserWindow (existing logic)
├── modes.obs = true     → start obsServer (HTTP + WebSocket on configured port)
└── twitch/youtube enabled → start chatListener
```

The state machine remains a single instance in `main.js`. On every state update, it broadcasts to:
- Electron renderer via `win.webContents.send('yuushi-update', ...)` — if overlay is on
- All connected WebSocket clients — if obs is on

## Data Flow

### Twitch
Uses `tmi.js` (official IRC client library).
```
Twitch IRC → tmi.js → chatListener → parse command → stateMachine update → broadcast
```

### YouTube
Polls YouTube Data API v3 every 5 seconds.
```
YouTube Live Chat API → polling → chatListener → parse command → stateMachine update → broadcast
```

### chatListener interface
```js
const listener = createChatListener(config, commands, sm, broadcast);
listener.start();
```

`broadcast` is a callback passed in from `main.js`. `chatListener` does not directly touch the WebSocket server, keeping the two modules independent.

### Command processing
```
receive "!cheer"
→ look up key in commands.json
→ if yuushi delta exists → sm.yuushi += delta (clamped 0–100)
→ if state exists        → trigger one-shot animation, then return to computeState()
→ call broadcast({ value: sm.yuushi, state: sm.state })
```

## OBS Overlay Page

`obs-overlay.html` runs inside OBS Browser Source with a transparent background. Animation logic mirrors `renderer/app.js`.

### WebSocket message format (server → client)
```json
{ "value": 72, "state": "cheer" }
```

Same shape as the existing `yuushi-update` IPC message for easy logic reuse.

### Client connection
```js
const ws = new WebSocket('ws://localhost:3000');
ws.onmessage = (e) => {
  const { value, state } = JSON.parse(e.data);
  // update yuushi bar + trigger animation
};
```

### OBS setup
- URL: `http://localhost:3000`
- Width/Height: match stream resolution (e.g. 1920×1080)
- Custom CSS: `body { background: transparent; }`

## New Dependencies

| Package | Purpose |
|---------|---------|
| `tmi.js` | Twitch IRC chat client |
| `googleapis` | YouTube Data API v3 |
| `ws` | WebSocket server |
| `dotenv` | Load `.env` into `process.env` |

## What Is Not Changed

- `src/stateMachine.js`
- `src/detector.js`
- `src/config.js`
- `renderer/app.js`
- `renderer/index.html`
- `renderer/style.css`
