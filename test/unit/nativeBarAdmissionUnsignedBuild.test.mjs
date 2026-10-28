import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";
import { describeUnsignedIsolatedBuild, inspectUnsignedMachO, pureJointContractsSpecifier } from "../helpers/unsignedBuildPlan.mjs";

// The wrapper only runs on macOS, so its extracted functions get POSIX path semantics on every CI host.
const { dirname, join, relative } = path.posix;
const buildSource = readFileSync(new URL("../../native/native_bar_fs/build_unsigned.mjs", import.meta.url), "utf8");
const parse = (text, name = "build.mjs") => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const buildTree = parse(buildSource);
const declaration = (name) => buildTree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name
  || ts.isVariableStatement(n) && n.declarationList.declarations.some((d) => d.name.getText() === name))?.getText() ?? "";
// Extracted declarations run strict, as in the ES module, so an undeclared assignment throws instead of creating a global.
const run = (names, call, context) => vm.runInNewContext(`"use strict";\n${names.map(declaration).join("\n")}\n${call}`, context);
const sha = (b) => createHash("sha256").update(b).digest("hex");
const walk = (n, f) => { f(n); ts.forEachChild(n, (c) => walk(c, f)); };
const output = "/invented/build/b3cc-validation";

function memoryBuild({ failAt = null, failMode = null, failSave = false, existing = false, env = {} } = {}) {
  const created = [], saved = [], printed = [], masks = [], order = []; let saveAttempts = 0, qualified = 0;
  const primary = Error(`cc1b3_${failAt}_failure`), saveError = Error("cc1b3_record_write");
  const context = {
    root: "/invented", output, allocated: false, record: undefined, environment: undefined, parents: [], dirname, join, relative, Date,
    process: { argv: ["node", "build.mjs", "--build-only"], platform: "darwin", arch: "arm64", execArgv: [], env,
      version: "v24", versions: { modules: "137" }, umask: (mask) => { masks.push(mask); return 0o027; } },
    qualify: () => { qualified++; if (failAt === "parent") throw primary; },
    directory: (p) => { if (p === output && failAt === "root" || p === join(output, "scratch") && failAt === "scratch") throw primary; created.push(p); },
    fs: { lstatSync: () => { if (existing) return {}; throw Object.assign(Error("absent"), { code: "ENOENT" }); } },
    snapshot: () => { if (failAt === "snapshot") throw primary; return { rows: [], sha256: "invented" }; },
    command: () => { if (failAt === "tool") throw primary; return "invented-commit\n"; },
    worktree: () => ({ clean: true }), toolchain: () => ({ record: { compiler: "/invented/clang++" } }), typescriptInputs: () => ({ rows: [], sha256: "inputs" }),
    buildMode: (mode) => { if (mode === failMode) throw primary; context.record.artifacts.push({ path: `build/b3cc-validation/${mode}/invented.js` }); },
    sameJavaScript: () => order.push("same"), retainedOutputs: () => { order.push("inventory"); return { qualified: false, rows: [] }; },
    exclusiveRecord: () => { order.push("save"); saveAttempts++; if (failSave) throw saveError; saved.push(JSON.parse(JSON.stringify(context.record))); },
    console: { log: (s) => printed.push(s) },
  };
  let error; try { run(["refuse", "errorCode", "inheritedOptions", "buildOnly"], "buildOnly()", context); } catch (e) { error = e; }
  return { created, saved, printed, masks, order, saveAttempts, qualified, error, primary, saveError };
}

