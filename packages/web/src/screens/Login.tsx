import { FormEvent, useState } from 'react';
import { login, signup, Logo } from '@hauddy/app-shared';

/** Identity lives on the platform. Sign in with your username (or email) +
 *  password, or create an account. On success the API key is stored and used as
 *  the Bearer; you copy it into the Hauddy app from the Account screen. */
export default function Login() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [identifier, setIdentifier] = useState(''); // username or email (sign in)
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const result =
      mode === 'signin'
        ? await login({ login: identifier.trim(), password })
        : await signup({ username: username.trim(), email: email.trim(), password });
    setBusy(false);
    if (!result.ok) setError(result.error);
    // on success the auth store flips and the app routes to Home automatically
  };

  return (
    <div className="login-page">
      <div className="card login-card">
        <div className="wordmark login-wordmark">
          <Logo size={20} />
          hauddy
        </div>
        <h1 className="login-title">{mode === 'signin' ? 'Sign in to Hauddy' : 'Create your account'}</h1>
        <form onSubmit={submit} className="login-form">
          {mode === 'signin' ? (
            <>
              <label className="label" htmlFor="login-id">Username or email</label>
              <input
                id="login-id"
                className="input"
                required
                autoComplete="username"
                spellCheck={false}
                placeholder="you or you@email.com"
                value={identifier}
                onChange={(e) => { setIdentifier(e.target.value); setError(null); }}
              />
            </>
          ) : (
            <>
              <label className="label" htmlFor="su-user">Username</label>
              <input
                id="su-user"
                className="input"
                required
                autoComplete="username"
                spellCheck={false}
                placeholder="3–32 chars: a–z 0–9 _ -"
                value={username}
                onChange={(e) => { setUsername(e.target.value); setError(null); }}
              />
              <label className="label" htmlFor="su-email">Email</label>
              <input
                id="su-email"
                className="input"
                type="email"
                required
                autoComplete="email"
                placeholder="you@email.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(null); }}
              />
            </>
          )}
          <label className="label" htmlFor="login-pw">Password</label>
          <input
            id="login-pw"
            className="input"
            type="password"
            required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder={mode === 'signup' ? 'at least 6 characters' : '••••••••'}
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(null); }}
          />
          {error && <div className="notice login-error">{error}</div>}
          <button type="submit" className="btn btn-primary login-continue" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Create account'}
          </button>
        </form>
        <div className="login-divider" role="separator"><span>or</span></div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => {
            setMode((m) => (m === 'signin' ? 'signup' : 'signin'));
            setError(null);
            setPassword('');
          }}
        >
          {mode === 'signin' ? 'Create a new account' : 'I already have an account'}
        </button>
      </div>
    </div>
  );
}
