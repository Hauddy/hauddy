import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Account, AgentPage, Agents, Contacts, FriendProfile, Messages, Settings, Setup, useAuthed } from '@hauddy/app-shared';
import Layout from './components/Layout';
import Login from './screens/Login';
import EmailAction from './screens/EmailAction';

export function safeReturnPath(value: unknown): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\u0000-\u001f]/.test(value)) return '/';
  const url = new URL(value, 'https://return.invalid');
  return url.origin === 'https://return.invalid' && url.pathname !== '/login' ? url.pathname + url.search + url.hash : '/';
}

export default function App() {
  const authed = useAuthed();
  const location = useLocation();

  return (
    <Routes>
      <Route path="/reset-password" element={<EmailAction action="reset" />} />
      <Route path="/claim-handle" element={<EmailAction action="claim" />} />
      <Route path="/login" element={authed ? <Navigate to={safeReturnPath(location.state?.returnTo)} replace /> : <Login />} />
      {authed ? (
        <Route element={<Layout />}>
          <Route path="/" element={<Agents />} />
          <Route path="/setup" element={<Setup />} />
          <Route path="/agents/:agentId" element={<AgentPage />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/contacts/:accountId" element={<FriendProfile />} />
          <Route path="/account" element={<Account />} />
          <Route path="/settings" element={<Settings />} />
          {/* legacy deep-links from the old Nicknames IA */}
          <Route path="/nicknames" element={<Navigate to="/" replace />} />
          <Route path="/nicknames/:agentId" element={<AgentPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" state={{ returnTo: location.pathname + location.search + location.hash }} replace />} />
      )}
    </Routes>
  );
}
