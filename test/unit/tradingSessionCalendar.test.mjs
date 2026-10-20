import test from "node:test";
import assert from "node:assert/strict";
import { classifyTradingSessionIntervals } from "../../build/tradingSessionCalendar.js";

const symbol = "PEPPERSTONE:MXNJPY";
const metadata = (extra = {}) => ({ source: "tradingview_symbol_info", chartIndex: 0, symbol, fullName: symbol, resolution: "60",
  timezone: "Etc/UTC", session: "0900-1600", sessionHolidays: null, corrections: null, subsessionId: null, subsessions: [], ...extra });
const bars = (...dates) => dates.map((date) => ({ time: Date.parse(date) / 1000, timeIso: new Date(date).toISOString(),
  open: 100, high: 101, low: 99, close: 100, volume: null }));
const classify = (data, meta = metadata(), tf = "60") => classifyTradingSessionIntervals(meta, symbol, tf, data,
  (tf === "1D" ? 86400 : tf === "1W" ? 604800 : Number(tf) * 60) * 1.5);

test("a supplied holiday closes expected sessions; the same weekday gap without evidence stays missing", () => {
  const data = bars("2026-12-24T15:00:00Z", "2026-12-28T09:00:00Z");
  const yes = classify(data, metadata({ sessionHolidays: "20261225" }));
  assert.deepEqual(yes.unsafeBefore, [false, false]);
  assert.deepEqual(yes.resetBefore, [false, true], "declared closure still breaks a touch episode");
  assert.equal(yes.evidence.counts.scheduled_closures, 1);
  assert.deepEqual(yes.evidence.intervals[0].closure_reasons, ["session_holiday"]);
  const no = classify(data);
  assert.deepEqual(no.unsafeBefore, [false, true]);
  assert.equal(no.evidence.intervals[0].classification, "missing_expected_trading_bars");
  assert.equal(no.evidence.intervals[0].expected_missing_bars, 7);
  assert.equal(no.evidence.holiday_metadata_provided, false);
});

test("missing bars during trading hours are not explained by a nearby weekend or holiday", () => {
  const midweek = classify(bars("2026-10-06T10:00:00Z", "2026-10-06T12:00:00Z"));
  assert.equal(midweek.evidence.intervals[0].expected_missing_bars, 1);
  assert.deepEqual(midweek.evidence.intervals[0].missing_bar_examples, ["2026-10-06T11:00:00.000Z"]);
  const fx = metadata({ resolution: "240", timezone: "America/New_York", session: "1700-1659:2345|1700-1655:6" });
  const weekend = classify(bars("2026-10-09T17:00:00Z", "2026-10-11T21:00:00Z"), fx, "240");
  assert.equal(weekend.evidence.counts.scheduled_closures, 1);
  const late = classify(bars("2026-10-09T17:00:00Z", "2026-10-12T01:00:00Z"), fx, "240");
  assert.deepEqual(late.unsafeBefore, [false, true]);
  assert.equal(late.evidence.intervals[0].expected_missing_bars, 1);
  assert.deepEqual(late.evidence.intervals[0].missing_bar_examples, ["2026-10-11T21:00:00.000Z"]);
});

test("NY weekend closures follow the provider clock across both DST changes", () => {
  const fx = metadata({ resolution: "240", timezone: "America/New_York", session: "1700-1659:2345|1700-1655:6" });
  for (const data of [bars("2026-03-06T18:00:00Z", "2026-03-08T21:00:00Z"), bars("2026-10-30T17:00:00Z", "2026-11-01T22:00:00Z")]) {
    const result = classify(data, fx, "240");
    assert.deepEqual(result.unsafeBefore, [false, false]);
    assert.equal(result.evidence.counts.scheduled_closures, 1);
    assert.equal(result.evidence.timezone, "America/New_York");
  }
});

test("early closes and holiday reopening corrections override the regular schedule and the holiday list", () => {
  const data = bars("2026-12-24T11:00:00Z", "2026-12-28T09:00:00Z");
  const shortened = classify(data, metadata({ sessionHolidays: "20261225", corrections: "0900-1200:20261224" }));
  assert.equal(shortened.evidence.counts.scheduled_closures, 1);
  assert.deepEqual(shortened.evidence.intervals[0].closure_reasons.sort(), ["session_correction", "session_holiday"]);
  assert.equal(classify(data, metadata({ sessionHolidays: "20261225" })).evidence.intervals[0].expected_missing_bars, 4);
  const reopened = metadata({ sessionHolidays: "20261225", corrections: "1000-1200:20261225" });
  assert.equal(classify(bars("2026-12-24T15:00:00Z", "2026-12-25T10:00:00Z"), reopened).evidence.counts.scheduled_closures, 1);
  assert.equal(classify(bars("2026-12-25T10:00:00Z", "2026-12-28T09:00:00Z"), reopened).evidence.intervals[0].expected_missing_bars, 1);
});

