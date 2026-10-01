# The Reducing Valve: first Hauddy essay — writer handoff

Prepared 2026-10-01. **Core concepts and editorial brief, not a finished essay.**
The next writing agent should develop the full body in the author's voice.
Canonical direction: [vision](../../VISION.md) and [roadmap](../../ROADMAP.md).

## Assignment and reader context

This is The Reducing Valve's first essay introducing Hauddy. Assume the reader has
never encountered the project, agent identities, MCP or the founder's work on it.
Explain the problem and introduce the software before discussing its trajectory.
Do not refer to earlier Hauddy essays or assume a launch announcement has happened.

The audience is thoughtful technical readers, AI builders and people interested in
how software changes human agency. Explain an agent simply: software that can carry
out steps and use tools on someone's behalf, rather than only respond in a chat.

The existing communication strategy gives The Reducing Valve the ideas, Barnaba the
builder's perspective, and Hauddy the practical implementation. Preserve that
relationship. The essay should be useful even to someone who never installs Hauddy.
Keep the ambition candid and the present-day product concrete. No invented personal
anecdotes, adoption figures, customer stories or claims that the future is inevitable.

## Working title and central question

**Who Sent This Agent? Identity and Authority on the Agent Internet**

Central question: **When an agent says “I'm acting for you,” what should another
system require as proof?**

Thesis: As agents communicate and act through applications, identity and delegated
authority need to travel in a form other systems can verify and enforce. Open
implementations and interoperable providers could make that infrastructure available
across tools. Hauddy begins with communication and is exploring a small next step:
handling application connections and permissions for agents.

Treat increasing agent-to-agent activity as the motivating possibility. Do not
predict that human messaging will disappear or that every application will adopt
one new identity provider.

## Introduce Hauddy in plain language

Facts the writer can use:

- Hauddy is an open-source alpha for messaging and live calls between AI agents
  across tools. A research agent can send a brief or file to a coding agent and
  receive a reply, with history a person can inspect.
- Local use does not need a Hauddy account. The hosted network requires an invited
  account. Desktop packages, a web dashboard, a TypeScript SDK and a Python MCP
  example exist; a standalone Python SDK is not being claimed.
- Current hosted connectors let an outside assistant access Hauddy messages/files
  through a scoped, revocable identity. They do not yet operate Gmail, Teams or payments.
- Hauddy brokers/stores payloads. It is not currently end-to-end encrypted.
- The code is open source and the hosted service is centrally operated. Account/key
  binding inside that service is not certification of a person's legal identity.

Possible introductory material, to rewrite rather than paste as finished copy:

> I'm building Hauddy, an open-source way for AI agents to exchange messages and
> files across tools. The starting point is practical: give a research agent a way
> to pass work to a coding agent, and let the person behind them inspect the exchange.
> Working on that problem raises a larger question: when software speaks or acts
> for someone, how should the receiving system know whose authority it carries?

## The concepts to develop

### 1. An address and a claim of ownership are insufficient

A familiar email address, display name or agent handle may help route a message.
The receiving system also needs evidence of the agent, its relationship to an
account, and the authority behind this particular action.

Existing email, messaging and identity systems already authenticate accounts.
Explain the missing context when an agent acts through one; do not claim those
systems have no security or that changing the transport solves impersonation.

### 2. Keep identity, permission and evidence distinct

| Reader-friendly idea | Meaning |
|---|---|
| Passport | Which agent is acting and what relationship to an account/organization is attested |
| Mandate | Which actions it may take, in which application, under what limits and until when |
| Receipt | Evidence of the requested action, the authorization used and the outcome |

“Agent passport” is a metaphor for the trajectory, not an existing product or legal
credential. A valid signature proves use of a signing credential; it does not prove
which model composed the text, that the agent is uncompromised, or that its request
is sensible. A human or application still decides which issuers and claims to trust.

### 3. Carry agent context into existing applications

Use one email example to make the idea concrete. **This is hypothetical:** an email
leaves the owner's linked account with verifiable evidence of the specific agent,
the owner/account relationship and the authorization used. The evidence binds to
the particular content and recipients so it cannot simply be pasted onto another
message. A compatible verifier would be needed; no native Gmail badge is promised.

Teams illustrates the same principle with permission to post in one channel.
A purchase is a later, higher-stakes extension: one account, selected merchants,
per-transaction and cumulative limits. A spending limit needs durable accounting,
concurrency control and safe retries; writing a budget into a credential is not
sufficient. These examples do not assert current provider API capabilities.

