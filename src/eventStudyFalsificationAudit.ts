import {
  runFalsificationAudit,
  runPairedFalsificationAudit,
  type FalsificationAuditInput,
  type FalsificationAuditResult,
} from "./falsificationAudit.js";
import { runFvgRetestStudy, type FvgRetestStudyInput } from "./fvgRetestStudy.js";
import { runEventAftershockRetestStudy, type EventAftershockRetestStudyInput } from "./eventAftershockRetestStudy.js";
import { runFailedBreakoutStudy, type FailedBreakoutStudyInput } from "./failedBreakoutStudy.js";
import { runSessionExhaustionHandoffStudy, type SessionHandoffStudyInput } from "./sessionHandoffStudy.js";
import { runCompositeConditionStudy, type CompositeConditionStudyInput } from "./compositeConditionStudy.js";
import { runYieldPriceNonconfirmationStudy, type YieldPriceNonconfirmationInput } from "./yieldPriceNonconfirmation.js";
import {
  runSessionAuctionStudy,
  timeframeMinutes,
  type SessionAuctionStudyInput,
} from "./sessionAuctionStudy.js";
import type { SyntheticNullModel } from "./syntheticNullSeries.js";
import type { OhlcvBar } from "./tradingview.js";

const STANDARD_MODELS: SyntheticNullModel[] = ["white_noise", "regime_switching_volatility", "bid_ask_bounce"];
export const EVENT_STUDY_FALSIFICATION_STANDARD = {
  replications: 400,
  bars: 5_000,
  nominalAlpha: 0.05,
  folds: 3,
  models: STANDARD_MODELS,
} as const;

type AuditSettings = Pick<FalsificationAuditInput<unknown>,
  "replications" | "firstSeed" | "bars" | "timeframeMinutes" | "volatility" | "nominalAlpha"> & {
  model: SyntheticNullModel;
};

type EventStudyBranch = {
  events: number;
  horizons: Record<string, {
    availableEvents: number;
    directionalReturn: {
      mean: number | null;
      meanConfidenceInterval?: {
        status: "available" | "insufficient_sample";
        lower: number | null;
      };
    };
  }>;
};

/** The shared subset returned by event studies that is relevant to a candidate decision. */
export interface EventStudyAuditResultShape {
  status: "complete" | "partial";
  byBranch: Record<string, EventStudyBranch>;
  folds: Array<{ byBranch: Record<string, EventStudyBranch> }>;
}

/**
 * A candidate is deliberately stricter than a positive mean. The global interval must exclude
 * zero and every predeclared fold needs enough events with the same direction. Fold means do not
 * carry intervals by contract, so they are corroboration only, never the primary evidence.
 */
export interface EventStudyCandidateRule {
  branch: string;
  horizon: number;
  minimumEvents: number;
  minimumFoldEvents: number;
  folds: number;
}

export interface EventStudyFalsificationAuditResult {
  schemaVersion: "1.0";
  study: "fvg_retest" | "session_auction" | "event_aftershock_retest" | "failed_breakout" | "session_exhaustion_handoff" | "composite_condition" | "yield_price_nonconfirmation";
  candidateRule: EventStudyCandidateRule & {
    globalEvidence: "positive_mean_confidence_interval_excludes_zero";
    foldEvidence: "every_predeclared_fold_has_positive_mean";
  };
  audit: FalsificationAuditResult;
  syntheticEventSchedule?: EventAftershockSyntheticEventSchedule;
}

type FvgStudyDefinition = Omit<FvgRetestStudyInput, "bars" | "folds">;
type SessionAuctionStudyDefinition = Omit<SessionAuctionStudyInput, "bars" | "folds">;
type EventAftershockStudyDefinition = Omit<EventAftershockRetestStudyInput, "bars" | "folds" | "events">;
type FailedBreakoutStudyDefinition = Omit<FailedBreakoutStudyInput, "bars" | "folds">;
type SessionHandoffStudyDefinition = Omit<SessionHandoffStudyInput, "bars" | "folds">;
type CompositeConditionStudyDefinition = Omit<CompositeConditionStudyInput, "bars" | "folds">;
type YieldPriceNonconfirmationStudyDefinition = Omit<YieldPriceNonconfirmationInput, "targetBars" | "driverBars" | "folds" | "contextRegime" | "contextIndicator">;

