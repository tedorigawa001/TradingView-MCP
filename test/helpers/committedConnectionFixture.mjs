import { source,manifestPair,ID,POLICY,canonical,hash,buffer } from "./committedPagingFixture.mjs";
export { ID,POLICY,canonical,hash,buffer };
export const KINDS=["baseline_maintenance","baseline_receipts","directory","inventory"];
export const commitment=(kind,entries)=>hash({schema:"native-bar-committed-collection-v1",kind,entries});
export const manifestCommitment=records=>hash({schema:"native-bar-committed-manifest-collection-v1",pairs:records.filter(r=>r.role==="manifest").flatMap(r=>r.value.pairs)});
const proof=(inode,dir=false)=>({device:"1",inode:String(inode),uid:"1",gid:"1",mode:dir?"16832":"33152",nlink:dir?"2":"1",size:"0",flags:"0",
  birthtime_ns:"1",mtime_ns:"1",ctime_ns:"1",acl:"none",acl_hash:"5".repeat(64)});
export function inventoryFor(records){
 const retired=new Set(records.filter(r=>r.role==="legacy_completion_v1").flatMap(r=>records.find(m=>m.role==="legacy_v1"&&m.value.id===r.value.id)?.value.pairs.map(p=>p.recording_id)??[]));
 return records.filter(r=>r.role==="receipt_v1"&&!retired.has(r.value.recording_id)).flatMap(({value:r})=>["receipt","payload"].flatMap(role=>{
  const last=records.filter(e=>e.role==="event"&&e.value.recording_id===r.recording_id&&e.value.role===role&&!['conflict','durability_unknown'].includes(e.value.type)).at(-1)?.value.type;
  if(["purged_verified","quarantined_verified"].includes(last))return [];
  return [{recording_id:r.recording_id,role,location:["held_verified","unlink_pending","quarantine_move_pending","reconciled_held"].includes(last)?"holding":"source",
    hash:role==="receipt"?hash(r):r.payload_hash}];
 })).sort((a,b)=>canonical(a)<canonical(b)?-1:1);
}
export function evaluationFor(records,inventory,at){
 const evidence=records.filter(r=>["receipt_v1","payload_v1"].includes(r.role)).map(r=>({role:r.role,hash:hash(r.value)}))
  .sort((a,b)=>a.hash<b.hash?-1:a.hash>b.hash?1:a.role<b.role?-1:a.role>b.role?1:0);
 const journal=records.filter(r=>!["receipt_v1","payload_v1"].includes(r.role)).map(r=>({role:r.role,hash:hash(r.value)}));
 const intent=records.find(r=>r.role==="intent"),attempt=records.findLast(r=>r.role==="attempt");
 const ticks=records.filter(r=>["event","completion"].includes(r.role)).map(r=>BigInt(r.value.monotonic_ns));
 return {evaluation_id:ID(99000),at,journal_hash:hash(journal),evidence_hash:hash(evidence),inventory_hash:hash({policy_hash:POLICY,entries:inventory}),
  intent_hash:intent?hash(intent.value):null,attempt_hash:attempt?hash(attempt.value):null,
  clock:attempt?{clock_id:attempt.value.monotonic.clock_id,monotonic_ns:String(ticks.reduce((a,b)=>a>b?a:b,1n)+1n)}:null};
}
export function connectionFixture({kind="prune",count=2,retained=0,state="complete",transaction=true}={}){
 const sources=Array.from({length:count+retained},(_,i)=>source(i+1)),pairs=sources.slice(0,count).map((_,i)=>manifestPair(i+1));
 const records=sources.flatMap(s=>[{role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload}]);
 const approved=kind==="prune"?"2026-05-01T00:00:00.000Z":"2025-12-31T23:00:00.000Z";
 if(transaction){
  const days=[...new Set(pairs.map(p=>p.day))],paths=["captures","receipts"].flatMap(area=>[area,...days.map(day=>`${area}/${day}`)]);
  const manifests=pairs.map((p,i)=>({schema:"native-bar-committed-manifest-v2",maintenance_id:ID(90000),chunk_id:ID(90100+i),pairs:[p]}));
  const baseline={receipts:structuredClone(sources.map(s=>s.receipt)),maintenance:[]};
  const intent={schema:"native-bar-committed-intent-v2",maintenance_id:ID(90000),kind,approval:{reference:ID(90001),plan_hash:"6".repeat(64),approved_at:approved},
   binding:{root:proof(100000,true),parents:paths.map((path,i)=>({path,proof:proof(100010+i,true)})),policy_hash:POLICY,backend_profile:"committed-contract-stage1",backend_protocol:1,
    baseline,baseline_generation:hash(baseline)},manifests:manifests.map(m=>({chunk_id:m.chunk_id,hash:hash(m)})),pair_count:pairs.length};
  records.push(...manifests.map(value=>({role:"manifest",value})),{role:"intent",value:intent});
  if(state!=="intent"){
   const attempt={schema:"native-bar-committed-attempt-v2",maintenance_id:intent.maintenance_id,attempt_id:ID(90002),intent_hash:hash(intent),approval:structuredClone(intent.approval),
    expires_at:new Date(Date.parse(approved)+600000).toISOString(),monotonic:{clock_id:ID(90003),issued_ns:"0",observed_ns:"1",deadline_ns:"600000000000"},resume_after_event_hash:null,
    actions:pairs.flatMap(p=>["receipt","payload"].flatMap(role=>["stage",kind==="prune"?"unlink":"quarantine"].map(action=>({recording_id:p.recording_id,role,action}))))};
   records.push({role:"attempt",value:attempt});let last=null,sequence=0;
   const event=(p,type,role)=>{
    let evidence=null;
    if(["held_verified","purged_verified","quarantined_verified"].includes(type)){
     const ep=structuredClone(p[`${role}_proof`]);ep.ctime_ns="2";ep.nlink=type==="purged_verified"?"0":"1";
     evidence={proof:ep,sha256:p[`${role}_hash`],from_ns:"1",through_ns:"3",source_present:false,holding_present:type==="held_verified",quarantine_present:type==="quarantined_verified"};
    }
    const value={schema:"native-bar-committed-event-v2",maintenance_id:intent.maintenance_id,intent_hash:hash(intent),attempt_id:attempt.attempt_id,attempt_hash:hash(attempt),sequence:++sequence,
     previous_event_hash:last,recording_id:p.recording_id,role,type,at:new Date(Date.parse(approved)+1).toISOString(),monotonic_ns:String(sequence+1),sync:"reported_success",evidence};
    records.push({role:"event",value});last=hash(value);
   };
   for(const p of pairs){for(const role of ["receipt","payload"]){event(p,"move_pending",role);event(p,"held_verified",role);}
    if(state==="pending")event(p,kind==="prune"?"unlink_pending":"quarantine_move_pending","receipt");
    if(state==="complete")for(const role of ["receipt","payload"]){event(p,kind==="prune"?"unlink_pending":"quarantine_move_pending",role);event(p,kind==="prune"?"purged_verified":"quarantined_verified",role);}}
   if(state==="complete")records.push({role:"completion",value:{schema:"native-bar-committed-completion-v2",maintenance_id:intent.maintenance_id,intent_hash:hash(intent),attempt_id:attempt.attempt_id,
    attempt_hash:hash(attempt),last_event_hash:last,completed_at:new Date(Date.parse(approved)+1).toISOString(),monotonic_ns:String(sequence+2),
    targets:pairs.map(p=>({recording_id:p.recording_id,receipt:kind==="prune"?"purged_verified":"quarantined_verified",payload:kind==="prune"?"purged_verified":"quarantined_verified"}))}});
  }
 }
 const f={records,evaluationAt:new Date(Date.parse(approved)+1000).toISOString()};
 f.v3=()=>packV3(f.records,f.evaluationAt,f.inventory??inventoryFor(f.records));f.v4=()=>packV4(f);return f;
}
export function timedSource(sequence,at){
 const s=source(sequence);s.receipt.recorded_at=at;s.receipt.day=at.slice(0,10);s.payload.capture_as_of=at;
 s.payload.series.forEach(v=>{v.observed_at=at;v.bars.forEach(b=>{b.bar_open_at=new Date(Date.parse(at)-60000).toISOString();b.confirmed_by_next_bar_at=at;});});
 s.receipt.payload_hash=hash(s.payload);return s;
}
export function addLegacyBatch(f,{badCutoff=false,declared=false,collision=false}={}){
 const sources=[timedSource(30,"2026-01-04T00:00:00.000Z"),timedSource(31,badCutoff?"2026-01-03T00:00:00.000Z":"2026-01-05T00:00:00.000Z")];
 sources.forEach((s,i)=>{s.receipt.sequence=100+i;if(i===1){s.receipt.recorded_at="2026-01-05T00:00:00.000Z";s.receipt.day="2026-01-05";}});
 const pairs=sources.map(s=>({recording_id:s.receipt.recording_id,sequence:s.receipt.sequence,day:s.receipt.day,receipt_hash:hash(s.receipt),payload_hash:hash(s.payload),
  recorded_at:s.receipt.recorded_at,last_observed_at:s.payload.capture_as_of,bytes:Buffer.byteLength(canonical(s.receipt))+Buffer.byteLength(canonical(s.payload))}));
 if(collision)pairs[0].sequence=1;
 const m={schema:"native-bar-maintenance-v1",id:ID(95000),kind:"prune",created_at:"2026-05-01T00:00:00.000Z",generation:"4".repeat(64),pairs};
 if(!declared)f.records.push(...sources.flatMap(s=>[{role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload}]));
 f.records.push({role:"legacy_v1",value:m},{role:"legacy_completion_v1",value:{id:m.id,intent_hash:hash(m)}});return m;
}
export function packV3(records,at,inventory){
 const root={schema:"native-bar-committed-input-v3",policy_hash:POLICY,inventory,evaluation:evaluationFor(records,inventory,at),
  records:records.map((r,i)=>({index:i+1,role:r.role,hash:hash(r.value)}))};
 return [buffer(canonical(root)),...records.map(r=>buffer(canonical(r.value)))];
}
export function packV4(f){
 const records=structuredClone(f.records),intent=records.find(r=>r.role==="intent"),baseline=intent?structuredClone(intent.value.binding.baseline):{receipts:[],maintenance:[]};
 const manifests=records.filter(r=>r.role==="manifest"),mc=manifestCommitment(records);
 manifests.forEach((r,i)=>Object.assign(r.value,{schema:"native-bar-committed-manifest-v3",ordinal:i,total_pages:manifests.length,collection_commitment:mc}));
 if(intent){const v=intent.value;v.schema="native-bar-committed-intent-v3";delete v.binding.baseline;
  Object.assign(v.binding,{backend_profile:"committed-contract-paged-stage-a",backend_protocol:2,baseline_ref:{
   receipts:{commitment:commitment("baseline_receipts",baseline.receipts),count:baseline.receipts.length},maintenance:{commitment:commitment("baseline_maintenance",baseline.maintenance),count:baseline.maintenance.length}}});
  v.manifest_commitment=mc;v.manifests=v.manifests.map(ref=>({chunk_id:ref.chunk_id,hash:hash(manifests.find(r=>r.value.chunk_id===ref.chunk_id).value)}));
 }
 const oldToNew=new Map(),attempts=new Map();
 for(let i=0;i<records.length;i++){
  const r=records[i],old=f.records[i];
  if(["attempt","event","completion"].includes(r.role)){
   r.value.schema=`native-bar-committed-${r.role}-v3`;r.value.intent_hash=hash(intent.value);
   if(r.role==="attempt"){if(r.value.resume_after_event_hash)r.value.resume_after_event_hash=oldToNew.get(r.value.resume_after_event_hash);attempts.set(r.value.attempt_id,r.value);}
   else {r.value.attempt_hash=hash(attempts.get(r.value.attempt_id));const field=r.role==="event"?"previous_event_hash":"last_event_hash";if(r.value[field])r.value[field]=oldToNew.get(r.value[field]);}
  }
  oldToNew.set(hash(old.value),hash(r.value));
 }
 return frameV4(records,baseline,f.inventory??inventoryFor(records),f.evaluationAt);
}
export function frameV4(records,baseline,inventory,at,pageSize=1){
 const intent=records.find(r=>r.role==="intent"),rows={baseline_maintenance:baseline.maintenance,baseline_receipts:baseline.receipts,directory:[],inventory};
 const pageCount=KINDS.reduce((n,k)=>n+Math.ceil((k==="directory"?records.length:rows[k].length)/pageSize),0);
 rows.directory=records.map((r,i)=>({index:pageCount+1+i,role:r.role,hash:hash(r.value)}));
 const pages=KINDS.flatMap(kind=>Array.from({length:Math.ceil(rows[kind].length/pageSize)},(_,ordinal)=>({schema:"native-bar-committed-page-v1",kind,
  commitment:commitment(kind,rows[kind]),ordinal,total_pages:Math.ceil(rows[kind].length/pageSize),entries:rows[kind].slice(ordinal*pageSize,(ordinal+1)*pageSize)})));
 const snapshot={policy_hash:POLICY,evaluation:evaluationFor(records,inventory,at),baseline_generation:intent?intent.value.binding.baseline_generation:null,
  manifest_commitment:manifestCommitment(records),collections:KINDS.map(kind=>({kind,commitment:commitment(kind,rows[kind]),total_entries:rows[kind].length})),
  pages:pages.map((p,i)=>({index:i+1,kind:p.kind,ordinal:p.ordinal,total_pages:p.total_pages,entry_count:p.entries.length,hash:hash(p)}))};
 const root={schema:"native-bar-committed-input-v4",snapshot,snapshot_generation:hash(snapshot)};
 return {records,baseline,inventory,at,root,pages,rows,input:()=>[buffer(canonical(root)),...pages.map(p=>buffer(canonical(p))),...records.map(r=>buffer(canonical(r.value)))],
  reframe:()=>frameV4(records,baseline,inventory,at,pageSize),sealRoot:()=>{root.snapshot_generation=hash(root.snapshot);}};
}
