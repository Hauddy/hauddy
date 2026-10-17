# Hauddy architecture

A map of where data lives, what the sync engine touches, and how the desktop and
web apps share UI code while using different transports.

## Two hubs, two stores

| | Local hub and sidecar | Platform hub |
|---|---|---|
| Implementation | `packages/hub`, `packages/sidecar` | `packages/platform` (Cloudflare Durable Object) |
| Persistent history | JSON file, loaded into memory | Durable Object SQLite |
| Identity and contacts | Local agent registry and per-agent contact books | Accounts, human and agent identities, friendships, connectors and OAuth credentials |
| History scope | Local messages/calls plus successfully synced account history | Live network history plus account-private imported history |

The desktop daemon uses `~/.hauddy/localhub/store.json` for the local registry
and contacts, `~/.hauddy/localhub/history.json` for history, and
`~/.hauddy/sync.json` for sync progress. These paths follow `hauddyHome()` in
`packages/sidecar/src/account.ts` and daemon startup in
`packages/sidecar/src/daemon.ts`; standalone hub callers can supply a different
`dataDir`.

### Platform ownership and desktop transport

The platform owns account settings. Routing a desktop request through the
sidecar does not make the local hub the owner of those settings.

| Data or action | Platform route | Desktop path |
|---|---|---|
| Session and human profile | `GET /accounts/me` | `GET /api/account/settings` |
| Username / @handle and bio | `POST /accounts/profile` | `POST /api/account/profile` |
| Password change | `POST /accounts/password` | `POST /api/account/password` |
| Auto-accept | `POST /accounts/settings` | `POST /api/account/autoAccept` |
| Account deletion | `DELETE /accounts/me` | `POST /api/account/delete` |
| Friend list | `GET /accounts/friends` | `GET /api/friends` |

The daemon keeps its connection configuration, including the platform API key,
in `~/.hauddy/account.toml`. The account-settings bridge uses that key on a fixed
allowlist of routes and returns selected data to the renderer; it does not hand
the master key to the Settings screen. UI caches and saved connection metadata
exist, so “platform-owned” does not mean “nothing is ever stored locally.”
Account settings are not part of the history mirror.

For contributors: preserve platform ownership while choosing the transport that
fits the client. Desktop account settings must use the daemon bridge; bypassing
it can lose the desktop's authenticated account context.

### Local history persistence

`HubHistory` in `packages/hub/src/history.ts` loads `history.json` into memory.
A save serializes the full data to `history.json.tmp` and renames it over the
previous file. This avoids exposing a partially written destination file and
keeps history writes separate from registry/contact writes in `store.json`.
`importSyncPage()` stages a complete page and saves it once, restoring the prior
in-memory state if the save fails.

Atomic replacement is not a database transaction across history and sync files,
a multi-writer lock, or a power-loss durability guarantee. There is no explicit
file/directory fsync. Ordinary persisted mutations rewrite the full history
synchronously, and queries filter/sort in-memory rows; cost grows with history
size. The platform's `packages/platform/src/db.ts` uses Durable Object SQLite
instead. There is no local SQLite history index to query.

### What sync mirrors and how progress advances

`packages/sidecar/src/sync.ts` mirrors history with these rules:

- **Scope:** at least one party must map to a platform identity owned by the
  account (the human or an exposed agent). Threads between two unexposed local
  agents stay local. An unexposed peer in an eligible thread remains an external
  history participant, not a new routable network identity.
- **Platform authority:** imports go to account-private `sync_history` in the
  platform database, not live routing tables. Live records win ID collisions.
  Existing message content is preserved while receipts and call state can
  advance; this is not simply `INSERT OR IGNORE` for every field.
- **Push progress:** the engine scans eligible history, maps IDs to platform
  IDs, and compares each row's content hash with the `pushed` map in `sync.json`.
  Changed messages go to `/console/sync/messages` in batches of 500; calls with
  frames go to `/console/sync/calls` in batches of 50. Hashes are saved only after
  each successful response, allowing later receipt/call updates to be sent.
- **Pull progress:** `/console/sync/pull?cursor=…&since=…` uses the revision
  cursor when present. `db.ts`'s `syncPage()` reads account-visible changes from
  `sync_changes` and returns `next_cursor` and `has_more`. The engine imports
  each page before saving `pullCursor`, then continues while `has_more` is true.
  This captures updates to older records as well as newly created history.
- **Compatibility and read receipts:** `pushMs` and `pullMs` remain legacy
  timestamp fields; they are not the current push deduplication/revision
  mechanism. The server retains a `since` path for callers without a cursor.
  `agentReadMs` separately tracks forwarding of agent-read receipts for owned
  recipients to `/console/messages/agent-read`.
- **Retry and identity changes:** failures are retried on later sync ticks.
  History and progress use separate files, so replay after interruption is
  expected and imports are idempotent. A change to the endpoint, API key or
  local-to-platform mapping resets progress through the stored context hash.

On pull, known platform identities map back to local IDs; known remote peers
map to their `@nickname`; unmapped IDs remain IDs. Offline history reads can
only return what has already reached the local store. They do not guarantee a
complete, current copy of all platform history or local attachment availability.

## The shared API facade

