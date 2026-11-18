/** Explicit, pure validation only. No collector, clock, measurement or journal calls. */
import { createHash } from "node:crypto";
import type { NativeSmaSeries } from "./smaCrossMeasurement.js";
import { SMA_CROSS_V2_ID, SMA_CROSS_V2_HASH, SMA_PERIOD_START, SMA_PERIOD_END } from "./smaCrossMeasurement.js";

export type FrozenSmaPackage = {
  evidence: Uint8Array; manifest: Uint8Array; manifestHash: string;
  pages: readonly { id: string; bytes: Uint8Array }[];
  artifacts: readonly { id: string; bytes: Uint8Array }[];
  /** Optional commitments fixed by the caller at a previous review/freeze boundary. */
  expectedProjection?: Readonly<{ normalized: string; mapping: string }>;
};
export type SmaAdapterTrust = { approvedEvidence: readonly { id: string; sha256: string }[] };
export type SmaAdapterResult = {
  status: "accepted" | "held" | "stopped"; reason: string | null;
  executionAllowed: false; adoptionAllowed: false; series: readonly NativeSmaSeries[] | null;
  globalAtomicity: false;
  seriesResults: readonly { key: string; status: "accepted" | "held"; reason: string | null;
    snapshot: string | null; bars: number | null }[];
  mapping: readonly Mapping[] | null;
  commitments: { normalized: string; mapping: string; manifest: string } | null;
  auditManifest: string | null;
  usage: Readonly<Record<string, number>>;
  remaining: Readonly<Record<string, number>>;
  acquisitionCountKnown: boolean;
  retention: "caller_retains_originals";
};

