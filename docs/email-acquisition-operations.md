# Email recovery and handle pre-registration

The platform Durable Object is the authority for active handle holds and waitlist
membership. The landing page calls its public API; the existing Pages email-only
waitlist endpoint remains compatible with older clients. Both paths use the same
D1 marketing table, whose email primary key prevents duplicate subscriptions.

## Deployment order

1. Confirm `hauddy-waitlist` exists with `packages/landing/schema.sql` applied.
   The platform's `WAITLIST_DB` binding references this existing database. Do not
   replace or clear it when deploying.
2. Provision `RESEND_API_KEY` on **hauddy-platform**, using the established secret
   manager or `wrangler secret put RESEND_API_KEY -c packages/platform/wrangler.toml`.
   A secret on the landing Pages project is not automatically available to the
   Worker. The sender `hello@hauddy.com` must be verified with Resend.
3. Optionally set `ACQUISITION_CAMPAIGNS` to comma-separated, reviewed campaign
   labels (letters, numbers, underscores and hyphens, at most 48 characters each).
   `hero`, `closing` and `landing` are always allowed. Other `utm_source` values are
   grouped as `campaign`; arbitrary query strings never become analytics labels.
4. Deploy the platform before the landing and web builds. Schema additions are
   additive and applied on Durable Object initialization. Use the existing CI/CD
   workflows for release and website deployment.
5. With a controlled mailbox, verify request → confirmation → invitation → signup
   with a separate personal username → authenticated claim. Check recovery email,
   single-use reset, old-key invalidation and reconnection. Local tests mock Resend;
   they do not establish production sender configuration or deliverability.

Without the Worker email secret, reservation requests return a retryable service
error. Recovery requests remain deliberately neutral even when mail is unavailable.
Do not advertise production recovery as ready before the mailbox check succeeds.

## Lifetimes, retries and abuse limits

Pending holds last 24 hours; verified holds last up to 180 days. The first invitation
starts a fixed 30-day claim deadline. Resends do not extend a hold. Active holds
block live binding, account reservations and signup usernames in the same SQL
namespace. Verification and claim require emailed, single-use proof; the account
email alone is insufficient. Claim preserves the customer's personal username.

The first pending request returns a cancellation receipt for correcting a typo.
That receipt cannot cancel a verified hold. Subsequent anonymous requests return
opaque receipts without disclosing whether an email already owns a hold. The
verified owner can request another confirmation email for management. Cancellation
releases the handle but retains waitlist membership. Expiry releases the namespace
immediately; alarms clean expired metadata within roughly an hour.

IP limits are 30 mutations per 15 minutes, with a separate 120-per-15-minute
availability budget. Reset and reservation email requests each allow three per
email per 15 minutes. Email counter keys are hashes. These are application limits,
not a replacement for edge abuse controls. `RATE_LIMIT=off` is for local tests only.

Tokens contain 256 random bits and are stored only as SHA-256 hashes. Links put the
proof in a URL fragment and require an explicit POST, so link-preview GET requests
do not consume it. Reset tokens last 30 minutes and are invalidated by password
changes. Reset rotates the account key and disconnects account sockets; independent
connector tokens are unchanged.

The hold and canonical waitlist member are written atomically. D1 mirroring is an
idempotent outbox: failed or ambiguously acknowledged writes remain pending and an
alarm retries them in batches of 100. A mail failure cannot verify ownership. An
initial undelivered pending hold is released if no concurrent resend is active;
existing holds survive failed resends. A failed invitation email leaves the invite
recorded and can be resent through the existing admin invite operation.

## Observability and retention

`acquisition_events` holds aggregate counters by approved source for `form_start`,
`request`, `verification`, `invitation`, `claim` and `activation`. Request and form
counts include retries/visits and are not unique-user conversion rates. Activation
is counted once per operational waitlist member when a non-human agent acknowledges
an actual SMS. Queued sends alone do not count. The first acknowledgement timestamp
is stored with the waitlist member solely to deduplicate this metric. No message
content, email, credential or token is copied into the aggregate event table.

The operational tables `preregistrations`, `email_tokens` and `waitlist_members`
contain personal data and should not be exported as analytics. Waitlist-removal
requests must remove the member from both the canonical DO and D1 store, as well as
active holds/tokens, to prevent a pending mirror retry re-adding an address. The
privacy page lists the support contact and waitlist retention commitment.

## Local verification

Run `npm test`, all workspace typechecks, and web, landing and app-ui builds. CI also
runs the local workerd HTTP/sync/deletion checks. Backend email tests exercise real
handler and SQLite transaction code with a mocked mail provider; UI tests cover
resend, expiration, claim authentication, stale availability, and setup progress.
