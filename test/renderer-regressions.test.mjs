import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(resolve('node_modules/.renderer-tests-'));
after(() => rmSync(dir, { recursive: true, force: true }));
async function bundle(name, source) {
  const outfile = resolve(dir, name + '.mjs');
  await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: 'ts' }, outfile,
    bundle: true, platform: 'node', format: 'esm', packages: 'external',
    alias: { '@hauddy/app-shared': resolve('packages/app-shared/src/index.ts') }, define: { 'import.meta.env': '{}' } });
  return import(pathToFileURL(outfile));
}
const { MessageSubmission } = await bundle('send', "export { MessageSubmission } from './packages/app-shared/src/message-send';");
const web = await bundle('web', "export { api } from './packages/app-shared/src/api';");
const desktop = await bundle('desktop', "export { api } from './packages/app-shared/src/api'; export { installLocalApi } from './packages/app/src/api/local-adapter';");

test('failed sends preserve body/files, retry uploads and use a stable id without duplicate submission', async () => {
  const file = new File(['image'], 'photo.png', { type: 'image/png' });
  const op = new MessageSubmission('alice', '@alice', 'do not lose this', [file]);
  let uploadFails = true, sendFails = true, uploads = 0;
  const ids = [];
  const api = { uploadConsoleFile: async () => { uploads++; if (uploadFails) throw new Error('upload failed'); return { file_id: 'f', name: file.name, mime: file.type, size: file.size }; },
    consoleSms: async (_, body, attachments, id) => { ids.push(id); assert.equal(body, op.body); assert.equal(attachments[0].name, file.name); if (sendFails) throw new Error('HTTP 500'); return { status: 'queued' }; } };
  await op.send(api, () => {});
  assert.equal(op.status, 'failed'); assert.equal(ids.length, 0); assert.equal(op.files[0], file);
  uploadFails = false;
  await op.send(api, () => {});
  assert.equal(op.status, 'failed'); assert.equal(op.attachments.length, 1);
  sendFails = false;
  await Promise.all([op.send(api, () => {}), op.send(api, () => {})]);
  assert.equal(op.status, 'sent'); assert.equal(uploads, 2); assert.deepEqual(ids, [op.id, op.id]);
});

test('web upload reconstructs filename and MIME from the browser file', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ file_id: 'f', size: 5 }));
  assert.deepEqual(await web.api.uploadConsoleFile(new File(['image'], 'photo.png', { type: 'image/png' }), '@peer'),
    { file_id: 'f', size: 5, name: 'photo.png', mime: 'image/png' });
});

test('desktop dashboard returns local data while network directory and friendships never respond', async (t) => {
  desktop.installLocalApi();
  t.mock.method(globalThis, 'fetch', async (url) => {
    const path = new URL(url).pathname;
    if (path === '/api/platform/agents' || path === '/api/friends') return new Promise(() => {});
    if (path === '/api/human/threads') return Response.json({ threads: [{ peer_id: 'local-peer' }] });
    if (path === '/api/human/notifications') return Response.json({ unread_messages: 1, missed_calls: 0, friend_requests: 0 });
    if (path === '/api/agents' || path === '/api/contacts') return Response.json([]);
    throw new Error('unexpected URL ' + url);
  });
  const result = await Promise.race([desktop.api.consoleDashboard(), new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('local history blocked on WAN')), 500); timer.unref(); })]);
  assert.equal(result.threads[0].peer_id, 'local-peer');
});

test('desktop previews and settings use daemon routes without a renderer bearer key', async (t) => {
  desktop.installLocalApi();
  const paths = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    const u = new URL(url); assert.equal(u.hostname, '127.0.0.1'); paths.push(u.pathname);
    assert.equal(options?.headers?.authorization, undefined);
    if (u.pathname.includes('/file/')) return new Response('image', { headers: { 'content-type': 'image/png' } });
    if (u.pathname === '/api/account/settings') return Response.json({ email: 'me@example.test', username: 'me', human: { nickname: '@me', description: 'bio' } });
    return Response.json({ ok: true, auto_accept: true });
  });
  const url = await desktop.api.getConsoleFileUrl('local-file');
  assert.ok(url.startsWith('blob:')); URL.revokeObjectURL(url);
  assert.equal((await desktop.api.getSession()).name, 'me');
  assert.equal((await desktop.api.getIdentity()).bio, 'bio');
  assert.equal((await desktop.api.updateProfile({ bio: 'new' })).ok, true);
  assert.equal((await desktop.api.changePassword('old', 'new')).ok, true);
  await desktop.api.setAutoAccept(true); await desktop.api.deleteAccount();
  assert.ok(paths.includes('/api/account/delete'));
});
