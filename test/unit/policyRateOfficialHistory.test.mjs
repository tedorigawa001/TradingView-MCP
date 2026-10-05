import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OfficialPolicyRateHistoryStore } from "../../build/policyRateOfficialHistory.js";
import { getOfficialPolicyRateHistoryContext } from "../../build/policyRateOfficialHistoryContext.js";

const observation = (overrides = {}) => ({
  currency: "USD", source_symbol: "ECONOMICS:USINTR", observation_date: "2020-03-15", value: 0.25,
  source_url: "https://www.federalreserve.gov/monetarypolicy/openmarket.htm", source_vintage_at: null,
  raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  retrieved_at: "2026-07-29T12:00:00.000Z", ...overrides,
});

test("official revised history is stored separately and retains downloaded revisions", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  assert.equal((await store.observeMany([observation()])).recorded.length, 1);
  const revision = await store.observeMany([observation({ value: 0.5, retrieved_at: "2026-07-30T12:00:00.000Z" })]);
  assert.equal(revision.revisions, 1);
  assert.equal((await store.getLatest("USD")).value, 0.5);
  const coverage = await store.coverage();
  assert.equal(coverage.evidence_tier, "exploratory_revised_history");
  assert.equal(coverage.currencies.USD.revisions, 1);
  const snapshot = await store.observeRawSnapshot({ source_id: "ecb_deposit_facility", source_url: "https://data-api.ecb.europa.eu/service/data/FM", raw_sha256: observation().raw_sha256, source_observation_count: 10, source_first_observation_date: "2020-01-01", source_last_observation_date: "2020-03-15", raw_bytes: 100, retrieved_at: "2026-07-30T12:00:00.000Z" });
  assert.equal(snapshot.recorded, true);
  assert.equal((await store.coverage()).raw_snapshots, 1);
  assert.equal((await store.coverage()).source_coverage.ecb_deposit_facility.source_observation_count, 10);
});

test("official revised history does not treat a response-level vintage timestamp as a value revision", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  await store.observeMany([observation({ source_vintage_at: "2026-07-29T01:00:00.000Z" })]);
  const repeat = await store.observeMany([observation({ source_vintage_at: "2026-07-30T01:00:00.000Z", retrieved_at: "2026-07-30T12:00:00.000Z" })]);
  assert.equal(repeat.recorded.length, 0);
  assert.equal(repeat.unchanged, 1);
  assert.equal(repeat.revisions, 0);
  assert.equal((await store.coverage()).currencies.USD.revisions, 0);
  assert.equal((await store.coverage()).currencies.USD.metadata_only_versions, 0);
});

test("official revised history context is explicitly exploratory and never point-in-time evidence", async () => {
  const provider = { getLatest: async (currency) => currency === "USD" ? {
    schema_version: "1.0", sequence: 1, series: "policy_rate_official_history", evidence_tier: "exploratory_revised_history",
    ...observation(), first_seen_at: "2026-07-29T12:00:00.000Z",
  } : null };
  const result = await getOfficialPolicyRateHistoryContext({ provider, currencies: ["USD", "EUR"] });
  assert.equal(result.evidence_tier, "exploratory_revised_history");
  assert.equal(result.eligibility, "exploratory_only");
  assert.equal(result.point_in_time_status, "not_available");
  assert.equal(result.source_coverage, null);
  assert.equal(result.rates[0].quality_issues[0], "revised_history_not_point_in_time");
  assert.equal(result.rates[0].raw_sha256, observation().raw_sha256);
  assert.equal(result.rates[1].status, "unavailable");
});

test("official revised history preserves a no-single-rate-target policy framework as an explicit gap", async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  const store = new OfficialPolicyRateHistoryStore(path);
  await store.observeMany([observation({ currency: "JPY", source_symbol: "ECONOMICS:JPINTR", observation_date: "2013-04-04", value: null, rate_status: "no_single_rate_target" })]);
  const row = await store.getLatest("JPY");
  assert.equal(row.value, null);
  const result = await getOfficialPolicyRateHistoryContext({ provider: store, currencies: ["JPY"] });
  assert.equal(result.status, "partial");
  assert.equal(result.rates[0].status, "unavailable");
  assert.equal(result.rates[0].quality_issues[0], "official_policy_framework_has_no_single_rate_target");
});

