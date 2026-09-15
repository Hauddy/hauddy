// Run after a clean npm ci + npm run build. No global packages or user state.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const cli = fileURLToPath(new URL('../packages/sidecar/dist/cli.js', import.meta.url));
const { version } = JSON.parse(readFileSync(new URL('../packages/sidecar/package.json', import.meta.url), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'hauddy-source-smoke-'));
// Override homedir only inside the tested child. Never read the developer's account.
const preload = join(scratch, 'isolated-home.mjs');
writeFileSync(preload, `import os from 'node:os';\nimport { syncBuiltinESMExports } from 'node:module';\nos.homedir = () => ${JSON.stringify(scratch)};\nsyncBuiltinESMExports();\n`);
const args = ['--import', pathToFileURL(preload).href, cli];
const env = { ...process.env, HAUDDY_HUB_PORT: '0', HAUDDY_LOCAL_PORT: '0', HAUDDY_NO_ONBOARD: '1' };
const run = (...command) => execFileSync(process.execPath, [...args, ...command], {
  cwd: scratch, env, encoding: 'utf8', timeout: 15000, stdio: 'pipe',
});
let daemon;
let client;
let daemonOutput = '';
try {
  for (const flag of ['--help', '-h', 'help']) assert.match(run(flag), /Usage: hauddy/);
  for (const flag of ['--version', '-v']) assert.equal(run(flag).trim(), version);
  assert.equal(existsSync(join(scratch, '.hauddy')), false, 'Help/version must not initialize state');
  console.log(`PASS CLI help and version (${version}) from a clean working directory`);
  assert.throws(() => run('unknown-command'), error => error.status === 1);

  daemon = spawn(process.execPath, [...args, 'daemon'], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
  daemon.stdout.on('data', chunk => { daemonOutput += chunk; });
  daemon.stderr.on('data', chunk => { daemonOutput += chunk; });
  let spawnError;
  daemon.on('error', error => { spawnError = error; });
  let apiUrl;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (spawnError) throw spawnError;
    assert.equal(daemon.exitCode, null, `Daemon exited: ${daemonOutput}`);
    try {
      apiUrl = JSON.parse(readFileSync(join(scratch, '.hauddy', 'daemon.json'), 'utf8')).local_api_url;
    } catch { /* startup has not written discovery yet */ }
    if (apiUrl) break;
    await delay(100);
  }
  assert.ok(apiUrl, `Daemon did not publish its API: ${daemonOutput}`);
  assert.equal(new URL(apiUrl).hostname, '127.0.0.1');
  console.log('PASS daemon startup with disposable state and ephemeral ports');

  client = new Client({ name: 'source-install-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', apiUrl)), { timeout: 10000 });
  const { tools } = await client.listTools({}, { timeout: 10000 });
  assert.ok(tools.some(tool => tool.name === 'whoami'));
  assert.ok(tools.some(tool => tool.name === 'send_sms'));
  console.log('PASS HTTP MCP initialization and tool discovery');

  const wrapped = run('wrap', process.execPath, '-e', 'console.log("hauddy-pty-ok")');
  assert.match(wrapped, /hauddy-pty-ok/);
  console.log('PASS native PTY wrapper startup');
} finally {
  try {
    await client?.close();
  } finally {
    if (daemon && daemon.exitCode === null && daemon.pid) {
      const closed = once(daemon, 'close');
      daemon.kill();
      const force = setTimeout(() => daemon.kill('SIGKILL'), 3000);
      try { await closed; } finally { clearTimeout(force); }
    }
    rmSync(scratch, { recursive: true, force: true });
  }
}
