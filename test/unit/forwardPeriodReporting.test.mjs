import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ResearchPeriodUsageStore, summarizeAssessment, FORWARD_PERIOD_BACKOFF_MS } from '../../build/researchPeriodUsage.js';
import { FORWARD_PERIOD_LIMITATIONS } from '../../build/forwardPeriod.js';

// docs/FORWARD_PERIOD_PLAN.md, step 4: the check, preflight v2, record-path fields, replay and the fallback.
const run = promisify(execFile);
const FROM = '2027-01-01T00:00:00.000Z', TO = '2027-04-01T00:00:00.000Z';
const hash = (c) => 'sha256:' + c.repeat(64);
const buildUrl = new URL('../../build/researchPeriodUsage.js', import.meta.url).href;

async function setup(t, at = '2026-10-01T00:00:00.000Z') {
  const directory = await mkdtemp(join(tmpdir(), 'forward-report-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clock = { now: at, monotonic: 0 };
  const ledger = join(directory, 'usage.jsonl');
  const make = () => new ResearchPeriodUsageStore(ledger, undefined,
    { now: () => new Date(clock.now), monotonicNow: () => clock.monotonic });
  return { directory, ledger, journal: join(directory, 'usage.forward-period-declarations.jsonl'), clock, store: make(), make };
}
const declare = (patch = {}) => ({ declaration_id: 'd1', research_id: 'r1', series_ids: ['fx:EURUSD'], from: FROM, to: TO,
  protocol_sha256: hash('a'), ...patch });
const query = (patch = {}) => ({ series_id: 'fx:EURUSD', data_version: hash('b'), from: FROM, to: TO, ...patch });
/** An access to a past span, which never overlaps the future periods declared here. */
const PAST = { from: '2026-01-01T00:00:00.000Z', to: '2026-01-10T00:00:00.000Z' };
const manual = (patch = {}) => ({ access_id: 'a1', research_id: 'r2', data_version: hash('b'), series_id: 'fx:EURUSD',
  from: '2027-02-01T00:00:00.000Z', to: '2027-02-10T00:00:00.000Z', accessed_at: '2027-02-11T00:00:00.000Z', purpose: 'exploration', ...patch });

test('the check reports declarations without ever counting them as accesses (design "Storage")', async (t) => {
  const { store } = await setup(t);
  const empty = await store.check(query());
  assert.deepEqual([empty.forward_period_declarations.status, empty.forward_period_declarations.total], ['available', 0]);
  assert.ok(!empty.limitations.includes(FORWARD_PERIOD_LIMITATIONS[0]), 'no declaration limitations without a declaration');
  await store.declareForwardPeriod(declare());
  const r = await store.check(query());
  assert.deepEqual([r.overlapping_records, r.exploration_records, r.validation_records, r.matches.length, r.status], [0, 0, 0, 0, 'no_recorded_overlap']);
  assert.deepEqual([r.forward_period_declarations.total, r.forward_period_declarations.active], [1, 1]);
  for (const l of FORWARD_PERIOD_LIMITATIONS) assert.ok(r.limitations.includes(l), l);
  assert.deepEqual(Object.keys(r).slice(-2), ['forward_period_declarations', 'limitations']);
  const { store: later, clock: laterClock } = await setup(t);
  await later.declareForwardPeriod(declare());
  laterClock.now = '2027-06-01T00:00:00.000Z';
  assert.equal((await later.check(query())).forward_period_declarations.listed[0].state, 'ended', 'the check uses the store clock');
  const brief = summarizeAssessment(r);
  assert.deepEqual(brief.forward_period_declarations, { status: 'available', total: 1, active: 1, withdrawn: 0, tail_only: 0,
    listed_declaration_ids: ['d1'], truncated: false });
});

test('preflight v2: every rule in order, and the three flags stay false', async (t) => {
  const { store, clock } = await setup(t);
  const hypothesis = { kind: 'strategy', id: 'h1' };
  await store.declareForwardPeriod(declare({ hypothesis }), { findHypothesis: async () => ({ definition_hash: hash('d'), sequence: 1, population: 'in_sample' }) });
  await store.declareForwardPeriod(declare({ declaration_id: 'd2', research_id: 'r1', series_ids: ['fx:USDJPY'], from: '2027-01-10T00:00:00.000Z', to: '2027-02-10T00:00:00.000Z' }));
  await store.declareForwardPeriod(declare({ declaration_id: 'other', research_id: 'r2', series_ids: ['fx:GBPUSD'] }));
  const pre = (patch) => store.preflightOos(query(patch));
  const expect = async (patch, status, reason) => {
    const r = await pre(patch);
    assert.deepEqual([r.status, r.reason, r.execution_allowed, r.candidateEligible, r.unused_proven, r.contract],
      [status, reason, false, false, false, 'recorded_usage_oos_preflight_v2'], JSON.stringify(patch));
    return r;
  };
  clock.now = '2027-05-01T00:00:00.000Z';   // after every period
  const r2 = await expect({}, 'blocked', 'evaluation_period_has_a_forward_period_declaration');
  assert.deepEqual(r2.required_actions, ['pass_the_declaring_research_id_if_this_is_its_declared_evaluation', 'otherwise_do_not_label_this_period_unused_oos']);
  for (const l of FORWARD_PERIOD_LIMITATIONS) assert.ok(r2.limitations.includes(l), l);
  await expect({ series_id: 'fx:GBPUSD', research_id: 'r1' }, 'blocked', 'evaluation_period_declared_for_another_research');
  await expect({ research_id: 'r1', to: '2027-03-01T00:00:00.000Z' }, 'blocked', 'evaluation_period_differs_from_declared_forward_period');   // a subset
  await expect({ research_id: 'r1', from: '2026-12-01T00:00:00.000Z' }, 'blocked', 'evaluation_period_differs_from_declared_forward_period');   // a superset
  const r4d = await expect({ research_id: 'r1' }, 'review_required', 'declared_intent_without_recorded_usage_is_not_unused_evidence');
  assert.deepEqual(r4d.required_actions, ['confirm_the_evaluation_matches_protocol_sha256', 'record_the_evaluation_under_this_research_id',
    'review_untracked_external_and_related_series_access', 'review_related_declarations', 'report_the_result_whatever_it_is',
    'report_under_the_registered_hypothesis_population_not_as_forward']);
  assert.equal(r4d.usage.forward_period_declarations.listed[0].hypothesis.hypothesis_population_is_not_forward, true);
  const d2 = { series_id: 'fx:USDJPY', research_id: 'r1', from: '2027-01-10T00:00:00.000Z', to: '2027-02-10T00:00:00.000Z' };
  assert.deepEqual((await expect(d2, 'review_required', 'declared_intent_without_recorded_usage_is_not_unused_evidence')).required_actions.length, 5,
    'no population action for a declaration without an in-sample hypothesis');
  clock.now = TO;   // exactly the end: ended, so rule 4b no longer applies
  assert.equal((await pre({ research_id: 'r1' })).reason, 'declared_intent_without_recorded_usage_is_not_unused_evidence');
  clock.now = '2027-01-20T00:00:00.000Z';   // during the periods
  await expect({ research_id: 'r1' }, 'blocked', 'declared_forward_period_not_yet_ended');
  const r5 = await expect({ series_id: 'fx:CADJPY', research_id: 'r1' }, 'review_required', 'absence_of_usage_records_is_not_unused_evidence');
  assert.equal(r5.no_active_forward_period_declaration_for_research_id, true);
  assert.equal('no_active_forward_period_declaration_for_research_id' in await pre({ series_id: 'fx:CADJPY' }), false);
  assert.ok(!r5.limitations.includes(FORWARD_PERIOD_LIMITATIONS[0]), 'declaration limitations only when one is listed');
  // Rule 1 wins over everything: an access inside the declared period.
  await store.record(manual({ series_id: 'fx:EURUSD', accessed_at: '2027-01-20T00:00:00.000Z', from: '2027-01-02T00:00:00.000Z', to: '2027-01-03T00:00:00.000Z' }));
  await expect({ research_id: 'r1' }, 'blocked', 'evaluation_period_has_recorded_usage');
});

test('preflight: a late shortening blocks 4d (4c); withdrawn and released parts never change the status', async (t) => {
  const { store, clock } = await setup(t);
  await store.declareForwardPeriod(declare());
  await store.declareForwardPeriod(declare({ declaration_id: 'w', series_ids: ['fx:USDJPY'] }));
  await store.shortenForwardPeriod({ declaration_id: 'w', research_id: 'r1', new_end: FROM, reason: 'withdrawn' });
  await store.declareForwardPeriod(declare({ declaration_id: 'tail', series_ids: ['fx:GBPUSD'] }));
  await store.shortenForwardPeriod({ declaration_id: 'tail', research_id: 'r1', new_end: '2027-02-01T00:00:00.000Z', reason: 'narrower' });
  clock.now = '2027-01-15T00:00:00.000Z';
  await store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-03-01T00:00:00.000Z', reason: 'after a look' });
  clock.now = '2027-05-01T00:00:00.000Z';
  const late = await store.preflightOos(query({ research_id: 'r1', to: '2027-03-01T00:00:00.000Z' }));
  assert.deepEqual([late.status, late.reason, late.required_actions], ['blocked', 'declared_forward_period_shortened_after_start',
    ['report_as_exploratory_the_declaration_was_shortened_after_start']]);
  const withdrawn = await store.preflightOos(query({ series_id: 'fx:USDJPY' }));
  assert.deepEqual([withdrawn.status, withdrawn.reason], ['review_required', 'absence_of_usage_records_is_not_unused_evidence']);
  assert.deepEqual([withdrawn.usage.forward_period_declarations.total, withdrawn.usage.forward_period_declarations.withdrawn], [1, 1], 'still listed');
  const tail = await store.preflightOos(query({ series_id: 'fx:GBPUSD', from: '2027-02-01T00:00:00.000Z' }));
  assert.deepEqual([tail.status, tail.usage.forward_period_declarations.tail_only], ['review_required', 1]);
  // The shortened declaration's exact period by the early shortening (before from − 24 h) still reaches 4d.
  const early = await store.preflightOos(query({ series_id: 'fx:GBPUSD', research_id: 'r1', to: '2027-02-01T00:00:00.000Z' }));
  assert.equal(early.reason, 'declared_intent_without_recorded_usage_is_not_unused_evidence');
});

test('preflight: two adjacent declarations of one study are not one (4a), and rules use every declaration beyond the 20 listed', async (t) => {
  const { store, clock } = await setup(t);
  await store.declareForwardPeriod(declare({ to: '2027-02-01T00:00:00.000Z' }));
  await store.declareForwardPeriod(declare({ declaration_id: 'd2', from: '2027-02-01T00:00:00.000Z', to: '2027-03-01T00:00:00.000Z' }));
  clock.now = '2027-05-01T00:00:00.000Z';
  assert.equal((await store.preflightOos(query({ research_id: 'r1', to: '2027-03-01T00:00:00.000Z' }))).reason,
    'evaluation_period_differs_from_declared_forward_period');
  const { store: many, clock: manyClock } = await setup(t);
  for (let i = 0; i < 21; i++) {
    const from = new Date(Date.UTC(2027, 0, 1) + i * 2 * 86_400_000).toISOString();
    const to = new Date(Date.UTC(2027, 0, 2) + i * 2 * 86_400_000).toISOString();
    await many.declareForwardPeriod(declare({ declaration_id: `own-${String(i).padStart(2, '0')}`, from, to }));
  }
  await many.declareForwardPeriod(declare({ declaration_id: 'zz-other', research_id: 'r9', from: '2027-03-01T00:00:00.000Z', to: '2027-03-02T00:00:00.000Z' }));
  manyClock.now = '2027-05-01T00:00:00.000Z';
  const r = await many.preflightOos(query({ research_id: 'r1', to: '2027-03-05T00:00:00.000Z' }));
  assert.deepEqual([r.usage.forward_period_declarations.total, r.usage.forward_period_declarations.listed.length, r.usage.forward_period_declarations.truncated], [22, 20, true]);
  assert.ok(!r.usage.forward_period_declarations.listed.some((e) => e.declaration_id === 'zz-other'), 'the other study is not listed');
  assert.equal(r.reason, 'evaluation_period_declared_for_another_research', 'but its declaration still decides');
});

test('record responses carry overlapped declarations and as-of counts that include the record (design G4)', async (t) => {
  const { store, clock } = await setup(t);
  await store.declareForwardPeriod(declare());
  clock.now = '2027-02-15T00:00:00.000Z';
  const other = await store.record(manual());
  assert.deepEqual(other.overlapped_forward_period_declarations, { status: 'available', total: 1,
    by_relation: { other_research: 1, declaring_research_exploration: 0, declaring_research_validation: 0 }, truncated: false,
    listed: [{ declaration_id: 'd1', research_id: 'r1', relation: 'other_research' }] });
  const entry = other.prior_overlap.forward_period_declarations.listed[0];
  assert.deepEqual([entry.state, entry.accesses.other_research], ['running', 1], 'as of the record, and including it');
  assert.equal(other.prior_overlap.overlapping_records, 0, 'prior_overlap keeps its own prior-only meaning');
  const own = await store.recordToolAccessBatch('compare_forecast_losses', [{ access_id: 't1', research_id: 'r1', series_id: 'fx:EURUSD',
    data_version: hash('c'), from: '2027-01-05T00:00:00.000Z', to: '2027-01-06T00:00:00.000Z', purpose: 'exploration', request_sha256: hash('e') }]);
  assert.deepEqual(own[0].overlapped_forward_period_declarations.by_relation, { other_research: 0, declaring_research_exploration: 1, declaring_research_validation: 0 });
  const validation = await store.record(manual({ access_id: 'v1', research_id: 'r1', purpose: 'validation', from: FROM, to: TO,
    accessed_at: '2027-02-15T00:00:00.000Z' }));
  assert.equal(validation.overlapped_forward_period_declarations.listed[0].relation, 'declaring_research_validation');
  // Outside the declared period or on another series: nothing overlaps.
  const outside = await store.record(manual({ access_id: 'o1', from: '2027-05-01T00:00:00.000Z', to: '2027-05-02T00:00:00.000Z' }));
  assert.equal(outside.overlapped_forward_period_declarations.total, 0);
});

test('identical retries replay as of the original record, after later declarations, shortenings and state changes', async (t) => {
  const { store, clock } = await setup(t);
  await store.declareForwardPeriod(declare());
  clock.now = '2026-10-10T00:00:00.000Z';
  const first = await store.record(manual({ accessed_at: '2026-10-10T00:00:00.000Z' }));
  await store.declareForwardPeriod(declare({ declaration_id: 'later', research_id: 'r1', from: '2027-04-01T00:00:00.000Z', to: '2027-05-01T00:00:00.000Z' }));
  // A later shortening that ends the period before the record's span: the retry must not see it.
  await store.shortenForwardPeriod({ declaration_id: 'd1', research_id: 'r1', new_end: '2027-01-15T00:00:00.000Z', reason: 'narrower' });
  assert.equal((await store.record(manual({ access_id: 'a2', accessed_at: '2026-10-10T00:00:00.000Z' }))).overlapped_forward_period_declarations.total, 0);
  clock.now = '2027-06-01T00:00:00.000Z';
  const retry = await store.record(manual({ accessed_at: '2026-10-10T00:00:00.000Z' }));
  assert.deepEqual({ ...retry, idempotent: false }, first);
  assert.equal(retry.overlapped_forward_period_declarations.total, 1);
  assert.equal(retry.prior_overlap.forward_period_declarations.listed[0].effective_to, TO, 'the later shortening is not visible');
  assert.equal(retry.prior_overlap.forward_period_declarations.listed[0].state, 'pending');
});

test('an unreadable journal never fails a record; the check and preflight fail closed', async (t) => {
  const { store, journal, ledger } = await setup(t);
  // A missing journal holds no declarations.
  assert.equal((await store.record(manual({ accessed_at: '2026-09-01T00:00:00.000Z', ...PAST }))).overlapped_forward_period_declarations.status, 'available');
  await store.declareForwardPeriod(declare());
  await appendFile(journal, '{"torn":');
  const r = await store.record(manual({ access_id: 'a2', accessed_at: '2026-09-01T00:00:00.000Z', ...PAST }));
  assert.deepEqual(r.overlapped_forward_period_declarations, { status: 'unavailable', reason: 'journal_unreadable' });
  assert.deepEqual(r.prior_overlap.forward_period_declarations, { status: 'unavailable', reason: 'journal_unreadable' });
  assert.ok(r.prior_overlap.limitations.includes('forward_period_declarations_unavailable'));
  assert.equal((await readFile(ledger, 'utf8')).trim().split('\n').length, 2, 'the access is still appended');
  await assert.rejects(store.check(query()), (e) => e.code === 'forward_period_journal_unavailable');
  await assert.rejects(store.preflightOos(query()), (e) => e.code === 'forward_period_journal_unavailable');
  const brief = summarizeAssessment(r.prior_overlap);
  assert.deepEqual(brief.forward_period_declarations, { status: 'unavailable', reason: 'journal_unreadable' });
});

test('a regressed ledger and a backward journal clock make records unavailable, never refused', async (t) => {
  const { store, ledger, clock } = await setup(t);
  await store.record(manual({ accessed_at: '2026-09-01T00:00:00.000Z', ...PAST }));
  clock.now = '2026-10-05T00:00:00.000Z';
  await store.declareForwardPeriod(declare());
  clock.now = '2026-10-03T00:00:00.000Z';   // after the ledger's last record, before the journal's last line
  const behind = await store.record(manual({ access_id: 'b1', accessed_at: '2026-09-01T00:00:00.000Z', ...PAST }));
  assert.deepEqual(behind.overlapped_forward_period_declarations, { status: 'unavailable', reason: 'clock_moved_backwards' });
  clock.now = '2026-10-06T00:00:00.000Z';
  await rm(ledger);
  await assert.rejects(store.check(query()), (e) => e.code === 'forward_period_ledger_regressed');
  // The record is appended to the replaced ledger, and reports the regression it saw before appending.
  const regressed = await store.record(manual({ access_id: 'c1', accessed_at: '2026-09-01T00:00:00.000Z', ...PAST }));
  assert.deepEqual(regressed.overlapped_forward_period_declarations, { status: 'unavailable', reason: 'ledger_regressed' });
  assert.equal((await readFile(ledger, 'utf8')).trim().split('\n').length, 1);
});

test('the back-off: a lock timeout on any path skips record reads for 30 s on that journal, for every store (plan R1)', async (t) => {
  const { store, journal, clock, make } = await setup(t);
  await store.declareForwardPeriod(declare());
  await writeFile(journal + '.lock', '00000000-0000-0000-0000-000000000000 1\n', { mode: 0o600 });   // a stale lock
  const started = performance.now();
  await assert.rejects(store.check(query()), (e) => e.code === 'forward_period_journal_unavailable');   // a check starts it
  assert.ok(performance.now() - started >= 1900);
  const quick = performance.now();
  const skipped = await make().record(manual({ accessed_at: '2026-09-01T00:00:00.000Z' }));   // another store on the same ledger
  assert.ok(performance.now() - quick < 1000, 'no 2 s wait during the back-off');
  assert.deepEqual(skipped.overlapped_forward_period_declarations, { status: 'unavailable', reason: 'lock_timeout_backoff', retry_after_ms: FORWARD_PERIOD_BACKOFF_MS });
  clock.monotonic = FORWARD_PERIOD_BACKOFF_MS - 1;
  assert.equal((await store.record(manual({ access_id: 'a2', accessed_at: '2026-09-01T00:00:00.000Z' }))).overlapped_forward_period_declarations.retry_after_ms, 1);
  clock.monotonic = FORWARD_PERIOD_BACKOFF_MS;   // expired: the record path tries again, and times out itself
  const retried = await store.record(manual({ access_id: 'a3', accessed_at: '2026-09-01T00:00:00.000Z' }));
  assert.deepEqual(retried.overlapped_forward_period_declarations, { status: 'unavailable', reason: 'lock_timeout' });
  // That timeout on a record path starts a new back-off too.
  assert.deepEqual((await store.record(manual({ access_id: 'a3b', accessed_at: '2026-09-01T00:00:00.000Z' }))).overlapped_forward_period_declarations,
    { status: 'unavailable', reason: 'lock_timeout_backoff', retry_after_ms: FORWARD_PERIOD_BACKOFF_MS });
  await rm(journal + '.lock');
  clock.monotonic = 2 * FORWARD_PERIOD_BACKOFF_MS + 1;
  assert.equal((await store.record(manual({ access_id: 'a4', accessed_at: '2026-09-01T00:00:00.000Z' }))).overlapped_forward_period_declarations.status, 'available');
  // An unreadable journal does not start the back-off.
  const { store: other, journal: otherJournal } = await setup(t);
  await other.declareForwardPeriod(declare());
  await appendFile(otherJournal, '{"torn":');
  await other.record(manual({ accessed_at: '2026-09-01T00:00:00.000Z' }));
  const again = await other.record(manual({ access_id: 'a2', accessed_at: '2026-09-01T00:00:00.000Z' }));
  assert.equal(again.overlapped_forward_period_declarations.reason, 'journal_unreadable');
});

test('design H1 across processes: a stale declarations lock and a check holding the ledger lock never stop a record in another process', async (t) => {
  const { directory, ledger, journal, store } = await setup(t);
  await store.declareForwardPeriod(declare());
  await writeFile(journal + '.lock', '00000000-0000-0000-0000-000000000000 1\n', { mode: 0o600 });
  const script = join(directory, 'record.mjs');
  await writeFile(script, `import { ResearchPeriodUsageStore } from ${JSON.stringify(buildUrl)};
const store = new ResearchPeriodUsageStore(process.argv[2]);
const r = await store.record({ access_id: 'child', research_id: 'r2', data_version: ${JSON.stringify(hash('b'))}, series_id: 'fx:EURUSD',
  from: '2026-01-01T00:00:00.000Z', to: '2026-01-02T00:00:00.000Z', accessed_at: '2026-01-03T00:00:00.000Z', purpose: 'exploration' });
console.log(JSON.stringify(r.overlapped_forward_period_declarations));`);
  const check = store.check(query()).catch((e) => e.code);   // holds the ledger lock while it waits on the declarations lock
  const child = run(process.execPath, [script, ledger], { timeout: 25_000 });
  const [checked, { stdout }] = await Promise.all([check, child]);
  assert.equal(checked, 'forward_period_journal_unavailable');
  assert.deepEqual(JSON.parse(stdout), { status: 'unavailable', reason: 'lock_timeout' });
  assert.ok((await readFile(ledger, 'utf8')).includes('"access_id":"child"'), 'the other process appended its record');
});
