import type { Presence as PresenceState } from '../api/types';

/** 3-state presence, never a bare dot: solid = online, dashed ring =
 *  reachable with delay (the common default, not an error), grey ring =
 *  offline / unlinked. Styling comes from @hauddy/web-tokens. */
export default function Presence({ state, label }: { state: PresenceState; label: string }) {
  return <span className={`presence presence-${state}`}>{label}</span>;
}

export function PresenceDot({ state }: { state: PresenceState }) {
  return <span className={`dot dot-${state}`} role="img" aria-label={state} />;
}
