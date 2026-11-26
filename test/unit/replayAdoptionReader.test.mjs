import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { checkReplayAdoptionCandidate } from "../../build/replayAdoptionCandidate.js";
import { RECORDER_LOG_LIMIT, createReplayAdoptionReader, installReplayRecorder, readReplayTarget,
  recorderScript, removeReplayRecorder } from "../../build/replayAdoptionReader.js";

const OPEN = Date.parse("2026-11-25T12:25:00Z") / 1000;
const CURSOR = OPEN + 299;
const iso = seconds => new Date(seconds * 1000).toISOString();
const sha = letter => `sha256:${letter.repeat(64)}`;
const target = { chartIndex: 0, studyId: "atcWgh", pineId: "USER;4c3460a586b94e77a7ab16fa694a935e", pineVersion: "13.0",
  symbol: "OANDA:AUDUSD", seriesId: "candles:regular:OANDA:AUDUSD:5", timeframe: "5" };

class Delegate {
  constructor() { this._listeners = []; }
  subscribe(object, member) { this._listeners.push({ object, member }); }
  unsubscribeAll(object) { this._listeners = this._listeners.filter(l => l.object !== object); }
  fire(...args) { for (const l of [...this._listeners]) l.member.apply(l.object, args); }
}
const watched = get => ({ value: get });

// A fake page with the TradingView objects the recorder reads.
function page() {
  const d = () => new Delegate();
  const ev = { replaySession: d(), replayPoint: d(), replayEnd: d(), replayModified: d(), barReceived: d(), dataUpdated: d(),
    completed: d(), modified: d(), loading: d(), cleared: d(), sourceUpdated: d(), sourceStatus: d(), reportChanged: d() };
  const s = { started: false, autoplay: false, cursor: null, selected: null, replayResolution: null, auto: "5", session: "",
    turnaround: 270, bars: [[OPEN - 300, 1, 2, 0.5, 1.5, 10], [OPEN, 1.5, 2.5, 1, 2, 11]], reportEnd: null, loading: false,
    completed: true, inputs: [{ id: "in_0", value: 20 }], chartSession: "cs_test", symbol: "OANDA:AUDUSD", resolution: "5" };
  const rs = { get _sessionId() { return s.session; }, get _turnaroundIndex() { return s.turnaround; },
    onSessionIdChanged: () => ev.replaySession, onReplayPointChanged: () => ev.replayPoint, onEndOfDataReached: () => ev.replayEnd };
  const replay = { isReplayStarted: () => watched(() => s.started), isAutoplayStarted: () => watched(() => s.autoplay),
    currentDate: () => watched(() => s.cursor), getReplaySelectedDate: () => watched(() => s.selected),
    currentReplayResolution: () => watched(() => s.replayResolution), autoReplayResolution: () => watched(() => s.auto),
    _replayUIController: { _replayManager: { _replaySession: rs } } };
  const source = { id: () => "atcWgh", _instanceId: "frpd2i", turnaround: () => "st6", isLoading: () => s.loading,
    isCompleted: () => s.completed, get _reportData() { return { settings: { dateRange: { backtest: { to: s.reportEnd } } } }; },
    onDataUpdated: () => ev.sourceUpdated, onStatusChanged: () => ev.sourceStatus, reportChanged: () => ev.reportChanged };
  const series = { _instanceId: "8y0LDq", sessionId: () => "regular",
    bars: () => ({ _items: s.bars.map((value, i) => ({ index: 298 + i, value })) }),
    dataEvents: () => ({ barReceived: () => ev.barReceived, dataUpdated: () => ev.dataUpdated, completed: () => ev.completed,
      modified: () => ev.modified, loading: () => ev.loading, cleared: () => ev.cleared }) };
  const model = { mainSeries: () => series, activeStrategySource: () => ({ value: () => source }), onReplayModified: () => ev.replayModified,
    get _chartSession() { return { _sessionId: s.chartSession }; } };
  const chart = { _chartWidget: { _lineToolsSynchronizer: { _chartModel: model } }, symbol: () => s.symbol, resolution: () => s.resolution,
    getStudyById: () => ({ getInputValues: () => s.inputs }) };
  const window = { TradingViewApi: { chart: () => chart, replayApi: async () => replay } };
  const context = vm.createContext({ window });
  const evaluate = async expression => JSON.parse(JSON.stringify(await vm.runInContext(expression, context)));
  // The start order observed live on a 5-minute chart (2026-11-26).
  const start = ({ cursor = CURSOR, complete = true, pointAfterUpdate = false, status = true, pointBeforeCursor = false } = {}) => {
    s.session = "rs_test"; s.started = true; ev.replaySession.fire("rs_test", ""); ev.replayModified.fire();
    s.bars = []; ev.cleared.fire(); ev.loading.fire(1);
    if (pointBeforeCursor) ev.replayPoint.fire(cursor);
    s.cursor = cursor; s.selected = cursor;
    if (!pointAfterUpdate && !pointBeforeCursor) ev.replayPoint.fire(cursor);
    s.bars = [[OPEN - 300, 1, 2, 0.5, 1.5, 10], [OPEN, 1.5, 2.5, 1, 2, 11]];
    ev.dataUpdated.fire({}, true, {}); ev.barReceived.fire({});
    if (pointAfterUpdate) ev.replayPoint.fire(cursor);
    if (complete) ev.completed.fire({});
    if (status) { s.loading = true; ev.sourceStatus.fire({}); s.loading = false; ev.sourceStatus.fire({}); }
    s.reportEnd = OPEN * 1000; ev.reportChanged.fire({}); ev.sourceUpdated.fire(); ev.sourceUpdated.fire();
  };
  const step = () => {
    s.cursor = CURSOR + 300; ev.replayPoint.fire(s.cursor); ev.dataUpdated.fire({}, false, {});
    ev.reportChanged.fire({}); s.bars.push([OPEN + 300, 2, 3, 1.5, 2.5, 12]); ev.barReceived.fire({});
  };
  return { s, ev, evaluate, start, step };
}

