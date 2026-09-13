import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';

const dir = mkdtempSync(resolve('node_modules/.draft-tests-'));
after(() => rmSync(dir, { recursive: true, force: true }));
const outfile = resolve(dir, 'messages.mjs');
await build({
  stdin: { contents: "export { default as Messages } from './packages/app-shared/src/screens/Messages'; export { configureApi } from './packages/app-shared/src/api';", resolveDir: process.cwd() },
  outfile, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  define: { 'import.meta.env': '{}' },
});
const { Messages, configureApi } = await import(pathToFileURL(outfile));

async function mount(t, overrides = {}) {
  const previousDocument = globalThis.document;
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.document = { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
  globalThis.requestAnimationFrame = (callback) => { callback(); return 0; };
  const peers = [{ id: 'a', nickname: '@alpha' }, { id: 'b', nickname: '@beta' }];
  const sends = [], uploads = [];
  configureApi({
    consoleDashboard: async () => ({
      agents: peers, platform_agents: peers,
      friends: { linked: [], incoming: [], outgoing: [], auto_accept: false },
      threads: peers.map((p) => ({ peer_id: p.id, peer_nick: p.nickname, last_body: '', last_ts: 0, unread: 0 })),
    }),
    consoleThread: async (peer) => ({ peer_id: peer === '@alpha' ? 'a' : peer === '@beta' ? 'b' : peer, messages: [], items: [] }),
    consoleInbox: async () => ({ messages: [] }),
    consolePoll: async () => ({ frames: [] }),
    uploadConsoleFile: async (file, to) => { uploads.push({ file, to }); return { file_id: file.name, name: file.name, size: file.size, mime: file.type }; },
    consoleSms: async (to, body, attachments) => { sends.push({ to, body, attachments }); return { status: 'queued' }; },
    ...overrides,
  });
  let renderer;
  t.after(async () => {
    if (renderer) await act(async () => renderer.unmount());
    if (previousDocument === undefined) delete globalThis.document; else globalThis.document = previousDocument;
    if (previousFrame === undefined) delete globalThis.requestAnimationFrame; else globalThis.requestAnimationFrame = previousFrame;
  });
  await act(async () => {
    renderer = create(React.createElement(MemoryRouter, { future: { v7_startTransition: true, v7_relativeSplatPath: true } }, React.createElement(Messages)));
  });
  const root = renderer.root;
  const body = () => root.findByProps({ 'aria-label': 'Message body' });
  const openRow = async (index) => act(async () => root.findAllByType('button').filter((b) => b.props.className?.startsWith('thread-row'))[index].props.onClick());
  const openNew = async (handle) => {
    await act(async () => root.findAllByType('button').find((b) => b.props.children === '+ New').props.onClick());
    await act(async () => root.findByProps({ role: 'combobox' }).props.onChange({ target: { value: handle } }));
    await act(async () => root.findAllByProps({ role: 'option' })[0].props.onClick());
  };
  const edit = async (text, files = []) => act(async () => {
    body().props.onChange({ target: { value: text } });
    if (files.length) root.findByProps({ type: 'file' }).props.onChange({ target: { files, value: 'chosen' } });
  });
  const fileNames = () => root.findAllByType('button').map((b) => b.props['aria-label']).filter((s) => s?.startsWith('Remove '));
  const inbox = async (id) => act(async () => root.findByProps({ 'aria-label': 'Whose inbox to view' }).props.onChange({ target: { value: id } }));
  const send = async () => act(async () => root.findByType('form').props.onSubmit({ preventDefault() {} }));
  return { root, body, openRow, openNew, edit, fileNames, inbox, send, sends, uploads };
}

test('Messages isolates text and attachments across A → B → A, New/history routes and inbox identities', async (t) => {
  const ui = await mount(t);
  const alphaFile = new File(['alpha secret'], 'alpha.txt');
  const betaFile = new File(['beta secret'], 'beta.txt');
  await ui.openNew('@alpha');
  await ui.edit('Only for alpha', [alphaFile]);
  await ui.openRow(1);
  assert.equal(ui.body().props.value, '');
  assert.deepEqual(ui.fileNames(), []);
  assert.equal(ui.root.findByProps({ type: 'submit' }).props.disabled, true);
  await ui.edit('Only for beta', [betaFile]);
  await ui.openRow(0);
  assert.equal(ui.body().props.value, 'Only for alpha');
  assert.deepEqual(ui.fileNames(), ['Remove alpha.txt']);
  await ui.inbox('b');
  await ui.openRow(0);
  assert.equal(ui.root.findAllByProps({ 'aria-label': 'Message body' }).length, 0);
  assert.deepEqual(ui.fileNames(), []);
  await ui.inbox('');
  await ui.openNew('@alpha');
  assert.equal(ui.body().props.value, 'Only for alpha');
  assert.deepEqual(ui.fileNames(), ['Remove alpha.txt']);
  await ui.send();
  assert.equal(ui.body().props.value, '');
  assert.deepEqual(ui.fileNames(), []);
  assert.equal(ui.sends[0].body, 'Only for alpha');
  assert.equal(ui.sends[0].to, 'a');
  assert.deepEqual(ui.uploads, [{ file: alphaFile, to: 'a' }]);
  await ui.openNew('@beta');
  assert.equal(ui.body().props.value, 'Only for beta');
  assert.deepEqual(ui.fileNames(), ['Remove beta.txt']);
  await act(async () => ui.root.findByProps({ 'aria-label': 'Remove beta.txt' }).props.onClick());
  await ui.openRow(0);
  assert.equal(ui.body().props.value, '');
  await ui.openRow(1);
  assert.deepEqual(ui.fileNames(), []);
  assert.equal(ui.body().props.value, 'Only for beta');
});

test('resolving history preserves edits made before the handle has a canonical peer id', async (t) => {
  let resolveHistory;
  const ui = await mount(t, { consoleThread: (peer) => peer === '@alpha'
    ? new Promise((resolve) => { resolveHistory = resolve; })
    : Promise.resolve({ peer_id: peer, messages: [], items: [] }) });
  await ui.openNew('@alpha');
  const file = new File(['pending'], 'pending.txt');
  await ui.edit('Typed during lookup', [file]);
  await act(async () => resolveHistory({ peer_id: 'a', messages: [], items: [] }));
  assert.equal(ui.body().props.value, 'Typed during lookup');
  assert.deepEqual(ui.fileNames(), ['Remove pending.txt']);
  await ui.openRow(1);
  await ui.openRow(0);
  assert.equal(ui.body().props.value, 'Typed during lookup');
  assert.deepEqual(ui.fileNames(), ['Remove pending.txt']);
});

test('a late history response cannot attach the previous recipient draft to the current recipient', async (t) => {
  let resolveHistory;
  const ui = await mount(t, { consoleThread: (peer) => peer === '@alpha'
    ? new Promise((resolve) => { resolveHistory = resolve; })
    : Promise.resolve({ peer_id: peer, messages: [], items: [] }) });
  await ui.openNew('@alpha');
  await ui.edit('Unresolved alpha', [new File(['private'], 'alpha.txt')]);
  await ui.openRow(1);
  await ui.edit('Beta draft');
  await act(async () => resolveHistory({ peer_id: 'a', messages: [], items: [] }));
  assert.equal(ui.body().props.value, 'Beta draft');
  assert.deepEqual(ui.fileNames(), []);
  await ui.openRow(0);
  assert.equal(ui.body().props.value, 'Unresolved alpha');
  assert.deepEqual(ui.fileNames(), ['Remove alpha.txt']);
});

test('finishing a send after switching conversations leaves the new conversation draft intact', async (t) => {
  let finishSend;
  const ui = await mount(t, { consoleSms: (to, body) => {
    assert.equal(to, 'a');
    assert.equal(body, 'Sending to alpha');
    return new Promise((resolve) => { finishSend = resolve; });
  } });
  await ui.openNew('@alpha');
  await ui.edit('Sending to alpha');
  await ui.send();
  await ui.openRow(1);
  await ui.edit('Still editing beta', [new File(['beta'], 'beta.txt')]);
  await act(async () => finishSend({ status: 'queued' }));
  assert.equal(ui.body().props.value, 'Still editing beta');
  assert.deepEqual(ui.fileNames(), ['Remove beta.txt']);
  await ui.openRow(0);
  assert.equal(ui.body().props.value, '');
  assert.deepEqual(ui.fileNames(), []);
});
