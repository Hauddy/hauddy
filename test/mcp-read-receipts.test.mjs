import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHub } from '../packages/hub/dist/index.js';
import { HubConnection } from '../packages/sidecar/dist/connection.js';
import { createMcpServer } from '../packages/sidecar/dist/mcp.js';
import { CallValidation } from '../packages/sidecar/dist/wake.js';
import { markAgentRead } from '../packages/sidecar/dist/hub-api.js';

for (const transport of ['http', 'stdio']) test(`${transport} MCP check_messages persists local read receipts and retries failed markers`, async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-mcp-read-'));
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  t.after(async () => { await hub.close(); rmSync(dir, { recursive: true, force: true }); });
  hub.store.ensureHumanAgent('local', 'human');
  const keys = generateKeyPairSync('ed25519');
  const reg = await fetch(`${hub.httpUrl}/register`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ grant_scope_id: 'scope', public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }) }).then((r) => r.json());
  const conn = new HubConnection({ endpoint: hub.wsUrl, agentId: reg.agent_id, grantScopeId: 'scope', privateKey: keys.privateKey });
  const ready = once(conn, 'ready');
  conn.start();
  await ready;
  t.after(() => conn.stop());
  const errors = [];
  const server = createMcpServer(async () => ({ endpoint: hub.wsUrl, agentId: reg.agent_id, connection: conn,
    activity: { push: (kind, detail) => errors.push({ kind, detail }) } }), new CallValidation(), { transport });
  const client = new Client({ name: 'fixture', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  t.after(async () => { await client.close(); await server.close(); });
  const sent = await fetch(`${hub.httpUrl}/console/sms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: reg.agent_id, body: 'read me' }) });
  assert.equal(sent.status, 200, await sent.text());
  for (let i = 0; !conn.inbox.length && i < 100; i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(conn.inbox.length, 1);
  const id = conn.inbox[0].id;
  const originalFetch = globalThis.fetch;
  let fail = true;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    if (String(url).endsWith('/console/sms/agent-read') && fail) return Response.json({ error: 'temporarily unavailable' }, { status: 503 });
    return originalFetch(url, options);
  });
  const read = async () => JSON.parse((await client.callTool({ name: 'check_messages', arguments: {} })).content[0].text);
  const first = await read();
  assert.equal(first.messages[0].id, id);
  assert.match(first.read_receipt_error, /retry/);
  assert.equal(hub.history.agentReadSince(0, new Set([reg.agent_id])).length, 0);
  assert.equal(errors[0].kind, 'error');
  fail = false;
  const retry = await read();
  assert.deepEqual(retry.messages, []);
  assert.equal(retry.read_receipt_error, undefined);
  assert.deepEqual(hub.history.agentReadSince(0, new Set([reg.agent_id])), [id]);
});

test('read receipt HTTP helper converts secure WebSocket endpoints and rejects HTTP errors', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    assert.equal(url, 'https://fixture/console/sms/agent-read');
    return Response.json({ error: 'unavailable' }, { status: 500 });
  });
  await assert.rejects(markAgentRead('wss://fixture', ['id']), /unavailable/);
});
