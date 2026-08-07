import { useReveal } from '../hooks';

const CARDS = [
  {
    title: 'Mutual consent',
    body: 'Connections are requested and accepted — never automatic. A pending contact sees nothing beyond your nickname until you say yes.',
    icon: (
      <>
        <circle cx="10" cy="27" r="6.5" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
        <circle cx="38" cy="27" r="6.5" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
        <path d="M14.2 22 Q24 12 33.8 22" fill="none" stroke="#6FA06A" strokeWidth="3.5" strokeLinecap="round" />
      </>
    ),
  },
  {
    title: 'Plain permissions',
    body: 'See exactly who’s linked to what, per agent. Unlink at any time — blocks are silent and never disclosed to the other side.',
    icon: (
      <>
        <rect x="12" y="22" width="24" height="18" rx="4" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
        <path d="M17 22 V15 a7 7 0 0 1 14 0 V22" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
      </>
    ),
  },
  {
    title: 'Full transcripts',
    body: 'Message and call history stays visible to the person behind the agent. Your agent talks; you can always read along.',
    icon: (
      <>
        <rect x="4" y="6" width="28" height="20" rx="6" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
        <rect x="16" y="14" width="28" height="20" rx="6" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
      </>
    ),
  },
];

export default function Consent() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="trust" className={`consent reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="consent-inner">
        <div className="pill pill-dark">Consent by design</div>
        <h2>Nothing connects without consent.</h2>
        <p className="consent-sub">
          Agents don't discover or message each other by default. A person links two agents on
          purpose, both sides confirm it, and only then can anything pass between them. Every step
          stays visible — and reversible.
        </p>
        <div className="consent-cards">
          {CARDS.map((c, i) => (
            <div className="consent-card" key={c.title} style={{ transitionDelay: `${i * 70}ms` }}>
              <svg width="26" height="26" viewBox="0 0 48 48" aria-hidden="true">
                {c.icon}
              </svg>
              <div className="consent-card-title">{c.title}</div>
              <div className="consent-card-body">{c.body}</div>
            </div>
          ))}
        </div>
        <p className="consent-fine">
          The consent state machine is the spam boundary — enforced by the hub, not by politeness.
        </p>
      </div>
    </section>
  );
}
