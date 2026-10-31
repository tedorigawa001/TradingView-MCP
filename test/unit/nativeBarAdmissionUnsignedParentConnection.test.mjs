import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import fsp from "node:fs/promises";
import crypto from "node:crypto";
import child from "node:child_process";
import workers from "node:worker_threads";
import net from "node:net";
import http from "node:http";
import https from "node:https";
import http2 from "node:http2";
import dgram from "node:dgram";
import tls from "node:tls";
import dns from "node:dns";
import inspector from "node:inspector";
import inspectorPromises from "node:inspector/promises";
import v8 from "node:v8";
import timers from "node:timers";
import timerPromises from "node:timers/promises";
import nodeModule, { syncBuiltinESMExports } from "node:module";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Node 20 has no node:sqlite; where present it is denied with the other builtins.
const sqlite = await import("node:sqlite").then(m => m.default, () => null);
const effects = [], restores = [], blocked = [];
const replace = (o, k, f) => {
  const d = Object.getOwnPropertyDescriptor(o, k), accessor = d && !("value" in d);
  if (accessor) Object.defineProperty(o, k, { value: f, configurable: true, writable: true, enumerable: d.enumerable }); else o[k] = f;
  restores.push(() => { if (accessor) Object.defineProperty(o, k, d); else if (d) o[k] = d.value; else delete o[k]; });
};
const block = (o, keys) => keys.filter(k => typeof o[k] === "function").forEach(k => {
  blocked.push([o, k]); replace(o, k, function () { effects.push(k); throw Error("cc4b3b_forbidden_effect"); });
});
block(child, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork", "ChildProcess"]); block(workers, ["Worker", "MessageChannel", "BroadcastChannel"]);
block(crypto, ["sign", "verify", "createSign", "createVerify", "createPrivateKey", "createPublicKey", "createSecretKey", "generateKey", "generateKeySync",
  "generateKeyPair", "generateKeyPairSync", "privateEncrypt", "privateDecrypt", "publicEncrypt", "publicDecrypt", "diffieHellman", "createDiffieHellman", "createECDH", "randomBytes",
  "Sign", "Verify", "DiffieHellman", "DiffieHellmanGroup", "ECDH", "getDiffieHellman", "createDiffieHellmanGroup"]);
block(crypto.webcrypto.subtle, ["sign", "verify", "generateKey", "importKey", "exportKey", "deriveKey", "deriveBits", "encrypt", "decrypt", "wrapKey", "unwrapKey"]);
block(process, ["dlopen", "kill", "chdir", "execve", "binding", "_linkedBinding", "getBuiltinModule", "loadEnvFile"]);
block(net, ["connect", "createConnection", "createServer"]); block(net.Socket.prototype, ["connect"]);
block(http, ["request", "get", "createServer"]); block(https, ["request", "get", "createServer"]); block(http2, ["connect", "createServer", "createSecureServer"]);
block(dgram, ["createSocket"]); block(tls, ["connect", "createServer"]);
block(globalThis, ["fetch", "WebSocket", "EventSource", "MessageChannel", "BroadcastChannel", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "setImmediate", "queueMicrotask"]);
block(AbortSignal, ["timeout"]); block(process.report, ["writeReport"]); block(v8, ["writeHeapSnapshot"]);
if (sqlite) block(sqlite, ["Database", "DatabaseSync", "backup"]);
// syncBuiltinESMExports never reaches node:-only builtins, so their named imports are refused at resolution instead.
const resolution = sqlite && typeof nodeModule.registerHooks === "function" ? nodeModule.registerHooks({ resolve(specifier, context, next) {
  if (specifier === "node:sqlite") { effects.push(specifier); throw Error("cc4b3b_forbidden_effect"); } return next(specifier, context); } }) : null;
if (resolution) restores.push(() => resolution.deregister());
block(timers, ["setTimeout", "setInterval", "setImmediate", "clearTimeout", "clearInterval", "clearImmediate"]);
block(timerPromises, ["setTimeout", "setInterval", "setImmediate"]); block(timerPromises.scheduler, ["wait", "yield"]);
block(Date, ["now"]); block(process.hrtime, ["bigint"]);
for (const o of [dns, dns.promises]) block(o, Object.keys(o).filter(k => /^(lookup|resolve|reverse)/.test(k)));
block(inspector, ["open", "Session"]); block(inspectorPromises, ["open", "Session"]);
const mutations = ["writeFile", "appendFile", "copyFile", "cp", "truncate", "ftruncate", "mkdir", "mkdtemp", "unlink", "rmdir", "rm", "rename",
  "chmod", "fchmod", "lchmod", "chown", "fchown", "lchown", "symlink", "link", "utimes", "futimes", "lutimes"];
const streams = ["ReadStream", "FileReadStream", "WriteStream", "FileWriteStream", "Utf8Stream"], scans = ["glob", "statfs", "watch", "mkdtempDisposable"];
block(fs, [...mutations, ...mutations.map(k => k + "Sync"), "createWriteStream", ...streams, ...scans, ...scans.map(k => k + "Sync"), "openAsBlob", "watchFile"]);
block(fsp, [...mutations, ...scans]);
const roots = ["../helpers/", "../../node_modules/"].map(s => fileURLToPath(new URL(s, import.meta.url)));
roots.push(...roots.map(s => fs.realpathSync(s) + sep));
const metadata = ["stat", "lstat", "readdir", "opendir", "access", "readlink", "realpath"];
const readers = [[fs, "open", a => a[0]], [fs, "openSync", a => a[0]], [fs, "readFile", a => a[0]?.flag], [fs, "readFileSync", a => a[0]?.flag],
  [fs, "createReadStream", a => a[0]?.flags], [fs, "exists", () => undefined], [fs, "existsSync", () => undefined],
  ...metadata.flatMap(k => [[fs, k, () => undefined], [fs, k + "Sync", () => undefined], [fsp, k, () => undefined]]),
  [fsp, "open", a => a[0]], [fsp, "readFile", a => a[0]?.flag]];
for (const [o, k, flag] of readers) {
  if (typeof o[k] !== "function") continue; const original = o[k]; replace(o, k, (p, ...a) => {
    const full = resolve(p instanceof URL ? fileURLToPath(p) : String(p)), f = flag(a);
    if ((f === undefined || f === "r" || f === 0) && roots.some(r => full.startsWith(r))) return original.call(o, p, ...a);
    effects.push(k); throw Error("cc4b3b_forbidden_read");
  });
}
syncBuiltinESMExports();
test.after(() => { restores.reverse().forEach(f => f()); syncBuiltinESMExports(); assert.deepEqual(effects, []); });

// Replacing Date or hrtime would hide the earlier static guards, so each replacement carries its own recording statics.
for (const [o, k, statics] of [[globalThis, "Date", ["now"]], [process, "hrtime", ["bigint"]]]) {
  const record = name => function () { effects.push(name); throw Error("cc4b3b_forbidden_effect"); };
  const f = Object.assign(record(k), Object.fromEntries(statics.map(name => [name, record(name)])));
  replace(o, k, f); blocked.push([o, k], ...statics.map(name => [f, name]));
}
block(process, ["uptime", "cpuUsage", "resourceUsage"]); block(performance, ["now"]);
if (typeof Temporal === "object") block(Temporal.Now, Object.getOwnPropertyNames(Temporal.Now));


const parent = await import("../helpers/unsignedParentConnectionContracts.mjs");
const { canonical, flags } = await import("../helpers/unsignedControllerData.mjs");
const point = n => ({ clock_domain: "parent-clock", monotonic_ns: String(n) });
const input = (changes = {}) => ({ clock_domain: "parent-clock", planned_ns: "123", phase_deadline_ns: "9999999999", cohort_deadline_ns: "20000000000", ...changes });
test("B4-B1 reservation preserves the original whole-ms remainder without granting execution", () => {
  const r = parent.planUnsignedParentReservation(input());
  assert.equal(r.reservation.deadline_ns, "9999000123");
  assert.equal(r.operation_window_ms, "9999"); assert.equal(r.reservation.planned_ns, "123");
  assert.ok(Object.isFrozen(r.reservation));
  for (const [k, v] of Object.entries(flags())) if (typeof v === "boolean") assert.equal(r[k], false, k);
});
test("B4-B1 checkpoint relays the known command deadline before the later producer point", () => {
  const r = parent.planUnsignedParentReservation(input()).reservation;
  const v = parent.planUnsignedParentCheckpoint({ clock_domain: "parent-clock", last_b2_ns: "123", at: point(BigInt(r.deadline_ns) + 500n),
    phase_deadline_ns: "9999999999", cohort_deadline_ns: "20000000000", pending: { reservation: r, started: true }, stopped: false, clock_invalid: false });
  assert.equal(v.route, "stop_before_input"); assert.deepEqual(v.stop_first, { reason: "write_deadline", at: point(r.deadline_ns) });
  assert.deepEqual(v.forward_at, point(BigInt(r.deadline_ns) + 500n)); assert.equal(v.pending_expired, true);
});
test("B4-B1 callback keeps a timely uncertain observation distinct from its effective delivery", () => {
  const r = parent.planUnsignedParentReservation(input()).reservation;
  const v = parent.assessUnsignedParentCallback({ kind: "GO", reservation: r, last_ns: "123", at: point(124), started: true, callback_seen: false,
    previous_decision: "started", observed_outcome: "uncertain", stopped: true, shutdown: false, clock_invalid: false });
  assert.deepEqual(v.callback_at, point(124)); assert.equal(v.decision, "uncertain"); assert.equal(v.relay_outcome, "uncertain");
  assert.equal(v.stop_first, null); assert.equal(v.observed_outcome, "uncertain");
});
const terminal = () => ({ schema: "native-bar-parent-terminal-facts-v1", clock_domain: "parent-clock", first_stop: null, clock_invalid: false,
  launch: { reserved: false, attempted: false, returned: false }, pending_generation: null, commands: [], child: { error: null, exit: null, close: null },
  pipes: Object.fromEntries(["command", "status", "stdout", "stderr"].map(k => [k, { present: false, end_seen: false, finish_seen: false, close_seen: false, error: null }])),
  command_end: { decision: "not_requested", outcome: null }, timers: { phase: null, operation: null }, helper: { active: false, under_command_generation: null },
  discarded_input: { frames: 0, bytes: 0, saturated: false }, secondary_errors: [] });
test("B4-B1 fixed terminal facts are bounded data, not handles or execution evidence", () => {
  const dto = terminal(), v = parent.validateUnsignedParentTerminalFacts(dto); dto.pipes.command.present = true;
  assert.equal(v.facts.pipes.command.present, false); assert.equal(v.semantic_verified, false); assert.equal(v.execution_available, false);
  assert.ok(Object.isFrozen(v.facts.pipes));
  assert.throws(() => parent.validateUnsignedParentTerminalFacts({ ...terminal(), handle: {} }), /invalid_input/);
});
test("B4-B1 capacity charges the new fixed view without raising existing metadata or buffer limits", t => {
  const c = parent.describeUnsignedParentConnectionCapacity({ work_plan: null });
  assert.equal(c.coordinator_ceiling_bytes, 47087 + c.sidecar_ceiling_bytes); assert.ok(c.coordinator_ceiling_bytes <= 65536);
  assert.equal(c.sidecar_ceiling_bytes, Buffer.byteLength(canonical(c.maximal_shape_view)));
  assert.equal(c.work_plan_status, "unavailable"); assert.equal(c.runtime_work_qualified, false);
  assert.equal(c.retained_buffer_bytes, 2375680); assert.equal(c.transient_buffer_bytes, 4259840);
  t.diagnostic(`parent-sidecar=${c.sidecar_ceiling_bytes}, coordinator=${c.coordinator_ceiling_bytes}`);
});
test("B4-B1 producer requirements cannot be fulfilled by caller approval booleans", () => {
  const p = parent.describeUnsignedParentConnectionProfile();
  assert.equal(p.single_admission_owner, "b2_protocol_window"); assert.equal(p.original_reference_verified, false);
  assert.deepEqual(p.producer_blockers.CANCEL_ordinary, ["original_cancellation_decision_unavailable"]);
  assert.equal(p.execution_available, false); assert.equal(p.timer_slots, 2); assert.equal(p.builder_timer_must_be_empty, true);
});
test("B4-B1 guard recorders reject constructors and calls without performing an effect", async () => {
  for (const [o, k] of blocked) { const n = effects.length; assert.throws(() => new o[k](), /forbidden_effect/); assert.equal(effects.length, n + 1); effects.pop(); }
  if (resolution) { const n = effects.length; await assert.rejects(import("node:sqlite"), /forbidden_effect/); assert.deepEqual(effects.splice(n), ["node:sqlite"]); }
});
test("B4-B1 reservation arithmetic agrees with an independent finite full-ms calculation", () => {
  const max = 10n ** 30n - 1n;
  for (const plan of [0n, 123n, max - 30000000000n]) for (const left of [0n, 1n, 999999n, 1000000n, 1000001n, 10000999999n, 20000000000n])
    for (const cohortLeft of [999999n, 1000000n, 15000500123n, 30000000000n]) {
      const d = input({ planned_ns: String(plan), phase_deadline_ns: String(plan + left), cohort_deadline_ns: String(plan + cohortLeft) });
      const floor = (left < cohortLeft ? left : cohortLeft) / 1000000n, ms = floor > 10000n ? 10000n : floor;
      if (ms < 1n) assert.throws(() => parent.planUnsignedParentReservation(d), /reservation_remainder/);
      else {
        const v = parent.planUnsignedParentReservation(d); assert.equal(v.operation_window_ms, String(ms));
        assert.equal(v.reservation.deadline_ns, String(plan + ms * 1000000n));
      }
    }
});
for (const bad of [{ planned_ns: "01" }, { planned_ns: -1 }, { planned_ns: "1".repeat(31) }, { approved: true }, { phase_deadline_ns: "0" }])
  test("B4-B1 reservation rejects malformed, enlarged or exhausted inputs: " + canonical(bad), () => {
    assert.throws(() => parent.planUnsignedParentReservation(input(bad)), /invalid_input|reservation_remainder/);
  });
const checkpoint = changes => ({ clock_domain: "parent-clock", last_b2_ns: "123", at: point(124), phase_deadline_ns: "9999999999",
  cohort_deadline_ns: "20000000000", pending: { reservation: parent.planUnsignedParentReservation(input()).reservation, started: true },
  stopped: false, clock_invalid: false, ...changes });
for (const offset of [-1n, 0n, 1n, 500000000n]) for (const started of [false, true])
  test(`B4-B1 checkpoint exact deadline ${offset}, started=${started}`, () => {
    const d = checkpoint(), end = BigInt(d.pending.reservation.deadline_ns); d.at = point(end + offset); d.pending.started = started;
    const v = parent.planUnsignedParentCheckpoint(d), expired = offset >= 0n;
    assert.equal(v.route, expired ? "stop_before_input" : "normal"); assert.equal(v.pending_expired, expired);
    assert.equal(v.pending_disposition, expired && started ? "uncertain" : null);
    assert.deepEqual(v.stop_first, expired ? { reason: "write_deadline", at: point(end) } : null);
  });
for (const kind of ["phase", "cohort"]) test("B4-B1 checkpoint detects the original " + kind + " end without renewing it", () => {
  const d = checkpoint({ pending: null, phase_deadline_ns: kind === "phase" ? "1000" : "2000", cohort_deadline_ns: kind === "cohort" ? "1000" : "2000", at: point(1500) });
  const v = parent.planUnsignedParentCheckpoint(d); assert.deepEqual(v.stop_first, { reason: "deadline", at: point(1000) });
});
for (const [at, reason] of [[null, "clock_unavailable"], [{}, "clock_malformed"], [{ ...point(124), clock_domain: "foreign" }, "clock_domain"], [point(122), "clock_rollback"]])
  test("B4-B1 checkpoint uses a stop-only clock fault with no substitute timestamp: " + reason, () => {
    const v = parent.planUnsignedParentCheckpoint(checkpoint({ at })); assert.equal(v.route, "clock_failure");
    assert.deepEqual(v.stop_first, { reason, at: null }); assert.equal(v.forward_at, null);
  });
test("B4-B1 checkpoint refuses a late relay after B2 already saw the deadline", () => {
  const d = checkpoint(), end = BigInt(d.pending.reservation.deadline_ns);
  for (const last of [end, end + 500n]) assert.throws(() => parent.planUnsignedParentCheckpoint({ ...d, last_b2_ns: String(last), at: point(last + 1n) }), /checkpoint_order/);
  const stopped = parent.planUnsignedParentCheckpoint({ ...d, stopped: true, last_b2_ns: String(end), at: point(end + 1n) });
  assert.equal(stopped.stop_first, null); assert.equal(stopped.pending_disposition, "uncertain"); assert.equal(stopped.route, "terminal_only");
});
test("B4-B1 checkpoint cannot adopt a changed or foreign reservation or recover a latched clock", () => {
  const d = checkpoint();
  for (const r of [{ ...d.pending.reservation, deadline_ns: String(BigInt(d.pending.reservation.deadline_ns) + 1n) },
    { ...d.pending.reservation, clock_domain: "foreign" }, { ...d.pending.reservation, cohort_deadline_ns: "30000000000" }])
    assert.throws(() => parent.planUnsignedParentCheckpoint({ ...d, pending: { reservation: r, started: true } }), /reservation_changed|reservation_binding/);
  const v = parent.planUnsignedParentCheckpoint({ ...d, stopped: true, clock_invalid: true }); assert.equal(v.forward_at, null); assert.equal(v.stop_first, null);
  assert.throws(() => parent.planUnsignedParentCheckpoint({ ...d, clock_invalid: true }), /clock_state/);
});
const callback = changes => ({ kind: "GO", reservation: parent.planUnsignedParentReservation(input()).reservation, last_ns: "123", at: point(124), started: true,
  callback_seen: false, previous_decision: "started", observed_outcome: "completed", stopped: false, shutdown: false, clock_invalid: false, ...changes });
for (const stopped of [false, true]) for (const shutdown of [false, true]) for (const outcome of ["completed", "uncertain"])
  test(`B4-B1 callback observed=${outcome}, stopped=${stopped}, shutdown=${shutdown}`, () => {
    if (shutdown && !stopped) {
      assert.throws(() => parent.assessUnsignedParentCallback(callback({ kind: "CANCEL", stopped, shutdown, observed_outcome: outcome })), /shutdown_state/); return;
    }
    const v = parent.assessUnsignedParentCallback(callback({ kind: shutdown ? "CANCEL" : "GO", stopped, shutdown, observed_outcome: outcome }));
    const decision = stopped && !shutdown && outcome === "completed" ? "started" : outcome;
    assert.equal(v.decision, decision); assert.equal(v.relay_outcome, decision === "started" ? null : decision);
    assert.deepEqual(v.callback_at, point(124)); assert.equal(v.observed_outcome, outcome);
    assert.deepEqual(v.stop_first, !stopped && outcome === "uncertain" ? { reason: "pipe_uncertain", at: point(124) } : null);
  });
for (const stopped of [false, true]) test("B4-B1 expired callback remains uncertain without moving its trigger, stopped=" + stopped, () => {
  const d = callback({ stopped }), end = BigInt(d.reservation.deadline_ns); d.at = point(end + 500n);
  const v = parent.assessUnsignedParentCallback(d); assert.equal(v.decision, "uncertain"); assert.equal(v.callback_at, null);
  assert.deepEqual(v.observation_point, point(end + 500n)); assert.equal(v.relay_outcome, "uncertain");
  assert.deepEqual(v.stop_first, stopped ? null : { reason: "write_deadline", at: point(end) });
});
test("B4-B1 callbacks cannot repair prior uncertainty, invent a start or repeat a callback", () => {
  const v = parent.assessUnsignedParentCallback(callback({ stopped: true, previous_decision: "uncertain" }));
  assert.equal(v.decision, "uncertain"); assert.equal(v.relay_outcome, null); assert.deepEqual(v.callback_at, point(124));
  for (const bad of [{ started: false }, { callback_seen: true }]) assert.throws(() => parent.assessUnsignedParentCallback(callback(bad)), /callback_once/);
  assert.throws(() => parent.assessUnsignedParentCallback(callback({ last_ns: "1" })), /callback_binding/);
});
for (const [at, reason] of [[null, "clock_unavailable"], [{}, "clock_malformed"], [{ ...point(124), clock_domain: "foreign" }, "clock_domain"], [point(122), "clock_rollback"]])
  test("B4-B1 unqualified callback is a terminal fact, never a timed B2 relay: " + reason, () => {
    const v = parent.assessUnsignedParentCallback(callback({ at })); assert.equal(v.clock_failure, reason);
    assert.equal(v.callback_at, null); assert.equal(v.relay_outcome, null); assert.deepEqual(v.stop_first, { reason, at: null });
    const uncertain = parent.assessUnsignedParentCallback(callback({ at, observed_outcome: "uncertain", stopped: true }));
    assert.equal(uncertain.decision, "uncertain"); assert.equal(uncertain.stop_first, null); assert.equal(uncertain.relay_outcome, null);
  });
const commandFact = () => ({ kind: "LAUNCH", ordinal: 1, generation: 1, reservation: parent.planUnsignedParentReservation(input()).reservation,
  sha256: "a".repeat(64), bytes: 100, started: false, write_return_seen: false, backpressure: null, callback_seen: false,
  observed_outcome: null, callback_at: null, observation_point: null, decision: "planned", shutdown: false });
const timerFact = () => ({ owner: "command", command_generation: 1, generation: 1, segment: 1,
  deadline_ns: parent.planUnsignedParentReservation(input()).reservation.deadline_ns, referenced: true,
  active: true, cancel_attempted: false, clear_unknown: false });
test("B4-B1 a timed-out started write remains pending until its original callback", () => {
  const d = terminal(), c = { ...commandFact(), started: true, decision: "uncertain" };
  d.commands = [c]; d.pending_generation = 1;
  d.first_stop = { reason: "write_deadline", at: point(c.reservation.deadline_ns) };
  const v = parent.validateUnsignedParentTerminalFacts(d);
  assert.equal(v.facts.pending_generation, 1); assert.equal(v.facts.commands[0].callback_seen, false);
  assert.equal(v.facts.commands[0].decision, "uncertain");
  for (const mutate of [x => { x.commands[0].callback_seen = true; x.commands[0].observed_outcome = "completed"; },
    x => { x.commands[0].decision = "completed"; }, x => { x.first_stop = null; }]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => parent.validateUnsignedParentTerminalFacts(bad), /callback_facts|pending_facts/);
  }
});
for (const offset of [0n, 1n]) for (const stopped of [false, true])
  test(`B4-B1 expired callback facts match the effective assessor at D+${offset}, stopped=${stopped}`, () => {
    const c = { ...commandFact(), kind: "GO", started: true }, end = BigInt(c.reservation.deadline_ns), at = point(end + offset);
    const assessed = parent.assessUnsignedParentCallback(callback({ stopped, at }));
    const d = terminal(); d.first_stop = stopped ? { reason: "primary", at: point(124) } : assessed.stop_first;
    d.commands = [{ ...c, callback_seen: true, observed_outcome: assessed.observed_outcome, callback_at: assessed.callback_at,
      observation_point: assessed.observation_point, decision: assessed.decision }];
    assert.equal(parent.validateUnsignedParentTerminalFacts(d).facts.commands[0].decision, "uncertain");
    d.commands[0].decision = "started";
    assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /callback_facts/);
  });
