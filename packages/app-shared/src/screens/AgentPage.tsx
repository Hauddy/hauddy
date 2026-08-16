import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApiState, type ConnectorOAuth } from '../api';
import type { Agent, BookContact, NicknameAvailability } from '../api/types';
import { PresenceDot } from '../components/Presence';
import Combobox, { type ComboItem } from '../components/Combobox';
import CopyChip from '../components/CopyChip';
import EmptyState from '../components/EmptyState';
import ErrorState from '../components/ErrorState';
import { SkeletonList } from '../components/LoadingSkeleton';

type Note = { ok: boolean; text: string } | null;

const KIND_LABEL: Record<string, string> = {
  connector: 'Connector (external AI / script)',
  agent: 'Exposed agent',
  human: 'Account identity',
};

/** Manage a single one of your agents: its @handle (live availability, honours
 *  your reservations), bio, external auto-accept, plus message/unexpose. Reached
 *  from the Agents list. */
export default function AgentPage() {
  const { agentId = '' } = useParams();
  const navigate = useNavigate();
  const { data: agent, error, refetch } = useApiState(() => api.getAgentById(agentId), [agentId]);

  if (agent === undefined) {
    if (error) return <ErrorState title="Unable to load agent details" error={error} onRetry={refetch} />;
    return <SkeletonList count={3} />;
  }

  if (agent === null) {
    return (
      <EmptyState
        icon="agent"
        title="Agent not found"
        description="This agent was not found. It may have been removed or unexposed."
        action={
          <Link className="btn btn-ghost btn-sm" to="/">
            ← Back to Agents
          </Link>
        }
      />
    );
  }

  const handle = agent.nickname || null;
  const isConnector = agent.kind === 'connector';

  const remove = async () => {
    if (!confirm('Remove this agent from the network? It stops being reachable until re-exposed.')) return;
    const r = await api.unexposeAgent(agent.id);
    if (r.ok) navigate('/');
  };

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="back-link" to="/">
            ← Agents
          </Link>
          <h1 className="page-title">
            <PresenceDot state={agent.online ? 'online' : 'offline'} /> {handle ?? 'Unnamed agent'}
          </h1>
          <p className="page-sub">
            {agent.online ? 'online' : 'offline'}
            {handle ? '' : ' · no handle yet'}
          </p>
        </div>
      </div>

      <HandleSection agentId={agent.id} current={handle} />
      <BioSection agentId={agent.id} current={agent.description} />
      {isConnector && <NetworkVisibilitySection agentId={agent.id} on={!!agent.listed} />}
      {isConnector && <ContactBookSection agentId={agent.id} />}
      <ExternalSection agentId={agent.id} on={!!agent.openLink} count={agent.externalLinks ?? 0} />
      <AccessSection agent={agent} onRevoked={() => navigate('/')} />

      <h2 className="section-title">Actions</h2>
      <div className="agent-actions">
        {handle && (
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => navigate(`/messages?to=${encodeURIComponent(handle)}`)}
          >
            Message
          </button>
        )}
        {/* Connectors are retired via Revoke in the Access section (which also
            drops the token + OAuth creds), so no generic Remove here. */}
        {!isConnector && (
          <button type="button" className="btn btn-danger-ghost" onClick={remove}>
            Remove from network
          </button>
        )}
      </div>
    </>
  );
}

/** Where this identity comes from (kind + runtime/grant) and — for connectors —
 *  the scoped bearer/OAuth credentials behind it, with rotate + revoke. */
