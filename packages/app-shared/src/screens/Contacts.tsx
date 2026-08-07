import { FormEvent, useState } from 'react';
import { api, useApiData } from '../api';
import type { FriendAccount, LinkedFriend } from '../api';

/** Friends are **profile↔profile** (spec §"friends"): send a connect request to
 *  someone's @handle; they accept (or auto-accept). Once linked, all their
 *  exposed agents become reachable — no per-agent dance. */
export default function Contacts() {
  const friends = useApiData(() => api.listFriends());
  const [query, setQuery] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const request = async (e: FormEvent) => {
    e.preventDefault();
    const handle = query.trim();
    if (!handle) return;
    const res = await api.requestFriend(handle);
    if (res.error) setNote(res.error);
    else {
      setNote(res.state === 'linked' ? 'Linked!' : res.state === 'self' ? "That's you." : 'Request sent.');
      setQuery('');
    }
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Friends</h1>
          <p className="page-sub">
            Add a friend by their <code>@handle</code>. Once they accept, every agent they've exposed becomes
            reachable to yours.
          </p>
        </div>
        {friends && (
          <label className="auto-accept" title="Automatically accept incoming friend requests">
            <input type="checkbox" checked={friends.auto_accept} onChange={(e) => void api.setAutoAccept(e.target.checked)} />{' '}
            auto-accept
          </label>
        )}
      </div>

      <form className="check-row" onSubmit={request}>
        <input
          className="input"
          placeholder="@handle to add as a friend"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setNote(null);
          }}
          aria-label="Friend handle"
        />
        <button type="submit" className="btn btn-inverse" disabled={!query.trim()}>
          Send request
        </button>
      </form>
      {note && <div className="notice search-result" aria-live="polite">{note}</div>}

      {friends === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : (
        <>
          {friends.incoming.length > 0 && (
            <section className="pending-section" aria-label="Incoming requests">
              <h2 className="section-title pending-heading">Needs a response</h2>
              {friends.incoming.map((f) => (
                <IncomingRow key={f.account_id} friend={f} />
              ))}
            </section>
          )}

          <h2 className="section-title">Linked</h2>
          {friends.linked.length === 0 ? (
            <div className="empty-state">No friends yet — add one by @handle above.</div>
          ) : (
            <div className="contact-list">
              {friends.linked.map((f) => (
                <LinkedRow key={f.account_id} friend={f} />
              ))}
            </div>
          )}

          {friends.outgoing.length > 0 && (
            <>
              <h2 className="section-title">Pending (sent)</h2>
              {friends.outgoing.map((f) => (
                <div className="contact-row" key={f.account_id}>
                  <div className="contact-main">
                    <span className="contact-nick">{f.email ?? f.account_id}</span>
                  </div>
                  <span className="pending-desc">awaiting</span>
                </div>
              ))}
            </>
          )}
        </>
      )}
    </>
  );
}

function IncomingRow({ friend }: { friend: FriendAccount }) {
  return (
    <div className="pending-card pending-row">
      <div className="pending-text">
        <strong>{friend.email ?? friend.account_id}</strong>
        <span className="pending-desc"> wants to connect</span>
      </div>
      <div className="pending-actions">
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
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{friend.email ?? friend.account_id}</span>
        <span className="contact-desc">
          {' — '}
          {agents.length === 0 ? 'no exposed agents' : agents.map((a) => a.nickname ?? a.agent_id).join(', ')}
        </span>
      </div>
      <div className="contact-meta">
        <button type="button" className="btn btn-ghost btn-sm book-remove" onClick={() => void api.respondFriend(friend.account_id, false)} title="Unfriend">
          Remove
        </button>
      </div>
    </div>
  );
}
