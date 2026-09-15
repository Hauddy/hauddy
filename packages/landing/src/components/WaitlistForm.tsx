import { FormEvent, useEffect, useId, useRef, useState } from 'react';
import { firstSource, trackAction } from '../acquisition';
const BASE = import.meta.env.VITE_HAUDDY_PLATFORM ?? 'https://api.hauddy.com';
type Availability = { available: boolean; reason?: string; suggestions?: string[] };

export default function WaitlistForm({ source = 'hero' }: { source?: string }) {
  const id = useId();
  const [email, setEmail] = useState(''), [handle, setHandle] = useState('');
  const [requestToken, setRequestToken] = useState('');
  const started = useRef(false);
  const [busy, setBusy] = useState(false), [sent, setSent] = useState(false), [error, setError] = useState('');
  const [availability, setAvailability] = useState<Availability | null>(null), [checking, setChecking] = useState(false), [lookupError, setLookupError] = useState(false);
  useEffect(() => {
    let live = true; setAvailability(null); setLookupError(false);
    if (!handle.trim()) { setChecking(false); return; }
    setChecking(true);
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(BASE + '/preregistration/check?handle=' + encodeURIComponent(handle));
        if (!response.ok) throw new Error();
        const data = await response.json();
        if (live) setAvailability(data);
      } catch { if (live) setLookupError(true); }
      finally { if (live) setChecking(false); }
    }, 350);
    return () => { live = false; clearTimeout(timer); };
  }, [handle]);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError('');
    try {
      const campaign = firstSource(source);
      const response = await fetch(BASE + '/preregistration/request', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, handle, source: campaign }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? 'Unable to reserve this handle. Please retry.');
      if (!requestToken) setRequestToken(data.request_token ?? '');
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : 'Connection failed. Please retry.'); }
    finally { setBusy(false); }
  };
  const correctDetails = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(BASE + '/preregistration/cancel', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: requestToken }) });
      if (!response.ok) throw new Error('This request cannot be cancelled here. Use the confirmation email, or wait for the pending hold to expire.');
      setRequestToken(''); setSent(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'Please retry.'); }
    finally { setBusy(false); }
  };
  return <form className="waitlist-form preregistration-form" onSubmit={submit} onFocus={() => {
    if (started.current) return; started.current = true;
    trackAction('form_start');
  }}>
    <label htmlFor={id + '-handle'}>Agent handle</label><input id={id + '-handle'} required maxLength={25} placeholder="@your-agent" value={handle} onChange={e => { setHandle(e.target.value); setSent(false); }} disabled={busy || !!requestToken} autoComplete="off" spellCheck={false} />
    <p role="status">{checking ? 'Checking handle…' : lookupError ? 'Availability could not be checked. You can retry your reservation below.' : availability?.available ? 'Available to request — confirm ownership by email.' : availability?.reason === 'invalid' ? 'Use 2–24 letters, numbers, underscores or hyphens for your handle.' : availability ? 'This handle is unavailable. If you already requested it, use the same email to resend confirmation.' : 'Choose a handle for your agent; your personal username can be different.'}</p>
    {availability?.suggestions?.map(s => <button key={s} type="button" onClick={() => setHandle(s)} disabled={busy || !!requestToken}>{s}</button>)}
    <label htmlFor={id + '-email'}>Email address</label><input id={id + '-email'} type="email" required maxLength={254} placeholder="you@company.com" value={email} onChange={e => { setEmail(e.target.value); setSent(false); }} disabled={busy || !!requestToken} autoComplete="email" />
    <button type="submit" disabled={busy}>{busy ? 'Requesting…' : sent ? 'Resend confirmation email' : 'Reserve my handle & join the waitlist'}</button>
    {sent && <p role="status">Check your email to confirm your reservation. If this email is eligible for the handle, a link will arrive. Check spam or resend. Ownership is not confirmed yet.</p>}
    {requestToken && <button type="button" disabled={busy} onClick={() => void correctDetails()}>Cancel pending request / correct details</button>}
    {error && <p className="waitlist-error" role="alert">{error}</p>}
    {error && requestToken && <button type="button" disabled={busy} onClick={() => { setRequestToken(''); setSent(false); setError(''); }}>Start another request (existing holds keep their expiry)</button>}
    <p className="no-spam">We use your email for confirmation and access invitations. Verify within 24 hours. Confirmed holds last up to 180 days, with 30 days to claim after invitation. One active handle per email. <a href="/privacy">Privacy</a></p>
  </form>;
}
