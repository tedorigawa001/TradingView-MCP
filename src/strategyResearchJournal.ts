import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { lstat, mkdir, open, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_RECORD_BYTES = 64 * 1024;
const LOCK_WAIT_MS = 2_000;
const STALE_LOCK_MS = 60_000;
const ID_PATTERN = /^[\w.:-]{1,80}$/;
const HASH_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SYMBOL_PATTERN = /^[\w!.:&-]{1,48}$/;
const TIMEFRAME_PATTERN = /^(?:[1-9]\d*|[1-9]\d*[SDWM]|[SDWM])$/i;
const METRICS = new Set([
  "netProfit", "netProfitPercent", "profitFactor", "maxDrawdown", "maxDrawdownPercent",
  "sharpeRatio", "sortinoRatio", "totalTrades", "expectancy", "averageDurationMilliseconds",
  "averageRunUp", "averageDrawDown", "worstTradeDrawDown",
]);

export const resolveStrategyResearchJournalPath = (
  configuredPath = process.env.TRADINGVIEW_MCP_STRATEGY_RESEARCH_JOURNAL_PATH,
): string => configuredPath?.trim() || join(homedir(), ".tradingview-mcp", "strategy-research-journal.jsonl");

export type ResearchPopulation = "in_sample" | "out_of_sample" | "walk_forward" | "stress" | "live";

export type StrategyHypothesis = {
  hypothesisId: string;
  title: string;
  thesis: string;
  parentExperimentId: string | null;
  evaluationContract: {
    population: ResearchPopulation;
    primaryMetric: string;
    minimumTrades: number;
    symbols: string[];
    timeframes: string[];
    minimumProfitFactor: number | null;
    maximumDrawdownPercent: number | null;
  };
};

export type StrategyExperimentRecord = {
  experimentId: string;
  hypothesisId: string;
  parentExperimentId: string | null;
  population: ResearchPopulation;
  methodologyVersion: string;
  symbol: string;
  timeframe: string;
  baseline: {
    pineId: string;
    pineVersion: string;
    ledgerId: string;
    metrics: Record<string, number | null>;
  };
  candidate: {
    pineId: string;
    pineVersion: string;
    ledgerId: string;
    metrics: Record<string, number | null>;
  };
  conditionsMatched: boolean;
  minimumTradesMet: boolean;
  decision: "adopted" | "rejected" | "inconclusive";
  note: string;
};

export type ResearchJournalEntry = {
  schema_version: "1.0";
  event_id: string;
  sequence: number;
  recorded_at: string;
  kind: "hypothesis_registered" | "experiment_recorded";
  entity_id: string;
  definition_hash: string;
  evidence_hash: string | null;
  payload: StrategyHypothesis | StrategyExperimentRecord;
};

const canonicalHash = (value: unknown): string =>
  `sha256:${createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex")}`;

function validateMetrics(value: unknown): Record<string, number | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("metrics must be an object");
  const result: Record<string, number | null> = {};
  for (const [key, metric] of Object.entries(value)) {
    if (!METRICS.has(key)) throw new Error(`unsupported research metric: ${key}`);
    if (metric !== null && (typeof metric !== "number" || !Number.isFinite(metric))) {
      throw new Error(`invalid research metric: ${key}`);
    }
    result[key] = metric as number | null;
  }
  if (Object.keys(result).length === 0) throw new Error("metrics must not be empty");
  return result;
}

