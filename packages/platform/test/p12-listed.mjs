// P12 network visibility (`listed`) — runs against a live `wrangler dev`.
// A connector is owner-only by default (listed=0): a friend and the public
// /agents list don't see it, but the owner can toggle it discoverable like an
// exposed agent. Exposed agents stay visible (listed=1). Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p12-listed.mjs http://localhost:8787
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

console.log("P12 network visibility (listed) @", base);

// A: owner with an exposed agent + a connector. B: a friend of A.
const A = await post("/accounts", { username: `a${tag}`, email: `a${tag}@x.test`, password: "pw123456" });
const B = await post("/accounts", { username: `b${tag}`, email: `b${tag}@x.test`, password: "pw123456" });
assert.ok(A.api_key && B.api_key, "signups");

const exposed = (await post("/register", { grant_scope_id: `gs_exp_${tag}`, public_key: pem() }, A.api_key)).agent_id;
await post(`/accounts/agents/${exposed}/nickname`, { nickname: `exp${tag}` }, A.api_key);
const conn = await post("/accounts/connectors", { handle: `conn${tag}`, scope: ["send", "read"], label: "gpt" }, A.api_key);
check("connector minted", !!conn.token);

// A connector's /accounts/me view shows listed=false by default (owner-only).
const meAgents = (await get("/accounts/me", A.api_key)).agents;
const connMe = meAgents.find((a) => a.agent_id === conn.agent_id);
check("connector defaults to listed=false (owner-only)", connMe && connMe.listed === false);
check("owner still sees its own connector in /accounts/me", !!connMe);

// Friendship A<->B (seed both human handles via /accounts/me, then B auto-accepts).
await get("/accounts/me", B.api_key);
await post("/accounts/settings", { auto_accept: true }, B.api_key);
const fr = await post("/accounts/friends/request", { handle: `b${tag}` }, A.api_key);
check("A and B are friends", fr.state === "linked");

const bSeesOfA = async () => {
  const v = await get("/accounts/friends", B.api_key);
  const a = (v.linked || []).find((f) => f.email === `a${tag}@x.test`);
  const handles = (a?.agents || []).map((x) => x.nickname);
  return { hasExposed: handles.includes(`@exp${tag}`), hasConn: handles.includes(`@conn${tag}`) };
};
const publicHandles = async () => (await get("/agents")).agents.map((a) => a.nickname);

let v = await bSeesOfA();
check("friend sees A's exposed agent", v.hasExposed);
check("friend does NOT see A's owner-only connector", !v.hasConn);

let pub = await publicHandles();
check("public /agents excludes the unlisted connector", !pub.includes(`@conn${tag}`));
check("public /agents includes the exposed agent", pub.includes(`@exp${tag}`));

// Owner makes the connector discoverable.
const set = await post(`/accounts/agents/${conn.agent_id}/settings`, { listed: true }, A.api_key);
check("owner toggles connector listed=true", set.ok && set.agent.listed === true);

v = await bSeesOfA();
check("friend now sees the connector", v.hasConn);
pub = await publicHandles();
check("public /agents now includes the connector", pub.includes(`@conn${tag}`));

// A non-owner cannot flip another account's agent visibility.
const steal = await post(`/accounts/agents/${conn.agent_id}/settings`, { listed: false }, B.api_key);
check("a non-owner cannot change visibility", steal.ok !== true);

// Toggling off hides it again (kill-switch style).
await post(`/accounts/agents/${conn.agent_id}/settings`, { listed: false }, A.api_key);
v = await bSeesOfA();
check("friend loses visibility after toggle off", !v.hasConn);
pub = await publicHandles();
check("public /agents drops the connector after toggle off", !pub.includes(`@conn${tag}`));

console.log(`\nP12 listed: ${passed} checks passed ✅`);
