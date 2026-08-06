import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { archiveOfficialMacroRaw, collectOfficialMacroEvents, computeOfficialMacroEventCoverage, parseBlsArchiveEvents, parseBlsArchiveNonPublications, parseFomcHistoricalPage } from "../../build/officialMacroEventSources.js";
import { buildMacroEvent60mStudy, firstFullM60BarAfterRelease, NFP_SHORT_FRIDAY_60M_CONTRACT } from "../../build/macroEvent60mStudy.js";
import { preflightMacroEvent60mContract } from "../../build/macroEvent60mPreflight.js";
import { parseMacroEvent60mPreflightCliArguments } from "../../build/macroEvent60mPreflightCli.js";

test("BLS archive events retain their official document URL and convert 8:30 ET across DST", () => {
  const raw = ["01152025", "06122024", "05152024", "04102024", "03122024", "02132024", "01112024", "12122023", "11142023", "10122023", "09132023", "08102023"]
    .map((date, index) => `<a href="/news.release/archives/cpi_${date}.${index % 2 ? "pdf" : "htm"}">release</a>`).join("") +
    '<a href="/news.release/archives/cpi_06122024.htm">HTML rendition</a>';
  const events = parseBlsArchiveEvents("us_cpi", raw, "https://www.bls.gov/bls/news-release/cpi.htm");
  assert.equal(events.length, 12);
  const june = events.find((event) => event.event_id === "us_cpi:2024-06-12");
  const january = events.find((event) => event.event_id === "us_cpi:2025-01-15");
  assert.equal(june?.occurred_at, "2024-06-12T12:30:00.000Z");
  assert.equal(january?.occurred_at, "2025-01-15T13:30:00.000Z");
  assert.equal(june?.source_url, "https://www.bls.gov/news.release/archives/cpi_06122024.htm");
  assert.match(june?.raw_sha256 ?? "", /^sha256:[a-f0-9]{64}$/);
});

test("BLS documented CPI and NFP shutdown non-publications are preserved as source-backed absences", () => {
  const cases = [
    ["us_cpi", "Consumer Price Index", "https://www.bls.gov/bls/news-release/cpi.htm"],
    ["us_nfp", "Employment Situation", "https://www.bls.gov/bls/news-release/empsit.htm"],
  ];
  for (const [kind, title, sourceUrl] of cases) {
    const raw = `<li>October 2025 ${title} - Not published because of 2025 lapse in federal government appropriations</li>`;
    const absent = parseBlsArchiveNonPublications(kind, raw, sourceUrl);
    assert.deepEqual(absent.map((item) => [item.event_kind, item.reference_month, item.reason, item.source_url]), [[kind, "2025-10", "not_published_due_to_lapse_in_appropriations", sourceUrl]]);
    assert.match(absent[0].raw_sha256, /^sha256:[a-f0-9]{64}$/);
  }
});

test("FOMC pages turn official statement links into 14:00 New York releases", () => {
  const raw = '<a href="/newsevents/pressreleases/monetary20240612a.htm">statement</a>';
  const events = parseFomcHistoricalPage(raw, "https://www.federalreserve.gov/monetarypolicy/fomchistorical2024.htm");
  assert.deepEqual(events.map((event) => [event.event_id, event.occurred_at]), [["fomc_statement:2024-06-12", "2024-06-12T18:00:00.000Z"]]);
});

test("M60 macro studies start after, not around, an 8:30 release", () => {
  assert.equal(firstFullM60BarAfterRelease("2024-06-12T12:30:00.000Z"), "2024-06-12T13:00:00.000Z");
  assert.equal(firstFullM60BarAfterRelease("2024-06-12T18:00:00.000Z"), "2024-06-12T18:00:00.000Z");
});

