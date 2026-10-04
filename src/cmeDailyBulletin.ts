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
 * UNCH. The open interest is the last unsigned number before the change, or the last one when the change column is
 * empty. The row ends at the change or at the first word. Taking the largest number returned a volume above the open
 * interest, and an earlier reading took the change itself, so a row without this shape (a number after the change,
 * more than three unsigned numbers, or none) is refused rather than guessed.
 */
function totalOpenInterest(fields: string[]): number {
  const unsigned: number[] = [];
  let changed = false;
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    const number = WHOLE_NUMBER.test(field);
    const separateSign = (field === "+" || field === "-") && WHOLE_NUMBER.test(fields[index + 1] ?? "");
    const change = field === "UNCH" || (/^[+-]/.test(field) && WHOLE_NUMBER.test(field.slice(1))) || separateSign;
    if (changed && (number || change)) {
      throw new Error("CME TOTAL GC FUT row has a number after its open interest change, so its fields cannot be told apart");
    }
    if (number) {
      unsigned.push(Number(field.replace(/,/g, "")));
      continue;
    }
    if (!change) break;
    changed = true;
    if (separateSign) index += 1;
  }
  if (unsigned.length === 0 || unsigned.length > 3) {
    throw new Error(`CME TOTAL GC FUT row has ${unsigned.length} unsigned numbers before its open interest change; expected the open interest after at most two volumes`);
  }
  return unsigned[unsigned.length - 1];
}

/** A piece of PDF text with its position: x from the left, y from the bottom of the page, in PDF units. */
export type PositionedText = { str: string; x: number; y: number; height: number };

/**
 * A page's text as lines in reading order: pieces on one baseline (within 40% of the smaller text height) form a line,
 * read left to right, and lines run top to bottom. pdf.js returns pieces in the order the PDF draws them, which need
 * not be the order of the columns, so a row is rebuilt from where its pieces sit on the page.
 */
export function pdfTextLines(items: PositionedText[]): string[] {
  const lines: PositionedText[][] = [];
  const sorted = items.filter((item) => item.str.trim() !== "").sort((left, right) => right.y - left.y || left.x - right.x);
  for (const item of sorted) {
    const line = lines[lines.length - 1];
    const tolerance = line === undefined ? 0 : Math.max(1, Math.min(item.height, line[0].height) * 0.4);
    if (line !== undefined && Math.abs(line[0].y - item.y) <= tolerance) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((left, right) => left.x - right.x).map((item) => item.str.trim()).join(" "));
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
  const dates = [...normalized.matchAll(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(\d{4})\b/gi)];
  const bulletinNumber = bulletinNumbers[0];
  const date = dates[0];
  if (!Number.isSafeInteger(bulletinNumber) || dates.length === 0 || date === undefined) {
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
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = getDocument({ data });
  try {
    const pdf = await task.promise;
    const pages = await Promise.all(Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      // pdf.js returns text in the order the PDF draws it, which can differ from the order of the columns. Rebuild each
      // row from the pieces' positions, so the TOTAL GC FUT numbers read left to right; the printed TOTAL label is one
      // contiguous text run, so it stays searchable.
      return pdfTextLines(content.items.flatMap((item) => "str" in item
        ? [{ str: item.str, x: item.transform[4], y: item.transform[5], height: item.height }]
        : [])).join("\n");
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
