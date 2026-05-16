const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');

app.commandLine.appendSwitch('disable-gpu-disk-cache');
const path = require('path');
const fs   = require('fs');

const appDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
// User data (config.json, .env) lives in %APPDATA%\YoliaWatching so NSIS updates never overwrite it.
// In dev mode fall back to appDir so behaviour is unchanged.
const userDataDir = app.isPackaged ? app.getPath('userData') : appDir;

function deepMerge(defaults, overrides) {
  const result = { ...defaults };
  for (const key of Object.keys(overrides)) {
    const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
    result[key] = (isObj(overrides[key]) && isObj(defaults[key]))
      ? deepMerge(defaults[key], overrides[key])
      : overrides[key];
  }
  return result;
}

if (app.isPackaged) {
  fs.mkdirSync(userDataDir, { recursive: true });
  const userCfg = path.join(userDataDir, 'config.json');
  if (!fs.existsSync(userCfg)) {
    fs.copyFileSync(path.join(appDir, 'config.json'), userCfg);
  }
}

require('dotenv').config({ path: path.join(userDataDir, '.env') });

const { getAllWindowTitles, matchesStream, matchesBaron } = require('./src/detector');
const { createStateMachine } = require('./src/stateMachine');
const { createChatListener }  = require('./src/chatListener');
const { createObsServer }     = require('./src/obsServer');

const DEFAULT_ANIMATIONS = {
  idle:      { folder: 'idle',          frames: [0,2,4,5,4,2,0,0,1,0], ms: 150,  loop: false },
  peek:      { folder: 'review',        frames: [2,2,2,2,4,2,2,2,3,3,3], ms: 250, loop: false },
  cheer:     { folder: 'cheer',         frames: [0,2,3,5,0,5], ms: 150,  loop: false },
  cry:       { folder: 'cry',           frames: [0,7,7,7,0,1,1,1,0,0], ms: 150,  loop: false },
  eat:       { folder: 'cilantro',      frames: [0,1,2,3,4,5,6,7,7], ms: 250,  loop: false },
  jump:      { folder: 'jumping',       frames: [0,1,2,3], ms: 250,  loop: false },
  run_left:  { folder: 'running-left',  frames: [0,3,4,5,7], ms: 150,  loop: true },
  run_right: { folder: 'running-right', frames: [0,3,4,5,7], ms: 150,  loop: true },
  wave:      { folder: 'waving',        frames: [0,1,2,3,2,1,0], ms: 200,  loop: false },
};

const defaultConfig = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
const userConfig    = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8')); }
  catch { return {}; }
})();
const config = deepMerge(defaultConfig, userConfig);
const commands = config.commands ?? {};

let win;
let tray;
const sm = createStateMachine(config);

function broadcastState(payload) {
  const data = payload ?? { value: sm.yolia_see, state: sm.state };
  if (win && !win.isDestroyed()) win.webContents.send('yolia-update', data);
  if (obsServer) {
    if (!data.animOnly) obsServer.setWelcomeData(data);
    obsServer.broadcast(data);
  }
}

// ── OBS server ────────────────────────────────────────────────────────────────

