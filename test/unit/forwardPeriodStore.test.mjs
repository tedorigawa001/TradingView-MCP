import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, mkdir, symlink, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResearchPeriodUsageStore } from '../../build/researchPeriodUsage.js';
import { StrategyResearchJournalStore } from '../../build/strategyResearchJournal.js';
import { AppendOnlyFirstSeenLog } from '../../build/firstSeenStore.js';
import { FORWARD_PERIOD_LIMITATIONS } from '../../build/forwardPeriod.js';

// docs/FORWARD_PERIOD_PLAN.md, step 3: declaring, shortening and the hypothesis lookup in the store.
const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const FROM = '2027-01-01T00:00:00.000Z', TO = '2027-04-01T00:00:00.000Z';
const hash = (c) => 'sha256:' + c.repeat(64);
const code = (c) => (error) => error.code === c;

async function setup(t, { at = '2026-10-01T00:00:00.000Z' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'forward-store-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { now: at };
  const ledger = join(directory, 'usage.jsonl');
  const store = new ResearchPeriodUsageStore(ledger, undefined, { now: () => new Date(clock.now) });
  return { directory, ledger, journal: join(directory, 'usage.forward-period-declarations.jsonl'), clock, store };
}
const declare = (patch = {}) => ({ declaration_id: 'd1', research_id: 'r1', series_ids: ['fx:EURUSD'], from: FROM, to: TO,
  protocol_sha256: hash('a'), ...patch });
const lines = async (path) => (await readFile(path, 'utf8')).trim().split('\n').map(JSON.parse);
const access = (patch = {}) => ({ access_id: 'a1', research_id: 'r9', series_id: 'fx:EURUSD', data_version: hash('b'),
  from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z', accessed_at: '2026-03-01T00:00:00.000Z', purpose: 'exploration', ...patch });

test('the journal path: a sibling named after an explicit ledger, and the same-path refusal (plan P1, P-Q3, P-Q11)', async (t) => {
  const { directory, ledger, journal, store } = await setup(t);
  await store.declareForwardPeriod(declare());
  assert.deepEqual((await lines(journal)).map((line) => [line.ledger_sequence_at_write, line.ledger_anchor]), [[0, null]], 'written on an empty ledger');
  // Two ledgers in one directory never share a journal.
  const other = new ResearchPeriodUsageStore(join(directory, 'other.jsonl'));
  assert.deepEqual((await other.check({ series_id: 'x', data_version: hash('a'), from: FROM, to: TO })).overlapping_records, 0);
  const noSuffix = new ResearchPeriodUsageStore(join(directory, 'ledger-without-suffix'), undefined, { now: () => new Date('2026-10-01T00:00:00.000Z') });
  await noSuffix.declareForwardPeriod(declare());
  assert.equal((await lines(join(directory, 'ledger-without-suffix.forward-period-declarations.jsonl'))).length, 1);
  assert.throws(() => new ResearchPeriodUsageStore(ledger, undefined, { forwardPeriodPath: ledger }), /must not share a path/);
  const research = join(directory, 'research.jsonl');
  assert.throws(() => new ResearchPeriodUsageStore(ledger, undefined, { forwardPeriodPath: research, researchJournalPath: research }), /must not share a path/);
  // Through a symlinked directory: the same file under another spelling is still refused.
  await mkdir(join(directory, 'real'));
  await symlink(join(directory, 'real'), join(directory, 'alias'));
  assert.throws(() => new ResearchPeriodUsageStore(join(directory, 'real', 'u.jsonl'), undefined,
    { forwardPeriodPath: join(directory, 'alias', 'u.jsonl') }), /must not share a path/);
  assert.doesNotThrow(() => new ResearchPeriodUsageStore(join(directory, 'real', 'u.jsonl'), undefined,
    { forwardPeriodPath: join(directory, 'alias', 'd.jsonl'), researchJournalPath: join(directory, 'real', 'r.jsonl') }));
  // Names differing only in case are one file on the default macOS and Windows file systems (C2), whether the file
  // exists yet or not.
  if (process.platform === 'darwin' || process.platform === 'win32') {
    assert.throws(() => new ResearchPeriodUsageStore(join(directory, 'case.jsonl'), undefined, { forwardPeriodPath: join(directory, 'CASE.jsonl') }),
      /must not share a path/);
    await writeFile(join(directory, 'exists.jsonl'), '', { mode: 0o600 });
    assert.throws(() => new ResearchPeriodUsageStore(join(directory, 'exists.jsonl'), undefined, { forwardPeriodPath: join(directory, 'Exists.JSONL') }),
      /must not share a path/);
    assert.throws(() => new ResearchPeriodUsageStore(join(directory, 'u2.jsonl'), undefined,
      { forwardPeriodPath: join(directory, 'D2.jsonl'), researchJournalPath: join(directory, 'd2.jsonl') }), /must not share a path/);
  }
});

test('declaring writes one line anchored on the ledger count, and answers with intent-only wording', async (t) => {
  const { journal, store } = await setup(t);
  await store.record(access());
  await store.record(access({ access_id: 'a2' }));
  const response = await store.declareForwardPeriod(declare({ series_ids: ['fx:USDJPY', 'fx:EURUSD'] }));
  assert.deepEqual(Object.keys(response), ['idempotent', 'declaration', 'related_declarations', 'limitations']);
  assert.equal(response.idempotent, false);
  assert.deepEqual(response.declaration.series_ids, ['fx:EURUSD', 'fx:USDJPY'], 'stored sorted');
  assert.deepEqual([response.declaration.state, response.declaration.lead_seconds, response.declaration.effective_to], ['pending', 92 * 86400, TO]);
  assert.deepEqual(response.limitations, [...FORWARD_PERIOD_LIMITATIONS]);
  const [line] = await lines(journal);
  assert.deepEqual([line.kind, line.sequence, line.ledger_sequence_at_write, line.recorded_at], ['declaration', 1, 2, '2026-10-01T00:00:00.000Z']);
  assert.deepEqual(line.ledger_anchor, { access_id: 'a2', recorded_at: '2026-10-01T00:00:00.000Z' }, 'the ledger record at the anchor (rev 3.5)');
  assert.ok(!JSON.stringify(response).match(/reserved"|approved|unused_proven": true/), 'no reservation or approval wording');
});

test('errors in order: an ID conflict before the hypothesis, the hypothesis before the lead (design G11)', async (t) => {
  const { store, clock } = await setup(t);
  await store.declareForwardPeriod(declare());
  const lookups = [];
  const findHypothesis = async (kind, id) => { lookups.push(`${kind}:${id}`); return null; };
  await assert.rejects(store.declareForwardPeriod(declare({ to: '2027-05-01T00:00:00.000Z', hypothesis: { kind: 'strategy', id: 'h1' } }), { findHypothesis }),
    code('forward_period_declaration_id_conflict'));
  assert.deepEqual(lookups, [], 'the research journal is not read for an existing ID');
  clock.now = '2026-12-31T12:00:00.000Z';   // the lead would now be too short
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'], hypothesis: { kind: 'event', id: 'h9' } }),
    { findHypothesis }), code('forward_period_hypothesis_not_registered'));
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'] })), code('forward_period_lead_too_short'));
});

test('the lead and length boundaries, with the injected clock', async (t) => {
  const { store, clock } = await setup(t);
  clock.now = iso(Date.parse(FROM) - DAY + 1);
  await assert.rejects(store.declareForwardPeriod(declare()), code('forward_period_lead_too_short'));
  clock.now = iso(Date.parse(FROM) - DAY);
  assert.equal((await store.declareForwardPeriod(declare())).declaration.lead_seconds, 86400, 'exactly 24 h');
  const start = '2027-06-01T00:00:00.000Z', s = Date.parse(start);
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'short', from: start, to: iso(s + DAY - 1) })), code('forward_period_too_short'));
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'long', from: start, to: iso(s + 366 * DAY + 1) })), code('forward_period_too_long'));
  await store.declareForwardPeriod(declare({ declaration_id: 'one-day', from: start, to: iso(s + DAY) }));
  await store.declareForwardPeriod(declare({ declaration_id: 'max', series_ids: ['fx:USDJPY'], from: start, to: iso(s + 366 * DAY) }));
});

