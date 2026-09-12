// Exercise the actual Cloudflare handlers and SQL with a local SQLite adapter.
// Runtime scheduling/WebSocket services are stubbed; auth and database are real.
import { after, test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

// Build inside node_modules so emitted ESM resolves the workspace protocol.
const output = mkdtempSync(resolve("node_modules/.platform-security-"));
writeFileSync(resolve(output, "package.json"), JSON.stringify({ type: "module" }));
after(() => rmSync(output, { recursive: true, force: true }));
execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "packages/platform/tsconfig.json", "--noEmit", "false", "--outDir", output]);
const { Db } = await import(pathToFileURL(resolve(output, "db.js")));
const { HubDO } = await import(pathToFileURL(resolve(output, "hub-do.js")));

async function fixture(t) {
  const sqlite = new DatabaseSync(":memory:");
  t.after(() => sqlite.close());
  const sql = { exec(query, ...args) {
    if (!args.length && query.includes("CREATE TABLE")) { sqlite.exec(query); return { toArray: () => [] }; }
    const rows = sqlite.prepare(query).all(...args);
    return { toArray: () => rows };
  } };
  const db = new Db(sql);
  db.init();
  db.init(); // additive schema is safe on a DO restart
  const kv = new Map();
  const hub = Object.create(HubDO.prototype);
  hub.db = db;
  hub.env = { RATE_LIMIT: "off" };
  hub.ctx = { getWebSockets: () => [], storage: {
    get: async (key) => kv.get(key), put: async (key, value) => kv.set(key, value),
    transactionSync(fn) {
      sqlite.exec("BEGIN");
      try { const result = fn(); sqlite.exec("COMMIT"); return result; }
      catch (err) { sqlite.exec("ROLLBACK"); throw err; }
    },
  } };
  const account = async (name) => {
    const result = await db.createAccount({ username: name, email: `${name}@example.test`, password: "fixture-password" });
    const id = result.account.account_id;
    const agent = db.registerAgent({ account_id: id, grant_scope_id: `scope-${name}`, public_key: `key-${name}`, display_name: name });
    const human = db.ensureHumanAgent(id);
    return { id, key: result.apiKey, agent: agent.agent_id, human: human.agent_id };
  };
  const a = await account("alice"); const b = await account("bob");
  const request = (path, body, key = a.key) => hub.fetch(new Request(`http://security.test${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
  const pull = async (key = a.key) => (await request("/console/sync/pull?since=0", undefined, key)).json();
  const seedMessage = (m) => db.insertMessage({ v: "0.1", id: m.message_id, type: "sms", from: m.from_agent, to: m.to_agent,
    ts: m.created_at, payload: { body: m.body }, sig: null }, { fromNick: null, toNick: null, accountScope: null });
  return { sqlite, db, a, b, request, pull, seedMessage };
}
const message = (id, from, to) => ({ message_id: id, from_agent: from, to_agent: to, body: `body-${id}`,
  attachments: [{ file_id: "fixture-file", name: "note.txt", mime: "text/plain", size: 1 }],
  created_at: "2026-09-01T00:00:00.000Z", created_ms: 1788220800000, delivered_at: null, read_at: null, agent_read_at: null });
const call = (id, from, to) => ({ call_id: id, caller: from, callee: to, state: "ended",
  started_ms: 1788220800000, answered_ms: 1788220800100, ended_ms: 1788220800200,
  frames: [{ frame_id: `frame-${id}`, from_agent: from, body: "hello", attachments: null, created_ms: 1788220800100 }] });
const expectStatus = async (promise, expected) => {
  const res = await promise; const body = await res.json();
  assert.equal(res.status, expected, JSON.stringify(body));
  return body;
};

test("platform registration is owner/key bound and cannot claim unowned identities", async (t) => {
  const { db, a, b, request } = await fixture(t);
  const input = { grant_scope_id: "scope-bob", public_key: "key-bob", display_name: "changed", nickname: "stolen" };
  for (const key of [a.key, null, "invalid-key"]) {
    await expectStatus(request("/register", input, key), key === a.key ? 403 : 401);
    assert.equal(db.getAgent(b.agent).account_id, b.id);
    assert.equal(db.getAgent(b.agent).display_name, "bob");
    assert.equal(db.speakingNickname(b.agent), null);
  }
  await expectStatus(request("/register", { ...input, public_key: "replacement-key" }, b.key), 403);
  const same = await expectStatus(request("/register", input, b.key), 200);
  assert.equal(same.agent_id, b.agent);
  assert.equal(db.getAgent(b.agent).display_name, "changed");
  assert.equal(db.getAgent(b.agent).public_key, "key-bob");
  const orphan = db.registerAgent({ grant_scope_id: "legacy-unowned", public_key: "public-orphan-key" });
  await expectStatus(request("/register", { grant_scope_id: "legacy-unowned", public_key: "public-orphan-key" }), 403);
  assert.equal(db.getAgent(orphan.agent_id).account_id, null);
  assert.throws(() => db.registerAgent({ account_id: a.id, ...input }), /enrolled owner/);
  const fresh = await expectStatus(request("/register", { grant_scope_id: "fresh", public_key: "fresh-key" }), 200);
  assert.equal(db.getAgent(fresh.agent_id).account_id, a.id);
});

test("sync rejects foreign and malformed message batches before any import", async (t) => {
  const { db, a, b, request, pull } = await fixture(t);
  const good = message("good", a.human, a.agent);
  const foreign = message("foreign", b.human, b.agent);
  await expectStatus(request("/console/sync/messages", { messages: [good, foreign] }), 403);
  assert.deepEqual((await pull()).messages, []);
  assert.deepEqual((await pull(b.key)).messages, []);
  for (const bad of [null, {}, { ...good, created_ms: "wrong" }, { ...good, to_agent: [] }]) {
    await expectStatus(request("/console/sync/messages", { messages: [good, bad] }), 400);
    assert.deepEqual((await pull()).messages, []);
  }
  await expectStatus(request("/console/sync/messages", { messages: [good] }, null), 401);
  assert.deepEqual(db.undeliveredFor(a.agent), []);
});

test("messages with external peers stay private and cannot enter live delivery or reserve IDs", async (t) => {
  const { db, a, b, request, pull, seedMessage } = await fixture(t);
  const rows = [message("out", a.human, b.agent), message("in", b.agent, a.human), message("local", a.human, "local-only-peer")];
  await expectStatus(request("/console/sync/messages", { messages: rows.map((m) => ({ ...m, account_scope: b.id })) }), 200);
  const mirrored = (await pull()).messages;
  assert.equal(mirrored.length, 3);
  assert.equal(mirrored[0].account_scope, a.id);
  assert.deepEqual(mirrored[0].attachments, rows[0].attachments);
  assert.deepEqual((await pull(b.key)).messages, []);
  assert.deepEqual(db.undeliveredFor(b.agent), []);
  assert.deepEqual(db.undeliveredFor(a.human), []);
  assert.deepEqual(db.messagesForScope([a.human], 0), [], "connector/live reads exclude imports");
  const threads = await expectStatus(request("/console/threads"), 200);
  assert.ok(threads.threads.some((x) => x.peer_id === b.agent));
  assert.deepEqual(db.threadsFor(b.agent), []);
  const thread = await expectStatus(request(`/console/thread/${b.agent}`), 200);
  assert.equal(thread.messages.length, 2);
  assert.equal(db.unreadMessageCount(a.human), 0, "opening own thread marks mirror read");
  await expectStatus(request("/console/sync/messages", { messages: [{ ...rows[0], body: "edited" }] }), 200);
  assert.equal((await pull()).messages.find((m) => m.message_id === "out").body, "body-out");
  seedMessage({ ...rows[0], body: "authoritative live body" });
  assert.equal(db.undeliveredFor(b.agent)[0].payload.body, "authoritative live body");
  assert.equal((await pull()).messages.find((m) => m.message_id === "out").body, "authoritative live body");
  assert.equal((await pull(b.key)).messages[0].body, "authoritative live body");
});

test("read markers require recipient ownership and reject mixed batches atomically", async (t) => {
  const { db, a, b, request, pull, seedMessage } = await fixture(t);
  seedMessage(message("mine", b.agent, a.agent));
  seedMessage(message("theirs", a.agent, b.agent));
  await expectStatus(request("/console/messages/agent-read", { message_ids: ["mine", "theirs"] }), 403);
  assert.equal((await pull()).messages.find((m) => m.message_id === "mine").agent_read_at, null);
  const marked = await expectStatus(request("/console/messages/agent-read", { message_ids: ["mine", "missing", "mine"] }), 200);
  assert.equal(marked.marked, 1);
  assert.ok((await pull()).messages.find((m) => m.message_id === "mine").agent_read_at);
  assert.equal((await pull(b.key)).messages.find((m) => m.message_id === "theirs").agent_read_at, null);
  await expectStatus(request("/console/messages/agent-read", { message_ids: ["theirs"] }, b.key), 200);
  await expectStatus(request("/console/messages/agent-read", { message_ids: ["mine", 42] }), 400);
  await expectStatus(request("/console/messages/agent-read", { message_ids: ["mine"] }, null), 401);
  await expectStatus(request("/console/sync/messages", { messages: [message("mirror", b.agent, a.agent)] }), 200);
  await expectStatus(request("/console/messages/agent-read", { message_ids: ["mirror"] }), 200);
  assert.ok((await pull()).messages.find((m) => m.message_id === "mirror").agent_read_at);
  assert.deepEqual(db.undeliveredFor(a.human), []);
});

test("calls and frames are private, validate all parties, and cannot mutate live calls", async (t) => {
  const { sqlite, db, a, b, request, pull } = await fixture(t);
  const good = call("private-call", a.human, b.agent);
  const foreign = call("foreign-call", b.human, b.agent);
  await expectStatus(request("/console/sync/calls", { calls: [good, foreign] }), 403);
  assert.deepEqual((await pull()).calls, []);
  await expectStatus(request("/console/sync/calls", { calls: [good, { ...good, call_id: "bad-frame", frames: [{ ...good.frames[0], from_agent: b.human }] }] }), 403);
  await expectStatus(request("/console/sync/calls", { calls: [good, { ...good, frames: [null] }] }), 400);
  assert.deepEqual((await pull()).calls, []);
  await expectStatus(request("/console/sync/calls", { calls: [good] }), 200);
  assert.equal((await pull()).calls[0].frames[0].frame_id, good.frames[0].frame_id);
  assert.deepEqual((await pull(b.key)).calls, []);
  assert.equal(db.getCall(good.call_id), undefined);
  assert.equal(db.latestOpenCallFor(b.agent), undefined);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM call_frames").get().n, 0);
  const thread = await expectStatus(request(`/console/thread/${b.agent}`), 200);
  assert.equal(thread.items[0].frames[0].body, "hello");
  const calls = await expectStatus(request("/console/calls?withFrames=1"), 200);
  assert.equal(calls.calls[0].frames[0].body, "hello");
  db.upsertCallInvite({ ...good, caller_nick: null, callee_nick: null });
  db.insertCallFrame({ frame_id: good.frames[0].frame_id, call_id: good.call_id, from_agent: b.agent, body: "live", attachments: null, created_ms: good.started_ms });
  await expectStatus(request("/console/sync/calls", { calls: [{ ...good, frames: [{ ...good.frames[0], frame_id: "new-forged-frame" }] }] }), 200);
  assert.deepEqual(db.callFrames(good.call_id).map((f) => f.body), ["live"]);
  assert.equal((await pull()).calls[0].state, "ringing");
  assert.equal((await pull()).calls[0].frames[0].body, "live");
});

test("sync transaction rolls back an unexpected database failure", async (t) => {
  const { sqlite, a, request, pull } = await fixture(t);
  sqlite.exec("CREATE TRIGGER fail_import BEFORE INSERT ON sync_history WHEN NEW.record_id = 'fail' BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  await expectStatus(request("/console/sync/messages", { messages: [message("ok", a.human, a.agent), message("fail", a.human, a.agent)] }), 400);
  assert.deepEqual((await pull()).messages, []);
});

test("sidecar forwards only receipts for its exposed recipients", async (t) => {
  const { HubHistory } = await import("../packages/hub/dist/history.js");
  const { SyncEngine } = await import("../packages/sidecar/dist/sync.js");
  const dir = mkdtempSync(resolve(output, "history-"));
  const history = new HubHistory(dir);
  for (const [id, from, to] of [["mine", "remote", "local-agent"], ["theirs", "local-agent", "remote"], ["unexposed", "local-agent", "local-only"]]) {
    history.putMessageRow({ ...message(id, from, to), agent_read_at: new Date().toISOString() });
  }
  const receipts = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    if (String(url).endsWith("/messages/agent-read")) receipts.push(JSON.parse(options.body).message_ids);
    return Response.json({ ok: true, messages: [], calls: [], now: Date.now() });
  });
  const sync = new SyncEngine(history, dir, async () => ({
    endpoint: "ws://local-platform.test", apiKey: "fixture-key",
    localHumanId: "local-human", platformHumanId: "platform-human",
    localToPlatform: new Map([["local-agent", "platform-agent"]]),
    platformToLocal: new Map([["platform-agent", "local-agent"]]),
    platformIdToNickname: new Map(), nicknameToPlatformId: new Map(),
  }));
  await sync.syncOnce();
  assert.deepEqual(receipts, [["mine"]]);
});
