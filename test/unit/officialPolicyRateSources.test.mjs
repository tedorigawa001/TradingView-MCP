import test from "node:test";
import assert from "node:assert/strict";
import { collectOfficialPolicyRateHistory, parseEcbDepositFacilityCsv } from "../../build/officialPolicyRateSources.js";

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
  });
  assert.throws(() => parseBocTargetOvernightRateJson(raw.replaceAll("V39079", "V39078")), /invalid value/);
});

test("FRED Fed target range parser fixes the policy-rate definition to the midpoint", async () => {
  const { parseFredFedTargetRangeCsv } = await import("../../build/officialPolicyRateSources.js");
  const raw = ["observation_date,DFEDTARL,DFEDTARU", "2025-01-01,4.25,4.50", "2025-01-02,4.25,4.50", "2025-09-18,4.00,4.25"].join("\n");
  assert.deepEqual(parseFredFedTargetRangeCsv(raw), {
    changes: [{ observation_date: "2025-01-01", value: 4.375 }, { observation_date: "2025-09-18", value: 4.125 }],
    source_observation_count: 3, source_first_observation_date: "2025-01-01", source_last_observation_date: "2025-09-18",
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
    historicalRbaParser: () => ({ changes: [{ observation_date: "1990-08-02", value: 14 }, { observation_date: "2010-11-03", value: 4.75 }], source_observation_count: 5_171, source_first_observation_date: "1990-08-02", source_last_observation_date: "2010-12-31" }),
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
  });
  assert.throws(() => parseSnbOfficialInterestRatesCsv(raw.replace('"OG0";"-0.25"', '"OG0";""')), /incomplete Libor target range/);
});
