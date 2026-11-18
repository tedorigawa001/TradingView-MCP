import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {inspectCommittedMaintenance} from "../../build/nativeBarCommittedTransactions.js";
import {inspectCommittedPagedMaintenanceStageA} from "../../build/internal/nativeBarCommittedPagedConnection.js";
import {connectionFixture,addLegacyBatch,commitment,inventoryFor,timedSource,ID,hash,buffer,canonical} from "../helpers/committedConnectionFixture.mjs";
import {source} from "../helpers/committedPagingFixture.mjs";
test("connection shares the v3 normal-read meaning while the outer reader stays blocked",()=>{
 const f=connectionFixture({transaction:false}),old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());
 assert.equal(old.adoption.state,"conditional",old.reason);assert.equal(r.semantic.adoption.state,"conditional",r.semantic.reason);
 assert.deepEqual(r.semantic.effects,old.effects);assert.equal(r.adoption.state,"blocked");assert.equal(r.read_effect,"blocked");assert.equal(r.execution_available,false);
});
const semantic=r=>{const {schema,work_charged,...value}=r;for(const k of ["diagnostic_only","execution_available","recovery_execution_available","production_qualified","host_approval_authenticated","native_bytes_verified","history_read_available","original_acknowledgement"])delete value[k];return value;};
function blocked(r){assert.equal(r.adoption.state,"blocked");assert.equal(r.read_effect,"blocked");for(const k of ["execution_available","recovery_execution_available","production_qualified","host_approval_authenticated","native_bytes_verified","history_read_available"])assert.equal(r[k],false,k);}
function reject(p,reason,phase="not_evaluated"){const r=inspectCommittedPagedMaintenanceStageA(p.input());blocked(r);assert.equal(r.semantic.status,"rejected");assert.equal(r.semantic.reason,reason);assert.equal(r.semantic.effects_status,phase);return r;}
for(const kind of ["prune","clock_recovery"])for(const state of ["intent","staged","pending","complete"])
 test(`connection preserves full internal v3 meaning for ${kind}/${state}`,()=>{
  const f=connectionFixture({kind,state}),old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());
  assert.equal(old.status,"consistent",old.reason);assert.deepEqual(r.semantic,semantic(old));blocked(r);
  assert.equal(r.semantic.adoption.state,state==="complete"?"conditional":"blocked");
  if(state!=="complete")assert.ok(r.semantic.adoption.blockers.includes("transaction_incomplete"));
 });

test("connection retains early copy-time refusal before diagnostic effects are captured",()=>{
 const f=connectionFixture();addLegacyBatch(f,{badCutoff:true});
 const old=inspectCommittedMaintenance(f.v3()),r=reject(f.v4(),"legacy_batch_observation_order");assert.equal(r.semantic.effects,null);assert.deepEqual(r.semantic,semantic(old));
});
for(const field of ["recorded_at","policy_hash","generation"])
 test(`connection postpones baseline ${field} semantics until after the legacy snapshot`,()=>{
  const f=connectionFixture();addLegacyBatch(f);const p=f.v4(),intent=p.records.find(r=>r.role==="intent").value;
  if(field==="generation")intent.binding.baseline_generation="0".repeat(64);
  else {p.baseline.receipts[1][field]=field==="recorded_at"?"2025-12-31T23:00:00.000Z":"0".repeat(64);
   if(field==="recorded_at")p.baseline.receipts[1].day="2025-12-31";
   intent.binding.baseline_ref.receipts.commitment=commitment("baseline_receipts",p.baseline.receipts);}
  const r=reject(p.reframe(),field==="generation"?"baseline_generation":"baseline_receipt_binding","partial");assert.notEqual(r.semantic.effects,null);
  assert.ok(r.semantic.effects.retired_ids.includes(ID(30)));assert.equal(r.semantic.remaining_effects_unknown,true);
 });

test("connection preserves late cross-scope sequence refusal and partial legacy diagnostics",()=>{
 const f=connectionFixture();addLegacyBatch(f,{declared:true,collision:true});const old=inspectCommittedMaintenance(f.v3()),r=reject(f.v4(),"store_sequence_alias","partial");
 assert.deepEqual(r.semantic,semantic(old));assert.notEqual(r.semantic.effects,null);
});

