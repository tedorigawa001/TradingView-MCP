import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { runIndicatorTableStudy, hashIndicatorTable } from '../../build/indicatorTableStudy.js';

const pineId = 'USER;abcdefgh12345678';
const request = {
  pine_id: pineId, pine_version: '7.0', chart_index: 1,
  expected_symbol: 'OANDA:USDJPY', expected_timeframe: '240', timeframe: '61',
  symbols: ['OANDA:EURUSD', 'OANDA:XAUUSD'].map(symbol => ({ symbol,
    expected_cells: [{table_index:0,row:0,column:0,text:symbol}],
  })),
};

function fixture(options = {}) {
  const charts = [
    {index:0,symbol:'TVC:DXY',resolution:'1D',studies:[{id:'foreign',name:'Keep other chart'}]},
    {index:1,symbol:'OANDA:USDJPY',resolution:'240',studies:[{id:'existing',name:'Keep indicator'}]},
  ];
  const original = structuredClone(charts);
  const calls = [];
  const counts = new Map();
  const attempts = new Map();
  let sequence = 0;
  const assertIndex = index => assert.equal(index,1,'only the selected chart may be operated on');
  const status = (studyId,index) => {
    assertIndex(index);
    const size = counts.get(charts[index].symbol) ?? 300;
    return {studyId,pineId,pineVersion:'7.0',loading:false,chartIndex:index,
      symbol:charts[index].symbol,resolution:charts[index].resolution,barsCount:size,
      earliestTime:100,latestTime:100+size*3660};
  };
  const tv = {
    getChartContext: async()=>structuredClone({layoutName:'test',activeChartIndex:0,chartsCount:2,charts}),
    getReplayStatus: async()=>({started:false,toolbarVisible:false}),
    listPineScripts: async()=>[{pineId,name:'Measurement',kind:'study',version:'8.0',usedBy:[]}],
    getPineSource: async(id,version)=>({pineId:id,name:'Measurement',kind:'study',version,source:'//@version=6\nindicator("Measurement")',sourceLength:39,updated:null}),
    setSymbol: async(symbol,index)=>{assertIndex(index);calls.push(['symbol',symbol]);charts[index].symbol=symbol;return {symbol,resolution:charts[index].resolution};},
    setResolution: async(resolution,index)=>{assertIndex(index);calls.push(['timeframe',resolution]);charts[index].resolution=resolution;return {symbol:charts[index].symbol,resolution};},
    loadMoreHistory: async({count,chartIndex})=>{
      assertIndex(chartIndex);
      const key=charts[chartIndex].symbol;
      const attempt=attempts.get(key)??0;
      attempts.set(key,attempt+1);
      const before=counts.get(key)??300;
      const added=attempt===1?100:0;
      counts.set(key,before+added);
      calls.push(['load',key,count]);
      return {requested:count,barsBefore:before,barsAfter:before+added,added,earliestTime:100,moreAvailable:false};
    },
    addPineToChart: async(id,index,version)=>{
      assertIndex(index);assert.equal(id,pineId);assert.equal(version,'7.0');
      const studyId=`new${++sequence}`;
      charts[index].studies.push({id:studyId,name:'Measurement'});
      calls.push(['add',studyId]);return {studyId,name:'Measurement',isStrategy:false,version,chartIndex:index};
    },
    getPineStudyStatus: async(id,index)=>{calls.push(['status',id]);return status(id,index);},
    getIndicatorInputs: async({studyId,chartIndex})=>{assertIndex(chartIndex);return [{id:studyId,name:'Measurement',title:'Measurement',
      inputs:[{id:'in_0',name:'Window',type:'integer',value:20,defval:20,tooltip:null}]}];},
    getIndicatorTables: async({studyId,chartIndex})=>{
      assertIndex(chartIndex);calls.push(['table',studyId]);
      return [{id:studyId,name:'Measurement',tables:[{id:1,position:'top_right',rows:1,columns:1,cellCount:1,grid:[[charts[chartIndex].symbol]]}]}];
    },
    removePineFromChart: async(id,studyId,index)=>{
      assertIndex(index);assert.equal(id,pineId);assert.notEqual(studyId,'existing');
      calls.push(['remove',studyId]);charts[index].studies=charts[index].studies.filter(item=>item.id!==studyId);
      return {removed:true,pineId:id,pineVersion:'7.0',studyId,name:'Measurement',chartIndex:index};
    },
    ...options,
  };
  return {tv,charts,original,calls,counts,attempts,timing:{sleep:async()=>{}}};
}

