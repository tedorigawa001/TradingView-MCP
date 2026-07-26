import assert from "node:assert/strict";
import test from "node:test";
import { CmeDailyBulletinClient, parseCmeGoldOpenInterestBulletin } from "../../build/cmeDailyBulletin.js";

const bulletin = `
METAL FUTURES PRODUCTS
PG62 BULLETIN # 141@ Fri, Jul 24, 2026 PG62
FINAL
GC FUT COMEX GOLD FUTURES
AUG26 4053.40 4085.20 /4024.00 4070.80 + 20.60 113747 6325 139888 - 34103
TOTAL GC FUT 165346 13123 376079 - 12136
`;

test("CME Bulletin parser reads only TOTAL GC FUT and preserves the publication state", () => {
  const result = parseCmeGoldOpenInterestBulletin({
    text: bulletin,
    sourceUrl: "https://example.test/Section62.pdf",
    observedAt: "2026-07-25T15:00:00.000Z",
  });
  assert.deepEqual(result, {
    schema_version: "1.0",
    status: "complete",
    observation_date: "2026-07-24",
    open_interest: 376079,
    report_status: "final",
    bulletin_number: 141,
    source: "cme_daily_bulletin",
    source_detail: "GC_FUT",
    source_url: "https://example.test/Section62.pdf",
    observed_at: "2026-07-25T15:00:00.000Z",
  });
});

test("CME Bulletin parser fails closed for a missing or ambiguous GC total", () => {
  assert.throws(() => parseCmeGoldOpenInterestBulletin({
    text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", ""),
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  }), /TOTAL GC FUT row/);
  assert.throws(() => parseCmeGoldOpenInterestBulletin({
    text: `${bulletin}\nTOTAL GC FUT 1 2 3 + 4`,
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  }), /expected one TOTAL GC FUT row/);
});

test("CME Bulletin parser does not mistake a reordered OI change for total open interest", () => {
  const result = parseCmeGoldOpenInterestBulletin({
    text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", "TOTAL GC FUT 165346 13123 - 12136 376079"),
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  });
  assert.equal(result.open_interest, 376079);
});

test("CME Bulletin parser accepts a total row with omitted empty volume columns", () => {
  const result = parseCmeGoldOpenInterestBulletin({
    text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", "TOTAL GC FUT 376079 - 12136"),
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  });
  assert.equal(result.open_interest, 376079);
});

test("CME Bulletin parser rejects an implausibly small GC total", () => {
  assert.throws(() => parseCmeGoldOpenInterestBulletin({
    text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", "TOTAL GC FUT 12136 - 93"),
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  }), /implausibly small/);
});

test("CME Bulletin client rejects a non-PDF response before parsing", async () => {
  const client = new CmeDailyBulletinClient(
    async () => new Response("not a PDF", { status: 200, headers: { "content-type": "text/html" } }),
    async () => bulletin,
    () => new Date("2026-07-25T15:00:00.000Z"),
  );
  await assert.rejects(() => client.getLatestGoldOpenInterest(), /not a PDF/);
});
