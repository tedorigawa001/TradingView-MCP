import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { artifacts, buildBookmapAddon, run, tools } from "./build.mjs";

const { sdkPresent, classpath } = buildBookmapAddon();
const testClasses = join(artifacts.addon, "dist", "test-classes");
rmSync(testClasses, { recursive: true, force: true });
mkdirSync(testClasses, { recursive: true });

const testDirectory = join(artifacts.addon, "src", "test", "java", "jp", "bushido", "bookmap");
const selectedTests = sdkPresent
  ? readdirSync(testDirectory).filter((name) => name.endsWith("Test.java"))
  : ["FlowSignalEngineTest.java", "FlowSignalMarkerTest.java"];
run(tools.javac, ["--release", "17", "-cp", classpath, "-d", testClasses,
  ...selectedTests.map((name) => join(testDirectory, name))]);

if (sdkPresent) {
  const collectorListing = run(tools.jar, ["--list", "--file", artifacts.collector], { capture: true });
  const researchListing = run(tools.jar, ["--list", "--file", artifacts.research], { capture: true });
  const displayListing = run(tools.jar, ["--list", "--file", artifacts.display], { capture: true });
  if (/FlowSignalEngine/.test(collectorListing)) throw new Error("Collector JAR must not contain signal classes");
  if (/FlowCollector/.test(researchListing)) throw new Error("Signal research JAR must not contain the raw-data collector");
  if (!/FlowSignalMarker\.class/.test(researchListing)) throw new Error("Signal research JAR must contain the chart marker");
  if (/FlowCollector|FlowSignalResearch/.test(displayListing)) throw new Error("Display JAR must not contain evidence writers");
  // packagedClasses is an allowlist, so this holds today by construction. It is asserted
  // because the offline adapter reads stdin and is built beside the packaged classes: a
  // widened prefix would ship it, and the display bytecode check would not see it.
  for (const [name, listing] of [["Collector", collectorListing], ["Signal research", researchListing], ["Display", displayListing]]) {
    if (/FlowSweepReplay/.test(listing)) throw new Error(`${name} JAR must not contain the offline replay adapter`);
  }

  const displayBytecode = run(tools.javap, ["-v", "-cp", artifacts.classes, "jp.bushido.bookmap.FlowSignalDisplay"], { capture: true });
  if (/java\/io\/File|java\/nio\/file|java\/net\/|java\/awt\/datatransfer|ProcessBuilder|RandomAccessFile/.test(displayBytecode)) {
    throw new Error("Display module references file, network, clipboard, or process APIs");
  }
}

const runtimeClasspath = [testClasses, classpath].join(delimiter);
for (const sourceName of selectedTests) {
  const className = sourceName.replace(/\.java$/, "");
  const headless = /Marker|Research/.test(className) ? ["-Djava.awt.headless=true"] : [];
  run(tools.java, [...headless, "-ea", "-cp", runtimeClasspath, `jp.bushido.bookmap.${className}`]);
}
if (!sdkPresent) console.log("SKIPPED (no Bookmap SDK): FlowCollectorTest, FlowSignalResearchTest");
run(process.execPath, ["--test", join(artifacts.addon, "replay.test.mjs")]);
