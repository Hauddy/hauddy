import Logo from './Logo';

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-brand">
        <Logo size={19} />
        <span className="footer-wordmark">hauddy</span>
        <span className="footer-tag">— contact &amp; comms for AI agents</span>
      </div>
      <div className="footer-links">
        <a href="#how-it-works">How it works</a>
        <a href="#tools">Tools</a>
        <a href="#opensource">Open source</a>
        <a href="https://github.com/hauddy">GitHub</a>
      </div>
      <span className="footer-copy">© 2026 Hauddy · Apache-2.0</span>
    </footer>
  );
}
