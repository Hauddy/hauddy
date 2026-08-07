// Full platform SQLite schema (docs/cloudflare-platform-port-plan.md §2).
// Applied once at HubDO init — every statement is idempotent (IF NOT EXISTS), so
// re-running on each construction is safe. No bind params here, so the whole thing
// can go through a single ctx.storage.sql.exec() call.
export const SCHEMA = /* sql */ `
-- ── identity / accounts ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  account_id   TEXT PRIMARY KEY,
  username     TEXT UNIQUE,
  email        TEXT UNIQUE NOT NULL,
  pw_hash      TEXT,
  pw_salt      TEXT,
  pw_iter      INTEGER,
  api_key      TEXT,
  key_masked   TEXT NOT NULL,
  revoked      INTEGER NOT NULL DEFAULT 0,
  auto_accept  INTEGER NOT NULL DEFAULT 0,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_apikey ON accounts(api_key);

CREATE TABLE IF NOT EXISTS agents (
  agent_id       TEXT PRIMARY KEY,
  account_id     TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,
  grant_scope_id TEXT NOT NULL UNIQUE,
  public_key     TEXT NOT NULL,
  local_id       TEXT,
  display_name   TEXT,
  description    TEXT,
  speaking_as    TEXT,
  kind           TEXT NOT NULL DEFAULT 'agent',
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agents_account ON agents(account_id);

CREATE TABLE IF NOT EXISTS nicknames (
  nickname   TEXT PRIMARY KEY,
  agent_id   TEXT NOT NULL REFERENCES agents(agent_id) ON DELETE CASCADE,
  account_id TEXT REFERENCES accounts(account_id) ON DELETE CASCADE,
  bound_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_nicknames_agent ON nicknames(agent_id);

-- reservations = an ACCOUNT-level hold on an @handle before any agent binds it.
-- Shares ONE namespace with nicknames: uniqueness spans both tables (enforced
-- in Db.reserveNickname / bindNickname). A reserved-but-unbound handle does NOT
-- route -- it is just parked for the account until attached to an agent.
CREATE TABLE IF NOT EXISTS reservations (
  nickname   TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(account_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_account ON reservations(account_id);

-- ── consent ────────────────────────────────────────────────────────────
-- friendships = ACCOUNT/user-level consent (profile pool).
CREATE TABLE IF NOT EXISTS friendships (
  pair_key   TEXT PRIMARY KEY,
  account_a  TEXT NOT NULL,
  account_b  TEXT NOT NULL,
  state      TEXT NOT NULL,
  initiator  TEXT NOT NULL,
  policy     TEXT NOT NULL DEFAULT 'allow_all',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_friend_a ON friendships(account_a);
CREATE INDEX IF NOT EXISTS idx_friend_b ON friendships(account_b);

-- contacts = AGENT-level consent graph (per-agent contact books). Kept alongside
-- friendships — two distinct layers, both first-class (plan §10 RESOLVED).
CREATE TABLE IF NOT EXISTS contacts (
  pair_key   TEXT PRIMARY KEY,
  agent_a    TEXT NOT NULL,
  agent_b    TEXT NOT NULL,
  state      TEXT NOT NULL,
  initiator  TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- ── MESSAGES: durable log of every SMS (undelivered = delivered_at IS NULL) ──
CREATE TABLE IF NOT EXISTS messages (
  message_id    TEXT PRIMARY KEY,
  from_agent    TEXT NOT NULL,
  to_agent      TEXT NOT NULL,
  from_nick     TEXT,
  to_nick       TEXT,
  body          TEXT,
  attachments   TEXT,
  created_at    TEXT NOT NULL,
  created_ms    INTEGER NOT NULL,
  delivered_at  TEXT,
  read_at       TEXT,
  account_scope TEXT
);
CREATE INDEX IF NOT EXISTS idx_msg_undelivered ON messages(to_agent, delivered_at);
CREATE INDEX IF NOT EXISTS idx_msg_thread      ON messages(to_agent, from_agent, created_ms);
CREATE INDEX IF NOT EXISTS idx_msg_created     ON messages(created_ms);

-- ── CALLS: one row per call session (SMS vs Call kept DISTINCT) ─────────
CREATE TABLE IF NOT EXISTS calls (
  call_id     TEXT PRIMARY KEY,
  caller      TEXT NOT NULL,
  callee      TEXT NOT NULL,
  caller_nick TEXT,
  callee_nick TEXT,
  state       TEXT NOT NULL,
  started_ms  INTEGER NOT NULL,
  answered_ms INTEGER,
  ended_ms    INTEGER,
  end_reason  TEXT
);
CREATE INDEX IF NOT EXISTS idx_calls_caller ON calls(caller, started_ms);
CREATE INDEX IF NOT EXISTS idx_calls_callee ON calls(callee, started_ms);

-- ── CALL_FRAMES: content spoken during a call (transcript + attachments) ──
CREATE TABLE IF NOT EXISTS call_frames (
  frame_id    TEXT PRIMARY KEY,
  call_id     TEXT NOT NULL REFERENCES calls(call_id) ON DELETE CASCADE,
  from_agent  TEXT NOT NULL,
  seq         INTEGER NOT NULL,
  body        TEXT,
  attachments TEXT,
  created_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_callframes_call ON call_frames(call_id, seq);

-- ── ATTACHMENTS: R2-backed file metadata (bytes at R2 files/<file_id>) ──
CREATE TABLE IF NOT EXISTS attachments (
  file_id     TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  mime        TEXT NOT NULL,
  size        INTEGER NOT NULL,
  owner       TEXT NOT NULL,
  to_ref      TEXT,
  account_id  TEXT,
  created_ms  INTEGER NOT NULL,
  expires_ms  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attach_expires ON attachments(expires_ms);

-- ── INVITES: the email allowlist as a table (replaces allowlist.txt) ───
CREATE TABLE IF NOT EXISTS invites (
  email      TEXT PRIMARY KEY,
  note       TEXT,
  added_at   TEXT NOT NULL
);

-- ── RATE LIMITS: fixed-window counters (survive DO hibernation) ────────
CREATE TABLE IF NOT EXISTS rate_limits (
  key       TEXT PRIMARY KEY,
  count     INTEGER NOT NULL,
  reset_ms  INTEGER NOT NULL
);

-- ── CONSOLE SESSIONS: last activity of an HTTP-driven human (presence) ──
-- The human console has no WS socket, so "online" = a recent console touch
-- (freshness TTL). Kept in SQL so presenceOf stays synchronous.
CREATE TABLE IF NOT EXISTS console_sessions (
  human_id  TEXT PRIMARY KEY,
  last_ms   INTEGER NOT NULL
);
`;
