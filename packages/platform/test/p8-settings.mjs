// P8 account-settings integration test — runs against a live `wrangler dev`.
// Covers the Settings screen's backend: profile (username) update + password
// change (verify-current-then-set), and that both take effect at login. Usage:
//   wrangler dev -c packages/platform/wrangler.toml --port 8787 --var RATE_LIMIT:off
//   node packages/platform/test/p8-settings.mjs http://localhost:8787
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:8787";
const post = (p, body, key) =>
  fetch(base + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (p, key) => fetch(base + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

let passed = 0;
const check = (name, cond) => {
  assert.ok(cond, name);
  passed++;
  console.log("  ✓", name);
};

const tag = Math.random().toString(36).slice(2, 8);
async function account(name) {
  const acct = await post("/accounts", {
    username: `${name}${tag}`,
    email: `${name}-${tag}@x.test`,
    password: "pw123456",
  });
  assert.ok(acct.api_key, `signup ${name} returned a key`);
  return { key: acct.api_key, accountId: acct.account_id, username: `${name}${tag}` };
}

const pem = () => generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }).toString();
const register = (acct, gs) => post("/register", { grant_scope_id: `gs_${gs}_${tag}`, public_key: pem() }, acct.key);

console.log("P8 account settings @", base);

const A = await account("sam");
const B = await account("sue");

// ── profile: rename username == rebind the user @handle ──────────────────────
const newName = `samx${tag}`;
const p1 = await post("/accounts/profile", { username: newName }, A.key);
check("A renames its username", p1.username === newName);
check("the response echoes the rebound @handle", p1.human?.nickname === `@${newName}`);
const meA = await get("/accounts/me", A.key);
check("/accounts/me reflects the new username", meA.username === newName);
check("/accounts/me.human is the user @handle (== username)", meA.human?.nickname === `@${newName}`);

// idempotent: re-setting to your own current username is allowed (self-match)
const pSame = await post("/accounts/profile", { username: newName }, A.key);
check("renaming to your own current username is allowed", pSame.username === newName);

// ── profile validation + uniqueness ─────────────────────────────────────────
const pShort = await post("/accounts/profile", { username: "x" }, A.key);
check("too-short username rejected (400)", !!pShort.error && !pShort.username);
const pChars = await post("/accounts/profile", { username: "bad name!" }, A.key);
check("username with invalid chars rejected", !!pChars.error && !pChars.username);
const pTaken = await post("/accounts/profile", { username: newName }, B.key);
check("username taken by another account rejected (409)", !!pTaken.error && !pTaken.username);
const meB = await get("/accounts/me", B.key);
check("B's username is unchanged after the failed rename", meB.username === B.username);
const pUnauth = await post("/accounts/profile", { username: `nope${tag}` });
check("unauthed profile update rejected", !pUnauth.username);

// ── handle uniqueness: a username whose @handle is taken by ANOTHER account's
//    agent (not an account username) is rejected, and the username is untouched ──
const bAgent = await register(B, "sueagent");
const takenHandle = `held${tag}`;
const bindOk = await post(`/agents/${bAgent.agent_id}/nickname`, { nickname: takenHandle }, B.key);
check("B binds an agent handle", bindOk.ok === true);
const clash = await post("/accounts/profile", { username: takenHandle }, A.key);
check("username whose @handle is taken → rejected (409)", !!clash.error && !clash.human);
const meAClash = await get("/accounts/me", A.key);
check("A's username + handle unchanged after the clash", meAClash.username === newName && meAClash.human?.nickname === `@${newName}`);

// the renamed account logs in under the new username
const loginNew = await post("/accounts/login", { login: newName, password: "pw123456" });
check("can log in with the new username", !!loginNew.api_key);

// ── bio: set + clear, round-trips on /accounts/me.human.description ──────────
const bioSet = await post("/accounts/profile", { bio: "runs the show" }, A.key);
check("setting a bio returns it on the human", bioSet.human?.description === "runs the show");
const meBio = await get("/accounts/me", A.key);
check("/accounts/me.human.description reflects the bio", meBio.human?.description === "runs the show");
check("setting only a bio leaves the username intact", meBio.username === newName);
const bioClear = await post("/accounts/profile", { bio: "" }, A.key);
check("bio can be cleared", (bioClear.human?.description ?? "") === "");

// ── password change: gated on the current password ──────────────────────────
const pwWrong = await post("/accounts/password", { current: "wrongpw", next: "newpw123" }, A.key);
check("wrong current password → error, not ok (and not a 401 sign-out)", !!pwWrong.error && pwWrong.ok !== true);
// the key still works after a wrong-password attempt (403, not 401)
const meStill = await get("/accounts/me", A.key);
check("API key still valid after a wrong-current-password attempt", meStill.username === newName);

const pwShort = await post("/accounts/password", { current: "pw123456", next: "short" }, A.key);
check("too-short new password rejected", !!pwShort.error && pwShort.ok !== true);

const pwOk = await post("/accounts/password", { current: "pw123456", next: "newpw123" }, A.key);
check("password changed with the correct current password", pwOk.ok === true);

// the change takes effect at login: old fails, new works
const loginOld = await post("/accounts/login", { login: newName, password: "pw123456" });
check("old password no longer logs in", !loginOld.api_key);
const loginNewPw = await post("/accounts/login", { login: newName, password: "newpw123" });
check("new password logs in", !!loginNewPw.api_key);

const pwUnauth = await post("/accounts/password", { current: "newpw123", next: "another123" });
check("unauthed password change rejected", pwUnauth.ok !== true);

console.log(`\nP8: ${passed} checks passed ✅`);
