# Local Research Evidence Generation

The CLI hashes explicit local files and captures its own Node runtime metadata.
It generates the six-field `manifest` accepted by `compare_research_evidence`.
It does not discover dependencies, execute a strategy, contact providers or
authenticate the source of the files. Research inputs remain local.

## Run

```sh
npm run generate:research-evidence -- --input /absolute/config.json --confirm-local-read --output /absolute/private/evidence.json
```

The installed bin is `tradingview-mcp-generate-evidence`. `--output` is optional;
without it the report is printed as JSON. With it, the existing parent directory
must be a regular directory and the output must be new. The CLI creates an
owner-only file and syncs the file and, where supported, directory. Existing
files and symbolic-link outputs are never overwritten. A failed write/sync may
leave an incomplete or unconfirmed file; success is not reported. Inspect it and
use a new output name instead of treating it as a completed artifact.

Example configuration (omit unknown axes, do not invent placeholder evidence):

```json
{
  "data": [{"id": "normalized-ledger", "path": "/absolute/ledger.json"}],
  "code": [{"id": "strategy", "path": "/absolute/strategy.js"}],
  "runner": [{"id": "runner", "path": "/absolute/runner.js"}],
  "candidate_rule": [{"id": "frozen-rule", "path": "/absolute/rule.json"}],
  "parameters": [{"id": "effective-parameters", "path": "/absolute/parameters.json"}],
  "dependency_lockfile": "/absolute/package-lock.json"
}
```

Each axis allows 1–20 files with distinct logical IDs. All source paths must be
absolute. There is no recursion, glob expansion, shell evaluation or implicit
repository scan. Include all relevant source/build files and effective settings
explicitly; a commit ID cannot stand in for dirty working files. Do not select
credentials or use sensitive values as logical IDs. Raw file contents, paths,
process arguments and environment variable values are not included in the report.
The CLI success summary is path-free (`written: true` and `manifest`). Known
generator failures show only registered codes and fixed, path-free messages:
`EVIDENCE_INPUT_MISSING`, `EVIDENCE_INPUT_NOT_REGULAR`,
`EVIDENCE_INPUT_ACCESS_DENIED`, `EVIDENCE_INPUT_CHANGED`,
`EVIDENCE_FILE_LIMIT`, and `EVIDENCE_BYTE_BUDGET`.
JSON parsing, schema validation and unclassified failures remain redacted because
their messages can contain source text. Arbitrary error codes/messages are never
printed. Config-file and output-file errors are still unclassified.

## Hash Recipe

`explicit_file_bytes_sha256_v1` hashes exact bytes, including whitespace. Each
descriptor contains axis, logical ID, SHA-256 and byte count. Descriptors within
an axis are sorted by ID using lexical code-unit order. The axis digest hashes
UTF-8 JSON of `{recipe, axis, files}` in that property order; descriptor order is
`axis, id, sha256, bytes`. Paths and generation time are excluded, so relocating
identical inputs preserves hashes. Changing IDs changes the declared scope.
An explicitly selected empty file is real zero-byte evidence, not a missing axis.

The environment digest hashes `{recipe, environment}`. Environment captures Node
version, sorted `process.versions`, platform, architecture, OS release and the
specified dependency-lock descriptor. Without a lockfile the environment digest
is null, although partial runtime details are still returned. Other omitted axes
are also null. Pass `report.manifest`, not the full report, to the comparison tool.
Do not mix this recipe with prior raw-file or normalized-ledger hashes without
acknowledging that the digest contracts differ.

## Verification Limits

Inputs must be regular non-symlink files. Each file is streamed with a 128 MiB
limit; each pass permits 512 MiB total, counting files reused across axes again.
The config uses the existing bounded 32 MiB reader. Every file is re-read in a
second pass; content digest, size, identity and change timestamps must agree.
No report is returned on a detected change. Use smaller explicit artifacts for
larger research datasets; this tool does not silently truncate or hash prefixes.

Two passes are not an atomic multi-file snapshot. Inputs can change after their
last check, parent-directory symlinks and hostile same-user races are not fully
prevented, and filesystem calls have no hard I/O timeout. Use an immutable input
snapshot for an experiment and bind the report to its actual execution separately.

Runtime metadata describes this CLI process, not a past, Python, Java, remote or
TradingView execution. A lockfile does not verify installed dependency bytes.
Flags, secrets, external services, GPU state and environmental settings are not
automatically captured. Include non-sensitive effective settings explicitly where
needed. These limitations remain even when all six digests are non-null.

Generated hashes prove neither actual execution nor preregistration, complete
scope, OOS freshness, source authenticity or statistical calibration.
`candidateEligible` and `source_authenticated` remain false. No MCP arbitrary-path
reader, automatic OOS approval or frozen-contract migration is added.