function validateHypothesis(value: StrategyHypothesis): StrategyHypothesis {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("hypothesis must be an object");
  if (!ID_PATTERN.test(value.hypothesisId)) throw new Error("invalid hypothesis_id");
  if (typeof value.title !== "string" || value.title.length < 1 || value.title.length > 120) throw new Error("invalid hypothesis title");
  if (typeof value.thesis !== "string" || value.thesis.length < 1 || value.thesis.length > 2000) throw new Error("invalid hypothesis thesis");
  if (value.parentExperimentId !== null && !HASH_PATTERN.test(value.parentExperimentId)) throw new Error("invalid parent_experiment_id");
  const contract = value.evaluationContract;
  if (!contract || typeof contract !== "object") throw new Error("evaluation contract is required");
  if (!(new Set<ResearchPopulation>(["in_sample", "out_of_sample", "walk_forward", "stress", "live"])).has(contract.population)) throw new Error("invalid research population");
  if (!METRICS.has(contract.primaryMetric)) throw new Error("invalid primary metric");
  if (!Number.isInteger(contract.minimumTrades) || contract.minimumTrades < 1 || contract.minimumTrades > 100_000) throw new Error("invalid minimum trades");
  if (!Array.isArray(contract.symbols) || contract.symbols.length < 1 || contract.symbols.length > 20 || contract.symbols.some((item) => !SYMBOL_PATTERN.test(item))) throw new Error("invalid hypothesis symbols");
  if (!Array.isArray(contract.timeframes) || contract.timeframes.length < 1 || contract.timeframes.length > 20 || contract.timeframes.some((item) => !TIMEFRAME_PATTERN.test(item))) throw new Error("invalid hypothesis timeframes");
  if (contract.minimumProfitFactor !== null && (typeof contract.minimumProfitFactor !== "number" || !Number.isFinite(contract.minimumProfitFactor) || contract.minimumProfitFactor < 0)) throw new Error("invalid minimum profit factor");
  if (contract.maximumDrawdownPercent !== null && (typeof contract.maximumDrawdownPercent !== "number" || !Number.isFinite(contract.maximumDrawdownPercent) || contract.maximumDrawdownPercent < 0)) throw new Error("invalid maximum drawdown percent");
  return {
    ...value,
    evaluationContract: {
      ...contract,
      symbols: [...new Set(contract.symbols.map((item) => item.toUpperCase()))].sort(),
      timeframes: [...new Set(contract.timeframes.map((item) => item.toUpperCase()))].sort(),
    },
  };
}

function validateVariant(value: StrategyExperimentRecord["baseline"], label: string) {
  if (!value || typeof value !== "object") throw new Error(`${label} is required`);
  if (!/^USER;[\w]{8,64}$/.test(value.pineId)) throw new Error(`invalid ${label} pine id`);
  if (typeof value.pineVersion !== "string" || value.pineVersion.length < 1 || value.pineVersion.length > 32) throw new Error(`invalid ${label} pine version`);
  if (!HASH_PATTERN.test(value.ledgerId)) throw new Error(`invalid ${label} ledger id`);
  return { ...value, metrics: validateMetrics(value.metrics) };
}

function validateExperiment(value: StrategyExperimentRecord): StrategyExperimentRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("experiment must be an object");
  if (!HASH_PATTERN.test(value.experimentId)) throw new Error("invalid experiment_id");
  if (!ID_PATTERN.test(value.hypothesisId)) throw new Error("invalid hypothesis_id");
  if (value.parentExperimentId !== null && !HASH_PATTERN.test(value.parentExperimentId)) throw new Error("invalid parent_experiment_id");
  if (!(new Set<ResearchPopulation>(["in_sample", "out_of_sample", "walk_forward", "stress", "live"])).has(value.population)) throw new Error("invalid research population");
  if (typeof value.methodologyVersion !== "string" || value.methodologyVersion.length < 1 || value.methodologyVersion.length > 40) throw new Error("invalid methodology version");
  if (!SYMBOL_PATTERN.test(value.symbol)) throw new Error("invalid experiment symbol");
  if (!TIMEFRAME_PATTERN.test(value.timeframe)) throw new Error("invalid experiment timeframe");
  if (typeof value.conditionsMatched !== "boolean" || typeof value.minimumTradesMet !== "boolean") throw new Error("invalid experiment guardrails");
  if (!(["adopted", "rejected", "inconclusive"] as unknown[]).includes(value.decision)) throw new Error("invalid experiment decision");
  if (typeof value.note !== "string" || value.note.length > 500) throw new Error("invalid experiment note");
  return {
    ...value,
    symbol: value.symbol.toUpperCase(),
    timeframe: value.timeframe.toUpperCase(),
    baseline: validateVariant(value.baseline, "baseline"),
    candidate: validateVariant(value.candidate, "candidate"),
  };
}

function evidenceHash(experiment: StrategyExperimentRecord): string {
  return canonicalHash({
    experimentId: experiment.experimentId,
    population: experiment.population,
    methodologyVersion: experiment.methodologyVersion,
    symbol: experiment.symbol,
    timeframe: experiment.timeframe,
    baseline: experiment.baseline,
    candidate: experiment.candidate,
    conditionsMatched: experiment.conditionsMatched,
    minimumTradesMet: experiment.minimumTradesMet,
  });
}

