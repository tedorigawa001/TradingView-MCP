import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import dgram from "node:dgram";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import tls from "node:tls";
import dns from "node:dns";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import inspector from "node:inspector";
import inspectorPromises from "node:inspector/promises";
import v8 from "node:v8";
import nodeModule, { syncBuiltinESMExports } from "node:module";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const sqlite = await import("node:sqlite").then(m => m.default, () => null);
const effects = [], restores = [], blocked = [], listenerPrototype = net.Server.prototype, datagramPrototype = dgram.Socket.prototype;
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k);
  Object.defineProperty(o, k, { value: f, configurable: true, writable: true, enumerable: d?.enumerable ?? true });
  restores.push(() => d ? Object.defineProperty(o, k, d) : delete o[k]);
};
const block = (o, keys) => keys.filter(k => typeof o[k] === "function").forEach(k => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("c2a_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]);
block(workers, ["Worker", "MessageChannel", "BroadcastChannel"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "randomBytes", "randomUUID", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(listenerPrototype, ["listen"]); block(datagramPrototype, ["bind"]);
block(net, ["connect", "createConnection", "createServer", "Server"]); block(net.Socket.prototype, ["connect"]);
block(dgram, ["createSocket", "Socket"]); block(tls, ["connect", "createServer"]);
for (const o of [http, https]) block(o, ["request", "get", "createServer"]);
block(http2, ["connect", "createServer", "createSecureServer"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]); block(inspectorPromises, ["open", "Session"]); block(v8, ["writeHeapSnapshot"]); block(process.report, ["writeReport"]);
block(globalThis, ["fetch", "WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "clearImmediate", "queueMicrotask"]);
block(AbortSignal, ["timeout"]); if (sqlite) block(sqlite, ["Database", "DatabaseSync", "backup"]);
block(timers, ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"]);
block(timerPromises, ["setTimeout", "setInterval", "setImmediate"]); block(timerPromises.scheduler, ["wait", "yield"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map(k => k + "Sync"), ...scans, ...scans.map(k => k + "Sync"), "createWriteStream", "ReadStream", "WriteStream", "FileReadStream", "FileWriteStream", "Utf8Stream", "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "../../node_modules/"].map(s => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map(s => fs.realpathSync(s) + sep));
const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink", "realpath"];
for (const [o, k, flag] of [[fs, "open", a => a[0]], [fs, "openSync", a => a[0]], [fsp, "open", a => a[0]],
  [fs, "readFile", a => a[0]?.flag], [fs, "readFileSync", a => a[0]?.flag], [fsp, "readFile", a => a[0]?.flag],
  [fs, "createReadStream", a => a[0]?.flags], [fs, "exists", () => undefined], [fs, "existsSync", () => undefined],
  ...metadata.flatMap(k => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]])]) {
  if (typeof o[k] !== "function") continue;
  const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some(r => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("c2a_forbidden_read");
  });
}
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const deny = name => function () { effects.push(name); throw Error("c2a_forbidden_effect"); };
  const f = Object.assign(deny(k), Object.fromEntries(statics.map(n => [n, deny(n)])));
  replace(o, k, f); blocked.push([o, k], ...statics.map(n => [f, n]));
}
block(process, ["uptime", "cpuUsage", "resourceUsage"]); block(performance, ["now"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

const startup = await import("../helpers/unsignedWorkerStartupContracts.mjs");
const wire = await import("../helpers/unsignedControllerWireContracts.mjs");
const data = await import("../helpers/unsignedControllerData.mjs");
const parent = await import("../helpers/unsignedControllerContracts.mjs");
const recipes = await import("../helpers/jointUnsignedAcceptanceContracts.mjs");
const qualification = await import("../helpers/unsignedCohortQualificationContracts.mjs");
const { createUnsignedIsolatedTypeScript } = await import("../helpers/unsignedIsolatedTypeScript.mjs");
const { z } = await import("zod");
const ts = createUnsignedIsolatedTypeScript(fs.readFileSync(new URL("../../node_modules/typescript/lib/typescript.js", import.meta.url), "utf8"));
const { planUnsignedWorkerStartup: plan, validateUnsignedWorkerStartupEnvelope: check, describeUnsignedWorkerStartupCapacity: capacity } = startup;
const { canonical, digest, byteLength } = data, h = "a".repeat(64), clone = v => JSON.parse(JSON.stringify(v));
const request = { schema: "native-bar-unsigned-acceptance-request-v1", stage: "C-C1a", run_id: "invented-run", source_commit: "a".repeat(40), patch_sha256: h };
const uuid = n => "00000000-0000-4000-8000-" + String(n).padStart(12, "0");
function allocation(case_id = "u1-unsigned", mode = "normal") {
  return { fixture: { request, case_id, mode, ids: Object.fromEntries(["fixture", "store", "epoch", "authority", "key", "reference", "extra"].map((k, i) => [k, uuid(i + 1)])) },
    exchange_id: "exchange-1", launch_nonce: "nonce-1", source_tree_sha256: h, signature_profile: "linker_adhoc",
    artifacts: Object.fromEntries(Object.keys(wire.artifactSchema.shape).map(k => [k, h])) };
}
function subject(case_id, mode) {
  const b = parent.createUnsignedControllerProtocolModel(allocation(case_id, mode)).describe().binding;
  return { binding: b, expected: { mode: b.mode, binding_sha256: digest(b), closed_set_sha256: h, module_set_sha256: h, build_record_sha256: h },
    clock: { clock_domain: "worker-clock", started_ns: "0", local_end_ns: "900000000000" },
    components: Object.fromEntries(["record_reader", "closed_set", "module_initialization", "metadata_host_profile", "native_profile", "work_plan"].map(k => [k, "matched_supplied"])),
    manifest: { rows: 8, pages: 1, page_rows: 8, page_bytes: 4096, manifest_bytes: 4096, record_bytes: 8192, file_bytes: "65536" },
    work: { case_count: 24, modes: ["normal", "ubsan"].map(mode => ({ mode, startups: 12, record_bytes: "8192", module_bytes: "65536", pin_bytes: "65536", metadata_hash_bytes: "4096", helper_commands: 8 })),
      other_hash_bytes: "1000", other_helper_commands: 4 }, handoff: null };
}
const ready = b => ({ addon_protocol: 6, mode: "synthetic_only", pins_sha256: digest(b), worker_clock_domain: "worker-clock" });
const failed = () => ({ phase: "launch", primary_code: "invented_failure", close_errors: [], diagnostic_sha256: null, resources: null, query_created: false, instrumentation_overflow: false });
function handoffSubject() {
  const s = subject(); s.handoff = { binding_sha256: digest(s.binding), ready_payload: ready(s.binding), write_return: false,
    callback: "completed", decision: "completed", status_closed: false, status_error: null, pending_prepare: { bytes: 65536, sha256: h } };
  return s;
}
function envelope(kind = "LAUNCH", s = subject()) {
  return { line: canonical({ binding: s.binding, direction: kind === "LAUNCH" || kind === "PREPARE" ? "parent" : "worker", ordinal: 1, kind,
    payload: kind === "READY" ? ready(s.binding) : kind === "FAILED" ? failed() : {} }) + "\n",
    expected: { kind, direction: kind === "LAUNCH" || kind === "PREPARE" ? "parent" : "worker", next_ordinal: 1,
      frames_spent: kind === "LAUNCH" ? 0 : 1, binding: s.binding, worker_clock_domain: "worker-clock" }, reserved_hash_bytes: String(8 * 65536) };
}
const setup = { fixture_name: "native-bar-fs-synthetic-Ab123Z", recipe_sha256: h, registration_sha256: h, envelope_sha256: h };
function setupFailure() {
  const d = envelope("FAILED");
  d.expected.binding = { ...d.expected.binding, setup }; d.expected.next_ordinal = 2; d.expected.frames_spent = 3;
  const f = JSON.parse(d.line); f.binding = clone(d.expected.binding); f.ordinal = 2; f.payload.phase = "prepare";
  d.line = canonical(f) + "\n"; return d;
}
function prepareEnvelope() {
  const d = envelope("PREPARE"); d.expected.next_ordinal = 2; d.expected.frames_spent = 2;
  const f = JSON.parse(d.line); f.ordinal = 2; f.binding.setup = setup; f.payload = { launch_nonce: f.binding.launch_nonce, configuration: { invented: "x".repeat(59985) } };
  d.line = canonical(f) + "\n"; return d;
}
// The same frame and caller context with a setup-bearing binding on both sides, as if the initial LAUNCH carried setup.
function withSetup(d) {
  const v = clone(d), f = JSON.parse(v.line); v.expected.binding = { ...v.expected.binding, setup }; f.binding = clone(v.expected.binding);
  if (f.kind === "READY") f.payload.pins_sha256 = digest(f.binding);
  v.line = canonical(f) + "\n"; return v;
}
const withheldSubject = () => edit(handoffSubject(), v => Object.assign(v.handoff, { write_return: null, callback: "pending", decision: "withheld", pending_prepare: null }));
// Moves a frame and its caller context to another ordinal and shared spent count.
const at = (d, ordinal, spent) => editFrame(edit(d, v => { v.expected.next_ordinal = ordinal; v.expected.frames_spent = spent; }), f => f.ordinal = ordinal);
const incompletePlans = [["unavailable component", v => v.components.record_reader = "unavailable"], ["refused component", v => v.components.native_profile = "refused"],
  ["unknown hash cost", v => v.work.modes[1].module_bytes = null], ["unknown helper cost", v => v.work.other_helper_commands = null]];
const changedBases = [["run", f => f.binding.run_id = "foreign-run"], ["mode", f => f.binding.mode = "ubsan"], ["artifact", f => f.binding.addon_sha256 = "b".repeat(64)],
  ["template", f => f.binding.template_sha256 = "b".repeat(64)], ["binding nonce", f => f.binding.launch_nonce = "nonce-2"]];
const edit = (input, f) => { const v = clone(input); f(v); return v; };
const editFrame = (d, f) => edit(d, v => { const frame = JSON.parse(v.line); f(frame); v.line = canonical(frame) + "\n"; });
const noAuthority = v => { assert.equal(v.native_status, "NOT_RUN"); for (const [k, value] of Object.entries(data.flags())) if (typeof value === "boolean") assert.equal(v[k], false, k); assert.ok(Object.isFrozen(v)); };

test("C2a supplied completeness never grants runtime or record-reader authority", () => {
  const s = subject(), p = plan(s); noAuthority(p); assert.equal(p.supplied_plan_complete, true);
  assert.equal(p.runtime_producers, "unavailable"); assert.equal(p.template_preimage, "deferred_to_c3");
  assert.equal(plan(edit(s, v => v.components.record_reader = "unavailable")).supplied_plan_complete, false);
  assert.equal(capacity(s).record_reader_available, false);
});
for (const c of recipes.describeUnsignedAcceptanceRun(request).cases) test(`C2a exact plan binding ${c.mode}/${c.case_id}`, () => {
  const s = subject(c.case_id, c.mode), p = plan(s); assert.equal(p.mode, c.mode); assert.equal(p.binding_sha256, digest(s.binding)); noAuthority(p);
  const m = parent.createUnsignedControllerProtocolModel(allocation(c.case_id, c.mode));
  const launch = envelope("LAUNCH", s); check(launch); m.acceptFrame(launch.line); m.noteWrite({ ordinal: 1, outcome: "started" });
  const r = envelope("READY", s); check(r); assert.equal(m.acceptFrame(r.line).state, "READY");
});
test("C2a unknown work is explicit, known lower bounds still refuse and input stays unchanged", () => {
  const s = subject(), saved = canonical(s), q = qualification.describeUnsignedQualificationProfile();
  const p = plan(edit(s, v => { v.work.modes[1].module_bytes = null; v.work.other_helper_commands = null; }));
  assert.equal(p.modeled_hash_bytes, null); assert.equal(p.modeled_helper_commands, null); assert.equal(p.blockers.length, 2);
  assert.ok(BigInt(p.known_hash_bytes) > 0n); assert.equal(canonical(s), saved);
  assert.throws(() => plan(edit(s, v => { v.work.modes[0].module_bytes = q.hash_work_bytes; v.work.modes[1].pin_bytes = null; })), /work_bound/);
  assert.throws(() => plan(edit(s, v => v.work.modes[0].helper_commands = q.helper_commands)), /work_bound/);
});
test("C2a costs include 24 startup and 32 shared frame reservations per start", () => {
  const s = subject(), p = plan(s);
  assert.equal(p.modeled_hash_bytes, String(24 * (4 * 65536 + 32 * 8 * 65536 + 8192 + 65536 + 65536 + 4096) + 1000));
  assert.equal(p.modeled_helper_commands, 196); assert.equal(p.starts_per_mode, 12);
});
test("C2a hash/helper equality fits, a single extra byte/command refuses", () => {
  const s = subject(), p = plan(s), hashRemainder = 2147483648n - BigInt(p.modeled_hash_bytes) + 1000n;
  s.work.other_hash_bytes = String(hashRemainder); s.work.other_helper_commands = 131072 - 192;
  assert.equal(plan(s).modeled_hash_bytes, "2147483648"); assert.equal(plan(s).modeled_helper_commands, 131072);
  assert.throws(() => plan(edit(s, v => v.work.other_hash_bytes = String(hashRemainder + 1n))), /work_bound/);
  assert.throws(() => plan(edit(s, v => v.work.other_helper_commands++)), /work_bound/);
});
for (const [name, mutate] of [
  ["plan", v => v.binding.plan_sha256 = h], ["case", v => v.binding.case_id = "unknown-case"], ["mode", v => v.expected.mode = "ubsan"],
  ["digest", v => v.expected.binding_sha256 = "b".repeat(64)], ["record", v => v.expected.build_record_sha256 = "b".repeat(64)],
  ["extra binding", v => v.binding.extra = true], ["extra subject", v => v.approved = true], ["clock end", v => v.clock.local_end_ns = "999999"],
  ["clock overflow", v => { v.clock.started_ns = "9".repeat(30); v.clock.local_end_ns = "9".repeat(30); }],
  ["duplicate mode", v => v.work.modes[1].mode = "normal"], ["starts", v => v.work.modes[0].startups = 11],
  ["rows", v => v.manifest.rows = 9], ["page bytes", v => v.manifest.page_bytes = 1], ["record bytes", v => v.work.modes[0].record_bytes = "8193"],
  ["file bytes", v => v.manifest.file_bytes = "67108865"]]) test(`C2a strict subject refuses ${name}`, () => {
  const s = edit(subject(), mutate); if (name === "plan" || name === "case" || name === "extra binding") s.expected.binding_sha256 = digest(s.binding);
  assert.throws(() => plan(s));
});
test("C2a local preparation end is original and never renewed", () => {
  const s = subject(); assert.equal(plan(s).clock.preparation_end_ns, "120000000000");
  assert.equal(plan(edit(s, v => v.clock.local_end_ns = "1000000")).clock.preparation_end_ns, "1000000");
});
test("C2a handoff requires callback and known boolean including backpressure", () => {
  const s = handoffSubject();
  assert.equal(plan(s).supplied_handoff_complete, true);
  for (const mutate of [v => { v.handoff.write_return = null; v.handoff.decision = "pending"; },
    v => { v.handoff.callback = "pending"; v.handoff.decision = "pending"; }, v => v.handoff.status_closed = true,
    v => v.handoff.status_error = "pipe_error"]) assert.equal(plan(edit(s, mutate)).supplied_handoff_complete, false);
  for (const mutate of [v => v.handoff.write_return = null, v => v.handoff.callback = "pending", v => v.handoff.decision = "withheld",
    v => v.handoff.ready_payload.worker_clock_domain = "foreign", v => v.handoff.binding_sha256 = "b".repeat(64)]) assert.throws(() => plan(edit(s, mutate)));
  noAuthority(plan(s));
});
for (const decision of ["pending", "uncertain"]) test(`C2a decision-only ${decision} cannot complete an otherwise healthy handoff`, () => {
  const s = handoffSubject(), d = edit(s, v => v.handoff.decision = decision);
  assert.equal(plan(s).supplied_handoff_complete, true);
  assert.equal(canonical({ ...d.handoff, decision: "completed" }), canonical(s.handoff));
  const p = plan(d); assert.equal(p.supplied_plan_complete, true); assert.equal(p.supplied_handoff_complete, false); noAuthority(p);
});
for (const kind of ["LAUNCH", "READY", "FAILED"]) test(`C2a shared codec and parent agree for ${kind}`, () => {
  const s = subject(), d = envelope(kind, s), f = wire.readUnsignedControllerFrame(d.line), view = check(d);
  noAuthority(view); assert.equal(view.kind, f.kind); assert.equal(view.bytes, byteLength(d.line)); assert.equal(view.line_sha256, data.sha(d.line));
  if (kind !== "LAUNCH") { const m = parent.createUnsignedControllerProtocolModel(allocation()); const l = envelope(); m.acceptFrame(l.line); m.noteWrite({ ordinal: 1, outcome: "started" }); m.acceptFrame(d.line); }
});
test("C2a failures consume reserved hash even when decode/binding/payload refuses", () => {
  for (const d of [edit(envelope(), v => v.line = "{}\n"), editFrame(envelope(), f => f.binding.run_id = "foreign"), editFrame(envelope(), f => f.payload = { unexpected: true })]) {
    assert.throws(() => check(d), e => { assert.deepEqual(e.startup_work, { charged_hash_bytes: "524288", refunded: false }); return true; });
  }
  assert.throws(() => check(edit(envelope(), v => v.reserved_hash_bytes = "524287")), /wire_reservation/);
});
for (const [name, mutate] of [
  ["extra frame", f => f.extra = true], ["wrong direction", f => f.direction = "worker"], ["ordinal", f => f.ordinal = 2],
  ["extra binding", f => f.binding.extra = true], ["wrong source", f => f.binding.source_commit = "b".repeat(40)],
  ["missing artifact", f => delete f.binding.addon_sha256], ["payload", f => f.payload.extra = true], ["kind", f => f.kind = "GO"]])
  test(`C2a parent parity on refused LAUNCH ${name}`, () => {
    const d = editFrame(envelope(), mutate); assert.throws(() => check(d)); assert.throws(() => parent.createUnsignedControllerProtocolModel(allocation()).acceptFrame(d.line));
  });
test("C2a bytes/encoding/shared frame limit stay strict", () => {
  for (const line of [envelope().line.trimEnd(), " " + envelope().line, envelope().line.replace("invented-run", "\ud800"), "x".repeat(65537), "\u00e9".repeat(32769), '{"x":1,"x":2}\n']) assert.throws(() => check(edit(envelope(), v => v.line = line)));
  assert.throws(() => check(edit(envelope("READY"), v => v.expected.frames_spent = 32)), /frame_capacity/);
  assert.equal(check(edit(envelope("READY"), v => v.expected.frames_spent = 31)).frames_after, 32);
});
test("C2a shared outer decoder accepts exactly 65536 canonical bytes, never one more", () => {
  const f = { binding: {}, direction: "parent", ordinal: 1, kind: "LAUNCH", payload: { pad: "" } };
  f.payload.pad = "x".repeat(65536 - byteLength(canonical(f) + "\n"));
  const line = canonical(f) + "\n"; assert.equal(byteLength(line), 65536); assert.equal(wire.readUnsignedControllerFrame(line).ordinal, 1);
  assert.throws(() => wire.readUnsignedControllerFrame(line.replace('"pad":"x', '"pad":"xx')), /byte_bound/);
  assert.throws(() => check(edit(envelope(), v => v.line = line)));
});
test("C2a READY and FAILED keep payload/pins/domain and pre-GO phase strict", () => {
  for (const change of [f => f.payload.pins_sha256 = "b".repeat(64), f => f.payload.worker_clock_domain = "foreign",
    f => f.payload.addon_protocol = 5, f => f.payload.extra = true]) {
    const d = editFrame(envelope("READY"), change); assert.throws(() => check(d));
    const m = parent.createUnsignedControllerProtocolModel(allocation()); m.acceptFrame(envelope().line); m.noteWrite({ ordinal: 1, outcome: "started" });
    // Parent learns a valid worker domain from READY; the C2 check compares against its supplied original local domain.
    if (JSON.parse(d.line).payload.worker_clock_domain === "foreign") assert.equal(m.acceptFrame(d.line).worker_clock_domain, "foreign");
    else assert.throws(() => m.acceptFrame(d.line));
  }
  for (const change of [f => f.payload.phase = "go", f => f.payload.query_created = true, f => f.payload.extra = true,
    f => f.payload.close_errors = Array(9).fill("err")]) assert.throws(() => check(editFrame(envelope("FAILED"), change)));
});
test("C2a setup-bearing FAILED accepts exact prepare binding, never launch or stale setup", () => {
  const d = setupFailure(), result = check(d); noAuthority(result);
  assert.equal(result.payload.phase, "prepare"); assert.equal(result.binding_sha256, digest(d.expected.binding));
  assert.throws(() => check(editFrame(d, f => f.payload.phase = "launch")), /failure_binding/);
  assert.throws(() => check(editFrame(d, f => f.binding.setup = null)), /wire_binding/);
  assert.throws(() => check(editFrame(d, f => f.binding.setup.registration_sha256 = "b".repeat(64))), /wire_binding/);
  assert.throws(() => check(edit(d, v => v.expected.binding.setup = null)), /wire_binding/);
});
test("C2a PREPARE is opaque pending C3, never a fixture/bootstrap grant", () => {
  const d = prepareEnvelope(), result = check(d); noAuthority(result);
  assert.equal(result.classification, "pending_c3_validation"); assert.equal(result.payload, null); assert.ok(result.configuration_bytes <= 60000);
  assert.throws(() => check(editFrame(d, v => v.payload.configuration.invented += "xx")), /prepare_payload/);
  assert.throws(() => check(editFrame(d, v => v.payload.launch_nonce = "foreign")), /prepare_payload/);
  assert.throws(() => check(editFrame(d, v => v.binding.setup = null)), /prepare_binding/);
});
test("C2a commit review: PREPARE keeps the exact LAUNCH base binding apart from setup", () => {
  const d = prepareEnvelope(); assert.equal(check(d).classification, "pending_c3_validation");
  // The payload nonce stays original, so only the base binding comparison can refuse these.
  for (const [name, change] of changedBases) assert.throws(() => check(editFrame(d, change)), /prepare_binding/, name);
});
test("C2a commit review: LAUNCH, READY and the startup subject require the initial null setup", () => {
  for (const kind of ["LAUNCH", "READY"]) { assert.equal(check(envelope(kind)).kind, kind); assert.throws(() => check(withSetup(envelope(kind))), new RegExp(kind.toLowerCase() + "_binding")); }
  const s = subject(); s.binding = { ...s.binding, setup }; s.expected.binding_sha256 = digest(s.binding);
  assert.throws(() => plan(s), /subject_binding/);
});
test("C2a commit review: supplied frame context must name the first LAUNCH and the frame's kind and direction", () => {
  assert.throws(() => check(edit(envelope(), v => v.expected.frames_spent = 1)), /launch_binding/);
  assert.throws(() => check(edit(envelope("READY"), v => v.expected.kind = "FAILED")), /wire_order/);
  assert.throws(() => check(edit(envelope("READY"), v => v.expected.direction = "parent")), /wire_direction/);
});
test("C2a commit review: handoff stays incomplete while any supplied plan input is incomplete", () => {
  const s = handoffSubject(); assert.equal(plan(s).supplied_handoff_complete, true);
  // Each case changes one plan input only; the handoff itself stays healthy.
  for (const [name, change] of incompletePlans) {
    const p = plan(edit(s, change)); assert.equal(p.supplied_plan_complete, false, name); assert.equal(p.supplied_handoff_complete, false, name); noAuthority(p);
  }
});
test("C2a commit review: handoff READY pins must name the original binding", () => {
  assert.throws(() => plan(edit(handoffSubject(), v => v.handoff.ready_payload.pins_sha256 = "b".repeat(64))), /handoff_binding/);
});
test("C2a commit review: a withheld READY cannot carry a pending PREPARE", () => {
  const withheld = withheldSubject(), p = plan(withheld); assert.equal(p.supplied_handoff_complete, false); assert.equal(p.pending_prepare, null);
  // PREPARE follows observed READY bytes, so it cannot exist after a READY that was never started.
  assert.throws(() => plan(edit(withheld, v => v.handoff.pending_prepare = { bytes: 100, sha256: h })), /handoff_outcome/);
  assert.equal(plan(edit(withheld, v => { v.handoff.decision = "pending"; v.handoff.pending_prepare = { bytes: 100, sha256: h }; })).pending_prepare.bytes, 100);
});
test("C2a commit review: a withheld READY has neither a write return nor a callback", () => {
  assert.throws(() => plan(edit(withheldSubject(), v => v.handoff.write_return = false)), /handoff_outcome/);
  assert.throws(() => plan(edit(withheldSubject(), v => v.handoff.callback = "completed")), /handoff_outcome/);
});
test("C2a commit review: manifest bytes above record bytes and an overflowing preparation end refuse on their own", () => {
  assert.throws(() => plan(edit(subject(), v => { v.manifest.record_bytes = 4095; for (const m of v.work.modes) m.record_bytes = "4095"; })), /manifest_work/);
  // The local end stays well after the start, so only the 120 s preparation end overflows the 30-digit ceiling.
  assert.throws(() => plan(edit(subject(), v => { v.clock.started_ns = "999999999999999999880000000000"; v.clock.local_end_ns = "9".repeat(30); })), /clock_subject/);
});
test("C2a commit review: READY, FAILED and PREPARE need frame counts a startup can reach", () => {
  for (const d of [envelope("READY"), envelope("FAILED"), at(envelope("FAILED"), 2, 2), setupFailure(), prepareEnvelope()]) assert.doesNotThrow(() => check(d));
  for (const [name, d, reason] of [["READY as worker frame 2", at(envelope("READY"), 2, 2), /ready_binding/], ["READY before LAUNCH", at(envelope("READY"), 1, 0), /ready_binding/],
    ["FAILED before LAUNCH", at(envelope("FAILED"), 1, 0), /failure_binding/], ["FAILED 2 before READY", at(envelope("FAILED"), 2, 1), /failure_binding/],
    ["FAILED 3", at(envelope("FAILED"), 3, 3), /failure_binding/], ["setup FAILED 1", at(setupFailure(), 1, 3), /failure_binding/],
    ["setup FAILED before PREPARE", at(setupFailure(), 2, 2), /failure_binding/], ["PREPARE 3", at(prepareEnvelope(), 3, 3), /prepare_binding/],
    ["PREPARE before READY", at(prepareEnvelope(), 2, 1), /prepare_binding/]]) assert.throws(() => check(d), reason, name);
});
test("C2a commit review: frame ordinal must equal the expected next ordinal, and LAUNCH is ordinal 1", () => {
  assert.throws(() => check(edit(envelope("READY"), v => v.expected.next_ordinal = 2)), /wire_order/);
  assert.throws(() => check(at(envelope(), 2, 0)), /launch_binding/);
});
test("C2a commit review: unknown keys refuse at every supplied level", () => {
  for (const [name, d] of [["envelope", edit(envelope(), v => v.extra = 1)], ["expected", edit(envelope(), v => v.expected.extra = 1)],
    ["PREPARE payload", editFrame(prepareEnvelope(), f => f.payload.extra = 1)]]) assert.throws(() => check(d), /invalid_input/, name);
  assert.throws(() => plan(edit(handoffSubject(), v => v.handoff.extra = 1)), /invalid_input/);
});
test("C2a commit review: one unknown cost nulls only its own modeled total", () => {
  const known = plan(subject()), helper = plan(edit(subject(), v => v.work.other_helper_commands = null)), hash = plan(edit(subject(), v => v.work.modes[1].module_bytes = null));
  assert.equal(helper.modeled_hash_bytes, known.modeled_hash_bytes); assert.equal(helper.modeled_helper_commands, null);
  assert.equal(hash.modeled_hash_bytes, null); assert.equal(hash.modeled_helper_commands, known.modeled_helper_commands);
});
test("C2a capacity is bounded supplied geometry, not a parent-wrapper or runtime proof", () => {
  const s = subject(), cap = capacity(s); noAuthority(cap);
  assert.equal(cap.retained_buffer_bytes, 393216); assert.equal(cap.transient_buffer_bytes, 4259840);
  assert.equal(cap.parent_wrapper_calculated, false); assert.equal(cap.full_record_retained, false);
  assert.ok(cap.diagnostic_ceiling_bytes <= 16384); assert.equal(cap.diagnostic_ceiling_bytes, byteLength(canonical({ plan: cap.maximal_plan, envelope: cap.maximal_envelope })));
  const cover = (v, m) => { assert.ok(byteLength(canonical(v)) <= byteLength(canonical(m))); if (v && m && typeof v === "object" && !Array.isArray(v)) {
    assert.deepEqual(Object.keys(v).sort(), Object.keys(m).sort()); for (const k of Object.keys(v)) cover(v[k], m[k]); } };
  for (const mode of ["normal", "ubsan"]) cover(plan(subject(undefined, mode)), cap.maximal_plan);
  for (const kind of ["LAUNCH", "READY", "FAILED"]) {
    const v = check(envelope(kind)); cover({ ...v, payload: null }, { ...cap.maximal_envelope, payload: null });
    if (v.payload !== null) cover(v.payload, cap.maximal_payloads[kind]);
    assert.ok(byteLength(canonical(v)) <= byteLength(canonical(cap.maximal_envelope)));
  }
});
test("C2a maximal pending/failure/unknown projections fit actual diagnostic fields", t => {
  const s = subject(), l = "l".repeat(48), u = "9".repeat(30), c = "c".repeat(96);
  s.binding = { ...s.binding, run_id: l, exchange_id: l, launch_nonce: l };
  s.binding.plan_sha256 = recipes.describeUnsignedAcceptanceRun({ ...request, run_id: l }).plan_sha256;
  s.expected.binding_sha256 = digest(s.binding); s.clock = { clock_domain: l, started_ns: "0", local_end_ns: u };
  for (const k of Object.keys(s.components)) s.components[k] = "unavailable";
  for (const m of s.work.modes) for (const k of ["record_bytes", "module_bytes", "pin_bytes", "metadata_hash_bytes", "helper_commands"]) m[k] = null;
  s.work.other_hash_bytes = null; s.work.other_helper_commands = null;
  s.handoff = { binding_sha256: digest(s.binding), ready_payload: { ...ready(s.binding), worker_clock_domain: l }, write_return: null, callback: "uncertain", decision: "uncertain",
    status_closed: true, status_error: c, pending_prepare: { bytes: 65536, sha256: h } };
  const p = plan(s), cap = capacity(s), d = envelope("FAILED", s), f = JSON.parse(d.line);
  f.payload = { ...cap.maximal_payloads.FAILED, phase: "launch" }; d.line = canonical(f) + "\n"; d.expected.worker_clock_domain = l;
  const v = check(d); assert.equal(p.supplied_plan_complete, false); assert.equal(p.supplied_handoff_complete, false);
  assert.equal(p.blockers.length, 18); assert.ok(byteLength(canonical(p)) <= byteLength(canonical(cap.maximal_plan)));
  assert.ok(byteLength(canonical(v)) <= byteLength(canonical(cap.maximal_envelope)));
  t.diagnostic(JSON.stringify({ diagnostic_bytes: cap.diagnostic_ceiling_bytes, retained_bytes: cap.retained_buffer_bytes, transient_bytes: cap.transient_buffer_bytes,
    frames: cap.frame_kind_ceilings, modeled_hash_bytes: plan(subject()).modeled_hash_bytes }));
});
test("C2a hostile accessors are never called and capacities use the copied subject", () => {
  let calls = 0; const s = subject(); Object.defineProperty(s.expected, "mode", { enumerable: true, get() { calls++; return "normal"; } });
  assert.throws(() => plan(s)); assert.throws(() => capacity(s)); assert.equal(calls, 0);
});

const helperSource = fs.readFileSync(new URL("../helpers/unsignedWorkerStartupContracts.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const dependencies = { z, ...data, ...wire, ...recipes, ...qualification };
function compile(source, overrides = {}) {
  const tree = ts.createSourceFile("candidate.mjs", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS); assert.equal(tree.parseDiagnostics.length, 0);
  const imports = Array.from(tree.statements.filter(n => n.importClause)).flatMap(n => Array.from(n.importClause.namedBindings.elements));
  const names = imports.map(e => e.name.text);
  const body = tree.statements.filter(n => !n.importClause).map(n => n.getText().replace(/^export\s+/, "")).join("\n");
  return vm.compileFunction('"use strict";\n' + body + '\nreturn {planUnsignedWorkerStartup,validateUnsignedWorkerStartupEnvelope,describeUnsignedWorkerStartupCapacity};', names)(...imports.map(e => ({ ...dependencies, ...overrides })[e.propertyName?.text ?? e.name.text]));
}
test("C2a reservation precedes shared decode and the full debit survives its failure", () => {
  let calls = 0; const original = compile(helperSource, { readUnsignedControllerFrame: () => { calls++; throw Error("invented_decode_failure"); } });
  assert.throws(() => original.validateUnsignedWorkerStartupEnvelope(edit(envelope(), v => v.reserved_hash_bytes = "0")), /wire_reservation/); assert.equal(calls, 0);
  assert.throws(() => original.validateUnsignedWorkerStartupEnvelope(envelope()), e => {
    assert.equal(e.message, "invented_decode_failure"); assert.deepEqual(e.startup_work, { charged_hash_bytes: "524288", refunded: false }); return true;
  }); assert.equal(calls, 1);
});
test("C2a commit review: exhausted shared frames refuse before any reservation or decode", () => {
  const exhausted = (line, reserved = "524288") => edit(envelope("READY"), v => { v.line = line; v.expected.frames_spent = 32; v.reserved_hash_bytes = reserved; });
  for (const line of [envelope("READY").line, "{}\n", "x".repeat(65535) + "\n"]) for (const reserved of ["0", "524288"])
    assert.throws(() => check(exhausted(line, reserved)), e => { assert.match(e.message, /frame_capacity/); assert.equal(e.startup_work, undefined); return true; });
  let calls = 0; const decode = { readUnsignedControllerFrame: (...a) => { calls++; return wire.readUnsignedControllerFrame(...a); } };
  const strict = m => { for (const reserved of ["0", "524288"]) {
    calls = 0; assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(exhausted("{}\n", reserved)), e => {
      assert.match(e.message, /frame_capacity/); assert.equal(e.startup_work, undefined); return true; }); assert.equal(calls, 0);
  } };
  strict(compile(helperSource, decode));
  const early = '  if (expected.frames_spent >= LIMITS.frames) refuse("frame_capacity");\n', decoded = 'f = readUnsignedControllerFrame(d.line);\n';
  const reserve = '  if (BigInt(d.reserved_hash_bytes) < BigInt(wireCharge)) refuse("wire_reservation");\n', open = '  try {\n';
  for (const s of [early, decoded, early + reserve, open]) assert.equal(helperSource.split(s).length, 2, s);
  // Each wrong placement is compiled first, so only its behavior can fail the strict check; fba58d5 checked after the decode.
  for (const [name, candidate] of [["after decode", compile(helperSource.replace(early, "").replace(decoded, decoded + early), decode)],
    ["after reservation", compile(helperSource.replace(early + reserve, reserve + early), decode)],
    ["charged inside the try", compile(helperSource.replace(early, "").replace(open, open + "  " + early), decode)]])
    assert.throws(() => strict(candidate), { code: "ERR_ASSERTION" }, name);
});
test("C2a exhausted subject work refuses before binding or acceptance-plan hashing", () => {
  let calls = 0; const overrides = { digest: (...a) => { calls++; return digest(...a); },
    describeUnsignedAcceptanceRun: (...a) => { calls++; return recipes.describeUnsignedAcceptanceRun(...a); } };
  const original = compile(helperSource, overrides);
  for (const mutate of [v => v.work.other_hash_bytes = "2147483648", v => v.work.other_helper_commands = 131072]) {
    const s = edit(subject(), mutate); assert.throws(() => original.planUnsignedWorkerStartup(s), /work_bound/); assert.equal(calls, 0);
  }
  assert.equal(original.planUnsignedWorkerStartup(subject()).supplied_plan_complete, true); assert.ok(calls > 0);
  const changed = compile(helperSource.replace('  work(d);', '  void 0;'), overrides); calls = 0;
  assert.throws(() => changed.planUnsignedWorkerStartup(edit(subject(), v => v.work.other_hash_bytes = "2147483648")), /work_bound/);
  assert.throws(() => assert.equal(calls, 0), { code: "ERR_ASSERTION" });
});
test("C2a independent mutation controls detect missing binding/work/handoff/frame gates", () => {
  const control = compile(helperSource); assert.equal(control.planUnsignedWorkerStartup(subject()).supplied_plan_complete, true);
  const trials = [
    ['digest(b) !== d.expected.binding_sha256', 'false', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(subject(), v => v.expected.binding_sha256 = "b".repeat(64))))],
    ['hashBytes > BigInt(profile.hash_work_bytes)', 'false', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(subject(), v => v.work.other_hash_bytes = "2147483648")))],
    ['h.write_return === null)', 'false)', m => { const s = subject(); s.handoff = { binding_sha256: digest(s.binding), ready_payload: ready(s.binding), write_return: null, callback: "completed", decision: "completed", status_closed: false, status_error: null, pending_prepare: null }; assert.throws(() => m.planUnsignedWorkerStartup(s)); }],
    ['h.decision === "completed" && h.callback === "completed"', 'h.callback === "completed"', m => {
      for (const decision of ["pending", "uncertain"]) assert.equal(m.planUnsignedWorkerStartup(edit(handoffSubject(), v => v.handoff.decision = decision)).supplied_handoff_complete, false);
    }],
    ['(b.setup === null ? "launch" : "prepare")', '"launch"', m => assert.doesNotThrow(() => m.validateUnsignedWorkerStartupEnvelope(setupFailure()))],
    ['expected.frames_spent >= LIMITS.frames', 'false', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope("READY"), v => v.expected.frames_spent = 32)))],
    ['payload.worker_clock_domain !== expected.worker_clock_domain', 'false', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(editFrame(envelope("READY"), f => f.payload.worker_clock_domain = "foreign")))],
    // Commit review: gates that no single-condition test isolated in fba58d5.
    // One trial per case, so every case is shown to depend on the removed gate.
    ...incompletePlans.map(([, change]) => ['complete && h && ', 'h && ', m => assert.equal(m.planUnsignedWorkerStartup(edit(handoffSubject(), change)).supplied_handoff_complete, false)]),
    ...changedBases.map(([, change]) => ['|| canonical({ ...fb, setup: null }) !== canonical(b)', '', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(editFrame(prepareEnvelope(), change)), /prepare_binding/)]),
    ['if (b.setup !== null || f.ordinal !== 1', 'if (f.ordinal !== 1', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(withSetup(envelope())), /launch_binding/)],
    ['if (b.setup !== null || payload.pins_sha256', 'if (payload.pins_sha256', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(withSetup(envelope("READY"))), /ready_binding/)],
    ['if (b.setup !== null || b.mode !== d.expected.mode', 'if (b.mode !== d.expected.mode', m => {
      const s = subject(); s.binding = { ...s.binding, setup }; s.expected.binding_sha256 = digest(s.binding); assert.throws(() => m.planUnsignedWorkerStartup(s), /subject_binding/);
    }],
    [' || h.ready_payload.pins_sha256 !== d.expected.binding_sha256', '', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(handoffSubject(), v => v.handoff.ready_payload.pins_sha256 = "b".repeat(64))), /handoff_binding/)],
    [' || expected.frames_spent !== 0', '', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope(), v => v.expected.frames_spent = 1)), /launch_binding/)],
    ['f.kind !== expected.kind || ', '', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope("READY"), v => v.expected.kind = "FAILED")), /wire_order/)],
    [' || expected.direction !== direction', '', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope("READY"), v => v.expected.direction = "parent")), /wire_direction/)],
    [' || h.pending_prepare !== null', '', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(withheldSubject(), v => v.handoff.pending_prepare = { bytes: 100, sha256: h })), /handoff_outcome/)],
    ['h.write_return !== null || h.callback !== "pending" || h.pending_prepare', 'h.callback !== "pending" || h.pending_prepare',
      m => assert.throws(() => m.planUnsignedWorkerStartup(edit(withheldSubject(), v => v.handoff.write_return = false)), /handoff_outcome/)],
    [' || h.callback !== "pending" || h.pending_prepare', ' || h.pending_prepare',
      m => assert.throws(() => m.planUnsignedWorkerStartup(edit(withheldSubject(), v => v.handoff.callback = "completed")), /handoff_outcome/)],
    ['\n    || m.manifest_bytes > m.record_bytes', '', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(subject(), v => {
      v.manifest.record_bytes = 4095; for (const w of v.work.modes) w.record_bytes = "4095"; })), /manifest_work/)],
    ['start + BigInt(LIMITS.preparation_ms) * 1000000n > max || ', '', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(subject(), v => {
      v.clock.started_ns = "999999999999999999880000000000"; v.clock.local_end_ns = "9".repeat(30); })), /clock_subject/)],
    [' || f.ordinal !== expected.next_ordinal', '', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope("READY"), v => v.expected.next_ordinal = 2)), /wire_order/)],
    ['f.ordinal !== 1 || expected.frames_spent !== 0', 'expected.frames_spent !== 0', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(at(envelope(), 2, 0)), /launch_binding/)],
    // Reachable frame counts for READY, FAILED and PREPARE.
    ...[['f.ordinal !== 1 || expected.frames_spent < 1', 'expected.frames_spent < 1', () => at(envelope("READY"), 2, 2), /ready_binding/],
      [' || expected.frames_spent < 1', '', () => at(envelope("READY"), 1, 0), /ready_binding/],
      [' || f.ordinal > 2', '', () => at(envelope("FAILED"), 3, 3), /failure_binding/],
      [' || b.setup !== null && f.ordinal !== 2', '', () => at(setupFailure(), 1, 3), /failure_binding/],
      ['(b.setup === null ? 0 : 1)', '0', () => at(setupFailure(), 2, 2), /failure_binding/],
      ['\n          || expected.frames_spent < f.ordinal + (b.setup === null ? 0 : 1)', '', () => at(envelope("FAILED"), 1, 0), /failure_binding/],
      ['\n          || expected.frames_spent < f.ordinal + (b.setup === null ? 0 : 1)', '', () => at(envelope("FAILED"), 2, 1), /failure_binding/],
      ['f.ordinal !== 2 || expected.frames_spent < 2', 'expected.frames_spent < 2', () => at(prepareEnvelope(), 3, 3), /prepare_binding/],
      [' || expected.frames_spent < 2', '', () => at(prepareEnvelope(), 2, 1), /prepare_binding/]]
      .map(([from, to, input, reason]) => [from, to, m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(input()), reason)]),
    // Strict schemas and per-total cost attribution.
    ['reserved_hash_bytes: uint }).strict();', 'reserved_hash_bytes: uint });', m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope(), v => v.extra = 1)), /invalid_input/)],
    ['worker_clock_domain: label }).strict(), reserved_hash_bytes', 'worker_clock_domain: label }), reserved_hash_bytes',
      m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(edit(envelope(), v => v.expected.extra = 1)), /invalid_input/)],
    ['launch_nonce: label }).strict(), f.payload)', 'launch_nonce: label }), f.payload)',
      m => assert.throws(() => m.validateUnsignedWorkerStartupEnvelope(editFrame(prepareEnvelope(), f => f.payload.extra = 1)), /invalid_input/)],
    ['.strict().nullable() }).strict();', '.strict().nullable() });', m => assert.throws(() => m.planUnsignedWorkerStartup(edit(handoffSubject(), v => v.handoff.extra = 1)), /invalid_input/)],
    ['modeled_hash_bytes: blockers.some(k => !k.includes("helper_commands"))', 'modeled_hash_bytes: blockers.length > 0',
      m => assert.notEqual(m.planUnsignedWorkerStartup(edit(subject(), v => v.work.other_helper_commands = null)).modeled_hash_bytes, null)],
    ['modeled_helper_commands: blockers.some(k => k.includes("helper_commands"))', 'modeled_helper_commands: blockers.length > 0',
      m => assert.notEqual(m.planUnsignedWorkerStartup(edit(subject(), v => v.work.modes[1].module_bytes = null)).modeled_helper_commands, null)]
  ];
  for (const [from, to, assertion] of trials) { assert.equal(helperSource.split(from).length, 2, from); assertion(control); const candidate = compile(helperSource.replace(from, to)); assert.throws(() => assertion(candidate), { code: "ERR_ASSERTION" }, from); }
});
test("C2a forbidden primitives are guarded without acquiring real resources", () => {
  const before = effects.length;
  const requiredSinks = [[net, "Server"], [dgram, "Socket"], [listenerPrototype, "listen"], [datagramPrototype, "bind"],
    [net, "createServer"], [net.Socket.prototype, "connect"], [dgram, "createSocket"], [tls, "connect"],
    [workers, "Worker"], [workers, "MessageChannel"], [workers, "BroadcastChannel"], [child, "spawn"], [process, "dlopen"],
    [crypto, "sign"], [crypto, "createPrivateKey"], [crypto, "createPublicKey"], [fs, "rmSync"], [fsp, "rm"],
    [globalThis, "Date"], [Date, "now"], [process, "hrtime"], [process.hrtime, "bigint"], [performance, "now"],
    [globalThis, "setTimeout"], [timers, "setTimeout"], [timerPromises, "setTimeout"]];
  for (const [o, k] of requiredSinks) assert.ok(blocked.some(([target, name]) => target === o && name === k), "required guard: " + k);
  for (const [o, k] of blocked) assert.throws(() => o[k](), /c2a_forbidden_effect/);
  for (const f of [() => listenerPrototype.listen.call(Object.create(null)), () => datagramPrototype.bind.call(Object.create(null)), () => fs.readFileSync("/private/tmp/not-opened")]) assert.throws(f, /c2a_forbidden/);
  assert.equal(effects.length, before + blocked.length + 3); effects.length = before;
});
test("C2a no denied effect was swallowed", () => assert.deepEqual(effects, []));
