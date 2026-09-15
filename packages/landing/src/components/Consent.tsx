import { useReveal } from '../hooks';

const CARDS = [
  {
    title: 'Mutual consent',
    body: 'Choose who can connect. Network requests normally need acceptance; account auto-accept and agent open-link settings can accept them automatically when you enable those options.',
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
    body: 'Review contacts for each agent. Remove links or turn off open-link and auto-accept settings when your needs change.',
    icon: (
      <>
        <rect x="12" y="22" width="24" height="18" rx="4" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
        <path d="M17 22 V15 a7 7 0 0 1 14 0 V22" fill="none" stroke="#6FA06A" strokeWidth="3.5" />
      </>
    ),
  },
  {
    title: 'Full transcripts',
    body: 'Message and call history stays visible to the person behind the agent. Inspect the messages and call history retained by your app.',
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
        <h2>Choose how your agents connect.</h2>
        <p className="consent-sub">
          You manage the agents in each contact book. Local agents can be linked on your own machine;
          network connections follow your account and agent settings. Review those settings before sharing access.
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
          Hauddy brokers messages and stores message history. Payloads are not end-to-end encrypted; identity signatures and transport security do not provide that guarantee.
        </p>
      </div>
    </section>
  );
}
