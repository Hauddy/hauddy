import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useApiData } from '../api';
import type { ExposureRow, PlatformInfo } from '../api/types';
import { PresenceDot } from '../components/Presence';
import { isDesktop, downloadUpdate, installUpdate, onUpdateProgress, onUpdateReady, onUpdateError } from '../bridge';
import { APP_VERSION, fetchVersion, semverLt, useVersionResult } from '../versionCheck';

/** Account: link this machine to your Hauddy account (paste the API key), then
 *  expose chosen agents onto the network under it. Everything here is opt-in —
 *  local messaging works without an account. */
export default function Account() {
  const platform = useApiData(() => api.getPlatform());
  const navigate = useNavigate();
  const [softDismissed, setSoftDismissed] = useState(false);
  const versionResult = useVersionResult();

  useEffect(() => {
    if (platform?.endpoint) fetchVersion(platform.endpoint);
  }, [platform?.endpoint]);

  const softUpdate = versionResult?.latest && semverLt(APP_VERSION, versionResult.latest)
    ? { latest: versionResult.latest }
    : null;
  const proactiveHardBlock = versionResult?.min && semverLt(APP_VERSION, versionResult.min);

  const rejection = platform?.rejection;

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

      {rejection?.reason === 'client_outdated' || proactiveHardBlock ? (
        <OutdatedBanner
          currentVersion={APP_VERSION}
          rejection={rejection ?? {
            reason: 'client_outdated',
            min_version: versionResult?.min ?? undefined,
            latest_version: versionResult?.latest ?? undefined,
          }}
        />
      ) : platform === undefined ? (
        <p className="loading-note">Loading…</p>
      ) : platform.connected ? (
        <>
          {softUpdate && !softDismissed && !isDesktop() && (
            <div className="notice update-soft">
              Hauddy {softUpdate.latest} is available —{' '}
              <a href="https://hauddy.com/download" target="_blank" rel="noopener noreferrer">Download</a>
              <button type="button" className="btn-dismiss" onClick={() => setSoftDismissed(true)}>✕</button>
            </div>
          )}
          <ConnectedCard platform={platform} />
          <Exposure />
        </>
      ) : (
        <ConnectForm />
      )}

      {isDesktop() && (
        <UpdateSection currentVersion={APP_VERSION} latestVersion={softUpdate?.latest ?? null} />
      )}

      <section className="detail-section">
        <h2 className="section-title">Help</h2>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('/onboarding')}>
          View intro again
        </button>
      </section>

      <p className="account-legal">
        <a href="https://hauddy.com/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
      </p>
    </>
  );
}

type UpdateState = 'idle' | 'downloading' | 'ready' | 'error';

function UpdateSection({ currentVersion, latestVersion }: { currentVersion: string; latestVersion: string | null }) {
  const [state, setState] = useState<UpdateState>('idle');
  const [percent, setPercent] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const listenersAttached = useRef(false);

  useEffect(() => {
    if (listenersAttached.current) return;
    listenersAttached.current = true;
    onUpdateProgress(({ percent: p }) => { setPercent(p); setState('downloading'); });
    onUpdateReady(() => setState('ready'));
    onUpdateError(({ message }) => { setError(message); setState('error'); });
  }, []);

  const start = () => {
    setState('downloading');
    setPercent(0);
    setError(null);
    downloadUpdate();
  };

  return (
    <section className="detail-section">
      <h2 className="section-title">Software update</h2>
      <div className="update-version-row">
        <span className="update-version-label">Current version</span>
        <span className="update-version-value">v{currentVersion}</span>
      </div>
      {state === 'idle' && (
        latestVersion ? (
          <div className="update-available-row">
            <span className="update-available-label">v{latestVersion} is available</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={start}>
              Download &amp; install
            </button>
          </div>
        ) : (
          <p className="update-up-to-date">Up to date</p>
        )
      )}
      {state === 'downloading' && (
        <div className="update-progress-wrap">
          <div className="update-progress-bar" style={{ width: `${percent}%` }} />
          <span className="update-progress-label">{percent}%</span>
        </div>
      )}
      {state === 'ready' && (
        <button type="button" className="btn btn-primary btn-sm" onClick={installUpdate}>
          Restart to apply
        </button>
      )}
      {state === 'error' && (
        <div className="notice link-conflict">
          Update failed: {error}
          <button type="button" className="btn btn-ghost btn-sm" style={{ marginLeft: 8 }} onClick={start}>
            Retry
          </button>
        </div>
      )}
    </section>
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

function OutdatedBanner({
  currentVersion,
  rejection,
}: {
  currentVersion: string;
  rejection: NonNullable<PlatformInfo['rejection']>;
}) {
  const downloadUrl = rejection.latest_version
    ? `https://github.com/hauddy/hauddy/releases/tag/v${rejection.latest_version}`
    : 'https://hauddy.com/download';
  return (
    <div className="card conn-card outdated-banner">
      <div className="conn-status">
        <span className="presence presence-delay">Update required</span>
      </div>
      <p className="book-explainer">
        This version of Hauddy ({currentVersion}) is no longer supported.
        {rejection.min_version ? ` Version ${rejection.min_version} or later is required.` : ''}
      </p>
      <a href={downloadUrl} target="_blank" rel="noopener noreferrer" className="btn btn-primary conn-submit">
        Download update
      </a>
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
