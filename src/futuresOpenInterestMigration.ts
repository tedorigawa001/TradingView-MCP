import type { FuturesOpenInterestFirstSeenStore } from "./futuresOpenInterestHistory.js";

const nextCalendarDate = (value: string): string => {
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time)) throw new Error("legacy futures OI observation_date is invalid");
  return new Date(time + 86_400_000).toISOString().slice(0, 10);
};

/**
 * Replays the original v1 log into a new v2 file with the exchange trading date. The v1 file is
 * retained unchanged as an audit trail; every original first-seen timestamp and revision ordering
 * is preserved in v2.
 */
export async function migrateFuturesOpenInterestDates(input: {
  source: Pick<FuturesOpenInterestFirstSeenStore, "records">;
  destination: Pick<FuturesOpenInterestFirstSeenStore, "observeMany" | "records">;
}): Promise<{ source_records: number; migrated: number; unchanged: number; revisions: number }> {
  const records = await input.source.records();
  const destinationRecords = await input.destination.records();
  let migrated = 0;
  let unchanged = 0;
  let revisions = 0;
  for (const record of records) {
    const observationDate = nextCalendarDate(record.observation_date);
    // The destination store protects its first-seen clock from moving backwards. A rerun reaches
    // older original versions after a later revision, so recognise an already migrated version
    // before asking the store to append it again.
    if (destinationRecords.some((candidate) =>
      candidate.futures_symbol === record.futures_symbol &&
      candidate.scope === record.scope &&
      candidate.observation_date === observationDate &&
      candidate.open_interest === record.open_interest &&
      candidate.first_seen_at === record.first_seen_at)) {
      unchanged += 1;
      continue;
    }
    const result = await input.destination.observeMany([{
      futures_symbol: record.futures_symbol,
      scope: record.scope,
      observation_date: observationDate,
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
  return { source_records: records.length, migrated, unchanged, revisions };
}
