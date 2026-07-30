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
  const normalized = input.text.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
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
  const totalLabels = [...normalized.matchAll(/\bTOTAL\s+GC\s+FUT\b/g)];
  if (totalLabels.length !== 1) throw new Error(`expected one TOTAL GC FUT row, found ${totalLabels.length}`);
  // Empty volume columns disappear from pdf.js text output, so this cannot assume a fixed field
  // count. The following 120 characters cover this one compact total row but not a later product.
  const totalRow = normalized.slice(totalLabels[0].index, totalLabels[0].index + 120);
  const aggregateFields = [...totalRow.matchAll(/[+-]?\s*\d[\d,]*/g)]
    .map((match) => Number(match[0].replace(/[\s,+-]/g, "")));
  // The Bulletin row exposes Globex volume, PNT volume, total OI, then OI change. pdf.js can
  // reorder these numeric items, but total OI is the largest non-negative aggregate in this row;
  // selecting it avoids confusing a small signed daily change with the stock of open contracts.
  const openInterest = Math.max(...aggregateFields);
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
      // The Bulletin's printed TOTAL label is emitted as one contiguous text run. Keep pdf.js's
      // content order so that label remains searchable; parseCmeGoldOpenInterestBulletin handles
      // the numerically reordered columns explicitly.
      return content.items.map((item) => "str" in item ? item.str : "").join(" ");
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
