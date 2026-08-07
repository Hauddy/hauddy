import { useState } from 'react';
import { api, clearKey, revealKey, useApiData } from '../api';

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
            <button type="button" className="btn btn-primary" disabled title="The desktop app isn't published yet">
              Download for Mac — coming soon
            </button>
            <p className="download-note">Desktop apps for Mac, Windows, and Linux are on the way.</p>
          </div>
        </>
      ) : (
        <p className="download-note account-version">version {version}</p>
      )}
    </>
  );
}
