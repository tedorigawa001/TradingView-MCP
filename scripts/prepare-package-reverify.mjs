#!/usr/bin/env node
// A only: no import of the execution runner, compiler or npm pack implementation.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {installNoWriteGuard,sha,invariant} from './package-verifier-core.mjs';
import {REVERIFY_CAMPAIGN as C,PREP_LIMITS,campaignHash,assertCampaign,verifyPriorRecords,
  readRegular,claimPreparation,captureApprovedInputs,assertApprovedInputsEqual} from './package-approval.mjs';
import {loadExecutionAuthorization} from './package-approval.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url)),json=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
assertCampaign();const prior=verifyPriorRecords(repo);
invariant(!fs.existsSync(path.join(repo,'.release-work',C.run)),'execution_b_already_claimed');
const writer=claimPreparation(repo),budget=writer.budget,root=writer.root;
let guard;
const report={schema:'package-preparation-status-v2',preparation:C.preparation,run:C.run,status:'running',
  version:C.releaseVersion,
  campaign_sha256:campaignHash(),approval_b:'pending',prior_records:prior,campaign:C,
  inputs_digest_encoding:'sha256-base64-per-file; sha256-hex-for-manifest',checks:{}};
async function child(args){
  return new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,args,{cwd:repo,
      env:{PATH:path.dirname(process.execPath),TMPDIR:root,NODE_DISABLE_COMPILE_CACHE:'1'},stdio:['ignore','pipe','pipe']});
    const parts=[];let length=0,overflow=false;
    for(const stream of [p.stdout,p.stderr])stream.on('data',b=>{
      length+=b.length;if(length>12*1024){overflow=true;p.kill();}else parts.push(b);
    });
    p.once('error',reject);p.once('close',code=>overflow?reject(Error('test_output_limit')):resolve({code,output:Buffer.concat(parts).toString('utf8')}));
  });
}
try{
  guard=installNoWriteGuard();
  const approvalABytes=json({schema:'package-approval-v1',phase:'A',approval_kind:'A',decision:'approved',
    preparation:C.preparation,run:C.run,campaign_sha256:campaignHash(),campaign:C,
    source:'explicit user approval in this chat (2026-11-27)',approval_b_granted:false,
    instruction:'0.1.49を0.1.48と同じ手順でリリースし、新しい64 MiBキャンペーンを使うことを承認。0.1.49への版更新とprep01の準備・読戻しまで。承認B消費・ビルド・pack・コミット・公開・DOT起動は禁止。'});
  writer.write('approval_a','approval-a.json',approvalABytes);report.approval_a_sha256=sha(approvalABytes);
  // Freeze the exact candidate BEFORE any test subprocess. Save these same
  // bytes, then bind both post-test and pre-readback checks to this candidate.
  const inputs=captureApprovedInputs(repo);
  writer.write('inputs','input-manifest.json',inputs.bytes);report.input_manifest_sha256=inputs.sha256;
  report.input_manifest_bytes=inputs.bytes.length;
  report.input_counts=Object.fromEntries(inputs.manifest.groups.map(g=>[g.name,g.files.length]));
  const tests=await child(['--test','--test-reporter=spec','test/unit/packageDistribution.test.mjs','test/unit/packageApproval.test.mjs']);
  const testRecord={schema:'package-preparation-tests-v2',...tests,input_manifest_sha256_before:inputs.sha256,
    input_manifest_sha256_after:null,inputs_match:false,syntax_files:0};
  const syntax=['scripts/package-verifier-core.mjs','scripts/package-approval.mjs','scripts/prepare-package-reverify.mjs',
    'scripts/verify-package.mjs','test/unit/packageDistribution.test.mjs','test/unit/packageApproval.test.mjs'];
  const count=Number(tests.output.match(/\btests (\d+)\b/)?.[1]);
  try{
    invariant(tests.code===0&&/\bfail 0\b/.test(tests.output)&&/\bskipped 0\b/.test(tests.output),'synthetic_tests_failed');
    invariant(count>=28,'synthetic_test_count');
    for(const p of syntax){const result=await child(['--check',p]);invariant(result.code===0&&result.output==='','syntax_check_failed:'+p);testRecord.syntax_files++;}
  }catch(e){testRecord.validation_error=e.message;}
  let afterTests;
  try{afterTests=captureApprovedInputs(repo);testRecord.input_manifest_sha256_after=afterTests.sha256;testRecord.inputs_match=inputs.sha256===afterTests.sha256;}
  catch(e){testRecord.input_error=e.message;}
  const testResultsBytes=json(testRecord);writer.write('tests','test-results.json',testResultsBytes);report.test_results_sha256=sha(testResultsBytes);
  if(testRecord.validation_error)throw Error(testRecord.validation_error);
  if(testRecord.input_error)throw Error(testRecord.input_error);
  assertApprovedInputsEqual(inputs.manifest,afterTests.manifest);
  invariant(testRecord.inputs_match,'test_input_hash_changed');
  report.checks.synthetic_tests={passed:count,failed:0,skipped:0};report.checks.syntax_files=syntax.length;
  const records=writer.files.map(f=>{
    const b=readRegular(path.join(root,f.path),PREP_LIMITS[f.area]);
    invariant(b.length===f.bytes&&sha(b)===f.sha256,'preparation_readback');return {...f};
  });
  assertApprovedInputsEqual(inputs.manifest,captureApprovedInputs(repo).manifest);
  invariant(JSON.stringify(verifyPriorRecords(repo))===JSON.stringify(prior),'prior_records_changed');
  invariant(!fs.existsSync(path.join(repo,'.release-work',C.run)),'execution_b_claimed');
  invariant(!fs.existsSync(path.join(root,'approval-b.json')),'approval_b_created');
  let bBlocked=false;
  try{loadExecutionAuthorization(repo);}catch(e){bBlocked=e.code==='ENOENT'&&e.path===path.join(root,'approval-b.json');}
  invariant(bBlocked,'approval_b_not_blocked');
  invariant(guard.attempts.length===0,'unmanaged_preparation_write');
  writer.write('readback','readback.json',json({records,
    excludes:'This readback record and the final status; final status is independently read back to stdout.',
    input_manifest_sha256:inputs.sha256,inputs_unchanged:true,execution_b_claimed:false,approval_b_created:false,unmanaged_write_attempts:0}));
  report.checks.inputs_unchanged=true;report.checks.execution_b_claimed=false;report.checks.approval_b_created=false;
  report.checks.prior_records_unchanged=true;
  report.checks.missing_b_receipt_blocks_execution=true;
  report.checks.unmanaged_write_attempts=0;report.status='ready_for_review';
}catch(e){report.status='failed';report.reason=e.message;report.unmanaged_write_attempts=guard?.attempts??[];}
finally{
  try{
    report.capacity={limits:PREP_LIMITS,charged:{...budget.used},prep_reserved:C.prepReserved,
      known_content_bytes_before_final:writer.files.reduce((n,f)=>n+f.bytes,0),
      note:'Known bytes exclude final status; the whole 512 KiB stays reserved, including the separate future B slot.',
      cumulative_reserved_before_b:C.priorReserved+C.prepReserved,
      maximum_cumulative_with_b:C.priorReserved+C.prepReserved+C.runLimit,
      release_stages_reserved:C.releaseStagesReserved,
      fixed_margin:C.fixedMargin,additional_unallocated:C.unallocated,campaign_cap:C.campaignCap,protected_765_bytes_used:0};
    const bytes=json(report);writer.write('final','status.json',bytes,{reserved:true});
    const saved=readRegular(path.join(root,'status.json'),PREP_LIMITS.final);invariant(saved.equals(bytes),'final_status_readback');
    console.log(JSON.stringify({status:report.status,reason:report.reason,preparation:C.preparation,
      status_path:path.join(root,'status.json'),status_bytes:saved.length,status_sha256:sha(saved),
      input_manifest_sha256:report.input_manifest_sha256,input_manifest_bytes:report.input_manifest_bytes,
      known_content_bytes:writer.files.reduce((n,f)=>n+f.bytes,0),prep_reserved:C.prepReserved,
      approval_b:'pending',execution_b_claimed:false,checks:report.checks}));
    if(report.status!=='ready_for_review')process.exitCode=1;
  }finally{guard?.restore();}
}
