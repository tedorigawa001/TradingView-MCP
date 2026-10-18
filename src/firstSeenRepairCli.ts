#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { CLOCK_AHEAD_TOLERANCE_MS } from "./collectionHealth.js";
import { CotFirstSeenStore, resolveCotFirstSeenHistoryPath } from "./cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore, resolveFirstSeenCollectionHeartbeatPath } from "./firstSeenCollectionHeartbeat.js";
import { lockWaitMilliseconds } from "./firstSeenStore.js";
import { lockOwnerSync } from "./fsDurability.js";
import { FuturesOpenInterestFirstSeenStore, resolveFuturesOpenInterestHistoryPath } from "./futuresOpenInterestHistory.js";
import { FxHistoricalRunLog } from "./fxHistoryRunLog.js";
import { MacroSurpriseEvidenceStore, resolveMacroSurpriseEvidencePath } from "./macroSurpriseEvidence.js";
import { assertFxHistoryManifestBase, FxHistoricalCheckpointStore, FxHistoricalManifestStore, fxHistoryCollectionKey, fxHistoryEnvironmentOf, isOandaFxInstrument,
  OANDA_FX_INSTRUMENTS, oandaPageRanges, type OandaFxInstrument } from "./oandaHistoricalFx.js";
import { PolicyRateCollectionHeartbeatStore, resolvePolicyRateCollectionHeartbeatPath } from "./policyRateCollectionHeartbeat.js";
import { PolicyRateFirstSeenStore, resolvePolicyRateHistoryPath } from "./policyRateHistory.js";
import { OfficialPolicyRateHistoryStore, resolvePolicyRateOfficialHistoryPath } from "./policyRateOfficialHistory.js";
import { RealYieldFirstSeenStore, resolveRealYieldHistoryPath } from "./realYieldHistory.js";
import { ResearchCollectionHeartbeatStore, resolveResearchCollectionHeartbeatPath } from "./researchCollectionHeartbeat.js";
import { StampedAheadInterrupted, type StampedAheadPlan, type StampedAheadRepair, type StampedRecord } from "./stampedAheadRepair.js";

/**
 * The first-seen logs whose append refuses a record stamped before the latest (BACKLOG 102-36), so that a record stamped
 * by a clock that ran ahead blocks every later one until the clock reaches it, setting the clock right or not. The health
 * check reports the heartbeats' and the FX history run logs' as `<collector>_clock_ahead`; a collector's run stamps its
 * data logs with the same clock (collectionHealth names them all). The research journals that refuse a backward stamp
 * (research trials, period usage, forward periods, forecast losses, risk backtests, backtest slices, realized covariance)
 * are not repaired here: README says how to settle them by hand.
 */
export const FIRST_SEEN_REPAIR_STORES = ["research-heartbeat", "policy-rate-heartbeat", "first-seen-heartbeat", "cot", "policy-rate", "real-yield",
  "futures-open-interest", "official-policy-rate", "macro-surprise", "fx-history"] as const;
export type FirstSeenRepairStore = (typeof FIRST_SEEN_REPAIR_STORES)[number];

