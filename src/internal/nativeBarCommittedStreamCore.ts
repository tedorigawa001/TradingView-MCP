/** Internal old-limit streaming primitives. No IO, clocks, grants or expanded profile. */
import { createHash } from "node:crypto";
import { types } from "node:util";
import { COMMITTED_MAINTENANCE_LIMITS as L, CommittedMaintenanceBudget, blocks, encode, digest, type Row } from "./nativeBarCommittedKernel.js";

export class StreamBudget extends CommittedMaintenanceBudget {
  readonly objectKeyBounds = new WeakMap<object,number>();
  releaseIntentProofs?: (binding: Row) => void;
  readonly stats = { peak_fragment_bytes: 0, fragments: 0, copied_frames: 0, peak_frames: 0, arena_bytes: 0, scalar_bytes: 0,
    manifest_claims: 0, materialized_pairs: 0, proof_catalogs: 0, payload_summaries: 0, released_proof_nodes: 0,
    replay_rows_loaded: 0, replay_rows_released: 0, peak_replay_rows: 0, action_tables_released: 0,
    canonical_bytes: 0, canonical_blocks: 0, hash_updates: 0, indexed_frame_loads: 0, indexed_frame_hits: 0 };
}
/** Internal shape provenance only: no byte-input schema accepts these bounds. */
export function knownObject<T extends object>(value:T,keys:number,b:CommittedMaintenanceBudget):T {
  if(b instanceof StreamBudget){b.charge();b.objectKeyBounds.set(value,keys);}return value;
}
export function prepaidObjectKeys(value:object,b:StreamBudget,upper?:number):string[] {
  const bound=b.objectKeyBounds.get(value)??upper??L.nodes_per_record;
  b.charge(2*bound+1); // Enumeration and key-array allocation, before Object.keys or proxy traps.
  const keys=Object.keys(value);
  if(keys.length>bound)b.stop("stream_key_bound");
  b.objectKeyBounds.set(value,keys.length);return keys;
}
function knownResultTree(value:any,b:StreamBudget){
  b.charge();if(!value||typeof value!=="object")return;
  if(Array.isArray(value)){value.forEach(v=>knownResultTree(v,b));return;}
  // All diagnostic/result objects are internally constructed fixed shapes, including <=32 statistics fields.
  for(const key of prepaidObjectKeys(value,b,32))knownResultTree(value[key],b);
}
/** Trusted scoped producer: the consumer finishes a row before its source frame is released. */
export class CanonicalSequence {
  constructor(readonly consume: (visit:(row:unknown,index:number)=>void)=>void){}
}
/** One logical pass, including a continuous 64-byte remainder. No prefix digest escapes on failure. */
export function canonicalStream(value: unknown, limit: number, b: StreamBudget, expected?: string) {
  const hash = createHash("sha256"); let size = 0, paidBlocks = 0;
  const append = (text: string) => {
    b.charge(1 + blocks(text.length * 3)); // Prepay UTF-8 size scan, before Buffer.byteLength.
    const n = Buffer.byteLength(text);
    if (n > 65536 || size + n > limit) b.stop("encoded_bytes_limit");
    const nextBlocks = blocks(size + n);
    b.charge(2 * (nextBlocks - paidBlocks) + 1); // Copy/comparison + hashing, before either operation.
    if (expected !== undefined && expected.slice(characterOffset, characterOffset + text.length) !== text) b.stop("noncanonical_record");
    characterOffset += text.length;
    b.stats.hash_updates++; hash.update(text); size += n;
    b.stats.canonical_bytes+=n;b.stats.canonical_blocks+=nextBlocks-paidBlocks;paidBlocks = nextBlocks;
    b.stats.fragments++; b.stats.peak_fragment_bytes = Math.max(b.stats.peak_fragment_bytes, n);
  };
  let characterOffset = 0;
  const quoted = (text: string) => {
    b.charge(blocks(text.length * 6 + 2)); // Bound escaping and the complete size scan before emitting this value.
    let n = 2;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c === 34 || c === 92 || [8,9,10,12,13].includes(c)) n += 2;
      else if (c < 32) n += 6;
      else if (c < 128) n++;
      else if (c < 2048) n += 2;
      else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length && text.charCodeAt(i+1) >= 0xdc00 && text.charCodeAt(i+1) <= 0xdfff) { n += 4; i++; }
      else n += c >= 0xd800 && c <= 0xdfff ? 6 : 3;
      if (size + n > limit) b.stop("encoded_bytes_limit");
    }
    append('"');
    for (let i = 0; i < text.length;) {
      // 1,024 UTF-16 units keep source slice, escaped/sliced copies, comparison and UTF-8 conversion together below 64 KiB.
      let end = Math.min(i + 1024, text.length);
      if (end < text.length && text.charCodeAt(end-1) >= 0xd800 && text.charCodeAt(end-1) <= 0xdbff &&
        text.charCodeAt(end) >= 0xdc00 && text.charCodeAt(end) <= 0xdfff) end--;
      b.charge(1 + blocks((end-i)*6+2));
      const fragment = JSON.stringify(text.slice(i,end)).slice(1,-1);
      append(fragment); i=end;
    }
    append('"');
  };
  const visit = (v: any): void => {
    b.charge();
    if (typeof v === "string") return quoted(v);
    if (v === null || typeof v === "boolean") return append(v === null ? "null" : v ? "true" : "false");
    if (typeof v === "number") {
      if (!Number.isFinite(v)) b.stop("nonfinite_number");
      b.charge(); return append(JSON.stringify(v));
    }
    if (v instanceof CanonicalSequence) { append("[");v.consume((row,i)=>{if(i)append(",");visit(row);});append("]");return; }
    if (Array.isArray(v)) { append("["); v.forEach((x,i) => { if (i) append(","); visit(x); }); append("]"); return; }
    if (!v || typeof v !== "object") b.stop("non_json");
    const keys = prepaidObjectKeys(v,b).sort((a,c) => { b.charge(); return a<c?-1:a>c?1:0; });
    append("{"); keys.forEach((k,i) => { if (i) append(","); quoted(k); append(":"); visit(v[k]); }); append("}");
  };
  visit(value);
  if (expected !== undefined && characterOffset !== expected.length) b.stop("noncanonical_record");
  return { hash: hash.digest("hex"), bytes: size };
}
/** The v3 branch intentionally performs exactly the original operations, including charged work. */
export function canonicalHash(value: unknown, limit: number, b: CommittedMaintenanceBudget) {
  return b instanceof StreamBudget ? canonicalStream(value,limit,b).hash : digest(encode(value,limit,b),b);
}
export function canonicalSizeCheck(value: unknown, limit: number, b: CommittedMaintenanceBudget) {
  if (b instanceof StreamBudget) {knownResultTree(value,b);canonicalStream(value,limit,b);} else encode(value,limit,b);
}
export function canonicalReceipt(value: Row, b: CommittedMaintenanceBudget, prepayScan = false) {
  if (b instanceof StreamBudget) return canonicalStream(value,L.record_bytes,b);
  const text=encode(value,L.record_bytes,b), hash=digest(text,b);
  if (prepayScan) b.charge(blocks(text.length)); return { hash, bytes: Buffer.byteLength(text) };
}

const byteLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"byteLength")!.get!;
const resizable = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype,"resizable")!.get!;
/** Only source references survive preflight. Every read hashes/parses the same private copy. */
export class StreamFrames {
  readonly sizes: number[] = []; readonly total: number;
  #sources: ArrayBuffer[] = []; #active = false; #hashes = new Map<number,string>(); #roles = new Map<number,string>();
  #snapshot: string | null = null;
  #cached: {index:number;role:string;hash:string;snapshot:string|null;raw:Buffer}|null=null;
  constructor(input: unknown, readonly b: StreamBudget) {
    if (types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input)!==Array.prototype) b.stop("input_array");
    const count=Object.getOwnPropertyDescriptor(input,"length")!.value as number;
    if(count<1 || count>L.records)b.stop("record_count_limit");
    let total=0;
    for(let i=0;i<count;i++){
      b.charge(); const d=Object.getOwnPropertyDescriptor(input,String(i));
      if(!d || !Object.hasOwn(d,"value"))b.stop("input_accessor_or_sparse");
      const v=d.value; let size=0;
      try { if(types.isProxy(v)||Object.getPrototypeOf(v)!==ArrayBuffer.prototype||resizable.call(v))b.stop("input_buffer");
        size=byteLength.call(v); new Uint8Array(v); } catch { b.stop("input_buffer"); }
      if(size<1 || size>L.record_bytes)b.stop("record_bytes_limit");
      total+=size;if(total>L.input_bytes)b.stop("input_bytes_limit");
      this.#sources.push(v);this.sizes.push(size);
    }
    this.total=total;
  }
  get length(){return this.#sources.length;}
  bindSnapshot(generation: string){ if(this.#snapshot!==null && this.#snapshot!==generation)this.b.stop("stream_snapshot_binding");this.#snapshot=generation; }
  read<T>(index: number, role: string, expected: string | null, use: (raw: Buffer, hash: string)=>T): T {
    const b=this.b;
    if(this.#active)b.stop("stream_nested_frame");
    this.#cached=null; // Evict before a different private frame can be copied.
    b.charge();const source=this.#sources[index],size=this.sizes[index];
    try { if(byteLength.call(source)!==size || resizable.call(source))b.stop("stream_frame_changed");new Uint8Array(source); }
    catch { return b.stop("stream_frame_changed"); }
    if(this.#roles.has(index) && this.#roles.get(index)!==role)b.stop("stream_role_binding");
    b.charge(blocks(size)+1); const raw=Buffer.from(new Uint8Array(source));
    const sha=digest(raw,b);
    if(expected!==null && sha!==expected)b.stop(role==="page"?"page_hash":"record_hash");
    if(this.#hashes.has(index)&&this.#hashes.get(index)!==sha)b.stop("stream_frame_changed");
    this.#hashes.set(index,sha);this.#roles.set(index,role);this.#active=true;
    b.stats.copied_frames++;b.stats.peak_frames=Math.max(b.stats.peak_frames,1);
    try { return use(raw,sha); } finally { this.#active=false; }
  }
  /** Retain one frozen private frame, not an AST. Indexed slices are parsed only when admitted by semantics. */
  readIndexed<T>(index:number,role:string,expected:string,use:(raw:Buffer)=>T):T {
    const b=this.b;if(this.#active)b.stop("stream_nested_frame");
    if(!this.#cached||this.#cached.index!==index||this.#cached.role!==role||this.#cached.hash!==expected||this.#cached.snapshot!==this.#snapshot){
      this.#cached=null; // Do not keep an old cache in a local while read() allocates the replacement.
      return this.read(index,role,expected,(raw,hash)=>{
        this.#cached={index,role,hash,snapshot:this.#snapshot,raw};b.stats.indexed_frame_loads++;
        return use(raw);
      });
    }
    const cached=this.#cached;
    b.charge();const source=this.#sources[index],size=this.sizes[index];
    try{if(byteLength.call(source)!==size||resizable.call(source))b.stop("stream_frame_changed");new Uint8Array(source);}
    catch{return b.stop("stream_frame_changed");}
    // A cache hit avoids copying/decoding the page, but source change detection is still charged.
    if(digest(new Uint8Array(source),b)!==cached.hash)b.stop("stream_frame_changed");
    this.#active=true;b.stats.indexed_frame_hits++;
    try{return use(cached.raw);}finally{this.#active=false;}
  }
  dispose(){this.#cached=null;this.#sources=[];this.#hashes.clear();this.#roles.clear();this.#snapshot=null;}
}

/** Called only after canonical decoding and the complete manifest schema passed. */
export function manifestPairSpans(raw:Buffer,count:number,b:StreamBudget):Uint32Array {
  b.charge(2*blocks(raw.length)+2*count+1);
  const marker='"pairs":[',at=raw.indexOf(marker);
  if(at<0||count<1||count>64)b.stop("stream_manifest_index");
  const spans=new Uint32Array(count*2);let cursor=at+marker.length;
  for(let i=0;i<count;i++){
    if(raw[cursor]!==123)b.stop("stream_manifest_index");
    const start=cursor;let depth=0,quoted=false,escaped=false;
    for(;cursor<raw.length;cursor++){
      const c=raw[cursor];
      if(quoted){if(escaped)escaped=false;else if(c===92)escaped=true;else if(c===34)quoted=false;continue;}
      if(c===34)quoted=true;else if(c===123||c===91)depth++;
      else if(c===125||c===93){if(--depth===0){cursor++;break;}}
    }
    if(depth!==0||quoted||cursor<=start)b.stop("stream_manifest_index");
    spans[i*2]=start;spans[i*2+1]=cursor;
    if(i<count-1&&raw[cursor++]!==44)b.stop("stream_manifest_index");
  }
  if(raw[cursor]!==93)b.stop("stream_manifest_index");return spans;
}

export function decodeStream(raw: Buffer,b: StreamBudget): {value: Row;nodes:number;max_keys:number} {
  b.charge(2*blocks(raw.length));let text: string;
  try{text=new TextDecoder("utf-8",{fatal:true,ignoreBOM:true}).decode(raw);}catch{return b.stop("invalid_utf8");}
  let nodes=0,depth=0,quoted=false,escaped=false,word=false;
  const node=()=>{b.charge();if(++nodes>L.nodes_per_record)b.stop("node_limit");};
  for(const c of text){
    if(quoted){if(escaped)escaped=false;else if(c==="\\")escaped=true;else if(c==='"')quoted=false;continue;}
    if(c==='"'){node();quoted=true;word=false;}else if(c==="{"||c==="["){node();word=false;if(++depth>L.depth)b.stop("depth_limit");}
    else if(c==="}"||c==="]"){depth--;word=false;}else if(c===","||c===":"||/\s/.test(c))word=false;else if(!word){node();word=true;}
  }
  // JSON.parse/reviver visits are prepaid from lexical nodes. Count by parent identity, not property order.
  b.charge(5*nodes);let value: unknown,max_keys=0;
  try{value=JSON.parse(text,function(this:object,_key:string,v:unknown){
    if(!Array.isArray(this)){const n=(b.objectKeyBounds.get(this)??0)+1;b.objectKeyBounds.set(this,n);max_keys=Math.max(max_keys,n);}
    if(v&&typeof v==="object"&&!Array.isArray(v)&&!b.objectKeyBounds.has(v))b.objectKeyBounds.set(v,0);
    return v;
  });}catch{return b.stop("invalid_json");}
  if(!value||typeof value!=="object"||Array.isArray(value))b.stop("record_object_required");
  canonicalStream(value,L.record_bytes,b,text);return {value:value as Row,nodes,max_keys};
}
