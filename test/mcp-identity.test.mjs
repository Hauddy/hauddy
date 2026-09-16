import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Disposable home and ephemeral ports: never enroll in the developer's hub.
process.env.HAUDDY_HUB_PORT = '0';
const { Daemon } = await import('../packages/sidecar/dist/daemon.js');
const { startLocalApi } = await import('../packages/sidecar/dist/local-api.js');

test('HTTP identity selection isolates agents and reuses them across reconnects', async (t) => {
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'hauddy-mcp-identity-'));
  t.mock.method(os, 'homedir', () => scratch);
  const daemon = new Daemon();
  const connections = new Set();
  const createProvision = daemon.createHttpMcpProvision.bind(daemon);
  t.mock.method(daemon, 'createHttpMcpProvision', (...args) => {
    const provision = createProvision(...args);
    return async () => { const p = await provision(); connections.add(p.connection); return p; };
  });
  const clients = [];
  let api;
  t.after(async () => {
    for (const client of clients) await client.close();
    for (const connection of connections) connection.stop();
    await api?.close();
    await daemon.stop();
    rmSync(scratch, { recursive: true, force: true });
  });
  await daemon.start();
  api = await startLocalApi({ daemon, port: 0 });
  const connect = async (suffix = '') => {
    const client = new Client({ name: 'identity-test', version: '1' });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL('/mcp' + suffix, api.url)));
    return client;
  };
  const call = (client, name, args = {}) => client.callTool({ name, arguments: args });
  const result = async (client, name, args = {}) => {
    const response = await call(client, name, args);
    assert.ok(!response.isError, response.content[0].text);
    return JSON.parse(response.content[0].text);
  };
  const a = await connect();
  const b = await connect();

  await t.test('unidentified clients cannot rename or mutate the shared default agent', async () => {
    assert.equal((await result(a, 'whoami')).identity_required, true);
    assert.equal((await result(b, 'whoami')).identity_required, true);
    for (const [tool, args] of [['set_nickname', { nickname: 'stolen' }], ['set_identity', { description: 'stolen' }], ['add_contact', { handle: '@peer' }]]) {
      const response = await call(b, tool, args);
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /Identity not selected/);
    }
    assert.equal((await daemon.listAgents()).length, 0);
  });

  let researcher;
  let builder;
  await t.test('different local IDs create distinct agents; renaming one does not affect the other', async () => {
    [researcher, builder] = await Promise.all([
      result(a, 'whoami', { local_id: 'research' }),
      result(b, 'whoami', { local_id: 'builder' }),
    ]);
    assert.notEqual(researcher.agent_id, builder.agent_id);
    await result(a, 'set_nickname', { nickname: 'researcher' });
    await result(b, 'set_nickname', { nickname: 'builder' });
    assert.equal((await result(a, 'whoami')).nickname, '@researcher');
    assert.equal((await result(b, 'whoami')).nickname, '@builder');
    await result(a, 'add_contact', { handle: '@builder' });
    await result(b, 'add_contact', { handle: '@researcher' });
    await result(a, 'send_sms', { to: '@builder', body: 'separate identities' });
    const inbox = await result(b, 'check_messages');
    assert.ok(inbox.messages.some(m => m.payload?.body === 'separate identities' || m.body === 'separate identities'), JSON.stringify(inbox));
    assert.equal((await result(a, 'check_messages')).messages.length, 0);
  });

  await t.test('reconnecting selects the existing ID and handle without duplicating or renaming', async () => {
    const reopened = await connect();
    const me = await result(reopened, 'whoami', { local_id: 'research' });
    assert.equal(me.agent_id, researcher.agent_id);
    assert.equal(me.nickname, '@researcher');
    assert.equal((await daemon.listAgents()).length, 2);
    const switched = await call(reopened, 'whoami', { local_id: 'builder' });
    assert.equal(switched.isError, true);
    assert.match(switched.content[0].text, /already bound/);
    assert.equal((await result(reopened, 'whoami')).agent_id, researcher.agent_id);
  });

  await t.test('configured URL IDs remain compatible and cannot be overridden', async () => {
    const configured = await connect('?id=builder');
    assert.equal((await result(configured, 'whoami')).agent_id, builder.agent_id);
    assert.equal((await call(configured, 'whoami', { local_id: 'research' })).isError, true);
    // Existing clients can still invoke tools directly when the URL selects identity.
    assert.equal((await result(configured, 'set_nickname', { nickname: 'builder' })).ok, true);
    const legacy = await connect('?id=claude');
    const legacyId = (await result(legacy, 'whoami')).agent_id;
    const explicitLegacy = await connect();
    assert.equal((await result(explicitLegacy, 'whoami', { local_id: 'claude' })).agent_id, legacyId);
  });

  await t.test('invalid IDs are rejected rather than silently collapsing into another identity', async () => {
    for (const id of ['', 'research!', 'a'.repeat(41)]) {
      const response = await fetch(new URL('/mcp?id=' + encodeURIComponent(id), api.url));
      assert.equal(response.status, 400);
    }
    const unbound = await connect();
    assert.equal((await call(unbound, 'whoami', { local_id: '../research' })).isError, true);
    assert.equal((await result(unbound, 'whoami')).identity_required, true);
  });
});
