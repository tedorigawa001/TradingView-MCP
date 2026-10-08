import { homedir, tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, open, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  PRICE_ACTION_TRAP_REPRODUCTION_V1,
  detectPriceActionTrap,
  runPriceActionTrapReproduction,
} from "../../build/priceActionTrapReproduction.js";
import { parsePriceActionTrapReproductionCliArguments, runPriceActionTrapReproductionCli } from "../../build/priceActionTrapReproductionCli.js";

const bar = (index, values) => ({
  timeIso: new Date(Date.UTC(2024, 0, 1, 0, index * 15)).toISOString(),
  open: 100, high: 105, low: 95, close: 100, tickVolume: 1, minutesPresent: 15,
  ...values,
});

test("four-bar trap uses the frozen upper-break-first rule when bar three sweeps both sides", () => {
  const bars = [
    bar(0, { high: 105, low: 95 }),
    bar(1, { high: 104, low: 96 }),
    bar(2, { high: 106, low: 94, close: 100 }),
    bar(3, { open: 101, high: 102, low: 98, close: 99 }),
  ];
  assert.deepEqual(detectPriceActionTrap(bars, 0), { direction: -1, branch: "upper_break_short" });
});

test("four-bar trap takes a lower false break only with an immediate bullish body engulf", () => {
  const valid = [
    bar(0, { high: 105, low: 95 }),
    bar(1, { high: 104, low: 96 }),
    bar(2, { high: 103, low: 94, close: 100 }),
    bar(3, { open: 99, high: 102, low: 98, close: 101 }),
  ];
  assert.deepEqual(detectPriceActionTrap(valid, 0), { direction: 1, branch: "lower_break_long" });
  assert.equal(detectPriceActionTrap([...valid.slice(0, 3), bar(3, { open: 101, high: 102, low: 98, close: 99 })], 0), null);
});

test("four-bar trap treats four adjacent rows as the frozen historical structure", () => {
  const bars = [
    bar(0, { high: 105, low: 95 }),
    bar(1, { high: 104, low: 96 }),
    { ...bar(2, { high: 106, low: 97, close: 100 }), timeIso: new Date(Date.UTC(2024, 0, 1, 1, 0)).toISOString() },
    { ...bar(4, { open: 101, high: 102, low: 98, close: 99 }), timeIso: new Date(Date.UTC(2024, 0, 1, 1, 15)).toISOString() },
  ];
  assert.deepEqual(detectPriceActionTrap(bars, 0), { direction: -1, branch: "upper_break_short" });
});

test("trap reproduction CLI requires an explicit local import and exactly eight aggregates", () => {
  const paths = Array.from({ length: 8 }, (_, index) => `series-${index}.json`);
  const parsed = parsePriceActionTrapReproductionCliArguments(["--confirm-local-import", ...paths.flatMap((path) => ["--aggregate", path])]);
  assert.deepEqual(parsed.aggregatePaths, paths);
  // Built with join(), so the separator is the host's. Comparing against a
  // literal forward slash asserted the developer's platform, not the contract.
  assert.equal(parsed.outputPath, join(homedir(), ".tradingview-mcp", "price-action-reproductions", "four-bar-trap-v1.json"));
  assert.throws(() => parsePriceActionTrapReproductionCliArguments(paths.flatMap((path) => ["--aggregate", path])), /confirm-local-import/);
  assert.throws(() => parsePriceActionTrapReproductionCliArguments(["--confirm-local-import", "--aggregate", "only-one.json"]), /exactly eight/);
});

/**
 * A panel the study will actually run on: past its two-thousand-event minimum, with matched placebo
 * cells deep enough to draw from, built so that each quantity the study reports depends on the
 * arithmetic that produces it.
 *
 * Short traps and long traps alternate by day and each pays about +50bps in its own direction, so
 * the two cancel to nothing if the direction is ever dropped. Filler bars drift steadily so the
 * placebo pool carries a sign of its own, which is what makes the direction matter in the null as
 * well as in the observed value. Three days out of the run sit at a clock range nothing else uses,
 * giving their cells a handful of anchors instead of hundreds, so the thin-cell filter has something
 * to remove rather than being a no-op the assertions would pass regardless of.
 */
const FIXTURE_START = Date.UTC(2021, 0, 4);
const FIXTURE_SLOTS = 24;
const FIXTURE_DAYS = 420;
const FIXTURE_MS = 15 * 60_000;

