import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, chmod, readdir, truncate } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { BacktestLedgerStore, backtestLedgerSchema, summarizeBacktestLedger, readBacktestLedgerFile, BACKTEST_LEDGER_MAX_BYTES } from '../../build/backtestLedger.js';
const fixture=JSON.parse(await readFile(new URL('../fixtures/backtest-ledger.json',import.meta.url),'utf8'));
const id=(x)=>'sha256:'+createHash('sha256').update(JSON.stringify(backtestLedgerSchema.parse(x))).digest('hex');
const options=(extra={})=>({artifact_id:id(fixture),round_trip_cost_bps:2,...extra});
test('ledger exposes the unfiltered denominator for every slice including missing outcomes',()=>{
  for (const extra of [{}, {include_symbols:['EURUSD']}, {exclude_symbols:['XAUUSD']},
    {direction:'short'}, {from:'2024-02-01T00:00:00.000Z'}, {to:'2024-02-01T00:00:00.000Z'},
    {from:'2025-01-01T00:00:00.000Z'}]) {
    for (const group_by of ['none','symbol','year','month']) {
      const r=summarizeBacktestLedger(fixture,options({...extra,group_by}));
      const expected=fixture.trades.filter(t=>(!extra.include_symbols||extra.include_symbols.includes(t.symbol))
        && !extra.exclude_symbols?.includes(t.symbol) && (!extra.direction||t.direction===extra.direction)
        && (!extra.from||t.exit_at>=extra.from) && (!extra.to||t.exit_at<extra.to)).length;
      assert.equal(r.ledger_records,fixture.trades.length);
      assert.equal(r.overall.records,expected);
      assert.equal(r.selected_fraction,expected/fixture.trades.length);
      assert.equal(r.candidateEligible,false);
      // The limitations are what a reader leans on, and nothing else holds them: the
      // whole list can be deleted with every other assertion still green.
      assert.deepEqual(r.limitations,['content_hash_is_integrity_not_source_authentication',
        'source_metadata_is_importer_supplied','content_hash_does_not_prove_prespecified_slice_selection',
        'slice_search_count_is_not_tracked','missing_outcomes_are_not_zero_returns',
        'bps_sums_are_not_portfolio_returns','not_a_statistical_candidate_test']);
    }
  }
});
async function directory(t) { const d=await mkdtemp(join(tmpdir(),'ledger-test-'));t.after(()=>rm(d,{recursive:true,force:true}));return d; }

