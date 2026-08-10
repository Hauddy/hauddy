import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { startHub, type HubHandle, type RemoteAgent } from "@hauddy/local-hub";
import { slugifyNickname, type Attachment, type Envelope } from "@hauddy/protocol";
import { PlatformBridge, type BridgeAgent } from "./bridge.js";
import { HubConnection } from "./connection.js";
import { keyPathFor, loadOrCreateKeypair } from "./keys.js";
import { loadRegistry, saveRegistry } from "./registry.js";
import { ActivityLog, type ActivityEntry } from "./activity.js";
import { clearAccount, hauddyHome, loadAccount, maskKey, saveAccount } from "./account.js";
import {
  ContactBookStore,
  buildPool,
  resolveBookAgainstPool,
  type BookContact,
  type PoolContact,
} from "./books.js";
import * as hub from "./hub-api.js";
import { loadIdentity, writeIdentity } from "./identity.js";
import { InjectionBus } from "./inject.js";
import type { Provision, Provisioned } from "./mcp.js";
import { SyncEngine, type SyncContext } from "./sync.js";

export const DEFAULT_HUB_PORT = Number(process.env.HAUDDY_HUB_PORT ?? 8787);

export type UiPresence = "online" | "delay" | "offline";
export type AgentStatus = "attached" | "detached" | "enrolled";
export interface EnrolledAgent {
  localId: string;
  /** The agent's id on the local hub (agt_…) — distinct from localId. Lets the
   *  app resolve history/call-frame ids back to this runtime (view-as, nickOf). */
  agentId: string;
  status: AgentStatus;
  nicknames: string[];
  speakingAs: string | null;
  /** Agent-declared bio — the same description shared when the agent is exposed. */
  description: string | null;
}
export type LinkResult = { ok: true } | { ok: false; conflict: string };
/** The app's link to a platform (the "go online" tier). */
export interface PlatformInfo {
  connected: boolean;
  endpoint: string | null;
  email: string | null;
  maskedKey: string | null;
}
/** One local agent's exposure state on the connected platform. */
export interface ExposureRow {
  localId: string;
  /** Local nickname (`@nick`), or null if unnamed. */
  nickname: string | null;
  exposed: boolean;
  /** The nickname it holds on the platform (may differ if renamed on conflict). */
  platformNickname: string | null;
  platformOnline: boolean;
}
export type PlatformActionResult = { ok: true; nickname?: string | null } | { ok: false; error: string };
/** An agent that lives only on the platform (no local runtime on this machine) —
 *  a connector, or an agent exposed from another machine under this account. */
export interface NetworkAgent {
  /** The agent's id on the platform (agt_…) — used to remove it. */
  agentId: string;
  /** Its @handle on the network, or null if unnamed. */
  handle: string | null;
  kind: "connector" | "agent";
  online: boolean;
  description: string | null;
  /** Discoverable by other accounts (connectors default false). */
  listed: boolean;
}
export interface ClaimRow {
  nickname: string;
  claimedBy: string | null;
}
export interface RoutingStatus {
  hub: UiPresence;
  hubLine: string;
  local: string[];
  viaHub: string[];
}

function hhmmss(ts: string): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

/**
 * Per-machine sidecar daemon (spec §3.2) — the **local hub**. It embeds
 * `startHub` bound to localhost in autoLink mode, so every agent that self-
 * provisions on this machine can message every other with zero account. The
 * app's local API reads all state from this embedded hub. (Global exposure —
 * accounts + a bridge to the central hub — is the deferred "go online" tier.)
 */
export class Daemon {
  private hubHandle: HubHandle | null = null;
  readonly activity = new ActivityLog();
  /** The per-agent injection stream a plain-terminal PTY wrapper subscribes to. */
  readonly injections = new InjectionBus();
  /** Human-curated per-agent contact books (persisted to ~/.hauddy/books.json). */
  readonly books = new ContactBookStore();
  private flash: string | null = null;
  private flashTimer: ReturnType<typeof setTimeout> | null = null;
  /** The upstream link to the platform for exposed agents (the relay). */
  private bridge: PlatformBridge | null = null;
  /** Friend agents mirrored from the platform: platform agent_id → RemoteAgent. */
  private remoteDir = new Map<string, RemoteAgent>();
  /** Our own exposed agents' platform ids — excluded from the remote directory. */
  private ownPlatformIds = new Set<string>();
  /** Periodic refresh of the remote directory from the platform (friend agents +
   *  their presence), so newly-accepted friends appear without a reconnect. */
  private remoteTimer: ReturnType<typeof setInterval> | null = null;
  /** This machine's human console identity on the local hub (spec §"human"). */
  private localHumanId: string | null = null;
  /** Which hub holds the human's active call, so say/poll/hangup route there. */
  private humanCallHub: "local" | "platform" | null = null;
  /** Cross-hub history mirror (platform = SSOT). Built once the hub is up. */
  private sync: SyncEngine | null = null;
  /** Periodic mirror pass while connected to a platform. */
  private syncTimer: ReturnType<typeof setInterval> | null = null;
  /** The account's human agent_id on the platform (stable; cached per link). */
  private platformHumanIdCache: string | null = null;
  /** The owner's bio (platform human `description`), mirrored to the local human
   *  and used to tag relayed console→agent messages ("your human owner" default). */
  private ownerBio: string | null = null;
  /** Discovery published to ~/.hauddy/daemon.json for the MCP + wrappers. */
  private discovery: { hub_url: string | null; http_url: string | null; local_api_url: string | null } = {
    hub_url: null,
    http_url: null,
    local_api_url: null,
  };
  /** Cached provisions for agents connected via the HTTP MCP endpoint. */
  private httpMcpProvisions = new Map<string, Provision>();

  private get endpoint(): string {
    return this.hubHandle?.wsUrl ?? `ws://127.0.0.1:${DEFAULT_HUB_PORT}`;
  }

