import { useState } from 'react';

/** A labeled read-only credential (client_id, secret, token, endpoint…) with a
 *  one-click copy. Each instance owns its "Copied ✓" state so several can sit
 *  side-by-side. The value chip is `user-select: all`, so copy still works by
 *  hand when the clipboard API is blocked (e.g. non-secure context). */
export default function CopyChip({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — the chip below is select-all */
    }
  };
  return (
    <div className="cred-field">
      <div className="cred-head">
        <span className="cred-label">{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={copy}>
          {copied ? 'Copied ✓' : 'Copy'}
        </button>
      </div>
      <code className="key-chip">{value}</code>
    </div>
  );
}
