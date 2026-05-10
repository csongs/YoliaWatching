# YuuPeek Desktop Pet ??Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an Electron transparent overlay desktop pet (?踹厭) that detects esports/stream windows by title, grows a 撟質???meter, and lets the player click her away.

**Architecture:** Electron main process polls all visible window titles via PowerShell every 2 seconds; if a stream keyword matches, it raises 撟質? over IPC; the renderer drives a CSS character state machine (idle ??peek ??focus) based on the value; clicking the character sends a "punish" event back, dropping 撟質? and triggering cry animation.

**Tech Stack:** Electron 30+, Node.js child_process (PowerShell for window scan), HTML/CSS animations in renderer, Jest for unit tests on pure-logic modules (detector, state machine).

---

## Project Layout

```
yuupeek/
??? package.json
??? main.js              # Electron entry, BrowserWindow, IPC orchestration
??? preload.js           # Secure contextBridge for renderer ??main
??? src/
??  ??? detector.js      # Window title scanner (pure Node, testable)
??  ??? stateMachine.js  # Ayuu state transitions (pure JS, testable)
??  ??? config.js        # Keyword list, thresholds
??? renderer/
??  ??? index.html
??  ??? style.css        # Character + HUD CSS
??  ??? app.js           # Renderer logic
??? assets/
    ??? sprites/         # Drop PNG frames here later (placeholders until art arrives)
```

---

### Task 1: Project Scaffolding

**Files:**
- Create: `yuupeek/package.json`
- Create: `yuupeek/main.js` (stub)

**Step 1: Init npm project**

```bash
cd e:/code/YoliaWatching
mkdir yuupeek && cd yuupeek
npm init -y
npm install --save-dev electron jest
```

**Step 2: Set package.json scripts**

Edit `package.json` ??replace `"scripts"` block:

```json
"scripts": {
  "start": "electron .",
  "test": "jest"
},
"main": "main.js"
```

**Step 3: Create minimal main.js stub**

```js
const { app, BrowserWindow } = require('electron');

app.whenReady().then(() => {
  const win = new BrowserWindow({ width: 800, height: 600 });
  win.loadFile('renderer/index.html');
});
```

**Step 4: Create renderer/index.html stub**

```html
<!DOCTYPE html>
<html><body><p>YuuPeek</p></body></html>
```

**Step 5: Verify it boots**

```bash
npm start
```

Expected: Electron window opens with "YuuPeek" text.

**Step 6: Commit**

```bash
git init
git add .
git commit -m "feat: electron project scaffold"
```

---

### Task 2: Transparent Always-on-Top Overlay

**Files:**
- Modify: `yuupeek/main.js`
- Create: `yuupeek/renderer/index.html`
- Create: `yuupeek/renderer/style.css`

**Goal:** Window is transparent, frameless, always on top. Background passes clicks through. Character element is interactive.

**Step 1: Rewrite main.js with overlay BrowserWindow**

```js
const { app, BrowserWindow, screen } = require('electron');
const path = require('path');

app.whenReady().then(() => {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  const win = new BrowserWindow({
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

  win.setIgnoreMouseEvents(true, { forward: true }); // click-through by default
  win.loadFile('renderer/index.html');
  win.setVisibleOnAllWorkspaces(true);
});
```

**Step 2: Create preload.js (stub)**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuuApi', {
  onYuushiUpdate: (cb) => ipcRenderer.on('yuushi-update', (_e, val) => cb(val)),
  punish: () => ipcRenderer.send('punish'),
});
```

**Step 3: Update renderer/index.html**

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="character" class="state-idle">??儭?/div>
  <div id="hud">撟質? <span id="yuushi-val">0</span>%</div>
  <script src="app.js"></script>
</body>
</html>
```

**Step 4: Create renderer/style.css**

```css
* { margin: 0; padding: 0; box-sizing: border-box; }

body {
  background: transparent;
  overflow: hidden;
  width: 100vw;
  height: 100vh;
  pointer-events: none; /* entire body click-through */
}

#character {
  position: fixed;
  bottom: 60px;
  right: 40px;
  font-size: 64px;
  cursor: pointer;
  pointer-events: all; /* character IS clickable */
  transition: transform 0.2s;
  user-select: none;
}

#character.state-peek   { transform: translateX(-20px); }
#character.state-focus  { transform: scale(1.3); filter: drop-shadow(0 0 12px red); }
#character.state-punish { transform: scale(0.8) rotate(-15deg); }

#hud {
  position: fixed;
  top: 20px;
  right: 20px;
  background: rgba(0,0,0,0.5);
  color: #fff;
  padding: 6px 12px;
  border-radius: 8px;
  font-family: monospace;
  font-size: 14px;
  pointer-events: none;
}
```

