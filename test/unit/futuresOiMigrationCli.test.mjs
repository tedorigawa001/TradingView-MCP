// BACKLOG 102-28: the two futures OI migration scripts ran their migration as soon as they were imported. They now run
// only as the script node was started with, as every other CLI does. Each is run in a child process against stores in a
// temporary directory, with made-up observations, and with every setting and home directory pointed there.
import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { FuturesOpenInterestFirstSeenStore } from "../../build/futuresOpenInterestHistory.js";

const BUILD = new URL("../../build/", import.meta.url);

const observation = {
  futures_symbol: "COMEX_DL:GC1!",
  scope: "all_months_aggregated",
  observation_date: "2026-07-21",
  open_interest: 383317,
  source: "tradingview_chart_indicator",
  observed_at: "2026-07-23T00:00:00.000Z",
};

async function workspace(t) {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "futures-oi-migration-cli-")));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const paths = { legacy: join(dir, "legacy.jsonl"), v2: join(dir, "v2.jsonl"), v3: join(dir, "v3.jsonl") };
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TRADINGVIEW_MCP|TV_MCP|TV_CDP|OANDA)/.test(key)));
  Object.assign(env, {
    HOME: dir, USERPROFILE: dir, LOCALAPPDATA: dir,
    TRADINGVIEW_MCP_FUTURES_OI_LEGACY_HISTORY_PATH: paths.legacy,
    TRADINGVIEW_MCP_FUTURES_OI_V2_HISTORY_PATH: paths.v2,
    TRADINGVIEW_MCP_FUTURES_OI_HISTORY_PATH: paths.v3,
  });
  return { dir, paths, env };
}

const run = (args, env) => promisify(execFile)(process.execPath, args, { env })
  .then(({ stdout, stderr }) => ({ code: 0, stdout, stderr }), (error) => ({ code: error.code, stdout: error.stdout, stderr: error.stderr }));
const exists = (path) => access(path).then(() => true, () => false);

for (const [script, from, to, label] of [
  ["migrateFuturesOiDatesCli.js", "legacy", "v2", "date"],
  ["migrateFuturesOiCmeCleanupCli.js", "v2", "v3", "CME cleanup"],
]) {
  test(`the futures OI ${label} migration runs when started, and not when imported`, async (t) => {
    const { paths, env } = await workspace(t);
    await new FuturesOpenInterestFirstSeenStore(paths[from]).observeMany([observation]);
    // A URL to import and a path to start, so a checkout under a path with blanks, or on Windows, works too.
    const url = new URL(script, BUILD).href;
    // Imported, by code and from a module that names it: nothing is read, written or printed.
    for (const args of [["--input-type=module", "-e", `await import(${JSON.stringify(url)})`],
      ["--input-type=module", "-e", `import ${JSON.stringify(url)}`]]) {
      const imported = await run(args, env);
      assert.deepEqual(imported, { code: 0, stdout: "", stderr: "" }, args.join(" "));
      assert.equal(await exists(paths[to]), false, `importing ${script} migrated`);
    }
    // Started: it migrates and reports, as before.
    const started = await run([fileURLToPath(new URL(script, BUILD))], env);
    assert.equal(started.code, 0, started.stderr);
    assert.equal(started.stderr, "");
    const result = JSON.parse(started.stdout);
    assert.equal(result.source_records, 1);
    assert.equal(result.migrated, 1);
    assert.equal((await new FuturesOpenInterestFirstSeenStore(paths[to]).records()).length, 1);
  });
}
