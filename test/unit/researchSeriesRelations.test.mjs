import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hash = c => 'sha256:' + c.repeat(64);
const ts = day => `2024-01-${String(day).padStart(2, '0')}T00:00:00.000Z`;
const NOW = '2025-06-01T00:00:00.000Z';
const identity = { provider: 'synthetic', feed: 'test-feed', instrument: 'EURUSD', price_basis: 'mid',
  unit: 'USD', timestamp_semantics: 'bar_open_utc', formation_sha256: hash('f') };
const definition = (id, patch = {}) => ({ entry_id: id, kind: 'series', series_id: id, data_version: hash('a'),
  role: 'root', root_id: 'raw', identity, from: ts(1), to: ts(30), evidence_sha256: hash('e'), ...patch });
async function setup(t) {
  const { ResearchSeriesRelationStore } = await import('../../build/researchSeriesRelations.js');
  const directory = await mkdtemp(join(tmpdir(), 'series-relations-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'relations.jsonl');
  return { directory, path, store: new ResearchSeriesRelationStore(path, { now: () => new Date(NOW) }) };
}

test('106-5 relation registration is append-only, strict, idempotent and rejects incompatible aliases before writing', async t => {
  const { store, path } = await setup(t);
  const alias = { entry_id: 'alias', kind: 'alias', left: 'a', right: 'b', from: ts(2), to: ts(20), evidence_sha256: hash('e') };
  const input = [definition('a'), definition('b', { root_id: 'other' }), alias];
  const first = await store.recordBatch(input);
  assert.equal(first.recorded, 3);
  const bytes = await readFile(path);
  assert.equal((await store.recordBatch(input)).idempotent, 3);
  assert.deepEqual(await readFile(path), bytes);
  await assert.rejects(store.recordBatch([{ ...alias, evidence_sha256: hash('d') }]), /conflict/);
  await assert.rejects(store.recordBatch([definition('c', { root_id: 'third', identity: { ...identity, price_basis: 'bid' } }),
    { ...alias, entry_id: 'wrong', right: 'c' }]), /identity/);
  await assert.rejects(store.recordBatch([{ ...definition('d'), extra: true }]));
  assert.deepEqual(await readFile(path), bytes);
});

test('106-5 shared-source checks project both sides and preserve exact matches and legacy retries', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory, path } = await setup(t);
  const usagePath = join(directory, 'usage.jsonl');
  const usage = new ResearchPeriodUsageStore(usagePath, undefined, { now: () => new Date(NOW) });
  const a = definition('a', { role: 'derived', root_id: undefined });
  const b = definition('b', { role: 'derived', root_id: undefined });
  await store.recordBatch([definition('raw'), a, b,
    { entry_id: 'da', kind: 'derivation', child: 'a', evidence_sha256: hash('e'), recipe_sha256: hash('f'), mapping_schema: 'declared_support_windows_v1',
      windows: [{ from: ts(10), to: ts(11), supports: [{ parent: 'raw', from: ts(1), to: ts(3) }] }] },
    { entry_id: 'db', kind: 'derivation', child: 'b', evidence_sha256: hash('e'), recipe_sha256: hash('f'), mapping_schema: 'declared_support_windows_v1',
      windows: [{ from: ts(20), to: ts(21), supports: [{ parent: 'raw', from: ts(2), to: ts(4) }] }] }]);
  const input = { access_id: 'access', research_id: 'study', series_id: 'b', data_version: hash('a'),
    from: ts(20), to: ts(21), accessed_at: ts(25), purpose: 'exploration' };
  const first = await usage.record(input);
  const oldBytes = await readFile(usagePath), relationBytes = await readFile(path);
  const query = { target: 'usage', mode: 'shared_source', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(10), to: ts(11) };
  const result = await checkRelatedResearchHistory(query, { usage, relations: store });
  assert.equal(result.has_known_overlap, true);
  assert.equal(result.resolution_complete, true);
  assert.equal(result.matching_records, 1);
  assert.equal(result.matches[0].match_basis, 'shared_source');
  assert.deepEqual(result.matches[0].witnesses[0].overlap, { from: ts(2), to: ts(3) });
  assert.equal((await checkRelatedResearchHistory({ ...query, mode: 'aliases' }, { usage, relations: store })).has_known_overlap, false);
  assert.deepEqual((await usage.record(input)).prior_overlap, first.prior_overlap);
  assert.deepEqual(await readFile(usagePath), oldBytes);
  assert.deepEqual(await readFile(path), relationBytes);
  assert.equal(result.execution_allowed, false);
});

