import assert from "node:assert/strict";
import test from "node:test";
import {
  CmeDailyBulletinClient,
  extractPdfTextWithPdfJs,
  parseCmeGoldOpenInterestBulletin,
  pdfTextLines,
} from "../../build/cmeDailyBulletin.js";

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

// BACKLOG 102-03: the open interest is read by the meaning of the row's fields, not as its largest number.
const withTotal = (row) => parseCmeGoldOpenInterestBulletin({
  text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", row),
  sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
}).open_interest;

test("CME Bulletin parser takes the open interest before its change, even below a volume", () => {
  assert.equal(withTotal("TOTAL GC FUT 500000 13123 376079 - 12136"), 376079, "the largest number is a volume");
  assert.equal(withTotal("TOTAL GC FUT 500000 376079 + 120"), 376079, "one volume column empty");
  assert.equal(withTotal("TOTAL GC FUT 165346 13123 376079 UNCH"), 376079, "no change");
  assert.equal(withTotal("TOTAL GC FUT 165346 13123 376079 -12136"), 376079, "the sign joined to the change");
  assert.equal(withTotal("TOTAL GC FUT 165,346 13,123 376,079 - 12,136"), 376079, "thousands separators");
  assert.equal(withTotal("TOTAL GC FUT 165346 13123 376079 NEW"), 376079);
  // A column without a figure prints dashes, as on the bulletin's contract-month rows.
  assert.equal(withTotal("TOTAL GC FUT 184541 ---- 395508 + 1442"), 395508, "no PNT volume");
  assert.equal(withTotal("TOTAL GC FUT 500000 ---- 376079 - 12136"), 376079);
  assert.equal(withTotal("TOTAL GC FUT ---- ---- 376079 UNCH"), 376079);
  assert.equal(withTotal("TOTAL GC FUT 184541 2885 395508 + 1442 ----"), 395508, "an empty column after the change ends the row");
  // The row is its line, and in text without line breaks it ends at a word after the change.
  assert.equal(withTotal("TOTAL GC FUT 165346 13123 376079 - 12136\n2000 3000"), 376079);
  assert.equal(withTotal("TOTAL GC FUT 165346 13123 376079 - 12136 MGC FUT 5 6"), 376079);
});

test("CME Bulletin parser refuses a total row whose fields cannot be told apart", () => {
  const refused = /cannot be told apart|columns before its open interest change/;
  // The change before a number: in text alone either could be the open interest (the extractor orders by position).
  assert.throws(() => withTotal("TOTAL GC FUT 165346 13123 - 12136 376079"), refused);
  // However the change is written, a volume above 100,000 would otherwise be taken for the open interest.
  assert.throws(() => withTotal("TOTAL GC FUT 165346 213123 -12136 376079"), refused);
  assert.throws(() => withTotal("TOTAL GC FUT 165346 213123 UNCH 376079"), refused);
  assert.throws(() => withTotal("TOTAL GC FUT 165346 13123 376079 - 12136 99"), refused);
  assert.throws(() => withTotal("TOTAL GC FUT 165346 13123 376079 - 12136 + 5"), refused, "a second change");
  assert.throws(() => withTotal("TOTAL GC FUT 1 165346 13123 376079 - 12136"), refused, "more than two volumes");
  assert.throws(() => withTotal("TOTAL GC FUT UNCH"), refused);
  assert.throws(() => withTotal("TOTAL GC FUT 4070.80 + 20.60"), refused);
  // Anything else before the change, where the old reading and a cut-short row both returned the volume 500000.
  const unreadable = /before its open interest change, so its fields cannot be told apart/;
  for (const row of ["500000 376079* - 12136", "500000 376079- 12136", "500000 376079.0 - 12136", "500000 376,07 - 12136"]) {
    assert.throws(() => withTotal(`TOTAL GC FUT ${row}`), unreadable, row);
  }
  assert.throws(() => withTotal("TOTAL GC FUT 184541 2885 ---- + 1442"), /the last empty/, "no open interest");
  assert.throws(() => withTotal("TOTAL GC FUT ---- 184541 2885 395508 + 1442"), /4 columns/);
  // Without a change the open interest cannot be told from a volume, nor a row wrapped onto two lines.
  const noChange = /has no open interest change/;
  assert.throws(() => withTotal("TOTAL GC FUT 165346 13123 376079\n2000 3000"), noChange);
  assert.throws(() => withTotal("TOTAL GC FUT 165346\n376079 - 12136"), noChange);
  assert.throws(() => withTotal("TOTAL GC FUT 165346 13123 376079 ----"), noChange, "dashes are an empty column, not the change");
});

