import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import dgram from "node:dgram";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dns from "node:dns";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import { syncBuiltinESMExports } from "node:module";
import { fileURLToPath } from "node:url";
import { resolve, sep } from "node:path";
import vm from "node:vm";

const effects = [], blocked = [], restores = [], server = net.Server.prototype, socket = net.Socket.prototype, datagram = dgram.Socket.prototype;
function replace(o, k, value) { const d = Object.getOwnPropertyDescriptor(o, k); Object.defineProperty(o, k, { value, configurable: true, writable: true });
  restores.push(() => d ? Object.defineProperty(o, k, d) : delete o[k]); }
function block(o, keys) { for (const k of keys) if (typeof o[k] === "function") {
  blocked.push([o, k]); replace(o, k, () => { effects.push(k); throw Error("c2ca_forbidden_effect"); });
} }
let escapedRead = 0;
replace(fs, "readSync", () => { escapedRead++; throw Error("c2ca_read_sentinel"); });
block(fs, ["read", "readSync", "readv", "readvSync", "createReadStream", "ReadStream", "FileReadStream"]);
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]);
block(workers, ["Worker", "MessageChannel", "BroadcastChannel"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync", "generateKeyPair", "generateKeyPairSync", "randomBytes", "randomUUID"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "encrypt", "decrypt", "deriveKey", "deriveBits"]);
block(process, ["dlopen", "getBuiltinModule", "binding", "_linkedBinding", "kill", "chdir", "execve", "loadEnvFile"]);
block(server, ["listen"]); block(socket, ["connect"]); block(datagram, ["bind"]);
block(net, ["Socket", "Server", "connect", "createConnection", "createServer"]); block(dgram, ["Socket", "createSocket"]);
block(tls, ["connect", "createServer"]); for (const o of [http, https]) block(o, ["request", "get", "createServer"]);
block(http2, ["connect", "createServer", "createSecureServer"]); for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(globalThis, ["fetch", "WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask"]);
block(timers, ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate"]);
block(timerPromises, ["setTimeout", "setInterval", "setImmediate"]); block(timerPromises.scheduler, ["wait", "yield"]); block(AbortSignal, ["timeout"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename", "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
block(fs, [...mutations, ...mutations.map(k => k + "Sync"), "write", "writeSync", "writev", "writevSync", "createWriteStream", "WriteStream", "watch", "watchFile", "openAsBlob"]); block(fsp, mutations);
block(fs, ["open"]); block(fsp, ["open"]);
const roots = ["../helpers/", "../../node_modules/"].map(p => fileURLToPath(new URL(p, import.meta.url)));
roots.push(...roots.map(p => fs.realpathSync(p) + sep));
for (const [o, k, flag] of [[fs, "openSync", a => a[0]],
  [fs, "readFile", a => a[0]?.flag], [fs, "readFileSync", a => a[0]?.flag], [fsp, "readFile", a => a[0]?.flag],
  ...["stat", "lstat", "readdir", "opendir", "realpath", "readlink", "access"].flatMap(k => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]])]) {
  if (typeof o[k] !== "function") continue; const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === 0 || f === "r") && roots.some(r => full.startsWith(r))) {
      if (o === fs && k === "readFileSync") { const encoding = typeof a[0] === "string" ? a[0] : a[0]?.encoding;
        if ([undefined, null, "utf8", "utf-8"].includes(encoding)) { const text = original.call(o, p, { encoding: "utf8", flag: f ?? "r" }); return encoding ? text : Buffer.from(text); }
      } else return original.call(o, p, ...a);
    }
    effects.push(k); throw Error("c2ca_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = n => () => { effects.push(n); throw Error("c2ca_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)]))); replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(performance, ["now"]); block(process, ["uptime", "cpuUsage", "resourceUsage"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); assert.equal(escapedRead, 0); });

