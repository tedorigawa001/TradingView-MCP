import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { AppendOnlyFirstSeenLog, isCanonicalTimestamp } from "./firstSeenStore.js";
import { syncJournalForRetry } from "./fsDurability.js";
import { assertRelationJournalDistinct, readRelationJournalText, relationDigest, relationSnapshot, type RelationSnapshotAnchor, type RelationJournalSnapshot } from "./researchRelationSnapshot.js";

export const SERIES_RELATION_LIMITS = Object.freeze({ maxFileBytes: 8 * 1024 * 1024, maxRecordBytes: 16 * 1024,
  records: 8192, definitions: 512, relations: 1024, steps: 20_000, states: 8192, roots: 8192, pathEntries: 64, listed: 100, lockWaitMs: 2000 });
const id = z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/);
const hash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const timestamp = z.string().refine(isCanonicalTimestamp, "canonical UTC timestamp required")
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
const text = z.string().trim().min(1).max(240);
const interval = { from: timestamp, to: timestamp };
const ordered = (v: { from: string; to: string }) => v.from < v.to;
const identity = z.object({ provider: text, feed: text, instrument: text, price_basis: text, unit: text,
  timestamp_semantics: text, formation_sha256: hash }).strict();
const support = z.object({ parent: id, ...interval }).strict().refine(ordered);
const window = z.object({ ...interval, supports: z.array(support).min(1).max(8) }).strict().refine(ordered);
const common = { entry_id: id, evidence_sha256: hash };
const series = z.object({ ...common, kind: z.literal("series"), series_id: id, data_version: hash,
  identity, role: z.enum(["root", "derived"]), root_id: id.optional(), ...interval }).strict().refine(ordered)
  .refine(v => v.role === "root" ? v.root_id !== undefined : v.root_id === undefined, "only roots require root_id");
const alias = z.object({ ...common, kind: z.literal("alias"), left: id, right: id, ...interval }).strict().refine(ordered);
const related = z.object({ ...common, kind: z.literal("related"), left: id, right: id, ...interval, reason: text }).strict().refine(ordered);
const derivation = z.object({ ...common, kind: z.literal("derivation"), child: id, recipe_sha256: hash,
  mapping_schema: z.literal("declared_support_windows_v1"), windows: z.array(window).min(1).max(32) }).strict();
const revoke = z.object({ entry_id: id, kind: z.literal("revoke"), target: id, reason: text }).strict();
export const seriesRelationInputSchema = z.discriminatedUnion("kind", [series, alias, derivation, related, revoke]);
export const seriesRelationBatchSchema = z.array(seriesRelationInputSchema).min(1).max(20)
  .refine(v => new Set(v.map(e => e.entry_id)).size === v.length, "entry IDs must be unique");
type Input = z.infer<typeof seriesRelationInputSchema>;
type Definition = Extract<Input, { kind: "series" }>;
type Alias = Extract<Input, { kind: "alias" }>;
type Derivation = Extract<Input, { kind: "derivation" }>;
type Related = Extract<Input, { kind: "related" }>;
export type SeriesRelationRecord = { schema_version: "1.0"; namespace: "research_series_relations";
  sequence: number; recorded_at: string; first_seen_at: string; observation_date: string; definition_sha256: string; payload: Input };
const stored = z.object({ schema_version: z.literal("1.0"), namespace: z.literal("research_series_relations"),
  sequence: z.number().int().positive(), recorded_at: timestamp, first_seen_at: timestamp,
  observation_date: z.string(), definition_sha256: hash, payload: seriesRelationInputSchema }).strict();
const digestInput = (v: Input) => relationDigest(JSON.stringify(v));
function validateRecord(v: unknown): SeriesRelationRecord {
  const r = stored.parse(v);
  if (r.recorded_at !== r.first_seen_at || r.observation_date !== r.recorded_at.slice(0, 10)
    || r.definition_sha256 !== digestInput(r.payload)) throw new Error("invalid relation record hash or dates");
  return r;
}
const key = (v: { series_id: string; data_version: string }) => `${v.series_id}|${v.data_version}`;
const inside = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from >= b.from && a.to <= b.to;
const intersects = (a: { from: string; to: string }, b: { from: string; to: string }) => a.from < b.to && b.from < a.to;
const clip = (a: { from: string; to: string }, b: { from: string; to: string }) =>
  ({ from: a.from > b.from ? a.from : b.from, to: a.to < b.to ? a.to : b.to });

