import {
  formatNickname,
  mintAccountId,
  mintAgentId,
  normalizeNickname,
  nowIso,
  PROTOCOL_VERSION,
  type ContactState,
  type Envelope,
} from "@hauddy/protocol";
import { hashPassword, randomHex, verifyPassword } from "./crypto.js";
import { SCHEMA } from "./schema.js";

// ── row shapes (raw SQLite → typed) ───────────────────────────────────────
export interface AccountRow {
  account_id: string;
  username: string | null;
  email: string;
  pw_hash: string | null;
  pw_salt: string | null;
  pw_iter: number | null;
  api_key: string | null;
  key_masked: string;
  revoked: number;
  auto_accept: number;
  created_at: string;
}

export interface AgentRow {
  agent_id: string;
  account_id: string | null;
  grant_scope_id: string;
  public_key: string;
  local_id: string | null;
  display_name: string | null;
  description: string | null;
  speaking_as: string | null;
  kind: string;
  open_link: number; // 1 = external auto-accept (per-agent open link) is on
  listed: number; // 1 = discoverable by other accounts; 0 = owner-only (connector default)
  created_at: string;
}

export interface ContactRecord {
  state: Exclude<ContactState, "none">;
  initiator: string;
  updated_at: string;
}

export interface CallRow {
  call_id: string;
  caller: string;
  callee: string;
  caller_nick: string | null;
  callee_nick: string | null;
  state: string; // ringing | active | ended | missed | declined
  started_ms: number;
  answered_ms: number | null;
  ended_ms: number | null;
  end_reason: string | null;
}

export interface AttachmentRow {
  file_id: string;
  name: string;
  mime: string;
  size: number;
  owner: string;
  to_ref: string | null;
  account_id: string | null;
  created_ms: number;
  expires_ms: number;
}

/** One conversation-peer summary for the console thread list (spec §E). */
export interface ThreadSummary {
  peer_id: string;
  peer_nick: string | null;
  last_body: string | null;
  last_ts: number;
  last_ms: number;
  last_call?: { state: string; duration_s?: number };
  has_attach: boolean;
  unread: number;
}

/** A single message in a peer's history (mine = sent by the human). */
export interface HistoryMessage {
  id: string;
  from_agent: string;
  mine: boolean;
  body: string | null;
  attachments: unknown;
  ts: number;
  created_at: string;
  /** Delivery/read state (drives the sender's ✓ / ✓✓ ticks). `delivered_at` is
   *  stamped when the recipient acks; `read_at` only when a console-human opens
   *  the thread (agent recipients never mark read). */
  delivered_at: string | null;
  read_at: string | null;
}

/** A full message row on the sync wire (local hub ⇄ platform mirror). */
export interface SyncMessage {
  message_id: string;
  from_agent: string;
  to_agent: string;
  from_nick: string | null;
  to_nick: string | null;
  body: string | null;
  attachments: unknown;
  created_at: string;
  created_ms: number;
  delivered_at: string | null;
  read_at: string | null;
  account_scope: string | null;
}

export type NicknameOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: "taken" | "invalid" | "conflict"; conflict?: string };

/** Reserving an account-level hold on a handle (distinct reasons from binding). */
export type ReserveOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: "invalid" | "taken" | "limit"; detail?: string; suggestions?: string[] };

/** Whether a handle is free to take, and — if not — why + whose it is. */
export interface NicknameAvailability {
  name: string; // '@bare' (or the raw input when invalid)
  available: boolean;
  reason?: "bound" | "reserved" | "invalid";
  /** true when the blocking binding/reservation belongs to the asking account. */
  mine?: boolean;
  suggestions?: string[];
}

type Bind = string | number | null;

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}
function safeJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
// Min gap between console presence writes. Well under CONSOLE_TTL_MS (90s in
// hub-do.ts) so presence never lapses, but caps rows_written from per-poll touches.
const CONSOLE_TOUCH_MIN_MS = 30_000;
// Cap held-but-unbound handles per account (anti-squatting; alpha is invite-only
// so this is generous — mostly a sanity backstop). Reservations don't expire.
const MAX_RESERVATIONS = 20;
// The console human never connects over WS, so a placeholder public key satisfies
// the NOT NULL column; any WS auth attempt against it simply fails verification.
const HUMAN_PLACEHOLDER_KEY = "-----BEGIN PUBLIC KEY-----\nHAUDDY-CONSOLE-HUMAN-NO-WS-KEY\n-----END PUBLIC KEY-----\n";

function mintApiKey(): string {
  return `sk_live_${randomHex(24)}`;
}
function maskKey(apiKey: string): string {
  return `sk_live_••••${apiKey.slice(-4)}`;
}
function mintConnectorToken(): string {
  return `ct_live_${randomHex(24)}`;
}
function maskConnectorToken(token: string): string {
  return `ct_live_••••${token.slice(-4)}`;
}
function mintClientId(): string {
  return `oclient_${randomHex(12)}`;
}
function mintClientSecret(): string {
  return `cs_live_${randomHex(24)}`;
}

/** The capabilities a connector token may hold. Calls are intentionally absent —
 *  a stateless connector can't ring/hold a real-time call. */
export const CONNECTOR_SCOPES = ["send", "read", "files"] as const;
/** Keep only recognized scopes, de-duplicated, in canonical order → csv string. */
function normalizeScope(scope: string[]): string {
  return CONNECTOR_SCOPES.filter((s) => scope.includes(s)).join(",");
}

/** A connector token's masked view (the raw token is only ever returned once, at
 *  creation). `scope` is a csv subset of send,read,files; `handle` is its bound
 *  identity's @nickname. */
export interface ConnectorTokenView {
  masked: string;
  handle: string | null;
  agent_id: string;
  label: string | null;
  scope: string;
  /** The paired OAuth client_id (client_credentials grant), if one was minted. */
  client_id: string | null;
  created_at: string;
  last_used_ms: number | null;
}

/**
 * SQLite layer over the DO's ctx.storage.sql. Mirrors the Node hub's store.ts
 * method-for-method so the two implementations stay wire-compatible (plan §0),
 * with two runtime differences: passwords are async PBKDF2 (WebCrypto has no
 * scrypt), and the durable inbox is folded into the `messages` table (P3).
 */
export class Db {
  constructor(private sql: SqlStorage) {}

  /** Apply the full schema. Idempotent — safe on every construction. */
  init(): void {
    this.sql.exec(SCHEMA);
    this.migrate();
  }

  /** Additive column migrations for DBs created before a column existed —
   *  `CREATE TABLE IF NOT EXISTS` won't add columns to an existing table. Each
   *  is guarded by a PRAGMA check so it's idempotent. */
  private migrate(): void {
    const agentCols = new Set(
      this.rows<{ name: string }>("PRAGMA table_info(agents)").map((c) => c.name),
    );
    if (!agentCols.has("open_link")) {
      this.sql.exec("ALTER TABLE agents ADD COLUMN open_link INTEGER NOT NULL DEFAULT 0");
    }
    // `listed` gates cross-account discoverability. Regular exposed agents stay
    // visible (default 1); connectors are owner-only by default. On first add,
    // backfill EXISTING connectors to hidden so they match the new default (runs
    // exactly once — the guard skips it after the column exists, so a connector
    // the owner later re-lists isn't silently re-hidden).
    if (!agentCols.has("listed")) {
      this.sql.exec("ALTER TABLE agents ADD COLUMN listed INTEGER NOT NULL DEFAULT 1");
      this.sql.exec("UPDATE agents SET listed = 0 WHERE kind = 'connector'");
    }
    // oauth_clients gained client_secret + connector_agent_id when connector
    // credentials (client_credentials grant) were added — backfill on old DBs.
    const oauthCols = new Set(
      this.rows<{ name: string }>("PRAGMA table_info(oauth_clients)").map((c) => c.name),
    );
    if (!oauthCols.has("client_secret")) {
      this.sql.exec("ALTER TABLE oauth_clients ADD COLUMN client_secret TEXT");
    }
    if (!oauthCols.has("connector_agent_id")) {
      this.sql.exec("ALTER TABLE oauth_clients ADD COLUMN connector_agent_id TEXT");
    }
    // Created here (not in SCHEMA) so it's only built once the column above is
    // guaranteed present — SCHEMA runs before this and would fault on an old DB.
    this.sql.exec("CREATE INDEX IF NOT EXISTS idx_oauth_connector ON oauth_clients(connector_agent_id)");
  }

