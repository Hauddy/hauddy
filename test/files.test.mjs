// File attachments (spec: send/share files ≤10MB, reference-based via the hub's
// temp store). Covers: the FileStore itself (cap/quota/TTL), the hub's /files
// endpoints on both the local hub (autoLink, localhost-trusted) and the platform
// (Bearer + recipient/owner download auth), and a local end-to-end where an
// attachment rides an SMS and the recipient fetches it. Cross-machine bridging
// (daemon re-hosts files local↔platform) is proven live, not here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { FileStore, startHub } from "../packages/hub/dist/index.js";
import { HubConnection } from "../packages/sidecar/dist/connection.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

const tmp = (tag) => mkdtempSync(path.join(tmpdir(), `hauddy-files-${tag}-`));
const keys = () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return { privateKey, pub: publicKey.export({ type: "spki", format: "pem" }).toString() };
};
const register = (hub, gs, pub, nickname, key) =>
  fetch(hub.httpUrl + "/register", {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify({ grant_scope_id: gs, public_key: pub, nickname, local_id: nickname }),
  }).then((r) => r.json());
let _u = 0;
const signup = (hub, email) =>
  fetch(hub.httpUrl + "/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: `usr${_u++}`, email, password: "pw123456" }),
  }).then((r) => r.json());
const upload = (hub, bytes, { name = "f.bin", mime = "application/octet-stream", owner = "", to } = {}, key) =>
  fetch(hub.httpUrl + "/files", {
    method: "POST",
    headers: {
      "content-type": "application/octet-stream",
      "x-hauddy-filename": encodeURIComponent(name),
      "x-hauddy-mime": mime,
      "x-hauddy-owner": owner,
      ...(to ? { "x-hauddy-to": encodeURIComponent(to) } : {}),
      ...(key ? { authorization: `Bearer ${key}` } : {}),
    },
    body: bytes,
  });
const download = (hub, id, key) =>
  fetch(hub.httpUrl + "/files/" + id, { headers: { ...(key ? { authorization: `Bearer ${key}` } : {}) } });
