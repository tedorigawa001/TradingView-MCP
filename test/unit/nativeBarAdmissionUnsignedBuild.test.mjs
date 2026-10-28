import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { describeUnsignedIsolatedBuild, inspectUnsignedMachO } from "../helpers/unsignedBuildPlan.mjs";

const buildSource = readFileSync(new URL("../../native/native_bar_fs/build_unsigned.mjs", import.meta.url), "utf8");
const buildTree = ts.createSourceFile("build.mjs", buildSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const functionSource = (name) => buildTree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name).getText();
function memoryBuild({ failAt = "snapshot", failSave = false, existing = false } = {}) {
  const created = [], saved = [], printed = [], masks = []; let saveAttempts = 0;
  const primary = Error(`cc1b3_${failAt}_failure`), saveError = Error("cc1b3_record_write");
  const context = {
    root: "/invented", output: "/invented/build/b3cc-validation", allocated: false, record: undefined, dirname, join,
    process: { argv: ["node", "build.mjs", "--build-only"], platform: "darwin", arch: "arm64", execArgv: [], env: {},
      version: "v24", versions: { modules: "137" }, umask: (mask) => { masks.push(mask); return 0o22; } },
    qualify: () => {}, directory: (p) => { if (p.endsWith("/scratch") && failAt === "scratch") throw primary; created.push(p); },
    fs: { lstatSync: () => { if (existing) return {}; throw Object.assign(Error("absent"), { code: "ENOENT" }); } },
    snapshot: () => { if (failAt === "snapshot") throw primary; return { rows: [], sha256: "invented" }; },
    command: () => { throw primary; },
    exclusiveRecord: () => { saveAttempts++; if (failSave) throw saveError; saved.push(JSON.parse(JSON.stringify(context.record))); },
    refuse: (c) => { throw Error(`cc1b3_${c}`); }, console: { log: (s) => printed.push(s) }, Date,
  };
  let error; try { vm.runInNewContext(`(${functionSource("buildOnly")})()`, context); } catch (e) { error = e; }
  return { created, saved, printed, masks, saveAttempts, error, primary, saveError };
}

