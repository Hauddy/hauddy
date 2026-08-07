// Profile friendships (spec §"friends"): consent lives at the account level, not
// the agent pair. A profile requests a friend by @handle; the owner accepts (or
// auto-accepts). Once linked (allow-all), every exposed agent of one account may
// reach every exposed agent of the other — and non-friends get E_NOT_LINKED.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId, mintMessageId, nowIso } from "../packages/protocol/dist/index.js";

let hub, dataDir;
before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-friends-test-"));
  hub = await startHub({ port: 0, dataDir }); // consent mode (no autoLink) → the platform
});
after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const pub = () => generateKeyPairSync("ed25519");
const post = (p, body, key) =>
  fetch(hub.httpUrl + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const get = (p, key) => fetch(hub.httpUrl + p, { headers: key ? { authorization: `Bearer ${key}` } : {} }).then((r) => r.json());

// Create an account + expose one keypair'd agent with a nickname.
async function profile(email, nickname) {
  const acct = await post("/accounts", { username: `${nickname}acct`, email, password: "pw123456" });
  const { publicKey, privateKey } = pub();
  const gs = mintGrantScopeId();
  const reg = await post(
    "/register",
    { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname },
    acct.api_key,
  );
  return { key: acct.api_key, accountId: acct.account_id, agentId: reg.agent_id, gs, privateKey, nickname };
}

// Connect a WS session for an agent, resolving once authenticated.
function connect(a) {
  const ws = new WebSocket(hub.wsUrl);
  return new Promise((resolve) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_challenge") {
        ws.send(JSON.stringify({ type: "auth_response", signature: sign(null, Buffer.from(msg.nonce, "base64url"), a.privateKey).toString("base64url") }));
      } else if (msg.type === "auth_ok") {
        resolve(ws);
      }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: a.agentId, grant_scope_id: a.gs })));
  });
}

// Send from an authenticated socket, resolving with the receipt or the error.
function sendSms(ws, fromId, to, body) {
  const id = mintMessageId();
  return new Promise((resolve) => {
    const onMsg = (data) => {
      const msg = JSON.parse(data.toString());
      if ((msg.type === "receipt" && msg.id === id) || (msg.type === "error" && msg.ref === id)) {
        ws.off("message", onMsg);
        resolve(msg);
      }
    };
    ws.on("message", onMsg);
    ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id, type: "sms", from: fromId, to, ts: nowIso(), payload: { body }, sig: null } }));
  });
}

test("non-friends can't message; request → accept links them (allow-all)", async () => {
  const A = await profile("a@x", "alice");
  const B = await profile("b@x", "bob");
  const aws = await connect(A);
  const bws = await connect(B);

  // Strangers: A→B is refused.
  const denied = await sendSms(aws, A.agentId, "@bob", "hi");
  assert.equal(denied.type, "error");
  assert.equal(denied.code, "E_NOT_LINKED");

  // A requests friendship with @bob; it's pending, still not linked.
  assert.equal((await post("/accounts/friends/request", { handle: "@bob" }, A.key)).state, "pending");
  assert.equal((await sendSms(aws, A.agentId, "@bob", "hi")).type, "error");

  // B sees the incoming request and accepts.
  const bFriends = await get("/accounts/friends", B.key);
  assert.equal(bFriends.incoming.length, 1);
  assert.equal(bFriends.incoming[0].account_id, A.accountId);
  assert.equal((await post("/accounts/friends/respond", { account_id: A.accountId, accept: true }, B.key)).state, "linked");

  // Now A→B delivers (allow-all), and each sees the other's agent as a contact.
  const ok = await sendSms(aws, A.agentId, "@bob", "hi now");
  assert.equal(ok.type, "receipt");
  assert.equal(ok.status, "delivered");
  const aContacts = await get(`/contacts/${A.agentId}`);
  assert.ok(aContacts.contacts.some((c) => c.nickname === "@bob"), "bob is now a contact of alice");

  aws.close();
  bws.close();
});

test("auto-accept links an incoming request immediately", async () => {
  const C = await profile("c@x", "carol");
  const D = await profile("d@x", "dave");
  await post("/accounts/settings", { auto_accept: true }, C.key);

  // D requests carol → links right away because carol auto-accepts.
  assert.equal((await post("/accounts/friends/request", { handle: "@carol" }, D.key)).state, "linked");
  const dFriends = await get("/accounts/friends", D.key);
  assert.equal(dFriends.linked.length, 1);
  assert.equal(dFriends.linked[0].account_id, C.accountId);
  assert.ok(dFriends.linked[0].agents.some((a) => a.nickname === "@carol"), "linked friend carries its agents (allow-all)");
});

test("declining a request leaves them unlinked", async () => {
  const E = await profile("e@x", "erin");
  const F = await profile("f@x", "finn");
  await post("/accounts/friends/request", { handle: "@finn" }, E.key);
  assert.equal((await post("/accounts/friends/respond", { account_id: E.accountId, accept: false }, F.key)).state, "none");
  assert.equal((await get("/accounts/friends", F.key)).linked.length, 0);
  assert.equal((await get("/accounts/friends", E.key)).outgoing.length, 0, "declined request is gone for the requester too");
});

test("a friend request to your own profile is a self no-op", async () => {
  const G = await profile("g@x", "gwen");
  assert.equal((await post("/accounts/friends/request", { handle: "@gwen" }, G.key)).state, "self");
});
