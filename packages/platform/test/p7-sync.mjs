// P7 cross-hub sync mirror — runs against a live `wrangler dev`. Covers the
// persist-only ingest (push), account-scoped pull, anti-tamper (INSERT OR IGNORE
// SSOT), account isolation, and call sync. Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8799 --var RATE_LIMIT:off
//   node packages/platform/test/p7-sync.mjs http://localhost:8799
import assert from "node:assert/strict";
import { generateKeyPairSync, randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8799";
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
const msg = (from, to, body, ms) => ({
  message_id: `m_${randomUUID()}`,
  from_agent: from,
  to_agent: to,
  from_nick: null,
  to_nick: null,
  body,
  attachments: null,
  created_at: new Date(ms).toISOString(),
  created_ms: ms,
  delivered_at: null,
  read_at: null,
  account_scope: null,
});

console.log("P7 cross-hub sync @", base);

const A = await account("sync-a");
const B = await account("sync-b");
const agentA = await register(A, "aa");
const humanA = (await get("/console/identity", A.key)).agent_id;
check("account A has a human console identity", typeof humanA === "string" && humanA.length > 0);

// ── push up (persist-only ingest) ──────────────────────────────────────────
// Past timestamps (like real local history) so the server's pull cursor covers them.
const t0 = Date.now() - 60_000;
const m1 = msg(humanA, agentA, "hello from local", t0);
const m2 = msg(agentA, humanA, "hi back", t0 + 1000);
const ing = await post("/console/sync/messages", { messages: [m1, m2] }, A.key);
check("ingest accepts pushed messages", ing.ok && ing.ingested === 2);

// ── pull down (account-scoped) ─────────────────────────────────────────────
const pull = await get("/console/sync/pull?since=0", A.key);
const ids = new Set((pull.messages ?? []).map((m) => m.message_id));
check("pull returns both pushed messages", ids.has(m1.message_id) && ids.has(m2.message_id));
check("pull reports a server clock cursor", typeof pull.now === "number" && pull.now >= t0);

// ── they surface in the browsable history too ──────────────────────────────
const threads = await get("/console/threads", A.key);
check("pushed messages form a thread with the agent", (threads.threads ?? []).some((t) => t.peer_id === agentA));
const thread = await get(`/console/thread/${encodeURIComponent(agentA)}`, A.key);
check("thread history contains the pushed body", (thread.messages ?? []).some((m) => m.body === "hello from local"));

// ── anti-tamper: re-push the same id with an edited body is IGNORED ─────────
const tampered = { ...m1, body: "TAMPERED" };
const re = await post("/console/sync/messages", { messages: [tampered] }, A.key);
check("re-ingest of a known id is accepted (but ignored)", re.ok);
const pull2 = await get("/console/sync/pull?since=0", A.key);
const stored = (pull2.messages ?? []).find((m) => m.message_id === m1.message_id);
check("SSOT preserved: the original body is unchanged", stored && stored.body === "hello from local");

// ── account isolation: B never sees A's messages ───────────────────────────
const pullB = await get("/console/sync/pull?since=0", B.key);
check("account B's pull excludes A's messages", !(pullB.messages ?? []).some((m) => m.message_id === m1.message_id));

// ── incremental cursor: since=now returns nothing new ──────────────────────
const pull3 = await get(`/console/sync/pull?since=${pull.now}`, A.key);
check("pull since the cursor returns no already-seen messages", !(pull3.messages ?? []).some((m) => ids.has(m.message_id)));

// ── call sync: session + frames round-trip ─────────────────────────────────
const callId = `call_${randomUUID()}`;
const callPush = await post(
  "/console/sync/calls",
  {
    calls: [
      {
        call_id: callId,
        caller: humanA,
        callee: agentA,
        caller_nick: null,
        callee_nick: null,
        state: "ended",
        started_ms: t0 + 5000,
        answered_ms: t0 + 5100,
        ended_ms: t0 + 5200,
        end_reason: "hangup",
        frames: [{ frame_id: `f_${randomUUID()}`, seq: 0, from_agent: humanA, body: "on the call", attachments: null, created_ms: t0 + 5100 }],
      },
    ],
  },
  A.key,
);
check("ingest accepts a pushed call", callPush.ok && callPush.ingested === 1);
const pullCalls = await get("/console/sync/pull?since=0", A.key);
const gotCall = (pullCalls.calls ?? []).find((c) => c.call_id === callId);
check("pull returns the call with its frame", gotCall && gotCall.frames?.some((f) => f.body === "on the call"));
check("pulled call frames carry frame_id (idempotent pull)", gotCall.frames.every((f) => typeof f.frame_id === "string"));

console.log(`\nP7 sync: ${passed}/${passed} checks passed ✓`);
