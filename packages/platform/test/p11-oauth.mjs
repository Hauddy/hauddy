// P11 OAuth — OAuth 2.1 authorization server fronting /mcp (metadata, DCR, PKCE).
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p11-oauth.mjs http://localhost:8787
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import https from "node:https";

const base = process.argv[2] ?? "http://localhost:8787";
const json = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());
const postJson = (p, body, key) =>
  fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(body) }).then((r) => r.json());
// node:http (not fetch) so we can read the 302 Location without following it —
// fetch's redirect:"manual" returns an opaque response with no headers.
function postForm(p, fields) {
  const body = new URLSearchParams(fields).toString();
  const u = new URL(base + p);
  const mod = u.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      { hostname: u.hostname, port: u.port || (u.protocol === "https:" ? 443 : 80), path: u.pathname + u.search, method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", "content-length": Buffer.byteLength(body) } },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode, location: res.headers.location, text: data, json: () => JSON.parse(data || "{}") }));
      },
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}
const rpc = (method, params, key, id = 1) =>
  fetch(base + "/mcp", { method: "POST", headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};
const b64url = (buf) => buf.toString("base64url");
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
const tag = Math.random().toString(36).slice(2, 6);

console.log("P11 OAuth @", base);

// ── discovery ──────────────────────────────────────────────────────────────
const asMeta = await json("/.well-known/oauth-authorization-server");
check(
  "AS metadata: issuer + authorize/token/register endpoints + PKCE S256",
  asMeta.issuer && asMeta.authorization_endpoint.endsWith("/oauth/authorize") && asMeta.token_endpoint.endsWith("/oauth/token") && asMeta.registration_endpoint.endsWith("/oauth/register") && asMeta.code_challenge_methods_supported.includes("S256"),
);
check(
  "AS metadata advertises the client_credentials grant + secret auth methods",
  asMeta.grant_types_supported.includes("client_credentials") && asMeta.token_endpoint_auth_methods_supported.includes("client_secret_basic") && asMeta.token_endpoint_auth_methods_supported.includes("client_secret_post"),
);
const prMeta = await json("/.well-known/oauth-protected-resource");
check("protected-resource metadata: resource=/mcp + authorization_servers", prMeta.resource.endsWith("/mcp") && Array.isArray(prMeta.authorization_servers) && prMeta.authorization_servers.length === 1);

// ── unauthenticated /mcp advertises the resource metadata (401) ──────────────
const unauth = await rpc("tools/list", {});
check("unauthenticated /mcp → 401 with WWW-Authenticate resource_metadata", unauth.status === 401 && /resource_metadata=/.test(unauth.headers.get("www-authenticate") ?? ""));

// ── Dynamic Client Registration ──────────────────────────────────────────────
const reg = await postJson("/oauth/register", { redirect_uris: [REDIRECT], client_name: "Claude" });
check("DCR returns a client_id (public client, auth method none)", typeof reg.client_id === "string" && reg.token_endpoint_auth_method === "none");
const clientId = reg.client_id;

// ── an account to sign in with on the consent page ──────────────────────────
const acct = await postJson("/accounts", { username: `oa${tag}`, email: `oa${tag}@x.test`, password: "pw123456" });
check("signup for the consent login", !!acct.api_key);

// ── PKCE + the authorize params ──────────────────────────────────────────────
const verifier = b64url(randomBytes(32));
const challenge = b64url(createHash("sha256").update(verifier).digest());
const handle = `oagpt${tag}`;
const authParams = {
  response_type: "code",
  client_id: clientId,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: "S256",
  state: "xyz123",
  resource: `${base}/mcp`,
  scope: "send read files",
};

// GET the consent page renders for valid params
const page = await fetch(base + "/oauth/authorize?" + new URLSearchParams(authParams).toString());
const pageHtml = await page.text();
check("GET /oauth/authorize renders the consent page", page.status === 200 && /Authorize Claude/.test(pageHtml) && /name="password"/.test(pageHtml));
check("consent page renders the Hauddy logo (inline svg, not a colour box)", /<svg/.test(pageHtml) && !/class="mark"/.test(pageHtml));
check("consent page exposes an editable @handle field", /name="handle"/.test(pageHtml) && !/name="handle"[^>]*readonly/.test(pageHtml));

// bad redirect_uri is rejected (no code issued)
const badParams = { ...authParams, redirect_uri: "https://evil.example/cb" };
const bad = await fetch(base + "/oauth/authorize?" + new URLSearchParams(badParams).toString());
check("GET /oauth/authorize rejects an unregistered redirect_uri", bad.status === 400);

// ── consent POST: wrong password re-renders with an error, no redirect ──────
const wrongPw = await postForm("/oauth/authorize", { ...authParams, login: `oa${tag}`, password: "nope", handle, scope_send: "on", scope_read: "on", scope_files: "on" });
check("consent with a wrong password re-renders (200, no redirect)", wrongPw.status === 200);

// ── consent POST: valid → 302 back to redirect_uri with code + state ────────
const ok = await postForm("/oauth/authorize", { ...authParams, login: `oa${tag}`, password: "pw123456", handle, scope_send: "on", scope_read: "on", scope_files: "on" });
check("valid consent → 302 redirect to the callback", ok.status === 302);
const loc = new URL(ok.location);
check("redirect carries the state back", loc.searchParams.get("state") === "xyz123");
const code = loc.searchParams.get("code");
check("redirect carries an authorization code", typeof code === "string" && code.startsWith("oac_"));

// ── token exchange: wrong verifier fails ────────────────────────────────────
// (use a fresh code — codes are single-use — via a second authorize)
const ok2 = await postForm("/oauth/authorize", { ...authParams, login: `oa${tag}`, password: "pw123456", handle: `${handle}b`, scope_send: "on" });
const code2 = new URL(ok2.location).searchParams.get("code");
const badTok = (await postForm("/oauth/token", { grant_type: "authorization_code", code: code2, redirect_uri: REDIRECT, client_id: clientId, code_verifier: "wrong-verifier" })).json();
check("token exchange with a bad PKCE verifier → invalid_grant", badTok.error === "invalid_grant");

// ── token exchange: correct verifier → access token (a connector token) ─────
const tok = (await postForm("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })).json();
check("token exchange returns a Bearer access_token", tok.token_type === "Bearer" && typeof tok.access_token === "string");
const AT = tok.access_token;

// ── the OAuth access token works on /mcp as the chosen @handle identity ─────
const who = await (await rpc("tools/call", { name: "whoami", arguments: {} }, AT)).json();
const whoObj = JSON.parse(who.result.content[0].text);
check("the OAuth token calls /mcp as the granted @handle", whoObj.handle === `@${handle}`);
check("the granted scope matches consent (send,read,files)", JSON.stringify(whoObj.scope) === JSON.stringify(["send", "read", "files"]));

// reusing the same code a second time fails (single-use)
const replay = (await postForm("/oauth/token", { grant_type: "authorization_code", code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier })).json();
check("an authorization code cannot be replayed", replay.error === "invalid_grant");

// ── re-onboarding reclaims your OWN stale connector @handle ──────────────────
// A client disconnect (ChatGPT/claude.ai) doesn't revoke server-side, so the
// orphan keeps the @handle. Re-consenting with the same handle must take it
// back (revoking the orphan), not fail with "taken".
const authFor = async (h) => {
  const v = b64url(randomBytes(32));
  const c = b64url(createHash("sha256").update(v).digest());
  const r = await postForm("/oauth/authorize", { ...authParams, code_challenge: c, login: `oa${tag}`, password: "pw123456", handle: h, scope_send: "on", scope_read: "on", scope_files: "on" });
  const cd = r.location ? new URL(r.location).searchParams.get("code") : null;
  const tk = cd ? (await postForm("/oauth/token", { grant_type: "authorization_code", code: cd, redirect_uri: REDIRECT, client_id: clientId, code_verifier: v })).json() : {};
  return { status: r.status, token: tk.access_token };
};
const rH = `reonb${tag}`;
const first = await authFor(rH);
check("first onboard with a fresh handle → 302 + token", first.status === 302 && typeof first.token === "string");
const second = await authFor(rH);
check("re-onboard with the SAME handle succeeds (reclaim, not 'taken')", second.status === 302 && typeof second.token === "string" && second.token !== first.token);
check("the reclaimed connector's OLD token is now dead (401)", (await rpc("tools/call", { name: "whoami", arguments: {} }, first.token)).status === 401);
const secondWho = JSON.parse((await (await rpc("tools/call", { name: "whoami", arguments: {} }, second.token)).json()).result.content[0].text);
check("the new token speaks as the reclaimed @handle", secondWho.handle === `@${rH}`);

// ── headless: dashboard connector → client_credentials grant (no redirect) ──
const cc = await postJson("/accounts/connectors", { handle: `cc${tag}`, scope: ["send", "read", "files"], label: "Headless" }, acct.api_key);
check("dashboard connector mint returns a ct_live_ bearer token", typeof cc.token === "string" && cc.token.startsWith("ct_live_"));
check(
  "dashboard connector mint pairs an OAuth client_id + secret + token endpoint",
  typeof cc.client_id === "string" && cc.client_id.startsWith("oclient_") && typeof cc.client_secret === "string" && cc.client_secret.startsWith("cs_live_") && /\/oauth\/token$/.test(cc.token_endpoint),
);

// grant via form body (client_secret_post)
const ccPost = (await postForm("/oauth/token", { grant_type: "client_credentials", client_id: cc.client_id, client_secret: cc.client_secret })).json();
check("client_credentials (post) → the connector's Bearer token", ccPost.token_type === "Bearer" && ccPost.access_token === cc.token);
check("client_credentials scope echoes the connector scope", ccPost.scope === "send,read,files");

// grant via HTTP Basic (client_secret_basic)
const basic = Buffer.from(`${cc.client_id}:${cc.client_secret}`).toString("base64");
const ccBasic = await fetch(base + "/oauth/token", {
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
  body: new URLSearchParams({ grant_type: "client_credentials" }).toString(),
}).then((r) => r.json());
check("client_credentials (basic auth) → same access_token", ccBasic.access_token === cc.token);

// wrong secret rejected
const ccBad = (await postForm("/oauth/token", { grant_type: "client_credentials", client_id: cc.client_id, client_secret: "cs_live_wrong" })).json();
check("client_credentials with a wrong secret → invalid_client", ccBad.error === "invalid_client");

// the issued token acts as the connector @handle on /mcp
const ccWho = JSON.parse((await (await rpc("tools/call", { name: "whoami", arguments: {} }, ccPost.access_token)).json()).result.content[0].text);
check("client_credentials token calls /mcp as the connector @handle", ccWho.handle === `@cc${tag}`);

// ── rotate: fresh token + secret; the old ones die immediately ──────────────
const rot = await postJson("/accounts/connectors/rotate", { agent_id: cc.agent_id }, acct.api_key);
check("rotate returns a fresh token + secret (same client_id)", rot.ok && rot.token !== cc.token && rot.client_secret !== cc.client_secret && rot.client_id === cc.client_id);
const rotOld = (await postForm("/oauth/token", { grant_type: "client_credentials", client_id: cc.client_id, client_secret: cc.client_secret })).json();
check("the pre-rotate secret no longer authenticates", rotOld.error === "invalid_client");
const rotNew = (await postForm("/oauth/token", { grant_type: "client_credentials", client_id: cc.client_id, client_secret: rot.client_secret })).json();
check("the rotated secret issues the new token", rotNew.access_token === rot.token);

// ── revoke kills the connector + its client_credentials grant entirely ──────
await postJson("/accounts/connectors/revoke", { agent_id: cc.agent_id }, acct.api_key);
const revToken = (await postForm("/oauth/token", { grant_type: "client_credentials", client_id: cc.client_id, client_secret: rot.client_secret })).json();
check("after revoke, client_credentials → invalid_client", revToken.error === "invalid_client");

console.log(`\nP11 OAuth: ${passed} checks passed`);
