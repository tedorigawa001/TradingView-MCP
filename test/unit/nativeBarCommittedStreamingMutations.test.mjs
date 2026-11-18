import test from "node:test";
import assert from "node:assert/strict";
import {runGraphMutation,replaceOnce as edit} from "../helpers/committedPagingMutationHarness.mjs";
const entry=new URL("../../build/internal/nativeBarCommittedStreaming.js",import.meta.url),
 core=new URL("../../build/internal/nativeBarCommittedStreamCore.js",import.meta.url),
 arena=new URL("../../build/internal/nativeBarCommittedSummaryArena.js",import.meta.url),
 shared=new URL("../../build/internal/nativeBarCommittedSemantic.js",import.meta.url),
 tests=new URL("./nativeBarCommittedStreaming.test.mjs",import.meta.url);
const cases=[
 ["ST01",core,s=>edit(s,'this.#hashes.has(index) && this.#hashes.get(index) !== sha','false'),'stream frames bind'],
 ["ST02",core,s=>edit(s,'this.#roles.has(index) && this.#roles.get(index) !== role','false'),'stream frames bind'],
 ["ST03",core,s=>edit(s,'this.#snapshot !== null && this.#snapshot !== generation','false'),'stream frames bind'],
 ["ST04",core,s=>edit(s,'if (this.#active)\n            b.stop("stream_nested_frame");\n        this.#cached = null;',
  'if (false)\n            b.stop("stream_nested_frame");\n        this.#cached = null;'),'stream frames bind'],
 ["ST05",core,s=>edit(s,'const nextBlocks = blocks(size + n);','const nextBlocks = paidBlocks + blocks(n);'),'stream canonical byte boundary'],
 ["ST06",core,s=>{
   const line='b.charge(2 * (nextBlocks - paidBlocks) + 1); // Copy/comparison + hashing, before either operation.';
   return edit(edit(s,line,''),'hash.update(text);','hash.update(text); '+line);
 },'stream canonical stops before hash output'],
 ["ST07",entry,s=>edit(s,'const value = parse(schema, { ...decoded, bytes: raw.length }, b);','const value = role === "payload_v1" ? decoded.value : parse(schema, { ...decoded, bytes: raw.length }, b);'),'stream validates the fourth series'],
 ["ST08",entry,s=>edit(s,'Math.floor(store.total / 128)','LIMITS.pairs'),'stream counts all 1025 manifest'],
 ["ST09",entry,s=>edit(s,'verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, b, "paged-stage-a")',
  'verifyCommittedLogical(records, { policy_hash: s.policy_hash, inventory: rows.inventory, evaluation: s.evaluation }, Object.assign(new StreamBudget(), { releaseIntentProofs: b.releaseIntentProofs }), "paged-stage-a")'),'stream pays wire'],
 ["ST10",arena,s=>edit(s,'this.#erase(child, true);',''), 'stream proof release'],
 ["ST11",shared,s=>edit(s,'b.releaseIntentProofs?.(binding);','void binding;'),'stream preserves prune/complete'],
 ["ST12",shared,s=>edit(s,'proof.uid !== binding.root.uid || proof.gid !== binding.root.gid','false'),'stream retains (root ownership|parent ownership)'],
 ["ST13",shared,s=>edit(s,'needed.size !== parents.size || [...needed].some(p => { b.charge(); return !parents.has(p); })','false'),'stream retains parent scope'],
 ["ST14",shared,s=>edit(s,'checkLegacyBatchOrder(known, payloads, b);',''),'stream preserves early-null'],
 ["ST15",shared,s=>edit(s,'if (!view.completed)\n            blockers.push("transaction_incomplete");','if (!view.completed && format === "v3")\n            blockers.push("transaction_incomplete");'),'stream preserves prune/intent'],
 ["ST16",entry,s=>edit(s,'key === "root" || key === "parents"','false'),'stream retains root ownership'],
 ["ST17",entry,s=>edit(s,'replayRows.get(row)?.release();','void row;'),'stream preserves prune/complete'],
 ["ST18",entry,s=>edit(s,'replayRows.get(row)?.stripActions();','void row;'),'stream preserves prune/complete'],
 ["ST19",entry,s=>edit(s,'replayRows.get(previousAttempt)?.release();','void previousAttempt;'),'stream retains original intent through resumed'],
 ["ST20",core,s=>edit(s,'if (!this.#cached || this.#cached.index !== index || this.#cached.role !== role || this.#cached.hash !== expected || this.#cached.snapshot !== this.#snapshot)',
  'if (true)'),'stream packed'],
 ["ST21",entry,s=>{
   s=edit(s,'decoded = decodeStream(slice, b);','decoded = decodeStream(raw, b);');
   return edit(s,'const v = parse(pairSchema, { ...decoded, bytes: slice.length }, b);','const v = parse(newSchemas.manifest, { ...decoded, bytes: raw.length }, b).pairs[ordinal];');
 },'stream packed'],
 ["ST22",core,s=>{
  const pay='b.charge(2 * bound + 1); // Enumeration and key-array allocation, before Object.keys or proxy traps.';
  return edit(edit(s,pay,''),'const keys = Object.keys(value);','const keys = Object.keys(value); '+pay);
 },'stream canonical prepays key enumeration'],
 ["ST23",core,s=>edit(s,'digest(new Uint8Array(source), b) !== cached.hash','false'),'stream indexed frame cache'],
 ["ST24",core,s=>edit(s,'this.#cached = null; // Evict before a different private frame can be copied.',''),'stream indexed frame cache'],
 ["ST25",core,s=>edit(s,'spans[i * 2 + 1] = cursor;','spans[i * 2 + 1] = cursor - 1;'),'stream packed'],
];
test("stream mutations have passing controls and detect snapshot, lifetime, budget and semantic regressions",()=>{
 for(const [id,module,change,pattern] of cases){
  const control=runGraphMutation(entry,module,tests,s=>s,pattern);
  assert.equal(control.error,undefined,`${id} control: ${control.error}`);assert.equal(control.code,0,control.output);assert.match(control.output,/tests [1-9][0-9]*\b/);
  const mutant=runGraphMutation(entry,module,tests,change,pattern);
  assert.equal(mutant.error,undefined,`${id}: ${mutant.error}`);assert.notEqual(mutant.code,0,`${id} survived`);assert.match(mutant.output,/AssertionError/,mutant.output);
  console.log(`${id} detected ${mutant.hash.slice(0,12)}`);
 }
});
