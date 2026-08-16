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

/** Returns true when semver `a` is strictly less than `b` (major.minor.patch only). */
function semverLt(a: string, b: string): boolean {
  const parse = (s: string): [number, number, number] =>
    (s.split(".").slice(0, 3).map(Number) as [number, number, number]);
  const [aMaj, aMin, aPat] = parse(a);
  const [bMaj, bMin, bPat] = parse(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPat < bPat;
}
import type { Env } from "./env.js";
import { Db, CONNECTOR_SCOPES, type AttachmentRow, type CallRow, type SyncMessage } from "./db.js";
import { FileStoreR2 } from "./files-r2.js";
import { b64urlToBytes, randomHex, randomNonceB64url, verifyEd25519 } from "./crypto.js";
import {
  authServerMetadata,
  consentPageHtml,
  defaultHandle,
  errorPageHtml,
  OAUTH_SCOPES,
  parseForm,
  pkceS256,
  protectedResourceMetadata,
  type ConsentParams,
} from "./oauth.js";

/** The console human's active-call pointer (DO storage, key `ccall:<humanId>`). */
interface CCall {
  callId: string;
  peer: string;
  seq: number; // last call_frames seq surfaced by poll
  sawInvite: boolean; // whether the incoming-invite pseudo-frame was already emitted
}

/** Resolved public-API caller: its acting identity (a connector's bound agent, or
 *  the account's human when authed with the master key) + granted capabilities. */
interface ConnAuth {
  accountId: string;
  agentId: string; // the identity every send/read is signed as
  scope: { send: boolean; read: boolean; files: boolean; full: boolean };
}

/** MCP protocol version we advertise (Streamable HTTP, stateless JSON responses). */
const MCP_PROTOCOL_VERSION = "2025-06-18";
/** Inline base64 file cap for the `share_file` MCP tool — bytes ride through the
 *  model's tool-call args, so keep it small; larger files use POST /v1/files. */
const MCP_FILE_CAP = 1024 * 1024;
/** Decode base64 (tolerating a `data:...;base64,` prefix) to bytes. `atob` is a
 *  Workers global. Throws on malformed input (caught by the caller). */
function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Encode bytes → standard base64 (`btoa` is a Workers global). Only used for
 *  ≤1MB inline file reads (read_file), so the per-char string build is fine. */
function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Whether a mime is human-readable text — so read_file can hand the content
 *  back as a UTF-8 string (usable directly by an LLM) instead of base64. */
function isTextMime(mime: string): boolean {
  const m = mime.toLowerCase();
  return (
    m.startsWith("text/") ||
    m === "application/json" ||
    m === "application/xml" ||
    m === "application/javascript" ||
    m === "application/yaml" ||
    m === "application/x-yaml" ||
    m.includes("markdown") ||
    m.includes("+json") ||
    m.includes("+xml")
  );
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

      // ── public connector API (scoped connector tokens OR the account key) ──
      // Two front doors over one identity + capability core: a remote MCP endpoint
      // (JSON-RPC) and a curl-friendly REST surface. Auth = a bearer connector
      // token bound to a fixed @handle identity (or the master account key).
      if (path === "/mcp") return await this.mcp(request);
      if (path === "/v1" || path.startsWith("/v1/")) return await this.v1(request, url);

      // ── OAuth 2.1 for /mcp (claude.ai / ChatGPT consumer connectors) ──
      // Discovery (RFC 8414/9728), Dynamic Client Registration (RFC 7591), and
      // an authorize/token flow with PKCE. An access token IS a connector token.
      const origin = new URL(request.url).origin;
      if (method === "GET" && path.startsWith("/.well-known/oauth-authorization-server"))
        return this.publicJson(200, authServerMetadata(origin));
      if (method === "GET" && path.startsWith("/.well-known/oauth-protected-resource"))
        return this.publicJson(200, protectedResourceMetadata(origin));
      if (method === "POST" && path === "/oauth/register") return await this.oauthRegister(request);
      if (path === "/oauth/authorize") return await this.oauthAuthorize(request, url);
      if (method === "POST" && path === "/oauth/token") return await this.oauthToken(request);

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
        const humanView = this.agentView(this.humanFor(accountId).agent_id);
        return this.json(200, {
          ...this.db.accountView(accountId)!,
          agents: this.db.accountAgents(accountId).map((a) => this.agentView(a.agent_id, accountId)),
          reservations: this.db.accountReservations(accountId),
          // The user's own @handle + bio (username == handle). The client surfaces
          // this in Settings and filters kind:'human' out of the agent lists.
          human: { nickname: humanView.nickname, description: humanView.description },
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
          // A friend sees only your `listed` agents (their human identity stays
          // listed; owner-only connectors are hidden from friends).
          linked: linked.map((id) => ({
            ...brief(id),
            agents: this.db.accountAgents(id).filter((a) => !!a.listed).map((a) => this.agentView(a.agent_id)),
          })),
          incoming: incoming.map(brief),
          outgoing: outgoing.map(brief),
          // Per-agent open links you've been granted (reach only that agent).
          linked_agents: this.db.accountAgentGrants(accountId).map((id) => this.agentView(id)),
        });
      }
      if (method === "POST" && path === "/accounts/settings") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        if (typeof body.auto_accept === "boolean") this.db.setAutoAccept(accountId, body.auto_accept);
        return this.json(200, { auto_accept: this.db.getAutoAccept(accountId) });
      }

      // ── account profile + password (Settings screen) ──────────────────
      if (method === "POST" && path === "/accounts/profile") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const human = this.humanFor(accountId);
        // Username IS the user's network @handle: a rename atomically rebinds the
        // handle. If the handle is taken (globally, incl. reservations) the WHOLE
        // change is rejected and the username is left intact (username == handle).
        if (typeof body.username === "string") {
          const username = body.username.trim();
          if (!/^[a-z0-9_-]{3,32}$/i.test(username))
            return this.json(400, { error: "username must be 3–32 chars (a–z 0–9 _ -)" });
          const existing = this.db.accountByUsername(username);
          if (existing && existing.account_id !== accountId)
            return this.json(409, { error: "that username is taken" });
          const bound = this.db.bindNickname(human.agent_id, username);
          if (!bound.ok)
            return this.json(bound.reason === "invalid" ? 400 : 409, {
              error:
                bound.reason === "invalid"
                  ? "that username can't be a handle — start with a letter or number"
                  : "that handle is already taken",
            });
          this.db.setUsername(accountId, username);
        }
        // Bio: one field — the public description AND what the owner's own agents
        // see (empty ⇒ they see "your human owner"). Allow "" to clear it.
        if (typeof body.bio === "string") {
          this.db.setAgentProfile(human.agent_id, { description: body.bio });
        }
        const view = this.agentView(human.agent_id);
        return this.json(200, {
          username: this.db.getAccount(accountId)?.username ?? null,
          human: { nickname: view.nickname, description: view.description },
        });
      }
      if (method === "POST" && path === "/accounts/password") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const current = typeof body.current === "string" ? body.current : "";
        const next = typeof body.next === "string" ? body.next : "";
        if (next.length < 6) return this.json(400, { error: "new password must be at least 6 characters" });
        // 403 (not 401) for a wrong current password — a 401 makes the client
        // treat the API key as invalid and sign the user out.
        if (!(await this.db.verifyAccountPassword(accountId, current)))
          return this.json(403, { error: "current password is incorrect" });
        await this.db.setPassword(accountId, next);
        return this.json(200, { ok: true });
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

      // ── connector tokens (public /v1 + /mcp creds; managed with the account key) ──
      // Each connector gets a FIXED @handle identity (a dedicated kind='connector'
      // agent), chosen at mint time. The external AI always signs as that handle,
      // and peers can message it back.
      if (method === "POST" && path === "/accounts/connectors") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const scope = (Array.isArray(body.scope) ? body.scope.map(String) : []).filter((s) =>
          (CONNECTOR_SCOPES as readonly string[]).includes(s),
        );
        if (scope.length === 0) return this.json(400, { error: "scope must include at least one of: send, read, files" });
        const handle = typeof body.handle === "string" ? body.handle.trim() : "";
        if (!handle) return this.json(400, { error: "a handle is required — the connector's @identity" });
        const label = typeof body.label === "string" ? body.label : undefined;
        const res = this.db.createConnector(accountId, { label, scope, handle });
        if (!res.ok) {
          return this.json(res.reason === "invalid" ? 400 : 409, {
            error:
              res.reason === "invalid"
                ? "that handle isn't valid (2–24 chars: a–z 0–9 _ -)"
                : "that handle is already taken",
          });
        }
        // Pair every dashboard-minted connector with an OAuth client_id + secret
        // so headless/browserless agents can use the client_credentials grant
        // (copy id+secret, no redirect) instead of the bearer token directly.
        const creds = this.db.mintConnectorClient(accountId, res.agent_id, label);
        const origin = new URL(request.url).origin;
        return this.json(200, {
          token: res.token,
          handle: res.handle,
          agent_id: res.agent_id,
          scope,
          label: label ?? null,
          client_id: creds?.client_id ?? null,
          client_secret: creds?.client_secret ?? null,
          token_endpoint: `${origin}/oauth/token`,
          mcp_url: `${origin}/mcp`,
        });
      }
      if (method === "GET" && path === "/accounts/connectors") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        return this.json(200, { connectors: this.db.listConnectorTokens(accountId) });
      }
      if (method === "POST" && path === "/accounts/connectors/revoke") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const ref = typeof body.agent_id === "string" ? { agentId: body.agent_id } : { token: String(body.token ?? "") };
        return this.json(200, { ok: this.db.revokeConnector(accountId, ref) });
      }
      // Rotate a connector's bearer token (and paired OAuth secret) in place —
      // same @handle identity, fresh creds. Returns the new token/secret once.
      if (method === "POST" && path === "/accounts/connectors/rotate") {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const body = await this.readBody(request);
        const agentId = typeof body.agent_id === "string" ? body.agent_id : "";
        const rot = agentId ? this.db.rotateConnector(accountId, agentId) : null;
        if (!rot) return this.json(404, { ok: false, error: "not your connector" });
        const origin = new URL(request.url).origin;
        return this.json(200, {
          ok: true,
          token: rot.token,
          client_id: rot.client_id ?? null,
          client_secret: rot.client_secret ?? null,
          token_endpoint: `${origin}/oauth/token`,
        });
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

      // ── owner-scoped agent settings (Agent page) ──────────────────────
      // Bearer + ownership-checked (unlike the legacy /agents/:id/* below).
      const ownedNick = path.match(/^\/accounts\/agents\/([^/]+)\/nickname$/);
      if (method === "POST" && ownedNick) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const agentId = decodeURIComponent(ownedNick[1]!);
        const agent = this.db.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return this.json(404, { ok: false, reason: "invalid", error: "not your agent" });
        const body = await this.readBody(request);
        if (typeof body.nickname !== "string") return this.json(400, { ok: false, reason: "invalid" });
        // bindNickname is reservation-aware: your OWN reserved handle is consumed
        // on bind; another account's bound/reserved handle → conflict.
        return this.json(200, this.db.bindNickname(agentId, body.nickname));
      }
      const ownedSettings = path.match(/^\/accounts\/agents\/([^/]+)\/settings$/);
      if (method === "POST" && ownedSettings) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const agentId = decodeURIComponent(ownedSettings[1]!);
        const agent = this.db.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return this.json(404, { ok: false, error: "not your agent" });
        const body = await this.readBody(request);
        if (typeof body.bio === "string") this.db.setAgentProfile(agentId, { description: body.bio });
        if (typeof body.open_link === "boolean") this.db.setOpenLink(agentId, body.open_link);
        if (typeof body.listed === "boolean") this.db.setListed(agentId, body.listed);
        return this.json(200, { ok: true, agent: this.agentView(agentId) });
      }

      // ── owner-scoped per-agent contact book ───────────────────────────
      // Curate an agent's list_contacts (the mechanism connectors need — no local
      // runtime, so their book lives on the platform). GET returns the book + the
      // reachable candidates to add from; POST adds; /remove drops.
      const bookRoute = path.match(/^\/accounts\/agents\/([^/]+)\/book$/);
      if (bookRoute) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const agentId = decodeURIComponent(bookRoute[1]!);
        const agent = this.db.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return this.json(404, { ok: false, error: "not your agent" });
        const shape = (id: string) => {
          const p = this.presenceOf(id);
          return {
            agent_id: id,
            handle: p.nickname, // already @-prefixed (speakingNickname → formatNickname)
            description: this.db.getAgent(id)?.description ?? null,
            online: p.state === "online",
          };
        };
        if (method === "GET") {
          const bookIds: string[] = [];
          for (const h of this.db.agentBook(agentId)) {
            const id = this.db.resolveAgentId(h);
            if (id && id !== agentId && !bookIds.includes(id)) bookIds.push(id);
          }
          const bookSet = new Set(bookIds);
          const bookable = this.derivedContactsOf(agentId).filter((id) => !bookSet.has(id));
          return this.json(200, { book: bookIds.map(shape), bookable: bookable.map(shape) });
        }
        if (method === "POST") {
          const body = await this.readBody(request);
          const handle = String(body.handle ?? "");
          const targetId = this.db.resolveAgentId(handle);
          if (!targetId) return this.json(404, { ok: false, error: "E_UNKNOWN_AGENT" });
          if (targetId === agentId) return this.json(400, { ok: false, error: "an agent can't book itself" });
          if (!this.areLinked(agentId, targetId))
            return this.json(403, { ok: false, error: "not reachable — you can only book contacts this agent can reach" });
          this.db.addToBook(agentId, handle);
          return this.json(200, { ok: true });
        }
      }
      const bookRemoveRoute = path.match(/^\/accounts\/agents\/([^/]+)\/book\/remove$/);
      if (method === "POST" && bookRemoveRoute) {
        const accountId = this.requireAccount(request);
        if (!accountId) return this.unauthorized();
        const agentId = decodeURIComponent(bookRemoveRoute[1]!);
        const agent = this.db.getAgent(agentId);
        if (!agent || agent.account_id !== accountId) return this.json(404, { ok: false, error: "not your agent" });
        const body = await this.readBody(request);
        this.db.removeFromBook(agentId, String(body.handle ?? ""));
        return this.json(200, { ok: true });
      }

      // ── human console (virtual HTTP client over the DB) ───────────────
      if (path.startsWith("/console")) return await this.console(request, url);

      // ── registration (account OPTIONAL) ───────────────────────────────
      if (method === "POST" && path === "/register") return await this.register(request);

      // ── agents ────────────────────────────────────────────────────────
      if (method === "GET" && path === "/agents") {
        // Public discovery: only `listed` agents (owner-only connectors excluded).
        return this.json(200, {
          agents: this.db.listAllAgents().filter((a) => !!a.listed).map((a) => this.agentView(a.agent_id)),
        });
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
    if (!targetAgentId || !targetAccount) return this.json(404, { error: "E_UNKNOWN_AGENT" });
    if (targetAccount === accountId) return this.json(200, { state: "self" });
    // Per-agent open link: if the targeted agent accepts external links and the
    // accounts aren't already friends, auto-grant reachability to THAT agent only
    // (the rest of the owner's account stays private) — no account friendship.
    if (!this.db.areAccountsLinked(accountId, targetAccount) && this.db.isOpenLink(targetAgentId)) {
      this.db.grantAgent(targetAgentId, accountId);
      return this.json(200, { state: "linked_agent", agent: this.agentView(targetAgentId) });
    }
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

  // ── public connector API: auth + capability core ──────────────────────
  /** Resolve the bearer to a public-API caller. A connector token → its bound
   *  @handle identity + declared scope; the master account key → the account's
   *  human identity + full scope (handy for the dashboard/testing). */
  private resolveAuth(request: Request): ConnAuth | null {
    const header = request.headers.get("authorization") ?? "";
    const key = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!key) return null;
    const acct = this.db.authenticateAccount(key);
    if (acct) {
      return { accountId: acct, agentId: this.humanFor(acct).agent_id, scope: { send: true, read: true, files: true, full: true } };
    }
    const conn = this.db.authenticateConnector(key);
    if (conn) {
      const s = conn.scope.split(",");
      return {
        accountId: conn.account_id,
        agentId: conn.agent_id,
        scope: { send: s.includes("send"), read: s.includes("read"), files: s.includes("files"), full: false },
      };
    }
    return null;
  }

  private forbiddenScope(scope: string): Response {
    return this.json(403, { error: "insufficient_scope", message: `this token lacks the '${scope}' scope` });
  }

  /** whoami: the caller's FIXED identity (@handle) + the handles available in the
   *  account's profile (so a host knows who else it can reach). Touches presence. */
  private connIdentity(auth: ConnAuth) {
    this.db.consoleTouch(auth.agentId, Date.now());
    const view = this.agentView(auth.agentId);
    return {
      agent_id: auth.agentId,
      handle: view.nickname,
      display_name: view.display_name,
      description: view.description,
      account_id: auth.accountId,
      scope: (["send", "read", "files"] as const).filter((k) => auth.scope[k]),
      // Handles available in your profile — every agent identity on this account.
      profile_handles: this.db
        .accountAgents(auth.accountId)
        .map((a) => ({ handle: this.db.speakingNickname(a.agent_id), kind: a.kind ?? "agent", display_name: a.display_name ?? null }))
        .filter((a) => a.handle),
      reserved_handles: this.db.accountReservations(auth.accountId),
    };
  }

  private connContacts(auth: ConnAuth) {
    return this.contactsOf(auth.agentId).map((id) => {
      const presence = this.presenceOf(id);
      const agent = this.db.getAgent(id);
      return { agent_id: id, handle: presence.nickname, display_name: agent?.display_name ?? null, kind: agent?.kind ?? "agent", presence };
    });
  }

  /** Send an SMS signed as the caller's fixed identity. Reuses the same router as
   *  the human console — reach = same account + friends' agents. */
  private connSend(auth: ConnAuth, to: string, body: string, attachments?: unknown[]) {
    this.db.consoleTouch(auth.agentId, Date.now());
    const atts = Array.isArray(attachments) && attachments.length ? { attachments } : {};
    return this.routeFromAgent(auth.agentId, this.mkEnvelope(auth.agentId, to, { body, ...atts }));
  }

  /** Non-destructive read of the caller identity's messages (does NOT mark
   *  delivered — the dashboard "view as agent" still sees history). */
  private connMessages(auth: ConnAuth, sinceMs: number) {
    this.db.consoleTouch(auth.agentId, Date.now());
    return this.db.messagesForScope([auth.agentId], sinceMs);
  }

  // ── public REST surface (/v1/*) ────────────────────────────────────────
  private async v1(request: Request, url: URL): Promise<Response> {
    const auth = this.resolveAuth(request);
    if (!auth) return this.unauthorized();
    const path = url.pathname;
    const method = request.method;

    if (method === "GET" && path === "/v1/whoami") return this.json(200, this.connIdentity(auth));
    if (method === "GET" && path === "/v1/contacts") return this.json(200, { contacts: this.connContacts(auth) });
    if (method === "POST" && path === "/v1/messages") {
      if (!auth.scope.send) return this.forbiddenScope("send");
      if (this.rateLimited(request, "v1send", 120, 60_000)) return this.json(429, { error: "too many messages — slow down" });
      const body = await this.readBody(request);
      const to = typeof body.to === "string" ? body.to : "";
      const text = typeof body.body === "string" ? body.body : "";
      if (!to) return this.json(400, { error: "'to' (@handle or agent id) is required" });
      const res = this.connSend(auth, to, text, Array.isArray(body.attachments) ? body.attachments : undefined);
      return res.ok
        ? this.json(200, { status: res.status, from: this.db.speakingNickname(auth.agentId) })
        : this.json(400, { error: res.code, message: res.message });
    }
    if (method === "GET" && path === "/v1/messages") {
      if (!auth.scope.read) return this.forbiddenScope("read");
      const sinceRaw = url.searchParams.get("since");
      const since = sinceRaw && Number.isFinite(Number(sinceRaw)) ? Number(sinceRaw) : 0;
      return this.json(200, { messages: this.connMessages(auth, since), now: Date.now() });
    }
    if (method === "POST" && path === "/v1/files") {
      if (!auth.scope.files) return this.forbiddenScope("files");
      return await this.v1UploadFile(request, url, auth);
    }
    const fileGet = path.match(/^\/v1\/files\/([^/]+)$/);
    if (method === "GET" && fileGet) {
      if (!auth.scope.files) return this.forbiddenScope("files");
      return await this.v1DownloadFile(decodeURIComponent(fileGet[1]!), auth);
    }
    return this.json(404, { error: "unknown /v1 route" });
  }

  private async v1UploadFile(request: Request, url: URL, auth: ConnAuth): Promise<Response> {
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (declared > this.files.maxFileBytes) return this.json(413, { error: `file exceeds the ${this.files.maxFileBytes}-byte limit` });
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > this.files.maxFileBytes) return this.json(413, { error: `file exceeds the ${this.files.maxFileBytes}-byte limit` });
    const q = url.searchParams;
    const name = (q.get("name") ? decodeURIComponent(q.get("name")!) : "file") || "file";
    const mime = q.get("mime") ?? "application/octet-stream";
    const to = q.get("to");
    const result = await this.files.put(bytes, { name, mime, owner: auth.agentId, to, account_id: auth.accountId }, Date.now());
    if (!result.ok) return this.json(400, { error: result.error });
    return this.json(200, { file_id: result.file.file_id, name, mime, size: result.file.size });
  }

  private async v1DownloadFile(fileId: string, auth: ConnAuth): Promise<Response> {
    const entry = await this.files.get(fileId, Date.now());
    if (!entry) return this.json(404, { error: "file not found or expired" });
    if (!this.fileAccessible(entry.meta, auth.accountId)) return this.json(403, { error: "forbidden" });
    return new Response(entry.body, {
      status: 200,
      headers: {
        "content-type": entry.meta.mime || "application/octet-stream",
        "content-length": String(entry.meta.size),
        "x-hauddy-filename": encodeURIComponent(entry.meta.name),
        "access-control-allow-origin": this.env.CORS_ORIGIN ?? "*",
      },
    });
  }

  // ── remote MCP endpoint (/mcp) — Streamable HTTP, stateless JSON-RPC ────
  private async mcp(request: Request): Promise<Response> {
    if (request.method !== "POST") return this.json(405, { error: "POST a JSON-RPC message to /mcp" });
    const auth = this.resolveAuth(request);
    if (!auth) {
      // Point unauthenticated clients at our OAuth protected-resource metadata so
      // MCP hosts (claude.ai, ChatGPT) can discover the authorization server.
      const origin = new URL(request.url).origin;
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "unauthorized" } }), {
        status: 401,
        headers: {
          "content-type": "application/json",
          "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
          "access-control-allow-origin": "*",
        },
      });
    }
    const body = await this.readBody(request);
    const rpcMethod = typeof body.method === "string" ? body.method : "";
    const id = "id" in body ? (body.id as string | number | null) : null;
    const params = (body.params ?? {}) as Record<string, unknown>;
    // JSON-RPC notifications (e.g. notifications/initialized) get no response body.
    if (rpcMethod.startsWith("notifications/")) {
      return new Response(null, { status: 202, headers: { "access-control-allow-origin": this.env.CORS_ORIGIN ?? "*" } });
    }
    // Streamable HTTP: when the client accepts text/event-stream (ChatGPT and
    // claude.ai both send `Accept: application/json, text/event-stream`), reply
    // with the JSON-RPC response as a single SSE event. ChatGPT's client reads
    // tool-call replies as a stream and errors ("Error in message stream") on a
    // plain application/json body — then tears down + re-runs OAuth, minting a
    // fresh @handle each retry. SSE-framing the same payload fixes it; curl/tests
    // (no such Accept) still get application/json. Spec allows either.
    const wantsSSE = (request.headers.get("accept") ?? "").includes("text/event-stream");
    let res: Response;
    switch (rpcMethod) {
      case "initialize":
        res = this.mcpResult(id, {
          protocolVersion: typeof params.protocolVersion === "string" ? params.protocolVersion : MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: "hauddy", version: "0.1.0" },
          instructions:
            "Hauddy lets you message the user's AI agents. You are signed in as a fixed @handle (call whoami to see it). Use send_sms to reach an agent, check_messages to read replies.",
        });
        break;
      case "ping":
        res = this.mcpResult(id, {});
        break;
      case "tools/list":
        res = this.mcpResult(id, { tools: this.mcpTools(auth.scope) });
        break;
      case "tools/call":
        res = await this.mcpCall(id, auth, params);
        break;
      default:
        res = this.mcpError(id, -32601, `method not found: ${rpcMethod}`);
    }
    return wantsSSE ? await this.asSSE(res) : res;
  }

  /** Re-frame an application/json JSON-RPC Response as a one-shot SSE stream: one
   *  `event: message` carrying the same payload, then the stream closes (a
   *  finite body ends the connection). Mirrors the MCP SDK's Streamable HTTP
   *  server framing so hosts that read POST replies as a stream (ChatGPT) work. */
  private async asSSE(res: Response): Promise<Response> {
    const text = await res.text();
    return new Response(`event: message\ndata: ${text}\n\n`, {
      status: res.status,
      headers: {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        "access-control-allow-origin": this.env.CORS_ORIGIN ?? "*",
      },
    });
  }

  private mcpTools(scope: ConnAuth["scope"]): Array<Record<string, unknown>> {
    const tools: Array<Record<string, unknown>> = [
      { name: "whoami", description: "Show your fixed Hauddy identity (@handle) and the handles available in this account. Call this first.", inputSchema: { type: "object", properties: {} } },
      { name: "list_contacts", description: "List the agents you can message, with presence.", inputSchema: { type: "object", properties: {} } },
    ];
    if (scope.send)
      tools.push({
        name: "send_sms",
        description: "Send an async message to an agent by @handle (or agent id). You always send as your own fixed @handle, so the recipient can reply to you.",
        inputSchema: {
          type: "object",
          properties: {
            to: { type: "string", description: "recipient @handle or agent id" },
            body: { type: "string", description: "message text" },
            attachments: { type: "array", items: { type: "object" }, description: "optional file refs returned by share_file" },
          },
          required: ["to", "body"],
        },
      });
    if (scope.read)
      tools.push({
        name: "check_messages",
        description: "Return recent messages involving your @handle (replies others sent you, plus your own). Pass `since` (the `now` value from a prior call) to get only newer ones. Non-destructive.",
        inputSchema: { type: "object", properties: { since: { type: "number", description: "epoch ms; only messages after this" } } },
      });
    if (scope.files) {
      tools.push({
        name: "share_file",
        description: "Upload a small file (≤1MB, base64-encoded) and optionally send it to an agent. Returns a file reference usable in send_sms `attachments`.",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string" },
            mime: { type: "string" },
            content_base64: { type: "string", description: "the file bytes, base64-encoded (≤1MB)" },
            to: { type: "string", description: "optional @handle to send it to immediately" },
            body: { type: "string", description: "optional message text when `to` is set" },
          },
          required: ["name", "content_base64"],
        },
      });
      tools.push({
        name: "read_file",
        description:
          "Download the content of a file that was sent to you. Pass the `file_id` from a check_messages attachment. Text files (markdown, json, plain text…) come back in `content`; anything else in `content_base64`. Files ≤1MB only — larger ones must be fetched via GET /v1/files/:id.",
        inputSchema: {
          type: "object",
          properties: {
            file_id: { type: "string", description: "the file_id from a check_messages attachment ref" },
          },
          required: ["file_id"],
        },
      });
    }
    return tools;
  }

  private async mcpCall(id: string | number | null, auth: ConnAuth, params: Record<string, unknown>): Promise<Response> {
    const name = typeof params.name === "string" ? params.name : "";
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    try {
      switch (name) {
        case "whoami":
          return this.mcpToolOk(id, this.connIdentity(auth));
        case "list_contacts":
          return this.mcpToolOk(id, { contacts: this.connContacts(auth) });
        case "send_sms": {
          if (!auth.scope.send) return this.mcpToolErr(id, "this token lacks the 'send' scope");
          const to = typeof args.to === "string" ? args.to : "";
          const text = typeof args.body === "string" ? args.body : "";
          if (!to || !text) return this.mcpToolErr(id, "'to' and 'body' are required");
          const res = this.connSend(auth, to, text, Array.isArray(args.attachments) ? args.attachments : undefined);
          return res.ok ? this.mcpToolOk(id, { status: res.status, from: this.db.speakingNickname(auth.agentId) }) : this.mcpToolErr(id, res.message);
        }
        case "check_messages": {
          if (!auth.scope.read) return this.mcpToolErr(id, "this token lacks the 'read' scope");
          const since = Number(args.since);
          return this.mcpToolOk(id, { messages: this.connMessages(auth, Number.isFinite(since) ? since : 0), now: Date.now() });
        }
        case "share_file": {
          if (!auth.scope.files) return this.mcpToolErr(id, "this token lacks the 'files' scope");
          const fname = typeof args.name === "string" ? args.name : "file";
          const mime = typeof args.mime === "string" ? args.mime : "application/octet-stream";
          let bytes: Uint8Array;
          try {
            bytes = base64ToBytes(typeof args.content_base64 === "string" ? args.content_base64 : "");
          } catch {
            return this.mcpToolErr(id, "content_base64 is not valid base64");
          }
          if (bytes.byteLength === 0) return this.mcpToolErr(id, "empty file");
          if (bytes.byteLength > MCP_FILE_CAP)
            return this.mcpToolErr(id, `file exceeds the ${MCP_FILE_CAP}-byte (1MB) inline limit — use POST /v1/files for larger files`);
          const to = typeof args.to === "string" ? args.to : null;
          const put = await this.files.put(bytes.buffer as ArrayBuffer, { name: fname, mime, owner: auth.agentId, to, account_id: auth.accountId }, Date.now());
          if (!put.ok) return this.mcpToolErr(id, put.error);
          const ref = { file_id: put.file.file_id, name: fname, mime, size: put.file.size };
          if (to) {
            const res = this.connSend(auth, to, typeof args.body === "string" ? args.body : "", [ref]);
            if (!res.ok) return this.mcpToolErr(id, res.message);
            return this.mcpToolOk(id, { status: res.status, sent_to: to, file: ref });
          }
          return this.mcpToolOk(id, { file: ref, note: "pass this in send_sms `attachments` to deliver it" });
        }
        case "read_file": {
          if (!auth.scope.files) return this.mcpToolErr(id, "this token lacks the 'files' scope");
          const fileId = typeof args.file_id === "string" ? args.file_id : "";
          if (!fileId) return this.mcpToolErr(id, "'file_id' is required (from a check_messages attachment)");
          const entry = await this.files.get(fileId, Date.now());
          if (!entry) return this.mcpToolErr(id, "file not found or expired");
          if (!this.fileAccessible(entry.meta, auth.accountId)) return this.mcpToolErr(id, "you don't have access to that file");
          if (entry.meta.size > MCP_FILE_CAP)
            return this.mcpToolErr(id, `file is ${entry.meta.size} bytes — over the ${MCP_FILE_CAP}-byte (1MB) inline limit; download it via GET /v1/files/${fileId}`);
          const buf = new Uint8Array(await new Response(entry.body).arrayBuffer());
          const mime = entry.meta.mime || "application/octet-stream";
          const meta = { file_id: fileId, name: entry.meta.name, mime, size: entry.meta.size };
          return this.mcpToolOk(
            id,
            isTextMime(mime) ? { ...meta, content: new TextDecoder().decode(buf) } : { ...meta, content_base64: bytesToBase64(buf) },
          );
        }
        default:
          return this.mcpError(id, -32602, `unknown tool: ${name}`);
      }
    } catch (e) {
      return this.mcpToolErr(id, e instanceof Error ? e.message : String(e));
    }
  }

  private mcpResult(id: string | number | null, result: unknown): Response {
    return this.json(200, { jsonrpc: "2.0", id: id ?? null, result });
  }
  private mcpError(id: string | number | null, code: number, message: string): Response {
    return this.json(200, { jsonrpc: "2.0", id: id ?? null, error: { code, message } });
  }
  private mcpToolOk(id: string | number | null, obj: unknown): Response {
    return this.mcpResult(id, { content: [{ type: "text", text: JSON.stringify(obj) }] });
  }
  private mcpToolErr(id: string | number | null, message: string): Response {
    return this.mcpResult(id, { content: [{ type: "text", text: message }], isError: true });
  }

  // ── OAuth 2.1 authorization server (fronts /mcp for consumer connectors) ──
  /** Public JSON (CORS `*`) for the unauthenticated OAuth discovery/token endpoints. */
  private publicJson(status: number, body: unknown): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" },
    });
  }
  private html(status: number, body: string): Response {
    return new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  /** RFC 7591 Dynamic Client Registration — a public (PKCE) client, no secret. */
  private async oauthRegister(request: Request): Promise<Response> {
    const body = await this.readBody(request);
    const redirect_uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (redirect_uris.length === 0) return this.publicJson(400, { error: "invalid_client_metadata", error_description: "redirect_uris is required" });
    const client_name = typeof body.client_name === "string" ? body.client_name : undefined;
    const client_id = this.db.createOAuthClient({ client_name, redirect_uris });
    return this.publicJson(201, {
      client_id,
      client_name: client_name ?? null,
      redirect_uris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
    });
  }

  private readAuthParams(getv: (k: string) => string | null): ConsentParams {
    return {
      client_id: getv("client_id") ?? "",
      redirect_uri: getv("redirect_uri") ?? "",
      state: getv("state") ?? "",
      code_challenge: getv("code_challenge") ?? "",
      code_challenge_method: getv("code_challenge_method") ?? "",
      response_type: getv("response_type") ?? "",
      resource: getv("resource") ?? "",
      scope: getv("scope") ?? "",
    };
  }

  /** Validate the client + redirect_uri + PKCE before we ever show the form or
   *  issue a code. Returns an error string (→ error page) or null if OK. */
  private validateAuthParams(p: ConsentParams): string | null {
    if (p.response_type !== "code") return "Unsupported response_type (only 'code' is supported).";
    if (!p.client_id) return "Missing client_id.";
    const client = this.db.getOAuthClient(p.client_id);
    if (!client) return "Unknown client_id — this app isn't registered.";
    if (!p.redirect_uri || !client.redirect_uris.includes(p.redirect_uri)) return "redirect_uri doesn't match the registered client.";
    if (!p.code_challenge || p.code_challenge_method !== "S256") return "PKCE is required (code_challenge_method=S256).";
    return null;
  }

  /** GET → the sign-in + consent page; POST → verify login, mint the connector
   *  identity, issue a one-time authorization code, and redirect back. */
  private async oauthAuthorize(request: Request, url: URL): Promise<Response> {
    if (request.method === "GET") {
      const q = url.searchParams;
      const params = this.readAuthParams((k) => q.get(k));
      const err = this.validateAuthParams(params);
      if (err) return this.html(400, errorPageHtml(err));
      const client = this.db.getOAuthClient(params.client_id)!;
      return this.html(200, consentPageHtml({ clientName: client.client_name || "an application", params, handleDefault: defaultHandle(client.client_name) }));
    }
    if (request.method === "POST") {
      if (this.rateLimited(request, "login", 10, 15 * 60 * 1000)) return this.html(429, errorPageHtml("Too many attempts — try again in a few minutes."));
      const form = parseForm(await request.text());
      const params = this.readAuthParams((k) => form[k] ?? null);
      const err = this.validateAuthParams(params);
      if (err) return this.html(400, errorPageHtml(err));
      const client = this.db.getOAuthClient(params.client_id)!;
      const clientName = client.client_name || "an application";
      const rerender = (msg: string) =>
        this.html(200, consentPageHtml({ clientName, params, error: msg, handleDefault: (form.handle ?? "").trim() || defaultHandle(client.client_name), login: form.login ?? "" }));
      const accountId = form.login && form.password ? await this.db.verifyLogin(form.login.trim(), form.password) : null;
      if (!accountId) return rerender("Wrong username/email or password.");
      const scope = OAUTH_SCOPES.filter((s) => form[`scope_${s}`] === "on");
      if (scope.length === 0) return rerender("Pick at least one capability to allow.");
      const handle = (form.handle ?? "").trim();
      if (!handle) return rerender("Choose a handle for this connector.");
      // reclaim: re-onboarding a client (it can't revoke server-side on disconnect)
      // takes back its own stale @handle instead of being blocked as "taken".
      const conn = this.db.createConnector(accountId, { label: clientName, scope: [...scope], handle, reclaim: true });
      if (!conn.ok) return rerender(conn.reason === "invalid" ? "That handle isn't valid (2–24 chars: a–z 0–9 _ -)." : "That handle is already taken — pick another.");
      const code = `oac_${randomHex(24)}`;
      await this.ctx.storage.put(`oauthcode:${code}`, {
        client_id: params.client_id,
        redirect_uri: params.redirect_uri,
        code_challenge: params.code_challenge,
        token: conn.token,
        scope: scope.join(","),
        expires_ms: Date.now() + 10 * 60 * 1000,
      });
      const sep = params.redirect_uri.includes("?") ? "&" : "?";
      const loc = `${params.redirect_uri}${sep}code=${encodeURIComponent(code)}${params.state ? `&state=${encodeURIComponent(params.state)}` : ""}`;
      return new Response(null, { status: 302, headers: { location: loc } });
    }
    return this.json(405, { error: "method not allowed" });
  }

  /** Exchange a one-time code (+ PKCE verifier) for the access token — which is
   *  the connector token minted at consent. Single-use, 10-minute TTL. */
  private async oauthToken(request: Request): Promise<Response> {
    const authz = request.headers.get("authorization") ?? "";
    const form = parseForm(await request.text());
    // Headless connectors: client_id + client_secret → the connector's bearer
    // token. Creds come via HTTP Basic (client_secret_basic) or the body
    // (client_secret_post); Basic wins when both are present (RFC 6749 §2.3.1).
    if (form.grant_type === "client_credentials") {
      let clientId = form.client_id ?? "";
      let clientSecret = form.client_secret ?? "";
      if (authz.startsWith("Basic ")) {
        try {
          const decoded = atob(authz.slice(6).trim());
          const i = decoded.indexOf(":");
          if (i >= 0) {
            clientId = decoded.slice(0, i);
            clientSecret = decoded.slice(i + 1);
          }
        } catch {
          /* malformed header — fall back to any body creds */
        }
      }
      if (!clientId || !clientSecret) return this.oauthTokenError("invalid_client", "client_id and client_secret are required");
      const grant = this.db.authenticateClientCredentials(clientId, clientSecret);
      if (!grant) return this.oauthTokenError("invalid_client", "unknown client, wrong secret, or the connector was revoked");
      return this.publicJson(200, { access_token: grant.token, token_type: "Bearer", scope: grant.scope, expires_in: 31536000 });
    }
    if (form.grant_type !== "authorization_code") return this.oauthTokenError("unsupported_grant_type");
    const code = form.code ?? "";
    const key = `oauthcode:${code}`;
    const rec = await this.ctx.storage.get<{ client_id: string; redirect_uri: string; code_challenge: string; token: string; scope: string; expires_ms: number }>(key);
    if (!rec) return this.oauthTokenError("invalid_grant", "unknown or already-used code");
    await this.ctx.storage.delete(key); // single-use
    if (Date.now() > rec.expires_ms) return this.oauthTokenError("invalid_grant", "code expired");
    if (form.client_id && form.client_id !== rec.client_id) return this.oauthTokenError("invalid_grant", "client_id mismatch");
    if ((form.redirect_uri ?? "") !== rec.redirect_uri) return this.oauthTokenError("invalid_grant", "redirect_uri mismatch");
    const verifier = form.code_verifier ?? "";
    if (!verifier || (await pkceS256(verifier)) !== rec.code_challenge) return this.oauthTokenError("invalid_grant", "PKCE verification failed");
    return this.publicJson(200, { access_token: rec.token, token_type: "Bearer", scope: rec.scope, expires_in: 31536000 });
  }
  private oauthTokenError(error: string, description?: string): Response {
    return this.publicJson(400, { error, ...(description ? { error_description: description } : {}) });
  }

  // ── human console (virtual HTTP client, spec §"human messaging") ───────
  private mkEnvelope(from: string, to: string, payload: Record<string, unknown>): Envelope {
    return { v: PROTOCOL_VERSION, id: mintMessageId(), type: "sms", from, to, ts: nowIso(), payload, sig: null };
  }

  /** The account's human identity, ensured to exist with the username as its
   *  initial @handle (username == handle). The nick is only bound on first
   *  creation; renames go through /accounts/profile. Falls back to the email
   *  prefix for any legacy account whose username can't form a handle. */
  private humanFor(accountId: string) {
    const acct = this.db.getAccount(accountId);
    const nick =
      slugifyNickname(acct?.username ?? "") ?? slugifyNickname(acct?.email.split("@")[0] ?? "") ?? undefined;
    return this.db.ensureHumanAgent(accountId, nick);
  }

  /** Resolve (+ mark attached) the account's human identity. Platform-only: Bearer. */
  private consoleHuman(request: Request): { agent_id: string } | null {
    const accountId = this.requireAccount(request);
    if (!accountId) return null;
    const human = this.humanFor(accountId);
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
    if (method === "GET" && path === "/console/dashboard") {
      const accountId = this.requireAccount(request);
      const threads = this.db.consoleThreads(humanId).map((t) => ({
        peer: t.peer,
        peer_nick: t.peer_nick,
        unread: Boolean(t.unread),
        last_body: t.last_body,
        last_ts: t.last_ts,
      }));
      const calls = this.db.consoleCalls(humanId).map((c) => ({
        call_id: c.call_id,
        peer: c.peer,
        peer_nick: c.peer_nick,
        dir: c.dir,
        state: c.state,
        started_at: c.started_at,
        ended_at: c.ended_at,
        end_reason: c.end_reason,
      }));
      const friendRequests = accountId ? this.db.listFriendships(accountId).incoming.length : 0;
      const seen = (await this.ctx.storage.get<number>(`notifseen:${humanId}`)) ?? 0;
      const notifications = {
        friend_requests: friendRequests,
        unread_messages: this.db.unreadMessageCount(humanId),
        missed_calls: this.db.missedCallCount(humanId, seen),
      };
      return this.json(200, { threads, calls, notifications });
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
  /** `owningAccountId` (the caller's own account, when this is one of THEIR agents)
   *  unlocks owner-only fields — currently the connector's masked token + scope +
   *  paired OAuth client_id for the Agent page's access section. Omitted for
   *  friend/public views so we never leak a peer's credentials. */
  private agentView(agentId: string, owningAccountId?: string) {
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
      open_link: !!agent.open_link, // per-agent external auto-accept
      listed: !!agent.listed, // discoverable by other accounts (connectors default off)
      external_links: agent.open_link ? this.db.agentGranteesFor(agentId).length : 0,
      attached: this.liveSockets(agentId).length > 0 || this.consoleAttached(agentId, agent.kind),
      can_receive_calls: this.callReadyOf(agentId) || this.consoleAttached(agentId, agent.kind),
      // Owner-only: the connector bearer/OAuth creds behind a kind='connector' agent.
      connector:
        owningAccountId && agent.kind === "connector"
          ? this.db.connectorForAgent(owningAccountId, agentId)
          : undefined,
    };
  }

  /** A console-attached human OR connector (recent HTTP activity) counts as one
   *  attached instance even though it has no WS socket — so peers see it online
   *  and can message it. */
  private consoleAttached(agentId: string, kind: string | undefined): boolean {
    return (kind === "human" || kind === "connector") && this.db.consoleActive(agentId, Date.now(), CONSOLE_TTL_MS);
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

  /** Contacts of a platform agent. A non-empty curated book IS the list (resolved
   *  handles), mirroring the local hub — the mechanism connectors use. Otherwise
   *  the derived set below. Visibility only; `areLinked` still gates sends. */
  private contactsOf(agentId: string): string[] {
    const book = this.db.agentBook(agentId);
    if (book.length) {
      const ids: string[] = [];
      for (const h of book) {
        const id = this.db.resolveAgentId(h);
        if (id && id !== agentId && !ids.includes(id)) ids.push(id);
      }
      return ids;
    }
    return this.derivedContactsOf(agentId);
  }

  /** The default contact set when an agent has no curated book: its own account's
   *  agents + friends' listed agents (allow-all) + open-link grants + legacy pairs. */
  private derivedContactsOf(agentId: string): string[] {
    const acc = this.db.getAgent(agentId)?.account_id ?? null;
    if (!acc) return this.db.linkedContacts(agentId);
    const accounts = new Set([acc, ...this.db.friendAccountsOf(acc)]);
    const local = this.db
      .listAllAgents()
      // Same-account agents are always visible to each other; another account's
      // agents only if they're `listed` (owner-only connectors stay hidden).
      .filter(
        (a) =>
          a.agent_id !== agentId &&
          a.account_id != null &&
          accounts.has(a.account_id) &&
          (a.account_id === acc || !!a.listed),
      )
      .map((a) => a.agent_id);
    // Per-agent open-link grants (agent-scoped, both directions):
    // (a) agents THIS account has been granted access to.
    for (const id of this.db.accountAgentGrants(acc)) if (id !== agentId && !local.includes(id)) local.push(id);
    // (b) if THIS agent is open-granted, include its grantees' agents so it can
    //     see/reply to whoever linked to it.
    for (const granteeAcc of this.db.agentGranteesFor(agentId)) {
      for (const a of this.db.accountAgents(granteeAcc)) {
        if (a.agent_id !== agentId && !local.includes(a.agent_id)) local.push(a.agent_id);
      }
    }
    for (const id of this.db.linkedContacts(agentId)) if (!local.includes(id)) local.push(id);
    return local;
  }

  /** May `a` message `b`? Same account, linked accounts (friendship), a per-agent
   *  open-link grant (agent-scoped), or a legacy agent-pair link (back-compat). */
  private areLinked(a: string, b: string): boolean {
    if (a === b) return true;
    const accA = this.db.getAgent(a)?.account_id ?? null;
    const accB = this.db.getAgent(b)?.account_id ?? null;
    if (accA && accB && (accA === accB || this.db.areAccountsLinked(accA, accB))) return true;
    // Per-agent open link: a grant to agent `b` from a's account lets a↔b (and the
    // reverse, so the open agent can reply) — but ONLY that agent, not the account.
    if (accA && this.db.agentGrantExists(b, accA)) return true;
    if (accB && this.db.agentGrantExists(a, accB)) return true;
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
        // Version gate: reject before issuing a challenge so stale clients stop retrying.
        const minVer = this.env.MIN_CLIENT_VERSION?.trim() || "0.0.0";
        if (minVer !== "0.0.0") {
          const clientVer = frame.client_version?.trim() || "0.0.0";
          if (semverLt(clientVer, minVer)) {
            this.sendFrame(ws, {
              type: "auth_rejected",
              reason: "client_outdated",
              min_version: minVer,
              ...(this.env.LATEST_CLIENT_VERSION?.trim()
                ? { latest_version: this.env.LATEST_CLIENT_VERSION.trim() }
                : {}),
              message: `Client version ${clientVer} is below the minimum required ${minVer}.`,
            });
            return ws.close(4000, "client_outdated");
          }
        }
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
