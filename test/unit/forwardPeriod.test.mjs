import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  declareForwardPeriodInputSchema, shortenForwardPeriodInputSchema, validateForwardPeriodLine, validateJournal, ForwardPeriodJournal,
  buildViews, stateOf, isActiveFor, conflictingDeclarations, ledgerRegressed, AccessIndex, accessCounts, relatedDeclarations,
  selectForQuery, describeForQuery, FORWARD_PERIOD_LIMITATIONS,
} from '../../build/forwardPeriod.js';
import { AppendOnlyFirstSeenLog } from '../../build/firstSeenStore.js';
import { posixModeEnforced } from '../../build/fsDurability.js';

// docs/FORWARD_PERIOD_PLAN.md, step 2: the declarations journal and the pure logic, with fixed clocks only.
const HOUR = 3_600_000, DAY = 24 * HOUR;
const iso = (ms) => new Date(ms).toISOString();
const t = (s) => Date.parse(s);
const FROM = '2027-01-01T00:00:00.000Z', TO = '2027-04-01T00:00:00.000Z';
const hash = (c) => 'sha256:' + c.repeat(64);
const header = (sequence, recordedAt, anchor = 0) => ({ schema_version: '1.0', namespace: 'forward_period_declarations', sequence,
  recorded_at: recordedAt, first_seen_at: recordedAt, observation_date: recordedAt.slice(0, 10), ledger_sequence_at_write: anchor });
const declaration = (sequence, patch = {}) => {
  const { recorded_at = '2026-10-01T00:00:00.000Z', anchor = 0, ...rest } = patch;
  return { ...header(sequence, recorded_at, anchor), kind: 'declaration', declaration_id: 'd1', research_id: 'r1',
    series_ids: ['fx:EURUSD'], from: FROM, to: TO, protocol_sha256: hash('a'), hypothesis: null, ...rest };
};
const shortening = (sequence, patch = {}) => {
  const { recorded_at = '2026-11-01T00:00:00.000Z', anchor = 0, ...rest } = patch;
  return { ...header(sequence, recorded_at, anchor), kind: 'shortening', declaration_id: 'd1', research_id: 'r1',
    new_end: '2027-03-01T00:00:00.000Z', reason: 'narrower', ...rest };
};
const access = (patch = {}) => ({ sequence: 1, research_id: 'r1', series_id: 'fx:EURUSD', from: FROM, to: TO,
  recorded_at: '2027-05-01T00:00:00.000Z', purpose: 'validation', source: 'user_reported', ...patch });

test('input schemas check format only: series, prefixes, bounds, identifiers (plan P-Q7)', () => {
  const ok = { declaration_id: 'x'.repeat(100), research_id: 'r1', series_ids: ['ledger-source:ab', 'forecast-set-source:cd', 'fx:EURUSD'],
    from: FROM, to: TO, protocol_sha256: hash('a'), hypothesis: { kind: 'event', id: 'h'.repeat(80) } };
  assert.equal(declareForwardPeriodInputSchema.safeParse(ok).success, true);
  // The lead is not a schema rule: a start in the past parses, and the store refuses it later.
  assert.equal(declareForwardPeriodInputSchema.safeParse({ ...ok, from: '2000-01-01T00:00:00.000Z' }).success, true);
  for (const bad of [
    { declaration_id: 'x'.repeat(101) }, { series_ids: ['a', 'a'] }, { series_ids: ['proxy-set-source:ab'] }, { series_ids: [] },
    { series_ids: Array.from({ length: 21 }, (_, i) => `s${i}`) }, { from: TO, to: FROM }, { from: FROM, to: FROM },
    { to: '2100-01-01T00:00:00.001Z' }, { protocol_sha256: 'sha256:abc' }, { hypothesis: { kind: 'event', id: 'h'.repeat(81) } },
    { hypothesis: { kind: 'other', id: 'h' } }, { extra: 1 }, { from: '2027-01-01T00:00:00Z' },
  ]) assert.equal(declareForwardPeriodInputSchema.safeParse({ ...ok, ...bad }).success, false, JSON.stringify(bad));
  assert.equal(declareForwardPeriodInputSchema.safeParse({ ...ok, to: '2100-01-01T00:00:00.000Z' }).success, true, 'to may equal 2100');
  const shorten = { declaration_id: 'd1', research_id: 'r1', new_end: FROM, reason: 'r' };
  assert.equal(shortenForwardPeriodInputSchema.safeParse(shorten).success, true);
  for (const bad of [{ reason: '' }, { reason: 'x'.repeat(201) }, { extra: 1 }]) {
    assert.equal(shortenForwardPeriodInputSchema.safeParse({ ...shorten, ...bad }).success, false, JSON.stringify(bad));
  }
});

