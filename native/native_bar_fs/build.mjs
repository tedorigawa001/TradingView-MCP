import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin") throw new Error("native foundation currently supports macOS synthetic tests only");
const args = process.argv.slice(2);
if (args.some((arg) => arg !== "--ubsan")) throw new Error("only --ubsan is supported");
const sanitize = args.includes("--ubsan");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const headers = resolve(dirname(realpathSync(process.execPath)), "../include/node");
if (!existsSync(join(headers, "node_api.h"))) throw new Error("local Node-API headers unavailable; no automatic download");
const output = join(root, "build/native-bar-fs");
mkdirSync(output, { recursive: true });
const sanitizerFlags = [];
if (sanitize) {
  const runtime = spawnSync("/usr/bin/xcrun", ["clang++", "-print-file-name=libclang_rt.ubsan_osx_dynamic.dylib"], { encoding: "utf8" });
  if (runtime.status !== 0 || !existsSync(runtime.stdout.trim())) throw new Error("local UBSan runtime unavailable");
  sanitizerFlags.push("-fsanitize=undefined", "-fno-sanitize-recover=all");
}
const result = spawnSync("/usr/bin/xcrun", ["clang++", "-std=c++17", "-Wall", "-Wextra", "-Werror",
  "-fvisibility=hidden", "-fstack-protector-strong", "-DNAPI_VERSION=8", "-DNATIVE_BAR_SYNTHETIC_ONLY=1",
  "-bundle", "-undefined", "dynamic_lookup", ...sanitizerFlags, "-I", headers,
  join(root, "native/native_bar_fs/native_bar_fs.cc"), "-o", join(output, "native_bar_fs.node")], { stdio: "inherit" });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
console.log(`Built synthetic-only native bar filesystem backend${sanitize ? " (UBSan)" : ""}`);