test("C-C1b-3 records safe-root scratch/source failures with unreached provenance left null", () => {
  for (const failAt of ["scratch", "snapshot"]) {
    const r = memoryBuild({ failAt });
    assert.equal(r.error, r.primary); assert.equal(r.saveAttempts, 1); assert.equal(r.saved.length, 1);
    assert.equal(r.saved[0].status, "BUILD_FAILED_RETAINED"); assert.equal(r.saved[0].error, r.primary.message);
    for (const field of ["source", "source_commit", "source_worktree", "toolchain", "typescript_inputs"]) assert.equal(r.saved[0][field], null, field);
    assert.ok(r.saved[0].started_at); assert.ok(r.saved[0].ended_at); assert.deepEqual(r.saved[0].retained_outputs, { qualified: false, rows: [] });
    assert.deepEqual(r.order, ["inventory", "save"]); assert.deepEqual(r.printed, []);
    assert.deepEqual(r.masks, [0o077, 0o027]);
  }
});
test("C-C1b-3 never records into an unqualified, unallocated or existing output root", () => {
  for (const options of [{ failAt: "parent" }, { failAt: "root" }, { existing: true }]) {
    const r = memoryBuild(options);
    assert.ok(r.error); assert.equal(r.saveAttempts, 0); assert.deepEqual(r.order, []); assert.deepEqual(r.printed, []);
    assert.deepEqual(r.created, []); assert.deepEqual(r.masks, [0o077, 0o027]);
  }
  assert.match(memoryBuild({ existing: true }).error.message, /cc1b3_output_exists/);
});
test("C-C1b-3 inherited Node, loader and compiler options refuse before any change", () => {
  for (const env of [{ NODE_COMPILE_CACHE: "/invented" }, { NODE_V8_COVERAGE: "/invented" }, { DYLD_FRAMEWORK_PATH: "/invented" },
    { DYLD_FALLBACK_LIBRARY_PATH: "/invented" }, { NODE_OPTIONS: "" }, { CFLAGS: "-O0" }, { SDKROOT: "/invented" }]) {
    const r = memoryBuild({ env });
    assert.match(r.error.message, /cc1b3_inherited_options/); assert.equal(r.qualified, 0); assert.deepEqual(r.masks, []); assert.equal(r.saveAttempts, 0);
  }
});
test("C-C1b-3 preserves both original build and record failures without retry or success output", () => {
  const r = memoryBuild({ failAt: "tool", failSave: true });
  assert.equal(r.error.message, "cc1b3_build_and_record_failed");
  assert.equal(r.error.cause, r.primary); assert.equal(r.error.errors[0], r.primary); assert.equal(r.error.errors[1], r.saveError);
  assert.equal(r.saveAttempts, 1); assert.deepEqual(r.saved, []); assert.deepEqual(r.printed, []);
  assert.deepEqual(r.masks, [0o077, 0o027]);
});
test("C-C1b-3 success prints once after saving; a lone save failure throws it and prints nothing", () => {
  const ok = memoryBuild();
  assert.equal(ok.error, undefined); assert.equal(ok.saved[0].status, "COMPILED_NOT_RUN"); assert.equal(ok.saved[0].error, null);
  assert.equal(ok.saved[0].source_commit, "invented-commit"); assert.deepEqual(ok.saved[0].source_worktree, { clean: true });
  assert.deepEqual(ok.order, ["same", "inventory", "save"]); assert.equal(ok.printed.length, 1);
  assert.equal(JSON.parse(ok.printed[0]).status, "COMPILED_NOT_RUN"); assert.deepEqual(ok.masks, [0o077, 0o027]);
  const failed = memoryBuild({ failSave: true });
  assert.equal(failed.error, failed.saveError); assert.equal(failed.saveAttempts, 1); assert.deepEqual(failed.printed, []);
  assert.deepEqual(failed.masks, [0o077, 0o027]);
});
test("C-C1b-3 a later-mode failure keeps the earlier mode's artifacts and saves the retained-output inventory", () => {
  const r = memoryBuild({ failMode: "ubsan" });
  assert.equal(r.error, r.primary); assert.equal(r.saved[0].status, "BUILD_FAILED_RETAINED");
  assert.deepEqual(r.saved[0].artifacts.map((a) => a.path), ["build/b3cc-validation/normal/invented.js"]);
  assert.deepEqual(r.saved[0].retained_outputs, { qualified: false, rows: [] }); assert.deepEqual(r.order, ["inventory", "save"]);
});

function memoryCommand(result, args = ["node_modules/typescript/bin/tsc"], program = "/invented/node") {
  const record = { commands: [] }, printed = [], calls = [];
  const context = { root: "/invented", environment: {}, record, Buffer, TextDecoder, process: { execPath: "/invented/node" },
    // Like the real spawnSync, a requested text encoding replaces the raw bytes before the caller sees them.
    spawnSync: (p, argv, options) => {
      calls.push({ program: p, args: argv, options });
      const view = (b) => options?.encoding && options.encoding !== "buffer" ? b.toString(options.encoding) : b;
      return { ...result, stdout: view(result.stdout), stderr: view(result.stderr) };
    },
    hash: sha, console: { error: (s) => printed.push(s) } };
  let error, value;
  try { value = run(["refuse", "compilerDiagnostics", "command"], "command(program, args)", { ...context, program, args }); } catch (e) { error = e; }
  return { record, printed, calls, error, value };
}
const failed = (stdout, stderr = Buffer.alloc(0)) => ({ status: 1, signal: null, stdout: Buffer.from(stdout), stderr: Buffer.from(stderr) });