test("official collection proves every completed requested BLS year before producing an artifact", async () => {
  const monthly = (year) => Array.from({ length: 12 }, (_, index) => `<a href="/news.release/archives/cpi_${String(index + 1).padStart(2, "0")}15${year}.htm">release</a>`).join("");
  const response = { ok: true, status: 200, headers: { get: () => null }, text: async () => `${monthly(2016)}${monthly(2017)}` };
  const artifact = await collectOfficialMacroEvents({ kind: "us_cpi", fromYear: 2016, toYear: 2017, now: new Date("2018-01-01T00:00:00.000Z"), rawArchivePath: await mkdtemp(join(tmpdir(), "macro-events-")), fetch: async () => response });
  assert.equal(artifact.events.length, 24);
  assert.deepEqual(artifact.non_publications, []);
  assert.deepEqual(artifact.coverage.coverage_issues, []);
  const incompleteArchive = await mkdtemp(join(tmpdir(), "macro-events-"));
  const incomplete = await collectOfficialMacroEvents({ kind: "us_cpi", fromYear: 2016, toYear: 2018, now: new Date("2019-01-01T00:00:00.000Z"), rawArchivePath: incompleteArchive, fetch: async () => response });
  assert.deepEqual(incomplete.coverage.coverage_issues, ["insufficient_official_event_coverage:2018:0_plus_0_excused_of_at_least_12"]);
});

test("a source-backed BLS non-publication closes annual coverage without inventing an event", async () => {
  const monthly = (year, missingMonth) => Array.from({ length: 12 }, (_, index) => index + 1 === missingMonth ? "" : `<a href=\"/news.release/archives/cpi_${String(index + 1).padStart(2, "0")}15${year}.htm\">release</a>`).join("");
  // Archive URLs are named by publication date, and the note names the month of the data. October
  // data is a November release, so the release the note excuses is the November one - omitting the
  // October link instead would leave a genuinely missing release standing beside an unused excuse.
  const raw = `${monthly(2024)}${monthly(2025, 11)}<li>October 2025 Consumer Price Index - Not published because of 2025 lapse in federal government appropriations</li>`;
  const response = { ok: true, status: 200, headers: { get: () => null }, text: async () => raw };
  const artifact = await collectOfficialMacroEvents({ kind: "us_cpi", fromYear: 2024, toYear: 2025, now: new Date("2026-01-01T00:00:00.000Z"), rawArchivePath: await mkdtemp(join(tmpdir(), "macro-events-")), fetch: async () => response });
  assert.equal(artifact.events.length, 23);
  assert.deepEqual(artifact.non_publications.map((item) => item.reference_month), ["2025-10"]);
  assert.deepEqual(artifact.coverage.excused_non_publications_by_year, { "2025": 1 });
  assert.deepEqual(artifact.coverage.missing_release_months, []);
  assert.deepEqual(artifact.coverage.coverage_issues, []);
});

test("FOMC does not imply a 14:00 release time before its reviewed start year", async () => {
  await assert.rejects(() => collectOfficialMacroEvents({ kind: "fomc_statement", fromYear: 2012, toYear: 2016 }), /before 2013/);
});

test("raw archive refuses an existing digest path with different content", async () => {
  const directory = await mkdtemp(join(tmpdir(), "macro-events-"));
  const sha = "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
  await writeFile(join(directory, `${sha.slice(7)}.raw`), "different", { mode: 0o600 });
  await assert.rejects(() => archiveOfficialMacroRaw(directory, sha, "expected"), /hash does not match/);
});

test("macro study refuses an aggregate other than M60 before interpreting events", () => {
  assert.throws(() => buildMacroEvent60mStudy({ manifest: { bucket_minutes: 15 }, bars: [], artifact: { event_kind: "us_cpi" }, folds: [] }), /requires a 60-minute aggregate/);
});

