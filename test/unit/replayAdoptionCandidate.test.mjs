import test from "node:test";
import assert from "node:assert/strict";
import { checkReplayAdoptionCandidate } from "../../build/replayAdoptionCandidate.js";

const target = {
  chartIndex: 1, studyId: "JkqPfk", pineId: "USER;replayfixture", pineVersion: "1.0",
  symbol: "OANDA:USDJPY", seriesId: "standard-candles:regular:USDJPY:5", timeframe: "5",
};
const openTimeMs = Date.parse("2026-11-23T23:55:00Z");
const endTimeMs = openTimeMs + 300_000;
const sha = letter => `sha256:${letter.repeat(64)}`;

function fixture({ snapshotId = "snapshot-1", total = 501 } = {}) {
  const revision = { appInstanceId: "app-1", replaySessionId: "replay-1", revision: 14 };
  const barUpdate = { seriesId: target.seriesId, openTimeMs, updateId: "confirmed-15" };
  const evidence = {
    binding: {
      liveRevision: { ...revision }, snapshotId, ledgerId: sha("a"),
      reportStateSha256: sha("b"), settingsSha256: sha("c"),
    },
    target: { ...target },
    replay: { paused: true, selectedTimeMs: endTimeMs - 1000, cursorTimeMs: endTimeMs - 1000 },
    bar: {
      update: { ...barUpdate }, endTimeMs, nativeBoundaryConfirmed: true,
      continuityConfirmed: true, finalUpdateConfirmed: true,
    },
    report: {
      endTimeMs: openTimeMs, calculatedFrom: { ...barUpdate }, calculationComplete: true,
      availableTrades: total, closedTrades: Math.max(0, total - 1),
    },
  };
  const calls = [];
  const pages = [];
  let live = { ...evidence.replay, settingsSha256: evidence.binding.settingsSha256 };
  const fx = {
    revision, evidence, calls, pages,
    mutateAndRestoreLiveState() {
      const original = live;
      live = { ...live, cursorTimeMs: live.cursorTimeMs + 300_000, settingsSha256: sha("d") };
      revision.revision++;
      live = original;
      revision.revision++;
    },
    reader: {
      async readLiveRevision(requested) {
        assert.deepEqual(requested, target);
        calls.push("revision");
        return { ...revision };
      },
      async readEvidence(requested, expected) {
        assert.deepEqual(requested, target);
        calls.push(expected ? "evidence_final" : "evidence_first");
        if (expected) assert.deepEqual(expected, evidence.binding);
        const copy = structuredClone(evidence);
        if (expected) fx.onFinal?.(copy);
        else fx.onFirst?.(copy);
        return copy;
      },
      async readLedgerPage(requested, { binding, offset, limit }) {
        assert.deepEqual(requested, target);
        assert.deepEqual(binding, evidence.binding);
        assert.equal(limit, 500);
        calls.push(`page_${offset}`);
        const end = Math.min(offset + limit, total);
        const page = {
          binding: structuredClone(binding), offset,
          nextOffset: end < total ? end : null, availableTrades: total,
          trades: Array.from({ length: end - offset }, (_, index) => ({
            reportIndex: offset + index, status: offset + index === total - 1 ? "open" : "closed",
          })),
        };
        fx.onPage?.(page);
        pages.push(page);
        return page;
      },
    },
  };
  return fx;
}

const run = fx => checkReplayAdoptionCandidate(target, fx.reader);
const expectHeld = async (fx, reason) => assert.deepEqual(await run(fx), {
  status: "held", reason, adoptionAuthorized: false,
});

test("Replay candidate requires stable live revision at every check in both read modes", async () => {
  for (const snapshotId of ["snapshot-1", null]) {
    const fx = fixture({ snapshotId });
    assert.deepEqual(await run(fx), { status: "candidate", adoptionAuthorized: false });
    assert.deepEqual(fx.calls, [
      "revision", "evidence_first", "revision", "page_0", "revision", "page_500", "revision",
      "evidence_final", "revision",
    ]);
  }
});

test("Replay candidate holds the whole read when a fixed snapshot stays identical but live state changes and returns", async () => {
  const fx = fixture();
  const original = structuredClone(fx.evidence);
  fx.onPage = () => fx.mutateAndRestoreLiveState();
  await expectHeld(fx, "live_revision_changed");
  assert.equal(fx.revision.revision, original.binding.liveRevision.revision + 2);
  assert.deepEqual(fx.evidence, original);
  assert.deepEqual(fx.pages[0].binding, original.binding);
  assert.deepEqual(fx.calls, ["revision", "evidence_first", "revision", "page_0", "revision"]);
});

test("Replay candidate checks live revision after obtaining evidence and after final readback", async () => {
  for (const stage of ["onFirst", "onFinal"]) {
    const fx = fixture();
    fx[stage] = () => fx.mutateAndRestoreLiveState();
    await expectHeld(fx, "live_revision_changed");
    assert.equal(fx.calls.at(-1), "revision");
    assert.equal(fx.pages.length, stage === "onFirst" ? 0 : 2);
  }
});

