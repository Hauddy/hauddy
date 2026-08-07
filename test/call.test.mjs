// Call-readiness → presence: a session reports it can be rung (capability frame),
// and the "call" capability appears in presence. SMS/online are unaffected.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-call-test-"));
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

async function register(gs, pub, nickname) {
  const res = await fetch(hub.httpUrl + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_scope_id: gs, public_key: pub, nickname, local_id: nickname }),
  });
  return (await res.json()).agent_id;
}

function connect({ agentId, grantScopeId, privateKey }) {
  const ws = new WebSocket(hub.wsUrl);
  return new Promise((resolve) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_challenge") {
        const sig = sign(null, Buffer.from(msg.nonce, "base64url"), privateKey).toString("base64url");
        ws.send(JSON.stringify({ type: "auth_response", signature: sig }));
      } else if (msg.type === "auth_ok") {
        resolve({ ws, send: (f) => ws.send(JSON.stringify(f)) });
      }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: agentId, grant_scope_id: grantScopeId })));
  });
}

const presence = async (id) => (await fetch(hub.httpUrl + `/presence/${id}`).then((r) => r.json())).capabilities;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("presence exposes 'call' only after a session reports call-readiness", async () => {
  const keys = makeKeys();
  const gs = mintGrantScopeId();
  const id = await register(gs, keys.publicKeyPem, "caller");
  const client = await connect({ agentId: id, grantScopeId: gs, privateKey: keys.privateKey });

  // Reachable + SMS, but not call-capable until verified.
  assert.deepEqual(await presence(id), ["sms"]);

  client.send({ type: "capability", call: true });
  await wait(50);
  assert.deepEqual(await presence(id), ["sms", "call"]);

  client.send({ type: "capability", call: false });
  await wait(50);
  assert.deepEqual(await presence(id), ["sms"]);

  client.ws.close();
});
