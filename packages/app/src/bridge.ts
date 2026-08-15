/**
 * Bridge to the Electron shell (window.hauddyDesktop, exposed by the desktop
 * preload). In a plain browser the same calls degrade to sensible fallbacks
 * so the compact view stays usable in dev without Electron.
 */

export interface HauddyDesktopBridge {
  isDesktop: true;
  expand(route?: string): Promise<void>;
  quit(): Promise<void>;
  setBadge(count: number): Promise<void>;
  notify(input: { title: string; body: string }): Promise<void>;
  relaunch(): Promise<void>;
  downloadUpdate(): Promise<void>;
  installUpdate(): Promise<void>;
  onUpdateProgress(cb: (data: { percent: number }) => void): void;
  onUpdateReady(cb: () => void): void;
  onUpdateError(cb: (data: { message: string }) => void): void;
}

declare global {
  interface Window {
    hauddyDesktop?: HauddyDesktopBridge;
  }
}

/** Update the Dock badge with a notification count (no-op in a plain browser). */
export function setDockBadge(count: number): void {
  void window.hauddyDesktop?.setBadge(count);
}

/** Fire a native OS notification (Electron); browser fallback uses the Web
 *  Notifications API when the user has granted permission. */
export function notifyDesktop(input: { title: string; body: string }): void {
  if (window.hauddyDesktop) {
    void window.hauddyDesktop.notify(input);
    return;
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    new Notification(input.title, { body: input.body });
  }
}

export function isDesktop(): boolean {
  return typeof window !== 'undefined' && !!window.hauddyDesktop;
}

/** Show the full app window at a HashRouter route (e.g. '/network/contacts').
 *  Browser fallback: open the route in a new tab. */
export function expandApp(route: string): void {
  if (window.hauddyDesktop) {
    void window.hauddyDesktop.expand(route);
    return;
  }
  window.open(`${location.origin}${location.pathname}#${route}`, '_blank', 'noopener');
}

/** Quit the app. Browser fallback: close the tab (best effort). */
export function quitApp(): void {
  if (window.hauddyDesktop) {
    void window.hauddyDesktop.quit();
    return;
  }
  window.close();
}

/** Relaunch the app (desktop only). No-op in a plain browser. */
export function relunchApp(): void {
  void window.hauddyDesktop?.relaunch();
}

/** Start downloading and installing an update (desktop only). */
export function downloadUpdate(): void {
  void window.hauddyDesktop?.downloadUpdate();
}

/** Apply the downloaded update by relaunching (desktop only). */
export function installUpdate(): void {
  void window.hauddyDesktop?.installUpdate();
}

export function onUpdateProgress(cb: (data: { percent: number }) => void): void {
  window.hauddyDesktop?.onUpdateProgress(cb);
}

export function onUpdateReady(cb: () => void): void {
  window.hauddyDesktop?.onUpdateReady(cb);
}

export function onUpdateError(cb: (data: { message: string }) => void): void {
  window.hauddyDesktop?.onUpdateError(cb);
}
