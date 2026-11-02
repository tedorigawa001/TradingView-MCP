import { z } from "zod";
import { uint, digestSchema as hash, count, parse, canonical, digest, byteLength, freeze, flags } from "./unsignedControllerData.mjs";

const refuse = reason => { throw Error(`cc4c2cb2a_${reason}`); };
const amount = uint.nullable(), nullableHash = hash.nullable();
const tuple = [{ name: "stream-json", version: "3.8.0" }, { name: "stream-chain", version: "4.4.1" }];
const options = { packKeys: false, packStrings: false, packNumbers: false, streamKeys: true, streamStrings: true, streamNumbers: true, jsonStreaming: false };
const stages = ["UNAVAILABLE", "OBSERVED_UNREVIEWED", "EXPECTED_PINS_FROZEN", "ARCHIVE_BYTES_MATCHED", "STATIC_AUDIT_MATCHED", "DECLARED_ONLY", "MATERIALIZED_STATIC_MATCHED"];
const caps = { metadata_each: 524288, metadata_total: 8388608, compressed_each: 4194304, compressed_total: 8388608,
  decoded_each: 16777216, decoded_total: 33554432, regular_each: 256, members_each: 1024, file_each: 4194304,
  manifest_each: 524288, json_depth: 32, json_nodes: 16384, json_keys: 256, scalar_bytes: 65536, numeric_bytes: 128,
  path_bytes: 240, path_segments: 16, source_total: 33554432, responses: 528, received_total: 50331648,
  receipt_bytes: 1048576, persisted_bytes: 51380224, persisted_files: 530 };
const base = z.object({ source: hash, manifest: hash, lock: hash }).strict();
const pins = z.object({ integrity: z.string().regex(/^sha512-[A-Za-z0-9+/]{86}==$/).nullable(),
  commit: z.string().regex(/^[a-f0-9]{40}$/).nullable(), files_sha256: nullableHash, exports_sha256: nullableHash, entry_sha256: nullableHash }).strict();
const member = z.object({ path: z.string().max(512), type: z.enum(["file", "directory", "symlink", "hardlink", "device", "fifo", "socket", "extension"]),
  bytes: uint, sha256: nullableHash, extended: z.boolean(), sparse: z.boolean(), privileged: z.boolean() }).strict();
const archive = z.object({ compressed_bytes: amount, decoded_bytes: amount, header_padding_bytes: amount,
  logical_members: count(2048).nullable(), regular_files: count(512).nullable(), inventory_complete: z.boolean(),
  member_pages: z.array(z.array(member).max(256)).max(4),
  json: z.object({ depth: count(64), nodes: count(32768), keys: count(512), scalar_bytes: uint, numeric_bytes: uint, manifest_bytes: uint, license_bytes: uint }).strict() }).strict();
const resources = ["metadata", "compressed_json", "compressed_chain", "decoded_json", "decoded_chain", "source", "receipt", "scratch"];
const auditRows = ["manifest_identity", "license", "engines_platform", "exports_imports", "dependency_kinds",
  "scripts_bin_lifecycle", "native_wasm_shrinkwrap", "static_edges", "top_level_effects", "source_work_bounds"];
const response = z.object({ kind: z.enum(["metadata", "archive", "source"]), bytes: amount, complete: z.boolean() }).strict();
const sourceMapping = z.object({ package: z.enum(["stream-json", "stream-chain"]), path: z.string().max(256), url: z.string().max(512),
  package_sha256: nullableHash, source_sha256: nullableHash }).strict();
const approval = z.object({ source: z.literal("supplied_review_summary"), plan_sha256: hash, baseline_sha256: hash,
  previous_receipt_sha256: hash, stage: z.enum(stages.slice(1)), attempt: z.literal(1), used: z.boolean(),
  decision: z.enum(["approved_supplied", "pending", "refused"]), clock_review_sha256: nullableHash,
  clock_domain: z.string().regex(/^[a-z][a-z0-9-]{0,47}$/), now_ns: amount, expires_ns: amount }).strict();
const event = z.object({ ordinal: count(16, 1), stage: z.enum(stages.slice(1)), outcome: z.enum(["matched_supplied", "refused", "cancelled", "unknown"]),
  plan_sha256: hash, previous_receipt_sha256: hash, approval: approval.nullable(),
  evidence_sha256: hash, result: z.enum(["summary_only", "declaration_only", "static_layout_only"]) }).strict();
