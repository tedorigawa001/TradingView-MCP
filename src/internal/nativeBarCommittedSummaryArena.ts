/** Invocation-local packed scalar/field views; never retains a decoded or schema AST. */
import { blocks, type Row } from "./nativeBarCommittedKernel.js";
import { StreamBudget, knownObject, prepaidObjectKeys } from "./nativeBarCommittedStreamCore.js";
const WORDS=16384, BYTES=65536;
export class SummaryArena {
  #words: Uint32Array[]=[]; #pool: Buffer[]=[]; #used=0; #pooled=0;
  #shapes: {keys:string[];positions:Map<string,number>}[]=[]; #shapeIds=new Map<string,number>();
  #views=new WeakMap<object,number>(); #revoked=new Set<number>();
  #closed=false;
  constructor(readonly b: StreamBudget,readonly inputBytes: number){}
  #alloc(n:number){
    const b=this.b;b.charge(n+1);
    if(this.#closed)b.stop("stream_summary_expired");
    const start=this.#used;this.#used+=n;b.stats.arena_bytes=this.#used*4;
    while(this.#words.length*WORDS<this.#used){b.charge(blocks(BYTES));this.#words.push(new Uint32Array(WORDS));}
    return start;
  }
  #put(p:number,v:number){this.#words[Math.floor(p/WORDS)][p%WORDS]=v;}
  #at(p:number){this.b.charge();if(this.#closed)this.b.stop("stream_summary_expired");return this.#words[Math.floor(p/WORDS)][p%WORDS];}
  #string(s:string){
    const b=this.b;b.charge(blocks(s.length*3)+1);const n=Buffer.byteLength(s);
    if(this.#pooled+n>this.inputBytes)b.stop("stream_scalar_bound");
    b.charge(2*blocks(n)+1);const offset=this.#pooled;this.#pooled+=n;b.stats.scalar_bytes=this.#pooled;
    while(this.#pool.length*BYTES<this.#pooled){b.charge(blocks(BYTES));this.#pool.push(Buffer.allocUnsafe(BYTES));}
    // Write bounded scalar chunks; boundaries may split UTF-8 bytes, never the eventual decoded string.
    for(let i=0,pos=offset;i<s.length;){
      let end=Math.min(i+4096,s.length);
      if(end<s.length&&s.charCodeAt(end-1)>=0xd800&&s.charCodeAt(end-1)<=0xdbff&&s.charCodeAt(end)>=0xdc00&&s.charCodeAt(end)<=0xdfff)end--;
      // This arena retains only ASCII contract fields; arbitrary payload strings are never retained.
      const bytes=Buffer.from(s.slice(i,end));
      for(let k=0;k<bytes.length;){const page=Math.floor(pos/BYTES),at=pos%BYTES,take=Math.min(bytes.length-k,BYTES-at);bytes.copy(this.#pool[page],at,k,k+take);k+=take;pos+=take;}
      i=end;
    }
    const p=this.#alloc(2);this.#put(p,offset);this.#put(p+1,n);return p*8+3;
  }
  pack(v:any,keyBound:number):number {
    const b=this.b;b.charge();if(v===null)return 0;if(v===false)return 1;if(v===true)return 2;
    if(typeof v==="string"){
      b.charge(blocks(v.length)+1);
      // Accepted contract fields are ASCII except payload data (discarded after full schema validation).
      if(/[^\x00-\x7f]/.test(v))b.stop("stream_nonascii_summary");
      return this.#string(v);
    }
    if(typeof v==="number"){
      const p=this.#alloc(2),buf=new ArrayBuffer(8),view=new DataView(buf);view.setFloat64(0,v,true);
      this.#put(p,view.getUint32(0,true));this.#put(p+1,view.getUint32(4,true));return p*8+4;
    }
    if(Array.isArray(v)){
      const p=this.#alloc(1+v.length);this.#put(p,v.length);
      for(let i=0;i<v.length;i++)this.#put(p+1+i,this.pack(v[i],keyBound));return p*8+6;
    }
    const keys=prepaidObjectKeys(v,b,keyBound);
    const signature=JSON.stringify(keys);let shape=this.#shapeIds.get(signature);
    if(shape===undefined){shape=this.#shapes.length;this.#shapeIds.set(signature,shape);this.#shapes.push({keys,positions:new Map(keys.map((k,i)=>[k,i]))});}
    const p=this.#alloc(1+keys.length);this.#put(p,shape);
    keys.forEach((k,i)=>{b.charge();this.#put(p+1+i,this.pack(v[k],keyBound));});return p*8+5;
  }
  view(ref:number):any {
    const b=this.b;b.charge();if(this.#closed||this.#revoked.has(ref))b.stop("stream_summary_expired");
    if(ref<3)return ref===0?null:ref===2;
    const type=ref%8,p=Math.floor(ref/8);
    if(type===3){
      const start=this.#at(p),length=this.#at(p+1);b.charge(2*blocks(length)+1);
      // Retained fields are ASCII, so a scalar spanning slabs can be decoded in bounded pieces.
      let result="";for(let i=0;i<length;){const pos=start+i,take=Math.min(length-i,BYTES-pos%BYTES);result+=this.#pool[Math.floor(pos/BYTES)].toString("utf8",pos%BYTES,pos%BYTES+take);i+=take;}return result;
    }
    if(type===4){const v=new DataView(new ArrayBuffer(8));v.setUint32(0,this.#at(p),true);v.setUint32(4,this.#at(p+1),true);return v.getFloat64(0,true);}
    const array=type===6,shape=array?undefined:this.#shapes[this.#at(p)],n=array?this.#at(p):shape!.keys.length,target:any=array?new Array(n):{};
    const live=()=>{b.charge();if(this.#closed||this.#revoked.has(ref))b.stop("stream_summary_expired");};
    const lookup=(key:string)=>{
      if(array){const i=Number(key);return Number.isInteger(i)&&i>=0&&i<n&&String(i)===key?p+1+i:-1;}
      b.charge();const i=shape!.positions.get(key);return i===undefined?-1:p+1+i;
    };
    const proxy=new Proxy(target,{
      get:(_t,key)=>{
        live();
        if(array&&key==="length")return n;
        if(typeof key==="string"){const slot=lookup(key);if(slot>=0)return this.view(this.#at(slot));}
        return array?Reflect.get(Array.prototype,key):undefined;
      },
      has:(_t,key)=>{live();return typeof key==="string"&&lookup(key)>=0 || array&&key in Array.prototype;},
      ownKeys:()=>{
        live();
        b.charge(n);const keys=array?Array.from({length:n},(_,i)=>String(i)):[...shape!.keys];
        return array?[...keys,"length"]:keys;
      },
      getOwnPropertyDescriptor:(_t,key)=>{
        live();
        if(array&&key==="length")return Reflect.getOwnPropertyDescriptor(target,key);
        if(typeof key!=="string")return undefined;const slot=lookup(key);
        return slot<0?undefined:{enumerable:true,configurable:true,get:()=>this.view(this.#at(slot))};
      },set:()=>false,deleteProperty:()=>false,defineProperty:()=>false,
    });this.#views.set(proxy,ref);return knownObject(proxy,n,b);
  }
  row(v:Row,keyBound:number):Row{return this.view(this.pack(v,keyBound));}
  dropIntentProofs(binding: Row){
    const ref=this.#views.get(binding);if(ref===undefined)this.b.stop("stream_summary_binding");
    const p=Math.floor(ref!/8),shape=this.#shapes[this.#at(p)];
    for(const name of ["root","parents"]){
      this.b.charge();const i=shape.positions.get(name);if(i===undefined)this.b.stop("stream_summary_binding");
      const slot=p+1+i!,child=this.#at(slot);this.#erase(child,true);this.#put(slot,0);
    }
  }
  dropField(row:Row,name:string){
    const ref=this.#views.get(row);if(ref===undefined)this.b.stop("stream_summary_binding");
    const p=Math.floor(ref!/8),i=this.#shapes[this.#at(p)].positions.get(name);
    if(i===undefined)return;const slot=p+1+i;this.#erase(this.#at(slot));this.#put(slot,0);
  }
  eraseRow(row:Row){const ref=this.#views.get(row);if(ref===undefined)this.b.stop("stream_summary_binding");this.#erase(ref!);}
  #erase(ref:number,proof=false){
    this.b.charge();if(ref<3)return;const type=ref%8,p=Math.floor(ref/8);let words=2;
    if(type===5){const shape=this.#shapes[this.#at(p)];words=1+shape.keys.length;for(let i=1;i<words;i++)this.#erase(this.#at(p+i),proof);}
    if(type===6){words=1+this.#at(p);for(let i=1;i<words;i++)this.#erase(this.#at(p+i),proof);}
    if(type===3){const start=this.#at(p),n=this.#at(p+1);this.b.charge(blocks(n)+1);
      for(let i=0;i<n;){const pos=start+i,take=Math.min(n-i,BYTES-pos%BYTES);this.#pool[Math.floor(pos/BYTES)].fill(0,pos%BYTES,pos%BYTES+take);i+=take;}}
    this.b.charge(words+1);for(let i=0;i<words;i++)this.#put(p+i,0);
    this.#revoked.add(ref);if(proof)this.b.stats.released_proof_nodes++;
  }
  dispose(){this.#closed=true;this.#words=[];this.#pool=[];this.#shapes=[];this.#shapeIds.clear();this.#revoked.clear();}
}
