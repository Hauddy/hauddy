import { api, useApiData } from '../api';
import { PresenceDot } from '../components/Presence';

/** One power-user page: routing status, the live activity log, and who owns
 *  inbound per nickname. Folds the old Diagnostics + Claims screens. */
export default function Activity() {
  const routing = useApiData(() => api.getRouting());
  const activity = useApiData(() => api.listActivity());
  const claims = useApiData(() => api.listClaims());
  const flash = useApiData(() => api.getFlashClaim());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Activity</h1>
          <p className="page-sub">Local hub routing, the live event log, and inbound ownership.</p>
        </div>
      </div>

      <div className="card diag-card">
        <h2 className="diag-title">Routing</h2>
        {routing === undefined ? (
          <p className="loading-note">Loading…</p>
        ) : (
          <>
            <div className="diag-hub">
              <PresenceDot state={routing.hub} />
              <span>Local hub: {routing.hubLine}</span>
            </div>
            <div className="diag-label">Reachable on this machine</div>
            <div className="diag-list mono">{routing.local.join(', ') || '—'}</div>
          </>
        )}
      </div>

      <div className="card diag-card">
        <h2 className="diag-title">Activity log</h2>
        {activity === undefined ? (
          <p className="loading-note">Loading…</p>
        ) : activity.length === 0 ? (
          <div className="claim-log-line claim-log-empty">nothing yet</div>
        ) : (
          <div className="diag-log" role="table" aria-label="Activity log">
            <div className="diag-log-row diag-log-head" role="row">
              <span role="columnheader">time</span>
              <span role="columnheader">event</span>
              <span role="columnheader">detail</span>
            </div>
            {activity.map((entry, i) => (
              <div className="diag-log-row" role="row" key={`${entry.time}-${i}`}>
                <span role="cell" className="diag-log-time">
                  {entry.time}
                </span>
                <span role="cell">{entry.event}</span>
                <span role="cell" className="diag-log-detail">
                  {entry.detail}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card diag-card">
        <h2 className="diag-title">Who owns inbound</h2>
        <p className="page-sub claim-sub">
          Force-claiming moves a nickname's inbound messages to the session you run it from.
        </p>
        {claims === undefined ? (
          <p className="loading-note">Loading…</p>
        ) : claims.length === 0 ? (
          <div className="claim-log-line claim-log-empty">nothing to resolve</div>
        ) : (
          <div className="table claim-table">
            <div className="table-row table-head claim-grid">
              <span>Nickname</span>
              <span>Claimed by</span>
              <span>Action</span>
            </div>
            {claims.map((row) => (
              <div
                key={row.nickname}
                className={`table-row claim-grid claim-row${flash === row.nickname ? ' claim-flash' : ''}`}
              >
                <span className="claim-nick">{row.nickname}</span>
                {row.claimedBy === null ? (
                  <span className="claim-unclaimed">unclaimed</span>
                ) : (
                  <code className="claim-by">{row.claimedBy}</code>
                )}
                <span className="claim-actions">
                  {row.claimedBy !== null && (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => void api.releaseClaim(row.nickname)}
                    >
                      Release
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={() => void api.forceClaim(row.nickname)}
                  >
                    Force-claim
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
