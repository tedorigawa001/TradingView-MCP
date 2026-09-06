import { openSync, closeSync, readFileSync, fstatSync, lstatSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { artifacts, tools, run } from './build.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const integer = (n, name, min = 0) => {
  if (!Number.isSafeInteger(n) || n < min || n > 2147483647) throw new Error(`invalid ${name}`);
  return n;
};

export function parseRaw(bytes) {
  if (!bytes.length || bytes.at(-1) !== 10) throw new Error('incomplete JSONL tail');
  let previous = null, snapshot = false, stopped = false;
  const rows = bytes.toString('utf8').trimEnd().split('\n').map((line, index) => {
    const r = JSON.parse(line);
    if (r.schema_version !== '1.2' || r.source !== 'bookmap') throw new Error('unsupported provenance');
    if (stopped) throw new Error('data after collector stop');
    if (!['instrument', 'snapshot_end', 'collector_stop', 'trade', 'depth', 'bbo'].includes(r.event_type)) throw new Error('unknown event');
    if (index > 0 && r.event_type === 'instrument') throw new Error('multiple instruments');
    let ns = null;
    if (r.bookmap_time_ns !== null) {
      if (typeof r.bookmap_time_ns !== 'string' || !/^\d+$/.test(r.bookmap_time_ns)) throw new Error('invalid clock');
      ns = BigInt(r.bookmap_time_ns);
      if (ns > 9223372036854775807n || (previous !== null && ns < previous)) throw new Error('clock regression or overflow');
      previous = ns;
    }
    if (r.event_type === 'snapshot_end') { if (snapshot) throw new Error('duplicate snapshot'); snapshot = true; }
    if (r.event_type === 'collector_stop') stopped = true;
    if (r.event_type === 'depth') integer(r.price_level, 'price level', 1);
    if (['trade', 'depth'].includes(r.event_type)) integer(r.size, 'size');
    if (r.event_type === 'trade' && (!Number.isFinite(r.price_level) || r.price_level <= 0 || r.price_level > 2147483647)) throw new Error('invalid trade price level');
    if (r.event_type === 'trade' && (!['buy','sell','unknown'].includes(r.aggressor) || r.is_otc !== false)) throw new Error('unsupported trade metadata');
    if (r.event_type === 'bbo') for (const key of ['bid_price_level','ask_price_level','bid_size','ask_size']) integer(r[key], key);
    return { ...r, ns, index, afterSnapshot: snapshot };
  });
  const meta = rows[0];
  if (meta.event_type !== 'instrument' || meta.exchange !== 'CME' || !/^6E[A-Z]\d+$/.test(meta.symbol)
      || meta.is_crypto !== false || meta.is_full_depth !== true || meta.mbo_captured !== false
      || meta.depth_listener_representation !== 'price_level_aggregated'
      || meta.tick_size !== 0.00005 || meta.multiplier !== 125000 || meta.size_multiplier !== 1
      || meta.data_delay_raw !== 900000000000) throw new Error('unsupported instrument contract');
  if (rows.some(r => r.instrument_alias !== meta.instrument_alias)) throw new Error('instrument alias mismatch');
  if (!snapshot) throw new Error('missing snapshot');
  return rows;
}

export function quoteCoverage(rows, signals, { horizonMs, toleranceMs }) {
  integer(horizonMs, 'horizonMs', 1); integer(toleranceMs, 'toleranceMs', 1);
  const tolerance = BigInt(toleranceMs) * 1000000n;
  const quotes = rows.filter(r => r.event_type === 'bbo' && r.ns !== null && r.afterSnapshot
    && r.bid_price_level > 0 && r.ask_price_level > r.bid_price_level && r.bid_size > 0 && r.ask_size > 0);
  let occupiedUntil = -1;
  return signals.map(s => {
    if (!['BUY','SELL'].includes(s.direction)) throw new Error('invalid signal direction');
    const r = rows[s.index];
    if (!r || r.event_type !== 'trade' || r.ns === null) throw new Error('unbound signal');
    const base = { ...s, signal_time_ns: r.bookmap_time_ns, entry: null, exit: null };
    if (s.episodeIndex !== 1) return { ...base, status: 'same_episode' };
    if (s.index <= occupiedUntil) return { ...base, status: 'position_overlap' };
    const entry = quotes.find(q => q.index > s.index && q.ns >= r.ns);
    if (!entry || entry.ns - r.ns > tolerance) return { ...base, status: 'entry_unavailable' };
    const deadline = entry.ns + BigInt(horizonMs) * 1000000n;
    const exit = quotes.find(q => q.index > entry.index && q.ns >= deadline);
    occupiedUntil = exit && exit.ns - deadline <= tolerance ? exit.index : rows.length;
    const quote = (q, entering) => ({ index: q.index, time_ns: q.bookmap_time_ns,
      price_level: (s.direction === 'BUY') === entering ? q.ask_price_level : q.bid_price_level });
    const entered = { ...base, entry: quote(entry, true) };
    if (!exit || exit.ns - deadline > tolerance) return { ...entered, status: 'exit_unavailable' };
    return { ...entered, exit: quote(exit, false), status: 'quote_endpoints_available' };
  });
}

