# Bounded launch distribution plan

Prepared 2026-09-15. Status: drafts and inventory; no posts/submissions made and no
traffic outcomes observed. Use the combined candidate after its release checks.

## Existing listings

| URL | Ownership/contact | Observed copy/install route | Action / checked |
|---|---|---|---|
| https://github.com/Hauddy/hauddy | Hauddy repository maintainers | Current source and releases; About uses approved promise | Source updates in combined candidate; 2026-09-15 |
| https://glama.ai/mcp/servers/Hauddy/hauddy | Has a Claim control; ownership unverified | Search-indexed listing includes old README/npm instructions; direct retrieval unavailable during review | Claim/update existing entry with installer/source path; do not create duplicate; 2026-09-15 |
| https://m8ven.ai/mcp/hauddy-hauddy-170x0p | Third-party indexed audit; ownership unverified, Claim control | Imported Glama snapshot refers to older commit; automated score/security labels are not our validation | Request refresh after canonical update through verified owner UI; 2026-09-15 |

Search is not an exhaustive inventory. Do not repeat third-party audit scores as
security assurances or assume that an “Official” badge proves account ownership.

## Official MCP Registry decision

The [registry quickstart](https://modelcontextprotocol.io/registry/quickstart)
requires server metadata, namespace ownership verification and a supported
package or remote transport. Hauddy's remote MCP uses Streamable HTTP and OAuth;
local usage is a desktop/source installation with no published npm dependency
graph. A local npm entry would advertise an unavailable route. The remote service
requires invitation and a configured account/agent, which would block a new
uninvited visitor.

**Defer a new public registry submission for this round.** Maintain the existing
Glama entry using the working desktop and source-install paths. Before future
registry publication, verify namespace ownership, validate metadata with the
current publisher/schema, disclose the remote invitation prerequisite, and test
an actual fresh-account install. No registry verification or publication is
claimed. Supported installation: https://hauddy.com/#local and
https://github.com/Hauddy/hauddy/blob/main/docs/source-install.md .

## Three initial channels

Operator/owner for all three: **Hauddy maintainer** (operational role; no external
person has been assigned or contacted). One channel per checkpoint keeps failures
diagnosable. The implementation and acceptance test remain one combined batch.

| Channel / audience | Asset | Destination / source | Checkpoint |
|---|---|---|---|
| GitHub release / existing developer followers | 25-second overview + local guide | https://hauddy.com/guides/local-agents?utm_source=github_release_alpha | Baseline, +48h, +7d |
| Existing Discord community / developers already using two assistants | Reply clip + question about handoff friction | https://hauddy.com/demo?utm_source=discord_community_alpha | Baseline, +48h, +7d |
| Existing Glama listing / people seeking MCP messaging | Approved description + working install instructions + brand card | https://hauddy.com/guides/local-agents?utm_source=glama_directory_alpha | Baseline, +48h, +7d |

These identifiers encode channel, medium and this alpha campaign. Do not append
personal data or rely on arbitrary utm_medium/utm_campaign values being retained.

### GitHub release draft

> Let two AI agents exchange a task and a reply through Hauddy. Download the
> desktop app, connect two local MCP sessions with distinct identities, and send
> your first message. Local use needs no account. The short demo shows a recorded
> hosted-assistant file exchange; that network workflow needs an invited account.
> Follow the local guide: https://hauddy.com/guides/local-agents?utm_source=github_release_alpha

### Discord draft

> Are you copying short briefs between your research and coding agents? Hauddy
> lets them exchange messages and files by handle, with a conversation you can
> inspect. Here is a recorded file challenge and reply:
> https://hauddy.com/demo?utm_source=discord_community_alpha
> Local use is free of account setup; hosted/network use is invitation-only.
> Which step of your current handoff is hardest to repeat reliably?

Post only where community rules permit and only after explicit operator approval.

### Existing Glama listing correction draft

> Hauddy — messaging and live calls for AI agents across tools. Connect local MCP
> clients to exchange messages and files by handle. Start with the desktop
> installer or documented source build; a public npm quickstart is not available.
> Hosted connectors require an invited account and support messages/files, not
> calls. Payloads are brokered and stored, not end-to-end encrypted.
> Setup: https://hauddy.com/guides/local-agents?utm_source=glama_directory_alpha

## Results and decision log

Save the private aggregate report before each channel and at its checkpoints
(see acquisition-reporting.md). Page/guide/demo actions are indicators of interest;
download clicks do not prove a working install. Confirm installs through the
reproducible smoke check and voluntary support feedback. Verified reservations
and actual agent activation remain separate measures. Do not divide cumulative
or unmatched counters into a conversion rate.

| Channel | Baseline / 48h / 7d report paths | Observed install problems / verified reservations / activation | Decision |
|---|---|---|---|
| GitHub | Not launched | No observations | Hold until combined acceptance |
| Discord | Not launched | No observations | Hold until combined acceptance |
| Glama | Not submitted | No observations | Verify owner and correct existing listing |

After 7 days: fix any broken entry step; continue a channel if it produces
qualified feedback or successful use worth following up; revise the message if
expectations are wrong; stop amplification if it brings only clicks with no
supported next step. Establish an observed baseline before numerical growth
objectives. No fabricated engagement, endorsements or demand estimates.