export interface FvgRetestFalsificationAuditInput {
  audit: AuditSettings;
  study: FvgStudyDefinition;
  candidate: EventStudyCandidateRule;
}

export interface SessionAuctionFalsificationAuditInput {
  audit: AuditSettings;
  study: SessionAuctionStudyDefinition;
  candidate: EventStudyCandidateRule;
}

/** Exogenous event timing for a null audit, expressed relative to each generated series. */
export interface EventAftershockSyntheticEventSchedule {
  firstBar: number;
  everyBars: number;
  maximumEvents: number;
}

export interface EventAftershockFalsificationAuditInput {
  audit: AuditSettings;
  study: EventAftershockStudyDefinition;
  candidate: EventStudyCandidateRule;
  eventSchedule: EventAftershockSyntheticEventSchedule;
}

export interface FailedBreakoutFalsificationAuditInput { audit: AuditSettings; study: FailedBreakoutStudyDefinition; candidate: EventStudyCandidateRule; }
export interface SessionHandoffFalsificationAuditInput { audit: AuditSettings; study: SessionHandoffStudyDefinition; candidate: EventStudyCandidateRule; }
export interface CompositeConditionFalsificationAuditInput { audit: AuditSettings; study: CompositeConditionStudyDefinition; candidate: EventStudyCandidateRule; }
export interface YieldPriceNonconfirmationFalsificationAuditInput {
  audit: AuditSettings;
  study: YieldPriceNonconfirmationStudyDefinition;
  candidate: EventStudyCandidateRule;
  rho?: number;
}

export type StandardEventStudyDefinition =
  | { type: "fvg_retest"; definition: FvgStudyDefinition }
  | { type: "session_auction"; definition: SessionAuctionStudyDefinition }
  | { type: "event_aftershock_retest"; definition: EventAftershockStudyDefinition; eventSchedule: EventAftershockSyntheticEventSchedule }
  | { type: "failed_breakout"; definition: FailedBreakoutStudyDefinition }
  | { type: "session_exhaustion_handoff"; definition: SessionHandoffStudyDefinition }
  | { type: "composite_condition"; definition: CompositeConditionStudyDefinition }
  | { type: "yield_price_nonconfirmation"; definition: YieldPriceNonconfirmationStudyDefinition; rho?: number };

export interface StandardEventStudyFalsificationAuditInput {
  study: StandardEventStudyDefinition;
  candidate: Omit<EventStudyCandidateRule, "folds"> & { folds?: number };
  models?: SyntheticNullModel[];
  replications?: number;
  firstSeed?: number;
  bars?: number;
  volatility?: number;
  nominalAlpha?: number;
}

export interface StandardEventStudyFalsificationAuditResult {
  schemaVersion: "1.0";
  methodologyVersion: "event_study_falsification_audit_standard_v1";
  standard: {
    replications: number;
    bars: number;
    nominalAlpha: number;
    folds: number;
    models: Array<SyntheticNullModel | "factor_null_pair">;
  };
  study: StandardEventStudyDefinition["type"];
  runs: EventStudyFalsificationAuditResult[];
  limitations: string[];
}

function validateRule(
  rule: EventStudyCandidateRule,
  study: { horizons: number[]; minimumEvents: number; timeframe: string },
  audit: AuditSettings,
) {
  if (!Number.isInteger(rule.horizon) || !study.horizons.includes(rule.horizon)) {
    throw new Error("event-study falsification candidate horizon must be one of the study horizons");
  }
  if (!Number.isInteger(rule.minimumEvents) || rule.minimumEvents < 2) {
    throw new Error("event-study falsification candidate minimum events must be at least two for a confidence interval");
  }
  if (rule.minimumEvents !== study.minimumEvents) {
    throw new Error("event-study falsification candidate minimum events must match the study minimum events");
  }
  if (!Number.isInteger(rule.minimumFoldEvents) || rule.minimumFoldEvents < 1) {
    throw new Error("event-study falsification candidate minimum fold events must be a positive integer");
  }
  if (!Number.isInteger(rule.folds) || rule.folds < 2 || rule.folds > 12) {
    throw new Error("event-study falsification candidate folds must be an integer from 2 to 12");
  }
  if (!Number.isInteger(audit.timeframeMinutes) || timeframeMinutes(study.timeframe) !== audit.timeframeMinutes) {
    throw new Error("event-study falsification audit timeframe minutes must match the study timeframe");
  }
}

