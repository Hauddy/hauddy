/**
 * Rasterizes the Hauddy mark into macOS menu-bar template icons:
 * monochrome black-on-transparent (macOS auto-inverts for dark menu bars),
 * 18pt + @2x. Source geometry mirrors packages/web-tokens/logo.svg with the
 * strokes recolored black and slightly thickened for menu-bar legibility.
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(here, '..', 'assets');

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">
  <circle cx="10" cy="27" r="6.5" fill="none" stroke="#000000" stroke-width="4.5"/>
  <circle cx="38" cy="27" r="6.5" fill="none" stroke="#000000" stroke-width="4.5"/>
  <path d="M14.2 22 Q24 12 33.8 22" fill="none" stroke="#000000" stroke-width="4.5" stroke-linecap="round"/>
</svg>`;

async function render(size, content, file) {
  const pad = Math.round((size - content) / 2);
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(content, content, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({
      top: pad,
      bottom: size - content - pad,
      left: pad,
      right: size - content - pad,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(path.join(outDir, file));
  console.log(`wrote assets/${file} (${size}x${size})`);
}

// Colored app icon — the Hauddy mark on the brand card. Uses the EXACT canonical
// logo geometry (packages/web-tokens/logo.svg = the top-bar mark) scaled into a
// 1024 canvas, so the Dock/app icon and the in-app wordmark are pixel-consistent.
const appIconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 48 48">
  <rect width="48" height="48" rx="10" fill="#121415"/>
  <circle cx="10" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/>
  <circle cx="38" cy="27" r="6.5" fill="none" stroke="#6FA06A" stroke-width="3.5"/>
  <path d="M14.2 22 Q24 12 33.8 22" fill="none" stroke="#6FA06A" stroke-width="3.5" stroke-linecap="round"/>
</svg>`;

async function renderAppIcon() {
  await sharp(Buffer.from(appIconSvg), { density: 512 })
    .resize(1024, 1024)
    .png()
    .toFile(path.join(outDir, 'icon.png'));
  console.log('wrote assets/icon.png (1024x1024)');
}

await mkdir(outDir, { recursive: true });
await render(18, 15, 'trayTemplate.png');
await render(36, 30, 'trayTemplate@2x.png');
await renderAppIcon();
