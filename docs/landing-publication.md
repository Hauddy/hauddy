# Landing HTML and sharing previews

Implements the repository work for #87 and #88. The existing Cloudflare Pages deployment remains the production host.

## Build and routes

```sh
npm run build -w @hauddy/landing
```

The build creates the Vite client bundle, then renders the same React components to HTML in a temporary Node bundle. The temporary bundle is removed; only static assets and HTML go to Pages. React hydrates that markup in the browser. No request URL, email, handle, or token is read while generating metadata.

| URL | Initial HTML | Indexing |
|---|---|---|
| `/` | Homepage, links, first example transcript and forms | Indexable; canonical `https://hauddy.com/` |
| `/privacy` | Privacy policy | Indexable; unique title/description/canonical |
| `/reservation` | Generic confirmation page; disabled button until the client reads the fragment | `noindex, nofollow, noarchive`; no social metadata |
| Unknown paths | `404.html`, with a return-home link | HTTP 404 and `noindex` in HTML |

The catch-all rewrite was removed. A top-level `404.html` prevents Cloudflare Pages from applying its default SPA fallback. Public pages use extensionless canonical URLs; Pages handles `.html` aliases. The dashboard is non-indexable in both its initial HTML and static response headers, including password-reset and claim pages. Indexing directives do not replace token validation or access control.

`robots.txt` permits crawlers to read `noindex` directives on action pages. The sitemap contains only `/` and `/privacy`. The canonical origin is a source constant, never a forwarded host or user query. Preview `pages.dev` hosts receive an additional `noindex` header.

Sections and the example transcript are visible in the initial HTML. Animation begins after hydration. A `noscript` notice explains that reservations require JavaScript and provides a local-download link.

## Social card

- Asset: `packages/landing/public/social/hauddy-card.png`, 1200 × 630.
- Editable export: adjacent `hauddy-card.svg`.
- Generation: `npm run social:generate -w @hauddy/landing`.
- Source: the canonical linked-contacts mark in `packages/web-tokens/logo.svg`, Hauddy's dark/green palette, and the product description introduced in the README.
- Headline: **Messaging & live calls for AI agents.** Supporting line: **Across tools. On your machine.**
- The main logo and message sit inside the central 630-pixel square to tolerate a centered narrow crop.
- Public pages have page-specific Open Graph and X titles/descriptions, absolute canonical/image URLs, PNG dimensions/type, and image alt text. Action and missing pages have no sharing tags.

The PNG is committed rather than rendered at deploy time, avoiding platform font differences. Regenerate and visually inspect both landscape and narrow framing whenever the mark or card copy changes. Keep `src/pages.ts` image alt text and dimensions aligned. This card is a product illustration, not a customer endorsement or a screenshot of a working session.

## Automated checks

The landing build fails if initial content, route metadata, crawler files, privacy indexing policy, or the referenced PNG are missing. CI also starts a disposable local Pages runtime and checks HTTP responses:

```sh
# Terminal 1, from packages/landing:
npx --no-install wrangler pages dev dist --port 8789 --ip 127.0.0.1

# Terminal 2, from repository root:
npm run check:http -w @hauddy/landing -- http://127.0.0.1:8789
```

The same HTTP check can target the deployed origin. Synthetic query values confirm that private-looking input does not enter canonical URLs or social metadata. Checks use the real Pages runtime, not Vite's SPA preview fallback. Release builds run the HTML/asset checks as part of the existing landing build.

## Local validation — 2026-09-15

- Landing production build and dashboard build passed on macOS arm64 / Node 22.20.0. All workspace typechecks passed; the existing suite passed 152/152 tests.
- Local Wrangler Pages returned 200 for public pages, reservation, robots, sitemap and the PNG; invented top-level and nested paths returned 404.
- Verified MIME types, action-page `X-Robots-Tag`/referrer policy, sitemap membership, generic action metadata, and query isolation.
- Browser: homepage hydration, form submission, fragment-token confirmation and cancellation passed using a temporary **local mock API** with synthetic data. No production email or reservation was created.
- Browser console: no hydration errors or warnings observed. Mobile check at 390 × 844: document width 390, no horizontal page overflow; download content remained readable.
- Landscape card inspected at 1200 × 630 and centered square framing at 630 × 630: logo, headline, supporting line and URL remained readable without clipping.

## Checks after deployment

These have not been performed locally and are required before closing the review issues:

1. Run `npm run check:http -w @hauddy/landing -- https://hauddy.com` against the deployed build, and verify the dashboard action pages' indexing headers.
2. Inspect the homepage and privacy URL in Search Console if authorized access is available. Record observed rendered content and indexing status without promising rankings.
3. Test the production URL in **two actual sharing/debugger contexts**, such as Meta Sharing Debugger and LinkedIn Post Inspector, and record date, URL, card screenshot, and any cache refresh. Do not label a local mock card as a network preview. Confirm the image is fetched successfully and review narrow crops.
4. Recheck verified email links in the deployed reservation flow and retain their fragment tokens. Do not include real tokens in screenshots or reports.

## Primary references

- [Cloudflare Pages route and 404 behavior](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare Pages static response headers](https://developers.cloudflare.com/pages/configuration/headers/)
- [Google JavaScript rendering guidance](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Open Graph required and image metadata](https://ogp.me/)
