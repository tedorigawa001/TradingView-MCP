import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, realpath, mkdir, writeFile, readdir, rm, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { nativeBarFsAvailability, openSyntheticNativeBarFs } from "../../build/nativeBarFs.js";

async function fixture(t) {
  const base = await mkdtemp(join(await realpath(tmpdir()), "native-bar-fs-synthetic-"));
  t.after(() => rm(base, { recursive: true, force: true }));
  await writeFile(join(base, ".native-bar-fs-synthetic"), "synthetic-fixture-v1\n", { mode: 0o600 });
  const root = join(base, "store"); await mkdir(root, { mode: 0o700 });
  return { base, root };
}

test("native foundation opens/closes a qualified synthetic root without creating entries", async (t) => {
  const f = await fixture(t);
  assert.equal(nativeBarFsAvailability().available, true, "explicit native build must be available");
  assert.equal(nativeBarFsAvailability().production_enabled, false);
  const session = openSyntheticNativeBarFs(f.root);
  assert.deepEqual(await readdir(f.root), []);
  session.close(); session.close();
  assert.deepEqual(await readdir(f.root), []);
});

const day = "2026-01-01";
const name = "01234567-89ab-4cde-8fab-0123456789ab.json";
async function capture(f, bytes = "synthetic-only\n") {
  const parent = join(f.root, "captures", day);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const path = join(parent, name); await writeFile(path, bytes, { mode: 0o600 });
  return path;
}

test("exact inspected synthetic file is moved exclusively, verified and then purged", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const before = await stat(path, { bigint: true });
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const target = session.inspect("captures", day, name);
  const preview = target.status();
  assert.equal(preview.state, "previewed");
  assert.equal(preview.proof.inode, before.ino.toString());
  assert.equal(preview.proof.size, "15");
  assert.equal(preview.proof.sha256, createHash("sha256").update("synthetic-only\n").digest("hex"));
  assert.deepEqual(await readdir(f.root), ["captures"]);
  const staged = target.stage();
  assert.equal(staged.state, "held_verified");
  assert.equal(await readFile(join(f.root, staged.holding), "utf8"), "synthetic-only\n");
  await assert.rejects(readFile(path), { code: "ENOENT" });
  assert.equal(target.purge().state, "purged");
  await assert.rejects(readFile(join(f.root, staged.holding)), { code: "ENOENT" });
  assert.throws(() => target.purge(), /target_not_held/);
});

test("preview exposes lossless time and permission evidence", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const p = session.inspect("captures", day, name).status().proof;
  const st = await stat(path, { bigint: true });
  assert.equal(p.mtime_ns, st.mtimeNs.toString());
  assert.equal(p.ctime_ns, st.ctimeNs.toString());
  assert.equal(p.mode, st.mode.toString());
  assert.equal(p.uid, st.uid.toString());
  assert.equal(p.nlink, "1");
});

for (const replacement of ["symlink", "same-bytes-new-inode", "changed-bytes", "hardlink"]) {
  test(`pre-move ${replacement} is refused; external victim unchanged`, async (t) => {
    const f = await fixture(t); const path = await capture(f);
    const victim = join(f.base, "victim"); fs.writeFileSync(victim, "outside", { mode: 0o600 });
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    const target = session.inspect("captures", day, name);
    assert.throws(() => target.stage((phase) => {
      if (phase !== "before_move") return;
      if (replacement === "changed-bytes") fs.writeFileSync(path, "changed");
      else if (replacement === "hardlink") fs.linkSync(path, join(f.base, "alias"));
      else { fs.renameSync(path, path + ".original");
        if (replacement === "symlink") fs.symlinkSync(victim, path);
        else fs.writeFileSync(path, "synthetic-only\n", { mode: 0o600 }); }
    }), /namespace_changed|target_changed|hard_link_refused/);
    assert.equal(target.status().moved, false);
    assert.equal(target.status().state, "conflict");
    assert.equal(fs.readFileSync(victim, "utf8"), "outside");
    assert.throws(() => target.purge(), /target_not_held/);
  });
}

test("changed preview invalidates target even before a holding slot is created", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const target = session.inspect("captures", day, name); fs.writeFileSync(path, "changed");
  assert.throws(() => target.stage(), /target_changed/);
  assert.equal(target.status().state, "conflict");
  assert.equal(fs.existsSync(join(f.root, "maintenance-hold")), false);
});

