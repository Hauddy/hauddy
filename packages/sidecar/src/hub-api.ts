import type { ContactState, Presence } from "@hauddy/protocol";

export interface ContactEntry {
  agent_id: string;
  display_name: string | null;
  nickname: string | null;
  kind?: "human" | "agent";
  presence: Presence;
}

export interface ContactList {
  contacts: ContactEntry[];
  pending: string[];
}

export type NicknameOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: "taken" | "invalid" | "conflict"; conflict?: string };

export interface AgentView {
  agent_id: string;
  local_id: string | null;
  grant_scope_id: string;
  account_id: string | null;
  display_name: string | null;
  description: string | null;
  public_key: string;
  nickname: string | null;
  nicknames: string[];
  speaking_as: string | null;
  kind?: "human" | "agent";
  attached: boolean;
  can_receive_calls: boolean;
}

export interface AccountView {
  account_id: string;
  email: string;
  masked: string;
  revoked: boolean;
  agents: AgentView[];
}

export interface ClaimsView {
  claims: Array<{ nickname: string; claimedBy: string | null }>;
  log: Array<{ text: string }>;
}

function httpBase(endpoint: string): string {
  return endpoint.replace(/^ws/, "http");
}

async function request<T>(endpoint: string, method: string, path: string, body?: unknown, apiKey?: string): Promise<T> {
  const res = await fetch(httpBase(endpoint) + path, {
    method,
    headers: {
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = (await res.json()) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `hub returned HTTP ${res.status}`);
  return data;
}

// ---- file attachments (temp store, out-of-band from the WS) ----------------

export interface FileMetaInput {
  name: string;
  mime: string;
  /** Owner agent id (the sender). */
  owner: string;
  /** Recipient reference (agent id or '@nick') — used for platform download auth. */
  to?: string;
}

/** Upload bytes to a hub's temp file store; returns the store-scoped file id.
 *  `apiKey` is required on the platform (Bearer), omitted on the local hub. */
export async function uploadFile(
  endpoint: string,
  bytes: Uint8Array,
  meta: FileMetaInput,
  apiKey?: string,
): Promise<{ file_id: string; size: number }> {
  const res = await fetch(httpBase(endpoint) + "/files", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-hauddy-filename": encodeURIComponent(meta.name),
      "x-hauddy-mime": meta.mime,
      "x-hauddy-owner": meta.owner,
      ...(meta.to ? { "x-hauddy-to": encodeURIComponent(meta.to) } : {}),
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
    },
    body: bytes,
  });
  const data = (await res.json()) as { file_id: string; size: number; error?: string };
  if (!res.ok) throw new Error(data.error ?? `file upload HTTP ${res.status}`);
  return data;
}

