'use strict';

const { app, BrowserWindow, Menu, shell, dialog, session } = require('electron');
const path = require('path');

// ── Build fingerprint ──────────────────────────────────────────────────────
// Stamped per-copy by build-scripts/stamp-build.js before packaging.
const BUILD_ID = 'PF-100-DEV';

// ── Paths ──────────────────────────────────────────────────────────────────
const TRUSTED_HTML = path.resolve(__dirname, 'puzzleforge.html');

// ── Icon helper (cross-platform) ──────────────────────────────────────────
function appIcon() {
  const base = path.join(__dirname, 'icon');
  return process.platform === 'darwin' ? base + '.icns' : base + '.ico';
}

// ── Security: block debug flags before anything else ──────────────────────
app.commandLine.appendSwitch('disable-background-networking');
if (
  app.commandLine.hasSwitch('remote-debugging-port') ||
  app.commandLine.hasSwitch('inspect') ||
  app.commandLine.hasSwitch('inspect-brk')
) {
  app.quit();
}

// ── Single instance lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) { app.quit(); }

// ── Helper: resolve a file:// URL to an absolute path ─────────────────────
function fileUrlToPath(url) {
  try {
    return path.normalize(
      decodeURIComponent(url.replace(/^file:\/{2,3}/, '').replace(/\//g, path.sep))
    );
  } catch { return ''; }
}

// ── Window references ─────────────────────────────────────────────────────
let mainWindow = null;

// ── Web preferences shared by all windows ─────────────────────────────────
// NOTE: sandbox is intentionally FALSE here.
// The app uses blob: URLs for the print/PDF preview window (window.open with
// a blob: URL). Electron's sandbox blocks blob: window creation in the
// renderer. Keeping sandbox:false lets blob: windows work while all other
// security constraints (nodeIntegration:false, contextIsolation:true,
// webSecurity:true) remain fully enforced.
const SHARED_PREFS = {
  nodeIntegration:             false,
  contextIsolation:            true,
  webSecurity:                 true,
  sandbox:                     false,
  allowRunningInsecureContent: false,
  enableWebSQL:                false,
  preload:                     path.join(__dirname, 'preload.js'),
};

// ── Global hardening: applied to every WebContents ────────────────────────
app.on('web-contents-created', (_e, contents) => {

  // Block DevTools
  contents.on('devtools-opened', () => {
    contents.closeDevTools();
  });

  // Block F12 / Ctrl+Shift+I / Ctrl+U on every window
  contents.on('before-input-event', (event, input) => {
    const ctrl = input.control || input.meta;
    const k    = input.key;
    if (
      k === 'F12' ||
      (ctrl && input.shift && ['i','I','j','J','c','C','k','K'].includes(k)) ||
      (ctrl && ['u','U'].includes(k))
    ) {
      event.preventDefault();
    }
  });

  // Block right-click context menu
  contents.on('context-menu', (e) => e.preventDefault());

  // Block all permissions (camera, mic, notifications, etc.)
  contents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));

  // Navigation: only allow our trusted HTML or blob: (for print preview)
  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('blob:')) return;        // allow blob: print preview
    if (
      url.startsWith('file://') &&
      fileUrlToPath(url) === path.normalize(TRUSTED_HTML)
    ) return;                                   // allow our own HTML
    event.preventDefault();
  });

  // New windows via window.open():
  // - blob: URLs → allow as a small print-preview popup (the PDF feature)
  // - https: URLs → open in system browser
  // - anything else → deny
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('blob:')) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 900, height: 700,
          title: 'PuzzleForge - Print Preview',
          autoHideMenuBar: true,
          webPreferences: {
            nodeIntegration:  false,
            contextIsolation: true,
            sandbox:          false,   // needed to execute the autoprint script in blob
            webSecurity:      true,
          },
        },
      };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });
});

// ── Create main window ─────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    860,
    minWidth:  900,
    minHeight: 600,
    title:     'PuzzleForge',
    icon:      appIcon(),
    backgroundColor: '#faf6ef',
    show: false,
    webPreferences: SHARED_PREFS,
  });

  mainWindow.loadFile(TRUSTED_HTML);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ── App menu ───────────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    ...(isMac ? [{ label: app.name, submenu: [
      { role: 'about' },
      { type: 'separator' },
      { role: 'services' },
      { type: 'separator' },
      { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
      { type: 'separator' },
      { role: 'quit' },
    ]}] : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Session',
          accelerator: 'CmdOrCtrl+N',
          click() { if (mainWindow) mainWindow.reload(); },
        },
        { type: 'separator' },
        {
          label: 'Fullscreen',
          accelerator: isMac ? 'Ctrl+Command+F' : 'F11',
          click() {
            if (mainWindow) mainWindow.setFullScreen(!mainWindow.isFullScreen());
          },
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit PuzzleForge' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About PuzzleForge',
          click() {
            dialog.showMessageBox(mainWindow, {
              type:    'info',
              title:   'About PuzzleForge',
              message: 'PuzzleForge - Puzzle Generator',
              detail:
                'Desktop Edition\n\n' +
                'Generate crosswords, word searches, fill-in-the-blank,\n' +
                'codebreakers, matching puzzles and more.\n\n' +
                '(c) DoyensDesigns. All rights reserved.\n' +
                'Build: ' + BUILD_ID,
              buttons: ['OK'],
              icon: appIcon(),
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ── Lifecycle ──────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();
});

app.on('window-all-closed', () => { app.quit(); });

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('second-instance', () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
});
