export type TimelineCursor = { ts: number; key: string };
export function parseTimelineCursor(raw?: string | null): TimelineCursor | null {
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (!Array.isArray(value) || !Number.isFinite(value[0]) || typeof value[1] !== 'string') throw new Error('invalid timeline cursor');
  return { ts: value[0], key: value[1] };
}
type Item = { kind: 'message'; id: string; ts: number } | { kind: 'call'; call_id: string; started_ms: number };
export const timelineKey = (item: Item) => item.kind === 'message' ? 'm:' + item.id : 'c:' + item.call_id;
export const timelineTime = (item: Item) => item.kind === 'message' ? item.ts : item.started_ms;
export function timelinePage<T extends Item>(input: T[], limit: number) {
  const sorted = input.sort((a, b) => timelineTime(b) - timelineTime(a) || (timelineKey(a) < timelineKey(b) ? 1 : -1));
  const items = sorted.slice(0, limit).reverse();
  const first = items[0];
  return { items, next_cursor: sorted.length > limit && first ? JSON.stringify([timelineTime(first), timelineKey(first)]) : null };
}