  private rows<T = Record<string, Bind>>(query: string, ...binds: Bind[]): T[] {
    return this.sql.exec(query, ...binds).toArray() as unknown as T[];
  }
  private first<T = Record<string, Bind>>(query: string, ...binds: Bind[]): T | undefined {
    return this.rows<T>(query, ...binds)[0];
  }

  // ── accounts + API keys ─────────────────────────────────────────────────
  accountByUsername(username: string): AccountRow | undefined {
    return this.first<AccountRow>(
      "SELECT * FROM accounts WHERE lower(username) = ?",
      username.trim().toLowerCase(),
    );
  }
  accountByEmail(email: string): AccountRow | undefined {
    return this.first<AccountRow>(
      "SELECT * FROM accounts WHERE lower(email) = ?",
      email.trim().toLowerCase(),
    );
  }

  async createAccount(input: {
    username: string;
    email: string;
    password: string;
  }): Promise<{ account: AccountRow; apiKey: string }> {
    const apiKey = mintApiKey();
    const { hash, salt, iterations } = await hashPassword(input.password);
    const account_id = mintAccountId();
    const key_masked = maskKey(apiKey);
    const created_at = nowIso();
    this.sql.exec(
      `INSERT INTO accounts
         (account_id, username, email, pw_hash, pw_salt, pw_iter, api_key, key_masked, revoked, auto_accept, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?)`,
      account_id,
      input.username.trim(),
      input.email.trim(),
      hash,
      salt,
      iterations,
      apiKey,
      key_masked,
      created_at,
    );
    return { account: this.getAccount(account_id)!, apiKey };
  }

  getAccount(accountId: string): AccountRow | undefined {
    return this.first<AccountRow>("SELECT * FROM accounts WHERE account_id = ?", accountId);
  }

  deleteAccount(accountId: string): boolean {
    const acc = this.getAccount(accountId);
    if (!acc) return false;
    const nicks = this.rows<{ handle: string }>(`SELECT handle FROM profile_nicknames WHERE account_id = ?`, accountId);
    for (const n of nicks) {
      this.sql.exec(`DELETE FROM profile_nicknames WHERE handle = ?`, n.handle);
      this.sql.exec(`DELETE FROM nickname_registry WHERE handle = ?`, n.handle);
    }
    this.sql.exec(`DELETE FROM friend_requests WHERE requester_id = ? OR addressee_id = ?`, accountId, accountId);
    this.sql.exec(`DELETE FROM friendships WHERE account_a = ? OR account_b = ?`, accountId, accountId);
    this.sql.exec(`DELETE FROM oauth_clients WHERE connector_agent_id IN (SELECT agent_id FROM connectors WHERE account_id = ?)`, accountId);
    this.sql.exec(`DELETE FROM connectors WHERE account_id = ?`, accountId);
    this.sql.exec(`DELETE FROM agent_exposures WHERE account_id = ?`, accountId);
    this.sql.exec(`DELETE FROM accounts WHERE account_id = ?`, accountId);
    return true;
  }

  async verifyLogin(login: string, password: string): Promise<string | null> {
    const account = this.accountByUsername(login) ?? this.accountByEmail(login);
    if (!account || account.revoked || !account.pw_hash || !account.pw_salt) return null;
    const ok = await verifyPassword(password, account.pw_hash, account.pw_salt, account.pw_iter ?? 100_000);
    return ok ? account.account_id : null;
  }

  getApiKey(accountId: string): string | null {
    return this.getAccount(accountId)?.api_key ?? null;
  }

  authenticateAccount(apiKey: string): string | null {
    const row = this.first<{ account_id: string }>(
      "SELECT account_id FROM accounts WHERE api_key = ? AND revoked = 0",
      apiKey,
    );
    return row?.account_id ?? null;
  }

  rotateKey(accountId: string): string {
    const apiKey = mintApiKey();
    this.sql.exec(
      "UPDATE accounts SET api_key = ?, key_masked = ?, revoked = 0 WHERE account_id = ?",
      apiKey,
      maskKey(apiKey),
      accountId,
    );
    return apiKey;
  }

  revokeKey(accountId: string): void {
    this.sql.exec("UPDATE accounts SET revoked = 1 WHERE account_id = ?", accountId);
  }

  // ── connector tokens (public /v1 + /mcp bearer creds) ───────────────────
  /** Create a connector: provision its FIXED identity (a keyless kind='connector'
   *  agent bound to `handle`, owned by the account) + a scoped token that signs
   *  as it. Returns the RAW token once. `handle` must be free in the account's
   *  namespace (reservation-aware bind consumes the account's own hold). On a
   *  handle conflict/invalid the just-created agent is rolled back.
   *
   *  `reclaim` (used by the OAuth re-onboarding flow): if the handle is already
   *  held by one of THIS account's own stale connectors, retire that connector
   *  and take the handle. Disconnecting a connector in the client (ChatGPT,
   *  claude.ai) does NOT revoke it server-side, so re-adding it would otherwise
   *  be permanently blocked by the orphan holding its @handle. Only reclaims
   *  kind='connector' handles you own — never a human/agent handle or another
   *  account's. */
  createConnector(
    accountId: string,
    input: { label?: string; scope: string[]; handle: string; reclaim?: boolean },
  ): { ok: true; token: string; agent_id: string; handle: string; reclaimed?: boolean } | { ok: false; reason: "invalid" | "conflict" | "taken" } {
    const agent = this.registerAgent({
      account_id: accountId,
      grant_scope_id: `connector:${randomHex(8)}`,
      public_key: HUMAN_PLACEHOLDER_KEY,
      kind: "connector",
      display_name: input.label?.trim() || undefined,
    });
    // Connectors are owner-only by default; the owner can make one discoverable
    // on the network from its agent page (setListed).
    this.sql.exec("UPDATE agents SET listed = 0 WHERE agent_id = ?", agent.agent_id);
    let bound = this.bindNickname(agent.agent_id, input.handle);
    let reclaimed = false;
    if (!bound.ok && bound.reason === "conflict" && input.reclaim) {
      const holder = this.bindingOf(input.handle);
      if (holder && holder.account_id === accountId && this.getAgent(holder.agent_id)?.kind === "connector") {
        this.revokeConnector(accountId, { agentId: holder.agent_id }); // retire the orphan → frees the handle + its token/OAuth creds
        bound = this.bindNickname(agent.agent_id, input.handle);
        reclaimed = bound.ok;
      }
    }
    if (!bound.ok) {
      this.removeAgent(agent.agent_id); // no orphan identity on a failed bind
      return { ok: false, reason: bound.reason };
    }
    const token = mintConnectorToken();
    this.sql.exec(
      `INSERT INTO connector_tokens (token, account_id, agent_id, label, scope, revoked, created_at, last_used_ms)
       VALUES (?, ?, ?, ?, ?, 0, ?, NULL)`,
      token,
      accountId,
      agent.agent_id,
      input.label?.trim() || null,
      normalizeScope(input.scope),
      nowIso(),
    );
    return { ok: true, token, agent_id: agent.agent_id, handle: bound.nickname, reclaimed };
  }

  /** Resolve a connector token to its owner account + scope + bound identity
   *  agent, bumping last-used. Returns null for unknown/revoked tokens. */
  authenticateConnector(token: string): { account_id: string; agent_id: string; scope: string } | null {
    const row = this.first<{ account_id: string; agent_id: string; scope: string }>(
      "SELECT account_id, agent_id, scope FROM connector_tokens WHERE token = ? AND revoked = 0",
      token,
    );
    if (!row) return null;
    this.sql.exec("UPDATE connector_tokens SET last_used_ms = ? WHERE token = ?", Date.now(), token);
    return { account_id: row.account_id, agent_id: row.agent_id, scope: row.scope };
  }

  listConnectorTokens(accountId: string): ConnectorTokenView[] {
    return this.rows<Record<string, Bind>>(
      `SELECT ct.*, oc.client_id AS client_id
         FROM connector_tokens ct
         LEFT JOIN oauth_clients oc ON oc.connector_agent_id = ct.agent_id
        WHERE ct.account_id = ? AND ct.revoked = 0
        ORDER BY ct.created_at DESC`,
      accountId,
    ).map((r) => ({
      masked: maskConnectorToken(String(r.token)),
      handle: this.speakingNickname(String(r.agent_id)),
      agent_id: String(r.agent_id),
      label: r.label == null ? null : String(r.label),
      scope: String(r.scope),
      client_id: r.client_id == null ? null : String(r.client_id),
      created_at: String(r.created_at),
      last_used_ms: r.last_used_ms == null ? null : Number(r.last_used_ms),
    }));
  }