test("C-C1b-3 retains and displays TypeScript stdout failure diagnostics without a retry", () => {
  const diagnostic = "src/invented.ts(1,1): error TS2322: incompatible type\n";
  const r = memoryCommand({ status: 2, signal: null, stdout: Buffer.from(diagnostic), stderr: Buffer.alloc(0) });
  assert.match(r.error.message, /cc1b3_tool_failed/); assert.equal(r.calls.length, 1);
  assert.deepEqual(r.printed, [diagnostic]);
  assert.equal(r.record.commands[0].failure_diagnostics.stdout.prefix, diagnostic);
  assert.equal(r.record.commands[0].failure_diagnostics.stdout.truncated, false);
  assert.equal(r.record.commands[0].stdout_sha256, sha(diagnostic));
});
test("C-C1b-3 every fixed compile command, in both modes, keeps its failure diagnostics", () => {
  const sdk = (args) => args.map((v) => v === "$SDK" ? "/invented/sdk" : v === "$HEADERS" ? "/invented/headers" : v);
  const commands = [[["node_modules/typescript/bin/tsc", "--project", "tsconfig.json", "--listFilesOnly"], "/invented/node"]];
  for (const mode of ["normal", "ubsan"]) {
    const plan = describeUnsignedIsolatedBuild(mode);
    commands.push([[...plan.typescript], "/invented/node"], [sdk(plan.addon), "/invented/clang++"], [sdk(plan.observer), "/invented/clang++"]);
  }
  for (const [args, program] of commands) {
    const r = memoryCommand(failed("invented diagnostic\n"), args, program);
    assert.equal(r.record.commands[0].failure_diagnostics?.stdout.prefix, "invented diagnostic\n", args.join(" "));
  }
});
test("C-C1b-3 compiler diagnostic prefixes stay within 16 KiB per stream at UTF-8 boundaries", () => {
  const text = "x".repeat(16383) + "日本語".repeat(10000);
  const r = memoryCommand(failed(text, text), ["-o", "invented-output", "native/native_bar_fs/admission_unsigned_observer.cc"], "/invented/clang++");
  for (const name of ["stdout", "stderr"]) {
    const d = r.record.commands[0].failure_diagnostics[name];
    assert.ok(Buffer.byteLength(d.prefix) <= 16384); assert.equal(d.observed_bytes, Buffer.byteLength(text));
    assert.equal(d.truncated, true); assert.equal(d.prefix, "x".repeat(16383)); assert.equal(d.lossless, true);
  }
  assert.equal(r.calls.length, 1); assert.equal(r.printed.length, 2);
  // Invalid bytes decode to three-byte replacement characters; the stored prefix is cut again so it never exceeds the bound.
  const invalid = memoryCommand(failed(Buffer.alloc(16384, 0xff)), ["node_modules/typescript/bin/tsc"]).record.commands[0].failure_diagnostics.stdout;
  assert.ok(Buffer.byteLength(invalid.prefix) <= 16384); assert.equal(invalid.observed_bytes, 16384);
  assert.equal(invalid.truncated, true); assert.equal(invalid.lossless, false);
});
test("C-C1b-3 command hashes and counts the raw captured bytes, never re-encoded text", () => {
  const raw = Buffer.from([0x61, 0xff, 0xfe, 0x62]);
  const r = memoryCommand({ status: 1, signal: null, stdout: raw, stderr: raw }, ["node_modules/typescript/bin/tsc"]);
  const c = r.record.commands[0];
  assert.equal(c.stdout_sha256, sha(raw)); assert.equal(c.stderr_sha256, sha(raw)); assert.equal(c.stdout_bytes, 4); assert.equal(c.stderr_bytes, 4);
  assert.equal(c.failure_diagnostics.stdout.observed_bytes, 4); assert.equal(c.failure_diagnostics.stdout.lossless, false);
  assert.equal(c.failure_diagnostics.stdout.truncated, false);
  assert.equal(r.calls[0].options.encoding, undefined); assert.equal(r.calls[0].options.shell, false);
});
test("C-C1b-3 ACL calls are recorded by hash; noncompiler and successful output never persist or print stdout text", () => {
  const acl = memoryCommand(failed("invented ACL text", "invented stderr"), ["-lde", "/invented"], "/bin/ls");
  assert.equal(acl.record.commands.length, 1); assert.equal(acl.record.commands[0].program, "/bin/ls");
  assert.equal(acl.record.commands[0].failure_diagnostics, null); assert.equal(acl.record.commands[0].stdout_sha256, sha("invented ACL text"));
  assert.equal(/invented (ACL text|stderr)/.test(JSON.stringify(acl.record)), false);
  assert.deepEqual(acl.printed, ["invented stderr"]);
  const listed = memoryCommand({ status: 0, signal: null, stdout: Buffer.from("drwx------ invented\n"), stderr: Buffer.alloc(0) }, ["-lde", "/invented"], "/bin/ls");
  assert.equal(listed.record.commands.length, 1); assert.equal(listed.value, "drwx------ invented\n");
  const success = memoryCommand({ status: 0, signal: null, stdout: Buffer.from("compiled"), stderr: Buffer.from("note") });
  assert.equal(success.error, undefined); assert.equal(success.value, "compiled");
  assert.equal(success.record.commands[0].failure_diagnostics, null); assert.deepEqual(success.printed, []);
  assert.equal(/compiled|note/.test(JSON.stringify(success.record)), false);
});

