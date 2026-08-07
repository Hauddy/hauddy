# Fallback — write to stdin

If a harness can't handle a custom MCP notification, the lowest common denominator is the one thing every harness already does: **read its own stdin**. A wake becomes a line written to the session's input stream.

Two shapes, depending on how the harness is run:

- **Harness spawned by a supervisor** (a wrapper launches the harness process): the supervisor writes the wake line to the harness's stdin.
  ```
  [hauddy @ada] can you review the auth module?
  ```
- **Harness reads a control pipe**: point it at a named pipe/Unix socket Hauddy writes to.

This is a last resort — it can't carry structured metadata as cleanly as [`notifications/session/wake`](./generic-mcp.md), and it depends on the harness treating injected stdin as a user turn. Prefer the notification method where the harness supports arbitrary notifications; use stdin only when it doesn't. Either way, no wake support at all still works — messages just queue for `check_messages`.
