import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { StreamBudget, StreamFrames, CanonicalSequence, canonicalStream, decodeStream } from "../../build/internal/nativeBarCommittedStreamCore.js";
import { SummaryArena } from "../../build/internal/nativeBarCommittedSummaryArena.js";
import { canonical } from "../helpers/committedConnectionFixture.mjs";
import { connectionFixture, addLegacyBatch } from "../helpers/committedConnectionFixture.mjs";
import { inspectCommittedPagedMaintenanceStageA } from "../../build/internal/nativeBarCommittedPagedConnection.js";
import { inspectCommittedStreamingMaintenanceStageA } from "../../build/internal/nativeBarCommittedStreaming.js";
import { hash, buffer, commitment, ID, inventoryFor, timedSource, manifestCommitment } from "../helpers/committedConnectionFixture.mjs";
import { source } from "../helpers/committedPagingFixture.mjs";
import { COMMITTED_MAINTENANCE_LIMITS as L } from "../../build/nativeBarCommittedTransactions.js";

for(const kind of ["prune","clock_recovery"])for(const n of [36,64])test(`stream packed ${kind} manifest ${n} pairs fits the unchanged budget`,()=>{
 const f=connectionFixture({kind,count:n,state:"intent"}),ms=f.records.filter(r=>r.role==="manifest");
 ms[0].value.pairs=ms.flatMap(r=>r.value.pairs);f.records=f.records.filter(r=>r.role!=="manifest"||r===ms[0]);
 f.records.find(r=>r.role==="intent").value.manifests=[{chunk_id:ms[0].value.chunk_id,hash:hash(ms[0].value)}];
 const p=f.v4(),expected=inspectCommittedPagedMaintenanceStageA(p.input()),r=inspectCommittedStreamingMaintenanceStageA(p.input());
 assert.equal(expected.semantic.status,"consistent",expected.semantic.reason);assert.deepEqual(r.semantic,expected.semantic);
 assert.ok(r.work_charged<L.work);assert.equal(r.streaming.peak_frames,1);assert.equal(r.streaming.materialized_pairs,n);
 assert.equal(r.streaming.indexed_frame_loads,1);assert.equal(r.streaming.indexed_frame_hits,n-1);
});

test("stream canonical retains exact Unicode/escape/number spelling across bounded fragments",()=>{
 const value={z:[-0,1e-8,1e25,true,null,"\ud800",'\\\"\n'],a:"x".repeat(4095)+"😀"+"é".repeat(40000)};
 const b=new StreamBudget(),r=canonicalStream(value,1024**2,b),text=canonical(value);
 assert.equal(r.hash,createHash("sha256").update(text).digest("hex"));assert.equal(r.bytes,Buffer.byteLength(text));
 assert.ok(b.stats.peak_fragment_bytes<=65536);assert.ok(b.stats.fragments>1);
});
test("stream scoped row production hashes the original logical array without page/hash substitution",()=>{
 const rows=[{a:"x".repeat(61)},{a:"😀"},{a:"é".repeat(22000)}],b=new StreamBudget();
 const entries=new CanonicalSequence(visit=>rows.forEach((row,i)=>visit(row,i)));
 const value={schema:"logical-array",entries},r=canonicalStream(value,1024**2,b);
 assert.equal(r.hash,hash({schema:"logical-array",entries:rows}));assert.equal(r.bytes,Buffer.byteLength(canonical({schema:"logical-array",entries:rows})));
 assert.equal(b.stats.canonical_blocks,Math.ceil(r.bytes/64));
});

