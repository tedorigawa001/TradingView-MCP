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
export type PdfLine = { text: string; pieces: Array<{ str: string; x: number; right: number }> };

/** A PDF's pages as rebuilt lines. */
export type PdfLayout = PdfLine[][];

/** The bulletin's text, or its lines with their positions; only the latter can place a figure in its column. */
export type PdfTextExtractor = (data: Uint8Array) => Promise<string | PdfLayout>;

/** An unsigned whole number, with or without thousands separators. */
const WHOLE_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

/**
 * The open interest of the TOTAL GC FUT row, read by the meaning of its fields (BACKLOG 102-03): the Globex and PNT
 * volumes, the open interest, then its change. A column without a figure prints a run of dashes ("----", as on the
 * bulletin's contract-month rows) or may be left out, and the change carries a sign ("+ 1442", "-120") or reads UNCH
 * or NEW. The open interest is the last column before the change. Taking the largest number returned a volume above
 * the open interest, and an earlier reading took the change itself, so a row without this shape is refused rather than
 * guessed: anything else before the change ("376079*", "376079-", a decimal), no change, a number or a second change
 * after it, more than three columns, or an empty last column. A word after the change ends the row (text without line
 * breaks); otherwise the row is its line. Returns the figure, its field's index and how many columns came before the
 * change; whether that field really is in the open interest column is for the caller to show.
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

/**
 * Where the open interest column ends on a page: the bulletin right-aligns its figures, and on a contract-month row the
 * figure before the closing change is the open interest, so the commonest right edge of those figures (to half a unit)
 * marks the column. On the bulletin of 2026-10-02 they end at 558.1, as the TOTAL GC FUT open interest does, while its
 * Globex and PNT volumes end at 438.1 and 492.1.
 */
function openInterestColumnEdge(page: PdfLine[]): number | undefined {
  const votes = new Map<number, number>();
  for (const line of page) {
    const words = lineWords(line);
    if (!MONTH_CODE.test(words[0]?.str ?? "")) continue;
    const field = words[changeStart(words.map((word) => word.str)) - 1];
    if (field === undefined || field.right === null || !WHOLE_NUMBER.test(field.str)) continue;
    const edge = Math.round(field.right * 2) / 2;
    votes.set(edge, (votes.get(edge) ?? 0) + 1);
  }
  return [...votes.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];
}

/**
 * The open interest of the TOTAL GC FUT row, shown to sit in the open interest column. Rebuilt text keeps the order of
 * the columns but not which column a figure is in, so a row whose open interest column was empty read its volume as
 * the open interest; here the figure must end where the page's contract-month rows end theirs, within a unit.
 */