test("the NFP Friday contract is explicit, short, and cannot be applied to another event source", () => {
  assert.deepEqual([NFP_SHORT_FRIDAY_60M_CONTRACT.initial_range_bars, NFP_SHORT_FRIDAY_60M_CONTRACT.breakout_within_bars, NFP_SHORT_FRIDAY_60M_CONTRACT.retest_within_bars, NFP_SHORT_FRIDAY_60M_CONTRACT.horizons], [1, 2, 3, [1]]);
  assert.throws(() => buildMacroEvent60mStudy({ manifest: { bucket_minutes: 60 }, bars: [], artifact: { event_kind: "us_cpi", coverage: { coverage_issues: [] } }, folds: [], contractId: "nfp_short_friday_v2" }), /only supports us_nfp/);
});

test("the NFP Friday v2 contract evaluates its short breakout and retest sequence without crossing a session boundary", () => {
  const prices = [
    [1, 1.1, 0.9, 1],
    [1, 1.2, 1, 1.15],
    [1.15, 1.16, 1.05, 1.12],
    [1.12, 1.2, 1.1, 1.18],
    [1.18, 1.22, 1.16, 1.2],
  ];
  const bars = prices.map(([open, high, low, close], index) => ({ timeIso: `2024-06-07T${String(13 + index).padStart(2, "0")}:00:00.000Z`, open, high, low, close, tickVolume: 1, minutesPresent: 60 }));
  const manifest = { bucket_minutes: 60, minimum_minute_coverage: 60, bar_count: bars.length, normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`, first_bar_at: bars[0].timeIso, last_bar_at: bars.at(-1).timeIso, symbol: "OANDA:EURUSD" };
  const artifact = {
    event_kind: "us_nfp", retrieved_at: "2024-06-08T00:00:00.000Z", coverage: { coverage_issues: [] },
    events: [{ event_id: "us_nfp:2024-06-07", event_kind: "us_nfp", occurred_at: "2024-06-07T12:30:00.000Z", source_url: "https://example.test", raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  };
  const result = buildMacroEvent60mStudy({ manifest, bars, artifact, contractId: "nfp_short_friday_v2", folds: [
    { foldId: "first", from: "2024-01-01T00:00:00.000Z", to: "2024-06-08T00:00:00.000Z" },
    { foldId: "second", from: "2024-06-08T00:00:00.000Z", to: "2025-01-01T00:00:00.000Z" },
  ] });
  assert.equal(result.contract.contract_id, "us_nfp_short_friday_aftershock_m60_v2");
  assert.equal(result.result.byBranch.retest_up.events, 1);
  assert.equal(result.result.byBranch.retest_up.horizons[1].directionalReturn.count, 1);
  assert.equal(result.result.quality.irregularRetestWindow, 0);
});

test("macro-event preflight counts a Friday session boundary before a study can screen on price", () => {
  const bars = Array.from({ length: 8 }, (_, index) => {
    const timeIso = `2024-06-07T${String(13 + index).padStart(2, "0")}:00:00.000Z`;
    return { timeIso, open: 1, high: 1.1, low: 0.9, close: 1, tickVolume: 1, minutesPresent: 60 };
  });
  const manifest = {
    bucket_minutes: 60, minimum_minute_coverage: 60, bar_count: bars.length,
    normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`,
    first_bar_at: bars[0].timeIso, last_bar_at: bars.at(-1).timeIso,
  };
  const artifact = {
    event_kind: "us_nfp", coverage: { coverage_issues: [] },
    events: [{ event_id: "us_nfp:2024-06-07", event_kind: "us_nfp", occurred_at: "2024-06-07T12:30:00.000Z", source_url: "https://example.test", raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }],
  };
  const available = preflightMacroEvent60mContract({ manifest, bars, artifact, contractId: "nfp_short_friday_v2" });
  assert.equal(available.potentially_evaluable_events, 1);
  const gappedBars = bars.filter((bar) => !bar.timeIso.includes("17:00"));
  const gapped = preflightMacroEvent60mContract({ manifest: { ...manifest, bar_count: gappedBars.length, normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(gappedBars), "utf8").digest("hex")}` }, bars: gappedBars, artifact, contractId: "nfp_short_friday_v2" });
  assert.equal(gapped.availability.non_contiguous_maximum_window, 1);
  assert.deepEqual(gapped.by_anchor_weekday.Fri.non_contiguous_maximum_window, 1);
  assert.equal(gapped.non_contiguous_window_examples[0].gap_hours, 2);
});

test("the common macro contract exposes Friday's weekend boundary instead of treating it as a data-filled window", () => {
  const friday = Array.from({ length: 8 }, (_, index) => `2024-06-07T${String(13 + index).padStart(2, "0")}:00:00.000Z`);
  const sunday = Array.from({ length: 13 }, (_, index) => new Date(Date.parse("2024-06-09T21:00:00.000Z") + index * 3_600_000).toISOString());
  const bars = [...friday, ...sunday].map((timeIso) => ({ timeIso, open: 1, high: 1.1, low: 0.9, close: 1, tickVolume: 1, minutesPresent: 60 }));
  const manifest = { bucket_minutes: 60, minimum_minute_coverage: 60, bar_count: bars.length, normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`, first_bar_at: bars[0].timeIso, last_bar_at: bars.at(-1).timeIso };
  const artifact = { event_kind: "us_nfp", coverage: { coverage_issues: [] }, events: [{ event_id: "us_nfp:2024-06-07", event_kind: "us_nfp", occurred_at: "2024-06-07T12:30:00.000Z", source_url: "https://example.test", raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] };
  const result = preflightMacroEvent60mContract({ manifest, bars, artifact });
  assert.equal(result.availability.non_contiguous_maximum_window, 1);
  assert.equal(result.by_anchor_weekday.Fri.non_contiguous_maximum_window, 1);
  assert.equal(result.non_contiguous_window_examples[0].gap_hours, 49);
});

test("macro-event preflight identifies a missing event anchor without inferring a substitute bar", () => {
  const bars = Array.from({ length: 8 }, (_, index) => ({ timeIso: `2024-06-07T${String(14 + index).padStart(2, "0")}:00:00.000Z`, open: 1, high: 1.1, low: 0.9, close: 1, tickVolume: 1, minutesPresent: 60 }));
  const manifest = { bucket_minutes: 60, minimum_minute_coverage: 60, bar_count: bars.length, normalized_sha256: `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`, first_bar_at: bars[0].timeIso, last_bar_at: bars.at(-1).timeIso };
  const artifact = { event_kind: "us_nfp", coverage: { coverage_issues: [] }, events: [{ event_id: "us_nfp:2024-06-07", event_kind: "us_nfp", occurred_at: "2024-06-07T12:30:00.000Z", source_url: "https://example.test", raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }] };
  const result = preflightMacroEvent60mContract({ manifest, bars, artifact, contractId: "nfp_short_friday_v2" });
  assert.equal(result.availability.missing_anchor_bar, 1);
  assert.equal(result.potentially_evaluable_events, 0);
});

test("macro-event preflight CLI requires explicit local-import confirmation and a known contract", () => {
  assert.throws(() => parseMacroEvent60mPreflightCliArguments(["--aggregate", "a", "--events", "b"]), /requires --aggregate, --events, and --confirm-local-import/);
  assert.throws(() => parseMacroEvent60mPreflightCliArguments(["--aggregate", "a", "--events", "b", "--contract", "unknown", "--confirm-local-import"]), /must name a supported macro event contract/);
  assert.equal(parseMacroEvent60mPreflightCliArguments(["--aggregate", "a", "--events", "b", "--contract", "nfp_short_friday_v2", "--confirm-local-import"]).contractId, "nfp_short_friday_v2");
});

test("a month with no release is refused even when the yearly count is met", async () => {
  // Twelve releases spread over eleven months is a hole with a duplicate beside it, which is what a
  // reissue under a second date looks like. The count alone cannot see it.
  const filler = Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(2, "0")}152017`);
  const page = (dates, note = "") => {
    const body = [...dates, ...filler].map((date) => `<a href="/news.release/archives/cpi_${date}.htm">r</a>`).join("") + note;
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => body };
  };
  const months2016 = (skip = []) => Array.from({ length: 12 }, (_, index) => index + 1)
    .filter((month) => !skip.includes(month)).map((month) => `${String(month).padStart(2, "0")}152016`);
  const collect = async (dates, note) => collectOfficialMacroEvents({
    kind: "us_cpi", fromYear: 2016, toYear: 2016, now: new Date("2017-01-01T00:00:00.000Z"),
    rawArchivePath: await mkdtemp(join(tmpdir(), "macro-events-")), fetch: async () => page(dates, note),
  });

  const complete = await collect(months2016());
  assert.deepEqual(complete.coverage.coverage_issues, []);
  assert.deepEqual(complete.coverage.missing_release_months, []);

  const gap = await collect([...months2016([3]), "02012016"]);
  assert.deepEqual(gap.coverage.missing_release_months, ["2016-03"]);
  assert.deepEqual(gap.coverage.coverage_issues, ["missing_official_monthly_release:2016-03"]);
});

test("an excused non-publication is credited to the release it would have been, not its data month", async () => {
  // The archive names the month of the data. Both series publish month M in month M plus one, so
  // February data is a March release; crediting the month as written would excuse the wrong slot,
  // and for December data the wrong year as well.
  const filler = Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(2, "0")}152017`);
  const links = [...Array.from({ length: 12 }, (_, index) => index + 1).filter((month) => month !== 3)
    .map((month) => `${String(month).padStart(2, "0")}152016`), ...filler];
  const note = "<p>February 2016 Consumer Price Index - Not published because of the 2025 lapse in federal government appropriations</p>";
  const body = links.map((date) => `<a href="/news.release/archives/cpi_${date}.htm">r</a>`).join("") + note;
  const artifact = await collectOfficialMacroEvents({
    kind: "us_cpi", fromYear: 2016, toYear: 2016, now: new Date("2017-01-01T00:00:00.000Z"),
    rawArchivePath: await mkdtemp(join(tmpdir(), "macro-events-")),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body }),
  });
  assert.equal(artifact.non_publications[0].reference_month, "2016-02");
  // Eleven releases plus the excused March slot meets the year, and March is not reported missing.
  assert.deepEqual(artifact.coverage.missing_release_months, []);
  assert.deepEqual(artifact.coverage.coverage_issues, []);
  assert.equal(artifact.coverage.excused_non_publications_by_year["2016"], 1);
});