test('indicator table study previews an exact saved version without chart writes or table reads', async()=>{
  const f=fixture();
  const result=await runIndicatorTableStudy(f.tv,request,f.timing);
  assert.equal(result.status,'preview');
  assert.equal(result.dryRun,true);
  assert.equal(result.pine.version,'7.0');
  assert.deepEqual(f.calls,[]);
  assert.deepEqual(f.charts,f.original);
});

test('indicator table study pages through a transient empty, reads each table once, hashes, checks markers and restores', async()=>{
  const f=fixture();
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'complete');
  assert.equal(result.processed,2);
  assert.equal(result.remaining,0);
  assert.equal(result.chartRestored,true);
  assert.deepEqual(f.charts,f.original);
  assert.equal(f.calls.filter(call=>call[0]==='table').length,2);
  assert.equal(f.calls.filter(call=>call[0]==='remove').length,2);
  for (const job of result.jobs) {
    assert.equal(job.status,'complete');
    assert.equal(job.historyLoad.attempts,4);
    assert.equal(job.historyLoad.stopReason,'consecutive_empty');
    assert.equal(job.historyLoad.finalBars,400);
    assert.equal(job.historyLoad.oldestTime,100);
    assert.equal(job.historyLoad.addedBars,100);
    assert.equal(job.markerChecks[0].matched,true);
    assert.deepEqual(job.inputs,[{id:'in_0',value:20}]);
    assert.equal(job.tables.length,1);
    const table=job.tables[0];
    assert.match(table.sha256,/^sha256:[a-f0-9]{64}$/);
    const canonical=JSON.stringify({id:table.id,position:table.position,rows:table.rows,columns:table.columns,
      cellCount:table.cellCount,grid:table.grid,tooltips:[]});
    assert.equal(table.sha256,`sha256:${createHash('sha256').update(canonical).digest('hex')}`);
    assert.equal(job.chartRestored,true);
    assert.equal(job.studiesRestored,true);
  }
});

for (const [name, override] of [
  ['Replay', {getReplayStatus:async()=>({started:true,toolbarVisible:true})}],
  ['not owned', {listPineScripts:async()=>[]}],
  ['strategy', {listPineScripts:async()=>[{pineId,kind:'strategy'}]}],
  ['wrong version', {getPineSource:async()=>({pineId,version:'8.0',kind:'study',source:'indicator("Wrong")'})}],
]) {
  test(`indicator table study refuses ${name} before writes`, async()=>{
    const f=fixture(override);
    await assert.rejects(()=>runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing));
    assert.deepEqual(f.calls,[]);
    assert.deepEqual(f.charts,f.original);
  });
}

for (const patch of [{chart_index:undefined},{pine_version:'last'},{symbols:[]},
  {symbols:[request.symbols[0],request.symbols[0]]},{max_history_attempts:25},
  {keep_on_chart:true},{expected_symbol:'OANDA:EURUSD'}]) {
  test(`indicator table study rejects invalid or mismatched request ${JSON.stringify(patch)}`, async()=>{
    const f=fixture();
    await assert.rejects(()=>runIndicatorTableStudy(f.tv,{...request,...patch,confirm:true},f.timing));
    assert.deepEqual(f.calls,[]);
  });
}

test('indicator table study stops at the history attempt limit without installing an indicator or claiming exhaustion', async()=>{
  const f=fixture();
  f.tv.loadMoreHistory=async({count,chartIndex})=>{
    assert.equal(chartIndex,1);const key=f.charts[1].symbol;
    const before=f.counts.get(key)??300;f.counts.set(key,before+1);f.calls.push(['load',key]);
    return {requested:count,barsBefore:before,barsAfter:before+1,added:1,earliestTime:100,moreAvailable:false};
  };
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'partial');assert.equal(result.processed,1);assert.equal(result.remaining,1);
  assert.equal(result.jobs[0].historyLoad.attempts,24);
  assert.equal(result.jobs[0].historyLoad.stopReason,'attempt_limit');
  assert.equal(result.jobs[0].historyLoad.finalBars,324);
  assert.ok(result.jobs[0].qualityIssues.includes('history_attempt_limit'));
  assert.equal(result.jobs[0].tables.length,0);
  assert.equal(f.calls.some(call=>call[0]==='add'),false);
  assert.deepEqual(f.charts,f.original);
});

