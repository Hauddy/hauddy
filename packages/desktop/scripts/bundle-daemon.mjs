/**
 * Bundle the Hauddy daemon (packages/sidecar) into a single CJS file so it
 * can be shipped inside the Electron app and spawned via utilityProcess.fork().
 *
 * node-pty (used only by `hauddy wrap`) is marked external — it's a native
 * module and is never needed when the daemon is started by the app.
 */
import { build } from 'esbuild';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..', '..', '..');

await build({
  entryPoints: [path.join(root, 'packages/sidecar/src/cli.ts')],
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  outfile: path.join(__dirname, '..', 'daemon-bundle', 'daemon.mjs'),
  external: ['node-pty'],
  // CJS deps (e.g. ws) call require() for Node builtins inside an ESM bundle.
  // Inject a real require via createRequire so those calls resolve correctly.
  banner: {
    js: `import { createRequire as __hauddyRequire } from 'module'; const require = __hauddyRequire(import.meta.url);`,
  },
});

console.log('daemon bundle written → packages/desktop/daemon-bundle/daemon.mjs');
