// P13 per-agent contact book — runs against a live `wrangler dev`.
// A connector's book curates its list_contacts (/v1/contacts): a non-empty book
// IS the list; empty falls back to the derived same-account+friends set. You can
// only book contacts the agent can reach. Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p13-book.mjs http://localhost:8787
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

console.log("P13 contact book @", base);

const A = await post("/accounts", { username: `a${tag}`, email: `a${tag}@x.test`, password: "pw123456" });
const B = await post("/accounts", { username: `b${tag}`, email: `b${tag}@x.test`, password: "pw123456" });
assert.ok(A.api_key && B.api_key, "signups");

// A's two same-account agents (reachable by A's connector) + B's stranger.
const exp1 = (await post("/register", { grant_scope_id: `gs_e1_${tag}`, public_key: pem() }, A.api_key)).agent_id;
const exp2 = (await post("/register", { grant_scope_id: `gs_e2_${tag}`, public_key: pem() }, A.api_key)).agent_id;
await post(`/accounts/agents/${exp1}/nickname`, { nickname: `exp1${tag}` }, A.api_key);
await post(`/accounts/agents/${exp2}/nickname`, { nickname: `exp2${tag}` }, A.api_key);
const strange = (await post("/register", { grant_scope_id: `gs_s_${tag}`, public_key: pem() }, B.api_key)).agent_id;
await post(`/accounts/agents/${strange}/nickname`, { nickname: `strange${tag}` }, B.api_key);

const conn = await post("/accounts/connectors", { handle: `conn${tag}`, scope: ["send", "read"], label: "gpt" }, A.api_key);
check("connector minted", !!conn.token);

// What the connector sees in list_contacts (bare handles).
const seen = async () => (await get("/v1/contacts", conn.token)).contacts.map((c) => c.handle);

let v = await seen();
check("empty book ⇒ derived contacts (sees both same-account agents)", v.includes(`@exp1${tag}`) && v.includes(`@exp2${tag}`));

// Owner inspects the book: empty, with both agents bookable.
let bk = await get(`/accounts/agents/${conn.agent_id}/book`, A.api_key);
check("book starts empty", bk.book.length === 0);
check("bookable lists reachable same-account agents", bk.bookable.some((c) => c.handle === `@exp1${tag}`));

// Book exactly one.
const add = await post(`/accounts/agents/${conn.agent_id}/book`, { handle: `@exp1${tag}` }, A.api_key);
check("owner adds a reachable contact to the book", add.ok === true);

v = await seen();
check("non-empty book OVERRIDES derived (sees exp1 only, NOT exp2)", v.includes(`@exp1${tag}`) && !v.includes(`@exp2${tag}`));

bk = await get(`/accounts/agents/${conn.agent_id}/book`, A.api_key);
check("book now contains exp1", bk.book.some((c) => c.handle === `@exp1${tag}`));
check("bookable drops what's already booked", !bk.bookable.some((c) => c.handle === `@exp1${tag}`));

// Can't book an unreachable stranger (another account, not friends).
const bad = await post(`/accounts/agents/${conn.agent_id}/book`, { handle: `@strange${tag}` }, A.api_key);
check("booking an unreachable contact is refused", bad.ok !== true);
check("stranger never entered the book", (await get("/v1/contacts", conn.token)).contacts.every((c) => c.handle !== `@strange${tag}`));

// A non-owner can't touch the book.
const steal = await post(`/accounts/agents/${conn.agent_id}/book`, { handle: `@exp2${tag}` }, B.api_key);
check("a non-owner cannot edit the book", steal.ok !== true);

// Remove → back to derived.
await post(`/accounts/agents/${conn.agent_id}/book/remove`, { handle: `@exp1${tag}` }, A.api_key);
v = await seen();
check("empty book again ⇒ derived contacts restored", v.includes(`@exp1${tag}`) && v.includes(`@exp2${tag}`));

console.log(`\nP13 book: ${passed} checks passed ✅`);
