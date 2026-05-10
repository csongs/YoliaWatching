const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');

const appDir = app.isPackaged ? path.dirname(process.execPath) : __dirname;
require('dotenv').config({ path: path.join(appDir, '.env') });

const { getAllWindowTitles, matchesStream, matchesBaron } = require('./src/detector');
const { createStateMachine } = require('./src/stateMachine');
const { createChatListener }  = require('./src/chatListener');
const { createObsServer }     = require('./src/obsServer');

const config = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
const commands = config.commands ?? {};

let win;
let tray;
const sm = createStateMachine(config);

function broadcastState(payload) {
  const data = payload ?? { value: sm.yolia_see, state: sm.state };
  if (win) win.webContents.send('yolia-update', data);
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
    appDir,
    getStatus: () => ({
      twitch: {
        enabled:   config.twitch?.enabled ?? false,
        connected: chatListener?.getStatus?.().twitch.connected ?? false,
        channel:   config.twitch?.channel ?? '',
      },
      youtube: {
        enabled: config.youtube?.enabled ?? false,
        live:    chatListener?.getStatus?.().youtube.live ?? false,
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
    openConfigFile: () => shell.openPath(path.join(appDir, 'config.json')),
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
  if (config.modes?.pet) createPetWindow();

  // Control panel window
  let panelWin = null;
  function openPanel() {
    if (panelWin && !panelWin.isDestroyed()) { panelWin.focus(); return; }
    const port = config.obs?.port ?? 3000;
    panelWin = new BrowserWindow({ width: 860, height: 660, title: 'YoliaWatching 控制面板' });
    panelWin.loadURL(`http://localhost:${port}/panel`);
    panelWin.setMenu(null);
    let quitting = false;
    panelWin.on('close', async (e) => {
      if (quitting) return;
      e.preventDefault();
      const { response } = await dialog.showMessageBox(panelWin, {
        type: 'question',
        buttons: ['確定離開', '取消'],
        defaultId: 1,
        message: '確定要關閉 YoliaWatching 嗎？',
      });
      if (response === 0) { quitting = true; app.quit(); }
    });
  }
  if (config.modes?.obs) openPanel();

  // System tray — always present so there is a way to quit
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets/icon.png'));
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
}));

app.on('window-all-closed', () => {});
