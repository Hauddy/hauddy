// Nickname verification via the auth_hello claim on a NON-autoLink hub:
//  - a free nickname claimed on connect verifies and shows the agent online
//  - the same nickname claimed by a second agent is a conflict → that agent
//    stays offline until it binds a free nickname of its own
//  - sms addressed by '@nickname' resolves and delivers
// (Keypair-only register, no account — the account tier is deferred.)
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
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-nick-test-"));
  hub = await startHub({ port: 0, dataDir }); // consent enforced (non-autoLink)
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

async function register(gs, publicKeyPem, localId) {
  const res = await api("POST", "/register", { grant_scope_id: gs, public_key: publicKeyPem, local_id: localId });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.agent_id;
}

function connectAgent({ agentId, grantScopeId, privateKey, nickname }) {
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
      const hello = { type: "auth_hello", agent_id: agentId, grant_scope_id: grantScopeId };
      if (nickname) hello.nickname = nickname;
      ws.send(JSON.stringify(hello));
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

test("auth_hello claim: verified, conflict, offline-until-resolved, deliver by @nickname", async () => {
  const kA = makeKeys();
  const kB = makeKeys();
  const gsA = mintGrantScopeId();
  const gsB = mintGrantScopeId();
  const idA = await register(gsA, kA.publicKeyPem, "a-main");
  const idB = await register(gsB, kB.publicKeyPem, "b-main");
  await api("POST", "/contacts/share", { from: idA, agent_id: idB });
  assert.equal((await api("POST", "/contacts/respond", { from: idB, agent_id: idA, accept: true })).body.state, "linked");

  const a = await connectAgent({ agentId: idA, grantScopeId: gsA, privateKey: kA.privateKey, nickname: "nick" });
  const okA = await a.ready();
  assert.equal(okA.nickname, "@nick");
  assert.equal(okA.nickname_status, "verified");

  const b = await connectAgent({ agentId: idB, grantScopeId: gsB, privateKey: kB.privateKey, nickname: "nick" });
  const okB = await b.ready();
  assert.equal(okB.nickname_status, "conflict");

  assert.equal((await api("GET", `/presence/${idA}?for=${idB}`)).body.state, "online");
  assert.equal((await api("GET", `/presence/${idB}?for=${idA}`)).body.state, "offline");

  // B resolves the conflict by binding a free nickname → online (no reconnect).
  assert.equal((await api("POST", `/agents/${idB}/nickname`, { nickname: "nick2" })).body.ok, true);
  const presB = await api("GET", `/presence/${idB}?for=${idA}`);
  assert.equal(presB.body.state, "online");
  assert.equal(presB.body.nickname, "@nick2");

  const env = smsEnvelope(idA, "@nick2", "addressed by nickname");
  a.send({ type: "send", envelope: env });
  const deliver = await b.waitFor((m) => m.type === "deliver");
  assert.equal(deliver.envelope.to, idB);
  assert.equal(deliver.envelope.payload.body, "addressed by nickname");
  b.send({ type: "ack", id: env.id });
  assert.equal((await a.waitFor((m) => m.type === "receipt" && m.id === env.id)).status, "delivered");

  a.ws.close();
  b.ws.close();
});
