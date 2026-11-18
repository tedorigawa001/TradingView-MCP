import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import * as approval from '../../scripts/package-approval.mjs';
import {WriteBudget,sha,MiB,invariant} from '../../scripts/package-verifier-core.mjs';
import {REVERIFY_CAMPAIGN as C,PREP_LIMITS,assertCampaign,campaignHash,assertApprovedInputsEqual,
  authorizeExecutionB,claimExecutionB,claimPreparation,assertApprovedInputBytes,assertExecutionInputs,assertLoadedInputs,
  verifyPriorRecords,PRIOR_RECORDS,loadExecutionAuthorization} from '../../scripts/package-approval.mjs';

const bytes=v=>Buffer.from(JSON.stringify(v)+'\n');
const VIRTUAL_REPO=path.resolve('/virtual/repo');
const VIRTUAL_RELEASES=path.join(VIRTUAL_REPO,'.release-work');
function fixture(repoRoot=VIRTUAL_REPO){
  const body=Buffer.from('approved source'),manifest={schema:'package-input-manifest-v1',digestEncoding:'base64',
    preparation:C.preparation,run:C.run,campaign:C,policy:'synthetic',
    groups:[{name:'repo',root:repoRoot,files:[['src/a.ts',body.length,createHash('sha256').update(body).digest('base64')]]}]};
  const manifestBytes=bytes(manifest),approvalA={schema:'package-approval-v1',phase:'A',decision:'approved',
    preparation:C.preparation,run:C.run,campaign:C,campaign_sha256:campaignHash(),approval_b_granted:false};
  const approvalABytes=bytes(approvalA),tests={schema:'package-preparation-tests-v2',code:0,
    output:'tests 41\nfail 0\nskipped 0\n',syntax_files:6,
    input_manifest_sha256_before:sha(manifestBytes),input_manifest_sha256_after:sha(manifestBytes),inputs_match:true};
  const testResultsBytes=bytes(tests),status={schema:'package-preparation-status-v2',status:'ready_for_review',preparation:C.preparation,run:C.run,
    input_manifest_sha256:sha(manifestBytes),campaign_sha256:campaignHash(),
    approval_a_sha256:sha(approvalABytes),test_results_sha256:sha(testResultsBytes),
    checks:{inputs_unchanged:true,syntax_files:6,synthetic_tests:{passed:41,failed:0,skipped:0}}};
  const statusBytes=bytes(status),receipt={schema:'package-approval-v1',phase:'B',decision:'approved',preparation:C.preparation,run:C.run,
    campaign_sha256:campaignHash(),input_manifest_sha256:sha(manifestBytes),preparation_status_sha256:sha(statusBytes)};
  return {body,manifest,status,receipt,approvalA,tests,args:()=>({manifestBytes,statusBytes,receiptBytes:bytes(receipt),
    approvalABytes,testResultsBytes,currentInputs:structuredClone(manifest)})};
}
function rebindStatus(f,change){
  const args=f.args(),statusBytes=bytes({...f.status,...change});
  return {...args,statusBytes,receiptBytes:bytes({...f.receipt,preparation_status_sha256:sha(statusBytes)})};
}
function virtual(){
  const roots=new Set(),files=new Map();let writes=0;
  const io={mkdirSync(p,opts){if(opts?.recursive)return;if(roots.has(p))throw Object.assign(Error('exists'),{code:'EEXIST'});roots.add(p);},
    openSync(p){assert.ok(!files.has(p));files.set(p,Buffer.alloc(0));return p;},
    writeSync(p,b,at,n){writes++;files.set(p,Buffer.concat([files.get(p),b.subarray(at,at+n)]));return n;},closeSync(){}};
  return {roots,files,io,get writes(){return writes;}};
}
const budget=()=>{const b=new WriteBudget();b.reserve('final',64*1024);return b;};
test('84 MiB campaign accounts for prior reservations, preparation, B and both margins',()=>{
  assertCampaign();assert.equal(C.campaignCap,84*MiB);assert.equal(C.campaignCap-64*MiB,20*MiB);
  assert.equal(C.priorReserved,29206331);assert.equal(C.priorReserved+C.prepReserved,29730619);
  assert.equal(C.priorReserved+C.prepReserved+C.runLimit,81110843);
  assert.equal(C.fixedMargin,6*MiB);assert.equal(C.unallocated,678085);
  assert.equal(C.releaseVersion,'0.1.46');assert.equal(C.preparation,'package-2026-11-18-reverify-r02-prep02');
  assert.equal(Object.values(PREP_LIMITS).reduce((a,b)=>a+b,0),512*1024);
  for(const key of ['priorReserved','prepReserved','runLimit','fixedMargin','unallocated','campaignCap','protected765Used'])
    assert.throws(()=>assertCampaign({...C,[key]:C[key]+1}),/campaign_changed/);
});
test('A claims only its preparation ID and remains consumed after an empty/interrupted start',()=>{
  const v=virtual(),writer=claimPreparation(VIRTUAL_REPO,v.io);
  assert.deepEqual([...v.roots],[path.join(VIRTUAL_RELEASES,C.preparation)]);
  assert.equal(v.roots.has(path.join(VIRTUAL_RELEASES,C.run)),false);
  assert.equal(writer.budget.used.approval_b,0);
  assert.throws(()=>claimPreparation(VIRTUAL_REPO,v.io),/preparation_already_consumed/);assert.equal(v.writes,0);
});
test('preparation bucket overrun stops before IO and cannot borrow the B receipt slot',()=>{
  const v=virtual(),writer=claimPreparation(VIRTUAL_REPO,v.io);
  assert.throws(()=>writer.write('approval_a','approval-a.json',Buffer.alloc(PREP_LIMITS.approval_a+1)),/quota_approval_a/);
  assert.equal(v.writes,0);assert.equal(writer.budget.used.approval_b,0);
  assert.throws(()=>writer.write('approval_b','approval-b.json','x'),/approval_b_write_not_authorized/);
});
test('A writer refuses the reserved future B receipt and any unapproved output name',()=>{
  const v=virtual(),writer=claimPreparation(VIRTUAL_REPO,v.io);
  assert.throws(()=>writer.write('approval_b','approval-b.json','{}'),/approval_b_write_not_authorized/);
  assert.throws(()=>writer.write('tests','extra-log.txt','x'),/preparation_output_not_approved/);
  assert.equal(v.writes,0);assert.equal(v.files.size,0);assert.equal(writer.budget.used.approval_b,0);
});
test('A receipt, missing B receipt and forged tokens cannot claim B',()=>{
  const f=fixture(),v=virtual();f.receipt.phase='A';
  assert.throws(()=>authorizeExecutionB(f.args()),/approval_b_required/);
  assert.throws(()=>authorizeExecutionB({...f.args(),receiptBytes:undefined}),/approval_record_size/);
  assert.throws(()=>claimExecutionB(VIRTUAL_RELEASES,budget(),{},v.io),/approval_b_required/);
  assert.equal(v.roots.size,0);assert.equal(v.writes,0);
});
test('B binds the exact preparation, run, campaign and both saved record hashes',()=>{
  for(const [field,value,reason]of [['run','other','approval_id_binding'],['preparation','other','approval_id_binding'],
    ['campaign_sha256','0'.repeat(64),'approval_budget_binding'],['input_manifest_sha256','0'.repeat(64),'approval_hash_binding'],
    ['preparation_status_sha256','0'.repeat(64),'approval_hash_binding'],['decision','pending','approval_b_required']]){
    const f=fixture();f.receipt[field]=value;assert.throws(()=>authorizeExecutionB(f.args()),new RegExp(reason));
  }
});
test('failed or mismatched A status cannot become B authorization',()=>{
  for(const change of [{status:'failed'},{run:'other'},{preparation:'other'},{input_manifest_sha256:'bad'},{campaign_sha256:'bad'}]){
    const f=fixture(),statusBytes=bytes({...f.status,...change});f.receipt.preparation_status_sha256=sha(statusBytes);
    assert.throws(()=>authorizeExecutionB({...f.args(),statusBytes}),/preparation_not_ready/);
  }
});
test('input changes, additions, missing files, path and tool-root changes reject B before a claim',()=>{
  for(const change of [m=>m.groups[0].files[0][2]='bad',m=>m.groups[0].files.push(['extra',0,'bad']),
    m=>m.groups[0].files=[],m=>m.groups[0].files[0][0]='other',m=>m.groups[0].root='/other']){
    const f=fixture(),args=f.args();change(args.currentInputs);
    assert.throws(()=>authorizeExecutionB(args),/approved_inputs_changed/);
  }
});
test('valid B authorization claims only its fixed root, once across fresh budgets',()=>{
  const f=fixture(),token=authorizeExecutionB(f.args()),v=virtual();
  const writer=claimExecutionB(VIRTUAL_RELEASES,budget(),token,v.io);
  assert.equal(writer.root,path.join(VIRTUAL_RELEASES,C.run));
  assert.throws(()=>claimExecutionB(VIRTUAL_RELEASES,budget(),token,v.io),/approval_already_consumed/);
  assert.equal(v.roots.size,1);assert.equal(v.writes,0);
});
test('actual B claim and quota writer retain a Windows drive in memory-only IO',()=>{
  const paths=path.win32,repo=paths.resolve('C:\\ci','/virtual/repo'),releases=paths.join(repo,'.release-work');
  const f=fixture(repo),token=authorizeExecutionB(f.args()),v=virtual();
  const core=readFileSync(new URL('../../scripts/package-verifier-core.mjs',import.meta.url),'utf8');
  const source=readFileSync(new URL('../../scripts/package-approval.mjs',import.meta.url),'utf8');
  const writerStart=core.indexOf('export class QuotaWriter {'),writerEnd=core.indexOf('\nexport function installNoWriteGuard');
  const claimStart=source.indexOf('export function claimExecutionB('),claimEnd=source.indexOf('\nexport function claimPreparation(');
  assert.ok(writerStart>=0&&writerEnd>writerStart&&claimStart>=0&&claimEnd>claimStart);
  const code=core.slice(writerStart,writerEnd).replace('export ','')+'\n'+
    source.slice(claimStart,claimEnd).replace('export ','')+'\nclaimExecutionB';
  const claim=vm.runInNewContext(code,{path:paths,Buffer,sha,invariant,io:v.io,mkdir:v.io.mkdirSync,
    authorizations:new WeakMap([[token,{manifest:f.manifest}]]),assertCampaign,
    LIMITS:budget().limits,REVERIFY_CAMPAIGN:C},{timeout:1000});
  const writer=claim(releases,budget(),token,v.io);
  assert.equal(writer.root,paths.join(releases,C.run));assert.match(writer.root,/^C:\\/);
  writer.write('logs','report/control.json','approved');
  assert.equal(v.files.get(paths.join(writer.root,'report/control.json')).toString(),'approved');
  assert.throws(()=>claim(releases,budget(),token,v.io),/approval_already_consumed/);
});
test('B claim rejects other roots and altered write limits without touching IO',()=>{
  const f=fixture(),token=authorizeExecutionB(f.args()),v=virtual();
  assert.throws(()=>claimExecutionB('/other',budget(),token,v.io),/approval_root_binding/);
  const b=new WriteBudget({...budget().limits,logs:MiB});b.reserve('final',64*1024);
  assert.throws(()=>claimExecutionB(VIRTUAL_RELEASES,b,token,v.io),/approval_budget/);assert.equal(v.roots.size,0);
});
test('snapshot bytes and final input/tool checks remain bound after B preflight',()=>{
  const f=fixture(),token=authorizeExecutionB(f.args());
  const file=path.join(VIRTUAL_REPO,'src/a.ts');
  assertApprovedInputBytes(token,file,f.body);
  assert.throws(()=>assertApprovedInputBytes(token,file,Buffer.from('changed')),/snapshot_input_changed/);
  assert.throws(()=>assertApprovedInputBytes(token,path.join(VIRTUAL_REPO,'src/other.ts'),f.body),/snapshot_input_changed/);
  assertExecutionInputs(token,f.manifest);assertLoadedInputs(token,[file]);
  assert.throws(()=>assertLoadedInputs(token,[path.resolve('/virtual/unapproved.js')]),/loaded_input_outside_manifest/);
  const changed=structuredClone(f.manifest);changed.groups[0].files=[];
  assert.throws(()=>assertExecutionInputs(token,changed),/approved_inputs_changed/);
  assert.throws(()=>assertApprovedInputsEqual(f.manifest,changed),/approved_inputs_changed/);
});
test('approval input limits and strict UTF-8 fail closed',()=>{
  const f=fixture();
  for(const value of [Buffer.alloc(PREP_LIMITS.approval_b+1),Buffer.from([0xff])])
    assert.throws(()=>authorizeExecutionB({...f.args(),receiptBytes:value}));
});
test('old stop and successful reservation totals are fixed, and changed old records reject',()=>{
  assert.equal(PRIOR_RECORDS.reduce((n,r)=>n+r.reserved,0),C.priorReserved);
  assert.throws(()=>verifyPriorRecords('/virtual',()=>Buffer.from('changed')),/prior_record_changed/);
});
test('prep01 is an additional accounting-only carry, separate from the legacy success total',()=>{
  const success={status:'passed',quota:{cumulative_reserved:19244859,carried_hold:9*MiB,campaign_reserved_upper:28682043}},
    prep={schema:'package-preparation-status-v1',preparation:'package-2026-11-18-reverify-r02-prep01',run:C.run,
      campaign:{priorReserved:28682043,prepReserved:512*1024},
      capacity:{prep_reserved:512*1024,cumulative_reserved_before_b:29206331,protected_765_bytes_used:0}};
  assert.equal(typeof approval.validateHistoricalAccounting,'function');
  approval.validateHistoricalAccounting(success,prep);
  assert.equal(PRIOR_RECORDS[2].reserved,512*1024);assert.equal(PRIOR_RECORDS[2].role,'preparation_accounting_only');
  assert.notEqual(prep.preparation,C.preparation);
  for(const changed of [{...success,quota:{...success.quota,campaign_reserved_upper:29206331}},
    {...success,quota:{...success.quota,cumulative_reserved:19244858}}])
    assert.throws(()=>approval.validateHistoricalAccounting(changed,prep),/prior_accounting/);
  for(const changed of [{...prep,preparation:C.preparation},{...prep,schema:'package-preparation-status-v2'},
    {...prep,capacity:{...prep.capacity,prep_reserved:422237}},
    {...prep,campaign:{...prep.campaign,priorReserved:29206331}}])
    assert.throws(()=>approval.validateHistoricalAccounting(success,changed),/prior_preparation_accounting/);
});

