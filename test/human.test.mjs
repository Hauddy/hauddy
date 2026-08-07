// Human messaging (spec §"human messaging"): a person messages/calls agents from
// the app/web via the hub's HTTP console — a virtual client. The human is a real
// agent record driven over HTTP, so SMS and calls reuse the same routing/consent
// an agent gets. Here: SMS round-trip and a live call, both against the platform
// console (Bearer), with a WS agent standing in for the other party.
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { startHub } from "../packages/hub/dist/index.js";
import { mintGrantScopeId, mintMessageId, nowIso } from "../packages/protocol/dist/index.js";

let hub, dataDir, acct, bot, ws;
const delivers = []; // envelopes the agent received

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-human-test-"));
  hub = await startHub({ port: 0, dataDir }); // platform (consent mode)

  acct = await post("/accounts", { username: "meuser", email: "me@x", password: "pw123456" }); // human nick derives to @me
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const gs = mintGrantScopeId();
  const reg = await post(
    "/register",
    { grant_scope_id: gs, public_key: publicKey.export({ type: "spki", format: "pem" }).toString(), nickname: "bot" },
    acct.api_key,
  );
  bot = { agentId: reg.agent_id, gs, privateKey };

  // The agent's live session: collect delivered envelopes (ack them).
  ws = new WebSocket(hub.wsUrl);
  await new Promise((resolve) => {
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      if (msg.type === "auth_challenge") {
        ws.send(JSON.stringify({ type: "auth_response", signature: sign(null, Buffer.from(msg.nonce, "base64url"), bot.privateKey).toString("base64url") }));
      } else if (msg.type === "auth_ok") {
        resolve();
      } else if (msg.type === "deliver") {
        delivers.push(msg.envelope);
        ws.send(JSON.stringify({ type: "ack", id: msg.envelope.id }));
      }
    });
    ws.on("open", () => ws.send(JSON.stringify({ type: "auth_hello", agent_id: bot.agentId, grant_scope_id: bot.gs })));
  });
});
after(async () => {
  ws?.close();
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

const post = (p, body, key) =>
  fetch(hub.httpUrl + p, {
    method: "POST",
    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json());
const getC = (p) => fetch(hub.httpUrl + p, { headers: { authorization: `Bearer ${acct.api_key}` } }).then((r) => r.json());
const postC = (p, body) => post(p, body, acct.api_key);
const agentSend = (to, payload) => ws.send(JSON.stringify({ type: "send", envelope: { v: "0.1", id: mintMessageId(), type: "sms", from: bot.agentId, to, ts: nowIso(), payload, sig: null } }));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred, tries = 40) {
  for (let i = 0; i < tries; i++) {
    const hit = pred();
    if (hit) return hit;
    await wait(25);
  }
  return null;
}

test("human → agent SMS delivers; the agent's reply lands in the console inbox", async () => {
  delivers.length = 0;
  const sent = await postC("/console/sms", { to: "@bot", body: "hello bot" });
  assert.equal(sent.status, "delivered");

  const got = await waitFor(() => delivers.find((e) => e.payload.body === "hello bot"));
  assert.ok(got, "agent received the human's message");
  assert.equal(got.to, bot.agentId);

  // Agent replies to @me (the human handle derived from the account email).
  agentSend("@me", { body: "hi, I'm the bot" });
  const inbox = await waitFor(async () => {
    const r = await getC("/console/inbox");
    return r.messages.length ? r : null;
  });
  assert.ok(inbox.messages.some((m) => m.payload.body === "hi, I'm the bot"), "reply reached the console inbox");
});

test("human ↔ agent live call: place → agent frames → say → hangup", async () => {
  delivers.length = 0;
  const placed = await postC("/console/call", { to: "@bot" });
  assert.equal(placed.status, "ringing");
  const callId = placed.call_id;

  // Agent gets the invite, then speaks a line on the call.
  const invite = await waitFor(() => delivers.find((e) => e.payload.call?.kind === "invite" && e.payload.call.id === callId));
  assert.ok(invite, "agent was rung");
  agentSend("@me", { call: { id: callId, kind: "frame" }, body: "bot speaking" });

  // The human polls and hears the agent's line.
  const heard = await waitFor(async () => {
    const r = await getC("/console/call/poll");
    return r.frames.find((f) => f.body === "bot speaking") ? r : null;
  });
  assert.ok(heard, "human heard the agent on the call");

  // Human speaks back; the agent receives it on the same call.
  await postC("/console/call/say", { text: "hi bot, human here" });
  const back = await waitFor(() => delivers.find((e) => e.payload.call?.kind === "frame" && e.payload.body === "hi bot, human here"));
  assert.ok(back, "agent received the human's spoken line");

  // Agent hangs up → the human's next poll reports the call ended.
  agentSend("@me", { call: { id: callId, kind: "close" } });
  const ended = await waitFor(async () => {
    const r = await getC("/console/call/poll");
    return r.ended ? r : null;
  });
  assert.ok(ended, "human saw the call end");
});

test("the human shows online + call-capable in presence once operated", async () => {
  const me = await getC("/console/identity");
  assert.equal(me.kind, "human");
  assert.equal(me.nickname, "@me");
  const presence = await fetch(hub.httpUrl + `/presence/${me.agent_id}`).then((r) => r.json());
  assert.equal(presence.state, "online");
  assert.ok(presence.capabilities.includes("call"), "a console human advertises the call capability");
});
