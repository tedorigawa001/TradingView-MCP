import { assertExpectedResponseHost, readLimitedResponseBytes } from "./boundedResponse.js";

const CURRENT_METALS_BULLETIN_URL =
  "https://www.cmegroup.com/daily_bulletin/current/Section62_Metals_Futures_Products.pdf";
const MINIMUM_GC_TOTAL_OPEN_INTEREST = 100_000;
const MAX_BULLETIN_PDF_BYTES = 16 * 1024 * 1024;

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export type CmeGoldOpenInterest = {
  schema_version: "1.0";
  status: "complete";
  observation_date: string;
  open_interest: number;
  report_status: "preliminary" | "final";
  bulletin_number: number;
  source: "cme_daily_bulletin";
  source_detail: "GC_FUT";
  source_url: string;
  observed_at: string;
};

/** A rebuilt line of a page: its text, and the pieces it was built from, left to right, with where each ends. */
export type PdfLine = { text: string; pieces: Array<{ str: string; x: number; right: number | null }> };

/** A PDF's pages as rebuilt lines. */
export type PdfLayout = PdfLine[][];

/** The bulletin's text, or its lines with their positions; only the latter can place a figure in its column. */
export type PdfTextExtractor = (data: Uint8Array) => Promise<string | PdfLayout>;

/** An unsigned whole number, with or without thousands separators. */
const WHOLE_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

/**
 * The open interest of the TOTAL GC FUT row read from text alone, by the meaning of its fields (BACKLOG 102-03): the
 * Globex and PNT volumes, the open interest, then its change. A column without a figure prints a run of dashes ("----")
 * or is left out, and the change carries a sign ("+ 1442", "-120") or reads UNCH or NEW. The open interest is the last
 * column before the change. Taking the largest number returned a volume above the open interest, and an earlier reading
 * took the change itself, so a row without this shape is refused rather than guessed: anything else before the change
 * ("376079*", "376079-", a decimal), no change, a number or a second change after it, more than three columns, or an
 * empty last column. A word after the change ends the row (text without line breaks); otherwise the row is its line.
 * Returns the figure, its field's index and how many columns came before the change. Text cannot show which column a
 * figure is in, so its caller also needs all three; a layout is read by placedOpenInterest instead.
 */
function totalOpenInterest(fields: string[]): { value: number; index: number; columns: number } {
  const columns: Array<number | null> = [];
  let changed = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const number = WHOLE_NUMBER.test(field);
    const separateSign = (field === "+" || field === "-") && WHOLE_NUMBER.test(fields[index + 1] ?? "");
    const change = field === "UNCH" || field === "NEW" || (/^[+-]/.test(field) && WHOLE_NUMBER.test(field.slice(1))) || separateSign;
    if (changed) {
      if (number || change) {
        throw new Error("CME TOTAL GC FUT row has a number after its open interest change, so its fields cannot be told apart");
      }
      break;
    }
    if (number || /^-{2,}$/.test(field)) {
      columns.push(number ? Number(field.replace(/,/g, "")) : null);
      continue;
    }
    if (!change) {
      throw new Error(`CME TOTAL GC FUT row has ${JSON.stringify(field)} before its open interest change, so its fields cannot be told apart`);
    }
    changed = true;
    if (separateSign) index += 1;
  }
  if (!changed) throw new Error("CME TOTAL GC FUT row has no open interest change, so its open interest cannot be told from a volume");
  const openInterest = columns[columns.length - 1];
  if (columns.length > 3 || openInterest === undefined || openInterest === null) {
    throw new Error(`CME TOTAL GC FUT row has ${columns.length} columns before its open interest change, the last ${openInterest === null ? "empty" : "missing"}; expected at most two volumes and the open interest`);
  }
  // The columns are the first fields, one each, so the open interest is field columns - 1.
  return { value: openInterest, index: columns.length - 1, columns: columns.length };
}

