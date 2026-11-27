import test from 'node:test';
import assert from 'node:assert/strict';
import {gzipSync} from 'node:zlib';
import fs,{readFileSync} from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import * as verifier from '../../scripts/package-verifier-core.mjs';
import {WriteBudget,QuotaWriter,installNoWriteGuard,validateManifest,checkTsDiagnostics,decodeSingleGzip,parseTar,inspectArtifact,sha,MiB,invariant} from '../../scripts/package-verifier-core.mjs';

const VIRTUAL_WORK=path.resolve('/virtual/work');
const VIRTUAL_REPO=path.resolve('/virtual/repo');

function archive(entries,{end=true,trailing=Buffer.alloc(0)}={}) {
  const chunks=[];
  for(const {name,data=Buffer.alloc(0),type='0'} of entries){
    const h=Buffer.alloc(512);h.write(name,0,100,'ascii');h.write('0000644\0',100);h.write('0000000\0',108);h.write('0000000\0',116);
    h.write(data.length.toString(8).padStart(11,'0')+'\0',124);h.write('00000000000\0',136);h.fill(32,148,156);h.write(type,156);h.write('ustar\0',257);h.write('00',263);
    const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148);
    chunks.push(h,data,Buffer.alloc((512-data.length%512)%512));
  }
  if(end)chunks.push(Buffer.alloc(1024));chunks.push(trailing);return Buffer.concat(chunks);
}
const body=Buffer.from('export const value=1;\n'),name='package/build/a.js';
const expected=()=>new Map([[name,{bytes:body.length,sha256:sha(body)}]]);

function checksum(raw){
  raw.fill(32,148,156);
  const sum=raw.subarray(0,512).reduce((a,b)=>a+b,0);
  raw.write(sum.toString(8).padStart(6,'0')+'\0 ',148);return raw;
}

test('tar rejects high-bit and unsupported numeric encodings before ASCII conversion',()=>{
  for(const [offset,length] of [[100,8],[108,8],[116,8],[124,12],[136,12],[148,8],[329,8],[337,8]]){
    for(const byte of [0x80,0xb0,0xff,0x38,0x2d,0x09]){
      const raw=archive([{name,data:body}]);raw[offset]=byte;
      if(offset!==148)checksum(raw);
      assert.throws(()=>parseTar(raw,expected()),/tar_number/,`field ${offset}, byte ${byte}`);
    }
    const raw=archive([{name,data:body}]);raw.fill(0,offset,offset+length);raw[offset+1]=48;
    if(offset!==148)checksum(raw);
    assert.throws(()=>parseTar(raw,expected()),/tar_number/,`embedded terminator ${offset}`);
  }
});
test('tar accepts supported ASCII octal zero, spaces and NUL suffix boundaries',()=>{
  for(const representation of [Buffer.alloc(8),Buffer.alloc(8,32),Buffer.from('0000000\0'),Buffer.from('  0000\0 ')]){
    const raw=archive([{name,data:body}]);representation.copy(raw,108);checksum(raw);
    assert.equal(parseTar(raw,expected()).size,1);
  }
  const raw=archive([{name,data:body}]);raw.fill(32,124,136);
  raw.write(body.length.toString(8),125,'ascii');checksum(raw);
  assert.equal(parseTar(raw,expected()).size,1);
});

