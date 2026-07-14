import { AppendOnlyEvaluationLog, type EvaluationLogEntry } from "./evaluationLog.js";

type SnapshotPayload = Record<string, unknown> & { snapshot_id: string };
type RealYieldAsOfProvider = {
  getAsOf(asOf: Date): Promise<unknown>;
};
const REAL_YIELD_SERIES = "US_TREASURY_PAR_REAL_CMT_10Y";

export type EvaluationPipelineOptions = {
  realYield?: RealYieldAsOfProvider;
  asOf?: Date;
};

const canonicalTimestamp = (value: unknown, field: string): Date => {
  if (typeof value !== "string") throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical ISO-8601 timestamp`);
  }
  return parsed;
};

const existingEvaluationContext = (snapshot: SnapshotPayload): Record<string, unknown> => {
  const context = snapshot.evaluation_context;
  if (context === undefined) return {};
  if (!context || typeof context !== "object" || Array.isArray(context)) {
    throw new Error("snapshot evaluation_context must be an object");
  }
  for (const reserved of ["as_of", "as_of_basis", "real_yield_10y"]) {
    if (reserved in context) throw new Error(`snapshot evaluation_context.${reserved} is reserved`);
  }
  return context as Record<string, unknown>;
};

const validateRealYieldContext = (
  candidate: unknown,
  asOf: Date,
): Record<string, unknown> => {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("real-yield provider returned a non-object context");
  }
  const value = candidate as Record<string, unknown>;
  const asOfIso = asOf.toISOString();
  if (value.schema_version !== "1.1" || value.series !== REAL_YIELD_SERIES || value.source !== "us_treasury" ||
      value.unit !== "percent_per_annum_bond_equivalent") {
    throw new Error("real-yield provider returned an unsupported context");
  }
  if (value.as_of !== asOfIso) throw new Error("real-yield provider returned a mismatched as_of");
  if (value.point_in_time_status === "blocked") {
    if (value.status !== "unavailable" || value.value_status !== "unavailable" || value.value !== null ||
        value.observation_date !== null || value.available_at !== null || value.available_at_basis !== "unavailable" ||
        value.first_seen_at !== null || value.history_sequence !== null) {
      throw new Error("blocked real-yield context must not contain an available value");
    }
    return value;
  }
  if (value.point_in_time_status !== "observed_first_seen" || value.status !== "partial" || value.value_status !== "valid" ||
      typeof value.value !== "number" || !Number.isFinite(value.value) || value.value < -25 || value.value > 25 ||
      value.available_at_basis !== "local_first_seen" || value.available_at !== value.first_seen_at ||
      value.observed_at !== value.first_seen_at ||
      !Number.isSafeInteger(value.history_sequence) || (value.history_sequence as number) < 1) {
    throw new Error("real-yield provider returned inconsistent first-seen evidence");
  }
  const availableAt = canonicalTimestamp(value.available_at, "real_yield.available_at");
  if (availableAt.getTime() > asOf.getTime()) {
    throw new Error("real-yield available_at must not be later than as_of");
  }
  const observationTime = typeof value.observation_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.observation_date)
    ? Date.parse(`${value.observation_date}T00:00:00.000Z`)
    : Number.NaN;
  if (!Number.isFinite(observationTime) || new Date(observationTime).toISOString().slice(0, 10) !== value.observation_date ||
      observationTime > asOf.getTime() || value.observation_date > availableAt.toISOString().slice(0, 10)) {
    throw new Error("real-yield observation_date must not be later than as_of");
  }
  return value;
};

const evaluationAsOf = (snapshot: SnapshotPayload, override?: Date): { date: Date; basis: string } => {
  const completedAt = snapshot.request_completed_at === undefined
    ? null
    : canonicalTimestamp(snapshot.request_completed_at, "request_completed_at");
  if (!override) {
    if (!completedAt) throw new Error("request_completed_at is required for point-in-time enrichment");
    return { date: completedAt, basis: "request_completed_at" };
  }
  if (!Number.isFinite(override.getTime())) throw new Error("as_of must be a valid timestamp");
  const date = new Date(override.getTime());
  if (completedAt && date.getTime() > completedAt.getTime()) {
    throw new Error("as_of must not be later than request_completed_at");
  }
  return { date, basis: "explicit_override" };
};

/** Connects immutable observations, derived features, and later outcomes by snapshot_id. */
export class EvaluationPipeline {
  constructor(
    private readonly log: AppendOnlyEvaluationLog,
    private readonly options: EvaluationPipelineOptions = {},
  ) {}

  async recordSnapshot(snapshot: SnapshotPayload): Promise<EvaluationLogEntry> {
    let payload: SnapshotPayload = snapshot;
    if (this.options.realYield) {
      const context = existingEvaluationContext(snapshot);
      const asOf = evaluationAsOf(snapshot, this.options.asOf);
      const realYield = validateRealYieldContext(await this.options.realYield.getAsOf(asOf.date), asOf.date);
      payload = {
        ...snapshot,
        evaluation_context: {
          ...context,
          as_of: asOf.date.toISOString(),
          as_of_basis: asOf.basis,
          real_yield_10y: realYield,
        },
      };
    }
    return this.log.append({
      schema_version: "1.0",
      snapshot_id: snapshot.snapshot_id,
      kind: "snapshot",
      payload,
    });
  }

  async recordFeatures(snapshotId: string, features: Record<string, unknown>): Promise<EvaluationLogEntry> {
    return this.log.append({ schema_version: "1.0", snapshot_id: snapshotId, kind: "features", payload: features });
  }

  async recordOutcome(snapshotId: string, outcome: Record<string, unknown>): Promise<EvaluationLogEntry> {
    return this.log.append({ schema_version: "1.0", snapshot_id: snapshotId, kind: "outcome", payload: outcome });
  }
}
