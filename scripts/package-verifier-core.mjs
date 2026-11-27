import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { createHash } from 'node:crypto';
import { createInflateRaw, crc32 } from 'node:zlib';
import path from 'node:path';

export const MiB = 1048576;
export const RELEASE_VERSION = '0.1.49';
// The fixed distribution allowlist of the current candidate; older ones stay as history.
export const DISTRIBUTION_MANIFEST = 'packaging/npm-js-' + RELEASE_VERSION + '.json';
export const PATH_HASH = '1941967d883425b664363faaaf89ae15bd431aaae59c1494784c00148e9a9fee';
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export const fail = reason => { throw new Error(reason); };
export function invariant(ok, reason) { if (!ok) fail(reason); }
export const LIMITS = Object.freeze({ source:8*MiB, emit:8*MiB, stage:8*MiB,
  tarball:8*MiB, extract:8*MiB, negative:8*MiB, logs:960*1024, final:64*1024 });
// This approval has already been consumed by the preserved continuation run.
// A new UUID, retry flag or deleting a record must never create another budget.
export const APPROVED_CONTINUATION = Object.freeze({
  run:'package-2026-11-18T05-28-09-196Z-b7db5ad2-0329-41ef-ae73-42f9ee93afd8',
  carriedRecord:'package-2026-11-18T05-17-30-705Z-ba852d20-3d59-49e4-b0a8-9d9957d16765/report/stopped.json',
  carriedSha256:'696e5c80e007e7d0292da6d1ae0e326857fb287cdef0f7dc4586d9e09a36ce5f',
  carriedHold:9*MiB,newRunCeiling:49*MiB,unusedMargin:6*MiB,campaignCeiling:64*MiB
});
export const VERIFIER_INPUT_PATHS = Object.freeze([
  'scripts/verify-package.mjs','scripts/package-verifier-core.mjs',
  'scripts/package-approval.mjs','scripts/prepare-package-reverify.mjs',
  'test/unit/packageDistribution.test.mjs','test/unit/packageApproval.test.mjs',DISTRIBUTION_MANIFEST
].sort());

export function captureVerifierInputs(read) {
  const contents=new Map(),files=VERIFIER_INPUT_PATHS.map(p=>{
    const value=read(p);invariant(Buffer.isBuffer(value),'verifier_input_bytes');
    const bytes=Buffer.from(value);contents.set(p,bytes);
    return Object.freeze({path:p,bytes:bytes.length,sha256:sha(bytes)});
  });
  return {contents,record:Object.freeze({algorithm:'sha256',files:Object.freeze(files),sha256:sha(JSON.stringify(files))})};
}
export function assertVerifierInputsUnchanged(before,after) {
  invariant(before.sha256===after.sha256&&JSON.stringify(before.files)===JSON.stringify(after.files),'verifier_inputs_changed');
}

export class WriteBudget {
  constructor(limits=LIMITS) { this.limits=limits;this.used=Object.fromEntries(Object.keys(limits).map(k=>[k,0]));this.stopped=null;this.finalUsed=false; }
  reserve(area,n) {
    if(this.stopped) fail(this.stopped);
    if(!Object.hasOwn(this.limits,area)||!Number.isSafeInteger(n)||n<0) fail('invalid_reservation');
    if(this.used[area]+n>this.limits[area]) {this.stopped=`quota_${area}`;fail(this.stopped);}
    this.used[area]+=n;
  }
  get total() {return Object.values(this.used).reduce((a,b)=>a+b,0);}
  consumeFinal(n){
    invariant(!this.finalUsed,'final_already_used');
    invariant(Number.isSafeInteger(n)&&n>=0&&n<=this.limits.final&&this.used.final===this.limits.final,'final_reservation');
    this.finalUsed=true;
  }
}

// Captured before instrumentation: only the quota writer is allowed to use these.
const io = Object.fromEntries(['mkdirSync','openSync','writeSync','closeSync','readFileSync','lstatSync','readdirSync']
  .map(k=>[k,fs[k].bind(fs)]));
