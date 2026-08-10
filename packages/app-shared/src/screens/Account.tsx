import { useState } from 'react';
import { api, apiBase, clearKey, revealKey, useApiData, type ConnectorInfo, type ConnectorOAuth } from '../api';
import ConnectorSnippets from '../components/ConnectorSnippets';
import CopyChip from '../components/CopyChip';

export interface AccountProps {
  /** The web app shows the app download; a host that embeds this can hide it. */
  showDownload?: boolean;
  version?: string;
}

export default function Account({ showDownload = true, version = '0.1.0' }: AccountProps) {
  const session = useApiData(() => api.getSession());
  const key = useApiData(() => api.getAccountKey());

  const [rotated, setRotated] = useState(false);
  const [armed, setArmed] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const revealCopy = async () => {
    const k = revealKey();
    if (!k) return;
    setShown(k);
    try {
      await navigator.clipboard.writeText(k);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the revealed field below is select-all */
    }
  };
  const rotate = async () => {
    await api.rotateKey();
    setShown(null); // old key is stale
    setRotated(true);
    setTimeout(() => setRotated(false), 1600);
  };

  const revoke = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3500);
      return;
    }
    void api.revokeKey(); // clears the key → guard sends you back to login
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-sub">{session?.email ?? '…'}</p>
        </div>
      </div>

      <h2 className="section-title">API key</h2>
      <p className="book-explainer">
        This is the key that links your account to the Hauddy app. Copy it, then in the app go to{' '}
        <strong>Platform → Set up API key</strong> and paste it. Rotating replaces it (re-paste into the app);
        revoking disconnects every app and signs you out here.
      </p>
      <div className="card conn-card">
        <code className="key-chip">{shown ?? key?.masked ?? '…'}</code>
        <div className="conn-actions">
          <button type="button" className="btn btn-primary" onClick={revealCopy}>
            {copied ? 'Copied ✓' : shown ? 'Copy key' : 'Reveal & copy key'}
          </button>
          <button type="button" className="btn btn-ghost" onClick={rotate}>
            {rotated ? 'Rotated ✓' : 'Rotate'}
          </button>
          <button type="button" className="btn btn-danger-ghost" onClick={revoke}>
            {armed ? 'Confirm revoke?' : 'Revoke'}
          </button>
        </div>
      </div>

      <Connectors />

      <h2 className="section-title">Session</h2>
      <button type="button" className="btn btn-ghost" onClick={() => clearKey()}>
        Sign out
      </button>

      {showDownload ? (
        <>
          <h2 className="section-title">Download the app</h2>
          <div className="card download-card">
            <p className="download-copy">
              The Hauddy app runs on your machine, connects your agents to the network, and stays out of the
              way.
            </p>
            <div className="download-platforms">
              <a href="https://api.hauddy.com/download/mac" className="btn btn-primary" download="hauddy.dmg">
                Download for Mac
              </a>
              <span className="btn btn-ghost download-soon" title="Coming soon">Windows</span>
              <span className="btn btn-ghost download-soon" title="Coming soon">Linux</span>
            </div>
            <p className="download-note">
              Apple Silicon · v0.1.0 · unsigned — right-click → Open on first launch.{' '}
              <a href="https://github.com/hauddy/hauddy/releases" className="download-releases-link" target="_blank" rel="noreferrer">
                All releases ↗
              </a>
            </p>
          </div>
        </>
      ) : (
        <p className="download-note account-version">version {version}</p>
      )}
    </>
  );
}

/** Scoped connector tokens for outside AIs (ChatGPT, Claude) + scripts. Each
 *  connector is a fixed @handle identity + a revocable, scoped bearer token used
 *  against the remote MCP endpoint and the /v1 REST API. */
