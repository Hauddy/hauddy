#!/usr/bin/env node
/**
 * Sync the given semver to every workspace package.json.
 * Also updates internal @hauddy/* and hauddy literal version pins.
 *
 * Usage: node scripts/set-version.mjs <semver>
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <semver>');
  process.exit(1);
}

const workspaces = [
  '.',
  'packages/protocol',
  'packages/app-shared',
  'packages/web-tokens',
  'packages/sidecar',
  'packages/hub',
  'packages/app',
  'packages/web',
  'packages/landing',
  'packages/platform',
  'packages/desktop',
];

for (const ws of workspaces) {
  const pkgPath = resolve(root, ws, 'package.json');
  const json = JSON.parse(readFileSync(pkgPath, 'utf8'));
  json.version = version;
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (!json[field]) continue;
    for (const [name, ver] of Object.entries(json[field])) {
      if ((name.startsWith('@hauddy/') || name === 'hauddy') && ver !== '*') {
        json[field][name] = version;
      }
    }
  }
  writeFileSync(pkgPath, JSON.stringify(json, null, 2) + '\n');
  console.log(`  ${ws}/package.json → ${version}`);
}

console.log(`\nVersion set to ${version} across all workspaces.`);
