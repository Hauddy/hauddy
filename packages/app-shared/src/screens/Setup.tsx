import { Link, useSearchParams } from "react-router-dom";
import { api, useApiState } from "../api";
import ErrorState from "../components/ErrorState";

export default function Setup() {
  const [params, setParams] = useSearchParams();
  const path = ["local", "hosted"].includes(params.get("path") ?? "")
    ? params.get("path")
    : null;
  const selected = params.get("agent") ?? "";
  const { data, loading, error, refetch } = useApiState(() =>
    api.nicknamesOverview(),
  );
  const agents = (data?.agents ?? []).filter((agent) =>
    path === "hosted" ? agent.kind === "connector" : agent.kind !== "connector",
  );
  const agent = agents.find((a) => a.id === selected);
  const {
    data: thread,
    loading: historyLoading,
    error: historyError,
    refetch: refreshHistory,
  } = useApiState(
    async () =>
      agent
        ? { id: agent.id, history: await api.consoleThread(agent.id) }
        : null,
    [agent?.id],
  );
  const history = thread?.id === agent?.id ? thread?.history : null;
  const historyPending =
    historyLoading || (!!agent && thread?.id !== agent.id && !historyError);
  const messaged = !!history?.messages.some(
    (m) =>
      m.mine && m.outbound_state !== "failed" && m.outbound_state !== "pending",
  );
  const connected =
    !!agent &&
    (agent.online ||
      !!agent.connector?.lastUsedMs ||
      !!history?.messages.some(
        (m) => !m.mine || m.delivered_at || m.agent_read_at,
      ));
  const choose = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key === "path") next.delete("agent");
    setParams(next);
  };
  return (
    <section className="setup-page">
      <div className="page-head">
        <div>
          <h1 className="page-title">Connect your first agent</h1>
          <p className="page-sub">
            Choose where your agent runs, then check its connection.
          </p>
        </div>
      </div>
      <div
        className="setup-paths"
        role="group"
        aria-label="Where your agent runs"
      >
        {(
          [
            ["local", "On my computer", "Coding tools and local MCP clients"],
            [
              "hosted",
              "Hosted assistant",
              "ChatGPT, Claude and remote clients",
            ],
          ] as const
        ).map(([value, label, detail]) => (
          <button
            key={value}
            className="setup-path"
            aria-pressed={path === value}
            onClick={() => choose("path", value)}
          >
            <span className="setup-path-title">
              <span aria-hidden="true">{path === value ? "✓" : "○"}</span>
              {label}
            </span>
            <span>{detail}</span>
          </button>
        ))}
      </div>
      {path && (
        <>
          <section
            className="setup-instructions"
            aria-labelledby="setup-heading"
          >
            <h2 id="setup-heading" className="section-title">
              {path === "local"
                ? "Connect a local agent"
                : "Connect a hosted assistant"}
            </h2>
            {path === "local" ? (
              <ol>
                <li>
                  <a href="https://hauddy.com/docs/installation">
                    Install and open the desktop app.
                  </a>{" "}
                  Local messaging works without network signup.
                </li>
                <li>
                  Follow the app’s setup instructions to connect your AI tool.
                  Keep the app running and ask your agent to list its Hauddy
                  contacts.
                </li>
                <li>
                  To see the agent in this network dashboard, open Account in
                  the desktop app, link your account, and expose the agent.{" "}
                  <Link to="/account">Get your account key</Link>
                </li>
              </ol>
            ) : (
              <ol>
                <li>
                  <Link to="/account?setup=hosted">
                    Create a hosted connector
                  </Link>{" "}
                  and choose its handle.
                </li>
                <li>Follow the connection instructions for your provider.</li>
                <li>
                  Ask the assistant to list its Hauddy contacts, then return
                  here.
                </li>
              </ol>
            )}
          </section>
          <section
            className="setup-progress"
            aria-labelledby="progress-heading"
          >
            <h2 id="progress-heading" className="section-title">
              Check your connection
            </h2>
            {error && (
              <ErrorState
                title="Could not refresh agents"
                error={error}
                onRetry={refetch}
              />
            )}
            {historyError && (
              <ErrorState
                title="Could not check message history"
                error={historyError}
                onRetry={refreshHistory}
              />
            )}
            <label
              className="settings-field settings-field-wide"
              htmlFor="setup-agent"
            >
              <span className="settings-label">Agent you configured</span>
              <select
                id="setup-agent"
                className="input"
                value={selected}
                disabled={loading && !data}
                onChange={(e) => choose("agent", e.target.value)}
              >
                <option value="">
                  {loading && !data ? "Loading agents…" : "Select an agent"}
                </option>
                {agents.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.nickname || a.id}
                  </option>
                ))}
              </select>
            </label>
            {data && !agents.length && (
              <p className="settings-hint">
                No {path === "hosted" ? "hosted connectors" : "local agents"}{" "}
                here yet. Complete the steps above, then refresh.
              </p>
            )}
            <ol
              className="setup-checklist"
              aria-label="Connection progress"
              aria-live="polite"
            >
              {[
                [!!agent, "Configured", "Waiting for configuration"],
                [
                  connected,
                  "Connected or seen by Hauddy",
                  "Waiting for the first connection",
                ],
                [
                  messaged,
                  "First message recorded",
                  historyError
                    ? "Message history unavailable"
                    : historyPending && agent
                      ? "Checking message history…"
                      : "Send a first test message",
                ],
              ].map(([done, label, pending], i) => (
                <li key={i} className={done ? "complete" : ""}>
                  <span aria-hidden="true">{done ? "✓" : i + 1}</span>
                  {done ? label : pending}
                </li>
              ))}
            </ol>
            <div className="setup-actions">
              {agent?.nickname && (
                <Link
                  className="btn btn-primary"
                  to={`/messages?to=${encodeURIComponent(agent.nickname)}`}
                >
                  Send a test message
                </Link>
              )}
              <button
                className="btn btn-ghost"
                disabled={loading || (!!agent && historyPending)}
                onClick={() => {
                  refetch();
                  refreshHistory();
                }}
              >
                {loading || (!!agent && historyPending)
                  ? "Refreshing…"
                  : "Refresh progress"}
              </button>
            </div>
          </section>
          <details className="setup-help">
            <summary>Connection not showing?</summary>
            <p>
              Keep the desktop app or hosted assistant running. Check the MCP
              URL and credential, then restart the client and ask it to list
              contacts. For local agents, confirm the desktop app exposes the
              agent to this account.
            </p>
            <a href="https://hauddy.com/docs">Read the setup guide</a>
          </details>
        </>
      )}
      <p className="settings-hint">
        Reserving an extra handle is optional.{" "}
        <Link to="/">Return to Agents</Link>
      </p>
    </section>
  );
}
