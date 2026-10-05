import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectOfficialPolicyRateHistory, parseBoeBankRateCsv, parseEcbDepositFacilityCsv } from "../../build/officialPolicyRateSources.js";
import { OfficialPolicyRateHistoryStore } from "../../build/policyRateOfficialHistory.js";

const csv = [
  "KEY,TIME_PERIOD,OBS_VALUE,TITLE",
  "FM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-01,3,Deposit facility",
  "FM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-02,3,Deposit facility",
  "FM.D.U2.EUR.4F.KR.DFR.LEV,2025-02-05,2.75,Deposit facility",
].join("\n");

test("ECB source parser keeps only policy-rate change dates", () => {
  assert.deepEqual(parseEcbDepositFacilityCsv(csv), {
    changes: [{ observation_date: "2025-01-01", value: 3 }, { observation_date: "2025-02-05", value: 2.75 }],
    source_observation_count: 3, source_first_observation_date: "2025-01-01", source_last_observation_date: "2025-02-05",
    observed_dates: ["2025-01-01", "2025-01-02", "2025-02-05"],
  });
});

test("official source collection hashes raw content before persisting exploratory history", async () => {
  let persisted = null;
  const result = await collectOfficialPolicyRateHistory({
    sourceId: "ecb_deposit_facility",
    store: { observeRawSnapshot: async () => ({ recorded: true, sequence: 1 }), observeMany: async (rows) => { persisted = rows; return { recorded: rows, unchanged: 0, revisions: 0 }; } },
    archive: { store: async () => ({ stored: true, bytes: Buffer.byteLength(csv, "utf8") }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => csv, headers: { get: () => "Wed, 05 Feb 2025 12:00:00 GMT" } }),
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  assert.equal(result.source_id, "ecb_deposit_facility");
  assert.match(result.raw_sha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(persisted.length, 2);
  assert.equal(persisted[1].source_vintage_at, "2025-02-05T12:00:00.000Z");
  assert.equal(persisted[1].raw_sha256, result.raw_sha256);
  assert.deepEqual(result.raw_snapshot, { recorded: true, sequence: 1 });
  assert.deepEqual(result.raw_archive, { stored: true, bytes: Buffer.byteLength(csv, "utf8") });
  assert.deepEqual(result.source_coverage, { source_observation_count: 3, source_first_observation_date: "2025-01-01", source_last_observation_date: "2025-02-05" });
});

test("ECB source parser rejects a substituted series", () => {
  assert.throws(() => parseEcbDepositFacilityCsv(csv.replace("FM.D.U2.EUR.4F.KR.DFR.LEV", "FM.D.U2.EUR.4F.KR.MRO.LEV")), /unexpected series/);
});

test("BoC source parser verifies V39079 and retains only change dates", async () => {
  const { parseBocTargetOvernightRateJson } = await import("../../build/officialPolicyRateSources.js");
  const raw = JSON.stringify({ observations: [
    { d: "2025-01-01", V39079: { v: "3.25" } },
    { d: "2025-01-02", V39079: { v: "3.25" } },
    { d: "2025-01-30", V39079: { v: "3.00" } },
  ] });
  assert.deepEqual(parseBocTargetOvernightRateJson(raw), {
    changes: [{ observation_date: "2025-01-01", value: 3.25 }, { observation_date: "2025-01-30", value: 3 }],
    source_observation_count: 3, source_first_observation_date: "2025-01-01", source_last_observation_date: "2025-01-30",
    observed_dates: ["2025-01-01", "2025-01-02", "2025-01-30"],
  });
  assert.throws(() => parseBocTargetOvernightRateJson(raw.replaceAll("V39079", "V39078")), /invalid value/);
});

test("FRED Fed target range parser fixes the policy-rate definition to the midpoint", async () => {
  const { parseFredFedTargetRangeCsv } = await import("../../build/officialPolicyRateSources.js");
  const raw = ["observation_date,DFEDTARL,DFEDTARU", "2025-01-01,4.25,4.50", "2025-01-02,4.25,4.50", "2025-09-18,4.00,4.25"].join("\n");
  assert.deepEqual(parseFredFedTargetRangeCsv(raw), {
    changes: [{ observation_date: "2025-01-01", value: 4.375 }, { observation_date: "2025-09-18", value: 4.125 }],
    source_observation_count: 3, source_first_observation_date: "2025-01-01", source_last_observation_date: "2025-09-18",
    observed_dates: ["2025-01-01", "2025-01-02", "2025-09-18"],
  });
  assert.throws(() => parseFredFedTargetRangeCsv(raw.replace("4.00,4.25", "4.50,4.25")), /invalid observation/);
});

test("FRED Fed target history joins the former single target to the later range midpoint without overlap", async () => {
  const { parseFredFedTargetHistoryCsv } = await import("../../build/officialPolicyRateSources.js");
  const raw = [
    "observation_date,DFEDTAR,DFEDTARL,DFEDTARU",
    "2008-12-15,1.0000,,",
    "2008-12-16,,0.00,0.25",
    "2008-12-17,,0.00,0.25",
  ].join("\n");
  const result = parseFredFedTargetHistoryCsv(raw);
  assert.deepEqual(result.changes.map(({ observation_date, value }) => ({ observation_date, value })), [
    { observation_date: "2008-12-15", value: 1 },
    { observation_date: "2008-12-16", value: 0.125 },
  ]);
  assert.deepEqual(result.observed_dates, ["2008-12-15", "2008-12-16", "2008-12-17"]);
  assert.throws(() => parseFredFedTargetHistoryCsv(raw.replace("2008-12-16,,0.00,0.25", "2008-12-16,0.25,0.00,0.25")), /ambiguous observation/);
});

test("FRED collection retains the individual old and range source URLs", async () => {
  const raw = [
    "observation_date,DFEDTAR,DFEDTARL,DFEDTARU",
    "2008-12-15,1.0000,,",
    "2008-12-16,,0.00,0.25",
  ].join("\n");
  let persisted = null;
  await collectOfficialPolicyRateHistory({
    sourceId: "fred_fed_target_range_midpoint",
    store: { observeRawSnapshot: async () => ({ recorded: true, sequence: 1 }), observeMany: async (rows) => { persisted = rows; return { recorded: rows, unchanged: 0, revisions: 0 }; } },
    archive: { store: async () => ({ stored: true, bytes: Buffer.byteLength(raw, "utf8") }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => raw, headers: { get: () => null } }),
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  assert.match(persisted[0].source_url, /id=DFEDTAR$/);
  assert.match(persisted[1].source_url, /id=DFEDTARL,DFEDTARU$/);
});

test("RBA F1 parser uses the daily cash-rate target rather than the realised overnight rate", async () => {
  const { parseRbaCashRateTargetCsv } = await import("../../build/officialPolicyRateSources.js");
  const raw = [
    "F1 INTEREST RATES AND YIELDS - MONEY MARKET",
    "Title,Cash Rate Target,Interbank Overnight Cash Rate",
    "Description,Cash Rate Target on date,Interbank Overnight Cash Rate on date",
    "Frequency,Daily,Daily",
    "Series ID,FIRMMCRTD,FIRMMCRID",
    "04-Jan-2025,4.35,4.34",
    "05-Jan-2025,4.35,4.36",
    "18-Feb-2025,4.10,4.11",
    "19-Feb-2025,,4.09",
  ].join("\n");
  assert.deepEqual(parseRbaCashRateTargetCsv(raw), {
    changes: [{ observation_date: "2025-01-04", value: 4.35 }, { observation_date: "2025-02-18", value: 4.1 }],
    source_observation_count: 3, source_first_observation_date: "2025-01-04", source_last_observation_date: "2025-02-18",
    // The blank target of the live incomplete day is no observation.
    observed_dates: ["2025-01-04", "2025-01-05", "2025-02-18"],
  });
  assert.throws(() => parseRbaCashRateTargetCsv(raw.replace("FIRMMCRTD", "FIRMMCRID")), /unexpected series/);
});

test("RBA collection joins its reviewed historical F1 workbook to the current CSV", async () => {
  const historicalRaw = Buffer.alloc(4_096, 7);
  const currentRaw = [
    "F1 INTEREST RATES AND YIELDS - MONEY MARKET",
    "Title,Cash Rate Target,Interbank Overnight Cash Rate",
    "Description,Cash Rate Target on date,Interbank Overnight Cash Rate on date",
    "Frequency,Daily,Daily",
    "Series ID,FIRMMCRTD,FIRMMCRID",
    "04-Jan-2011,4.75,4.75",
    "05-Jan-2011,4.75,4.75",
    "01-Nov-2011,4.50,4.49",
  ].join("\n");
  const snapshots = [];
  let persisted = null;
  const result = await collectOfficialPolicyRateHistory({
    sourceId: "rba_cash_rate_target",
    store: { observeRawSnapshot: async (snapshot) => { snapshots.push(snapshot); return { recorded: true, sequence: snapshots.length }; }, observeMany: async (rows) => { persisted = rows; return { recorded: rows, unchanged: 0, revisions: 0 }; } },
    archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
    historicalRbaParser: () => ({ changes: [{ observation_date: "1990-08-02", value: 14 }, { observation_date: "2010-11-03", value: 4.75 }], source_observation_count: 5_171, source_first_observation_date: "1990-08-02", source_last_observation_date: "2010-12-31", observed_dates: ["1990-08-02", "2010-11-03", "2010-12-31"] }),
    fetch: async (url) => url.includes("f01dhist.xls")
      ? { ok: true, status: 200, text: async () => "", arrayBuffer: async () => historicalRaw.buffer.slice(historicalRaw.byteOffset, historicalRaw.byteOffset + historicalRaw.byteLength), headers: { get: () => null } }
      : { ok: true, status: 200, text: async () => currentRaw, headers: { get: () => null } },
    now: new Date("2026-07-29T12:00:00.000Z"),
  });
  assert.equal(result.source_coverage.source_observation_count, 5_174);
  assert.equal(snapshots.length, 2);
  assert.deepEqual(persisted.map((row) => [row.observation_date, row.value]), [["1990-08-02", 14], ["2010-11-03", 4.75], ["2011-11-01", 4.5]]);
  assert.match(persisted[1].source_url, /f01dhist\.xls$/);
  assert.match(persisted[2].source_url, /f1-data\.csv$/);
});

test("RBA historical F1 parser rejects a non-workbook response", async () => {
  const { parseRbaHistoricalF1Xls } = await import("../../build/rbaHistoricalF1Xls.js");
  assert.throws(() => parseRbaHistoricalF1Xls(Buffer.from("not an OLE workbook")), /not an OLE workbook/);
});

test("SNB parser uses its policy rate and the historical Libor target-range midpoint", async () => {
  const { parseSnbOfficialInterestRatesCsv } = await import("../../build/officialPolicyRateSources.js");
  const raw = [
    '"CubeId";"snboffzisa"',
    '"PublishingDate";"2026-07-21 09:00"',
    '',
    '"Date";"D0";"Value"',
    '"2019-05";"LZ";""',
    '"2019-05";"UG0";"-1.25"',
    '"2019-05";"OG0";"-0.25"',
    '"2019-06";"LZ";"-0.75"',
    '"2019-06";"UG0";""',
    '"2019-06";"OG0";""',
    '"2019-07";"LZ";"-0.75"',
    '"2019-07";"UG0";""',
    '"2019-07";"OG0";""',
  ].join("\n");
  assert.deepEqual(parseSnbOfficialInterestRatesCsv(raw), {
    changes: [{ observation_date: "2019-05-31", value: -0.75 }],
    source_observation_count: 3, source_first_observation_date: "2019-05-31", source_last_observation_date: "2019-07-31",
    observed_dates: ["2019-05-31", "2019-06-30", "2019-07-31"],
  });
  assert.throws(() => parseSnbOfficialInterestRatesCsv(raw.replace('"OG0";"-0.25"', '"OG0";""')), /incomplete Libor target range/);
});

test("BoE Bank Rate parser reduces the daily carry-forward export to its change dates", () => {
  // The export repeats the standing rate on every calendar day, including days no decision was
  // taken, so the raw row count is coverage and only the changes belong in an as-of join.
  const raw = [
    "DATE,IUDBEDR",
    "02 Jan 1975,11.5",
    "03 Jan 1975,11.5",
    "20 Jan 1975,11.25",
    "21 Jan 1975,11.25",
    "18 Dec 2025,3.75",
  ].join("\n");
  const parsed = parseBoeBankRateCsv(raw);
  assert.deepEqual(parsed.changes, [
    { observation_date: "1975-01-02", value: 11.5 },
    { observation_date: "1975-01-20", value: 11.25 },
    { observation_date: "2025-12-18", value: 3.75 },
  ]);
  // Coverage counts every supplied row, so a shortened export shows as less history rather than
  // as fewer decisions.
  assert.equal(parsed.source_observation_count, 5);
  assert.equal(parsed.source_first_observation_date, "1975-01-02");
  assert.equal(parsed.source_last_observation_date, "2025-12-18");
  assert.deepEqual(parsed.observed_dates, ["1975-01-02", "1975-01-03", "1975-01-20", "1975-01-21", "2025-12-18"]);
});

test("BoE Bank Rate parser refuses a substituted series, an unreadable date, and unordered rows", () => {
  const good = "DATE,IUDBEDR\n02 Jan 1975,11.5";
  assert.doesNotThrow(() => parseBoeBankRateCsv(good));
  // A different series code in the same shape would otherwise be read as Bank Rate.
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDSOIA\n02 Jan 1975,11.5"), /expected DATE and IUDBEDR/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR,EXTRA\n02 Jan 1975,11.5,1"), /expected DATE and IUDBEDR/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n1975-01-02,11.5"), /unreadable date/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n30 Feb 1975,11.5"), /the calendar does not have/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n02 Jan 1975,\n03 Jan 1975,11.5"), /non-finite rate/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n03 Jan 1975,11.5\n02 Jan 1975,11.25"), /not strictly ordered/);
});

// BACKLOG 102-10: Number() read a blank or whitespace rate as 0, the same as a real zero-rate decision, and "0x10" as 16.
// Each parser reads a rate cell strictly: blank is no value, a plain decimal is its number, anything else is refused.
test("ECB and BoC refuse a blank or whitespace rate, read a real 0, and refuse what is no decimal", async () => {
  const { parseBocTargetOvernightRateJson } = await import("../../build/officialPolicyRateSources.js");
  const ecb = (value) => parseEcbDepositFacilityCsv(["KEY,TIME_PERIOD,OBS_VALUE,TITLE",
    "FM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-01,3,Deposit facility", `FM.D.U2.EUR.4F.KR.DFR.LEV,2025-02-05,${value},Deposit facility`].join("\n"));
  const boc = (value) => parseBocTargetOvernightRateJson(JSON.stringify({ observations: [
    { d: "2025-01-01", V39079: { v: "3.25" } }, { d: "2025-01-30", V39079: { v: value } }] }));
  for (const parse of [ecb, boc]) {
    assert.throws(() => parse(""), /blank rate on 2025-0/);
    assert.throws(() => parse("   "), /blank rate on 2025-0/);
    assert.deepEqual(parse("0").changes.at(-1).value, 0, "a real zero-rate decision");
    assert.deepEqual(parse("-0.50").changes.at(-1).value, -0.5);
    for (const garbage of ["0x10", "1e1", "abc", "3.0.0", "Infinity"]) assert.throws(() => parse(garbage), /invalid|unexpected/, garbage);
  }
});

test("FRED, BoE and RBA refuse what is no decimal, and FRED refuses a blank bound", async () => {
  const { parseFredFedTargetRangeCsv, parseFredFedTargetHistoryCsv, parseRbaCashRateTargetCsv } = await import("../../build/officialPolicyRateSources.js");
  const range = (lower, upper) => parseFredFedTargetRangeCsv(["observation_date,DFEDTARL,DFEDTARU", "2025-01-01,4.25,4.50", `2025-09-18,${lower},${upper}`].join("\n"));
  assert.throws(() => range("", "0.25"), /invalid observation/, "a blank lower bound is no 0");
  assert.throws(() => range(" ", "0.25"), /invalid observation/);
  assert.equal(range("0", "0.25").changes.at(-1).value, 0.125);
  assert.throws(() => range("0x10", "0x20"), /invalid observation/);
  assert.throws(() => parseFredFedTargetHistoryCsv(["observation_date,DFEDTAR,DFEDTARL,DFEDTARU", "2008-12-15,1e0,,"].join("\n")), /invalid observation/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n02 Jan 1975,1e1"), /non-finite rate/);
  assert.throws(() => parseBoeBankRateCsv("DATE,IUDBEDR\n02 Jan 1975,0x10"), /non-finite rate/);
  assert.equal(parseBoeBankRateCsv("DATE,IUDBEDR\n02 Jan 1975,0").changes[0].value, 0);
  const rba = (value) => parseRbaCashRateTargetCsv(["Title,Cash Rate Target", "Series ID,FIRMMCRTD", "04-Jan-2025,4.35", `18-Feb-2025,${value}`].join("\n"));
  assert.throws(() => rba("0x10"), /invalid observation/);
  // The live file's incomplete day has no target and is still left out, whitespace or not.
  assert.equal(rba("  ").source_last_observation_date, "2025-01-04");
});

test("SNB reads a whitespace rate as missing, not 0, and refuses what is no decimal", async () => {
  const { parseSnbOfficialInterestRatesCsv } = await import("../../build/officialPolicyRateSources.js");
  const snb = (policy) => parseSnbOfficialInterestRatesCsv(['"CubeId";"snboffzisa"', '"Date";"D0";"Value"',
    `"2019-05";"LZ";"${policy}"`, '"2019-05";"UG0";"-1.25"', '"2019-05";"OG0";"-0.25"'].join("\n"));
  // With no policy rate the month falls back to the Libor target range's middle, as for a blank one.
  assert.equal(snb("  ").changes[0].value, -0.75);
  assert.equal(snb("").changes[0].value, -0.75);
  assert.equal(snb("0").changes[0].value, 0);
  assert.throws(() => snb("0x10"), /invalid observation/);
});

test("a decimal too long to be finite is no rate for any source", async () => {
  const { parseBocTargetOvernightRateJson, parseFredFedTargetRangeCsv, parseRbaCashRateTargetCsv, parseSnbOfficialInterestRatesCsv } =
    await import("../../build/officialPolicyRateSources.js");
  // 400 digits match a decimal but read as Infinity, which JSON writes as null.
  const huge = "9".repeat(400);
  assert.throws(() => parseEcbDepositFacilityCsv(["KEY,TIME_PERIOD,OBS_VALUE,TITLE", `FM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-01,${huge},x`].join("\n")), /invalid observation/);
  assert.throws(() => parseBocTargetOvernightRateJson(JSON.stringify({ observations: [{ d: "2025-01-01", V39079: { v: huge } }] })), /invalid value/);
  assert.throws(() => parseBoeBankRateCsv(`DATE,IUDBEDR\n02 Jan 1975,${huge}`), /non-finite rate/);
  assert.throws(() => parseFredFedTargetRangeCsv(`observation_date,DFEDTARL,DFEDTARU\n2025-01-01,0,${huge}`), /invalid observation/);
  assert.throws(() => parseRbaCashRateTargetCsv(["Title,Cash Rate Target", "Series ID,FIRMMCRTD", `04-Jan-2025,${huge}`].join("\n")), /invalid observation/);
  assert.throws(() => parseSnbOfficialInterestRatesCsv(['"CubeId";"snboffzisa"', '"Date";"D0";"Value"', `"2019-06";"LZ";"${huge}"`].join("\n")), /invalid observation/);
});

test("a row missing its value column is refused, apart from a blank value", async () => {
  const { parseFredFedTargetHistoryCsv, parseRbaCashRateTargetCsv, parseSnbOfficialInterestRatesCsv } = await import("../../build/officialPolicyRateSources.js");
  const missing = /missing its value column/;
  // RBA: a blank target is the live incomplete day and left out; no target column at all is refused, not left out.
  const rba = (row) => parseRbaCashRateTargetCsv(["Title,Cash Rate Target", "Series ID,FIRMMCRTD", "04-Jan-2025,4.35", row].join("\n"));
  assert.equal(rba("18-Feb-2025,").source_last_observation_date, "2025-01-04");
  assert.throws(() => rba("18-Feb-2025"), missing);
  // SNB: a blank policy rate is missing and falls back to the range; a row without the value column is refused.
  const snb = (row) => parseSnbOfficialInterestRatesCsv(['"CubeId";"snboffzisa"', '"Date";"D0";"Value"', row,
    '"2019-05";"UG0";"-1.25"', '"2019-05";"OG0";"-0.25"'].join("\n"));
  assert.equal(snb('"2019-05";"LZ";""').changes[0].value, -0.75);
  assert.throws(() => snb('"2019-05";"LZ"'), missing);
  // ECB and the FRED history: a short row is refused as malformed.
  assert.throws(() => parseEcbDepositFacilityCsv("KEY,TIME_PERIOD,OBS_VALUE,TITLE\nFM.D.U2.EUR.4F.KR.DFR.LEV,2025-01-01"), missing);
  assert.throws(() => parseFredFedTargetHistoryCsv("observation_date,DFEDTAR,DFEDTARL,DFEDTARU\n2008-12-15,1.00"), missing);
  assert.equal(parseFredFedTargetHistoryCsv("observation_date,DFEDTAR,DFEDTARL,DFEDTARU\n2008-12-15,1.00,,").changes[0].value, 1,
    "a single target with blank range columns is still read");
});

// BACKLOG 102-09: each collector hands the store the span of every file it read, so a revision that removes a change
// point withdraws it rather than leaving the old one in the revised series.
const historyStore = async () => {
  const path = join(await mkdtemp(join(tmpdir(), "tv-mcp-official-policy-rate-")), "history.jsonl");
  return { path, store: new OfficialPolicyRateHistoryStore(path) };
};
const revisedOf = async (store, currency) => (await store.getRevisedSeries(currency)).map((row) => [row.observation_date, row.value]);
/** The withdrawal records in the log, as [date, source_url, raw_sha256]. */
const withdrawalsIn = async (path) => (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line))
  .filter((record) => record.rate_status === "withdrawn").map((record) => [record.observation_date, record.source_url, record.raw_sha256]);

test("an ECB revision that removes a change withdraws it, and every download's raw and snapshot are kept", async () => {
  const { path, store } = await historyStore();
  const archived = [];
  const ecbCsv = (rows) => ["KEY,TIME_PERIOD,OBS_VALUE,TITLE", ...rows.map(([date, value]) => `FM.D.U2.EUR.4F.KR.DFR.LEV,${date},${value},Deposit facility`)].join("\n");
  const run = (raw, now, lastModified) => collectOfficialPolicyRateHistory({
    sourceId: "ecb_deposit_facility", store,
    archive: { store: async (hash, body) => { archived.push({ hash, body }); return { stored: true, bytes: Buffer.byteLength(body) }; } },
    fetch: async () => ({ ok: true, status: 200, text: async () => raw, headers: { get: (name) => name === "last-modified" ? lastModified : null } }),
    now: new Date(now),
  });
  const firstRaw = ecbCsv([["2025-01-01", 4], ["2025-02-01", 5], ["2025-03-01", 5]]);
  const secondRaw = ecbCsv([["2025-01-01", 4], ["2025-02-01", 4], ["2025-03-01", 4]]);
  const first = await run(firstRaw, "2026-07-29T12:00:00.000Z", "Mon, 27 Jul 2026 15:00:00 GMT");
  const second = await run(secondRaw, "2026-07-30T12:00:00.000Z", "Wed, 29 Jul 2026 15:00:00 GMT");
  assert.deepEqual(second.first_seen, { recorded: 1, unchanged: 1, revisions: 0, reappeared: 0, withdrawn: 1, derived: 0 });
  assert.deepEqual(await revisedOf(store, "EUR"), [["2025-01-01", 4]]);
  assert.deepEqual(await withdrawalsIn(path), [["2025-02-01", second.source_url, second.raw_sha256]]);
  // The withdrawal carries the second download's vintage; the version it withdrew keeps the first's.
  const logged = (await readFile(path, "utf8")).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(logged.map((record) => [record.observation_date, record.rate_status ?? "numeric", record.source_vintage_at]), [
    ["2025-01-01", "numeric", "2026-07-27T15:00:00.000Z"],
    ["2025-02-01", "numeric", "2026-07-27T15:00:00.000Z"],
    ["2025-02-01", "withdrawn", "2026-07-29T15:00:00.000Z"],
  ]);
  assert.equal((await store.getLatest("EUR")).value, 4);
  const coverage = await store.coverage();
  assert.deepEqual([coverage.currencies.EUR.withdrawals, coverage.raw_snapshots, coverage.source_coverage.ecb_deposit_facility.latest_raw_sha256], [1, 2, second.raw_sha256]);
  assert.deepEqual(archived.map(({ hash, body }) => [hash, body]), [[first.raw_sha256, firstRaw], [second.raw_sha256, secondRaw]]);
  // A shorter export that starts later is no word on the earlier change, which stays, and its first row, at the rate
  // the series already holds, is no new change point.
  const third = await run(ecbCsv([["2025-03-01", 4]]), "2026-07-31T12:00:00.000Z", null);
  assert.deepEqual(third.first_seen, { recorded: 0, unchanged: 1, revisions: 0, reappeared: 0, withdrawn: 0, derived: 0 });
  assert.deepEqual(await revisedOf(store, "EUR"), [["2025-01-01", 4]]);
});

test("a FRED revision withdraws on the word of the joined download", async () => {
  const { path, store } = await historyStore();
  const run = (rows, now) => collectOfficialPolicyRateHistory({
    sourceId: "fred_fed_target_range_midpoint", store,
    archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => ["observation_date,DFEDTAR,DFEDTARL,DFEDTARU", ...rows].join("\n"), headers: { get: () => null } }),
    now: new Date(now),
  });
  await run(["2008-12-15,1.0000,,", "2008-12-16,,0.00,0.25", "2015-12-17,,0.25,0.50"], "2026-07-29T12:00:00.000Z");
  const second = await run(["2008-12-15,1.0000,,", "2008-12-16,,0.00,0.25", "2015-12-17,,0.00,0.25"], "2026-07-30T12:00:00.000Z");
  assert.equal(second.first_seen.withdrawn, 1);
  assert.deepEqual(await revisedOf(store, "USD"), [["2008-12-15", 1], ["2008-12-16", 0.125]]);
  assert.deepEqual(await withdrawalsIn(path), [["2015-12-17", second.source_url, second.raw_sha256]]);
  assert.match(second.source_url, /id=DFEDTAR,DFEDTARL,DFEDTARU$/);
});

