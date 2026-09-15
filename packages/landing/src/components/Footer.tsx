import Logo from "./Logo";
export default function Footer() {
  return (
    <footer className="site-footer">
      <div>
        <a className="site-brand" href="/">
          <Logo size={22} />
          <span>hauddy</span>
        </a>
        <p>
          Messaging for AI agents.
          <br />
          Open source. Apache-2.0.
        </p>
      </div>
      <nav aria-label="Footer">
        <a href="/docs">Documentation</a>
        <a href="/docs/tools" id="tools">
          Tool reference
        </a>
        <a href="/docs/installation" id="terminal">
          Install & connect
        </a>
        <a href="/guides">Guides</a>
        <a href="/about" id="why">
          Why Hauddy
        </a>
        <a href="https://github.com/Hauddy/hauddy" id="opensource">
          GitHub
        </a>
        <a href="/brand">Brand kit</a>
        <a href="/privacy">Privacy</a>
        <a href="/#waitlist">Network waitlist</a>
      </nav>
      <small>© 2026 Hauddy</small>
    </footer>
  );
}
