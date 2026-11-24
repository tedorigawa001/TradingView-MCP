import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {WriteBudget,QuotaWriter,LIMITS,VERIFIER_INPUT_PATHS,RELEASE_VERSION,DISTRIBUTION_MANIFEST,validateManifest,MiB,sha,invariant} from './package-verifier-core.mjs';

const KiB=1024;
// 0.1.48 runs in a new 64 MiB campaign, approved on 2026-11-24. Preparation and
// the B run keep the earlier limits; releaseStagesReserved is held for the later
// npm login, preflight, publication and readback records and is not usable here.
// The 0.1.47 campaign (64 MiB) reached 19,992,266 bytes through B and used
// 311,296 of its 2 MiB release-stage share. Its records are bound below as
// hash-checked history and carry no reservation.
export const REVERIFY_CAMPAIGN=Object.freeze({
  schema:'package-reverify-campaign-v2',
  releaseVersion:RELEASE_VERSION,
  preparation:'package-2026-11-24-reverify-0.1.48-prep01',run:'package-2026-11-24-reverify-0.1.48',
  priorReserved:0,prepReserved:512*KiB,runLimit:49*MiB,releaseStagesReserved:2*MiB,
  fixedMargin:6*MiB,unallocated:6815744,campaignCap:64*MiB,protected765Used:0
});
// The finished 0.1.47 release: a ready preparation, the passed B verification
// that produced the artifact, and the anonymous readback (verify01) that
// confirmed the registry serves that same artifact.
export const PREVIOUS_RELEASE=Object.freeze({version:'0.1.47',preparation:'package-2026-11-21-reverify-0.1.47-prep01',
  run:'package-2026-11-21-reverify-0.1.47',artifactBytes:851982,
  artifactSha256:'625fbbae18924987691f23e3cbbc7d2efa58e859826a5dcc0b3d9734d239c1aa',
  campaignCap:64*MiB,campaignReservedAfterB:19992266,releaseStageCumulative:311296});
export const PRIOR_RECORDS=Object.freeze([
  Object.freeze({path:'package-2026-11-21-reverify-0.1.47-prep01/status.json',
    sha256:'fcc5c5dbb2ee767abd567a49520756c50412495f2aa8246b6fd3635c1b964e86',reserved:0,role:'previous_release_preparation'}),
  Object.freeze({path:'package-2026-11-21-reverify-0.1.47/report/result.json',
    sha256:'b1e70f16ff110ae50dfdc0c8e8c2e0a458bec798d56b6c4740eb5f71f6e1a728',reserved:0,role:'previous_release_verification'}),
  Object.freeze({path:'package-2026-11-22-publish-0.1.47-verify01/verification-readback.json',
    sha256:'904dc3445b6be84259f364ad8d3784dabb29f1928b4bfcdbd94bdbd64e97b6fd',reserved:0,role:'previous_release_publication_readback'}),
  Object.freeze({path:'package-2026-11-22-publish-0.1.47-verify01/verification-status.json',
    sha256:'2a37b996b0b79e3562b10fac01869d8504caa6d668bdc806afc62168688c03ec',reserved:0,role:'previous_release_publication'})
]);
export const PREP_LIMITS=Object.freeze({inputs:448*KiB,approval_a:8*KiB,approval_b:8*KiB,
  tests:16*KiB,readback:16*KiB,final:16*KiB});
