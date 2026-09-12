import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CallRow, HubHistory, MessageRow } from "@hauddy/local-hub";

/**
 * Per-tick view of who + where we can mirror to. The daemon rebuilds this each
 * sync from the saved account + its live exposure/bridge state. `null` ⇒ offline
 * or not ready ⇒ skip this tick.
 */
export interface SyncContext {
  /** Platform WS endpoint (rewritten to http for the console API). */
  endpoint: string;
  apiKey: string;
  localHumanId: string;
  platformHumanId: string;
  /** local agent_id → platform agent_id (the human + every exposed agent). */
  localToPlatform: Map<string, string>;
  /** platform agent_id → local agent_id (inverse; for pull-down remap). */
  platformToLocal: Map<string, string>;
  /** remote agent platform_id → @nickname (from remoteDir; for outbound to_agent normalisation).
   *  Without this, outbound messages synced from the platform carry a raw platform id while inbound
   *  messages from the same peer carry the @nickname — producing two separate threads. */
  platformIdToNickname: Map<string, string>;
  /** @nickname → remote agent platform_id (inverse of platformIdToNickname).
   *  Used by pushUp to convert @nicknames stored locally back to platform agent_ids before
   *  sending, so the platform SSOT receives correct addressable ids instead of handle strings. */
  nicknameToPlatformId: Map<string, string>;
}

interface Cursors {
  context?: string;
  pullCursor?: number;
  pushed?: Record<string, string>;
  /** Legacy timestamp fields retained for old endpoint compatibility. */
  pushMs: number;
  /** Platform server clock up to which we've pulled down. */
  pullMs: number;
  /** Max agent_read_at epoch ms already forwarded to the platform. */
  agentReadMs: number;
}

const toAttArray = (v: unknown): import("@hauddy/protocol").Attachment[] | null =>
  Array.isArray(v) && v.length ? (v as import("@hauddy/protocol").Attachment[]) : null;

/**
 * Cross-hub mirror between the local hub's history store and the platform, with
 * the **platform as SSOT**. Each tick:
 *  - PUSH UP  local-origin messages/calls where AT LEAST ONE party is a platform
 *    identity (the human, or an exposed agent) — the OR rule. The mapped party
 *    becomes its platform id; an unexposed local peer is kept verbatim as a
 *    read-only "external" peer (visible in the owner's web inbox, not routable).
 *    Stored privately for this account; immutable content is preserved by id. Imports never
 *    write live routing records or become visible in another account's history.
 *  - PULL DOWN account-scoped history from the platform into the local store, so
 *    the local hub is self-sufficient (offline-capable) and agents can later read
 *    the full conversation context.
 * Only unexposed↔unexposed local threads never touch a platform identity → they
 * stay local-only (never returned by messagesSince(scope)).
 */
export class SyncEngine {
  private cursorsFile: string;
  private cursors: Cursors;
  private running = false;

  constructor(
    private history: HubHistory,
    dataDir: string,
    private getContext: () => Promise<SyncContext | null>,
  ) {
    mkdirSync(dataDir, { recursive: true });
    this.cursorsFile = path.join(dataDir, "sync.json");
    this.cursors = existsSync(this.cursorsFile)
      ? (JSON.parse(readFileSync(this.cursorsFile, "utf8")) as Cursors)
      : { pushMs: 0, pullMs: 0, agentReadMs: 0 };
    this.cursors.pushMs ??= 0;
    this.cursors.pullMs ??= 0;
    this.cursors.agentReadMs ??= 0;
  }

