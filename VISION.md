# Hauddy vision

Updated 2026-10-26. This scope supersedes the earlier connector and delegated-authority direction.

**Make it easy for trusted AI agents to exchange messages and files across tools, with a person able to inspect the conversation and manage contacts.**

Hauddy is a personal, non-commercial, open-source project, developed on personal
time and equipment. Its current scope is messaging, contacts, presence, live calls
and file sharing between agents. The local hub, hosted relay, dashboards and SDK
support those communication features.

## What we are building

Make the existing communication path dependable: connect two agents, exchange a
message or file, receive a reply and inspect the history. Prioritize reliability,
security fixes, clear setup instructions, accessibility and useful contributor feedback.

Local use needs no Hauddy account; hosted network access requires an invited account.
Existing inbound connectors let outside assistants access Hauddy messages and files.
Hauddy brokers and stores payloads; it does not provide end-to-end payload encryption.
Live calls need connected, compatible sessions.

Handles, keypairs and contact permissions serve communication within Hauddy. Contact
presence and call readiness describe reachability. They do not confer authority to
operate external applications or establish enterprise identity. Hauddy transports
messages; it does not assign or track tasks, discover work capabilities, or govern
agents across an enterprise.

## Ideas held for separate review

The following remain conceptual only and are outside the implementation roadmap:

- Wrapping third-party MCP servers or mediating access to their tools.
- Credential gating, application credential vaults and outbound application actions,
  including the previously proposed email-draft connector.
- Delegated authority, portable identity/ownership proofs, action mandates and receipts,
  application SSO, payment controls and enterprise governance.
- Task delegation, capability discovery, and an agent marketplace or enterprise registry.

Do not implement, prototype, pilot or ship these ideas without separate written
clearance from the office reviewing the maintainer's outside activity. A fake provider,
synthetic credentials, a private branch or user demand does not remove this requirement.
Any other material scope change also requires review before work proceeds. Exposing
Hauddy's own messaging MCP server and the existing CLI call-notification wrapper are
part of today's communication scope; they are not third-party tool gateways.

## Project boundaries

- Keep development on personal time and equipment, separate from employment duties.
- Do not use employer confidential information, internal documents or proprietary knowledge.
- Present the project independently: no employer title, affiliation or implied endorsement
  in project promotion, speaker biographies or related public materials.
- Pricing, paid services or tiers, forming a business entity, funding, or revenue of
  any kind require a fresh review and written clearance before proceeding.
- Arrange a follow-up review in six months, or earlier if scope or circumstances change.
  Keep the approval records and exact review date in private administrative records.

These boundaries govern the maintainer's activity; they do not change the Apache-2.0
license or restrict rights granted to downstream users. This document does not claim
that outside-activity approval has been granted.

## How we learn

Invite feedback on the existing communication workflow and small improvements within
that scope. Measure successful setup, reliable exchanges and repeat contributions.
Keep public explanations accurate about current behavior and distinguish conceptual
ideas requiring review from committed work. See the [roadmap](ROADMAP.md) for priorities.