/** A month code at the start of a contract-month row, as AUG26. */
const MONTH_CODE = /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}$/;
/** A line that opens with a month code. */
const MONTH_ROW = /^(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)\d{2}\b/;

/** A line's words, each with where it ends when it is its piece's only word (a piece of several cannot place one). */
function lineWords(line: PdfLine): Array<{ str: string; right: number | null }> {
  return line.pieces.flatMap((piece) => {
    const words = piece.str.trim().split(/\s+/).filter(Boolean);
    return words.map((str) => ({ str, right: words.length === 1 ? piece.right : null }));
  });
}

/** Where a row's closing change starts among its words (UNCH, NEW, "+ 120" or "-120"), or -1 when it does not end in one. */
function changeStart(words: string[]): number {
  const last = words.length - 1;
  const word = words[last] ?? "";
  if (word === "UNCH" || word === "NEW" || (/^[+-]/.test(word) && WHOLE_NUMBER.test(word.slice(1)))) return last;
  if (WHOLE_NUMBER.test(word) && (words[last - 1] === "+" || words[last - 1] === "-")) return last - 1;
  return -1;
}

/** The three figure columns a row prints before its change, left to right. */
const FIGURE_COLUMNS = ["Globex volume", "PNT volume", "open interest"] as const;
/** Votes a column needs, and the share one edge must take, before the bulletin's layout is trusted to place a figure. */
const MIN_COLUMN_VOTES = 5;
const MIN_COLUMN_SHARE = 0.8;
/** How far a figure may end from its column, in PDF units; columns are 54 to 66 units apart on the bulletin. */
const PLACEMENT_TOLERANCE = 1;

/**
 * The largest run of edges that fits within the placement tolerance either side of its middle, and that middle. Fixed
 * bins would split a column whose figures straddle a bin's boundary (the bulletin's drift 0.02 a digit, so an edge near
 * x.25 split between two half-unit bins and the bulletin was refused); a run is counted the way a figure is placed.
 */
function densestEdge(edges: number[]): { edge: number; count: number } {
  const sorted = [...edges].sort((left, right) => left - right);
  let best = { start: 0, end: 0 };
  let start = 0;
  for (let end = 0; end < sorted.length; end += 1) {
    while (sorted[end] - sorted[start] > 2 * PLACEMENT_TOLERANCE) start += 1;
    if (end + 1 - start > best.end - best.start) best = { start, end: end + 1 };
  }
  if (best.end === 0) return { edge: 0, count: 0 };
  return { edge: (sorted[best.start] + sorted[best.end - 1]) / 2, count: best.end - best.start };
}

/**
 * Where the Globex volume, PNT volume and open interest columns end. The bulletin right-aligns its figures, and a
 * contract-month row prints all three before its change, a figure or "----" each, so on every contract-month row the
 * right edges of those three words vote for the columns. Each column needs five votes, four in five of them within the
 * placement tolerance of one edge, and the three must run left to right; otherwise the bulletin is refused rather than
 * read against a column a few odd rows made up. On the bulletin of 2026-10-02 all 421 contract-month rows on pages 1 to
 * 5 agree: the columns end at 438, 492 and 558 (the figures between 558.02 and 558.12, a monospaced font drifting 0.02
 * a digit).
 */
