import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { checkReplayAdoptionCandidate } from "../../build/replayAdoptionCandidate.js";
import { RECORDER_LOG_LIMIT, createReplayAdoptionReader, deriveReplayEvidence, installReplayRecorder, readReplayTarget,
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

function deps(p, { closed = 2, open = 1, ledgerId = sha("a"), diagnosis = {} } = {}) {
  const total = closed + open;
  const trades = Array.from({ length: total }, (_, i) => ({ reportIndex: i, status: i < closed ? "closed" : "open" }));
  const calls = [];
  return {
    calls,
    evaluate: p.evaluate,
    async diagnose(options) {
      calls.push(["diagnose", options]);
      return { status: "same_bar", reason: null, chartIndex: 0, studyId: "atcWgh", adoptionAuthorized: false, symbol: "OANDA:AUDUSD",
        resolution: "5", selectedTime: iso(p.s.selected), cursorTime: iso(p.s.cursor), reportEndTime: iso(OPEN), barOpen: iso(OPEN),
        barEndExclusive: iso(OPEN + 300), pineId: target.pineId, pineVersion: "13.0", ledgerId, reportStateSha256: sha("b"), ...diagnosis };
    },
    async ledger(options) {
      calls.push(["ledger", options]);
      if (options.expectedLedgerId !== undefined && options.expectedLedgerId !== ledgerId) throw new Error("ledger changed");
      const page = trades.slice(options.offset, options.offset + options.limit);
      const next = options.offset + page.length;
      return { ledgerId, availableTrades: total, totalTrades: closed, offset: options.offset, nextOffset: next < total ? next : null,
        currency: "USD", initialCapital: 100000, inputs: [{ id: "in_0", name: "Length", value: 20 }], trades: page };
    },
  };
}

async function installed(options) {
  const p = page();
  const dep = deps(p, options);
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

test("every delegate fire and every unannounced change advances the revision", async () => {
  const { p } = await installed();
  const reader = createReplayAdoptionReader(deps(p));
  let last = (await reader.readLiveRevision(target)).revision;
  for (const [name, delegate] of Object.entries(p.ev)) {
    delegate.fire();
    const next = (await reader.readLiveRevision(target)).revision;
    assert.ok(next > last, name);
    last = next;
  }
  for (const change of [s => { s.reportEnd = 1; }, s => { s.inputs = [{ id: "in_0", value: 21 }]; }, s => { s.turnaround++; },
    s => { s.chartSession = "cs_other"; }, s => { s.bars[1][4] = 9; }, s => { s.resolution = "1"; }]) {
    change(p.s);
    const next = (await reader.readLiveRevision(target)).revision;
    assert.equal(next, last + 1);
    assert.equal((await reader.readLiveRevision(target)).revision, next, "a settled state keeps its revision");
    last = next;
  }
  const log = (await snapshot(p)).log;
  assert.equal(log.filter(e => e.name === "unobserved_change").length, 6);
  assert.ok(log.every((e, i) => e.seq === i + 1), "sequence numbers are never reused");
});

test("the observed start derives a final bar update and the report calculated from it", async () => {
  const { p, install } = await installed();
  p.start();
  const snap = await snapshot(p);
  const derived = deriveReplayEvidence(snap, target.seriesId);
  assert.equal(derived.reason, null);
  assert.equal(derived.finalUpdateConfirmed, true);
  assert.equal(derived.calculationComplete, true);
  assert.deepEqual(derived.calculatedFrom, derived.update);
  assert.equal(derived.update.openTimeMs, OPEN * 1000);
  assert.match(derived.update.updateId, new RegExp("^" + install.recorderId + ":[0-9]+$"));
  const result = await checkReplayAdoptionCandidate(target, createReplayAdoptionReader(deps(p)));
  assert.deepEqual(result, { status: "candidate", adoptionAuthorized: false });
  assert.deepEqual(await readReplayTarget(deps(p), 0, "atcWgh"), target);
});

test("a recorder that did not see this Replay start cannot supply provenance", async () => {
  const { p } = await installed();
  p.start();
  const snap = await snapshot(p);
  const unseen = { ...snap, log: snap.log.filter(e => e.name !== "replaySession") };
  assert.equal(deriveReplayEvidence(unseen, target.seriesId).reason, "replay_start_unobserved");
  const other = { ...snap, current: { ...snap.current, replaySession: "rs_restored" } };
  assert.equal(deriveReplayEvidence(other, target.seriesId).reason, "replay_start_unobserved");
  assert.equal(deriveReplayEvidence({ ...snap, overflow: true }, target.seriesId).reason, "recorder_overflow");
  const result = await checkReplayAdoptionCandidate(target, createReplayAdoptionReader(deps(p, { diagnosis: {} })));
  assert.equal(result.status, "candidate");
  p.s.session = "rs_restored";
  const held = await checkReplayAdoptionCandidate(target, createReplayAdoptionReader(deps(p)));
  assert.equal(held.status, "held");
});

test("a step, an unannounced change or a missing final report keeps the read held", async () => {
  const stepped = await installed();
  stepped.p.start(); stepped.p.step();
  assert.equal(deriveReplayEvidence(await snapshot(stepped.p), target.seriesId).reason, "bar_final_update_unconfirmed");

  const changed = await installed();
  changed.p.start();
  changed.p.s.reportEnd = (OPEN - 300) * 1000;
  await changed.p.evaluate(recorderScript("revision", { chartIndex: 0, studyId: "atcWgh" }));
  changed.p.s.reportEnd = OPEN * 1000;
  assert.equal(deriveReplayEvidence(await snapshot(changed.p), target.seriesId).reason, "replay_session_changed");

  const noReport = page();
  await installReplayRecorder(deps(noReport), 0, "atcWgh");
  noReport.ev.reportChanged.fire = () => {};
  noReport.start();
  assert.equal(deriveReplayEvidence(await snapshot(noReport), target.seriesId).reason, "report_final_update_unconfirmed");

  for (const [change, reason] of [[s => { s.replayResolution = null; s.auto = "1"; }, "bar_final_update_unconfirmed"],
    [s => { s.autoplay = true; }, "bar_final_update_unconfirmed"], [s => { s.loading = true; }, "report_final_update_unconfirmed"]]) {
    const run = await installed();
    run.p.start();
    change(run.p.s);
    const snap = await snapshot(run.p);
    // The read above recorded the change itself, so the evidence is superseded first.
    assert.equal(deriveReplayEvidence(snap, target.seriesId).reason, "replay_session_changed");
    const unrecorded = { ...snap, log: snap.log.filter(e => e.name !== "unobserved_change") };
    assert.equal(deriveReplayEvidence(unrecorded, target.seriesId).reason, reason);
  }
});

test("the stage A check holds on ledger, report and revision problems seen through the reader", async () => {
  const wrongCount = await installed({ closed: 2, open: 1 });
  wrongCount.p.start();
  const reader = createReplayAdoptionReader({ ...wrongCount.dep, ledger: async options => {
    const page = await wrongCount.dep.ledger(options);
    return { ...page, trades: page.trades.map(t => ({ ...t, status: "closed" })) };
  } });
  assert.deepEqual(await checkReplayAdoptionCandidate(target, reader), { status: "held", reason: "ledger_count_unconfirmed", adoptionAuthorized: false });

  const moving = await installed();
  moving.p.start();
  let fired = false;
  const during = createReplayAdoptionReader({ ...moving.dep, ledger: async options => {
    const page = await moving.dep.ledger(options);
    if (options.limit > 1 && !fired) { fired = true; moving.p.ev.sourceUpdated.fire(); }
    return page;
  } });
  assert.deepEqual(await checkReplayAdoptionCandidate(target, during), { status: "held", reason: "live_revision_changed", adoptionAuthorized: false });

  const notSame = await installed();
  notSame.p.start();
  const r = await checkReplayAdoptionCandidate(target, createReplayAdoptionReader(deps(notSame.p, { diagnosis: { status: "different_bar", reason: "cursor_outside_half_open_bar" } })));
  assert.deepEqual(r, { status: "held", reason: "bar_boundary_unconfirmed", adoptionAuthorized: false });

  const big = await installed({ closed: 700, open: 1 });
  big.p.start();
  assert.equal((await checkReplayAdoptionCandidate(target, createReplayAdoptionReader(big.dep))).status, "candidate");
  const pages = big.dep.calls.filter(([kind, o]) => kind === "ledger" && o.limit === 500);
  assert.deepEqual(pages.map(([, o]) => [o.offset, o.expectedLedgerId]), [[0, sha("a")], [500, sha("a")]]);

  const otherTarget = await installed();
  otherTarget.p.start();
  assert.equal((await checkReplayAdoptionCandidate({ ...target, seriesId: "candles:extended:OANDA:AUDUSD:5" },
    createReplayAdoptionReader(otherTarget.dep))).reason, "target_changed");
});

test("the recorder log is bounded and an overflow is reported", async () => {
  const { p } = await installed();
  for (let i = 0; i < RECORDER_LOG_LIMIT + 5; i++) p.ev.sourceUpdated.fire();
  const snap = await snapshot(p);
  assert.equal(snap.log.length, RECORDER_LOG_LIMIT);
  assert.equal(snap.overflow, true);
  assert.equal(snap.seq, RECORDER_LOG_LIMIT + 5);
  p.start();
  assert.equal(deriveReplayEvidence(await snapshot(p), target.seriesId).reason, "recorder_overflow");
});

test("each final-update and report condition is required on its own", async () => {
  const cases = [
    [{ complete: false }, null, "bar_final_update_unconfirmed"],
    [{ pointAfterUpdate: true }, null, "bar_final_update_unconfirmed"],
    [{ cursor: OPEN + 150 }, null, "bar_final_update_unconfirmed"],
    [{}, p => p.ev.dataUpdated.fire({}, false, {}), "bar_final_update_unconfirmed"],
    [{ status: false }, null, "report_final_update_unconfirmed"],
    [{}, p => p.ev.completed.fire({}), "report_final_update_unconfirmed"],
    [{}, p => p.ev.replayEnd.fire(), "replay_session_changed"],
    [{}, p => p.ev.modified.fire(), "bar_final_update_unconfirmed"],
    [{}, p => p.ev.loading.fire(1), "bar_final_update_unconfirmed"],
    [{ pointBeforeCursor: true }, null, "replay_point_unobserved"],
  ];
  for (const [options, after, reason] of cases) {
    const { p } = await installed();
    p.start(options);
    after?.(p);
    assert.equal(deriveReplayEvidence(await snapshot(p), target.seriesId).reason, reason, JSON.stringify(options) + String(after));
  }
});

test("ledger identity must agree between the bar diagnosis, the first page and every later page", async () => {
  const split = await installed();
  split.p.start();
  const mismatch = createReplayAdoptionReader(deps(split.p, { diagnosis: { ledgerId: sha("c") } }));
  assert.deepEqual(await checkReplayAdoptionCandidate(target, mismatch), { status: "held", reason: "evidence_read_failed", adoptionAuthorized: false });

  const drift = await installed();
  drift.p.start();
  const reader = createReplayAdoptionReader({ ...drift.dep, ledger: async options => {
    const page = await drift.dep.ledger({ ...options, expectedLedgerId: undefined });
    return options.limit > 1 ? { ...page, ledgerId: sha("e") } : page;
  } });
  assert.deepEqual(await checkReplayAdoptionCandidate(target, reader), { status: "held", reason: "ledger_page_binding_mismatch", adoptionAuthorized: false });
});
