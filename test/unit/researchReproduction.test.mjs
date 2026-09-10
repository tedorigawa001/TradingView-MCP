import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,appendFile,rm,stat,symlink,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fsPromises from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
import {reproduceResearch} from '../../build/researchReproduction.js';
import {backtestLedgerSchema,summarizeBacktestLedger} from '../../build/backtestLedger.js';
import {runResearchReproductionCli} from '../../build/researchReproductionCli.js';
const hash=x=>`sha256:${createHash('sha256').update(x).digest('hex')}`;
test('every declared command exists, is locked and is executable',async()=>{
  // The reproduction CLI shipped without a bin entry. Pinning that one name would have
  // caught it and nothing else: health and collect-first-seen were already absent from the
  // lockfile at the time. Whatever is declared gets checked, including the next one added.
  const pkg=JSON.parse(await readFile(new URL('../../package.json',import.meta.url),'utf8'));
  const lock=JSON.parse(await readFile(new URL('../../package-lock.json',import.meta.url),'utf8'));
  const declared=Object.entries(pkg.bin);
  assert.ok(declared.length>=6,'expected every CLI to stay declared');
  assert.equal(pkg.bin['tradingview-mcp-reproduce'],'build/researchReproductionCli.js');
  for (const [name,target] of declared) {
    assert.equal(lock.packages[''].bin[name],target,`${name} missing from the lockfile`);
    assert.match(await readFile(new URL(`../../${target}`,import.meta.url),'utf8'),
      /^#!\/usr\/bin\/env node\n/,`${name} target lacks a node shebang`);
  }
});
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'reproduction-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const ledger=backtestLedgerSchema.parse(JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json',import.meta.url),'utf8')));
  const parameters={artifact_id:hash(JSON.stringify(ledger)),round_trip_cost_bps:1};
  const config={task:'backtest_ledger_summary_v1',ledger_file:join(dir,'ledger'),parameters_file:join(dir,'parameters'),expected_result_sha256:hash(JSON.stringify(summarizeBacktestLedger(ledger,parameters)))};
  await writeFile(config.ledger_file,JSON.stringify(ledger));await writeFile(config.parameters_file,JSON.stringify(parameters));
  return {dir,config,ledger,parameters};
}
test('reproduces fixed summary and binds consumed bytes without publishing returns or paths',async t=>{
  const {config,dir}=await fixture(t);const r=await reproduceResearch(config);
  assert.equal(r.status,'reproduced');assert.equal(r.actual_result_sha256,config.expected_result_sha256);
  assert.deepEqual(r.evidence_before.manifest,r.evidence_after.manifest);
  assert.equal(r.evidence_before.files.find(f=>f.axis==='data').sha256,hash(await readFile(config.ledger_file)));
  assert.equal(r.candidateEligible,false);assert.equal(r.oos_execution_authorized,false);
  assert.equal(r.evidence_before.manifest.candidate_rule_sha256,null);
  assert.equal(JSON.stringify(r).includes(dir),false);assert.equal('overall' in r,false);
  // Not writing a usage record is defensible only because the metrics never leave. Nesting
  // the summary under any key kept `'overall' in r` false and published all of them.
  for (const key of ['overall','profit_factor','mean_net_bps','ledger_records','comparison'])
    assert.equal(JSON.stringify(r).includes(`"${key}"`),false,`summary key ${key} escaped`);
  assert.equal(r.actual_result_sha256,'sha256:096811860e7519197b2b95ee2a3ed6d4e252e51ae32d75b886cefc1ed4446565');
});
test('staging sync failure leaves no final report and retry succeeds',async t=>{
  const {config,dir}=await fixture(t),input=join(dir,'config'),output=join(dir,'report');
  await writeFile(input,JSON.stringify(config));
  const args=['--input',input,'--output',output,'--confirm-local-read'];
  const probe=await open(input,'r'),proto=Object.getPrototypeOf(probe),original=proto.sync;
  await probe.close();
  proto.sync=async()=>{throw new Error('synthetic sync failure');};
  try {await assert.rejects(runResearchReproductionCli(args),/synthetic sync failure/);}
  finally {proto.sync=original;}
  await assert.rejects(stat(output),{code:'ENOENT'});
  assert.equal((await runResearchReproductionCli(args)).status,'reproduced');
});
test('changed cost yields mismatch; changed data cannot silently rebind artifact ID',async t=>{
  const {config,parameters,ledger}=await fixture(t);
  await writeFile(config.parameters_file,JSON.stringify({...parameters,round_trip_cost_bps:2}));
  assert.equal((await reproduceResearch(config)).status,'mismatch');
  ledger.trades[0].gross_return_bps=999;
  await writeFile(config.ledger_file,JSON.stringify(ledger));
  await assert.rejects(reproduceResearch(config),/artifact ID/);
});
test('rejects commands, missing expected hash and symlink inputs',async t=>{
  const {config,dir}=await fixture(t);
  for(const bad of [{...config,command:'echo unsafe'},{...config,expected_result_sha256:undefined},{...config,task:'arbitrary'}])await assert.rejects(reproduceResearch(bad));
  const link=join(dir,'link');try{await symlink(config.ledger_file,link);}catch(e){if(process.platform==='win32'&&e.code==='EPERM'){t.skip('symlink privilege');return;}throw e;}
  await assert.rejects(reproduceResearch({...config,ledger_file:link}));
});
test('CLI confirmation, exclusive durable reports, redaction, and mismatch exit 2',async t=>{
  const {config,dir}=await fixture(t),input=join(dir,'config'),output=join(dir,'report');
  await writeFile(input,JSON.stringify(config));
  const cli=fileURLToPath(new URL('../../build/researchReproductionCli.js',import.meta.url));
  const run=args=>spawnSync(process.execPath,[cli,...args],{encoding:'utf8',timeout:15000});
  const args=['--input',input,'--output',output];
  assert.equal(run(args).status,1);
  const ok=run([...args,'--confirm-local-read']);assert.equal(ok.status,0,ok.stderr);assert.equal(JSON.parse(ok.stdout).status,'reproduced');
  if(process.platform!=='win32')assert.equal((await stat(output)).mode&0o777,0o600);
  const original=await readFile(output,'utf8');assert.equal(run([...args,'--confirm-local-read']).status,1);assert.equal(await readFile(output,'utf8'),original);
  await writeFile(input,JSON.stringify({...config,expected_result_sha256:`sha256:${'0'.repeat(64)}`}));
  const mismatch=run(['--input',input,'--output',join(dir,'mismatch'),'--confirm-local-read']);
  assert.equal(mismatch.status,2);assert.equal(JSON.parse(mismatch.stdout).status,'mismatch');
  await writeFile(input,'PRIVATE_PARSE_SECRET');const invalid=run([...args,'--confirm-local-read']);assert.equal(invalid.status,1);assert.equal(invalid.stderr.includes('PRIVATE_PARSE_SECRET'),false);assert.equal(invalid.stderr.includes(dir),false);
});

