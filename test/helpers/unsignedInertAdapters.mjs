import { createHash } from "node:crypto";
import { describeUnsignedFixture, describeUnsignedAcceptanceRun, createUnsignedOwnershipModel } from "./jointUnsignedAcceptanceContracts.mjs";
import { createUnsignedExecutionEvidenceModel } from "./unsignedExecutionContracts.mjs";
import { createUnsignedProtocolDecoder, createUnsignedWriteCursor, describeUnsignedObserverRequest, inspectUnsignedObserverResponse, createUnsignedOutputSummary } from "./unsignedAdapterSupport.mjs";
import { validateUnsignedWorkerConfiguration } from "./unsignedWorkerConfiguration.mjs";

const refuse = (code) => { throw Error(`cc1b2_${code}`); };
const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
const hash = (v) => createHash("sha256").update(v).digest("hex");
const errorCode = (e) => e instanceof Error && /^(?:(?:b2[ab]|b3(?:ba|bb|ca|cb)|cc1[ab]|cc1b2)_[a-z_]+|admission_[a-z_]+(?::[0-9]{1,5})?)$/.test(e.message)
  && e.message.length <= 96 ? e.message : "cc1b2_unexpected_error";

export function inspectUnsignedAdapters(allocation) {
  const d = createUnsignedExecutionEvidenceModel(allocation).describe();
  return Object.freeze({ schema: "native-bar-unsigned-inert-adapters-v1", allocation: d.allocation, limits: d.capacity.limits,
    execution_available: false, cleanup_execution_available: false, native_status: "NOT_RUN", evidence_saved: false,
    blockers: Object.freeze(["live_build_receipt_unavailable", "worker_entry_sealed", "execution_not_approved"]) });
}
export async function executeUnsignedAdapters() { throw Error("cc1b2_execution_not_approved"); }

// No current function mints a prepared-run reference. C-C1b-3/4 must review and supply the original live build/ACL pins.
// A DTO, argv, environment flag, prior receipt or a memory-model result cannot enter any adapter below.
const preparedRuns = new WeakMap(), fixtures = new WeakMap(), writers = new WeakMap();
function runOf(reference, evidenceOnly = false) { const r = preparedRuns.get(reference); if (!r || r.stopped && !evidenceOnly) refuse("original_live_run_required"); return r; }
function retain(run, error) { run.stopped ??= errorCode(error); return new Error(run.stopped); }
function same(a, b, directory = false) {
  return ["dev", "ino", "uid", "gid", "mode", "birthtimeNs"].every((k) => a[k] === b[k])
    && (directory || ["size", "nlink", "mtimeNs", "ctimeNs"].every((k) => a[k] === b[k]));
}
function checkpoint(run) {
  if (run.stopped || run.liveBuildPinsStillMatch() !== true || run.evidenceAclStillQualified() !== true) refuse("live_provenance_unconfirmed");
}
function checkpointEvidence(run) {
  // A native/source/worker failure must remain recordable. A corrupt or unqualified evidence namespace must not.
  if (run.evidenceTainted || run.evidenceAclStillQualified() !== true) refuse("evidence_unconfirmed");
}
const workerAlive = (run) => run.workerChild && run.children.has(run.workerChild)
  && run.workerChild.exitCode === null && run.workerChild.signalCode === null;
