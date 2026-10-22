// Production state backup/promotion. Tests inject providers; imports never perform I/O.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, targets } from './release-artifacts.mjs';

const projects = ['hauddy-app', 'hauddy-landing'];
const workerPath = '/workers/scripts/hauddy-platform/deployments';
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');

export function productionProviders() {
  const account = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  assert.ok(account && token, 'Cloudflare account and token required');
  return {
    async api(path, body) {
      const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60_000),
      });
      const data = await response.json();
      assert.ok(response.ok && data.success, `Cloudflare request failed: ${path} (${response.status})`);
      return data.result;
    },
    async version() {
      const r = await fetch('https://api.hauddy.com/api/version', { signal: AbortSignal.timeout(30_000) });
      assert.ok(r.ok, 'cannot read advertised production version');
      const { latest } = await r.json();
      assert.match(latest, /^\d+\.\d+\.\d+$/);
      return latest;
    },
    async object(action, key, file) {
      execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'r2', 'object', action,
        `hauddy-releases/downloads/${key}`, '--file', file, '--remote',
        ...(action === 'put' ? ['--content-type', 'application/octet-stream'] : [])], { stdio: 'pipe' });
    },
  };
}

export async function releaseOperation(mode, artifacts, backup, io, sitesOnly = false) {
  const snapshotPath = join(backup, 'snapshot.json');
  if (mode === 'snapshot') {
    mkdirSync(backup, { recursive: true });
    assert.ok(!existsSync(snapshotPath), 'never overwrite a completed rollback snapshot');
    const state = { sha: process.env.GITHUB_SHA, capturedAt: new Date().toISOString(), pages: {}, downloads: [] };
    for (const name of projects) {
      const project = await io.api(`/pages/projects/${name}`);
      assert.ok(project.canonical_deployment?.id, `no production deployment for ${name}`);
      state.pages[name] = project.canonical_deployment.id;
    }
    if (!sitesOnly) {
      const { deployments } = await io.api(workerPath);
      assert.ok(deployments?.[0]?.versions?.length, 'no previous Worker deployment');
      state.worker = deployments[0].versions;
      state.version = await io.version();
      for (const [, latest] of targets) {
        const file = join(backup, latest);
        await io.object('get', latest, file);
        const bytes = readFileSync(file);
        assert.ok(bytes.length, `${latest}: empty rollback file`);
        state.downloads.push({ latest, sha256: sha256(bytes) });
      }
    }
    // Only complete snapshots can be used to promote or restore anything.
    save(snapshotPath, state);
    return;
  }
  if (mode === 'restore') {
    if (!existsSync(snapshotPath)) return; // failed before any production writes
    const state = read(snapshotPath);
    // Check all backups before restoring anything.
    for (const row of state.downloads) assert.equal(sha256(readFileSync(join(backup, row.latest))), row.sha256, 'rollback checksum mismatch');
    const errors = [];
    const attempt = async fn => { try { await fn(); } catch (error) { errors.push(error); } };
    for (const row of state.downloads) await attempt(() => io.object('put', row.latest, join(backup, row.latest)));
    for (const [name, id] of Object.entries(state.pages)) await attempt(async () => {
      const current = await io.api(`/pages/projects/${name}`);
      if (current.canonical_deployment?.id !== id) await io.api(`/pages/projects/${name}/deployments/${id}/rollback`, {});
    });
    if (state.worker) await attempt(async () => {
      const { deployments } = await io.api(workerPath);
      if (JSON.stringify(deployments[0]?.versions) !== JSON.stringify(state.worker)) {
        await io.api(workerPath, { strategy: 'percentage', versions: state.worker });
      }
    });
    save(join(backup, 'restore-result.json'), { completedAt: new Date().toISOString(), failures: errors.map(e => e.message) });
    if (errors.length) throw new AggregateError(errors, 'Rollback incomplete: inspect restore-result.json');
    return;
  }
  assert.ok(['archive', 'promote'].includes(mode), 'unknown release operation');
  const snapshot = read(snapshotPath);
  assert.equal(snapshot.downloads.length, 4, 'complete rollback snapshot required');
  const manifest = read(join(artifacts, 'release-manifest.json'));
  assert.equal(manifest.sha, process.env.GITHUB_SHA, 'artifact source must match this run');
  assert.equal(manifest.artifacts.length, 4);
  assert.equal(new Set(manifest.artifacts.map(a => a.latest)).size, 4, 'distinct download targets required');
  const oldParts = snapshot.version.split('.').map(Number), newParts = manifest.version.split('.').map(Number);
  const difference = newParts.map((n, i) => n - oldParts[i]).find(n => n !== 0) ?? 0;
  assert.ok(difference > 0, 'release must advance the advertised version');
  for (const row of manifest.artifacts) {
    assert.ok(targets.some(([, latest]) => latest === row.latest));
    assert.equal(row.name, row.name.split(/[\\/]/).at(-1));
    assert.equal(sha256(readFileSync(join(artifacts, row.name))), row.sha256, 'installer checksum mismatch');
  }
  for (const row of manifest.artifacts) await io.object('put', mode === 'archive' ? row.name : row.latest, join(artifacts, row.name));
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [mode, artifacts, backup, scope] = process.argv.slice(2);
  // An early build failure has no snapshot and requires no credentials or rollback.
  if (mode !== 'restore' || existsSync(join(backup, 'snapshot.json'))) {
    await releaseOperation(mode, resolve(artifacts), resolve(backup), productionProviders(), scope === 'sites');
  }
}