function deps(p) {
  return {
    evaluate: p.evaluate,
    async diagnose() {
      return { status: "same_bar", reason: null, chartIndex: 0, studyId: "atcWgh", adoptionAuthorized: false, symbol: "OANDA:AUDUSD",
        resolution: "5", selectedTime: iso(p.s.selected), cursorTime: iso(p.s.cursor), reportEndTime: iso(OPEN), barOpen: iso(OPEN),
        barEndExclusive: iso(OPEN + 300), pineId: target.pineId, pineVersion: "13.0" };
    },
  };
}

async function installed() {
  const p = page();
  const dep = deps(p);
  const install = await installReplayRecorder(dep, 0, "atcWgh");
  return { p, dep, install };
}

const snapshot = p => p.evaluate(recorderScript("evidence", { chartIndex: 0, studyId: "atcWgh" }));

test("the recorder subscribes passively, needs a stopped Replay, and removes every listener", async () => {
  const { p, install } = await installed();
  assert.match(install.recorderId, /^[a-f0-9]{32}$/);
  assert.equal(install.sources.length, 13);
  assert.ok(Object.values(p.ev).every(d => d._listeners.length === 1));
  await assert.rejects(installReplayRecorder(deps(p), 0, "atcWgh"), /already installed/);
  await assert.rejects(p.evaluate(recorderScript("revision", { chartIndex: 0, studyId: "other" })), /another chart or study/);
  const removed = await removeReplayRecorder(deps(p), 0, "atcWgh");
  assert.deepEqual([removed.removed, removed.left], [true, 0]);
  assert.ok(Object.values(p.ev).every(d => d._listeners.length === 0));
  await assert.rejects(p.evaluate(recorderScript("revision", { chartIndex: 0, studyId: "atcWgh" })), /No replay recorder/);
  const started = page();
  started.s.started = true;
  await assert.rejects(installReplayRecorder(deps(started), 0, "atcWgh"), /before Replay starts/);
  const missing = page();
  missing.ev.reportChanged.fire = undefined;
  await assert.rejects(installReplayRecorder(deps(missing), 0, "atcWgh"), /source unavailable: reportChanged/);
  assert.ok(Object.values(missing.ev).every(d => d._listeners.length === 0), "a failed install leaves no listener");
  assert.throws(() => recorderScript("install", { chartIndex: 0, studyId: "atcWgh", recorderId: "short" }), /recorderId/);
  assert.throws(() => recorderScript("revision", { chartIndex: -1, studyId: "atcWgh" }), /chartIndex/);
});