function AccessSection({ agent, onRevoked }: { agent: Agent; onRevoked: () => void }) {
  const isConnector = agent.kind === 'connector';
  const runtimeLabel = agent.localId ? 'Local runtime' : 'Grant scope';
  const runtime = agent.localId || agent.grantScopeId || null;
  const [rotated, setRotated] = useState<{ token: string; oauth: ConnectorOAuth } | null>(null);
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const rotate = async () => {
    setBusy(true);
    setNote(null);
    const r = await api.rotateConnector(agent.id);
    setBusy(false);
    if (r.ok) {
      setRotated({ token: r.token, oauth: r.oauth });
      setNote({ ok: true, text: 'Rotated — the previous token and secret no longer work.' });
    } else {
      setNote({ ok: false, text: r.error });
    }
  };

  const revoke = async () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3500);
      return;
    }
    setArmed(false);
    setBusy(true);
    await api.revokeConnector(agent.id);
    onRevoked();
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Access &amp; runtime</h2>
      <dl className="access-grid">
        <div className="access-row">
          <dt>Kind</dt>
          <dd>{KIND_LABEL[agent.kind ?? 'agent'] ?? agent.kind}</dd>
        </div>
        {runtime && (
          <div className="access-row">
            <dt>{runtimeLabel}</dt>
            <dd>
              <code>{runtime}</code>
            </dd>
          </div>
        )}
        {isConnector && agent.connector ? (
          <>
            <div className="access-row">
              <dt>Bearer token</dt>
              <dd>
                <code>{agent.connector.masked}</code>
              </dd>
            </div>
            <div className="access-row">
              <dt>Scope</dt>
              <dd>{agent.connector.scope.split(',').join(' · ') || '—'}</dd>
            </div>
            {agent.connector.clientId && (
              <div className="access-row">
                <dt>OAuth client</dt>
                <dd>
                  <code>{agent.connector.clientId}</code>
                </dd>
              </div>
            )}
          </>
        ) : null}
      </dl>

      {isConnector ? (
        <>
          <p className="book-explainer">
            An outside AI or script authenticates as this identity with a scoped bearer token — or, headless, with
            its OAuth <code>client_id</code> + secret. <strong>Rotate</strong> swaps in fresh credentials (old ones
            die immediately); <strong>Revoke</strong> retires the connector and frees its <code>@handle</code>.
          </p>
          {rotated ? (
            <div className="conn-created">
              <p>New credentials — copy now, they won't be shown again.</p>
              <CopyChip label="Bearer token" value={rotated.token} />
              {rotated.oauth.client_id && rotated.oauth.client_secret ? (
                <>
                  <CopyChip label="Client ID" value={rotated.oauth.client_id} />
                  <CopyChip label="Client secret" value={rotated.oauth.client_secret} />
                </>
              ) : null}
            </div>
          ) : null}
          <div className="agent-actions">
            <button type="button" className="btn btn-ghost" onClick={rotate} disabled={busy}>
              {busy && !armed ? 'Working…' : 'Rotate credentials'}
            </button>
            <button type="button" className="btn btn-danger-ghost" onClick={revoke} disabled={busy}>
              {armed ? 'Confirm revoke?' : 'Revoke connector'}
            </button>
          </div>
        </>
      ) : (
        <p className="book-explainer">
          This agent authenticates through your account API key
          {runtime ? (
            <>
              {' '}
              under grant <code>{runtime}</code>
            </>
          ) : null}
          . Rotate the key from <strong>Account</strong> to cut off every agent at once.
        </p>
      )}
      {note && (
        <div className={`notice ${note.ok ? 'ok' : 'bad'}`} aria-live="polite">
          {note.text}
        </div>
      )}
    </section>
  );
}

