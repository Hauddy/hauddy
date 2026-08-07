// Smoke test for the Hauddy v0.1 scaffold (spec §4, §6, §8):
//  1. two agents register, link via the consent flow, and exchange an sms
//     while both are connected → B gets a deliver frame, A gets a `delivered` receipt
//  2. the same send while B is offline → A gets a `queued` receipt, and B
//     receives the envelope from the durable inbox when it reconnects
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId, mintMessageId } from "../packages/protocol/dist/index.js";

/** @type {import("../packages/hub/dist/index.js").HubHandle} */
let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-hub-test-"));
  // Default (non-autoLink) hub: exercises the §4 consent flow explicitly.
  hub = await startHub({ port: 0, dataDir });
});

after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

function makeKeys() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() };
}

async function post(pathname, body) {
  const res = await fetch(hub.httpUrl + pathname, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function registerAgent(grantScopeId, publicKeyPem, displayName) {
  const res = await post("/register", { grant_scope_id: grantScopeId, public_key: publicKeyPem, display_name: displayName });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.match(res.body.agent_id, /^agt_/);
  return res.body.agent_id;
}

/** Connect to the hub and run the §8 auth handshake. Returns a tiny test client. */
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
        /** Finish the handshake and return the auth_ok frame. */
        ready: () => waitFor((m) => m.type === "auth_ok"),
      });
    });
  });
}

function smsEnvelope(from, to, body) {
  return { v: "0.1", id: mintMessageId(), type: "sms", from, to, ts: new Date().toISOString(), payload: { body }, sig: null };
}

test("sms to an online linked contact is delivered and receipted", async () => {
  const keysA = makeKeys();
  const keysB = makeKeys();
  const gsA = mintGrantScopeId();
  const gsB = mintGrantScopeId();
  const idA = await registerAgent(gsA, keysA.publicKeyPem, "Agent A");
  const idB = await registerAgent(gsB, keysB.publicKeyPem, "Agent B");

  const clientA = await connectAgent({ agentId: idA, grantScopeId: gsA, privateKey: keysA.privateKey });
  const clientB = await connectAgent({ agentId: idB, grantScopeId: gsB, privateKey: keysB.privateKey });
  const okA = await clientA.ready();
  await clientB.ready();
  assert.deepEqual(okA.presence, []); // not linked yet → no presence visible (spec §5)

  // Consent flow (spec §4): A shares, B accepts.
  const share = await post("/contacts/share", { from: idA, agent_id: idB });
  assert.equal(share.body.state, "pending");
  const respond = await post("/contacts/respond", { from: idB, agent_id: idA, accept: true });
  assert.equal(respond.body.state, "linked");

  const envelope = smsEnvelope(idA, idB, "can you review the auth module?");
  clientA.send({ type: "send", envelope });

  const deliver = await clientB.waitFor((m) => m.type === "deliver");
  assert.equal(deliver.envelope.id, envelope.id);
  assert.equal(deliver.envelope.from, idA);
  assert.equal(deliver.envelope.to, idB);
  assert.equal(deliver.envelope.payload.body, "can you review the auth module?");
  clientB.send({ type: "ack", id: envelope.id });

  const receipt = await clientA.waitFor((m) => m.type === "receipt" && m.id === envelope.id);
  assert.equal(receipt.status, "delivered");

  clientA.ws.close();
  clientB.ws.close();
});

test("sms to an offline contact is queued and flushed on reconnect", async () => {
  const keysA = makeKeys();
  const keysB = makeKeys();
  const gsA = mintGrantScopeId();
  const gsB = mintGrantScopeId();
  const idA = await registerAgent(gsA, keysA.publicKeyPem);
  const idB = await registerAgent(gsB, keysB.publicKeyPem);

  // Link the pair up front (B never connects during the send).
  await post("/contacts/share", { from: idA, agent_id: idB });
  const respond = await post("/contacts/respond", { from: idB, agent_id: idA, accept: true });
  assert.equal(respond.body.state, "linked");

  const clientA = await connectAgent({ agentId: idA, grantScopeId: gsA, privateKey: keysA.privateKey });
  await clientA.ready();

  const envelope = smsEnvelope(idA, idB, "ping while you are offline");
  clientA.send({ type: "send", envelope });
  const receipt = await clientA.waitFor((m) => m.type === "receipt" && m.id === envelope.id);
  assert.equal(receipt.status, "queued");

  // B comes online later; the hub flushes its durable inbox (spec §7 tier 3).
  const clientB = await connectAgent({ agentId: idB, grantScopeId: gsB, privateKey: keysB.privateKey });
  await clientB.ready();
  const deliver = await clientB.waitFor((m) => m.type === "deliver");
  assert.equal(deliver.envelope.id, envelope.id);
  assert.equal(deliver.envelope.payload.body, "ping while you are offline");
  clientB.send({ type: "ack", id: envelope.id });

  clientA.ws.close();
  clientB.ws.close();
});
