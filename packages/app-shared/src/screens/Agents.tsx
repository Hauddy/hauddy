import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { Agent, NicknameAvailability } from '../api/types';
import { PresenceDot } from '../components/Presence';

/** The landing surface: your agents on the network (exposed agents + connectors),
 *  each linking to its page (handle, bio, links, access). Reserve an @handle for
 *  your account at the bottom, then assign it from an agent's page. */
export default function Agents() {
  const overview = useApiData(() => api.nicknamesOverview());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-sub">
            Your agents on the network — exposed agents and connectors. Click one to manage its handle, bio, and
            visibility.
          </p>
        </div>
      </div>

      {overview === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : (
        <>
          {overview.agents.length === 0 ? (
            <div className="empty-state">
              No agents yet — expose one from the Hauddy app (or add a connector on the Account page), then it'll
              show up here to name and manage.
            </div>
          ) : (
            <div className="contact-list">
              {overview.agents.map((a) => (
                <AgentRow key={a.id} agent={a} />
              ))}
            </div>
          )}

          <section className="detail-section reserve-section" aria-label="Reserve a handle">
            <h2 className="section-title">Reserve a handle</h2>
            <p className="book-explainer">
              Park an <code>@handle</code> for your account before an agent holds it — then assign it from that
              agent's page. Handles are globally unique across Hauddy.
            </p>
            <ReservePanel />

            {overview.reserved.length > 0 && (
              <div className="reserved-list">
                <h3 className="friend-group-title">Reserved</h3>
                <div className="contact-list">
                  {overview.reserved.map((name) => (
                    <ReservedRow key={name} name={name} />
                  ))}
                </div>
              </div>
            )}
          </section>
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

/** A reserved-but-unattached handle. Attaching happens by typing the handle on an
 *  agent's page (it recognises your reservation), so here you can only release it. */
function ReservedRow({ name }: { name: string }) {
  const [busy, setBusy] = useState(false);
  const release = async () => {
    setBusy(true);
    await api.releaseReservation(name);
    // list refreshes via the store bump; nothing to unset locally.
  };
  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{name}</span>
        <span className="contact-desc"> — reserved · assign it from an agent’s page</span>
      </div>
      <div className="contact-meta">
        <button type="button" className="btn btn-ghost btn-sm" onClick={release} disabled={busy}>
          Release
        </button>
      </div>
    </div>
  );
}

/** One of your agents — links to its page (handle, bio, external links, access). */
function AgentRow({ agent }: { agent: Agent }) {
  const isConnector = agent.kind === 'connector';
  return (
    <Link className="contact-row contact-row-link" to={`/agents/${encodeURIComponent(agent.id)}`}>
      <div className="contact-main">
        <span className="contact-nick">
          <PresenceDot state={agent.online ? 'online' : 'offline'} />{' '}
          {agent.nickname || <span className="muted-inline">no handle yet</span>}
        </span>
        {agent.description && <span className="contact-desc"> — {agent.description}</span>}
      </div>
      <div className="contact-meta">
        {isConnector && (
          <span className="ext-badge" title="A connector for an external AI or script">
            connector
          </span>
        )}
        {isConnector && !agent.listed && (
          <span className="ext-badge muted-badge" title="Private — only you can see this connector">
            private
          </span>
        )}
        {agent.openLink && (
          <span className="ext-badge" title="Anyone can link to this agent">
            external
          </span>
        )}
        <span className="row-chevron" aria-hidden>
          ›
        </span>
      </div>
    </Link>
  );
}