/** Exclusive thresholds. Purpose maxima (warmup 8311, witness 1) are inclusive. */
export const SMA_ADAPTER_LIMITS = Object.freeze({
  dataRequests: 32, evidenceRequests: 8, requests: 40,
  dataBytes: 32 * 1024 * 1024, evidenceBytes: 512 * 1024, bytes: 33_554_432 + 524_288,
  occurrences: 131_072, normalizedBars: 131_072, mappingRows: 131_072,
  work: 4_194_304, normalizedBytes: 32 * 1024 * 1024, mappingBytes: 16 * 1024 * 1024,
  manifestBytes: 256 * 1024, diagnosticBytes: 64 * 1024,
});
type Counter = keyof typeof SMA_ADAPTER_LIMITS;
class AdapterStop extends Error {}
class AdapterHold extends Error {}
/** Public metering primitive, also useful for verifying exact threshold behavior without huge fixtures. */
export class SmaAdapterBudget {
  #used = Object.fromEntries(Object.keys(SMA_ADAPTER_LIMITS).map(key => [key, 0])) as Record<Counter, number>;
  #stop: string | null = null;
  charge(key: Counter, amount = 1): void {
    if (this.#stop) throw new AdapterStop(this.#stop);
    if (!Object.hasOwn(SMA_ADAPTER_LIMITS, key)) this.stop("unknown_budget_counter");
    if (!Number.isSafeInteger(amount) || amount < 0 || this.#used[key] + amount >= SMA_ADAPTER_LIMITS[key]) {
      this.#stop = `${key}_limit`; throw new AdapterStop(this.#stop);
    }
    this.#used[key] += amount;
  }
  stop(reason: string): never { this.#stop ??= reason; throw new AdapterStop(this.#stop); }
  get usage() { return { ...this.#used }; }
  get remaining() { return Object.fromEntries(Object.entries(SMA_ADAPTER_LIMITS).map(([k, v]) => [k, v - this.#used[k as Counter]])); }
  /** May only account for the small terminal diagnostic; never clears the stop latch. */
  finishDiagnostic(bytes: number): void {
    if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes + 256 >= SMA_ADAPTER_LIMITS.diagnosticBytes) this.stop("diagnosticBytes_limit");
    this.#used.diagnosticBytes = Math.max(this.#used.diagnosticBytes, bytes + 256, 1024);
  }
}
type Row = Record<string, any>;
type Mapping = { series: string; page: string; row: number; normalized: number | null; disposition: "bar" | "duplicate" | "witness" };
const KEYS = ["OANDA:EURUSD|30", "OANDA:EURUSD|60", "OANDA:XAUUSD|30", "OANDA:XAUUSD|60"];
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function hold(reason: string): never { throw new AdapterHold(reason); }
const integer = (value: unknown): value is number => Number.isSafeInteger(value);

function hash(value: Uint8Array | string, budget: SmaAdapterBudget): string {
  budget.charge("work", Math.ceil((typeof value === "string" ? Buffer.byteLength(value) : value.byteLength) / 64));
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
function id(value: unknown, b: SmaAdapterBudget): asserts value is string {
  b.charge("work");
  if (typeof value !== "string" || !value.length || Buffer.byteLength(value) >= 256 || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) b.stop("invalid_reference");
}
function list(value: unknown, b: SmaAdapterBudget): asserts value is any[] {
  b.charge("work");
  if (!Array.isArray(value)) b.stop("invalid_array");
}
function object(value: unknown, b: SmaAdapterBudget): asserts value is Row {
  b.charge("work");
  if (!value || typeof value !== "object" || Array.isArray(value)) b.stop("invalid_object");
}
function boundedBytes(value: Uint8Array, limit: number, b: SmaAdapterBudget): Uint8Array {
  if (!(value instanceof Uint8Array) || value.buffer instanceof SharedArrayBuffer || value.byteLength >= limit) b.stop("input_bytes_limit");
  return value;
}
function parse(raw: Uint8Array, limit: number, b: SmaAdapterBudget): Row {
  boundedBytes(raw, limit, b);
  b.charge("work", Math.ceil(raw.byteLength / 64));
  let text: string;
  try { text = utf8.decode(raw); } catch { return b.stop("invalid_utf8"); }
  // Preflight nesting before JSON.parse allocates a deeply nested structure.
  const stack: { object: boolean; key: boolean; keys: Set<string>; lastKey: string | null;
    expectingValue: boolean; items: number; arrayLimit: number }[] = [];
  let quoted = false, escaped = false, begin = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], top = stack.at(-1);
    if (quoted) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') {
        quoted = false;
        if (top?.object && top.key) {
          let key: string;
          try { key = JSON.parse(text.slice(begin, i + 1)); } catch { return b.stop("invalid_json"); }
          id(key, b);
          if (top.keys.has(key)) b.stop("duplicate_json_key");
          if (top.keys.size + 1 >= 64) b.stop("object_keys_limit");
          top.keys.add(key); top.key = false; top.lastKey = key;
        }
      }
    } else {
      if (top && !top.object && top.expectingValue && c !== "]" && c !== "," && !/\s/.test(c)) {
        if (++top.items >= top.arrayLimit) b.stop(top.arrayLimit === 4096 ? "page_occurrences_limit" : "structure_array_limit");
        top.expectingValue = false;
      }
      if (c === '"') { quoted = true; begin = i; }
      else if (c === "{" || c === "[") {
        if (stack.length + 1 >= 16) b.stop("structure_depth_limit");
        stack.push({ object: c === "{", key: true, keys: new Set(), lastKey: null,
          expectingValue: true, items: 0, arrayLimit: top?.object && top.lastKey === "bars" ? 4096 : 131_072 });
      } else if (c === "}" || c === "]") stack.pop();
      else if (c === "," && top) { if (top.object) top.key = true; else top.expectingValue = true; }
    }
  }
  let value: any;
  try { value = JSON.parse(text); } catch { return b.stop("invalid_json"); }
  const visit = (v: any): void => {
    b.charge("work");
    if (typeof v === "string") { id(v, b); return; }
    if (typeof v === "number" && !Number.isFinite(v)) b.stop("nonfinite_json_number");
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      if (v.length >= 131_072) b.stop("structure_array_limit");
      for (const x of v) visit(x);
    } else {
      const keys = Object.keys(v);
      if (keys.length >= 64) b.stop("object_keys_limit");
      for (const key of keys) { id(key, b); visit(v[key]); }
    }
  };
  visit(value); object(value, b); return value;
}
function refs(value: unknown, allowed: readonly string[], required: string, b: SmaAdapterBudget): void {
  list(value, b);
  if (value.length >= 8) b.stop("evidence_refs_limit");
  for (const ref of value) { id(ref, b); if (!allowed.includes(ref)) hold("unapproved_evidence_reference"); }
  if (!value.includes(required)) hold("evidence_role_unverified");
}
/** Bounded incremental JSON encoding: never builds a whole oversized output first. */
function encode(value: any, counter: Counter, b: SmaAdapterBudget): string {
  const chunks: string[] = [];
  const append = (s: string) => { b.charge(counter, Buffer.byteLength(s)); b.charge("work", Math.max(1, Math.ceil(Buffer.byteLength(s) / 64))); chunks.push(s); };
  const visit = (v: any): void => {
    if (v === null || typeof v !== "object") { append(JSON.stringify(v)); return; }
    const array = Array.isArray(v), entries = array ? v : Object.keys(v);
    append(array ? "[" : "{");
    entries.forEach((entry: any, i: number) => {
      if (i) append(",");
      if (!array) { append(JSON.stringify(entry)); append(":"); }
      visit(array ? entry : v[entry]);
    });
    append(array ? "]" : "}");
  };
  visit(value); return chunks.join("");
}
function freeze<T>(value: T, budget?: SmaAdapterBudget): T {
  budget?.charge("work");
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) freeze(v, budget);
    Object.freeze(value);
  }
  return value;
}

export function adaptSmaCrossV2(input: FrozenSmaPackage, trust: SmaAdapterTrust): SmaAdapterResult {
  const b = new SmaAdapterBudget();
  const seriesResults: SmaAdapterResult["seriesResults"][number][] = [];
  const normalized: NativeSmaSeries[] = [], mapping: Mapping[] = [];
  const originals: { bytes: Uint8Array; sha256: string }[] = [];
  let acquisitionCountKnown = false;
  let acquisitionHold: string | null = null;
  const result = (status: SmaAdapterResult["status"], reason: string | null,
    success?: Pick<SmaAdapterResult, "series" | "mapping" | "commitments" | "auditManifest">): SmaAdapterResult => {
    const summary = { status, reason, series: null, mapping: null, commitments: null, auditManifest: null,
      seriesResults, executionAllowed: false as const, adoptionAllowed: false as const, globalAtomicity: false as const,
      usage: b.usage, remaining: b.remaining, acquisitionCountKnown, retention: "caller_retains_originals" as const };
    // At most four fixed series keys and four <=255-byte snapshot identifiers: bounded before stringify.
    b.finishDiagnostic(Buffer.byteLength(JSON.stringify(summary)));
    return freeze({ ...summary, ...success, usage: b.usage, remaining: b.remaining });
  };
  try {
    // A fixed 1 KiB diagnostic reserve is charged before any fallible validation.
    b.charge("diagnosticBytes", 1024);
    const evidenceHash = hash(boundedBytes(input.evidence, 256 * 1024, b), b);
    if (!trust.approvedEvidence.some(root => root.sha256 === evidenceHash)) hold("evidence_not_approved");
    const evidence = parse(input.evidence, 256 * 1024, b);
    if (!trust.approvedEvidence.some(root => root.id === evidence.id && root.sha256 === evidenceHash)) hold("evidence_not_approved");
    if (evidence.format !== "sma-evidence-v1") hold("unsupported_evidence_format");
    const manifestHash = hash(boundedBytes(input.manifest, 256 * 1024, b), b);
    if (manifestHash !== input.manifestHash) b.stop("manifest_hash_mismatch");
    const manifest = parse(input.manifest, 256 * 1024, b);
    if (manifest.format !== "sma-frozen-package-v1" || manifest.definitionId !== SMA_CROSS_V2_ID ||
      manifest.definitionHash !== SMA_CROSS_V2_HASH || manifest.periodFrom !== SMA_PERIOD_START || manifest.periodThrough !== SMA_PERIOD_END) hold("study_scope_mismatch");
    if (manifest.evidenceId !== evidence.id || manifest.evidenceHash !== evidenceHash) b.stop("evidence_binding_mismatch");
    originals.push({ bytes: input.evidence, sha256: evidenceHash }, { bytes: input.manifest, sha256: manifestHash });
    list(evidence.scopes, b); list(evidence.sources, b); list(evidence.calendars, b);
    if (evidence.scopes.length !== 4) hold("evidence_scope_incomplete");
    if (evidence.calendars.length >= 8) b.stop("calendar_commitment_limit");
    const sourceIds = new Set<string>();
    for (const source of evidence.sources) {
      object(source, b); id(source.id, b); id(source.version, b);
      if (!/^sha256:[a-f0-9]{64}$/.test(source.sha256) || sourceIds.has(source.id)) b.stop("invalid_source_commitment");
      sourceIds.add(source.id);
    }
    list(manifest.pages, b); list(manifest.artifacts, b); list(input.pages, b); list(input.artifacts, b);
    if (manifest.pages.length !== input.pages.length || manifest.artifacts.length !== input.artifacts.length) b.stop("receipt_set_mismatch");
    b.charge("dataRequests", manifest.pages.length); b.charge("evidenceRequests", manifest.artifacts.length);
    b.charge("requests", manifest.pages.length + manifest.artifacts.length);
    acquisitionCountKnown = [...manifest.pages, ...manifest.artifacts].every(receipt => integer(receipt?.internalQueries));
    for (const page of manifest.pages) {
      object(page, b);
      if (!KEYS.includes(page.series)) b.stop("unscoped_data_page");
    }
    const captured = new Map<string, Row>();
    for (const [items, receipts, kind] of [[input.artifacts, manifest.artifacts, "evidence"], [input.pages, manifest.pages, "data"]] as const) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i], receipt = receipts[i]; object(item, b); object(receipt, b); id(item.id, b);
        if (item.id !== receipt.id || captured.has(item.id + ":" + kind)) b.stop("receipt_identity_mismatch");
        boundedBytes(item.bytes, kind === "data" ? 1024 * 1024 : 64 * 1024, b);
        // Body bytes plus the captured numeric status, excluding transport headers.
        const size = item.bytes.byteLength + Buffer.byteLength(JSON.stringify(receipt.status) ?? "null");
        if (size >= (kind === "data" ? 1024 * 1024 : 64 * 1024)) b.stop("response_bytes_limit");
        b.charge(kind === "data" ? "dataBytes" : "evidenceBytes", size); b.charge("bytes", size);
        if (receipt.byteLength !== item.bytes.byteLength || hash(item.bytes, b) !== receipt.sha256) b.stop("raw_hash_mismatch");
        originals.push({ bytes: item.bytes, sha256: receipt.sha256 });
        if (!integer(receipt.internalQueries)) { acquisitionCountKnown = false; acquisitionHold = "internal_query_count_unknown"; }
        if ((integer(receipt.internalQueries) && receipt.internalQueries !== 1) || receipt.retries !== 0) b.stop("no_retry_unverified");
        if (receipt.status !== 200 || !item.bytes.length) b.stop("acquisition_failed");
        captured.set(item.id + ":" + kind, parse(item.bytes, kind === "data" ? 1024 * 1024 : 64 * 1024, b));
      }
    }
    const scopeKeys = new Set<string>();
    for (const scope of evidence.scopes) {
      object(scope, b); id(scope.key, b);
      if (!KEYS.includes(scope.key) || scopeKeys.has(scope.key)) b.stop("invalid_series_scope");
      scopeKeys.add(scope.key);
      try {
        const series = normalizeSeries(scope, evidence, manifest, captured, mapping, sourceIds, b);
        normalized.push(series.value);
        seriesResults.push({ key: scope.key, status: "accepted", reason: null, snapshot: series.snapshot, bars: series.value.bars.length });
      } catch (error) {
        if (!(error instanceof AdapterHold)) throw error;
        seriesResults.push({ key: scope.key, status: "held", reason: error.message, snapshot: null, bars: null });
      }
    }
    if (acquisitionHold) return result("held", acquisitionHold);
    if (seriesResults.some(row => row.status === "held")) return result("held", "series_not_accepted");
    freeze(normalized, b); freeze(mapping, b);
    const normalizedJson = encode(normalized, "normalizedBytes", b), mappingJson = encode(mapping, "mappingBytes", b);
    const normalizedHash = hash(normalizedJson, b), mappingHash = hash(mappingJson, b);
    if (input.expectedProjection && (input.expectedProjection.normalized !== normalizedHash || input.expectedProjection.mapping !== mappingHash)) b.stop("projection_commitment_mismatch");
    const auditManifest = encode({ format: "sma-adapter-audit-v1", definitionId: SMA_CROSS_V2_ID, definitionHash: SMA_CROSS_V2_HASH,
      acquisitionManifest: manifestHash, evidence: evidenceHash, sources: originals.map(x => x.sha256),
      normalized: normalizedHash, mapping: mappingHash, globalAtomicity: false, series: seriesResults }, "manifestBytes", b);
    for (const original of originals) if (hash(original.bytes, b) !== original.sha256) b.stop("raw_changed_during_validation");
    return result("accepted", null, { series: normalized, mapping, auditManifest,
      commitments: { normalized: normalizedHash, mapping: mappingHash, manifest: hash(auditManifest, b) } });
  } catch (error) {
    return result(error instanceof AdapterHold ? "held" : "stopped", error instanceof AdapterHold || error instanceof AdapterStop ? error.message : "malformed_package");
  }
}

