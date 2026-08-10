import { NavLink, Outlet } from 'react-router-dom';
import { api, useApiData, useReachable } from '../api';
import { IconActivity, IconAgents, IconContacts, IconMessages, IconPlatform } from './icons';
import Logo from './Logo';
import NotificationBell from './NotificationBell';

const NAV = [
  { to: '/', label: 'Agents', icon: IconAgents, end: true },
  { to: '/messages', label: 'Messages', icon: IconMessages, end: false },
  { to: '/contacts', label: 'Contacts', icon: IconContacts, end: false },
  { to: '/account', label: 'Account', icon: IconPlatform, end: false },
  { to: '/activity', label: 'Activity', icon: IconActivity, end: false },
];

/** The app shell: a single unified surface. The header chip reports the one
 *  honest connection that exists today — the local hub — as a state, not a
 *  separate "network". */
export default function Layout() {
  const reachable = useReachable();
  const platform = useApiData(() => api.getPlatform());
  const up = reachable !== false; // treat "not yet probed" as up to avoid a flash
  const label = reachable === false ? 'Hub not running' : 'Local hub';

  return (
    <div className="app-shell">
      <header className="topbar">
        <span className="wordmark">
          <Logo size={18} />
          Hauddy
        </span>
        <span className="topbar-status">
          {platform?.connected && (
            <span
              className="status-pill presence presence-online"
              role="status"
              title={`Connected to your account ${platform.endpoint ?? ''}`}
            >
              Account
            </span>
          )}
          <span
            className={`status-pill presence presence-${up ? 'online' : 'offline'}`}
            role="status"
            aria-live="polite"
            title={up ? 'The Hauddy app is running on this machine' : 'Start the Hauddy app (hauddy daemon)'}
          >
            {label}
          </span>
          <NotificationBell />
        </span>
      </header>
      <div className="app-body">
        <nav className="rail" aria-label="Primary">
          <div className="rail-section">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `rail-link${isActive ? ' active' : ''}`}
              >
                <item.icon />
                <span>{item.label}</span>
              </NavLink>
            ))}
          </div>
        </nav>
        <main className="page">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
