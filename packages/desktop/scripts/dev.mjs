/**
 * Dev runner: starts the app (@hauddy/app-ui) Vite dev server on :5201, waits for it,
 * then launches Electron against it (HAUDDY_DEV=1 → main loads the dev URL).
 * Quitting the app stops the dev server too.
 */
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const desktopDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(desktopDir, '..', '..');
const PORT = process.env.HAUDDY_VITE_PORT ?? '5201';
const DEV_URL = process.env.HAUDDY_DEV_URL ?? `http://localhost:${PORT}`;

const vite = spawn(
  'npm',
  ['run', 'dev', '-w', '@hauddy/app-ui', '--', '--port', PORT, '--strictPort'],
  { cwd: repoRoot, stdio: 'inherit' },
);

function waitForServer(url, tries = 120) {
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (left <= 0) reject(new Error(`dev server at ${url} never came up`));
        else setTimeout(() => attempt(left - 1), 500);
      });
    };
    attempt(tries);
  });
}

function shutdown(code) {
  vite.kill('SIGTERM');
  process.exit(code ?? 0);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

// main process TypeScript must be compiled already — check cheaply
import { existsSync } from 'node:fs';
if (!existsSync(path.join(desktopDir, 'dist', 'main.js'))) {
  console.error('[desktop] dist/main.js missing — run `npm run build -w @hauddy/desktop` first.');
  shutdown(1);
}

await waitForServer(DEV_URL);
console.log(`[desktop] dev server up at ${DEV_URL} — launching Electron`);

const electronBin = require('electron');
const electron = spawn(electronBin, ['.'], {
  cwd: desktopDir,
  stdio: 'inherit',
  env: { ...process.env, HAUDDY_DEV: '1', HAUDDY_DEV_URL: DEV_URL },
});
electron.on('close', (code) => shutdown(code ?? 0));
