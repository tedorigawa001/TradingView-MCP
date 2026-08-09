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

  // Drop the flag with its path. Filtering the path alone leaves a bare --aggregate that swallows
  // the next token, so the parser refuses an unknown argument and the count check never runs - the
  // assertion passes on the wrong error and the count itself goes untested.
  const without = (flag, path) => {
    const index = args.indexOf(path);
    assert.equal(args[index - 1], flag, `${path} must be preceded by ${flag}`);
    return [...args.slice(0, index - 1), ...args.slice(index + 1)];
  };
  assert.throws(
    () => parseMacroEventResponseCliArguments(without("--aggregate", "xauusd.json")),
    /exactly 6 --aggregate files/,
  );
  assert.throws(
    () => parseMacroEventResponseCliArguments(without("--events", "fomc.json")),
    /exactly 3 --events files/,
  );
});
