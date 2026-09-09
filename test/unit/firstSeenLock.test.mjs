import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppendOnlyFirstSeenLog } from '../../build/firstSeenStore.js';

const variable='TV_MCP_HISTORY_LOCK_WAIT_MS';
const log=path=>new AppendOnlyFirstSeenLog(path,'test',x=>x,{maxFileBytes:10000,maxRecordBytes:1000});
async function setup(t) {
  const dir=await mkdtemp(join(tmpdir(),'history-lock-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const saved=process.env[variable];
  delete process.env[variable];
  t.after(()=>{if(saved===undefined) delete process.env[variable]; else process.env[variable]=saved;});
  return join(dir,'data.jsonl');
}
test('default production lock wait survives a holder exceeding the old two-second limit',async t=>{
  const path=await setup(t);
  assert.equal(log(path).lockWaitMs,30000);
  const release=await log(path).acquireFileLock();
  const owner=await readFile(path+'.lock','utf8');
  const delayedRelease=new Promise((resolve,reject)=>setTimeout(()=>release().then(resolve,reject),2300));
  try {
    const pending=log(path).acquireFileLock();
    assert.equal(await readFile(path+'.lock','utf8'),owner);
    const unlock=await pending;
    await unlock();
  } finally {await delayedRelease;}
});
test('wall-clock jumps do not shorten the monotonic contention budget',async t=>{
  const path=await setup(t);
  process.env[variable]='100';
  const release=await log(path).acquireFileLock();
  const original=Date.now;
  let calls=0;
  Date.now=()=>original()+1_000_000*(calls++);
  const started=performance.now();
  try {
    await assert.rejects(log(path).acquireFileLock(),{code:'HISTORY_LOCK_TIMEOUT'});
    assert.ok(performance.now()-started>=90,'wall time changes must not cause early timeout');
  } finally {Date.now=original;await release();}
});
test('bounded timeout preserves the owner and allows a later retry',async t=>{
  const path=await setup(t);
  process.env[variable]='100';
  const release=await log(path).acquireFileLock();
  const owner=await readFile(path+'.lock','utf8');
  try {
    await assert.rejects(log(path).acquireFileLock(),error=>{
      assert.equal(error.code,'HISTORY_LOCK_TIMEOUT');
      assert.ok(error.message.includes(path+'.lock'));
      assert.match(error.message,/100ms/);
      return true;
    });
    assert.equal(await readFile(path+'.lock','utf8'),owner);
  } finally {await release();}
  await (await log(path).acquireFileLock())();
});
test('invalid lock wait configuration fails closed',async t=>{
  const path=await setup(t);
  for(const value of ['', '0','99','120001','1.5','NaN','Infinity','-1']) {
    process.env[variable]=value;
    assert.throws(()=>log(path),/TV_MCP_HISTORY_LOCK_WAIT_MS/);
  }
  for(const value of ['100','30000','120000']) {process.env[variable]=value; assert.doesNotThrow(()=>log(path));}
});
