import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startHub } from "./server.js";

export { startHub } from "./server.js";
export type { HubHandle, HubOptions, RemoteAgent } from "./server.js";
export { HubStore } from "./store.js";
export type { AgentRecord, ContactRecord } from "./store.js";
export { HubHistory } from "./history.js";
export type { CallRow, FrameRow, HistoryMessage, MessageRow, ThreadSummary } from "./history.js";
export { FileStore } from "./files.js";
export type { FileMeta } from "./files.js";

// Run as a server:
//   node dist/index.js [--port 8787] [--data-dir data] [--host 127.0.0.1] [--cors-origin URL] [--allowlist FILE]
// Deployed as the platform (autoLink off): rate limiting is ON by default
// (HAUDDY_RATE_LIMIT=0 to disable); the invite gate activates once an
// allowlist file exists at <data-dir>/allowlist.txt (or --allowlist / HAUDDY_ALLOWLIST).
const invokedAs = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedAs && fileURLToPath(import.meta.url) === invokedAs) {
  const args = process.argv.slice(2);
  const option = (name: string, fallback: string): string => {
    const i = args.indexOf(name);
    return i >= 0 && args[i + 1] ? args[i + 1]! : fallback;
  };
  const dataDir = option("--data-dir", "data");
  const allowlistFile = option("--allowlist", process.env.HAUDDY_ALLOWLIST ?? path.join(dataDir, "allowlist.txt"));
  const corsOrigin = option("--cors-origin", process.env.HAUDDY_CORS_ORIGIN ?? "*");
  const hub = await startHub({
    port: Number(option("--port", "8787")),
    host: option("--host", process.env.HAUDDY_HOST ?? "127.0.0.1"),
    dataDir,
    allowlistFile,
    allowOrigin: corsOrigin,
    rateLimit: process.env.HAUDDY_RATE_LIMIT !== "0",
  });
  const gate = existsSync(allowlistFile) ? `invite-only (${allowlistFile})` : "OPEN signup (no allowlist file)";
  console.log(`hauddy hub listening: ws ${hub.wsUrl}  control ${hub.httpUrl}`);
  console.log(`  signup: ${gate}  ·  rate-limit: ${process.env.HAUDDY_RATE_LIMIT !== "0" ? "on" : "off"}  ·  cors: ${corsOrigin}`);
}
