import { useEffect, useRef, useState } from 'react';
import { api, useApiData, useReachable } from '../api';
import type { EnrolledAgent, Presence as PresenceState } from '../api/types';
import { expandApp, quitApp } from '../bridge';
import Logo from '../components/Logo';
import { PresenceDot } from '../components/Presence';
import { APP_VERSION } from '../versionCheck';

/** attached = running now (solid); detached = deliverable with latency (dashed);
 *  enrolled/unlinked = nothing behind it (grey). */
const AGENT_PRESENCE: Record<EnrolledAgent['status'], PresenceState> = {
  attached: 'online',
  detached: 'delay',
  enrolled: 'offline',
};

interface MenuState {
  x: number;
  y: number;
  agent: EnrolledAgent;
}

/** Compact menu-bar surface (340×440 popover): header status, the machine's
 *  agents with a per-agent context menu, footer with expand + quit. */
export default function Compact() {
  const reachable = useReachable();
  const agents = useApiData(() => api.listAgents());
  const platform = useApiData(() => api.getPlatform());
  const up = reachable !== false;
  const outdated = platform?.rejection?.reason === 'client_outdated';

  const [menu, setMenu] = useState<MenuState | null>(null);

  return (
    <div className="compact-shell">
      <header className="compact-head">
        <span className="compact-brand">
          <Logo size={16} />
          Hauddy
        </span>
        <span
          className={`status-pill presence presence-${up ? 'online' : 'offline'}`}
          role="status"
          aria-live="polite"
        >
          {up ? 'Local hub' : 'Hub not running'}
        </span>
      </header>

      {outdated && (
        <div className="compact-outdated">
          <span className="compact-outdated-text">
            ⚠ Update required — v{APP_VERSION} unsupported
          </span>
          <a
            href="https://hauddy.com/download"
            target="_blank"
            rel="noopener noreferrer"
            className="compact-outdated-link"
          >
            Download update
          </a>
        </div>
      )}

      <div className="compact-list" role="list" aria-label="Agents">
        {!up ? (
          <div className="compact-empty">
            <span>The Hauddy app isn't running.</span>
            <span className="compact-empty-hint">Start it with <code>hauddy daemon</code>.</span>
          </div>
        ) : (agents ?? []).length === 0 ? (
          <div className="compact-empty">
            <span>No agents on this machine yet.</span>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => expandApp('/')}>
              Open Hauddy
            </button>
          </div>
        ) : (
          (agents ?? []).map((a) => (
            <div
              className="compact-row"
              role="listitem"
              key={a.localId}
              onContextMenu={(e) => {
                e.preventDefault();
                setMenu({ x: e.clientX, y: e.clientY, agent: a });
              }}
            >
              <PresenceDot state={AGENT_PRESENCE[a.status]} />
              <code className="compact-id">{a.nicknames[0] ?? a.localId}</code>
              <span className="compact-nicks">
                {a.nicknames.length === 0 && (
                  <span className="compact-unlinked">no nickname</span>
                )}
              </span>
              <button
                type="button"
                className="compact-menu-btn"
                aria-label={`Actions for ${a.localId}`}
                aria-haspopup="menu"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.right, y: r.bottom, agent: a });
                }}
              >
                ⋯
              </button>
            </div>
          ))
        )}
      </div>

      <footer className="compact-foot">
        <button type="button" className="btn btn-primary btn-sm compact-open" onClick={() => expandApp('/')}>
          Open Hauddy
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={quitApp}>
          Quit
        </button>
      </footer>

      {menu && <AgentMenu state={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

function AgentMenu({ state, onClose }: { state: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const nick = state.agent.nicknames[0] ?? null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // focus the first item on open (keyboard reachable)
  useEffect(() => {
    ref.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, []);

  // keep the menu inside the 340×440 popover
  const style = {
    left: Math.min(state.x, 340 - 190),
    top: Math.min(state.y, 440 - 160),
  };

  const copyNick = async () => {
    if (!nick) return;
    try {
      await navigator.clipboard.writeText(nick);
      setCopied(true);
      setTimeout(onClose, 500);
    } catch {
      onClose();
    }
  };

  return (
    <div className="compact-menu" role="menu" ref={ref} style={style}>
      <button
        type="button"
        role="menuitem"
        onClick={() => {
          expandApp(`/agents/${encodeURIComponent(state.agent.localId)}`);
          onClose();
        }}
      >
        Open agent…
      </button>
      <div className="compact-menu-divider" role="separator" />
      <button type="button" role="menuitem" disabled={!nick} onClick={copyNick}>
        {copied ? 'Copied ✓' : `Copy ${nick ?? '@nickname'}`}
      </button>
    </div>
  );
}