for (const failure of ['loader','table','version','loading','readiness unavailable','history drift']) {
  test(`indicator table study cleans up and stops after ${failure} failure without retrying it`, async()=>{
    const f=fixture();
    const originalStatus=f.tv.getPineStudyStatus;
    if(failure==='loader') f.tv.loadMoreHistory=async()=>{f.calls.push(['load-error']);throw new Error('load failed');};
    if(failure==='table') f.tv.getIndicatorTables=async()=>{f.calls.push(['table-error']);throw new Error('table failed');};
    if(['version','loading','readiness unavailable','history drift'].includes(failure)) f.tv.getPineStudyStatus=async(id,index)=>{
      const status=await originalStatus(id,index);
      return {...status,...(failure==='version'?{pineVersion:'8.0'}:failure==='loading'?{loading:true}:
        failure==='readiness unavailable'?{loading:null}:{barsCount:status.barsCount+100})};
    };
    const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
    assert.equal(result.status,'aborted');assert.equal(result.processed,1);assert.equal(result.remaining,1);
    assert.equal(result.jobs[0].status,'failed');assert.ok(result.jobs[0].error);
    assert.equal(result.jobs[0].chartRestored,true);assert.equal(result.jobs[0].studiesRestored,true);
    assert.deepEqual(f.charts,f.original);
    assert.equal(f.calls.filter(call=>call[0]==='remove').length,failure==='loader'?0:1);
    if(failure==='loader') assert.equal(f.calls.filter(call=>call[0]==='load-error').length,1);
    if(failure==='table') assert.equal(f.calls.filter(call=>call[0]==='table-error').length,1);
    if(failure==='loading') assert.equal(f.calls.filter(call=>call[0]==='status').length,80);
  });
}

test('indicator table study discards a table when the bar window changes across its single read', async()=>{
  const f=fixture();
  const read=f.tv.getIndicatorTables;
  f.tv.getIndicatorTables=async(options)=>{
    const snapshot=await read(options);f.counts.set(f.charts[1].symbol,401);return snapshot;
  };
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.jobs[0].tables.length,0);
  assert.equal(f.calls.filter(call=>call[0]==='table').length,1);
  assert.deepEqual(f.charts,f.original);
});

test('indicator table study reports missing or mismatched markers, and absence of checks never passes silently', async()=>{
  const f=fixture();
  const mismatch=await runIndicatorTableStudy(f.tv,{...request,confirm:true,symbols:[{
    symbol:'OANDA:EURUSD',expected_cells:[{table_index:0,row:0,column:0,text:'wrong'}, {table_index:1,row:0,column:0,text:'missing'}],
  },request.symbols[1]]},f.timing);
  assert.equal(mismatch.status,'partial');assert.equal(mismatch.remaining,1);
  assert.deepEqual(mismatch.jobs[0].markerChecks.map(cell=>cell.matched),[false,false]);
  assert.equal(mismatch.jobs[0].markerChecks[1].actual,null);
  assert.deepEqual(f.charts,f.original);
  const g=fixture();
  const unchecked=await runIndicatorTableStudy(g.tv,{...request,confirm:true,symbols:request.symbols.map(({symbol})=>({symbol}))},g.timing);
  assert.equal(unchecked.status,'partial');assert.equal(unchecked.processed,2);
  assert.ok(unchecked.jobs.every(job=>job.qualityIssues.includes('marker_checks_not_requested')));
});

test('indicator table study never hashes clipped or incomplete table content as complete', async()=>{
  const f=fixture();
  f.tv.getIndicatorTables=async({studyId})=>[{id:studyId,name:'Measurement',tables:[{
    id:1,position:'top_right',rows:2,columns:1,cellCount:2,grid:[['OANDA:EURUSD'],['x'.repeat(200)+'…(truncated)']],
  }]}];
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'partial');assert.equal(result.remaining,1);
  assert.equal(result.jobs[0].tables[0].sha256,null);
  assert.ok(result.jobs[0].qualityIssues.includes('table_snapshot_incomplete'));
  assert.deepEqual(f.charts,f.original);
});

