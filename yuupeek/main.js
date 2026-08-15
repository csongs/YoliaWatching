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
const { createChatMonitorClient } = require('./src/chatMonitorClient');
const { createObsServer }     = require('./src/obsServer');
const { createPackStore }     = require('./src/packStore');
const { buildAnimationsUpdate, resolveActivePackIds, packIdsCompatFields, packKeyOf } = require('./src/packFormat');
const { DEFAULT_ANIMATIONS }  = require('./src/defaultAnimations');

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

// 角色包(ADR-004):整包存 packs.json,activePackIds 存 config.json(勾選制,可多包)
const packStore = createPackStore(path.join(userDataDir, 'packs.json'));
let prevPackStates = [];   // 上一次廣播時啟用包的狀態鍵(清殘留用)

// 勾選制(2026-07-11):activePackIds 陣列;讀舊 config 只有 activePackId 時視為單元素陣列。
// 折算邏輯收在 packFormat.js 的 resolveActivePackIds(桌面/雲端/panel 共用)。
function activePackIdsList() {
  return resolveActivePackIds(config);
}

function animationsUpdate() {
  return buildAnimationsUpdate(
    { ...DEFAULT_ANIMATIONS, ...userAnimations },
    packStore.mergeActive(activePackIdsList()),
    prevPackStates
  );
}

function broadcastAnimations() {
  const u = animationsUpdate();
  prevPackStates = u.packStates;
  obsServer?.broadcast({ setAnimations: u.broadcast });
}

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
    getStatus: () => ({
      chatMonitor: {
        connected: chatMonitor?.getStatus?.().connected ?? false,
      },
      obs: {
        enabled: true,
        port:    obsServer.port() ?? config.obs?.port ?? 3000,
      },
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
        chatMonitor?.updateHandlers(patch.interactions);
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
    getPacks: () => packStore.getAll(),
    savePack: (pack) => {
      packStore.save(pack);
      // 只在動到啟用中的包時廣播(編輯啟用中的包立即生效,對齊雲端 on() 訂閱行為)
      if (activePackIdsList().includes(pack.id)) broadcastAnimations();
    },
    deletePack: (key) => {
      const wasActive = activePackIdsList().some((id) => packKeyOf(id) === key);
      packStore.remove(key);
      if (wasActive) broadcastAnimations();
    },
    getActivePackIds: () => activePackIdsList(),
    playAnimation: (name) => {
      // 手動試播(layer4 設計 4b):animOnly 播一輪即回 baseState,不動幽視值
      obsServer?.broadcast({ value: sm.yolia_see, state: name, animOnly: true });
    },
    setActivePackIds: (ids) => {
      // 新舊欄位(activePackIds/activePackId)一起寫:降版相容,舊版只認 activePackId
      const fields = packIdsCompatFields(ids);
      const cfgPath = path.join(userDataDir, 'config.json');
      const raw = readUserCfg(cfgPath);
      raw.activePackIds = fields.activePackIds ?? undefined;
      raw.activePackId  = fields.activePackId  ?? undefined;
      config.activePackIds = fields.activePackIds ?? undefined;
      config.activePackId  = fields.activePackId  ?? undefined;
      fs.writeFileSync(cfgPath, JSON.stringify(raw, null, 2), 'utf8');
      broadcastAnimations();
    },
    getAnimations: () => ({
      animations: animationsUpdate().snapshot,
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
      broadcastAnimations();
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
}

// ── Chat monitor client ──────────────────────────────────────────────────────
// 聊天連線本身由獨立的 chat-monitor process 負責(Twitch/YouTube/SOOP),這裡只當它的
// WebSocket 唯讀 client,所以不像舊版 chatListener 需要依 config 的 enabled 開關重啟——
// 固定啟動一次,chat-monitor 沒開著就會靜默重試連線(見 chatMonitorClient.js)。
const chatMonitor = createChatMonitorClient(config, sm, broadcastState);
chatMonitor.start();


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

