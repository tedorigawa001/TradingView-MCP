/** Shared diagnostic transaction semantics. No IO, grants or capacity profile. */
import { COMMITTED_MAINTENANCE_LIMITS, CommittedMaintenanceBudget, Rejected, noAuthority,
  encode, digest, blocks, freeze, type Row, type RecordRow } from "./nativeBarCommittedKernel.js";
import { StreamBudget, canonicalHash, canonicalSizeCheck, canonicalReceipt, knownObject } from "./nativeBarCommittedStreamCore.js";
function select(records: RecordRow[], role: RecordRow["role"], b: CommittedMaintenanceBudget) {
  return records.filter(r => { b.charge(); return r.role === role; });
}
type Effects = { prune: { present: boolean; boundary_state: "none" | "known" | "unknown"; greatest_known_recorded_at: string | null };
  clock: { isolated_ids: string[] }; retired_ids: string[] };
function emptyEffects(): Effects { return { prune: { present: false, boundary_state: "none", greatest_known_recorded_at: null }, clock: { isolated_ids: [] }, retired_ids: [] }; }
function addEffect(e: Effects, kind: string, pairs: Row[], b: CommittedMaintenanceBudget) {
  for (const p of pairs) {
    b.charge();
    e.retired_ids.push(p.recording_id);
    if (kind === "clock_recovery") e.clock.isolated_ids.push(p.recording_id);
    else {
      e.prune.present = true;
      if (!p.recorded_at) e.prune.boundary_state = "unknown";
      else {
        if (e.prune.boundary_state === "none") e.prune.boundary_state = "known";
        if (e.prune.greatest_known_recorded_at === null || p.recorded_at > e.prune.greatest_known_recorded_at) e.prune.greatest_known_recorded_at = p.recorded_at;
      }
    }
  }
}
function inventoryKey(id: string, role: string) { return `${id}|${role}`; }
function baselineOf(intent: RecordRow): { receipts: Row[]; maintenance: Row[] } {
  return intent.resolved_baseline ?? intent.value.binding.baseline;
}
function inventoryView(records: RecordRow[], entries: Row[], b: CommittedMaintenanceBudget) {
  const references = new Map<string, { receipt_hash: string; payload_hash: string }>();
  let intent: RecordRow | undefined, intentCount = 0;
  for (const r of records) {
    b.charge();
    if (r.role === "intent") { intent = r; intentCount++; }
    if (r.role === "legacy_v1" || r.role === "manifest") for (const p of r.value.pairs) {
      b.charge(); if (!references.has(p.recording_id)) references.set(p.recording_id,p);
    }
  }
  const supplied = new Set<string>();
  for (const r of select(records,"receipt_v1",b)) { b.charge(); supplied.add(r.value.recording_id); references.set(r.value.recording_id,{receipt_hash:r.hash,payload_hash:r.value.payload_hash}); }
  if (intentCount === 1) {
    const requested = new Set<string>();
    for (const entry of entries) { b.charge(); requested.add(entry.recording_id); }
    // Resolve identities only. The full frozen baseline is validated before adoption.
    for (const r of baselineOf(intent!).receipts) {
      b.charge();
      if (requested.has(r.recording_id) && !supplied.has(r.recording_id)) {
        references.set(r.recording_id,{receipt_hash:canonicalHash(r,COMMITTED_MAINTENANCE_LIMITS.record_bytes,b),payload_hash:r.payload_hash});
      }
    }
  }
  const byKey = new Map<string, Row>();
  for (const entry of entries) {
    b.charge(); const key=inventoryKey(entry.recording_id,entry.role),ref=references.get(entry.recording_id);
    if (byKey.has(key)) b.stop("inventory_duplicate");
    if (!ref || ref[entry.role === "receipt" ? "receipt_hash" : "payload_hash"] !== entry.hash) b.stop("inventory_binding");
    byKey.set(key,entry);
  }
  return byKey;
}
type OriginalReceipt = { value: Row; hash: string; bytes: number; previous_recorded_at: string | null };
type LegacyBatchEvidence = { original: OriginalReceipt | undefined; ref: Row; payload_observed_at?: string };
function checkLegacyClaim(m: Row, ref: Row, payload: RecordRow | undefined, b: CommittedMaintenanceBudget) {
  b.charge();
  if (ref.recorded_at !== undefined && ref.day > ref.recorded_at.slice(0,10)) b.stop("legacy_claim_day_binding");
  if (ref.recorded_at !== undefined && ref.last_observed_at !== undefined && ref.last_observed_at > ref.recorded_at) b.stop("legacy_claim_observation_order");
  let observed: string | undefined;
  if (payload) {
    for (const s of payload.value.series) { b.charge(); if (observed === undefined || s.observed_at > observed) observed=s.observed_at; }
    if (ref.recorded_at !== undefined && observed! > ref.recorded_at ||
      ref.last_observed_at !== undefined && ref.last_observed_at !== observed) b.stop("legacy_claim_payload_binding");
  }
  const stamps = [ref.recorded_at,ref.last_observed_at,observed].filter((s): s is string => s !== undefined).map(Date.parse);
  if (!stamps.length) return; // No supplied timestamp evidence; omitted fields stay unknown.
  const stamp=Math.max(...stamps), approved=Date.parse(m.created_at);
  if (m.kind === "prune" ? stamp >= approved - 90 * 86400000 : stamp <= approved + 60000) b.stop("legacy_claim_eligibility");
  return observed;
}
function checkLegacyBatchOrder(known: LegacyBatchEvidence[], payloads: Map<string, RecordRow>, b: CommittedMaintenanceBudget) {
  known.sort((a,c) => { b.charge(); return (a.original?.value.sequence ?? a.ref.sequence) - (c.original?.value.sequence ?? c.ref.sequence); });
  let previousAt: string | null = null;
  for (const {original,ref,payload_observed_at} of known) {
    b.charge(); const r=original?.value ?? ref, payload=payloads.get(r.payload_hash);
    if (previousAt !== null && (r.recorded_at !== undefined && r.recorded_at < previousAt || payload && payload.value.capture_as_of < previousAt ||
      ref.last_observed_at !== undefined && ref.last_observed_at < previousAt)) b.stop("legacy_batch_observation_order");
    // An observation is only a lower bound on an omitted receipt time, not a replacement field.
    const lowerBound=r.recorded_at ?? ref.last_observed_at ?? payload_observed_at;
    if (lowerBound !== undefined) previousAt=lowerBound;
  }
}
function checkLegacyReference(m: Row, ref: Row, original: OriginalReceipt, payload: RecordRow | undefined, b: CommittedMaintenanceBudget) {
  b.charge(); const r = original.value, reason = m.kind === "prune" ? "legacy_prune_baseline_binding" : "legacy_clock_baseline_binding";
  if (ref.receipt_hash !== original.hash || ref.payload_hash !== r.payload_hash || ref.sequence !== r.sequence || ref.day !== r.day ||
    ref.recorded_at !== undefined && ref.recorded_at !== r.recorded_at ||
    ref.last_observed_at !== undefined && (ref.last_observed_at > r.recorded_at || original.previous_recorded_at !== null && ref.last_observed_at < original.previous_recorded_at) ||
    ref.bytes <= original.bytes || ref.bytes > original.bytes + COMMITTED_MAINTENANCE_LIMITS.record_bytes) b.stop(reason);
  const stamp = Date.parse(r.recorded_at), approved = Date.parse(m.created_at);
  if (m.kind === "prune" ? stamp >= approved - 90 * 86400000 : stamp <= approved + 60000) b.stop(reason);
  if (payload) {
    let latest = "";
    for (const s of payload.value.series) { b.charge(); if (s.observed_at > latest) latest = s.observed_at; }
    if (ref.bytes !== original.bytes + payload.bytes || latest > r.recorded_at ||
      ref.last_observed_at !== undefined && ref.last_observed_at !== latest) b.stop(reason);
  }
}
function legacyView(records: RecordRow[], b: CommittedMaintenanceBudget, holds: Set<string>, selected: Set<string>, policyHash: string, inventory: Map<string, Row>) {
  const receipts = select(records, "receipt_v1", b), payloads = new Map<string, RecordRow>();
  for (const r of select(records, "payload_v1", b)) { b.charge(); if (payloads.has(r.hash)) b.stop("payload_alias"); payloads.set(r.hash, r); }
  const ids = new Set<string>(), sequences = new Set<number>(), referenced = new Set<string>();
  const byId = new Map<string, RecordRow>(), legacy = select(records, "legacy_v1", b), done = select(records, "legacy_completion_v1", b);
  const oldById = new Map<string, RecordRow>(), completed = new Set<string>(), retired = new Set<string>(), receiptOrigins = new Map<string,string>();
  const effects = emptyEffects(), completedRetired = new Set<string>(), activeReceipts: RecordRow[] = [];
  for (const r of legacy) { b.charge(); if (oldById.has(r.value.id)) b.stop("legacy_id_alias"); oldById.set(r.value.id, r); ids.add(r.value.id); }
  for (const d of done) {
    b.charge();
    if (completed.has(d.value.id) || oldById.get(d.value.id)?.hash !== d.value.intent_hash) b.stop("legacy_completion_binding");
    completed.add(d.value.id);
  }
  for (const r of legacy) {
    b.charge();
    for (const p of r.value.pairs) { b.charge(); if (retired.has(p.recording_id) || oldById.has(p.recording_id)) b.stop("maintenance_target_overlap"); retired.add(p.recording_id); receiptOrigins.set(p.recording_id,p.receipt_hash); }
    if (completed.has(r.value.id)) { addEffect(effects, r.value.kind, r.value.pairs, b); for(const p of r.value.pairs){b.charge();completedRetired.add(p.recording_id);} }
  }
  if (completed.size !== legacy.length) holds.add("legacy_unverifiable");
  receipts.sort((a, c) => { b.charge(); return a.value.sequence - c.value.sequence; });
  let previousAt: string | null = null;
  for (const r of receipts) {
    b.charge(); const receipt = r.value, payload = payloads.get(receipt.payload_hash)?.value;
    if (ids.has(receipt.recording_id) || sequences.has(receipt.sequence) || receipt.day !== (receipt.partition_at ?? receipt.recorded_at).slice(0, 10)
      || receipt.partition_at && receipt.partition_at > receipt.recorded_at) b.stop("v1_binding");
    if (receipt.policy_hash !== policyHash) b.stop("v1_policy_binding");
    ids.add(receipt.recording_id); sequences.add(receipt.sequence); byId.set(receipt.recording_id, r); referenced.add(receipt.payload_hash);
    const location=inventory.get(inventoryKey(receipt.recording_id,"receipt"))?.location;
    if (location !== "source" || retired.has(receipt.recording_id)) continue;
    activeReceipts.push(r);
    if(activeReceipts.length > COMMITTED_MAINTENANCE_LIMITS.store_receipts) b.stop("store_receipt_limit");
    if (!selected.has(receipt.recording_id) && inventory.get(inventoryKey(receipt.recording_id,"payload"))?.location !== "source") holds.add("source_evidence_missing");
    if (payload) {
      for (const s of payload.series) { b.charge(); if (s.observed_at > receipt.recorded_at) b.stop("v1_binding"); }
      if (previousAt !== null && previousAt > payload.capture_as_of) b.stop("v1_binding");
    } else if (!selected.has(receipt.recording_id)) holds.add("source_evidence_missing");
    previousAt = receipt.recorded_at;
  }
  for (const id of retired) { b.charge(); ids.add(id); }
  const activeIds=new Set(activeReceipts.map(r=>{b.charge();return r.value.recording_id;}));
  for(const entry of inventory.values()){
    b.charge();if(completedRetired.has(entry.recording_id))b.stop("terminal_inventory_conflict");
    if(entry.location==="holding"&&!selected.has(entry.recording_id)&&!retired.has(entry.recording_id))b.stop("inventory_unowned_holding");
    if(entry.location==="source"&&entry.role==="payload"&&!activeIds.has(entry.recording_id)&&!selected.has(entry.recording_id)&&!retired.has(entry.recording_id))holds.add("source_evidence_missing");
  }
  for(const r of legacy)for(const p of r.value.pairs){b.charge();referenced.add(p.payload_hash);}
  for (const m of legacy) {
    const known: LegacyBatchEvidence[] = [];
    for (const ref of m.value.pairs) {
      b.charge(); const r = byId.get(ref.recording_id);
      if (r) {
        const original={value:r.value,hash:r.hash,bytes:r.bytes,previous_recorded_at:null};
        checkLegacyReference(m.value,ref,original,payloads.get(r.value.payload_hash),b); known.push({original,ref});
      }
    }
    checkLegacyBatchOrder(known,payloads,b);
  }
  // Payload-only evidence is legitimate when the paired receipt has already been purged.
  return { receipts, activeReceipts, inventory, payloads, byId, referenced, legacy, oldById, retired, completedRetired, receiptOrigins, effects, ids };
}
function checkReceiptOrigins(legacy: ReturnType<typeof legacyView>, snapshot: Map<string,OriginalReceipt> | null, b: CommittedMaintenanceBudget) {
  for (const r of legacy.receipts) {
    b.charge(); const id=r.value.recording_id;
    if (!legacy.inventory.has(inventoryKey(id,"receipt")) && !legacy.inventory.has(inventoryKey(id,"payload")) &&
      legacy.receiptOrigins.get(id) !== r.hash && snapshot?.get(id)?.hash !== r.hash) b.stop("unreferenced_receipt");
  }
}
function checkStoreSequences(legacy: ReturnType<typeof legacyView>, snapshot: Map<string,OriginalReceipt> | null, b: CommittedMaintenanceBudget) {
  const owners=new Map<number,string>();
  const bind=(sequence: number, id: string) => {
    b.charge(); const owner=owners.get(sequence);
    if (owner !== undefined && owner !== id) b.stop("store_sequence_alias");
    owners.set(sequence,id);
  };
  for (const m of legacy.legacy) { b.charge(); for (const ref of m.value.pairs) bind(ref.sequence,ref.recording_id); }
  for (const r of legacy.receipts) bind(r.value.sequence,r.value.recording_id);
  if (snapshot) for (const r of snapshot.values()) bind(r.value.sequence,r.value.recording_id);
}
function checkLegacyReferences(legacy: ReturnType<typeof legacyView>, snapshot: Map<string,OriginalReceipt> | null, b: CommittedMaintenanceBudget) {
  for (const m of legacy.legacy) {
    b.charge(); const known: LegacyBatchEvidence[] = [], sequences=new Set<number>();
    for (const ref of m.value.pairs) {
      b.charge();
      if (sequences.has(ref.sequence)) b.stop("legacy_sequence_alias");
      sequences.add(ref.sequence);
      b.charge(); const raw=legacy.byId.get(ref.recording_id);
      const original=snapshot?.get(ref.recording_id) ?? (raw ? {value:raw.value,hash:raw.hash,bytes:raw.bytes,previous_recorded_at:null} : undefined);
      let payloadObserved: string | undefined;
      if (!original) payloadObserved=checkLegacyClaim(m.value,ref,legacy.payloads.get(ref.payload_hash),b);
      else {
        // Raw copies were already checked by legacyView; rebind frozen originals here.
        if (snapshot !== null) checkLegacyReference(m.value,ref,original,legacy.payloads.get(original.value.payload_hash),b);
      }
      known.push({original,ref,payload_observed_at:payloadObserved});
    }
    checkLegacyBatchOrder(known,legacy.payloads,b);
  }
}
function transactionView(records: RecordRow[], evaluation: Row, legacy: ReturnType<typeof legacyView>, b: CommittedMaintenanceBudget, holds: Set<string>) {
  const intents = select(records, "intent", b), manifests = select(records, "manifest", b);
  if (!intents.length) {
    if (records.some(r => { b.charge(); return ["manifest", "attempt", "event", "completion"].includes(r.role); })) b.stop("orphan_transaction_record");
    checkLegacyReferences(legacy,null,b);
    checkStoreSequences(legacy,null,b);
    checkReceiptOrigins(legacy,null,b);
    for (const p of legacy.payloads.values()) { b.charge(); if (!legacy.referenced.has(p.hash)) b.stop("unreferenced_payload"); }
    if (legacy.ids.has(evaluation.evaluation_id)) b.stop("evaluation_id_alias");
    return { completed: true, pairs: [] as Row[], approval_time_only: false, unconfirmed_completions: [] as Row[] };
  }
  if (intents.length !== 1) b.stop("intent_count");
  const intent = intents[0], iv = intent.value, binding = iv.binding, baseline = baselineOf(intent);
  if (iv.manifests.length !== manifests.length) b.stop("manifest_set");
  const byChunk = new Map<string, RecordRow>();
  for (const m of manifests) { b.charge(); if (byChunk.has(m.value.chunk_id)) b.stop("manifest_binding"); byChunk.set(m.value.chunk_id, m); }
  b.charge(legacy.ids.size);
  const ids = new Set<string>(legacy.ids), snapshot = new Map<string, OriginalReceipt>(), snapshotSequences = new Map<number, string>();
  let previousSequence = 0, previousRecordedAt = "";
  for (const r of baseline.receipts) {
    b.charge();
    if (snapshot.has(r.recording_id) || snapshotSequences.has(r.sequence) || r.sequence <= previousSequence || legacy.oldById.has(r.recording_id) ||
      r.policy_hash !== binding.policy_hash || r.recorded_at < previousRecordedAt || r.day !== (r.partition_at ?? r.recorded_at).slice(0,10) || r.partition_at && r.partition_at > r.recorded_at) b.stop("baseline_receipt_binding");
    b.charge(); const payload = legacy.payloads.get(r.payload_hash);
    if (payload && previousRecordedAt && payload.value.capture_as_of < previousRecordedAt) b.stop("baseline_observation_order");
    const receiptCanonical = canonicalReceipt(r, b, true), hash = receiptCanonical.hash;
    snapshot.set(r.recording_id, { value: r, hash, bytes: receiptCanonical.bytes, previous_recorded_at: previousRecordedAt || null }); snapshotSequences.set(r.sequence,r.recording_id);
    b.charge(); legacy.referenced.add(r.payload_hash);
    previousSequence = r.sequence; previousRecordedAt = r.recorded_at; ids.add(r.recording_id);
    const current = legacy.byId.get(r.recording_id);
    if (current && current.hash !== hash) b.stop("baseline_receipt_binding");
  }
  for (const r of legacy.receipts) { b.charge(); if (snapshotSequences.has(r.value.sequence) && snapshotSequences.get(r.value.sequence) !== r.value.recording_id) b.stop("baseline_sequence_binding"); }
  const prior = new Set<string>(), priorRetired = new Set<string>();
  for (const m of baseline.maintenance) {
    b.charge(); if (prior.has(m.id) || legacy.oldById.get(m.id)?.hash !== m.hash) b.stop("baseline_maintenance_binding"); prior.add(m.id);
    for (const p of legacy.oldById.get(m.id)!.value.pairs) { b.charge(); priorRetired.add(p.recording_id); }
  }
  for (const r of baseline.receipts) {
    b.charge();
    if (priorRetired.has(r.recording_id)) b.stop("baseline_retired_target");
  }
  if (binding.baseline_generation !== canonicalHash(baseline, COMMITTED_MAINTENANCE_LIMITS.input_bytes, b)) b.stop("baseline_generation");
  // Neither later v1 operation can retire a frozen receipt merely by reusing its ID.
  checkLegacyReferences(legacy,snapshot,b);
  checkStoreSequences(legacy,snapshot,b);
  if (ids.has(iv.maintenance_id) || ids.has(iv.approval.reference) || iv.maintenance_id === iv.approval.reference) b.stop("transaction_id_alias");
  ids.add(iv.maintenance_id);
  const pairs: Row[] = [], selectedIds = new Set<string>(), objectIds = new Set<string>();
  const privateProof = (proof: Row, dir: boolean) => {
    b.charge();
    if (proof.mode !== (dir ? "16832" : "33152") || !dir && proof.nlink !== "1" || proof.device !== binding.root.device || proof.uid !== binding.root.uid || proof.gid !== binding.root.gid) b.stop("object_access_binding");
    const key = `${proof.device}:${proof.inode}`;
    if (objectIds.has(key)) b.stop("object_alias"); objectIds.add(key);
  };
  privateProof(binding.root, true);
  const parents = new Set<string>();
  for (const p of binding.parents) { b.charge(); if (parents.has(p.path)) b.stop("parent_alias"); parents.add(p.path); privateProof(p.proof, true); }
  const needed = new Set<string>(), sequences = new Set<number>();
  let manifestOrdinal = 0;
  for (const mr of iv.manifests) {
    b.charge(); const m = byChunk.get(mr.chunk_id);
    if (!m || m.hash !== mr.hash || m.value.maintenance_id !== iv.maintenance_id || ids.has(mr.chunk_id) || mr.chunk_id === iv.approval.reference) b.stop("manifest_binding");
    if (iv.schema === "native-bar-committed-intent-v3" && (m.value.ordinal !== manifestOrdinal || m.value.total_pages !== iv.manifests.length ||
      m.value.collection_commitment !== iv.manifest_commitment)) b.stop("paged_manifest_binding");
    manifestOrdinal++;
    ids.add(mr.chunk_id);
    for (const p of m.value.pairs) {
      b.charge();
      if (pairs.length >= COMMITTED_MAINTENANCE_LIMITS.pairs) b.stop("pair_limit");
      if (selectedIds.has(p.recording_id) || sequences.has(p.sequence)) b.stop("pair_alias");
      if (legacy.retired.has(p.recording_id)) b.stop("retired_target");
      selectedIds.add(p.recording_id); sequences.add(p.sequence);
      const original = snapshot.get(p.recording_id), rv = p.receipt_fields;
      if (original && original.previous_recorded_at !== null && p.capture_as_of < original.previous_recorded_at) b.stop("baseline_observation_order");
      const receiptCanonical = canonicalReceipt(rv, b), receiptHash = receiptCanonical.hash;
      if (!original || original.hash !== p.receipt_hash || receiptHash !== p.receipt_hash || rv.recording_id !== p.recording_id || rv.sequence !== p.sequence || rv.day !== p.day ||
        rv.day !== (rv.partition_at ?? rv.recorded_at).slice(0, 10) || rv.partition_at && rv.partition_at > rv.recorded_at || rv.policy_hash !== binding.policy_hash ||
        rv.payload_hash !== p.payload_hash || rv.recorded_at !== p.recorded_at || p.last_observed_at > p.recorded_at || p.capture_as_of > p.last_observed_at ||
        BigInt(p.payload_proof.size) < 1n || BigInt(p.payload_proof.size) > BigInt(COMMITTED_MAINTENANCE_LIMITS.record_bytes) ||
        p.receipt_proof.size !== String(receiptCanonical.bytes)) b.stop("pair_evidence_binding");
      const payload = legacy.payloads.get(p.payload_hash);
      if (payload) {
        b.charge(); let latest = "";
        for (const s of payload.value.series) { b.charge(); if (s.observed_at > latest) latest = s.observed_at; }
        if (payload.bytes !== Number(p.payload_proof.size) || latest !== p.last_observed_at || payload.value.capture_as_of !== p.capture_as_of) b.stop("pair_evidence_binding");
      }
      privateProof(p.receipt_proof, false); privateProof(p.payload_proof, false);
      for (const area of ["captures", "receipts"]) { b.charge(); needed.add(area); needed.add(`${area}/${p.day}`); }
      const stamp = Math.max(Date.parse(p.recorded_at), Date.parse(p.last_observed_at)), approved = Date.parse(iv.approval.approved_at);
      if (iv.kind === "prune" ? stamp >= approved - 90 * 86400000 : stamp <= approved + 60000) b.stop("original_eligibility");
      pairs.push({ ...p, receipt: "source", payload: "source", stamp });
    }
  }
  if (pairs.length !== iv.pair_count || needed.size !== parents.size || [...needed].some(p => { b.charge(); return !parents.has(p); })) b.stop("target_scope_binding");
  if (b instanceof StreamBudget) b.releaseIntentProofs?.(binding);
  checkReceiptOrigins(legacy,snapshot,b);
  for (const p of legacy.payloads.values()) { b.charge(); if (!legacy.referenced.has(p.hash)) b.stop("unreferenced_payload"); }
  if (ids.has(evaluation.evaluation_id) || evaluation.evaluation_id === iv.approval.reference) b.stop("evaluation_id_alias"); ids.add(evaluation.evaluation_id);
  const transactionHolds = new Set<string>();
  const view = replay(records, iv, intent.hash, pairs, ids, evaluation, b, transactionHolds);
  for (const p of pairs) for (const r of ["receipt", "payload"]) {
    b.charge(); const present = r === "receipt" ? legacy.byId.has(p.recording_id) : legacy.payloads.has(p.payload_hash);
    const entry=legacy.inventory.get(inventoryKey(p.recording_id,r)),terminal=["purged_verified","quarantined_verified"].includes(p[r]);
    if(terminal){ if(entry)b.stop("terminal_inventory_conflict");continue; }
    if(entry && (p[r]==="source" && entry.location!=="source" || p[r]==="held_verified" && entry.location!=="holding" ||
      p[r]==="unlink_pending" && entry.location!=="holding" || p[r]==="quarantine_move_pending" && entry.location!=="holding"))b.stop("inventory_state_binding");
    if (!present || !entry) transactionHolds.add(p[r] === "unlink_pending" ? "unlink_outcome_unknown" :
      p[r] === "quarantine_move_pending" ? "quarantine_outcome_unknown" : "source_evidence_missing");
  }
  const targetIds = new Set(pairs.map(p => { b.charge(); return p.recording_id; }));
  const liveReceiptIds=new Set(legacy.activeReceipts.map(r=>{b.charge();return r.value.recording_id;}));
  for (const [id,original] of snapshot) {
    b.charge();
    if (!targetIds.has(id) && !legacy.retired.has(id) && (!liveReceiptIds.has(id) ||
      !legacy.payloads.has(original.value.payload_hash) || legacy.inventory.get(inventoryKey(id,"payload"))?.location !== "source")) transactionHolds.add("baseline_source_missing");
  }
  if (!view.completed) {
    for (const r of legacy.activeReceipts) { b.charge(); if (!snapshot.has(r.value.recording_id)) transactionHolds.add("current_baseline_changed"); }
    if (prior.size !== legacy.legacy.length) transactionHolds.add("current_baseline_changed");
  }
  let retainedFloor=previousRecordedAt;
  if(view.completed && (iv.kind==="clock_recovery" || legacy.effects.clock.isolated_ids.length)){
    const isolatedIds = new Set<string>();
    for (const id of legacy.effects.clock.isolated_ids) { b.charge(); isolatedIds.add(id); }
    retainedFloor="";
    for (const [id,r] of snapshot) {
      b.charge();
      // Later completed v1 clock isolation also removes its original recording floor.
      // For a prune transaction, a later prune alone cannot reset its time floor.
      if (isolatedIds.has(id) || iv.kind === "clock_recovery" && (targetIds.has(id) || legacy.completedRetired.has(id))) continue;
      if (r.value.recorded_at > retainedFloor) retainedFloor=r.value.recorded_at;
    }
  }
  for (const r of legacy.activeReceipts) {
    b.charge();
    if (view.completed && !snapshot.has(r.value.recording_id)) {
      if (r.value.sequence <= previousSequence) b.stop("baseline_sequence_binding");
      const payload = legacy.payloads.get(r.value.payload_hash);
      if (payload && payload.value.capture_as_of < retainedFloor) b.stop("post_completion_order");
    }
  }
  const unconfirmedCompletions: Row[] = [];
  if (view.completed) {
    if (transactionHolds.size) {
      const effects = emptyEffects(); addEffect(effects, iv.kind, pairs, b);
      unconfirmedCompletions.push({ maintenance_id: iv.maintenance_id, kind: iv.kind, evidence_status: "unresolved", blockers: [...transactionHolds], effects });
    } else addEffect(legacy.effects, iv.kind, pairs, b);
  }
  for (const reason of transactionHolds) { b.charge(); holds.add(reason); }
  return { ...view, unconfirmed_completions: unconfirmedCompletions };
}

