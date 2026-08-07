/** Shared types for the platform (network hub) dashboard. Every shape here is
 *  what the real hub control API returns — see `packages/hub/src/server.ts`
 *  (`agentView`, `accountView`) and `packages/sidecar/src/hub-api.ts`. */

export type Presence = 'online' | 'delay' | 'offline';

export interface UserProfile {
  email: string;
  name: string;
}

/** The account's single API key (one key per account on the platform). */
export interface AccountKey {
  masked: string;
}

/** One of the account's agents on the platform. */
export interface Agent {
  id: string; // platform agent_id
  nickname: string; // '@nabu' (may be '' if unnamed)
  description: string;
  online: boolean;
  kind?: string; // 'human' (the account's console identity) or 'agent'
}

/** A global nickname, derived from an account agent that holds it. */
export interface Nickname {
  /** agent_id that owns it — the rename target. */
  agentId: string;
  name: string; // '@nabu'
  description: string | null;
  online: boolean;
}

/** A linked network contact of one of your agents. */
export interface Contact {
  agentId: string;
  nickname: string;
  description: string;
  presence: Presence;
}

/** An incoming contact request awaiting one of your agents' response. */
export interface PendingContact {
  agentId: string; // the requester
  nickname: string;
  description: string;
}

export type NicknameOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: 'taken' | 'invalid' | 'conflict' };

/** Reserving an account-level hold on a handle (before an agent binds it). */
export type ReserveOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: 'invalid' | 'taken' | 'limit'; detail?: string };

/** Live availability of a handle across bound nicknames + reservations. */
export interface NicknameAvailability {
  name: string; // '@bare' (or the raw input when invalid)
  available: boolean;
  reason?: 'bound' | 'reserved' | 'invalid';
  mine?: boolean; // the blocker is your own binding/reservation
}

export type ContactActionResult = { ok: true } | { ok: false; error: string };
