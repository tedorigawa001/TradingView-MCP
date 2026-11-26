import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { ReplayCandidateReader } from "./replayAdoptionCandidate.js";

/**
 * Stage B. The page-side recorder records observations for diagnosis.
 * Its notifications, fingerprints and local sequence cannot establish
 * publisher provenance or completeness. The candidate reader requires a
 * separately verified publisher connection. No live publisher is configured
 * by the CDP adapter, and there is no MCP entry point.
 */

export const RECORDER_KEY = "tradingview-mcp.replayAdoptionRecorder.v1";
export const RECORDER_LOG_LIMIT = 512;

export interface ReplayFingerprint {
  chartSession: string | null;
  replaySession: string | null;
  replayTurnaround: number | null;
  seriesInstance: string | null;
  sourceInstance: string | null;
  strategyTurnaround: string | null;
  activeStudy: string | null;
  symbol: string | null;
  resolution: string | null;
  seriesSession: string | null;
  lastBar: number[] | null;
  reportEnd: number | null;
  loading: boolean | null;
  completed: boolean | null;
  inputs: string | null;
  replay: {
    started: boolean | null;
    autoplay: boolean | null;
    cursor: number | null;
    selected: number | null;
    resolution: string | null;
  };
}

export interface RecorderEvent {
  seq: number;
  name: string;
  args: Array<string | number | boolean | null>;
  fp: ReplayFingerprint;
}

export interface RecorderSnapshot {
  recorderId: string;
  seq: number;
  overflow: boolean;
  current: ReplayFingerprint;
  log?: RecorderEvent[];
}

export interface ReplayReaderTarget {
  chartIndex: number;
  studyId: string;
  pineId: string;
  pineVersion: string;
  symbol: string;
  seriesId: string;
  timeframe: "5";
}

interface ReplayBarDiagnosis {
  status: string;
  reason: string | null;
  studyId?: string;
  symbol?: string;
  resolution?: string;
  selectedTime?: string;
  cursorTime?: string;
  reportEndTime?: string;
  barOpen?: string;
  barEndExclusive?: string;
  pineId?: string;
  pineVersion?: string;
}

/** What the reader needs from a page connection; TradingView and CdpClient satisfy it. */
export interface ReplayReaderDeps {
  evaluate<T>(expression: string): Promise<T>;
  diagnose(options: { chartIndex: number; expectedStudyId: string }): Promise<ReplayBarDiagnosis>;
  publisher?: ReplayPublisherReader;
}

/** Adapter over the existing CDP client and TradingView operations. */
export function replayReaderDeps(
  cdp: { evaluate<T>(expression: string): Promise<T> },
  tv: {
    diagnoseReplayStrategyBar(options: { chartIndex: number; expectedStudyId: string }): Promise<ReplayBarDiagnosis>;
  },
): ReplayReaderDeps {
  return {
    evaluate: expression => cdp.evaluate(expression),
    diagnose: options => tv.diagnoseReplayStrategyBar(options),
  };
}

function checkChart(chartIndex: number, studyId: string) {
  if (!Number.isSafeInteger(chartIndex) || chartIndex < 0) throw new Error("chartIndex must be a non-negative integer");
  if (!/^[\w.-]{1,128}$/.test(studyId)) throw new Error("studyId must be a TradingView study id");
}

/**
 * In-page recorder script. Modes: install (needs a new recorder id and a
 * stopped Replay), revision and evidence (fingerprint check, then counters or
 * the full log), remove (unsubscribe the owner token from every delegate).
 */
