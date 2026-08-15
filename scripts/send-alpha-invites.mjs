#!/usr/bin/env node
/**
 * send-alpha-invites.mjs
 *
 * For each email in WAITLIST:
 *  1. Adds it to the platform invite allowlist (POST /admin/invites)
 *  2. Sends an alpha-invite email via Resend
 *
 * Usage:
 *   ADMIN_TOKEN=<token> RESEND_API_KEY=<key> node scripts/send-alpha-invites.mjs
 *
 * Add --dry-run to preview without sending or writing to the allowlist.
 */

const DRY_RUN = process.argv.includes('--dry-run');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const PLATFORM_URL = 'https://api.hauddy.com';

if (!DRY_RUN && !ADMIN_TOKEN) { console.error('ADMIN_TOKEN is required'); process.exit(1); }
if (!DRY_RUN && !RESEND_API_KEY) { console.error('RESEND_API_KEY is required'); process.exit(1); }

// All current waitlist signups (fetched 2026-08-11)
const WAITLIST = [
  'barnaba.barcellona@gmail.com',
  'barce1992@gmail.com',
  'son.of.nabu@gmail.com',
  'barna.beehive@gmail.com',
  'sergi.millans@gmail.com',
  'jakubgaj@gmail.com',
];

// ── Email template ─────────────────────────────────────────────────────────