// BACKLOG 102-09: a source keeps only its change points, so inside a download's span a date it no longer lists is no change.
const HASH_1 = `sha256:${"1".repeat(64)}`;
const HASH_2 = `sha256:${"2".repeat(64)}`;
const HASH_3 = `sha256:${"3".repeat(64)}`;
const ECB_URL = "https://data-api.ecb.europa.eu/service/data/FM/D.U2.EUR.4F.KR.DFR.LEV?format=csvdata";
const ecb = (observation_date, value, raw_sha256, retrieved_at) => observation({
  currency: "EUR", source_symbol: "ECONOMICS:EUINTR", observation_date, value, source_url: ECB_URL, raw_sha256, retrieved_at,
});
/** Every calendar day from `first` to `last`, as a daily export observes them. */
const days = (first, last) => {
  const dates = [];
  for (let time = Date.parse(`${first}T00:00:00Z`); time <= Date.parse(`${last}T00:00:00Z`); time += 86_400_000) dates.push(new Date(time).toISOString().slice(0, 10));
  return dates;
};
/** A file observing the given dates. */
const observedIn = (raw_sha256, observed_dates, source_url = ECB_URL) => ({ source_url, raw_sha256, source_vintage_at: null, observed_dates });
/** A daily file observing every day from `first` to `last`. */
const span = (raw_sha256, first, last, source_url = ECB_URL) => observedIn(raw_sha256, days(first, last), source_url);
const DAY_1 = "2026-07-29T12:00:00.000Z";
const DAY_2 = "2026-07-30T12:00:00.000Z";
const DAY_3 = "2026-07-31T12:00:00.000Z";
const series = async (store, currency = "EUR") => (await store.getRevisedSeries(currency)).map((row) => [row.observation_date, row.value]);
const freshStore = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  return { path, store: new OfficialPolicyRateHistoryStore(path) };
};
const lines = async (path) => (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
const withdrawalsIn = async (path) => (await lines(path)).filter((record) => record.rate_status === "withdrawn").map((record) => [record.observation_date, record.raw_sha256]);

test("a change point a later download no longer lists is withdrawn, and comes back as a new version when it reappears", async () => {
  const { path, store } = await freshStore();
  // The source first shows 4 then 5 from 2025-02-01, then revises that month to 4.
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-01")]);
  const revised = await store.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)], [span(HASH_2, "2025-01-01", "2025-03-01")]);
  assert.deepEqual([revised.recorded.length, revised.unchanged, revised.revisions, revised.reappeared, revised.withdrawn], [1, 1, 0, 0, 1]);
  assert.deepEqual(await series(store), [["2025-01-01", 4]]);
  assert.deepEqual([(await store.getLatest("EUR")).observation_date, (await store.getLatest("EUR")).value], ["2025-01-01", 4]);
  // The withdrawal names the download that left the change out; the version it withdrew stays in the log.
  const [first, second, withdrawal] = await lines(path);
  assert.deepEqual([first.value, second.observation_date, second.value, second.raw_sha256], [4, "2025-02-01", 5, HASH_1]);
  assert.deepEqual([withdrawal.observation_date, withdrawal.value, withdrawal.rate_status, withdrawal.raw_sha256, withdrawal.source_url, withdrawal.retrieved_at],
    ["2025-02-01", null, "withdrawn", HASH_2, ECB_URL, DAY_2]);
  let coverage = (await store.coverage()).currencies.EUR;
  assert.deepEqual([coverage.records, coverage.dates, coverage.withdrawn_dates, coverage.withdrawals, coverage.revisions, coverage.reappearances, coverage.metadata_only_versions, coverage.latest_date],
    [3, 1, 1, 1, 0, 0, 0, "2025-01-01"]);
  // A second download that still leaves it out writes nothing more.
  const again = await store.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)], [span(HASH_2, "2025-01-01", "2025-03-01")]);
  assert.deepEqual([again.recorded.length, again.withdrawn], [0, 0]);
  // The source restores the change: a new version, counted as a reappearance rather than a revision.
  const back = await store.observeMany([ecb("2025-01-01", 4, HASH_3, DAY_3), ecb("2025-02-01", 5, HASH_3, DAY_3)], [span(HASH_3, "2025-01-01", "2025-03-01")]);
  assert.deepEqual([back.recorded.length, back.unchanged, back.revisions, back.reappeared, back.withdrawn], [1, 1, 0, 1, 0]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-02-01", 5]]);
  assert.equal((await store.getLatest("EUR")).raw_sha256, HASH_3);
  coverage = (await store.coverage()).currencies.EUR;
  assert.deepEqual([coverage.records, coverage.dates, coverage.withdrawn_dates, coverage.withdrawals, coverage.reappearances, coverage.revisions, coverage.latest_date],
    [4, 2, 0, 1, 1, 0, "2025-02-01"]);
});

