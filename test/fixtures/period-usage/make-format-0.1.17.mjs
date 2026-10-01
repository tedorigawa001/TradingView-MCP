// Produces the period-usage ledger golden of the 0.1.17 format, the first with backtest_risk_forecast records
// (docs/RISK_FORECAST_BACKTEST_PLAN.md, step 5). It holds a record from each observing tool, a manual record and a
// manual batch, so later versions must keep reading all of them.
// It imports the current build/, so re-running it on a later version would write that version's format under the
// 0.1.17 name. It therefore refuses to overwrite the golden unless given --force, for use with a 0.1.17 build only.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchPeriodUsageStore } from '../../../build/researchPeriodUsage.js';

const version = (c) => 'sha256:' + c.repeat(64);
const period = (series_id, from, to, data_version = version('a')) => ({ series_id, data_version, from, to });
const directory = await mkdtemp(join(tmpdir(), 'period-usage-golden-'));
try {
  const store = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'));
  await store.record({ access_id: 'fixture17:manual', research_id: 'fixture-research', purpose: 'exploration',
    accessed_at: '2025-01-01T00:00:00.000Z', ...period('fixture-series', '2024-01-01T00:00:00.000Z', '2024-02-01T00:00:00.000Z') });
  await store.recordBatch([0, 1].map((i) => ({ access_id: `fixture17:batch:${i}`, research_id: 'fixture-research', purpose: 'validation',
    accessed_at: '2025-02-01T00:00:00.000Z', ...period(`fixture-series-${i}`, '2024-03-01T00:00:00.000Z', '2024-04-01T00:00:00.000Z') })));
  await store.recordToolAccess({ access_id: 'fixture17:ledger:0', research_id: 'fixture-research', purpose: 'exploration',
    request_sha256: version('c'), ...period(`ledger-source:${'d'.repeat(64)}`, '2024-01-05T00:00:00.000Z', '2024-01-25T00:00:00.001Z', version('e')) });
  await store.recordToolAccessBatch('compare_forecast_losses', [`forecast-set-source:${'f'.repeat(64)}`, 'fixture-series'].map((series_id, i) => ({
    access_id: `fixture17:forecast:${i}`, research_id: 'fixture-research', purpose: 'exploration', request_sha256: version('1'),
    ...period(series_id, '2024-01-10T00:00:00.000Z', '2024-01-20T00:00:00.000Z', version('2')) })));
  await store.recordToolAccessBatch('compute_realized_covariance', [`proxy-set-source:${'3'.repeat(64)}`, 'fixture-series'].map((series_id, i) => ({
    access_id: `fixture17:rc:${i}`, research_id: 'fixture-research', purpose: 'exploration', request_sha256: version('4'),
    ...period(series_id, '2024-01-05T21:30:00.000Z', '2024-01-31T21:45:00.000Z', i === 0 ? version('3') : version('5')) })));
  await store.recordToolAccessBatch('backtest_risk_forecast', [`forecast-set-source:${'7'.repeat(64)}`, 'fixture-series'].map((series_id, i) => ({
    access_id: `fixture17:risk:${i}`, research_id: 'fixture-research', purpose: 'exploration', request_sha256: version('8'),
    ...period(series_id, '2024-01-08T21:30:00.000Z', '2024-01-26T21:45:00.000Z', i === 0 ? version('9') : version('5')) })));
  const body = await readFile(join(directory, 'usage.jsonl'), 'utf8');
  await writeFile(new URL('./format-0.1.17.jsonl', import.meta.url), body, { flag: process.argv.includes('--force') ? 'w' : 'wx' });
  console.log(body.trim().split('\n').map((line) => { const r = JSON.parse(line); return `${r.sequence} ${r.access_id} ${r.source} ${r.tool_name ?? ''}`; }).join('\n'));
} finally {
  await rm(directory, { recursive: true, force: true });
}
