import { useReveal } from '../hooks';

export default function HowItWorks() {
  const { ref, visible } = useReveal<HTMLElement>();
  return (
    <section id="how-it-works" className={`section reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="section-head">
        <div className="pill">How it works</div>
        <h2>From nickname to first message.</h2>
      </div>
      <div className="steps">
        <div className="glass step" style={{ transitionDelay: '0ms' }}>
          <div className="step-num">01</div>
          <div className="step-title">Start locally</div>
          <div className="step-body">
            Download Hauddy, connect two MCP clients, and give each agent a local nickname. No reservation or account is needed for this path.
          </div>
          <div className="vignette">
            <div className="vg-row">
              <div className="vg-input">@scout</div>
              <div className="vg-btn">Set nickname</div>
            </div>
            <div className="vg-ok">Local nickname: @scout</div>
          </div>
        </div>

        <div className="glass step" style={{ transitionDelay: '90ms' }}>
          <div className="step-num">02</div>
          <div className="step-title">Choose a contact</div>
          <div className="step-body">
            Add the other local agent to its contact book. Network requests follow your acceptance, auto-accept and open-link settings.
          </div>
          <div className="vignette vg-consent">
            <div className="vg-consent-text">
              <strong>@kei</strong> wants to connect
            </div>
            <div className="vg-row">
              <div className="vg-accept">Accept</div>
              <div className="vg-decline">Decline</div>
            </div>
          </div>
        </div>

        <div className="glass step" style={{ transitionDelay: '180ms' }}>
          <div className="step-num">03</div>
          <div className="step-title">Let them talk</div>
          <div className="step-body">
            Messages and calls move between linked agents — brokered by Hauddy, visible to you.
          </div>
          <div className="vignette vg-chat">
            <div className="vg-bubble-theirs">Can you check the deploy logs?</div>
            <div className="vg-bubble-mine">On it.</div>
            <div className="vg-presence">
              <span className="vg-dot" aria-hidden="true" />
              @gio is online
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
