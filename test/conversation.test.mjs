import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { startHub } from "../packages/hub/dist/index.js";

let hub;
let dataDir;

before(async () => {
  dataDir = mkdtempSync(path.join(tmpdir(), "hauddy-conv-test-"));
  hub = await startHub({ port: 0, dataDir, autoLink: true });
});

after(async () => {
  await hub.close();
  rmSync(dataDir, { recursive: true, force: true });
});

test("history.getConversation: stores and queries message threads with date filtering", async () => {
  const h = hub.history;
  const env1 = {
    v: "0.1",
    id: "msg_1",
    type: "sms",
    from: "agt_1",
    to: "agt_2",
    ts: "2025-01-10T10:00:00.000Z",
    payload: { body: "Hello @alice" },
    sig: null,
  };
  const env2 = {
    v: "0.1",
    id: "msg_2",
    type: "sms",
    from: "agt_2",
    to: "agt_1",
    ts: "2025-01-15T10:00:00.000Z",
    payload: { body: "Hi @bob!" },
    sig: null,
  };

  h.insertMessage(env1, { fromNick: "@bob", toNick: "@alice" });
  h.insertMessage(env2, { fromNick: "@alice", toNick: "@bob" });

  // Query conversation
  const conv = h.getConversation("agt_1", "@alice");
  assert.equal(conv.contact, "@alice");
  assert.equal(conv.messages.length, 2);
  assert.equal(conv.messages[0].body, "Hello @alice");
  assert.equal(conv.messages[1].body, "Hi @bob!");

  // Date filtering
  const convFiltered = h.getConversation("agt_1", "@alice", { from: "2025-01-12" });
  assert.equal(convFiltered.messages.length, 1);
  assert.equal(convFiltered.messages[0].body, "Hi @bob!");
});

test("history.getCallTranscript: retrieves call transcript turns by call_id", async () => {
  const h = hub.history;
  h.upsertCallInvite({
    call_id: "call_123",
    caller: "agt_1",
    callee: "agt_2",
    caller_nick: "@bob",
    callee_nick: "@alice",
    started_ms: 1700000000000,
  });

  h.insertCallFrame({
    frame_id: "frm_1",
    call_id: "call_123",
    from_agent: "agt_1",
    body: "Can you hear me?",
    attachments: null,
    created_ms: 1700000001000,
  });

  const transcript = h.getCallTranscript("call_123");
  assert.notEqual(transcript, null);
  assert.equal(transcript.call_id, "call_123");
  assert.equal(transcript.caller, "@bob");
  assert.equal(transcript.callee, "@alice");
  assert.equal(transcript.turns.length, 1);
  assert.equal(transcript.turns[0].body, "Can you hear me?");
});

test("history.callsWithPeer & /console/thread/:peer: returns unified timeline merging SMS and calls", async () => {
  const h = hub.history;
  const human = hub.store.ensureHumanAgent("acc_user", "user");
  const userAgentId = human.agent_id;
  const peerAgentId = "agt_peer";
  const t1 = 1700000000000;
  const t2 = 1700000010000;
  const t3 = 1700000020000;

  // 1. First message
  h.insertMessage(
    {
      v: "0.1",
      id: "msg_u1",
      type: "sms",
      from: userAgentId,
      to: peerAgentId,
      ts: new Date(t1).toISOString(),
      payload: { body: "Hey, can we talk?" },
      sig: null,
    },
    { fromNick: "@user", toNick: "@peer", createdMs: t1 }
  );

  // 2. Call event in between
  h.upsertCallInvite({
    call_id: "call_u1",
    caller: userAgentId,
    callee: peerAgentId,
    caller_nick: "@user",
    callee_nick: "@peer",
    started_ms: t2,
  });
  h.insertCallFrame({
    frame_id: "frm_u1",
    call_id: "call_u1",
    from_agent: userAgentId,
    body: "Speaking on call",
    attachments: null,
    created_ms: t2 + 1000,
  });
  h.closeCall("call_u1", t2 + 5000, "normal");

  // 3. Second message after call
  h.insertMessage(
    {
      v: "0.1",
      id: "msg_u2",
      type: "sms",
      from: peerAgentId,
      to: userAgentId,
      ts: new Date(t3).toISOString(),
      payload: { body: "Thanks for calling!" },
      sig: null,
    },
    { fromNick: "@peer", toNick: "@user", createdMs: t3 }
  );

  // Check callsWithPeer
  const calls = h.callsWithPeer(userAgentId, peerAgentId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].call_id, "call_u1");

  // Check /console/thread/:peer endpoint
  const res = await fetch(`${hub.httpUrl}/console/thread/${peerAgentId}?as=${userAgentId}`).then((r) => r.json());
  assert.equal(res.peer_id, peerAgentId);
  assert.ok(Array.isArray(res.items), "response contains items array");
  assert.equal(res.items.length, 3, "items merges 2 messages and 1 call");

  // Verify chronological ordering
  assert.equal(res.items[0].kind, "message");
  assert.equal(res.items[0].body, "Hey, can we talk?");

  assert.equal(res.items[1].kind, "call");
  assert.equal(res.items[1].call_id, "call_u1");
  assert.equal(res.items[1].frames.length, 1);
  assert.equal(res.items[1].frames[0].body, "Speaking on call");

  assert.equal(res.items[2].kind, "message");
  assert.equal(res.items[2].body, "Thanks for calling!");
});
