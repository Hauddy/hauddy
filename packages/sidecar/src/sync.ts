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
}

interface Cursors {
  /** Max local created_ms already pushed up. */
  pushMs: number;
  /** Platform server clock up to which we've pulled down. */
  pullMs: number;
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
 *    Persist-only on the platform, INSERT OR IGNORE by id — so a locally-edited
 *    (tampered) row can never overwrite the SSOT copy.
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
      : { pushMs: 0, pullMs: 0 };
    this.cursors.pushMs ??= 0;
    this.cursors.pullMs ??= 0;
  }

  private saveCursors(): void {
    const tmp = `${this.cursorsFile}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.cursors, null, 2));
    renameSync(tmp, this.cursorsFile);
  }

  private base(ctx: SyncContext): string {
    return ctx.endpoint.replace(/^ws/, "http");
  }
  private post(ctx: SyncContext, suffix: string, body: unknown): Promise<Response> {
    return fetch(`${this.base(ctx)}/console${suffix}`, {
      method: "POST",
      headers: { authorization: `Bearer ${ctx.apiKey}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }
  private async get<T>(ctx: SyncContext, suffix: string): Promise<T> {
    const res = await fetch(`${this.base(ctx)}/console${suffix}`, { headers: { authorization: `Bearer ${ctx.apiKey}` } });
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
      await this.pushUp(ctx);
      await this.pullDown(ctx);
    } catch {
      /* transient (platform down / race) — next tick retries */
    } finally {
      this.running = false;
    }
  }

  private async pushUp(ctx: SyncContext): Promise<void> {
    const scope = new Set(ctx.localToPlatform.keys());
    let maxMs = this.cursors.pushMs;

    // messagesSince(scope) already returns exactly the messages touching a
    // platform identity (≥1 party in `scope`) — the OR rule. Remap each party:
    // a platform identity → its platform id; an unexposed local peer → verbatim.
    const messages: MessageRow[] = [];
    for (const m of this.history.messagesSince(scope, this.cursors.pushMs)) {
      maxMs = Math.max(maxMs, m.created_ms);
      messages.push({
        ...m,
        from_agent: ctx.localToPlatform.get(m.from_agent) ?? m.from_agent,
        to_agent: ctx.localToPlatform.get(m.to_agent) ?? m.to_agent,
      });
    }

    // calls: same OR rule, each party + frame sender remapped individually.
    const calls: unknown[] = [];
    for (const c of this.history.callsSince(scope, this.cursors.pushMs)) {
      maxMs = Math.max(maxMs, c.started_ms);
      calls.push({
        ...c,
        caller: ctx.localToPlatform.get(c.caller) ?? c.caller,
        callee: ctx.localToPlatform.get(c.callee) ?? c.callee,
        frames: c.frames.map((f) => ({ ...f, from_agent: ctx.localToPlatform.get(f.from_agent) ?? f.from_agent })),
      });
    }

    if (!messages.length && !calls.length) return;
    // Advance the cursor ONLY if the platform actually accepted the batch — a 404
    // (endpoint not deployed) / 5xx must retry next tick, never silently skip.
    let ok = true;
    if (messages.length) ok = (await this.post(ctx, "/sync/messages", { messages })).ok && ok;
    if (calls.length) ok = (await this.post(ctx, "/sync/calls", { calls })).ok && ok;
    if (ok && maxMs > this.cursors.pushMs) {
      this.cursors.pushMs = maxMs;
      this.saveCursors();
    }
  }

  private async pullDown(ctx: SyncContext): Promise<void> {
    const res = await this.get<{
      messages: MessageRow[];
      calls: Array<CallRow & { frames: Array<{ frame_id: string; seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }> }>;
      now: number;
    }>(ctx, `/sync/pull?since=${this.cursors.pullMs}`);

    for (const m of res.messages ?? []) {
      // Remap platform ids → local ids where known; unknown (a remote friend's
      // agent) is kept verbatim as an external peer id.
      this.history.putMessageRow({
        ...m,
        from_agent: ctx.platformToLocal.get(m.from_agent) ?? m.from_agent,
        to_agent: ctx.platformToLocal.get(m.to_agent) ?? m.to_agent,
        attachments: toAttArray(m.attachments),
      });
    }
    for (const c of res.calls ?? []) {
      this.history.putCall({
        ...c,
        caller: ctx.platformToLocal.get(c.caller) ?? c.caller,
        callee: ctx.platformToLocal.get(c.callee) ?? c.callee,
      });
      for (const f of c.frames ?? []) {
        this.history.putCallFrame({
          frame_id: f.frame_id,
          call_id: c.call_id,
          from_agent: ctx.platformToLocal.get(f.from_agent) ?? f.from_agent,
          seq: f.seq,
          body: f.body,
          attachments: toAttArray(f.attachments),
          created_ms: f.created_ms,
        });
      }
    }

    if (typeof res.now === "number" && res.now > this.cursors.pullMs) {
      this.cursors.pullMs = res.now;
      this.saveCursors();
    }
  }
}
