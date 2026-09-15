# Acquisition reporting

The existing operational waitlist and lifecycle counters are preserved. Additional
anonymous actions: `page_view`, `download_click`, `demo_play`, `guide_open`.
`form_start` remains supported. Browser events cannot submit lifecycle outcomes.

Approved sources: hero, closing, landing, campaign (unknown fallback), and
`github_release_alpha`, `discord_community_alpha`, `glama_directory_alpha`.
The latter encode channel + medium + alpha campaign; only utm_source is read.
No arbitrary medium/campaign/query text, URL, email or handle enters CTA reporting.
Defaults live in protocol/src/acquisition.ts and platform/wrangler.toml. New labels
must be reviewed in both frontend shared allowlist and deployment config. The
server can additionally accept reviewed ACQUISITION_CAMPAIGNS labels for API users;
browser support requires the shared allowlist release too.

Browser attribution is first approved source in sessionStorage for that tab;
unknown input becomes `campaign`. Storage holds only source and sent flags, no
visitor ID. Actions are best-effort once per event per tab session, including
in-flight deduplication; failed sends can retry on a later action. New tabs,
storage clearing, blocked storage, bots and multiple devices prevent unique-person
measurement. No fingerprinting or cross-device identifier join is introduced.
The operational waitlist keeps its first source through retries and expired holds.

| Event | Meaning / denominator limits |
|---|---|
| page_view | One tracked public-page visit per tab session, not per URL or person |
| guide_open | First guide visit or guide-link click per tab, not completion |
| download_click | First download/release link click, not installed software |
| demo_play | First play event per tab, not watch time or completion |
| form_start | Best-effort first form interaction per tab; old clients/retries differ |
| request | Accepted reservation request attempts, including repeats |
| verification | Successful email-token verifications, including later resend verification |
| verified_reservation | Pending-to-verified transition since this release; distinct from token retry count |
| invitation / claim | Existing operational lifecycle events |
| activation | First actual non-human message acknowledgement for a waitlist member; not a click or reservation |

## Private report

`GET /admin/acquisition/report`, Authorization Bearer ADMIN_TOKEN. No query filters.
Only approved source/event/count fields, generation time, schema version and
caveats are returned. No email, credential, token, handle, message or raw source.
Unknown stored source labels regroup into campaign; unknown events are excluded.
The report is cumulative since each counter's introduction; it has no historical
cohort/time filtering. Action counters are best-effort public signals and can be
inflated; they are not billing or security evidence. A separate rate-limit bucket
keeps CTA traffic from exhausting reservation/recovery limits.

```sh
# Set HAUDDY_ADMIN_TOKEN securely in your environment; never put it in the URL.
node scripts/acquisition-report.mjs > /private/tmp/hauddy-baseline.json
# At the next checkpoint, save totals and deltas against the earlier snapshot:
node scripts/acquisition-report.mjs /private/tmp/hauddy-baseline.json > /private/tmp/hauddy-checkpoint.json
```

HAUDDY_REPORT_ORIGIN overrides the default api.hauddy.com for a disposable local
fixture. Remote origins require HTTPS. Never commit the token or operational
exports. Negative deltas signal reset/regrouping. Counters with different coverage
are not matched conversion denominators; no conversion rate is automatically
computed. Privacy policy describes aggregate actions and session storage.