function memoryRecord({ failWrite = false, failClose = false, failQualify = null, readback = null } = {}) {
  const calls = [], primary = Error("cc1b3_record_write"), close = Error("invented_close");
  const context = { record: { status: "BUILD_FAILED_RETAINED" }, output, parents: ["/invented/build", "/invented", "/"], join, Buffer,
    checkPins: () => calls.push("pins"),
    qualify: (p) => { calls.push(`qualify:${p}`); if (p === failQualify) throw Error("cc1b3_output_acl"); },
    fs: { constants: { O_RDWR: 1, O_CREAT: 2, O_EXCL: 4, O_NOFOLLOW: 8 },
      openSync: () => { calls.push("open"); return 7; }, fsyncSync: () => calls.push("fsync"),
      writeSync: (fd, bytes, offset, length) => { calls.push("write"); if (failWrite) throw primary; return length; },
      readSync: (fd, copy, offset, length) => { calls.push("read"); (readback ?? context.written).copy(copy, offset); return length; },
      closeSync: () => { calls.push("close"); if (failClose) throw close; } } };
  context.written = Buffer.from(JSON.stringify(context.record, null, 2) + "\n");
  let error; try { run(["refuse", "closing", "exclusiveRecord"], "exclusiveRecord()", context); } catch (e) { error = e; }
  return { calls, error, primary, close };
}
test("C-C1b-3 record writer re-qualifies the destination chain, including ACLs, before creating the file", () => {
  const ok = memoryRecord();
  assert.equal(ok.error, undefined);
  assert.deepEqual(ok.calls, ["pins", "qualify:/invented/build", "qualify:/invented", "qualify:/", `qualify:${output}`, "open",
    `qualify:${output}/build-record.json`, "write", "fsync", "read", "close"]);
  for (const p of ["/invented", output]) {
    const r = memoryRecord({ failQualify: p });
    assert.match(r.error.message, /cc1b3_output_acl/); assert.equal(r.calls.includes("open"), false);
  }
});
test("C-C1b-3 record write failure keeps its original cause if the one FD close also fails, with no retry", () => {
  const r = memoryRecord({ failWrite: true, failClose: true });
  assert.equal(r.error.message, "cc1b3_record_and_close_failed"); assert.equal(r.error.cause, r.primary);
  assert.equal(r.error.errors[0], r.primary); assert.equal(r.error.errors[1], r.close);
  for (const call of ["open", "write", "close"]) assert.equal(r.calls.filter((c) => c === call).length, 1, call);
  assert.equal(r.calls.includes("read"), false);
  const mismatch = memoryRecord({ readback: Buffer.alloc(Buffer.byteLength(JSON.stringify({ status: "BUILD_FAILED_RETAINED" }, null, 2) + "\n"), 0x20) });
  assert.match(mismatch.error.message, /cc1b3_record_readback/); assert.equal(mismatch.calls.filter((c) => c === "close").length, 1);
});
test("C-C1b-3 addon permission normalization keeps its refusal when the one close also fails", () => {
  const calls = [], close = Error("invented_close");
  const context = { process: { getuid: () => 501 }, fs: { constants: { O_RDONLY: 0, O_NOFOLLOW: 8 }, openSync: () => 7,
    fstatSync: () => ({ isFile: () => true, nlink: 2, uid: 501 }), fchmodSync: () => calls.push("chmod"),
    closeSync: () => { calls.push("close"); throw close; } } };
  let error; try { run(["refuse", "closing", "normalizeAddon"], 'normalizeAddon("/invented/addon.node")', context); } catch (e) { error = e; }
  assert.equal(error.message, "cc1b3_artifact_and_close_failed"); assert.match(error.cause.message, /cc1b3_artifact_type/);
  assert.equal(error.errors[1], close); assert.deepEqual(calls, ["close"]);
});

