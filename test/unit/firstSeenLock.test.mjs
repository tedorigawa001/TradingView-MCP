import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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

// serializeWithin (docs/FORWARD_PERIOD_PLAN.md, step 1): one budget covers the in-process queue and the file lock.
test('serializeWithin times out on a held file lock within its budget, and the operation never runs',async t=>{
  const path=await setup(t);
  const release=await log(path).acquireFileLock();
  let ran=false;
  const started=performance.now();
  try {
    // The file lock gets what is left of the budget; the message rounds it (N1).
    await assert.rejects(log(path).serializeWithin(200,async()=>{ran=true;}),
      error=>error.code==='HISTORY_LOCK_TIMEOUT'&&/history lock after \d+ms: /.test(error.message));
    const elapsed=performance.now()-started;
    assert.ok(elapsed>=190&&elapsed<1500,`${elapsed}ms`);
    assert.equal(ran,false);
    assert.equal(log(path).lockWaitMs,30000,'the process-wide wait is unchanged');
  } finally {await release();}
  assert.equal(await log(path).serializeWithin(200,async()=>'ok'),'ok','the lock is usable once released');
});
test('serializeWithin times out even when nothing else keeps the process alive (F0)',async t=>{
  const path=await setup(t);
  // The predecessor never settles and holds no handle. An unref'd queue timer would let the child exit silently.
  const script=`import {AppendOnlyFirstSeenLog} from ${JSON.stringify(new URL('../../build/firstSeenStore.js',import.meta.url).href)};
const log=new AppendOnlyFirstSeenLog(${JSON.stringify(path)},'test',x=>x,{maxFileBytes:10000,maxRecordBytes:1000});
log.serialize(()=>new Promise(()=>{}));
log.serializeWithin(100,async()=>{}).catch(error=>console.log(error.code));`;
  const {stdout}=await promisify(execFile)(process.execPath,['--input-type=module','-e',script]);
  assert.equal(stdout.trim(),'HISTORY_LOCK_TIMEOUT');
});
test('serializeWithin times out in the in-process queue, and later callers still wait for the running operation',async t=>{
  const path=await setup(t);
  const order=[];
  let finish,began;
  const running=new Promise(resolve=>{began=resolve;});
  const long=log(path).serialize(async()=>{order.push('long:start');began();await new Promise(resolve=>{finish=resolve;});order.push('long:end');});
  // Wait until the long operation holds the queue and the file lock: on a slow runner taking the lock can outlast the
  // timed call's budget and the later 100 ms pause together, and a check before it starts would race it.
  await running;
  const started=performance.now();
  await assert.rejects(log(path).serializeWithin(150,async()=>{order.push('short');}),{code:'HISTORY_LOCK_TIMEOUT'});
  const elapsed=performance.now()-started;
  assert.ok(elapsed>=140&&elapsed<1500,`${elapsed}ms`);
  // A caller queued after the timed-out one must not skip ahead of the operation that still holds the queue. The file
  // lock alone would also hold it back, so the check is that it does not even reach the file lock before then.
  const later=log(path);
  const take=later.acquireFileLock.bind(later);
  later.acquireFileLock=(...args)=>{order.push('after:lock');return take(...args);};
  const after=later.serialize(async()=>{order.push('after');});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.deepEqual(order,['long:start'],'nothing ran while the long operation held the queue');
  finish();
  await long;
  await after;
  assert.deepEqual(order,['long:start','long:end','after:lock','after']);
});
test('serializeWithin runs operations in order when nothing blocks, and releases the lock after a failure',async t=>{
  const path=await setup(t);
  const order=[];
  await Promise.all([1,2,3].map(i=>log(path).serializeWithin(2000,async()=>{order.push(i);})));
  assert.deepEqual(order,[1,2,3]);
  await assert.rejects(log(path).serializeWithin(2000,async()=>{throw new Error('boom');}),/boom/);
  assert.equal(await log(path).serializeWithin(2000,async()=>'next'),'next');
  await assert.rejects(readFile(path+'.lock','utf8'),{code:'ENOENT'},'no lock is left behind');
});
