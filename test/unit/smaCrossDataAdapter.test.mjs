import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { adaptSmaCrossV2, SmaAdapterBudget, SMA_ADAPTER_LIMITS } from "../../build/smaCrossDataAdapter.js";
import { SMA_CROSS_V2_ID, SMA_CROSS_V2_HASH, SMA_PERIOD_START as START,
  SMA_PERIOD_END as END } from "../../build/smaCrossMeasurement.js";

const bytes = value => Buffer.from(JSON.stringify(value));
const sha = value => `sha256:${createHash("sha256").update(value).digest("hex")}`;

// Deliberately fictional calendar: a few bars, then a documented year-long closure.
// The external trust argument approves only this synthetic contract; never production evidence.
function fixture() {
  const scopes = [], artifacts = [], pages = [], receipts = [], artifactReceipts = [];
  for (const symbol of ["OANDA:EURUSD", "OANDA:XAUUSD"]) for (const timeframe of ["30", "60"]) {
    const key = `${symbol}|${timeframe}`, d = Number(timeframe) * 60000;
    const context = { provider: "OANDA", symbol, timeframe, native: true, route: "synthetic-memory",
      routeVersion: "1", format: "native-sma-page-v1", timestampUnit: "utc_ms", region: "fictional" };
    const from = START - 121 * d, through = END + d;
    const calendar = { id: key, format: "explicit-native-calendar-v1", from, through,
      blocks: [
        { kind: "bars", from, through: START + 2 * d, duration: d, count: 123,
          shortened: false, evidenceRefs: ["calendar-rule"] },
        { kind: "closure", from: START + 2 * d, through: END, reason: "scheduled_closure",
          evidenceRefs: ["calendar-rule"] },
        { kind: "bars", from: END, through, duration: d, count: 1,
          shortened: false, evidenceRefs: ["calendar-rule"] },
      ] };
    const artifact = { id: key, bytes: bytes(calendar) };
    artifacts.push(artifact);
    artifactReceipts.push({ id: key, sha256: sha(artifact.bytes), byteLength: artifact.bytes.length,
      internalQueries: 1, retries: 0, status: 200 });
    const bars = Array.from({ length: 123 }, (_, i) => ({ openAt: from + i * d, endAt: from + (i + 1) * d,
      close: 100 + i / 10, confirmation: { kind: "native", observedAt: END + 2 * d,
        evidenceRefs: ["native-confirmation"] } }));
    bars.push({ openAt: END, endAt: through, close: 99999, confirmation: {
      kind: "native", observedAt: END + 2 * d, evidenceRefs: ["native-confirmation"] } });
    const page = { id: key, bytes: bytes({ format: "native-sma-page-v1", before: context, after: context,
      snapshot: { id: `history-${timeframe}-${symbol}`, scope: "series-history", evidenceRef: "snapshot-rule" },
      bars }) };
    pages.push(page);
    receipts.push({ id: key, series: key, request: context, sha256: sha(page.bytes), byteLength: page.bytes.length,
      internalQueries: 1, retries: 0, status: 200, observedFrom: END + d, observedThrough: END + 3 * d,
      clock: { source: "synthetic-utc", precisionMs: 1 } });
    scopes.push({ key, context, order: "ascending", calendarId: key, from, through,
      clock: { source: "synthetic-utc", maxPrecisionMs: 1 },
      snapshot: "series-history-v1", confirmation: "native-or-successor-v1",
      calendar: "explicit-native-calendar-v1", evidenceRefs: ["calendar-rule", "native-confirmation", "snapshot-rule"],
      rules: { sessions: "synthetic", dst: "synthetic", holidays: "synthetic",
        shortened: "explicit-calendar", noTrade: "explicit-calendar" } });
  }
  const evidenceValue = { id: "synthetic-approved-v1", format: "sma-evidence-v1", scopes,
    sources: ["calendar-rule", "native-confirmation", "snapshot-rule"].map(id => ({ id, version: "1", sha256: sha(bytes(id)) })),
    calendars: artifacts.map(a => ({ id: a.id, sha256: sha(a.bytes) })) };
  const evidence = bytes(evidenceValue);
  const manifestValue = { format: "sma-frozen-package-v1", definitionId: SMA_CROSS_V2_ID,
    definitionHash: SMA_CROSS_V2_HASH, periodFrom: START, periodThrough: END,
    evidenceId: evidenceValue.id, evidenceHash: sha(evidence), pages: receipts, artifacts: artifactReceipts };
  const manifest = bytes(manifestValue);
  return { input: { evidence, manifest, manifestHash: sha(manifest), artifacts, pages },
    trust: { approvedEvidence: [{ id: evidenceValue.id, sha256: sha(evidence) }] },
    evidenceValue, manifestValue };
}

