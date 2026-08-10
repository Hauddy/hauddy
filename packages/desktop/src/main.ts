import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, nativeImage, Notification, screen, Tray, utilityProcess } from 'electron';

/**
 * hauddy desktop — macOS menu-bar app.
 *
 * Lifecycle:
 *  - starts as an accessory (no Dock icon), creates the tray item and the
 *    hidden popover window; the full window is created lazily on first expand.
 *  - tray left-click toggles the compact popover under the icon; the popover
 *    hides on blur; tray right-click shows Open / Quit.
 *  - "expand" (from the compact UI, via preload IPC) flips to the regular
 *    activation policy (Dock icon appears) and shows the full window; when
 *    the full window closes, the app returns to accessory.
 *  - window-all-closed never quits: this is a menu-bar app, Quit comes from
 *    the tray menu or the compact view's quit affordance.
 */

const POPOVER_W = 340;
const POPOVER_H = 440;
const FULL_W = 1000;
const FULL_H = 700;

const isDev = process.env.HAUDDY_DEV === '1';
const DEV_URL = process.env.HAUDDY_DEV_URL ?? 'http://localhost:5201';

let tray: Tray | null = null;
let popover: BrowserWindow | null = null;
let fullWin: BrowserWindow | null = null;
let daemon: Electron.UtilityProcess | null = null;

function startDaemon(): void {
  const bundlePath = app.isPackaged
    ? path.join(process.resourcesPath, 'daemon', 'daemon.mjs')
    : path.join(__dirname, '..', 'daemon-bundle', 'daemon.mjs');
  daemon = utilityProcess.fork(bundlePath, ['daemon'], {
    stdio: 'pipe',
    env: { ...process.env, HAUDDY_EMBEDDED: '1' },
  });
  daemon.stdout?.on('data', (d: Buffer) => console.log('[daemon]', d.toString().trimEnd()));
  daemon.stderr?.on('data', (d: Buffer) => console.error('[daemon]', d.toString().trimEnd()));
  daemon.on('exit', (code) => {
    // Don't restart — if the daemon crashes the app UI will show disconnected.
    // The user can quit and reopen. Avoids restart loops during alpha.
    console.error(`[daemon] exited with code ${code}`);
    daemon = null;
  });
}
/** The Hauddy Dock icon — re-applied after every dock.show() since a
 *  setIcon done in accessory mode doesn't always stick once the Dock appears. */
let appIcon: Electron.NativeImage | null = null;
function applyDockIcon(): void {
  if (appIcon && !appIcon.isEmpty()) app.dock?.setIcon(appIcon);
}

function uiIndexPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app', 'index.html')
    : path.join(__dirname, '..', '..', 'app', 'dist', 'index.html');
}

function loadUi(win: BrowserWindow, hashRoute: string): void {
  if (isDev) {
    void win.loadURL(`${DEV_URL}/#${hashRoute}`);
  } else {
    void win.loadFile(uiIndexPath(), { hash: hashRoute });
  }
}

// ---------- popover ----------

function createPopover(): BrowserWindow {
  const win = new BrowserWindow({
    width: POPOVER_W,
    height: POPOVER_H,
    show: false,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: '#121415',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  loadUi(win, '/compact');
  win.on('blur', () => {
    if (!win.webContents.isDevToolsOpened()) hidePopover();
  });
  return win;
}

function showPopover(): void {
  if (!tray || !popover) return;
  const bounds = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: bounds.x, y: bounds.y });
  const area = display.workArea;
  const x = Math.round(
    Math.min(
      Math.max(bounds.x + bounds.width / 2 - POPOVER_W / 2, area.x + 8),
      area.x + area.width - POPOVER_W - 8,
    ),
  );
  const y = Math.round(bounds.y + bounds.height + 6);
  popover.setPosition(x, y, false);
  popover.show();
  popover.focus();
  console.log(`[desktop] popover shown at ${x},${y} (${POPOVER_W}x${POPOVER_H})`);
}

function hidePopover(): void {
  if (popover?.isVisible()) console.log('[desktop] popover hidden');
  popover?.hide();
}

function togglePopover(): void {
  if (popover?.isVisible()) hidePopover();
  else showPopover();
}

// ---------- full window ----------

function createFullWindow(initialRoute: string): BrowserWindow {
  const win = new BrowserWindow({
    width: FULL_W,
    height: FULL_H,
    show: false,
    title: 'hauddy',
    backgroundColor: '#121415',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  loadUi(win, initialRoute);
  win.on('closed', () => {
    fullWin = null;
    // back to menu-bar-only presence
    app.setActivationPolicy('accessory');
  });
  return win;
}

/** Show the full window at a route — the "expand" path from the compact UI. */
function expandTo(route: string): void {
  hidePopover();
  app.setActivationPolicy('regular');
  app.dock?.show();
  applyDockIcon(); // re-assert our icon now that the Dock is visible
  if (!fullWin) {
    fullWin = createFullWindow(route);
    fullWin.once('ready-to-show', () => {
      fullWin?.show();
      fullWin?.focus();
    });
  } else {
    // already loaded — just re-point the HashRouter, no reload
    void fullWin.webContents.executeJavaScript(
      `window.location.hash = ${JSON.stringify(`#${route}`)};`,
    );
    fullWin.show();
    fullWin.focus();
  }
}

// ---------- app lifecycle ----------

app.whenReady().then(() => {
  startDaemon();

  // menu-bar accessory: no Dock icon while only the popover exists
  app.setActivationPolicy('accessory');

  // Brand the Dock icon (shown once the full window expands) with the Hauddy mark.
  appIcon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'icon.png'));
  applyDockIcon();

  const icon = nativeImage.createFromPath(path.join(__dirname, '..', 'assets', 'trayTemplate.png'));
  icon.setTemplateImage(true);
  tray = new Tray(icon);
  tray.setToolTip('hauddy — contact & comms for AI agents');
  tray.on('click', togglePopover);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open hauddy', click: () => expandTo('/') },
      { type: 'separator' },
      { label: 'Quit hauddy', click: () => app.quit() },
    ]),
  );

  popover = createPopover();

  ipcMain.handle('hauddy:expand', (_e, route?: string) => {
    expandTo(typeof route === 'string' && route.startsWith('/') ? route : '/');
  });
  ipcMain.handle('hauddy:quit', () => app.quit());

  // Notification count → Dock badge (macOS). 0/NaN clears it.
  ipcMain.handle('hauddy:badge', (_e, count?: number) => {
    const n = typeof count === 'number' && count > 0 ? count : 0;
    app.dock?.setBadge(n > 0 ? String(n) : '');
  });
  // Fire a native OS notification (clicking it opens the full window).
  ipcMain.handle('hauddy:notify', (_e, input?: { title?: string; body?: string }) => {
    if (!Notification.isSupported()) return;
    const notif = new Notification({
      title: input?.title || 'Hauddy',
      body: input?.body || '',
    });
    notif.on('click', () => expandTo('/messages'));
    notif.show();
  });

  // verification aid: HAUDDY_OPEN_POPOVER=1 auto-opens the popover on launch
  if (process.env.HAUDDY_OPEN_POPOVER === '1') {
    setTimeout(showPopover, 1500);
  }
});

// menu-bar app: closing all windows must not quit
app.on('window-all-closed', () => {
  /* stay in the menu bar */
});

app.on('before-quit', () => {
  daemon?.kill();
});
