import {
  configureApi,
  type Agent,
  type Api,
  type Attachment,
  type CallLogEntry,
  type ConsoleCallPoll,
  type ConsoleMessage,
  type FriendsView,
  type Notifications,
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

const localApi: Partial<Api> = {
  // ---- directory / presence ----
  // The account's agents for the shared Messages screen: local-hub agents PLUS
  // the account's network-only agents (connectors + agents exposed from another
  // machine). Including them here is what surfaces connectors in the "view as"
  // Inbox selector — their history lives on the (synced) local hub under the same
  // agent_id, so `consoleThreads(as=<connectorId>)` resolves. Web's own listAgents
  // already includes connectors; this brings the desktop to parity.
  async listAgents(): Promise<Agent[]> {
    const [agents, network] = await Promise.all([
      httpApi.listAgents(),
      httpApi.listNetworkAgents().catch(() => []),
    ]);
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

  // ---- persistent history (local hub) ----
  consoleThreads(as?: string | null): Promise<{ threads: ThreadSummary[] }> {
    return daemonGet<{ threads: ThreadSummary[] }>(`/api/human/threads${asQuery(as)}`);
  },
  consoleThread(
    peer: string,
    opts?: { before?: number; limit?: number; as?: string | null },
  ): Promise<{ peer_id: string; peer_nick: string; messages: ThreadMessage[] }> {
    const qs = new URLSearchParams();
    if (opts?.before) qs.set('before', String(opts.before));
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
  consoleInbox(): Promise<{ messages: ConsoleMessage[] }> {
    return httpApi.humanInbox() as Promise<{ messages: ConsoleMessage[] }>;
  },
  consoleSms(to: string, body: string, attachments?: Attachment[]) {
    return httpApi.humanSms(to, body, attachments);
  },

  // ---- files ----
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
};

/** Point @hauddy/app-shared's screens at the local daemon. Call once at boot. */
export function installLocalApi(): void {
  configureApi(localApi);
}
