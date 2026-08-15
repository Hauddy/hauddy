import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import type {
  AccountKey,
  Agent,
  BookContact,
  Contact,
  ContactActionResult,
  Nickname,
  NicknameAvailability,
  NicknameOutcome,
  PendingContact,
  ReserveOutcome,
  UserProfile,
} from './types';

/**
 * Real client for the Hauddy platform (network hub) control API. The dashboard
 * is authenticated by a platform **API key** (issued by the app when it
 * connects, or created here by email), stored in localStorage and sent as a
 * Bearer token. Base URL is `VITE_HAUDDY_PLATFORM` (dev default :8790).
 */

const BASE =
  ((import.meta.env.VITE_HAUDDY_PLATFORM as string | undefined) ?? 'https://api.hauddy.com').replace(
    /\/$/,
    '',
  );

/** The platform origin (e.g. https://api.hauddy.com) — for connector setup
 *  snippets (the /mcp URL + curl examples shown on the Account screen). */
export function apiBase(): string {
  return BASE;
}

/** A connector token as listed on the Account screen (raw token shown only once,
 *  at creation). `handle` is its fixed @identity; `scope` is a csv of send/read/files. */
export interface ConnectorInfo {
  masked: string;
  handle: string | null;
  agent_id: string;
  label: string | null;
  scope: string;
  /** The paired OAuth client_id (client_credentials grant), if minted. */
  client_id: string | null;
  created_at: string;
  last_used_ms: number | null;
}

/** OAuth credentials returned once alongside a fresh/rotated connector, so a
 *  browserless agent can run the client_credentials grant instead of a redirect. */
export interface ConnectorOAuth {
  client_id: string | null;
  client_secret: string | null;
  token_endpoint: string;
}

// ---- auth: the platform API key -----------------------------------------

const KEY_STORAGE = 'hauddy.platformKey';

export function getKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}
function setKey(key: string): void {
  try {
    localStorage.setItem(KEY_STORAGE, key);
  } catch {
    /* storage unavailable */
  }
  bump();
}
export function clearKey(): void {
  try {
    localStorage.removeItem(KEY_STORAGE);
  } catch {
    /* storage unavailable */
  }
  bump();
}
export function isAuthed(): boolean {
  return !!getKey();
}

function authHeaders(): Record<string, string> {
  const key = getKey();
  return key ? { authorization: `Bearer ${key}` } : {};
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path, { headers: authHeaders() });
  if (res.status === 401) clearKey(); // revoked/invalid key → sign out
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}
async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...authHeaders(),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) clearKey();
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** Authed POST that surfaces the server's `error` string instead of throwing —
 *  for settings mutations where the message matters (username taken, wrong
 *  password). A real 401 (bad key) still signs you out; other non-2xx return the
 *  server message. The password route uses 403 for a wrong current password so
 *  it never trips the 401 sign-out. */
async function postResult(path: string, body: unknown): Promise<ContactActionResult> {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...authHeaders() },
      body: JSON.stringify(body),
    });
    if (res.status === 401) {
      clearKey();
      return { ok: false, error: 'Session expired — sign in again.' };
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    if (!res.ok) return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
    return { ok: true };
  } catch {
    return { ok: false, error: `Platform unreachable at ${BASE}.` };
  }
}

// ---- reactivity: poll on an interval + bump after mutations --------------

// The dashboard re-fetches on this heartbeat, so keep it gentle and skip it
// entirely while the tab is backgrounded (Page Visibility) — an open-but-hidden
// tab should make zero requests. Refocusing refreshes immediately.
const POLL_MS = 30_000;
let version = 0;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
function emit() {
  version += 1;
  for (const l of listeners) l();
}
function bump() {
  emit();
}
function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}
function tick() {
  if (pageHidden()) return; // don't poll a backgrounded tab
  emit();
}
function onVisibility() {
  if (!pageHidden()) emit(); // refresh right away when the tab comes back
}
const store = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!timer) {
      timer = setInterval(tick, POLL_MS);
      if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisibility);
    }
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisibility);
      }
    };
  },
  getVersion: (): number => version,
};

// ---- hub response shapes (subset we consume) ----------------------------

