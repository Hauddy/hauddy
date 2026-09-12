/** Merge mutable history metadata without changing immutable content. */
export function mergeReceipts<T extends { delivered_at: string | null; read_at: string | null; agent_read_at: string | null }>(old: T, incoming: T): T {
  const first = (a: string | null, b: string | null) => !a ? b : !b ? a : a < b ? a : b;
  return { ...old, delivered_at: first(old.delivered_at, incoming.delivered_at),
    read_at: first(old.read_at, incoming.read_at), agent_read_at: first(old.agent_read_at, incoming.agent_read_at) };
}
export function mergeCall<T extends { state: string; answered_ms: number | null; ended_ms: number | null; end_reason: string | null }>(old: T, incoming: T): T {
  const terminal = (state: string) => !['ringing', 'active'].includes(state);
  const advanced = !terminal(old.state) && (terminal(incoming.state) || incoming.state === 'active');
  return { ...old, state: advanced ? incoming.state : old.state,
    answered_ms: old.answered_ms ?? incoming.answered_ms,
    ended_ms: old.ended_ms ?? incoming.ended_ms, end_reason: old.end_reason ?? incoming.end_reason };
}
