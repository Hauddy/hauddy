# Visual polish validation

Combined implementation for issues #98–108, tracked by #109. Base: v0.1.21 (`2da679d`). The pre-implementation content map is in [the plan](../visual-polish-plan.md).

## Changes and observations

| Issues | Implemented result | Verification |
| --- | --- | --- |
| #98 | Separate action/form/result blocks; a single setup CTA in the empty state; recovery-link spacing | Populated and empty Agents at 1280/390; Account at 390. Connector form-to-list gap is now 20px (was 0px); empty Agents has one setup link. |
| #99 | Selected setup path, instructions, labeled agent picker, evidence-based progress and refresh | Hosted setup at 1280/390; tests cover connection/message evidence and switching agents while history loads. |
| #100 | Dark foreground on green primary controls | Computed colors match shared tokens. Contrast is 5.96:1 normally and 8.84:1 on hover, up from 2.82:1 and 1.90:1. |
| #101 | Matching SVG attachment/call icons and composer controls | Messages at 390: attachment background matches the dark surface and the control is 40×40px. Existing picker/focus tests pass. |
| #102 | Wider desktop rosters, consistent row columns, deliberate narrow wrapping, deduplicated handles | Actual desktop components rendered with synthetic data at 1000×700 and 640×700. No horizontal overflow at 640. |
| #103 | Explicit loading/error/retry states; loaded profile drafts survive refresh errors | Initial failure rendered at 390; regression tests cover retry and preserving unsaved profile text. |
| #104 | Checking/current/available/error states, manual check, 15-minute cache expiry and automatic retry | Tests cover malformed responses, failure/retry, expiry, endpoint races, numeric comparisons, download progress/failure/retry and restart readiness. |
| #105–106 | Five-section homepage with real recorded proof, a numbered installation flow, a light download section and compact trust context | Rendered at 1440, 390 and 320. Homepage height approximately 2,890px at 1440 (was 9,696) and 3,417px at 390 (was 12,955): about 70–74% shorter. At 390 the visible main copy is about 332 words. |
| #107–108 | Docs index, installation, tools, guides index and About routes; consistent visible navigation | Build and HTTP checks cover all 13 routes and 11 indexable sitemap entries. Tool reference inspected at 390; old `/#tools` navigates to `/docs/tools`. Mobile Home/Docs/Guides/Demo links remain visible, including at 320 and over the cream installation section. |

## Automated checks

- `npm test`: **164 tests passed**.
- Platform and web TypeScript checks passed.
- Desktop UI and web production builds passed.
- Desktop shell TypeScript, asset generation and bundled daemon build passed.
- Landing production build passed: 13 prerendered routes, metadata/crawler checks and assets.
- Local Cloudflare Pages HTTP smoke checks passed: content/status/types, missing routes, private action metadata, query isolation, sharing image and media assets.
- `git diff --check` passed.

## Scope and remaining release validation

Authenticated web screens and desktop component checks use synthetic local API data, not production account data. Production messaging, account settings and the installed desktop app were not changed.

A disposable native Electron shell was launched with the actual current main/preload and synthetic UI data, with its daemon disabled. The native inspection tool stalled during attachment and yielded only the window/menu accessibility tree. **This is not a completed packaged-client visual smoke test.** Before release and closing the desktop acceptance checklist, test the packaged app on macOS, including mixed/unnamed agents and contact books, and perform platform smoke checks for Windows/Linux and the actual download/apply-update flow. No release or deployment was performed in this round.

## Captures

These are viewport captures; they contain public site content or synthetic data only. Full-page capture stitching was unreliable in the inspection tool, so those captures were discarded.

- [Homepage, 390px](home-mobile-viewport.png)
- [Homepage, 320px](home-320.png)
- [Installation section and persistent navigation, 320px](home-start-320.png)
- [Tool reference, 390px](tools-mobile-viewport.png)
- [Message composer, 390px](messages.png)
- [Profile failure, 390px](profile-error.png)

## Reproducing the synthetic preview

The fixture sources are retained in `fixtures/`. From the repository root, copy the four `visual-*` files to `packages/web/`, run the web Vite development server, then open `/visual-audit.html#/` or `/visual-desktop.html#/`. The web fixture supports `?empty=1#/` and `?fail=1#/settings`. The desktop fixture includes only Agents and Account. Its methods reject unimplemented mutations. Remove the copied files when finished; they are not production entry points.