for(const field of ["baseline_generation","manifest_commitment"])
 test(`connection rejects individually sealed root/intent ${field} disagreement`,()=>{
  const p=connectionFixture().v4();p.root.snapshot[field]="0".repeat(64);p.sealRoot();
  reject(p,field==="baseline_generation"?"paged_baseline_declaration":"paged_manifest_collection");
 });
test("connection binds the intent's collection counts and commitments to the root",()=>{
 for(const field of ["count","commitment"]){const p=connectionFixture().v4(),v=p.records.find(r=>r.role==="intent").value;
  v.binding.baseline_ref.receipts[field]=field==="count"?3:"0".repeat(64);reject(p.reframe(),"paged_baseline_declaration");}
});
test("connection rejects an intent's own mismatched manifest collection declaration",()=>{
 const p=connectionFixture().v4();p.records.find(r=>r.role==="intent").value.manifest_commitment="0".repeat(64);reject(p.reframe(),"paged_manifest_declaration");
});
test("connection manifest membership and metadata cannot drift after resealing the outer snapshot",()=>{
 for(const field of ["ordinal","total_pages","collection_commitment"]){const p=connectionFixture().v4();const m=p.records.find(r=>r.role==="manifest").value;
  m[field]=field==="collection_commitment"?"0".repeat(64):99;
  const v=p.records.find(r=>r.role==="intent").value;v.manifests[0].hash=hash(m);reject(p.reframe(),"paged_manifest_binding","partial");}
 const p=connectionFixture().v4();p.records.find(r=>r.role==="intent").value.manifests.pop();reject(p.reframe(),"manifest_set","partial");
});
test("connection refuses mixed v2/v3 transaction records without relabelling them",()=>{
 for(const role of ["intent","manifest","attempt","event","completion"]){const p=connectionFixture().v4();p.records.find(r=>r.role===role).value.schema=`native-bar-committed-${role}-v2`;
  reject(p.reframe(),"invalid_record");}
});

for(const kind of ["prune","clock_recovery"])
 test(`connection reads completed ${kind} without retaining target bodies`,()=>{
  const f=connectionFixture({kind});f.records=f.records.filter(r=>!["receipt_v1","payload_v1"].includes(r.role));
  const old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());assert.equal(old.adoption.state,"conditional",old.reason);
  assert.deepEqual(r.semantic,semantic(old));blocked(r);
 });
for(const missing of ["receipt_v1","payload_v1","both"])
 test(`connection retains unconfirmed completion for missing non-target ${missing}`,()=>{
  const f=connectionFixture({retained:1});f.inventory=inventoryFor(f.records);
  const receipt=f.records.find(r=>r.role==="receipt_v1"&&r.value.recording_id===ID(3)).value;
  f.records=f.records.filter(r=>!(r.role==="receipt_v1"&&r.value.recording_id===ID(3)&&missing!=="payload_v1")&&
    !(r.role==="payload_v1"&&hash(r.value)===receipt.payload_hash&&missing!=="receipt_v1"));
  const old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());assert.equal(old.status,"held",old.reason);
  assert.deepEqual(r.semantic,semantic(old));assert.equal(r.semantic.unconfirmed_completions.length,1);
  assert.ok(r.semantic.unconfirmed_completions[0].blockers.includes("baseline_source_missing"));assert.deepEqual(r.semantic.effects.retired_ids,[]);blocked(r);
 });
