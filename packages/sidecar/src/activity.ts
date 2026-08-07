import { nowIso } from "@hauddy/protocol";

export interface ActivityEntry {
  ts: string; // ISO-8601
  kind: string; // connect | disconnected | nickname | sms | claim | error
  detail: string;
}

/**
 * In-memory ring buffer of local events surfaced by the sidecar app
 * (connect/verified/conflict/sms/claim/…). Replaces the mock activity log;
 * nothing is persisted — it reflects the current daemon run.
 */
export class ActivityLog {
  private entries: ActivityEntry[] = [];
  constructor(private readonly max = 200) {}

  push(kind: string, detail: string): void {
    this.entries.push({ ts: nowIso(), kind, detail });
    if (this.entries.length > this.max) this.entries.shift();
  }

  /** Newest first. */
  list(): ActivityEntry[] {
    return [...this.entries].reverse();
  }
}
