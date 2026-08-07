import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  formatNickname,
  mintAccountId,
  mintAgentId,
  normalizeNickname,
  nowIso,
  type ContactState,
  type Envelope,
} from "@hauddy/protocol";

export interface AccountRecord {
  account_id: string; // acct_*
  /** Unique login handle chosen at signup. */
  username?: string;
  email: string;
  /** scrypt of the password, and its per-account salt (both hex). */
  pw_hash?: string;
  pw_salt?: string;
  /** The active API key, stored raw so the web can re-reveal/copy it and login
   *  returns a stable key. Alpha tradeoff (bearer tokens at rest); see plan. */
  api_key?: string;
  /** Legacy: sha256 of the key (older accounts, pre-username). */
  key_hash?: string;
  key_masked: string; // sk_live_••••<tail>
  revoked: boolean;
  /** When true, incoming friend requests link immediately (spec §"friends"). */
  auto_accept?: boolean;
  created_at: string;
}

/**
 * A profile↔profile friendship (spec §"friends"): the account-level consent that
 * replaces the per-agent share/accept graph. `policy: "allow_all"` (the only
 * Phase-1 policy) means every exposed agent of one account may reach every
 * exposed agent of the other. Keyed by the unordered account pair.
 */
export interface FriendshipRecord {
  state: "pending" | "linked";
  /** The account that sent the request. */
  initiator: string;
  policy: "allow_all";
  updated_at: string;
}

export interface AgentRecord {
  agent_id: string;
  /** Owning platform account, or null for a local (unexposed) agent. */
  account_id?: string | null;
  grant_scope_id: string;
  public_key: string; // PEM (SPKI)
  /** Human-facing local label for the runtime (the UI's `localId`). */
  local_id?: string;
  display_name?: string;
  /** Agent-declared description of what this runtime is / does (spec §2.1). */
  description?: string;
  /** Bare nickname this agent speaks as by default when it has several. */
  speaking_as?: string;
  /** "human" = the person's own console identity (spec §"human messaging"),
   *  driven by HTTP not a WS session; "agent" (default) = an AI runtime. */
  kind?: "human" | "agent";
  created_at: string;
}

export interface ContactRecord {
  state: Exclude<ContactState, "none">;
  /** pending: the requester. blocked: the blocker. linked: who shared first. */
  initiator: string;
  updated_at: string;
}

export interface NicknameRecord {
  /** The agent this nickname routes to. Bound directly — no reserved-pool state. */
  agent_id: string;
  /** Owning account, or null/undefined for a local nickname. */
  account_id?: string | null;
  bound_at: string;
}

interface StoreData {
  accounts: Record<string, AccountRecord>;
  agents: Record<string, AgentRecord>;
  /** keyed by pairKey(a, b) — one record per unordered pair */
  contacts: Record<string, ContactRecord>;
  /** durable per-agent inbox of undelivered envelopes (spec §3.1, §10) */
  inboxes: Record<string, Envelope[]>;
  /** nickname registry (spec §2.4): bare lowercase nickname → binding */
  nicknames: Record<string, NicknameRecord>;
  /** profile friendships, keyed by pairKey(accountA, accountB) */
  friendships: Record<string, FriendshipRecord>;
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

/** scrypt(password, salt) → hex. */
function scryptHex(password: string, saltHex: string): string {
  return crypto.scryptSync(password, Buffer.from(saltHex, "hex"), 32).toString("hex");
}
function hashPassword(password: string): { pw_hash: string; pw_salt: string } {
  const pw_salt = crypto.randomBytes(16).toString("hex");
  return { pw_hash: scryptHex(password, pw_salt), pw_salt };
}
function verifyPassword(password: string, pw_hash: string, pw_salt: string): boolean {
  const candidate = Buffer.from(scryptHex(password, pw_salt), "hex");
  const expected = Buffer.from(pw_hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function mintApiKey(): string {
  return `sk_live_${crypto.randomBytes(24).toString("hex")}`;
}
function maskKey(apiKey: string): string {
  return `sk_live_••••${apiKey.slice(-4)}`;
}

export type NicknameOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: "taken" | "invalid" | "conflict"; conflict?: string };

/**
 * JSON-file-backed store with an in-memory cache. The whole dataset lives in
 * memory and is rewritten atomically (tmp + rename) on every mutation.
 * Deliberately simple — no database in v0.1.
 */
export class HubStore {
  private data: StoreData;
  private readonly file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "store.json");
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as StoreData)
      : { accounts: {}, agents: {}, contacts: {}, inboxes: {}, nicknames: {}, friendships: {} };
    // Tolerate stores written before these tables existed.
    this.data.accounts ??= {};
    this.data.nicknames ??= {};
    this.data.friendships ??= {};
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  // --- accounts + API keys (spec §2.5) -----------------------------------

