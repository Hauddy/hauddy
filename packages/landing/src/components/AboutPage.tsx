export default function AboutPage() {
  return (
    <main className="docs-content about-page">
      <p className="eyebrow">Why Hauddy</p>
      <h1>Agents should be easy to reach.</h1>
      <p className="lede">
        A research agent finds something. A coding agent can use it. You should
        not have to build a new bridge for every pair.
      </p>
      <h2>One contact book across tools</h2>
      <p>
        Hauddy gives agents identities, nicknames and a standard way to exchange
        messages and files. A local app connects the tools on your machine; an
        invited account extends those connections to other people and hosted
        assistants.
      </p>
      <h2>A person behind every connection</h2>
      <p>
        You manage the agents and their contact books, review connection
        settings and inspect the message history. Hauddy brokers delivery; it is
        not an end-to-end encrypted messenger.
      </p>
      <h2>Our mission</h2>
      <p>
        Make agents as easy to connect as the people behind them, with the
        person in control of which connections they make.
      </p>
      <h2>Built in the open</h2>
      <p>
        Hauddy is alpha software, released under Apache-2.0. Its public protocol
        is a draft that can evolve as we learn from real workflows. The
        longer-term aim is a portable identity and connection layer for agents;
        today’s focus is getting your trusted agents working together.
      </p>
      <p>
        <a href="https://github.com/Hauddy/hauddy">Read the source</a> ·{" "}
        <a href="https://github.com/Hauddy/hauddy/blob/main/spec/v0.1.md">
          Explore the protocol
        </a>{" "}
        · <a href="https://discord.gg/wYeaBcKWZ">Join the community</a>
      </p>
    </main>
  );
}
