import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { AgentStatus, Presence } from '../api/types';
import { PresenceDot } from '../components/Presence';
import SearchInput from '../components/SearchInput';

const STATUS_LABEL: Record<AgentStatus, string> = {
  attached: 'Live',
  detached: 'Idle',
  enrolled: 'No nickname',
};

/** attached = a harness session is running it (online); detached = deliverable
 *  with latency; enrolled = no nickname yet (nothing to reach). */
const STATUS_DOT: Record<AgentStatus, Presence> = {
  attached: 'online',
  detached: 'delay',
  enrolled: 'offline',
};

/** The landing surface: every agent on this machine, in one list. Network
 *  reach is a per-agent state (the `local` badge today), not a separate app. */
export default function Agents() {
  const agents = useApiData(() => api.listAgents());
  const [query, setQuery] = useState('');

  const q = query.trim().toLowerCase().replace(/^@+/, '');
  const shown = (agents ?? []).filter((a) => {
    if (!q) return true;
    return (
      a.localId.toLowerCase().includes(q) ||
      a.nicknames.some((n) => n.toLowerCase().replace(/^@+/, '').includes(q)) ||
      (a.description ?? '').toLowerCase().includes(q)
    );
  });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-sub">
            Every agent on this machine. Open one to name it and manage its contact book. No account needed.
          </p>
        </div>
      </div>

      {agents === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="empty-state">
          No agents yet. Add the Hauddy MCP to a harness and run a tool — it appears here.
        </div>
      ) : (
        <>
          {agents.length > 4 && (
            <SearchInput value={query} onChange={setQuery} placeholder="Search agents…" ariaLabel="Search agents" />
          )}
          {shown.length === 0 ? (
            <div className="empty-state book-empty">No agents match “{query}”.</div>
          ) : (
            <div className="agent-enrolled-list">
              {shown.map((agent) => {
            const nick = agent.nicknames[0] ?? null;
            return (
              <Link
                key={agent.localId}
                to={`/agents/${encodeURIComponent(agent.localId)}`}
                className="agent-enrolled agent-enrolled-link"
              >
                <div className="agent-enrolled-head">
                  <span className="agent-enrolled-id">
                    <PresenceDot state={STATUS_DOT[agent.status]} />
                    <code>{agent.localId}</code>
                  </span>
                  <span className="agent-enrolled-status">{STATUS_LABEL[agent.status]}</span>
                </div>
                <div className="agent-enrolled-meta">
                  {nick ? (
                    <span className="nick-chip">{nick}</span>
                  ) : (
                    <span className="agent-enrolled-none">— no nickname yet —</span>
                  )}
                  <span className="origin-tag origin-local">local</span>
                  <span className="agent-row-chevron" aria-hidden="true">
                    ›
                  </span>
                </div>
                  </Link>
                );
              })}
            </div>
          )}
        </>
      )}
    </>
  );
}