test("overnight holiday dates name trading dates, not the civil date of the opening timestamp", () => {
  const fx = metadata({ resolution: "240", timezone: "America/New_York", session: "1700-1700", sessionHolidays: "20261225" });
  const result = classify(bars("2026-12-24T18:00:00Z", "2026-12-27T22:00:00Z"), fx, "240");
  assert.equal(result.evidence.counts.scheduled_closures, 1);
  assert.deepEqual(result.evidence.intervals[0].closure_reasons, ["session_holiday"]);
  const missing = classify(bars("2026-12-24T14:00:00Z", "2026-12-27T22:00:00Z"), fx, "240");
  assert.equal(missing.evidence.intervals[0].expected_missing_bars, 1, "Thursday 13:00 NY is not part of Friday's holiday");
});

test("split sessions, weekday overrides and 24x7 have different closure semantics", () => {
  const lunch = classify(bars("2026-10-06T11:00:00Z", "2026-10-06T13:00:00Z"), metadata({ session: "0900-1200,1300-1600" }));
  assert.equal(lunch.evidence.counts.scheduled_closures, 1);
  const friday = classify(bars("2026-10-09T11:00:00Z", "2026-10-12T09:00:00Z"), metadata({ session: "0900-1600|0900-1200:6" }));
  assert.equal(friday.evidence.counts.scheduled_closures, 1);
  const crypto = classify(bars("2026-10-09T23:00:00Z", "2026-10-10T01:00:00Z"), metadata({ session: "24x7" }));
  assert.equal(crypto.evidence.intervals[0].expected_missing_bars, 1, "Saturday is not automatically a holiday");
});

test("daily native session opens and UTC trading-date stamps both need an exact calendar match", () => {
  const fx = metadata({ resolution: "1D", timezone: "America/New_York", session: "1700-1700" });
  const native = classify(bars("2026-03-05T22:00:00Z", "2026-03-08T21:00:00Z"), fx, "1D");
  assert.equal(native.evidence.timestamp_basis, "native_session_open");
  assert.equal(native.evidence.counts.scheduled_closures, 1);
  const utc = classify(bars("2026-03-06T00:00:00Z", "2026-03-09T00:00:00Z"), fx, "1D");
  assert.equal(utc.evidence.timestamp_basis, "utc_trading_date"); assert.equal(utc.evidence.counts.scheduled_closures, 1);
  const omitted = classify(bars("2026-03-05T00:00:00Z", "2026-03-09T00:00:00Z"), fx, "1D");
  assert.equal(omitted.evidence.intervals[0].expected_missing_bars, 1);
  const unknown = classify(bars("2026-03-06T12:00:00Z", "2026-03-09T12:00:00Z"), fx, "1D");
  assert.equal(unknown.evidence.status, "unavailable"); assert.equal(unknown.unsafeBefore[1], true);
});

test("weekly calendars distinguish a wholly declared holiday week from an omitted active week", () => {
  const data = bars("2026-12-21T00:00:00Z", "2027-01-04T00:00:00Z");
  const week = metadata({ resolution: "1W", session: "0900-1600", sessionHolidays: "20261228,20261229,20261230,20261231,20270101" });
  assert.equal(classify(data, week, "1W").evidence.counts.scheduled_closures, 1);
  const missing = classify(data, { ...week, sessionHolidays: null }, "1W");
  assert.equal(missing.evidence.intervals[0].expected_missing_bars, 1);
});

test("a different listing or timeframe cannot supply closure evidence", () => {
  const data = bars("2026-10-09T15:00:00Z", "2026-10-12T09:00:00Z");
  for (const patch of [{ symbol: "OTHER:MXNJPY" }, { fullName: "OTHER:MXNJPY" }, { resolution: "240" }, { source: "assumed_fx_calendar" }]) {
    assert.throws(() => classify(data, metadata(patch)), /does not match/);
  }
});