let obsServer = null;
if (config.modes?.obs) {
  obsServer = createObsServer(config, __dirname);
  obsServer.setPanelHandlers({
    appDir: userDataDir,
    getStatus: () => ({
      twitch: {
        enabled:   config.twitch?.enabled ?? false,
        connected: chatListener?.getStatus?.().twitch.connected ?? false,
        channel:   config.twitch?.channel ?? '',
      },
      youtube: {
        enabled: config.youtube?.enabled ?? false,
        live:    chatListener?.getStatus?.().youtube.live ?? false,
        error:   chatListener?.getStatus?.().youtube.error ?? null,
        channel: config.youtube?.channel ?? '',
      },
      obs: {
        enabled: true,
        port:    obsServer.port() ?? config.obs?.port ?? 3000,
      },
      pet: {
        enabled: config.modes?.pet ?? false,
        visible: !!(win && !win.isDestroyed() && win.isVisible()),
      },
    }),
    getConfig: () => ({
      twitch:  { enabled: config.twitch?.enabled  ?? false, channel: config.twitch?.channel  ?? '' },
      youtube: { enabled: config.youtube?.enabled ?? false, channel: config.youtube?.channel ?? '' },
    }),
    getPetConfig: () => ({
      yoliaStates:        config.yoliaStates        ?? [],
      greetings:          config.greetings          ?? [],
      greetingResponse:   config.greetingResponse   ?? '',
      greetingAnimations: config.greetingAnimations ?? [],
      commands:           config.commands           ?? {},
      scale:              config.obs?.scale         ?? 2,
    }),
    savePetConfig: (patch) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      let chatNeedsRestart = false;

      if (patch.yoliaStates !== undefined) {
        raw.yoliaStates = patch.yoliaStates;
        config.yoliaStates = patch.yoliaStates;
        sm.updateStates(patch.yoliaStates);
        sm.state = sm.computeState();
        broadcastState();
      }
      if (patch.greetings !== undefined) {
        raw.greetings = patch.greetings;
        config.greetings = patch.greetings;
        chatNeedsRestart = true;
      }
      if (patch.greetingResponse !== undefined) {
        raw.greetingResponse = patch.greetingResponse;
        config.greetingResponse = patch.greetingResponse;
        chatNeedsRestart = true;
      }
      if (patch.greetingAnimations !== undefined) {
        raw.greetingAnimations = patch.greetingAnimations;
        config.greetingAnimations = patch.greetingAnimations;
        obsServer?.broadcast({ setWaveVariants: patch.greetingAnimations });
      }
      if (patch.commands !== undefined) {
        raw.commands = patch.commands;
        config.commands = patch.commands;
        Object.keys(commands).forEach(k => delete commands[k]);
        Object.assign(commands, patch.commands);
        chatNeedsRestart = true;
      }
      if (patch.scale !== undefined) {
        raw.obs = raw.obs ?? {};
        config.obs = config.obs ?? {};
        raw.obs.scale = patch.scale;
        config.obs.scale = patch.scale;
        obsServer?.broadcast({ setScale: patch.scale });
      }

      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');

      if (chatNeedsRestart) {
        chatListener?.stop();
        if (config.twitch?.enabled || config.youtube?.enabled) {
          chatListener = createChatListener(config, commands, sm, broadcastState);
          chatListener.start();
        } else {
          chatListener = null;
        }
      }

      obsServer?.broadcast({ reloadCommands: true });
    },
    saveConfig: (patch) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (patch.twitch) {
        raw.twitch = raw.twitch ?? {};
        config.twitch = config.twitch ?? {};
        if (patch.twitch.enabled  !== undefined) { raw.twitch.enabled  = patch.twitch.enabled;  config.twitch.enabled  = patch.twitch.enabled; }
        if (patch.twitch.channel  !== undefined) { raw.twitch.channel  = patch.twitch.channel;  config.twitch.channel  = patch.twitch.channel; }
      }
      if (patch.youtube) {
        raw.youtube = raw.youtube ?? {};
        config.youtube = config.youtube ?? {};
        if (patch.youtube.enabled !== undefined) { raw.youtube.enabled = patch.youtube.enabled; config.youtube.enabled = patch.youtube.enabled; }
        if (patch.youtube.channel !== undefined) { raw.youtube.channel = patch.youtube.channel; config.youtube.channel = patch.youtube.channel; }
      }
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      // Hot-reload chat listener with updated config
      chatListener?.stop();
      if (config.twitch?.enabled || config.youtube?.enabled) {
        chatListener = createChatListener(config, commands, sm, broadcastState);
        chatListener.start();
      } else {
        chatListener = null;
      }
    },
    saveEnv: ({ TWITCH_OAUTH, YOUTUBE_API_KEY } = {}) => {
      if (TWITCH_OAUTH    !== undefined) process.env.TWITCH_OAUTH    = TWITCH_OAUTH;
      if (YOUTUBE_API_KEY !== undefined) process.env.YOUTUBE_API_KEY = YOUTUBE_API_KEY;
      chatListener?.stop();
      if (config.twitch?.enabled || config.youtube?.enabled) {
        chatListener = createChatListener(config, commands, sm, broadcastState);
        chatListener.start();
      } else {
        chatListener = null;
      }
    },
    getAnimations: () => ({
      animations: { ...DEFAULT_ANIMATIONS, ...(config.animations ?? {}) },
      defaults:   DEFAULT_ANIMATIONS,
    }),
    saveAnimations: ({ animations: patch, greetingAnimations } = {}) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (patch !== undefined) {
        raw.animations = patch;
        config.animations = patch;
      }
      if (greetingAnimations !== null && greetingAnimations !== undefined) {
        raw.greetingAnimations = greetingAnimations;
        config.greetingAnimations = greetingAnimations;
        obsServer?.broadcast({ setWaveVariants: greetingAnimations });
      }
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      const merged = { ...DEFAULT_ANIMATIONS, ...(patch ?? {}) };
      obsServer?.broadcast({ setAnimations: merged });
      win?.webContents.send('animations-update', merged);
    },
    getVersion: () => app.getVersion(),
    userDataDir,
    openUrl: (url) => shell.openExternal(url),
    openUserDataDir: () => shell.openPath(userDataDir),
    openConfigFile: () => shell.openPath(path.join(userDataDir, 'config.json')),
    togglePet: () => {
      if (!win || win.isDestroyed()) {
        createPetWindow();
      } else {
        win.close();
      }
    },
  });
  obsServer.start().then(() => {
    const port = obsServer.port();
    console.log(`[OBS] http://localhost:${port}`);
  });
  obsServer.onClientMessage((msg) => {
    if (msg.cmd === 'feed') {
      sm.yolia_see = Math.max(0, sm.yolia_see - 15);
      win?.webContents.send('yolia-update', { value: sm.yolia_see, state: 'eat', animOnly: true });
      obsServer.broadcast({ value: sm.yolia_see, state: 'eat', animOnly: true });
      obsServer.setWelcomeData({ value: sm.yolia_see, state: 'eat', animOnly: true });
      setTimeout(() => { sm.state = sm.computeState(); broadcastState(); }, 3000);
    } else if (msg.cmd === 'punish') {
      sm.punish();
      broadcastState();
    } else if (msg.cmd === 'setYoliaSee') {
      sm.yolia_see = Math.max(0, Math.min(100, msg.value ?? 0));
      sm.state     = sm.computeState();
      broadcastState();
    }
  });
}

