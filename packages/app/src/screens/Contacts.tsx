import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { EnrolledAgent, FriendAccount, LinkedFriend, PlatformInfo, PoolContact } from '../api/types';
import Combobox, { type ComboItem } from '../components/Combobox';
import { IconPlus, IconSend, IconTrash } from '../components/icons';
import { OriginTag, PresenceDot } from '../components/Presence';
import SearchInput from '../components/SearchInput';

/** Contacts = your **friends** (profile↔profile links on the platform) and the
 *  derived **pool** every agent's book is picked from. You reach someone by
 *  knowing their @handle and sending a connect request; they accept (or you turn
 *  on auto-accept). Once linked, all their exposed agents become reachable. */
export default function Contacts() {
  const platform = useApiData(() => api.getPlatform());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Contacts</h1>
          <p className="page-sub">
            Add a <strong>friend</strong> by their <code>@handle</code>; once they accept, all their exposed
            agents can be reached and put in an agent's book.
          </p>
        </div>
      </div>

      {platform?.connected ? <Friends /> : <NotConnected platform={platform} />}

      <Pool />
    </>
  );
}

/** Your pool = the **external** agents your friends have exposed to you. Your own
 *  agents aren't repeated here (they live on the Agents page). Each row can be
 *  messaged, added to one of your agents' books, or unlinked from every book. */