test("connection permits corrected-clock recording while keeping all outer authority stopped",()=>{
 const f=connectionFixture({kind:"clock_recovery"}),s=timedSource(3,"2025-12-31T23:02:00.000Z");
 f.records.push({role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload});f.evaluationAt="2025-12-31T23:03:00.000Z";
 const old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());assert.equal(old.adoption.state,"conditional",old.reason);
 assert.deepEqual(r.semantic,semantic(old));blocked(r);
});
test("connection permits the same original across supplied, legacy and frozen baseline representations",()=>{
 const f=connectionFixture({retained:1}),r=f.records.find(r=>r.role==="receipt_v1"&&r.value.recording_id===ID(3)).value;
 const p=f.records.find(row=>row.role==="payload_v1"&&hash(row.value)===r.payload_hash).value;
 const old={schema:"native-bar-maintenance-v1",id:ID(95000),kind:"prune",created_at:"2026-05-01T00:00:00.000Z",generation:"4".repeat(64),pairs:[{
  recording_id:r.recording_id,sequence:r.sequence,day:r.day,receipt_hash:hash(r),payload_hash:r.payload_hash,recorded_at:r.recorded_at,last_observed_at:p.capture_as_of,
  bytes:Buffer.byteLength(canonical(r))+Buffer.byteLength(canonical(p))}]};
 f.records.push({role:"legacy_v1",value:old},{role:"legacy_completion_v1",value:{id:old.id,intent_hash:hash(old)}});
 const a=inspectCommittedMaintenance(f.v3()),v=inspectCommittedPagedMaintenanceStageA(f.v4().input());assert.equal(a.adoption.state,"conditional",a.reason);
 assert.deepEqual(v.semantic,semantic(a));blocked(v);
 r.plan_hash="0".repeat(64);reject(f.v4(),"legacy_prune_baseline_binding");
});
for(const kind of ["prune","clock_recovery"])
 test(`connection preserves ${kind} pending-outcome uncertainty when the receipt body disappears`,()=>{
  const f=connectionFixture({kind,state:"pending"});f.inventory=inventoryFor(f.records);
  f.records=f.records.filter(r=>!(r.role==="receipt_v1"&&r.value.recording_id===ID(1)));
  const old=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());assert.equal(old.status,"held",old.reason);
  assert.deepEqual(r.semantic,semantic(old));assert.ok(r.semantic.adoption.blockers.includes(kind==="prune"?"unlink_outcome_unknown":"quarantine_outcome_unknown"));blocked(r);
 });
test("connection checks page hashes and the root snapshot before any semantic adoption",()=>{
 let p=connectionFixture().v4();p.root.snapshot.evaluation.at="2026-06-01T00:00:00.000Z";reject(p,"page_snapshot_binding");
 p=connectionFixture().v4();p.pages[0].entries[0].sequence++;reject(p,"page_hash");
});
test("connection keeps input and version boundaries fixed",()=>{
 const b=new ArrayBuffer(1024**2),r=inspectCommittedPagedMaintenanceStageA(Array(17).fill(b));assert.equal(r.semantic.reason,"input_bytes_limit");blocked(r);
 const f=connectionFixture();assert.equal(inspectCommittedPagedMaintenanceStageA(f.v3()).semantic.status,"rejected");assert.equal(inspectCommittedMaintenance(f.v4().input()).status,"rejected");
});
function baselineMetadataFixture(count){
 const p=connectionFixture({count:1,state:"intent"}).v4();
 for(let sequence=2;sequence<=count;sequence++)p.baseline.receipts.push(source(sequence).receipt);
 const intent=p.records.find(r=>r.role==="intent").value;
 intent.binding.baseline_generation=hash(p.baseline);
 intent.binding.baseline_ref.receipts={commitment:commitment("baseline_receipts",p.baseline.receipts),count};
 return p.reframe();
}
for(const count of [1024,1025])
 test(`connection baseline metadata count ${count} distinguishes semantic hold from wire refusal`,()=>{
  const p=baselineMetadataFixture(count),input=p.input();
  assert.equal(p.baseline.receipts.length,count);
  assert.ok(input.reduce((n,b)=>n+b.byteLength,0)<16*1024**2);
  assert.ok(input.every(b=>b.byteLength<=1024**2));
  const r=inspectCommittedPagedMaintenanceStageA(input);blocked(r);assert.ok(r.work_charged<4194304);
  if(count===1024){
   assert.equal(r.semantic.status,"held",r.semantic.reason);assert.equal(r.semantic.reason,"baseline_source_missing");
   assert.equal(r.semantic.effects_status,"evaluated");assert.notEqual(r.semantic.effects,null);
   assert.deepEqual(r.semantic.effects.retired_ids,[]);assert.deepEqual(r.semantic.unconfirmed_completions,[]);
   assert.equal(r.semantic.pairs.length,1);assert.equal(r.semantic.adoption.state,"blocked");
   assert.deepEqual(r.semantic.adoption.blockers,["baseline_source_missing","transaction_incomplete"]);
  }else{
   assert.equal(r.semantic.status,"rejected");assert.equal(r.semantic.reason,"store_receipt_limit");
   assert.equal(r.semantic.effects_status,"not_evaluated");assert.equal(r.semantic.effects,null);
   assert.deepEqual(r.semantic.pairs,[]);assert.deepEqual(r.semantic.unconfirmed_completions,[]);
   assert.deepEqual(r.semantic.adoption.blockers,["store_receipt_limit"]);
  }
 });
