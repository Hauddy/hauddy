// Local a2a (the alpha): two agents self-register with their own keypairs and
// FREE local nicknames against an autoLink hub — NO account, NO consent — and
// message each other by @nickname. This is the zero-config local network.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId, mintMessageId } from "../packages/protocol/dist/index.js";

let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-local-test-"));
  hub = await startHub({ port: 0, dataDir, autoLink: true });
});

after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

async function api(method, pathname, body) {
  const res = await fetch(hub.httpUrl + pathname, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json() };
}

/** Register keypair-only (no account) with a free local nickname. */
async function register(gs, publicKeyPem, nickname, localId) {
  const res = await api("POST", "/register", { grant_scope_id: gs, public_key: publicKeyPem, nickname, local_id: localId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body; // { agent_id, nickname }
}

function connectAgent({ agentId, grantScopeId, privateKey }) {
  const ws = new WebSocket(hub.wsUrl);
  const queue = [];
  const waiters = [];
  const dispatch = (msg) => {
    const i = waiters.findIndex((w) => w.pred(msg));
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  };
  const waitFor = (pred, timeoutMs = 5000) => {
    const i = queue.findIndex(pred);
    if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { pred, resolve };
      waiters.push(waiter);
      setTimeout(() => {
        const idx = waiters.indexOf(waiter);
        if (idx >= 0) {
          waiters.splice(idx, 1);
          reject(new Error("timed out waiting for frame"));
        }
      }, timeoutMs);
    });
  };
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "auth_challenge") {
      const signature = sign(null, Buffer.from(msg.nonce, "base64url"), privateKey).toString("base64url");
      ws.send(JSON.stringify({ type: "auth_response", signature }));
    } else {
      dispatch(msg);
    }
  });
  return new Promise((resolve, reject) => {
    ws.on("error", reject);
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "auth_hello", agent_id: agentId, grant_scope_id: grantScopeId }));
      resolve({
        ws,
        waitFor,
        send: (frame) => ws.send(JSON.stringify(frame)),
        ready: () => waitFor((m) => m.type === "auth_ok"),
      });
    });
  });
}

function smsEnvelope(from, to, body) {
  return { v: "0.1", id: mintMessageId(), type: "sms", from, to, ts: new Date().toISOString(), payload: { body }, sig: null };
}

test("two local agents message each other by @nickname, no account", async () => {
  const kA = makeKeys();
  const kB = makeKeys();
  const gsA = mintGrantScopeId();
  const gsB = mintGrantScopeId();
  const a = await register(gsA, kA.publicKeyPem, "ada", "ada-cli");
  const b = await register(gsB, kB.publicKeyPem, "bo", "bo-cli");
  assert.equal(a.nickname, "@ada");
  assert.equal(b.nickname, "@bo");

  // GET /agents lists both local runtimes (no auth).
  const agents = await api("GET", "/agents");
  assert.equal(agents.body.agents.length, 2);

  const clientA = await connectAgent({ agentId: a.agent_id, grantScopeId: gsA, privateKey: kA.privateKey });
  const clientB = await connectAgent({ agentId: b.agent_id, grantScopeId: gsB, privateKey: kB.privateKey });
  await clientA.ready();
  await clientB.ready();

  // Both auto-linked (autoLink) — A is online to B with its nickname.
  const presA = await api("GET", `/presence/${a.agent_id}?for=${b.agent_id}`);
  assert.equal(presA.body.state, "online");
  assert.equal(presA.body.nickname, "@ada");

  // A → @bo, delivered without any consent step.
  const env = smsEnvelope(a.agent_id, "@bo", "hey bo, it's ada");
  clientA.send({ type: "send", envelope: env });
  const deliver = await clientB.waitFor((m) => m.type === "deliver");
  assert.equal(deliver.envelope.to, b.agent_id);
  assert.equal(deliver.envelope.payload.body, "hey bo, it's ada");
  clientB.send({ type: "ack", id: env.id });
  assert.equal((await clientA.waitFor((m) => m.type === "receipt" && m.id === env.id)).status, "delivered");

  clientA.ws.close();
  clientB.ws.close();
});

test("local nicknames: bind is free, unique within the hub, renameable", async () => {
  const kA = makeKeys();
  const kB = makeKeys();
  const idA = (await register(mintGrantScopeId(), kA.publicKeyPem, undefined, "a2")).agent_id;
  const idB = (await register(mintGrantScopeId(), kB.publicKeyPem, undefined, "b2")).agent_id;

  assert.deepEqual((await api("POST", `/agents/${idA}/nickname`, { nickname: "scout" })).body, { ok: true, nickname: "@scout" });
  // B can't take a name already bound to A.
  const conflict = await api("POST", `/agents/${idB}/nickname`, { nickname: "scout" });
  assert.equal(conflict.body.ok, false);
  assert.equal(conflict.body.reason, "conflict");
  // A renames away → the name frees up for B.
  assert.equal((await api("POST", `/agents/${idA}/nickname`, { nickname: "scout2" })).body.ok, true);
  assert.equal((await api("POST", `/agents/${idB}/nickname`, { nickname: "scout" })).body.ok, true);
});