test("observed delegate notifications and visible changes advance the diagnostic sequence", async () => {
  const { p } = await installed();
  let last = (await snapshot(p)).seq;
  for (const [name, delegate] of Object.entries(p.ev)) {
    delegate.fire();
    const next = (await snapshot(p)).seq;
    assert.ok(next > last, name);
    last = next;
  }
  for (const change of [s => { s.reportEnd = 1; }, s => { s.inputs = [{ id: "in_0", value: 21 }]; }, s => { s.turnaround++; },
    s => { s.chartSession = "cs_other"; }, s => { s.bars[1][4] = 9; }, s => { s.resolution = "1"; }]) {
    change(p.s);
    const next = (await snapshot(p)).seq;
    assert.equal(next, last + 1);
    assert.equal((await snapshot(p)).seq, next, "a settled observation keeps its sequence");
    last = next;
  }
  const log = (await snapshot(p)).log;
  assert.equal(log.filter(e => e.name === "unobserved_change").length, 6);
  assert.ok(log.every((e, i) => e.seq === i + 1), "sequence numbers are never reused");
});

test("the recorder holds without publisher evidence even when its observations look complete", async () => {
  const { p, dep } = await installed();
  p.start();
  assert.deepEqual(await readReplayTarget(dep, 0, "atcWgh"), target);
  const before = await snapshot(p);
  assert.ok(before.log.some(event => event.name === "seriesCompleted"));
  assert.ok(before.log.some(event => event.name === "reportChanged"));

  // A transient change with no notification leaves the recorder's sequence untouched.
  const previousInputs = p.s.inputs;
  p.s.inputs = [{ id: "in_0", value: 21 }];
  p.s.cursor += 300;
  p.s.inputs = previousInputs;
  p.s.cursor -= 300;
  assert.equal((await snapshot(p)).seq, before.seq);

  const reader = createReplayAdoptionReader({
    evaluate: async () => { throw new Error("observations must not be used as publisher evidence"); },
    diagnose: async () => { throw new Error("a same-bar diagnosis is not publisher evidence"); },
  });
  assert.deepEqual(await checkReplayAdoptionCandidate(target, reader),
    { status: "held", reason: "live_revision_unconfirmed", adoptionAuthorized: false });
});

test("failed subscriptions roll back even when subscribe throws after registering", async () => {
  const p = page();
  const subscribe = p.ev.reportChanged.subscribe.bind(p.ev.reportChanged);
  p.ev.reportChanged.subscribe = (object, member) => {
    subscribe(object, member);
    throw new Error("subscribe failed after registration");
  };
  await assert.rejects(installReplayRecorder(deps(p), 0, "atcWgh"), /subscribe failed after registration/);
  assert.ok(Object.values(p.ev).every(delegate => delegate._listeners.length === 0));
  assert.deepEqual(await removeReplayRecorder(deps(p), 0, "atcWgh"), { removed: false });
});

test("cleanup retains failed removals and enforces the original pane and study", async () => {
  const { p, dep, install } = await installed();
  const unsubscribe = p.ev.reportChanged.unsubscribeAll.bind(p.ev.reportChanged);
  p.ev.reportChanged.unsubscribeAll = () => { throw new Error("unsubscribe failed"); };
  for (const [chart, study] of [[1, "atcWgh"], [0, "another"]]) {
    await assert.rejects(removeReplayRecorder(dep, chart, study), /another chart or study/);
  }
  assert.ok(Object.values(p.ev).every(delegate => delegate._listeners.length === 1));
  assert.deepEqual(await removeReplayRecorder(dep, 0, "atcWgh"),
    { removed: false, left: 1, recorderId: install.recorderId });
  await assert.rejects(snapshot(p), /cleanup is pending/);
  await assert.rejects(installReplayRecorder(dep, 0, "atcWgh"), /awaiting cleanup/);
  p.ev.reportChanged.unsubscribeAll = unsubscribe;
  assert.deepEqual(await removeReplayRecorder(dep, 0, "atcWgh"),
    { removed: true, left: 0, recorderId: install.recorderId });
  assert.ok(Object.values(p.ev).every(delegate => delegate._listeners.length === 0));
});

test("installation retains cleanup state when rollback cannot remove a listener", async () => {
  const p = page();
  const subscribe = p.ev.reportChanged.subscribe.bind(p.ev.reportChanged);
  const unsubscribe = p.ev.reportChanged.unsubscribeAll.bind(p.ev.reportChanged);
  p.ev.reportChanged.subscribe = (object, member) => {
    subscribe(object, member);
    throw new Error("subscribe failed");
  };
  p.ev.reportChanged.unsubscribeAll = () => { throw new Error("unsubscribe failed"); };
  await assert.rejects(installReplayRecorder(deps(p), 0, "atcWgh"), /cleanup is pending/);
  assert.equal(Object.values(p.ev).reduce((n, delegate) => n + delegate._listeners.length, 0), 1);
  await assert.rejects(snapshot(p), /cleanup is pending/);
  p.ev.reportChanged.unsubscribeAll = unsubscribe;
  assert.equal((await removeReplayRecorder(deps(p), 0, "atcWgh")).removed, true);
  assert.ok(Object.values(p.ev).every(delegate => delegate._listeners.length === 0));
});

