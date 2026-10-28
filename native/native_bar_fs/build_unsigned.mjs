// Explicit C-C1b-3 build-only entry. Never imports generated JS, an addon, an observer or a worker.
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describeUnsignedIsolatedBuild, inspectUnsignedMachO } from "../../test/helpers/unsignedBuildPlan.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const output = join(root, "build/b3cc-validation");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const refuse = (code) => { throw Error(`cc1b3_${code}`); };
const errorCode = (e) => /^cc1b3_[a-z_]+$/.test(e?.message) ? e.message : `cc1b3_${e?.code ?? "unexpected"}`;
const identity = (s) => [s.dev, s.ino, s.uid, s.gid, s.mode, s.birthtimeNs].map(String).join(":");
const sourceRoots = ["src", "native/native_bar_fs", "test/helpers", "tsconfig.json", "package.json", "package-lock.json"];
const inheritedOptions = ["LD_PRELOAD", "CFLAGS", "CXXFLAGS", "LDFLAGS", "SDKROOT", "DEVELOPER_DIR"];
const nodeHeaders = ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"];
const pins = new Map(), parents = [];
let environment, allocated = false, record;

// One use of an open descriptor, then exactly one close; a close failure never hides the use's own error.
function closing(fd, use, message) {
  let primary = null, closeError = null, value;
  try { value = use(); } catch (e) { primary = e; }
  try { fs.closeSync(fd); } catch (e) { closeError = e; }
  if (primary && closeError) throw new AggregateError([primary, closeError], message, { cause: primary });
  if (primary) throw primary;
  if (closeError) throw closeError;
  return value;
}
function compilerDiagnostics(stdout, stderr) {
  const prefix = (bytes) => {
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true }), head = bytes.subarray(0, 16384);
    let text = decoder.decode(head, { stream: true }), truncated = head.length < bytes.length || decoder.decode().length > 0;
    // Invalid bytes decode to three-byte U+FFFD and can grow the text past the bound; cut it again at a character boundary.
    if (Buffer.byteLength(text) > 16384) { text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(Buffer.from(text).subarray(0, 16384), { stream: true }); truncated = true; }
    const encoded = Buffer.from(text);
    return { prefix: text, observed_bytes: bytes.length, truncated, lossless: encoded.equals(bytes.subarray(0, encoded.length)) };
  };
  return { stdout: prefix(stdout), stderr: prefix(stderr) };
}
function command(program, args) {
  const result = spawnSync(program, args, { cwd: root, env: environment, shell: false, maxBuffer: 1048576 });
  const stdout = result.stdout ?? Buffer.alloc(0), stderr = result.stderr ?? Buffer.alloc(0);
  const failed = Boolean(result.error || result.status !== 0 || result.signal !== null);
  const compile = program === process.execPath && args[0] === "node_modules/typescript/bin/tsc"
    || args.includes("-o") && ["native/native_bar_fs/native_bar_fs.cc", "native/native_bar_fs/admission_unsigned_observer.cc"].some((p) => args.includes(p));
  // Every tool call, ACL listings included, keeps raw-byte counts and hashes. Only fixed compiler failures may persist text.
  const diagnostics = failed && compile ? compilerDiagnostics(stdout, stderr) : null;
  record?.commands.push({ program, args, exit_code: result.status, signal: result.signal, error: result.error?.code ?? null,
    stdout_bytes: stdout.length, stderr_bytes: stderr.length, stdout_sha256: hash(stdout), stderr_sha256: hash(stderr), failure_diagnostics: diagnostics });
  if (failed) {
    const display = diagnostics ?? compilerDiagnostics(Buffer.alloc(0), stderr);
    for (const stream of [display.stdout, display.stderr]) if (stream.prefix) console.error(stream.prefix);
    refuse("tool_failed");
  }
  return stdout.toString("utf8");
}
function qualify(path, owned = false, expectedMode = null) {
  const before = fs.lstatSync(path, { bigint: true });
  if (before.isSymbolicLink() || !before.isDirectory() && !before.isFile() || ![0n, BigInt(process.getuid())].includes(before.uid)
    || (before.mode & 0o022n) || owned && before.uid !== BigInt(process.getuid())
    || expectedMode !== null && (before.mode & 0o7777n) !== BigInt(expectedMode)) refuse("unsafe_output");
  const lines = command("/bin/ls", ["-lde", path]).trimEnd().split("\n");
  if (!lines.length || lines.length > 257 || lines.slice(1).some((s) => !/^\s+[0-9]+: .+ deny .+$/.test(s))) refuse("output_acl");
  const after = fs.lstatSync(path, { bigint: true }); if (identity(before) !== identity(after)) refuse("output_changed");
  const old = pins.get(path); if (old && old !== identity(after)) refuse("output_changed");
  pins.set(path, identity(after)); return after;
}
function checkPins() { for (const [path, pin] of pins) if (identity(fs.lstatSync(path, { bigint: true })) !== pin) refuse("output_changed"); }
function directory(path) {
  checkPins(); fs.mkdirSync(path, { mode: 0o700 });
  const s = qualify(path, true, 0o700); if (!s.isDirectory()) refuse("output_type");
}
function snapshot() {
  const rows = [];
  function visit(path) {
    const s = fs.lstatSync(path);
    if (s.isSymbolicLink()) refuse("source_symlink");
    if (s.isDirectory()) { for (const n of fs.readdirSync(path).sort()) visit(join(path, n)); }
    else if (s.isFile()) rows.push({ path: relative(root, path), bytes: s.size, sha256: hash(fs.readFileSync(path)) });
    else refuse("source_type");
  }
  for (const name of [...sourceRoots, "node_modules/typescript/bin/tsc", "node_modules/typescript/lib/tsc.js", "node_modules/typescript/lib/_tsc.js"])
    visit(join(root, name));
  return { rows, sha256: hash(JSON.stringify(rows)) };
}
// Tracked or untracked (non-ignored) changes under the source roots mean the build is not reproducible from source_commit alone.
function worktree() {
  const status = command("/usr/bin/git", ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...sourceRoots]);
  return { clean: status === "", entries: status.split("\0").filter((f) => /^[ MADRCU?!]{2} /.test(f)).length, status_sha256: hash(status) };
}
function hashInputs(names) {
  const rows = names.map((name) => {
    const path = join(root, name), s = fs.lstatSync(path);
    if (!s.isFile() || s.size > 67108864) refuse("typescript_input_type");
    return { path: name, bytes: s.size, sha256: hash(fs.readFileSync(path)) };
  });
  return { rows, sha256: hash(JSON.stringify(rows)) };
}
// The files tsc itself reports reading, standard-library and dependency declarations included; they decide whether and what it emits.
function typescriptInputs() {
  const listed = command(process.execPath, ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json", "--listFilesOnly"]).split("\n").filter(Boolean);
  if (!listed.length || listed.length > 4096) refuse("typescript_inputs");
  return hashInputs([...new Set(listed.map((path) => {
    const name = relative(root, path);
    if (!path.startsWith("/") || name === "" || name.startsWith("..") || name.startsWith("/")) refuse("typescript_input_outside_root");
    return name;
  }))].sort());
}
function toolchain() {
  const compiler = command("/usr/bin/xcrun", ["--no-cache", "--find", "clang++"]).trim();
  const sdk = command("/usr/bin/xcrun", ["--no-cache", "--sdk", "macosx", "--show-sdk-path"]).trim();
  if (!compiler.startsWith("/") || !sdk.startsWith("/") || !fs.statSync(sdk, { throwIfNoEntry: false })?.isDirectory()) refuse("local_toolchain");
  const headers = resolve(dirname(fs.realpathSync(process.execPath)), "../include/node");
  if (!nodeHeaders.every((name) => fs.statSync(join(headers, name), { throwIfNoEntry: false })?.isFile())) refuse("local_headers");
  const runtime = command(compiler, ["-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib"]).trim();
  if (!runtime.startsWith("/") || !fs.statSync(runtime, { throwIfNoEntry: false })?.isFile()) refuse("local_ubsan_runtime");
  const linker = command(compiler, ["-print-prog-name=ld"]).trim(), settings = join(sdk, "SDKSettings.json");
  const file = (path) => path.startsWith("/") && fs.statSync(path, { throwIfNoEntry: false })?.isFile() ? hash(fs.readFileSync(path)) : null;
  return { compiler, sdk, headers, record: { compiler, compiler_sha256: hash(fs.readFileSync(compiler)), compiler_version: command(compiler, ["--version"]).trim(),
    linker, linker_sha256: file(linker), sdk, sdk_version: command("/usr/bin/xcrun", ["--no-cache", "--sdk", "macosx", "--show-sdk-version"]).trim(),
    sdk_settings_sha256: file(settings), headers, header_sha256: hash(Buffer.concat(nodeHeaders.map((p) => fs.readFileSync(join(headers, p))))),
    ubsan_runtime: { path: runtime, sha256: hash(fs.readFileSync(runtime)) } } };
}
function exclusiveRecord() {
  checkPins();
  // Identity pins do not cover ACL changes, so the whole destination chain is qualified again immediately before writing.
  for (const p of parents) qualify(p);
  qualify(output, true, 0o700);
  const text = JSON.stringify(record, null, 2) + "\n";
  if (Buffer.byteLength(text) > 4194304) refuse("record_bound");
  const path = join(output, "build-record.json"), bytes = Buffer.from(text);
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  // The record file's own qualification follows serialization, so that one ACL listing is not in the saved command list.
  closing(fd, () => {
    qualify(path, true, 0o600); let offset = 0;
    while (offset < bytes.length) { const n = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n < 1) refuse("record_write"); offset += n; }
    fs.fsyncSync(fd); const copy = Buffer.alloc(bytes.length); offset = 0;
    while (offset < copy.length) { const n = fs.readSync(fd, copy, offset, copy.length - offset, offset); if (n < 1) refuse("record_readback"); offset += n; }
    if (!copy.equals(bytes)) refuse("record_readback");
  }, "cc1b3_record_and_close_failed");
}
function artifacts(mode, source) {
  const base = join(output, mode), rows = [];
  function visit(path) {
    const s = fs.lstatSync(path);
    if (s.isSymbolicLink()) refuse("artifact_symlink");
    if (s.isDirectory()) { qualify(path, true, 0o700); for (const name of fs.readdirSync(path).sort()) visit(join(path, name)); return; }
    const name = relative(base, path), kind = name === "admission-unsigned-observer" ? "observer" : name === "native-bar-fs/native_bar_fs.node" ? "addon" : null;
    if (!kind && !name.endsWith(".js")) refuse("unexpected_artifact");
    const metadata = qualify(path, true, kind === "observer" ? 0o700 : 0o600);
    if (!s.isFile() || metadata.nlink !== 1n || s.size > 67108864) refuse("artifact_type");
    const bytes = fs.readFileSync(path);
    rows.push({ path: relative(root, path), bytes: bytes.length, mode: (Number(metadata.mode) & 0o777).toString(8), sha256: hash(bytes),
      ...(kind ? { mach_o: inspectUnsignedMachO(bytes, kind, process.arch) } : {}) });
  }
  visit(base);
  for (const name of ["nativeBarAdmissionJointReader.js", "nativeBarAdmissionJointReadContracts.js", "native-bar-fs/native_bar_fs.node", "admission-unsigned-observer"])
    if (!rows.some((r) => r.path === `build/b3cc-validation/${mode}/${name}`)) refuse("artifact_missing");
  // Exactly one emitted module per src TypeScript file: no extra, stale or missing JS is accepted.
  const expected = source.rows.filter((r) => r.path.startsWith("src/") && r.path.endsWith(".ts") && !r.path.endsWith(".d.ts"))
    .map((r) => `build/b3cc-validation/${mode}/${r.path.slice(4, -3)}.js`).sort();
  if (JSON.stringify(rows.filter((r) => r.path.endsWith(".js")).map((r) => r.path).sort()) !== JSON.stringify(expected)) refuse("artifact_set");
  return rows;
}
function sameJavaScript() {
  const modules = (mode) => {
    const prefix = `build/b3cc-validation/${mode}/`;
    return record.artifacts.filter((r) => r.path.startsWith(prefix) && r.path.endsWith(".js")).map((r) => `${r.path.slice(prefix.length)}:${r.sha256}`).sort().join("\n");
  };
  if (modules("normal") !== modules("ubsan")) refuse("mode_javascript_differs");
}
// Bounded, best-effort description of everything retained under the new root when the record is saved. It never follows a link and is
// never qualification or a reusable artifact list.
function retainedOutputs() {
  const rows = []; let error = null;
  function visit(path) {
    if (rows.length >= 4096) refuse("inventory_bound");
    const s = fs.lstatSync(path);
    const row = { path: relative(root, path), type: s.isDirectory() ? "directory" : s.isFile() ? "file" : s.isSymbolicLink() ? "symlink" : "other",
      bytes: s.size, mode: (s.mode & 0o7777).toString(8) };
    rows.push(row);
    if (s.isFile() && s.size <= 67108864) {
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      row.sha256 = closing(fd, () => hash(fs.readFileSync(fd)), "cc1b3_inventory_and_close_failed");
    }
    if (s.isDirectory()) for (const name of fs.readdirSync(path).sort()) visit(join(path, name));
  }
  try { visit(output); } catch (e) { error = errorCode(e); }
  return { qualified: false, complete: error === null, error, rows };
}
function normalizeAddon(path) {
  // Only this newly compiled artifact is permission-normalized; no existing/common output is changed.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  closing(fd, () => {
    const s = fs.fstatSync(fd); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid()) refuse("artifact_type");
    fs.fchmodSync(fd, 0o600);
  }, "cc1b3_artifact_and_close_failed");
}
function unchanged(source, inputs) {
  if (snapshot().sha256 !== source.sha256 || hashInputs(inputs.rows.map((r) => r.path)).sha256 !== inputs.sha256) refuse("source_changed");
}
function buildMode(mode, tools, source, inputs) {
  const plan = describeUnsignedIsolatedBuild(mode); checkPins(); directory(join(output, mode)); directory(join(output, mode, "native-bar-fs"));
  unchanged(source, inputs);
  command(process.execPath, plan.typescript);
  const expand = (args) => args.map((v) => v === "$SDK" ? tools.sdk : v === "$HEADERS" ? tools.headers : v);
  command(tools.compiler, expand(plan.addon));
  normalizeAddon(join(output, mode, "native-bar-fs/native_bar_fs.node"));
  command(tools.compiler, expand(plan.observer));
  record.artifacts.push(...artifacts(mode, source));
  unchanged(source, inputs);
}
function buildOnly() {
  if (process.argv.length !== 3 || process.argv[2] !== "--build-only") refuse("explicit_build_only_required");
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) refuse("platform");
  // The parent Node process honors NODE_* and DYLD_* itself; child tools only ever see the fixed environment below.
  if (process.execArgv.length || Object.keys(process.env).some((key) => /^(?:NODE_|DYLD_)/.test(key) || inheritedOptions.includes(key))) refuse("inherited_options");
  const umask = process.umask(0o077);
  environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", TZ: "Asia/Tokyo", XCRUN_CACHE_DISABLED: "1" };
  record = { schema: "native-bar-unsigned-isolated-build-v1", stage: "C-C1b-3", started_at: new Date().toISOString(), ended_at: null,
    status: "BUILDING", native_status: "NOT_RUN", signing_performed: false, runtime_qualified: false, execution_available: false, error: null,
    commands: [], source: null, source_commit: null, source_worktree: null, toolchain: null, typescript_inputs: null, artifacts: [], retained_outputs: null,
    host: { platform: process.platform, architecture: process.arch, node: process.version, abi: process.versions.modules } };
  let primary = null, recordError = null;
  try {
    for (let p = join(root, "build"); ; p = dirname(p)) { qualify(p); parents.push(p); if (p === dirname(p)) break; }
    try { fs.lstatSync(output); refuse("output_exists"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    // Exclusive fixed root: every failure retains its new outputs. There is no retry, repair or deletion path.
    directory(output); allocated = true;
    for (const name of ["scratch", "scratch/tmp", "scratch/home", "scratch/modules", "scratch/cache"]) directory(join(output, name));
    environment = { ...environment, HOME: join(output, "scratch/home"), CFFIXED_USER_HOME: join(output, "scratch/home"),
      TMPDIR: join(output, "scratch/tmp") + "/", CLANG_MODULE_CACHE_PATH: join(output, "scratch/modules"), XDG_CACHE_HOME: join(output, "scratch/cache") };
    const source = snapshot(); record.source = source;
    record.source_commit = command("/usr/bin/git", ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"]).trim();
    record.source_worktree = worktree();
    const tools = toolchain(); record.toolchain = tools.record;
    const inputs = typescriptInputs(); record.typescript_inputs = inputs;
    for (const mode of ["normal", "ubsan"]) buildMode(mode, tools, source, inputs);
    sameJavaScript();
    record.status = "COMPILED_NOT_RUN";
  } catch (e) {
    primary = e; record.status = "BUILD_FAILED_RETAINED"; record.error = errorCode(e);
  } finally {
    try { if (allocated) { record.ended_at = new Date().toISOString(); record.retained_outputs = retainedOutputs(); exclusiveRecord(); } }
    catch (e) { recordError = e; }
    finally { process.umask(umask); }
  }
  if (primary && recordError) throw new AggregateError([primary, recordError], "cc1b3_build_and_record_failed", { cause: primary });
  if (primary) throw primary;
  if (recordError) throw recordError;
  console.log(JSON.stringify({ status: record.status, modes: ["normal", "ubsan"], artifacts: record.artifacts.length, native_status: "NOT_RUN", record: relative(root, join(output, "build-record.json")) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildOnly();