  /** The connector bound to an agent (its masked token + scope + paired OAuth
   *  client_id), for the Agent page's "access" section. Null for non-connector
   *  agents. Account-scoped so a caller only sees its own. */
  connectorForAgent(accountId: string, agentId: string): { masked: string; scope: string; client_id: string | null; last_used_ms: number | null } | null {
    const row = this.first<{ token: string; scope: string; last_used_ms: number | null; client_id: string | null }>(
      `SELECT ct.token, ct.scope, ct.last_used_ms, oc.client_id AS client_id
         FROM connector_tokens ct
         LEFT JOIN oauth_clients oc ON oc.connector_agent_id = ct.agent_id
        WHERE ct.agent_id = ? AND ct.account_id = ? AND ct.revoked = 0`,
      agentId,
      accountId,
    );
    if (!row) return null;
    return {
      masked: maskConnectorToken(String(row.token)),
      scope: String(row.scope),
      client_id: row.client_id == null ? null : String(row.client_id),
      last_used_ms: row.last_used_ms == null ? null : Number(row.last_used_ms),
    };
  }

  // ── OAuth clients (Dynamic Client Registration for the /mcp OAuth server) ──
  /** Register a public OAuth client (PKCE, no secret). Returns its client_id. */
  createOAuthClient(input: { client_name?: string; redirect_uris: string[] }): string {
    const client_id = mintClientId();
    this.sql.exec(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, created_at) VALUES (?, ?, ?, ?)",
      client_id,
      input.client_name?.trim() || null,
      JSON.stringify(input.redirect_uris),
      nowIso(),
    );
    return client_id;
  }

  getOAuthClient(clientId: string): { client_name: string | null; redirect_uris: string[] } | null {
    const row = this.first<{ client_name: string | null; redirect_uris: string }>(
      "SELECT client_name, redirect_uris FROM oauth_clients WHERE client_id = ?",
      clientId,
    );
    if (!row) return null;
    let uris: string[] = [];
    try {
      uris = JSON.parse(row.redirect_uris) as string[];
    } catch {
      uris = [];
    }
    return { client_name: row.client_name, redirect_uris: Array.isArray(uris) ? uris : [] };
  }

  /** Mint (or re-mint) an OAuth client_id + client_secret pair BOUND to a
   *  connector, enabling the headless client_credentials grant: a browserless
   *  agent copies the id+secret and exchanges them at /oauth/token for the
   *  connector's bearer token — no redirect. One pair per connector; a second
   *  call rotates the secret in place. Returns the raw secret once. */
  mintConnectorClient(
    accountId: string,
    agentId: string,
    clientName?: string,
  ): { client_id: string; client_secret: string } | null {
    const conn = this.first<{ agent_id: string }>(
      "SELECT agent_id FROM connector_tokens WHERE agent_id = ? AND account_id = ? AND revoked = 0",
      agentId,
      accountId,
    );
    if (!conn) return null;
    const client_secret = mintClientSecret();
    const existing = this.first<{ client_id: string }>(
      "SELECT client_id FROM oauth_clients WHERE connector_agent_id = ?",
      agentId,
    );
    if (existing) {
      this.sql.exec("UPDATE oauth_clients SET client_secret = ? WHERE client_id = ?", client_secret, existing.client_id);
      return { client_id: existing.client_id, client_secret };
    }
    const client_id = mintClientId();
    this.sql.exec(
      "INSERT INTO oauth_clients (client_id, client_name, redirect_uris, client_secret, connector_agent_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      client_id,
      clientName?.trim() || null,
      "[]",
      client_secret,
      agentId,
      nowIso(),
    );
    return { client_id, client_secret };
  }

  /** client_credentials grant: verify a connector's client_id + client_secret and
   *  return its live bearer token + scope. Null if unknown, wrong secret, not a
   *  connector-bound client, or the connector was revoked. */
  authenticateClientCredentials(clientId: string, clientSecret: string): { token: string; scope: string } | null {
    const client = this.first<{ client_secret: string | null; connector_agent_id: string | null }>(
      "SELECT client_secret, connector_agent_id FROM oauth_clients WHERE client_id = ?",
      clientId,
    );
    if (!client || !client.client_secret || !client.connector_agent_id) return null;
    if (client.client_secret !== clientSecret) return null;
    const conn = this.first<{ token: string; scope: string }>(
      "SELECT token, scope FROM connector_tokens WHERE agent_id = ? AND revoked = 0",
      client.connector_agent_id,
    );
    if (!conn) return null;
    this.sql.exec("UPDATE connector_tokens SET last_used_ms = ? WHERE agent_id = ?", Date.now(), client.connector_agent_id);
    return { token: String(conn.token), scope: String(conn.scope) };
  }

  /** Rotate a connector's bearer token in place (same @handle identity + scope).
   *  Any paired OAuth client keeps its client_id but gets a fresh secret, so old
   *  credentials fully die. Returns the new raw token (+ new client creds if the
   *  connector had a paired OAuth client). Null if no such connector. */
  rotateConnector(
    accountId: string,
    agentId: string,
  ): { token: string; client_id?: string; client_secret?: string } | null {
    const conn = this.first<{ scope: string }>(
      "SELECT scope FROM connector_tokens WHERE agent_id = ? AND account_id = ? AND revoked = 0",
      agentId,
      accountId,
    );
    if (!conn) return null;
    const token = mintConnectorToken();
    this.sql.exec(
      "UPDATE connector_tokens SET token = ?, last_used_ms = NULL WHERE agent_id = ? AND account_id = ?",
      token,
      agentId,
      accountId,
    );
    const creds = this.first<{ client_id: string }>(
      "SELECT client_id FROM oauth_clients WHERE connector_agent_id = ?",
      agentId,
    );
    if (creds) {
      const client_secret = mintClientSecret();
      this.sql.exec("UPDATE oauth_clients SET client_secret = ? WHERE client_id = ?", client_secret, creds.client_id);
      return { token, client_id: creds.client_id, client_secret };
    }
    return { token };
  }

  /** Retire a connector by its raw token OR its identity agent_id: delete the
   *  token row, any paired OAuth client, and the identity agent (freeing the
   *  @handle). Account-scoped (a caller can only revoke its own). Returns true if
   *  a connector matched. */
  revokeConnector(accountId: string, ref: { token?: string; agentId?: string }): boolean {
    const row = ref.token
      ? this.first<{ agent_id: string }>("SELECT agent_id FROM connector_tokens WHERE token = ? AND account_id = ?", ref.token, accountId)
      : ref.agentId
        ? this.first<{ agent_id: string }>("SELECT agent_id FROM connector_tokens WHERE agent_id = ? AND account_id = ?", ref.agentId, accountId)
        : undefined;
    if (!row) return false;
    this.sql.exec("DELETE FROM oauth_clients WHERE connector_agent_id = ?", row.agent_id);
    this.sql.exec("DELETE FROM connector_tokens WHERE agent_id = ? AND account_id = ?", row.agent_id, accountId);
    this.removeAgent(row.agent_id);
    return true;
  }

  accountView(
    accountId: string,
  ): { account_id: string; username: string | null; email: string; masked: string; revoked: boolean } | null {
    const a = this.getAccount(accountId);
    return a
      ? { account_id: a.account_id, username: a.username ?? null, email: a.email, masked: a.key_masked, revoked: !!a.revoked }
      : null;
  }

  setAutoAccept(accountId: string, on: boolean): void {
    this.sql.exec("UPDATE accounts SET auto_accept = ? WHERE account_id = ?", on ? 1 : 0, accountId);
  }
  getAutoAccept(accountId: string): boolean {
    return !!this.getAccount(accountId)?.auto_accept;
  }

  /** Rename the account's username (its display name + login handle). Callers
   *  must check availability first — `username` is UNIQUE, so a clash throws. */
  setUsername(accountId: string, username: string): void {
    this.sql.exec("UPDATE accounts SET username = ? WHERE account_id = ?", username.trim(), accountId);
  }

  /** Set a new password (fresh salt + iterations). */
  async setPassword(accountId: string, password: string): Promise<void> {
    const { hash, salt, iterations } = await hashPassword(password);
    this.sql.exec(
      "UPDATE accounts SET pw_hash = ?, pw_salt = ?, pw_iter = ? WHERE account_id = ?",
      hash,
      salt,
      iterations,
      accountId,
    );
  }

  /** Verify a known account's current password (gate for a password change). */
  async verifyAccountPassword(accountId: string, password: string): Promise<boolean> {
    const a = this.getAccount(accountId);
    if (!a || !a.pw_hash || !a.pw_salt) return false;
    return verifyPassword(password, a.pw_hash, a.pw_salt, a.pw_iter ?? 100_000);
  }

  // ── agents ──────────────────────────────────────────────────────────────
  /** Idempotent by grant_scope_id: re-registering updates the existing record. */
  registerAgent(input: {
    account_id?: string | null;
    grant_scope_id: string;
    public_key: string;
    local_id?: string;
    display_name?: string;
    description?: string;
    kind?: "human" | "agent" | "connector";
  }): AgentRow {
    const existing = this.first<AgentRow>(
      "SELECT * FROM agents WHERE grant_scope_id = ?",
      input.grant_scope_id,
    );
    if (existing) {
      const sets: string[] = [];
      const binds: Bind[] = [];
      if (input.account_id !== undefined) (sets.push("account_id = ?"), binds.push(input.account_id));
      if (input.local_id !== undefined) (sets.push("local_id = ?"), binds.push(input.local_id));
      if (input.display_name !== undefined) (sets.push("display_name = ?"), binds.push(input.display_name));
      if (input.description !== undefined) (sets.push("description = ?"), binds.push(input.description));
      if (input.kind !== undefined) (sets.push("kind = ?"), binds.push(input.kind));
      if (sets.length) {
        this.sql.exec(`UPDATE agents SET ${sets.join(", ")} WHERE agent_id = ?`, ...binds, existing.agent_id);
      }
      return this.getAgent(existing.agent_id)!;
    }
    const agent_id = mintAgentId();
    this.sql.exec(
      `INSERT INTO agents
         (agent_id, account_id, grant_scope_id, public_key, local_id, display_name, description, speaking_as, kind, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      agent_id,
      input.account_id ?? null,
      input.grant_scope_id,
      input.public_key,
      input.local_id ?? null,
      input.display_name ?? null,
      input.description ?? null,
      input.kind ?? "agent",
      nowIso(),
    );
    return this.getAgent(agent_id)!;
  }

  getAgent(agentId: string): AgentRow | undefined {
    return this.first<AgentRow>("SELECT * FROM agents WHERE agent_id = ?", agentId);
  }

  /** Find/create an account's HTTP-driven human console identity (spec §"human
   *  messaging"). Never authenticates over WS, so its public key is a placeholder. */
  ensureHumanAgent(accountId: string, nick?: string): AgentRow {
    const existing = this.first<AgentRow>(
      "SELECT * FROM agents WHERE account_id = ? AND kind = 'human' LIMIT 1",
      accountId,
    );
    if (existing) return existing;
    const record = this.registerAgent({
      account_id: accountId,
      grant_scope_id: `human:${accountId}`,
      public_key: HUMAN_PLACEHOLDER_KEY,
      kind: "human",
    });
    if (nick) this.bindNickname(record.agent_id, nick);
    return record;
  }

  listAllAgents(): AgentRow[] {
    return this.rows<AgentRow>("SELECT * FROM agents ORDER BY created_at");
  }

  setAgentProfile(agentId: string, profile: { display_name?: string; description?: string }): boolean {
    if (!this.getAgent(agentId)) return false;
    const sets: string[] = [];
    const binds: Bind[] = [];
    if (profile.display_name !== undefined) (sets.push("display_name = ?"), binds.push(profile.display_name));
    if (profile.description !== undefined) (sets.push("description = ?"), binds.push(profile.description));
    if (sets.length) this.sql.exec(`UPDATE agents SET ${sets.join(", ")} WHERE agent_id = ?`, ...binds, agentId);
    return true;
  }

  accountAgents(accountId: string): AgentRow[] {
    return this.rows<AgentRow>("SELECT * FROM agents WHERE account_id = ? ORDER BY created_at", accountId);
  }

  /** Remove an agent + its nickname bindings + its undelivered messages (unexpose). */
  removeAgent(agentId: string): boolean {
    if (!this.getAgent(agentId)) return false;
    this.sql.exec("DELETE FROM nicknames WHERE agent_id = ?", agentId);
    this.sql.exec("DELETE FROM messages WHERE to_agent = ? AND delivered_at IS NULL", agentId);
    // A connector identity carries a live bearer token + paired OAuth client; drop
    // them too so removing the agent can never orphan a still-valid credential
    // (FK cascade isn't guaranteed on in the DO's SQLite).
    this.sql.exec("DELETE FROM oauth_clients WHERE connector_agent_id = ?", agentId);
    this.sql.exec("DELETE FROM connector_tokens WHERE agent_id = ?", agentId);
    this.sql.exec("DELETE FROM agent_books WHERE agent_id = ?", agentId);
    this.sql.exec("DELETE FROM agents WHERE agent_id = ?", agentId);
    return true;
  }

  // ── network visibility (listed) ────────────────────────────────────────
  isListed(agentId: string): boolean {
    return !!this.getAgent(agentId)?.listed;
  }
  /** Set whether other accounts can discover this agent (a connector defaults to
   *  off — owner-only). The owner always sees/reaches its own agents regardless. */
  setListed(agentId: string, on: boolean): boolean {
    if (!this.getAgent(agentId)) return false;
    this.sql.exec("UPDATE agents SET listed = ? WHERE agent_id = ?", on ? 1 : 0, agentId);
    return true;
  }

  // ── per-agent contact book (curated @handles) ───────────────────────────
  /** The agent's curated book — bare @handles. Non-empty ⇒ it IS the agent's
   *  list_contacts (resolved), replacing the derived set. */
  agentBook(agentId: string): string[] {
    return this.rows<{ handle: string }>(
      "SELECT handle FROM agent_books WHERE agent_id = ? ORDER BY created_at",
      agentId,
    ).map((r) => r.handle);
  }
  addToBook(agentId: string, handle: string): void {
    const bare = handle.replace(/^@+/, "").toLowerCase();
    if (!bare) return;
    this.sql.exec(
      "INSERT OR IGNORE INTO agent_books (agent_id, handle, created_at) VALUES (?, ?, ?)",
      agentId,
      bare,
      nowIso(),
    );
  }
  removeFromBook(agentId: string, handle: string): void {
    const bare = handle.replace(/^@+/, "").toLowerCase();
    this.sql.exec("DELETE FROM agent_books WHERE agent_id = ? AND handle = ?", agentId, bare);
  }

  // ── per-agent external links (open_link + agent_grants) ─────────────────
  isOpenLink(agentId: string): boolean {
    return !!this.getAgent(agentId)?.open_link;
  }
  /** Set the per-agent external-accept flag. Turning it OFF revokes every grant
   *  to that agent (kill switch). Returns false for an unknown agent. */
  setOpenLink(agentId: string, on: boolean): boolean {
    if (!this.getAgent(agentId)) return false;
    this.sql.exec("UPDATE agents SET open_link = ? WHERE agent_id = ?", on ? 1 : 0, agentId);
    if (!on) this.revokeAgentGrants(agentId);
    return true;
  }
  /** Grant an account standing reachability to a single agent (idempotent). */
  grantAgent(agentId: string, accountId: string): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO agent_grants (agent_id, account_id, created_at) VALUES (?, ?, ?)",
      agentId,
      accountId,
      nowIso(),
    );
  }
  revokeAgentGrants(agentId: string): void {
    this.sql.exec("DELETE FROM agent_grants WHERE agent_id = ?", agentId);
  }
  /** Does `accountId` hold a per-agent grant to `agentId`? */
  agentGrantExists(agentId: string, accountId: string): boolean {
    return !!this.first<{ n: number }>(
      "SELECT 1 AS n FROM agent_grants WHERE agent_id = ? AND account_id = ?",
      agentId,
      accountId,
    );
  }
  /** Accounts granted standing access to `agentId` (owner-side "who's connected"). */
  agentGranteesFor(agentId: string): string[] {
    return this.rows<{ account_id: string }>(
      "SELECT account_id FROM agent_grants WHERE agent_id = ?",
      agentId,
    ).map((r) => r.account_id);
  }
  /** Agents `accountId` has been granted access to (requester-side list). */
  accountAgentGrants(accountId: string): string[] {
    return this.rows<{ agent_id: string }>(
      "SELECT agent_id FROM agent_grants WHERE account_id = ?",
      accountId,
    ).map((r) => r.agent_id);
  }

  // ── nickname registry ─────────────────────────────────────────────────
  nicknamesOf(agentId: string): string[] {
    return this.rows<{ nickname: string }>(
      "SELECT nickname FROM nicknames WHERE agent_id = ? ORDER BY nickname",
      agentId,
    ).map((r) => r.nickname);
  }
  accountNicknames(accountId: string): string[] {
    return this.rows<{ nickname: string }>(
      "SELECT nickname FROM nicknames WHERE account_id = ? ORDER BY nickname",
      accountId,
    ).map((r) => r.nickname);
  }

  bindingOf(name: string): { agent_id: string; account_id: string | null } | undefined {
    const bare = normalizeNickname(name);
    if (!bare) return undefined;
    return this.first<{ agent_id: string; account_id: string | null }>(
      "SELECT agent_id, account_id FROM nicknames WHERE nickname = ?",
      bare,
    );
  }

  /** Bind (or rename to) a globally-unique nickname; frees the agent's previous one. */
  bindNickname(agentId: string, rawName: string): NicknameOutcome {
    const name = normalizeNickname(rawName);
    if (!name) return { ok: false, reason: "invalid" };
    const agent = this.getAgent(agentId);
    if (!agent) return { ok: false, reason: "invalid" };
    const existing = this.first<{ agent_id: string }>("SELECT agent_id FROM nicknames WHERE nickname = ?", name);
    if (existing && existing.agent_id !== agentId) return { ok: false, reason: "conflict", conflict: existing.agent_id };
    // Reservations share the namespace: a hold by ANOTHER account blocks the bind
    // (even a WS auto-claim of a default folder-name handle). A hold by this agent's
    // own account is fine and gets consumed below (the hold becomes a binding).
    const reserved = this.first<{ account_id: string }>("SELECT account_id FROM reservations WHERE nickname = ?", name);
    if (reserved && reserved.account_id !== (agent.account_id ?? null)) return { ok: false, reason: "conflict" };
    this.sql.exec("DELETE FROM nicknames WHERE agent_id = ? AND nickname != ?", agentId, name);
    this.sql.exec(
      "INSERT OR REPLACE INTO nicknames (nickname, agent_id, account_id, bound_at) VALUES (?, ?, ?, ?)",
      name,
      agentId,
      agent.account_id ?? null,
      nowIso(),
    );
    this.sql.exec("DELETE FROM reservations WHERE nickname = ?", name); // consume the hold once bound
    this.sql.exec("UPDATE agents SET speaking_as = ? WHERE agent_id = ?", name, agentId);
    return { ok: true, nickname: formatNickname(name) };
  }

  // ── nickname reservations (account-level holds; app-ux-plan §G) ─────────
  /** '@handle's this account holds but hasn't attached to an agent yet. */
  accountReservations(accountId: string): string[] {
    return this.rows<{ nickname: string }>(
      "SELECT nickname FROM reservations WHERE account_id = ? ORDER BY nickname",
      accountId,
    ).map((r) => formatNickname(r.nickname));
  }

  /** Generate deterministic available handle suggestions for a requested base name. */
  suggestNicknames(rawBase: string, forAccountId?: string, count = 3): string[] {
    const name = normalizeNickname(rawBase);
    if (!name) return [];
    const candidates = [
      `${name}_1`,
      `${name}_2`,
      `${name}_3`,
      `${name}_bot`,
      `${name}_ai`,
      `the_${name}`,
    ];
    return candidates
      .filter((c) => this.nicknameAvailability(c, forAccountId).available)
      .map((c) => formatNickname(c))
      .slice(0, count);
  }

  /** Is a handle free across BOTH bound nicknames and reservations? */
  nicknameAvailability(rawName: string, forAccountId?: string): NicknameAvailability {
    const name = normalizeNickname(rawName);
    if (!name) return { name: rawName, available: false, reason: "invalid" };
    const bound = this.first<{ account_id: string | null }>(
      "SELECT account_id FROM nicknames WHERE nickname = ?",
      name,
    );
    if (bound) {
      return { name: formatNickname(name), available: false, reason: "bound", mine: !!forAccountId && bound.account_id === forAccountId };
    }
    const reserved = this.first<{ account_id: string }>(
      "SELECT account_id FROM reservations WHERE nickname = ?",
      name,
    );
    if (reserved) {
      return { name: formatNickname(name), available: false, reason: "reserved", mine: !!forAccountId && reserved.account_id === forAccountId };
    }
    return { name: formatNickname(name), available: true };
  }

  /** Park a handle for the account. Idempotent on the account's own hold. */
  reserveNickname(accountId: string, rawName: string): ReserveOutcome {
    const name = normalizeNickname(rawName);
    if (!name) return { ok: false, reason: "invalid" };
    const avail = this.nicknameAvailability(name, accountId);
    if (!avail.available) {
      if (avail.reason === "reserved" && avail.mine) return { ok: true, nickname: formatNickname(name) }; // already yours
      const suggestions = this.suggestNicknames(rawName, accountId);
      if (avail.reason === "bound" && avail.mine) return { ok: false, reason: "taken", detail: "you already hold that handle on an agent", suggestions };
      return { ok: false, reason: "taken", suggestions };
    }
    const count =
      this.first<{ n: number }>("SELECT COUNT(*) AS n FROM reservations WHERE account_id = ?", accountId)?.n ?? 0;
    if (count >= MAX_RESERVATIONS) return { ok: false, reason: "limit", detail: `reservation limit (${MAX_RESERVATIONS}) reached` };
    this.sql.exec(
      "INSERT INTO reservations (nickname, account_id, created_at) VALUES (?, ?, ?)",
      name,
      accountId,
      nowIso(),
    );
    return { ok: true, nickname: formatNickname(name) };
  }

  /** Drop the account's own hold on a handle. False if it isn't theirs. */
  releaseReservation(accountId: string, rawName: string): boolean {
    const name = normalizeNickname(rawName);
    if (!name) return false;
    const res = this.first<{ account_id: string }>("SELECT account_id FROM reservations WHERE nickname = ?", name);
    if (!res || res.account_id !== accountId) return false;
    this.sql.exec("DELETE FROM reservations WHERE nickname = ?", name);
    return true;
  }

  /** Bind a reserved handle to one of the account's own agents (consumes the hold). */
  attachReservation(accountId: string, agentId: string, rawName: string): NicknameOutcome {
    const name = normalizeNickname(rawName);
    if (!name) return { ok: false, reason: "invalid" };
    const res = this.first<{ account_id: string }>("SELECT account_id FROM reservations WHERE nickname = ?", name);
    if (!res || res.account_id !== accountId) return { ok: false, reason: "invalid" }; // not your reservation
    const agent = this.getAgent(agentId);
    if (!agent || agent.account_id !== accountId) return { ok: false, reason: "invalid" }; // not your agent
    return this.bindNickname(agentId, name); // reservation-aware: consumes the hold
  }

  resolveAgentId(ref: string): string | null {
    if (!ref) return null;
    if (this.getAgent(ref)) return ref;
    const name = normalizeNickname(ref);
    if (!name) return null;
    return this.first<{ agent_id: string }>("SELECT agent_id FROM nicknames WHERE nickname = ?", name)?.agent_id ?? null;
  }

  /** The agent's default speaking nickname in '@bare' form, or null. */
  speakingNickname(agentId: string): string | null {
    const linked = this.nicknamesOf(agentId);
    if (linked.length === 0) return null;
    const speaking = this.getAgent(agentId)?.speaking_as;
    const bare = speaking && linked.includes(speaking) ? speaking : linked[0]!;
    return formatNickname(bare);
  }

  // ── agent-pair contact graph (spec §4) ─────────────────────────────────
  getContact(a: string, b: string): { state: ContactState } {
    const row = this.first<{ state: ContactState }>(
      "SELECT state FROM contacts WHERE pair_key = ?",
      pairKey(a, b),
    );
    return row ?? { state: "none" };
  }

  shareContact(from: string, to: string): ContactRecord {
    const key = pairKey(from, to);
    const existing = this.first<ContactRecord>(
      "SELECT state, initiator, updated_at FROM contacts WHERE pair_key = ?",
      key,
    );
    if (existing) {
      if (existing.state === "pending" && existing.initiator === to) {
        this.sql.exec("UPDATE contacts SET state = 'linked', updated_at = ? WHERE pair_key = ?", nowIso(), key);
        return { ...existing, state: "linked" };
      }
      return existing;
    }
    const record: ContactRecord = { state: "pending", initiator: from, updated_at: nowIso() };
    this.sql.exec(
      "INSERT INTO contacts (pair_key, agent_a, agent_b, state, initiator, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      key,
      [from, to].sort()[0]!,
      [from, to].sort()[1]!,
      record.state,
      record.initiator,
      record.updated_at,
    );
    return record;
  }

  respondContact(responder: string, requester: string, accept: boolean): { state: ContactState } {
    const key = pairKey(responder, requester);
    const existing = this.first<ContactRecord>(
      "SELECT state, initiator, updated_at FROM contacts WHERE pair_key = ?",
      key,
    );
    if (!existing) return { state: "none" };
    if (accept) {
      if (existing.state === "pending" && existing.initiator === requester) {
        this.sql.exec("UPDATE contacts SET state = 'linked', updated_at = ? WHERE pair_key = ?", nowIso(), key);
        return { state: "linked" };
      }
      return { state: existing.state };
    }
    this.sql.exec("DELETE FROM contacts WHERE pair_key = ?", key);
    return { state: "none" };
  }

  linkedContacts(agentId: string): string[] {
    return this.counterparties("contacts", "agent_a", "agent_b", agentId, "state = 'linked'");
  }
  pendingRequests(agentId: string): string[] {
    return this.counterparties(
      "contacts",
      "agent_a",
      "agent_b",
      agentId,
      "state = 'pending' AND initiator != ?",
      agentId,
    );
  }

  private counterparties(
    table: string,
    colA: string,
    colB: string,
    agentId: string,
    where: string,
    ...extra: Bind[]
  ): string[] {
    const out: string[] = [];
    for (const r of this.rows<Record<string, string>>(
      `SELECT ${colA} AS a, ${colB} AS b FROM ${table} WHERE (${colA} = ? OR ${colB} = ?) AND ${where}`,
      agentId,
      agentId,
      ...extra,
    )) {
      out.push(r.a === agentId ? r.b : r.a);
    }
    return out;
  }

  // ── profile friendships (spec §"friends") ──────────────────────────────
  requestFriend(from: string, to: string): { state: "pending" | "linked" | "self" } {
    if (from === to) return { state: "self" };
    const key = pairKey(from, to);
    const existing = this.first<{ state: "pending" | "linked"; initiator: string }>(
      "SELECT state, initiator FROM friendships WHERE pair_key = ?",
      key,
    );
    if (existing) {
      if (existing.state === "pending" && existing.initiator === to) {
        this.sql.exec("UPDATE friendships SET state = 'linked', updated_at = ? WHERE pair_key = ?", nowIso(), key);
        return { state: "linked" };
      }
      return { state: existing.state };
    }
    this.sql.exec(
      "INSERT INTO friendships (pair_key, account_a, account_b, state, initiator, policy, updated_at) VALUES (?, ?, ?, 'pending', ?, 'allow_all', ?)",
      key,
      [from, to].sort()[0]!,
      [from, to].sort()[1]!,
      from,
      nowIso(),
    );
    return { state: "pending" };
  }

  respondFriend(responder: string, requester: string, accept: boolean): { state: "linked" | "pending" | "none" } {
    const key = pairKey(responder, requester);
    const existing = this.first<{ state: "pending" | "linked"; initiator: string }>(
      "SELECT state, initiator FROM friendships WHERE pair_key = ?",
      key,
    );
    if (!existing) return { state: "none" };
    if (accept) {
      if (existing.state === "pending" && existing.initiator === requester) {
        this.sql.exec("UPDATE friendships SET state = 'linked', updated_at = ? WHERE pair_key = ?", nowIso(), key);
        return { state: "linked" };
      }
      return { state: existing.state };
    }
    this.sql.exec("DELETE FROM friendships WHERE pair_key = ?", key);
    return { state: "none" };
  }

  areAccountsLinked(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    return (
      this.first<{ state: string }>("SELECT state FROM friendships WHERE pair_key = ?", pairKey(a, b))?.state === "linked"
    );
  }

  friendAccountsOf(accountId: string): string[] {
    return this.counterparties("friendships", "account_a", "account_b", accountId, "state = 'linked'");
  }

  listFriendships(accountId: string): { linked: string[]; incoming: string[]; outgoing: string[] } {
    const linked: string[] = [];
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const r of this.rows<{ account_a: string; account_b: string; state: string; initiator: string }>(
      "SELECT account_a, account_b, state, initiator FROM friendships WHERE account_a = ? OR account_b = ?",
      accountId,
      accountId,
    )) {
      const other = r.account_a === accountId ? r.account_b : r.account_a;
      if (r.state === "linked") linked.push(other);
      else if (r.initiator === accountId) outgoing.push(other);
      else incoming.push(other);
    }
    return { linked, incoming, outgoing };
  }

  // ── messages: durable log + queue (undelivered = delivered_at IS NULL) ──
  /** Persist an asserted SMS envelope (from/to are agent ids). Idempotent by id. */
  insertMessage(
    env: Envelope,
    opts: { fromNick: string | null; toNick: string | null; accountScope: string | null },
  ): void {
    const payload = env.payload as { body?: unknown; attachments?: unknown };
    const body = typeof payload.body === "string" ? payload.body : payload.body == null ? null : JSON.stringify(payload.body);
    const attachments = Array.isArray(payload.attachments) && payload.attachments.length ? JSON.stringify(payload.attachments) : null;
    const parsed = Date.parse(env.ts);
    const created_ms = Number.isFinite(parsed) ? parsed : Date.now();
    this.sql.exec(
      `INSERT OR IGNORE INTO messages
         (message_id, from_agent, to_agent, from_nick, to_nick, body, attachments, created_at, created_ms, delivered_at, read_at, account_scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
      env.id,
      env.from,
      env.to,
      opts.fromNick,
      opts.toNick,
      body,
      attachments,
      env.ts,
      created_ms,
      opts.accountScope,
    );
  }

  /** Undelivered (incl. delivered-but-unacked) messages for an agent, as envelopes. */
  undeliveredFor(agentId: string): Envelope[] {
    return this.rows<Record<string, Bind>>(
      "SELECT * FROM messages WHERE to_agent = ? AND delivered_at IS NULL ORDER BY created_ms",
      agentId,
    ).map((r) => this.rowToEnvelope(r));
  }

  /** Mark a message delivered (acked) so it isn't redelivered on reconnect. */
  markDelivered(messageId: string, agentId: string): void {
    this.sql.exec(
      "UPDATE messages SET delivered_at = ? WHERE message_id = ? AND to_agent = ? AND delivered_at IS NULL",
      nowIso(),
      messageId,
      agentId,
    );
  }

  private rowToEnvelope(r: Record<string, Bind>): Envelope {
    const payload: Record<string, unknown> = {};
    if (r.body != null) payload.body = String(r.body);
    if (r.attachments != null) {
      try {
        payload.attachments = JSON.parse(String(r.attachments));
      } catch {
        /* ignore malformed */
      }
    }
    return {
      v: PROTOCOL_VERSION,
      id: String(r.message_id),
      type: "sms",
      from: String(r.from_agent),
      to: String(r.to_agent),
      ts: String(r.created_at),
      payload,
      sig: null,
    };
  }

  // ── calls: one row per session; call_frames: the spoken content ────────
  // SMS and Call stay DISTINCT — a call envelope persists here, never in messages.
  getCall(callId: string): CallRow | undefined {
    return this.first<CallRow>("SELECT * FROM calls WHERE call_id = ?", callId);
  }

  upsertCallInvite(c: {
    call_id: string;
    caller: string;
    callee: string;
    caller_nick: string | null;
    callee_nick: string | null;
    started_ms: number;
  }): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO calls
         (call_id, caller, callee, caller_nick, callee_nick, state, started_ms, answered_ms, ended_ms, end_reason)
       VALUES (?, ?, ?, ?, ?, 'ringing', ?, NULL, NULL, NULL)`,
      c.call_id,
      c.caller,
      c.callee,
      c.caller_nick,
      c.callee_nick,
      c.started_ms,
    );
  }

  /** Mark a call answered (first frame or explicit accept): ringing → active. */
  markCallAnswered(callId: string, answeredMs: number): void {
    this.sql.exec(
      "UPDATE calls SET answered_ms = COALESCE(answered_ms, ?), state = CASE WHEN state = 'ringing' THEN 'active' ELSE state END WHERE call_id = ?",
      answeredMs,
      callId,
    );
  }

  /** Close a call: answered → ended, never-answered → missed. */
  closeCall(callId: string, endedMs: number, reason: string): void {
    const c = this.getCall(callId);
    if (!c) return;
    const state = c.answered_ms != null ? "ended" : "missed";
    this.sql.exec("UPDATE calls SET ended_ms = ?, state = ?, end_reason = ? WHERE call_id = ?", endedMs, state, reason, callId);
  }

  insertCallFrame(f: {
    frame_id: string;
    call_id: string;
    from_agent: string;
    body: string | null;
    attachments: string | null;
    created_ms: number;
  }): void {
    const seq = Number(
      this.first<{ n: number }>("SELECT COALESCE(MAX(seq), -1) + 1 AS n FROM call_frames WHERE call_id = ?", f.call_id)?.n ?? 0,
    );
    this.sql.exec(
      "INSERT OR IGNORE INTO call_frames (frame_id, call_id, from_agent, seq, body, attachments, created_ms) VALUES (?, ?, ?, ?, ?, ?, ?)",
      f.frame_id,
      f.call_id,
      f.from_agent,
      seq,
      f.body,
      f.attachments,
      f.created_ms,
    );
  }

  callFrames(callId: string): Array<{ seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }> {
    return this.rows<Record<string, Bind>>(
      "SELECT seq, from_agent, body, attachments, created_ms FROM call_frames WHERE call_id = ? ORDER BY seq",
      callId,
    ).map((r) => ({
      seq: Number(r.seq),
      from_agent: String(r.from_agent),
      body: r.body == null ? null : String(r.body),
      attachments: r.attachments == null ? null : safeJson(String(r.attachments)),
      created_ms: Number(r.created_ms),
    }));
  }

  /** The most recent open (ringing/active) call an agent participates in — used by
   *  the console poll to pick up an incoming call the human didn't place. */
  latestOpenCallFor(agentId: string): CallRow | undefined {
    return this.first<CallRow>(
      "SELECT * FROM calls WHERE (caller = ? OR callee = ?) AND state IN ('ringing','active') ORDER BY started_ms DESC LIMIT 1",
      agentId,
      agentId,
    );
  }

  /** A call's frames after a seq cursor, excluding the poller's own lines (inbound). */
  callFramesSince(
    callId: string,
    afterSeq: number,
    excludeAgent: string,
  ): Array<{ seq: number; from_agent: string; body: string | null; attachments: unknown }> {
    return this.rows<Record<string, Bind>>(
      "SELECT seq, from_agent, body, attachments FROM call_frames WHERE call_id = ? AND seq > ? AND from_agent != ? ORDER BY seq",
      callId,
      afterSeq,
      excludeAgent,
    ).map((r) => ({
      seq: Number(r.seq),
      from_agent: String(r.from_agent),
      body: r.body == null ? null : String(r.body),
      attachments: r.attachments == null ? null : safeJson(String(r.attachments)),
    }));
  }

  // ── console history: browsable threads + call log (spec §E) ────────────
  // The human's whole SMS log lives in `messages` (from/to = agent ids). A
  // "thread" = every row where the human is either party; the peer is the other
  // side. `read_at` (unused by the live inbox) drives unread counts here.

  /** One summary row per conversation peer: latest message + unread count. */
  threadsFor(humanId: string): ThreadSummary[] {
    const rows = this.rows<Record<string, Bind>>(
      `SELECT from_agent, to_agent, from_nick, to_nick, body, attachments, created_ms, read_at
         FROM messages WHERE from_agent = ? OR to_agent = ? ORDER BY created_ms DESC`,
      humanId,
      humanId,
    );
    const byPeer = new Map<string, ThreadSummary>();
    for (const r of rows) {
      const outbound = String(r.from_agent) === humanId;
      const peerId = outbound ? String(r.to_agent) : String(r.from_agent);
      const peerNick = outbound
        ? r.to_nick == null ? null : String(r.to_nick)
        : r.from_nick == null ? null : String(r.from_nick);
      let t = byPeer.get(peerId);
      if (!t) {
        const ms = Number(r.created_ms);
        t = {
          peer_id: peerId,
          peer_nick: peerNick,
          last_body: r.body == null ? null : String(r.body),
          last_ts: ms,
          last_ms: ms,
          has_attach: r.attachments != null,
          unread: 0,
        };
        byPeer.set(peerId, t);
      } else if (!t.peer_nick && peerNick) {
        t.peer_nick = peerNick;
      }
      if (!outbound && r.read_at == null) t.unread += 1;
    }

    // Merge latest call per peer
    const callRows = this.rows<Record<string, Bind>>(
      `SELECT caller, callee, caller_nick, callee_nick, state, started_ms, answered_ms, ended_ms
         FROM calls WHERE caller = ? OR callee = ? ORDER BY started_ms DESC`,
      humanId,
      humanId,
    );
    const seenCall = new Set<string>();
    for (const r of callRows) {
      const isCaller = String(r.caller) === humanId;
      const peerId = isCaller ? String(r.callee) : String(r.caller);
      if (seenCall.has(peerId)) continue;
      seenCall.add(peerId);
      const startedMs = Number(r.started_ms);
      const endedMs = r.ended_ms != null ? Number(r.ended_ms) : null;
      const answeredMs = r.answered_ms != null ? Number(r.answered_ms) : null;
      const duration_s =
        endedMs != null && answeredMs != null ? Math.round((endedMs - answeredMs) / 1000) : undefined;
      const callSummary = { state: String(r.state), duration_s };
      let t = byPeer.get(peerId);
      if (!t) {
        const peerNick = isCaller
          ? r.callee_nick == null ? null : String(r.callee_nick)
          : r.caller_nick == null ? null : String(r.caller_nick);
        t = {
          peer_id: peerId,
          peer_nick: peerNick,
          last_body: null,
          last_ts: 0,
          last_ms: startedMs,
          has_attach: false,
          unread: 0,
          last_call: callSummary,
        };
        byPeer.set(peerId, t);
      } else if (startedMs > (t.last_ms ?? t.last_ts)) {
        t.last_ms = startedMs;
        t.last_call = callSummary;
      }
    }

    return [...byPeer.values()];
  }

  /** Full message history with one peer, newest-first-paged, returned ascending. */
  messagesWithPeer(humanId: string, peerId: string, beforeMs: number | null, limit = 50): HistoryMessage[] {
    const hasBefore = beforeMs != null;
    const rows = this.rows<Record<string, Bind>>(
      `SELECT message_id, from_agent, to_agent, body, attachments, created_ms, created_at, delivered_at, read_at
         FROM messages
        WHERE ((from_agent = ? AND to_agent = ?) OR (from_agent = ? AND to_agent = ?))
          ${hasBefore ? "AND created_ms < ?" : ""}
        ORDER BY created_ms DESC LIMIT ?`,
      ...(hasBefore
        ? [humanId, peerId, peerId, humanId, beforeMs as number, limit]
        : [humanId, peerId, peerId, humanId, limit]),
    );
    return rows
      .map((r) => ({
        id: String(r.message_id),
        from_agent: String(r.from_agent),
        mine: String(r.from_agent) === humanId,
        body: r.body == null ? null : String(r.body),
        attachments: r.attachments == null ? null : safeJson(String(r.attachments)),
        ts: Number(r.created_ms),
        created_at: String(r.created_at),
        delivered_at: r.delivered_at == null ? null : String(r.delivered_at),
        read_at: r.read_at == null ? null : String(r.read_at),
      }))
      .reverse();
  }

  /** Mark every inbound message from a peer as read (clears the thread's unread). */
  markThreadRead(humanId: string, peerId: string): void {
    this.sql.exec(
      "UPDATE messages SET read_at = ? WHERE to_agent = ? AND from_agent = ? AND read_at IS NULL",
      nowIso(),
      humanId,
      peerId,
    );
  }

  /** The human's call sessions, newest first (SMS≠Call — from the `calls` table). */
  callsFor(humanId: string, limit = 50): CallRow[] {
    return this.rows<CallRow>(
      "SELECT * FROM calls WHERE caller = ? OR callee = ? ORDER BY started_ms DESC LIMIT ?",
      humanId,
      humanId,
      limit,
    );
  }

  /** Unread inbound messages across all threads (badge count). */
  unreadMessageCount(humanId: string): number {
    return Number(
      this.first<{ n: number }>("SELECT COUNT(*) AS n FROM messages WHERE to_agent = ? AND read_at IS NULL", humanId)?.n ??
        0,
    );
  }

  /** Missed inbound calls (rings never answered) started after `sinceMs` — the
   *  cursor lets the notifications bell clear once the human acknowledges them. */
  missedCallCount(humanId: string, sinceMs = 0): number {
    return Number(
      this.first<{ n: number }>(
        "SELECT COUNT(*) AS n FROM calls WHERE callee = ? AND state = 'missed' AND started_ms > ?",
        humanId,
        sinceMs,
      )?.n ?? 0,
    );
  }

  // ── sync mirror (local hub ⇄ platform; platform is SSOT) ────────────────
  // The daemon pushes local-origin messages/calls up (persist-only, NO delivery)
  // and pulls account-scoped history down. Every write is INSERT OR IGNORE by id,
  // so a re-pushed — possibly locally-edited — row can never overwrite the SSOT
  // copy. That is the whole anti-tamper guarantee (the user can edit local JSON
  // freely; the platform simply ignores a known id).

  /** Ingest a pushed message row verbatim (no routing/delivery). */
  ingestMessage(row: SyncMessage): void {
    const attachments =
      row.attachments == null ? null : typeof row.attachments === "string" ? row.attachments : JSON.stringify(row.attachments);
    this.sql.exec(
      `INSERT OR IGNORE INTO messages
         (message_id, from_agent, to_agent, from_nick, to_nick, body, attachments, created_at, created_ms, delivered_at, read_at, account_scope)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.message_id,
      row.from_agent,
      row.to_agent,
      row.from_nick,
      row.to_nick,
      row.body,
      attachments,
      row.created_at,
      row.created_ms,
      row.delivered_at ?? null,
      row.read_at ?? null,
      row.account_scope ?? null,
    );
  }

  /** Ingest a pushed call session verbatim (persist-only). */
  ingestCall(row: CallRow): void {
    this.sql.exec(
      `INSERT OR IGNORE INTO calls
         (call_id, caller, callee, caller_nick, callee_nick, state, started_ms, answered_ms, ended_ms, end_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      row.call_id,
      row.caller,
      row.callee,
      row.caller_nick,
      row.callee_nick,
      row.state,
      row.started_ms,
      row.answered_ms,
      row.ended_ms,
      row.end_reason,
    );
  }

  /** Messages touching any of `agentIds`, created after `sinceMs`, oldest-first
   *  (the pull-down cursor page). */
  messagesForScope(agentIds: string[], sinceMs: number, limit = 500): SyncMessage[] {
    if (agentIds.length === 0) return [];
    const ph = agentIds.map(() => "?").join(",");
    return this.rows<Record<string, Bind>>(
      `SELECT * FROM messages WHERE created_ms > ? AND (from_agent IN (${ph}) OR to_agent IN (${ph})) ORDER BY created_ms LIMIT ?`,
      sinceMs,
      ...agentIds,
      ...agentIds,
      limit,
    ).map((r) => ({
      message_id: String(r.message_id),
      from_agent: String(r.from_agent),
      to_agent: String(r.to_agent),
      from_nick: r.from_nick == null ? null : String(r.from_nick),
      to_nick: r.to_nick == null ? null : String(r.to_nick),
      body: r.body == null ? null : String(r.body),
      attachments: r.attachments == null ? null : safeJson(String(r.attachments)),
      created_at: String(r.created_at),
      created_ms: Number(r.created_ms),
      delivered_at: r.delivered_at == null ? null : String(r.delivered_at),
      read_at: r.read_at == null ? null : String(r.read_at),
      account_scope: r.account_scope == null ? null : String(r.account_scope),
    }));
  }

  /** Calls touching any of `agentIds`, started after `sinceMs`, with their frames. */
  callsForScope(
    agentIds: string[],
    sinceMs: number,
    limit = 200,
  ): Array<CallRow & { frames: Array<{ frame_id: string; seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }> }> {
    if (agentIds.length === 0) return [];
    const ph = agentIds.map(() => "?").join(",");
    const calls = this.rows<CallRow>(
      `SELECT * FROM calls WHERE started_ms > ? AND (caller IN (${ph}) OR callee IN (${ph})) ORDER BY started_ms LIMIT ?`,
      sinceMs,
      ...agentIds,
      ...agentIds,
      limit,
    );
    // Include frame_id (unlike callFrames) so pull-down stays idempotent with the
    // local origin copy — synthesising an id would duplicate locally-sent frames.
    return calls.map((c) => ({
      ...c,
      frames: this.rows<Record<string, Bind>>(
        "SELECT frame_id, seq, from_agent, body, attachments, created_ms FROM call_frames WHERE call_id = ? ORDER BY seq",
        c.call_id,
      ).map((r) => ({
        frame_id: String(r.frame_id),
        seq: Number(r.seq),
        from_agent: String(r.from_agent),
        body: r.body == null ? null : String(r.body),
        attachments: r.attachments == null ? null : safeJson(String(r.attachments)),
        created_ms: Number(r.created_ms),
      })),
    }));
  }

  // ── console sessions (HTTP-driven human presence) ──────────────────────
  consoleTouch(humanId: string, nowMs: number): void {
    // Presence only needs freshness within CONSOLE_TTL_MS (90s); the console
    // touches on EVERY poll, so writing a row each time blows the DO
    // rows_written budget. Read (cheap — rows_read has a far larger quota) and
    // skip the write unless the last touch is stale by the throttle window.
    const row = this.first<{ last_ms: number }>("SELECT last_ms FROM console_sessions WHERE human_id = ?", humanId);
    if (row && nowMs - Number(row.last_ms) < CONSOLE_TOUCH_MIN_MS) return;
    this.sql.exec("INSERT OR REPLACE INTO console_sessions (human_id, last_ms) VALUES (?, ?)", humanId, nowMs);
  }
  consoleActive(humanId: string, nowMs: number, ttlMs: number): boolean {
    const row = this.first<{ last_ms: number }>("SELECT last_ms FROM console_sessions WHERE human_id = ?", humanId);
    return row != null && nowMs - Number(row.last_ms) < ttlMs;
  }

  // ── attachments (R2-backed file metadata; bytes at R2 files/<file_id>) ──
  insertAttachment(a: AttachmentRow): void {
    this.sql.exec(
      `INSERT INTO attachments
         (file_id, name, mime, size, owner, to_ref, account_id, created_ms, expires_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      a.file_id,
      a.name,
      a.mime,
      a.size,
      a.owner,
      a.to_ref,
      a.account_id,
      a.created_ms,
      a.expires_ms,
    );
  }
  getAttachment(fileId: string): AttachmentRow | undefined {
    return this.first<AttachmentRow>("SELECT * FROM attachments WHERE file_id = ?", fileId);
  }
  deleteAttachment(fileId: string): void {
    this.sql.exec("DELETE FROM attachments WHERE file_id = ?", fileId);
  }
  expiredAttachments(nowMs: number): string[] {
    return this.rows<{ file_id: string }>(
      "SELECT file_id FROM attachments WHERE expires_ms < ?",
      nowMs,
    ).map((r) => r.file_id);
  }
  attachmentsTotalBytes(): number {
    return Number(this.first<{ total: number }>("SELECT COALESCE(SUM(size), 0) AS total FROM attachments")?.total ?? 0);
  }
  nextAttachmentExpiry(): number | null {
    const row = this.first<{ next: number | null }>("SELECT MIN(expires_ms) AS next FROM attachments");
    return row?.next ?? null;
  }

  // ── invites (email allowlist; replaces allowlist.txt) ──────────────────
  inviteCount(): number {
    const row = this.first<{ n: number }>("SELECT COUNT(*) AS n FROM invites");
    return Number(row?.n ?? 0);
  }
  isInvited(email: string): boolean {
    return !!this.first("SELECT email FROM invites WHERE email = ?", email.trim().toLowerCase());
  }
  addInvite(email: string, note?: string): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO invites (email, note, added_at) VALUES (?, ?, ?)",
      email.trim().toLowerCase(),
      note ?? null,
      nowIso(),
    );
  }

  // ── rate limits (fixed-window; survives hibernation) ───────────────────
  rateLimited(key: string, limit: number, windowMs: number, nowMs: number): boolean {
    const row = this.first<{ count: number; reset_ms: number }>(
      "SELECT count, reset_ms FROM rate_limits WHERE key = ?",
      key,
    );
    if (!row || row.reset_ms < nowMs) {
      this.sql.exec(
        "INSERT OR REPLACE INTO rate_limits (key, count, reset_ms) VALUES (?, 1, ?)",
        key,
        nowMs + windowMs,
      );
      return false;
    }
    this.sql.exec("UPDATE rate_limits SET count = count + 1 WHERE key = ?", key);
    return row.count + 1 > limit;
  }
}
