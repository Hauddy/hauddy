import type {
  ActivityEntry,
  AddContactResult,
  Attachment,
  BookContact,
  ClaimLogEntry,
  ClaimRow,
  ConsoleCallPoll,
  ConsoleMessage,
  EnrolledAgent,
  ExposureRow,
  FriendActionResult,
  FriendsView,
  HumanIdentity,
  LinkResult,
  PlatformActionResult,
  PlatformInfo,
  PoolContact,
  RoutingStatus,
} from './types';

/**
 * Real client for the sidecar daemon's local API (see
 * `@hauddy/app` local-api.ts). Same method signatures and types as the
 * mock, so components are unchanged. Base URL overridable for dev.
 */
const BASE =
  (import.meta.env.VITE_HAUDDY_API as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:7700';

async function get<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

// --- reactivity: poll on an interval + bump after mutations --------------

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

export const httpStore = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    if (!timer) timer = setInterval(emit, 1200);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0 && timer) {
        clearInterval(timer);
        timer = null;
      }
    };
  },
  getVersion: (): number => version,
};

export const httpApi = {
  // ---- agents & linking ----
  listAgents: () => get<EnrolledAgent[]>('/api/agents'),
  async linkNickname(localId: string, nickname: string, replace = false): Promise<LinkResult> {
    const result = await post<LinkResult>('/api/link', { localId, nickname, replace });
    bump();
    return result;
  },

  // ---- profile contact pool (derived: local agents ∪ friends' agents) ----
  listPool: () => get<PoolContact[]>('/api/contacts'),
  /** Unlink a pooled contact from every agent's book at once. */
  async removeContactEverywhere(handle: string): Promise<{ ok: boolean; removed: number }> {
    const result = await post<{ ok: boolean; removed: number }>('/api/contacts/remove-everywhere', { handle });
    bump();
    return result;
  },

  // ---- friends (profile↔profile links) ----
  listFriends: () => get<FriendsView | null>('/api/friends'),
  async requestFriend(handle: string): Promise<FriendActionResult> {
    const result = await post<FriendActionResult>('/api/friends/request', { handle });
    bump();
    return result;
  },
  async respondFriend(accountId: string, accept: boolean): Promise<FriendActionResult> {
    const result = await post<FriendActionResult>('/api/friends/respond', { accountId, accept });
    bump();
    return result;
  },
  async setAutoAccept(on: boolean): Promise<void> {
    await post('/api/friends/auto-accept', { autoAccept: on });
    bump();
  },

  // ---- human console (message/call agents as the person) ----
  humanIdentity: () => get<HumanIdentity>('/api/human'),
  async humanSms(to: string, body: string, attachments?: Attachment[]): Promise<{ status?: string; error?: string }> {
    return post('/api/human/sms', { to, body, ...(attachments && attachments.length ? { attachments } : {}) });
  },
  /** Stage a file to send: uploads bytes to the daemon (which puts them on the
   *  right hub for `to`) and returns the reference to pass to humanSms. */
  async uploadHumanFile(file: File, to: string): Promise<Attachment> {
    const qs = new URLSearchParams({ name: file.name, mime: file.type || 'application/octet-stream', to });
    const res = await fetch(`${BASE}/api/human/upload?${qs.toString()}`, { method: 'POST', body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `upload HTTP ${res.status}`);
    return (await res.json()) as Attachment;
  },
  /** A direct URL to download a received attachment (served by the daemon). */
  humanFileUrl: (fileId: string): string => `${BASE}/api/human/file/${encodeURIComponent(fileId)}`,
  humanInbox: () => get<{ messages: ConsoleMessage[] }>('/api/human/inbox'),
  async humanCall(to: string): Promise<{ status?: string; call_id?: string; error?: string }> {
    return post('/api/human/call', { to });
  },
  async humanSay(text: string, attachments?: Attachment[]): Promise<{ ok?: boolean }> {
    return post('/api/human/call/say', { text, ...(attachments && attachments.length ? { attachments } : {}) });
  },
  humanPollCall: () => get<ConsoleCallPoll>('/api/human/call/poll'),
  async humanPickup(callId: string, peer: string, hub: 'local' | 'platform'): Promise<{ ok?: boolean }> {
    return post('/api/human/call/pickup', { call_id: callId, peer, hub });
  },
  async humanHangup(): Promise<{ ok?: boolean }> {
    return post('/api/human/call/hangup');
  },

  // ---- per-agent contact books ----
  listBook: (localId: string) =>
    get<BookContact[]>(`/api/agents/${encodeURIComponent(localId)}/contacts`),
  listBookable: (localId: string) =>
    get<PoolContact[]>(`/api/agents/${encodeURIComponent(localId)}/bookable`),
  async addContact(localId: string, handle: string): Promise<AddContactResult> {
    const result = await post<AddContactResult>(
      `/api/agents/${encodeURIComponent(localId)}/contacts`,
      { handle },
    );
    bump();
    return result;
  },
  async removeContact(localId: string, handle: string): Promise<void> {
    await post(`/api/agents/${encodeURIComponent(localId)}/contacts/remove`, { handle });
    bump();
  },

  // ---- per-agent profile / lifecycle / log ----
  async setAgentDescription(localId: string, description: string): Promise<{ ok: boolean; error?: string }> {
    const result = await post<{ ok: boolean; error?: string }>(
      `/api/agents/${encodeURIComponent(localId)}/description`,
      { description },
    );
    bump();
    return result;
  },
  async deleteAgent(localId: string): Promise<{ ok: boolean; error?: string }> {
    const result = await post<{ ok: boolean; error?: string }>(
      `/api/agents/${encodeURIComponent(localId)}/delete`,
    );
    bump();
    return result;
  },
  agentLog: (localId: string) => get<ActivityEntry[]>(`/api/agents/${encodeURIComponent(localId)}/log`),

  // ---- claims ----
  listClaims: () => get<ClaimRow[]>('/api/claims'),
  listClaimLog: () => get<ClaimLogEntry[]>('/api/claim-log'),
  getFlashClaim: () => get<string | null>('/api/flash-claim'),
  async forceClaim(nickname: string): Promise<void> {
    await post('/api/claims/force', { nickname });
    bump();
  },
  async releaseClaim(nickname: string): Promise<void> {
    await post('/api/claims/release', { nickname });
    bump();
  },

  // ---- platform link ("go online": connect + expose) ----
  getPlatform: () => get<PlatformInfo>('/api/platform'),
  async connectPlatform(input: { email?: string; apiKey?: string }): Promise<PlatformActionResult> {
    const result = await post<PlatformActionResult>('/api/platform/connect', input);
    bump();
    return result;
  },
  async disconnectPlatform(): Promise<void> {
    await post('/api/platform/disconnect');
    bump();
  },
  async rotatePlatformKey(): Promise<PlatformActionResult> {
    const result = await post<PlatformActionResult>('/api/platform/rotate');
    bump();
    return result;
  },
  listExposure: () => get<ExposureRow[]>('/api/platform/exposure'),
  async expose(localId: string): Promise<PlatformActionResult> {
    const result = await post<PlatformActionResult>('/api/platform/expose', { localId });
    bump();
    return result;
  },
  async unexpose(localId: string): Promise<PlatformActionResult> {
    const result = await post<PlatformActionResult>('/api/platform/unexpose', { localId });
    bump();
    return result;
  },

  // ---- diagnostics ----
  getRouting: () => get<RoutingStatus>('/api/routing'),
  listActivity: () => get<ActivityEntry[]>('/api/activity'),
};