test("B4-B1 end attempts require an original command pipe, including unknown return", () => {
  for (const outcome of [null, "returned", "unknown"]) {
    const d = terminal(); d.command_end = { decision: "attempted", outcome };
    assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /end_facts/);
    d.pipes.command.present = true;
    assert.equal(parent.validateUnsignedParentTerminalFacts(d).facts.command_end.outcome, outcome);
  }
  const withheld = terminal(); withheld.command_end.decision = "withheld";
  assert.equal(parent.validateUnsignedParentTerminalFacts(withheld).facts.command_end.decision, "withheld");
});
test("B4-B1 a pre-write helper shares the one original command timer, never a third timer", () => {
  const d = terminal(); d.commands = [commandFact()]; d.pending_generation = 1;
  d.timers.operation = timerFact(); d.helper = { active: true, under_command_generation: 1 };
  assert.equal(parent.validateUnsignedParentTerminalFacts(d).facts.timers.operation.command_generation, 1);
  for (const mutate of [d => { d.commands[0].started = true; d.commands[0].decision = "started"; }, d => { d.timers.operation = null; },
    d => { d.timers.qualification = timerFact(); }, d => { d.helper.under_command_generation = 2; }]) {
    const bad = structuredClone(d); mutate(bad); assert.throws(() => parent.validateUnsignedParentTerminalFacts(bad), /helper_facts|invalid_input/);
  }
});
for (const [name, mutate] of [
  ["six_commands", d => { d.commands = Array(6).fill(commandFact()); }], ["ninth_error", d => { d.secondary_errors = Array(9).fill("error"); }],
  ["unreserved_launch", d => { d.launch.attempted = true; }], ["unattempted_return", d => { d.launch.returned = true; }],
  ["foreign_stop", d => { d.first_stop = { reason: "primary", at: { ...point(1), clock_domain: "foreign" } }; }],
  ["pending_missing", d => { d.pending_generation = 1; }], ["end_not_attempted", d => { d.command_end.outcome = "returned"; }],
  ["phase_timer_owner", d => { d.timers.phase = timerFact(); }], ["unknown_without_clear", d => { d.timers.operation = { ...timerFact(), clear_unknown: true }; }],
  ["unsafe_segment", d => { d.timers.operation = { ...timerFact(), segment: Number.MAX_SAFE_INTEGER + 1 }; }],
  ["unbounded_bytes", d => { d.discarded_input.bytes = 2097154; }], ["unbounded_frames", d => { d.discarded_input.frames = 34; }],
]) test("B4-B1 terminal inventory refuses " + name, () => { const d = terminal(); mutate(d); assert.throws(() => parent.validateUnsignedParentTerminalFacts(d)); });
test("B4-B1 terminal commands check original reservation, ordinal and callback relationships", () => {
  for (const mutate of [d => { d.commands[0].generation = 2; }, d => { d.commands.push(commandFact()); },
    d => { d.commands[0].reservation = { ...d.commands[0].reservation, deadline_ns: "9999999999" }; }, d => { d.commands[0].callback_seen = true; },
    d => { d.commands[0].backpressure = true; }, d => { d.commands[0].decision = "completed"; }]) {
    const d = terminal(); d.commands = [commandFact()]; mutate(d); assert.throws(() => parent.validateUnsignedParentTerminalFacts(d));
  }
});
test("B4-B1 exact metadata capacity fits and one byte over blocks without new allowances", () => {
  const c = parent.describeUnsignedParentConnectionCapacity({}); assert.equal(c.sidecar_ceiling_bytes, 7654); assert.equal(c.coordinator_ceiling_bytes, 54741);
  const exact = 65536 - c.sidecar_ceiling_bytes;
  assert.equal(parent.describeUnsignedParentConnectionCapacity({ b2_coordinator_bytes: exact }).coordinator_ceiling_bytes, 65536);
  assert.throws(() => parent.describeUnsignedParentConnectionCapacity({ b2_coordinator_bytes: exact + 1 }), /metadata_capacity/);
  assert.throws(() => parent.describeUnsignedParentConnectionCapacity({ b2_coordinator_bytes: 47086 }), /invalid_input/);
  assert.equal(c.maximum_shape_only, true); assert.throws(() => parent.validateUnsignedParentTerminalFacts(c.maximal_shape_view.facts));
});
const work = () => ({ case_count: 24, coverage: "invocation_totals_including_repeated_cases", components: Object.fromEntries(
  ["qualification", "worker_startup", "case_checks", "wire_trace", "supervision"].map(k => [k, { hash_bytes: "0", helper_commands: 0 }])) });
