import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,appendFile,rm,open,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {generateResearchEvidence,RESEARCH_EVIDENCE_MAX_FILE_BYTES} from '../../build/researchEvidenceGeneration.js';
import {compareResearchEvidence} from '../../build/researchEvidenceComparison.js';
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'generate-evidence-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const a=join(dir,'a'),b=join(dir,'b');
  await writeFile(a,'sample-data');await writeFile(b,'source-v1');
  return {dir,a,b};
}
test('real bytes produce independently verifiable descriptors and comparison-ready hashes',async t=>{
  const {dir,a,b}=await setup(t);
  const config={data:[{id:'input',path:a}],code:[{id:'code',path:b}],runner:[{id:'runner',path:b}],candidate_rule:[{id:'rule',path:a}],parameters:[{id:'params',path:a}],dependency_lockfile:b};
  const r=await generateResearchEvidence(config);
  assert.equal(r.files.find(f=>f.axis==='data').sha256,'sha256:'+createHash('sha256').update('sample-data').digest('hex'));
  assert.equal(r.environment.node_version,process.version);
  const digest=value=>'sha256:'+createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(r.manifest.data_sha256,digest({recipe:r.recipe,axis:'data',files:r.files.filter(f=>f.axis==='data')}));
  assert.equal(r.manifest.environment_sha256,digest({recipe:r.recipe,environment:r.environment}));
  assert.equal(r.candidateEligible,false);
  // Unpinned until now: flipping this to true broke no test, and it is the field that
  // decides whether a reader treats these digests as verified provenance rather than
  // as hashes of whatever files were pointed at.
  assert.equal(r.source_authenticated,false);
  assert.ok(!JSON.stringify(r).includes(dir));
  assert.ok(!JSON.stringify(r).includes('source-v1'));
  const again=await generateResearchEvidence(config);
  assert.deepEqual(r.manifest,again.manifest);
  await writeFile(b,'source-v2');
  const changed=await generateResearchEvidence(config);
  const diff=compareResearchEvidence({previous:r.manifest,current:changed.manifest});
  assert.deepEqual(diff.changed_fields,['code_sha256','runner_sha256','environment_sha256']);
  assert.equal(r.manifest.data_sha256,changed.manifest.data_sha256);
});
test('ordering and file relocation do not change scope hashes, IDs and raw bytes do',async t=>{
  const {dir,a,b}=await setup(t);
  const first=await generateResearchEvidence({code:[{id:'z',path:a},{id:'a',path:b}]});
  const moved=join(dir,'moved');await writeFile(moved,'sample-data');
  const second=await generateResearchEvidence({code:[{id:'a',path:b},{id:'z',path:moved}]});
  assert.deepEqual(first.manifest,second.manifest);
  const renamed=await generateResearchEvidence({code:[{id:'x',path:a},{id:'a',path:b}]});
  assert.notEqual(first.manifest.code_sha256,renamed.manifest.code_sha256);
  assert.equal(first.manifest.environment_sha256,null);
  assert.equal((await generateResearchEvidence({})).manifest.data_sha256,null);
});
test('strict inputs reject ambiguous scope, special files, symlinks and oversized files',async t=>{
  const {dir,a}=await setup(t);
  for(const config of [{code:[]},{code:[{id:'a',path:'relative'}]},{code:[{id:'a',path:a},{id:'a',path:a}]},{command:'secret'}])
    await assert.rejects(generateResearchEvidence(config));
  await assert.rejects(generateResearchEvidence({code:Array.from({length:21},(_,i)=>({id:`f${i}`,path:a}))}));
  await assert.rejects(generateResearchEvidence({data:[{id:'dir',path:dir}]}));
  const big=join(dir,'big');const handle=await open(big,'w');
  await handle.truncate(RESEARCH_EVIDENCE_MAX_FILE_BYTES+1);await handle.close();
  await assert.rejects(generateResearchEvidence({data:[{id:'big',path:big}]}),/byte limit/);
  const link=join(dir,'link');
  try {await symlink(a,link);}catch(e){if(e.code==='EPERM')return;throw e;}
  await assert.rejects(generateResearchEvidence({data:[{id:'link',path:link}]}),/non-symlink/);
});
test('symlinks are rejected before open, independently of O_NOFOLLOW',async t=>{
  const {dir,a}=await setup(t);
  const links=[join(dir,'existing-link'),join(dir,'dangling-link')];
  try {
    await symlink(a,links[0]);
    await symlink(join(dir,'missing'),links[1]);
  } catch(error) {
    if(process.platform==='win32' && error.code==='EPERM') {
      t.skip('Windows requires symlink privileges');return;
    }
    throw error;
  }
  const original=fsPromises.open;
  let opens=0;
  // This stub cannot enforce O_NOFOLLOW: only the pre-open guard can pass.
  fsPromises.open=async()=>{opens++;throw new Error('unexpected open');};
  syncBuiltinESMExports();
  try {
    for(const path of links) {
      await assert.rejects(generateResearchEvidence({data:[{id:'link',path}]}),
        {code:'EVIDENCE_INPUT_NOT_REGULAR'});
    }
    assert.equal(opens,0);
  } finally {fsPromises.open=original;syncBuiltinESMExports();}
});
test('runtime capture never dumps environment secret values',async t=>{
  const {a}=await setup(t);
  const key='EVIDENCE_SECRET_SENTINEL', saved=process.env[key];
  process.env[key]='do-not-print-this-secret-719823';
  try {
    const r=await generateResearchEvidence({dependency_lockfile:a});
    assert.ok(!JSON.stringify(r).includes(process.env[key]));
    assert.ok(!JSON.stringify(r).includes(key));
  } finally {if(saved===undefined)delete process.env[key];else process.env[key]=saved;}
});
test('exact per-file limit is accepted but repeated files count toward total budget',async t=>{
  const {dir}=await setup(t);
  const big=join(dir,'boundary'),h=await open(big,'w');
  await h.truncate(RESEARCH_EVIDENCE_MAX_FILE_BYTES);await h.close();
  const r=await generateResearchEvidence({data:[{id:'boundary',path:big}]});
  assert.equal(r.files[0].bytes,RESEARCH_EVIDENCE_MAX_FILE_BYTES);
  await assert.rejects(generateResearchEvidence({data:Array.from({length:5},(_,i)=>({id:`f${i}`,path:big}))}),/byte budget exceeded/);
});
test('growth during a read aborts generation',async t=>{
  const {a}=await setup(t);
  const probe=await open(a,'r'),proto=Object.getPrototypeOf(probe),original=proto.read;
  await probe.close();let reads=0;
  proto.read=async function(...args){const r=await original.apply(this,args);if(++reads===1)await appendFile(a,'growth');return r;};
  try {await assert.rejects(generateResearchEvidence({data:[{id:'a',path:a}]}),/during read/);}
  finally {proto.read=original;}
});
test('second pass detects an earlier file changed after its first read',async t=>{
  const {a,b}=await setup(t);
  const probe=await open(a,'r'),proto=Object.getPrototypeOf(probe),original=proto.read;
  await probe.close();let reads=0;
  proto.read=async function(...args){const r=await original.apply(this,args);if(++reads===3)await writeFile(a,'changed-after-first-pass');return r;};
  try {await assert.rejects(generateResearchEvidence({data:[{id:'a',path:a},{id:'b',path:b}]}),{code:'EVIDENCE_INPUT_CHANGED'});}
  finally {proto.read=original;}
});
