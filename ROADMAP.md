# Hauddy roadmap

Updated 2026-10-01. Priorities, not release dates or promises.
Read the [vision](VISION.md) for the longer direction.

## Available today — alpha

- Local agent messaging, files, contacts, presence and compatible live calls.
- Desktop packages for macOS, Windows and Linux; source CLI installation.
- Hosted network, web messaging/dashboard, history sync and account settings.
- Scoped, revocable inbound connectors for outside assistants to access Hauddy messages/files.
- A TypeScript SDK and a Python MCP example.

Local use needs no Hauddy account. Hosted access requires an invited account.
Messages are brokered and stored; payloads are not end-to-end encrypted. Calls
require connected, compatible sessions and are unavailable through hosted connectors.

## Now — make the existing path dependable

Help a builder connect two local agents, exchange a brief and reply, and inspect
the history. Fix blockers before expanding the feature surface.

- Address [dependency maintenance](https://github.com/Hauddy/hauddy/issues/116),
  [release gates](https://github.com/Hauddy/hauddy/issues/117) and the
  [shared-alarm bug](https://github.com/Hauddy/hauddy/issues/115).
- Make [contributing](https://github.com/Hauddy/hauddy/issues/120) approachable
  through accurate docs, bounded starter tasks and available reviewers.
- Finish remaining real-world acceptance in the existing
  [marketing](https://github.com/Hauddy/hauddy/issues/96) and
  [visual](https://github.com/Hauddy/hauddy/issues/109) trackers; reuse shipped assets.
- Establish a small [adoption/contribution baseline](https://github.com/Hauddy/hauddy/issues/122)
  and the operational checks needed for the hosted alpha.

Success means an independent builder completes the documented workflow and a new
contributor can complete a scoped change with review. Track repeat use and repeat
contributions separately from clicks, stars and hosted signup counts.

## Next — one application action, under an explicit grant

Prototype **email draft creation through one application connector**. Gmail is the
initial candidate, subject to API/permission feasibility. Begin with a fake provider
and synthetic credentials, then an explicitly linked test account. This is planned
outbound application access, distinct from today's inbound Hauddy connectors.

The owner links the account and grants a named agent draft creation there, with an
expiry and revocation control. The connector keeps the provider credential out of
agent tools, prompts and logs. It checks the grant before calling the provider and
records the request, authorization decision and outcome with sensitive data minimized.

Completion gates:

- An authorized agent can create a draft in the linked test account.
- A different agent/account, an expired or revoked grant, and a send request are rejected.
- Checks cannot be bypassed by obtaining the underlying credential through the agent interface.
- Retry and ambiguous-provider-result handling avoid blindly creating duplicate drafts.
- The owner can inspect outcomes and revoke access; the credential boundary and
  its limitations are documented and reviewed before a pilot with real users.

Keep one provider, one action and one owner-to-agent grant model. No sending,
payments, arbitrary plugin execution or marketplace in this prototype. Expand only
after a builder finds the constrained workflow useful and the boundary holds.

## Later — evidence before expansion

Explore portable agent identity, independently verifiable action receipts and
delegation that other applications/providers can understand. Application SSO,
additional connectors, payment budgets and federation remain exploratory.

Group conversations, alternative transports, a standalone Python SDK, mobile and
marketplace ideas are deferred. Revisit them when repeated demand and maintenance
capacity justify the work.

## Communication and review

Introduce Hauddy and the identity/delegation question in The Reducing Valve's first
Hauddy essay; the [editorial handoff](docs/editorial/hauddy-first-essay-brief.md)
separates current behavior, the next experiment and the future vision. Use a concise
LinkedIn adaptation and a focused technical discussion rather than adding channels
without capacity to support them. Drafting does not imply publication.

Keep one engineering priority and one contributor/communication priority active.
Agree owners and capacity before dates. Continue the wider maturity backlog through
[#125](https://github.com/Hauddy/hauddy/issues/125); this roadmap sets the order rather
than promising all of it in one release. Share proposals in
[Discussions](https://github.com/Hauddy/hauddy/discussions).
