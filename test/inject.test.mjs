// The delivery piece: the daemon's per-agent injection stream that a plain-
// terminal PTY wrapper subscribes to. A call *invite* routed by the hub is
// published as a "ring" on the callee's stream; a POST publishes a validation
// code the same way. SMS never injects.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId, mintMessageId } from "../packages/protocol/dist/index.js";
import { InjectionBus } from "../packages/sidecar/dist/inject.js";
import { startLocalApi } from "../packages/sidecar/dist/local-api.js";

let hub;
let api;
let dataDir;
const bus = new InjectionBus();

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-inject-test-"));
  hub = await startHub({
    port: 0,
    dataDir,
    autoLink: true,
    // Mirror Daemon.onHubDeliver: a call invite → ring the callee's wrapper.
    onDeliver: (toId, env) => {
      const call = env.payload?.call;
      if (!call || call.kind !== "invite") return;
      const caller = typeof env.payload.body === "string" ? env.payload.body : env.from;
      bus.publish(toId, {
        type: "ring",
        text: `${caller} is calling — run \`pickup_call\` to answer (or ignore to let it go to SMS).`,
      });
    },
  });
  // startLocalApi only touches daemon.injections for the /api/inject routes.
  api = await startLocalApi({ daemon: { injections: bus }, port: 0 });
});
after(async () => {
  await api.close();
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
    ws.on("open", () =>
      ws.send(JSON.stringify({ type: "auth_hello", agent_id: agentId, grant_scope_id: grantScopeId })),
    );
  });
}

/** Read SSE events off the stream until `want` matches one, or time out. */
async function nextEvent(res, want, ms = 4000) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  const deadline = Date.now() + ms;
  try {
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      for (const block of buf.split("\n\n")) {
        const line = block.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (want(payload)) return payload;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return null;
}

test("a routed call invite lands as a ring on the callee's injection stream", async () => {
  const a = makeKeys();
  const b = makeKeys();
  const gsA = mintGrantScopeId();
  const gsB = mintGrantScopeId();
  const caller = await register(gsA, a.publicKeyPem, "caller");
  const callee = await register(gsB, b.publicKeyPem, "callee");
  const callerClient = await connect({ agentId: caller, grantScopeId: gsA, privateKey: a.privateKey });
  await connect({ agentId: callee, grantScopeId: gsB, privateKey: b.privateKey });

  // The wrapper subscribes to the callee's stream.
  const ctrl = new AbortController();
  const stream = await fetch(`${api.url}/api/inject/${callee}`, {
    headers: { accept: "text/event-stream" },
    signal: ctrl.signal,
  });
  assert.equal(stream.headers.get("content-type"), "text/event-stream");

  // The caller places a call: an sms envelope carrying a call invite.
  callerClient.send({
    type: "send",
    envelope: {
      v: "0.1",
      id: mintMessageId(),
      type: "sms",
      from: caller,
      to: callee,
      ts: new Date().toISOString(),
      payload: { body: "@caller", call: { id: "call_test", kind: "invite" } },
      sig: null,
    },
  });

  const ring = await nextEvent(stream, (e) => e.type === "ring");
  assert.ok(ring, "expected a ring on the stream");
  assert.match(ring.text, /@caller is calling/);
  assert.match(ring.text, /pickup_call/);
  ctrl.abort();
  callerClient.ws.close();
});

test("POST /api/inject publishes a validation code to a live subscriber", async () => {
  const agentId = "agent_pub_test";
  const ctrl = new AbortController();
  const stream = await fetch(`${api.url}/api/inject/${agentId}`, {
    headers: { accept: "text/event-stream" },
    signal: ctrl.signal,
  });

  const post = await fetch(`${api.url}/api/inject/${agentId}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "validate", text: "code 1a2b3c", code: "1a2b3c" }),
  });
  assert.deepEqual(await post.json(), { delivered: 1 });

  const evt = await nextEvent(stream, (e) => e.type === "validate");
  assert.ok(evt, "expected the validation event on the stream");
  assert.equal(evt.code, "1a2b3c");
  ctrl.abort();
});

test("publishing with no subscriber delivers to nobody (no injection without a wrapper)", async () => {
  const res = await fetch(`${api.url}/api/inject/nobody_home`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "ring", text: "x is calling" }),
  });
  assert.deepEqual(await res.json(), { delivered: 0 });
});
