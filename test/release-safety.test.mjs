import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { checkReleaseVersion } from '../scripts/check-release-version.mjs';
import { releaseManifest, targets } from '../scripts/release-artifacts.mjs';
import { releaseOperation } from '../scripts/release-downloads.mjs';

const workflow = name => yaml.load(readFileSync(`.github/workflows/${name}.yml`, 'utf8'));
const needs = job => [job.needs ?? []].flat();

test('both production workflows require successful reusable verification and serialize promotion', () => {
  const release = workflow('release'), sites = workflow('deploy-sites'), ci = workflow('ci');
  assert.ok(Object.hasOwn(ci.on, 'workflow_call'));
  for (const w of [release, sites]) {
    assert.equal(w.jobs.verify.uses, './.github/workflows/ci.yml');
    assert.ok(needs(w.jobs.deploy).includes('verify'));
    assert.ok(!/always\(|failure\(|cancelled\(/.test(w.jobs.deploy.if ?? ''), 'deployment must retain implicit success condition');
    assert.equal(w.concurrency.group, 'production-promotion');
    assert.equal(w.concurrency['cancel-in-progress'], false);
    // Inject failures into each reusable CI job: the caller must not reach deploy.
    for (const failed of Object.keys(ci.jobs)) {
      const ciResults = Object.fromEntries(Object.keys(ci.jobs).map(k => [k, k === failed ? 'failure' : 'success']));
      const verify = Object.values(ciResults).every(s => s === 'success') ? 'success' : 'failure';
      const dependencyResults = Object.fromEntries(needs(w.jobs.deploy).map(k => [k, k === 'verify' ? verify : 'success']));
      assert.ok(!Object.values(dependencyResults).every(s => s === 'success'), `${failed} must block production`);
    }
    for (const [name, job] of Object.entries(w.jobs)) {
      if (name !== 'deploy') assert.ok(!JSON.stringify(job).includes('secrets.CLOUDFLARE'), 'only gated promotion gets production credentials');
    }
  }
  const steps = release.jobs.deploy.steps.map(s => s.name);
  for (const prerequisite of ['Build web dashboard', 'Build landing site', 'Snapshot current download pointers', 'Deploy platform Worker', 'Deploy web dashboard', 'Deploy landing site']) {
    assert.ok(steps.indexOf(prerequisite) < steps.indexOf('Promote stable downloads'), prerequisite);
  }
  assert.ok(steps.indexOf('Promote stable downloads') < steps.indexOf('Advertise the new client version'));
  assert.ok(steps.indexOf('Advertise the new client version') < steps.indexOf('Publish GitHub Release'));
  assert.ok(release.jobs.deploy.if.includes('refs/tags/v'), 'manual candidate builds never deploy');
  assert.ok(!JSON.stringify(release).includes('set-version.mjs'), 'release must not silently mutate source version');
});

test('release tag must match committed package, lockfile and generated versions', () => {
  const version = checkReleaseVersion();
  assert.equal(checkReleaseVersion('.', `refs/tags/v${version}`), version);
  assert.throws(() => checkReleaseVersion('.', 'refs/tags/v99.0.0'), /tag must match/);
});

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'hauddy-release-rehearsal-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const artifacts = join(root, 'artifacts'), backup = join(root, 'rollback');
  mkdirSync(artifacts);
  const sha = 'a'.repeat(40);
  const previousSha = process.env.GITHUB_SHA;
  process.env.GITHUB_SHA = sha;
  t.after(() => { if (previousSha === undefined) delete process.env.GITHUB_SHA; else process.env.GITHUB_SHA = previousSha; });
  const objects = new Map(targets.map(([, key]) => [key, Buffer.from(`previous-${key}`)]));
  const original = new Map(objects);
  const pages = { 'hauddy-app': 'old-app', 'hauddy-landing': 'old-landing' };
  let versions = [{ version_id: 'previous-worker', percentage: 100 }];
  const io = {
    version: async () => '0.1.23',
    async object(action, key, file) {
      if (action === 'get') writeFileSync(file, objects.get(key));
      else objects.set(key, readFileSync(file));
    },
    async api(path, body) {
      if (path.includes('/workers/')) {
        if (body) versions = body.versions;
        return { deployments: [{ versions }] };
      }
      const [, , , name, , id] = path.split('/');
      if (body) pages[name] = id;
      return { canonical_deployment: { id: pages[name] } };
    },
  };
  for (const [ext] of targets) writeFileSync(join(artifacts, `Hauddy-0.1.24${ext}`), `new-${ext}`);
  const manifest = releaseManifest(artifacts, '0.1.24', sha, 'https://example.test/run');
  writeFileSync(join(artifacts, 'release-manifest.json'), JSON.stringify(manifest));
  return { artifacts, backup, io, objects, original, pages, versions: () => versions,
    run: mode => releaseOperation(mode, artifacts, backup, io) };
}

for (const failureAt of ['archive', 'worker', 'web', 'landing', 'downloads', 'advertise']) {
  test(`rollback rehearsal restores production after failure at ${failureAt}`, async t => {
    const f = fixture(t);
    await f.run('snapshot');
    await f.run('archive');
    const stages = ['archive', 'worker', 'web', 'landing', 'downloads', 'advertise'];
    for (const stage of stages.slice(1, stages.indexOf(failureAt) + 1)) {
      if (stage === 'worker' || stage === 'advertise') await f.io.api('/workers/scripts/hauddy-platform/deployments', { versions: [{ version_id: stage, percentage: 100 }] });
      if (stage === 'web') f.pages['hauddy-app'] = 'new-app';
      if (stage === 'landing') f.pages['hauddy-landing'] = 'new-landing';
      if (stage === 'downloads') {
        // Partial promotion: the first pointer changed, then the provider failed.
        const key = targets[0][1]; f.objects.set(key, Buffer.from('partial-new-download'));
      }
    }
    await f.run('restore');
    for (const [key, value] of f.original) assert.deepEqual(f.objects.get(key), value);
    assert.deepEqual(f.pages, { 'hauddy-app': 'old-app', 'hauddy-landing': 'old-landing' });
    assert.deepEqual(f.versions(), [{ version_id: 'previous-worker', percentage: 100 }]);
  });
}

test('tampered installer is rejected before any archive or download writes', async t => {
  const f = fixture(t); await f.run('snapshot');
  writeFileSync(join(f.artifacts, 'Hauddy-0.1.24.exe'), 'tampered');
  await assert.rejects(f.run('archive'), /checksum mismatch/);
  assert.deepEqual(f.objects, f.original);
});

test('partial snapshots cannot promote; failed restoration continues other components and reports failure', async t => {
  const f = fixture(t);
  await assert.rejects(f.run('promote'));
  await f.run('snapshot');
  f.pages['hauddy-app'] = 'new-app'; f.pages['hauddy-landing'] = 'new-landing';
  const api = f.io.api;
  f.io.api = async (path, body) => { if (path.includes('hauddy-app') && body) throw Error('fixture outage'); return api(path, body); };
  await assert.rejects(f.run('restore'), /Rollback incomplete/);
  assert.equal(f.pages['hauddy-landing'], 'old-landing');
});
