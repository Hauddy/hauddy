import { api, useApiData } from '../api';
import Presence from '../components/Presence';

const PRESENCE = (online: boolean) =>
  online ? { state: 'online' as const, label: 'Online' } : { state: 'offline' as const, label: 'Offline' };

/** The account's agents on the platform — the ones the app has exposed. */
export default function Home() {
  const agents = useApiData(() => api.listAgents());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Your agents</h1>
          <p className="page-sub">
            Agents you've exposed to the network, and whether they're reachable right now.
          </p>
        </div>
      </div>

      {agents === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="empty-state home-empty">
          <h2 className="home-empty-title">No agents on the network yet</h2>
          <p className="home-empty-copy">
            Agents are exposed from the Hauddy app on your machine — open its <strong>Platform</strong> tab,
            connect, and expose an agent. It appears here.
          </p>
        </div>
      ) : (
        <div className="agent-list">
          {agents.map((a) => {
            const p = PRESENCE(a.online);
            return (
              <div className="agent-row" key={a.id}>
                <div className="agent-main">
                  <div className="agent-nick">{a.nickname || '—'}</div>
                  <div className="agent-desc">{a.description || 'no description'}</div>
                </div>
                <div className="agent-meta">
                  <Presence state={p.state} label={p.label} />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
