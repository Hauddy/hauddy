// The "go online" tier: an app connects to a platform (account), exposes a
// local agent's identity onto it (register under the account + a globally-unique
// nickname), and can unexpose it. Exercised against a standalone hub in the
// platform's consent mode (autoLink off) via its HTTP control surface.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId } from "../packages/protocol/dist/index.js";

let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-platform-test-"));
  hub = await startHub({ port: 0, dataDir }); // no autoLink → the platform's global tier
});
after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const BASE = () => hub.httpUrl;
const pub = () =>
  generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const post = (path, body, key) =>
  fetch(BASE() + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const getMe = (key) =>
  fetch(BASE() + "/accounts/me", { headers: { authorization: `Bearer ${key}` } }).then((r) => r.json());
let _u = 0;
const signup = (email) => post("/accounts", { username: `usr${_u++}`, email, password: "pw123456" });

test("create account → expose an agent → it shows on /accounts/me with its nickname", async () => {
  const acct = await signup("dev@local");
  assert.ok(acct.api_key, "account issues an api key");
  assert.match(acct.masked, /••••/);

  const gs = mintGrantScopeId();
  const reg = await post("/register", { grant_scope_id: gs, public_key: pub(), nickname: "nabu", local_id: "nabu-main" }, acct.api_key);
  assert.ok(reg.agent_id);
  assert.equal(reg.nickname, "@nabu", "nickname bound globally on the platform");

  const me = await getMe(acct.api_key);
  assert.equal(me.agents.length, 1);
  assert.equal(me.agents[0].grant_scope_id, gs);
  assert.equal(me.agents[0].nickname, "@nabu");
  assert.ok(me.agents[0].public_key.includes("PUBLIC KEY"), "agentView carries public_key (needed to expose)");
});

test("a globally-taken nickname can't be bound by another account's agent", async () => {
  const other = await signup("other@local");
  const reg = await post("/register", { grant_scope_id: mintGrantScopeId(), public_key: pub(), nickname: "nabu" }, other.api_key);
  assert.ok(reg.agent_id, "the agent still registers");
  assert.equal(reg.nickname, null, "but the taken @nabu is not bound to it");
});

test("register is idempotent by grant_scope_id (re-expose doesn't duplicate)", async () => {
  const acct = await signup("idem@local");
  const gs = mintGrantScopeId();
  const a = await post("/register", { grant_scope_id: gs, public_key: pub(), nickname: "solo" }, acct.api_key);
  const b = await post("/register", { grant_scope_id: gs, public_key: pub(), nickname: "solo" }, acct.api_key);
  assert.equal(a.agent_id, b.agent_id, "same grant scope → same platform agent");
  assert.equal((await getMe(acct.api_key)).agents.length, 1);
});

test("unexpose removes the agent (and frees its nickname)", async () => {
  const acct = await signup("un@local");
  const reg = await post("/register", { grant_scope_id: mintGrantScopeId(), public_key: pub(), nickname: "gone" }, acct.api_key);
  assert.equal((await getMe(acct.api_key)).agents.length, 1);

  const res = await post(`/accounts/agents/${reg.agent_id}/remove`, {}, acct.api_key);
  assert.deepEqual(res, { ok: true });
  assert.equal((await getMe(acct.api_key)).agents.length, 0, "agent gone from the account");

  // Its nickname is free again for someone else.
  const acct2 = await signup("reuse@local");
  const reg2 = await post("/register", { grant_scope_id: mintGrantScopeId(), public_key: pub(), nickname: "gone" }, acct2.api_key);
  assert.equal(reg2.nickname, "@gone", "freed nickname is bindable again");
});

test("CORS: the hub answers browser preflight + tags responses (dashboard runs cross-origin)", async () => {
  const preflight = await fetch(BASE() + "/accounts/me", { method: "OPTIONS" });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-headers") ?? "", /authorization/i);
  const got = await fetch(BASE() + "/agents");
  assert.equal(got.headers.get("access-control-allow-origin"), "*");
});

test("unexpose refuses another account's agent", async () => {
  const mine = await signup("mine@local");
  const yours = await signup("yours@local");
  const reg = await post("/register", { grant_scope_id: mintGrantScopeId(), public_key: pub(), nickname: "prot" }, mine.api_key);
  const res = await post(`/accounts/agents/${reg.agent_id}/remove`, {}, yours.api_key);
  assert.equal(res.ok, false, "not your agent");
  assert.equal((await getMe(mine.api_key)).agents.length, 1, "still there");
});

// ---- registration flow: signup on the platform, log in with a password ----

test("signup requires username + email + password, and issues a working key", async () => {
  assert.match((await post("/accounts", { email: "x@y.z", password: "secret1" })).error, /username/);
  assert.match((await post("/accounts", { username: "ok", email: "x@y.z", password: "secret1" })).error, /username must/); // too short
  assert.match((await post("/accounts", { username: "gina", email: "bad", password: "secret1" })).error, /email/);
  assert.match((await post("/accounts", { username: "gina", email: "g@y.z", password: "123" })).error, /password/);

  const acct = await post("/accounts", { username: "gina", email: "gina@y.z", password: "secret1" });
  assert.ok(acct.api_key?.startsWith("sk_live_"));
  assert.equal(acct.username, "gina");
  const me = await getMe(acct.api_key);
  assert.equal(me.email, "gina@y.z");
  assert.equal(me.username, "gina");
});

test("username and email are unique", async () => {
  await post("/accounts", { username: "dup", email: "dup@y.z", password: "secret1" });
  assert.match((await post("/accounts", { username: "dup", email: "other@y.z", password: "secret1" })).error, /taken/);
  assert.match((await post("/accounts", { username: "dup2", email: "dup@y.z", password: "secret1" })).error, /already exists/);
});

test("login by username or email returns the same stable key; wrong password 401s", async () => {
  const acct = await post("/accounts", { username: "leo", email: "leo@y.z", password: "hunter2x" });
  const byUser = await post("/accounts/login", { login: "leo", password: "hunter2x" });
  assert.equal(byUser.api_key, acct.api_key, "login returns the same stable key");
  const byEmail = await post("/accounts/login", { login: "leo@y.z", password: "hunter2x" });
  assert.equal(byEmail.api_key, acct.api_key, "email login works too");
  // The returned key actually authenticates.
  assert.equal((await getMe(byUser.api_key)).username, "leo");
  // Wrong password.
  const bad = await fetch(BASE() + "/accounts/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "leo", password: "nope" }) });
  assert.equal(bad.status, 401);
});

test("rotate issues a new key that supersedes the old; the login then returns the new one", async () => {
  const acct = await post("/accounts", { username: "mia", email: "mia@y.z", password: "secret1" });
  const rotated = await post("/accounts/rotate", {}, acct.api_key);
  assert.ok(rotated.api_key && rotated.api_key !== acct.api_key);
  assert.equal((await post("/accounts/login", { login: "mia", password: "secret1" })).api_key, rotated.api_key);
  // Old key no longer authenticates.
  const old = await fetch(BASE() + "/accounts/me", { headers: { authorization: `Bearer ${acct.api_key}` } });
  assert.equal(old.status, 401);
});

// ---- launch hardening: invite gate, rate limit, CORS pin -------------------
// These spin up their own isolated hubs so they can set per-hub options.

const postTo = (base, p, body, key) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  });
const withHub = async (opts, fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), "hauddy-hardening-"));
  const h = await startHub({ port: 0, dataDir: dir, ...opts });
  try {
    await fn(h, dir);
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
};

