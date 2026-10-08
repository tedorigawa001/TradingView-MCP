import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { replayFile } from './replay.mjs';

// Invoked after the Java build by test.mjs, also on SDK-free CI.
test('raw-to-Java replay shares bounded normalization and preserves evidence bytes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-replay-'));
  try {
    const base = {schema_version:'1.2',source:'bookmap',instrument_alias:'6EU6.CME@BMD'};
    const instrument = {...base,event_type:'instrument',bookmap_time_ns:null,symbol:'6EU6',exchange:'CME',
      is_crypto:false,is_full_depth:true,mbo_captured:false,depth_listener_representation:'price_level_aggregated',
      tick_size:0.00005,multiplier:125000,size_multiplier:1,data_delay_raw:900000000000};
    const trade = (time, price) => ({...base,event_type:'trade',bookmap_time_ns:String(time),price_level:price,size:1,aggressor:'buy',is_otc:false});
    const bbo = time => ({...base,event_type:'bbo',bookmap_time_ns:String(time),bid_price_level:23053,ask_price_level:23054,bid_size:1,ask_size:1});
    // The trade off the price grid (23052.5) is not scored, and it breaks the run of the two before it (BACKLOG
    // 102-23): the sweep is the three that follow it.
    const rows = [instrument,{...base,event_type:'snapshot_end',bookmap_time_ns:'0'},
      trade(1,23051.000000000004),trade(2,23052),trade(3,23052.5),trade(4,23052.999999999996),trade(5,23054),trade(6,23055),
      bbo(7),bbo(60000000007),{...base,event_type:'collector_stop',bookmap_time_ns:'60000000008'}];
    const bytes = rows.map(r=>JSON.stringify(r)).join('\n')+'\n';
    const path = join(dir,'raw.jsonl');
    writeFileSync(path,bytes);
    const config = {minimumTrades:3,minimumLevels:3,windowMs:10000,episodeGapMs:30000,horizonMs:60000,toleranceMs:1000};
    const result = replayFile(path,config);
    assert.equal(result.price_level_policy,'nearest_integer_within_4_ulps_v1');
    assert.equal(result.sweep_continuity_policy,'trade_without_price_level_breaks_run_v1');
    assert.equal(result.normalized_price_callbacks,2);
    assert.equal(result.normalized_positive_trade_callbacks,2);
    assert.equal(result.off_grid_price_callbacks_excluded,1);
    assert.equal(result.eligible_positive_trade_callbacks,5);
    assert.equal(result.sweep_signals,1);
    assert.equal(result.deterministic_replay,true);
    assert.equal(result.evidence[0].index,7);
    assert.equal(result.evidence[0].entry.price_level,23054);
    assert.equal(result.evidence[0].exit.price_level,23053);
    assert.equal(result.evidence[0].status,'quote_endpoints_available');
    assert.equal(readFileSync(path,'utf8'),bytes);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});

test('a trade off the price grid between two buys breaks their run in the raw-to-Java replay (BACKLOG 102-23)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'sweep-replay-'));
  try {
    const base = {schema_version:'1.2',source:'bookmap',instrument_alias:'6EU6.CME@BMD'};
    const instrument = {...base,event_type:'instrument',bookmap_time_ns:null,symbol:'6EU6',exchange:'CME',
      is_crypto:false,is_full_depth:true,mbo_captured:false,depth_listener_representation:'price_level_aggregated',
      tick_size:0.00005,multiplier:125000,size_multiplier:1,data_delay_raw:900000000000};
    const trade = (time, price, aggressor, size = 1) => ({...base,event_type:'trade',bookmap_time_ns:String(time),price_level:price,size,aggressor,is_otc:false});
    const config = {minimumTrades:3,minimumLevels:3,windowMs:10000,episodeGapMs:30000,horizonMs:60000,toleranceMs:1000};
    const sweeps = (between) => {
      const rows = [instrument,{...base,event_type:'snapshot_end',bookmap_time_ns:'0'},
        trade(1,100,'buy'),trade(2,101,'buy'),between,trade(4,102,'buy'),
        {...base,event_type:'collector_stop',bookmap_time_ns:'5'}];
      const path = join(dir,'raw.jsonl');
      writeFileSync(path,rows.map(r=>JSON.stringify(r)).join('\n')+'\n');
      return replayFile(path,config).sweep_signals;
    };
    assert.equal(sweeps(trade(3,101.5,'sell')),0);
    assert.equal(sweeps(trade(3,101.5,'unknown')),0);
    // Carrying no quantity, it is no trade and breaks nothing.
    assert.equal(sweeps(trade(3,101.5,'sell',0)),1);
  } finally { rmSync(dir,{recursive:true,force:true}); }
});
