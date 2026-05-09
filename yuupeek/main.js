const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const { getAllWindowTitles, matchesStream, matchesBaron } = require('./src/detector');
const { createStateMachine } = require('./src/stateMachine');

let win;
let tray;
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

  // System tray — way to quit since window has no frame
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
    const titles = await getAllWindowTitles();
    const detected = matchesStream(titles);
    sm.tick(detected);
    win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });

    if (detected && matchesBaron(titles)) {
      win.webContents.send('baron-event');
    }
  }, 2000);
});

ipcMain.on('punish', () => {
  sm.punish();
  win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });
});

ipcMain.on('set-yuushi', (_e, v) => {
  sm.yuushi = Math.max(0, Math.min(100, v));
  sm.state  = sm.computeState();
  win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });
});

ipcMain.on('feed', () => {
  sm.yuushi = Math.max(0, sm.yuushi - 15);
  win.webContents.send('yuushi-update', { value: sm.yuushi, state: 'eat' });
  setTimeout(() => {
    sm.state = sm.computeState();
    win.webContents.send('yuushi-update', { value: sm.yuushi, state: sm.state });
  }, 3000);
});

// Toggle click-through: off when hovering character so clicks register, on otherwise
ipcMain.on('set-click-through', (_e, on) => {
  win.setIgnoreMouseEvents(on, { forward: true });
});

ipcMain.on('quit', () => app.quit());

app.on('window-all-closed', () => {});
