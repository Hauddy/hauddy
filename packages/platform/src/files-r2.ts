import { randomHex } from "./crypto.js";
import type { AttachmentRow, Db } from "./db.js";

const R2_PREFIX = "files/";

export interface PutMeta {
  name: string;
  mime: string;
  owner: string;
  to: string | null;
  account_id: string | null;
}

/**
 * The platform's attachment store: bytes in R2 at `files/<file_id>`, metadata in
 * the durable `attachments` table (so a restart no longer drops in-flight transfer
 * metadata — the gap in the Node FileStore). Reference-based: the message envelope
 * only carries a small {file_id,name,mime,size} reference. Enforces a per-file cap
 * and a whole-store quota, and sweeps expired files via a DO alarm (not setInterval).
 */
export class FileStoreR2 {
  readonly maxFileBytes = 10 * 1024 * 1024; // 10 MB (spec per-message budget)
  readonly maxTotalBytes = 500 * 1024 * 1024; // whole-store quota
  private readonly ttlMs = 24 * 60 * 60 * 1000; // 24h TTL

  constructor(
    private bucket: R2Bucket,
    private db: Db,
    private storage: DurableObjectStorage,
  ) {}

  async put(
    bytes: ArrayBuffer,
    meta: PutMeta,
    nowMs: number,
  ): Promise<{ ok: true; file: AttachmentRow } | { ok: false; error: string }> {
    if (bytes.byteLength > this.maxFileBytes) {
      return { ok: false, error: `file exceeds the ${this.maxFileBytes}-byte limit` };
    }
    if (this.db.attachmentsTotalBytes() + bytes.byteLength > this.maxTotalBytes) {
      return { ok: false, error: "attachment store is full — try again later" };
    }
    const file_id = `file_${randomHex(16)}`;
    const row: AttachmentRow = {
      file_id,
      name: meta.name,
      mime: meta.mime,
      size: bytes.byteLength,
      owner: meta.owner,
      to_ref: meta.to,
      account_id: meta.account_id,
      created_ms: nowMs,
      expires_ms: nowMs + this.ttlMs,
    };
    await this.bucket.put(R2_PREFIX + file_id, bytes);
    this.db.insertAttachment(row);
    await this.scheduleSweep(row.expires_ms);
    return { ok: true, file: row };
  }

  /** Metadata + a byte stream, or null if missing/expired. */
  async get(fileId: string, nowMs: number): Promise<{ meta: AttachmentRow; body: ReadableStream } | null> {
    const meta = this.db.getAttachment(fileId);
    if (!meta) return null;
    if (meta.expires_ms < nowMs) {
      await this.delete(fileId);
      return null;
    }
    const obj = await this.bucket.get(R2_PREFIX + fileId);
    if (!obj) {
      this.db.deleteAttachment(fileId);
      return null;
    }
    return { meta, body: obj.body };
  }

  async delete(fileId: string): Promise<void> {
    await this.bucket.delete(R2_PREFIX + fileId);
    this.db.deleteAttachment(fileId);
  }

  /** Remove every expired file, then re-arm the alarm for the next expiry. */
  async sweep(nowMs: number): Promise<void> {
    for (const id of this.db.expiredAttachments(nowMs)) await this.delete(id);
    const next = this.db.nextAttachmentExpiry();
    if (next !== null) await this.storage.setAlarm(next);
  }

  /** Ensure an alarm is armed no later than this file's expiry. */
  private async scheduleSweep(expiresMs: number): Promise<void> {
    const current = await this.storage.getAlarm();
    if (current === null || expiresMs < current) await this.storage.setAlarm(expiresMs);
  }
}
