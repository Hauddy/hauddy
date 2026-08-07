/**
 * Cloudflare Pages Function — POST /api/waitlist
 *
 * Stores a waitlist signup in D1 (binding `WAITLIST_DB`). Same-origin with the
 * static landing site, so no CORS. Self-contained types keep this out of the
 * React app's tsconfig/type-check (functions/ is not in `include`).
 *
 * Provision once:
 *   wrangler d1 create hauddy-waitlist            # paste the id into wrangler.toml
 *   wrangler d1 execute hauddy-waitlist --remote --file=./schema.sql
 */

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
}
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface Env {
  WAITLIST_DB: D1Database;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export async function onRequestPost({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> {
  let email = '';
  let source = '';
  try {
    const body = (await request.json()) as { email?: unknown; source?: unknown };
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    source = typeof body.source === 'string' ? body.source.slice(0, 32) : '';
  } catch {
    return json({ ok: false, error: 'bad_request' }, 400);
  }

  if (!EMAIL_RE.test(email) || email.length > 254) {
    return json({ ok: false, error: 'invalid_email' }, 400);
  }

  try {
    await env.WAITLIST_DB.prepare(
      'INSERT INTO waitlist (email, created_at, source) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING',
    )
      .bind(email, new Date().toISOString(), source || null)
      .run();
  } catch {
    return json({ ok: false, error: 'store_failed' }, 500);
  }

  // Same response whether the email is new or already present — don't disclose
  // who's on the list.
  return json({ ok: true });
}
