import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, useApiData } from '../api';
import { notifyDesktop, setDockBadge } from '../bridge';

/** Top-bar bell for the local app: polls the daemon's notification counts
 *  (pending contact requests + unread messages + missed calls), shows a badge +
 *  dropdown, and mirrors the total onto the macOS Dock icon. A rising unread/
 *  missed count fires a native OS notification. */
export default function NotificationBell() {
  const n = useApiData(() => api.notifications());
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const friend = n?.friend_requests ?? 0;
  const unread = n?.unread_messages ?? 0;
  const missed = n?.missed_calls ?? 0;
  const total = friend + unread + missed;

  // Mirror the total onto the Dock badge; fire a native notification when the
  // actionable count (unread + missed) rises. `prev` starts undefined so the
  // first successful poll only sets the badge — it never notifies on load.
  const prevRef = useRef<number | null>(null);
  useEffect(() => {
    if (n === undefined) return; // don't touch the badge until we have real data
    setDockBadge(total);
    const actionable = unread + missed;
    const prev = prevRef.current;
    if (prev !== null && actionable > prev) {
      notifyDesktop({
        title: 'Hauddy',
        body:
          unread > 0
            ? `${unread} new message${unread > 1 ? 's' : ''}`
            : `${missed} missed call${missed > 1 ? 's' : ''}`,
      });
    }
    prevRef.current = actionable;
  }, [n, total, unread, missed]);

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

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && missed > 0) void api.notificationsSeen(); // ack missed calls
  };
  const go = (path: string) => {
    setOpen(false);
    navigate(path);
  };

  return (
    <div className="notif" ref={rootRef}>
      <button
        type="button"
        className="notif-trigger"
        aria-label={`Notifications${total ? ` (${total})` : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <BellIcon />
        {total > 0 && <span className="notif-badge">{total > 99 ? '99+' : total}</span>}
      </button>
      {open && (
        <div className="notif-pop" role="menu">
          <div className="notif-head">Notifications</div>
          {total === 0 ? (
            <div className="notif-empty">You’re all caught up.</div>
          ) : (
            <>
              {friend > 0 && (
                <button type="button" className="notif-item" role="menuitem" onClick={() => go('/contacts')}>
                  <span className="notif-count">{friend}</span> contact request{friend > 1 ? 's' : ''}
                </button>
              )}
              {unread > 0 && (
                <button type="button" className="notif-item" role="menuitem" onClick={() => go('/messages')}>
                  <span className="notif-count">{unread}</span> unread message{unread > 1 ? 's' : ''}
                </button>
              )}
              {missed > 0 && (
                <button type="button" className="notif-item" role="menuitem" onClick={() => go('/messages')}>
                  <span className="notif-count">{missed}</span> missed call{missed > 1 ? 's' : ''}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function BellIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}
