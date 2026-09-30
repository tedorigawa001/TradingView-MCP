#!/usr/bin/env node
import { mkdtemp, rm, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { ResearchPeriodUsageStore } from '../build/researchPeriodUsage.js';
import { ForwardPeriodJournal } from '../build/forwardPeriod.js';

// Performance check for forward period declarations (docs/FORWARD_PERIOD_PLAN.md, step 6). Kept out of the unit
// suite so the suite never depends on timing. Run after `npm run build`:
//   node scripts/benchmark-forward-period.mjs
// 10,000 ledger records and 200 declarations, in mkdtemp only. The ledger and the journal are written directly as
// valid lines; the check, the preflight, declare and record are timed through the store. A record's added cost is
// the difference against a ledger with no declarations file, plus one empty lock round trip on the journal, which
// both stores pay.
const RECORDS = 10_000, SERIES = 50, PERIODS = 4;
const NOW = '2026-10-01T00:00:00.000Z';
const iso = (ms) => new Date(ms).toISOString();
const hash = (c) => 'sha256:' + c.repeat(64);
const series = (i) => `bench:S${String(i).padStart(2, '0')}`;

function ledgerLines() {
  const lines = [];
  const base = Date.parse('2026-01-01T00:00:00.000Z');
  for (let i = 0; i < RECORDS; i++) {
    const recorded = iso(base + i * 60_000);
    const from = iso(Date.parse('2020-01-01T00:00:00.000Z') + (i % 2000) * 86_400_000);
    lines.push(JSON.stringify({ access_id: `bench:${i}`, research_id: `research:${i % 40}`, series_id: series(i % SERIES), data_version: hash('a'),
      from, to: iso(Date.parse(from) + 5 * 86_400_000), accessed_at: recorded, purpose: i % 3 ? 'exploration' : 'validation',
      schema_version: '1.0', namespace: 'research_period_usage', sequence: i + 1, recorded_at: recorded, first_seen_at: recorded,
      observation_date: recorded.slice(0, 10), source: 'user_reported' }));
  }
  return lines.join('\n') + '\n';
}
function journalLines() {
  const lines = [];
  const recorded = '2026-09-01T00:00:00.000Z';
  let sequence = 0;
  for (let s = 0; s < SERIES; s++) {
    for (let p = 0; p < PERIODS; p++) {
      sequence++;
      const from = iso(Date.parse('2027-01-01T00:00:00.000Z') + p * 91 * 86_400_000);
      lines.push(JSON.stringify({ schema_version: '1.0', namespace: 'forward_period_declarations', sequence, recorded_at: recorded,
        first_seen_at: recorded, observation_date: recorded.slice(0, 10), ledger_sequence_at_write: RECORDS, kind: 'declaration',
        declaration_id: `bench-${s}-${p}`, research_id: `research:${s % 40}`, series_ids: [series(s)], from, to: iso(Date.parse(from) + 90 * 86_400_000),
        protocol_sha256: hash((p % 10).toString()), hypothesis: null }));
    }
  }
  return lines.join('\n') + '\n';
}

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function time(label, runs, operation) {
  const samples = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    await operation(i);
    samples.push(performance.now() - started);
  }
  return [label, median(samples)];
}

const directory = await mkdtemp(join(tmpdir(), 'forward-period-benchmark-'));
try {
  const ledger = join(directory, 'usage.jsonl'), bare = join(directory, 'bare.jsonl');
  await writeFile(ledger, ledgerLines(), { mode: 0o600 });
  await copyFile(ledger, bare);
  await writeFile(join(directory, 'usage.forward-period-declarations.jsonl'), journalLines(), { mode: 0o600 });
  const clock = { now: NOW };
  const store = new ResearchPeriodUsageStore(ledger, undefined, { now: () => new Date(clock.now) });
  const baseline = new ResearchPeriodUsageStore(bare, undefined, { now: () => new Date(clock.now) });
  const query = { series_id: series(7), data_version: hash('a'), from: '2027-01-01T00:00:00.000Z', to: '2028-01-01T00:00:00.000Z' };
  const check = await store.check(query);
  const rows = [];
  rows.push(await time('check, 4 declarations on the series', 7, () => store.check(query)));
  rows.push(await time('preflight with research_id', 7, () => store.preflightOos({ ...query, research_id: 'research:7' })));
  rows.push(await time('declare a new period', 7, (i) => store.declareForwardPeriod({ declaration_id: `new-${i}`, research_id: 'research:bench',
    series_ids: [`bench:new${i}`], from: '2027-01-01T00:00:00.000Z', to: '2027-04-01T00:00:00.000Z', protocol_sha256: hash('f') })));
  const access = (i, id) => ({ access_id: `${id}:${i}`, research_id: 'research:other', series_id: series(i % SERIES), data_version: hash('b'),
    from: '2027-02-01T00:00:00.000Z', to: '2027-02-02T00:00:00.000Z', accessed_at: NOW, purpose: 'exploration' });
  const withJournal = await time('record, with 200 declarations', 9, (i) => store.record(access(i, 'with')));
  const without = await time('record, no declarations journal', 9, (i) => baseline.record(access(i, 'without')));
  const lock = await time('declarations lock round trip', 9, () => new ForwardPeriodJournal(join(directory, 'empty.jsonl')).withLock(async () => {}));
  rows.push(withJournal, without, lock, ['record: added cost of the declarations', withJournal[1] - without[1] + lock[1]]);
  const probe = (await store.record(access(0, 'probe'))).overlapped_forward_period_declarations;
  if (check.forward_period_declarations.total !== PERIODS || probe.status !== 'available' || probe.total !== 1) {
    throw new Error(`unexpected benchmark state: ${JSON.stringify({ check: check.forward_period_declarations.total, probe })}`);
  }
  console.log(`ledger: ${RECORDS} records; journal: ${SERIES * PERIODS} declarations; the check lists ${PERIODS}; a record overlaps 1`);
  for (const [label, ms] of rows) console.log(`${label}: ${ms.toFixed(1)} ms`);
  const targets = [['check, 4 declarations on the series', 200], ['preflight with research_id', 200], ['declare a new period', 300],
    ['record: added cost of the declarations', 100]];
  const misses = targets.filter(([label, limit]) => rows.find((row) => row[0] === label)[1] >= limit);
  console.log(misses.length ? `MISSED: ${misses.map(([label, limit]) => `${label} >= ${limit} ms`).join('; ')}` : 'all targets met');
} finally {
  await rm(directory, { recursive: true, force: true });
}