interface HubAgent {
  agent_id: string;
  nickname: string | null;
  description: string | null;
  attached: boolean;
  kind?: string;
  open_link?: boolean;
  listed?: boolean;
  external_links?: number;
  grant_scope_id?: string;
  local_id?: string | null;
  // Owner-only, present on kind='connector' agents in /accounts/me.
  connector?: { masked: string; scope: string; client_id: string | null; last_used_ms: number | null } | null;
}
interface HubAccount {
  username: string | null;
  email: string;
  masked: string;
  agents: HubAgent[];
  reservations?: string[]; // '@handle's held but not yet attached to an agent
  // The account's own human identity: its @handle (== username) + bio. The
  // agent lists below filter out kind:'human' so it doesn't masquerade as an agent.
  human?: { nickname: string | null; description: string | null };
}
interface HubContactEntry {
  agent_id: string;
  display_name: string | null;
  nickname: string | null;
  presence: Presence;
}
type Presence = 'online' | 'delay' | 'offline';

const toAgent = (a: HubAgent): Agent => ({
  id: a.agent_id,
  nickname: a.nickname ?? '',
  description: a.description ?? '',
  online: a.attached,
  kind: a.kind,
  openLink: a.open_link,
  listed: a.listed,
  externalLinks: a.external_links,
  grantScopeId: a.grant_scope_id,
  localId: a.local_id ?? null,
  connector: a.connector
    ? {
        masked: a.connector.masked,
        scope: a.connector.scope,
        clientId: a.connector.client_id,
        lastUsedMs: a.connector.last_used_ms,
      }
    : null,
});

// Coalesce `/accounts/me`: five methods (getSession, getAccountKey, listAgents,
// listNicknames, nicknamesOverview) each need it, and every mounted `useApiData`
// hook re-fetches on the same store `version` (heartbeat tick or a mutation's
// bump). Left unshared that's ~4-5 identical requests per cycle — historically
// ~37% of ALL platform traffic. Caching the promise keyed by `version` collapses
// a whole cycle to ONE network request shared by all callers; a new version
// (next tick or a mutation) invalidates it so data stays fresh. Failures aren't
// cached — the next caller retries.
let acctCache: { version: number; promise: Promise<HubAccount> } | null = null;
function accountMe(): Promise<HubAccount> {
  if (acctCache && acctCache.version === version) return acctCache.promise;
  const forVersion = version;
  const promise = get<HubAccount>('/accounts/me').catch((err) => {
    if (acctCache && acctCache.version === forVersion) acctCache = null;
    throw err;
  });
  acctCache = { version: forVersion, promise };
  return promise;
}

// ---- friends + human console shapes (spec §"friends" / §"human messaging") --

export interface FriendAccount {
  account_id: string;
  email: string | null;
}
/** A friend's agent as it appears in the friends view — a narrowed agentView.
 *  The hub sends the full view; we consume the fields the friend UI needs. */
export interface FriendAgent {
  agent_id: string;
  nickname: string | null;
  kind?: string;
  description?: string | null;
  attached?: boolean;
  open_link?: boolean;
}
export interface LinkedFriend extends FriendAccount {
  // Every agent the friend has on the platform: their exposed agents (kind:'agent')
  // + their human identity (kind:'human'), which carries their @handle + bio in
  // `nickname`/`description`.
  agents: FriendAgent[];
}
export interface FriendsView {
  auto_accept: boolean;
  linked: LinkedFriend[];
  incoming: FriendAccount[];
  outgoing: FriendAccount[];
  /** Per-agent open links you've been granted (you reach only that agent). */
  linked_agents?: FriendAgent[];
}

/** A friend's human identity — where their @handle (`nickname`) + bio
 *  (`description`) live. `undefined` if they've never opened a console. */
export function friendHuman(friend: LinkedFriend): FriendAgent | undefined {
  return friend.agents.find((a) => a.kind === 'human');
}
export interface Attachment {
  file_id: string;
  name: string;
  mime: string;
  size: number;
}
export interface ConsoleMessage {
  id: string;
  from: string;
  to: string;
  ts: string;
  payload: { body?: string; call?: unknown; attachments?: Attachment[] };
}
export interface ConsoleCallFrame {
  id: string;
  kind: string;
  from: string;
  body?: unknown;
  attachments?: Attachment[];
}
export interface ConsoleCallPoll {
  frames: ConsoleCallFrame[];
  ended?: boolean;
  active?: boolean;
  call_id?: string | null;
}

