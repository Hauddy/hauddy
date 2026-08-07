-- Hauddy waitlist (Cloudflare D1). Apply with:
--   wrangler d1 execute hauddy-waitlist --remote --file=./schema.sql
-- (drop --remote to apply to the local dev D1 used by `wrangler pages dev`)

CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  source     TEXT
);
