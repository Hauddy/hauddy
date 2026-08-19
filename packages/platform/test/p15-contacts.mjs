// P15 MCP add_contact platform endpoint — runs against a live `wrangler dev`.
// Tests POST /accounts/agents/:agentId/contacts: open_link auto-link, already-
// linked passthrough, pending when target has no open_link.
// Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p15-contacts.mjs http://localhost:8787
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

console.log("P15 MCP add_contact @", base);

// Two accounts: A (the requester) and B (the target)
const A = await post("/accounts", { username: `a${tag}`, email: `a${tag}@x.test`, password: "pw123456" });
const B = await post("/accounts", { username: `b${tag}`, email: `b${tag}@x.test`, password: "pw123456" });
assert.ok(A.api_key && B.api_key, "signups ok");

// A's agent (caller) and B's agent (target with open_link off by default)
const agA = (await post("/register", { grant_scope_id: `gs_a_${tag}`, public_key: pem() }, A.api_key)).agent_id;
const agB = (await post("/register", { grant_scope_id: `gs_b_${tag}`, public_key: pem() }, B.api_key)).agent_id;
await post(`/accounts/agents/${agA}/nickname`, { nickname: `aga${tag}` }, A.api_key);
await post(`/accounts/agents/${agB}/nickname`, { nickname: `agb${tag}` }, B.api_key);

// 1. Target does NOT have open_link → returns pending
let r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@agb${tag}` }, A.api_key);
check("returns pending when target has no open_link", r.ok === true && r.status === "pending");

// 2. Enable open_link on B's agent
await post(`/accounts/agents/${agB}/settings`, { open_link: true }, B.api_key);

// 3. Now add_contact should link immediately
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@agb${tag}` }, A.api_key);
check("returns linked when target has open_link", r.ok === true && r.status === "linked");

// 4. Calling it again on an already-linked pair still returns linked (idempotent)
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@agb${tag}` }, A.api_key);
check("idempotent — already linked returns linked", r.ok === true && r.status === "linked");

// 5. Unknown handle → 404
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@doesnotexist${tag}` }, A.api_key);
check("unknown handle returns 404-ish error", r.ok === false || r.error === "E_UNKNOWN_AGENT");

// 6. Wrong account can't touch another account's agent
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@agb${tag}` }, B.api_key);
check("non-owner can't use another account's agent", r.ok === false || r.error != null);

// 7. Can't add yourself
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@aga${tag}` }, A.api_key);
check("can't add yourself", r.ok === false || r.error != null);

// 8. Same-account agents are already reachable (areLinked = true)
const agA2 = (await post("/register", { grant_scope_id: `gs_a2_${tag}`, public_key: pem() }, A.api_key)).agent_id;
await post(`/accounts/agents/${agA2}/nickname`, { nickname: `aga2${tag}` }, A.api_key);
r = await post(`/accounts/agents/${agA}/contacts`, { handle: `@aga2${tag}` }, A.api_key);
check("same-account agent returns linked immediately", r.ok === true && r.status === "linked");

console.log(`\nP15 contacts: ${passed} checks passed ✅`);
