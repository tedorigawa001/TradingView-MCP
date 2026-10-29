import { z } from "zod";
import { uint, label, digestSchema, parse, canonical, digest, byteLength, freeze, flags, LIMITS } from "./unsignedControllerData.mjs";

const refuse = (reason) => { throw Error(`cc4b3a_${reason}`); };
const PROFILE = freeze({ manifest_rows: 4096, manifest_pages: 64, page_rows: 128, page_bytes: 65536, manifest_bytes: 2097152,
  file_bytes: "67108864", pass_bytes: "268435456", hash_work_bytes: "2147483648", helper_commands: 131072,
  build_record_bytes: 4194304, tool_capture_bytes: 1048576, acl_bytes: 65536, acl_entries: 256,
  namespace_nodes: 32, discovery_commands: 128, metadata_commands_per_node: 2, runtime_gates: 4, build_input_passes: 4,
  hash_buffer_bytes: 65536 });
const base = () => ({ ...flags(), scope: "unsigned_qualification_memory_only", runtime_completion_proven: false });

export function describeUnsignedQualificationProfile() {
  return freeze({ ...base(), schema: "native-bar-unsigned-qualification-profile-v1", ...PROFILE,
    native_budget_changed: false, includes_evidence_writer_work: false, measurement: "canonical_payload_not_v8_heap" });
}

export function describeUnsignedQualificationCapacity(input) {
  const n = (max, min = 0) => z.number().int().min(min).max(max);
  const d = parse(z.object({ rows: n(PROFILE.manifest_rows, 1), input_bytes: uint, artifact_bytes: uint,
    manifest_bytes: n(PROFILE.manifest_bytes), record_fixed_bytes: n(PROFILE.build_record_bytes),
    namespace_nodes: n(PROFILE.namespace_nodes, 1), discovery_commands: n(PROFILE.discovery_commands) }).strict(), input);
  const inputs = BigInt(d.input_bytes), outputs = BigInt(d.artifact_bytes), pass = inputs + outputs;
  const work = inputs * BigInt(PROFILE.build_input_passes + PROFILE.runtime_gates) + outputs * BigInt(PROFILE.runtime_gates);
  const commands = d.discovery_commands + PROFILE.metadata_commands_per_node
    * (d.rows * (PROFILE.build_input_passes + PROFILE.runtime_gates) + d.namespace_nodes * PROFILE.runtime_gates);
  const record = d.manifest_bytes + d.record_fixed_bytes;
  if (pass > BigInt(PROFILE.pass_bytes) || work > BigInt(PROFILE.hash_work_bytes) || commands > PROFILE.helper_commands
    || record > PROFILE.build_record_bytes) refuse("capacity_bound");
  return freeze({ ...base(), schema: "native-bar-unsigned-qualification-capacity-v1", pass_bytes: String(pass), hash_work_bytes: String(work),
    helper_commands: commands, build_record_bytes: record, manifest_bytes: d.manifest_bytes, rows: d.rows,
    includes_evidence_writer_work: false, native_budget_changed: false, measurement: "canonical_payload_not_v8_heap" });
}

const roles = ["source", "typescript", "runtime", "node", "compiler", "linker", "header", "sdk_settings", "sdk_input", "ubsan", "tool",
  "normal_js", "normal_addon", "normal_observer", "ubsan_js", "ubsan_addon", "ubsan_observer"];
const outputRole = (role) => /^(normal|ubsan)_(js|addon|observer)$/.test(role);
const hostRoles = ["node", "compiler", "linker", "header", "sdk_settings", "sdk_input", "ubsan", "tool"];
const identitySchema = z.object({ device: uint, inode: uint, uid: uint, gid: uint, mode: uint, nlink: uint, size: uint, ctime_ns: uint, mtime_ns: uint }).strict();
const rowSchema = z.object({ path: z.string().min(1).max(512), roles: z.array(z.enum(roles)).min(1).max(6), identity: identitySchema,
  sha256: digestSchema, acl: z.enum(["none", "deny_only"]), profile: z.enum(["plain", "linker_adhoc"]) }).strict();
const pointSchema = z.object({ clock_domain: label, monotonic_ns: uint }).strict();
const buildSteps = ["build_before_normal", "build_after_normal", "build_before_ubsan", "build_after_ubsan"];
const same = (a, b) => canonical(a) === canonical(b);
const immutableDirectory = (p) => ({ device: p.device, inode: p.inode, uid: p.uid, gid: p.gid, mode: p.mode });
const maxUint = 999999999999999999999999999999n;

