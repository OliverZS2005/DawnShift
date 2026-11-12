// The desktop app: shows the hosted Dawnshift (same accounts as the website
// and the Android app) in its own window. Build installers with
// `npm run build:desktop`. Older versions ran a local copy; its data folder
// is left untouched.
import { app, BrowserWindow, Menu, dialog, nativeTheme, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ICON = path.join(here, 'icon.png');
const WEBSITE = 'https://dawnshift.dawnlife.online';

const dawnshift = { url: WEBSITE, dataDir: null };
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
  dawnshift.dataDir = path.join(app.getPath('userData'), 'data');
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

  win.webContents.on('did-fail-load', (_e, code, desc, url, isMain) => {
    if (!isMain || code === -3) return;
    dialog.showErrorBox('Dawnshift could not connect', `Couldn't reach ${WEBSITE} (${desc}). Check your internet connection, then use View → Reload.`);
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

// Bots run on the server, so closing the window just quits the app.
app.on('window-all-closed', () => app.quit());