for (const phase of ["before_move", "before_unlink"]) {
  for (const level of ["root", "area", "day", "holding-parent", "holding-slot"]) {
    if (phase === "before_move" && level.startsWith("holding")) continue;
    test(`${phase}: ${level} replacement cannot redirect into external victim`, async (t) => {
      const f = await fixture(t); const path = await capture(f);
      const victim = join(f.base, "victim"); fs.mkdirSync(victim, { mode: 0o700 });
      const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
      const target = session.inspect("captures", day, name);
      if (phase === "before_unlink") target.stage();
      const holding = target.status().holding;
      const relativeVictim = phase === "before_move"
        ? level === "root" ? join("captures", day, name) : level === "area" ? join(day, name) : name
        : level === "root" ? holding : level === "holding-parent" ? holding.split("/").slice(1).join("/")
          : level === "holding-slot" ? holding.split("/").at(-1) : name;
      const victimFile = join(victim, relativeVictim);
      fs.mkdirSync(join(victimFile, ".."), { recursive: true, mode: 0o700 });
      fs.writeFileSync(victimFile, "outside", { mode: 0o600 });
      const before = fs.statSync(victimFile, { bigint: true });
      const action = () => target[phase === "before_move" ? "stage" : "purge"]((at, status) => {
        if (at !== phase) return;
        const chosen = level === "root" ? f.root : level === "area" ? join(f.root, "captures")
          : level === "day" ? join(f.root, "captures", day) : level === "holding-parent"
            ? join(f.root, "maintenance-hold") : join(f.root, status.holding, "..");
        const original = chosen.endsWith("/..") ? join(f.root, status.holding.split("/").slice(0, 2).join("/")) : chosen;
        fs.renameSync(original, original + ".original"); fs.symlinkSync(victim, original);
      });
      // Source parents are no longer needed to authorize a held unlink.
      if (phase === "before_unlink" && ["area", "day"].includes(level)) assert.equal(action().state, "purged");
      else assert.throws(action, /namespace_changed/);
      assert.equal(fs.readFileSync(victimFile, "utf8"), "outside");
      assert.equal(fs.statSync(victimFile, { bigint: true }).ino, before.ino);
      if (phase === "before_move") assert.equal(target.status().moved, false);
    });
  }
}

for (const replacement of ["symlink", "same-bytes-new-inode", "changed-bytes"]) {
  test(`post-move ${replacement} is preserved as a moved conflict`, async (t) => {
    const f = await fixture(t); await capture(f);
    const victim = join(f.base, "victim"); fs.writeFileSync(victim, "outside", { mode: 0o600 });
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    const target = session.inspect("captures", day, name);
    assert.throws(() => target.stage((phase, status) => {
      if (phase !== "after_move") return;
      const held = join(f.root, status.holding);
      if (replacement === "changed-bytes") fs.writeFileSync(held, "changed");
      else { fs.renameSync(held, held + ".original");
        if (replacement === "symlink") fs.symlinkSync(victim, held);
        else fs.writeFileSync(held, "synthetic-only\n", { mode: 0o600 }); }
    }), /open_failed|target_changed/);
    const status = target.status(); assert.equal(status.state, "conflict"); assert.equal(status.moved, true);
    assert.equal(fs.lstatSync(join(f.root, status.holding)).isSymbolicLink(), replacement === "symlink");
    assert.equal(fs.readFileSync(victim, "utf8"), "outside");
    assert.throws(() => target.purge(), /target_not_held/);
  });
}

test("exclusive move never replaces a colliding destination", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const target = session.inspect("captures", day, name);
  assert.throws(() => target.stage((phase, status) => {
    if (phase === "before_move") fs.writeFileSync(join(f.root, status.holding), "collision", { mode: 0o600 });
  }), /exclusive_move_failed/);
  assert.equal(target.status().moved, false);
  assert.equal(fs.readFileSync(path, "utf8"), "synthetic-only\n");
  assert.equal(fs.readFileSync(join(f.root, target.status().holding), "utf8"), "collision");
});

for (const phase of ["after_move", "before_stage_sync", "after_unlink"]) {
  test(`interruption at ${phase} preserves an explicit incomplete outcome`, async (t) => {
    const f = await fixture(t); await capture(f);
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    const target = session.inspect("captures", day, name);
    const stop = (at) => { if (at === phase) throw new Error("synthetic interruption"); };
    if (phase === "after_unlink") target.stage();
    assert.throws(() => phase === "after_unlink" ? target.purge(stop) : target.stage(stop), /synthetic interruption/);
    const status = target.status();
    assert.equal(status.state, phase === "after_move" ? "conflict" : "durability_unknown");
    assert.equal(status.moved, true);
    assert.equal(fs.existsSync(join(f.root, status.holding)), phase !== "after_unlink");
    assert.throws(() => target.purge(), /target_not_held/);
  });
}

