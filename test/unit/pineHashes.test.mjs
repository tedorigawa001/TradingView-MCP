import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { TradingView } from '../../build/tradingview.js';
import { hashPineSource, withPineSourceHash, withPineSaveHashes, withIndicatorTableHashes } from '../../build/pineHashes.js';

const pineId = 'USER;abcdefgh12345678';
const source = '//@version=6\nindicator("測定")\n';
const sha = (text) => `sha256:${createHash('sha256').update(text, 'utf8').digest('hex')}`;

async function saveFixture({ submitted = source, readback = { version: '8.0', source: source.replace(/\n/g, '\r\n') },
  ackId = pineId, compileOk = true, readOk = true, readError = false } = {}) {
  let writes = 0;
  const reads = [];
  const tv = new TradingView({ evaluate: async (expression) => vm.runInNewContext(expression, {
    window: { TradingViewApi: { pineLibApi: () => ({
      saveNext: async (args) => {
        writes++; assert.equal(args.scriptSource, submitted); assert.equal(args.scriptIdPart, pineId);
        return { success: compileOk, metaInfo: { scriptIdPart: ackId, description: '測定' },
          compileErrors: { errors: compileOk ? [] : [{ message: 'compile failed' }], warnings: [] } };
      },
      saveNew: async () => { throw new Error('unexpected saveNew'); },
    }) } },
    fetch: async (url) => {
      reads.push(url);
      if (readError) throw new Error('readback unavailable');
      return { ok: readOk, json: async () => readback };
    },
  }) });
  const saved = await tv.savePineScript({ source: submitted, pineId, confirm: true });
  return { saved, response: withPineSaveHashes(saved, submitted), writes, reads };
}

test('save verification never hashes a missing readback source by coercing it to text', async () => {
  const f = await saveFixture({ submitted: 'undefined', readback: { version: '8.0' } });
  assert.equal(f.writes, 1); assert.equal(f.reads.length, 1);
  assert.equal(f.saved.verified, false);
  assert.equal(f.response.sourceSha256, null);
  assert.equal(f.response.submittedSourceSha256, sha('undefined'));
});

for (const version of [null, 'last', 'invalid']) {
  test(`save verification refuses a readback without an exact version: ${version}`, async () => {
    const f = await saveFixture({ readback: { version, source } });
    assert.equal(f.writes, 1); assert.equal(f.reads.length, 1);
    assert.equal(f.saved.verified, false);
    assert.equal(f.response.sourceSha256, null);
  });
}

for (const ackId of ['USER;different12345678', 'PUB;abcdefgh12345678']) {
  test(`save verification refuses a mismatched acknowledgement ID: ${ackId}`, async () => {
    const f = await saveFixture({ ackId });
    assert.equal(f.writes, 1); assert.equal(f.reads.length, 0);
    assert.equal(f.saved.verified, false); assert.equal(f.response.sourceSha256, null);
  });
}

for (const compileOk of [true, false]) {
  test(`save readback retains a matching-source hash independently of compile status: ${compileOk}`, async () => {
    const f = await saveFixture({ compileOk });
    assert.equal(f.writes, 1); assert.equal(f.reads.length, 1);
    assert.ok(f.reads[0].endsWith(`${encodeURIComponent(pineId)}/last`));
    assert.equal(f.saved.saved, true); assert.equal(f.saved.verified, true);
    assert.equal(f.saved.version, '8.0'); assert.equal(f.saved.compileOk, compileOk);
    assert.equal(f.response.sourceHashSchema, 'pine_source_lf_v1');
    assert.equal(f.response.sourceSha256, sha(source));
    assert.equal(f.response.submittedSourceSha256, sha(source));
    if (!compileOk) { assert.equal(f.saved.compileErrors.length, 1); assert.match(f.saved.revertHint, /version 8.0/); }
  });
}

for (const [name, options] of [
  ['mismatch', { readback: { version: '8.0', source: source + '// changed' } }],
  ['HTTP failure', { readOk: false }],
  ['read exception', { readError: true }],
]) {
  test(`save ${name} returns no saved-source hash and never retries the write or readback`, async () => {
    const f = await saveFixture(options);
    assert.equal(f.writes, 1); assert.equal(f.reads.length, 1);
    assert.equal(f.saved.verified, false); assert.equal(f.saved.saved, false);
    assert.equal(f.response.sourceSha256, null);
    assert.equal(f.response.submittedSourceSha256, sha(source));
  });
}

test('source hashes canonicalize only CRLF and preserve lone CR, BOM, whitespace and Unicode', () => {
  assert.equal(hashPineSource('測定\r\nA\r\n'), sha('測定\nA\n'));
  assert.equal(hashPineSource('測定\r\nA\r\n'), hashPineSource('測定\nA\n'));
  for (const [a, b] of [['A\rB', 'A\nB'], ['A ', 'A'], ['A\n', 'A'], ['\uFEFFA', 'A'], ['é', 'e\u0301']]) {
    assert.notEqual(hashPineSource(a), hashPineSource(b));
  }
  const raw = { pineId, version: '8.0', source: '測定\r\nA\r\n', sourceSha256: 'stale' };
  const decorated = withPineSourceHash(raw);
  assert.equal(decorated.source, raw.source); assert.equal(decorated.version, raw.version);
  assert.equal(decorated.sourceSha256, sha('測定\nA\n')); assert.equal(raw.sourceSha256, 'stale');
});

test('table hashes preserve response shape and mark incomplete or errored snapshots without a digest', () => {
  const table = { id: 1, position: 'top_right', rows: 1, columns: 1, cellCount: 1, grid: [['測定']] };
  const studies = [
    { id: 'ok', name: 'Good', tables: [table] },
    { id: 'clipped', name: 'Clipped', tables: [{ ...table, grid: [['x'.repeat(200) + '…(truncated)']] }] },
    { id: 'tableError', name: 'Error', tables: [{ ...table, error: 'unreadable' }] },
    { id: 'studyError', name: 'Error', error: 'graphics unavailable', tables: [table] },
    { id: 'empty', name: 'Empty', tables: [{ id: 2, position: null, rows: 0, columns: 0, cellCount: 0 }] },
    { id: 'hidden', name: 'Hidden', tables: [] },
  ];
  const original = structuredClone(studies);
  const result = withIndicatorTableHashes(studies);
  assert.deepEqual(studies, original); assert.equal(result.length, studies.length);
  assert.equal(result[0].tables[0].sha256, sha(JSON.stringify({ ...table, tooltips: [] })));
  for (const study of result.slice(1, -1)) {
    assert.equal(study.tables[0].hashSchema, 'indicator_table_v1');
    assert.equal(study.tables[0].sha256, null);
  }
  assert.equal(result[3].error, 'graphics unavailable'); assert.deepEqual(result.at(-1).tables, []);
});

test('save hashes require both verification flags, an own ID and an exact version', () => {
  const base = { dryRun: false, saved: true, verified: true, pineId, version: '8.0' };
  assert.equal(withPineSaveHashes(base, source).sourceSha256, sha(source));
  for (const patch of [{ dryRun: true }, { saved: false }, { verified: false }, { version: null },
    { version: 'last' }, { pineId: null }, { pineId: 'PUB;abcdefgh12345678' }]) {
    const result = withPineSaveHashes({ ...base, ...patch }, source);
    assert.equal(result.sourceSha256, null); assert.equal(result.submittedSourceSha256, sha(source));
  }
});
