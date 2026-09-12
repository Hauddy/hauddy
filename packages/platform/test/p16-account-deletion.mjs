// Run against disposable local workerd storage:
// wrangler dev -c packages/platform/wrangler.toml --local --port 8799 --var RATE_LIMIT:off
// node packages/platform/test/p16-account-deletion.mjs http://127.0.0.1:8799
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
const base = process.argv[2] ?? 'http://127.0.0.1:8799';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname), 'disposable local runtime required');
async function request(path, method = 'GET', body, key, status = 200) {
  const response = await fetch(base + path, { method,
    headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  assert.equal(response.status, status, JSON.stringify(data));
  return data;
}
const tag = Math.random().toString(36).slice(2, 9);
const a = await request('/accounts', 'POST', { username: `delete${tag}`, email: `delete${tag}@example.test`, password: 'fixture-password' });
const b = await request('/accounts', 'POST', { username: `keep${tag}`, email: `keep${tag}@example.test`, password: 'fixture-password' });
const reg = await request('/register', 'POST', { grant_scope_id: `scope-${tag}`, public_key: generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'pem' }).toString(), nickname: `agent${tag}` }, a.api_key);
const connector = await request('/accounts/connectors', 'POST', { handle: `conn${tag}`, scope: ['send', 'read', 'files'] }, a.api_key);
const me = await request('/accounts/me', 'GET', undefined, a.api_key);
const human = me.agents.find((a) => a.kind === 'human');
assert.ok(human);
await request('/console/sms', 'POST', { to: reg.agent_id, body: 'delete this history' }, a.api_key);
await request('/console/notifications/seen', 'POST', {}, a.api_key);
const upload = await fetch(base + '/files?name=test.txt&mime=text/plain', { method: 'POST', headers: { authorization: `Bearer ${a.api_key}` }, body: 'attachment' });
assert.equal(upload.status, 200);
const file = await upload.json();
assert.equal((await fetch(base + `/files/${file.file_id}`, { headers: { authorization: `Bearer ${a.api_key}` } })).status, 200);
await request('/accounts/me', 'DELETE', undefined, undefined, 401);
assert.equal((await request('/accounts/me', 'DELETE', undefined, a.api_key)).ok, true);
await request('/accounts/me', 'GET', undefined, a.api_key, 401);
await request(`/files/${file.file_id}`, 'GET', undefined, b.api_key, 404);
assert.equal((await request('/accounts/me', 'GET', undefined, b.api_key)).account_id, b.account_id);
const oauth = await fetch(base + '/oauth/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'client_credentials', client_id: connector.client_id, client_secret: connector.client_secret }) });
assert.equal((await oauth.json()).error, 'invalid_client');
assert.equal((await fetch(base + '/v1/messages', { headers: { authorization: `Bearer ${connector.token}` } })).status, 401);
// The old handles are released and can be claimed by another account.
await request('/accounts/connectors', 'POST', { handle: `conn${tag}`, scope: ['read'] }, b.api_key);
await request('/accounts/me', 'DELETE', undefined, b.api_key);
console.log('Account deletion passed on local workerd: auth, owned history, file access, OAuth revocation, unrelated account, handle reuse.');
