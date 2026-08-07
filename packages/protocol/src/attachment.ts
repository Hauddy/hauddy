import { z } from "zod";

/**
 * A file attached to an SMS (or call) message. The bytes live in a hub's temp
 * file store (out-of-band); the envelope payload carries only this reference, so
 * frames stay small and the durable inbox isn't bloated. `file_id` is scoped to
 * whichever hub currently holds the bytes — the daemon rewrites it as the file
 * hops from a machine's local hub to the platform and back (see the relay).
 *
 * Attached under `payload.attachments` (the payload is opaque to the hub).
 */
export const attachmentSchema = z.object({
  file_id: z.string().min(1),
  name: z.string().min(1),
  mime: z.string().min(1),
  size: z.number().int().nonnegative(),
});

export type Attachment = z.infer<typeof attachmentSchema>;

/** Total bytes allowed across one message's attachments (spec: 10 MB). */
export const MAX_ATTACHMENTS_BYTES = 10 * 1024 * 1024;