test('B rejects missing or altered A bytes before an execution claim',()=>{
  const f=fixture();
  assert.throws(()=>authorizeExecutionB({...f.args(),approvalABytes:undefined}),/approval_a_required/);
  assert.throws(()=>authorizeExecutionB({...f.args(),approvalABytes:bytes({...f.approvalA,source:'changed'})}),/approval_a_hash_binding/);
});
test('B rejects invalid A phase, decision, IDs and budget even when the status hash is rebound',()=>{
  for(const change of [{schema:'other'},{phase:'B'},{decision:'pending'},{preparation:'other'},{run:'other'},
    {campaign_sha256:'bad'},{campaign:{...C,unallocated:C.unallocated+1}},{approval_b_granted:true}]){
    const f=fixture(),approvalABytes=bytes({...f.approvalA,...change}),args=rebindStatus(f,{approval_a_sha256:sha(approvalABytes)});
    assert.throws(()=>authorizeExecutionB({...args,approvalABytes}),/approval_a_binding/);
  }
});
test('B binds test-result bytes and the tested input digests to its exact manifest',()=>{
  const f=fixture();
  assert.throws(()=>authorizeExecutionB({...f.args(),testResultsBytes:undefined}),/test_evidence_required/);
  assert.throws(()=>authorizeExecutionB({...f.args(),testResultsBytes:bytes({...f.tests,extra:true})}),/test_evidence_hash_binding/);
  for(const change of [{schema:'other'},{code:1},{inputs_match:false},{syntax_files:0},
    {input_manifest_sha256_before:'bad'},{input_manifest_sha256_after:'bad'},
    {validation_error:'failed'},{input_error:'changed'}]){
    const testResultsBytes=bytes({...f.tests,...change}),args=rebindStatus(f,{test_results_sha256:sha(testResultsBytes)});
    assert.throws(()=>authorizeExecutionB({...args,testResultsBytes}),/test_input_binding/);
  }
});
test('legacy ready status without the A/test bindings cannot authorize B',()=>{
  const f=fixture(),args=rebindStatus(f,{schema:'package-preparation-status-v1',approval_a_sha256:undefined,test_results_sha256:undefined});
  assert.throws(()=>authorizeExecutionB(args),/preparation_not_ready/);
});
test('B refuses non-passing test summaries and mismatched ready-status checks',()=>{
  const f=fixture();
  for(const output of ['tests 0\nfail 0\nskipped 0\n','tests 41\nfail 1\nskipped 0\n',
    'tests 41\nfail 0\nskipped 1\n','no test summary',null]){
    const testResultsBytes=bytes({...f.tests,output}),args=rebindStatus(f,{test_results_sha256:sha(testResultsBytes)});
    assert.throws(()=>authorizeExecutionB({...args,testResultsBytes}),/test_input_binding/);
  }
  for(const checks of [{...f.status.checks,inputs_unchanged:false},{...f.status.checks,syntax_files:5},
    {...f.status.checks,synthetic_tests:{passed:42,failed:0,skipped:0}},
    {...f.status.checks,synthetic_tests:{passed:41,failed:1,skipped:0}},
    {...f.status.checks,synthetic_tests:{passed:41,failed:0,skipped:1}}])
    assert.throws(()=>authorizeExecutionB(rebindStatus(f,{checks})),/test_status_binding/);
});
test('the B loader reads and checks A and test evidence, including missing files',()=>{
  const f=fixture(),args=f.args(),root=path.join(VIRTUAL_RELEASES,C.preparation);
  const records=new Map([['approval-b.json',args.receiptBytes],['input-manifest.json',args.manifestBytes],
    ['status.json',args.statusBytes],['approval-a.json',args.approvalABytes],['test-results.json',args.testResultsBytes]]);
  const read=p=>{const b=records.get(path.basename(p));if(!b)throw Object.assign(Error('missing'),{code:'ENOENT',path:p});return b;};
  const io={read,capture:()=>({manifest:f.manifest}),verifyPrior:()=>[]};
  assert.equal(loadExecutionAuthorization(VIRTUAL_REPO,io).run,C.run);
  for(const name of ['approval-a.json','test-results.json']){
    const saved=records.get(name);records.delete(name);
    assert.throws(()=>loadExecutionAuthorization(VIRTUAL_REPO,io),e=>e.code==='ENOENT'&&e.path===path.join(root,name));
    records.set(name,saved);
  }
  records.set('approval-a.json',bytes({...f.approvalA,source:'changed'}));
  assert.throws(()=>loadExecutionAuthorization(VIRTUAL_REPO,io),/approval_a_hash_binding/);
});

