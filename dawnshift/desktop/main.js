// The desktop app: runs Dawnshift (the same server as `npm start`) inside
// Electron and shows it in its own window, so nobody needs Node.js or a
// terminal. Build installers with `npm run build:desktop`.
import { app, BrowserWindow, Menu, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDawnshift } from '../server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(here, 'icon.png');
const WEBSITE = 'https://dawnshift.dawnlife.online';

let dawnshift = null;
let win = null;

// Only one copy runs at a time; opening it again brings back the window.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

async function start() {
  try {
    // Saved in the usual place for apps' data, e.g. ~/.config/Dawnshift on
    // Linux or %APPDATA%\Dawnshift on Windows. Any free port will do.
    dawnshift = await startDawnshift({ dataDir: path.join(app.getPath('userData'), 'data'), port: 0, host: '127.0.0.1' });
  } catch (err) {
    dialog.showErrorBox('Dawnshift could not start', String(err?.message ?? err));
    app.quit();
    return;
  }
  Menu.setApplicationMenu(buildMenu());
  openWindow();
  app.on('activate', () => {
    if (!win) openWindow();
  });
}

function isOwnPage(url) {
  return url.startsWith(dawnshift.url + '/') || url === dawnshift.url;
}

function openWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 380,
    minHeight: 500,
    title: 'Dawnshift',
    icon: ICON,
    // Matches the page, so there's no white flash while it loads.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#121214' : '#f4f1ea',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      // The window only shows Dawnshift's own pages; it gets no extra powers.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => {
    win = null;
  });

  // Links to other websites (API key pages, the Terms, ...) open in the
  // normal browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isOwnPage(url)) return { action: 'allow' };
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (isOwnPage(url)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });

  win.loadURL(dawnshift.url);
}

function buildMenu() {
  const mac = process.platform === 'darwin';
  return Menu.buildFromTemplate([
    ...(mac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open data folder', click: () => shell.openPath(dawnshift.dataDir) },
        { type: 'separator' },
        mac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    // Also makes copy and paste work on a Mac.
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        { label: 'Dawnshift website', click: () => shell.openExternal(WEBSITE) },
        { label: 'Open-source licenses', click: () => win?.loadURL(`${dawnshift.url}/licenses.html`) },
      ],
    },
  ]);
}

// Bots only work while the app is open, so closing the window quits.
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => dawnshift?.stop());
