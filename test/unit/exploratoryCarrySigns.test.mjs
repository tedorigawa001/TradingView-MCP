import assert from "node:assert/strict";
import test from "node:test";
import { buildExploratoryCarrySigns } from "../../build/exploratoryCarrySigns.js";

const record = (currency, observation_date, value) => ({
  schema_version: "1.0", sequence: 1, series: "policy_rate_official_history", evidence_tier: "exploratory_revised_history",
  currency, source_symbol: `ECONOMICS:${currency === "EUR" ? "EU" : currency}INTR`, observation_date, value,
  source_url: "https://example.test/rates", source_vintage_at: null, raw_sha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  retrieved_at: "2026-07-29T00:00:00.000Z", first_seen_at: "2026-07-29T00:00:00.000Z",
});

test("exploratory carry signs use the policy-rate difference at each anchor and disclose ties", () => {
  const result = buildExploratoryCarrySigns({
    pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }],
    dates: ["2020-01-01", "2020-02-01", "2020-03-01"],
    histories: {
      USD: [record("USD", "2019-01-01", 1), record("USD", "2020-02-01", 0.5)],
      EUR: [record("EUR", "2019-01-01", 0), record("EUR", "2020-03-01", 1)],
      JPY: [], GBP: [], AUD: [], NZD: [], CAD: [], CHF: [],
    },
  });
  assert.deepEqual(result.signs.EURUSD, { "2020-01-01": -1, "2020-02-01": -1, "2020-03-01": 1 });
  assert.equal(result.unavailable_dates_by_pair.EURUSD, 0);
  assert.equal(result.point_in_time_status, "not_available");
});

test("exploratory carry signs do not bridge a no-single-rate-target state or equal rates", () => {
  const result = buildExploratoryCarrySigns({
    pairs: [{ pair_id: "USDJPY", base_currency: "USD", quote_currency: "JPY" }], dates: ["2013-04-03", "2013-04-04", "2013-04-05"],
    histories: {
      USD: [record("USD", "2013-01-01", 1)],
      JPY: [record("JPY", "2013-01-01", 0.5), record("JPY", "2013-04-04", null)],
      EUR: [], GBP: [], AUD: [], NZD: [], CAD: [], CHF: [],
    },
  });
  assert.deepEqual(result.signs.USDJPY, { "2013-04-03": 1 });
  assert.equal(result.unavailable_dates_by_pair.USDJPY, 2);
});

test("exploratory carry signs normalize unsorted downloaded versions by observation date and latest sequence", () => {
  const result = buildExploratoryCarrySigns({
    pairs: [{ pair_id: "EURUSD", base_currency: "EUR", quote_currency: "USD" }], dates: ["2020-03-01"],
    histories: {
      USD: [record("USD", "2020-02-01", 1), { ...record("USD", "2020-01-01", 4), sequence: 9 }, { ...record("USD", "2020-01-01", 2), sequence: 2 }],
      EUR: [{ ...record("EUR", "2020-01-01", 3), sequence: 1 }, { ...record("EUR", "2020-01-01", 0.5), sequence: 3 }],
      JPY: [], GBP: [], AUD: [], NZD: [], CAD: [], CHF: [],
    },
  });
  assert.deepEqual(result.signs.EURUSD, { "2020-03-01": -1 });
});
