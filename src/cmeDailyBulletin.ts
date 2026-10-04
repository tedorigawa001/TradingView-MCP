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

export type PdfTextExtractor = (data: Uint8Array) => Promise<string>;

/** An unsigned whole number, with or without thousands separators. */
const WHOLE_NUMBER = /^(?:\d{1,3}(?:,\d{3})+|\d+)$/;

/**
 * The open interest of the TOTAL GC FUT row, read by the meaning of its fields (BACKLOG 102-03): up to two volume
 * columns (either may be empty), the open interest, then its change, which carries a sign ("+ 120", "-120") or reads
 * UNCH, NEW or a run of dashes. The open interest is the last unsigned number before the change. Taking the largest
 * number returned a volume above the open interest, and an earlier reading took the change itself, so a row without
 * this shape is refused rather than guessed: anything else before the change ("376079*", "376079-", a decimal), no
 * change, a number or a second change after it, or no or more than three unsigned numbers. A word after the change ends
 * the row (text without line breaks); otherwise the row is its line.
 */
function totalOpenInterest(fields: string[]): number {
  const unsigned: number[] = [];
  let changed = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const number = WHOLE_NUMBER.test(field);
    const separateSign = (field === "+" || field === "-") && WHOLE_NUMBER.test(fields[index + 1] ?? "");
    const change = field === "UNCH" || field === "NEW" || /^-{2,}$/.test(field) ||
      (/^[+-]/.test(field) && WHOLE_NUMBER.test(field.slice(1))) || separateSign;
    if (changed) {
      if (number || change) {
        throw new Error("CME TOTAL GC FUT row has a number after its open interest change, so its fields cannot be told apart");
      }
      break;
    }
    if (number) {
      unsigned.push(Number(field.replace(/,/g, "")));
      continue;
    }
    if (!change) {
      throw new Error(`CME TOTAL GC FUT row has ${JSON.stringify(field)} before its open interest change, so its fields cannot be told apart`);
    }
    changed = true;
    if (separateSign) index += 1;
  }
  if (!changed) throw new Error("CME TOTAL GC FUT row has no open interest change, so its open interest cannot be told from a volume");
  if (unsigned.length === 0 || unsigned.length > 3) {
    throw new Error(`CME TOTAL GC FUT row has ${unsigned.length} unsigned numbers before its open interest change; expected the open interest after at most two volumes`);
  }
  return unsigned[unsigned.length - 1];
}

/** A piece of PDF text with its position on the page as shown: x from the left, y from the top, in PDF units. */
export type PositionedText = { str: string; x: number; y: number; height: number };

/**
 * A page's text as lines in reading order, top to bottom and each left to right. pdf.js returns pieces in the order the
 * PDF draws them, which need not be the order of the columns, so a row is rebuilt from where its pieces sit: sorted by
 * height on the page, a piece within 40% of the taller text height of the one above it continues its line, so a sign
 * or a figure set slightly off the baseline stays in its row.
 */
export function pdfTextLines(items: PositionedText[]): string[] {
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
  return lines.map((line) => line.sort((left, right) => left.x - right.x).map((item) => item.str.trim()).join(" "));
}

/**
 * The positions of a page's upright text as it is shown, after the page's /Rotate and coordinate flips (the viewport
 * transform): a landscape bulletin made as a rotated portrait page keeps its rows. Text that is not upright on the
 * shown page, such as a rotated stamp, is left out.
 */
function shownText(
  items: Array<{ str: string; transform: number[]; height: number }>,
  viewport: number[],
  multiply: (left: number[], right: number[]) => number[],
): PositionedText[] {
  return items.flatMap((item) => {
    const [a, b, , d, x, y] = multiply(viewport, item.transform);
    const upright = a > 0 && d < 0 && Math.abs(b) <= Math.abs(a) * 0.05;
    return upright ? [{ str: item.str, x, y, height: item.height }] : [];
  });
}

const BULLETIN_DATE = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/gi;

/**
 * The bulletin's trade date: the one date it shows, or, when it shows several, the one on its BULLETIN # line. Lines
 * are in reading order now, so the first date found need not be the header's.
 */
