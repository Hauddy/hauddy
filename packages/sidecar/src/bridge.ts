import type { Envelope, Presence } from "@hauddy/protocol";
import { HubConnection } from "./connection.js";
import { loadOrCreateKeypair } from "./keys.js";

/** One exposed local agent to bridge upstream to the platform. */
export interface BridgeAgent {
  /** The agent's id on the **local** hub (where its session lives). */
  localAgentId: string;
  /** The agent's id on the **platform** (assigned when it was exposed). */
  platformAgentId: string;
  /** Shared across both hubs — the key to load its private key with. */
  grantScopeId: string;
  /** Bare platform nickname, re-claimed on connect (idempotent). */
  nickname?: string;
}

export interface PlatformBridgeOptions {
  /** The platform WebSocket endpoint (from the saved account). */
  platformUrl: string;
  /** An envelope arrived from the platform for `localAgentId` → inject locally. */
  onInbound: (localAgentId: string, envelope: Envelope) => void;
  /** A bridge (re)connected: its platform contacts (friend agents) snapshot. */
  onRemotes: (localAgentId: string, presence: Presence[]) => void;
}

/**
 * The daemon's upstream link to the platform (spec §"Going global"). For each
 * **exposed** local agent it holds one persistent `HubConnection` to the
 * platform, authenticated *as that agent* with its own Ed25519 key (loaded from
 * the machine key store — the daemon runs on the same machine). This turns the
 * local hub into a gateway: inbound platform envelopes are injected into the
 * local hub for the agent's session; outbound sends to a remote `@nickname` are
 * relayed up the matching connection. Calls ride the same path for free
 * (they're `payload.call` on an sms envelope).
 */
export class PlatformBridge {
  /** localAgentId → its upstream connection. */
  private conns = new Map<string, HubConnection>();

  constructor(private readonly opts: PlatformBridgeOptions) {}

  /** Bring the live set of upstream connections to exactly `agents`. */
  reconcile(agents: BridgeAgent[]): void {
    const want = new Map(agents.map((a) => [a.localAgentId, a] as const));
    for (const [id, conn] of this.conns) {
      if (!want.has(id)) {
        conn.stop();
        this.conns.delete(id);
      }
    }
    for (const a of agents) if (!this.conns.has(a.localAgentId)) this.startOne(a);
  }

  private startOne(a: BridgeAgent): void {
    const { privateKey } = loadOrCreateKeypair(a.grantScopeId);
    const conn = new HubConnection({
      endpoint: this.opts.platformUrl,
      agentId: a.platformAgentId,
      grantScopeId: a.grantScopeId,
      privateKey,
      nickname: a.nickname,
      raw: true,
    });
    conn.on("envelope", (env: Envelope) => this.opts.onInbound(a.localAgentId, env));
    conn.on("ready", (presence: Presence[]) => this.opts.onRemotes(a.localAgentId, presence));
    conn.on("socket_error", () => {
      /* backoff/reconnect is the connection's own job */
    });
    conn.start();
    this.conns.set(a.localAgentId, conn);
  }

  /** The upstream connection for a local exposed agent (to relay outbound). */
  connectionFor(localAgentId: string): HubConnection | null {
    return this.conns.get(localAgentId) ?? null;
  }

  /** localAgentIds currently bridged. */
  activeIds(): string[] {
    return [...this.conns.keys()];
  }

  stopAll(): void {
    for (const conn of this.conns.values()) conn.stop();
    this.conns.clear();
  }
}