test('exclusivity: any research, any listed series; parts no longer declared are free to declare; recorded usage refuses', async (t) => {
  const { store } = await setup(t);
  await store.declareForwardPeriod(declare({ series_ids: ['fx:EURUSD', 'fx:USDJPY'] }));
  for (const [patch, pattern] of [
    [{ declaration_id: 'd2', research_id: 'r2', series_ids: ['fx:GBPUSD', 'fx:USDJPY'], from: '2027-03-01T00:00:00.000Z', to: '2027-05-01T00:00:00.000Z' }, /fx:USDJPY by d1/],
    [{ declaration_id: 'd3', from: '2027-03-31T00:00:00.000Z', to: '2027-05-01T00:00:00.000Z' }, /fx:EURUSD by d1/],   // the same research
  ]) await assert.rejects(store.declareForwardPeriod(declare(patch)), (error) => error.code === 'forward_period_already_declared' && pattern.test(error.message));
  await store.declareForwardPeriod(declare({ declaration_id: 'touching', research_id: 'r2', from: TO, to: '2027-05-01T00:00:00.000Z' }));
  await store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower' });
  await store.declareForwardPeriod(declare({ declaration_id: 'tail', research_id: 'r3', from: '2027-03-01T00:00:00.000Z', to: TO }));
  // A recorded access already overlapping the period refuses the declaration (an odd manual report of a future span).
  await store.record(access({ access_id: 'future-span', series_id: 'fx:CADJPY', from: '2027-06-10T00:00:00.000Z', to: '2027-06-20T00:00:00.000Z' }));
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'used', series_ids: ['fx:CADJPY'], from: '2027-06-01T00:00:00.000Z', to: '2027-07-01T00:00:00.000Z' })),
    code('forward_period_has_recorded_usage'));
  // Accesses that only touch the period (ending at from, starting at to) do not overlap it.
  await store.record(access({ access_id: 'before', series_id: 'fx:AUDJPY', from: '2027-05-20T00:00:00.000Z', to: '2027-06-01T00:00:00.000Z' }));
  await store.record(access({ access_id: 'after', series_id: 'fx:AUDJPY', from: '2027-07-01T00:00:00.000Z', to: '2027-07-05T00:00:00.000Z' }));
  await store.declareForwardPeriod(declare({ declaration_id: 'touching-usage', series_ids: ['fx:AUDJPY'], from: '2027-06-01T00:00:00.000Z', to: '2027-07-01T00:00:00.000Z' }));
  // Only accesses on the declared series count: another series with the same span may be declared.
  await store.declareForwardPeriod(declare({ declaration_id: 'other-series', series_ids: ['fx:NZDJPY'], from: '2027-06-01T00:00:00.000Z', to: '2027-07-01T00:00:00.000Z' }));
});