**Step 5: Create renderer/app.js (stub)**

```js
const char = document.getElementById('character');
const valEl = document.getElementById('yuushi-val');

char.addEventListener('click', () => {
  window.yuuApi.punish();
});

window.yuuApi.onYuushiUpdate((val) => {
  valEl.textContent = val;
  char.className = val >= 80 ? 'state-focus'
                 : val >= 40 ? 'state-peek'
                 : 'state-idle';
});
```

**Step 6: Verify**

```bash
npm start
```

Expected: Full-screen transparent overlay. ??儭?emoji sits in bottom-right. HUD shows "撟質? 0%". Other app windows are still clickable.

**Step 7: Commit**

```bash
git add .
git commit -m "feat: transparent overlay window with character placeholder"
```

---

### Task 3: Window Title Detector

**Files:**
- Create: `yuupeek/src/config.js`
- Create: `yuupeek/src/detector.js`
- Create: `yuupeek/src/__tests__/detector.test.js`

**Step 1: Write config.js**

```js
const STREAM_KEYWORDS = [
  'YouTube',
  'Twitch',
  'LCK',
  'LPL',
  'T1',
  'GEN.G',
  'League of Legends',
  'LoL Esports',
  'Afreeca',
  'NAVER',
];

const THRESHOLDS = {
  PEEK:  40,   // 撟質? % where Ayuu starts peeking
  FOCUS: 80,   // % where she enters full Focus Mode
};

module.exports = { STREAM_KEYWORDS, THRESHOLDS };
```

**Step 2: Write the failing test**

```js
// src/__tests__/detector.test.js
const { matchesStream } = require('../detector');

test('returns true when a title contains a stream keyword', () => {
  expect(matchesStream(['YouTube - Google Chrome', 'Notepad'])).toBe(true);
});

test('returns false when no titles match', () => {
  expect(matchesStream(['Notepad', 'File Explorer', 'Discord'])).toBe(false);
});

test('returns true for LCK match', () => {
  expect(matchesStream(['LCK Spring 2026 - Twitch'])).toBe(true);
});

test('is case-insensitive', () => {
  expect(matchesStream(['twitch.tv - firefox'])).toBe(true);
});
```

**Step 3: Run test ??verify it fails**

```bash
npm test
```

Expected: FAIL ??"Cannot find module '../detector'"

**Step 4: Write detector.js**

```js
const { exec } = require('child_process');
const { STREAM_KEYWORDS } = require('./config');

// Scan all visible Windows window titles via PowerShell
function getAllWindowTitles() {
  return new Promise((resolve, reject) => {
    const cmd =
      'powershell.exe -NoProfile -Command "' +
      'Get-Process | Where-Object { $_.MainWindowTitle -ne \\"\\"-} | ' +
      'Select-Object -ExpandProperty MainWindowTitle"';

    exec(cmd, { timeout: 4000 }, (err, stdout) => {
      if (err) return resolve([]); // silently ignore (PS not available etc.)
      const titles = stdout.split('\n').map(t => t.trim()).filter(Boolean);
      resolve(titles);
    });
  });
}

function matchesStream(titles) {
  const lower = titles.map(t => t.toLowerCase());
  return STREAM_KEYWORDS.some(kw => lower.some(t => t.includes(kw.toLowerCase())));
}

module.exports = { getAllWindowTitles, matchesStream };
```

**Step 5: Run test ??verify it passes**

```bash
npm test
```

Expected: PASS (4 tests).

**Step 6: Commit**

```bash
git add src/
git commit -m "feat: window title detector with keyword matching"
```

---

### Task 4: State Machine

**Files:**
- Create: `yuupeek/src/stateMachine.js`
- Create: `yuupeek/src/__tests__/stateMachine.test.js`

**Step 1: Write the failing tests**