/**
 * Append to `target` just before the nth open of `watched`, using the open-stub pattern
 * already used in the evidence tests. The two are separate because fingerprint lstats
 * before it opens: mutating at the open of the file being fingerprinted trips that call's
 * own consistency check instead of the guard under test.
 */
async function mutateBeforeOpen(watched, nth, target, bytes) {
  const original = fsPromises.open;
  let seen = 0;
  fsPromises.open = async (path, ...rest) => {
    if (path === watched && ++seen === nth) await appendFile(target, bytes);
    return original(path, ...rest);
  };
  syncBuiltinESMExports();
  return () => { fsPromises.open = original; syncBuiltinESMExports(); };
}

test('bytes parsed must be the bytes the evidence hashed',async t=>{
  // Evidence opens the ledger once per verification pass; the third open is the read whose
  // bytes are parsed. Dropping the re-digest left this undetected.
  const {config}=await fixture(t);
  const restore=await mutateBeforeOpen(config.ledger_file,3,config.ledger_file,' ');
  try {await assert.rejects(reproduceResearch(config),/changed before execution/);}
  finally {restore();}
});

test('evidence changing during execution is refused, not reported as reproduced',async t=>{
  // The third open of the parameters file is the read that follows the ledger read, so a
  // change made there lands after the pre-execution evidence and before the post pass. Both
  // post passes then agree with each other and disagree with the manifest taken earlier.
  const {config}=await fixture(t);
  const restore=await mutateBeforeOpen(config.parameters_file,3,config.ledger_file,' ');
  try {await assert.rejects(reproduceResearch(config),/changed during execution/);}
  finally {restore();}
});
