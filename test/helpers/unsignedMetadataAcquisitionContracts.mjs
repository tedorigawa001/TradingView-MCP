import { z } from "zod";
import { uint, digestSchema as hash, label, count, parse, canonical, digest, byteLength, freeze, flags } from "./unsignedControllerData.mjs";

const refuse = reason => { throw Error(`b2m1_${reason}`); };
const nullableHash = hash.nullable(), amount = uint.nullable(), objectId = z.string().regex(/^[a-f0-9]{40}$/);
const pkg = z.enum(["stream-json", "stream-chain"]), kind = z.enum(["npm", "ref", "tag", "commit"]);
const tuple = [{ name: "stream-json", version: "3.8.0" }, { name: "stream-chain", version: "4.4.1" }];
const caps = { attempts: 22, urls: 16, tags_per_package: 4, body_each: 524288, body_total: 8388608,
  headers_each: 16384, header_pairs: 64, deliveries_each: 1024, json_depth: 32, json_nodes: 16384, json_keys: 256,
  scalar_bytes: 65536, numeric_bytes: 128, report_bytes: 1048576, root_ms: 240000, request_ms: 15000, phase_ms: 5000, settle_ms: 10000, timers: 3 };
const profileKeys = ["runtime", "bootstrap", "transport", "address", "tls", "decoder", "clock", "environment", "authorization"];
const parts = ["raw", "incoming", "text", "parser", "projection", "receipts", "bootstrap", "transport"];
const baseline = z.object({ source: hash, manifest: hash, lock: hash }).strict();
const parent = z.object({ kind: z.enum(["ref", "tag"]), key: z.string().max(48) }).strict();
const node = z.object({ package: pkg, kind: z.enum(["ref", "tag", "commit"]), key: z.string().max(48),
  availability: z.enum(["unknown", "present", "unavailable"]),
  expected_type: z.enum(["tag", "commit"]).nullable(), expected_target: objectId.nullable(), tree_id: objectId.nullable(), parents: z.array(parent).max(4) }).strict();
const operation = z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,95}$/), package: pkg, kind, key: z.string().max(48),
  phase: z.enum(["initial", "object", "recheck"]), url: z.string().max(512), body_ceiling: uint, header_ceiling: uint,
  delivery_ceiling: count(2048, 1) }).strict();
const npmData = z.object({ kind: z.literal("npm"), name: z.string().max(32), version: z.string().max(16),
  tarball: z.string().max(128).nullable(), declared_integrity: z.string().max(256).nullable(), git_head: objectId.nullable() }).strict();
const gitData = z.object({ kind: z.enum(["ref", "tag", "commit"]), package: pkg, repository: z.string().max(64), key: z.string().max(48),
  target_type: z.enum(["tag", "commit", "tree", "blob"]).nullable(), target_id: objectId.nullable(), tree_id: objectId.nullable() }).strict();
const jsonSummary = z.object({ utf8: z.enum(["strict_supplied", "invalid", "unknown"]), grammar: z.enum(["strict_supplied", "invalid", "unknown"]),
  bom: z.boolean().nullable(), duplicate_keys: z.boolean().nullable(), root: z.enum(["object", "array", "scalar", "unknown"]),
  depth: count(64).nullable(), nodes: count(32768).nullable(), keys: count(512).nullable(),
  scalar_bytes: amount, numeric_bytes: amount, parsed_bytes: amount }).strict();
const record = z.object({ ordinal: count(32, 1), op_id: z.string().max(96), attempt: label, source: z.literal("synthetic_current_attempt"),
  plan_sha256: hash, previous_receipt_sha256: hash, outcome: z.enum(["observed", "refused", "cancelled", "timeout", "unknown_close"]),
  time: z.object({ domain: z.literal("metadata-summary"), start_ns: amount, end_ns: amount, close_ns: amount, dns_tls_ns: amount, inactivity_ns: amount }).strict(),
  http: z.object({ status: count(599, 100).nullable(), body_bytes: amount, header_bytes: amount, pairs: count(128).nullable(),
    deliveries: count(2048).nullable(), wire_bytes: amount, body_sha256: nullableHash,
    content_length: amount, end: z.boolean().nullable(), complete: z.boolean().nullable(), peer_bound: z.boolean().nullable(),
    tls_bound: z.boolean().nullable(), framing_checked: z.boolean().nullable(), headers_untruncated: z.boolean().nullable(),
    encoding: z.enum(["identity", "other", "unknown"]), media: z.enum(["json_utf8", "other", "unknown"]),
    socket: z.enum(["closed", "open", "unknown"]), timers: z.enum(["closed", "active", "unknown"]), socket_peak: count(2), timer_peak: count(4) }).strict(),
  json: jsonSummary.nullable(), data: z.union([npmData, gitData]).nullable() }).strict();