// ---- persistent history (spec §E): browsable threads + call log ----------
export interface ThreadSummary {
  peer_id: string;
  peer_nick: string;
  last_body: string | null;
  last_ts: number;
  has_attach: boolean;
  unread: number;
}
export interface ThreadMessage {
  id: string;
  from_agent: string;
  mine: boolean;
  body: string | null;
  attachments?: Attachment[] | null;
  ts: number;
  created_at: string;
  /** Sender-side delivery ticks: `delivered_at` set on recipient ack, `read_at`
   *  only when a console-human opens the thread (null for agent recipients). */
  delivered_at: string | null;
  read_at: string | null;
}
export interface CallLogEntry {
  call_id: string;
  direction: 'incoming' | 'outgoing';
  peer_id: string;
  peer_nick: string;
  state: string; // ringing | active | ended | missed | declined
  started_ms: number;
  answered_ms: number | null;
  ended_ms: number | null;
  end_reason: string | null;
  frames?: { seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }[];
}
export interface Notifications {
  friend_requests: number;
  unread_messages: number;
  missed_calls: number;
}

export interface DashboardResult {
  threads: ThreadSummary[];
  notifications: Notifications;
  friends: FriendsView;
  agents: Agent[];
  platform_agents: Agent[];
}

// ---- auth actions (used by the Login screen) ----------------------------
// Identity lives on the platform: sign up (username + email + password), or log
// in (username-or-email + password). Both return the account's stable API key,
// stored locally as the Bearer — and shown on the Account screen to copy into
// the app.

