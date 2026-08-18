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
