import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-ver-test-"));
  hub = await startHub({ port: 0, dataDir, autoLink: true, minClientVersion: "0.2.0" });
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

test("version gate: rejects outdated client_version (< 0.2.0) with auth_rejected", async () => {
  const keys = makeKeys();
  const gs = mintGrantScopeId();
  const id = await register(gs, keys.publicKeyPem, "oldclient");

  const ws = new WebSocket(hub.wsUrl);
  const result = await new Promise((resolve) => {
    let rejectedFrame = null;
    let closeCode = null;

    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_rejected") {
        rejectedFrame = msg;
      }
    });

    ws.on("close", (code) => {
      closeCode = code;
      resolve({ rejectedFrame, closeCode });
    });

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "auth_hello",
          agent_id: id,
          grant_scope_id: gs,
          client_version: "0.1.0",
        }),
      );
    });
  });

  assert.ok(result.rejectedFrame, "received auth_rejected control frame");
  assert.equal(result.rejectedFrame.reason, "client_outdated");
  assert.equal(result.rejectedFrame.min_version, "0.2.0");
  assert.equal(result.closeCode, 4000);
});

test("version gate: accepts valid client_version (>= 0.2.0) with auth_challenge", async () => {
  const keys = makeKeys();
  const gs = mintGrantScopeId();
  const id = await register(gs, keys.publicKeyPem, "newclient");

  const ws = new WebSocket(hub.wsUrl);
  const challenge = await new Promise((resolve) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_challenge") {
        resolve(msg);
      }
    });

    ws.on("open", () => {
      ws.send(
        JSON.stringify({
          type: "auth_hello",
          agent_id: id,
          grant_scope_id: gs,
          client_version: "0.2.1",
        }),
      );
    });
  });

  assert.ok(challenge, "received auth_challenge for valid client_version");
  assert.equal(challenge.type, "auth_challenge");
  ws.close();
});