test('106-5 alias expansion recomputes net over the unique match union and never extends reuses admission', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchTrialStore } = await import('../../build/researchTrials.js');
  const { store, directory } = await setup(t);
  const path = join(directory, 'trials.jsonl');
  const trials = new ResearchTrialStore(path, undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('old'), definition('new', { root_id: 'second' }),
    { entry_id: 'alias', kind: 'alias', left: 'old', right: 'new', from: ts(1), to: ts(30), evidence_sha256: hash('e') }]);
  const base = { research_id: 'study', data_version: hash('a'), from: ts(10), to: ts(20), tried_at: ts(25),
    configuration_count: 10, count_basis: 'enumerated', outcome_seen: 'none' };
  const inputs = [{ ...base, trial_set_id: 'origin', series_ids: ['old', 'shared'] },
    { ...base, trial_set_id: 'reuse', series_ids: ['new', 'shared'], reuses: [{ trial_set_id: 'origin', configuration_count: 10 }] }];
  const first = await trials.recordBatch(inputs);
  const bytes = await readFile(path);
  const q = { target: 'trials', mode: 'aliases', series: [{ series_id: 'new', data_version: hash('a') }], from: ts(10), to: ts(20) };
  const exact = await checkRelatedResearchHistory({ ...q, mode: 'exact' }, { trials, relations: store });
  const expanded = await checkRelatedResearchHistory(q, { trials, relations: store });
  assert.deepEqual([exact.matching_records, exact.counts.configurations_net], [1, 10]);
  assert.deepEqual([expanded.matching_records, expanded.counts.configurations_reported, expanded.counts.configurations_net], [2, 20, 10]);
  assert.equal(expanded.resolution_complete, false, 'unregistered shared endpoint remains unresolved');
  assert.equal(expanded.counts.total_is_lower_bound, true);
  await assert.rejects(trials.recordBatch([{ ...base, trial_set_id: 'invalid-alias-reuse', series_ids: ['new'],
    reuses: [{ trial_set_id: 'origin', configuration_count: 10 }] }]), /shares no series/);
  assert.deepEqual((await trials.recordBatch(inputs)).map(r => r.prior_trials), first.map(r => r.prior_trials));
  assert.deepEqual(await readFile(path), bytes);
});

test('106-5 snapshot replay survives append and revocation; missing or changed prefixes fail closed', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a'), definition('b', { root_id: 'other' }),
    { entry_id: 'alias', kind: 'alias', left: 'a', right: 'b', from: ts(10), to: ts(20), evidence_sha256: hash('e') }]);
  const input = { access_id: 'one', research_id: 'study', series_id: 'b', data_version: hash('a'),
    from: ts(10), to: ts(20), accessed_at: ts(25), purpose: 'validation' };
  await usage.record(input);
  const q = { target: 'usage', mode: 'aliases', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(10), to: ts(20) };
  const first = await checkRelatedResearchHistory(q, { usage, relations: store });
  assert.equal(first.matching_records, 1);
  await usage.record({ ...input, access_id: 'two' });
  await store.recordBatch([{ entry_id: 'withdraw', kind: 'revoke', target: 'alias', reason: 'Correction' }]);
  assert.equal((await checkRelatedResearchHistory(q, { usage, relations: store })).matching_records, 0);
  const replay = await checkRelatedResearchHistory({ ...q, snapshots: first.snapshots }, { usage, relations: store });
  assert.deepEqual(replay, first);
  await assert.rejects(checkRelatedResearchHistory({ ...q, rules_version: 'research_related_history_v2' }, { usage, relations: store }));
  await assert.rejects(checkRelatedResearchHistory({ ...q, snapshots: { ...first.snapshots,
    target: { ...first.snapshots.target, prefix_sha256: hash('0') } } }, { usage, relations: store }), /snapshot hash/);
  await assert.rejects(checkRelatedResearchHistory({ ...q, snapshots: { ...first.snapshots,
    registry: { ...first.snapshots.registry, sequence_end: 100 } } }, { usage, relations: store }), /prefix is missing/);
});