test("Replay candidate holds unavailable revision and reused numbers from a different execution", async () => {
  const missing = fixture();
  missing.reader.readLiveRevision = async () => undefined;
  await expectHeld(missing, "live_revision_unconfirmed");
  assert.equal(missing.pages.length, 0);
  for (const key of ["appInstanceId", "replaySessionId", "revision"]) {
    const fx = fixture();
    fx.onPage = () => { fx.revision[key] = key === "revision" ? 0 : "different"; };
    await expectHeld(fx, "live_revision_changed");
  }
  const missingMidRead = fixture();
  missingMidRead.onPage = () => { delete missingMidRead.revision.revision; };
  await expectHeld(missingMidRead, "live_revision_unconfirmed");
});

test("Replay candidate requires the exact final bar update and excludes the next bar boundary", async () => {
  for (const [change, reason] of [
    [e => { e.bar.finalUpdateConfirmed = false; }, "bar_final_update_unconfirmed"],
    [e => { e.report.calculationComplete = false; }, "report_final_update_unconfirmed"],
    [e => { e.report.calculatedFrom.updateId = "provisional-14"; }, "report_final_update_unconfirmed"],
    [e => { e.report.calculatedFrom.openTimeMs -= 300_000; }, "report_final_update_unconfirmed"],
    [e => { e.report.calculatedFrom.seriesId = "different"; }, "report_final_update_unconfirmed"],
    [e => { e.replay.selectedTimeMs = e.replay.cursorTimeMs = endTimeMs; }, "not_same_bar"],
    [e => { e.bar.endTimeMs -= 60_000; }, "bar_boundary_unconfirmed"],
    [e => { e.bar.continuityConfirmed = false; }, "bar_boundary_unconfirmed"],
    [e => { e.bar.nativeBoundaryConfirmed = false; }, "bar_boundary_unconfirmed"],
    [e => { e.replay.selectedTimeMs--; }, "replay_position_unconfirmed"],
    [e => { e.target.pineVersion = "2.0"; }, "target_changed"],
  ]) {
    const fx = fixture();
    change(fx.evidence);
    await expectHeld(fx, reason);
    assert.equal(fx.pages.length, 0);
  }
});

test("Replay candidate rejects mixed bindings, missing, duplicate and reordered rows, and incorrect totals", async () => {
  for (const [change, reason] of [
    [p => { p.binding.snapshotId = "snapshot-2"; }, "ledger_page_binding_mismatch"],
    [p => { p.binding.ledgerId = sha("e"); }, "ledger_page_binding_mismatch"],
    [p => { p.binding.settingsSha256 = sha("e"); }, "ledger_page_binding_mismatch"],
    [p => { p.binding.reportStateSha256 = sha("e"); }, "ledger_page_binding_mismatch"],
    [p => { p.binding.liveRevision.revision++; }, "ledger_page_binding_mismatch"],
    [p => { p.trades.pop(); }, "ledger_page_sequence_mismatch"],
    [p => { p.trades[1].reportIndex = p.trades[0].reportIndex; }, "ledger_page_sequence_mismatch"],
    [p => { [p.trades[1], p.trades[0]] = [p.trades[0], p.trades[1]]; }, "ledger_page_sequence_mismatch"],
    [p => { p.nextOffset += 1; }, "ledger_page_sequence_mismatch"],
    [p => { p.availableTrades += 1; }, "ledger_page_sequence_mismatch"],
    [p => { p.trades[0].status = "open"; }, "ledger_count_unconfirmed"],
  ]) {
    const fx = fixture();
    fx.onPage = page => { if (page.offset === 0) change(page); };
    await expectHeld(fx, reason);
    assert.equal(fx.calls.includes("evidence_final"), false);
  }
  const mixedLaterPage = fixture();
  mixedLaterPage.onPage = page => { if (page.offset === 500) page.binding.snapshotId = "snapshot-2"; };
  await expectHeld(mixedLaterPage, "ledger_page_binding_mismatch");
  assert.equal(mixedLaterPage.pages.length, 2);
});

test("Replay candidate checks final metrics, settings and computation binding, and holds read errors", async () => {
  for (const change of [
    e => { e.binding.reportStateSha256 = sha("d"); },
    e => { e.binding.settingsSha256 = sha("d"); },
    e => { e.report.calculatedFrom.updateId = "different"; },
  ]) {
    const fx = fixture();
    fx.onFinal = change;
    await expectHeld(fx, "evidence_changed_during_read");
  }
  const failed = fixture();
  failed.onPage = () => { throw new Error("simulated unavailable page"); };
  await expectHeld(failed, "evidence_read_failed");
  const empty = fixture({ total: 0 });
  assert.deepEqual(await run(empty), { status: "candidate", adoptionAuthorized: false });
  assert.equal(empty.pages.length, 1);
  assert.deepEqual(empty.pages[0].trades, []);
});