type CapturedSmaBar = { bar: Row; page: string; row: number; receipt: Row };
/** Integrity is unconditional: no price, clock, reference or coverage hold may skip a later page. */
function inspectSeriesPages(scope: Row, manifest: Row, captured: Map<string, Row>, mapping: Mapping[], b: SmaAdapterBudget): {
  receipts: Row[]; raw: CapturedSmaBar[]; unique: CapturedSmaBar[]; snapshot: string | null;
} {
  object(scope.context, b);
  const receipts: Row[] = manifest.pages.filter((p: Row) => p.series === scope.key);
  if (receipts.length >= 8) b.stop("series_request_limit");
  const raw: CapturedSmaBar[] = [];
  let snapshot: string | null = null, count = 0;
  for (const receipt of receipts) {
    const page = captured.get(receipt.id + ":data");
    if (!page || page.format !== "native-sma-page-v1") b.stop("unsupported_response_format");
    for (const context of [receipt.request, page.before, page.after]) if (!equal(context, scope.context, b)) b.stop("context_changed");
    object(page.snapshot, b); id(page.snapshot.id, b);
    if (snapshot !== null && snapshot !== page.snapshot.id) b.stop("snapshot_changed");
    snapshot = page.snapshot.id;
    list(page.bars, b);
    if (!page.bars.length) b.stop("empty_page");
    if (page.bars.length >= 4096) b.stop("page_occurrences_limit");
    for (let i = 0; i < page.bars.length; i++) {
      b.charge("work"); b.charge("occurrences");
      if (++count >= 32768) b.stop("series_occurrences_limit");
      const bar = page.bars[i]; object(bar, b);
      if (!integer(bar.openAt) || !integer(bar.endAt) || bar.openAt >= bar.endAt) b.stop("invalid_bar_time");
      if (i && ((scope.order === "ascending" && bar.endAt <= page.bars[i - 1].endAt) ||
        (scope.order === "descending" && bar.endAt >= page.bars[i - 1].endAt))) b.stop("bar_order");
      raw.push({ bar, page: receipt.id, row: i, receipt });
    }
  }
  // Only an explicit descending traversal is reversed; unsupported order is held in the quality phase.
  if (scope.order === "descending") raw.reverse();
  const unique: CapturedSmaBar[] = [], indexByEnd = new Map<number, number>();
  let warmup = 0, witness = 0;
  for (const item of raw) {
    b.charge("work");
    const oldIndex = indexByEnd.get(item.bar.endAt);
    let index: number, disposition: Mapping["disposition"] = item.bar.endAt >= SMA_PERIOD_END ? "witness" : "bar";
    if (oldIndex !== undefined) {
      if (!equal(unique[oldIndex].bar, item.bar, b)) b.stop("conflicting_bar");
      index = oldIndex; disposition = "duplicate";
    } else {
      if (["ascending", "descending"].includes(scope.order) && unique.length && item.bar.openAt < unique.at(-1)!.bar.endAt) b.stop("bar_order_or_overlap");
      index = unique.length; indexByEnd.set(item.bar.endAt, index); unique.push(item);
      if (item.bar.endAt < SMA_PERIOD_START) warmup++;
      if (item.bar.endAt >= SMA_PERIOD_END) witness++;
      if (warmup > 8311 || witness > 1) b.stop("purpose_bar_limit");
    }
    b.charge("mappingRows");
    mapping.push({ series: scope.key, page: item.page, row: item.row,
      normalized: item.bar.endAt >= SMA_PERIOD_END ? null : index, disposition });
  }
  return { receipts, raw, unique, snapshot };
}

