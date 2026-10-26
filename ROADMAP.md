# Hauddy roadmap

Updated 2026-10-26. Priorities, not release dates or promises.
Read the [vision](VISION.md) for the project scope and review requirements.

Hauddy remains a personal, non-commercial, open-source communication project.
Work is limited to messaging, contacts, presence, calls and file sharing between
agents, and maintenance of the infrastructure supporting those features.

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
the history. Focus on the existing feature surface.

- Maintain dependencies, release verification, isolated test environments and recovery
  procedures for the local app and hosted relay.
- Fix message delivery, reconnect, offline queue, history sync and call-readiness defects.
- Improve contact controls, file-sharing reliability and existing inbound connector setup.
- Make [contributing](CONTRIBUTING.md) approachable through accurate docs, bounded
  starter tasks and available reviewers.
- Complete real-world setup and accessibility checks for the existing desktop/web UI.
- Establish a small [adoption/contribution baseline](https://github.com/Hauddy/hauddy/issues/122)
  focused on successful exchanges and useful feedback.

Success means an independent builder completes the documented workflow and a new
contributor can complete a scoped change with review. Track repeat use and repeat
contributions separately from clicks, stars and hosted signup counts.

## Next — improve the same communication workflow

Use reported failures and observed setup attempts to choose the next small fixes.
Improve error messages, documentation, cross-platform installation and test coverage
where those observations show a gap. Continue supporting current messaging clients
and inbound Hauddy connectors within the existing scope.

There is no active outbound application-connector experiment. The previously proposed
email-draft connector, including its fake-provider prototype, is on hold pending
separate written clearance. It must not be treated as the next engineering task.

## Outside the implementation roadmap — separate review first

Wrapping third-party MCP servers, credential gating/vaults, delegated authority,
portable identity, application SSO, outbound application actions, payment controls,
task delegation, capability discovery and enterprise governance remain ideas only.
Do not prototype or implement them before the separate review described in
[VISION.md](VISION.md#ideas-held-for-separate-review).

Other expansion proposals, including group conversations, federation, new transports,
mobile clients and a marketplace/registry, are not commitments. Assess any material
scope change with the reviewing office and obtain clearance before proceeding;
community demand and maintainer capacity do not replace that review.

## Communication and review

Public materials must describe a personal, non-commercial project and the features
people can use today. Keep employer titles, affiliations and implied endorsements
out of promotion. The [editorial handoff](docs/editorial/hauddy-first-essay-brief.md)
uses the existing messaging workflow and labels broader ideas as conceptual only.

Commercialization — pricing, paid services, a business entity, funding or any revenue —
requires a fresh review and written clearance before proceeding. Arrange a six-month
follow-up review and revisit sooner if circumstances change. Approval paperwork and
review dates belong in private records; this roadmap does not assert approval.

Keep one engineering priority and one contributor/documentation priority active.
Reconcile older issues and plans against this scope before starting them, including
[#125](https://github.com/Hauddy/hauddy/issues/125). Share proposals in
[Discussions](https://github.com/Hauddy/hauddy/discussions); proposals do not authorize
implementation outside the current scope.
