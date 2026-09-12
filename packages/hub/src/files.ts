import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, rmSync, writeFileSync } from "node:fs";
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
 * `<dataDir>/files/<id>.bin`; metadata is persisted alongside each blob and reconciled on restart. Reference-based:
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
    // Recover valid metadata; remove legacy/orphan blobs and interrupted writes.
    for (const name of readdirSync(this.dir)) {
      if (!/^file_[a-f0-9]{32}\.json$/.test(name)) continue;
      const id = name.slice(0, -5);
      try {
        const m = JSON.parse(readFileSync(path.join(this.dir, name), 'utf8')) as FileMeta;
        const size = statSync(this.pathFor(id)).size;
        if (m.file_id !== id || size !== m.size || !Number.isFinite(m.expires_at) || m.expires_at <= Date.now()) throw new Error('expired or invalid');
        this.meta.set(id, m); this.total += size;
      } catch { rmSync(path.join(this.dir, name), { force: true }); rmSync(this.pathFor(id), { force: true }); }
    }
    for (const name of readdirSync(this.dir)) {
      if (/^file_[a-f0-9]{32}\.bin$/.test(name) && !this.meta.has(name.slice(0, -4))) rmSync(path.join(this.dir, name), { force: true });
      if (/^file_[a-f0-9]{32}\.json\.tmp$/.test(name)) rmSync(path.join(this.dir, name), { force: true });
    }
    for (const m of [...this.meta.values()].sort((a, b) => a.expires_at - b.expires_at)) {
      if (this.total <= this.maxTotalBytes) break;
      this.delete(m.file_id);
    }
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
    try {
      const metaPath = path.join(this.dir, file_id + '.json');
      writeFileSync(metaPath + '.tmp', JSON.stringify(file));
      renameSync(metaPath + '.tmp', metaPath);
    } catch (err) { rmSync(this.pathFor(file_id), { force: true }); throw err; }
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
    if (!/^file_[a-f0-9]{32}$/.test(file_id)) return;
    rmSync(this.pathFor(file_id), { force: true });
    rmSync(path.join(this.dir, file_id + '.json'), { force: true });
    const meta = this.meta.get(file_id);
    if (meta) { this.total -= meta.size; this.meta.delete(file_id); }
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
