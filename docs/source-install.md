# Run the Hauddy CLI from source

The supported public downloads are the [desktop installers](https://github.com/Hauddy/hauddy/releases/latest). They bundle their runtime and start the local daemon for you. The CLI is not currently distributed through npm. Use this source route if you need a terminal-only daemon or the CLI call wrapper.

## Prerequisites

- Node.js **22 or newer**, npm **10 or newer**, and Git.
- For the native `node-pty` dependency: Python 3 and a C/C++ toolchain when a compatible prebuilt binary is unavailable. Use Xcode Command Line Tools on macOS, build-essential on Debian/Ubuntu, or Visual Studio Build Tools with the C++ workload on Windows.
- Build from the repository root; its internal `@hauddy/*` dependencies are resolved as workspaces within this checkout.

## Install and verify

Run these commands in a new directory. For a release containing this guide, you can reproduce it by adding `--branch vX.Y.Z` with a tag from [Releases](https://github.com/Hauddy/hauddy/releases).

```sh
git clone https://github.com/Hauddy/hauddy.git
cd hauddy
npm ci
npm run build
node packages/sidecar/dist/cli.js --help
node packages/sidecar/dist/cli.js --version
npm run smoke:source
```

The smoke check runs the built CLI from a temporary working directory, uses disposable local state and randomly assigned ports, initializes MCP, lists tools, and exercises the native PTY wrapper. It does not connect an account. Internal workspace links are expected for this source distribution; this check is not evidence that an npm package can be installed independently.

## Start the daemon

Quit the desktop app first if it is already serving port 7700. From the repository root:

```sh
node packages/sidecar/dist/cli.js daemon
```

Keep that terminal open. In your MCP client, connect to `http://localhost:7700/mcp` and follow the [first-message guide](./getting-started.md#2-connect-claude-code). No Hauddy account is needed locally. Network access and hosted-assistant connectors require an invited account; an email-verified handle reservation does not grant access.

For incoming-call injection, open another terminal and run:

```sh
node packages/sidecar/dist/cli.js wrap claude
```

To launch the harness in another project directory, use the absolute path to the built `cli.js`. There is no global CLI installation step. Stop the daemon with Ctrl+C. Rebuild after updating the source.

## Troubleshooting

- **Missing `dist/cli.js` or internal package:** run `npm ci` and `npm run build` at the repository root.
- **Native build failure:** confirm the prerequisites above and rerun `npm ci`; do not skip install scripts if you need the wrapper.
- **Port already in use:** quit the other desktop app/daemon before starting this one.

Release verification and the clean-install evidence belong in the [distribution checklist](./release-distribution.md).