test('line validation: dates, stored order of series, the lead, and inclusive length bounds', () => {
  const recordedAt = iso(t(FROM) - DAY);
  assert.doesNotThrow(() => validateForwardPeriodLine(declaration(1, { recorded_at: recordedAt })), 'a lead of exactly 24 h');
  assert.throws(() => validateForwardPeriodLine(declaration(1, { recorded_at: iso(t(FROM) - DAY + 1) })), /lead too short/);
  assert.doesNotThrow(() => validateForwardPeriodLine(declaration(1, { to: iso(t(FROM) + DAY) })), 'exactly 24 h long');
  assert.throws(() => validateForwardPeriodLine(declaration(1, { to: iso(t(FROM) + DAY - 1) })), /length out of bounds/);
  assert.doesNotThrow(() => validateForwardPeriodLine(declaration(1, { to: iso(t(FROM) + 366 * DAY) })), 'exactly 366 days long');
  assert.throws(() => validateForwardPeriodLine(declaration(1, { to: iso(t(FROM) + 366 * DAY + 1) })), /length out of bounds/);
  assert.throws(() => validateForwardPeriodLine(declaration(1, { series_ids: ['b', 'a'] })), /sorted and unique/);
  assert.throws(() => validateForwardPeriodLine({ ...declaration(1), first_seen_at: FROM }), /dates/);
  assert.doesNotThrow(() => validateForwardPeriodLine(shortening(2, { recorded_at: iso(t('2027-03-01T00:00:00.000Z') - DAY) })));
  assert.throws(() => validateForwardPeriodLine(shortening(2, { recorded_at: iso(t('2027-03-01T00:00:00.000Z') - DAY + 1) })), /lead too short/);
});

test('journal consistency: shortenings follow their declaration, shrink, respect the 24 h minimum, and anchors never fall', () => {
  assert.doesNotThrow(() => validateJournal([declaration(1), shortening(2), shortening(3, { new_end: '2027-02-01T00:00:00.000Z' })]));
  assert.doesNotThrow(() => validateJournal([declaration(1), shortening(2, { new_end: FROM, recorded_at: '2026-11-01T00:00:00.000Z' })]), 'withdrawal');
  const cases = [
    [[declaration(1), declaration(2)], /duplicate/],
    [[shortening(1)], /before its declaration/],
    [[declaration(1), shortening(2, { research_id: 'r2' })], /research_id mismatch/],
    [[declaration(1), shortening(2), shortening(3, { new_end: '2027-03-01T00:00:00.000Z' })], /new_end/],
    [[declaration(1), shortening(2, { new_end: '2027-01-01T12:00:00.000Z' })], /new_end/],
    [[declaration(1), shortening(2, { new_end: '2026-12-31T00:00:00.000Z' })], /new_end/],
    [[declaration(1, { anchor: 5 }), shortening(2, { anchor: 4 })], /anchors moved backwards/],
  ];
  for (const [lines, pattern] of cases) assert.throws(() => validateJournal(lines), pattern);
});