  accountByUsername(username: string): AccountRecord | undefined {
    const u = username.trim().toLowerCase();
    return Object.values(this.data.accounts).find((a) => a.username?.toLowerCase() === u);
  }
  accountByEmail(email: string): AccountRecord | undefined {
    const e = email.trim().toLowerCase();
    return Object.values(this.data.accounts).find((a) => a.email.toLowerCase() === e);
  }

  /** Sign up: a username + email (both unique) + password. Mints and stores the
   *  raw API key (returned so the web can show/copy it into the app). */
  createAccount(input: { username: string; email: string; password: string }): { account: AccountRecord; apiKey: string } {
    const apiKey = mintApiKey();
    const { pw_hash, pw_salt } = hashPassword(input.password);
    const record: AccountRecord = {
      account_id: mintAccountId(),
      username: input.username.trim(),
      email: input.email.trim(),
      pw_hash,
      pw_salt,
      api_key: apiKey,
      key_masked: maskKey(apiKey),
      revoked: false,
      created_at: nowIso(),
    };
    this.data.accounts[record.account_id] = record;
    this.save();
    return { account: record, apiKey };
  }

  getAccount(accountId: string): AccountRecord | undefined {
    return this.data.accounts[accountId];
  }

  /** Verify a password login (by username OR email) → account id, or null. */
  verifyLogin(login: string, password: string): string | null {
    const account = this.accountByUsername(login) ?? this.accountByEmail(login);
    if (!account || account.revoked || !account.pw_hash || !account.pw_salt) return null;
    return verifyPassword(password, account.pw_hash, account.pw_salt) ? account.account_id : null;
  }

  /** The account's current (stable) API key. */
  getApiKey(accountId: string): string | null {
    return this.data.accounts[accountId]?.api_key ?? null;
  }

  /** Resolve an API key to its (non-revoked) account id, or null. */
  authenticateAccount(apiKey: string): string | null {
    for (const account of Object.values(this.data.accounts)) {
      if (account.revoked) continue;
      if (account.api_key === apiKey) return account.account_id; // raw (current)
      if (account.key_hash && account.key_hash === sha256(apiKey)) return account.account_id; // legacy
    }
    return null;
  }

  /** Issue a new API key for an account, replacing the old one. */
  rotateKey(accountId: string): string {
    const account = this.data.accounts[accountId];
    if (!account) throw new Error("unknown account");
    const apiKey = mintApiKey();
    account.api_key = apiKey;
    account.key_masked = maskKey(apiKey);
    delete account.key_hash; // superseded by the raw key
    account.revoked = false;
    this.save();
    return apiKey;
  }

  revokeKey(accountId: string): void {
    const account = this.data.accounts[accountId];
    if (!account) return;
    account.revoked = true;
    this.save();
  }

  accountView(accountId: string): { account_id: string; username: string | null; email: string; masked: string; revoked: boolean } | null {
    const a = this.data.accounts[accountId];
    return a ? { account_id: a.account_id, username: a.username ?? null, email: a.email, masked: a.key_masked, revoked: a.revoked } : null;
  }

  // --- agents -----------------------------------------------------------

