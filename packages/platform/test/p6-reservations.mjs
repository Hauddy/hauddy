// P6 nickname-reservation integration test — runs against a live `wrangler dev`.
// Covers account-level holds (reserve / check / release / attach) and the shared
// namespace between reservations and bound nicknames. Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p6-reservations.mjs http://localhost:8787
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
  assert.ok(acct.api_key, `signup ${name} returned a key`);
  return { key: acct.api_key, accountId: acct.account_id };
}
async function register(acct, gs) {
  const reg = await post("/register", { grant_scope_id: `gs_${gs}_${tag}`, public_key: pem() }, acct.key);
  return reg.agent_id;
}

console.log("P6 nickname reservations @", base);

const A = await account("ralph");
const B = await account("rita");

// ── reserve + list ─────────────────────────────────────────────────────────
const foo = `foo${tag}`;
const r1 = await post("/accounts/nicknames/reserve", { name: foo }, A.key);
check("A reserves a free handle", r1.ok && r1.nickname === `@${foo}`);
const meA = await get("/accounts/me", A.key);
check("/accounts/me lists the reservation", meA.reservations?.includes(`@${foo}`));

// ── idempotent for the owner, taken for others ──────────────────────────────
const r1again = await post("/accounts/nicknames/reserve", { name: `@${foo}` }, A.key);
check("re-reserving your own hold is a no-op success", r1again.ok);
const r2 = await post("/accounts/nicknames/reserve", { name: foo }, B.key);
check("B cannot reserve A's held handle", r2.ok === false && r2.reason === "taken");

// ── availability check ──────────────────────────────────────────────────────
const availB = await get(`/accounts/nicknames/check?name=${foo}`, B.key);
check("check: reserved handle is unavailable to B (not mine)", availB.available === false && availB.reason === "reserved" && !availB.mine);
const availA = await get(`/accounts/nicknames/check?name=${foo}`, A.key);
check("check: A sees the same handle as mine", availA.available === false && availA.mine === true);
const availFree = await get(`/accounts/nicknames/check?name=free${tag}`, B.key);
check("check: an untaken handle is available", availFree.available === true);
const availBad = await get(`/accounts/nicknames/check?name=x`, A.key);
check("check: too-short handle is invalid", availBad.available === false && availBad.reason === "invalid");

// ── invalid reserve is rejected ─────────────────────────────────────────────
const rBad = await post("/accounts/nicknames/reserve", { name: "@@" }, A.key);
check("reserving an invalid handle → invalid", rBad.ok === false && rBad.reason === "invalid");

// ── attach the reservation to an agent (consumes the hold) ──────────────────
const aAgent = await register(A, "ralph");
const att = await post("/accounts/nicknames/attach", { name: foo, agent_id: aAgent }, A.key);
check("A attaches the reservation to its agent", att.ok && att.nickname === `@${foo}`);
const meA2 = await get("/accounts/me", A.key);
check("reservation is consumed once attached", !(meA2.reservations ?? []).includes(`@${foo}`));
check("the agent now holds the handle", meA2.agents.some((a) => a.agent_id === aAgent && a.nickname === `@${foo}`));

// ── the now-bound handle stays taken for others ─────────────────────────────
const bAgent = await register(B, "rita");
const bindConflict = await post(`/agents/${bAgent}/nickname`, { nickname: foo }, B.key);
check("B cannot bind a handle A holds on an agent", bindConflict.ok === false && bindConflict.reason === "conflict");

// ── a reservation protects the handle from a WS-style auto-bind too ─────────
const guard = `guard${tag}`;
await post("/accounts/nicknames/reserve", { name: guard }, A.key);
const bGuard = await post(`/agents/${bAgent}/nickname`, { nickname: guard }, B.key);
check("B cannot bind a handle A only reserved", bGuard.ok === false && bGuard.reason === "conflict");

// ── attach is owner-gated ───────────────────────────────────────────────────
const stealAttach = await post("/accounts/nicknames/attach", { name: guard, agent_id: bAgent }, B.key);
check("B cannot attach A's reservation", stealAttach.ok === false);

// ── release frees the handle for anyone ─────────────────────────────────────
const rel = `rel${tag}`;
await post("/accounts/nicknames/reserve", { name: rel }, A.key);
const released = await post("/accounts/nicknames/release", { name: rel }, A.key);
check("A releases its reservation", released.ok === true);
const relByB = await post("/accounts/nicknames/reserve", { name: rel }, B.key);
check("B can now reserve the released handle", relByB.ok === true);
const relByOther = await post("/accounts/nicknames/release", { name: rel }, A.key);
check("releasing someone else's hold is a no-op", relByOther.ok === false);

// ── reserving an already-bound handle is taken ──────────────────────────────
const takeBound = await post("/accounts/nicknames/reserve", { name: foo }, B.key);
check("reserving a bound handle → taken", takeBound.ok === false && takeBound.reason === "taken");

console.log(`\nP6: ${passed} checks passed ✅`);
