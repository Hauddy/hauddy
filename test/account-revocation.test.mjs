import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';

const dir = mkdtempSync(resolve('node_modules/.revocation-tests-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = resolve(dir, 'account.mjs');
await build({
  stdin: { contents: "export { default as Account } from './packages/app-shared/src/screens/Account'; export { api, configureApi, useAuthed, getKey } from './packages/app-shared/src/api';", resolveDir: process.cwd() },
  outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
});
const { Account, api, configureApi, useAuthed, getKey } = await import(pathToFileURL(outfile));
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

async function mount(t, response) {
  const previousDocument = globalThis.document, previousStorage = globalThis.localStorage;
  const values = new Map([['hauddy.platformKey', 'fixture-key']]);
  globalThis.document = Object.assign(new EventTarget(), { visibilityState: 'visible' });
  globalThis.localStorage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(new URL(url).pathname, '/accounts/revoke');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.authorization, 'Bearer fixture-key');
    requests.push(url);
    return response();
  });
  configureApi({
    getSession: async () => ({ name: 'tester', email: 'tester@example.test' }),
    getAccountKey: async () => ({ masked: 'sk_live_••••fixture' }),
    listConnectors: async () => [],
  });
  // Exercise the real auth hook as well as the real API facade, so clearing
  // browser credentials would visibly leave Account just as it does in the app.
  function Guard() { return useAuthed() ? React.createElement(Account, { showDownload: false }) : React.createElement('p', { id: 'signed-out' }, 'Sign in'); }
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousStorage === undefined) delete globalThis.localStorage; else globalThis.localStorage = previousStorage;
  });
  await act(async () => { renderer = create(React.createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(Guard))); });
  const button = (label) => renderer.root.findAllByType('button').find((item) => item.props.children === label);
  return {
    root: renderer.root, requests, values, button,
    click: async (label) => act(async () => button(label).props.onClick()),
    signedOut: () => renderer.root.findAllByProps({ id: 'signed-out' }).length === 1,
  };
}

for (const [name, response] of [
  ['offline', () => { throw new TypeError('Failed to fetch'); }],
  ['HTTP 500', () => new Response('unavailable', { status: 500 })],
  ['unconfirmed success body', () => Response.json({ ok: false })],
]) {
  test(`Account keeps the key after ${name}, warns and retries revocation`, async (t) => {
    let fail = true;
    const ui = await mount(t, () => fail ? response() : Response.json({ ok: true }));
    await ui.click('Revoke');
    assert.equal(ui.requests.length, 0);
    await ui.click('Confirm revoke?');
    assert.equal(getKey(), 'fixture-key');
    assert.equal(ui.signedOut(), false);
    const alert = ui.root.findByProps({ role: 'alert' });
    assert.match(alert.findByType('p').props.children, /key may still be active/);
    assert.equal(ui.button('Sign out of this browser').props.disabled, false);
    fail = false;
    await ui.click('Retry revocation');
    assert.equal(ui.requests.length, 2);
    assert.equal(getKey(), null);
    assert.equal(ui.signedOut(), true);
  });
}

test('pending revocation preserves the session, prevents duplicate requests and signs out only after success', async (t) => {
  const request = deferred();
  const ui = await mount(t, () => request.promise);
  await ui.click('Revoke');
  await ui.click('Confirm revoke?');
  assert.equal(ui.button('Revoking…').props.disabled, true);
  assert.equal(ui.button('Rotate').props.disabled, true);
  assert.equal(ui.button('Sign out of this browser').props.disabled, true);
  await ui.click('Revoking…');
  assert.equal(ui.requests.length, 1);
  assert.equal(getKey(), 'fixture-key');
  assert.equal(ui.signedOut(), false);
  await act(async () => request.resolve(Response.json({ ok: true })));
  assert.equal(ui.signedOut(), true);
});

test('local sign-out remains separate and never sends a revocation request', async (t) => {
  const ui = await mount(t, () => { throw new Error('must not revoke'); });
  await ui.click('Sign out of this browser');
  assert.equal(ui.signedOut(), true);
  assert.equal(ui.requests.length, 0);
});

test('a late revocation response cannot clear a newer browser session', async (t) => {
  const request = deferred();
  const ui = await mount(t, () => request.promise);
  const revocation = api.revokeKey();
  ui.values.set('hauddy.platformKey', 'new-session-key');
  request.resolve(Response.json({ ok: true }));
  await revocation;
  assert.equal(getKey(), 'new-session-key');
});
