import { contextBridge, ipcRenderer } from 'electron';

/**
 * Minimal, context-isolated bridge exposed as window.hauddyDesktop in the
 * app (@hauddy/app-ui) renderer. The UI degrades gracefully in a plain browser (see
 * src/bridge.ts in @hauddy/app-ui).
 */
contextBridge.exposeInMainWorld('hauddyDesktop', {
  isDesktop: true,
  expand: (route?: string) => ipcRenderer.invoke('hauddy:expand', route),
  quit: () => ipcRenderer.invoke('hauddy:quit'),
  setBadge: (count: number) => ipcRenderer.invoke('hauddy:badge', count),
  notify: (input: { title: string; body: string }) => ipcRenderer.invoke('hauddy:notify', input),
  relaunch: () => ipcRenderer.invoke('app:relaunch'),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb: (data: { percent: number }) => void) => {
    ipcRenderer.on('update:progress', (_e, data: { percent: number }) => cb(data));
  },
  onUpdateReady: (cb: () => void) => {
    ipcRenderer.on('update:ready', () => cb());
  },
  onUpdateError: (cb: (data: { message: string }) => void) => {
    ipcRenderer.on('update:error', (_e, data: { message: string }) => cb(data));
  },
});
