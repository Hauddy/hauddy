import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HubHistory } from '../packages/hub/dist/history.js';
import { SyncEngine } from '../packages/sidecar/dist/sync.js';

const row = (id) => ({ message_id: `m${id}`, from_agent: 'remote', to_agent: 'platform', from_nick: null, to_nick: null,
  body: 'x'.repeat(1024), attachments: null, created_at: '2026-09-01T00:00:00Z', created_ms: 1,
  delivered_at: null, read_at: null, agent_read_at: null });
const page = (n) => ({ messages: Array.from({ length: n }, (_, i) => ({ row: row(i), repair: {} })),
  calls: [{ call_id: 'c', caller: 'platform', callee: 'remote', caller_nick: null, callee_nick: null,
    state: 'ended', started_ms: 1, answered_ms: 2, ended_ms: 3, end_reason: 'hangup' }],
  frames: [{ frame_id: 'f', call_id: 'c', seq: 0, from_agent: 'platform', body: 'hello', attachments: null, created_ms: 2 }] });
function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'hauddy-batch-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return { dir, history: new HubHistory(dir) };
}

test('a 500-message sync page saves once and replay preserves content with no writes', (t) => {
  const { dir, history } = fixture(t);
  const save = t.mock.method(history, 'save');
  const input = page(500);
  history.importSyncPage(input);
  assert.equal(save.mock.callCount(), 1);
  const bytes = readFileSync(path.join(dir, 'history.json'));
  const reloaded = new HubHistory(dir);
  assert.equal(reloaded.messagesSince(new Set(['platform']), 0).length, 500);
  assert.equal(reloaded.callFrames('c')[0].body, 'hello');
  input.messages[0].row.body = 'tampered';
  history.importSyncPage(input);
  assert.equal(save.mock.callCount(), 1);
  assert.deepEqual(readFileSync(path.join(dir, 'history.json')), bytes);
  history.importSyncPage({ ...page(0), messages: [{ row: row(0), repair: { to_agent: 'local' } }] });
  assert.equal(save.mock.callCount(), 2);
  assert.equal(history.messagesSince(new Set(['local']), 0)[0].body, 'x'.repeat(1024));
});

test('failed atomic history write restores memory and leaves the old file intact for retry', (t) => {
  const { dir, history } = fixture(t);
  history.putMessageRow(row('existing'));
  const before = readFileSync(path.join(dir, 'history.json'));
  // A directory at the staging path makes the real writeFileSync fail.
  mkdirSync(path.join(dir, 'history.json.tmp'));
  assert.throws(() => history.importSyncPage(page(500)));
  assert.equal(history.messagesSince(new Set(['platform']), 0).length, 1);
  assert.deepEqual(readFileSync(path.join(dir, 'history.json')), before);
  assert.equal(new HubHistory(dir).getCall('c'), undefined);
  rmSync(path.join(dir, 'history.json.tmp'), { recursive: true });
  history.importSyncPage(page(500));
  assert.equal(new HubHistory(dir).messagesSince(new Set(['platform']), 0).length, 501);
});

test('SyncEngine batches messages, repairs, calls and frames before advancing its cursor', async (t) => {
  const { dir, history } = fixture(t);
  const input = page(500);
  history.putMessageRow({ ...row(0), body: 'original' });
  let writes = 0;
  const save = history.save.bind(history);
  t.mock.method(history, 'save', () => { writes++; save(); });
  const since = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (String(url).includes('/sync/pull')) since.push(new URL(url).searchParams.get('since'));
    return Response.json({ messages: input.messages.map((m) => m.row), calls: [{ ...input.calls[0], frames: input.frames }], now: 123 });
  });
  const context = async () => ({ endpoint: 'ws://fixture', apiKey: 'key', localHumanId: 'human', platformHumanId: 'ph',
    localToPlatform: new Map([['local', 'platform']]), platformToLocal: new Map([['platform', 'local']]),
    platformIdToNickname: new Map([['remote', '@peer']]), nicknameToPlatformId: new Map([['@peer', 'remote']]) });
  const engine = new SyncEngine(history, dir, context);
  mkdirSync(path.join(dir, 'history.json.tmp'));
  await engine.syncOnce();
  assert.equal(history.messagesSince(new Set(['local']), 0).length, 0);
  rmSync(path.join(dir, 'history.json.tmp'), { recursive: true });
  await engine.syncOnce();
  assert.deepEqual(since, ['0', '0']);
  assert.equal(writes, 2, 'one failed save and one successful save');
  const messages = new HubHistory(dir).messagesSince(new Set(['local']), 0);
  assert.equal(messages.length, 500);
  assert.equal(messages[0].body, 'original');
  assert.equal(messages[0].from_agent, '@peer');
  assert.equal(history.callFrames('c')[0].from_agent, 'local');
  const restarted = new SyncEngine(history, dir, context);
  await restarted.syncOnce();
  assert.equal(since.at(-1), '123');
  assert.equal(writes, 2);
});