  /** Start the embedded local hub and publish a discovery file for the MCP. */
  async start(): Promise<void> {
    const dataDir = path.join(hauddyHome(), "localhub");
    this.hubHandle = await startHub({
      host: "127.0.0.1",
      port: DEFAULT_HUB_PORT,
      dataDir,
      autoLink: true,
      // Watch routed envelopes for a call invite → ring the callee's wrapper.
      onDeliver: (toAgentId, envelope) => this.onHubDeliver(toAgentId, envelope),
      // Gateway: a send to a remote friend → relay it up that sender's bridge.
      forwardRemote: (fromAgentId, envelope) => this.forwardRemote(fromAgentId, envelope),
      // An agent with a curated book sees exactly it in list_contacts; an empty
      // book keeps zero-config auto-discovery. Books are keyed by hub agent_id.
      bookOf: (agentId) => {
        const book = this.books.list(agentId);
        return book.length > 0 ? book : null;
      },
    });
    this.discovery.hub_url = this.hubHandle.wsUrl;
    this.discovery.http_url = this.hubHandle.httpUrl;
    this.writeDiscovery();
    this.activity.push("hub", `local hub listening on ${this.hubHandle.wsUrl}`);
    // The machine's human console identity (so you can message local agents).
    this.registerLocalHuman();
    // Cross-hub history mirror (platform = SSOT). Reads/writes the local history
    // store directly; talks to the platform console for push/pull.
    this.sync = new SyncEngine(this.hubHandle.history, hauddyHome(), () => this.syncContext());
    // If already linked to a platform, bring up the relay for exposed agents.
    await this.refreshBridges();
  }

  /** Provision this machine's human console identity on the local hub — a
   *  kind:"human" agent the person operates via the app to message/call agents. */
  private registerLocalHuman(): void {
    if (!this.hubHandle) return;
    const { publicKeyPem } = loadOrCreateKeypair("human:local");
    const rec = this.hubHandle.store.registerAgent({
      grant_scope_id: "human:local",
      public_key: publicKeyPem,
      kind: "human",
      local_id: "you",
    });
    this.hubHandle.store.bindNickname(rec.agent_id, "you");
    this.localHumanId = rec.agent_id;
  }

  /** Record the app API URL in the discovery file (a wrapper's stream lives here). */
  recordLocalApi(url: string): void {
    this.discovery.local_api_url = url;
    this.writeDiscovery();
  }

  private writeDiscovery(): void {
    mkdirSync(hauddyHome(), { recursive: true });
    writeFileSync(path.join(hauddyHome(), "daemon.json"), JSON.stringify(this.discovery, null, 2));
  }

  /**
   * The embedded hub routed an envelope. Calls ride on the sms payload
   * (`payload.call`); only an *invite* rings. Publish the ring on the callee's
   * injection stream so a plain-terminal PTY wrapper can inject it as a turn.
   * (Harnesses whose MCP client dispatches notifications also get it via the MCP
   * wake — this stream is the wrapper-path counterpart.) SMS never injects.
   */
  private onHubDeliver(toAgentId: string, envelope: Envelope): void {
    const payload = envelope.payload as { call?: { kind?: unknown }; body?: unknown } | undefined;
    if (!payload?.call || payload.call.kind !== "invite") return;
    const caller = typeof payload.body === "string" ? payload.body : envelope.from;
    this.injections.publish(toAgentId, {
      type: "ring",
      text: `${caller} is calling — run \`pickup_call\` to answer (or ignore to let it go to SMS).`,
    });
    this.activity.push("call.ring", `${caller} → ${toAgentId}`);
  }

  async stop(): Promise<void> {
    if (this.remoteTimer) clearInterval(this.remoteTimer);
    this.remoteTimer = null;
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.syncTimer = null;
    this.bridge?.stopAll();
    this.bridge = null;
    await this.hubHandle?.close();
    this.hubHandle = null;
  }

  // ---- relay (the daemon↔platform bridge) --------------------------------

  /** Reconcile the upstream bridge to exactly the currently-exposed agents.
   *  Called on start and whenever exposure or the platform link changes. */
  private async refreshBridges(): Promise<void> {
    const cfg = loadAccount();
    if (!cfg?.api_key || !this.hubHandle) {
      if (this.remoteTimer) clearInterval(this.remoteTimer);
      this.remoteTimer = null;
      if (this.syncTimer) clearInterval(this.syncTimer);
      this.syncTimer = null;
      this.platformHumanIdCache = null;
      this.ownerBio = null;
      this.bridge?.stopAll();
      this.bridge = null;
      this.ownPlatformIds.clear();
      this.remoteDir.clear();
      this.hubHandle?.setRemotes([]);
      return;
    }
    const locals = await this.agents();
    const onPlatform = await this.platformAgents(cfg);
    const bridged: BridgeAgent[] = [];
    this.ownPlatformIds = new Set();
    for (const la of locals) {
      const pa = onPlatform.find((p) => p.grant_scope_id === la.grant_scope_id);
      if (!pa) continue; // not exposed → not bridged
      this.ownPlatformIds.add(pa.agent_id);
      bridged.push({
        localAgentId: la.agent_id,
        platformAgentId: pa.agent_id,
        grantScopeId: la.grant_scope_id,
        nickname: (la.nickname ?? pa.nickname ?? "").replace(/^@+/, "") || undefined,
      });
    }
    this.bridge ??= new PlatformBridge({
      platformUrl: cfg.endpoint,
      onInbound: (id, env) => this.onInbound(id, env),
      onRemotes: () => void this.pollRemotes(cfg.endpoint),
    });
    this.bridge.reconcile(bridged);
    // Keep the remote directory (friend agents + presence) fresh while bridged.
    if (bridged.length > 0 && !this.remoteTimer) {
      this.remoteTimer = setInterval(() => void this.pollRemotes(cfg.endpoint), 5000);
      this.remoteTimer.unref?.();
    } else if (bridged.length === 0 && this.remoteTimer) {
      clearInterval(this.remoteTimer);
      this.remoteTimer = null;
    }
    await this.pollRemotes(cfg.endpoint);
    // Mirror the owner's platform bio onto the local human so a local console→
    // agent message shows the real bio (else the "your human owner" default).
    await this.refreshOwnerIdentity();
    // Cross-hub history mirror: kick a pass now (backfills on reconnect) and keep
    // a gentle periodic mirror running while connected.
    if (!this.syncTimer) {
      this.syncTimer = setInterval(() => void this.sync?.syncOnce(), 15_000);
      this.syncTimer.unref?.();
    }
    void this.sync?.syncOnce();
  }

  /** Resolve (and cache) the account's human agent_id on the platform — the peer
   *  of the local human across the two hubs. Non-draining (unlike /console/inbox). */
  private async platformHumanId(): Promise<string | null> {
    if (this.platformHumanIdCache) return this.platformHumanIdCache;
    const id = (await this.platformConsole("GET", "/identity").catch(() => null))?.agent_id;
    if (typeof id === "string") this.platformHumanIdCache = id;
    return this.platformHumanIdCache;
  }

