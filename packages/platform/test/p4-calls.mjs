// P4 call persistence — calls + call_frames, kept DISTINCT from messages.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p4-calls.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { WebSocket } from "ws";

const base = process.argv[2] ?? "http://localhost:8787";
const wsUrl = base.replace(/^http/, "ws");
const post = (p, body, key) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const getRes = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} });

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};

const tag = Math.random().toString(36).slice(2, 8);
async function profile(name) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const acct = await post("/accounts", { username: `${name}${tag}`, email: `${name}-${tag}@x.test`, password: "pw123456" });
  const gs = `gs_${name}_${tag}`;
  const reg = await post("/register", { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `${name}${tag}` }, acct.api_key);
  return { key: acct.api_key, accountId: acct.account_id, agentId: reg.agent_id, gs, privateKey, nickname: `${name}${tag}` };
}

function connect(a) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  let authResolve;
  const authP = new Promise((res) => (authResolve = res));
  const nextDeliver = (ms = 2000) =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : Promise.race([new Promise((res) => waiters.push(res)), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "auth_challenge") {
      ws.send(JSON.stringify({ type: "auth_response", signature: sign(null, Buffer.from(msg.nonce, "base64url"), a.privateKey).toString("base64url") }));
    } else if (msg.type === "auth_ok") {
      authResolve({ ws, nextDeliver });
    } else if (msg.type === "deliver") {
      ws.send(JSON.stringify({ type: "ack", id: msg.envelope.id }));
      const w = waiters.shift();
      if (w) w(msg.envelope);
      else inbox.push(msg.envelope);
    }
  });
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: a.agentId, grant_scope_id: a.gs })));
  return authP;
}

// Send an sms envelope carrying an arbitrary payload; resolve with the receipt/error.
function send(ws, fromId, to, payload) {
  const id = `msg_${Math.random().toString(36).slice(2)}${Date.now()}`;
  return new Promise((resolve) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if ((msg.type === "receipt" && msg.id === id) || (msg.type === "error" && msg.ref === id)) {
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id, type: "sms", from: fromId, to, ts: new Date().toISOString(), payload, sig: null } }));
  });
}
const callFrame = (id, kind, body) => ({ call: { id, kind }, ...(body !== undefined ? { body } : {}) });

console.log("P4 call persistence @", base);

const A = await profile("caller");
const B = await profile("callee");
const C = await profile("stranger");
await post("/accounts/friends/request", { handle: `@${B.nickname}` }, A.key);
await post("/accounts/friends/respond", { account_id: A.accountId, accept: true }, B.key);
const a = await connect(A);
const b = await connect(B);

// ── an answered call: invite → say → say → hangup ─────────────────────────
const call1 = `call_${tag}_1`;
check("invite delivers", (await send(a.ws, A.agentId, `@${B.nickname}`, callFrame(call1, "invite", "ring ring"))).status === "delivered");
await b.nextDeliver(); // B sees the invite
check("B frame delivers", (await send(b.ws, B.agentId, `@${A.nickname}`, callFrame(call1, "frame", "hello?"))).status === "delivered");
await a.nextDeliver();
check("A frame delivers", (await send(a.ws, A.agentId, `@${B.nickname}`, callFrame(call1, "frame", "hi callee"))).status === "delivered");
await b.nextDeliver();
await send(a.ws, A.agentId, `@${B.nickname}`, callFrame(call1, "close"));

// ── read back the persisted call + transcript ─────────────────────────────
const res1 = await getRes(`/calls/${call1}`, A.key);
const { call, frames } = await res1.json();
check("call row: caller/callee correct", call.caller === A.agentId && call.callee === B.agentId);
check("call state = ended (answered then closed)", call.state === "ended" && call.answered_ms != null && call.ended_ms != null);
check("exactly 2 spoken frames captured", frames.length === 2);
check("frame 0 = B's 'hello?'", frames[0].seq === 0 && frames[0].from_agent === B.agentId && frames[0].body === "hello?");
check("frame 1 = A's 'hi callee'", frames[1].seq === 1 && frames[1].from_agent === A.agentId && frames[1].body === "hi callee");
check("invite greeting is NOT a frame (SMS≠Call: invite≠content)", !frames.some((f) => f.body === "ring ring"));

// ── participant gating ────────────────────────────────────────────────────
check("stranger can't read the call (403)", (await getRes(`/calls/${call1}`, C.key)).status === 403);
check("unauthenticated can't read the call (401)", (await getRes(`/calls/${call1}`)).status === 401);

// ── SMS≠Call: a plain SMS does not become a call frame ────────────────────
check("plain SMS delivers", (await send(a.ws, A.agentId, `@${B.nickname}`, { body: "just a normal text" })).status === "delivered");
await b.nextDeliver();
const after = await (await getRes(`/calls/${call1}`, A.key)).json();
check("plain SMS did not leak into call_frames", after.frames.length === 2 && !after.frames.some((f) => f.body === "just a normal text"));

// ── a missed call: invite, never answered, closed ────────────────────────
const call2 = `call_${tag}_2`;
await send(a.ws, A.agentId, `@${B.nickname}`, callFrame(call2, "invite", "anyone home?"));
await b.nextDeliver();
await send(a.ws, A.agentId, `@${B.nickname}`, callFrame(call2, "close"));
const missed = await (await getRes(`/calls/${call2}`, A.key)).json();
check("unanswered close → state 'missed', no answered_ms, no frames", missed.call.state === "missed" && missed.call.answered_ms == null && missed.frames.length === 0);

a.ws.close();
b.ws.close();
console.log(`\nP4: ${passed} checks passed ✅`);
process.exit(0);
