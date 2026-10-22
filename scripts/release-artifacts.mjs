import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkReleaseVersion } from './check-release-version.mjs';

export const targets = [
  ['.dmg', 'mac-arm64-latest.dmg'], ['.deb', 'linux-amd64-latest.deb'],
  ['.AppImage', 'linux-x86_64-latest.AppImage'], ['.exe', 'windows-x64-latest.exe'],
];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function releaseManifest(directory, version, sha, runUrl) {
  assert.match(sha, /^[a-f0-9]{40}$/, 'exact source SHA required');
  const names = readdirSync(directory);
  const artifacts = targets.map(([extension, latest]) => {
    const matches = names.filter(n => n.endsWith(extension));
    assert.equal(matches.length, 1, `expected exactly one ${extension} installer`);
    const name = matches[0];
    assert.ok(name.includes(version), `${name} does not contain release version`);
    const bytes = readFileSync(join(directory, name));
    assert.ok(bytes.length > 0, `${name} is empty`);
    return { name, latest, bytes: bytes.length, sha256: sha256(bytes) };
  });
  return { version, sha, verificationRun: runUrl, artifacts };
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const directory = resolve(process.argv[2]);
  const manifest = releaseManifest(directory, checkReleaseVersion(), process.env.GITHUB_SHA,
    `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);
  writeFileSync(join(directory, 'release-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log('Recorded four installer checksums, version, source SHA and verification run');
}