  /** Fetch the account's human identity from the platform → cache its id + bio,
   *  and mirror the bio onto the LOCAL human agent so a local console→agent
   *  message carries the owner's real bio (empty ⇒ "your human owner"). Cheap:
   *  one GET, only on connect / exposure change (not a poll loop). */
  private async refreshOwnerIdentity(): Promise<void> {
    const view = await this.platformConsole("GET", "/identity").catch(() => null);
    if (!view) return;
    if (typeof view.agent_id === "string") this.platformHumanIdCache = view.agent_id;
    this.ownerBio = typeof view.description === "string" ? view.description : null;
    if (this.localHumanId && this.hubHandle) {
      this.hubHandle.store.setAgentProfile(this.localHumanId, { description: this.ownerBio ?? "" });
    }
  }

  /** Build the per-tick sync view: the account link + the local↔platform id map
   *  for the human and every exposed agent. `null` when offline / not ready. */
  private async syncContext(): Promise<SyncContext | null> {
    const cfg = loadAccount();
    if (!cfg?.api_key || !this.hubHandle || !this.localHumanId) return null;
    const platformHumanId = await this.platformHumanId();
    if (!platformHumanId) return null;
    const localToPlatform = new Map<string, string>();
    const platformToLocal = new Map<string, string>();
    localToPlatform.set(this.localHumanId, platformHumanId);
    platformToLocal.set(platformHumanId, this.localHumanId);
    const [locals, onPlatform] = await Promise.all([this.agents(), this.platformAgents(cfg)]);
    for (const la of locals) {
      const pa = onPlatform.find((p) => p.grant_scope_id === la.grant_scope_id);
      if (!pa) continue; // unexposed → no platform identity → stays local-only
      localToPlatform.set(la.agent_id, pa.agent_id);
      platformToLocal.set(pa.agent_id, la.agent_id);
    }
    return { endpoint: cfg.endpoint, apiKey: cfg.api_key, localHumanId: this.localHumanId, platformHumanId, localToPlatform, platformToLocal };
  }

  /** An exposed agent wants to reach a remote `@nickname` — relay it upstream. */
  private forwardRemote(fromAgentId: string, envelope: Envelope): void {
    const conn = this.bridge?.connectionFor(fromAgentId);
    if (!conn) {
      this.activity.push("relay.drop", `${fromAgentId} not bridged (expose it to reach the network)`);
      return;
    }
    // Attachments are async (re-host the bytes on the platform first), so the
    // relay itself is fire-and-forget — the sender already got its "queued".
    void this.relayWithFiles(conn, fromAgentId, envelope);
  }

