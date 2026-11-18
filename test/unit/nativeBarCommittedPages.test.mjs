import test from "node:test";
import assert from "node:assert/strict";
import { inspectCommittedPages } from "../../build/internal/nativeBarCommittedPages.js";
import { pagingFixture,manifestPair,source,hash,ID,canonical,buffer } from "../helpers/committedPagingFixture.mjs";
import { constructionSketch } from "../helpers/committedPagingSizing.mjs";

test("stage A validates small paged collections without enabling history or an expanded profile",()=>{
  const f=pagingFixture(), p=f.pack(), r=inspectCommittedPages(p.input());
  assert.equal(r.status,"validated");assert.equal(r.adoption.state,"blocked");assert.equal(r.effects,null);
  assert.equal(r.history_read_available,false);assert.equal(r.execution_available,false);assert.equal(r.production_qualified,false);
  assert.equal(r.baseline_generation,hash({receipts:f.rows.baseline_receipts,maintenance:[]}));
  assert.equal(r.counts.frames,p.input().length);assert.ok(r.work_charged>0);
});

function rejected(input,reason){const r=inspectCommittedPages(input);assert.equal(r.status,"rejected");assert.equal(r.reason,reason);
 assert.equal(r.adoption.state,"blocked");assert.equal(r.effects,null);assert.equal(r.execution_available,false);return r;}
function seal(p){p.root.snapshot.pages.forEach((r,i)=>r.hash=hash(p.pages[i]));p.root.snapshot_generation=hash(p.root.snapshot);return p.input();}

test("stage A refuses an expanded baseline even though its raw metadata fits the old byte ceiling",()=>{
 const f=pagingFixture(0,512), receipt=pagingFixture(1).rows.baseline_receipts[0];
 f.rows.baseline_receipts=Array.from({length:1025},(_,i)=>({...receipt,recording_id:ID(i+1),sequence:i+1}));
 rejected(f.pack().input(),"store_receipt_limit");
});

for(const [name,change,reason] of [
 ["snapshot drift",p=>p.root.snapshot.evaluation.at="2026-05-02T00:00:00.000Z","page_snapshot_binding"],
 ["page hash drift",p=>p.pages[0].entries[0].sequence++,"page_hash"],
 ["missing page",p=>{p.root.snapshot.pages.pop();p.root.snapshot_generation=hash(p.root.snapshot);},"page_collection_count"],
 ["repeated page index",p=>{p.root.snapshot.pages[1].index=1;p.root.snapshot_generation=hash(p.root.snapshot);},"page_order"],
 ["ordinal reset",p=>{p.root.snapshot.pages[1].ordinal=0;p.root.snapshot_generation=hash(p.root.snapshot);},"page_order"],
 ["wrong collection",p=>{p.pages[0].kind="inventory";seal(p);},"invalid_record"],
 ["wrong collection commitment",p=>{p.pages[0].commitment="0".repeat(64);seal(p);},"page_collection_binding"],
 ["wrong entry count",p=>{p.root.snapshot.pages[0].entry_count++;p.root.snapshot_generation=hash(p.root.snapshot);},"page_collection_binding"],
 ["wrong collection total",p=>{p.root.snapshot.collections[1].total_entries++;p.root.snapshot_generation=hash(p.root.snapshot);},"page_collection_count"],
 ["evaluation drift",p=>{p.root.snapshot.evaluation.evidence_hash="0".repeat(64);p.root.snapshot_generation=hash(p.root.snapshot);},"evaluation_snapshot_binding"],
]) test(`stage A rejects ${name}`,()=>{const p=pagingFixture().pack();change(p);rejected(p.input(),reason);});

test("stage A detects reordered baseline and duplicate inventory after all commitments are resealed",()=>{
 let f=pagingFixture();f.rows.baseline_receipts.reverse();rejected(f.pack().input(),"baseline_receipt_binding");
 f=pagingFixture();f.rows.inventory[1]=f.rows.inventory[0];rejected(f.pack().input(),"page_inventory_order");
});

test("stage A baseline commitment retains the exact v2 logical hash, independent of page boundaries",()=>{
 const f=pagingFixture(3,1),a=inspectCommittedPages(f.pack().input());f.pageSize=2;const c=inspectCommittedPages(f.pack().input());
 assert.equal(c.status,"validated");assert.equal(a.baseline_generation,c.baseline_generation);
 assert.notEqual(a.snapshot_generation,c.snapshot_generation);
});

test("stage A rejects collection row drift even when the page hash is resealed",()=>{
 const p=pagingFixture().pack();p.pages[0].entries[0].plan_hash="0".repeat(64);
 rejected(seal(p),"page_collection_commitment");
});

test("stage A keeps all preparation limits fixed and does not accept v3 as pages or pages as v3",async()=>{
 const {inspectCommittedMaintenance,COMMITTED_MAINTENANCE_LIMITS:L}=await import("../../build/nativeBarCommittedTransactions.js");
 assert.equal(L.input_bytes,16*1024**2);assert.equal(L.work,4194304);assert.equal(L.store_receipts,1024);assert.equal(L.record_bytes,1024**2);
 const p=pagingFixture().pack();assert.equal(inspectCommittedMaintenance(p.input()).status,"rejected");
 p.root.schema="native-bar-committed-input-v3";rejected(p.input(),"invalid_record");
});

