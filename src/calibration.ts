export function binaryCalibration(rows: Array<{ probability: number; outcome: boolean }>, bins = 10) {
  if (!Number.isInteger(bins) || bins < 2 || bins > 50 || rows.length === 0) throw new Error("rows and bins are invalid");
  const buckets = Array.from({ length: bins }, () => ({ count: 0, probability_sum: 0, outcome_sum: 0 }));
  let brier = 0;
  for (const row of rows) {
    if (!Number.isFinite(row.probability) || row.probability < 0 || row.probability > 1) throw new Error("probability must be in [0,1]");
    const index = Math.min(bins - 1, Math.floor(row.probability * bins));
    const bucket = buckets[index]; bucket.count += 1; bucket.probability_sum += row.probability; bucket.outcome_sum += Number(row.outcome);
    brier += (row.probability - Number(row.outcome)) ** 2;
  }
  return { count: rows.length, brier_score: brier / rows.length, bins: buckets.map((b, index) => ({ index, count: b.count, mean_probability: b.count ? b.probability_sum / b.count : null, observed_rate: b.count ? b.outcome_sum / b.count : null })) };
}
