import { Link, useSearchParams } from 'react-router-dom';
import { api, useApiState } from '../api';
import ErrorState from '../components/ErrorState';

export default function Setup() {
  const [params, setParams] = useSearchParams();
  const path = params.get('path');
  const selected = params.get('agent') ?? '';
  const { data, error, refetch } = useApiState(() => api.nicknamesOverview());
  const agents = (data?.agents ?? []).filter(agent => path === 'hosted' ? agent.kind === 'connector' : agent.kind !== 'connector');
  const agent = agents.find(a => a.id === selected);
  const { data: thread, error: historyError, refetch: refreshHistory } = useApiState(async () => agent ? { id: agent.id, history: await api.consoleThread(agent.id) } : null, [agent?.id]);
  const history = thread?.id === agent?.id ? thread?.history : null;
  const messaged = !!history?.messages.some(m => m.mine && m.outbound_state !== 'failed' && m.outbound_state !== 'pending');
  const connected = !!agent && (agent.online || !!agent.connector?.lastUsedMs || !!history?.messages.some(m => !m.mine || m.delivered_at || m.agent_read_at));
  const choose = (key: string, value: string) => { const next = new URLSearchParams(params); next.set(key, value); if (key === 'path') next.delete('agent'); setParams(next); };
  return <section className="settings-section">
    <h1>Connect your first agent</h1>
    <p>Choose where your agent runs. You can return to this page to check progress at any time.</p>
    <div className="conn-actions"><button className="btn" aria-pressed={path === 'local'} onClick={() => choose('path', 'local')}>On my computer</button><button className="btn" aria-pressed={path === 'hosted'} onClick={() => choose('path', 'hosted')}>Hosted assistant</button></div>
    {path === 'local' ? <><h2>Connect a local agent</h2><ol><li><a href="https://github.com/Hauddy/hauddy/releases/latest">Install and open the desktop app.</a> Local messaging works without network signup.</li><li>Follow the app’s setup instructions to connect your AI harness. Keep the app running and ask your agent to list its Hauddy contacts.</li><li>For this network dashboard, open Account in the desktop app, link your account, and expose the agent. <Link to="/account">Get your account key</Link></li></ol></> : path === 'hosted' ? <><h2>Connect a hosted assistant</h2><ol><li><Link to="/account?setup=hosted">Create a hosted connector</Link> and choose its handle.</li><li>Use the setup instructions for your provider. Credentials are shown where you need them.</li><li>Ask the assistant to list its Hauddy contacts, then return here.</li></ol></> : null}
    {path && <>
      {error && <ErrorState error={error} onRetry={refetch} />}
      {historyError && <ErrorState error={historyError} onRetry={refreshHistory} />}
      <label htmlFor="setup-agent">Choose the agent you configured</label><select id="setup-agent" className="input" value={selected} onChange={e => choose('agent', e.target.value)}><option value="">Select an agent</option>{agents.map(a => <option key={a.id} value={a.id}>{a.nickname || a.id}</option>)}</select>
      <ol aria-label="Connection progress"><li>{agent ? '✓ Configured' : 'Waiting for configuration'}</li><li>{connected ? '✓ Connected or seen by Hauddy' : 'Waiting for the first connection'}</li><li>{messaged ? '✓ First message recorded' : 'Send a first test message'}</li></ol>
      {agent?.nickname && <Link className="btn btn-primary" to={`/messages?to=${encodeURIComponent(agent.nickname)}`}>Send a test message</Link>}
      <button className="btn" onClick={() => { refetch(); refreshHistory(); }}>Refresh progress</button>
      <details><summary>Connection not showing?</summary><p>Keep the desktop app or hosted assistant running. Check that the MCP server URL and credential match your setup. Restart the harness after changing its configuration and ask it to list contacts. For local agents, confirm that the desktop app exposes the agent to this account.</p></details>
    </>}
    <p>Reserving an extra handle is optional. <Link to="/">Return to Agents</Link></p>
  </section>;
}
