import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { AgentStatus, BookContact, EnrolledAgent, Presence } from '../api/types';
import { OriginTag, PresenceDot } from '../components/Presence';

const STATUS_LABEL: Record<AgentStatus, string> = {
  attached: 'Live',
  detached: 'Idle',
  enrolled: 'No nickname',
};
const STATUS_DOT: Record<AgentStatus, Presence> = {
  attached: 'online',
  detached: 'delay',
  enrolled: 'offline',
};

/** One agent: rename it, and manage its contact book. The book is the same
 *  regardless of whether a contact is local or on the network — origin is just
 *  a tag on each row. */
export default function AgentDetail() {
  const { localId = '' } = useParams();
  const id = decodeURIComponent(localId);
  const agents = useApiData(() => api.listAgents());
  const agent = agents?.find((a) => a.localId === id) ?? null;

  if (agents === undefined) return <p className="loading-note">Loading…</p>;
  if (!agent) {
    return (
      <div className="empty-state">
        No agent <code>{id}</code> on this machine. <Link to="/">← Back to agents</Link>.
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-sub agent-back">
            <Link to="/">← Agents</Link>
          </p>
          <h1 className="page-title">
            <PresenceDot state={STATUS_DOT[agent.status]} /> <code>{agent.localId}</code>
          </h1>
          <div className="agent-detail-meta">
            <span className="agent-enrolled-status">{STATUS_LABEL[agent.status]}</span>
            <span className="origin-tag origin-local">local</span>
          </div>
        </div>
      </div>

      <NicknamePanel agent={agent} />
      <BioPanel key={agent.localId} agent={agent} />
      <ExposePanel agent={agent} />
      <ContactBook localId={agent.localId} />
      <AgentLog localId={agent.localId} />
      <DangerZone agent={agent} />
    </>
  );
}

/** Editable bio — the single agent description shared with contacts when the
 *  agent is exposed. Keyed by localId so switching agents resets the field. */
function BioPanel({ agent }: { agent: EnrolledAgent }) {
  const [value, setValue] = useState(agent.description ?? '');
  const [saved, setSaved] = useState(false);
  const dirty = value.trim() !== (agent.description ?? '').trim();

  const save = async () => {
    await api.setAgentDescription(agent.localId, value.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <section className="detail-section">
      <div className="detail-row">
        <span className="detail-label">bio</span>
        {saved && <span className="pool-auto">saved</span>}
      </div>
      <textarea
        className="input bio-input"
        value={value}
        rows={3}
        placeholder="What this agent is and does — shared with your contacts when you expose it."
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Bio for ${agent.localId}`}
      />
      <div className="bio-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty}>
          Save bio
        </button>
      </div>
    </section>
  );
}

/** Per-agent platform exposure — the toggle that used to live on the Platform
 *  page. Only shown when the app is linked and the agent has a nickname. */
function ExposePanel({ agent }: { agent: EnrolledAgent }) {
  const platform = useApiData(() => api.getPlatform());
  const exposure = useApiData(() => api.listExposure());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (platform === undefined) return null;
  if (!platform.connected) {
    return (
      <section className="detail-section">
        <div className="detail-row">
          <span className="detail-label">platform</span>
          <span className="agent-enrolled-none">
            Not linked — <Link to="/platform">connect the app</Link> to expose this agent.
          </span>
        </div>
      </section>
    );
  }

  const row = exposure?.find((r) => r.localId === agent.localId);
  const exposed = row?.exposed ?? false;
  const hasNick = agent.nicknames.length > 0;

  const toggle = async () => {
    setBusy(true);
    setError(null);
    const res = exposed ? await api.unexpose(agent.localId) : await api.expose(agent.localId);
    setBusy(false);
    if (!res.ok) setError(res.error);
  };

  return (
    <section className="detail-section">
      <div className="detail-row">
        <span className="detail-label">platform</span>
        {exposed ? (
          <span className={`presence presence-${row?.platformOnline ? 'online' : 'delay'}`}>
            Exposed as {row?.platformNickname ?? '(nickname taken)'}
          </span>
        ) : (
          <span className="agent-enrolled-none">Local only</span>
        )}
        {hasNick ? (
          <button
            type="button"
            className={`btn btn-sm detail-row-action ${exposed ? 'btn-ghost' : 'btn-primary'}`}
            onClick={toggle}
            disabled={busy}
          >
            {busy ? '…' : exposed ? 'Unexpose' : 'Expose on platform'}
          </button>
        ) : (
          <span className="agent-enrolled-none detail-row-action">Name it first to expose</span>
        )}
      </div>
      {error && <div className="notice link-conflict">{error}</div>}
    </section>
  );
}

/** Recent activity mentioning this agent — the daemon's in-memory event log,
 *  filtered to entries that reference it. */
function AgentLog({ localId }: { localId: string }) {
  const log = useApiData(() => api.agentLog(localId), [localId]);

  return (
    <section className="detail-section">
      <h2 className="section-title">Recent activity</h2>
      {log === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : log.length === 0 ? (
        <div className="empty-state book-empty">No recent activity for this agent yet.</div>
      ) : (
        <div className="agent-log">
          {log.map((e, i) => (
            <div className="agent-log-row" key={i}>
              <span className="agent-log-time">{e.time}</span>
              <span className="agent-log-event">{e.event}</span>
              <span className="agent-log-detail">{e.detail}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Irreversible full delete — confirm-click gated. On success, back to the list. */
function DangerZone({ agent }: { agent: EnrolledAgent }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const del = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setBusy(true);
    setError(null);
    const res = await api.deleteAgent(agent.localId);
    setBusy(false);
    if (res.ok) navigate('/');
    else setError(res.error ?? 'Could not delete');
  };

  return (
    <section className="detail-section danger-zone">
      <h2 className="section-title">Delete agent</h2>
      <p className="book-explainer">
        Permanently removes <code>{agent.localId}</code>: unexposes it, drops it from every contact book, and
        deletes its identity keypair from disk. This cannot be undone.
      </p>
      <button type="button" className="btn btn-danger-ghost btn-sm" onClick={del} disabled={busy}>
        {busy ? 'Deleting…' : confirm ? 'Click again to permanently delete' : 'Delete this agent'}
      </button>
      {error && <div className="notice link-conflict">{error}</div>}
    </section>
  );
}

/** Set/rename a local nickname — free, just has to be unique on this machine. */
function NicknamePanel({ agent }: { agent: EnrolledAgent }) {
  const current = agent.nicknames[0] ?? null;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState((current ?? '').replace(/^@/, ''));
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const name = value.trim().replace(/^@/, '');
    if (!name) return;
    const result = await api.linkNickname(agent.localId, name, false);
    if (result.ok) {
      setEditing(false);
      setError(null);
    } else {
      setError(`@${name} is taken on this machine — pick another.`);
    }
  };

  return (
    <section className="detail-section">
      <div className="detail-row">
        <span className="detail-label">nickname</span>
        {current ? (
          <span className="nick-chip">{current}</span>
        ) : (
          <span className="agent-enrolled-none">— none yet —</span>
        )}
        <button
          type="button"
          className="btn btn-ghost btn-sm detail-row-action"
          onClick={() => {
            setEditing((v) => !v);
            setError(null);
          }}
        >
          {editing ? 'Cancel' : current ? 'Rename' : 'Set nickname'}
        </button>
      </div>
      {editing && (
        <div className="link-panel">
          <input
            className="input mono link-panel-select"
            value={value}
            autoFocus
            placeholder="nickname"
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
            }}
            aria-label={`Nickname for ${agent.localId}`}
          />
          {error && <div className="notice link-conflict">{error}</div>}
          <div className="link-panel-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={submit} disabled={!value.trim()}>
              Save
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/** The agent's contact book — a curated subset of the profile pool. Add from
 *  the picker (step 2); new people are added at profile level in Contacts. */
function ContactBook({ localId }: { localId: string }) {
  const book = useApiData(() => api.listBook(localId), [localId]);
  const [picking, setPicking] = useState(false);

  return (
    <section className="detail-section">
      <div className="book-head">
        <h2 className="section-title book-title">Contact book</h2>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          aria-expanded={picking}
          onClick={() => setPicking((v) => !v)}
        >
          {picking ? 'Close' : '+ Add contact'}
        </button>
      </div>
      <p className="book-explainer">
        Who this agent can address — picked from your <Link to="/contacts">Contacts</Link>. Agents on this
        machine are already in there; add anyone else at profile level first.
      </p>

      {picking && <BookPicker localId={localId} onDone={() => setPicking(false)} />}

      {book === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : book.length === 0 ? (
        <div className="empty-state book-empty">
          No contacts yet. Add one from your pool with “+ Add contact”.
        </div>
      ) : (
        <div className="contact-list">
          {book.map((c) => (
            <ContactRow key={c.handle} localId={localId} contact={c} />
          ))}
        </div>
      )}
    </section>
  );
}

function ContactRow({ localId, contact }: { localId: string; contact: BookContact }) {
  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{contact.handle}</span>
        {contact.description && <span className="contact-desc"> — {contact.description}</span>}
      </div>
      <div className="contact-meta">
        <PresenceDot state={contact.presence} />
        <OriginTag origin={contact.origin} />
        <button
          type="button"
          className="btn btn-ghost btn-sm book-remove"
          onClick={() => void api.removeContact(localId, contact.handle)}
          title={`Remove ${contact.handle} from this agent's book`}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

/** Picker: profile-pool contacts not yet in this agent's book. */
function BookPicker({ localId, onDone }: { localId: string; onDone: () => void }) {
  const bookable = useApiData(() => api.listBookable(localId), [localId]);

  const add = async (handle: string) => {
    await api.addContact(localId, handle);
  };

  if (bookable === undefined) {
    return (
      <div className="card book-picker">
        <p className="loading-note">Loading…</p>
      </div>
    );
  }

  return (
    <div className="card book-picker" aria-label="Add from your contacts">
      {bookable.length === 0 ? (
        <div className="empty-state book-picker-empty">
          Everyone in your <Link to="/contacts">Contacts</Link> is already in this agent's book — add more
          people at profile level, then assign them here.
        </div>
      ) : (
        <>
          {bookable.map((c) => (
            <div className="book-picker-row" key={c.handle}>
              <div className="contact-main">
                <span className="contact-nick">{c.handle}</span>
                {c.description && <span className="contact-desc"> — {c.description}</span>}
              </div>
              <div className="contact-meta">
                <PresenceDot state={c.presence} />
                <OriginTag origin={c.origin} />
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void add(c.handle)}>
                  Add
                </button>
              </div>
            </div>
          ))}
          <div className="book-picker-foot">
            Need someone else? <Link to="/contacts" onClick={onDone}>Add them in Contacts</Link>.
          </div>
        </>
      )}
    </div>
  );
}
