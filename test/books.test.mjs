// Per-agent contact books + the profile pool. In the friendship model the pool
// is *derived* — this machine's agents ∪ your friends' agents (allow-all) — not
// hand-curated. A book is picked from that finite pool. Exercised through the
// real local-api routes with a daemon stub backed by the real ContactBookStore,
// buildPool, and resolveBookAgainstPool (HTTP contract + persistence + resolution).
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { ContactBookStore, buildPool, resolveBookAgainstPool } from "../packages/sidecar/dist/books.js";
import { startLocalApi } from "../packages/sidecar/dist/local-api.js";

let api;
let dataDir;
let store;

// This machine's agents: `nabu` attached (online), `ada` detached (delay).
const AGENTS = [
  { local_id: "nabu-main", agent_id: "A_nabu", nickname: "@nabu", nicknames: ["@nabu"], attached: true, description: "orchestrator" },
  { local_id: "ada-dev", agent_id: "A_ada", nickname: "@ada", nicknames: ["@ada"], attached: false, description: "reviewer" },
];
// A friend's agent, reachable through the relay (allow-all friendship).
const REMOTES = [{ handle: "@remotepal", online: true, description: "a friend's agent" }];
const pool = () => buildPool(AGENTS, REMOTES);
const byLocal = (id) => AGENTS.find((a) => a.local_id === id) ?? null;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-books-test-"));
  store = new ContactBookStore(dataDir);
  const daemon = {
    async listPool() {
      return pool();
    },
    async listBook(localId) {
      const agent = byLocal(localId);
      return agent ? resolveBookAgainstPool(store.list(agent.agent_id), pool()) : [];
    },
    async addContact(localId, handle) {
      const agent = byLocal(localId);
      if (!agent) return { ok: false, error: "unknown agent" };
      const res = store.add(agent.agent_id, handle);
      return res.error ? { ok: false, error: res.error } : { ok: true };
    },
    async removeContact(localId, handle) {
      const agent = byLocal(localId);
      if (agent) store.remove(agent.agent_id, handle);
    },
    async listBookable(localId) {
      const agent = byLocal(localId);
      if (!agent) return [];
      const inBook = new Set(store.list(agent.agent_id));
      const self = agent.nickname.replace(/^@+/, "");
      return pool().filter((c) => {
        const bare = c.handle.replace(/^@+/, "");
        return bare !== self && !inBook.has(bare);
      });
    },
  };
  api = await startLocalApi({ daemon, port: 0 });
});
after(async () => {
  await api.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const getBook = (id) => fetch(`${api.url}/api/agents/${id}/contacts`).then((r) => r.json());
const addContact = (id, handle) =>
  fetch(`${api.url}/api/agents/${id}/contacts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) }).then((r) => r.json());
const removeContact = (id, handle) =>
  fetch(`${api.url}/api/agents/${id}/contacts/remove`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ handle }) }).then((r) => r.json());
const getPool = () => fetch(`${api.url}/api/contacts`).then((r) => r.json());
const getBookable = (id) => fetch(`${api.url}/api/agents/${id}/bookable`).then((r) => r.json());

test("a fresh agent has an empty book", async () => {
  assert.deepEqual(await getBook("nabu-main"), []);
});

test("adding a local agent resolves it as local + present", async () => {
  assert.deepEqual(await addContact("nabu-main", "@ada"), { ok: true });
  const book = await getBook("nabu-main");
  assert.equal(book.length, 1);
  assert.equal(book[0].handle, "@ada");
  assert.equal(book[0].origin, "local");
  assert.equal(book[0].presence, "delay"); // ada is detached but reachable
  assert.equal(book[0].description, "reviewer");
});

test("adding a friend's agent resolves as network + present via the pool", async () => {
  await addContact("nabu-main", "@remotepal");
  const pal = (await getBook("nabu-main")).find((c) => c.handle === "@remotepal");
  assert.ok(pal, "expected the friend's agent in the book");
  assert.equal(pal.origin, "network");
  assert.equal(pal.presence, "online");
});

test("a handle that's neither local nor a friend resolves offline", async () => {
  await addContact("nabu-main", "stranger");
  const s = (await getBook("nabu-main")).find((c) => c.handle === "@stranger");
  assert.ok(s);
  assert.equal(s.origin, "network");
  assert.equal(s.presence, "offline");
});

test("add is idempotent and books are per-agent", async () => {
  await addContact("nabu-main", "ada");
  assert.equal((await getBook("nabu-main")).filter((c) => c.handle === "@ada").length, 1, "no duplicate");
  assert.deepEqual(await getBook("ada-dev"), []);
});

test("an online agent resolves as online", async () => {
  await addContact("ada-dev", "@nabu");
  const book = await getBook("ada-dev");
  assert.equal(book[0].handle, "@nabu");
  assert.equal(book[0].presence, "online");
  assert.equal(book[0].origin, "local");
});

test("remove drops the entry (and persists)", async () => {
  await removeContact("nabu-main", "@ada");
  assert.ok(!(await getBook("nabu-main")).some((c) => c.handle === "@ada"), "ada removed");
  const reopened = new ContactBookStore(dataDir);
  assert.ok(!reopened.list("A_nabu").includes("ada"));
  assert.ok(reopened.list("A_nabu").includes("remotepal"), "the friend contact persists");
});

test("an invalid handle is rejected", async () => {
  const res = await addContact("nabu-main", "@@@");
  assert.equal(res.ok, false);
  assert.match(res.error, /invalid/);
});

// ---- the derived pool + bookable picker ---------------------------------

test("the pool = local agents ∪ friends' agents (all non-removable)", async () => {
  const p = await getPool();
  const nabu = p.find((c) => c.handle === "@nabu");
  const pal = p.find((c) => c.handle === "@remotepal");
  assert.ok(nabu && pal, "local agent + friend agent both in the pool");
  assert.equal(nabu.origin, "local");
  assert.equal(nabu.removable, false);
  assert.equal(pal.origin, "network");
  assert.equal(pal.presence, "online");
  assert.equal(pal.removable, false, "you change the pool via Friends, not by removing handles");
});

test("bookable = pool minus the agent's own book and itself", async () => {
  const handles = (await getBookable("nabu-main")).map((c) => c.handle);
  assert.ok(handles.includes("@ada"), "ada is offerable");
  assert.ok(!handles.includes("@remotepal"), "already in nabu's book → not offered");
  assert.ok(!handles.includes("@nabu"), "an agent is never offered itself");
});

test("assigning from the pool moves it into the book, out of bookable", async () => {
  await addContact("nabu-main", "@ada");
  assert.ok((await getBook("nabu-main")).some((c) => c.handle === "@ada"), "ada now in book");
  assert.ok(!(await getBookable("nabu-main")).some((c) => c.handle === "@ada"), "ada no longer offered");
});
