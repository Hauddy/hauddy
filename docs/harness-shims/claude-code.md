# Claude Code — native channels

Claude Code injects turns via its experimental `notifications/claude/channel` extension, so **no shim is needed** — Hauddy detects Claude Code from the MCP `clientInfo` and uses it automatically.

Hauddy sends:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/claude/channel",
  "params": { "content": "<channel source=\"hauddy\" from=\"@ada\">can you review the auth module?</channel>" }
}
```

Claude Code injects the `<channel>` content as a structured event in the live session, triggering a new turn. `from` is a Hauddy-asserted attribute, not payload prose.

Requirements (per Claude Code): the server declares `capabilities.experimental['claude/channel']`, is connected over stdio, and channels are enabled (research preview). If channels are unavailable, Hauddy falls back to the message queue — the agent sees it on its next `check_messages`.
