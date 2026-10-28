const freeze = (v) => { if (v && typeof v === "object") { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
export function describeUnsignedIsolatedBuild(mode) {
  if (mode !== "normal" && mode !== "ubsan") throw Error("cc1b3_mode");
  const output = `build/b3cc-validation/${mode}`;
  const common = ["-std=c++17", "-Wall", "-Wextra", "-Werror", "-fvisibility=hidden", "-fstack-protector-strong",
    "-fno-modules", "-Wl,-no_adhoc_codesign", "-isysroot", "$SDK",
    ...(mode === "ubsan" ? ["-fsanitize=undefined", "-fno-sanitize-recover=all"] : [])];
  return freeze({ schema: "native-bar-unsigned-build-plan-v1", mode, output, native_execution_available: false,
    typescript: ["node_modules/typescript/bin/tsc", "--project", "tsconfig.json", "--sourceMap", "false", "--incremental", "false",
      "--noEmitOnError", "--outDir", output],
    addon: [...common, "-DNAPI_VERSION=8", "-DNATIVE_BAR_SYNTHETIC_ONLY=1", "-bundle", "-undefined", "dynamic_lookup",
      "-framework", "CoreFoundation", "-I", "$HEADERS", "native/native_bar_fs/native_bar_fs.cc", "-o", `${output}/native-bar-fs/native_bar_fs.node`],
    observer: [...common, "native/native_bar_fs/admission_unsigned_observer.cc", "-o", `${output}/admission-unsigned-observer`] });
}

// Inspect bytes only; this never loads or executes the compiled object.
export function inspectUnsignedMachO(bytes, kind, architecture) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 32 || !["addon", "observer"].includes(kind) || !["arm64", "x64"].includes(architecture)) throw Error("cc1b3_macho");
  const cpu = architecture === "arm64" ? 0x0100000c : 0x01000007;
  if (bytes.readUInt32LE(0) !== 0xfeedfacf || bytes.readUInt32LE(4) !== cpu || bytes.readUInt32LE(12) !== (kind === "addon" ? 8 : 2)) throw Error("cc1b3_macho");
  const count = bytes.readUInt32LE(16), size = bytes.readUInt32LE(20);
  if (count > 256 || size > 65536 || 32 + size > bytes.length) throw Error("cc1b3_macho");
  let offset = 32;
  for (let i = 0; i < count; i++) {
    if (offset + 8 > 32 + size) throw Error("cc1b3_macho");
    const command = bytes.readUInt32LE(offset), length = bytes.readUInt32LE(offset + 4);
    if (length < 8 || length % 8 || offset + length > 32 + size) throw Error("cc1b3_macho");
    if (command === 0x1d) throw Error("cc1b3_code_signature");
    offset += length;
  }
  if (offset !== 32 + size) throw Error("cc1b3_macho");
  return freeze({ schema: "native-bar-unsigned-mach-o-v1", kind, architecture, load_commands: count, code_signature_present: false,
    native_execution_available: false, native_status: "NOT_RUN" });
}