function replay(records: RecordRow[], intent: Row, intentHash: string, pairs: Row[], ids: Set<string>, evaluation: Row, b: CommittedMaintenanceBudget, holds: Set<string>) {
  const evaluationAt = evaluation.at;
  const terminal = intent.kind === "prune" ? "purged_verified" : "quarantined_verified";
  const byId = new Map(pairs.map(p => { b.charge(); return [p.recording_id, p]; }));
  const pendingOwner = new Map<string, string>(), ctimes = new Map<string, bigint>();
  const approvalRefs = new Set<string>(), approvalHashes = new Set<string>(), clockIds = new Set<string>();
  const clockTicks = new Map<string, bigint>();
  let active: RecordRow | null = null, lastHash: string | null = null, sequence = 0, lastAt: string | null = null;
  let lastTick = 0n, conflict = false, uncertain = false, completed = false;
  let permissions = new Set<string>();
  const key = (id: string, r: string, a: string) => `${id}|${r}|${a}`;
  const required = () => {
    const set = new Set<string>();
    for (const p of pairs) for (const r of ["receipt", "payload"]) {
      b.charge(); const s = p[r];
      const actions = uncertain || s.endsWith("_pending") ? ["reconcile"] : s === "source" ? ["stage", intent.kind === "prune" ? "unlink" : "quarantine"]
        : s === "held_verified" ? [intent.kind === "prune" ? "unlink" : "quarantine"] : [];
      for (const a of actions) { b.charge(); set.add(key(p.recording_id, r, a)); }
    }
    return set;
  };
  const use = (p: Row, r: string, a: string) => {
    b.charge();
    if (!permissions.delete(key(p.recording_id, r, a))) b.stop("action_not_approved");
  };
  const evidence = (event: Row, p: Row, place: "source" | "holding" | "quarantine" | "absent") => {
    const e = event.evidence, original = p[`${event.role}_proof`], k = key(p.recording_id, event.role, "proof");
    if (!e || e.sha256 !== p[`${event.role}_hash`]) b.stop("event_proof");
    for (const field of Object.keys(original)) {
      b.charge();
      if (!["ctime_ns", "nlink"].includes(field) && e.proof[field] !== original[field]) b.stop("event_proof");
    }
    const ctime = BigInt(e.proof.ctime_ns);
    if (e.proof.nlink !== (place === "absent" ? "0" : "1") || ctime < (ctimes.get(k) ?? BigInt(original.ctime_ns)) ||
      BigInt(e.from_ns) > ctime || ctime > BigInt(e.through_ns) ||
      e.source_present !== (place === "source") || e.holding_present !== (place === "holding") || e.quarantine_present !== (place === "quarantine")) b.stop("event_proof");
    ctimes.set(k, ctime);
  };
  for (const row of records) {
    b.charge();
    if (!["attempt", "event", "completion"].includes(row.role)) continue;
    const v = row.value;
    if (completed || conflict) b.stop(completed ? "after_completion" : "conflict_terminal");
    if (v.maintenance_id !== intent.maintenance_id || v.intent_hash !== intentHash) b.stop("transaction_binding");
    if (row.role === "attempt") {
      if (ids.has(v.attempt_id) || approvalRefs.has(v.approval.reference) || approvalHashes.has(v.approval.plan_hash) ||
        ids.has(v.approval.reference) || (ids.has(v.monotonic.clock_id) && !clockIds.has(v.monotonic.clock_id)) ||
        new Set([v.attempt_id, v.approval.reference, v.monotonic.clock_id]).size !== 3) b.stop("attempt_alias_or_replay");
      if (v.resume_after_event_hash !== lastHash || !active && (v.approval.reference !== intent.approval.reference ||
        v.approval.plan_hash !== intent.approval.plan_hash || v.approval.approved_at !== intent.approval.approved_at)) b.stop("approval_binding");
      const duration = Date.parse(v.expires_at) - Date.parse(v.approval.approved_at), ticks = BigInt(v.monotonic.deadline_ns) - BigInt(v.monotonic.issued_ns);
      if (duration <= 0 || duration > 600000 || ticks <= 0n || ticks > 600000000000n || BigInt(v.monotonic.observed_ns) < BigInt(v.monotonic.issued_ns)) b.stop("attempt_window");
      if (BigInt(v.monotonic.issued_ns) < (clockTicks.get(v.monotonic.clock_id) ?? 0n)) b.stop("clock_regression");
      const expected = required(), supplied = new Set<string>();
      for (const a of v.actions) { b.charge(); const k = key(a.recording_id, a.role, a.action); if (supplied.has(k) || !expected.has(k)) b.stop("remaining_action_scope"); supplied.add(k); }
      if (supplied.size !== expected.size) b.stop("remaining_action_scope");
      ids.add(v.attempt_id); ids.add(v.approval.reference); ids.add(v.monotonic.clock_id); clockIds.add(v.monotonic.clock_id);
      approvalRefs.add(v.approval.reference); approvalHashes.add(v.approval.plan_hash);
      active = row; permissions = supplied; lastTick = BigInt(v.monotonic.observed_ns);
      clockTicks.set(v.monotonic.clock_id, lastTick);
      continue;
    }
    if (!active || v.attempt_id !== active.value.attempt_id || v.attempt_hash !== active.hash) b.stop("attempt_binding");
    const a = active.value, at = row.role === "event" ? v.at : v.completed_at;
    if (at < a.approval.approved_at || at >= a.expires_at || lastAt !== null && at < lastAt) b.stop("event_window");
    if (at > evaluationAt) holds.add("evaluation_before_event");
    const tick = BigInt(v.monotonic_ns);
    if (tick < lastTick || tick < BigInt(a.monotonic.issued_ns) || tick >= BigInt(a.monotonic.deadline_ns)) b.stop("event_window");
    lastTick = tick; lastAt = at;
    clockTicks.set(a.monotonic.clock_id, tick);
    if (row.role === "completion") {
      if (!lastHash || v.last_event_hash !== lastHash || v.targets.length !== pairs.length || uncertain) b.stop("incomplete_completion");
      const seen = new Set();
      for (const t of v.targets) {
        b.charge(); const p = byId.get(t.recording_id);
        if (!p || seen.has(t.recording_id) || [p.receipt, p.payload, t.receipt, t.payload].some(x => x !== terminal)) b.stop("incomplete_completion");
        seen.add(t.recording_id);
      }
      completed = true; continue;
    }
    if (v.sequence !== sequence + 1 || v.previous_event_hash !== lastHash || !byId.has(v.recording_id)) b.stop("event_chain");
    if (v.sync !== (v.type === "durability_unknown" ? "unknown" : "reported_success")) b.stop("sync_outcome");
    const p = byId.get(v.recording_id)!, r = v.role, current = p[r], k = key(p.recording_id, r, "pending");
    const reconcile = () => { if (pendingOwner.get(k) !== a.attempt_id || uncertain) use(p, r, "reconcile"); };
    if (v.type === "conflict") { if (v.evidence !== null) b.stop("unexpected_evidence"); conflict = true; }
    else if (v.type === "durability_unknown") { if (v.evidence !== null) b.stop("unexpected_evidence"); uncertain = true; }
    else if (v.type === "move_pending") {
      if (current !== "source" || uncertain || v.evidence !== null) b.stop("invalid_transition");
      if (intent.kind === "prune" && p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(a.approval.approved_at), Date.parse(at)) - 90 * 86400000) b.stop("action_eligibility");
      use(p, r, "stage"); p[r] = v.type; pendingOwner.set(k, a.attempt_id);
    } else if (v.type === "held_verified") {
      if (current !== "move_pending") b.stop("invalid_transition");
      reconcile(); evidence(v, p, "holding"); p[r] = v.type;
    } else if (v.type === "unlink_pending" || v.type === "quarantine_move_pending") {
      const targetAction = v.type === "unlink_pending" ? "unlink" : "quarantine";
      if (targetAction !== (intent.kind === "prune" ? "unlink" : "quarantine") || current !== "held_verified" || uncertain || v.evidence !== null ||
        !["held_verified", terminal].includes(p.receipt) || !["held_verified", terminal].includes(p.payload)) b.stop("invalid_transition");
      if (intent.kind === "prune" && p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(a.approval.approved_at), Date.parse(at)) - 90 * 86400000) b.stop("action_eligibility");
      use(p, r, targetAction); p[r] = v.type; pendingOwner.set(k, a.attempt_id);
    } else if (v.type === "purged_verified" || v.type === "quarantined_verified") {
      if (v.type !== terminal || current !== (intent.kind === "prune" ? "unlink_pending" : "quarantine_move_pending")) b.stop("invalid_transition");
      if (v.type === "purged_verified" && pendingOwner.get(k) !== a.attempt_id) holds.add("unlink_outcome_unknown");
      reconcile(); evidence(v, p, intent.kind === "prune" ? "absent" : "quarantine"); p[r] = v.type;
    } else {
      if (!["reconciled_source", "reconciled_held"].includes(v.type) || pendingOwner.get(k) === a.attempt_id && !uncertain ||
        !(v.type === "reconciled_source" ? ["source", "move_pending"] : ["move_pending", "held_verified", "unlink_pending", "quarantine_move_pending"]).includes(current)) b.stop("invalid_reconciliation");
      use(p, r, "reconcile"); evidence(v, p, v.type === "reconciled_source" ? "source" : "holding"); p[r] = v.type === "reconciled_source" ? "source" : "held_verified";
    }
    sequence = v.sequence; lastHash = row.hash;
  }
  if (conflict) holds.add("conflict");
  if (uncertain) holds.add("durability_unknown");
  if (active) {
    if (!completed && (evaluationAt < active.value.approval.approved_at || evaluationAt >= active.value.expires_at)) holds.add("attempt_expired_or_clock_rollback");
    const clock = evaluation.clock;
    if (!clock || clock.clock_id !== active.value.monotonic.clock_id) { if (!completed) holds.add("evaluation_clock_unverified"); }
    else {
      const now = BigInt(clock.monotonic_ns);
      if (now < lastTick) holds.add("evaluation_clock_regression");
      if (!completed && now >= BigInt(active.value.monotonic.deadline_ns)) holds.add("attempt_expired_or_clock_rollback");
    }
  }
  if (!completed && intent.kind === "prune" && pairs.some(p => { b.charge(); return p.stamp >= Math.min(Date.parse(intent.approval.approved_at), Date.parse(evaluationAt)) - 90 * 86400000; })) holds.add("current_eligibility");
  return { completed, approval_time_only: intent.kind === "clock_recovery" && pairs.every(p => { b.charge(); return p.stamp <= Date.parse(evaluationAt) + 60000; }),
    pairs: pairs.map(p => { b.charge(); return { recording_id: p.recording_id, receipt: p.receipt, payload: p.payload }; }) };
}