test("C-C1b-3 worktree status flags uncommitted source changes without taking optional locks", () => {
  for (const [status, clean, entries] of [["", true, 0], [" M src/invented.ts\0?? test/helpers/invented.mjs\0", false, 2]]) {
    const calls = [];
    const result = run(["sourceRoots", "worktree"], "worktree()", { hash: sha, command: (p, args) => { calls.push([p, Array.from(args)]); return status; } });
    assert.equal(result.clean, clean); assert.equal(result.entries, entries);
    assert.equal(calls[0][0], "/usr/bin/git");
    assert.deepEqual(calls[0][1], ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--",
      "src", "native/native_bar_fs", "test/helpers", "tsconfig.json", "package.json", "package-lock.json"]);
  }
});
function memoryInputs(listed, files = {}) {
  const context = { root: "/invented", relative, join, hash: sha, process: { execPath: "/invented/node" },
    command: () => listed.join("\n") + "\n",
    fs: { lstatSync: (p) => { const f = files[p] ?? "file"; return { isFile: () => f !== "link", size: 3 }; }, readFileSync: (p) => Buffer.from(`hash:${p}`) } };
  let error, value; try { value = run(["refuse", "hashInputs", "typescriptInputs"], "typescriptInputs()", context); } catch (e) { error = e; }
  return { error, value };
}
test("C-C1b-3 TypeScript inputs are exactly the files tsc lists inside the checkout, hashed and sorted", () => {
  const ok = memoryInputs(["/invented/src/b.ts", "/invented/node_modules/typescript/lib/lib.d.ts", "/invented/src/b.ts"]);
  assert.deepEqual(Array.from(ok.value.rows, (r) => r.path), ["node_modules/typescript/lib/lib.d.ts", "src/b.ts"]);
  assert.equal(ok.value.rows[1].sha256, sha("hash:/invented/src/b.ts")); assert.equal(ok.value.sha256, sha(JSON.stringify(ok.value.rows)));
  assert.match(memoryInputs(["/elsewhere/lib.d.ts"]).error.message, /cc1b3_typescript_input_outside_root/);
  assert.match(memoryInputs(["src/relative.ts"]).error.message, /cc1b3_typescript_input_outside_root/);
  assert.match(memoryInputs([]).error.message, /cc1b3_typescript_inputs/);
  assert.match(memoryInputs(Array.from({ length: 4097 }, (_, i) => `/invented/src/${i}.ts`)).error.message, /cc1b3_typescript_inputs/);
  assert.match(memoryInputs(["/invented/src/link.ts"], { "/invented/src/link.ts": "link" }).error.message, /cc1b3_typescript_input_type/);
});
test("C-C1b-3 missing local headers refuse with their own code instead of a raw ENOENT", () => {
  const context = { root: "/invented", join, dirname, resolve: path.posix.resolve, hash: sha, process: { execPath: "/invented/bin/node" },
    command: (p, args) => p === "/usr/bin/xcrun" ? (args.includes("--find") ? "/invented/clang++" : "/invented/sdk") : "/invented/runtime",
    fs: { realpathSync: (p) => p, statSync: (p) => p === "/invented/sdk" ? { isDirectory: () => true } : undefined, readFileSync: () => Buffer.alloc(0) } };
  assert.throws(() => run(["refuse", "nodeHeaders", "toolchain"], "toolchain()", context), /cc1b3_local_headers/);
});

function tree(entries) {
  const stat = (kind, size = 1) => ({ isDirectory: () => kind === "dir", isFile: () => kind === "file", isSymbolicLink: () => kind === "link", size, mode: kind === "dir" ? 0o40700 : 0o100600 });
  return { lstatSync: (p) => { if (!(p in entries)) throw Object.assign(Error("absent"), { code: "ENOENT" }); return stat(entries[p]); },
    readdirSync: (p) => Object.keys(entries).filter((k) => dirname(k) === p).map((k) => k.slice(p.length + 1)) };
}
function memoryArtifacts(names, sourceNames) {
  const base = `${output}/normal`, entries = { [base]: "dir", [`${base}/native-bar-fs`]: "dir" };
  for (const n of names) entries[`${base}/${n}`] = "file";
  for (const n of names) if (n.includes("/")) entries[dirname(`${base}/${n}`)] = "dir";
  const context = { root: "/invented", output, join, relative, hash: sha, JSON, process: { arch: "arm64" },
    qualify: (p, owned, mode) => ({ nlink: 1n, mode: BigInt(mode ?? 0o600) }), inspectUnsignedMachO: () => ({}),
    fs: { ...tree(entries), readFileSync: (p) => Buffer.from(p) } };
  const source = { rows: sourceNames.map((p) => ({ path: p })) };
  let error, value; try { value = run(["refuse", "artifacts"], "artifacts(mode, source)", { ...context, mode: "normal", source }); } catch (e) { error = e; }
  return { error, value };
}
test("C-C1b-3 emitted JS must be exactly one module per src TypeScript file, identical across modes", () => {
  const binaries = ["admission-unsigned-observer", "native-bar-fs/native_bar_fs.node"];
  const modules = ["nativeBarAdmissionJointReader", "nativeBarAdmissionJointReadContracts", "sub/invented"];
  const src = [...modules.map((m) => `src/${m}.ts`), "src/types.d.ts"];
  assert.equal(memoryArtifacts([...binaries, ...modules.map((m) => `${m}.js`)], src).value.length, 5);
  assert.match(memoryArtifacts([...binaries, ...modules.map((m) => `${m}.js`), "stale.js"], src).error.message, /cc1b3_artifact_set/);
  assert.match(memoryArtifacts([...binaries, ...modules.slice(0, 2).map((m) => `${m}.js`)], src).error.message, /cc1b3_artifact_set/);
  const same = (b) => run(["refuse", "sameJavaScript"], "sameJavaScript()", { record: { artifacts: [
    { path: "build/b3cc-validation/normal/a.js", sha256: "1" }, { path: "build/b3cc-validation/normal/admission-unsigned-observer", sha256: "2" },
    { path: "build/b3cc-validation/ubsan/a.js", sha256: b }, { path: "build/b3cc-validation/ubsan/admission-unsigned-observer", sha256: "3" }] } });
  assert.doesNotThrow(() => same("1")); assert.throws(() => same("4"), /cc1b3_mode_javascript_differs/);
});
test("C-C1b-3 retained-output inventory is bounded, never follows links and is never qualification", () => {
  const opened = [], entries = { [output]: "dir", [`${output}/scratch`]: "dir", [`${output}/scratch/link`]: "link", [`${output}/normal.js`]: "file" };
  const context = { root: "/invented", output, join, relative, hash: sha,
    fs: { ...tree(entries), constants: { O_RDONLY: 0, O_NOFOLLOW: 8, O_NONBLOCK: 4 }, openSync: (p, flags) => { opened.push([p, flags]); return 7; },
      readFileSync: (fd) => Buffer.from(`fd:${fd}`), closeSync: () => {} } };
  const r = run(["refuse", "errorCode", "closing", "retainedOutputs"], "retainedOutputs()", context);
  assert.equal(r.qualified, false); assert.equal(r.complete, true); assert.equal(r.error, null);
  assert.deepEqual(Array.from(r.rows, (x) => [x.path, x.type, x.sha256 ?? null]), [["build/b3cc-validation", "directory", null],
    ["build/b3cc-validation/normal.js", "file", sha("fd:7")], ["build/b3cc-validation/scratch", "directory", null], ["build/b3cc-validation/scratch/link", "symlink", null]]);
  assert.deepEqual(opened, [[`${output}/normal.js`, 12]]);
  for (let i = 0; i < 4100; i++) entries[`${output}/f${i}`] = "file";
  const bounded = run(["refuse", "errorCode", "closing", "retainedOutputs"], "retainedOutputs()", { ...context });
  assert.equal(bounded.complete, false); assert.equal(bounded.error, "cc1b3_inventory_bound"); assert.equal(bounded.rows.length, 4096);
});

