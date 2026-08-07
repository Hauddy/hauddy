# Hauddy app UX overhaul — plan (drafted 2026-08-06)

Trajectory for polishing the **web dashboard** (`packages/web` + `@hauddy/app-shared`) and
carrying the same features into the **desktop app** (`packages/sidecar-ui`, Electron renderer).

## Status (2026-08-06)
- ✅ **A1** — API-key box padding: `.card` had no padding and `.conn-card`/`.conn-actions` were
  undefined → key text was flush to the border. Added `.conn-card` padding + `.key-chip` as a real
  padded code block (`app-shared/styles.css`).
- ✅ **B** — profile dropdown: new `packages/web/src/components/UserMenu.tsx` (avatar + email
  trigger → popover: *Account & settings* / *Sign out*), replaces the logout-on-click button
  (`web/Layout.tsx` + `web/index.css`).
- ✅ **C** — autocomplete recipient: extracted `Combobox` → `@hauddy/app-shared` (component +
  CSS + export), web `Messages` now uses it instead of `<select>`. Desktop still has its own copy
  (converge its import later).
- ✅ **D1** — download button gated honestly ("coming soon", disabled) since no build exists yet.
- ✅ **E** — persistent chat/call **history** + **F** — **notifications** bell: DONE + DEPLOYED
  2026-08-06 (Worker version `ea8a2deb`, Pages deployment `218a5b26`). Details below.
- ✅ **Chat polish** (session 2) — DONE + DEPLOYED 2026-08-06 (Worker `c3a23b53`, Pages
  `b1997763`): (1) Chats/Calls segmented tabs + call log (surfaces the existing `/console/calls`),
  (2) ✓/✓✓ delivery/read ticks (added `delivered_at`/`read_at` to `messagesWithPeer` +
  `ThreadMessage`), (3) presence dots in the recipient picker, thread rows, and thread header
  (one `/agents` fetch → `presenceOf` map). Ticks: `delivered_at` on recipient ack, `read_at`
  only for console-human peers. Files: `app-shared/src/{screens/Messages,api/index,styles.css}` +
  `platform/src/db.ts`.
- ⏳ Remaining: **desktop parity** (port A/B/C/E/F into `sidecar-ui`; needs local persistence for
  history since the local hub has no SQL store), **G** (reservation, deferred).
- **DEPLOYED LIVE** to `app.hauddy.com` + `api.hauddy.com` (Production/main). Verify a fresh load
  with a cache-buster — the edge caches `index.html` briefly after each deploy.

### E/F — what shipped (2026-08-06)
- **Backend** (`packages/platform`): `db.ts` gained `threadsFor` / `messagesWithPeer` /
  `markThreadRead` / `callsFor` / `unreadMessageCount` / `missedCallCount(humanId, sinceMs)`;
  `hub-do.ts` gained `GET /console/threads`, `GET /console/thread/:peer` (auto-marks read),
  `GET /console/calls`, `GET /console/notifications`, `POST /console/notifications/seen`
  (missed-call ack cursor in DO storage `notifseen:<humanId>`). All additive; `/console/inbox`
  unchanged as the live-tail. Uses `read_at` (previously unwritten) for unread.
- **Frontend** (`packages/app-shared` + `packages/web`): `api` client methods + types
  (`ThreadSummary`/`ThreadMessage`/`CallLogEntry`/`Notifications`); `Messages.tsx` rebuilt as a
  **two-pane chat** (thread list w/ unread badges + conversation history + live compose + existing
  `CallPanel`); new `web/components/NotificationBell.tsx` in the top bar (badge = friend requests +
  unread + missed; opening it acks missed calls; deep-links to Friends/Messages).
- **Known limitations / follow-ups:**
  - Sub-second race: if a new message from the open peer arrives while its history is still
    loading, the history `setLines` can overwrite it (it's dedup-`seen` so it won't double-show,
    and reappears on reopen). Fine for alpha; a merge-load would remove it.
  - Calls history endpoint (`/console/calls`) exists but isn't surfaced in the UI yet — the two-pane
    shows message threads + the live CallPanel; a call-log tab/section is a small follow-up.
  - `unread_messages` counts `read_at IS NULL` for the human; the live inbox marks *delivered* not
    *read*, so unread persists until a thread is opened (intended).

