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
  blocked.push([o, k]); replace(o, k, () => { effects.push(k); throw Error("b2m1_forbidden_effect"); });
} }
let escapedRead = 0;
let escapedParse = 0;
replace(JSON, "parse", () => { escapedParse++; throw Error("b2m1_parse_sentinel"); });
block(JSON, ["parse"]);
replace(fs, "readSync", () => { escapedRead++; throw Error("b2m1_read_sentinel"); });
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
    effects.push(k); throw Error("b2m1_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = n => () => { effects.push(n); throw Error("b2m1_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)]))); replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(performance, ["now"]); block(process, ["uptime", "cpuUsage", "resourceUsage"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); assert.equal(escapedRead, 0); assert.equal(escapedParse, 0); });

const target = await import("../helpers/unsignedMetadataAcquisitionContracts.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const { z } = await import("zod");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const source = fs.readFileSync(new URL("../helpers/unsignedMetadataAcquisitionContracts.mjs", import.meta.url), "utf8");
const h = "a".repeat(64), other = "b".repeat(64), names = ["stream-json", "stream-chain"], versions = ["3.8.0", "4.4.1"];
const kinds = ["npm", "ref", "tag", "commit"];
const edit = (s, fn) => { const copy = structuredClone(s); fn(copy); return copy; };
function operation(packageName, kind, key, phase = "initial") {
  const url = kind === "npm" ? "https://registry.npmjs.org/" + packageName + "/" + key
    : "https://api.github.com/repos/uhop/" + packageName + "/git/" + (kind === "ref" ? "ref/tags/" : kind === "tag" ? "tags/" : "commits/") + key;
  return { id: "op-" + packageName + "-" + kind + "-" + key.replaceAll(".", "-") + "-" + phase,
    package: packageName, kind, key, phase, url, body_ceiling: "1024", header_ceiling: "100", delivery_ceiling: 10 };
}
function subject() {
  const operations = [operation(names[0], "npm", versions[0]), operation(names[1], "npm", versions[1]),
    ...names.flatMap((n, i) => [operation(n, "ref", versions[i]), operation(n, "ref", "v" + versions[i])])];
  return { schema: "unsigned-metadata-acquisition-v1", source: "synthetic_summary", mode: "initial", attempt: "attempt-one",
    baseline: { source: h, manifest: h, lock: h }, observed_baseline: { source: h, manifest: h, lock: h },
    prior_reports: [], destination: "memory_only", operations,
    graph: operations.filter(o => o.kind === "ref").map(o => ({ package: o.package, kind: "ref", key: o.key, availability: "unknown", expected_type: null, expected_target: null, tree_id: null, parents: [] })),
    profiles: { runtime: null, bootstrap: null, transport: null, address: null, tls: null, decoder: null, clock: null, environment: null, authorization: null,
      reservations: { parser: null, transport: null, bootstrap: null } },
    clock: { domain: "metadata-summary", start_ns: null, expires_ns: null },
    budget: { hash_work_bytes: null, decode_work_bytes: null, inspection_units: null, wire_bytes: null, heap_bytes: null },
    work: { hash_passes: null, decode_passes: null, inspection_steps: null, wire_bytes: null },
    memory: ["receive", "decode", "report"].map(phase => ({ phase, allocations: { raw: null, incoming: null, text: null, parser: null,
      projection: null, receipts: null, bootstrap: null, transport: null }, joint_floor: null })),
    usage: kinds.map(kind => ({ kind, attempted: null, body_bytes: null, header_bytes: null, deliveries: null })), approval: null, records: [] };
}
const plan = (s = subject()) => target.planUnsignedMetadataAcquisition(s);
const refuses = (s, reason) => assert.throws(() => plan(s), { message: "b2m1_" + reason });
test("M1 empty plan never grants runtime authority", () => {
  const p = plan();
  assert.equal(p.model_state, "PREFLIGHT_BLOCKED");
  assert.equal(p.execution_available, false); assert.equal(p.native_status, "NOT_RUN");
  assert.equal(p.metadata_parser_executed, false); assert.equal(p.actual_metadata_verified, false);
  assert.deepEqual(target.describeUnsignedMetadataAcquisitionCapacity(subject()), p);
  assert.ok(p.blockers.includes("profiles_unavailable"));
});
test("M1 the initial request list is exact and cannot contain artifact or private endpoints", () => {
  refuses(edit(subject(), s => s.operations[0].url = "https://127.0.0.1/x"), "operation_url");
  refuses(edit(subject(), s => s.operations.pop()), "initial_set");
  refuses(edit(subject(), s => s.operations[0].key = "latest"), "operation_key");
});
const ids = ["1".repeat(40), "2".repeat(40)], commits = ["c".repeat(40), "d".repeat(40)];
function finalSubject() {
  const s = subject(); s.mode = "final";
  for (const [i, name] of names.entries()) {
    Object.assign(s.graph.find(n => n.package === name && n.key === versions[i]), { availability: "present", expected_type: "tag", expected_target: ids[i] });
    Object.assign(s.graph.find(n => n.package === name && n.key === "v" + versions[i]), { availability: "unavailable" });
    s.graph.push({ package: name, kind: "tag", key: ids[i], availability: "present", expected_type: "commit", expected_target: commits[i], tree_id: null,
      parents: [{ kind: "ref", key: versions[i] }] },
      { package: name, kind: "commit", key: commits[i], availability: "present", expected_type: null, expected_target: null, tree_id: null,
        parents: [{ kind: "tag", key: ids[i] }] });
  }
  s.operations.push(...names.map((n, i) => operation(n, "tag", ids[i], "object")), ...names.map((n, i) => operation(n, "commit", commits[i], "object")),
    ...s.operations.slice(0, 6).map(o => ({ ...o, id: o.id.replace(/initial$/, "recheck"), phase: "recheck" })));
  return s;
}
test("M1 exact reviewed object URLs and parent/type bindings are mandatory", () => {
  plan(finalSubject());
  refuses(edit(finalSubject(), s => s.graph.find(n => n.kind === "tag").parents[0].key = "v3.8.0"), "parent_binding");
  refuses(edit(finalSubject(), s => Object.assign(s.operations.find(o => o.kind === "tag"), operation(names[0], "tag", "3".repeat(40), "object"))), "operation_node");
  refuses(edit(finalSubject(), s => s.graph.push(structuredClone(s.graph[0]))), "graph_duplicate");
});
function ready(input = subject()) {
  const s = structuredClone(input);
  for (const k of Object.keys(s.profiles).filter(k => k !== "reservations")) s.profiles[k] = h;
  for (const k of Object.keys(s.profiles.reservations)) s.profiles.reservations[k] = "4096";
  s.clock.start_ns = "1000000000"; s.clock.expires_ns = "241000000000";
  for (const k of Object.keys(s.budget)) s.budget[k] = "100000000";
  s.work = { hash_passes: "1", decode_passes: "1", inspection_steps: "100000", wire_bytes: "50000000" };
  for (const m of s.memory) { for (const k of Object.keys(m.allocations)) m.allocations[k] = "131072"; m.joint_floor = "0"; }
  for (const u of s.usage) Object.assign(u, { attempted: 0, body_bytes: "0", header_bytes: "0", deliveries: "0" });
  return s;
}
test("M1 invented complete preflight is still only a plan", () => {
  const p = plan(ready()); assert.equal(p.model_state, "PLAN_ONLY"); assert.equal(p.model_prerequisites_complete, true);
  assert.equal(p.capacity.body_reservation, "6144"); assert.equal(p.capacity.hash_work.known_reserved, "6144");
  assert.equal(p.capacity.memory.modeled_peak, "1048576"); assert.equal(p.execution_available, false);
});
test("M1 unknown reservations retain logical floors and never complete memory", () => {
  const p = plan(); assert.equal(p.capacity.memory.modeled_peak, null);
  assert.ok(BigInt(p.capacity.memory.known_peak) >= 1024n + 1025n + 2048n);
  assert.equal(p.capacity.hash_work.modeled_reserved, null);
  assert.equal(p.capacity.body_consumed.modeled, null);
});
for (const [name, change, reason] of [
  ["raw floor", s => s.memory[0].allocations.raw = "1023", "memory_floor"],
  ["wire floor", s => s.work.wire_bytes = "6743", "wire_floor"],
  ["heap cap", s => s.budget.heap_bytes = "1048575", "memory_bound"],
  ["hash cap", s => s.budget.hash_work_bytes = "6143", "hash_work_bound"],
  ["decode cap", s => s.budget.decode_work_bytes = "6143", "decode_work_bound"],
  ["inspection floor", s => s.work.inspection_steps = "9", "inspection_floor"],
]) test("M1 budget rejects " + name, () => { plan(ready()); refuses(edit(ready(), change), reason); });
function authorize(s) {
  const p = plan(s); s.approval = { source: "supplied_review_summary", plan_sha256: p.plan_sha256, baseline_sha256: data.digest(s.baseline),
    attempt: s.attempt, profile_sha256: data.digest(s.profiles), used: false, decision: "approved_supplied", clock_domain: s.clock.domain,
    now_ns: s.clock.start_ns, expires_ns: s.clock.expires_ns }; return s;
}
function responseData(o, s) {
  const i = names.indexOf(o.package);
  if (o.kind === "npm") return { kind: "npm", name: o.package, version: versions[i],
    tarball: "https://registry.npmjs.org/" + o.package + "/-/" + o.package + "-" + versions[i] + ".tgz",
    declared_integrity: "sha512-" + Buffer.alloc(64, i + 1).toString("base64"), git_head: commits[i] };
  const n = s.graph.find(n => n.package === o.package && n.kind === o.kind && n.key === o.key);
  return { kind: o.kind, package: o.package, repository: "uhop/" + o.package, key: o.key,
    target_type: n?.expected_type ?? (o.kind === "ref" ? "tag" : o.kind === "tag" ? "commit" : null),
    target_id: n?.expected_target ?? (o.kind === "ref" ? ids[i] : o.kind === "tag" ? commits[i] : null), tree_id: o.kind === "commit" ? "e".repeat(40) : null };
}
function updateUsage(s) {
  for (const u of s.usage) {
    const rows = s.records.filter(r => s.operations.find(o => o.id === r.op_id)?.kind === u.kind);
    u.attempted = rows.length;
    for (const k of ["body_bytes", "header_bytes", "deliveries"]) u[k] = rows.every(r => r.http[k] !== null)
      ? String(rows.reduce((n, r) => n + BigInt(r.http[k]), 0n)) : null;
  }
}
function append(s, change = () => {}) {
  const p = plan(s), o = s.operations[s.records.length], ordinal = s.records.length + 1;
  const start = BigInt(s.clock.start_ns) + BigInt(ordinal) * 1000000n, absent = o.kind === "ref" && o.key.startsWith("v")
    && s.graph.find(n => n.package === o.package && n.kind === "ref" && n.key === o.key)?.availability !== "present";
  const r = { ordinal, op_id: o.id, attempt: s.attempt, source: "synthetic_current_attempt", plan_sha256: p.plan_sha256, previous_receipt_sha256: p.receipt_sha256, outcome: "observed",
    time: { domain: s.clock.domain, start_ns: String(start), end_ns: String(start + 500000n), close_ns: String(start + 700000n), dns_tls_ns: "100", inactivity_ns: "100" },
    http: { status: absent ? 404 : 200, body_bytes: absent ? "0" : "512", header_bytes: "80", pairs: 4, deliveries: absent ? 0 : 1,
      wire_bytes: absent ? "80" : "592", body_sha256: h, content_length: absent ? "0" : "512", end: true, complete: true, peer_bound: true,
      tls_bound: true, framing_checked: true, headers_untruncated: true, encoding: "identity", media: "json_utf8", socket: "closed", timers: "closed", socket_peak: 1, timer_peak: 3 },
    json: absent ? null : { utf8: "strict_supplied", grammar: "strict_supplied", bom: false, duplicate_keys: false, root: "object",
      depth: 2, nodes: 20, keys: 10, scalar_bytes: "128", numeric_bytes: "8", parsed_bytes: "512" }, data: absent ? null : responseData(o, s) };
  change(r); s.records.push(r); updateUsage(s); return s;
}
function observed(input = subject(), count = input.operations.length) {
  const s = authorize(ready(input)); for (let i = 0; i < count; i++) append(s); return s;
}
test("M1 discovery proposes exact URLs but never performs follow-ups or freezes pins", () => {
  const p = plan(observed()); assert.equal(p.model_state, "AWAITING_EXACT_URL_REVIEW");
  assert.equal(p.proposals.length, 2); assert.equal(p.pin_frozen, false); assert.equal(p.network_available, false);
  assert.equal(p.records.length, 6); assert.ok(p.proposals.every(v => v.kind === "tag" && v.authorizes_request === false));
});
test("M1 complete fresh final observation remains unreviewed synthetic evidence", () => {
  const p = plan(observed(finalSubject()));
  assert.equal(p.model_state, "FINAL_METADATA_OBSERVED_UNREVIEWED");
  assert.equal(p.proposals.length, 0); assert.equal(p.pin_proposals[0].peeled_commit, commits[0]);
  assert.equal(p.pin_proposals[0].actual_package_sha256, null);
  for (const k of ["execution_available", "approval_authenticated", "timestamps_verified", "actual_metadata_verified", "metadata_parser_executed",
    "signature_verified", "pin_frozen", "tarball_bytes_verified", "producer_available", "evidence_saved"]) assert.equal(p[k], false, k);
});
for (const outcome of ["refused", "cancelled", "timeout", "unknown_close"]) test("M1 terminal " + outcome + " cannot resume on a late record", () => {
  const s = authorize(ready()); append(s, r => r.outcome = outcome);
  assert.equal(plan(s).model_state, outcome === "refused" ? "REFUSED" : "STOPPED_UNKNOWN");
  append(s); refuses(s, "terminal_progress");
});
test("M1 final operation order cannot consume a child before its parent", () => {
  const s = finalSubject(); [s.operations[6], s.operations[8]] = [s.operations[8], s.operations[6]];
  refuses(s, "operation_order");
});
test("M1 object-discovery observations cannot form a cycle behind historical roots", () => {
  const s = subject(), a = ids[0], b = "3".repeat(40); s.mode = "objects";
  Object.assign(s.graph[0], { availability: "present", expected_type: "tag", expected_target: a });
  s.graph.push({ package: names[0], kind: "tag", key: a, availability: "present", expected_type: "tag", expected_target: b, tree_id: null, parents: [{ kind: "ref", key: versions[0] }] },
    { package: names[0], kind: "tag", key: b, availability: "present", expected_type: null, expected_target: null, tree_id: null, parents: [{ kind: "tag", key: a }] });
  s.operations = [operation(names[0], "tag", a, "object"), operation(names[0], "tag", b, "object")];
  const input = authorize(ready(s)); append(input); append(input, r => { r.data.target_type = "tag"; r.data.target_id = a; });
  refuses(input, "graph_cycle");
});
test("M1 JSON limits cannot hide behind unknown HTTP completion", () => {
  const s = observed(subject(), 1); s.records[0].http.complete = null; s.records[0].json.depth = 33;
  refuses(s, "json_bound");
});
function maximal() {
  const s = finalSubject(); s.graph = s.graph.filter(n => n.kind === "ref");
  const objects = [];
  for (const [i, name] of names.entries()) {
    const chain = [ids[i], ...[3, 5, 7].map(n => String(n + i).repeat(40))];
    for (const [j, key] of chain.entries()) {
      s.graph.push({ package: name, kind: "tag", key, availability: "present", expected_type: j === 3 ? "commit" : "tag",
        expected_target: j === 3 ? commits[i] : chain[j + 1], tree_id: null,
        parents: [{ kind: j ? "tag" : "ref", key: j ? chain[j - 1] : versions[i] }] });
      objects.push(operation(name, "tag", key, "object"));
    }
    s.graph.push({ package: name, kind: "commit", key: commits[i], availability: "present", expected_type: null, expected_target: null,
      tree_id: null, parents: [{ kind: "tag", key: chain[3] }] });
    objects.push(operation(name, "commit", commits[i], "object"));
  }
  s.operations = [...s.operations.slice(0, 6), ...objects, ...s.operations.slice(-6)];
  for (const o of s.operations) o.body_ceiling = "524288";
  const r = ready(s); for (const m of r.memory) for (const k of Object.keys(m.allocations)) m.allocations[k] = "4194304";
  return r;
}
test("M1 both aliases share a four-tag budget including a not-yet-listed target", () => {
  const s = maximal(); assert.equal(plan(s).capacity.planned_attempts, 22);
  const end = s.graph.find(n => n.package === names[0] && n.kind === "tag" && n.expected_type === "commit");
  end.expected_type = "tag"; end.expected_target = "9".repeat(40);
  refuses(s, "tag_cap");
});
function observedFifthTag() {
  const s = subject(), [a, b, c, d, e] = [1, 3, 5, 7, 9].map(n => String(n).repeat(40)); s.mode = "objects";
  for (const [index, key] of [a, c].entries()) Object.assign(s.graph[index], { availability: "present", expected_type: "tag", expected_target: key });
  for (const [key, target, parentKind, parentKey] of [[a, b, "ref", versions[0]], [b, null, "tag", a], [c, d, "ref", "v" + versions[0]]])
    s.graph.push({ package: names[0], kind: "tag", key, availability: "present", expected_type: target === null ? null : "tag", expected_target: target,
      tree_id: null, parents: [{ kind: parentKind, key: parentKey }] });
  s.operations = [operation(names[0], "tag", b, "object")]; const input = authorize(ready(s));
  append(input, r => { r.data.target_type = "tag"; r.data.target_id = e; }); return input;
}
test("M1 new observed hops share the budget with historical unlisted targets", () => {
  refuses(observedFifthTag(), "tag_cap");
});
for (const url of ["http://registry.npmjs.org/stream-json/3.8.0", "https://registry.npmjs.org:443/stream-json/3.8.0",
  "https://registry.npmjs.org/stream-json/3.8.0?x=1", "https://registry.npmjs.org/stream-json/3.8.0#x",
  "https://user@registry.npmjs.org/stream-json/3.8.0", "https://registry.npmjs.org/stream-json/%33.8.0",
  "https://registry.npmjs.org/stream-json/-/stream-json-3.8.0.tgz", "https://registry.npmjs.org.evil/stream-json/3.8.0",
  "https://raw.githubusercontent.com/uhop/stream-json/main/package.json"]) test("M1 literal URL refuses " + url, () => {
  plan(subject()); refuses(edit(subject(), s => s.operations[0].url = url), "operation_url");
});
for (const field of ["runtime", "bootstrap", "transport", "address", "tls", "decoder", "clock", "environment", "authorization"])
  test("M1 unavailable profile " + field + " blocks modeled preflight", () => {
    assert.equal(plan(ready()).model_prerequisites_complete, true);
    const p = plan(edit(ready(), s => s.profiles[field] = null));
    assert.equal(p.model_prerequisites_complete, false); assert.ok(p.blockers.includes("profiles_unavailable"));
  });
for (const [name, mutate, reason] of [
  ["baseline", s => s.observed_baseline.source = other, "manual_baseline_change"],
  ["previous attempt", s => s.prior_reports.push({ attempt: s.attempt, report_sha256: h, observed_requests: 6, source: "planning_hint" }), "attempt_reuse"],
  ["clock window", s => s.clock.expires_ns = "241000000001", "clock_window"],
  ["zero clock window", s => s.clock.expires_ns = s.clock.start_ns, "clock_window"],
  ["zero hash passes", s => s.work.hash_passes = "0", "work_passes"],
  ["usage kinds", s => s.usage[1].kind = "npm", "usage_kinds"],
  ["memory phases", s => s.memory[1].phase = "receive", "memory_phases"],
  ["operation duplicate id", s => s.operations[1].id = s.operations[0].id, "operation_ids"],
  ["body ceiling", s => s.operations[0].body_ceiling = "524289", "body_ceiling"],
  ["header ceiling", s => s.operations[0].header_ceiling = "16385", "header_ceiling"],
  ["delivery ceiling", s => s.operations[0].delivery_ceiling = 1025, "delivery_ceiling"],
]) test("M1 plan rejects " + name, () => { plan(ready()); refuses(edit(ready(), mutate), reason); });
test("M1 joint floors combine with simultaneous disjoint resources without refunds", () => {
  const s = ready(), p = plan(s); assert.equal(p.capacity.memory.known_peak, "1048576");
  s.memory[1].joint_floor = "1048577"; assert.equal(plan(s).capacity.memory.known_peak, "1048577");
  s.budget.heap_bytes = "1048576"; refuses(s, "memory_bound");
});
test("M1 per-kind attempts and failure bytes sum before independent total caps", () => {
  const s = maximal(); for (const u of s.usage) u.attempted = s.operations.filter(o => o.kind === u.kind).length;
  assert.equal(plan(s).capacity.known_consumed_attempts, 22);
  refuses(edit(s, r => r.usage[0].attempted++), "attempt_cap");
  s.usage[0].body_bytes = "2097152"; s.usage[1].body_bytes = "4194304"; s.usage[2].body_bytes = "2097152";
  assert.equal(plan(s).capacity.body_consumed.known, "8388608");
  refuses(edit(s, r => r.usage[2].body_bytes = "2097153"), "body_total");
  assert.equal(plan(s).capacity.body_consumed.modeled, null);
  assert.equal(plan(s).capacity.body_reservation, "8388608");
  assert.equal(plan(s).capacity.planned_max_body_bytes, "11534336");
});
test("M1 known usage floors survive null counters and stop the replay", () => {
  const s = observed(subject(), 1); s.usage[0].body_bytes = null;
  const p = plan(s); assert.equal(p.capacity.body_consumed.known, "512");
  assert.equal(p.capacity.body_consumed.modeled, null); assert.equal(p.model_state, "STOPPED_UNKNOWN");
  refuses(edit(s, q => q.usage[0].body_bytes = "511"), "usage_floor");
});
for (const [name, make, reason] of [
  ["attempt cap", () => { const s = maximal(); s.operations.push(operation(names[0], "tag", "9".repeat(40), "object")); return s; }, "attempt_cap"],
  ["URL cap", () => { const s = maximal(); s.operations[21] = operation(names[0], "tag", "9".repeat(40), "object"); return s; }, "url_cap"],
  ["initial phase", () => edit(ready(), s => s.operations[0].phase = "object"), "operation_phase"],
  ["objects only", () => edit(ready(), s => s.mode = "objects"), "objects_set"],
  ["final rechecks", () => edit(finalSubject(), s => s.operations.pop()), "final_set"],
  ["root set", () => edit(ready(), s => s.graph.pop()), "graph_roots"],
  ["initial graph", () => edit(finalSubject(), s => { s.mode = "initial"; s.operations = s.operations.slice(0, 6); }), "initial_graph"],
  ["partial target", () => edit(ready(), s => s.graph[0].expected_type = "tag"), "graph_target"],
  ["noncommit tree", () => edit(ready(), s => s.graph[0].tree_id = ids[0]), "graph_target"],
  ["commit operation", () => edit(finalSubject(), s => s.operations.splice(8, 1)), "graph_operation_missing"],
  ["per-kind count", () => edit(ready(), s => s.usage[0].attempted = 3), "unplanned_attempt"],
  ["per-kind body", () => edit(ready(), s => s.usage[0].body_bytes = "2049"), "body_quota"],
  ["per-kind headers", () => edit(ready(), s => s.usage[0].header_bytes = "201"), "header_quota"],
  ["per-kind deliveries", () => edit(ready(), s => s.usage[0].deliveries = "21"), "delivery_quota"],
  ["inspection budget", () => edit(ready(), s => s.budget.inspection_units = "99999"), "inspection_bound"],
  ["wire budget", () => edit(ready(), s => s.budget.wire_bytes = "49999999"), "wire_bound"],
]) test("M1 independent finite-plan gate " + name, () => { plan(maximal()); refuses(make(), reason); });
test("M1 missing baseline, clock, work and reservations never gain modeled permission", () => {
  for (const change of [s => s.observed_baseline.lock = null, s => s.clock.start_ns = null,
    s => s.work.decode_passes = null, s => s.budget.heap_bytes = null, s => s.profiles.reservations.parser = null]) {
    const p = plan(edit(ready(), change)); assert.equal(p.model_prerequisites_complete, false); assert.equal(p.model_state, "PREFLIGHT_BLOCKED");
  }
  const s = observed(subject(), 1); s.profiles.runtime = null; refuses(s, "preflight_unavailable");
});
test("M1 request order and duplicate graph/operation identities have separate refusals", () => {
  refuses(edit(ready(), s => { const row = structuredClone(s.operations[0]); row.id = "other-id"; s.operations.push(row); }), "operation_duplicate");
  refuses(edit(finalSubject(), s => s.graph[4].parents.push(structuredClone(s.graph[4].parents[0]))), "parent_duplicate");
  refuses(edit(ready(), s => s.prior_reports = [1, 2].map(() => ({ attempt: "older-attempt", report_sha256: h, observed_requests: 6, source: "planning_hint" }))), "prior_reports");
});
test("M1 final rechecks charge repeated URLs and bytes without raw-body retention", () => {
  const s = observed(finalSubject()), p = plan(s);
  assert.equal(p.capacity.known_consumed_attempts, 16); assert.equal(p.capacity.body_consumed.known, "6144");
  assert.equal(new Set(s.operations.map(o => o.url)).size, 10); assert.equal(p.records.length, 16);
  assert.equal(p.capacity.body_consumed.modeled, "6144"); assert.equal(p.capacity.refunded, false);
});
const resultCases = [
  ["body", r => { r.http.body_bytes = "1025"; r.http.content_length = "1025"; r.http.wire_bytes = "1105"; r.json.parsed_bytes = "1025"; }, "body_bound"],
  ["headers", r => r.http.header_bytes = "101", "header_bound"],
  ["pairs", r => r.http.pairs = 65, "header_bound"],
  ["deliveries", r => r.http.deliveries = 11, "delivery_bound"],
  ["sockets", r => r.http.socket_peak = 2, "resource_peak"],
  ["timers", r => r.http.timer_peak = 4, "resource_peak"],
  ["length", r => r.http.content_length = "511", "content_length"],
  ["wire", r => r.http.wire_bytes = "591", "wire_floor"],
  ["start regression", r => r.time.start_ns = "999999999", "clock_regression"],
  ["zero duration", r => { r.time.end_ns = r.time.start_ns; r.time.dns_tls_ns = r.time.inactivity_ns = "0"; }, null],
  ["phase", r => r.time.dns_tls_ns = "5000000001", "phase_deadline"],
  ["settlement", r => r.time.close_ns = String(BigInt(r.time.end_ns) + 10000000001n), "settlement"],
  ["request deadline", r => { r.time.end_ns = String(BigInt(r.time.start_ns) + 15000000001n); r.time.close_ns = r.time.end_ns; }, "deadline"],
  ["status", r => r.http.status = 302, "http_status"],
  ["encoding", r => r.http.encoding = "other", "http_policy"],
  ["media", r => r.http.media = "other", "http_policy"],
  ["utf8", r => r.json.utf8 = "invalid", "json_policy"],
  ["grammar", r => r.json.grammar = "invalid", "json_policy"],
  ["BOM", r => r.json.bom = true, "json_policy"],
  ["duplicate keys", r => r.json.duplicate_keys = true, "json_policy"],
  ["root array", r => r.json.root = "array", "json_policy"],
  ["root scalar", r => r.json.root = "scalar", "json_policy"],
  ["depth", r => r.json.depth = 33, "json_bound"],
  ["nodes", r => r.json.nodes = 16385, "json_bound"],
  ["keys", r => r.json.keys = 257, "json_bound"],
  ["scalar", r => r.json.scalar_bytes = "65537", "json_bound"],
  ["numeric", r => r.json.numeric_bytes = "129", "json_bound"],
  ["parsed bytes", r => r.json.parsed_bytes = "511", "parsed_bytes"],
  ["package", r => r.data.name = names[1], "response_identity"],
  ["version", r => r.data.version = "3.8.1", "response_identity"],
  ["tarball", r => r.data.tarball = "https://evil.invalid/data.tgz", "tarball_declaration"],
];
for (const [name, change, reason] of resultCases) test("M1 observed result " + name + " gate", () => {
  plan(observed(subject(), 1)); const s = authorize(ready()); append(s, change);
  if (reason) refuses(s, reason); else assert.equal(plan(s).model_state, "DISCOVERY_OBSERVED_PARTIAL");
});
for (const [name, change] of [
  ...["complete", "end", "peer_bound", "tls_bound", "framing_checked", "headers_untruncated"].map(k => [k, r => r.http[k] = null]),
  ["socket unknown", r => r.http.socket = "unknown"], ["timers active", r => r.http.timers = "active"],
  ["unknown clock", r => r.time.end_ns = null], ["unknown depth", r => r.json.depth = null],
  ["unknown strictness", r => r.json.utf8 = "unknown"], ["unknown data", r => r.data = null],
]) test("M1 unknown " + name + " cannot permit a following result", () => {
  const s = authorize(ready()); append(s, change); assert.equal(plan(s).model_state, "STOPPED_UNKNOWN");
  append(s); refuses(s, "terminal_progress");
});
for (const [name, change, reason] of [
  ["plan", s => s.approval.plan_sha256 = other, "approval_binding"],
  ["baseline", s => s.approval.baseline_sha256 = other, "approval_binding"],
  ["profile", s => s.approval.profile_sha256 = other, "approval_binding"],
  ["attempt", s => s.approval.attempt = "attempt-other", "approval_binding"],
  ["used", s => s.approval.used = true, "approval_replay"],
  ["pending", s => s.approval.decision = "pending", "approval_pending"],
  ["refused", s => s.approval.decision = "refused", "approval_pending"],
  ["expiry", s => s.approval.expires_ns = "241000000001", "approval_clock"],
  ["now", s => s.approval.now_ns = "1000000001", "approval_clock"],
  ["unknown expiry", s => s.approval.expires_ns = null, "approval_clock"],
  ["missing", s => s.approval = null, "approval_unavailable"],
  ["ordinal", s => s.records[0].ordinal = 2, "record_order"],
  ["operation", s => s.records[0].op_id = s.operations[1].id, "record_order"],
  ["record attempt", s => s.records[0].attempt = "attempt-other", "record_binding"],
  ["record plan", s => s.records[0].plan_sha256 = other, "record_binding"],
  ["predecessor", s => s.records[0].previous_receipt_sha256 = other, "record_binding"],
]) test("M1 supplied approval/receipt " + name + " binding", () => {
  const s = observed(subject(), 1); plan(s); change(s); refuses(s, reason);
});
test("M1 observed response ceilings have accepted exact-bound controls", () => {
  const s = authorize(ready()); append(s, r => {
    Object.assign(r.http, { body_bytes: "1024", header_bytes: "100", pairs: 64, deliveries: 10, wire_bytes: "1124", content_length: "1024" });
    Object.assign(r.json, { parsed_bytes: "1024", depth: 32, nodes: 16384, keys: 256, scalar_bytes: "65536", numeric_bytes: "128" });
    r.time.dns_tls_ns = r.time.inactivity_ns = "5000000000";
    r.time.end_ns = String(BigInt(r.time.start_ns) + 15000000000n); r.time.close_ns = String(BigInt(r.time.end_ns) + 10000000000n);
  }); assert.equal(plan(s).model_state, "DISCOVERY_OBSERVED_PARTIAL");
});
test("M1 refused partial response bytes and deliveries are charged without projection", () => {
  const s = authorize(ready()); append(s, r => { r.outcome = "refused"; r.http.complete = false; r.http.body_bytes = "700";
    r.http.wire_bytes = "780"; r.json = r.data = null; });
  const p = plan(s); assert.equal(p.model_state, "REFUSED"); assert.equal(p.capacity.body_consumed.known, "700");
  assert.equal(p.capacity.delivery_consumed, "1"); assert.equal(p.pin_proposals[0].registry_git_head, null); assert.equal(p.capacity.refunded, false);
});
test("M1 both absent refs retain missing commit identity rather than inventing pins", () => {
  const s = authorize(ready());
  for (const o of s.operations) append(s, r => { if (o.kind === "ref") { r.http.status = 404; r.json = r.data = null; } });
  const p = plan(s); assert.ok(p.pin_proposals.every(v => v.peeled_commit === null && v.commit_tree === null));
  assert.equal(p.proposals.length, 0); assert.equal(p.model_state, "DISCOVERY_OBSERVED_PARTIAL");
});
test("M1 aliases resolving to different commits stop instead of choosing an alias", () => {
  const s = subject(); Object.assign(s.graph[0], { availability: "present", expected_type: "commit", expected_target: commits[0] });
  Object.assign(s.graph[1], { availability: "present", expected_type: "commit", expected_target: "f".repeat(40) });
  const r = authorize(ready(s)); for (let i = 0; i < 4; i++) append(r);
  refuses(r, "ambiguous_commit");
});
test("M1 lightweight aliases share a single exact commit request", () => {
  const s = finalSubject(); s.graph = s.graph.filter(n => n.kind !== "tag"); s.operations = s.operations.filter(o => o.kind !== "tag");
  for (const [i, name] of names.entries()) {
    const refs = s.graph.filter(n => n.package === name && n.kind === "ref");
    for (const n of refs) Object.assign(n, { availability: "present", expected_type: "commit", expected_target: commits[i] });
    s.graph.find(n => n.package === name && n.kind === "commit").parents = refs.map(n => ({ kind: "ref", key: n.key }));
  }
  const p = plan(observed(s)); assert.equal(p.model_state, "FINAL_METADATA_OBSERVED_UNREVIEWED"); assert.equal(p.records.length, 14);
});
test("M1 expected graph cycles are rejected independently of observation replay", () => {
  const s = subject(); s.mode = "objects"; const a = ids[0], b = "3".repeat(40);
  Object.assign(s.graph[0], { availability: "present", expected_type: "tag", expected_target: a });
  s.graph.push({ package: names[0], kind: "tag", key: a, availability: "present", expected_type: "tag", expected_target: b, tree_id: null,
    parents: [{ kind: "ref", key: versions[0] }, { kind: "tag", key: b }] },
    { package: names[0], kind: "tag", key: b, availability: "present", expected_type: "tag", expected_target: a, tree_id: null, parents: [{ kind: "tag", key: a }] });
  s.operations = [operation(names[0], "tag", a, "object")]; refuses(s, "graph_cycle");
});
for (const [name, mutate, reason] of [
  ["repository", r => r.data.repository = "other/stream-json", "response_identity"],
  ["object id", r => r.data.key = "9".repeat(40), "response_identity"],
  ["unexpected type", r => { r.data.target_type = "blob"; }, "object_target"],
  ["new target", r => r.data.target_id = "9".repeat(40), "graph_observation"],
]) test("M1 Git response " + name + " is bound to reviewed graph", () => {
  const s = authorize(ready(finalSubject())); for (let i = 0; i < 6; i++) append(s); append(s, mutate); refuses(s, reason);
});
test("M1 final fresh refs cannot replace reviewed unavailable or target identities", () => {
  const s = authorize(ready(finalSubject())); append(s); append(s); append(s, r => r.data.target_id = "9".repeat(40));
  refuses(s, "graph_observation");
});
test("M1 supplied gitHead is separate from raw body digest and peeled commit", () => {
  const s = authorize(ready()); append(s, r => r.data.git_head = "f".repeat(40)); append(s);
  append(s, r => { r.data.target_type = "commit"; r.data.target_id = commits[0]; }); refuses(s, "git_head_mismatch");
});
test("M1 unsupported integrity is hashed as a declaration and never normalized to a pin", () => {
  for (const value of [null, "sha1-invalid", "sha512- " + Buffer.alloc(64).toString("base64"), "sha512-" + "A".repeat(85) + "B=="]) {
    const s = authorize(ready()); append(s, r => r.data.declared_integrity = value); const p = plan(s);
    assert.equal(p.pin_proposals[0].proposed_integrity, null);
    assert.equal(p.pin_proposals[0].declared_integrity_sha256, value === null ? null : data.digest(value));
    assert.equal(p.pin_proposals[0].actual_package_sha256, null);
  }
});
for (const [name, change] of [
  ["raw hash", r => r.http.body_sha256 = other], ["body bytes", r => { r.http.body_bytes = "513"; r.http.content_length = "513"; r.http.wire_bytes = "593"; r.json.parsed_bytes = "513"; }],
  ["declaration", r => r.data.declared_integrity = null], ["JSON summary", r => r.json.nodes = 21],
]) test("M1 recheck " + name + " changes stop the final batch", () => {
  const s = authorize(ready(finalSubject())); for (let i = 0; i < 10; i++) append(s); append(s, change); refuses(s, "recheck_binding");
});
test("M1 unavailable-ref rechecks cannot quietly become available", () => {
  const s = authorize(ready(finalSubject())); for (let i = 0; i < 13; i++) append(s);
  append(s, r => { r.http.status = 200; r.json = { utf8: "strict_supplied", grammar: "strict_supplied", bom: false, duplicate_keys: false,
    root: "object", depth: 1, nodes: 1, keys: 1, scalar_bytes: "0", numeric_bytes: "0", parsed_bytes: "0" };
    r.data = responseData(s.operations[13], s); }); refuses(s, "graph_observation");
});
for (const [name, change] of [
  ["baseline", s => s.baseline.lock = s.observed_baseline.lock = other],
  ["profile", s => s.profiles.decoder = other], ["expiry", s => s.clock.expires_ns = "240000000000"],
  ["budget", s => s.budget.heap_bytes = "100000001"], ["buffer", s => s.memory[0].allocations.raw = "131073"],
  ["operation", s => s.operations[0].body_ceiling = "1025"], ["graph", s => s.graph[0].availability = "unavailable"],
  ["history", s => s.prior_reports.push({ attempt: "earlier-attempt", report_sha256: other, observed_requests: 6, source: "planning_hint" })],
  ["work", s => s.work.hash_passes = "2"],
]) test("M1 plan digest binds " + name + " before any supplied approval", () => {
  const s = ready(), p = plan(s); change(s); assert.notEqual(plan(s).plan_sha256, p.plan_sha256);
});
test("M1 strict data-only schemas refuse effects, unknown fields and misleading provenance", () => {
  for (const mutate of [s => s.execute = true, s => s.source = "actual_verified", s => s.destination = "disk",
    s => s.operations[0].method = "POST", s => s.operations[0].key = "*", s => s.graph[0].package = "other",
    s => s.profiles.runtime = "bad", s => s.clock.start_ns = "01", s => s.budget.heap_bytes = 5,
    s => s.prior_reports.push({ attempt: "old", report_sha256: h, observed_requests: 1, source: "actual_evidence" })]) {
    const s = edit(subject(), mutate); assert.throws(() => plan(s), /cc4a_invalid_input|b2m1_operation_key/);
  }
  let calls = 0; const s = subject(); Object.defineProperty(s, "approval", { enumerable: true, get() { calls++; return null; } });
  assert.throws(() => plan(s), { message: "cc4a_invalid_input" }); assert.equal(calls, 0);
});
test("M1 reports are detached, frozen and retain all actual authority denials", () => {
  const s = observed(), p = plan(s); s.records[0].data.git_head = null;
  assert.equal(p.pin_proposals[0].registry_git_head, commits[0]); assert.ok(Object.isFrozen(p.pin_proposals[0]));
  assert.throws(() => p.caps.attempts = 23, TypeError); assert.equal(plan().caps.attempts, 22);
  for (const [k, v] of Object.entries(data.flags())) assert.equal(p[k], k === "scope" ? "unsigned_metadata_acquisition_memory_only" : v);
});
function compile(text, entry = "planUnsignedMetadataAcquisition") {
  const tree = ts.createSourceFile("mutant.mjs", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(tree.parseDiagnostics.length, 0); let body = text;
  for (const n of Array.from(tree.statements).reverse()) if (ts.isImportDeclaration(n)) body = body.slice(0, n.getFullStart()) + body.slice(n.end);
  body = body.replace(/\bexport function /g, "function ");
  const env = { z, uint: data.uint, hash: data.digestSchema, label: data.label, count: data.count, parse: data.parse,
    canonical: data.canonical, digest: data.digest, byteLength: data.byteLength, freeze: data.freeze, flags: data.flags, Buffer };
  assert.ok(["planUnsignedMetadataAcquisition", "minimumWire"].includes(entry));
  return vm.compileFunction(body + "\nreturn " + entry + ";", Object.keys(env))(...Object.values(env));
}
const gateMutations = [
  ['o.url !== locator(o)', 'false', () => edit(ready(), s => s.operations[0].url += "?x=1"), "operation_url"],
  ['d.observed_baseline[k] !== d.baseline[k]', 'false', () => edit(ready(), s => s.observed_baseline.lock = other), "manual_baseline_change"],
  ['known > BigInt(ceiling)', 'false', () => edit(ready(), s => s.budget.hash_work_bytes = "6143"), "hash_work_bound"],
  ['BigInt(m.allocations[k]) < floors[k]', 'false', () => edit(ready(), s => s.memory[0].allocations.raw = "1023"), "memory_floor"],
  ['known > BigInt(d.budget.heap_bytes)', 'false', () => edit(ready(), s => s.budget.heap_bytes = "1048575"), "memory_bound"],
  ['a.used || d.prior_reports.some(r => r.attempt === a.attempt)', 'false', () => edit(observed(subject(), 1), s => s.approval.used = true), "approval_replay"],
  ['a.plan_sha256 !== planHash', 'false', () => edit(observed(subject(), 1), s => s.approval.plan_sha256 = other), "approval_binding"],
  ['a.expires_ns !== d.clock.expires_ns', 'false', () => edit(observed(subject(), 1), s => s.approval.expires_ns = "241000000001"), "approval_clock"],
  ['r.previous_receipt_sha256 !== receipt', 'false', () => edit(observed(subject(), 1), s => s.records[0].previous_receipt_sha256 = other), "record_binding"],
  ['if (stopped) refuse("terminal_progress");', '', () => { const s = authorize(ready()); append(s, r => r.outcome = "cancelled"); append(s); return s; }, "terminal_progress"],
  ['(b.pairs ?? 0) > caps.header_pairs', 'false', () => edit(observed(subject(), 1), s => s.records[0].http.pairs = 65), "header_bound"],
  ['(b.deliveries ?? 0) > o.delivery_ceiling', 'false', () => { const s = observed(subject(), 1); s.records[0].http.deliveries = 11; updateUsage(s); return s; }, "delivery_bound"],
  ['b.timer_peak > caps.timers', 'false', () => edit(observed(subject(), 1), s => s.records[0].http.timer_peak = 4), "resource_peak"],
  ['(j.depth ?? 0) > caps.json_depth', 'false', () => edit(observed(subject(), 1), s => s.records[0].json.depth = 33), "json_bound"],
  ['j.duplicate_keys === true', 'false', () => edit(observed(subject(), 1), s => s.records[0].json.duplicate_keys = true), "json_policy", "STOPPED_UNKNOWN"],
  ['prior.http.body_sha256 !== r.http.body_sha256', 'false', () => { const s = authorize(ready(finalSubject())); for (let i = 0; i < 10; i++) append(s);
    append(s, r => r.http.body_sha256 = other); return s; }, "recheck_binding"],
];
for (const [index, [from, to, make, reason, state]] of gateMutations.entries()) test("M1 own-gate removal " + index, () => {
  assert.ok(source.includes(from), from);
  const changedSource = source.replace(from, to), original = compile(source), changed = compile(changedSource);
  for (const fn of [original, changed]) assert.equal(fn(ready()).model_state, "PLAN_ONLY");
  const s = make(); assert.throws(() => original(s), { message: "b2m1_" + reason });
  const p = changed(s); if (state) assert.equal(p.model_state, state);
});
test("M1 observed fifth-tag guard has an independent single-gate control", () => {
  const gate = 'if (tags.size > caps.tags_per_package) refuse("tag_cap");', index = source.lastIndexOf(gate);
  assert.notEqual(index, source.indexOf(gate));
  const original = compile(source), changed = compile(source.slice(0, index) + source.slice(index + gate.length));
  for (const fn of [original, changed]) assert.equal(fn(ready()).model_state, "PLAN_ONLY");
  assert.throws(() => original(observedFifthTag()), { message: "b2m1_tag_cap" });
  assert.equal(changed(observedFifthTag()).model_state, "AWAITING_EXACT_URL_REVIEW");
});
test("M1 review known wire bytes cannot vanish from the work floor", () => {
  const s = observed(subject(), 1); s.records[0].http.wire_bytes = "100000001";
  refuses(s, "wire_floor");
});
function parsedPartial(bytes) {
  const s = authorize(ready()); append(s, r => {
    r.outcome = "refused"; r.http.body_bytes = r.http.wire_bytes = null;
    r.http.complete = false; r.json.parsed_bytes = bytes; r.data = null;
  }); return s;
}
test("M1 review parsed bytes remain a known body floor with unknown reception", () => {
  const p = plan(parsedPartial("1024")); assert.equal(p.model_state, "REFUSED");
  assert.equal(p.capacity.body_consumed.known, "1024"); assert.equal(p.capacity.body_consumed.modeled, null);
  refuses(parsedPartial("1025"), "body_bound");
});
for (const field of ["dns_tls_ns", "inactivity_ns"]) test("M1 review " + field + " cannot exceed request duration", () => {
  const s = authorize(ready()); append(s, r => r.time[field] = "500000");
  assert.equal(plan(s).model_state, "DISCOVERY_OBSERVED_PARTIAL");
  s.records[0].time[field] = "500001"; refuses(s, "phase_duration");
});
test("M1 review wire ceiling, multi-record sum and refused bytes have exact controls", () => {
  const s = ready(); s.budget.wire_bytes = s.work.wire_bytes;
  authorize(s); append(s, r => r.http.wire_bytes = "30000000"); append(s, r => r.http.wire_bytes = "20000000");
  const p = plan(s); assert.equal(p.capacity.wire.known_consumed, "50000000");
  assert.equal(p.capacity.wire.modeled_consumed, "50000000"); assert.equal(p.capacity.wire.known_reserved, "50000000");
  s.records[1].http.wire_bytes = "20000001"; refuses(s, "wire_floor");
  const failed = authorize(ready()); append(failed, r => { r.outcome = "refused"; r.http.wire_bytes = "50000000"; });
  assert.equal(plan(failed).capacity.wire.known_consumed, "50000000"); assert.equal(plan(failed).model_state, "REFUSED");
});
test("M1 review unknown wire preserves known byte floors without claiming completeness", () => {
  const s = observed(subject(), 1); s.records[0].http.wire_bytes = null;
  const p = plan(s); assert.equal(p.model_state, "STOPPED_UNKNOWN");
  assert.equal(p.capacity.wire.known_consumed, "592"); assert.equal(p.capacity.wire.modeled_consumed, null);
  const q = plan(parsedPartial("1024")); assert.equal(q.capacity.wire.known_consumed, "1104");
  assert.equal(q.capacity.wire.modeled_consumed, null);
});
test("M1 review known body and parsed bytes overlap rather than being summed", () => {
  const s = observed(subject(), 1); assert.equal(plan(s).capacity.body_consumed.known, "512");
  append(s, r => { r.outcome = "refused"; r.http.body_bytes = r.http.wire_bytes = null; r.http.complete = false; r.json.parsed_bytes = "1024"; });
  const p = plan(s); assert.equal(p.capacity.body_consumed.known, "1536"); assert.equal(p.capacity.body_consumed.modeled, null);
  assert.equal(p.capacity.hash_work.known_reserved, "6144"); assert.equal(p.capacity.decode_work.known_reserved, "6144");
});
for (const [name, from, to, make, reason, state] of [
  ["wire records", "), consumed.wire);", "), 0n);", () => { const s = observed(subject(), 1); s.records[0].http.wire_bytes = "100000001"; return s; }, "wire_floor", "DISCOVERY_OBSERVED_PARTIAL"],
  ["parsed-byte floor", "BigInt(r.json?.parsed_bytes ?? 0)", "0n", () => parsedPartial("1025"), "body_bound", "REFUSED"],
  ["phase duration", "BigInt(v) > elapsed", "false", () => { const s = observed(subject(), 1); s.records[0].time.dns_tls_ns = "500001"; return s; }, "phase_duration", "DISCOVERY_OBSERVED_PARTIAL"],
]) test("M1 review isolated gate removal " + name, () => {
  assert.equal(source.split(from).length, 2); const original = compile(source), changed = compile(source.replace(from, to));
  for (const fn of [original, changed]) assert.equal(fn(observed(subject(), 1)).model_state, "DISCOVERY_OBSERVED_PARTIAL");
  assert.throws(() => original(make()), { message: "b2m1_" + reason }); assert.equal(changed(make()).model_state, state);
});
test("M1 review known unlisted usage cannot overlap an enumerated wire total", () => {
  const s = ready(); s.budget.wire_bytes = s.work.wire_bytes; authorize(s);
  append(s, r => r.http.wire_bytes = "50000000");
  Object.assign(s.usage[0], { attempted: 2, body_bytes: "1024", header_bytes: "160", deliveries: "2" });
  refuses(s, "wire_floor");
});
function wireResidual() {
  const s = ready(); s.budget.wire_bytes = s.work.wire_bytes; authorize(s);
  append(s, r => r.http.wire_bytes = "50000000"); return s;
}
test("M1 review enumerated counters have zero residual and one extra byte is charged", () => {
  const s = wireResidual(); assert.equal(plan(s).capacity.wire.known_consumed, "50000000");
  s.usage[0].body_bytes = "513"; refuses(s, "wire_floor");
});
test("M1 review distinct kinds contribute disjoint known wire residuals", () => {
  const s = ready(); s.work.wire_bytes = s.budget.wire_bytes = "50000002"; authorize(s);
  append(s, r => r.http.wire_bytes = "50000000");
  s.usage[0].body_bytes = "513"; Object.assign(s.usage[1], { attempted: 1, header_bytes: "1" });
  const p = plan(s); assert.equal(p.capacity.wire.known_consumed, "50000002");
  assert.equal(p.capacity.wire.modeled_consumed, null); assert.equal(p.model_state, "STOPPED_UNKNOWN");
  s.usage[1].header_bytes = "2"; refuses(s, "wire_floor");
});
test("M1 review unknown usage retains known residuals without inventing complete totals", () => {
  const s = ready(); s.work.wire_bytes = s.budget.wire_bytes = "50000001"; authorize(s);
  append(s, r => r.http.wire_bytes = "50000000"); s.usage[0].body_bytes = null;
  Object.assign(s.usage[1], { attempted: null, body_bytes: "1", header_bytes: null, deliveries: null });
  const p = plan(s); assert.equal(p.capacity.wire.known_consumed, "50000001");
  assert.equal(p.capacity.wire.modeled_consumed, null); assert.equal(p.capacity.body_consumed.known, "513");
  assert.equal(p.capacity.body_consumed.modeled, null);
});
test("M1 review removing only the unlisted-wire coupling loses the intended refusal", () => {
  const from = "return listed + extra;"; assert.equal(source.split(from).length, 2);
  const original = compile(source), changed = compile(source.replace(from, "return listed;"));
  for (const fn of [original, changed]) assert.equal(fn(wireResidual()).capacity.wire.known_consumed, "50000000");
  const s = wireResidual(); s.usage[0].body_bytes = "513";
  assert.throws(() => original(s), { message: "b2m1_wire_floor" }); assert.equal(changed(s).model_state, "STOPPED_UNKNOWN");
});
for (const field of ["body", "header", "both"]) test("M1 review same-kind unknown " + field + " may overlap listed wire", () => {
  const s = wireResidual();
  if (field !== "header") { s.records[0].http.body_bytes = null; s.records[0].json = s.records[0].data = null; }
  if (field !== "body") s.records[0].http.header_bytes = null;
  const p = plan(s); assert.equal(p.model_state, "STOPPED_UNKNOWN");
  assert.equal(p.capacity.wire.known_consumed, "50000000"); assert.equal(p.capacity.wire.modeled_consumed, null);
});
const wireRows = [
  { http: { body_bytes: null, header_bytes: "0", wire_bytes: "2" }, json: null },
  { http: { body_bytes: "0", header_bytes: null, wire_bytes: "2" }, json: null },
  { http: { body_bytes: null, header_bytes: null, wire_bytes: "1" }, json: null },
  { http: { body_bytes: "1", header_bytes: "1", wire_bytes: "3" }, json: null },
];
function enumeratedExtra(body, headers) {
  let best = body + headers;
  for (let b = 0; b <= 2; b++) for (let h = 0; h <= 2; h++) for (let sharedB = 0; sharedB <= 1; sharedB++) for (let sharedH = 0; sharedH <= 1; sharedH++) {
    if (sharedB + sharedH > 1 || b + sharedB > body || h + sharedH > headers) continue;
    best = Math.min(best, body + headers - b - h - sharedB - sharedH);
  }
  return BigInt(best);
}
const wireModel = compile(source, "minimumWire");
for (let b = 0; b <= 4; b++) for (let h = 0; h <= 4; h++) test("M1 review wire overlap matches independent enumeration " + b + "/" + h, () => {
  assert.equal(wireModel(wireRows, 1n + BigInt(b), 1n + BigInt(h)), 8n + enumeratedExtra(b, h));
});
for (const [name, from, to, b, h] of [
  ["body-only deficit", "extraBody - bodySlack - sharedSlack", "0n", 4n, 0n],
  ["header-only deficit", "extraHeaders - headerSlack - sharedSlack", "0n", 0n, 4n],
  ["joint deficit", "extraBody + extraHeaders - bodySlack - headerSlack - sharedSlack", "0n", 3n, 3n],
  ["shared space twice", "sharedSlack += slack;", "sharedSlack += 2n * slack;", 3n, 3n],
]) test("M1 review isolated overlap constraint " + name, () => {
  assert.equal(source.split(from).length, 2); const mutant = compile(source.replace(from, to), "minimumWire");
  assert.equal(wireModel(wireRows, 1n, 1n), 8n); assert.equal(mutant(wireRows, 1n, 1n), 8n);
  assert.equal(wireModel(wireRows, 1n + b, 1n + h), 9n); assert.equal(mutant(wireRows, 1n + b, 1n + h), 8n);
});
test("M1 independent required sinks precede safe probes", () => {
  const required = [[fs, "readSync"], [fs, "read"], [fs, "readv"], [fs, "readvSync"], [fs, "createReadStream"], [fs, "writeSync"], [net, "Socket"], [net, "Server"], [server, "listen"], [socket, "connect"], [datagram, "bind"], [child, "spawn"], [workers, "MessageChannel"], [crypto, "sign"], [crypto, "createPrivateKey"], [process, "dlopen"], [process, "getBuiltinModule"], [globalThis, "Date"], [Date, "now"], [process.hrtime, "bigint"], [timers, "setTimeout"]];
  required.push([JSON, "parse"], [fs, "open"], [fsp, "open"], ...["lchmod", "lchown"].flatMap(k => [[fs, k], [fs, k + "Sync"], [fsp, k]]).filter(([o, k]) => typeof o[k] === "function"));
  for (const [o, k] of required) assert.ok(blocked.some(([x, y]) => x === o && y === k), k);
  const before = effects.length; for (const [o, k] of blocked) assert.throws(() => o[k](), /b2m1_forbidden_effect/);
  assert.equal(effects.length, before + blocked.length); effects.length = before; assert.equal(escapedRead, 0);
});
test("M1 JSON parse denial is registered before any parsing probe", () => {
  assert.ok(blocked.some(([o, k]) => o === JSON && k === "parse"));
  const before = effects.length, { parse: alias } = JSON;
  for (const fn of [alias, JSON["parse"], JSON[`parse`]]) assert.throws(() => fn(), /b2m1_forbidden_effect/);
  assert.equal(effects.length, before + 3); effects.length = before; assert.equal(escapedParse, 0);
});
test("M1 no denied effect was swallowed", () => assert.deepEqual(effects, []));
