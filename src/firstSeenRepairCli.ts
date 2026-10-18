#!/usr/bin/env node
import { lstat } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { CLOCK_AHEAD_TOLERANCE_MS } from "./collectionHealth.js";
import { CotFirstSeenStore, resolveCotFirstSeenHistoryPath } from "./cotFirstSeenHistory.js";
import { FirstSeenCollectionHeartbeatStore, resolveFirstSeenCollectionHeartbeatPath } from "./firstSeenCollectionHeartbeat.js";
import { lockWaitMilliseconds } from "./firstSeenStore.js";
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
import { StampedAheadInterrupted, stampedAheadLockState, type StampedAheadLockState, type StampedAheadPlan, type StampedAheadRepair, type StampedRecord } from "./stampedAheadRepair.js";

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
/** A kept record that needs a record that would be moved, or follows one moved for that, and the range to collect again to restore it. */
type Dependent = { why: string; collect_again: { from: string; to: string } };
/** Those records, and how many records each log keeps once they are moved too (with --recollect). */
type Dependents = { dependents: Dependent[]; keeps: number[] };
/** A store's logs, in the order their tails are moved, what else may cite their sequences, and what kept records need across its logs. */
type RepairTarget = { logs: AnyRepair[]; references: string[]; forceRequired: boolean; dependents?: (plans: AnyPlan[]) => Dependents };
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
      //
      // A kept record that needs a moved one goes too with --recollect (BACKLOG 103-11 review): collecting its range again
      // then records its content anew, bound by the checkpoints that collection writes, whatever bytes OANDA returns; kept,
      // it would stay bound to a page response that is gone. A log keeps only the records before the first one moved, so
      // the records after it go with it, each named; the checkpoints are moved only as their stamps say, since nothing
      // else in the logs is needed by a checkpoint.
      const dependents = ([runPlan, manifestPlan, checkpointPlan]: AnyPlan[]): Dependents => {
        type Run = StampedRecord & { normalized_sha256: string; requested_from: string; requested_to: string };
        type Record = StampedRecord & { normalized_sha256: string; raw_sha256: string[]; requested_from: string; requested_to: string; source_url_template: string; instrument: OandaFxInstrument };
        type Checkpoint = StampedRecord & { collection_key: string; requested_from: string; requested_to: string; raw_sha256: string };
        const out: Dependent[] = [];
        const range = (item: { requested_from: string; requested_to: string }) => ({ from: item.requested_from, to: item.requested_to });
        const records = manifestPlan.records as unknown as Record[], runs = runPlan.records as unknown as Run[], rows = checkpointPlan.records as unknown as Checkpoint[];
        const binding = (row: Checkpoint) => `${row.collection_key}|${row.requested_from}|${row.requested_to}|${row.raw_sha256}`;
        const keptBindings = new Set(rows.slice(0, checkpointPlan.keep).map(binding)), movedBindings = new Set(rows.slice(checkpointPlan.keep).map(binding));
        const lostPage = (record: Record) => {
          let key: string;
          try { key = fxHistoryCollectionKey(fxHistoryEnvironmentOf(record.source_url_template), record.instrument, record.requested_from, record.requested_to); } catch { return -1; }
          return oandaPageRanges(record.requested_from, record.requested_to).findIndex((page, index) => {
            const bound = `${key}|${page.requestFrom}|${page.requestTo}|${record.raw_sha256[index]}`;
            return movedBindings.has(bound) && !keptBindings.has(bound);
          });
        };
        let manifestKeep = manifestPlan.keep;
        for (const [index, record] of records.slice(0, manifestPlan.keep).entries()) {
          const lost = lostPage(record);
          if (lost < 0) continue;
          manifestKeep = index;
          out.push({ why: `FX history collection ${record.sequence} would lose the checkpoint that binds its page ${lost + 1}`, collect_again: range(record) });
          break;
        }
        for (const record of records.slice(manifestKeep + 1, manifestPlan.keep)) {
          out.push({ why: `FX history collection ${record.sequence} follows a collection moved with it (a log keeps only the records before the first moved)`, collect_again: range(record) });
        }
        const content = new Set(records.slice(0, manifestKeep).map((record) => record.normalized_sha256));
        let runKeep = runPlan.keep;
        for (const [index, run] of runs.slice(0, runPlan.keep).entries()) {
          if (content.has(run.normalized_sha256)) continue;
          runKeep = index;
          out.push({ why: `FX history run ${run.sequence} would name content only a moved manifest record holds`, collect_again: range(run) });
          break;
        }
        for (const run of runs.slice(runKeep + 1, runPlan.keep)) {
          out.push({ why: `FX history run ${run.sequence} follows a run moved with it (a log keeps only the records before the first moved)`, collect_again: range(run) });
        }
        return { dependents: out, keeps: [runKeep, manifestKeep, checkpointPlan.keep] };
      };
      return { logs: [asAny(runs), asAny(manifest), asAny(checkpoints)], forceRequired: true, dependents,
        references: ["collections[].sequence, runs[].sequence, parts[].sequences, manifest_records and run_records in FX history exports already written, which this command cannot find"] };
    }
  }
}