export const campaignHash=()=>sha(JSON.stringify(REVERIFY_CAMPAIGN));
export function assertCampaign(c=REVERIFY_CAMPAIGN){
  invariant(JSON.stringify(c)===JSON.stringify(REVERIFY_CAMPAIGN),'campaign_changed');
  invariant(c.releaseVersion===RELEASE_VERSION,'campaign_version');
  invariant(c.priorReserved===0&&PRIOR_RECORDS.every(r=>r.reserved===0),'prior_total');
  invariant(c.prepReserved===Object.values(PREP_LIMITS).reduce((a,b)=>a+b,0),'prep_total');
  invariant(c.runLimit===Object.values(LIMITS).reduce((a,b)=>a+b,0),'run_total');
  invariant(c.priorReserved+c.prepReserved+c.runLimit+c.releaseStagesReserved+c.fixedMargin+c.unallocated===c.campaignCap,'campaign_total');
  invariant(c.protected765Used===0,'protected_capacity');return c;
}
const sameStat=(a,b)=>['dev','ino','size','mtimeMs','ctimeMs'].every(k=>a[k]===b[k]);
function readDescriptor(file,max,consume){
  const first=fs.lstatSync(file);
  invariant(first.isFile()&&!first.isSymbolicLink()&&first.size<=max,'input_shape_or_size');
  const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
    const before=fs.fstatSync(fd);invariant(sameStat(first,before),'input_changed');
    const result=consume(fd,before.size);
    invariant(sameStat(before,fs.fstatSync(fd))&&sameStat(before,fs.lstatSync(file)),'input_changed');return result;
  }finally{fs.closeSync(fd);}
}
export function readRegular(file,max=32*MiB){
  return readDescriptor(file,max,(fd,n)=>{const b=fs.readFileSync(fd);invariant(b.length===n,'input_changed');return b;});
}
function fileRow(root,relative,max=32*MiB){
  return readDescriptor(path.join(root,relative),max,(fd,n)=>{
    const hash=createHash('sha256'),buffer=Buffer.alloc(64*KiB);let at=0;
    while(at<n){const count=fs.readSync(fd,buffer,0,Math.min(buffer.length,n-at),at);invariant(count>0,'input_short_read');hash.update(buffer.subarray(0,count));at+=count;}
    return [relative,n,hash.digest('base64')];
  });
}
function filesUnder(root,select=()=>true,{skipBin=false}={}){
  const shape=fs.lstatSync(root);invariant(shape.isDirectory()&&!shape.isSymbolicLink(),'input_root_shape');
  const files=[];
  function walk(dir){for(const e of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,e.name),relative=path.relative(root,full).split(path.sep).join('/');
    if(skipBin&&relative.split('/').includes('.bin'))continue;
    invariant(!e.isSymbolicLink(),'input_symlink');
    if(e.isDirectory())walk(full);else{invariant(e.isFile(),'input_file_type');if(select(relative))files.push(relative);}
  }}
  walk(root);return files.sort();
}
// The compiler reads workspace declarations/metadata; its only workspace JS
// implementation is TypeScript. The unpacked v3 verifier also executes zod.
// npm is frozen in full, including non-code data. .bin shims are not invoked.
const workspaceInput=p=>/\.(?:[cm]?ts|json)$/.test(p)||
  p.startsWith('typescript/lib/')&&p.endsWith('.js')||p.startsWith('zod/')&&/\.[cm]?js$/.test(p);
