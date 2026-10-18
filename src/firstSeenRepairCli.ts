#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { CLOCK_AHEAD_TOLERANCE_MS } from "./collectionHealth.js";
import { CotFirstSeenStore, resolveCotFirstSeenHistoryPath } from "./cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore, resolveFirstSeenCollectionHeartbeatPath } from "./firstSeenCollectionHeartbeat.js";
import type { FirstSeenRecordBase, StampedAheadPlan, StampedAheadRepair } from "./firstSeenStore.js";
import { FxHistoricalRunLog } from "./fxHistoryRunLog.js";
import { assertFxHistoryManifestBase, FxHistoricalCheckpointStore, FxHistoricalManifestStore, isOandaFxInstrument, OANDA_FX_INSTRUMENTS, type OandaFxInstrument } from "./oandaHistoricalFx.js";
import { PolicyRateCollectionHeartbeatStore, resolvePolicyRateCollectionHeartbeatPath } from "./policyRateCollectionHeartbeat.js";
import { PolicyRateFirstSeenStore, resolvePolicyRateHistoryPath } from "./policyRateHistory.js";
import { RealYieldFirstSeenStore, resolveRealYieldHistoryPath } from "./realYieldHistory.js";
import { ResearchCollectionHeartbeatStore, resolveResearchCollectionHeartbeatPath } from "./researchCollectionHeartbeat.js";

/**
 * The first-seen logs whose append refuses a record stamped before the latest (BACKLOG 102-36), so that a record stamped
 * by a clock that ran ahead blocks every later one until the clock reaches it, setting the clock right or not. The health
 * check reports the heartbeats' and the FX history run logs' as `<collector>_clock_ahead`.
 */
export const FIRST_SEEN_REPAIR_STORES = ["research-heartbeat", "policy-rate-heartbeat", "first-seen-heartbeat", "cot", "policy-rate", "real-yield", "fx-history"] as const;
export type FirstSeenRepairStore = (typeof FIRST_SEEN_REPAIR_STORES)[number];