/** A refusal after the logs were read: the summary of what was found (and, for a repair stopped part-way, done) goes with it. */
export class FirstSeenRepairRefused extends Error { constructor(message: string, readonly summary: object) { super(message); } }

/**
 * A repair stopped by a signal at a step where it could stop (BACKLOG 103-11 review), its locks released: the summary
 * says what was done. The CLI prints it, then ends by the same signal.
 */
export class FirstSeenRepairInterrupted extends FirstSeenRepairRefused {
  constructor(message: string, summary: object, readonly signal: NodeJS.Signals) { super(message, summary); }
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * The longest pause between two sweeps over a store's locks, before jitter (BACKLOG 103-11 review): close to the
 * collectors' 25-75 ms, so that readers polling a log's lock in turn do not starve a repair that needs every lock at once.
 */
const LOCK_BACKOFF_CAP_MS = 150;

const lockNotes: Record<"gone" | "stale", (lock: StampedAheadLockState) => string> = {
  gone: (lock) => `it names process ${lock.pid}, which is gone: a run killed while it held the lock left it; remove it when no collector, server or repair is running`,
  stale: (lock) => `it names no process and is older than the ${Math.round((lock.staleMs ?? 0) / 1000)} s after which the store's own writer, and --apply, take such a lock over`,
};

const summaryOf = (plan: AnyPlan) => {
  const moved = plan.records.slice(plan.keep);
  const lock = plan.leftovers.staleLock;
  return { label: plan.label, path: plan.path, records: plan.records.length, kept: plan.keep,
    moved: moved.length === 0 ? null : { records: moved.length, first_sequence: moved[0].sequence, last_sequence: moved.at(-1)!.sequence,
      first_seen_from: moved[0].first_seen_at, first_seen_to: moved.at(-1)!.first_seen_at, next_sequence: moved[0].sequence },
    ...(plan.leftovers.temporaries.length || plan.leftovers.sidecars.length || lock ? { leftovers: {
      temporaries: plan.leftovers.temporaries, sidecars: plan.leftovers.sidecars,
      stale_lock: lock === null ? null : { path: lock.path, pid: lock.pid, note: lockNotes[lock.state as "gone" | "stale"](lock) } } } : {}),
    ...(plan.earlierSidecars.length > 0 ? { earlier_sidecars: plan.earlierSidecars } : {}) };
};

/**
 * The message for a busy lock (BACKLOG 103-11 review): one naming a process that is gone was left by a run killed while
 * it held it; one naming no process, younger than the store's own takeover age, has a holder that cannot be told, which
 * must not be removed while anything may run; otherwise its holder runs.
 */
function busyLock(log: AnyRepair, waitedMs: number): Error {
  const lock = stampedAheadLockState(log);
  const waited = `timed out after ${Math.round(waitedMs)} ms waiting for ${log.lockPath}`;
  if (lock?.state === "gone") {
    return new Error(`the lock ${log.lockPath} names process ${lock.pid}, which is gone: a run killed while it held the lock left it; `
      + "remove it if no collector, server or repair is running, then run the repair again; nothing was changed");
  }
  if (lock?.state === "unknown") {
    return new Error(`${waited}, which names no process, so whether its holder still runs cannot be told: do not remove it while a collector, the server or a repair may be running; `
      + `run the repair again later${lock.staleMs === null ? "" : ` (the store's own writer takes it over once it is ${Math.round(lock.staleMs / 1000)} s old)`}; nothing was changed`);
  }
  return new Error(`${waited}, which ${lock?.state === "held" ? `process ${lock.pid}` : "another process"} holds; run the repair again when no collector is running; nothing was changed`);
}

/**
 * tradingview-mcp-repair-first-seen (BACKLOG 103-11): a record stamped by a clock that ran ahead blocks every later
 * record of its first-seen log until the clock reaches its stamp, and setting the clock right does not clear it.
 *
 * By default this is a dry run: it reads each of the store's logs as the store reads it, with every check, taking no
 * lock (BACKLOG 103-11 review: it is read-only, so an interrupted dry run leaves nothing), and prints the tail of records
 * stamped more than CLOCK_AHEAD_TOLERANCE_MS (the health check's minute) past this machine's clock now, and what an
 * interrupted repair may have left (temporary files, sidecars whose records the log still holds, a lock whose holder is
 * gone or, by the store's own rule, stale), with earlier repairs' sidecars apart. A log that does not read may have been
 * read while a collector appended to it, so it says to run again.
 *
 * With --apply it takes every lock of the store's logs, never waiting on one while holding another: when one is busy it
 * releases all, backs off (LOCK_BACKOFF_CAP_MS, with jitter) and tries again, the busy one first, within the stores' lock
 * wait (TV_MCP_HISTORY_LOCK_WAIT_MS, 30 s), and says whose the lock is (busyLock). Holding them, it takes the time, reads
 * the logs again, and moves each tail, byte for byte, to a sidecar beside its log, `<log>.ahead-<now>.jsonl` (owner-only
 * 0600), rewriting the log without it, read back as its store reads it (applyStampedAhead); the next record takes the
 * first moved sequence. A sidecar a killed repair left that holds exactly the tail is used instead of a second copy, and
 * its temporary files are removed.
 *
 * SIGINT, SIGTERM and SIGHUP stop it at the next step where it can stop (BACKLOG 103-11 review): once a lock attempt in
 * flight settles (so that lock is released too), between attempts, once the logs are read, or between a log's writes,
 * removing what that log's repair wrote. Every lock is released, and it ends with FirstSeenRepairInterrupted, whose
 * summary says what was done; the CLI prints it before ending by the signal. A second signal releases the locks held and
 * ends at once, which can leave a lock being taken, named by the next run as a killed run's. A kill (SIGKILL) can leave
 * a sidecar, a temporary file and the locks; the next dry run reports them, and the next --apply uses the sidecar and
 * removes the temporary file once the locks are cleared.
 *
 * It refuses when nothing is stamped ahead, when a log does not read, when anything else is odd, without --force where
 * this package writes citations of the store's sequences into files it cannot find (repairTarget), and, for the FX
 * history, without --recollect where a kept record needs a record that would be moved (dependents: with --recollect
 * those records are moved too, and the summary's collect_again names the ranges to collect again). When a store's logs
 * are repaired one after another and a later one fails, it says which were rewritten, with their sidecars, and to run it
 * again. `clock` is the time source (a fixed Date for tests).
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
  const found = (plans: AnyPlan[]): Dependents => target.dependents?.(plans) ?? { dependents: [], keeps: plans.map((plan) => plan.keep) };
  const summarize = (at: Date, plans: AnyPlan[], { dependents, keeps }: Dependents) => {
    const ranges = [...new Map(dependents.map(({ collect_again: range }) => [`${range.from}|${range.to}`, range])).values()];
    return { store: args.store, ...(args.instrument ? { instrument: args.instrument } : {}), now: at.toISOString(), tolerance_ms: CLOCK_AHEAD_TOLERANCE_MS,
      applied: false as boolean | "partial", logs: plans.map(summaryOf) as Array<ReturnType<typeof summaryOf> & Record<string, unknown>>, references: target.references,
      force_required: target.forceRequired, ...(dependents.length > 0 ? { dependents, recollect_required: true,
        with_recollect: plans.map((plan, index) => ({ label: plan.label, kept: keeps[index], moved_records: plan.records.length - keeps[index] })), collect_again: ranges } : {}) };
  };
  const nothingAhead = (summary: { now: string }, plans: AnyPlan[]) => plans.every((plan) => plan.keep === plan.records.length)
    ? new FirstSeenRepairRefused(`nothing in the ${args.store} store is stamped more than ${CLOCK_AHEAD_TOLERANCE_MS / 1000} s after ${summary.now}; nothing was changed`, summary) : null;
  if (!args.apply) {
    const at = now();
    const plans = await planAll(at, true);
    const summary = summarize(at, plans, found(plans));
    const refusal = nothingAhead(summary, plans);
    if (refusal !== null) throw refusal;
    return summary;
  }

  // --apply: every lock held at once, never waiting on one while holding another; a signal acted on at the next step
  // where the run can stop, every lock then released.
  const held: { releaseSync(): void }[] = [];
  const releaseAll = () => { for (const hold of held.splice(0).reverse()) hold.releaseSync(); };
  let signalled: NodeJS.Signals | null = null;
  const stopListening = () => { for (const name of SIGNALS) process.removeListener(name, onSignal); };
  function onSignal(signal: NodeJS.Signals) {
    if (signalled === null) { signalled = signal; return; }
    // A second signal: every lock held is released, and the run ends at once.
    releaseAll();
    stopListening();
    if (process.listenerCount(signal) === 0) { try { process.kill(process.pid, signal); } catch { process.exit(1); } }
  }
  let summary: object = { store: args.store, ...(args.instrument ? { instrument: args.instrument } : {}), applied: false };
  const interrupted = (message: string) => new FirstSeenRepairInterrupted(message, summary, signalled!);
  const stopIfSignalled = (when: string) => {
    if (signalled !== null) throw interrupted(`the repair was interrupted by ${signalled} ${when}, and released every lock it took; nothing was changed`);
  };
  for (const name of SIGNALS) process.prependListener(name, onSignal);
  try {
    const started = performance.now(), deadline = started + lockWaitMilliseconds();
    let order = target.logs;
    for (let attempt = 0; ; attempt += 1) {
      let busy: AnyRepair | null = null;
      for (const log of order) {
        // A signal while an attempt is in flight is acted on once it settles, so the lock it may take is released too.
        const hold = await log.tryLock();
        if (hold !== null) held.push(hold);
        stopIfSignalled("while it took its locks");
        if (hold === null) { busy = log; break; }
      }
      if (busy === null) break;
      releaseAll();
      if (performance.now() >= deadline) throw busyLock(busy, performance.now() - started);
      // The busy lock first next time, so the others are held for as short a time as can be while it is tried.
      order = [busy, ...target.logs.filter((log) => log !== busy)];
      await sleep(Math.min(LOCK_BACKOFF_CAP_MS, 25 * 2 ** Math.min(attempt, 3)) * (0.5 + Math.random()));
      stopIfSignalled("while it waited for its locks");
    }
    // The time is taken once every lock is held, so a long wait does not judge the logs by a time before it (BACKLOG 103-11 review).
    const at = now();
    let plans = await planAll(at, false);
    const dependents = found(plans);
    summary = summarize(at, plans, dependents);
    stopIfSignalled("once it had read the logs");
    const refusal = nothingAhead(summary as { now: string }, plans);
    if (refusal !== null) throw refusal;
    if (dependents.dependents.length > 0) {
      if (!args.recollect) {
        throw new FirstSeenRepairRefused(`${dependents.dependents.map((item) => item.why).join("; ")}; run again with --recollect to move those records too, `
          + "then collect each range in the summary's collect_again again (the collector fetches what no checkpoint holds, checkpoints it and records the content anew); nothing was changed", summary);
      }
      plans = plans.map((plan, index) => ({ ...plan, keep: dependents.keeps[index] }));
      summary = summarize(at, plans, dependents);
    }
    const report = summary as ReturnType<typeof summarize>;
    if (target.forceRequired && !args.force) {
      const ranges = plans.filter((plan) => plan.keep < plan.records.length).map((plan) => { const moved = summaryOf(plan).moved!; return `${plan.label} ${moved.first_sequence}-${moved.last_sequence}`; }).join(", ");
      throw new FirstSeenRepairRefused(`the next records would take the moved sequences again (${ranges}), and these may cite a moved record: `
        + `${target.references[0]}; check them, then run again with --force; nothing was changed`, summary);
    }
    const rewritten: string[] = [];
    for (const [index, log] of target.logs.entries()) {
      if (plans[index].keep === plans[index].records.length) continue;
      try {
        if (signalled !== null) throw new StampedAheadInterrupted(`${log.label} repair was interrupted: nothing in ${log.path} was changed`);
        const done = await log.apply(plans[index], at, () => signalled !== null);
        rewritten.push(log.path);
        Object.assign(report.logs[index], { sidecar: done.sidecar, reused_sidecar: done.reused, records_after: done.kept, removed_temporaries: done.removedTemporaries });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (rewritten.length === 0) {
          if (signalled !== null) throw interrupted(`the repair was interrupted by ${signalled}: ${message}; it released every lock it took`);
          throw error;
        }
        report.applied = "partial";
        const done = report.logs.filter((item) => item.sidecar !== undefined).map((item) => `${item.path} (its records stamped ahead are in ${item.sidecar})`).join(", ");
        const text = `the repair stopped part-way${signalled === null ? "" : ` for ${signalled}`}: ${done} ${rewritten.length === 1 ? "was" : "were"} rewritten and read as `
          + `${rewritten.length === 1 ? "its store reads it" : "their stores read them"}, then ${message}; run the repair again to finish`;
        throw signalled === null ? new FirstSeenRepairRefused(text, summary) : interrupted(text);
      }
    }
    report.applied = true;
    const result = { ...report, sidecars: report.logs.map((item) => item.sidecar).filter((item): item is string => typeof item === "string") };
    if (signalled !== null) throw new FirstSeenRepairInterrupted(`the repair finished before it could stop for ${signalled}`, result, signalled);
    return result;
  } finally {
    releaseAll();
    stopListening();
  }
}

if (isCliEntrypoint(import.meta.url)) {
  runFirstSeenRepair(process.argv.slice(2)).then((summary) => process.stdout.write(`${JSON.stringify(summary)}\n`)).catch((error: unknown) => {
    if (error instanceof FirstSeenRepairRefused) process.stdout.write(`${JSON.stringify(error.summary)}\n`);
    const stopped = error instanceof FirstSeenRepairInterrupted;
    process.stderr.write(`first-seen repair ${stopped ? "stopped" : "refused"}: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    // Ended by the signal that stopped it once its output is out (BACKLOG 103-11 review), as an interrupted command ends.
    if (stopped) {
      process.stdout.write("", () => process.stderr.write("", () => { try { process.kill(process.pid, error.signal); } catch { process.exit(1); } }));
    }
  });
}