function syntheticFolds(bars: OhlcvBar[], folds: number, timeframeMs: number) {
  if (bars.length < folds) throw new Error("synthetic audit bars must cover every requested fold");
  const start = bars[0].time * 1000;
  const end = bars.at(-1)!.time * 1000 + timeframeMs;
  return Array.from({ length: folds }, (_, index) => {
    const from = start + Math.floor((end - start) * index / folds);
    const to = index === folds - 1 ? end : start + Math.floor((end - start) * (index + 1) / folds);
    return {
      foldId: `synthetic_${index + 1}`,
      from: new Date(from).toISOString(),
      to: new Date(to).toISOString(),
    };
  });
}

export function isEventStudyCandidate(result: EventStudyAuditResultShape, rule: EventStudyCandidateRule): boolean {
  if (result.status !== "complete") return false;
  const global = result.byBranch[rule.branch]?.horizons[String(rule.horizon)];
  if (global === undefined || global.availableEvents < rule.minimumEvents) return false;
  const interval = global.directionalReturn.meanConfidenceInterval;
  if (interval?.status !== "available" || interval.lower === null || interval.lower <= 0) return false;
  return result.folds.length === rule.folds && result.folds.every((fold) => {
    const outcome = fold.byBranch[rule.branch]?.horizons[String(rule.horizon)];
    return outcome !== undefined && outcome.availableEvents >= rule.minimumFoldEvents &&
      outcome.directionalReturn.mean !== null && outcome.directionalReturn.mean > 0;
  });
}

function evaluateEventStudyCandidate(result: EventStudyAuditResultShape, rule: EventStudyCandidateRule) {
  // `partial` means the frozen research contract was not fully evaluable on this generated draw.
  // Counting it as a rejection would bias the null candidate rate downward whenever signals are sparse.
  if (result.status !== "complete") return "not_evaluable" as const;
  return isEventStudyCandidate(result, rule) ? "candidate" as const : "non_candidate" as const;
}

function runEventStudyFalsificationAudit<TResult extends EventStudyAuditResultShape>(
  study: EventStudyFalsificationAuditResult["study"],
  audit: AuditSettings,
  candidate: EventStudyCandidateRule,
  runStudy: (bars: OhlcvBar[]) => TResult,
): EventStudyFalsificationAuditResult {
  return {
    schemaVersion: "1.0",
    study,
    candidateRule: {
      ...candidate,
      globalEvidence: "positive_mean_confidence_interval_excludes_zero",
      foldEvidence: "every_predeclared_fold_has_positive_mean",
    },
    audit: runFalsificationAudit({
      ...audit,
      runStudy,
      isCandidate: (result) => isEventStudyCandidate(result, candidate),
      evaluate: (result) => evaluateEventStudyCandidate(result, candidate),
    }),
  };
}

/** Runs the frozen FVG decision path against deterministic, predictability-free OHLC replicas. */
export function runFvgRetestFalsificationAudit(input: FvgRetestFalsificationAuditInput): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return runEventStudyFalsificationAudit("fvg_retest", input.audit, input.candidate, (bars) =>
    runFvgRetestStudy({ ...input.study, bars, folds: syntheticFolds(bars, input.candidate.folds, stepMs) }));
}

/** Runs the frozen session-auction decision path against deterministic, predictability-free OHLC replicas. */
export function runSessionAuctionFalsificationAudit(input: SessionAuctionFalsificationAuditInput): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return runEventStudyFalsificationAudit("session_auction", input.audit, input.candidate, (bars) =>
    runSessionAuctionStudy({ ...input.study, bars, folds: syntheticFolds(bars, input.candidate.folds, stepMs) }));
}

