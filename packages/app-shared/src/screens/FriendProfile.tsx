import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, friendHuman, useApiData } from '../api';
import { PresenceDot } from '../components/Presence';

/** A friend's profile: their @handle + bio, and every agent they've exposed
 *  (each reachable — "Message" opens a thread). Reached from the Friends list;
 *  data comes from the same listFriends() call, so no extra endpoint. */
export default function FriendProfile() {
  const { accountId = '' } = useParams();
  const navigate = useNavigate();
  const friends = useApiData(() => api.listFriends());

  if (friends === undefined) return <p className="loading-note">Loading…</p>;

  const friend = friends.linked.find((f) => f.account_id === accountId);
  if (!friend) {
    return (
      <>
        <div className="page-head">
          <div>
            <Link className="back-link" to="/contacts">
              ← Friends
            </Link>
            <h1 className="page-title">Friend</h1>
            <p className="page-sub">Not found — they may have unfriended you.</p>
          </div>
        </div>
      </>
    );
  }

  const human = friendHuman(friend);
  const handle = human?.nickname ?? null;
  const bio = human?.description?.trim();
  const exposed = friend.agents.filter((a) => a.kind !== 'human');

  return (
    <>
      <div className="page-head">
        <div>
          <Link className="back-link" to="/contacts">
            ← Friends
          </Link>
          <h1 className="page-title">{friend.email ?? friend.account_id}</h1>
          <p className="page-sub">{handle ?? 'no handle yet'}</p>
        </div>
      </div>

      <p className={`friend-bio${bio ? '' : ' empty'}`}>{bio || 'No bio yet.'}</p>

      <h2 className="section-title">Exposed agents</h2>
      {exposed.length === 0 ? (
        <div className="empty-state">No agents exposed yet.</div>
      ) : (
        <div className="contact-list">
          {exposed.map((a) => (
            <div className="contact-row" key={a.agent_id}>
              <div className="contact-main">
                <span className="contact-nick">
                  <PresenceDot state={a.attached ? 'online' : 'offline'} /> {a.nickname ?? a.agent_id}
                </span>
                {a.description && <span className="contact-desc"> — {a.description}</span>}
              </div>
              <div className="contact-meta">
                {a.nickname && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => navigate(`/messages?to=${encodeURIComponent(a.nickname as string)}`)}
                  >
                    Message
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