```js
// src/__tests__/stateMachine.test.js
const { createStateMachine } = require('../stateMachine');

test('starts at idle with yuushi 0', () => {
  const sm = createStateMachine();
  expect(sm.state).toBe('idle');
  expect(sm.yuushi).toBe(0);
});

test('tick with stream detected increases yuushi', () => {
  const sm = createStateMachine();
  sm.tick(true);
  expect(sm.yuushi).toBeGreaterThan(0);
  expect(sm.yuushi).toBeLessThanOrEqual(100);
});

test('tick without stream decreases yuushi', () => {
  const sm = createStateMachine();
  sm.yuushi = 50;
  sm.tick(false);
  expect(sm.yuushi).toBeLessThan(50);
});

test('punish drops yuushi by 20 and sets state to punished', () => {
  const sm = createStateMachine();
  sm.yuushi = 60;
  sm.punish();
  expect(sm.yuushi).toBe(40);
  expect(sm.state).toBe('punished');
});

test('state transitions at thresholds', () => {
  const sm = createStateMachine();
  sm.yuushi = 0;  expect(sm.computeState()).toBe('idle');
  sm.yuushi = 40; expect(sm.computeState()).toBe('peek');
  sm.yuushi = 80; expect(sm.computeState()).toBe('focus');
});

test('yuushi never exceeds 100 or goes below 0', () => {
  const sm = createStateMachine();
  sm.yuushi = 99; sm.tick(true); expect(sm.yuushi).toBeLessThanOrEqual(100);
  sm.yuushi = 1;  sm.tick(false); expect(sm.yuushi).toBeGreaterThanOrEqual(0);
});
```

**Step 2: Run test ??verify fails**

```bash
npm test
```

Expected: FAIL ??"Cannot find module '../stateMachine'"

**Step 3: Write stateMachine.js**

```js
const { THRESHOLDS } = require('./config');

const TICK_RISE = 5;   // 撟質? gained per tick when stream detected
const TICK_FALL = 2;   // 撟質? lost per tick when no stream
const PUNISH_DROP = 20;
const PUNISH_DURATION_MS = 2000;

function createStateMachine() {
  const sm = {
    yuushi: 0,
    state: 'idle',
    _punishedUntil: 0,

    tick(streamDetected) {
      if (streamDetected) {
        this.yuushi = Math.min(100, this.yuushi + TICK_RISE);
      } else {
        this.yuushi = Math.max(0, this.yuushi - TICK_FALL);
      }
      if (Date.now() > this._punishedUntil) {
        this.state = this.computeState();
      }
    },

    punish() {
      this.yuushi = Math.max(0, this.yuushi - PUNISH_DROP);
      this.state = 'punished';
      this._punishedUntil = Date.now() + PUNISH_DURATION_MS;
    },

    computeState() {
      if (this.yuushi >= THRESHOLDS.FOCUS) return 'focus';
      if (this.yuushi >= THRESHOLDS.PEEK)  return 'peek';
      return 'idle';
    },
  };
  return sm;
}

module.exports = { createStateMachine };
```

**Step 4: Run tests ??verify pass**

```bash
npm test
```

Expected: All tests PASS.

**Step 5: Commit**

```bash
git add src/
git commit -m "feat: yuushi state machine with peek/focus/punish transitions"
```

---

### Task 5: Wire Main Process ??Detector + State Machine Loop

**Files:**
- Modify: `yuupeek/main.js`

**Step 1: Add detector + state machine to main.js**

Replace `main.js` completely:

```js
const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const { getAllWindowTitles, matchesStream } = require('./src/detector');
const { createStateMachine } = require('./src/stateMachine');

let win;
const sm = createStateMachine();

app.whenReady().then(() => {
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

  // Detection loop ??every 2 seconds
  setInterval(async () => {
    const titles = await getAllWindowTitles();
    const detected = matchesStream(titles);
    sm.tick(detected);
    win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });
  }, 2000);
});

// Player clicked character
ipcMain.on('punish', () => {
  sm.punish();
  win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });
});
```

**Step 2: Update preload.js to pass state too**

```js
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuuApi', {
  onYuushiUpdate: (cb) => ipcRenderer.on('yuushi-update', (_e, data) => cb(data)),
  punish: () => ipcRenderer.send('punish'),
});
```

**Step 3: Update renderer/app.js to handle state field**

```js
const char = document.getElementById('character');
const valEl = document.getElementById('yuushi-val');

const STATE_EMOJI = {
  idle:     '??儭?,
  peek:     '??',
  focus:    '?',
  punished: '?',
};

char.addEventListener('click', () => {
  window.yuuApi.punish();
});

window.yuuApi.onYuushiUpdate(({ value, state }) => {
  valEl.textContent = value;
  char.textContent  = STATE_EMOJI[state] ?? '??儭?;
  char.className    = `state-${state}`;
});
```

**Step 4: Manual test**

```bash
npm start
```

Open YouTube in browser.

Expected: Within ~6 seconds, HUD % climbs, character emoji changes to ?? then ?. Clicking character ???, % drops.

**Step 5: Commit**

