import { createHash } from "node:crypto";
export const canonical = v => Array.isArray(v) ? `[${v.map(canonical).join(",")}]` : v !== null && typeof v === "object"
  ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}` : JSON.stringify(v);
export const hash = v => createHash("sha256").update(typeof v === "string" ? v : canonical(v)).digest("hex");
export const buffer = text => Uint8Array.from(Buffer.from(text)).buffer;
export const ID = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
export const POLICY = "2".repeat(64);
export const KINDS = ["baseline_maintenance","baseline_receipts","directory","inventory","manifest"];
export const commitment = (kind, entries) => hash({schema:"native-bar-committed-collection-preparation-v1",kind,entries});
export function source(sequence=1, pairBytes) {
  const at = new Date(Date.UTC(2026,0,1)+(sequence-1)*60000).toISOString();
  const payload = {capture_as_of:at,restoration_verified:true,restoration_hash:"3".repeat(64),series:
    ["PEPPERSTONE:MXNJPY","OANDA:XAUUSD"].flatMap(symbol=>["15","60"].map(timeframe=>{
      const context={symbol,full_name:symbol,exchange:symbol.split(":")[0],type:"forex",currency:"USD",timezone:"Etc/UTC",session:"24x7",
        subsession_id:"regular",pricescale:100,minmov:1,minmove2:0,fractional:false,chart_style:"candles",adjustment:"not_applicable",capture_contract:"native-bar-v1:successor-confirmed"};
      return {symbol,timeframe,context,series_context_id:hash(context),source:"tradingview_native_ohlcv",price_basis:"unknown",observed_at:at,
        history_shortage:true,provenance:{session_holidays:null,corrections:null},bars:[{bar_open_at:new Date(Date.parse(at)-60000).toISOString(),
          confirmed_by_next_bar_at:at,open:1,high:2,low:1,close:2,volume:null}]};
    }))};
  const receipt={schema:"native-bar-receipt-v1",recording_id:ID(sequence),sequence,day:at.slice(0,10),recorded_at:at,
    policy_hash:POLICY,plan_hash:"1".repeat(64),payload_hash:hash(payload)};
  if(pairBytes!==undefined){
    payload.series[0].provenance.corrections="";
    const padding=pairBytes-Buffer.byteLength(canonical(payload))-Buffer.byteLength(canonical(receipt));
    if(padding<0||padding>65536)throw Error("padding outside schema");
    payload.series[0].provenance.corrections="p".repeat(padding);receipt.payload_hash=hash(payload);
  }
  return {receipt,payload};
}
export function manifestPair(sequence=1) {
  const {receipt,payload}=source(sequence), proof=(inode,size)=>({device:"1",inode:String(inode),uid:"1",gid:"1",mode:"33152",nlink:"1",size:String(size),
    flags:"0",birthtime_ns:"1",mtime_ns:"1",ctime_ns:"1",acl:"none",acl_hash:"5".repeat(64)});
  return {recording_id:receipt.recording_id,sequence,day:receipt.day,receipt_fields:receipt,capture_as_of:payload.capture_as_of,
    receipt_hash:hash(receipt),payload_hash:hash(payload),recorded_at:receipt.recorded_at,last_observed_at:receipt.recorded_at,
    receipt_proof:proof(sequence*2,Buffer.byteLength(canonical(receipt))),payload_proof:proof(sequence*2+1,Buffer.byteLength(canonical(payload)))};
}
export function pagingFixture(count=2, pageSize=1) {
  const sources=Array.from({length:count},(_,i)=>source(i+1));
  const records=sources.flatMap(s=>[{role:"receipt_v1",value:s.receipt},{role:"payload_v1",value:s.payload}]);
  const rows={baseline_maintenance:[],baseline_receipts:sources.map(s=>s.receipt),directory:[],inventory:sources.flatMap(({receipt})=>
    ["receipt","payload"].map(role=>({recording_id:receipt.recording_id,role,location:"source",hash:role==="receipt"?hash(receipt):receipt.payload_hash})))
      .sort((a,b)=>canonical(a)<canonical(b)?-1:1),manifest:[]};
  const f={rows,records,pageSize};
  f.pack=()=>packPages(f);return f;
}
export function packPages(f) {
  const {rows,records,pageSize}=f, bodies=records.map(r=>canonical(r.value));
  // Directory entries change size but not count, so its page count is fixed before indexes are assigned.
  const pageCount=KINDS.reduce((n,k)=>n+Math.ceil((k==="directory"?records.length:rows[k].length)/pageSize),0);
  rows.directory=records.map((r,i)=>({index:pageCount+1+i,role:r.role,hash:hash(bodies[i])}));
  const pages=KINDS.flatMap(kind=>Array.from({length:Math.ceil(rows[kind].length/pageSize)},(_,ordinal)=>({
    schema:"native-bar-committed-page-preparation-v1",kind,commitment:commitment(kind,rows[kind]),ordinal,
    total_pages:Math.ceil(rows[kind].length/pageSize),entries:rows[kind].slice(ordinal*pageSize,(ordinal+1)*pageSize)})));
  const pageBodies=pages.map(canonical);
  const evidence=records.filter(r=>["receipt_v1","payload_v1"].includes(r.role)).map(r=>({role:r.role,hash:hash(r.value)}))
    .sort((a,b)=>a.hash<b.hash?-1:a.hash>b.hash?1:a.role<b.role?-1:a.role>b.role?1:0);
  const journal=records.filter(r=>!["receipt_v1","payload_v1"].includes(r.role)).map(r=>({role:r.role,hash:hash(r.value)}));
  const evaluation={evaluation_id:ID(9000),at:"2026-05-01T00:00:00.000Z",journal_hash:hash(journal),evidence_hash:hash(evidence),
    inventory_hash:hash({policy_hash:POLICY,entries:rows.inventory}),intent_hash:records.find(r=>r.role==="intent")?hash(records.find(r=>r.role==="intent").value):null,
    attempt_hash:records.findLast(r=>r.role==="attempt")?hash(records.findLast(r=>r.role==="attempt").value):null,clock:null};
  const snapshot={policy_hash:POLICY,evaluation,baseline_generation:hash({receipts:rows.baseline_receipts,maintenance:rows.baseline_maintenance}),
    collections:KINDS.map(kind=>({kind,commitment:commitment(kind,rows[kind]),total_entries:rows[kind].length})),
    pages:pages.map((p,i)=>({index:i+1,kind:p.kind,ordinal:p.ordinal,total_pages:p.total_pages,entry_count:p.entries.length,hash:hash(pageBodies[i])}))};
  const root={schema:"native-bar-committed-pages-preparation-v1",snapshot,snapshot_generation:hash(snapshot)};
  return {root,pages,records,input:()=>[buffer(canonical(root)),...pages.map(p=>buffer(canonical(p))),...bodies.map(buffer)]};
}
