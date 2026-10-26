# The Reducing Valve: first Hauddy essay — writer handoff

Updated 2026-10-26. **Editorial brief, not a finished essay or publication approval.**
This replaces the earlier connector/vault experiment brief. Canonical scope:
[vision](../../VISION.md) and [roadmap](../../ROADMAP.md).

## Assignment and reader context

Introduce Hauddy from scratch to technical readers and builders who may never have
encountered the project or MCP. Explain the practical communication problem before
discussing any broader questions. Use the author's personal builder perspective;
do not use an employer title, affiliation, endorsement or internal knowledge.

Hauddy is a personal, non-commercial, open-source project developed on personal time
and equipment. Keep private employment-review correspondence and approval paperwork
out of the essay and repository. Do not claim that approval has been granted.

## Working title and central question

**A Contact Book for AI Agents**

Central question: **How can two agents in different tools exchange a message or file
while the person using them can inspect the conversation?**

Start with a research agent sending a brief to a coding agent and receiving a reply.
Hauddy transports the exchange; it does not assign work, track a task lifecycle or
choose an agent based on its skills. Do not invent anecdotes, measured productivity
gains, adoption figures, customer stories or inevitable future outcomes.

## Current behavior the writer can describe

- Messaging, contacts, presence, compatible live calls and file sharing between agents.
- Local use without a Hauddy account; invited accounts for hosted network access.
- Desktop packages, a web dashboard, a TypeScript SDK and a Python MCP example.
- Inbound connectors that let outside assistants access Hauddy messages/files through
  scoped, revocable tokens. These do not operate external applications on an owner's behalf.
- Brokered and stored payloads, without end-to-end payload encryption. Calls need
  connected, compatible sessions and are unavailable through hosted connectors.
- Handles and keypairs for routing/authentication within Hauddy; contact settings
  that control communication. Account/key binding is not real-world identity certification.

Explain contact acceptance accurately: optional account auto-accept and agent open-link
settings exist. Do not imply every connection always requires a manual acceptance.

## Broader ideas — conceptual only, subject to separate review

The earlier passport / mandate / receipt framing may be discussed as a general
question about identity, permission and evidence. It is not Hauddy's committed
trajectory or a feature announcement. Keep any such discussion clearly separate
from the current messaging utility and grounded only in public information.

Wrapping third-party MCP servers, credential gating, application vaults, delegated
authority, outbound application actions, application SSO and payment controls are
outside the implementation roadmap. The email-draft connector is on hold, including
fake-provider prototypes. Separate written clearance is required before implementation;
interest from readers does not authorize the experiment.

Do not solicit code contributions for these ideas, describe them as “coming next,”
or supply an implementation handoff. An essay about wider questions must not imply
a provider partnership, enterprise governance offering or commercial plan.

## Suggested narrative order

1. Describe a concrete need to move a brief or file between two agent sessions.
2. Introduce Hauddy and show the existing exchange and inspectable history.
3. Explain handles, contact settings, presence and delivery in plain language.
4. State the alpha's access and security limitations.
5. If useful, distinguish communication identity from the broader conceptual question
   of authority to act; label the latter outside the current scope and subject to review.
6. Invite readers to try the messaging workflow, report setup problems or contribute
   a small improvement within the current scope.

## Claim boundaries

| Can describe as current | Must not present as planned implementation |
|---|---|
| Messaging/files, contacts, presence and compatible calls | Third-party MCP wrappers or credential-gated application access |
| Scoped, revocable inbound Hauddy connectors | Outbound email/app actions and application credential vaults |
| Account/key relationships inside Hauddy | Portable ownership/delegation proofs, enterprise identity or application SSO |
| Open-source code and an invited hosted alpha | Paid tiers, commercial services, funding or revenue plans |

The project's non-commercial status concerns the maintainer's activity and does not
change the Apache-2.0 license. Use “Hauddy” with a capital H, preserving lowercase
technical identifiers and URLs. Avoid claims such as “certified owner,” “universal
SSO,” “impersonation-proof,” or claims that identity prevents prompt injection.

## Handoff

Use the [connector guide](../connectors.md), [launch messaging](../launch-messaging.md),
[vision](../../VISION.md) and [roadmap](../../ROADMAP.md) as current product references.
Ask the author for personal experience rather than inventing it.

After author review, a LinkedIn adaptation or Discussion can focus on the existing
messaging workflow and contributor feedback. Drafting is not permission to publish
or send outreach; no external publication is performed by this handoff.
