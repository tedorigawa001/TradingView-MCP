import test from "node:test";
import assert from "node:assert/strict";
import crypto, { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import child from "node:child_process";
import workers from "node:worker_threads";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";

const effects = [], restores = [];
function replace(object, name, fn) { const original = object[name]; object[name] = fn; restores.push(() => { object[name] = original; }); }
function forbid(object, names) { for (const name of names) replace(object, name, () => { effects.push(name); throw Error("cc1b_effect_forbidden"); }); }
forbid(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
forbid(workers, ["Worker"]);
forbid(crypto, ["sign", "createPrivateKey", "createPublicKey", "generateKeyPair", "generateKeyPairSync"]);
forbid(process, ["dlopen"]);
forbid(fs, ["writeFileSync", "appendFileSync", "mkdirSync", "mkdtempSync", "unlinkSync", "rmdirSync", "rmSync", "renameSync", "chmodSync",
  "symlinkSync", "linkSync", "writeFile", "appendFile", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link", "open"]);
forbid(fsp, ["open", "readFile", "writeFile", "appendFile", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "symlink", "link"]);
const roots = ["../helpers/", "../../node_modules/"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
for (const name of ["openSync", "readFileSync"]) {
  const original = fs[name];
  replace(fs, name, (path, ...args) => {
    const p = path instanceof URL ? fileURLToPath(path) : String(path);
    if (roots.some((root) => p.startsWith(root)) && (name !== "openSync" || args[0] === "r" || args[0] === 0)) return original(path, ...args);
    effects.push(name); throw Error("cc1b_read_forbidden");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach((restore) => restore()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });
const api = await import("../helpers/unsignedExecutionContracts.mjs");
const original = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");

const h = (v) => createHash("sha256").update(v).digest("hex");
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const fixture = (case_id = "u1-unsigned", mode = "normal") => ({ request: {
  schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run",
  source_commit: "a".repeat(40), patch_sha256: "b".repeat(64) }, case_id, mode,
  fixture_name: "native-bar-fs-synthetic-Ab123Z",
  ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((s, n) => [s, id(n + 1)])) });
const declaration = (case_id, mode) => ({ fixture: fixture(case_id, mode), exchange_id: "exchange-1", provenance: {
  js_sha256: "c".repeat(64), addon_sha256: "d".repeat(64), observer_sha256: "e".repeat(64),
  registration_sha256: "f".repeat(64), envelope_sha256: "0".repeat(64) } });
function allocation(d = declaration()) {
  const { fixture_name, ...f } = d.fixture;
  const { registration_sha256, envelope_sha256, ...provenance } = d.provenance;
  return { fixture: f, exchange_id: d.exchange_id, provenance };
}

test("C-C1b-1 reserves receipts before creation and keeps observer work separate and unqualified", () => {
  const p = api.describeUnsignedExecutionCapacity({ owned_entries: 9, depth: 3, content_bytes: 131072 });
  assert.equal(p.receipt_reserved_records, 52);
  assert.equal(p.receipt_record_bytes, 16384);
  assert.equal(p.observer_nodes, 12);
  assert.equal(p.observer_acl_bytes, 12 * 2 * 65536);
  assert.equal(p.observer_content_bytes, 262144);
  assert.equal(p.observer_remaining_metadata_bytes, 4194304 - p.observer_acl_bytes - 262144 - 65536);
  assert.equal(p.observer_algorithm_verified, false);
  assert.equal(p.native_budget_changed, false);
  assert.equal(p.execution_available, false);
  assert.equal(p.native_status, "NOT_RUN");
  assert.equal(api.describeUnsignedExecutionCapacity({ owned_entries: 12, depth: 3, content_bytes: 0 }).receipt_reserved_records, 64);
  assert.throws(() => api.describeUnsignedExecutionCapacity({ owned_entries: 13, depth: 3, content_bytes: 0 }), /cc1b_receipt_capacity/);
  assert.throws(() => api.describeUnsignedExecutionCapacity({ owned_entries: 16, depth: 3, content_bytes: 0 }), /cc1b_receipt_capacity/);
});

const resources = () => ({ fds: "2", roots: "1", workspace: "4096", retained: "65536" });
function wire(model, kind, payload, direction = "parent", ordinal) {
  const d = model.describe();
  return canonical({ binding: d.binding, direction, ordinal: ordinal ?? d.next_ordinals[direction], kind, payload }) + "\n";
}
function prepared(model) {
  model.acceptFrame(wire(model, "PREPARE", {}));
  model.acceptFrame(wire(model, "BASELINED", { resources: resources(), clock_domain: "worker-1" }, "worker"));
}
const go = (m) => m.acceptFrame(wire(m, "GO", { baseline_sha256: m.describe().baseline_sha256,
  baseline_readback: true, go_intent_readback: true }));
function released(m, changes = {}) {
  const d = m.describe();
  return { baseline_sha256: d.baseline_sha256, resources: resources(), query: "settled", native: "settled",
    original_operation_retired: true, query_released: true, close_errors: [], diagnostic_sha256: "1".repeat(64),
    trace_chunks: d.trace_chunks, trace_events: d.trace_events, trace_sha256: d.trace_sha256,
    primary_code: "b3cb_record_refused", requests_dispatched: 1, authenticated_requests: 1,
    c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null, ...changes };
}
test("C-C1b-1 binds the original baseline before GO and models release/teardown/exit without authority", () => {
  const input = declaration(), m = api.createUnsignedExecutionProtocolModel(input);
  input.provenance.addon_sha256 = "9".repeat(64);
  assert.equal(m.describe().binding.addon_sha256, "d".repeat(64));
  prepared(m); const baselineHash = m.describe().baseline_sha256;
  assert.equal(m.describe().state, "BASELINED"); go(m);
  m.acceptFrame(wire(m, "RELEASED", released(m, { resources: { ...resources(), retained: "131072" } }), "worker"));
  assert.equal(m.describe().baseline_sha256, baselineHash);
  assert.equal(m.describe().state, "RELEASED");
  m.finishTeardown({ decision: "removed", receipt_readback: true, anchor_same: true, root_removal_confirmed: true, absent: true });
  m.acceptFrame(wire(m, "FINALIZE", {})); m.workerExit({ exit_code: 0, signal: null });
  assert.equal(m.describe().state, "DONE");
  assert.equal(m.describe().model_status, "consistent_supplied_lifecycle");
  assert.equal(m.describe().native_status, "NOT_RUN");
  assert.equal(m.describe().native_release_verified, false);
  assert.equal(m.describe().cleanup_execution_available, false);
});

for (const [name, change, error] of [
  ["changed original baseline", (p) => { p.resources.fds = "0"; }, "resources_changed"],
  ["workspace drift", (p) => { p.resources.workspace = "0"; }, "resources_changed"],
  ["unconfirmed release", (p) => { p.query = "unconfirmed"; }, "release_unconfirmed"],
  ["invented never-started native", (p) => { p.native = "never_started"; }, "release_unconfirmed"],
  ["failed close", (p) => { p.close_errors = ["close_failed"]; }, "release_unconfirmed"],
  ["unretired original operation", (p) => { p.original_operation_retired = false; }, "release_unconfirmed"],
  ["missing trace chunk", (p) => { p.trace_chunks = 1; }, "trace_binding"],
  ["invented exact transport time", (p) => { p.retired_at = "123"; }, "invalid_input"],
]) test(`C-C1b-1 retains on ${name} and cannot reset with later good data`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const p = released(m); change(p);
  assert.throws(() => m.acceptFrame(wire(m, "RELEASED", p, "worker")), new RegExp(`cc1b_${error}`));
  assert.equal(m.describe().stop_reason, error);
  assert.equal(m.describe().retain, true);
  assert.throws(() => m.acceptFrame(wire(m, "RELEASED", released(m), "worker")), /cc1b_stopped/);
  assert.equal(m.describe().stop_reason, error);
});

const stamp = (n) => ({ clock_domain: "parent-1", monotonic_ns: String(n),
  wall_utc: "2026-10-28T01:00:00.000Z", wall_jst: "2026-10-28T10:00:00.000+09:00" });
test("C-C1b-1 binds a report to its confirmed receipt prefix, then terminal and index without circular hashes", () => {
  const d = allocation(), e = api.createUnsignedExecutionEvidenceModel(d), lines = []; let tick = 0;
  const add = (kind, payload) => {
    const record = e.append({ kind, payload, stamp: stamp(++tick) });
    assert.equal(e.describe().pending_readback, "receipt");
    lines.push(record.line); e.confirmReceipt(record.line); return record;
  };
  add("case_allocated", {});
  add("stop_summary", { reason: "model_preflight_refused" });
  add("ready_to_report", { outcome: "NOT_RUN" });
  const report = e.createReport({ limitations: ["memory_only"], save_stamp: stamp(++tick) });
  assert.equal(JSON.parse(report.line).receipt_prefix_sha256, JSON.parse(lines.at(-1)).event_hash);
  e.confirmReport(report.line);
  add("terminal", { report_sha256: report.sha256 });
  const index = e.createIndex(); e.confirmIndex(index.line);
  assert.equal(JSON.parse(index.line).terminal_receipt_sha256, JSON.parse(lines.at(-1)).event_hash);
  assert.equal(JSON.parse(index.line).report_sha256, report.sha256);
  assert.equal(e.describe().evidence_saved, false);
  assert.equal(e.describe().model_status, "consistent_supplied_evidence");
  const replay = api.inspectUnsignedExecutionEvidence({ allocation: d, expected_declaration: null, receipt_lines: lines, report_line: report.line, index_line: index.line });
  assert.equal(replay.model_status, "consistent_supplied_evidence");
  assert.equal(replay.native_status, "NOT_RUN");
  assert.equal(replay.evidence_saved, false);
});

test("C-C1b-1 models only the remaining original phase window, never a fresh observer/read deadline", () => {
  const input = { phase: "query", limit_ms: 600000, started: { clock_domain: "worker-1", monotonic_ns: "1000000" },
    observed: { clock_domain: "worker-1", monotonic_ns: "599001000000" } };
  assert.equal(api.describeUnsignedExecutionWindow(input).observer_window_ms, 1000);
  input.observed.monotonic_ns = "600001000000";
  assert.equal(api.describeUnsignedExecutionWindow(input).decision, "STOP_RETAIN");
  assert.equal(api.describeUnsignedExecutionWindow(input).termination_available, false);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, limit_ms: 600001 }), /cc1b_window_bound/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, observed: { ...input.observed, clock_domain: "parent-1" } }), /cc1b_clock_domain/);
  assert.throws(() => api.describeUnsignedExecutionWindow({ ...input, observed: { ...input.observed, monotonic_ns: "0" } }), /cc1b_clock_rollback/);
});

