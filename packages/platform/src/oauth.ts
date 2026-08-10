// OAuth 2.1 authorization-server helpers for the MCP endpoint (RFC 8414 metadata,
// RFC 9728 protected-resource metadata, RFC 7591 DCR, PKCE S256). Pure functions
// only — the HubDO wires these to the DB, DO storage, and request/response plumbing.
//
// The model: an OAuth access token IS a Hauddy connector token (ct_live_…). The
// browser consent flow mints a connector (a fixed @handle identity + scope) and
// hands its token back as the access_token, so resolveAuth + every /v1 and /mcp
// tool already understand it, and the grant shows up (and is revocable) in the
// dashboard's Connectors list.

/** The scopes a connector/OAuth grant may hold (calls excluded by design). */
export const OAUTH_SCOPES = ["send", "read", "files"] as const;

/** RFC 8414 authorization-server metadata. `issuer` MUST equal the origin the
 *  client fetched this from. */
export function authServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    // authorization_code (browser/PKCE consent) + client_credentials (headless:
    // a dashboard-minted connector's client_id + client_secret, no redirect).
    grant_types_supported: ["authorization_code", "client_credentials"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none", "client_secret_basic", "client_secret_post"],
    scopes_supported: [...OAUTH_SCOPES],
  };
}

/** RFC 9728 protected-resource metadata for the /mcp resource. */
export function protectedResourceMetadata(origin: string) {
  return {
    resource: `${origin}/mcp`,
    authorization_servers: [origin],
    scopes_supported: [...OAUTH_SCOPES],
    bearer_methods_supported: ["header"],
  };
}

/** Parse an application/x-www-form-urlencoded body into a plain object. */
export function parseForm(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(text)) out[k] = v;
  return out;
}

/** bytes → base64url (no padding). */
function bytesToB64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** PKCE S256: base64url(SHA-256(verifier)). */
export async function pkceS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return bytesToB64url(new Uint8Array(digest));
}

/** A friendly default @handle suggestion derived from the client name. Just a
 *  prefill — the user can change it, and a global conflict is surfaced on submit. */
export function defaultHandle(clientName?: string | null): string {
  const base = (clientName ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 20);
  return base || "connector";
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The OAuth params we carry through the consent form as hidden inputs. */
export interface ConsentParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  response_type: string;
  resource: string;
  scope: string;
}

const PAGE_CSS = `
:root{--bg:#0f1115;--card:#171a21;--border:#272b35;--text:#e8eaed;--dim:#9aa0ac;--green:#22c55e;--radius:12px}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--text);font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px}
.card{width:100%;max-width:420px;background:var(--card);border:1px solid var(--border);border-radius:16px;padding:28px}
.brand{display:flex;align-items:center;gap:9px;margin-bottom:18px}
.brand svg{width:26px;height:26px;display:block;flex:none}
.brand b{font-size:16px}
h1{font-size:19px;margin:0 0 6px}
p.sub{color:var(--dim);margin:0 0 20px;font-size:14px}
label{display:block;font-size:12px;color:var(--dim);margin:14px 0 5px}
input[type=text],input[type=password]{width:100%;padding:10px 12px;background:#0f1218;border:1px solid var(--border);border-radius:var(--radius);color:var(--text);font-size:14px}
.at{display:flex;align-items:center;gap:0}
.at .pfx{padding:10px 8px 10px 12px;background:#0f1218;border:1px solid var(--border);border-right:0;border-radius:var(--radius) 0 0 var(--radius);color:var(--dim)}
.at input{border-radius:0 var(--radius) var(--radius) 0}
.hint{margin:6px 0 0;color:var(--dim);font-size:12px}
.scopes{display:flex;gap:16px;margin-top:8px}
.scope{display:flex;align-items:center;gap:6px;font-size:14px;color:var(--text);text-transform:capitalize}
button{width:100%;margin-top:22px;padding:12px;background:var(--green);color:#04170b;border:0;border-radius:var(--radius);font-size:15px;font-weight:600;cursor:pointer}
.err{margin:14px 0 0;padding:10px 12px;background:#2a1416;border:1px solid #5b2327;border-radius:var(--radius);color:#ffb4b4;font-size:13px}
.foot{margin-top:16px;color:var(--dim);font-size:12px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
`;

/** The canonical Hauddy mark (two contacts linked by an arc) — kept in sync with
 *  the logo.svg under each package's public dir. Inlined: the consent page needs
 *  no asset fetch. */
const LOGO_SVG = `<svg viewBox="0 0 48 48" role="img" aria-label="Hauddy"><rect width="48" height="48" rx="10" fill="#121415"/><circle cx="10" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/><circle cx="38" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/><path d="M14.2 22 Q24 12 33.8 22" fill="none" stroke="#6FA06A" stroke-width="3.5" stroke-linecap="round"/></svg>`;
const BRAND = `<div class="brand">${LOGO_SVG}<b>Hauddy</b></div>`;

/** The sign-in + consent page. The user authenticates with their Hauddy account
 *  and picks the connector's @handle + scopes to grant the calling client. */
export function consentPageHtml(opts: {
  clientName: string;
  params: ConsentParams;
  error?: string;
  handleDefault?: string;
  login?: string;
}): string {
  const p = opts.params;
  const hidden = (Object.keys(p) as (keyof ConsentParams)[])
    .map((k) => `<input type="hidden" name="${k}" value="${esc(p[k])}">`)
    .join("");
  const scopeBoxes = OAUTH_SCOPES.map(
    (s) => `<label class="scope"><input type="checkbox" name="scope_${s}" checked> ${s}</label>`,
  ).join("");
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Authorize ${esc(opts.clientName)} · Hauddy</title><style>${PAGE_CSS}</style></head>
<body><form class="card" method="post" action="/oauth/authorize">
  ${BRAND}
  <h1>Authorize ${esc(opts.clientName)}</h1>
  <p class="sub">Sign in and give <strong>${esc(opts.clientName)}</strong> an identity on your account. It will message your agents as the @handle below — and they can reply to it.</p>
  ${opts.error ? `<div class="err">${esc(opts.error)}</div>` : ""}
  <label>Username or email</label>
  <input type="text" name="login" autocomplete="username" value="${esc(opts.login ?? "")}" required autofocus>
  <label>Password</label>
  <input type="password" name="password" autocomplete="current-password" required>
  <label>Choose an @handle for this app</label>
  <div class="at"><span class="pfx">@</span><input type="text" name="handle" value="${esc(opts.handleDefault ?? "")}" placeholder="claude" spellcheck="false" autocapitalize="off" autocomplete="off" required></div>
  <p class="hint">This is the identity your agents will see and reply to. Edit it to anything you like — 2–24 chars: a–z, 0–9, _ or -.</p>
  <label>Allow</label>
  <div class="scopes">${scopeBoxes}</div>
  ${hidden}
  <button type="submit">Authorize</button>
  <p class="foot">You can revoke this anytime from Hauddy → Account → Connectors.</p>
</form></body></html>`;
}

/** A standalone error page (client-validation failures that must NOT redirect). */
export function errorPageHtml(message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Hauddy</title><style>${PAGE_CSS}</style></head>
<body><div class="card">${BRAND}<h1>Can't authorize</h1><div class="err">${esc(message)}</div></div></body></html>`;
}
