import test from "node:test";
import assert from "node:assert/strict";
import { summarizeMovingAverages, buildMovingAverageContext, SMA_TEN_STUDY_ID } from "../../build/movingAverageContext.js";

const symbol = "OANDA:EURUSD";
function fixture() {
  const bars = Array.from({length: 30}, (_, i) => {
    const time = 1577836800 + i * 3600;
    return {time, timeIso: new Date(time * 1000).toISOString(), open: 100+i, high: 102+i, low: 99+i, close: 101+i, volume:null};
  });
  const study = {id:"sma1", name:"Simple Moving Averages", metaId:SMA_TEN_STUDY_ID, visible:true, hasError:false,
    inputs:Array.from({length:10}, (_,i)=>[
      {id:`in_${2*i}`, name:`SMA #${i+1}`, type:"integer", value:3+i},
      {id:`in_${2*i+1}`, name:`SMA Source #${i+1}`, type:"source", value:"close"},
    ]).flat(), plots:Array.from({length:10},(_,i)=>[
      {id:`plot_${2*i}`, title:`SMA #${i+1}`, type:"line", visible:i===0, display:i===0?15:0, offset:0},
      {id:`plot_${2*i+1}`, title:`plot_${2*i+1}`, type:"colorer", visible:null, display:null, offset:null},
    ]).flat(), bars:bars.map((bar,i)=>({time:bar.time,timeIso:bar.timeIso,values:Object.fromEntries(Array.from({length:10},(_,j)=>[
      `plot_${2*j}`,i+1 < 3+j ? null : bars.slice(i-2-j,i+1).reduce((s,b)=>s+b.close,0)/(3+j),
    ]))}))};
  return {ohlcv:{symbol,resolution:"60",count:bars.length,bars}, snapshot:{source:"tradingview_moving_average_studies",symbol,resolution:"60",chartIndex:0,studies:[study],unmappedStudies:[]}};
}
const summarize = f => summarizeMovingAverages(f.ohlcv, f.snapshot, symbol, "60", new Date("2020-01-03T00:00:00Z"));

test("moving-average settings map by verified identity and IDs to successor-confirmed native values", () => {
  const f=fixture(), result=summarize(f), row=result.moving_averages[0];
  assert.equal(result.status,"complete"); assert.equal(result.moving_averages.length,10);
  assert.equal(row.study_id,"sma1"); assert.equal(row.plot_id,"plot_0");
  assert.deepEqual(row.settings,{method:"SMA",period:3,source:"close",period_input_id:"in_0",source_input_id:"in_1",offset_bars:0});
  assert.equal(row.value,128); assert.equal(row.previous_value,127);
  assert.equal(row.bar_open_at,f.ohlcv.bars[28].timeIso);
  assert.equal(row.confirmed_at,f.ohlcv.bars[29].timeIso);
  assert.equal(row.slope.price_change,1); assert.ok(Math.abs(row.slope.change_bps-(128/127-1)*10000)<1e-10);
  assert.equal(row.slope.direction,"rising"); assert.equal(row.verification.status,"matched_native_ohlcv_sma");
  assert.equal(result.moving_averages[1].plot_visible,false);
  assert.equal(result.candidateEligible,false);
});

test("name lookalikes, changed input signatures and duplicate identities are never guessed", () => {
  for(const mutate of [s=>s.metaId="other@tv-scripting",s=>s.inputs[0].name="Length",s=>s.plots[0].id="plot_1"]) {
    const f=fixture();mutate(f.snapshot.studies[0]);const r=summarize(f);
    assert.equal(r.moving_averages.length,0);assert.equal(r.unmapped_studies.length,1);assert.equal(r.status,"partial");
  }
  const f=fixture();f.snapshot.studies.push(structuredClone(f.snapshot.studies[0]));
  assert.throws(()=>summarize(f),/uniquely identified/);
});

test("a plot shown only in the data window is not reported visible in the pane",()=>{
  const f=fixture(); f.snapshot.studies[0].plots[0].display=2;
  assert.equal(summarize(f).moving_averages[0].plot_visible,false);
  f.snapshot.studies[0].plots[0].display=4294967295;
  assert.equal(summarize(f).moving_averages[0].plot_visible,true);
});

test("unconfirmed and future plots cannot affect closed values; missing exact timestamps never use older rows", () => {
  const f=fixture(), base=summarize(f); f.snapshot.studies[0].bars.at(-1).values.plot_0=9999;
  assert.deepEqual(summarize(f).moving_averages,base.moving_averages);
  f.snapshot.studies[0].bars.splice(28,1);
  const row=summarize(f).moving_averages[0];assert.equal(row.value,null);assert.equal(row.slope,null);
  assert.ok(row.quality_issues.includes("latest_confirmed_plot_value_unavailable"));
  const early=summarizeMovingAverages(f.ohlcv,fixture().snapshot,symbol,"60",new Date(f.ohlcv.bars[20].time*1000));
  assert.equal(early.moving_averages[0].bar_open_at,f.ohlcv.bars[19].timeIso);
});