function validateEventSchedule(schedule: EventAftershockSyntheticEventSchedule) {
  if (!Number.isInteger(schedule.firstBar) || schedule.firstBar < 0 || schedule.firstBar > 50_000) {
    throw new Error("event-aftershock falsification first event bar must be an integer from 0 to 50000");
  }
  if (!Number.isInteger(schedule.everyBars) || schedule.everyBars < 1 || schedule.everyBars > 50_000) {
    throw new Error("event-aftershock falsification event spacing must be an integer from 1 to 50000");
  }
  if (!Number.isInteger(schedule.maximumEvents) || schedule.maximumEvents < 1 || schedule.maximumEvents > 200) {
    throw new Error("event-aftershock falsification maximum events must be an integer from 1 to 200");
  }
}

function syntheticAftershockEvents(bars: OhlcvBar[], schedule: EventAftershockSyntheticEventSchedule) {
  validateEventSchedule(schedule);
  const events: Array<{ eventId: string; occurredAt: string }> = [];
  for (let index = schedule.firstBar; index < bars.length && events.length < schedule.maximumEvents; index += schedule.everyBars) {
    events.push({ eventId: `synthetic_event_${index}`, occurredAt: bars[index].timeIso });
  }
  if (events.length === 0) throw new Error("event-aftershock falsification schedule produces no event inside the synthetic series");
  return events;
}

/** Runs the frozen aftershock decision path against deterministic null OHLC and a declared exogenous event schedule. */
export function runEventAftershockFalsificationAudit(
  input: EventAftershockFalsificationAuditInput,
): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  validateEventSchedule(input.eventSchedule);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  const result = runEventStudyFalsificationAudit("event_aftershock_retest", input.audit, input.candidate, (bars) =>
    runEventAftershockRetestStudy({
      ...input.study, bars, events: syntheticAftershockEvents(bars, input.eventSchedule),
      folds: syntheticFolds(bars, input.candidate.folds, stepMs),
    }));
  return { ...result, syntheticEventSchedule: input.eventSchedule };
}

export function runFailedBreakoutFalsificationAudit(input: FailedBreakoutFalsificationAuditInput): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return runEventStudyFalsificationAudit("failed_breakout", input.audit, input.candidate, (bars) =>
    runFailedBreakoutStudy({ ...input.study, bars, folds: syntheticFolds(bars, input.candidate.folds, stepMs) }));
}

export function runSessionHandoffFalsificationAudit(input: SessionHandoffFalsificationAuditInput): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return runEventStudyFalsificationAudit("session_exhaustion_handoff", input.audit, input.candidate, (bars) =>
    runSessionExhaustionHandoffStudy({ ...input.study, bars, folds: syntheticFolds(bars, input.candidate.folds, stepMs) }));
}

