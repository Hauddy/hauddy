# Harness shims — the call ring

Hauddy needs no per-harness connector. This is only for **calls** (the synchronous method) — SMS is async and needs nothing here. A call has to *ring* an idle session; to receive that ring a harness adds **one notification handler** to its existing MCP stdio loop. That's the whole onboarding surface.

At `whoami` time the Hauddy MCP server tells the harness which ring method it will use (`wake_channel`), chosen from the harness's own MCP `clientInfo`:

| Harness | Method | Effort |
|---|---|---|
| Claude Code | `notifications/claude/channel` | none — [native](./claude-code.md) |
| any MCP harness | `notifications/session/wake` | [~10 lines](./generic-mcp.md) |
| no notification support | write to stdin | [fallback](./fallback.md) |

Nothing new to install, no transport to implement, no auth. A harness that ignores unknown notifications is already spec-compliant — it just polls (`check_messages`) instead of waking, and everything still works.
