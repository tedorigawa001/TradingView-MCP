#!/usr/bin/env node
import { spawn } from "node:child_process";
import { collectionHealthNotification, evaluateCollectionHealth, type CollectionHealthResult, type CollectionHealthScope } from "./collectionHealth.js";
import { PolicyRateCollectionHeartbeatStore, resolvePolicyRateCollectionHeartbeatPath } from "./policyRateCollectionHeartbeat.js";
import { ResearchCollectionHeartbeatStore, resolveResearchCollectionHeartbeatPath } from "./researchCollectionHeartbeat.js";
import { FirstSeenCollectionHeartbeatStore, resolveFirstSeenCollectionHeartbeatPath } from "./firstSeenCollectionHeartbeat.js";
import { isCliEntrypoint } from "./cliEntrypoint.js";
import { fxDailyCoverage, FxHistoricalRunLog } from "./fxHistoryRunLog.js";
import { isOandaFxInstrument, OANDA_FX_INSTRUMENTS, type OandaFxInstrument } from "./oandaHistoricalFx.js";

const DEFAULT_MAX_POLICY_RATE_AGE_BUSINESS_DAYS = 0;
const DEFAULT_MAX_RESEARCH_AGE_HOURS = 2;

export type CollectionHealthCliArguments = {
  scope: CollectionHealthScope;
  maxPolicyRateAgeBusinessDays: number;
  maxResearchAgeHours: number;
  notify: boolean;
  /** The instruments the fx-history scope checks; required by that scope and refused by the others. */
  instruments?: OandaFxInstrument[];
};

function numericArgument(argv: string[], index: number, name: string): number {
  const raw = argv[index + 1];
  if (raw === undefined) throw new Error(`${name} requires a value`);
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
  return value;
}

export function parseCollectionHealthCliArguments(argv: string[]): CollectionHealthCliArguments {
  let scope: CollectionHealthScope = "all";
  let maxPolicyRateAgeBusinessDays = DEFAULT_MAX_POLICY_RATE_AGE_BUSINESS_DAYS;
  let maxResearchAgeHours = DEFAULT_MAX_RESEARCH_AGE_HOURS;
  let notify = false;
  const instruments: OandaFxInstrument[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--notify") notify = true;
    else if (argument === "--scope") {
      const value = argv[index + 1];
      if (value !== "all" && value !== "policy-rate" && value !== "first-seen" && value !== "research" && value !== "fx-history") {
        throw new Error("--scope must be all, policy-rate, first-seen, research, or fx-history");
      }
      scope = value;
      index += 1;
    }
    else if (argument === "--max-policy-rate-age-business-days") {
      maxPolicyRateAgeBusinessDays = numericArgument(argv, index, argument);
      if (!Number.isInteger(maxPolicyRateAgeBusinessDays)) throw new Error(`${argument} must be an integer`);
      index += 1;
    } else if (argument === "--max-research-age-hours") {
      maxResearchAgeHours = numericArgument(argv, index, argument);
      index += 1;
    } else if (argument === "--instrument") {
      const value = argv[index + 1];
      if (!isOandaFxInstrument(value)) throw new Error(`--instrument must be one of ${OANDA_FX_INSTRUMENTS.join(", ")}`);
      if (instruments.includes(value)) throw new Error("each --instrument may be named once");
      instruments.push(value);
      index += 1;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  if (scope === "fx-history" && !instruments.length) throw new Error("--scope fx-history needs at least one --instrument");
  if (scope !== "fx-history" && instruments.length) throw new Error("--instrument belongs to --scope fx-history");
  return { scope, maxPolicyRateAgeBusinessDays, maxResearchAgeHours, notify, ...(instruments.length ? { instruments } : {}) };
}

export async function sendMacNotification(message: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("--notify is supported only on macOS");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("/usr/bin/osascript", [
      "-e", "on run argv",
      "-e", "display notification (item 1 of argv) with title \"TradingView-MCP\"",
      "-e", "end run",
      message,
    ], { stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`osascript exited with status ${code ?? "unknown"}`)));
  });
}