function virtualClaims(){
  const roots=new Set(),files=new Map();let contentWrites=0;
  const io={mkdirSync(p,options){
    if(!options?.recursive){
      if(roots.has(p))throw Object.assign(new Error('exists'),{code:'EEXIST'});
      roots.add(p);
    }
  },openSync(p){if(files.has(p))throw Object.assign(new Error('exists'),{code:'EEXIST'});files.set(p,Buffer.alloc(0));return p;},
  writeSync(fd,b,offset,n){contentWrites++;files.set(fd,Buffer.concat([files.get(fd),b.subarray(offset,offset+n)]));return n;},closeSync(){}};
  return {io,roots,files,get contentWrites(){return contentWrites;}};
}
function freshBudget(){const b=new WriteBudget();b.reserve('final',64*1024);return b;}
test('one approved run ID is consumed atomically across independent budgets and writers',()=>{
  assert.equal(typeof verifier.claimApprovedRun,'function');
  assert.equal(verifier.APPROVED_CONTINUATION.run,'package-2026-11-18T05-28-09-196Z-b7db5ad2-0329-41ef-ae73-42f9ee93afd8');
  const v=virtualClaims(),first=verifier.claimApprovedRun('/virtual/releases',freshBudget(),v.io);
  first.write('logs','report/reservation.json','approved');const written=v.contentWrites;
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',freshBudget(),v.io),/approval_already_consumed/);
  assert.equal(v.contentWrites,written);assert.equal(v.roots.size,1);
});
test('pre-existing, empty and interrupted approval roots cannot be reused or automatically replaced',()=>{
  assert.equal(typeof verifier.claimApprovedRun,'function');
  const v=virtualClaims();
  const interrupted={...v.io,openSync(){throw Error('simulated_io_failure');}};
  const w=verifier.claimApprovedRun('/virtual/releases',freshBudget(),interrupted);
  assert.throws(()=>w.write('logs','report/reservation.json','approved'),/simulated_io_failure/);
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',freshBudget(),v.io),/approval_already_consumed/);
  assert.equal(v.contentWrites,0);assert.equal(v.files.size,0);
});
test('historical approval roots are consumed even without a new marker or result file',()=>{
  const v=virtualClaims();v.roots.add(path.resolve('/virtual/releases',verifier.APPROVED_CONTINUATION.run));
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',freshBudget(),v.io),/approval_already_consumed/);
  assert.equal(v.contentWrites,0);assert.equal(v.files.size,0);
});
test('approval claims require the unchanged 49 MiB budget and do not retry IO failures',()=>{
  const a=verifier.APPROVED_CONTINUATION;
  assert.ok(Object.isFrozen(a));assert.equal(a.campaignCeiling,64*MiB);
  assert.equal(a.carriedHold+a.newRunCeiling+a.unusedMargin,a.campaignCeiling);
  const v=virtualClaims(),tooLarge=new WriteBudget({...verifier.LIMITS,logs:MiB});tooLarge.reserve('final',64*1024);
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',tooLarge,v.io),/approval_budget/);
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',new WriteBudget(),v.io),/approval_budget/);
  assert.equal(v.roots.size,0);
  let attempts=0;
  assert.throws(()=>verifier.claimApprovedRun('/virtual/releases',freshBudget(),{...v.io,mkdirSync(){attempts++;throw Object.assign(Error('denied'),{code:'EACCES'});}}),/denied/);
  assert.equal(attempts,1);assert.equal(v.roots.size,0);assert.equal(v.contentWrites,0);
});
test('competing claims have a single winner and do not allocate a new run ID',async()=>{
  assert.equal(typeof verifier.claimApprovedRun,'function');
  const v=virtualClaims(),results=await Promise.allSettled([0,1].map(async()=>verifier.claimApprovedRun('/virtual/releases',freshBudget(),v.io)));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal(results.find(r=>r.status==='rejected').reason.message,'approval_already_consumed');
  assert.deepEqual([...v.roots],[path.resolve('/virtual/releases',verifier.APPROVED_CONTINUATION.run)]);
});
test('verifier identity binds runner, core, tests and allowlist before and after use',()=>{
  assert.equal(typeof verifier.captureVerifierInputs,'function');
  const inputs=new Map([
    ['scripts/verify-package.mjs',Buffer.from('runner')],
    ['scripts/package-verifier-core.mjs',Buffer.from('core')],
    ['scripts/package-approval.mjs',Buffer.from('approval')],
    ['scripts/prepare-package-reverify.mjs',Buffer.from('prepare')],
    ['test/unit/packageDistribution.test.mjs',Buffer.from('tests')],
    ['test/unit/packageApproval.test.mjs',Buffer.from('approval-tests')],
    ['packaging/npm-js-0.1.49.json',Buffer.from('paths')]
  ]);
  const before=verifier.captureVerifierInputs(p=>inputs.get(p));
  assert.deepEqual(before.record.files.map(f=>f.path),[...inputs.keys()].sort());
  for(const f of before.record.files){assert.equal(f.bytes,inputs.get(f.path).length);assert.equal(f.sha256,sha(inputs.get(f.path)));}
  assert.equal(before.record.sha256,sha(JSON.stringify(before.record.files)));
  assert.doesNotThrow(()=>verifier.assertVerifierInputsUnchanged(before.record,verifier.captureVerifierInputs(p=>inputs.get(p)).record));
  for(const p of inputs.keys()){
    const changed=new Map(inputs);changed.set(p,Buffer.from('X'.repeat(inputs.get(p).length)));
    assert.throws(()=>verifier.assertVerifierInputsUnchanged(before.record,verifier.captureVerifierInputs(p=>changed.get(p)).record),/verifier_inputs_changed/);
  }
  inputs.get('scripts/verify-package.mjs')[0]^=1;
  assert.equal(before.contents.get('scripts/verify-package.mjs').toString(),'runner');
  assert.throws(()=>verifier.captureVerifierInputs(()=>undefined),/verifier_input_bytes/);
});

