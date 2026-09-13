import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';

const dir = mkdtempSync(resolve('node_modules/.integrated-ux-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = resolve(dir, 'ui.mjs');
await build({
  stdin: { contents: "export { default as UserMenu } from './packages/web/src/components/UserMenu'; export { default as Account } from './packages/app-shared/src/screens/Account'; export { configureApi } from './packages/app-shared/src/api';", resolveDir: process.cwd() },
  outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  alias: { '@hauddy/app-shared': resolve('packages/app-shared/src/index.ts') }, define: { 'import.meta.env': '{}' },
});
const { UserMenu, Account, configureApi } = await import(pathToFileURL(outfile));
const routed = (component) => React.createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, component);

async function mount(t, component, options) {
  const previous = globalThis.document;
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  });
  await act(async () => { renderer = create(routed(component), options); });
  return renderer;
}

test('account menu keeps its name during loading, announces expansion and restores focus on Escape', async (t) => {
  let focused = 0;
  const renderer = await mount(t, React.createElement(UserMenu), { createNodeMock: (element) => element.type === 'button'
    ? { focus() { focused++; } } : element.type === 'div' ? { contains() { return false; } } : null });
  const trigger = () => renderer.root.findByProps({ className: 'user-menu-trigger' });
  assert.equal(trigger().props['aria-label'], 'Account menu');
  await act(async () => renderer.update(routed(React.createElement(UserMenu, { email: 'me@example.test' }))));
  assert.equal(trigger().props['aria-label'], 'Account menu, me@example.test');
  await act(async () => trigger().props.onClick());
  assert.equal(trigger().props['aria-expanded'], true);
  const escape = new Event('keydown'); Object.defineProperty(escape, 'key', { value: 'Escape' });
  await act(async () => document.dispatchEvent(escape));
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(focused, 1);
  assert.equal(renderer.root.findAllByProps({ role: 'menu' }).length, 0);
  await act(async () => trigger().props.onClick());
  await act(async () => document.dispatchEvent(new Event('mousedown')));
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(focused, 1, 'outside dismissal does not steal focus');
});

for (const metadataFails of [false, true]) {
  test(`downloads remain usable before the new R2 routes exist (metadata failure: ${metadataFails})`, async (t) => {
    configureApi({ getSession: async () => ({ email: 'me@example.test' }), getAccountKey: async () => ({ masked: 'hidden' }), listConnectors: async () => [] });
    t.mock.method(globalThis, 'fetch', async (url) => {
      assert.equal(new URL(url).pathname, '/api/version');
      if (metadataFails) throw new Error('offline');
      return Response.json({ latest: '0.1.19' });
    });
    const renderer = await mount(t, React.createElement(Account));
    const links = renderer.root.findAllByType('a');
    // Exact filenames from the published v0.1.19 GitHub release.
    for (const [label, asset] of [
      ['Windows (x64)', 'Hauddy.Setup.0.1.19.exe'],
      ['Linux (.deb)', 'hauddy_0.1.19_amd64.deb'],
      ['Linux (AppImage)', 'hauddy_0.1.19_x86_64.AppImage'],
    ]) {
      const href = links.find((link) => link.props.children === label).props.href;
      assert.equal(href, metadataFails ? 'https://github.com/Hauddy/hauddy/releases/latest' : `https://github.com/Hauddy/hauddy/releases/download/v0.1.19/${asset}`);
    }
    assert.ok(renderer.root.findAllByType('strong').some((item) => item.props.children === 'Account → Set up API key'));
    assert.ok(renderer.root.findAllByType('button').some((item) => item.props.children === 'Sign out of this browser'), 'revocation and download changes both survive integration');
  });
}