function reseal(f, approve = false) {
  for (const [items, receipts] of [[f.input.pages, f.manifestValue.pages], [f.input.artifacts, f.manifestValue.artifacts]]) {
    items.forEach((item, i) => { receipts[i].sha256 = sha(item.bytes); receipts[i].byteLength = item.bytes.length; });
  }
  if (approve) {
    f.evidenceValue.calendars = f.input.artifacts.map(a => ({ id: a.id, sha256: sha(a.bytes) }));
    f.input.evidence = bytes(f.evidenceValue);
    f.trust.approvedEvidence = [{ id: f.evidenceValue.id, sha256: sha(f.input.evidence) }];
  }
  f.manifestValue.evidenceHash = sha(f.input.evidence);
  f.input.manifest = bytes(f.manifestValue); f.input.manifestHash = sha(f.input.manifest);
  return f;
}
function editPage(f, i, edit) {
  const page = JSON.parse(f.input.pages[i].bytes); edit(page);
  f.input.pages[i].bytes = bytes(page); return reseal(f);
}

test("package assertions cannot create an approved evidence root", () => {
  const evidence = bytes({ id: "self-approved", approved: true });
  const result = adaptSmaCrossV2({ evidence, manifest: bytes({}), manifestHash: sha(bytes({})),
    pages: [], artifacts: [] }, { approvedEvidence: [] });
  assert.equal(result.status, "held");
  assert.equal(result.reason, "evidence_not_approved");
  assert.equal(result.series, null);
  assert.equal(result.executionAllowed, false);
});

test("clock source and precision must be approved, not supplied solely by the acquisition receipt", () => {
  for (const clock of [{ source: "other", precisionMs: 1 }, { source: "synthetic-utc", precisionMs: 2 }]) {
    const f = fixture(); f.manifestValue.pages[0].clock = clock; reseal(f);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "held");
    assert.equal(result.series, null);
    assert.equal(result.seriesResults[0].reason, "observation_clock_unverified");
  }
});

test("approved frozen four-series package yields immutable native data and separate audit commitments", () => {
  const f = fixture(), before = structuredClone(f.input);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted", JSON.stringify(result));
  assert.equal(result.series.length, 4);
  assert.ok(result.series.every(s => s.bars.length === 123));
  assert.ok(result.series.every(s => s.bars.every(b => b.endAt < END && b.close !== 99999)));
  assert.equal(result.mapping.length, 496);
  assert.equal(result.commitments.normalized, sha(bytes(result.series)));
  assert.equal(result.commitments.mapping, sha(bytes(result.mapping)));
  assert.equal(result.globalAtomicity, false);
  assert.equal(new Set(result.seriesResults.map(r => r.snapshot)).size, 4);
  assert.throws(() => { result.series[0].bars[0].close = 0; }, TypeError);
  assert.deepEqual(structuredClone(f.input), before);
});

test("every captured data page must belong to an approved series", () => {
  const f = fixture();
  f.input.pages.push({ id: "orphan", bytes: f.input.pages[0].bytes });
  f.manifestValue.pages.push({ ...f.manifestValue.pages[0], id: "orphan", series: "unapproved" });
  reseal(f);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "unscoped_data_page");
  assert.equal(result.series, null);
});

test("ambiguous duplicate JSON keys are rejected even when the final value looks approved", () => {
  const f = fixture();
  f.input.pages[0].bytes = Buffer.from(f.input.pages[0].bytes.toString().replace('"format":', '"format":"unapproved","format":'));
  reseal(f);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "stopped");
  assert.equal(result.reason, "duplicate_json_key");
});