// Run the actual runner's finalization body with memory-only IO. The bootstrap,
// approval claim, compiler and pack workflow are never executed by these tests.
function finalizeFixture({eventError=null,identity='same',priorFailure=false,paths=path}={}){
  const source=readFileSync(new URL('../../scripts/verify-package.mjs',import.meta.url),'utf8');
  const marker='\n} finally {',start=source.lastIndexOf(marker),end=source.lastIndexOf('}');
  assert.ok(start>=0&&end>start,'runner finalization block');
  const root=paths===path?VIRTUAL_WORK:paths.resolve('C:\\ci','/virtual/work'),
    repo=paths===path?VIRTUAL_REPO:paths.resolve('C:\\ci','/virtual/repo'),v=virtualClaims(),budget=freshBudget();
  let Writer=QuotaWriter;
  if(paths!==path){
    const core=readFileSync(new URL('../../scripts/package-verifier-core.mjs',import.meta.url),'utf8');
    const a=core.indexOf('export class QuotaWriter {'),b=core.indexOf('\nexport function installNoWriteGuard');
    assert.ok(a>=0&&b>a);
    Writer=vm.runInNewContext(core.slice(a,b).replace('export ','')+'\nQuotaWriter',
      {path:paths,Buffer,sha,invariant,io:v.io},{timeout:1000});
  }
  const writer=new Writer(root,budget,v.io),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
  const read=p=>{
    if(identity==='missing')throw Error('simulated_missing_input');
    return Buffer.from(p+(identity==='changed'&&p===paths.join(repo,'scripts/verify-package.mjs')?'changed':''));
  };
  const before=verifier.captureVerifierInputs(p=>Buffer.from(paths.join(repo,p))).record;
  const report={status:priorFailure?'failed':'passed',phase:priorFailure?'earlier_check':'complete',
    ...(priorFailure?{reason:'earlier_failure'}:{}),checks:{},verifier_inputs:{before,after:null}};
  const processState={};let eventAttempts=0,restores=0;
  const note=event=>{
    eventAttempts++;
    if(eventError){if(eventError==='quota_logs')budget.stopped=eventError;throw Error(eventError);}
    writer.write('logs','report/pass-event.json',json({event}));
  };
  vm.runInNewContext(source.slice(start+marker.length,end),{
    report,captureVerifierInputs:verifier.captureVerifierInputs,assertVerifierInputsUnchanged:verifier.assertVerifierInputsUnchanged,
    path:paths,repo,read,note,budget,writer,json,sha,root,
    carriedHold:524288,newRunCeiling:49*MiB,releaseStagesReserved:2*MiB,unusedMargin:6*MiB,additionalUnallocated:6815744,
    guard:{restore(){restores++;}},console:{log(){}},process:processState
  },{timeout:1000});
  const saved=JSON.parse(v.files.get(paths.join(root,'report/result.json')));
  assert.equal(writer.files.filter(f=>f.area==='final').length,1);
  assert.equal(budget.finalUsed,true);assert.equal(restores,1);
  return {report:saved,eventAttempts,exitCode:processState.exitCode,files:v.files,root};
}
for(const eventError of ['quota_logs','simulated_event_io_failure'])test(`pass-event save failure preserves matching verifier hashes: ${eventError}`,()=>{
  const {report,eventAttempts,exitCode,files}=finalizeFixture({eventError});
  assert.equal(report.status,'failed');assert.equal(report.phase,'pass_event_recording');assert.equal(report.reason,eventError);
  assert.equal(report.checks.verifier_inputs_unchanged,true);
  assert.equal(report.verifier_inputs.before.sha256,report.verifier_inputs.after.sha256);
  assert.equal(eventAttempts,1);assert.equal(exitCode,1);
  assert.equal(files.has(path.join(VIRTUAL_WORK,'report/pass-event.json')),false);
});
test('matching verifier hashes and successful event save retain a passing final report',()=>{
  const {report,eventAttempts,exitCode,files}=finalizeFixture();
  assert.equal(report.status,'passed');assert.equal(report.phase,'complete');assert.equal(report.checks.verifier_inputs_unchanged,true);
  assert.equal(eventAttempts,1);assert.equal(exitCode,undefined);
  assert.equal(JSON.parse(files.get(path.join(VIRTUAL_WORK,'report/pass-event.json'))).event,'verification_passed');
});
test('changed verifier hashes fail identity verification and suppress the pass event',()=>{
  const {report,eventAttempts,exitCode}=finalizeFixture({identity:'changed'});
  assert.equal(report.status,'failed');assert.equal(report.phase,'verifier_identity');assert.equal(report.reason,'verifier_inputs_changed');
  assert.equal(report.checks.verifier_inputs_unchanged,false);
  assert.notEqual(report.verifier_inputs.before.sha256,report.verifier_inputs.after.sha256);
  assert.equal(eventAttempts,0);assert.equal(exitCode,1);
});
test('missing verifier input fails identity verification without trying to save a pass event',()=>{
  const {report,eventAttempts,exitCode}=finalizeFixture({identity:'missing'});
  assert.equal(report.status,'failed');assert.equal(report.phase,'verifier_identity');assert.equal(report.reason,'simulated_missing_input');
  assert.equal(report.checks.verifier_inputs_unchanged,false);assert.equal(report.verifier_inputs.after,null);
  assert.equal(eventAttempts,0);assert.equal(exitCode,1);
});
test('an earlier failure remains failed even when the final identity check succeeds',()=>{
  const {report,eventAttempts,exitCode}=finalizeFixture({priorFailure:true});
  assert.equal(report.status,'failed');assert.equal(report.phase,'earlier_check');assert.equal(report.reason,'earlier_failure');
  assert.equal(report.checks.verifier_inputs_unchanged,true);assert.equal(eventAttempts,0);assert.equal(exitCode,1);
});
test('actual finalization and writer use Windows paths for success, identity drift and event failure',()=>{
  for(const options of [{},{identity:'changed'},{eventError:'simulated_event_io_failure'}]){
    const {report,root,files}=finalizeFixture({...options,paths:path.win32});
    assert.match(root,/^[A-Za-z]:\\/);
    assert.ok(files.has(path.win32.join(root,'report/result.json')));
    if(options.identity==='changed'){
      assert.equal(report.phase,'verifier_identity');assert.equal(report.checks.verifier_inputs_unchanged,false);
    }else{
      assert.equal(report.checks.verifier_inputs_unchanged,true);
      assert.equal(report.status,options.eventError?'failed':'passed');
    }
  }
});

