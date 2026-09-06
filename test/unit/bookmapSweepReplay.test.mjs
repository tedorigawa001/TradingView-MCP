import test from 'node:test';
import assert from 'node:assert/strict';
import { quoteCoverage, parseRaw } from '../../bookmap-addon/replay.mjs';
const row = (index, ms, type='bbo') => ({index, ns:BigInt(ms)*1000000n, bookmap_time_ns:String(BigInt(ms)*1000000n),event_type:type,afterSnapshot:true,bid_price_level:100,ask_price_level:101,bid_size:1,ask_size:1});
const signal = {index:0,direction:'BUY',episodeIndex:1};
test('replay binds subsequent entry and timed exit to executable sides deterministically',()=>{
 const rows=[row(0,0,'trade'),row(1,0),row(2,60000)];
 const run=()=>quoteCoverage(rows,[signal],{horizonMs:60000,toleranceMs:1000});
 assert.deepEqual(run(),run());
 assert.equal(run()[0].entry.index,1);
 assert.equal(run()[0].entry.price_level,101);
 assert.equal(run()[0].exit.price_level,100);
 assert.equal(run()[0].status,'quote_endpoints_available');
});
test('replay rejects stale endpoints and never uses crossed quotes',()=>{
 assert.equal(quoteCoverage([row(0,0,'trade'),row(1,1001)],[signal],{horizonMs:60000,toleranceMs:1000})[0].status,'entry_unavailable');
 const rows=[row(0,0,'trade'),{...row(1,1),ask_price_level:99},row(2,2),row(3,61003)];
 const result=quoteCoverage(rows,[signal],{horizonMs:60000,toleranceMs:1000})[0];
 assert.equal(result.entry.index,2);
 assert.equal(result.status,'exit_unavailable');
});
test('replay refuses signal evidence and truncated raw JSONL',()=>{
 assert.throws(()=>parseRaw(Buffer.from('{}')),/tail/);
 assert.throws(()=>parseRaw(Buffer.from('{"source":"bookmap_flow_signal_research"}\n')),/provenance/);
});
test('replay uses sell bid entry and ask exit; rejects episode repeats and overlapping positions',()=>{
 const rows=[row(0,0,'trade'),row(1,0),row(2,1,'trade'),row(3,60000)];
 const result=quoteCoverage(rows,[{...signal,direction:'SELL'},{...signal,index:2,episodeIndex:2},{...signal,index:2}],{horizonMs:60000,toleranceMs:1000});
 assert.equal(result[0].entry.price_level,100);
 assert.equal(result[0].exit.price_level,101);
 assert.equal(result[1].status,'same_episode');
 assert.equal(result[2].status,'position_overlap');
 assert.throws(()=>quoteCoverage(rows,[{...signal,direction:'unknown'}],{horizonMs:60000,toleranceMs:1000}),/direction/);
});
const meta={schema_version:'1.2',source:'bookmap',event_type:'instrument',bookmap_time_ns:null,instrument_alias:'6EU6.CME@BMD',symbol:'6EU6',exchange:'CME',is_crypto:false,is_full_depth:true,mbo_captured:false,depth_listener_representation:'price_level_aggregated',tick_size:0.00005,multiplier:125000,size_multiplier:1,data_delay_raw:900000000000};
const snapshot={...meta,event_type:'snapshot_end',bookmap_time_ns:'100'};
const trade={...meta,event_type:'trade',bookmap_time_ns:'101',price_level:23000,size:1,aggressor:'buy',is_otc:false};
const raw=rows=>Buffer.from(rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
test('raw parser binds instrument, snapshot, clocks and non-OTC provenance',()=>{
 const parsed=parseRaw(raw([meta,{...trade,bookmap_time_ns:'99'},snapshot,{...trade,bookmap_time_ns:'102'}]));
 assert.equal(parsed[1].afterSnapshot,false);
 assert.equal(parsed[3].afterSnapshot,true);
 assert.equal(parsed[3].ns,102n);
});
test('raw parser rejects regressions, alias mismatch, missing snapshots and OTC trades',()=>{
 assert.throws(()=>parseRaw(raw([meta,snapshot,{...trade,bookmap_time_ns:'99'}])),/regression/);
 assert.throws(()=>parseRaw(raw([meta,snapshot,{...trade,instrument_alias:'other'}])),/alias/);
 assert.throws(()=>parseRaw(raw([meta,trade])),/snapshot/);
 assert.throws(()=>parseRaw(raw([meta,snapshot,{...trade,is_otc:true}])),/metadata/);
});
test('raw parser preserves fractional trade levels without pretending they are integer evidence',()=>{
 const value=23052.999999999996;
 assert.equal(parseRaw(raw([meta,snapshot,{...trade,price_level:value}]))[2].price_level,value);
 assert.throws(()=>parseRaw(raw([meta,snapshot,{...trade,price_level:null}])),/price/);
});