function figureColumnEdges(layout: PdfLayout): [number, number, number] {
  const votes: number[][] = FIGURE_COLUMNS.map(() => []);
  for (const line of layout.flat()) {
    const words = lineWords(line);
    if (!MONTH_CODE.test(words[0]?.str ?? "")) continue;
    const start = changeStart(words.map((word) => word.str));
    if (start < FIGURE_COLUMNS.length) continue;
    const figures = words.slice(start - FIGURE_COLUMNS.length, start);
    if (figures.some((figure) => figure.right === null || !(WHOLE_NUMBER.test(figure.str) || /^-{2,}$/.test(figure.str)))) continue;
    figures.forEach((figure, column) => votes[column].push(figure.right!));
  }
  const edges = votes.map((rights, column) => {
    const total = rights.length;
    const { edge, count } = densestEdge(rights);
    if (total < MIN_COLUMN_VOTES || count / total < MIN_COLUMN_SHARE) {
      throw new Error(`CME metals bulletin ${FIGURE_COLUMNS[column]} column could not be located from its contract-month rows ` +
        `(${count} of ${total} agreeing)`);
    }
    return edge;
  });
  if (!(edges[0] < edges[1] && edges[1] < edges[2])) {
    throw new Error(`CME metals bulletin figure columns do not run left to right (${edges.join(", ")})`);
  }
  return edges as [number, number, number];
}

/**
 * The open interest of the TOTAL GC FUT row, read by where its figures sit. Rebuilt text keeps the order of the columns
 * but not which column a figure is in, and a total row leaves an empty column blank (as "TOTAL 1OZ FUT 66269 86609"
 * does for its PNT volume), so a row whose open interest column was empty read its Globex volume as the open interest.
 * Here every figure before the change must end within a unit of one of the three columns, each column at most once and
 * left to right, and the open interest is the figure in its column: none there refuses the bulletin. A total row whose
 * open interest did not change prints no change at all (as "TOTAL ALA FUT 2315"), which is read as such. After the
 * change, a word ends the row and another figure or change refuses it.
 */
function placedOpenInterest(layout: PdfLayout): number {
  const edges = figureColumnEdges(layout);
  for (const line of layout.flat()) {
    const words = lineWords(line);
    const label = words.findIndex((word, index) => word.str === "TOTAL" && words[index + 1]?.str === "GC" && words[index + 2]?.str === "FUT");
    if (label < 0) continue;
    const fields = words.slice(label + 3);
    let lastColumn = -1;
    let openInterest: number | null = null;
    let changed = false;
    for (let index = 0; index < fields.length; index += 1) {
      const { str, right } = fields[index];
      const number = WHOLE_NUMBER.test(str);
      const dashes = /^-{2,}$/.test(str);
      const separateSign = (str === "+" || str === "-") && WHOLE_NUMBER.test(fields[index + 1]?.str ?? "");
      const change = str === "UNCH" || str === "NEW" || (/^[+-]/.test(str) && WHOLE_NUMBER.test(str.slice(1))) || separateSign;
      if (changed) {
        if (number || change) throw new Error("CME TOTAL GC FUT row has a number after its open interest change, so its fields cannot be told apart");
        break;
      }
      if (number || dashes) {
        const column = right === null ? -1 : edges.findIndex((edge) => Math.abs(right - edge) <= PLACEMENT_TOLERANCE);
        if (column < 0) throw new Error(`CME TOTAL GC FUT figure ${str} is in none of the bulletin's figure columns (ending at ${edges.join(", ")})`);
        if (column <= lastColumn) throw new Error(`CME TOTAL GC FUT figure ${str} repeats or reverses its ${FIGURE_COLUMNS[column]} column`);
        lastColumn = column;
        if (column === FIGURE_COLUMNS.length - 1 && number) openInterest = Number(str.replace(/,/g, ""));
        continue;
      }
      if (!change) throw new Error(`CME TOTAL GC FUT row has ${JSON.stringify(str)} before its open interest change, so its fields cannot be told apart`);
      changed = true;
      if (separateSign) index += 1;
    }
    if (openInterest === null) {
      throw new Error("CME TOTAL GC FUT open interest column is empty, so the row's figures are only volumes");
    }
    return openInterest;
  }
  throw new Error("CME TOTAL GC FUT row was not found on one line of the bulletin");
}

/**
 * A piece of PDF text with its position on the page as shown: x from the left, y from the top, and its width, in PDF
 * units.
 */
export type PositionedText = { str: string; x: number; y: number; height: number; width?: number };