export function captureApprovedInputs(repo){
  repo=path.resolve(repo);
  validateManifest(parseRecord(readRegular(path.join(repo,DISTRIBUTION_MANIFEST)),32*MiB),
    parseRecord(readRegular(path.join(repo,'package.json')),32*MiB),
    parseRecord(readRegular(path.join(repo,'package-lock.json')),32*MiB));
  const source=filesUnder(path.join(repo,'src')).map(p=>'src/'+p);
  invariant(source.length===231&&source.every(p=>p.endsWith('.ts')),'source_set_changed');
  const extras=['package.json','package-lock.json','tsconfig.json','README.md','LICENSE','packaging/PACKAGE_VERIFICATION.md',
    ...VERIFIER_INPUT_PATHS,'test/helpers/committedConnectionFixture.mjs','test/helpers/committedPagingFixture.mjs',
    'test/fixtures/committed-v3-connection-golden.json'];
  const roots={repo,workspace:path.join(repo,'node_modules'),
    npm:path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm'),node:path.dirname(process.execPath)};
  const paths={repo:[...new Set([...source,...extras])].sort(),
    workspace:filesUnder(roots.workspace,workspaceInput,{skipBin:true}),npm:filesUnder(roots.npm),node:[path.basename(process.execPath)]};
  const groups=Object.entries(roots).map(([name,root])=>({name,root,
    files:paths[name].map(p=>fileRow(root,p,name==='node'?256*MiB:32*MiB))}));
  const manifest={schema:'package-input-manifest-v1',digestEncoding:'base64',
    preparation:REVERIFY_CAMPAIGN.preparation,run:REVERIFY_CAMPAIGN.run,campaign:REVERIFY_CAMPAIGN,
    policy:'repo-inputs+workspace-types-json-typescript-zod+npm-full+node-v1',groups};
  const bytes=Buffer.from(JSON.stringify(manifest)+'\n');invariant(bytes.length<=PREP_LIMITS.inputs,'input_manifest_limit');
  return {manifest,bytes,sha256:sha(bytes)};
}
export function assertApprovedInputsEqual(expected,current){
  invariant(JSON.stringify(expected)===JSON.stringify(current),'approved_inputs_changed');
}
// The previous release is history: bound by hash, checked for the chain that
// links its preparation, B verification and publication readback, and never
// charged to this campaign. `values` maps each PRIOR_RECORDS path to its bytes.
export function validatePreviousRelease(values){
  const [prepRecord,resultRecord,readbackRecord,statusRecord]=PRIOR_RECORDS,P=PREVIOUS_RELEASE;
  const parse=r=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(values.get(r.path)));
  const prep=parse(prepRecord),result=parse(resultRecord),readback=parse(readbackRecord),status=parse(statusRecord);
  invariant(prep.schema==='package-preparation-status-v2'&&prep.status==='ready_for_review'&&prep.version===P.version&&
    prep.preparation===P.preparation&&prep.run===P.run,'previous_preparation');
  invariant(result.status==='passed'&&result.phase==='complete'&&result.version===P.version&&result.run===P.run&&
    result.approval_b?.preparation_status_sha256===prepRecord.sha256&&
    result.approval_b.input_manifest_sha256===prep.input_manifest_sha256&&
    result.artifact?.bytes===P.artifactBytes&&result.artifact.sha256===P.artifactSha256&&
    result.quota?.campaign_reserved_upper===P.campaignReservedAfterB,'previous_verification');
  invariant(readback.verified===true&&readback.status==='verified'&&Array.isArray(readback.rows)&&
    readback.rows.some(r=>r.file==='verification-status.json'&&r.sha256===statusRecord.sha256),'previous_publication_readback');
  const verdicts=Object.values(status.verdicts??{});
  invariant(status.status==='verified'&&status.reason===null&&status.publication_performed===false&&
    status.release_stage_cumulative===P.releaseStageCumulative&&verdicts.length===4&&verdicts.every(v=>v==='confirmed')&&
    status.published?.version===P.version&&status.published.tarball_sha256===P.artifactSha256,'previous_publication');
}
export function verifyPriorRecords(repo,read=readRegular){
  const values=new Map();
  const records=PRIOR_RECORDS.map(r=>{
    const bytes=read(path.join(repo,'.release-work',r.path),64*KiB);
    invariant(sha(bytes)===r.sha256,'prior_record_changed');
    values.set(r.path,bytes);
    return {...r,bytes:bytes.length};
  });
  validatePreviousRelease(values);
  return records;
}
function parseRecord(bytes,max){
  invariant(Buffer.isBuffer(bytes)&&bytes.length<=max,'approval_record_size');
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
}
const authorizations=new WeakMap();
export function authorizeExecutionB({manifestBytes,statusBytes,receiptBytes,approvalABytes,testResultsBytes,currentInputs}){
  assertCampaign();
  const receipt=parseRecord(receiptBytes,PREP_LIMITS.approval_b),status=parseRecord(statusBytes,PREP_LIMITS.final),
    manifest=parseRecord(manifestBytes,PREP_LIMITS.inputs);
  invariant(receipt.schema==='package-approval-v1'&&receipt.phase==='B'&&receipt.decision==='approved','approval_b_required');
  invariant(receipt.run===REVERIFY_CAMPAIGN.run&&receipt.preparation===REVERIFY_CAMPAIGN.preparation,'approval_id_binding');
  invariant(receipt.campaign_sha256===campaignHash(),'approval_budget_binding');
  invariant(receipt.input_manifest_sha256===sha(manifestBytes)&&receipt.preparation_status_sha256===sha(statusBytes),'approval_hash_binding');
  invariant(status.schema==='package-preparation-status-v2'&&status.status==='ready_for_review'&&status.preparation===REVERIFY_CAMPAIGN.preparation&&status.run===REVERIFY_CAMPAIGN.run&&
    status.input_manifest_sha256===sha(manifestBytes)&&status.campaign_sha256===campaignHash(),'preparation_not_ready');
  invariant(Buffer.isBuffer(approvalABytes),'approval_a_required');
  invariant(status.approval_a_sha256===sha(approvalABytes),'approval_a_hash_binding');
  const approvalA=parseRecord(approvalABytes,PREP_LIMITS.approval_a);
  invariant(approvalA.schema==='package-approval-v1'&&approvalA.phase==='A'&&approvalA.decision==='approved'&&
    approvalA.preparation===REVERIFY_CAMPAIGN.preparation&&approvalA.run===REVERIFY_CAMPAIGN.run&&
    approvalA.campaign_sha256===campaignHash()&&JSON.stringify(approvalA.campaign)===JSON.stringify(REVERIFY_CAMPAIGN)&&
    approvalA.approval_b_granted===false,'approval_a_binding');
  invariant(Buffer.isBuffer(testResultsBytes),'test_evidence_required');
  invariant(status.test_results_sha256===sha(testResultsBytes),'test_evidence_hash_binding');
  const tests=parseRecord(testResultsBytes,PREP_LIMITS.tests);
  const count=typeof tests.output==='string'?Number(tests.output.match(/\btests (\d+)\b/)?.[1]):NaN;
  invariant(tests.schema==='package-preparation-tests-v2'&&tests.code===0&&tests.inputs_match===true&&
    tests.input_manifest_sha256_before===sha(manifestBytes)&&tests.input_manifest_sha256_after===sha(manifestBytes)&&
    tests.syntax_files===6&&count>=28&&/\bfail 0\b/.test(tests.output)&&/\bskipped 0\b/.test(tests.output)&&
    !Object.hasOwn(tests,'validation_error')&&!Object.hasOwn(tests,'input_error'),'test_input_binding');
  invariant(status.checks?.inputs_unchanged===true&&status.checks.syntax_files===tests.syntax_files&&
    status.checks.synthetic_tests?.passed===count&&status.checks.synthetic_tests.failed===0&&status.checks.synthetic_tests.skipped===0,'test_status_binding');
  invariant(manifest.schema==='package-input-manifest-v1'&&manifest.run===REVERIFY_CAMPAIGN.run&&
    manifest.preparation===REVERIFY_CAMPAIGN.preparation&&JSON.stringify(manifest.campaign)===JSON.stringify(REVERIFY_CAMPAIGN),'input_manifest_binding');
  assertApprovedInputsEqual(manifest,currentInputs);
  const files=new Map(manifest.groups.flatMap(g=>g.files.map(([p,n,h])=>[path.resolve(g.root,p),{bytes:n,sha256:h}])));
  const token=Object.freeze({run:receipt.run,input_manifest_sha256:sha(manifestBytes),
    approval_b_sha256:sha(receiptBytes),preparation_status_sha256:sha(statusBytes),
    approval_a_sha256:sha(approvalABytes),test_results_sha256:sha(testResultsBytes)});
  authorizations.set(token,{manifest,files});return token;
}
export function loadExecutionAuthorization(repo,{read=readRegular,capture=captureApprovedInputs,verifyPrior=verifyPriorRecords}={}){
  const root=path.join(repo,'.release-work',REVERIFY_CAMPAIGN.preparation);
  // Missing B authorization fails before hashing tools or claiming the run ID.
  const receiptBytes=read(path.join(root,'approval-b.json'),PREP_LIMITS.approval_b);
  const manifestBytes=read(path.join(root,'input-manifest.json'),PREP_LIMITS.inputs);
  const statusBytes=read(path.join(root,'status.json'),PREP_LIMITS.final);
  const approvalABytes=read(path.join(root,'approval-a.json'),PREP_LIMITS.approval_a);
  const testResultsBytes=read(path.join(root,'test-results.json'),PREP_LIMITS.tests);
  verifyPrior(repo);
  return authorizeExecutionB({receiptBytes,manifestBytes,statusBytes,approvalABytes,testResultsBytes,currentInputs:capture(repo).manifest});
}
export function assertApprovedInputBytes(token,file,bytes){
  const expected=authorizations.get(token)?.files.get(path.resolve(file));
  invariant(expected&&bytes.length===expected.bytes&&createHash('sha256').update(bytes).digest('base64')===expected.sha256,'snapshot_input_changed');
}
export function assertExecutionInputs(token,current){
  const value=authorizations.get(token);invariant(value,'approval_b_required');assertApprovedInputsEqual(value.manifest,current);
}
export function assertLoadedInputs(token,loaded){
  const value=authorizations.get(token);invariant(value,'approval_b_required');
  invariant(loaded.every(p=>value.files.has(path.resolve(p))),'loaded_input_outside_manifest');
}
const mkdir=fs.mkdirSync.bind(fs);
export function claimExecutionB(releaseRoot,budget,token,writerIO){
  const value=authorizations.get(token);invariant(value,'approval_b_required');assertCampaign();
  const repo=value.manifest.groups.find(g=>g.name==='repo').root;
  invariant(path.resolve(releaseRoot)===path.resolve(repo,'.release-work'),'approval_root_binding');
  invariant(Object.keys(budget.limits).length===Object.keys(LIMITS).length&&Object.entries(LIMITS).every(([k,n])=>budget.limits[k]===n)&&
    budget.total===LIMITS.final&&budget.used.final===LIMITS.final&&!budget.stopped,'approval_budget');
  const root=path.resolve(releaseRoot,REVERIFY_CAMPAIGN.run);
  try{(writerIO?.mkdirSync??mkdir)(root);}catch(e){if(e.code==='EEXIST')throw Error('approval_already_consumed');throw e;}
  return new QuotaWriter(root,budget,writerIO);
}
export function claimPreparation(repo,writerIO){
  assertCampaign();const budget=new WriteBudget(PREP_LIMITS);budget.reserve('final',PREP_LIMITS.final);
  const root=path.join(repo,'.release-work',REVERIFY_CAMPAIGN.preparation);
  try{(writerIO?.mkdirSync??mkdir)(root);}catch(e){if(e.code==='EEXIST')throw Error('preparation_already_consumed');throw e;}
  const writer=new QuotaWriter(root,budget,writerIO),write=writer.write.bind(writer);
  const outputs={'input-manifest.json':'inputs','approval-a.json':'approval_a','test-results.json':'tests',
    'readback.json':'readback','status.json':'final'};
  writer.write=(area,relative,...args)=>{
    invariant(area!=='approval_b','approval_b_write_not_authorized');
    invariant(outputs[relative]===area,'preparation_output_not_approved');return write(area,relative,...args);
  };
  return writer;
}