for (const moment of ["before-inspect", "after-inspect", "before-purge"]) {
  test(`explicit ACL grant ${moment} is refused without permission repair`, async (t) => {
    const f = await fixture(t); const path = await capture(f);
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    let target;
    if (moment !== "before-inspect") target = session.inspect("captures", day, name);
    if (moment === "before-purge") target.stage();
    const chosen = moment === "before-purge" ? join(f.root, target.status().holding) : path;
    const result = spawnSync("/bin/chmod", ["+a", "everyone allow read,write", chosen], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.throws(() => moment === "before-inspect" ? session.inspect("captures", day, name)
      : moment === "after-inspect" ? target.stage() : target.purge(), /unsafe_acl/);
    assert.equal(fs.existsSync(chosen), true);
  });
}

test("inherited directory ACL grants are refused", async (t) => {
  const f = await fixture(t);
  const result = spawnSync("/bin/chmod", ["+a", "everyone allow read,write,file_inherit,directory_inherit", f.base], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const inherited = join(f.base, "inherited"); fs.mkdirSync(inherited, { mode: 0o700 });
  fs.renameSync(f.root, f.root + ".old"); fs.renameSync(inherited, f.root);
  assert.throws(() => openSyntheticNativeBarFs(f.root), /unsafe_acl/);
});

for (const kind of ["symlink", "hardlink", "directory", "fifo", "oversized", "unsafe-mode"]) {
  test(`inspection refuses ${kind} before creating holding directories`, async (t) => {
    const f = await fixture(t); const path = await capture(f);
    if (kind === "hardlink") fs.linkSync(path, join(f.base, "alias"));
    else if (kind === "oversized") fs.truncateSync(path, 1024 * 1024 + 1);
    else if (kind === "unsafe-mode") fs.chmodSync(path, 0o644);
    else { fs.unlinkSync(path);
      if (kind === "symlink") fs.symlinkSync(join(f.base, "missing"), path);
      if (kind === "directory") fs.mkdirSync(path, { mode: 0o700 });
      if (kind === "fifo") assert.equal(spawnSync("/usr/bin/mkfifo", ["-m", "600", path]).status, 0);
    }
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    assert.throws(() => session.inspect("captures", day, name), /open_failed|hard_link_refused|nonregular_object|artifact_size_limit|unsafe_mode/);
    assert.equal(fs.existsSync(join(f.root, "maintenance-hold")), false);
  });
}

test("expiry, close and reentrant operations cannot authorize mutation", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root, 100);
  const target = session.inspect("captures", day, name);
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.throws(() => target.stage(), /session_expired/); session.close();
  assert.equal(fs.readFileSync(path, "utf8"), "synthetic-only\n");
  const next = openSyntheticNativeBarFs(f.root); t.after(() => next.close());
  const held = next.inspect("captures", day, name);
  assert.throws(() => held.stage((at) => { if (at === "after_move") next.close(); }), /session_busy/);
  assert.equal(held.status().moved, true);
  assert.equal(fs.existsSync(join(f.root, held.status().holding)), true);
});

test("expired held target is never unlinked and session close only releases references", async (t) => {
  const f = await fixture(t); await capture(f);
  const session = openSyntheticNativeBarFs(f.root, 100); const target = session.inspect("captures", day, name);
  const held = target.stage(); await new Promise((resolve) => setTimeout(resolve, 120));
  assert.throws(() => target.purge(), /session_expired/); session.close();
  assert.equal(fs.readFileSync(join(f.root, held.holding), "utf8"), "synthetic-only\n");
});

test("invalid caller paths and non-synthetic roots are never accepted", async (t) => {
  const f = await fixture(t); await capture(f);
  assert.throws(() => openSyntheticNativeBarFs(join(f.base, "absent")), /synthetic_root_required/);
  assert.throws(() => openSyntheticNativeBarFs(f.root + "/../store"), /synthetic_root_required/);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  for (const args of [["../captures", day, name], ["captures", "../2026-01-01", name], ["captures", day, "../" + name], ["captures", day, name + "\0"]]) {
    assert.throws(() => session.inspect(...args), /invalid_area|invalid_day|invalid_name|invalid_string/);
  }
});

