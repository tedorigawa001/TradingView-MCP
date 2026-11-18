/** Internal streaming candidate only. Existing limits and STOP; no runtime integration. */
import { z } from "zod";
import { COMMITTED_MAINTENANCE_LIMITS as LIMITS, parse, pairSchema, schemas, encode, type Row, type RecordRow } from "./nativeBarCommittedKernel.js";
import { StreamBudget, StreamFrames, CanonicalSequence, decodeStream, canonicalStream, manifestPairSpans, knownObject } from "./nativeBarCommittedStreamCore.js";
import { SummaryArena } from "./nativeBarCommittedSummaryArena.js";
import { rootSchema, rowSchemas, newSchemas } from "./nativeBarCommittedPagedConnection.js";
import { verifyCommittedLogical, rejectCommittedLogical } from "./nativeBarCommittedSemantic.js";
const kinds=["baseline_maintenance","baseline_receipts","directory","inventory"] as const;
type Kind=typeof kinds[number];
const count=z.number().int().min(0).max(LIMITS.records-1);
export function inspectCommittedStreamingMaintenanceStageA(input: unknown) {
  const b = new StreamBudget();
  let frames: StreamFrames | undefined, arena: SummaryArena | undefined;
  try {
    b.charge(256);
    frames = new StreamFrames(input,b); arena = new SummaryArena(b,frames.total);
    const store=frames, summaries=arena;
    const proofOwners=new WeakMap<Row,()=>void>();
    b.releaseIntentProofs=binding=>{const release=proofOwners.get(binding);if(!release)b.stop("stream_summary_binding");release!();};
    const reread=(index:number,role:RecordRow["role"],hash:string,use:(value:Row,keyBound:number,original:Row)=>Row)=>store.read(index,role,hash,raw=>{
      const decoded=decodeStream(raw,b),schema=role in newSchemas?newSchemas[role as keyof typeof newSchemas]:schemas[role];
      return use(parse(schema! as z.ZodType<Row>,{...decoded,bytes:raw.length},b),decoded.max_keys,decoded.value);
    });
    const root=store.read(0,"root",null,raw=>{
      const decoded=decodeStream(raw,b);return summaries.row(parse(rootSchema,{...decoded,bytes:raw.length},b),decoded.max_keys);
    }), s=root.snapshot;
    store.bindSnapshot(root.snapshot_generation);
    if (canonicalStream(s,LIMITS.record_bytes,b).hash !== root.snapshot_generation) b.stop("page_snapshot_binding");
    const rows: Record<Kind, Row[]> = { baseline_maintenance: [], baseline_receipts: [], directory: [], inventory: [] };
    const totals = new Map<Kind, number>(), pageCounts = new Map<Kind, number>();
    for (let i = 0; i < kinds.length; i++) { b.charge(); if (s.collections[i].kind !== kinds[i]) b.stop("page_collection_order"); }
    let lastKind = -1, ordinal = -1;
    for (let i = 0; i < s.pages.length; i++) {
      b.charge(); const ref = s.pages[i], rank = kinds.indexOf(ref.kind);
      if (ref.index !== i + 1 || ref.index >= store.length || rank < lastKind || ref.ordinal !== (rank === lastKind ? ordinal + 1 : 0)) b.stop("page_order");
      lastKind = rank; ordinal = ref.ordinal;
      const page=store.read(ref.index,"page",ref.hash,raw=>{
        const decoded=decodeStream(raw,b);
        const schema=z.strictObject({schema:z.literal("native-bar-committed-page-v1"),kind:z.literal(ref.kind),commitment:rootSchema.shape.snapshot.shape.policy_hash,
          ordinal:count,total_pages:count,entries:z.array(rowSchemas[ref.kind as Kind]).min(1).max(512)});
        return summaries.row(parse(schema,{...decoded,bytes:raw.length},b),decoded.max_keys);
      });
      if (page.commitment !== s.collections[rank].commitment || page.ordinal !== ref.ordinal || page.total_pages !== ref.total_pages ||
        page.entries.length !== ref.entry_count || ref.total_pages < 1 || ref.ordinal >= ref.total_pages ||
        totals.has(ref.kind) && totals.get(ref.kind) !== ref.total_pages) b.stop("page_collection_binding");
      if (ref.kind === "baseline_receipts" && rows[ref.kind as Kind].length + page.entries.length > LIMITS.store_receipts) b.stop("store_receipt_limit");
      totals.set(ref.kind, ref.total_pages); pageCounts.set(ref.kind, (pageCounts.get(ref.kind) ?? 0) + 1);
      b.charge(page.entries.length); rows[ref.kind as Kind].push(...page.entries);
    }
    for (let i = 0; i < kinds.length; i++) {
      b.charge(); const kind = kinds[i], c = s.collections[i];
      if (rows[kind].length !== c.total_entries || (totals.get(kind) ?? 0) !== (pageCounts.get(kind) ?? 0)) b.stop("page_collection_count");
      if (canonicalStream(knownObject({ schema: "native-bar-committed-collection-v1", kind, entries: rows[kind] },3,b), LIMITS.input_bytes, b).hash !== c.commitment)
        b.stop("page_collection_commitment");
    }
    let inventoryKey = "", activeReceipts = 0;
    for (const entry of rows.inventory) {
      b.charge(); const key = encode(entry,LIMITS.record_bytes,b); // Schema bounds this scalar key below 512 bytes.
      if (key <= inventoryKey) b.stop("paged_inventory_order"); inventoryKey = key;
      if (entry.role === "receipt" && entry.location === "source" && ++activeReceipts > LIMITS.store_receipts) b.stop("store_receipt_limit");
    }
    if (rows.directory.length + s.pages.length + 1 !== store.length) b.stop("page_record_directory");
    const records: RecordRow[] = [],replayRows=new WeakMap<RecordRow,{release:()=>void;stripActions:()=>void}>();let liveReplay=0;
    // Every semantic pass gets a fresh cursor. Replay retains one active attempt; events/completions expire at cursor advance.
    Object.defineProperty(records,Symbol.iterator,{value:function*(){
      let previousAttempt:RecordRow|undefined;
      for(let i=0;i<records.length;i++){
        const row=records[i];
        if(row.role==="attempt"){
          if(previousAttempt)replayRows.get(previousAttempt)?.release();
          previousAttempt=row;
        }
        try{yield row;}finally{
          if(row.role==="event"||row.role==="completion")replayRows.get(row)?.release();
          if(row.role==="attempt")replayRows.get(row)?.stripActions();
        }
      }
    }});
    for (let i = 0; i < rows.directory.length; i++) {
      b.charge(); const d = rows.directory[i]; if (d.index !== s.pages.length + 1 + i) b.stop("page_record_directory");
      const role=d.role as RecordRow["role"];
      const record=store.read(d.index,role,d.hash,(raw,hash)=>{
        const decoded=decodeStream(raw,b),schema=role in newSchemas?newSchemas[role as keyof typeof newSchemas]:schemas[role];
        if(!schema)b.stop("unsupported_role");
        const value=parse(schema! as z.ZodType<Row>,{...decoded,bytes:raw.length},b);
        // Never derive evidence until every series/bar has passed the original schema.
        let retained=value;
        if(role==="payload_v1"){
          b.charge(value.series.length+1);
          retained={capture_as_of:value.capture_as_of,series:value.series.map((s:Row)=>({observed_at:s.observed_at}))};
          b.stats.payload_summaries++;
        }
        if(role==="manifest"){
          b.charge(value.pairs.length*4);
          if(b.stats.manifest_claims+value.pairs.length>Math.floor(store.total/128))b.stop("stream_claim_bound");
          b.stats.manifest_claims+=value.pairs.length;
          retained={...value,pairs:value.pairs.map((p:Row)=>({recording_id:p.recording_id,sequence:p.sequence,receipt_hash:p.receipt_hash,payload_hash:p.payload_hash}))};
        }
        if(role==="intent"){
          const {root:ignoredRoot,parents:ignoredParents,...binding}=value.binding;
          retained={...value,binding};
        }
        if(role==="attempt"||role==="event"||role==="completion")retained={};
        return {index:d.index,role,hash,bytes:raw.length,nodes:decoded.nodes,value:summaries.row(retained,decoded.max_keys),key_bound:decoded.max_keys,
          pair_spans:role==="manifest"?manifestPairSpans(raw,value.pairs.length,b):undefined};
      });
      if(role==="attempt"||role==="event"||role==="completion"){
        let cached:Row|undefined,actionsStripped=false;
        Object.defineProperty(record,"value",{enumerable:true,get:()=>cached??=reread(record.index,role,record.hash,(v,keyBound)=>{
          const row=summaries.row(v,keyBound);b.stats.replay_rows_loaded++;liveReplay++;b.stats.peak_replay_rows=Math.max(b.stats.peak_replay_rows,liveReplay);return row;
        })});
        replayRows.set(record,{
          release:()=>{if(cached){summaries.eraseRow(cached);cached=undefined;liveReplay--;b.stats.replay_rows_released++;}},
          stripActions:()=>{if(cached&&!actionsStripped){summaries.dropField(cached,"actions");actionsStripped=true;b.stats.action_tables_released++;}},
        });
      }
      if(role==="manifest"){
        const compact=record.value,claims:Row[]=[];
        for(let ordinal=0;ordinal<compact.pairs.length;ordinal++){
          b.charge(16); // Descriptor, lazy view and retained reference, before allocation.
          const identity=compact.pairs[ordinal];let full:Row|undefined;
          const load=()=>full??=store.readIndexed(record.index,role,record.hash,raw=>{
            const spans=record.pair_spans!,slice=raw.subarray(spans[ordinal*2],spans[ordinal*2+1]),decoded=decodeStream(slice,b);
            const v=parse(pairSchema,{...decoded,bytes:slice.length},b);
            const {recording_id,sequence,receipt_hash,payload_hash,...rest}=v;
            const row=summaries.row(rest,decoded.max_keys);b.stats.materialized_pairs++;return row;
          });
          const cheap=(key:string)=>key==="recording_id"||key==="sequence"||key==="receipt_hash"||key==="payload_hash";
          claims.push(knownObject(new Proxy({}, {
            get:(_t,key)=>{b.charge();return typeof key==="string"?(cheap(key)?identity[key]:load()[key]):undefined;},
            ownKeys:()=>{b.charge(16);return [...Object.keys(identity),...Object.keys(load())];},
            getOwnPropertyDescriptor:(_t,key)=>typeof key==="string"?{enumerable:true,configurable:true,get:()=>cheap(key)?identity[key]:load()[key]}:undefined,
          }),record.key_bound,b));
        }
        record.value=knownObject(new Proxy(compact,{get:(target,key)=>key==="pairs"?claims:Reflect.get(target,key)}),record.key_bound,b);
      }
      if(role==="intent"){
        const compact=record.value;let proofs:Row|undefined;
        const load=()=>proofs??=reread(record.index,role,record.hash,(v,keyBound)=>{const row=summaries.row({root:v.binding.root,parents:v.binding.parents},keyBound);b.stats.proof_catalogs++;return row;});
        const binding=knownObject(new Proxy(compact.binding,{get:(target,key)=>key==="root"||key==="parents"?load()[key]:Reflect.get(target,key)}),record.key_bound,b);
        proofOwners.set(binding,()=>{if(!proofs)b.stop("stream_summary_binding");summaries.dropIntentProofs(proofs!);});
        record.value=knownObject(new Proxy(compact,{get:(target,key)=>key==="binding"?binding:Reflect.get(target,key)}),record.key_bound,b);
      }
      records.push(record);
    }
    const pairs=new CanonicalSequence(visit=>{
      let ordinal=0;
      for(const record of records){b.charge();if(record.role!=="manifest")continue;
        reread(record.index,"manifest",record.hash,(_value,_bound,original)=>{for(const pair of original.pairs){b.charge();visit(pair,ordinal++);}return {};});
      }
    });
    if (s.manifest_commitment !== canonicalStream(knownObject({ schema: "native-bar-committed-manifest-collection-v1", pairs },2,b), LIMITS.input_bytes, b).hash) b.stop("paged_manifest_collection");
    const receipts = s.collections[1], maintenance = s.collections[0]; let intents = 0;
    for (const r of records) {
      b.charge(); if (r.role !== "intent") continue; intents++;
      const v = r.value, ref = v.binding.baseline_ref;
      if (v.binding.baseline_generation !== s.baseline_generation || ref.receipts.commitment !== receipts.commitment || ref.receipts.count !== receipts.total_entries ||
        ref.maintenance.commitment !== maintenance.commitment || ref.maintenance.count !== maintenance.total_entries) b.stop("paged_baseline_declaration");
      if (v.manifest_commitment !== s.manifest_commitment) b.stop("paged_manifest_declaration");
      // Only identity is resolved here. Original receipt/time/generation semantics stay after the legacy snapshot.
      r.resolved_baseline = knownObject({ receipts: rows.baseline_receipts, maintenance: rows.baseline_maintenance },2,b);
    }
    if (!intents && (rows.baseline_receipts.length || rows.baseline_maintenance.length || s.baseline_generation !== null)) b.stop("paged_orphan_baseline");
    return verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, b, "paged-stage-a");
  } catch (error) { return rejectCommittedLogical(error, b, null, "paged-stage-a"); }
  finally { arena?.dispose(); frames?.dispose(); }
}