```bash
git add .
git commit -m "feat: wire detection loop and punish IPC into main process"
```

---

### Task 6: Baron Event (Special Trigger)

**Files:**
- Modify: `yuupeek/src/config.js`
- Modify: `yuupeek/src/detector.js`
- Modify: `yuupeek/main.js`

**Goal:** Detect "Baron" / "Elder" / "Dragon" keywords ??emit special `baron-event` IPC so renderer can show a dramatic animation.

**Step 1: Add BARON_KEYWORDS to config.js**

```js
const BARON_KEYWORDS = [
  'Baron',
  'Elder Dragon',
  'Nashor',
];

module.exports = { STREAM_KEYWORDS, BARON_KEYWORDS, THRESHOLDS };
```

**Step 2: Add matchesBaron() to detector.js**

```js
const { STREAM_KEYWORDS, BARON_KEYWORDS } = require('./config');

function matchesBaron(titles) {
  const lower = titles.map(t => t.toLowerCase());
  return BARON_KEYWORDS.some(kw => lower.some(t => t.includes(kw.toLowerCase())));
}

module.exports = { getAllWindowTitles, matchesStream, matchesBaron };
```

**Step 3: Add baron detection to main.js interval**

Inside the `setInterval` callback, after `sm.tick`:

```js
if (matchesBaron(titles)) {
  win.webContents.send('baron-event');
}
```

**Step 4: Handle baron-event in preload.js**

```js
onBaronEvent: (cb) => ipcRenderer.on('baron-event', cb),
```

**Step 5: Handle baron-event in renderer/app.js**

```js
window.yuuApi.onBaronEvent(() => {
  char.textContent = '??儭????儭?;
  char.style.fontSize = '80px';
  setTimeout(() => { char.style.fontSize = ''; }, 3000);
});
```

**Step 6: Write tests for matchesBaron**

```js
// add to detector.test.js
const { matchesBaron } = require('../detector');

test('baron event triggers on Baron keyword', () => {
  expect(matchesBaron(['LOL Esports - Baron Nashor spawned'])).toBe(true);
});

test('baron event does not trigger on normal titles', () => {
  expect(matchesBaron(['YouTube', 'Twitch'])).toBe(false);
});
```

**Step 7: Run tests**

```bash
npm test
```

Expected: All pass.

**Step 8: Commit**

```bash
git add .
git commit -m "feat: baron event detection and dramatic renderer effect"
```

---

### Task 7: System Tray + Quit

**Files:**
- Modify: `yuupeek/main.js`

**Goal:** App needs a way to quit since it has no frame/taskbar. Add system tray icon with Quit option.

**Step 1: Add tray to main.js**

```js
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');

// Inside app.whenReady():
const icon = nativeImage.createEmpty(); // replace with real icon later
const tray = new Tray(icon);
tray.setToolTip('YuuPeek');
tray.setContextMenu(Menu.buildFromTemplate([
  { label: '??儭?YuuPeek', enabled: false },
  { type: 'separator' },
  { label: 'Quit', click: () => app.quit() },
]));
```

**Step 2: Manual test**

```bash
npm start
```

Expected: System tray icon appears. Right-click ??Quit closes the app.

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: system tray with quit option"
```

---

### Task 8: Packaging (Windows exe)

**Files:**
- Modify: `yuupeek/package.json`

**Step 1: Install electron-builder**

```bash
npm install --save-dev electron-builder
```

**Step 2: Add build config to package.json**

```json
"build": {
  "appId": "com.yuupeek.app",
  "productName": "YuuPeek",
  "win": {
    "target": "nsis",
    "icon": "assets/icon.ico"
  },
  "files": ["main.js", "preload.js", "src/**", "renderer/**", "assets/**"]
},
"scripts": {
  "start": "electron .",
  "test": "jest",
  "build": "electron-builder"
}
```

**Step 3: Build**

```bash
npm run build
```

Expected: `dist/YuuPeek Setup X.X.X.exe` created.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: electron-builder packaging config for Windows"
```

---

## Replacing Placeholder Art

When sprite assets are ready, drop PNGs into `assets/sprites/`. Update `renderer/style.css` to use `background-image` instead of emoji, and set `font-size: 0` on `#character`. The state machine and IPC plumbing stay identical.

---

## What's Out of Scope (for now)

- Drag interaction (?) ??add after MVP validated
- 擗菟? (feed) system ??needs item inventory
- Sound effects ??add `<audio>` tags in renderer, trigger on state change
- Multi-monitor support
- macOS (needs different window-title API)