function splitFirstPage(f, overlap = 0) {
  const original = JSON.parse(f.input.pages[0].bytes), first = structuredClone(original), second = structuredClone(original);
  first.bars = original.bars.slice(0, 80); second.bars = original.bars.slice(80 - overlap);
  const nextId = "second-page", receipt = { ...f.manifestValue.pages[0], id: nextId };
  f.input.pages.splice(0, 1, { id: f.input.pages[0].id, bytes: bytes(first) }, { id: nextId, bytes: bytes(second) });
  f.manifestValue.pages.splice(1, 0, receipt); return reseal(f);
}

test("same job is insufficient; unknown snapshot scope is held and changing history version stops globally", () => {
  const held = fixture();
  editPage(held, 0, page => { page.snapshot.scope = "job"; });
  assert.equal(adaptSmaCrossV2(held.input, held.trust).seriesResults[0].reason, "non_atomic_series");
  const changed = splitFirstPage(fixture());
  editPage(changed, 1, page => { page.snapshot.id = "new-history"; });
  const result = adaptSmaCrossV2(changed.input, changed.trust);
  assert.equal(result.status, "stopped"); assert.equal(result.reason, "snapshot_changed");
  assert.equal(result.series, null); assert.equal(result.mapping, null);
});

test("quality holds never hide later page integrity failures or stop conditions", () => {
  for (const [change, reason] of [
    [page => { page.snapshot.id = "changed-history"; }, "snapshot_changed"],
    [page => { page.after.route = "changed-route"; }, "context_changed"],
    [page => { page.format = "native-sma-page-v2"; }, "unsupported_response_format"],
    [page => { page.bars[0].close += 1; }, "conflicting_bar"],
    [page => { page.bars[1].openAt = page.bars[1].endAt; }, "invalid_bar_time"],
  ]) {
    const f = splitFirstPage(fixture(), 1);
    editPage(f, 0, page => { page.bars[0].close = "unsupported"; });
    editPage(f, 1, change);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "stopped"); assert.equal(result.reason, reason);
    assert.equal(result.series, null); assert.equal(result.mapping, null);
  }
  const held = splitFirstPage(fixture());
  editPage(held, 0, page => { page.bars[0].close = "unsupported"; });
  const result = adaptSmaCrossV2(held.input, held.trust);
  assert.equal(result.status, "held"); assert.equal(result.seriesResults[0].reason, "unsupported_price");
  assert.equal(result.usage.occurrences, 496); // All captured bars were inspected despite the early quality issue.
});

test("unknown acquisition counts cannot hide a later raw hash failure", () => {
  const f = fixture(); f.manifestValue.pages[0].internalQueries = null; reseal(f);
  f.input.pages[1].bytes[0] ^= 1;
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "stopped"); assert.equal(result.reason, "raw_hash_mismatch");
  assert.equal(result.acquisitionCountKnown, false); assert.equal(result.series, null);
});

test("identical overlap retains raw mapping; any changed captured field stops instead of latest-wins", () => {
  const f = splitFirstPage(fixture(), 1), result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted"); assert.equal(result.series[0].bars.length, 123);
  assert.equal(result.mapping.length, 497); assert.equal(result.mapping.filter(m => m.disposition === "duplicate").length, 1);
  for (const field of ["close", "extra"]) {
    const changed = splitFirstPage(fixture(), 1);
    editPage(changed, 1, page => { page.bars[0][field] = 12345; });
    const stopped = adaptSmaCrossV2(changed.input, changed.trust);
    assert.equal(stopped.status, "stopped"); assert.equal(stopped.reason, "conflicting_bar");
  }
});

test("an approved descending traversal is reversible but arbitrary disorder is never sorted away", () => {
  const f = fixture(); f.evidenceValue.scopes.forEach(s => { s.order = "descending"; });
  f.input.pages.forEach(p => { const value = JSON.parse(p.bytes); value.bars.reverse(); p.bytes = bytes(value); });
  reseal(f, true);
  const accepted = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(accepted.status, "accepted"); assert.ok(accepted.series[0].bars[0].endAt < accepted.series[0].bars[1].endAt);
  editPage(f, 0, page => { [page.bars[0], page.bars[1]] = [page.bars[1], page.bars[0]]; });
  assert.equal(adaptSmaCrossV2(f.input, f.trust).reason, "bar_order");
});

