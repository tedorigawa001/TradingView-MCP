import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { OhlcvBar } from "./tradingview.js";
import {
  computeFeatureOutcomeRelationships,
  FEATURE_OUTCOME_CALIBRATED_STUDY,
  FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS,
} from "./featureOutcomeRelationships.js";
import type { AggregatedBar, FxCsvM1AggregationResult } from "./fxCsvM1Aggregation.js";
import type { FxCsvM1AggregationManifest } from "./fxCsvM1AggregationCli.js";
import { canonicalDefinitionHash } from "./canonicalDefinition.js";

/**
 * The one configuration this scan is allowed to run. The candidate rule's false-positive rates and
 * its power across the 10bps floor were measured at exactly these thresholds, so a run at any other
 * setting would report candidateEligible with an error rate nobody has measured. Thresholds are not
 * arguments here for the same reason the minimum effect size is not: they are part of what was
 * pre-registered, and a scan that can be re-pointed is a scan that can be re-pointed until it hits.
 */
export const FX_CSV_FEATURE_SCAN_CONTRACT = {
  contractId: "fx_csv_feature_scan_calibrated_v1",
  ...FEATURE_OUTCOME_CALIBRATED_STUDY,
  configurationTrials: 1,
  minimumEffectBps: FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS,
} as const;

export type FxCsvFeatureScanCliArguments = { aggregatePath: string; outputPath: string };

export const resolveFxCsvScanDirectory = (configured = process.env.TRADINGVIEW_MCP_FX_CSV_SCAN_DIR) =>
  configured?.trim() || join(homedir(), ".tradingview-mcp", "fx-csv-feature-scans");

export function parseFxCsvFeatureScanCliArguments(argv: string[]): FxCsvFeatureScanCliArguments {
  let aggregatePath: string | undefined;
  let outputPath: string | undefined;
  let confirmed = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--aggregate") aggregatePath = argv[++index];
    else if (arg === "--out") outputPath = argv[++index];
    else if (arg === "--confirm-local-import") confirmed = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!confirmed) throw new Error("FX CSV feature scan requires --confirm-local-import");
  if (!aggregatePath) throw new Error("FX CSV feature scan requires --aggregate");
  return {
    aggregatePath,
    outputPath: outputPath ?? join(resolveFxCsvScanDirectory(), basename(aggregatePath).replace(/\.json$/, "_scan.json")),
  };
}

type BucketRow = {
  feature: string;
  bucket: string;
  observations: number;
  meanBps: number | null;
  twoSidedPValue: number | null;
  empiricalFamilyWisePValue: number | null;
  empiricalStatus: string | null;
  candidateEligible: boolean;
  exploratoryEligible: boolean;
  candidateBlockers: string[];
};

/**
 * A bar has to stand for at least half the interval it is stamped with. Gold's daily maintenance
 * break otherwise arrived as hourly bars built from a couple of stray prints, and the phantom gap
 * between them and real trading read as a +38bps reversion that cleared Newey-West, Bonferroni, the
 * empirical null and the effect floor. The rule itself cannot see this - an OHLC bar carries no
 * record of what it was made from - so the scan checks the provenance it was handed instead.
 */
export const FX_CSV_SCAN_MINIMUM_COVERAGE_FRACTION = 0.5;

/**
 * Checks the bars, not only the manifest's claim about them. A manifest states the coverage the
 * aggregation was asked for; it is not evidence that the bars beside it honour it, and the two live
 * in one file that can be partly edited or swapped for another. Verifying the label and trusting the
 * contents would leave the candidate path resting on exactly the sort of assertion it exists to
 * refuse, so every bar is checked against the manifest it arrived with.
 */