function sealPages(p){p.root.snapshot.pages.forEach((r,i)=>r.hash=hash(p.pages[i]));p.sealRoot();return p;}
for(const [name,change,reason] of [
 ["repeated page index",p=>{p.root.snapshot.pages[1].index=1;p.sealRoot();},"page_order"],
 ["page ordinal reset",p=>{p.root.snapshot.pages[1].ordinal=0;p.sealRoot();},"page_order"],
 ["missing page",p=>{p.root.snapshot.pages.pop();p.sealRoot();},"page_collection_count"],
 ["inflated total page count",p=>{p.root.snapshot.pages.forEach((r,i)=>{if(r.kind==="baseline_receipts"){r.total_pages++;p.pages[i].total_pages++;}});sealPages(p);},"page_collection_count"],
 ["wrong collection declaration",p=>{p.root.snapshot.collections.reverse();p.sealRoot();},"page_collection_order"],
 ["page count binding",p=>{p.root.snapshot.pages[0].entry_count++;p.sealRoot();},"page_collection_binding"],
 ["page collection identity",p=>{p.pages[0].commitment="0".repeat(64);sealPages(p);},"page_collection_binding"],
 ["collection content drift",p=>{p.pages[0].entries[0].plan_hash="0".repeat(64);sealPages(p);},"page_collection_commitment"],
 ["preparation page tag",p=>{p.pages[0].schema="native-bar-committed-page-preparation-v1";sealPages(p);},"invalid_record"],
 ["body hash drift",p=>p.records[0].value.plan_hash="0".repeat(64),"record_hash"],
 ["unreferenced body",p=>p.records.push(structuredClone(p.records[0])),"page_record_directory"],
])test(`connection wire rejects ${name} independently of semantic replay`,()=>{const p=connectionFixture().v4();change(p);reject(p,reason);});

test("connection preserves depth and node limits before schema validation",()=>{
 let r=inspectCommittedPagedMaintenanceStageA([buffer('{"x":'+'['.repeat(65)+'0'+']'.repeat(65)+'}')]);assert.equal(r.semantic.reason,"depth_limit");blocked(r);
 r=inspectCommittedPagedMaintenanceStageA([buffer('{"x":['+Array(262145).fill('0').join(',')+']}')]);assert.equal(r.semantic.reason,"node_limit");blocked(r);
});
for(const [name,change,reason] of [
 ["attempt intent hash",p=>p.records.find(r=>r.role==="attempt").value.intent_hash="0".repeat(64),"transaction_binding"],
 ["event attempt hash",p=>p.records.find(r=>r.role==="event").value.attempt_hash="0".repeat(64),"attempt_binding"],
 ["event prefix",p=>p.records.find(r=>r.role==="event").value.previous_event_hash="0".repeat(64),"event_chain"],
 ["completion scope",p=>p.records.find(r=>r.role==="completion").value.targets.pop(),"incomplete_completion"],
 ["manifest count",p=>p.records.find(r=>r.role==="intent").value.pair_count=1,"target_scope_binding"],
 ["manifest hash",p=>p.records.find(r=>r.role==="intent").value.manifests[0].hash="0".repeat(64),"manifest_binding"],
])test(`connection binds ${name} after outer hashes have been refreshed`,()=>{const p=connectionFixture().v4();change(p);reject(p.reframe(),reason,"partial");});

