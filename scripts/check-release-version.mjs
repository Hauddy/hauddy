import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkReleaseVersion(root = '.', ref = process.env.GITHUB_REF ?? '') {
  const read = p => JSON.parse(readFileSync(resolve(root, p), 'utf8'));
  const { version } = read('package.json');
  assert.match(version, /^\d+\.\d+\.\d+$/, 'release version must be a stable semver');
  if (ref.startsWith('refs/tags/')) assert.equal(ref, `refs/tags/v${version}`, 'tag must match committed version');
  const lock = read('package-lock.json');
  assert.equal(lock.version, version, 'lockfile version');
  for (const dir of ['', ...readdirSync(resolve(root, 'packages')).map(p => `packages/${p}`)]) {
    const pkg = read(`${dir ? dir + '/' : ''}package.json`);
    assert.equal(pkg.version, version, `${dir || 'root'} version`);
    assert.equal(lock.packages[dir]?.version, version, `${dir || 'root'} lockfile version`);
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, pin] of Object.entries(pkg[field] ?? {})) {
        if ((name.startsWith('@hauddy/') || name === 'hauddy') && pin !== '*') assert.equal(pin, version, `${dir}: ${name}`);
      }
    }
  }
  assert.ok(readFileSync(resolve(root, 'packages/sidecar/src/version.ts'), 'utf8').includes(`SIDECAR_VERSION = "${version}"`), 'generated sidecar version');
  return version;
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) console.log(`PASS committed release version ${checkReleaseVersion()}`);