export type DecisionFormat = "v3" | "paged-stage-a";
function resultObject(decision: Row, format: DecisionFormat, b?: CommittedMaintenanceBudget): Row {
  return format === "v3" ? { schema: "native-bar-committed-result-v3", ...noAuthority, ...decision }
    : { schema: "native-bar-committed-result-v4", ...noAuthority, stage_a_only: true,
        adoption: { state: "blocked", blockers: ["stage_a_connection_only"] }, read_effect: "blocked", semantic: decision,
        ...(b instanceof StreamBudget ? {streaming:Object.freeze({checkpoint:"before_result_encoding",...b.stats})}: {}) };
}
export function rejectCommittedLogical(error: unknown, b: CommittedMaintenanceBudget, diagnosticEffects: Effects | null = null, format: DecisionFormat = "v3") {
  const reason = error instanceof Rejected ? error.message : "invalid_input";
  const decision = Object.freeze({ status: "rejected", reason, effects: diagnosticEffects,
    effects_status: diagnosticEffects ? "partial" : "not_evaluated", remaining_effects_unknown: true,
    unconfirmed_completions: Object.freeze([]), adoption: Object.freeze({ state: "blocked", blockers: Object.freeze([reason]) }),
    read_effect: "blocked", pairs: Object.freeze([]) });
  const result = resultObject(decision,format,b);
  if (format === "paged-stage-a") { Object.freeze(result.adoption?.blockers); Object.freeze(result.adoption); }
  return Object.freeze({ ...result, work_charged: b.used });
}
export type LogicalHeader = { policy_hash: string; inventory: Row[]; evaluation: Row };
export function verifyCommittedLogical(records: RecordRow[], header: LogicalHeader, b: CommittedMaintenanceBudget, format: DecisionFormat = "v3") {
  const holds = new Set<string>(); let diagnosticEffects: Effects | null = null;
  try {
    const journal: Row[] = [], evidence: Row[] = [], selected = new Set<string>();
    let intentHash: string | null = null, attemptHash: string | null = null;
    for (const r of records) {
      b.charge();
      (r.role === "receipt_v1" || r.role === "payload_v1" ? evidence : journal).push(knownObject({ role: r.role, hash: r.hash },2,b));
      if (r.role === "intent") intentHash = r.hash;
      if (r.role === "attempt") attemptHash = r.hash;
      if (r.role === "manifest") for (const p of r.value.pairs) { b.charge(); selected.add(p.recording_id); }
    }
    evidence.sort((a, c) => { b.charge(); return a.hash < c.hash ? -1 : a.hash > c.hash ? 1 : a.role < c.role ? -1 : a.role > c.role ? 1 : 0; });
    const inventory=inventoryView(records,header.inventory,b);
    const inventoryRows=header.inventory.map(entry=>{b.charge();return {entry,key:encode(entry,COMMITTED_MAINTENANCE_LIMITS.record_bytes,b)};});
    inventoryRows.sort((a,c)=>{b.charge();return a.key<c.key?-1:a.key>c.key?1:0;});
    const e = header.evaluation;
    if (e.journal_hash !== canonicalHash(journal, COMMITTED_MAINTENANCE_LIMITS.input_bytes, b) ||
      e.inventory_hash !== canonicalHash(knownObject({policy_hash:header.policy_hash,entries:inventoryRows.map(r=>{b.charge();return r.entry;})},2,b), COMMITTED_MAINTENANCE_LIMITS.input_bytes, b) ||
      e.evidence_hash !== canonicalHash(evidence,COMMITTED_MAINTENANCE_LIMITS.input_bytes,b) ||
      e.intent_hash !== intentHash || e.attempt_hash !== attemptHash) b.stop("evaluation_snapshot_binding");
    for(const r of select(records,"intent",b)) {b.charge();if(r.value.binding.policy_hash!==header.policy_hash)b.stop("v1_policy_binding");}
    const legacy = legacyView(records, b, holds, selected,header.policy_hash,inventory);
    // Preserve a bounded frozen copy of previously checked effects even if the new transaction refuses.
    b.charge(legacy.effects.clock.isolated_ids.length + legacy.effects.retired_ids.length);
    const copy = { prune: { ...legacy.effects.prune }, clock: { isolated_ids: [...legacy.effects.clock.isolated_ids] }, retired_ids: [...legacy.effects.retired_ids] };
    freeze(copy, b); canonicalSizeCheck(copy, COMMITTED_MAINTENANCE_LIMITS.output_bytes - 2048, b); diagnosticEffects = copy;
    const view = transactionView(records, e, legacy, b, holds);
    const blockers = [...holds]; if (!view.completed) blockers.push("transaction_incomplete");
    const blocked = blockers.length !== 0, effects = legacy.effects;
    const decision = { status: holds.size ? "held" : "consistent", reason: [...holds][0] ?? null,
      effects, effects_status: "evaluated", remaining_effects_unknown: view.unconfirmed_completions.length !== 0,
      unconfirmed_completions: view.unconfirmed_completions,
      adoption: { state: blocked ? "blocked" : "conditional", blockers },
      read_effect: blocked ? "blocked" : effects.prune.present && effects.clock.isolated_ids.length ? "combined_conditionally" : effects.prune.present
        ? "apply_prune_boundary_conditionally" : effects.clock.isolated_ids.length ? "exclude_clock_quarantine_conditionally" : "unchanged_conditionally",
      prune_boundary: effects.prune.boundary_state === "known" ? effects.prune.greatest_known_recorded_at : null,
      approval_time_only: view.approval_time_only, pairs: view.pairs };
    const result = resultObject(decision,format,b);
    freeze(result, b); canonicalSizeCheck(result, COMMITTED_MAINTENANCE_LIMITS.output_bytes - 64, b);
    return Object.freeze({ ...result, work_charged: b.used });
  } catch (error) { return rejectCommittedLogical(error,b,diagnosticEffects,format); }
}