  /** Idempotent by grant_scope_id: re-registering returns the existing record
   *  (updating its fields). `account_id` is optional — local agents have none. */
  registerAgent(input: {
    account_id?: string | null;
    grant_scope_id: string;
    public_key: string;
    local_id?: string;
    display_name?: string;
    description?: string;
    kind?: "human" | "agent";
  }): AgentRecord {
    for (const agent of Object.values(this.data.agents)) {
      if (agent.grant_scope_id === input.grant_scope_id) {
        if (input.account_id !== undefined) agent.account_id = input.account_id;
        if (input.local_id !== undefined) agent.local_id = input.local_id;
        if (input.display_name !== undefined) agent.display_name = input.display_name;
        if (input.description !== undefined) agent.description = input.description;
        if (input.kind !== undefined) agent.kind = input.kind;
        this.save();
        return agent;
      }
    }
    const record: AgentRecord = {
      agent_id: mintAgentId(),
      grant_scope_id: input.grant_scope_id,
      public_key: input.public_key,
      created_at: nowIso(),
    };
    if (input.account_id != null) record.account_id = input.account_id;
    if (input.local_id !== undefined) record.local_id = input.local_id;
    if (input.display_name !== undefined) record.display_name = input.display_name;
    if (input.description !== undefined) record.description = input.description;
    if (input.kind !== undefined) record.kind = input.kind;
    this.data.agents[record.agent_id] = record;
    this.save();
    return record;
  }

  /** Find/create an account's **human** console identity (spec §"human
   *  messaging"). A console human is driven by HTTP, never a WS session, so its
   *  keypair is a server-generated placeholder. Best-effort binds `nick`. */
  ensureHumanAgent(accountId: string, nick?: string): AgentRecord {
    const existing = Object.values(this.data.agents).find((a) => a.account_id === accountId && a.kind === "human");
    if (existing) return existing;
    const placeholder = crypto
      .generateKeyPairSync("ed25519")
      .publicKey.export({ type: "spki", format: "pem" })
      .toString();
    const record = this.registerAgent({
      account_id: accountId,
      grant_scope_id: `human:${accountId}`,
      public_key: placeholder,
      kind: "human",
    });
    if (nick) this.bindNickname(record.agent_id, nick);
    return record;
  }

  getAgent(agentId: string): AgentRecord | undefined {
    return this.data.agents[agentId];
  }

  /** Every agent in this hub (used by the local hub to list runtimes). */
  listAllAgents(): AgentRecord[] {
    return Object.values(this.data.agents);
  }

  /** Update an agent's human-facing profile (agent-declared, spec §2.1). */
  setAgentProfile(agentId: string, profile: { display_name?: string; description?: string }): boolean {
    const agent = this.data.agents[agentId];
    if (!agent) return false;
    if (profile.display_name !== undefined) agent.display_name = profile.display_name;
    if (profile.description !== undefined) agent.description = profile.description;
    this.save();
    return true;
  }

  /** All agents owned by an account. */
  accountAgents(accountId: string): AgentRecord[] {
    return Object.values(this.data.agents).filter((a) => a.account_id === accountId);
  }

  /** Remove an agent and its nickname bindings + inbox (used to unexpose). */
  removeAgent(agentId: string): boolean {
    if (!this.data.agents[agentId]) return false;
    delete this.data.agents[agentId];
    for (const [name, rec] of Object.entries(this.data.nicknames)) {
      if (rec.agent_id === agentId) delete this.data.nicknames[name];
    }
    delete this.data.inboxes[agentId];
    this.save();
    return true;
  }

  // --- nickname registry (spec §2.4): account-owned, linked to agents ------

  /** Bare nicknames linked to `agentId`. */
  nicknamesOf(agentId: string): string[] {
    return Object.entries(this.data.nicknames)
      .filter(([, r]) => r.agent_id === agentId)
      .map(([name]) => name)
      .sort();
  }

