import test from "node:test";
import assert from "node:assert/strict";
import { runMutation,replaceOnce as edit } from "../helpers/committedPagingMutationHarness.mjs";
const entry=new URL("../../build/internal/nativeBarCommittedPagedConnection.js",import.meta.url);
const shared=new URL("../../build/internal/nativeBarCommittedSemantic.js",import.meta.url);
const tests=new URL("./nativeBarCommittedPagedConnection.test.mjs",import.meta.url);
const small="^connection (?!shares the cumulative budget|baseline metadata count)";
const wire=[
 ["C01",s=>edit(s,'digest(encode(s, LIMITS.record_bytes, b), b) !== root.snapshot_generation','false')],
 ["C02",s=>edit(s,'digest(bytes[ref.index], b) !== ref.hash','false')],
 ["C03",s=>edit(s,'v.binding.baseline_generation !== s.baseline_generation','false')],
 ["C04",s=>edit(s,'ref.receipts.commitment !== receipts.commitment','false')],
 ["C05",s=>edit(s,'ref.receipts.count !== receipts.total_entries','false')],
 ["C06",s=>edit(s,'v.manifest_commitment !== s.manifest_commitment','false')],
 ["C07",s=>edit(s,'s.manifest_commitment !== digest(encode({ schema: "native-bar-committed-manifest-collection-v1", pairs }, LIMITS.input_bytes, b), b)','false')],
 ["C08",s=>edit(s,'r.resolved_baseline = { receipts: rows.baseline_receipts, maintenance: rows.baseline_maintenance };',
  'for (const row of rows.baseline_receipts) { if (row.policy_hash !== s.policy_hash) b.stop("baseline_receipt_binding"); }\n'+
  'r.resolved_baseline = { receipts: rows.baseline_receipts, maintenance: rows.baseline_maintenance };')],
 ["C09",s=>edit(s,'verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, b, "paged-stage-a")',
  'verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, new CommittedMaintenanceBudget(), "paged-stage-a")'),'cumulative budget'],
 ["C10",s=>edit(s,'ref.index !== i + 1 || ref.index >= bytes.length || rank < lastKind || ref.ordinal !== (rank === lastKind ? ordinal + 1 : 0)','false')],
 ["C11",s=>edit(s,'page.commitment !== s.collections[rank].commitment','false')],
 ["C12",s=>edit(s,'page.entries.length !== ref.entry_count','false')],
 ["C13",s=>edit(s,'(totals.get(kind) ?? 0) !== (pageCounts.get(kind) ?? 0)','false')],
 ["C14",s=>edit(s,'digest(encode({ schema: "native-bar-committed-collection-v1", kind, entries: rows[kind] }, LIMITS.input_bytes, b), b) !== c.commitment','false')],
 ["C15",s=>edit(s,'hash !== d.hash','false')],
 ["C16",s=>edit(s,'s.collections[i].kind !== kinds[i]','false')],
 ["C17",s=>edit(s,'ref.kind === "baseline_receipts" && rows[ref.kind].length + page.entries.length > LIMITS.store_receipts','false'),'^connection baseline metadata count'],
];
const semantic=[
 ["S01",s=>edit(s,'checkLegacyBatchOrder(known, payloads, b);','')],
 ["S02",s=>edit(s,'checkStoreSequences(legacy, snapshot, b);','')],
 ["S03",s=>edit(s,'if (!view.completed)\n            blockers.push("transaction_incomplete");','if (!view.completed && format === "v3")\n            blockers.push("transaction_incomplete");')],
 ["S04",s=>edit(s,'adoption: { state: "blocked", blockers: ["stage_a_connection_only"] }','adoption: { state: "conditional", blockers: [] }')],
 ["S05",s=>edit(s,'read_effect: "blocked", semantic: decision','read_effect: "unchanged_conditionally", semantic: decision')],
 ["S06",s=>edit(s,'m.value.collection_commitment !== iv.manifest_commitment','false')],
 ["S07",s=>edit(s,'m.value.ordinal !== manifestOrdinal','false')],
 ["S08",s=>edit(s,'m.value.total_pages !== iv.manifests.length','false')],
];
for(const [group,module,cases,wrapper] of [["wire",entry,wire,undefined],["semantic",shared,semantic,entry]])
 test(`connection ${group} mutations preserve passing controls and are detected`,()=>{
  const patterns=new Set(cases.map(([, ,pattern])=>pattern??small));
  for(const pattern of patterns){const control=runMutation(module,tests,s=>s,pattern,wrapper);
   assert.equal(control.code,0,control.output);assert.match(control.output,/tests [1-9][0-9]*\b/);}
  for(const [name,change,pattern] of cases){const r=runMutation(module,tests,change,pattern??small,wrapper);
   assert.equal(r.error,undefined,`${name}: ${r.error}`);assert.notEqual(r.code,0,`${name} survived`);assert.match(r.output,/AssertionError/,r.output);
   console.log(`${name} detected ${r.hash.slice(0,12)}`);}
 });
