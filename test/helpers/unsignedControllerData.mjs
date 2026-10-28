import { createHash } from "node:crypto";
import { z } from "zod";

export const uint = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const label = z.string().regex(/^[a-z][a-z0-9-]{0,47}$/);
export const code = z.string().regex(/^[a-z][a-z0-9_]{0,95}$/);
export const count = (n, min = 0) => z.number().int().min(min).max(n);
export const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
export const sha = (v) => createHash("sha256").update(v).digest("hex");
export const digest = (v) => sha(canonical(v));
export const byteLength = (v) => Buffer.byteLength(v, "utf8");
export const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export const refuse = (reason) => { throw Error(`cc4a_${reason}`); };
export const flags = () => ({ scope: "unsigned_controller_memory_contract_only", native_status: "NOT_RUN", execution_available: false,
  cleanup_execution_available: false, approval_authenticated: false, ownership_verified: false, evidence_saved: false,
  native_release_verified: false, timestamps_verified: false, history_verified: false, signing_available: false, runtime_qualified: false });

export function copyData(input) {
  let nodes = 0, bytes = 0;
  function visit(v, depth) {
    if (++nodes > 24000 || depth > 24) refuse("input_bound");
    if (v === null || typeof v === "boolean" || Number.isSafeInteger(v)) return v;
    if (typeof v === "string") { const n = byteLength(v); bytes += n; if (n > 262144 || bytes > 2097152) refuse("input_bound"); return v; }
    if (!v || typeof v !== "object") refuse("invalid_input");
    const array = Array.isArray(v), keys = Reflect.ownKeys(v), proto = Object.getPrototypeOf(v);
    if (array ? proto !== Array.prototype || v.length > 256 || keys.length !== v.length + 1 : proto !== Object.prototype && proto !== null) refuse("invalid_input");
    if (keys.length > (array ? 257 : 64)) refuse("input_bound");
    const out = array ? [] : Object.create(null);
    for (const k of keys) {
      if (array && k === "length") continue;
      if (typeof k !== "string" || ["__proto__", "constructor", "prototype"].includes(k)
        || array && (!/^(0|[1-9][0-9]*)$/.test(k) || Number(k) >= v.length)) refuse("invalid_input");
      bytes += byteLength(k); if (byteLength(k) > 128 || bytes > 2097152) refuse("input_bound");
      const d = Object.getOwnPropertyDescriptor(v, k); if (!d?.enumerable || !("value" in d)) refuse("invalid_input");
      Object.defineProperty(out, k, { value: visit(d.value, depth + 1), enumerable: true, writable: true });
    }
    return out;
  }
  return visit(input, 0);
}
export function parse(schema, input) { const r = schema.safeParse(copyData(input)); if (!r.success) refuse("invalid_input"); return r.data; }
export function decode(line, cap) {
  if (typeof line !== "string" || byteLength(line) > cap) refuse("byte_bound");
  let d; try { d = copyData(JSON.parse(line)); } catch { refuse("encoding"); }
  if (line !== canonical(d) + "\n") refuse("encoding"); return d;
}
export function descriptor(value, cap) {
  const line = canonical(value) + "\n"; if (byteLength(line) > cap) refuse("byte_bound");
  return freeze({ line, bytes: byteLength(line), sha256: sha(line) });
}
export const resourcesSchema = z.object({ fds: uint, roots: uint, workspace: uint, retained: uint }).strict();
export const traceSchema = z.object({ ordinal: count(128, 1), api: z.enum(["info", "begin", "open_pair", "inventory", "capture", "verify", "close"]),
  edge: z.enum(["begin", "end", "throw"]), clock_domain: label, monotonic_ns: uint, code: code.nullable(), byte_count: uint, sha256: digestSchema.nullable() }).strict();
export const LIMITS = freeze({ frame_bytes: 65536, frames: 32, configuration_bytes: 60000, observation_bytes: 16384,
  trace_events: 128, trace_event_bytes: 1024, trace_chunks: 8, chunk_events: 16, receipt_records: 64, receipt_record_bytes: 16384,
  receipt_bytes: 1048576, report_bytes: 262144, run_index_bytes: 131072, index_header_bytes: 4096, index_row_bytes: 5290,
  fixtures: 24, preparation_ms: 120000, query_ms: 600000, settlement_ms: 60000, teardown_ms: 120000, helper_ms: 10000,
  observer_invocations: 64, observer_work_bytes: 4194304, native_work_bytes: 268435456 });