export async function checkCollectionHealth(
  args: CollectionHealthCliArguments,
  now = new Date(),
): Promise<CollectionHealthResult> {
  const emptyPolicyRate = { latest_collected_at: null, latest_run_age_business_days: null };
  const emptyResearch = { latest_collected_at: null, latest_run_age_hours: null };
  const emptyFirstSeen = { latest_collected_at: null, latest_run_status: null, latest_expected_run_at: now.toISOString(), latest_run_meets_schedule: false };
  const policyRate = args.scope === "policy-rate" || args.scope === "all"
    ? await new PolicyRateCollectionHeartbeatStore(resolvePolicyRateCollectionHeartbeatPath()).coverage(now)
    : emptyPolicyRate;
  const research = args.scope === "research" || args.scope === "all"
    ? await new ResearchCollectionHeartbeatStore(resolveResearchCollectionHeartbeatPath()).coverage(now)
    : emptyResearch;
  const firstSeen = args.scope === "first-seen" || args.scope === "all"
    ? await new FirstSeenCollectionHeartbeatStore(resolveFirstSeenCollectionHeartbeatPath()).coverage(now)
    : emptyFirstSeen;
  const fxHistory = args.scope === "fx-history"
    ? await Promise.all((args.instruments ?? []).map(async (instrument) => ({ instrument, ...fxDailyCoverage(await new FxHistoricalRunLog(undefined, instrument).records(), now) })))
    : undefined;
  return evaluateCollectionHealth({
    scope: args.scope,
    checkedAt: now.toISOString(),
    maxPolicyRateAgeBusinessDays: args.maxPolicyRateAgeBusinessDays,
    maxResearchAgeHours: args.maxResearchAgeHours,
    policyRate: {
      latest_collected_at: policyRate.latest_collected_at,
      latest_run_age_business_days: policyRate.latest_run_age_business_days,
    },
    research: {
      latest_collected_at: research.latest_collected_at,
      latest_run_age_hours: research.latest_run_age_hours,
    },
    firstSeen: {
      latest_collected_at: firstSeen.latest_collected_at,
      latest_run_status: firstSeen.latest_run_status,
      latest_expected_run_at: firstSeen.latest_expected_run_at,
      latest_run_meets_schedule: firstSeen.latest_run_meets_schedule,
    },
    ...(fxHistory ? { fxHistory } : {}),
  });
}

type CollectionHealthCliDependencies = {
  checkHealth: typeof checkCollectionHealth;
  notify: (message: string) => Promise<void>;
  notificationsSupported: boolean;
  writeOutput: (message: string) => void;
  writeError: (message: string) => void;
};

export async function runCollectionHealthCli(
  argv: string[],
  dependencies: Partial<CollectionHealthCliDependencies> = {},
): Promise<number> {
  const deps: CollectionHealthCliDependencies = {
    checkHealth: checkCollectionHealth,
    notify: sendMacNotification,
    notificationsSupported: process.platform === "darwin",
    writeOutput: (message) => process.stdout.write(message),
    writeError: (message) => process.stderr.write(message),
    ...dependencies,
  };
  try {
    const args = parseCollectionHealthCliArguments(argv);
    const result = await deps.checkHealth(args);
    deps.writeOutput(`${JSON.stringify(result)}\n`);
    if (result.should_notify && args.notify && deps.notificationsSupported) await deps.notify(collectionHealthNotification(result));
    return result.status === "stale" ? 1 : 0;
  } catch (error) {
    deps.writeError(`collection health check failed: ${error instanceof Error ? error.message : String(error)}\n`);
    if (argv.includes("--notify") && deps.notificationsSupported) {
      try { await deps.notify("Collection health check failed. Inspect collection-health stderr log."); } catch { /* stderr already records the failure */ }
    }
    return 1;
  }
}

if (isCliEntrypoint(import.meta.url)) {
  process.exitCode = await runCollectionHealthCli(process.argv.slice(2));
}
