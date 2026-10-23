import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonical, evidenceHash } from "../../build/nativeBarEvidence.js";
import { classifyNativeBarCleanup, NativeBarCleanupPlans } from "../../build/nativeBarMaintenance.js";

const at = "2026-10-23T00:00:00.000Z";
const id = "00000000-0000-4000-8000-000000000001";
const op = "00000000-0000-4000-8000-000000000002";
const stageId = "00000000-0000-4000-8000-000000000003";
const policy = { schema: "native-bar-policy-v1", synthetic_fixture: true };
const policyHash = evidenceHash(policy);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const ns = (time) => String(BigInt(Date.parse(time)) * 1000000n);
const directory = (path, inode) => ({ path, device: "1", inode, uid: "501", mode: String(0o40700), acl: "none" });
function snapshot() {
  return { schema: "native-bar-cleanup-snapshot-v1", as_of: at,
    root: { ...directory("", "2"), policy_hash: policyHash, backend_protocol: 1, capabilities_hash: evidenceHash("synthetic-capabilities") },
    coverage_complete: true, current_owner_tokens: [], liveness: [], entries: [file("policy.json", policy)] };
}
let inode = 10;
function file(path, value, extra = {}) {
  const bytes = typeof value === "string" ? Buffer.from(value) : Buffer.from(canonical(value));
  const parts = path.split("/");
  return { path, kind: "file", acl: "none", parents: parts.slice(0, -1).map((_, i) => directory(parts.slice(0, i + 1).join("/"), String(100 + i))),
    proof: { device: "1", inode: String(inode++), uid: "501", gid: "20", mode: String(0o100600), nlink: "1",
      size: String(bytes.length), sha256: hash(bytes), mtime_ns: ns(at), ctime_ns: ns(at), birthtime_ns: ns(at) }, bytes, ...extra };
}

test("cleanup classification preserves Finder and unrelated files without any cleanup candidate", () => {
  const s = snapshot(); s.entries.push(file("receipts/2026-10-23/.DS_Store", "finder"), file("owner-note.json", "keep"));
  const result = classifyNativeBarCleanup(s);
  assert.equal(result.execution_available, false);
  assert.equal(result.items.filter((x) => x.classification === "unknown").length, 2);
  assert.ok(result.items.every((x) => x.eligible_for === null));
  assert.deepEqual(result.blockers, []);
  assert.equal(result.inventory_bytes, String(s.entries.reduce((n, e) => n + e.bytes.length, 0)));
});

const owner = { pid: 123, token: op, boot: "a".repeat(12), start: "b".repeat(12) };
const stagePath = `captures/2026-10-23/.${id}-aabbccdd-123-112233445566.stage`;
function register(s, target, kind = "publication_stage") {
  const reservation = { schema: "native-bar-producer-reservation-v1", operation_id: op, policy_hash: policyHash,
    root: { device: "1", inode: "2" }, created_at: at, owner,
    artifact: { kind, path: target.path, recording_id: id } };
  const created = { schema: "native-bar-created-entry-v1", operation_id: op, stage_id: stageId, reservation_hash: evidenceHash(reservation),
    path: target.path, created_at: at,
    object: { device: target.proof.device, inode: target.proof.inode, birthtime_ns: target.proof.birthtime_ns } };
  s.entries.push(target, file(`operations/${op}.reservation.json`, reservation), file(`operations/${op}.created/${stageId}.json`, created));
  s.liveness.push({ owner_hash: evidenceHash(owner), state: "dead", reason: "esrch", checked_at: at });
}
test("registered truncated stage is a quarantine-only candidate after verified producer death; unregistered stage remains legacy review only", () => {
  const s = snapshot(); register(s, file(stagePath, "{incomplete"));
  let result = classifyNativeBarCleanup(s), item = result.items.find((e) => e.path === stagePath);
  assert.deepEqual(result.blockers, []);
  assert.equal(item.classification, "registered_interrupted_stage");
  assert.equal(item.eligible_for, "quarantine");
  s.entries = s.entries.filter((e) => !e.path.startsWith("operations/"));
  result = classifyNativeBarCleanup(s); item = result.items.find((e) => e.path === stagePath);
  assert.equal(item.classification, "legacy_unverified"); assert.equal(item.eligible_for, "legacy_review");
});