test('the exclusivity error names at most 5 conflicts', async (t) => {
  const { store } = await setup(t);
  const series = Array.from({ length: 7 }, (_, i) => `fx:S${i}`);
  await store.declareForwardPeriod(declare({ series_ids: series }));
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: series })),
    (error) => error.message.match(/ by d1/g).length === 5 && error.message.endsWith(', ...'));
});

test('retries: identical after the lead passed and after a shortening, series order ignored; other content conflicts', async (t) => {
  const { store, clock, journal } = await setup(t);
  await store.declareForwardPeriod(declare({ series_ids: ['fx:EURUSD', 'fx:USDJPY'] }));
  clock.now = '2027-01-15T00:00:00.000Z';   // well past the lead, in the running period
  const retry = await store.declareForwardPeriod(declare({ series_ids: ['fx:USDJPY', 'fx:EURUSD'] }));
  assert.deepEqual([retry.idempotent, retry.declaration.state], [true, 'running']);
  await store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower' });
  const after = await store.declareForwardPeriod(declare({ series_ids: ['fx:EURUSD', 'fx:USDJPY'] }));
  assert.deepEqual([after.idempotent, after.declaration.effective_to, after.declaration.shortened_after_start], [true, '2027-03-01T00:00:00.000Z', true]);
  for (const patch of [{ series_ids: ['fx:EURUSD'] }, { series_ids: ['fx:EURUSD', 'fx:USDJPY', 'fx:GBPUSD'] }, { protocol_sha256: hash('c') },
    { hypothesis: { kind: 'strategy', id: 'h1' } }, { research_id: 'r2' }]) {
    await assert.rejects(store.declareForwardPeriod(declare({ series_ids: ['fx:EURUSD', 'fx:USDJPY'], ...patch })), code('forward_period_declaration_id_conflict'), JSON.stringify(patch));
  }
  assert.equal((await lines(journal)).length, 2, 'retries and conflicts write nothing');
  // A hypothesis is compared by kind and ID: the same ID under the other kind is other content.
  const findHypothesis = async () => ({ definition_hash: hash('e'), sequence: 1, population: 'out_of_sample' });
  const withHypothesis = (kind) => declare({ declaration_id: 'dh', series_ids: ['fx:GBPUSD'], from: '2027-06-01T00:00:00.000Z',
    to: '2027-07-01T00:00:00.000Z', hypothesis: { kind, id: 'h1' } });
  await store.declareForwardPeriod(withHypothesis('strategy'), { findHypothesis });
  assert.equal((await store.declareForwardPeriod(withHypothesis('strategy'), { findHypothesis })).idempotent, true);
  await assert.rejects(store.declareForwardPeriod(withHypothesis('event'), { findHypothesis }), code('forward_period_declaration_id_conflict'));
});