export function recorderScript(mode: "install" | "revision" | "evidence" | "remove",
  options: { chartIndex: number; studyId: string; recorderId?: string }): string {
  checkChart(options.chartIndex, options.studyId);
  if (mode === "install" && !/^[a-f0-9]{32}$/.test(options.recorderId ?? "")) throw new Error("recorderId must be 32 hex digits");
  return `
    (async () => {
      const KEY = Symbol.for(${JSON.stringify(RECORDER_KEY)});
      const mode = ${JSON.stringify(mode)};
      const chartIndex = ${options.chartIndex};
      const studyId = ${JSON.stringify(options.studyId)};
      const unsubscribe = state => {
        state.ready = false;
        state.delegates = state.delegates.filter(delegate => {
          try { delegate.unsubscribeAll(state.token); } catch (e) {}
          try {
            return !Array.isArray(delegate._listeners) ||
              delegate._listeners.some(l => l && l.object === state.token);
          } catch (e) {
            return true;
          }
        });
        return state.delegates.length;
      };
      if (mode === "remove") {
        const existing = window[KEY];
        if (!existing) return { removed: false };
        if (existing.chartIndex !== chartIndex || existing.studyId !== studyId) {
          throw new Error("The recorder watches another chart or study");
        }
        const left = unsubscribe(existing);
        if (left === 0) delete window[KEY];
        return { removed: left === 0, left, recorderId: existing.recorderId };
      }
      const api = window.TradingViewApi;
      if (!api || typeof api.replayApi !== "function") throw new Error("Replay API unavailable");
      const chart = api.chart(chartIndex);
      const model = chart._chartWidget._lineToolsSynchronizer._chartModel;
      const series = model.mainSeries();
      const holder = typeof model.activeStrategySource === "function" ? model.activeStrategySource() : null;
      const replay = await api.replayApi();
      const rs = replay._replayUIController._replayManager._replaySession;
      const unwrap = value => value && typeof value.value === "function" ? value.value() : value;
      const num = value => typeof value === "number" && Number.isFinite(value) ? value : null;
      const str = value => typeof value === "string" ? value.slice(0, 128) : null;
      const bool = value => typeof value === "boolean" ? value : null;
      const attempt = (fn, fallback = null) => { try { return fn(); } catch (e) { return fallback; } };
      const fnv = text => { let h1 = 0x811c9dc5, h2 = 0x9747b28c;
        for (let i = 0; i < text.length; i++) { const c = text.charCodeAt(i);
          h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0; h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0; }
        return h1.toString(16).padStart(8, "0") + h2.toString(16).padStart(8, "0"); };
      const sourceNow = () => attempt(() => holder && typeof holder.value === "function" ? holder.value() : null);
      const fingerprint = () => {
        const source = sourceNow();
        const bar = attempt(() => series.bars()._items.at(-1));
        const last = bar && Array.isArray(bar.value) ? [num(bar.index), ...bar.value.slice(0, 5).map(num)] : null;
        const sourceId = attempt(() => typeof source.id === "function" ? source.id() : source.id);
        return {
          chartSession: str(attempt(() => model._chartSession._sessionId)),
          replaySession: str(attempt(() => rs._sessionId)),
          replayTurnaround: num(attempt(() => rs._turnaroundIndex)),
          seriesInstance: str(attempt(() => series._instanceId)),
          sourceInstance: str(attempt(() => source._instanceId)),
          strategyTurnaround: str(attempt(() => source.turnaround())),
          activeStudy: str(sourceId),
          symbol: str(attempt(() => chart.symbol())),
          resolution: str(attempt(() => chart.resolution())),
          seriesSession: str(attempt(() => series.sessionId())),
          lastBar: last && last.every(v => v !== null) ? last : null,
          reportEnd: num(attempt(() => source._reportData.settings.dateRange.backtest.to)),
          loading: bool(attempt(() => source.isLoading())),
          completed: bool(attempt(() => source.isCompleted())),
          inputs: attempt(() => fnv(JSON.stringify(chart.getStudyById(studyId).getInputValues()))),
          replay: {
            started: bool(attempt(() => unwrap(replay.isReplayStarted()))),
            autoplay: bool(attempt(() => unwrap(replay.isAutoplayStarted()))),
            cursor: num(attempt(() => unwrap(replay.currentDate()))),
            selected: num(attempt(() => unwrap(replay.getReplaySelectedDate()))),
            resolution: str(attempt(() => unwrap(replay.currentReplayResolution()) ?? unwrap(replay.autoReplayResolution()))),
          },
        };
      };
      const record = (state, name, args) => {
        state.seq++;
        state.last = fingerprint();
        if (state.log.length < ${RECORDER_LOG_LIMIT}) {
          state.log.push({ seq: state.seq, name, args: args.slice(0, 3).map(v =>
            v === null || v === undefined ? null : ["number", "boolean"].includes(typeof v) ? v :
            typeof v === "string" ? v.slice(0, 128) : null), fp: state.last });
        } else state.overflow = true;
      };
      if (mode === "install") {
        if (window[KEY]) throw new Error("A replay recorder is already installed or awaiting cleanup");
        if (unwrap(replay.isReplayStarted()) !== false) throw new Error("Install the recorder before Replay starts");
        const source = sourceNow();
        if (attempt(() => typeof source.id === "function" ? source.id() : source.id) !== studyId) {
          throw new Error("The requested strategy is not active on the chart");
        }
        const dataEvents = series.dataEvents();
        const pick = (owner, name) => attempt(() => typeof owner[name] === "function" ? owner[name]() : owner["_" + name]);
        const sources = {
          replaySession: () => rs.onSessionIdChanged(), replayPoint: () => rs.onReplayPointChanged(),
          replayEnd: () => rs.onEndOfDataReached(), replayModified: () => model.onReplayModified(),
          barReceived: () => pick(dataEvents, "barReceived"), seriesUpdated: () => pick(dataEvents, "dataUpdated"),
          seriesCompleted: () => pick(dataEvents, "completed"), seriesModified: () => pick(dataEvents, "modified"),
          seriesLoading: () => pick(dataEvents, "loading"), seriesCleared: () => pick(dataEvents, "cleared"),
          sourceUpdated: () => source.onDataUpdated(), sourceStatus: () => source.onStatusChanged(),
          reportChanged: () => source.reportChanged(),
        };
        const state = { recorderId: ${JSON.stringify(options.recorderId ?? "")}, token: {}, seq: 0, overflow: false,
          log: [], delegates: [], last: null, studyId, chartIndex, ready: false };
        window[KEY] = state;
        try {
          for (const [name, get] of Object.entries(sources)) {
            const delegate = attempt(get);
            if (!delegate || typeof delegate.subscribe !== "function" || typeof delegate.unsubscribeAll !== "function" ||
                typeof delegate.fire !== "function" || !Array.isArray(delegate._listeners)) {
              throw new Error("Replay recorder source unavailable: " + name);
            }
            if (!state.delegates.includes(delegate)) state.delegates.push(delegate);
            delegate.subscribe(state.token, (...args) => {
              if (state.ready) record(state, name, args);
            });
            if (!delegate._listeners.some(l => l && l.object === state.token)) {
              throw new Error("Replay recorder subscription unconfirmed: " + name);
            }
          }
          state.last = fingerprint();
          state.ready = true;
        } catch (error) {
          if (unsubscribe(state) === 0) delete window[KEY];
          else throw new Error("Replay recorder installation failed; cleanup is pending");
          throw error;
        }
        return { recorderId: state.recorderId, seq: state.seq, sources: Object.keys(sources) };
      }
      const existing = window[KEY];
      if (!existing) throw new Error("No replay recorder is installed");
      if (existing.chartIndex !== chartIndex || existing.studyId !== studyId) throw new Error("The recorder watches another chart or study");
      if (!existing.ready) throw new Error("Replay recorder cleanup is pending");
      // A difference visible between observations is recorded for diagnosis.
      const now = fingerprint();
      if (JSON.stringify(now) !== JSON.stringify(existing.last)) record(existing, "unobserved_change", []);
      const snapshot = { recorderId: existing.recorderId, seq: existing.seq, overflow: existing.overflow, current: existing.last };
      return mode === "evidence" ? { ...snapshot, log: existing.log.slice() } : snapshot;
    })()
  `;
}

