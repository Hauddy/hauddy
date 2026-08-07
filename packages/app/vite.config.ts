import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the bundle is served by the local sidecar daemon
  // (unknown mount path) and later by Tauri/Electron (file-like origins).
  base: './',
});