test("B4-B1 known invocation totals use the unchanged exact work caps but never qualify runtime", () => {
  const w = work(); w.components.qualification = { hash_bytes: "2147483648", helper_commands: 131072 };
  const c = parent.describeUnsignedParentConnectionCapacity({ work_plan: w });
  assert.equal(c.work_plan_status, "complete_supplied_totals"); assert.equal(c.runtime_work_qualified, false); assert.equal(c.execution_available, false);
  assert.deepEqual(c.work_limits, { hash_bytes: "2147483648", helper_commands: 131072 });
  for (const cost of [{ hash_bytes: "1", helper_commands: 0 }, { hash_bytes: "0", helper_commands: 1 }]) {
    const over = structuredClone(w); over.components.wire_trace = cost;
    assert.throws(() => parent.describeUnsignedParentConnectionCapacity({ work_plan: over }), /work_capacity/);
  }
});
test("B4-B1 unknown work is retained as a blocker, including partially overspent plans", () => {
  const w = work(); w.components.worker_startup = null;
  const c = parent.describeUnsignedParentConnectionCapacity({ work_plan: w }); assert.equal(c.work_plan_status, "partial");
  assert.deepEqual(c.blockers, ["worker_startup_work_unavailable"]); assert.equal(c.runtime_work_qualified, false);
  w.components.qualification.hash_bytes = "2147483649";
  assert.throws(() => parent.describeUnsignedParentConnectionCapacity({ work_plan: w }), /work_capacity/);
  for (const changed of [{ ...work(), case_count: 1 }, { ...work(), coverage: "per_case" }])
    assert.throws(() => parent.describeUnsignedParentConnectionCapacity({ work_plan: changed }), /invalid_input/);
});
test("B4-B1 accessors, handles, callbacks and approval flags are not accepted as data authority", () => {
  let read = 0; const getter = Object.defineProperty({}, "clock_domain", { enumerable: true, get() { read++; throw Error("getter"); } });
  assert.throws(() => parent.planUnsignedParentReservation(getter), /invalid_input/); assert.equal(read, 0);
  for (const bad of [{ ...terminal(), stream: {} }, { ...terminal(), approved: true }, { ...terminal(), callback() {} }])
    assert.throws(() => parent.validateUnsignedParentTerminalFacts(bad), /invalid_input/);
  assert.deepEqual(parent.describeUnsignedParentConnectionProfile({ approved: true }), parent.describeUnsignedParentConnectionProfile());
});
test("B4-B1 a completed command needs its own known timely callback", () => {
  const d = terminal(); d.commands = [{ ...commandFact(), started: true, decision: "completed" }];
  assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /callback_facts/);
});
test("B4-B1 a command-owned timer cannot extend its original command reservation", () => {
  const d = terminal(); d.commands = [commandFact()]; d.pending_generation = 1;
  d.timers.operation = { ...timerFact(), deadline_ns: String(BigInt(d.commands[0].reservation.deadline_ns) + 1n) };
  assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /timer_facts/);
});
test("B4-B1 clock-invalid terminal facts must retain their primary stop", () => {
  const d = terminal(); d.clock_invalid = true; assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /clock_facts/);
});
test("B4-B1 shutdown callback rules are restricted to the original CANCEL kind", () => {
  assert.throws(() => parent.assessUnsignedParentCallback(callback({ kind: "GO", shutdown: true, stopped: true })), /shutdown_kind/);
});
test("B4-B1 a shutdown callback cannot claim the healthy ordinary lane", () => {
  assert.throws(() => parent.assessUnsignedParentCallback(callback({ kind: "CANCEL", shutdown: true })), /shutdown_state/);
});
test("B4-B1 a prior uncertain write must already have stopped the session", () => {
  assert.throws(() => parent.assessUnsignedParentCallback(callback({ previous_decision: "uncertain" })), /callback_state/);
});
test("B4-B1 discarded input counters saturate once without growing a history or claiming a full total", () => {
  const counter = { frames: 32, bytes: 2097152, saturated: false };
  const v = parent.summarizeUnsignedParentDiscard({ counter, frames: 1, bytes: 1 });
  assert.deepEqual(v.counter, { frames: 33, bytes: 2097153, saturated: true }); assert.equal(v.complete_supplied_count, false);
  const again = parent.summarizeUnsignedParentDiscard({ counter: v.counter, frames: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(again.counter, v.counter); assert.equal(again.execution_available, false);
});
test("B4-B1 discard counters preserve the exact cap and safely clamp a large supplied increment", () => {
  const zero = { frames: 0, bytes: 0, saturated: false };
  const exact = parent.summarizeUnsignedParentDiscard({ counter: zero, frames: 32, bytes: 2097152 });
  assert.equal(exact.complete_supplied_count, true); assert.equal(exact.counter.saturated, false);
  const huge = parent.summarizeUnsignedParentDiscard({ counter: zero, frames: Number.MAX_SAFE_INTEGER, bytes: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(huge.counter, { frames: 33, bytes: 2097153, saturated: true }); assert.deepEqual(zero, { frames: 0, bytes: 0, saturated: false });
  for (const frames of [-1, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parent.summarizeUnsignedParentDiscard({ counter: zero, frames, bytes: 0 }), /invalid_input/);
});
test("B4-B1 a saturation sentinel cannot be presented as a complete supplied count", () => {
  for (const c of [{ frames: 33, bytes: 0, saturated: false }, { frames: 0, bytes: 2097153, saturated: false }]) {
    assert.throws(() => parent.summarizeUnsignedParentDiscard({ counter: c, frames: 0, bytes: 0 }), /counter_facts/);
    const d = terminal(); d.discarded_input = c; assert.throws(() => parent.validateUnsignedParentTerminalFacts(d), /counter_facts/);
  }
});
test("B4-B1 no denied effect was swallowed", () => assert.deepEqual(effects, []));
