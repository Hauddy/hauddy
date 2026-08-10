/** Shared types for the sidecar's local API. A real implementation talking to
 *  the sidecar daemon must satisfy the same shapes — components depend only
 *  on this file. */

export type Presence = 'online' | 'delay' | 'offline';

/** attached = a live runtime connected right now; detached = agent exists,
 *  nothing running; enrolled = never linked to a nickname. */
export type AgentStatus = 'attached' | 'detached' | 'enrolled';

export interface EnrolledAgent {
  /** The human's own local reference — distinct from the platform @nickname. */
  localId: string;
  /** The agent's id on the local hub (agt_…) — used to resolve history/call-frame
   *  ids back to this runtime (view-as inbox, call-frame nick resolution). */
  agentId: string;
  status: AgentStatus;
  /** Platform nicknames linked to this runtime, e.g. ['@gio']. */
  nicknames: string[];
  /** Outbound default: which linked nickname this runtime speaks as.
   *  Only meaningful when more than one nickname is linked. */
  speakingAs: string | null;
  /** Agent-declared bio — the same description shared when the agent is exposed. */
  description: string | null;
}

export type LinkResult =
  | { ok: true }
  | { ok: false; /** localId currently holding the nickname */ conflict: string };

/** An agent that lives only on the connected platform — a connector (external AI
 *  / script) or an agent exposed from another machine under this account. Shown
 *  alongside local agents once connected; absent while offline. */
export interface NetworkAgent {
  /** The agent's id on the platform (agt_…) — used to remove it. */
  agentId: string;
  handle: string | null;
  kind: 'connector' | 'agent';
  online: boolean;
  description: string | null;
  /** Discoverable by other accounts (connectors default false). */
  listed: boolean;
}

/** Outcome of assigning a platform @handle (globally-unique, reservation-aware). */
export type NicknameOutcome =
  | { ok: true; nickname: string }
  | { ok: false; reason: 'invalid' | 'taken' | 'conflict' };

/** One entry in a network agent's curated contact book (or a candidate to add). */
export interface NetworkBookContact {
  agent_id: string;
  handle: string | null;
  description: string | null;
  online: boolean;
}

/** One entry in an agent's contact book. `origin` is the honest local/web
 *  state: `local` resolves to an agent on this machine, `network` is a handle
 *  we don't hold locally (reachable once the platform tier ships). */
export interface BookContact {
  handle: string; // '@ada'
  presence: Presence;
  origin: 'local' | 'network';
  description: string | null;
}

/** A profile-pool entry — what every agent's book can be filled from. Local
 *  agents are auto-included (`removable: false`); manually-added @handles are
 *  removable. */
export interface PoolContact extends BookContact {
  removable: boolean;
}

export type AddContactResult = { ok: true } | { ok: false; error: string };

/** A file attached to a message — a reference into a hub's temp store. */
export interface Attachment {
  file_id: string;
  name: string;
  mime: string;
  size: number;
}

// ---- friends (profile↔profile links, spec §"friends") ------------------

export interface FriendAgent {
  agent_id: string;
  nickname: string | null;
  kind?: 'human' | 'agent';
  attached?: boolean;
}
export interface FriendAccount {
  account_id: string;
  email: string | null;
}
export interface LinkedFriend extends FriendAccount {
  agents: FriendAgent[];
}
export interface FriendsView {
  auto_accept: boolean;
  linked: LinkedFriend[];
  incoming: FriendAccount[];
  outgoing: FriendAccount[];
}
export type FriendActionResult = { ok: true; state?: string } | { ok: false; error: string };

// ---- notifications (badge counts, spec §F) -----------------------------

export interface Notifications {
  friend_requests: number;
  unread_messages: number;
  missed_calls: number;
}

// ---- human console (message/call agents as the person) -----------------

export interface HumanIdentity {
  nickname: string | null;
  network: boolean;
}
export interface ConsoleMessage {
  id: string;
  from: string;
  to: string;
  ts: string;
  payload: { body?: string; call?: unknown; attachments?: Attachment[] };
}
export interface ConsoleCallFrame {
  id: string;
  kind: 'invite' | 'frame' | 'close' | string;
  from: string;
  body?: unknown;
  hub?: 'local' | 'platform';
  attachments?: Attachment[];
}
export interface ConsoleCallPoll {
  frames: ConsoleCallFrame[];
  ended?: boolean;
  active?: boolean;
  call_id?: string | null;
}

/** The app's link to a platform (the "go online" tier). */
export interface PlatformInfo {
  connected: boolean;
  endpoint: string | null;
  email: string | null;
  maskedKey: string | null;
}

/** One local agent's exposure state on the connected platform. */
export interface ExposureRow {
  localId: string;
  nickname: string | null; // local '@nick'
  exposed: boolean;
  platformNickname: string | null;
  platformOnline: boolean;
}

export type PlatformActionResult = { ok: true; nickname?: string | null } | { ok: false; error: string };

export interface ClaimRow {
  nickname: string; // '@gio'
  /** e.g. 'session a3f9 · started 10:41am'; null = unclaimed. */
  claimedBy: string | null;
}

export interface ClaimLogEntry {
  text: string;
}

export interface ActivityEntry {
  time: string; // '09:14:02'
  event: string; // 'sms.sent'
  detail: string;
}

export interface RoutingStatus {
  hub: Presence;
  hubLine: string; // 'Connected (WAN)'
  local: string[];
  viaHub: string[];
}