test("a shorter download withdraws nothing outside its span, and a batch without a span withdraws nothing", async () => {
  const { store } = await freshStore();
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1), ecb("2025-03-03", 6, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-31")]);
  // The download now starts on 2025-02-01 and ends on 2025-02-28: the changes before and after it are not its to judge.
  const shorter = await store.observeMany([ecb("2025-02-01", 5, HASH_2, DAY_2)], [span(HASH_2, "2025-02-01", "2025-02-28")]);
  assert.deepEqual([shorter.recorded.length, shorter.withdrawn], [0, 0]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-02-01", 5], ["2025-03-03", 6]]);
  // Both ends of a download are judged: from 2025-02-01 to 2025-03-03 it now shows 4 throughout.
  const ends = await store.observeMany([ecb("2025-02-01", 4, HASH_3, DAY_3)], [span(HASH_3, "2025-02-01", "2025-03-03")]);
  assert.deepEqual([ends.withdrawn, await series(store)], [2, [["2025-01-01", 4]]]);
  // Without a span (the reviewed BoJ manifest), a date the batch leaves out keeps its change point.
  const { store: manifest } = await freshStore();
  await manifest.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)]);
  const partial = await manifest.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)]);
  assert.deepEqual([partial.withdrawn, await series(manifest)], [0, [["2025-01-01", 4], ["2025-02-01", 5]]]);
});

test("a withdrawal touches only the batch's currency, and a malformed span writes nothing", async () => {
  const { path, store } = await freshStore();
  // A USD change on a date EUR does not have, inside the EUR download's span.
  await store.observeMany([observation({ observation_date: "2025-02-15", value: 4.5 })]);
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-01")]);
  await store.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)], [span(HASH_2, "2025-01-01", "2025-03-01")]);
  assert.deepEqual(await series(store, "USD"), [["2025-02-15", 4.5]]);
  const before = await readFile(path, "utf8");
  const batch = [ecb("2025-01-01", 3, HASH_3, DAY_3)];
  const refusals = [
    [[span(HASH_3, "2025-01-01", "2025-01-31"), span(HASH_3, "2025-01-31", "2025-03-01")], /download spans overlap/],
    [[span(HASH_3, "2025-01-02", "2025-03-01")], /2025-01-01 is no observed date of its download/],
    [[span(HASH_2, "2025-01-01", "2025-03-01")], /2025-01-01 was not read from the file that observed it/],
    [[observedIn(HASH_3, ["2024-12-31", "2025-01-01"])], /first observed date of an official policy-rate download must be a change/],
    [[observedIn(HASH_3, [])], /invalid official policy-rate download span/],
    [[observedIn(HASH_3, days("1750-01-01", "2025-01-01"))], /invalid official policy-rate download span/],
    [[observedIn(HASH_3, ["2025-01-01", "2025-02-30"])], /invalid official policy-rate download span/],
    [[observedIn(HASH_3, ["2025-01-01", "2025-03-01", "2025-02-01"])], /invalid official policy-rate download span/],
    [[observedIn(HASH_3, ["2025-01-01", "2025-01-01"])], /invalid official policy-rate download span/],
    [[{ ...observedIn(HASH_3, ["2025-01-01"]), observed_dates: "2025-01-01" }], /invalid official policy-rate download span/],
    [[span(HASH_3, "2025-01-01", "2025-03-01", "http://data-api.ecb.europa.eu/service/data")], /invalid official policy-rate download span/],
    [[{ ...span(HASH_3, "2025-01-01", "2025-03-01"), raw_sha256: "sha256:abc" }], /invalid official policy-rate download span/],
    [[{ ...span(HASH_3, "2025-01-01", "2025-03-01"), source_vintage_at: "yesterday" }], /invalid official policy-rate download span/],
    [Array.from({ length: 9 }, (_, index) => span(HASH_3, `2025-0${index + 1}-01`, `2025-0${index + 1}-02`)), /at most 8 download spans/],
  ];
  for (const [spans, message] of refusals) await assert.rejects(store.observeMany(batch, spans), message);
  await assert.rejects(store.observeMany([...batch, observation({ retrieved_at: DAY_3, raw_sha256: HASH_3 })], [span(HASH_3, "2020-01-01", "2025-03-01")]), /one currency retrieved at one time/);
  await assert.rejects(store.observeMany([batch[0], ecb("2025-02-03", 3, HASH_3, "2026-08-01T12:00:00.000Z")], [span(HASH_3, "2025-01-01", "2025-03-01")]), /one currency retrieved at one time/);
  await assert.rejects(store.observeMany([{ ...batch[0], value: null, rate_status: "withdrawn" }]), /cannot be a withdrawal/);
  assert.equal(await readFile(path, "utf8"), before);
  // A stored withdrawal must carry no value.
  const { path: brokenPath } = await freshStore();
  await writeFile(brokenPath, `${JSON.stringify({ ...JSON.parse(before.trim().split("\n").at(-1)), sequence: 1, value: 5 })}\n`, { mode: 0o600 });
  await assert.rejects(new OfficialPolicyRateHistoryStore(brokenPath).getRevisedSeries("EUR"), /withdrawal must have null value/);
});