### Polling / request cost (2026-08-06)
Noticed the Worker hit ~95k requests — **not** from deploys (`wrangler deploy` is control-plane, it
doesn't invoke the Worker). Cause: the dashboard polls. The app-shared store re-fetches on a
heartbeat and *each mounted `useApiData` is one request*; Messages adds an inbox poll + the
CallPanel poll. A tab left open on Messages ran ~4.2 req/s ≈ 15k/hr ≈ the 95k over a few hours.
Mitigations shipped (JS-only redeploy, no Worker change):
1. **Pause when hidden** — the store skips its tick while `document.visibilityState === 'hidden'`
   and refreshes on `visibilitychange`; the Messages inbox + CallPanel ticks also bail when hidden.
   A backgrounded tab now makes **zero** requests (was the dominant real-world cost).
2. **Gentler base interval** — store heartbeat 2s → **6s**; Messages inbox 1.5s → **3s**.
3. **CallPanel gated** — 1s only during an *active* call, **4s** when idle (just watching for an
   invite). Was 1s whenever any conversation was open.
Net: ~3× fewer requests while actively viewing, ~100% fewer while backgrounded.

**Confirmed with real Cloudflare data** (GraphQL `httpRequestsAdaptiveGroups`, zone
`hauddy.com`, 24h to 2026-08-06T15:28Z — script saved at `/tmp/cf-analytics.mjs`, re-runnable):
- **100,611 total requests**, ~98% dashboard polling. By path:
  `/accounts/me` **37,737 (37.5%)** · `/console/call/poll` **25,071 (24.9%)** ·
  `/console/inbox` **18,289 (18.2%)** · `/accounts/friends` **13,023 (12.9%)** ·
  `/contacts/agt_…` 4,755 · `/console/threads`+`/console/notifications` 1,433 · bot-probe 404s ~300.
- By client: **82% Chrome/Mac** (the web dashboard tab), **16% `node`** (the local daemon), 2% iPhone.
- By hour: near-zero overnight (2–98/hr) → **08:00–15:00 UTC ramp 4.6k→17k/hr** = our own dev
  session with the dashboard + app open. Deploys appear nowhere (control-plane, don't invoke the Worker).
- Data is **pre-fix** (mitigations deployed ~15:00Z). The three biggest paths are exactly what
  1–3 target; expect the top-4 to drop from ~94k to ~25–30k during active use, ~0 backgrounded.

**Deferred to post-alpha (optimizations — do NOT block launch):**
- **`/accounts/me` dedupe** — it's 37% of ALL traffic because 3–4 `useApiData` hooks each fetch it
  per cycle (`getSession` Layout + `listAgents` Messages + `listNicknames`/`getAccountKey`). One
  shared cached fetch removes ~⅓ of everything. Highest-value remaining win.
- **Daemon (`node`) 16k/24h** — it holds a WS, so 16k *HTTP* calls is more than expected; likely
  reconnect/presence chatter. Investigate separately.
- **Push over WS** — replace HTTP console polling with events over the daemon's existing WebSocket.

---

# NEXT PHASE — E (history) then F (notifications): implementation spec

Grounded in the backend as it stands (verified 2026-08-06). Do E first (biggest value); F builds
on E's unread data. **Web/platform only** in this phase — desktop parity is a later pass (the local
hub has no SQL store, so desktop history needs its own persistence — out of scope here).

## Backend facts that drive the design
- `humanId = this.consoleHuman(request).agent_id` — one pseudo-agent per account
  (`hub-do.ts:440`). Console SMS routes `from=humanId → to=<peer agent_id>` (`/console/sms`,
  `hub-do.ts:460`); replies persist with `to=humanId`. Both land in `messages` via
  `db.insertMessage` (`db.ts:532`).
- A **thread** = rows where `humanId` is `from_agent` OR `to_agent`; the **peer** is the other
  side. Display handle = `from_nick`/`to_nick` (the peer's, whichever side isn't the human).
- Calls: `calls` table, `caller`/`callee` = humanId or peer; transcript in `call_frames`.
- Attachments are JSON text in `messages.attachments` / `call_frames.attachments`.
- `read_at` exists but is never written → use it for unread. `delivered_at` stays the live-tail's
  concern; DON'T conflate the two.
- Keep `/console/inbox` (drains undelivered) AS-IS — it's the live "new message" tail. History is
  separate, read-only, and must NOT mark-delivered.

## E1 — DB methods (`packages/platform/src/db.ts`)
- `threadsFor(humanId): ThreadRow[]` — one row per peer. SQL: over `messages` where
  `from_agent=? OR to_agent=?`, group by the peer id (`CASE WHEN from_agent=humanId THEN to_agent
  ELSE from_agent END`), select last body/ts (`MAX(created_ms)`) + `SUM(to_agent=humanId AND
  read_at IS NULL)` as unread. (Uses `idx_msg_thread`.) Fold in calls for "last activity" later if
  wanted; v1 can list message-threads + a separate call log.
- `messagesWithPeer(humanId, peerId, beforeMs?, limit=50): MsgRow[]` — `WHERE (from_agent=? AND
  to_agent=?) OR (from_agent=? AND to_agent=?)` ordered by `created_ms DESC` with `created_ms < ?`
  paging; return ascending for render. Parse `attachments` JSON.
- `markThreadRead(humanId, peerId): void` — `UPDATE messages SET read_at=? WHERE to_agent=humanId
  AND from_agent=peerId AND read_at IS NULL`.
- `callsFor(humanId, limit=50): CallRow[]` — `WHERE caller=? OR callee=?` order `started_ms DESC`;
  optional `frames(callId)` for transcript. A **missed** call = `callee=humanId AND answered_ms IS
  NULL AND state='ended'` (drives F).

## E2 — Console routes (`packages/platform/src/hub-do.ts`, alongside the block at ~446–500)
- `GET /console/threads` → `{ threads: [{ peer_id, peer_nick, last_body, last_ts, unread,
  has_attach }] }`.
- `GET /console/thread/:peer?before=&limit=` → `{ peer_id, peer_nick, messages: [...] }`; peer may
  arrive as an `@handle` → resolve via `db.resolveAgentId`. **Auto-mark read** here (or a separate
  `POST …/read`) — pick auto for simplicity.
- `GET /console/calls?peer=&withFrames=` → `{ calls: [...] }`.
- Resolution: the client holds handles; the DB stores agent_ids. Resolve `@handle ↔ agent_id`
  consistently (peer_nick for display, peer_id for keys).

## E3 — API client (`packages/app-shared/src/api/index.ts`)
- Add `consoleThreads()`, `consoleThread(peer, opts)`, `consoleCalls(opts)` mirroring the existing
  `console*` methods. Add types `ThreadSummary`, `ThreadMessage`, `CallLogEntry`.

## E4 — Messages screen rebuild (`packages/app-shared/src/screens/Messages.tsx`)
- Two-pane: **left** = thread list (`consoleThreads`, unread badges, click to open) + a "New" button
  that reveals the Combobox recipient; **right** = selected conversation = history
  (`consoleThread`) + the existing live compose + `CallPanel`.
- Live merge: keep the 1.5s `consoleInbox` poll, but route incoming lines into the open thread and
  bump the left-list unread for others (don't lose the current live behavior).
- Empty states: no threads yet → prompt to start one; no selection → "pick a conversation".
- CSS: add a `.chat-layout` (sidebar + panel) to `app-shared/styles.css`; reuse `.chat-thread` /
  `.chat-line` for the transcript.

## F — Notifications (after E)
- `GET /console/notifications` → `{ friend_requests, unread_threads, missed_calls }` (reuse
  `friends.incoming` count + E1's unread sum + missed-call count). One call, cheap.
- `app-shared` `NotificationBell` component (badge = total; dropdown lists items with deep links →
  Friends / the thread). Mount in web `Layout` top bar next to `UserMenu`.
- Desktop later: native OS notification + tray badge (tray already in `desktop/src/main.ts`).

## Test/verify
- Unit-ish: seed a couple messages both directions + a call via the console routes, assert
  `threads`/`thread`/`calls` shapes and unread math.
- E2E: on `app.hauddy.com`, message `@marc-test`, reload → history persists (today it vanishes);
  unread badge clears on open.
- Deploy: `wrangler deploy -c packages/platform/wrangler.toml` (Worker) + the Pages redeploy for web.

## Architecture context (why this matters for every item)

- **Two UIs, two data sources.**
  - `packages/web` → screens from `@hauddy/app-shared` → talks to the **platform**
    (`api.hauddy.com`, Cloudflare Worker + Durable Object with **persistent SQLite**:
    `messages`, `calls`, `call_frames`).
  - `packages/sidecar-ui` → its **own** screens (`Activity`, `Agents`, `Contacts`,
    `Messages`, `Platform`, …) → talks to the **local daemon** (`127.0.0.1:7700`), whose
    local hub keeps SMS/calls **in-memory only** (no SQLite history).
- **They don't share screen code.** `app-shared` is web-only today. `sidecar-ui` already has
  its own `Combobox`, `SearchInput`, `Presence`, `Logo`.
- **Consequence:** most features land twice (web against the platform API, desktop against the
  local API). Where a *component* is generic (autocomplete, dropdown menu, chat thread), extract
  it to a shared place; where it's *data*, wire each app to its own backend.

---

## A. Quick CSS/UX fixes (web, no backend) — do first

| # | Issue | Where | Fix |
|---|-------|-------|-----|
| A1 | API key box: text flush to left border, no padding | `.conn-card .key-chip` (`styles.css:876`) | add horizontal padding to `.key-chip`; make it a proper padded, scrollable/wrapping code block |
| A2 | Top-right email button unstyled + logs out on click, no confirm | `Layout.tsx:35-42` (web), `.user-email` | replace with a **profile dropdown**: avatar/email trigger → menu (Account, Settings, Sign out). Sign out confirms or is clearly labeled. |
| A3 | "Download Hauddy for Mac" button does nothing | `Account.tsx:90-92` | see **D** — no artifact exists yet; gate it honestly until one does |

`.conn-card .key-chip` and friends are the only spots; the whole app-shared stylesheet is 954
lines and could use a broader pass (spacing scale, cards, buttons) but that's polish, not blocking.

## B. Profile / settings dropdown (replaces the logout-on-click button)

- New `app-shared` component `UserMenu` (trigger = email/avatar; popover with items).
- Items: **Account** (→ `/account`), **Settings** (new — see F), **Sign out** (calls `clearKey()`).
- Sign out should not be a hair-trigger: either a confirm step or clearly separated in the menu.
- Desktop parity: `sidecar-ui` has an equivalent top-bar identity affordance — mirror it there.

## C. Messages: autocomplete recipient (replace the `<select>`)

- Web `Messages.tsx:150` uses a raw `<select>`. Desktop already uses `Combobox` (type-to-filter,
  ↑/↓/Enter/click, presence dots) — `sidecar-ui/components/Combobox.tsx`.
- **Plan:** extract `Combobox` (+ its CSS) into `@hauddy/app-shared`, then:
  - web `Messages` uses it over `targets` (your agents + friends' exposed agents),
  - desktop keeps using it (swap its local import to the shared one to converge).
- Behavior: type a name → filtered list of matching handles below → click/Enter to select.

## D. App download button (no artifact exists yet)

- Reality: `packages/desktop` only builds `electron-builder --mac dir` (unsigned **app dir** into
  `release/`), no signed `.dmg`, no hosting, no download route on the platform.
- **Options:**
  1. **Gate honestly now** — disable the button / relabel "Desktop app — coming soon" (or a
     mailing-list capture). Lowest effort, no lie.
  2. **Ship a real build** — produce a signed/notarized `.dmg`, upload to R2 (or a Pages/GitHub
     release), point the button at that URL. This is its own mini-project (signing cert,
     notarization, hosting, auto-update later).
- Recommendation: **D1 for alpha**, D2 tracked as a separate release-engineering task.

## E. Persistent history surfaces (chats + call log) — needs backend

Today `Messages` is only a *live compose window*: it polls `/console/inbox` which **drains
undelivered** messages into ephemeral React state (an in-memory `seen` set). Refresh = history
gone from view, even though rows persist in SQL.

- **Backend (platform DO) — new read endpoints** (data already in `messages` / `calls` /
  `call_frames`, indexes `idx_msg_thread` etc. already exist):
  - `GET /console/threads` → conversation list: one row per peer (union of message peers + call
    peers), with last snippet/ts and unread count (`delivered_at`/`read_at` already tracked).
  - `GET /console/thread/:peer?before=…` → paginated message history with one peer.
  - `GET /console/calls?peer=…` → call log (from `calls`), optionally with transcript from
    `call_frames`. Could fold calls into the thread view as call entries.
  - Mark-read endpoint (or auto-mark on thread open) to drive unread badges.
- **`/console/inbox` stays** as the live-tail for new-message polling; history is a separate read.
- **Frontend (web):** restructure `Messages` into a two-pane **chat UI** — left = thread list
  (browsable), right = selected conversation (history + live compose). "New message/call" becomes
  a compose action, not the whole screen.
- **Desktop caveat:** the local hub has **no persistent store**. To give the desktop the same
  history either (a) add a small SQLite/JSON store in the daemon, or (b) have the desktop read the
  same platform history endpoints for network conversations (local-only chats would still need
  local persistence). Decide per-scope; likely (a) for a faithful local mirror.

## F. Notifications (new friend requests / incoming messages / missed calls)

- Signals already exist: `friends.incoming` (Contacts), `/console/inbox` (new SMS), call invites
  via `/console/call/poll`. Missing: a **global, always-visible indicator**.
- **Plan:** a top-bar bell in `app-shared` fed by a small polling aggregator (counts of pending
  friend requests + unread threads + missed calls). Dropdown lists items with deep links
  (→ Contacts / → the thread). Badge count on the bell.
- Backend help: a cheap `GET /console/notifications` (or reuse threads' unread + friends.incoming
  + a `missed` flag on `calls`) so the client makes one call, not three.
- Desktop parity: same bell in `sidecar-ui`; Electron can additionally raise **native OS
  notifications** + tray badge for incoming calls/messages (the tray already exists in
  `desktop/src/main.ts`).

## G. Nickname reservation (marketing promises it) — ✅ DONE + DEPLOYED 2026-08-07

**Shipped** (Worker `636ce24f`, Pages `7bb827b0`). New `reservations(nickname, account_id,
created_at)` table sharing one namespace with `nicknames`; `reserveNickname`/`releaseReservation`/
`attachReservation`/`nicknameAvailability`/`accountReservations` in `db.ts`; `bindNickname` made
reservation-aware (another account's hold blocks a bind — even a WS auto-claim; your own hold is
consumed on bind). Routes `GET /accounts/nicknames/check` + `POST /accounts/nicknames/{reserve,
release,attach}` + `reservations` on `/accounts/me`. Nicknames screen gained a ReservePanel (debounced
live availability) + a "Reserved" section (attach/release). Test `packages/platform/test/p6-reservations.mjs`
(19 checks); P1/P3 no regression. The analysis below is the original design (kept for reference).

- Marketing/landing says handles can be **reserved**. Today `nicknames` only binds a
  nickname **to an existing agent** (`bindNickname`, schema `nicknames(agent_id, name…)`); there's
  no way to hold a handle for your **account** before an agent exists.
- **What reservation needs:**
  - A place to store an account-level hold — either a `reservations` table
    (`name, account_id, created_at`) or allow `nicknames.agent_id` to be null with an
    `account_id` owner.
  - Uniqueness must span **both** bound nicknames and reservations (one namespace).
  - Claim flow: reserve `@handle` (unique check) → later attach it to an exposed agent (moves the
    hold to a binding). Release/expiry policy (do reservations expire? limit per account?).
  - Routing: a reserved-but-unbound handle **doesn't route** (no agent) — UI must show it as
    "reserved, not yet attached."
  - Endpoints: `POST /accounts/nicknames/reserve`, `DELETE …/reserve`, list on the account.
  - UI: Nicknames screen gains a "Reserve a handle" input + a "Reserved" section distinct from
    "Bound to an agent."
- **Effort:** medium (schema + uniqueness refactor + 3 endpoints + UI). Deferred until the above
  A–F land; flagged because it's a marketing-page promise (either build it or soften the copy).

---

## Other obvious/expected features worth considering

- **Message delivery/read state in the UI** — schema already has `delivered_at` / `read_at`;
  surface ticks/seen so the compose view isn't a black hole.
- **Presence in the recipient picker & thread header** — `presenceOf` exists; show online/offline
  on handles (Combobox already renders presence dots).
- **Empty/loading/error states** — `useApiData` silently yields `undefined` on failure (platform
  down looks identical to "no data"). Add a visible "can't reach Hauddy" banner.
- **Account settings page (F's target)** — display name/username edit, password change,
  auto-accept toggle (currently stranded on Contacts), notification prefs, delete account.
- **Search** across threads/handles once history exists.
- **Attachment previews** — images inline instead of a download chip (bytes already flow).
- **Mobile/responsive** — the dashboard is desktop-first; a responsive pass if web is a real
  surface.
- **Accessibility** — the dropdowns/menus (B, F) need focus traps + `aria` (Combobox already
  models this well).

## Suggested sequencing

1. **A + B + C** (web-only, mostly frontend; C needs the Combobox extraction) — visible wins, no
   backend risk.
2. **D1** (honest download gating).
3. **E** (history) — biggest value, needs new platform read endpoints + a Messages rewrite.
4. **F** (notifications) — builds on E's unread data.
5. **Desktop parity pass** — port A/B/C/E/F into `sidecar-ui` against the local API (+ decide local
   persistence for E).
6. **G** (nickname reservation) — backend track; or soften marketing copy if punting.

## Key files

- Web dashboard: `packages/web/src/{App,components/Layout,screens/Login}.tsx`
- Shared screens/components: `packages/app-shared/src/screens/*`, `.../components/*`,
  `.../api/index.ts`, `.../styles.css`
- Desktop renderer: `packages/sidecar-ui/src/screens/*`, `.../components/{Combobox,SearchInput}.tsx`
- Platform API + schema: `packages/platform/src/{hub-do,schema}.ts` (console routes ~line 446–503)
- Local daemon API: `packages/hub/src/server.ts` (console routes ~line 888–910), `packages/sidecar`
