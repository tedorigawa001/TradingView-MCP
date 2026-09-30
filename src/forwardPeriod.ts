import { z } from "zod";
import { readBacktestLedgerFile } from "./backtestLedger.js";
import { AppendOnlyFirstSeenLog, isCalendarDate, isCanonicalTimestamp } from "./firstSeenStore.js";

/**
 * Forward period declarations (docs/FORWARD_PERIOD_DESIGN.md rev 3.4; plan section 6). A declaration records,
 * by the local server clock and at least 24 hours before the period's start timestamp, that one research ID
 * intends to use [from, to) on some series only for the evaluation its protocol hash names. It is evidence of
 * recorded intent, never proof of unused data. This module holds the journal and the pure logic; the period
 * usage store orchestrates the two files under ledger → declarations locks.
 */
export const FORWARD_PERIOD_NAMESPACE = "forward_period_declarations" as const;
export const FORWARD_PERIOD_LEAD_MS = 86_400_000;
export const FORWARD_PERIOD_MIN_LENGTH_MS = 86_400_000;
export const FORWARD_PERIOD_MAX_LENGTH_MS = 31_622_400_000;   // 366 days
/** The plan's own addition, matching the bar-series range. */
export const FORWARD_PERIOD_MAX_TO = "2100-01-01T00:00:00.000Z";
/** One bound for every declarations-lock acquisition, queue included (design H1). */
export const FORWARD_PERIOD_LOCK_BUDGET_MS = 2_000;
export const FORWARD_PERIOD_LISTED_CAP = 20;
export const FORWARD_PERIOD_SHORTENINGS_LISTED_CAP = 5;
export const FORWARD_PERIOD_CONFLICTS_NAMED_CAP = 5;
export const FORWARD_PERIOD_MAX_SERIES = 20;

export const FORWARD_PERIOD_LIMITATIONS = [
  "forward_declaration_is_intent_not_proof_of_unused_data",
  "declared_before_period_start_by_local_clock_only",
  "period_timestamps_are_data_labels_not_availability_times",
  "local_journal_is_private_state_not_tamper_evidence",
  "access_outside_the_ledger_is_not_detected",
  "related_series_and_aliases_are_not_linked",
  "does_not_reserve_the_data_or_block_viewing",
  "protocol_hash_is_caller_asserted",
  "research_id_is_caller_supplied_not_authenticated",
  "declaration_does_not_bind_data_source_or_version",
] as const;

export class ForwardPeriodError extends Error {
  constructor(readonly code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = "ForwardPeriodError";
  }
}
const reject = (code: string, detail: string): never => { throw new ForwardPeriodError(code, detail); };

