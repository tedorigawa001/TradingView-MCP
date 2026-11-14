import { z } from "zod";
import { isCanonicalTimestamp } from "./firstSeenStore.js";
import { relationSnapshotSchema, type RelationJournalSnapshot } from "./researchRelationSnapshot.js";
import { relationView, SERIES_RELATION_LIMITS, type SeriesRelationRecord, type ResearchSeriesRelationStore } from "./researchSeriesRelations.js";
import type { ResearchPeriodUsageRecord, ResearchPeriodUsageStore } from "./researchPeriodUsage.js";
import type { ResearchTrialRecord, ResearchTrialStore } from "./researchTrials.js";

const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/).refine(isCanonicalTimestamp);
export const relatedHistoryQuerySchema = z.object({
  rules_version: z.literal("research_related_history_v1").default("research_related_history_v1"),
  target: z.enum(["usage", "trials"]), mode: z.enum(["exact", "aliases", "shared_source"]),
  series: z.array(z.object({ series_id: id, data_version: hash }).strict()).min(1).max(20)
    .refine(v => new Set(v.map(e => `${e.series_id}|${e.data_version}`)).size === v.length, "duplicate query series/version"),
  from: timestamp, to: timestamp,
  snapshots: z.object({ target: relationSnapshotSchema, registry: relationSnapshotSchema.optional() }).strict().optional(),
}).strict().refine(v => v.from < v.to, "from must be before to")
  .refine(v => !v.snapshots || (v.mode === "exact" ? !v.snapshots.registry : !!v.snapshots.registry), "snapshot pair required for expanded modes");
type Span = { from: string; to: string };
type RootSpan = Span & { root: string; path: string[] };
type Support = { roots: RootSpan[]; complete: boolean; issues: string[] };
const overlaps = (a: Span, b: Span) => a.from < b.to && b.from < a.to;
const intersection = (a: Span, b: Span): Span => ({ from: a.from > b.from ? a.from : b.from, to: a.to < b.to ? a.to : b.to });
function covered(span: Span, intervals: Span[]): boolean {
  let end = span.from;
  for (const i of [...intervals].sort((a, b) => a.from < b.from ? -1 : a.from > b.from ? 1 : 0)) {
    if (i.from > end) break;
    if (i.to > end) end = i.to;
    if (end >= span.to) return true;
  }
  return false;
}

function makeResolver(records: SeriesRelationRecord[], mode: "aliases" | "shared_source", spend: () => void) {
  const view = relationView(records);
  const adjacency = new Map<string, typeof view.aliases>();
  for (const edge of view.aliases) for (const v of [edge.left, edge.right]) {
    if (!adjacency.has(v)) adjacency.set(v, []);
    adjacency.get(v)!.push(edge);
  }
  let states = 0, producedRoots = 0;
  const addRoot = (roots: RootSpan[], r: RootSpan) => {
    spend();
    if (++producedRoots > SERIES_RELATION_LIMITS.roots || r.path.length > SERIES_RELATION_LIMITS.pathEntries) throw new Error("relation support/path limit exceeded");
    roots.push(r);
  };
  function resolveDefinition(definitionId: string, span: Span, stack: string[], resolutionMode = mode): Support {
    spend();
    if (stack.includes(definitionId)) throw new Error("derived relation cycle during resolution");
    const queue = [{ id: definitionId, span, path: [definitionId] }], visited = new Set<string>();
    const closure: typeof queue = [];
    while (queue.length) {
      spend();
      const next = queue.shift()!;
      if (next.path.length > SERIES_RELATION_LIMITS.pathEntries || stack.length > SERIES_RELATION_LIMITS.pathEntries) throw new Error("relation path limit exceeded");
      const definition = view.definitions.get(next.id);
      if (!definition || !overlaps(next.span, definition)) continue;
      const part = intersection(next.span, definition);
      const state = `${next.id}|${part.from}|${part.to}`;
      if (visited.has(state)) continue;
      visited.add(state);
      if (++states > SERIES_RELATION_LIMITS.states) throw new Error("relation state limit exceeded");
      closure.push({ ...next, span: part });
      for (const a of adjacency.get(next.id) ?? []) {
        spend();
        if (overlaps(part, a)) queue.push({ id: a.left === next.id ? a.right : a.left,
          span: intersection(part, a), path: [...next.path, a.entry_id, a.left === next.id ? a.right : a.left] });
      }
    }
    const roots: RootSpan[] = [], completeIntervals: Span[] = [], issues: string[] = [];
    let relatedUnresolved = false;
    for (const node of closure) {
      const d = view.definitions.get(node.id)!;
      for (const related of view.related) {
        spend();
        if ((related.left === node.id || related.right === node.id) && overlaps(node.span, related)) {
          relatedUnresolved = true; issues.push(`related_relation_unresolved:${related.entry_id}`);
        }
      }
      if (resolutionMode === "aliases" || d.role === "root") {
        addRoot(roots, { ...node.span, root: resolutionMode === "aliases" ? d.entry_id : d.root_id!, path: node.path });
        completeIntervals.push(node.span);
        continue;
      }
      const derivation = view.derivations.get(node.id);
      if (!derivation) continue;
      for (const w of derivation.windows) {
        spend();
        if (!overlaps(node.span, w)) continue;
        let complete = true;
        for (const s of w.supports) {
          const parent = resolveDefinition(s.parent, s, [...stack, definitionId, ...node.path.filter(p => view.definitions.has(p))], resolutionMode);
          complete = complete && parent.complete;
          issues.push(...parent.issues);
          for (const r of parent.roots) addRoot(roots, { ...r, path: [...node.path, derivation.entry_id, ...r.path] });
        }
        if (complete) completeIntervals.push(intersection(node.span, w));
      }
    }
    const complete = covered(span, completeIntervals) && !relatedUnresolved;
    return { roots, complete, issues: complete ? [] : [...new Set([...issues, `support_coverage_missing:${definitionId}`])] };
  }
  return (endpoint: { series_id: string; data_version: string }, span: Span, resolutionMode = mode): Support => {
    const d = view.endpoints.get(`${endpoint.series_id}|${endpoint.data_version}`);
    return d ? resolveDefinition(d.entry_id, span, [], resolutionMode)
      : { roots: [], complete: false, issues: [`definition_missing:${endpoint.series_id}:${endpoint.data_version}`] };
  };
}