function HandleSection({ agentId, current }: { agentId: string; current: string | null }) {
  const [value, setValue] = useState('');
  const [avail, setAvail] = useState<NicknameAvailability | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const bare = value.trim().replace(/^@/, '');
  const currentBare = (current ?? '').replace(/^@/, '');

  useEffect(() => {
    setNote(null);
    if (!bare || bare === currentBare) {
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
  }, [bare, currentBare]);

  // Assignable if free, or it's your OWN reservation (recognised + consumed on bind).
  const assignable =
    !!bare && bare !== currentBare && !busy && !!avail && (avail.available || (!!avail.mine && avail.reason === 'reserved'));

  const assign = async () => {
    if (!assignable) return;
    setBusy(true);
    const r = await api.setAgentNickname(agentId, bare);
    setBusy(false);
    if (r.ok) {
      setValue('');
      setAvail(null);
      setNote({ ok: true, text: `Handle set to ${r.nickname}.` });
    } else {
      setNote({
        ok: false,
        text: r.reason === 'conflict' || r.reason === 'taken' ? `@${bare} is taken — pick another.` : 'Not a valid handle.',
      });
    }
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Handle</h2>
      <p className="book-explainer">
        {current ? (
          <>
            This agent is <code>{current}</code>. Type a new handle to change it.
          </>
        ) : (
          <>This agent has no handle yet — type one to assign it.</>
        )}{' '}
        Your reserved handles are recognised and consumed when you assign them.
      </p>
      <div className="check-row">
        <input
          className="input mono"
          placeholder={current ? 'new handle' : 'e.g. scout'}
          value={value}
          spellCheck={false}
          autoComplete="off"
          aria-label="Agent handle"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && assignable && void assign()}
        />
        <button type="button" className="btn btn-inverse" onClick={assign} disabled={!assignable}>
          Assign
        </button>
      </div>
      <div className="avail-region" aria-live="polite">
        {note ? (
          <div className={`avail-line ${note.ok ? 'avail-ok' : 'reserve-hint bad'}`}>{note.text}</div>
        ) : avail && bare && bare !== currentBare ? (
          avail.available ? (
            <div className="avail-line avail-ok">✓ {avail.name} is available</div>
          ) : avail.reason === 'invalid' ? (
            <div className="avail-line reserve-hint bad">Not a valid handle — 2–24 chars: a–z, 0–9, _ or -.</div>
          ) : avail.mine ? (
            <div className="avail-line reserve-hint">
              {avail.name} is {avail.reason === 'reserved' ? 'reserved by you — assign to use it' : 'already on another of your agents'}.
            </div>
          ) : (
            <div className="avail-line reserve-hint bad">
              {avail.name} is {avail.reason === 'reserved' ? 'reserved' : 'taken'} — pick another.
            </div>
          )
        ) : null}
        {avail && !avail.available && avail.suggestions && avail.suggestions.length > 0 && bare !== currentBare && (
          <div className="suggestion-chips">
            <span className="suggestion-label">Suggested:</span>
            {avail.suggestions.map((s) => (
              <button
                key={s}
                type="button"
                className="chip-btn"
                onClick={() => {
                  setValue(s.replace(/^@/, ''));
                  setNote(null);
                }}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function BioSection({ agentId, current }: { agentId: string; current: string }) {
  const [bio, setBio] = useState('');
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<Note>(null);

  useEffect(() => {
    if (!dirty) setBio(current ?? '');
  }, [current, dirty]);

  const save = async () => {
    setBusy(true);
    const r = await api.setAgentSettings(agentId, { bio });
    setBusy(false);
    if (r.ok) {
      setDirty(false);
      setNote({ ok: true, text: 'Saved.' });
    } else {
      setNote({ ok: false, text: r.error });
    }
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Bio</h2>
      <div className="settings-form">
        <label className="settings-field settings-field-wide">
          <textarea
            className="input settings-textarea"
            rows={3}
            placeholder="What this agent is for…"
            value={bio}
            onChange={(e) => {
              setBio(e.target.value);
              setDirty(true);
              setNote(null);
            }}
          />
        </label>
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || bio === (current ?? '')}>
          {busy ? 'Saving…' : 'Save bio'}
        </button>
      </div>
      {note && (
        <div className={`notice ${note.ok ? 'ok' : 'bad'}`} aria-live="polite">
          {note.text}
        </div>
      )}
    </section>
  );
}

/** Connector-only: whether other people on the network can discover this agent.
 *  Off by default — a connector is network-first (it always goes through the
 *  platform) but private to you; the external AI can still message your agents
 *  and you can still reach it. Flip it on to make it visible like an exposed
 *  agent (friends/contacts can find and message its @handle). */
function NetworkVisibilitySection({ agentId, on }: { agentId: string; on: boolean }) {
  const [checked, setChecked] = useState(on);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setChecked(on);
  }, [on, touched]);

  const toggle = async (v: boolean) => {
    setTouched(true);
    setChecked(v);
    await api.setAgentSettings(agentId, { listed: v });
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">Network visibility</h2>
      <label className="settings-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => void toggle(e.target.checked)} />
        <span className="settings-toggle-text">
          <strong>Discoverable on the network</strong>
          <span className="settings-toggle-sub">
            By default this connector is <em>private</em> — only you see it, though the external AI can still
            message your agents. Turn this on to make its <code>@handle</code> visible to your contacts, like an
            exposed agent, so they can find and message it.
          </span>
        </span>
      </label>
    </section>
  );
}

/** Connector contact book — curates what the connector sees in `list_contacts`.
 *  A non-empty book IS the list (so the external AI sees exactly these); empty
 *  falls back to your reachable agents/contacts. You can only add contacts the
 *  connector can actually reach (same-account agents + your contacts). */
function ContactBookSection({ agentId }: { agentId: string }) {
  const { data, loading, error: bookError, refetch: refetchBook } = useApiState(() => api.getAgentBook(agentId), [agentId]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<Note>(null);

  const book = data?.book ?? [];
  const bookable = data?.bookable ?? [];
  const items: ComboItem[] = bookable
    .map((c: BookContact) => ({ value: c.handle ?? '', label: c.handle ?? '(unnamed)', description: c.description ?? undefined }))
    .filter((i: ComboItem) => i.value);

  const add = async (handle: string) => {
    setAdding(false);
    const r = await api.addAgentBookContact(agentId, handle);
    setNote(r.ok ? { ok: true, text: `Added ${handle}.` } : { ok: false, text: r.error });
  };
  const remove = async (handle: string) => {
    if (!handle) return;
    await api.removeAgentBookContact(agentId, handle);
  };

  return (
    <section className="settings-section">
      <div className="book-head">
        <h2 className="section-title">Contact book</h2>
        {bookable.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add contact'}
          </button>
        )}
      </div>
      <p className="book-explainer">
        Curate what this connector sees in <code>list_contacts</code>. With a book set it sees exactly these; leave
        it empty and it sees your reachable agents and contacts by default. You can only add contacts it can reach.
      </p>
      {note && <div className={`notice ${note.ok ? 'ok' : 'bad'}`}>{note.text}</div>}
      {adding && (
        <div className="pool-add-book">
          {items.length === 0 ? (
            <div className="empty-state book-picker-empty">No more reachable contacts to add.</div>
          ) : (
            <Combobox items={items} onSelect={add} clearOnSelect placeholder="Type a contact's @handle…" ariaLabel="Pick a contact" />
          )}
        </div>
      )}
      {loading && !data ? (
        <SkeletonList count={2} />
      ) : bookError && !data ? (
        <ErrorState title="Unable to load contact book" error={bookError} onRetry={refetchBook} />
      ) : book.length === 0 ? (
        <EmptyState
          icon="contact"
          title="No book contacts yet"
          description="No book yet — this connector sees your reachable contacts by default. Add one to curate the list."
        />
      ) : (
        <div className="contact-list">
          {book.map((c: BookContact) => (
            <div className="contact-row" key={c.agent_id}>
              <div className="contact-main">
                <span className="contact-nick">
                  <PresenceDot state={c.online ? 'online' : 'offline'} /> {c.handle ?? c.agent_id}
                </span>
                {c.description && <span className="contact-desc"> — {c.description}</span>}
              </div>
              <div className="contact-meta">
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(c.handle ?? '')}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {note && (
        <div className={`notice ${note.ok ? 'ok' : 'bad'}`} aria-live="polite">
          {note.text}
        </div>
      )}
    </section>
  );
}

function ExternalSection({ agentId, on, count }: { agentId: string; on: boolean; count: number }) {
  const [checked, setChecked] = useState(on);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setChecked(on);
  }, [on, touched]);

  const toggle = async (v: boolean) => {
    setTouched(true);
    setChecked(v);
    await api.setAgentSettings(agentId, { open_link: v });
  };

  return (
    <section className="settings-section">
      <h2 className="section-title">External links</h2>
      <label className="settings-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => void toggle(e.target.checked)} />
        <span className="settings-toggle-text">
          <strong>Let anyone link to this agent</strong>
          <span className="settings-toggle-sub">
            Anyone — even people you're not friends with — can request a link and be auto-accepted. They'll reach{' '}
            <em>only this agent</em>, not your account's other agents. Turning this off disconnects everyone who
            linked.
            {on && count > 0 ? ` ${count} external ${count === 1 ? 'account is' : 'accounts are'} connected.` : ''}
          </span>
        </span>
      </label>
    </section>
  );
}