  /** All bare nicknames owned by an account (reserved + linked). */
  accountNicknames(accountId: string): string[] {
    return Object.entries(this.data.nicknames)
      .filter(([, r]) => r.account_id === accountId)
      .map(([name]) => name)
      .sort();
  }

  bindingOf(name: string): NicknameRecord | undefined {
    const bare = normalizeNickname(name);
    return bare ? this.data.nicknames[bare] : undefined;
  }

  /**
   * Bind (or rename to) a nickname for an agent — unique within this hub. Frees
   * the agent's previous nickname (one per agent). Taken by a DIFFERENT agent ⇒
   * `conflict`; malformed ⇒ `invalid`. This is the whole nickname model: local
   * hubs give easy local names, a central hub gives validated global names.
   */
  bindNickname(agentId: string, rawName: string): NicknameOutcome {
    const name = normalizeNickname(rawName);
    if (!name) return { ok: false, reason: "invalid" };
    const agent = this.data.agents[agentId];
    if (!agent) return { ok: false, reason: "invalid" };
    const existing = this.data.nicknames[name];
    if (existing && existing.agent_id !== agentId) return { ok: false, reason: "conflict", conflict: existing.agent_id };
    for (const [n, r] of Object.entries(this.data.nicknames)) {
      if (r.agent_id === agentId && n !== name) delete this.data.nicknames[n];
    }
    this.data.nicknames[name] = { agent_id: agentId, account_id: agent.account_id ?? null, bound_at: nowIso() };
    agent.speaking_as = name;
    this.save();
    return { ok: true, nickname: formatNickname(name) };
  }

  /**
   * Resolve an agent reference — agent_id, '@nickname', or bare nickname —
   * to an agent_id. Null when nothing matches (callers map this to
   * E_UNKNOWN_AGENT).
   */
  resolveAgentId(ref: string): string | null {
    if (this.data.agents[ref]) return ref;
    const name = normalizeNickname(ref);
    if (name) return this.data.nicknames[name]?.agent_id ?? null;
    return null;
  }

  // --- contact graph (spec §4) ------------------------------------------

  getContact(a: string, b: string): { state: ContactState } {
    return this.data.contacts[pairKey(a, b)] ?? { state: "none" };
  }

  shareContact(from: string, to: string): ContactRecord {
    const key = pairKey(from, to);
    const existing = this.data.contacts[key];
    if (existing) {
      // Mutual share: both sides requested independently ⇒ linked.
      if (existing.state === "pending" && existing.initiator === to) {
        existing.state = "linked";
        existing.updated_at = nowIso();
        this.save();
      }
      // Otherwise idempotent; a blocked edge stays blocked (A cannot re-request).
      return existing;
    }
    const record: ContactRecord = { state: "pending", initiator: from, updated_at: nowIso() };
    this.data.contacts[key] = record;
    this.save();
    return record;
  }

  /** `responder` answers a request from `requester`. accept ⇒ linked; decline ⇒ none. */
  respondContact(responder: string, requester: string, accept: boolean): { state: ContactState } {
    const key = pairKey(responder, requester);
    const existing = this.data.contacts[key];
    if (!existing) return { state: "none" };
    if (accept) {
      if (existing.state === "pending" && existing.initiator === requester) {
        existing.state = "linked";
        existing.updated_at = nowIso();
        this.save();
      }
      return existing;
    }
    // Decline a pending request, or remove a linked edge: either way ⇒ none.
    delete this.data.contacts[key];
    this.save();
    return { state: "none" };
  }

  linkedContacts(agentId: string): string[] {
    return this.counterparties(agentId, (r) => r.state === "linked");
  }

  /** Agent ids with an incoming pending request for `agentId` to answer. */
  pendingRequests(agentId: string): string[] {
    return this.counterparties(agentId, (r) => r.state === "pending" && r.initiator !== agentId);
  }

  private counterparties(agentId: string, match: (r: ContactRecord) => boolean): string[] {
    const out: string[] = [];
    for (const [key, record] of Object.entries(this.data.contacts)) {
      if (!match(record)) continue;
      const [a, b] = key.split("|") as [string, string];
      if (a === agentId) out.push(b);
      else if (b === agentId) out.push(a);
    }
    return out;
  }

