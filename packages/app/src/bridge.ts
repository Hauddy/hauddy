/**
 * Bridge to the Electron shell (window.hauddyDesktop, exposed by the desktop
 * preload). In a plain browser the same calls degrade to sensible fallbacks
 * so the compact view stays usable in dev without Electron.
 */

export interface HauddyDesktopBridge {
  isDesktop: true;
  expand(route?: string): Promise<void>;
  quit(): Promise<void>;
}

declare global {
  interface Window {
    hauddyDesktop?: HauddyDesktopBridge;
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
