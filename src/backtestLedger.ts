import { z } from "zod";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, link, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { noFollowFlag, openExclusiveFile, posixModeEnforced, syncDirectoryEntry } from "./fsDurability.js";

export const BACKTEST_LEDGER_MAX_BYTES = 32 * 1024 * 1024;
const hashSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const symbolSchema = z.string().regex(/^[A-Za-z0-9_.!:&/-]{1,64}$/);
const timeSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((s) => Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s, "invalid canonical UTC timestamp");
const tradeSchema = z.object({
  trade_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  symbol: symbolSchema,
  direction: z.enum(["long", "short"]),
  entry_at: timeSchema,
  exit_at: timeSchema,
  gross_return_bps: z.number().min(-1_000_000).max(1_000_000).nullable(),
}).strict().refine((r) => r.exit_at >= r.entry_at, "exit must not precede entry");

export const backtestLedgerSchema = z.object({
  schema_version: z.literal("1.0"),
  source_id: z.string().regex(/^[A-Za-z0-9_.:-]{1,120}$/),
  source_sha256: hashSchema,
  evidence_tier: z.enum(["historical_exploration", "prospective", "synthetic_test"]),
  return_unit: z.literal("direction_adjusted_gross_bps"),
  trades: z.array(tradeSchema).min(1).max(100_000),
}).strict().superRefine((v, ctx) => {
  if (new Set(v.trades.map((r) => r.trade_id)).size !== v.trades.length)
    ctx.addIssue({ code: "custom", message: "duplicate trade_id" });
  if (new Set(v.trades.map((r) => r.symbol)).size > 100)
    ctx.addIssue({ code: "custom", message: "at most 100 symbols allowed" });
});
export type BacktestLedger = z.infer<typeof backtestLedgerSchema>;

export const backtestLedgerSummarySchema = z.object({
  artifact_id: hashSchema,
  include_symbols: z.array(symbolSchema).min(1).max(100).optional(),
  exclude_symbols: z.array(symbolSchema).min(1).max(100).optional(),
  direction: z.enum(["long", "short"]).optional(),
  from: timeSchema.optional(),
  to: timeSchema.optional(),
  group_by: z.enum(["none", "symbol", "year", "month"]).default("none"),
  round_trip_cost_bps: z.number().min(0).max(1000),
}).strict().refine((v) => !v.from || !v.to || v.from < v.to, "from must be before to");

const digest = (body: Buffer) => `sha256:${createHash("sha256").update(body).digest("hex")}`;
export const resolveBacktestLedgerDirectory = () => process.env.TRADINGVIEW_MCP_BACKTEST_LEDGER_DIRECTORY?.trim()
  || join(homedir(), ".tradingview-mcp", "backtest-ledgers");

function ownerOnly(stat: Awaited<ReturnType<typeof lstat>>): void {
  if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("ledger evidence must belong to current user");
  if (posixModeEnforced() && (Number(stat.mode) & 0o077)) throw new Error("ledger evidence must be owner-only");
}

/** Bounded even if an input grows after stat. Explicit symlink check also protects Windows. */
export async function readBacktestLedgerFile(path: string, privateFile = false): Promise<Buffer> {
  const observed = await lstat(path);
  if (!observed.isFile() || observed.isSymbolicLink()) throw new Error("ledger input must be a regular file, not a symlink");
  // A regular file replaced by a FIFO must not block before fstat can reject it.
  const handle = await open(path, constants.O_RDONLY | noFollowFlag()
    | (process.platform === "win32" ? 0 : constants.O_NONBLOCK));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.ino !== observed.ino || stat.dev !== observed.dev) throw new Error("ledger input changed while opening");
    if (privateFile) ownerOnly(stat);
    if (stat.size < 1 || stat.size > BACKTEST_LEDGER_MAX_BYTES) throw new Error("ledger input size exceeds limit or is empty");
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, BACKTEST_LEDGER_MAX_BYTES + 1 - total));
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > BACKTEST_LEDGER_MAX_BYTES) throw new Error("ledger input size exceeds limit");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    const after = await handle.stat();
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || total !== stat.size) throw new Error("ledger input changed while reading");
    return Buffer.concat(chunks, total);
  } finally { await handle.close(); }
}

