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
  blocked.push([o, k]); replace(o, k, () => { effects.push(k); throw Error("c2cb1_forbidden_effect"); });
} }
let escapedRead = 0;
let escapedParse = 0;
replace(JSON, "parse", () => { escapedParse++; throw Error("c2cb1_parse_sentinel"); });
block(JSON, ["parse"]);
replace(fs, "readSync", () => { escapedRead++; throw Error("c2cb1_read_sentinel"); });
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
    effects.push(k); throw Error("c2cb1_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = n => () => { effects.push(n); throw Error("c2cb1_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)]))); replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(performance, ["now"]); block(process, ["uptime", "cpuUsage", "resourceUsage"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); assert.equal(escapedRead, 0); assert.equal(escapedParse, 0); });

const target = await import("../helpers/unsignedWorkerParserAcceptanceContracts.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const { z } = await import("zod");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../helpers/unsignedWorkerParserAcceptanceContracts.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const h = "a".repeat(64), other = "b".repeat(64), integrity = "sha512-" + Buffer.alloc(64).toString("base64");
// Each package has its own tarball, commit and tree digests; the stream-json entry digest h is also the source-bound pin.
const own = { "stream-json": { integrity, commit: "a".repeat(40), digest: h },
  "stream-chain": { integrity: "sha512-" + Buffer.alloc(64, 2).toString("base64"), commit: "c".repeat(40), digest: "c".repeat(64) } };
const groups = ["pins", "initialization", "grammar", "finalization", "encoding", "canonical", "record_schema", "size_bounds", "chunking", "retention", "work_stop", "authority"];
const parts = ["decoder_carry", "text_suffix", "decoded_fragment", "scalar_scratch", "nesting_stack", "token_batch", "canonical_window", "projection", "diagnostics"];
const bounds = ["carry_bytes", "suffix_bytes", "decoded_bytes", "scalar_bytes", "stack_bytes", "batch_bytes", "canonical_lag_bytes", "stack_entries", "batch_items", "steps_per_fragment", "flush_steps"];
const metrics = ["feed_byte_work", "decode_byte_work", "copy_byte_work", "encode_byte_work", "token_work", "flush_work"];
const edit = (s, fn) => { const c = structuredClone(s); fn(c); return c; };
function subject() {
  return { schema: "unsigned-worker-parser-acceptance-plan-v1",
    packages: [["stream-json", "3.8.0"], ["stream-chain", "4.4.1"]].map(([name, version]) => { const o = own[name]; return {
      name, version, state: "matched_supplied", resolved: "https://registry.npmjs.org/" + name + "/-/" + name + "-" + version + ".tgz",
      integrity: o.integrity, expected_integrity: o.integrity, commit: o.commit, expected_commit: o.commit,
      files_sha256: o.digest, expected_files_sha256: o.digest, exports_sha256: o.digest, expected_exports_sha256: o.digest, entry_sha256: o.digest, expected_entry_sha256: o.digest,
      license: "BSD-3-Clause", files: 10, bytes: "10000" }; }),
    closure: { state: "matched_supplied", graph_sha256: h, expected_graph_sha256: h, lock_sha256: h, expected_lock_sha256: h,
      chain_instances: 1, dependency: "stream-json:stream-chain:^4.4.1", entry: "stream-json/core/parser.js:jsonParser", target: "stream-json/src/core/parser.js",
      builtin: "node:string_decoder", all_edges_enumerated: true },
    profile: { options: { packKeys: false, packStrings: false, packNumbers: false, streamKeys: true, streamStrings: true, streamNumbers: true, jsonStreaming: false },
      decoder: "independent_fatal", finalization: "decoder_then_parser_once", fragment_bytes: 256, control_fragments: [1, 16, 64, 256] },
    initialization: { state: "matched_supplied", decision: "approved_supplied", effects: ["allocation", "shared_symbol_registry", "async_builtin_import", "suppressed_import_failure", "host_decoder_selection", "bom_normalization"],
      closure_sha256: h, expected_closure_sha256: h, runtime_sha256: h, source: "supplied_original_summary", readiness: "fulfilled", decoder_outcome: "installed", settled_once: true },
    source_bounds: { state: "matched_supplied", source_sha256: h, includes_prior_state: true,
      ...Object.fromEntries(bounds.map(k => [k, "256"])) },
    memory: ["initialization", "feed", "finish"].map(phase => ({ phase,
      retained: Object.fromEntries(parts.map(k => [k, "256"])), transient: Object.fromEntries(parts.map(k => [k, "0"])) })),
    heap: "matched_supplied", work: { prior_hash_bytes: "196608", prior_helper_commands: "0", cost_profile: "matched_supplied",
      modes: ["normal", "ubsan"].map(mode => ({ mode, starts: 12, record_bytes: 8192, c2a_record_hash_bytes: "8192",
        additional_record_hash_passes: 0, subset_hash_bytes: "100", initialization_hash_bytes: "100", extra_helper_commands: "1",
        ...Object.fromEntries(metrics.map(k => [k, k === "flush_work" ? "256" : "8192"])) })) },
    acceptance: groups.map(group => ({ group, state: "matched_supplied", positive_cases: 1, negative_cases: 1 })) };
}
function sizedSubject(bytes) {
  const s = subject();
  for (const m of s.work.modes) {
    m.record_bytes = bytes; m.c2a_record_hash_bytes = String(bytes);
    for (const k of metrics) m[k] = String(k === "token_work" ? Math.ceil(bytes / 256) * 256 : k === "flush_work" ? 256 : bytes);
  }
  s.work.prior_hash_bytes = String(24 * bytes); return s;
}
const plan = (s = subject()) => target.planUnsignedWorkerParserAcceptance(s);
const refuses = (s, reason) => assert.throws(() => plan(s), { message: "cc4c2cb1_" + reason });
const blocks = (s, reason) => { const p = plan(s); assert.equal(p.supplied_plan_complete, false); assert.ok(p.blockers.includes(reason), reason); return p; };
test("B1 complete invented summaries are not parser results or capabilities", () => {
  const p = plan(); assert.equal(p.supplied_plan_complete, true); assert.equal(p.pins_consistent_supplied, true);
  assert.equal(p.synthetic_acceptance_complete, true); assert.deepEqual(p.blockers, []);
  assert.equal(p.acceptance_scope, "supplied_case_summary_not_parser_test_results");
  assert.equal(p.native_status, "NOT_RUN"); assert.equal(p.runtime_producers, "unavailable");
  for (const k of ["parser_executed", "parser_available", "runtime_completion_proven", "startup_proof_issued", "actual_package_bytes_verified",
    "execution_available", "signing_available", "evidence_saved", "runtime_qualified"]) assert.equal(p[k], false);
  assert.equal(p.capacity.heap_runtime_qualified, false); assert.equal(p.work.elapsed_time_qualified, false);
  assert.equal(p.work.synchronous_preemption_proven, false); assert.equal(p.work.refunded, false);
  assert.equal(p.input_record_bytes_held, 0); assert.ok(Object.isFrozen(p.capacity));
  assert.deepEqual(target.describeUnsignedWorkerParserAcceptanceCapacity(subject()), p);
});
test("B1 source input and immutable outputs do not alias", () => {
  const s = subject(), before = data.canonical(s), p = plan(s); assert.equal(data.canonical(s), before);
  s.packages[0].version = "0"; assert.equal(p.evaluation_tuple[0].version, "3.8.0");
  assert.throws(() => p.evaluation_tuple[0].version = "0", TypeError);
});
for (let i = 0; i < 2; i++) for (const key of ["resolved", "integrity", "expected_integrity", "commit", "expected_commit",
  "files_sha256", "expected_files_sha256", "exports_sha256", "expected_exports_sha256", "entry_sha256", "expected_entry_sha256", "license", "files", "bytes"])
  test("B1 unavailable package field " + i + " " + key, () => {
    const blocker = ["resolved", "license", "files", "bytes"].includes(key) ? subject().packages[i].name.replaceAll("-", "_") + "_" + key : key.replace(/^expected_/, "");
    const p = blocks(edit(subject(), s => s.packages[i][key] = null), blocker + "_unavailable");
    assert.equal(p.pins_consistent_supplied, false);
  });
for (const state of ["unavailable", "refused"]) for (const i of [0, 1]) test("B1 package state " + i + " " + state, () => {
  const p = blocks(edit(subject(), s => s.packages[i].state = state), subject().packages[i].name.replaceAll("-", "_") + "_" + state);
  assert.equal(p.pins_consistent_supplied, false);
});
for (const k of ["integrity", "commit", "files_sha256", "exports_sha256", "entry_sha256"]) test("B1 own pin mismatch " + k, () => {
  refuses(edit(subject(), s => s.packages[0][k] = k === "integrity" ? "sha512-" + Buffer.alloc(64, 1).toString("base64") : k === "commit" ? "b".repeat(40) : other), k);
});
for (const [name, change, reason] of [
  ["version", s => s.packages[0].version = "3.8.1", "evaluation_tuple"],
  ["duplicate package", s => s.packages[1] = structuredClone(s.packages[0]), "package_set"],
  ["origin", s => s.packages[0].resolved = "https://elsewhere.invalid/p.tgz", "tarball_origin"],
  ["empty bytes", s => s.packages[0].bytes = "0", "package_bytes"],
  ["multiple chain", s => s.closure.chain_instances = 2, "chain_instances"],
  ["no chain", s => s.closure.chain_instances = 0, "chain_instances"],
  ["graph", s => s.closure.graph_sha256 = other, "graph_sha256"],
  ["lock", s => s.closure.lock_sha256 = other, "lock_sha256"],
  ["duplicate mode", s => s.work.modes[1].mode = "normal", "work_modes"],
  ["duplicate phase", s => s.memory[1].phase = "finish", "memory_phases"],
  ["duplicate group", s => s.acceptance[1].group = "pins", "acceptance_groups"],
]) test("B1 refuses " + name, () => refuses(edit(subject(), change), reason));
for (const k of Object.keys(subject().profile.options)) test("B1 fixed option " + k, () => {
  refuses(edit(subject(), s => s.profile.options[k] = !s.profile.options[k]), "parser_options");
});
for (const decoder of ["replacement", "package_wrapper"]) test("B1 normalizing decoder " + decoder, () => refuses(edit(subject(), s => s.profile.decoder = decoder), "encoding_profile"));
for (const finalization of ["parser_first", "repeatable"]) test("B1 finalization " + finalization, () => refuses(edit(subject(), s => s.profile.finalization = finalization), "encoding_profile"));
test("B1 fragment and controls are fixed, not record ceiling changes", () => {
  refuses(edit(subject(), s => s.profile.fragment_bytes = 65536), "fragment_profile");
  refuses(edit(subject(), s => s.profile.control_fragments.reverse()), "fragment_profile");
  assert.equal(plan().limits.record_bytes, 4194304);
});
for (const [k, blocker] of [["graph_sha256", "graph_sha256_unavailable"], ["expected_graph_sha256", "graph_sha256_unavailable"], ["lock_sha256", "lock_sha256_unavailable"],
  ["expected_lock_sha256", "lock_sha256_unavailable"], ["chain_instances", "closure_inventory_unavailable"], ["all_edges_enumerated", "closure_inventory_unavailable"]])
  test("B1 missing closure " + k, () => assert.equal(blocks(edit(subject(), s => s.closure[k] = null), blocker).pins_consistent_supplied, false));
for (const [key, blocker] of [["effects", "initializer_inventory_unavailable"], ["runtime_sha256", "runtime_identity_unavailable"], ["closure_sha256", "initializer_closure_unavailable"],
  ["expected_closure_sha256", "initializer_closure_unavailable"], ["settled_once", "readiness_unavailable"]])
  test("B1 missing initializer " + key, () => blocks(edit(subject(), s => s.initialization[key] = null), blocker));
test("B1 readiness fulfillment is not decoder-install evidence", () => {
  blocks(edit(subject(), s => s.initialization.decoder_outcome = "unavailable"), "decoder_outcome_unavailable");
  blocks(edit(subject(), s => s.initialization.decoder_outcome = "not_installed"), "decoder_outcome_unavailable");
});
for (const [key, value, blocker] of [
  ["source", "synthetic_summary", "original_readiness_unavailable"], ["source", "unavailable", "original_readiness_unavailable"],
  ["readiness", "rejected", "readiness_unavailable"], ["readiness", "unavailable", "readiness_unavailable"], ["settled_once", false, "readiness_unavailable"],
  ["decision", "pending", "initialization_decision_pending"], ["decision", "refused", "initialization_decision_refused"],
  ["state", "unavailable", "initialization_unavailable"], ["state", "refused", "initialization_refused"],
]) test("B1 initialization " + key + " " + value, () => blocks(edit(subject(), s => s.initialization[key] = value), blocker));
test("B1 initializer inventory is closed and complete", () => {
  refuses(edit(subject(), s => s.initialization.effects.pop()), "initializer_effects");
  refuses(edit(subject(), s => s.initialization.effects[0] = s.initialization.effects[1]), "initializer_effects");
  refuses(edit(subject(), s => s.initialization.closure_sha256 = other), "initializer_closure");
  assert.equal(plan(edit(subject(), s => s.initialization.effects.reverse())).supplied_plan_complete, true);
});
test("B1 initializer summary must refer to the pinned closure, not another self-consistent receipt", () => {
  refuses(edit(subject(), s => { s.initialization.closure_sha256 = s.initialization.expected_closure_sha256 = other; }), "initializer_binding");
});
test("B1 source bounds must refer to the pinned parser entry", () => {
  refuses(edit(subject(), s => s.source_bounds.source_sha256 = other), "parser_source_binding");
});
for (const [key, value] of [["carry_bytes", "2"], ["decoded_bytes", "255"], ["stack_bytes", "0"], ["batch_bytes", "0"], ["steps_per_fragment", "0"]])
  test("B1 source geometry cannot contradict its nonzero fragment/batch " + key, () => {
    refuses(edit(subject(), s => s.source_bounds[key] = value), "source_geometry");
  });
for (const key of bounds) test("B1 unavailable source bound " + key, () => blocks(edit(subject(), s => s.source_bounds[key] = null), "source_bounds_incomplete"));
for (const key of ["stack_entries", "batch_items"]) test("B1 accounts fragment overshoot " + key, () => refuses(edit(subject(), s => s.source_bounds[key] = "255"), "fragment_overshoot"));
for (const [cardinality, key] of [["stack_entries", "stack_bytes"], ["batch_items", "batch_bytes"], ["batch_items", "steps_per_fragment"]])
  test("B1 null cardinality preserves the known fragment minimum for " + key, () => {
    refuses(edit(subject(), s => { s.source_bounds[cardinality] = null; s.source_bounds[key] = "0"; }), "source_geometry");
  });
test("B1 unknown batch and step bounds cannot make declared token work zero", () => {
  refuses(edit(subject(), s => { s.source_bounds.batch_items = s.source_bounds.steps_per_fragment = null;
    s.work.modes.forEach(m => m.token_work = "0"); }), "parser_work_floor");
});
for (const [field, part] of [["carry_bytes", "decoder_carry"], ["decoded_bytes", "decoded_fragment"], ["stack_bytes", "nesting_stack"], ["batch_bytes", "token_batch"]])
  test("B1 missing source amount retains its intrinsic allocation floor " + field, () => {
    refuses(edit(subject(), s => { s.source_bounds[field] = null;
      s.memory[1].retained[part] = s.memory[1].transient[part] = "0";
    }), "source_memory_floor");
  });
for (const key of ["source_sha256", "includes_prior_state"]) test("B1 source and prior-state evidence " + key, () => blocks(edit(subject(), s => s.source_bounds[key] = null), "source_bounds_incomplete"));
for (const state of ["unavailable", "refused"]) for (const path of ["heap", "source_bounds", "cost_profile"]) test("B1 unqualified " + path + " " + state, () => {
  const s = subject(); if (path === "heap") s.heap = state; else if (path === "cost_profile") s.work.cost_profile = state; else s.source_bounds.state = state;
  blocks(s, path + "_" + state);
});
test("B1 standalone capacity adds simultaneous C2a transient reservation without clearing overlap", () => {
  const p = blocks(edit(subject(), s => s.memory[1].transient.token_batch = "1"), "transient_overlap_unproven");
  assert.equal(p.capacity.known_simultaneous_transient_bytes, "4259841"); assert.equal(p.capacity.transient_peak_bytes, "1");
  assert.equal(p.capacity.parent_wrapper_calculated, false);
});
for (const phase of [0, 1, 2]) for (const domain of ["retained", "transient"]) for (const part of parts)
test(`B1 unknown memory is not complete ${phase} ${domain} ${part}`, () => {
  const p = blocks(edit(subject(), s => s.memory[phase][domain][part] = null), "memory_unknown");
  assert.equal(p.capacity.complete, false);
  assert.equal(p.capacity.transient_peak_bytes, null); assert.equal(p.capacity.retained_peak_bytes, null);
});
for (const [domain, cap] of [["retained", 2375680], ["transient", 4259840]]) test("B1 known " + domain + " limit even with unknown peer", () => {
  const s = subject(); for (const k of parts) s.memory[0][domain][k] = "0";
  s.memory[0][domain].diagnostics = String(cap); assert.equal(plan(s).capacity["known_" + domain + "_peak_bytes"], String(cap));
  s.memory[0][domain].projection = null; s.memory[0][domain].diagnostics = String(cap + 1); refuses(s, "capacity_bound");
});
test("B1 source allocation floor is checked before model completion", () => refuses(edit(subject(), s => s.memory[1].retained.text_suffix = "255"), "source_memory_floor"));
for (const [domain, bytes] of [["retained", "2373633"], ["transient", "4259841"]])
  test("B1 source floor exposes an unknown " + domain + " overrun", () => {
    refuses(edit(subject(), s => { s.source_bounds.carry_bytes = bytes;
      s.memory[1].retained.decoder_carry = domain === "retained" ? null : "0";
      s.memory[1].transient.decoder_carry = domain === "transient" ? null : "0";
    }), "capacity_bound");
  });
test("B1 inferred transient floor keeps overlap blocked and complete peaks unknown", () => {
  const p = blocks(edit(subject(), s => { s.source_bounds.carry_bytes = "257";
    s.memory[1].retained.decoder_carry = "0"; s.memory[1].transient.decoder_carry = null;
  }), "transient_overlap_unproven");
  assert.equal(p.capacity.known_transient_peak_bytes, "257");
  assert.equal(p.capacity.known_simultaneous_transient_bytes, "4260097");
  assert.equal(p.capacity.transient_peak_bytes, null); assert.equal(p.capacity.complete, false);
});
for (const [domain, bytes, expected] of [["retained", "2373632", "2375680"], ["transient", "4259840", "4259840"]])
  test("B1 inferred " + domain + " floor allows its exact standalone ceiling", () => {
    const p = blocks(edit(subject(), s => { s.source_bounds.carry_bytes = bytes;
      s.memory[1].retained.decoder_carry = domain === "retained" ? null : "0";
      s.memory[1].transient.decoder_carry = domain === "transient" ? null : "0";
    }), "memory_unknown");
    assert.equal(p.capacity["known_" + domain + "_peak_bytes"], expected);
  });
test("B1 joint unknown allocations preserve their combined floor without double counting", () => {
  const change = (s, bytes) => { s.source_bounds.carry_bytes = bytes;
    s.memory[1].retained.decoder_carry = s.memory[1].transient.decoder_carry = null; };
  const p = blocks(edit(subject(), s => change(s, "3000000")), "transient_overlap_unproven");
  assert.equal(p.capacity.known_combined_peak_bytes, "3002048");
  assert.equal(p.capacity.known_transient_peak_bytes, "626368");
  const q = plan(edit(subject(), s => change(s, "6633472")));
  assert.equal(q.capacity.known_retained_peak_bytes, "2375680");
  assert.equal(q.capacity.known_transient_peak_bytes, "4259840");
  refuses(edit(subject(), s => change(s, "6633473")), "capacity_bound");
});
test("B1 record hash is once per C2a start; extra passes and both modes charged separately", () => {
  const p = plan(); assert.equal(p.work.c2a_raw_record_hash_bytes, "196608"); assert.equal(p.work.additional_hash_bytes, "4800");
  assert.equal(p.work.modeled_hash_bytes, "201408"); assert.equal(p.work.modeled_helper_commands, "24");
  assert.equal(plan(edit(subject(), s => s.work.modes[1].additional_record_hash_passes = 1)).work.modeled_hash_bytes, "299712");
  assert.equal(p.work.units.feed_byte_work.modeled, "196608"); assert.equal(p.work.units.flush_work.modeled, "6144");
});
for (const mode of ["normal", "ubsan"]) test("B1 both modes bind the same record size " + mode, () => {
  assert.equal(plan().supplied_plan_complete, true);
  refuses(edit(subject(), s => { const m = s.work.modes.find(m => m.mode === mode);
    m.record_bytes = 8191; m.c2a_record_hash_bytes = "8191"; s.work.prior_hash_bytes = "196596";
  }), "shared_record_size");
});
test("B1 missing prior hash includes raw lower bound but not a complete zero", () => {
  const p = blocks(edit(subject(), s => s.work.prior_hash_bytes = null), "hash_work_unknown");
  assert.equal(p.work.known_hash_bytes, "201408"); assert.equal(p.work.modeled_hash_bytes, null);
});
for (const key of ["additional_record_hash_passes", "subset_hash_bytes", "initialization_hash_bytes"])
  test("B1 unknown extra hash " + key, () => blocks(edit(subject(), s => s.work.modes[0][key] = null), "hash_work_unknown"));
for (const key of metrics) test("B1 work units unknown independently " + key, () => {
  const p = blocks(edit(subject(), s => s.work.modes[0][key] = null), key + "_unknown");
  assert.equal(p.work.units[key].modeled, null);
  assert.equal(p.work.units[key].known, key === "copy_byte_work" ? "98304" : key === "flush_work" ? "6144" : "196608");
});
test("B1 unknown source and cost bounds retain only independently known work", () => {
  const p = blocks(edit(subject(), s => {
    s.source_bounds.steps_per_fragment = s.source_bounds.batch_items = s.source_bounds.flush_steps = null;
    s.work.modes.forEach(m => { m.token_work = m.flush_work = m.copy_byte_work = null; });
  }), "source_bounds_incomplete");
  assert.equal(p.work.units.token_work.known, "196608");
  for (const key of ["token_work", "flush_work", "copy_byte_work"]) assert.equal(p.work.units[key].modeled, null);
  assert.equal(p.work.units.flush_work.known, "0"); assert.equal(p.work.units.copy_byte_work.known, "0");
});
test("B1 unknown helper work does not refund known costs", () => {
  const p = blocks(edit(subject(), s => s.work.prior_helper_commands = null), "helper_work_unknown");
  assert.equal(p.work.known_helper_commands, "24"); assert.equal(p.work.modeled_helper_commands, null);
});
for (const indexes of [[0], [1], [0, 1]]) test("B1 unknown mode helper costs stay unknown " + indexes, () => {
  const p = blocks(edit(subject(), s => indexes.forEach(i => s.work.modes[i].extra_helper_commands = null)), "helper_work_unknown");
  assert.equal(p.work.modeled_helper_commands, null);
  assert.equal(p.work.known_helper_commands, String(12 * (2 - indexes.length)));
});
for (const [name, change, reason] of [
  ["mapping", s => s.work.modes[0].c2a_record_hash_bytes = "8191", "raw_record_hash_mapping"],
  ["prior floor", s => s.work.prior_hash_bytes = "196607", "prior_hash_floor"],
  ["byte floor", s => s.work.modes[0].feed_byte_work = "8191", "byte_work_floor"],
  ["decode floor", s => s.work.modes[0].decode_byte_work = "8191", "byte_work_floor"],
  ["encode floor", s => s.work.modes[0].encode_byte_work = "8191", "byte_work_floor"],
  ["parser floor", s => s.work.modes[0].token_work = "8191", "parser_work_floor"],
  ["flush floor", s => s.work.modes[0].flush_work = "255", "flush_work_floor"],
  ["known hash with unknown prior", s => { s.work.prior_hash_bytes = null; s.work.modes[0].subset_hash_bytes = "2147483648"; }, "work_bound"],
  ["known helpers with unknown prior", s => { s.work.prior_helper_commands = null; s.work.modes[0].extra_helper_commands = "131072"; }, "work_bound"],
]) test("B1 work own refusal " + name, () => refuses(edit(subject(), change), reason));
test("B1 existing hash/helper ceilings are inclusive", () => {
  const s = subject(); s.work.prior_hash_bytes = String(2147483648 - 4800); s.work.prior_helper_commands = "131048";
  const p = plan(s); assert.equal(p.work.modeled_hash_bytes, "2147483648"); assert.equal(p.work.modeled_helper_commands, "131072");
  refuses(edit(s, d => d.work.prior_hash_bytes = String(2147483648 - 4799)), "work_bound");
  refuses(edit(s, d => d.work.prior_helper_commands = "131049"), "work_bound");
});
for (const group of groups) for (const state of ["unavailable", "refused"]) test("B1 acceptance group " + group + " " + state, () => {
  const p = blocks(edit(subject(), s => s.acceptance.find(a => a.group === group).state = state), "acceptance_" + group + "_" + state);
  assert.equal(p.synthetic_acceptance_complete, false);
});
for (const key of ["positive_cases", "negative_cases"]) test("B1 case count unknown " + key, () => {
  const p = blocks(edit(subject(), s => s.acceptance[0][key] = null), "acceptance_pins_incomplete"); assert.equal(p.synthetic_acceptance_complete, false);
});
test("B1 blockers shared by both packages are reported once", () => {
  const p = blocks(edit(subject(), s => s.packages.forEach(p => p.integrity = null)), "integrity_unavailable");
  assert.deepEqual(p.blockers, ["integrity_unavailable"]);
});
test("B1 missing tarball is not obscured by complete acceptance summaries", () => {
  const p = plan(edit(subject(), s => s.packages[0].integrity = null));
  assert.equal(p.synthetic_acceptance_complete, true); assert.equal(p.pins_consistent_supplied, false); assert.equal(p.supplied_plan_complete, false);
});
// A coherent summary whose stack and batch cardinalities and steps exceed the 256-item fragment minimum.
const wide = s => { Object.assign(s.source_bounds, { stack_entries: "1000", stack_bytes: "1000", batch_items: "1000", batch_bytes: "1000", steps_per_fragment: "1000" });
  s.memory[1].retained.nesting_stack = s.memory[1].retained.token_batch = "1000"; s.work.modes.forEach(m => m.token_work = "32000"); };
test("B1 cardinalities above the fragment minimum are accepted when bytes, steps and work cover them", () => {
  const p = plan(edit(subject(), wide)); assert.equal(p.supplied_plan_complete, true); assert.equal(p.work.units.token_work.modeled, "768000");
  assert.equal(plan(sizedSubject(257)).supplied_plan_complete, true);
});
test("B1 shared export maps and entry digests are not package identity aliases", () => {
  for (const k of ["exports_sha256", "entry_sha256"])
    assert.equal(plan(edit(subject(), s => { s.packages[1][k] = s.packages[1]["expected_" + k] = s.packages[0][k]; })).supplied_plan_complete, true);
});
test("B1 package order is not a package identity", () => {
  assert.equal(plan(edit(subject(), s => s.packages.reverse())).supplied_plan_complete, true);
});
test("B1 known token work rounds a partial fragment up when its cost is unknown", () => {
  const p = blocks(edit(subject(), s => { Object.assign(s, sizedSubject(1)); s.work.modes.forEach(m => m.token_work = null); }), "token_work_unknown");
  assert.equal(p.work.units.token_work.known, "6144"); assert.equal(p.work.units.token_work.modeled, null);
});
const nonCanonical = "sha512-" + "A".repeat(85) + "B==", encodingCheck = 'for (const v of [p.integrity, p.expected_integrity]) if', parserSteps = 'const parserSteps = max(cardinalityMinimum(b.batch_items), BigInt(b.steps_per_fragment ?? 0));';
const aliasRule = 'if (a.some(v => b.includes(v))) refuse("package_identity_alias");';
// Each case changes one fact that only its own gate decides; its trial removes or weakens exactly that gate.
const gateCases = [
  ["closure state unavailable", s => s.closure.state = "unavailable", ["block", "closure_unavailable"], ['if (c.state !== "matched_supplied") blockers.push("closure_" + c.state);', '']],
  ["closure state refused", s => s.closure.state = "refused", ["block", "closure_refused"], ['if (c.state !== "matched_supplied") blockers.push("closure_" + c.state);', '']],
  ["closure edges not enumerated", s => s.closure.all_edges_enumerated = false, ["block", "closure_inventory_unavailable"], ['c.all_edges_enumerated !== true)', 'c.all_edges_enumerated === null)']],
  ...[0, 1].flatMap(i => [
    ["non-canonical SRI on both sides " + i, s => { s.packages[i].integrity = s.packages[i].expected_integrity = nonCanonical; }, ["refuse", "integrity_encoding"], [encodingCheck + ' (v !== null && "sha512-"', encodingCheck + ' (false && "sha512-"']],
    ["non-canonical expected SRI with unknown integrity " + i, s => { s.packages[i].integrity = null; s.packages[i].expected_integrity = nonCanonical; }, ["refuse", "integrity_encoding"], [encodingCheck, 'for (const v of [p.integrity]) if']],
    ["non-canonical supplied SRI with unknown expectation " + i, s => { s.packages[i].integrity = nonCanonical; s.packages[i].expected_integrity = null; }, ["refuse", "integrity_encoding"], [encodingCheck, 'for (const v of [p.expected_integrity]) if']],
  ]),
  ["source bounds bind the stream-json entry, not stream-chain's", s => s.source_bounds.source_sha256 = s.packages[1].entry_sha256, ["refuse", "parser_source_binding"],
    ['d.packages.find(p => p.name === "stream-json").entry_sha256', '(d.packages.find(p => p.entry_sha256 === s.source_sha256) ?? d.packages[0]).entry_sha256']],
  ["source bounds bind the stream-json entry by name, not position", s => { s.packages.reverse(); s.source_bounds.source_sha256 = s.packages[0].entry_sha256; }, ["refuse", "parser_source_binding"],
    ['d.packages.find(p => p.name === "stream-json").entry_sha256', 'd.packages[0].entry_sha256']],
  ...[["scalar_bytes", 'scalar_scratch: "scalar_bytes",', ''], ["canonical_lag_bytes", ', canonical_window: "canonical_lag_bytes" };', ' };']].map(([bound, from, to]) =>
    ["memory below the source " + bound, s => s.source_bounds[bound] = "4096", ["refuse", "source_memory_floor"], [from, to]]),
  ["a known side above its floor does not refund an unknown side's overrun", s => {
    s.memory[1].retained.decoder_carry = null; s.memory[1].transient.decoder_carry = "4000000"; s.memory[1].retained.diagnostics = "2375681";
  }, ["refuse", "capacity_bound"], ['const missing = max(0n, floor - declared);', 'const missing = floor - declared;']],
  ["stack bytes below a known stack cardinality", s => { wide(s); s.source_bounds.stack_bytes = "999"; }, ["refuse", "source_geometry"], ['stack_bytes: cardinalityMinimum(s.stack_entries),', 'stack_bytes: 256n,']],
  ["batch bytes below a known batch cardinality", s => { wide(s); s.source_bounds.batch_bytes = "999"; }, ["refuse", "source_geometry"], ['batch_bytes: cardinalityMinimum(s.batch_items), steps', 'batch_bytes: 256n, steps']],
  ["steps below a known batch cardinality", s => { wide(s); s.source_bounds.steps_per_fragment = "999"; }, ["refuse", "source_geometry"], ['steps_per_fragment: cardinalityMinimum(s.batch_items) };', 'steps_per_fragment: 256n };']],
  ["token work below declared steps per fragment", s => { s.source_bounds.steps_per_fragment = "1000"; s.work.modes.forEach(m => m.token_work = "31999"); }, ["refuse", "parser_work_floor"],
    [parserSteps, 'const parserSteps = cardinalityMinimum(b.batch_items);']],
  ["token work below the batch cardinality with unknown steps", s => { wide(s); s.source_bounds.steps_per_fragment = null; s.work.modes.forEach(m => m.token_work = "31999"); }, ["refuse", "parser_work_floor"],
    [parserSteps, 'const parserSteps = BigInt(b.steps_per_fragment ?? 256);']],
  ...[[1, "255"], [257, "511"]].map(([bytes, work]) => ["token work rounds a partial fragment up " + bytes, s => { Object.assign(s, sizedSubject(bytes)); s.work.modes.forEach(m => m.token_work = work); },
    ["refuse", "parser_work_floor"], ['BigInt(m.token_work) < BigInt(Math.ceil(m.record_bytes / 256))', 'BigInt(m.token_work) < BigInt(Math.floor(m.record_bytes / 256))']]),
  ...["integrity", "commit", "files_sha256"].flatMap(k => [
    ["package " + k + " alias", s => { s.packages[1][k] = s.packages[1]["expected_" + k] = s.packages[0][k]; }, ["refuse", "package_identity_alias"], [aliasRule, '']],
    ["expected package " + k + " alias with unknown supplied value", s => { s.packages[1][k] = null; s.packages[1]["expected_" + k] = s.packages[0][k]; }, ["refuse", "package_identity_alias"], [aliasRule, '']],
    ["supplied package " + k + " alias with unknown expectation", s => { s.packages[0]["expected_" + k] = null; s.packages[0][k] = s.packages[1][k]; }, ["refuse", "package_identity_alias"], [aliasRule, '']],
  ]),
];
const gate = (fn, s, [kind, code]) => kind === "refuse" ? assert.throws(() => fn(s), { message: "cc4c2cb1_" + code }) : assert.ok(fn(s).blockers.includes(code), code);
for (const [name, change, expected] of gateCases) test("B1 commit-review gate " + name, () => {
  const s = edit(subject(), change); gate(plan, s, expected);
  if (expected[0] === "block") assert.equal(plan(s).supplied_plan_complete, false);
});
const invalid = [
  ["extra", s => s.backend = "/tmp/record"], ["callback", s => s.packages[0].loader = () => {}],
  ["constructor", s => Object.defineProperty(s, "constructor", { value: "x", enumerable: true })],
  ["accessor", s => Object.defineProperty(s, "oops", { enumerable: true, get() { throw Error("accessor_ran"); } })],
  ["bytes array", s => s.record = new Uint8Array(10)], ["entry", s => s.closure.entry = "stream-json:default"],
  ["dependency", s => s.closure.dependency = "stream-json:stream-chain:*"], ["target", s => s.closure.target = "/tmp/parser.js"],
  ["unknown effect", s => s.initialization.effects.push("io")], ["missing group", s => s.acceptance.pop()],
  ["count zero", s => s.acceptance[0].positive_cases = 0], ["count over", s => s.acceptance[0].positive_cases = 129],
  ["number amount", s => s.work.prior_hash_bytes = 196608], ["negative amount", s => s.memory[0].retained.decoder_carry = "-1"],
  ["zero prefix", s => s.memory[0].retained.decoder_carry = "00"], ["nested closure", s => s.closure.paths = ["./a"]],
  ["overlong integer", s => s.work.prior_hash_bytes = "1".repeat(31)], ["wrong starts", s => s.work.modes[0].starts = 24],
  ["option extra", s => s.profile.options.jsonLines = true],
  ["missing phase", s => s.memory.splice(1, 1)], ["extra phase", s => s.memory.push(structuredClone(s.memory[1]))],
  ["zero files", s => s.packages[0].files = 0], ["zero record", s => s.work.modes.forEach(m => { m.record_bytes = 0; m.c2a_record_hash_bytes = "0"; })],
  ["passes over", s => s.work.modes[0].additional_record_hash_passes = 65], ["license", s => s.packages[0].license = "MIT"],
  ["sri padding", s => { s.packages[0].integrity = s.packages[0].expected_integrity = "sha512-" + "A".repeat(87) + "="; }],
  ["abbreviated commit", s => { s.packages[0].commit = s.packages[0].expected_commit = "abcdef1"; }], ["files over", s => s.packages[0].files = 257],
  ["builtin", s => s.closure.builtin = "node:buffer"], ["schema id", s => s.schema = "unsigned-worker-parser-acceptance-plan-v2"],
  ["missing mode", s => s.work.modes.pop()], ["extra mode", s => s.work.modes.push(structuredClone(s.work.modes[1]))],
  ["unknown phase", s => s.memory[1].phase = "parse"], ["unknown mode", s => s.work.modes[1].mode = "asan"], ["unknown group", s => s.acceptance[11].group = "other"],
  ["negative count zero", s => s.acceptance[0].negative_cases = 0], ["negative count over", s => s.acceptance[0].negative_cases = 129],
  ["uppercase digest", s => { s.packages[0].files_sha256 = s.packages[0].expected_files_sha256 = "A".repeat(64); }],
  ...[["package", s => s.packages[0]], ["memory parts", s => s.memory[1].retained], ["profile", s => s.profile], ["initialization", s => s.initialization],
    ["source bounds", s => s.source_bounds], ["memory phase", s => s.memory[1]], ["mode", s => s.work.modes[0]], ["work", s => s.work], ["acceptance group", s => s.acceptance[0]]]
    .map(([name, at]) => ["unknown key in " + name, s => at(s).unlisted = "4000000"]),
];
for (const [name, fn] of invalid) test("B1 bounded data rejects " + name, () => assert.throws(() => plan(edit(subject(), fn)), { message: "cc4a_invalid_input" }));
for (const bytes of [1, 4194303, 4194304]) test("B1 coherent record summary accepts size " + bytes, () => {
  assert.equal(plan(sizedSubject(bytes)).supplied_plan_complete, true);
});
test("B1 coherent record summary refuses one byte over its ceiling at the schema", () => {
  assert.equal(plan(sizedSubject(4194304)).supplied_plan_complete, true);
  for (const fn of [target.planUnsignedWorkerParserAcceptance, target.describeUnsignedWorkerParserAcceptanceCapacity])
    assert.throws(() => fn(sizedSubject(4194305)), { message: "cc4a_invalid_input" });
});
test("B1 maximum record and case summaries preserve diagnostic ceiling", t => {
  const s = subject();
  for (const m of s.work.modes) { m.record_bytes = 4194304; m.c2a_record_hash_bytes = "4194304"; for (const k of metrics) m[k] = k === "token_work" ? "4194304" : "4194304"; }
  s.work.prior_hash_bytes = "100663296"; for (const a of s.acceptance) a.positive_cases = a.negative_cases = 128;
  const p = plan(s); assert.equal(p.supplied_plan_complete, true); assert.ok(data.byteLength(data.canonical(p)) < 16384);
  s.packages.forEach(p => { for (const k of ["resolved", "integrity", "expected_integrity", "commit", "expected_commit", "files_sha256", "expected_files_sha256", "exports_sha256", "expected_exports_sha256", "entry_sha256", "expected_entry_sha256", "license", "files", "bytes"]) p[k] = null; p.state = "unavailable"; });
  for (const a of s.acceptance) { a.state = "unavailable"; a.positive_cases = a.negative_cases = null; }
  for (const k of bounds) s.source_bounds[k] = null;
  const q = plan(s); assert.ok(q.blockers.length > 20); assert.ok(data.byteLength(data.canonical(q)) < 16384);
  t.diagnostic(JSON.stringify({ complete_plan_bytes: data.byteLength(data.canonical(p)), unavailable_plan_bytes: data.byteLength(data.canonical(q)),
    supplied_standalone_retained_bytes: p.capacity.retained_peak_bytes, supplied_standalone_transient_bytes: p.capacity.transient_peak_bytes }));
});
function compile(text) {
  const tree = ts.createSourceFile("mutant.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  let body = text;
  for (const n of Array.from(tree.statements).reverse()) if (ts.isImportDeclaration(n)) body = body.slice(0, n.getFullStart()) + body.slice(n.end);
  body = body.replace(/\bexport function /g, "function ");
  const env = { z, uint: data.uint, hash: data.digestSchema, count: data.count, parse: data.parse, canonical: data.canonical,
    byteLength: data.byteLength, freeze: data.freeze, flags: data.flags, Buffer };
  return vm.compileFunction(body + "\nreturn planUnsignedWorkerParserAcceptance;", Object.keys(env))(...Object.values(env));
}
const mutants = [
  ['p.version !== selected.version', 'false', s => s.packages[0].version = "3.8.1", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_evaluation_tuple/)],
  ['p.resolved !== expected', 'false', s => s.packages[0].resolved = "https://elsewhere.invalid/p.tgz", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_tarball_origin/)],
  ['i.decoder_outcome !== "installed"', 'false', s => s.initialization.decoder_outcome = "unavailable", (fn, s) => assert.ok(fn(s).blockers.includes("decoder_outcome_unavailable"))],
  ['i.source !== "supplied_original_summary"', 'false', s => s.initialization.source = "synthetic_summary", (fn, s) => assert.ok(fn(s).blockers.includes("original_readiness_unavailable"))],
  ['compare(i.closure_sha256, d.closure.graph_sha256, "initializer_binding", blockers);', '', s => { s.initialization.closure_sha256 = s.initialization.expected_closure_sha256 = other; }, (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_initializer_binding/)],
  ['compare(s.source_sha256, d.packages.find(p => p.name === "stream-json").entry_sha256, "parser_source_binding", blockers);', '', s => s.source_bounds.source_sha256 = other, (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_parser_source_binding/)],
  ['canonical(d.profile.options) !== canonical(options)', 'false', s => s.profile.options.packKeys = true, (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_parser_options/)],
  ['transient > 0n', 'false', s => s.memory[1].transient.token_batch = "1", (fn, s) => assert.ok(fn(s).blockers.includes("transient_overlap_unproven"))],
  ['r > 2375680n', 'false', s => s.memory[0].retained.projection = "2375681", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_capacity_bound/)],
  ['t > 4259840n', 'false', s => s.memory[0].transient.projection = "4259841", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_capacity_bound/)],
  ['hashBytes > 2147483648n', 'false', s => s.work.modes[0].subset_hash_bytes = "2147483648", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_work_bound/)],
  ['helperCommands > 131072n', 'false', s => s.work.modes[0].extra_helper_commands = "131072", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_work_bound/)],
  ['max(BigInt(d.work.prior_hash_bytes ?? 0), raw)', 'BigInt(d.work.prior_hash_bytes ?? 0)', s => s.work.prior_hash_bytes = null, (fn, s) => assert.equal(fn(s).work.known_hash_bytes, "201408")],
  ['s.includes_prior_state !== true', 'false', s => s.source_bounds.includes_prior_state = false, (fn, s) => assert.ok(fn(s).blockers.includes("source_bounds_incomplete"))],
  ['declared < floor', 'false', s => s.memory[1].retained.text_suffix = "255", (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_source_memory_floor/)],
  ...[["carry_bytes", "2"], ["decoded_bytes", "255"], ["stack_bytes", "0"], ["batch_bytes", "0"], ["steps_per_fragment", "0"]].map(([key, value]) => [
    'BigInt(s[k]) < minimum', 'false', s => s.source_bounds[key] = value, (fn, s) => assert.throws(() => fn(s), /cc4c2cb1_source_geometry/),
  ]),
  ['m.record_bytes !== d.work.modes[0].record_bytes', 'false', s => {
    s.work.modes[1].record_bytes = 8191; s.work.modes[1].c2a_record_hash_bytes = "8191"; s.work.prior_hash_bytes = "196596";
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_shared_record_size" })],
  ['helperComplete &&= m.extra_helper_commands !== null;', '', s => s.work.modes[0].extra_helper_commands = null,
    (fn, s) => { const p = fn(s); assert.equal(p.work.modeled_helper_commands, null); assert.ok(p.blockers.includes("helper_work_unknown")); }],
  ['known([...Object.values(p.retained), ...Object.values(p.transient)])', 'known(Object.values(p.transient))', s => s.memory[0].retained.projection = null,
    (fn, s) => { const p = fn(s); assert.equal(p.capacity.retained_peak_bytes, null); assert.ok(p.blockers.includes("memory_unknown")); }],
  ['record_bytes: count(limits.record_bytes, 1)', 'record_bytes: count(limits.record_bytes + 1, 1)', s => Object.assign(s, sizedSubject(4194305)),
    (fn, s) => assert.throws(() => fn(s), { message: "cc4a_invalid_input" })],
  ['else if (rk === null) r += missing;', 'else if (rk === null) r += 0n;', s => {
    s.source_bounds.carry_bytes = "2373633"; s.memory[1].retained.decoder_carry = null; s.memory[1].transient.decoder_carry = "0";
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_capacity_bound" })],
  ['else if (tk === null) t += missing;', 'else if (tk === null) t += 0n;', s => {
    s.source_bounds.carry_bytes = "4259841"; s.memory[1].retained.decoder_carry = "0"; s.memory[1].transient.decoder_carry = null;
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_capacity_bound" })],
  ['unassigned += missing;', 'unassigned += 0n;', s => {
    s.source_bounds.carry_bytes = "6633473"; s.memory[1].retained.decoder_carry = s.memory[1].transient.decoder_carry = null;
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_capacity_bound" })],
  ['max(256n, BigInt(value ?? 0))', 'BigInt(value ?? 0)', s => { s.source_bounds.batch_items = null; s.source_bounds.batch_bytes = "0"; },
    (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_source_geometry" })],
  ['max(cardinalityMinimum(b.batch_items), BigInt(b.steps_per_fragment ?? 0))', 'BigInt(b.steps_per_fragment ?? 0)', s => {
    s.source_bounds.batch_items = s.source_bounds.steps_per_fragment = null; s.work.modes.forEach(m => m.token_work = "0");
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_parser_work_floor" })],
  ['max(minima[bound] ?? 0n, BigInt(s[bound] ?? 0))', 'BigInt(s[bound] ?? 0)', s => {
    s.source_bounds.carry_bytes = null; s.memory[1].retained.decoder_carry = "0";
  }, (fn, s) => assert.throws(() => fn(s), { message: "cc4c2cb1_source_memory_floor" })],
  ['max(BigInt(m[k] ?? 0), minimumWork[k] ?? 0n)', 'BigInt(m[k] ?? 0)', s => s.work.modes[0].token_work = null,
    (fn, s) => { const p = fn(s); assert.equal(p.work.units.token_work.known, "196608"); assert.equal(p.work.units.token_work.modeled, null); }],
  ...gateCases.map(([, change, expected, [from, to]]) => [from, to, change, (fn, s) => gate(fn, s, expected)]),
  ['token_work: BigInt(Math.ceil(m.record_bytes / 256)) * parserSteps, flush_work', 'token_work: BigInt(Math.floor(m.record_bytes / 256)) * parserSteps, flush_work',
    s => { Object.assign(s, sizedSubject(1)); s.work.modes.forEach(m => m.token_work = null); }, (fn, s) => assert.equal(fn(s).work.units.token_work.known, "6144")],
];
for (const [index, [from, to, change, check]] of mutants.entries()) test("B1 behavioral mutation " + index + " " + from, () => {
  assert.equal(source.split(from).length, 2); const original = compile(source), s = edit(subject(), change);
  assert.equal(original(subject()).supplied_plan_complete, true); check(original, s);
  const mutated = compile(source.replace(from, to)); assert.equal(mutated(subject()).supplied_plan_complete, true);
  assert.throws(() => check(mutated, s), { code: "ERR_ASSERTION" });
});
test("B1 independent required sinks precede safe probes", () => {
  const required = [[fs, "readSync"], [fs, "read"], [fs, "readv"], [fs, "readvSync"], [fs, "createReadStream"], [fs, "writeSync"], [net, "Socket"], [net, "Server"], [server, "listen"], [socket, "connect"], [datagram, "bind"], [child, "spawn"], [workers, "MessageChannel"], [crypto, "sign"], [crypto, "createPrivateKey"], [process, "dlopen"], [process, "getBuiltinModule"], [globalThis, "Date"], [Date, "now"], [process.hrtime, "bigint"], [timers, "setTimeout"]];
  required.push([JSON, "parse"], [fs, "open"], [fsp, "open"], ...["lchmod", "lchown"].flatMap(k => [[fs, k], [fs, k + "Sync"], [fsp, k]]).filter(([o, k]) => typeof o[k] === "function"));
  for (const [o, k] of required) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  const before = effects.length; for (const [o, k] of blocked) assert.throws(() => o[k](), /c2cb1_forbidden_effect/);
  assert.equal(effects.length, before + blocked.length); effects.length = before; assert.equal(escapedRead, 0);
});
test("B1 JSON parse denial is registered before any parsing probe", () => {
  assert.ok(blocked.some(([o, k]) => o === JSON && k === "parse"));
  const before = effects.length, { parse: alias } = JSON;
  for (const fn of [alias, JSON["parse"], JSON[`parse`]]) assert.throws(() => fn(), /c2cb1_forbidden_effect/);
  assert.equal(effects.length, before + 3); effects.length = before; assert.equal(escapedParse, 0);
});
test("B1 no denied effect was swallowed", () => assert.deepEqual(effects, []));
