import CopyChip from './CopyChip';

export interface ConnectorSnippetsProps {
  /** The platform origin, e.g. https://api.hauddy.com — for the /v1 curl. */
  apiBase: string;
  /** The remote MCP endpoint (…/mcp). */
  mcpUrl: string;
  /** The OAuth token endpoint (…/oauth/token) for the client_credentials grant. */
  tokenEndpoint: string;
  /** The paired OAuth client_id, if this connector has one. */
  clientId: string | null;
  /** A freshly-issued bearer token (right after create/rotate). In the read-only
   *  view it's absent → the snippet shows a `<token>` placeholder. */
  token?: string | null;
  /** A freshly-issued OAuth client secret (create/rotate). Absent → placeholder. */
  clientSecret?: string | null;
}

/** The "how to use this connector" setup snippets — the remote MCP URL, a /v1
 *  REST curl, and (when it has OAuth creds) the client_credentials curl. Shared
 *  by the create-result block and the per-connector View, so the templates live
 *  in one place. Real credentials are interpolated when known; otherwise a
 *  placeholder stands in (the token/secret are only ever shown once). */
export default function ConnectorSnippets({
  apiBase,
  mcpUrl,
  tokenEndpoint,
  clientId,
  token,
  clientSecret,
}: ConnectorSnippetsProps) {
  const bearer = token || '<token>';
  const secret = clientSecret || '<client-secret>';
  return (
    <div className="conn-snippets">
      <p className="download-note">
        Add as a remote MCP server (Authorization: Bearer &lt;token&gt;), or call the REST API directly:
      </p>
      <CopyChip label="MCP URL" value={mcpUrl} />
      <pre className="conn-snippet">{`curl -H "Authorization: Bearer ${bearer}" \\
  -H "content-type: application/json" \\
  -d '{"to":"@agent","body":"hi"}' \\
  ${apiBase}/v1/messages`}</pre>

      {clientId ? (
        <div className="cred-block">
          <h3 className="conn-subhead">OAuth (browserless agents)</h3>
          <p className="download-note">
            A headless agent exchanges its <code>client_id</code> + secret for the bearer token via the{' '}
            <code>client_credentials</code> grant — no redirect.
          </p>
          <CopyChip label="Client ID" value={clientId} />
          <pre className="conn-snippet">{`curl -u "${clientId}:${secret}" \\
  -d "grant_type=client_credentials" \\
  ${tokenEndpoint}`}</pre>
        </div>
      ) : null}
    </div>
  );
}