function experimentDefinitionHash(payload: StrategyExperimentRecord): string {
  return canonicalHash({
    experimentId: payload.experimentId,
    hypothesisId: payload.hypothesisId,
    parentExperimentId: payload.parentExperimentId,
    population: payload.population,
    methodologyVersion: payload.methodologyVersion,
    symbol: payload.symbol,
    timeframe: payload.timeframe,
    baseline: { pineId: payload.baseline.pineId, pineVersion: payload.baseline.pineVersion },
    candidate: { pineId: payload.candidate.pineId, pineVersion: payload.candidate.pineVersion },
  });
}

export class StrategyResearchJournalStore {
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly filePath: string) {
    if (!filePath) throw new Error("strategy research journal path is required");
  }

  private async ensureDirectory(): Promise<void> {
    const directory = dirname(this.filePath);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("strategy research journal directory is unsafe");
    if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("strategy research journal directory must be owned by the current user");
    if ((stat.mode & 0o077) !== 0) throw new Error("strategy research journal directory permissions must be 0700");
  }

  private async reclaimStaleLock(lockPath: string, observed: Awaited<ReturnType<typeof lstat>>): Promise<boolean> {
    if (Date.now() - Number(observed.mtimeMs) <= STALE_LOCK_MS) return false;
    if (typeof process.getuid === "function" && observed.uid !== process.getuid()) throw new Error(`strategy research journal lock must be owned by the current user: ${lockPath}`);
    let handle;
    try {
      handle = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const opened = await handle.stat();
      if (!opened.isFile() || opened.ino !== observed.ino) return true;
      const contents = await handle.readFile("utf8");
      const ownerPid = contents.match(/^[0-9a-f-]{36}\s+(\d+)\n$/i)?.[1];
      if (ownerPid) {
        try { process.kill(Number(ownerPid), 0); return false; } catch (err) {
          if ((err as NodeJS.ErrnoException).code !== "ESRCH") return false;
        }
      }
      const current = await lstat(lockPath);
      if (current.ino !== opened.ino || current.mtimeMs !== opened.mtimeMs) return true;
      await unlink(lockPath);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return true;
      throw err;
    } finally { await handle?.close(); }
  }

  private async acquireLock(): Promise<() => Promise<void>> {
    await this.ensureDirectory();
    const lockPath = `${this.filePath}.lock`;
    const token = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_MS;
    while (true) {
      try {
        const handle = await open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
        try { await handle.writeFile(`${token} ${process.pid}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
        return async () => {
          let lock;
          try {
            lock = await open(lockPath, constants.O_RDONLY | constants.O_NOFOLLOW);
            const stat = await lock.stat();
            const contents = await lock.readFile("utf8");
            await lock.close(); lock = undefined;
            const current = await lstat(lockPath);
            if (current.ino !== stat.ino || !contents.startsWith(`${token} `)) throw new Error("strategy research journal lock ownership was lost");
            await unlink(lockPath);
          } catch (err) {
            if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
          } finally { await lock?.close(); }
        };
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        let stat;
        try { stat = await lstat(lockPath); } catch (statError) {
          if ((statError as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw statError;
        }
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("strategy research journal lock path is unsafe");
        if (await this.reclaimStaleLock(lockPath, stat)) continue;
        if (Date.now() >= deadline) throw new Error(`timed out acquiring strategy research journal lock at ${lockPath}`);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
  }

  private async readUnlocked(): Promise<ResearchJournalEntry[]> {
    let handle;
    try { handle = await open(this.filePath, constants.O_RDONLY | constants.O_NOFOLLOW); } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw new Error("unable to open strategy research journal as a regular file", { cause: err });
    }
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("strategy research journal path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("strategy research journal file must be owned by the current user");
      if ((stat.mode & 0o077) !== 0) throw new Error("strategy research journal file permissions must be 0600");
      if (stat.size > MAX_FILE_BYTES) throw new Error("strategy research journal file is too large");
      const text = await handle.readFile("utf8");
      const entries = text.trim().split("\n").filter(Boolean).map((line, index) => {
        if (Buffer.byteLength(line, "utf8") > MAX_RECORD_BYTES) throw new Error(`strategy research journal record is too large at line ${index + 1}`);
        let parsed: ResearchJournalEntry;
        try { parsed = JSON.parse(line) as ResearchJournalEntry; } catch { throw new Error(`invalid strategy research journal JSON at line ${index + 1}`); }
        if (parsed.schema_version !== "1.0" || parsed.sequence !== index + 1 ||
            !/^[0-9a-f-]{36}$/i.test(parsed.event_id) ||
            new Date(parsed.recorded_at).toISOString() !== parsed.recorded_at ||
            !HASH_PATTERN.test(parsed.definition_hash)) {
          throw new Error(`invalid strategy research journal record at line ${index + 1}`);
        }
        if (parsed.kind === "hypothesis_registered") {
          const payload = validateHypothesis(parsed.payload as StrategyHypothesis);
          if (parsed.entity_id !== payload.hypothesisId || parsed.evidence_hash !== null ||
              parsed.definition_hash !== canonicalHash(payload)) {
            throw new Error(`strategy hypothesis identity mismatch at line ${index + 1}`);
          }
        } else if (parsed.kind === "experiment_recorded") {
          const payload = validateExperiment(parsed.payload as StrategyExperimentRecord);
          if (parsed.entity_id !== payload.experimentId || parsed.evidence_hash !== evidenceHash(payload) ||
              parsed.definition_hash !== experimentDefinitionHash(payload)) {
            throw new Error(`strategy experiment identity mismatch at line ${index + 1}`);
          }
        } else throw new Error(`invalid strategy research journal kind at line ${index + 1}`);
        return parsed;
      });
      if (new Set(entries.map((entry) => entry.event_id)).size !== entries.length) throw new Error("duplicate strategy research journal event id");
      const hypotheses = new Set<string>();
      const experiments = new Set<string>();
      const evidence = new Set<string>();
      for (const [index, entry] of entries.entries()) {
        if (entry.kind === "hypothesis_registered") {
          if (hypotheses.has(entry.entity_id)) throw new Error(`duplicate strategy hypothesis at line ${index + 1}`);
          const payload = entry.payload as StrategyHypothesis;
          if (payload.parentExperimentId && !experiments.has(payload.parentExperimentId)) throw new Error(`orphaned strategy hypothesis parent at line ${index + 1}`);
          hypotheses.add(entry.entity_id);
        } else {
          const payload = entry.payload as StrategyExperimentRecord;
          if (!hypotheses.has(payload.hypothesisId)) throw new Error(`orphaned strategy experiment at line ${index + 1}`);
          if (payload.parentExperimentId && !experiments.has(payload.parentExperimentId)) throw new Error(`orphaned strategy experiment parent at line ${index + 1}`);
          const identity = `${entry.entity_id}:${entry.evidence_hash}`;
          if (evidence.has(identity)) throw new Error(`duplicate strategy experiment evidence at line ${index + 1}`);
          evidence.add(identity);
          experiments.add(entry.entity_id);
        }
      }
      return entries;
    } finally { await handle.close(); }
  }

  private async appendUnlocked(entry: ResearchJournalEntry): Promise<void> {
    await this.ensureDirectory();
    const line = Buffer.from(`${JSON.stringify(entry)}\n`, "utf8");
    if (line.byteLength > MAX_RECORD_BYTES) throw new Error("strategy research journal record is too large");
    const handle = await open(this.filePath, constants.O_APPEND | constants.O_CREAT | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) throw new Error("strategy research journal path must be a regular file");
      if (typeof process.getuid === "function" && stat.uid !== process.getuid()) throw new Error("strategy research journal file must be owned by the current user");
      await handle.chmod(0o600);
      if (stat.size + line.byteLength > MAX_FILE_BYTES) throw new Error("strategy research journal file is too large");
      const { bytesWritten } = await handle.write(line, 0, line.byteLength, null);
      if (bytesWritten !== line.byteLength) throw new Error("short write to strategy research journal");
      await handle.sync();
    } finally { await handle.close(); }
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(async () => {
      const release = await this.acquireLock();
      try { return await operation(); } finally { await release(); }
    });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  async registerHypothesis(value: StrategyHypothesis) {
    const payload = validateHypothesis(value);
    const hash = canonicalHash(payload);
    return this.serialize(async () => {
      const entries = await this.readUnlocked();
      const existing = entries.find((entry) => entry.kind === "hypothesis_registered" && entry.entity_id === payload.hypothesisId);
      if (existing) {
        if (existing.definition_hash !== hash) throw new Error(`hypothesis_id ${payload.hypothesisId} is already bound to a different definition`);
        return { recorded: false, idempotent: true, entry: existing };
      }
      if (payload.parentExperimentId && !entries.some((entry) => entry.kind === "experiment_recorded" && entry.entity_id === payload.parentExperimentId)) throw new Error("parent experiment is not recorded");
      const entry: ResearchJournalEntry = { schema_version: "1.0", event_id: randomUUID(), sequence: entries.length + 1, recorded_at: new Date().toISOString(), kind: "hypothesis_registered", entity_id: payload.hypothesisId, definition_hash: hash, evidence_hash: null, payload };
      await this.appendUnlocked(entry);
      return { recorded: true, idempotent: false, entry };
    });
  }

  async recordExperiment(value: StrategyExperimentRecord) {
    const payload = validateExperiment(value);
    const evidence = evidenceHash(payload);
    const definition = experimentDefinitionHash(payload);
    return this.serialize(async () => {
      const entries = await this.readUnlocked();
      if (!entries.some((entry) => entry.kind === "hypothesis_registered" && entry.entity_id === payload.hypothesisId)) throw new Error("hypothesis_id is not registered");
      if (payload.parentExperimentId && !entries.some((entry) => entry.kind === "experiment_recorded" && entry.entity_id === payload.parentExperimentId)) throw new Error("parent experiment is not recorded");
      const existing = entries.find((entry) => entry.kind === "experiment_recorded" && entry.entity_id === payload.experimentId && entry.evidence_hash === evidence);
      if (existing) {
        if (existing.definition_hash !== definition || canonicalHash(existing.payload) !== canonicalHash(payload)) throw new Error("experiment evidence is already bound to a different record");
        return { recorded: false, idempotent: true, entry: existing };
      }
      const entry: ResearchJournalEntry = { schema_version: "1.0", event_id: randomUUID(), sequence: entries.length + 1, recorded_at: new Date().toISOString(), kind: "experiment_recorded", entity_id: payload.experimentId, definition_hash: definition, evidence_hash: evidence, payload };
      await this.appendUnlocked(entry);
      return { recorded: true, idempotent: false, entry };
    });
  }

  async compare(references: Array<{ experimentId: string; evidenceHash: string }>) {
    if (references.length < 2 || references.length > 20) throw new Error("compare requires two to twenty experiment references");
    return this.serialize(async () => {
      const entries = await this.readUnlocked();
      const selected = references.map((reference) => {
        if (!HASH_PATTERN.test(reference.experimentId) || !HASH_PATTERN.test(reference.evidenceHash)) throw new Error("invalid experiment comparison reference");
        const entry = entries.find((candidate) => candidate.kind === "experiment_recorded" && candidate.entity_id === reference.experimentId && candidate.evidence_hash === reference.evidenceHash);
        if (!entry) throw new Error(`experiment evidence not found: ${reference.experimentId}`);
        return entry;
      });
      const payloads = selected.map((entry) => entry.payload as StrategyExperimentRecord);
      const first = payloads[0];
      const differences: string[] = [];
      for (const current of payloads.slice(1)) {
        if (current.hypothesisId !== first.hypothesisId) differences.push("hypothesis_id");
        if (current.population !== first.population) differences.push("population");
        if (current.symbol !== first.symbol) differences.push("symbol");
        if (current.timeframe !== first.timeframe) differences.push("timeframe");
        if (current.methodologyVersion !== first.methodologyVersion) differences.push("methodology_version");
      }
      if (payloads.some((payload) => !payload.conditionsMatched)) differences.push("conditions_matched");
      return {
        comparable: differences.length === 0,
        incompatibilities: [...new Set(differences)],
        contract: { hypothesisId: first.hypothesisId, population: first.population, symbol: first.symbol, timeframe: first.timeframe, methodologyVersion: first.methodologyVersion },
        experiments: selected.map((entry) => ({ experimentId: entry.entity_id, evidenceHash: entry.evidence_hash, recordedAt: entry.recorded_at, payload: entry.payload })),
      };
    });
  }
}