for(const n of [63,64,65,65535,65536,65537])test(`stream canonical byte boundary ${n} is prepaid including remainder`,()=>{
 const b=new StreamBudget(),value="a".repeat(n-2),r=canonicalStream(value,n,b);
 assert.equal(r.bytes,n);assert.equal(b.stats.canonical_blocks,Math.ceil(n/64));
 assert.throws(()=>canonicalStream(value,n-1,new StreamBudget()),/encoded_bytes_limit/);
});
test("stream canonical stops before hash output on exhausted budget and retains the first reason",()=>{
 const b=new StreamBudget();b.charge(L.work-10);
 assert.throws(()=>canonicalStream("x".repeat(65),1024,b),/work_limit/);
 assert.equal(b.stats.canonical_bytes,0);assert.equal(b.stats.hash_updates,0);assert.throws(()=>b.stop("later_reason"),/work_limit/);
});
test("stream canonical prepays key enumeration before invoking ownKeys with one work unit left",()=>{
 const b=new StreamBudget();b.charge(L.work-1);let enumerations=0;
 const value=new Proxy(Object.fromEntries(Array.from({length:4096},(_,i)=>[`k${i}`,0])),{
  ownKeys(target){enumerations++;return Reflect.ownKeys(target);},
 });
 assert.throws(()=>canonicalStream(value,L.record_bytes,b),/work_limit/);assert.equal(enumerations,0);
 assert.equal(b.stats.hash_updates,0);
});
test("stream canonical key bounds follow parent identity across integer-key reviver order",()=>{
 const text='{"10":{"a":1,"b":2,"c":3},"2":{},"z":{"x":0}}',b=new StreamBudget(),r=decodeStream(Buffer.from(text),b);
 assert.equal(b.objectKeyBounds.get(r.value),3);assert.equal(b.objectKeyBounds.get(r.value["10"]),3);
 assert.equal(b.objectKeyBounds.get(r.value["2"]),0);assert.equal(b.objectKeyBounds.get(r.value.z),1);
 assert.equal(canonicalStream(r.value,1024,b).hash,hash(r.value));
});
test("stream indexed frame cache binds the source, evicts before another frame and forbids nested reads",()=>{
 const a=buffer('{"x":1}'),c=buffer('{"x":2}'),b=new StreamBudget(),frames=new StreamFrames([a,c],b),ha=hash('{"x":1}'),hc=hash('{"x":2}');
 frames.bindSnapshot("a".repeat(64));
 assert.equal(frames.readIndexed(0,"manifest",ha,raw=>raw.toString()),'{"x":1}');
 frames.readIndexed(0,"manifest",ha,()=>{});assert.equal(b.stats.indexed_frame_loads,1);assert.equal(b.stats.indexed_frame_hits,1);
 frames.readIndexed(1,"manifest",hc,()=>{});frames.readIndexed(0,"manifest",ha,()=>{});assert.equal(b.stats.indexed_frame_loads,3);
 frames.read(1,"manifest",hc,()=>{});frames.readIndexed(0,"manifest",ha,()=>{});assert.equal(b.stats.indexed_frame_loads,4);
 new Uint8Array(a)[5]=51;assert.throws(()=>frames.readIndexed(0,"manifest",ha,()=>{}),/stream_frame_changed/);
 const d=buffer('{}'),other=new StreamFrames([d],new StreamBudget()),hd=hash('{}');
 other.readIndexed(0,"manifest",hd,()=>{});structuredClone(d,{transfer:[d]});assert.throws(()=>other.readIndexed(0,"manifest",hd,()=>{}),/stream_frame_changed/);
 const nested=new StreamFrames([buffer('{}')],new StreamBudget());
 assert.throws(()=>nested.readIndexed(0,"manifest",hd,()=>nested.read(0,"manifest",hd,()=>{})),/stream_nested_frame/);
});
test("stream summary prepays schema-bound key storage before enumeration",()=>{
 const b=new StreamBudget(),arena=new SummaryArena(b,65536);b.charge(L.work-1);let enumerations=0;
 const row=new Proxy({a:"x",b:"y"},{ownKeys(target){enumerations++;return Reflect.ownKeys(target);}});
 assert.throws(()=>arena.row(row,2),/work_limit/);assert.equal(enumerations,0);assert.equal(b.stats.arena_bytes,0);
});
test("stream preflight rejects all oversize sources before any private copy",()=>{
 const b=new StreamBudget();assert.throws(()=>new StreamFrames([new ArrayBuffer(1),new ArrayBuffer(L.record_bytes+1)],b),/record_bytes_limit/);
 assert.equal(b.stats.copied_frames,0);
});
test("stream frames bind snapshot, role, physical position, length and raw hash on reread",()=>{
 const raw=buffer('{"a":1}'),b=new StreamBudget(),frames=new StreamFrames([raw],b);frames.bindSnapshot("a".repeat(64));
 frames.read(0,"receipt_v1",null,()=>{});new Uint8Array(raw)[5]=50;
 assert.throws(()=>frames.read(0,"receipt_v1",null,()=>{}),/stream_frame_changed/);
 const f=new StreamFrames([buffer('{}')],new StreamBudget());f.read(0,"receipt_v1",null,()=>{});
 assert.throws(()=>f.read(0,"payload_v1",null,()=>{}),/stream_role_binding/);
 const g=new StreamFrames([buffer('{}')],new StreamBudget());g.bindSnapshot("a");assert.throws(()=>g.bindSnapshot("b"),/stream_snapshot_binding/);
 const h=new StreamFrames([buffer('{}')],new StreamBudget());assert.throws(()=>h.read(0,"root",null,()=>h.read(0,"root",null,()=>{})),/stream_nested_frame/);
 const detached=buffer('{}'),j=new StreamFrames([detached],new StreamBudget());structuredClone(detached,{transfer:[detached]});
 assert.throws(()=>j.read(0,"root",null,()=>{}),/stream_frame_changed/);
});
test("stream proof release revokes old views while original approval survives until invocation end",()=>{
 const b=new StreamBudget(),arena=new SummaryArena(b,4096),v=arena.row({approval:{approved_at:"2026-01-01"},binding:{root:{device:"1"},parents:[{path:"captures",proof:{inode:"2"}}]}});
 const root=v.binding.root,parent=v.binding.parents[0].proof;
 arena.dropIntentProofs(v.binding);assert.throws(()=>root.device,/stream_summary_expired/);
 // A separate budget is required after an intentional terminal stop.
 const c=new StreamBudget(),other=new SummaryArena(c,4096),w=other.row({approval:{approved_at:"2026-01-01"},binding:{root:{device:"1"},parents:[]}});
 other.dropIntentProofs(w.binding);assert.equal(w.approval.approved_at,"2026-01-01");other.dispose();
 assert.throws(()=>w.approval,/stream_summary_expired/);
});