function capture() {
  return { capture_as_of: at, restoration_verified: true, restoration_hash: evidenceHash("synthetic-layout"),
    series: ["PEPPERSTONE:MXNJPY", "OANDA:XAUUSD"].flatMap((symbol) => ["15", "60"].map((timeframe) => {
      const context = { symbol, full_name: symbol, exchange: symbol.split(":")[0], type: "forex", currency: "JPY",
        timezone: "Etc/UTC", session: "24x7", subsession_id: "regular", pricescale: 100000, minmov: 1, minmove2: 10,
        fractional: false, chart_style: "candles", adjustment: "not_applicable", capture_contract: "native-bar-v1:successor-confirmed" };
      return { symbol, timeframe, context, series_context_id: evidenceHash(context), source: "tradingview_native_ohlcv", price_basis: "unknown",
        observed_at: at, history_shortage: true, provenance: { session_holidays: null, corrections: null },
        bars: [{ bar_open_at: "2026-10-22T22:00:00.000Z", confirmed_by_next_bar_at: "2026-10-22T23:00:00.000Z",
          open: 1, high: 2, low: 0, close: 1, volume: null }] };
    })) };
}
function committed(s) {
  const payload = capture();
  const receipt = { schema: "native-bar-receipt-v1", recording_id: id, plan_hash: evidenceHash("plan"), policy_hash: policyHash,
    payload_hash: evidenceHash(payload), sequence: 1, recorded_at: at, day: "2026-10-23", partition_at: at };
  s.entries.push(file(`captures/2026-10-23/${id}.json`, payload), file(`receipts/2026-10-23/${id}.json`, receipt));
  return receipt;
}
test("committed native evidence is protected; a corrupt canonical receipt blocks cleanup rather than making a pending candidate", () => {
  const s = snapshot(); committed(s);
  let report = classifyNativeBarCleanup(s);
  assert.deepEqual(report.blockers, []);
  assert.equal(report.items.find((e) => e.path.startsWith("captures/")).classification, "committed");
  s.entries[2] = file(s.entries[2].path, "truncated receipt");
  report = classifyNativeBarCleanup(s);
  assert.ok(report.blockers.some((s) => s.startsWith("integrity_failure:")));
  assert.equal(report.items.find((e) => e.path.startsWith("captures/")).eligible_for, null);
});

function quarantined(s, ageMs) {
  const old = new Date(Date.parse(s.as_of) - ageMs).toISOString();
  const target = file(`quarantine/abandoned/${op}/${stageId}`, capture());
  target.proof.mtime_ns = ns(old); target.proof.ctime_ns = ns(old); target.proof.birthtime_ns = ns(old);
  const marker = file(`quarantine/abandoned/${op}/timestamp.json`, {
    schema: "native-bar-abandoned-quarantine-v1", operation_id: op, root: { device: "1", inode: "2" }, policy_hash: policyHash,
    quarantined_at: old, targets: [{ target_id: stageId, source_path: stagePath, recording_id: id, proof: target.proof }],
  });
  marker.proof.mtime_ns = ns(old); marker.proof.ctime_ns = ns(old); marker.proof.birthtime_ns = ns(old);
  s.entries.push(target, marker); return { target, marker };
}
test("abandoned quarantine is purge-candidate only strictly beyond 90 days; a self-consistent old marker with fresh native metadata cannot qualify", () => {
  const age = 90 * 86400000;
  const exact = snapshot(), older = snapshot(); quarantined(exact, age); const q = quarantined(older, age + 1);
  let r = classifyNativeBarCleanup(exact); assert.equal(r.items.find((e) => e.path.endsWith(stageId)).eligible_for, null);
  r = classifyNativeBarCleanup(older); assert.deepEqual(r.blockers, []);
  assert.equal(r.items.find((e) => e.path.endsWith(stageId)).eligible_for, "purge");
  q.marker.proof.ctime_ns = ns(at);
  r = classifyNativeBarCleanup(older); assert.equal(r.items.find((e) => e.path.endsWith(stageId)).eligible_for, null);
});

