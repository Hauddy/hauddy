# Launch media and brand assets

Canonical mark: packages/web-tokens/logo.svg. No new logo or invented testimonial.
Regenerate SVG/PNG exports with `node packages/landing/scripts/generate-brand.mjs`
and the social card with `npm run social:generate -w @hauddy/landing`. Then run
`python3 packages/landing/scripts/bundle-brand.py` for the deterministic versioned
ZIP. The ZIP contains descriptions/license, light/dark/mono/white transparent
exports, avatar/banner, mascot, social card, current screenshot and recorded stills.
Increment kit version when changing published assets incompatibly.

The current Messages screenshot was captured from this candidate on 2026-09-15,
using a disposable daemon and two actual MCP clients with distinct URL IDs. The
brief/reply are synthetic test data. No saved account or customer conversation was
accessed. The existing demo is separate archival alpha footage, labeled as such.

## Demo edit

`python3 packages/landing/scripts/generate-demo.py` uses FFmpeg (or HAUDDY_FFMPEG).
Original: 50.32s, 1920×1080 H.264/AAC, approximately 16 MB. Main overview: source
15–40s, silent, crop bottom burned narration captions, 1280×626, H.264/yuv420p,
faststart, 25.025s, 594,215 bytes (580 KiB). Reply: source 30–40s, approximately 240KiB.
Poster and message still are 14,410 and 19,642 bytes. The main player loads
metadata, has native keyboard controls, plays inline, and includes English visual
descriptions. Caption font is explicitly sized for readability on mobile.

The original narration was transcribed locally, with product-name transcription
errors corrected; audio was not uploaded to a service. Original VTT and text
transcript include context correcting the old “direct/no middleman” phrasing.
The walkthrough explains visual-only actions. Review captions whenever editing
clip timing. Provider names/logos identify the recorded tools, without endorsement.

## Validation observed

- In-app Chromium desktop 1280×720 and mobile 390×844: actual overview playback
  reached25.025s, no media error; English descriptions visibly rendered.
- A disposable proxy delivered only media at16 KiB/125 ms (1 Mibit/s); the desktop
  player reached the end. The proxy logged 594,215 bytes delivered in 4,662ms. This is a controlled bandwidth simulation, not a
  production network benchmark or Safari/iOS hardware test.
- Local Pages returns200 for a Range request (full-file fallback), with the correct
  video MIME/body. The HTTP guard also validates 206 if the host supports ranges.
  Verify deployed seek/range behavior after publication; do not infer CDN behavior
  from the local shim.
- Public metadata, ZIP, VTT, poster and all guide routes returned the expected
  status/content types. Current screenshot and wordmark variants loaded in browser.
- Small full-screen UI text in the recording is inherently dense on a phone; the
  readable captions and adjacent text walkthrough carry the explanation. The
  recording can be expanded using native fullscreen controls.

Still frames were inspected for visible credentials: no API keys, email tokens or
passwords were found. The original recording includes public demo handles and a
local project path; these are not presented as anonymous customer research.