const identifier = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const declarationId = z.string().regex(/^[A-Za-z0-9_.:-]{1,100}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(isCanonicalTimestamp, "invalid canonical UTC timestamp");
const hypothesisKind = z.enum(["strategy", "event"]);
const population = z.enum(["in_sample", "out_of_sample", "walk_forward", "stress", "live"]);
/** A content-addressed proxy set cannot gain future data; every other prefix is a stable identity (design F8). */
const REJECTED_SERIES_PREFIX = "proxy-set-source:";

// Input schemas check format only. The lead, the length, new_end, exclusivity, usage and the hypothesis are
// checked in the store, so an ID conflict comes first and an identical retry succeeds after the lead passed
// (plan P-Q7).
export const declareForwardPeriodInputSchema = z.object({
  declaration_id: declarationId,
  research_id: identifier,
  series_ids: z.array(identifier).min(1).max(FORWARD_PERIOD_MAX_SERIES),
  from: timestamp,
  to: timestamp,
  protocol_sha256: hash,
  hypothesis: z.object({ kind: hypothesisKind, id: z.string().regex(/^[\w.:-]{1,80}$/) }).strict().optional(),
}).strict()
  .refine((value) => value.from < value.to, "from must be before to")
  .refine((value) => value.to <= FORWARD_PERIOD_MAX_TO, `to must be at most ${FORWARD_PERIOD_MAX_TO}`)
  .refine((value) => new Set(value.series_ids).size === value.series_ids.length, "series_ids must be unique")
  .refine((value) => value.series_ids.every((id) => !id.startsWith(REJECTED_SERIES_PREFIX)),
    `series_ids may not use ${REJECTED_SERIES_PREFIX}`);
export type DeclareForwardPeriodInput = z.infer<typeof declareForwardPeriodInputSchema>;

export const shortenForwardPeriodInputSchema = z.object({
  declaration_id: declarationId,
  research_id: identifier,
  new_end: timestamp,
  reason: z.string().min(1).max(200),
}).strict();
export type ShortenForwardPeriodInput = z.infer<typeof shortenForwardPeriodInputSchema>;

const header = {
  schema_version: z.literal("1.0"),
  namespace: z.literal(FORWARD_PERIOD_NAMESPACE),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recorded_at: timestamp,
  first_seen_at: timestamp,
  observation_date: z.string().refine(isCalendarDate),
  /** The period usage ledger's record count when the line was written (design G4). */
  ledger_sequence_at_write: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
};
const storedHypothesis = z.object({
  kind: hypothesisKind, id: z.string().regex(/^[\w.:-]{1,80}$/), definition_hash: hash,
  journal_sequence: z.number().int().positive(), population,
}).strict();
const declarationLineSchema = z.object({
  ...header,
  kind: z.literal("declaration"),
  declaration_id: declarationId,
  research_id: identifier,
  series_ids: z.array(identifier).min(1).max(FORWARD_PERIOD_MAX_SERIES),
  from: timestamp,
  to: timestamp,
  protocol_sha256: hash,
  hypothesis: storedHypothesis.nullable(),
}).strict();
const shorteningLineSchema = z.object({
  ...header,
  kind: z.literal("shortening"),
  declaration_id: declarationId,
  research_id: identifier,
  new_end: timestamp,
  reason: z.string().min(1).max(200),
}).strict();
const lineSchema = z.discriminatedUnion("kind", [declarationLineSchema, shorteningLineSchema]);
export type DeclarationLine = z.infer<typeof declarationLineSchema>;
export type ShorteningLine = z.infer<typeof shorteningLineSchema>;
export type ForwardPeriodLine = z.infer<typeof lineSchema>;

const ms = (iso: string) => Date.parse(iso);
const sortedUnique = (ids: string[]) => ids.every((id, i) => i === 0 || ids[i - 1] < id);

/** One line on its own. Rules that span lines are in validateJournal. */
export function validateForwardPeriodLine(value: unknown): ForwardPeriodLine {
  const line = lineSchema.parse(value);
  if (line.recorded_at !== line.first_seen_at || line.observation_date !== line.recorded_at.slice(0, 10)) {
    throw new Error("invalid forward period line dates");
  }
  if (line.kind === "declaration") {
    if (!sortedUnique(line.series_ids)) throw new Error("forward period series_ids must be stored sorted and unique");
    if (line.series_ids.some((id) => id.startsWith(REJECTED_SERIES_PREFIX))) throw new Error("forward period series prefix rejected");
    const length = ms(line.to) - ms(line.from);
    if (length < FORWARD_PERIOD_MIN_LENGTH_MS || length > FORWARD_PERIOD_MAX_LENGTH_MS || line.to > FORWARD_PERIOD_MAX_TO) {
      throw new Error("forward period declaration length out of bounds");
    }
    if (ms(line.from) - ms(line.recorded_at) < FORWARD_PERIOD_LEAD_MS) throw new Error("forward period declaration lead too short");
  } else if (ms(line.new_end) - ms(line.recorded_at) < FORWARD_PERIOD_LEAD_MS) {
    throw new Error("forward period shortening lead too short");
  }
  return line;
}

/**
 * Whole-journal consistency, so a hand-edited line fails closed: unique declaration IDs, every shortening after
 * its own declaration with the same research ID, `new_end` strictly decreasing and either `from` or at least
 * `from` + 24 h, and anchors that never decrease.
 */
export function validateJournal(lines: ForwardPeriodLine[]): void {
  const ends = new Map<string, { line: DeclarationLine; end: string }>();
  let anchor = 0;
  for (const line of lines) {
    if (line.ledger_sequence_at_write < anchor) throw new Error("forward period ledger anchors moved backwards");
    anchor = line.ledger_sequence_at_write;
    if (line.kind === "declaration") {
      if (ends.has(line.declaration_id)) throw new Error("duplicate forward period declaration_id");
      ends.set(line.declaration_id, { line, end: line.to });
      continue;
    }
    const current = ends.get(line.declaration_id);
    if (!current) throw new Error("forward period shortening before its declaration");
    if (current.line.research_id !== line.research_id) throw new Error("forward period shortening research_id mismatch");
    if (!validNewEnd(current.line, current.end, line.new_end)) throw new Error("invalid forward period shortening new_end");
    current.end = line.new_end;
  }
}

/** `new_end` below the current end, and either `from` or at least `from` + 24 h (design H6), so never before `from`. */
export function validNewEnd(declaration: DeclarationLine, currentEnd: string, newEnd: string): boolean {
  return newEnd < currentEnd
    && (newEnd === declaration.from || ms(newEnd) - ms(declaration.from) >= FORWARD_PERIOD_MIN_LENGTH_MS);
}

export const resolveForwardPeriodJournalPath = (): string | undefined =>
  process.env.TRADINGVIEW_MCP_FORWARD_PERIOD_JOURNAL_PATH?.trim() || undefined;

/** The declarations file. Every lock acquisition goes through the short bound, step-1 lookups included (H1). */
export class ForwardPeriodJournal {
  private readonly log: AppendOnlyFirstSeenLog<ForwardPeriodLine>;

  constructor(readonly filePath: string,
    private readonly limits = { maxFileBytes: 32 * 1024 * 1024, maxRecordBytes: 16 * 1024 }) {
    this.log = new AppendOnlyFirstSeenLog(filePath, "forward period declarations", validateForwardPeriodLine, limits);
  }

  withLock<R>(operation: () => Promise<R>): Promise<R> {
    return this.log.serializeWithin(FORWARD_PERIOD_LOCK_BUDGET_MS, operation);
  }

  /** Strict framing, as the period usage ledger requires; a missing file holds no declarations. */
  async readUnlocked(): Promise<ForwardPeriodLine[]> {
    try {
      const text = (await readBacktestLedgerFile(this.filePath, true)).toString("utf8");
      if (!text.endsWith("\n") || text.slice(0, -1).split("\n").some((line) => !line.trim()
        || Buffer.byteLength(line, "utf8") + 1 > this.limits.maxRecordBytes)) {
        throw new Error("invalid forward period declarations JSONL framing or record size");
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const lines = await this.log.readAllUnlocked();
    validateJournal(lines);
    return lines;
  }

  /** Refuses a clock earlier than the last line, the second line of defence behind the read-time check (R3). */
  async appendUnlocked(lines: ForwardPeriodLine[], line: ForwardPeriodLine): Promise<void> {
    assertClockNotBehind(lines, line.recorded_at);
    if (line.sequence !== lines.length + 1) throw new Error("forward period line sequence is not the next one");
    validateForwardPeriodLine(line);
    validateJournal([...lines, line]);
    await this.log.appendUnlocked(line);
  }
}

/** The read-time clock check (design R3). */
export function assertClockNotBehind(lines: ForwardPeriodLine[], now: string): void {
  if (lines.length && lines[lines.length - 1].recorded_at > now) {
    reject("forward_period_clock_moved_backwards", "the clock is earlier than the last forward period line");
  }
}

/** H7: an anchor above the ledger's record count means the ledger was reset or replaced. */
export const ledgerRegressed = (lines: ForwardPeriodLine[], ledgerCount: number) =>
  lines.some((line) => line.ledger_sequence_at_write > ledgerCount);

// ---------------------------------------------------------------------------------------------------------------
// Views

export interface DeclarationView {
  line: DeclarationLine;
  /** In journal order; each has a smaller new_end than the one before. */
  shortenings: ShorteningLine[];
  effective_to: string;
  shortened_after_start: boolean;
  late_shortening: { recorded_at: string; lead_seconds: number } | null;
}

export const leadSeconds = (from: string, recordedAt: string) => Math.floor((ms(from) - ms(recordedAt)) / 1000);

/**
 * The declarations as of a point: only lines whose anchor is below `asOfLedgerSequence` count (design G4), so a
 * record response replays exactly. Without it, every line counts.
 */
export function buildViews(lines: ForwardPeriodLine[], asOfLedgerSequence?: number): Map<string, DeclarationView> {
  const views = new Map<string, DeclarationView>();
  for (const line of lines) {
    if (asOfLedgerSequence !== undefined && line.ledger_sequence_at_write >= asOfLedgerSequence) continue;
    if (line.kind === "declaration") {
      views.set(line.declaration_id, { line, shortenings: [], effective_to: line.to, shortened_after_start: false, late_shortening: null });
      continue;
    }
    const view = views.get(line.declaration_id);
    if (!view) continue;
    view.shortenings.push(line);
    view.effective_to = line.new_end;
    // Recorded later than from − 24 h: within the last 24 h before the start or after it (design G1).
    if (ms(line.recorded_at) > ms(view.line.from) - FORWARD_PERIOD_LEAD_MS) {
      view.shortened_after_start = true;
      view.late_shortening ??= { recorded_at: line.recorded_at, lead_seconds: leadSeconds(view.line.from, line.recorded_at) };
    }
  }
  return views;
}

export type DeclarationState = "pending" | "running" | "ended" | "withdrawn";
export function stateOf(view: DeclarationView, now: string): DeclarationState {
  if (view.effective_to === view.line.from) return "withdrawn";
  if (now < view.line.from) return "pending";
  return now < view.effective_to ? "running" : "ended";
}

const overlaps = (aFrom: string, aTo: string, bFrom: string, bTo: string) => aFrom < bTo && bFrom < aTo;
/** Active: a non-empty effective period that overlaps the interval. */
export const isActiveFor = (view: DeclarationView, from: string, to: string) =>
  view.effective_to > view.line.from && overlaps(view.line.from, view.effective_to, from, to);

/** Active declarations on any of the series that overlap [from, to) (exclusivity; design step 3). */
export function conflictingDeclarations(views: Iterable<DeclarationView>, seriesIds: string[], from: string, to: string) {
  const conflicts: { series_id: string; declaration_id: string }[] = [];
  for (const view of views) {
    if (!isActiveFor(view, from, to)) continue;
    for (const series of seriesIds) if (view.line.series_ids.includes(series)) conflicts.push({ series_id: series, declaration_id: view.line.declaration_id });
  }
  return conflicts;
}

// ---------------------------------------------------------------------------------------------------------------
// Accesses

/** The fields of a period usage record that the counts read. */
export interface AccessRecord {
  sequence: number;
  research_id: string;
  series_id: string;
  from: string;
  to: string;
  recorded_at: string;
  purpose: "exploration" | "validation";
  source: "user_reported" | "tool_observed";
  request_sha256?: string;
}

/** Accesses indexed once per call (plan P-Q12 NIT): by series, and by (research_id, series_id). */
export class AccessIndex {
  private readonly bySeries = new Map<string, AccessRecord[]>();
  private readonly byResearch = new Map<string, AccessRecord[]>();

  constructor(records: AccessRecord[]) {
    for (const record of records) {
      push(this.bySeries, record.series_id, record);
      push(this.byResearch, `${record.research_id}\u0000${record.series_id}`, record);
    }
  }

  series(seriesId: string): AccessRecord[] { return this.bySeries.get(seriesId) ?? []; }
  research(researchId: string, seriesId: string): AccessRecord[] { return this.byResearch.get(`${researchId}\u0000${seriesId}`) ?? []; }
}
function push<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key);
  if (list) list.push(value); else map.set(key, [value]);
}

export interface DeclarationAccessCounts {
  other_research: number;
  declaring_research: {
    before_start: number; during: number; after_end: number;
    exploration: number; validation: number;
    user_reported: number; tool_observed: number;
    distinct_tool_requests: number;
  };
  declaring_access_covers_declared_period: boolean;
  declaring_accesses_extending_outside_declared_period: number;
  ended_without_declaring_research_access: boolean;
}

/**
 * Accesses on one series that overlap the declaration's effective period (design F6, G3). A withdrawn declaration
 * has an empty period, so everything is zero.
 */
export function accessCounts(view: DeclarationView, seriesId: string, index: AccessIndex, now: string): DeclarationAccessCounts {
  const { from } = view.line;
  const end = view.effective_to;
  const inPeriod = (record: AccessRecord) => end > from && overlaps(record.from, record.to, from, end);
  const others = index.series(seriesId).filter((record) => record.research_id !== view.line.research_id && inPeriod(record));
  const own = index.research(view.line.research_id, seriesId).filter(inPeriod);
  const count = (predicate: (record: AccessRecord) => boolean) => own.filter(predicate).length;
  return {
    other_research: others.length,
    declaring_research: {
      before_start: count((r) => r.recorded_at < from),
      during: count((r) => r.recorded_at >= from && r.recorded_at < end),
      after_end: count((r) => r.recorded_at >= end),
      exploration: count((r) => r.purpose === "exploration"),
      validation: count((r) => r.purpose === "validation"),
      user_reported: count((r) => r.source === "user_reported"),
      tool_observed: count((r) => r.source === "tool_observed"),
      distinct_tool_requests: new Set(own.filter((r) => r.source === "tool_observed" && r.request_sha256).map((r) => r.request_sha256)).size,
    },
    declaring_access_covers_declared_period: own.some((r) => r.recorded_at >= end && r.from <= from && r.to >= end),
    declaring_accesses_extending_outside_declared_period: count((r) => r.from < from || r.to > end),
    ended_without_declaring_research_access: stateOf(view, now) === "ended" && own.length === 0,
  };
}

/** Whether the declaring research recorded any access to the effective period on any of its series. */
function hasDeclaringAccess(view: DeclarationView, index: AccessIndex): boolean {
  const { from } = view.line;
  return view.effective_to > from && view.line.series_ids.some((series) => index.research(view.line.research_id, series)
    .some((record) => overlaps(record.from, record.to, from, view.effective_to)));
}

/** Other declarations with the same research ID or protocol hash, any series and time (design G6). */
export function relatedDeclarations(view: DeclarationView, views: Iterable<DeclarationView>, index: AccessIndex, now: string) {
  let total = 0, endedWithout = 0, shortenedLate = 0;
  for (const other of views) {
    if (other.line.declaration_id === view.line.declaration_id) continue;
    if (other.line.research_id !== view.line.research_id && other.line.protocol_sha256 !== view.line.protocol_sha256) continue;
    total++;
    if (stateOf(other, now) === "ended" && !hasDeclaringAccess(other, index)) endedWithout++;
    if (other.shortened_after_start) shortenedLate++;
  }
  return { total, ended_without_declaring_research_access: endedWithout, shortened_after_start: shortenedLate };
}

// ---------------------------------------------------------------------------------------------------------------
// Reports

export const hypothesisPopulationIsNotForward = (line: DeclarationLine) =>
  line.hypothesis !== null && (line.hypothesis.population === "in_sample" || line.hypothesis.population === "stress");

/** The static fields, shared by a batch's top-level map (design I1). */
export function staticFields(line: DeclarationLine) {
  return {
    declaration_id: line.declaration_id, research_id: line.research_id, series_ids: line.series_ids,
    from: line.from, to: line.to, protocol_sha256: line.protocol_sha256,
    hypothesis: line.hypothesis === null ? null : { ...line.hypothesis, hypothesis_population_is_not_forward: hypothesisPopulationIsNotForward(line) },
    recorded_at: line.recorded_at, lead_seconds: leadSeconds(line.from, line.recorded_at),
  };
}

/** The fields that depend on the point of view (as-of state, shortenings, counts). */
export function variableFields(view: DeclarationView, seriesId: string, views: Iterable<DeclarationView>, index: AccessIndex, now: string) {
  const counts = accessCounts(view, seriesId, index, now);
  return {
    effective_to: view.effective_to,
    shortenings: {
      total: view.shortenings.length,
      // The most recent ones have the smallest new_end, so the one that sets effective_to is always listed.
      listed: view.shortenings.slice(-FORWARD_PERIOD_SHORTENINGS_LISTED_CAP).reverse()
        .map((s) => ({ new_end: s.new_end, recorded_at: s.recorded_at, reason: s.reason })),
    },
    shortened_after_start: view.shortened_after_start,
    late_shortening: view.late_shortening,
    state: stateOf(view, now),
    accesses: { other_research: counts.other_research, declaring_research: counts.declaring_research },
    declaring_access_covers_declared_period: counts.declaring_access_covers_declared_period,
    declaring_accesses_extending_outside_declared_period: counts.declaring_accesses_extending_outside_declared_period,
    ended_without_declaring_research_access: counts.ended_without_declaring_research_access,
    related_declarations: relatedDeclarations(view, views, index, now),
  };
}

export interface QueryInterval { series_id: string; from: string; to: string }

/**
 * The declarations on one series for a query interval (design G2): listed when the original [from, to)
 * overlaps, active when [from, effective_to) does. Sorted active first, then by from, then by ID.
 */
export function selectForQuery(views: Iterable<DeclarationView>, query: QueryInterval) {
  const listed = [...views].filter((view) => view.line.series_ids.includes(query.series_id)
    && overlaps(view.line.from, view.line.to, query.from, query.to));
  const active = (view: DeclarationView) => isActiveFor(view, query.from, query.to);
  listed.sort((a, b) => Number(active(b)) - Number(active(a))
    || (a.line.from < b.line.from ? -1 : a.line.from > b.line.from ? 1 : 0)
    || (a.line.declaration_id < b.line.declaration_id ? -1 : 1));
  const withdrawn = listed.filter((view) => view.effective_to === view.line.from).length;
  const activeCount = listed.filter(active).length;
  return { listed, active: listed.filter(active), totals: {
    total: listed.length, active: activeCount, withdrawn, tail_only: listed.length - activeCount - withdrawn,
  } };
}

/** `forward_period_declarations` for a query, from lines and access records (design "Reporting"). */
export function describeForQuery(lines: ForwardPeriodLine[], accesses: AccessRecord[], query: QueryInterval, now: string,
  asOfLedgerSequence?: number) {
  const views = buildViews(lines, asOfLedgerSequence);
  const index = new AccessIndex(accesses);
  const { listed, totals } = selectForQuery(views.values(), query);
  const shown = listed.slice(0, FORWARD_PERIOD_LISTED_CAP);
  return {
    status: "available" as const,
    ...totals,
    listed: shown.map((view) => ({ ...staticFields(view.line), ...variableFields(view, query.series_id, views.values(), index, now) })),
    truncated: listed.length > shown.length,
  };
}
