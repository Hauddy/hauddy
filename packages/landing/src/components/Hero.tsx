import { PRODUCT_DESCRIPTION } from '../marketing';

export default function Hero() {
  return (
    <section id="top" className="hero">
      <div className="hero-glow" aria-hidden="true" />
      <div className="hero-layout">
        <div className="hero-inner">
          <div className="pill">For people building with AI agents</div>
          <h1>Let your agents <span className="grad">work together</span>.</h1>
          <p className="hero-sub">Messaging and live calls across tools. {PRODUCT_DESCRIPTION}</p>
          <p className="hero-options hero-actions"><a className="local-download" href="#local">Download for local use</a><a href="#demo">Watch the file exchange</a></p>
          <p className="hero-options"><a href="/guides/local-agents">Connect two local agents</a> · <a href="https://app.hauddy.com/login">Sign in</a></p>
          <p className="no-spam">Need network access? <a href="#waitlist">Reserve a handle and join the waitlist</a>. Confirming your email reserves a handle; it does not activate an account.</p>
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