test('106-5 partial aliases and derived gaps are not clean negatives; adjacent root intervals do not overlap', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a'), definition('b', { root_id: 'second' }),
    { entry_id: 'ab', kind: 'alias', left: 'a', right: 'b', from: ts(1), to: ts(10), evidence_sha256: hash('e') },
    definition('gap', { role: 'derived', root_id: undefined })]);
  await usage.record({ access_id: 'one', research_id: 'r', series_id: 'b', data_version: hash('a'),
    from: ts(10), to: ts(20), accessed_at: ts(25), purpose: 'exploration' });
  const q = { target: 'usage', mode: 'aliases', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(1), to: ts(10) };
  const adjacent = await checkRelatedResearchHistory(q, { usage, relations: store });
  assert.equal(adjacent.matching_records, 0);
  assert.equal(adjacent.resolution_complete, true);
  const gap = await checkRelatedResearchHistory({ ...q, mode: 'shared_source', series: [{ series_id: 'gap', data_version: hash('a') }] }, { usage, relations: store });
  assert.equal(gap.status, 'inconclusive');
  assert.equal(gap.resolution_complete, false);
});

test('106-5 rejects derived cycles, overlapping windows and missing references atomically', async t => {
  const { store, path } = await setup(t);
  await store.recordBatch([definition('a', { role: 'derived', root_id: undefined }), definition('b', { role: 'derived', root_id: undefined })]);
  const bytes = await readFile(path);
  const d = (entry_id, child, parent) => ({ entry_id, kind: 'derivation', child, recipe_sha256: hash('f'), evidence_sha256: hash('e'),
    mapping_schema: 'declared_support_windows_v1', windows: [{ from: ts(1), to: ts(2), supports: [{ parent, from: ts(1), to: ts(2) }] }] });
  await assert.rejects(store.recordBatch([d('a-b', 'a', 'b'), d('b-a', 'b', 'a')]), /cycle/);
  await assert.rejects(store.recordBatch([d('missing', 'a', 'unknown')]), /reference missing/);
  const overlapping = d('overlap', 'a', 'b'); overlapping.windows.push(overlapping.windows[0]);
  await assert.rejects(store.recordBatch([overlapping]), /overlapping/);
  assert.deepEqual(await readFile(path), bytes);
});

test('106-5 explicit related relations remain unresolved and are never merged', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a'), definition('b', { root_id: 'other-feed', identity: { ...identity, feed: 'different' } }),
    { entry_id: 'related', kind: 'related', left: 'a', right: 'b', from: ts(1), to: ts(30), evidence_sha256: hash('e'), reason: 'Different feeds; equivalence unproved.' }]);
  await usage.record({ access_id: 'one', research_id: 'r', series_id: 'b', data_version: hash('a'),
    from: ts(10), to: ts(20), accessed_at: ts(25), purpose: 'exploration' });
  const r = await checkRelatedResearchHistory({ target: 'usage', mode: 'shared_source', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(10), to: ts(20) }, { usage, relations: store });
  assert.equal(r.status, 'inconclusive');
  assert.equal(r.matching_records, 0);
  assert.ok(r.unresolved.includes('related_relation_unresolved:related'));
});

test('106-5 alias composition clips every edge and does not link disjoint validity periods', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a'), definition('b', { root_id: 'b' }), definition('c', { root_id: 'c' }),
    { entry_id: 'ab', kind: 'alias', left: 'a', right: 'b', from: ts(1), to: ts(10), evidence_sha256: hash('e') },
    { entry_id: 'bc', kind: 'alias', left: 'b', right: 'c', from: ts(10), to: ts(20), evidence_sha256: hash('e') }]);
  await usage.record({ access_id: 'one', research_id: 'r', series_id: 'c', data_version: hash('a'),
    from: ts(1), to: ts(20), accessed_at: ts(25), purpose: 'exploration' });
  const r = await checkRelatedResearchHistory({ target: 'usage', mode: 'aliases', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(1), to: ts(20) }, { usage, relations: store });
  assert.equal(r.matching_records, 0);
  assert.equal(r.resolution_complete, true);
});