for(const kind of ["prune","clock_recovery"])for(const state of ["intent","staged","pending","complete"])
 test(`stream preserves ${kind}/${state} semantics after schema bodies are released`,()=>{
  const p=connectionFixture({kind,state}).v4(),expected=inspectCommittedPagedMaintenanceStageA(p.input()),r=inspectCommittedStreamingMaintenanceStageA(p.input());
  assert.equal(expected.semantic.status,"consistent",expected.semantic.reason);
  assert.deepEqual(r.semantic,expected.semantic);assert.equal(r.adoption.state,"blocked");assert.equal(r.history_read_available,false);
  assert.equal(r.semantic.adoption.state,state==="complete"?"conditional":"blocked");
  if(state!=="complete")assert.ok(r.semantic.adoption.blockers.includes("transaction_incomplete"));
  assert.equal(r.streaming.peak_frames,1);assert.ok(r.streaming.released_proof_nodes>0);
  assert.equal(r.streaming.materialized_pairs,2);assert.equal(r.streaming.proof_catalogs,1);
  assert.ok(r.streaming.peak_replay_rows<=2);assert.equal(r.streaming.replay_rows_loaded-r.streaming.replay_rows_released,state==="intent"?0:1);
  assert.equal(r.streaming.action_tables_released,state==="intent"?0:1);
 });
test("stream preserves early-null and late-partial legacy diagnostics",()=>{
 for(const options of [{badCutoff:true},{declared:true,collision:true}]){
  const f=connectionFixture();addLegacyBatch(f,options);const p=f.v4();
  const r=inspectCommittedStreamingMaintenanceStageA(p.input());
  assert.deepEqual(r.semantic,inspectCommittedPagedMaintenanceStageA(p.input()).semantic);
  assert.equal(r.semantic.reason,options.badCutoff?"legacy_batch_observation_order":"store_sequence_alias");
  assert.equal(r.semantic.effects_status,options.badCutoff?"not_evaluated":"partial");
 }
});