function bulletinDate(text: string, normalized: string): RegExpMatchArray | undefined {
  const dates = [...normalized.matchAll(BULLETIN_DATE)];
  const distinct = new Set(dates.map((match) => match.slice(1, 5).join(" ").toLowerCase()));
  if (distinct.size <= 1) return dates[0];
  const header = text.split(/\r?\n/).find((line) => /\bBULLETIN\s*#?\s*\d+/i.test(line) && new RegExp(BULLETIN_DATE.source, "i").test(line));
  if (header === undefined) throw new Error("CME metals bulletin shows more than one date and none on its BULLETIN # line");
  return header.match(new RegExp(BULLETIN_DATE.source, "i")) ?? undefined;
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

/** Parse only the unambiguous aggregate GC futures row, never a contract-month row or options total. */
export function parseCmeGoldOpenInterestBulletin(input: { text: string; sourceUrl: string; observedAt: string }): CmeGoldOpenInterest {
  const text = input.text.replace(/\u00a0/g, " ");
  const normalized = text.replace(/\s+/g, " ").trim();
  // pdf.js may reorder text items in the printed header. The source URL is pinned to Section62,
  // so extract its Bulletin number and trade date independently rather than relying on adjacency.
  const bulletinNumbers = [...normalized.matchAll(/\bBULLETIN\s*#?\s*(\d+)@?/gi)].map((match) => Number(match[1]));
  const bulletinNumber = bulletinNumbers[0];
  const date = bulletinDate(text, normalized);
  if (!Number.isSafeInteger(bulletinNumber) || date === undefined) {
    throw new Error("CME metals bulletin number or trade date was not found");
  }
  const statusMatches = [...normalized.matchAll(/\b(PRELIMINARY|FINAL)\b/g)].map((match) => match[1].toLowerCase());
  const reportStatus = statusMatches.includes("final") ? "final" : statusMatches.includes("preliminary") ? "preliminary" : null;
  if (reportStatus === null) throw new Error("CME metals bulletin report status was not found");
  const totalLabels = [...text.matchAll(/\bTOTAL\s+GC\s+FUT\b/g)];
  if (totalLabels.length !== 1) throw new Error(`expected one TOTAL GC FUT row, found ${totalLabels.length}`);
  // The Bulletin row exposes Globex volume, PNT volume, total OI, then OI change. The extractor puts each row on its
  // own line in the order of its columns on the page (pdfTextLines), so the row is the rest of the label's line. Empty
  // volume columns leave no text, so the field count is not fixed.
  const totalRow = text.slice(totalLabels[0].index + totalLabels[0][0].length).split(/\r?\n/)[0].trim();
  const openInterest = totalOpenInterest(totalRow.split(/\s+/));
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

export async function extractPdfTextWithPdfJs(data: Uint8Array): Promise<string> {
  const { getDocument, Util } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data });
  try {
    const pdf = await task.promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      // pdf.js returns text in the order the PDF draws it, which can differ from the order of the columns. Rebuild each
      // row from the pieces' positions on the shown page, so the TOTAL GC FUT numbers read left to right; the printed
      // TOTAL label is one contiguous text run, so it stays searchable.
      const viewport = page.getViewport({ scale: 1 }).transform;
      const texts = content.items.flatMap((item) => "str" in item ? [item] : []);
      return pdfTextLines(shownText(texts, viewport, (left, right) => Util.transform(left, right))).join("\n");
    }));
    return pages.join("\n");
  } finally {
    await task.destroy();
  }
}

export class CmeDailyBulletinClient {
  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly extractPdfText: PdfTextExtractor = extractPdfTextWithPdfJs,
    private readonly now: () => Date = () => new Date(),
    private readonly sourceUrl = CURRENT_METALS_BULLETIN_URL,
  ) {}

  async getLatestGoldOpenInterest(): Promise<CmeGoldOpenInterest> {
    const response = await this.fetchImpl(this.sourceUrl, { signal: AbortSignal.timeout(20_000), redirect: "manual" });
    if (!response.ok) throw new Error(`CME metals bulletin request failed with HTTP ${response.status}`);
    assertExpectedResponseHost(response, this.sourceUrl, "CME metals bulletin");
    const contentType = response.headers.get("content-type") ?? "";
    if (!/application\/pdf/i.test(contentType)) throw new Error("CME metals bulletin response was not a PDF");
    const text = await this.extractPdfText(await readLimitedResponseBytes(response, MAX_BULLETIN_PDF_BYTES, "CME metals bulletin"));
    return parseCmeGoldOpenInterestBulletin({ text, sourceUrl: this.sourceUrl, observedAt: this.now().toISOString() });
  }
}