export function relationView(records: SeriesRelationRecord[]) {
  const active = new Map<string, Input>();
  const all = new Set<string>();
  for (const record of records) {
    const p = record.payload;
    if (all.has(p.entry_id)) throw new Error("duplicate relation entry ID");
    all.add(p.entry_id);
    if (p.kind === "revoke") {
      if (!active.has(p.target)) throw new Error("revoke target is not active");
      active.delete(p.target);
    } else {
      const refs = p.kind === "alias" || p.kind === "related" ? [p.left, p.right] : p.kind === "derivation" ? [p.child, ...p.windows.flatMap(w => w.supports.map(s => s.parent))] : [];
      if (refs.some(ref => active.get(ref)?.kind !== "series")) throw new Error("relation definition reference missing or revoked");
      active.set(p.entry_id, p);
    }
  }
  const definitions = new Map<string, Definition>();
  const endpoints = new Map<string, Definition>();
  const roots = new Map<string, string>();
  for (const p of active.values()) if (p.kind === "series") {
    if (endpoints.has(key(p))) throw new Error("duplicate active series definition");
    definitions.set(p.entry_id, p); endpoints.set(key(p), p);
    if (p.role === "root") {
      const encoded = JSON.stringify(p.identity);
      if (roots.has(p.root_id!) && roots.get(p.root_id!) !== encoded) throw new Error("root identity conflict");
      roots.set(p.root_id!, encoded);
    }
  }
  const aliases: Alias[] = [], related: Related[] = [], derivations = new Map<string, Derivation>();
  for (const p of active.values()) {
    if (p.kind === "alias") {
      const a = definitions.get(p.left), b = definitions.get(p.right);
      // Revoking a definition makes its old relations unusable, never rebound to a replacement definition.
      if (!a || !b) continue;
      if (p.left === p.right || a.role !== b.role || JSON.stringify(a.identity) !== JSON.stringify(b.identity)
        || !inside(p, a) || !inside(p, b)) throw new Error("alias identity or coverage mismatch");
      aliases.push(p);
    } else if (p.kind === "related") {
      if (p.left === p.right) throw new Error("related endpoints must differ");
      related.push(p);
    } else if (p.kind === "derivation") {
      const child = definitions.get(p.child);
      if (!child) continue;
      if (child.role !== "derived" || child.identity.formation_sha256 !== p.recipe_sha256) throw new Error("invalid derivation identity");
      if (derivations.has(p.child)) throw new Error("duplicate active derivation");
      const windows = [...p.windows].sort((a, b) => a.from.localeCompare(b.from));
      for (let i = 0; i < windows.length; i++) {
        const w = windows[i];
        if (!inside(w, child) || (i && windows[i - 1].to > w.from)) throw new Error("invalid or overlapping support windows");
        for (const s of w.supports) {
          const parent = definitions.get(s.parent);
          if (parent && !inside(s, parent)) throw new Error("parent support outside declared coverage");
        }
      }
      derivations.set(p.child, p);
    }
  }
  if (definitions.size > SERIES_RELATION_LIMITS.definitions || aliases.length + derivations.size + related.length > SERIES_RELATION_LIMITS.relations) throw new Error("relation graph limit exceeded");
  // Collapse aliases before checking dependency cycles, including cycles that pass through an alias.
  const representative = new Map([...definitions.keys()].map(k => [k, k]));
  const find = (k: string): string => { let p = k; while (representative.get(p) !== p) p = representative.get(p)!; return p; };
  for (const a of aliases) representative.set(find(a.left), find(a.right));
  const dependencies = new Map<string, Set<string>>();
  for (const d of derivations.values()) for (const w of d.windows) for (const s of w.supports) if (definitions.has(s.parent)) {
    const from = find(d.child), to = find(s.parent);
    if (!dependencies.has(from)) dependencies.set(from, new Set());
    dependencies.get(from)!.add(to);
  }
  const done = new Set<string>(), visiting = new Set<string>();
  const visit = (v: string) => {
    if (visiting.has(v)) throw new Error("derived relation cycle");
    if (done.has(v)) return;
    visiting.add(v); for (const p of dependencies.get(v) ?? []) visit(p); visiting.delete(v); done.add(v);
  };
  for (const v of dependencies.keys()) visit(v);
  return { definitions, endpoints, aliases, derivations, related };
}

export const resolveSeriesRelationsPath = (configured = process.env.TRADINGVIEW_MCP_SERIES_RELATIONS_PATH): string =>
  configured?.trim() || join(homedir(), ".tradingview-mcp", "research-series-relations.jsonl");

