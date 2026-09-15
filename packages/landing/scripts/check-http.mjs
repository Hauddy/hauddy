// Run against Wrangler Pages locally or the deployed public origin.
import assert from 'node:assert/strict';
const origin = process.argv[2] ?? 'http://127.0.0.1:8789';
async function get(path, status, type) {
  const response = await fetch(new URL(path, origin), { signal: AbortSignal.timeout(15000) });
  assert.equal(response.status, status, `${path}: status`);
  assert.ok(response.headers.get('content-type')?.includes(type), `${path}: Content-Type`);
  return { response, text: await response.text() };
}
for (const [path, title] of [['/', 'Hauddy — messaging'], ['/privacy', 'Privacy Policy — Hauddy']]) {
  const { text } = await get(path, 200, 'text/html');
  assert.ok(text.includes(`<title>${title}`));
  assert.match(text, /<h1>/);
  assert.match(text, /property="og:image" content="https:\/\/hauddy.com\/social\/hauddy-card.png"/);
  assert.match(text, /name="twitter:card" content="summary_large_image"/);
}
const { text: robots } = await get('/robots.txt', 200, 'text/plain');
assert.match(robots, /Sitemap: https:\/\/hauddy.com\/sitemap.xml/);
const { text: sitemap } = await get('/sitemap.xml', 200, 'xml');
assert.match(sitemap, /<loc>https:\/\/hauddy.com\/privacy<\/loc>/);
assert.doesNotMatch(sitemap, /reservation|claim|reset|token/);
for (const path of ['/missing-marketing-page', '/missing/deep/page', '/privacy/missing']) {
  const { text } = await get(path, 404, 'text/html');
  assert.match(text, /<h1>Page not found<\/h1>/);
  assert.match(text, /name="robots" content="noindex/);
}
const { text: action, response } = await get('/reservation?token=private-test-token&utm_source=private-test-source', 200, 'text/html');
assert.match(response.headers.get('x-robots-tag') ?? '', /noindex/);
assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
assert.match(action, /name="robots" content="noindex/);
assert.doesNotMatch(action, /private-test-token|private-test-source|property="og:|name="twitter:/);
const { text: campaign } = await get('/?email=private-test-email&token=private-test-token', 200, 'text/html');
assert.doesNotMatch(campaign, /private-test-email|private-test-token/);
assert.match(campaign, /rel="canonical" href="https:\/\/hauddy.com\/"/);
const image = await fetch(new URL('/social/hauddy-card.png', origin), { signal: AbortSignal.timeout(15000) });
assert.equal(image.status, 200); assert.match(image.headers.get('content-type') ?? '', /image\/png/);
const bytes = Buffer.from(await image.arrayBuffer());
assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
assert.equal(bytes.readUInt32BE(16), 1200); assert.equal(bytes.readUInt32BE(20), 630);
console.log('PASS HTTP content/status/types, missing routes, private action metadata, query isolation and sharing image');
