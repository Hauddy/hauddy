import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiBase, revealKey, useAuthed } from '@hauddy/app-shared';
import Login from './Login';

export default function EmailAction({ action }: { action: 'reset' | 'claim' }) {
  const authed = useAuthed();
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  const [requested, setRequested] = useState(false);
  const post = async (path: string, body: unknown, auth = false) => {
    const response = await fetch(apiBase() + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${revealKey() ?? ''}` } : {}) }, body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? 'Please retry.');
    return result;
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try {
      if (action === 'claim') { await post('/preregistration/claim', { token }, true); setDone(true); }
      else if (token) {
        if (password !== confirm) throw new Error('Passwords do not match.');
        await post('/accounts/recovery/reset', { token, password }); setDone(true);
      } else { await post('/accounts/recovery/request', { email }); setRequested(true); }
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed. Please retry.'); }
    finally { setBusy(false); }
  };
  if (action === 'claim' && !authed) return <><p className="notice">Sign in or create an account with the invited email, then claim your agent handle. Choose a separate personal username.</p><Login /></>;
  return <main className="login-page"><section className="card login-card">
    <h1>{action === 'claim' ? 'Claim your agent handle' : token ? 'Choose a new password' : 'Recover your account'}</h1>
    {done ? <div role="status">{action === 'claim' ? <>Your handle is ready to attach to an agent. <Link to="/">Open Agents</Link></> : <>Password reset. Your old account key no longer works; sign in and reconnect your apps with the new key. <Link to="/login">Return to sign in</Link></>}</div> : <form className="login-form" onSubmit={submit}>
      {action === 'reset' && !token && <><label htmlFor="recovery-email">Account email</label><input id="recovery-email" type="email" required value={email} disabled={busy} onChange={e => setEmail(e.target.value)} autoComplete="email" />{requested && <p role="status">If an account uses this address, a reset link will arrive. Check spam; if nothing arrives, retry. Links expire after 30 minutes.</p>}</>}
      {action === 'reset' && token && <><label htmlFor="new-password">New password</label><input id="new-password" type="password" autoComplete="new-password" required minLength={6} maxLength={1024} value={password} onChange={e => setPassword(e.target.value)} /><label htmlFor="confirm-password">Confirm password</label><input id="confirm-password" type="password" autoComplete="new-password" required value={confirm} onChange={e => setConfirm(e.target.value)} /></>}
      {error && <p role="alert">{error}</p>}
      <button className="btn btn-primary" disabled={busy || (action === 'claim' && !token)}>{busy ? 'Please wait…' : action === 'claim' ? 'Claim handle' : token ? 'Reset password' : requested ? 'Resend reset email' : 'Email me a reset link'}</button>
      {token && action === 'reset' && <a href="/reset-password">Request a fresh reset link</a>}
      {action === 'claim' && !token && <p>Open the claim link in your invitation email.</p>}
    </form>}
    <Link to="/login">Sign in</Link>
  </section></main>;
}