const event = (n, changes = {}) => ({ ordinal: n, api: "info", edge: "end", clock_domain: "worker-1", monotonic_ns: String(n),
  code: null, byte_count: "0", sha256: null, ...changes });
test("C-C1b-1 transfers the full 128-event trace as eight bound chunks, not one oversized diagnostic", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m); const trace = [];
  for (let chunk_index = 0; chunk_index < 8; chunk_index++) {
    const events = Array.from({ length: 16 }, (_, n) => event(trace.length + n + 1)); trace.push(...events);
    m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index, events }, "worker"));
  }
  assert.equal(m.describe().trace_events, 128); assert.equal(m.describe().trace_sha256, h(canonical(trace)));
  m.acceptFrame(wire(m, "RELEASED", released(m), "worker"));
  assert.equal(m.describe().frames, 12);
});
for (const [name, change] of [
  ["wrong chunk index", (p) => { p.chunk_index = 1; }],
  ["missing event", (p) => { p.events[0].ordinal = 2; }],
  ["foreign clock domain", (p) => { p.events[0].clock_domain = "parent-1"; }],
  ["raw arguments", (p) => { p.events[0].arguments = ["secret"]; }],
  ["seventeen events", (p) => { p.events = Array.from({ length: 17 }, (_, n) => event(n + 1)); }],
]) test(`C-C1b-1 stops for trace ${name}`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const p = { chunk_index: 0, events: [event(1)] }; change(p);
  assert.throws(() => m.acceptFrame(wire(m, "TRACE_CHUNK", p, "worker")), /cc1b_/);
  assert.equal(m.describe().retain, true);
});
test("C-C1b-1 cannot replace or roll back the worker clock after a trace chunk", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index: 0, events: [event(1, { monotonic_ns: "10" })] }, "worker"));
  assert.throws(() => m.acceptFrame(wire(m, "TRACE_CHUNK", { chunk_index: 1, events: [event(2)] }, "worker")), /cc1b_trace_order/);
});
for (const [name, act] of [
  ["GO before baseline", (m) => go(m)],
  ["duplicate PREPARE", (m) => { prepared(m); m.acceptFrame(wire(m, "PREPARE", {})); }],
  ["duplicate baseline", (m) => { prepared(m); m.acceptFrame(wire(m, "BASELINED", { resources: resources(), clock_domain: "worker-1" }, "worker")); }],
  ["duplicate GO", (m) => { prepared(m); go(m); go(m); }],
  ["FINALIZE without teardown", (m) => { prepared(m); go(m); m.acceptFrame(wire(m, "RELEASED", released(m), "worker")); m.acceptFrame(wire(m, "FINALIZE", {})); }],
  ["worker exit as release", (m) => { prepared(m); go(m); m.workerExit({ exit_code: 0, signal: null }); }],
  ["signal as release", (m) => m.workerExit({ exit_code: null, signal: "SIGKILL" })],
]) test(`C-C1b-1 rejects ${name}`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration());
  assert.throws(() => act(m), /cc1b_/); assert.equal(m.describe().retain, true);
});
for (const [name, mutate] of [
  ["mode", (f) => { f.binding.mode = "ubsan"; }],
  ["source", (f) => { f.binding.source_commit = "9".repeat(40); }],
  ["registration", (f) => { f.binding.registration_sha256 = "9".repeat(64); }],
  ["exchange", (f) => { f.binding.exchange_id = "other"; }],
  ["ordinal", (f) => { f.ordinal = 2; }],
  ["direction", (f) => { f.direction = "worker"; }],
  ["unknown field", (f) => { f.token = "not-approval"; }],
  ["signature payload", (f) => { f.payload.signature = "never-permitted"; }],
]) test(`C-C1b-1 refuses changed ${name} on a protocol frame`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()), f = JSON.parse(wire(m, "PREPARE", {})); mutate(f);
  assert.throws(() => m.acceptFrame(canonical(f) + "\n"), /cc1b_/); assert.equal(m.describe().retain, true);
});
for (const name of ["worker_lost", "observer_lost", "observer_timeout", "identity_changed", "receipt_failed", "source_changed",
  "deadline_exceeded", "unexpected_output", "supervisor_lost"]) test(`C-C1b-1 latches ${name} before any query and exposes no cleanup`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration());
  assert.throws(() => m.observeFailure({ reason: name }), new RegExp(`cc1b_${name}`));
  assert.equal(m.describe().baseline, null); assert.equal(m.describe().stop_reason, name);
  assert.equal(m.describe().cleanup_execution_available, false);
  assert.throws(() => prepared(m), /cc1b_stopped/);
});
test("C-C1b-1 rejects oversized frames before parsing and rejects duplicate keys/noncanonical framing", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()), saved = JSON.parse; let calls = 0;
  try {
    JSON.parse = () => { calls++; throw Error("must_not_parse"); };
    assert.throws(() => m.acceptFrame("{".repeat(65537)), /cc1b_frame_bound/);
    assert.equal(calls, 0);
  } finally { JSON.parse = saved; }
  for (const transform of [(s) => s.trimEnd(), (s) => s + "\n", (s) => ` ${s}`,
    (s) => s.replace('"direction":"parent"', '"direction":"worker","direction":"parent"')]) {
    const fresh = api.createUnsignedExecutionProtocolModel(declaration());
    assert.throws(() => fresh.acceptFrame(transform(wire(fresh, "PREPARE", {}))), /cc1b_frame_encoding/);
  }
});
test("C-C1b-1 keeps cancel tied to the active original query and never renews it", () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  m.acceptFrame(wire(m, "CANCEL", {})); assert.equal(m.describe().cancelled, true);
  assert.throws(() => m.acceptFrame(wire(m, "CANCEL", {})), /cc1b_duplicate_cancel/);
});