test("C-C1b-3 records safe-root scratch/source failures with unknown provenance left null", () => {
  for (const failAt of ["scratch", "snapshot"]) {
    const r = memoryBuild({ failAt });
    assert.equal(r.error, r.primary); assert.equal(r.saveAttempts, 1); assert.equal(r.saved.length, 1);
    assert.equal(r.saved[0].status, "BUILD_FAILED_RETAINED"); assert.equal(r.saved[0].error, r.primary.message);
    assert.equal(r.saved[0].source, null); assert.equal(r.saved[0].source_commit, null);
    assert.ok(r.saved[0].started_at); assert.ok(r.saved[0].ended_at); assert.deepEqual(r.printed, []);
    assert.equal(r.masks.at(-1), 0o22);
  }
});
test("C-C1b-3 preserves both original build and record failures without retry or success output", () => {
  const r = memoryBuild({ failAt: "tool", failSave: true });
  assert.equal(r.error.message, "cc1b3_build_and_record_failed");
  assert.equal(r.error.cause, r.primary); assert.equal(r.error.errors[0], r.primary); assert.equal(r.error.errors[1], r.saveError);
  assert.equal(r.saveAttempts, 1); assert.deepEqual(r.saved, []); assert.deepEqual(r.printed, []);
  assert.equal(r.masks.at(-1), 0o22);
});
test("C-C1b-3 never writes a failure record into an existing unowned output", () => {
  const r = memoryBuild({ existing: true });
  assert.match(r.error.message, /cc1b3_output_exists/); assert.equal(r.saveAttempts, 0); assert.deepEqual(r.created, []);
});
function memoryCommand(result, args = ["node_modules/typescript/bin/tsc"]) {
  const record = { commands: [] }, printed = [], calls = [];
  const context = { root: "/invented", environment: {}, record, Buffer, TextDecoder, process: { execPath: "/invented/node" },
    spawnSync: (program, argv) => { calls.push({ program, args: argv }); return result; },
    hash: (b) => createHash("sha256").update(b).digest("hex"),
    console: { error: (s) => printed.push(s) }, refuse: (c) => { throw Error(`cc1b3_${c}`); } };
  const diagnostic = buildTree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "compilerDiagnostics");
  if (diagnostic) vm.runInNewContext(diagnostic.getText(), context);
  let error, value; try { value = vm.runInNewContext(`(${functionSource("command")})("/invented/node", args)`, { ...context, args }); } catch (e) { error = e; }
  return { record, printed, calls, error, value };
}
test("C-C1b-3 retains and displays TypeScript stdout failure diagnostics without a retry", () => {
  const diagnostic = "src/invented.ts(1,1): error TS2322: incompatible type\n";
  const r = memoryCommand({ status: 2, signal: null, stdout: diagnostic, stderr: "" });
  assert.match(r.error.message, /cc1b3_tool_failed/); assert.equal(r.calls.length, 1);
  assert.ok(r.printed.includes(diagnostic));
  assert.equal(r.record.commands[0].failure_diagnostics.stdout.prefix, diagnostic);
  assert.equal(r.record.commands[0].failure_diagnostics.stdout.truncated, false);
  assert.equal(r.record.commands[0].stdout_sha256, createHash("sha256").update(diagnostic).digest("hex"));
});
test("C-C1b-3 compiler diagnostic prefixes stay within 16 KiB per stream at UTF-8 boundaries", () => {
  const text = "x".repeat(16383) + "日本語".repeat(10000);
  const r = memoryCommand({ status: 1, signal: null, stdout: text, stderr: text },
    ["-o", "invented-output", "native/native_bar_fs/admission_unsigned_observer.cc"]);
  for (const name of ["stdout", "stderr"]) {
    const d = r.record.commands[0].failure_diagnostics[name];
    assert.ok(Buffer.byteLength(d.prefix) <= 16384); assert.equal(d.observed_bytes, Buffer.byteLength(text));
    assert.equal(d.truncated, true); assert.equal(d.prefix, "x".repeat(16383));
  }
  assert.equal(r.calls.length, 1); assert.equal(r.printed.length, 2);
});
test("C-C1b-3 noncompiler failures and successful compiler output never persist text", () => {
  const failure = memoryCommand({ status: 1, signal: null, stdout: "invented ACL text", stderr: "failed" }, ["-lde", "/invented"]);
  assert.equal(failure.record.commands[0].failure_diagnostics, null);
  assert.equal(JSON.stringify(failure.record).includes("invented ACL text"), false);
  const success = memoryCommand({ status: 0, signal: null, stdout: "compiled", stderr: "" });
  assert.equal(success.error, undefined); assert.equal(success.value, "compiled");
  assert.equal(success.record.commands[0].failure_diagnostics, null); assert.deepEqual(success.printed, []);
});
test("C-C1b-3 record write failure keeps its original cause if the one FD close also fails", () => {
  const primary = Error("cc1b3_record_write"), close = Error("invented_close"); let closes = 0;
  const context = { record: { status: "BUILD_FAILED_RETAINED" }, checkPins: () => {}, qualify: () => {}, Buffer,
    output: "/invented", join, refuse: (c) => { throw Error(`cc1b3_${c}`); },
    fs: { constants: { O_RDWR: 1, O_CREAT: 2, O_EXCL: 4, O_NOFOLLOW: 8 }, openSync: () => 1,
      writeSync: () => { throw primary; }, closeSync: () => { closes++; throw close; } } };
  let error; try { vm.runInNewContext(`(${functionSource("exclusiveRecord")})()`, context); } catch (e) { error = e; }
  assert.equal(error.message, "cc1b3_record_and_close_failed"); assert.equal(error.cause, primary);
  assert.equal(error.errors[0], primary); assert.equal(error.errors[1], close); assert.equal(closes, 1);
});

