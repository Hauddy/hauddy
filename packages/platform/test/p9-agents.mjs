// P9 per-agent settings + external links — runs against a live `wrangler dev`.
// Covers owner-scoped agent nickname/bio/open_link, and the "that agent only"
// external-link grant (a non-friend reaches ONLY the open agent). Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p9-agents.mjs http://localhost:8787
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

const tag = Math.random().toString(36).slice(2, 8);
const pem = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
async function account(name) {
  const acct = await post("/accounts", { username: `${name}${tag}`, email: `${name}-${tag}@x.test`, password: "pw123456" });
  assert.ok(acct.api_key, `signup ${name}`);
  return { key: acct.api_key, accountId: acct.account_id };
}
const register = async (acct, gs) => (await post("/register", { grant_scope_id: `gs_${gs}_${tag}`, public_key: pem() }, acct.key)).agent_id;

console.log("P9 per-agent settings + external links @", base);

const A = await account("owner");
const B = await account("stranger");
const aopen = await register(A, "aopen");
const aclosed = await register(A, "aclosed");
const openNick = `aopen${tag}`;
const closedNick = `aclosed${tag}`;

// ── owner-scoped nickname assignment ────────────────────────────────────────
const setOpen = await post(`/accounts/agents/${aopen}/nickname`, { nickname: openNick }, A.key);
check("owner assigns a handle to their agent", setOpen.ok && setOpen.nickname === `@${openNick}`);
await post(`/accounts/agents/${aclosed}/nickname`, { nickname: closedNick }, A.key);
const steal = await post(`/accounts/agents/${aopen}/nickname`, { nickname: `x${tag}` }, B.key);
check("a non-owner cannot rename someone else's agent", steal.ok === false);

// ── owner-scoped bio + open_link ────────────────────────────────────────────
const s1 = await post(`/accounts/agents/${aopen}/settings`, { bio: "the open one", open_link: true }, A.key);
check("owner sets bio + open_link", s1.ok && s1.agent.open_link === true && s1.agent.description === "the open one");
const s2 = await post(`/accounts/agents/${aopen}/settings`, { open_link: false }, B.key);
check("a non-owner cannot change agent settings", s2.ok !== true);
const meA = await get("/accounts/me", A.key);
check("/accounts/me surfaces open_link on the agent", meA.agents.some((a) => a.agent_id === aopen && a.open_link === true));

// ── external request → per-agent grant (B is NOT a friend of A) ─────────────
const link = await post("/accounts/friends/request", { handle: `@${openNick}` }, B.key);
check("a non-friend links to an OPEN agent → per-agent grant", link.state === "linked_agent");
const bFriends = await get("/accounts/friends", B.key);
check("no account friendship was created", bFriends.linked.length === 0);
check("B's linked_agents includes the open agent", (bFriends.linked_agents ?? []).some((a) => a.agent_id === aopen));
const s3 = await post(`/accounts/agents/${aopen}/settings`, {}, A.key);
check("owner sees 1 external connection", s3.agent.external_links === 1);

// ── reachability is AGENT-SCOPED: B reaches @open, NOT @closed ──────────────
const toOpen = await post("/console/sms", { to: `@${openNick}`, body: "hi open" }, B.key);
check("B can message the open agent", toOpen.status === "delivered" || toOpen.status === "queued");
const toClosed = await post("/console/sms", { to: `@${closedNick}`, body: "hi closed" }, B.key);
check("B canNOT message a non-open agent of the same owner", toClosed.error === "E_NOT_LINKED");

// ── kill switch: turning open_link off revokes the grant ────────────────────
await post(`/accounts/agents/${aopen}/settings`, { open_link: false }, A.key);
const toOpen2 = await post("/console/sms", { to: `@${openNick}`, body: "hi again" }, B.key);
check("turning open_link off revokes the grant (now unreachable)", toOpen2.error === "E_NOT_LINKED");
const bFriends2 = await get("/accounts/friends", B.key);
check("B's linked_agents is emptied after revoke", (bFriends2.linked_agents ?? []).every((a) => a.agent_id !== aopen));

// ── assigning a reserved handle consumes the reservation ────────────────────
const resv = `resv${tag}`;
const r1 = await post("/accounts/nicknames/reserve", { name: resv }, A.key);
check("A reserves a handle", r1.ok === true);
const assign = await post(`/accounts/agents/${aclosed}/nickname`, { nickname: resv }, A.key);
check("A assigns its reserved handle to an agent", assign.ok && assign.nickname === `@${resv}`);
const meA2 = await get("/accounts/me", A.key);
check("the reservation is consumed on assign", !(meA2.reservations ?? []).includes(`@${resv}`));

console.log(`\nP9: ${passed} checks passed ✅`);