/** Download bytes from a hub's temp file store by id. */
export async function downloadFile(
  endpoint: string,
  fileId: string,
  apiKey?: string,
): Promise<{ bytes: Buffer; name: string; mime: string }> {
  const res = await fetch(httpBase(endpoint) + "/files/" + encodeURIComponent(fileId), {
    headers: { ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
  });
  if (!res.ok) throw new Error(`file download HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const name = decodeURIComponent(res.headers.get("x-hauddy-filename") ?? "file");
  const mime = res.headers.get("content-type") ?? "application/octet-stream";
  return { bytes, name, mime };
}

// ---- registration (account OPTIONAL) ------------------------------------

export function registerAgent(
  endpoint: string,
  req: { grant_scope_id: string; public_key: string; nickname?: string; local_id?: string; display_name?: string; description?: string },
  apiKey?: string,
): Promise<{ agent_id: string; nickname: string | null }> {
  return request(endpoint, "POST", "/register", req, apiKey);
}

// ---- local hub surface (no auth) ----------------------------------------

export function listAgents(endpoint: string): Promise<{ agents: AgentView[] }> {
  return request(endpoint, "GET", "/agents");
}

/** Bind/rename an agent's nickname (unique within the hub). */
export function setNickname(endpoint: string, agentId: string, nickname: string): Promise<NicknameOutcome> {
  return request(endpoint, "POST", `/agents/${encodeURIComponent(agentId)}/nickname`, { nickname });
}

export function updateProfile(
  endpoint: string,
  agentId: string,
  profile: { display_name?: string; description?: string },
): Promise<{ ok: boolean }> {
  return request(endpoint, "POST", `/agents/${encodeURIComponent(agentId)}/profile`, profile);
}

export function getClaims(endpoint: string): Promise<ClaimsView> {
  return request(endpoint, "GET", "/claims");
}

export function releaseClaim(endpoint: string, nickname: string): Promise<{ ok: boolean }> {
  return request(endpoint, "POST", "/claims/release", { nickname });
}

// ---- contact graph ------------------------------------------------------

export function shareContact(endpoint: string, from: string, agentId: string): Promise<{ state: ContactState }> {
  return request(endpoint, "POST", "/contacts/share", { from, agent_id: agentId });
}

export function respondContact(
  endpoint: string,
  from: string,
  agentId: string,
  accept: boolean,
): Promise<{ state: ContactState }> {
  return request(endpoint, "POST", "/contacts/respond", { from, agent_id: agentId, accept });
}

export function getPresence(endpoint: string, requester: string, agentId: string): Promise<Presence> {
  return request(endpoint, "GET", `/presence/${encodeURIComponent(agentId)}?for=${encodeURIComponent(requester)}`);
}

export function listContacts(endpoint: string, agentId: string): Promise<ContactList> {
  return request(endpoint, "GET", `/contacts/${encodeURIComponent(agentId)}`);
}

// ---- accounts (global "go online" tier — deferred) ----------------------

export function createAccount(endpoint: string, email: string): Promise<{ account_id: string; api_key: string; masked: string }> {
  return request(endpoint, "POST", "/accounts", { email });
}

export function rotateKey(endpoint: string, apiKey: string): Promise<{ api_key: string; masked: string }> {
  return request(endpoint, "POST", "/accounts/rotate", {}, apiKey);
}

export function revokeKey(endpoint: string, apiKey: string): Promise<{ ok: boolean }> {
  return request(endpoint, "POST", "/accounts/revoke", {}, apiKey);
}

export function getAccount(endpoint: string, apiKey: string): Promise<AccountView> {
  return request(endpoint, "GET", "/accounts/me", undefined, apiKey);
}

/** Remove one of the account's agents from the platform (unexpose). */
export function unexposeAgent(endpoint: string, agentId: string, apiKey: string): Promise<{ ok: boolean }> {
  return request(endpoint, "POST", `/accounts/agents/${encodeURIComponent(agentId)}/remove`, {}, apiKey);
}

// ---- profile friendships (spec §"friends") ------------------------------

export interface FriendAccount {
  account_id: string;
  email: string | null;
}
export interface LinkedFriend extends FriendAccount {
  agents: AgentView[];
}
export interface FriendsView {
  auto_accept: boolean;
  linked: LinkedFriend[];
  incoming: FriendAccount[];
  outgoing: FriendAccount[];
}

export function requestFriend(endpoint: string, handle: string, apiKey: string): Promise<{ state: string }> {
  return request(endpoint, "POST", "/accounts/friends/request", { handle }, apiKey);
}

export function respondFriend(endpoint: string, accountId: string, accept: boolean, apiKey: string): Promise<{ state: string }> {
  return request(endpoint, "POST", "/accounts/friends/respond", { account_id: accountId, accept }, apiKey);
}

export function listFriends(endpoint: string, apiKey: string): Promise<FriendsView> {
  return request(endpoint, "GET", "/accounts/friends", undefined, apiKey);
}

export function setAutoAccept(endpoint: string, autoAccept: boolean, apiKey: string): Promise<{ auto_accept: boolean }> {
  return request(endpoint, "POST", "/accounts/settings", { auto_accept: autoAccept }, apiKey);
}