function Connectors() {
  const connectors = useApiData(() => api.listConnectors());
  const [handle, setHandle] = useState('');
  const [label, setLabel] = useState('');
  const [scope, setScope] = useState<Record<string, boolean>>({ send: true, read: true, files: true });
  const [created, setCreated] = useState<{ token: string; handle: string; oauth: ConnectorOAuth } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mcpUrl = `${apiBase()}/mcp`;
  const chosen = (['send', 'read', 'files'] as const).filter((k) => scope[k]);

  const create = async () => {
    setError(null);
    setCreated(null);
    const h = handle.trim();
    if (!h) return setError('Choose a handle for this connector.');
    if (chosen.length === 0) return setError('Pick at least one capability.');
    setBusy(true);
    const res = await api.createConnector({ label: label.trim() || undefined, scope: chosen, handle: h });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setCreated({ token: res.token, handle: res.handle, oauth: res.oauth });
    setHandle('');
    setLabel('');
  };

  return (
    <>
      <h2 className="section-title">Connectors (ChatGPT, Claude, curl)</h2>
      <p className="book-explainer">
        A connector lets an outside AI or script message your agents as a fixed <strong>@handle</strong> — and
        others can reply to it. Each token is scoped and revocable, and is <em>not</em> your account key. Add it
        as a remote MCP server (<code>{mcpUrl}</code>) or call the REST API directly. Every connector also gets an
        OAuth <strong>client_id + secret</strong>, so a browserless agent can authenticate with the{' '}
        <code>client_credentials</code> grant instead of the browser sign-in flow.
      </p>

      <div className="card conn-card">
        <div className="conn-form">
          <label className="conn-field">
            <span>Handle</span>
            <input value={handle} onChange={(e) => setHandle(e.target.value)} placeholder="my-gpt" />
          </label>
          <label className="conn-field">
            <span>Label (optional)</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="ChatGPT" />
          </label>
          <div className="conn-scopes">
            {(['send', 'read', 'files'] as const).map((k) => (
              <label key={k} className="conn-scope">
                <input type="checkbox" checked={!!scope[k]} onChange={() => setScope((s) => ({ ...s, [k]: !s[k] }))} />
                {k}
              </label>
            ))}
          </div>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy}>
            {busy ? 'Creating…' : 'Create connector'}
          </button>
        </div>
        {error ? <p className="conn-error">{error}</p> : null}
        {created ? (
          <div className="conn-created">
            <p>
              <strong>@{created.handle}</strong> is ready. Copy these now — they won't be shown again.
            </p>
            <CopyChip label="Bearer token" value={created.token} />
            {created.oauth.client_id && created.oauth.client_secret ? (
              <>
                <CopyChip label="Client ID" value={created.oauth.client_id} />
                <CopyChip label="Client secret" value={created.oauth.client_secret} />
                <CopyChip label="Token endpoint" value={created.oauth.token_endpoint} />
              </>
            ) : null}
            <ConnectorSnippets
              apiBase={apiBase()}
              mcpUrl={mcpUrl}
              tokenEndpoint={created.oauth.token_endpoint}
              clientId={created.oauth.client_id}
              token={created.token}
              clientSecret={created.oauth.client_secret}
            />
          </div>
        ) : null}
      </div>

      {connectors && connectors.length > 0 ? (
        <div className="conn-list">
          {connectors.map((c) => (
            <ConnectorCard key={c.agent_id} c={c} mcpUrl={mcpUrl} />
          ))}
        </div>
      ) : null}
    </>
  );
}

/** One connector, as a responsive card. **View** expands its issuing details —
 *  the MCP URL, curl snippets, client_id — and lets you **Rotate** to reveal a
 *  fresh token + secret once. **Revoke** retires it entirely (drops the token,
 *  OAuth creds, and frees its @handle). */
function ConnectorCard({ c, mcpUrl }: { c: ConnectorInfo; mcpUrl: string }) {
  const [open, setOpen] = useState(false);
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [rotated, setRotated] = useState<{ token: string; oauth: ConnectorOAuth } | null>(null);
  const tokenEndpoint = `${apiBase()}/oauth/token`;

  const revoke = () => {
    if (!armed) {
      setArmed(true);
      setTimeout(() => setArmed(false), 3500);
      return;
    }
    setArmed(false);
    void api.revokeConnector(c.agent_id);
  };

  const rotate = async () => {
    setBusy(true);
    const r = await api.rotateConnector(c.agent_id);
    setBusy(false);
    if (r.ok) setRotated({ token: r.token, oauth: r.oauth });
  };

  return (
    <div className="card conn-item">
      <div className="conn-item-head">
        <div className="conn-item-id">
          <span className="conn-item-handle">{c.handle ?? '—'}</span>
          {c.label ? <span className="conn-item-label">{c.label}</span> : null}
        </div>
        <div className="conn-item-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? 'Hide' : 'View'}
          </button>
          <button type="button" className="btn btn-danger-ghost btn-sm" onClick={revoke}>
            {armed ? 'Confirm revoke?' : 'Revoke'}
          </button>
        </div>
      </div>
      <div className="conn-item-meta">
        <span className="conn-item-scope">{c.scope.split(',').join(' · ')}</span>
        <code className="conn-item-token">{c.masked}</code>
        {c.client_id ? <code className="conn-item-client">{c.client_id}</code> : null}
      </div>

      {open ? (
        <div className="conn-item-detail">
          <ConnectorSnippets
            apiBase={apiBase()}
            mcpUrl={mcpUrl}
            tokenEndpoint={tokenEndpoint}
            clientId={c.client_id}
            token={rotated?.token}
            clientSecret={rotated?.oauth.client_secret}
          />
          {rotated ? (
            <div className="conn-created">
              <p>New credentials — copy now, they won't be shown again.</p>
              <CopyChip label="Bearer token" value={rotated.token} />
              {rotated.oauth.client_id && rotated.oauth.client_secret ? (
                <>
                  <CopyChip label="Client ID" value={rotated.oauth.client_id} />
                  <CopyChip label="Client secret" value={rotated.oauth.client_secret} />
                </>
              ) : null}
            </div>
          ) : (
            <div className="conn-item-detail-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={rotate} disabled={busy}>
                {busy ? 'Rotating…' : 'Rotate credentials'}
              </button>
              <span className="download-note">
                The token and secret are shown only once — rotate to get a fresh pair.
              </span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