/**
 * A page's text as lines in reading order, top to bottom and each left to right. pdf.js returns pieces in the order the
 * PDF draws them, which need not be the order of the columns, so a row is rebuilt from where its pieces sit: sorted by
 * height on the page, a piece within 40% of the taller text height of the one above it continues its line, so a sign
 * or a figure set slightly off the baseline stays in its row.
 */
export function pdfLines(items: PositionedText[]): PdfLine[] {
  const lines: PositionedText[][] = [];
  const sorted = items.filter((item) => item.str.trim() !== "").sort((left, right) => left.y - right.y || left.x - right.x);
  let previous: PositionedText | undefined;
  for (const item of sorted) {
    if (previous !== undefined && item.y - previous.y <= Math.max(1, Math.max(item.height, previous.height) * 0.4)) {
      lines[lines.length - 1].push(item);
    } else {
      lines.push([item]);
    }
    previous = item;
  }
  return lines.map((line) => {
    const pieces = line.sort((left, right) => left.x - right.x)
      .map((item) => ({ str: item.str.trim(), x: item.x, right: item.width === undefined ? null : item.x + item.width }));
    return { text: pieces.map((piece) => piece.str).join(" "), pieces };
  });
}

/** The text of pdfLines. */
export function pdfTextLines(items: PositionedText[]): string[] {
  return pdfLines(items).map((line) => line.text);
}

/**
 * The positions of a page's upright text as it is shown, after the page's /Rotate and coordinate flips (the viewport
 * transform): a landscape bulletin made as a rotated portrait page keeps its rows. Text that is not upright on the
 * shown page, such as a rotated stamp, is left out.
 */
function shownText(
  items: Array<{ str: string; transform: number[]; height: number; width: number }>,
  viewport: number[],
  multiply: (left: number[], right: number[]) => number[],
): PositionedText[] {
  return items.flatMap((item) => {
    const [a, b, , d, x, y] = multiply(viewport, item.transform);
    const upright = a > 0 && d < 0 && Math.abs(b) <= Math.abs(a) * 0.05;
    return upright ? [{ str: item.str, x, y, height: item.height, width: item.width }] : [];
  });
}

const BULLETIN_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/gi;
const BULLETIN_NUMBER = /\bBULLETIN\s*#\s*(\d+)/gi;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** A three-letter English name as the bulletin writes it, whatever its case. */
const titleCase = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

/** A matched bulletin date as YYYY-MM-DD, refused when it is no calendar date or its weekday is not that date's. */
const asCalendarDate = (match: RegExpMatchArray): string => {
  const weekday = titleCase(match[1]);
  const month = MONTHS[titleCase(match[2])];
  const day = Number(match[3]);
  const year = Number(match[4]);
  const date = new Date(Date.UTC(year, month, day));
  if (!Number.isInteger(month) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new Error("CME bulletin has an invalid trade date");
  }
  if (WEEKDAYS[date.getUTCDay()] !== weekday) throw new Error(`CME bulletin date ${match[0]} names the wrong weekday`);
  return date.toISOString().slice(0, 10);
};

/**
 * The BULLETIN # headers on some lines: each header's number, and the date after it on its line up to the next header.
 * Numbers need their "#" and are read on the header's own line, so neither a figure that follows on the next line nor
 * one after a bare BULLETIN is taken for one; a date before the header (a print date, say) is not its date, and a
 * header showing two different dates is refused.
 */
function bulletinHeaders(lines: string[]): Array<{ number: number; date: string | null }> {
  return lines.flatMap((line) => {
    const matches = [...line.matchAll(BULLETIN_NUMBER)];
    return matches.map((match, index) => {
      const segment = line.slice(match.index, matches[index + 1]?.index ?? line.length);
      const dates = new Set([...segment.matchAll(BULLETIN_DATE)].map(asCalendarDate));
      if (dates.size > 1) throw new Error(`CME metals bulletin header shows more than one date (${[...dates].join(", ")})`);
      return { number: Number(match[1]), date: [...dates][0] ?? null };
    });
  });
}

