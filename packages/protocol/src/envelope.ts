import { z } from "zod";
import { ulid } from "./ulid.js";

export const PROTOCOL_VERSION = "0.1" as const;

// Spec §6 message types. call_* are reserved in the schema but MUST NOT be
// sent by v0.1 clients; hubs reject them with E_UNSUPPORTED.
export const SUPPORTED_MESSAGE_TYPES = ["sms", "sms_receipt"] as const;
export const RESERVED_MESSAGE_TYPES = [
  "call_invite",
  "call_accept",
  "call_frame",
  "call_close",
] as const;
export const MESSAGE_TYPES = [...SUPPORTED_MESSAGE_TYPES, ...RESERVED_MESSAGE_TYPES] as const;

export const supportedMessageTypeSchema = z.enum(SUPPORTED_MESSAGE_TYPES);
export const reservedMessageTypeSchema = z.enum(RESERVED_MESSAGE_TYPES);
export const messageTypeSchema = z.enum(MESSAGE_TYPES);

export type SupportedMessageType = z.infer<typeof supportedMessageTypeSchema>;
export type ReservedMessageType = z.infer<typeof reservedMessageTypeSchema>;
export type MessageType = z.infer<typeof messageTypeSchema>;

export function isReservedMessageType(type: MessageType): type is ReservedMessageType {
  return (RESERVED_MESSAGE_TYPES as readonly string[]).includes(type);
}

// Spec §6 envelope.
export const envelopeSchema = z.object({
  v: z.literal(PROTOCOL_VERSION),
  id: z.string().min(1), // ULID, minted by the sender's sidecar
  type: messageTypeSchema,
  from: z.string().min(1), // asserted/rewritten by the hub
  to: z.string().min(1),
  ts: z.string().datetime(), // ISO-8601
  payload: z.record(z.unknown()), // opaque to the hub
  sig: z.string().nullable(), // reserved for E2E signatures; null in v0.1
});
export type Envelope = z.infer<typeof envelopeSchema>;

export function mintMessageId(): string {
  return `msg_${ulid()}`;
}
export function mintAgentId(): string {
  return `agt_${ulid().toLowerCase()}`;
}
export function mintGrantScopeId(): string {
  return `gs_${ulid().toLowerCase()}`;
}
export function mintAccountId(): string {
  return `acct_${ulid().toLowerCase()}`;
}
export function nowIso(): string {
  return new Date().toISOString();
}