async function authRequest(path: string, body: unknown): Promise<ContactActionResult> {
  try {
    const res = await fetch(BASE + path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as { api_key?: string; error?: string };
    if (!res.ok || !data.api_key) return { ok: false, error: data.error ?? 'Request failed.' };
    setKey(data.api_key);
    return { ok: true };
  } catch {
    return { ok: false, error: `Platform unreachable at ${BASE}.` };
  }
}

export function signup(input: { username: string; email: string; password: string }): Promise<ContactActionResult> {
  return authRequest('/accounts', input);
}

export function login(input: { login: string; password: string }): Promise<ContactActionResult> {
  return authRequest('/accounts/login', input);
}

/** The full API key the web holds (its Bearer) — to copy into the Hauddy app. */
export function revealKey(): string | null {
  return getKey();
}

// ---- the API surface components code against ----------------------------

export const api = {
  async getSession(): Promise<UserProfile> {
    const acct = await accountMe();
    return { email: acct.email, name: acct.username ?? acct.email.split('@')[0] ?? acct.email };
  },

  async getAccountKey(): Promise<AccountKey> {
    const acct = await accountMe();
    return { masked: acct.masked };
  },

  async rotateKey(): Promise<void> {
    const res = await post<{ api_key: string }>('/accounts/rotate');
    setKey(res.api_key);
  },

  async revokeKey(): Promise<void> {
    await post('/accounts/revoke').catch(() => {});
    clearKey();
  },

  // ---- connector tokens (scoped bearer creds for /v1 + /mcp) --------------
  async listConnectors(): Promise<ConnectorInfo[]> {
    const r = await get<{ connectors: ConnectorInfo[] }>('/accounts/connectors');
    return r.connectors;
  },
  /** Mint a connector: a fixed @handle identity + a scoped token (shown once) +
   *  a paired OAuth client_id/secret for headless (client_credentials) use. */
  async createConnector(input: {
    label?: string;
    scope: string[];
    handle: string;
  }): Promise<
    | { ok: true; token: string; handle: string; oauth: ConnectorOAuth; mcpUrl: string }
    | { ok: false; error: string }
  > {
    try {
      const res = await fetch(BASE + '/accounts/connectors', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify(input),
      });
      if (res.status === 401) {
        clearKey();
        return { ok: false, error: 'Session expired — sign in again.' };
      }
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        handle?: string;
        client_id?: string | null;
        client_secret?: string | null;
        token_endpoint?: string;
        mcp_url?: string;
        error?: string;
      };
      if (!res.ok || !data.token) return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
      bump();
      return {
        ok: true,
        token: data.token,
        handle: data.handle ?? input.handle,
        oauth: {
          client_id: data.client_id ?? null,
          client_secret: data.client_secret ?? null,
          token_endpoint: data.token_endpoint ?? BASE + '/oauth/token',
        },
        mcpUrl: data.mcp_url ?? BASE + '/mcp',
      };
    } catch {
      return { ok: false, error: `Platform unreachable at ${BASE}.` };
    }
  },
  /** Rotate a connector's bearer token (and paired OAuth secret) in place — same
   *  @handle. Returns the new creds once; old ones stop working immediately. */
  async rotateConnector(
    agentId: string,
  ): Promise<{ ok: true; token: string; oauth: ConnectorOAuth } | { ok: false; error: string }> {
    try {
      const res = await fetch(BASE + '/accounts/connectors/rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ agent_id: agentId }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        token?: string;
        client_id?: string | null;
        client_secret?: string | null;
        token_endpoint?: string;
        error?: string;
      };
      if (!res.ok || !data.token) return { ok: false, error: data.error ?? `Request failed (${res.status}).` };
      bump();
      return {
        ok: true,
        token: data.token,
        oauth: {
          client_id: data.client_id ?? null,
          client_secret: data.client_secret ?? null,
          token_endpoint: data.token_endpoint ?? BASE + '/oauth/token',
        },
      };
    } catch {
      return { ok: false, error: `Platform unreachable at ${BASE}.` };
    }
  },
  async revokeConnector(agentId: string): Promise<void> {
    await post('/accounts/connectors/revoke', { agent_id: agentId }).catch(() => {});
    bump();
  },

  async listAgents(): Promise<Agent[]> {
    const acct = await accountMe();
    // Hide the account's own human identity — it's the user's @handle (shown in
    // Settings), not a messageable/exposable agent.
    return acct.agents.filter((a) => a.kind !== 'human').map(toAgent);
  },

  /** The user's own @handle (== username) + bio, for the Settings screen. */
  async getIdentity(): Promise<{ handle: string | null; bio: string }> {
    const acct = await accountMe();
    return { handle: acct.human?.nickname ?? null, bio: acct.human?.description ?? '' };
  },

  /** One of your agents by id (from the coalesced /accounts/me), for the agent page. */
  async getAgentById(id: string): Promise<Agent | null> {
    const acct = await accountMe();
    const a = acct.agents.find((x) => x.agent_id === id && x.kind !== 'human');
    return a ? toAgent(a) : null;
  },
  /** Assign/replace an agent's @handle (owner-scoped). bindNickname is
   *  reservation-aware: your own matching reservation is consumed on bind. */
  async setAgentNickname(agentId: string, name: string): Promise<NicknameOutcome> {
    try {
      const r = await post<NicknameOutcome>(`/accounts/agents/${encodeURIComponent(agentId)}/nickname`, {
        nickname: name,
      });
      if (r.ok) bump();
      return r;
    } catch {
      return { ok: false, reason: 'invalid' };
    }
  },
  /** Edit an agent's bio and/or its external auto-accept flag (owner-scoped). */
  async setAgentSettings(
    agentId: string,
    patch: { bio?: string; open_link?: boolean; listed?: boolean },
  ): Promise<ContactActionResult> {
    const r = await postResult(`/accounts/agents/${encodeURIComponent(agentId)}/settings`, patch);
    if (r.ok) bump();
    return r;
  },
  /** Remove an agent from the network (unexpose). */
  async unexposeAgent(agentId: string): Promise<ContactActionResult> {
    const r = await postResult(`/accounts/agents/${encodeURIComponent(agentId)}/remove`, {});
    if (r.ok) bump();
    return r;
  },

  // ---- per-agent contact book (curates the agent's list_contacts) ----------
  /** An agent's curated book + the reachable candidates to add from. */
  getAgentBook(agentId: string): Promise<{ book: BookContact[]; bookable: BookContact[] }> {
    return get<{ book: BookContact[]; bookable: BookContact[] }>(
      `/accounts/agents/${encodeURIComponent(agentId)}/book`,
    );
  },
  async addAgentBookContact(agentId: string, handle: string): Promise<ContactActionResult> {
    const r = await postResult(`/accounts/agents/${encodeURIComponent(agentId)}/book`, { handle });
    if (r.ok) bump();
    return r;
  },
  async removeAgentBookContact(agentId: string, handle: string): Promise<ContactActionResult> {
    const r = await postResult(`/accounts/agents/${encodeURIComponent(agentId)}/book/remove`, { handle });
    if (r.ok) bump();
    return r;
  },

  async getAgent(nickname: string): Promise<Agent | null> {
    const name = nickname.startsWith('@') ? nickname : `@${nickname}`;
    const agents = await this.listAgents();
    return agents.find((a) => a.nickname === name) ?? null;
  },

  async listNicknames(): Promise<Nickname[]> {
    const acct = await accountMe();
    return acct.agents
      .filter((a) => a.nickname && a.kind !== 'human')
      .map((a) => ({
        agentId: a.agent_id,
        name: a.nickname as string,
        description: a.description,
        online: a.attached,
      }));
  },

  async renameNickname(agentId: string, name: string): Promise<NicknameOutcome> {
    return post<NicknameOutcome>(`/agents/${encodeURIComponent(agentId)}/nickname`, {
      nickname: name,
    });
  },

  /** Bound nicknames + account-level reservations + agents, from ONE `/accounts/me`
   *  fetch (the Nicknames screen needs all three; keep it to a single request). */
  async nicknamesOverview(): Promise<{ bound: Nickname[]; reserved: string[]; agents: Agent[] }> {
    const acct = await accountMe();
    return {
      bound: acct.agents
        .filter((a) => a.nickname && a.kind !== 'human')
        .map((a) => ({
          agentId: a.agent_id,
          name: a.nickname as string,
          description: a.description,
          online: a.attached,
        })),
      reserved: acct.reservations ?? [],
      agents: acct.agents.filter((a) => a.kind !== 'human').map(toAgent),
    };
  },

  /** Live availability of a handle across bound + reserved (for the reserve input). */
  async checkNickname(name: string): Promise<NicknameAvailability> {
    return get<NicknameAvailability>(`/accounts/nicknames/check?name=${encodeURIComponent(name)}`);
  },

  /** Park a handle for the account (unattached). */
  async reserveNickname(name: string): Promise<ReserveOutcome> {
    const r = await post<ReserveOutcome>('/accounts/nicknames/reserve', { name });
    bump();
    return r;
  },

  /** Drop the account's hold on a handle. */
  async releaseReservation(name: string): Promise<{ ok: boolean }> {
    const r = await post<{ ok: boolean }>('/accounts/nicknames/release', { name });
    bump();
    return r;
  },

  /** Bind a reserved handle to one of the account's agents (consumes the hold). */
  async attachReservation(name: string, agentId: string): Promise<NicknameOutcome> {
    const r = await post<NicknameOutcome>('/accounts/nicknames/attach', {
      name,
      agent_id: agentId,
    });
    bump();
    return r;
  },

  /** Everyone on the platform (used to resolve pending requester ids → nicks). */
  async listPlatformAgents(): Promise<Agent[]> {
    const { agents } = await get<{ agents: HubAgent[] }>('/agents');
    return agents.map(toAgent);
  },

  /** One agent's network contacts (linked) + incoming pending requests. */
  async listAgentContacts(
    agentId: string,
  ): Promise<{ contacts: Contact[]; pending: PendingContact[] }> {
    const [{ contacts, pending }, everyone] = await Promise.all([
      get<{ contacts: HubContactEntry[]; pending: string[] }>(
        `/contacts/${encodeURIComponent(agentId)}`,
      ),
      this.listPlatformAgents(),
    ]);
    const byId = new Map(everyone.map((a) => [a.id, a]));
    return {
      contacts: contacts.map((c) => ({
        agentId: c.agent_id,
        nickname: c.nickname ?? c.agent_id,
        description: c.display_name ?? '',
        presence: c.presence,
      })),
      pending: pending.map((id) => {
        const a = byId.get(id);
        return { agentId: id, nickname: a?.nickname || id, description: a?.description ?? '' };
      }),
    };
  },

  async shareContact(fromAgentId: string, target: string): Promise<ContactActionResult> {
    try {
      await post('/contacts/share', { from: fromAgentId, agent_id: target });
      return { ok: true };
    } catch {
      return { ok: false, error: `No agent ${target} on the platform.` };
    }
  },

  async respondContact(
    responderAgentId: string,
    requester: string,
    accept: boolean,
  ): Promise<void> {
    await post('/contacts/respond', {
      from: responderAgentId,
      agent_id: requester,
      accept,
    }).catch(() => {});
  },

  // ---- friends (profile↔profile links, spec §"friends") ----
  listFriends(): Promise<FriendsView> {
    return get<FriendsView>('/accounts/friends');
  },
  async requestFriend(handle: string): Promise<{ state: string; error?: string }> {
    try {
      return await post<{ state: string }>('/accounts/friends/request', { handle });
    } catch {
      return { state: 'error', error: `No one with handle ${handle}.` };
    }
  },
  respondFriend(accountId: string, accept: boolean): Promise<{ state: string }> {
    return post<{ state: string }>('/accounts/friends/respond', { account_id: accountId, accept });
  },
  setAutoAccept(on: boolean): Promise<{ auto_accept: boolean }> {
    return post<{ auto_accept: boolean }>('/accounts/settings', { auto_accept: on });
  },

  // ---- account settings (Settings screen) ----
  /** Update the username (== your network @handle) and/or bio. A username change
   *  atomically rebinds the handle server-side; a clash rejects the whole change.
   *  Bumps so the header/session/handle reflect the change everywhere. */
  async updateProfile(patch: { username?: string; bio?: string }): Promise<ContactActionResult> {
    const r = await postResult('/accounts/profile', patch);
    if (r.ok) bump();
    return r;
  },
  /** Change the password. The server verifies `current` before setting `next`. */
  changePassword(current: string, next: string): Promise<ContactActionResult> {
    return postResult('/accounts/password', { current, next });
  },

  // ---- human console (message/call agents as the person, spec §"human") ----
  consoleSms(to: string, body: string, attachments?: Attachment[]): Promise<{ status?: string; error?: string }> {
    return post('/console/sms', { to, body, ...(attachments && attachments.length ? { attachments } : {}) });
  },
  consoleInbox(): Promise<{ messages: ConsoleMessage[] }> {
    return get<{ messages: ConsoleMessage[] }>('/console/inbox');
  },
  consoleCall(to: string): Promise<{ status?: string; call_id?: string; error?: string }> {
    return post('/console/call', { to });
  },
  consoleSay(text: string, attachments?: Attachment[]): Promise<{ ok?: boolean }> {
    return post('/console/call/say', { text, ...(attachments && attachments.length ? { attachments } : {}) });
  },
  /** Upload a file to the platform temp store (Bearer). Metadata as query params
   *  so the browser sends no custom request headers (no CORS preflight snag). */
  async uploadConsoleFile(file: File, to: string): Promise<Attachment> {
    const qs = new URLSearchParams({ name: file.name, mime: file.type || 'application/octet-stream', to, owner: 'human' });
    const res = await fetch(`${BASE}/files?${qs.toString()}`, { method: 'POST', headers: authHeaders(), body: file });
    if (res.status === 401) clearKey();
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string })?.error ?? `upload HTTP ${res.status}`);
    return (await res.json()) as Attachment;
  },
  /** Fetch a received attachment (Bearer) and save it — a plain <a download> can't
   *  carry the auth header, so we pull the blob and trigger the download. */
  async downloadConsoleFile(fileId: string, name: string): Promise<void> {
    const res = await fetch(`${BASE}/files/${encodeURIComponent(fileId)}`, { headers: authHeaders() });
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
  consolePoll(): Promise<ConsoleCallPoll> {
    return get<ConsoleCallPoll>('/console/call/poll');
  },
  consolePickup(callId: string, peer: string): Promise<{ ok?: boolean }> {
    return post('/console/call/pickup', { call_id: callId, peer });
  },
  consoleHangup(): Promise<{ ok?: boolean }> {
    return post('/console/call/hangup');
  },

  // ---- persistent history + notifications (spec §E / §F) ----
  // `as` (an owned agent_id) browses that agent's inbox instead of the human's.
  consoleThreads(as?: string | null): Promise<{ threads: ThreadSummary[] }> {
    return get<{ threads: ThreadSummary[] }>(`/console/threads${as ? `?as=${encodeURIComponent(as)}` : ''}`);
  },
  consoleThread(
    peer: string,
    opts?: { before?: number; limit?: number; as?: string | null },
  ): Promise<{ peer_id: string; peer_nick: string; messages: ThreadMessage[] }> {
    const qs = new URLSearchParams();
    if (opts?.before) qs.set('before', String(opts.before));
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.as) qs.set('as', opts.as);
    const q = qs.toString();
    return get(`/console/thread/${encodeURIComponent(peer)}${q ? `?${q}` : ''}`);
  },
  consoleCalls(opts?: { withFrames?: boolean; as?: string | null }): Promise<{ calls: CallLogEntry[] }> {
    const qs = new URLSearchParams();
    if (opts?.withFrames) qs.set('withFrames', '1');
    if (opts?.as) qs.set('as', opts.as);
    const q = qs.toString();
    return get<{ calls: CallLogEntry[] }>(`/console/calls${q ? `?${q}` : ''}`);
  },
  consoleNotifications(): Promise<Notifications> {
    return get<Notifications>('/console/notifications');
  },
  /** One-shot endpoint: threads + notifications + friends + agents + platform_agents
   *  consolidated into a single DO request (replaces 4–5 separate per-tick calls). */
  async consoleDashboard(opts?: { as?: string | null }): Promise<DashboardResult> {
    const qs = opts?.as ? `?as=${encodeURIComponent(opts.as)}` : '';
    const raw = await get<{
      threads: ThreadSummary[];
      notifications: Notifications;
      friends: FriendsView;
      agents: HubAgent[];
      platform_agents: HubAgent[];
    }>(`/console/dashboard${qs}`);
    return {
      threads: raw.threads,
      notifications: raw.notifications,
      friends: raw.friends,
      agents: raw.agents.filter((a) => a.kind !== 'human').map(toAgent),
      platform_agents: raw.platform_agents.map(toAgent),
    };
  },
  /** Acknowledge missed calls (clears their part of the badge). */
  consoleNotificationsSeen(): Promise<{ ok?: boolean }> {
    return post('/console/notifications/seen');
  },
};

