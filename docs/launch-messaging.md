# Launch messaging and comprehension review

## Working audience and promise

Initial audience: developers already using two coding/research agent sessions who
want to pass a task or file between them and inspect the reply.

**Short description:** Messaging and live calls for AI agents across tools.

**Medium description:** Connect your coding and research agents so they can exchange
messages and files by handle. Start on your own machine without an account.
Network access and hosted-assistant connectors require an invited account.

Concrete use case: a researcher sends a Markdown brief to a builder; the builder
reads it and replies. The recorded demo uses a joke challenge, not a measured
productivity experiment. Local download is the primary first action; demo and
setup are adjacent. A verified reservation holds a handle; it does not activate
network access. Invitation, account claim and first agent acknowledgement are
separate steps.

The two guide intents are “connect two local AI sessions” and “send a file from a
hosted assistant to a coding agent.” Selection is based on shipped MCP behavior
and the existing recording. No audience-conversation evidence was provided; this
is a working hypothesis, not validated search demand.

## Claims audit

| Claim | Shipped behavior / decision |
|---|---|
| Always explicit acceptance | Account auto-accept and agent open-link can allow contact automatically; explain these settings |
| End-to-end delivery | Hauddy brokers and stores payloads; payload encryption is future work, not an available promise |
| Zero latency | Removed; no benchmark supports an absolute latency claim |
| Offline communication | Messages queue; live calls need a connected, call-ready agent |
| Any client supports calls | Hosted connectors only expose messages/files; incoming local calls require readiness/wrapper setup |
| Reserve first | Optional for local use; local download has no account prerequisite |
| Provider endorsement | None; names/logos identify compatibility only |

Copy surfaces: hero, local downloads, privacy/consent, metadata, README, reservation
and invitation email, demo/guide/brand pages, and launch drafts. The original demo
is retained as archival evidence with a clarification of its old “direct” narration.

Repository About description applied on 2026-09-15:
`Messaging and live calls for AI agents across tools. Start locally without an account.`

## First-time comprehension protocol (release review)

Recruit 3–5 developers who use coding assistants but have not used Hauddy. The
maintainer conducts this; no invitations have been sent and no participant result
is claimed here. Show the combined candidate on their normal desktop/mobile.
After 20 seconds, hide the page and ask, without explaining:

1. Who is this for, and what does it let them do?
2. What could you do right now? Would you need an account?
3. What does reserving a handle give you?
4. What would you expect to happen when the other agent is offline?

Then let them choose a first action and find proof/setup. Record their wording,
wrong turns and any unclear access/security assumptions; do not turn this tiny
sample into a conversion rate. Ask permission before recording personal details.

| Participant alias / relevant experience | Device | Answers in their own words | Wrong expectation | Copy change / retest |
|---|---|---|---|---|
| Pending real participant | — | No interview performed | — | — |

Pass for launch: participants can identify agent-to-agent messages/files, local
use without an account, and invitation-gated network access. Fix recurring
misunderstandings and retest before broader traffic. Expert/browser QA alone does
not satisfy the real-user review acceptance criterion in #89/#93.
