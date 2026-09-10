# Local Research Reproduction

This first version reruns the fixed `summarizeBacktestLedger` calculation on a
saved ledger. It does not rerun the strategy, create trades, access TradingView,
authorize OOS use, execute supplied commands, or establish profitability.

```sh
npm run reproduce:research -- --input /absolute/config.json --output /absolute/new-report.json --confirm-local-read
```

Configuration (all paths must be absolute):

```json
{
  "task": "backtest_ledger_summary_v1",
  "ledger_file": "/absolute/ledger.json",
  "parameters_file": "/absolute/summary-request.json",
  "expected_result_sha256": "sha256:<64 lowercase hex digits>",
  "dependency_lockfile": "/absolute/package-lock.json"
}
```

The parameters file contains the original `backtestLedgerSummarySchema` request,
including its expected normalized `artifact_id` and explicit round-trip cost.
The expected result digest is SHA-256 of UTF-8 `JSON.stringify` of the original
`summarizeBacktestLedger` output, without a newline. Use a saved baseline from
before the proposed change, not a freshly selected result. Caller-supplied
expectations are not authenticated or treated as preregistration. MCP response
wrappers and journal fields are not part of this result digest.

The CLI generates evidence before execution, checks the actual consumed ledger
and parameter bytes against it, reruns the fixed function, and generates evidence
again. Changed evidence aborts the run. Missing axes stay null. The code and
runner hashes cover selected built entrypoint files, not the complete dependency
tree or proof of already-loaded module bytes. See [generation limits](RESEARCH_EVIDENCE_GENERATION.md).

Exit codes: 0 = matching result; 2 = different result with report saved;
1 = validation, read, computation, or persistence failure. Errors are redacted.
Reports contain hashes, evidence, and the verdict, not trade returns or input
paths. Output is staged privately, fsynced, then published via an exclusive hard
link. Existing files and symlinks are not overwritten. Filesystems must support
hard links. A failure before publication leaves no final report; a directory-sync
failure after publication may leave complete bytes but is not reported as success.
An abrupt process stop may leave a private staging directory. Windows ACLs remain
the operator's responsibility.

This local verification path does not write a research usage journal. Repeated
comparisons can still reveal information through match/mismatch; it must not be
used to claim an untouched holdout. No shell, subprocess runner, network, strategy
execution, statistical recalibration, or automated research acceptance is added.
