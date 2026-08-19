// The curated contact book drives list_contacts (spec §"contacts"): when bookOf
// returns a non-null value (even empty), contacts are exactly that book with no
// fallback. bookOf returning null triggers the zero-config auto-discovery path.
// Exercised at the hub via the `bookOf` option + the /contacts/:id surface.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

let hub, dataDir;
const books = new Map(); // agentId -> bare handles, mutated per test
const ids = {};

const pub = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const register = (nickname) =>
  fetch(hub.httpUrl + "/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ grant_scope_id: mintGrantScopeId(), public_key: pub(), nickname }),
  }).then((r) => r.json());
const contactsOf = (id) => fetch(hub.httpUrl + `/contacts/${id}`).then((r) => r.json());
const nicksOf = async (id) => (await contactsOf(id)).contacts.map((c) => c.nickname).sort();

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-book-contacts-"));
  // autoLink local hub with the app's per-agent book override.
  hub = await startHub({ port: 0, dataDir, autoLink: true, bookOf: (id) => books.get(id) ?? null });
  ids.ada = (await register("ada")).agent_id;
  ids.bo = (await register("bo")).agent_id;
  ids.cy = (await register("cy")).agent_id;
});
after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("no book → auto-discovery: every other agent on the machine", async () => {
  books.delete(ids.ada);
  assert.deepEqual(await nicksOf(ids.ada), ["@bo", "@cy"]);
});

test("a curated book → contacts are exactly the book", async () => {
  books.set(ids.ada, ["bo"]); // ada's book holds only @bo
  assert.deepEqual(await nicksOf(ids.ada), ["@bo"], "cy is hidden — not in ada's book");
  // Other agents are unaffected (bookOf returns null for them → auto-discovery).
  assert.deepEqual(await nicksOf(ids.bo), ["@ada", "@cy"]);
});

test("an empty book returns no contacts (no fallback)", async () => {
  books.set(ids.ada, []);
  assert.deepEqual(await nicksOf(ids.ada), []);
});

test("book handles that don't resolve are dropped, self is never included", async () => {
  books.set(ids.ada, ["bo", "ghost", "ada"]); // ghost = unknown, ada = self
  assert.deepEqual(await nicksOf(ids.ada), ["@bo"]);
});