test("absent, malformed, ambiguous and unsupported metadata never turns a gap into a closure", () => {
  const data = bars("2026-10-09T15:00:00Z", "2026-10-12T09:00:00Z");
  for (const meta of [null, metadata({ session: "0900-1600#20240101/1000-1700" }), metadata({ timezone: "Invalid/Zone" }),
    metadata({ session: "0900-1600|1000-1200" }), metadata({ sessionHolidays: "20260230" }),
    metadata({ corrections: "0900-1200:20261225;1000-1300:20261225" }),
    metadata({ session: "0900-1600:22" }), metadata({ session: "0900-1600", subsessionId: "extended", subsessions: [{ id: "extended", session: "0400-2000" }] }),
    metadata({ session: "0900-1600,1200-1700" })]) {
    const result = classify(data, meta);
    assert.equal(result.evidence.status, "unavailable"); assert.equal(result.evidence.counts.scheduled_closures, 0);
    assert.equal(result.unsafeBefore[1], true);
  }
  const fold = classify(bars("2026-10-31T00:00:00Z", "2026-11-02T00:00:00Z"), metadata({ timezone: "America/New_York", session: "0130-0230:1" }));
  assert.equal(fold.evidence.reason, "ambiguous_or_nonexistent_session_boundary");
});

test("calendar evidence and diagnostics are bounded and reproducible", () => {
  const long = classify(bars("2000-01-03T09:00:00Z", "2026-10-06T09:00:00Z"));
  assert.equal(long.evidence.reason, "session_schedule_budget_exceeded");
  const data = bars("2026-10-09T15:00:00Z", "2026-10-12T09:00:00Z");
  const a = classify(data), b = classify(data);
  assert.equal(a.evidence.metadata_sha256, b.evidence.metadata_sha256);
  assert.match(a.evidence.metadata_sha256, /^[0-9a-f]{64}$/);
});

test("a holiday or correction overrides an unused ambiguous default DST boundary", () => {
  const base = metadata({ timezone: "America/New_York", session: "0130-0330:1" });
  const holiday = classify(bars("2026-10-25T06:30:00Z", "2026-11-08T06:30:00Z"), { ...base, sessionHolidays: "20261101" });
  assert.equal(holiday.evidence.status, "available");
  assert.equal(holiday.evidence.counts.scheduled_closures, 1);
  assert.equal(holiday.evidence.counts.missing_expected_bar_intervals, 0);
  assert.deepEqual(holiday.evidence.unresolved_default_exception_dates, ["2026-11-01"]);
  const corrected = classify(bars("2026-10-25T06:30:00Z", "2026-11-01T08:00:00Z"), { ...base, corrections: "0300-0400:20261101" });
  assert.equal(corrected.evidence.status, "available");
  assert.equal(corrected.evidence.counts.scheduled_closures, 1);
  assert.deepEqual(corrected.evidence.unresolved_default_exception_dates, ["2026-11-01"]);
  const effectiveFold = classify(bars("2026-10-25T06:30:00Z", "2026-11-01T08:00:00Z"), { ...base, corrections: "0130-0330:20261101" });
  assert.equal(effectiveFold.evidence.status, "unavailable", "an ambiguous effective override must still fail");
  assert.equal(effectiveFold.evidence.reason, "ambiguous_or_nonexistent_session_boundary");
});

test("window expansion has its own budget even when weekly aggregation collapses the opens", () => {
  const clock = (minute) => `${String(Math.floor(minute / 60)).padStart(2, "0")}${String(minute % 60).padStart(2, "0")}`;
  const session = Array.from({ length: 300 }, (_, i) => `${clock(i * 2)}-${clock(i * 2 + 1)}`).join(",");
  const from = Date.parse("2026-01-05T00:00:00Z");
  const data = bars(...Array.from({ length: 53 }, (_, i) => new Date(from + i * 7 * 86400000).toISOString()));
  const result = classify(data, metadata({ session, resolution: "1W" }), "1W");
  assert.equal(result.evidence.status, "unavailable");
  assert.equal(result.evidence.reason, "session_schedule_budget_exceeded");
  assert.equal(result.evidence.counts.scheduled_closures, 0);
  const holidays = data.flatMap((bar) => [1, 2, 3, 4].map((day) => new Date(bar.time * 1000 + day * 86400000).toISOString().slice(0, 10).replaceAll("-", ""))).join(",");
  const diagnostics = classify(data, metadata({ session, resolution: "1W", sessionHolidays: holidays }), "1W");
  assert.equal(diagnostics.evidence.reason, "session_schedule_budget_exceeded", "diagnostic default resolution must not swallow its budget error");
});
