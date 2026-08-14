import { z } from "zod";
import { envelopeSchema } from "./envelope.js";
import { errorCodeSchema } from "./errors.js";
import { nicknameStatusSchema } from "./nickname.js";
import { presenceSchema } from "./presence.js";

// Spec §8 control frames (sidecar ↔ hub, one WebSocket per grant scope):
//
//   sidecar → hub   auth_hello    { agent_id, grant_scope_id }
//   hub → sidecar   auth_challenge { nonce }
//   sidecar → hub   auth_response { signature: Ed25519(nonce, private key) }
//   hub → sidecar   auth_ok       { presence snapshot of linked contacts }
//   sidecar → hub   send          { envelope }
//   hub → sidecar   deliver       { envelope }   // requires ack
//   sidecar → hub   ack           { id }
//   hub → sidecar   receipt       { id, status: "delivered" | "queued" }
//   either → either error         { code, message, ref? }

export const authHelloFrameSchema = z.object({
  type: z.literal("auth_hello"),
  agent_id: z.string().min(1),
  grant_scope_id: z.string().min(1),
  /** Optional local nickname claim (spec §2.4), bare form without '@'. */
  nickname: z.string().min(1).optional(),
  /** Sidecar semver, e.g. "0.1.0". Missing = treated as "0.0.0" by the platform. */
  client_version: z.string().optional(),
});

export const authRejectedFrameSchema = z.object({
  type: z.literal("auth_rejected"),
  reason: z.enum(["client_outdated", "not_allowlisted", "bad_credentials"]),
  /** Minimum required semver; present when reason = client_outdated. */
  min_version: z.string().optional(),
  /** Latest known release version. */
  latest_version: z.string().optional(),
  message: z.string().optional(),
});

export const authChallengeFrameSchema = z.object({
  type: z.literal("auth_challenge"),
  nonce: z.string().min(1), // base64url
});

export const authResponseFrameSchema = z.object({
  type: z.literal("auth_response"),
  signature: z.string().min(1), // base64url Ed25519 signature over the nonce
});

export const authOkFrameSchema = z.object({
  type: z.literal("auth_ok"),
  presence: z.array(presenceSchema), // snapshot of linked contacts
  /** The connection's verified nickname ('@gio'), the attempted one on
   *  conflict, or null when none was claimed (spec §2.4). */
  nickname: z.string().nullable(),
  nickname_status: nicknameStatusSchema,
});

export const sendFrameSchema = z.object({
  type: z.literal("send"),
  envelope: envelopeSchema,
});

export const deliverFrameSchema = z.object({
  type: z.literal("deliver"),
  envelope: envelopeSchema,
});

export const ackFrameSchema = z.object({
  type: z.literal("ack"),
  id: z.string().min(1),
});

// Claim/release inbound ownership of one of the agent's nicknames among its
// live sockets (fork single-writer arbitration, spec §2.3/§2.4).
export const claimFrameSchema = z.object({
  type: z.literal("claim"),
  nickname: z.string().min(1),
});

export const releaseFrameSchema = z.object({
  type: z.literal("release"),
  nickname: z.string().min(1),
});

// A session reports whether it can be *rung* for a call — i.e. the app verified
// it can inject into the harness (spec § Calls). SMS ignores this; presence
// exposes it as the "call" capability.
export const capabilityFrameSchema = z.object({
  type: z.literal("capability"),
  call: z.boolean(),
});

export const receiptStatusSchema = z.enum(["delivered", "queued"]);
export type ReceiptStatus = z.infer<typeof receiptStatusSchema>;

export const receiptFrameSchema = z.object({
  type: z.literal("receipt"),
  id: z.string().min(1),
  status: receiptStatusSchema,
});

export const errorFrameSchema = z.object({
  type: z.literal("error"),
  code: errorCodeSchema,
  message: z.string(),
  ref: z.string().optional(),
});

export const controlFrameSchema = z.discriminatedUnion("type", [
  authHelloFrameSchema,
  authRejectedFrameSchema,
  authChallengeFrameSchema,
  authResponseFrameSchema,
  authOkFrameSchema,
  sendFrameSchema,
  deliverFrameSchema,
  ackFrameSchema,
  claimFrameSchema,
  releaseFrameSchema,
  capabilityFrameSchema,
  receiptFrameSchema,
  errorFrameSchema,
]);

export type AuthHelloFrame = z.infer<typeof authHelloFrameSchema>;
export type AuthRejectedFrame = z.infer<typeof authRejectedFrameSchema>;
export type AuthChallengeFrame = z.infer<typeof authChallengeFrameSchema>;
export type AuthResponseFrame = z.infer<typeof authResponseFrameSchema>;
export type AuthOkFrame = z.infer<typeof authOkFrameSchema>;
export type SendFrame = z.infer<typeof sendFrameSchema>;
export type DeliverFrame = z.infer<typeof deliverFrameSchema>;
export type AckFrame = z.infer<typeof ackFrameSchema>;
export type ClaimFrame = z.infer<typeof claimFrameSchema>;
export type ReleaseFrame = z.infer<typeof releaseFrameSchema>;
export type CapabilityFrame = z.infer<typeof capabilityFrameSchema>;
export type ReceiptFrame = z.infer<typeof receiptFrameSchema>;
export type ErrorFrame = z.infer<typeof errorFrameSchema>;
export type ControlFrame = z.infer<typeof controlFrameSchema>;