  private saveCursors(): void {
    const tmp = `${this.cursorsFile}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(this.cursors, null, 2));
      renameSync(tmp, this.cursorsFile);
    } catch (err) {
      this.cursors = existsSync(this.cursorsFile) ? JSON.parse(readFileSync(this.cursorsFile, 'utf8')) : { pushMs: 0, pullMs: 0, agentReadMs: 0 };
      throw err;
    }
  }

  private base(ctx: SyncContext): string {
    return ctx.endpoint.replace(/^ws/, "http");
  }
  private post(ctx: SyncContext, suffix: string, body: unknown): Promise<Response> {
    return fetch(`${this.base(ctx)}/console${suffix}`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  }
  private async get<T>(ctx: SyncContext, suffix: string): Promise<T> {
    const res = await fetch(`${this.base(ctx)}/console${suffix}`, { headers: { authorization: `Bearer ${ctx.apiKey}` }, signal: AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`GET ${suffix} → HTTP ${res.status}`);
    return (await res.json()) as T;
  }

  /** One full mirror pass (push then pull). Best-effort + self-guarding: any
   *  error is swallowed and retried next tick; never throws into the caller. */
  async syncOnce(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const ctx = await this.getContext();
      if (!ctx) return;
      const context = createHash('sha256').update(ctx.endpoint + ctx.apiKey + JSON.stringify([...ctx.localToPlatform])).digest('hex');
      if (this.cursors.context !== context) {
        this.cursors = { context, pushMs: 0, pullMs: 0, agentReadMs: 0, pullCursor: 0, pushed: {} };
      }
      await this.pushUp(ctx);
      await this.pullDown(ctx);
      await this.pushAgentReads(ctx);
    } catch {
      /* transient (platform down / race) — next tick retries */
    } finally {
      this.running = false;
    }
  }

  private async pushUp(ctx: SyncContext): Promise<void> {
    const scope = new Set(ctx.localToPlatform.keys());
    const toPlat = (id: string) => ctx.localToPlatform.get(id) ?? ctx.nicknameToPlatformId.get(id) ?? id;
    const messages = this.history.messagesSince(scope, -1).map((m) => ({ ...m, from_agent: toPlat(m.from_agent), to_agent: toPlat(m.to_agent) }));
    const calls = this.history.callsSince(scope, -1).map((c) => ({ ...c, caller: toPlat(c.caller), callee: toPlat(c.callee), frames: c.frames.map((f) => ({ ...f, from_agent: toPlat(f.from_agent) })) }));
    for (const [kind, rows, size] of [['messages', messages, 500], ['calls', calls, 50]] as const) {
      const pending = rows.map((row) => ({ row: structuredClone(row),
        key: kind + ':' + ('message_id' in row ? row.message_id : row.call_id),
        hash: createHash('sha256').update(JSON.stringify(row)).digest('hex') }))
        .filter((r) => this.cursors.pushed?.[r.key] !== r.hash);
      for (let i = 0; i < pending.length; i += size) {
        const page = pending.slice(i, i + size);
        const res = await this.post(ctx, '/sync/' + kind, { [kind]: page.map((r) => r.row) });
        if (!res.ok) throw new Error(`sync ${kind}: HTTP ${res.status}`);
        this.cursors.pushed ??= {};
        for (const r of page) this.cursors.pushed[r.key] = r.hash;
        this.saveCursors();
      }
    }
  }

  private async pullDown(ctx: SyncContext): Promise<void> {
    for (;;) {
      const res = await this.get<{
        messages: MessageRow[];
        calls: Array<CallRow & { frames: Array<{ frame_id: string; seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }> }>;
        now?: number;
        next_cursor?: number;
        has_more?: boolean;
      }>(ctx, `/sync/pull?cursor=${this.cursors.pullCursor ?? 0}&since=${this.cursors.pullMs}`);

      // Remap platform ids → local ids where known. For remote agents (not in
      // platformToLocal), fall back to their @nickname so outbound threads
      // (to_agent = remote platform id) merge with inbound threads (from_agent
      // = @nickname injected by the bridge) into one conversation.
      const resolveId = (id: string) =>
        ctx.platformToLocal.get(id) ?? ctx.platformIdToNickname.get(id) ?? id;

      const page: Parameters<HubHistory["importSyncPage"]>[0] = { messages: [], calls: [], frames: [] };
      for (const m of res.messages ?? []) {
        const remapped = {
          ...m,
          from_agent: resolveId(m.from_agent),
          to_agent: resolveId(m.to_agent),
          attachments: toAttArray(m.attachments),
        };
        // Repair any pre-existing row stored by the bridge with platform ids instead of
        // local ids — only for fields actually remapped, never overwrite a stored nickname
        // (e.g. "@chatgpt") with a raw platform id that didn't map to a local agent.
        const repair: { from_agent?: string; to_agent?: string } = {};
        if (remapped.from_agent !== m.from_agent) repair.from_agent = remapped.from_agent;
        if (remapped.to_agent !== m.to_agent) repair.to_agent = remapped.to_agent;
        page.messages.push({ row: remapped, repair });
      }
      for (const c of res.calls ?? []) {
        const { frames, ...call } = c;
        page.calls.push({
          ...call,
          caller: resolveId(c.caller),
          callee: resolveId(c.callee),
        });
        for (const f of frames ?? []) {
          page.frames.push({
            frame_id: f.frame_id,
            call_id: c.call_id,
            from_agent: resolveId(f.from_agent),
            seq: f.seq,
            body: f.body,
            attachments: toAttArray(f.attachments),
            created_ms: f.created_ms,
          });
        }
      }

      this.history.importSyncPage(page);

      if (typeof res.next_cursor === 'number') this.cursors.pullCursor = res.next_cursor;
      if (typeof res.now === 'number') this.cursors.pullMs = res.now;
      this.saveCursors();
      if (!res.has_more) break;
    }
  }

  private async pushAgentReads(ctx: SyncContext): Promise<void> {
    const recipients = new Set([...ctx.localToPlatform.keys(), ...ctx.localToPlatform.values()]);
    const captured = Date.now();
    const ids = this.history.agentReadSince(this.cursors.agentReadMs, recipients);
    if (!ids.length) return;
    const res = await this.post(ctx, "/messages/agent-read", { message_ids: ids });
    if (res.ok) {
      this.cursors.agentReadMs = captured - 1;
      this.saveCursors();
    }
  }
}