const ready = (conn) => new Promise((res) => conn.once("ready", () => res()));
const nextMessage = (conn) => new Promise((res) => conn.once("message", (e) => res(e)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------- FileStore unit ----------------

test("FileStore: put → get round-trips the exact bytes", () => {
  const dir = tmp("store");
  const fs = new FileStore({ dir });
  const bytes = Buffer.from("hello attachments 📎", "utf8");
  const put = fs.put(bytes, { name: "a.txt", mime: "text/plain", owner: "agt_a", to: "@b", account_id: null });
  assert.ok(put.ok && put.file.file_id);
  assert.equal(put.file.size, bytes.length);
  const got = fs.get(put.file.file_id);
  assert.ok(got);
  assert.equal(Buffer.compare(got.bytes, bytes), 0, "bytes identical");
  assert.equal(got.meta.name, "a.txt");
  fs.close();
  rmSync(dir, { recursive: true, force: true });
});

test("FileStore: rejects a file over the per-file cap", () => {
  const dir = tmp("cap");
  const fs = new FileStore({ dir, maxFileBytes: 1024 });
  const res = fs.put(Buffer.alloc(2048), { name: "big", mime: "x", owner: "a", to: null, account_id: null });
  assert.equal(res.ok, false);
  fs.close();
  rmSync(dir, { recursive: true, force: true });
});

test("FileStore: rejects once the whole-store quota is exceeded", () => {
  const dir = tmp("quota");
  const fs = new FileStore({ dir, maxFileBytes: 1024, maxTotalBytes: 1500 });
  assert.ok(fs.put(Buffer.alloc(1000), { name: "a", mime: "x", owner: "a", to: null, account_id: null }).ok);
  const second = fs.put(Buffer.alloc(1000), { name: "b", mime: "x", owner: "a", to: null, account_id: null });
  assert.equal(second.ok, false, "second put would exceed the store quota");
  fs.close();
  rmSync(dir, { recursive: true, force: true });
});

test("FileStore: an expired file is swept and no longer readable", async () => {
  const dir = tmp("ttl");
  const fs = new FileStore({ dir, ttlMs: 0 });
  const put = fs.put(Buffer.from("temp"), { name: "t", mime: "x", owner: "a", to: null, account_id: null });
  assert.ok(put.ok);
  await sleep(5);
  assert.equal(fs.get(put.file.file_id), null, "expired file gone");
  fs.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------- local hub endpoints (autoLink, localhost-trusted) ----------

test("local hub /files: upload then download returns identical bytes, no auth", async () => {
  const dir = tmp("localhub");
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  const bytes = Buffer.from(Array.from({ length: 5000 }, (_, i) => i % 256));
  const up = await upload(hub, bytes, { name: "data.bin", owner: "agt_a", to: "@b" }).then((r) => r.json());
  assert.ok(up.file_id);
  assert.equal(up.size, bytes.length);
  const res = await download(hub, up.file_id);
  assert.equal(res.status, 200);
  assert.equal(decodeURIComponent(res.headers.get("x-hauddy-filename")), "data.bin");
  const back = Buffer.from(await res.arrayBuffer());
  assert.equal(Buffer.compare(back, bytes), 0);
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

test("local hub /files: a file over 10MB is rejected (413)", async () => {
  const dir = tmp("localbig");
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1);
  const res = await upload(hub, tooBig, { name: "huge.bin", owner: "agt_a" });
  assert.equal(res.status, 413);
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------- platform endpoints (Bearer + recipient/owner auth) ---------

test("platform /files: upload needs Bearer; download is limited to owner + recipient", async () => {
  const dir = tmp("plat");
  const hub = await startHub({ port: 0, dataDir: dir }); // autoLink off → global tier
  const alice = await signup(hub, "alice@x");
  const bob = await signup(hub, "bob@x");
  const stranger = await signup(hub, "eve@x");
  // Bob exposes an agent as @bob so a file addressed to @bob authorizes his account.
  await register(hub, mintGrantScopeId(), keys().pub, "bob", bob.api_key);

  const bytes = Buffer.from("secret payload");

  // no Bearer → 401
  assert.equal((await upload(hub, bytes, { name: "s", owner: "a", to: "@bob" })).status, 401);

  // alice uploads addressed to @bob
  const up = await upload(hub, bytes, { name: "s", owner: "a", to: "@bob" }, alice.api_key).then((r) => r.json());
  assert.ok(up.file_id);

  // owner (alice) can download
  const asOwner = await download(hub, up.file_id, alice.api_key);
  assert.equal(asOwner.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await asOwner.arrayBuffer()), bytes), 0);

  // recipient (bob) can download
  assert.equal((await download(hub, up.file_id, bob.api_key)).status, 200);

  // unrelated account is forbidden
  assert.equal((await download(hub, up.file_id, stranger.api_key)).status, 403);

  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------- local end-to-end: attachment rides an SMS ------------------

test("e2e (local): an attachment rides a send_sms and the recipient fetches it", async () => {
  const dir = tmp("e2e");
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  const a = keys();
  const b = keys();
  const A = (await register(hub, mintGrantScopeId(), a.pub, "asender")).agent_id;
  const B = (await register(hub, mintGrantScopeId(), b.pub, "breceiver")).agent_id;

  const connA = new HubConnection({ endpoint: hub.wsUrl, agentId: A, grantScopeId: "gsA", privateKey: a.privateKey });
  const connB = new HubConnection({ endpoint: hub.wsUrl, agentId: B, grantScopeId: "gsB", privateKey: b.privateKey });
  connA.start();
  connB.start();
  await Promise.all([ready(connA), ready(connB)]);

  // A uploads the file to the local hub, then sends an SMS carrying its reference.
  const bytes = Buffer.from("the contents of the shared file");
  const up = await upload(hub, bytes, { name: "note.txt", mime: "text/plain", owner: A, to: "@breceiver" }).then((r) => r.json());
  const attachment = { file_id: up.file_id, name: "note.txt", mime: "text/plain", size: bytes.length };

  const got = nextMessage(connB);
  await connA.sendSms("@breceiver", "sending you a file", [attachment]);
  const env = await got;
  assert.equal(env.payload.body, "sending you a file");
  assert.ok(Array.isArray(env.payload.attachments) && env.payload.attachments.length === 1, "attachment metadata rides the message");
  const ref = env.payload.attachments[0];
  assert.equal(ref.name, "note.txt");

  // B downloads by the referenced id → identical bytes.
  const res = await download(hub, ref.file_id);
  assert.equal(res.status, 200);
  assert.equal(Buffer.compare(Buffer.from(await res.arrayBuffer()), bytes), 0, "recipient fetched the exact bytes");

  connA.stop();
  connB.stop();
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});

test("e2e (local): a call frame (say) carries an attachment the callee can fetch", async () => {
  const dir = tmp("call");
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  const a = keys();
  const b = keys();
  const A = (await register(hub, mintGrantScopeId(), a.pub, "caller")).agent_id;
  const B = (await register(hub, mintGrantScopeId(), b.pub, "callee")).agent_id;
  const connA = new HubConnection({ endpoint: hub.wsUrl, agentId: A, grantScopeId: "gsA", privateKey: a.privateKey });
  const connB = new HubConnection({ endpoint: hub.wsUrl, agentId: B, grantScopeId: "gsB", privateKey: b.privateKey });
  connA.start();
  connB.start();
  await Promise.all([ready(connA), ready(connB)]);

  const bytes = Buffer.from("a file spoken on a call");
  const up = await upload(hub, bytes, { name: "c.txt", mime: "text/plain", owner: A, to: "@callee" }).then((r) => r.json());
  const att = { file_id: up.file_id, name: "c.txt", mime: "text/plain", size: bytes.length };

  connA.sendCall("@callee", { id: "call_x", kind: "frame" }, "sending a file on the call", [att]);
  const frame = await connB.awaitCall((f) => f.id === "call_x", 100, 20);
  assert.ok(frame, "call frame received");
  assert.ok(frame.attachments && frame.attachments.length === 1, "attachment rides the call frame");
  assert.equal(frame.attachments[0].name, "c.txt");
  const res = await download(hub, frame.attachments[0].file_id);
  assert.equal(Buffer.compare(Buffer.from(await res.arrayBuffer()), bytes), 0);

  connA.stop();
  connB.stop();
  await hub.close();
  rmSync(dir, { recursive: true, force: true });
});