test("the diagnostic recorder bounds the number of observations", async () => {
  const { p } = await installed();
  for (let i = 0; i < RECORDER_LOG_LIMIT + 5; i++) p.ev.sourceUpdated.fire();
  const snap = await snapshot(p);
  assert.equal(snap.log.length, RECORDER_LOG_LIMIT);
  assert.equal(snap.overflow, true);
  assert.equal(snap.seq, RECORDER_LOG_LIMIT + 5);
});

function publisherFixture({ snapshotId = "publisher-snapshot-1", requestedTarget = target, additionalLedger = false } = {}) {
  const live = { appInstanceId: "publisher-app", replaySessionId: "publisher-replay", revision: 14 };
  const update = { seriesId: target.seriesId, openTimeMs: OPEN * 1000, updateId: "publisher-bar-update" };
  const start = { id: "publisher-checkpoint-start", liveRevision: { ...live, revision: 11 } };
  const end = { id: "publisher-checkpoint-end", liveRevision: { ...live } };
  const identity = { snapshotId, ledgerId: sha("a"), reportStateSha256: sha("b"), settingsSha256: sha("c") };
  const { chartIndex, studyId, pineId, pineVersion } = target;
  const proof = {
    start, end, bar: { finalized: true, update: { ...update } },
    report: { complete: true, calculationId: "publisher-calculation", calculatedFrom: { ...update },
      checkpointId: end.id, settingsSha256: identity.settingsSha256, target: { chartIndex, studyId, pineId, pineVersion } },
    ledger: { ...identity, calculationId: "publisher-calculation" },
    streams: [
      { publisherId: "chart-publisher", streamId: "chart", domains: ["replay", "bar", "settings"],
        start: { checkpointId: start.id, streamEpoch: "chart-epoch", sequence: 20 },
        end: { checkpointId: end.id, streamEpoch: "chart-epoch", sequence: 22, publicationComplete: true },
        receivedSequences: [21, 22] },
      { publisherId: "strategy-publisher", streamId: "strategy", domains: ["report", "ledger"],
        start: { checkpointId: start.id, streamEpoch: "strategy-epoch", sequence: 88 },
        end: { checkpointId: end.id, streamEpoch: "strategy-epoch", sequence: 91, publicationComplete: true },
        receivedSequences: [89, 90, 91] },
    ],
  };
  if (additionalLedger) {
    const extraStream = structuredClone(proof.streams[1]);
    extraStream.streamId = "additional-ledger";
    extraStream.domains = ["ledger"];
    proof.streams.push(extraStream);
  }
  proof.streamManifest = {
    startCheckpointId: start.id, endCheckpointId: end.id, complete: true,
    requiredStreams: proof.streams.map(({ publisherId, streamId, domains, start }) => ({
      publisherId, streamId, domains: [...domains], streamEpoch: start.streamEpoch,
    })),
  };
  const evidence = {
    binding: { ...identity, liveRevision: { ...live } }, target: { ...requestedTarget },
    replay: { paused: true, selectedTimeMs: CURSOR * 1000, cursorTimeMs: CURSOR * 1000 },
    bar: { update: { ...update }, endTimeMs: (OPEN + 300) * 1000, nativeBoundaryConfirmed: true,
      continuityConfirmed: true, finalUpdateConfirmed: true },
    report: { endTimeMs: OPEN * 1000, calculatedFrom: { ...update }, calculationComplete: true,
      availableTrades: 501, closedTrades: 500 },
  };
  const calls = [];
  const fx = { live, proof, evidence, calls, requestedTarget };
  const reader = createReplayAdoptionReader({
    evaluate: async () => { throw new Error("unexpected recorder read"); },
    diagnose: async () => { throw new Error("unexpected page diagnosis"); },
    publisher: {
      async readLiveRevision() { return { ...live }; },
      async readEvidence(requested) {
        assert.deepEqual(requested, requestedTarget);
        const packet = structuredClone({ evidence, proof });
        fx.onEvidence?.(packet);
        return packet;
      },
      async readLedgerPage(requested, range) {
        assert.deepEqual(requested, requestedTarget);
        assert.deepEqual(Object.keys(range).sort(), ["limit", "offset"]);
        calls.push(range.offset);
        const next = Math.min(range.offset + range.limit, evidence.report.availableTrades);
        const packet = {
          checkpointId: end.id, calculationId: proof.report.calculationId,
          page: {
            binding: structuredClone(evidence.binding), offset: range.offset,
            nextOffset: next < evidence.report.availableTrades ? next : null,
            availableTrades: evidence.report.availableTrades,
            trades: Array.from({ length: next - range.offset }, (_, i) => {
              const reportIndex = range.offset + i;
              return { reportIndex, status: reportIndex < evidence.report.closedTrades ? "closed" : "open" };
            }),
          },
        };
        fx.onPage?.(packet);
        return packet;
      },
    },
  });
  return Object.assign(fx, { reader });
}

