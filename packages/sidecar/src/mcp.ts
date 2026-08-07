import crypto from "node:crypto";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { MAX_ATTACHMENTS_BYTES, type Attachment } from "@hauddy/protocol";
import { z } from "zod";
import { hauddyHome } from "./account.js";
import type { ActivityLog } from "./activity.js";
import type { HubConnection } from "./connection.js";
import { downloadFile, getPresence, listAgents, listContacts, setNickname, updateProfile, uploadFile } from "./hub-api.js";
import { CallValidation, callSetupGuide, wakeChannelFor } from "./wake.js";

/** Minimal extension→MIME guess for outbound attachments (best-effort; the hub
 *  treats the bytes as opaque, this is just a helpful content-type hint). */
const MIME_BY_EXT: Record<string, string> = {
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
  gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", zip: "application/zip",
  html: "text/html", js: "text/javascript", ts: "text/plain", wav: "audio/wav", mp3: "audio/mpeg",
};
function guessMime(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/** Read the given local paths, enforce the 10MB total budget, and upload each to
 *  this machine's local hub file store. Returns the attachment references to ride
 *  on the message. `to` is stored for the platform's download authorization. */
async function uploadAttachments(p: Provisioned, paths: string[], to: string): Promise<Attachment[]> {
  const out: Attachment[] = [];
  let total = 0;
  for (const fp of paths) {
    const st = statSync(fp); // throws a clear error if the path is missing
    total += st.size;
    if (total > MAX_ATTACHMENTS_BYTES) {
      throw new Error(`attachments exceed the ${MAX_ATTACHMENTS_BYTES}-byte (10MB) total budget`);
    }
    const bytes = readFileSync(fp);
    const name = path.basename(fp);
    const mime = guessMime(name);
    const up = await uploadFile(p.endpoint, bytes, { name, mime, owner: p.agentId, to });
    out.push({ file_id: up.file_id, name, mime, size: st.size });
  }
  return out;
}

/** Everything a tool needs once the session has been provisioned. */
export interface Provisioned {
  endpoint: string; // the local hub
  agentId: string;
  connection: HubConnection;
  activity?: ActivityLog;
  /** Persist a chosen nickname to the local identity file (survives restarts). */
  persistNickname?: (bare: string) => void;
  /**
   * Push an injection down this agent's daemon stream (the plain-terminal
   * wrapper path) and report how many wrappers received it. Used by the call
   * validation handshake so the coded ping reaches a PTY wrapper too, not only
   * the MCP wake notification. Absent ⇒ no daemon stream reachable.
   */
  publishInjection?: (event: { type: "ring" | "validate"; text: string; code?: string }) => Promise<number>;
}

/** Ensures the session is provisioned (identity + keypair + local-hub
 *  registration + connection) and returns its context. Lazy: runs on first use. */
export type Provision = () => Promise<Provisioned>;

function asText(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value, null, 2) }] };
}

/**
 * The Hauddy MCP surface (spec §9). Adding this one server to any harness is
 * the entire integration: the first tool call self-provisions the session as a
 * local agent (keypair identity, free local nickname) on the machine's local
 * hub, and it can immediately message other local agents. `set_nickname` /
 * `set_identity` let it name and describe itself. place_call is reserved.
 */
