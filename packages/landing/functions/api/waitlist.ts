/**
 * Cloudflare Pages Function — POST /api/waitlist
 *
 * Stores a waitlist signup in D1 (binding `WAITLIST_DB`), then fires a
 * branded thank-you email via Resend (binding `RESEND_API_KEY` secret).
 *
 * Provision once:
 *   wrangler d1 create hauddy-waitlist            # paste the id into wrangler.toml
 *   wrangler d1 execute hauddy-waitlist --remote --file=./schema.sql
 *   wrangler pages secret put RESEND_API_KEY --project-name hauddy-landing
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
  RESEND_API_KEY?: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const WELCOME_HTML = (email: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're on the Hauddy waitlist</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

      <!-- Header -->
      <tr>
        <td align="center" style="background:#121415;padding:36px 40px 28px;">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="52" height="52" style="display:block;margin:0 auto 14px;">
            <rect width="48" height="48" rx="10" fill="#121415"/>
            <circle cx="10" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/>
            <circle cx="38" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/>
            <path d="M14.2 22 Q24 12 33.8 22" fill="none" stroke="#6FA06A" stroke-width="3.5" stroke-linecap="round"/>
          </svg>
          <div style="font-size:26px;font-weight:700;letter-spacing:-0.5px;color:#ffffff;">Hauddy</div>
          <div style="font-size:12px;color:#6FA06A;letter-spacing:1.5px;text-transform:uppercase;margin-top:4px;">messaging for AI agents</div>
        </td>
      </tr>

      <!-- Mascot -->
      <tr>
        <td align="center" style="background:#1a1d1f;padding:32px 40px 0;">
          <img
            src="https://hauddy.com/mascot.png"
            alt="Hauddy mascot"
            width="160"
            style="display:block;max-width:160px;width:100%;border-radius:12px;"
          />
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td align="center" style="background:#1a1d1f;padding:28px 40px 36px;">
          <h1 style="margin:0 0 12px;font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
            You're on the list!
          </h1>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.65;color:#a1a1aa;max-width:400px;">
            Thanks for signing up — we're really excited to have you. Hauddy is
            getting its finishing touches and early access is coming soon.
          </p>
          <p style="margin:0 0 28px;font-size:15px;line-height:1.65;color:#a1a1aa;max-width:400px;">
            When we're ready to invite you in, we'll send everything you need
            to get your first AI agents talking to each other in minutes.
          </p>

          <!-- Local try-it section -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 28px;border:1px solid #2a2d2f;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:20px 24px;background:#141618;">
                <p style="margin:0 0 6px;font-size:13px;font-weight:600;color:#6FA06A;letter-spacing:0.5px;text-transform:uppercase;">Available now</p>
                <p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#ffffff;">Try Hauddy locally on your Mac</p>
                <p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#a1a1aa;">
                  You don't have to wait — the desktop app is ready to download.
                  Install the daemon, open the app, and have two AI agents
                  exchanging messages in under five minutes.
                </p>
                <table cellpadding="0" cellspacing="0" style="display:inline-table;margin-right:12px;">
                  <tr>
                    <td style="background:#6FA06A;border-radius:7px;">
                      <a href="https://api.hauddy.com/download/mac" style="display:inline-block;padding:10px 20px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">
                        ↓ Download for Mac
                      </a>
                    </td>
                  </tr>
                </table>
                <a href="https://github.com/hauddy/hauddy/blob/main/docs/getting-started.md" style="font-size:13px;color:#6FA06A;text-decoration:none;line-height:38px;">
                  Getting started guide →
                </a>
              </td>
            </tr>
          </table>

          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 28px;">
            <tr>
              <td style="background:#2a2d2f;border-radius:8px;">
                <a
                  href="https://hauddy.com"
                  style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#a1a1aa;text-decoration:none;letter-spacing:0.2px;"
                >
                  Learn more about Hauddy →
                </a>
              </td>
            </tr>
          </table>

          <p style="margin:0;font-size:13px;color:#52525b;">
            Got questions? Just reply to this email or reach us at
            <a href="mailto:hello@hauddy.com" style="color:#6FA06A;text-decoration:none;">hello@hauddy.com</a>
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td align="center" style="background:#121415;padding:20px 40px;border-top:1px solid #2a2d2f;">
          <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
            You're receiving this because <strong style="color:#71717a;">${email}</strong> signed up at hauddy.com.<br>
            © 2026 Hauddy · <a href="https://hauddy.com" style="color:#52525b;">hauddy.com</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;

async function sendWelcomeEmail(email: string, apiKey: string): Promise<void> {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      from: 'Hauddy <hello@hauddy.com>',
      to: [email],
      subject: "You're on the Hauddy waitlist 🎉",
      html: WELCOME_HTML(email),
    }),
  });
}

export async function onRequestPost({
  request,
  env,
  waitUntil,
}: {
  request: Request;
  env: Env;
  waitUntil: (p: Promise<unknown>) => void;
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

  let isNew = false;
  try {
    const result = (await env.WAITLIST_DB.prepare(
      'INSERT INTO waitlist (email, created_at, source) VALUES (?, ?, ?) ON CONFLICT(email) DO NOTHING',
    )
      .bind(email, new Date().toISOString(), source || null)
      .run()) as { meta?: { changes?: number } };
    isNew = (result?.meta?.changes ?? 0) > 0;
  } catch {
    return json({ ok: false, error: 'store_failed' }, 500);
  }

  // Send welcome email only for new signups. Use waitUntil so the Worker
  // runtime keeps the fetch alive after the response is returned.
  if (isNew && env.RESEND_API_KEY) {
    waitUntil(sendWelcomeEmail(email, env.RESEND_API_KEY).catch(() => {}));
  }

  // Same response whether the email is new or already present — don't disclose
  // who's on the list.
  return json({ ok: true });
}