const schema = z.object({ schema: z.literal("unsigned-metadata-acquisition-v1"), source: z.literal("synthetic_summary"),
  mode: z.enum(["initial", "objects", "final"]), attempt: label, baseline,
  observed_baseline: z.object({ source: nullableHash, manifest: nullableHash, lock: nullableHash }).strict(),
  prior_reports: z.array(z.object({ attempt: label, report_sha256: hash, observed_requests: count(22), source: z.literal("planning_hint") }).strict()).max(16),
  destination: z.literal("memory_only"), operations: z.array(operation).min(1).max(24), graph: z.array(node).max(18),
  profiles: z.object({ ...Object.fromEntries(profileKeys.map(k => [k, nullableHash])),
    reservations: z.object({ parser: amount, transport: amount, bootstrap: amount }).strict() }).strict(),
  clock: z.object({ domain: z.literal("metadata-summary"), start_ns: amount, expires_ns: amount }).strict(),
  budget: z.object({ hash_work_bytes: amount, decode_work_bytes: amount, inspection_units: amount, wire_bytes: amount, heap_bytes: amount }).strict(),
  work: z.object({ hash_passes: amount, decode_passes: amount, inspection_steps: amount, wire_bytes: amount }).strict(),
  memory: z.array(z.object({ phase: z.enum(["receive", "decode", "report"]),
    allocations: z.object(Object.fromEntries(parts.map(k => [k, amount]))).strict(), joint_floor: amount }).strict()).length(3),
  usage: z.array(z.object({ kind, attempted: count(32).nullable(), body_bytes: amount, header_bytes: amount, deliveries: amount }).strict()).length(4),
  approval: z.object({ source: z.literal("supplied_review_summary"), plan_sha256: hash, baseline_sha256: hash, attempt: label,
    profile_sha256: hash, used: z.boolean(), decision: z.enum(["approved_supplied", "pending", "refused"]),
    clock_domain: z.literal("metadata-summary"), now_ns: amount, expires_ns: amount }).strict().nullable(),
  records: z.array(record).max(24) }).strict();