test("a download's first row is a new change point only when the series held before it says otherwise", async () => {
  const { path, store } = await freshStore();
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-31")]);
  const before = await readFile(path, "utf8");
  // The export now starts on 2025-01-10, where the series already holds 4: no new change point, so nothing to withdraw
  // once the full export is back.
  const later = await store.observeMany([ecb("2025-01-10", 4, HASH_2, DAY_2), ecb("2025-02-01", 5, HASH_2, DAY_2)], [span(HASH_2, "2025-01-10", "2025-03-31")]);
  assert.deepEqual([later.recorded.length, later.unchanged, later.withdrawn], [0, 2, 0]);
  assert.equal(await readFile(path, "utf8"), before);
  const full = await store.observeMany([ecb("2025-01-01", 4, HASH_3, DAY_3), ecb("2025-02-01", 5, HASH_3, DAY_3)], [span(HASH_3, "2025-01-01", "2025-03-31")]);
  assert.deepEqual([full.recorded.length, full.withdrawn, (await store.coverage()).currencies.EUR.withdrawals], [0, 0, 0]);
  // At a rate the series did not hold there, the first row is a change.
  const day4 = "2026-08-01T12:00:00.000Z";
  const changed = await store.observeMany([ecb("2025-01-10", 3.5, HASH_1, day4), ecb("2025-02-01", 5, HASH_1, day4)], [span(HASH_1, "2025-01-10", "2025-03-31")]);
  assert.deepEqual([changed.recorded.length, changed.revisions], [1, 0]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-01-10", 3.5], ["2025-02-01", 5]]);
});

test("what a span start is held against counts the batch's own changes and not the stored ones it withdraws", async () => {
  const { store } = await freshStore();
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-01-03", 6, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-01-05")]);
  // Two files: the first now changes to 5 on 2025-01-02 and drops the 6 on 2025-01-03; the second starts at 6.
  const result = await store.observeMany(
    [ecb("2025-01-01", 4, HASH_2, DAY_2), ecb("2025-01-02", 5, HASH_2, DAY_2), ecb("2025-01-10", 6, HASH_3, DAY_2)],
    [span(HASH_2, "2025-01-01", "2025-01-05"), span(HASH_3, "2025-01-10", "2025-03-31")],
  );
  // Against the stored 6 the second file's first row would look held and be lost; against the batch's 5 it is a change.
  assert.deepEqual([result.recorded.length, result.withdrawn], [3, 1]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-01-02", 5], ["2025-01-10", 6]]);
  // And when the batch's own last change matches, the second file's first row is held.
  const { store: other } = await freshStore();
  const held = await other.observeMany(
    [ecb("2025-01-01", 4, HASH_2, DAY_2), ecb("2025-01-02", 5, HASH_2, DAY_2), ecb("2025-01-10", 5, HASH_3, DAY_2)],
    [span(HASH_2, "2025-01-01", "2025-01-05"), span(HASH_3, "2025-01-10", "2025-03-31")],
  );
  assert.deepEqual([held.recorded.length, held.unchanged], [2, 1]);
  assert.deepEqual(await series(other), [["2025-01-01", 4], ["2025-01-02", 5]]);
});

