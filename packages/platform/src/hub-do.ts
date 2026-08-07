import {
  controlFrameSchema,
  formatNickname,
  isReservedMessageType,
  mintMessageId,
  normalizeNickname,
  nowIso,
  PROTOCOL_VERSION,
  slugifyNickname,
  type Envelope,
  type ErrorCode,
  type Presence,
} from "@hauddy/protocol";

/** A console human counts as "online" for this long after its last activity
 *  (it has no WS socket, so presence is heartbeat-based). */
const CONSOLE_TTL_MS = 90_000;
import type { Env } from "./env.js";
import { Db, type AttachmentRow, type CallRow, type SyncMessage } from "./db.js";
import { FileStoreR2 } from "./files-r2.js";
import { b64urlToBytes, randomHex, randomNonceB64url, verifyEd25519 } from "./crypto.js";

/** The console human's active-call pointer (DO storage, key `ccall:<humanId>`). */
interface CCall {
  callId: string;
  peer: string;
  seq: number; // last call_frames seq surfaced by poll
  sawInvite: boolean; // whether the incoming-invite pseudo-frame was already emitted
}

/** Per-socket state, persisted via serializeAttachment so it survives DO
 *  hibernation (in-memory Maps do not). Handshake scratch + post-auth identity. */
interface SockAtt {
  agentId: string | null; // set once authenticated
  accountId: string | null;
  nickname: string | null;
  callReady: boolean;
  /** Bare nicknames this socket owns inbound for (fork arbitration, spec §2.3). */
  claims: string[];
  // handshake scratch (cleared after auth_response):
  pendingAgentId: string | null;
  pendingNickname: string | null;
  nonce: string | null; // base64url
}

function freshAtt(): SockAtt {
  return {
    agentId: null,
    accountId: null,
    nickname: null,
    callReady: false,
    claims: [],
    pendingAgentId: null,
    pendingNickname: null,
    nonce: null,
  };
}

/**
 * HubDO — the single global platform hub. One instance (idFromName("global"))
 * owns every WebSocket connection (Hibernation API), the SQLite database, and the
 * routing logic. P1 lands the full HTTP control API (accounts, register, agents,
 * nicknames, friends, contacts). WS auth/routing + live presence land in P3, so
 * presence here reads "offline" until then.
 */
export class HubDO {
  private db: Db;
  private files: FileStoreR2;

  constructor(
    private ctx: DurableObjectState,
    private env: Env,
  ) {
    this.db = new Db(ctx.storage.sql);
    this.db.init();
    this.files = new FileStoreR2(env.FILES, this.db, ctx.storage);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
  }

  // ── HTTP control API ────────────────────────────────────────────────────
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    // WebSocket upgrade → accept with hibernation (auth handshake lands in P3).
    if (request.headers.get("Upgrade")?.toLowerCase() === "websocket") {
      const { 0: client, 1: server } = new WebSocketPair();
      this.ctx.acceptWebSocket(server);
      return new Response(null, { status: 101, webSocket: client });
    }

