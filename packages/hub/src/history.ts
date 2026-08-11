import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { nowIso, type Attachment, type Envelope } from "@hauddy/protocol";

/** One persisted SMS. Mirrors the platform `messages` table (packages/platform
 *  src/db.ts) so a later SQLite swap is a drop-in. Undelivered ⇒ delivered_at null. */
export interface MessageRow {
  message_id: string;
  from_agent: string;
  to_agent: string;
  from_nick: string | null;
  to_nick: string | null;
  body: string | null;
  attachments: Attachment[] | null;
  created_at: string;
  created_ms: number;
  delivered_at: string | null;
  read_at: string | null;
}

/** One call session (SMS≠Call — calls live here, never in messages). */
export interface CallRow {
  call_id: string;
  caller: string;
  callee: string;
  caller_nick: string | null;
  callee_nick: string | null;
  state: string; // ringing | active | ended | missed | declined
  started_ms: number;
  answered_ms: number | null;
  ended_ms: number | null;
  end_reason: string | null;
}

/** One spoken line within a call (transcript + attachments). */
export interface FrameRow {
  frame_id: string;
  call_id: string;
  from_agent: string;
  seq: number;
  body: string | null;
  attachments: Attachment[] | null;
  created_ms: number;
}

/** One conversation-peer summary for the console thread list (spec §E). */
export interface ThreadSummary {
  peer_id: string;
  peer_nick: string | null;
  last_body: string | null;
  last_ts: number;
  has_attach: boolean;
  unread: number;
}

/** A single message in a peer's history (mine = sent by the viewer). */
export interface HistoryMessage {
  id: string;
  from_agent: string;
  mine: boolean;
  body: string | null;
  attachments: Attachment[] | null;
  ts: number;
  created_at: string;
  delivered_at: string | null;
  read_at: string | null;
}

interface HistoryData {
  messages: Record<string, MessageRow>;
  calls: Record<string, CallRow>;
  call_frames: Record<string, FrameRow>;
}

function toAttachments(value: unknown): Attachment[] | null {
  return Array.isArray(value) && value.length ? (value as Attachment[]) : null;
}

/**
 * JSON-file-backed persistent message/call log for the **local** hub — the
 * counterpart of the platform's SQLite `messages`/`calls`/`call_frames`. Same
 * in-memory-cache + atomic (tmp+rename) rewrite as {@link HubStore}, kept in its
 * OWN file (`history.json`) so identity/contact writes don't churn it and it can
 * be pruned independently. Method surface mirrors platform `db.ts` 1:1.
 */