export function parseFirstSeenRepairArguments(argv: string[]) {
  const { values } = parseArgs({ args: argv, options: { store: { type: "string" }, instrument: { type: "string" }, apply: { type: "boolean" }, force: { type: "boolean" },
    recollect: { type: "boolean" } }, strict: true, allowPositionals: false });
  const store = values.store;
  if (!FIRST_SEEN_REPAIR_STORES.includes(store as FirstSeenRepairStore)) throw new Error(`--store must be one of ${FIRST_SEEN_REPAIR_STORES.join(", ")}`);
  if (store === "fx-history" && !isOandaFxInstrument(values.instrument)) throw new Error(`--store fx-history needs --instrument, one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
  if (store !== "fx-history" && values.instrument !== undefined) throw new Error("--instrument belongs to --store fx-history");
  if (store !== "fx-history" && values.recollect) throw new Error("--recollect belongs to --store fx-history");
  if ((values.force || values.recollect) && !values.apply) throw new Error(`${values.force ? "--force" : "--recollect"} goes only with --apply`);
  return { store: store as FirstSeenRepairStore, ...(store === "fx-history" ? { instrument: values.instrument as OandaFxInstrument } : {}), apply: values.apply === true,
    force: values.force === true, recollect: values.recollect === true };
}

type AnyRepair = StampedAheadRepair<StampedRecord>;
type AnyPlan = StampedAheadPlan<StampedRecord>;
/** A kept record that needs a record that would be moved, and the range a collection run must fetch again to restore it. */
type Dependent = { why: string; collect_again: { from: string; to: string } };
/** A store's logs, in the order their tails are moved, what else may cite their sequences, and what kept records need across its logs. */
type RepairTarget = { logs: AnyRepair[]; references: string[]; forceRequired: boolean; dependents?: (plans: AnyPlan[]) => Dependent[] };
const asAny = <T extends StampedRecord>(repair: StampedAheadRepair<T>) => repair as unknown as AnyRepair;

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
    case "research-heartbeat": return { logs: [asAny(new ResearchCollectionHeartbeatStore(resolveResearchCollectionHeartbeatPath()).stampedAheadRepair())], references: [heartbeat], forceRequired: false };
    case "policy-rate-heartbeat": return { logs: [asAny(new PolicyRateCollectionHeartbeatStore(resolvePolicyRateCollectionHeartbeatPath()).stampedAheadRepair())], references: [heartbeat], forceRequired: false };
    case "first-seen-heartbeat": return { logs: [asAny(new FirstSeenCollectionHeartbeatStore(resolveFirstSeenCollectionHeartbeatPath()).stampedAheadRepair())], references: [heartbeat], forceRequired: false };
    case "cot": return { logs: [asAny(new CotFirstSeenStore(resolveCotFirstSeenHistoryPath()).stampedAheadRepair())], forceRequired: false,
      references: ["no store or evidence file of this package cites COT first-seen sequences; COT responses carry a moved record's first-seen time as available_at"] };
    case "policy-rate": return { logs: [asAny(new PolicyRateFirstSeenStore(resolvePolicyRateHistoryPath()).stampedAheadRepair())], forceRequired: false,
      references: ["history_sequence in get_policy_rate_context and carry-panel responses, which this package returns but does not store"] };
    case "real-yield": return { logs: [asAny(new RealYieldFirstSeenStore(resolveRealYieldHistoryPath()).stampedAheadRepair())], forceRequired: true,
      references: ["evaluation_context.real_yield_10y.history_sequence in the evaluation logs `evaluate` writes, at the --log path it was given, which this command cannot find",
        "history_sequence in real-yield context responses, which this package returns but does not store"] };
    case "futures-open-interest": return { logs: [asAny(new FuturesOpenInterestFirstSeenStore(resolveFuturesOpenInterestHistoryPath()).stampedAheadRepair())], forceRequired: false,
      references: ["no store or evidence file of this package cites futures open-interest sequences; responses carry the values known at a time, not sequences"] };
    case "official-policy-rate": {
      const official = new OfficialPolicyRateHistoryStore(resolvePolicyRateOfficialHistoryPath());
      // The history names a download by its raw hash, in the content-addressed archive this does not touch; the raw
      // snapshot log only records the downloads. History first, so a stop in between leaves no kept record newer than its snapshot.
      return { logs: [asAny(official.stampedAheadRepair()), asAny(official.rawSnapshotStampedAheadRepair())], forceRequired: false,
        references: ["history_sequence in exploratory policy-rate history responses, which this package returns but does not store"] };
    }
    case "macro-surprise": return { logs: [asAny(new MacroSurpriseEvidenceStore(resolveMacroSurpriseEvidencePath()).stampedAheadRepair())], forceRequired: false,
      references: ["no store or evidence file of this package cites macro-surprise sequences; eligible values carry first-seen times and raw hashes"] };
    case "fx-history": {
      const runs = new FxHistoricalRunLog(undefined, instrument!).stampedAheadRepair();
      const manifest = new FxHistoricalManifestStore(undefined, instrument!).stampedAheadRepair();
      const checkpoints = new FxHistoricalCheckpointStore(undefined, instrument!).stampedAheadRepair();
      // A run's content is a manifest record (by normalized hash), and a record's pages are bound by checkpoints under the
      // record's collection key, for each page's own range and raw hash, as the export binds them. Runs go first, then the
      // manifest, then the checkpoints, so a stop in between leaves nothing kept naming something moved.
      const dependents = ([runPlan, manifestPlan, checkpointPlan]: AnyPlan[]): Dependent[] => {
        type Run = StampedRecord & { normalized_sha256: string; requested_from: string; requested_to: string };
        type Record = StampedRecord & { normalized_sha256: string; raw_sha256: string[]; requested_from: string; requested_to: string; source_url_template: string; instrument: OandaFxInstrument };
        type Checkpoint = StampedRecord & { collection_key: string; requested_from: string; requested_to: string; raw_sha256: string };
        const out: Dependent[] = [];
        const kept = <T>(plan: AnyPlan) => plan.records.slice(0, plan.keep) as unknown as T[];
        const moved = <T>(plan: AnyPlan) => plan.records.slice(plan.keep) as unknown as T[];
        const content = new Set(kept<Record>(manifestPlan).map((record) => record.normalized_sha256));
        for (const run of kept<Run>(runPlan)) {
          if (!content.has(run.normalized_sha256)) out.push({ why: `FX history run ${run.sequence} would name content only a moved manifest record holds`, collect_again: { from: run.requested_from, to: run.requested_to } });
        }
        const binding = (row: Checkpoint) => `${row.collection_key}|${row.requested_from}|${row.requested_to}|${row.raw_sha256}`;
        const keptBindings = new Set(kept<Checkpoint>(checkpointPlan).map(binding)), movedBindings = new Set(moved<Checkpoint>(checkpointPlan).map(binding));
        for (const record of kept<Record>(manifestPlan)) {
          let key: string;
          try { key = fxHistoryCollectionKey(fxHistoryEnvironmentOf(record.source_url_template), record.instrument, record.requested_from, record.requested_to); } catch { continue; }
          const pages = oandaPageRanges(record.requested_from, record.requested_to);
          const lost = pages.findIndex((page, index) => { const bound = `${key}|${page.requestFrom}|${page.requestTo}|${record.raw_sha256[index]}`; return movedBindings.has(bound) && !keptBindings.has(bound); });
          if (lost >= 0) out.push({ why: `FX history collection ${record.sequence} would lose the checkpoint that binds its page ${lost + 1}`, collect_again: { from: record.requested_from, to: record.requested_to } });
        }
        return out;
      };
      return { logs: [asAny(runs), asAny(manifest), asAny(checkpoints)], forceRequired: true, dependents,
        references: ["collections[].sequence, runs[].sequence, parts[].sequences, manifest_records and run_records in FX history exports already written, which this command cannot find"] };
    }
  }
}

/** A refusal after the logs were read: the summary of what was found (and, for a repair stopped part-way, done) goes with it. */
export class FirstSeenRepairRefused extends Error { constructor(message: string, readonly summary: object) { super(message); } }

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const summaryOf = (plan: AnyPlan) => {
  const moved = plan.records.slice(plan.keep);
  return { label: plan.label, path: plan.path, records: plan.records.length, kept: plan.keep,
    moved: moved.length === 0 ? null : { records: moved.length, first_sequence: moved[0].sequence, last_sequence: moved.at(-1)!.sequence,
      first_seen_from: moved[0].first_seen_at, first_seen_to: moved.at(-1)!.first_seen_at, next_sequence: moved[0].sequence },
    ...(plan.leftovers.temporaries.length || plan.leftovers.sidecars.length || plan.leftovers.staleLock ? { leftovers: {
      temporaries: plan.leftovers.temporaries, sidecars: plan.leftovers.sidecars,
      stale_lock: plan.leftovers.staleLock === null ? null : { path: plan.leftovers.staleLock.path, pid: plan.leftovers.staleLock.pid,
        note: "a run killed while it held the lock left it: remove it when no collector, server or repair is running" } } } : {}) };
};

/** The message for a busy lock: one naming a process that is gone was left by a run killed while it held it (BACKLOG 103-11 review). */
function busyLock(log: AnyRepair, waitedMs: number): Error {
  const owner = lockOwnerSync(log.lockPath);
  if (owner !== null && !owner.alive) {
    return new Error(`the lock ${log.lockPath} names ${owner.pid === null ? "no process" : `process ${owner.pid}, which is gone`}: a run killed while it held the lock left it; `
      + "remove it if no collector, server or repair is running, then run the repair again; nothing was changed");
  }
  return new Error(`timed out after ${Math.round(waitedMs)} ms waiting for ${log.lockPath}, which another process holds; run the repair again when no collector is running; nothing was changed`);
}

/**
 * tradingview-mcp-repair-first-seen (BACKLOG 103-11): a record stamped by a clock that ran ahead blocks every later
 * record of its first-seen log until the clock reaches its stamp, and setting the clock right does not clear it.
 *
 * By default this is a dry run: it reads each of the store's logs as the store reads it, with every check, taking no
 * lock (BACKLOG 103-11 review: it is read-only, so an interrupted dry run leaves nothing), and prints the tail of records
 * stamped more than CLOCK_AHEAD_TOLERANCE_MS (the health check's minute) past this machine's clock now, and what an
 * interrupted repair may have left (temporary files, sidecars, a lock naming a process that is gone). A log that does
 * not read may have been read while a collector appended to it, so it says to run again.
 *
 * With --apply it takes every lock of the store's logs, never waiting on one while holding another: when one is busy it
 * releases all, backs off and tries again, within the stores' lock wait (TV_MCP_HISTORY_LOCK_WAIT_MS, 30 s), and names a
 * lock left by a killed run. Holding them, it takes the time, reads the logs again, and moves each tail, byte for byte,
 * to a sidecar beside its log, `<log>.ahead-<now>.jsonl` (owner-only 0600), rewriting the log without it, read back as
 * its store reads it (applyStampedAhead); the next record takes the first moved sequence. A sidecar a killed repair left
 * that holds exactly the tail is used instead of a second copy, and its temporary files are removed. SIGINT, SIGTERM and
 * SIGHUP release every lock it holds: at once while it waits, or, once it writes, after the current log's repair stops
 * at its next step, removing what it wrote; a second signal releases them at once. A kill (SIGKILL) can leave a sidecar,
 * a temporary file and the locks; the next dry run reports them, and the next --apply uses the sidecar and removes the
 * temporary file once the locks are cleared.
 *
 * It refuses when nothing is stamped ahead, when a log does not read, when anything else is odd, without --force where
 * this package writes citations of the store's sequences into files it cannot find (repairTarget), and, for the FX
 * history, without --recollect where a kept record needs a record that would be moved (dependents; the summary then names
 * the ranges to collect again). When a store's logs are repaired one after another and a later one fails, it says which
 * were rewritten, with their sidecars, and to run it again. `clock` is the time source (a fixed Date for tests).
 */
export async function runFirstSeenRepair(argv: string[], clock: Date | (() => Date) = () => new Date()) {
  const args = parseFirstSeenRepairArguments(argv);
  const now = () => (clock instanceof Date ? new Date(clock.getTime()) : clock());
  if (args.store === "fx-history") await assertFxHistoryManifestBase();
  const target = repairTarget(args.store, args.instrument);
  // A store with no log has nothing to repair, and taking its lock would make its directory.
  const present = await Promise.all(target.logs.map((log) => lstat(log.path).then(() => true, () => false)));
  if (!present.includes(true)) throw new Error(`there is no ${target.logs[0].label} history at ${target.logs[0].path}; nothing was changed`);
  const planAll = async (at: Date, unlocked: boolean) => {
    const plans: AnyPlan[] = [];
    for (const log of target.logs) {
      try { plans.push(await log.plan(at, CLOCK_AHEAD_TOLERANCE_MS)); } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/nothing in it was changed$/.test(message)) throw new Error(message, { cause: error });
        throw new Error(`${log.label} history ${log.path} does not read as the store reads it (${message})${unlocked ? "; if a collector was appending to it, run the repair again" : ""}; nothing in it was changed`, { cause: error });
      }
    }
    return plans;
  };
  const summarize = (at: Date, plans: AnyPlan[]) => {
    const dependents = target.dependents?.(plans) ?? [];
    return { store: args.store, ...(args.instrument ? { instrument: args.instrument } : {}), now: at.toISOString(), tolerance_ms: CLOCK_AHEAD_TOLERANCE_MS,
      applied: false as boolean | "partial", logs: plans.map(summaryOf) as Array<ReturnType<typeof summaryOf> & Record<string, unknown>>, references: target.references,
      force_required: target.forceRequired, ...(dependents.length > 0 ? { dependents, recollect_required: true } : {}) };
  };
  const nothingAhead = (summary: { now: string }, plans: AnyPlan[]) => plans.every((plan) => plan.keep === plan.records.length)
    ? new FirstSeenRepairRefused(`nothing in the ${args.store} store is stamped more than ${CLOCK_AHEAD_TOLERANCE_MS / 1000} s after ${summary.now}; nothing was changed`, summary) : null;
  if (!args.apply) {
    const at = now();
    const plans = await planAll(at, true);
    const summary = summarize(at, plans);
    const refusal = nothingAhead(summary, plans);
    if (refusal !== null) throw refusal;
    return summary;
  }

  // --apply: every lock held at once, never waiting on one while holding another; every one released on a signal.
  const held: { releaseSync(): void }[] = [];
  const releaseAll = () => { for (const hold of held.splice(0).reverse()) hold.releaseSync(); };
  let applying = false, signalled: NodeJS.Signals | null = null;
  const stopListening = () => { for (const name of SIGNALS) process.removeListener(name, onSignal); };
  const raise = (signal: NodeJS.Signals) => {
    stopListening();
    if (process.listenerCount(signal) === 0) { try { process.kill(process.pid, signal); } catch { process.exit(1); } }
  };
  function onSignal(signal: NodeJS.Signals) {
    // While a log is being written, its repair stops at its next step and removes what it wrote; a second signal, or one
    // while waiting, releases every lock at once.
    if (applying && signalled === null) { signalled = signal; return; }
    signalled ??= signal;
    releaseAll();
    raise(signal);
  }
  for (const name of SIGNALS) process.prependListener(name, onSignal);
  try {
    const started = performance.now(), deadline = started + lockWaitMilliseconds();
    for (let attempt = 0; ; attempt += 1) {
      let busy: AnyRepair | null = null;
      for (const log of target.logs) {
        const hold = await log.tryLock();
        if (hold === null) { busy = log; break; }
        held.push(hold);
      }
      if (busy === null) break;
      releaseAll();
      if (performance.now() >= deadline) throw busyLock(busy, performance.now() - started);
      await sleep(Math.min(400, 25 * 2 ** Math.min(attempt, 4)) * (0.5 + Math.random()));
    }
    // The time is taken once every lock is held, so a long wait does not judge the logs by a time before it (BACKLOG 103-11 review).
    const at = now();
    const plans = await planAll(at, false);
    const summary = summarize(at, plans);
    const refusal = nothingAhead(summary, plans);
    if (refusal !== null) throw refusal;
    const dependents = "dependents" in summary ? summary.dependents ?? [] : [];
    if (dependents.length > 0 && !args.recollect) {
      throw new FirstSeenRepairRefused(`${dependents.map((item) => item.why).join("; ")}; run again with --recollect to move the records stamped ahead anyway, `
        + "then collect each range in the summary's dependents again (the collector fetches those pages again, checkpoints them and records their content); nothing was changed", summary);
    }
    if (target.forceRequired && !args.force) {
      const ranges = plans.filter((plan) => plan.keep < plan.records.length).map((plan) => { const moved = summaryOf(plan).moved!; return `${plan.label} ${moved.first_sequence}-${moved.last_sequence}`; }).join(", ");
      throw new FirstSeenRepairRefused(`the next records would take the moved sequences again (${ranges}), and these may cite a moved record: `
        + `${target.references[0]}; check them, then run again with --force; nothing was changed`, summary);
    }
    applying = true;
    const rewritten: string[] = [];
    for (const [index, log] of target.logs.entries()) {
      if (plans[index].keep === plans[index].records.length) continue;
      try {
        if (signalled !== null) throw new StampedAheadInterrupted(`${log.label} repair was interrupted: nothing in ${log.path} was changed`);
        const done = await log.apply(plans[index], at, () => signalled !== null);
        rewritten.push(log.path);
        Object.assign(summary.logs[index], { sidecar: done.sidecar, reused_sidecar: done.reused, records_after: done.kept, removed_temporaries: done.removedTemporaries });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (rewritten.length === 0) throw error;
        summary.applied = "partial";
        const done = summary.logs.filter((item) => item.sidecar !== undefined).map((item) => `${item.path} (its records stamped ahead are in ${item.sidecar})`).join(", ");
        throw new FirstSeenRepairRefused(`the repair stopped part-way: ${done} ${rewritten.length === 1 ? "was" : "were"} rewritten and read as ${rewritten.length === 1 ? "its store reads it" : "their stores read them"}, `
          + `then ${message}; run the repair again to finish`, summary);
      }
    }
    summary.applied = true;
    return { ...summary, sidecars: summary.logs.map((item) => item.sidecar).filter((item): item is string => typeof item === "string") };
  } finally {
    applying = false;
    releaseAll();
    stopListening();
    if (signalled !== null) raise(signalled);
  }
}

if (isCliEntrypoint(import.meta.url)) {
  runFirstSeenRepair(process.argv.slice(2)).then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`)).catch((error: unknown) => {
    if (error instanceof FirstSeenRepairRefused) process.stdout.write(`${JSON.stringify(error.summary)}\n`);
    process.stderr.write(`first-seen repair refused: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
