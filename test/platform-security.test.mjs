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
  const blobs = new Set();
  hub.env = { RATE_LIMIT: "off", FILES: { delete: async (key) => { blobs.delete(key); } } };
  hub.files = { sweep: async () => {} };
  hub.ctx = { getWebSockets: () => [], storage: {
    get: async (key) => kv.get(key), put: async (key, value) => kv.set(key, value),
    delete: async (key) => kv.delete(key), setAlarm: async () => {},
    list: async ({ prefix, limit, startAfter }) => new Map([...kv].filter(([k]) => k.startsWith(prefix) && (!startAfter || k > startAfter)).sort(([a], [b]) => a.localeCompare(b)).slice(0, limit)),
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
  return { sqlite, db, a, b, request, pull, seedMessage, hub, kv, blobs };
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

test('confirmed account-key revocation invalidates the old key without revoking another account', async (t) => {
  const { a, b, request } = await fixture(t);
  await expectStatus(request('/accounts/me', undefined, a.key), 200);
  assert.deepEqual(await expectStatus(request('/accounts/revoke', {}, a.key), 200), { ok: true });
  await expectStatus(request('/accounts/me', undefined, a.key), 401);
  await expectStatus(request('/accounts/revoke', {}, a.key), 401);
  await expectStatus(request('/accounts/me', undefined, b.key), 200);
});

test('platform retries with the same message ID enqueue only once and cannot cross identities', async (t) => {
  const { a, b, db, request, sqlite, hub } = await fixture(t);
  const deliver = t.mock.method(hub, 'deliverTo');
  const send = { to: a.agent, body: 'retain this message', message_id: 'retry-stable' };
  assert.equal((await expectStatus(request('/console/sms', send), 200)).status, 'queued');
  assert.equal((await expectStatus(request('/console/sms', send), 200)).status, 'queued');
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM messages WHERE message_id = ?').get(send.message_id).n, 1);
  assert.equal(deliver.mock.callCount(), 1, 'retry does not redeliver to the recipient');
  await expectStatus(request('/console/sms', { ...send, to: b.agent }, b.key), 400);
  assert.equal(db.messageReceipt(send.message_id).from_agent, a.human);
  assert.equal(sqlite.prepare('SELECT body FROM messages WHERE message_id = ?').get(send.message_id).body, send.body);
});

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

const deleteRequest = (hub, key) => hub.fetch(new Request("http://fixture.test/accounts/me", {
  method: "DELETE", headers: key ? { authorization: `Bearer ${key}` } : {},
}));

async function deletionFixture(t) {
  const f = await fixture(t);
  const { sqlite, db, a, b, seedMessage, kv, blobs } = f;
  const run = (query, ...args) => sqlite.prepare(query).run(...args);
  const conn = db.createConnector(a.id, { handle: "alice-connector", scope: ["send", "read"], label: "fixture" });
  assert.equal(conn.ok, true);
  run("INSERT INTO oauth_clients VALUES ('owned-client', 'owned', '[]', 'secret', ?, 'now')", conn.agent_id);
  run("INSERT INTO oauth_clients VALUES ('public-client', 'shared', '[]', NULL, NULL, 'now')");
  db.bindNickname(a.agent, "alice-bot", a.id);
  run("INSERT INTO reservations VALUES ('reserved', ?, 'now')", a.id);
  run("INSERT INTO agent_grants VALUES (?, ?, 'now')", a.agent, b.id);
  run("INSERT INTO agent_grants VALUES (?, ?, 'now')", b.agent, a.id);
  run("INSERT INTO agent_books VALUES (?, 'alice-bot', 'now')", b.agent);
  run("INSERT INTO agent_books VALUES (?, 'keep-book', 'now')", b.agent);
  run("INSERT INTO agent_books VALUES (?, 'bob', 'now')", a.agent);
  run("INSERT INTO contacts VALUES ('ab', ?, ?, 'linked', ?, 'now')", a.agent, b.agent, a.agent);
  run("INSERT INTO friendships VALUES ('ab', ?, ?, 'linked', ?, 'allow_all', 'now')", a.id, b.id, a.id);
  run("INSERT INTO console_sessions VALUES (?, 1)", a.human);
  seedMessage(message("owned-message", a.agent, b.agent));
  seedMessage(message("keep-message", b.human, b.agent));
  const c = call("owned-call", a.agent, b.agent);
  db.upsertCallInvite({ ...c, caller_nick: null, callee_nick: null });
  db.insertCallFrame({ ...c.frames[0], call_id: c.call_id, attachments: null });
  db.ingestMessages(a.id, [message("own-mirror", a.agent, b.agent)]);
  db.ingestMessages(b.id, [message("keep-mirror", b.agent, a.agent)]);
  for (const [id, account, owner] of [["own-file", a.id, a.agent], ["legacy-file", null, a.agent], ["keep-file", b.id, a.agent]]) {
    db.insertAttachment({ file_id: id, account_id: account, owner, name: id, mime: "text/plain", size: 1, to_ref: null, created_ms: 1, expires_ms: Date.now() + 100000 });
    blobs.add(`files/${id}`);
  }
  kv.set(`notifseen:${a.human}`, 1);
  kv.set(`ccall:${a.human}`, { callId: c.call_id });
  kv.set(`notifseen:${b.human}`, 2);
  // More than a page ensures deleted keys don't break cleanup pagination.
  for (let i = 0; i < 130; i++) kv.set(`oauthcode:${String(i).padStart(3, "0")}`, { token: conn.token });
  kv.set("oauthcode:keep", { token: "unrelated-token" });
  return { ...f, conn };
}

test("account deletion removes owned data, credentials, files and sessions without touching unrelated records", async (t) => {
  const { hub, sqlite, db, a, b, kv, blobs, conn } = await deletionFixture(t);
  let closed = false;
  let att = { agentId: a.agent };
  hub.ctx.getWebSockets = () => [{ deserializeAttachment: () => att, serializeAttachment: (next) => { att = next; }, close: () => { closed = true; } }];
  await expectStatus(deleteRequest(hub, null), 401);
  assert.ok(db.getAccount(a.id));
  await expectStatus(deleteRequest(hub, a.key), 200);
  assert.equal(db.getAccount(a.id), undefined);
  assert.ok(db.getAccount(b.id));
  assert.equal(db.authenticateAccount(a.key), null);
  assert.equal(db.authenticateConnector(conn.token), null);
  assert.equal(closed, true);
  assert.equal(att.agentId, null);
  for (const table of ["reservations", "agent_grants", "contacts", "friendships", "console_sessions", "connector_tokens", "calls", "call_frames", "account_cleanup"]) {
    assert.equal(sqlite.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n, 0, table);
  }
  assert.deepEqual(sqlite.prepare("SELECT client_id FROM oauth_clients").all().map((r) => r.client_id), ["public-client"]);
  assert.deepEqual(sqlite.prepare("SELECT handle FROM agent_books").all().map((r) => r.handle), ["keep-book"]);
  assert.deepEqual(sqlite.prepare("SELECT message_id FROM messages").all().map((r) => r.message_id), ["keep-message"]);
  assert.deepEqual(sqlite.prepare("SELECT record_id FROM sync_history").all().map((r) => r.record_id), ["keep-mirror"]);
  assert.deepEqual([...blobs], ["files/keep-file"]);
  assert.deepEqual([...kv.keys()], [`notifseen:${b.human}`, "oauthcode:keep"]);
  await expectStatus(deleteRequest(hub, a.key), 401);
});

test("account deletion rolls back SQL and its cleanup job on failure", async (t) => {
  const { hub, sqlite, db, a, kv, blobs } = await deletionFixture(t);
  const before = sqlite.prepare("SELECT COUNT(*) AS n FROM agents").get().n;
  sqlite.exec("CREATE TRIGGER fail_delete BEFORE DELETE ON accounts BEGIN SELECT RAISE(ABORT, 'fixture failure'); END");
  await expectStatus(deleteRequest(hub, a.key), 400);
  assert.ok(db.getAccount(a.id));
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM agents").get().n, before);
  assert.equal(db.pendingAccountCleanup().length, 0);
  assert.equal(blobs.size, 3);
  assert.equal(kv.size, 134);
  assert.ok(db.getAttachment("own-file"));
});

test("account cleanup survives R2 failure and retries after a database restart", async (t) => {
  const { hub, db, a, kv, blobs } = await deletionFixture(t);
  const remove = hub.env.FILES.delete;
  hub.env.FILES.delete = async () => { throw new Error("R2 unavailable"); };
  await expectStatus(deleteRequest(hub, a.key), 200);
  assert.equal(db.getAccount(a.id), undefined);
  assert.equal(db.getAttachment("own-file"), undefined, "file unavailable immediately");
  assert.equal(db.pendingAccountCleanup().length, 1);
  assert.equal(blobs.size, 3);
  let retryAt = null;
  hub.ctx.storage.setAlarm = async (at) => { retryAt = at; };
  await hub.alarm();
  assert.ok(retryAt > Date.now(), "persistent failure schedules another attempt");
  assert.equal(db.pendingAccountCleanup().length, 1);
  db.init();
  hub.env.FILES.delete = remove;
  await hub.alarm();
  assert.deepEqual([...blobs], ["files/keep-file"]);
  assert.equal(kv.size, 2);
  assert.equal(db.pendingAccountCleanup().length, 0);
  await hub.alarm(); // idempotent replay
});

test('revision sync drains all pages across restart, discovers backdated rows, and converges mutable history', async (t) => {
  const { hub, db, a, b, seedMessage } = await fixture(t);
  const { HubHistory } = await import('../packages/hub/dist/history.js');
  const { SyncEngine } = await import('../packages/sidecar/dist/sync.js');
  const dir = mkdtempSync(resolve(output, 'revisions-'));
  const history = new HubHistory(dir);
  for (let i = 0; i < 501; i++) seedMessage(message(`msg${i}`, b.agent, a.agent));
  for (let i = 0; i < 201; i++) db.upsertCallInvite({ ...call(`call${i}`, a.agent, b.agent), caller_nick: null, callee_nick: null });
  let pulls = 0;
  let failSecond = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).includes('/sync/pull') && ++pulls === 2 && failSecond) return Response.json({ error: 'offline' }, { status: 503 });
    return hub.fetch(new Request(url, options));
  });
  const ctx = async () => ({ endpoint: 'http://fixture.test', apiKey: a.key, localHumanId: 'lh', platformHumanId: a.human,
    localToPlatform: new Map([['local', a.agent], ['lh', a.human]]), platformToLocal: new Map([[a.agent, 'local'], [a.human, 'lh']]),
    platformIdToNickname: new Map(), nicknameToPlatformId: new Map() });
  await new SyncEngine(history, dir, ctx).syncOnce();
  assert.equal(history.messagesSince(new Set(['local']), 0).length, 500);
  failSecond = false;
  await new SyncEngine(history, dir, ctx).syncOnce();
  assert.equal(history.messagesSince(new Set(['local']), 0).length, 501);
  assert.equal(history.callsSince(new Set(['local']), 0).length, 201);
  const oldCursor = db.syncPage(a.id, 0, 10000).next_cursor;
  seedMessage({ ...message('backdated', b.agent, a.agent), created_ms: 1, created_at: '1970-01-01T00:00:00.001Z' });
  assert.ok(db.syncPage(a.id, oldCursor).messages.some((m) => m.message_id === 'backdated'));
  db.markAgentRead(['msg0'], [a.agent]);
  db.markCallAnswered('call0', 10);
  db.insertCallFrame({ frame_id: 'late-frame', call_id: 'call0', from_agent: a.agent, body: 'later', attachments: null, created_ms: 11 });
  db.closeCall('call0', 12, 'hangup');
  await new SyncEngine(history, dir, ctx).syncOnce();
  assert.ok(history.messageReceipt('msg0').agent_read_at);
  assert.equal(history.getCall('call0').state, 'ended');
  assert.equal(history.callFrames('call0')[0].body, 'later');
  history.upsertCallInvite({ call_id: 'local-call', caller: 'local', callee: 'only-local', caller_nick: null, callee_nick: null, started_ms: 1 });
  await new SyncEngine(history, dir, ctx).syncOnce();
  history.markCallAnswered('local-call', 2);
  history.insertCallFrame({ frame_id: 'local-frame', call_id: 'local-call', from_agent: 'local', body: 'new', attachments: null, created_ms: 3 });
  history.closeCall('local-call', 4, 'hangup');
  await new SyncEngine(history, dir, ctx).syncOnce();
  const synced = db.syncPage(a.id, 0, 10000).calls.find((c) => c.call_id === 'local-call');
  assert.equal(synced.state, 'ended');
  assert.equal(synced.frames[0].body, 'new');
  assert.equal(db.getCall('local-call'), undefined);
});

