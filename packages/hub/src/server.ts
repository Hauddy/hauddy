import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import {
  controlFrameSchema,
  formatNickname,
  isReservedMessageType,
  mintMessageId,
  normalizeNickname,
  nowIso,
  PROTOCOL_VERSION,
  slugifyNickname,
  type Attachment,
  type Envelope,
  type ErrorCode,
  type NicknameStatus,
  type Presence,
} from "@hauddy/protocol";
import { FileStore } from "./files.js";
import { HubHistory } from "./history.js";
import { HubStore } from "./store.js";

export interface HubOptions {
  port?: number;
  host?: string;
  dataDir?: string;
  /**
   * Local-hub mode: every agent is auto-linked to every other (one owner, no
   * consent friction) and nicknames need no account. Used by the per-machine
   * daemon so same-machine agents message each other with zero setup. The
   * central hub runs with this off (consent + accounts enforced).
   */
  autoLink?: boolean;
  /**
   * Observe every routed sms envelope (payload opaque to the hub). The embedded
   * per-machine daemon uses this to spot a call *invite* and publish the ring on
   * its per-agent injection stream — the delivery pipe a plain-terminal wrapper
   * subscribes to. The hub stays a dumb router: it hands the whole envelope over
   * without interpreting the payload.
   */
  onDeliver?: (toAgentId: string, envelope: Envelope) => void;
  /**
   * Gateway hook (local hub only): a `send` targeting a **remote** agent — one
   * mirrored into the remote directory via {@link HubHandle.setRemotes}, not a
   * local runtime — is handed here instead of delivered locally. The daemon
   * forwards it up the sender's upstream bridge connection to the platform.
   * `fromAgentId` is the local sender; `envelope.to` is the global `@nickname`.
   */
  forwardRemote?: (fromAgentId: string, envelope: Envelope) => void;
  /**
   * Per-agent contact-book override (local hub only). The app curates a book for
   * each agent; when it returns a non-empty list of bare handles, that agent's
   * contacts are *exactly* those (resolved locally or via the gateway) instead
   * of auto-discovery. Return `null`/empty to keep the default (every agent on
   * the machine) — so zero-config local discovery is unchanged until the human
   * curates a book. Affects what `list_contacts` and the connect-time presence
   * snapshot show; it does not gate sends (autoLink still lets you message by
   * handle).
   */
  bookOf?: (agentId: string) => string[] | null;
  /**
   * Private-alpha invite gate (platform tier only). Path to a newline-delimited
   * file of allowed emails; when the file exists, `POST /accounts` refuses any
   * email not listed (case-insensitive; blank lines and `#` comments ignored).
   * Absent ⇒ signup is open (local/dev). Re-read on each signup, so the list can
   * be edited on the server with no restart. Defaults to `<dataDir>/allowlist.txt`.
   */
  allowlistFile?: string;
  /**
   * Enable the built-in per-IP rate limiter on the signup + password endpoints
   * (brute-force guard). Off by default so programmatic/test callers are
   * unthrottled; the standalone server turns it on. Behind a proxy the client IP
   * is read from `cf-connecting-ip` / `x-forwarded-for`.
   */
  rateLimit?: boolean;
  /**
   * `Access-Control-Allow-Origin` for the HTTP control API. Defaults to `*`
   * (dev-permissive); a production deployment pins it to the dashboard origin
   * (e.g. `https://app.hauddy.com`).
   */
  allowOrigin?: string;
}

/**
 * A friend agent that lives on the platform, mirrored into the local hub so its
 * `@nickname` resolves and shows up as a contact — the local hub acting as a
 * gateway. Populated by the daemon from each bridge's presence view; kept in
 * memory only (refreshes from the platform, never persisted).
 */
export interface RemoteAgent {
  agent_id: string;
  nickname: string; // '@handle'
  online: boolean;
  callReady: boolean;
  description?: string | null;
}

export interface HubHandle {
  port: number;
  wsUrl: string;
  httpUrl: string;
  store: HubStore;
  /** Persistent message/call history (browsable threads + call log; sync store). */
  history: HubHistory;
  /** Temp store for message attachments (out-of-band from the WS). */
  files: FileStore;
  /** Replace the remote-agent directory (gateway mode — local hub only). */
  setRemotes(list: RemoteAgent[]): void;
  /**
   * Deliver an envelope that arrived from the platform to a local agent, exactly
   * as if it had been sent locally: to the agent's live session if attached, else
   * its durable inbox. Fires `onDeliver` too, so an inbound call *invite* rings.
   */
  injectInbound(localAgentId: string, envelope: Envelope): void;
  close(): Promise<void>;
}

interface ClientState {
  agentId: string | null;
  accountId: string | null;
  pendingAgentId: string | null;
  nonce: string | null;
  /** Optional nickname carried in auth_hello (bound on connect). */
  pendingNickname: string | null;
  nickname: string | null;
  nicknameStatus: NicknameStatus | null;
  /** Whether this session verified it can be rung for a call (spec §Calls). */
  callReady: boolean;
  /** Per-socket identity for claim/session labels (spec §2.3). */
  sessionId: string;
  connectedAt: number;
  /** Liveness for the WS heartbeat: set false before each ping, true on pong. */
  isAlive: boolean;
}

interface ClaimLogEntry {
  scope: string; // accountId, or "local"
  text: string;
}

