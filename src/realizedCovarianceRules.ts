import { z } from "zod";
import { createHash } from "node:crypto";
import { checkTimeZoneName, intlZoneResolver, wallTimeToUtc, type ZoneResolver } from "./zonedTime.js";

/**
 * Rules, day windows and call validation for compute_realized_covariance
 * (docs/REALIZED_COVARIANCE_DESIGN.md sections "Rules" and "Boundaries, day windows and labels";
 * plan section 7). Pure apart from the injectable zone resolver.
 */
export const REALIZED_COVARIANCE_MAX_DATES = 5_000;
/** A realized window may start up to this many calendar days (UTC) before its label (the forecast-set bound, D11). */
export const REALIZED_COVARIANCE_WINDOW_MAX_LAG_DAYS = 8;
/**
 * Call dates lie inside the bar-series time range, so every label is a four-digit-year date: the string
 * arithmetic below never meets an extended year, and Date.UTC never maps years 0-99 to 1900-1999 (code review C1).
 */
export const REALIZED_COVARIANCE_FIRST_DATE = "1970-01-01";
export const REALIZED_COVARIANCE_LAST_DATE = "2099-12-31";

/** Every rejection carries one of the design's or plan's error names as `code`, and in its message. */
export class RealizedCovarianceError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "RealizedCovarianceError";
  }
}
const reject = (code: string, detail: string): never => { throw new RealizedCovarianceError(code, detail); };

// Date.parse first: a month of 13 or a day of 32 is an Invalid Date, whose toISOString() throws (re-review R1).
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => Number.isFinite(Date.parse(`${s}T00:00:00.000Z`))
    && new Date(`${s}T00:00:00.000Z`).toISOString().slice(0, 10) === s, "invalid calendar date");

export const realizedCovarianceRulesSchema = z.object({
  interval_minutes: z.number().int().min(1).max(1440),
  time_zone: z.string().min(1).max(64),
  day_end_local: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  day_weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  max_missing_slots: z.number().int().min(0).max(1440),
  first_interval: z.enum(["from_previous_endpoint", "within_day"]),
  return_unit: z.enum(["log", "log_percent"]),
}).strict();
export type RealizedCovarianceRules = z.infer<typeof realizedCovarianceRulesSchema>;

/**
 * Validate and canonicalize: a fixed key order and sorted weekdays. Duplicate weekdays are rejected
 * rather than removed. `rules_sha256` is the SHA-256 of JSON.stringify of the canonical form.
 */
export function canonicalizeRules(input: unknown): { rules: RealizedCovarianceRules; rules_sha256: string } {
  const raw = realizedCovarianceRulesSchema.parse(input);
  if (1440 % raw.interval_minutes !== 0) reject("interval_mismatch", "interval_minutes must divide 1440");
  if (new Set(raw.day_weekdays).size !== raw.day_weekdays.length) reject("invalid_rules", "day_weekdays must not repeat");
  const zone = checkTimeZoneName(raw.time_zone);
  if (zone !== "ok") reject(zone, `time_zone ${JSON.stringify(raw.time_zone)}`);
  const rules = canonicalRulesForm(raw);
  return { rules, rules_sha256: hashRules(rules) };
}

/** The canonical form: fixed key order and sorted weekdays. No zone-name check, so stored rules re-hash unchanged (H3). */
export function canonicalRulesForm(raw: RealizedCovarianceRules): RealizedCovarianceRules {
  return {
    interval_minutes: raw.interval_minutes,
    time_zone: raw.time_zone,
    day_end_local: raw.day_end_local,
    day_weekdays: [...raw.day_weekdays].sort((x, y) => x - y),
    max_missing_slots: raw.max_missing_slots,
    first_interval: raw.first_interval,
    return_unit: raw.return_unit,
  };
}

/** `rules_sha256`: the SHA-256 of JSON.stringify of the canonical form. */
export const hashRules = (rules: RealizedCovarianceRules) =>
  `sha256:${createHash("sha256").update(JSON.stringify(canonicalRulesForm(rules))).digest("hex")}`;

/** Produced labels in [fromDate, toDate]: calendar arithmetic only, no zone data needed. */
export function producedLabels(rules: RealizedCovarianceRules, fromDate: string, toDate: string): string[] {
  for (const date of [fromDate, toDate]) {
    if (!dateSchema.safeParse(date).success || date < REALIZED_COVARIANCE_FIRST_DATE || date > REALIZED_COVARIANCE_LAST_DATE) {
      reject("invalid_date_range", `from_date and to_date must be calendar dates from ${REALIZED_COVARIANCE_FIRST_DATE} to ${REALIZED_COVARIANCE_LAST_DATE}`);
    }
  }
  if (fromDate > toDate) reject("invalid_date_range", "from_date is after to_date");
  const weekdays = new Set(rules.day_weekdays);
  const labels: string[] = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    if (weekdays.has(isoWeekday(date))) {
      labels.push(date);
      if (labels.length > REALIZED_COVARIANCE_MAX_DATES) reject("too_many_dates", `more than ${REALIZED_COVARIANCE_MAX_DATES} produced days`);
    }
  }
  return labels;
}

export const addDays = (date: string, days: number) =>
  new Date(Date.parse(`${date}T00:00:00.000Z`) + days * 86_400_000).toISOString().slice(0, 10);
