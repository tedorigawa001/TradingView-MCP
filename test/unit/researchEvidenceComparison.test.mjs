import test from 'node:test';
import assert from 'node:assert/strict';
import { compareResearchEvidence, researchEvidenceManifestSchema } from '../../build/researchEvidenceComparison.js';
const hash = c => 'sha256:' + c.repeat(64);
const keys = ['data_sha256','code_sha256','runner_sha256','candidate_rule_sha256','parameters_sha256','environment_sha256'];
const manifest = () => Object.fromEntries(keys.map(k => [k,hash('a')]));
const expectedChecks = [
  ['verify_source_coverage_and_point_in_time','rerun_results'],
  ['run_regression_tests','reproduce_previous_ledger','review_statistical_calibration_impact'],
  ['run_regression_tests','reproduce_previous_ledger','review_statistical_calibration_impact'],
  ['recalibrate_candidate_gate','reassess_selection_bias','use_separate_contract'],
  ['rerun_results','reassess_selection_bias','review_statistical_calibration_impact'],
  ['reproduce_previous_ledger','run_regression_tests'],
];
const notProof = r => {
  assert.equal(r.compatibility_proven,false);
  assert.equal(r.candidateEligible,false);
  assert.equal(r.statistical_calibration,'not_assessed');
};

test('equal declarations never prove compatibility, calibration or eligibility', () => {
  const r=compareResearchEvidence({previous:manifest(),current:manifest()});
  assert.equal(r.status,'matching_declarations');
  assert.equal(r.compatibility_proven,false);
  assert.equal(r.statistical_calibration,'not_assessed');
  assert.equal(r.candidateEligible,false);
  assert.deepEqual(r.required_checks,[]);
});
test('every changed axis is reported even with identical data', () => {
  for(const key of keys) {
    const r=compareResearchEvidence({previous:manifest(),current:{...manifest(),[key]:hash('b')}});
    assert.equal(r.status,'changed');
    assert.deepEqual(r.changed_fields,[key]);
    assert.equal(r.revalidation,'required');
    assert.ok(r.required_checks.length>0);
    assert.deepEqual(r.required_checks,expectedChecks[keys.indexOf(key)]);
    notProof(r);
    if(key!=='data_sha256') assert.equal(r.fields[0].status,'match');
    if(key==='candidate_rule_sha256') assert.ok(r.required_checks.includes('recalibrate_candidate_gate'));
  }
});
test('missing values on either or both sides stay unknown and do not hide changes', () => {
  for(const key of keys) for(const side of ['previous','current']) for(const value of [null,undefined]) {
    const pair={previous:manifest(),current:manifest()};
    pair[side][key]=value;
    const result=compareResearchEvidence(pair);
    assert.deepEqual(result.unknown_fields,[key]);
    assert.deepEqual(result.changed_fields,[]);
    assert.deepEqual(result.required_checks,['supply_and_verify_missing_evidence']);
    notProof(result);
  }
  for(const previous of [{},manifest()]) {
    const r=compareResearchEvidence({previous,current:{}});
    assert.equal(r.status,'incomplete');
    assert.equal(r.unknown_fields.length,6);
    assert.equal(r.revalidation,'undetermined');
  }
  const r=compareResearchEvidence({previous:manifest(),current:{...manifest(),code_sha256:hash('b'),data_sha256:null}});
  assert.equal(r.status,'incomplete');
  assert.equal(r.revalidation,'required');
  assert.deepEqual(r.changed_fields,['code_sha256']);
  assert.deepEqual(r.unknown_fields,['data_sha256']);
  notProof(r);
});
test('strict bounded inputs reject malformed hashes and extra fields', () => {
  for(const value of ['abc','sha256:'+'A'.repeat(64),'sha256:'+'a'.repeat(65),{},12])
    assert.throws(()=>researchEvidenceManifestSchema.parse({data_sha256:value}));
  assert.throws(()=>compareResearchEvidence({previous:{path:'/tmp/x'},current:{}}));
  assert.throws(()=>compareResearchEvidence({previous:{},current:{},execute:true}));
});
test('ordering is deterministic, does not mutate input, and deduplicates checks', () => {
  const previous=manifest(), current=Object.fromEntries([...keys].reverse().map(k=>[k,hash('b')]));
  const copy=structuredClone({previous,current});
  const a=compareResearchEvidence(copy), b=compareResearchEvidence({previous,current});
  assert.deepEqual(a,b);
  assert.deepEqual(a.changed_fields,keys);
  assert.equal(new Set(a.required_checks).size,a.required_checks.length);
  assert.deepEqual(a.required_checks,[...new Set(expectedChecks.flat())]);
  assert.deepEqual(copy,{previous,current});
});