function evidencePrefix() {
  const d = allocation(), e = api.createUnsignedExecutionEvidenceModel(d), lines = []; let tick = 0;
  const add = (kind, payload) => { const r = e.append({ kind, payload, stamp: stamp(++tick) }); lines.push(r.line); e.confirmReceipt(r.line); return r; };
  add("case_allocated", {}); add("stop_summary", { reason: "invented_stop" });
  return { e, d, lines, add, nextStamp: () => stamp(++tick) };
}
function savedEvidence() {
  const p = evidencePrefix(); p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: ["invented_no_io"], save_stamp: p.nextStamp() }); p.e.confirmReport(report.line);
  p.add("terminal", { report_sha256: report.sha256 }); const index = p.e.createIndex(); p.e.confirmIndex(index.line);
  return { allocation: p.d, expected_declaration: null, receipt_lines: p.lines, report_line: report.line, index_line: index.line };
}
for (const [name, mutate] of [
  ["missing receipt", (d) => { d.receipt_lines.splice(1, 1); }],
  ["reordered receipt", (d) => { [d.receipt_lines[0], d.receipt_lines[1]] = [d.receipt_lines[1], d.receipt_lines[0]]; }],
  ["duplicate receipt", (d) => { d.receipt_lines.splice(1, 0, d.receipt_lines[0]); }],
  ["modified receipt hash", (d) => { const e = JSON.parse(d.receipt_lines[1]); e.event_hash = "9".repeat(64); d.receipt_lines[1] = canonical(e) + "\n"; }],
  ["different report outcome", (d) => { const r = JSON.parse(d.report_line); r.outcome = "MODEL_CONSISTENT"; d.report_line = canonical(r) + "\n"; }],
  ["saved-file claim", (d) => { const r = JSON.parse(d.report_line); r.evidence_saved = true; d.report_line = canonical(r) + "\n"; }],
  ["raw signature", (d) => { const r = JSON.parse(d.report_line); r.signature = "forbidden"; d.report_line = canonical(r) + "\n"; }],
  ["wrong index", (d) => { const r = JSON.parse(d.index_line); r.report_sha256 = "9".repeat(64); d.index_line = canonical(r) + "\n"; }],
  ["another run", (d) => { d.allocation.fixture.request.run_id = "other-run"; }],
  ["report self-reference", (d) => { const r = JSON.parse(d.report_line); r.terminal_receipt_sha256 = "9".repeat(64); d.report_line = canonical(r) + "\n"; }],
]) test(`C-C1b-1 cannot replay ${name} as consistent evidence`, () => {
  const d = savedEvidence(); mutate(d); assert.throws(() => api.inspectUnsignedExecutionEvidence(d), /cc1b_/);
});
test("C-C1b-1 requires exact per-write readback and cannot repair an unknown or partial write", () => {
  const e = api.createUnsignedExecutionEvidenceModel(allocation()); const first = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.throws(() => e.confirmReceipt(first.line.slice(0, -1)), /cc1b_readback_mismatch/);
  assert.equal(e.describe().retain, true); assert.equal(e.describe().confirmed_records, 0);
  assert.throws(() => e.confirmReceipt(first.line), /cc1b_evidence_stopped/);
});
test("C-C1b-1 refuses another intent before readback, premature report and a repeated report", () => {
  let e = api.createUnsignedExecutionEvidenceModel(allocation()); e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.throws(() => e.append({ kind: "create_intent", payload: { entry_index: 0 }, stamp: stamp(2) }), /cc1b_evidence_order/);
  e = evidencePrefix().e; assert.throws(() => e.createReport({ limitations: [], save_stamp: stamp(3) }), /cc1b_evidence_order/);
  const p = evidencePrefix(); p.add("ready_to_report", { outcome: "FAIL" });
  p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  assert.throws(() => p.e.createReport({ limitations: [], save_stamp: p.nextStamp() }), /cc1b_evidence_order/);
});
test("C-C1b-1 reserves four failure summaries and never relabels a failure as success", () => {
  const p = evidencePrefix(); for (let n = 0; n < 3; n++) p.add("stop_summary", { reason: "another_summary" });
  assert.throws(() => p.add("stop_summary", { reason: "overflow" }), /cc1b_failure_capacity/);
  const q = evidencePrefix(); assert.throws(() => q.add("ready_to_report", { outcome: "MODEL_CONSISTENT" }), /cc1b_false_success/);
});
test("C-C1b-1 preserves clock domains and rejects a rollback in parent evidence", () => {
  for (const changed of [stamp(0), { ...stamp(3), clock_domain: "worker-1" }]) {
    const p = evidencePrefix(); assert.throws(() => p.e.append({ kind: "stop_summary", payload: { reason: "later" }, stamp: changed }), /cc1b_clock_/);
  }
});
test("C-C1b-1 rejects accessors, functions, aliases and unknown capacity fields without invoking them", () => {
  let called = 0; const getter = Object.defineProperty({}, "fixture", { enumerable: true, get() { called++; return fixture(); } });
  for (const d of [getter, { ...declaration(), callback: () => called++ }, { ...declaration(), cleanup_path: "/elsewhere" },
    { ...declaration(), provenance: { ...declaration().provenance, signature: "x" } }])
    assert.throws(() => api.createUnsignedExecutionProtocolModel(d), /cc1b_/);
  assert.equal(called, 0);
  for (const d of [{ owned_entries: 0, depth: 0, content_bytes: 0 }, { owned_entries: 9, depth: 4, content_bytes: 0 },
    { owned_entries: 9, depth: 3, content_bytes: 131073 }, { owned_entries: 9, depth: 3, content_bytes: 0, receipt_records: 100 }])
    assert.throws(() => api.describeUnsignedExecutionCapacity(d), /cc1b_invalid_input/);
});