test('ledger recomputes pooled PF, applies cost once, and preserves missing and zero outcomes',()=>{
  const all=summarizeBacktestLedger(fixture,options());
  assert.equal(all.overall.profit_factor,26.5);
  const r=summarizeBacktestLedger(fixture,options({exclude_symbols:['XAUUSD'],group_by:'symbol'}));
  assert.equal(r.overall.profit_factor,2);
  assert.equal(r.overall.closed_trades,3);
  assert.equal(r.overall.missing_outcomes,1);
  assert.equal(r.overall.net_sum_bps,4);
  assert.equal(r.overall.win_rate,1/3);
  assert.equal(r.status,'partial');
  assert.deepEqual(r.groups.map(x=>x.key),['EURUSD','USDJPY']);
  assert.equal(r.groups[0].profit_factor,null);
  assert.equal(r.groups[0].profit_factor_status,'no_losses');
  assert.equal(JSON.stringify(r).includes('trade_id'),false);
});
test('ledger filters and groups by UTC exit, includes from, excludes to',()=>{
  const r=summarizeBacktestLedger(fixture,options({from:'2024-02-01T00:00:00.000Z',to:'2024-03-01T00:00:00.000Z',group_by:'month'}));
  assert.equal(r.overall.closed_trades,1);assert.equal(r.groups[0].key,'2024-02');
  const jan=summarizeBacktestLedger(fixture,options({to:'2024-02-01T00:00:00.000Z',direction:'long'}));
  assert.equal(jan.overall.closed_trades,2);
  const empty=summarizeBacktestLedger(fixture,options({from:'2025-01-01T00:00:00.000Z'}));
  assert.equal(empty.status,'empty');assert.equal(empty.overall.mean_net_bps,null);
  assert.equal(empty.overall.profit_factor_status,'no_closed_trades');
});
test('ledger rejects wrong units, duplicate IDs, timestamps, unknown fields and nonfinite returns',()=>{
  for(const patch of [{return_unit:'net_bps'},{extra:true},{trades:[fixture.trades[0],fixture.trades[0]]}])
    assert.throws(()=>backtestLedgerSchema.parse({...fixture,...patch}));
  for(const patch of [{gross_return_bps:NaN},{gross_return_bps:Infinity},{entry_at:'bad'},
    {entry_at:'2025-01-01T00:00:00.000Z'},{exit_at:'2024-02-01T09:00:00+09:00'}])
    assert.throws(()=>backtestLedgerSchema.parse({...fixture,trades:[{...fixture.trades[0],...patch}]}));
  for(const opt of [{round_trip_cost_bps:undefined},{round_trip_cost_bps:-1},{from:'2025-01-01T00:00:00.000Z',to:'2024-01-01T00:00:00.000Z'},
    {include_symbols:['TYPO']},{include_symbols:['EURUSD'],exclude_symbols:['EURUSD']},{artifact_id:'sha256:'+'a'.repeat(64)}])
    assert.throws(()=>summarizeBacktestLedger(fixture,options(opt)));
});
test('ledger limits grouped output',()=>{
  const data={...fixture,trades:Array.from({length:501},(_,i)=>{
    const time=new Date(Date.UTC(2000, i, 1)).toISOString();
    return {...fixture.trades[0],trade_id:String(i),entry_at:time,exit_at:time};
  })};
  assert.throws(()=>summarizeBacktestLedger(data,{artifact_id:id(data),round_trip_cost_bps:0,group_by:'month'}),/too many groups/);
});
test('ledger stores atomically and concurrent identical imports are idempotent',async(t)=>{
  const dir=await directory(t);const store=new BacktestLedgerStore(dir);
  const results=await Promise.all(Array.from({length:5},()=>store.register(fixture)));
  assert.ok(results.every(r=>r.artifact_id===id(fixture)));
  assert.deepEqual(await store.get(id(fixture)),fixture);
  assert.deepEqual(await readdir(dir),[id(fixture).slice(7)+'.json']);
  await assert.rejects(store.get('../secret'));
  const path=join(dir,id(fixture).slice(7)+'.json');
  await writeFile(path,'{}');
  await assert.rejects(store.get(id(fixture)),/hash mismatch/);
  await assert.rejects(store.register(fixture),/hash mismatch/);
  assert.equal(await readFile(path,'utf8'),'{}');
});
test('ledger refuses symlink artifacts and symlink roots including dangling files',async(t)=>{
  const dir=await directory(t);const root=join(dir,'root');const target=join(dir,'target');
  await writeFile(target,'{}',{mode:0o600});
  const path=join(dir,id(fixture).slice(7)+'.json');
  try { await symlink(target,path); } catch(e) { if(e.code==='EPERM'){t.skip('symlinks unavailable');return;}throw e; }
  const store=new BacktestLedgerStore(dir);
  await assert.rejects(store.get(id(fixture)),/symlink/);
  await rm(path);await symlink(join(dir,'missing'),path);
  await assert.rejects(store.register(fixture),/symlink/);
  await symlink(dir,root,process.platform==='win32'?'junction':'dir');
  await assert.rejects(new BacktestLedgerStore(root).get(id(fixture)),/directory/);
});
test('ledger read is bounded and owner permissions are enforced on POSIX',async(t)=>{
  const dir=await directory(t);const path=join(dir,'large');await writeFile(path,'x');
  await truncate(path,BACKTEST_LEDGER_MAX_BYTES+1);
  await assert.rejects(readBacktestLedgerFile(path),/size/);
  const store=new BacktestLedgerStore(dir);await store.register(fixture);
  if(process.platform!=='win32'){
    await chmod(join(dir,id(fixture).slice(7)+'.json'),0o644);
    await assert.rejects(store.get(id(fixture)),/owner-only/);
  }
});
test('ledger CLI requires explicit confirmation and returns an importable artifact ID',async(t)=>{
  const dir=await directory(t);const input=join(dir,'input.json');await writeFile(input,JSON.stringify(fixture));
  const cli=new URL('../../build/backtestLedgerCli.js',import.meta.url);
  const run=promisify(execFile);const env={...process.env,TRADINGVIEW_MCP_BACKTEST_LEDGER_DIRECTORY:join(dir,'store')};
  const {fileURLToPath}=await import('node:url');
  await assert.rejects(run(process.execPath,[fileURLToPath(cli),'--input',input],{env}));
  const {stdout}=await run(process.execPath,[fileURLToPath(cli),'--input',input,'--confirm-local-import'],{env});
  assert.equal(JSON.parse(stdout).artifact_id,id(fixture));
  assert.deepEqual(await new BacktestLedgerStore(env.TRADINGVIEW_MCP_BACKTEST_LEDGER_DIRECTORY).get(id(fixture)),fixture);
  if(process.platform!=='win32') {
    const bin=join(dir,'tradingview-mcp-import-ledger');
    await symlink(fileURLToPath(cli),bin);
    const linked=await run(process.execPath,[bin,'--input',input,'--confirm-local-import'],{env});
    assert.equal(JSON.parse(linked.stdout).artifact_id,id(fixture));
  }
});

test('ledger rejects a regular file replaced by a FIFO before open without hanging',async(t)=>{
  if(process.platform==='win32'){t.skip('POSIX FIFO regression');return;}
  const dir=await directory(t);const path=join(dir,'race');await writeFile(path,'x');
  const moduleUrl=new URL('../../build/backtestLedger.js',import.meta.url).href;
  const script=`
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    import {execFile} from 'node:child_process';
    import {promisify} from 'node:util';
    import assert from 'node:assert/strict';
    const path=process.argv[1]; const original=fs.lstat; let replaced=false;
    fs.lstat=async function(p,...args){
      const stat=await original(p,...args);
      if(p===path && !replaced){replaced=true;await fs.unlink(path);await promisify(execFile)('mkfifo',[path]);}
      return stat;
    };
    syncBuiltinESMExports();
    const {readBacktestLedgerFile}=await import(${JSON.stringify(moduleUrl)});
    await assert.rejects(readBacktestLedgerFile(path),/changed while opening/);
    assert.equal(replaced,true);
  `;
  await promisify(execFile)(process.execPath,['--input-type=module','-e',script,path],{timeout:5000});
});