function clock(ms: number): string {
  const d = new Date(ms);
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h < 12 ? "am" : "pm";
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, "0")}${ap}`;
}

/**
 * The Hauddy hub (spec §3.1). ONE implementation runs in two roles: embedded
 * in the per-machine daemon as the **local hub** (autoLink, no accounts →
 * zero-config local a2a), and deployed centrally as the **global hub**
 * (accounts + consent + globally-unique nicknames). A dumb router: it asserts
 * envelope headers, never inspects payloads.
 *
 * HTTP control API (same port as the WebSocket). Local-hub routes need no auth;
 * account routes use `authorization: Bearer <api_key>`:
 *   POST /register            { grant_scope_id, public_key, nickname?, local_id?, ... } → { agent_id, nickname? }
 *   GET  /agents                                                → { agents: [...] }  (all agents on this hub)
 *   POST /agents/:id/nickname { nickname }                      → bind/rename outcome
 *   POST /agents/:id/profile  { display_name?, description? }   → { ok }
 *   GET  /claims                                                → { claims, log }
 *   POST /claims/release      { nickname }                      → { ok }
 *   POST /contacts/share|respond, GET /contacts/:id, GET /presence/:id
 *   POST /accounts, /accounts/rotate, /accounts/revoke, GET /accounts/me (global tier)
 *
 * Agent references accept an agent_id or '@nickname' (resolved via the registry).
 */
export async function startHub(options: HubOptions = {}): Promise<HubHandle> {
  const store = new HubStore(options.dataDir ?? "data");
  const history = new HubHistory(options.dataDir ?? "data");
  const files = new FileStore({ dir: path.join(options.dataDir ?? "data", "files") });
  const autoLink = options.autoLink ?? false;
  const allowlistFile = options.allowlistFile ?? path.join(options.dataDir ?? "data", "allowlist.txt");
  const allowOrigin = options.allowOrigin ?? "*";

  /** Invite gate (platform tier). `null` ⇒ no allowlist file ⇒ open signup;
   *  otherwise the set of allowed emails. Read fresh so the file can be edited
   *  live on the server. */
  function invitedEmails(): Set<string> | null {
    try {
      const lines = readFileSync(allowlistFile, "utf8").split("\n");
      const emails = lines.map((l) => l.trim().toLowerCase()).filter((l) => l && !l.startsWith("#"));
      return new Set(emails);
    } catch {
      return null; // no file ⇒ signup is open (local/dev)
    }
  }

  /** Naive in-memory fixed-window limiter, keyed per client IP + bucket. Alpha-
   *  grade — enough to blunt brute force on the signup/password endpoints. */
  const rateBuckets = new Map<string, { count: number; resetAt: number }>();
  function rateLimited(req: http.IncomingMessage, bucket: string, limit: number, windowMs: number): boolean {
    if (!options.rateLimit) return false;
    const ip =
      (typeof req.headers["cf-connecting-ip"] === "string" && req.headers["cf-connecting-ip"]) ||
      String(req.headers["x-forwarded-for"] ?? "").split(",")[0]?.trim() ||
      req.socket.remoteAddress ||
      "unknown";
    const key = `${bucket}:${ip}`;
    const now = Date.now();
    const entry = rateBuckets.get(key);
    if (!entry || entry.resetAt < now) {
      rateBuckets.set(key, { count: 1, resetAt: now + windowMs });
      return false;
    }
    entry.count += 1;
    return entry.count > limit;
  }

  const online = new Map<string, Set<WebSocket>>();
  const clients = new Map<WebSocket, ClientState>();
  const unacked = new Map<string, Map<string, Envelope>>();
  /** bare nickname → the socket currently owning its inbound (spec §2.3). */
  const claims = new Map<string, WebSocket>();
  const claimLog: ClaimLogEntry[] = [];
  /** Gateway directory (local hub): platform agent_id → friend agent, and its
   *  bare nickname → id index. In memory only; the daemon refreshes it. */
  const remotes = new Map<string, RemoteAgent>();
  const remoteByNick = new Map<string, string>();
  /** Human console (spec §"human messaging"): a virtual client. A human agent is
   *  driven over HTTP, not a WS session — `deliverTo` buffers its envelopes here
   *  (SMS + call frames) for the console to poll. Presence counts it as online. */
  const consoles = new Map<string, Envelope[]>();
  /** The human's active call, per human agent id. */
  const consoleCall = new Map<string, { id: string; peer: string }>();
  /** Missed-call "seen" cursor (ms) per human — bumped when the bell is opened,
   *  clears the missed-call badge. In-memory (resets on restart; fine for a badge). */
  const notifSeen = new Map<string, number>();

  function setRemotes(list: RemoteAgent[]): void {
    remotes.clear();
    remoteByNick.clear();
    for (const r of list) {
      remotes.set(r.agent_id, r);
      const bare = normalizeNickname(r.nickname);
      if (bare) remoteByNick.set(bare, r.agent_id);
    }
  }

  /** Resolve a reference to a *remote* (platform) agent id, or null. */
  function resolveRemote(ref: string): string | null {
    if (remotes.has(ref)) return ref;
    const bare = normalizeNickname(ref);
    return bare ? remoteByNick.get(bare) ?? null : null;
  }

  function remotePresence(r: RemoteAgent): Presence {
    return {
      agent_id: r.agent_id,
      state: r.online ? "online" : "offline",
      capabilities: r.callReady ? ["sms", "call"] : ["sms"],
      attached_instances: r.online ? 1 : 0,
      nickname: r.nickname,
    };
  }

  function logClaim(scope: string, text: string): void {
    claimLog.unshift({ scope, text });
    if (claimLog.length > 100) claimLog.pop();
  }

  function sessionLabel(ws: WebSocket): string {
    const c = clients.get(ws);
    if (!c) return "session ????";
    return `session ${c.sessionId} · started ${clock(c.connectedAt)}`;
  }

  /** Contacts of an agent. If the app has curated a book for it, that book *is*
   *  its contacts (resolved locally or via the gateway). Otherwise: everyone
   *  else in autoLink mode; on the platform, its own account + friends (allow-
   *  all) + legacy links; plus remote friend agents (gateway directory). */
  function contactsOf(agentId: string): string[] {
    const book = options.bookOf?.(agentId);
    if (book && book.length > 0) {
      const ids = new Set<string>();
      for (const handle of book) {
        const id = store.resolveAgentId(handle) ?? resolveRemote(handle);
        if (id && id !== agentId) ids.add(id);
      }
      return [...ids];
    }
    let local: string[];
    if (autoLink) {
      local = store.listAllAgents().map((a) => a.agent_id).filter((id) => id !== agentId);
    } else {
      const acc = store.getAgent(agentId)?.account_id ?? null;
      if (!acc) {
        local = store.linkedContacts(agentId); // accountless (legacy) agent
      } else {
        const accounts = new Set([acc, ...store.friendAccountsOf(acc)]);
        local = store
          .listAllAgents()
          .filter((a) => a.agent_id !== agentId && a.account_id != null && accounts.has(a.account_id))
          .map((a) => a.agent_id);
        for (const id of store.linkedContacts(agentId)) if (!local.includes(id)) local.push(id);
      }
    }
    return remotes.size > 0 ? [...local, ...remotes.keys()] : local;
  }

  /** May `a` message `b`? autoLink: always. Platform: same account, linked
   *  accounts (friendship), or a legacy agent-pair link (back-compat). */
  function areLinked(a: string, b: string): boolean {
    if (autoLink) return a !== b;
    if (a === b) return true;
    const accA = store.getAgent(a)?.account_id ?? null;
    const accB = store.getAgent(b)?.account_id ?? null;
    if (accA && accB && (accA === accB || store.areAccountsLinked(accA, accB))) return true;
    return store.getContact(a, b).state === "linked";
  }

  function speakingNickname(agentId: string): string | null {
    const linked = store.nicknamesOf(agentId);
    if (linked.length === 0) return null;
    const agent = store.getAgent(agentId);
    const bare = agent?.speaking_as && linked.includes(agent.speaking_as) ? agent.speaking_as : linked[0];
    return formatNickname(bare!);
  }

  /** True if any live socket of this agent verified it can be rung for a call. */
  function callReadyOf(agentId: string): boolean {
    const sockets = online.get(agentId);
    if (!sockets) return false;
    for (const ws of sockets) if (clients.get(ws)?.callReady) return true;
    return false;
  }

  function presenceOf(agentId: string): Presence {
    const remote = remotes.get(agentId);
    if (remote) return remotePresence(remote);
    // A console-attached human counts as one attached instance, call-capable
    // (it holds the line by polling), even though it has no WS session.
    const consoleAttached = consoles.has(agentId);
    const attached = (online.get(agentId)?.size ?? 0) + (consoleAttached ? 1 : 0);
    const nickname = speakingNickname(agentId);
    return {
      agent_id: agentId,
      state: attached > 0 && nickname !== null ? "online" : "offline",
      // "call" appears only once a session verified it can be rung (spec §Calls);
      // SMS is always available. Presence stays online for reachable agents.
      capabilities: callReadyOf(agentId) || consoleAttached ? ["sms", "call"] : ["sms"],
      attached_instances: attached,
      nickname,
    };
  }

  function sendFrame(ws: WebSocket, frame: unknown): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(frame));
  }

  function sendError(ws: WebSocket, code: ErrorCode, message: string, ref?: string): void {
    sendFrame(ws, { type: "error", code, message, ...(ref !== undefined ? { ref } : {}) });
  }

  function autoClaim(agentId: string, ws: WebSocket): void {
    for (const name of store.nicknamesOf(agentId)) {
      const owner = claims.get(name);
      if (!owner || owner.readyState !== WebSocket.OPEN) claims.set(name, ws);
    }
  }

  /** Record an SMS or call envelope into the browsable history log — the local
   *  counterpart of the platform's persistCall + insertMessage (hub-do.ts). SMS →
   *  messages; call invite/frame/close → calls/call_frames. Idempotent by id, so
   *  the reconnect-redelivery path (inboxTakeAll → deliverTo) never double-writes. */
  function persistHistory(envelope: Envelope, toAgentId: string): void {
    const payload = envelope.payload as { call?: { id: string; kind: string }; body?: unknown; attachments?: unknown };
    const call = payload.call;
    if (!call) {
      history.insertMessage(envelope, { fromNick: speakingNickname(envelope.from), toNick: speakingNickname(toAgentId) });
      return;
    }
    const parsed = Date.parse(envelope.ts);
    const nowMs = Number.isFinite(parsed) ? parsed : Date.now();
    const body = typeof payload.body === "string" ? payload.body : null;
    const attachments = Array.isArray(payload.attachments) && payload.attachments.length ? (payload.attachments as Attachment[]) : null;
    switch (call.kind) {
      case "invite":
        history.upsertCallInvite({
          call_id: call.id,
          caller: envelope.from,
          callee: toAgentId,
          caller_nick: speakingNickname(envelope.from),
          callee_nick: speakingNickname(toAgentId),
          started_ms: nowMs,
        });
        return;
      case "accept":
        history.markCallAnswered(call.id, nowMs);
        return;
      case "frame":
        history.insertCallFrame({ frame_id: envelope.id, call_id: call.id, from_agent: envelope.from, body, attachments, created_ms: nowMs });
        // First spoken frame implies the call was answered (pickup sends no accept).
        if (history.getCall(call.id)?.answered_ms == null) history.markCallAnswered(call.id, nowMs);
        return;
      case "close":
        history.closeCall(call.id, nowMs, "hangup");
        return;
    }
  }

  function deliverTo(agentId: string, envelope: Envelope, bareNickname?: string): boolean {
    persistHistory(envelope, agentId);
    let delivered = false;
    // Human console (virtual client): buffer for the HTTP poller.
    const buffer = consoles.get(agentId);
    if (buffer) {
      buffer.push(envelope);
      delivered = true;
    }
    const sockets = online.get(agentId);
    if (sockets && sockets.size > 0) {
      let targets = [...sockets];
      if (bareNickname) {
        const owner = claims.get(bareNickname);
        if (owner && sockets.has(owner) && owner.readyState === WebSocket.OPEN) targets = [owner];
      }
      let pending = unacked.get(agentId);
      if (!pending) {
        pending = new Map();
        unacked.set(agentId, pending);
      }
      pending.set(envelope.id, envelope);
      for (const ws of targets) sendFrame(ws, { type: "deliver", envelope });
      delivered = true;
    }
    return delivered;
  }

  function mkEnvelope(from: string, to: string, payload: Record<string, unknown>): Envelope {
    return { v: PROTOCOL_VERSION, id: mintMessageId(), type: "sms", from, to, ts: nowIso(), payload, sig: null };
  }

  type RouteResult = { ok: true; status: "delivered" | "queued" } | { ok: false; code: ErrorCode; message: string };

  /** Tag an envelope's (opaque) payload with the owner-identity marker when the
   *  sender is a human — so the recipient agent perceives its owner, not a bare
   *  handle, via `payload.from_kind`/`from_description` in check_messages. No-op
   *  for agent→agent sends; backward-compatible (the protocol leaves payload
   *  opaque). The human's `description` is mirrored from the platform bio by the
   *  daemon; empty ⇒ the default "your human owner". */
  function withOwnerTag(
    envelope: Envelope,
    sender: { kind?: string; description?: string } | undefined,
  ): Envelope {
    if (sender?.kind !== "human") return envelope;
    return {
      ...envelope,
      payload: {
        ...envelope.payload,
        from_kind: "human",
        from_description: sender.description || "your human owner",
      },
    };
  }

  /** The single send path, shared by WS `send` and the human console: resolve the
   *  target (local or remote-gateway), enforce consent, then deliver / forward /
   *  queue. `envelope.from` is trusted here (callers assert it). */
  function routeFromAgent(fromAgentId: string, envelope: Envelope): RouteResult {
    const toRef = envelope.to;
    const toId = store.resolveAgentId(toRef);
    if (!toId) {
      if (resolveRemote(toRef) && options.forwardRemote) {
        options.forwardRemote(fromAgentId, { ...envelope, from: fromAgentId });
        return { ok: true, status: "queued" };
      }
      return { ok: false, code: "E_UNKNOWN_AGENT", message: `unknown agent ${toRef}` };
    }
    if (!areLinked(fromAgentId, toId)) return { ok: false, code: "E_NOT_LINKED", message: `not linked to ${toRef}` };
    const toBare = normalizeNickname(toRef);
    const asserted: Envelope = { ...envelope, from: fromAgentId, to: toId };
    // When the human owner messages one of its own agents, tag the (opaque)
    // payload so the recipient perceives the sender as its owner, not a bare
    // handle — the agent's check_messages then reads from_kind:"human".
    const enriched = withOwnerTag(asserted, store.getAgent(fromAgentId));
    const bareForClaim = toBare && store.bindingOf(toBare)?.agent_id === toId ? toBare : undefined;
    const delivered = deliverTo(toId, enriched, bareForClaim);
    if (!delivered) store.inboxAppend(toId, enriched);
    options.onDeliver?.(toId, enriched);
    return { ok: true, status: delivered ? "delivered" : "queued" };
  }

  /** Deliver a platform-originated envelope to a local agent (gateway inbound):
   *  live session if attached, else durable inbox; fires onDeliver so an inbound
   *  call invite rings. Mirrors the local `send` delivery, minus consent/assert. */
  function injectInbound(localAgentId: string, envelope: Envelope): void {
    const bare = normalizeNickname(envelope.to);
    const bareForClaim = bare && store.bindingOf(bare)?.agent_id === localAgentId ? bare : undefined;
    const delivered = deliverTo(localAgentId, envelope, bareForClaim);
    if (!delivered) store.inboxAppend(localAgentId, envelope);
    options.onDeliver?.(localAgentId, envelope);
  }

  function handleFrame(ws: WebSocket, raw: unknown): void {
    const client = clients.get(ws);
    if (!client) return;
    const parsed = controlFrameSchema.safeParse(raw);
    if (!parsed.success) {
      sendError(ws, "E_UNSUPPORTED", "unknown or malformed frame");
      return;
    }
    const frame = parsed.data;

    switch (frame.type) {
      case "auth_hello": {
        const agent = store.getAgent(frame.agent_id);
        if (!agent) {
          sendError(ws, "E_UNKNOWN_AGENT", `unknown agent_id ${frame.agent_id}`);
          ws.close();
          return;
        }
        client.pendingAgentId = frame.agent_id;
        client.pendingNickname = frame.nickname ?? null;
        client.nonce = crypto.randomBytes(32).toString("base64url");
        sendFrame(ws, { type: "auth_challenge", nonce: client.nonce });
        return;
      }

      case "auth_response": {
        const agent = client.pendingAgentId ? store.getAgent(client.pendingAgentId) : undefined;
        if (!agent || !client.nonce) {
          sendError(ws, "E_AUTH_FAILED", "no authentication in progress");
          ws.close();
          return;
        }
        let verified = false;
        try {
          verified = crypto.verify(
            null,
            Buffer.from(client.nonce, "base64url"),
            crypto.createPublicKey(agent.public_key),
            Buffer.from(frame.signature, "base64url"),
          );
        } catch {
          verified = false;
        }
        client.nonce = null;
        client.pendingAgentId = null;
        if (!verified) {
          sendError(ws, "E_AUTH_FAILED", "signature verification failed");
          ws.close();
          return;
        }
        client.agentId = agent.agent_id;
        client.accountId = agent.account_id ?? null;
        let sockets = online.get(agent.agent_id);
        if (!sockets) {
          sockets = new Set();
          online.set(agent.agent_id, sockets);
        }
        sockets.add(ws);

        // Optional auth_hello nickname: bind it (unique within this hub). Taken
        // by another agent ⇒ conflict; the agent keeps whatever it already had.
        let claimFailed = false;
        let attempted: string | null = null;
        if (client.pendingNickname) {
          const name = normalizeNickname(client.pendingNickname);
          if (name) {
            attempted = formatNickname(name);
            claimFailed = !store.bindNickname(agent.agent_id, name).ok;
          }
        }
        client.pendingNickname = null;

        const linkedNames = store.nicknamesOf(agent.agent_id);
        client.nicknameStatus = linkedNames.length > 0 ? "verified" : claimFailed ? "conflict" : "none";
        client.nickname =
          linkedNames.length > 0 ? speakingNickname(agent.agent_id) : claimFailed ? attempted : null;
        autoClaim(agent.agent_id, ws);

        sendFrame(ws, {
          type: "auth_ok",
          presence: contactsOf(agent.agent_id).map(presenceOf),
          nickname: client.nickname,
          nickname_status: client.nicknameStatus,
        });
        for (const envelope of store.inboxTakeAll(agent.agent_id)) {
          if (!deliverTo(agent.agent_id, envelope)) store.inboxAppend(agent.agent_id, envelope);
        }
        return;
      }

      case "send": {
        if (!client.agentId) {
          sendError(ws, "E_AUTH_FAILED", "not authenticated");
          return;
        }
        const envelope = frame.envelope;
        if (isReservedMessageType(envelope.type)) {
          sendError(ws, "E_UNSUPPORTED", `message type ${envelope.type} is reserved in v0.1`, envelope.id);
          return;
        }
        if (envelope.type !== "sms") {
          sendError(ws, "E_UNSUPPORTED", `clients may not send ${envelope.type}`, envelope.id);
          return;
        }
        if (envelope.from !== client.agentId) {
          sendError(ws, "E_IDENTITY_MISMATCH", "envelope.from does not match the authenticated agent", envelope.id);
          return;
        }
        // One send path for WS + console (resolve/consent/deliver/forward/queue).
        const routed = routeFromAgent(client.agentId, envelope);
        if (!routed.ok) {
          sendError(ws, routed.code, routed.message, envelope.id);
          return;
        }
        sendFrame(ws, { type: "receipt", id: envelope.id, status: routed.status });
        return;
      }

      case "ack": {
        if (client.agentId) {
          unacked.get(client.agentId)?.delete(frame.id);
          history.markDelivered(frame.id, client.agentId); // ✓✓ delivered tick
        }
        return;
      }

      case "claim": {
        if (!client.agentId) {
          sendError(ws, "E_AUTH_FAILED", "not authenticated");
          return;
        }
        const name = normalizeNickname(frame.nickname);
        if (!name || store.bindingOf(name)?.agent_id !== client.agentId) {
          sendError(ws, "E_UNKNOWN_AGENT", `nickname ${frame.nickname} is not linked to you`);
          return;
        }
        claims.set(name, ws);
        logClaim(client.accountId ?? "local", `${clock(Date.now())} — ${sessionLabel(ws)} claimed ${formatNickname(name)}`);
        return;
      }

      case "release": {
        if (!client.agentId) return;
        const name = normalizeNickname(frame.nickname);
        if (name && claims.get(name) === ws) {
          claims.delete(name);
          logClaim(client.accountId ?? "local", `${clock(Date.now())} — ${formatNickname(name)} released`);
        }
        return;
      }

      case "capability": {
        if (client.agentId) client.callReady = frame.call;
        return;
      }

      default:
        sendError(ws, "E_UNSUPPORTED", `unexpected frame type ${frame.type}`);
    }
  }

  function handleClose(ws: WebSocket): void {
    const client = clients.get(ws);
    clients.delete(ws);
    for (const [name, owner] of claims) if (owner === ws) claims.delete(name);
    if (!client?.agentId) return;
    const sockets = online.get(client.agentId);
    sockets?.delete(ws);
    if (!sockets || sockets.size === 0) {
      online.delete(client.agentId);
      const pending = unacked.get(client.agentId);
      if (pending && pending.size > 0) store.inboxPrepend(client.agentId, [...pending.values()]);
      unacked.delete(client.agentId);
    }
  }

  // --- HTTP control API --------------------------------------------------

  async function readBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
    // JSON control bodies are tiny; cap to stop a memory-exhaustion DoS. (Large
    // uploads go through readRawBody on /files, which has its own byte cap.)
    const MAX = 1024 * 1024;
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX) over = true;
      if (!over) chunks.push(chunk as Buffer);
    }
    if (over) throw new Error("request body too large");
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /** Read a request's raw bytes, returning null if it exceeds `max`. Drains the
   *  rest of the stream on overflow (rather than destroying the socket) so the
   *  handler can still send a clean 413 response. */
  async function readRawBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > max) over = true;
      if (!over) chunks.push(chunk as Buffer);
    }
    return over ? null : Buffer.concat(chunks);
  }

  /** Platform download authorization: the requester's account must own the file
   *  (sender) or the file's recipient (its `to` resolves to one of their agents). */
  function fileAccessible(meta: { account_id: string | null; to: string | null }, accountId: string): boolean {
    if (meta.account_id && meta.account_id === accountId) return true;
    if (meta.to) {
      const toId = store.resolveAgentId(meta.to) ?? (store.getAgent(meta.to) ? meta.to : null);
      const acct = toId ? store.getAgent(toId)?.account_id ?? null : null;
      if (acct && acct === accountId) return true;
    }
    return false;
  }

  function requireAccount(req: http.IncomingMessage): string | null {
    const header = req.headers["authorization"];
    const key = typeof header === "string" && header.startsWith("Bearer ") ? header.slice(7) : "";
    return key ? store.authenticateAccount(key) : null;
  }

  /** Resolve (and console-attach) the human this request operates: the account's
   *  human on the platform (Bearer), or the machine's single human on the local
   *  hub (no auth; `?as=<humanId>` to disambiguate). Auto-creates on the platform. */
  function consoleHuman(req: http.IncomingMessage, url: URL): { agent_id: string } | null {
    const accountId = requireAccount(req);
    let human: { agent_id: string } | null = null;
    if (accountId) {
      const email = store.getAccount(accountId)?.email ?? "";
      human = store.ensureHumanAgent(accountId, slugifyNickname(email.split("@")[0] ?? "") ?? undefined);
    } else {
      const as = url.searchParams.get("as");
      if (as) {
        const a = store.getAgent(as);
        human = a?.kind === "human" ? a : null;
      } else {
        const humans = store.listAllAgents().filter((a) => a.kind === "human");
        human = humans.length === 1 ? humans[0]! : null;
      }
    }
    if (human) consoles.set(human.agent_id, consoles.get(human.agent_id) ?? []);
    return human;
  }

  function agentView(agentId: string) {
    const agent = store.getAgent(agentId)!;
    return {
      agent_id: agentId,
      local_id: agent.local_id ?? null,
      grant_scope_id: agent.grant_scope_id,
      account_id: agent.account_id ?? null,
      display_name: agent.display_name ?? null,
      description: agent.description ?? null,
      public_key: agent.public_key,
      nickname: speakingNickname(agentId),
      nicknames: store.nicknamesOf(agentId).map(formatNickname),
      speaking_as: speakingNickname(agentId),
      kind: agent.kind ?? "agent",
      attached: (online.get(agentId)?.size ?? 0) > 0 || consoles.has(agentId),
      can_receive_calls: callReadyOf(agentId) || consoles.has(agentId),
    };
  }

  function claimsView(scope?: string) {
    const rows: Array<{ nickname: string; claimedBy: string | null }> = [];
    for (const agent of store.listAllAgents()) {
      if (scope && (agent.account_id ?? "local") !== scope) continue;
      for (const bare of store.nicknamesOf(agent.agent_id)) {
        const owner = claims.get(bare);
        rows.push({
          nickname: formatNickname(bare),
          claimedBy: owner && owner.readyState === WebSocket.OPEN ? sessionLabel(owner) : null,
        });
      }
    }
    const log = claimLog.filter((l) => !scope || l.scope === scope).map((l) => ({ text: l.text }));
    return { claims: rows, log };
  }

  async function handleHttp(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // CORS: the platform's web dashboard runs on a different origin (e.g.
    // :5173 → :8790) and calls this control API from the browser. Dev-permissive
    // `*`; a production deployment would pin the origin.
    const cors = {
      "access-control-allow-origin": allowOrigin,
      "access-control-allow-methods": "GET, POST, OPTIONS",
      "access-control-allow-headers": "content-type, authorization",
      ...(allowOrigin === "*" ? {} : { vary: "Origin" }),
    };
    const json = (status: number, body: unknown): void => {
      res.writeHead(status, { "content-type": "application/json", ...cors });
      res.end(JSON.stringify(body));
    };
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://localhost");
    const path = url.pathname;
    try {
      // ---- file attachments (temp store) ------------------------------
      // POST /files      (octet-stream body; x-hauddy-{filename,mime,owner,to})
      // GET  /files/:id  → the bytes
      // Local hub (autoLink) trusts localhost; the platform requires Bearer and
      // that the requester owns the file or is its recipient.
      const fileGet = path.match(/^\/files\/([^/]+)$/);
      if (req.method === "POST" && path === "/files") {
        const accountId = requireAccount(req);
        if (!autoLink && !accountId) return json(401, { error: "E_AUTH_FAILED" });
        // Reject early on a declared size over the cap (the common case: fetch sets
        // content-length for a Buffer body) so we never buffer an oversized upload.
        const declared = Number(req.headers["content-length"] ?? 0);
        if (declared > files.maxFileBytes) return json(413, { error: `file exceeds the ${files.maxFileBytes}-byte limit` });
        const bytes = await readRawBody(req, files.maxFileBytes);
        if (!bytes) return json(413, { error: `file exceeds the ${files.maxFileBytes}-byte limit` });
        // Metadata comes from query params (browsers — avoids CORS custom-header
        // preflight blocks) or x-hauddy-* headers (server-to-server, e.g. the daemon).
        const q = url.searchParams;
        const name = (q.get("name") ?? decodeURIComponent(String(req.headers["x-hauddy-filename"] ?? "file"))) || "file";
        const mime = q.get("mime") ?? String(req.headers["x-hauddy-mime"] ?? "application/octet-stream");
        const owner = q.get("owner") ?? String(req.headers["x-hauddy-owner"] ?? "");
        const to = q.get("to") ?? (req.headers["x-hauddy-to"] ? decodeURIComponent(String(req.headers["x-hauddy-to"])) : null);
        const result = files.put(bytes, { name, mime, owner, to, account_id: accountId });
        if (!result.ok) return json(400, { error: result.error });
        return json(200, { file_id: result.file.file_id, size: result.file.size });
      }
      if (req.method === "GET" && fileGet) {
        const entry = files.get(decodeURIComponent(fileGet[1]!));
        if (!entry) return json(404, { error: "file not found or expired" });
        if (!autoLink) {
          const accountId = requireAccount(req);
          if (!accountId || !fileAccessible(entry.meta, accountId)) return json(403, { error: "forbidden" });
        }
        res.writeHead(200, {
          // mime is a best-effort hint; never let a missing one crash writeHead
          // (an undefined header value throws → surfaced as a confusing 400).
          "content-type": entry.meta.mime || "application/octet-stream",
          "content-length": String(entry.meta.size),
          "x-hauddy-filename": encodeURIComponent(entry.meta.name),
          ...cors,
        });
        res.end(entry.bytes);
        return;
      }

      // ---- accounts (global tier) -------------------------------------
      // Sign up: username + email + password → account (auto-logged-in: returns
      // the API key). Identity lives here on the platform; the app just pastes it.
      if (req.method === "POST" && path === "/accounts") {
        if (rateLimited(req, "signup", 20, 60 * 60 * 1000)) return json(429, { error: "too many sign-ups from this address — try again later" });
        const body = await readBody(req);
        const username = typeof body.username === "string" ? body.username.trim() : "";
        const email = typeof body.email === "string" ? body.email.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";
        if (!/^[a-z0-9_-]{3,32}$/i.test(username)) return json(400, { error: "username must be 3–32 chars (a–z 0–9 _ -)" });
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return json(400, { error: "a valid email is required" });
        if (password.length < 6) return json(400, { error: "password must be at least 6 characters" });
        // Private-alpha invite gate: only pre-approved emails may sign up (platform tier).
        const invited = autoLink ? null : invitedEmails();
        if (invited && !invited.has(email.toLowerCase())) return json(403, { error: "this email isn't on the invite list yet" });
        if (store.accountByUsername(username)) return json(409, { error: "that username is taken" });
        if (store.accountByEmail(email)) return json(409, { error: "an account with that email already exists" });
        const { account, apiKey } = store.createAccount({ username, email, password });
        return json(200, { account_id: account.account_id, username: account.username, email: account.email, api_key: apiKey, masked: account.key_masked });
      }
      // Log in with username-or-email + password → the account's stable API key.
      if (req.method === "POST" && path === "/accounts/login") {
        if (rateLimited(req, "login", 10, 15 * 60 * 1000)) return json(429, { error: "too many attempts — try again later" });
        const body = await readBody(req);
        const login = typeof body.login === "string" ? body.login.trim() : "";
        const password = typeof body.password === "string" ? body.password : "";
        const accountId = login && password ? store.verifyLogin(login, password) : null;
        if (!accountId) return json(401, { error: "wrong username/email or password" });
        const view = store.accountView(accountId)!;
        return json(200, { account_id: accountId, username: view.username, email: view.email, api_key: store.getApiKey(accountId), masked: view.masked });
      }
      if (req.method === "POST" && path === "/accounts/rotate") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const apiKey = store.rotateKey(accountId);
        return json(200, { api_key: apiKey, masked: store.getAccount(accountId)!.key_masked });
      }
      if (req.method === "POST" && path === "/accounts/revoke") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        store.revokeKey(accountId);
        for (const [ws, c] of clients) if (c.accountId === accountId) ws.close();
        return json(200, { ok: true });
      }
      if (req.method === "GET" && path === "/accounts/me") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        return json(200, {
          ...store.accountView(accountId)!,
          agents: store.accountAgents(accountId).map((a) => agentView(a.agent_id)),
        });
      }
      if (req.method === "GET" && path === "/accounts/claims") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        return json(200, claimsView(accountId));
      }

      // ---- profile friendships (spec §"friends") ----------------------
      if (req.method === "POST" && path === "/accounts/friends/request") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const body = await readBody(req);
        const targetAgentId = store.resolveAgentId(String(body.handle ?? ""));
        const targetAccount = targetAgentId ? store.getAgent(targetAgentId)?.account_id ?? null : null;
        if (!targetAccount) return json(404, { error: "E_UNKNOWN_AGENT" });
        if (targetAccount === accountId) return json(200, { state: "self" });
        let state: string = store.requestFriend(accountId, targetAccount).state;
        // Auto-accept on the *target's* side links the request immediately.
        if (state === "pending" && store.getAutoAccept(targetAccount)) {
          state = store.respondFriend(targetAccount, accountId, true).state;
        }
        return json(200, { state });
      }
      if (req.method === "POST" && path === "/accounts/friends/respond") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const body = await readBody(req);
        return json(200, store.respondFriend(accountId, String(body.account_id ?? ""), Boolean(body.accept)));
      }
      if (req.method === "GET" && path === "/accounts/friends") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const { linked, incoming, outgoing } = store.listFriendships(accountId);
        const brief = (id: string) => ({ account_id: id, email: store.getAccount(id)?.email ?? null });
        return json(200, {
          auto_accept: store.getAutoAccept(accountId),
          linked: linked.map((id) => ({ ...brief(id), agents: store.accountAgents(id).map((a) => agentView(a.agent_id)) })),
          incoming: incoming.map(brief),
          outgoing: outgoing.map(brief),
        });
      }
      if (req.method === "POST" && path === "/accounts/settings") {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const body = await readBody(req);
        if (typeof body.auto_accept === "boolean") store.setAutoAccept(accountId, body.auto_accept);
        return json(200, { auto_accept: store.getAutoAccept(accountId) });
      }
      // Unexpose: remove one of the account's agents from the platform.
      const unexpose = path.match(/^\/accounts\/agents\/([^/]+)\/remove$/);
      if (req.method === "POST" && unexpose) {
        const accountId = requireAccount(req);
        if (!accountId) return json(401, { error: "E_AUTH_FAILED" });
        const agentId = decodeURIComponent(unexpose[1]!);
        const agent = store.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return json(404, { ok: false, error: "not your agent" });
        return json(200, { ok: store.removeAgent(agentId) });
      }

      // ---- human console (spec §"human messaging") --------------------
      // The person's own identity, driven over HTTP. On the platform it's the
      // account's human agent (Bearer); on the local hub it's the single machine
      // human (no auth, resolved by `?as=` or by being the only one). SMS + calls
      // reuse the exact routing/consent an agent gets — the human is just a peer.
      if (path.startsWith("/console")) {
        const human = consoleHuman(req, url);
        if (!human) return json(400, { error: "no human console (account key or ?as=<humanId> required)" });
        const humanId = human.agent_id;
        const buffer = consoles.get(humanId)!;
        const callOf = (e: Envelope) => (e.payload as { call?: { id: string; kind: string } }).call;
        const bodyOf = (e: Envelope) => (e.payload as { body?: unknown }).body ?? null;

        if (req.method === "GET" && path === "/console/identity") return json(200, agentView(humanId));
        if (req.method === "POST" && path === "/console/identity") {
          const body = await readBody(req);
          if (typeof body.nickname !== "string") return json(400, { error: "nickname required" });
          return json(200, store.bindNickname(humanId, body.nickname));
        }
        if (req.method === "GET" && path === "/console/inbox") {
          const since = url.searchParams.get("since");
          const sms: Envelope[] = [];
          const rest: Envelope[] = [];
          for (const e of buffer) (callOf(e) ? rest : sms).push(e);
          consoles.set(humanId, rest);
          return json(200, { messages: since ? sms.filter((m) => m.ts > since) : sms, human: agentView(humanId) });
        }

        // ---- browsable history (spec §E): threads / thread / calls -----------
        // Mirrors the platform's console read routes. `?view_as=<id|@handle>`
        // browses one of the machine's OTHER agents' inboxes (agent↔agent
        // history); default = the human. (`as=` is already the human-identity
        // selector for the local hub, so view-as uses its own param.)
        const resolveConsoleViewer = (): string => {
          const asRef = url.searchParams.get("view_as");
          if (!asRef) return humanId;
          // Use the resolved local id, or the ref verbatim (platform/external ids
          // that live in the history store as-is). Never silently fall back to the
          // human — a caller who asked for a specific viewer should see that
          // viewer's history (possibly empty) rather than the human's.
          return store.resolveAgentId(asRef) ?? asRef;
        };
        const withPeerNick = (t: { peer_id: string; peer_nick: string | null }) => ({
          ...t,
          peer_nick: t.peer_nick ?? speakingNickname(t.peer_id) ?? t.peer_id,
        });
        if (req.method === "GET" && path === "/console/threads") {
          const viewerId = resolveConsoleViewer();
          return json(200, { threads: history.threadsFor(viewerId).map(withPeerNick) });
        }
        const threadMatch = path.match(/^\/console\/thread\/([^/]+)$/);
        if (req.method === "GET" && threadMatch) {
          const viewerId = resolveConsoleViewer();
          const ref = decodeURIComponent(threadMatch[1]!);
          const peerId = store.resolveAgentId(ref) ?? ref;
          const beforeRaw = url.searchParams.get("before");
          const before = beforeRaw && Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : null;
          const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
          const messages = history.messagesWithPeer(viewerId, peerId, before, limit);
          if (viewerId === humanId) history.markThreadRead(viewerId, peerId); // browsing an agent is read-only
          const peer_nick = speakingNickname(peerId) ?? (ref.startsWith("@") ? ref : `@${ref}`);
          return json(200, { peer_id: peerId, peer_nick, messages });
        }
        if (req.method === "GET" && path === "/console/calls") {
          const viewerId = resolveConsoleViewer();
          const withFrames = url.searchParams.get("withFrames") === "1";
          const calls = history.callsFor(viewerId).map((c) => {
            const incoming = c.callee === viewerId;
            const peer_id = incoming ? c.caller : c.callee;
            const peer_nick = (incoming ? c.caller_nick : c.callee_nick) ?? speakingNickname(peer_id) ?? peer_id;
            const base = {
              call_id: c.call_id,
              direction: incoming ? "incoming" : "outgoing",
              peer_id,
              peer_nick,
              state: c.state,
              started_ms: c.started_ms,
              answered_ms: c.answered_ms,
              ended_ms: c.ended_ms,
              end_reason: c.end_reason,
            };
            return withFrames ? { ...base, frames: history.callFrames(c.call_id) } : base;
          });
          return json(200, { calls });
        }
        if (req.method === "GET" && path === "/console/notifications") {
          // Local hub has no account friendships (that's a platform concept); the
          // daemon layer folds in friend_requests. Here: unread + missed only.
          const seen = notifSeen.get(humanId) ?? 0;
          return json(200, {
            friend_requests: 0,
            unread_messages: history.unreadMessageCount(humanId),
            missed_calls: history.missedCallCount(humanId, seen),
          });
        }
        if (req.method === "POST" && path === "/console/notifications/seen") {
          notifSeen.set(humanId, Date.now());
          return json(200, { ok: true });
        }

        if (req.method === "POST" && path === "/console/sms") {
          const body = await readBody(req);
          const atts = Array.isArray(body.attachments) && body.attachments.length ? { attachments: body.attachments } : {};
          const res = routeFromAgent(humanId, mkEnvelope(humanId, String(body.to ?? ""), { body: String(body.body ?? ""), ...atts }));
          return res.ok ? json(200, { status: res.status }) : json(400, { error: res.code, message: res.message });
        }
        // Calls: place/pickup/say/poll/hangup — the hub holds the human's side.
        if (req.method === "POST" && path === "/console/call") {
          const body = await readBody(req);
          const callId = `call_${crypto.randomBytes(5).toString("hex")}`;
          const greet = speakingNickname(humanId) ?? "human";
          const res = routeFromAgent(humanId, mkEnvelope(humanId, String(body.to ?? ""), { call: { id: callId, kind: "invite" }, body: greet }));
          if (!res.ok) return json(400, { error: res.code, message: res.message });
          consoleCall.set(humanId, { id: callId, peer: String(body.to ?? "") });
          return json(200, { status: "ringing", call_id: callId });
        }
        if (req.method === "POST" && path === "/console/call/pickup") {
          const body = await readBody(req);
          const callId = String(body.call_id ?? "");
          const peer = String(body.peer ?? "");
          if (!callId || !peer) return json(400, { error: "call_id and peer required" });
          consoleCall.set(humanId, { id: callId, peer });
          return json(200, { ok: true });
        }
        if (req.method === "POST" && path === "/console/call/say") {
          const body = await readBody(req);
          const call = consoleCall.get(humanId);
          if (!call) return json(400, { error: "no_active_call" });
          const atts = Array.isArray(body.attachments) && body.attachments.length ? { attachments: body.attachments } : {};
          const res = routeFromAgent(humanId, mkEnvelope(humanId, call.peer, { call: { id: call.id, kind: "frame" }, body: String(body.text ?? ""), ...atts }));
          return json(200, { ok: res.ok });
        }
        if (req.method === "GET" && path === "/console/call/poll") {
          const call = consoleCall.get(humanId);
          const frames: Array<{ id: string; kind: string; from: string; body: unknown; attachments?: unknown }> = [];
          const rest: Envelope[] = [];
          for (const e of buffer) {
            const c = callOf(e);
            if (c && (!call || c.id === call.id)) {
              const atts = (e.payload as { attachments?: unknown })?.attachments;
              frames.push({ id: c.id, kind: c.kind, from: e.from, body: bodyOf(e), ...(Array.isArray(atts) && atts.length ? { attachments: atts } : {}) });
            } else rest.push(e);
          }
          consoles.set(humanId, rest);
          let ended = false;
          if (call && frames.some((f) => f.kind === "close")) {
            consoleCall.delete(humanId);
            ended = true;
          }
          return json(200, { frames, ended, active: consoleCall.has(humanId), call_id: call?.id ?? null });
        }
        if (req.method === "POST" && path === "/console/call/hangup") {
          const call = consoleCall.get(humanId);
          if (call) {
            routeFromAgent(humanId, mkEnvelope(humanId, call.peer, { call: { id: call.id, kind: "close" } }));
            consoleCall.delete(humanId);
          }
          return json(200, { ok: true });
        }
        return json(404, { error: "unknown console route" });
      }

      // ---- registration (account OPTIONAL — local agents have none) ----
      if (req.method === "POST" && path === "/register") {
        const accountId = requireAccount(req); // null ⇒ local agent
        const body = await readBody(req);
        if (typeof body.grant_scope_id !== "string" || typeof body.public_key !== "string") {
          return json(400, { error: "grant_scope_id and public_key are required" });
        }
        const agent = store.registerAgent({
          account_id: accountId ?? undefined,
          grant_scope_id: body.grant_scope_id,
          public_key: body.public_key,
          local_id: typeof body.local_id === "string" ? body.local_id : undefined,
          display_name: typeof body.display_name === "string" ? body.display_name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
          kind: body.kind === "human" ? "human" : undefined,
        });
        let nickname: string | null = null;
        if (typeof body.nickname === "string") {
          const outcome = store.bindNickname(agent.agent_id, body.nickname);
          if (outcome.ok) nickname = outcome.nickname;
        }
        return json(200, { agent_id: agent.agent_id, nickname });
      }

      // ---- agents (local hub surface, no auth) ------------------------
      if (req.method === "GET" && path === "/agents") {
        return json(200, { agents: store.listAllAgents().map((a) => agentView(a.agent_id)) });
      }

      const nick = path.match(/^\/agents\/([^/]+)\/nickname$/);
      if (req.method === "POST" && nick) {
        const agentId = store.resolveAgentId(decodeURIComponent(nick[1]!));
        if (!agentId) return json(404, { ok: false, reason: "invalid", error: "E_UNKNOWN_AGENT" });
        const body = await readBody(req);
        if (typeof body.nickname !== "string") return json(400, { ok: false, reason: "invalid" });
        return json(200, store.bindNickname(agentId, body.nickname));
      }

      const profile = path.match(/^\/agents\/([^/]+)\/profile$/);
      if (req.method === "POST" && profile) {
        const agentId = store.resolveAgentId(decodeURIComponent(profile[1]!));
        if (!agentId) return json(404, { ok: false, error: "E_UNKNOWN_AGENT" });
        const body = await readBody(req);
        const ok = store.setAgentProfile(agentId, {
          display_name: typeof body.display_name === "string" ? body.display_name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
        });
        return json(200, { ok });
      }

      // ---- claims (local hub surface) ---------------------------------
      if (req.method === "GET" && path === "/claims") return json(200, claimsView());
      if (req.method === "POST" && (path === "/claims/release" || path === "/accounts/claims/release")) {
        const accountId = path === "/accounts/claims/release" ? requireAccount(req) : null;
        const body = await readBody(req);
        const bare = normalizeNickname(String(body.nickname ?? ""));
        if (bare && store.bindingOf(bare)) {
          claims.delete(bare);
          logClaim(accountId ?? "local", `${clock(Date.now())} — ${formatNickname(bare)} released (app)`);
        }
        return json(200, { ok: true });
      }

      // ---- contact graph (spec §4) ------------------------------------
      if (req.method === "POST" && path === "/contacts/share") {
        const body = await readBody(req);
        const from = store.resolveAgentId(String(body.from ?? ""));
        const target = store.resolveAgentId(String(body.agent_id ?? ""));
        if (!from || !target) return json(404, { error: "E_UNKNOWN_AGENT" });
        return json(200, { state: store.shareContact(from, target).state });
      }
      if (req.method === "POST" && path === "/contacts/respond") {
        const body = await readBody(req);
        const responder = store.resolveAgentId(String(body.from ?? ""));
        const requester = store.resolveAgentId(String(body.agent_id ?? ""));
        if (!responder || !requester) return json(404, { error: "E_UNKNOWN_AGENT" });
        return json(200, { state: store.respondContact(responder, requester, Boolean(body.accept)).state });
      }
      if (req.method === "GET" && path.startsWith("/presence/")) {
        const agentId = store.resolveAgentId(decodeURIComponent(path.slice("/presence/".length)));
        if (!agentId) return json(404, { error: "E_UNKNOWN_AGENT" });
        const requester = store.resolveAgentId(url.searchParams.get("for") ?? "");
        if (requester && requester !== agentId && !areLinked(requester, agentId)) {
          return json(403, { error: "E_NOT_LINKED" });
        }
        return json(200, presenceOf(agentId));
      }
      if (req.method === "GET" && path.startsWith("/contacts/")) {
        const agentId = store.resolveAgentId(decodeURIComponent(path.slice("/contacts/".length)));
        if (!agentId) return json(404, { error: "E_UNKNOWN_AGENT" });
        const contacts = contactsOf(agentId).map((id) => {
          const presence = presenceOf(id); // resolves remote nicknames/presence too
          const localAgent = store.getAgent(id);
          return {
            agent_id: id,
            display_name: localAgent?.display_name ?? remotes.get(id)?.description ?? null,
            nickname: presence.nickname ?? null,
            kind: localAgent?.kind ?? "agent",
            presence,
          };
        });
        return json(200, { contacts, pending: autoLink ? [] : store.pendingRequests(agentId) });
      }

      json(404, { error: "not found" });
    } catch (err) {
      json(400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // --- wiring --------------------------------------------------------------

  const server = http.createServer((req, res) => {
    void handleHttp(req, res);
  });
  const wss = new WebSocketServer({ server });
  wss.on("connection", (ws) => {
    clients.set(ws, {
      agentId: null,
      accountId: null,
      pendingAgentId: null,
      nonce: null,
      pendingNickname: null,
      nickname: null,
      nicknameStatus: null,
      callReady: false,
      sessionId: crypto.randomBytes(2).toString("hex"),
      connectedAt: Date.now(),
      isAlive: true,
    });
    ws.on("pong", () => {
      const c = clients.get(ws);
      if (c) c.isAlive = true;
    });
    ws.on("message", (data) => {
      let raw: unknown;
      try {
        raw = JSON.parse(data.toString());
      } catch {
        sendError(ws, "E_UNSUPPORTED", "invalid JSON");
        return;
      }
      handleFrame(ws, raw);
    });
    ws.on("close", () => handleClose(ws));
  });

  // WS heartbeat: keep connections warm through proxies/CDNs (Cloudflare idles a
  // WebSocket after ~100s) and reap peers that stopped answering. Ping every 30s;
  // terminate any socket that missed the previous pong.
  const heartbeat = setInterval(() => {
    for (const [ws, c] of clients) {
      if (c.isAlive === false) {
        ws.terminate();
        continue;
      }
      c.isAlive = false;
      try {
        ws.ping();
      } catch {
        /* socket already closing */
      }
    }
  }, 30_000);
  heartbeat.unref?.();

  const host = options.host ?? "127.0.0.1";
  await new Promise<void>((resolve) => server.listen(options.port ?? 8787, host, resolve));
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 8787);

  return {
    port,
    store,
    history,
    files,
    wsUrl: `ws://${host}:${port}`,
    httpUrl: `http://${host}:${port}`,
    setRemotes,
    injectInbound,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(heartbeat);
        files.close();
        for (const ws of clients.keys()) ws.terminate();
        wss.close(() => server.close(() => resolve()));
      }),
  };
}