test("invite gate: an allowlist file restricts signup to listed emails, hot-editable", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "hauddy-allow-"));
  const allowlist = path.join(dir, "allow.txt");
  // Comments + blank lines are ignored; matching is case-insensitive.
  writeFileSync(allowlist, "# alpha invites\n\nInvited@X.Z\n");
  const h = await startHub({ port: 0, dataDir: dir, allowlistFile: allowlist });
  try {
    const listed = await postTo(h.httpUrl, "/accounts", { username: "yes", email: "invited@x.z", password: "secret1" });
    assert.equal(listed.status, 200, "a listed email may sign up");
    const blocked = await postTo(h.httpUrl, "/accounts", { username: "nope", email: "stranger@x.z", password: "secret1" });
    assert.equal(blocked.status, 403, "an unlisted email is refused");
    assert.match((await blocked.json()).error, /invite list/);
    // The list is re-read per request — add an email and it works with no restart.
    appendFileSync(allowlist, "later@x.z\n");
    const nowOk = await postTo(h.httpUrl, "/accounts", { username: "later", email: "later@x.z", password: "secret1" });
    assert.equal(nowOk.status, 200, "a freshly-added email is accepted without a restart");
  } finally {
    await h.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("no allowlist file ⇒ signup stays open", async () => {
  await withHub({}, async (h) => {
    const res = await postTo(h.httpUrl, "/accounts", { username: "open", email: "anyone@x.z", password: "secret1" });
    assert.equal(res.status, 200);
  });
});

test("rate limiter blocks brute-forcing the login endpoint once enabled", async () => {
  await withHub({ rateLimit: true }, async (h) => {
    let sawLimit = false;
    // Limit is 10 / 15min; the 11th attempt from one IP should be throttled.
    for (let i = 0; i < 12; i++) {
      const res = await postTo(h.httpUrl, "/accounts/login", { login: "ghost", password: "nope" });
      if (res.status === 429) {
        sawLimit = true;
        break;
      }
      assert.equal(res.status, 401, "attempts under the limit fail auth, not rate");
    }
    assert.ok(sawLimit, "the limiter kicks in within the window");
  });
});

test("CORS origin can be pinned to the dashboard instead of *", async () => {
  await withHub({ allowOrigin: "https://app.hauddy.com" }, async (h) => {
    const pre = await fetch(h.httpUrl + "/accounts/me", { method: "OPTIONS" });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers.get("access-control-allow-origin"), "https://app.hauddy.com");
    assert.equal(pre.headers.get("vary"), "Origin");
  });
});