export class BacktestLedgerStore {
  constructor(private readonly directory = resolveBacktestLedgerDirectory()) {}

  private async checkDirectory(): Promise<void> {
    const stat = await lstat(this.directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("ledger directory must be a regular directory");
    ownerOnly(stat);
  }

  async get(artifactId: string): Promise<BacktestLedger> {
    hashSchema.parse(artifactId);
    await this.checkDirectory();
    const body = await readBacktestLedgerFile(join(this.directory, `${artifactId.slice(7)}.json`), true);
    if (digest(body) !== artifactId) throw new Error("ledger artifact hash mismatch");
    return backtestLedgerSchema.parse(JSON.parse(body.toString("utf8")));
  }

  async register(input: unknown): Promise<{ artifact_id: string; records: number }> {
    const ledger = backtestLedgerSchema.parse(input);
    const body = Buffer.from(JSON.stringify(ledger));
    if (body.length > BACKTEST_LEDGER_MAX_BYTES) throw new Error("ledger artifact exceeds size limit");
    const artifactId = digest(body);
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await this.checkDirectory();
    const temporary = join(this.directory, `.pending-${randomUUID()}`);
    const destination = join(this.directory, `${artifactId.slice(7)}.json`);
    const handle = await openExclusiveFile(temporary, "backtest ledger");
    try {
      try { await handle.writeFile(body); await handle.sync(); } finally { await handle.close(); }
      // Publish a fully synced immutable file; never expose a partially written artifact.
      try { await link(temporary, destination); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      await this.get(artifactId);
      await syncDirectoryEntry(this.directory);
    } finally { await unlink(temporary); }
    return { artifact_id: artifactId, records: ledger.trades.length };
  }
}

export function summarizeBacktestLedger(input: unknown, options: unknown) {
  const ledger = backtestLedgerSchema.parse(input);
  const request = backtestLedgerSummarySchema.parse(options);
  if (digest(Buffer.from(JSON.stringify(ledger))) !== request.artifact_id) throw new Error("summary artifact ID does not match normalized ledger");
  const symbols = new Set(ledger.trades.map((r) => r.symbol));
  for (const s of [...request.include_symbols ?? [], ...request.exclude_symbols ?? []])
    if (!symbols.has(s)) throw new Error(`symbol is not in ledger: ${s}`);
  if (request.include_symbols?.some((s) => request.exclude_symbols?.includes(s))) throw new Error("include/exclude symbols overlap");
  const rows = ledger.trades.filter((r) => (!request.include_symbols || request.include_symbols.includes(r.symbol))
    && !request.exclude_symbols?.includes(r.symbol) && (!request.direction || r.direction === request.direction)
    && (!request.from || r.exit_at >= request.from) && (!request.to || r.exit_at < request.to));
  const metrics = (group: typeof rows) => {
    const gross = group.flatMap((r) => r.gross_return_bps === null ? [] : [r.gross_return_bps]);
    const grossSum = gross.reduce((sum, value) => sum + value, 0);
    const meanGross = gross.length ? (grossSum === 0 ? 0 : grossSum / gross.length) : null;
    const net = group.flatMap((r) => r.gross_return_bps === null ? [] : [r.gross_return_bps - request.round_trip_cost_bps]);
    const profit = net.reduce((s, n) => s + Math.max(n, 0), 0);
    const loss = net.reduce((s, n) => s + Math.max(-n, 0), 0);
    return { records: group.length, closed_trades: net.length, missing_outcomes: group.length - net.length,
      gross_profit_bps: profit, gross_loss_bps: loss, net_sum_bps: profit - loss,
      mean_net_bps: net.length ? (profit - loss) / net.length : null,
      profit_factor: loss > 0 ? profit / loss : null,
      profit_factor_status: !net.length ? "no_closed_trades" : loss === 0 ? "no_losses" : "defined",
      break_even_cost: {
        contract: "flat_round_trip_cost_complete_case_v1",
        status: meanGross === null ? "no_known_outcomes" : meanGross < 0 ? "negative_gross_mean" : "defined",
        known_outcomes: gross.length, missing_outcomes: group.length - gross.length,
        mean_gross_bps: meanGross,
        max_nonnegative_round_trip_cost_bps: meanGross !== null && meanGross >= 0 ? meanGross : null,
        headroom_at_assumed_cost_bps: meanGross === null ? null : meanGross - request.round_trip_cost_bps,
      },
      win_rate: net.length ? net.filter((n) => n > 0).length / net.length : null,
      low_sample: net.length < 30 };
  };
  const groups = new Map<string, typeof rows>();
  if (request.group_by !== "none") for (const r of rows) {
    const key = request.group_by === "symbol" ? r.symbol : r.exit_at.slice(0, request.group_by === "year" ? 4 : 7);
    const group = groups.get(key) ?? [];
    group.push(r); groups.set(key, group);
    if (groups.size > 500) throw new Error("too many groups; narrow the date filters");
  }
  const overall = metrics(rows);
  const selectedIds = new Set(rows.map((row) => row.trade_id));
  const excluded = metrics(ledger.trades.filter((row) => !selectedIds.has(row.trade_id)));
  const baseline = metrics(ledger.trades);
  const known = baseline.closed_trades;
  const perOpportunity = (sum: number) => known ? (sum === 0 ? 0 : sum / known) : null;
  const avoidedCost = excluded.closed_trades * request.round_trip_cost_bps;
  const comparison = {
    contract: "same_ledger_filter_partition_v1",
    population: "entire_artifact_before_all_filters",
    status: baseline.missing_outcomes ? "partial" : "complete",
    baseline, selected: overall, excluded,
    common_opportunities: {
      known_outcomes: known, missing_outcomes: baseline.missing_outcomes,
      baseline_mean_net_bps: perOpportunity(baseline.net_sum_bps),
      selected_policy_mean_net_bps: perOpportunity(overall.net_sum_bps),
      delta_mean_net_bps: perOpportunity(-excluded.net_sum_bps),
      delta_mean_gross_bps: perOpportunity(-excluded.net_sum_bps - avoidedCost),
      avoided_cost_mean_bps: perOpportunity(avoidedCost),
    },
    limitations: ["complete_case_comparison_missing_outcomes_excluded_from_both_policies",
      "selected_policy_skips_excluded_known_opportunities_without_replacement",
      "not_a_causal_effect_or_funded_portfolio_return", "no_selection_bias_correction_or_significance_test"],
  };
  return { artifact_id: request.artifact_id, source_id: ledger.source_id, source_sha256: ledger.source_sha256,
    evidence_tier: ledger.evidence_tier, status: !rows.length ? "empty" : overall.missing_outcomes ? "partial" : "complete",
    candidateEligible: false, time_basis: "exit_at_utc_from_inclusive_to_exclusive", return_unit: "bps",
    cost_basis: "one_flat_round_trip_cost_per_closed_trade", filters: request,
    ledger_records: ledger.trades.length, selected_fraction: rows.length / ledger.trades.length, overall, comparison,
    groups: [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([key, group]) => ({ key, ...metrics(group) })),
    limitations: ["content_hash_is_integrity_not_source_authentication", "source_metadata_is_importer_supplied",
      "content_hash_does_not_prove_prespecified_slice_selection", "slice_search_count_is_not_tracked",
      "missing_outcomes_are_not_zero_returns", "bps_sums_are_not_portfolio_returns", "not_a_statistical_candidate_test",
      "break_even_cost_is_sample_mean_not_execution_feasibility_or_confidence_bound"] };
}