test("a release the source has only scheduled is not recorded as one that happened", async () => {
  // BLS publishes the employment situation schedule a year ahead, archive URL and all, and a link
  // is a link to a parser. A release that has not occurred has no occurrence time: the schedule
  // says when it should happen, and a delay would leave that time wrong with nothing to show it.
  const past = ["01092026", "02062026", "03062026", "04032026", "05082026", "06052026", "07022026"];
  const scheduled = ["08072026", "09042026", "10022026", "11062026", "12042026"];
  const filler = Array.from({ length: 12 }, (_, index) => `${String(index + 1).padStart(2, "0")}062025`);
  const body = [...past, ...scheduled, ...filler]
    .map((date) => `<a href="/news.release/archives/empsit_${date}.htm">release</a>`).join("");
  const artifact = await collectOfficialMacroEvents({
    kind: "us_nfp", fromYear: 2025, toYear: 2026, now: new Date("2026-08-05T00:00:00.000Z"),
    rawArchivePath: await mkdtemp(join(tmpdir(), "macro-events-")),
    fetch: async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => body }),
  });
  assert.equal(artifact.events.length, past.length + filler.length);
  assert.ok(artifact.events.every((event) => event.occurred_at <= artifact.retrieved_at));
  // The schedule is kept rather than dropped: knowing the next release is due is useful, and it is
  // only the claim that it already occurred that has to go.
  assert.deepEqual(artifact.scheduled_future_releases.map((event) => event.occurred_at.slice(0, 10)),
    ["2026-08-07", "2026-09-04", "2026-10-02", "2026-11-06", "2026-12-04"]);
  assert.ok(artifact.scheduled_future_releases.every((event) => event.occurred_at > artifact.retrieved_at));
});

