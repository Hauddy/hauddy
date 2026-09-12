import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Outbox } from '../packages/hub/dist/outbox.js';
import { startHub } from '../packages/hub/dist/index.js';
import { Daemon } from '../packages/sidecar/dist/daemon.js';
const envelope = (id) => ({ v: '0.1', id, type: 'sms', from: 'local', to: 'remote', ts: new Date().toISOString(), payload: { body: 'keep me' }, sig: null });

test('durable outbound entries survive failures/restart and replay the same ID after a lost receipt', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-outbox-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ids = new Set(); let attempts = 0;
  const forward = async (_, e) => {
    ids.add(e.id); attempts++;
    if (attempts < 2) throw new Error('lost receipt');
    return { status: 'queued' };
  };
  const box = new Outbox(dir, forward, () => {});
  box.enqueue(envelope('stable'));
  await box.flush();
  const restarted = new Outbox(dir, forward, () => {});
  await restarted.flush(); await restarted.flush();
  assert.equal(attempts, 2);
  assert.equal(ids.size, 1);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'outbox.json'))).stable.state, 'sent');
  assert.throws(() => restarted.enqueue({ ...envelope('stable'), payload: { body: 'changed' } }), /already used/);
});

test('remote queued receipt has durable history and terminal rejection becomes visible', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-queue-http-'));
  const hub = await startHub({ port: 0, dataDir: dir, autoLink: true,
    forwardRemote: async () => { throw Object.assign(new Error('recipient refused'), { permanent: true }); } });
  t.after(async () => { await hub.close(); rmSync(dir, { recursive: true, force: true }); });
  const human = hub.store.ensureHumanAgent('local', 'human');
  hub.setRemotes([{ agent_id: 'remote', nickname: '@remote', online: false, callReady: false }]);
  const res = await fetch(hub.httpUrl + '/console/sms', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ to: '@remote', body: 'keep me', message_id: 'stable' }) });
  assert.equal((await res.json()).status, 'queued');
  for (let i = 0; hub.history.messageReceipt('stable')?.outbound_state !== 'failed' && i < 20; i++) await new Promise(r => setTimeout(r, 10));
  assert.equal(hub.history.messagesSince(new Set([human.agent_id]), 0).length, 1);
  assert.equal(hub.history.messageReceipt('stable').delivery_error, 'recipient refused');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'outbox.json'))).stable.state, 'failed');
});

test('outbox reconciles a committed receipt after history persistence fails or the hub restarts', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-outbox-history-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  let forwarded = 0, changes = 0;
  const forward = async () => { forwarded++; return { status: 'queued' }; };
  const box = new Outbox(dir, forward, () => { if (++changes === 1) throw new Error('disk full'); });
  box.enqueue(envelope('reconcile'));
  await assert.rejects(box.flush(), /disk full/);
  await box.flush();
  assert.equal(changes, 2);
  const restarted = new Outbox(dir, forward, (row) => { changes++; assert.equal(row.state, 'sent'); });
  await restarted.flush(); await restarted.flush();
  assert.equal(changes, 3);
  assert.equal(forwarded, 1, 'committed upstream receipt is not sent again');
});

test('missing attachment prevents upstream relay rather than stripping the file', async (t) => {
  const os = (await import('node:os')).default;
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-relay-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  t.mock.method(os, 'homedir', () => dir);
  const { saveAccount } = await import('../packages/sidecar/dist/account.js');
  saveAccount({ endpoint: 'ws://fixture', api_key: 'key' });
  const daemon = Object.create(Daemon.prototype);
  let sent = false;
  daemon.bridge = { connectionFor: () => ({ isReady: () => true, relay: async () => { sent = true; return { status: 'queued' }; } }) };
  daemon.hubHandle = { files: { get: () => null } };
  await assert.rejects(daemon.forwardRemote('local', { ...envelope('id'), payload: { body: 'hello', attachments: [{ file_id: 'missing', name: 'important.txt' }] } }), /expired or missing/);
  assert.equal(sent, false);
});