function calendarMillis(text, offset) {
  const m = text.match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)\.(\d{3})(Z|\+09:00)$/);
  if (!m || m[8] !== (offset === 0 ? "Z" : "+09:00")) refuse("wall_time");
  const [y, month, day, hour, minute, second, ms] = m.slice(1, 8).map(Number);
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0), days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (y < 1970 || month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) refuse("wall_time");
  const before = (year) => 365 * (year - 1) + Math.floor((year - 1) / 4) - Math.floor((year - 1) / 100) + Math.floor((year - 1) / 400);
  const elapsed = before(y) - before(1970) + days.slice(0, month - 1).reduce((a, b) => a + b, 0) + day - 1;
  return BigInt(elapsed) * 86400000n + BigInt(hour * 3600000 + minute * 60000 + second * 1000 + ms - offset);
}

export function createUnsignedQualificationModel(input) {
  const d = parse(z.object({ run_id: label, signature_profile: z.literal("linker_adhoc"), source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    source_clean: z.boolean(), source_status_sha256: digestSchema, uid: uint, node_version: z.string().regex(/^\d{1,3}\.\d{1,3}\.\d{1,3}$/),
    node_abi: uint, architecture: z.enum(["arm64", "x64"]), clock: z.object({ clock_domain: label, started_ns: uint, total_limit_ms: uint }).strict() }).strict(), input);
  const end = BigInt(d.clock.started_ns) + BigInt(d.clock.total_limit_ms) * 1000000n;
  if (BigInt(d.clock.total_limit_ms) < 1n || end > maxUint) refuse("clock_bound");
  let state = "COLLECT_INPUTS", stopped = null, clockInvalid = false, evidenceTainted = false, last = BigInt(d.clock.started_ns), firstStop = null;
  let page = 0, phaseLastPath = "", inputHash = null, manifestHash = null, step = 0, capacity = null, recordHash = null;
  let inputBytes = 0n, outputBytes = 0n, modeledHash = 0n, modeledCommands = PROFILE.discovery_commands, wallLast = null, wallUncertain = false;
  let stampBounds = null, namespaceToken = null;
  const rows = [], names = new Set(), files = new Set(), token = Object.freeze(Object.create(null));
  const fail = (reason) => {
    stopped ??= reason; firstStop ??= clockInvalid ? null : String(last >= end ? end : last);
    state = "STOPPED"; refuse(reason);
  };
  const guard = (action) => {
    if (stopped) refuse("stopped");
    try { return action(); } catch (error) {
      stopped ??= /^cc4b3a_[a-z_]+$/.test(error?.message) ? error.message.slice(7) : "invalid_input";
      firstStop ??= clockInvalid ? null : String(last >= end ? end : last); state = "STOPPED"; throw error;
    }
  };
  const original = (reference) => { if (reference !== token) fail("model_reference"); };
  function point(raw) {
    let p;
    try { p = parse(pointSchema, raw); } catch (error) { clockInvalid = true; throw error; }
    const n = BigInt(p.monotonic_ns);
    if (p.clock_domain !== d.clock.clock_domain || n < last) { clockInvalid = true; fail("clock_order"); }
    last = n; if (n >= end) fail("deadline"); return n;
  }
  const encodedBytes = () => byteLength(canonical(rows));
  function charge(bytes, nodes) {
    modeledHash += bytes; modeledCommands += PROFILE.metadata_commands_per_node * nodes;
    if (modeledHash > BigInt(PROFILE.hash_work_bytes) || modeledCommands > PROFILE.helper_commands) fail("work_bound");
  }
  const describe = () => freeze({ ...base(), schema: "native-bar-unsigned-qualification-model-v1", state, stopped, first_stop_ns: firstStop,
    clock_invalid: clockInvalid, evidence_tainted: evidenceTainted, pages: page, manifest_rows: rows.length, manifest_bytes: encodedBytes(),
    input_sha256: inputHash, manifest_sha256: manifestHash, record_sha256: recordHash, capacity,
    modeled_hash_bytes: String(modeledHash), modeled_helper_commands: modeledCommands,
    cohort_deadline_ns: String(end), last_monotonic_ns: String(last), wall_uncertain: wallUncertain, stamp_bounds: stampBounds,
    supplied_sequence_consistent: state === "FINAL_CHECKED", includes_evidence_writer_work: false });
  function namespace(raw) {
    const n = parse(z.object({ directory: z.string().max(256), build_record_sha256: digestSchema,
      ancestors: z.array(identitySchema.extend({ flags: uint, acl: z.enum(["none", "deny_only"]), metadata_complete: z.literal(true) }).strict()).min(1).max(PROFILE.namespace_nodes - 5),
      nodes: z.array(z.object({ role: z.enum(["checkout", "build", "output", "reports", "run"]), created: z.boolean(), before: identitySchema,
        after: identitySchema, fd: z.object({ device: uint, inode: uint }).strict(), flags: uint, acl: z.enum(["none", "deny_only"]), metadata_complete: z.literal(true) }).strict()).length(5) }).strict(), raw);
    if (n.directory !== `build/b3cc-validation/reports/${d.run_id}` || n.build_record_sha256 !== recordHash) fail("namespace_binding");
    const seen = new Set();
    function directory(p, privateNode, flags) {
      const mode = BigInt(p.mode), key = `${p.device}:${p.inode}`;
      if (seen.has(key) || p.inode === "0" || flags !== "0" || (mode & 0o170000n) !== 0o040000n || (mode & 0o7022n) !== 0n
        || !["0", d.uid].includes(p.uid) || privateNode && (p.uid !== d.uid || mode !== 0o040700n)) fail("namespace_permission");
      seen.add(key);
    }
    for (const p of n.ancestors) directory(p, false, p.flags);
    const order = ["checkout", "build", "output", "reports", "run"];
    n.nodes.forEach((p, i) => {
      if (p.role !== order[i] || p.created !== (i >= 2) || !same(immutableDirectory(p.before), immutableDirectory(p.after))
        || p.fd.device !== p.after.device || p.fd.inode !== p.after.inode) fail("namespace_identity");
      directory(p.after, i >= 2, p.flags);
    });
    charge(0n, n.ancestors.length + n.nodes.length);
    namespaceToken = Object.freeze(Object.create(null)); state = "NAMESPACE_FIXED"; return namespaceToken;
  }
  return Object.freeze({
    appendManifestPage(raw) { return guard(() => {
      if (!["COLLECT_INPUTS", "COLLECT_OUTPUTS"].includes(state)) fail("manifest_order");
      const p = parse(z.object({ ordinal: z.number().int().min(1).max(PROFILE.manifest_pages), rows: z.array(rowSchema).min(1).max(PROFILE.page_rows) }).strict(), raw);
      if (p.ordinal !== page + 1 || rows.length + p.rows.length > PROFILE.manifest_rows || byteLength(canonical(p)) > PROFILE.page_bytes) fail("page_bound");
      if (byteLength(canonical([...rows, ...p.rows])) > PROFILE.manifest_bytes) fail("manifest_bound");
      const nextNames = new Set(), nextFiles = new Set();
      let nextInputBytes = inputBytes, nextOutputBytes = outputBytes, nextLastPath = phaseLastPath;
      // Commit only a complete validated page, so a refusal retains the previous bounded snapshot.
      for (const r of p.rows) {
        const out = r.roles.some(outputRole), mode = BigInt(r.identity.mode), size = BigInt(r.identity.size), file = `${r.identity.device}:${r.identity.inode}`;
        if (!/^(?:\/)?[A-Za-z0-9_@+.-]+(?:\/[A-Za-z0-9_@+.-]+)*$/.test(r.path) || r.path.split("/").some((s) => s === "." || s === "..")
          || r.path <= nextLastPath || names.has(r.path) || nextNames.has(r.path) || files.has(file) || nextFiles.has(file) || r.identity.inode === "0"
          || !same([...new Set(r.roles)].sort(), r.roles) || out && r.roles.length !== 1
          || out !== (state === "COLLECT_OUTPUTS") || r.roles.some((role) => hostRoles.includes(role)) !== r.path.startsWith("/")
          || (mode & 0o170000n) !== 0o100000n || (mode & 0o7022n) !== 0n || r.identity.nlink !== "1"
          || !["0", d.uid].includes(r.identity.uid) || size > BigInt(PROFILE.file_bytes)) fail("manifest_row");
        const role = r.roles[0], native = out && !role.endsWith("_js");
        if (r.profile !== (native ? "linker_adhoc" : "plain")) fail("signature_profile");
        if (out) {
          const [modeName, kind] = role.split("_"), prefix = `build/b3cc-validation/${modeName}/`;
          const expected = kind === "addon" ? `${prefix}native-bar-fs/native_bar_fs.node` : `${prefix}admission-unsigned-observer`;
          if (!r.path.startsWith(prefix) || (kind === "js" ? !r.path.endsWith(".js") : r.path !== expected)
            || mode !== (kind === "observer" ? 0o100700n : 0o100600n) || r.identity.uid !== d.uid) fail("artifact_binding");
          nextOutputBytes += size;
        } else nextInputBytes += size;
        if (nextInputBytes + nextOutputBytes > BigInt(PROFILE.pass_bytes)) fail("capacity_bound");
        nextNames.add(r.path); nextFiles.add(file); nextLastPath = r.path;
      }
      rows.push(...p.rows); nextNames.forEach((name) => names.add(name)); nextFiles.forEach((file) => files.add(file));
      inputBytes = nextInputBytes; outputBytes = nextOutputBytes; phaseLastPath = nextLastPath;
      page++; return describe();
    }); },
    sealInputs(raw) { return guard(() => {
      if (state !== "COLLECT_INPUTS") fail("manifest_order");
      const p = parse(z.object({ manifest_sha256: digestSchema, closure: z.object({ runtime_closed: z.literal(true), compiler_inputs_closed: z.literal(true),
        host_profile: z.literal("controlled_local_os") }).strict() }).strict(), raw);
      const mandatory = ["source", "typescript", "runtime", "node", "compiler", "linker", "header", "sdk_settings", "ubsan", "tool"];
      if (mandatory.some((role) => !rows.some((r) => r.roles.includes(role))) || !rows.some((r) => r.roles.includes("runtime") && r.path.startsWith("node_modules/zod/"))
        || !rows.some((r) => r.roles.includes("typescript") && r.path.startsWith("node_modules/typescript/"))
        || ["node", "compiler", "linker", "sdk_settings", "ubsan"].some((role) => rows.filter((r) => r.roles.includes(role)).length !== 1)) fail("input_closure");
      inputHash = digest(rows); if (p.manifest_sha256 !== inputHash) fail("manifest_digest");
      state = "BUILD_INPUTS_FIXED"; return token;
    }); },
    sealManifest(reference, raw) { return guard(() => {
      original(reference); if (state !== "COLLECT_OUTPUTS") fail("manifest_order");
      const p = parse(z.object({ manifest_sha256: digestSchema, record_fixed_bytes: z.number().int().min(0).max(PROFILE.build_record_bytes) }).strict(), raw);
      for (const mode of ["normal", "ubsan"]) for (const kind of ["js", "addon", "observer"])
        if (!rows.some((r) => r.roles.includes(`${mode}_${kind}`))) fail("artifact_set");
      const js = (mode) => rows.filter((r) => r.roles.includes(`${mode}_js`)).map((r) => ({ path: r.path.slice(`build/b3cc-validation/${mode}/`.length), bytes: r.identity.size, sha256: r.sha256 }));
      if (!same(js("normal"), js("ubsan"))) fail("javascript_parity");
      const expected = rows.filter((r) => r.roles.includes("source") && r.path.startsWith("src/") && r.path.endsWith(".ts") && !r.path.endsWith(".d.ts"))
        .map((r) => r.path.slice(4, -3) + ".js").sort();
      if (expected.length === 0 || !same(js("normal").map((r) => r.path), expected)) fail("artifact_set");
      manifestHash = digest(rows); if (p.manifest_sha256 !== manifestHash) fail("manifest_digest");
      capacity = describeUnsignedQualificationCapacity({ rows: rows.length, input_bytes: String(inputBytes), artifact_bytes: String(outputBytes), manifest_bytes: encodedBytes(),
        record_fixed_bytes: p.record_fixed_bytes, namespace_nodes: PROFILE.namespace_nodes, discovery_commands: PROFILE.discovery_commands });
      state = "ARTIFACTS_FIXED"; return describe();
    }); },
    observe(reference, raw) { return guard(() => {
      original(reference); let p;
      try { p = parse(z.object({ kind: z.enum([...buildSteps, "build_qualified", "record_closed", "namespace_qualified", "normal_first", "ubsan_first", "final"]),
        payload: z.unknown(), at: pointSchema }).strict(), raw); } catch (error) { clockInvalid = true; throw error; }
      point(p.at);
      if (p.kind === "namespace_qualified") {
        if (state !== "BUILD_RECORDED") fail("qualification_order");
        try { return namespace(p.payload); } catch (error) { evidenceTainted = true; throw error; }
      }
      if (p.kind === "record_closed") {
        if (state !== "BUILD_CHECKED") fail("qualification_order");
        const r = parse(z.object({ manifest_sha256: digestSchema, record_sha256: digestSchema, readback_sha256: digestSchema,
          record_bytes: z.number().int().min(0).max(PROFILE.build_record_bytes), fsync: z.literal("confirmed"), close: z.literal("confirmed") }).strict(), p.payload);
        if (r.manifest_sha256 !== manifestHash || r.record_sha256 !== r.readback_sha256 || r.record_bytes < encodedBytes()
          || r.record_bytes > capacity.build_record_bytes) fail("record_binding");
        recordHash = r.record_sha256; state = "BUILD_RECORDED"; return describe();
      }
      const hash = parse(z.object({ pins_sha256: digestSchema }).strict(), p.payload).pins_sha256;
      if (buildSteps.includes(p.kind)) {
        if (state !== "BUILD_INPUTS_FIXED" || p.kind !== buildSteps[step] || hash !== inputHash) fail("build_checkpoint");
        charge(inputBytes, rows.length); step++;
        if (step === buildSteps.length) { state = "COLLECT_OUTPUTS"; phaseLastPath = ""; }
      } else {
        const transitions = { build_qualified: ["ARTIFACTS_FIXED", "BUILD_CHECKED"], normal_first: ["NAMESPACE_FIXED", "NORMAL_CHECKED"],
          ubsan_first: ["NORMAL_CHECKED", "UBSAN_CHECKED"], final: ["UBSAN_CHECKED", "FINAL_CHECKED"] };
        const [from, to] = transitions[p.kind];
        if (state !== from || hash !== manifestHash) fail("runtime_checkpoint");
        charge(inputBytes + outputBytes, rows.length); state = to;
      }
      return describe();
    }); },
    inspectIndexBinding(reference, namespaceReference) { return guard(() => {
      original(reference); if (namespaceToken === null || namespaceReference !== namespaceToken) fail("namespace_reference");
      return freeze({ ...base(), supplied_owner_consistent: true, owner_scope: "cohort_model_only" });
    }); },
    inspectWindow(raw) { return guard(() => {
      const at = point(raw), remaining = (end - at) / 1000000n; if (remaining < 1n) fail("deadline");
      return freeze({ ...base(), remaining_ms: String(remaining), helper_window_ms: String(remaining < BigInt(LIMITS.helper_ms) ? remaining : BigInt(LIMITS.helper_ms)) });
    }); },
    observeStamp(reference, raw) { return guard(() => {
      original(reference); let p;
      try { p = parse(z.object({ before: pointSchema, after: pointSchema, wall_ms: uint, wall_utc: z.string().max(32), wall_jst: z.string().max(32) }).strict(), raw); }
      catch (error) { clockInvalid = true; throw error; }
      const before = point(p.before), after = point(p.after), wall = BigInt(p.wall_ms);
      if (calendarMillis(p.wall_utc, 0) !== wall || calendarMillis(p.wall_jst, 32400000) !== wall) fail("wall_time");
      if (wallLast !== null) {
        const elapsed = (wall - wallLast) * 1000000n;
        const low = before - BigInt(stampBounds.after_ns) - 999999n, high = after - BigInt(stampBounds.before_ns) + 999999n;
        if (wall < wallLast || elapsed < low || elapsed > high) wallUncertain = true;
      }
      wallLast = wall;
      stampBounds = { before_ns: String(before), after_ns: String(after) };
      return freeze({ ...base(), stamp: { clock_domain: d.clock.clock_domain, monotonic_ns: String(after), wall_utc: p.wall_utc, wall_jst: p.wall_jst }, wall_uncertain: wallUncertain });
    }); },
    stop() { if (!stopped) { stopped = "explicit_stop"; firstStop = clockInvalid ? null : String(last >= end ? end : last); state = "STOPPED"; } return describe(); },
    describe,
  });
}