// ── Chat listener ─────────────────────────────────────────────────────────────
let chatListener = null;
if (config.twitch?.enabled || config.youtube?.enabled) {
  chatListener = createChatListener(config, commands, sm, broadcastState);
  chatListener.start();
}

// ── Electron overlay ──────────────────────────────────────────────────────────
function createPetWindow() {
  if (win && !win.isDestroyed()) return;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  win = new BrowserWindow({
    width, height, x: 0, y: 0,
    transparent: true, frame: false, alwaysOnTop: true,
    skipTaskbar: true, resizable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true },
  });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile('renderer/index.html');
  win.setVisibleOnAllWorkspaces(true);
}

app.whenReady().then(() => {

  // Control panel window
  let panelWin = null;
  function openPanel() {
    if (panelWin && !panelWin.isDestroyed()) { panelWin.focus(); return; }
    const port = config.obs?.port ?? 3000;
    panelWin = new BrowserWindow({ width: 860, height: 660, title: 'YoliaWatching 控制面板', webPreferences: { partition: 'in-memory-panel' } });
    panelWin.loadURL(`http://localhost:${port}/panel`);
    panelWin.setMenu(null);
    let quitting = false;
    panelWin.on('close', async (e) => {
      if (quitting) return;
      e.preventDefault();
      const { response } = await dialog.showMessageBox(panelWin, {
        type: 'none',
        buttons: ['確定離開', '取消'],
        defaultId: 1,
        message: '確定要關閉 YoliaWatching 嗎？',
      });
      if (response === 0) { quitting = true; app.quit(); }
    });
  }
  if (config.modes?.obs) openPanel();

  // System tray — always present so there is a way to quit
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/favicon.ico'));
  tray = new Tray(icon);
  tray.setToolTip('YoliaWatching 👁️');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '👁️ YoliaWatching', enabled: false },
    { type: 'separator' },
    ...(config.modes?.obs ? [{ label: '控制面板', click: () => openPanel() }] : []),
    { label: '結束', click: () => app.quit() },
  ]));

  // Baron detection loop every 2s
  setInterval(async () => {
    const titles = await getAllWindowTitles();
    if (matchesStream(titles) && matchesBaron(titles)) {
      if (win) win.webContents.send('baron-event');
    }
  }, 2000);
});

ipcMain.on('punish', () => {
  sm.punish();
  broadcastState();
});

ipcMain.on('set-yolia-see', (_e, v) => {
  sm.yolia_see = Math.max(0, Math.min(100, v));
  sm.state     = sm.computeState();
  broadcastState();
});

ipcMain.on('feed', () => {
  sm.yolia_see = Math.max(0, sm.yolia_see - 15);
  win?.webContents.send('yolia-update', { value: sm.yolia_see, state: 'eat', animOnly: true });
  obsServer?.broadcast({ value: sm.yolia_see, state: 'eat', animOnly: true });
  setTimeout(() => {
    sm.state = sm.computeState();
    broadcastState();
  }, 3000);
});

ipcMain.on('set-click-through', (_e, on) => {
  win?.setIgnoreMouseEvents(on, { forward: true });
});

ipcMain.on('quit', () => win?.close());

ipcMain.handle('get-config', () => ({
  greetingAnimations: config.greetingAnimations ?? [],
  animations: { ...DEFAULT_ANIMATIONS, ...(config.animations ?? {}) },
}));

app.on('window-all-closed', () => {});

