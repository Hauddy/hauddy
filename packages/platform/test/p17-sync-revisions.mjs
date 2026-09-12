// Disposable local Cloudflare regression for revision paging and mutable imports.
import assert from 'node:assert/strict';
const base = process.argv[2] ?? 'http://127.0.0.1:8799';
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(base).hostname));
const tag = Math.random().toString(36).slice(2, 8);
async function req(path, body, key, method = body === undefined ? 'GET' : 'POST') {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json(); assert.equal(res.status, 200, JSON.stringify(data)); return data;
}
const a = await req('/accounts', { username: 'sync' + tag, email: tag + '@sync.test', password: 'fixture-password' });
const me = await req('/accounts/me', undefined, a.api_key);
const human = me.agents.find(a => a.kind === 'human').agent_id;
const messages = Array.from({ length: 501 }, (_, i) => ({ message_id: `m${tag}${i}`, from_agent: human, to_agent: 'local-peer', body: 'original', created_at: '1970-01-01T00:00:00.001Z', created_ms: 1 }));
const calls = Array.from({ length: 201 }, (_, i) => ({ call_id: `c${tag}${i}`, caller: human, callee: 'local-peer', state: 'ringing', started_ms: 1, frames: [] }));
await req('/console/sync/messages', { messages }, a.api_key);
await req('/console/sync/calls', { calls }, a.api_key);
let cursor = 0, more = true;
const seen = new Set();
while (more) {
  const page = await req('/console/sync/pull?cursor=' + cursor, undefined, a.api_key);
  for (const row of [...page.messages, ...page.calls]) seen.add(row.message_id ?? row.call_id);
  assert.ok(page.next_cursor > cursor);
  cursor = page.next_cursor; more = page.has_more;
}
assert.equal(seen.size, 702);
await req('/console/sync/messages', { messages: [{ ...messages[0], body: 'tampered', agent_read_at: '2026-09-12T00:00:00Z' }, { ...messages[0], message_id: 'late' + tag }] }, a.api_key);
await req('/console/sync/calls', { calls: [{ ...calls[0], state: 'ended', answered_ms: 2, ended_ms: 3, frames: [{ frame_id: 'f' + tag, from_agent: human, body: 'later', created_ms: 2 }] }] }, a.api_key);
const updates = await req('/console/sync/pull?cursor=' + cursor, undefined, a.api_key);
assert.equal(updates.messages.length, 2);
assert.equal(updates.messages.find(m => m.message_id === messages[0].message_id).body, 'original');
assert.ok(updates.messages.find(m => m.message_id === messages[0].message_id).agent_read_at);
assert.equal(updates.calls[0].state, 'ended');
assert.equal(updates.calls[0].frames[0].body, 'later');
await req('/accounts/me', undefined, a.api_key, 'DELETE');
console.log('Revision sync passed on workerd: 501 messages, 201 calls, backdated imports, immutable bodies, receipts and call updates.');
