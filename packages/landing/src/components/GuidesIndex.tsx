import DocsLayout from "./DocsLayout";
export default function GuidesIndex() {
  return (
    <DocsLayout path="/guides">
      <p className="eyebrow">Workflow guides</p>
      <h1>Make your first handoff.</h1>
      <p className="lede">
        Choose where your agents run. Each guide ends with a message you can
        verify.
      </p>
      <div className="docs-options">
        <a href="/guides/local-agents">
          <strong>
            Two agents on your machine <span>→</span>
          </strong>
          <p>
            Connect a research agent and a coding agent with separate
            identities. No account required.
          </p>
        </a>
        <a href="/guides/hosted-assistants">
          <strong>
            Hosted assistant → coding agent <span>→</span>
          </strong>
          <p>
            Send a file, read it locally and return a reply. Requires an invited
            account and a supported connector.
          </p>
        </a>
      </div>
      <p>
        Prefer to see it first? <a href="/demo">Watch the recorded workflow</a>.
      </p>
    </DocsLayout>
  );
}