function completeEvidence(case_id, mode, stopAtEnd = false) {
  const d = declaration(case_id, mode), e = api.createUnsignedExecutionEvidenceModel(allocation(d)), r = original.describeUnsignedFixture(d.fixture);
  const c = original.describeUnsignedAcceptanceRun(d.fixture.request).cases.find((c) => c.case_id === case_id && c.mode === mode);
  const lines = []; let tick = 0;
  const add = (kind, payload) => {
    const record = e.append({ kind, payload, stamp: stamp(++tick) });
    if (kind === "setup_sealed") {
      assert.equal(e.describe().binding, null); assert.notEqual(JSON.parse(record.line).binding, null);
    }
    e.confirmReceipt(record.line); lines.push(record.line);
    if (kind === "setup_sealed") assert.deepEqual(e.describe().binding, api.createUnsignedExecutionProtocolModel(d).describe().binding);
  };
  const proofs = r.entries.map((entry, n) => ({ kind: entry.kind, device: "1", inode: String(100 + n), uid: "501", gid: "20", mode: entry.mode,
    birthtime_ns: "1", mtime_ns: "2", ctime_ns: "3", flags: "0", acl: "none", acl_hash: "1".repeat(64), nlink: entry.kind === "file" ? "1" : "2",
    size: entry.size ?? "96", allocated_bytes: "4096", sha256: entry.sha256 ?? null }));
  add("case_allocated", {});
  for (let entry_index = 0; entry_index < r.entries.length; entry_index++) {
    add("create_intent", { entry_index }); add("create_result", { entry_index, proof: proofs[entry_index],
      ...(entry_index === 0 ? { fixture_name: d.fixture.fixture_name } : {}) });
  }
  add("setup_sealed", { inventory_sha256: "2".repeat(64), provenance: {
    registration_sha256: d.provenance.registration_sha256, envelope_sha256: d.provenance.envelope_sha256 } }); add("worker_prepared", {});
  const baseline = { resources: resources(), clock_domain: "worker-1" };
  add("baseline_bound", { ...baseline, observation_sha256: "3".repeat(64) });
  add("go_intent", { baseline_sha256: h(canonical(baseline)) });
  add("run_outcome", { primary_code: c.expected_code, diagnostic_sha256: "1".repeat(64) });
  const m = api.createUnsignedExecutionProtocolModel(d); prepared(m); go(m);
  add("release_checked", released(m, { primary_code: c.expected_code, authenticated_requests: c.owner === "fixed_memory" ? 1 : 0 }));
  add("cleanup_precheck", { inventory_sha256: "4".repeat(64) });
  const depth = (path) => path === "" ? 0 : path.split("/").length;
  const order = r.entries.map((v, entry_index) => ({ ...v, entry_index })).sort((a, b) => depth(b.path) - depth(a.path)
    || (a.kind === b.kind ? 0 : a.kind === "file" ? -1 : 1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (const { entry_index } of order) {
    const proof = { ...proofs[entry_index] };
    if (proof.kind === "directory") Object.assign(proof, { size: "32", nlink: "1", mtime_ns: "50", ctime_ns: "51", allocated_bytes: "8192" });
    add("delete_intent", { entry_index, proof }); add("delete_result", { entry_index, outcome: "removed" });
  }
  add("absence_checked", { anchor_same: true, root_removal_confirmed: true, absent: true }); add("worker_finalized", { exit_code: 0, signal: null });
  if (stopAtEnd) for (let n = 0; n < 4; n++) add("stop_summary", { reason: "invented_failure" });
  add("ready_to_report", { outcome: stopAtEnd ? "FAIL" : "MODEL_CONSISTENT" });
  const report = e.createReport({ limitations: ["memory_only_no_real_release_or_removal"], save_stamp: stamp(++tick) }); e.confirmReport(report.line);
  add("terminal", { report_sha256: report.sha256 }); const index = e.createIndex(); e.confirmIndex(index.line);
  return { e, r, data: { allocation: allocation(d), expected_declaration: d, receipt_lines: lines, report_line: report.line, index_line: index.line } };
}
const cases = original.describeUnsignedAcceptanceRun(fixture().request).cases;
for (const c of cases) test(`C-C1b-1 models the complete ${c.mode}/${c.case_id} evidence schedule in memory only`, () => {
  const { e, r, data } = completeEvidence(c.case_id, c.mode), d = e.describe();
  assert.ok(r.entries.length <= 9); assert.equal(d.confirmed_records, 4 * r.entries.length + 12);
  assert.ok(d.confirmed_records <= d.capacity.receipt_reserved_records);
  assert.ok(d.confirmed_receipt_bytes <= 1048576); assert.equal(d.capacity.run_index_reserved_bytes, 131056);
  assert.equal(api.inspectUnsignedExecutionEvidence(data).model_status, "consistent_supplied_evidence");
  assert.equal(d.evidence_saved, false); assert.equal(d.native_release_verified, false); assert.equal(d.native_status, "NOT_RUN");
  const report = JSON.parse(data.report_line); assert.equal(report.timestamps_verified, false);
  assert.doesNotMatch(data.report_line + data.index_line, /native-bar-fs-synthetic-|\/private\/tmp|entry_index|signature/);
});
test("C-C1b-1 fits all four reserved failure summaries at the largest current recipe without dropping them", () => {
  const { e } = completeEvidence("u3-maintenance", "normal", true), d = e.describe();
  assert.equal(d.confirmed_records, 52); assert.equal(d.capacity.receipt_reserved_records, 52);
  assert.equal(d.retain, true); assert.equal(d.outcome, "FAIL"); assert.equal(d.evidence_saved, false);
});
test("C-C1b-1 requires an exact create sequence and known-byte proof, not arbitrary cleanup locations", () => {
  const e = api.createUnsignedExecutionEvidenceModel(allocation());
  const r = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) }); e.confirmReceipt(r.line);
  assert.throws(() => e.append({ kind: "create_intent", payload: { entry_index: 1 }, stamp: stamp(2) }), /cc1b_entry_order/);
  const p = evidencePrefix(); assert.throws(() => p.add("delete_intent", { entry_index: 0, path: "/elsewhere" }), /cc1b_invalid_input/);
});
test("C-C1b-1 does not invoke an injected receiver callback when methods are detached", () => {
  let calls = 0; const receiver = { describe() { calls++; } };
  const p = api.createUnsignedExecutionProtocolModel(declaration());
  assert.equal(p.acceptFrame.call(receiver, wire(p, "PREPARE", {})).state, "PREPARING");
  const e = api.createUnsignedExecutionEvidenceModel(allocation()), r = e.append({ kind: "case_allocated", payload: {}, stamp: stamp(1) });
  assert.equal(e.confirmReceipt.call(receiver, r.line).confirmed_records, 1);
  assert.equal(calls, 0);
});
test("C-C1b-1 rejects scalar evidence roots with a bounded contract error", () => {
  for (const line of ["null\n", "[]\n", "false\n", "12\n"]) {
    const d = savedEvidence(); d.report_line = line;
    assert.throws(() => api.inspectUnsignedExecutionEvidence(d), /cc1b_/);
  }
});
test("C-C1b-1 preserves an unconfirmed release and its primary/close failures without reporting release success", () => {
  const p = evidencePrefix(), m = api.createUnsignedExecutionProtocolModel(declaration()); prepared(m); go(m);
  const failed = released(m, { query: "unconfirmed", query_released: false, close_errors: ["close_failed"], primary_code: "b3cb_record_refused" });
  p.add("stop_summary", { reason: "release_unconfirmed", detail: { kind: "release", result: failed } });
  p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  const r = JSON.parse(report.line); assert.equal(r.failure_summaries.at(-1).detail.result.primary_code, "b3cb_record_refused");
  assert.deepEqual(r.failure_summaries.at(-1).detail.result.close_errors, ["close_failed"]);
  assert.equal(r.release, null); assert.equal(r.native_release_verified, false);
});
test("C-C1b-1 can confirm pre-creation intent without inventing a returned name or observed registration", () => {
  const a = allocation(), e = api.createUnsignedExecutionEvidenceModel(a);
  for (const [n, kind, payload] of [[1, "case_allocated", {}], [2, "create_intent", { entry_index: 0 }]]) {
    const r = e.append({ kind, payload, stamp: stamp(n) }); e.confirmReceipt(r.line);
    const record = JSON.parse(r.line);
    assert.equal(record.fixture_name, null); assert.equal(record.binding, null);
    assert.equal(record.creation_prefix, kind === "create_intent" ? "native-bar-fs-synthetic-" : null);
    assert.equal(record.allocation.run_id, "invented-run");
    assert.doesNotMatch(r.line, /registration_sha256|envelope_sha256|Plan00/);
  }
  assert.equal(e.describe().binding, null);
});
test("C-C1b-1 preserves a spontaneous crash signal in a failure summary without signalling anything", () => {
  const p = evidencePrefix(); p.add("stop_summary", { reason: "worker_lost", detail: { kind: "worker_exit", exit_code: null, signal: "SIGABRT" } });
  p.add("ready_to_report", { outcome: "FAIL" });
  const report = p.e.createReport({ limitations: [], save_stamp: p.nextStamp() });
  assert.equal(JSON.parse(report.line).failure_summaries.at(-1).detail.signal, "SIGABRT");
});
test("C-C1b-1 rejects premature full provenance, returned names and unknown allocation fields", () => {
  for (const d of [declaration(), { ...allocation(), fixture: fixture() },
    { ...allocation(), provenance: declaration().provenance }, { ...allocation(), binding: "invented" }])
    assert.throws(() => api.createUnsignedExecutionEvidenceModel(d), /cc1b_invalid_input/);
});
function beforeRootResult() {
  const a = allocation(), e = api.createUnsignedExecutionEvidenceModel(a);
  const append = (kind, payload, n) => { const r = e.append({ kind, payload, stamp: stamp(n) }); e.confirmReceipt(r.line); return r; };
  append("case_allocated", {}, 1); append("create_intent", { entry_index: 0 }, 2);
  const proof = { kind: "directory", device: "1", inode: "100", uid: "501", gid: "20", mode: "16832", birthtime_ns: "1",
    mtime_ns: "2", ctime_ns: "3", flags: "0", acl: "none", acl_hash: "1".repeat(64), nlink: "2", size: "96", allocated_bytes: "4096", sha256: null };
  return { a, e, append, proof };
}
test("C-C1b-1 binds the returned root name only in its confirmed creation result", () => {
  const p = beforeRootResult(), name = "native-bar-fs-synthetic-Xy123Z";
  const r = p.e.append({ kind: "create_result", payload: { entry_index: 0, proof: p.proof, fixture_name: name }, stamp: stamp(3) });
  assert.equal(JSON.parse(r.line).fixture_name, name); assert.equal(p.e.describe().binding, null);
  assert.equal(p.e.describe().pending_readback, "receipt"); p.e.confirmReceipt(r.line);
  const next = p.append("create_intent", { entry_index: 1 }, 4);
  assert.equal(JSON.parse(next.line).fixture_name, name); assert.equal(JSON.parse(next.line).binding, null);
});
test("C-C1b-1 cannot omit or replace the returned name after root creation", () => {
  let p = beforeRootResult();
  assert.throws(() => p.append("create_result", { entry_index: 0, proof: p.proof }, 3), /cc1b_fixture_name_required/);
  p = beforeRootResult(); p.append("create_result", { entry_index: 0, proof: p.proof, fixture_name: fixture().fixture_name }, 3);
  p.append("create_intent", { entry_index: 1 }, 4);
  assert.throws(() => p.append("create_result", { entry_index: 1, proof: { ...p.proof, inode: "101" },
    fixture_name: "native-bar-fs-synthetic-Change" }, 5), /cc1b_fixture_name_changed/);
});
test("C-C1b-1 seals full binding after creation without rewriting earlier receipt bytes", () => {
  const { data } = completeEvidence("u3-maintenance", "ubsan"), records = data.receipt_lines.map(JSON.parse);
  const sealed = records.findIndex((e) => e.kind === "setup_sealed");
  assert.ok(records.slice(0, sealed).every((e) => e.binding === null));
  const p = api.createUnsignedExecutionProtocolModel(data.expected_declaration);
  for (const r of records.slice(sealed)) assert.deepEqual(r.binding, p.describe().binding);
  assert.equal(records[sealed].previous_event_hash, records[sealed - 1].event_hash);
  const changed = structuredClone(data); changed.expected_declaration.provenance.registration_sha256 = "9".repeat(64);
  assert.throws(() => api.inspectUnsignedExecutionEvidence(changed), /cc1b_binding_changed/);
  changed.expected_declaration = null;
  assert.throws(() => api.inspectUnsignedExecutionEvidence(changed), /cc1b_binding_changed/);
});
test("C-C1b-1 retains a failed allocation without requiring later setup facts for reporting or replay", () => {
  const data = savedEvidence(), report = JSON.parse(data.report_line);
  assert.equal(report.binding, null); assert.equal(report.allocation.run_id, "invented-run");
  assert.equal(api.inspectUnsignedExecutionEvidence(data).retain, true);
  assert.doesNotMatch(data.report_line + data.index_line, /registration_sha256|envelope_sha256|native-bar-fs-synthetic-/);
});
for (const signal of ["SIGABRT", "SIGSEGV", "SIGBUS", "SIGINT"]) test(`C-C1b-1 treats ${signal} as worker loss, not an invalid packet or release proof`, () => {
  const m = api.createUnsignedExecutionProtocolModel(declaration());
  prepared(m); go(m); m.acceptFrame(wire(m, "RELEASED", released(m), "worker"));
  m.finishTeardown({ decision: "removed", receipt_readback: true, anchor_same: true, root_removal_confirmed: true, absent: true });
  m.acceptFrame(wire(m, "FINALIZE", {}));
  assert.throws(() => m.workerExit({ exit_code: null, signal }), /cc1b_worker_lost/);
  assert.equal(m.describe().stop_reason, "worker_lost"); assert.equal(m.describe().native_release_verified, false);
});
