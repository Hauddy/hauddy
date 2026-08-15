import { chmodSync, existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import { createRequire } from "node:module";
import path from "node:path";
import type { IPty } from "node-pty";
import { slugifyNickname } from "@hauddy/protocol";
import { hauddyHome } from "./account.js";
import { findIdentityFile, loadIdentity } from "./identity.js";
import type { Injection } from "./inject.js";

/**
 * node-pty 1.x prebuilds ship `spawn-helper` without the execute bit, so the
 * first PTY spawn dies with "posix_spawnp failed". Best-effort chmod so
 * `hauddy wrap` self-heals on a fresh install (no manual step for users).
 */
function fixSpawnHelper(): void {
  try {
    const require = createRequire(import.meta.url);
    const prebuilds = path.join(path.dirname(require.resolve("node-pty/package.json")), "prebuilds");
    if (!existsSync(prebuilds)) return;
    for (const dir of readdirSync(prebuilds)) {
      const helper = path.join(prebuilds, dir, "spawn-helper");
      if (existsSync(helper)) {
        try {
          chmodSync(helper, 0o755);
        } catch {
          /* not ours to chmod — ignore */
        }
      }
    }
  } catch {
    /* node-pty not resolvable — the caller already handles spawn failure */
  }
}

/**
 * Ensure the current project's hauddy HTTP MCP URL in ~/.claude.json includes
 * `?id=<dir-slug>` so each project directory gets its own agent identity.
 * Without this, all projects share `localId="claude"` and collide on one agent.
 */
function patchClaudeJsonMcpUrl(): void {
  const slug = slugifyNickname(path.basename(process.cwd()));
  if (!slug) return;
  const claudeJson = path.join(os.homedir(), ".claude.json");
  if (!existsSync(claudeJson)) return;
  let doc: Record<string, unknown>;
  try {
    doc = JSON.parse(readFileSync(claudeJson, "utf8")) as Record<string, unknown>;
  } catch {
    return;
  }
  const projects = doc.projects as Record<string, Record<string, unknown>> | undefined;
  if (!projects) return;
  const cwd = process.cwd();
  const entry = projects[cwd];
  if (!entry) return;
  const mcpServers = entry.mcpServers as Record<string, { type?: string; url?: string }> | undefined;
  if (!mcpServers?.hauddy) return;
  const server = mcpServers.hauddy;
  if (server.type !== "http" || typeof server.url !== "string") return;
  // Already has the right ?id= — nothing to do.
  try {
    const u = new URL(server.url);
    if (u.searchParams.get("id") === slug) return;
    u.searchParams.set("id", slug);
    server.url = u.toString();
    writeFileSync(claudeJson, JSON.stringify(doc, null, 2));
  } catch {
    return;
  }
}

/**
 * `hauddy wrap <command> [args…]` — Hauddy's reference PTY wrapper, the client
 * for the daemon's per-agent injection stream (the plain-terminal call path).
 *
 * It launches your harness in a PTY and passes your terminal through 1:1, so the
 * session looks and behaves exactly the same. In the background it discovers this
 * project's agent (from `.hauddy/identity.toml`, written when the MCP provisions
 * on first tool call), subscribes to `GET /api/inject/:agentId`, and types each
 * injected line into the PTY as a live turn. That's what makes a plain terminal
 * *callable*: the ring — and the `validate_calls` code — actually land in the
 * session. Everything after the ring is ordinary tool calls (`pickup_call`, …).
 *
 * node-pty is loaded lazily so the rest of the CLI (daemon, mcp) never needs it.
 */
export async function runWrap(command: string, args: string[]): Promise<void> {
  // Patch this project's MCP URL so it carries the right ?id=<dir> identity.
  patchClaudeJsonMcpUrl();

  let spawn: typeof import("node-pty").spawn;
  try {
    ({ spawn } = await import("node-pty"));
  } catch {
    console.error(
      "hauddy wrap needs the `node-pty` package (a native module).\n" +
        "  npm install -g node-pty   # or add it to this project\n" +
        `then retry:  hauddy wrap ${command} ${args.join(" ")}`.trimEnd(),
    );
    process.exit(1);
    return;
  }

  const cols = process.stdout.columns || 80;
  const rows = process.stdout.rows || 30;
  // Mark the wrapped process (inherited by the MCP subprocess) so the tools can
  // tell the agent it's ALREADY wrapped — "just run validate_calls", not "relaunch".
  const childEnv = { ...process.env, HAUDDY_WRAP: "1" } as Record<string, string>;
  const spawnChild = (): IPty =>
    spawn(command, args, {
      name: process.env.TERM ?? "xterm-256color",
      cols,
      rows,
      cwd: process.cwd(),
      env: childEnv,
    });
  let child: IPty;
  try {
    child = spawnChild();
  } catch {
    // Most likely the spawn-helper exec-bit bug — fix it and retry once.
    fixSpawnHelper();
    try {
      child = spawnChild();
    } catch (err) {
      console.error(
        `hauddy wrap: could not start "${command}" in a PTY: ${err instanceof Error ? err.message : String(err)}\n` +
          "Ensure the command exists and node-pty is built for your platform.",
      );
      process.exit(1);
      return;
    }
  }

  // --- terminal passthrough: the wrapped session is indistinguishable ---
  let lastDataAt = Date.now();
  child.onData((d) => {
    lastDataAt = Date.now();
    process.stdout.write(d);
  });
  const isTTY = Boolean(process.stdin.isTTY);
  if (isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on("data", (d) => child.write(d.toString("utf8")));
  process.stdout.on("resize", () => child.resize(process.stdout.columns || cols, process.stdout.rows || rows));

  let alive = true;
  child.onExit(({ exitCode }) => {
    alive = false;
    if (isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        /* terminal already restored */
      }
    }
    process.exit(exitCode ?? 0);
  });

  // --- injection: subscribe to this agent's stream and type turns in ---
  void injectionLoop(child, () => alive);

  // --- auto-onboard: once the harness has settled, feed one prompt that drives
  // whoami → validate_calls → wake_ack, so a wrapped session becomes call-ready
  // hands-free. Opt out with HAUDDY_NO_ONBOARD=1.
  if (process.env.HAUDDY_NO_ONBOARD !== "1") {
    void onboard(child, () => lastDataAt, () => alive);
  }
}

const ONBOARDING_PROMPT =
  "Set up Hauddy calls before anything else: call the `whoami` tool, then call `validate_calls`. " +
  "Hauddy will type a line containing a validation code into this chat — when it appears, call `wake_ack` with that code. " +
  "Then tell me whether you're call-ready.";

/**
 * Wait for the wrapped harness to finish its startup render (output goes quiet),
 * then feed the onboarding prompt once. Falls back to a hard deadline so a
 * harness that never quiets still gets prompted.
 */
async function onboard(child: IPty, lastDataAt: () => number, alive: () => boolean): Promise<void> {
  const started = Date.now();
  const MIN_MS = 3000; // don't prompt before the UI is plausibly ready for input
  const QUIET_MS = 1000; // ready = no output for this long
  const MAX_MS = 9000; // ...but prompt by here regardless
  for (;;) {
    await delay(300);
    if (!alive()) return;
    const now = Date.now();
    if (now - started < MIN_MS) continue;
    if (now - lastDataAt() >= QUIET_MS || now - started >= MAX_MS) break;
  }
  submitLine(child, ONBOARDING_PROMPT);
}

/**
 * Deliver a line as a submitted turn. Type the text, then send Enter as a
 * SEPARATE, slightly-delayed keystroke — a trailing `\r` in the same burst gets
 * swallowed into the harness's paste handling and just sits in the composer.
 */
function submitLine(child: IPty, text: string): void {
  child.write(text);
  setTimeout(() => {
    try {
      child.write("\r");
    } catch {
      /* child exited between type and submit */
    }
  }, 120);
}

/** The app API URL the daemon published (the injection stream lives here). */
function localApiUrl(): string | null {
  try {
    const doc = JSON.parse(readFileSync(path.join(hauddyHome(), "daemon.json"), "utf8"));
    if (typeof doc.local_api_url === "string") return doc.local_api_url;
  } catch {
    /* daemon not running / no app API */
  }
  return null;
}

/** This project's agent id, once the MCP has provisioned it (else null).
 *  Checks both the stdio identity (project-local .hauddy/identity.toml) and
 *  the HTTP MCP identity (~/.hauddy/agents/<dir-slug>/identity.toml). */
function currentAgentId(): string | null {
  // HTTP MCP path checked first: patchClaudeJsonMcpUrl() always routes wrapped
  // Claude sessions through HTTP MCP, so this identity is the correct one to
  // subscribe to. Stdio identity is checked second as a fallback for stdio-only setups.
  const slug = slugifyNickname(path.basename(process.cwd()));
  if (slug) {
    const httpFile = path.join(hauddyHome(), "agents", slug, "identity.toml");
    try {
      const id = loadIdentity(httpFile).agent_id;
      if (id) return id;
    } catch {
      /* not provisioned yet */
    }
  }
  // stdio path: walk up from cwd
  const file = findIdentityFile();
  if (file) {
    try {
      const id = loadIdentity(file).agent_id;
      if (id) return id;
    } catch {
      /* fall through */
    }
  }
  return null;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function injectionLoop(child: IPty, alive: () => boolean): Promise<void> {
  const api = localApiUrl();
  if (!api) return; // no app API — the wrapper still works as a plain passthrough

  // Wait for provisioning to assign an agent id (first tool call in the session).
  // Poll briskly so the stream is subscribed before validate_calls fires.
  let agentId: string | null = null;
  while (alive() && !agentId) {
    agentId = currentAgentId();
    if (!agentId) await delay(300);
  }
  if (!agentId) return;

  while (alive()) {
    // Re-read on each reconnect: the agent ID can change if the daemon restarts.
    agentId = currentAgentId() ?? agentId;
    const url = `${api}/api/inject/${encodeURIComponent(agentId)}`;
    try {
      const res = await fetch(url, { headers: { accept: "text/event-stream" } });
      if (!res.ok || !res.body) {
        await delay(1000);
        continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (alive()) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let sep: number;
        while ((sep = buf.indexOf("\n\n")) >= 0) {
          inject(child, buf.slice(0, sep));
          buf = buf.slice(sep + 2);
        }
      }
    } catch {
      /* daemon restarted / stream dropped — reconnect below */
    }
    if (alive()) await delay(1000);
  }
}

/** Parse one SSE block; if it's an `inject` event, type its text into the PTY. */
function inject(child: IPty, block: string): void {
  let event: string | null = null;
  let data: string | null = null;
  for (const line of block.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data = line.slice(5).trim();
  }
  if (event !== "inject" || !data) return;
  let payload: Injection;
  try {
    payload = JSON.parse(data) as Injection;
  } catch {
    return;
  }
  if (typeof payload.text !== "string" || payload.text.length === 0) return;
  // Deliver as a turn: type the line, then submit it (Enter sent separately).
  submitLine(child, payload.text);
}