test("native sessions and targets are bounded and explicit close releases their descriptors", async (t) => {
  const f = await fixture(t); await capture(f); const sessions = [];
  try {
    for (let i = 0; i < 8; i++) sessions.push(openSyntheticNativeBarFs(f.root));
    assert.throws(() => openSyntheticNativeBarFs(f.root), /native_session_limit/);
    const targets = Array.from({ length: 32 }, () => sessions[0].inspect("captures", day, name));
    assert.throws(() => sessions[0].inspect("captures", day, name), /native_target_limit/);
    assert.equal(targets.length, 32);
  } finally { for (const session of sessions) session.close(); }
  for (let i = 0; i < 20; i++) openSyntheticNativeBarFs(f.root).close();
});

for (const replacement of ["symlink", "same-bytes-new-inode", "changed-bytes", "hardlink"]) {
  test(`pre-unlink held ${replacement} is never removed`, async (t) => {
    const f = await fixture(t); await capture(f);
    const victim = join(f.base, "victim"); fs.writeFileSync(victim, "outside", { mode: 0o600 });
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    const target = session.inspect("captures", day, name); const staged = target.stage();
    const held = join(f.root, staged.holding);
    assert.throws(() => target.purge((phase) => {
      if (phase !== "before_unlink") return;
      if (replacement === "changed-bytes") fs.writeFileSync(held, "changed");
      else if (replacement === "hardlink") fs.linkSync(held, join(f.base, "alias"));
      else { fs.renameSync(held, held + ".original");
        if (replacement === "symlink") fs.symlinkSync(victim, held);
        else fs.writeFileSync(held, "synthetic-only\n", { mode: 0o600 }); }
    }), /namespace_changed|target_changed|hard_link_refused/);
    assert.equal(target.status().state, "conflict");
    assert.equal(fs.lstatSync(held).isSymbolicLink(), replacement === "symlink");
    assert.equal(fs.readFileSync(victim, "utf8"), "outside");
  });
}