test("stage A bounds input before decoding, rejects accessors and counts repeated buffers",()=>{
 const a=[buffer("{}")];Object.defineProperty(a,"0",{get(){throw Error("accessor invoked");}});
 rejected(a,"input_accessor_or_sparse");rejected(new Array(1),"input_accessor_or_sparse");
 const b=new ArrayBuffer(1024**2);rejected(Array(17).fill(b),"input_bytes_limit");
 rejected([new ArrayBuffer(1024**2+1)],"record_bytes_limit");
});

test("stage A uses strict canonical UTF-8 JSON, never a fallback parser",()=>{
 rejected([Uint8Array.from([0xff]).buffer],"invalid_utf8");
 rejected([buffer('{"x":1,"x":1}')],"noncanonical_record");rejected([buffer('{ "x":1}')],"noncanonical_record");
});

test("stage A ordinary page entries are capped at 512 with an inclusive positive control",()=>{
 const f=pagingFixture(0,512);f.rows.baseline_maintenance=Array.from({length:512},(_,i)=>({id:ID(i+1),hash:"1".repeat(64)}));
 assert.equal(inspectCommittedPages(f.pack().input()).status,"validated");
 f.rows.baseline_maintenance.push({id:ID(513),hash:"1".repeat(64)});f.pageSize=513;rejected(f.pack().input(),"invalid_record");
});

test("stage A manifest pages accept 64 pairs and reject 65 in one page",()=>{
 const f=pagingFixture(0,64);f.rows.manifest=Array.from({length:64},(_,i)=>manifestPair(i+1));
 assert.equal(inspectCommittedPages(f.pack().input()).status,"validated");
 f.rows.manifest.push(manifestPair(65));f.pageSize=65;rejected(f.pack().input(),"invalid_record");
});

test("stage A does not lose manifest sequence/identity checks across page boundaries",()=>{
 const f=pagingFixture(0,1);f.rows.manifest=[manifestPair(1),manifestPair(2)];
 assert.equal(inspectCommittedPages(f.pack().input()).status,"validated");
 f.rows.manifest.reverse();rejected(f.pack().input(),"page_manifest_order");
 f.rows.manifest=[manifestPair(1),manifestPair(1)];rejected(f.pack().input(),"page_manifest_order");
});

test("stage A rejects a forged baseline generation and reordered collection declarations",()=>{
 let p=pagingFixture().pack();p.root.snapshot.baseline_generation="0".repeat(64);p.root.snapshot_generation=hash(p.root.snapshot);
 rejected(p.input(),"baseline_generation");
 p=pagingFixture().pack();p.root.snapshot.collections.reverse();p.root.snapshot_generation=hash(p.root.snapshot);rejected(p.input(),"page_collection_order");
});

test("stage A verifies body hashes and refuses an extra unreferenced frame",()=>{
 const p=pagingFixture().pack(),input=p.input();input[input.length-1]=buffer('{"changed":true}');rejected(input,"record_hash");
 rejected([...p.input(),buffer('{}')],"page_record_directory");
});

test("stage A manifest count cannot expand to 1025 pairs over individually valid pages",()=>{
 const f=pagingFixture(0,64);f.rows.manifest=Array.from({length:1025},(_,i)=>manifestPair(i+1));
 rejected(f.pack().input(),"pair_limit");
});

test("stage A active-inventory count cannot expand beyond 1024",()=>{
 const f=pagingFixture(0,512);f.rows.inventory=Array.from({length:1025},(_,i)=>({recording_id:ID(i+1),role:"receipt",location:"source",hash:"1".repeat(64)}));
 rejected(f.pack().input(),"store_receipt_limit");
});

test("stage A work exhaustion latches at the existing ceiling, without per-page resets",()=>{
 const r=rejected(pagingFixture(700,32).pack().input(),"work_limit");assert.ok(r.work_charged<=4194304);
});

test("maximum-input construction is arithmetic plus small valid witnesses, not expanded verification",async()=>{
 const {nativeBarCaptureSchema}=await import("../../build/nativeBarEvidence.js");
 const {nativeBarReceiptSchema}=await import("../../build/nativeBarArtifacts.js");
 for(const n of [1,9,10,99,100,999,1000,1024,4096]){
  const s=source(n,65536);nativeBarCaptureSchema.parse(s.payload);nativeBarReceiptSchema.parse(s.receipt);
  assert.equal(Buffer.byteLength(canonical(s.receipt))+Buffer.byteLength(canonical(s.payload)),65536);
  assert.ok(s.payload.series[0].provenance.corrections.length<=65536);
 }
 const sketch=constructionSketch();assert.equal(sketch.expanded_input_created,false);
 for(const p of [sketch.normal,sketch.complete]){
  assert.equal(p.evidence_bytes,256*1048576);assert.ok(p.framing_bytes_upper<=16*1048576);assert.ok(p.journal_bytes_upper<=32*1048576);
  assert.ok(p.input_bytes_upper<=328*1048576);assert.ok(p.frames<=65536);assert.ok(p.nodes_upper<=33554432);
  assert.ok(p.conditional_work_upper<=805306368);assert.equal(p.work_sufficiency_proven,false);
 }
 assert.equal(sketch.complete.selected,1024);assert.equal(sketch.complete.retained,3072);assert.equal(sketch.complete.manifests,16);
});