test('fixed 227 paths add the Replay adoption modules to the published 0.1.48 paths',()=>{
  const m=JSON.parse(readFileSync(new URL('../../packaging/npm-js-0.1.49.json',import.meta.url))),p=JSON.parse(readFileSync(new URL('../../package.json',import.meta.url))),
    lock=JSON.parse(readFileSync(new URL('../../package-lock.json',import.meta.url))),
    previous=JSON.parse(readFileSync(new URL('../../packaging/npm-js-0.1.48.json',import.meta.url)));
  assert.equal(validateManifest(m,p,lock).length,227);
  assert.deepEqual(m.files,[...previous.files,'build/replayAdoptionCandidate.js','build/replayAdoptionReader.js'].sort());
  assert.deepEqual([m.excluded,m.requiredShared],[previous.excluded,previous.requiredShared]);
  for(const mutation of ['swap','missing','version','bin']){
    const a=structuredClone(m),b=structuredClone(p);
    if(mutation==='swap')a.files[0]='build/not-approved.js';
    if(mutation==='missing')b.files=b.files.slice(1);
    if(mutation==='version')b.version='0.1.48';
    if(mutation==='bin')b.bin.extra='build/not-approved.js';
    assert.throws(()=>validateManifest(a,b,lock));
  }
});
test('release candidate is fixed to 0.1.49 across package, lock and distribution metadata',()=>{
  assert.equal(verifier.RELEASE_VERSION,'0.1.49');
  assert.equal(verifier.DISTRIBUTION_MANIFEST,'packaging/npm-js-0.1.49.json');
  const pkg={name:'candidate',version:'0.1.49'},lock={name:'candidate',version:'0.1.49',packages:{'':{name:'candidate',version:'0.1.49'}}},
    manifest={targetVersion:'0.1.49',verificationVersion:'0.1.49'};
  verifier.validateReleaseVersions(manifest,pkg,lock);
  for(const version of ['0.1.48','0.1.50'])for(const field of ['package','lock','lockRoot','target','verification']){
    const p=structuredClone(pkg),l=structuredClone(lock),m=structuredClone(manifest);
    if(field==='package')p.version=version;if(field==='lock')l.version=version;if(field==='lockRoot')l.packages[''].version=version;
    if(field==='target')m.targetVersion=version;if(field==='verification')m.verificationVersion=version;
    assert.throws(()=>verifier.validateReleaseVersions(m,p,l),/version_change|lock_version_binding/);
  }
  assert.throws(()=>verifier.validateReleaseVersions(manifest,pkg,undefined),/lock_version_binding/);
  assert.throws(()=>verifier.validateReleaseVersions(manifest,pkg,{...lock,name:'other'}),/lock_version_binding/);
});
test('quota stops before the write callback, never refunds, and latches refusal',()=>{
  const b=new WriteBudget({source:3});let writes=0;
  const write=n=>{b.reserve('source',n);writes++;};write(3);
  assert.throws(()=>write(1),/quota_source/);assert.equal(writes,1);assert.equal(b.total,3);
  assert.throws(()=>write(0),/quota_source/);
});
test('reserved writes use captured primitives while unmanaged write opens remain refused',()=>{
  let opened=0,closed=0,content=Buffer.alloc(0);
  const virtualIO={mkdirSync(){},writeFileSync(){fs.openSync('/virtual/not-created','wx');},
    openSync(){opened++;return 1;},writeSync(_fd,b,offset,length){content=Buffer.concat([content,b.subarray(offset,offset+length)]);return length;},closeSync(){closed++;}};
  const b=new WriteBudget({negative:16}),writer=new QuotaWriter('/virtual',b,virtualIO),guard=installNoWriteGuard();
  try{
    assert.doesNotThrow(()=>writer.write('negative','control.txt','approved'));
    assert.equal(content.toString(),'approved');assert.equal(opened,1);assert.equal(closed,1);assert.equal(b.used.negative,8);
    assert.throws(()=>fs.openSync('/virtual/not-created','wx'),/unmanaged_write:openSync/);
  }finally{guard.restore();}
});
test('the pre-reserved final allowance can be consumed only once, even by separate writers',()=>{
  const virtual={mkdirSync(){},openSync(){return 1;},writeSync(_f,_b,_o,n){return n;},closeSync(){}};
  const b=new WriteBudget({final:16});b.reserve('final',16);
  new QuotaWriter('/virtual',b,virtual).write('final','first','ok',{reserved:true});
  assert.throws(()=>new QuotaWriter('/virtual',b,virtual).write('final','second','ok',{reserved:true}),/final_already_used/);
});
test('TypeScript errors and skipped emission are not success',()=>{
  checkTsDiagnostics([{category:0}],false);
  assert.throws(()=>checkTsDiagnostics([{category:1}],false),/typescript_error/);
  assert.throws(()=>checkTsDiagnostics([],true),/typescript_emit_skipped/);
});
for(const n of [8*MiB-1,8*MiB,8*MiB+1])test(`inflated boundary ${n}`,async()=>{
  const raw=Buffer.alloc(n),gz=gzipSync(raw);
  if(n>8*MiB)await assert.rejects(decodeSingleGzip(gz),/inflated_limit/);
  else assert.equal((await decodeSingleGzip(gz)).length,n);
});
test('compressed input is limited before decoding',async()=>{
  await assert.rejects(decodeSingleGzip(Buffer.alloc(8*MiB+1)),/compressed_limit/);
});
test('single gzip member accepted and trailer corruption refused',async()=>{
  const raw=archive([{name,data:body}]),gz=gzipSync(raw);assert.deepEqual(await decodeSingleGzip(gz),raw);
  const crc=Buffer.from(gz);crc[crc.length-8]^=1;await assert.rejects(decodeSingleGzip(crc),/gzip_crc/);
  const size=Buffer.from(gz);size[size.length-4]^=1;await assert.rejects(decodeSingleGzip(size),/gzip_isize/);
  await assert.rejects(decodeSingleGzip(gz.subarray(0,-1)));
});
test('concatenated gzip, even an empty second member, and trailing bytes are refused',async()=>{
  const gz=gzipSync(archive([{name,data:body}]));
  for(const suffix of [gzipSync(Buffer.alloc(0)),gzipSync(Buffer.from('hidden')),Buffer.from([0]),Buffer.from('junk')])
    await assert.rejects(decodeSingleGzip(Buffer.concat([gz,suffix])),/gzip_trailing_or_concatenated/);
  const flags=Buffer.from(gz);flags[3]=8;await assert.rejects(decodeSingleGzip(flags),/gzip_header/);
});
test('tar requires complete terminal blocks, permits zero padding only',()=>{
  const a=archive([{name,data:body}]);assert.equal(parseTar(a,expected()).size,1);
  assert.equal(parseTar(Buffer.concat([a,Buffer.alloc(512)]),expected()).size,1);
  assert.throws(()=>parseTar(archive([{name,data:body}],{end:false}),expected()),/tar_end/);
  assert.throws(()=>parseTar(a.subarray(0,-512),expected()),/tar_end/);
  assert.throws(()=>parseTar(Buffer.concat([a,Buffer.from('hidden')]),expected()),/tar_trailing/);
  assert.throws(()=>parseTar(Buffer.concat([a,a]),expected()),/tar_trailing/);
});
test('tar rejects missing, extra, duplicate, altered, linked and unsupported entries',()=>{
  assert.throws(()=>parseTar(archive([]),expected()),/tar_missing/);
  assert.throws(()=>parseTar(archive([{name:'package/build/canary.js',data:body}]),expected()),/tar_unexpected/);
  assert.throws(()=>parseTar(archive([{name,data:body},{name,data:body}]),expected()),/tar_duplicate/);
  assert.throws(()=>parseTar(archive([{name:'package/build',type:'5'},{name:'package/build/',type:'5'}]),expected()),/tar_duplicate/);
  assert.throws(()=>parseTar(archive([{name,data:Buffer.from('changed')}]),expected()),/tar_content/);
  for(const type of ['1','2','x','g','L'])assert.throws(()=>parseTar(archive([{name,data:body,type}]),expected()),/tar_type/);
  for(const p of ['../build/a.js','/package/build/a.js','package/../build/a.js','package//build/a.js','package\\build\\a.js'])
    assert.throws(()=>parseTar(archive([{name:p,data:body}]),expected()),/tar_path/);
  const h=archive([{name,data:body}]);h[100]^=1;assert.throws(()=>parseTar(h,expected()),/tar_checksum/);
});
test('artifact validation binds exactly the bytes used for extraction',async()=>{
  const gz=gzipSync(archive([{name,data:body}])),r=await inspectArtifact(gz,expected());assert.equal(r.sha256,sha(gz));
  const e=r.entries.get(name);assert.deepEqual(r.raw.subarray(e.start,e.start+e.size),body);
});
