// P1 HTTP control-API integration test — runs against a live `wrangler dev`.
// Exercises the account/register/friends/contacts surface WITHOUT WebSockets
// (WS routing + delivered-SMS assertions land in P3). Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p1-http.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8787";
const post = (p, body, key) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};

// Unique emails/usernames per run so re-runs against the same DO don't 409.
const tag = Math.random().toString(36).slice(2, 8);
const pem = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();

async function profile(name) {
  const acct = await post("/accounts", { username: `${name}${tag}`, email: `${name}-${tag}@x.test`, password: "pw123456" });
  assert.ok(acct.api_key, `signup ${name} returned a key`);
  const gs = `gs_${name}_${tag}`;
  const reg = await post("/register", { grant_scope_id: gs, public_key: pem(), nickname: `${name}${tag}` }, acct.api_key);
  return { key: acct.api_key, accountId: acct.account_id, agentId: reg.agent_id, nickname: `${name}${tag}` };
}

console.log("P1 HTTP control API @", base);

// ── signup + register + me ────────────────────────────────────────────────
const A = await profile("alice");
const B = await profile("bob");
check("signup mints acct_ id", A.accountId.startsWith("acct_"));
check("register mints agt_ id", A.agentId.startsWith("agt_"));
const meA = await get("/accounts/me", A.key);
check("/accounts/me returns the account's agent", meA.agents.some((a) => a.agent_id === A.agentId));
check("agentView carries the bound nickname", meA.agents[0].nickname === `@${A.nickname}`);

// ── login returns the stable key ──────────────────────────────────────────
const loginA = await post("/accounts/login", { login: A.accountId ? `alice${tag}` : "", password: "pw123456" });
check("login returns the same api_key", loginA.api_key === A.key);
const badLogin = await post("/accounts/login", { login: `alice${tag}`, password: "wrong" });
check("wrong password is rejected", badLogin.error && !badLogin.api_key);

// ── friendship: request → pending → accept → linked ───────────────────────
const req = await post("/accounts/friends/request", { handle: `@${B.nickname}` }, A.key);
check("friend request is pending", req.state === "pending");
const bIncoming = await get("/accounts/friends", B.key);
check("B sees one incoming request from A", bIncoming.incoming.length === 1 && bIncoming.incoming[0].account_id === A.accountId);
const resp = await post("/accounts/friends/respond", { account_id: A.accountId, accept: true }, B.key);
check("accept links them", resp.state === "linked");
const aFriends = await get("/accounts/friends", A.key);
check("A's linked friend carries B's agents (allow-all)", aFriends.linked.some((f) => f.agents.some((a) => a.nickname === `@${B.nickname}`)));

// ── contacts reflect the friendship ───────────────────────────────────────
const aContacts = await get(`/contacts/${A.agentId}`);
check("bob is now a contact of alice", aContacts.contacts.some((c) => c.nickname === `@${B.nickname}`));

// ── auto-accept links immediately ─────────────────────────────────────────
const C = await profile("carol");
const D = await profile("dave");
await post("/accounts/settings", { auto_accept: true }, C.key);
const auto = await post("/accounts/friends/request", { handle: `@${C.nickname}` }, D.key);
check("auto-accept links on request", auto.state === "linked");

// ── self request is a no-op ───────────────────────────────────────────────
const self = await post("/accounts/friends/request", { handle: `@${A.nickname}` }, A.key);
check("friend request to self is 'self'", self.state === "self");

// ── decline leaves them unlinked ──────────────────────────────────────────
const E = await profile("erin");
const F = await profile("finn");
await post("/accounts/friends/request", { handle: `@${F.nickname}` }, E.key);
const declined = await post("/accounts/friends/respond", { account_id: E.accountId, accept: false }, F.key);
check("decline → none", declined.state === "none");
check("declined request gone for requester", (await get("/accounts/friends", E.key)).outgoing.length === 0);

// ── rotate + revoke ───────────────────────────────────────────────────────
const rotated = await post("/accounts/rotate", {}, A.key);
check("rotate mints a new key", rotated.api_key && rotated.api_key !== A.key);
check("old key no longer authenticates", (await get("/accounts/me", A.key)).error === "E_AUTH_FAILED");
check("new key authenticates", (await get("/accounts/me", rotated.api_key)).account_id === A.accountId);
await post("/accounts/revoke", {}, rotated.api_key);
check("revoked key is dead", (await get("/accounts/me", rotated.api_key)).error === "E_AUTH_FAILED");

// ── unknown agent handling ────────────────────────────────────────────────
check("friend request to unknown handle → E_UNKNOWN_AGENT", (await post("/accounts/friends/request", { handle: "@nobody-xyz" }, B.key)).error === "E_UNKNOWN_AGENT");

console.log(`\nP1: ${passed} checks passed ✅`);
