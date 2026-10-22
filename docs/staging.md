# Isolated staging

The `hauddy-platform-staging` Worker has a separate Durable Object namespace,
`hauddy-staging-files` and `hauddy-staging-releases` R2 buckets, and the
`hauddy-staging-waitlist` D1 database. Names and the provisioned D1 ID are recorded
in `packages/platform/wrangler.staging.toml`. It has no custom production route.

Run `node scripts/check-staging-isolation.mjs` before deployment. CI rejects
production bucket/database references (including preview bindings), an external
production Durable Object namespace, disabled public rate limits, production
browser origins and enabled outbound email. Local integration tests use the
staging configuration with disposable storage; only those local runs override
rate limiting.

Outbound email is disabled through `EMAIL_DELIVERY=disabled`, even if a Resend key
is mistakenly installed. Reservation requests fail closed and password-recovery
requests retain their neutral response without delivering mail. Use local
synthetic-provider tests for successful email/reset flows. Enabling real staging
mail requires a separate change with dedicated credentials, test-recipient
restrictions and staging-specific links; never copy production email credentials.

The staging `RELEASES` bucket is intentionally separate and initially empty.
Download routes may return 404 until synthetic or candidate artifacts are uploaded
there. Never bind it to production downloads just to make a smoke test pass.
The CORS origin supports a local browser UI at `http://localhost:5173`.

## Provision and deploy

The dedicated resources were provisioned on 2026-10-22. For a replacement
environment, create dedicated buckets and D1, update the staging database ID,
apply `packages/landing/schema.sql` to that database, and set a unique staging
`ADMIN_TOKEN`. Do not copy production Durable Object state, customer files or
account credentials. Keep one synthetic invite in the staging allowlist so signup
is invitation-only. Deploy explicitly with:

```
node scripts/check-staging-isolation.mjs
npx wrangler deploy --config packages/platform/wrangler.staging.toml
```

Synthetic remote checks require the staging-only administrator token in
`HAUDDY_STAGING_ADMIN_TOKEN` and reject any origin other than the dedicated Worker:

```
node scripts/staging-smoke.mjs https://hauddy-platform-staging.barnaba-barcellona.workers.dev
```

The script creates disposable `.test` accounts, uploads/reads an attachment,
checks account deletion and isolation, exercises neutral recovery/invalid reset
handling, and confirms reservation mail is disabled. It deletes its accounts in
cleanup. Synthetic invitation entries remain to preserve the invite gate.

## Verification — 2026-10-22

- Deployed staging Worker version `0899debd-7ffd-4ea3-9e29-e1c461209bb4` with the
  dedicated R2/D1 bindings and disabled email; initialized only the new D1 schema.
- Remote synthetic upload/read, deletion, unrelated-account preservation,
  disabled reservation mail and recovery error handling passed. Test accounts
  were deleted afterward. No production resource was a test destination.
- Local platform regressions cover successful reset/replay behavior, attachment
  expiry, cleanup failures and recovery. `p19-alarms.mjs` exercises real Workerd
  alarm firing with disposable SQLite/R2/D1; remote expiry was not accelerated.
- Configuration tests reject nine unsafe staging mutations. The mail regression
  proves no outbound fetch occurs even when a provider key is present.

This is staging isolation evidence. A live release rollback drill and packaged
installer acceptance remain separate release work. Before destructive staging
experiments, re-run the guard and use synthetic state only.
