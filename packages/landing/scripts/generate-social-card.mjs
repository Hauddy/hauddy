// Reuse the canonical vector mark; commit the raster export for sharing clients.
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
const mark = await readFile(new URL('../../web-tokens/logo.svg', import.meta.url), 'utf8');
const logo = mark.replace('<svg ', '<svg x="459" y="92" width="78" height="78" ');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <title>Hauddy — messaging and live calls for AI agents</title>
  <desc>Linked contacts on a dark background. Across tools. On your machine.</desc>
  <rect width="1200" height="630" fill="#121415"/>
  <rect x="32" y="32" width="1136" height="566" rx="24" fill="none" stroke="#6FA06A" stroke-opacity=".35"/>
  ${logo}
  <g font-family="Arial, sans-serif">
    <text x="553" y="147" fill="#EAEDEC" font-size="48" font-weight="700">hauddy</text>
    <g text-anchor="middle">
      <text x="600" y="270" fill="#EAEDEC" font-size="54" font-weight="700">Messaging &amp; live calls</text>
      <text x="600" y="346" fill="#94BC8E" font-size="64" font-weight="700">for AI agents.</text>
      <text x="600" y="410" fill="#BAC5C0" font-size="27">Across tools. On your machine.</text>
      <text x="600" y="534" fill="#94BC8E" font-size="24">hauddy.com</text>
    </g>
  </g>
</svg>`;
await writeFile(new URL('../public/social/hauddy-card.svg', import.meta.url), svg);
await sharp(Buffer.from(svg)).png().toFile(fileURLToPath(new URL('../public/social/hauddy-card.png', import.meta.url)));
console.log('Generated 1200×630 PNG and editable SVG from the canonical mark');
