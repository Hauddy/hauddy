// node-pty 1.x prebuilds ship `spawn-helper` without the execute bit, so the
// first PTY spawn fails with "posix_spawnp failed". Restore +x on install so
// `hauddy wrap` works out of the box. No-op if node-pty isn't present.
import { chmodSync, existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

try {
  const require = createRequire(import.meta.url);
  const prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
  if (existsSync(prebuilds)) {
    for (const dir of readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, dir, "spawn-helper");
      if (existsSync(helper)) {
        try {
          chmodSync(helper, 0o755);
        } catch {
          /* ignore */
        }
      }
    }
  }
} catch {
  /* node-pty not installed — wrap is optional, nothing to fix */
}