export function claimApprovedRun(releaseRoot,budget,claimIO=io) {
  invariant(Object.keys(budget.limits).length===Object.keys(LIMITS).length&&
    Object.entries(LIMITS).every(([k,n])=>budget.limits[k]===n)&&
    budget.total===LIMITS.final&&budget.used.final===LIMITS.final&&!budget.stopped,'approval_budget');
  const root=path.resolve(releaseRoot,APPROVED_CONTINUATION.run);
  // mkdir without recursive is the atomic claim, shared by all processes. An
  // existing root, even empty or interrupted, permanently consumes this approval.
  // Do not check-then-create, remove the root, or fall back to another run ID.
  try{claimIO.mkdirSync(root);}catch(e){if(e.code==='EEXIST')fail('approval_already_consumed');throw e;}
  return new QuotaWriter(root,budget,claimIO);
}
export class QuotaWriter {
  constructor(root,budget,writerIO=io) {this.root=path.resolve(root);this.budget=budget;this.files=[];this.io=writerIO;}
  write(area,relative,bytes,{reserved=false}={}) {
    const target=path.resolve(this.root,relative);
    invariant(target.startsWith(this.root+path.sep),'write_outside_root');
    invariant(!relative.split(/[\\/]/).includes('..'),'write_parent_path');
    const data=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    if(reserved) {invariant(area==='final','final_size');this.budget.consumeFinal(data.length);}
    else this.budget.reserve(area,data.length);
    this.io.mkdirSync(path.dirname(target),{recursive:true});
    // writeFileSync internally looks up fs.openSync/writeSync again. Use the
    // captured primitives directly, only after the full reservation succeeds.
    const fd=this.io.openSync(target,'wx');
    try{
      let at=0;
      while(at<data.length){const n=this.io.writeSync(fd,data,at,data.length-at);invariant(n>0,'write_no_progress');at+=n;}
    }finally{this.io.closeSync(fd);}
    this.files.push({path:relative,area,bytes:data.length,sha256:sha(data)});
    return target;
  }
}

export function installNoWriteGuard() {
  const attempts=[],restore=[];
  const deny=name=>{attempts.push(name);fail(`unmanaged_write:${name}`);};
  const mutators=['writeFile','appendFile','write','writev','mkdir','mkdtemp','rm','rmdir','unlink','rename',
    'copyFile','cp','link','symlink','truncate','ftruncate','chmod','fchmod','lchmod','chown','fchown','lchown','utimes','futimes','lutimes'];
  for(const target of [fs,fs.promises]) for(const name of [...mutators,...mutators.map(n=>n+'Sync'),'createWriteStream']) {
    if(typeof target[name]!=='function')continue;
    const old=target[name];target[name]=()=>deny(name);restore.push(()=>{target[name]=old;});
  }
  const writable=flags=>typeof flags==='number' ? !!(flags&(fs.constants.O_WRONLY|fs.constants.O_RDWR|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_APPEND)) : /[wa+]/.test(flags??'r');
  for(const [target,name]of [[fs,'open'],[fs,'openSync'],[fs.promises,'open']]) {
    const old=target[name];target[name]=function(p,flags,...rest){
      if(writable(flags))deny(name);
      const result=old.call(this,p,flags,...rest);
      if(target===fs.promises)return result.then(h=>{
        for(const k of ['write','writev','writeFile','appendFile','truncate','chmod','chown','utimes','createWriteStream'])
          if(typeof h[k]==='function')h[k]=()=>deny(`FileHandle.${k}`);
        return h;
      });
      return result;
    };restore.push(()=>{target[name]=old;});
  }
  syncBuiltinESMExports();
  return {attempts,restore(){for(const r of restore.reverse())r();syncBuiltinESMExports();}};
}

export function validateReleaseVersions(manifest,pkg,lock) {
  invariant(pkg.version===RELEASE_VERSION&&manifest.targetVersion===RELEASE_VERSION&&
    manifest.verificationVersion===RELEASE_VERSION,'version_change');
  invariant(lock?.version===RELEASE_VERSION&&lock.packages?.['']?.version===RELEASE_VERSION&&
    lock.name===pkg.name&&lock.packages[''].name===pkg.name,'lock_version_binding');
}
export function validateManifest(manifest,pkg,lock) {
  const files=manifest.files;
  invariant(Array.isArray(files)&&files.length===227&&new Set(files).size===227,'manifest_count');
  invariant(files.every((f,i)=>typeof f==='string'&&/^build\/[A-Za-z0-9_/.-]+\.js$/.test(f)&&!f.split('/').includes('..')&&(!i||files[i-1]<f)),'manifest_paths');
  invariant(sha(files.join('\n')+'\n')===PATH_HASH&&manifest.pathsSha256===PATH_HASH,'manifest_hash');
  invariant(JSON.stringify(pkg.files)===JSON.stringify(files),'package_files');
  validateReleaseVersions(manifest,pkg,lock);
  for(const f of manifest.requiredShared)invariant(files.includes(f),'shared_missing');
  for(const f of manifest.excluded)invariant(!files.includes(f),'excluded_present');
  for(const f of [pkg.main,...Object.values(pkg.bin??{})])invariant(files.includes(f),'entry_outside_manifest');
  invariant(!pkg.browser&&!pkg.bundleDependencies&&!pkg.bundledDependencies,'unsupported_package_surface');
  return files;
}

export function checkTsDiagnostics(diagnostics,emitSkipped=false,errorCategory=1) {
  invariant(!diagnostics.some(d=>d.category===errorCategory),'typescript_error');
  invariant(!emitSkipped,'typescript_emit_skipped');
}

