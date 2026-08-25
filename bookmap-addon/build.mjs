import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { dirname, delimiter, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ADDON = join(ROOT, "bookmap-addon");
const DIST = join(ADDON, "dist");
const CLASSES = join(DIST, "classes");
const PACKAGE = join("jp", "bushido", "bookmap");

export const artifacts = {
  root: ROOT,
  addon: ADDON,
  classes: CLASSES,
  collector: join(DIST, "bushidoyasu_flow_collector_delayed_replay_v1_1.jar"),
  research: join(DIST, "bushidoyasu_flow_signal_research_delayed_replay_v1_2.jar"),
  display: join(DIST, "bushidoyasu_flow_signal_display_v1_0.jar"),
};

function javaTool(name) {
  const executable = process.platform === "win32" ? `${name}.exe` : name;
  const platformHomes = process.platform === "darwin"
    ? ["/opt/homebrew/opt/openjdk@21", "/usr/local/opt/openjdk@21"]
    : [];
  for (const home of [process.env.JAVA_21_HOME, process.env.JAVA_HOME, ...platformHomes]) {
    if (home?.trim()) {
      const candidate = join(home, "bin", executable);
      if (existsSync(candidate)) return candidate;
    }
  }
  return executable;
}

export const tools = {
  java: javaTool("java"),
  javac: javaTool("javac"),
  jar: javaTool("jar"),
  javap: javaTool("javap"),
};

export function run(command, args, { capture = false, ...options } = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stdout ?? ""}${result.stderr ?? ""}` : "";
    throw new Error(`${command} exited with status ${result.status}${detail}`);
  }
  return result.stdout ?? "";
}

function defaultBookmapHome() {
  if (process.platform === "darwin") return "/Applications/Bookmap.app/Contents/app";
  if (process.platform === "win32") {
    return join(process.env.LOCALAPPDATA || process.env.ProgramFiles || "C:\\Program Files", "Bookmap");
  }
  return "/opt/bookmap";
}

function javaSources(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".java"))
    .map((entry) => join(directory, entry.name));
}

function packagedClasses(prefixes) {
  const directory = join(CLASSES, PACKAGE);
  return readdirSync(directory)
    .filter((name) => name.endsWith(".class") && prefixes.some((prefix) => name === `${prefix}.class` || name.startsWith(`${prefix}$`)))
    .map((name) => join(PACKAGE, name));
}

function createJar(path, classFiles) {
  const args = ["--create", "--file", path];
  for (const classFile of classFiles) args.push("-C", CLASSES, classFile);
  run(tools.jar, args);
}

export function buildBookmapAddon() {
  const bookmapHome = process.env.BOOKMAP_HOME?.trim() || defaultBookmapHome();
  const lib = join(bookmapHome, "lib");
  const simplifiedApi = join(lib, "bm-simplified-api-wrapper.jar");
  const l1Api = join(lib, "bm-l1api.jar");
  const sdkPresent = existsSync(simplifiedApi) && existsSync(l1Api);

  rmSync(CLASSES, { recursive: true, force: true });
  mkdirSync(CLASSES, { recursive: true });
  for (const path of [
    artifacts.collector,
    artifacts.research,
    artifacts.display,
    join(DIST, "bushidoyasu_flow_signal_research_delayed_replay_v1_0.jar"),
    join(DIST, "bushidoyasu_flow_signal_research_delayed_replay_v1_1.jar"),
  ]) rmSync(path, { force: true });

  const mainDirectory = join(ADDON, "src", "main", "java", PACKAGE);
  if (!sdkPresent) {
    console.log(`Bookmap SDK not found under ${lib} - building the SDK-free signal engine only`);
    run(tools.javac, ["--release", "17", "-d", CLASSES,
      join(mainDirectory, "FlowSignalEngine.java"),
      join(mainDirectory, "FlowSignalMarker.java")]);
    return { sdkPresent, classpath: CLASSES };
  }

  const sdkClasspath = [simplifiedApi, l1Api].join(delimiter);
  run(tools.javac, ["--release", "17", "-cp", sdkClasspath, "-d", CLASSES, ...javaSources(mainDirectory)]);
  createJar(artifacts.collector, packagedClasses(["FlowCollector"]));
  createJar(artifacts.research, packagedClasses(["FlowSignalResearch", "FlowSignalEngine", "FlowSignalMarker"]));
  createJar(artifacts.display, packagedClasses(["FlowSignalDisplay", "FlowSignalEngine", "FlowSignalMarker"]));
  console.log(`Built Bookmap add-ons in ${relative(ROOT, DIST)}`);
  return { sdkPresent, classpath: [CLASSES, simplifiedApi, l1Api].join(delimiter) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  buildBookmapAddon();
}
