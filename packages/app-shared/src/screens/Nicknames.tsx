import { useEffect, useState } from 'react';
import { api, useApiData } from '../api';
import type { Agent, Nickname, NicknameAvailability } from '../api/types';
import { PresenceDot } from '../components/Presence';

/** Global nicknames — one per exposed agent, unique across the whole platform.
 *  Reserve a handle for your account here (parks it before an agent exists),
 *  then attach it to an agent; rename bound handles inline. The platform grants
 *  uniqueness across everyone, spanning both bound nicknames and reservations. */
export default function Nicknames() {
  const overview = useApiData(() => api.nicknamesOverview());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Nicknames</h1>
          <p className="page-sub">
            Reserve an <code>@handle</code> for your account, then attach it to an agent. Each exposed
            agent holds one globally-unique handle — the platform grants uniqueness across everyone.
          </p>
        </div>
      </div>

      <ReservePanel />

      {overview === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : (
        <>
          <h2 className="section-title">Bound to an agent</h2>
          {overview.bound.length === 0 ? (
            <div className="empty-state">
              No handles bound yet — expose an agent from the Hauddy app, or attach a reservation below.
            </div>
          ) : (
            <div className="contact-list">
              {overview.bound.map((n) => (
                <NicknameRow key={n.agentId} nickname={n} />
              ))}
            </div>
          )}

          {overview.reserved.length > 0 && (
            <section className="pending-section" aria-label="Reserved handles">
              <h2 className="section-title">Reserved</h2>
              <div className="contact-list">
                {overview.reserved.map((name) => (
                  <ReservedRow key={name} name={name} agents={overview.agents} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}

/** Reserve-a-handle input with live availability, mirroring the landing's
 *  "type → check → available" step. */
function ReservePanel() {
  const [value, setValue] = useState('');
  const [avail, setAvail] = useState<NicknameAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const bare = value.trim().replace(/^@/, '');

  // Debounced availability check as you type (only while this input is active).
  useEffect(() => {
    setError(null);
    if (!bare) {
      setAvail(null);
      return;
    }
    let live = true;
    const t = setTimeout(() => {
      api.checkNickname(bare).then(
        (a) => live && setAvail(a),
        () => live && setAvail(null),
      );
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [bare]);

  const reserve = async () => {
    if (!bare) return;
    setBusy(true);
    const r = await api.reserveNickname(bare);
    setBusy(false);
    if (r.ok) {
      setValue('');
      setAvail(null);
      setError(null);
    } else {
      setError(
        r.reason === 'invalid'
          ? 'Handles are 2–24 chars: a–z, 0–9, _ or - (no leading symbol).'
          : r.detail ?? (r.reason === 'limit' ? 'You’ve reached the reservation limit.' : `@${bare} is taken.`),
      );
    }
  };

  const canReserve = !!bare && !busy && (avail?.available ?? false);

  return (
    <div className="reserve-panel">
      <div className="check-row">
        <input
          className="input mono"
          placeholder="reserve a handle, e.g. scout"
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="Reserve a nickname"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && canReserve && void reserve()}
        />
        <button type="button" className="btn btn-inverse" onClick={reserve} disabled={!canReserve}>
          Reserve
        </button>
      </div>
      <div className="avail-region" aria-live="polite">
        {error ? (
          <div className="notice link-conflict">{error}</div>
        ) : avail && bare ? (
          avail.available ? (
            <div className="avail-line avail-ok">✓ {avail.name} is available</div>
          ) : avail.reason === 'invalid' ? (
            <div className="avail-line reserve-hint bad">Not a valid handle — 2–24 chars: a–z, 0–9, _ or -.</div>
          ) : avail.mine ? (
            <div className="avail-line reserve-hint">
              {avail.name} is already {avail.reason === 'reserved' ? 'reserved by you' : 'bound to your agent'}.
            </div>
          ) : (
            <div className="avail-line reserve-hint bad">
              {avail.name} is {avail.reason === 'reserved' ? 'reserved' : 'taken'} — pick another.
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}

/** A reserved-but-unattached handle: attach it to one of your agents, or release it. */
function ReservedRow({ name, agents }: { name: string; agents: Agent[] }) {
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const attach = async () => {
    if (!agentId) return;
    setBusy(true);
    const r = await api.attachReservation(name, agentId);
    setBusy(false);
    if (!r.ok) {
      setError(r.reason === 'conflict' ? 'That handle is no longer free.' : 'Could not attach — try again.');
    } else {
      setError(null);
    }
  };

  const release = async () => {
    setBusy(true);
    await api.releaseReservation(name);
    // list refreshes via the store bump; nothing to unset locally.
  };

  const label = (a: Agent) => a.nickname || a.description || a.id;

  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{name}</span>
        <span className="contact-desc"> — reserved, not yet attached</span>
        {error && <div className="notice link-conflict">{error}</div>}
      </div>
      <div className="contact-meta reserve-actions">
        {agents.length > 0 ? (
          <>
            <select
              className="input reserve-agent"
              value={agentId}
              onChange={(e) => setAgentId(e.target.value)}
              aria-label={`Attach ${name} to an agent`}
            >
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {label(a)}
                </option>
              ))}
            </select>
            <button type="button" className="btn btn-primary btn-sm" onClick={attach} disabled={busy || !agentId}>
              Attach
            </button>
          </>
        ) : (
          <span className="page-sub">Expose an agent to attach it.</span>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={release} disabled={busy}>
          Release
        </button>
      </div>
    </div>
  );
}

function NicknameRow({ nickname }: { nickname: Nickname }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(nickname.name.replace(/^@/, ''));
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const name = value.trim().replace(/^@/, '');
    if (!name) return;
    const result = await api.renameNickname(nickname.agentId, name);
    if (result.ok) {
      setEditing(false);
      setError(null);
    } else {
      setError(
        result.reason === 'conflict' || result.reason === 'taken'
          ? `@${name} is taken across the network — pick another.`
          : 'Not a valid nickname.',
      );
    }
  };

  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{nickname.name}</span>
        {nickname.description && <span className="contact-desc"> — {nickname.description}</span>}
        {editing && (
          <div className="link-panel">
            <input
              className="input mono link-panel-select"
              value={value}
              autoFocus
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => {
                setValue(e.target.value);
                setError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && void save()}
              aria-label={`Rename ${nickname.name}`}
            />
            {error && <div className="notice link-conflict">{error}</div>}
            <div className="link-panel-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
                Cancel
              </button>
              <button type="button" className="btn btn-primary" onClick={save} disabled={!value.trim()}>
                Save
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="contact-meta">
        <PresenceDot state={nickname.online ? 'online' : 'offline'} />
        {!editing && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              setEditing(true);
              setValue(nickname.name.replace(/^@/, ''));
              setError(null);
            }}
          >
            Rename
          </button>
        )}
      </div>
    </div>
  );
}