export function parseFirstSeenRepairArguments(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { store: { type: "string" }, instrument: { type: "string" }, apply: { type: "boolean" }, force: { type: "boolean" } },
    strict: true, allowPositionals: false });
  const store = values.store;
  if (!FIRST_SEEN_REPAIR_STORES.includes(store as FirstSeenRepairStore)) throw new Error(`--store must be one of ${FIRST_SEEN_REPAIR_STORES.join(", ")}`);
  if (store === "fx-history" && !isOandaFxInstrument(values.instrument)) throw new Error(`--store fx-history needs --instrument, one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (store !== "fx-history" && values.instrument !== undefined) throw new Error("--instrument belongs to --store fx-history");
  if (values.force && !values.apply) throw new Error("--force goes only with --apply");
  return { store: store as FirstSeenRepairStore, ...(store === "fx-history" ? { instrument: values.instrument as OandaFxInstrument } : {}), apply: values.apply === true, force: values.force === true };
}

type AnyRepair = StampedAheadRepair<FirstSeenRecordBase>;
type AnyPlan = StampedAheadPlan<FirstSeenRecordBase>;
/** A store's logs, in the order their tails are moved, what else may cite their sequences, and checks across its logs. */
type RepairTarget = { logs: AnyRepair[]; references: string[]; forceRequired: boolean; across?: (plans: AnyPlan[]) => string | null };

/**
 * What else may cite a store's sequences, found by reading the code (BACKLOG 103-11). The next record appended to a
 * repaired log takes the first moved sequence again, so a citation of a moved record would then point at another one.
 * Where this package writes such citations into files this command cannot find, --apply needs --force: the real-yield
 * history_sequence in the evaluation logs `evaluate` writes (at a path it is given, with no default), and the sequences
 * and totals in FX history exports already written. Elsewhere sequences appear only in a command's or tool's output.
 */
function repairTarget(store: FirstSeenRepairStore, instrument?: OandaFxInstrument): RepairTarget {
  const heartbeat = "no store or evidence file of this package cites heartbeat sequences; a collector prints its run's heartbeat sequence only";
  switch (store) {
    case "research-heartbeat": return { logs: [new ResearchCollectionHeartbeatStore(resolveResearchCollectionHeartbeatPath()).stampedAheadRepair()], references: [heartbeat], forceRequired: false };
    case "policy-rate-heartbeat": return { logs: [new PolicyRateCollectionHeartbeatStore(resolvePolicyRateCollectionHeartbeatPath()).stampedAheadRepair()], references: [heartbeat], forceRequired: false };
    case "first-seen-heartbeat": return { logs: [new FirstSeenCollectionHeartbeatStore(resolveFirstSeenCollectionHeartbeatPath()).stampedAheadRepair()], references: [heartbeat], forceRequired: false };
    case "cot": return { logs: [new CotFirstSeenStore(resolveCotFirstSeenHistoryPath()).stampedAheadRepair()], forceRequired: false,
      references: ["no store or evidence file of this package cites COT first-seen sequences; COT responses carry a moved record's first-seen time as available_at"] };
    case "policy-rate": return { logs: [new PolicyRateFirstSeenStore(resolvePolicyRateHistoryPath()).stampedAheadRepair()], forceRequired: false,
      references: ["history_sequence in get_policy_rate_context and carry-panel responses, which this package returns but does not store"] };
    case "real-yield": return { logs: [new RealYieldFirstSeenStore(resolveRealYieldHistoryPath()).stampedAheadRepair()], forceRequired: true,
      references: ["evaluation_context.real_yield_10y.history_sequence in the evaluation logs `evaluate` writes, at the --log path it was given, which this command cannot find",
        "history_sequence in real-yield context responses, which this package returns but does not store"] };
    case "fx-history": {
      const runs = new FxHistoricalRunLog(undefined, instrument!).stampedAheadRepair();
      const manifest = new FxHistoricalManifestStore(undefined, instrument!).stampedAheadRepair();
      const checkpoints = new FxHistoricalCheckpointStore(undefined, instrument!).stampedAheadRepair();
      // A run's content is a manifest record (by normalized hash), and a record's final pages are bound by checkpoints (by
      // raw hash): a kept run or record must not lose what it names. Runs go first, then the manifest, then the
      // checkpoints, so a stop in between leaves nothing kept naming something moved.
      const across = ([runPlan, manifestPlan, checkpointPlan]: AnyPlan[]) => {
        const keptContent = new Set((manifestPlan.records.slice(0, manifestPlan.keep) as unknown as { normalized_sha256: string }[]).map((record) => record.normalized_sha256));
        const orphan = (runPlan.records.slice(0, runPlan.keep) as unknown as { sequence: number; normalized_sha256: string }[]).find((run) => !keptContent.has(run.normalized_sha256));
        if (orphan) return `FX history run ${orphan.sequence} would name content the manifest no longer holds`;
        const movedPages = new Set((checkpointPlan.records.slice(checkpointPlan.keep) as unknown as { raw_sha256: string }[]).map((row) => row.raw_sha256));
        const bound = (manifestPlan.records.slice(0, manifestPlan.keep) as unknown as { sequence: number; raw_sha256: string[] }[]).find((record) => record.raw_sha256.some((hash) => movedPages.has(hash)));
        if (bound) return `FX history collection ${bound.sequence} would lose a page checkpoint it may need`;
        return null;
      };
      return { logs: [runs, manifest, checkpoints] as unknown as AnyRepair[], forceRequired: true, across,
        references: ["collections[].sequence, runs[].sequence, parts[].sequences, manifest_records and run_records in FX history exports already written, which this command cannot find"] };
    }
  }
}

/** A refusal after the logs were read: the summary of what was found goes with it. */
export class FirstSeenRepairRefused extends Error { constructor(message: string, readonly summary: object) { super(message); } }

/** Runs `operation` holding every log's lock, in the order given: the stores' own queues and lock files, as their appends take them. */
const underLocks = <R>(logs: AnyRepair[], operation: () => Promise<R>): Promise<R> =>
  logs.length === 0 ? operation() : logs[0].serialize(() => underLocks(logs.slice(1), operation));

const summaryOf = (plan: AnyPlan) => {
  const moved = plan.records.slice(plan.keep);
  return { label: plan.label, path: plan.path, records: plan.records.length, kept: plan.keep,
    moved: moved.length === 0 ? null : { records: moved.length, first_sequence: moved[0].sequence, last_sequence: moved.at(-1)!.sequence,
      first_seen_from: moved[0].first_seen_at, first_seen_to: moved.at(-1)!.first_seen_at, next_sequence: moved[0].sequence } };
};

/**
 * tradingview-mcp-repair-first-seen (BACKLOG 103-11): a record stamped by a clock that ran ahead blocks every later
 * record of its first-seen log until the clock reaches its stamp, and setting the clock right does not clear it. Under
 * the store's own lock, this reads the log as the store reads it, with every check, and finds the tail of records
 * stamped more than CLOCK_AHEAD_TOLERANCE_MS (the health check's minute) past this machine's clock now. By default it
 * only prints what would be moved. With --apply it moves that tail, byte for byte, to a new sidecar beside the log,
 * `<log>.ahead-<now>.jsonl` (owner-only 0600), and rewrites the log without it, read back as the store reads it, so the
 * store accepts new records again; the next one takes the first moved sequence. It refuses when nothing is stamped
 * ahead, when the log does not read, when anything else is odd, and, without --force, where this package writes
 * citations of the store's sequences into files it cannot find (repairTarget). `--store fx-history` repairs one
 * instrument's run log, manifest and page checkpoints together, since a run stamped ahead stamped all three. Run it only
 * once the clock is right: what it moves is judged against the clock now.
 */
export async function runFirstSeenRepair(argv: string[], now = new Date()) {
  const args = parseFirstSeenRepairArguments(argv);
  if (args.store === "fx-history") await assertFxHistoryManifestBase();
  const target = repairTarget(args.store, args.instrument);
  // A store with no log has nothing to repair, and taking its lock would make its directory.
  const present = await Promise.all(target.logs.map((log) => lstat(log.path).then(() => true, () => false)));
  if (!present.includes(true)) throw new Error(`there is no ${target.logs[0].label} history at ${target.logs[0].path}; nothing was changed`);
  return underLocks(target.logs, async () => {
    const plans: AnyPlan[] = [];
    for (const log of target.logs) {
      try { plans.push(await log.plan(now, CLOCK_AHEAD_TOLERANCE_MS)); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(message.endsWith("nothing was changed") ? message : `${log.label} history ${log.path} does not read as the store reads it (${message}); nothing was changed`, { cause: error });
      }
    }
    const summary = { store: args.store, ...(args.instrument ? { instrument: args.instrument } : {}), now: now.toISOString(), tolerance_ms: CLOCK_AHEAD_TOLERANCE_MS,
      applied: false, logs: plans.map(summaryOf), references: target.references, force_required: target.forceRequired };
    const ahead = plans.filter((plan) => plan.keep < plan.records.length);
    if (ahead.length === 0) throw new FirstSeenRepairRefused(`nothing in the ${args.store} store is stamped more than ${CLOCK_AHEAD_TOLERANCE_MS / 1000} s after ${summary.now}; nothing was changed`, summary);
    const odd = target.across?.(plans) ?? null;
    if (odd !== null) throw new FirstSeenRepairRefused(`${odd}; settle it by hand; nothing was changed`, summary);
    if (!args.apply) return summary;
    if (target.forceRequired && !args.force) {
      const ranges = ahead.map((plan) => { const moved = summaryOf(plan).moved!; return `${plan.label} ${moved.first_sequence}-${moved.last_sequence}`; }).join(", ");
      throw new FirstSeenRepairRefused(`the next records would take the moved sequences again (${ranges}), and these may cite a moved record: `
        + `${target.references[0]}; check them, then run again with --force; nothing was changed`, summary);
    }
    const sidecars: string[] = [];
    for (const [index, log] of target.logs.entries()) {
      if (plans[index].keep === plans[index].records.length) continue;
      const done = await log.apply(plans[index], now);
      sidecars.push(done.sidecar);
      Object.assign(summary.logs[index], { sidecar: done.sidecar, records_after: done.kept });
    }
    return { ...summary, applied: true, sidecars };
  });
}

if (isCliEntrypoint(import.meta.url)) {
  runFirstSeenRepair(process.argv.slice(2)).then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`)).catch((error: unknown) => {
    if (error instanceof FirstSeenRepairRefused) process.stdout.write(`${JSON.stringify(error.summary)}\n`);
    process.stderr.write(`first-seen repair refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
