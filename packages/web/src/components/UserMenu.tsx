import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { clearKey } from '@hauddy/app-shared';

/** Top-right identity control: a trigger (avatar + email) that opens a small
 *  popover menu — Account & settings, then Sign out. Replaces the old bare
 *  button that signed you out on a single stray click. */
export default function UserMenu({ email, name }: { email?: string; name?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initial = (name ?? email ?? '?').trim().charAt(0).toUpperCase() || '?';

  return (
    <div className="user-menu" ref={rootRef}>
      <button
        type="button"
        className="user-menu-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="user-avatar" aria-hidden>
          {initial}
        </span>
        <span className="user-menu-email">{email ?? '…'}</span>
        <span className={`user-menu-caret${open ? ' up' : ''}`} aria-hidden>
          ▾
        </span>
      </button>
      {open && (
        <div className="user-menu-pop" role="menu">
          <div className="user-menu-head">
            {name && <span className="user-menu-name">{name}</span>}
            <span className="user-menu-sub">{email}</span>
          </div>
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/settings');
            }}
          >
            Settings
          </button>
          <button
            type="button"
            className="user-menu-item"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              navigate('/account');
            }}
          >
            Account &amp; API key
          </button>
          <div className="user-menu-divider" />
          <button
            type="button"
            className="user-menu-item danger"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              clearKey();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
