import { contextBridge, ipcRenderer } from 'electron';

/**
 * Minimal, context-isolated bridge exposed as window.hauddyDesktop in the
 * app (@hauddy/app-ui) renderer. The UI degrades gracefully in a plain browser (see
 * src/bridge.ts in @hauddy/app-ui).
 */
contextBridge.exposeInMainWorld('hauddyDesktop', {
  isDesktop: true,
  /** Show the full window, navigated to a HashRouter route like
   *  '/network/agents/@gio?add=1'. */
  expand: (route?: string) => ipcRenderer.invoke('hauddy:expand', route),
  quit: () => ipcRenderer.invoke('hauddy:quit'),
  /** Set the Dock badge to a notification count (0 clears it). */
  setBadge: (count: number) => ipcRenderer.invoke('hauddy:badge', count),
  /** Fire a native OS notification. */
  notify: (input: { title: string; body: string }) => ipcRenderer.invoke('hauddy:notify', input),
});
