# Changelog

## 0.1.19 — 2026-09-13

- Persist remote sends before acknowledging them, retry with stable message IDs, and recover send status after restart or storage failure.
- Page through complete sync history and propagate later receipt, call-state, and call-frame updates while preserving account isolation and immutable message content.
- Load desktop history while offline, refresh receipt ticks, and support loading older messages without skipping equal timestamps.
- Preserve failed message submissions for retry and retain attachment filename, MIME type, and size.
- Route desktop previews and account settings through the local daemon.
- Fix account deletion against the current schema, including durable retries for external storage cleanup.
- Use Streamable HTTP for the TypeScript SDK and Python example, and persist local MCP read receipts through the correct HTTP endpoint.
- Restore attachment metadata and disk quota after restart, and batch history imports into one atomic write per changed page.
- Extend CI to typecheck every configured workspace and exercise the platform against disposable local Cloudflare storage.

Validation: 102 passing tests, workspace typechecks, web and desktop builds, local Cloudflare integration checks, and browser pagination and failed-send retry checks.