// Coverage is exported so these run against the same function the collector uses, and so a stored
// artifact can be rechecked from its own events without going back to the network.
const monthlyEvents = (kind, year, skip = []) => Array.from({ length: 12 }, (_, index) => index + 1)
  .filter((month) => !skip.includes(month))
  .map((month) => ({
    event_id: `${kind}:${year}-${String(month).padStart(2, "0")}-10`,
    event_kind: kind,
    occurred_at: `${year}-${String(month).padStart(2, "0")}-10T13:30:00.000Z`,
    source_url: "https://www.bls.gov/example",
    raw_sha256: `sha256:${"0".repeat(64)}`,
  }));
const lapse = (kind, referenceMonth) => ({
  event_kind: kind,
  reference_month: referenceMonth,
  reason: "not_published_due_to_lapse_in_appropriations",
  source_url: "https://www.bls.gov/example",
  raw_sha256: `sha256:${"0".repeat(64)}`,
});
const AFTER_2025 = new Date("2026-06-01T00:00:00.000Z");

test("an excused month covers the gap the lapse actually left, on either side of the M+1 rule", () => {
  // The 2025 lapse produced both shapes from one excused reference month each. CPI published late
  // but inside October and lost November; the employment situation slipped out of October itself.
  // Reading M+1 as the answer accepted the first and reported the second as a missing release.
  const cpiShape = computeOfficialMacroEventCoverage("us_cpi", 2025, 2025, monthlyEvents("us_cpi", 2025, [11]), [lapse("us_cpi", "2025-10")], AFTER_2025);
  assert.deepEqual(cpiShape.missing_release_months, []);
  assert.deepEqual(cpiShape.coverage_issues, []);

  const nfpShape = computeOfficialMacroEventCoverage("us_nfp", 2025, 2025, monthlyEvents("us_nfp", 2025, [10]), [lapse("us_nfp", "2025-10")], AFTER_2025);
  assert.deepEqual(nfpShape.missing_release_months, []);
  assert.deepEqual(nfpShape.coverage_issues, []);

  // Both still report the excusal itself, so the artifact says why the year holds eleven releases.
  assert.deepEqual(nfpShape.excused_non_publications_by_year, { 2025: 1 });
});