function buildFixtureDay(day, out, slots = FIXTURE_SLOTS) {
  const shifted = day % 140 === 0;
  const phase = day % 4;
  const short = day % 2 === 0;
  const base = 100;
  for (let slot = 0; slot < slots; slot += 1) {
    const timeIso = new Date(FIXTURE_START + day * 86_400_000 + (shifted ? 40 + slot : slot) * FIXTURE_MS).toISOString();
    const rel = slot - phase;
    let bar;
    if (rel === 0) bar = { open: base, high: base + 5, low: base - 5, close: base };
    else if (rel === 1) bar = { open: base, high: base + 4, low: base - 4, close: base };
    else if (rel === 2) bar = short
      ? { open: base + 1, high: base + 6, low: base - 1, close: base }
      : { open: base - 1, high: base + 1, low: base - 6, close: base };
    else if (rel === 3) bar = short
      ? { open: base + 2, high: base + 2.2, low: base - 0.7, close: base - 0.5 }
      : { open: base - 2, high: base + 1, low: base - 2.2, close: base + 1 };
    else {
      const step = rel - 3;
      const settled = short ? (base - 0.5) - Math.min(step, 1) * 0.5 : (base + 1) + Math.min(step, 1) * 0.5;
      const drift = settled * (1 + 0.00004 * step);
      bar = { open: drift, high: drift * 1.0006, low: drift * 0.9994, close: drift * 1.00004 };
    }
    out.push({ timeIso, ...bar, tickVolume: 1, minutesPresent: 15 });
  }
}

