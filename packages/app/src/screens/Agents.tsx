import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { AgentStatus, NetworkAgent, Presence } from '../api/types';
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

const KIND_LABEL: Record<NetworkAgent['kind'], string> = {
  connector: 'Connector',
  agent: 'Exposed elsewhere',
};

/** The landing surface: every agent on this machine, plus the account's agents
 *  that live only on the network (connectors, or agents exposed from another
 *  machine) once the app is connected. Network reach is a per-agent state — a
 *  tag on the row — not a separate app. */
export default function Agents() {
  const agents = useApiData(() => api.listAgents());
  const network = useApiData(() => api.listNetworkAgents());
  const exposure = useApiData(() => api.listExposure());
  const [query, setQuery] = useState('');

  // Which local agents are also published to the platform — so they get an
  // "exposed" tag instead of "local". (localId is the same key in both APIs.)
  const exposedIds = new Set((exposure ?? []).filter((r) => r.exposed).map((r) => r.localId));

  const q = query.trim().toLowerCase().replace(/^@+/, '');
  const localShown = (agents ?? []).filter((a) => {
    if (!q) return true;
    return (
      a.localId.toLowerCase().includes(q) ||
      a.nicknames.some((n) => n.toLowerCase().replace(/^@+/, '').includes(q)) ||
      (a.description ?? '').toLowerCase().includes(q)
    );
  });
  const netShown = (network ?? []).filter((a) => {
    if (!q) return true;
    return (a.handle ?? '').toLowerCase().replace(/^@+/, '').includes(q) || (a.description ?? '').toLowerCase().includes(q);
  });

  const total = (agents?.length ?? 0) + (network?.length ?? 0);
  const shownTotal = localShown.length + netShown.length;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Agents</h1>
          <p className="page-sub">
            Every agent on this machine, plus your connectors and agents on the network. Open a local one to name
            it and manage its contact book.
          </p>
        </div>
      </div>

      {agents === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : total === 0 ? (
        <div className="empty-state">
          No agents yet. Add the Hauddy MCP to a harness and run a tool — it appears here.
        </div>
      ) : (
        <>
          {total > 4 && (
            <SearchInput value={query} onChange={setQuery} placeholder="Search agents…" ariaLabel="Search agents" />
          )}
          {shownTotal === 0 ? (
            <div className="empty-state book-empty">No agents match “{query}”.</div>
          ) : (
            <div className="agent-enrolled-list">
              {localShown.map((agent) => {
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
                        <code>{nick ?? agent.localId}</code>
                      </span>
                      <span className="agent-enrolled-status">{STATUS_LABEL[agent.status]}</span>
                    </div>
                    <div className="agent-enrolled-meta">
                      {!nick && (
                        <span className="agent-enrolled-none">— no nickname yet —</span>
                      )}
                      {exposedIds.has(agent.localId) ? (
                        <span className="origin-tag origin-exposed" title="Published to the network under your account">
                          exposed
                        </span>
                      ) : (
                        <span className="origin-tag origin-local">local</span>
                      )}
                      <span className="agent-row-chevron" aria-hidden="true">
                        ›
                      </span>
                    </div>
                  </Link>
                );
              })}
              {netShown.map((agent) => (
                <NetworkAgentRow key={agent.agentId} agent={agent} />
              ))}
            </div>
          )}
        </>
      )}
    </>
  );
}

/** A platform-only agent (connector / exposed-elsewhere). Links to its detail
 *  page (handle, bio, visibility, contact book, remove) — parity with local
 *  agents, backed by the daemon's platform proxy. */
function NetworkAgentRow({ agent }: { agent: NetworkAgent }) {
  return (
    <Link
      to={`/network/${encodeURIComponent(agent.agentId)}`}
      className="agent-enrolled agent-enrolled-link"
    >
      <div className="agent-enrolled-head">
        <span className="agent-enrolled-id">
          <PresenceDot state={agent.online ? 'online' : 'offline'} />
          <code>{agent.handle ?? 'unnamed'}</code>
        </span>
        <span className="agent-enrolled-status">{KIND_LABEL[agent.kind]}</span>
      </div>
      <div className="agent-enrolled-meta">
        {agent.description ? (
          <span className="agent-enrolled-desc">{agent.description}</span>
        ) : (
          <span className="agent-enrolled-none">
            {agent.kind === 'connector' ? 'external AI / script' : 'no local runtime here'}
          </span>
        )}
        <span className="origin-tag origin-network">network</span>
        {agent.kind === 'connector' && !agent.listed && (
          <span className="origin-tag origin-local" title="Private — only you can see this connector">
            private
          </span>
        )}
        <span className="agent-row-chevron" aria-hidden="true">
          ›
        </span>
      </div>
    </Link>
  );
}