export function assertAdmissibleAggregate(
  manifest: FxCsvM1AggregationManifest,
  bars: AggregatedBar[],
): void {
  const bucket = manifest.bucket_minutes;
  const required = Math.ceil(bucket * FX_CSV_SCAN_MINIMUM_COVERAGE_FRACTION);
  // Bars sit on absolute UTC slots, which only tile a day when the bucket divides one. The same
  // condition the aggregation enforces, restated rather than assumed to have been enforced.
  if (!Number.isInteger(bucket) || bucket < 2 || bucket > 1440 || 1440 % bucket !== 0) {
    throw new Error(`aggregate declares an unusable bucket_minutes ${bucket}`);
  }
  if (manifest.minimum_minute_coverage < required) {
    throw new Error(
      `aggregate was built with minimum_minute_coverage ${manifest.minimum_minute_coverage}, but a ` +
      `${bucket}-minute bar must cover at least ${required} minutes to be scanned for ` +
      "candidates. Re-aggregate with --minimum-minute-coverage " + required + ".",
    );
  }
  if (bars.length !== manifest.bar_count) {
    throw new Error(`aggregate holds ${bars.length} bars but its manifest counts ${manifest.bar_count}`);
  }
  if (bars.length === 0) throw new Error("aggregate holds no bars");
  // The manifest's own digest of these bars, recomputed. Everything below this line establishes that
  // the bars satisfy the policy a scannable series must satisfy; this establishes that they are the
  // bars the manifest is describing at all, which no amount of well-formedness can substitute for.
  const digest = `sha256:${createHash("sha256").update(JSON.stringify(bars), "utf8").digest("hex")}`;
  if (digest !== manifest.normalized_sha256) {
    throw new Error(
      `aggregate bars hash to ${digest} but its manifest records ${manifest.normalized_sha256}; the file ` +
      "was edited or its two halves come from different runs",
    );
  }
  const bucketMs = bucket * 60_000;
  let previousMs = -Infinity;
  for (const bar of bars) {
    const timeMs = Date.parse(bar.timeIso);
    if (!Number.isFinite(timeMs)) throw new Error(`aggregate holds an unparseable bar timestamp ${bar.timeIso}`);
    if (timeMs <= previousMs) {
      throw new Error(`aggregate bars are not strictly increasing in time at ${bar.timeIso}`);
    }
    // An aggregate's bars sit on fixed wall-clock slots. One that does not is not a bucket.
    if (timeMs % bucketMs !== 0) {
      throw new Error(`aggregate bar ${bar.timeIso} is not aligned to a ${bucket}-minute bucket`);
    }
    if (!Number.isInteger(bar.minutesPresent) || bar.minutesPresent < required || bar.minutesPresent > bucket) {
      throw new Error(
        `aggregate bar ${bar.timeIso} reports ${bar.minutesPresent} of ${bucket} minutes, outside the ` +
        `${required} to ${bucket} a scannable bar must hold`,
      );
    }
    if (![bar.open, bar.high, bar.low, bar.close, bar.tickVolume].every(Number.isFinite) ||
        !(bar.low <= Math.min(bar.open, bar.close) && bar.high >= Math.max(bar.open, bar.close) && bar.high > 0)) {
      throw new Error(`aggregate bar ${bar.timeIso} is not a candle`);
    }
    previousMs = timeMs;
  }
  const first = bars[0].timeIso;
  const last = bars[bars.length - 1].timeIso;
  if (manifest.first_bar_at !== first || manifest.last_bar_at !== last) {
    throw new Error(
      `aggregate spans ${first} to ${last} but its manifest claims ${manifest.first_bar_at} to ${manifest.last_bar_at}`,
    );
  }
}

