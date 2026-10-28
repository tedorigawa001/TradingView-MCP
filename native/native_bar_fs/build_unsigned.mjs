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
const identity = (s) => [s.dev, s.ino, s.uid, s.gid, s.mode, s.birthtimeNs].map(String).join(":");
const pins = new Map();
let environment, allocated = false, record;

function compilerDiagnostics(stdout, stderr) {
  const prefix = (value) => {
    const bytes = Buffer.from(value ?? "");
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes.subarray(0, 16384), { stream: true });
    return { prefix: text, observed_bytes: bytes.length, truncated: Buffer.byteLength(text) < bytes.length };
  };
  return { stdout: prefix(stdout), stderr: prefix(stderr) };
}
function command(program, args) {
  const result = spawnSync(program, args, { cwd: root, env: environment, encoding: "utf8", shell: false, maxBuffer: 1048576 });
  const failed = Boolean(result.error || result.status !== 0 || result.signal !== null);
  const compile = program === process.execPath && args[0] === "node_modules/typescript/bin/tsc"
    || args.includes("-o") && ["native/native_bar_fs/native_bar_fs.cc", "native/native_bar_fs/admission_unsigned_observer.cc"].some((p) => args.includes(p));
  // Only fixed compiler failures may persist text. Other tool/ACL output keeps hashes, never raw bodies.
  const diagnostics = failed && compile ? compilerDiagnostics(result.stdout, result.stderr) : null;
  if (program !== "/bin/ls") record?.commands.push({ program, args, exit_code: result.status, signal: result.signal, error: result.error?.code ?? null,
    stdout_sha256: hash(result.stdout ?? ""), stderr_sha256: hash(result.stderr ?? ""), failure_diagnostics: diagnostics });
  if (failed) {
    const display = diagnostics ?? compilerDiagnostics("", result.stderr);
    for (const stream of [display.stdout, display.stderr]) if (stream.prefix) console.error(stream.prefix);
    refuse("tool_failed");
  }
  return result.stdout;
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
  for (const name of ["src", "native/native_bar_fs", "test/helpers", "tsconfig.json", "package.json", "package-lock.json",
    "node_modules/typescript/bin/tsc", "node_modules/typescript/lib/tsc.js", "node_modules/typescript/lib/_tsc.js"])
    visit(join(root, name));
  return { rows, sha256: hash(JSON.stringify(rows)) };
}
function exclusiveRecord() {
  checkPins(); const text = JSON.stringify(record, null, 2) + "\n";
  if (Buffer.byteLength(text) > 4194304) refuse("record_bound");
  const path = join(output, "build-record.json"), bytes = Buffer.from(text);
  const fd = fs.openSync(path, fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let primary = null, closeError = null;
  try {
    qualify(path, true, 0o600); let offset = 0;
    while (offset < bytes.length) { const n = fs.writeSync(fd, bytes, offset, bytes.length - offset, offset); if (n < 1) refuse("record_write"); offset += n; }
    fs.fsyncSync(fd); const copy = Buffer.alloc(bytes.length); offset = 0;
    while (offset < copy.length) { const n = fs.readSync(fd, copy, offset, copy.length - offset, offset); if (n < 1) refuse("record_readback"); offset += n; }
    if (!copy.equals(bytes)) refuse("record_readback");
  } catch (e) { primary = e; }
  finally { try { fs.closeSync(fd); } catch (e) { closeError = e; } }
  if (primary && closeError) throw new AggregateError([primary, closeError], "cc1b3_record_and_close_failed", { cause: primary });
  if (primary) throw primary;
  if (closeError) throw closeError;
}
function artifacts(mode) {
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
  return rows;
}
function buildOnly() {
  if (process.argv.length !== 3 || process.argv[2] !== "--build-only") refuse("explicit_build_only_required");
  if (process.platform !== "darwin" || !["arm64", "x64"].includes(process.arch)) refuse("platform");
  if (process.execArgv.length || ["NODE_OPTIONS", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH", "LD_PRELOAD", "CFLAGS", "CXXFLAGS", "LDFLAGS", "SDKROOT", "DEVELOPER_DIR"]
    .some((key) => process.env[key])) refuse("inherited_options");
  const umask = process.umask(0o077);
  environment = { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LANG: "C", LC_ALL: "C", TZ: "Asia/Tokyo", XCRUN_CACHE_DISABLED: "1" };
  record = { schema: "native-bar-unsigned-isolated-build-v1", stage: "C-C1b-3", started_at: new Date().toISOString(), ended_at: null,
    status: "BUILDING", native_status: "NOT_RUN", signing_performed: false, runtime_qualified: false, execution_available: false,
    commands: [], source: null, source_commit: null, artifacts: [],
    host: { platform: process.platform, architecture: process.arch, node: process.version, abi: process.versions.modules } };
  let primary = null, recordError = null;
  try {
    for (let p = join(root, "build"); ; p = dirname(p)) { qualify(p); if (p === dirname(p)) break; }
    try { fs.lstatSync(output); refuse("output_exists"); } catch (e) { if (e.code !== "ENOENT") throw e; }
    // Exclusive fixed root: every failure retains its new outputs. There is no retry, repair or deletion path.
    directory(output); allocated = true;
    for (const name of ["scratch", "scratch/tmp", "scratch/home", "scratch/modules", "scratch/cache"]) directory(join(output, name));
    environment = { ...environment, HOME: join(output, "scratch/home"), CFFIXED_USER_HOME: join(output, "scratch/home"),
      TMPDIR: join(output, "scratch/tmp") + "/", CLANG_MODULE_CACHE_PATH: join(output, "scratch/modules"), XDG_CACHE_HOME: join(output, "scratch/cache") };
    const source = snapshot(); record.source = source;
    record.source_commit = command("/usr/bin/git", ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"]).trim();
    const compiler = command("/usr/bin/xcrun", ["--no-cache", "--find", "clang++"]).trim();
    const sdk = command("/usr/bin/xcrun", ["--no-cache", "--sdk", "macosx", "--show-sdk-path"]).trim();
    if (!compiler.startsWith("/") || !sdk.startsWith("/") || !fs.statSync(sdk).isDirectory()) refuse("local_toolchain");
    const headers = resolve(dirname(fs.realpathSync(process.execPath)), "../include/node");
    for (const name of ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"]) if (!fs.statSync(join(headers, name)).isFile()) refuse("local_headers");
    record.toolchain = { compiler, compiler_sha256: hash(fs.readFileSync(compiler)), compiler_version: command(compiler, ["--version"]).trim(), sdk,
      headers, header_sha256: hash(Buffer.concat(["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"].map((p) => fs.readFileSync(join(headers, p))))) };
    const runtime = command(compiler, ["-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib"]).trim();
    if (!runtime.startsWith("/") || !fs.statSync(runtime).isFile()) refuse("local_ubsan_runtime");
    record.toolchain.ubsan_runtime = { path: runtime, sha256: hash(fs.readFileSync(runtime)) };
    for (const mode of ["normal", "ubsan"]) {
      const plan = describeUnsignedIsolatedBuild(mode); checkPins(); directory(join(output, mode)); directory(join(output, mode, "native-bar-fs"));
      if (snapshot().sha256 !== source.sha256) refuse("source_changed");
      command(process.execPath, plan.typescript);
      const expand = (args) => args.map((v) => v === "$SDK" ? sdk : v === "$HEADERS" ? headers : v);
      command(compiler, expand(plan.addon));
      const addon = join(output, mode, "native-bar-fs/native_bar_fs.node");
      // Only this newly compiled artifact is permission-normalized; no existing/common output is changed.
      const fd = fs.openSync(addon, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { const s = fs.fstatSync(fd); if (!s.isFile() || s.nlink !== 1 || s.uid !== process.getuid()) refuse("artifact_type"); fs.fchmodSync(fd, 0o600); }
      finally { fs.closeSync(fd); }
      command(compiler, expand(plan.observer));
      record.artifacts.push(...artifacts(mode));
      if (snapshot().sha256 !== source.sha256) refuse("source_changed");
    }
    record.status = "COMPILED_NOT_RUN";
  } catch (e) {
    primary = e;
    if (record) { record.status = "BUILD_FAILED_RETAINED"; record.error = /^cc1b3_[a-z_]+$/.test(e.message) ? e.message : `cc1b3_${e.code ?? "unexpected"}`; }
  } finally {
    try { if (allocated && record) { record.ended_at = new Date().toISOString(); exclusiveRecord(); } }
    catch (e) { recordError = e; }
    finally { process.umask(umask); }
  }
  if (primary && recordError) throw new AggregateError([primary, recordError], "cc1b3_build_and_record_failed", { cause: primary });
  if (primary) throw primary;
  if (recordError) throw recordError;
  console.log(JSON.stringify({ status: record.status, modes: ["normal", "ubsan"], artifacts: record.artifacts.length, native_status: "NOT_RUN", record: relative(root, join(output, "build-record.json")) }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) buildOnly();
