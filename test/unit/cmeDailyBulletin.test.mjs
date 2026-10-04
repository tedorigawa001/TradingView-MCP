import assert from "node:assert/strict";
import test from "node:test";
import {
  CmeDailyBulletinClient,
  extractPdfLayoutWithPdfJs,
  extractPdfTextWithPdfJs,
  parseCmeGoldOpenInterestBulletin,
  pdfLines,
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

test("CME Bulletin parser refuses headers that disagree, and accepts one repeated on every page", () => {
  const headed = (...headers) => parseCmeGoldOpenInterestBulletin({
    text: `${headers.join("\n")}\nFINAL\nTOTAL GC FUT 165346 13123 376079 - 12136`,
    sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z",
  });
  const page = "PG62 BULLETIN # 141@ Fri, Jul 24, 2026 PG62";
  assert.deepEqual(Object.values((({ bulletin_number, observation_date }) => ({ bulletin_number, observation_date }))(headed(page, page, page))),
    [141, "2026-07-24"]);
  assert.throws(() => headed(page, "PG62 BULLETIN # 142@ Mon, Jul 27, 2026 PG62"), /headers disagree on its number \(141, 142\)/);
  assert.throws(() => headed(page, "PG62 BULLETIN # 141@ Mon, Jul 27, 2026 PG62"), /headers disagree on its date/);
  // Only "BULLETIN #" and its number on one line count: not a figure on the next line, nor one after a bare BULLETIN.
  assert.equal(headed(page, "AEP FUT ALUMINIUM EURO PREM METAL BULLETIN\n1234 ----").bulletin_number, 141);
  assert.equal(headed(page, "METAL BULLETIN 2026 EDITION").bulletin_number, 141);
  // Two headers on one line (text without line breaks) are both read.
  assert.throws(() => headed(`${page} PG62 BULLETIN # 142@ Mon, Jul 27, 2026 PG62`), /disagree on its number \(141, 142\)/);
  // A date is compared as a date, whatever its case or padding, and must name its own weekday.
  assert.equal(headed(page, "PG62 BULLETIN # 141@ FRI, JUL 24, 2026 PG62").observation_date, "2026-07-24");
  assert.equal(headed("PG62 BULLETIN # 190@ Fri, Oct 2, 2026", "PG62 BULLETIN # 190@ Fri, Oct 02, 2026").observation_date, "2026-10-02");
  assert.throws(() => headed("PG62 BULLETIN # 141@ Mon, Jul 24, 2026 PG62"), /names the wrong weekday/);
  // Numbers beyond the safe integers are refused before they are compared: these two differ but round to one value,
  // and a 400-digit one would be Infinity.
  assert.throws(() => headed("PG62 BULLETIN # 9007199254740993@ Fri, Jul 24, 2026", "PG62 BULLETIN # 9007199254740992@ Fri, Jul 24, 2026"),
    /9007199254740993 is not a safe integer/);
  assert.throws(() => headed(`PG62 BULLETIN # ${"9".repeat(400)}@ Fri, Jul 24, 2026`), /is not a safe integer/);
  assert.equal(headed("PG62 BULLETIN # 9007199254740991@ Fri, Jul 24, 2026").bulletin_number, Number.MAX_SAFE_INTEGER);
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
  // A piece's end is its start plus its width; without a width it has none, so it can place nothing.
  assert.deepEqual(pdfLines([{ ...piece("376079", 530, 100), width: 28 }, piece("+", 565, 100)])[0].pieces.map((item) => item.right), [558, null]);
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
    "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>",
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

test("CME Bulletin parser given text alone refuses a total row that leaves out a column", () => {
  // Without positions a lone figure could be a volume with the open interest column empty.
  const missing = /shows \d of its 3 columns/;
  assert.throws(() => withTotal("TOTAL GC FUT 500000 + 1442"), missing);
  assert.throws(() => withTotal("TOTAL GC FUT 500000 376079 + 120"), missing);
  assert.throws(() => withTotal("TOTAL GC FUT 376079 - 12136"), missing);
});

test("CME Bulletin parser rejects an implausibly small GC total", () => {
  assert.throws(() => parseCmeGoldOpenInterestBulletin({
    text: bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", "TOTAL GC FUT 1 2 12136 - 93"),
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
    ["TOTAL GC FUT", 40, 500], ["500000", 300, 500], ["13123", 360, 500], ["999999", 400, 500, "0 1 -1 0"], ["376079", 440, 500],
    ["- 12136", 520, 500],
  ]));
  assert.equal(stamped.split("\n").at(-1), "TOTAL GC FUT 500000 13123 376079 - 12136");
  assert.equal(parseCmeGoldOpenInterestBulletin({ text: stamped, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" }).open_interest, 376079);
});

// The layout of the bulletin of 2026-10-02 (612 x 1008, positions from the top): right-aligned figures in a monospaced
// font, the Globex volume, PNT volume and open interest columns ending at 438, 492 and 558, the change at 594.
const COLUMN_ENDS = { globex: 438, pnt: 492, interest: 558, change: 594 };
/** A piece drawn so it ends at `right`, `top` from the page's top, in Courier `height` units tall. */
const ending = (text, right, top, height = 6.5) => [text, right - text.length * 0.6 * height, 1008 - top, `${height / 8} 0 0 ${height / 8}`];
const at = (text, x, top, height = 6.5) => [text, x, 1008 - top, `${height / 8} 0 0 ${height / 8}`];
/** A contract-month row: its code, a price, then the three figure columns (a figure or dashes) and its change. */
const monthPieces = (month, top, [globex, pnt, interest], change = ["+", "488"]) => [
  at(month, 18, top), ending("4162.25", 312, top), ending(globex, COLUMN_ENDS.globex, top), ending(pnt, COLUMN_ENDS.pnt, top),
  ending(interest, COLUMN_ENDS.interest, top), ...(change.length === 2 ? [at(change[0], 565.2, top)] : []), ending(change.at(-1), COLUMN_ENDS.change, top),
];
const FIVE_MONTHS = [["DEC26", ["64298", "----", "83129"]], ["FEB27", ["1885", "----", "3184"]], ["APR27", ["86", "----", "136"]],
  ["JUN27", ["----", "----", "131"], ["UNCH"]], ["DEC29", ["----", "----", "53"], ["UNCH"]]];
/** One page of the bulletin with five contract-month rows and the given TOTAL GC FUT figures and change. */
const bulletinPage = (figures, change = ["+", "1442"], { months = FIVE_MONTHS, header = "PG62 BULLETIN # 190@ METAL FUTURES PRODUCTS Fri, Oct 02, 2026 PG62" } = {}) =>
  onePagePdf([
    at(header, 18, 40, 7.5), at("PRELIMINARY", 18, 52, 7.5),
    ...months.flatMap(([month, columns, monthChange], index) => monthPieces(month, 200 + index * 8, columns, monthChange)),
    // The TOTAL row as pdf.js draws it on that bulletin: the Globex volume first, the label 1.5 units higher, the sign last.
    ...figures.filter(([, column]) => column === "globex").map(([text]) => ending(text, COLUMN_ENDS.globex, 273.5)),
    at("TOTAL", 18, 275, 7.5), at("GC", 49.66, 275, 7.5), at("FUT", 63.23, 275, 7.5),
    ...figures.filter(([, column]) => column !== "globex").map(([text, column]) =>
      typeof column === "number" ? ending(text, column, 273.5) : ending(text, COLUMN_ENDS[column], 273.5)),
    ...(change.length === 2 ? [ending(change[1], COLUMN_ENDS.change, 273.5), at(change[0], 565.2, 273.1, 6)] : change.map((word) => ending(word, COLUMN_ENDS.change, 273.5))),
    at("HDG FUT U.S. MIDWEST DOM STEEL PREM(CRU)FUT", 18, 283, 7.5),
  ], { mediaBox: "0 0 612 1008" });
const readPage = async (pdf) => parseCmeGoldOpenInterestBulletin({ layout: await extractPdfLayoutWithPdfJs(pdf),
  sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-10-04T13:00:00.000Z" });

test("pdf.js text of the bulletin of 2026-10-02, drawn in its own order, yields its open interest", async () => {
  const full = bulletinPage([["184541", "globex"], ["2885", "pnt"], ["395508", "interest"]]);
  // pdf.js takes the bytes it is given, so each read gets its own copy.
  assert.ok((await extractPdfTextWithPdfJs(full.slice())).split("\n").includes("TOTAL GC FUT 184541 2885 395508 + 1442"));
  const result = await readPage(full);
  assert.deepEqual([result.open_interest, result.observation_date, result.bulletin_number, result.report_status],
    [395508, "2026-10-02", 190, "preliminary"]);
});

test("each TOTAL GC FUT figure is placed in its column, as the bulletin's total rows leave a column blank", async () => {
  // As "TOTAL 1OZ FUT 66269 86609" (no PNT volume), "TOTAL COB FUT 263 16854" (no Globex volume) and
  // "TOTAL ALA FUT 2315" (open interest alone, unchanged, so no change printed) on that bulletin.
  assert.equal((await readPage(bulletinPage([["184541", "globex"], ["395508", "interest"]]))).open_interest, 395508);
  assert.equal((await readPage(bulletinPage([["2885", "pnt"], ["395508", "interest"]]))).open_interest, 395508);
  assert.equal((await readPage(bulletinPage([["395508", "interest"]], []))).open_interest, 395508);
  assert.equal((await readPage(bulletinPage([["184541", "globex"], ["2885", "pnt"], ["395508", "interest"]], ["UNCH"]))).open_interest, 395508);
});

test("a TOTAL GC FUT row without an open interest in its column is refused, not read from a volume", async () => {
  const empty = /open interest column is empty/;
  await assert.rejects(() => readPage(bulletinPage([["500000", "globex"]])), empty, "the reported case: 500000 in the volume column");
  await assert.rejects(() => readPage(bulletinPage([["500000", "globex"], ["213123", "pnt"]])), empty);
  await assert.rejects(() => readPage(bulletinPage([["500000", "globex"], ["2885", "pnt"], ["----", "interest"]])), empty);
  // A figure between columns is refused.
  await assert.rejects(() => readPage(bulletinPage([["184541", "globex"], ["395508", 561]])), /395508 is in none of the bulletin's figure columns/);
});

// A layout as the default extractor returns it: lines of pieces with where each ends.
const line = (pieces) => ({ text: pieces.map(([str]) => str).join(" "), pieces: pieces.map(([str, x, right]) => ({ str, x, right })) });
const headerLine = (header = "PG62 BULLETIN # 141@ Fri, Jul 24, 2026 PG62") => line([[header, 18, 200]]);
const monthRow = (month, [globex, pnt, interest] = [438, 492, 558]) => line([[month, 18, 40], ["113747", globex - 28, globex],
  ["6325", pnt - 22, pnt], ["139888", interest - 28, interest], ["-", 565, 568], ["34103", 570, 594]]);
const months = (count, ends) => Array.from({ length: count }, (_, index) => monthRow(`M${String(index).padStart(2, "0")}`.replace(/^M/, ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT"][index % 10]), ends));
const totalRow = (...figures) => line([["TOTAL", 18, 40], ["GC", 49, 58], ["FUT", 63, 77], ...figures, ["-", 565, 568], ["12136", 570, 594]]);
const goodTotal = totalRow(["165346", 410, 438], ["13123", 470, 492], ["376079", 530, 558.4]);
const fromPages = (...pages) => parseCmeGoldOpenInterestBulletin({ layout: pages, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" });
const page = (...lines) => [headerLine(), line([["FINAL", 18, 40]]), ...lines];

test("CME Bulletin client reads the open interest from the extractor's lines and positions", async () => {
  const client = new CmeDailyBulletinClient(
    async () => new Response("%PDF", { status: 200, headers: { "content-type": "application/pdf" } }),
    async () => [page(...months(5), goodTotal)],
    () => new Date("2026-07-25T15:00:00.000Z"),
    "https://example.test/Section62.pdf",
  );
  assert.equal((await client.getLatestGoldOpenInterest()).open_interest, 376079);
});

test("the figure columns need five contract-month rows, four in five agreeing, running left to right", () => {
  const notLocated = /column could not be located from its contract-month rows/;
  assert.throws(() => fromPages(page(goodTotal)), notLocated, "no contract-month rows");
  assert.throws(() => fromPages(page(...months(4), goodTotal)), notLocated, "four rows");
  // Odd rows: one in six leaves the columns where they are, two in five is too many, a tie is refused.
  assert.equal(fromPages(page(...months(5), monthRow("NOV26", [400, 492, 520]), goodTotal)).open_interest, 376079);
  assert.throws(() => fromPages(page(...months(3), monthRow("NOV26", [400, 492, 520]), monthRow("DEC26", [400, 492, 520]), goodTotal)), notLocated);
  assert.throws(() => fromPages(page(...months(5), ...months(5, [438, 492, 520]), goodTotal)), notLocated);
  assert.throws(() => fromPages(page(...months(5, [492, 438, 558]), goodTotal)), /do not run left to right/);
  // Six in eight (75%) is not four in five.
  assert.throws(() => fromPages(page(...months(6), monthRow("NOV26", [400, 492, 520]), monthRow("DEC26", [400, 492, 520]), goodTotal)), notLocated);
  // Figures drifting 0.02 a digit across x.25, which split half-unit bins, still make one column.
  const drifting = Array.from({ length: 10 }, (_, index) => monthRow(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT"][index] + "27",
    index % 2 === 0 ? [438.22, 492.22, 558.22] : [438.28, 492.28, 558.28]));
  assert.equal(fromPages(page(...drifting, totalRow(["165346", 410, 438.3], ["13123", 470, 492.3], ["376079", 530, 558.3]))).open_interest, 376079);
  // The column sits in the middle of its run: edges spread from 557.1 to 558.9 put it at 558, so 558.9 is in it.
  const spread = Array.from({ length: 10 }, (_, index) => monthRow(["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT"][index] + "28",
    [438, 492, index < 5 ? 557.1 : 558.9]));
  assert.equal(fromPages(page(...spread, totalRow(["165346", 410, 438], ["13123", 470, 492], ["376079", 530, 558.9]))).open_interest, 376079);
  // A row whose column words share a piece cannot place them, so it casts no votes.
  const joined = line([["MAR27", 18, 40], ["113747 6325", 380, 492], ["139888", 530, 558], ["-", 565, 568], ["34103", 570, 594]]);
  assert.equal(fromPages(page(...months(5), joined, joined, goodTotal)).open_interest, 376079);
  // The rows can be on another page than the total, as GC's run onto the page before its TOTAL on that bulletin.
  assert.equal(fromPages(page(...months(5)), page(goodTotal)).open_interest, 376079);
});

test("a TOTAL GC FUT figure must end within a unit of its column, in its own piece, each column at most once", () => {
  const volumes = [["165346", 410, 438], ["13123", 470, 492]];
  assert.throws(() => fromPages(page(...months(5), totalRow(...volumes, ["376079", 533, 561]))), /376079 is in none of the bulletin's figure columns/);
  // The tolerance is one unit: 0.9 off is in the column, 1.2 off is not.
  assert.equal(fromPages(page(...months(5), totalRow(...volumes, ["376079", 530, 558.9]))).open_interest, 376079);
  assert.equal(fromPages(page(...months(5), totalRow(...volumes, ["376079", 530, 557.1]))).open_interest, 376079);
  assert.throws(() => fromPages(page(...months(5), totalRow(...volumes, ["376079", 530, 559.2]))), /376079 is in none/);
  assert.throws(() => fromPages(page(...months(5), totalRow(["165346 376079", 410, 558]))), /165346 is in none/, "a piece of two figures");
  assert.throws(() => fromPages(page(...months(5), totalRow(["13123", 470, 492], ["2885", 470, 492], ["376079", 530, 558]))), /repeats or reverses/);
  assert.throws(() => fromPages(page(...months(5), totalRow(["376079", 530, 558], ["165346", 410, 438]))), /repeats or reverses/);
  // A seven-digit open interest in two pieces: the first lands in no column, so the bulletin is refused rather than
  // read as 395508. (Drawn touching, pdf.js joins such runs into one figure.)
  assert.throws(() => fromPages(page(...months(5), totalRow(["165346", 410, 438], ["1", 530, 534.6], ["395508", 534.6, 558]))), /figure 1 is in none/);
  // After the change a figure is refused.
  assert.throws(() => fromPages(page(...months(5), line([["TOTAL", 18, 40], ["GC", 49, 58], ["FUT", 63, 77], ...volumes,
    ["376079", 530, 558], ["-", 565, 568], ["12136", 570, 594], ["99", 600, 610]]))), /number after its open interest change/);
  // A piece with no width cannot be placed.
  assert.throws(() => fromPages(page(...months(5), totalRow(...volumes, ["376079", 530, null]))), /376079 is in none/);
});

test("given text and a layout, the layout is what the open interest is read from", () => {
  // A total row with its PNT column blank, which only positions can read.
  const layout = [page(...months(5), totalRow(["165346", 410, 438], ["376079", 530, 558]))];
  const text = `${bulletin.replace("TOTAL GC FUT 165346 13123 376079 - 12136", "TOTAL GC FUT 500000 + 1442")}`;
  assert.equal(parseCmeGoldOpenInterestBulletin({ text, layout, sourceUrl: "https://example.test/Section62.pdf", observedAt: "2026-07-25T15:00:00.000Z" }).open_interest, 376079);
});

test("with a layout every page needs one dated BULLETIN # header, all of them agreeing", () => {
  assert.equal(fromPages(page(...months(5)), page(goodTotal)).bulletin_number, 141);
  assert.throws(() => fromPages(page(...months(5)), [line([["FINAL", 18, 40]]), goodTotal]), /page 2 has 0 BULLETIN # headers/);
  assert.throws(() => fromPages(page(...months(5)), [headerLine("PG62 BULLETIN # 141@ METAL"), line([["Fri, Jul 24, 2026", 18, 80]]), goodTotal]),
    /page 2 has an undated BULLETIN # header/, "a header split across two lines");
  assert.throws(() => fromPages(page(...months(5)), [headerLine("PG62 BULLETIN # 141@ Mon, Jul 27, 2026 PG62"), goodTotal]), /disagree on its date/);
  // A page without table rows, such as an appended page of notes, need not carry the header; a page of month rows must.
  assert.equal(fromPages(page(...months(5), goodTotal), [line([["Copyright CME Group", 18, 100]])]).open_interest, 376079);
  assert.throws(() => fromPages(page(goodTotal), [...months(5)]), /page 2 has 0 BULLETIN # headers/);
  // A date before the header on its line is not its date; a header showing two dates is refused.
  const dated = (header) => fromPages([headerLine(header), line([["FINAL", 18, 40]]), ...months(5), goodTotal]).observation_date;
  assert.equal(dated("Mon, Jul 27, 2026 PG62 BULLETIN # 141@ Fri, Jul 24, 2026"), "2026-07-24");
  assert.throws(() => dated("PG62 BULLETIN # 141@ Fri, Jul 24, 2026 Mon, Jul 27, 2026"), /header shows more than one date/);
});