async function prepareFixture({changeAfterTests=false,changeBeforeReadback=false,afterCaptureError=false,priorDrift=false,testCode=0}={}){
  const source=readFileSync(new URL('../../scripts/prepare-package-reverify.mjs',import.meta.url),'utf8');
  const start=source.indexOf('\ntry{\n  guard=installNoWriteGuard();');assert.ok(start>=0);
  const v=virtual(),repo=VIRTUAL_REPO,writer=claimPreparation(repo,v.io),root=writer.root;
  const report={schema:'package-preparation-status-v2',preparation:C.preparation,run:C.run,status:'running',checks:{}};
  let version='tested',captures=0;const processState={};
  const context={path,C,PREP_LIMITS,writer,root,repo,budget:writer.budget,report,process:processState,guard:undefined,sha,invariant,
    fs:{existsSync(){return false;}},json:bytes,campaignHash,
    installNoWriteGuard(){return {attempts:[],restore(){}};},
    async child(args){
      if(args[0]==='--test'){if(changeAfterTests)version='changed-after-tests';return {code:testCode,output:'tests 41\nfail 0\nskipped 0\n'};}
      return {code:0,output:''};
    },
    captureApprovedInputs(){
      captures++;if(afterCaptureError&&captures===2)throw Error('simulated_input_capture_failure');
      if(changeBeforeReadback&&captures>=3)version='changed-before-readback';
      const manifest={marker:version,groups:[{name:'repo',files:[['a.ts',1,'hash']]}]},b=bytes(manifest);
      return {manifest,bytes:b,sha256:sha(b)};
    },
    readRegular(p){assert.ok(v.files.has(p),p);return v.files.get(p);},assertApprovedInputsEqual,
    prior:[],verifyPriorRecords(){if(priorDrift)throw Error('prior_preparation_changed');return [];},
    loadExecutionAuthorization(){throw Object.assign(Error('missing B'),{code:'ENOENT',path:path.join(root,'approval-b.json')});},console:{log(){}}
  };
  await vm.runInNewContext('(async()=>{'+source.slice(start)+'})()',context,{timeout:1000});
  const record=name=>{const b=v.files.get(path.join(root,name));return b?JSON.parse(b):null;};
  assert.equal(v.roots.has(path.join(VIRTUAL_RELEASES,C.run)),false);
  assert.equal(v.files.has(path.join(root,'approval-b.json')),false);
  return {status:record('status.json'),tests:record('test-results.json'),manifest:record('input-manifest.json'),v,root,captures,exitCode:processState.exitCode};
}
test('preparation rejects input drift immediately after tests and records both digests',async()=>{
  const {status,tests,exitCode}=await prepareFixture({changeAfterTests:true});
  assert.equal(status.status,'failed');assert.equal(status.reason,'approved_inputs_changed');assert.equal(exitCode,1);
  assert.equal(tests.inputs_match,false);assert.notEqual(tests.input_manifest_sha256_before,tests.input_manifest_sha256_after);
});
test('stable preparation binds the saved manifest, A bytes and test results in its status',async()=>{
  const {status,tests,v,root,captures,exitCode}=await prepareFixture();
  assert.equal(status.status,'ready_for_review');assert.equal(exitCode,undefined);assert.ok(captures>=3);
  const digest=sha(v.files.get(path.join(root,'input-manifest.json')));
  assert.equal(tests.input_manifest_sha256_before,digest);assert.equal(tests.input_manifest_sha256_after,digest);assert.equal(tests.inputs_match,true);
  assert.equal(status.approval_a_sha256,sha(v.files.get(path.join(root,'approval-a.json'))));
  assert.equal(status.test_results_sha256,sha(v.files.get(path.join(root,'test-results.json'))));
});
test('post-test input drift before readback still blocks a ready preparation',async()=>{
  const {status,tests,exitCode}=await prepareFixture({changeBeforeReadback:true});
  assert.equal(tests.inputs_match,true);assert.equal(status.status,'failed');assert.equal(status.reason,'approved_inputs_changed');assert.equal(exitCode,1);
});
test('failed tests retain their input digests without becoming a ready preparation',async()=>{
  const {status,tests,exitCode}=await prepareFixture({testCode:1});
  assert.equal(status.status,'failed');assert.equal(status.reason,'synthetic_tests_failed');assert.equal(exitCode,1);
  assert.equal(tests.inputs_match,true);assert.equal(tests.validation_error,'synthetic_tests_failed');
  assert.equal(typeof tests.input_manifest_sha256_before,'string');assert.equal(tests.input_manifest_sha256_before,tests.input_manifest_sha256_after);
});
test('failed post-test capture retains the initial digest and explicitly missing final digest',async()=>{
  const {status,tests,exitCode}=await prepareFixture({afterCaptureError:true});
  assert.equal(status.status,'failed');assert.equal(status.reason,'simulated_input_capture_failure');assert.equal(exitCode,1);
  assert.equal(tests.inputs_match,false);assert.equal(tests.input_error,'simulated_input_capture_failure');
  assert.equal(typeof tests.input_manifest_sha256_before,'string');assert.equal(tests.input_manifest_sha256_after,null);
});
test('prior preparation changes block readiness even when the new inputs and tests match',async()=>{
  const {status,tests,exitCode}=await prepareFixture({priorDrift:true});
  assert.equal(tests.inputs_match,true);assert.equal(status.status,'failed');
  assert.equal(status.reason,'prior_preparation_changed');assert.equal(exitCode,1);
});