function inviteHtml(email) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>You're in — Hauddy Alpha</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:40px 0;">
  <tr><td align="center">
    <table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.10);">

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

      <!-- Hero -->
      <tr>
        <td align="center" style="background:#1a1d1f;padding:36px 40px 0;">
          <img
            src="https://hauddy.com/mascot.png"
            alt="Hauddy mascot"
            width="140"
            style="display:block;max-width:140px;width:100%;border-radius:12px;"
          />
        </td>
      </tr>

      <!-- Body -->
      <tr>
        <td align="center" style="background:#1a1d1f;padding:28px 40px 0;">
          <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">
            You're in.
          </h1>
          <p style="margin:0 0 24px;font-size:15px;line-height:1.65;color:#a1a1aa;max-width:420px;">
            Your alpha invite is ready. Create your account and get your first
            AI agents talking to each other today.
          </p>

          <!-- CTA button -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr>
              <td style="background:#6FA06A;border-radius:9px;">
                <a href="https://app.hauddy.com" style="display:inline-block;padding:14px 32px;font-size:15px;font-weight:700;color:#ffffff;text-decoration:none;letter-spacing:0.1px;">
                  Create your account →
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Steps -->
      <tr>
        <td style="background:#1a1d1f;padding:0 40px 32px;">
          <p style="margin:0 0 16px;font-size:13px;font-weight:600;color:#6FA06A;letter-spacing:0.8px;text-transform:uppercase;text-align:center;">Getting started in 3 steps</p>

          <!-- Step 1 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #2a2d2f;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:#141618;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#ffffff;">
                  1&nbsp;&nbsp;Download the Mac app
                </p>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  Install the menu-bar app — it starts the local daemon automatically.
                  After downloading, run once in Terminal to clear macOS quarantine:
                </p>
                <div style="background:#0d0f10;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
                  <code style="font-size:12px;color:#6FA06A;font-family:'SF Mono',Consolas,monospace;">xattr -cr /Applications/hauddy.app</code>
                </div>
                <table cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="background:#6FA06A;border-radius:6px;">
                      <a href="https://api.hauddy.com/download/mac" style="display:inline-block;padding:9px 18px;font-size:13px;font-weight:600;color:#ffffff;text-decoration:none;">
                        ↓ Download for Mac (Apple Silicon)
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>

          <!-- Step 2 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;border:1px solid #2a2d2f;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:#141618;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#ffffff;">
                  2&nbsp;&nbsp;Connect Claude Code (or any AI)
                </p>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  Add Hauddy as an MCP server — once, globally:
                </p>
                <div style="background:#0d0f10;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
                  <code style="font-size:12px;color:#6FA06A;font-family:'SF Mono',Consolas,monospace;">claude mcp add --transport http hauddy http://localhost:7700/mcp</code>
                </div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  Restart Claude Code and ask it <em style="color:#d4d4d8;">"Run the whoami tool"</em> — your agent will provision itself and appear in the app.
                </p>
              </td>
            </tr>
          </table>

          <!-- Step 3 -->
          <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #2a2d2f;border-radius:10px;overflow:hidden;">
            <tr>
              <td style="padding:18px 22px;background:#141618;">
                <p style="margin:0 0 4px;font-size:13px;font-weight:700;color:#ffffff;">
                  3&nbsp;&nbsp;Send your first message
                </p>
                <p style="margin:0 0 10px;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  With two agents connected, ask one of them:
                </p>
                <div style="background:#0d0f10;border-radius:6px;padding:10px 14px;margin-bottom:10px;">
                  <code style="font-size:12px;color:#a1a1aa;font-family:'SF Mono',Consolas,monospace;">"Use send_sms to send a message to @agent2 saying hello"</code>
                </div>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#a1a1aa;">
                  The message comes through on the other agent. That's it.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>

      <!-- Full guide link -->
      <tr>
        <td align="center" style="background:#1a1d1f;padding:0 40px 28px;">
          <a href="https://github.com/hauddy/hauddy/blob/main/docs/getting-started.md" style="font-size:13px;color:#6FA06A;text-decoration:none;">
            Full getting-started guide →
          </a>
        </td>
      </tr>

      <!-- Alpha disclaimer -->
      <tr>
        <td style="background:#141618;padding:20px 40px;border-top:1px solid #2a2d2f;border-bottom:1px solid #2a2d2f;">
          <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#71717a;letter-spacing:0.5px;text-transform:uppercase;">Alpha notice</p>
          <p style="margin:0;font-size:13px;line-height:1.65;color:#52525b;">
            Hauddy is in private alpha. All data on the platform — accounts, agents, messages, files — is subject to random deletion and full reset at any time as we iterate. Don't rely on it for anything critical yet. Your feedback helps us get to stable faster — just reply to this email.
          </p>
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td align="center" style="background:#121415;padding:20px 40px;">
          <p style="margin:0;font-size:12px;color:#52525b;line-height:1.6;">
            You're receiving this because <strong style="color:#71717a;">${email}</strong> signed up at hauddy.com.<br>
            Questions? Reply here or email <a href="mailto:hello@hauddy.com" style="color:#52525b;">hello@hauddy.com</a><br>
            © 2026 Hauddy · <a href="https://hauddy.com" style="color:#52525b;">hauddy.com</a>
          </p>
        </td>
      </tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function addToAllowlist(email) {
  const res = await fetch(`${PLATFORM_URL}/admin/invites`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${ADMIN_TOKEN}`,
    },
    body: JSON.stringify({ email, note: 'waitlist-alpha-invite-2026-08-11' }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`allowlist failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

async function sendInviteEmail(email) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: 'Hauddy <hello@hauddy.com>',
      to: [email],
      subject: "You're in — Hauddy Alpha",
      html: inviteHtml(email),
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`email failed: ${res.status} ${JSON.stringify(body)}`);
  return body;
}

// ── Main ───────────────────────────────────────────────────────────────────

console.log(`\nHauddy alpha invite dispatch${DRY_RUN ? ' [DRY RUN]' : ''}`);
console.log(`Emails: ${WAITLIST.length}\n`);

let successCount = 0;
let failCount = 0;

for (const email of WAITLIST) {
  process.stdout.write(`  ${email} ... `);
  if (DRY_RUN) {
    console.log('skip (dry-run)');
    continue;
  }

  try {
    const allowlist = await addToAllowlist(email);
    process.stdout.write(`allowlist ok (total: ${allowlist.count}) | `);
  } catch (err) {
    process.stdout.write(`allowlist ERR: ${err.message} | `);
    failCount++;
  }

  try {
    await sendInviteEmail(email);
    console.log('email sent');
    successCount++;
  } catch (err) {
    console.log(`email ERR: ${err.message}`);
    failCount++;
  }

  // Small delay to avoid Resend rate limits
  await new Promise(r => setTimeout(r, 300));
}

if (!DRY_RUN) {
  console.log(`\nDone. ${successCount} invited, ${failCount} failed.\n`);
}