for(const n of [1024,1025])test(`stream baseline metadata ${n} preserves hold versus admission rejection`,()=>{
 const p=connectionFixture({count:1,state:"intent"}).v4();for(let i=2;i<=n;i++)p.baseline.receipts.push(source(i).receipt);
 const v=p.records.find(r=>r.role==="intent").value;v.binding.baseline_generation=hash(p.baseline);
 v.binding.baseline_ref.receipts={commitment:commitment("baseline_receipts",p.baseline.receipts),count:n};
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());
 assert.equal(r.semantic.reason,n===1024?"baseline_source_missing":"store_receipt_limit");
 assert.equal(r.semantic.effects_status,n===1024?"evaluated":"not_evaluated");assert.ok(r.work_charged<=L.work);
});
test("stream validates the fourth series and last bar before producing payload evidence",()=>{
 const p=connectionFixture().v4(),payload=p.records.find(r=>r.role==="payload_v1").value;
 payload.series[3].bars.at(-1).close=payload.series[3].bars.at(-1).high+1;
 // Finite, canonical transport; invalid OHLC must fail the full original schema.
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());assert.equal(r.semantic.status,"rejected");assert.equal(r.semantic.effects,null);
 assert.equal(r.streaming.payload_summaries,0);
});

for(const n of [64,1024,1025])test(`stream counts all ${n} manifest claims before admitted-target semantics`,()=>{
 const p=connectionFixture({count:1,state:"intent"}).v4(),first=p.records.find(r=>r.role==="manifest");
 p.records.splice(p.records.indexOf(first),1);
 for(let i=0,left=n;left;i++){
  const value=structuredClone(first.value);value.chunk_id=ID(30000+i);
  value.pairs=Array.from({length:Math.min(left,64)},()=>structuredClone(first.value.pairs[0]));left-=value.pairs.length;
  p.records.push({role:"manifest",value});
 }
 const ms=p.records.filter(r=>r.role==="manifest"),mc=manifestCommitment(p.records);
 ms.forEach((r,i)=>Object.assign(r.value,{ordinal:i,total_pages:ms.length,collection_commitment:mc}));
 const v=p.records.find(r=>r.role==="intent").value;v.manifest_commitment=mc;v.manifests=ms.map(r=>({chunk_id:r.value.chunk_id,hash:hash(r.value)}));
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());
 assert.equal(r.streaming.manifest_claims,n);assert.equal(r.semantic.status,"rejected");
 assert.equal(r.streaming.materialized_pairs,n===64?1:0);
 assert.equal(r.semantic.reason,n===64?"pair_alias":"work_limit");
 assert.equal(r.semantic.effects_status,n===64?"partial":"not_evaluated");assert.equal(r.adoption.state,"blocked");
});
test("stream refuses multiple intents after the legacy snapshot without building any root/parent catalog",()=>{
 const p=connectionFixture({count:1,state:"intent"}).v4();p.records.push(structuredClone(p.records.find(r=>r.role==="intent")));
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());assert.equal(r.semantic.reason,"intent_count");assert.equal(r.semantic.effects_status,"partial");
 assert.equal(r.streaming.proof_catalogs,0);assert.equal(r.streaming.materialized_pairs,0);
});
for(const kind of ["prune","clock_recovery"])test(`stream confirms completed ${kind} from bound terminal evidence with target bodies absent`,()=>{
 const f=connectionFixture({kind});f.records=f.records.filter(r=>!["receipt_v1","payload_v1"].includes(r.role));
 const p=f.v4(),r=inspectCommittedStreamingMaintenanceStageA(p.input());assert.equal(r.semantic.adoption.state,"conditional",r.semantic.reason);
 assert.equal(r.streaming.payload_summaries,0);assert.deepEqual(r.semantic,inspectCommittedPagedMaintenanceStageA(p.input()).semantic);
});
for(const field of ["reference","plan_hash","approved_at"])test(`stream retains original intent approval ${field} independently of the attempt`,()=>{
 const p=connectionFixture({count:1}).v4(),a=p.records.find(r=>r.role==="attempt").value;
 a.approval[field]=field==="reference"?ID(90200):field==="plan_hash"?"7".repeat(64):"2026-05-01T00:00:00.001Z";
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());assert.equal(r.semantic.reason,"approval_binding");assert.equal(r.semantic.effects_status,"partial");
});
for(const kind of ["prune","clock_recovery"])test(`stream retains original intent through resumed ${kind} attempt with a new approval`,()=>{
 const f=connectionFixture({count:1,kind,state:"staged"}),last=f.records.filter(r=>r.role==="event").at(-1),a=structuredClone(f.records.find(r=>r.role==="attempt").value);
 a.attempt_id=ID(90201);a.approval.reference=ID(90202);a.approval.plan_hash="7".repeat(64);
 a.approval.approved_at=new Date(Date.parse(a.approval.approved_at)+2).toISOString();a.expires_at=new Date(Date.parse(a.approval.approved_at)+600000).toISOString();
 a.monotonic={clock_id:a.monotonic.clock_id,issued_ns:last.value.monotonic_ns,observed_ns:String(BigInt(last.value.monotonic_ns)+1n),deadline_ns:String(BigInt(last.value.monotonic_ns)+600000000000n)};
 a.resume_after_event_hash=hash(last.value);a.actions=a.actions.filter(x=>x.action!=="stage");f.records.push({role:"attempt",value:a});
 const p=f.v4(),expected=inspectCommittedPagedMaintenanceStageA(p.input()),r=inspectCommittedStreamingMaintenanceStageA(p.input());
 assert.equal(expected.semantic.status,"consistent",expected.semantic.reason);assert.deepEqual(r.semantic,expected.semantic);assert.ok(r.streaming.released_proof_nodes>0);
 assert.equal(r.streaming.replay_rows_loaded-r.streaming.replay_rows_released,1);assert.equal(r.streaming.action_tables_released,2);
});
for(const [label,change,reason] of [
 ["root ownership",v=>v.binding.root.uid="2","object_access_binding"],
 ["parent ownership",v=>v.binding.parents.at(-1).proof.gid="2","object_access_binding"],
 ["parent alias",v=>v.binding.parents.at(-1).proof.inode=v.binding.parents[0].proof.inode,"object_alias"],
 ["parent scope",v=>v.binding.parents.pop(),"target_scope_binding"],
])test(`stream retains ${label} evidence through manifest checks`,()=>{
 const p=connectionFixture({count:1,state:"intent"}).v4();change(p.records.find(r=>r.role==="intent").value);
 const r=inspectCommittedStreamingMaintenanceStageA(p.reframe().input());assert.equal(r.semantic.reason,reason);assert.equal(r.semantic.effects_status,"partial");assert.equal(r.streaming.released_proof_nodes,0);
});
test("stream pays wire and semantic work from one non-resettable budget",()=>{
 const r=inspectCommittedStreamingMaintenanceStageA(connectionFixture({count:52}).v4().input());
 assert.equal(r.semantic.reason,"work_limit");assert.equal(r.semantic.effects_status,"partial");assert.ok(r.work_charged<=L.work);assert.equal(r.adoption.state,"blocked");
 assert.ok(r.work_charged>=L.work-65536,"reported budget must include preceding wire/summary work");
});
test("stream corrected-clock continuation retains receipt and payload evidence bindings",()=>{
 const f=connectionFixture({kind:"clock_recovery"}),s=timedSource(3,"2025-12-31T23:02:00.000Z");
 f.records.push({role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload});f.evaluationAt="2025-12-31T23:03:00.000Z";
 const p=f.v4(),r=inspectCommittedStreamingMaintenanceStageA(p.input());assert.equal(r.semantic.adoption.state,"conditional",r.semantic.reason);
 assert.deepEqual(r.semantic,inspectCommittedPagedMaintenanceStageA(p.input()).semantic);assert.equal(r.adoption.state,"blocked");
});
for(const missing of ["receipt_v1","payload_v1","both"])test(`stream preserves missing non-target ${missing} after a completed invocation`,()=>{
 const f=connectionFixture({retained:1});assert.equal(inspectCommittedStreamingMaintenanceStageA(f.v4().input()).semantic.adoption.state,"conditional");
 f.inventory=inventoryFor(f.records);const receipt=f.records.find(r=>r.role==="receipt_v1"&&r.value.recording_id===ID(3)).value;
 f.records=f.records.filter(r=>!(r.role==="receipt_v1"&&r.value.recording_id===ID(3)&&missing!=="payload_v1")&&
  !(r.role==="payload_v1"&&hash(r.value)===receipt.payload_hash&&missing!=="receipt_v1"));
 const p=f.v4(),r=inspectCommittedStreamingMaintenanceStageA(p.input());assert.deepEqual(r.semantic,inspectCommittedPagedMaintenanceStageA(p.input()).semantic);
 assert.equal(r.semantic.status,"held");assert.equal(r.semantic.unconfirmed_completions.length,1);
});