export function scanAggregatedBars(
  manifest: FxCsvM1AggregationManifest,
  aggregated: AggregatedBar[],
) {
  assertAdmissibleAggregate(manifest, aggregated);
  const bars: OhlcvBar[] = aggregated.map((bar) => ({
    time: Math.floor(Date.parse(bar.timeIso) / 1000),
    timeIso: bar.timeIso,
    open: bar.open, high: bar.high, low: bar.low, close: bar.close,
    volume: bar.tickVolume,
  }));
  const contract = FX_CSV_FEATURE_SCAN_CONTRACT;
  const result = computeFeatureOutcomeRelationships({
    bars,
    symbol: manifest.symbol,
    timeframe: String(manifest.bucket_minutes),
    features: [...contract.features],
    selection: null, signalFrom: null, signalTo: null,
    atrLookback: contract.atrLookback,
    atrBaselineLookback: contract.atrBaselineLookback,
    rangeLookback: contract.rangeLookback,
    streakMinimumBars: contract.streakMinimumBars,
    bodyRatioThreshold: contract.bodyRatioThreshold,
    wickImbalanceThreshold: contract.wickImbalanceThreshold,
    atrCompressionLowRatio: contract.atrCompressionLowRatio,
    atrCompressionHighRatio: contract.atrCompressionHighRatio,
    rangePositionLower: contract.rangePositionLower,
    rangePositionUpper: contract.rangePositionUpper,
    gapAtrThreshold: contract.gapAtrThreshold,
    horizons: [...contract.horizons],
    minimumObservations: contract.minimumObservations,
    confidenceLevel: contract.confidenceLevel,
    configurationTrials: contract.configurationTrials,
    minimumEffectBps: contract.minimumEffectBps,
    empiricalNullCalibration: true,
    folds: [], regime: null, observationLimit: 0,
  });

  const rows: BucketRow[] = [];
  for (const [feature, buckets] of Object.entries(result.byFeature)) {
    for (const [bucket, summary] of Object.entries(buckets as Record<string, any>)) {
      // Candidacy is defined on the horizon-1 non-overlapping forward return alone, so a bucket with
      // no inference there has nothing to report rather than a null verdict.
      const horizon = summary.horizons?.["1"]?.nonOverlappingForwardReturn;
      const inference = horizon?.candidateInference;
      if (!inference) continue;
      rows.push({
        feature, bucket,
        observations: summary.observations,
        meanBps: horizon.mean === null ? null : horizon.mean * 10_000,
        twoSidedPValue: inference.twoSidedPValue ?? null,
        empiricalFamilyWisePValue: inference.empiricalNullCalibration?.familyWisePValue ?? null,
        empiricalStatus: inference.empiricalNullCalibration?.status ?? null,
        candidateEligible: inference.candidateEligible === true,
        exploratoryEligible: inference.exploratoryEligible === true,
        candidateBlockers: inference.candidateBlockers ?? [],
      });
    }
  }
  rows.sort((left, right) =>
    (left.empiricalFamilyWisePValue ?? 9) - (right.empiricalFamilyWisePValue ?? 9));

  const calibration = (result as { empiricalNullCalibration?: Record<string, unknown> }).empiricalNullCalibration;
  return {
    schema_version: "1.0" as const,
    series: "fx_csv_feature_scan" as const,
    contract_id: contract.contractId,
    contract_hash: canonicalDefinitionHash(contract),
    evidence_tier: manifest.evidence_tier,
    symbol: manifest.symbol,
    bucket_minutes: manifest.bucket_minutes,
    // Carried from the aggregate so a scan result names the exact bytes it was computed from.
    source: {
      source_file: manifest.source_file,
      source_sha256: manifest.source_sha256,
      normalized_sha256: manifest.normalized_sha256,
      aggregation_definition_hash: manifest.definition_hash,
      broker_clock_rule: manifest.broker_clock_rule,
      start_from_broker_date: manifest.start_from_broker_date,
      bar_count: manifest.bar_count,
      first_bar_at: manifest.first_bar_at,
      last_bar_at: manifest.last_bar_at,
      aggregation_quality_issues: manifest.quality_issues,
    },
    status: result.status,
    quality_issues: result.qualityIssues,
    sample: result.sample,
    empirical_null_calibration: calibration ?? null,
    candidate_count: rows.filter((row) => row.candidateEligible).length,
    exploratory_count: rows.filter((row) => row.exploratoryEligible).length,
    bucket_count: rows.length,
    buckets: rows,
  };
}

async function main(): Promise<void> {
  const args = parseFxCsvFeatureScanCliArguments(process.argv.slice(2));
  const parsed = JSON.parse(await readFile(args.aggregatePath, "utf8")) as {
    manifest: FxCsvM1AggregationManifest;
    bars: FxCsvM1AggregationResult["bars"];
  };
  const started = Date.now();
  const scan = { ...scanAggregatedBars(parsed.manifest, parsed.bars), scanned_at: new Date().toISOString() };
  await mkdir(dirname(args.outputPath), { recursive: true, mode: 0o700 });
  await writeFile(args.outputPath, `${JSON.stringify(scan, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({
    symbol: scan.symbol, bucket_minutes: scan.bucket_minutes, bars: scan.source.bar_count,
    candidates: scan.candidate_count, exploratory: scan.exploratory_count, buckets: scan.bucket_count,
    calibration_id: (scan.empirical_null_calibration as { calibrationId?: string } | null)?.calibrationId ?? null,
    elapsed_seconds: Math.round((Date.now() - started) / 1000), output_path: args.outputPath,
  })}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`FX CSV feature scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