test('shortening: errors in order, a withdrawal, the 24 h minimum after from, and idempotent retries after the boundary', async (t) => {
  const { store, clock, journal } = await setup(t);
  await store.declareForwardPeriod(declare());
  const shorten = (patch = {}) => store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower', ...patch });
  await assert.rejects(shorten({ declaration_id: 'missing' }), code('forward_period_declaration_not_found'));
  await assert.rejects(shorten({ research_id: 'r2' }), code('forward_period_research_id_mismatch'));
  for (const newEnd of [TO, '2027-05-01T00:00:00.000Z', '2027-01-01T12:00:00.000Z', '2026-12-31T00:00:00.000Z']) {
    await assert.rejects(shorten({ new_end: newEnd }), code('forward_period_shortening_invalid'), newEnd);
  }
  clock.now = iso(Date.parse('2027-03-01T00:00:00.000Z') - DAY + 1);
  await assert.rejects(shorten(), code('forward_period_lead_too_short'));
  clock.now = iso(Date.parse('2027-03-01T00:00:00.000Z') - DAY);
  const first = await shorten();
  assert.deepEqual([first.idempotent, first.shortening.new_end, first.declaration.effective_to, first.declaration.shortened_after_start],
    [false, '2027-03-01T00:00:00.000Z', '2027-03-01T00:00:00.000Z', true]);
  assert.equal(first.declaration.shortenings, 1, 'the response counts the shortenings');
  clock.now = '2027-03-10T00:00:00.000Z';   // past new_end: an identical retry still succeeds
  assert.equal((await shorten()).idempotent, true);
  await assert.rejects(shorten({ reason: 'other' }), code('forward_period_shortening_conflict'));
  // A withdrawal is possible only while from is at least 24 h away.
  const { store: early } = await setup(t, { at: '2026-10-01T00:00:00.000Z' });
  await early.declareForwardPeriod(declare());
  const withdrawn = await early.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: FROM, reason: 'abandoned' });
  assert.deepEqual([withdrawn.declaration.state, withdrawn.declaration.shortened_after_start], ['withdrawn', false]);
  assert.equal((await lines(journal)).length, 2);
});

test('hypotheses: both kinds from the research journal, with definition hash, sequence and population', async (t) => {
  const { directory, store } = await setup(t);
  const research = new StrategyResearchJournalStore(join(directory, 'research.jsonl'));
  const contract = { population: 'out_of_sample', primaryMetric: 'profitFactor', minimumTrades: 30, symbols: ['OANDA:EURUSD'], timeframes: ['60'],
    minimumProfitFactor: null, maximumDrawdownPercent: null };
  await research.registerHypothesis({ hypothesisId: 'h-strategy', title: 't', thesis: 'x', parentExperimentId: null, evaluationContract: contract });
  await research.registerHypothesis({ hypothesisId: 'h-in-sample', title: 't', thesis: 'x', parentExperimentId: null,
    evaluationContract: { ...contract, population: 'in_sample' } });
  const findHypothesis = (kind, id) => research.findHypothesis(kind, id);
  const strategy = await store.declareForwardPeriod(declare({ hypothesis: { kind: 'strategy', id: 'h-strategy' } }), { findHypothesis });
  assert.deepEqual({ ...strategy.declaration.hypothesis, definition_hash: 'x' }, { kind: 'strategy', id: 'h-strategy', definition_hash: 'x',
    journal_sequence: 1, population: 'out_of_sample', hypothesis_population_is_not_forward: false });
  assert.match(strategy.declaration.hypothesis.definition_hash, /^sha256:[a-f0-9]{64}$/);
  const flagged = await store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:USDJPY'], hypothesis: { kind: 'strategy', id: 'h-in-sample' } }),
    { findHypothesis });
  assert.equal(flagged.declaration.hypothesis.hypothesis_population_is_not_forward, true);
  assert.equal(flagged.declaration.hypothesis.journal_sequence, 2);
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd3', series_ids: ['fx:GBPUSD'], hypothesis: { kind: 'event', id: 'h-strategy' } }),
    { findHypothesis }), code('forward_period_hypothesis_not_registered'), 'the kinds are separate ID spaces');
  assert.equal(await research.findHypothesis('event', 'h-strategy'), null);
});

