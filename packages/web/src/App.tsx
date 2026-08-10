import { Navigate, Route, Routes } from 'react-router-dom';
import { Account, AgentPage, Agents, Contacts, FriendProfile, Messages, Settings, useAuthed } from '@hauddy/app-shared';
import Layout from './components/Layout';
import Login from './screens/Login';

export default function App() {
  const authed = useAuthed();

  return (
    <Routes>
      <Route path="/login" element={authed ? <Navigate to="/" replace /> : <Login />} />
      {authed ? (
        <Route element={<Layout />}>
          <Route path="/" element={<Agents />} />
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
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}
