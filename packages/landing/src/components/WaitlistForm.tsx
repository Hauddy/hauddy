import { FormEvent, useId, useState } from 'react';

type Status = 'idle' | 'loading' | 'done' | 'error';

/** Shared waitlist form (hero + closing). Posts to the /api/waitlist Pages
 *  Function, which stores the email in D1. `source` tags where the signup came
 *  from. */
export default function WaitlistForm({ source = 'hero' }: { source?: string }) {
  const id = useId();
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<Status>('idle');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (status === 'loading') return;
    if (!/\S+@\S+\.\S+/.test(email)) return;
    setStatus('loading');
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source }),
      });
      setStatus(res.ok ? 'done' : 'error');
    } catch {
      setStatus('error');
    }
  };

  if (status === 'done') {
    return (
      <div className="waitlist-done" role="status">
        ✓ You're on the list — we'll email you.
      </div>
    );
  }

  return (
    <form className="waitlist-form" onSubmit={submit}>
      <label className="sr-only" htmlFor={id}>
        Email address
      </label>
      <input
        id={id}
        type="email"
        required
        placeholder="you@company.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={status === 'loading'}
      />
      <button type="submit" disabled={status === 'loading'}>
        {status === 'loading' ? 'Joining…' : 'Join waitlist'}
      </button>
      {status === 'error' && (
        <p className="waitlist-error" role="alert">
          Something went wrong — please try again in a moment.
        </p>
      )}
    </form>
  );
}
