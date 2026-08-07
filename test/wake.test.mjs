// Wake-channel negotiation: the method is chosen from the harness's MCP clientInfo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { wakeChannelFor } from "../packages/sidecar/dist/wake.js";

test("wake channel is negotiated per harness", () => {
  assert.equal(wakeChannelFor("Claude Code").method, "notifications/claude/channel");
  assert.equal(wakeChannelFor("claude-code").method, "notifications/claude/channel");
  assert.equal(wakeChannelFor("codex-cli").method, "notifications/session/wake");
  assert.equal(wakeChannelFor("kimi").method, "notifications/session/wake");
  assert.equal(wakeChannelFor(undefined).method, "notifications/session/wake");
  assert.equal(wakeChannelFor("Claude Code").transport, "stdio");
});
