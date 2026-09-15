# Combined launch-review candidate — issues #86–95, umbrella #96

Prepared 2026-09-15 against v0.1.20 (`d9bdd392`). All implementation work is on
`codex/fix-install-entry-points`, reviewed and tested as one candidate. Existing
working-copy changes were preserved in the original checkout.

## Coverage

| Issue | Delivered in this candidate | Acceptance beyond local implementation |
|---|---|---|
| #86 | Supported desktop/source path; broken npm instructions removed; isolated source smoke and OS matrix | Clean Windows/Linux CI and correction of external listing copy |
| #87 | Eight prerendered routes, six public sitemap URLs, real crawler resources/404 and private-page policy | Run HTTP script on deployed origin; Search Console if available |
| #88 | Branded social raster/vector card, route metadata, narrow-crop inspection and build/HTTP guards | Actual Meta/LinkedIn sharing-debugger checks after publication |
| #89 | Shared promise/access distinction, claims audit, hero actions, email/docs/About copy | Real representative-user comprehension review; protocol provided |
| #90 | /brand, versioned kit, canonical exports, mascot guidance, current synthetic-data product screenshot | Publish with candidate |
| #91 | Edited overview/reply clips, poster, descriptive captions, original narration transcript, walkthrough | Deployed CDN/mobile hardware checks; no production benchmark inferred |
| #92 | Current badge/platform docs/source commands, harness links, updated connector OAuth docs | Release workflow matrix results |
| #93 | Two initial-HTML guides with real proof, setup, troubleshooting and distinct intent | Audience-conversation validation and invited-provider account walkthrough |
| #94 | Existing-listing inventory, registry decision, three channel drafts/checkpoints/results template | Listing-owner verification, approved posting, real launch results |
| #95 | Shared allowlist, CTA deduplication, first-source concurrency fix, separate verified outcome, private report/CLI | Save production baseline after release, then actual checkpoints |

No real-user interviews, external posts/listing claims, production deployment or
production analytics inspection were performed. Issues remain open for acceptance;
this candidate does not claim those external criteria completed.

## Combined automated result

- `npm test`: **157 passed, 0 failed** (including reservation retries/expiry,
  concurrent attribution, unknown sources, report authorization/private-field
  exclusion, browser action deduplication and existing activation/security tests).
- `npm run typecheck --workspaces --if-present`: passed.
- Landing production build: passed, prerendering 8 routes and checking metadata,
  social raster dimensions, sitemap, private routes, ZIP and media assets.
- Web and desktop-UI builds: passed.
- `npm run check:entry-points` and `npm run smoke:source`: passed; isolated CLI
  help/version, daemon, HTTP MCP discovery and native PTY wrapper.
- Local Pages HTTP: all public/action/unknown routes, query privacy, MIME types,
  ZIP, VTT, poster and video passed. Video Range request returned valid 200 full-file
  fallback locally; checker also validates 206 partial responses when available.
- Actual local Workerd report endpoint and report CLI: approved/unknown source
  grouping, unauthenticated 401 and snapshot deltas passed. Reproducible test:
  `node packages/platform/test/p18-acquisition-report.mjs http://127.0.0.1:8794`
  with local ADMIN_TOKEN=fixture-report-only. Also wired into CI runtime checks.
- Two actual local MCP sessions: distinct research/builder URL IDs, nicknames,
  reciprocal contacts, synthetic brief, inbox receipt and reply passed. Screenshot
  in brand kit records this current UI state.

## Browser and media result

Chromium preview inspected at 1280×720 and 390×844. Home actions available in first
screen; no horizontal overflow on home/guides/brand. Brand assets and both real
screenshots loaded. Synthetic reservation request → fragment-token confirmation →
cancellation passed without contacting production or sending an email. Overview
played to 25.025s on desktop/mobile; captions visibly rendered. Controlled 1 Mibit/s
media proxy delivered 594,215 bytes in 4,662ms and playback completed. See
[media notes](launch-media.md) for test limits and source-edit details.

## Test the candidate together

Preview while this task's servers remain running: http://127.0.0.1:8789 . The form
uses a disposable mock API on 8790, not production: enter `@test-agent` and
`test@example.com`; confirm via
http://127.0.0.1:8789/reservation#token=test-confirmation . The mock only demonstrates
browser states; backend semantics are covered by the SQLite and Workerd tests.
Downloads and sign-in remain real links. The private local report runtime is 8794.

To rebuild normally, run `npm run build -w @hauddy/landing` without
VITE_HAUDDY_PLATFORM; production defaults to api.hauddy.com. For local browser QA,
set VITE_HAUDDY_PLATFORM to the disposable API before building. CI Pages uses a
pinned 2026-08-01 compatibility date so the bundled runtime does not fail when the
wall-clock date advances beyond its supported date.

One release review: check home and both guides, brand download, demo controls and
captions, local install, reservation/invitation/claim, then compare the private
report. Follow [messaging](launch-messaging.md), [distribution](launch-distribution.md)
and [reporting](acquisition-reporting.md) for the human/launch checkpoints. Keep the
PR in draft until these acceptance decisions are made; do not auto-close issues
based solely on local tests.
