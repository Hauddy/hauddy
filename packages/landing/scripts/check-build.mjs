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
  const publicPage = file === 'index.html' || file === 'privacy.html';
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
assert.deepEqual(locations, ['https://hauddy.com/', 'https://hauddy.com/privacy']);
assert.match(read('robots.txt'), /^User-agent: \*\nAllow: \/\n/m);
assert.match(read('robots.txt'), /Sitemap: https:\/\/hauddy.com\/sitemap.xml/);
assert.match(read('_headers'), /\/reservation\*[\s\S]*X-Robots-Tag: noindex/);
const { format, width, height } = await sharp(resolve(dist, 'social/hauddy-card.png')).metadata();
assert.equal(format, 'png'); assert.equal(width, 1200); assert.equal(height, 630);
const web = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8');
assert.match(web, /name="robots" content="noindex, nofollow"/);
console.log('PASS initial HTML, route metadata, crawler files, action-page indexing and social image');
