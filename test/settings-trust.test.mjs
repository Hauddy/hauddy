import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';

const dir = mkdtempSync(resolve('node_modules/.settings-tests-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = resolve(dir, 'settings.mjs');
await build({
  stdin: { contents: "export { default as Settings } from './packages/app-shared/src/screens/Settings'; export { configureApi } from './packages/app-shared/src/api';", resolveDir: process.cwd() },
  outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
});
const { Settings, configureApi } = await import(pathToFileURL(outfile));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function mount(t, initial, overrides = {}) {
  const previousDocument = globalThis.document, previousWindow = globalThis.window;
  const documentEvents = new EventTarget(), windowEvents = new EventTarget();
  globalThis.document = Object.assign(documentEvents, { visibilityState: 'visible' });
  globalThis.window = windowEvents;
  let saved = initial;
  const writes = [];
  configureApi({
    getSession: async () => ({ name: 'tester', email: 'tester@example.test' }),
    getIdentity: async () => ({ handle: '@tester', bio: '' }),
    listFriends: async () => ({ auto_accept: saved, linked: [], incoming: [], outgoing: [] }),
    setAutoAccept: async (value) => { writes.push(value); saved = value; return { auto_accept: saved }; },
    ...overrides,
  });
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  });
  await act(async () => { renderer = create(React.createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(Settings))); });
  const checkbox = () => renderer.root.findByProps({ type: 'checkbox' });
  return {
    root: renderer.root, writes, checkbox,
    toggle: async (value) => act(async () => checkbox().props.onChange({ target: { checked: value } })),
    retry: async () => act(async () => renderer.root.findByProps({ 'aria-label': 'Retry Auto-accept could not be saved' }).props.onClick()),
    reconnect: async () => act(async () => windowEvents.dispatchEvent(new Event('online'))),
    refresh: async () => act(async () => documentEvents.dispatchEvent(new Event('visibilitychange'))),
    setServerValue: (value) => { saved = value; },
  };
}

for (const initial of [true, false]) {
  test(`auto-accept failure restores ${initial} and retries the intended change`, async (t) => {
    let saved = initial, fail = true;
    const writes = [], request = deferred();
    const ui = await mount(t, initial, {
      listFriends: async () => ({ auto_accept: saved }),
      setAutoAccept: async (value) => { writes.push(value); if (fail) return request.promise; saved = value; return { auto_accept: saved }; },
    });
    assert.equal(ui.checkbox().props.checked, initial);
    await ui.toggle(!initial);
    assert.equal(ui.checkbox().props.checked, !initial);
    assert.equal(ui.checkbox().props.disabled, true);
    assert.equal(ui.root.findByProps({ role: 'status' }).props.children, 'Saving auto-accept…');
    await ui.toggle(initial); // an already-queued event cannot start another write
    assert.deepEqual(writes, [!initial]);
    await act(async () => request.reject(new TypeError('Failed to fetch')));
    assert.equal(ui.checkbox().props.checked, initial);
    assert.equal(ui.checkbox().props.disabled, false);
    assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 1);
    fail = false;
    await ui.retry();
    assert.equal(ui.checkbox().props.checked, !initial);
    assert.deepEqual(writes, [!initial, !initial]);
    assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0);
  });
}

test('auto-accept reconciles external changes after reconnect, including the original value', async (t) => {
  const ui = await mount(t, false);
  await ui.toggle(true);
  assert.equal(ui.checkbox().props.checked, true);
  ui.setServerValue(false);
  await ui.reconnect();
  assert.equal(ui.checkbox().props.checked, false);
});

test('a polling response started before a save cannot overwrite its confirmed result', async (t) => {
  const staleRead = deferred(), nextRead = deferred();
  let reads = 0;
  const ui = await mount(t, false, {
    listFriends: async () => { reads++; return reads === 1 ? { auto_accept: false } : reads === 2 ? staleRead.promise : nextRead.promise; },
    setAutoAccept: async () => ({ auto_accept: true }),
  });
  await ui.refresh();
  await ui.toggle(true);
  await act(async () => staleRead.resolve({ auto_accept: false }));
  assert.equal(ui.checkbox().props.checked, true);
  await act(async () => nextRead.resolve({ auto_accept: true }));
  assert.equal(ui.checkbox().props.checked, true);
});

test('a lost save response is reconciled when the server actually saved the preference', async (t) => {
  let saved = true;
  const ui = await mount(t, true, {
    listFriends: async () => ({ auto_accept: saved }),
    setAutoAccept: async (value) => { saved = value; throw new Error('response lost'); },
  });
  await ui.toggle(false);
  assert.equal(ui.checkbox().props.checked, false);
  assert.equal(ui.root.findAllByProps({ role: 'alert' }).length, 0);
});

test('profile failure never exposes empty editable defaults; retry loads the profile', async t => {
  let fail = true;
  const ui = await mount(t, false, {getIdentity: async()=>{if(fail)throw Error('profile unavailable');return {handle:'@tester',bio:'Kept bio'};}});
  assert.equal(ui.root.findAllByProps({autoComplete:'username'}).length,0);
  assert.equal(ui.root.findAllByProps({'aria-label':'Retry Could not load your profile'}).length,1);
  fail=false;
  await act(async()=>ui.root.findByProps({'aria-label':'Retry Could not load your profile'}).props.onClick());
  assert.equal(ui.root.findByProps({autoComplete:'username'}).props.value,'tester');
  assert.equal(ui.root.findAllByType('textarea')[0].props.value,'Kept bio');
});
test('failed profile refresh retains loaded fields and an in-progress draft', async t=>{
 let fail=false;
 const ui=await mount(t,false,{getIdentity:async()=>{if(fail)throw Error('offline');return {handle:'@tester',bio:'Original'};}});
 await act(async()=>ui.root.findAllByType('textarea')[0].props.onChange({target:{value:'Unsaved draft'}}));
 fail=true;await ui.refresh();
 assert.equal(ui.root.findAllByType('textarea')[0].props.value,'Unsaved draft');
 assert.equal(ui.root.findAllByProps({'aria-label':'Retry Could not refresh your profile'}).length,1);
});