test("source, timeframe, region, route and before/after context cannot silently change", () => {
  for (const [field, value] of [["symbol", "OANDA:EURUSD.ONE"], ["timeframe", "61"], ["region", "BVI"],
    ["route", "other"], ["routeVersion", "2"], ["native", false]]) {
    const f = fixture(); editPage(f, 3, page => { page.after[field] = value; });
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "stopped"); assert.equal(result.reason, "context_changed");
    assert.equal(result.seriesResults.length, 3); assert.ok(result.seriesResults.every(s => s.status === "accepted"));
    assert.equal(result.series, null);
  }
});

test("approved hashes still require supported scope, source versions, calendar binding and applicability", () => {
  for (const mutate of [
    f => { f.evidenceValue.scopes[0].context.timestampUnit = "seconds"; },
    f => { f.evidenceValue.scopes[0].context.timeframe = "61"; },
    f => { f.evidenceValue.scopes[0].from = START; },
    f => { f.evidenceValue.scopes[0].through = END; },
    f => { f.evidenceValue.scopes[0].evidenceRefs = ["unapproved"]; },
    f => { f.evidenceValue.sources[0].version = ""; },
  ]) {
    const f = fixture(); mutate(f); reseal(f, true);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.notEqual(result.status, "accepted"); assert.equal(result.series, null);
  }
  const changed = fixture(); changed.evidenceValue.scopes[0].rules.dst = "changed";
  changed.input.evidence = bytes(changed.evidenceValue); reseal(changed);
  assert.equal(adaptSmaCrossV2(changed.input, changed.trust).reason, "evidence_not_approved");
  const unapprovedCalendar = fixture();
  const cal = JSON.parse(unapprovedCalendar.input.artifacts[0].bytes); cal.blocks[1].reason = "no_trade";
  unapprovedCalendar.input.artifacts[0].bytes = bytes(cal); reseal(unapprovedCalendar);
  assert.equal(adaptSmaCrossV2(unapprovedCalendar.input, unapprovedCalendar.trust).seriesResults[0].reason, "calendar_not_approved");
});

test("native confirmation is not a boolean or current-clock inference; string prices are not rounded or coerced", () => {
  for (const edit of [bar => { bar.close = "101.00000000000000001"; },
    bar => { bar.confirmation = { confirmed: true, observedAt: END }; },
    bar => { bar.confirmation.observedAt = bar.openAt; },
    bar => { bar.confirmation.kind = "wall-clock"; },
    bar => { bar.confirmation.evidenceRefs = ["calendar-rule"]; }]) {
    const f = fixture(); editPage(f, 0, page => edit(page.bars[121]));
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.notEqual(result.status, "accepted"); assert.equal(result.series, null);
  }
  const f = fixture(); editPage(f, 0, page => { page.bars[121].close = Number.MIN_VALUE; page.bars[122].close = Number.MAX_VALUE; });
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted");
  assert.equal(result.series[0].bars[121].close, Number.MIN_VALUE); assert.equal(result.series[0].bars[122].close, Number.MAX_VALUE);
});

test("missing expected intervals are held, never explained by min/max timestamps or a large time delta", () => {
  const f = fixture(); editPage(f, 0, page => { page.bars.splice(121, 1); });
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "held"); assert.equal(result.seriesResults[0].reason, "expected_interval_missing_or_changed");
  assert.equal(result.seriesResults[0].bars, null);
  assert.equal(result.series, null); assert.equal(result.seriesResults[1].status, "accepted");
});

