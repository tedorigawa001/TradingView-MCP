import test from "node:test";
import assert from "node:assert/strict";
import { runMutation,replaceOnce as edit } from "../helpers/committedPagingMutationHarness.mjs";
const verifier=new URL("../../build/internal/nativeBarCommittedSemantic.js",import.meta.url);
const entry=new URL("../../build/nativeBarCommittedTransactions.js",import.meta.url);
const regression=new URL("./nativeBarCommittedTransactions.test.mjs",import.meta.url);
const pattern="store-wide sequence|supplied receipt fallback|supplied-copy ordering|declared future day|day comparison|residual payload time bounds";
const mutations=[
 ["G01",s=>edit(s,"checkStoreSequences(legacy, null, b);","")],
 ["G02",s=>edit(s,"checkStoreSequences(legacy, snapshot, b);","")],
 ["G03",s=>edit(s,"for (const ref of m.value.pairs)\n            bind(ref.sequence, ref.recording_id);","")],
 ["G04",s=>edit(s,"for (const r of legacy.receipts)\n        bind(r.value.sequence, r.value.recording_id);","")],
 ["G05",s=>edit(s,"if (snapshot)\n        for (const r of snapshot.values())\n            bind(r.value.sequence, r.value.recording_id);","")],
 ["G06",s=>edit(s,"owner !== undefined && owner !== id","false")],
 ["G07",s=>edit(s,"owner !== undefined && owner !== id","owner !== undefined")],
 ["G08",s=>edit(s,"for (const m of legacy.legacy) {\n        b.charge();\n        for (const ref of m.value.pairs)","for (const m of legacy.legacy) {\n        b.charge(); owners.clear();\n        for (const ref of m.value.pairs)")],
 ["T01",s=>edit(s,"snapshot?.get(ref.recording_id) ?? (raw ? { value: raw.value, hash: raw.hash, bytes: raw.bytes, previous_recorded_at: null } : undefined)","snapshot?.get(ref.recording_id)")],
 ["T02",s=>edit(s,"checkLegacyBatchOrder(known, payloads, b);","")],
 ["D01",s=>edit(s,"ref.recorded_at !== undefined && ref.day > ref.recorded_at.slice(0, 10)","false")],
 ["D02",s=>edit(s,"ref.day > ref.recorded_at.slice(0, 10)","ref.day >= ref.recorded_at.slice(0, 10)")],
 ["D03",s=>edit(s,"ref.recorded_at !== undefined && ref.day > ref.recorded_at.slice(0, 10)","ref.day > (ref.recorded_at ?? '1970-01-01T00:00:00.000Z').slice(0, 10)")],
 ["O01",s=>{
   s=edit(s,"function checkLegacyBatchOrder(known, payloads, b) {","function checkLegacyBatchOrder(known, payloads, b) {");
   const a=s.indexOf("function checkLegacyBatchOrder("),c=s.indexOf("function checkLegacyReference(",a);
   const body=s.slice(a,c).replace("let previousAt = null;","let previousAt = b.__carriedLegacyTime ?? null;");
   return s.slice(0,a)+body.replace(/\n}\n$/, "\n    b.__carriedLegacyTime = previousAt;\n}\n")+s.slice(c);
 }],
];
test("extracted v3 kernel preserves the ten guard controls and detects the fourteen targeted mutations",()=>{
 const control=runMutation(verifier,regression,s=>s,pattern,entry);
 assert.equal(control.code,0,control.output);assert.match(control.output,/tests 10\b/);
 for(const [name,change] of mutations){
  const r=runMutation(verifier,regression,change,pattern,entry);assert.equal(r.error,undefined,`${name}: ${r.error}`);
  assert.notEqual(r.code,0,`${name} survived`);assert.match(r.output,/AssertionError/,`${name}: ${r.output}`);
  console.log(`${name} detected ${r.hash.slice(0,12)}`);
 }
});

test("stage A page guard mutations are detected after their unmodified controls pass",()=>{
 const module=new URL("../../build/internal/nativeBarCommittedPages.js",import.meta.url),tests=new URL("./nativeBarCommittedPages.test.mjs",import.meta.url);
 const control=runMutation(module,tests,s=>s,"stage A");assert.equal(control.code,0,control.output);
 const cases=[
  ["P01",s=>edit(s,'digest(encode(s, LIMITS.record_bytes, b), b) !== root.snapshot_generation','false')],
  ["P02",s=>edit(s,'digest(bytes[ref.index], b) !== ref.hash','false')],
  ["P03",s=>edit(s,'ref.index !== i + 1 || ref.index >= bytes.length || rank < lastKind ||\n                ref.ordinal !== (rank === lastKind ? lastOrdinal + 1 : 0)','false')],
  ["P04",s=>edit(s,'page.commitment !== collection.commitment','false')],
  ["P05",s=>edit(s,'page.entries.length !== ref.entry_count','false')],
  ["P06",s=>edit(s,'values.length !== collection.total_entries','false')],
  ["P07",s=>edit(s,'digest(encode({ schema: "native-bar-committed-collection-preparation-v1", kind, entries: values }, LIMITS.input_bytes, b), b) !== collection.commitment','false')],
  ["P08",s=>edit(s,'s.baseline_generation !== baselineGeneration','false')],
  ["P09",s=>edit(s,'manifestIds.has(r.recording_id) || r.sequence <= previousSequence','false')],
  ["P10",s=>edit(s,'ref.kind === "baseline_receipts" && rows[ref.kind].length + page.entries.length > LIMITS.store_receipts','false')],
  ["P11",s=>edit(s,'digest(raw, b) !== d.hash','false')],
  ["P12",s=>edit(s,'e.evidence_hash !== digest(encode(evidence, LIMITS.input_bytes, b), b)','false')],
 ];
 for(const [name,change] of cases){const r=runMutation(module,tests,change,"stage A");assert.equal(r.error,undefined,`${name}: ${r.error}`);
  assert.notEqual(r.code,0,`${name} survived`);assert.match(r.output,/AssertionError/,r.output);console.log(`${name} detected ${r.hash.slice(0,12)}`);}
});