function normalizeSeries(scope: Row, evidence: Row, manifest: Row, captured: Map<string, Row>, mapping: Mapping[], sourceIds: Set<string>, b: SmaAdapterBudget): { value: NativeSmaSeries; snapshot: string } {
  const { receipts, raw, unique, snapshot } = inspectSeriesPages(scope, manifest, captured, mapping, b);
  const [symbol, timeframe] = scope.key.split("|");
  if (scope.context.provider !== "OANDA" || scope.context.symbol !== symbol || scope.context.timeframe !== timeframe ||
    scope.context.native !== true || scope.context.timestampUnit !== "utc_ms" || scope.context.format !== "native-sma-page-v1") hold("unsupported_native_contract");
  id(scope.context.route, b); id(scope.context.routeVersion, b); id(scope.context.region, b);
  if (scope.snapshot !== "series-history-v1" || scope.confirmation !== "native-or-successor-v1" ||
    scope.calendar !== "explicit-native-calendar-v1" || !["ascending", "descending"].includes(scope.order)) hold("unsupported_contract");
  object(scope.rules, b);
  for (const name of ["sessions", "dst", "holidays", "shortened", "noTrade"]) id(scope.rules[name], b);
  object(scope.clock, b); id(scope.clock.source, b);
  if (!integer(scope.clock.maxPrecisionMs) || scope.clock.maxPrecisionMs < 0) hold("observation_clock_unverified");
  list(scope.evidenceRefs, b);
  if (scope.evidenceRefs.length >= 8) b.stop("evidence_refs_limit");
  for (const ref of scope.evidenceRefs) { id(ref, b); if (!sourceIds.has(ref)) hold("unapproved_evidence_reference"); }
  // Role names are explicit in this first supported contract, not inferred from arbitrary booleans.
  const calendarRef = "calendar-rule", confirmationRef = "native-confirmation", snapshotRef = "snapshot-rule";
  for (const ref of [calendarRef, confirmationRef, snapshotRef]) if (!scope.evidenceRefs.includes(ref)) hold("evidence_role_unverified");
  const calendar = captured.get(scope.calendarId + ":evidence");
  const calendarReceipt = manifest.artifacts.find((a: Row) => a.id === scope.calendarId);
  if (!calendar || !calendarReceipt || !evidence.calendars.some((c: Row) => c.id === scope.calendarId && c.sha256 === calendarReceipt.sha256)) hold("calendar_not_approved");
  if (calendar.format !== "explicit-native-calendar-v1" || calendar.id !== scope.calendarId ||
    !integer(scope.from) || !integer(scope.through) || calendar.from !== scope.from || calendar.through !== scope.through ||
    scope.from > SMA_PERIOD_START || scope.through < SMA_PERIOD_END) hold("calendar_applicability_unverified");
  if (!receipts.length) hold("series_data_missing");
  for (const receipt of receipts) {
    const page = captured.get(receipt.id + ":data")!;
    if (!integer(receipt.observedFrom) || !integer(receipt.observedThrough) || receipt.observedThrough < receipt.observedFrom ||
      !receipt.clock || receipt.clock.source !== scope.clock.source || !integer(receipt.clock.precisionMs) ||
      receipt.clock.precisionMs < 0 || receipt.clock.precisionMs > scope.clock.maxPrecisionMs) hold("observation_clock_unverified");
    if (page.snapshot.scope !== "series-history" || page.snapshot.evidenceRef !== snapshotRef) hold("non_atomic_series");
  }
  for (const { bar, receipt } of raw) {
    b.charge("work");
    if (bar.endAt >= SMA_PERIOD_END) {
      // The audit witness must have been observed as a native bar, not itself closed.
      // Existing closed-bar captures can reuse their observation fields without an extra successor.
      const explicit = Object.hasOwn(bar, "witnessObservation");
      const observation = explicit ? bar.witnessObservation : bar.confirmation;
      if (!observation || typeof observation !== "object" || Array.isArray(observation) ||
        (!explicit && !["native", "successor"].includes(observation.kind))) hold("witness_observation_unverified");
      if (!integer(observation.observedAt) || observation.observedAt - receipt.clock.precisionMs < bar.openAt ||
        observation.observedAt > receipt.observedThrough || observation.observedAt < receipt.observedFrom) hold("witness_observation_time_unverified");
      refs(observation.evidenceRefs, scope.evidenceRefs, confirmationRef, b);
      continue; // Its close, confirmation status and future successor are not measurement prerequisites.
    }
    if (typeof bar.close !== "number" || !Number.isFinite(bar.close) || bar.close <= 0) hold("unsupported_price");
    object(bar.confirmation, b);
    if (!integer(bar.confirmation.observedAt) || bar.confirmation.observedAt - receipt.clock.precisionMs < bar.endAt ||
      bar.confirmation.observedAt > receipt.observedThrough || bar.confirmation.observedAt < receipt.observedFrom) hold("confirmation_time_unverified");
    refs(bar.confirmation.evidenceRefs, scope.evidenceRefs, confirmationRef, b);
  }
  let warmup = 0;
  for (let i = 0; i < unique.length; i++) {
    const bar = unique[i].bar;
    if (bar.endAt < SMA_PERIOD_START) warmup++;
    if (bar.openAt < scope.from || bar.endAt > scope.through) hold("evidence_applicability_unverified");
    if (bar.endAt >= SMA_PERIOD_END) continue;
    if (bar.confirmation.kind === "successor") {
      const next = unique[i + 1]?.bar;
      // Successor proves completion, never supplies/invents the preceding native end time.
      if (!next || next.openAt < bar.endAt || bar.confirmation.observedAt - unique[i].receipt.clock.precisionMs < next.openAt) hold("successor_unverified");
    } else if (bar.confirmation.kind !== "native") hold("confirmation_unverified");
  }
  if (warmup < 120) hold("insufficient_warmup");
  list(calendar.blocks, b);
  let cursor = scope.from, barIndex = 0, expected = 0;
  let lastClosureBeforeCutoff = scope.from;
  const output: NativeSmaSeries["bars"][number][] = [];
  for (const block of calendar.blocks) {
    object(block, b); refs(block.evidenceRefs, scope.evidenceRefs, calendarRef, b);
    if (block.from !== cursor || !integer(block.through) || block.through <= cursor) hold("calendar_partition_unverified");
    if (block.kind === "closure") {
      if (!["scheduled_closure", "no_trade"].includes(block.reason)) hold("closure_classification_unknown");
      if (block.from < SMA_PERIOD_END) lastClosureBeforeCutoff = Math.min(block.through, SMA_PERIOD_END);
    } else if (block.kind === "bars") {
      if (!integer(block.count) || block.count < 1 || !integer(block.duration) || block.duration < 1 ||
        block.duration > Number(timeframe) * 60000 || block.through !== block.from + block.count * block.duration ||
        block.shortened !== (block.duration < Number(timeframe) * 60000)) hold("native_calendar_unverified");
      for (let j = 0; j < block.count; j++) {
        b.charge("work"); if (++expected >= 32768) b.stop("calendar_expansion_limit");
        const openAt = block.from + j * block.duration, endAt = openAt + block.duration, item = unique[barIndex++];
        if (!item || item.bar.openAt !== openAt || item.bar.endAt !== endAt) hold("expected_interval_missing_or_changed");
        if (endAt >= SMA_PERIOD_END) continue; // Audit-only witness; its price is never delivered.
        b.charge("normalizedBars");
        const previous = output.at(-1);
        output.push({ openAt, endAt, close: item.bar.close, confirmed: true,
          confirmationObservedAt: item.bar.confirmation.observedAt,
          confirmationEvidence: `${manifest.evidenceHash}:${confirmationRef}`,
          continuity: !previous ? "start" : openAt === previous.endAt ? "continuous" : "scheduled_closure",
          continuityEvidence: `${manifest.evidenceHash}:${calendarRef}` });
      }
    } else hold("calendar_classification_unknown");
    cursor = block.through;
  }
  if (cursor !== scope.through || barIndex !== unique.length || !output.some(bar => bar.endAt >= SMA_PERIOD_START)) hold("coverage_incomplete");
  return { snapshot: snapshot!, value: { symbol, timeframe, timeBasis: "confirmed_bar_end_utc_ms",
    nativeEvidence: `${manifest.evidenceHash}:${calendarRef}`, coverage: { from: scope.from, through: SMA_PERIOD_END,
      tail: lastClosureBeforeCutoff > output.at(-1)!.endAt ? "scheduled_closure" : "continuous",
      evidenceRef: `${manifest.evidenceHash}:${calendarRef}` }, bars: output } };
}

function equal(left: any, right: any, b: SmaAdapterBudget): boolean {
  b.charge("work");
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" || Array.isArray(left) !== Array.isArray(right)) return false;
  const a = Object.keys(left), other = Object.keys(right);
  return a.length === other.length && a.every(key => Object.hasOwn(right, key) && equal(left[key], right[key], b));
}