test('indicator table study retains an unattributed study after a lost add acknowledgement', async()=>{
  const f=fixture();const add=f.tv.addPineToChart;
  f.tv.addPineToChart=async(...args)=>{await add(...args);throw new Error('add acknowledgement lost');};
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.match(result.jobs[0].error,/acknowledgement lost/);
  assert.equal(result.jobs[0].studyId,null);
  assert.deepEqual(result.jobs[0].cleanup.removedStudyIds,[]);
  assert.deepEqual(result.jobs[0].cleanup.unattributedStudyIds,['new1']);
  assert.deepEqual(result.jobs[0].cleanup.remainingStudies,[{id:'new1',name:'Measurement'}]);
  assert.ok(result.jobs[0].qualityIssues.includes('unattributed_studies_remaining'));
  assert.equal(result.chartRestored,false);
  assert.equal(f.calls.filter(call=>call[0]==='add').length,1);
  assert.equal(f.calls.some(call=>call[0]==='remove'),false);
  assert.equal(f.charts[1].symbol,f.original[1].symbol);
  assert.equal(f.charts[1].resolution,f.original[1].resolution);
  assert.deepEqual(f.charts[1].studies,[...f.original[1].studies,{id:'new1',name:'Measurement'}]);
  assert.deepEqual(f.charts[0],f.original[0]);
});

test('indicator table study never deletes a concurrent manual instance of the same Pine ID and version after add fails', async()=>{
  const f=fixture();
  f.tv.addPineToChart=async()=>{
    f.calls.push(['add-error']);
    // The tool's add creates nothing; a separate manual action creates this instance.
    f.charts[1].studies.push({id:'manual',name:'Manual measurement'});
    throw new Error('requested add failed before creation');
  };
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.remaining,1);
  assert.match(result.abortReason,/requested add failed/);
  assert.equal(result.jobs[0].studyId,null);
  assert.deepEqual(result.jobs[0].cleanup.removedStudyIds,[]);
  assert.deepEqual(result.jobs[0].cleanup.unattributedStudyIds,['manual']);
  assert.deepEqual(result.jobs[0].cleanup.remainingStudies,[{id:'manual',name:'Manual measurement'}]);
  assert.equal(f.calls.some(call=>call[0]==='remove'),false);
  assert.equal(f.calls.filter(call=>call[0]==='add-error').length,1);
  assert.equal(result.jobs[0].chartRestored,true);
  assert.equal(result.jobs[0].studiesRestored,false);
  assert.equal(result.chartRestored,false);
  assert.deepEqual(f.charts[1].studies,[...f.original[1].studies,{id:'manual',name:'Manual measurement'}]);
});

test('indicator table study never removes a pre-existing study even if add returns its ID', async()=>{
  const f=fixture({addPineToChart:async()=>({studyId:'existing',isStrategy:false,chartIndex:1,version:'7.0'})});
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(f.calls.some(call=>call[0]==='remove'),false);
  assert.deepEqual(f.charts,f.original);
});

test('indicator table study aborts after failed cleanup, without a second removal attempt', async()=>{
  const f=fixture({removePineFromChart:async()=>{f.calls.push(['remove-error']);throw new Error('remove failed');}});
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.remaining,1);
  assert.equal(result.chartRestored,false);assert.equal(result.jobs[0].studiesRestored,false);
  assert.ok(result.jobs[0].cleanup.errors.some(error=>error.includes('remove failed')));
  assert.equal(f.calls.filter(call=>call[0]==='remove-error').length,1);
  assert.equal(f.charts[1].symbol,'OANDA:USDJPY');assert.equal(f.charts[1].resolution,'240');
  assert.deepEqual(f.charts[0],f.original[0]);
});

test('indicator table study keeps earlier evidence if Replay starts before the next job', async()=>{
  const f=fixture();
  f.tv.getReplayStatus=async()=>({started:f.calls.some(call=>call[0]==='remove')&&f.charts[1].resolution==='240',toolbarVisible:false});
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.processed,1);assert.equal(result.remaining,1);
  assert.match(result.abortReason,/Replay/);
  assert.equal(result.jobs[0].status,'complete');
  assert.deepEqual(f.charts,f.original);
});