function Pool() {
  const pool = useApiData(() => api.listPool());
  const agents = useApiData(() => api.listAgents());
  const [query, setQuery] = useState('');

  const external = (pool ?? []).filter((c) => c.origin === 'network');
  const q = query.trim().toLowerCase().replace(/^@+/, '');
  const shown = q
    ? external.filter((c) => c.handle.toLowerCase().replace(/^@+/, '').includes(q) || (c.description ?? '').toLowerCase().includes(q))
    : external;

  return (
    <section className="detail-section">
      <h2 className="section-title">Your pool</h2>
      <p className="book-explainer">
        Agents your friends have exposed to you. Message one, or add it to one of your agents' books. Your own
        agents live on the <Link to="/">Agents</Link> page.
      </p>
      {pool === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : external.length === 0 ? (
        <div className="empty-state">
          No external contacts yet — add a friend by <code>@handle</code> above; their exposed agents show up here.
        </div>
      ) : (
        <>
          {external.length > 4 && (
            <SearchInput value={query} onChange={setQuery} placeholder="Search your pool…" ariaLabel="Search your pool" />
          )}
          {shown.length === 0 ? (
            <div className="empty-state book-empty">No pool contacts match “{query}”.</div>
          ) : (
            <div className="contact-list">
              {shown.map((c) => (
                <PoolRow key={c.handle} contact={c} agents={agents ?? []} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function NotConnected({ platform }: { platform: PlatformInfo | undefined }) {
  return (
    <section className="detail-section">
      <div className="empty-state">
        {platform === undefined
          ? 'Loading…'
          : 'Friends live on the platform. '}
        {platform && !platform.connected && (
          <>
            Go to <Link to="/platform">Platform</Link> to connect, then add friends by <code>@handle</code>.
          </>
        )}
      </div>
    </section>
  );
}

function Friends() {
  const friends = useApiData(() => api.listFriends());

  return (
    <section className="detail-section">
      <div className="book-head">
        <h2 className="section-title">Friends</h2>
        {friends && <AutoAccept on={friends.auto_accept} />}
      </div>

      <AddFriend />

      {!friends ? (
        <p className="loading-note">Loading…</p>
      ) : (
        <>
          {friends.incoming.length > 0 && (
            <div className="friend-group">
              <h3 className="friend-group-title">Requests</h3>
              {friends.incoming.map((f) => (
                <IncomingRow key={f.account_id} friend={f} />
              ))}
            </div>
          )}
          <div className="friend-group">
            <h3 className="friend-group-title">Linked</h3>
            {friends.linked.length === 0 ? (
              <div className="empty-state book-empty">No friends yet — add one by @handle above.</div>
            ) : (
              friends.linked.map((f) => <LinkedRow key={f.account_id} friend={f} />)
            )}
          </div>
          {friends.outgoing.length > 0 && (
            <div className="friend-group">
              <h3 className="friend-group-title">Pending (sent)</h3>
              {friends.outgoing.map((f) => (
                <div className="contact-row" key={f.account_id}>
                  <div className="contact-main">
                    <span className="contact-nick">{f.email ?? f.account_id}</span>
                  </div>
                  <span className="pool-auto">awaiting</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function AutoAccept({ on }: { on: boolean }) {
  return (
    <label className="auto-accept" title="Automatically accept every incoming friend request">
      <input type="checkbox" checked={on} onChange={(e) => void api.setAutoAccept(e.target.checked)} /> auto-accept
    </label>
  );
}

function AddFriend() {
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const submit = async () => {
    const handle = value.trim();
    if (!handle) return;
    const res = await api.requestFriend(handle);
    if (res.ok) {
      setValue('');
      setNote(res.state === 'linked' ? 'Linked!' : res.state === 'self' ? "That's you." : 'Request sent.');
    } else {
      setNote(res.error === 'E_UNKNOWN_AGENT' ? 'No one with that @handle.' : res.error);
    }
  };

  return (
    <form
      className="pool-add"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <input
        className="input mono"
        value={value}
        placeholder="@handle to add as a friend"
        spellCheck={false}
        autoComplete="off"
        aria-label="Friend handle"
        onChange={(e) => {
          setValue(e.target.value);
          setNote(null);
        }}
      />
      <button type="submit" className="btn btn-primary" disabled={!value.trim()}>
        Send request
      </button>
      {note && <div className="notice pool-add-error">{note}</div>}
    </form>
  );
}

function IncomingRow({ friend }: { friend: FriendAccount }) {
  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{friend.email ?? friend.account_id}</span>
        <span className="contact-desc"> — wants to connect</span>
      </div>
      <div className="contact-meta">
        <button type="button" className="btn btn-primary btn-sm" onClick={() => void api.respondFriend(friend.account_id, true)}>
          Accept
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.respondFriend(friend.account_id, false)}>
          Decline
        </button>
      </div>
    </div>
  );
}

function LinkedRow({ friend }: { friend: LinkedFriend }) {
  const agents = friend.agents.filter((a) => a.kind !== 'human');
  return (
    <div className="contact-row friend-linked">
      <div className="contact-main">
        <span className="contact-nick">{friend.email ?? friend.account_id}</span>
        <span className="contact-desc">
          {' — '}
          {agents.length === 0 ? 'no exposed agents' : agents.map((a) => a.nickname ?? a.agent_id).join(', ')}
        </span>
      </div>
      <div className="contact-meta">
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void api.respondFriend(friend.account_id, false)} title="Unfriend">
          Remove
        </button>
      </div>
    </div>
  );
}

function PoolRow({ contact, agents }: { contact: PoolContact; agents: EnrolledAgent[] }) {
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const flash = (msg: string) => {
    setNote(msg);
    setTimeout(() => setNote(null), 2600);
  };

  const addTo = async (localId: string) => {
    setAdding(false);
    const res = await api.addContact(localId, contact.handle);
    flash(res.ok ? `Added to ${localId}` : res.error ?? 'Could not add');
  };

  const remove = async () => {
    if (!confirmRemove) {
      setConfirmRemove(true);
      setTimeout(() => setConfirmRemove(false), 3000);
      return;
    }
    const res = await api.removeContactEverywhere(contact.handle);
    flash(res.removed > 0 ? `Unlinked from ${res.removed} book${res.removed === 1 ? '' : 's'}` : 'Was in no books');
    setConfirmRemove(false);
  };

  const items: ComboItem[] = agents.map((a) => ({
    value: a.localId,
    label: a.localId,
    description: a.nicknames[0] ?? undefined,
  }));

  return (
    <div className="contact-row pool-row">
      <div className="contact-main">
        <span className="contact-nick">{contact.handle}</span>
        {contact.description && <span className="contact-desc"> — {contact.description}</span>}
        {note && <div className="pool-note">{note}</div>}
      </div>
      <div className="contact-meta">
        <PresenceDot state={contact.presence} />
        <OriginTag origin={contact.origin} />
        <button
          type="button"
          className="icon-btn"
          title={`Message ${contact.handle}`}
          aria-label={`Message ${contact.handle}`}
          onClick={() => navigate('/messages', { state: { to: contact.handle } })}
        >
          <IconSend size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn${adding ? ' active' : ''}`}
          title="Add to an agent's book"
          aria-label="Add to an agent's book"
          aria-expanded={adding}
          onClick={() => setAdding((v) => !v)}
        >
          <IconPlus size={15} />
        </button>
        <button
          type="button"
          className={`icon-btn${confirmRemove ? ' danger' : ''}`}
          title="Unlink from every agent's book"
          aria-label="Unlink from every agent's book"
          onClick={remove}
        >
          {confirmRemove ? <span className="icon-btn-confirm">Sure?</span> : <IconTrash size={15} />}
        </button>
      </div>
      {adding && (
        <div className="pool-add-book">
          {agents.length === 0 ? (
            <div className="empty-state book-picker-empty">No agents on this machine yet.</div>
          ) : (
            <>
              <span className="pool-add-book-label">
                Add <code>{contact.handle}</code> to which agent's book?
              </span>
              <Combobox
                items={items}
                onSelect={addTo}
                clearOnSelect
                placeholder="Type an agent's name…"
                ariaLabel="Pick an agent"
              />
            </>
          )}
        </div>
      )}
    </div>
  );
}
