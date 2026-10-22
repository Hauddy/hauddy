import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from 'smol-toml';
import { checkStagingIsolation } from '../scripts/check-staging-isolation.mjs';
const prod = parse(readFileSync('packages/platform/wrangler.toml', 'utf8'));
const staging = parse(readFileSync('packages/platform/wrangler.staging.toml', 'utf8'));
test('checked-in staging configuration owns separate resources and disables delivery', () => checkStagingIsolation(prod, staging));
for (const [label, mutate] of [
  ['attachments', s => { s.r2_buckets[0].bucket_name = prod.r2_buckets[0].bucket_name; }],
  ['downloads', s => { s.r2_buckets[1].bucket_name = prod.r2_buckets[1].bucket_name; }],
  ['preview bucket', s => { s.r2_buckets[0].preview_bucket_name = prod.r2_buckets[0].bucket_name; }],
  ['D1', s => { s.d1_databases[0].database_id = prod.d1_databases[0].database_id; }],
  ['namespace', s => { s.durable_objects.bindings[0].script_name = prod.name; }],
  ['remote dev', s => { s.r2_buckets[0].remote = true; }],
  ['limits', s => { s.vars.RATE_LIMIT = 'off'; }],
  ['mail', s => { delete s.vars.EMAIL_DELIVERY; }],
  ['routes', s => { s.routes = prod.routes; }],
]) test(`staging guard rejects unsafe ${label} configuration`, () => {
  const candidate = structuredClone(staging); mutate(candidate);
  assert.throws(() => checkStagingIsolation(prod, candidate));
});
