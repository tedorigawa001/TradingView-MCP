export type CotOpenInterestObservation = {
  report_date: string | null;
  open_interest: number | null;
};

export type OfficialOpenInterestObservation = {
  observation_date: string;
  open_interest: number;
  first_seen_at: string;
};

export type GoldOpenInterestReconciliation = {
  status: "complete" | "partial";
  comparisons: Array<{
    observation_date: string;
    cot_open_interest: number;
    cme_open_interest: number;
    difference_contracts: number;
    cme_minus_cot_percent: number;
    cme_first_seen_at: string;
  }>;
  unmatched_cot_dates: string[];
  excluded_cot_dates: string[];
  quality_issues: string[];
};

/**
 * COT and CME totals are both daily-labelled series, but their publication schedules differ.
 * A nearest-date join would silently substitute a different trading session, so this intentionally
 * emits evidence only when their calendar dates are identical.
 */
export const reconcileGoldOpenInterest = (
  cotObservations: CotOpenInterestObservation[],
  officialObservations: OfficialOpenInterestObservation[],
): GoldOpenInterestReconciliation => {
  const officialByDate = new Map(officialObservations.map((observation) => [
    observation.observation_date,
    observation,
  ]));
  const comparisons: GoldOpenInterestReconciliation["comparisons"] = [];
  const unmatchedCotDates: string[] = [];
  const excludedCotDates: string[] = [];

  for (const cot of cotObservations) {
    const observationDate = cot.report_date?.slice(0, 10);
    if (!observationDate || cot.open_interest === null || !Number.isFinite(cot.open_interest) || cot.open_interest <= 0) {
      if (observationDate) excludedCotDates.push(observationDate);
      continue;
    }
    const official = officialByDate.get(observationDate);
    if (!official) {
      unmatchedCotDates.push(observationDate);
      continue;
    }
    const difference = official.open_interest - cot.open_interest;
    comparisons.push({
      observation_date: observationDate,
      cot_open_interest: cot.open_interest,
      cme_open_interest: official.open_interest,
      difference_contracts: difference,
      cme_minus_cot_percent: (difference / cot.open_interest) * 100,
      cme_first_seen_at: official.first_seen_at,
    });
  }

  const qualityIssues: string[] = [];
  if (comparisons.length === 0) qualityIssues.push("no_same_day_cme_official_oi_collected");
  if (unmatchedCotDates.length > 0) qualityIssues.push("one_or_more_cot_report_dates_missing_same_day_cme_official_oi");
  if (excludedCotDates.length > 0) qualityIssues.push("one_or_more_cot_observations_missing_valid_open_interest");
  return {
    status: qualityIssues.length === 0 ? "complete" : "partial",
    comparisons,
    unmatched_cot_dates: unmatchedCotDates,
    excluded_cot_dates: excludedCotDates,
    quality_issues: qualityIssues,
  };
};
