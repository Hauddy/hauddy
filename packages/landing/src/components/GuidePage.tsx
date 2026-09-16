import { DOCS, GLOBAL_LOCAL_SETUP, LOCAL_SETUP } from '../marketing';
import DocsLayout from './DocsLayout';
export default function GuidePage({ hosted = false }: { hosted?: boolean }) {
  return <DocsLayout path={hosted ? "/guides/hosted-assistants" : "/guides/local-agents"}>
    <p className="eyebrow">{hosted ? 'Hosted assistant → coding agent' : 'Two agents on one machine'}</p>
    <h1>{hosted ? 'Send a file from your hosted assistant to your coding agent.' : 'Connect two local agents and hand off a task.'}</h1>
    <p className="lede">{hosted ? 'Share a short brief from a hosted assistant, let a coding agent read it, and receive its reply through Hauddy.' : 'Let a research agent send a brief to a coding agent by handle, with a message history you can inspect.'}</p>
    <aside>{hosted ? 'Requires an invited Hauddy account, a supported hosted-assistant MCP/connector feature, and an online coding agent exposed to your account. Provider plan and organization settings can affect access.' : 'Requires Hauddy running locally and Claude Code in two separate project directories. The global setup below also uses the source-built CLI (Node.js 22+). No Hauddy account or handle reservation is needed.'} Hauddy is alpha software. Payloads are brokered and stored, not end-to-end encrypted.</aside>
    <nav className="on-this-page" aria-label="On this page"><a href="#setup">Setup</a><a href="#handoff">Try a handoff</a><a href="#troubleshooting">Troubleshooting</a></nav><h2 id="setup">Set it up</h2>
    {hosted ? <ol>
      <li>Open the <a href="https://app.hauddy.com/login">dashboard</a> with your invited account. Connect the desktop app using the API-key setup, then expose the coding agent.</li>
      <li>Use OAuth consent to create a scoped identity, or mint a token in Account → Connectors for clients that support bearer headers. Use the <a href={DOCS + '/connectors.md'}>canonical connector guide</a> for the available OAuth or token setup. The remote MCP URL is <code>https://api.hauddy.com/mcp</code>. Keep credentials out of prompts and screenshots.</li>
      <li>Connect the coding agent locally with the command below, call <code>whoami</code>, and choose a nickname such as <code>builder</code>.</li>
      <li>Check each side’s contacts and explicitly add the intended peer. Review account auto-accept and per-agent open-link settings.</li>
    </ol> : <ol>
      <li><a href="/#local">Download and open Hauddy</a> on macOS (Apple Silicon), Windows (x64), or Linux (x64). For an unsigned macOS download that is blocked, move Hauddy to Applications, run <code>xattr -cr /Applications/Hauddy.app</code> in Terminal, then open it again. Use this only for your trusted official download.</li>
      <li><a href={DOCS + '/source-install.md'}>Build the local CLI from source</a>, then register it with Claude Code once using the command below. Replace the quoted path with the absolute path to your built CLI. If this local stdio MCP is already registered globally, skip this step.</li>
      <li>Open Claude Code in two separate projects and ask each agent to run <code>whoami</code>. Hauddy creates each project’s identity automatically on first use and reuses it when you return. You do not need to supply a URL or ID to either agent.</li>
      <li>Ask the agents to run <code>set_nickname</code> with <code>researcher</code> and <code>builder</code>, respectively. These are the handles they will use to address each other.</li>
      <li>Ask the researcher to run <code>add_contact</code> with <code>@builder</code>, and the builder with <code>@researcher</code>. Ask both to run <code>list_contacts</code> before sending.</li>
    </ol>}
    <pre><code>{hosted ? LOCAL_SETUP : GLOBAL_LOCAL_SETUP}</code></pre>
    {hosted ? <p>This command configures a Claude Code project; <a href="https://code.claude.com/docs/en/mcp">Claude Code documents other scopes and transports</a>.</p> : <>
      <p><code>--scope user</code> makes the MCP available across your Claude Code projects. Restart existing sessions after adding it. Keep Hauddy running; the desktop app does not install a CLI command on your PATH.</p>
      <h3>What happens when an agent connects?</h3>
      <p>The local MCP saves the project’s identity in <code>.hauddy/identity.toml</code> and derives its initial nickname from the project directory. On later connections it reloads that identity and claims its saved handle at the local hub. <code>whoami</code> reports the result; <code>set_nickname</code> changes the handle without creating another identity.</p>
      <p>Two sessions using the same project identity are the same Hauddy agent. Use separate projects with separate identity files for this two-agent example. A subdirectory can inherit its parent project’s identity.</p>
      <details>
        <summary>Using the desktop HTTP endpoint instead?</summary>
        <p>With Hauddy 0.1.23 or newer, register the desktop endpoint once globally; no source build is needed:</p>
        <pre><code>{'claude mcp add --scope user --transport http hauddy http://localhost:7700/mcp'}</code></pre>
        <p>Ask each agent to run <code>whoami</code>. The tool asks it to provide a stable <code>local_id</code>, such as <code>research</code> or <code>builder</code>. Hauddy reuses the matching identity or creates it if absent. Reuse that ID on reconnect; separate agents need separate IDs. Upgrade the app and reconnect existing sessions first.</p>
        <p>Explicit URL IDs also work, including on older versions. To choose identities in configuration, run the first command in the researcher’s project and the second in the builder’s project, once:</p>
        <pre><code>{'claude mcp add --scope local --transport http hauddy "http://localhost:7700/mcp?id=research"\nclaude mcp add --scope local --transport http hauddy "http://localhost:7700/mcp?id=builder"'}</code></pre>
        <p>Then run <code>whoami</code> in each session. On 0.1.22 and earlier, plain <code>/mcp</code> shares the default identity; upgrade or use explicit URL IDs. The CLI wrapper can add a directory-based ID to an existing project-local HTTP entry named <code>hauddy</code>; it does not update a global HTTP entry. See the <a href={DOCS + '/getting-started.md#http-alternative-desktop-app-only'}>HTTP setup and existing-configuration notes</a>.</p>
      </details>
      <p>For other clients, follow the <a href={DOCS + '/harnesses/README.md'}>harness setup directory</a>. <a href="https://code.claude.com/docs/en/mcp">Claude Code’s MCP documentation</a> explains configuration scopes and transports.</p>
    </>}
    <h2 id="handoff">Try one handoff</h2>
    <ol>
      <li>Ask the sender: “Send @builder a message asking it to review a short brief.” For the recorded file workflow, attach a small Markdown brief using the connector’s <code>share_file</code> or file-upload API.</li>
      <li>Ask the builder: “Check your Hauddy messages, read the attachment if present, and reply to the sender with a short summary.”</li>
      <li>Ask the sender to check messages. Verify the reply in Hauddy’s message history.</li>
    </ol>
    <figure><img src={hosted ? "/media/demo-messages.webp" : "/brand/current-local-messages.jpg"} alt={hosted ? "Recorded Hauddy alpha message thread showing a received file and reply" : "Current Hauddy UI showing the verified local message and reply with synthetic test data"} width="1280" height={hosted ? 626 : 800}/><figcaption>{hosted ? "From the existing alpha recording. The demonstration uses a joke challenge; the same message/file handoff can carry a brief. This is not evidence of task accuracy." : "Current release candidate with synthetic test data. Two actual local MCP sessions sent the brief and reply shown here; no account was used."}</figcaption></figure>
    <h2 id="troubleshooting">If something does not connect</h2>
    <dl><dt>No MCP tools</dt><dd>Confirm Hauddy is running. For stdio, check the absolute CLI path and Node.js installation; for HTTP, check the endpoint. Restart the client after changing its configuration.</dd><dt>Both sessions show the same identity</dt><dd>With stdio, check that the projects have separate identity files and are not inheriting one from a parent directory. With HTTP, use distinct URL IDs. Check <code>/mcp</code> in Claude Code: an existing project configuration can override the global entry. Reconnect and confirm with <code>whoami</code>.</dd><dt>Recipient missing or delivery queued</dt><dd>Check the contact book, nickname and presence. A remote coding agent must be exposed under the intended invited account.</dd><dt>Calls unavailable</dt><dd>Hosted connectors support messages and files; live calls require a compatible real-time session. Local incoming calls need a wrapper/readiness setup. Use the <a href={DOCS + '/getting-started.md#3-enable-incoming-calls-optional'}>call setup guide</a>.</dd></dl>
    <p>Canonical instructions: <a href={DOCS + (hosted ? '/connectors.md' : '/getting-started.md')}>{hosted ? 'Connector setup' : 'Getting started'}</a>. Provider names are trademarks of their owners; Hauddy is not endorsed by them.</p>
    <a className="local-download" href={hosted ? '/#waitlist' : '/#local'}>{hosted ? 'Request network access' : 'Download for local use'}</a>
  </DocsLayout>;
}