const target = await import("../helpers/unsignedWorkerRecordInitializationContracts.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const parent = await import("../helpers/unsignedControllerContracts.mjs");
const startup = await import("../helpers/unsignedWorkerStartupContracts.mjs");
const qualification = await import("../helpers/unsignedCohortQualificationContracts.mjs");
const { z } = await import("zod");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../helpers/unsignedWorkerRecordInitializationContracts.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const { canonical, digest } = data, h = "a".repeat(64), other = "b".repeat(64);
const steps = ["record_open", "record_validate", "closed_set", "initialization", "modules", "cache", "complete"];
const metrics = ["hash_bytes", "read_bytes", "parser_steps", "helper_commands"];
const zero = () => Object.fromEntries(metrics.map(k => [k, "0"]));
const clone = structuredClone;
const edit = (value, fn) => { const copy = clone(value); fn(copy); return copy; };
function subject() {
  const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
  const allocation = { fixture: { request: { schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run", source_commit: "a".repeat(40), patch_sha256: h },
    case_id: "u1-unsigned", mode: "normal", ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((k, i) => [k, uuid(i + 1)])) },
    exchange_id: "exchange-1", launch_nonce: "nonce-1", source_tree_sha256: h, signature_profile: "linker_adhoc", artifacts: Object.fromEntries(["js_set", "addon", "observer", "controller", "worker", "runtime_closure", "node_binary", "build_record", "reader_source", "reader_js"].map(k => [k + "_sha256", h])) };
  const binding = parent.createUnsignedControllerProtocolModel(allocation).describe().binding;
  const costs = steps.map(step => ({ step, cost: { ...zero(), ...(step === "record_open" ? { hash_bytes: "100", helper_commands: "1" }
    : step === "record_validate" ? { hash_bytes: "8292", read_bytes: "16384", parser_steps: "8192" }
      : step === "closed_set" ? { hash_bytes: "200", read_bytes: "200" } : step === "initialization" ? { hash_bytes: "100" } : {}) } }));
  const mem = () => ({ decoder: "65536", pending_prepare: "65536", status_lines: "131072", record_input_page: "8192", canonical_compare_page: "8192", token_scratch: "1024", current_row: "1024", membership: "1024", hash_scratch: "8192", parser_queue: "0" });
  return { startup: { binding, expected: { mode: "normal", binding_sha256: digest(binding), closed_set_sha256: h, module_set_sha256: h, build_record_sha256: h },
    clock: { clock_domain: "worker-clock", started_ns: "0", local_end_ns: "900000000000" },
    components: Object.fromEntries(["record_reader", "closed_set", "module_initialization", "metadata_host_profile", "native_profile", "work_plan"].map(k => [k, "matched_supplied"])),
    manifest: { rows: 1, pages: 1, page_rows: 1, page_bytes: 4096, manifest_bytes: 4096, record_bytes: 8192, file_bytes: "67108864" },
    work: { case_count: 24, modes: ["normal", "ubsan"].map(mode => ({ mode, startups: 12, record_bytes: "8192", module_bytes: "100", pin_bytes: "100", metadata_hash_bytes: "100", helper_commands: 1 })),
      other_hash_bytes: "4800", other_helper_commands: 0 }, handoff: null },
  session_id: "invented-session", generation: "1", profiles: Object.fromEntries(["parser", "writer_language", "role_mapping", "initialization", "host_bridge", "loader_binding", "heap", "cost_profile"].map(k => [k, "matched_supplied"])),
  record: { schema: "native-bar-cohort-private-build-v1", bytes: 8192, rows: 1, pages: 1, manifest_bytes: 4096, sha256: h,
    inputs_sha256: h, artifacts_sha256: h, expected_inputs_sha256: h, expected_artifacts_sha256: h, identity: "matched_supplied", canonical: "exact_supplied", membership: "matched_supplied",
    page: { index: 0, bytes: 4096, rows: [{ path_sha256: h, identity_sha256: h, bytes: "100", sha256: h, kind: "input", mode: null, roles: ["source"] }] } },
  modules: ["reader", "registry", "contracts", "fixed_owner", "unsigned_owner", "addon"].map(role => ({ id: role.replaceAll("_", "-"), role, mode: "normal", source_sha256: h, artifact_sha256: h, expected_artifact_sha256: h, edges: [],
    exports: role === "fixed_owner" ? ["enrollFixedMemoryCheckpointOracleC0Only"] : role === "unsigned_owner" ? ["enrollUnsignedCheckpointOracle"] : [], effects: ["allocation"] })),
  host: { source: "supplied_worker", namespace: "matched_supplied", acl: "matched_supplied", launch: "matched_supplied", native_profile: "matched_supplied", loader: "matched_supplied", clock_domain: "worker-clock", generation: "1", identity_sha256: h, expected_identity_sha256: h },
  work: { modes: ["normal", "ubsan"].map(mode => ({ mode, startups: 12, extra_record_hash_bytes: "0", subset_hash_bytes: "100", initialization_hash_bytes: "100", extra_helper_commands: "0", steps: clone(costs) })), prior_other_hash_bytes: "0", prior_other_helper_commands: "0" },
  memory: steps.map(step => ({ step, retained: mem(), transient: Object.fromEntries(Object.keys(mem()).map(k => [k, "0"])) })), events: [] };
}
const plan = (s = subject()) => target.planUnsignedWorkerRecordInitialization(s);
function recordSize(s, bytes) {
  s.record.bytes = s.startup.manifest.record_bytes = bytes;
  for (const m of s.startup.work.modes) m.record_bytes = String(bytes);
  for (const m of s.work.modes) Object.assign(m.steps[1].cost, { hash_bytes: String(bytes + 100), read_bytes: String(2 * bytes), parser_steps: String(bytes) });
  for (const p of s.memory) for (const k of ["record_input_page", "canonical_compare_page", "hash_scratch"]) p.retained[k] = String(Math.min(bytes, 65536));
}
const fact = (type, fields = {}, ns = "0") => ({ type, session_id: "invented-session", generation: "1", at: { clock_domain: "worker-clock", monotonic_ns: ns }, references: ["referenced", "referenced"], ...fields });
function sequence(s, n = steps.length) { for (const step of steps.slice(0, n)) {
  const cost = s.work.modes[0].steps.find(v => v.step === step).cost, action_id = step.replaceAll("_", "-");
  s.events.push(fact("reserve", { step, action_id, cost: clone(cost) }), fact("begin", { action_id }), fact("result", { action_id, outcome: "returned" }));
} return s; }

test("C2c-A supplied complete projection has no runtime authority or live proof", () => {
  const s = sequence(subject()), p = plan(s); assert.equal(p.supplied_plan_complete, true); assert.equal(p.model.state, "SUPPLIED_COMPLETE");
  for (const k of ["execution_available", "runtime_completion_proven", "record_reader_available", "startup_proof_issued", "signing_available", "evidence_saved"]) assert.equal(p[k], false);
  assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.runtime_producers, "unavailable"); assert.equal(p.template_preimage, "deferred_to_c3");
  assert.equal(Object.isFrozen(p.model.resources), true); assert.equal(p.model.retained, true);
});
for (const name of Object.keys(subject().profiles)) for (const value of ["unavailable", "refused"]) test(`C2c-A missing gate ${name} ${value}`, () => {
  const p = plan(edit(subject(), s => s.profiles[name] = value)); assert.equal(p.supplied_plan_complete, false); assert.ok(p.blockers.includes(name + "_" + value));
});
for (const source of ["unavailable", "supplied_parent", "candidate_self"]) test(`C2c-A host source never promotes ${source}`, () => {
  assert.ok(plan(edit(subject(), s => s.host.source = source)).blockers.includes("worker_host_observation_unavailable"));
});
const invalid = [
  ["extra field", s => s.extra = true], ["startup binding", s => s.startup.expected.binding_sha256 = other], ["record digest", s => s.record.sha256 = other],
  ["record size", s => s.record.bytes++], ["oversized record", s => s.record.bytes = 4194305], ["page index", s => s.record.page.index = 1],
  ["duplicate rows", s => s.record.page.rows.push(clone(s.record.page.rows[0]))], ["role translation", s => s.record.page.rows[0].roles = ["header"]],
  ["artifact role", s => s.record.page.rows[0].kind = "artifact"], ["row limit", s => s.record.page.rows[0].bytes = "67108865"],
  ["wrong module mode", s => s.modules[0].mode = "ubsan"], ["missing edge", s => s.modules[0].edges = ["foreign"]],
  ["duplicate module", s => s.modules.push(clone(s.modules[0]))], ["unrestricted owner", s => s.modules[3].exports = ["enrollFixedMemoryCheckpointOracle"]],
  ["forbidden effect", s => s.modules[0].effects = ["sign"]], ["duplicate work mode", s => s.work.modes[1].mode = "normal"],
  ["duplicate step", s => s.work.modes[0].steps[1].step = "record_open"], ["fractional pass", s => s.work.modes[0].extra_record_hash_bytes = "1"],
  ["underspent comparison", s => s.work.modes[0].steps[1].cost.read_bytes = "8192"], ["underspent parser", s => s.work.modes[0].steps[1].cost.parser_steps = "8191"],
  ["cost aggregate", s => s.work.modes[0].steps[1].cost.hash_bytes = "8291"], ["other cost mapping", s => s.startup.work.other_hash_bytes = "4801"],
  ["missing decoder reservation", s => s.memory[0].retained.decoder = "0"], ["missing comparison page", s => s.memory[1].retained.canonical_compare_page = "0"],
  ["retained bound", s => s.memory[0].retained.membership = "2375680"], ["transient bound", s => s.memory[0].transient.membership = "4259841"],
];
for (const [name, change] of invalid) test(`C2c-A refuses ${name}`, () => assert.throws(() => plan(edit(subject(), change))));
for (const [name, change, blocker] of [
  ["hash-only canonical", s => s.record.canonical = "hash_only", "exact_canonical_comparison_unavailable"],
  ["subset mismatch", s => s.record.inputs_sha256 = other, "record_subset_mismatch"],
  ["artifact mismatch", s => s.modules[0].artifact_sha256 = other, "module_set_mismatch"],
  ["incomplete roles", s => s.modules.pop(), "module_set_mismatch"],
  ["host identity", s => s.host.identity_sha256 = other, "host_binding_mismatch"],
  ["host clock", s => s.host.clock_domain = "parent-clock", "host_binding_mismatch"],
  ["host epoch", s => s.host.generation = "2", "host_binding_mismatch"],
  ["unknown memory", s => s.memory[1].retained.token_scratch = null, "memory_overlap_unknown"],
  ["unknown comparison", s => s.work.modes[0].steps[1].cost.read_bytes = null, "read_bytes_unknown"],
]) test(`C2c-A blocks ${name}`, () => { const p = plan(edit(subject(), change)); assert.equal(p.supplied_plan_complete, false); assert.ok(p.blockers.includes(blocker)); });
test("C2c-A exact disjoint 24-start work and phase overlap arithmetic", () => {
  const p = plan(); assert.equal(p.known_hash_bytes, String(24 * (262144 + 32 * 524288 + 8192 + 300) + 4800));
  assert.equal(p.additional_other_hash_bytes, "4800"); assert.equal(p.known_read_bytes, String(24 * 16584)); assert.equal(p.known_parser_steps, String(24 * 8192));
  assert.equal(p.known_helper_commands, "24"); assert.equal(p.memory.retained_peak_bytes, "289792"); assert.equal(p.memory.transient_peak_bytes, "0");
});
test("C2c-A complete extra record pass is charged once in other, not record size", () => {
  const s = subject(); s.startup.work.other_hash_bytes = String(4800 + 24 * 8192);
  for (const m of s.work.modes) { m.extra_record_hash_bytes = "8192"; m.steps[1].cost.hash_bytes = String(8292 + 8192); m.steps[1].cost.read_bytes = String(16384 + 8192); }
  const p = plan(s); assert.equal(p.known_hash_bytes, String(BigInt(plan().known_hash_bytes) + 24n * 8192n)); assert.equal(s.startup.work.modes[0].record_bytes, "8192");
});
test("C2c-A unknown cost cannot be filled by a declared aggregate", () => {
  const s = edit(subject(), s => { s.work.modes[0].subset_hash_bytes = null; s.work.modes[0].steps[1].cost.hash_bytes = null; });
  const p = plan(s); assert.equal(p.modeled_hash_bytes, null); assert.equal(p.supplied_plan_complete, false); assert.equal(p.known_hash_bytes, plan().known_hash_bytes);
});
test("C2c-A known lower-bound overrun refuses even with unknown costs", () => {
  const s = subject(); s.startup.work.other_hash_bytes = null; s.work.prior_other_hash_bytes = "2147483648"; s.work.modes[0].subset_hash_bytes = null; s.work.modes[0].steps[1].cost.hash_bytes = null;
  assert.throws(() => plan(s), /work_bound/);
});
test("C2c-A known step costs cannot hide behind an unknown C2a module cost", () => {
  const s = subject(); s.startup.work.modes[0].module_bytes = null; s.work.modes[0].steps[2].cost.hash_bytes = "200000000";
  assert.throws(() => plan(s), /work_bound/);
});
test("C2c-A per-start read pass keeps the existing pass ceiling", () => {
  const s = subject(); s.work.modes[0].steps[2].cost.read_bytes = "268435456"; assert.throws(() => plan(s), /read_pass_bound/);
});
test("C2c-A known helper lower bounds include extra helpers even when the total is unavailable", () => {
  const s = subject(); s.startup.work.other_helper_commands = null;
  s.work.modes[0].extra_helper_commands = "20000"; s.work.modes[0].steps[0].cost.helper_commands = "20001";
  assert.throws(() => plan(s), /work_bound/);
});
test("C2c-A exact memory ceilings accept, with zero implied spare transient space", () => {
  const s = subject(), row = s.memory[0]; row.retained.membership = String(2375680 - (289792 - 1024)); row.transient.parser_queue = "4259840";
  const p = plan(s); assert.equal(p.memory.retained_peak_bytes, "2375680"); assert.equal(p.memory.transient_peak_bytes, "4259840");
  row.transient.token_scratch = "1"; assert.throws(() => plan(s), /capacity_bound/);
});
test("C2c-A supplied ubsan selection never changes to fit a module", () => {
  const s = subject(); s.startup.binding = { ...s.startup.binding, mode: "ubsan" }; s.startup.expected.mode = "ubsan"; s.startup.expected.binding_sha256 = digest(s.startup.binding);
  for (const m of s.modules) m.mode = "ubsan";
  assert.equal(plan(sequence(s)).model.state, "SUPPLIED_COMPLETE"); s.modules[0].mode = "normal"; assert.throws(() => plan(s), /module_closure/);
});
for (const [name, event] of [
  ["read before reservation", fact("begin", { action_id: "record-open" })],
  ["foreign session", fact("stop", { session_id: "foreign", reason: "foreign_stop" })],
  ["foreign epoch", fact("stop", { generation: "2", reason: "foreign_stop" })],
  ["foreign clock", fact("stop", { at: { clock_domain: "parent-clock", monotonic_ns: "0" }, reason: "stop" })],
  ["null clock", fact("stop", { at: null, reason: "stop" })],
  ["deadline equality", fact("begin", { action_id: "record-open" }, "120000000000")],
  ["lost lifetime", fact("stop", { references: ["unreferenced", "referenced"], reason: "stop" })],
]) test(`C2c-A state refuses ${name} without progress`, () => { const p = plan(edit(subject(), s => s.events.push(event))); assert.equal(p.model.state, "STOPPED"); assert.equal(p.model.completed_steps, 0); });
test("C2c-A unknown acquisition settles late but never resumes and costs never refund", () => {
  const s = sequence(subject(), 1); s.events[2].outcome = "unknown";
  s.events.push(fact("result", { action_id: "record-open", outcome: "returned" }));
  const p = plan(s); assert.equal(p.model.state, "STOPPED"); assert.equal(p.model.first_stop, "operation_unknown"); assert.equal(p.model.resources.record.disposition, "owned");
  assert.equal(p.model.completed_steps, 0); assert.equal(p.model.spent.hash_bytes, "100"); assert.equal(p.model.refunded, false);
});
test("C2c-A original deadline is never renewed by a late begin/result", () => {
  const s = sequence(subject(), 1); s.events[1].at.monotonic_ns = "9999000000"; s.events[2].at.monotonic_ns = "10000000000";
  const p = plan(s); assert.equal(p.model.first_stop, "operation_deadline"); assert.equal(p.model.completed_steps, 0); assert.equal(p.model.resources.record.disposition, "owned");
});
test("C2c-A rollback remains sticky through later matching points", () => {
  const s = sequence(subject(), 1); s.events[0].at.monotonic_ns = "2"; s.events[1].at.monotonic_ns = "1"; s.events[2].at.monotonic_ns = "3";
  const p = plan(s); assert.equal(p.model.clock_invalid, true); assert.equal(p.model.first_stop, "clock_invalid"); assert.equal(p.model.completed_steps, 0);
});
test("C2c-A stopped original resources close once and foreign cache is never overwritten", () => {
  const s = sequence(subject()); s.events.push(fact("stop", { reason: "invented_stop" }));
  for (const resource of ["record", "cache"]) s.events.push(fact("close_begin", { resource, original_matches: true }), fact("close_result", { resource, outcome: "confirmed" }));
  assert.equal(plan(s).model.retained, false);
  const foreign = edit(s, s => { s.events.find(e => e.type === "close_begin" && e.resource === "cache").original_matches = false; });
  assert.equal(plan(foreign).model.resources.cache.disposition, "foreign_retained"); assert.equal(plan(foreign).model.cache_replacement_overwritten, false); assert.equal(plan(foreign).model.retained, true);
});
test("C2c-A no second close attempt or result can turn an unknown close into success", () => {
  const s = sequence(subject(), 1); s.events.push(fact("stop", { reason: "stop" }), fact("close_begin", { resource: "record", original_matches: true }), fact("close_result", { resource: "record", outcome: "unknown" }), fact("close_result", { resource: "record", outcome: "confirmed" }));
  assert.equal(plan(s).model.resources.record.disposition, "unknown"); assert.equal(plan(s).model.retained, true);
});
test("C2c-A malformed/getter/function/raw record inputs are refused without invocation", () => {
  let calls = 0; const s = subject(); Object.defineProperty(s, "raw", { enumerable: true, get() { calls++; throw Error("getter"); } });
  assert.throws(() => plan(s)); assert.equal(calls, 0); assert.throws(() => plan(edit(subject(), s => s.record.content = "x".repeat(4194304))));
  assert.throws(() => plan(edit(subject(), s => s.host.check = () => { calls++; }))); assert.equal(calls, 0);
});
test("C2c-A schema maxima cover every observed view and fit the unchanged diagnostic limit", t => {
  const p = plan(), c = target.describeUnsignedWorkerRecordInitializationCapacity(subject());
  assert.ok(c.diagnostic_ceiling_bytes <= 16384); assert.ok(Buffer.byteLength(canonical(p)) <= c.diagnostic_ceiling_bytes);
  assert.equal(c.parent_wrapper_calculated, false); assert.equal(c.event_limit, 128); assert.equal(c.record_limit_bytes, 4194304);
  assert.equal(c.maximal_plan.model.modeled_actions, 7); t.diagnostic(JSON.stringify({ diagnostic_bytes: c.diagnostic_ceiling_bytes, retained_peak: c.memory.retained_peak_bytes }));
  function covers(value, maximum) {
    assert.ok(Buffer.byteLength(canonical(value)) <= Buffer.byteLength(canonical(maximum)));
    if (Array.isArray(value)) { assert.ok(value.length <= maximum.length); value.forEach((v, i) => covers(v, maximum[i])); }
    else if (value && typeof value === "object") { assert.deepEqual(Object.keys(value).sort(), Object.keys(maximum).sort()); for (const k of Object.keys(value)) covers(value[k], maximum[k]); }
  }
  for (const s of [subject(), sequence(subject()), edit(subject(), s => { for (const k of Object.keys(s.profiles)) s.profiles[k] = "unavailable"; s.memory[0].transient.parser_queue = null; }),
    edit(sequence(subject(), 1), s => s.events[2].outcome = "unknown")]) covers(plan(s), c.maximal_plan);
  const all = sequence(subject()); for (let i = 0; i <= all.events.length; i++) covers(plan(edit(all, s => s.events = s.events.slice(0, i))), c.maximal_plan);
  const faulty = edit(sequence(subject(), 1), s => s.events[2].at = null);
  assert.equal(target.describeUnsignedWorkerRecordInitializationCapacity(faulty).diagnostic_ceiling_bytes, c.diagnostic_ceiling_bytes);
});
test("C2c-A captures supplied data without freezing or mutating the caller", () => {
  const s = subject(), before = clone(s), p = plan(s); assert.deepEqual(s, before); assert.equal(Object.isFrozen(s.profiles), false);
  s.profiles.parser = "unavailable"; assert.equal(p.supplied_plan_complete, true); assert.equal(plan(s).supplied_plan_complete, false);
});
for (const [name, change] of [["null clock", e => e.at = null], ["lost reference", e => e.references[0] = "unreferenced"]])
  test(`C2c-A failed checkpoint cannot initiate a new resource close: ${name}`, () => {
    const s = sequence(subject(), 1), close = fact("close_begin", { resource: "record", original_matches: true }); change(close);
    s.events.push(close, fact("close_result", { resource: "record", outcome: "confirmed" }));
    const p = plan(s); assert.equal(p.model.resources.record.close_attempted, false); assert.equal(p.model.resources.record.disposition, "owned"); assert.equal(p.model.retained, true);
  });