const unique = (values, reason) => { if (new Set(values).size !== values.length) refuse(reason); };
const max = (a, b) => a > b ? a : b;
const bodyFloor = r => max(BigInt(r.http.body_bytes ?? 0), BigInt(r.json?.parsed_bytes ?? 0));
const sum = values => values.reduce((n, v) => n + BigInt(v ?? 0), 0n);
const complete = values => values.every(v => v !== null);
const version = name => tuple.find(p => p.name === name).version;
const nodeKey = n => n.package + "/" + n.kind + "/" + n.key;
function validKey(n) {
  if (n.kind === "npm" ? n.key !== version(n.package) : n.kind === "ref" ? ![version(n.package), "v" + version(n.package)].includes(n.key) : !objectId.safeParse(n.key).success) refuse("operation_key");
}
function locator(n) {
  return n.kind === "npm" ? `https://registry.npmjs.org/${n.package}/${n.key}`
    : `https://api.github.com/repos/uhop/${n.package}/git/${n.kind === "ref" ? "ref/tags" : n.kind === "tag" ? "tags" : "commits"}/${n.key}`;
}
function initialSet() {
  return [...tuple.map(p => ({ package: p.name, kind: "npm", key: p.version })),
    ...tuple.flatMap(p => [p.version, "v" + p.version].map(key => ({ package: p.name, kind: "ref", key })))];
}
function manifest(d, blockers) {
  unique(d.operations.map(o => o.id), "operation_ids"); unique(d.operations.map(o => nodeKey(o) + "/" + o.phase), "operation_duplicate");
  if (d.operations.length > caps.attempts) refuse("attempt_cap");
  if (new Set(d.operations.map(o => o.url)).size > caps.urls) refuse("url_cap");
  for (const o of d.operations) {
    validKey(o); if (o.url !== locator(o)) refuse("operation_url");
    if (BigInt(o.body_ceiling) < 1n || BigInt(o.body_ceiling) > BigInt(caps.body_each)) refuse("body_ceiling");
    if (BigInt(o.header_ceiling) < 1n || BigInt(o.header_ceiling) > BigInt(caps.headers_each)) refuse("header_ceiling");
    if (o.delivery_ceiling > caps.deliveries_each) refuse("delivery_ceiling");
    if (["npm", "ref"].includes(o.kind) ? o.phase === "object" : o.phase !== "object") refuse("operation_phase");
  }
  const expected = initialSet().map(nodeKey), initial = d.operations.filter(o => o.phase === "initial").map(nodeKey), rechecks = d.operations.filter(o => o.phase === "recheck").map(nodeKey);
  if (d.mode === "initial" && (canonical(initial) !== canonical(expected) || d.operations.length !== 6)) refuse("initial_set");
  if (d.mode === "objects" && d.operations.some(o => o.phase !== "object")) refuse("objects_set");
  if (d.mode === "final" && (canonical(initial) !== canonical(expected) || canonical(rechecks) !== canonical(expected)
    || canonical(d.operations.slice(0, 6).map(nodeKey)) !== canonical(expected) || d.operations.slice(-6).some(o => o.phase !== "recheck"))) refuse("final_set");
  for (const k of Object.keys(d.baseline)) {
    if (d.observed_baseline[k] !== null && d.observed_baseline[k] !== d.baseline[k]) refuse("manual_baseline_change");
    if (d.observed_baseline[k] === null) blockers.push("baseline_unavailable");
  }
  unique(d.prior_reports.map(r => r.attempt), "prior_reports");
  if (d.prior_reports.some(r => r.attempt === d.attempt)) refuse("attempt_reuse");
}
function graphPlan(d, blockers) {
  unique(d.graph.map(nodeKey), "graph_duplicate");
  const roots = initialSet().filter(n => n.kind === "ref").map(nodeKey);
  if (canonical(d.graph.filter(n => n.kind === "ref").map(nodeKey).sort()) !== canonical(roots.sort())) refuse("graph_roots");
  if (d.mode === "initial" && d.graph.length !== 4) refuse("initial_graph");
  const nodes = new Map(d.graph.map(n => [nodeKey(n), n]));
  for (const p of tuple) {
    const tags = new Set(d.graph.filter(n => n.package === p.name && n.kind === "tag").map(n => n.key));
    for (const n of d.graph) if (n.package === p.name && n.expected_type === "tag") tags.add(n.expected_target);
    if (tags.size > caps.tags_per_package) refuse("tag_cap");
  }
  for (const n of d.graph) {
    validKey(n); unique(n.parents.map(p => p.kind + "/" + p.key), "parent_duplicate");
    if ((n.expected_type === null) !== (n.expected_target === null)) refuse("graph_target");
    if (n.kind !== "commit" && n.tree_id !== null || n.kind === "commit" && n.expected_type !== null) refuse("graph_target");
    if (n.kind === "ref") {
      if (n.parents.length !== 0 || n.availability !== "present" && n.expected_type !== null) refuse("graph_target");
    } else {
      if (n.availability === "unavailable" || !n.parents.length) refuse("parent_binding");
      for (const parent of n.parents) {
        const p = nodes.get(nodeKey({ package: n.package, ...parent }));
        if (!p || p.availability !== "present" || p.expected_type !== n.kind || p.expected_target !== n.key) refuse("parent_binding");
      }
    }
  }
  const visiting = new Set(), visited = new Set();
  function walk(n) {
    const key = nodeKey(n);
    if (visiting.has(key)) refuse("graph_cycle");
    if (visited.has(key)) return;
    visiting.add(key);
    if (n.expected_type !== null) {
      const child = nodes.get(nodeKey({ package: n.package, kind: n.expected_type, key: n.expected_target }));
      if (child) walk(child);
    }
    visiting.delete(key); visited.add(key);
  }
  d.graph.forEach(walk);
  for (const o of d.operations.filter(o => o.kind !== "npm")) if (!nodes.has(nodeKey(o))) refuse("operation_node");
  for (const n of d.graph.filter(n => n.kind !== "ref")) if (!d.operations.some(o => nodeKey(o) === nodeKey(n))) {
    if (d.mode === "final") refuse("graph_operation_missing");
  }
  if (d.mode === "final") for (const [index, o] of d.operations.entries()) {
    if (o.phase !== "object") continue;
    for (const p of nodes.get(nodeKey(o)).parents) {
      const key = nodeKey({ package: o.package, ...p });
      if (!d.operations.slice(0, index).some(prior => prior.phase !== "recheck" && nodeKey(prior) === key)) refuse("operation_order");
    }
  }
  const resolved = new Map();
  function commit(n) {
    if (n.kind === "commit") return n.key;
    if (n.availability !== "present" || n.expected_type === null) return null;
    const next = nodes.get(nodeKey({ package: n.package, kind: n.expected_type, key: n.expected_target }));
    return next ? commit(next) : null;
  }
  for (const p of tuple) {
    const refs = d.graph.filter(n => n.package === p.name && n.kind === "ref"), commits = refs.map(commit).filter(v => v !== null);
    if (new Set(commits).size > 1) refuse("ambiguous_commit");
    resolved.set(p.name, commits[0] ?? null);
  }
  const closed = d.graph.every(n => n.availability !== "unknown" && (n.kind === "commit" || n.availability === "unavailable"
    || n.expected_type !== null && nodes.has(nodeKey({ package: n.package, kind: n.expected_type, key: n.expected_target }))))
    && tuple.every(p => resolved.get(p.name) !== null && d.graph.filter(n => n.package === p.name && n.kind === "commit").length === 1);
  if (d.mode === "final" && !closed) blockers.push("graph_unavailable");
  return { nodes, resolved, closed };
}
function minimumWire(records, body, headers) {
  let listed = 0n, listedBody = 0n, listedHeaders = 0n, bodySlack = 0n, headerSlack = 0n, sharedSlack = 0n;
  // Only unknown components may use wire slack; both-unknown components share the same space.
  for (const r of records) {
    const b = bodyFloor(r), h = BigInt(r.http.header_bytes ?? 0), w = max(BigInt(r.http.wire_bytes ?? 0), b + h), slack = w - b - h;
    listed += w; listedBody += b; listedHeaders += h;
    if (r.http.body_bytes === null && r.http.header_bytes === null) sharedSlack += slack;
    else if (r.http.body_bytes === null) bodySlack += slack;
    else if (r.http.header_bytes === null) headerSlack += slack;
  }
  const extraBody = max(0n, body - listedBody), extraHeaders = max(0n, headers - listedHeaders);
  const extra = max(max(0n, extraBody - bodySlack - sharedSlack),
    max(extraHeaders - headerSlack - sharedSlack, extraBody + extraHeaders - bodySlack - headerSlack - sharedSlack));
  return listed + extra;
}
function capacity(d, blockers) {
  unique(d.usage.map(u => u.kind), "usage_kinds"); unique(d.memory.map(m => m.phase), "memory_phases");
  const consumed = { attempts: 0, body: 0n, headers: 0n, deliveries: 0n, wire: 0n };
  let usageComplete = true;
  for (const k of ["npm", "ref", "tag", "commit"]) {
    const usage = d.usage.find(u => u.kind === k), records = d.records.filter(r => d.operations.find(o => o.id === r.op_id)?.kind === k);
    const floor = { attempted: records.length, body_bytes: sum(records.map(bodyFloor)),
      header_bytes: sum(records.map(r => r.http.header_bytes)), deliveries: sum(records.map(r => r.http.deliveries)) };
    const attempts = Math.max(usage.attempted ?? 0, floor.attempted);
    consumed.attempts += attempts;
    for (const [field, out] of [["body_bytes", "body"], ["header_bytes", "headers"], ["deliveries", "deliveries"]]) {
      if (usage[field] !== null && BigInt(usage[field]) < floor[field]) refuse("usage_floor");
      consumed[out] += max(BigInt(usage[field] ?? 0), floor[field]);
      usageComplete &&= usage[field] !== null && BigInt(usage[field]) === floor[field];
    }
    if (usage.attempted !== null && usage.attempted < floor.attempted) refuse("usage_floor");
    usageComplete &&= usage.attempted !== null && usage.attempted === floor.attempted
      && records.every(r => complete([r.http.body_bytes, r.http.header_bytes, r.http.deliveries]));
    consumed.wire += minimumWire(records, max(BigInt(usage.body_bytes ?? 0), floor.body_bytes),
      max(BigInt(usage.header_bytes ?? 0), floor.header_bytes));
  }
  if (consumed.attempts > caps.attempts) refuse("attempt_cap");
  if (consumed.body > BigInt(caps.body_total)) refuse("body_total");
  for (const u of d.usage) {
    const planned = d.operations.filter(o => o.kind === u.kind);
    if ((u.attempted ?? 0) > planned.length) refuse("unplanned_attempt");
    if (BigInt(u.body_bytes ?? 0) > sum(planned.map(o => o.body_ceiling))) refuse("body_quota");
    if (BigInt(u.header_bytes ?? 0) > sum(planned.map(o => o.header_ceiling))) refuse("header_quota");
    if (BigInt(u.deliveries ?? 0) > sum(planned.map(o => String(o.delivery_ceiling)))) refuse("delivery_quota");
  }
  if (!usageComplete) blockers.push("usage_unknown");
  const plannedBytes = sum(d.operations.map(o => o.body_ceiling)), reserved = plannedBytes > BigInt(caps.body_total) ? BigInt(caps.body_total) : plannedBytes;
  function cost(passes, ceiling, reason) {
    if (passes !== null && BigInt(passes) === 0n) refuse("work_passes");
    const known = max(1n, BigInt(passes ?? 0)) * max(reserved, consumed.body);
    if (ceiling !== null && known > BigInt(ceiling)) refuse(reason + "_bound");
    if (passes === null || ceiling === null) blockers.push("work_unknown");
    return { known_reserved: known.toString(), modeled_reserved: passes === null ? null : known.toString() };
  }
  const hashWork = cost(d.work.hash_passes, d.budget.hash_work_bytes, "hash_work"), decodeWork = cost(d.work.decode_passes, d.budget.decode_work_bytes, "decode_work");
  const inspectionFloor = BigInt(d.operations.length + d.graph.length) + consumed.deliveries
    + sum(d.records.map(r => r.json?.nodes == null ? null : String(r.json.nodes)));
  if (d.work.inspection_steps !== null && BigInt(d.work.inspection_steps) < inspectionFloor) refuse("inspection_floor");
  const inspection = max(inspectionFloor, BigInt(d.work.inspection_steps ?? 0));
  if (d.budget.inspection_units !== null && inspection > BigInt(d.budget.inspection_units)) refuse("inspection_bound");
  const wireFloor = max(max(reserved, consumed.body) + max(sum(d.operations.map(o => o.header_ceiling)), consumed.headers), consumed.wire);
  if (d.work.wire_bytes !== null && BigInt(d.work.wire_bytes) < wireFloor) refuse("wire_floor");
  const wire = max(wireFloor, BigInt(d.work.wire_bytes ?? 0));
  if (d.budget.wire_bytes !== null && wire > BigInt(d.budget.wire_bytes)) refuse("wire_bound");
  if (!complete([d.work.inspection_steps, d.work.wire_bytes, d.budget.inspection_units, d.budget.wire_bytes])) blockers.push("work_unknown");
  const receiptBytes = byteLength(canonical(d)), projectionBytes = byteLength(canonical(d.records.map(r => r.data)));
  if (receiptBytes + projectionBytes > caps.report_bytes) refuse("report_bound");
  const raw = d.operations.reduce((n, o) => max(n, BigInt(o.body_ceiling)), 0n);
  const floors = { raw, incoming: raw + 1n, text: 2n * raw, projection: BigInt(projectionBytes), receipts: BigInt(receiptBytes),
    parser: BigInt(d.profiles.reservations.parser ?? 0), transport: BigInt(d.profiles.reservations.transport ?? 0), bootstrap: BigInt(d.profiles.reservations.bootstrap ?? 0) };
  let knownPeak = 0n, modeledPeak = 0n, knownAll = complete(Object.values(d.profiles.reservations));
  for (const m of d.memory) {
    let known = 0n;
    for (const k of parts) {
      if (m.allocations[k] !== null && BigInt(m.allocations[k]) < floors[k]) refuse("memory_floor");
      known += max(BigInt(m.allocations[k] ?? 0), floors[k]);
    }
    known = max(known, BigInt(m.joint_floor ?? 0));
    if (d.budget.heap_bytes !== null && known > BigInt(d.budget.heap_bytes)) refuse("memory_bound");
    const all = complete(Object.values(m.allocations)) && m.joint_floor !== null;
    knownAll &&= all; knownPeak = max(knownPeak, known); if (all) modeledPeak = max(modeledPeak, known);
  }
  knownAll &&= d.budget.heap_bytes !== null;
  if (!knownAll) blockers.push("memory_unknown");
  return { planned_attempts: d.operations.length, known_consumed_attempts: consumed.attempts, usage_complete: usageComplete,
    planned_max_body_bytes: plannedBytes.toString(), body_reservation: reserved.toString(),
    body_consumed: { known: consumed.body.toString(), modeled: usageComplete ? consumed.body.toString() : null },
    header_consumed: consumed.headers.toString(), delivery_consumed: consumed.deliveries.toString(),
    hash_work: hashWork, decode_work: decodeWork, inspection: { known: inspection.toString(), modeled: d.work.inspection_steps },
    wire: { known_reserved: wire.toString(), modeled_reserved: d.work.wire_bytes, known_consumed: consumed.wire.toString(),
      modeled_consumed: usageComplete && d.records.every(r => r.http.wire_bytes !== null) ? consumed.wire.toString() : null },
    memory: { known_peak: knownPeak.toString(), modeled_peak: knownAll ? modeledPeak.toString() : null },
    report_bytes: receiptBytes + projectionBytes, refunded: false, heap_runtime_qualified: false, elapsed_time_qualified: false, synchronous_preemption_proven: false };
}
function jsonFacts(r) {
  const j = r.json;
  if (j === null) return false;
  if ((j.depth ?? 0) > caps.json_depth || (j.nodes ?? 0) > caps.json_nodes || (j.keys ?? 0) > caps.json_keys
    || BigInt(j.scalar_bytes ?? 0) > BigInt(caps.scalar_bytes) || BigInt(j.numeric_bytes ?? 0) > BigInt(caps.numeric_bytes)) refuse("json_bound");
  if (j.utf8 === "invalid" || j.grammar === "invalid" || j.bom === true || j.duplicate_keys === true || ["array", "scalar"].includes(j.root)) refuse("json_policy");
  if (j.parsed_bytes !== null && r.http.body_bytes !== null && j.parsed_bytes !== r.http.body_bytes) refuse("parsed_bytes");
  return j.utf8 === "strict_supplied" && j.grammar === "strict_supplied" && j.root === "object" && j.bom === false && j.duplicate_keys === false
    && complete([j.depth, j.nodes, j.keys, j.scalar_bytes, j.numeric_bytes, j.parsed_bytes]) && j.depth > 0 && j.nodes > 0;
}
function resultFacts(d, o, r, previousClose) {
  const t = r.time, b = r.http;
  if (bodyFloor(r) > BigInt(o.body_ceiling)) refuse("body_bound");
  if (BigInt(b.header_bytes ?? 0) > BigInt(o.header_ceiling) || (b.pairs ?? 0) > caps.header_pairs) refuse("header_bound");
  if ((b.deliveries ?? 0) > o.delivery_ceiling) refuse("delivery_bound");
  if (b.socket_peak > 1 || b.timer_peak > caps.timers) refuse("resource_peak");
  if (b.content_length !== null && b.body_bytes !== null && b.content_length !== b.body_bytes && b.complete === true) refuse("content_length");
  if (b.wire_bytes !== null && BigInt(b.wire_bytes) < bodyFloor(r) + BigInt(b.header_bytes ?? 0)) refuse("wire_floor");
  if (t.start_ns !== null && (BigInt(t.start_ns) < BigInt(d.clock.start_ns) || previousClose !== null && BigInt(t.start_ns) < previousClose)) refuse("clock_regression");
  for (const [a, z] of [[t.start_ns, t.end_ns], [t.end_ns, t.close_ns]]) if (a !== null && z !== null && BigInt(z) < BigInt(a)) refuse("clock_regression");
  if (r.outcome === "observed") {
    if (t.end_ns !== null && BigInt(t.end_ns) > BigInt(d.clock.expires_ns) || t.start_ns !== null && t.end_ns !== null
      && BigInt(t.end_ns) - BigInt(t.start_ns) > BigInt(caps.request_ms) * 1000000n) refuse("deadline");
    if (t.close_ns !== null && t.end_ns !== null && BigInt(t.close_ns) - BigInt(t.end_ns) > BigInt(caps.settle_ms) * 1000000n) refuse("settlement");
    if (BigInt(t.dns_tls_ns ?? 0) > BigInt(caps.phase_ms) * 1000000n || BigInt(t.inactivity_ns ?? 0) > BigInt(caps.phase_ms) * 1000000n) refuse("phase_deadline");
  }
  if (t.start_ns !== null && t.end_ns !== null) {
    const elapsed = BigInt(t.end_ns) - BigInt(t.start_ns);
    if ([t.dns_tls_ns, t.inactivity_ns].some(v => v !== null && BigInt(v) > elapsed)) refuse("phase_duration");
  }
  const validJson = jsonFacts(r);
  if (r.outcome !== "observed") return false;
  if (b.status !== null && b.status !== 200 && !(o.kind === "ref" && b.status === 404)) refuse("http_status");
  if (b.encoding === "other" || b.status === 200 && b.media === "other") refuse("http_policy");
  const completeTime = complete(Object.values(t)), completeHttp = complete([b.status, b.body_bytes, b.header_bytes, b.pairs, b.deliveries, b.wire_bytes])
    && b.end === true && b.complete === true && b.peer_bound === true && b.tls_bound === true && b.framing_checked === true
    && b.headers_untruncated === true && b.encoding === "identity" && b.socket === "closed" && b.timers === "closed";
  if (b.status === 404) {
    if (r.data !== null || r.json !== null) refuse("absent_data");
    return completeTime && completeHttp;
  }
  return completeTime && completeHttp && b.status === 200 && b.media === "json_utf8" && b.body_sha256 !== null && validJson && r.data !== null;
}
function observation(d, o, r, graph) {
  const value = r.data;
  if (value.kind !== o.kind) refuse("response_identity");
  if (o.kind === "npm") {
    if (value.name !== o.package || value.version !== version(o.package)) refuse("response_identity");
    const tarball = `https://registry.npmjs.org/${o.package}/-/${o.package}-${version(o.package)}.tgz`;
    if (value.tarball !== null && value.tarball !== tarball) refuse("tarball_declaration");
  } else {
    if (value.package !== o.package || value.repository !== "uhop/" + o.package || value.key !== o.key) refuse("response_identity");
    if (o.kind === "commit" ? value.target_type !== null || value.target_id !== null : value.tree_id !== null) refuse("object_target");
    if (["tree", "blob"].includes(value.target_type) || (value.target_type === null) !== (value.target_id === null)) refuse("object_target");
    const expected = graph.nodes.get(nodeKey(o));
    if (expected.availability === "unavailable" || expected.expected_type !== null
      && (value.target_type !== expected.expected_type || value.target_id !== expected.expected_target)
      || expected.tree_id !== null && value.tree_id !== expected.tree_id) refuse("graph_observation");
  }
}
function graphObservations(d, observed, npm, blockers) {
  const proposals = new Map();
  for (const [key, r] of observed) {
    if (r.http.status === 404) continue;
    const value = r.data;
    if (value.target_type === null) continue;
    const child = { package: value.package, kind: value.target_type, key: value.target_id };
    const next = observed.get(nodeKey(child));
    if (!next) {
      if (d.operations.some(o => nodeKey(o) === nodeKey(child) && o.phase === "object")) continue;
      if (d.mode === "final") refuse("unapproved_followup");
      const proposal = proposals.get(nodeKey(child)) ?? { ...child, url: locator(child), parents: [], authorizes_request: false };
      proposal.parents.push({ key, body_sha256: r.http.body_sha256 }); proposals.set(nodeKey(child), proposal);
    }
  }
  for (const p of tuple) {
    const tags = new Set(d.graph.filter(n => n.package === p.name && n.kind === "tag").map(n => n.key));
    for (const n of d.graph) if (n.package === p.name && n.expected_type === "tag") tags.add(n.expected_target);
    for (const r of observed.values()) if (r.data?.package === p.name && r.data.target_type === "tag") tags.add(r.data.target_id);
    if (tags.size > caps.tags_per_package) refuse("tag_cap");
  }
  function resolve(n, visiting = new Set()) {
    const key = nodeKey(n);
    if (visiting.has(key)) refuse("graph_cycle");
    if (n.kind === "commit") return n.key;
    const r = observed.get(key); if (!r || r.http.status === 404 || r.data.target_type === null) return null;
    visiting.add(key);
    const result = resolve({ package: n.package, kind: r.data.target_type, key: r.data.target_id }, visiting);
    visiting.delete(key); return result;
  }
  for (const r of observed.values()) if (r.http.status === 200) resolve(r.data);
  const pins = tuple.map(p => {
    const commits = d.graph.filter(n => n.package === p.name && n.kind === "ref").map(n => resolve(n)).filter(v => v !== null);
    if (new Set(commits).size > 1) refuse("ambiguous_commit");
    const peeled = commits[0] ?? null, metadata = npm.get(p.name)?.data ?? null;
    if (peeled !== null && metadata?.git_head != null && peeled !== metadata.git_head) refuse("git_head_mismatch");
    const integrity = metadata?.declared_integrity ?? null;
    const canonicalSri = integrity !== null && /^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)
      && "sha512-" + Buffer.from(integrity.slice(7), "base64").toString("base64") === integrity ? integrity : null;
    if (canonicalSri === null) blockers.push("integrity_unavailable");
    if (metadata?.git_head == null) blockers.push("git_head_unavailable");
    const object = peeled === null ? null : observed.get(nodeKey({ package: p.name, kind: "commit", key: peeled }));
    return { package: p.name, version: p.version, tarball: metadata?.tarball ?? null, proposed_integrity: canonicalSri,
      declared_integrity_sha256: integrity === null ? null : digest(integrity), registry_git_head: metadata?.git_head ?? null,
      peeled_commit: peeled, commit_tree: object?.data?.tree_id ?? null, actual_package_sha256: null };
  });
  return { proposals: [...proposals.values()], pin_proposals: pins };
}
function replay(d, planHash, graph, budget, preflight, blockers) {
  let receipt = digest({ plan_sha256: planHash }), state = preflight ? "PLAN_ONLY" : "PREFLIGHT_BLOCKED", previousClose = null, stopped = false;
  const records = [], observed = new Map(), npm = new Map(), first = new Map();
  if (d.records.length && !preflight) refuse("preflight_unavailable");
  if (d.records.length) {
    const a = d.approval;
    if (!a) refuse("approval_unavailable");
    if (a.plan_sha256 !== planHash || a.baseline_sha256 !== digest(d.baseline) || a.profile_sha256 !== digest(d.profiles) || a.attempt !== d.attempt) refuse("approval_binding");
    if (a.used || d.prior_reports.some(r => r.attempt === a.attempt)) refuse("approval_replay");
    if (a.decision !== "approved_supplied") refuse("approval_pending");
    if (a.now_ns === null || a.expires_ns === null || a.now_ns !== d.clock.start_ns || a.expires_ns !== d.clock.expires_ns || a.clock_domain !== d.clock.domain) refuse("approval_clock");
  }
  for (const r of d.records) {
    if (stopped) refuse("terminal_progress");
    const o = d.operations[records.length];
    if (!o || r.op_id !== o.id || r.ordinal !== records.length + 1) refuse("record_order");
    if (r.attempt !== d.attempt || r.plan_sha256 !== planHash || r.previous_receipt_sha256 !== receipt) refuse("record_binding");
    const usable = resultFacts(d, o, r, previousClose);
    if (!usable) { state = r.outcome === "refused" ? "REFUSED" : "STOPPED_UNKNOWN"; stopped = true; }
    else {
      if (r.http.status === 200) observation(d, o, r, graph);
      else if (graph.nodes.get(nodeKey(o))?.availability === "present") refuse("graph_observation");
      if (o.phase === "recheck") {
        const prior = first.get(nodeKey(o));
        if (!prior || prior.http.status !== r.http.status || r.http.status === 200
          && (prior.http.body_sha256 !== r.http.body_sha256 || prior.http.body_bytes !== r.http.body_bytes
            || canonical(prior.data) !== canonical(r.data) || canonical(prior.json) !== canonical(r.json))) refuse("recheck_binding");
      } else { first.set(nodeKey(o), r); if (o.kind === "npm") npm.set(o.package, r); else observed.set(nodeKey(o), r); }
      previousClose = BigInt(r.time.close_ns); state = "DISCOVERY_OBSERVED_PARTIAL";
    }
    receipt = digest({ previous_receipt_sha256: receipt, record: r });
    records.push({ ordinal: r.ordinal, op_id: r.op_id, outcome: r.outcome, receipt_sha256: receipt });
  }
  const observations = graphObservations(d, observed, npm, blockers);
  if (!stopped && d.records.length) {
    if (!budget.usage_complete) state = "STOPPED_UNKNOWN";
    else if (d.records.length === d.operations.length) {
      if (d.mode === "final") state = observations.pin_proposals.every(p => p.peeled_commit !== null && p.commit_tree !== null)
        ? "FINAL_METADATA_OBSERVED_UNREVIEWED" : "DISCOVERY_OBSERVED_PARTIAL";
      else if (observations.proposals.length) state = "AWAITING_EXACT_URL_REVIEW";
    }
  }
  return { model_state: state, receipt_sha256: receipt, records, ...observations };
}
function describe(input) {
  const d = parse(schema, input), blockers = [];
  manifest(d, blockers);
  const graph = graphPlan(d, blockers);
  if (profileKeys.some(k => d.profiles[k] === null)) blockers.push("profiles_unavailable");
  if (!complete([d.clock.start_ns, d.clock.expires_ns])) blockers.push("clock_unavailable");
  else if (BigInt(d.clock.expires_ns) <= BigInt(d.clock.start_ns) || BigInt(d.clock.expires_ns) - BigInt(d.clock.start_ns) > BigInt(caps.root_ms) * 1000000n) refuse("clock_window");
  const budget = capacity(d, blockers);
  const planHash = digest({ schema: d.schema, mode: d.mode, attempt: d.attempt, baseline: d.baseline, prior_reports: d.prior_reports,
    operations: d.operations, graph: d.graph, profiles: d.profiles, clock: d.clock, destination: d.destination, caps, work: d.work, memory: d.memory, budget: d.budget });
  const preflight = !blockers.some(b => b !== "usage_unknown");
  const state = replay(d, planHash, graph, budget, preflight, blockers);
  const out = { ...flags(), scope: "unsigned_metadata_acquisition_memory_only", ...state, plan_sha256: planHash,
    blockers: [...new Set(blockers)], caps,
    model_prerequisites_complete: preflight, capacity: budget,
    metadata_parser_executed: false, actual_metadata_verified: false, producer_available: false, network_available: false,
    metadata_parser_available: false, tls_qualified: false, pin_frozen: false, tarball_bytes_verified: false, signature_verified: false,
    runtime_producers: "unavailable" };
  if (byteLength(canonical(out)) > 16384) refuse("diagnostic_bound");
  return freeze(out);
}
export function planUnsignedMetadataAcquisition(input) { return describe(input); }
export function describeUnsignedMetadataAcquisitionCapacity(input) { return describe(input); }