async function observeOriginal(runRef, fixture, operation, entry_index = null) {
  const run = runOf(runRef); checkpoint(run);
  if (!Number.isSafeInteger(run.observerCalls) || run.observerCalls < 0 || run.observerCalls >= 64) throw retain(run, Error("cc1b2_observer_call_bound"));
  run.observerCalls++;
  const request = { fixture, operation, entry_index }, plan = describeUnsignedObserverRequest(request);
  const limit = Math.min(10000, run.remainingPhaseMs()); if (!Number.isSafeInteger(limit) || limit < 1) throw retain(run, Error("cc1b2_deadline"));
  const { fileURLToPath } = await import("node:url"), { spawn } = await import("node:child_process");
  const program = fileURLToPath(new URL(`../../${plan.relative_program}`, import.meta.url));
  // This original-run callback verifies the exact newly built binary, not an existing file selected by the caller.
  if (run.checkObserverExecutable(program) !== true) refuse("observer_provenance"); checkpoint(run);
  const beforeSpawn = run.remainingPhaseMs(); if (!Number.isSafeInteger(beforeSpawn) || beforeSpawn < 1) throw retain(run, Error("cc1b2_deadline"));
  const child = spawn(program, plan.argv, { env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TZ: "Asia/Tokyo" },
    stdio: ["ignore", "pipe", "pipe"], shell: false }); run.children.add(child);
  child.on("error", () => retain(run, Error("cc1b2_child_error")));
  const remaining = Math.min(limit, run.remainingPhaseMs());
  if (!Number.isSafeInteger(remaining) || remaining < 1) throw retain(run, Error("cc1b2_deadline"));
  const line = await collectOriginalChild(run, child, remaining, 65536);
  checkpoint(run); return inspectUnsignedObserverResponse(request, line).supplied_observation;
}
function collectOriginalChild(run, child, timeout, stdoutCap) {
  return new Promise((resolve, reject) => {
    let output = [], count = 0, stderr = 0, finished = false;
    const fail = (code) => { if (finished) return; finished = true; clearTimeout(timer); output = [];
      // Do not signal, destroy or forget a still-live child. Retain its original object for the explicit later disposition.
      reject(retain(run, Error(code))); };
    const timer = setTimeout(() => fail("cc1b2_child_timeout"), timeout); timer.unref();
    for (const stream of [child.stdout, child.stderr])
      stream.on("error", () => fail("cc1b2_child_pipe"));
    child.stdout.on("data", (b) => { if (finished) return; count += b.length;
      if (count > stdoutCap) return fail("cc1b2_child_output_bound"); output.push(Buffer.from(b)); });
    child.stderr.on("data", (b) => { if (finished) return; stderr += b.length;
      fail(stderr > 8192 ? "cc1b2_child_output_bound" : "cc1b2_child_stderr"); });
    child.on("error", () => fail("cc1b2_child_error"));
    child.on("close", (code, signal) => {
      run.children.delete(child); if (finished) return;
      if (code !== 0 || signal !== null) return fail("cc1b2_child_exit");
      clearTimeout(timer); finished = true; resolve(Buffer.concat(output).toString("utf8")); output = [];
    });
  });
}
async function openOriginalEvidence(runRef, kind) {
  const run = runOf(runRef, true); checkpointEvidence(run);
  if (!["receipt", "report", "index"].includes(kind)) refuse("evidence_kind");
  if (kind === "receipt" && run.stopped) refuse("no_replacement_receipt");
  if (kind === "index" && !run.originalCohort) refuse("cohort_bound");
  if (kind === "index" && run.originalCohort?.indexWriter) return run.originalCohort.indexWriter;
  const attempts = (run.evidenceOpenAttempts ??= new Set()); if (attempts.has(kind)) refuse("evidence_open_once"); attempts.add(kind);
  const fs = await import("node:fs");
  const names = { receipt: `${run.mode}-${run.caseId}.receipt.jsonl`, report: `${run.mode}-${run.caseId}.report.json`, index: "run-index.jsonl" };
  // The fixed directory and original ACL/pin checks come only from the unminted prepared-run capability above.
  const path = `${run.originalEvidenceDirectory}/${names[kind]}`;
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  const token = Object.freeze(Object.create(null)), w = { run, cohort: run.originalCohort, fd, path, initial: null, offset: 0, failed: false, kind };
  writers.set(token, w); (run.writers ??= new Set()).add(w);
  try { w.initial = fs.fstatSync(fd, { bigint: true }); checkWriter(fs, w); } catch (e) { w.failed = true; run.evidenceTainted = true; throw retain(run, e); }
  if (kind === "index") { if (!run.originalCohort) refuse("cohort_bound"); run.originalCohort.indexWriter = token; }
  return token;
}
function checkWriter(fs, w) {
  checkpointEvidence(w.run); const current = fs.fstatSync(w.fd, { bigint: true }), path = fs.lstatSync(w.path, { bigint: true });
  if (!same(w.initial, current, true) || !same(current, path, true) || current.mode !== 0o100600n || current.nlink !== 1n
    || current.uid !== BigInt(process.getuid()) || current.size !== BigInt(w.offset)) refuse("evidence_identity");
}
async function writeOriginalEvidence(runRef, token, text) {
  const run = runOf(runRef, true), w = writers.get(token);
  if (!w || w.failed || (w.kind === "index" ? !w.cohort || w.cohort !== run.originalCohort : w.run !== run)) refuse("original_writer_required");
  const fs = await import("node:fs"), caps = { receipt: 16384, report: 262144, index: 5290 };
  const cursor = createUnsignedWriteCursor({ text, cap_bytes: caps[w.kind] }), b = Buffer.from(text), start = w.offset;
  const total = { receipt: 1048576, report: 262144, index: 131072 }[w.kind];
  try {
    if (w.offset + b.length > total || w.kind === "report" && w.offset !== 0) refuse("evidence_capacity"); checkWriter(fs, w);
    while (cursor.describe().remaining) {
      checkpointEvidence(run); const n = fs.writeSync(w.fd, b, cursor.describe().offset, cursor.describe().remaining, w.offset);
      cursor.advance(n); w.offset += n;
    }
    fs.fsyncSync(w.fd); checkWriter(fs, w); const readback = Buffer.alloc(b.length); let offset = 0;
    while (offset < b.length) { checkpointEvidence(run); const n = fs.readSync(w.fd, readback, offset, b.length - offset, start + offset);
      if (n < 1) refuse("evidence_readback"); offset += n; }
    checkWriter(fs, w); cursor.confirmReadback(readback); return text;
  } catch (e) { w.failed = true; run.evidenceTainted = true; throw retain(run, e); }
}
async function createOriginalFixture(runRef, allocation) {
  const run = runOf(runRef); checkpoint(run); if (run.fixtureStarted) refuse("one_fixture_only"); run.fixtureStarted = true;
  const cohort = run.originalCohort;
  if (!cohort || !Number.isSafeInteger(cohort.attempted) || cohort.attempted < 0 || cohort.attempted >= 24 || cohort.liveFixture !== null) refuse("cohort_bound");
  const fs = await import("node:fs"), model = createUnsignedExecutionEvidenceModel(allocation), live = { run, created: [], name: null, fd: null, stopped: false };
  const reference = Object.freeze(Object.create(null)); fixtures.set(reference, live);
  run.originalFixture = live;
  const anchor = await observeOriginal(runRef, allocation.fixture, "anchor");
  if (anchor.volume.read_only_mount) throw retain(run, Error("cc1b2_read_only_mount"));
  run.originalAnchors = anchor.ancestors;
  const receipt = await openOriginalEvidence(runRef, "receipt");
  const journal = async (kind, payload) => {
    const line = model.append({ kind, payload, stamp: run.actualParentStamp() }).line;
    model.confirmReceipt(await writeOriginalEvidence(runRef, receipt, line));
  };
  live.journal = journal; live.receiptModel = model; live.receipt = receipt;
  try {
    await journal("case_allocated", {}); await journal("create_intent", { entry_index: 0 }); checkpoint(run);
    cohort.attempted++; cohort.liveFixture = reference;
    const full = fs.mkdtempSync("/private/tmp/native-bar-fs-synthetic-"); live.name = full.slice("/private/tmp/".length);
    // Bind the returned name before an await or a subsequent creation, even if opening/proving it later fails.
    live.fd = fs.openSync(full, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    live.created.push({ path: "", identity: fs.fstatSync(live.fd, { bigint: true }) });
    const fixture = { ...allocation.fixture, fixture_name: live.name }, recipe = describeUnsignedFixture(fixture); live.fixture = fixture;
    for (const [entry_index, entry] of recipe.entries.entries()) {
      if (entry_index) {
        await journal("create_intent", { entry_index }); checkpoint(run); const path = `${full}/${entry.path}`;
        if (entry.kind === "directory") fs.mkdirSync(path, { mode: 0o700 });
        else {
          const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
          let primaryError;
          try { live.created.push({ path: entry.path, identity: fs.fstatSync(fd, { bigint: true }) });
            const b = Buffer.from(entry.content);
            if (b.length) { const cursor = createUnsignedWriteCursor({ text: entry.content, cap_bytes: 16384 });
              while (cursor.describe().remaining) { checkpoint(run); cursor.advance(fs.writeSync(fd, b, cursor.describe().offset, cursor.describe().remaining, cursor.describe().offset)); } }
            fs.fsyncSync(fd);
          } catch (e) { primaryError = e; }
          finally { try { fs.closeSync(fd); } catch (e) { (run.closeErrors ??= []).push(errorCode(e)); primaryError ??= e; } }
          if (primaryError) throw primaryError;
        }
        if (entry.kind === "directory") live.created.push({ path: entry.path, identity: fs.lstatSync(path, { bigint: true }) });
      }
      const seen = await observeOriginal(runRef, fixture, "entry", entry_index), row = seen.entries.find((e) => e.index === entry_index);
      if (!row) refuse("creation_observation");
      if (entry.kind === "directory" && row.children?.length !== 0) refuse("creation_not_empty");
      const original = live.created[entry_index].identity;
      if (row.proof.device !== String(original.dev) || row.proof.inode !== String(original.ino)) refuse("creation_identity");
      live.created[entry_index].proof = row.proof;
      await journal("create_result", { entry_index, proof: row.proof, ...(entry_index === 0 ? { fixture_name: live.name } : {}) });
    }
    live.setupObservation = await observeOriginal(runRef, fixture, "inventory");
    if (run.checkFullSetupInventory(live.setupObservation, live.created) !== true) refuse("setup_unconfirmed");
    return reference;
  } catch (e) { live.stopped = true; throw retain(run, e); }
}
async function removeOriginalFixture(runRef, reference) {
  const run = runOf(runRef), live = fixtures.get(reference); checkpoint(run);
  if (!live || live.run !== run || live.stopped || !workerAlive(run) || run.protocol.describe().state !== "RELEASED") refuse("original_release_required");
  const fs = await import("node:fs");
  try {
    // Original baseline plus live creation records, never a replayed receipt, creates this supplied-data check.
    const owner = createUnsignedOwnershipModel({ fixture: live.fixture, supervisor_id: run.supervisorId, worker_id: run.workerId,
      uid: String(live.created[0].identity.uid), gid: String(live.created[0].identity.gid), baseline_resources: run.originalBaseline });
    for (const e of live.created) { const { allocated_bytes, mtime_ns, ctime_ns, ...proof } = e.proof;
      owner.recordCreation({ path: e.path, proof, children: proof.kind === "directory" ? [] : null, receipt_write: "confirmed" }); }
    owner.finishSetup(); let remaining = [...live.created];
    while (remaining.length) {
      await new Promise((resolve) => setImmediate(resolve)); checkpoint(run); if (!workerAlive(run)) refuse("worker_lost");
      const seen = await observeOriginal(runRef, live.fixture, "inventory"), observation = run.originalCleanupObservation(seen, remaining);
      const a = owner.assessCleanup(observation); if (a.decision !== "supplied_next_entry") refuse("cleanup_unconfirmed");
      const entry_index = live.created.findIndex((e) => e.path === a.next_entry.path), row = seen.entries.find((e) => e.index === entry_index);
      await live.journal("delete_intent", { entry_index, proof: row.proof }); checkpoint(run);
      const again = await observeOriginal(runRef, live.fixture, "entry", entry_index);
      await new Promise((resolve) => setImmediate(resolve)); checkpoint(run); if (!workerAlive(run)) refuse("worker_lost");
      if (run.checkExactRemainingAndParents(again, remaining) !== true) refuse("cleanup_unconfirmed");
      const path = `/private/tmp/${live.name}${a.next_entry.path ? "/" + a.next_entry.path : ""}`;
      if (a.next_entry.operation === "unlink_nonrecursive") fs.unlinkSync(path); else fs.rmdirSync(path);
      await live.journal("delete_result", { entry_index, outcome: "removed" });
      owner.recordRemoval({ observation, path: a.next_entry.path, outcome: "removed", receipt_write: "confirmed" });
      remaining = remaining.filter((e) => e.path !== a.next_entry.path);
    }
    const absent = await observeOriginal(runRef, live.fixture, "absence"); if (run.checkOriginalAnchorAbsence(absent) !== true) refuse("absence_unconfirmed");
    if (owner.assessCleanup(run.originalCleanupObservation(absent, [])).decision !== "supplied_complete") refuse("absence_unconfirmed");
    await live.journal("absence_checked", { anchor_same: true, root_removal_confirmed: true, absent: true });
    live.closeAttempted = true; fs.closeSync(live.fd); live.fd = null; return owner.summarizeTeardown();
  } catch (e) { live.stopped = true; throw retain(run, e); }
}

function deriveUnsignedCaseBinding(caseId, correct) {
  if (caseId !== "u4-expected-inode") return correct;
  const supplied = JSON.parse(canonical(correct)), bindings = supplied.registration.bindings;
  const used = new Set([bindings.fixture_parent, bindings.witness, ...Object.values(bindings.markers), ...bindings.ancestors.map((a) => a.proof)].map((p) => p.inode));
  let inode = BigInt(bindings.data.inode) + 1n; while (used.has(String(inode))) inode++;
  if (String(inode).length > 30) refuse("inode_delta_bound");
  bindings.data.inode = String(inode); supplied.registration_hash = hash(canonical(supplied.registration)); return supplied;
}
// Configuration is strict metadata only. Native handles, keys and backends are created only inside this sealed worker.
async function prepareOriginalWorker(runRef, declaration, configuration) {
  const run = runOf(runRef); checkpoint(run);
  const checked = validateUnsignedWorkerConfiguration({ fixture: declaration.fixture, configuration,
    registration_sha256: declaration.provenance.registration_sha256, envelope_sha256: declaration.provenance.envelope_sha256 }).configuration;
  const jointBinding = checked.binding, workEnvelope = checked.work_envelope;
  const mode = declaration.fixture.mode, cases = describeUnsignedAcceptanceRun(declaration.fixture.request).cases,
    c = cases.find((v) => v.mode === mode && v.case_id === declaration.fixture.case_id);
  if (!c || process.env.NATIVE_BAR_B3CC_MODE !== mode || process.env.NODE_OPTIONS) refuse("worker_mode");
  const base = mode === "normal" ? "../../build/b3cc-validation/normal/" : "../../build/b3cc-validation/ubsan/";
  const { createRequire } = await import("node:module"), { createPublicKey } = await import("node:crypto"), { fileURLToPath } = await import("node:url");
  const require = createRequire(import.meta.url), nativePath = require.resolve(fileURLToPath(new URL(`${base}native-bar-fs/native_bar_fs.node`, import.meta.url)));
  if (run.checkAddonExecutable(nativePath) !== true) refuse("addon_provenance");
  const original = require(nativePath), cache = require.cache[nativePath], oldExports = cache.exports;
  const trace = [], names = { info: "info", beginAdmissionRead: "begin", openAdmissionReadPair: "open_pair", admissionInventory: "inventory",
    readAdmissionEvidence: "capture", verifyAdmissionInventory: "verify", closeAdmissionInventory: "close", closeAdmissionRead: "close" };
  let overflow = false, bootstrap, owner, reader, query, used = false, cancelled = false;
  const nativeThrows = [];
  const event = (api, edge, code = null, byte_count = "0", sha256 = null) => {
    try { if (trace.length >= 128) { overflow = true; return; }
      trace.push(Object.freeze({ ordinal: trace.length + 1, api, edge, clock_domain: run.workerClockDomain,
        monotonic_ns: String(process.hrtime.bigint()), code: code?.replace(/:[0-9]{1,5}$/, "") ?? null, byte_count, sha256 }));
    } catch { overflow = true; }
  };
  const facade = Object.create(null);
  for (const [name, api] of Object.entries(names)) {
    const fn = original[name]; if (typeof fn !== "function") refuse("addon_export");
    facade[name] = function (...args) {
      event(api, "begin"); let value;
      try { value = Reflect.apply(fn, this === facade ? original : this, args); }
      catch (e) { const code = errorCode(e); if (nativeThrows.length < 8) nativeThrows.push(code); else overflow = true;
        event(api, "throw", code); throw e; }
      // Collection failures must not replace the original result or exception. They invalidate acceptance instead.
      try { const b = name === "readAdmissionEvidence" ? value.bytes : null;
        event(api, "end", null, b ? String(b.length) : "0", b ? hash(b) : null);
      } catch { overflow = true; }
      return value;
    };
  }
  cache.exports = Object.freeze(facade);
  const restore = () => { if (cache.exports !== facade) refuse("addon_cache_changed"); cache.exports = oldExports; };
  try {
    const joint = await import(new URL(`${base}nativeBarAdmissionJointReader.js`, import.meta.url));
    const contracts = await import(new URL(`${base}nativeBarAdmissionJointReadContracts.js`, import.meta.url));
    contracts.validateSyntheticAdmissionJointBinding(jointBinding); contracts.validateSyntheticAdmissionJointWorkEnvelope(workEnvelope);
    if (hash(canonical(jointBinding.registration)) !== declaration.provenance.registration_sha256
      || hash(canonical(workEnvelope)) !== declaration.provenance.envelope_sha256) refuse("configuration_binding");
    const key = createPublicKey({ key: Buffer.from("302a300506032b6570032100d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a", "hex"), type: "spki", format: "der" });
    const firstInfo = facade.info(); if (firstInfo.mode !== "synthetic_only" || firstInfo.admission_read_protocol !== 6) refuse("addon_protocol");
    const suppliedBinding = deriveUnsignedCaseBinding(c.case_id, jointBinding);
    contracts.validateSyntheticAdmissionJointBinding(suppliedBinding);
    bootstrap = joint.createSyntheticAdmissionJointBootstrap(suppliedBinding, key, workEnvelope);
    const info = facade.info(), before = bootstrap.describe();
    const baseline = Object.freeze({ fds: String(info.live_fds), roots: String(info.live_sessions), workspace: before.active_workspace_bytes, retained: before.retained_state_bytes });
    return Object.freeze({ baseline,
      async go() {
        if (used) refuse("worker_go_once"); checkpoint(run); used = true; let primary = null, diagnostic = null, signedRequests = null; const closeErrors = [];
        try {
          const helper = c.owner === "fixed_memory" ? await import("./fixedMemoryCheckpointOracle.mjs") : await import("./unsignedCheckpointOracle.mjs");
          if (cancelled) refuse("worker_cancelled"); checkpoint(run);
          owner = c.owner === "fixed_memory" ? helper.enrollFixedMemoryCheckpointOracle(bootstrap.ownerEnrollment,
            { sequence: "1", tip_hash: jointBinding.registration.pins.enrollment_hash }) : helper.enrollUnsignedCheckpointOracle(bootstrap.ownerEnrollment, c.owner);
          reader = joint.enrollSyntheticAdmissionJointReader(bootstrap.jointReaderEnrollment); query = reader.beginJointRead();
          try { await reader.run(query); primary = "cc1b2_unexpected_joint_success"; } catch (e) { primary = errorCode(e); }
        } catch (e) { primary ??= errorCode(e); }
        finally {
          if (query) try { diagnostic = reader.release(query); } catch (e) { closeErrors.push(errorCode(e)); }
          if (c.owner === "fixed_memory" && owner) try { signedRequests = owner.describe().signed_requests; } catch (e) { closeErrors.push(errorCode(e)); }
          for (const handle of [reader, owner, bootstrap]) if (handle) try { handle.close(); } catch (e) { closeErrors.push(errorCode(e)); }
        }
        let after = null, info = null;
        try { after = bootstrap.describe(); } catch (e) { closeErrors.push(errorCode(e)); }
        try { info = facade.info(); } catch (e) { closeErrors.push(errorCode(e)); }
        try { restore(); } catch (e) { closeErrors.push(errorCode(e)); }
        // Neither zero counters nor exit can repair a missing original query diagnostic.
        const released = diagnostic?.state === "released" && diagnostic?.cleanup === "confirmed";
        return Object.freeze({ primary, diagnostic_sha256: diagnostic ? hash(canonical(diagnostic)) : null,
          diagnostic, resources: info && after ? { fds: String(info.live_fds), roots: String(info.live_sessions), workspace: after.active_workspace_bytes, retained: after.retained_state_bytes } : null,
          original_operation_retired: released, query_released: released, close_errors: closeErrors,
          trace: Object.freeze([...trace]), trace_sha256: hash(canonical(trace)), native_throws: Object.freeze([...nativeThrows]),
          instrumentation_overflow: overflow, owner_signed_requests: signedRequests,
          c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null });
      },
      cancel() { cancelled = true; return query ? reader.cancel(query) : null; },
      closeBeforeGo() { if (used) refuse("worker_go_once"); used = true; try { bootstrap.close(); } finally { restore(); } },
    });
  } catch (e) { try { bootstrap?.close(); } finally { restore(); } throw e; }
}

async function superviseOriginalWorker(runRef) {
  const run = runOf(runRef); checkpoint(run); if (run.workerStarted) refuse("one_worker_only"); run.workerStarted = true;
  const { spawn } = await import("node:child_process"), { fileURLToPath } = await import("node:url");
  const worker = fileURLToPath(new URL("../../native/native_bar_fs/test_unsigned_worker.mjs", import.meta.url));
  if (run.checkWorkerExecutable(worker) !== true) refuse("worker_provenance");
  const child = spawn(process.execPath, [worker], { shell: false, execArgv: [], env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", TZ: "Asia/Tokyo",
    NATIVE_BAR_B3CC_MODE: run.mode, UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=0" }, stdio: ["ignore", "pipe", "pipe", "pipe", "pipe"] });
  run.children.add(child); run.workerChild = child; const decoder = createUnsignedProtocolDecoder();
  for (const stream of [child.stdio[3], child.stdio[4], child.stdout, child.stderr])
    stream.on("error", () => retain(run, Error("cc1b2_worker_pipe")));
  child.stdio[4].on("data", (bytes) => { try { for (const line of decoder.push(bytes)) run.protocol.acceptFrame(line); } catch (e) { retain(run, e); } });
  child.stdio[4].on("end", () => { try { decoder.end(); } catch (e) { retain(run, e); } });
  run.unexpectedOutput = Object.create(null);
  for (const [name, stream] of [["stdout", child.stdout], ["stderr", child.stderr]]) {
    const summary = createUnsignedOutputSummary();
    stream.on("data", (bytes) => { try { run.unexpectedOutput[name] = summary.push(bytes); } catch { /* Retain on any collection failure too. */ }
      retain(run, Error("cc1b2_worker_output")); });
  }
  child.on("error", () => retain(run, Error("cc1b2_worker_lost")));
  child.on("close", (exit_code, signal) => { run.children.delete(child);
    try { run.protocol.workerExit({ exit_code, signal }); } catch (e) { retain(run, e); } });
  return child;
}

async function sendOriginalWorkerCommand(runRef, kind) {
  const run = runOf(runRef); checkpoint(run); if (!workerAlive(run)) refuse("worker_lost");
  if (!["PREPARE", "GO", "CANCEL", "FINALIZE"].includes(kind)) refuse("worker_command");
  let payload = {};
  if (kind === "PREPARE") payload = { configuration: validateUnsignedWorkerConfiguration({ fixture: run.declaration.fixture, configuration: run.configuration,
    registration_sha256: run.declaration.provenance.registration_sha256, envelope_sha256: run.declaration.provenance.envelope_sha256 }).configuration };
  if (kind === "GO") {
    // Only a real original journal's readback flags can open GO. These are private capabilities, not command DTO fields.
    if (!run.baselineRecordConfirmed || !run.goIntentConfirmed) refuse("go_readback_required");
    payload = { baseline_sha256: run.protocol.describe().baseline_sha256, baseline_readback: true, go_intent_readback: true };
  }
  const state = run.protocol.describe(), line = canonical({ binding: state.binding, direction: "parent", ordinal: state.next_ordinals.parent, kind, payload }) + "\n";
  run.protocol.acceptFrame(line); // Also enforces the complete 64 KiB frame bound before pipe output.
  await new Promise((resolve, reject) => run.workerChild.stdio[3].write(line, "utf8", (error) => {
    if (error) reject(retain(run, Error("cc1b2_worker_pipe"))); else resolve();
  }));
}

async function closeOriginalEvidenceAndFixtureFds(runRef) {
  const run = preparedRuns.get(runRef); if (!run) refuse("original_live_run_required");
  const fs = await import("node:fs"), errors = [];
  for (const w of run.writers ?? []) if (!w.closeAttempted && (w.kind !== "index" || run.originalCohort?.finishing === true)) {
    w.closeAttempted = true; try { fs.closeSync(w.fd); w.fd = -1; } catch (e) { errors.push(errorCode(e)); }
  }
  const f = run.originalFixture;
  if (f && f.fd !== null && !f.closeAttempted) {
    f.closeAttempted = true; try { fs.closeSync(f.fd); f.fd = null; } catch (e) { errors.push(errorCode(e)); }
  }
  const index = run.originalCohort?.finishing === true ? writers.get(run.originalCohort.indexWriter) : null;
  if (index && !index.closeAttempted) {
    index.closeAttempted = true; try { fs.closeSync(index.fd); index.fd = -1; } catch (e) { errors.push(errorCode(e)); }
  }
  if (errors.length) retain(run, Error("cc1b2_close_unconfirmed"));
  // No retry of an uncertain close, no recursive removal, and no termination of a live child.
  return Object.freeze(errors);
}
