import {
  configureApi,
  type Agent,
  type Api,
  type Attachment,
  type BookContact,
  type CallLogEntry,
  type ConsoleCallPoll,
  type ConsoleMessage,
  type DashboardResult,
  type FriendsView,
  type Notifications,
  type ThreadItem,
  type ThreadMessage,
  type ThreadSummary,
} from '@hauddy/app-shared';
import { httpApi } from './http';

/**
 * Local-daemon adapter for the @hauddy/app-shared API surface. The shared
 * Messages/CallPanel screens are written against the *platform* client (Bearer →
 * api.hauddy.com); this Object.assigns local implementations that talk to the
 * sidecar daemon (127.0.0.1:7700) instead, so the desktop renders the exact same
 * screens against the LOCAL hub's history store. Web never installs this.
 */
const BASE =
  (import.meta.env.VITE_HAUDDY_API as string | undefined)?.replace(/\/$/, '') ?? 'http://127.0.0.1:7700';

async function daemonGet<T>(path: string): Promise<T> {
  const res = await fetch(BASE + path);
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

const asQuery = (as?: string | null): string => (as ? `?as=${encodeURIComponent(as)}` : '');

/** app-shared's CallPanel is hub-agnostic (platform-only), but the daemon needs
 *  to know which hub (local/platform) holds an incoming call to pick it up. The
 *  poll frames carry a `hub` tag → remember it per call so pickup can route. */
const inviteHubs = new Map<string, 'local' | 'platform'>();

let cachedNetwork: Awaited<ReturnType<typeof httpApi.listNetworkAgents>> = [];
let networkRefresh: Promise<unknown> | null = null;
let cachedFriends: FriendsView = { auto_accept: false, linked: [], incoming: [], outgoing: [] };
let friendsRefresh: Promise<unknown> | null = null;
async function accountAction<T>(action: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}/api/account/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `account HTTP ${res.status}`);
  return data;
}

