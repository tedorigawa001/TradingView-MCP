import assert from "node:assert/strict";
import test from "node:test";
import { parseMacroEventResponseCliArguments } from "../../build/macroEventResponseCli.js";

const aggregates = ["eurusd.json", "usdjpy.json", "gbpusd.json", "eurgbp.json", "audnzd.json", "xauusd.json"];
const artifacts = ["cpi.json", "nfp.json", "fomc.json"];

test("M15 macro response CLI requires the complete frozen panel and guard artifacts", () => {
  const args = [
    "--confirm-local-import",
    ...aggregates.flatMap((path) => ["--aggregate", path]),
    ...artifacts.flatMap((path) => ["--events", path]),
    "--event-kind", "us_nfp",
  ];
  const parsed = parseMacroEventResponseCliArguments(args);
  assert.deepEqual(parsed.aggregatePaths, aggregates);
  assert.deepEqual(parsed.eventPaths, artifacts);
  assert.equal(parsed.eventKind, "us_nfp");
  assert.match(parsed.outputPath, /us_nfp_m15_response\.json$/);

  assert.throws(
    () => parseMacroEventResponseCliArguments(args.filter((value) => value !== "xauusd.json")),
    /exactly 6 --aggregate files/,
  );
  assert.throws(
    () => parseMacroEventResponseCliArguments(args.filter((value) => value !== "fomc.json")),
    /exactly 3 --events files/,
  );
});