test("connection catches unexplained receipt copies with and without a transaction",()=>{
 for(const transaction of [false,true]){const f=connectionFixture({transaction});f.inventory=inventoryFor(f.records);const s=timedSource(3,"2026-01-02T00:00:00.000Z");
  f.records.push({role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload});
  const old=inspectCommittedMaintenance(f.v3()),r=reject(f.v4(),"unreferenced_receipt","partial");assert.deepEqual(r.semantic,semantic(old));}
});

test("connection resets only temporal ordering across old records and preserves omitted timestamps",()=>{
 for(const transaction of [false,true])for(const reverse of [false,true]){
  const f=connectionFixture({transaction}),m=addLegacyBatch(f,{declared:true}),other=structuredClone(m);other.id=ID(95001);
  other.pairs.forEach((p,i)=>{p.recording_id=ID(40+i);p.sequence=200+i;p.recorded_at=`2026-01-0${2+i}T00:00:00.000Z`;p.day=p.recorded_at.slice(0,10);delete p.last_observed_at;});
  f.records.push({role:"legacy_v1",value:other},{role:"legacy_completion_v1",value:{id:other.id,intent_hash:hash(other)}});
  if(reverse){const old=f.records.filter(r=>r.role.startsWith("legacy"));f.records=f.records.filter(r=>!r.role.startsWith("legacy"));f.records.push(...old.reverse());}
  const before=canonical(f.records),v3=inspectCommittedMaintenance(f.v3()),r=inspectCommittedPagedMaintenanceStageA(f.v4().input());
  assert.equal(v3.adoption.state,"conditional",v3.reason);assert.deepEqual(r.semantic,semantic(v3));assert.equal(canonical(f.records),before);blocked(r);
 }
});
test("v3 frozen pre-connection inputs and results including charged work remain identical",()=>{
 const golden=JSON.parse(readFileSync(new URL("../fixtures/committed-v3-connection-golden.json",import.meta.url),"utf8"));
 assert.equal(golden.reference_source_sha256,"03181cb4fb5cef15297565603e0bcd7491cd0da259d831b08f776b6a9b944f0a");
 const cases=[];for(const kind of ["prune","clock_recovery"])for(const state of ["intent","staged","pending","complete"])cases.push([`${kind}/${state}`,connectionFixture({kind,state})]);
 cases.push(["normal",connectionFixture({transaction:false})]);const early=connectionFixture();addLegacyBatch(early,{badCutoff:true});cases.push(["early-copy",early]);
 const late=connectionFixture();addLegacyBatch(late,{declared:true,collision:true});cases.push(["late-sequence",late]);
 for(const [name,f] of cases){const expected=golden.fixtures.find(v=>v.name===name),input=f.v3(),r=inspectCommittedMaintenance(input);
  assert.equal(hash(input.map(b=>hash(Buffer.from(b)))),expected.input_sha256,name);assert.equal(hash(r),expected.result_sha256,name);assert.equal(r.work_charged,expected.work_charged,name);}
});
test("connection shares the cumulative budget across wire and semantic phases",()=>{
 const f=connectionFixture({count:176}),old=inspectCommittedMaintenance(f.v3()),p=f.v4(),input=p.input();
 assert.equal(old.adoption.state,"conditional",old.reason);assert.ok(input.reduce((n,b)=>n+b.byteLength,0)<16*1024**2);
 const r=reject(p,"work_limit");assert.ok(r.work_charged<=4194304);blocked(r);
});
test("v3 keeps its existing v2 manifest allowance beyond the new 64-pair page bound",()=>{
 const f=connectionFixture({count:65,state:"intent"}),manifests=f.records.filter(r=>r.role==="manifest"),first=manifests[0];
 first.value.pairs=manifests.flatMap(r=>r.value.pairs);
 f.records=f.records.filter(r=>r.role!=="manifest"||r===first);
 f.records.find(r=>r.role==="intent").value.manifests=[{chunk_id:first.value.chunk_id,hash:hash(first.value)}];
 const old=inspectCommittedMaintenance(f.v3());assert.equal(old.status,"consistent",old.reason);assert.ok(old.adoption.blockers.includes("transaction_incomplete"));
 reject(f.v4(),"invalid_record");
});