const schema = z.object({ schema: z.literal("unsigned-parser-dependency-audit-v1"), baseline: base,
  observed_baseline: z.object({ source: nullableHash, manifest: nullableHash, lock: nullableHash }).strict(), previous_receipt_sha256: nullableHash,
  previous_stage: z.enum([...stages, "REFUSED", "STOPPED_UNKNOWN"]),
  previous_clock: z.object({ clock_domain: z.literal("audit-summary"), review_sha256: hash, now_ns: uint }).strict().nullable(),
  profile: z.object({ entry: z.literal("stream-json/core/parser.js:jsonParser"), target: z.literal("stream-json/src/core/parser.js"),
    runtime_sha256: nullableHash, options: z.object(Object.fromEntries(Object.keys(options).map(k => [k, z.boolean()]))).strict() }).strict(),
  destination: z.literal("memory_only"),
  packages: z.array(z.object({ name: z.enum(["stream-json", "stream-chain"]), version: z.string().max(16),
    expected: z.object({ pins, review_sha256: hash, previous_receipt_sha256: nullableHash }).strict().nullable(),
    observed: z.object({ pins, source: z.literal("synthetic_summary"), stage: z.enum(["metadata", "static"]),
      metadata_sha256: nullableHash, metadata_bytes: amount }).strict().nullable(), archive: archive.nullable(),
    audit_rows: z.array(z.object({ kind: z.enum(auditRows), state: z.enum(["matched_supplied", "unavailable", "refused"]),
      evidence_sha256: nullableHash }).strict()).length(auditRows.length).nullable() }).strict()).length(2),
  url_pages: z.array(z.array(z.string().max(512)).max(128)).max(5),
  tools: z.object({ transport_sha256: nullableHash, metadata_decoder_sha256: nullableHash, inspector_sha256: nullableHash, bootstrap_review_sha256: nullableHash,
    clock_review_sha256: nullableHash, clock_domain: z.literal("audit-summary") }).strict(),
  graph: z.object({ sha256: nullableHash, expected_sha256: nullableHash, closure_sha256: nullableHash, options_sha256: nullableHash,
    runtime_sha256: nullableHash, edges_enumerated: z.boolean().nullable(), unresolved_edges: count(1024).nullable(),
    source_mapping: z.boolean().nullable(), mapping_pages: z.array(z.array(sourceMapping).max(128)).max(4),
    initialization_decision: z.enum(["pending", "proposed_reviewed", "refused"]),
    source_count: count(512).nullable(), source_bytes: amount }).strict(),
  diff: z.object({ manifest_before: hash, lock_before: hash, manifest_after: nullableHash, lock_after: nullableHash,
    entries: z.array(z.string().max(128)).max(16), unrelated_changes: z.boolean().nullable() }).strict(),
  placement: z.object({ inventory_sha256: nullableHash, expected_inventory_sha256: nullableHash,
    paths_sha256: nullableHash, expected_paths_sha256: nullableHash, files: count(512).nullable(), expected_files: count(512).nullable() }).strict(),
  work: z.object({ response_pages: z.array(z.array(response).max(176)).max(3), hash_passes: amount, decode_passes: amount,
    hash_byte_ceiling: amount, decode_byte_ceiling: amount, inspection_steps: amount, step_ceiling: amount }).strict(),
  memory: z.array(z.object({ phase: z.enum(["receive", "inspect", "report"]),
    allocations: z.object(Object.fromEntries(resources.map(k => [k, amount]))).strict(), joint_floor: amount, ceiling: amount }).strict()).length(3),
  events: z.array(event).max(16) }).strict();