/**
 * The bulletin's number and trade date from its BULLETIN # headers. Every header must agree on the number and, where it
 * carries one, the date (a header repeated as it stands is fine); a disagreement is refused rather than resolved by
 * taking the first. Given the bulletin's pages, each page of the table must carry exactly one header, and it must be
 * dated, so a page whose header is split or missing is refused too. The date is the headers' own, or, when no header carries one, the
 * one date the bulletin shows; another date elsewhere (such as a print date above the header) is not the trade date.
 */
function bulletinHeader(lines: string[], normalized: string, pages?: string[][]): { number: number; date: string } {
  const headers = bulletinHeaders(lines);
  if (pages !== undefined) {
    pages.forEach((page, index) => {
      // A page of the table, holding contract-month or total rows, carries the header; another, such as an appended
      // blank or a page of notes, need not.
      if (!page.some((line) => MONTH_ROW.test(line) || /\bTOTAL\s+\S+\s+FUT\b/.test(line))) return;
      const own = bulletinHeaders(page);
      if (own.length !== 1 || own[0].date === null) {
        throw new Error(`CME metals bulletin page ${index + 1} has ${own.length === 1 ? "an undated" : own.length} BULLETIN # header${own.length === 1 ? "" : "s"}; expected one, dated`);
      }
    });
  }
  const numbers = new Set(headers.map((header) => header.number));
  if (numbers.size === 0) throw new Error("CME metals bulletin number or trade date was not found");
  if (numbers.size > 1) throw new Error(`CME metals bulletin headers disagree on its number (${[...numbers].join(", ")})`);
  const headerDates = new Set(headers.flatMap((header) => header.date === null ? [] : [header.date]));
  if (headerDates.size > 1) throw new Error(`CME metals bulletin headers disagree on its date (${[...headerDates].join(", ")})`);
  const dates = headerDates.size > 0 ? headerDates : new Set([...normalized.matchAll(BULLETIN_DATE)].map(asCalendarDate));
  if (dates.size === 0) throw new Error("CME metals bulletin number or trade date was not found");
  if (dates.size > 1) throw new Error("CME metals bulletin shows more than one date and none on its BULLETIN # line");
  return { number: [...numbers][0], date: [...dates][0] };
}

/**
 * Parse only the unambiguous aggregate GC futures row, never a contract-month row or options total. Given the
 * bulletin's lines with their positions (the client's default, and used whenever given), the open interest must sit in
 * its column; given text alone, which cannot show that, the row must show all three columns (volumes as figures or
 * dashes), which a real total row leaving a column blank does not.
 */