test("explicit pinned no-trade/holiday gaps and shortened native intervals preserve the real native end", () => {
  const f = fixture(), d = 30 * 60000, cal = JSON.parse(f.input.artifacts[0].bytes), from = cal.from;
  cal.blocks = [
    { kind: "bars", from, through: START, duration: d, count: 121, shortened: false, evidenceRefs: ["calendar-rule"] },
    { kind: "closure", from: START, through: START + d, reason: "no_trade", evidenceRefs: ["calendar-rule"] },
    { kind: "bars", from: START + d, through: START + 1.5 * d, duration: d / 2, count: 1, shortened: true, evidenceRefs: ["calendar-rule"] },
    { kind: "closure", from: START + 1.5 * d, through: END, reason: "scheduled_closure", evidenceRefs: ["calendar-rule"] },
    cal.blocks[2],
  ];
  f.input.artifacts[0].bytes = bytes(cal);
  editPage(f, 0, page => { page.bars.splice(121, 1); page.bars[121].endAt = START + 1.5 * d; }); reseal(f, true);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted"); assert.equal(result.series[0].bars[121].endAt, START + 1.5 * d);
  assert.equal(result.series[0].bars[121].continuity, "scheduled_closure");
  cal.blocks[1].reason = "unknown"; f.input.artifacts[0].bytes = bytes(cal); reseal(f, true);
  assert.equal(adaptSmaCrossV2(f.input, f.trust).seriesResults[0].reason, "closure_classification_unknown");
});

test("successor is evidence of completion, never a replacement for native end time", () => {
  const f = fixture(); editPage(f, 0, page => { page.bars[122].confirmation.kind = "successor"; });
  assert.equal(adaptSmaCrossV2(f.input, f.trust).status, "accepted");
  editPage(f, 0, page => { page.bars[122].endAt = page.bars[123].openAt; });
  const changed = adaptSmaCrossV2(f.input, f.trust);
  assert.notEqual(changed.status, "accepted"); assert.equal(changed.series, null);
});

test("successor-only measurement bars need just one audit witness, never a successor of that witness", () => {
  const f = fixture();
  for (let i = 0; i < f.input.pages.length; i++) editPage(f, i, page => {
    page.bars.forEach(bar => { bar.confirmation.kind = "successor"; });
  });
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted", result.seriesResults[0]?.reason);
  assert.ok(result.series.every(s => s.bars.length === 123 && s.bars.every(b => b.endAt < END)));
  assert.equal(result.mapping.filter(m => m.disposition === "witness").length, 4);
});

test("an open audit witness proves its native presence without a closing price or its own confirmation", () => {
  const f = fixture(), d = 30 * 60000;
  f.manifestValue.pages[0].observedFrom = END;
  editPage(f, 0, page => {
    page.bars[122].confirmation.kind = "successor";
    const witness = page.bars.at(-1);
    witness.close = null; delete witness.confirmation;
    witness.witnessObservation = { observedAt: END + d / 2, evidenceRefs: ["native-confirmation"] };
  });
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted", result.seriesResults[0]?.reason);
  assert.ok(result.series[0].bars.every(b => b.close !== null && b.endAt < END));
  assert.equal(result.mapping.filter(m => m.series === "OANDA:EURUSD|30" && m.normalized === null).length, 1);
});

test("audit witnesses still require approved observation, clock bounds and native applicability", () => {
  for (const [mutate, reason] of [
    [(bar, receipt) => { bar.witnessObservation.observedAt = bar.openAt; receipt.observedFrom = bar.openAt; }, "witness_observation_time_unverified"],
    [(bar, receipt) => { bar.witnessObservation.observedAt = receipt.observedThrough + 1; }, "witness_observation_time_unverified"],
    [bar => { bar.witnessObservation.evidenceRefs = ["unapproved"]; }, "unapproved_evidence_reference"],
    [bar => { delete bar.witnessObservation; }, "witness_observation_unverified"],
    [bar => { bar.endAt += 1; }, "evidence_applicability_unverified"],
  ]) {
    const f = fixture();
    editPage(f, 0, page => {
      const bar = page.bars.at(-1); bar.close = null; delete bar.confirmation;
      bar.witnessObservation = { observedAt: END + 2 * 30 * 60000, evidenceRefs: ["native-confirmation"] };
      mutate(bar, f.manifestValue.pages[0]);
    });
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "held"); assert.equal(result.seriesResults[0].reason, reason);
    assert.equal(result.series, null);
  }
  const f = fixture(); editPage(f, 0, page => {
    const target = page.bars[121]; target.close = null;
    target.witnessObservation = { observedAt: END + 2 * 30 * 60000, evidenceRefs: ["native-confirmation"] };
  });
  assert.equal(adaptSmaCrossV2(f.input, f.trust).seriesResults[0].reason, "unsupported_price");
});

