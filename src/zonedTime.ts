/**
 * Local wall time to UTC for compute_realized_covariance (docs/REALIZED_COVARIANCE_PLAN.md section 7,
 * "Wall time to UTC"). A wall time can map to no instant (a DST gap or a skipped day), one instant, or
 * two (a fold); callers get all three outcomes and never a guess.
 *
 * The existing newYorkCivilTimeToIso (src/cot.ts) assumes no transition and is not reused.
 */

export interface WallFields { year: number; month: number; day: number; hour: number; minute: number; second: number }

/** Injectable so tests can present another tzdata (design H4, H6). */
export interface ZoneResolver {
  readonly tzdata: string;
  /** Local wall fields of instant `ms` in `zone`. */
  formatAt(zone: string, ms: number): WallFields;
}

export type WallTimeResolution =
  | { kind: "unique"; instant: number }
  | { kind: "gap" }
  | { kind: "fold"; instants: number[] };

const HOUR = 3_600_000;
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(zone: string): Intl.DateTimeFormat {
  let cached = formatters.get(zone);
  if (!cached) {
    // hourCycle h23: with hour12: false this runtime renders midnight as "24:00", which would turn every
    // 00:00 boundary into a gap (plan review Q3).
    cached = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    formatters.set(zone, cached);
  }
  return cached;
}

export const intlZoneResolver: ZoneResolver = {
  tzdata: typeof process.versions.tz === "string" && process.versions.tz ? process.versions.tz : "unknown",
  formatAt(zone, ms) {
    const parts: Record<string, number> = {};
    for (const part of formatter(zone).formatToParts(new Date(ms))) {
      if (part.type !== "literal") parts[part.type] = Number(part.value);
    }
    return { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour, minute: parts.minute, second: parts.second };
  },
};

/** Offset of `zone` at instant `ms`, in milliseconds (local wall time read as UTC, minus the instant). */
export function offsetAt(zone: string, ms: number, resolver: ZoneResolver = intlZoneResolver): number {
  const f = resolver.formatAt(zone, ms);
  return Date.UTC(f.year, f.month - 1, f.day, f.hour, f.minute, f.second) - Math.floor(ms / 1000) * 1000;
}

/**
 * The instants at which `zone` shows the wall time `date` (YYYY-MM-DD) `hour`:`minute`:00.
 * W is the wall time read as UTC; offsets are sampled only at W ± 36 h. The review found no two
 * transitions within 78 h in any of 417 zones from 1970 to 2036, so two samples see every offset
 * that can apply. A candidate W − offset survives if it formats back to the same wall time, to the
 * second.
 */
export function wallTimeToUtc(zone: string, date: string, hour: number, minute: number,
  resolver: ZoneResolver = intlZoneResolver): WallTimeResolution {
  const [year, month, day] = date.split("-").map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute, 0);
  const offsets = [...new Set([offsetAt(zone, wall - 36 * HOUR, resolver), offsetAt(zone, wall + 36 * HOUR, resolver)])];
  const survivors = [...new Set(offsets.map((offset) => wall - offset))].filter((candidate) => {
    const f = resolver.formatAt(zone, candidate);
    return f.year === year && f.month === month && f.day === day && f.hour === hour && f.minute === minute && f.second === 0;
  }).sort((x, y) => x - y);
  if (survivors.length === 0) return { kind: "gap" };
  if (survivors.length === 1) return { kind: "unique", instant: survivors[0] };
  return { kind: "fold", instants: survivors };
}

/**
 * Zone-name checks (design G7, H3). Unknown names are rejected. A name that differs from Intl's
 * resolved name only by letter case is rejected, so case cannot create spurious rule variants.
 * Aliases are accepted verbatim; which spellings resolve where depends on the ICU version.
 */
export function checkTimeZoneName(zone: string): "ok" | "unknown_time_zone" | "time_zone_case_variant" {
  let resolved: string;
  try { resolved = new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions().timeZone; }
  catch { return "unknown_time_zone"; }
  return resolved !== zone && resolved.toLowerCase() === zone.toLowerCase() ? "time_zone_case_variant" : "ok";
}
