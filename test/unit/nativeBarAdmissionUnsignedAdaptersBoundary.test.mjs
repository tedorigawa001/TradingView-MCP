import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";
import ts from "typescript";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const live = read("../helpers/unsignedInertAdapters.mjs"), support = read("../helpers/unsignedAdapterSupport.mjs"), config = read("../helpers/unsignedWorkerConfiguration.mjs");
const cpp = read("../../native/native_bar_fs/admission_unsigned_observer.cc"), worker = read("../../native/native_bar_fs/test_unsigned_worker.mjs");
const ast = (s) => ts.createSourceFile("input.mjs", s, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const walk = (n, f) => { f(n); ts.forEachChild(n, (c) => walk(c, f)); };
const exported = (tree) => tree.statements.filter((n) => n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name?.text);
const imports = (tree) => tree.statements.filter(ts.isImportDeclaration).map((n) => [n.moduleSpecifier.text,
  n.importClause?.namedBindings?.elements?.map((e) => e.propertyName ? `${e.propertyName.text}:${e.name.text}` : e.name.text)]);
function pure(s, expectedImports, expectedExports) {
  const tree = ast(s); assert.deepEqual(imports(tree), expectedImports); assert.deepEqual(exported(tree), expectedExports);
  const banned = new Set(["process", "global", "globalThis", "crypto", "Date", "performance", "Intl", "require", "createRequire", "dlopen", "eval", "Function", "fetch",
    "Worker", "createPrivateKey", "createPublicKey", "sign", "spawn", "fork", "writeFileSync", "rmSync", "openSync", "setTimeout", "setImmediate"]);
  walk(tree, (n) => {
    if (ts.isIdentifier(n)) assert.equal(banned.has(n.text), false, n.text);
    assert.equal(ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword, false);
    assert.equal(ts.isExportDeclaration(n) || ts.isExportAssignment(n), false);
    if (ts.isPropertyAccessExpression(n)) assert.notEqual(n.name.text, "constructor");
  });
}
const supportImports = [["node:crypto", ["createHash"]], ["zod", ["z"]], ["./jointUnsignedAcceptanceContracts.mjs", ["describeUnsignedFixture"]]];
const configImports = [["node:crypto", ["createHash"]], ["zod", ["z"]], ["./jointUnsignedAcceptanceContracts.mjs", ["describeUnsignedFixture", "describeUnsignedAcceptanceRun"]]];
test("C-C1b-2 byte/write/configuration helpers have only exact pure dependencies and bounded data exports", () => {
  pure(support, supportImports, ["createUnsignedProtocolDecoder", "createUnsignedWriteCursor", "describeUnsignedObserverRequest", "classifyUnsignedObserverExit",
    "inspectUnsignedObserverResponse", "createUnsignedOutputSummary"]);
  pure(config, configImports, ["validateUnsignedWorkerConfiguration"]);
});
function sealed(s) {
  const tree = ast(s); assert.deepEqual(exported(tree), ["inspectUnsignedAdapters", "executeUnsignedAdapters"]);
  assert.deepEqual(imports(tree), [["node:crypto", ["createHash"]], ["./jointUnsignedAcceptanceContracts.mjs", ["describeUnsignedFixture", "describeUnsignedAcceptanceRun", "createUnsignedOwnershipModel"]],
    ["./unsignedExecutionContracts.mjs", ["createUnsignedExecutionEvidenceModel"]],
    ["./unsignedAdapterSupport.mjs", ["createUnsignedProtocolDecoder", "createUnsignedWriteCursor", "describeUnsignedObserverRequest", "inspectUnsignedObserverResponse", "createUnsignedOutputSummary",
      "classifyUnsignedObserverExit"]],
    ["./unsignedWorkerConfiguration.mjs", ["validateUnsignedWorkerConfiguration"]]]);
  const execute = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "executeUnsignedAdapters");
  assert.equal(execute.body.statements.length, 1); assert.equal(execute.body.statements[0].getText(), 'throw Error("cc1b2_execution_not_approved");');
  const privateNames = new Set(tree.statements.filter((n) => ts.isFunctionDeclaration(n) && !n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)).map((n) => n.name.text));
  const inspect = tree.statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "inspectUnsignedAdapters");
  walk(inspect, (n) => { if (ts.isIdentifier(n)) assert.equal(privateNames.has(n.text), false, n.text); });
  // Top level holds only imports, function declarations and constant helpers or private maps: no call, assignment or alias leaks a run.
  for (const n of tree.statements) {
    assert.ok(ts.isImportDeclaration(n) || ts.isFunctionDeclaration(n) || ts.isVariableStatement(n), n.getText().slice(0, 60));
    if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations)
      assert.ok(ts.isArrowFunction(d.initializer) || ts.isNewExpression(d.initializer) && d.initializer.expression.getText() === "WeakMap", d.getText().slice(0, 60));
  }
  function visit(n, root) {
    if (ts.isFunctionDeclaration(n)) root = n.name?.text;
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) assert.ok(privateNames.has(root), root);
    // The run map is only ever read: every reference outside its declaration is exactly preparedRuns.get(...).
    if (ts.isIdentifier(n) && n.text === "preparedRuns" && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n))
      assert.ok(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n && n.parent.name.text === "get" && ts.isCallExpression(n.parent.parent)
        && n.parent.parent.expression === n.parent, n.parent.getText());
    if (ts.isIdentifier(n)) assert.equal(["globalThis", "global", "eval", "Function"].includes(n.text), false, n.text);
    if (ts.isExportDeclaration(n) || ts.isExportAssignment(n)) assert.fail("re-export");
    ts.forEachChild(n, (c) => visit(c, root));
  }
  visit(tree);
  assert.doesNotMatch(s, /\.kill\s*\(|\b(?:exec|execFile|fork|rmSync|renameSync|chmodSync)\s*\(|recursive\s*:|force\s*:/);
}
test("C-C1b-2 live adapters have no exported caller, run-reference mint, signal or general deletion entry", () => sealed(live));
test("C-C1b-2 boundary checks detect an unlocked entry, forged run mint and extra pure capability", () => {
  for (const change of [live.replace('throw Error("cc1b2_execution_not_approved");', "return prepareOriginalWorker();"),
    live + "\nexport const leaked = createOriginalFixture;", live + "\npreparedRuns.set({}, {});", live + "\nimport('node:fs');",
    live + '\npreparedRuns["set"]({}, {});', live + "\nWeakMap.prototype.set.call(preparedRuns, {}, {});", live + "\nglobalThis.leak = createOriginalFixture;",
    live + "\ncreateOriginalFixture({}, {});", live + "\nconst runs = preparedRuns;"])
    assert.throws(() => sealed(change));
  assert.throws(() => pure(support + "\nprocess.cwd();", supportImports, []));
});
test("C-C1b-2 worker entry is sealed in both imported and direct-entry source branches", async () => {
  const tree = ast(worker), f = tree.statements.find(ts.isFunctionDeclaration);
  // Exactly the URL import, the sealed function and the sealed direct-entry branch: no other top-level work can run on import.
  assert.equal(tree.statements.length, 3); assert.deepEqual(imports(tree), [["node:url", ["pathToFileURL"]]]);
  assert.deepEqual(exported(tree), ["runUnsignedWorker"]); assert.equal(f.body.statements.length, 1);
  assert.equal(f.body.statements[0].getText(), 'throw Error("cc1b2_execution_not_approved");');
  const run = vm.runInNewContext(`(async function() ${f.body.getText()})`); await assert.rejects(run({ approved: true }), /cc1b2_execution_not_approved/);
  assert.equal(tree.statements.at(-1).thenStatement.getText(), 'throw Error("cc1b2_execution_not_approved");');
  assert.doesNotMatch(worker, /unsignedInertAdapters|\.node|createRequire|spawn/);
});
test("C-C1b-2 sources keep the observer independent, fixed-path, read-only and bounded, without compiling it", () => {
  assert.doesNotMatch(cpp, /#include\s*"|napi_|classifySynthetic|std::[io]fstream|O_(?:CREAT|WRONLY|RDWR|TRUNC|APPEND)/);
  // Every mutating, signalling or process-creating libc/Darwin call, including the *at and f* variants.
  assert.doesNotMatch(cpp, /\b(?:write|pwrite|writev|unlink|unlinkat|rename|renameat|renamex_np|renameatx_np|mkdir|mkdirat|rmdir|chmod|fchmod|fchmodat|lchmod|chown|fchown|fchownat|lchown|truncate|ftruncate|acl_set_fd_np|acl_set_file|acl_set_link_np|setattrlist|fsetattrlist|setattrlistat|utimes|futimes|lutimes|futimens|utimensat|link|linkat|symlink|symlinkat|clonefile|clonefileat|fclonefileat|copyfile|fcopyfile|exchangedata|system|popen|posix_spawn|posix_spawnp|execv|execve|execvp|execl|fork|vfork|kill|mount|unmount)\s*\(/);
  for (const part of ["MAX_NODES = 19", "MAX_WORK = 4194304", "MAX_CONTENT = 131072", "MAX_ACL = 65536", "MAX_OUTPUT = 65536",
    "FSOPT_NOFOLLOW", "O_NOFOLLOW", "AT_SYMLINK_NOFOLLOW", "ACL_EXTENDED_DENY", "filesec_query_property", "pass < 2", "i < 256",
    '"/private/tmp"', '"observer_unexpected_name"', '"observer_final_path_changed"', "charge(MAX_OUTPUT)"])
    assert.ok(cpp.includes(part), part);
  assert.doesNotMatch(read("../../native/native_bar_fs/build.mjs"), /admission_unsigned_observer|test_unsigned_worker/);
  // Conservative subdivision of the unchanged 4 MiB charge ceiling; actual qualification needs the later native comparison.
  assert.ok(19 * 2 * 65536 + 19 * 2 * 257 * 64 + 2 * 131072 + 19 * 32768 + 19 * 778 + 4096 + 65536 <= 4194304);
});
test("C-C1b-2 U4 changes only the supplied data inode and consequent registration hash, using invented metadata only", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "deriveUnsignedCaseBinding");
  const canonical = (v) => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v && typeof v === "object"
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
  const derive = vm.runInNewContext(`(${f.getText()})`, { canonical, hash: (s) => createHash("sha256").update(s).digest("hex"), refuse: () => { throw Error("refused"); } });
  const p = (inode) => ({ inode: String(inode) });
  const original = { registration: { bindings: { fixture_parent: p(100), data: p(101), witness: p(102), markers: { base: p(103), admission: p(104) },
    ancestors: [{ proof: p(1) }, { proof: p(2) }, { proof: p(3) }] } }, registration_hash: "a".repeat(64) };
  const changed = derive("u4-expected-inode", original); assert.equal(changed.registration.bindings.data.inode, "105");
  assert.equal(original.registration.bindings.data.inode, "101"); delete changed.registration_hash;
  changed.registration.bindings.data.inode = "101"; assert.equal(canonical(changed.registration), canonical(original.registration));
  assert.equal(derive("u1-unsigned", original), original);
});
test("C-C1b-2 validation precedes native load, owner activation is GO-only and instrumentation delegates unchanged", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "prepareOriginalWorker").getText();
  assert.ok(f.indexOf("validateUnsignedWorkerConfiguration") < f.indexOf('await import("node:module")'));
  assert.ok(f.indexOf("bootstrap = joint.createSyntheticAdmissionJointBootstrap") < f.indexOf("async go()"));
  assert.ok(f.indexOf("async go()") < f.indexOf('await import("./fixedMemoryCheckpointOracle.mjs")'));
  assert.match(f, /Reflect\.apply\(fn, this === facade \? original : this, args\)/); assert.match(f, /event\(api, "throw", code\); throw e;/);
  assert.match(f, /cache\.exports = oldExports/); assert.match(f, /c0_dispatched_at: null, c0_authenticated_at: null, retired_at: null/);
  assert.match(live, /runOf\(runRef, true\)/); assert.match(live, /if \(run\.evidenceTainted \|\| run\.evidenceAclStillQualified\(\) !== true\)/);
});
test("C-C1b-2 is not registered in application/MCP, package scripts or the existing C-C1a entry", () => {
  for (const name of readdirSync(new URL("../../src/", import.meta.url), { recursive: true }).filter((s) => s.endsWith(".ts")))
    assert.doesNotMatch(read(`../../src/${name}`), /unsignedInertAdapters|unsignedAdapterSupport|unsignedWorkerConfiguration|admission_unsigned_observer|test_unsigned_worker/, name);
  assert.doesNotMatch(JSON.stringify(JSON.parse(read("../../package.json")).scripts), /unsignedInertAdapters|admission_unsigned_observer|test_unsigned_worker/);
  assert.doesNotMatch(read("../helpers/jointUnsignedHarness.mjs") + read("../../native/native_bar_fs/test_joint_admission.mjs"), /unsignedInertAdapters|unsignedWorkerConfiguration/);
});
test("C-C1b-2 every fixture file fstat is inside its original FD close-finally scope", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "createOriginalFixture");
  let found = 0;
  walk(f, (n) => {
    if (!ts.isCallExpression(n) || n.expression.getText() !== "fs.fstatSync" || n.arguments[0]?.getText() !== "fd") return;
    found++; let p = n.parent;
    while (p && !ts.isTryStatement(p)) p = p.parent;
    assert.ok(p?.finallyBlock, "a failed initial fstat must still close the original file FD");
    assert.match(p.finallyBlock.getText(), /fs\.closeSync\(fd\)/);
    assert.ok(n.pos >= p.tryBlock.pos && n.end <= p.tryBlock.end);
  });
  assert.equal(found, 1);
});
test("C-C1b-2 observer refuses non-recipe types before nonblocking no-follow opens", () => {
  const f = cpp.slice(cpp.indexOf("Node* openNode("), cpp.indexOf("Node* owned("));
  assert.ok(f.indexOf("S_ISREG(before.st_mode)") > 0);
  assert.ok(f.indexOf("S_ISREG(before.st_mode)") < f.indexOf("openat("));
  assert.match(f, /openat\([^;]+O_NONBLOCK/);
});
test("C-C1b-2 worker pipes latch stream errors instead of emitting unhandled failures", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "superviseOriginalWorker").getText();
  assert.match(f, /for \(const stream of \[child\.stdio\[3\], child\.stdio\[4\], child\.stdout, child\.stderr\]\)/);
  assert.match(f, /stream\.on\("error", \(\) => retain\(run, Error\("cc1b2_worker_pipe"\)\)\)/);
});
test("C-C1b-2 teardown requires model absence confirmation and never retries an uncertain root close", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "removeOriginalFixture").getText();
  assert.match(f, /owner\.assessCleanup\(run\.originalCleanupObservation\(absent, \[\]\)\)\.decision !== "supplied_complete"/);
  assert.match(f, /live\.closeAttempted = true; fs\.closeSync\(live\.fd\)/);
});
test("C-C1b-2 observer output stream errors enter the same retained failure path", () => {
  const f = ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === "collectOriginalChild").getText();
  assert.match(f, /for \(const stream of \[child\.stdout, child\.stderr\]\)/);
  assert.match(f, /stream\.on\("error", \(\) => fail\("cc1b2_child_pipe"\)\)/);
});
const fn = (name) => ast(live).statements.find((n) => ts.isFunctionDeclaration(n) && n.name?.text === name).getText();
test("C-C1b-2 observer source checks exact names, binds volume capabilities to the anchor's own volume root and reports its recipe digest", () => {
  const open = cpp.slice(cpp.indexOf("Node* openNode("), cpp.indexOf("Node* owned("));
  assert.ok(open.indexOf('onDiskName(node->fd.value) == name, "observer_exact_name"') > open.indexOf("openat("));
  assert.match(cpp, /fgetattrlist\(fd, &a, &out, sizeof\(out\), 0\)/); assert.match(cpp, /a\.commonattr = ATTR_CMN_NAME/);
  const volume = cpp.slice(cpp.indexOf("std::string volume("), cpp.indexOf("}  // namespace"));
  assert.match(volume, /fstatfs\(anchor\.fd\.value, &fs\)/); assert.match(volume, /mounted\.st_dev == anchor\.initial\.st_dev/);
  assert.match(volume, /attribute<vol_capabilities_attr_t>\(root, 0, ATTR_VOL_INFO \| ATTR_VOL_CAPABILITIES\)/);
  assert.doesNotMatch(volume, /statfs\("\/private\/tmp"|attribute<vol_capabilities_attr_t>\("\/private\/tmp"/);
  assert.match(cpp, /text \+= e\.directory \? "d " : "f "; text \+= e\.path; text \+= '\\n';/);
  assert.match(cpp, /",\\"recipe_sha256\\":" \+ quote\(digest\)/);
});
test("C-C1b-2 adapter error codes keep contract, addon and errno causes bounded", () => {
  let initializer;
  walk(ast(live), (n) => { if (ts.isVariableDeclaration(n) && n.name.getText() === "errorCode") initializer = n.initializer.getText(); });
  const code = vm.runInNewContext(`(${initializer})`, { Error });
  for (const value of ["b3cc_test_mode_refused", "b3cb_native_refused", "native_session_limit", "session_expired", "unsafe_acl", "acl_entry_limit",
    "admission_root_changed:5", "cc1b2_observer_volume_caps"]) assert.equal(code(new Error(value)), value);
  assert.equal(code(Object.assign(new Error("EIO: i/o error, unlink '/private/tmp/x'"), { code: "EIO" })), "cc1b2_fs_eio");
  for (const value of [new Error("/private/tmp/secret path"), new Error(`b3cb_${"a".repeat(100)}`), Object.assign(new Error("x"), { code: "eio" }), {}])
    assert.equal(code(value), "cc1b2_unexpected_error");
});
test("C-C1b-2 provenance and qualification failures latch the run; GO is spent before its checks", () => {
  for (const name of ["checkpoint", "workerCheckpoint"]) {
    const f = fn(name); assert.match(f, /throw retain\(run, Error\("cc1b2_live_provenance_unconfirmed"\)\)/); assert.doesNotMatch(f, /refuse\(/);
  }
  assert.doesNotMatch(live, /refuse\("(?:live_provenance_unconfirmed|observer_provenance|addon_provenance|worker_provenance)"\)/);
  const go = fn("prepareOriginalWorker"), body = go.slice(go.indexOf("async go()"));
  assert.ok(body.indexOf("used = true") < body.indexOf("workerCheckpoint(run)"));
  assert.ok(body.indexOf("try {") < body.indexOf("workerCheckpoint(run)"));
});
test("C-C1b-2 observer supervision attaches synchronously after spawn and keeps the observer's refusal code", () => {
  const f = fn("observeOriginal"), between = f.slice(f.indexOf("spawn(program"), f.indexOf("const line = await collectOriginalChild("));
  assert.doesNotMatch(between, /throw|await|refuse/);
  assert.match(fn("collectOriginalChild"), /classifyUnsignedObserverExit\(\{ exit_code: code, signal, stdout_bytes: count, stderr: stderr\.toString\("latin1"\) \}\)/);
  assert.match(f, /if \(cohort\.observerChild\) throw retain/);
});
test("C-C1b-2 worker preparation keeps the original failure primary and close failures beside it", () => {
  const f = fn("prepareOriginalWorker");
  assert.doesNotMatch(f, /finally \{ restore\(\); \}/);
  assert.match(f, /\(run\.closeErrors \?\?= \[\]\)\.push\(\.\.\.closeAll\(\)\); throw e;/);
});
test("C-C1b-2 creation records each object as owned before proving it and journals an unrecorded root's name", () => {
  const f = fn("createOriginalFixture");
  const directory = f.slice(f.indexOf("fs.mkdirSync(path"));
  assert.ok(directory.indexOf("live.created.push(record)") < directory.indexOf("record.identity = fs.lstatSync"));
  const file = f.slice(f.indexOf("const fd = fs.openSync(path"));
  assert.ok(file.indexOf("live.created.push(record)") < file.indexOf("record.identity = fs.fstatSync"));
  assert.match(f, /journal\("stop_summary", \{ reason: model\.describe\(\)\.stop_reason \?\? run\.stopped, fixture_name: live\.name \}\)/);
  assert.ok(f.indexOf('observeOriginal(runRef, allocation.fixture, "anchor")') > f.indexOf("try {"));
});
test("C-C1b-2 teardown records each side effect, uses the protocol baseline and frees the cohort slot only after confirmed removal", () => {
  const f = fn("removeOriginalFixture");
  assert.ok(f.indexOf("live.deleting = {") < f.indexOf("fs.unlinkSync(path)"));
  assert.ok(f.indexOf("live.removed.push(entry_index)") < f.indexOf('journal("delete_result"'));
  assert.match(f, /run\.protocol\.describe\(\)\.baseline\.resources/); assert.doesNotMatch(f, /run\.originalBaseline/);
  assert.ok(f.indexOf("run.originalCohort.liveFixture = null") > f.indexOf('"supplied_complete"'));
  assert.match(fn("superviseOriginalWorker"), /cohort\.liveWorker/); assert.doesNotMatch(fn("superviseOriginalWorker"), /execArgv/);
  assert.match(fn("sendOriginalWorkerCommand"), /cc1b2_worker_pipe_timeout/);
});