test('106-5 a missing multi-input dependency retains known overlap but never claims complete resolution', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('raw'), definition('other', { root_id: 'other' }), definition('child', { role: 'derived', root_id: undefined }),
    { entry_id: 'deps', kind: 'derivation', child: 'child', recipe_sha256: hash('f'), evidence_sha256: hash('e'), mapping_schema: 'declared_support_windows_v1',
      windows: [{ from: ts(1), to: ts(20), supports: [{ parent: 'raw', from: ts(1), to: ts(20) }, { parent: 'other', from: ts(1), to: ts(20) }] }] },
    { entry_id: 'withdraw-parent', kind: 'revoke', target: 'other', reason: 'Unproved source' }]);
  await usage.record({ access_id: 'one', research_id: 'r', series_id: 'raw', data_version: hash('a'),
    from: ts(1), to: ts(20), accessed_at: ts(25), purpose: 'exploration' });
  const r = await checkRelatedResearchHistory({ target: 'usage', mode: 'shared_source', series: [{ series_id: 'child', data_version: hash('a') }], from: ts(1), to: ts(20) }, { usage, relations: store });
  assert.deepEqual([r.matching_records, r.resolution_complete, r.status], [1, false, 'known_overlap']);
  assert.ok(r.unresolved_count > 0);
});

test('106-5 fixed snapshots exclude writers queued while both locks are held', async t => {
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a')]);
  const input = { access_id: 'one', research_id: 'r', series_id: 'a', data_version: hash('a'),
    from: ts(1), to: ts(20), accessed_at: ts(25), purpose: 'exploration' };
  await usage.record(input);
  let writers;
  const relations = { filePath: store.filePath, withSnapshot: (selection, operation) => store.withSnapshot(selection, async snapshot => {
    writers = [usage.record({ ...input, access_id: 'two' }), store.recordBatch([definition('unrelated', { root_id: 'other' })])];
    return operation(snapshot);
  }) };
  const q = { target: 'usage', mode: 'aliases', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(1), to: ts(20) };
  const r = await checkRelatedResearchHistory(q, { usage, relations });
  await Promise.all(writers);
  assert.deepEqual([r.snapshots.target.sequence_end, r.snapshots.registry.sequence_end, r.matching_records], [1, 1, 1]);
  const later = await checkRelatedResearchHistory(q, { usage, relations: store });
  assert.deepEqual([later.snapshots.target.sequence_end, later.snapshots.registry.sequence_end, later.matching_records], [2, 2, 2]);
  assert.deepEqual(await checkRelatedResearchHistory({ ...q, snapshots: r.snapshots }, { usage, relations: store }), r);
});

