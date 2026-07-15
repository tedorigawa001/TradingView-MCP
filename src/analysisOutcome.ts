import type { AnalysisOverlayState } from "./analysisOverlay.js";
import type { OhlcvBar } from "./tradingview.js";

type TerminalEvent = {
  kind: "target" | "stop" | "invalidation";
  targetIndex?: number;
  price: number;
  barTime: string;
};

function resolutionMilliseconds(resolution: string): number | null {
  const value = resolution.trim().toUpperCase();
  if (/^\d+$/.test(value)) return Number(value) * 60_000;
  const match = value.match(/^(\d*)([SHDWM])$/);
  if (!match) throw new Error(`unsupported outcome resolution ${JSON.stringify(resolution)}`);
  if (match[2] === "M") return null;
  const count = Number(match[1] || "1");
  const units: Record<string, number> = {
    S: 1_000,
    H: 3_600_000,
    D: 86_400_000,
    W: 604_800_000,
  };
  const unit = units[match[2]];
  if (unit === undefined) throw new Error(`unsupported outcome resolution ${JSON.stringify(resolution)}`);
  return count * unit;
}

function atOrBeyond(state: AnalysisOverlayState, value: number, level: number, favorable: boolean) {
  if (favorable) return state.bias === "bullish" ? value >= level : value <= level;
  return state.bias === "bullish" ? value <= level : value >= level;
}

function touched(state: AnalysisOverlayState, bar: OhlcvBar, level: number, favorable: boolean) {
  return favorable
    ? state.bias === "bullish"
      ? bar.high >= level
      : bar.low <= level
    : state.bias === "bullish"
      ? bar.low <= level
      : bar.high >= level;
}