test("C-C1b-3 plans only two fixed isolated compile modes with no signing or execution", () => {
  const common = ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-fvisibility=hidden", "-fstack-protector-strong", "-fno-modules", "-Wl,-no_adhoc_codesign", "-isysroot", "$SDK"];
  for (const mode of ["normal", "ubsan"]) {
    const p = describeUnsignedIsolatedBuild(mode), out = `build/b3cc-validation/${mode}`;
    const flags = [...common, ...(mode === "ubsan" ? ["-fsanitize=undefined", "-fno-sanitize-recover=all"] : [])];
    assert.equal(p.output, out); assert.equal(p.native_execution_available, false);
    assert.deepEqual(p.typescript, ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json", "--sourceMap", "false", "--incremental", "false", "--noEmitOnError", "--outDir", out]);
    assert.deepEqual(p.addon, [...flags, "-DNAPI_VERSION=8", "-DNATIVE_BAR_SYNTHETIC_ONLY=1", "-bundle", "-undefined", "dynamic_lookup",
      "-framework", "CoreFoundation", "-I", "$HEADERS", "native/native_bar_fs/native_bar_fs.cc", "-o", `${out}/native-bar-fs/native_bar_fs.node`]);
    assert.deepEqual(p.observer, [...flags, "native/native_bar_fs/admission_unsigned_observer.cc", "-o", `${out}/admission-unsigned-observer`]);
    assert.equal(Object.isFrozen(p.addon), true);
  }
  for (const bad of [null, "", "normal/../other", "ubsan --run", {}])
    assert.throws(() => describeUnsignedIsolatedBuild(bad), /cc1b3_mode/);
});
function object(kind = "addon", architecture = "arm64", commands = [], slack = 0) {
  const size = commands.reduce((n, c) => n + c.length, 0) + slack, b = Buffer.alloc(32 + size);
  b.writeUInt32LE(0xfeedfacf, 0); b.writeUInt32LE(architecture === "arm64" ? 0x0100000c : 0x01000007, 4);
  b.writeUInt32LE(kind === "addon" ? 8 : 2, 12); b.writeUInt32LE(commands.length, 16); b.writeUInt32LE(size, 20);
  let offset = 32; for (const c of commands) { b.writeUInt32LE(c.command, offset); b.writeUInt32LE(c.length, offset + 4); offset += Math.max(c.length, 8); } return b;
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
    object("addon", "arm64", [{ command: 1, length: 16 }]).subarray(0, 40),
    object("addon", "arm64", [{ command: 0x19, length: 12 }, { command: 0x19, length: 12 }]),
    object("addon", "arm64", [{ command: 0x19, length: 16 }], 8)])
    assert.throws(() => inspectUnsignedMachO(bytes, "addon", "arm64"), /cc1b3_macho/);
  const b = object(); b.writeUInt32LE(257, 16); assert.throws(() => inspectUnsignedMachO(b, "addon", "arm64"), /cc1b3_macho/);
});