  /** Relay a remote-bound envelope. Any attachment bytes live in *this* machine's
   *  local file store; the recipient's machine can't reach that, so we re-upload
   *  each to the platform store and rewrite the file ids before relaying. */
  private async relayWithFiles(conn: HubConnection, fromAgentId: string, envelope: Envelope): Promise<void> {
    let payload = envelope.payload as Record<string, unknown>;
    const atts = payload.attachments as Attachment[] | undefined;
    if (Array.isArray(atts) && atts.length > 0 && this.hubHandle) {
      const cfg = loadAccount();
      if (cfg?.api_key) {
        const moved: Attachment[] = [];
        for (const a of atts) {
          const local = this.hubHandle.files.get(a.file_id);
          if (!local) continue; // expired/gone — drop this one, keep the message
          try {
            const up = await hub.uploadFile(
              cfg.endpoint,
              local.bytes,
              { name: a.name, mime: a.mime || local.meta.mime || "application/octet-stream", owner: fromAgentId, to: envelope.to },
              cfg.api_key,
            );
            moved.push({ ...a, file_id: up.file_id });
          } catch (err) {
            this.activity.push("relay.file.err", `${a.name}: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
        payload = { ...payload, attachments: moved };
      }
    }
    conn.relay(envelope.to, payload);
    this.activity.push("relay.out", `${fromAgentId} → ${envelope.to}${atts?.length ? ` (+${atts.length} file)` : ""}`);
  }

  /** A platform envelope arrived for a local agent — inject it into the local
   *  hub, rewriting `from` to the remote's `@nickname` so replies are routable.
   *  Attachments (which live on the platform store) are async, so this dispatches
   *  to {@link injectInboundWithFiles}. */
  private onInbound(localAgentId: string, envelope: Envelope): void {
    void this.injectInboundWithFiles(localAgentId, envelope);
  }

  private async injectInboundWithFiles(localAgentId: string, envelope: Envelope): Promise<void> {
    const sender = this.remoteDir.get(envelope.from);
    let payload = envelope.payload as Record<string, unknown>;
    // Owner tag: the account's own human (web/app console) → this exposed agent,
    // relayed down. Mark it so the agent sees "your human owner" (or the bio),
    // mirroring the local-hub tagging for same-machine sends.
    if (this.platformHumanIdCache && envelope.from === this.platformHumanIdCache) {
      payload = { ...payload, from_kind: "human", from_description: this.ownerBio || "your human owner" };
    }
    const atts = payload.attachments as Attachment[] | undefined;
    if (Array.isArray(atts) && atts.length > 0 && this.hubHandle) {
      // The bytes are on the platform store; re-host them on this machine's local
      // store so the recipient agent (which only talks to the local hub) can fetch.
      const cfg = loadAccount();
      const moved: Attachment[] = [];
      for (const a of atts) {
        try {
          const dl = await hub.downloadFile(cfg?.endpoint ?? this.platformUrl, a.file_id, cfg?.api_key);
          const put = this.hubHandle.files.put(dl.bytes, {
            // The reference name can arrive undefined; fall back to the platform's
            // x-hauddy-filename (dl.name, defaults to "file") so the receiver never
            // saves to `.../undefined`.
            name: a.name || dl.name || "file",
            // Prefer the reference's mime, fall back to the downloaded content-type,
            // then a safe default — never store an undefined mime (breaks download).
            mime: a.mime || dl.mime || "application/octet-stream",
            owner: envelope.from,
            to: localAgentId,
            account_id: null,
          });
          if (put.ok) moved.push({ ...a, file_id: put.file.file_id });
        } catch (err) {
          this.activity.push("relay.file.err", `${a.name}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      payload = { ...payload, attachments: moved };
    }
    const injected: Envelope = {
      ...envelope,
      from: sender ? sender.nickname : envelope.from,
      payload,
    };
    this.hubHandle?.injectInbound(localAgentId, injected);
    this.activity.push("relay.in", `${injected.from} → ${localAgentId}${atts?.length ? ` (+${atts.length} file)` : ""}`);
  }

  /** Rebuild the remote directory from the platform: for each exposed agent, its
   *  platform contacts (own account's agents + friend accounts' agents), minus
   *  our own. Pushed to the local hub so `@remote` resolves and shows presence. */
  private async pollRemotes(endpoint: string): Promise<void> {
    if (this.ownPlatformIds.size === 0) {
      this.remoteDir.clear();
      this.hubHandle?.setRemotes([]);
      return;
    }
    const dir = new Map<string, RemoteAgent>();
    for (const pid of this.ownPlatformIds) {
      const { contacts } = await hub.listContacts(endpoint, pid).catch(() => ({ contacts: [] }));
      for (const c of contacts) {
        // Mirror friend agents AND the calling person's platform identity (a
        // human), so an exposed agent can route a reply/say back up the bridge to
        // whoever messaged/called it. Skip only our own exposed agents and the
        // unaddressable. (The local `@you` never appears here — it's local-only.)
        if (this.ownPlatformIds.has(c.agent_id) || !c.nickname) continue;
        dir.set(c.agent_id, {
          agent_id: c.agent_id,
          nickname: c.nickname,
          online: c.presence?.state === "online",
          callReady: (c.presence?.capabilities ?? []).includes("call"),
          description: c.display_name ?? null,
        });
      }
    }
    this.remoteDir = dir;
    this.hubHandle?.setRemotes([...dir.values()]);
  }

  get hubUrl(): string {
    return this.endpoint;
  }

  // ---- agents & nicknames -----------------------------------------------

  private async agents(): Promise<hub.AgentView[]> {
    if (!this.hubHandle) return [];
    return (await hub.listAgents(this.endpoint).catch(() => ({ agents: [] }))).agents;
  }

  async listAgents(): Promise<EnrolledAgent[]> {
    return (await this.agents())
      .filter((a) => a.kind !== "human") // the human ("you") is shown separately
      .map((a) => {
        const nicknames = a.nicknames ?? [];
        const status: AgentStatus = nicknames.length === 0 ? "enrolled" : a.attached ? "attached" : "detached";
        return {
          localId: a.local_id ?? a.agent_id,
          agentId: a.agent_id,
          status,
          nicknames,
          speakingAs: a.speaking_as,
          description: a.description ?? null,
        };
      });
  }

  /** Return (and cache) a Provision for a registered agent by localId, for use
   *  by the HTTP MCP endpoint. Creates a HubConnection the first time; reuses it
   *  on subsequent requests so the agent stays online between tool calls. */
  createHttpMcpProvision(localId: string): Provision {
    const cached = this.httpMcpProvisions.get(localId);
    if (cached) return cached;

    let provisioned: Provisioned | null = null;
    let inflight: Promise<Provisioned> | null = null;

    const provision: Provision = () => {
      if (provisioned) return Promise.resolve(provisioned);
      if (inflight) return inflight;
      inflight = (async () => {
        const entry = loadRegistry().agents.find((a) => a.local_id === localId);
        if (!entry) throw new Error(`No agent "${localId}" registered on this machine`);
        const identity = loadIdentity(entry.identity_file);
        const keypair = loadOrCreateKeypair(entry.grant_scope_id);
        const reg = await hub.registerAgent(this.endpoint, {
          grant_scope_id: entry.grant_scope_id,
          public_key: keypair.publicKeyPem,
          local_id: entry.local_id,
          nickname: identity.nickname,
        });
        identity.agent_id = reg.agent_id;
        writeIdentity(entry.identity_file, identity);
        const connection = new HubConnection({
          endpoint: this.endpoint,
          agentId: reg.agent_id,
          grantScopeId: entry.grant_scope_id,
          privateKey: keypair.privateKey,
          nickname: identity.nickname,
        });
        connection.on("socket_error", () => {});
        connection.start();
        provisioned = {
          endpoint: this.endpoint,
          agentId: reg.agent_id,
          connection,
          activity: new ActivityLog(),
          persistNickname: (bare) => {
            identity.nickname = bare;
            writeIdentity(entry.identity_file, identity);
          },
        };
        return provisioned;
      })();
      inflight.catch(() => { inflight = null; });
      return inflight;
    };

    this.httpMcpProvisions.set(localId, provision);
    return provision;
  }

  /** Every local nickname currently bound on this machine. */
  async listAccountNicknames(): Promise<string[]> {
    return (await this.agents()).flatMap((a) => a.nicknames);
  }

  private async agentByLocalId(localId: string): Promise<hub.AgentView | null> {
    return (await this.agents()).find((a) => (a.local_id ?? a.agent_id) === localId) ?? null;
  }

  /** Set/rename an agent's local nickname (unique within the local hub). */
  async linkNickname(localId: string, nickname: string, _replace = false): Promise<LinkResult> {
    const target = await this.agentByLocalId(localId);
    if (!target) return { ok: true };
    const res = await hub.setNickname(this.endpoint, target.agent_id, nickname);
    if (res.ok) {
      this.activity.push("nickname", `${localId} → ${nickname}`);
      return { ok: true };
    }
    if (res.reason === "conflict" && res.conflict) {
      const holder = (await this.agents()).find((a) => a.agent_id === res.conflict);
      return { ok: false, conflict: holder?.local_id ?? res.conflict };
    }
    return { ok: false, conflict: nickname };
  }

  async setSpeakingAs(_localId: string, _nickname: string): Promise<void> {
    /* one nickname per agent in the local model — no separate speaking-as */
  }

  /** Set an agent's bio/description — the single field the expose flow shares
   *  upstream. Written to the local hub; best-effort mirrored to the platform if
   *  the agent is currently exposed. */
  async setAgentDescription(localId: string, description: string): Promise<{ ok: boolean; error?: string }> {
    const agent = await this.agentByLocalId(localId);
    if (!agent || !this.hubHandle) return { ok: false, error: "unknown agent" };
    this.hubHandle.store.setAgentProfile(agent.agent_id, { description });
    this.activity.push("profile", `${localId} bio updated`);
    const cfg = loadAccount();
    if (cfg?.api_key) {
      try {
        const pa = (await this.platformAgents(cfg)).find((p) => p.grant_scope_id === agent.grant_scope_id);
        if (pa) await hub.updateProfile(cfg.endpoint, pa.agent_id, { description });
      } catch {
        /* best-effort: local write is the source of truth, platform catches up on re-expose */
      }
    }
    return { ok: true };
  }

  /** Permanently delete an agent: unexpose, drop it from the local hub, its own
   *  book and every other book, the registry, and its on-disk keypair. Irreversible. */
  async deleteAgent(localId: string): Promise<{ ok: boolean; error?: string }> {
    const agent = await this.agentByLocalId(localId);
    if (!agent) return { ok: false, error: "unknown agent" };
    if (agent.kind === "human") return { ok: false, error: "cannot delete the human identity" };

    // Best-effort unexpose so the platform doesn't keep a dangling registration.
    try {
      await this.unexpose(localId);
    } catch {
      /* not exposed / platform down — proceed with the local delete */
    }

    // Local hub: remove the agent record + its nicknames + inbox.
    this.hubHandle?.store.removeAgent(agent.agent_id);

    // Books: drop its own book, and unlink it from every other agent's book.
    this.books.dropAgent(agent.agent_id);
    const handles = [agent.nickname, ...(agent.nicknames ?? [])].filter(Boolean) as string[];
    for (const h of handles) this.books.removeEverywhere(h);

    // Registry + keypair on disk.
    const registry = loadRegistry();
    const entry = registry.agents.find(
      (a) => a.local_id === localId || a.grant_scope_id === agent.grant_scope_id,
    );
    if (entry) {
      registry.agents = registry.agents.filter((a) => a !== entry);
      saveRegistry(registry);
      for (const file of [entry.identity_file, keyPathFor(entry.grant_scope_id)]) {
        if (file) {
          try {
            rmSync(file, { force: true });
          } catch {
            /* file already gone — nothing to clean up */
          }
        }
      }
    }
    this.activity.push("agent.delete", localId);
    return { ok: true };
  }

  // ---- contact books -----------------------------------------------------

  /** The machine's profile pool: local agents ∪ friends' agents (spec §"friends"
   *  allow-all). Derived — not hand-curated; you change it via the Friends screen. */
  async listPool(): Promise<PoolContact[]> {
    const agents = (await this.agents()).filter((a) => a.kind !== "human");
    const remotes = [...this.remoteDir.values()].map((r) => ({ handle: r.nickname, online: r.online, description: r.description ?? null }));
    return buildPool(agents, remotes);
  }

  /** An agent's contact book, resolved against the current pool (presence + origin). */
  async listBook(localId: string): Promise<BookContact[]> {
    const agent = await this.agentByLocalId(localId);
    if (!agent) return [];
    return resolveBookAgainstPool(this.books.list(agent.agent_id), await this.listPool());
  }

  /** Add a pooled contact to an agent's book (picked from {@link listBookable}). */
  async addContact(localId: string, handle: string): Promise<{ ok: boolean; error?: string }> {
    const agent = await this.agentByLocalId(localId);
    if (!agent) return { ok: false, error: "unknown agent" };
    const res = this.books.add(agent.agent_id, handle);
    if (res.ok) this.activity.push("contact.add", `${localId} + @${res.handle}`);
    return res.error ? { ok: false, error: res.error } : { ok: true };
  }

  async removeContact(localId: string, handle: string): Promise<void> {
    const agent = await this.agentByLocalId(localId);
    if (!agent) return;
    this.books.remove(agent.agent_id, handle);
    this.activity.push("contact.remove", `${localId} − @${handle.replace(/^@+/, "")}`);
  }

  /** Unlink a pooled contact from **every** agent's book at once (the pool's
   *  "remove" action). The pool entry itself is derived from friendship, so it
   *  stays available — this only clears it out of the books that referenced it. */
  async removeContactEverywhere(handle: string): Promise<{ ok: boolean; removed: number }> {
    const removed = this.books.removeEverywhere(handle);
    if (removed > 0) this.activity.push("contact.remove-all", `@${handle.replace(/^@+/, "")} × ${removed}`);
    return { ok: true, removed };
  }

  /** Pool entries not yet in this agent's book (and never the agent itself) —
   *  the picker for assigning a contact to an agent. */
  async listBookable(localId: string): Promise<PoolContact[]> {
    const agent = await this.agentByLocalId(localId);
    if (!agent) return [];
    const inBook = new Set(this.books.list(agent.agent_id));
    const self = (agent.nickname ?? "").replace(/^@+/, "");
    return (await this.listPool()).filter((c) => {
      const bare = c.handle.replace(/^@+/, "");
      return bare !== self && !inBook.has(bare);
    });
  }

  // ---- platform link ("go online": connect + expose) ---------------------

  /** The one Hauddy platform this app talks to. There's a single platform, so
   *  it's a fixed destination — not something the user picks. Env-overridable
   *  for local dev / self-hosting; never surfaced as a UI field. */
  private get platformUrl(): string {
    return process.env.HAUDDY_PLATFORM?.trim() || "wss://api.hauddy.com";
  }

  /** The app's platform link, read from ~/.hauddy/account.toml. */
  getPlatform(): PlatformInfo {
    const cfg = loadAccount();
    if (!cfg?.api_key) {
      return { connected: false, endpoint: cfg?.endpoint ?? null, email: null, maskedKey: null };
    }
    return {
      connected: true,
      endpoint: cfg.endpoint,
      email: cfg.email ?? null,
      maskedKey: maskKey(cfg.api_key),
    };
  }

  /** Attach to the platform — create an account by email, or attach an existing key. */
  async connectPlatform(input: { email?: string; apiKey?: string }): Promise<PlatformActionResult> {
    const endpoint = this.platformUrl;
    try {
      if (input.apiKey?.trim()) {
        const acct = await hub.getAccount(endpoint, input.apiKey.trim()); // validates the key
        saveAccount({ endpoint, account_id: acct.account_id, email: acct.email, api_key: input.apiKey.trim() });
      } else {
        const email = input.email?.trim() || "local@hauddy.dev";
        const res = await hub.createAccount(endpoint, email);
        saveAccount({ endpoint, account_id: res.account_id, email, api_key: res.api_key });
      }
      this.activity.push("platform.connect", endpoint);
      await this.refreshBridges();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Drop the local platform link (the account stays on the platform). */
  async disconnectPlatform(): Promise<void> {
    clearAccount();
    this.activity.push("platform.disconnect", "");
    await this.refreshBridges();
  }

  async rotatePlatformKey(): Promise<PlatformActionResult> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      const res = await hub.rotateKey(cfg.endpoint, cfg.api_key);
      saveAccount({ ...cfg, api_key: res.api_key });
      this.activity.push("platform.rotate", "");
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async platformAgents(cfg: { endpoint: string; api_key?: string }): Promise<hub.AgentView[]> {
    if (!cfg.api_key) return [];
    return hub.getAccount(cfg.endpoint, cfg.api_key).then((a) => a.agents).catch(() => []);
  }

  /** Every nickname'd local agent + whether it's exposed on the platform. */
  async listExposure(): Promise<ExposureRow[]> {
    const cfg = loadAccount();
    const locals = await this.agents();
    const onPlatform = cfg ? await this.platformAgents(cfg) : [];
    return locals
      .filter((a) => (a.nicknames?.length ?? 0) > 0) // only named agents are exposable
      .map((a) => {
        const pa = onPlatform.find((p) => p.grant_scope_id === a.grant_scope_id);
        return {
          localId: a.local_id ?? a.agent_id,
          nickname: a.nickname,
          exposed: !!pa,
          platformNickname: pa?.nickname ?? null,
          platformOnline: pa?.attached ?? false,
        };
      });
  }

  /** Register a local agent's identity on the platform under this account. */
  async expose(localId: string): Promise<PlatformActionResult> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    const agent = await this.agentByLocalId(localId);
    if (!agent) return { ok: false, error: "unknown agent" };
    if (!agent.public_key) return { ok: false, error: "agent has no key yet" };
    const nick = (agent.nickname ?? "").replace(/^@+/, "");
    try {
      const res = await hub.registerAgent(
        cfg.endpoint,
        {
          grant_scope_id: agent.grant_scope_id,
          public_key: agent.public_key,
          nickname: nick || undefined,
          local_id: agent.local_id ?? undefined,
          display_name: agent.display_name ?? undefined,
          description: agent.description ?? undefined,
        },
        cfg.api_key,
      );
      this.activity.push("platform.expose", `${localId} → ${res.nickname ?? "(nickname taken)"}`);
      await this.refreshBridges();
      return { ok: true, nickname: res.nickname };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  async unexpose(localId: string): Promise<PlatformActionResult> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    const agent = await this.agentByLocalId(localId);
    if (!agent) return { ok: false, error: "unknown agent" };
    const pa = (await this.platformAgents(cfg)).find((p) => p.grant_scope_id === agent.grant_scope_id);
    if (!pa) return { ok: true }; // already not on the platform
    try {
      await hub.unexposeAgent(cfg.endpoint, pa.agent_id, cfg.api_key);
      this.activity.push("platform.unexpose", localId);
      await this.refreshBridges();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** The account's agents that live only on the platform — connectors (external
   *  AIs / scripts) and agents exposed from another machine — i.e. those with no
   *  local runtime on THIS machine. Exposed local agents are excluded (they
   *  already appear in `listAgents`). Empty when not connected to a platform, so
   *  the app naturally shows nothing while offline. */
  async listNetworkAgents(): Promise<NetworkAgent[]> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return [];
    const [onPlatform, locals] = await Promise.all([this.platformAgents(cfg), this.agents()]);
    const localScopes = new Set(locals.map((a) => a.grant_scope_id));
    return onPlatform
      .filter((a) => a.kind !== "human" && !localScopes.has(a.grant_scope_id))
      .map((a) => this.toNetworkAgent(a));
  }

  private toNetworkAgent(a: hub.AgentView): NetworkAgent {
    return {
      agentId: a.agent_id,
      handle: a.nickname,
      kind: a.kind === "connector" ? "connector" : "agent",
      online: a.attached,
      description: a.description,
      listed: a.listed ?? true,
    };
  }

  /** One of the account's platform-only agents by id, for the detail page. */
  async getNetworkAgent(agentId: string): Promise<NetworkAgent | null> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return null;
    const [onPlatform, locals] = await Promise.all([this.platformAgents(cfg), this.agents()]);
    const localScopes = new Set(locals.map((a) => a.grant_scope_id));
    const a = onPlatform.find(
      (p) => p.agent_id === agentId && p.kind !== "human" && !localScopes.has(p.grant_scope_id),
    );
    return a ? this.toNetworkAgent(a) : null;
  }

  /** Rename a platform-only agent's @handle (owner-scoped, proxied). */
  async setNetworkAgentNickname(agentId: string, nickname: string): Promise<hub.NicknameOutcome> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, reason: "invalid" };
    try {
      const r = await hub.setAgentNickname(cfg.endpoint, agentId, nickname, cfg.api_key);
      await this.refreshBridges();
      return r;
    } catch {
      return { ok: false, reason: "invalid" };
    }
  }

  /** Edit a platform-only agent's bio and/or network visibility (owner-scoped). */
  async setNetworkAgentSettings(
    agentId: string,
    patch: { bio?: string; listed?: boolean },
  ): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      return await hub.setAgentSettings(cfg.endpoint, agentId, patch, cfg.api_key);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** A platform-only agent's curated contact book + reachable candidates. */
  async networkAgentBook(agentId: string): Promise<{ book: hub.BookContactView[]; bookable: hub.BookContactView[] }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { book: [], bookable: [] };
    return hub.getAgentBook(cfg.endpoint, agentId, cfg.api_key).catch(() => ({ book: [], bookable: [] }));
  }
  async addNetworkAgentContact(agentId: string, handle: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      return await hub.addBookContact(cfg.endpoint, agentId, handle, cfg.api_key);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  async removeNetworkAgentContact(agentId: string, handle: string): Promise<{ ok: boolean }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false };
    return hub.removeBookContact(cfg.endpoint, agentId, handle, cfg.api_key).catch(() => ({ ok: false }));
  }

  /** Remove one of the account's platform-only agents from the network. For a
   *  connector this fully retires it (the platform drops its token + OAuth creds
   *  + @handle); for a remotely-exposed agent it unexposes it. */
  async removeNetworkAgent(agentId: string): Promise<{ ok: boolean; error?: string }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      const res = await hub.unexposeAgent(cfg.endpoint, agentId, cfg.api_key);
      this.activity.push("platform.remove-agent", agentId);
      await this.refreshBridges();
      return { ok: !!res.ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- friends (profile↔profile links on the platform) -------------------

  /** This account's friendships (linked + pending), or null if not connected. */
  async listFriends(): Promise<hub.FriendsView | null> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return null;
    return hub.listFriends(cfg.endpoint, cfg.api_key).catch(() => null);
  }

  /** Send a connect request to a `@handle`'s profile (may auto-link on their end). */
  async requestFriend(handle: string): Promise<PlatformActionResult & { state?: string }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      const res = await hub.requestFriend(cfg.endpoint, handle, cfg.api_key);
      this.activity.push("friend.request", `${handle} → ${res.state}`);
      await this.pollRemotes(cfg.endpoint);
      return { ok: true, state: res.state };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Accept or decline an incoming friend request from `accountId`. */
  async respondFriend(accountId: string, accept: boolean): Promise<PlatformActionResult & { state?: string }> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      const res = await hub.respondFriend(cfg.endpoint, accountId, accept, cfg.api_key);
      this.activity.push("friend.respond", `${accountId} → ${res.state}`);
      await this.pollRemotes(cfg.endpoint);
      return { ok: true, state: res.state };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  /** Toggle whether incoming friend requests auto-link for this account. */
  async setAutoAccept(on: boolean): Promise<PlatformActionResult> {
    const cfg = loadAccount();
    if (!cfg?.api_key) return { ok: false, error: "not connected to a platform" };
    try {
      await hub.setAutoAccept(cfg.endpoint, on, cfg.api_key);
      this.activity.push("friend.auto_accept", String(on));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // ---- human console (message/call agents as the person, spec §"human") --
  // The human is a console identity on each hub: local agents via the local
  // hub's /console (no auth, ?as=<humanId>), remote friends via the platform's
  // /console (Bearer). The daemon merges both so the app has one conversation.

  private async localConsole(method: string, suffix: string, body?: unknown): Promise<Record<string, unknown>> {
    if (!this.hubHandle || !this.localHumanId) throw new Error("no local human");
    const sep = suffix.includes("?") ? "&" : "?";
    const url = `${this.hubHandle.httpUrl}/console${suffix}${sep}as=${encodeURIComponent(this.localHumanId)}`;
    const res = await fetch(url, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as Record<string, unknown>;
  }

  private async platformConsole(method: string, suffix: string, body?: unknown): Promise<Record<string, unknown>> {
    const cfg = loadAccount();
    if (!cfg?.api_key) throw new Error("not connected to a platform");
    const base = cfg.endpoint.replace(/^ws/, "http");
    const res = await fetch(`${base}/console${suffix}`, {
      method,
      headers: { authorization: `Bearer ${cfg.api_key}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return (await res.json()) as Record<string, unknown>;
  }

  /** Bare nicknames of remote friend agents (reachable via the platform console). */
  private targetIsRemote(to: string): boolean {
    const bare = to.replace(/^@+/, "");
    for (const r of this.remoteDir.values()) if (r.nickname.replace(/^@+/, "") === bare) return true;
    return false;
  }

  private callConsole(method: string, suffix: string, body?: unknown): Promise<Record<string, unknown>> {
    return this.humanCallHub === "platform" ? this.platformConsole(method, suffix, body) : this.localConsole(method, suffix, body);
  }

  /** The human's own handle + whether the network console is available. */
  async humanIdentity(): Promise<{ nickname: string | null; network: boolean }> {
    const local = await this.localConsole("GET", "/identity").catch(() => null);
    return { nickname: (local?.nickname as string) ?? "@you", network: !!loadAccount()?.api_key };
  }

  async humanSms(to: string, body: string, attachments?: Attachment[]): Promise<Record<string, unknown>> {
    const payload = { to, body, ...(attachments && attachments.length ? { attachments } : {}) };
    const res = this.targetIsRemote(to)
      ? await this.platformConsole("POST", "/sms", payload)
      : await this.localConsole("POST", "/sms", payload);
    this.activity.push("human.sms", `→ ${to}${attachments?.length ? ` (+${attachments.length} file)` : ""}`);
    return res;
  }

  /** Stage an attachment the human is about to send: put the bytes on whichever
   *  hub the message will route through (platform for a remote friend, else the
   *  local hub), and return the reference to include with humanSms. */
  async stageHumanAttachment(
    bytes: Buffer,
    meta: { name: string; mime: string },
    to: string,
  ): Promise<Attachment> {
    const owner = this.localHumanId ?? "human:local";
    if (this.targetIsRemote(to)) {
      const cfg = loadAccount();
      if (!cfg?.api_key) throw new Error("not connected to a platform");
      const up = await hub.uploadFile(cfg.endpoint, bytes, { name: meta.name, mime: meta.mime, owner, to }, cfg.api_key);
      return { file_id: up.file_id, name: meta.name, mime: meta.mime, size: bytes.length };
    }
    if (!this.hubHandle) throw new Error("local hub not running");
    const put = this.hubHandle.files.put(bytes, { name: meta.name, mime: meta.mime, owner, to, account_id: null });
    if (!put.ok) throw new Error(put.error);
    return { file_id: put.file.file_id, name: meta.name, mime: meta.mime, size: bytes.length };
  }

  /** Fetch a received attachment for the human console — tries this machine's
   *  local store first (files from local agents), then the platform (files from
   *  remote friends). Returns null if it's gone/expired everywhere. */
  async fetchHumanFile(fileId: string): Promise<{ bytes: Buffer; name: string; mime: string } | null> {
    const local = this.hubHandle?.files.get(fileId);
    if (local) return { bytes: local.bytes, name: local.meta.name, mime: local.meta.mime };
    const cfg = loadAccount();
    if (cfg?.api_key) {
      try {
        return await hub.downloadFile(cfg.endpoint, fileId, cfg.api_key);
      } catch {
        /* not on the platform either */
      }
    }
    return null;
  }

  /** Drain both consoles' inboxes (agent → human replies), merged by time. */
  async humanInbox(): Promise<{ messages: Envelope[] }> {
    const local = (await this.localConsole("GET", "/inbox").catch(() => ({ messages: [] }))) as { messages?: Envelope[] };
    const cfg = loadAccount();
    const plat = cfg?.api_key
      ? ((await this.platformConsole("GET", "/inbox").catch(() => ({ messages: [] }))) as { messages?: Envelope[] })
      : { messages: [] };
    const messages = [...(local.messages ?? []), ...(plat.messages ?? [])].sort((a, b) => (a.ts < b.ts ? -1 : 1));
    return { messages };
  }

  async humanCall(to: string): Promise<Record<string, unknown>> {
    this.humanCallHub = this.targetIsRemote(to) ? "platform" : "local";
    this.activity.push("human.call", `→ ${to}`);
    return this.callConsole("POST", "/call", { to });
  }

  async humanSay(text: string, attachments?: Attachment[]): Promise<Record<string, unknown>> {
    return this.callConsole("POST", "/call/say", { text, ...(attachments && attachments.length ? { attachments } : {}) });
  }

  async humanPollCall(): Promise<Record<string, unknown>> {
    if (this.humanCallHub) {
      const res = await this.callConsole("GET", "/call/poll");
      if (res.ended) this.humanCallHub = null;
      return res;
    }
    // Idle: watch both consoles for an incoming invite (an agent calling you).
    const l = (await this.localConsole("GET", "/call/poll").catch(() => ({ frames: [] }))) as { frames?: unknown[] };
    const cfg = loadAccount();
    const p = cfg?.api_key ? ((await this.platformConsole("GET", "/call/poll").catch(() => ({ frames: [] }))) as { frames?: unknown[] }) : { frames: [] };
    const frames = [
      ...(l.frames ?? []).map((f) => ({ ...(f as object), hub: "local" })),
      ...(p.frames ?? []).map((f) => ({ ...(f as object), hub: "platform" })),
    ];
    return { frames, active: false };
  }

  async humanPickup(callId: string, peer: string, hub: "local" | "platform"): Promise<Record<string, unknown>> {
    this.humanCallHub = hub;
    return this.callConsole("POST", "/call/pickup", { call_id: callId, peer });
  }

  async humanHangup(): Promise<Record<string, unknown>> {
    const res = await this.callConsole("POST", "/call/hangup", {});
    this.humanCallHub = null;
    return res;
  }

  // ---- browsable history (spec §E) ---------------------------------------
  // Read from the LOCAL hub's history store only. Physical-mirror sync keeps it
  // complete across hubs, so a single local read is authoritative + offline-capable.
  // `viewAs` browses one of the machine's own agents' inboxes (agent↔agent history).

  async humanThreads(viewAs?: string | null): Promise<Record<string, unknown>> {
    const q = viewAs ? `?view_as=${encodeURIComponent(viewAs)}` : "";
    return this.localConsole("GET", `/threads${q}`).catch(() => ({ threads: [] }));
  }

  async humanThread(peer: string, opts?: { viewAs?: string | null; before?: number }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (opts?.viewAs) params.set("view_as", opts.viewAs);
    if (opts?.before != null) params.set("before", String(opts.before));
    const q = params.toString();
    return this.localConsole("GET", `/thread/${encodeURIComponent(peer)}${q ? `?${q}` : ""}`).catch(() => ({
      peer_id: peer,
      peer_nick: peer,
      messages: [],
    }));
  }

  async humanCalls(opts?: { viewAs?: string | null; withFrames?: boolean }): Promise<Record<string, unknown>> {
    const params = new URLSearchParams();
    if (opts?.viewAs) params.set("view_as", opts.viewAs);
    if (opts?.withFrames) params.set("withFrames", "1");
    const q = params.toString();
    return this.localConsole("GET", `/calls${q ? `?${q}` : ""}`).catch(() => ({ calls: [] }));
  }

  /** Top-bar bell counts: unread + missed from the local store, friend requests
   *  from the platform (a network-only concept). */
  async humanNotifications(): Promise<Record<string, unknown>> {
    const local = (await this.localConsole("GET", "/notifications").catch(() => ({}))) as {
      unread_messages?: number;
      missed_calls?: number;
    };
    let friend_requests = 0;
    try {
      friend_requests = (await this.listFriends())?.incoming.length ?? 0;
    } catch {
      /* platform down → 0 */
    }
    return {
      friend_requests,
      unread_messages: local.unread_messages ?? 0,
      missed_calls: local.missed_calls ?? 0,
    };
  }

  async humanNotificationsSeen(): Promise<Record<string, unknown>> {
    return this.localConsole("POST", "/notifications/seen", {}).catch(() => ({ ok: false }));
  }

  // ---- claims ------------------------------------------------------------

  async listClaims(): Promise<ClaimRow[]> {
    if (!this.hubHandle) return [];
    return (await hub.getClaims(this.endpoint).catch(() => ({ claims: [] }))).claims;
  }

  async listClaimLog(): Promise<Array<{ text: string }>> {
    if (!this.hubHandle) return [];
    return (await hub.getClaims(this.endpoint).catch(() => ({ log: [] }))).log;
  }

  getFlashClaim(): string | null {
    return this.flash;
  }

  async forceClaim(nickname: string): Promise<void> {
    await hub.releaseClaim(this.endpoint, nickname).catch(() => {});
    this.activity.push("claim.force", `${nickname} reset`);
    this.flash = nickname;
    if (this.flashTimer) clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => (this.flash = null), 1400);
  }

  async releaseClaim(nickname: string): Promise<void> {
    await hub.releaseClaim(this.endpoint, nickname).catch(() => {});
    this.activity.push("claim.released", nickname);
  }

  // ---- diagnostics -------------------------------------------------------

  async getRouting(): Promise<RoutingStatus> {
    const local = await this.listAccountNicknames();
    return {
      hub: this.hubHandle ? "online" : "offline",
      hubLine: this.hubHandle ? "App running" : "Not running",
      local,
      // Remote friend agents reachable through the relay (the gateway directory).
      viaHub: [...this.remoteDir.values()].map((r) => r.nickname),
    };
  }

  listActivity(): Array<{ time: string; event: string; detail: string }> {
    return this.activity.list().map((e: ActivityEntry) => ({ time: hhmmss(e.ts), event: e.kind, detail: e.detail }));
  }

  /** Recent activity that mentions one agent — its localId, hub id, or any of its
   *  nicknames appearing in an event's detail. Newest first, capped. */
  async agentLog(localId: string, limit = 30): Promise<Array<{ time: string; event: string; detail: string }>> {
    const agent = await this.agentByLocalId(localId);
    const needles = [localId, agent?.agent_id, ...(agent?.nicknames ?? [])]
      .filter(Boolean)
      .map((s) => s!.replace(/^@+/, "").toLowerCase());
    return this.activity
      .list()
      .filter((e) => {
        const hay = `${e.detail} ${e.kind}`.toLowerCase();
        return needles.some((n) => n && hay.includes(n));
      })
      .slice(0, limit)
      .map((e) => ({ time: hhmmss(e.ts), event: e.kind, detail: e.detail }));
  }
}