export function evaluateAnalysisOverlayOutcome(
  state: AnalysisOverlayState,
  bars: OhlcvBar[],
  resolution: string,
  now = new Date(),
) {
  if (state.bias === "neutral") {
    return {
      status: "not_evaluable",
      outcome: "neutral_direction",
      analysisId: state.analysisId,
      activation: { entryAt: null, confirmationAt: null },
      terminal: null,
      qualityIssues: ["neutral_analysis_has_no_directional_outcome"],
      evidence: { suppliedBars: bars.length, closedBars: 0, evaluatedBars: 0, skippedAnalysisBar: false },
    };
  }
  const barMs = resolutionMilliseconds(resolution);
  if (barMs === null) {
    return {
      status: "not_evaluable",
      outcome: "calendar_month_resolution_unsupported",
      analysisId: state.analysisId,
      activation: { entryAt: null, confirmationAt: null },
      terminal: null,
      qualityIssues: ["calendar_month_has_variable_duration"],
      evidence: {
        suppliedBars: bars.length,
        closedBars: bars.filter((bar) => bar.forming !== true).length,
        evaluatedBars: 0,
        skippedAnalysisBar: false,
      },
    };
  }
  const analyzedAtMs = Date.parse(state.analyzedAt);
  const expiresAtMs = state.expiresAt === null ? null : Date.parse(state.expiresAt);
  if (!Number.isFinite(analyzedAtMs) || (expiresAtMs !== null && !Number.isFinite(expiresAtMs))) {
    throw new Error("analysis outcome timestamps are invalid");
  }
  const closed = bars.filter((bar) => bar.forming !== true);
  for (let index = 0; index < closed.length; index += 1) {
    const bar = closed[index];
    if (
      !Number.isFinite(bar.time) ||
      ![bar.open, bar.high, bar.low, bar.close].every(Number.isFinite) ||
      bar.high < bar.low
    ) {
      throw new Error(`OHLCV bar ${index} is invalid`);
    }
    if (index > 0 && bar.time <= closed[index - 1].time) {
      throw new Error("OHLCV bars must be strictly increasing by time");
    }
  }
  const evidenceBase = {
    suppliedBars: bars.length,
    closedBars: closed.length,
    evaluatedBars: 0,
    skippedAnalysisBar: closed.some((bar) => {
      const start = bar.time * 1000;
      return start < analyzedAtMs && start + barMs > analyzedAtMs;
    }),
  };
  if (closed.length === 0 || closed[0].time * 1000 > analyzedAtMs) {
    return {
      status: "incomplete",
      outcome: "history_incomplete",
      analysisId: state.analysisId,
      activation: { entryAt: null, confirmationAt: null },
      terminal: null,
      qualityIssues: ["history_does_not_cover_analysis_start"],
      evidence: evidenceBase,
    };
  }
  const eligible = closed.filter((bar) => {
    const start = bar.time * 1000;
    const end = start + barMs;
    return start >= analyzedAtMs && (expiresAtMs === null || end <= expiresAtMs);
  });
  const evidence = { ...evidenceBase, evaluatedBars: eligible.length };
  const windowClosed = expiresAtMs !== null && now.getTime() >= expiresAtMs;
  if (eligible.length === 0) {
    return {
      status: windowClosed ? "incomplete" : "ongoing",
      outcome: windowClosed
        ? "no_closed_bars_in_evaluation_window"
        : "awaiting_first_closed_bar",
      analysisId: state.analysisId,
      activation: { entryAt: null, confirmationAt: null },
      terminal: null,
      qualityIssues: windowClosed ? ["no_post_analysis_closed_bar_before_expiry"] : [],
      evidence,
    };
  }
  let entryAt: string | null = null;
  let confirmationAt: string | null = null;
  let active = false;
  let previousBar: OhlcvBar | null = null;

  const ambiguous = (outcome: string, bar: OhlcvBar, issue: string) => ({
    status: "ambiguous",
    outcome,
    analysisId: state.analysisId,
    activation: { entryAt, confirmationAt },
    terminal: null,
    ambiguousBarTime: bar.timeIso,
    qualityIssues: [issue],
    evidence,
  });
  const invalidated = (outcome: string, bar: OhlcvBar) => ({
    status: "complete",
    outcome,
    analysisId: state.analysisId,
    activation: { entryAt, confirmationAt },
    terminal: {
      kind: "invalidation",
      price: state.invalidation,
      barTime: bar.timeIso,
    } satisfies TerminalEvent,
    qualityIssues: [],
    evidence,
  });

  for (const bar of eligible) {
    const entryTouched = bar.high >= state.entryLow && bar.low <= state.entryHigh;
    const confirmationTouched =
      state.confirmation !== null && touched(state, bar, state.confirmation, true);
    const invalidationTouched = touched(state, bar, state.invalidation, false);
    const stopTouched = touched(state, bar, state.stop, false);
    const touchedTargets = state.targets
      .map((price, index) => ({ index: index + 1, price }))
      .filter((target) => touched(state, bar, target.price, true));

    if (entryAt === null && entryTouched) {
      entryAt = bar.timeIso;
      if (state.confirmation !== null && confirmationTouched) {
        return ambiguous("activation_order_unknown", bar, "entry_and_confirmation_touched_same_bar");
      }
      if (state.confirmation !== null && invalidationTouched) {
        return invalidated("invalidated_before_confirmation", bar);
      }
      if (state.confirmation === null) {
        if (invalidationTouched) {
          return ambiguous("activation_order_unknown", bar, "entry_and_invalidation_touched_same_bar");
        }
        if (stopTouched || touchedTargets.length > 0) {
          return ambiguous("terminal_order_unknown", bar, "entry_and_terminal_touched_same_bar");
        }
        active = true;
      }
      previousBar = bar;
      continue;
    }

    if (entryAt === null && invalidationTouched) {
      return invalidated("invalidated_before_entry", bar);
    }

    if (!active && entryAt !== null && state.confirmation !== null) {
      if (confirmationTouched && invalidationTouched) {
        return ambiguous(
          "activation_order_unknown",
          bar,
          "confirmation_and_invalidation_touched_same_bar",
        );
      }
      if (invalidationTouched) {
        return invalidated("invalidated_before_confirmation", bar);
      }
      if (confirmationTouched) {
        confirmationAt = bar.timeIso;
        if (touchedTargets.length > 0) {
          return ambiguous("terminal_order_unknown", bar, "confirmation_and_target_touched_same_bar");
        }
        active = true;
      }
      previousBar = bar;
      continue;
    }

    if (active) {
      if (stopTouched && touchedTargets.length > 0) {
        return ambiguous("terminal_order_unknown", bar, "target_and_stop_touched_same_bar");
      }
      const target = touchedTargets[0] ?? null;
      const terminal: TerminalEvent | null = target
        ? { kind: "target", targetIndex: target.index, price: target.price, barTime: bar.timeIso }
        : stopTouched
          ? { kind: "stop", price: state.stop, barTime: bar.timeIso }
          : null;
      if (terminal) {
        const favorable = terminal.kind === "target";
        const previousBeyond =
          previousBar !== null && atOrBeyond(state, previousBar.close, terminal.price, favorable);
        const openedBeyond = atOrBeyond(state, bar.open, terminal.price, favorable);
        if (openedBeyond && !previousBeyond) {
          return ambiguous("gap_across_terminal", bar, "bar_open_gapped_across_terminal_level");
        }
        return {
          status: "complete",
          outcome: terminal.kind === "target" ? "target_before_stop" : "stop_before_target",
          analysisId: state.analysisId,
          activation: { entryAt, confirmationAt },
          terminal,
          qualityIssues: [],
          evidence,
        };
      }
    }
    previousBar = bar;
  }

  return {
    status: windowClosed ? "complete" : "ongoing",
    outcome: active
      ? windowClosed
        ? "no_terminal_event"
        : "awaiting_terminal"
      : entryAt === null
        ? windowClosed
          ? "not_activated"
          : "awaiting_entry"
        : windowClosed
          ? "expired_without_confirmation"
          : "awaiting_confirmation",
    analysisId: state.analysisId,
    activation: { entryAt, confirmationAt },
    terminal: null,
    qualityIssues: [],
    evidence,
  };
}
