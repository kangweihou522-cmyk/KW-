const path = require('node:path');
const fs = require('node:fs');
const { app, BrowserWindow, ipcMain, shell, session, dialog } = require('electron');
const { resolvePaperDeskHome } = require('./backend/paperdeskPaths.cjs');
const { createBackend } = require('./backend.cjs');
const {
  registerLocalPdfProtocol,
  registerLocalPdfProtocolScheme,
} = require('./localPdfProtocol.cjs');

const isDev = Boolean(process.env.VITE_DEV_SERVER_URL);
let backend = null;

// Select storage before Chromium or the backend creates any profile files.
try {
  const home = resolvePaperDeskHome(app);
  for (const folder of ['data/chromium', 'library', 'models', 'cache/chromium', 'backups']) {
    fs.mkdirSync(path.join(home, folder), { recursive: true });
  }
  process.env.PAPERDESK_HOME = home;
  app.setPath('userData', path.join(home, 'data', 'chromium'));
  app.setPath('sessionData', path.join(home, 'cache', 'chromium'));
} catch (error) {
  dialog.showErrorBox('PaperDesk 无法选择资料目录', error.message);
  app.exit(1);
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) app.quit();
app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows()[0];
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show();
    window.focus();
  }
});

registerLocalPdfProtocolScheme();

function getBackend() {
  if (!backend) {
    backend = createBackend({ app });
  }

  return backend;
}

function getAppIconPath() {
  const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const iconRoot = app.isPackaged ? 'dist' : 'public';

  return path.join(__dirname, '..', iconRoot, iconFileName);
}

function shouldIgnoreRendererConsoleMessage(level, message) {
  return (
    level === 'info' &&
    /^Warning: (Bad value, for custom key|TT: undefined function)/.test(message)
  );
}

function createWindow() {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1040,
    minHeight: 720,
    title: 'PaperDesk',
    frame: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    icon: getAppIconPath(),
    backgroundColor: '#eef2f8',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  if (isDev) {
    mainWindow.webContents.on('console-message', (event) => {
      const message = String(event.message ?? '');

      if (shouldIgnoreRendererConsoleMessage(event.level, message)) {
        return;
      }

      const source = event.sourceId ? `${event.sourceId}:${event.lineNumber}` : `line ${event.lineNumber ?? '?'}`;
      console.log(`[renderer:${event.level ?? 'info'}] ${message} (${source})`);
    });

    mainWindow.webContents.on('render-process-gone', (_event, details) => {
      console.error('[renderer] process gone', details);
    });

    mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedUrl) => {
      console.error(`[renderer] failed to load ${validatedUrl}: ${errorCode} ${errorDescription}`);
    });
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const allowedDevUrl = isDev && url.startsWith(process.env.VITE_DEV_SERVER_URL);
    const allowedFileUrl = !isDev && url.startsWith('file://');

    if (allowedDevUrl || allowedFileUrl) {
      return;
    }

    event.preventDefault();

    if (/^https?:\/\//i.test(url)) {
      void shell.openExternal(url);
    }
  });

  if (isDev) {
    void mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

ipcMain.handle('paperquay:invoke', async (event, command, args) => {
  return getBackend().invoke(command, args ?? {}, event);
});

ipcMain.handle('paperquay:window-control', (event, action) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender);

  if (!targetWindow) {
    return;
  }

  if (action === 'minimize') {
    targetWindow.minimize();
    return;
  }

  if (action === 'toggleMaximize') {
    if (targetWindow.isMaximized()) {
      targetWindow.unmaximize();
    } else {
      targetWindow.maximize();
    }
    return;
  }

  if (action === 'close') {
    targetWindow.close();
  }
});

app.whenReady().then(() => {
  if (!ownsInstance) return;
  // Reading, notes and local AI do not load remote renderer resources.
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      let local = false;
      try {
        local = ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(details.url).hostname);
      } catch {}
      callback({ cancel: !local });
    },
  );
  if (process.platform === 'win32') {
    app.setAppUserModelId('local.paperdesk.app');
  }

  getBackend();
  registerLocalPdfProtocol();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  backend?.close();
});