/** ISO weekday of a calendar date: Monday = 1 … Sunday = 7. */
export const isoWeekday = (date: string) => ((new Date(`${date}T00:00:00.000Z`).getUTCDay() + 6) % 7) + 1;

export interface CalendarDay {
  label: string;
  /** s(D) and e(D), UTC milliseconds. */
  start: number;
  end: number;
  /** P(D), the previous produced label, and its endpoint instant e(P(D)). */
  previous_label: string;
  previous_end: number;
  /** The realized window's start: e(P(D)) with from_previous_endpoint, s(D) with within_day. */
  window_from: number;
  expected_slots: number;
}

/** The window backstop (G5): unreachable from valid rules, kept and unit-tested in isolation. */
export function assertWindowWithinLag(windowFrom: number, label: string): void {
  const earliest = addDays(label, -REALIZED_COVARIANCE_WINDOW_MAX_LAG_DAYS);
  if (new Date(windowFrom).toISOString().slice(0, 10) < earliest) {
    reject("window_too_long", `the window for ${label} starts before ${earliest}`);
  }
}

/**
 * Day windows for every produced label in [fromDate, toDate], with every call-level rule check
 * (design "Rule validation at call time"). Boundaries used by the call are e(P(first produced day))
 * with from_previous_endpoint, and s(D) and e(D) for every produced D (G1).
 */
export function planCalendar(rules: RealizedCovarianceRules, fromDate: string, toDate: string,
  resolver: ZoneResolver = intlZoneResolver): { days: CalendarDay[]; tzdata: string } {
  const weekdays = new Set(rules.day_weekdays);
  const labels = producedLabels(rules, fromDate, toDate);   // validates both dates and their order
  if (labels.length === 0) reject("no_produced_days", "no date in the range has a weekday in day_weekdays");

  const [hour, minute] = rules.day_end_local.split(":").map(Number);
  const step = rules.interval_minutes * 60_000;
  // Label by rule arithmetic (G1): the window ending at b(x) is labelled x when the day end is at least
  // one interval after midnight, otherwise x − 1. So e(D) = b(D + shift) and s(D) = e(D − 1).
  const shift = hour * 60 + minute >= rules.interval_minutes ? 0 : 1;
  const boundaries = new Map<string, number>();
  const boundary = (date: string): number => {
    const cached = boundaries.get(date);
    if (cached !== undefined) return cached;
    const resolved = wallTimeToUtc(rules.time_zone, date, hour, minute, resolver);
    if (resolved.kind !== "unique") {
      reject("boundary_in_dst_gap_or_fold", `${rules.day_end_local} on ${date} in ${rules.time_zone} is a DST ${resolved.kind}`);
    }
    const instant = (resolved as { instant: number }).instant;
    if (instant % step !== 0) {
      reject("boundary_not_on_grid", `${rules.day_end_local} on ${date} in ${rules.time_zone} is ${new Date(instant).toISOString()}, off the ${rules.interval_minutes}-minute grid`);
    }
    boundaries.set(date, instant);
    return instant;
  };
  const end = (label: string) => boundary(addDays(label, shift));
  const previousProduced = (label: string) => {
    for (let back = 1; back <= 7; back++) {
      const candidate = addDays(label, -back);
      if (weekdays.has(isoWeekday(candidate))) return candidate;
    }
    return reject("invalid_rules", "day_weekdays is empty");   // unreachable: the schema requires one weekday
  };
  const minimum = rules.first_interval === "from_previous_endpoint" ? 2 : 3;
  const days = labels.map((label): CalendarDay => {
    const start = end(addDays(label, -1)), stop = end(label);
    const previous = previousProduced(label);
    // Only the first day's P(D) can lie outside the produced range; later ones are produced days already checked.
    const previousEnd = rules.first_interval === "from_previous_endpoint" ? end(previous) : start;
    const expected = (stop - start) / step;
    if (expected - rules.max_missing_slots < minimum) {
      reject("too_few_slots_for_rule", `${label} has ${expected} expected slots, max_missing_slots ${rules.max_missing_slots}, `
        + `and ${rules.first_interval} needs at least ${minimum} common slots`);
    }
    const windowFrom = rules.first_interval === "from_previous_endpoint" ? previousEnd : start;
    assertWindowWithinLag(windowFrom, label);
    return { label, start, end: stop, previous_label: previous, previous_end: previousEnd, window_from: windowFrom, expected_slots: expected };
  });
  return { days, tzdata: resolver.tzdata };
}

/** duplicate_series and interval_mismatch (design F11; plan Q12). */
export function assertSeriesAgainstRules(series: { artifact_id: string; series_id: string; interval_minutes: number }[],
  rules: RealizedCovarianceRules): void {
  if (new Set(series.map((s) => s.artifact_id)).size !== series.length) reject("duplicate_series", "a bar-series artifact appears twice");
  if (new Set(series.map((s) => s.series_id)).size !== series.length) reject("duplicate_series", "a series_id appears twice");
  for (const s of series) {
    if (s.interval_minutes !== rules.interval_minutes) {
      reject("interval_mismatch", `${s.series_id} has ${s.interval_minutes}-minute bars; the rules use ${rules.interval_minutes}`);
    }
  }
}
