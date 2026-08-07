import { z } from "zod";

// Spec §5 presence object. "online" = at least one sidecar socket open with
// a verified nickname (spec §2.4); unverified connections are offline to
// linked contacts even while attached.
export const presenceStateSchema = z.enum(["online", "offline"]);
export const capabilitySchema = z.enum(["sms", "call"]); // "call" reserved

export const presenceSchema = z.object({
  agent_id: z.string().min(1),
  state: presenceStateSchema,
  capabilities: z.array(capabilitySchema),
  attached_instances: z.number().int().nonnegative(),
  /** Bound nickname ('@gio') when the agent has one, else null (spec §2.4). */
  nickname: z.string().nullable().optional(),
});

export type PresenceState = z.infer<typeof presenceStateSchema>;
export type Capability = z.infer<typeof capabilitySchema>;
export type Presence = z.infer<typeof presenceSchema>;
