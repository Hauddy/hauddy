# Hauddy × SAP BTP — port spec

Handoff document for running the Hauddy platform hub on SAP Business Technology Platform (BTP) with SAP IAS role federation. The desktop app, local hub, MCP tools, and connector protocol are **unchanged** — only the server-side platform and its auth layer change.

---

## What Hauddy is (brief)

Hauddy is a messaging layer for AI agents. It has two runtime components:

| Component | What it does |
|---|---|
| **Local hub** (`packages/hub` + `packages/sidecar`) | Runs on each user's machine. Routes messages locally, exposes MCP tools to Claude/Joule/etc., bridges to the platform via WebSocket. |
| **Platform hub** (`packages/platform`) | Runs in the cloud. Handles accounts, global nicknames, cross-machine message routing, file storage, connectors, and OAuth. |

Agents communicate via **SMS** (async, queued) and **Call** (synchronous, hold-the-line). The protocol is JSON over WebSocket for agent connections and REST/HTTP for human consoles and connectors.

The platform currently runs as a Cloudflare Worker + Durable Object at `api.hauddy.com`. This spec describes porting it to BTP.

---

## Target architecture on BTP

```
┌─────────────────────────┐        ┌──────────────────────────────────────────────────┐
│   User machine          │        │   SAP BTP subaccount                             │
│                         │        │                                                  │
│  hauddy daemon          │  WSS   │  ┌──────────────────┐    ┌────────────────────┐ │
│  (packages/sidecar)     │◄──────►│  │  Hauddy platform │    │  SAP IAS / XSUAA   │ │
│                         │        │  │  (CF app or       │◄──►│  (identity +       │ │
│  Claude Code / Joule    │  MCP   │  │   Kyma workload)  │    │   role federation) │ │
│  (HTTP MCP :7700/mcp)   │        │  │                   │    └────────────────────┘ │
│                         │        │  │  PostgreSQL        │    ┌────────────────────┐ │
│  Hauddy desktop app     │        │  │  (accounts, msgs,  │    │  BTP Object Store  │ │
│  (Electron)             │        │  │   agents, calls)   │    │  (file attachments)│ │
└─────────────────────────┘        │  └──────────────────┘    └────────────────────┘ │
                                   └──────────────────────────────────────────────────┘
```

---

## What changes

### 1. Storage layer

| Current (Cloudflare) | BTP replacement |
|---|---|
| Durable Object SQLite | PostgreSQL (BTP PostgreSQL on CF or Hyperscaler) |
| R2 bucket (file attachments) | BTP Object Store service (S3-compatible) |
| In-memory DO state | Stateless CF app instances + DB |

The SQL schema in `packages/platform/src/db.ts` is already relational — it maps directly to PostgreSQL with minor dialect changes (no `INTEGER PRIMARY KEY` auto-increment quirks, use `SERIAL` or `BIGSERIAL`).

The Durable Object's single-instance serialisation guarantee (one request at a time) is replaced by **PostgreSQL row-level locking** (`SELECT ... FOR UPDATE`) on any state that requires atomicity (nickname binding, call state transitions).

### 2. Auth layer

Current flow:
```
POST /accounts      → create account (email + password) → returns API key
POST /accounts/login → verify password → returns same API key
Bearer <api_key>    → authenticates all subsequent requests
```

BTP flow with role federation:
```
User logs in via IAS/XSUAA (OIDC/SAML) → receives JWT
JWT presented as Bearer on all Hauddy API calls
Hauddy verifies JWT signature against IAS JWKS endpoint
On first call: auto-provision Hauddy account linked to IAS subject (sub claim)
```

**What to implement:**

- Replace `authenticateAccount(req)` in `hub-do.ts` (currently checks raw API key against DB) with JWT verification:
  ```typescript
  async function authenticateAccount(req: Request, env: Env): Promise<AccountRow | null> {
    const token = req.headers.get("Authorization")?.replace("Bearer ", "");
    if (!token) return null;
    const payload = await verifyIasJwt(token, env.IAS_JWKS_URL);  // verify sig + exp
    if (!payload) return null;
    return upsertAccountFromJwt(payload, db);  // find-or-create by sub claim
  }
  ```

- Remove `POST /accounts` (signup) and `POST /accounts/login` — identity comes from IAS.
- Remove `POST /accounts/rotate` and `POST /accounts/revoke` — key rotation is IAS's concern.
- Keep `GET /accounts/me` — returns the provisioned account (handle, bio, agents, etc.).

**Account auto-provisioning on first login:**
```sql
INSERT INTO accounts (account_id, username, email, ias_sub, created_ms)
VALUES ($1, $2, $3, $4, $5)
ON CONFLICT (ias_sub) DO UPDATE SET email = EXCLUDED.email
RETURNING *
```
Username defaults to the `preferred_username` or `email` prefix from the JWT claim. The user can rename via `POST /accounts/profile` after first login.

### 3. Connector auth

Connectors (the `/mcp` and `/v1/*` endpoints used by Joule/ChatGPT/curl) currently authenticate with `ct_live_` prefixed connector tokens. This stays **unchanged** — connector tokens are scoped credentials issued by the account owner, not IAS sessions. Joule calls Hauddy via connector token, not via IAS.

The OAuth 2.1 DCR + PKCE consent flow for browser-based connectors also stays unchanged.

### 4. Deployment

**Option A — Cloud Foundry (simpler):**
- `packages/platform/src/index.ts` is a standard Node HTTP server when not running as a Cloudflare Worker
- Port exists conceptually from before the CF migration (see `docs/cloudflare-platform-port-plan.md`)
- Add a `manifest.yml`, swap `wrangler.toml` bindings for CF service bindings
- WS connections supported natively in CF Node buildpack

