import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("Windows first-seen schedule fixes all three COT symbols explicitly", async () => {
  const source = await readFile(new URL("../../scripts/windows/register-collection-tasks.ps1", import.meta.url), "utf8");
  assert.match(
    source,
    /collect --cot-symbol OANDA:EURUSD --cot-symbol OANDA:USDJPY --cot-symbol OANDA:XAUUSD/,
  );
});

test("Windows collection times are named and configurable as local wall-clock values", async () => {
  const source = await readFile(new URL("../../scripts/windows/register-collection-tasks.ps1", import.meta.url), "utf8");
  for (const parameter of [
    "FirstSeenMorningLocalTime",
    "FirstSeenEveningLocalTime",
    "PolicyRateLocalTime",
  ]) {
    assert.match(source, new RegExp(`\\$${parameter}\\b`));
  }
  assert.match(source, /ConvertTo-LocalTriggerTime \$FirstSeenMorningLocalTime/);
  assert.match(source, /ConvertTo-LocalTriggerTime \$FirstSeenEveningLocalTime/);
  assert.match(source, /ConvertTo-LocalTriggerTime \$PolicyRateLocalTime/);
});