type ReaderTarget = Parameters<ReplayCandidateReader["readLiveRevision"]>[0];

/**
 * The dependency must read genuine publisher metadata, including a live
 * revision that advances for every covered change. It must detect resets,
 * reconnects and incomplete publication at the source. The report scope is
 * recorded by the publisher for that calculation. The stream manifest is the
 * publisher's complete list for the start-to-end checkpoint interval, obtained
 * independently of which event streams the reader received.
 * A page request carries no expected IDs or hashes to copy into its response.
 */
export interface ReplayPublisherReader {
  readLiveRevision(target: ReaderTarget): Promise<unknown>;
  readEvidence(target: ReaderTarget): Promise<unknown>;
  readLedgerPage(target: ReaderTarget, range: { offset: number; limit: number }): Promise<unknown>;
}

const publisherId = z.string().regex(/^[\w:;.-]{1,128}$/);
const publisherHash = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const sequence = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const revisionSchema = z.strictObject({
  appInstanceId: publisherId, replaySessionId: publisherId, revision: sequence,
});
const checkpointSchema = z.strictObject({ id: publisherId, liveRevision: revisionSchema });
const updateSchema = z.strictObject({ seriesId: publisherId, openTimeMs: sequence, updateId: publisherId });
const domainSchema = z.enum(["replay", "bar", "settings", "report", "ledger"]);
const positionSchema = z.strictObject({ checkpointId: publisherId, streamEpoch: publisherId, sequence });
const streamSourceSchema = z.strictObject({
  publisherId, streamId: publisherId,
  domains: z.array(domainSchema).min(1).max(domainSchema.options.length),
});
const resultIdentitySchema = z.strictObject({
  snapshotId: publisherId.nullable(), ledgerId: publisherHash,
  reportStateSha256: publisherHash, settingsSha256: publisherHash,
});
const publisherProofSchema = z.strictObject({
  start: checkpointSchema,
  end: checkpointSchema,
  bar: z.strictObject({ finalized: z.literal(true), update: updateSchema }),
  report: z.strictObject({
    complete: z.literal(true), calculationId: publisherId, calculatedFrom: updateSchema,
    checkpointId: publisherId, settingsSha256: publisherHash,
    target: z.strictObject({
      chartIndex: sequence, studyId: publisherId, pineId: publisherId, pineVersion: publisherId,
    }),
  }),
  ledger: resultIdentitySchema.extend({ calculationId: publisherId }),
  streamManifest: z.strictObject({
    startCheckpointId: publisherId, endCheckpointId: publisherId, complete: z.literal(true),
    requiredStreams: z.array(streamSourceSchema.extend({ streamEpoch: publisherId })).min(1).max(RECORDER_LOG_LIMIT),
  }),
  streams: z.array(streamSourceSchema.extend({
    start: positionSchema,
    end: positionSchema.extend({ publicationComplete: z.literal(true) }),
    receivedSequences: z.array(sequence).max(RECORDER_LOG_LIMIT),
  })).min(1).max(RECORDER_LOG_LIMIT),
});

