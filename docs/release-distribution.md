# Release entry-point checklist

Public distribution: [desktop release assets](https://github.com/Hauddy/hauddy/releases/latest), with [source installation](./source-install.md) for the CLI. npm publication is not part of the release workflow.

Before publishing a release:

- Run `npm run check:entry-points`; keep the README badge driven by GitHub Releases, all supported platform links current, and local versus invited-network requirements explicit.
- Run the source-install CI matrix on macOS, Linux, and Windows. Each runner checks out the release source, runs `npm ci` with an empty temporary npm cache, builds, and runs `npm run smoke:source`. Internal workspace links stay inside that fresh checkout; no global Hauddy package is used.
- Confirm the documented Node/npm prerequisites match the root package engines and CI. If npm distribution is introduced, replace this policy only after all internal dependencies, packaged outputs, native install scripts, and a standalone registry install have been verified.
- Open each built desktop installer on its target OS. Confirm the local MCP endpoint and first-message journey. The source smoke check does not validate installer launch.
- From a signed-out browser, check the product site, demo, setup guide, repository, community invite, latest release page, and all four `/download/` URLs. Record final destinations and HTTP status. A download link that resolves is not an installer execution test.
- Keep directory-owned installation instructions linked to the canonical getting-started/source guides. Third-party listing edits require the listing owner's access; track that work in #94.
- Save the CI run URL, commit, Node/npm versions, OS/architecture, command output, and any skipped checks. Do not describe a local workspace run as a public npm installation.

## Local verification record

See the dated record in [source-install-validation.md](./source-install-validation.md). CI matrix results and signed-out browser checks must be recorded separately when performed.

## Verification and promotion

Both `Release` and `Deploy Sites` call the reusable CI workflow from their own
commit. Tests, workspace typechecks, UI builds, landing HTTP checks and local
Cloudflare integration must succeed before the production job receives any
Cloudflare credentials. Source-install checks and all installer builds are
additional release dependencies. Both workflows use `production-promotion`
concurrency with cancellation disabled, so their production writes cannot overlap.

Commit the version before tagging: run `scripts/set-version.mjs`, regenerate
`packages/sidecar/src/version.ts`, update the lockfile, and review the diff.
`check-release-version.mjs` rejects a tag that differs from the committed package,
lockfile, internal dependency or generated sidecar versions. Release builds no
longer rewrite version numbers after verification.

Dispatch **Release** on a branch to build candidate installers without deploying
anything. Its artifacts are retained for 30 days. Record the exact source SHA,
candidate run and installer checksums when doing native acceptance. A tag-triggered
run repeats verification and builds; compare the published manifest with that
source and record any differences in installer checksums. This is not a promise
of byte-for-byte reproducible installers.

Promotion builds both websites before production writes, records installer
checksums/source SHA/run URL in `release-manifest.json`, and snapshots the current
Worker versions, Pages deployment IDs and all four stable downloads. A failed
snapshot blocks promotion. It then archives versioned installers, creates a draft
GitHub release, deploys the Worker while retaining the old advertised client
version, and deploys both websites. Only then does it replace stable downloads,
advertise the new client version and publish the GitHub release.

This sequence is recoverable, not atomic across Cloudflare services. The four
stable objects can briefly differ during promotion. Production scripts check all
installer checksums before writing any archive or pointer.

## Rollback rehearsal and recovery

`node --test test/release-safety.test.mjs` injects failed verification results into
the workflow dependency model and rehearses recovery after archive, Worker,
website and partial-download promotion against synthetic providers. It also
checks corrupted artifacts, incomplete backups and partial restoration failures.
This verifies orchestration locally; it is not a live Cloudflare recovery drill.

On a failed production step, the workflow restores downloads from the captured
bytes, rolls both Pages projects back to their captured deployments and restores
the previous Worker version distribution (including its version configuration).
All restoration attempts run even if one service fails; an incomplete rollback
fails visibly and records `restore-result.json`. Rollback artifacts are retained
for 30 days; manifests for 90 days. A draft release and versioned installer
archives may remain after failure for inspection.

If the runner is cancelled or lost, download that run's original `rollback-downloads`
(or `rollback-sites`) artifact into a private incident workspace. After reviewing
the recorded source SHA and confirming no newer release should be retained, use
the matching source checkout and existing deployment credentials:

```
node scripts/release-downloads.mjs restore . /absolute/path/to/rollback-downloads
node scripts/release-downloads.mjs restore . /absolute/path/to/rollback-sites sites
```

The first command restores a release; the second restores a sites-only run. Do
not take a new snapshot of a partially promoted release and call it the previous
state. Inspect the restoration result, `/api/version`, both websites and all four
downloads afterward. If the final GitHub publish request had an uncertain outcome,
inspect that release too; a failed client response does not prove it stayed draft.

Worker code rollback does not reverse database migrations, deleted resources or
customer data changes. Releases with incompatible storage/binding changes need a
separate recovery plan and an isolated staging drill before promotion. See
[Cloudflare Worker rollback limits](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/).

## Candidate acceptance record

Before tagging, record these checks against the candidate SHA and actual installer
files in a dated release record. Keep failed, skipped and unavailable checks explicit.

| Check | Required evidence |
|---|---|
| macOS / Windows / Linux native install and launch | OS/architecture, installer SHA-256, launch result, visible main window and local MCP availability |
| First-message journey | Two disposable identities, a sent message and received reply in the real browser/packaged UI |
| Recovery | A deliberately unavailable daemon/network, visible error, reconnect and successful retry without duplicate messages |
| Update | Existing release download/apply-update flow and observed final version; distinguish a manual reinstall |
| UI regression | Named/unnamed agents, contact books, empty/error states, keyboard navigation and narrow window |
| Production promotion | Verification run, manifest, restoration snapshot and post-deploy HTTP checks |

A green source-install matrix or a browser rendering of desktop components does
not fulfill native installer acceptance. #109 and the acceptance portion of #117
stay open until the missing platform evidence is recorded.
