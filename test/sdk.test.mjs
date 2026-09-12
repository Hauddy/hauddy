import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startHub } from '../packages/hub/dist/index.js';
import { startLocalApi } from '../packages/sidecar/dist/local-api.js';
import { HauddyClient } from '../packages/sdk/dist/index.js';

test('SDK connects to the actual local MCP endpoint and terminates its session', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-sdk-'));
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true });
  const agent = hub.store.registerAgent({ grant_scope_id: 'sdk', public_key: 'fixture' });
  let provisionedId;
  const local = await startLocalApi({ port: 0, daemon: { createHttpMcpProvision(id) {
    provisionedId = id;
    return async () => ({ endpoint: hub.wsUrl, agentId: agent.agent_id, connection: {} });
  } } });
  t.after(async () => { await local.close(); await hub.close(); rmSync(dir, { recursive: true, force: true }); });
  const client = new HauddyClient({ hub: local.url + '/mcp', handle: 'sdk-bot' });
  await client.connect();
  const session = client.transport.sessionId;
  assert.ok(session);
  assert.equal(provisionedId, 'sdk-bot');
  assert.equal((await client.whoami()).agent_id, agent.agent_id);
  await client.close();
  const result = await fetch(local.url + '/mcp', { method: 'POST', headers: { 'mcp-session-id': session, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(result.status, 404);
});