// Structural execution boundary: fixed imports, one spawn site, an exact tool-call allowlist and site-bound filesystem mutation.
const expectedImports = ['import fs from "node:fs";', 'import { spawnSync } from "node:child_process";', 'import { createHash } from "node:crypto";',
  'import { dirname, join, resolve, relative } from "node:path";', 'import { fileURLToPath, pathToFileURL } from "node:url";',
  'import { describeUnsignedIsolatedBuild, inspectUnsignedMachO } from "../../test/helpers/unsignedBuildPlan.mjs";'];
const allowedCommands = [
  '"/bin/ls" ["-lde", path]',
  '"/usr/bin/git" ["-c", "core.fsmonitor=false", "rev-parse", "HEAD"]',
  '"/usr/bin/git" ["-c", "core.fsmonitor=false", "--no-optional-locks", "status", "--porcelain=v1", "-z", "--untracked-files=all", "--", ...sourceRoots]',
  '"/usr/bin/xcrun" ["--no-cache", "--find", "clang++"]', '"/usr/bin/xcrun" ["--no-cache", "--sdk", "macosx", "--show-sdk-path"]',
  '"/usr/bin/xcrun" ["--no-cache", "--sdk", "macosx", "--show-sdk-version"]',
  'compiler ["-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib"]', 'compiler ["-print-prog-name=ld"]', 'compiler ["--version"]',
  'process.execPath ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json", "--listFilesOnly"]', "process.execPath plan.typescript",
  "tools.compiler expand(plan.addon)", "tools.compiler expand(plan.observer)"];
const fsSites = { mkdirSync: ["directory"], openSync: ["exclusiveRecord", "normalizeAddon", "retainedOutputs"], writeSync: ["exclusiveRecord"],
  fsyncSync: ["exclusiveRecord"], fchmodSync: ["normalizeAddon"], O_CREAT: ["exclusiveRecord"] };
const fsReads = new Set(["lstatSync", "statSync", "fstatSync", "readdirSync", "readFileSync", "readSync", "closeSync", "realpathSync", "constants"]);
const processKeys = new Set(["argv", "platform", "arch", "execArgv", "env", "umask", "execPath", "getuid", "version", "versions"]);
const banned = new Set(["require", "createRequire", "dlopen", "Worker", "fork", "exec", "execSync", "execFile", "execFileSync", "spawn", "eval",
  "Function", "globalThis", "global", "Module", "kill"]);