function plans() {
  let time = at, tick = 0;
  return { registry: new NativeBarCleanupPlans({ now: () => new Date(time), monotonic: () => tick }),
    time: (v) => { time = v; }, tick: (v) => { tick = v; } };
}
test("approval plan binds exact candidate IDs and yields only a single-use validation result, never an execution grant", () => {
  const s = snapshot(); register(s, file(stagePath, "truncated"));
  const item = classifyNativeBarCleanup(s).items.find((e) => e.path === stagePath);
  const f = plans(), p = f.registry.prepare(s, { action: "quarantine", candidate_ids: [item.candidate_id] });
  assert.equal(p.execution_available, false); assert.equal(p.targets.length, 1);
  assert.equal(p.targets[0].source_path, stagePath);
  assert.equal(p.targets[0].effect, "move_without_purge");
  assert.match(p.targets[0].destination, /^quarantine\/abandoned\//);
  assert.equal(p.expires_at, "2026-10-23T00:10:00.000Z");
  const request = { plan_id: p.plan_id, plan_hash: p.plan_hash, action: "quarantine", confirm: true };
  const v = f.registry.consumeForSyntheticValidation(request, s);
  assert.equal(v.status, "validated_only"); assert.equal(v.execution_available, false); assert.equal(v.no_operation_performed, true);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request, s), /plan_not_found/);
});

const targetItem = (s, path = stagePath) => classifyNativeBarCleanup(s).items.find((e) => e.path === path);
const request = (p, extra = {}) => ({ plan_id: p.plan_id, plan_hash: p.plan_hash, action: p.action, confirm: true, ...extra });
const prepare = (f, s, action = "quarantine", path = stagePath) => f.registry.prepare(s, { action, candidate_ids: [targetItem(s, path).candidate_id] });
test("reserved but not created stage cannot be reviewed as legacy while its producer may be live", () => {
  const s = snapshot(); register(s, file(stagePath, "partial"));
  s.entries = s.entries.filter((e) => !e.path.includes(".created/"));
  assert.equal(targetItem(s).eligible_for, null);
  assert.match(targetItem(s).reasons.join(), /created_entry_missing/);
  s.liveness[0].state = "live"; s.liveness[0].reason = "running";
  assert.equal(targetItem(s).classification, "live_or_unknown_producer");
});
test("parent proof disagreement is a global blocker; future native metadata is never eligible", () => {
  const s = snapshot(); register(s, file(stagePath, "partial"));
  s.entries.push(file("captures/2026-10-23/.DS_Store", "finder"));
  s.entries.at(-1).parents[0].inode = "999";
  assert.ok(classifyNativeBarCleanup(s).blockers.includes("inconsistent_parent:captures"));
  const other = snapshot(); register(other, file(stagePath, "partial"));
  other.entries[1].proof.mtime_ns = ns("2026-10-23T00:00:01.000Z");
  assert.equal(targetItem(other).eligible_for, null);
});
test("quarantine with an unexpected surviving leaf is not a completed candidate set", () => {
  const s = snapshot(); quarantined(s, 91 * 86400000);
  s.entries.push(file(`quarantine/abandoned/${op}/${id}`, "unexpected"));
  assert.ok(classifyNativeBarCleanup(s).blockers.length);
});

function rewrite(s, path, change) {
  const i = s.entries.findIndex((e) => e.path === path), prior = s.entries[i];
  const value = JSON.parse(Buffer.from(prior.bytes).toString()); change(value);
  s.entries[i] = file(path, value);
}
function registered() { const s = snapshot(); register(s, file(stagePath, "partial")); return s; }