test("missing backend is optional and has no filesystem fallback", async (t) => {
  const f = await fixture(t); const copy = join(f.base, "optional-loader.mjs");
  fs.copyFileSync(fileURLToPath(new URL("../../build/nativeBarFs.js", import.meta.url)), copy);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import assert from "node:assert/strict";
    const api = await import(${JSON.stringify(copy)});
    assert.equal(api.nativeBarFsAvailability().available, false);
    assert.throws(() => api.openSyntheticNativeBarFs(${JSON.stringify(f.root)}), /native_bar_fs_unavailable/);
  `], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(await readdir(f.root), []);
});

test("actual process kill after move preserves bytes and grants no restart authority", async (t) => {
  const f = await fixture(t); await capture(f);
  const child = spawnSync(process.execPath, ["--input-type=module", "-e", `
    import fs from "node:fs";
    import { openSyntheticNativeBarFs } from ${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)};
    const session = openSyntheticNativeBarFs(${JSON.stringify(f.root)});
    session.inspect("captures", ${JSON.stringify(day)}, ${JSON.stringify(name)}).stage((phase, status) => {
      if (phase === "after_move") { fs.writeSync(1, JSON.stringify(status)); process.kill(process.pid, "SIGKILL"); }
    });
  `], { encoding: "utf8" });
  assert.equal(child.signal, "SIGKILL", child.stderr);
  const held = JSON.parse(child.stdout); assert.equal(held.moved, true);
  assert.equal(fs.readFileSync(join(f.root, held.holding), "utf8"), "synthetic-only\n");
  const next = openSyntheticNativeBarFs(f.root); next.close();
  assert.equal(fs.readFileSync(join(f.root, held.holding), "utf8"), "synthetic-only\n");
});

test("garbage collection closes native references but never purges held bytes", async (t) => {
  const f = await fixture(t); await capture(f);
  const child = spawnSync(process.execPath, ["--expose-gc", "--input-type=module", "-e", `
    import fs from "node:fs"; import assert from "node:assert/strict";
    import { createRequire } from "node:module";
    import { openSyntheticNativeBarFs } from ${JSON.stringify(new URL("../../build/nativeBarFs.js", import.meta.url).href)};
    const native = createRequire(import.meta.url)(${JSON.stringify(fileURLToPath(new URL("../../build/native-bar-fs/native_bar_fs.node", import.meta.url)))});
    let held;
    (() => { const s = openSyntheticNativeBarFs(${JSON.stringify(f.root)}); const target = s.inspect("captures", ${JSON.stringify(day)}, ${JSON.stringify(name)}); held = target.stage(); })();
    for (let i = 0; i < 20; i++) { global.gc(); await new Promise(r => setImmediate(r)); }
    assert.equal(native.info().live_fds, 0); assert.equal(native.info().live_sessions, 0);
    assert.equal(fs.readFileSync(${JSON.stringify(f.root)} + "/" + held.holding, "utf8"), "synthetic-only\\n");
    for (let i = 0; i < 20; i++) openSyntheticNativeBarFs(${JSON.stringify(f.root)}).close();
  `], { encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
});

test("negative file times are represented without numeric loss", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  fs.utimesSync(path, new Date(-500), new Date(-500));
  assert.equal(fs.statSync(path, { bigint: true }).mtimeNs, -500000000n, "fixture must have an actual pre-epoch timestamp");
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const proof = session.inspect("captures", day, name).status().proof;
  assert.equal(proof.mtime_ns, fs.statSync(path, { bigint: true }).mtimeNs.toString());
});

test("replacement in the final rename window is moved but preserved as conflict", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const target = session.inspect("captures", day, name);
  assert.throws(() => target.stage((phase) => {
    if (phase !== "after_source_check") return;
    fs.renameSync(path, path + ".original"); fs.writeFileSync(path, "synthetic-only\n", { mode: 0o600 });
  }), /target_changed/);
  assert.equal(target.status().moved, true); assert.equal(target.status().state, "conflict");
  assert.equal(fs.readFileSync(join(f.root, target.status().holding), "utf8"), "synthetic-only\n");
  assert.throws(() => target.purge(), /target_not_held/);
});

test("expiry after final source verification still refuses the rename", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const session = openSyntheticNativeBarFs(f.root, 100); t.after(() => session.close());
  const target = session.inspect("captures", day, name);
  assert.throws(() => target.stage((phase) => {
    if (phase === "after_source_check") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 120);
  }), /session_expired/);
  assert.equal(target.status().moved, false); assert.equal(fs.existsSync(path), true);
});

test("deny-only ACL is accepted but a later allow entry is never ignored", async (t) => {
  const f = await fixture(t); const path = await capture(f);
  const deny = spawnSync("/bin/chmod", ["+a", "everyone deny execute", path], { encoding: "utf8" });
  assert.equal(deny.status, 0, deny.stderr);
  const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
  const target = session.inspect("captures", day, name);
  const allow = spawnSync("/bin/chmod", ["+a#", "1", "everyone allow read", path], { encoding: "utf8" });
  assert.equal(allow.status, 0, allow.stderr);
  assert.throws(() => target.stage(), /unsafe_acl/);
  assert.equal(target.status().moved, false);
});

test("process-wide descriptor limit refuses excess targets without leaking descriptors", async (t) => {
  const native = createRequire(import.meta.url)("../../build/native-bar-fs/native_bar_fs.node");
  const initial = native.info();
  const f = await fixture(t); await capture(f);
  const sessions = [], targets = []; let refused = false;
  try {
    for (let i = 0; i < 8; i++) sessions.push(openSyntheticNativeBarFs(f.root));
    outer: for (const session of sessions) for (let i = 0; i < 32; i++) {
      try { targets.push(session.inspect("captures", day, name)); }
      catch (error) { assert.match(error.message, /native_fd_limit/); refused = true; break outer; }
    }
    assert.equal(refused, true); assert.ok(native.info().live_fds <= 512);
  } finally { for (const session of sessions) session.close(); }
  assert.equal(native.info().live_fds, initial.live_fds);
  assert.equal(native.info().live_sessions, initial.live_sessions);
  assert.ok(targets.length > 32);
});

for (const bytes of ["", "x".repeat(1024 * 1024)]) {
  test(`hashing and held-only purge accept exactly ${bytes.length} bytes`, async (t) => {
    const f = await fixture(t); await capture(f, bytes);
    const session = openSyntheticNativeBarFs(f.root); t.after(() => session.close());
    const target = session.inspect("captures", day, name);
    assert.equal(target.status().proof.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(target.status().proof.size, String(bytes.length));
    target.stage(); assert.equal(target.purge().state, "purged");
  });
}