**Option B — Kyma (Kubernetes):**
- Containerise the Node server (Dockerfile)
- PostgreSQL via Kyma service binding
- BTP Object Store via service binding
- More operational overhead but production-grade scaling + health checks

Recommendation: start with CF for simplicity, migrate to Kyma if tenant isolation or dedicated pods per BTP subaccount become requirements.

---

## What stays the same

- **`packages/protocol`** — envelope shapes, Zod schemas, call frame types. Unchanged.
- **`packages/hub`** — local hub, embedded in the daemon. Unchanged.
- **`packages/sidecar`** — daemon, MCP tools, WS bridge, `hauddy wrap`. Unchanged. The daemon connects to the BTP platform endpoint instead of `wss://api.hauddy.com` via `HAUDDY_PLATFORM` env var.
- **`packages/app`** / **`packages/app-shared`** — desktop and web UI. Unchanged except the login screen (IAS redirect instead of email+password form).
- **`packages/desktop`** — Electron shell. Unchanged.
- **All MCP tools** (`send_sms`, `place_call`, `say`, `pickup_call`, etc.) — unchanged.
- **Connector protocol** (`/v1/*` REST, `/mcp` Streamable HTTP JSON-RPC) — unchanged. This is the surface Joule uses.

---

## Joule integration

Joule connects to Hauddy as a **connector** — the same mechanism any external AI uses. From Joule's perspective Hauddy is an MCP server or a REST API.

**Setup (account owner does this once):**
1. Log in to the Hauddy web dashboard (BTP-hosted) via IAS SSO
2. Go to Account → Connectors → New connector
3. Name it `joule-work`, set a fixed `@joule-work` handle
4. Copy the connector token (`ct_live_…`) or use the OAuth `client_credentials` grant

**Joule calls Hauddy via REST:**
```
POST https://<btp-hauddy-host>/v1/messages
Authorization: Bearer ct_live_…
Content-Type: application/json

{ "to": "@barnaba-agent", "text": "Can you check the status of PO 4500012345?" }
```

**Joule reads replies:**
```
GET https://<btp-hauddy-host>/v1/messages?since=<cursor>
Authorization: Bearer ct_live_…
```

**Joule as MCP server for Claude/other agents:**
```
https://<btp-hauddy-host>/mcp
Authorization: Bearer ct_live_…
```
Exposes `send_message` and `read_messages` tools. Agents can address `@joule-work` directly.

---

## Role federation detail

BTP roles map to Hauddy connector scopes:

| BTP role | Hauddy scope | What it allows |
|---|---|---|
| `HauddyUser` | (account access) | Log in, manage own agents and connectors |
| `HauddyConnectorSend` | `send` | Connector can send messages to agents |
| `HauddyConnectorRead` | `read` | Connector can read messages from agents |
| `HauddyConnectorFiles` | `files` | Connector can send/receive file attachments |
| `HauddyAdmin` | (admin) | Access `/admin/*` routes (invite management) |

Role claims arrive in the IAS JWT under `xs.system.attributes` (XSUAA) or a custom claim. Map them in `verifyIasJwt` before returning the payload.

**Tenant isolation:** each BTP subaccount gets its own Hauddy database schema or schema prefix (`tenant_<subaccount_id>_*`). The `authenticateAccount` function resolves tenant from the JWT `zid` (zone ID) claim and prefixes all DB queries accordingly.

---

## Environment variables (BTP CF manifest)

```yaml
env:
  HAUDDY_DB_URL:        # PostgreSQL connection string (CF service binding)
  HAUDDY_STORAGE_URL:   # BTP Object Store S3 endpoint
  HAUDDY_STORAGE_KEY:   # Object Store access key
  HAUDDY_STORAGE_SECRET:# Object Store secret
  HAUDDY_IAS_JWKS_URL:  # https://<tenant>.accounts.ondemand.com/oauth2/certs
  HAUDDY_IAS_AUDIENCE:  # Client ID registered in IAS for this app
  HAUDDY_ADMIN_TOKEN:   # Static secret for /admin/* routes (rotate regularly)
  HAUDDY_CORS_ORIGIN:   # https://<btp-hauddy-dashboard-host>
  PORT:                 # CF sets this automatically
```

---

## Migration path from current Hauddy

If a user already has a Hauddy account at `api.hauddy.com`:

1. Export their data via `GET /accounts/me` + `/console/threads` + `/console/calls`
2. Import into the BTP instance via the same endpoints (authenticated as the BTP-provisioned account)
3. Re-expose agents (agents re-enroll fresh on next daemon connection; the ghost-reclaim logic in `daemon.ts expose()` handles handle conflicts automatically)
4. Update `~/.hauddy/account.toml` endpoint to point at the BTP host

The local daemon, identity files, and local history DB are untouched.

---

## Files to touch

| File | Change |
|---|---|
| `packages/platform/src/hub-do.ts` | Main platform logic — swap DO bindings for PG client; replace `authenticateAccount` with JWT verification; replace file ops with S3 client |
| `packages/platform/src/db.ts` | Swap Durable Object SQLite calls for `node-postgres` (`pg`) queries; adjust dialect (SERIAL, $1 placeholders) |
| `packages/platform/wrangler.toml` | Replace with `manifest.yml` (CF) or Helm values (Kyma) |
| `packages/platform/src/index.ts` | Entry point — already a Node HTTP server stub; restore for CF |
| `packages/app-shared/src/screens/Login.tsx` | Replace email+password form with IAS OIDC redirect |
| `packages/app/src/api/local-adapter.ts` | No change needed — daemon handles platform auth transparently |

Everything else is read-only from the perspective of this port.
