# Execution plan — port the Hauddy **platform** hub to Cloudflare-native

**Decision (2026-08-05):** run the *platform* (network) hub on Cloudflare's own
compute — a **Worker + a single Durable Object (SQLite storage) + R2** — instead of
the Node process on the Mac. Cost at alpha scale: **$0 on the free plan, or $5/mo flat
on Workers Paid for headroom** (see `docs/deploy-alpha.md` costs / DO+Workers pricing).

This document is the executable handoff: a fresh session should be able to build from
it. Read it top to bottom before starting.

---

## 0. Scope — what changes, what doesn't

**Ported to Cloudflare (new code):** the platform hub only — the consent-mode
(`autoLink: false`) server today in `packages/hub/src/{server,store,files}.ts`.

**Untouched:**
- **`@hauddy/protocol`** — reused as-is in the Worker (pure TS) — **except one fix**:
  `packages/protocol/src/ulid.ts` imports `node:crypto` `randomBytes`. Swap to the
  global `crypto.getRandomValues` (works in Node 22 *and* Workers) so protocol is
  runtime-agnostic. That is the ONLY protocol change.
- **The daemon / app / bridge** (`packages/sidecar/*`) — they already dial
  `wss://api.hauddy.com`; nothing to change.
- **The LOCAL hub stays Node.** The daemon embeds `startHub({autoLink:true})` on the
  user's machine — that keeps using `packages/hub` (JSON-on-disk is right for one
  machine). So `packages/hub` is NOT deleted; it becomes "local-hub only." The new
  Worker is a **second implementation** of the same protocol for the platform tier.
  Behavior parity between the two is guarded by a shared conformance test (see §8).

**Naming:** new package **`packages/platform`** (`@hauddy/platform-worker`). Leave
`packages/hub` as-is (its package name is confusingly `@hauddy/platform` today — rename
its `package.json` name to `@hauddy/local-hub` while here, dir stays `packages/hub`).

---

## 1. Target architecture

```
 app/daemon ──wss──▶  Cloudflare edge
                         │
                    ┌────▼─────┐   fetch()          ┌──────────────┐
                    │  Worker  │───────────────────▶│  HubDO (one) │  Durable Object
                    │ (router) │   WS upgrade ──────▶│  + SQLite    │  ctx.storage.sql
                    └────┬─────┘                     │  + WS hib.   │  ctx.acceptWebSocket
                         │ R2 put/get                └──────┬───────┘
                    ┌────▼─────┐                            │ alarms (TTL sweep)
                    │   R2     │  attachment bytes          │
                    │ (FILES)  │◀───────────────────────────┘
                    └──────────┘
```

- **One Worker** (`export default { fetch }`): terminates the HTTP control API and, on
  an `Upgrade: websocket` request, forwards to the DO. Handles CORS. Reads secrets.
- **One Durable Object `HubDO`**, addressed by a fixed name (`env.HUB.idFromName("global")`).
  It *is* the hub: owns all WebSocket connections (via the **Hibernation API**), owns the
  **SQLite** database (all durable tables), runs the routing logic. Single instance =
  single-threaded global router = simplest correct model for the alpha. (Scaling ceiling
  noted in §10; shard per-account/region later if needed.)
- **R2 bucket `FILES`**: attachment bytes at `files/<file_id>`. Metadata → SQLite
  `attachments` table (this also fixes today's "restart drops in-flight file metadata"
  gap — metadata becomes durable).