export class ResearchSeriesRelationStore {
  private readonly log: AppendOnlyFirstSeenLog<SeriesRelationRecord>;
  private readonly clock: () => Date;
  constructor(readonly filePath = resolveSeriesRelationsPath(), options: { now?: () => Date; protectedPaths?: string[] } = {}) {
    const defaults = ["research-period-usage.jsonl", "research-trials.jsonl", "strategy-research-journal.jsonl",
      "measurement-research-journal.jsonl", "forward-period-declarations.jsonl"].map(p => join(homedir(), ".tradingview-mcp", p));
    const configured = [process.env.TRADINGVIEW_MCP_RESEARCH_TRIALS_PATH, process.env.TRADINGVIEW_MCP_STRATEGY_RESEARCH_JOURNAL_PATH,
      process.env.TRADINGVIEW_MCP_MEASUREMENT_RESEARCH_JOURNAL_PATH, process.env.TRADINGVIEW_MCP_FORWARD_PERIOD_JOURNAL_PATH].filter((p): p is string => !!p?.trim()).map(p => p.trim());
    for (const path of [...defaults, ...configured, ...(options.protectedPaths ?? [])]) assertRelationJournalDistinct(filePath, path);
    this.log = new AppendOnlyFirstSeenLog(filePath, "research series relations", validateRecord, SERIES_RELATION_LIMITS);
    this.clock = options.now ?? (() => new Date());
  }
  private async readUnlocked(now: string) {
    const raw = await readRelationJournalText(this.filePath);
    if (raw && (!raw.endsWith("\n") || raw.slice(0, -1).split("\n").some(l => !l.trim()
      || Buffer.byteLength(l, "utf8") + 1 > SERIES_RELATION_LIMITS.maxRecordBytes))) throw new Error("invalid relation JSONL framing");
    const records = await this.log.readAllUnlocked();
    if (records.length > SERIES_RELATION_LIMITS.records) throw new Error("relation journal record limit exceeded");
    if (records.length && records.at(-1)!.recorded_at > now) throw new Error("relation clock moved backwards");
    relationView(records);
    return { records, raw };
  }
  async recordBatch(input: unknown) {
    const requests = seriesRelationBatchSchema.parse(input);
    return this.log.serializeWithin(SERIES_RELATION_LIMITS.lockWaitMs, async () => {
      const now = this.clock().toISOString();
      const { records } = await this.readUnlocked(now);
      const known = new Map(records.map(r => [r.payload.entry_id, r]));
      const planned: SeriesRelationRecord[] = [], results: Array<{ idempotent: boolean; entry: SeriesRelationRecord }> = [];
      for (const p of requests) {
        const existing = known.get(p.entry_id);
        if (existing) {
          if (existing.definition_sha256 !== digestInput(p)) throw new Error("relation entry ID conflict");
          results.push({ idempotent: true, entry: existing }); continue;
        }
        const r: SeriesRelationRecord = { schema_version: "1.0", namespace: "research_series_relations", sequence: records.length + planned.length + 1,
          recorded_at: now, first_seen_at: now, observation_date: now.slice(0, 10), definition_sha256: digestInput(p), payload: p };
        planned.push(r); known.set(p.entry_id, r); results.push({ idempotent: false, entry: r });
      }
      if (records.length + planned.length > SERIES_RELATION_LIMITS.records) throw new Error("relation journal record limit exceeded");
      // References must name definitions already recorded, including earlier definitions of this batch.
      const seen = new Map(records.filter(r => r.payload.kind !== "revoke").map(r => [r.payload.entry_id, r.payload]));
      for (const r of planned) {
        const p = r.payload;
        const refs = p.kind === "alias" || p.kind === "related" ? [p.left, p.right] : p.kind === "derivation" ? [p.child, ...p.windows.flatMap(w => w.supports.map(s => s.parent))] : [];
        if (refs.some(ref => seen.get(ref)?.kind !== "series")) throw new Error("relation definition reference missing");
        seen.set(p.entry_id, p);
      }
      for (let i = 1; i <= planned.length; i++) relationView([...records, ...planned.slice(0, i)]);
      if (planned.length) await this.log.assertAppendableUnlocked(records, planned);
      if (results.some(r => r.idempotent)) await syncJournalForRetry(this.filePath, "research series relations");
      for (const r of planned) await this.log.appendUnlocked(r);
      return { recorded: planned.length, idempotent: results.length - planned.length, results };
    });
  }
  async withSnapshot<T>(selection: RelationSnapshotAnchor | undefined, operation: (s: RelationJournalSnapshot<SeriesRelationRecord>) => T | Promise<T>): Promise<T> {
    return this.log.serializeWithin(SERIES_RELATION_LIMITS.lockWaitMs, async () => {
      const now = this.clock().toISOString();
      const { records, raw } = await this.readUnlocked(now);
      return operation(relationSnapshot("research_series_relations", records, raw, now, selection, SERIES_RELATION_LIMITS.records));
    });
  }
}
