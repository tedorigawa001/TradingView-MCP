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
const { z } = await import("zod");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../helpers/unsignedParserDependencyAuditContracts.mjs", import.meta.url), "utf8");
const h = "a".repeat(64), other = "b".repeat(64), entryDigests = ["c".repeat(64), "d".repeat(64)];
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
  for (const b of ["observed_pins_unavailable", "archive_unavailable"]) assert.ok(p.blockers.includes(b), b);
  assert.equal(new Set(p.blockers).size, p.blockers.length);
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
      files_sha256: String(i + 1).repeat(64), exports_sha256: h, entry_sha256: entryDigests[i] };
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
  plan(edit(pinned(), s => s.packages[1].expected.pins.entry_sha256 = s.packages[1].observed.pins.entry_sha256 = entryDigests[0]));
});
function audited() {
  const s = pinned();
  s.packages.forEach((p, i) => p.archive = {
    compressed_bytes: "100", decoded_bytes: "2048", header_padding_bytes: "2047", logical_members: 1, regular_files: 1, inventory_complete: true,
    member_pages: [[{ path: "package/src/core/parser.js", type: "file", bytes: "1", sha256: entryDigests[i], extended: false, sparse: false, privileged: false }]],
    json: { depth: 1, nodes: 1, keys: 1, scalar_bytes: "1", numeric_bytes: "1", manifest_bytes: "1", license_bytes: "1" }
  });
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
  s.graph.mapping_pages = [s.packages.map((p, i) => ({ package: p.name, path: "src/core/parser.js", package_sha256: entryDigests[i], source_sha256: entryDigests[i],
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
function append(s, stage = stages[s.events.length], outcome = "matched_supplied", planFn = plan) {
  const before = planFn(s), approval = { source: "supplied_review_summary", plan_sha256: before.plan_sha256, baseline_sha256: data.digest(s.baseline),
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
// Commit-review coverage: each negative changes one fact of an otherwise valid summary and expects its own refusal or blocker.
const rawUrl = (s, i, path = "src/core/parser.js", commit = s.packages[i].expected.pins.commit) => `https://raw.githubusercontent.com/uhop/${s.packages[i].name}/${commit}/${path}`;
const urlCases = [
  ["foreign registry host", () => "https://evil.example/stream-json/-/stream-json-3.8.0.tgz"],
  ["registry packument", () => "https://registry.npmjs.org/stream-json"],
  ["nondefault port", () => "https://registry.npmjs.org:8443/stream-json/3.8.0"],
  ["fragment", () => "https://registry.npmjs.org/stream-json/3.8.0#x"],
  ["password", () => "https://:pw@registry.npmjs.org/stream-json/3.8.0"],
  ["foreign API host", () => "https://evil.example/repos/uhop/stream-json/git/commits/" + "c".repeat(40)],
  ["API path without repos", () => "https://api.github.com/uhop/stream-json/git/ref/tags/3.8.0"],
  ["unpinned tag", () => "https://api.github.com/repos/uhop/stream-json/git/ref/tags/latest"],
  ["abbreviated object", () => "https://api.github.com/repos/uhop/stream-json/git/commits/main"],
  ["foreign raw host", s => rawUrl(s, 0).replace("raw.githubusercontent.com", "evil.example")],
  ["raw repos path", s => rawUrl(s, 0).replace("/uhop/", "/repos/uhop/")],
  ["unparseable", () => "https://"],
];
const withUrl = make => edit(pinned(), s => s.url_pages[0].push(make(s)));
for (const [name, make] of urlCases) test("B2-A URL allowlist refuses " + name, () => refuses(withUrl(make), "url_origin"));
test("B2-A URL allowlist accepts each fixed metadata and immutable source form", () => {
  const s = pinned(), c = "c".repeat(40);
  for (const p of s.packages) s.url_pages[0].push(`https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`,
    ...["git/ref/tags/" + p.version, "git/ref/tags/v" + p.version, "git/tags/" + c, "git/commits/" + c].map(x => `https://api.github.com/repos/uhop/${p.name}/${x}`));
  s.url_pages[0].push(rawUrl(s, 0), rawUrl(s, 1, "index.js"));
  assert.equal(plan(s).stage, "UNAVAILABLE");
});
const slashless = () => withUrl(s => "https://raw.githubusercontent.com/uhop/stream-json/" + s.packages[0].expected.pins.commit + "x");
test("B2-A source URLs keep their own package commit and member-path syntax", () => {
  refuses(withUrl(s => rawUrl(s, 0, "src/core/parser.js", "9".repeat(40))), "source_commit");
  refuses(withUrl(s => rawUrl(s, 0, "src/core/parser.js", s.packages[1].expected.pins.commit)), "source_commit");
  refuses(withUrl(s => rawUrl(s, 0, "src/a%20b.js")), "member_path");
  refuses(slashless(), "source_commit");
});
const manyUrls = n => edit(pinned(), s => { const urls = [...s.url_pages[0], ...Array.from({ length: n - 2 }, (_, i) => rawUrl(s, 0, "f" + i + ".js"))];
  s.url_pages = Array.from({ length: Math.ceil(urls.length / 128) }, (_, i) => urls.slice(i * 128, (i + 1) * 128)); });
test("B2-A URL set is capped at the response ceiling and has no duplicates", () => {
  assert.equal(plan(manyUrls(528)).stage, "UNAVAILABLE"); refuses(manyUrls(529), "url_count");
  refuses(edit(subject(), s => s.url_pages[0].push(s.url_pages[0][0])), "url_duplicate");
});
const canonicalSri = n => "sha512-" + Buffer.alloc(64, n).toString("base64"), padded = v => v.slice(0, -3) + "R==";
const expectedOnlySri = () => edit(pinned(), s => { const p = s.packages[0]; p.observed.pins.integrity = null; p.expected.pins.integrity = padded(p.expected.pins.integrity); });
const observedOnlySri = () => edit(pinned(), s => { const p = s.packages[0]; p.expected.pins.integrity = null; p.observed.pins.integrity = padded(p.observed.pins.integrity); });
test("B2-A SRI encoding is checked on either pin side alone", () => {
  refuses(expectedOnlySri(), "integrity_encoding"); refuses(observedOnlySri(), "integrity_encoding");
});
const pinChanges = [["integrity", canonicalSri(9)], ["commit", "9".repeat(40)], ["files_sha256", "9".repeat(64)], ["exports_sha256", "9".repeat(64)]];
const pinMismatch = key => edit(pinned(), s => s.packages[0].observed.pins[key] = pinChanges.find(([k]) => k === key)[1]);
for (const [key] of pinChanges) test("B2-A observed " + key + " must match its expected pin", () => refuses(pinMismatch(key), "pin_mismatch"));
const expectedAlias = key => edit(pinned(), s => { s.packages[1].observed = null; s.packages[1].expected.pins[key] = s.packages[0].expected.pins[key]; });
const observedAlias = key => edit(pinned(), s => { s.packages[1].expected = null; s.packages[1].observed.pins[key] = s.packages[0].observed.pins[key]; });
for (const key of ["integrity", "commit", "files_sha256"]) test("B2-A package identity alias is refused on either side alone " + key, () => {
  refuses(expectedAlias(key), "package_identity_alias"); refuses(observedAlias(key), "package_identity_alias");
});
test("B2-A parser options and package names are fixed", () => {
  refuses(edit(subject(), s => s.profile.options.packKeys = true), "parser_options");
  refuses(edit(subject(), s => s.packages[1].name = "stream-json"), "package_set");
});
test("B2-A proposed diff starts from the bound baseline", () => {
  refuses(edit(subject(), s => s.diff.manifest_before = other), "diff_baseline");
  refuses(edit(subject(), s => s.diff.lock_before = other), "diff_baseline");
});
const fileMember = path => ({ path, type: "file", bytes: "1", sha256: h, extended: false, sparse: false, privileged: false });
const dirMember = path => ({ path, type: "directory", bytes: "0", sha256: null, extended: false, sparse: false, privileged: false });
const withMembers = (list, counts) => edit(audited(), s => { const a = s.packages[0].archive; a.member_pages[0].push(...list); Object.assign(a, counts); });
const twoFiles = { logical_members: 2, regular_files: 2, header_padding_bytes: "3070", decoded_bytes: "3072" };
const oneDirectory = { logical_members: 2, header_padding_bytes: "2559", decoded_bytes: "2560" };
const laterPrefix = () => withMembers([fileMember("package/src")], twoFiles);
const directoryDigest = () => withMembers([{ ...dirMember("package/d"), sha256: h }], oneDirectory);
const rootFile = () => withMembers([{ ...fileMember("package/"), bytes: "0" }], { ...oneDirectory, regular_files: 2 });
const missingFileDigest = () => edit(audited(), s => s.packages[0].archive.member_pages[0][0].sha256 = null);
test("B2-A member classification refuses later prefixes, directory digests, a root file and missing file digests", () => {
  plan(withMembers([fileMember("package/src/other.js")], twoFiles)); plan(withMembers([dirMember("package/d")], oneDirectory));
  refuses(laterPrefix(), "member_alias"); refuses(directoryDigest(), "directory_payload");
  refuses(rootFile(), "member_root"); refuses(missingFileDigest(), "file_digest");
});
const unenumerated = { inventory_complete: false, logical_members: null, regular_files: null, header_padding_bytes: null, decoded_bytes: null };
const manyFiles = n => { const files = Array.from({ length: n }, (_, i) => ({ ...fileMember("package/f" + i), bytes: "0" }));
  return edit(audited(), s => Object.assign(s.packages[0].archive, unenumerated, { member_pages: [files.slice(0, 256), files.slice(256)] })); };
const regularBelowEnumerated = () => edit(audited(), s => Object.assign(s.packages[0].archive, { inventory_complete: false, regular_files: 0 }));
test("B2-A enumerated and declared regular counts cannot contradict an incomplete inventory", () => {
  assert.equal(plan(manyFiles(256)).stage, "UNAVAILABLE"); refuses(manyFiles(257), "regular_count");
  refuses(regularBelowEnumerated(), "regular_count");
});
const hiddenMember = () => edit(audited(), s => Object.assign(s.packages[0].archive, { logical_members: 2, header_padding_bytes: "2559", decoded_bytes: "2560" }));
test("B2-A a complete inventory enumerates every logical and regular member", () => {
  refuses(hiddenMember(), "inventory_count"); plan(edit(hiddenMember(), s => s.packages[0].archive.inventory_complete = false));
  refuses(edit(audited(), s => Object.assign(s.packages[0].archive, { regular_files: 2, header_padding_bytes: "2559", decoded_bytes: "2560" })), "inventory_count");
});
const partialLogical = padding => edit(audited(), s => Object.assign(s.packages[0].archive, { inventory_complete: false, logical_members: 5, header_padding_bytes: padding, decoded_bytes: null }));
const oversizedPackage = () => edit(audited(), s => Object.assign(s.packages[0].archive, unenumerated,
  { member_pages: [Array.from({ length: 5 }, (_, i) => ({ ...fileMember("package/b" + i), bytes: "4194304" }))] }));
test("B2-A unenumerated logical members and per-package decoded bytes keep their floors", () => {
  plan(partialLogical("4095")); refuses(partialLogical("4094"), "padding_floor");
  refuses(oversizedPackage(), "decoded_floor");
  assert.equal(plan(edit(audited(), s => s.packages[0].archive.decoded_bytes = "5000")).capacity.decoded.known, "7048");
});
test("B2-A archive readiness needs all three byte totals and a nonzero compressed body", () => {
  assert.equal(plan(audited()).blockers.includes("archive_inventory_incomplete"), false);
  for (const change of [a => a.compressed_bytes = null, a => a.decoded_bytes = null, a => a.header_padding_bytes = null, a => a.compressed_bytes = "0"])
    assert.ok(plan(edit(audited(), s => change(s.packages[0].archive))).blockers.includes("archive_inventory_incomplete"), String(change));
});
const oversizedBody = (kind, bytes) => edit(audited(), s => s.work.response_pages = [[{ kind, bytes, complete: true }]]);
test("B2-A each response body has its kind's ceiling", () => {
  for (const [kind, bytes] of [["metadata", "524289"], ["archive", "4194305"], ["source", "4194305"]]) refuses(oversizedBody(kind, bytes), "response_body_bound");
  plan(oversizedBody("metadata", "524288")); plan(oversizedBody("source", "4194304"));
});
test("B2-A a declared source count raises the response floor", () => {
  assert.equal(plan(edit(audited(), s => s.graph.source_count = 10)).capacity.response_count.known, 14);
});
const incompleteReceipts = [
  ["metadata body size", s => s.packages[0].observed.metadata_bytes = null],
  ["archive body size", s => s.packages[0].archive.compressed_bytes = null],
  ["source byte total", s => s.graph.source_bytes = null],
  ["response size", s => s.work.response_pages[0].push({ kind: "source", bytes: null, complete: true })],
  ["incomplete response", s => s.work.response_pages[0][1].complete = false],
  ["source count below the inferred floor", s => s.graph.source_count = 1],
  ["metadata rows below the observed body", s => s.packages[0].observed.metadata_bytes = "150"],
  ["archive rows below the package body", s => s.packages[0].archive.compressed_bytes = "150"],
  ["source rows below the declared bytes", s => s.graph.source_bytes = "5"],
];
test("B2-A received work is complete only when every byte and count is covered", () => {
  const p = plan(ready()); assert.equal(p.capacity.received.modeled, "402"); assert.equal(p.capacity.hash_work.modeled, "404");
  for (const [name, change] of incompleteReceipts) {
    const q = plan(edit(ready(), change));
    assert.equal(q.capacity.received.modeled, null, name); assert.equal(q.capacity.hash_work.modeled, null, name);
    assert.equal(q.capacity.memory.modeled_peak, null, name); assert.ok(q.blockers.includes("received_work_unknown"), name);
  }
});
const noSources = count => edit(ready(), s => { for (const p of s.packages) Object.assign(p.archive, unenumerated, { member_pages: [] });
  Object.assign(s.graph, { mapping_pages: [], source_count: count, source_bytes: "0" }); s.work.response_pages[0] = s.work.response_pages[0].filter(r => r.kind !== "source"); });
test("B2-A a source count is required even when no source is known", () => {
  assert.equal(plan(noSources(0)).capacity.received.modeled, "400");
  const p = plan(noSources(null)); assert.equal(p.capacity.received.modeled, null); assert.ok(p.blockers.includes("received_work_unknown"));
});
test("B2-A hash work multiplies its passes and decode work needs a complete inventory", () => {
  assert.equal(plan(edit(ready(), s => s.work.hash_passes = "2")).capacity.hash_work.known, "808");
  const q = plan(edit(ready(), s => s.packages[0].archive.inventory_complete = false));
  assert.equal(q.capacity.decode_work.modeled, null); assert.equal(q.capacity.memory.modeled_peak, null); assert.ok(q.blockers.includes("decode_work_unknown"));
});
const fewSteps = () => edit(ready(), s => s.work.inspection_steps = "9");
test("B2-A inspection floor includes every source mapping", () => {
  refuses(fewSteps(), "inspection_work_floor");
  assert.equal(plan(edit(ready(), s => s.work.inspection_steps = "10")).capacity.inspection_work.known, "10");
});
const longPath = (prefix, k) => (prefix + k).padEnd(239, "x");
const bigReceipt = (directories = 768) => { const s = pinned();
  for (const p of s.packages) { const all = [...Array.from({ length: 256 }, (_, k) => ({ ...fileMember("package/" + longPath("f", k)), bytes: "0" })),
    ...Array.from({ length: directories }, (_, k) => dirMember("package/" + longPath("d", k)))];
    p.archive = { ...unenumerated, compressed_bytes: "100", logical_members: all.length, regular_files: 256, json: audited().packages[0].archive.json,
      member_pages: Array.from({ length: Math.ceil(all.length / 256) }, (_, pg) => all.slice(pg * 256, (pg + 1) * 256)) }; }
  const maps = s.packages.flatMap((p, i) => Array.from({ length: 256 }, (_, k) => ({ package: p.name, path: longPath("f", k), url: rawUrl(s, i, longPath("f", k)), package_sha256: h, source_sha256: h })));
  s.graph.mapping_pages = Array.from({ length: 4 }, (_, pg) => maps.slice(pg * 128, (pg + 1) * 128));
  const urls = [...s.url_pages[0], ...maps.map(m => m.url)]; s.url_pages = Array.from({ length: 5 }, (_, pg) => urls.slice(pg * 128, (pg + 1) * 128));
  return s; };
test("B2-A the bounded receipt cannot exceed one MiB", () => {
  assert.ok(data.byteLength(data.canonical(bigReceipt())) > 1048576); refuses(bigReceipt(), "receipt_bound");
  assert.equal(plan(bigReceipt(0)).stage, "UNAVAILABLE");
});
const floorCases = [["metadata", "199"], ["source", "1"], ["receipt", "1"], ["compressed_json", "99"], ["compressed_chain", "299"], ["decoded_chain", "2999"]];
const floorBase = () => edit(ready(), s => { s.packages[1].archive.decoded_bytes = "3000"; s.packages[1].archive.compressed_bytes = "300"; });
const belowFloor = key => { const s = floorBase(); s.memory[1].allocations[key] = floorCases.find(([k]) => k === key)[1]; return s; };
test("B2-A every simultaneous resource keeps its own memory floor", () => {
  plan(floorBase());
  for (const [key] of floorCases) refuses(belowFloor(key), "memory_floor");
});
test("B2-A exact floors and ceilings and unknown expectations are accepted", () => {
  for (const s of [edit(ready(), x => x.memory[0].allocations.metadata = "200"), edit(ready(), x => x.work.hash_byte_ceiling = "404"),
    edit(audited(), x => x.work.step_ceiling = "8"), edit(audited(), x => x.packages[0].observed.metadata_bytes = "524288"),
    edit(ready(), x => x.placement.expected_paths_sha256 = null), edit(predecessor("OBSERVED_UNREVIEWED"), x => x.previous_clock = null)]) plan(s);
});
const duplicatePhase = () => edit(audited(), s => s.memory[2].phase = "receive");
test("B2-A memory is modeled only with every phase reservation, joint floor and ceiling", () => {
  assert.equal(plan(ready()).capacity.memory.modeled_peak, "1048576");
  for (const change of [s => s.memory[1].joint_floor = null, s => s.memory[2].ceiling = null]) {
    const p = plan(edit(ready(), change)); assert.equal(p.capacity.memory.modeled_peak, null); assert.ok(p.blockers.includes("memory_unknown"));
  }
  refuses(duplicatePhase(), "memory_phases");
});
const duplicateAuditRow = () => edit(ready(), s => s.packages[0].audit_rows[1].kind = "manifest_identity");
const duplicateMapping = () => edit(ready(), s => s.graph.mapping_pages[0].push(structuredClone(s.graph.mapping_pages[0][0])));
const duplicateDiffEntry = () => edit(ready(), s => s.diff.entries[0] = s.diff.entries[1]);
test("B2-A static summaries refuse duplicate audit rows, source mappings and declaration entries", () => {
  refuses(duplicateAuditRow(), "audit_rows"); refuses(duplicateMapping(), "source_mapping_duplicate"); refuses(duplicateDiffEntry(), "diff_entries");
});
function withFile(s, i, path) {
  const a = s.packages[i].archive; a.member_pages[0].push({ ...a.member_pages[0][0], path: "package/" + path });
  a.logical_members++; a.regular_files++; a.header_padding_bytes = String(BigInt(a.header_padding_bytes) + 1023n); a.decoded_bytes = String(BigInt(a.decoded_bytes) + 1024n);
  return s;
}
const distinctPaths = () => { const s = ready(), m = s.graph.mapping_pages[0][1], old = m.url;
  s.packages[1].archive.member_pages[0][0].path = "package/src/chain.js"; m.path = "src/chain.js"; m.url = rawUrl(s, 1, "src/chain.js");
  s.url_pages[0] = s.url_pages[0].map(u => u === old ? m.url : u); return s; };
const foreignOwner = () => { const s = withFile(distinctPaths(), 0, "only.js"), url = rawUrl(s, 1, "only.js"); s.url_pages[0].push(url);
  s.graph.mapping_pages[0].push({ package: "stream-chain", path: "only.js", url, package_sha256: entryDigests[0], source_sha256: entryDigests[0] }); return s; };
const borrowedUrl = () => edit(ready(), s => s.graph.mapping_pages[0][0].url = s.graph.mapping_pages[0][1].url);
const unlistedUrl = () => edit(ready(), s => s.url_pages[0] = s.url_pages[0].filter(u => u !== s.graph.mapping_pages[0][1].url));
test("B2-A a source mapping belongs to its own package and its exact approved URL", () => {
  assert.equal(plan(advanceInput(distinctPaths())).stage, "MATERIALIZED_STATIC_MATCHED"); plan(withFile(distinctPaths(), 0, "only.js"));
  refuses(foreignOwner(), "source_mapping_member"); refuses(borrowedUrl(), "source_mapping_url"); refuses(unlistedUrl(), "source_mapping_url");
});
const inventoryMismatch = () => edit(ready(), s => s.placement.inventory_sha256 = other);
const filesMismatch = () => edit(ready(), s => s.placement.files = 3);
test("B2-A placement inventory and file count bind their expectations", () => {
  refuses(inventoryMismatch(), "placement_binding"); refuses(filesMismatch(), "placement_binding");
});
const borrowedEntry = () => { const s = ready(), [m0, m1] = s.graph.mapping_pages[0];
  s.packages[0].archive.member_pages[0][0].path = "package/else.js"; m0.path = "else.js"; m0.url = m0.url.replace("src/core/parser.js", "else.js");
  s.url_pages[0] = s.url_pages[0].map(u => u.includes("stream-json/") && u.endsWith("src/core/parser.js") ? m0.url : u);
  s.packages[1].archive.member_pages[0][0].sha256 = m1.package_sha256 = m1.source_sha256 = entryDigests[0];
  advanceInput(s, 3); return append(s); };
test("B2-A the parser entry must be stream-json's own published file", () => refuses(borrowedEntry(), "stage_prerequisite"));
const reviewStages = [
  ["metadata digests", s => s.packages.forEach(p => p.observed.metadata_sha256 = null), 1],
  ["metadata sizes", s => s.packages.forEach(p => p.observed.metadata_bytes = null), 1],
  ["one metadata size", s => s.packages[1].observed.metadata_bytes = null, 2],
  ["expected commit", s => { s.graph.mapping_pages = []; s.url_pages[0] = s.url_pages[0].filter(u => !u.startsWith("https://raw.")); s.packages[0].expected.pins.commit = null; }, 2],
  ["observed baseline", s => s.observed_baseline.source = null, 3],
  ["incomplete response", s => s.work.response_pages[0][1].complete = false, 3],
  ["hash passes", s => s.work.hash_passes = null, 3],
  ["hash ceiling", s => s.work.hash_byte_ceiling = null, 3],
  ["receive reservation", s => s.memory[0].allocations.scratch = null, 3],
  ["observed integrity", s => s.packages[0].observed.pins.integrity = null, 3],
  ["empty compressed archive", s => s.packages[0].archive.compressed_bytes = "0", 3],
  ["decode passes", s => s.work.decode_passes = null, 4],
  ["decode ceiling", s => s.work.decode_byte_ceiling = null, 4],
  ["step ceiling", s => s.work.step_ceiling = null, 4],
  ["memory joint floor", s => s.memory[1].joint_floor = null, 4],
  ["memory ceiling", s => s.memory[2].ceiling = null, 4],
  ["expected exports pin", s => s.packages[0].expected.pins.exports_sha256 = null, 4],
  ["observed exports pin", s => s.packages[0].observed.pins.exports_sha256 = null, 4],
  ["audit rows", s => s.packages[1].audit_rows = null, 4],
  ["package mapping digest", s => s.graph.mapping_pages[0][0].package_sha256 = null, 4],
  ["extra source count", s => { s.graph.source_count = 3; s.work.response_pages[0].push({ kind: "source", bytes: "1", complete: true }); }, 4],
  ["source bytes below payload", s => s.graph.source_bytes = "1", 4],
  ["entry digest", s => { s.packages[0].archive.member_pages[0][0].sha256 = other; s.graph.mapping_pages[0][0].package_sha256 = s.graph.mapping_pages[0][0].source_sha256 = other; }, 4],
  ["expected graph", s => s.graph.expected_sha256 = null, 4],
  ["graph options", s => s.graph.options_sha256 = null, 4],
  ["graph runtime", s => s.graph.runtime_sha256 = null, 4],
  ["profile runtime", s => s.profile.runtime_sha256 = null, 4],
  ["unrelated changes unknown", s => s.diff.unrelated_changes = null, 5],
  ["manifest after", s => s.diff.manifest_after = null, 5],
];
const reviewStage = name => { const [, change, count] = reviewStages.find(([n]) => n === name), s = edit(ready(), change); advanceInput(s, count - 1); return append(s); };
for (const [name, , count] of reviewStages) test("B2-A commit-review stage prerequisite " + name, () => {
  assert.equal(plan(advanced(count)).stage, stages[count - 1]); refuses(reviewStage(name), "stage_prerequisite");
});
function predecessor(stage, s = ready()) {
  s.previous_stage = stage; s.previous_receipt_sha256 = other; s.previous_clock = { clock_domain: "audit-summary", review_sha256: h, now_ns: "1" };
  s.packages.forEach(p => p.expected.previous_receipt_sha256 = other); return s;
}
const staticWithoutTransport = () => edit(predecessor("STATIC_AUDIT_MATCHED"), s => s.tools.transport_sha256 = null);
const placedWithoutDeclaration = () => edit(predecessor("MATERIALIZED_STATIC_MATCHED"), s => s.diff.entries.pop());
const foreignClockReview = () => edit(predecessor("EXPECTED_PINS_FROZEN"), s => s.previous_clock.review_sha256 = other);
const receiptlessPredecessor = () => edit(subject(), s => s.previous_stage = "REFUSED");
const archiveWithoutMetadata = () => edit(predecessor("ARCHIVE_BYTES_MATCHED"), s => s.packages[1].observed.metadata_sha256 = null);
const archiveWithoutCommit = () => edit(predecessor("ARCHIVE_BYTES_MATCHED"), s => { s.graph.mapping_pages = [];
  s.url_pages[0] = s.url_pages[0].filter(u => !u.startsWith("https://raw.")); s.packages[0].expected.pins.commit = null; });
test("B2-A an imported predecessor keeps every earlier prerequisite and its clock review", () => {
  assert.equal(plan(predecessor("MATERIALIZED_STATIC_MATCHED")).stage, "MATERIALIZED_STATIC_MATCHED");
  refuses(staticWithoutTransport(), "previous_stage_prerequisite"); refuses(placedWithoutDeclaration(), "previous_stage_prerequisite");
  refuses(foreignClockReview(), "previous_clock_unavailable"); refuses(receiptlessPredecessor(), "previous_receipt_unavailable");
  assert.equal(plan(predecessor("ARCHIVE_BYTES_MATCHED")).stage, "ARCHIVE_BYTES_MATCHED");
  refuses(archiveWithoutMetadata(), "previous_stage_prerequisite"); refuses(archiveWithoutCommit(), "previous_stage_prerequisite");
});
const wrongResult = () => edit(advanced(1), s => s.events[0].result = "declaration_only");
const observationApproval = () => edit(advanced(1), s => s.events[0].approval = structuredClone(advanced(2).events[1].approval));
const nullClockReview = () => { const s = ready(); s.tools.clock_review_sha256 = null; advanceInput(s, 2); s.events[1].approval.clock_review_sha256 = null; return s; };
test("B2-A events carry only their stage's result, approval shape and clock review", () => {
  refuses(wrongResult(), "result_scope"); refuses(observationApproval(), "observation_approval");
  refuses(edit(advanced(2), s => s.events[1].approval = null), "approval_unavailable"); refuses(nullClockReview(), "approval_time_unproven");
  refuses(edit(advanced(2), s => s.events[1].approval.clock_review_sha256 = other), "approval_time_unproven");
});
test("B2-A each receipt binds its whole event", () => {
  const [a, b] = ["cancelled", "unknown"].map(outcome => { const s = advanced(2); append(s, stages[2], outcome); return plan(s); });
  assert.equal(a.stage, b.stage); assert.notEqual(a.receipt_sha256, b.receipt_sha256);
});
const planChanges = [
  ["URL set", ' url_pages: d.url_pages,', '', s => s.url_pages[0].push("https://api.github.com/repos/uhop/stream-json/git/commits/" + "c".repeat(40))],
  ["work budget", ' work: d.work,', '', s => s.work.step_ceiling = "1001"],
  ["memory budget", ' memory: d.memory,', '', s => s.memory.forEach(m => m.ceiling = "3000000")],
  ["expected graph", 'expected_graph_sha256: d.graph.expected_sha256, ', '', s => s.graph.expected_sha256 = s.graph.sha256 = other],
  ["proposed diff", ' diff: d.diff,', '', s => s.diff.manifest_after = h],
  ["expected layout", 'paths_sha256: d.placement.expected_paths_sha256, ', '', s => s.placement.expected_paths_sha256 = s.placement.paths_sha256 = h],
  ["expected inventory", 'inventory_sha256: d.placement.expected_inventory_sha256, ', '', s => s.placement.expected_inventory_sha256 = s.placement.inventory_sha256 = other],
  ["expected file count", ', files: d.placement.expected_files }', ' }', s => s.placement.expected_files = s.placement.files = 5],
  ["baseline after an observation", 'const planValue = { baseline: d.baseline, ', 'const planValue = { ', s => s.baseline.source = s.observed_baseline.source = other, 1],
];
for (const [name, , , change, count = 3] of planChanges) test("B2-A approvals bind the " + name, () => refuses(edit(advanced(count), change), "plan_binding"));
const predecessorClock = (planFn = plan) => { const s = predecessor("EXPECTED_PINS_FROZEN"); s.previous_clock.now_ns = "10";
  append(s, "ARCHIVE_BYTES_MATCHED", "matched_supplied", planFn); s.events[0].approval.now_ns = "11"; return s; };
const declaredAfterReview = (planFn = plan) => { const s = predecessor("STATIC_AUDIT_MATCHED"); append(s, "DECLARED_ONLY", "matched_supplied", planFn);
  s.packages[0].expected.review_sha256 = other; return s; };
test("B2-A approvals bind expected pins even after their own stage", () => {
  assert.equal(plan(edit(declaredAfterReview(), s => s.packages[0].expected.review_sha256 = h)).stage, "DECLARED_ONLY"); refuses(declaredAfterReview(), "plan_binding");
});
test("B2-A approvals bind the imported predecessor clock", () => {
  assert.equal(plan(predecessorClock()).stage, "ARCHIVE_BYTES_MATCHED"); refuses(edit(predecessorClock(), s => s.previous_clock.now_ns = "9"), "plan_binding");
});
const valid = advanced(), approved = valid.events[1].approval, oneRow = valid.packages[0].audit_rows[0];
const invalidCases = [
  ["root key", s => s.extra = 1], ["baseline key", s => s.baseline.extra = h], ["observed baseline key", s => s.observed_baseline.extra = h],
  ["previous clock key", s => s.previous_clock = { clock_domain: "audit-summary", review_sha256: h, now_ns: "1", extra: 1 }],
  ["previous clock domain", s => s.previous_clock = { clock_domain: "other", review_sha256: h, now_ns: "1" }],
  ["profile key", s => s.profile.extra = 1], ["options key", s => s.profile.options.extra = true],
  ["profile entry", s => s.profile.entry = "stream-json/core/parser.js:other"], ["profile target", s => s.profile.target = "stream-json/src/other.js"],
  ["package key", s => s.packages[0].extra = 1], ["one package", s => s.packages.pop()], ["three packages", s => s.packages.push(structuredClone(s.packages[0]))],
  ["package name", s => s.packages[0].name = "other"], ["long version", s => s.packages[0].version = "3.8.0-01234567890"],
  ["expected key", s => s.packages[0].expected.extra = 1], ["pins key", s => s.packages[0].expected.pins.extra = 1],
  ["observed key", s => s.packages[0].observed.extra = 1], ["observed source", s => s.packages[0].observed.source = "real_observation"],
  ["observed stage", s => s.packages[0].observed.stage = "archive"], ["abbreviated commit", s => s.packages[0].observed.pins.commit = "1234567"],
  ["misplaced SRI padding", s => { const v = s.packages[0].observed.pins.integrity; s.packages[0].observed.pins.integrity = v.slice(0, 10) + "=" + v.slice(11); }],
  ["uppercase digest", s => s.packages[0].observed.pins.files_sha256 = "A".repeat(64)],
  ["archive key", s => s.packages[0].archive.extra = 1], ["metadata geometry key", s => s.packages[0].archive.json.extra = 1],
  ["member key", s => s.packages[0].archive.member_pages[0][0].extra = 1], ["member type", s => s.packages[0].archive.member_pages[0][0].type = "unknown"],
  ["long member path", s => s.packages[0].archive.member_pages[0][0].path = "package/" + "a".repeat(505)],
  ["logical members", s => s.packages[0].archive.logical_members = 2049], ["regular files", s => s.packages[0].archive.regular_files = 513],
  ["member page (also the shared 256-entry array bound)", s => s.packages[0].archive.member_pages[0] = Array(257).fill(s.packages[0].archive.member_pages[0][0])],
  ["member pages", s => s.packages[0].archive.member_pages.push([], [], [], [])],
  ["metadata depth", s => s.packages[0].archive.json.depth = 65], ["metadata nodes", s => s.packages[0].archive.json.nodes = 32769],
  ["metadata keys", s => s.packages[0].archive.json.keys = 513],
  ["audit row key", s => s.packages[0].audit_rows[0].extra = 1], ["audit row kind", s => s.packages[0].audit_rows[0].kind = "other"],
  ["audit row state", s => s.packages[0].audit_rows[0].state = "matched"], ["nine audit rows", s => s.packages[0].audit_rows.pop()],
  ["eleven audit rows", s => s.packages[0].audit_rows.push(structuredClone(oneRow))],
  ["long URL", s => s.url_pages[0].push("https://registry.npmjs.org/" + "a".repeat(486))], ["URL pages", s => s.url_pages.push([], [], [], [], [])],
  ["URL page", s => s.url_pages.push(Array(129).fill(s.url_pages[0][0]))],
  ["tools key", s => s.tools.extra = 1], ["tools clock domain", s => s.tools.clock_domain = "other"],
  ["graph key", s => s.graph.extra = 1], ["negative unresolved edges", s => s.graph.unresolved_edges = -1], ["unresolved edges", s => s.graph.unresolved_edges = 1025],
  ["initialization decision", s => s.graph.initialization_decision = "approved"], ["source count", s => s.graph.source_count = 513],
  ["mapping key", s => s.graph.mapping_pages[0][0].extra = 1], ["mapping package", s => s.graph.mapping_pages[0][0].package = "other"],
  ["long mapping path", s => s.graph.mapping_pages[0][0].path = "a".repeat(257)],
  ["mapping page", s => s.graph.mapping_pages[0] = Array(129).fill(s.graph.mapping_pages[0][0])], ["mapping pages", s => s.graph.mapping_pages.push([], [], [], [])],
  ["diff key", s => s.diff.extra = 1], ["diff entries", s => s.diff.entries = Array(17).fill("lock.other")], ["long diff entry", s => s.diff.entries[0] = "a".repeat(129)],
  ["placement key", s => s.placement.extra = 1], ["placement files", s => s.placement.files = 513], ["negative placement files", s => s.placement.files = -1],
  ["work key", s => s.work.extra = 1], ["response key", s => s.work.response_pages[0][0].extra = 1], ["response kind", s => s.work.response_pages[0][0].kind = "other"],
  ["response page", s => s.work.response_pages[0] = Array(177).fill(s.work.response_pages[0][0])], ["response pages", s => s.work.response_pages.push([], [], [])],
  ["memory phase key", s => s.memory[0].extra = 1], ["allocation key", s => s.memory[0].allocations.extra = "0"], ["memory phase", s => s.memory[0].phase = "other"],
  ["two memory phases", s => s.memory.pop()], ["four memory phases", s => s.memory.push(structuredClone(s.memory[0]))],
  ["event key", s => s.events[0].extra = 1], ["event ordinal zero", s => s.events[0].ordinal = 0], ["event ordinal", s => s.events[0].ordinal = 17],
  ["event stage", s => s.events[0].stage = "UNAVAILABLE"], ["event outcome", s => s.events[0].outcome = "other"], ["event result", s => s.events[0].result = "other"],
  ["seventeen events", s => s.events.push(...Array(11).fill(s.events[0]))], ["previous stage", s => s.previous_stage = "OTHER"],
  ["long mapping URL", s => s.graph.mapping_pages[0][0].url = "u".repeat(513)], ["negative depth", s => s.packages[0].archive.json.depth = -1],
  ["negative nodes", s => s.packages[0].archive.json.nodes = -1], ["negative keys", s => s.packages[0].archive.json.keys = -1],
  ["negative logical members", s => s.packages[0].archive.logical_members = -1], ["negative regular files", s => s.packages[0].archive.regular_files = -1],
  ["negative source count", s => s.graph.source_count = -1], ["negative expected files", s => s.placement.expected_files = -1],
  ["leading-zero amount", s => s.packages[0].observed.metadata_bytes = "0100"], ["leading-zero member bytes", s => s.packages[0].archive.member_pages[0][0].bytes = "01"],
  ...["scalar_bytes", "numeric_bytes", "manifest_bytes", "license_bytes"].map(k => ["leading-zero " + k, s => s.packages[0].archive.json[k] = "01"]),
  ["leading-zero previous clock", s => s.previous_clock = { clock_domain: "audit-summary", review_sha256: h, now_ns: "01" }], ["baseline digest", s => s.baseline.source = "x"],
  ["expected files", s => s.placement.expected_files = 513], ["long approval clock domain", s => s.events[1].approval.clock_domain = "a".repeat(49)],
  ["31-digit amount", s => s.packages[0].observed.metadata_bytes = "1" + "0".repeat(30)],
  ["approval key", s => s.events[1].approval.extra = 1], ["approval source", s => s.events[1].approval.source = "other"],
  ["approval attempt", s => s.events[1].approval.attempt = 2], ["approval decision", s => s.events[1].approval.decision = "other"],
  ["approval stage", s => s.events[1].approval.stage = "UNAVAILABLE"], ["approval clock domain", s => s.events[1].approval.clock_domain = "Bad"],
];
test("B2-A schema bounds, formats, literals, enums and strict objects refuse as invalid input", () => {
  assert.equal(plan(valid).stage, "MATERIALIZED_STATIC_MATCHED"); assert.equal(approved.attempt, 1);
  for (const [name, change] of invalidCases) assert.throws(() => plan(edit(valid, change)), { message: "cc4a_invalid_input" }, name);
});
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
  ...[
    ['if (url.hostname === "registry.npmjs.org" && registry.includes(url.pathname)) continue;', 'if (registry.includes(url.pathname)) continue;', 0],
    ['if (url.hostname === "registry.npmjs.org" && registry.includes(url.pathname)) continue;', 'if (url.hostname === "registry.npmjs.org") continue;', 1],
    [' || url.port', '', 2], [' || url.hash) refuse("url_origin");', ') refuse("url_origin");', 3], [' || url.password', '', 4],
    ['if (url.hostname === "api.github.com" && (suffix', 'if ((suffix', 5], [' && url.pathname.startsWith("/repos/")) continue;', ') continue;', 6],
    ['suffix === "git/ref/tags/" + p.version || suffix === "git/ref/tags/v" + p.version', 'suffix.startsWith("git/ref/tags/")', 7],
    ['/^git\\/(?:tags|commits)\\/[a-f0-9]{40}$/.test(suffix)', '/^git\\/(?:tags|commits)\\//.test(suffix)', 8],
    ['if (url.hostname !== "raw.githubusercontent.com" || url.pathname.startsWith("/repos/")) refuse("url_origin");', 'if (url.pathname.startsWith("/repos/")) refuse("url_origin");', 9],
    ['if (url.hostname !== "raw.githubusercontent.com" || url.pathname.startsWith("/repos/")) refuse("url_origin");', 'if (url.hostname !== "raw.githubusercontent.com") refuse("url_origin");', 10],
  ].map(([from, to, i]) => [from, to, () => withUrl(urlCases[i][1]), "url_origin"]),
  ['if (slash < 0 || commit !== p.expected.pins.commit) refuse("source_commit");', 'if (slash < 0) refuse("source_commit");', () => withUrl(s => rawUrl(s, 0, "src/core/parser.js", "9".repeat(40))), "source_commit"],
  ['memberPath(path);', '', () => withUrl(s => rawUrl(s, 0, "src/a%20b.js")), "member_path"],
  ['if (slash < 0 || commit', 'if (commit', slashless, "source_commit"],
  ['if (receipt > caps.receipt_bytes) refuse("receipt_bound");', '', bigReceipt, "receipt_bound"],
  ['floors["compressed_" + suffix] = BigInt(p.archive?.compressed_bytes ?? 0);', 'floors["compressed_" + suffix] = BigInt(d.packages[0].archive?.compressed_bytes ?? 0);', () => belowFloor("compressed_chain"), "memory_floor"],
  ['if (values.length > caps.responses) refuse("url_count");', '', () => manyUrls(529), "url_count"],
  ['unique(values, "url_duplicate");', '', () => edit(subject(), s => s.url_pages[0].push(s.url_pages[0][0])), "url_duplicate"],
  ['for (const value of [p.expected?.pins, p.observed?.pins])', 'for (const value of [p.observed?.pins])', expectedOnlySri, "integrity_encoding"],
  ['for (const value of [p.expected?.pins, p.observed?.pins])', 'for (const value of [p.expected?.pins])', observedOnlySri, "integrity_encoding"],
  ...pinChanges.map(([key]) => ['for (const k of Object.keys(pins.shape)) {', `for (const k of Object.keys(pins.shape).filter(k => k !== "${key}")) {`, () => pinMismatch(key), "pin_mismatch"]),
  ['[p.expected?.pins[k], p.observed?.pins[k]].filter', '[p.observed?.pins[k]].filter', () => expectedAlias("commit"), "package_identity_alias"],
  ['[p.expected?.pins[k], p.observed?.pins[k]].filter', '[p.expected?.pins[k]].filter', () => observedAlias("commit"), "package_identity_alias"],
  ['d.diff.manifest_before !== d.baseline.manifest || ', '', () => edit(subject(), s => s.diff.manifest_before = other), "diff_baseline"],
  [' || d.diff.lock_before !== d.baseline.lock', '', () => edit(subject(), s => s.diff.lock_before = other), "diff_baseline"],
  ['m.type === "file" && prior.startsWith(key + "/")', 'false', laterPrefix, "member_alias"],
  ['if (m.bytes !== "0" || m.sha256 !== null) refuse("directory_payload");', 'if (m.bytes !== "0") refuse("directory_payload");', directoryDigest, "directory_payload"],
  ['if (root) refuse("member_root");', '', rootFile, "member_root"],
  ['if (m.sha256 === null) refuse("file_digest");', '', missingFileDigest, "file_digest"],
  ['if (regular > caps.regular_each) refuse("regular_count");', '', () => manyFiles(257), "regular_count"],
  ['if (a.regular_files !== null && a.regular_files < regular) refuse("regular_count");', '', regularBelowEnumerated, "regular_count"],
  ['if (a.inventory_complete && (a.logical_members !== members.length || a.regular_files !== regular)) refuse("inventory_count");', '', hiddenMember, "inventory_count"],
  ['const knownMembers = Math.max(memberFloor, a.logical_members ?? 0);', 'const knownMembers = memberFloor;', () => partialLogical("4094"), "padding_floor"],
  ['if (decoded > BigInt(caps.decoded_each) || a.decoded_bytes', 'if (a.decoded_bytes', oversizedPackage, "decoded_floor"],
  ['if (BigInt(r.bytes ?? 0) > BigInt(cap)) refuse("response_body_bound");', '', () => oversizedBody("archive", "4194305"), "response_body_bound"],
  ['const cap = r.kind === "metadata" ? caps.metadata_each : caps.file_each;', 'const cap = caps.file_each;', () => oversizedBody("metadata", "524289"), "response_body_bound"],
  ['BigInt(knownResponses + d.graph.mapping_pages.flat().length', 'BigInt(knownResponses', fewSteps, "inspection_work_floor"],
  ...[['const floors = { metadata, source,', 'const floors = { metadata: 0n, source,', "metadata"], ['const floors = { metadata, source,', 'const floors = { metadata, source: 0n,', "source"],
    ['receipt: BigInt(receipt), scratch: 0n };', 'receipt: 0n, scratch: 0n };', "receipt"],
    ['floors["compressed_" + suffix] = BigInt(p.archive?.compressed_bytes ?? 0);', 'floors["compressed_" + suffix] = 0n;', "compressed_json"],
    ['inventories[d.packages.indexOf(p)].known_decoded;', 'inventories[0].known_decoded;', "decoded_chain"]].map(([from, to, key]) => [from, to, () => belowFloor(key), "memory_floor"]),
  ['unique(d.memory.map(m => m.phase), "memory_phases");', '', duplicatePhase, "memory_phases"],
  ['for (const p of d.packages) if (p.audit_rows !== null) unique(p.audit_rows.map(r => r.kind), "audit_rows");', '', duplicateAuditRow, "audit_rows"],
  ['unique(mappings.map(m => m.package + "/" + m.path), "source_mapping_duplicate");', '', duplicateMapping, "source_mapping_duplicate"],
  ['if (m.url !== url || !d.url_pages.flat().includes(m.url)) refuse("source_mapping_url");', 'if (!d.url_pages.flat().includes(m.url)) refuse("source_mapping_url");', borrowedUrl, "source_mapping_url"],
  ['if (m.url !== url || !d.url_pages.flat().includes(m.url)) refuse("source_mapping_url");', 'if (m.url !== url) refuse("source_mapping_url");', unlistedUrl, "source_mapping_url"],
  ['unique(d.diff.entries, "diff_entries");', '', duplicateDiffEntry, "diff_entries"],
  ['[p.inventory_sha256, p.expected_inventory_sha256], ', '', inventoryMismatch, "placement_binding"],
  [', [p.files, p.expected_files]', '', filesMismatch, "placement_binding"],
  ['if (stage !== "UNAVAILABLE" && d.previous_receipt_sha256 === null) refuse("previous_receipt_unavailable");', '', receiptlessPredecessor, "previous_receipt_unavailable"],
  ['const staticReady = archiveReady && budgetReady && ', 'const staticReady = budgetReady && ', staticWithoutTransport, "previous_stage_prerequisite"],
  ['staticReady && summary.declared && summary.placed]', 'staticReady && summary.placed]', placedWithoutDeclaration, "previous_stage_prerequisite"],
  [' || d.previous_clock.review_sha256 !== d.tools.clock_review_sha256)) refuse', ')) refuse', foreignClockReview, "previous_clock_unavailable"],
  ['if (e.result !== (e.stage === stages[5] ? "declaration_only" : e.stage === stages[6] ? "static_layout_only" : "summary_only")) refuse("result_scope");', '', wrongResult, "result_scope"],
  ['} else if (e.approval !== null) refuse("observation_approval");', '}', observationApproval, "observation_approval"],
  ['const archiveReady = metadataComplete && tarballUrls', 'const archiveReady = tarballUrls', archiveWithoutMetadata, "previous_stage_prerequisite"],
  [' && frozen && matched && opaqueReady', ' && matched && opaqueReady', archiveWithoutCommit, "previous_stage_prerequisite"],
  ['if (a.clock_review_sha256 === null || a.clock_review_sha256 !== d.tools.clock_review_sha256', 'if (a.clock_review_sha256 !== d.tools.clock_review_sha256', nullClockReview, "approval_time_unproven"],
  ...[
    ['const metadata = d.packages.some(p => p.observed?.metadata_sha256 != null && p.observed.metadata_bytes !== null);', 'const metadata = d.packages.some(p => p.observed?.metadata_bytes != null);', "metadata digests"],
    ['const metadata = d.packages.some(p => p.observed?.metadata_sha256 != null && p.observed.metadata_bytes !== null);', 'const metadata = d.packages.some(p => p.observed?.metadata_sha256 != null);', "metadata sizes"],
    ['const metadataComplete = d.packages.every(p => p.observed?.metadata_sha256 != null && p.observed.metadata_bytes !== null);', 'const metadataComplete = d.packages.every(p => p.observed?.metadata_sha256 != null);', "one metadata size"],
    ['p.expected?.pins.integrity != null && p.expected.pins.commit !== null', 'p.expected?.pins.integrity != null', "expected commit"],
    ['if (d.observed_baseline[k] === null) blockers.push("baseline_unavailable");', '', "observed baseline"],
    ['const opaqueReady = budget.opaque_plan_complete && ', 'const opaqueReady = ', "incomplete response"],
    [' && d.work.hash_passes !== null && d.work.hash_byte_ceiling !== null,', ' && d.work.hash_byte_ceiling !== null,', "hash passes"],
    [' && d.work.hash_passes !== null && d.work.hash_byte_ceiling !== null,', ' && d.work.hash_passes !== null,', "hash ceiling"],
    ['if (m.phase === "receive") receiveReservation = ready;', 'receiveReservation = true;', "receive reservation"],
    [' && frozen && matched && opaqueReady', ' && frozen && opaqueReady', "observed integrity"],
    ['&& BigInt(p.archive.compressed_bytes) > 0n)', ')', "empty compressed archive"],
    ['if (passes === null || !ready || ceiling === null) blockers', 'if (!ready || ceiling === null) blockers', "decode passes"],
    ['if (passes === null || !ready || ceiling === null) blockers', 'if (passes === null || !ready) blockers', "decode ceiling"],
    ['if (d.work.inspection_steps === null || d.work.step_ceiling === null) blockers', 'if (d.work.inspection_steps === null) blockers', "step ceiling"],
    ['&& m.joint_floor !== null && m.ceiling !== null;', '&& m.ceiling !== null;', "memory joint floor"],
    ['&& m.joint_floor !== null && m.ceiling !== null;', '&& m.joint_floor !== null;', "memory ceiling"],
    ['complete([...Object.values(p.expected.pins), ...Object.values(p.observed.pins)])', 'complete([...Object.values(p.observed.pins)])', "expected exports pin"],
    ['complete([...Object.values(p.expected.pins), ...Object.values(p.observed.pins)])', 'complete([...Object.values(p.expected.pins)])', "observed exports pin"],
    ['d.packages.every(p => p.audit_rows !== null && p.audit_rows.every', 'd.packages.every(p => !p.audit_rows || p.audit_rows.every', "audit rows"],
    ['mappings.every(m => m.package_sha256 !== null && m.source_sha256 !== null)', 'mappings.every(m => m.source_sha256 !== null)', "package mapping digest"],
    ['&& g.source_count === mappings.length && g.source_bytes', '&& g.source_bytes', "extra source count"],
    ['&& g.source_bytes !== null && BigInt(g.source_bytes) >= sum(expected.map(f => f.bytes));', '&& g.source_bytes !== null;', "source bytes below payload"],
    ['const entryBound = entry !== undefined && json.observed?.pins.entry_sha256 === entry.sha256;', 'const entryBound = entry !== undefined;', "entry digest"],
    ...["g.expected_sha256", "g.options_sha256", "g.runtime_sha256", "d.profile.runtime_sha256"].map((k, i) => {
      const all = "g.sha256, g.expected_sha256, g.closure_sha256, g.options_sha256, g.runtime_sha256, d.profile.runtime_sha256";
      return [`complete([${all}])`, `complete([${all.split(", ").filter(x => x !== k).join(", ")}])`, ["expected graph", "graph options", "graph runtime", "profile runtime"][i]];
    }),
    ['&& d.diff.unrelated_changes === false', '', "unrelated changes unknown"],
    ['complete([d.diff.manifest_after, d.diff.lock_after])', 'complete([d.diff.lock_after])', "manifest after"],
  ].map(([from, to, name]) => [from, to, () => reviewStage(name), "stage_prerequisite"]),
];
for (const [i, [from, to, make, reason]] of mutationCases.entries()) test("B2-A own behavioral gate removal " + i, () => {
  assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, to)), s = make();
  assert.equal(original(ready()).stage, "UNAVAILABLE"); assert.equal(changed(ready()).stage, "UNAVAILABLE");
  assert.throws(() => original(s), { message: "cc4c2cb2a_" + reason });
  assert.doesNotThrow(() => changed(s));
});
for (const [name, from, to, change, count = 3] of planChanges) test("B2-A plan binding gate removal " + name, () => {
  assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, to));
  const build = fn => { const s = ready(); for (let i = 0; i < count; i++) append(s, stages[i], "matched_supplied", fn); change(s); return s; };
  assert.throws(() => original(build(original)), { message: "cc4c2cb2a_plan_binding" });
  assert.doesNotThrow(() => changed(build(changed)));
});
test("B2-A plan binding gate removal predecessor clock", () => {
  const from = " previous_clock: d.previous_clock,"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, ""));
  const late = fn => { const s = predecessorClock(fn); s.previous_clock.now_ns = "9"; return s; };
  assert.throws(() => original(late(original)), { message: "cc4c2cb2a_plan_binding" });
  assert.doesNotThrow(() => changed(late(changed)));
});
test("B2-A source-mapping owner gate removal on disjoint package paths", () => {
  const from = "file = expected.find(f => f.package === m.package && f.path === m.path);"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, "file = expected.find(f => f.path === m.path);"));
  for (const fn of [original, changed]) assert.equal(fn(advanceInput(distinctPaths())).stage, "MATERIALIZED_STATIC_MATCHED");
  assert.throws(() => original(foreignOwner()), { message: "cc4c2cb2a_source_mapping_member" });
  assert.doesNotThrow(() => changed(foreignOwner()));
});
test("B2-A plan binding gate removal expected pins after their stage", () => {
  const from = "packages: d.packages.map(p => ({ name: p.name, version: p.version, expected: p.expected })), "; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, ""));
  assert.throws(() => original(declaredAfterReview(original)), { message: "cc4c2cb2a_plan_binding" });
  assert.doesNotThrow(() => changed(declaredAfterReview(changed)));
});
test("B2-A entry package gate removal", () => {
  const from = 'f.package === "stream-json" && f.path === "src/core/parser.js"'; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, 'f.path === "src/core/parser.js"'));
  for (const fn of [original, changed]) assert.equal(fn(advanced(4)).stage, "STATIC_AUDIT_MATCHED");
  assert.throws(() => original(borrowedEntry()), { message: "cc4c2cb2a_stage_prerequisite" });
  assert.doesNotThrow(() => changed(borrowedEntry()));
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
