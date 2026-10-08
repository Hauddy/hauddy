import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { startHub } from '../packages/hub/dist/index.js';
import { createMcpServer } from '../packages/sidecar/dist/mcp.js';
import { CallValidation } from '../packages/sidecar/dist/wake.js';

for (const tool of ['send_sms', 'place_call']) {
  test(`${tool} accepts contact IDs and handles without bypassing the curated book`, async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-mcp-contacts-'));
    let book = ['joule-env', 'remote'];
    const hub = await startHub({ port: 0, dataDir: dir, autoLink: true, bookOf: () => book });
    t.after(async () => { await hub.close(); rmSync(dir, { recursive: true, force: true }); });
    const register = async (nickname) => {
      const keys = generateKeyPairSync('ed25519');
      return fetch(`${hub.httpUrl}/register`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ grant_scope_id: nickname, nickname,
          public_key: keys.publicKey.export({ type: 'spki', format: 'pem' }).toString() }),
      }).then((r) => r.json());
    };
    const self = await register('sender');
    const peer = await register('joule-env');
    const outsider = await register('outsider');
    const remoteId = 'agt_01m4dbgh8ztmhqj71kpy0apedq';
    hub.setRemotes([{ agent_id: remoteId, nickname: '@remote', online: true }]);
    const sent = [];
    const connection = {
      sendSms: async (to) => { sent.push(to); return { id: 'msg-fixture', status: 'delivered' }; },
      sendCall: (to) => { sent.push(to); },
      awaitCall: async () => ({ kind: 'frame', from: peer.agent_id, body: 'hello' }),
    };
    const server = createMcpServer(async () => ({ endpoint: hub.wsUrl, agentId: self.agent_id,
      connection, getBook: () => book }), new CallValidation());
    const client = new Client({ name: 'contact-fixture', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    t.after(async () => { await client.close(); await server.close(); });
    const call = async (name, args = {}) => JSON.parse((await client.callTool({ name, arguments: args })).content[0].text);
    const send = (to, extra = {}) => call(tool, { to, ...(tool === 'send_sms' ? { body: 'hello' } : {}), ...extra });
    const contacts = (await call('list_contacts')).contacts;
    assert.deepEqual(new Set(contacts.map((c) => c.agent_id)), new Set([peer.agent_id, remoteId]));
    for (const to of [peer.agent_id, remoteId, '@joule-env', 'joule-env', '@JOULE-ENV']) {
      const result = await send(to);
      assert.equal(result.status, tool === 'send_sms' ? 'delivered' : 'connected');
      assert.equal(sent.at(-1), to, 'keep the original recipient for transport routing');
    }
    const sentCount = sent.length;
    for (const to of [outsider.agent_id, 'agt_unknown']) {
      const rejected = await send(to, tool === 'send_sms' ? { attachments: ['/missing/should-not-be-read'] } : {});
      assert.equal(rejected.ok, false);
      assert.match(rejected.error, /list_contacts/);
      assert.ok(!rejected.error.includes(`@${to}`), 'never turn an ID into an add_contact handle');
    }
    const unknownHandle = await send('@outsider');
    assert.equal(unknownHandle.ok, false);
    assert.match(unknownHandle.error, /add_contact\("@outsider"\)/);
    book = [];
    assert.equal((await send(peer.agent_id)).ok, false, 'removal takes effect immediately');
    assert.equal((await send('@joule-env')).ok, false);
    assert.equal(sent.length, sentCount, 'blocked recipients never reach the transport');
    book = null;
    assert.equal((await send(peer.agent_id)).status, tool === 'send_sms' ? 'delivered' : 'connected',
      'sessions without a curated book retain auto-discovery');
  });
}