const unique = (values, reason) => { if (new Set(values).size !== values.length) refuse(reason); };
const max = (a, b) => a > b ? a : b;
const sum = values => values.reduce((n, v) => n + BigInt(v ?? 0), 0n);
const complete = values => values.every(v => v !== null);
function memberPath(path) {
  if (!/^[A-Za-z0-9._/-]+$/.test(path) || byteLength(path) > caps.path_bytes) refuse("member_path");
  const parts = path.split("/");
  if (parts.length > caps.path_segments || parts.some(p => !p || p === "." || p === "..")) refuse("member_path");
  return parts;
}
function urls(d) {
  const values = d.url_pages.flat();
  if (values.length > caps.responses) refuse("url_count");
  unique(values, "url_duplicate");
  for (const value of values) {
    let url; try { url = new URL(value); } catch { refuse("url_origin"); }
    if (url.href !== value || url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) refuse("url_origin");
    const registry = tuple.flatMap(p => [`/${p.name}/${p.version}`, `/${p.name}/-/${p.name}-${p.version}.tgz`]);
    if (url.hostname === "registry.npmjs.org" && registry.includes(url.pathname)) continue;
    const match = /^\/(?:repos\/)?uhop\/(stream-json|stream-chain)\/(.+)$/.exec(url.pathname);
    if (!match) refuse("url_origin");
    const p = d.packages.find(p => p.name === match[1]), suffix = match[2];
    if (url.hostname === "api.github.com" && (suffix === "git/ref/tags/" + p.version || suffix === "git/ref/tags/v" + p.version
      || /^git\/(?:tags|commits)\/[a-f0-9]{40}$/.test(suffix)) && url.pathname.startsWith("/repos/")) continue;
    if (url.hostname !== "raw.githubusercontent.com" || url.pathname.startsWith("/repos/")) refuse("url_origin");
    const slash = suffix.indexOf("/"), commit = suffix.slice(0, slash), path = suffix.slice(slash + 1);
    if (!p.expected?.pins.commit) refuse("source_pin_unavailable");
    if (slash < 0 || commit !== p.expected.pins.commit) refuse("source_commit");
    memberPath(path);
  }
}
function identity(d, blockers) {
  unique(d.packages.map(p => p.name), "package_set");
  for (const selected of tuple) {
    const p = d.packages.find(p => p.name === selected.name);
    if (!p || p.version !== selected.version) refuse("evaluation_tuple");
    for (const value of [p.expected?.pins, p.observed?.pins]) if (value) for (const sri of [value.integrity]) {
      if (sri !== null && "sha512-" + Buffer.from(sri.slice(7), "base64").toString("base64") !== sri) refuse("integrity_encoding");
    }
    if (p.expected && p.expected.previous_receipt_sha256 !== d.previous_receipt_sha256) refuse("expected_review_binding");
    for (const k of Object.keys(pins.shape)) {
      const a = p.expected?.pins[k] ?? null, b = p.observed?.pins[k] ?? null;
      if (a !== null && b !== null && a !== b) refuse("pin_mismatch");
      if (a === null) blockers.push("expected_pins_unavailable");
      if (b === null) blockers.push("observed_pins_unavailable");
    }
  }
  for (const k of ["integrity", "commit", "files_sha256"]) {
    const [a, b] = d.packages.map(p => [p.expected?.pins[k], p.observed?.pins[k]].filter(v => v != null));
    if (a.some(v => b.includes(v))) refuse("package_identity_alias");
  }
  if (canonical(d.profile.options) !== canonical(options)) refuse("parser_options");
  for (const k of Object.keys(d.baseline)) {
    if (d.observed_baseline[k] !== null && d.observed_baseline[k] !== d.baseline[k]) refuse("manual_baseline_change");
    if (d.observed_baseline[k] === null) blockers.push("baseline_unavailable");
  }
  if (d.diff.manifest_before !== d.baseline.manifest || d.diff.lock_before !== d.baseline.lock) refuse("diff_baseline");
}
function inventory(p, blockers) {
  const a = p.archive;
  if (!a) { blockers.push("archive_unavailable"); return { known_payload: 0n, known_decoded: 0n, known_regular: 0, known_members: 0, complete: false }; }
  if (BigInt(a.compressed_bytes ?? 0) > BigInt(caps.compressed_each)) refuse("compressed_bound");
  if (BigInt(a.decoded_bytes ?? 0) > BigInt(caps.decoded_each)) refuse("decoded_bound");
  if ((a.logical_members ?? 0) > caps.members_each) refuse("member_count");
  if ((a.regular_files ?? 0) > caps.regular_each) refuse("regular_count");
  const j = a.json;
  if (j.depth > caps.json_depth || j.nodes > caps.json_nodes || j.keys > caps.json_keys
    || BigInt(j.scalar_bytes) > BigInt(caps.scalar_bytes) || BigInt(j.numeric_bytes) > BigInt(caps.numeric_bytes)
    || BigInt(j.manifest_bytes) > BigInt(caps.manifest_each) || BigInt(j.license_bytes) > BigInt(caps.manifest_each)) refuse("metadata_bound");
  const members = a.member_pages.flat(), seen = new Map();
  let regular = 0, payload = 0n, rounding = 0n;
  for (const m of members) {
    if (!["file", "directory"].includes(m.type)) refuse("member_type");
    if (m.extended || m.sparse || m.privileged) refuse("member_flags");
    if (!m.path.startsWith("package/")) refuse("member_root");
    const root = m.path === "package/", relative = m.path.slice(8);
    if (!root) memberPath(relative);
    const key = relative.toLowerCase();
    if (seen.has(key) || [...seen].some(([prior, type]) => type === "file" && key.startsWith(prior + "/")
      || m.type === "file" && prior.startsWith(key + "/"))) refuse("member_alias");
    seen.set(key, m.type);
    if (m.type === "directory") {
      if (m.bytes !== "0" || m.sha256 !== null) refuse("directory_payload");
    } else {
      if (root) refuse("member_root");
      if (BigInt(m.bytes) > BigInt(caps.file_each)) refuse("file_bound");
      if (m.sha256 === null) refuse("file_digest");
      regular++; payload += BigInt(m.bytes); rounding += (512n - BigInt(m.bytes) % 512n) % 512n;
    }
  }
  if (regular > caps.regular_each) refuse("regular_count");
  if (members.length > caps.members_each || a.logical_members !== null && a.logical_members < members.length) refuse("member_count");
  if (a.regular_files !== null && a.regular_files < regular) refuse("regular_count");
  if (a.inventory_complete && (a.logical_members !== members.length || a.regular_files !== regular)) refuse("inventory_count");
  const knownRegular = Math.max(regular, a.regular_files ?? 0);
  const memberFloor = members.length - regular + knownRegular;
  if (memberFloor > caps.members_each) refuse("member_count");
  if (a.logical_members !== null && a.logical_members < memberFloor) refuse("member_count");
  const knownMembers = Math.max(memberFloor, a.logical_members ?? 0);
  const padding = BigInt(knownMembers) * 512n + 1024n + rounding;
  if (a.header_padding_bytes !== null && BigInt(a.header_padding_bytes) < padding) refuse("padding_floor");
  const decoded = payload + max(padding, BigInt(a.header_padding_bytes ?? 0));
  if (decoded > BigInt(caps.decoded_each) || a.decoded_bytes !== null && BigInt(a.decoded_bytes) < decoded) refuse("decoded_floor");
  const ready = a.inventory_complete && complete([a.compressed_bytes, a.decoded_bytes, a.header_padding_bytes]) && BigInt(a.compressed_bytes) > 0n;
  if (!ready) blockers.push("archive_inventory_incomplete");
  return { known_payload: payload, known_decoded: max(decoded, BigInt(a.decoded_bytes ?? 0)), known_regular: knownRegular, known_members: knownMembers, complete: ready };
}
function capacity(d, inventories, blockers) {
  const rows = d.work.response_pages.flat(), kinds = ["metadata", "archive", "source"];
  if (rows.length > caps.responses) refuse("response_count");
  const supplied = Object.fromEntries(kinds.map(kind => [kind, sum(rows.filter(r => r.kind === kind).map(r => r.bytes))]));
  for (const r of rows) {
    const cap = r.kind === "metadata" ? caps.metadata_each : caps.file_each;
    if (BigInt(r.bytes ?? 0) > BigInt(cap)) refuse("response_body_bound");
  }
  for (const p of d.packages) if (BigInt(p.observed?.metadata_bytes ?? 0) > BigInt(caps.metadata_each)) refuse("metadata_body_bound");
  const metadata = max(supplied.metadata, sum(d.packages.map(p => p.observed?.metadata_bytes ?? null)));
  const compressed = max(supplied.archive, sum(d.packages.map(p => p.archive?.compressed_bytes ?? null)));
  const payload = sum(inventories.map(i => i.known_payload.toString()));
  const source = max(payload, max(supplied.source, BigInt(d.graph.source_bytes ?? 0)));
  const decoded = sum(inventories.map(i => i.known_decoded.toString())), received = metadata + compressed + source;
  if (metadata > BigInt(caps.metadata_total)) refuse("metadata_total_bound");
  if (compressed > BigInt(caps.compressed_total)) refuse("compressed_total_bound");
  if (source > BigInt(caps.source_total)) refuse("source_total_bound");
  if (decoded > BigInt(caps.decoded_total)) refuse("decoded_total_bound");
  if (received > BigInt(caps.received_total)) refuse("received_total_bound");
  const sourceCount = Math.max(d.graph.mapping_pages.flat().length, d.graph.source_count ?? 0,
    inventories.reduce((n, i) => n + i.known_regular, 0));
  const responseCounts = { metadata: d.packages.filter(p => p.observed !== null).length, archive: d.packages.filter(p => p.archive !== null).length, source: sourceCount };
  const responseFloor = Object.values(responseCounts).reduce((n, v) => n + v, 0);
  const knownResponses = kinds.reduce((n, k) => n + Math.max(rows.filter(r => r.kind === k).length, responseCounts[k]), 0);
  if (knownResponses > caps.responses) refuse("response_count");
  const receivedComplete = complete(d.packages.flatMap(p => [p.observed?.metadata_bytes ?? null, p.archive?.compressed_bytes ?? null]))
    && d.graph.source_bytes !== null && d.graph.source_count !== null && rows.length >= responseFloor && rows.every(r => r.bytes !== null && r.complete)
    && kinds.every(k => rows.filter(r => r.kind === k).length >= (responseCounts[k] ?? 0))
    && d.graph.source_count >= sourceCount && supplied.metadata >= metadata && supplied.archive >= compressed && supplied.source >= source;
  if (!receivedComplete) blockers.push("received_work_unknown");
  const decodedComplete = inventories.every(i => i.complete);
  const cost = (passes, floor, ready, ceiling, reason) => {
    if (passes !== null && BigInt(passes) < 1n) refuse("work_passes");
    const known = max(1n, BigInt(passes ?? 0)) * floor;
    if (ceiling !== null && known > BigInt(ceiling)) refuse(reason + "_bound");
    if (passes === null || !ready || ceiling === null) blockers.push(reason + "_unknown");
    return { known: known.toString(), modeled: passes !== null && ready ? known.toString() : null };
  };
  const hashWork = cost(d.work.hash_passes, received + payload, receivedComplete, d.work.hash_byte_ceiling, "hash_work");
  const decodeWork = cost(d.work.decode_passes, decoded, decodedComplete, d.work.decode_byte_ceiling, "decode_work");
  const inspectionFloor = BigInt(knownResponses + d.graph.mapping_pages.flat().length
    + inventories.reduce((n, i) => n + i.known_members, 0));
  if (d.work.inspection_steps !== null && BigInt(d.work.inspection_steps) < inspectionFloor) refuse("inspection_work_floor");
  const inspectionKnown = max(inspectionFloor, BigInt(d.work.inspection_steps ?? 0));
  if (d.work.step_ceiling !== null && inspectionKnown > BigInt(d.work.step_ceiling)) refuse("inspection_work_bound");
  if (d.work.inspection_steps === null || d.work.step_ceiling === null) blockers.push("inspection_work_unknown");
  const receipt = byteLength(canonical(d));
  if (receipt > caps.receipt_bytes) refuse("receipt_bound");
  const floors = { metadata, source, receipt: BigInt(receipt), scratch: 0n };
  for (const p of d.packages) {
    const suffix = p.name === "stream-json" ? "json" : "chain";
    floors["compressed_" + suffix] = BigInt(p.archive?.compressed_bytes ?? 0);
    floors["decoded_" + suffix] = inventories[d.packages.indexOf(p)].known_decoded;
  }
  unique(d.memory.map(m => m.phase), "memory_phases");
  let knownPeak = 0n, modeledPeak = 0n, memoryComplete = receivedComplete && decodedComplete, receiveReservation = false;
  for (const m of d.memory) {
    let known = 0n, compressedReservation = 0n;
    for (const k of resources) {
      if (m.allocations[k] !== null && BigInt(m.allocations[k]) < floors[k]) refuse("memory_floor");
      const part = max(BigInt(m.allocations[k] ?? 0), floors[k]);
      known += part; if (k.startsWith("compressed_")) compressedReservation += part;
    }
    // Package and response summaries overlap, but neither may erase the other's floor.
    known = known - compressedReservation + max(compressedReservation, compressed);
    known = max(known, BigInt(m.joint_floor ?? 0));
    if (m.ceiling !== null && known > BigInt(m.ceiling)) refuse("memory_bound");
    const ready = complete(Object.values(m.allocations)) && m.joint_floor !== null && m.ceiling !== null;
    if (m.phase === "receive") receiveReservation = ready;
    memoryComplete &&= ready; knownPeak = max(knownPeak, known); if (ready) modeledPeak = max(modeledPeak, known);
  }
  if (!memoryComplete) blockers.push("memory_unknown");
  return { metadata: metadata.toString(), compressed: compressed.toString(), source: source.toString(),
    received: { known: received.toString(), modeled: receivedComplete ? received.toString() : null },
    decoded: { known: decoded.toString(), modeled: decodedComplete ? decoded.toString() : null }, hash_work: hashWork, decode_work: decodeWork,
    inspection_work: { known: inspectionKnown.toString(), modeled: d.work.inspection_steps }, response_count: { known: knownResponses, modeled: receivedComplete ? rows.length : null },
    remaining_received_bytes: (BigInt(caps.received_total) - received).toString(),
    memory: { known_peak: knownPeak.toString(), modeled_peak: memoryComplete ? modeledPeak.toString() : null },
    opaque_plan_complete: receivedComplete && receiveReservation && d.work.hash_passes !== null && d.work.hash_byte_ceiling !== null,
    persistence_proposal: { bytes: caps.persisted_bytes, files: caps.persisted_files, available: false },
    refunded: false, heap_runtime_qualified: false, elapsed_time_qualified: false, synchronous_preemption_proven: false };
}
function staticSummary(d, inventories, blockers) {
  for (const p of d.packages) if (p.audit_rows !== null) unique(p.audit_rows.map(r => r.kind), "audit_rows");
  const rowsReady = d.packages.every(p => p.audit_rows !== null && p.audit_rows.every(r => r.state === "matched_supplied" && r.evidence_sha256 !== null));
  const g = d.graph, mappings = g.mapping_pages.flat(), expected = d.packages.flatMap(p =>
    (p.archive?.member_pages.flat() ?? []).filter(m => m.type === "file").map(m => ({ package: p.name, path: m.path.slice(8), sha256: m.sha256, bytes: m.bytes })));
  unique(mappings.map(m => m.package + "/" + m.path), "source_mapping_duplicate");
  for (const m of mappings) {
    memberPath(m.path);
    const p = d.packages.find(p => p.name === m.package), file = expected.find(f => f.package === m.package && f.path === m.path);
    if (!file) refuse("source_mapping_member");
    if (m.package_sha256 !== null && m.package_sha256 !== file.sha256 || m.source_sha256 !== null && m.source_sha256 !== file.sha256) refuse("source_mapping_digest");
    const url = `https://raw.githubusercontent.com/uhop/${p.name}/${p.expected?.pins.commit}/${m.path}`;
    if (m.url !== url || !d.url_pages.flat().includes(m.url)) refuse("source_mapping_url");
  }
  if (g.sha256 !== null && g.expected_sha256 !== null && g.sha256 !== g.expected_sha256) refuse("graph_binding");
  if (g.options_sha256 !== null && g.options_sha256 !== digest(d.profile.options)) refuse("graph_options");
  if (g.runtime_sha256 !== null && d.profile.runtime_sha256 !== null && g.runtime_sha256 !== d.profile.runtime_sha256) refuse("graph_runtime");
  const mapped = g.source_mapping === true && mappings.length === expected.length
    && mappings.every(m => m.package_sha256 !== null && m.source_sha256 !== null)
    && g.source_count === mappings.length && g.source_bytes !== null && BigInt(g.source_bytes) >= sum(expected.map(f => f.bytes));
  const json = d.packages.find(p => p.name === "stream-json"), entry = expected.find(f => f.package === "stream-json" && f.path === "src/core/parser.js");
  const entryBound = entry !== undefined && json.observed?.pins.entry_sha256 === entry.sha256;
  const ready = rowsReady && entryBound && mapped && inventories.every(i => i.complete) && g.edges_enumerated === true && g.unresolved_edges === 0
    && g.initialization_decision === "proposed_reviewed"
    && complete([g.sha256, g.expected_sha256, g.closure_sha256, g.options_sha256, g.runtime_sha256, d.profile.runtime_sha256]);
  if (!ready) blockers.push("static_audit_incomplete");
  const entries = ["package.dev.stream-chain", "package.dev.stream-json", "lock.root.dev.stream-chain", "lock.root.dev.stream-json",
    "lock.packages.node_modules/stream-chain", "lock.packages.node_modules/stream-json"];
  unique(d.diff.entries, "diff_entries");
  if (d.diff.entries.some(k => !entries.includes(k)) || d.diff.unrelated_changes === true) refuse("unrelated_lock_diff");
  const declared = d.diff.entries.length === entries.length && d.diff.unrelated_changes === false
    && complete([d.diff.manifest_after, d.diff.lock_after]);
  const p = d.placement;
  for (const [a, b] of [[p.inventory_sha256, p.expected_inventory_sha256], [p.paths_sha256, p.expected_paths_sha256], [p.files, p.expected_files]])
    if (a !== null && b !== null && a !== b) refuse("placement_binding");
  const placed = complete(Object.values(p)) && p.files === expected.length;
  return { ready, declared, placed };
}
function evidence(d, stage) {
  if (stage === stages[1]) return digest(d.packages.map(p => p.observed));
  if (stage === stages[2]) return digest(d.packages.map(p => p.expected));
  if (stage === stages[3]) return digest(d.packages.map(p => ({ archive: p.archive, pins: p.observed?.pins ?? null })));
  if (stage === stages[4]) return digest({ packages: d.packages, graph: d.graph });
  if (stage === stages[5]) return digest(d.diff);
  return digest(d.placement);
}
function replay(d, planHash, seed, summary, budget, blockers) {
  const terminal = value => ["REFUSED", "STOPPED_UNKNOWN"].includes(value);
  let stage = d.previous_stage, last = terminal(stage) ? null : stage, receipt = seed,
    priorTime = d.previous_clock === null ? null : BigInt(d.previous_clock.now_ns), domain = d.previous_clock?.clock_domain ?? null;
  if (stage !== "UNAVAILABLE" && d.previous_receipt_sha256 === null) refuse("previous_receipt_unavailable");
  const metadata = d.packages.some(p => p.observed?.metadata_sha256 != null && p.observed.metadata_bytes !== null);
  const metadataComplete = d.packages.every(p => p.observed?.metadata_sha256 != null && p.observed.metadata_bytes !== null);
  const frozen = d.packages.every(p => p.expected?.pins.integrity != null && p.expected.pins.commit !== null);
  const matched = d.packages.every(p => p.expected && p.observed && p.expected.pins.integrity === p.observed.pins.integrity
    && p.observed.pins.integrity !== null);
  const budgetReady = !blockers.some(b => b.endsWith("_unknown") || b === "baseline_unavailable");
  const opaqueReady = budget.opaque_plan_complete && !blockers.includes("baseline_unavailable");
  const tarballUrls = d.packages.every(p => d.url_pages.flat().includes(`https://registry.npmjs.org/${p.name}/-/${p.name}-${p.version}.tgz`));
  const archiveReady = metadataComplete && tarballUrls && frozen && matched && opaqueReady && d.packages.every(p => p.archive?.compressed_bytes != null
    && BigInt(p.archive.compressed_bytes) > 0n) && d.tools.transport_sha256 !== null && d.tools.metadata_decoder_sha256 !== null && d.tools.bootstrap_review_sha256 !== null;
  const allPins = d.packages.every(p => p.expected && p.observed && complete([...Object.values(p.expected.pins), ...Object.values(p.observed.pins)]));
  const staticPins = d.packages.every(p => p.observed?.stage === "static");
  const staticReady = archiveReady && budgetReady && allPins && staticPins && summary.ready && d.tools.inspector_sha256 !== null;
  const ready = [true, metadata, metadataComplete && frozen, archiveReady, staticReady, staticReady && summary.declared, staticReady && summary.declared && summary.placed];
  if (!terminal(stage) && !ready[stages.indexOf(stage)]) refuse("previous_stage_prerequisite");
  if (!terminal(stage) && stages.indexOf(stage) >= 2 && (d.previous_clock === null || d.previous_clock.review_sha256 !== d.tools.clock_review_sha256)) refuse("previous_clock_unavailable");
  const receipts = [];
  for (const e of d.events) {
    if (terminal(stage)) refuse("terminal_event");
    if (e.ordinal !== receipts.length + 1) refuse("event_ordinal");
    if (e.plan_sha256 !== planHash) refuse("plan_binding");
    if (e.previous_receipt_sha256 !== receipt) refuse("receipt_binding");
    if (stages.indexOf(e.stage) !== stages.indexOf(stage) + 1) refuse("stage_order");
    if (e.evidence_sha256 !== evidence(d, e.stage)) refuse("evidence_binding");
    if (e.result !== (e.stage === stages[5] ? "declaration_only" : e.stage === stages[6] ? "static_layout_only" : "summary_only")) refuse("result_scope");
    if (e.outcome !== "matched_supplied") stage = e.outcome === "refused" ? "REFUSED" : "STOPPED_UNKNOWN";
    else {
      if (e.stage !== stages[1]) {
        const a = e.approval;
        if (!a) refuse("approval_unavailable");
        if (a.plan_sha256 !== planHash || a.baseline_sha256 !== digest(d.baseline)
          || a.previous_receipt_sha256 !== receipt || a.stage !== e.stage) refuse("approval_binding");
        if (a.used) refuse("approval_replay");
        if (a.decision !== "approved_supplied") refuse("approval_pending");
        if (a.clock_review_sha256 === null || a.clock_review_sha256 !== d.tools.clock_review_sha256 || a.clock_domain !== d.tools.clock_domain
          || a.now_ns === null || a.expires_ns === null) refuse("approval_time_unproven");
        if (BigInt(a.now_ns) >= BigInt(a.expires_ns)) refuse("approval_expired");
        if (domain !== null && domain !== a.clock_domain || priorTime !== null && BigInt(a.now_ns) < priorTime) refuse("clock_regression");
        domain = a.clock_domain; priorTime = BigInt(a.now_ns);
      } else if (e.approval !== null) refuse("observation_approval");
      if (!ready[stages.indexOf(e.stage)]) refuse("stage_prerequisite");
      stage = e.stage; last = stage;
    }
    receipt = digest({ previous_receipt_sha256: receipt, event: e });
    receipts.push({ ordinal: e.ordinal, stage, sha256: receipt });
  }
  return { stage, last_matched_stage: last, receipt_sha256: receipt, receipts };
}
function describe(input) {
  const d = parse(schema, input), blockers = [];
  identity(d, blockers);
  urls(d);
  const inventories = d.packages.map(p => inventory(p, blockers));
  const budget = capacity(d, inventories, blockers);
  const summary = staticSummary(d, inventories, blockers);
  const planValue = { baseline: d.baseline, previous_receipt_sha256: d.previous_receipt_sha256, previous_stage: d.previous_stage, previous_clock: d.previous_clock, profile: d.profile,
    packages: d.packages.map(p => ({ name: p.name, version: p.version, expected: p.expected })), tools: d.tools,
    destination: d.destination, url_pages: d.url_pages, caps, work: d.work, memory: d.memory,
    expected_graph_sha256: d.graph.expected_sha256, diff: d.diff,
    expected_layout: { inventory_sha256: d.placement.expected_inventory_sha256, paths_sha256: d.placement.expected_paths_sha256, files: d.placement.expected_files } };
  const planHash = digest(planValue);
  const seed = digest({ plan_sha256: planHash, previous_receipt_sha256: d.previous_receipt_sha256 });
  const state = replay(d, planHash, seed, summary, budget, blockers);
  const out = { ...flags(), scope: "unsigned_dependency_audit_supplied_summary_only", ...state, plan_sha256: planHash,
    blockers: [...new Set(blockers)], evaluation_tuple: tuple, caps, capacity: budget, runtime_producers: "unavailable",
    actual_package_bytes_verified: false, parser_executed: false, parser_available: false, runtime_completion_proven: false,
    startup_proof_issued: false, transport_available: false, inspector_available: false, dependency_added: false,
    publisher_authenticated: false, declaration_observed: false, layout_observed: false,
    runtime_blockers: ["original_initialization_NOT_RUN", "parser_NOT_RUN", "host_loader_unavailable", "heap_unqualified", "c2a_transient_overlap_unproven"],
    runtime_limits: { retained_bytes: 2375680, transient_bytes: 4259840, record_bytes: 4194304 } };
  if (byteLength(canonical(out)) > 16384) refuse("diagnostic_bound");
  return freeze(out);
}
export function planUnsignedParserDependencyAudit(input) { return describe(input); }
export function describeUnsignedParserDependencyAuditCapacity(input) { return describe(input); }