function tailFixture(gapMinutes, reason = "scheduled_closure") {
  const f = fixture(), d = 30 * 60000, gap = gapMinutes * 60000;
  const cal = JSON.parse(f.input.artifacts[0].bytes), openAt = END - gap - d / 2, endAt = END - gap;
  cal.blocks[1].through = openAt;
  cal.blocks.splice(2, 0,
    { kind: "bars", from: openAt, through: endAt, duration: d / 2, count: 1, shortened: true, evidenceRefs: ["calendar-rule"] },
    { kind: "closure", from: endAt, through: END, reason, evidenceRefs: ["calendar-rule"] });
  f.input.artifacts[0].bytes = bytes(cal);
  editPage(f, 0, page => { page.bars.splice(page.bars.length - 1, 0, { ...page.bars[0], openAt, endAt }); });
  return reseal(f, true);
}

test("tail classification follows approved closure intervals even for a sub-timeframe gap", () => {
  for (const gap of [15, 30]) for (const reason of ["scheduled_closure", "no_trade"]) {
    const f = tailFixture(gap, reason), result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "accepted");
    assert.equal(result.series[0].coverage.tail, "scheduled_closure");
  }
});

test("a native witness spanning the cutoff has continuous tail when no calendar omission intervenes", () => {
  const f = tailFixture(15), d = 30 * 60000, cal = JSON.parse(f.input.artifacts[0].bytes);
  cal.blocks.splice(3, 1); // Remove the pre-cutoff closure; extend the audit interval to begin at the last close.
  cal.through = END + d / 2; cal.blocks[3].from = END - d / 2; cal.blocks[3].through = cal.through;
  f.evidenceValue.scopes[0].through = cal.through; f.input.artifacts[0].bytes = bytes(cal);
  editPage(f, 0, page => { page.bars.at(-1).openAt = END - d / 2; page.bars.at(-1).endAt = END + d / 2; });
  reseal(f, true);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted"); assert.equal(result.series[0].coverage.tail, "continuous");
});

test("calendar omissions beginning exactly at the exclusive cutoff do not change the preceding tail", () => {
  const f = tailFixture(15), d = 30 * 60000, cal = JSON.parse(f.input.artifacts[0].bytes);
  cal.blocks.splice(3, 1);
  cal.blocks[3] = { kind: "bars", from: END - d / 2, through: END, duration: d / 2,
    count: 1, shortened: true, evidenceRefs: ["calendar-rule"] };
  cal.blocks.push({ kind: "closure", from: END, through: END + d / 2,
    reason: "scheduled_closure", evidenceRefs: ["calendar-rule"] });
  cal.through = END + d / 2;
  f.evidenceValue.scopes[0].through = cal.through; f.input.artifacts[0].bytes = bytes(cal);
  editPage(f, 0, page => { page.bars.at(-1).openAt = END - d / 2; page.bars.at(-1).endAt = END; });
  reseal(f, true);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "accepted"); assert.equal(result.series[0].coverage.tail, "continuous");
  assert.ok(result.series[0].bars.every(b => b.endAt < END));
});

test("all numerical budget thresholds stop exactly at the boundary and latch across counters", () => {
  for (const [counter, limit] of Object.entries(SMA_ADAPTER_LIMITS)) {
    const b = new SmaAdapterBudget(); b.charge(counter, limit - 1);
    assert.equal(b.remaining[counter], 1);
    assert.throws(() => b.charge(counter), new RegExp(`${counter}_limit`));
    assert.throws(() => b.charge(counter === "work" ? "bytes" : "work"), new RegExp(`${counter}_limit`));
  }
});

