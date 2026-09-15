import { ACQUISITION_EVENTS, acquisitionSource } from '@hauddy/protocol';
import type { Db } from './db.js';
export function acquisitionReport(db: Db, extra = '') {
  const grouped = new Map<string, { source: string; event: string; count: number }>();
  for (const row of db.sql.exec<{ source: string; event: string; count: number }>('SELECT source,event,count FROM acquisition_events').toArray()) {
    if (!(ACQUISITION_EVENTS as readonly string[]).includes(row.event)) continue;
    const source = acquisitionSource(row.source, extra), key = `${source}:${row.event}`;
    const count = Math.max(0, Number(row.count) || 0);
    grouped.set(key, { source, event: row.event, count: (grouped.get(key)?.count ?? 0) + count });
  }
  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    timeframe: 'Cumulative since each counter was introduced; no historical date or cohort filtering.',
    counts: [...grouped.values()].sort((a,b) => a.source.localeCompare(b.source) || a.event.localeCompare(b.event)),
    caveats: [
      'Anonymous browser actions are best-effort deduplicated per tab session, not unique people or completed downloads.',
      'Form starts, requests and verification include retries. verified_reservation counts pending-to-verified transitions since this release.',
      'Activation counts the first actual non-human message acknowledgement per operational waitlist member, independently of reservations and clicks.',
      'Counters introduced at different times have different coverage. Use saved snapshots for future reporting intervals; do not derive conversion rates from unmatched counts.',
    ],
  };
}