const evidencePacketSchema = z.strictObject({
  proof: publisherProofSchema,
  // Only the fields used to bind the proof are read here. Stage A still
  // validates the full evidence and page schemas.
  evidence: z.looseObject({
    binding: resultIdentitySchema.extend({ liveRevision: revisionSchema }),
    bar: z.looseObject({ update: updateSchema, finalUpdateConfirmed: z.literal(true) }),
    report: z.looseObject({ calculatedFrom: updateSchema, calculationComplete: z.literal(true) }),
  }),
});
const pagePacketSchema = z.strictObject({
  checkpointId: publisherId, calculationId: publisherId, page: z.unknown(),
});
const equal = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

function publisherCheckpoint(packet: z.infer<typeof evidencePacketSchema>, target: ReaderTarget) {
  const { proof, evidence } = packet;
  const before = proof.start.liveRevision;
  const after = proof.end.liveRevision;
  const { liveRevision, ...resultIdentity } = evidence.binding;
  const { calculationId, ...ledgerIdentity } = proof.ledger;
  const { chartIndex, studyId, pineId, pineVersion } = target;
  if (before.appInstanceId !== after.appInstanceId || before.replaySessionId !== after.replaySessionId ||
      before.revision > after.revision || !equal(after, liveRevision) ||
      (proof.start.id === proof.end.id && !equal(before, after)) ||
      !equal(proof.bar.update, proof.report.calculatedFrom) ||
      !equal(proof.bar.update, evidence.bar.update) ||
      !equal(proof.report.calculatedFrom, evidence.report.calculatedFrom) ||
      !equal(proof.report.target, { chartIndex, studyId, pineId, pineVersion }) ||
      proof.report.checkpointId !== proof.end.id ||
      proof.report.settingsSha256 !== resultIdentity.settingsSha256 ||
      calculationId !== proof.report.calculationId || !equal(resultIdentity, ledgerIdentity)) return null;

  const manifest = proof.streamManifest;
  if (manifest.startCheckpointId !== proof.start.id || manifest.endCheckpointId !== proof.end.id) return null;
  const requiredStreams = new Map<string, (typeof manifest.requiredStreams)[number]>();
  for (const stream of manifest.requiredStreams) {
    const id = JSON.stringify([stream.publisherId, stream.streamId]);
    if (requiredStreams.has(id)) return null;
    requiredStreams.set(id, stream);
  }

  const domains = new Set<string>();
  let receivedCount = 0;
  for (const stream of proof.streams) {
    const id = JSON.stringify([stream.publisherId, stream.streamId]);
    const required = requiredStreams.get(id);
    if (!required || required.streamEpoch !== stream.start.streamEpoch ||
        !equal([...required.domains].sort(), [...stream.domains].sort()) ||
        stream.start.checkpointId !== proof.start.id || stream.end.checkpointId !== proof.end.id ||
        stream.start.streamEpoch !== stream.end.streamEpoch ||
        (proof.start.id === proof.end.id && stream.start.sequence !== stream.end.sequence) ||
        stream.end.sequence - stream.start.sequence !== stream.receivedSequences.length ||
        stream.receivedSequences.some((value, index) => value !== stream.start.sequence + index + 1)) return null;
    receivedCount += stream.receivedSequences.length;
    if (receivedCount > RECORDER_LOG_LIMIT) return null;
    requiredStreams.delete(id);
    for (const domain of stream.domains) domains.add(domain);
  }
  if (requiredStreams.size !== 0 || domains.size !== domainSchema.options.length) return null;
  return { checkpointId: proof.end.id, calculationId, proof };
}