for (const finalReadFails of [false,true]) {
  test(`indicator table study retains completed evidence when the next transaction entry read fails (final read fails: ${finalReadFails})`, async()=>{
    const f=fixture();const read=f.tv.getChartContext;
    let failContext=false;let entryFailed=false;
    f.tv.getReplayStatus=async()=>{
      // The second job's precheck passes, but the transaction's own initial read fails.
      if(f.calls.some(call=>call[0]==='remove')&&f.charts[1].resolution==='240') failContext=true;
      return {started:false,toolbarVisible:false};
    };
    f.tv.getChartContext=async()=>{
      if(failContext){
        if(!entryFailed){
          entryFailed=true;failContext=finalReadFails;
          f.calls.push(['transaction-entry-read-error']);
          throw new Error('transaction entry read failed');
        }
        f.calls.push(['final-read-error']);throw new Error('final state unavailable');
      }
      return read();
    };
    const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
    assert.equal(result.status,'aborted');assert.equal(result.processed,1);assert.equal(result.remaining,1);
    assert.equal(result.jobs.length,1);assert.equal(result.jobs[0].symbol,'OANDA:EURUSD');
    assert.equal(result.jobs[0].status,'complete');assert.equal(result.jobs[0].tables[0].grid[0][0],'OANDA:EURUSD');
    assert.match(result.jobs[0].tables[0].sha256,/^sha256:[a-f0-9]{64}$/);
    assert.equal(result.jobs[0].historyLoad.stopReason,'consecutive_empty');
    assert.equal(result.abortReason,'transaction entry read failed');
    assert.equal(result.chartRestored,!finalReadFails);
    if(finalReadFails) assert.equal(result.chartStateAfter,null);
    else assert.deepEqual(result.chartStateAfter,f.original[1]);
    assert.equal(f.calls.filter(call=>call[0]==='transaction-entry-read-error').length,1);
    assert.equal(f.calls.filter(call=>call[0]==='final-read-error').length,finalReadFails?1:0);
    assert.equal(f.calls.filter(call=>call[0]==='add').length,1);
    assert.equal(f.calls.filter(call=>call[0]==='table').length,1);
    assert.equal(f.attempts.has('OANDA:XAUUSD'),false);
    assert.deepEqual(f.charts,f.original);
  });
}

test('indicator table study reports the observed chart when restoring the original timeframe fails', async()=>{
  const f=fixture();const set=f.tv.setResolution;
  f.tv.setResolution=async(resolution,index)=>{if(resolution==='240')throw new Error('restore failed');return set(resolution,index);};
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.remaining,1);
  assert.equal(result.jobs[0].chartRestored,false);
  assert.equal(result.jobs[0].chartStateAfter.resolution,'61');
  assert.deepEqual(result.jobs[0].chartStateAfter.studies,f.original[1].studies);
});

test('indicator table study reports a final study-list mismatch even when earlier jobs restored successfully', async()=>{
  const f=fixture();
  f.tv.getReplayStatus=async()=>{
    if(f.calls.some(call=>call[0]==='remove')&&f.charts[1].resolution==='240') {
      f.charts[1].studies.push({id:'manual',name:'Concurrent user study'});
      return {started:true,toolbarVisible:false};
    }
    return {started:false,toolbarVisible:false};
  };
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.jobs[0].studiesRestored,true);
  assert.equal(result.chartRestored,false);
  assert.ok(result.chartStateAfter.studies.some(study=>study.id==='manual'));
  assert.equal(f.calls.some(call=>call[0]==='remove'&&call[1]==='manual'),false);
});

test('indicator table study honors cancellation while still removing its indicator and restoring the chart', async()=>{
  const f=fixture();const controller=new AbortController();const read=f.tv.getIndicatorTables;
  f.tv.getIndicatorTables=async(options)=>{const result=await read(options);controller.abort();return result;};
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},{...f.timing,signal:controller.signal});
  assert.equal(result.status,'aborted');assert.equal(result.remaining,1);
  assert.match(result.abortReason,/cancelled/);
  assert.equal(result.jobs[0].tables.length,0);
  assert.deepEqual(f.charts,f.original);
});

test('indicator table study rejects a changed input snapshot instead of accepting its table', async()=>{
  const f=fixture();let reads=0;
  f.tv.getIndicatorInputs=async({studyId})=>[{id:studyId,name:'Measurement',title:'Measurement',inputs:[{id:'in_0',value:++reads}]}];
  const result=await runIndicatorTableStudy(f.tv,{...request,confirm:true},f.timing);
  assert.equal(result.status,'aborted');assert.equal(result.jobs[0].tables.length,0);
  assert.match(result.jobs[0].error,/inputs changed/);
  assert.deepEqual(f.charts,f.original);
});

test('table SHA-256 uses deterministic key and tooltip ordering without trimming text',()=>{
  const table={id:1,position:'top_right',rows:1,columns:2,cellCount:2,grid:[[' A ','B']],
    tooltips:[{row:0,column:0,tooltip:'a'},{row:0,column:0,tooltip:'Z'}]};
  const canonical=JSON.stringify({...table,tooltips:[table.tooltips[1],table.tooltips[0]]});
  assert.equal(hashIndicatorTable(table).sha256,`sha256:${createHash('sha256').update(canonical,'utf8').digest('hex')}`);
  assert.notEqual(hashIndicatorTable(table).sha256,hashIndicatorTable({...table,grid:[['A','B']]}).sha256);
});