async function journalIn(t) {
  const directory = await mkdtemp(join(tmpdir(), 'forward-period-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'declarations.jsonl');
  return { path, journal: new ForwardPeriodJournal(path) };
}

test('the journal: a missing file is empty, appends are guarded, framing is strict', async (t) => {
  const { path, journal } = await journalIn(t);
  assert.deepEqual(await journal.withLock(() => journal.readUnlocked()), []);
  await journal.withLock(async () => journal.appendUnlocked(await journal.readUnlocked(), declaration(1)));
  const lines = await journal.withLock(() => journal.readUnlocked());
  assert.deepEqual(lines.map((l) => [l.kind, l.declaration_id]), [['declaration', 'd1']]);
  if (posixModeEnforced()) assert.equal((await stat(path)).mode & 0o777, 0o600);
  // The clock guard before append, the next-sequence rule, and whole-journal consistency.
  await assert.rejects(journal.withLock(() => journal.appendUnlocked(lines, shortening(2, { recorded_at: '2026-09-30T00:00:00.000Z' }))),
    (error) => error.code === 'forward_period_clock_moved_backwards');
  await assert.rejects(journal.withLock(() => journal.appendUnlocked(lines, shortening(3))), /next one/);
  // The same instant as the last line is not behind it.
  await journal.withLock(async () => journal.appendUnlocked(lines, shortening(2, { recorded_at: '2026-10-01T00:00:00.000Z' })));
  lines.push((await journal.withLock(() => journal.readUnlocked()))[1]);
  await assert.rejects(journal.withLock(() => journal.appendUnlocked(lines, shortening(3, { research_id: 'r2', new_end: '2027-02-01T00:00:00.000Z' }))),
    /research_id mismatch/);
  assert.equal((await journal.withLock(() => journal.readUnlocked())).length, 2, 'only the valid line was appended');
  // Framing: a missing final newline or a blank line fails closed.
  const body = await readFile(path, 'utf8');
  await writeFile(path, body.slice(0, -1));
  await assert.rejects(journal.withLock(() => journal.readUnlocked()), /framing/);
  await writeFile(path, body + '\n');
  await assert.rejects(journal.withLock(() => journal.readUnlocked()), /framing/);
  // A hand-edited journal whose lines are each valid but inconsistent together fails closed on read.
  await writeFile(path, [declaration(1), shortening(2, { research_id: 'r2' })].map((l) => JSON.stringify(l)).join('\n') + '\n');
  await assert.rejects(journal.withLock(() => journal.readUnlocked()), /research_id mismatch/);
});

test('the journal lock is bounded at 2 s, queue included (design H1)', async (t) => {
  const { path, journal } = await journalIn(t);
  const holder = new AppendOnlyFirstSeenLog(path, 'holder', (x) => x, { maxFileBytes: 1000, maxRecordBytes: 1000 });
  const release = await holder.acquireFileLock();
  const started = performance.now();
  try {
    await assert.rejects(journal.withLock(async () => 'never'), { code: 'HISTORY_LOCK_TIMEOUT' });
    const elapsed = performance.now() - started;
    assert.ok(elapsed >= 1900 && elapsed < 4000, `${elapsed}ms`);
  } finally { await release(); }
});

test('views: effective_to, the shortened_after_start boundary at from − 24 h, and the states', () => {
  const at = (ms) => iso(ms);
  const onTime = buildViews([declaration(1), shortening(2, { recorded_at: at(t(FROM) - DAY), new_end: '2027-03-01T00:00:00.000Z' })]).get('d1');
  assert.deepEqual([onTime.effective_to, onTime.shortened_after_start, onTime.late_shortening], ['2027-03-01T00:00:00.000Z', false, null]);
  const late = buildViews([declaration(1), shortening(2, { recorded_at: at(t(FROM) - DAY + 1) })]).get('d1');
  assert.equal(late.shortened_after_start, true);
  assert.deepEqual(late.late_shortening, { recorded_at: at(t(FROM) - DAY + 1), lead_seconds: 86399 });
  const afterStart = buildViews([declaration(1), shortening(2, { recorded_at: '2027-01-15T00:00:00.000Z' }),
    shortening(3, { recorded_at: '2027-01-20T00:00:00.000Z', new_end: '2027-02-15T00:00:00.000Z' })]).get('d1');
  assert.deepEqual(afterStart.late_shortening, { recorded_at: '2027-01-15T00:00:00.000Z', lead_seconds: -14 * 86400 }, 'the earliest late one');
  const view = buildViews([declaration(1)]).get('d1');
  assert.equal(stateOf(view, at(t(FROM) - 1)), 'pending');
  assert.equal(stateOf(view, FROM), 'running');
  assert.equal(stateOf(view, at(t(TO) - 1)), 'running');
  assert.equal(stateOf(view, TO), 'ended');
  const withdrawn = buildViews([declaration(1), shortening(2, { new_end: FROM })]).get('d1');
  assert.equal(stateOf(withdrawn, '2030-01-01T00:00:00.000Z'), 'withdrawn');
  assert.equal(isActiveFor(withdrawn, FROM, TO), false, 'a withdrawn declaration is never active');
});

test('the as-of view counts only lines whose anchor is below the record sequence (design G4)', () => {
  const lines = [declaration(1, { anchor: 3 }), shortening(2, { anchor: 7 }), declaration(3, { anchor: 9, declaration_id: 'd2', series_ids: ['fx:USDJPY'] })];
  assert.deepEqual([...buildViews(lines, 3).keys()], [], 'anchor 3 is not below sequence 3');
  assert.deepEqual([...buildViews(lines, 4).keys()], ['d1']);
  assert.equal(buildViews(lines, 7).get('d1').effective_to, TO, 'the shortening at anchor 7 is not yet visible at sequence 7');
  assert.equal(buildViews(lines, 8).get('d1').effective_to, '2027-03-01T00:00:00.000Z');
  assert.deepEqual([...buildViews(lines).keys()], ['d1', 'd2']);
});

test('listing by the original period, activity by the effective one, the partition and the order (design G2, I2)', () => {
  const lines = [
    declaration(1, { declaration_id: 'b-active', from: '2027-02-01T00:00:00.000Z', to: '2027-05-01T00:00:00.000Z' }),
    declaration(2, { declaration_id: 'a-tail', from: '2027-01-01T00:00:00.000Z', to: '2027-06-01T00:00:00.000Z', series_ids: ['fx:EURUSD', 'fx:USDJPY'] }),
    shortening(3, { declaration_id: 'a-tail', new_end: '2027-01-15T00:00:00.000Z' }),
    declaration(4, { declaration_id: 'c-withdrawn', from: '2027-03-01T00:00:00.000Z', to: '2027-04-01T00:00:00.000Z' }),
    shortening(5, { declaration_id: 'c-withdrawn', new_end: '2027-03-01T00:00:00.000Z' }),
    declaration(6, { declaration_id: 'd-other-series', series_ids: ['fx:GBPUSD'] }),
  ];
  const { listed, totals } = selectForQuery(buildViews(lines).values(), { series_id: 'fx:EURUSD', from: '2027-02-15T00:00:00.000Z', to: '2027-03-15T00:00:00.000Z' });
  assert.deepEqual(listed.map((v) => v.line.declaration_id), ['b-active', 'a-tail', 'c-withdrawn']);
  assert.deepEqual(totals, { total: 3, active: 1, withdrawn: 1, tail_only: 1 });
  // More than 20: every one is counted, 20 are listed.
  const many = Array.from({ length: 25 }, (_, i) => declaration(i + 1, { declaration_id: `m${String(i).padStart(2, '0')}`,
    from: iso(t(FROM) + i * 2 * DAY), to: iso(t(FROM) + (i * 2 + 1) * DAY) }));
  const report = describeForQuery(many, [], { series_id: 'fx:EURUSD', from: FROM, to: TO }, '2026-12-01T00:00:00.000Z');
  assert.deepEqual([report.status, report.total, report.active, report.listed.length, report.truncated], ['available', 25, 25, 20, true]);
  assert.deepEqual(report.listed.slice(0, 2).map((e) => e.declaration_id), ['m00', 'm01']);
});

test('access counts: relation, phase, purpose, source, distinct analyses, coverage and the ended flag (design F6, G3)', () => {
  const view = buildViews([declaration(1)]).get('d1');
  const accesses = [
    access({ research_id: 'r2', from: '2027-02-01T00:00:00.000Z', to: '2027-02-02T00:00:00.000Z', recorded_at: '2027-02-03T00:00:00.000Z', purpose: 'exploration' }),
    access({ research_id: 'r2', series_id: 'fx:USDJPY' }),   // another series
    access({ from: '2027-02-01T00:00:00.000Z', to: '2027-02-10T00:00:00.000Z', recorded_at: '2026-12-01T00:00:00.000Z', purpose: 'exploration' }),   // before_start
    access({ from: '2026-12-25T00:00:00.000Z', to: '2027-01-10T00:00:00.000Z', recorded_at: '2027-01-11T00:00:00.000Z', purpose: 'exploration',
      source: 'tool_observed', request_sha256: hash('1') }),   // during, extends before from
    access({ from: '2027-01-10T00:00:00.000Z', to: '2027-01-20T00:00:00.000Z', recorded_at: '2027-01-21T00:00:00.000Z', purpose: 'exploration',
      source: 'tool_observed', request_sha256: hash('1') }),   // during, the same analysis again
    access({ from: '2026-12-31T00:00:00.000Z', to: '2027-04-02T00:00:00.000Z', recorded_at: '2027-04-05T00:00:00.000Z', source: 'tool_observed',
      request_sha256: hash('2') }),   // after_end, covers the period, extends outside
    access({ from: '2027-04-01T00:00:00.000Z', to: '2027-05-01T00:00:00.000Z' }),   // touches the end: no overlap
  ];
  const counts = accessCounts(view, 'fx:EURUSD', new AccessIndex(accesses), '2027-05-01T00:00:00.000Z');
  assert.deepEqual(counts, {
    other_research: 1,
    declaring_research: { before_start: 1, during: 2, after_end: 1, exploration: 3, validation: 1, user_reported: 1, tool_observed: 3,
      distinct_tool_requests: 2 },
    declaring_access_covers_declared_period: true,
    declaring_accesses_extending_outside_declared_period: 2,
    ended_without_declaring_research_access: false,
  });
  // Coverage needs an access recorded at or after the end: the same span recorded during the period does not count.
  const early = accessCounts(view, 'fx:EURUSD', new AccessIndex([access({ recorded_at: '2027-03-31T23:59:59.999Z' })]), '2027-05-01T00:00:00.000Z');
  assert.equal(early.declaring_access_covers_declared_period, false);
  // Phase boundaries: recorded exactly at from is during; exactly at the end is after_end.
  const boundary = accessCounts(view, 'fx:EURUSD', new AccessIndex([access({ recorded_at: FROM }), access({ recorded_at: TO })]), TO);
  assert.deepEqual([boundary.declaring_research.before_start, boundary.declaring_research.during, boundary.declaring_research.after_end], [0, 1, 1]);
  const none = accessCounts(view, 'fx:EURUSD', new AccessIndex([access({ research_id: 'r2' })]), TO);
  assert.equal(none.ended_without_declaring_research_access, true);
  assert.equal(accessCounts(view, 'fx:EURUSD', new AccessIndex([]), '2027-03-01T00:00:00.000Z').ended_without_declaring_research_access, false, 'running');
  const withdrawn = buildViews([declaration(1), shortening(2, { new_end: FROM })]).get('d1');
  assert.equal(accessCounts(withdrawn, 'fx:EURUSD', new AccessIndex(accesses), TO).other_research, 0, 'an empty period overlaps nothing');
});

test('related declarations share the research ID or the protocol hash, on any series and at any time (design G6)', () => {
  const lines = [
    declaration(1),
    declaration(2, { declaration_id: 'same-research', protocol_sha256: hash('b'), series_ids: ['fx:USDJPY'], from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z', recorded_at: '2026-10-01T00:00:00.000Z' }),
    declaration(3, { declaration_id: 'same-protocol', research_id: 'r9', series_ids: ['fx:GBPUSD'], from: '2027-05-01T00:00:00.000Z', to: '2027-06-01T00:00:00.000Z' }),
    shortening(4, { declaration_id: 'same-protocol', research_id: 'r9', new_end: '2027-05-15T00:00:00.000Z', recorded_at: '2027-05-02T00:00:00.000Z' }),
    declaration(5, { declaration_id: 'unrelated', research_id: 'r8', protocol_sha256: hash('c') }),
  ];
  const views = buildViews(lines);
  const related = relatedDeclarations(views.get('d1'), views.values(), new AccessIndex([]), '2027-01-15T00:00:00.000Z');
  assert.deepEqual(related, { total: 2, ended_without_declaring_research_access: 1, shortened_after_start: 1 });
  const evaluated = relatedDeclarations(views.get('d1'), views.values(),
    new AccessIndex([access({ series_id: 'fx:USDJPY', from: '2026-11-01T00:00:00.000Z', to: '2026-12-01T00:00:00.000Z' })]), '2027-01-15T00:00:00.000Z');
  assert.equal(evaluated.ended_without_declaring_research_access, 0);
});

test('exclusivity ignores parts no longer declared, and a ledger shorter than an anchor is detected (design H7)', () => {
  const lines = [declaration(1, { series_ids: ['fx:EURUSD', 'fx:USDJPY'], anchor: 4 }), shortening(2, { anchor: 6 })];
  const views = buildViews(lines);
  assert.deepEqual(conflictingDeclarations(views.values(), ['fx:USDJPY', 'fx:GBPUSD'], '2027-02-01T00:00:00.000Z', '2027-02-02T00:00:00.000Z'),
    [{ series_id: 'fx:USDJPY', declaration_id: 'd1' }]);
  assert.deepEqual(conflictingDeclarations(views.values(), ['fx:EURUSD'], '2027-03-01T00:00:00.000Z', '2027-04-01T00:00:00.000Z'), [],
    'the shortened tail may be declared by other studies');
  assert.equal(ledgerRegressed(lines, 6), false);
  assert.equal(ledgerRegressed(lines, 5), true);
});

test('describeForQuery: static and variable fields, the hypothesis flag, and the limitations list', () => {
  const hypothesis = { kind: 'strategy', id: 'h1', definition_hash: hash('d'), journal_sequence: 3, population: 'in_sample' };
  const report = describeForQuery([declaration(1, { hypothesis })], [], { series_id: 'fx:EURUSD', from: FROM, to: TO }, '2026-12-01T00:00:00.000Z');
  const [entry] = report.listed;
  assert.deepEqual(Object.keys(entry), ['declaration_id', 'research_id', 'series_ids', 'from', 'to', 'protocol_sha256', 'hypothesis', 'recorded_at',
    'lead_seconds', 'effective_to', 'shortenings', 'shortened_after_start', 'late_shortening', 'state', 'accesses',
    'declaring_access_covers_declared_period', 'declaring_accesses_extending_outside_declared_period', 'ended_without_declaring_research_access',
    'related_declarations']);
  assert.equal(entry.hypothesis.hypothesis_population_is_not_forward, true);
  assert.equal(entry.lead_seconds, 92 * 86400);
  assert.deepEqual([entry.state, entry.shortenings], ['pending', { total: 0, listed: [] }]);
  const outOfSample = describeForQuery([declaration(1, { hypothesis: { ...hypothesis, population: 'out_of_sample' } })], [],
    { series_id: 'fx:EURUSD', from: FROM, to: TO }, FROM);
  assert.equal(outOfSample.listed[0].hypothesis.hypothesis_population_is_not_forward, false);
  for (const [population, flagged] of [['stress', true], ['walk_forward', false], ['live', false]]) {
    const entry = describeForQuery([declaration(1, { hypothesis: { ...hypothesis, population } })], [], { series_id: 'fx:EURUSD', from: FROM, to: TO }, FROM).listed[0];
    assert.equal(entry.hypothesis.hypothesis_population_is_not_forward, flagged, population);
  }
  assert.equal(FORWARD_PERIOD_LIMITATIONS.length, 10);
  // Listed shortenings: the five most recent, newest first, so the one that sets effective_to is always shown.
  const ends = ['2027-03-25', '2027-03-20', '2027-03-15', '2027-03-10', '2027-03-05', '2027-03-01', '2027-02-25'];
  const lines = [declaration(1), ...ends.map((d, i) => shortening(i + 2, { new_end: `${d}T00:00:00.000Z` }))];
  const shown = describeForQuery(lines, [], { series_id: 'fx:EURUSD', from: FROM, to: TO }, FROM).listed[0];
  assert.equal(shown.shortenings.total, 7);
  assert.deepEqual(shown.shortenings.listed.map((s) => s.new_end.slice(0, 10)), ['2027-02-25', '2027-03-01', '2027-03-05', '2027-03-10', '2027-03-15']);
  assert.equal(shown.effective_to, '2027-02-25T00:00:00.000Z');
});
