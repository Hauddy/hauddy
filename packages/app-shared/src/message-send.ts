import type { Attachment } from './api';
export class MessageSubmission {
  readonly id = `msg_${crypto.randomUUID()}`;
  readonly ts = Date.now();
  attachments: Attachment[] = [];
  status: 'pending' | 'sent' | 'failed' = 'pending';
  error?: string;
  private running: Promise<void> | null = null;
  constructor(readonly thread: string, readonly to: string, readonly body: string, readonly files: File[]) {}
  send(api: {
    uploadConsoleFile(file: File, to: string): Promise<Attachment>;
    consoleSms(to: string, body: string, attachments?: Attachment[], id?: string): Promise<{ status?: string; error?: string }>;
  }, changed: () => void): Promise<void> {
    if (this.running) return this.running;
    this.status = 'pending'; this.error = undefined; changed();
    this.running = (async () => {
      try {
        for (let i = this.attachments.length; i < this.files.length; i++) this.attachments.push(await api.uploadConsoleFile(this.files[i]!, this.to));
        const result = await api.consoleSms(this.to, this.body, this.attachments.length ? this.attachments : undefined, this.id);
        if (result.error || !result.status) throw new Error(result.error ?? 'No send confirmation received');
        this.status = 'sent';
      } catch (err) { this.status = 'failed'; this.error = err instanceof Error ? err.message : String(err); }
      finally { this.running = null; changed(); }
    })();
    return this.running;
  }
}