test("an RBA revision withdraws a change from the workbook or the CSV on that file's word", async () => {
  const { path, store } = await historyStore();
  const current = (rows) => [
    "F1 INTEREST RATES AND YIELDS - MONEY MARKET",
    "Title,Cash Rate Target,Interbank Overnight Cash Rate",
    "Description,Cash Rate Target on date,Interbank Overnight Cash Rate on date",
    "Frequency,Daily,Daily",
    "Series ID,FIRMMCRTD,FIRMMCRID",
    ...rows,
  ].join("\n");
  const run = (fill, historicalChanges, currentRaw, now) => {
    const historicalRaw = Buffer.alloc(4_096, fill);
    return collectOfficialPolicyRateHistory({
      sourceId: "rba_cash_rate_target", store,
      archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
      historicalRbaParser: () => ({ changes: historicalChanges, source_observation_count: 5_171, source_first_observation_date: "1990-08-02", source_last_observation_date: "2010-12-31", observed_dates: ["1990-08-02", "2010-11-03", "2010-12-31"] }),
      fetch: async (url) => url.includes("f01dhist.xls")
        ? { ok: true, status: 200, text: async () => "", arrayBuffer: async () => historicalRaw.buffer.slice(historicalRaw.byteOffset, historicalRaw.byteOffset + historicalRaw.byteLength), headers: { get: () => null } }
        : { ok: true, status: 200, text: async () => currentRaw, headers: { get: () => null } },
      now: new Date(now),
    });
  };
  await run(7, [{ observation_date: "1990-08-02", value: 14 }, { observation_date: "2010-11-03", value: 4.75 }],
    current(["04-Jan-2011,4.75,4.75", "01-Nov-2011,4.50,4.49"]), "2026-07-29T12:00:00.000Z");
  // The workbook no longer has the 2010 change, so 2011-01-04 is now one; the CSV no longer has the November cut.
  const currentSecond = current(["04-Jan-2011,4.75,4.75", "01-Nov-2011,4.75,4.74"]);
  const second = await run(8, [{ observation_date: "1990-08-02", value: 14 }], currentSecond, "2026-07-30T12:00:00.000Z");
  assert.deepEqual([second.first_seen.recorded, second.first_seen.withdrawn], [3, 2]);
  assert.deepEqual(await revisedOf(store, "AUD"), [["1990-08-02", 14], ["2011-01-04", 4.75]]);
  // The withdrawn dates hold no record of the first run anymore; later the workbook's 2010 change comes back, so the
  // CSV's first day is no change again and is withdrawn under the CSV, which still lists it unchanged.
  const third = await run(9, [{ observation_date: "1990-08-02", value: 14 }, { observation_date: "2010-11-03", value: 4.75 }],
    currentSecond, "2026-07-31T12:00:00.000Z");
  assert.deepEqual([third.first_seen.reappeared, third.first_seen.withdrawn], [1, 1]);
  assert.deepEqual(await revisedOf(store, "AUD"), [["1990-08-02", 14], ["2010-11-03", 4.75]]);
  const sha256 = (body) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
  assert.deepEqual(await withdrawalsIn(path), [
    ["2010-11-03", "https://www.rba.gov.au/statistics/tables/xls-hist/f01dhist.xls", sha256(Buffer.alloc(4_096, 8))],
    ["2011-11-01", "https://www.rba.gov.au/statistics/tables/csv/f1-data.csv", sha256(currentSecond)],
    ["2011-01-04", "https://www.rba.gov.au/statistics/tables/csv/f1-data.csv", sha256(currentSecond)],
  ]);
});

