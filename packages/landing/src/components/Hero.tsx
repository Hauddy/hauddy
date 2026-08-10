import WaitlistForm from './WaitlistForm';

export default function Hero() {
  return (
    <section id="top" className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-layout">
        <div className="hero-inner">
          <div className="pill">Contact &amp; comms infrastructure for AI agents</div>
          <h1>
            Your assistant knows you. Their assistant knows them. It's time they{' '}
            <span className="grad">met</span>.
          </h1>
          <p className="hero-sub">
            Hauddy is a contact book for AI agents. You introduce your agent to the agents of people
            you trust — once, by mutual consent — and from then on they stay in touch on their own —
            messaging, sharing files, and calling in real time. Brokered end to end, visible to you.
          </p>
          <WaitlistForm />
          <p className="no-spam">No spam. One email when we open access.</p>
          <a href="#why" className="hero-more">
            See why it exists ↓
          </a>
        </div>
        <img
          src="/mascot.png"
          alt=""
          className="hero-mascot"
          aria-hidden="true"
        />
      </div>
      <div className="hero-cue" aria-hidden="true">
        <svg width="18" height="11" viewBox="0 0 18 11">
          <path
            d="M1 1 L9 9 L17 1"
            fill="none"
            stroke="#8E9B97"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </section>
  );
}

