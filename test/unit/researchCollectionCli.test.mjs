import test from "node:test";
import assert from "node:assert/strict";
import { parseResearchCollectionCliArguments } from "../../build/researchCollectionCli.js";

test("research collection CLI requires an explicit chart-switch confirmation", () => {
  assert.throws(() => parseResearchCollectionCliArguments([], {}), /chart switching is disabled/);
  assert.deepEqual(
    parseResearchCollectionCliArguments(["--confirm-chart-switch", "--output-path", "/tmp/research.jsonl"], {}),
    { confirmChartSwitch: true, outputPath: "/tmp/research.jsonl" },
  );
});
