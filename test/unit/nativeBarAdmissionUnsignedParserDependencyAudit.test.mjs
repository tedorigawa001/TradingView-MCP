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
  blocked.push([o, k]); replace(o, k, () => { effects.push(k); throw Error("c2cb2a_forbidden_effect"); });
} }
let escapedRead = 0;
let escapedParse = 0;
replace(JSON, "parse", () => { escapedParse++; throw Error("c2cb2a_parse_sentinel"); });
block(JSON, ["parse"]);
replace(fs, "readSync", () => { escapedRead++; throw Error("c2cb2a_read_sentinel"); });
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
    effects.push(k); throw Error("c2cb2a_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = n => () => { effects.push(n); throw Error("c2cb2a_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)]))); replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(performance, ["now"]); block(process, ["uptime", "cpuUsage", "resourceUsage"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); assert.equal(escapedRead, 0); assert.equal(escapedParse, 0); });

const target = await import("../helpers/unsignedParserDependencyAuditContracts.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const h = "a".repeat(64), other = "b".repeat(64);
const edit = (s, fn) => { const c = structuredClone(s); fn(c); return c; };
function subject() {
  return { schema: "unsigned-parser-dependency-audit-v1", baseline: { source: h, manifest: h, lock: h },
    observed_baseline: { source: h, manifest: h, lock: h }, previous_receipt_sha256: null, previous_stage: "UNAVAILABLE", previous_clock: null,
    profile: { entry: "stream-json/core/parser.js:jsonParser", target: "stream-json/src/core/parser.js", runtime_sha256: null,
      options: { packKeys: false, packStrings: false, packNumbers: false, streamKeys: true, streamStrings: true, streamNumbers: true, jsonStreaming: false } },
    destination: "memory_only", packages: [["stream-json", "3.8.0"], ["stream-chain", "4.4.1"]].map(([name, version]) => ({ name, version, expected: null, observed: null, archive: null, audit_rows: null })),
    url_pages: [["https://registry.npmjs.org/stream-json/3.8.0", "https://registry.npmjs.org/stream-chain/4.4.1"]],
    tools: { transport_sha256: null, metadata_decoder_sha256: null, inspector_sha256: null, bootstrap_review_sha256: null, clock_review_sha256: null, clock_domain: "audit-summary" },
    graph: { sha256: null, expected_sha256: null, closure_sha256: null, options_sha256: null, runtime_sha256: null,
      edges_enumerated: null, unresolved_edges: null, source_mapping: null, mapping_pages: [], initialization_decision: "pending", source_count: null, source_bytes: null },
    diff: { manifest_before: h, lock_before: h, manifest_after: null, lock_after: null, entries: [], unrelated_changes: null },
    placement: { inventory_sha256: null, expected_inventory_sha256: null, paths_sha256: null, expected_paths_sha256: null, files: null, expected_files: null },
    work: { response_pages: [], hash_passes: null, decode_passes: null, hash_byte_ceiling: null, decode_byte_ceiling: null, inspection_steps: null, step_ceiling: null },
    memory: ["receive", "inspect", "report"].map(phase => ({ phase, allocations: { metadata: null, compressed_json: null, compressed_chain: null,
      decoded_json: null, decoded_chain: null, source: null, receipt: null, scratch: null }, joint_floor: null, ceiling: null })), events: [] };
}
const plan = (s = subject()) => target.planUnsignedParserDependencyAudit(s);
const refuses = (s, reason) => assert.throws(() => plan(s), { message: "cc4c2cb2a_" + reason });
test("B2-A empty evidence grants no authority", () => {
  const p = plan();
  assert.equal(p.stage, "UNAVAILABLE");
  assert.equal(p.execution_available, false);
  assert.equal(p.approval_authenticated, false);
  assert.equal(p.actual_package_bytes_verified, false);
  assert.equal(p.native_status, "NOT_RUN");
  assert.equal(p.runtime_producers, "unavailable");
  assert.ok(p.blockers.includes("expected_pins_unavailable"));
  assert.deepEqual(target.describeUnsignedParserDependencyAuditCapacity(subject()), p);
});
test("B2-A pins tuple and detects a manual baseline change", () => {
  refuses(edit(subject(), s => s.packages[0].version = "3.8.1"), "evaluation_tuple");
  refuses(edit(subject(), s => s.observed_baseline.lock = other), "manual_baseline_change");
});
function pinned() {
  const s = subject();
  s.packages.forEach((p, i) => {
    const pins = { integrity: "sha512-" + Buffer.alloc(64, i + 1).toString("base64"), commit: String(i + 1).repeat(40),
      files_sha256: String(i + 1).repeat(64), exports_sha256: h, entry_sha256: h };
    p.expected = { pins, review_sha256: h, previous_receipt_sha256: null };
    p.observed = { pins: structuredClone(pins), source: "synthetic_summary", stage: "metadata", metadata_sha256: h, metadata_bytes: "100" };
  });
  return s;
}
for (const url of ["http://registry.npmjs.org/stream-json/3.8.0", "https://registry.npmjs.org:443/stream-json/3.8.0",
  "https://registry.npmjs.org/stream-json/3.8.0?x=1", "https://user@registry.npmjs.org/stream-json/3.8.0",
  "https://127.0.0.1/p", "https://raw.githubusercontent.com/other/stream-json/" + "1".repeat(40) + "/src/core/parser.js"]) {
  test("B2-A refuses nonliteral destination " + url, () => refuses(edit(subject(), s => s.url_pages[0].push(url)), "url_origin"));
}
test("B2-A source URL needs an earlier expected immutable commit", () => {
  const url = "https://raw.githubusercontent.com/uhop/stream-json/" + "1".repeat(40) + "/src/core/parser.js";
  refuses(edit(subject(), s => s.url_pages[0].push(url)), "source_pin_unavailable");
  assert.equal(plan(edit(pinned(), s => s.url_pages[0].push(url))).stage, "UNAVAILABLE");
});
test("B2-A expected identities are distinct but exports and entry may match", () => {
  plan(pinned());
  for (const key of ["integrity", "commit", "files_sha256"]) {
    refuses(edit(pinned(), s => { s.packages[1].expected.pins[key] = s.packages[1].observed.pins[key] = s.packages[0].expected.pins[key]; }), "package_identity_alias");
  }
  refuses(edit(pinned(), s => s.packages[0].observed.pins.entry_sha256 = other), "pin_mismatch");
});
function audited() {
  const s = pinned();
  for (const p of s.packages) p.archive = {
    compressed_bytes: "100", decoded_bytes: "2048", header_padding_bytes: "2047", logical_members: 1, regular_files: 1, inventory_complete: true,
    member_pages: [[{ path: "package/src/core/parser.js", type: "file", bytes: "1", sha256: h, extended: false, sparse: false, privileged: false }]],
    json: { depth: 1, nodes: 1, keys: 1, scalar_bytes: "1", numeric_bytes: "1", manifest_bytes: "1", license_bytes: "1" }
  };
  return s;
}
for (const [name, change, reason] of [
  ["parent", m => m.path = "package/../a.js", "member_path"], ["absolute", m => m.path = "/package/a.js", "member_root"],
  ["drive", m => m.path = "package/C:/a.js", "member_path"], ["backslash", m => m.path = "package/a\\b", "member_path"],
  ["dot", m => m.path = "package/./a", "member_path"], ["empty segment", m => m.path = "package/a//b", "member_path"],
  ["non ASCII", m => m.path = "package/\u00e9", "member_path"], ["control", m => m.path = "package/a\u0000", "member_path"],
  ...["symlink", "hardlink", "device", "socket", "fifo", "extension"].map(type => [type, m => m.type = type, "member_type"]),
  ...["sparse", "extended", "privileged"].map(key => [key, m => m[key] = true, "member_flags"]),
  ["oversize", m => m.bytes = "4194305", "file_bound"],
]) test("B2-A classifies unsafe member " + name, () => {
  plan(audited()); refuses(edit(audited(), s => change(s.packages[0].archive.member_pages[0][0])), reason);
});
test("B2-A duplicate, case alias and file prefix are refused", () => {
  for (const path of ["package/src/core/parser.js", "package/SRC/core/parser.js", "package/src/core/parser.js/child"]) {
    refuses(edit(audited(), s => s.packages[0].archive.member_pages[0].push({ ...s.packages[0].archive.member_pages[0][0], path })), "member_alias");
  }
});
test("B2-A root marker is unique and payload free", () => {
  const s = audited(), root = { path: "package/", type: "directory", bytes: "0", sha256: null, extended: false, sparse: false, privileged: false };
  s.packages[0].archive.member_pages[0].push(root); s.packages[0].archive.logical_members = 2;
  s.packages[0].archive.header_padding_bytes = "2559"; s.packages[0].archive.decoded_bytes = "2560";
  plan(s);
  refuses(edit(s, x => x.packages[0].archive.member_pages[0].push(root)), "member_alias");
  refuses(edit(s, x => x.packages[0].archive.member_pages[0][1].bytes = "1"), "directory_payload");
});
for (const [key, value, reason] of [["compressed_bytes", "4194305", "compressed_bound"], ["decoded_bytes", "16777217", "decoded_bound"],
  ["header_padding_bytes", "2046", "padding_floor"], ["decoded_bytes", "2047", "decoded_floor"],
  ["logical_members", 1025, "member_count"], ["regular_files", 257, "regular_count"]]) {
  test("B2-A archive bound " + key, () => refuses(edit(audited(), s => s.packages[0].archive[key] = value), reason));
}
for (const [key, value] of [["depth", 33], ["nodes", 16385], ["keys", 257], ["scalar_bytes", "65537"], ["numeric_bytes", "129"],
  ["manifest_bytes", "524289"], ["license_bytes", "524289"]]) {
  test("B2-A metadata bound " + key, () => refuses(edit(audited(), s => s.packages[0].archive.json[key] = value), "metadata_bound"));
}
test("B2-A unknown amounts retain intrinsic decoded, received and work floors", () => {
  const s = audited(); s.packages[0].archive.decoded_bytes = null;
  s.packages[0].archive.header_padding_bytes = null;
  const p = plan(s);
  assert.equal(p.capacity.decoded.known, "4096");
  assert.equal(p.capacity.decoded.modeled, null);
  assert.equal(p.capacity.received.known, "402");
  assert.equal(p.capacity.hash_work.known, "404");
  assert.equal(p.capacity.hash_work.modeled, null);
  assert.ok(BigInt(p.capacity.memory.known_peak) >= 4096n);
  assert.equal(p.capacity.memory.modeled_peak, null);
  assert.equal(p.capacity.refunded, false);
});
test("B2-A overlapping response floors are maxed, separate resources summed", () => {
  const s = audited(); s.graph.source_bytes = "100"; s.graph.source_count = 1;
  s.work.response_pages = [[{ kind: "metadata", bytes: "200", complete: true }, { kind: "archive", bytes: "200", complete: true },
    { kind: "source", bytes: "100", complete: true }]];
  assert.equal(plan(s).capacity.received.known, "500");
});
for (const [name, change, reason] of [
  ["individual metadata", s => s.packages[0].observed.metadata_bytes = "524289", "metadata_body_bound"],
  ["source total", s => s.graph.source_bytes = "33554433", "source_total_bound"],
  ["hash pass zero", s => s.work.hash_passes = "0", "work_passes"],
  ["decode pass zero", s => s.work.decode_passes = "0", "work_passes"],
  ["hash cost", s => { s.work.hash_byte_ceiling = "399"; }, "hash_work_bound"],
  ["decode cost", s => { s.work.decode_byte_ceiling = "4095"; }, "decode_work_bound"],
  ["steps", s => { s.work.inspection_steps = "100"; s.work.step_ceiling = "99"; }, "inspection_work_bound"],
  ["memory floor", s => s.memory[0].allocations.decoded_json = "2047", "memory_floor"],
  ["memory ceiling", s => s.memory[0].ceiling = "0", "memory_bound"],
]) test("B2-A budget refuses " + name, () => { plan(audited()); refuses(edit(audited(), change), reason); });
const stages = ["OBSERVED_UNREVIEWED", "EXPECTED_PINS_FROZEN", "ARCHIVE_BYTES_MATCHED", "STATIC_AUDIT_MATCHED", "DECLARED_ONLY", "MATERIALIZED_STATIC_MATCHED"];
const diffEntries = ["package.dev.stream-chain", "package.dev.stream-json", "lock.root.dev.stream-chain", "lock.root.dev.stream-json",
  "lock.packages.node_modules/stream-chain", "lock.packages.node_modules/stream-json"];
function ready() {
  const s = audited();
  s.profile.runtime_sha256 = h;
  for (const k of Object.keys(s.tools).filter(k => k.endsWith("_sha256"))) s.tools[k] = h;
  Object.assign(s.graph, { sha256: h, expected_sha256: h, closure_sha256: h, options_sha256: data.digest(s.profile.options), runtime_sha256: h,
    edges_enumerated: true, unresolved_edges: 0, source_mapping: true, initialization_decision: "proposed_reviewed", source_count: 2, source_bytes: "2" });
  s.graph.mapping_pages = [s.packages.map(p => ({ package: p.name, path: "src/core/parser.js", package_sha256: h, source_sha256: h,
    url: "https://raw.githubusercontent.com/uhop/" + p.name + "/" + p.expected.pins.commit + "/src/core/parser.js" }))];
  s.url_pages[0].push(...s.graph.mapping_pages[0].map(m => m.url),
    ...s.packages.map(p => "https://registry.npmjs.org/" + p.name + "/-/" + p.name + "-" + p.version + ".tgz"));
  s.packages.forEach(p => p.observed.stage = "static");
  for (const p of s.packages) p.audit_rows = ["manifest_identity", "license", "engines_platform", "exports_imports", "dependency_kinds",
    "scripts_bin_lifecycle", "native_wasm_shrinkwrap", "static_edges", "top_level_effects", "source_work_bounds"].map(kind => ({ kind, state: "matched_supplied", evidence_sha256: h }));
  Object.assign(s.diff, { manifest_after: other, lock_after: other, entries: diffEntries, unrelated_changes: false });
  Object.assign(s.placement, { inventory_sha256: h, expected_inventory_sha256: h, paths_sha256: other, expected_paths_sha256: other, files: 2, expected_files: 2 });
  s.work = { response_pages: [[...s.packages.flatMap(() => [{ kind: "metadata", bytes: "100", complete: true }, { kind: "archive", bytes: "100", complete: true },
    { kind: "source", bytes: "1", complete: true }])]], hash_passes: "1", decode_passes: "1", hash_byte_ceiling: "1000000",
    decode_byte_ceiling: "1000000", inspection_steps: "100", step_ceiling: "1000" };
  for (const m of s.memory) { for (const k of Object.keys(m.allocations)) m.allocations[k] = "131072"; m.joint_floor = "0"; m.ceiling = "2000000"; }
  return s;
}
function evidence(s, stage) {
  if (stage === stages[0]) return data.digest(s.packages.map(p => p.observed));
  if (stage === stages[1]) return data.digest(s.packages.map(p => p.expected));
  if (stage === stages[2]) return data.digest(s.packages.map(p => ({ archive: p.archive, pins: p.observed?.pins ?? null })));
  if (stage === stages[3]) return data.digest({ packages: s.packages, graph: s.graph });
  if (stage === stages[4]) return data.digest(s.diff);
  return data.digest(s.placement);
}
function append(s, stage = stages[s.events.length], outcome = "matched_supplied") {
  const before = plan(s), approval = { source: "supplied_review_summary", plan_sha256: before.plan_sha256, baseline_sha256: data.digest(s.baseline),
    previous_receipt_sha256: before.receipt_sha256, stage, attempt: 1, used: false, decision: "approved_supplied",
    clock_review_sha256: h, clock_domain: "audit-summary", now_ns: String(s.events.length + 1), expires_ns: "100" };
  s.events.push({ ordinal: s.events.length + 1, stage, outcome, plan_sha256: before.plan_sha256, previous_receipt_sha256: before.receipt_sha256,
    approval: stage === stages[0] ? null : approval, evidence_sha256: evidence(s, stage),
    result: stage === stages[4] ? "declaration_only" : stage === stages[5] ? "static_layout_only" : "summary_only" });
  return s;
}
function advanced(count = 6) { const s = ready(); for (let i = 0; i < count; i++) append(s); return s; }
test("B2-A staged supplied evidence never becomes runtime or approval authority", () => {
  const s = advanced(), p = plan(s);
  assert.equal(p.stage, "MATERIALIZED_STATIC_MATCHED");
  assert.equal(p.receipts.length, 6);
  assert.deepEqual(p.blockers, []);
  for (const k of ["actual_package_bytes_verified", "approval_authenticated", "timestamps_verified", "publisher_authenticated", "evidence_saved",
    "dependency_added", "execution_available", "declaration_observed", "layout_observed", "parser_available"]) assert.equal(p[k], false, k);
});
test("B2-A cannot skip a prerequisite or promote observed pins", () => {
  refuses(append(ready(), "ARCHIVE_BYTES_MATCHED"), "stage_order");
  const s = pinned(); append(s);
  assert.equal(plan(s).stage, "OBSERVED_UNREVIEWED");
  const n = subject(); n.tools.clock_review_sha256 = h; n.packages.forEach((p, i) => p.observed = pinned().packages[i].observed); append(n);
  assert.equal(plan(n).stage, "OBSERVED_UNREVIEWED");
  refuses(append(n), "stage_prerequisite");
});
for (const outcome of ["refused", "cancelled", "unknown"]) test("B2-A terminal " + outcome + " is sticky", () => {
  const s = advanced(2); append(s, stages[2], outcome);
  const p = plan(s); assert.equal(p.stage, outcome === "refused" ? "REFUSED" : "STOPPED_UNKNOWN");
  assert.equal(p.last_matched_stage, "EXPECTED_PINS_FROZEN");
  append(s, stages[2]); refuses(s, "terminal_event");
});
for (const [key, value, reason] of [["plan_sha256", other, "approval_binding"], ["baseline_sha256", other, "approval_binding"],
  ["previous_receipt_sha256", other, "approval_binding"], ["stage", "DECLARED_ONLY", "approval_binding"], ["used", true, "approval_replay"],
  ["decision", "pending", "approval_pending"], ["clock_review_sha256", null, "approval_time_unproven"],
  ["clock_domain", "foreign", "approval_time_unproven"],
  ["now_ns", null, "approval_time_unproven"], ["expires_ns", null, "approval_time_unproven"], ["expires_ns", "2", "approval_expired"]]) {
  test("B2-A isolated approval refusal " + key, () => {
    const s = advanced(2); plan(s); s.events[1].approval[key] = value; refuses(s, reason);
  });
}
test("B2-A event provenance, replay, late time and immutable plan changes stop", () => {
  refuses(edit(advanced(2), s => s.events[1].evidence_sha256 = other), "evidence_binding");
  refuses(edit(advanced(2), s => s.events[1].previous_receipt_sha256 = other), "receipt_binding");
  refuses(edit(advanced(2), s => s.events[1].ordinal = 1), "event_ordinal");
  refuses(edit(advanced(3), s => s.events[2].approval.now_ns = "1"), "clock_regression");
  refuses(edit(advanced(2), s => s.tools.inspector_sha256 = other), "plan_binding");
  refuses(edit(advanced(2), s => s.profile.runtime_sha256 = s.graph.runtime_sha256 = other), "plan_binding");
});
test("B2-A response kind omissions cannot produce complete work", () => {
  const s = ready(); s.work.response_pages[0].forEach(r => r.kind = "metadata");
  const p = plan(s); assert.equal(p.capacity.received.modeled, null); assert.ok(p.blockers.includes("received_work_unknown"));
});
for (const i of [0, 1]) test("B2-A both package metadata preimages precede pin freeze " + i, () => {
  const s = ready(); s.packages[i].observed.metadata_sha256 = null;
  append(s); assert.equal(plan(s).stage, "OBSERVED_UNREVIEWED");
  append(s); refuses(s, "stage_prerequisite");
});
for (const i of [0, 1]) test("B2-A archive stage requires each exact tarball URL " + i, () => {
  const s = ready(), p = s.packages[i], url = "https://registry.npmjs.org/" + p.name + "/-/" + p.name + "-" + p.version + ".tgz";
  s.url_pages[0] = s.url_pages[0].filter(u => u !== url);
  advanceInput(s, 2); append(s); refuses(s, "stage_prerequisite");
});
for (const i of [0, 1]) test("B2-A both supplied pin observations must be static before static matching " + i, () => {
  const s = ready(); s.packages[i].observed.stage = "metadata";
  advanceInput(s, 3); assert.equal(plan(s).stage, "ARCHIVE_BYTES_MATCHED");
  append(s); refuses(s, "stage_prerequisite");
});
for (const i of [0, 1]) test("B2-A static predecessor also requires both static provenance labels " + i, () => {
  const s = ready(); s.previous_stage = "STATIC_AUDIT_MATCHED"; s.previous_receipt_sha256 = other;
  s.previous_clock = { clock_domain: "audit-summary", review_sha256: h, now_ns: "1" };
  s.packages.forEach(p => p.expected.previous_receipt_sha256 = other);
  assert.equal(plan(s).stage, "STATIC_AUDIT_MATCHED");
  s.packages[i].observed.stage = "metadata"; refuses(s, "previous_stage_prerequisite");
});
function partialRegular() {
  const s = audited();
  Object.assign(s.packages[0].archive, { regular_files: 256, logical_members: null, member_pages: [],
    inventory_complete: false, decoded_bytes: null, header_padding_bytes: null });
  return s;
}
test("B2-A known regular count survives unavailable member enumeration", () => {
  const p = plan(partialRegular());
  assert.equal(p.capacity.decoded.known, "134144"); assert.equal(p.capacity.decoded.modeled, null);
  assert.equal(p.capacity.response_count.known, 261); assert.equal(p.capacity.response_count.modeled, null);
  assert.equal(p.capacity.inspection_work.known, "518"); assert.equal(p.capacity.inspection_work.modeled, null);
  refuses(edit(partialRegular(), s => s.packages[0].archive.header_padding_bytes = "1024"), "padding_floor");
  refuses(edit(partialRegular(), s => s.packages[0].archive.decoded_bytes = "132095"), "decoded_floor");
  refuses(edit(partialRegular(), s => s.packages[0].archive.logical_members = 255), "member_count");
});
function partialDirectories() {
  const s = partialRegular(); s.packages[0].archive.member_pages = [[0, 1, 2].map(i => ({
    path: "package/d" + i, type: "directory", bytes: "0", sha256: null, extended: false, sparse: false, privileged: false }))];
  return s;
}
test("B2-A known directories and not-yet-enumerated regular files are disjoint floors", () => {
  const p = plan(partialDirectories());
  assert.equal(p.capacity.decoded.known, "135680"); assert.equal(p.capacity.inspection_work.known, "521");
  assert.equal(p.capacity.response_count.known, 261); assert.equal(p.capacity.decoded.modeled, null);
  refuses(edit(partialDirectories(), s => s.packages[0].archive.logical_members = 256), "member_count");
  refuses(edit(partialDirectories(), s => s.packages[0].archive.header_padding_bytes = "132096"), "padding_floor");
});
function partialManyDirectories(count) {
  const s = partialRegular(), members = Array.from({ length: count }, (_, i) => ({
    path: "package/d" + i, type: "directory", bytes: "0", sha256: null, extended: false, sparse: false, privileged: false }));
  s.packages[0].archive.member_pages = Array.from({ length: Math.ceil(count / 256) }, (_, i) => members.slice(i * 256, (i + 1) * 256));
  return s;
}
test("B2-A combined logical-member floor applies the exact member ceiling", () => {
  const p = plan(partialManyDirectories(768));
  assert.equal(p.capacity.decoded.known, "527360"); assert.equal(p.capacity.decoded.modeled, null);
  refuses(partialManyDirectories(769), "member_count");
});
function largeResponses() {
  const s = ready(); s.work.response_pages[0].filter(r => r.kind === "archive").forEach(r => r.bytes = "4194304");
  s.work.hash_byte_ceiling = "10000000"; return s;
}
test("B2-A aggregate compressed response floor reaches every simultaneous memory phase", () => {
  plan(ready()); refuses(largeResponses(), "memory_bound");
  const s = largeResponses(); s.memory.forEach(m => m.ceiling = "9175040");
  const p = plan(s);
  assert.equal(p.capacity.compressed, "8388608"); assert.equal(p.capacity.memory.known_peak, "9175040");
  assert.equal(p.capacity.memory.modeled_peak, "9175040");
  assert.equal(plan(advanceInput(s)).stage, "MATERIALIZED_STATIC_MATCHED");
});
test("B2-A compressed response and supplied reservations overlap without double count", () => {
  const s = largeResponses(); s.memory.forEach(m => { m.ceiling = "9175040"; m.allocations.compressed_json = m.allocations.compressed_chain = "4194304"; });
  assert.equal(plan(s).capacity.memory.known_peak, "9175040");
  s.memory.forEach(m => m.allocations.compressed_json = m.allocations.compressed_chain = null);
  const p = plan(s); assert.equal(p.capacity.memory.known_peak, "9175040"); assert.equal(p.capacity.memory.modeled_peak, null);
});
test("B2-A distinct response kinds sum their known count floors before the cap", () => {
  const s = audited(), rows = Array.from({ length: 528 }, () => ({ kind: "metadata", bytes: "100", complete: true }));
  s.work.response_pages = [rows.slice(0, 176), rows.slice(176, 352), rows.slice(352)];
  refuses(s, "response_count");
});
function missingArchiveCount() {
  const s = ready(), rows = s.work.response_pages[0];
  s.work.response_pages = [[...rows.filter(r => r.kind !== "archive"), { kind: "archive", bytes: "200", complete: true }, { kind: "metadata", bytes: "0", complete: true }]];
  return s;
}
test("B2-A archive count omission is isolated from byte and overall count coverage", () => {
  const p = plan(missingArchiveCount());
  assert.equal(p.capacity.received.known, "402"); assert.equal(p.capacity.received.modeled, null);
  assert.ok(p.blockers.includes("received_work_unknown")); assert.equal(p.capacity.response_count.known, 7);
});
test("B2-A prior advanced state also needs its supplied prerequisites", () => {
  const s = subject(); s.previous_receipt_sha256 = h; s.previous_stage = "STATIC_AUDIT_MATCHED";
  refuses(s, "previous_stage_prerequisite");
});
for (const terminal of ["REFUSED", "STOPPED_UNKNOWN"]) test("B2-A terminal predecessor cannot reset with a new intent", () => {
  const s = ready(); s.previous_stage = terminal; s.previous_receipt_sha256 = other;
  s.packages.forEach(p => p.expected.previous_receipt_sha256 = other);
  assert.equal(plan(s).stage, terminal);
  append(s, stages[0]); refuses(s, "terminal_event");
});
test("B2-A opaque stage can retain unknown static data without claiming inspection", () => {
  const s = ready();
  s.graph = subject().graph; s.graph.source_count = 0; s.graph.source_bytes = "0";
  for (const p of s.packages) { p.observed.stage = "metadata"; Object.assign(p.archive, { decoded_bytes: null, header_padding_bytes: null,
    inventory_complete: false, logical_members: null, regular_files: null, member_pages: [] }); }
  s.tools.inspector_sha256 = null; s.work.decode_passes = s.work.decode_byte_ceiling = s.work.inspection_steps = s.work.step_ceiling = null;
  for (let i = 0; i < 3; i++) append(s);
  const p = plan(s); assert.equal(p.stage, "ARCHIVE_BYTES_MATCHED"); assert.equal(p.capacity.decoded.modeled, null);
  assert.ok(p.blockers.includes("static_audit_incomplete"));
  append(s); refuses(s, "stage_prerequisite");
});
function advanceInput(s, count = 6) { for (let i = 0; i < count; i++) append(s); return s; }
for (const [name, change, count] of [
  ["expected pins", s => s.packages[0].expected.pins.integrity = null, 2],
  ["transport profile", s => s.tools.transport_sha256 = null, 3],
  ["metadata decoder", s => s.tools.metadata_decoder_sha256 = null, 3],
  ["bootstrap", s => s.tools.bootstrap_review_sha256 = null, 3],
  ["inspector", s => s.tools.inspector_sha256 = null, 4],
  ["unresolved edge", s => s.graph.unresolved_edges = 1, 4],
  ["edge inventory", s => s.graph.edges_enumerated = false, 4],
  ["source mapping flag", s => s.graph.source_mapping = false, 4],
  ["missing source preimage", s => s.graph.mapping_pages[0][0].source_sha256 = null, 4],
  ["missing mapping", s => s.graph.mapping_pages[0].pop(), 4],
  ["initializer decision", s => s.graph.initialization_decision = "pending", 4],
  ["closure", s => s.graph.closure_sha256 = null, 4],
  ["graph identity", s => s.graph.sha256 = null, 4],
  ["partial inventory", s => s.packages[0].archive.inventory_complete = false, 4],
  ["inspection work", s => s.work.inspection_steps = null, 4],
  ["declaration", s => s.diff.entries.pop(), 5],
  ["declared after", s => s.diff.lock_after = null, 5],
  ["layout", s => s.placement.paths_sha256 = null, 6],
  ["layout count", s => s.placement.files = s.placement.expected_files = 3, 6],
]) test("B2-A isolated stage prerequisite " + name, () => {
  assert.equal(plan(advanced(count)).stage, stages[count - 1]);
  const s = edit(ready(), change);
  advanceInput(s, count - 1); append(s); refuses(s, "stage_prerequisite");
});
for (const [name, change, reason] of [
  ["source member", s => s.graph.mapping_pages[0][0].path = "else.js", "source_mapping_member"],
  ["source bytes", s => s.graph.mapping_pages[0][0].source_sha256 = other, "source_mapping_digest"],
  ["package bytes", s => s.graph.mapping_pages[0][0].package_sha256 = other, "source_mapping_digest"],
  ["source URL", s => s.graph.mapping_pages[0][0].url += "x", "source_mapping_url"],
  ["graph pin", s => s.graph.sha256 = other, "graph_binding"],
  ["options", s => s.graph.options_sha256 = other, "graph_options"],
  ["runtime", s => s.graph.runtime_sha256 = other, "graph_runtime"],
  ["lock churn", s => s.diff.unrelated_changes = true, "unrelated_lock_diff"],
  ["foreign lock key", s => s.diff.entries[0] = "lock.other", "unrelated_lock_diff"],
  ["layout digest", s => s.placement.paths_sha256 = h, "placement_binding"],
  ["expected prior receipt", s => s.packages[0].expected.previous_receipt_sha256 = other, "expected_review_binding"],
]) test("B2-A refuses inconsistent static summary " + name, () => { plan(ready()); refuses(edit(ready(), change), reason); });
test("B2-A copied data and all nested outputs are immutable without hidden fields", () => {
  const s = ready(), before = data.canonical(s), p = plan(s);
  assert.equal(data.canonical(s), before); s.packages[0].version = "0";
  assert.equal(p.evaluation_tuple[0].version, "3.8.0"); assert.throws(() => p.capacity.received.known = "0", TypeError);
  for (const x of [edit(ready(), c => c.backend = () => {}), edit(ready(), c => c.destination = "/tmp/elsewhere"), edit(ready(), c => c.schema = "other")])
    assert.throws(() => plan(x), { message: "cc4a_invalid_input" });
});
test("B2-A exact file, path and JSON ceilings remain valid summaries", () => {
  const s = audited(), a = s.packages[0].archive, m = a.member_pages[0][0];
  m.bytes = "4194304"; m.path = "package/" + "a".repeat(240);
  a.decoded_bytes = "4195840"; a.header_padding_bytes = "1536";
  Object.assign(a.json, { depth: 32, nodes: 16384, keys: 256, scalar_bytes: "65536", numeric_bytes: "128", manifest_bytes: "524288", license_bytes: "524288" });
  plan(s); refuses(edit(s, x => x.packages[0].archive.member_pages[0][0].path += "a"), "member_path");
  const depth = edit(audited(), x => x.packages[0].archive.member_pages[0][0].path = "package/" + Array(16).fill("a").join("/"));
  plan(depth); refuses(edit(depth, x => x.packages[0].archive.member_pages[0][0].path += "/a"), "member_path");
});
test("B2-A regular and logical member ceilings are independent", () => {
  const s = audited(), a = s.packages[0].archive;
  const members = Array.from({ length: 1024 }, (_, i) => ({ path: "package/" + i, type: i < 256 ? "file" : "directory", bytes: "0",
    sha256: i < 256 ? h : null, extended: false, sparse: false, privileged: false }));
  a.member_pages = Array.from({ length: 4 }, (_, i) => members.slice(i * 256, (i + 1) * 256));
  Object.assign(a, { logical_members: 1024, regular_files: 256, header_padding_bytes: "525312", decoded_bytes: "525312" });
  plan(s);
  refuses(edit(s, x => { const m = x.packages[0].archive.member_pages[1][0]; m.type = "file"; m.sha256 = h; }), "regular_count");
});
test("B2-A joint capacity floor is maxed, not added twice", () => {
  const s = ready(); s.memory.forEach(m => { m.joint_floor = "1048576"; m.ceiling = "1048576"; });
  assert.equal(plan(s).capacity.memory.known_peak, "1048576");
  assert.equal(plan(s).capacity.memory.modeled_peak, "1048576");
  refuses(edit(s, x => x.memory[0].joint_floor = "1048577"), "memory_bound");
});
test("B2-A entry membership cannot be replaced by an unrelated self-consistent mapping", () => {
  const s = ready(), p = s.packages[0];
  p.archive.member_pages[0][0].path = "package/else.js";
  const m = s.graph.mapping_pages[0][0]; m.path = "else.js"; m.url = m.url.replace("src/core/parser.js", "else.js");
  s.url_pages[0] = s.url_pages[0].map(u => u.includes("stream-json/") && u.endsWith("src/core/parser.js") ? m.url : u);
  advanceInput(s, 3); append(s); refuses(s, "stage_prerequisite");
});
test("B2-A aggregate body caps admit the exact ceilings and refuse one more byte", () => {
  const s = audited();
  for (const p of s.packages) Object.assign(p.archive, { compressed_bytes: "4194304", decoded_bytes: "16777216", header_padding_bytes: "16777215" });
  s.graph.source_count = 8; s.graph.source_bytes = "33554432";
  s.work.response_pages = [[...Array.from({ length: 16 }, () => ({ kind: "metadata", bytes: "524288", complete: true })),
    ...Array.from({ length: 2 }, () => ({ kind: "archive", bytes: "4194304", complete: true })),
    ...Array.from({ length: 8 }, () => ({ kind: "source", bytes: "4194304", complete: true }))]];
  const p = plan(s); assert.equal(p.capacity.received.known, "50331648"); assert.equal(p.capacity.remaining_received_bytes, "0");
  assert.equal(p.capacity.decoded.known, "33554432");
  for (const [kind, reason] of [["metadata", "metadata_total_bound"], ["archive", "compressed_total_bound"], ["source", "source_total_bound"]])
    refuses(edit(s, x => x.work.response_pages[0].push({ kind, bytes: "1", complete: true })), reason);
});
test("B2-A response count ceiling is bounded independently of zero-byte bodies", () => {
  const s = subject(), rows = Array.from({ length: 528 }, () => ({ kind: "metadata", bytes: "0", complete: true }));
  s.work.response_pages = [rows.slice(0, 176), rows.slice(176, 352), rows.slice(352)];
  assert.equal(plan(s).capacity.response_count.known, 528);
  assert.throws(() => plan(edit(s, x => x.work.response_pages[2].push(rows[0]))), { message: "cc4a_invalid_input" });
});
for (const kind of ready().packages[0].audit_rows.map(r => r.kind)) for (const missing of ["unavailable", "refused", "digest"]) {
  test("B2-A audit row remains blocking " + kind + " " + missing, () => {
    const s = ready(), r = s.packages[0].audit_rows.find(r => r.kind === kind);
    if (missing === "digest") r.evidence_sha256 = null; else r.state = missing;
    advanceInput(s, 3); append(s); refuses(s, "stage_prerequisite");
  });
}
test("B2-A inspection floors survive unknown work and cannot be declared zero", () => {
  const p = plan(audited()); assert.equal(p.capacity.inspection_work.known, "8"); assert.equal(p.capacity.inspection_work.modeled, null);
  refuses(edit(audited(), s => s.work.inspection_steps = "0"), "inspection_work_floor");
  refuses(edit(audited(), s => s.work.step_ceiling = "7"), "inspection_work_bound");
});
test("B2-A successor binds its supplied predecessor clock without claiming verification", () => {
  const s = ready(); s.previous_stage = "EXPECTED_PINS_FROZEN"; s.previous_receipt_sha256 = other;
  s.packages.forEach(p => p.expected.previous_receipt_sha256 = other);
  refuses(s, "previous_clock_unavailable");
  s.previous_clock = { clock_domain: "audit-summary", review_sha256: h, now_ns: "10" };
  assert.equal(plan(s).stage, "EXPECTED_PINS_FROZEN"); append(s, "ARCHIVE_BYTES_MATCHED");
  refuses(s, "clock_regression");
  s.events[0].approval.now_ns = "11";
  assert.equal(plan(s).stage, "ARCHIVE_BYTES_MATCHED"); assert.equal(plan(s).timestamps_verified, false);
});
test("B2-A malformed SRI is refused by its own encoding gate on both pin sides", () => {
  const s = pinned(), p = s.packages[0], bad = p.expected.pins.integrity.slice(0, -3) + "R==";
  p.expected.pins.integrity = p.observed.pins.integrity = bad;
  refuses(s, "integrity_encoding");
});
const { z } = await import("zod");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../helpers/unsignedParserDependencyAuditContracts.mjs", import.meta.url), "utf8");
function compile(text) {
  const tree = ts.createSourceFile("mutant.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0);
  let body = text;
  for (const n of Array.from(tree.statements).reverse()) if (ts.isImportDeclaration(n)) body = body.slice(0, n.getFullStart()) + body.slice(n.end);
  body = body.replace(/\bexport function /g, "function ");
  const env = { z, uint: data.uint, hash: data.digestSchema, count: data.count, parse: data.parse, canonical: data.canonical,
    digest: data.digest, byteLength: data.byteLength, freeze: data.freeze, flags: data.flags, Buffer, URL };
  return vm.compileFunction(body + "\nreturn planUnsignedParserDependencyAudit;", Object.keys(env))(...Object.values(env));
}
const mutationCases = [
  ["p.version !== selected.version", "false", () => edit(subject(), s => s.packages[0].version = "3.8.1"), "evaluation_tuple"],
  ["a.some(v => b.includes(v))", "false", () => edit(pinned(), s => { s.packages[1].expected.pins.commit = s.packages[1].observed.pins.commit = s.packages[0].expected.pins.commit; }), "package_identity_alias"],
  ['if (a !== null && b !== null && a !== b) refuse("pin_mismatch");', "", () => edit(pinned(), s => s.packages[0].observed.pins.entry_sha256 = other), "pin_mismatch"],
  ["d.observed_baseline[k] !== d.baseline[k]", "false", () => edit(subject(), s => s.observed_baseline.lock = other), "manual_baseline_change"],
  ["canonical(d.profile.options) !== canonical(options)", "false", () => edit(subject(), s => s.profile.options.packKeys = true), "parser_options"],
  ["url.href !== value", "false", () => edit(subject(), s => s.url_pages[0][0] = "https://registry.npmjs.org:443/stream-json/3.8.0"), "url_origin"],
  ['m.extended || m.sparse || m.privileged', "false", () => edit(audited(), s => s.packages[0].archive.member_pages[0][0].sparse = true), "member_flags"],
  ['!["file", "directory"].includes(m.type)', "false", () => edit(audited(), s => s.packages[0].archive.member_pages[0][0].type = "symlink"), "member_type"],
  ['BigInt(a.compressed_bytes ?? 0) > BigInt(caps.compressed_each)', "false", () => edit(audited(), s => s.packages[0].archive.compressed_bytes = "4194305"), "compressed_bound"],
  ['BigInt(a.decoded_bytes ?? 0) > BigInt(caps.decoded_each)', "false", () => edit(audited(), s => s.packages[0].archive.decoded_bytes = "16777217"), "decoded_bound"],
  ['BigInt(m.bytes) > BigInt(caps.file_each)', "false", () => edit(audited(), s => { s.packages[0].archive.member_pages[0][0].bytes = "4194305";
    s.packages[0].archive.header_padding_bytes = "2047"; s.packages[0].archive.decoded_bytes = "4196352"; }), "file_bound"],
  ['BigInt(a.header_padding_bytes) < padding', "false", () => edit(audited(), s => s.packages[0].archive.header_padding_bytes = "2046"), "padding_floor"],
  ['BigInt(a.decoded_bytes) < decoded', "false", () => edit(audited(), s => s.packages[0].archive.decoded_bytes = "2047"), "decoded_floor"],
  ['j.depth > caps.json_depth', "false", () => edit(audited(), s => s.packages[0].archive.json.depth = 33), "metadata_bound"],
  ['known > BigInt(ceiling)', "false", () => edit(audited(), s => s.work.hash_byte_ceiling = "403"), "hash_work_bound"],
  ['BigInt(m.allocations[k]) < floors[k]', "false", () => edit(audited(), s => s.memory[0].allocations.decoded_json = "2047"), "memory_floor"],
  ['known > BigInt(m.ceiling)', "false", () => edit(audited(), s => s.memory[0].ceiling = "1"), "memory_bound"],
  ['if (a.used) refuse("approval_replay");', "", () => edit(advanced(2), s => s.events[1].approval.used = true), "approval_replay"],
  ['BigInt(a.now_ns) >= BigInt(a.expires_ns)', "false", () => edit(advanced(2), s => s.events[1].approval.expires_ns = "2"), "approval_expired"],
  ['e.plan_sha256 !== planHash', "false", () => edit(advanced(1), s => s.events[0].plan_sha256 = other), "plan_binding"],
  ['e.previous_receipt_sha256 !== receipt', "false", () => edit(advanced(1), s => s.events[0].previous_receipt_sha256 = other), "receipt_binding"],
  ['e.evidence_sha256 !== evidence(d, e.stage)', "false", () => edit(advanced(1), s => s.events[0].evidence_sha256 = other), "evidence_binding"],
  ['e.ordinal !== receipts.length + 1', "false", () => edit(advanced(1), s => s.events[0].ordinal = 2), "event_ordinal"],
  ['stages.indexOf(e.stage) !== stages.indexOf(stage) + 1', "false", () => append(ready(), "ARCHIVE_BYTES_MATCHED"), "stage_order"],
  ['a.baseline_sha256 !== digest(d.baseline)', "false", () => edit(advanced(2), s => s.events[1].approval.baseline_sha256 = other), "approval_binding"],
  ['a.stage !== e.stage', "false", () => edit(advanced(2), s => s.events[1].approval.stage = "DECLARED_ONLY"), "approval_binding"],
  ['a.clock_review_sha256 !== d.tools.clock_review_sha256', "false", () => edit(advanced(2), s => s.events[1].approval.clock_review_sha256 = other), "approval_time_unproven"],
  ['BigInt(a.now_ns) < priorTime', "false", () => edit(advanced(3), s => s.events[2].approval.now_ns = "1"), "clock_regression"],
  ...[
    ['g.edges_enumerated === true', s => s.graph.edges_enumerated = false],
    ['g.unresolved_edges === 0', s => s.graph.unresolved_edges = 1],
    ['g.source_mapping === true', s => s.graph.source_mapping = false],
    ['g.initialization_decision === "proposed_reviewed"', s => s.graph.initialization_decision = "pending"],
  ].map(([from, change]) => [from, "true", () => { const s = edit(ready(), change); advanceInput(s, 3); return append(s); }, "stage_prerequisite"]),
  ['rowsReady && entryBound', 'entryBound', () => { const s = ready(); s.packages[0].audit_rows[0].evidence_sha256 = null; advanceInput(s, 3); return append(s); }, "stage_prerequisite"],
  ['BigInt(d.work.inspection_steps) < inspectionFloor', "false", () => edit(audited(), s => s.work.inspection_steps = "0"), "inspection_work_floor"],
  ['const metadataComplete = d.packages.every', 'const metadataComplete = d.packages.some', () => {
    const s = ready(); s.packages[1].observed.metadata_sha256 = null; advanceInput(s, 1); return append(s);
  }, "stage_prerequisite"],
  ['metadataComplete && tarballUrls && frozen', 'metadataComplete && frozen', () => {
    const s = ready(); s.url_pages[0] = s.url_pages[0].filter(u => !u.endsWith("stream-chain-4.4.1.tgz")); advanceInput(s, 2); return append(s);
  }, "stage_prerequisite"],
  ['if (a.logical_members !== null && a.logical_members < memberFloor) refuse("member_count");', '', () => edit(partialRegular(), s => s.packages[0].archive.logical_members = 255), "member_count"],
  ['known - compressedReservation + max(compressedReservation, compressed)', 'known', largeResponses, "memory_bound"],
  ['kinds.reduce((n, k) => n + Math.max(rows.filter(r => r.kind === k).length, responseCounts[k]), 0)', 'Math.max(rows.length, responseFloor)', () => {
    const s = audited(), rows = Array.from({ length: 528 }, () => ({ kind: "metadata", bytes: "100", complete: true }));
    s.work.response_pages = [rows.slice(0, 176), rows.slice(176, 352), rows.slice(352)]; return s;
  }, "response_count"],
  ['memberFloor > caps.members_each', 'false', () => partialManyDirectories(769), "member_count"],
  ['allPins && staticPins && summary.ready', 'allPins && summary.ready', () => {
    const s = ready(); s.packages[1].observed.stage = "metadata"; advanceInput(s, 3); return append(s);
  }, "stage_prerequisite"],
];
for (const [i, [from, to, make, reason]] of mutationCases.entries()) test("B2-A own behavioral gate removal " + i, () => {
  assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, to)), s = make();
  assert.equal(original(ready()).stage, "UNAVAILABLE"); assert.equal(changed(ready()).stage, "UNAVAILABLE");
  assert.throws(() => original(s), { message: "cc4c2cb2a_" + reason });
  assert.doesNotThrow(() => changed(s));
});
test("B2-A regular-count mutation cannot silently erase derived floors", () => {
  const from = "Math.max(regular, a.regular_files ?? 0)"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, "regular"));
  assert.equal(original(ready()).stage, "UNAVAILABLE"); assert.equal(changed(ready()).stage, "UNAVAILABLE");
  const a = original(partialRegular()).capacity, b = changed(partialRegular()).capacity;
  assert.equal(a.decoded.known, "134144"); assert.equal(a.response_count.known, 261); assert.equal(a.inspection_work.known, "518");
  assert.equal(b.decoded.known, "3072"); assert.equal(b.response_count.known, 5); assert.equal(b.inspection_work.known, "6");
});
test("B2-A directory-count mutation cannot absorb disjoint regular-file floors", () => {
  const from = "members.length - regular + knownRegular"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, "Math.max(members.length, knownRegular)"));
  assert.equal(original(ready()).stage, "UNAVAILABLE"); assert.equal(changed(ready()).stage, "UNAVAILABLE");
  assert.equal(original(partialDirectories()).capacity.decoded.known, "135680");
  assert.equal(changed(partialDirectories()).capacity.decoded.known, "134144");
});
test("B2-A per-kind count mutation is isolated from all byte gates", () => {
  const from = "kinds.every(k => rows.filter(r => r.kind === k).length >= (responseCounts[k] ?? 0))"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, "true"));
  assert.equal(original(ready()).capacity.received.modeled, "402"); assert.equal(changed(ready()).capacity.received.modeled, "402");
  const a = original(missingArchiveCount()), b = changed(missingArchiveCount());
  assert.equal(a.capacity.received.modeled, null); assert.ok(a.blockers.includes("received_work_unknown"));
  assert.equal(b.capacity.received.modeled, "402"); assert.equal(b.blockers.includes("received_work_unknown"), false);
});
test("B2-A independent required sinks precede safe probes", () => {
  const required = [[fs, "readSync"], [fs, "read"], [fs, "readv"], [fs, "readvSync"], [fs, "createReadStream"], [fs, "writeSync"], [net, "Socket"], [net, "Server"], [server, "listen"], [socket, "connect"], [datagram, "bind"], [child, "spawn"], [workers, "MessageChannel"], [crypto, "sign"], [crypto, "createPrivateKey"], [process, "dlopen"], [process, "getBuiltinModule"], [globalThis, "Date"], [Date, "now"], [process.hrtime, "bigint"], [timers, "setTimeout"]];
  required.push([JSON, "parse"], [fs, "open"], [fsp, "open"], ...["lchmod", "lchown"].flatMap(k => [[fs, k], [fs, k + "Sync"], [fsp, k]]).filter(([o, k]) => typeof o[k] === "function"));
  for (const [o, k] of required) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  const before = effects.length; for (const [o, k] of blocked) assert.throws(() => o[k](), /c2cb2a_forbidden_effect/);
  assert.equal(effects.length, before + blocked.length); effects.length = before; assert.equal(escapedRead, 0);
});
test("B2-A JSON parse denial is registered before any parsing probe", () => {
  assert.ok(blocked.some(([o, k]) => o === JSON && k === "parse"));
  const before = effects.length, { parse: alias } = JSON;
  for (const fn of [alias, JSON["parse"], JSON[`parse`]]) assert.throws(() => fn(), /c2cb2a_forbidden_effect/);
  assert.equal(effects.length, before + 3); effects.length = before; assert.equal(escapedParse, 0);
});
test("B2-A no denied effect was swallowed", () => assert.deepEqual(effects, []));