test("C-C1b-3 plans only two fixed isolated compile modes with no signing or execution", () => {
  for (const mode of ["normal", "ubsan"]) {
    const p = describeUnsignedIsolatedBuild(mode);
    assert.equal(p.output, `build/b3cc-validation/${mode}`);
    assert.equal(p.native_execution_available, false);
    assert.ok(p.addon.includes("-DNATIVE_BAR_SYNTHETIC_ONLY=1"));
    for (const args of [p.addon, p.observer]) {
      assert.ok(args.includes("-Werror")); assert.ok(args.includes("-Wl,-no_adhoc_codesign"));
      assert.equal(args.includes("-fsanitize=undefined"), mode === "ubsan");
    }
    assert.deepEqual(p.typescript.slice(-2), ["--outDir", p.output]);
    assert.equal(Object.isFrozen(p.addon), true);
  }
  for (const bad of [null, "", "normal/../other", "ubsan --run", {}])
    assert.throws(() => describeUnsignedIsolatedBuild(bad), /cc1b3_mode/);
});
function object(kind = "addon", architecture = "arm64", commands = []) {
  const size = commands.reduce((n, c) => n + c.length, 0), b = Buffer.alloc(32 + size);
  b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4);
  b.writeUInt32LE(kind === "addon" ? 8 : 2, 12); b.writeUInt32LE(commands.length, 16); b.writeUInt32LE(size, 20);
  let offset = 32; for (const c of commands) { b.writeUInt32LE(c.command, offset); b.writeUInt32LE(c.length, offset + 4); offset += c.length; } return b;
}
test("C-C1b-3 byte inspection distinguishes object type and CPU without loading compiled code", () => {
  for (const kind of ["addon", "observer"]) for (const arch of ["arm64", "x64"]) {
    const result = inspectUnsignedMachO(object(kind, arch, [{ command: 0x19, length: 16 }]), kind, arch);
    assert.equal(result.native_status, "NOT_RUN"); assert.equal(result.code_signature_present, false);
    assert.equal(result.native_execution_available, false);
  }
});
test("C-C1b-3 signature and malformed load commands fail closed in memory", () => {
  assert.throws(() => inspectUnsignedMachO(object("addon", "arm64", [{ command: 0x1d, length: 16 }]), "addon", "arm64"), /cc1b3_code_signature/);
  for (const bytes of [Buffer.alloc(31), object("observer"), object("addon", "x64"),
    object("addon", "arm64", [{ command: 1, length: 16 }]).subarray(0, 40)])
    assert.throws(() => inspectUnsignedMachO(bytes, "addon", "arm64"), /cc1b3_macho/);
  const b = object(); b.writeUInt32LE(257, 16); assert.throws(() => inspectUnsignedMachO(b, "addon", "arm64"), /cc1b3_macho/);
});
test("C-C1b-3 build entry is explicit, exclusive and disconnected from native execution", () => {
  const source = readFileSync(new URL("../../native/native_bar_fs/build_unsigned.mjs", import.meta.url), "utf8");
  assert.match(source, /process\.argv\[2\] !== "--build-only"/);
  assert.ok(source.indexOf('refuse("explicit_build_only_required")') < source.indexOf("directory(output)"));
  assert.match(source, /fs\.lstatSync\(output\); refuse\("output_exists"\)/);
  assert.match(source, /O_EXCL \| fs\.constants\.O_NOFOLLOW/);
  assert.match(source, /CLANG_MODULE_CACHE_PATH/); assert.match(source, /source_changed/);
  assert.doesNotMatch(source, /\b(?:require|sign|createPrivateKey|dlopen|unlinkSync|rmSync|rmdirSync|renameSync|execSync)\s*\(|import\s*\(|recursive\s*:|--run|codesign\"/);
  assert.doesNotMatch(source, /unsignedInertAdapters|test_unsigned_worker|fixedMemoryCheckpointOracle|\.kill\(/);
  const old = readFileSync(new URL("../../native/native_bar_fs/build.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(old, /build_unsigned|unsignedBuildPlan|b3cc-validation/);
});
test("C-C1b-3 pure parity uses only the explicit fixed mode, never fills common build or loads an addon", () => {
  const source = readFileSync(new URL("./nativeBarAdmissionUnsignedAdapters.test.mjs", import.meta.url), "utf8");
  assert.match(source, /mode !== undefined && mode !== "normal" && mode !== "ubsan"/);
  assert.match(source, /build\/b3cc-validation\/\$\{mode\}\/nativeBarAdmissionJointReadContracts\.js/);
  assert.match(source, /block\(process, \["dlopen"\]\)/);
  assert.doesNotMatch(source, /build_unsigned\.mjs|spawnSync\([^)]*tsc/);
});
