// Synthetic remote checks are restricted to the dedicated staging Worker.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const origin = process.argv[2];
assert.equal(origin, 'https://hauddy-platform-staging.barnaba-barcellona.workers.dev');
const admin = process.env.HAUDDY_STAGING_ADMIN_TOKEN;
assert.ok(admin, 'dedicated staging administrator token required');
const tag = randomBytes(5).toString('hex');
const accounts = [];
const request = async (path, method = 'GET', body, key, expected = 200) => {
  const response = await fetch(origin + path, { method, headers: {
    'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}),
  }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
  assert.equal(response.status, expected, `${method} ${path}: ${response.status}`);
  return response.json();
};
try {
  for (const suffix of ['a', 'b']) {
    const email = `release-${tag}-${suffix}@example.test`;
    await request('/admin/invites', 'POST', { email, note: 'synthetic staging release check' }, admin);
    const a = await request('/accounts', 'POST', { username: `smoke${tag}${suffix}`, email, password: randomBytes(24).toString('hex') });
    accounts.push({ ...a, email });
  }
  const a = accounts[0], b = accounts[1];
  const response = await fetch(origin + '/files?name=fixture.txt&mime=text/plain&owner=human', {
    method: 'POST', headers: { authorization: `Bearer ${a.api_key}` }, body: 'synthetic staging data',
  });
  assert.equal(response.status, 200);
  const file = await response.json();
  assert.equal((await fetch(`${origin}/files/${file.file_id}`, { headers: { authorization: `Bearer ${a.api_key}` } })).status, 200);
  await request('/accounts/recovery/request', 'POST', { email: a.email });
  await request('/accounts/recovery/reset', 'POST', { token: '0'.repeat(64), password: 'fixture-replacement' }, undefined, 410);
  await request('/preregistration/request', 'POST', { email: a.email, handle: `hold${tag}` }, undefined, 503);
  await request('/accounts/me', 'DELETE', undefined, a.api_key);
  await request('/accounts/me', 'GET', undefined, a.api_key, 401);
  assert.equal((await fetch(`${origin}/files/${file.file_id}`, { headers: { authorization: `Bearer ${b.api_key}` } })).status, 404);
  assert.equal((await request('/accounts/me', 'GET', undefined, b.api_key)).account_id, b.account_id);
  console.log('PASS remote staging: isolated upload/read/deletion, account isolation, neutral recovery, invalid reset rejection, disabled reservation email');
} finally {
  for (const a of accounts) await fetch(origin + '/accounts/me', { method: 'DELETE', headers: { authorization: `Bearer ${a.api_key}` } }).catch(() => {});
}