test("C2c-A initialization hash work cannot move behind initialization", () => {
  const s = subject(); for (const m of s.work.modes) { m.steps[3].cost.hash_bytes = "0"; m.steps[6].cost.hash_bytes = "100"; }
  assert.throws(() => plan(sequence(s)), /initialization_hash_cost/);
});
for (const [index, bytes, reason] of [[0, "100", "metadata_hash_cost"], [2, "200", "closed_set_hash_cost"]])
  test(`C2c-A hash work cannot move behind its consuming step: ${reason}`, () => {
    const s = subject(); for (const m of s.work.modes) { m.steps[index].cost.hash_bytes = "0"; m.steps[6].cost.hash_bytes = bytes; }
    assert.throws(() => plan(s), new RegExp(reason));
  });
for (const kind of ["rows", "bytes"]) test(`C2c-A projection obeys C2a supplied page ${kind}`, () => {
  const s = subject(); s.record.rows = s.startup.manifest.rows = 2; s.record.pages = s.startup.manifest.pages = 2;
  s.record.manifest_bytes = s.startup.manifest.manifest_bytes = 8192;
  if (kind === "rows") s.record.page.rows.push({ ...s.record.page.rows[0], path_sha256: other, identity_sha256: other });
  else s.record.page.bytes = 8192;
  assert.throws(() => plan(s), /record_projection/);
});
for (const [role, field] of [["addon", "artifact_sha256"], ["reader", "artifact_sha256"], ["reader", "source_sha256"]])
  test(`C2c-A matching local expected ${role} ${field} cannot replace a LAUNCH pin`, () => {
    const s = subject(), m = s.modules.find(m => m.role === role); m[field] = other;
    if (field === "artifact_sha256") m.expected_artifact_sha256 = other;
    assert.ok(plan(sequence(s)).blockers.includes("module_launch_pin_mismatch"));
  });