test("request, response and page occurrence thresholds are enforced before expanding bars", () => {
  const cases = [
    [f => { f.input.pages[0].bytes = Buffer.alloc(1024 * 1024 - 3, 32); }, "response_bytes_limit"],
    [f => { f.input.artifacts[0].bytes = Buffer.alloc(64 * 1024 - 3, 32); }, "response_bytes_limit"],
    [f => { const page = JSON.parse(f.input.pages[0].bytes); page.bars = Array(4096).fill(page.bars[0]); f.input.pages[0].bytes = bytes(page); }, "page_occurrences_limit"],
    [f => {
      const original = f.input.pages[0], receipt = f.manifestValue.pages[0];
      for (let i = 0; i < 7; i++) { f.input.pages.push({ id: `extra-${i}`, bytes: original.bytes }); f.manifestValue.pages.push({ ...receipt, id: `extra-${i}` }); }
    }, "series_request_limit"],
    [f => {
      const original = f.input.pages[0], receipt = f.manifestValue.pages[0];
      while (f.input.pages.length < 32) { const id = `page-${f.input.pages.length}`; f.input.pages.push({ id, bytes: original.bytes }); f.manifestValue.pages.push({ ...receipt, id }); }
    }, "dataRequests_limit"],
    [f => {
      const original = f.input.artifacts[0], receipt = f.manifestValue.artifacts[0];
      while (f.input.artifacts.length < 8) { const id = `artifact-${f.input.artifacts.length}`; f.input.artifacts.push({ id, bytes: original.bytes }); f.manifestValue.artifacts.push({ ...receipt, id }); }
    }, "evidenceRequests_limit"],
  ];
  for (const [mutate, reason] of cases) {
    const f = fixture(); mutate(f); reseal(f);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "stopped", JSON.stringify(result)); assert.equal(result.reason, reason);
    assert.equal(result.series, null);
  }
});

test("depth, key count, UTF-8 identifiers and evidence-reference counts use exclusive limits", () => {
  for (const [edit, reason] of [
    [page => { page.extra = Array.from({ length: 64 }, (_, i) => [`k${i}`, 1]).reduce((a, [k, v]) => ({ ...a, [k]: v }), {}); }, "object_keys_limit"],
    [page => { page.extra = "界".repeat(86); }, "invalid_reference"],
    [page => { let v = 1; for (let i = 0; i < 16; i++) v = [v]; page.extra = v; }, "structure_depth_limit"],
    [page => { page.bars[0].confirmation.evidenceRefs = Array(8).fill("native-confirmation"); }, "evidence_refs_limit"],
  ]) {
    const f = fixture(); editPage(f, 0, edit); const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "stopped"); assert.equal(result.reason, reason);
  }
});

test("unknown internal query counts hold; retries, empty and failed acquisitions stop, all count as receipts", () => {
  for (const [field, value, status, reason] of [
    ["internalQueries", null, "held", "internal_query_count_unknown"],
    ["internalQueries", 2, "stopped", "no_retry_unverified"],
    ["retries", 1, "stopped", "no_retry_unverified"],
    ["status", 503, "stopped", "acquisition_failed"],
  ]) {
    const f = fixture(); f.manifestValue.pages[0][field] = value; reseal(f);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, status); assert.equal(result.reason, reason);
    assert.equal(result.usage.dataRequests, 4); assert.equal(result.usage.evidenceRequests, 4);
    assert.equal(result.acquisitionCountKnown, field !== "internalQueries" || value !== null);
  }
  const f = fixture(); f.input.pages[0].bytes = Buffer.alloc(0); reseal(f);
  assert.equal(adaptSmaCrossV2(f.input, f.trust).reason, "acquisition_failed");
});

test("an externally fixed projection commitment detects resealed changes to prices or mapping", () => {
  const f = fixture(), first = adaptSmaCrossV2(f.input, f.trust);
  f.input.expectedProjection = { normalized: first.commitments.normalized, mapping: first.commitments.mapping };
  assert.equal(adaptSmaCrossV2(f.input, f.trust).status, "accepted");
  editPage(f, 0, page => { page.bars[121].close += 1; });
  const changed = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(changed.status, "stopped"); assert.equal(changed.reason, "projection_commitment_mismatch");
  assert.equal(changed.series, null);
  const duplicate = splitFirstPage(fixture(), 1);
  duplicate.input.expectedProjection = f.input.expectedProjection;
  assert.equal(adaptSmaCrossV2(duplicate.input, duplicate.trust).reason, "projection_commitment_mismatch");
});

test("diagnostic accounting includes the bounded stop summary, with its separate 1024-byte reserve", () => {
  const f = fixture(); editPage(f, 3, p => { p.after.route = "changed"; });
  const result = adaptSmaCrossV2(f.input, f.trust);
  const summary = { ...result, series: null, mapping: null, commitments: null, auditManifest: null };
  assert.ok(result.usage.diagnosticBytes >= bytes(summary).length);
  assert.ok(result.usage.diagnosticBytes >= 1024);
  assert.ok(bytes(summary).length < 65536);
});