test("an excusal covers one gap only, and none that its lapse could not have caused", () => {
  const twoGaps = computeOfficialMacroEventCoverage("us_nfp", 2025, 2025, monthlyEvents("us_nfp", 2025, [10, 11]), [lapse("us_nfp", "2025-10")], AFTER_2025);
  assert.equal(twoGaps.missing_release_months.length, 1);

  // A gap nowhere near the excused month stays a gap: an excusal is not a spare credit.
  const distant = computeOfficialMacroEventCoverage("us_nfp", 2025, 2025, monthlyEvents("us_nfp", 2025, [3]), [lapse("us_nfp", "2025-10")], AFTER_2025);
  assert.deepEqual(distant.missing_release_months, ["2025-03"]);

  // And with nothing excused, a hole beside a duplicate is still a hole - the reissue case.
  const reissue = computeOfficialMacroEventCoverage("us_cpi", 2025, 2025, [...monthlyEvents("us_cpi", 2025, [7]), {
    event_id: "us_cpi:2025-08-28", event_kind: "us_cpi", occurred_at: "2025-08-28T12:30:00.000Z",
    source_url: "https://www.bls.gov/example", raw_sha256: `sha256:${"0".repeat(64)}`,
  }], [], AFTER_2025);
  assert.deepEqual(reissue.missing_release_months, ["2025-07"]);
  assert.deepEqual(reissue.coverage_issues, ["missing_official_monthly_release:2025-07"]);
});