test('unified timeline pagination preserves equal-timestamp calls and messages', async (t) => {
  const { db, a, b, seedMessage, request } = await fixture(t);
  for (let i = 0; i < 61; i++) {
    seedMessage(message(`msg${i}`, a.human, b.agent));
    db.upsertCallInvite({ ...call(`call${i}`, a.human, b.agent), caller_nick: null, callee_nick: null });
  }
  let cursor = null;
  const ids = [];
  do {
    const page = await expectStatus(request(`/console/thread/${b.agent}?limit=17${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`), 200);
    assert.ok(page.items.length <= 17);
    ids.push(...page.items.map((i) => i.id ?? i.call_id));
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(ids.length, 122);
  assert.equal(new Set(ids).size, 122);
});

test('revision pull does not leak a foreign live record via a colliding private ID', async (t) => {
  const { db, a, b, seedMessage } = await fixture(t);
  db.ingestMessages(a.id, [message('collision', a.agent, 'local')]);
  seedMessage(message('collision', b.agent, b.human));
  assert.deepEqual(db.syncPage(a.id, 0).messages, []);
});

test('SDK initializes against the authenticated platform MCP implementation', async (t) => {
  const { hub, a } = await fixture(t);
  const { HauddyClient } = await import('../packages/sdk/dist/index.js');
  t.mock.method(globalThis, 'fetch', (url, opts) => hub.fetch(new Request(url, opts)));
  const sdk = new HauddyClient({ hub: 'http://fixture.test/mcp', bearerToken: a.key });
  await sdk.connect();
  const tools = await sdk.client.listTools();
  assert.ok(tools.tools.length > 0);
  await sdk.close();
});

test('desktop settings proxy uses daemon credentials, handles errors and clears account state on deletion', async (t) => {
  const { hub, a, db } = await fixture(t);
  const os = (await import('node:os')).default;
  const home = mkdtempSync(resolve(output, 'desktop-home-'));
  t.mock.method(os, 'homedir', () => home);
  const { saveAccount, loadAccount } = await import('../packages/sidecar/dist/account.js');
  const { Daemon } = await import('../packages/sidecar/dist/daemon.js');
  saveAccount({ endpoint: 'ws://settings.test', api_key: a.key });
  const daemon = new Daemon();
  t.mock.method(globalThis, 'fetch', (url, opts) => {
    assert.equal(new URL(url).hostname, 'settings.test');
    assert.equal(opts.headers.authorization, `Bearer ${a.key}`);
    return hub.fetch(new Request(url, opts));
  });
  const account = await daemon.accountSettings('get');
  assert.equal(account.email, 'alice@example.test');
  assert.equal(account.api_key, undefined);
  assert.equal((await daemon.accountSettings('profile', { bio: 'updated bio' })).ok, true);
  assert.equal((await daemon.accountSettings('get')).human.description, 'updated bio');
  await assert.rejects(daemon.accountSettings('password', { current: 'wrong', next: 'new-password' }));
  assert.equal((await daemon.accountSettings('password', { current: 'fixture-password', next: 'new-password' })).ok, true);
  assert.equal((await daemon.accountSettings('autoAccept', { auto_accept: true })).auto_accept, true);
  assert.equal((await daemon.accountSettings('delete')).ok, true);
  assert.equal(db.getAccount(a.id), undefined);
  assert.equal(loadAccount(), null);
  await assert.rejects(daemon.accountSettings('get'), /Connect your account/);
});