test("C2c-A known page file bytes cannot exceed the unchanged pass ceiling", () => {
  const s = subject(); s.record.rows = s.startup.manifest.rows = s.startup.manifest.page_rows = 5;
  s.record.page.rows = Array.from({ length: 5 }, (_, i) => ({ ...s.record.page.rows[0], path_sha256: String(i).padStart(64, "0"), identity_sha256: String(i).padStart(64, "0"), bytes: "67108864" }));
  assert.throws(() => plan(s), /manifest_pass_bound/);
});
function aliasSubject(key) {
  const s = subject(); s.record.rows = s.startup.manifest.rows = s.startup.manifest.page_rows = 2;
  s.record.page.rows.push({ ...s.record.page.rows[0], path_sha256: other, identity_sha256: other });
  s.record.page.rows[1][key] = h; return s;
}
for (const [key, reason] of [["path_sha256", "row_alias"], ["identity_sha256", "row_identity_alias"]])
  test(`C2c-A independently rejects ${reason} after all projection checks`, () => assert.throws(() => plan(aliasSubject(key)), { message: "cc4c2ca_" + reason }));
test("C2c-A stop retires an unbegun reservation without refund or invented acquisition", () => {
  const s = sequence(subject(), 1); s.events = [s.events[0], fact("stop", { reason: "stop" })];
  const p = plan(s); assert.equal(p.model.active_step, null); assert.equal(p.model.retained, false); assert.equal(p.model.spent.hash_bytes, "100"); assert.equal(p.model.refunded, false);
});
test("C2c-A healthy original cleanup remains possible after preparation expiry", () => {
  const s = sequence(subject(), 1); s.events.push(fact("close_begin", { resource: "record", original_matches: true }, "120000000000"), fact("close_result", { resource: "record", outcome: "confirmed" }, "120000000001"));
  const p = plan(s); assert.equal(p.model.first_stop, "preparation_deadline"); assert.equal(p.model.resources.record.disposition, "released"); assert.equal(p.model.retained, false);
});
test("C2c-A sticky invalid clock blocks later new closes but not already-started close results", () => {
  const s = sequence(subject(), 1); s.events.push(fact("stop", { reason: "stop" }), fact("close_begin", { resource: "record", original_matches: true }), fact("close_result", { resource: "record", outcome: "confirmed", at: null }));
  assert.equal(plan(s).model.resources.record.disposition, "released");
  const late = sequence(subject(), 1); late.events.push(fact("stop", { reason: "stop", at: null }), fact("close_begin", { resource: "record", original_matches: true }));
  assert.equal(plan(late).model.resources.record.close_attempted, false); assert.equal(plan(late).model.retained, true);
});
test("C2c-A page and event bounds are projection bounds, not a smaller record language", () => {
  const s = subject(); recordSize(s, 131072); s.record.manifest_bytes = s.startup.manifest.manifest_bytes = 65536;
  s.record.rows = s.startup.manifest.rows = 128; s.startup.manifest.page_rows = 128; s.startup.manifest.page_bytes = 65536;
  s.record.page.rows = Array.from({ length: 128 }, (_, i) => ({ ...s.record.page.rows[0], path_sha256: i.toString(16).padStart(64, "0"), identity_sha256: i.toString(16).padStart(64, "0") }));
  s.record.page.bytes = 65536; assert.equal(plan(s).supplied_plan_complete, true);
  s.record.page.rows.push(clone(s.record.page.rows[0])); assert.throws(() => plan(s));
  const events = edit(subject(), s => s.events = Array.from({ length: 128 }, () => fact("stop", { reason: "stop" })));
  assert.equal(plan(events).model.first_stop, "stop"); events.events.push(fact("stop", { reason: "stop" })); assert.throws(() => plan(events));
  const maximum = subject(); recordSize(maximum, 4194304); assert.equal(plan(maximum).supplied_plan_complete, true);
});
test("C2c-A unknown amount does not hide an already excessive phase", () => {
  const s = subject(); s.memory[0].retained.parser_queue = null; s.memory[0].retained.membership = "2375680"; assert.throws(() => plan(s), /capacity_bound/);
});
test("C2c-A stopped reservation cannot be replaced and spent work is retained", () => {
  const s = sequence(subject(), 1); s.events[2].outcome = "refused";
  s.events.push(fact("reserve", { action_id: "replacement", step: "record_open", cost: clone(s.work.modes[0].steps[0].cost) }));
  const p = plan(s); assert.equal(p.model.first_stop, "operation_refused"); assert.equal(p.model.modeled_actions, 1); assert.equal(p.model.spent.hash_bytes, "100");
});
test("C2c-A all unknown profiles stay blocked even if events claim a result", () => {
  const s = sequence(subject(), 1); for (const k of Object.keys(s.profiles)) s.profiles[k] = "unavailable";
  const p = plan(s); assert.equal(p.model.completed_steps, 0); assert.equal(p.model.modeled_actions, 0); assert.equal(p.model.resources.record.disposition, "absent");
});
test("C2c-A targeted behavior mutations require successful controls and syntax-valid changes", () => {
  const compile = text => {
    const tree = ts.createSourceFile("model.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); assert.equal(tree.parseDiagnostics.length, 0);
    const body = Array.from(tree.statements).filter(n => !ts.isImportDeclaration(n)).map(n => n.getText().replace(/^export\s+/, "")).join("\n");
    const env = { z, uint: data.uint, label: data.label, code: data.code, hash: data.digestSchema, count: data.count, parse: data.parse, canonical, digest,
      byteLength: data.byteLength, freeze: data.freeze, flags: data.flags, LIMITS: data.LIMITS, planUnsignedWorkerStartup: startup.planUnsignedWorkerStartup, describeUnsignedQualificationProfile: qualification.describeUnsignedQualificationProfile };
    return vm.compileFunction(body + "\nreturn {planUnsignedWorkerRecordInitialization};", Object.keys(env))(...Object.values(env)).planUnsignedWorkerRecordInitialization;
  };
  const trials = [
    ['if (active !== null && !actions.get(active).begun) active = null;', '', fn => {
      const s = sequence(subject(), 1); s.events = [s.events[0], fact("stop", { reason: "stop" })]; assert.equal(fn(s).model.retained, false);
    }],
    ['if (clockInvalid || e.references.some(v => v !== "referenced"))', 'if (false)', fn => {
      const s = sequence(subject(), 1); s.events.push(fact("close_begin", { resource: "record", original_matches: true, at: null })); assert.equal(fn(s).model.resources.record.close_attempted, false);
    }],
    ...[["record_open", 'sum([b.metadata_hash_bytes])', 0, "100"], ["closed_set", 'sum([b.module_bytes, b.pin_bytes])', 2, "200"], ["initialization", 'sum([m.initialization_hash_bytes])', 3, "100"]].map(([stage, expression, index, bytes]) => [
      `["${stage}", ${expression},`, `["${stage}", 0n,`, fn => assert.throws(() => fn(edit(subject(), s => { for (const m of s.work.modes) { m.steps[index].cost.hash_bytes = "0"; m.steps[6].cost.hash_bytes = bytes; } }))),
    ]),
    ['r.page.rows.length > d.startup.manifest.page_rows', 'false', fn => assert.throws(() => fn(edit(subject(), s => {
      s.record.rows = s.startup.manifest.rows = s.record.pages = s.startup.manifest.pages = 2; s.record.manifest_bytes = s.startup.manifest.manifest_bytes = 8192;
      s.record.page.rows.push({ ...s.record.page.rows[0], path_sha256: other, identity_sha256: other });
    })))],
    ['r.page.bytes > d.startup.manifest.page_bytes', 'false', fn => assert.throws(() => fn(edit(subject(), s => {
      s.record.rows = s.startup.manifest.rows = s.record.pages = s.startup.manifest.pages = 2; s.record.manifest_bytes = s.startup.manifest.manifest_bytes = s.record.page.bytes = 8192;
    })))],
    ...[["addon", "artifact_sha256", 'm.artifact_sha256 !== d.startup.binding.addon_sha256'], ["reader", "artifact_sha256", 'm.artifact_sha256 !== d.startup.binding.reader_js_sha256'],
      ["reader", "source_sha256", 'm.source_sha256 !== d.startup.binding.reader_source_sha256']].map(([role, field, predicate]) => [predicate, 'false', fn => {
        const s = subject(), m = s.modules.find(m => m.role === role); m[field] = other; if (field === "artifact_sha256") m.expected_artifact_sha256 = other;
        assert.ok(fn(s).blockers.includes("module_launch_pin_mismatch"));
      }]),
    ['sum(r.page.rows.map(v => v.bytes)) > BigInt(profile.pass_bytes)', 'false', fn => assert.throws(() => fn(edit(subject(), s => {
      s.record.rows = s.startup.manifest.rows = s.startup.manifest.page_rows = 5;
      s.record.page.rows = Array.from({ length: 5 }, (_, i) => ({ ...s.record.page.rows[0], path_sha256: String(i).padStart(64, "0"), identity_sha256: String(i).padStart(64, "0"), bytes: "67108864" }));
    })))],
    ...[["path_sha256", "row_alias"], ["identity_sha256", "row_identity_alias"]].map(([key, reason]) => [
      `unique(r.page.rows.map(v => v.${key}), "${reason}");`, '', fn => assert.throws(() => fn(aliasSubject(key)), { message: "cc4c2ca_" + reason }),
    ]),
    ['r.canonical !== "exact_supplied"', 'false', fn => assert.ok(fn(edit(subject(), s => s.record.canonical = "hash_only")).blockers.includes("exact_canonical_comparison_unavailable"))],
    ['d.host.source !== "supplied_worker"', 'false', fn => assert.ok(fn(edit(subject(), s => s.host.source = "candidate_self")).blockers.includes("worker_host_observation_unavailable"))],
    ['r > 2375680n', 'false', fn => assert.throws(() => fn(edit(subject(), s => s.memory[0].retained.membership = "2375680")))],
    ['t > 4259840n', 'false', fn => assert.throws(() => fn(edit(subject(), s => s.memory[0].transient.membership = "4259841")))],
    ['perStartRead > BigInt(profile.pass_bytes)', 'false', fn => assert.throws(() => fn(edit(subject(), s => s.work.modes[0].steps[2].cost.read_bytes = "268435456")))],
    ['max(sum(expectedHash), sum(m.steps.map(v => v.cost.hash_bytes)))', 'sum(expectedHash)', fn => assert.throws(() => fn(edit(subject(), s => {
      s.startup.work.modes[0].module_bytes = null; s.work.modes[0].steps[2].cost.hash_bytes = "200000000";
    })))],
    ['d.profiles[k] !== "matched_supplied"', 'false', fn => assert.ok(fn(edit(subject(), s => s.profiles.parser = "unavailable")).blockers.includes("parser_unavailable"))],
    ['last >= actions.get(active).deadline', 'false', fn => {
      const s = sequence(subject(), 1); s.events[2].at.monotonic_ns = "10000000000"; assert.equal(fn(s).model.first_stop, "operation_deadline");
    }],
    ['if (!stopped) { index++;', 'if (true) { index++;', fn => { const s = sequence(subject(), 1); s.events[2].at.monotonic_ns = "120000000000"; assert.equal(fn(s).model.completed_steps, 0); }],
    ['resources.record.disposition = e.outcome === "returned" ? "owned" : "absent"', 'resources.record.disposition = "absent"', fn => assert.equal(fn(sequence(subject(), 1)).model.resources.record.disposition, "owned")],
    ['e.original_matches ? "closing" : "foreign_retained"', '"closing"', fn => {
      const s = sequence(subject()); s.events.push(fact("stop", { reason: "stop" }), fact("close_begin", { resource: "cache", original_matches: false })); assert.equal(fn(s).model.resources.cache.disposition, "foreign_retained");
    }],
    ['m.extra_record_hash_bytes) % BigInt(d.record.bytes) !== 0n', 'm.extra_record_hash_bytes) < 0n', fn => assert.throws(() => fn(edit(subject(), s => {
      s.work.modes[0].extra_record_hash_bytes = "1"; s.work.modes[0].steps[1].cost.hash_bytes = "8293"; s.work.modes[0].steps[1].cost.read_bytes = "16385"; s.startup.work.other_hash_bytes = "4812";
    })))],
  ];
  for (const [from, to, check] of trials) { assert.equal(source.split(from).length, 2, from); check(compile(source)); const changed = source.replace(from, to); assert.notEqual(changed, source);
    assert.throws(() => check(compile(changed)), { code: "ERR_ASSERTION" }, from); }
});
test("C2c-A independent required sinks precede safe probes", () => {
  const required = [[fs, "readSync"], [fs, "read"], [fs, "readv"], [fs, "readvSync"], [fs, "createReadStream"], [fs, "writeSync"], [net, "Socket"], [net, "Server"], [server, "listen"], [socket, "connect"], [datagram, "bind"], [child, "spawn"], [workers, "MessageChannel"], [crypto, "sign"], [crypto, "createPrivateKey"], [process, "dlopen"], [process, "getBuiltinModule"], [globalThis, "Date"], [Date, "now"], [process.hrtime, "bigint"], [timers, "setTimeout"]];
  required.push([fs, "open"], [fsp, "open"], ...["lchmod", "lchown"].flatMap(k => [[fs, k], [fs, k + "Sync"], [fsp, k]]).filter(([o, k]) => typeof o[k] === "function"));
  for (const [o, k] of required) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  const before = effects.length; for (const [o, k] of blocked) assert.throws(() => o[k](), /c2ca_forbidden_effect/);
  assert.equal(effects.length, before + blocked.length); effects.length = before; assert.equal(escapedRead, 0);
});
test("C2c-A no denied effect was swallowed", () => assert.deepEqual(effects, []));