test("CME Bulletin parser takes the trade date from the BULLETIN # line when the bulletin shows several dates", () => {
  const dated = (text) => parseCmeGoldOpenInterestBulletin({ text, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" }).observation_date;
  assert.equal(dated(`Printed Mon, Jul 27, 2026\n${bulletin}`), "2026-07-24", "a later date above the header");
  assert.equal(dated(`${bulletin}\nPG62 BULLETIN # 141@ Fri, Jul 24, 2026 PG62`), "2026-07-24", "the same date again");
  assert.throws(() => dated(bulletin.replace("PG62 BULLETIN # 141@ Fri, Jul 24, 2026 PG62", "PG62 BULLETIN # 141@\nFri, Jul 24, 2026\nMon, Jul 27, 2026")),
    /more than one date and none on its BULLETIN # line/);
});

test("PDF text lines are rebuilt from positions: one baseline per line, left to right, top to bottom", () => {
  // y runs down the shown page.
  const piece = (str, x, y, height = 8) => ({ str, x, y, height });
  assert.deepEqual(pdfTextLines([
    piece("- 12136", 520, 112), piece("TOTAL GC FUT", 40, 111.2), piece("376079", 440, 112), piece("165346", 300, 112.5),
    piece("139888", 440, 102), piece("AUG26", 40, 102), piece(" ", 600, 107), piece("13123", 370, 112),
  ]), ["AUG26 139888", "TOTAL GC FUT 165346 13123 376079 - 12136"]);
  // A piece continues the line of the one above it, so a sign set 3 units high stays in the row.
  assert.deepEqual(pdfTextLines([piece("- 12136", 520, 109), piece("TOTAL GC FUT", 40, 112), piece("500000", 300, 112),
    piece("376079", 440, 112.3)]), ["TOTAL GC FUT 500000 376079 - 12136"]);
  // The room is 40% of the taller text: 2.5 units joins and 3.3 parts 8-unit text, and a label of no height joins.
  assert.deepEqual(pdfTextLines([piece("A", 0, 100), piece("B", 10, 102.5)]), ["A B"]);
  assert.deepEqual(pdfTextLines([piece("A", 0, 100), piece("B", 0, 103.3)]), ["A", "B"]);
  assert.deepEqual(pdfTextLines([piece("TOTAL GC FUT", 0, 100, 0), piece("376079", 50, 101.2)]), ["TOTAL GC FUT 376079"]);
});

/**
 * A one-page PDF drawing each piece at its position, in the order given. A piece may carry its text matrix (default
 * upright), and the page a /Rotate.
 */
function onePagePdf(pieces, { rotate = 0, mediaBox = "0 0 792 612" } = {}) {
  const escape = (text) => text.replace(/[\\()]/g, (character) => `\\${character}`);
  const stream = pieces.map(([text, x, y, matrix = "1 0 0 1"]) => `BT /F1 8 Tf ${matrix} ${x} ${y} Tm (${escape(text)}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [${mediaBox}] /Rotate ${rotate} /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(body, "latin1"));
}

test("pdf.js text of a bulletin drawn out of column order still yields the open interest", async () => {
  // The TOTAL row is drawn change first and volumes last, with a volume above the open interest; the header is split.
  const text = await extractPdfTextWithPdfJs(onePagePdf([
    ["FINAL", 40, 560], ["2026", 330, 580], ["PG62 BULLETIN # 141@", 40, 580], ["Fri, Jul 24,", 250, 580],
    ["TOTAL GC FUT", 40, 500], ["- 12136", 520, 500], ["376079", 440, 500], ["500000", 300, 500], ["13123", 370, 500],
    ["AUG26", 40, 510], ["139888", 440, 510],
  ]));
  assert.equal(text.split("\n").at(-1), "TOTAL GC FUT 500000 13123 376079 - 12136");
  const result = parseCmeGoldOpenInterestBulletin({ text, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" });
  assert.deepEqual([result.open_interest, result.observation_date, result.bulletin_number, result.report_status], [376079, "2026-07-24", 141, "final"]);
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

test("CME Bulletin client rejects an oversized PDF before parsing", async () => {
  let extracted = false;
  const client = new CmeDailyBulletinClient(
    async () => new Response("small", { status: 200, headers: { "content-type": "application/pdf", "content-length": String(16 * 1024 * 1024 + 1) } }),
    async () => (extracted = true, bulletin),
  );
  await assert.rejects(() => client.getLatestGoldOpenInterest(), /CME metals bulletin response is too large/);
  assert.equal(extracted, false);
});

test("pdf.js text of a landscape bulletin made as a rotated portrait page keeps its rows; rotated stamps are left out", async () => {
  // Shown landscape: a piece shown at (x, y from the top) sits at (y, x) on the portrait page, drawn turned a quarter.
  const turned = (text, shownX, shownTop) => [text, shownTop, shownX, "0 1 -1 0"];
  const rotated = await extractPdfTextWithPdfJs(onePagePdf([
    turned("PG62 BULLETIN # 141@ Fri, Jul 24, 2026", 40, 32), turned("FINAL", 40, 52),
    turned("- 12136", 520, 112), turned("376079", 440, 112), turned("TOTAL GC FUT", 40, 112), turned("500000", 300, 112), turned("13123", 370, 112),
  ], { rotate: 90, mediaBox: "0 0 612 792" }));
  assert.equal(rotated.split("\n").at(-1), "TOTAL GC FUT 500000 13123 376079 - 12136");
  // A stamp turned on an upright page, level with the total row, would otherwise join it.
  const stamped = await extractPdfTextWithPdfJs(onePagePdf([
    ["PG62 BULLETIN # 141@ Fri, Jul 24, 2026", 40, 580], ["FINAL", 40, 560],
    ["TOTAL GC FUT", 40, 500], ["500000", 300, 500], ["999999", 400, 500, "0 1 -1 0"], ["376079", 440, 500], ["- 12136", 520, 500],
  ]));
  assert.equal(stamped.split("\n").at(-1), "TOTAL GC FUT 500000 376079 - 12136");
  assert.equal(parseCmeGoldOpenInterestBulletin({ text: stamped, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" }).open_interest, 376079);
});

test("pdf.js text of the bulletin of 2026-10-02, drawn in its own order, yields its open interest", async () => {
  // The TOTAL GC FUT row of that bulletin as pdf.js returned it: in drawing order, at its shown positions (from the top
  // of a 612 x 1008 page), with its text heights. The Globex volume comes before the label and the sign after the change.
  const shown = (text, x, top, height) => {
    const scale = height / 8;
    return [text, x, 1008 - top, `${scale} 0 0 ${scale}`];
  };
  const text = await extractPdfTextWithPdfJs(onePagePdf([
    shown("PG62 BULLETIN # 190@ METAL FUTURES PRODUCTS Fri, Oct 02, 2026 PG62", 18, 40, 7.5), shown("PRELIMINARY", 18, 52, 7.5),
    shown("DEC29", 18, 266, 6.5), shown("----", 414.6, 266, 6.5), shown("53", 534.6, 266, 6.5), shown("UNCH", 565.2, 266, 6.5),
    shown("184541", 414.6, 273.5, 6.5), shown("TOTAL", 18, 275, 7.5), shown("GC", 49.66, 275, 7.5), shown("FUT", 63.23, 275, 7.5),
    shown("395508", 534.6, 273.5, 6.5), shown("2885", 476.42, 273.5, 6.5), shown("1442", 578.4, 273.5, 6.5), shown("+", 565.2, 273.1, 6),
    shown("HDG FUT U.S. MIDWEST DOM STEEL PREM(CRU)FUT", 18, 283, 7.5),
  ], { mediaBox: "0 0 612 1008" }));
  assert.ok(text.split("\n").includes("TOTAL GC FUT 184541 2885 395508 + 1442"));
  const result = parseCmeGoldOpenInterestBulletin({ text, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-10-04T13:00:00.000Z" });
  assert.deepEqual([result.open_interest, result.observation_date, result.bulletin_number, result.report_status],
    [395508, "2026-10-02", 190, "preliminary"]);
});