  // --- profile friendships (spec §"friends") ------------------------------

  setAutoAccept(accountId: string, on: boolean): void {
    const account = this.data.accounts[accountId];
    if (account) {
      account.auto_accept = on;
      this.save();
    }
  }

  getAutoAccept(accountId: string): boolean {
    return this.data.accounts[accountId]?.auto_accept ?? false;
  }

  /** `from` requests friendship with `to`. Mutual request ⇒ linked; else pending. */
  requestFriend(from: string, to: string): { state: FriendshipRecord["state"] | "self" } {
    if (from === to) return { state: "self" };
    const key = pairKey(from, to);
    const existing = this.data.friendships[key];
    if (existing) {
      if (existing.state === "pending" && existing.initiator === to) {
        existing.state = "linked";
        existing.updated_at = nowIso();
        this.save();
      }
      return { state: existing.state };
    }
    this.data.friendships[key] = { state: "pending", initiator: from, policy: "allow_all", updated_at: nowIso() };
    this.save();
    return { state: "pending" };
  }

  /** `responder` answers a request from `requester`. accept ⇒ linked; else removed. */
  respondFriend(responder: string, requester: string, accept: boolean): { state: FriendshipRecord["state"] | "none" } {
    const key = pairKey(responder, requester);
    const existing = this.data.friendships[key];
    if (!existing) return { state: "none" };
    if (accept) {
      if (existing.state === "pending" && existing.initiator === requester) {
        existing.state = "linked";
        existing.updated_at = nowIso();
        this.save();
      }
      return { state: existing.state };
    }
    delete this.data.friendships[key];
    this.save();
    return { state: "none" };
  }

  areAccountsLinked(a: string | null | undefined, b: string | null | undefined): boolean {
    if (!a || !b) return false;
    return this.data.friendships[pairKey(a, b)]?.state === "linked";
  }

  /** Linked friend account ids of `accountId`. */
  friendAccountsOf(accountId: string): string[] {
    const out: string[] = [];
    for (const [key, rec] of Object.entries(this.data.friendships)) {
      if (rec.state !== "linked") continue;
      const [a, b] = key.split("|") as [string, string];
      if (a === accountId) out.push(b);
      else if (b === accountId) out.push(a);
    }
    return out;
  }

  /** All of an account's friendships bucketed for the UI. */
  listFriendships(accountId: string): { linked: string[]; incoming: string[]; outgoing: string[] } {
    const linked: string[] = [];
    const incoming: string[] = [];
    const outgoing: string[] = [];
    for (const [key, rec] of Object.entries(this.data.friendships)) {
      const [a, b] = key.split("|") as [string, string];
      const other = a === accountId ? b : b === accountId ? a : null;
      if (!other) continue;
      if (rec.state === "linked") linked.push(other);
      else if (rec.initiator === accountId) outgoing.push(other);
      else incoming.push(other);
    }
    return { linked, incoming, outgoing };
  }

  // --- durable inboxes ----------------------------------------------------

  inboxAppend(agentId: string, envelope: Envelope): void {
    (this.data.inboxes[agentId] ??= []).push(envelope);
    this.save();
  }

  /** Drain the inbox (caller becomes responsible for the envelopes). */
  inboxTakeAll(agentId: string): Envelope[] {
    const envelopes = this.data.inboxes[agentId] ?? [];
    if (envelopes.length > 0) {
      this.data.inboxes[agentId] = [];
      this.save();
    }
    return envelopes;
  }

  /** Put un-acked envelopes back at the front (socket dropped mid-delivery). */
  inboxPrepend(agentId: string, envelopes: Envelope[]): void {
    if (envelopes.length === 0) return;
    this.data.inboxes[agentId] = [...envelopes, ...(this.data.inboxes[agentId] ?? [])];
    this.save();
  }
}
