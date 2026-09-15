// Distribution contract: do not advertise an unavailable registry package.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const read = file => readFileSync(join(root, file), 'utf8');
function* files(dir) {
  for (const entry of readdirSync(join(root, dir), { withFileTypes: true })) {
    const file = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(file);
    else if (/\.(md|tsx?|py)$/.test(file)) yield file;
  }
}
for (const file of ['README.md', ...files('docs'), ...files('examples'), ...files('packages/landing/src')]) {
  assert.doesNotMatch(read(file), /\bnpx\s+(?:--yes\s+|-y\s+)?hauddy(?:@[^\s`]+)?\s|\bnpm\s+(?:install|i)\s+(?:--global\s+|-g\s+)?hauddy(?:[\s`]|$)/, `${file}: CLI must use the documented source install or desktop downloads`);
}
assert.match(read('README.md'), /img\.shields\.io\/github\/v\/release\/Hauddy\/hauddy/);
assert.doesNotMatch(read('docs/getting-started.md'), /(?:Linux|Windows).*coming soon/i);
for (const file of ['README.md', 'docs/getting-started.md']) {
  for (const platform of ['mac', 'linux-deb', 'linux-appimage', 'windows']) {
    assert.ok(read(file).includes(`https://api.hauddy.com/download/${platform}`), `${file}: missing ${platform} download`);
  }
}
for (const name of ['OpenSource', 'Footer']) {
  assert.match(read(`packages/landing/src/components/${name}.tsx`), /href="https:\/\/github.com\/Hauddy\/hauddy"/);
}
console.log('PASS entry-point distribution, release badge, platform and repository links');