const localApi: Partial<Api> = {
  // ---- directory / presence ----
  // The account's agents for the shared Messages screen: local-hub agents PLUS
  // the account's network-only agents (connectors + agents exposed from another
  // machine). Including them here is what surfaces connectors in the "view as"
  // Inbox selector — their history lives on the (synced) local hub under the same
  // agent_id, so `consoleThreads(as=<connectorId>)` resolves. Web's own listAgents
  // already includes connectors; this brings the desktop to parity.
  async listAgents(): Promise<Agent[]> {
    const agents = await httpApi.listAgents();
    if (!networkRefresh) networkRefresh = httpApi.listNetworkAgents().then((r) => { cachedNetwork = r; }).catch(() => {}).finally(() => { networkRefresh = null; });
    const network = cachedNetwork;
    const local: Agent[] = agents.map((a) => ({
      id: a.agentId,
      nickname: a.nicknames[0] ?? '',
      description: a.description ?? '',
      online: a.status === 'attached',
      kind: 'agent',
    }));
    const net: Agent[] = network
      .filter((n) => n.handle)
      .map((n) => ({
        id: n.agentId,
        nickname: n.handle as string,
        description: n.description ?? '',
        online: n.online,
        kind: n.kind,
      }));
    return [...local, ...net];
  },

  async listFriends(): Promise<FriendsView> {
    return (await httpApi.listFriends()) ?? { auto_accept: false, linked: [], incoming: [], outgoing: [] };
  },

  /** Everyone reachable, for presence + resolving call-frame ids → @handles.
   *  Local agents (by real agent_id) ∪ the pool (by @handle). */
  async listPlatformAgents(): Promise<Agent[]> {
    const [agents, pool] = await Promise.all([httpApi.listAgents(), httpApi.listPool().catch(() => [])]);
    const out: Agent[] = agents.map((a) => ({
      id: a.agentId,
      nickname: a.nicknames[0] ?? '',
      description: a.description ?? '',
      online: a.status === 'attached',
      kind: 'agent',
    }));
    const seen = new Set(out.map((a) => a.nickname));
    for (const c of pool) {
      if (c.handle && !seen.has(c.handle)) {
        out.push({ id: c.handle, nickname: c.handle, description: c.description ?? '', online: c.presence === 'online', kind: 'agent' });
        seen.add(c.handle);
      }
    }
    return out;
  },

  // ---- dashboard (assembled locally — daemon for threads/notifications, platform for the rest) ----
  async consoleDashboard(opts?: { as?: string | null }): Promise<DashboardResult> {
    if (!friendsRefresh) friendsRefresh = httpApi.listFriends().then((r) => { if (r) cachedFriends = r; }).catch(() => {}).finally(() => { friendsRefresh = null; });
    const [threadsRes, notifications, friends, agents, platform_agents] = await Promise.all([
      daemonGet<{ threads: ThreadSummary[] }>(`/api/human/threads${asQuery(opts?.as)}`),
      daemonGet<Notifications>('/api/human/notifications'),
      Promise.resolve(cachedFriends),
      localApi.listAgents!(),
      localApi.listPlatformAgents!(),
    ]);
    return { threads: threadsRes.threads, notifications, friends, agents, platform_agents };
  },

  // ---- persistent history (local hub) ----
  consoleThreads(as?: string | null): Promise<{ threads: ThreadSummary[] }> {
    return daemonGet<{ threads: ThreadSummary[] }>(`/api/human/threads${asQuery(as)}`);
  },
  consoleThread(
    peer: string,
    opts?: { before?: number; limit?: number; as?: string | null; cursor?: string },
  ): Promise<{ peer_id: string; peer_nick: string; messages: ThreadMessage[]; items?: ThreadItem[]; next_cursor?: string | null }> {
    const qs = new URLSearchParams();
    if (opts?.before) qs.set('before', String(opts.before));
    if (opts?.cursor) qs.set('cursor', opts.cursor);
    if (opts?.limit) qs.set('limit', String(opts.limit));
    if (opts?.as) qs.set('as', opts.as);
    const q = qs.toString();
    return daemonGet(`/api/human/thread/${encodeURIComponent(peer)}${q ? `?${q}` : ''}`);
  },
  consoleCalls(opts?: { withFrames?: boolean; as?: string | null }): Promise<{ calls: CallLogEntry[] }> {
    const qs = new URLSearchParams();
    if (opts?.withFrames) qs.set('withFrames', '1');
    if (opts?.as) qs.set('as', opts.as);
    const q = qs.toString();
    return daemonGet<{ calls: CallLogEntry[] }>(`/api/human/calls${q ? `?${q}` : ''}`);
  },
  consoleNotifications(): Promise<Notifications> {
    return daemonGet<Notifications>('/api/human/notifications');
  },
  consoleNotificationsSeen(): Promise<{ ok?: boolean }> {
    return fetch(`${BASE}/api/human/notifications/seen`, { method: 'POST' }).then((r) => r.json());
  },

  // ---- live SMS (drain the merged inbox; send) ----
  // Route through the daemon so it merges the local hub's inbox (local agent
  // replies) with the platform inbox (remote friend messages) in one drain.
  // Calling the platform directly would skip local messages entirely and leave
  // the local hub's in-memory buffer undrained.
  consoleInbox(): Promise<{ messages: ConsoleMessage[] }> {
    return daemonGet<{ messages: ConsoleMessage[] }>('/api/human/inbox');
  },
  consoleSms(to: string, body: string, attachments?: Attachment[], messageId?: string) {
    return httpApi.humanSms(to, body, attachments, messageId);
  },

  // ---- account settings: credentials remain in the daemon ----
  async getSession() {
    const a = await daemonGet<{ email: string; username?: string }>('/api/account/settings');
    return { email: a.email, name: a.username ?? a.email.split('@')[0] };
  },
  async getIdentity() {
    const a = await daemonGet<{ human?: { nickname?: string; description?: string } }>('/api/account/settings');
    return { handle: a.human?.nickname ?? null, bio: a.human?.description ?? '' };
  },
  async updateProfile(patch) {
    try { return await accountAction('profile', patch); }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  },
  async changePassword(current, next) {
    try { return await accountAction('password', { current, next }); }
    catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err) }; }
  },
  setAutoAccept: (on) => accountAction('autoAccept', { auto_accept: on }),
  async deleteAccount() {
    const result = await accountAction<{ ok: boolean }>('delete');
    cachedNetwork = []; cachedFriends = { auto_accept: false, linked: [], incoming: [], outgoing: [] };
    return result;
  },

  // ---- files ----
  async getConsoleFileUrl(fileId: string): Promise<string> {
    const res = await fetch(httpApi.humanFileUrl(fileId));
    if (!res.ok) throw new Error(`file HTTP ${res.status}`);
    return URL.createObjectURL(await res.blob());
  },
  uploadConsoleFile(file: File, to: string): Promise<Attachment> {
    return httpApi.uploadHumanFile(file, to);
  },
  async downloadConsoleFile(fileId: string, name: string): Promise<void> {
    // The daemon serves the file with content-disposition (no auth needed
    // locally), so a plain anchor download works — no blob juggling.
    const a = document.createElement('a');
    a.href = httpApi.humanFileUrl(fileId);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
  },

  // ---- live call ----
  async consolePoll(): Promise<ConsoleCallPoll> {
    const res = await daemonGet<ConsoleCallPoll & { frames: Array<{ id: string; kind: string; hub?: 'local' | 'platform' }> }>(
      '/api/human/call/poll',
    );
    for (const f of res.frames) if (f.kind === 'invite' && f.hub) inviteHubs.set(f.id, f.hub);
    return res;
  },
  consoleCall(to: string) {
    return httpApi.humanCall(to);
  },
  consolePickup(callId: string, peer: string): Promise<{ ok?: boolean }> {
    return httpApi.humanPickup(callId, peer, inviteHubs.get(callId) ?? 'local');
  },
  consoleSay(text: string, attachments?: Attachment[]) {
    return httpApi.humanSay(text, attachments);
  },
  consoleHangup() {
    return httpApi.humanHangup();
  },

  // ---- per-agent contact books (daemon routes, not platform book endpoint) ----
  async getAgentBook(agentId: string): Promise<{ book: BookContact[]; bookable: BookContact[] }> {
    const [book, bookable] = await Promise.all([
      httpApi.listBook(agentId),
      httpApi.listBookable(agentId),
    ]);
    const adapt = (c: { handle: string; presence: string; origin: 'local' | 'network'; description: string | null }): BookContact => ({
      agent_id: c.handle,
      handle: c.handle,
      description: c.description,
      online: c.presence === 'online',
      origin: c.origin,
    });
    return { book: book.map(adapt), bookable: bookable.map(adapt) };
  },
  async addAgentBookContact(agentId: string, handle: string) {
    return httpApi.addContact(agentId, handle);
  },
  async removeAgentBookContact(agentId: string, handle: string) {
    await httpApi.removeContact(agentId, handle);
    return { ok: true as const };
  },
};

/** Point @hauddy/app-shared's screens at the local daemon. Call once at boot. */
export function installLocalApi(): void {
  configureApi(localApi);
}