    try {
      if (method === "GET" && (path === "/" || path === "/health")) {
        return this.json(200, {
          ok: true,
          service: "hauddy-platform",
          message: "Hauddy platform API. See https://hauddy.com",
        });
      }

      // ── file attachments (R2 + attachments table) ─────────────────────
      const fileGet = path.match(/^\/files\/([^/]+)$/);
      if (method === "POST" && path === "/files") return await this.uploadFile(request, url);
      if (method === "GET" && fileGet) return await this.downloadFile(request, decodeURIComponent(fileGet[1]!));

      // ── admin: invite allowlist ("update from the backend manually") ──
      if (method === "POST" && path === "/admin/invites") {
        const header = request.headers.get("authorization") ?? "";
        const token = header.startsWith("Bearer ") ? header.slice(7) : "";
        if (!this.env.ADMIN_TOKEN || token !== this.env.ADMIN_TOKEN) return this.unauthorized();
        const body = await this.readBody(request);
        const email = typeof body.email === "string" ? body.email.trim() : "";
        if (!/^[^@\s]+@[^@\s]+$/.test(email)) return this.json(400, { error: "a valid email is required" });
        this.db.addInvite(email, typeof body.note === "string" ? body.note : undefined);
        return this.json(200, { ok: true, invited: email.toLowerCase(), count: this.db.inviteCount() });
      }

      // ── accounts ──────────────────────────────────────────────────────
      if (method === "POST" && path === "/accounts") return await this.signup(request);
      if (method === "POST" && path === "/accounts/login") return await this.login(request);
      if (method === "POST" && path === "/accounts/rotate") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const apiKey = this.db.rotateKey(accountId);
        return this.json(200, { api_key: apiKey, masked: this.db.getAccount(accountId)!.key_masked });
      }
      if (method === "POST" && path === "/accounts/revoke") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        this.db.revokeKey(accountId);
        return this.json(200, { ok: true });
      }
      if (method === "GET" && path === "/accounts/me") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        return this.json(200, {
          ...this.db.accountView(accountId)!,
          agents: this.db.accountAgents(accountId).map((a) => this.agentView(a.agent_id)),
          reservations: this.db.accountReservations(accountId),
        });
      }
      if (method === "GET" && path === "/accounts/claims") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        return this.json(200, this.claimsView(accountId));
      }

      // ── profile friendships ───────────────────────────────────────────
      if (method === "POST" && path === "/accounts/friends/request") return await this.friendRequest(request);
      if (method === "POST" && path === "/accounts/friends/respond") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        return this.json(200, this.db.respondFriend(accountId, String(body.account_id ?? ""), Boolean(body.accept)));
      }
      if (method === "GET" && path === "/accounts/friends") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const { linked, incoming, outgoing } = this.db.listFriendships(accountId);
        const brief = (id: string) => ({ account_id: id, email: this.db.getAccount(id)?.email ?? null });
        return this.json(200, {
          auto_accept: this.db.getAutoAccept(accountId),
          linked: linked.map((id) => ({ ...brief(id), agents: this.db.accountAgents(id).map((a) => this.agentView(a.agent_id)) })),
          incoming: incoming.map(brief),
          outgoing: outgoing.map(brief),
        });
      }
      if (method === "POST" && path === "/accounts/settings") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        if (typeof body.auto_accept === "boolean") this.db.setAutoAccept(accountId, body.auto_accept);
        return this.json(200, { auto_accept: this.db.getAutoAccept(accountId) });
      }

      // ── nickname reservations (account-level holds; app-ux-plan §G) ────
      if (method === "GET" && path === "/accounts/nicknames/check") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        return this.json(200, this.db.nicknameAvailability(url.searchParams.get("name") ?? "", accountId));
      }
      if (method === "POST" && path === "/accounts/nicknames/reserve") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        if (typeof body.name !== "string") return this.json(400, { ok: false, reason: "invalid" });
        return this.json(200, this.db.reserveNickname(accountId, body.name));
      }
      if (method === "POST" && path === "/accounts/nicknames/release") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        return this.json(200, { ok: this.db.releaseReservation(accountId, String(body.name ?? "")) });
      }
      if (method === "POST" && path === "/accounts/nicknames/attach") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const agentId = this.db.resolveAgentId(String(body.agent_id ?? ""));
        if (!agentId) return this.json(404, { ok: false, reason: "invalid", error: "E_UNKNOWN_AGENT" });
        return this.json(200, this.db.attachReservation(accountId, agentId, String(body.name ?? "")));
      }

      const unexpose = path.match(/^\/accounts\/agents\/([^/]+)\/remove$/);
      if (method === "POST" && unexpose) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const agentId = decodeURIComponent(unexpose[1]!);
        const agent = this.db.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return this.json(404, { ok: false, error: "not your agent" });
        return this.json(200, { ok: this.db.removeAgent(agentId) });
      }

      // ── human console (virtual HTTP client over the DB) ───────────────
      if (path.startsWith("/console")) return await this.console(request, url);

      // ── registration (account OPTIONAL) ───────────────────────────────
      if (method === "POST" && path === "/register") return await this.register(request);

      // ── agents ────────────────────────────────────────────────────────
      if (method === "GET" && path === "/agents") {
        return this.json(200, { agents: this.db.listAllAgents().map((a) => this.agentView(a.agent_id)) });
      }
      const nick = path.match(/^\/agents\/([^/]+)\/nickname$/);
      if (method === "POST" && nick) {
        const agentId = this.db.resolveAgentId(decodeURIComponent(nick[1]!));
        if (!agentId) return this.json(404, { ok: false, reason: "invalid", error: "E_UNKNOWN_AGENT" });
        const body = await this.readBody(request);
        if (typeof body.nickname !== "string") return this.json(400, { ok: false, reason: "invalid" });
        return this.json(200, this.db.bindNickname(agentId, body.nickname));
      }
      const profile = path.match(/^\/agents\/([^/]+)\/profile$/);
      if (method === "POST" && profile) {
        const agentId = this.db.resolveAgentId(decodeURIComponent(profile[1]!));
        if (!agentId) return this.json(404, { ok: false, error: "E_UNKNOWN_AGENT" });
        const body = await this.readBody(request);
        const ok = this.db.setAgentProfile(agentId, {
          display_name: typeof body.display_name === "string" ? body.display_name : undefined,
          description: typeof body.description === "string" ? body.description : undefined,
        });
        return this.json(200, { ok });
      }

      // ── claims (WS-owned; P1 has no live claims) ──────────────────────
      if (method === "GET" && path === "/claims") return this.json(200, this.claimsView());
      if (method === "POST" && (path === "/claims/release" || path === "/accounts/claims/release")) {
        return this.json(200, { ok: true });
      }

      // ── call history (participant-gated read; broader history UI deferred) ─
      const callGet = path.match(/^\/calls\/([^/]+)$/);
      if (method === "GET" && callGet) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const call = this.db.getCall(decodeURIComponent(callGet[1]!));
        if (!call) return this.json(404, { error: "call not found" });
        const isParticipant = [call.caller, call.callee].some((id) => this.db.getAgent(id)?.account_id === accountId);
        if (!isParticipant) return this.json(403, { error: "forbidden" });
        return this.json(200, { call, frames: this.db.callFrames(call.call_id) });
      }

      // ── contact graph ─────────────────────────────────────────────────
      if (method === "POST" && path === "/contacts/share") {
        const body = await this.readBody(request);
        const from = this.db.resolveAgentId(String(body.from ?? ""));
        const target = this.db.resolveAgentId(String(body.agent_id ?? ""));
        if (!from || !target) return this.json(404, { error: "E_UNKNOWN_AGENT" });
        return this.json(200, { state: this.db.shareContact(from, target).state });
      }
      if (method === "POST" && path === "/contacts/respond") {
        const body = await this.readBody(request);
        const responder = this.db.resolveAgentId(String(body.from ?? ""));
        const requester = this.db.resolveAgentId(String(body.agent_id ?? ""));
        if (!responder || !requester) return this.json(404, { error: "E_UNKNOWN_AGENT" });
        return this.json(200, { state: this.db.respondContact(responder, requester, Boolean(body.accept)).state });
      }
      if (method === "GET" && path.startsWith("/presence/")) {
        const agentId = this.db.resolveAgentId(decodeURIComponent(path.slice("/presence/".length)));
        if (!agentId) return this.json(404, { error: "E_UNKNOWN_AGENT" });
        const requester = this.db.resolveAgentId(url.searchParams.get("for") ?? "");
        if (requester && requester !== agentId && !this.areLinked(requester, agentId)) {
          return this.json(403, { error: "E_NOT_LINKED" });
        }
        return this.json(200, this.presenceOf(agentId));
      }
      if (method === "GET" && path.startsWith("/contacts/")) {
        const agentId = this.db.resolveAgentId(decodeURIComponent(path.slice("/contacts/".length)));
        if (!agentId) return this.json(404, { error: "E_UNKNOWN_AGENT" });
        const contacts = this.contactsOf(agentId).map((id) => {
          const presence = this.presenceOf(id);
          const agent = this.db.getAgent(id);
          return {
            agent_id: id,
            display_name: agent?.display_name ?? null,
            nickname: presence.nickname ?? null,
            kind: agent?.kind ?? "agent",
            presence,
          };
        });
        return this.json(200, { contacts, pending: this.db.pendingRequests(agentId) });
      }

      return this.json(404, { error: "not found" });
    } catch (err) {
      return this.json(400, { error: err instanceof Error ? err.message : String(err) });
    }
  }

  // ── route helpers ─────────────────────────────────────────────────────
  private async signup(request: Request): Promise<Response> {
    if (this.rateLimited(request, "signup", 20, 60 * 60 * 1000)) {
      return this.json(429, { error: "too many sign-ups from this address — try again later" });
    }
    const body = await this.readBody(request);
    const username = typeof body.username === "string" ? body.username.trim() : "";
    const email = typeof body.email === "string" ? body.email.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9_-]{3,32}$/i.test(username)) return this.json(400, { error: "username must be 3–32 chars (a–z 0–9 _ -)" });
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return this.json(400, { error: "a valid email is required" });
    if (password.length < 6) return this.json(400, { error: "password must be at least 6 characters" });
    // Invite gate: an empty invites table means open signup (matches the Node hub's
    // "no allowlist file ⇒ open"); once any invite exists, only listed emails may join.
    if (this.db.inviteCount() > 0 && !this.db.isInvited(email)) {
      return this.json(403, { error: "this email isn't on the invite list yet" });
    }
    if (this.db.accountByUsername(username)) return this.json(409, { error: "that username is taken" });
    if (this.db.accountByEmail(email)) return this.json(409, { error: "an account with that email already exists" });
    const { account, apiKey } = await this.db.createAccount({ username, email, password });
    return this.json(200, {
      account_id: account.account_id,
      username: account.username,
      email: account.email,
      api_key: apiKey,
      masked: account.key_masked,
    });
  }

  private async login(request: Request): Promise<Response> {
    if (this.rateLimited(request, "login", 10, 15 * 60 * 1000)) {
      return this.json(429, { error: "too many attempts — try again later" });
    }
    const body = await this.readBody(request);
    const login = typeof body.login === "string" ? body.login.trim() : "";
    const password = typeof body.password === "string" ? body.password : "";
    const accountId = login && password ? await this.db.verifyLogin(login, password) : null;
    if (!accountId) return this.json(401, { error: "wrong username/email or password" });
    const view = this.db.accountView(accountId)!;
    return this.json(200, {
      account_id: accountId,
      username: view.username,
      email: view.email,
      api_key: this.db.getApiKey(accountId),
      masked: view.masked,
    });
  }

  private async friendRequest(request: Request): Promise<Response> {
    const accountId = this.requireAccount(request);
    if (!accountId) return this.unauthorized();
    const body = await this.readBody(request);
    const targetAgentId = this.db.resolveAgentId(String(body.handle ?? ""));
    const targetAccount = targetAgentId ? this.db.getAgent(targetAgentId)?.account_id ?? null : null;
    if (!targetAccount) return this.json(404, { error: "E_UNKNOWN_AGENT" });
    if (targetAccount === accountId) return this.json(200, { state: "self" });
    let state: string = this.db.requestFriend(accountId, targetAccount).state;
    if (state === "pending" && this.db.getAutoAccept(targetAccount)) {
      state = this.db.respondFriend(targetAccount, accountId, true).state;
    }
    return this.json(200, { state });
  }

  private async register(request: Request): Promise<Response> {
    const accountId = this.requireAccount(request); // null ⇒ local agent
    const body = await this.readBody(request);
    if (typeof body.grant_scope_id !== "string" || typeof body.public_key !== "string") {
      return this.json(400, { error: "grant_scope_id and public_key are required" });
    }
    const agent = this.db.registerAgent({
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
      const outcome = this.db.bindNickname(agent.agent_id, body.nickname);
      if (outcome.ok) nickname = outcome.nickname;
    }
    return this.json(200, { agent_id: agent.agent_id, nickname });
  }

  // ── file attachments ──────────────────────────────────────────────────
  private async uploadFile(request: Request, url: URL): Promise<Response> {
    // Platform always requires an account (the local hub's autoLink-trust path
    // does not exist here).
    const accountId = this.requireAccount(request);
    if (!accountId) return this.unauthorized();
    // Reject early on a declared over-cap size so we never buffer an oversized body.
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > this.files.maxFileBytes) {
      return this.json(413, { error: `file exceeds the ${this.files.maxFileBytes}-byte limit` });
    }
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > this.files.maxFileBytes) {
      return this.json(413, { error: `file exceeds the ${this.files.maxFileBytes}-byte limit` });
    }
    // Metadata from query params (browsers — avoids a CORS custom-header preflight)
    // or x-hauddy-* headers (server-to-server).
    const q = url.searchParams;
    const hdr = (k: string) => request.headers.get(k);
    const name = (q.get("name") ?? (hdr("x-hauddy-filename") ? decodeURIComponent(hdr("x-hauddy-filename")!) : "file")) || "file";
    const mime = q.get("mime") ?? hdr("x-hauddy-mime") ?? "application/octet-stream";
    const owner = q.get("owner") ?? hdr("x-hauddy-owner") ?? "";
    const to = q.get("to") ?? (hdr("x-hauddy-to") ? decodeURIComponent(hdr("x-hauddy-to")!) : null);
    const result = await this.files.put(bytes, { name, mime, owner, to, account_id: accountId }, Date.now());
    if (!result.ok) return this.json(400, { error: result.error });
    return this.json(200, { file_id: result.file.file_id, size: result.file.size });
  }

  private async downloadFile(request: Request, fileId: string): Promise<Response> {
    const entry = await this.files.get(fileId, Date.now());
    if (!entry) return this.json(404, { error: "file not found or expired" });
    const accountId = this.requireAccount(request);
    if (!accountId || !this.fileAccessible(entry.meta, accountId)) return this.json(403, { error: "forbidden" });
    return new Response(entry.body, {
      status: 200,
      headers: {
        // mime is a best-effort hint; default it so a missing value can't throw.
        "content-type": entry.meta.mime || "application/octet-stream",
        "content-length": String(entry.meta.size),
        "x-hauddy-filename": encodeURIComponent(entry.meta.name),
        "access-control-allow-origin": this.env.CORS_ORIGIN ?? "*",
      },
    });
  }

  /** Download auth: the requester's account owns the file (sender) or is the
   *  recipient (its `to` resolves to one of their agents). */
  private fileAccessible(meta: AttachmentRow, accountId: string): boolean {
    if (meta.account_id && meta.account_id === accountId) return true;
    if (meta.to_ref) {
      const toId = this.db.resolveAgentId(meta.to_ref) ?? (this.db.getAgent(meta.to_ref) ? meta.to_ref : null);
      const acct = toId ? this.db.getAgent(toId)?.account_id ?? null : null;
      if (acct && acct === accountId) return true;
    }
    return false;
  }

  // ── human console (virtual HTTP client, spec §"human messaging") ───────
  private mkEnvelope(from: string, to: string, payload: Record<string, unknown>): Envelope {
    return { v: PROTOCOL_VERSION, id: mintMessageId(), type: "sms", from, to, ts: nowIso(), payload, sig: null };
  }

  /** Resolve (+ mark attached) the account's human identity. Platform-only: Bearer. */
  private consoleHuman(request: Request): { agent_id: string } | null {
    const accountId = this.requireAccount(request);
    if (!accountId) return null;
    const email = this.db.getAccount(accountId)?.email ?? "";
    const nick = slugifyNickname(email.split("@")[0] ?? "") ?? undefined;
    const human = this.db.ensureHumanAgent(accountId, nick);
    this.db.consoleTouch(human.agent_id, Date.now());
    return human;
  }

  /** Resolve a console *read's* viewer identity: default = the human, or `?as=`
   *  one of the SAME account's other agents (to browse that agent's inbox, incl.
   *  agent↔agent history). Returns null if the ref isn't an agent this account
   *  owns — so a caller can only ever read its own agents. */
  private resolveConsoleViewer(request: Request, asRef: string | null, humanId: string): string | null {
    if (!asRef || asRef === humanId) return humanId;
    const accountId = this.requireAccount(request);
    if (!accountId) return null;
    const resolved = this.db.resolveAgentId(asRef) ?? asRef;
    return this.db.accountAgents(accountId).some((a) => a.agent_id === resolved) ? resolved : null;
  }

  private async console(request: Request, url: URL): Promise<Response> {
    const human = this.consoleHuman(request);
    if (!human) return this.json(400, { error: "no human console (account key required)" });
    const humanId = human.agent_id;
    const path = url.pathname;
    const method = request.method;

    if (method === "GET" && path === "/console/identity") return this.json(200, this.agentView(humanId));
    if (method === "POST" && path === "/console/identity") {
      const body = await this.readBody(request);
      if (typeof body.nickname !== "string") return this.json(400, { error: "nickname required" });
      return this.json(200, this.db.bindNickname(humanId, body.nickname));
    }
    if (method === "GET" && path === "/console/inbox") {
      // The human's SMS live in the messages table (undelivered). Drain them here.
      const since = url.searchParams.get("since");
      const undelivered = this.db.undeliveredFor(humanId);
      for (const e of undelivered) this.db.markDelivered(e.id, humanId);
      const messages = since ? undelivered.filter((m) => m.ts > since) : undelivered;
      return this.json(200, { messages, human: this.agentView(humanId) });
    }
    if (method === "GET" && path === "/console/threads") {
      // Browsable conversation list (read-only; does NOT mark delivered/read).
      // `?as=<agentId|@handle>` browses one of the account's OTHER agents' inboxes
      // (agent↔agent history); default = the human. Ownership-checked.
      const viewerId = this.resolveConsoleViewer(request, url.searchParams.get("as"), humanId);
      if (!viewerId) return this.json(403, { error: "not your agent" });
      const threads = this.db.threadsFor(viewerId).map((t) => ({
        ...t,
        peer_nick: t.peer_nick ?? this.db.speakingNickname(t.peer_id) ?? t.peer_id,
      }));
      return this.json(200, { threads });
    }
    const threadMatch = path.match(/^\/console\/thread\/([^/]+)$/);
    if (method === "GET" && threadMatch) {
      // Full history with one peer. The client holds @handles → resolve to an id.
      const viewerId = this.resolveConsoleViewer(request, url.searchParams.get("as"), humanId);
      if (!viewerId) return this.json(403, { error: "not your agent" });
      const ref = decodeURIComponent(threadMatch[1]!);
      const peerId = this.db.resolveAgentId(ref) ?? ref;
      const beforeRaw = url.searchParams.get("before");
      const before = beforeRaw && Number.isFinite(Number(beforeRaw)) ? Number(beforeRaw) : null;
      const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 50, 1), 200);
      const messages = this.db.messagesWithPeer(viewerId, peerId, before, limit);
      // Only the human's OWN view clears unread; browsing an agent's inbox is read-only.
      if (viewerId === humanId) this.db.markThreadRead(viewerId, peerId);
      const peer_nick = this.db.speakingNickname(peerId) ?? (ref.startsWith("@") ? ref : `@${ref}`);
      return this.json(200, { peer_id: peerId, peer_nick, messages });
    }
    if (method === "GET" && path === "/console/calls") {
      const viewerId = this.resolveConsoleViewer(request, url.searchParams.get("as"), humanId);
      if (!viewerId) return this.json(403, { error: "not your agent" });
      const withFrames = url.searchParams.get("withFrames") === "1";
      const calls = this.db.callsFor(viewerId).map((c) => {
        const incoming = c.callee === viewerId;
        const peer_id = incoming ? c.caller : c.callee;
        const peer_nick = (incoming ? c.caller_nick : c.callee_nick) ?? this.db.speakingNickname(peer_id) ?? peer_id;
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
        return withFrames ? { ...base, frames: this.db.callFrames(c.call_id) } : base;
      });
      return this.json(200, { calls });
    }
    if (method === "GET" && path === "/console/notifications") {
      // One cheap call for the top-bar bell: pending friend requests + unread
      // threads + missed calls (spec §F). Missed calls have no per-row read flag,
      // so a per-human "seen" cursor (bumped when the bell is opened) clears them.
      const accountId = this.requireAccount(request);
      const friendRequests = accountId ? this.db.listFriendships(accountId).incoming.length : 0;
      const seen = (await this.ctx.storage.get<number>(`notifseen:${humanId}`)) ?? 0;
      return this.json(200, {
        friend_requests: friendRequests,
        unread_messages: this.db.unreadMessageCount(humanId),
        missed_calls: this.db.missedCallCount(humanId, seen),
      });
    }
    if (method === "POST" && path === "/console/notifications/seen") {
      // Acknowledge missed calls up to now (called when the bell dropdown opens).
      await this.ctx.storage.put(`notifseen:${humanId}`, Date.now());
      return this.json(200, { ok: true });
    }
    if (method === "POST" && path === "/console/sms") {
      const body = await this.readBody(request);
      const atts = Array.isArray(body.attachments) && body.attachments.length ? { attachments: body.attachments } : {};
      const res = this.routeFromAgent(humanId, this.mkEnvelope(humanId, String(body.to ?? ""), { body: String(body.body ?? ""), ...atts }));
      return res.ok ? this.json(200, { status: res.status }) : this.json(400, { error: res.code, message: res.message });
    }
    if (method === "POST" && path === "/console/call") {
      const body = await this.readBody(request);
      const callId = `call_${randomHex(5)}`;
      const greet = this.db.speakingNickname(humanId) ?? "human";
      const res = this.routeFromAgent(humanId, this.mkEnvelope(humanId, String(body.to ?? ""), { call: { id: callId, kind: "invite" }, body: greet }));
      if (!res.ok) return this.json(400, { error: res.code, message: res.message });
      await this.ctx.storage.put<CCall>(`ccall:${humanId}`, { callId, peer: String(body.to ?? ""), seq: -1, sawInvite: true });
      return this.json(200, { status: "ringing", call_id: callId });
    }
    if (method === "POST" && path === "/console/call/pickup") {
      const body = await this.readBody(request);
      const callId = String(body.call_id ?? "");
      const peer = String(body.peer ?? "");
      if (!callId || !peer) return this.json(400, { error: "call_id and peer required" });
      await this.ctx.storage.put<CCall>(`ccall:${humanId}`, { callId, peer, seq: -1, sawInvite: true });
      return this.json(200, { ok: true });
    }
    if (method === "POST" && path === "/console/call/say") {
      const body = await this.readBody(request);
      const call = await this.ctx.storage.get<CCall>(`ccall:${humanId}`);
      if (!call) return this.json(400, { error: "no_active_call" });
      const atts = Array.isArray(body.attachments) && body.attachments.length ? { attachments: body.attachments } : {};
      const res = this.routeFromAgent(humanId, this.mkEnvelope(humanId, call.peer, { call: { id: call.callId, kind: "frame" }, body: String(body.text ?? ""), ...atts }));
      return this.json(200, { ok: res.ok });
    }
    if (method === "GET" && path === "/console/call/poll") return this.json(200, await this.consolePoll(humanId));
    if (method === "POST" && path === "/console/call/hangup") {
      const call = await this.ctx.storage.get<CCall>(`ccall:${humanId}`);
      if (call) {
        this.routeFromAgent(humanId, this.mkEnvelope(humanId, call.peer, { call: { id: call.callId, kind: "close" } }));
        await this.ctx.storage.delete(`ccall:${humanId}`);
      }
      return this.json(200, { ok: true });
    }
    // ---- sync mirror (local hub ⇄ platform; platform = SSOT) ----
    // Push = persist-only ingest (NO delivery), pull = account-scoped history.
    // All ingest is INSERT OR IGNORE by id → a locally-edited row can never
    // overwrite the SSOT copy, so a tampered ~/.hauddy/history.json is inert here.
    if (method === "POST" && path === "/console/sync/messages") {
      const body = await this.readBody(request);
      const rows = Array.isArray(body.messages) ? (body.messages as SyncMessage[]) : [];
      let ingested = 0;
      for (const r of rows) {
        if (!r || typeof r.message_id !== "string") continue;
        this.db.ingestMessage(r);
        ingested += 1;
      }
      return this.json(200, { ok: true, ingested });
    }
    if (method === "POST" && path === "/console/sync/calls") {
      const body = await this.readBody(request);
      const calls = Array.isArray(body.calls) ? (body.calls as Array<CallRow & { frames?: Array<Record<string, unknown>> }>) : [];
      let ingested = 0;
      for (const c of calls) {
        if (!c || typeof c.call_id !== "string") continue;
        this.db.ingestCall(c);
        for (const f of Array.isArray(c.frames) ? c.frames : []) {
          if (typeof f.frame_id !== "string") continue;
          this.db.insertCallFrame({
            frame_id: String(f.frame_id),
            call_id: c.call_id,
            from_agent: String(f.from_agent ?? ""),
            body: f.body == null ? null : String(f.body),
            attachments: f.attachments == null ? null : typeof f.attachments === "string" ? (f.attachments as string) : JSON.stringify(f.attachments),
            created_ms: Number(f.created_ms ?? 0),
          });
        }
        ingested += 1;
      }
      return this.json(200, { ok: true, ingested });
    }
    if (method === "GET" && path === "/console/sync/pull") {
      const accountId = this.requireAccount(request);
      if (!accountId) return this.json(401, { error: "account required" });
      const sinceRaw = url.searchParams.get("since");
      const since = sinceRaw && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : 0;
      const agentIds = this.db.accountAgents(accountId).map((a) => a.agent_id);
      return this.json(200, {
        messages: this.db.messagesForScope(agentIds, since),
        calls: this.db.callsForScope(agentIds, since),
        now: Date.now(),
      });
    }
    return this.json(404, { error: "unknown console route" });
  }

  /** Reconstruct the console's call frame stream (invite/frame/close) from the
   *  durable calls + call_frames tables, tracking a per-human seq cursor. */
  private async consolePoll(
    humanId: string,
  ): Promise<{ frames: Array<Record<string, unknown>>; ended: boolean; active: boolean; call_id: string | null }> {
    let cursor = await this.ctx.storage.get<CCall>(`ccall:${humanId}`);
    if (!cursor) {
      const open = this.db.latestOpenCallFor(humanId);
      if (open) cursor = { callId: open.call_id, peer: open.caller === humanId ? open.callee : open.caller, seq: -1, sawInvite: false };
    }
    if (!cursor) return { frames: [], ended: false, active: false, call_id: null };
    const call = this.db.getCall(cursor.callId);
    const frames: Array<Record<string, unknown>> = [];
    if (call && !cursor.sawInvite && call.caller !== humanId) {
      frames.push({ id: cursor.callId, kind: "invite", from: call.caller, body: call.caller_nick ?? call.caller });
    }
    const fresh = this.db.callFramesSince(cursor.callId, cursor.seq, humanId);
    for (const f of fresh) {
      frames.push({
        id: cursor.callId,
        kind: "frame",
        from: f.from_agent,
        body: f.body,
        ...(Array.isArray(f.attachments) && f.attachments.length ? { attachments: f.attachments } : {}),
      });
    }
    const newSeq = fresh.length ? fresh[fresh.length - 1]!.seq : cursor.seq;
    const ended = !call || ["ended", "missed", "declined"].includes(call.state);
    if (ended) {
      frames.push({ id: cursor.callId, kind: "close", from: call?.caller ?? humanId, body: null });
      await this.ctx.storage.delete(`ccall:${humanId}`);
    } else {
      await this.ctx.storage.put<CCall>(`ccall:${humanId}`, { ...cursor, seq: newSeq, sawInvite: true });
    }
    return { frames, ended, active: !ended, call_id: cursor.callId };
  }

  // ── views / consent ────────────────────────────────────────────────────
  private agentView(agentId: string) {
    const agent = this.db.getAgent(agentId)!;
    const speaking = this.db.speakingNickname(agentId);
    return {
      agent_id: agentId,
      local_id: agent.local_id ?? null,
      grant_scope_id: agent.grant_scope_id,
      account_id: agent.account_id ?? null,
      display_name: agent.display_name ?? null,
      description: agent.description ?? null,
      public_key: agent.public_key,
      nickname: speaking,
      nicknames: this.db.nicknamesOf(agentId).map(formatNickname),
      speaking_as: speaking,
      kind: agent.kind ?? "agent",
      attached: this.liveSockets(agentId).length > 0 || this.consoleAttached(agentId, agent.kind),
      can_receive_calls: this.callReadyOf(agentId) || this.consoleAttached(agentId, agent.kind),
    };
  }

  /** A console-attached human (recent HTTP activity) counts as one attached,
   *  call-capable instance even though it has no WS socket. */
  private consoleAttached(agentId: string, kind: string | undefined): boolean {
    return kind === "human" && this.db.consoleActive(agentId, Date.now(), CONSOLE_TTL_MS);
  }

  private presenceOf(agentId: string): Presence {
    const kind = this.db.getAgent(agentId)?.kind;
    const consoleOn = this.consoleAttached(agentId, kind);
    const attached = this.liveSockets(agentId).length + (consoleOn ? 1 : 0);
    const nickname = this.db.speakingNickname(agentId);
    return {
      agent_id: agentId,
      // Online only once at least one socket/console has a verified nickname (spec §2.4).
      state: attached > 0 && nickname !== null ? "online" : "offline",
      capabilities: this.callReadyOf(agentId) || consoleOn ? ["sms", "call"] : ["sms"],
      attached_instances: attached,
      nickname,
    };
  }

  /** Contacts of a platform agent: its own account's agents + friends' agents
   *  (allow-all) + legacy agent-pair links. (No autoLink/remotes on the platform.) */
  private contactsOf(agentId: string): string[] {
    const acc = this.db.getAgent(agentId)?.account_id ?? null;
    if (!acc) return this.db.linkedContacts(agentId);
    const accounts = new Set([acc, ...this.db.friendAccountsOf(acc)]);
    const local = this.db
      .listAllAgents()
      .filter((a) => a.agent_id !== agentId && a.account_id != null && accounts.has(a.account_id))
      .map((a) => a.agent_id);
    for (const id of this.db.linkedContacts(agentId)) if (!local.includes(id)) local.push(id);
    return local;
  }

  /** May `a` message `b`? Same account, linked accounts (friendship), or a legacy
   *  agent-pair link (back-compat). */
  private areLinked(a: string, b: string): boolean {
    if (a === b) return true;
    const accA = this.db.getAgent(a)?.account_id ?? null;
    const accB = this.db.getAgent(b)?.account_id ?? null;
    if (accA && accB && (accA === accB || this.db.areAccountsLinked(accA, accB))) return true;
    return this.db.getContact(a, b).state === "linked";
  }

  private claimsView(scope?: string) {
    const rows: Array<{ nickname: string; claimedBy: string | null }> = [];
    for (const agent of this.db.listAllAgents()) {
      if (scope && (agent.account_id ?? "local") !== scope) continue;
      for (const bare of this.db.nicknamesOf(agent.agent_id)) {
        rows.push({ nickname: formatNickname(bare), claimedBy: null });
      }
    }
    return { claims: rows, log: [] as Array<{ text: string }> };
  }

  // ── request plumbing ──────────────────────────────────────────────────
  private async readBody(request: Request): Promise<Record<string, unknown>> {
    try {
      const body = await request.json();
      return (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    } catch {
      return {};
    }
  }

  private requireAccount(request: Request): string | null {
    const header = request.headers.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7) : "";
    return key ? this.db.authenticateAccount(key) : null;
  }

  private rateLimited(request: Request, bucket: string, limit: number, windowMs: number): boolean {
    if (this.env.RATE_LIMIT === "off") return false;
    const ip = request.headers.get("cf-connecting-ip") ?? "local";
    return this.db.rateLimited(`${bucket}:${ip}`, limit, windowMs, Date.now());
  }

  private unauthorized(): Response {
    return this.json(401, { error: "E_AUTH_FAILED" });
  }

  private json(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: {
        "content-type": "application/json",
        "access-control-allow-origin": this.env.CORS_ORIGIN ?? "*",
      },
    });
  }

  // ── WebSocket hibernation ─────────────────────────────────────────────
  private att(ws: WebSocket): SockAtt {
    return (ws.deserializeAttachment() as SockAtt | null) ?? freshAtt();
  }
  private setAtt(ws: WebSocket, att: SockAtt): void {
    ws.serializeAttachment(att);
  }
  /** All authenticated live sockets of an agent (presence derives from these,
   *  never a Map — the Maps don't survive hibernation, plan §5). */
  private liveSockets(agentId: string): WebSocket[] {
    return this.ctx.getWebSockets().filter((ws) => this.att(ws).agentId === agentId);
  }
  private callReadyOf(agentId: string): boolean {
    return this.liveSockets(agentId).some((ws) => this.att(ws).callReady);
  }
  /** The socket among an agent's sockets that owns inbound for a bare nickname. */
  private claimOwner(agentId: string, bare: string): WebSocket | null {
    return this.liveSockets(agentId).find((ws) => this.att(ws).claims.includes(bare)) ?? null;
  }
  /** Claim any of the agent's nicknames not already owned by a live socket. */
  private autoClaim(agentId: string, ws: WebSocket, att: SockAtt): void {
    for (const bare of this.db.nicknamesOf(agentId)) {
      if (!this.claimOwner(agentId, bare) && !att.claims.includes(bare)) att.claims.push(bare);
    }
  }

  private sendFrame(ws: WebSocket, frame: unknown): void {
    try {
      ws.send(JSON.stringify(frame));
    } catch {
      /* socket closing */
    }
  }
  private sendError(ws: WebSocket, code: ErrorCode, message: string, ref?: string): void {
    this.sendFrame(ws, { type: "error", code, message, ...(ref !== undefined ? { ref } : {}) });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    let raw: unknown;
    try {
      raw = JSON.parse(typeof message === "string" ? message : new TextDecoder().decode(message));
    } catch {
      return this.sendError(ws, "E_UNSUPPORTED", "invalid JSON");
    }
    const parsed = controlFrameSchema.safeParse(raw);
    if (!parsed.success) return this.sendError(ws, "E_UNSUPPORTED", "unknown or malformed frame");
    const frame = parsed.data;
    const att = this.att(ws);

    switch (frame.type) {
      case "auth_hello": {
        const agent = this.db.getAgent(frame.agent_id);
        if (!agent) {
          this.sendError(ws, "E_UNKNOWN_AGENT", `unknown agent_id ${frame.agent_id}`);
          return ws.close();
        }
        att.pendingAgentId = frame.agent_id;
        att.pendingNickname = frame.nickname ?? null;
        att.nonce = randomNonceB64url();
        this.setAtt(ws, att);
        return this.sendFrame(ws, { type: "auth_challenge", nonce: att.nonce });
      }

      case "auth_response": {
        const agent = att.pendingAgentId ? this.db.getAgent(att.pendingAgentId) : undefined;
        if (!agent || !att.nonce) {
          this.sendError(ws, "E_AUTH_FAILED", "no authentication in progress");
          return ws.close();
        }
        const verified = await verifyEd25519(
          agent.public_key,
          b64urlToBytes(frame.signature),
          b64urlToBytes(att.nonce),
        );
        att.nonce = null;
        att.pendingAgentId = null;
        if (!verified) {
          this.sendError(ws, "E_AUTH_FAILED", "signature verification failed");
          return ws.close();
        }
        att.agentId = agent.agent_id;
        att.accountId = agent.account_id ?? null;

        // Optional auth_hello nickname: bind it (unique within the hub).
        let claimFailed = false;
        let attempted: string | null = null;
        if (att.pendingNickname) {
          const name = normalizeNickname(att.pendingNickname);
          if (name) {
            attempted = formatNickname(name);
            claimFailed = !this.db.bindNickname(agent.agent_id, name).ok;
          }
        }
        att.pendingNickname = null;

        const linkedNames = this.db.nicknamesOf(agent.agent_id);
        const nicknameStatus = linkedNames.length > 0 ? "verified" : claimFailed ? "conflict" : "none";
        att.nickname = linkedNames.length > 0 ? this.db.speakingNickname(agent.agent_id) : claimFailed ? attempted : null;
        this.autoClaim(agent.agent_id, ws, att);
        this.setAtt(ws, att);

        this.sendFrame(ws, {
          type: "auth_ok",
          presence: this.contactsOf(agent.agent_id).map((id) => this.presenceOf(id)),
          nickname: att.nickname,
          nickname_status: nicknameStatus,
        });
        // Redeliver undelivered (incl. delivered-but-unacked) messages.
        for (const envelope of this.db.undeliveredFor(agent.agent_id)) {
          this.sendFrame(ws, { type: "deliver", envelope });
        }
        return;
      }

      case "send": {
        if (!att.agentId) return this.sendError(ws, "E_AUTH_FAILED", "not authenticated");
        const envelope = frame.envelope;
        if (isReservedMessageType(envelope.type)) {
          return this.sendError(ws, "E_UNSUPPORTED", `message type ${envelope.type} is reserved in v0.1`, envelope.id);
        }
        if (envelope.type !== "sms") {
          return this.sendError(ws, "E_UNSUPPORTED", `clients may not send ${envelope.type}`, envelope.id);
        }
        if (envelope.from !== att.agentId) {
          return this.sendError(ws, "E_IDENTITY_MISMATCH", "envelope.from does not match the authenticated agent", envelope.id);
        }
        const routed = this.routeFromAgent(att.agentId, envelope);
        if (!routed.ok) return this.sendError(ws, routed.code, routed.message, envelope.id);
        return this.sendFrame(ws, { type: "receipt", id: envelope.id, status: routed.status });
      }

      case "ack": {
        if (att.agentId) this.db.markDelivered(frame.id, att.agentId);
        return;
      }

      case "claim": {
        if (!att.agentId) return this.sendError(ws, "E_AUTH_FAILED", "not authenticated");
        const name = normalizeNickname(frame.nickname);
        if (!name || this.db.bindingOf(name)?.agent_id !== att.agentId) {
          return this.sendError(ws, "E_UNKNOWN_AGENT", `nickname ${frame.nickname} is not linked to you`);
        }
        // Last-writer-wins: take the claim from any sibling socket.
        for (const sib of this.liveSockets(att.agentId)) {
          if (sib === ws) continue;
          const sAtt = this.att(sib);
          if (sAtt.claims.includes(name)) {
            sAtt.claims = sAtt.claims.filter((n) => n !== name);
            this.setAtt(sib, sAtt);
          }
        }
        if (!att.claims.includes(name)) att.claims.push(name);
        this.setAtt(ws, att);
        return;
      }

      case "release": {
        if (!att.agentId) return;
        const name = normalizeNickname(frame.nickname);
        if (name && att.claims.includes(name)) {
          att.claims = att.claims.filter((n) => n !== name);
          this.setAtt(ws, att);
        }
        return;
      }

      case "capability": {
        if (att.agentId) {
          att.callReady = frame.call;
          this.setAtt(ws, att);
        }
        return;
      }

      default:
        return this.sendError(ws, "E_UNSUPPORTED", `unexpected frame type ${(frame as { type: string }).type}`);
    }
  }

  async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // Presence updates naturally — the socket leaves getWebSockets(). Undelivered
    // messages stay delivered_at NULL and redeliver on reconnect. Nothing to flush.
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  }
  async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {}

  /** TTL sweep: delete expired attachments (R2 object + row), re-arm for the next. */
  async alarm(): Promise<void> {
    await this.files.sweep(Date.now());
  }

  // ── routing ───────────────────────────────────────────────────────────
  private routeFromAgent(
    fromAgentId: string,
    envelope: Envelope,
  ): { ok: true; status: "delivered" | "queued" } | { ok: false; code: ErrorCode; message: string } {
    const toRef = envelope.to;
    const toId = this.db.resolveAgentId(toRef);
    if (!toId) return { ok: false, code: "E_UNKNOWN_AGENT", message: `unknown agent ${toRef}` };
    if (!this.areLinked(fromAgentId, toId)) return { ok: false, code: "E_NOT_LINKED", message: `not linked to ${toRef}` };
    const toBare = normalizeNickname(toRef);
    const asserted: Envelope = { ...envelope, from: fromAgentId, to: toId };
    const bareForClaim = toBare && this.db.bindingOf(toBare)?.agent_id === toId ? toBare : undefined;
    const delivered = this.deliverTo(toId, asserted, bareForClaim);
    return { ok: true, status: delivered ? "delivered" : "queued" };
  }

  private callOf(envelope: Envelope): { id: string; kind: string } | null {
    const call = (envelope.payload as { call?: { id?: unknown; kind?: unknown } })?.call;
    if (call && typeof call === "object" && typeof call.id === "string" && typeof call.kind === "string") {
      return { id: call.id, kind: call.kind };
    }
    return null;
  }

  /** Capture call sessions + spoken content (calls / call_frames), kept DISTINCT
   *  from `messages` (the firm SMS≠Call rule). Delivery is unchanged — the envelope
   *  still routes to the callee's live socket. */
  private persistCall(envelope: Envelope, toAgentId: string, call: { id: string; kind: string }): void {
    const parsed = Date.parse(envelope.ts);
    const nowMs = Number.isFinite(parsed) ? parsed : Date.now();
    const payload = envelope.payload as { body?: unknown; attachments?: unknown };
    const body = typeof payload.body === "string" ? payload.body : null;
    const attachments = Array.isArray(payload.attachments) && payload.attachments.length ? JSON.stringify(payload.attachments) : null;
    switch (call.kind) {
      case "invite":
        this.db.upsertCallInvite({
          call_id: call.id,
          caller: envelope.from,
          callee: toAgentId,
          caller_nick: this.db.speakingNickname(envelope.from),
          callee_nick: this.db.speakingNickname(toAgentId),
          started_ms: nowMs,
        });
        return;
      case "accept":
        this.db.markCallAnswered(call.id, nowMs);
        return;
      case "frame":
        this.db.insertCallFrame({ frame_id: envelope.id, call_id: call.id, from_agent: envelope.from, body, attachments, created_ms: nowMs });
        // The first spoken frame implies the call was answered (pickup sends no accept).
        if (this.db.getCall(call.id)?.answered_ms == null) this.db.markCallAnswered(call.id, nowMs);
        return;
      case "close":
        this.db.closeCall(call.id, nowMs, "hangup");
        return;
    }
  }

  /** Persist (SMS → messages, or Call → calls/call_frames), then hand to live
   *  sockets. An SMS stays delivered_at NULL until the client acks (or is redelivered). */
  private deliverTo(toAgentId: string, envelope: Envelope, bareForClaim?: string): boolean {
    const call = this.callOf(envelope);
    if (call) {
      this.persistCall(envelope, toAgentId, call);
    } else {
      this.db.insertMessage(envelope, {
        fromNick: this.db.speakingNickname(envelope.from),
        toNick: this.db.speakingNickname(toAgentId),
        accountScope: this.db.getAgent(toAgentId)?.account_id ?? null,
      });
    }
    const sockets = this.liveSockets(toAgentId);
    if (sockets.length === 0) return false;
    let targets = sockets;
    if (bareForClaim) {
      const owner = this.claimOwner(toAgentId, bareForClaim);
      if (owner) targets = [owner];
    }
    for (const ws of targets) this.sendFrame(ws, { type: "deliver", envelope });
    return true;
  }
}