function executionBoundary(source) {
  const sourceTree = parse(source), problems = [], used = new Set(); let spawns = 0, umasks = 0;
  const imports = sourceTree.statements.filter(ts.isImportDeclaration).map((n) => n.getText());
  if (JSON.stringify(imports) !== JSON.stringify(expectedImports)) problems.push("imports");
  const visit = (n, site) => {
    if (ts.isFunctionDeclaration(n) && n.parent === sourceTree) site = n.name.text;
    if (ts.isIdentifier(n) && banned.has(n.text)) problems.push(`banned:${n.text}`);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) problems.push("dynamic_import");
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "spawnSync") { spawns++; if (site !== "command") problems.push(`spawn:${site}`); }
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "command") {
      const text = n.arguments.map((a) => a.getText()).join(" ");
      if (n.arguments.length !== 2 || !allowedCommands.includes(text)) problems.push(`command:${text}`); else used.add(text);
    }
    if (ts.isPropertyAccessExpression(n)) {
      const owner = n.expression.getText(), key = n.name.text;
      if ((owner === "fs" || owner === "fs.constants") && key in fsSites && !fsSites[key].includes(site)) problems.push(`fs:${key}@${site}`);
      if (owner === "fs" && !(key in fsSites) && !fsReads.has(key)) problems.push(`fs:${key}`);
      if (owner === "process" && !processKeys.has(key)) problems.push(`process:${key}`);
      if (owner === "process" && key === "umask" && (++umasks > 2 || site !== "buildOnly")) problems.push(`umask@${site}`);
    }
    if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && /admission-unsigned-observer|\.node\b/.test(n.text)
      && !["artifacts", "buildMode"].includes(site)) problems.push(`native_reference@${site}`);
    ts.forEachChild(n, (c) => visit(c, site));
  };
  visit(sourceTree, null);
  if (spawns !== 1) problems.push(`spawns:${spawns}`);
  if (umasks !== 2) problems.push(`umasks:${umasks}`);
  for (const c of allowedCommands) if (!used.has(c)) problems.push(`unused:${c}`);
  return problems;
}
test("C-C1b-3 build entry is structurally disconnected from native execution", () => {
  assert.deepEqual(executionBoundary(buildSource), []);
  const anchor = "    record.status = \"COMPILED_NOT_RUN\";";
  assert.equal(buildSource.split(anchor).length, 2);
  const after = (code) => buildSource.replace(anchor, `${code}\n${anchor}`);
  for (const mutated of [
    after('    command(join(output, "normal", "admission-unsigned-observer"), []);'),
    after('    command(join(output, "normal", "native-bar-fs/native_bar_fs.node"), ["--run"]);'),
    after("    command(compiler, [\"--version\", \"--run\"]);"),
    buildSource.replace('import { createHash } from "node:crypto";', 'import { createHash } from "node:crypto";\nimport { createRequire } from "node:module";'),
    after('    createRequire(import.meta.url)(join(output, "normal"));'),
    after('    spawnSync(process.execPath, ["--eval", "0"]);'),
    after('    import(join(output, "normal/index.js"));'),
    after("    process.dlopen({}, output);"), after("    process.binding(\"fs\");"),
    after("    fs.rmSync(output);"), after("    fs.chmodSync(output, 0o755);"), after("    fs.fchmodSync(3, 0o755);"),
    after("    fs.openSync(output, fs.constants.O_CREAT);"), after("    process.umask(0);"),
    after('    const lib = "admission-unsigned-observer";'), after("    new Worker(output);"),
  ]) assert.notDeepEqual(executionBoundary(mutated), [], mutated.slice(mutated.indexOf(anchor) - 120, mutated.indexOf(anchor)));
});
test("C-C1b-3 build entry is explicit and exclusive, and the common build is unchanged", () => {
  const body = buildTree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "buildOnly").body.statements;
  assert.equal(body[0].getText(), 'if (process.argv.length !== 3 || process.argv[2] !== "--build-only") refuse("explicit_build_only_required");');
  assert.match(buildSource, /fs\.lstatSync\(output\); refuse\("output_exists"\)/);
  assert.match(buildSource, /O_EXCL \| fs\.constants\.O_NOFOLLOW/); assert.match(buildSource, /CLANG_MODULE_CACHE_PATH/);
  const old = readFileSync(new URL("../../native/native_bar_fs/build.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(old, /build_unsigned|unsignedBuildPlan|b3cc-validation/);
});
test("C-C1b-3 parity route maps only fixed modes, refuses mixed stage flags and has no fallback", () => {
  const common = "../../build/nativeBarAdmissionJointReadContracts.js";
  assert.equal(pureJointContractsSpecifier({}), common);
  assert.equal(pureJointContractsSpecifier({ NATIVE_BAR_B3BC_ISOLATED_TEST: "1" }), common);
  for (const mode of ["normal", "ubsan"])
    assert.equal(pureJointContractsSpecifier({ NATIVE_BAR_B3CC_MODE: mode }), `../../build/b3cc-validation/${mode}/nativeBarAdmissionJointReadContracts.js`);
  for (const mode of ["", "../../x", "NORMAL", "normal ", "1"]) assert.throws(() => pureJointContractsSpecifier({ NATIVE_BAR_B3CC_MODE: mode }), /cc1b3_parity_mode/);
  for (const flag of ["NATIVE_BAR_B2B_ISOLATED_TEST", "NATIVE_BAR_B3BA_ISOLATED_TEST", "NATIVE_BAR_B3BB_ISOLATED_TEST", "NATIVE_BAR_B3BC_ISOLATED_TEST", "NATIVE_BAR_B3CA_ISOLATED_TEST"])
    assert.throws(() => pureJointContractsSpecifier({ NATIVE_BAR_B3CC_MODE: "normal", [flag]: "1" }), /cc1b3_parity_mode/);
  // The parity test's first statement is the single routed import: nothing wraps, catches or replaces it.
  const adapters = readFileSync(new URL("./nativeBarAdmissionUnsignedAdapters.test.mjs", import.meta.url), "utf8"), dynamic = [];
  let body; walk(parse(adapters, "adapters.mjs"), (n) => {
    if (ts.isCallExpression(n) && n.expression.getText() === "test" && n.arguments[0].text?.startsWith("C-C1b-2 configuration refuses exactly")) body = n.arguments[1].body.statements;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) dynamic.push(n.arguments[0].getText());
  });
  assert.equal(body[0].getText(), "const joint = await import(new URL(buildPlan.pureJointContractsSpecifier(process.env), import.meta.url));");
  assert.ok(dynamic.every((s) => /^"\.\.\/helpers\/[A-Za-z]+\.mjs"$/.test(s) || s === "new URL(buildPlan.pureJointContractsSpecifier(process.env), import.meta.url)"), dynamic.join());
  assert.doesNotMatch(adapters, /NATIVE_BAR_B3CC_MODE|nativeBarAdmissionJointReadContracts\.js/);
  assert.match(adapters, /block\(process, \["dlopen"\]\)/);
});