const run = fx => checkReplayAdoptionCandidate(fx.requestedTarget, fx.reader);
const expectHeld = async (fx, reason) => assert.deepEqual(await run(fx), {
  status: "held", reason, adoptionAuthorized: false,
});

test("publisher evidence binds the final bar update, calculation and all ledger pages", async () => {
  for (const snapshotId of ["publisher-snapshot-1", null]) {
    const fx = publisherFixture({ snapshotId });
    assert.deepEqual(await run(fx), { status: "candidate", adoptionAuthorized: false });
    assert.deepEqual(fx.calls, [0, 500]);
  }
});

test("publisher evidence rejects mismatched final updates, calculations and report bindings", async () => {
  for (const change of [
    p => { p.bar.finalized = false; },
    p => { p.report.complete = false; },
    p => { delete p.report.target; },
    p => { delete p.report.settingsSha256; },
    p => { p.report.checkpointId = p.start.id; },
    p => { p.report.calculatedFrom.updateId = "different-bar-update"; },
    p => { p.report.calculatedFrom.seriesId = "different-series"; },
    p => { p.report.calculatedFrom.openTimeMs -= 300_000; },
    p => { p.ledger.calculationId = "different-calculation"; },
    p => { p.ledger.reportStateSha256 = sha("e"); },
    p => { p.ledger.settingsSha256 = sha("e"); },
  ]) {
    const fx = publisherFixture();
    change(fx.proof);
    await expectHeld(fx, "report_evidence_unconfirmed");
    assert.deepEqual(fx.calls, []);
  }
  const bothPointToTheWrongUpdate = publisherFixture();
  bothPointToTheWrongUpdate.proof.report.calculatedFrom.updateId = "different-bar-update";
  bothPointToTheWrongUpdate.evidence.report.calculatedFrom.updateId = "different-bar-update";
  await expectHeld(bothPointToTheWrongUpdate, "report_evidence_unconfirmed");
  assert.deepEqual(bothPointToTheWrongUpdate.calls, []);
});

test("publisher calculation evidence cannot be reused for a different target or settings", async () => {
  for (const overrides of [
    { chartIndex: 1 },
    { studyId: "other-study" },
    { pineId: "USER;0123456789abcdef" },
    { pineVersion: "1.0" },
  ]) {
    const fx = publisherFixture({ requestedTarget: { ...target, ...overrides } });
    await expectHeld(fx, "report_evidence_unconfirmed");
    assert.deepEqual(fx.calls, []);
  }
  const fx = publisherFixture();
  fx.evidence.binding.settingsSha256 = fx.proof.ledger.settingsSha256 = sha("e");
  await expectHeld(fx, "report_evidence_unconfirmed");
  assert.deepEqual(fx.calls, []);
});

test("publisher evidence holds when a required event stream is entirely missing", async () => {
  const fx = publisherFixture({ additionalLedger: true });
  assert.deepEqual(await run(fx), { status: "candidate", adoptionAuthorized: false });
  assert.deepEqual(fx.calls, [0, 500]);
  fx.calls.length = 0;
  fx.proof.streams.pop();
  await expectHeld(fx, "report_evidence_unconfirmed");
  assert.deepEqual(fx.calls, []);
});