test("BoC, BoE and SNB revisions withdraw on the span of their own export", async () => {
  const boc = (rows) => JSON.stringify({ observations: rows.map(([d, v]) => ({ d, V39079: { v } })) });
  const boe = (rows) => ["DATE,IUDBEDR", ...rows.map(([date, value]) => `${date},${value}`)].join("\n");
  const snb = (rows) => ['"CubeId";"snboffzisa"', '"PublishingDate";"2026-07-21 09:00"', "", '"Date";"D0";"Value"',
    ...rows.map(([month, value]) => `"${month}";"LZ";"${value}"`)].join("\n");
  const cases = [
    ["boc_target_overnight_rate", "CAD", boc([["2025-01-01", "3.25"], ["2025-01-30", "3.00"], ["2025-02-03", "3.00"]]),
      boc([["2025-01-01", "3.25"], ["2025-01-30", "3.25"], ["2025-02-03", "3.25"]]), [["2025-01-01", 3.25]], "2025-01-30"],
    ["boe_bank_rate", "GBP", boe([["01 Jan 2025", "4.75"], ["06 Feb 2025", "4.50"], ["07 Feb 2025", "4.50"]]),
      boe([["01 Jan 2025", "4.75"], ["06 Feb 2025", "4.75"], ["07 Feb 2025", "4.75"]]), [["2025-01-01", 4.75]], "2025-02-06"],
    // SNB dates are month ends; the last month of the span is a change in the first export only.
    ["snb_policy_rate_or_libor_target_midpoint", "CHF", snb([["2025-04", "0.25"], ["2025-05", "0.25"], ["2025-06", "0"]]),
      snb([["2025-04", "0.25"], ["2025-05", "0.25"], ["2025-06", "0.25"]]), [["2025-04-30", 0.25]], "2025-06-30"],
  ];
  for (const [sourceId, currency, firstRaw, secondRaw, revised, withdrawnDate] of cases) {
    const { path, store } = await historyStore();
    const run = (raw, now) => collectOfficialPolicyRateHistory({
      sourceId, store, archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
      fetch: async () => ({ ok: true, status: 200, text: async () => raw, headers: { get: () => null } }), now: new Date(now),
    });
    await run(firstRaw, "2026-07-29T12:00:00.000Z");
    const second = await run(secondRaw, "2026-07-30T12:00:00.000Z");
    assert.equal(second.first_seen.withdrawn, 1, sourceId);
    assert.deepEqual(await revisedOf(store, currency), revised, sourceId);
    assert.deepEqual(await withdrawalsIn(path), [[withdrawnDate, second.source_url, second.raw_sha256]], sourceId);
  }
});

