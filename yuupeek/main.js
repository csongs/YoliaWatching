const { app, BrowserWindow, Tray, Menu, nativeImage, shell, dialog } = require('electron');

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
    fs.copyFileSync(path.join(appDir, 'default.config.json'), userCfg);
  }
}

require('dotenv').config({ path: path.join(userDataDir, '.env') });

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
  wave:           { folder: 'waving',        frames: [0,1,2,3,2,1,0], ms: 200,  loop: false },
  watch_excited:  { folder: 'watch-excited', frames: [0,0,0,1,2,1,2,1,2,3,3,3,3], ms: 300,  loop: false },
};

const defaultConfig = JSON.parse(fs.readFileSync(path.join(appDir, 'default.config.json'), 'utf8'));
const userConfig    = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(userDataDir, 'config.json'), 'utf8')); }
  catch { return {}; }
})();
const config = deepMerge(defaultConfig, userConfig);

function readUserCfg(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return {}; }
}

// User animation overrides live in animations.json (separate from config.json)
const animationsPath = path.join(userDataDir, 'animations.json');
let userAnimations = (() => {
  try { return JSON.parse(fs.readFileSync(animationsPath, 'utf8')); }
  catch { return {}; }
})();

let tray;
const sm = createStateMachine(config);

function broadcastState(payload) {
  const data = payload ?? { value: sm.yolia_see, state: sm.state };
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
      soop: {
        enabled:   config.soop?.enabled ?? false,
        connected: chatListener?.getStatus?.().soop.connected ?? false,
        channel:   config.soop?.channel ?? '',
        apiMode:   config.soop?.apiMode ?? 'community',
      },
      obs: {
        enabled: true,
        port:    obsServer.port() ?? config.obs?.port ?? 3000,
      },
    }),
    getConfig: () => ({
      twitch:  { enabled: config.twitch?.enabled  ?? false, channel: config.twitch?.channel  ?? '' },
      youtube: { enabled: config.youtube?.enabled ?? false, channel: config.youtube?.channel ?? '' },
      soop:    { enabled: config.soop?.enabled    ?? false, channel: config.soop?.channel    ?? '', apiMode: config.soop?.apiMode ?? 'community' },
    }),
    getDefaultPetConfig: () => ({
      interactions:       defaultConfig.interactions       ?? [],
      greetingAnimations: defaultConfig.greetingAnimations ?? [],
      scale:              defaultConfig.obs?.scale         ?? 1,
    }),
    setDefaultPetConfig: (patch) => {
      const cfgPath = path.join(appDir, 'default.config.json');
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      if (patch.interactions       !== undefined) { raw.interactions       = patch.interactions;       defaultConfig.interactions       = patch.interactions; }
      if (patch.greetingAnimations !== undefined) { raw.greetingAnimations = patch.greetingAnimations; defaultConfig.greetingAnimations = patch.greetingAnimations; }
      if (patch.scale              !== undefined) { raw.obs = raw.obs ?? {}; raw.obs.scale = patch.scale; defaultConfig.obs = defaultConfig.obs ?? {}; defaultConfig.obs.scale = patch.scale; }
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
    },
    getPetConfig: () => ({
      interactions:       config.interactions       ?? [],
      greetingAnimations: config.greetingAnimations ?? [],
      scale:              config.obs?.scale         ?? 2,
    }),
    savePetConfig: (patch) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = readUserCfg(cfgPath);

      if (patch.interactions !== undefined) {
        raw.interactions = patch.interactions;
        config.interactions = patch.interactions;
        const thresholds = patch.interactions.filter(i => i.trigger === 'threshold');
        sm.updateStates(thresholds);
        sm.state = sm.computeState();
        broadcastState();
        chatListener?.updateHandlers(patch.interactions);
      }
      if (patch.greetingAnimations !== undefined) {
        raw.greetingAnimations = patch.greetingAnimations;
        config.greetingAnimations = patch.greetingAnimations;
        obsServer?.broadcast({ setWaveVariants: patch.greetingAnimations });
      }
      if (patch.scale !== undefined) {
        raw.obs = raw.obs ?? {};
        config.obs = config.obs ?? {};
        raw.obs.scale = patch.scale;
        config.obs.scale = patch.scale;
        obsServer?.broadcast({ setScale: patch.scale });
      }

      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      obsServer?.broadcast({ reloadCommands: true });
    },
    saveConfig: (patch) => {
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = readUserCfg(cfgPath);
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
      if (patch.soop) {
        raw.soop = raw.soop ?? {};
        config.soop = config.soop ?? {};
        if (patch.soop.enabled !== undefined) { raw.soop.enabled = patch.soop.enabled; config.soop.enabled = patch.soop.enabled; }
        if (patch.soop.channel !== undefined) { raw.soop.channel = patch.soop.channel; config.soop.channel = patch.soop.channel; }
        if (patch.soop.apiMode !== undefined) { raw.soop.apiMode = patch.soop.apiMode; config.soop.apiMode = patch.soop.apiMode; }
      }
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      // Hot-reload chat listener with updated config
      chatListener?.stop();
      if (config.twitch?.enabled || config.youtube?.enabled || config.soop?.enabled) {
        chatListener = createChatListener(config, sm, broadcastState);
        chatListener.start();
      } else {
        chatListener = null;
      }
    },
    saveEnv: ({ TWITCH_OAUTH, YOUTUBE_API_KEY, SOOP_API_KEY } = {}) => {
      if (TWITCH_OAUTH    !== undefined) process.env.TWITCH_OAUTH    = TWITCH_OAUTH;
      if (YOUTUBE_API_KEY !== undefined) process.env.YOUTUBE_API_KEY = YOUTUBE_API_KEY;
      if (SOOP_API_KEY    !== undefined) process.env.SOOP_API_KEY    = SOOP_API_KEY;
      chatListener?.stop();
      if (config.twitch?.enabled || config.youtube?.enabled || config.soop?.enabled) {
        chatListener = createChatListener(config, sm, broadcastState);
        chatListener.start();
      } else {
        chatListener = null;
      }
    },
    getAnimations: () => ({
      animations: { ...DEFAULT_ANIMATIONS, ...userAnimations },
      defaults:   DEFAULT_ANIMATIONS,
    }),
    saveAnimations: ({ animations: patch, greetingAnimations } = {}) => {
      if (patch !== undefined) {
        // Only persist keys that differ from DEFAULT_ANIMATIONS
        const overrides = {};
        for (const [k, v] of Object.entries(patch)) {
          if (JSON.stringify(v) !== JSON.stringify(DEFAULT_ANIMATIONS[k])) overrides[k] = v;
        }
        userAnimations = overrides;
        fs.writeFileSync(animationsPath, JSON.stringify(overrides, null, 2), 'utf8');
      }
      if (greetingAnimations != null) {
        const cfgPath = path.join(userDataDir, 'config.json');
        const raw = readUserCfg(cfgPath);
        raw.greetingAnimations = greetingAnimations;
        config.greetingAnimations = greetingAnimations;
        fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
        obsServer?.broadcast({ setWaveVariants: greetingAnimations });
      }
      obsServer?.broadcast({ setAnimations: { ...DEFAULT_ANIMATIONS, ...userAnimations } });
    },
    getMetrics: () => {
      const winMap = {};
      BrowserWindow.getAllWindows().forEach(w => {
        try { winMap[w.webContents.getOSProcessId()] = { title: w.getTitle(), url: w.webContents.getURL() }; } catch {}
      });
      return {
        processes: app.getAppMetrics().map(p => ({
          type:     p.type,
          pid:      p.pid,
          cpu:      p.cpu,
          memoryMB: Math.round(p.memory.workingSetSize / 1024),
          window:   winMap[p.pid] ?? null,
        })),
      };
    },
    getVersion: () => app.getVersion(),
    userDataDir,
    openUrl: (url) => shell.openExternal(url),
    openUserDataDir: () => shell.openPath(userDataDir),
    openConfigFile: () => shell.openPath(path.join(userDataDir, 'config.json')),
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
if (config.twitch?.enabled || config.youtube?.enabled || config.soop?.enabled) {
  chatListener = createChatListener(config, sm, broadcastState);
  chatListener.start();
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
    panelWin.webContents.setWindowOpenHandler(({ url }) => {
      try {
        const parsed = new URL(url);
        if (parsed.hostname === 'localhost' && parsed.port === String(port)) {
          return {
            action: 'allow',
            overrideBrowserWindowOptions: {
              width: 1280, height: 720,
              title: 'OBS 預覽',
              autoHideMenuBar: true,
            },
          };
        }
      } catch {}
      shell.openExternal(url);
      return { action: 'deny' };
    });
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

});

app.on('window-all-closed', () => {});

