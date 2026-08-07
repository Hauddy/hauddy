// The relay (spec §"Going global"): the daemon bridges an exposed agent to the
// platform so messages — and calls — cross machines. This exercises the load-
// bearing primitives directly: a local hub in gateway mode (setRemotes +
// forwardRemote), a raw upstream HubConnection standing in for the bridge, and
// injectInbound. Two real hubs; the daemon's thin wiring is covered live.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHub } from "../packages/hub/dist/index.js";
import { HubConnection } from "../packages/sidecar/dist/connection.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, pub: publicKey.export({ type: "spki", format: "pem" }).toString() };
};
const register = (hub, gs, pub, nickname) =>
  fetch(hub.httpUrl + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_scope_id: gs, public_key: pub, nickname, local_id: nickname }),
  }).then((r) => r.json());

const ready = (conn) => new Promise((res) => conn.once("ready", () => res()));
const nextMessage = (conn) => new Promise((res) => conn.once("message", (e) => res(e)));
const nextRing = (conn) => new Promise((res) => conn.once("ring", (f) => res(f)));

let platform, local, dirs;
let aliceBridge; // alice's upstream connection (the "bridge"), referenced by forwardRemote
let aliceSession, bobConn;
let LOCAL_ALICE, PLAT_ALICE, PLAT_BOB;
const rings = [];

before(async () => {
  const d1 = mkdtempSync(path.join(tmpdir(), "hauddy-relay-plat-"));
  const d2 = mkdtempSync(path.join(tmpdir(), "hauddy-relay-local-"));
  dirs = [d1, d2];
  // Platform in autoLink so this test isolates the *relay* from consent (that's
  // the friendships workstream); local hub is the gateway.
  platform = await startHub({ port: 0, dataDir: d1, autoLink: true });
  local = await startHub({
    port: 0,
    dataDir: d2,
    autoLink: true,
    onDeliver: (_toId, env) => {
      if (env.payload?.call?.kind === "invite") rings.push(env);
    },
    // Gateway: a send to a remote nickname → relay up alice's bridge.
    forwardRemote: (_fromId, env) => aliceBridge.relay(env.to, env.payload),
  });

  const gsAlice = mintGrantScopeId();
  const gsBob = mintGrantScopeId();
  const aliceKeys = keys();
  const bobKeys = keys();

  // Bob lives on the platform; Alice is exposed (registered on both hubs, same key).
  PLAT_BOB = (await register(platform, gsBob, bobKeys.pub, "bob")).agent_id;
  PLAT_ALICE = (await register(platform, gsAlice, aliceKeys.pub, "alice")).agent_id;
  LOCAL_ALICE = (await register(local, gsAlice, aliceKeys.pub, "alice")).agent_id;

  // The local hub mirrors bob as a remote friend so `@bob` resolves + forwards.
  local.setRemotes([{ agent_id: PLAT_BOB, nickname: "@bob", online: true, callReady: false }]);

  // Alice's bridge: a raw upstream connection to the platform, re-injecting every
  // inbound envelope into the local hub (rewriting `from` → the remote @handle).
  aliceBridge = new HubConnection({
    endpoint: platform.wsUrl,
    agentId: PLAT_ALICE,
    grantScopeId: gsAlice,
    privateKey: aliceKeys.privateKey,
    raw: true,
  });
  aliceBridge.on("envelope", (env) => {
    const from = env.from === PLAT_BOB ? "@bob" : env.from;
    local.injectInbound(LOCAL_ALICE, { ...env, from });
  });

  // Bob's live session on the platform; Alice's live session on the local hub.
  bobConn = new HubConnection({ endpoint: platform.wsUrl, agentId: PLAT_BOB, grantScopeId: gsBob, privateKey: bobKeys.privateKey });
  aliceSession = new HubConnection({ endpoint: local.wsUrl, agentId: LOCAL_ALICE, grantScopeId: gsAlice, privateKey: aliceKeys.privateKey });
  aliceBridge.start();
  bobConn.start();
  aliceSession.start();
  await Promise.all([ready(aliceBridge), ready(bobConn), ready(aliceSession)]);
});

after(async () => {
  aliceBridge?.stop();
  bobConn?.stop();
  aliceSession?.stop();
  await local?.close();
  await platform?.close();
  for (const d of dirs ?? []) rmSync(d, { recursive: true, force: true });
});

test("outbound: a local agent's send to @remote is forwarded up to the platform", async () => {
  const got = nextMessage(bobConn);
  const receipt = await aliceSession.sendSms("@bob", "hi from alice");
  assert.equal(receipt.status, "queued", "the gateway acks a forwarded send as queued");
  const env = await got;
  assert.equal(env.payload.body, "hi from alice");
  assert.equal(env.from, PLAT_ALICE, "platform asserts the sender = alice's platform id");
});

test("inbound: a platform message to the exposed agent lands in its local session", async () => {
  const got = nextMessage(aliceSession);
  await bobConn.sendSms("@alice", "hi from bob");
  const env = await got;
  assert.equal(env.payload.body, "hi from bob");
  assert.equal(env.from, "@bob", "from is rewritten to the remote @handle for replies");
});

test("inbound call invite rings the exposed agent through the gateway", async () => {
  rings.length = 0;
  const ring = nextRing(aliceSession);
  bobConn.sendCall("@alice", { id: "call_relay", kind: "invite" }, "@bob");
  const frame = await ring;
  assert.equal(frame.kind, "invite");
  assert.equal(rings.length, 1, "onDeliver saw the invite → wrapper ring publishes too");
});
