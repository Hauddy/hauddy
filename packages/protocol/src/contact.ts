import { z } from "zod";

// Spec §4 consent state machine, per ordered pair (A, B):
//
//   none ──A shares──▶ pending(B) ──B accepts──▶ linked
//                        │
//                        ├──B declines──▶ none
//                        └──B blocks───▶ blocked(B→A)   (A cannot re-request)
//   linked ──either removes──▶ none
//   linked ──either blocks───▶ blocked
export const contactStateSchema = z.enum(["none", "pending", "linked", "blocked"]);
export type ContactState = z.infer<typeof contactStateSchema>;

/** send_sms is only permitted across a `linked` edge (hub-enforced). */
export function canSendTo(state: ContactState): boolean {
  return state === "linked";
}
