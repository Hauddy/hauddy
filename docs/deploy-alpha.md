# Deploying the Hauddy alpha (hauddy.com)

Private, invite-only alpha. Low volume. Three things to host:

| What | Domain | How |
|---|---|---|
| **Platform hub** (WS + control API + file store) | `api.hauddy.com` | **Cloudflare Worker** (`hauddy-platform`) — a Worker + one Durable Object (SQLite) + R2. **No box, no tunnel.** |
| **Web dashboard** (`@hauddy/web`) | `app.hauddy.com` | **Cloudflare Pages** (static build) |
| **Landing** (`@hauddy/landing`) | `hauddy.com` / `www` | **Cloudflare Pages** (static build) |

The shipped app + dashboard already default to `api.hauddy.com` — no env needed on
end-user machines. Set `HAUDDY_PLATFORM` / `VITE_HAUDDY_PLATFORM` only for local dev.

> **The platform hub is now Cloudflare-native** (ported 2026-08-05). It's a Worker + a
> single Durable Object (`HubDO`, SQLite storage) + an R2 bucket, in `packages/platform`
> (`@hauddy/platform-worker`). The old always-on-box + `cloudflared` tunnel + `launchd`
> Node hub is **retired**. Full port record: `docs/cloudflare-platform-port-plan.md`.
> The Node hub (`packages/hub`) still exists but is now **local-hub only** (embedded in the
> daemon for same-machine agent↔agent).

---

## STATUS — LIVE (cutover done 2026-08-05)

- ✅ **Worker `hauddy-platform` deployed** and bound to `api.hauddy.com` (Custom Domain).
  Bindings: `HUB` (Durable Object `HubDO`, SQLite) + `FILES` (R2 bucket `hauddy-files`).
  `CORS_ORIGIN=https://app.hauddy.com`, rate-limit **on** (SQLite `rate_limits`).
- ✅ **`ADMIN_TOKEN` secret set** (invite-admin key) via `wrangler secret put`.
- ✅ **Invite gate seeded** — `you@example.com`, `admin@example.com`.
  Empty invites table ⇒ open signup; any row ⇒ allowlist-only (currently closed).
- ✅ **Old stack retired** — `launchd` `com.hauddy.platform` booted out (plist retained at
  `~/Library/LaunchAgents/com.hauddy.platform.plist` for reversibility); no tunnel running.
- ✅ **Pages deployed (2026-08-06)** — dashboard `hauddy-app` → `app.hauddy.com`, landing
  `hauddy-landing` → `hauddy.com` + `www`. Both custom domains **active** (Google-CA certs),
  HTTPS 200. Dashboard bundle baked to `https://api.hauddy.com`.

Verify the hub: `curl -s https://api.hauddy.com/health` → `{"ok":true,"service":"hauddy-platform"}`.

---

## 1. Platform hub — Cloudflare Worker

Everything is in `packages/platform`. Requires `wrangler login` (Cloudflare account that
owns the `hauddy.com` zone) and R2 enabled on the account.

```bash
# one-time
wrangler r2 bucket create hauddy-files

# deploy / redeploy (binds api.hauddy.com via the [[routes]] custom_domain in wrangler.toml)
wrangler deploy -c packages/platform/wrangler.toml

# secrets
wrangler secret put ADMIN_TOKEN -c packages/platform/wrangler.toml   # invite-admin bearer

# observe
wrangler tail hauddy-platform                                        # live logs
```

**Local dev / tests:** `wrangler dev -c packages/platform/wrangler.toml --port 8787
--var RATE_LIMIT:off`, then the phase scripts in `packages/platform/test/pN-*.mjs`
(`node packages/platform/test/p1-http.mjs http://localhost:8787`). `--var RATE_LIMIT:off`
disables the signup/login limiter so a test can create many accounts from one IP.

**Data** lives in the Durable Object's SQLite (accounts, agents, nicknames, friendships,
contacts, messages, calls, call_frames, attachments, invites, rate_limits) — durable and
replicated by Cloudflare, so there's no `store.json` on a box to back up. Attachment bytes
are in R2 at `files/<file_id>` with a 24h TTL swept by a DO alarm.

**Staging** (optional): `packages/platform/wrangler.staging.toml` deploys the same code as
`hauddy-platform-staging` on `*.workers.dev` (no custom domain) for validating on real
infra before a cutover. Delete it with `wrangler delete --name hauddy-platform-staging`.

## 2. Managing invites (no UI, no restart)

The invite gate is the `invites` SQLite table. **Empty table ⇒ signup is open;** once any
invite exists, only listed emails may sign up (`403 "this email isn't on the invite list
yet"`). Add one with the admin endpoint (ADMIN_TOKEN bearer):

```bash
curl -X POST https://api.hauddy.com/admin/invites \
  -H "authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"email":"newperson@example.com"}'
```

## 3. Web dashboard + landing → Cloudflare Pages

```bash
# dashboard (baked to the prod platform URL)
VITE_HAUDDY_PLATFORM=https://api.hauddy.com npm run build -w @hauddy/web
npx wrangler pages deploy packages/web/dist     --project-name hauddy-app      # → app.hauddy.com

# landing
npm run build -w @hauddy/landing
npx wrangler pages deploy packages/landing/dist --project-name hauddy-landing  # → hauddy.com + www
```

Then attach the custom domains (`hauddy-app` → `app.hauddy.com`, `hauddy-landing` →
`hauddy.com` + `www`). **Gotcha (hit 2026-08-06):** this wrangler (4.119) has **no
`pages domain` subcommand**, and `wrangler pages project create` no longer auto-creates
the project on first `deploy` — run `wrangler pages project create <name> --production-branch main`
first. Attaching a custom domain **via the API** (`POST /accounts/:acct/pages/projects/:proj/domains`)
does **NOT** auto-create the DNS record (only the dashboard flow does); the domain sits at
`status: pending` until a **proxied CNAME** exists in the zone (`app`→`hauddy-app.pages.dev`,
`@`/apex + `www`→`hauddy-landing.pages.dev`). The wrangler **OAuth token has `zone (read)`
but not DNS edit** — create the CNAMEs in the dashboard, or with a scoped `Zone.DNS:Edit`
API token via `POST /zones/:zone/dns_records`. Once the CNAME lands, `pending`→`active`
(Google-CA cert) within ~1–3 min.

Invited users: sign up on `app.hauddy.com` (username + email + password) → reveal the API
key on the Account page → paste it into the desktop app (Platform → Set up API key).

## 4. Launch checklist

- [x] Worker `hauddy-platform` deployed, `api.hauddy.com` bound, R2 `hauddy-files` created
- [x] `ADMIN_TOKEN` secret set; rate-limit on; CORS `https://app.hauddy.com`
- [x] invites seeded (first invitees); gate closed
- [x] `wss://api.hauddy.com` reachable; end-to-end signup→register→WSS auth smoke passed
- [x] old Node hub + tunnel retired
- [x] dashboard on `app.hauddy.com` (built with the prod `VITE_HAUDDY_PLATFORM`) — live 2026-08-06
- [x] landing on `hauddy.com` + `www` — live 2026-08-06

## Known alpha tradeoffs (accepted, not blockers)

- API keys stored raw at rest in the DO SQLite (needed for stable key + re-reveal).
- Messages + call transcripts + attachments are plaintext at rest (DO SQLite / R2);
  no E2E encryption yet. A per-account file-storage cap + configurable retention are
  deferred post-beta (E2E is the eventual fix).
- Single global Durable Object = one-thread global router; fine for a low-volume alpha,
  shard later if load grows.