export class HubHistory {
  private data: HistoryData;
  private readonly file: string;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, "history.json");
    this.data = existsSync(this.file)
      ? (JSON.parse(readFileSync(this.file, "utf8")) as HistoryData)
      : { messages: {}, calls: {}, call_frames: {} };
    this.data.messages ??= {};
    this.data.calls ??= {};
    this.data.call_frames ??= {};
  }

  private save(): void {
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    renameSync(tmp, this.file);
  }

  // ── messages ────────────────────────────────────────────────────────────

  /** Persist an asserted SMS envelope (from/to are agent ids). Idempotent by id:
   *  re-recording an existing id is a no-op — the anti-tamper guarantee the sync
   *  layer relies on (a locally-edited body can't overwrite a synced row). */
  insertMessage(env: Envelope, opts: { fromNick: string | null; toNick: string | null }): void {
    if (this.data.messages[env.id]) return; // INSERT OR IGNORE
    const payload = env.payload as { body?: unknown; attachments?: unknown };
    const body = typeof payload.body === "string" ? payload.body : payload.body == null ? null : JSON.stringify(payload.body);
    const parsed = Date.parse(env.ts);
    const created_ms = Number.isFinite(parsed) ? parsed : Date.now();
    this.data.messages[env.id] = {
      message_id: env.id,
      from_agent: env.from,
      to_agent: env.to,
      from_nick: opts.fromNick,
      to_nick: opts.toNick,
      body,
      attachments: toAttachments(payload.attachments),
      created_at: env.ts,
      created_ms,
      delivered_at: null,
      read_at: null,
    };
    this.save();
  }

  /** Insert a message row verbatim (sync ingest from the platform SSOT). Idempotent. */
  putMessageRow(row: MessageRow): void {
    if (this.data.messages[row.message_id]) return;
    this.data.messages[row.message_id] = row;
    this.save();
  }

  /** Repair agent ids on an already-stored message (in-place). Only updates
   *  fields explicitly provided; undefined = leave untouched. Used by the sync
   *  engine to heal messages the bridge stored with platform ids — only called
   *  for ids that were actually remapped (platform→local), never to overwrite a
   *  stored nickname with a raw platform id. */
  repairMessageIds(messageId: string, opts: { from_agent?: string; to_agent?: string }): void {
    const m = this.data.messages[messageId];
    if (!m) return;
    let changed = false;
    if (opts.from_agent !== undefined && m.from_agent !== opts.from_agent) {
      m.from_agent = opts.from_agent;
      changed = true;
    }
    if (opts.to_agent !== undefined && m.to_agent !== opts.to_agent) {
      m.to_agent = opts.to_agent;
      changed = true;
    }
    if (changed) this.save();
  }

  /** Replace every occurrence of `oldId` as a party (from_agent/to_agent in
   *  messages; caller/callee in calls; from_agent in call_frames) with `newId`.
   *  Used by the daemon when pollRemotes resolves a platform UUID to a @nickname
   *  for the first time — heals rows stored by injectInbound before the remote
   *  directory was populated, and rows pulled down during the stale-directory
   *  window. Single save() at the end regardless of how many rows changed. */
  repairAgentId(oldId: string, newId: string): number {
    let n = 0;
    for (const m of Object.values(this.data.messages)) {
      if (m.from_agent === oldId) { m.from_agent = newId; n++; }
      if (m.to_agent === oldId) { m.to_agent = newId; n++; }
    }
    for (const c of Object.values(this.data.calls)) {
      if (c.caller === oldId) { c.caller = newId; n++; }
      if (c.callee === oldId) { c.callee = newId; n++; }
    }
    for (const f of Object.values(this.data.call_frames)) {
      if (f.from_agent === oldId) { f.from_agent = newId; n++; }
    }
    if (n > 0) this.save();
    return n;
  }

  /** Mark a message delivered (acked) — drives the sender's ✓✓ tick. */
  markDelivered(messageId: string, agentId: string): void {
    const m = this.data.messages[messageId];
    if (m && m.to_agent === agentId && m.delivered_at == null) {
      m.delivered_at = nowIso();
      this.save();
    }
  }

  /** Mark every inbound message from a peer as read (clears the thread's unread). */
  markThreadRead(viewerId: string, peerId: string): void {
    let touched = false;
    for (const m of Object.values(this.data.messages)) {
      if (m.to_agent === viewerId && m.from_agent === peerId && m.read_at == null) {
        m.read_at = nowIso();
        touched = true;
      }
    }
    if (touched) this.save();
  }

  private messagesDesc(): MessageRow[] {
    return Object.values(this.data.messages).sort((a, b) => b.created_ms - a.created_ms);
  }

  /** One summary row per conversation peer: latest message + unread count. */
  threadsFor(viewerId: string): ThreadSummary[] {
    const byPeer = new Map<string, ThreadSummary>();
    for (const r of this.messagesDesc()) {
      const outbound = r.from_agent === viewerId;
      if (!outbound && r.to_agent !== viewerId) continue; // viewer not a party
      const peerId = outbound ? r.to_agent : r.from_agent;
      const peerNick = outbound ? r.to_nick : r.from_nick;
      let t = byPeer.get(peerId);
      if (!t) {
        t = {
          peer_id: peerId,
          peer_nick: peerNick,
          last_body: r.body,
          last_ts: r.created_ms,
          has_attach: r.attachments != null,
          unread: 0,
        };
        byPeer.set(peerId, t);
      } else if (!t.peer_nick && peerNick) {
        t.peer_nick = peerNick;
      }
      if (!outbound && r.read_at == null) t.unread += 1;
    }
    return [...byPeer.values()];
  }

  /** Full message history with one peer, newest-first-paged, returned ascending. */
  messagesWithPeer(viewerId: string, peerId: string, beforeMs: number | null, limit = 50): HistoryMessage[] {
    const rows = this.messagesDesc()
      .filter(
        (r) =>
          ((r.from_agent === viewerId && r.to_agent === peerId) ||
            (r.from_agent === peerId && r.to_agent === viewerId)) &&
          (beforeMs == null || r.created_ms < beforeMs),
      )
      .slice(0, limit);
    return rows
      .map<HistoryMessage>((r) => ({
        id: r.message_id,
        from_agent: r.from_agent,
        mine: r.from_agent === viewerId,
        body: r.body,
        attachments: r.attachments,
        ts: r.created_ms,
        created_at: r.created_at,
        delivered_at: r.delivered_at,
        read_at: r.read_at,
      }))
      .reverse();
  }

  /** Unread inbound messages across all threads (badge count). */
  unreadMessageCount(viewerId: string): number {
    let n = 0;
    for (const m of Object.values(this.data.messages)) if (m.to_agent === viewerId && m.read_at == null) n += 1;
    return n;
  }

  // ── calls ─────────────────────────────────────────────────────────────

  getCall(callId: string): CallRow | undefined {
    return this.data.calls[callId];
  }

  /** Insert a call row verbatim (sync ingest from the platform SSOT). Idempotent. */
  putCall(row: CallRow): void {
    if (this.data.calls[row.call_id]) return;
    this.data.calls[row.call_id] = row;
    this.save();
  }

  /** Insert a call frame verbatim (sync ingest). Idempotent by frame_id. */
  putCallFrame(row: FrameRow): void {
    if (this.data.call_frames[row.frame_id]) return;
    this.data.call_frames[row.frame_id] = row;
    this.save();
  }

  upsertCallInvite(c: {
    call_id: string;
    caller: string;
    callee: string;
    caller_nick: string | null;
    callee_nick: string | null;
    started_ms: number;
  }): void {
    if (this.data.calls[c.call_id]) return; // INSERT OR IGNORE
    this.data.calls[c.call_id] = {
      call_id: c.call_id,
      caller: c.caller,
      callee: c.callee,
      caller_nick: c.caller_nick,
      callee_nick: c.callee_nick,
      state: "ringing",
      started_ms: c.started_ms,
      answered_ms: null,
      ended_ms: null,
      end_reason: null,
    };
    this.save();
  }

  /** Mark a call answered (first frame or explicit accept): ringing → active. */
  markCallAnswered(callId: string, answeredMs: number): void {
    const c = this.data.calls[callId];
    if (!c) return;
    if (c.answered_ms == null) c.answered_ms = answeredMs;
    if (c.state === "ringing") c.state = "active";
    this.save();
  }

  /** Close a call: answered → ended, never-answered → missed. */
  closeCall(callId: string, endedMs: number, reason: string): void {
    const c = this.data.calls[callId];
    if (!c) return;
    c.ended_ms = endedMs;
    c.state = c.answered_ms != null ? "ended" : "missed";
    c.end_reason = reason;
    this.save();
  }

  insertCallFrame(f: {
    frame_id: string;
    call_id: string;
    from_agent: string;
    body: string | null;
    attachments: Attachment[] | null;
    created_ms: number;
  }): void {
    if (this.data.call_frames[f.frame_id]) return; // INSERT OR IGNORE
    const seq =
      Object.values(this.data.call_frames)
        .filter((x) => x.call_id === f.call_id)
        .reduce((max, x) => Math.max(max, x.seq), -1) + 1;
    this.data.call_frames[f.frame_id] = { ...f, seq };
    this.save();
  }

  callFrames(callId: string): Array<{ seq: number; from_agent: string; body: string | null; attachments: unknown; created_ms: number }> {
    return Object.values(this.data.call_frames)
      .filter((f) => f.call_id === callId)
      .sort((a, b) => a.seq - b.seq)
      .map((f) => ({ seq: f.seq, from_agent: f.from_agent, body: f.body, attachments: f.attachments, created_ms: f.created_ms }));
  }

  /** The viewer's call sessions, newest first. */
  callsFor(viewerId: string, limit = 50): CallRow[] {
    return Object.values(this.data.calls)
      .filter((c) => c.caller === viewerId || c.callee === viewerId)
      .sort((a, b) => b.started_ms - a.started_ms)
      .slice(0, limit);
  }

  /** Missed inbound calls (rings never answered) started after `sinceMs`. */
  missedCallCount(viewerId: string, sinceMs = 0): number {
    let n = 0;
    for (const c of Object.values(this.data.calls)) {
      if (c.callee === viewerId && c.state === "missed" && c.started_ms > sinceMs) n += 1;
    }
    return n;
  }

  // ── bulk reads for the sync engine (cursor-paged, ascending) ────────────

  /** Messages touching any of `scopeIds`, created after `sinceMs`, oldest-first. */
  messagesSince(scopeIds: Set<string>, sinceMs: number): MessageRow[] {
    return Object.values(this.data.messages)
      .filter((m) => m.created_ms > sinceMs && (scopeIds.has(m.from_agent) || scopeIds.has(m.to_agent)))
      .sort((a, b) => a.created_ms - b.created_ms);
  }

  /** Calls touching any of `scopeIds`, started after `sinceMs`, with their frames. */
  callsSince(scopeIds: Set<string>, sinceMs: number): Array<CallRow & { frames: FrameRow[] }> {
    return Object.values(this.data.calls)
      .filter((c) => c.started_ms > sinceMs && (scopeIds.has(c.caller) || scopeIds.has(c.callee)))
      .sort((a, b) => a.started_ms - b.started_ms)
      .map((c) => ({
        ...c,
        frames: Object.values(this.data.call_frames)
          .filter((f) => f.call_id === c.call_id)
          .sort((a, b) => a.seq - b.seq),
      }));
  }
}
