import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset paths: the bundle is served by the local sidecar daemon
  // (unknown mount path) and later by Tauri/Electron (file-like origins).
  base: './',
  define: {
    // Baked in at build time from the workspace package.json version.
    // npm sets npm_package_version automatically when running workspace scripts.
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
  },
});
