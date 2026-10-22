import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parse } from 'smol-toml';

export function checkStagingIsolation(production, staging) {
  assert.ok(staging.name && staging.name !== production.name, 'staging needs a distinct Worker name');
  assert.equal(staging.workers_dev, true);
  assert.ok(!staging.routes?.length && !staging.route, 'staging must not bind custom production routes');
  assert.notEqual(staging.vars?.RATE_LIMIT, 'off', 'public staging rate limits must stay enabled');
  assert.equal(staging.vars?.EMAIL_DELIVERY, 'disabled', 'staging email must be disabled');
  assert.ok(staging.vars?.CORS_ORIGIN && staging.vars.CORS_ORIGIN !== production.vars?.CORS_ORIGIN, 'staging must not use production browser origin');
  const productionBuckets = new Set((production.r2_buckets ?? []).flatMap(b => [b.bucket_name, b.preview_bucket_name]).filter(Boolean));
  for (const name of ['FILES', 'RELEASES']) {
    const b = staging.r2_buckets?.find(b => b.binding === name);
    assert.ok(b?.bucket_name, `missing ${name} staging binding`);
    assert.ok(!b.remote, 'staging local development must not use remote resources');
    for (const key of [b.bucket_name, b.preview_bucket_name].filter(Boolean)) assert.ok(!productionBuckets.has(key), `${name} reuses a production bucket`);
  }
  const productionIds = new Set((production.d1_databases ?? []).flatMap(b => [b.database_id, b.preview_database_id, b.database_name]).filter(Boolean));
  const db = staging.d1_databases?.find(b => b.binding === 'WAITLIST_DB');
  assert.ok(db?.database_id && db.database_name, 'missing staging waitlist database');
  assert.ok(!db.remote, 'local D1 must remain local');
  for (const key of [db.database_id, db.preview_database_id, db.database_name].filter(Boolean)) assert.ok(!productionIds.has(key), 'staging reuses production D1');
  const hub = staging.durable_objects?.bindings?.find(b => b.name === 'HUB');
  assert.ok(hub && (!hub.script_name || hub.script_name === staging.name), 'staging must own its Durable Object namespace');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  checkStagingIsolation(parse(readFileSync('packages/platform/wrangler.toml', 'utf8')),
    parse(readFileSync('packages/platform/wrangler.staging.toml', 'utf8')));
  console.log('PASS staging Worker, R2, D1, email and rate-limit isolation');
}
