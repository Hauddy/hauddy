import type { SyncCall, SyncMessage } from "./db.js";

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid sync record");
  return value as Record<string, unknown>;
}
function array(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("sync batch must be an array");
  return value;
}
function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("sync identity and timestamp fields must be nonempty strings");
  return value;
}
function nullableText(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value !== "string") throw new Error("invalid sync text field");
  return value;
}
function ms(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("invalid sync timestamp");
  return value;
}
function nullableMs(value: unknown): number | null {
  return value == null ? null : ms(value);
}
function attachments(value: unknown): unknown {
  if (value == null) return null;
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(parsed)) throw new Error("invalid sync attachments");
  return parsed;
}

/** Normalize only supported fields; callers cannot supply storage provenance. */
export function parseMessages(input: unknown): SyncMessage[] {
  return array(input).map((value) => {
    const r = object(value);
    const created_at = text(r.created_at);
    if (!Number.isFinite(Date.parse(created_at))) throw new Error("invalid sync timestamp");
    return {
      message_id: text(r.message_id), from_agent: text(r.from_agent), to_agent: text(r.to_agent),
      from_nick: nullableText(r.from_nick), to_nick: nullableText(r.to_nick), body: nullableText(r.body),
      attachments: attachments(r.attachments), created_at, created_ms: ms(r.created_ms),
      delivered_at: nullableText(r.delivered_at), read_at: nullableText(r.read_at),
      agent_read_at: nullableText(r.agent_read_at), account_scope: null,
    };
  });
}

export function parseCalls(input: unknown): SyncCall[] {
  return array(input).map((value) => {
    const c = object(value);
    const state = text(c.state);
    if (!["ringing", "active", "ended", "missed", "declined"].includes(state)) throw new Error("invalid sync call state");
    const frames = array(c.frames ?? []).map((value) => {
      const f = object(value);
      return {
        frame_id: text(f.frame_id), from_agent: text(f.from_agent), body: nullableText(f.body),
        attachments: attachments(f.attachments), created_ms: ms(f.created_ms),
      };
    });
    return {
      call_id: text(c.call_id), caller: text(c.caller), callee: text(c.callee),
      caller_nick: nullableText(c.caller_nick), callee_nick: nullableText(c.callee_nick), state,
      started_ms: ms(c.started_ms), answered_ms: nullableMs(c.answered_ms), ended_ms: nullableMs(c.ended_ms),
      end_reason: nullableText(c.end_reason), frames,
    };
  });
}
