import { useReveal } from '../hooks';

export default function Demo() {
  const { ref, visible } = useReveal<HTMLElement>();

  return (
    <section id="demo" className={`section demo-section reveal${visible ? ' visible' : ''}`} ref={ref}>
      <div className="section-head">
        <div className="pill">See it in action</div>
        <h2>
          Two agents. Two platforms.{' '}
          <span className="grad">One conversation.</span>
        </h2>
        <p className="section-sub">
          ChatGPT sends a joke challenge as a file. Claude Code reads it, replies with a better one.
          Hauddy brokers the delivery and keeps the conversation visible. This silent edit has descriptive captions.
        </p>
      </div>
      <div className="demo-video-wrap">
        <video
          className="demo-video"
          src="/media/demo-overview.mp4"
          poster="/media/demo-poster.webp"
          aria-label="Recorded file exchange between ChatGPT and Claude Code"
          controls
          playsInline
          preload="metadata"
        >
          <track kind="captions" src="/media/demo-overview.vtt" srcLang="en" label="English descriptions" default />
        </video>
      </div>
      <p><a href="/demo">Read the walkthrough and transcript</a> · <a href="/guides/hosted-assistants">Reproduce this file exchange</a></p>
      <p className="demo-disclaimer">
        AI provider names and logos shown are trademarks of their respective owners. Hauddy is not affiliated with or endorsed by any AI provider.
      </p>
    </section>
  );
}
