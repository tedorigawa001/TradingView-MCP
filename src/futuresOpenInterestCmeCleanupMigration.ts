import type { FuturesOpenInterestFirstSeenStore, FuturesOpenInterestRecord } from "./futuresOpenInterestHistory.js";

const isMalformedCmeGoldRecord = (record: FuturesOpenInterestRecord): boolean =>
  record.source === "cme_daily_bulletin" &&
  record.source_detail === "GC_FUT" &&
  record.observation_date === "2026-07-24" &&
  record.open_interest === 12_136;

/**
 * Replays v2 into v3 while omitting the single known parser defect. The original append-only log
 * remains untouched for audit, while v3 never claims that the OI change was an observed OI level.
 */
export async function migrateFuturesOpenInterestCmeCleanup(input: {
  source: Pick<FuturesOpenInterestFirstSeenStore, "records">;
  destination: Pick<FuturesOpenInterestFirstSeenStore, "observeMany" | "records">;
}): Promise<{ source_records: number; migrated: number; unchanged: number; revisions: number; discarded_malformed_cme_records: number }> {
  const records = await input.source.records();
  const destinationRecords = await input.destination.records();
  let migrated = 0;
  let unchanged = 0;
  let revisions = 0;
  let discarded = 0;
  for (const record of records) {
    if (isMalformedCmeGoldRecord(record)) {
      discarded += 1;
      continue;
    }
    if (destinationRecords.some((candidate) =>
      candidate.futures_symbol === record.futures_symbol &&
      candidate.scope === record.scope &&
      candidate.source === record.source &&
      candidate.source_detail === record.source_detail &&
      candidate.observation_date === record.observation_date &&
      candidate.open_interest === record.open_interest &&
      candidate.first_seen_at === record.first_seen_at)) {
      unchanged += 1;
      continue;
    }
    const result = await input.destination.observeMany([{
      futures_symbol: record.futures_symbol,
      scope: record.scope,
      observation_date: record.observation_date,
      open_interest: record.open_interest,
      source: record.source,
      source_detail: record.source_detail,
      observed_at: record.first_seen_at,
    }]);
    migrated += result.recorded.length;
    unchanged += result.unchanged;
    revisions += result.revisions;
    destinationRecords.push(...result.recorded);
  }
  return { source_records: records.length, migrated, unchanged, revisions, discarded_malformed_cme_records: discarded };
}