test('106-5 registry framing, snapshot namespaces and storage collisions fail closed', async t => {
  const { ResearchSeriesRelationStore } = await import('../../build/researchSeriesRelations.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { store, directory, path } = await setup(t);
  const usagePath = join(directory, 'usage.jsonl');
  assert.throws(() => new ResearchSeriesRelationStore(usagePath, { protectedPaths: [usagePath] }), /share/);
  const usage = new ResearchPeriodUsageStore(usagePath, undefined, { now: () => new Date(NOW) });
  await store.recordBatch([definition('a')]);
  const bytes = await readFile(path);
  const q = { target: 'usage', mode: 'aliases', series: [{ series_id: 'a', data_version: hash('a') }], from: ts(1), to: ts(20) };
  const first = await checkRelatedResearchHistory(q, { usage, relations: store });
  await assert.rejects(checkRelatedResearchHistory({ ...q, snapshots: { ...first.snapshots,
    target: { ...first.snapshots.target, namespace: 'research_trials' } } }, { usage, relations: store }), /namespace/);
  await writeFile(path, bytes.subarray(0, bytes.length - 1));
  await assert.rejects(checkRelatedResearchHistory(q, { usage, relations: store }), /framing/);
  const exact = await checkRelatedResearchHistory({ ...q, mode: 'exact' }, { usage, relations: store });
  assert.equal(exact.resolution_complete, true, 'exact mode does not read a corrupt registry');
  await writeFile(path, bytes);
  const link = join(directory, 'linked.jsonl');
  await symlink(path, link);
  const linked = new ResearchSeriesRelationStore(link);
  await assert.rejects(linked.withSnapshot(undefined, s => s), /symbolic|symlink|regular/i);
});

test('106-5 target and dependency path limits reject rather than returning a clean negative', async t => {
  const { relationSnapshot } = await import('../../build/researchRelationSnapshot.js');
  assert.throws(() => relationSnapshot('research_trials', Array.from({ length: 4097 }, (_, i) => ({ sequence: i + 1 })), '', NOW), /record limit/);
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { ResearchPeriodUsageStore } = await import('../../build/researchPeriodUsage.js');
  const { store, directory } = await setup(t);
  const defs = [definition('raw'), ...Array.from({ length: 35 }, (_, i) => definition(`d${i}`, { role: 'derived', root_id: undefined }))];
  for (let i = 0; i < defs.length; i += 20) await store.recordBatch(defs.slice(i, i + 20));
  const mappings = Array.from({ length: 35 }, (_, i) => ({ entry_id: `map${i}`, kind: 'derivation', child: `d${i}`, recipe_sha256: hash('f'), evidence_sha256: hash('e'),
    mapping_schema: 'declared_support_windows_v1', windows: [{ from: ts(1), to: ts(30), supports: [{ parent: i ? `d${i - 1}` : 'raw', from: ts(1), to: ts(30) }] }] }));
  for (let i = 0; i < mappings.length; i += 20) await store.recordBatch(mappings.slice(i, i + 20));
  const usage = new ResearchPeriodUsageStore(join(directory, 'usage.jsonl'), undefined, { now: () => new Date(NOW) });
  await assert.rejects(checkRelatedResearchHistory({ target: 'usage', mode: 'shared_source', series: [{ series_id: 'd34', data_version: hash('a') }], from: ts(1), to: ts(20) }, { usage, relations: store }), /path limit/);
});

test('106-5 snapshots reject invalid UTF-8 rather than hashing replacement text', async t => {
  const { ResearchTrialStore } = await import('../../build/researchTrials.js');
  const { checkRelatedResearchHistory } = await import('../../build/researchRelatedHistory.js');
  const { store, directory } = await setup(t);
  const path = join(directory, 'trials.jsonl');
  const trials = new ResearchTrialStore(path, undefined, { now: () => new Date(NOW) });
  await trials.recordBatch([{ trial_set_id: 't', research_id: 'r', series_ids: ['a'], data_version: hash('a'), from: ts(1), to: ts(20),
    tried_at: ts(25), configuration_count: 1, count_basis: 'enumerated', outcome_seen: 'none', note: 'x' }]);
  const raw = await readFile(path);
  const index = raw.indexOf(Buffer.from('"note":"x"')) + Buffer.byteLength('"note":"');
  assert.ok(index > 0);
  raw[index] = 0x80;
  await writeFile(path, raw);
  await assert.rejects(checkRelatedResearchHistory({ target: 'trials', mode: 'exact', series: [{ series_id: 'a', data_version: hash('a') }],
    from: ts(1), to: ts(20) }, { trials, relations: store }), /UTF-8/);
});

test('106-5 frozen registry v1 row, definition hash and physical prefix hash remain compatible', async t => {
  const { store, path } = await setup(t);
  const bytes = await readFile(new URL('../fixtures/research-series-relations-v1.jsonl', import.meta.url));
  const expected = JSON.parse(bytes.toString('utf8'));
  const definitionHash = 'sha256:f112e45ce3342c65037b84bed7bf9562d70c2e8b16831fe5b00073173e4d22a3';
  const prefixHash = 'sha256:d764a024cb05e203b412c463cdec26490c127fb3a542253a9f62164a5e515f10';
  const first = await store.recordBatch([definition('a')]);
  assert.equal(first.results[0].entry.definition_sha256, definitionHash);
  assert.deepEqual(first.results[0].entry, expected);
  assert.deepEqual(await readFile(path), bytes);
  const snapshot = await store.withSnapshot(undefined, s => s);
  assert.equal(snapshot.anchor.prefix_sha256, prefixHash);
  assert.deepEqual(snapshot.records, [expected]);
  assert.equal((await store.recordBatch([definition('a')])).idempotent, 1);
  assert.deepEqual(await readFile(path), bytes);
  await writeFile(path, bytes);
  assert.deepEqual((await store.withSnapshot(snapshot.anchor, s => s)).records, [expected]);
});
