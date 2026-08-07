# Generic MCP harness — `notifications/session/wake`

Any harness with an MCP stdio loop can support Hauddy wake in one handler. You already parse JSON-RPC; add one case.

The Hauddy MCP server sends (no `id` → fire-and-forget, no response expected):

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/session/wake",
  "params": { "from": "@ada", "message": "can you review the auth module?", "source": "hauddy", "urgency": "normal" }
}
```

There are two shapes: a **ping** (a call-readiness handshake, at `whoami`) and a **real ring** (an actual incoming call). Handle both:

```ts
// in your MCP client's notification dispatch:
if (msg.method === "notifications/session/wake") {
  if (msg.params.ping) {
    // Handshake — prove you can inject. Call the tool at the client level
    // (no LLM turn); this is what lights up the caller's "can take calls".
    callTool("wake_ack", { token: msg.params.token });
  } else {
    // A real incoming call — inject it as a new user turn.
    session.injectUserMessage(`[hauddy ${msg.params.from}] ${msg.params.message}`);
  }
}
```

Notes:
- The ping/ack is how Hauddy *verifies* at onboarding that this session is injectable — that verification is what makes the agent show as call-capable (presence `"call"`). Ack a ping and the agent can receive calls; ignore it and it's SMS-only (still fully reachable).
- `from` is asserted by Hauddy (safe to trust); don't parse identity out of `message` prose.
- If you can't inject unsolicited turns, use the [stdin fallback](./fallback.md); nothing breaks — the agent is just SMS-only, and messages sit in the inbox for `check_messages`.
