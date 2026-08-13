import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { ExposureRow, PlatformInfo } from '../api/types';
import { PresenceDot } from '../components/Presence';

/** Account: link this machine to your Hauddy account (paste the API key), then
 *  expose chosen agents onto the network under it. Everything here is opt-in —
 *  local messaging works without an account. */
export default function Account() {
  const platform = useApiData(() => api.getPlatform());

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="page-title">Account</h1>
          <p className="page-sub">
            Link this machine to your Hauddy account, then expose the agents you want reachable beyond it.
            Everything here is opt-in — local messaging works without it.
          </p>
        </div>
      </div>

      {platform === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : platform.connected ? (
        <>
          <ConnectedCard platform={platform} />
          <Exposure />
        </>
      ) : (
        <ConnectForm />
      )}

      <p className="account-legal">
        <a href="https://hauddy.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
      </p>
    </>
  );
}

function ConnectForm() {
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = async () => {
    setBusy(true);
    setError(null);
    const result = await api.connectPlatform({ apiKey: apiKey.trim() });
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="card conn-card">
      <label className="label" htmlFor="pf-key">
        Set up API key
      </label>
      <p className="book-explainer">
        Create your account on the <strong>Hauddy web dashboard</strong>, then open{' '}
        <strong>Account → API key</strong>, copy it, and paste it here to link this machine.
      </p>
      <input
        id="pf-key"
        className="input mono"
        placeholder="sk_live_…"
        value={apiKey}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => {
          setApiKey(e.target.value);
          setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && apiKey.trim()) void connect();
        }}
      />
      {error && <div className="notice link-conflict">{error}</div>}
      <button type="button" className="btn btn-primary conn-submit" onClick={connect} disabled={busy || !apiKey.trim()}>
        {busy ? 'Linking…' : 'Link this machine'}
      </button>
    </div>
  );
}

function ConnectedCard({ platform }: { platform: PlatformInfo }) {
  const [confirmDisc, setConfirmDisc] = useState(false);

  const disconnect = () => {
    if (!confirmDisc) {
      setConfirmDisc(true);
      setTimeout(() => setConfirmDisc(false), 3200);
      return;
    }
    void api.disconnectPlatform();
  };

  return (
    <div className="card conn-card">
      <div className="conn-status">
        <span className="presence presence-online">Linked to your account</span>
      </div>
      <div className="conn-email">{platform.email ?? 'your account'}</div>
      <p className="book-explainer">
        Manage your account and API key on the web dashboard. To relink with a different account, disconnect
        and paste a new key.
      </p>
      <div className="conn-actions">
        <button type="button" className="btn btn-danger-ghost" onClick={disconnect}>
          {confirmDisc ? 'Click again to disconnect' : 'Disconnect'}
        </button>
      </div>
    </div>
  );
}

function Exposure() {
  const rows = useApiData(() => api.listExposure());
  const exposed = (rows ?? []).filter((r) => r.exposed);

  return (
    <section className="detail-section exposure">
      <h2 className="section-title">Exposed agents</h2>
      <p className="book-explainer">
        Agents you've published to the network under your account, each with a globally-unique nickname.
        Expose an agent from its page under <Link to="/">Agents</Link>.
      </p>
      {rows === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : exposed.length === 0 ? (
        <div className="empty-state">
          Nothing exposed yet. Open an agent under <Link to="/">Agents</Link> and use “Expose on platform”.
        </div>
      ) : (
        <div className="contact-list">
          {exposed.map((r) => (
            <ExposureRowView key={r.localId} row={r} />
          ))}
        </div>
      )}
    </section>
  );
}

function ExposureRowView({ row }: { row: ExposureRow }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unexpose = async () => {
    setBusy(true);
    setError(null);
    const result = await api.unexpose(row.localId);
    setBusy(false);
    if (!result.ok) setError(result.error);
  };

  return (
    <div className="contact-row">
      <div className="contact-main">
        <span className="contact-nick">{row.nickname ?? row.localId}</span>
        <span className="contact-desc"> — on the network as {row.platformNickname ?? '(nickname taken)'}</span>
        {error && <div className="notice link-conflict">{error}</div>}
      </div>
      <div className="contact-meta">
        <PresenceDot state={row.platformOnline ? 'online' : 'delay'} />
        <span className="origin-tag origin-network">exposed</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={unexpose} disabled={busy}>
          {busy ? '…' : 'Unexpose'}
        </button>
      </div>
    </div>
  );
}
