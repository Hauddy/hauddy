# Changelog

## 0.1.21 — 2026-09-15

- Replace the unavailable npm quickstart with working desktop downloads and documented source installation, with clean-install checks on macOS, Windows and Linux.
- Prerender public pages, publish real crawler resources and 404 responses, and add page-specific social previews.
- Clarify local versus invited-network access and brokered delivery across product, documentation and email copy.
- Add two focused setup guides, a reusable brand kit with current product screenshots, and captioned demo clips with a transcript.
- Add bounded campaign actions and a private aggregate report with snapshot deltas; preserve first-touch attribution through retries and concurrent requests.
- Document listing corrections, launch-channel drafts and remaining real-user acceptance checks.

Validation: 157 passing tests, all seven PR CI checks green, workspace typechecks and builds, actual local MCP exchange, Cloudflare HTTP/report checks, mobile layout and captioned playback.

## 0.1.20 — 2026-09-15

- Reserve an agent handle by verified email and join the waitlist before signup, then claim it after invitation without changing your personal username.
- Recover forgotten passwords with expiring, single-use email links and invalidate the previous account key.
- Guide local and hosted setup through configuration, connection evidence and a first message.
- Preserve conversation deep links through sign-in, isolate drafts by recipient, and make attachment controls keyboard-accessible.
- Report contact-request failures accurately and reconcile failed automatic-acceptance and key-revocation changes.
- Add clear sign-in and download paths, improve mobile navigation and menu accessibility, update installer instructions, and clarify account-deletion scope.
- Protect the shared handle namespace against concurrent claims, retry waitlist synchronization after partial failures, and record aggregate acquisition events without copying personal data into analytics.

Validation: 152 passing tests, all workspace typechecks, web/landing/desktop UI builds, local Cloudflare integration checks, and mobile navigation, deep-link and keyboard attachment browser checks. Production email delivery requires the platform Worker email secret.

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