type HistorySources = {
  usage?: Pick<ResearchPeriodUsageStore, "withRelationSnapshot">;
  trials?: Pick<ResearchTrialStore, "withRelationSnapshot">;
  relations: Pick<ResearchSeriesRelationStore, "filePath" | "withSnapshot">;
};
type Usage = ResearchPeriodUsageRecord;
type Trial = ResearchTrialRecord;
type HistoryRecord = Usage | Trial;
const seriesOf = (r: HistoryRecord) => "access_id" in r ? [r.series_id] : r.series_ids;

/** Explicit diagnostic only. Lock order: target journal -> registry; no forward journal is consulted. */
export async function checkRelatedResearchHistory(input: unknown, sources: HistorySources) {
  const q = relatedHistoryQuerySchema.parse(input);
  const expanded = q.mode !== "exact";
  const source = q.target === "usage" ? sources.usage : sources.trials;
  if (!source?.withRelationSnapshot) throw new Error("target journal does not support relation snapshots");
  const capture = async (target: RelationJournalSnapshot<HistoryRecord>) => {
    if (!expanded) return { target, registry: null, checked_at: target.checked_at };
    return sources.relations.withSnapshot(q.snapshots?.registry, registry => {
      if (target.records.some(r => r.recorded_at > registry.checked_at)) throw new Error("relation snapshot clock moved backwards");
      return { target, registry, checked_at: registry.checked_at };
    });
  };
  const captured = await source.withRelationSnapshot(expanded ? sources.relations.filePath : null, q.snapshots?.target, capture);
  // Only captured data below this point; all locks have been released.
  let steps = 0;
  const spend = () => { if (++steps > SERIES_RELATION_LIMITS.steps) throw new Error("relation work limit exceeded"); };
  const resolve = expanded ? makeResolver(captured.registry!.records, q.mode as "aliases" | "shared_source", spend) : null;
  const querySupports = q.series.map(s => resolve?.(s, q));
  // If either endpoint resolves completely, any alias overlap is already represented in the
  // root comparison. Only incomplete/incomplete pairs need an additional alias check.
  const incompleteQuerySeries = q.mode === "shared_source" ? q.series.filter((_, i) => !querySupports[i]!.complete) : [];
  // Reuse the captured view and its counters; no second resource budget for alias retention.
  let queryAliasSupports: Support[] | undefined;
  const compareSupports = (queries: (Support | undefined)[], support: Support, witnesses: unknown[]): boolean => {
    let found = false;
    for (const qs of queries) for (const a of qs!.roots) for (const b of support.roots) {
      spend();
      if (a.root !== b.root || !overlaps(a, b)) continue;
      found = true;
      if (witnesses.length < 5) witnesses.push({ root_id: a.root, overlap: intersection(a, b),
        query_path: a.path.slice(0, 32), record_path: b.path.slice(0, 32), path_truncated: a.path.length > 32 || b.path.length > 32 });
    }
    return found;
  };
  const issues = new Set(querySupports.flatMap(s => s?.issues ?? []));
  const matched: HistoryRecord[] = [];
  const detail: Array<{ record_id: string; match_basis: string; witnesses: unknown[]; record: HistoryRecord }> = [];
  let allComplete = querySupports.every(s => !s || s.complete);
  for (const record of captured.target.records) {
    spend();
    const ids = seriesOf(record);
    const exact = overlaps(record, q) && ids.some(id => q.series.some(s => s.series_id === id));
    let found = exact;
    let matchBasis: string = exact ? "exact" : q.mode;
    const witnesses: unknown[] = [];
    const incompleteRecordIds: string[] = [];
    if (resolve) for (const id of ids) {
      const support = resolve({ series_id: id, data_version: record.data_version }, record);
      allComplete = allComplete && support.complete;
      if (!support.complete) incompleteRecordIds.push(id);
      for (const issue of support.issues) issues.add(issue);
      if (compareSupports(querySupports, support, witnesses)) found = true;
    }
    if (!found && q.mode === "shared_source" && incompleteQuerySeries.length && incompleteRecordIds.length) {
      queryAliasSupports ??= incompleteQuerySeries.map(s => resolve!(s, q, "aliases"));
      for (const id of incompleteRecordIds) {
        const aliasSupport = resolve!({ series_id: id, data_version: record.data_version }, record, "aliases");
        if (compareSupports(queryAliasSupports, aliasSupport, witnesses)) {
          found = true; matchBasis = "aliases"; break;
        }
      }
    }
    if (found) {
      matched.push(record);
      if (detail.length < SERIES_RELATION_LIMITS.listed) detail.push({ record_id: "access_id" in record ? record.access_id : record.trial_set_id,
        match_basis: matchBasis, witnesses, record });
    }
  }
  let counts: Record<string, unknown>;
  if (q.target === "trials") {
    const records = matched as Trial[];
    const ids = new Set(records.map(r => r.trial_set_id));
    const outside = new Map<string, number>();
    for (const r of records) for (const reuse of r.reuses) if (!ids.has(reuse.trial_set_id))
      outside.set(reuse.trial_set_id, Math.max(outside.get(reuse.trial_set_id) ?? 0, reuse.configuration_count));
    const first = records.reduce((sum, r) => sum + r.configuration_count - r.reuses.reduce((s, reuse) => s + reuse.configuration_count, 0), 0);
    const reused = [...outside.values()].reduce((a, b) => a + b, 0);
    counts = { configurations_reported: records.reduce((sum, r) => sum + r.configuration_count, 0),
      configurations_new_within: first, configurations_reused_from_outside: reused, configurations_net: first + reused,
      total_is_lower_bound: true, configurations_are_independent_trials: false };
  } else counts = { exploration_records: (matched as Usage[]).filter(r => r.purpose === "exploration").length,
    validation_records: (matched as Usage[]).filter(r => r.purpose === "validation").length };
  return {
    contract: q.rules_version, evidence_scope: "caller_declared_support_and_recorded_access_reports", checked_at: captured.checked_at,
    query: { rules_version: q.rules_version, target: q.target, mode: q.mode, series: q.series, from: q.from, to: q.to },
    snapshots: { target: captured.target.anchor, ...(captured.registry ? { registry: captured.registry.anchor } : {}) },
    has_known_overlap: matched.length > 0, resolution_complete: allComplete,
    status: matched.length ? "known_overlap" : allComplete ? "no_known_overlap_in_snapshot" : "inconclusive",
    matching_records: matched.length, counts, matches: detail, truncated: matched.length > detail.length,
    unresolved_count: issues.size, unresolved: [...issues].slice(0, 100), unresolved_truncated: issues.size > 100,
    execution_allowed: false, unused_proven: false, candidateEligible: false,
    limitations: ["reported_relations_and_support_windows_not_source_authentication", "partial_windows_map_to_full_declared_parent_support",
      "unrecorded_and_external_usage_may_be_missing", "current_or_explicit_snapshot_not_historical_knowledge_attestation",
      "forward_alias_resolution_not_implemented", "old_reuses_validation_is_unchanged", "no_automatic_approval_path"],
  };
}