### 4. The connector and vault make a useful first step

Credential storage, token refresh, provider-specific calls, permission checks and
failure handling are recurring implementation work for agent builders. Hauddy's
value proposition can extend to handling that work behind a consistent interface.

Conceptual flow:

1. The owner links an application and grants an agent a narrow action.
2. The agent requests the action through Hauddy.
3. The connector checks the grant, including expiry and revocation.
4. The connector uses its protected application credential and records the result.

**The agent requests an action; it never retrieves the underlying vault secret.**
An unrestricted credential available through another route would undermine this
boundary. Permissions must be enforced by the application or by the connector that
controls access. Protected storage alone does not make a safe action system.

The actual next experiment is smaller than the hypothetical email example:
**create an email draft through one provider, initially using a fake provider and
then a linked test account.** Gmail is the candidate, pending API/permission review.
Sending, portable signatures and payments are outside that first prototype.

### 5. An open ecosystem can include privately operated providers

Hauddy could operate one trusted service while publishing software other providers
can run. The wider goal requires compatible formats, independently checkable proofs,
explicit issuer policies and support for different providers. Open-source code is
one part of that goal; it does not by itself deliver interoperability.

Build on existing identity/authorization standards. Do not claim Hauddy invented
delegation, already implements federation, or should become the sole authority for
agents. Disclose only the identity information an action needs; avoid proposing a
public global dossier of an owner's agents and activity.

## Suggested narrative order

1. Open with a clearly hypothetical message: it comes from a familiar account, but
   an agent performed the action. What exactly has been authorized?
2. Explain why more autonomous action makes that question practical.
3. Introduce Hauddy, the current two-agent workflow and the founder's reason for
   investigating the problem. Ask the author for any genuine personal anecdote.
4. Develop passport / mandate / receipt through the email example.
5. Explain the connector/vault as useful infrastructure and describe the deliberately
   small draft-creation experiment.
6. Expand to interoperable providers and application access as a direction, naming
   the unsolved trust and enforcement questions.
7. Close by inviting builders to challenge the model, try the existing messaging
   workflow, or contribute a small implementation/documentation improvement.

Avoid turning the piece into a product catalogue, standards tutorial or funding
pitch. Introduce purchases only briefly to show why the distinction matters.

## Claim boundaries for the writer

| Can describe as current | Must describe as planned or exploratory |
|---|---|
| Agent messaging/files, identities and inspectable history within Hauddy | Application credential vault and outbound application connectors |
| Scoped, revocable inbound Hauddy connector tokens | Gmail/Teams actions under per-agent grants |
| Account/key relationships within Hauddy | Portable ownership/delegation proofs or real-world identity assurance |
| Open-source implementation and centrally operated hosted service | Multiple interoperable issuers, application SSO and independent verification |
| A small contributor-focused alpha | Payment controls, a plugin marketplace or ecosystem-scale adoption |

Use “Hauddy” with a capital H. Preserve lowercase in technical identifiers and URLs.
Use “acting for a linked account” unless stronger ownership verification is actually
established. Avoid “impersonation-proof,” “certified owner,” “universal SSO,” and any
suggestion that identity prevents prompt injection or all misuse.

## Sources and editorial handoff

Use these as grounding, not as evidence Hauddy implements the standards:

- [RFC 8693, delegation versus impersonation](https://www.rfc-editor.org/rfc/rfc8693.html#section-1.1):
  the acting party can remain distinct from the party it represents.
- [RFC 9700, access-token privilege restriction](https://www.rfc-editor.org/rfc/rfc9700.html#section-2.3):
  constrain tokens by application/resource/action and enforce those constraints.
- [W3C Verifiable Credentials Data Model 2.0](https://www.w3.org/TR/vc-data-model/):
  issuer, holder and verifier roles; checking a credential does not establish the
  truth of every claim it contains.
- [Current connector documentation](../connectors.md) and
  [launch messaging](../launch-messaging.md): product scope and current claims.

For the next writer: deliver a full first-essay draft with enough context for a new
reader, the hypothetical email example, an honest introduction to Hauddy, and a
bounded invitation to participate. Preserve the distinction between shipped product
and vision. Ask the author to supply personal experience rather than inventing it.

After the author edits the essay, derive one LinkedIn post around the opening
question and a GitHub Discussion around the narrow connector/grant model. The full
essay belongs on The Reducing Valve. No essay, post or outreach has been published
as part of this handoff.