test("withdrawals and reappearances repeat, and a change can come back at another rate", async () => {
  const { store } = await freshStore();
  const day4 = "2026-08-01T12:00:00.000Z";
  const day5 = "2026-08-02T12:00:00.000Z";
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-01")]);
  await store.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)], [span(HASH_2, "2025-01-01", "2025-03-01")]);
  // It comes back at another rate, is withdrawn again, and comes back once more.
  const back = await store.observeMany([ecb("2025-01-01", 4, HASH_3, DAY_3), ecb("2025-02-01", 4.5, HASH_3, DAY_3)], [span(HASH_3, "2025-01-01", "2025-03-01")]);
  assert.deepEqual([back.reappeared, back.revisions], [1, 0]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-02-01", 4.5]]);
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, day4)], [span(HASH_1, "2025-01-01", "2025-03-01")]);
  await store.observeMany([ecb("2025-01-01", 4, HASH_2, day5), ecb("2025-02-01", 4.5, HASH_2, day5)], [span(HASH_2, "2025-01-01", "2025-03-01")]);
  const coverage = (await store.coverage()).currencies.EUR;
  assert.deepEqual([coverage.records, coverage.withdrawals, coverage.reappearances, coverage.revisions, coverage.metadata_only_versions, coverage.withdrawn_dates, coverage.earliest_date, coverage.latest_date],
    [6, 2, 2, 0, 0, 0, "2025-01-01", "2025-02-01"]);
});

test("a row at the rate held before it is no change point, and a stored change on its date is withdrawn", async () => {
  // The export now starts on 2025-02-01, the day of the stored rise to 5, and shows 4 there: the rise is gone.
  const { path, store } = await freshStore();
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-31")]);
  const start = await store.observeMany([ecb("2025-02-01", 4, HASH_2, DAY_2)], [span(HASH_2, "2025-02-01", "2025-03-31")]);
  assert.deepEqual([start.recorded.length, start.unchanged, start.revisions, start.withdrawn], [1, 0, 0, 1]);
  assert.deepEqual(await series(store), [["2025-01-01", 4]]);
  assert.deepEqual(await withdrawalsIn(path), [["2025-02-01", HASH_2]]);
  // On a withdrawn date the same export start leaves it withdrawn, and nothing is written.
  const again = await store.observeMany([ecb("2025-02-01", 4, HASH_3, DAY_3)], [span(HASH_3, "2025-02-01", "2025-03-31")]);
  assert.deepEqual([again.recorded.length, again.unchanged, again.reappeared], [0, 1, 0]);
  // The rate is what counts, not the file it came from.
  const day4 = "2026-08-01T12:00:00.000Z";
  const moved = await store.observeMany([{ ...ecb("2025-02-10", 4, HASH_1, day4), source_url: "https://data-api.ecb.europa.eu/service/data/FM/other" }],
    [span(HASH_1, "2025-02-10", "2025-03-31", "https://data-api.ecb.europa.eu/service/data/FM/other")]);
  assert.deepEqual([moved.recorded.length, moved.unchanged], [0, 1]);
  // Within one batch, a row that repeats the batch's previous rate is no change point either.
  const { store: fresh } = await freshStore();
  const repeated = await fresh.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-01-10", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [span(HASH_1, "2025-01-01", "2025-03-31")]);
  assert.deepEqual([repeated.recorded.length, repeated.unchanged], [2, 1]);
  assert.deepEqual(await series(fresh), [["2025-01-01", 4], ["2025-02-01", 5]]);
});