/** The shape of the API surface, so a host app can supply an alternate backend. */
export type Api = typeof api;

/**
 * Replace part of the API surface at runtime. The **web** never calls this — it
 * keeps the platform (network-hub) implementation above. The **desktop app**
 * calls it once at boot with a local-daemon-backed adapter, so the exact same
 * screens (Messages/CallPanel/NotificationBell) run against the local hub. The
 * `api` const is a mutable object, so this Object.assigns the overrides in place
 * (methods keep `this === api`, so internal cross-calls hit the overrides too).
 */
export function configureApi(overrides: Partial<Api>): void {
  Object.assign(api, overrides);
}

// ---- hooks --------------------------------------------------------------

export function useAuthed(): boolean {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  return isAuthed();
}

export interface ApiState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | null;
  refetch: () => void;
}

/** Re-runs `fetcher` on the poll interval / after mutations. Tracks loading,
 *  error state, and provides a refetch handle for retries. */
export function useApiState<T>(fetcher: () => Promise<T>, deps: unknown[] = []): ApiState<T> {
  const v = useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  const [data, setData] = useState<T | undefined>(undefined);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<Error | null>(null);
  const [manualBump, setManualBump] = useState<number>(0);

  const refetch = useCallback(() => {
    setLoading(true);
    setManualBump((b) => b + 1);
  }, []);

  useEffect(() => {
    let live = true;
    // Set loading only if data is not present yet
    fetcher().then(
      (d) => {
        if (!live) return;
        setData(d);
        setError(null);
        setLoading(false);
      },
      (err) => {
        if (!live) return;
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      },
    );
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v, manualBump, ...deps]);

  return { data, loading, error, refetch };
}

/** Re-runs `fetcher` on the poll interval / after mutations. A failed fetch
 *  (platform down or unauthed) leaves the value `undefined`. */
export function useApiData<T>(fetcher: () => Promise<T>, deps: unknown[] = []): T | undefined {
  const { data } = useApiState(fetcher, deps);
  return data;
}

export function normalizeNickname(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  const withAt = trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
  return /^@[a-z0-9][a-z0-9_-]{1,31}$/.test(withAt) ? withAt : null;
}