test("a row missing from an ECB re-download or blank in the RBA CSV withdraws nothing (102-09)", async () => {
  const ecbCsv = (rows) => ["KEY,TIME_PERIOD,OBS_VALUE,TITLE", ...rows.map(([date, value]) => `FM.D.U2.EUR.4F.KR.DFR.LEV,${date},${value},Deposit facility`)].join("\n");
  const { store } = await historyStore();
  const ecbRun = (raw, now) => collectOfficialPolicyRateHistory({
    sourceId: "ecb_deposit_facility", store, archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => raw, headers: { get: () => null } }), now: new Date(now),
  });
  await ecbRun(ecbCsv([["2025-01-01", 4], ["2025-02-01", 5], ["2025-03-01", 5]]), "2026-07-29T12:00:00.000Z");
  const missing = await ecbRun(ecbCsv([["2025-01-01", 4], ["2025-03-01", 5]]), "2026-07-30T12:00:00.000Z");
  assert.deepEqual(missing.first_seen, { recorded: 0, unchanged: 2, revisions: 0, reappeared: 0, withdrawn: 0, derived: 0 });
  assert.deepEqual(await revisedOf(store, "EUR"), [["2025-01-01", 4], ["2025-02-01", 5]]);

  const current = (rows) => ["F1 INTEREST RATES AND YIELDS - MONEY MARKET", "Title,Cash Rate Target,Interbank Overnight Cash Rate",
    "Description,Cash Rate Target on date,Interbank Overnight Cash Rate on date", "Frequency,Daily,Daily", "Series ID,FIRMMCRTD,FIRMMCRID", ...rows].join("\n");
  const { store: rba } = await historyStore();
  const historicalRaw = Buffer.alloc(4_096, 7);
  const rbaRun = (raw, now) => collectOfficialPolicyRateHistory({
    sourceId: "rba_cash_rate_target", store: rba, archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
    historicalRbaParser: () => ({ changes: [{ observation_date: "1990-08-02", value: 14 }], source_observation_count: 2, source_first_observation_date: "1990-08-02", source_last_observation_date: "2010-12-31", observed_dates: ["1990-08-02", "2010-12-31"] }),
    fetch: async (url) => url.includes("f01dhist.xls")
      ? { ok: true, status: 200, arrayBuffer: async () => historicalRaw.buffer.slice(historicalRaw.byteOffset, historicalRaw.byteOffset + historicalRaw.byteLength), headers: { get: () => null } }
      : { ok: true, status: 200, text: async () => raw, headers: { get: () => null } },
    now: new Date(now),
  });
  await rbaRun(current(["04-Jan-2011,4.75,4.75", "01-Nov-2011,4.50,4.49", "02-Nov-2011,4.50,4.49"]), "2026-07-29T12:00:00.000Z");
  const blank = await rbaRun(current(["04-Jan-2011,4.75,4.75", "01-Nov-2011,,4.49", "02-Nov-2011,4.50,4.49"]), "2026-07-30T12:00:00.000Z");
  assert.deepEqual([blank.first_seen.recorded, blank.first_seen.withdrawn], [0, 0]);
  assert.deepEqual(await revisedOf(rba, "AUD"), [["1990-08-02", 14], ["2011-01-04", 4.75], ["2011-11-01", 4.5]]);
});

