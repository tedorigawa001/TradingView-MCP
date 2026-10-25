import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
if (args.some((v) => v !== "--ubsan")) throw new Error("only --ubsan is supported");
function run(command, args) {
  const r = spawnSync(command, args, { cwd: root, stdio: "inherit", env: { ...process.env, NATIVE_BAR_B2B_ISOLATED_TEST: "1" } });
  if (r.error) throw r.error;if (r.status !== 0) process.exit(r.status ?? 1);
}
run(process.execPath, ["node_modules/typescript/bin/tsc", "--outDir", "build/b2b-validation", "--sourceMap", "false"]);
if (process.platform === "darwin") {
  run(process.execPath, ["native/native_bar_fs/build.mjs", "--admission-validation", ...args]);
  run("/usr/bin/xcrun", ["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror", "-fstack-protector-strong",
    "native/native_bar_fs/admission_fixture_expectations.cc", "-o", join(root, "build/b2b-validation/admission-fixture-expectations")]);
}
run(process.execPath, ["--expose-gc", "--test", "test/native/nativeBarAdmissionRead.test.mjs", "test/unit/nativeBarAdmissionReaderBoundary.test.mjs",
  "test/unit/nativeBarAdmission.test.mjs", "test/unit/nativeBarAdmissionBoundary.test.mjs", "test/unit/nativeBarAdmissionVerification.test.mjs",
  "test/unit/nativeBarAdmissionVerificationBoundary.test.mjs", "test/unit/nativeBarAdmissionReadContracts.test.mjs", "test/unit/nativeBarAdmissionReadContractsBoundary.test.mjs"]);
