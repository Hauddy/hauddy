# Dependency maintenance

## Runtime and release policy

Source builds require Node.js 22.12 or newer and npm 10 or newer. CI exercises
Node 22 on macOS, Windows and Linux; newer Node majors are not independently
certified by that matrix. Installers bundle Electron 45.0.0, so desktop users do
not need a separate Node installation. Electron is pinned: review a supported
stable Electron line and its security patches before every release. Do not keep
shipping an unsupported Electron line solely because its lockfile audit is green.

Dependabot checks npm weekly, groups compatible patch/minor updates and leaves
major upgrades separate. The release maintainer reviews security advisories
before tagging, checks lockfile changes and reruns CI, source installation and
packaged acceptance after native/runtime changes. Run `npm audit --json` for the
complete graph and `npm audit --omit=dev --json` for the production dependency
subset. The latter does not audit the Chromium/Node runtime inside Electron or
prove that an installer is safe. High/critical findings block release until fixed
or individually assessed and explicitly accepted; moderate findings need a
recorded exposure assessment and follow-up. Do not blindly apply audit's forced
upgrade/downgrade suggestions.

Desktop artifacts currently follow the existing **unsigned alpha** policy.
macOS notarization and Windows publisher signing are not configured by this
change. Acceptance must record Gatekeeper/SmartScreen behavior accurately;
production promotion must not claim notarization or a verified publisher.
Changing that policy requires provisioned signing credentials and a separate
reviewed release change. Never commit certificates or credentials.

## Audit and upgrades — 2026-10-22

The starting lockfile reported 39 affected package entries (2 critical, 26 high,
11 moderate). These are dependency entries, not 39 distinct exploitable flaws.
Compatible updates refresh the MCP/HTTP/tooling graph. Explicit reviewed major
upgrades move Electron to 45.0.0, electron-builder to 26.15.3, Sharp to 0.35.5,
Vite to 7.3.7 with React plugin 5.2.0, and React Router to 7.18.4. TypeScript
5.9.3 supports the plugin's newer declaration syntax. Cross-platform Sharp
optional binaries are aligned with Sharp 0.35.5/libvips 1.3.4.

Wrangler 4.151.3 brings Miniflare 5; the standalone Workerd fixture uses its
provided v4-options converter while retaining disposable storage and real alarms.

The resulting full audit has no critical or high findings. Eight moderate
package entries share one underlying, unpatched `sprintf-js` advisory:
[GHSA-hp3w-g68c-fv3c](https://github.com/advisories/GHSA-hp3w-g68c-fv3c).
The path is electron-builder → app-builder-lib → @electron/get 3 → global-agent
→ roarr → sprintf-js. Other affected entries are builder wrappers around this
same path. Attacker-controlled numeric precision in a format string can throw a
RangeError. This graph runs during installer construction; it is not an app
runtime dependency or included by the desktop `files` list/daemon bundle.
Builds consume trusted repository configuration and download URLs; no user
message is a logging-format input in this build path. This is a temporary
build-tool exception, not a claim of zero vulnerabilities. Recheck it weekly
and before every release, remove the exception when upstream patches the path,
and reassess if untrusted input is added to packaging. npm's suggested builder
downgrade is not applied because it would reintroduce the older build graph.

The application uses declarative BrowserRouter/HashRouter routes, without data
routers or nested multi-segment splats. Workspace typechecks, existing UI/router
regressions and production builds verify compatibility; packaged/browser
acceptance remains required for release. The dependency changes do not themselves
complete the native acceptance evidence in #109 or authorize a version tag.

## Starting findings and exposure

The following table records every starting audit entry. “Resolved” means absent
from the refreshed lockfile's audit, not proof of reachability in the old build.

| Package | Severity | Exposure | Result |
| --- | --- | --- | --- |
| @electron/get | moderate | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| @electron/rebuild | high | Installer/build tooling | Resolved |
| @modelcontextprotocol/sdk | high | Application / MCP dependency | Resolved |
| @xmldom/xmldom | high | Installer/build tooling | Resolved |
| app-builder-lib | high | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| brace-expansion | high | Installer/build tooling | Resolved |
| builder-util | high | Installer/build tooling | Resolved |
| builder-util-runtime | high | Installer/build tooling | Resolved |
| cacache | high | Installer/build tooling | Resolved |
| dmg-builder | high | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| electron | high | Bundled desktop runtime | Resolved |
| electron-builder | high | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| electron-builder-squirrel-windows | high | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| electron-publish | high | Installer/build tooling | Resolved |
| esbuild | moderate | Frontend build/dev server | Resolved |
| extract-zip | high | Installer/build tooling | Resolved |
| fast-uri | high | Application / MCP dependency | Resolved |
| global-agent | moderate | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| hono | moderate | Application / MCP dependency | Resolved |
| http-cache-semantics | high | Installer/build tooling | Resolved |
| ip-address | moderate | Application / MCP dependency | Resolved |
| js-yaml | high | Installer/build tooling | Resolved |
| make-fetch-happen | high | Installer/build tooling | Resolved |
| miniflare | high | Installer/build tooling | Resolved |
| nanoid | high | Installer/build tooling | Resolved |
| node-gyp | high | Installer/build tooling | Resolved |
| proxy-addr | critical | Application / MCP dependency | Resolved |
| qs | moderate | Application / MCP dependency | Resolved |
| react-router | moderate | Application / MCP dependency | Resolved |
| react-router-dom | moderate | Application / MCP dependency | Resolved |
| roarr | moderate | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| sharp | high | Installer/build tooling | Resolved |
| smol-toml | moderate | Sidecar config parser | Resolved |
| source-map-js | high | Installer/build tooling | Resolved |
| sprintf-js | moderate | Installer/build tooling | High/critical resolved; moderate build-tool exception |
| tar | critical | Installer/build tooling | Resolved |
| undici | high | Installer/build tooling | Resolved |
| vite | high | Frontend build/dev server | Resolved |
| wrangler | high | Installer/build tooling | Resolved |

## Verification of this update

On macOS arm64 / Node 22.20.0: all 192 tests pass, all workspace typechecks pass,
desktop/web/landing production builds pass, source-install smoke passes (daemon,
MCP and native PTY), and the disposable Workerd alarm test passes with the new
runtime. `npm audit --omit=dev` reports zero findings; the full audit retains only
the eight moderate build-tool entries described above. Cross-platform installer
construction and native interaction checks must be recorded separately against
the candidate commit before a version tag.
