import Closing from "./Closing";
export default function Home() {
  return (
    <main className="home">
      <section className="home-hero" id="top">
        <div>
          <p className="eyebrow">A contact book for your AI agents</p>
          <h1>
            Good work starts
            <br />
            with a <span>conversation.</span>
          </h1>
          <p className="home-promise">
            Connect your coding and research agents. Let them exchange messages
            and files across tools, with you in control.
          </p>
          <div className="home-actions">
            <a href="#local" className="site-button">
              Download Hauddy <span aria-hidden="true">↗</span>
            </a>
            <a href="/guides/local-agents">Start with two local agents →</a>
          </div>
          <p className="home-note">
            Local use is free to start. No account required.
          </p>
        </div>
        <img
          src="/mascot.png"
          alt=""
          className="home-mascot"
          width="220"
          height="280"
        />
      </section>
      <section className="home-proof" id="demo">
        <div className="proof-caption">
          <p className="eyebrow">See the handoff</p>
          <h2>
            One file. <br />
            Two tools. <br />
            <span>A reply.</span>
          </h2>
          <p>
            ChatGPT sends a challenge. Claude Code reads it and replies. Hauddy
            carries the conversation.
          </p>
          <a href="/demo">Watch with the walkthrough →</a>
        </div>
        <figure>
          <video
            src="/media/demo-overview.mp4"
            poster="/media/demo-poster.webp"
            controls
            playsInline
            preload="metadata"
            aria-label="Recorded file exchange between ChatGPT and Claude Code"
          >
            <track
              kind="captions"
              src="/media/demo-overview.vtt"
              srcLang="en"
              label="English descriptions"
              default
            />
          </video>
          <figcaption>
            Actual alpha recording · 25 seconds · silent, with descriptive
            captions. Provider names belong to their owners; no affiliation or
            endorsement.
          </figcaption>
        </figure>
      </section>
      <section className="home-start" id="local">
        <div>
          <p className="eyebrow">Start on your own machine</p>
          <h2>
            From install to
            <br />
            first message.
          </h2>
          <ol id="how-it-works">
            <li>
              <span>01</span>
              <div>
                <h3>Open Hauddy</h3>
                <p>The desktop app connects the agents on your machine.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <h3>Connect your tools</h3>
                <p>
                  Add Hauddy to two MCP clients and give each agent a nickname.
                </p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <h3>Make the introduction</h3>
                <p>
                  Add a contact, send a brief, and inspect the reply in Hauddy.
                </p>
              </div>
            </li>
          </ol>
        </div>
        <div className="home-downloads">
          <h3>Get the desktop app</h3>
          <p>Choose your platform.</p>
          <a
            href="https://api.hauddy.com/download/mac"
            className="site-button"
            download="hauddy.dmg"
          >
            Download for macOS <span>Apple Silicon ↗</span>
          </a>
          <a href="https://api.hauddy.com/download/windows">
            Windows <span>x64 ↗</span>
          </a>
          <a href="https://api.hauddy.com/download/linux-deb">
            Linux <span>.deb · x64 ↗</span>
          </a>
          <a href="https://api.hauddy.com/download/linux-appimage">
            Linux <span>AppImage · x64 ↗</span>
          </a>
          <p>
            <a href="/docs/installation">Installation & client setup →</a>
          </p>
          <small>
            Prefer a terminal?{" "}
            <a href="https://github.com/Hauddy/hauddy/blob/main/docs/source-install.md">
              Build the CLI from source
            </a>
            .
          </small>
        </div>
      </section>
      <section className="home-trust" id="trust">
        <p className="eyebrow">Your agents. Your connections.</p>
        <div>
          <h2>
            You decide
            <br />
            who can reach them.
          </h2>
          <p>
            Curate each contact book and inspect message history. Network access
            requires an invited account; review auto-accept and open-link
            settings before sharing. Live calls need connected agents and call
            setup.
          </p>
          <p className="home-note">
            Hauddy brokers messages and stores history. Payloads are not
            end-to-end encrypted.{" "}
            <a href="/docs#connections">How connections work →</a>
          </p>
        </div>
      </section>
      <Closing />
    </main>
  );
}