// Single gzip member. Raw DEFLATE consumption binds the trailer to that member,
// instead of allowing gunzip's concatenated-member behavior.
export async function decodeSingleGzip(input,limit=8*MiB) {
  invariant(Buffer.isBuffer(input)&&input.length<=8*MiB,'compressed_limit');
  invariant(input.length>=18&&input[0]===31&&input[1]===139&&input[2]===8&&input[3]===0,'gzip_header');
  const compressed=input.subarray(10,-8),parts=[];let size=0;
  const decoder=createInflateRaw({chunkSize:16384});
  await new Promise((resolve,reject)=>{
    decoder.on('data',chunk=>{
      if(size+chunk.length>limit){decoder.destroy(new Error('inflated_limit'));return;}
      size+=chunk.length;parts.push(chunk);
    });
    decoder.once('error',reject);decoder.once('end',resolve);decoder.end(compressed);
  });
  invariant(decoder.bytesWritten===compressed.length,'gzip_trailing_or_concatenated');
  const raw=Buffer.concat(parts,size);
  invariant(crc32(raw)===input.readUInt32LE(input.length-8),'gzip_crc');
  invariant(raw.length===input.readUInt32LE(input.length-4),'gzip_isize');
  return raw;
}

const zero=bytes=>bytes.every(b=>b===0);
function field(bytes) {
  const end=bytes.indexOf(0),value=end<0?bytes:bytes.subarray(0,end);
  invariant(value.every(b=>b>=32&&b<=126),'tar_field_encoding');
  if(end>=0)invariant(zero(bytes.subarray(end)),'tar_field_padding');
  return value.toString('ascii');
}
function octal(bytes) {
  // Buffer's ASCII decoder clears high bits. Reject unsupported encodings on
  // raw bytes first, including base-256, signs and non-octal digits.
  invariant(bytes.every(b=>b===0||b===32||b>=48&&b<=55),'tar_number');
  invariant(/^ *[0-7]*[\x00 ]*$/.test(bytes.toString('ascii')),'tar_number');
  const value=bytes.toString('ascii').replace(/[\x00 ]+$/,'').replace(/^ +/,'');
  invariant(/^[0-7]*$/.test(value),'tar_number');const n=value?Number.parseInt(value,8):0;
  invariant(Number.isSafeInteger(n)&&n>=0,'tar_number');return n;
}
export function parseTar(raw,expected) {
  invariant(raw.length<=8*MiB,'inflated_limit');
  const files=new Map(),seen=new Set(),directories=new Set(['package/']);
  for(const name of expected.keys()) {let p=name;while(p.includes('/')){p=p.slice(0,p.lastIndexOf('/'));directories.add(p+'/');}}
  let at=0,ended=false;
  while(at+512<=raw.length) {
    const header=raw.subarray(at,at+512);
    if(zero(header)) {
      invariant(at+1024<=raw.length&&zero(raw.subarray(at+512,at+1024)),'tar_end');
      invariant(zero(raw.subarray(at+1024)),'tar_trailing');ended=true;break;
    }
    for(const [start,end]of [[100,108],[108,116],[116,124],[136,148],[329,337],[337,345]])octal(header.subarray(start,end));
    let checksum=0;for(let i=0;i<512;i++)checksum+=i>=148&&i<156?32:header[i];
    invariant(checksum===octal(header.subarray(148,156)),'tar_checksum');
    invariant(header.subarray(257,263).equals(Buffer.from('ustar\0'))&&header.subarray(263,265).toString()==='00','tar_format');
    const prefix=field(header.subarray(345,500)),name=field(header.subarray(0,100));
    const full=prefix?prefix+'/'+name:name;
    invariant(!full.startsWith('/')&&!full.includes('\\')&&!full.split('/').some(p=>p==='.'||p==='..')&&!full.includes('//'),'tar_path');
    const size=octal(header.subarray(124,136)),type=header[156];
    invariant(type===0||type===48||type===53,'tar_type');
    const identity=type===53?full.replace(/\/$/,''):full;
    invariant(!seen.has(identity),'tar_duplicate');seen.add(identity);
    const start=at+512,next=start+Math.ceil(size/512)*512;
    invariant(next<=raw.length,'tar_truncated');
    invariant(zero(raw.subarray(start+size,next)),'tar_padding');
    if(type===53)invariant(size===0&&directories.has(full.endsWith('/')?full:full+'/'),'tar_directory');
    else {
      invariant(expected.has(full),'tar_unexpected');
      const value=raw.subarray(start,start+size),want=expected.get(full);
      invariant(size===want.bytes&&sha(value)===want.sha256,'tar_content');
      files.set(full,{start,size});
    }
    at=next;
  }
  invariant(ended,'tar_end');invariant(files.size===expected.size,'tar_missing');return files;
}

export async function inspectArtifact(bytes,expected) {
  const digest=sha(bytes),raw=await decodeSingleGzip(bytes),entries=parseTar(raw,expected);
  invariant(sha(bytes)===digest,'artifact_mutated');return {sha256:digest,raw,entries};
}
