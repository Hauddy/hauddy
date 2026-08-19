#!/usr/bin/env node
import { readFileSync } from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mintGrantScopeId, normalizeNickname, slugifyNickname } from "@hauddy/protocol";
import { ActivityLog } from "./activity.js";
import { hauddyHome } from "./account.js";
import { HubConnection, type CallFrame } from "./connection.js";
import { Daemon, DEFAULT_HUB_PORT } from "./daemon.js";
import { registerAgent, setNickname } from "./hub-api.js";
import { findIdentityFile, loadIdentity, resolveActiveIdentityFile, writeIdentity, type Identity } from "./identity.js";
import { loadOrCreateKeypair } from "./keys.js";
import { startLocalApi } from "./local-api.js";
import { createMcpServer, type Provisioned } from "./mcp.js";
import { upsertAgent } from "./registry.js";
import { CallValidation, emitWake } from "./wake.js";
import { runWrap } from "./wrap.js";

function option(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function die(message: string): never {
  console.error(message);
  process.exit(1);
}

/** The local hub the daemon published, or the default localhost port. */
function localHubUrl(): string {
  try {
    const doc = JSON.parse(readFileSync(path.join(hauddyHome(), "daemon.json"), "utf8"));
    if (typeof doc.hub_url === "string") return doc.hub_url;
  } catch {
    /* daemon not running yet — fall back to the default port */
  }
  return `ws://127.0.0.1:${DEFAULT_HUB_PORT}`;
}

/** The app API URL the daemon published (the injection stream lives here), or null. */
function localApiUrl(): string | null {
  try {
    const doc = JSON.parse(readFileSync(path.join(hauddyHome(), "daemon.json"), "utf8"));
    if (typeof doc.local_api_url === "string") return doc.local_api_url;
  } catch {
    /* daemon not running / no app API */
  }
  return null;
}

/** `hauddy daemon` — run the local hub + app API (spec §3.2). */
async function runDaemon(): Promise<void> {
  const daemon = new Daemon();
  await daemon.start();
  console.error(`[hauddy] app running  ${daemon.hubUrl}`);
  try {
    const local = await startLocalApi({ daemon });
    daemon.recordLocalApi(local.url); // publish it so the MCP can reach the injection stream
    console.error(`[hauddy] app API      ${local.url}`);
  } catch (err) {
    console.error(`[hauddy] app API unavailable (port in use?) — hub still running: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** `hauddy nickname <name>` — set/rename this session's local handle. */
async function nicknameCmd(args: string[]): Promise<void> {
  const raw = args.find((a) => !a.startsWith("--"));
  if (!raw) die("usage: hauddy nickname <name>");
  const file = resolveActiveIdentityFile();
  if (!file) die("no .hauddy/identity.toml here — run a tool in your harness first (the MCP provisions it)");
  const identity = loadIdentity(file);
  if (!identity.agent_id) die("this session isn't provisioned yet — call a tool in your harness first");
  const res = await setNickname(localHubUrl(), identity.agent_id, raw);
  if (res.ok) {
    writeIdentity(file, { ...identity, nickname: res.nickname.replace(/^@/, "") });
    console.log(`nickname: ${res.nickname}`);
  } else {
    die(res.reason === "conflict" ? `@${normalizeNickname(raw)} is taken on this machine — pick another` : `invalid nickname "${raw}"`);
  }
}

/**
 * `hauddy mcp|serve` — the self-provisioning MCP server. The first
 * tool call provisions this session as a **local agent** (keypair identity +
 * free local nickname) on the machine's local hub and connects, so it can
 * immediately message other local agents. Requires the daemon (local hub) to be
 * running — start the Hauddy app or `hauddy daemon`.
 */
async function serve(): Promise<void> {
  let provisioned: Provisioned | null = null;
  let inflight: Promise<Provisioned> | null = null;
  let server: McpServer; // the ring injector pushes wakes through it

  const provision = (): Promise<Provisioned> => {
    if (provisioned) return Promise.resolve(provisioned);
    if (inflight) return inflight;
    inflight = (async () => {
      const endpoint = localHubUrl();
      let file = findIdentityFile();
      let identity: Identity;
      if (file) {
        identity = loadIdentity(file);
      } else {
        identity = { grant_scope_id: mintGrantScopeId(), endpoint };
        file = path.join(process.cwd(), ".hauddy", "identity.toml");
      }
      identity.endpoint = endpoint;
      if (!identity.local_id) identity.local_id = path.basename(process.cwd());
      // Default to a free local nickname slugged from the folder name (so
      // "philip test" → @philip-test, reachable out of the box); rename anytime
      // with set_nickname.
      if (!identity.nickname) {
        const derived = slugifyNickname(identity.local_id);
        if (derived) identity.nickname = derived;
      }
      const keypair = loadOrCreateKeypair(identity.grant_scope_id);
      try {
        const res = await registerAgent(endpoint, {
          grant_scope_id: identity.grant_scope_id,
          public_key: keypair.publicKeyPem,
          local_id: identity.local_id,
          nickname: identity.nickname,
        });
        identity.agent_id = res.agent_id;
      } catch (err) {
        throw new Error(
          `local hub not reachable at ${endpoint} — start the Hauddy app or run \`hauddy daemon\` ` +
            `(${err instanceof Error ? err.message : String(err)})`,
        );
      }
      writeIdentity(file, identity);
      upsertAgent({ grant_scope_id: identity.grant_scope_id, local_id: identity.local_id!, identity_file: file });

      const connection = new HubConnection({
        endpoint,
        agentId: identity.agent_id!,
        grantScopeId: identity.grant_scope_id,
        privateKey: keypair.privateKey,
        nickname: identity.nickname,
      });
      connection.on("socket_error", () => {});
      // SMS is async and never wakes the session. The ONLY injection is the call
      // *ring*: an incoming call_invite wakes the callee once ("X is calling —
      // pickup_call"); the rest of the call is blocking tools (spec §Calls).
      connection.on("ring", (cf: CallFrame) => {
        emitWake(server, cf.body ?? cf.from, "is calling — answer with `pickup_call` (or ignore to let it go to SMS)");
      });
      connection.start();
      await new Promise<void>((resolve) => {
        if (connection.isReady()) return resolve();
        const timer = setTimeout(resolve, 4000);
        connection.once("ready", () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const localId = identity.local_id!;
      provisioned = {
        endpoint,
        agentId: identity.agent_id!,
        connection,
        activity: new ActivityLog(),
        persistNickname: (bare: string) => {
          identity.nickname = bare;
          writeIdentity(file!, identity);
        },
        // Push an injection down this agent's daemon stream (the wrapper path),
        // returning how many wrappers received it. Used by validate_calls.
        publishInjection: async (event) => {
          const api = localApiUrl();
          if (!api) return 0;
          try {
            const res = await fetch(`${api}/api/inject/${encodeURIComponent(identity.agent_id!)}`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(event),
            });
            const body = (await res.json().catch(() => ({}))) as { delivered?: unknown };
            return typeof body.delivered === "number" ? body.delivered : 0;
          } catch {
            return 0;
          }
        },
        // Contact book — delegate to daemon API (daemon manages books.json).
        // getBook returns null (no gate) in the stdio path: daemon is async so we
        // can't block synchronously, and the HTTP MCP path (recommended) has full
        // gating through daemon.books which is co-located.
        getBook: () => null,
        addContact: async (handle: string) => {
          const api = localApiUrl();
          if (!api) return { ok: false, error: "daemon not running — start hauddy daemon" };
          try {
            const res = await fetch(`${api}/api/mcp/contacts/add`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ localId, handle }),
            });
            return (await res.json()) as { ok: boolean; status?: string; message?: string; error?: string };
          } catch (err) {
            return { ok: false, error: err instanceof Error ? err.message : String(err) };
          }
        },
        removeContact: async (handle: string) => {
          const api = localApiUrl();
          if (!api) return { ok: false };
          try {
            const res = await fetch(`${api}/api/mcp/contacts/remove`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ localId, handle }),
            });
            return (await res.json()) as { ok: boolean };
          } catch {
            return { ok: false };
          }
        },
      };
      console.error(`[hauddy] local agent ${identity.local_id} → ${identity.agent_id} on ${endpoint}`);
      return provisioned;
    })();
    return inflight;
  };

  server = createMcpServer(provision, new CallValidation());
  await server.connect(new StdioServerTransport());
  console.error("[hauddy] MCP ready on stdio — provisions on first tool call");
}

const [command, ...rest] = process.argv.slice(2);
if (command === "daemon") {
  await runDaemon();
} else if (command === "nickname") {
  await nicknameCmd(rest);
} else if (command === "wrap") {
  const [wrapped, ...wrappedArgs] = rest;
  if (!wrapped) die("usage: hauddy wrap <command> [args…]   (e.g. hauddy wrap claude)");
  await runWrap(wrapped, wrappedArgs);
} else if (command === "serve" || command === "mcp" || command === undefined) {
  await serve();
} else {
  console.error(`unknown command: ${command}\nusage: hauddy <daemon | mcp | wrap <command> | nickname <name>>`);
  process.exit(1);
}
