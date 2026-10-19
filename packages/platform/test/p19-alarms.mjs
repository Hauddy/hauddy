// Standalone Workerd test with disposable SQLite, R2 and D1. No deployed endpoints.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

const scratch = await mkdtemp(join(tmpdir(), 'hauddy-alarms-'));
let mf;
try {
  const bundle = await build({ entryPoints: ['packages/platform/test/fixtures/alarm-worker.js'],
    bundle: true, format: 'esm', platform: 'browser', write: false });
  mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-01-01',
    durableObjects: { HUB: { className: 'AlarmTestHub', useSQLite: true } },
    durableObjectsPersist: join(scratch, 'do'), r2Buckets: ['FILES'], r2Persist: join(scratch, 'r2'),
    d1Databases: ['WAITLIST_DB'], d1Persist: join(scratch, 'd1'), bindings: { RATE_LIMIT: 'off' } });
  const request = async (path, scenario) => {
    const response = await mf.dispatchFetch(`http://alarm.test/${path}?case=${scenario}`);
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
  };
  const waitForAlarm = async (scenario) => {
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      const state = await request('state', scenario);
      if (state.run) return state;
      await delay(50);
    }
    assert.fail(`Workerd did not execute ${scenario} alarm`);
  };
  for (const [scenario, interval] of [['mirror', 60_000], ['email', 3_600_000], ['idle', null]]) {
    const { now } = await request('seed', scenario);
    const state = await waitForAlarm(scenario);
    assert.equal(state.run.entryAlarm, null, 'runtime consumes the firing alarm before the handler');
    if (interval === null) assert.equal(state.next, null, 'empty queues do not re-arm');
    else {
      assert.ok(state.next >= now + interval, `${scenario}: next deadline too early`);
      assert.ok(state.next <= state.run.completed + interval, `${scenario}: later attachment must not postpone work`);
    }
    if (scenario === 'mirror') {
      assert.equal(state.pending, 1);
      assert.equal(state.mirrored, 100, 'real D1 receives the first batch');
    }
    await delay(250);
    assert.equal((await request('state', scenario)).run.count, 1, 'no immediate alarm loop');
  }
  const concurrent = await request('concurrent', 'concurrent');
  assert.equal(concurrent.actual, concurrent.expected, 'concurrent transactions preserve the earliest deadline');
  console.log('PASS Workerd shared alarms: real firing, D1 batch continuation, email maintenance, idle queues and concurrent scheduling');
} finally {
  await mf?.dispose();
  await rm(scratch, { recursive: true, force: true });
}
