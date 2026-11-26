import { z } from "zod";

const MAX_TRADES = 100_000;
const PAGE_SIZE = 500;
const id = z.string().regex(/^[\w:;.-]{1,128}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const time = z.number().int().min(0).max(8_640_000_000_000_000);
const count = z.number().int().min(0).max(MAX_TRADES);

const targetSchema = z.strictObject({
  chartIndex: z.number().int().min(0),
  studyId: id,
  pineId: z.string().regex(/^USER;[\w]{8,64}$/),
  pineVersion: z.string().regex(/^[0-9]{1,6}(\.[0-9]{1,3})?$/),
  symbol: id,
  seriesId: id,
  timeframe: z.literal("5"),
});

const liveRevisionSchema = z.strictObject({
  appInstanceId: id,
  replaySessionId: id,
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
});

const bindingSchema = z.strictObject({
  liveRevision: liveRevisionSchema,
  snapshotId: id.nullable(),
  ledgerId: hash,
  reportStateSha256: hash,
  settingsSha256: hash,
});

const barUpdateSchema = z.strictObject({
  seriesId: id,
  openTimeMs: time,
  updateId: id,
});

const evidenceSchema = z.strictObject({
  binding: bindingSchema,
  target: targetSchema,
  replay: z.strictObject({ paused: z.boolean(), selectedTimeMs: time, cursorTimeMs: time }),
  bar: z.strictObject({
    update: barUpdateSchema,
    endTimeMs: time,
    nativeBoundaryConfirmed: z.boolean(),
    continuityConfirmed: z.boolean(),
    finalUpdateConfirmed: z.boolean(),
  }),
  report: z.strictObject({
    endTimeMs: time,
    calculatedFrom: barUpdateSchema,
    calculationComplete: z.boolean(),
    availableTrades: count,
    closedTrades: count,
  }),
});

const pageSchema = z.strictObject({
  binding: bindingSchema,
  offset: count,
  nextOffset: count.nullable(),
  availableTrades: count,
  trades: z.array(z.strictObject({
    reportIndex: count,
    status: z.enum(["closed", "open"]),
  })).max(PAGE_SIZE),
});

type ReplayCandidateTarget = Readonly<z.infer<typeof targetSchema>>;
type ReplayCandidateBinding = Readonly<z.infer<typeof bindingSchema>>;

/**
 * Stage A only. These are contracts for supplied evidence, not assertions
 * about TradingView's native API. A real reader must prove revision coverage,
 * non-reuse within an execution, and the reported final-update provenance in
 * Stage B. This module has no live reader or MCP entry point.
 */
export interface ReplayCandidateReader {
  readLiveRevision(target: ReplayCandidateTarget): Promise<unknown>;
  readEvidence(target: ReplayCandidateTarget, expected?: ReplayCandidateBinding): Promise<unknown>;
  readLedgerPage(
    target: ReplayCandidateTarget,
    request: { binding: ReplayCandidateBinding; offset: number; limit: number },
  ): Promise<unknown>;
}

const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

const held = (reason: string) => ({ status: "held" as const, reason, adoptionAuthorized: false as const });

/** Validate a complete read without returning performance, trades or any adoption authority. */
export async function checkReplayAdoptionCandidate(targetInput: unknown, reader: ReplayCandidateReader) {
  const parsedTarget = targetSchema.safeParse(targetInput);
  if (!parsedTarget.success) return held("target_unconfirmed");
  const target = Object.freeze(parsedTarget.data);

  const checkLiveRevision = async (initial: z.infer<typeof liveRevisionSchema>) => {
    const read = liveRevisionSchema.safeParse(await reader.readLiveRevision(target));
    if (!read.success) return "live_revision_unconfirmed";
    return equal(read.data, initial) ? null : "live_revision_changed";
  };

  try {
    const initial = liveRevisionSchema.safeParse(await reader.readLiveRevision(target));
    if (!initial.success) return held("live_revision_unconfirmed");

    const first = evidenceSchema.safeParse(await reader.readEvidence(target));
    const afterEvidence = await checkLiveRevision(initial.data);
    if (afterEvidence) return held(afterEvidence);
    if (!first.success) return held("report_evidence_unconfirmed");
    const { binding, replay, bar, report } = first.data;
    Object.freeze(binding.liveRevision);
    Object.freeze(binding);
    if (!equal(first.data.target, target)) return held("target_changed");
    if (!equal(binding.liveRevision, initial.data)) return held("live_revision_changed");
    if (!replay.paused || replay.selectedTimeMs !== replay.cursorTimeMs) return held("replay_position_unconfirmed");
    const open = bar.update.openTimeMs;
    if (!bar.nativeBoundaryConfirmed || !bar.continuityConfirmed || bar.endTimeMs - open !== 300_000) {
      return held("bar_boundary_unconfirmed");
    }
    if (report.endTimeMs !== open || bar.update.seriesId !== target.seriesId ||
        replay.cursorTimeMs < open || replay.cursorTimeMs >= bar.endTimeMs) return held("not_same_bar");
    if (!bar.finalUpdateConfirmed) return held("bar_final_update_unconfirmed");
    if (!report.calculationComplete || !equal(report.calculatedFrom, bar.update)) {
      return held("report_final_update_unconfirmed");
    }
    if (report.closedTrades > report.availableTrades) return held("ledger_count_unconfirmed");

    let offset = 0;
    let closedTrades = 0;
    // Even a zero-trade report must supply one bound, empty ledger page.
    do {
      const page = pageSchema.safeParse(await reader.readLedgerPage(target, { binding, offset, limit: PAGE_SIZE }));
      const afterPage = await checkLiveRevision(initial.data);
      if (afterPage) return held(afterPage);
      if (!page.success || !equal(page.data.binding, binding)) return held("ledger_page_binding_mismatch");
      const expectedLength = Math.min(PAGE_SIZE, report.availableTrades - offset);
      const next = offset + expectedLength;
      if (page.data.offset !== offset || page.data.availableTrades !== report.availableTrades ||
          page.data.trades.length !== expectedLength ||
          page.data.nextOffset !== (next < report.availableTrades ? next : null) ||
          page.data.trades.some((trade, index) => trade.reportIndex !== offset + index)) {
        return held("ledger_page_sequence_mismatch");
      }
      closedTrades += page.data.trades.filter(trade => trade.status === "closed").length;
      offset = next;
    } while (offset < report.availableTrades);
    if (closedTrades !== report.closedTrades) return held("ledger_count_unconfirmed");

    const final = evidenceSchema.safeParse(await reader.readEvidence(target, binding));
    const finalRevision = await checkLiveRevision(initial.data);
    if (finalRevision) return held(finalRevision);
    if (!final.success || !equal(final.data, first.data)) return held("evidence_changed_during_read");
    return { status: "candidate" as const, adoptionAuthorized: false as const };
  } catch {
    return held("evidence_read_failed");
  }
}