export function runCompositeConditionFalsificationAudit(input: CompositeConditionFalsificationAuditInput): EventStudyFalsificationAuditResult {
  validateRule(input.candidate, input.study, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return runEventStudyFalsificationAudit("composite_condition", input.audit, input.candidate, (bars) =>
    runCompositeConditionStudy({ ...input.study, bars, folds: syntheticFolds(bars, input.candidate.folds, stepMs) }));
}

/** Pair audit keeps contemporaneous correlation but contains no lagged driver-to-target predictability. */
export function runYieldPriceNonconfirmationFalsificationAudit(
  input: YieldPriceNonconfirmationFalsificationAuditInput,
): EventStudyFalsificationAuditResult {
  if (input.study.targetTimeframe !== input.study.driverTimeframe) {
    throw new Error("yield-price falsification requires equal target and driver timeframes");
  }
  validateRule(input.candidate, { ...input.study, timeframe: input.study.targetTimeframe }, input.audit);
  const stepMs = input.audit.timeframeMinutes * 60_000;
  return {
    schemaVersion: "1.0",
    study: "yield_price_nonconfirmation",
    candidateRule: { ...input.candidate, globalEvidence: "positive_mean_confidence_interval_excludes_zero", foldEvidence: "every_predeclared_fold_has_positive_mean" },
    audit: runPairedFalsificationAudit({
      ...input.audit,
      rho: input.rho,
      runStudy: (targetBars, driverBars) => runYieldPriceNonconfirmationStudy({
        ...input.study, targetBars, driverBars, contextRegime: null, contextIndicator: null,
        folds: syntheticFolds(targetBars, input.candidate.folds, stepMs),
      }),
      isCandidate: (result) => isEventStudyCandidate(result, input.candidate),
    }),
  };
}

/**
 * The repeatable default used for real calibration runs. Models remain separate runs: their rates
 * describe different null assumptions and must never be pooled into one apparently precise rate.
 */
export function runStandardEventStudyFalsificationAudit(
  input: StandardEventStudyFalsificationAuditInput,
): StandardEventStudyFalsificationAuditResult {
  const study = input.study;
  const models = input.models ?? [...EVENT_STUDY_FALSIFICATION_STANDARD.models];
  if (models.length < 1 || models.length > STANDARD_MODELS.length || new Set(models).size !== models.length ||
      models.some((model) => !STANDARD_MODELS.includes(model))) {
    throw new Error("event-study falsification models must be a non-empty unique subset of the standard null models");
  }
  const candidate: EventStudyCandidateRule = {
    ...input.candidate,
    folds: input.candidate.folds ?? EVENT_STUDY_FALSIFICATION_STANDARD.folds,
  };
  const audit = {
    replications: input.replications ?? EVENT_STUDY_FALSIFICATION_STANDARD.replications,
    ...(input.firstSeed === undefined ? {} : { firstSeed: input.firstSeed }),
    bars: input.bars ?? EVENT_STUDY_FALSIFICATION_STANDARD.bars,
    timeframeMinutes: timeframeMinutes(study.type === "yield_price_nonconfirmation"
      ? study.definition.targetTimeframe : study.definition.timeframe),
    ...(input.volatility === undefined ? {} : { volatility: input.volatility }),
    nominalAlpha: input.nominalAlpha ?? EVENT_STUDY_FALSIFICATION_STANDARD.nominalAlpha,
  };
  let runs: EventStudyFalsificationAuditResult[];
  switch (study.type) {
    case "yield_price_nonconfirmation":
      runs = [runYieldPriceNonconfirmationFalsificationAudit({ audit: { ...audit, model: "white_noise" }, study: study.definition,
        candidate, rho: study.rho })];
      break;
    case "fvg_retest":
      runs = models.map((model) => runFvgRetestFalsificationAudit({ audit: { ...audit, model }, study: study.definition, candidate }));
      break;
    case "session_auction":
      runs = models.map((model) => runSessionAuctionFalsificationAudit({ audit: { ...audit, model }, study: study.definition, candidate }));
      break;
    case "event_aftershock_retest":
      runs = models.map((model) => runEventAftershockFalsificationAudit({ audit: { ...audit, model }, study: study.definition,
        candidate, eventSchedule: study.eventSchedule }));
      break;
    case "failed_breakout":
      runs = models.map((model) => runFailedBreakoutFalsificationAudit({ audit: { ...audit, model }, study: study.definition, candidate }));
      break;
    case "session_exhaustion_handoff":
      runs = models.map((model) => runSessionHandoffFalsificationAudit({ audit: { ...audit, model }, study: study.definition, candidate }));
      break;
    case "composite_condition":
      runs = models.map((model) => runCompositeConditionFalsificationAudit({ audit: { ...audit, model }, study: study.definition, candidate }));
      break;
  }
  return {
    schemaVersion: "1.0",
    methodologyVersion: "event_study_falsification_audit_standard_v1",
    standard: { replications: audit.replications, bars: audit.bars, nominalAlpha: audit.nominalAlpha,
      folds: candidate.folds, models: input.study.type === "yield_price_nonconfirmation" ? ["factor_null_pair"] : [...models] },
    study: input.study.type,
    runs,
    limitations: [
      "Each null model is reported separately; rates across models are not pooled.",
      "This calibrates the supplied frozen decision rule, not profitability or an executable trading strategy.",
      "Synthetic folds are equal calendar partitions of each generated series and do not reproduce the real sample dates.",
      ...(input.study.type === "yield_price_nonconfirmation" ? ["The paired null preserves only contemporaneous correlation; it does not model yield publication timing, revisions, or carry."] : []),
    ],
  };
}
