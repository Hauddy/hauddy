import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import sharp from 'sharp';
const dist = fileURLToPath(new URL('../dist/', import.meta.url));
const read = file => readFileSync(resolve(dist, file), 'utf8');
const pages = [
  ['index.html', '/', 'Hauddy — messaging and live calls for AI agents', 'id="local"'],
  ['privacy.html', '/privacy', 'Privacy Policy — Hauddy', '<h1>Privacy Policy</h1>'],
  ['reservation.html', '/reservation', 'Confirm your handle — Hauddy', '<h1>Confirm your handle</h1>'],
  ['brand.html', '/brand', 'Brand and press kit — Hauddy', '<h1>Brand and press kit</h1>'],
  ['demo.html', '/demo', 'Watch a cross-tool file exchange — Hauddy', '/media/demo-overview.mp4'],
  ['guides/local-agents.html', '/guides/local-agents', 'Connect two local AI agents — Hauddy', '<h1>Connect two local agents'],
  ['guides/hosted-assistants.html', '/guides/hosted-assistants', 'Send files from a hosted assistant to a coding agent — Hauddy', '<h1>Send a file'],
  ['docs/index.html', '/docs', 'Documentation — Hauddy', '<h1>Start with a conversation.'],
  ['docs/installation.html', '/docs/installation', 'Install and connect your tools — Hauddy', '<h1>Connect your first tools.'],
  ['docs/tools.html', '/docs/tools', 'MCP tool reference — Hauddy', 'id="send_sms"'],
  ['guides/index.html', '/guides', 'Workflow guides — Hauddy', '<h1>Make your first handoff.'],
  ['about.html', '/about', 'Why Hauddy — connecting agents across tools', '<h1>Agents should be easy to reach.'],
  ['404.html', null, 'Page not found — Hauddy', '<h1>Page not found</h1>'],
];
for (const [file, route, title, content] of pages) {
  const html = read(file);
  assert.ok(html.includes(`<title>${title}</title>`), `${file}: title`);
  assert.ok(html.includes(content), `${file}: initial content`);
  assert.doesNotMatch(html, /<div id="root"><\/div>|page-metadata:start/);
  assert.match(html, /<meta name="description" content="[^"]+"/);
  if (route) assert.ok(html.includes(`<link rel="canonical" href="https://hauddy.com${route}"`));
  else assert.doesNotMatch(html, /rel="canonical"/);
  const publicPage = file !== 'reservation.html' && file !== '404.html';
  if (publicPage) {
    assert.match(html, /name="robots" content="index, follow"/);
    for (const name of ['title', 'description', 'type', 'url', 'image', 'image:width', 'image:height', 'image:alt']) {
      assert.ok(html.includes(`property="og:${name}"`), `${file}: og:${name}`);
    }
    assert.ok(html.includes(`property="og:url" content="https://hauddy.com${route}"`));
    assert.ok(html.includes(`property="og:title" content="${title}"`));
    assert.match(html, /name="twitter:card" content="summary_large_image"/);
    assert.match(html, /property="og:image" content="https:\/\/hauddy.com\/social\/hauddy-card.png"/);
    assert.match(html, /name="twitter:image:alt" content="[^"]+"/);
  } else {
    assert.match(html, /name="robots" content="noindex, nofollow, noarchive"/);
    assert.doesNotMatch(html, /property="og:|name="twitter:/);
  }
}
assert.match(read('index.html'), /href="https:\/\/api.hauddy.com\/download\/mac"/);
assert.match(read('index.html'), /href="\/privacy"/);
assert.match(read('index.html'), /<noscript>[\s\S]*opacity: 1/);
assert.match(read('reservation.html'), /disabled=""[^>]*>Confirm my reservation/);
assert.equal(existsSync(resolve(dist, '_redirects')), false, 'No catch-all rewrite may hide missing routes');
const locations = [...read('sitemap.xml').matchAll(/<loc>(.*?)<\/loc>/g)].map(match => match[1]);
assert.deepEqual(locations, ['/', '/privacy', '/brand', '/demo', '/guides/local-agents', '/guides/hosted-assistants', '/docs', '/docs/installation', '/docs/tools', '/guides', '/about'].map(path => 'https://hauddy.com' + path));
assert.match(read('robots.txt'), /^User-agent: \*\nAllow: \/\n/m);
assert.match(read('robots.txt'), /Sitemap: https:\/\/hauddy.com\/sitemap.xml/);
assert.match(read('_headers'), /\/reservation\*[\s\S]*X-Robots-Tag: noindex/);
const { format, width, height } = await sharp(resolve(dist, 'social/hauddy-card.png')).metadata();
assert.equal(format, 'png'); assert.equal(width, 1200); assert.equal(height, 630);
const web = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
assert.match(web, /name="robots" content="noindex, nofollow"/);
console.log('PASS initial HTML, route metadata, crawler files, action-page indexing and social image');

assert.equal(readFileSync(resolve(dist, 'brand/hauddy-brand-v1.zip')).subarray(0,2).toString(), 'PK');
for (const file of ['demo-overview.vtt','demo-original.vtt']) assert.match(read('media/'+file), /^WEBVTT/);
for (const file of ['demo-overview.mp4','demo-reply.mp4','demo-poster.webp','demo-messages.webp']) assert.ok(existsSync(resolve(dist,'media',file)));
