// P3 WebSocket auth + routing + hibernation. Runs against a live `wrangler dev`.
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p3-ws.mjs http://localhost:8787
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
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

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
  const reg = await post(
    "/register",
    { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: `${name}${tag}` },
    acct.api_key,
  );
  return { key: acct.api_key, accountId: acct.account_id, agentId: reg.agent_id, gs, privateKey, nickname: `${name}${tag}` };
}

// Connect + authenticate; auto-acks and buffers inbound deliver envelopes.
function connect(a) {
  const ws = new WebSocket(wsUrl);
  const inbox = [];
  const waiters = [];
  let authResolve;
  const authP = new Promise((res) => (authResolve = res));
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "auth_challenge") {
      const signature = sign(null, Buffer.from(msg.nonce, "base64url"), a.privateKey).toString("base64url");
      ws.send(JSON.stringify({ type: "auth_response", signature }));
    } else if (msg.type === "auth_ok") {
      authResolve({ ws, auth: msg, nextDeliver });
    } else if (msg.type === "deliver") {
      ws.send(JSON.stringify({ type: "ack", id: msg.envelope.id }));
      const w = waiters.shift();
      if (w) w(msg.envelope);
      else inbox.push(msg.envelope);
    }
  });
  const nextDeliver = (ms = 2000) =>
    inbox.length
      ? Promise.resolve(inbox.shift())
      : Promise.race([
          new Promise((res) => waiters.push(res)),
          new Promise((_, rej) => setTimeout(() => rej(new Error("no deliver within timeout")), ms)),
        ]);
  ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: a.agentId, grant_scope_id: a.gs })));
  return authP;
}

function sendSms(ws, fromId, to, body) {
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
    ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id, type: "sms", from: fromId, to, ts: new Date().toISOString(), payload: { body }, sig: null } }));
  });
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

console.log("P3 WebSocket routing @", wsUrl);

const A = await profile("alice");
const B = await profile("bob");
const a = await connect(A);
let b = await connect(B);
check("auth_ok returns nickname + verified status", a.auth.nickname === `@${A.nickname}` && a.auth.nickname_status === "verified");

// ── strangers can't message ───────────────────────────────────────────────
const denied = await sendSms(a.ws, A.agentId, `@${B.nickname}`, "hi");
check("stranger send → E_NOT_LINKED", denied.type === "error" && denied.code === "E_NOT_LINKED");

// ── become friends over HTTP, then deliver ────────────────────────────────
await post("/accounts/friends/request", { handle: `@${B.nickname}` }, A.key);
check("friend accept links", (await post("/accounts/friends/respond", { account_id: A.accountId, accept: true }, B.key)).state === "linked");

const ok = await sendSms(a.ws, A.agentId, `@${B.nickname}`, "hi now");
check("linked send → receipt delivered", ok.type === "receipt" && ok.status === "delivered");
const got = await b.nextDeliver();
check("B receives the delivered envelope", got.payload.body === "hi now" && got.from === A.agentId);

// ── live presence reflects the open socket ────────────────────────────────
const pres = await get(`/presence/${B.agentId}?for=${A.agentId}`);
check("presence shows B online while connected", pres.state === "online" && pres.attached_instances === 1);

// ── offline queue → redelivery on reconnect ───────────────────────────────
b.ws.close();
await wait(300);
const presOff = await get(`/presence/${B.agentId}?for=${A.agentId}`);
check("presence shows B offline after close", presOff.state === "offline");
const queued = await sendSms(a.ws, A.agentId, `@${B.nickname}`, "while you were out");
check("send to offline agent → receipt queued", queued.type === "receipt" && queued.status === "queued");

b = await connect(B);
const redelivered = await b.nextDeliver(3000);
check("queued message redelivered on reconnect", redelivered.payload.body === "while you were out");

// ── identity mismatch is rejected ─────────────────────────────────────────
const spoof = await sendSms(a.ws, B.agentId, `@${B.nickname}`, "spoofed from");
check("envelope.from spoof → E_IDENTITY_MISMATCH", spoof.type === "error" && spoof.code === "E_IDENTITY_MISMATCH");

a.ws.close();
b.ws.close();
console.log(`\nP3: ${passed} checks passed ✅`);
process.exit(0);
