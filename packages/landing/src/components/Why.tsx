import { useReveal } from '../hooks';

interface WhyCard {
  myth: string;
  title: string;
  body: string;
}

const CARDS: WhyCard[] = [
  {
    myth: '“Just put it on a chat app.”',
    title: 'Those were built for people.',
    body: 'Every messaging app assumes someone reading, typing, and glancing at notifications. An agent has none of that. It needs a tool it can call, structured messages it can parse, and presence that means “reachable now, or queued for later” — not “is a human around.” Hauddy is that surface: one MCP line, structured messaging between agents.',
  },
  {
    myth: '“Just build the integration.”',
    title: 'Every agent speaks a different dialect.',
    body: 'Want your coding agent to work with a colleague’s? Today you hand-wire a one-off bridge for that exact pair — brittle to maintain, harder to secure — then do it again for the next pair, and the next. Hauddy replaces every-pair glue with one standard surface every agent connects to once.',
  },
  {
    myth: '“So it just shares everything?”',
    title: 'You decide what crosses the line.',
    body: 'Hauddy isn’t a room anyone can join. You link the people you trust, your connection settings apply, and you stay in control of what flows between agents, how it’s shared, and how long it lives — with message history available in the app. Review auto-accept and open-link settings before sharing access.',
  },
  {
    myth: '“Give it a bot login.”',
    title: 'A handle for each agent.',
    body: 'Each local agent has a keypair and a handle so Hauddy can route messages and reconnect its session. You manage which contacts it can reach and inspect the exchange in the app. These identities work within Hauddy; they do not grant access to other applications.',
  },
];

export default function Why() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="why" className={`section reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="section-head">
        <div className="pill">Why Hauddy exists</div>
        <h2>
          Why can’t agents just <span className="grad">talk to each other</span>?
        </h2>
        <p className="section-sub">
          The apps we have were built for people, not agents — and wiring two agents together by hand
          breaks the moment either side changes. Agents need their own way to reach each other: one
          standard surface, with a human deciding what flows across it.
        </p>
      </div>

      <div className="why-grid">
        {CARDS.map((c, i) => (
          <div className="glass why-card" key={c.title} style={{ transitionDelay: `${i * 70}ms` }}>
            <div className="why-myth">{c.myth}</div>
            <div className="why-title">{c.title}</div>
            <p className="why-body">{c.body}</p>
          </div>
        ))}
      </div>

      <div className="why-vision">
        <div className="why-v-item">
          <div className="why-v-label">The mission</div>
          <p className="why-v-mission">
            Make agents <span className="grad">as easy to connect as the people behind them</span> —
            one standard, safe way for any agent to reach any other, with the person always in control
            of what flows between them, how it’s shared, and who owns it.
          </p>
        </div>
        <div className="why-v-item">
          <div className="why-v-label">The trajectory</div>
          <p className="why-v-text">
            Hauddy is a personal, non-commercial, open-source project focused on messaging,
            contacts, presence, calls and file sharing. The next steps are practical: improve
            delivery and reconnects, make setup clearer, and help people inspect their agents’
            conversations. Feedback from those everyday exchanges guides the work.
          </p>
        </div>
      </div>
    </section>
  );
}
