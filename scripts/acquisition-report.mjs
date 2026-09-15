// HAUDDY_ADMIN_TOKEN is read only from the environment, never logged or put in a URL.
import { readFile } from 'node:fs/promises';
const token = process.env.HAUDDY_ADMIN_TOKEN;
if (!token) throw new Error('Set HAUDDY_ADMIN_TOKEN to read the private aggregate report.');
const origin = new URL(process.env.HAUDDY_REPORT_ORIGIN ?? 'https://api.hauddy.com');
if (origin.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(origin.hostname)) throw new Error('Use HTTPS for a remote report.');
const res = await fetch(new URL('/admin/acquisition/report', origin), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
if (!res.ok) throw new Error(`Report request failed (${res.status}).`);
const report = await res.json();
if (process.argv[2]) {
  const baseline = JSON.parse(await readFile(process.argv[2], 'utf8'));
  if (baseline.schema_version !== report.schema_version || !Array.isArray(baseline.counts) || !Number.isFinite(Date.parse(baseline.generated_at)) || Date.parse(baseline.generated_at) > Date.parse(report.generated_at)) throw new Error('Incompatible baseline.');
  const before = new Map(baseline.counts.map(r => [`${r.source}:${r.event}`, r.count]));
  report.interval = { from: baseline.generated_at, to: report.generated_at, counts: report.counts.map(r => ({ ...r, count: r.count - (before.get(`${r.source}:${r.event}`) ?? 0) })), caveat: 'Counter deltas, not unique people or cohorts. Negative counts indicate a reset or source regrouping.' };
}
console.log(JSON.stringify(report, null, 2));
