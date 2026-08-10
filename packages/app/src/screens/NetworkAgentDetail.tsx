import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { NetworkAgent } from '../api/types';
import Combobox, { type ComboItem } from '../components/Combobox';
import { PresenceDot } from '../components/Presence';

const KIND_LABEL: Record<NetworkAgent['kind'], string> = {
  connector: 'Connector (external AI / script)',
  agent: 'Exposed from another machine',
};

/** Manage one of the account's platform-only agents (a connector, or an agent
 *  exposed from another machine) from the local app — handle, bio, network
 *  visibility, contact book, message, remove. All operations proxy through the
 *  daemon to the platform, so they need the app connected; a null agent (offline
 *  or gone) shows an honest empty state rather than dead controls. */
export default function NetworkAgentDetail() {
  const { agentId = '' } = useParams();
  const id = decodeURIComponent(agentId);
  const agent = useApiData(() => api.getNetworkAgent(id), [id]);

  if (agent === undefined) return <p className="loading-note">Loading…</p>;
  if (agent === null) {
    return (
      <div className="page-head">
        <div>
          <p className="page-sub agent-back">
            <Link to="/">← Agents</Link>
          </p>
          <h1 className="page-title">Network agent</h1>
          <div className="empty-state">
            Not reachable — connect the app on the <Link to="/account">Account</Link> page, or it may have been
            removed.
          </div>
        </div>
      </div>
    );
  }

  const isConnector = agent.kind === 'connector';

  return (
    <>
      <div className="page-head">
        <div>
          <p className="page-sub agent-back">
            <Link to="/">← Agents</Link>
          </p>
          <h1 className="page-title">
            <PresenceDot state={agent.online ? 'online' : 'offline'} /> <code>{agent.handle ?? 'unnamed'}</code>
          </h1>
          <div className="agent-detail-meta">
            <span className="agent-enrolled-status">{KIND_LABEL[agent.kind]}</span>
            <span className="origin-tag origin-network">network</span>
          </div>
        </div>
      </div>

      <HandlePanel agent={agent} />
      <BioPanel key={agent.agentId} agent={agent} />
      {isConnector && <VisibilityPanel agent={agent} />}
      <ContactBookPanel agentId={agent.agentId} />
      <ActionsPanel agent={agent} />
    </>
  );
}

/** Change the platform @handle (globally unique, proxied through the daemon). */
function HandlePanel({ agent }: { agent: NetworkAgent }) {
  const current = agent.handle ?? null;
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  const bare = value.trim().replace(/^@/, '');
  const canSave = !!bare && bare !== (current ?? '').replace(/^@/, '') && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    const r = await api.setNetworkAgentNickname(agent.agentId, bare);
    setBusy(false);
    if (r.ok) {
      setValue('');
      setNote({ ok: true, text: `Handle set to ${r.nickname}.` });
    } else {
      setNote({ ok: false, text: r.reason === 'invalid' ? 'Not a valid handle.' : `@${bare} is taken — pick another.` });
    }
  };

  return (
    <section className="detail-section">
      <div className="detail-row">
        <span className="detail-label">handle</span>
        {current ? <span className="nick-chip">{current}</span> : <span className="agent-enrolled-none">— none yet —</span>}
      </div>
      <div className="link-panel">
        <input
          className="input mono link-panel-select"
          value={value}
          placeholder={current ? 'new handle' : 'e.g. scout'}
          spellCheck={false}
          autoComplete="off"
          aria-label="Agent handle"
          onChange={(e) => {
            setValue(e.target.value);
            setNote(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && canSave && void save()}
        />
        <div className="link-panel-actions">
          <button type="button" className="btn btn-primary" onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : 'Assign'}
          </button>
        </div>
      </div>
      {note && <div className={`notice ${note.ok ? '' : 'link-conflict'}`}>{note.text}</div>}
    </section>
  );
}

/** Edit the bio (the same description shared with contacts). */
function BioPanel({ agent }: { agent: NetworkAgent }) {
  const [value, setValue] = useState(agent.description ?? '');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = value.trim() !== (agent.description ?? '').trim();

  const save = async () => {
    setBusy(true);
    await api.setNetworkAgentSettings(agent.agentId, { bio: value.trim() });
    setBusy(false);
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
        placeholder="What this agent is for — shared with your contacts."
        onChange={(e) => setValue(e.target.value)}
        aria-label={`Bio for ${agent.handle ?? agent.agentId}`}
      />
      <div className="bio-actions">
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={!dirty || busy}>
          {busy ? 'Saving…' : 'Save bio'}
        </button>
      </div>
    </section>
  );
}

