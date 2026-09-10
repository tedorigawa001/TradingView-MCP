# Research Evidence Comparison

`compare_research_evidence` compares two caller-supplied manifests, `previous`
and `current`. This is a bounded, read-only metadata comparison, not an artifact
reader, environment collector, experiment rerunner, or preregistration system.
It neither stores reports nor verifies that submitted hashes describe real files.
The separate [local generation CLI](RESEARCH_EVIDENCE_GENERATION.md) can create
`manifest` from explicitly selected files and the current Node environment.
The comparison tool still treats submitted manifests as caller-supplied.

## Manifest Contract

Both manifests use the same six fields. Each accepts a lowercase
`sha256:` digest with 64 hexadecimal digits, or null. Omitted fields become null.
Other fields are rejected. Unknown evidence must remain null, not a hash of an
empty placeholder. Use identical digest construction rules across runs.

| Field | Content the producer should cover |
|---|---|
| `data_sha256` | Exact input snapshot, provenance and covered population/period |
| `code_sha256` | Executed implementation and relevant local dependencies, including uncommitted changes |
| `runner_sha256` | Executed orchestration, preprocessing, alignment and selection procedure |
| `candidate_rule_sha256` | Frozen decision/statistical rule and calibration contract |
| `parameters_sha256` | All effective parameters, defaults, costs, folds, seeds and search settings |
| `environment_sha256` | Runtime/library versions, dependency lock, platform and execution settings |

These scopes are a producer responsibility, not something the tool can inspect.
Version names or Git commit IDs alone do not capture dirty source, lockfile
changes or all execution settings. For structured manifests, use a stable
canonical serialization with declared field ordering/array semantics before
hashing; for byte artifacts, hash the exact bytes. Do not silently change this
recipe. The tool only identifies which digest axes differ, not which underlying
parameter or dependency changed. Keep the underlying manifests locally for review.

## Result

Every axis is `match`, `changed` or `unknown`. Null on either side is unknown,
including null on both sides. The aggregate status is `incomplete` if any axis
is unknown; known changes remain visible in `changed_fields`. Otherwise it is
`changed` or `matching_declarations`. A data match never hides a code/rule change.

`revalidation` is `required` for any known change, `undetermined` for missing
evidence without a known change, or `no_change_identified` for matching declarations.
`required_checks` is a deduplicated review checklist, not executed tests or a
complete proof of which checks suffice:

- Data: source coverage, point-in-time evidence and rerun results.
- Code/runner: regression tests, previous-ledger reproduction and calibration impact review.
- Candidate rule: recalibrate the gate, reassess selection bias and use a separate contract.
- Parameters: rerun, reassess selection bias and review calibration impact.
- Environment: regression tests and previous-ledger reproduction.
- Missing evidence: supply and verify it before judging equivalence.

Matching declarations are not compatibility, provenance, repeatability, unused
OOS, or statistical-calibration proof. `compatibility_proven` and
`candidateEligible` always remain false; `statistical_calibration` is
`not_assessed`. Existing frozen contracts and candidate gates are unchanged.
No chart, orders, filesystem paths, network requests or executable payloads are
used by this tool. The local CLI provides explicit-file hashing, not automatic
dependency discovery or result reproduction; those remain separate work.