export function parseCmeGoldOpenInterestBulletin(input: {
  text?: string;
  layout?: PdfLayout;
  sourceUrl: string;
  observedAt: string;
}): CmeGoldOpenInterest {
  const pages = input.layout?.map((page) => page.map((line) => line.text.replace(/\u00a0/g, " ")));
  const source = pages?.map((page) => page.join("\n")).join("\n") ?? input.text;
  if (source === undefined) throw new Error("CME bulletin text or layout is required");
  const text = source.replace(/\u00a0/g, " ");
  const normalized = text.replace(/\s+/g, " ").trim();
  const header = bulletinHeader(text.split(/\r?\n/), normalized, pages);
  const bulletinNumber = header.number;
  const statusMatches = [...normalized.matchAll(/\b(PRELIMINARY|FINAL)\b/g)].map((match) => match[1].toLowerCase());
  const reportStatus = statusMatches.includes("final") ? "final" : statusMatches.includes("preliminary") ? "preliminary" : null;
  if (reportStatus === null) throw new Error("CME metals bulletin report status was not found");
  const totalLabels = [...text.matchAll(/\bTOTAL\s+GC\s+FUT\b/g)];
  if (totalLabels.length !== 1) throw new Error(`expected one TOTAL GC FUT row, found ${totalLabels.length}`);
  // The Bulletin row exposes Globex volume, PNT volume, total OI, then OI change. The extractor puts each row on its
  // own line in the order of its columns on the page (pdfLines), so the row is the rest of the label's line.
  let openInterest: number;
  if (input.layout !== undefined) {
    openInterest = placedOpenInterest(input.layout);
  } else {
    const totalRow = text.slice(totalLabels[0].index + totalLabels[0][0].length).split(/\r?\n/)[0].trim();
    const read = totalOpenInterest(totalRow.split(/\s+/));
    if (read.columns !== 3) {
      throw new Error(`CME TOTAL GC FUT row shows ${read.columns} of its 3 columns, and text without positions cannot show which is the open interest`);
    }
    openInterest = read.value;
  }
  if (!Number.isSafeInteger(openInterest) || openInterest < MINIMUM_GC_TOTAL_OPEN_INTEREST) {
    throw new Error("CME TOTAL GC FUT open interest is implausibly small");
  }
  const observed = new Date(input.observedAt);
  if (!Number.isFinite(observed.getTime())) throw new Error("CME bulletin observed_at must be a valid timestamp");
  return {
    schema_version: "1.0",
    status: "complete",
    observation_date: header.date,
    open_interest: openInterest,
    report_status: reportStatus,
    bulletin_number: bulletinNumber,
    source: "cme_daily_bulletin",
    source_detail: "GC_FUT",
    source_url: input.sourceUrl,
    observed_at: observed.toISOString(),
  };
}

/** The text of extractPdfLayoutWithPdfJs: each page's lines, joined. */
export async function extractPdfTextWithPdfJs(data: Uint8Array): Promise<string> {
  return (await extractPdfLayoutWithPdfJs(data)).map((page) => page.map((line) => line.text).join("\n")).join("\n");
}

export async function extractPdfLayoutWithPdfJs(data: Uint8Array): Promise<PdfLayout> {
  const { getDocument, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data });
  try {
    const pdf = await task.promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      // pdf.js returns text in the order the PDF draws it, which differs from the order of the columns: on the bulletin of
      // 2026-10-02 the Globex volume came before the TOTAL label and the change's sign after its figure. Rebuild each row
      // from the pieces' positions on the shown page, so the TOTAL GC FUT figures read left to right; the label's three
      // pieces sit 1.5 units off the figures' baseline, well inside a line's room.
      const viewport = page.getViewport({ scale: 1 }).transform;
      const texts = content.items.flatMap((item) => "str" in item ? [item] : []);
      return pdfLines(shownText(texts, viewport, (left, right) => Util.transform(left, right)));
    }));
    return pages;
  } finally {
    await task.destroy();
  }
}

export class CmeDailyBulletinClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly extractPdf: PdfTextExtractor = extractPdfLayoutWithPdfJs,
    private readonly now: () => Date = () => new Date(),
    private readonly sourceUrl = CURRENT_METALS_BULLETIN_URL,
  ) {}

  async getLatestGoldOpenInterest(): Promise<CmeGoldOpenInterest> {
    const response = await this.fetchImpl(this.sourceUrl, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    if (!response.ok) throw new Error(`CME metals bulletin request failed with HTTP ${response.status}`);
    assertExpectedResponseHost(response, this.sourceUrl, "CME metals bulletin");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/application\/pdf/i.test(contentType)) throw new Error("CME metals bulletin response was not a PDF");
    const extracted = await this.extractPdf(await readLimitedResponseBytes(response, MAX_BULLETIN_PDF_BYTES, "CME metals bulletin"));
    const observedAt = this.now().toISOString();
    return parseCmeGoldOpenInterestBulletin(typeof extracted === "string"
      ? { text: extracted, sourceUrl: this.sourceUrl, observedAt }
      : { layout: extracted, sourceUrl: this.sourceUrl, observedAt });
  }
}