test('the journal fails closed: unavailable, a regressed ledger, a backward clock', async (t) => {
  const { ledger, journal, store, clock } = await setup(t);
  await store.record(access());   // the ledger's last record: 2026-10-01
  clock.now = '2026-10-05T00:00:00.000Z';
  await store.declareForwardPeriod(declare());   // the journal's last line: 2026-10-05
  // H7: the ledger replaced by a shorter one.
  const saved = await readFile(ledger, 'utf8');
  await rm(ledger);   // a missing ledger holds no records, fewer than the line's anchor of 1
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'] })), code('forward_period_ledger_regressed'));
  // Rev 3.5 (C1): records keep being appended to the replacement, and regrowing past the anchor never clears it.
  for (const id of ['n1', 'n2']) {
    assert.deepEqual((await store.record(access({ access_id: id, series_id: 'fx:NZDUSD' }))).overlapped_forward_period_declarations,
      { status: 'unavailable', reason: 'ledger_regressed' });
  }
  await assert.rejects(store.check({ series_id: 'fx:EURUSD', data_version: hash('b'), from: FROM, to: TO }), code('forward_period_ledger_regressed'));
  await assert.rejects(store.preflightOos({ series_id: 'fx:EURUSD', data_version: hash('b'), from: FROM, to: TO, research_id: 'r1' }),
    code('forward_period_ledger_regressed'));
  // Restoring the ledger that holds the anchored record clears it.
  await writeFile(ledger, saved, { mode: 0o600 });
  assert.equal((await store.check({ series_id: 'fx:EURUSD', data_version: hash('b'), from: FROM, to: TO })).forward_period_declarations.total, 1);
  // R3: a clock after the ledger's last record but before the journal's last line; the ledger's own check runs first.
  const shorten = () => store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'r' });
  clock.now = '2026-10-03T00:00:00.000Z';
  await assert.rejects(shorten(), code('forward_period_clock_moved_backwards'));
  // Paths that write nothing fail the same way: an identical retry, and a declaration whose lead would be judged
  // against the backward clock (design R3).
  await assert.rejects(store.declareForwardPeriod(declare()), code('forward_period_clock_moved_backwards'));
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd9', series_ids: ['fx:GBPUSD'],
    from: '2026-10-03T12:00:00.000Z', to: '2026-10-10T00:00:00.000Z' })), code('forward_period_clock_moved_backwards'));
  clock.now = '2026-09-30T00:00:00.000Z';
  await assert.rejects(shorten(), /research period usage clock moved backwards/);
  clock.now = '2026-10-06T00:00:00.000Z';
  // A torn journal and a held journal lock are unavailable, whichever step reads it.
  await appendFile(journal, '{"torn":');
  const preflight = () => store.preflightOos({ series_id: 'fx:EURUSD', data_version: hash('b'), from: FROM, to: TO, research_id: 'r1' });
  await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'] })), code('forward_period_journal_unavailable'));
  await assert.rejects(shorten(), code('forward_period_journal_unavailable'));
  await assert.rejects(preflight(), code('forward_period_journal_unavailable'));
  await writeFile(journal, (await readFile(journal, 'utf8')).replace(/\{"torn":$/, ''));
  const holder = new AppendOnlyFirstSeenLog(journal, 'holder', (x) => x, { maxFileBytes: 100000, maxRecordBytes: 10000 });
  const release = await holder.acquireFileLock();
  try {
    await assert.rejects(store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'] })), code('forward_period_journal_unavailable'));
    await assert.rejects(shorten(), code('forward_period_journal_unavailable'));
    await assert.rejects(preflight(), code('forward_period_journal_unavailable'));
  } finally { await release(); }
  assert.equal((await store.declareForwardPeriod(declare({ declaration_id: 'd2', series_ids: ['fx:GBPUSD'] }))).idempotent, false);
});

test('concurrent declares, shortenings, records and checks complete without deadlock (lock order ledger → declarations)', async (t) => {
  const { store } = await setup(t);
  const jobs = [];
  for (let i = 0; i < 6; i++) {
    jobs.push(store.declareForwardPeriod(declare({ declaration_id: `d${i}`, series_ids: [`fx:S${i}`] })));
    jobs.push(store.record(access({ access_id: `a${i}`, series_id: `fx:T${i}` })));
    jobs.push(store.check({ series_id: `fx:S${i}`, data_version: hash('b'), from: FROM, to: TO }));
  }
  const results = await Promise.all(jobs);
  assert.equal(results.length, 18);
  // Two identical declarations at once: the second passes step 1 before the first appends, so only the lookup
  // repeated under both locks makes it an idempotent retry instead of an exclusivity error.
  const twins = await Promise.all([0, 1].map(() => store.declareForwardPeriod(declare({ declaration_id: 'twin', series_ids: ['fx:TWIN'] }))));
  assert.deepEqual(twins.map((r) => r.idempotent), [false, true]);
  await Promise.all([0, 1, 2].map((i) => store.shortenForwardPeriod({ declaration_id: `d${i}`, research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'r' })));
});
