import { Navigate, Route, Routes } from 'react-router-dom';
import { Account, Contacts, Home, Messages, Nicknames, useAuthed } from '@hauddy/app-shared';
import Layout from './components/Layout';
import Login from './screens/Login';

export default function App() {
  const authed = useAuthed();

  return (
    <Routes>
      <Route path="/login" element={authed ? <Navigate to="/" replace /> : <Login />} />
      {authed ? (
        <Route element={<Layout />}>
          <Route path="/" element={<Home />} />
          <Route path="/messages" element={<Messages />} />
          <Route path="/nicknames" element={<Nicknames />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/account" element={<Account />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      ) : (
        <Route path="*" element={<Navigate to="/login" replace />} />
      )}
    </Routes>
  );
}
