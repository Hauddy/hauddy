# Hauddy architecture

A map of where data lives, what the sync engine touches, and how the desktop and
web apps share the same UI code without sharing the same backends.

---

## Two hubs, two stores

```
┌─────────────────────────────────┐     ┌──────────────────────────────────────┐
│         Local hub               │     │           Platform hub               │
│  packages/hub + packages/sidecar│     │   packages/platform (Cloudflare DO)  │
│  ~/.hauddy-platform-data/       │     │   api.hauddy.com                     │
│                                 │     │                                      │
│  • local agent registry         │◄───►│  • account (email, password, API key)│
│  • local message/call history   │sync │  • human identity (@handle, bio)     │
│  • per-agent contact books      │     │  • agent identities + nicknames      │
│  • sync cursors (pushMs/pullMs) │     │  • friends + auto-accept flag        │
└─────────────────────────────────┘     │  • connectors + OAuth credentials    │
                                        │  • message/call history (SSOT)       │
                                        └──────────────────────────────────────┘
```

### What lives exclusively on the platform

Every account-level setting lives **only on the platform** and is never cached
or stored locally:

| Data | API route | Local copy? |
|------|-----------|-------------|
| Username / @handle | `POST /accounts/profile` | No |
| Bio | `POST /accounts/profile` | No |
| Password | `POST /accounts/password` | No |
| API key (rotate/revoke) | `/accounts/rotate`, `/accounts/revoke` | No |
| Friends + auto-accept | `/friends/*` | No |
| Connectors + OAuth creds | `/accounts/connectors` | No |

**Implication for contributors:** when you add a settings feature, the mutation
always goes directly to `api.hauddy.com`. Never write settings state to the
local hub. Never route a profile mutation through the sidecar daemon.

### What lives locally (and is synced)

Message and call history is stored locally in SQLite under `packages/hub` and
bidirectionally mirrored with the platform by `packages/sidecar/src/sync.ts`.

- **Platform is SSOT.** Pushes up are `INSERT OR IGNORE` — a locally-modified
  row can never overwrite the authoritative platform copy.
- **The OR rule.** A message or call is only synced if at least one party is a
  platform identity (the account owner or an exposed agent). Unexposed-to-unexposed
  local threads stay local-only and never touch the platform.
- **Cursor-based.** Two timestamps (pushMs, pullMs) persist in `sync.json` so
  restarts never re-send or re-download already-mirrored rows.

---

## The shared API facade

`packages/app-shared/src/api/index.ts` is a single API client used by both the
web dashboard and the desktop app:

- By default every method calls `api.hauddy.com` with the Bearer key from
  `localStorage`.
- The desktop app installs a **partial override** via `installLocalApi()` (in
  `packages/app/src/api/local-adapter.ts`). The override replaces only the
  messaging and history methods — because those read from the local hub's SQLite
  store, not the platform.

**Methods overridden in the desktop (local hub):**

| Method | Reason |
|--------|--------|
| `listAgents` | Merges local agents with network agents |
| `listPlatformAgents` | Includes local pool for presence/call-frame resolution |
| `listFriends` | Delegates to httpApi (same platform call, surfaced for parity) |
| `consoleThreads` | Reads local SQLite thread index |
| `consoleThread` | Reads local SQLite message rows |
| `consoleCalls` | Reads local SQLite call + frame rows |
| `consoleInbox` | Drains the local hub's in-memory inbox (merges local + platform) |
| `consoleNotifications` | Reads local notification state |
| `consoleSms` / `consoleCall` / … | Routes through daemon to merge inboxes correctly |

**Methods NOT overridden (always hit the platform):**

- `getSession`, `getIdentity`, `getAccountKey`
- `updateProfile`, `changePassword`
- `setAutoAccept`, `listFriends` (the non-local path)
- `createConnector`, `revokeConnector`, `rotateConnector`
- All nickname and reservation operations

This means the shared `Settings.tsx` screen works identically on both the web
dashboard and the desktop app — it only calls methods that fall through to the
platform. No special handling is needed in the local adapter.

---

## Adding a new screen to the desktop app

When wiring an existing `app-shared` screen into the desktop:

1. Add a route in `packages/app/src/App.tsx`.
2. Add a nav entry in `packages/app/src/components/Layout.tsx`.
3. Check whether the screen calls any `api.*` methods. If those methods are in
   the "NOT overridden" list above, no changes to `local-adapter.ts` are needed.
   If they read history or inbox, add an override that routes to the daemon.

The Settings screen (`packages/app-shared/src/screens/Settings.tsx`) is an
example of a screen that only uses platform API methods — wiring it in requires
only steps 1 and 2.

---

## Adding a new setting

1. Add the platform API endpoint in `packages/platform/src/router.ts` (or
   `hub-do.ts` if it touches the Durable Object).
2. Add the `api.*` method in `packages/app-shared/src/api/index.ts`.
3. Add the UI in the appropriate section of
   `packages/app-shared/src/screens/Settings.tsx` (or `Account.tsx`).
4. Do **not** add a corresponding local-hub endpoint or local-adapter override
   unless the feature fundamentally needs to read/write local-only data.

---

## Adding a new MCP tool that reads history

MCP tools for agents (`packages/sidecar/src/mcp.ts`) read from the **local hub
store** directly — they do not call the platform API. The local store already has
a full mirror of platform history (synced by SyncEngine), so an agent can read
its full conversation history offline. For a new `get_conversation` or
`get_call_transcript` tool:

- Read from `packages/hub/src/history.ts` (or its exposed store methods).
- Apply date-range filters at the query level, not in memory.
- Return platform agent IDs already remapped to @nicknames (the SyncEngine
  stores them that way after pull-down).
- No platform API call needed — the local store is sufficient and works offline.