- **WS heartbeat** → `ctx.setWebSocketAutoResponse(...)` (auto ping/pong WITHOUT waking
  the DO — keeps the connection warm under Cloudflare's ~100s idle cutoff for free). The
  30s `setInterval` heartbeat in the Node hub goes away.
- **TTL sweeps / timeouts** → `ctx.storage.setAlarm()` + `alarm()` (replaces the file
  sweeper `setInterval`).

---

## 2. The database — full SQLite schema (get this right NOW)

DO SQLite (`ctx.storage.sql.exec`). Applied once at DO init (idempotent
`CREATE TABLE IF NOT EXISTS`). This includes the **new message + call content
persistence** the product wants; the *read surface* (history API/UI) is deferred, but
the write-paths are wired during the port so nothing is lost from day one.

```sql
-- ── identity / accounts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  account_id   TEXT PRIMARY KEY,                 -- acct_*
  username     TEXT UNIQUE,                       -- [a-z0-9_-]{3,32}, lowercased
  email        TEXT UNIQUE NOT NULL,
  pw_hash      TEXT,                              -- PBKDF2-SHA256 hex (was scrypt)
  pw_salt      TEXT,
  pw_iter      INTEGER,                           -- PBKDF2 iterations (for future re-hash)
  api_key      TEXT,                              -- raw key (alpha tradeoff; bearer at rest)
  key_masked   TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  auto_accept  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_apikey ON accounts(api_key);

CREATE TABLE IF NOT EXISTS agents (
  agent_id       TEXT PRIMARY KEY,               -- agt_*
  account_id     TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,
  grant_scope_id TEXT NOT NULL UNIQUE,           -- idempotent registration key
  public_key     TEXT NOT NULL,                  -- PEM SPKI (Ed25519)
  local_id       TEXT,
  display_name   TEXT,
  description     TEXT,
  speaking_as    TEXT,                           -- bare default nickname
  kind           TEXT NOT NULL DEFAULT 'agent',  -- 'agent' | 'human'
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_account ON agents(account_id);

CREATE TABLE IF NOT EXISTS nicknames (
  nickname   TEXT PRIMARY KEY,                    -- bare, normalized lowercase
  agent_id   TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,
  bound_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nicknames_agent ON nicknames(agent_id);

-- ── consent ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS friendships (   -- ACCOUNT/user-level consent (profile pool), unordered pair
  pair_key   TEXT PRIMARY KEY,                    -- sorted "acctA|acctB"
  account_a  TEXT NOT NULL,
  account_b  TEXT NOT NULL,
  state      TEXT NOT NULL,                       -- 'pending' | 'linked'
  initiator  TEXT NOT NULL,
  policy     TEXT NOT NULL DEFAULT 'allow_all',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_a ON friendships(account_a);
CREATE INDEX IF NOT EXISTS idx_friend_b ON friendships(account_b);

CREATE TABLE IF NOT EXISTS contacts (      -- AGENT-level consent graph (per-agent contact books)
  pair_key   TEXT PRIMARY KEY,                    -- sorted "agtA|agtB"
  agent_a    TEXT NOT NULL,
  agent_b    TEXT NOT NULL,
  state      TEXT NOT NULL,                       -- 'pending' | 'linked' | 'blocked'
  initiator  TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── MESSAGES: durable log of every SMS (replaces the transient inbox) ───
-- Undelivered = delivered_at IS NULL. On (re)connect, query undelivered for the
-- agent, deliver, set delivered_at. History is RETAINED after delivery.
CREATE TABLE IF NOT EXISTS messages (
  message_id    TEXT PRIMARY KEY,                 -- from envelope id (msg_*)
  from_agent    TEXT NOT NULL,
  to_agent      TEXT NOT NULL,
  from_nick     TEXT,                             -- speaking nickname snapshot at send
  to_nick       TEXT,
  body          TEXT,
  attachments   TEXT,                             -- JSON [{file_id,name,mime,size}]
  created_at    TEXT NOT NULL,                    -- ISO
  created_ms    INTEGER NOT NULL,                 -- epoch ms (ordering)
  delivered_at  TEXT,                             -- NULL until handed to a live session
  read_at       TEXT,
  account_scope TEXT                              -- recipient's account (history/retention)
);
CREATE INDEX IF NOT EXISTS idx_msg_undelivered ON messages(to_agent, delivered_at);
CREATE INDEX IF NOT EXISTS idx_msg_thread      ON messages(to_agent, from_agent, created_ms);
CREATE INDEX IF NOT EXISTS idx_msg_created     ON messages(created_ms);

-- ── CALLS: one row per call session (SMS vs Call kept DISTINCT — spec) ──
CREATE TABLE IF NOT EXISTS calls (
  call_id     TEXT PRIMARY KEY,                   -- payload.call.id
  caller      TEXT NOT NULL,
  callee      TEXT NOT NULL,
  caller_nick TEXT,
  callee_nick TEXT,
  state       TEXT NOT NULL,                      -- 'ringing'|'active'|'ended'|'missed'|'declined'
  started_ms  INTEGER NOT NULL,
  answered_ms INTEGER,
  ended_ms    INTEGER,
  end_reason  TEXT                                -- 'hangup'|'timeout'|'declined'
);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller, started_ms);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee, started_ms);

-- ── CALL_FRAMES: the content spoken during a call (transcript + attachments)
CREATE TABLE IF NOT EXISTS call_frames (
  frame_id    TEXT PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  from_agent  TEXT NOT NULL,
  seq         INTEGER NOT NULL,                   -- order within the call
  body        TEXT,
  attachments TEXT,                               -- JSON array
  created_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_callframes_call ON call_frames(call_id, seq);

-- ── ATTACHMENTS: R2-backed file metadata (bytes at R2 files/<file_id>) ──
CREATE TABLE IF NOT EXISTS attachments (
  file_id     TEXT PRIMARY KEY,                   -- file_*
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  owner       TEXT NOT NULL,                      -- sender agent id
  to_ref      TEXT,                               -- recipient ref (download auth)
  account_id  TEXT,                               -- owner's account
  created_ms  INTEGER NOT NULL,
  expires_ms  INTEGER NOT NULL                    -- 24h TTL sweep (alarm)
);
CREATE INDEX IF NOT EXISTS idx_attach_expires ON attachments(expires_ms);

-- ── INVITES: the email allowlist as a table (replaces allowlist.txt) ───
-- "update from the backend manually" = INSERT a row (admin endpoint or wrangler d1).
CREATE TABLE IF NOT EXISTS invites (
  email      TEXT PRIMARY KEY,                    -- lowercased
  note       TEXT,
  added_at   TEXT NOT NULL
);

-- ── RATE LIMITS: fixed-window counters (survives DO hibernation) ───────
CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,                     -- "bucket:ip"
  count     INTEGER NOT NULL,
  reset_ms  INTEGER NOT NULL
);
```

**Persistence design notes**
- **Inbox → messages.** Delete the `inboxes` concept. `deliverTo` INSERTs a `messages`
  row; if a live session is attached, deliver + `UPDATE delivered_at`; else it waits with
  `delivered_at IS NULL`. On connect, `SELECT ... WHERE to_agent=? AND delivered_at IS NULL
  ORDER BY created_ms`, deliver, mark. Unifies transient queue + retained history.
- **Calls.** On `payload.call.kind`: `invite` → INSERT `calls` (ringing); `accept` →
  `answered_ms`, state active; `frame` (a `say`) → INSERT `call_frames` (seq++); `close`
  → `ended_ms`, state ended/missed. Call content is captured; SMS text never mixes into
  `call_frames` (kinds stay separate per the firm SMS≠Call rule).
- **Retention (RESOLVED 2026-08-05 — not a beta concern):** messages + call_frames retain
  **plaintext** at rest (same tradeoff as today's temp files, extended to history).
  Attachments keep the 24h TTL (R2 object + row deleted by the alarm). **Deferred to
  post-beta:** a per-account max storage cap for shared files + configurable retention
  options (TTL per message/call rows), with E2E encryption as the eventual real fix. No
  gate on the port — write the plaintext paths now, revisit retention/quotas later.

---

## 3. Component mapping (current → Worker/DO)

**WS control frames** (`frames.ts`: `auth_hello, auth_challenge, auth_response, auth_ok,
claim, release, send, deliver, ack, receipt, capability, error`) → `HubDO.webSocketMessage`
dispatch. Handshake: on `webSocketMessage` with `auth_hello`, issue `auth_challenge`
(nonce); on `auth_response`, verify Ed25519 (WebCrypto) against the agent's stored
`public_key`, then `auth_ok` (+ presence snapshot). `claim/release` → nickname claim map.
`send` → route (see §2 persistence). `capability` → mark call-ready. `ack/receipt` →
delivery bookkeeping.

**HTTP routes** (all in Worker `fetch`, DO does the stateful ones):

| Route(s) | Notes |
|---|---|
| `POST /accounts` (signup) | invite gate → `invites` table; PBKDF2 hash; rate-limit |
| `POST /accounts/login` | verify PBKDF2; rate-limit |
| `POST /accounts/rotate`, `/revoke`, `GET /accounts/me`, `/accounts/claims` | Bearer |
| `POST /accounts/friends/{request,respond}`, `GET /accounts/friends`, `POST /accounts/settings` | friendships |
| `POST /accounts/agents/:id/remove` | unexpose (owner-gated) |
| `POST /register`, `GET /agents`, `POST /agents/:id/{nickname,profile}` | registry |
| `GET /claims`, `POST /claims/release`, `/accounts/claims/release` | nickname claims |
| `POST /contacts/{share,respond}`, `GET /contacts/:id`, `GET /presence/:id` | consent graph |
| `POST /files` (octet body → R2 + `attachments`), `GET /files/:id` (R2 get + auth) | Bearer + `fileAccessible` |
| `/console/*` (identity, inbox, sms, call, call/{pickup,say,poll,hangup}) | human console (virtual client) |

**`store.ts` methods** → SQL queries in a `HubDO` DB layer (1:1 with today's methods:
`createAccount, verifyLogin, authenticateAccount, rotateKey, registerAgent,
bindNickname, resolveAgentId, shareContact/respondContact, requestFriend/respondFriend,
areAccountsLinked, ...`). `pairKey` unchanged. `nowIso` unchanged.

**`files.ts` FileStore** → R2 (`env.FILES`) + `attachments` table + alarm sweep.
Per-file 10MB cap (check `content-length` + stream), whole-store quota via a periodic
alarm summing `size` (or trust R2). `readRawBody` → `request.arrayBuffer()` with a
declared-size pre-check (keep the clean 413).

---

## 4. Crypto migration

- **Ed25519 verify** (auth handshake): `crypto.subtle.importKey("spki", der, {name:"Ed25519"},
  false, ["verify"])` + `crypto.subtle.verify("Ed25519", key, sig, nonce)`. The stored
  `public_key` is PEM SPKI → strip header/footer, base64-decode to DER. Supported in Workers.
- **Passwords scrypt → PBKDF2.** WebCrypto has no scrypt. Use
  `crypto.subtle.deriveBits({name:"PBKDF2", hash:"SHA-256", salt, iterations:100000}, key, 256)`.
  Store `pw_hash/pw_salt/pw_iter`. Clean swap — the store is empty, no migration.
- **ID minting / random**: `ulid.ts` + `mintApiKey`/nonces → `crypto.getRandomValues`
  (global). Fix `ulid.ts` (§0) so `@hauddy/protocol` drops its `node:crypto` import.

---

## 5. WebSocket **hibernation** design (the critical bit)

In-memory Maps (`online, clients, claims, remotes, consoles, consoleCall`) **do not
survive DO hibernation**. Rebuild from the live socket set instead of trusting memory:

- Accept with the hibernation API: `this.ctx.acceptWebSocket(server, [agentId])` (tag by
  agent id for `getWebSockets(agentId)` presence lookups).
- Persist per-socket identity with `ws.serializeAttachment({agentId, accountId, nickname,
  callReady})`; read back with `ws.deserializeAttachment()` in each handler.
- **Presence / online** = derive from `this.ctx.getWebSockets()` (+ tag filter) each time,
  not a long-lived Map. `claims` (nickname → socket) rebuilt by scanning attachments, or
  persisted in a small `claims` table if contention needs durability.
- **Heartbeat** = `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping",
  "pong"))` — CF answers pings without waking the DO (keeps idle sockets warm, ~$0).
- Handlers: `webSocketMessage`, `webSocketClose`, `webSocketError`. On close, presence
  updates naturally (socket leaves `getWebSockets()`); flush any unacked back to
  `messages` (delivered_at NULL).

This is why idle connections are ~free (see cost analysis): no in-memory state pinned, no
duration billed while hibernating.

---

## 6. Config — `wrangler.toml`

```toml
name = "hauddy-platform"
main = "src/worker.ts"
compatibility_date = "2026-01-01"
# NO compatibility_flags — P0 confirmed pure WebCrypto works with zero node: imports,
# so `nodejs_compat` is dropped (plan §10 decision #3 resolved). Add back only if a
# future dependency forces it.

[[durable_objects.bindings]]
name = "HUB"
class_name = "HubDO"

[[migrations]]
tag = "v1"
new_sqlite_classes = ["HubDO"]

[[r2_buckets]]
binding = "FILES"
bucket_name = "hauddy-files"

[vars]
CORS_ORIGIN = "https://app.hauddy.com"

# secrets (wrangler secret put): ADMIN_TOKEN (for invite admin endpoint), etc.

# A Custom Domain is the BARE hostname — no wildcard, no path (wrangler rejects
# `api.hauddy.com/*`). It already routes every path on that host to the Worker.
[[routes]]
pattern = "api.hauddy.com"
custom_domain = true
```

Invite management ("from the backend manually"): `POST /admin/invites {email}` gated by
`ADMIN_TOKEN` Bearer, or just `wrangler d1`/SQL insert. Seed `you@example.com`.

---

## 7. Package / file layout (`packages/platform`)

```
packages/platform/
  package.json            @hauddy/platform-worker
  wrangler.toml
  tsconfig.json
  src/
    worker.ts             fetch entry: CORS, route table, WS upgrade → DO
    hub-do.ts             HubDO: acceptWebSocket, webSocketMessage/Close/Error, alarm
    db.ts                 SQLite layer (mirrors store.ts method names) + schema DDL
    files-r2.ts           R2 put/get + attachments table + auth
    crypto.ts             Ed25519 verify, PBKDF2, getRandomValues helpers
    routes/               accounts, agents, friends, console, files (per §3)
  test/                   vitest (workers pool) — see §8
```

---

## 8. Testing strategy

- Add **`vitest` + `@cloudflare/vitest-pool-workers`** to run the Worker/DO under
  Miniflare in-process. Most existing `node --test` files (`platform/friends/human/
  files.test.mjs`) are **fetch-against-a-base-URL** — repoint them at the test worker's
  URL and they largely carry over (signup, login, expose, friends, console, files, the new
  invite gate + rate-limit + CORS tests). The relay test (real `Daemon` ↔ platform) stays
  Node but points its bridge endpoint at the local `wrangler dev` / test worker.
- **Conformance suite**: a shared set of protocol expectations run against BOTH the Node
  local hub and the Worker platform, so the two implementations don't drift (§0).
- Port target: keep the current 61 green + new tests for messages/calls persistence
  (send → row exists → deliver marks delivered_at; call invite/say/hangup → calls +
  call_frames rows).
- **Current reality (as of P1):** vitest-pool-workers is NOT set up yet. P1 is verified by
  `packages/platform/test/p1-http.mjs` — a plain `node` script (global fetch) run against a
  live `wrangler dev --var RATE_LIMIT:off`. This is a legitimate integration test of the HTTP
  surface; stand up the vitest harness when WS tests need Miniflare in-process (P3), or as a
  dedicated step. Run: `wrangler dev -c packages/platform/wrangler.toml --port 8787
  --var RATE_LIMIT:off` then `node packages/platform/test/p1-http.mjs http://localhost:8787`.

---

## 9. Phased execution (checklist for the fresh session)

- [x] **P0 Scaffold** ✅ (2026-08-05): `packages/platform` (`@hauddy/platform-worker`) +
      wrangler.toml + `HubDO` stub (schema DDL applied on init, WS accept, auto-response
      heartbeat) + `db.ts`/`schema.ts` (full §2 schema) + `crypto.ts` (Ed25519/PBKDF2/
      random) + `protocol/ulid.ts` fixed (global `crypto.getRandomValues`). `wrangler dev`
      serves `GET /agents` → `{agents:[]}`, `GET /health`, and CORS preflight. Typecheck
      green; protocol still builds under Node. Deps added: `wrangler`, `@cloudflare/workers-types`.
      **DEFERRED (small follow-up):** the `@hauddy/platform` → `@hauddy/local-hub` rename
      (§0) — it touches `sidecar/daemon.ts` + the lockfile, orthogonal to the port; do it
      as its own step so it doesn't destabilize the daemon build.
- [x] **P1 HTTP control API** ✅ (2026-08-05): full `db.ts` (SQL-backed, mirrors `store.ts`
      method-for-method; passwords now async PBKDF2) + all routes in `hub-do.ts`: signup
      (invite gate + PBKDF2), login, rotate/revoke/me/claims, register, agents,
      `/agents/:id/{nickname,profile}`, friends request/respond/settings (incl auto-accept),
      contacts share/respond + `GET /contacts/:id` + `GET /presence/:id`, unexpose, and
      `POST /admin/invites` (ADMIN_TOKEN-gated allowlist seeding). Verified by
      `packages/platform/test/p1-http.mjs` (20 checks, run against live `wrangler dev`) +
      a manual invite-gate check. **Invite-gate semantic:** empty `invites` table ⇒ signup
      OPEN (mirrors the Node hub's "no allowlist file ⇒ open"); once any invite row exists,
      only listed emails may sign up. **Rate limiter:** on by default (SQLite `rate_limits`
      table, keyed by `cf-connecting-ip`); pass `--var RATE_LIMIT:off` for dev/tests.
      **Presence is offline here** — live presence/`attached`/`can_receive_calls` land in P3.
      **NOTE — `friends.test.mjs` NOT yet repointed:** it drives WS (`connect`/`sendSms`) to
      assert `E_NOT_LINKED`/delivered, so it can only go green after P3 (WS + routing). Its
      HTTP half is already covered by `p1-http.mjs`; repoint it in P3.
- [x] **P2 Files** ✅ (2026-08-05): `files-r2.ts` (`FileStoreR2`) = bytes in R2 at
      `files/<file_id>` + durable metadata in the `attachments` table (fixes the Node
      FileStore's restart-drops-metadata gap). `POST /files` (Bearer required; declared
      + actual 10MB cap → 413; 500MB whole-store quota; metadata via query params or
      `x-hauddy-*` headers) and `GET /files/:id` (owner-or-recipient auth via
      `fileAccessible`, streams `obj.body`). **TTL sweep on a DO alarm** (not setInterval):
      `put` arms `storage.setAlarm(expires_ms)`, `alarm()` → `files.sweep()` deletes expired
      R2 objects + rows and re-arms for the next expiry. Verified by
      `packages/platform/test/p2-files.mjs` (11 checks: round-trip, owner+recipient 200,
      stranger/unauth 403, missing 404, over-cap 413, no-key 401). **Not yet exercised:** the
      24h sweep firing (correct by construction; a short-TTL test hook could confirm timing).
      `files.test.mjs` targets the Node hub w/ autoLink-trust; repoint at the platform in a
      later pass (its shape carries over — Bearer + `fileAccessible`).
- [x] **P3 WS + routing + hibernation** ✅ (2026-08-05): full WS control plane in
      `hub-do.ts` via the Hibernation API. **All per-socket state lives in
      `serializeAttachment`** (handshake scratch + post-auth identity + owned claims) — no
      in-memory Maps, so it survives hibernation. **Presence derives from
      `getWebSockets()`** filtered by deserialized `agentId` (never a Map). Auth: `auth_hello`
      → `auth_challenge`(nonce) → `auth_response` verified with `crypto.subtle` Ed25519 →
      `auth_ok`(+ presence snapshot). `send` routes with consent (`areLinked`), asserts
      `envelope.from`, → `receipt` delivered/queued. **The `messages` table IS the durable
      unacked queue** (`delivered_at IS NULL` = undelivered/unacked; `ack` sets it;
      reconnect redelivers) — the Node hub's in-memory `unacked` map is gone. `claim`/
      `release` = last-writer-wins fork arbitration via per-socket `att.claims`. `capability`
      sets call-ready. Heartbeat via `setWebSocketAutoResponse` (P0). Verified by
      `packages/platform/test/p3-ws.mjs` (10 checks: auth+verified nickname, E_NOT_LINKED,
      linked delivery, live presence online/offline, offline-queue → reconnect redelivery,
      E_IDENTITY_MISMATCH). Now `friends.test.mjs`'s WS half is covered here; a full repoint
      of the existing Node tests at the worker is a later consolidation.
- [x] **P4 Message + call persistence** ✅ (2026-08-05): `messages` on every SMS was
      already wired in P3. This phase added **call capture**: an envelope whose
      `payload.call` is present persists to `calls`/`call_frames` (and is NOT written to
      `messages` — the firm SMS≠Call rule) while still routing to the callee's live socket.
      `persistCall` maps `payload.call.kind`: `invite`→INSERT `calls` (ringing);
      `accept`/first `frame`→`answered_ms`, active; `frame`→INSERT `call_frames` (seq++,
      body+attachments); `close`→`ended_ms`, state `ended` (answered) or `missed`
      (never-answered). Added participant-gated `GET /calls/:id` → `{call, frames}` (the
      first slice of the deferred history read surface). Verified by
      `packages/platform/test/p4-calls.mjs` (14 checks: answered invite→say→say→hangup with
      an ordered 2-frame transcript, invite-greeting-not-a-frame, plain-SMS-doesn't-leak,
      stranger 403 / unauth 401, missed-call state). **Behavior note:** call envelopes are
      delivered live but NOT queued for offline redelivery (real-time; unanswered ⇒ missed) —
      a deliberate consequence of keeping them out of the `messages` queue.
- [x] **P5 Console (human messaging)** ✅ (2026-08-05): `/console/*` as a virtual HTTP
      client over the DB — no WS socket. **SMS inbox** = the `messages` table (SMS to the
      human sit undelivered; `/console/inbox` drains + marks delivered). **Call poll** =
      reconstructed from `calls`+`call_frames` (invite from the row, frames from content,
      close from state), with a per-human seq cursor + active-call pointer in **DO storage
      KV** (`ccall:<humanId>`). **Console presence** = a `console_sessions(human_id, last_ms)`
      table (schema addition) so a human counts online + call-capable for `CONSOLE_TTL_MS`
      (90s) after its last console touch — keeps `presenceOf` synchronous. `ensureHumanAgent`
      mints a keypair-less human (placeholder public key). Routes: identity (GET/POST),
      inbox, sms, call, call/{pickup,say,poll,hangup} — all reuse `routeFromAgent` (same
      consent). Verified by `packages/platform/test/p5-console.mjs` (10 checks: SMS
      round-trip, live call place→invite→frame→say→hangup→ended, derived @handle, online+
      call-capable presence). **Also fixed a stability bug:** the Worker now buffers non-GET
      request bodies before forwarding to the DO (`worker.ts`), so an early return in the DO
      no longer dangles the Worker→DO request stream (was logging `Uncaught TypeError: can't
      read request stream after response sent` and destabilizing `wrangler dev` under load).
      **Full regression: all 65 checks (P1 20 + P2 11 + P3 10 + P4 14 + P5 10) green on one
      instance, zero uncaught errors.**
- [x] **P6 Deploy + cutover** ✅ (2026-08-05): logged in as `admin@example.com`
      (owns the `hauddy.com` CF zone); enabled R2 + created bucket `hauddy-files`. **Staged
      first**: deployed `hauddy-platform-staging` to `*.workers.dev` and ran all 65 checks
      against real Cloudflare infra (green) before touching the domain. Then deployed
      `hauddy-platform` (fresh DO) with the `api.hauddy.com` custom-domain bind = the cutover
      (`api.hauddy.com` had no DNS record beforehand — the tunnel was already gone, so zero
      disruption). Set `ADMIN_TOKEN` secret; seeded invites (`you@example.com`,
      `admin@example.com`) — gate now closed (non-listed → 403). **Production
      smoke passed** over `https://api.hauddy.com` (`prod-smoke.mjs`: signup-through-gate →
      register → WSS Ed25519 auth_ok → presence). Deleted the staging worker; **retired the
      launchd Node hub** (`launchctl bootout com.hauddy.platform`; plist retained for
      reversibility); tunnel already gone. Updated `docs/deploy-alpha.md` to the
      Cloudflare-native reality. **Gotcha:** `wrangler secret put` triggers a new version;
      the first admin/seed calls raced its propagation and returned `E_AUTH_FAILED`/`1104` —
      retry after ~8s once it propagates.

Daemon/app need NO redeploy (they already target `wss://api.hauddy.com`). Verify the
bridge speaks WS the same way (auth_hello → challenge → response → ok).

---

## 10. Risks / open decisions (resolve at execution)

- **Single-DO ceiling.** One DO = one thread = fine for a low-volume alpha; it's the
  global router + global nickname authority. Shard later (per-account or region DO +
  a routing DO) if load grows. Deliberate alpha choice.
- **Two implementations drift** (Node local hub vs Worker platform) — mitigated by the
  conformance suite (§8). Alternative (bigger upfront): extract a transport/storage-agnostic
  core. Not worth it for the alpha.
- ~~**Retention/privacy**: message + call_frames plaintext at rest.~~ **RESOLVED
  (2026-08-05): not a beta concern.** Plaintext at rest accepted for beta. Deferred to
  post-beta: per-account file-storage cap + configurable retention options; E2E as the
  eventual fix (§2). Does not gate the port.
- **`nodejs_compat`**: aim to NOT need it (pure WebCrypto + no node imports). Keep only if
  a dependency forces it.
- **Rate-limit store**: SQLite `rate_limits` table (chosen) vs Cloudflare's native Rate
  Limiting binding — revisit if the table is hot.
- ~~**`store.ts` agent-pair contacts**: keep or drop?~~ **RESOLVED (2026-08-05): KEEP
  BOTH.** They model two distinct layers, not old vs new: `contacts` = **agent-level**
  consent graph (per-agent contact books), `friendships` = **account/user-level** consent
  (the profile pool). Dropping `contacts` would collapse the mental model. Both are
  first-class; port both.

---

## 11. Cost recap (why this is the right endgame)

Free plan fits the alpha ($0); Workers Paid is $5/mo flat with generous headroom. WS
messages bill 20:1; hibernation makes idle bridges ~free; DO SQLite + R2 free tiers cover
alpha storage. No box to babysit, no tunnel, Cloudflare-native TLS/DDoS/WS. The one-time
cost is this port (~a few focused days), not the monthly bill.