test("an SNB month-end after the retrieval day is no observation yet (102-09)", async () => {
  // The September row is missing from the second export and October repeats 0.25; October's month end is after the
  // retrieval day, so it is no observation, and nothing is derived there.
  const snb = (rows) => ['"CubeId";"snboffzisa"', '"PublishingDate";"2026-10-01 09:00"', "", '"Date";"D0";"Value"',
    ...rows.map(([month, value]) => `"${month}";"LZ";"${value}"`)].join("\n");
  const { store } = await historyStore();
  const run = (raw, now) => collectOfficialPolicyRateHistory({
    sourceId: "snb_policy_rate_or_libor_target_midpoint", store, archive: { store: async (_hash, body) => ({ stored: true, bytes: Buffer.byteLength(body) }) },
    fetch: async () => ({ ok: true, status: 200, text: async () => raw, headers: { get: () => null } }), now: new Date(now),
  });
  await run(snb([["2026-08", "0.25"], ["2026-09", "0"]]), "2026-10-01T12:00:00.000Z");
  const second = await run(snb([["2026-08", "0.25"], ["2026-10", "0.25"]]), "2026-10-05T12:00:00.000Z");
  assert.deepEqual(second.first_seen, { recorded: 0, unchanged: 1, revisions: 0, reappeared: 0, withdrawn: 0, derived: 0 });
  assert.deepEqual(await revisedOf(store, "CHF"), [["2026-08-31", 0.25], ["2026-09-30", 0]]);
});
