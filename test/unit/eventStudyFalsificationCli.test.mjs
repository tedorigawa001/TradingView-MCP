import assert from "node:assert/strict";
import test from "node:test";
import { eventStudyFalsificationExitCode, parseEventStudyFalsificationCliArguments } from "../../build/eventStudyFalsificationCli.js";

test("event-study falsification CLI requires an explicit config and bounds overrides", () => {
  assert.throws(() => parseEventStudyFalsificationCliArguments([]), /--config is required/);
  assert.throws(() => parseEventStudyFalsificationCliArguments(["--config", "audit.json", "--model", "unknown"]), /--model must be/);
  assert.throws(() => parseEventStudyFalsificationCliArguments(["--config", "audit.json", "--replications", "2001"]), /1 to 2000/);
  assert.throws(() => parseEventStudyFalsificationCliArguments(["--config", "audit.json", "--model", "white_noise", "--model", "white_noise"]), /must not be repeated/);
  assert.deepEqual(parseEventStudyFalsificationCliArguments([
    "--config", "audit.json", "--model", "white_noise", "--bars", "1200", "--replications", "20",
  ]), { configPath: "audit.json", models: ["white_noise"], bars: 1200, replications: 20 });
});

test("event-study falsification CLI fails a run that failed a replication or evaluated none (102-15)", () => {
  const run = (status, evaluated) => ({ audit: { status, evaluated } });
  assert.equal(eventStudyFalsificationExitCode({ runs: [run("complete", 3), run("complete", 1)] }), 0);
  assert.equal(eventStudyFalsificationExitCode({ runs: [run("complete", 3), run("complete", 0)] }), 1);
  assert.equal(eventStudyFalsificationExitCode({ runs: [run("incomplete", 3)] }), 1);
});