function placedOpenInterest(layout: PdfLayout): number {
  for (const page of layout) {
    for (const line of page) {
      const words = lineWords(line);
      const label = words.findIndex((word, index) => word.str === "TOTAL" && words[index + 1]?.str === "GC" && words[index + 2]?.str === "FUT");
      if (label < 0) continue;
      const fields = words.slice(label + 3);
      const { value, index } = totalOpenInterest(fields.map((field) => field.str));
      const edge = openInterestColumnEdge(page);
      if (edge === undefined) {
        throw new Error("CME metals bulletin open interest column could not be located from its contract-month rows");
      }
      const right = fields[index].right;
      if (right === null || Math.abs(right - edge) > 1) {
        throw new Error(`CME TOTAL GC FUT figure ${value} is not in the open interest column (ending at ${edge}), so it may be a volume`);
      }
      return value;
    }
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
      .map((item) => ({ str: item.str.trim(), x: item.x, right: item.x + (item.width ?? 0) }));
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
const BULLETIN_NUMBER = /\bBULLETIN\s*#\s*(\d+)/i;

/**
 * The bulletin's number and trade date from its BULLETIN # headers, one on every page. A header repeated as it stands is
 * fine; headers that disagree on the number or the date are refused rather than resolved by taking the first. The date
 * is the headers' own, or, when no header carries one, the one date the bulletin shows; another date elsewhere (such as
 * a print date above the header) is not the trade date. Numbers are read on the header's line, so a figure that follows
 * on the next line is never taken for one.
 */
function bulletinHeader(lines: string[], normalized: string): { number: number; date: RegExpMatchArray } {
  const headers = lines.flatMap((line) => {
    const number = line.match(BULLETIN_NUMBER);
    return number === null ? [] : [{ number: Number(number[1]), date: line.match(new RegExp(BULLETIN_DATE.source, "i")) }];
  });
  const numbers = new Set(headers.map((header) => header.number));
  if (numbers.size === 0) throw new Error("CME metals bulletin number or trade date was not found");
  if (numbers.size > 1) throw new Error(`CME metals bulletin headers disagree on its number (${[...numbers].join(", ")})`);
  const key = (date: RegExpMatchArray) => date.slice(1, 5).join(" ").toLowerCase();
  const headerDates = headers.flatMap((header) => header.date === null ? [] : [header.date]);
  if (new Set(headerDates.map(key)).size > 1) {
    throw new Error(`CME metals bulletin headers disagree on its date (${[...new Set(headerDates.map((date) => date[0]))].join(", ")})`);
  }
  const dates = headerDates.length > 0 ? headerDates : [...normalized.matchAll(BULLETIN_DATE)];
  if (dates.length === 0) throw new Error("CME metals bulletin number or trade date was not found");
  if (new Set(dates.map(key)).size > 1) throw new Error("CME metals bulletin shows more than one date and none on its BULLETIN # line");
  return { number: [...numbers][0], date: dates[0] };
}

const asCalendarDate = (weekday: string, monthName: string, dayText: string, yearText: string): string => {
  if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/.test(weekday)) throw new Error("CME bulletin has an invalid weekday");
  const month = MONTHS[monthName];
  const day = Number(dayText);
  const year = Number(yearText);
  const date = new Date(Date.UTC(year, month, day));
  if (!Number.isInteger(month) || date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) {
    throw new Error("CME bulletin has an invalid trade date");
  }
  return date.toISOString().slice(0, 10);
};

/**
 * Parse only the unambiguous aggregate GC futures row, never a contract-month row or options total. Given the
 * bulletin's lines with their positions (the client's default), the open interest must sit in the open interest column;
 * given text alone, which cannot show that, the row must show all three columns (volumes as figures or dashes).
 */
export function parseCmeGoldOpenInterestBulletin(input: {
  text?: string;
  layout?: PdfLayout;
  sourceUrl: string;
  observedAt: string;
}): CmeGoldOpenInterest {
  const source = input.text ?? input.layout?.map((page) => page.map((line) => line.text).join("\n")).join("\n");
  if (source === undefined) throw new Error("CME bulletin text or layout is required");
  const text = source.replace(/\u00a0/g, " ");
  const normalized = text.replace(/\s+/g, " ").trim();
  const header = bulletinHeader(text.split(/\r?\n/), normalized);
  const date = header.date;
  const bulletinNumber = header.number;
  const statusMatches = [...normalized.matchAll(/\b(PRELIMINARY|FINAL)\b/g)].map((match) => match[1].toLowerCase());
  const reportStatus = statusMatches.includes("final") ? "final" : statusMatches.includes("preliminary") ? "preliminary" : null;
  if (reportStatus === null) throw new Error("CME metals bulletin report status was not found");
  const totalLabels = [...text.matchAll(/\bTOTAL\s+GC\s+FUT\b/g)];
  if (totalLabels.length !== 1) throw new Error(`expected one TOTAL GC FUT row, found ${totalLabels.length}`);
  // The Bulletin row exposes Globex volume, PNT volume, total OI, then OI change. The extractor puts each row on its
  // own line in the order of its columns on the page (pdfLines), so the row is the rest of the label's line.
  let openInterest: number;
  if (input.text === undefined && input.layout !== undefined) {
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
    observation_date: asCalendarDate(date[1], date[2], date[3], date[4]),
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
    private readonly extractPdfText: PdfTextExtractor = extractPdfLayoutWithPdfJs,
    private readonly now: () => Date = () => new Date(),
    private readonly sourceUrl = CURRENT_METALS_BULLETIN_URL,
  ) {}

  async getLatestGoldOpenInterest(): Promise<CmeGoldOpenInterest> {
    const response = await this.fetchImpl(this.sourceUrl, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    if (!response.ok) throw new Error(`CME metals bulletin request failed with HTTP ${response.status}`);
    assertExpectedResponseHost(response, this.sourceUrl, "CME metals bulletin");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/application\/pdf/i.test(contentType)) throw new Error("CME metals bulletin response was not a PDF");
    const extracted = await this.extractPdfText(await readLimitedResponseBytes(response, MAX_BULLETIN_PDF_BYTES, "CME metals bulletin"));
    const observedAt = this.now().toISOString();
    return parseCmeGoldOpenInterestBulletin(typeof extracted === "string"
      ? { text: extracted, sourceUrl: this.sourceUrl, observedAt }
      : { layout: extracted, sourceUrl: this.sourceUrl, observedAt });
  }
}
