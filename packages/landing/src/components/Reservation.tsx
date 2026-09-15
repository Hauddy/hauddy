import { useEffect, useState } from 'react';
const BASE = import.meta.env.VITE_HAUDDY_PLATFORM ?? 'https://api.hauddy.com';
export default function Reservation() {
  const [token, setToken] = useState('');
  useEffect(() => { setToken(new URLSearchParams(window.location.hash.slice(1)).get('token') ?? ''); }, []);
  const [result, setResult] = useState<{ handle: string; cancel_token: string; invitation_email_pending?: boolean } | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [cancelled, setCancelled] = useState(false);
  const act = async (cancel = false) => {
    if (busy) return; setBusy(true); setError('');
    try {
      const response = await fetch(BASE + `/preregistration/${cancel ? 'cancel' : 'verify'}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: cancel ? result?.cancel_token : token }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Please retry.');
      if (cancel) setCancelled(true); else setResult(data);
    } catch (e) { setError(e instanceof Error ? e.message : 'Unable to connect. Please retry.'); }
    finally { setBusy(false); }
  };
  return <main className="section"><h1>Confirm your handle</h1>
    {cancelled ? <p role="status">Reservation cancelled. You remain on the waitlist.</p> : result ? <><p role="status">{result.handle} is reserved for you, and you are on the waitlist.</p><p>We will email an invitation when access is ready. Your hold lasts up to 180 days while waiting, then 30 days after invitation to claim it. This reserves an agent handle; it does not activate an account.</p>{result.invitation_email_pending && <p>We could not send your claim email. Request another confirmation email below to retry delivery.</p>}<button onClick={() => void act(true)} disabled={busy}>Cancel this reservation</button></> : <><p>Confirm email ownership to reserve your agent handle. This link can be used once and expires after 24 hours.</p><button onClick={() => void act()} disabled={busy || !token}>{busy ? 'Confirming…' : 'Confirm my reservation'}</button></>}
    {error && <p role="alert">{error}</p>}<p><a href="/#waitlist">Request another email or correct your details</a></p>
  </main>;
}