test("the required event stream manifest must be complete and bound to the same checkpoints and sources", async () => {
  for (const change of [
    p => { delete p.streamManifest; },
    p => { p.streamManifest.complete = false; },
    p => { p.streamManifest.startCheckpointId = "other-start-checkpoint"; },
    p => { p.streamManifest.endCheckpointId = "other-end-checkpoint"; },
    p => { p.streamManifest.requiredStreams.push(structuredClone(p.streamManifest.requiredStreams[1])); },
    p => { p.streamManifest.requiredStreams[1].publisherId = "other-publisher"; },
    p => { p.streamManifest.requiredStreams[1].streamId = "other-stream"; },
    p => { p.streamManifest.requiredStreams[1].streamEpoch = "other-epoch"; },
    p => { p.streamManifest.requiredStreams[1].domains = ["report"]; },
    p => { p.streamManifest.requiredStreams.pop(); },
  ]) {
    const fx = publisherFixture();
    change(fx.proof);
    await expectHeld(fx, "report_evidence_unconfirmed");
    assert.deepEqual(fx.calls, []);
  }
});

test("publisher evidence holds when matching stream lists omit the ledger domain", async () => {
  const fx = publisherFixture();
  const received = fx.proof.streams[1];
  const required = fx.proof.streamManifest.requiredStreams[1];
  received.domains = received.domains.filter(domain => domain !== "ledger");
  required.domains = required.domains.filter(domain => domain !== "ledger");
  await expectHeld(fx, "report_evidence_unconfirmed");
  assert.deepEqual(fx.calls, []);
});

test("publisher evidence rejects gaps, duplicates, missing tails and inconsistent checkpoints", async () => {
  for (const change of [
    p => { p.streams[1].receivedSequences = [89, 91]; },
    p => { p.streams[1].receivedSequences = [89, 89, 91]; },
    p => { p.streams[1].receivedSequences = [90, 89, 91]; },
    p => { p.streams[1].receivedSequences.pop(); },
    p => { delete p.streams[1].end.sequence; },
    p => { p.streams[1].end.publicationComplete = false; },
    p => { p.streams[1].end.checkpointId = "other-end-checkpoint"; },
    p => { p.streams[1].start.checkpointId = "other-start-checkpoint"; },
    p => { p.streams[1].end.streamEpoch = "reconnected-stream"; },
    p => { p.streams[1].domains = ["report"]; },
    p => { p.streams.push(structuredClone(p.streams[1])); },
    p => { p.start.liveRevision.replaySessionId = "other-session"; },
    p => { p.end.liveRevision.appInstanceId = "other-app"; },
  ]) {
    const fx = publisherFixture();
    change(fx.proof);
    await expectHeld(fx, "report_evidence_unconfirmed");
    assert.deepEqual(fx.calls, []);
  }
});

test("publisher live revision detects a change and restoration even with identical snapshot metadata", async () => {
  const fx = publisherFixture();
  const baseline = structuredClone(fx.evidence);
  fx.onPage = () => {
    const original = fx.evidence.replay.cursorTimeMs;
    fx.evidence.replay.cursorTimeMs += 300_000;
    fx.live.revision++;
    fx.evidence.replay.cursorTimeMs = original;
    fx.live.revision++;
  };
  await expectHeld(fx, "live_revision_changed");
  assert.deepEqual(fx.evidence, baseline);
  assert.deepEqual(fx.calls, [0]);
});

test("the page binding is read independently and rejects mixed checkpoints, calculations, and hashes", async () => {
  const original = publisherFixture();
  await original.reader.readEvidence(target);
  const request = { ...original.evidence.binding, snapshotId: "unrelated", reportStateSha256: sha("e") };
  const page = await original.reader.readLedgerPage(target, { binding: request, offset: 0, limit: 500 });
  assert.deepEqual(page.binding, original.evidence.binding);
  for (const change of [
    p => { p.checkpointId = "different-page-checkpoint"; },
    p => { p.calculationId = "different-page-calculation"; },
    p => { p.page.binding.snapshotId = "different-page-snapshot"; },
    p => { p.page.binding.reportStateSha256 = sha("e"); },
    p => { p.page.binding.settingsSha256 = sha("e"); },
    p => { p.page.binding.liveRevision.revision++; },
  ]) {
    const fx = publisherFixture();
    fx.onPage = p => { if (p.page.offset === 500) change(p); };
    await expectHeld(fx, "ledger_page_binding_mismatch");
  }
});

test("the final evidence read cannot replace the publisher baselines with a shorter interval", async () => {
  const fx = publisherFixture();
  fx.onEvidence = packet => {
    if (fx.calls.length === 0) return;
    packet.proof.streams[0].start.sequence++;
    packet.proof.streams[0].receivedSequences.shift();
  };
  await expectHeld(fx, "evidence_changed_during_read");
});