for (const [label, change] of [
  ["running", (s) => Object.assign(s.liveness[0], { state: "live", reason: "running" })],
  ["unknown", (s) => Object.assign(s.liveness[0], { state: "unknown", reason: "unverified" })],
  ["missing liveness", (s) => { s.liveness = []; }],
  ["stale check", (s) => { s.liveness[0].checked_at = "2026-10-22T23:59:59.000Z"; }],
  ["current owner", (s) => { s.current_owner_tokens.push(owner.token); }],
]) test(`producer exclusion: ${label}`, () => {
  const s = registered(); change(s); assert.equal(targetItem(s).eligible_for, null);
});
test("incarnation mismatch proves death only for an owner carrying that incarnation", () => {
  const s = registered(); s.liveness[0].reason = "start_mismatch";
  assert.equal(targetItem(s).eligible_for, "quarantine");
  rewrite(s, `operations/${op}.reservation.json`, (v) => { v.owner = { pid: 123, token: op }; });
  s.liveness[0].owner_hash = evidenceHash({ pid: 123, token: op });
  rewrite(s, `operations/${op}.created/${stageId}.json`, (v) => {
    v.reservation_hash = evidenceHash(JSON.parse(s.entries.find((e) => e.path.endsWith("reservation.json")).bytes.toString()));
  });
  assert.equal(targetItem(s).eligible_for, null);
});
for (const [label, change] of [
  ["symlink", (e) => { e.kind = "symlink"; }],
  ["fifo", (e) => { e.kind = "fifo"; }],
  ["socket", (e) => { e.kind = "socket"; }],
  ["foreign owner", (e) => { e.proof.uid = "502"; }],
  ["cross device", (e) => { e.proof.device = "9"; }],
  ["writable mode", (e) => { e.proof.mode = String(0o100620); }],
  ["ACL grant", (e) => { e.acl = "grant"; }],
  ["unknown ACL", (e) => { e.acl = "unknown"; }],
  ["parent ACL", (e) => { e.parents[0].acl = "grant"; }],
  ["missing parent", (e) => { e.parents.pop(); }],
  ["hard link", (e) => { e.proof.nlink = "2"; }],
  ["same bytes different inode", (e) => { e.proof.inode = "999"; }],
  ["same inode different birthtime", (e) => { e.proof.birthtime_ns = "1"; }],
  ["changed bytes", (e) => { e.bytes = Buffer.from("changed"); }],
]) test(`unsafe candidate exclusion: ${label}`, () => {
  const s = registered(); change(s.entries[1]); assert.equal(targetItem(s).eligible_for, null);
});
test("pending capture requires valid native content and exact created-entry registration", () => {
  const s = snapshot(), path = `captures/2026-10-23/${id}.json`; register(s, file(path, capture()), "capture");
  assert.equal(targetItem(s, path).classification, "registered_pending_capture");
  assert.equal(targetItem(s, path).eligible_for, "quarantine");
  s.entries[1] = file(path, "partial JSON"); assert.equal(targetItem(s, path).eligible_for, null);
});
test("receipt and maintenance references exclude even otherwise registered interrupted stages", () => {
  const s = registered(); const r = committed(s);
  assert.equal(targetItem(s).classification, "referenced");
  const other = registered();
  other.entries.push(file(`maintenance/${id}.json`, { schema: "native-bar-maintenance-v1", id, kind: "prune", created_at: at,
    generation: evidenceHash("generation"), pairs: [{ recording_id: id, sequence: 1, day: r.day, payload_hash: r.payload_hash,
      receipt_hash: evidenceHash(r), bytes: 1 }] }));
  assert.equal(targetItem(other).classification, "referenced");
});
for (const [label, path, body] of [
  ["claim", `.writer-claim-${op}.json`, owner],
  ["ticket", `.writer-ticket-${op}.json`, { ...owner, ticket: 1 }],
  ["retired", `.writer-retired-${id}.lock`, owner],
]) test(`dead ${label} is quarantine-only, current and unknown liveness are excluded`, () => {
  const s = snapshot(); s.entries.push(file(path, body));
  s.liveness.push({ owner_hash: evidenceHash(owner), state: "dead", reason: "esrch", checked_at: at });
  assert.equal(targetItem(s, path).eligible_for, "quarantine");
  s.current_owner_tokens.push(owner.token); assert.equal(targetItem(s, path).eligible_for, null);
  s.current_owner_tokens = []; s.liveness = []; assert.equal(targetItem(s, path).eligible_for, null);
});
test("current locks, malformed coordination and clock quarantine are always preserved", () => {
  const s = snapshot(), paths = [".writer.lock", ".writer.takeover", `.writer-claim-${op}.lock`,
    `.writer-ticket-${op}.json`, `quarantine/clock/${op}/payload.json`];
  for (const path of paths) s.entries.push(file(path, "malformed"));
  assert.ok(classifyNativeBarCleanup(s).items.every((e) => e.eligible_for === null));
  assert.equal(targetItem(s, paths.at(-1)).classification, "clock_quarantine");
});
for (const [label, change] of [
  ["reservation policy", (s) => rewrite(s, `operations/${op}.reservation.json`, (v) => { v.policy_hash = evidenceHash("other"); })],
  ["reservation root", (s) => rewrite(s, `operations/${op}.reservation.json`, (v) => { v.root.inode = "8"; })],
  ["created hash", (s) => rewrite(s, `operations/${op}.created/${stageId}.json`, (v) => { v.reservation_hash = evidenceHash("other"); })],
  ["missing reservation", (s) => { s.entries = s.entries.filter((e) => !e.path.endsWith("reservation.json")); }],
  ["duplicate created", (s) => s.entries.push(file(`operations/${op}.created/${id}.json`, {
    ...JSON.parse(s.entries.at(-1).bytes.toString()), stage_id: id }))],
]) test(`invalid canonical provenance blocks every plan: ${label}`, () => {
  const s = registered(); change(s);
  assert.ok(classifyNativeBarCleanup(s).blockers.length);
  assert.throws(() => prepare(plans(), s), /cleanup_blocked/);
});
test("another live reservation referencing the same recording excludes a dead producer's stage", () => {
  const s = registered(), other = JSON.parse(s.entries.find((e) => e.path.endsWith("reservation.json")).bytes.toString());
  other.operation_id = id; other.owner.token = id; other.artifact.path = stagePath.replace("aabbccdd", "bbccddee");
  s.entries.push(file(`operations/${id}.reservation.json`, other));
  assert.equal(targetItem(s).eligible_for, null);
});
test("quarantine source still present is a conflict, not a completed purge set", () => {
  const s = snapshot(); quarantined(s, 91 * 86400000); s.entries.push(file(stagePath, "replacement"));
  assert.ok(classifyNativeBarCleanup(s).blockers.length);
});