`packages/app-shared/src/api/index.ts` supplies the default platform client,
using the browser's stored Bearer key for authenticated requests. The web app
uses that implementation. The desktop calls `installLocalApi()` in
`packages/app/src/api/local-adapter.ts`, which installs a partial override with
`configureApi(localApi)`.

The desktop adapter currently overrides these groups:

| Methods | Behavior |
|---|---|
| `listAgents`, `listPlatformAgents` | Assemble local/network directory and presence through daemon APIs |
| `listFriends` | Use desktop `httpApi`'s `/api/friends` daemon route |
| `consoleDashboard` | Combine daemon history/notifications with directory and friend data |
| `consoleThreads`, `consoleThread`, `consoleCalls` | Read local JSON-backed history through `/api/human/*` |
| `consoleNotifications`, `consoleNotificationsSeen` | Read/acknowledge daemon notification state |
| `consoleInbox`, `consoleSms` | Drain merged local/platform inboxes or send through the daemon |
| `consolePoll`, `consoleCall`, `consolePickup`, `consoleSay`, `consoleHangup` | Route calls through the daemon, retaining local/platform hub selection |
| `getSession`, `getIdentity` | Read selected platform account data through `/api/account/settings` |
| `updateProfile`, `changePassword`, `setAutoAccept`, `deleteAccount` | Use the fixed daemon account-action bridge |
| `getConsoleFileUrl`, `uploadConsoleFile`, `downloadConsoleFile` | Transfer files through daemon routes |
| `getAgentBook`, `addAgentBookContact`, `removeAgentBookContact` | Use daemon-managed per-agent contact books |

Other methods retain the shared implementation, including `getAccountKey`,
connector management, and nickname/reservation operations. Retaining a shared
method does not establish that a new desktop screen has the credentials it
needs. Check its actual call path before relying on the default. Desktop
`httpApi` in `packages/app/src/api/http.ts` is itself a daemon client, not the
shared platform client.

## Trace a desktop profile change

1. `packages/app-shared/src/screens/Settings.tsx` calls `api.updateProfile(patch)`.
2. `packages/app/src/api/local-adapter.ts` overrides it with
   `accountAction('profile', patch)`, posting to `/api/account/profile`.
3. `packages/sidecar/src/local-api.ts` matches the account-action route and calls
   `Daemon.accountSettings('profile', body)` in `packages/sidecar/src/daemon.ts`.
4. The daemon loads its saved account configuration and posts to the configured
   platform's `/accounts/profile` with the Bearer key.
5. `packages/platform/src/worker.ts` forwards the request to `HubDO`.
   `packages/platform/src/hub-do.ts` authenticates the account, validates and
   applies the username/bio changes through `packages/platform/src/db.ts`.
6. The daemon returns success (or an error) to the adapter and Settings screen.
   No local history write is involved.

## Trace a history sync

1. `Daemon.syncContext()` in `packages/sidecar/src/daemon.ts` supplies the account
   and identity mappings to `SyncEngine` in `packages/sidecar/src/sync.ts`.
2. `syncOnce()` pushes changed eligible rows, then pulls account-scoped history,
   then forwards agent-read receipts. Without a ready context it skips the tick.
3. `packages/platform/src/hub-do.ts` handles the `/console/sync/*` routes.
   `packages/platform/src/db.ts` validates private imports and selects revision
   pages through `syncPage()`.
4. `pullDown()` remaps IDs and calls `HubHistory.importSyncPage()` in
   `packages/hub/src/history.ts`, merging messages, calls and frames in one save.
5. Only after import succeeds does it save `next_cursor` as `pullCursor` in
   `sync.json`. A failed import leaves that page available for retry.

These are source-traced paths, not evidence of a live production account test.
Existing regression coverage includes `test/history-batch.test.mjs` and
`packages/platform/test/p17-sync-revisions.mjs`.

## Adding a new desktop screen or setting

1. Add the desktop route in `packages/app/src/App.tsx` and navigation entry in
   `packages/app/src/components/Layout.tsx` as needed.
2. Inspect every shared `api.*` call the screen uses. Choose a local history
   route, an authenticated daemon-to-platform route, or a supported shared
   default according to data ownership and credential availability.
3. For a new platform setting, add its handler in
   `packages/platform/src/hub-do.ts` and database support in
   `packages/platform/src/db.ts`. The edge entry point is
   `packages/platform/src/worker.ts`; there is no platform `router.ts`.
4. Add the shared API method and UI. If desktop needs daemon-held credentials,
   extend the fixed action allowlist in `Daemon.accountSettings()`, its
   `local-api.ts` route and the `local-adapter.ts` override. Keep settings owned
   by the platform rather than adding them to local history.

The shared Settings screen already relies on these desktop overrides; adding
its route alone is not the complete authentication integration.

## Adding an MCP history tool

The sidecar's existing `get_conversation` and `get_call_transcript` tools in
`packages/sidecar/src/mcp.ts` call SDK helpers against the provisioned hub
endpoint. In the local-daemon path, the hub serves these reads from
`HubHistory`; the tools do not directly open `history.json`.

Use the hub history methods for filtering and pagination, respecting their
in-memory implementation and caller scope. Preserve the existing ID/nickname
mapping rules rather than assuming every stored peer is a nickname. Keep local
reads useful offline, and describe their limit as already-synced history.