function fixtureSeries(symbol, { slots = FIXTURE_SLOTS, edit } = {}) {
  const bars = [];
  for (let day = 0; day < FIXTURE_DAYS; day += 1) buildFixtureDay(day, bars, slots);
  // Applied before the digest, so an edited series is a consistent aggregate rather than one the
  // hash check would reject for the wrong reason.
  edit?.(bars);
  return {
    manifest: {
      schema_version: "1.0", series: "fx_csv_m1_aggregate", evidence_tier: "official_revised_history",
      symbol, bucket_minutes: 15, start_from_broker_date: "2021.01.04", minimum_minute_coverage: 8,
      broker_clock_rule: "new_york_wall_time_plus_seven_hours", source_file: `${symbol}.csv`, source_bytes: 1,
      source_sha256: `sha256:${"0".repeat(64)}`,
      normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`,
      definition_hash: `sha256:${"0".repeat(64)}`, aggregated_at: "2026-01-01T00:00:00.000Z",
      bar_count: bars.length, first_bar_at: bars[0].timeIso, last_bar_at: bars.at(-1).timeIso,
      quality: {}, quality_issues: [], limitations: [],
    },
    bars,
  };
}

let cachedRun;
function fixtureRun() {
  cachedRun ??= runPriceActionTrapReproduction(PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols.map(fixtureSeries));
  return cachedRun;
}

test("a trap that is not preceded by an inside bar is not a trap", () => {
  // Every other case here already satisfies the inside-bar requirement, so without this the whole
  // condition can be deleted and nothing notices.
  const outside = [
    bar(0, { high: 105, low: 95 }),
    bar(1, { high: 106, low: 96 }),
    bar(2, { high: 107, low: 94, close: 100 }),
    bar(3, { open: 101, high: 102, low: 98, close: 99 }),
  ];
  assert.equal(detectPriceActionTrap(outside, 0), null, "bar two breaking the high is not inside bar one");
  const wider = [
    bar(0, { high: 105, low: 95 }),
    bar(1, { high: 104, low: 94 }),
    bar(2, { high: 106, low: 93, close: 100 }),
    bar(3, { open: 101, high: 102, low: 98, close: 99 }),
  ];
  assert.equal(detectPriceActionTrap(wider, 0), null, "bar two breaking the low is not inside bar one");
});

test("the study measures a directional return, so dropping the sign collapses the result", () => {
  const study = fixtureRun();
  assert.ok(study.event_ledger.length >= PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events);
  const branches = {};
  for (const event of study.event_ledger) branches[event.branch] = (branches[event.branch] ?? 0) + 1;
  assert.ok(branches.upper_break_short > 1000 && branches.lower_break_long > 1000, "both branches must be present");

  // Each branch pays about +50bps in its own direction and about -50 in the other one, so an
  // undirected mean sits near zero instead.
  assert.ok(Math.abs(study.empirical_null.observed_bps - 49.9) < 1.5, `observed was ${study.empirical_null.observed_bps}`);
  // The null applies each event's direction to a drawn placebo bar, so it carries the sign too.
  assert.ok(Math.abs(study.empirical_null.null_median_bps - 43.7) < 2, `null median was ${study.empirical_null.null_median_bps}`);
});

test("the null is a mean per event and is sorted before any quantile is read from it", () => {
  const study = fixtureRun();
  const { draws, distribution_bps, null_median_bps, null_95th_percentile_bps, observed_bps } = study.empirical_null;
  assert.equal(draws, PRICE_ACTION_TRAP_REPRODUCTION_V1.placebo_draws);
  assert.equal(distribution_bps.length, draws);
  // A sum rather than a mean would scale with the event count and leave the null orders of magnitude
  // away from the observed value it is supposed to be comparable with.
  assert.ok(Math.abs(null_median_bps) < Math.abs(observed_bps) * 5, "the null must be on the observed scale");
  assert.deepEqual(distribution_bps, [...distribution_bps].sort((left, right) => left - right), "the distribution must be sorted");
  assert.ok(null_95th_percentile_bps > null_median_bps, "the 95th percentile must sit above the median");

  // The +1 in the numerator and the denominator is what keeps a p-value off zero. The direction of
  // the tie comparison is not distinguishable on a continuous distribution, so it is not claimed.
  const atLeast = distribution_bps.filter((value) => value >= observed_bps).length;
  assert.equal(study.empirical_null.p_value, (atLeast + 1) / (draws + 1));
  assert.ok(study.empirical_null.p_value > 0);
});

test("an event whose matched placebo cell is too thin is excluded rather than judged against it", () => {
  const study = fixtureRun();
  const minimum = PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_placebo_anchors_per_cell;
  assert.ok(study.exclusions.thin_placebo_cell > 0, "this fixture must exercise the filter");
  const pools = Object.values(study.empirical_null.pool_sizes);
  assert.ok(pools.some((size) => size < minimum), `no cell sits below ${minimum}, so nothing is being excluded for thinness`);
  // Every event that survived has to be judged against a cell that clears the minimum.
  for (const event of study.event_ledger) {
    assert.ok(study.empirical_null.pool_sizes[event.cell] >= minimum,
      `event at ${event.signal_at} kept a pool of ${study.empirical_null.pool_sizes[event.cell]}`);
  }
});

test("the response curve and the artifact hash describe the events that were kept", () => {
  const study = fixtureRun();
  const primary = String(PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon);
  assert.equal(study.response_curve[primary].events, study.event_ledger.length);
  assert.ok(Math.abs(study.response_curve[primary].mean_bps - study.empirical_null.observed_bps) < 1e-9,
    "the curve and the null must report the same primary mean");
  assert.ok(study.response_curve[primary].lower_bps < study.response_curve[primary].mean_bps);
  assert.deepEqual(Object.keys(study.response_curve), PRICE_ACTION_TRAP_REPRODUCTION_V1.horizons.map(String));
  // Same inputs, same artifact: the seed is frozen, so a rerun must reproduce the hash.
  assert.equal(runPriceActionTrapReproduction(PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols.map(fixtureSeries)).artifact_hash, study.artifact_hash);
});

const runWith = (options) => runPriceActionTrapReproduction(PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols.map((symbol) => fixtureSeries(symbol, options)));

test("an aggregate is held to the same admissibility policy as every other CSV study", () => {
  // A bar built from one traded minute is not a fifteen-minute bar, and a hash-consistent aggregate
  // of such bars would otherwise reproduce as a valid historical result.
  assert.throws(
    () => runWith({ edit: (bars) => { bars[500].minutesPresent = 1; } }),
    /reports 1 of 15 minutes/,
  );
  // And a series aggregated under a policy that permits them is refused before its bars are read.
  assert.throws(
    () => runPriceActionTrapReproduction(PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols.map((symbol) => {
      const entry = fixtureSeries(symbol);
      return { ...entry, manifest: { ...entry.manifest, minimum_minute_coverage: 4 } };
    })),
    /minimum_minute_coverage 4/,
  );
  // A logarithmic return needs a positive price, which a positive high alone does not guarantee.
  assert.throws(
    () => runWith({ edit: (bars) => { Object.assign(bars[500], { open: 0.5, close: 0.5, high: 1, low: -1 }); } }),
    /non-positive price/,
  );
});

test("a horizon left short of the minimum is reported unevaluated, not as a null-valued measurement", () => {
  // Shorter days, so the longest horizon runs off the end for half the events while the primary is
  // untouched. Before this the shortfall arrived as NaN and JSON wrote it as null - identical on
  // the page to a horizon that was measured and came out empty.
  const study = runWith({ slots: 21 });
  const primary = study.response_curve[String(PRICE_ACTION_TRAP_REPRODUCTION_V1.primary_horizon)];
  const longest = study.response_curve["16"];

  assert.equal(primary.status, "measured");
  assert.ok(Number.isFinite(primary.mean_bps));
  assert.ok(primary.events >= PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events);

  assert.equal(longest.status, "not_evaluated");
  assert.ok(longest.events < PRICE_ACTION_TRAP_REPRODUCTION_V1.minimum_events);
  assert.equal(longest.mean_bps, null);
  assert.equal(longest.lower_bps, null);
  assert.equal(longest.upper_bps, null);
  // Explicitly null, not NaN coerced to null on the way out.
  assert.equal(JSON.parse(JSON.stringify(longest)).status, "not_evaluated");
});

test("every horizon says which of the two it is, so a null is never ambiguous", () => {
  for (const point of Object.values(fixtureRun().response_curve)) {
    assert.ok(point.status === "measured" || point.status === "not_evaluated");
    assert.equal(point.status === "measured", Number.isFinite(point.mean_bps));
  }
});

// BACKLOG 102-25: a reproduction is published as immutable evidence. The file at the output path is never replaced or
// left half-written: a re-run that produces the same bytes finds them there, a different result is refused with the
// earlier file kept, and a failed write leaves the path as it was. Everything runs on made-up aggregates in a
// temporary directory; the faults are injected into node:fs/promises, whose live bindings the publication reads.
const CLI = fileURLToPath(new URL("../../build/priceActionTrapReproductionCli.js", import.meta.url));
const fsp = createRequire(import.meta.url)("node:fs/promises");
const realLink = fsp.link;
const earlierEvidence = '{"earlier":"evidence"}\n';

async function reproductionWorkspace(t) {
  const dir = await mkdtemp(join(tmpdir(), "trap-reproduction-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const argv = ["--confirm-local-import"];
  for (const symbol of PRICE_ACTION_TRAP_REPRODUCTION_V1.symbols) {
    const path = join(dir, `${symbol}.json`);
    await writeFile(path, JSON.stringify(fixtureSeries(symbol)));
    argv.push("--aggregate", path);
  }
  // A directory that does not exist yet, which the run creates.
  const out = join(dir, "evidence", "four-bar-trap-v1.json");
  return { dir, out, argv: [...argv, "--out", out] };
}
const publishedBody = () => `${JSON.stringify(fixtureRun(), null, 2)}\n`;
const stagingLeft = async (out) => (await readdir(dirname(out))).filter((name) => name !== basename(out));

test("a reproduction never overwrites a different file at its output path", async (t) => {
  const { dir, out, argv } = await reproductionWorkspace(t);
  await mkdir(dirname(out));
  await writeFile(out, earlierEvidence);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(TRADINGVIEW_MCP|TV_MCP|TV_CDP|OANDA)/.test(key)));
  const run = spawnSync(process.execPath, [CLI, ...argv], {
    encoding: "utf8", timeout: 60_000, env: { ...env, HOME: dir, USERPROFILE: dir, LOCALAPPDATA: dir },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.equal(run.stdout, "");
  assert.match(run.stderr, /already holds a different file, and reproduction evidence is never overwritten/);
  assert.ok(run.stderr.includes(`this run's artifact_hash is ${fixtureRun().artifact_hash}`), run.stderr);
  assert.equal(await readFile(out, "utf8"), earlierEvidence);
  assert.deepEqual(await stagingLeft(out), []);
  // Nor one of the same length that differs in a single byte.
  const altered = `[${publishedBody().slice(1)}`;
  await writeFile(out, altered);
  await assert.rejects(runPriceActionTrapReproductionCli(argv), /never overwritten/);
  assert.equal(await readFile(out, "utf8"), altered);
  // Something that is not a file at all is not replaced either.
  await rm(out);
  await mkdir(out);
  await assert.rejects(runPriceActionTrapReproductionCli(argv), process.platform === "win32" ? Error : /never overwritten/);
  assert.equal((await lstat(out)).isDirectory(), true);
  assert.deepEqual(await stagingLeft(out), []);
});

test("a re-run on the same inputs finds its reproduction already published and leaves it", async (t) => {
  const { out, argv } = await reproductionWorkspace(t);
  // The new name is synced into its directory where the host can sync one.
  const realOpen = fsp.open;
  let directoryOpened = false;
  fsp.open = async (path, ...rest) => {
    if (String(path) === dirname(out)) directoryOpened = true;
    return realOpen(path, ...rest);
  };
  syncBuiltinESMExports();
  let first;
  try {
    first = await runPriceActionTrapReproductionCli(argv);
  } finally {
    fsp.open = realOpen;
    syncBuiltinESMExports();
  }
  assert.equal(directoryOpened, process.platform !== "win32");
  assert.equal(first.written, true);
  assert.equal(first.artifact_hash, fixtureRun().artifact_hash);
  assert.equal(first.output_path, out);
  assert.equal(await readFile(out, "utf8"), publishedBody());
  if (process.platform !== "win32") assert.equal((await stat(out)).mode & 0o777, 0o600);
  const before = await stat(out);
  assert.deepEqual(await runPriceActionTrapReproductionCli(argv), { ...first, written: false });
  const after = await stat(out);
  assert.equal(after.ino, before.ino);
  assert.equal(after.mtimeMs, before.mtimeMs);
  assert.deepEqual(await stagingLeft(out), []);
  // Two runs at once: one publishes, the other finds the same bytes there.
  await rm(out);
  const both = await Promise.all([runPriceActionTrapReproductionCli(argv), runPriceActionTrapReproductionCli(argv)]);
  assert.deepEqual(both.map((summary) => summary.written).sort(), [false, true]);
  assert.equal(await readFile(out, "utf8"), publishedBody());
  assert.deepEqual(await stagingLeft(out), []);
});

test("a write that fails leaves no reproduction behind, and an earlier one as it was", async (t) => {
  const { out, argv } = await reproductionWorkspace(t);
  const probe = await open(argv.at(-3), "r");
  const proto = Object.getPrototypeOf(probe);
  await probe.close();
  for (const earlier of [null, earlierEvidence]) {
    if (earlier !== null) await writeFile(out, earlier);
    for (const method of ["writeFile", "sync"]) {
      const original = proto[method];
      proto[method] = async () => { throw new Error(`synthetic ${method} failure`); };
      try {
        await assert.rejects(runPriceActionTrapReproductionCli(argv), new RegExp(`synthetic ${method} failure`));
      } finally {
        proto[method] = original;
      }
      if (earlier === null) await assert.rejects(stat(out), { code: "ENOENT" });
      else assert.equal(await readFile(out, "utf8"), earlier);
      assert.deepEqual(await stagingLeft(out), []);
    }
  }
  await rm(out);
  assert.equal((await runPriceActionTrapReproductionCli(argv)).written, true);
  assert.equal(await readFile(out, "utf8"), publishedBody());
});

test("a reproduction another run publishes meanwhile is kept, and agreed with only if identical", async (t) => {
  const { out, argv } = await reproductionWorkspace(t);
  for (const [competitor, agrees] of [[publishedBody(), true], ['{"another":"run"}\n', false]]) {
    // The other run's file lands between this run's staging and its link into place.
    fsp.link = async (from, to) => {
      if (String(to) === out) await writeFile(out, competitor);
      return realLink(from, to);
    };
    syncBuiltinESMExports();
    try {
      if (agrees) assert.equal((await runPriceActionTrapReproductionCli(argv)).written, false);
      else await assert.rejects(runPriceActionTrapReproductionCli(argv), /never overwritten/);
    } finally {
      fsp.link = realLink;
      syncBuiltinESMExports();
    }
    assert.equal(await readFile(out, "utf8"), competitor);
    assert.deepEqual(await stagingLeft(out), []);
    await rm(out);
  }
});

test("a symbolic link at the output path is refused and what it points at left alone", { skip: process.platform === "win32" && "symbolic links need privileges on Windows" }, async (t) => {
  const { dir, out, argv } = await reproductionWorkspace(t);
  const target = join(dir, "elsewhere.json");
  await mkdir(dirname(out));
  await symlink(target, out);
  for (const contents of ["untouched\n", publishedBody()]) {
    await writeFile(target, contents);
    await assert.rejects(runPriceActionTrapReproductionCli(argv), /must be a regular file, not a symbolic link/);
    assert.equal(await readFile(target, "utf8"), contents);
    assert.equal((await lstat(out)).isSymbolicLink(), true);
    assert.deepEqual(await stagingLeft(out), []);
  }
});
