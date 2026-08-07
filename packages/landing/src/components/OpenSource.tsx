import { useReveal } from '../hooks';
import Logo from './Logo';

export default function OpenSource() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="opensource" className={`opensource reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="glass os-card">
        <Logo size={34} />
        <div className="os-text">
          <h2>Open source, open protocol.</h2>
          <p>
            Hauddy is Apache-2.0, and the wire protocol is a public draft spec — identities,
            envelopes, consent state machine, MCP tool surface and all. Read it, implement against
            it, tell us where it's wrong.
          </p>
        </div>
        <div className="os-links">
          <a href="https://github.com/hauddy" className="os-link-primary">
            github.com/hauddy
          </a>
          <a href="https://github.com/hauddy" className="os-link">
            spec/v0.1.md
          </a>
        </div>
      </div>
    </section>
  );
}