/** Connector-only: whether others on the network can discover this connector. */
function VisibilityPanel({ agent }: { agent: NetworkAgent }) {
  const [checked, setChecked] = useState(agent.listed);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!touched) setChecked(agent.listed);
  }, [agent.listed, touched]);

  const toggle = async (v: boolean) => {
    setTouched(true);
    setChecked(v);
    await api.setNetworkAgentSettings(agent.agentId, { listed: v });
  };

  return (
    <section className="detail-section">
      <h2 className="section-title">Network visibility</h2>
      <label className="settings-toggle">
        <input type="checkbox" checked={checked} onChange={(e) => void toggle(e.target.checked)} />
        <span className="settings-toggle-text">
          <strong>Discoverable on the network</strong>
          <span className="settings-toggle-sub">
            Off by default — only you see this connector, though the external AI can still message your agents.
            Turn it on to make its <code>@handle</code> visible to your contacts like an exposed agent.
          </span>
        </span>
      </label>
    </section>
  );
}

/** The connector's curated contact book — what it sees in `list_contacts`. */
function ContactBookPanel({ agentId }: { agentId: string }) {
  const data = useApiData(() => api.networkAgentBook(agentId), [agentId]);
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const book = data?.book ?? [];
  const bookable = data?.bookable ?? [];
  const items: ComboItem[] = bookable
    .map((c) => ({ value: c.handle ?? '', label: c.handle ?? '(unnamed)', description: c.description ?? undefined }))
    .filter((i) => i.value);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2600);
  };
  const add = async (handle: string) => {
    setAdding(false);
    const r = await api.addNetworkAgentContact(agentId, handle);
    flash(r.ok ? `Added ${handle}` : r.error ?? 'Could not add');
  };
  const remove = async (handle: string) => {
    if (handle) await api.removeNetworkAgentContact(agentId, handle);
  };

  return (
    <section className="detail-section">
      <div className="book-head">
        <h2 className="section-title book-title">Contact book</h2>
        {bookable.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
            {adding ? 'Close' : '+ Add contact'}
          </button>
        )}
      </div>
      <p className="book-explainer">
        Curate what this connector sees in <code>list_contacts</code>. With a book set it sees exactly these; empty
        means your reachable agents and contacts. You can only add contacts it can reach.
      </p>

      {adding && (
        <div className="card book-picker">
          {items.length === 0 ? (
            <div className="empty-state book-picker-empty">No more reachable contacts to add.</div>
          ) : (
            <Combobox items={items} onSelect={add} clearOnSelect placeholder="Type a contact's @handle…" ariaLabel="Pick a contact" />
          )}
        </div>
      )}
      {note && <div className="pool-note">{note}</div>}

      {data === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : book.length === 0 ? (
        <div className="empty-state book-empty">No book yet — it sees your reachable contacts by default.</div>
      ) : (
        <div className="contact-list">
          {book.map((c) => (
            <div className="contact-row" key={c.agent_id}>
              <div className="contact-main">
                <span className="contact-nick">{c.handle ?? c.agent_id}</span>
                {c.description && <span className="contact-desc"> — {c.description}</span>}
              </div>
              <div className="contact-meta">
                <PresenceDot state={c.online ? 'online' : 'offline'} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void remove(c.handle ?? '')}>
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

/** Message the agent, or remove it from the network (confirm-gated). */
function ActionsPanel({ agent }: { agent: NetworkAgent }) {
  const navigate = useNavigate();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const remove = async () => {
    if (!confirm) {
      setConfirm(true);
      setTimeout(() => setConfirm(false), 4000);
      return;
    }
    setBusy(true);
    const r = await api.removeNetworkAgent(agent.agentId);
    setBusy(false);
    if (r.ok) navigate('/');
  };

  return (
    <section className="detail-section danger-zone">
      <h2 className="section-title">Actions</h2>
      <div className="bio-actions">
        {agent.handle && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => navigate('/messages', { state: { to: agent.handle } })}
          >
            Message
          </button>
        )}
        <button type="button" className="btn btn-danger-ghost btn-sm" onClick={remove} disabled={busy}>
          {busy ? 'Removing…' : confirm ? 'Click again to remove from the network' : 'Remove from network'}
        </button>
      </div>
      <p className="book-explainer">
        {agent.kind === 'connector'
          ? 'Removing retires this connector entirely — its token, OAuth credentials, and @handle are freed.'
          : 'Removing unexposes this agent from the network.'}
      </p>
    </section>
  );
}
