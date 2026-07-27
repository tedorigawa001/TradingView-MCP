import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChartOperationLock } from "../../build/chartOperationLock.js";

test("chart operation lock hands ownership to a waiting process only after release", async () => {
  const directory = await mkdtemp(join(tmpdir(), "chart-operation-lock-"));
  const first = new ChartOperationLock(join(directory, "chart.lock"));
  const second = new ChartOperationLock(join(directory, "chart.lock"));
  const releaseFirst = await first.acquire();
  let acquiredSecond = false;
  const secondAttempt = second.acquire().then((release) => {
    acquiredSecond = true;
    return release;
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(acquiredSecond, false);
  await releaseFirst();
  const releaseSecond = await secondAttempt;
  assert.equal(acquiredSecond, true);
  await releaseSecond();
});