test("warmup purpose maximum is inclusive, bounded before output and never automatically extended", () => {
  for (const n of [8311, 8312]) {
    const f = fixture(), d = 30 * 60000, from = START - (n + 1) * d;
    const cal = JSON.parse(f.input.artifacts[0].bytes); cal.from = from; cal.blocks[0].from = from; cal.blocks[0].count = n + 3;
    f.input.artifacts[0].bytes = bytes(cal); f.evidenceValue.scopes[0].from = from;
    const original = JSON.parse(f.input.pages[0].bytes), tail = original.bars.at(-1);
    const all = Array.from({ length: n + 3 }, (_, i) => ({ ...original.bars[0],
      openAt: from + i * d, endAt: from + (i + 1) * d })); all.push(tail);
    const chunks = [], receipts = [];
    for (let i = 0; i < all.length; i += 3000) {
      const id = `warmup-page-${i}`;
      chunks.push({ id, bytes: bytes({ ...original, bars: all.slice(i, i + 3000) }) });
      receipts.push({ ...f.manifestValue.pages[0], id });
    }
    f.input.pages.splice(0, 1, ...chunks); f.manifestValue.pages.splice(0, 1, ...receipts); reseal(f, true);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, n === 8311 ? "accepted" : "stopped", JSON.stringify({ status: result.status, reason: result.reason }));
    if (n === 8311) assert.equal(result.series[0].bars.length, 8314);
    else assert.equal(result.reason, "purpose_bar_limit");
  }
});

test("clock uncertainty straddling completion holds; malformed UTF-8/JSON and shared buffers stop", () => {
  const f = fixture(), d = 30 * 60000;
  f.manifestValue.pages[0].observedFrom = START - d;
  editPage(f, 0, page => { page.bars[121].confirmation.observedAt = page.bars[121].endAt; });
  assert.equal(adaptSmaCrossV2(f.input, f.trust).seriesResults[0].reason, "confirmation_time_unverified");
  for (const [value, reason] of [[Buffer.from([0xff]), "invalid_utf8"], [Buffer.from("{"), "invalid_json"],
    [new Uint8Array(new SharedArrayBuffer(1)), "input_bytes_limit"]]) {
    const bad = fixture(); bad.input.pages[0].bytes = value; reseal(bad);
    const result = adaptSmaCrossV2(bad.input, bad.trust);
    assert.equal(result.status, "stopped"); assert.equal(result.reason, reason);
  }
});

test("one audit witness is allowed, a second distinct post-window bar stops, and neither price enters the projection", () => {
  const f = fixture(), d = 30 * 60000;
  editPage(f, 0, page => { page.bars.push({ ...page.bars.at(-1), openAt: END + d, endAt: END + 2 * d,
    confirmation: { ...page.bars.at(-1).confirmation, observedAt: END + 2 * d + 1 } }); });
  const cal = JSON.parse(f.input.artifacts[0].bytes); cal.through = END + 2 * d;
  cal.blocks[2].through = cal.through; cal.blocks[2].count = 2;
  f.input.artifacts[0].bytes = bytes(cal); f.evidenceValue.scopes[0].through = cal.through; reseal(f, true);
  const result = adaptSmaCrossV2(f.input, f.trust);
  assert.equal(result.status, "stopped"); assert.equal(result.reason, "purpose_bar_limit");
  assert.equal(result.series, null);
});

test("byte and receipt tampering stops and originals remain available to the caller", () => {
  for (const mutate of [
    f => { f.input.pages[0].bytes[0] ^= 1; },
    f => { f.input.manifest[0] ^= 1; },
    f => { f.manifestValue.pages[0].byteLength++; f.input.manifest = bytes(f.manifestValue); f.input.manifestHash = sha(f.input.manifest); },
  ]) {
    const f = fixture(); mutate(f); const originals = structuredClone(f.input);
    const result = adaptSmaCrossV2(f.input, f.trust);
    assert.equal(result.status, "stopped"); assert.equal(result.series, null);
    assert.equal(result.retention, "caller_retains_originals"); assert.deepEqual(structuredClone(f.input), originals);
  }
});
