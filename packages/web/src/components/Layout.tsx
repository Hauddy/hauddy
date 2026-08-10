import { NavLink, Outlet } from 'react-router-dom';
import { api, Logo, useApiData } from '@hauddy/app-shared';
import UserMenu from './UserMenu';
import NotificationBell from './NotificationBell';

const NAV_ITEMS = [
  { to: '/', label: 'Agents', end: true },
  { to: '/messages', label: 'Messages', end: false },
  { to: '/contacts', label: 'Contacts', end: false },
  { to: '/account', label: 'Account', end: false },
];

export default function Layout() {
  const session = useApiData(() => api.getSession());

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="wordmark">
            <Logo size={20} />
            hauddy
          </NavLink>
          <nav className="topnav" aria-label="Primary">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => (isActive ? 'active' : undefined)}
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="topbar-right">
            <NotificationBell />
            <UserMenu email={session?.email} name={session?.name} />
          </div>
        </div>
      </header>
      <main className="page">
        <Outlet />
      </main>
    </div>
  );
}
