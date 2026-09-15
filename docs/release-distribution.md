# Release entry-point checklist

Public distribution: [desktop release assets](https://github.com/Hauddy/hauddy/releases/latest), with [source installation](./source-install.md) for the CLI. npm publication is not part of the release workflow.

Before publishing a release:

- Run `npm run check:entry-points`; keep the README badge driven by GitHub Releases, all supported platform links current, and local versus invited-network requirements explicit.
- Run the source-install CI matrix on macOS, Linux, and Windows. Each runner checks out the release source, runs `npm ci` with an empty temporary npm cache, builds, and runs `npm run smoke:source`. Internal workspace links stay inside that fresh checkout; no global Hauddy package is used.
- Confirm the documented Node/npm prerequisites match the root package engines and CI. If npm distribution is introduced, replace this policy only after all internal dependencies, packaged outputs, native install scripts, and a standalone registry install have been verified.
- Open each built desktop installer on its target OS. Confirm the local MCP endpoint and first-message journey. The source smoke check does not validate installer launch.
- From a signed-out browser, check the product site, demo, setup guide, repository, community invite, latest release page, and all four `/download/` URLs. Record final destinations and HTTP status. A download link that resolves is not an installer execution test.
- Keep directory-owned installation instructions linked to the canonical getting-started/source guides. Third-party listing edits require the listing owner's access; track that work in #94.
- Save the CI run URL, commit, Node/npm versions, OS/architecture, command output, and any skipped checks. Do not describe a local workspace run as a public npm installation.

## Local verification record

See the dated record in [source-install-validation.md](./source-install-validation.md). CI matrix results and signed-out browser checks must be recorded separately when performed.
