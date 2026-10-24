import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--ubsan")) throw new Error("only --ubsan is supported");
function run(argv, env = process.env) {
  const result = spawnSync(process.execPath, argv, { cwd: root, env, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`synthetic verification failed (${result.status ?? result.signal})`);
}
try {
  run(["node_modules/typescript/bin/tsc"]);
  run(["native/native_bar_fs/build.mjs", ...args]);
  run(["--test", "--test-concurrency=1", "test/native/nativeBarFs.test.mjs", "test/native/nativeBarRead.test.mjs", "test/native/nativeBarWriter.test.mjs", "test/native/nativeBarQuarantine.test.mjs"], {
    ...process.env, UBSAN_OPTIONS: "halt_on_error=1:print_stacktrace=1",
  });
} catch (error) {
  console.error(error.message); process.exitCode = 1;
} finally {
  // Do not leave the optional development sanitizer runtime in the normal build.
  if (args.includes("--ubsan")) {
    try { run(["native/native_bar_fs/build.mjs"]); }
    catch (error) { console.error(error.message); process.exitCode = 1; }
  }
}