test("offsets, external sources, bad periods, unhealthy studies and mismatched numeric values suppress values", () => {
  for(const mutate of [s=>s.plots[0].offset=1,s=>s.plots[0].offset=null,s=>s.inputs[1].value="external$plot",
    s=>s.inputs[0].value=0,s=>s.hasError=true,s=>s.hasError=null,s=>s.bars[28].values.plot_0=NaN,
    s=>s.bars[28].values.plot_0+=1]) {
    const f=fixture();mutate(f.snapshot.studies[0]);const row=summarize(f).moving_averages[0];
    assert.equal(row.value,null);assert.equal(row.slope,null);assert.equal(row.status,"partial");
  }
  const f=fixture();f.snapshot.studies[0].inputs[0].value=600;
  const row=summarize(f).moving_averages[0];
  assert.equal(row.value,128);assert.equal(row.verification.status,"insufficient_loaded_history");assert.equal(row.status,"partial");
});

test("slopes expose elapsed closure time and all supported price sources are independently verified", () => {
  for(const src of ["open","high","low","close","hl2","hlc3","ohlc4"]) {
    const f=fixture(), study=f.snapshot.studies[0];study.inputs[1].value=src;
    const p=b=>src==="hl2"?(b.high+b.low)/2:src==="hlc3"?(b.high+b.low+b.close)/3:src==="ohlc4"?(b.open+b.high+b.low+b.close)/4:b[src];
    for(let i=2;i<30;i++) study.bars[i].values.plot_0=f.ohlcv.bars.slice(i-2,i+1).reduce((s,b)=>s+p(b),0)/3;
    for(const collection of [f.ohlcv.bars,study.bars]) for(const b of collection.slice(28)) {b.time+=172800;b.timeIso=new Date(b.time*1000).toISOString();}
    const row=summarizeMovingAverages(f.ohlcv,f.snapshot,symbol,"60",new Date("2020-01-10T00:00:00Z")).moving_averages[0];
    assert.equal(row.verification.status,"matched_native_ohlcv_sma");assert.equal(row.slope.elapsed_seconds,176400);
  }
});

function fakeApi(f=fixture()) {
  let contextCalls=0,snapshotCalls=0;
  const context={activeChartIndex:0,charts:[{index:0,symbol,resolution:"60",studies:[{id:"sma1",name:"Simple Moving Averages"}]}]};
  return {getChartContext:async()=>{contextCalls++;return structuredClone(context);},getReplayStatus:async()=>({available:true,started:false,toolbarVisible:false}),
    getOhlcv:async()=>structuredClone(f.ohlcv),getMovingAverageStudies:async()=>{snapshotCalls++;return structuredClone(f.snapshot);},
    counts:()=>({contextCalls,snapshotCalls})};
}

test("moving-average acquisition binds native chart and stable settings without chart writes",async()=>{
  const tv=fakeApi(), r=await buildMovingAverageContext(tv,{symbol,expectedTimeframe:"60"},()=>new Date("2020-01-03T00:00:00Z"));
  assert.equal(r.chart_changes,false);assert.equal(r.chart_index,0);assert.equal(r.moving_averages[0].value,128);
  assert.equal(tv.counts().snapshotCalls,2);
});

test("acquisition refuses Replay, wrong feed, index, timeframe and setting drift",async()=>{
  const now=()=>new Date("2020-01-03T00:00:00Z"), options={symbol,expectedTimeframe:"60"};
  for(const patch of [{symbol:"FX:EURUSD"},{expectedTimeframe:"240"},{chartIndex:-1},{count:1001},{expectedTimeframe:"1M"}])
    await assert.rejects(buildMovingAverageContext(fakeApi(),{...options,...patch},now));
  const replay=fakeApi();replay.getReplayStatus=async()=>({available:true,started:true});
  await assert.rejects(buildMovingAverageContext(replay,options,now),/Replay/);
  const drift=fakeApi();const original=drift.getMovingAverageStudies;let reads=0;
  drift.getMovingAverageStudies=async()=>{const s=await original();if(++reads===2)s.studies[0].inputs[0].value=7;return s;};
  await assert.rejects(buildMovingAverageContext(drift,options,now),/changed/);
  const index=fakeApi();index.getMovingAverageStudies=async()=>({...fixture().snapshot,chartIndex:1});
  await assert.rejects(buildMovingAverageContext(index,options,now),/index/);
  const lateReplay=fakeApi();let replayReads=0;lateReplay.getReplayStatus=async()=>({available:true,started:++replayReads>1});
  await assert.rejects(buildMovingAverageContext(lateReplay,options,now),/Replay/);
});

test("empty native history, no supported studies and invalid plot times stay explicit",()=>{
  const f=fixture();f.ohlcv.bars=[];const r=summarize(f);
  assert.equal(r.status,"partial");assert.equal(r.moving_averages[0].value,null);
  const unsupported=fixture();unsupported.snapshot.studies=[];unsupported.snapshot.unmappedStudies=[{id:"other",name:"EMA",metaId:"unverified"}];
  assert.equal(summarize(unsupported).moving_averages.length,0);
  const bad=fixture();bad.snapshot.studies[0].bars[2].time=bad.snapshot.studies[0].bars[1].time;
  assert.throws(()=>summarize(bad),/strictly ordered/);
});