export function createMcpServer(provision: Provision, validation: CallValidation): McpServer {
  const server = new McpServer(
    { name: "hauddy", version: "0.1.0" },
    // Declare Claude Code's channel capability so it accepts wake injections
    // (spec § Waking sessions). Harmless to harnesses that ignore it.
    { capabilities: { experimental: { "claude/channel": {} } } },
  );

  const me = async (p: Provisioned) => (await listAgents(p.endpoint).catch(() => ({ agents: [] }))).agents.find((a) => a.agent_id === p.agentId) ?? null;

  server.registerTool(
    "whoami",
    {
      description:
        "Show this agent's identity, nickname, description, and the other local agents it can reach. Auto-provisions on first use — call this first.",
    },
    async () => {
      const p = await provision();
      const all = (await listAgents(p.endpoint).catch(() => ({ agents: [] }))).agents;
      const self = all.find((a) => a.agent_id === p.agentId) ?? null;
      const peers = all
        .filter((a) => a.agent_id !== p.agentId && a.nickname)
        .map((a) => ({ nickname: a.nickname, description: a.description, online: a.attached, can_call: a.can_receive_calls }));
      return asText({
        agent_id: p.agentId,
        local_id: self?.local_id ?? null,
        display_name: self?.display_name ?? null,
        description: self?.description ?? null,
        nickname: self?.nickname ?? null,
        online_locally: self?.attached ?? false,
        can_receive_calls: validation.callReady,
        local_peers: peers,
        // The channel Hauddy would use to *ring* you for an incoming call (sync).
        wake_channel: wakeChannelFor(server.server.getClientVersion()?.name),
        calls: validation.callReady
          ? "You can receive calls."
          : process.env.HAUDDY_WRAP === "1"
            ? "SMS works now. This session is ALREADY running under `hauddy wrap`, so your injection stream is live — just run `validate_calls` now, read the code it types in, and call `wake_ack { code }`. No need to relaunch."
            : "SMS works now. To receive CALLS (real-time), relaunch this session wrapped — `hauddy wrap <your command>` (e.g. `hauddy wrap claude`) — then run `validate_calls`. See `enable_calls` for the full guide.",
        next_steps: self?.nickname
          ? "You're on the local network. `send_sms to:@peer body:...` to message another local agent; `list_contacts` to see them."
          : "Pick a handle with set_nickname({ nickname }) — then other local agents can reach you by @nickname.",
      });
    },
  );

  server.registerTool(
    "set_nickname",
    {
      description: "Set or rename this agent's local @nickname (how other agents address it). Free locally; must be unique on this machine.",
      inputSchema: { nickname: z.string().describe("desired handle, e.g. 'nabu' (with or without @)") },
    },
    async ({ nickname }) => {
      const p = await provision();
      const outcome = await setNickname(p.endpoint, p.agentId, nickname);
      if (outcome.ok) {
        // Persist so re-provisioning on the next tool call keeps this handle,
        // and update the live connection's claim for reconnects.
        p.persistNickname?.(outcome.nickname.replace(/^@/, ""));
        p.connection.setVerifiedNickname(outcome.nickname);
        p.activity?.push("nickname", outcome.nickname);
      }
      return asText(
        outcome.ok
          ? { ok: true, nickname: outcome.nickname }
          : { ok: false, reason: outcome.reason, message: outcome.reason === "conflict" ? "That handle is taken on this machine — pick another." : "Invalid handle (2–24 chars: a–z 0–9 _ -)." },
      );
    },
  );

  server.registerTool(
    "set_identity",
    {
      description: "Declare or update this agent's description and display name (what it is / does).",
      inputSchema: {
        description: z.string().optional().describe("what this agent is and does"),
        display_name: z.string().optional().describe("human-facing name"),
      },
    },
    async ({ description, display_name }) => {
      const p = await provision();
      await updateProfile(p.endpoint, p.agentId, { description, display_name });
      p.activity?.push("identity", "profile updated");
      return asText({ ok: true, description, display_name });
    },
  );

  server.registerTool(
    "enable_calls",
    {
      description:
        "Get the guide to build call injection (real-time delivery) for THIS harness. Hauddy provides the guidelines; you build the injection; then run validate_calls. SMS needs none of this.",
    },
    async () => {
      await provision();
      // Already inside `hauddy wrap`? Then the injection path is live — don't send
      // the agent to relaunch; just have it verify.
      if (process.env.HAUDDY_WRAP === "1") {
        return asText({
          harness: server.server.getClientVersion()?.name ?? "your harness",
          status: "already_wrapped",
          goal: "Receive calls = let Hauddy inject the ring into this live session as a turn.",
          next: "This session is already running under `hauddy wrap`, so the wrapper is subscribed to your injection stream. Just run `validate_calls` now — a coded line is typed into this session; read the code and call `wake_ack { code }`. That flips you to callable.",
        });
      }
      return asText(callSetupGuide(server.server.getClientVersion()?.name));
    },
  );

  server.registerTool(
    "validate_calls",
    {
      description:
        "Run the call-readiness handshake after building your injection. Hauddy injects a coded validation message into this session; read the code and call wake_ack with it. Round-trips ⇒ you become callable.",
    },
    async () => {
      const p = await provision();
      const { code, text } = validation.begin(server);
      // Fan the SAME code down the daemon's per-agent stream, so a plain-terminal
      // PTY wrapper gets it too (the MCP notification only reaches handler-based
      // harnesses). Whichever channel lands, the agent returns the code.
      const wrappers = (await p.publishInjection?.({ type: "validate", text, code }).catch(() => 0)) ?? 0;
      const wrapped = process.env.HAUDDY_WRAP === "1";
      return asText({
        status: "validation_ping_injected",
        channels: { mcp_notification: true, wrapper_stream: wrappers },
        instruction:
          wrappers > 0
            ? "A coded Hauddy validation message was typed into this session by your wrapper (and sent via MCP notification). Read the code and call `wake_ack { code }`."
            : wrapped
              ? "You're running under `hauddy wrap` but its injection stream isn't connected yet — wait ~2s and call `validate_calls` again."
              : "A coded Hauddy validation message was injected via the MCP wake notification. If your harness surfaced it, call `wake_ack { code }`. (No PTY wrapper is subscribed — for the plain-terminal path, relaunch via `hauddy wrap <command>` first.)",
      });
    },
  );

  server.registerTool(
    "wake_ack",
    {
      description: "Return the code from a Hauddy validation message (or a call ring) to confirm injection works. Success ⇒ you become callable.",
      inputSchema: { code: z.string().describe("the code Hauddy injected") },
    },
    async ({ code }) => {
      const p = await provision();
      const ok = validation.ack(code);
      if (ok) p.connection.reportCallReady(true);
      return asText({
        ok,
        message: ok
          ? "Verified — Hauddy can inject into this session; you can now receive calls."
          : "Code didn't match (or expired) — run validate_calls again.",
      });
    },
  );

  server.registerTool(
    "list_contacts",
    {
      description:
        "List your contacts, with presence. If a contact book has been curated for you in the Hauddy app, this is exactly that book; otherwise it's every agent you can reach on this machine.",
    },
    async () => {
      const p = await provision();
      return asText(await listContacts(p.endpoint, p.agentId));
    },
  );

  server.registerTool(
    "presence",
    {
      description: "Get the presence of a contact (spec §5)",
      inputSchema: { agent_id: z.string().describe("the contact's agent id or '@nickname'") },
    },
    async ({ agent_id }) => {
      const p = await provision();
      return asText(await getPresence(p.endpoint, p.agentId, agent_id));
    },
  );

  server.registerTool(
    "send_sms",
    {
      description:
        "Send an async message to another agent; returns the delivery receipt. Optionally attach files (local paths, ≤10MB total) — the recipient fetches them with receive_file.",
      inputSchema: {
        to: z.string().describe("recipient — an agent id or '@nickname'"),
        body: z.string().describe("message text"),
        attachments: z
          .array(z.string())
          .optional()
          .describe("local file paths to attach (≤10MB total across all files)"),
      },
    },
    async ({ to, body, attachments }) => {
      const p = await provision();
      const atts = attachments?.length ? await uploadAttachments(p, attachments, to) : undefined;
      const receipt = await p.connection.sendSms(to, body, atts);
      p.activity?.push("sms", `→ ${to}: ${receipt.status}${atts?.length ? ` (+${atts.length} file)` : ""}`);
      return asText({ ...receipt, attachments: atts });
    },
  );

  server.registerTool(
    "check_messages",
    {
      description:
        "Return queued envelopes, then mark them read. A message with files has `payload.attachments` (each with a file_id) — call receive_file to download one.",
      inputSchema: {
        since: z.string().datetime().optional().describe("ISO-8601 timestamp; only return messages after it"),
      },
    },
    async ({ since }) => {
      const p = await provision();
      return asText(p.connection.checkMessages(since));
    },
  );

  server.registerTool(
    "receive_file",
    {
      description:
        "Download a file attached to a message you received (use the file_id from check_messages' payload.attachments) and save it locally. Returns the saved path.",
      inputSchema: {
        file_id: z.string().describe("the attachment's file_id from a received message"),
        save_dir: z
          .string()
          .optional()
          .describe("directory to save into (default ~/.hauddy/downloads)"),
      },
    },
    async ({ file_id, save_dir }) => {
      const p = await provision();
      const dl = await downloadFile(p.endpoint, file_id); // always the local hub — the daemon re-hosts remote files here
      const dir = save_dir ?? path.join(hauddyHome(), "downloads");
      mkdirSync(dir, { recursive: true });
      const dest = path.join(dir, dl.name);
      writeFileSync(dest, dl.bytes);
      p.activity?.push("file.recv", `${dl.name} (${dl.bytes.length}b)`);
      return asText({ ok: true, path: dest, name: dl.name, size: dl.bytes.length, mime: dl.mime });
    },
  );

  // Contacts are managed at the **profile level** now (spec §"friends"): the
  // human accepts profile↔profile friend requests in the Hauddy app; allow-all
  // then links every exposed agent of both accounts. Agents no longer negotiate
  // links themselves — these tools stay for compatibility but just point there.
  server.registerTool(
    "share_contact",
    {
      description: "(Deprecated) Contacts are managed at the profile level in the Hauddy app. Local agents are already mutually reachable; to reach a remote agent, its profile must be a friend of yours.",
      inputSchema: { agent_id: z.string().describe("the agent id or '@nickname'") },
    },
    async () => {
      await provision();
      return asText({
        ok: false,
        managed_at: "profile",
        message: "Contact links are set at the profile level in the Hauddy app (Friends). On this machine, local agents can already reach each other.",
      });
    },
  );

  server.registerTool(
    "respond_contact",
    {
      description: "(Deprecated) Friend requests are accepted at the profile level in the Hauddy app, not by agents.",
      inputSchema: {
        agent_id: z.string().describe("the requester's agent id or '@nickname'"),
        accept: z.boolean().describe("true to accept, false to decline"),
      },
    },
    async () => {
      await provision();
      return asText({
        ok: false,
        managed_at: "profile",
        message: "Friend requests are accepted in the Hauddy app (Friends → incoming requests), at the profile level.",
      });
    },
  );

  // ---- calls (synchronous, spec §Calls) ----------------------------------
  // Only the *ring* is injected into the callee (place_call → their session is
  // woken with "X is calling — pickup_call"). Once on the call, `say` holds the
  // line (blocks polling for the reply) so neither side needs re-waking, until
  // one `hangup`s. Distinct from SMS (async, non-interrupting).

  server.registerTool(
    "place_call",
    {
      description:
        "Call another agent in real time (synchronous). Rings them; when they answer you get their first words. Then `say` to talk, `hangup` to end. For a quick async note, use send_sms instead.",
      inputSchema: { to: z.string().describe("agent id or '@nickname' to call") },
    },
    async ({ to }) => {
      const p = await provision();
      const self = await me(p);
      const callId = `call_${crypto.randomBytes(5).toString("hex")}`;
      p.connection.activeCall = { id: callId, peer: to };
      p.connection.sendCall(to, { id: callId, kind: "invite" }, self?.nickname ?? p.agentId);
      // Wait for the callee's first words (they greet), or a decline/timeout.
      const frame = await p.connection.awaitCall(
        (f) => f.id === callId && (f.kind === "frame" || f.kind === "close"),
        3000,
        20,
      );
      if (!frame || frame.kind === "close") {
        p.connection.activeCall = null;
        return asText({ status: frame ? "declined" : "no_answer", message: frame ? `${to} declined` : `${to} didn't pick up` });
      }
      return asText({
        status: "connected",
        from: frame.from,
        they_said: frame.body,
        attachments: frame.attachments,
        next: "Reply with `say` (it waits for their next line), or `hangup` to end. Fetch any files with receive_file.",
      });
    },
  );

  server.registerTool(
    "pickup_call",
    { description: "Answer an incoming call (you were rung with 'X is calling'). Connects you; then use `say` to speak." },
    async () => {
      const p = await provision();
      const invite = p.connection.takeInvite();
      if (!invite) return asText({ status: "no_incoming_call", message: "Nobody is calling right now." });
      p.connection.activeCall = { id: invite.id, peer: invite.from };
      return asText({
        status: "connected",
        from: invite.body ?? invite.from,
        attachments: invite.attachments,
        next: "You're on the call — greet them with `say` (your first line reaches the caller). `say` then waits for their reply; `hangup` to end.",
      });
    },
  );

  server.registerTool(
    "say",
    {
      description:
        "Speak on the active call: sends your line (optionally with files), then holds the line waiting for the other party's reply (polls ~3s × 20). Returns their reply, or that they hung up.",
      inputSchema: {
        text: z.string().describe("what to say"),
        attachments: z
          .array(z.string())
          .optional()
          .describe("local file paths to send with this line (≤10MB total)"),
      },
    },
    async ({ text, attachments }) => {
      const p = await provision();
      const call = p.connection.activeCall;
      if (!call) return asText({ status: "no_active_call", message: "You're not on a call — place_call or pickup_call first." });
      const atts = attachments?.length ? await uploadAttachments(p, attachments, call.peer) : undefined;
      p.connection.sendCall(call.peer, { id: call.id, kind: "frame" }, text, atts);
      const reply = await p.connection.awaitCall(
        (f) => f.id === call.id && (f.kind === "frame" || f.kind === "close"),
        3000,
        20,
      );
      if (!reply) return asText({ status: "no_reply", message: "No reply in ~60s — say again, or hangup." });
      if (reply.kind === "close") {
        p.connection.activeCall = null;
        return asText({ status: "ended", message: "They hung up." });
      }
      return asText({ status: "reply", from: reply.from, they_said: reply.body, attachments: reply.attachments });
    },
  );

  server.registerTool(
    "hangup",
    { description: "End the active call." },
    async () => {
      const p = await provision();
      const call = p.connection.activeCall;
      if (!call) return asText({ status: "no_active_call" });
      p.connection.sendCall(call.peer, { id: call.id, kind: "close" });
      p.connection.activeCall = null;
      return asText({ status: "hung_up" });
    },
  );

  return server;
}
