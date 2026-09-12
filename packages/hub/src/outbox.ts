import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Envelope } from '@hauddy/protocol';
export interface Outbound { envelope: Envelope; state: 'pending' | 'sent' | 'failed'; error?: string }
/** Durable acceptance precedes queued receipts. Stable IDs make lost receipts replayable. */
export class Outbox {
  private rows: Record<string, Outbound>;
  private file: string;
  private running = false;
  private dirty: Set<string>;
  constructor(dir: string, private forward: (from: string, envelope: Envelope) => Promise<{ status: string }>, private changed: (row: Outbound) => void) {
    mkdirSync(dir, { recursive: true });
    this.file = path.join(dir, 'outbox.json');
    this.rows = Object.assign(Object.create(null), existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : {});
    this.dirty = new Set(Object.keys(this.rows));
  }
  private save() { const tmp = this.file + '.tmp'; writeFileSync(tmp, JSON.stringify(this.rows)); renameSync(tmp, this.file); }
  enqueue(envelope: Envelope): Outbound {
    const old = Object.hasOwn(this.rows, envelope.id) ? this.rows[envelope.id] : undefined;
    if (old) {
      if (old.envelope.from !== envelope.from || old.envelope.to !== envelope.to || JSON.stringify(old.envelope.payload) !== JSON.stringify(envelope.payload)) throw new Error('message ID already used');
      return old;
    }
    const row: Outbound = { envelope: structuredClone(envelope), state: 'pending' };
    this.rows[envelope.id] = row;
    try { this.save(); } catch (err) { delete this.rows[envelope.id]; throw err; }
    return row;
  }
  async flush(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const row of Object.values(this.rows)) {
        if (row.state !== 'pending') {
          if (this.dirty.has(row.envelope.id)) { this.changed(row); this.dirty.delete(row.envelope.id); }
          continue;
        }
        const previous = { ...row };
        try {
          const receipt = await this.forward(row.envelope.from, row.envelope);
          if (!receipt || !['queued', 'delivered'].includes(receipt.status)) throw new Error('missing upstream receipt');
          row.state = 'sent'; delete row.error;
        } catch (err) {
          row.error = err instanceof Error ? err.message : String(err);
          if ((err as { permanent?: boolean }).permanent) row.state = 'failed';
        }
        try { this.save(); } catch (err) { this.rows[row.envelope.id] = previous; throw err; }
        this.dirty.add(row.envelope.id);
        this.changed(row);
        this.dirty.delete(row.envelope.id);
      }
    } finally { this.running = false; }
  }
}
