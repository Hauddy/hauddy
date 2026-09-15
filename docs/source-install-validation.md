# Source-install validation — 2026-09-15

Issues: #86 (public install path) and #92 (developer entry points).

## Environment and scope

- Baseline: `d9bdd392920c4cceea42ef9a38ce3fd94f4942bd` (v0.1.20), with the issue fixes on `codex/fix-install-entry-points`.
- Local host: macOS / arm64, Node.js v22.20.0, npm 10.9.3.
- Installation: isolated source checkout with its own `node_modules` and a dedicated initially empty npm cache. Internal packages resolve within this checkout; no global Hauddy installation was used.
- The sandboxed installation could not reach the registry and failed. The subsequent network-enabled `npm ci --cache /private/tmp/hauddy-install-npm-cache --no-audit --no-fund` completed: `added 619 packages in 1m`.
- Daemon verification required loopback networking outside the restricted sandbox. The smoke runner overrides the child process's home lookup to a temporary directory and uses ephemeral ports; no real account is linked.

## Commands and results

```text
npm run check:entry-points
PASS entry-point distribution, release badge, platform and repository links

npm run build
PASS TypeScript project build

npm run smoke:source
PASS CLI help and version (0.1.20) from a clean working directory
PASS daemon startup with disposable state and ephemeral ports
PASS HTTP MCP initialization and tool discovery
PASS native PTY wrapper startup

npm run build -w @hauddy/landing
PASS — 49 modules transformed

npm test
152 tests, 152 passed, 0 failed, 0 skipped
```

The smoke runner also verifies help/version aliases, no state creation for those flags, and a nonzero exit for an unknown command. The three modified/new workflow YAML files parse successfully.

## Public link checks

Unauthenticated HTTP GET requests on 2026-09-15 (response bodies cancelled rather than downloading full installers):

| Destination | Observed result |
|---|---|
| `https://hauddy.com/` and `/#demo` | 200, HTML; the fragment is client-side |
| GitHub latest release | 206 partial response; redirects to v0.1.20 |
| GitHub getting-started guide on main | 206 partial response, HTML |
| Discord community invite | 200, redirects to `discord.com/invite/wYeaBcKWZ` |
| `/download/mac` on api.hauddy.com | 200, application/octet-stream |
| `/download/linux-deb` on api.hauddy.com | 200, application/octet-stream |
| `/download/linux-appimage` on api.hauddy.com | 200, application/octet-stream |
| `/download/windows` on api.hauddy.com | 200, application/octet-stream |
| GitHub repository homepage | Request failed; browser verification remains pending |

## Remaining release checks

- The Linux/Windows clean source runs are configured in the new CI matrix but have not run in this local session.
- Installer launch on each target OS, signed-out browser navigation, and mobile layout review remain release checks. HTTP results above do not establish those outcomes.
- New source-guide links target main and become public after merge. The updated landing copy takes effect after deployment.
- No npm package was published, no third-party directory was edited, and no issue was closed by this change. Directory maintenance is tracked in #94.