for (const [label, change] of [
  ["future wall", (f) => f.time("2026-10-23T00:10:00.000Z")],
  ["monotonic", (f) => f.tick(600000)],
  ["clock rollback", (f) => f.time("2026-10-22T23:59:59.000Z")],
]) test(`approval deadline refuses and consumes plan: ${label}`, () => {
  const s = registered(), f = plans(), p = prepare(f, s); change(f);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p), s), /expired|clock_or_process/);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p), s), /plan_not_found/);
});
for (const [label, extra] of [["hash", { plan_hash: evidenceHash("wrong") }], ["kind", { action: "purge" }]])
  test(`approval binding refuses and consumes plan: ${label}`, () => {
    const s = registered(), f = plans(), p = prepare(f, s);
    assert.throws(() => f.registry.consumeForSyntheticValidation(request(p, extra), s), /binding_mismatch/);
    assert.throws(() => f.registry.consumeForSyntheticValidation(request(p), s), /plan_not_found/);
  });
test("plan cannot cross registry instances, override scope or be widened by mutating returned preview", () => {
  const s = registered(), f = plans(), p = prepare(f, s), originalHash = p.plan_hash;
  assert.throws(() => plans().registry.consumeForSyntheticValidation(request(p), s), /plan_not_found/);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p, { confirm: false }), s));
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p, { source_path: "arbitrary" }), s));
  p.targets[0].source_path = "arbitrary"; p.targets[0].proof.inode = "0"; p.binding.inode = "0";
  p.plan_hash = originalHash;
  const result = f.registry.consumeForSyntheticValidation(request(p), s);
  assert.equal(result.targets[0].source_path, stagePath); assert.notEqual(result.targets[0].proof.inode, "0");
  assert.equal(result.no_operation_performed, true);
});
for (const [label, change] of [
  ["new receipt", (s) => committed(s)],
  ["new unrelated entry", (s) => s.entries.push(file(".DS_Store", "finder"))],
  ["parent replacement", (s) => { s.entries[1].parents[0].inode = "8"; }],
  ["new current owner", (s) => s.current_owner_tokens.push(op)],
  ["new root", (s) => { s.root.inode = "8"; }],
]) test(`snapshot change invalidates whole unstarted plan: ${label}`, () => {
  const s = registered(), f = plans(), p = prepare(f, s); change(s);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p), s), /snapshot_changed|cleanup_blocked/);
});
test("legacy review is explicit and never gains destinations or quarantine authority", () => {
  const s = snapshot(); s.entries.push(file(stagePath, "partial")); const f = plans();
  assert.throws(() => prepare(f, s), /candidate_not_eligible/);
  const p = prepare(f, s, "legacy_review");
  assert.equal(p.targets[0].effect, "review_only"); assert.equal(p.targets[0].destination, null); assert.equal(p.targets[0].holding_path, null);
  assert.equal(f.registry.consumeForSyntheticValidation(request(p), s).no_operation_performed, true);
});
test("purge preview is separate and explicitly irreversible but remains non-executable", () => {
  const s = snapshot(); quarantined(s, 91 * 86400000); const f = plans();
  const p = prepare(f, s, "purge", `quarantine/abandoned/${op}/${stageId}`);
  assert.equal(p.targets[0].effect, "irreversible_unlink"); assert.equal(p.targets[0].destination, null);
  assert.equal(p.capacity_reservation, "unverified_no_execution");
  assert.equal(f.registry.consumeForSyntheticValidation(request(p), s).no_operation_performed, true);
});
test("incomplete/missing/unsafe roots, future snapshots and unknown selection refuse", () => {
  const f = plans();
  for (const change of [(s) => { s.coverage_complete = false; }, (s) => { s.root.acl = "grant"; },
    (s) => { s.root = null; }, (s) => { s.as_of = "2026-10-23T00:00:01.000Z"; }]) {
    const s = registered(); change(s); assert.throws(() => prepare(f, s), /blocked|future_snapshot/);
  }
  const missing = { ...snapshot(), root: null, entries: [] }; assert.deepEqual(classifyNativeBarCleanup(missing).items, []);
  assert.throws(() => f.registry.prepare(missing, { action: "quarantine", candidate_ids: [evidenceHash("missing")] }), /blocked/);
  const s = registered(), candidateId = targetItem(s).candidate_id;
  assert.throws(() => f.registry.prepare(s, { action: "quarantine", candidate_ids: [candidateId, candidateId] }));
  assert.throws(() => f.registry.prepare(s, { action: "quarantine", candidate_ids: [evidenceHash("missing")] }), /not_eligible/);
  assert.throws(() => f.registry.prepare(s, { action: "quarantine", candidate_ids: [candidateId], cutoff: at }));
});
test("plan registry is bounded and reclaims expired entries without extending their deadlines", () => {
  const s = registered(), f = plans(); let first;
  for (let i = 0; i < 128; i++) { const p = prepare(f, s); first ??= p; }
  assert.throws(() => prepare(f, s), /plan_capacity/);
  f.tick(600000); prepare(f, s);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(first), s), /plan_not_found/);
});
test("classifications and plans expose no raw OHLC or raw buffers and do not mutate supplied evidence", () => {
  const s = snapshot(); register(s, file(`captures/2026-10-23/${id}.json`, capture()), "capture");
  const before = JSON.stringify(s), f = plans(), path = s.entries[1].path;
  const serialized = JSON.stringify([classifyNativeBarCleanup(s), prepare(f, s, "quarantine", path)]);
  assert.ok(!serialized.includes('"open":')); assert.ok(!serialized.includes('"bytes":')); assert.equal(JSON.stringify(s), before);
});
test("bounded scans reject oversized bytes, inventory, metadata, duplicate paths and path escape without partial results", () => {
  const big = snapshot(); big.entries.push(file("note", "x", { bytes: Buffer.alloc(1024 ** 2 + 1) }));
  assert.throws(() => classifyNativeBarCleanup(big), /artifact_read_limit/);
  const quota = snapshot(); quota.entries.push(file("note", "x")); quota.entries[1].proof.size = String(1024 ** 3);
  assert.throws(() => classifyNativeBarCleanup(quota), /inventory_quota/);
  const meta = snapshot(); meta.entries[0].proof.size = String(16 * 1024 ** 2 + 1);
  assert.throws(() => classifyNativeBarCleanup(meta), /metadata_limit/);
  const dup = snapshot(); dup.entries.push(dup.entries[0]); assert.throws(() => classifyNativeBarCleanup(dup), /duplicate_path/);
  const escape = snapshot(); escape.entries.push(file("../victim", "x")); assert.throws(() => classifyNativeBarCleanup(escape));
  const scan = snapshot(), buffer = Buffer.alloc(1024 ** 2);
  for (let i = 0; i < 257; i++) scan.entries.push(file(`note-${i}`, "x", { bytes: buffer }));
  assert.throws(() => classifyNativeBarCleanup(scan), /evidence_scan_limit/);
});
test("batch, entry and serialized response ceilings fail without implicit chunking", () => {
  const f = plans(), ids = Array.from({ length: 1025 }, (_, i) => evidenceHash(i));
  assert.throws(() => f.registry.prepare(registered(), { action: "quarantine", candidate_ids: ids }));
  const tooMany = snapshot(); tooMany.entries = Array(30001).fill(tooMany.entries[0]);
  assert.throws(() => classifyNativeBarCleanup(tooMany));
  const response = snapshot();
  for (let i = 0; i < 9000; i++) response.entries.push(file(`unknown-${String(i).padStart(5, "0")}-${"x".repeat(480)}`, ""));
  assert.throws(() => classifyNativeBarCleanup(response), /response_limit/);
});
test("deadlines are rechecked after validation work, not restarted at the end", () => {
  let call = 0;
  const registry = new NativeBarCleanupPlans({ now: () => new Date(at), monotonic: () => ++call >= 4 ? 600000 : 0 });
  const s = registered(), item = targetItem(s), p = registry.prepare(s, { action: "quarantine", candidate_ids: [item.candidate_id] });
  assert.throws(() => registry.consumeForSyntheticValidation(request(p), s), /plan_expired/);
});
test("a changed native timestamp, missing marker, hard link or current producer prevents purge candidacy", () => {
  for (const change of [
    (s, q) => { q.target.proof.ctime_ns = ns(at); },
    (s, q) => { q.target.proof.nlink = "2"; },
    (s) => { s.entries = s.entries.filter((e) => !e.path.endsWith("timestamp.json")); },
    (s) => committed(s),
  ]) {
    const s = snapshot(), q = quarantined(s, 91 * 86400000); change(s, q);
    assert.equal(targetItem(s, q.target.path).eligible_for, null);
  }
  const s = snapshot(), q = quarantined(s, 91 * 86400000), source = `.writer-claim-${op}.json`;
  const replacement = file(q.target.path, owner); Object.assign(replacement.proof, {
    mtime_ns: q.target.proof.mtime_ns, ctime_ns: q.target.proof.ctime_ns, birthtime_ns: q.target.proof.birthtime_ns });
  s.entries[1] = replacement;
  rewrite(s, q.marker.path, (v) => { v.targets[0].source_path = source; v.targets[0].recording_id = null; v.targets[0].proof = replacement.proof; });
  const marker = s.entries.at(-1); Object.assign(marker.proof, { mtime_ns: ns("2026-01-01T00:00:00.000Z"),
    ctime_ns: ns("2026-01-01T00:00:00.000Z"), birthtime_ns: ns("2026-01-01T00:00:00.000Z") });
  s.liveness.push({ owner_hash: evidenceHash(owner), state: "dead", reason: "esrch", checked_at: at });
  assert.equal(targetItem(s, replacement.path).eligible_for, "purge");
  s.current_owner_tokens.push(owner.token); assert.equal(targetItem(s, replacement.path).eligible_for, null);
});
test("new as-of needs a renewed producer check and never turns old liveness into current evidence", () => {
  const s = registered(), f = plans(), p = prepare(f, s);
  s.as_of = "2026-10-23T00:01:00.000Z"; f.time(s.as_of);
  assert.throws(() => f.registry.consumeForSyntheticValidation(request(p), s), /snapshot_changed|candidate_changed/);
  s.liveness[0].checked_at = s.as_of;
  const next = prepare(f, s); assert.equal(f.registry.consumeForSyntheticValidation(request(next), s).status, "validated_only");
});
test("an incomplete known maintenance transaction blocks unrelated cleanup plans", () => {
  const s = registered(); s.entries.push(file(`maintenance/${id}.json`, { schema: "native-bar-maintenance-v1", id,
    kind: "prune", created_at: at, generation: evidenceHash("generation"), pairs: [] }));
  assert.throws(() => prepare(plans(), s), /maintenance_recovery_required/);
});
test("an unknown holding/recovery state is preserved and cannot be bypassed by planning another file", () => {
  for (const path of [`maintenance-hold/${id}/${stageId}`, `maintenance/${id}.events/1.json`]) {
    const s = registered(); s.entries.push(file(path, "pending"));
    assert.throws(() => prepare(plans(), s), /unsupported_transaction_state/);
  }
});
test("stale snapshots cannot get a new ten-minute lifetime", () => {
  const s = registered(), f = plans(); f.time("2026-10-23T00:10:00.000Z");
  assert.throws(() => prepare(f, s), /stale_snapshot/);
});
test("duplicate object identities cannot create contradictory cleanup roles", () => {
  const s = registered(), duplicate = file(stagePath.replace("aabbccdd", "bbccddee"), "partial");
  duplicate.proof = { ...s.entries[1].proof }; s.entries.push(duplicate);
  assert.throws(() => prepare(plans(), s), /duplicate_object_identity/);
});
test("an abandoned quarantine without its completion marker blocks unrelated cleanup planning", () => {
  const s = registered();
  s.entries.push(file(`quarantine/abandoned/${id}/${stageId}`, "interrupted quarantine"));
  assert.throws(() => prepare(plans(), s), /quarantine_recovery_required/);
});
for (const phase of ["prepare", "consume"]) test(`snapshot freshness is rechecked after ${phase} work`, () => {
  const s = registered(), base = Date.parse(at), late = base + 599999;
  let calls = 0;
  const registry = new NativeBarCleanupPlans({ now: () => new Date(phase === "prepare"
    ? ++calls === 1 ? late : late + 2
    : ++calls <= 2 ? base + 1000 : calls === 3 ? late : late + 2), monotonic: () => 0 });
  const selection = { action: "quarantine", candidate_ids: [targetItem(s).candidate_id] };
  if (phase === "prepare") assert.throws(() => registry.prepare(s, selection), /stale_snapshot/);
  else {
    const p = registry.prepare(s, selection);
    // The plan remains within its lifetime while the older evidence expires during validation.
    assert.throws(() => registry.consumeForSyntheticValidation(request(p), s), /stale_snapshot/);
  }
});
test("large liveness inventories preserve exact owner matching and current-owner exclusions", (t) => {
  const s = snapshot(), count = 256;
  for (let i = 0; i < 1024; i++) s.liveness.push({ owner_hash: evidenceHash({ decoy: i }), state: "dead", reason: "esrch", checked_at: at });
  for (let i = 0; i < count; i++) {
    const token = `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`, producer = { ...owner, token };
    s.entries.push(file(`.writer-retired-${token}.lock`, producer));
    s.liveness.push({ owner_hash: evidenceHash(producer), state: "dead", reason: "start_mismatch", checked_at: at });
    if (i === 0) s.current_owner_tokens.push(token);
  }
  const start = performance.now(), result = classifyNativeBarCleanup(s);
  t.diagnostic(`256 owners / 1280 liveness proofs: ${(performance.now() - start).toFixed(1)} ms`);
  assert.equal(result.items.filter((i) => i.eligible_for === "quarantine").length, count - 1);
});