export function replayFile(path, config) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 64 * 1024 * 1024) throw new Error('unsafe or oversized raw file');
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let bytes;
  try {
    const before = fstatSync(fd);
    if (before.ino !== stat.ino || before.dev !== stat.dev) throw new Error('file replaced');
    bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs || bytes.length > 64 * 1024 * 1024) throw new Error('file changed during read');
  } finally { closeSync(fd); }
  const rows = parseRaw(bytes);
  for (const key of ['minimumTrades','minimumLevels','windowMs','episodeGapMs']) integer(config[key], key, 1);
  const trades = rows.filter(r => r.event_type === 'trade' && r.afterSnapshot && r.ns !== null);
  if (rows.some(r => r.afterSnapshot && r.event_type === 'trade' && r.ns === null)) throw new Error('trade missing clock');
  const input = trades.map(r => [r.index,r.bookmap_time_ns,r.price_level,r.size,r.aggressor].join('\t')).join('\n') + '\n';
  const args = ['-cp', artifacts.classes, 'jp.bushido.bookmap.FlowSweepReplay', ...['minimumTrades','minimumLevels','windowMs','episodeGapMs'].map(k => String(config[k]))];
  const execute = () => run(tools.java, args, { capture: true, input: trades.length ? input : '', maxBuffer: 32 * 1024 * 1024, timeout: 60000 });
  const output = execute();
  if (output !== execute()) throw new Error('nondeterministic replay');
  const lines = output.trim().split(/\r?\n/);
  const [tag, policy, normalized, rejected, eligiblePositive, normalizedPositive] = lines.pop().split('\t');
  if (tag !== '#normalization' || policy !== 'nearest_integer_within_4_ulps_v1') throw new Error('unsupported replay price policy');
  for (const n of [normalized,rejected,eligiblePositive,normalizedPositive]) {
    if (!/^\d+$/.test(n ?? '')) throw new Error('invalid normalization count');
  }
  const signals = lines.map(line => {
    const [index,direction,trades,levels,volume,episode,episodeIndex] = line.split('\t');
    return {index:Number(index),direction,trades:Number(trades),levels:Number(levels),volume:Number(volume),episode:Number(episode),episodeIndex:Number(episodeIndex)};
  });
  const evidence = quoteCoverage(rows, signals, config);
  const classDir = resolve(artifacts.classes, 'jp/bushido/bookmap');
  const classHashes = Object.fromEntries(readdirSync(classDir).filter(n => /^Flow(?:SignalEngine|SweepReplay)(?:\$.*)?\.class$/.test(n)).sort().map(n => [n, hash(readFileSync(resolve(classDir,n)))]));
  return { source_file: resolve(path), raw_sha256: hash(bytes), engine_sha256: hash(readFileSync(resolve(artifacts.addon,'src/main/java/jp/bushido/bookmap/FlowSignalEngine.java'))), replay_class_sha256: classHashes, config,
    deterministic_replay: true, positive_trade_callbacks: trades.filter(r => r.size > 0).length,
    price_level_policy: policy,
    eligible_positive_trade_callbacks: Number(eligiblePositive),
    normalized_price_callbacks: Number(normalized),
    normalized_positive_trade_callbacks: Number(normalizedPositive),
    off_grid_price_callbacks_excluded: Number(rejected),
    sweep_signals: signals.length, evidence_counts: evidence.reduce((a,r) => ({...a,[r.status]:(a[r.status]??0)+1}),{}),
    limitations: ['quote_endpoints_do_not_prove_continuous_feed_or_executable_fills','latest_bookmap_listener_clock_not_exchange_execution_timestamp','commission_not_configured_no_profit_verdict', ...(rows.at(-1).event_type === 'collector_stop' ? [] : ['missing_collector_stop'])], evidence };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [configPath, ...paths] = process.argv.slice(2);
  if (!configPath || !paths.length) throw new Error('usage: node bookmap-addon/replay.mjs CONFIG.json RAW.jsonl [...]');
  const config = JSON.parse(readFileSync(configPath,'utf8'));
  process.stderr.write(run(process.execPath, [resolve(artifacts.addon, 'build.mjs')], { capture: true, timeout: 120000 }));
  for (const path of paths) console.log(JSON.stringify(replayFile(path, config)));
}
