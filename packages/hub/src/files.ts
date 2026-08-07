import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Metadata the hub keeps for one stored attachment. */
export interface FileMeta {
  file_id: string;
  name: string;
  mime: string;
  size: number;
  /** Owner agent id (the sender). */
  owner: string;
  /** Recipient reference (agent id or '@nick'), for download authorization. */
  to: string | null;
  /** Owner's account id on the platform (null on the local hub). */
  account_id: string | null;
  /** Epoch ms after which the file is swept. */
  expires_at: number;
}

export interface FileStoreOptions {
  dir: string;
  /** Per-file cap (default 10 MB — the spec's per-message attachment budget). */
  maxFileBytes?: number;
  /** Whole-store cap so temp files can't fill the disk (default 500 MB). */
  maxTotalBytes?: number;
  /** Time-to-live before a file is swept (default 24h). */
  ttlMs?: number;
}

/**
 * A hub's temp store for message attachments. Bytes live on disk under
 * `<dataDir>/files/<id>.bin`; metadata is in memory (temp storage — a restart
 * drops in-flight transfers, which is fine for a 24h TTL store). Reference-based:
 * the message envelope only carries a small {@link FileMeta}-derived reference,
 * so WS frames and the durable inbox stay small. Enforces a per-file cap and a
 * whole-store quota, and sweeps expired files.
 */
export class FileStore {
  private readonly dir: string;
  readonly maxFileBytes: number;
  private readonly maxTotalBytes: number;
  private readonly ttlMs: number;
  private readonly meta = new Map<string, FileMeta>();
  private total = 0;
  private sweeper: ReturnType<typeof setInterval> | null = null;

  constructor(opts: FileStoreOptions) {
    this.dir = opts.dir;
    this.maxFileBytes = opts.maxFileBytes ?? 10 * 1024 * 1024;
    this.maxTotalBytes = opts.maxTotalBytes ?? 500 * 1024 * 1024;
    this.ttlMs = opts.ttlMs ?? 24 * 60 * 60 * 1000;
    mkdirSync(this.dir, { recursive: true });
    this.sweeper = setInterval(() => this.sweep(), 5 * 60 * 1000);
    this.sweeper.unref?.();
  }

  private pathFor(id: string): string {
    return path.join(this.dir, `${id}.bin`);
  }

  /** Store bytes; returns the file reference or an error (too big / store full). */
  put(
    bytes: Buffer,
    meta: Pick<FileMeta, "name" | "mime" | "owner" | "to" | "account_id">,
  ): { ok: true; file: FileMeta } | { ok: false; error: string } {
    if (bytes.length > this.maxFileBytes) {
      return { ok: false, error: `file exceeds the ${this.maxFileBytes}-byte limit` };
    }
    this.sweep();
    if (this.total + bytes.length > this.maxTotalBytes) {
      return { ok: false, error: "attachment store is full — try again later" };
    }
    const file_id = `file_${crypto.randomBytes(16).toString("hex")}`;
    const file: FileMeta = {
      file_id,
      size: bytes.length,
      expires_at: Date.now() + this.ttlMs,
      ...meta,
    };
    writeFileSync(this.pathFor(file_id), bytes);
    this.meta.set(file_id, file);
    this.total += bytes.length;
    return { ok: true, file };
  }

  /** Fetch a file's metadata + bytes, or null if missing/expired. */
  get(file_id: string): { meta: FileMeta; bytes: Buffer } | null {
    const meta = this.meta.get(file_id);
    if (!meta) return null;
    if (meta.expires_at < Date.now()) {
      this.delete(file_id);
      return null;
    }
    const p = this.pathFor(file_id);
    if (!existsSync(p)) {
      this.meta.delete(file_id);
      this.total -= meta.size;
      return null;
    }
    return { meta, bytes: readFileSync(p) };
  }

  delete(file_id: string): void {
    const meta = this.meta.get(file_id);
    if (meta) {
      this.total -= meta.size;
      this.meta.delete(file_id);
    }
    try {
      rmSync(this.pathFor(file_id), { force: true });
    } catch {
      /* already gone */
    }
  }

  /** Remove every expired file. Cheap; called on an interval and before each put. */
  sweep(): void {
    const now = Date.now();
    for (const [id, m] of this.meta) if (m.expires_at < now) this.delete(id);
  }

  close(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = null;
  }
}