test("a date a download leaves out is not judged, and a change across the gap is still found", async () => {
  // The re-download misses the February row: the stored rise to 5 on 2025-02-01 is kept, and 2025-03-01 at 5 is no change.
  const { store } = await freshStore();
  await store.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [observedIn(HASH_1, ["2025-01-01", "2025-02-01", "2025-03-01"])]);
  const gap = await store.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2), ecb("2025-03-01", 5, HASH_2, DAY_2)], [observedIn(HASH_2, ["2025-01-01", "2025-03-01"])]);
  assert.deepEqual([gap.recorded.length, gap.unchanged, gap.withdrawn], [0, 2, 0]);
  assert.deepEqual(await series(store), [["2025-01-01", 4], ["2025-02-01", 5]]);
  // The parser compacts across the gap, so a fall back to 4 on 2025-03-01 is no change it lists; against the kept 5 it is
  // one. It is read from the file that observed it, under the address of the row whose rate it carries.
  const { path, store: other } = await freshStore();
  await other.observeMany([ecb("2025-01-01", 4, HASH_1, DAY_1), ecb("2025-02-01", 5, HASH_1, DAY_1)], [observedIn(HASH_1, ["2025-01-01", "2025-02-01"])]);
  const hidden = await other.observeMany([ecb("2025-01-01", 4, HASH_2, DAY_2)], [observedIn(HASH_2, ["2025-01-01", "2025-03-01"], "https://data-api.ecb.europa.eu/service/data/FM/export")]);
  assert.deepEqual([hidden.recorded.length, hidden.unchanged, hidden.revisions, hidden.withdrawn], [1, 1, 0, 0]);
  assert.deepEqual(await series(other), [["2025-01-01", 4], ["2025-02-01", 5], ["2025-03-01", 4]]);
  const found = (await lines(path)).at(-1);
  assert.deepEqual([found.observation_date, found.value, found.source_url, found.raw_sha256, found.retrieved_at], ["2025-03-01", 4, ECB_URL, HASH_2, DAY_2]);
  // When that change is stored already, the batch writes nothing, and only its own listed row counts as unchanged.
  const again = await other.observeMany([ecb("2025-01-01", 4, HASH_3, DAY_3)], [observedIn(HASH_3, ["2025-01-01", "2025-03-01"])]);
  assert.deepEqual([again.recorded.length, again.unchanged], [0, 1]);
});

test("a change found on another file's first day is read from that file", async () => {
  const aud = (observation_date, value, raw_sha256, source_url) => observation({
    currency: "AUD", source_symbol: "ECONOMICS:AUINTR", observation_date, value, raw_sha256, source_url, retrieved_at: DAY_2,
  });
  const XLS = "https://www.rba.gov.au/statistics/tables/xls-hist/f01dhist.xls";
  const CSV = "https://www.rba.gov.au/statistics/tables/csv/f1-data.csv";
  const { path, store } = await freshStore();
  // A change stored, without a span, between the workbook's last day and the CSV's first.
  await store.observeMany([observation({ currency: "AUD", source_symbol: "ECONOMICS:AUINTR", observation_date: "2011-01-02", value: 5, source_url: CSV })]);
  // The join compacted the CSV's first day away (4.75, as the workbook ends), but against the stored 5 it is a change.
  const joined = await store.observeMany(
    [aud("1990-08-02", 14, HASH_1, XLS), aud("2010-11-03", 4.75, HASH_1, XLS), aud("2011-11-01", 4.5, HASH_2, CSV)],
    [observedIn(HASH_1, ["1990-08-02", "2010-11-03", "2010-12-31"], XLS), { ...observedIn(HASH_2, ["2011-01-04", "2011-11-01"], CSV), source_vintage_at: "2026-07-29T00:00:00.000Z" }],
  );
  assert.deepEqual([joined.recorded.length, joined.withdrawn], [4, 0]);
  assert.deepEqual(await series(store, "AUD"), [["1990-08-02", 14], ["2010-11-03", 4.75], ["2011-01-02", 5], ["2011-01-04", 4.75], ["2011-11-01", 4.5]]);
  const found = (await lines(path)).find((record) => record.observation_date === "2011-01-04");
  assert.deepEqual([found.value, found.source_url, found.raw_sha256, found.source_vintage_at], [4.75, CSV, HASH_2, "2026-07-29T00:00:00.000Z"]);
});