/** The live target to bind before calling checkReplayAdoptionCandidate. */
export async function readReplayTarget(deps: ReplayReaderDeps, chartIndex: number, studyId: string): Promise<ReplayReaderTarget> {
  checkChart(chartIndex, studyId);
  const [diagnosis, snapshot] = await Promise.all([
    deps.diagnose({ chartIndex, expectedStudyId: studyId }),
    deps.evaluate<RecorderSnapshot>(recorderScript("revision", { chartIndex, studyId })),
  ]);
  return liveTarget(chartIndex, diagnosis, snapshot.current);
}

function liveTarget(chartIndex: number, diagnosis: ReplayBarDiagnosis, fp: ReplayFingerprint): ReplayReaderTarget {
  return {
    chartIndex, studyId: diagnosis.studyId ?? "", pineId: diagnosis.pineId ?? "", pineVersion: diagnosis.pineVersion ?? "",
    symbol: diagnosis.symbol ?? "", seriesId: `candles:${fp.seriesSession ?? ""}:${fp.symbol ?? ""}:${fp.resolution ?? ""}`,
    timeframe: diagnosis.resolution as "5",
  };
}

/** Install the passive recorder; Replay must still be stopped so its start is observed. */
export async function installReplayRecorder(deps: ReplayReaderDeps, chartIndex: number, studyId: string) {
  const recorderId = randomBytes(16).toString("hex");
  return deps.evaluate<{ recorderId: string; seq: number; sources: string[] }>(
    recorderScript("install", { chartIndex, studyId, recorderId }));
}

export async function removeReplayRecorder(deps: ReplayReaderDeps, chartIndex: number, studyId: string) {
  return deps.evaluate<{ removed: boolean; left?: number; recorderId?: string }>(recorderScript("remove", { chartIndex, studyId }));
}

/** A ReplayCandidateReader that holds unless a publisher supplies the evidence. */
export function createReplayAdoptionReader(deps: ReplayReaderDeps): ReplayCandidateReader {
  const publisher = deps.publisher;
  // Stage A uses a fresh target object for each read and retains it through
  // the last page. Keep concurrent reads' checkpoint associations independent.
  const checkpoints = new WeakMap<ReaderTarget, NonNullable<ReturnType<typeof publisherCheckpoint>>>();
  return {
    async readLiveRevision(target) {
      return publisher ? publisher.readLiveRevision(target) : null;
    },
    async readEvidence(target) {
      const previous = checkpoints.get(target);
      checkpoints.delete(target);
      if (!publisher) return null;
      const packet = evidencePacketSchema.safeParse(await publisher.readEvidence(target));
      if (!packet.success) return null;
      const checkpoint = publisherCheckpoint(packet.data, target);
      if (!checkpoint || (previous && !equal(previous, checkpoint))) return null;
      checkpoints.set(target, checkpoint);
      return packet.data.evidence;
    },
    async readLedgerPage(target, request) {
      const checkpoint = checkpoints.get(target);
      if (!publisher || !checkpoint) return null;
      const packet = pagePacketSchema.safeParse(await publisher.readLedgerPage(target, { offset: request.offset, limit: request.limit }));
      if (!packet.success || packet.data.checkpointId !== checkpoint.checkpointId ||
          packet.data.calculationId !== checkpoint.calculationId) return null;
      return packet.data.page;
    },
  };
}
