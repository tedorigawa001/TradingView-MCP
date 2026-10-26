# B3-B Checkpoint Probe And Fixed Memory Oracle

Status: **detailed design proposal; implementation and signing not yet approved**, 2026-10-26 JST. Baseline: `3b202f5`, including the B3-A independent-review corrections and the separately committed B-2c patch `a9188fb`. This document refines [B-3 orchestration](NATIVE_BAR_ADMISSION_JOINT_READ_DESIGN.md), not its market or retention rules. This step changes documentation only.

## Scope And Non-Goals

B3-B adds real process-local request issuance, host observations and cancellation to the existing memory-only checkpoint verifier. It does **not** connect a native reader. Its first usable entry is explicitly a **checkpoint probe**, not a joint read: two checkpoint requests may be authenticated without proving any filesystem observation between them. Probe handles must never become B3-C native-order capabilities.

Dot remains PAUSED. Confirmation counts, observation bands, scenario/notification rules, mail delivery rules, strictly-more-than-90-elapsed-day deletion eligibility, and every current resource ceiling remain unchanged. No real data, filesystem fixture, signed file, key file, network service, MCP registration, startup wiring, persistent log, cleanup or deployment is introduced. No test signing or host clock/RNG execution is performed during this design step.

Keep three distinctions throughout implementation:

1. B3-A supplied observations and model handles are still a pure model with all real qualifications false.
2. B3-B probe handles establish only their actually checked local request/signature facts.
3. B3-C needs its own original query/controller/native-context chain; a successful probe or hand-built result cannot substitute for it.

## Existing Contracts To Preserve

| Contract | Existing behavior | B3-B use |
|---|---|---|
| B-1 `verifyCheckpoint(bytes, request)` | Canonical Ed25519 envelope, fixed public-key/pin binding, lower-case UUID challenge, positive sequence, supplied UTC bracket, 4 KiB envelope | Call it on one owned captured response and the reader's actual bracket; do not replace it with a Boolean claim |
| B-1 `verifyTranscript` | Complete signed record prefix, two checkpoint envelopes, E-A replay | Not called with fabricated/empty records in a checkpoint-only probe |
| B3-A planner | Six inventory/five content passes for the future joint program; V1 native cost stays inside `native_allowance`; nonzero decode/verification/report floors | Reuse unchanged ceilings/floors and add mandatory probe/provider costs; do not redefine `remaining` as a renewed allowance |
| B-2a registration | Complete supplied binding, public SPKI fingerprint, marker/ancestor/root identities | Validate and detach the full binding; do not stat/open its paths |
| B-2c lifecycle | Work stops after release is requested; failed release retains the claim | Apply the same release-only rule to local pending requests; this is not native syscall qualification |

The B-1 checkpoint wire format contains no query ID, phase, registration hash or authority reference. Its signed fields are fixture/store/epoch/authority/key/enrollment, challenge, sequence, tip and `observed_at`. B3-B binds the other fields through its private outstanding-request registry and a unique challenge. It must not silently add fields to the B-1 signature format or say that these outer routing fields are signed.

## Module And Trust Boundary

Proposed files, not registered or implemented by this document:

| Location | Responsibility | Prohibited |
|---|---|---|
| `src/nativeBarAdmissionOracleRegistry.ts` | Process-local two-sided enrollment, original-handle membership, fixed fixture/public-key binding, active claim and bounded lifecycle state | Storage/network/native loader; a public `register(callback/url/signer)` entry |
| `src/nativeBarAdmissionCheckpointProbe.ts` | Actual host clock/RNG/timer, ordered C0/C1 requests, owned response capture, B-1 checks, cancellation and report | Signer/private key, native reader, model-result promotion, requester-selected clock/provider/challenge |
| Fixed helper under `test/helpers/` | Explicitly enrolled, invented memory-oracle state and, only after separate approval, public RFC-vector signing | Arbitrary signing body/key/path, key generation, record-tree lookup, persistent signature/key output |
| Dedicated unit/boundary tests | Finite normal/fault cases, original-token and accounting checks | Startup/MCP consumer or broad native/real-data test runner |

The registry does not import the test helper. The helper's sole internal registration bridge is a named, source-allowlisted import; no reader import can load the helper or signer transitively. The helper installs only its fixed dispatcher through an original one-use owner grant, not through probe request arguments. There is no generic provider-registration export in the normal probe surface. Source checks must allow that bridge only from the fixed helper and reject additional incoming consumers, default/namespace import widening, signer reachability and dynamic loading.

This is a trusted in-process synthetic harness, **not** a security boundary against arbitrary JavaScript already executing in that process. Source restrictions and opaque references prevent accidental/public API substitution; they do not prove that a malicious same-process actor cannot invoke an internal export, replace built-ins or edit module memory. The published test signing seed is not a secret or a real authority credential.

## Two-Sided Enrollment

The trusted setup, outside any query, validates the fixed full B-2 registration plus its digest, authority reference and B-1 public `KeyObject`. Pin the public key's SPKI fingerprint through the existing B-1 checks; a raw object, decorated/forged key, weak key or mismatching key refuses. The fixed memory helper must use the matching published test vector; a requester cannot supply a private key or signer.

Provisional flow:

```text
trusted setup
  createSyntheticCheckpointOracleBootstrap(fixedBinding, fixedPublicKey)
    -> original readerEnrollment, original ownerEnrollment
fixed test helper (separately approved)
  enrollFixedMemoryCheckpointOracle(original ownerEnrollment, inventedState)
    -> private owner control; fixed dispatcher installed
trusted setup
  enrollSyntheticCheckpointProbe(original readerEnrollment)
    -> checkpoint-only session
```

Both grants are opaque and one-use, share the same private enrollment entry and are never accepted as query/request/record capabilities. Owner enrollment must finish before a session becomes ready. Invalid/foreign/used/revoked grants refuse; a failed owner-enrollment attempt invalidates that attempt rather than leaving a partly attached provider. No path lookup, native loading, RNG, request, signature or service startup occurs just by constructing the bootstrap or validating the public key. The helper is created only by its explicit approved test entry.

Private entries also bind the creating process ID and registry generation; public operations and asynchronous completions check both. Serialization, a different process/registry, changed generation or process loss cannot restore original membership. An owning process disappearing is unavailable, not evidence that its cleanup ran or a permission to reconstruct pending work elsewhere.

One logical fixture/store/epoch enrollment has one oracle and one active probe claim. Detect duplicate/aliased registrations in the shared registry, not merely within a session object. This is a supplied-registration exclusion rule, not an observed native inode lock. Duplicate bootstrap attempts, including after revocation, do not replace the old entry or erase its replay state. Retain bounded consumed enrollment/ID tombstones for the registry lifetime; refuse further enrollment on accounting exhaustion. A fresh registry/process is not proof of replay protection across restarts.

The owner holds only detached invented pins, a positive sequence, tip, known/unknown state, a monotonic local generation and bounded pending-request state. It does not rebuild state from record trees, old checkpoints, request-supplied tips or a report. Fixed test-only controls may advance invented state, lose it, close it or select a bounded enumerated fault case. No arbitrary callback/fault program enters the query interface. State loss/revocation is terminal for that enrollment; no automatic restart or reload is allowed. New test scenarios use explicit fresh invented enrollment, never recovery of a real authority from a tree.

The request path never advances owner high-water state. Owner generation changes, even if a later fault restores the same sequence/tip, invalidate the current probe as `changing`/`oracle_unavailable`. The generation is harness lifecycle evidence, not a signed ledger field or authority-trust proof.

## Probe API And Capability Separation

Provisional session API:

```text
session.beginProbe({ ttl_ms?, lower_limits? }) -> original probeQuery
session.requestStart(original probeQuery) -> Promise<original checkpointHandle>
session.requestEnd(original probeQuery, original startCheckpointHandle)
  -> Promise<original checkpointHandle>
session.finishProbe(original probeQuery, original endCheckpointHandle)
  -> Promise<detached bounded report>
session.cancel(original probeQuery) -> bounded diagnostic
session.release(original probeQuery) -> bounded cleanup diagnostic
session.describe(original probeQuery) -> detached diagnostic (no new facts)
session.close() -> bounded cleanup diagnostic
```

These are proposed names, not MCP tools. `ttl_ms` is an integer from 1 through the existing 600,000-ms maximum; optional byte/resource limits only lower current ceilings. Begin generates its own query ID. No call accepts a time, raw provider response, `valid`/`released` claim, externally chosen challenge, native phase marker, callback, arbitrary `AbortSignal`, promise/thenable, path, replacement key or provider. Cancellation is an original-handle command; the implementation owns its cancellation mechanism. Later application integration of an external signal needs its own checked adapter, not a loose event-listener input here.

The original query is privately branded `checkpoint_probe`. It cannot be fed to B3-A or B-2 registries. C0/C1 handles carry original query/enrollment/request membership privately, never reconstructible from UUIDs, serialization, schema-valid reports or copied objects. `requestEnd` proves only that this probe authenticated C0 first; **it does not prove V0**. No public `advance(native_checked_before_c1)` or `verify_native: true` entry is added.

B3-C may reuse internal request machinery only under a separately branded original joint-query controller and the same original native context. That controller must authorize C1 after actual V0 and expose completion only after V1 and native release. Probe checkpoints, probe completion and B3-A observations are not accepted for those gates. There is no future `promoteProbe`/`acceptReport` conversion.

## Requests, Challenges And Response Capture

1. Check original enrollment/query state and reserve the bounded ledger/frame/copy allowance **before** contacting the oracle or generating a challenge. Reject order/revocation/accounting failures without a provider call.
2. Generate one host-CSPRNG UUID for the query at begin and one distinct UUID for each of C0/C1 when issued. Use a fixed named host API with no Math.random, supplied generator, fallback, resampling or transparent retry. A generator error, malformed UUID or collision with pinned IDs, authority reference, query/challenge/previously discovered role IDs refuses. Remember issued IDs even after cancellation/failure. No cryptographic entropy guarantee is inferred from the test.
3. Install the pending request in the private registry before dispatch. At most two requests in total, C0 then C1; at most one outstanding per query. Do not add separate random request IDs: original request membership plus query/phase/challenge suffice and fit the existing ledger schedule.
4. Take the actual send observation immediately before invoking the fixed dispatcher. The strict request frame is at most 1 KiB: schema/scope, registration digest, fixture/store/epoch/authority/key/enrollment identity, authority reference, query ID, phase and challenge. It contains no tip, sequence or timestamp for the oracle to sign. The oracle reads its own enrolled state and samples its own clock in the known same-host clock domain.
5. On completion, first check private ownership/generation and consume the exact pending slot **before** decoding/authentication. If another terminal event already consumed it, reject delivery without starting a new request. Check/copy at most 4 KiB of canonical B-1 bytes using intrinsic typed-array/ArrayBuffer operations as in B-1; refuse shared/detached/decorated/exotic input instead of consulting overridden getters, `slice` or `toJSON`. No asynchronous gap is allowed between acceptance and capture. Private handlers attach rejection handling at dispatch, so late rejection cannot become unhandled.
6. Take receive observations around that capture and verify the owned copy with B-1, using the reader's actual send/receive UTC bracket. Recheck the original deadline, lifecycle and generation after B-1 returns. Exact fixed pins/challenge/positive sequence must match. C1 must have the same sequence/tip as C0; differences give `changing`, never an automatic retry or a request to fetch extra records.

Routing fields absent from the signed B-1 envelope are checked against the fixed dispatcher/enrollment and original pending slot. A foreign request/provider response cannot be accepted simply because its JSON/signature verifies. An invalid response addressed to an owned active query invalidates that query; a foreign query handle fails without poisoning an unrelated owner. A duplicate/stale response during the release window is recorded as failure, not just ignored while a success candidate survives.

A probe knows only enrolled and otherwise already known test-role IDs; it does not discover or certify unknown record IDs. The future joint controller must register actually discovered record-role IDs within its original account before C1. A collision learned after C0 invalidates that query, not a reason to generate a replacement challenge or claim that the earlier unknown role was checked.

An original terminal checkpoint handle is inert. Returned diagnostics cannot expose raw signatures, buffers or a mutable checkpoint object. The fixed owner may retain only the bounded data needed to settle/cancel its two requests. No unbounded delivery queue, callback list, event trace or replay cache is introduced.

## Actual Clock And Deadline Rules

The new timed module alone may import a fixed host monotonic source (`hrtime.bigint`), capture `Date.now` and use one deadline timer. The pure E-A/B-1/B-2a/B3-A modules keep their existing ban on ambient clocks, event timestamps, timer signals and RNG. No clock/generator is an API argument or environment setting.

At begin, sample clocks before validation/precharge/claim work. A sample is `monotonic_before -> wall_ms -> monotonic_after`, preserving the observation interval instead of inventing a simultaneous exact instant. Check finite canonical UTC representation, nonnegative bounded monotonic values and nondecreasing high-water marks. Equal millisecond UTC values and equal monotonic resolution samples are allowed; a private ordinal establishes call order. B-1 receives canonical UTC strings derived only from actual wall samples.

The outer exclusive deadline remains the original wall start plus `ttl_ms` and earliest monotonic start plus `ttl_ms * 1,000,000`. If either observed elapsed value reaches its limit, refuse. Sampling/registration, RNG, provider work, capture, signature verification, report assembly, cleanup and final publication all consume that same window. Use conservative interval endpoints when checking elapsed time. A rollback in either source refuses; cleanup never lowers an already observed high-water mark. No 1-ms adjustment, clock-skew grace, retry window or reset after C0/C1 is added.

One implementation-owned deadline timer per active query wakes cancellation; **timer order is not the authority for timeliness**. Every entry/completion/capture/verification/final-publication path samples and checks the actual clocks. A delayed event loop, synchronously stalled call or host suspension cannot cause a late result to be relabeled timely. A response processed at the exclusive boundary loses even if its timer callback has not yet run. Delay scheduling is bounded and charged; no interval polling or caller timeout callback is used.

The same-process test oracle uses the same known host clock domain but chooses its own `observed_at` when it captures owner state. A future remote oracle with unknown clock relation is unsupported; signed UTC alone does not solve skew. These checks detect observed rollback/deadline violations, not every wall-clock freeze or OS fault. They do not qualify the retention elapsed-age clock, kernel time behavior or hard-real-time interruption. Captured built-ins are not protection against a hostile in-process runtime.

## State Machine, Cancellation And Cleanup

```text
enrolled -> probe_started -> c0_outstanding -> c0_authenticated
 -> c1_outstanding -> c1_authenticated -> finishing
 -> releasing -> released -> checkpoint_probe_report

any owned nonterminal state -> failed_or_cancelled -> releasing
releasing -> release_unconfirmed -> cleanup_retry_only
provider state loss / owner close / registry close -> revoked + cleanup_only
```

At most one settlement wins each outstanding request: accepted response, rejection, cancel, timeout, owner loss or close. Mark it consumed before invoking cancellation or processing returned bytes. Every later completion checks its original slot/generation and cannot reopen the query, restore an active claim or turn a failure into success. During `finishing`/`releasing`, any non-cleanup operation invalidates the success candidate, following the corrected B3-A behavior.

`cancel` signals only the fixed internal dispatcher. Its acknowledgement is an original internal operation handle/settlement, not caller-supplied `outcome: confirmed`. The dispatcher must remove scheduled work and release its retained response/queue entry, or remain unconfirmed. An unused request that was never dispatched can be retired locally; a dispatched operation is not considered settled merely because its public promise was raced against a timeout.

Normal failure handling runs cleanup in `finally`. Do not extend the original deadline to wait for a cancellation acknowledgement. At expiry, return a failure diagnostic if possible, keep the active claim and pending private state if settlement remains unconfirmed, and permit only explicit `release`/close-driven cleanup. Retrying cleanup does not reissue a request, resample a challenge, reread evidence or reset the deadline. Repeated commands are bounded/idempotent and do not append event history or additional listeners. A late genuine settlement may let cleanup complete but never upgrades the failed query.

Only successful private settlement/cleanup releases the active claim. `release_unconfirmed` survives other cleanup observations until that occurs. Session/owner/registry close invalidates every enrolled query even if one cleanup fails, and retains the failed entry for explicit cleanup. No GC/finalizer success claim, automatic provider replacement or silent restart is used. Process loss destroys the memory proof; a saved report/file cannot restore it.

Success is prepared privately, not returned after C1 alone. Confirm both request slots retired, owner still known at the original generation, timers/listeners/copies disposed, current limits respected and the original final clock sample within the deadline. Resolve the report only then. Its completion timestamp is the reader's publication observation, not a promise about when the consumer/event loop displays it. Postterminal late delivery is discarded/diagnosed with bounded counters and cannot recreate a capability; it cannot retroactively rewrite a detached report's as-of observation.

## Accounting And B3-C Handoff

Preserve 512 combined entries, 1 GiB inventory, 16 MiB metadata, 256 MiB read work, 8 MiB response, eight roots, 512 FDs and 48-FD headroom. No native leases are reserved or qualified in B3-B. The current read floor's per-entry **4,608 bytes**, role-cap-times-four response reservation, verifier/decode/report floors and the V1-native/outer-work separation remain in force.

Before work, construct a conservative bounded plan through the existing B3-A calculator. A probe has no actual native inventory/content; keeping the calculator's mandatory control/native floor is conservative and does not mean those operations happened. No optimistic subtraction is allowed merely because a probe skips them. Compute mandatory provider/protocol additions from the fixed program, not user totals of zero. Treat all held oracle and session state as one process-local metadata account, with no replay-state eviction or uncharged oracle side table.

| Item | Required account |
|---|---|
| Full binding/key/grants/session/generation/timer/listener headers | Validated registration plus fixed framing; held owner/query state stays charged |
| Query and two challenge IDs, original request slots and consumed tombstones | Existing bounded 4-KiB-per-new-ID model plus explicit frame charges; no new random routing IDs |
| Two request frames | At most 1 KiB each, plus each actual bounded copy/serialization pass |
| Two checkpoint envelopes | At most 4 KiB each; provider-held bytes, reader-owned copies, B-1 verification copy and decoded material counted together while live |
| Decode/canonical/hash/verify/sign work | Finite passes over bounded checkpoint bodies; verification/provider byte-work floors computed before either request; no constant-time/CPU guarantee |
| Rejections/cancel/late settlement/report | Bounded coded diagnostics, fixed counters and output buffers; no full Error.stack/signature/raw response retention |

Existing framing/scratch floors may cover a cost only once and only with an explicit implemented schedule mapping; do not claim the 40-KiB external floor alone covers every decoded object. Precharge worst-case response/decoded frames before receiving them, retain observed byte counters, and fail before allocation/dispatch if the mapping does not fit. Larger mandatory outer work goes into the existing additional protocol/decoded/provider counters and reduces usable allowance; **do not raise limits, remove floors or count it as already free**. State/frame byte models are not physical heap/OS capacity verification.

Use the same shared account for all registrations and pending/cancelled requests in that registry process. Lower ceilings apply to enrollment retention as well as active work. Spent state cannot be refunded to admit a replay or reset an exhausted issuer. Registry loss is unavailable, not a way to recover or migrate grants from JSON.

For B3-C, precharge outer work before B-2 `beginRead`; pass only `native_allowance`, not the larger total limit. V1 passes still run inside that native allowance and must not be subtracted again. Capture the original deadline once and pass only remaining time when beginning the native context; never renew it. Registration/model budgets alone do not prove shared roots/FDs fit: the actual native reservation is required then. Unknown required transcript/native work must be bounded before allowing it, not filled in after success.

## Result Semantics

Proposed schema: `native-bar-checkpoint-probe-result-v1`, `scope: synthetic_checkpoint_probe_only`. Return only fixed IDs/digests, completion/observation times, sanitized stop codes, bounded actual-work counters, accepted request count and cleanup status. No private path, key/seed, signature, raw checkpoint, OHLC, account data or complete internal ledger is reported.

The following may become true **only after both original requests actually meet their checks and cleanup succeeds**, with the stated narrow scope:

- `fixture_signature_verified`: the two B-1 checkpoint envelopes verified under the pinned **public test key**; no file or record envelope was examined.
- `challenge_generation_verified`: this issuer generated/checked/consumed both challenges using its fixed host source; no assertion about entropy quality or cross-process uniqueness.
- `actual_request_timing_verified`: this probe captured/ordered its local send/receive/publication observations within the original window; no native read order or OS clock qualification.

Use a distinct `checkpoint_requests_verified` field for the checked request pair. Keep existing `checkpoint_pair_verified` **false**: B-1 uses it with a complete transcript and E-A replay, which the probe lacks. Also keep logical-prefix, native-byte/snapshot/read/view, authority-state, original-intake, admission/approval, execution/recovery, committed-history, elapsed-age and physical-capacity qualifications false. `original_acknowledgement` and `storage_visibility_at_as_of` remain `not_proven`. A successful probe is neither a market signal nor an accepted history/approval capability.

On failure, no aggregate successful probe qualifications are published; individual already authenticated counts may appear as diagnostics only. `changing`, `oracle_unavailable`, signature/pin/bracket/size refusal, collision, accounting exhaustion, timeout/rollback, cancellation and `release_unconfirmed` stay distinguishable. Preserve the primary error and cleanup outcome separately; a close failure must not hide the initiating reason. B-1 parser errors and arbitrary provider exceptions are mapped to coded bounded diagnostics, never echoed input or stack traces.

## Test And Approval Plan

All tests below are future work, not results of this document. Existing B3-A/pure boundaries must stay strict; any new incoming dependency is individually source-allowlisted after implementation approval.

The timed module may import only the B3-A budget function from the model module, not its model factory or result-as-capability path. Allow that exact dependency in the future boundary tests rather than exempting every B3-B import. B-1's verifier remains clock/RNG/signer-free; host sampling belongs to the new timed module, and test signing belongs solely to the fixed helper.

| Slice | Work proposed for separate approval | Still excluded |
|---|---|---|
| B3-Ba | Strict enrollment/request/result/accounting contracts, two-sided grants, bounded issuer/request/cleanup lifecycle; host clock/RNG/timer adapter; unsigned/unavailable fixed-dispatch and deterministic lifecycle tests | Signer/private test key, signed response preparation, native loading, filesystem fixture |
| B3-Bb | Fixed invented memory-oracle dispatcher and signed checkpoints, only with explicit approval to derive a private `KeyObject` from a published RFC vector and sign in memory; no key-pair generation | Any secret/new key generation, key/signature persistence, network/service installation, native fixture |
| B3-Bc | C0/C1 probe orchestration through B-1, actual-clock/cancellation/accounting acceptance and independent review | Native joint reader, signed-on-disk fixtures, real authority state, MCP/production/Dot integration |

B3-Ba can test generation, malformed input, one-use handles and refusal/cleanup paths without preparing a valid signed response. Successful authenticated C0/C1 probes wait for B3-Bb's explicit signing approval. Do not use an unsigned stub's `valid: true` to bypass B-1. The first implementation request should name B3-Ba only; approving this design does not authorize all three slices or B3-C.

Acceptance cases:

1. Exact complete-binding/key enrollment; copied/foreign/used/revoked grants, duplicate namespace registration and schema-valid hand-built results never mint a session/query/request capability.
2. Original query/phase order, one active claim, two requests only; collision against query/pin/reference/role/previous challenge refuses with no resampling/provider retry. Remember cancelled/failed challenges and refuse exhaustion rather than evicting them.
3. Oracle unknown/lost/revoked/advanced state, wrong fixture/epoch/key/reference, stale/replayed signature, fresh signature over wrong tip, C0/C1 tip movement and generation change with restored visible tip all withhold success. Rolling back both owner and trees maliciously is not called detected.
4. Intrinsic copy/size checks, mutation after delivery, shared/detached/decorated bytes, canonical/UTF-8/positive-sequence rules, malformed exceptions and no sensitive data in diagnostics.
5. Actual local observations, equal rounded times, exclusive expiry at each boundary, before/after verification and release, event-loop stall, pending provider and response/timer/cancel same-turn races. Timing-sensitive waits use bounded margins in tests, not changed runtime thresholds.
6. Before-dispatch cancellation, after-dispatch cancellation, no acknowledgement, late success/rejection, duplicate/stale response during finishing/releasing, owner/session/registry close, cleanup retry and continued exclusion of the next query until actual private settlement. No unhandled rejection or accumulating timers/listeners.
7. Every fixed cost's exact-fit and one-over cases; response role caps, worst-case decoded/checkpoint/provider copies, many registrations, consumed tombstones, held unconfirmed requests and mandatory nonzero work floors. Future B3-C allowance must retain V1 native work.
8. Output positive fields have the narrow probe scope only; every native/view/prefix/authority/history/age/approval/execution field stays false. Reports or probe handles cannot drive a modeled/native joint gate.
9. AST boundary mutation tests for new signer/provider/clock/path/environment imports, dynamic loading and incoming startup/MCP consumers. Existing pure-module clock restrictions remain unchanged.

Clock/RNG/cancel failure injection is test-harness-only, in isolated test processes with fixed enumerated cases and restored substitutions, not a public runtime callback or a change to the OS clock. Tests of substituted sources are reported separately from actual host-source observations. No hard real-time, true clock-freeze/remount/power-loss/kernel-close or malicious-same-UID qualification is inferred. The existing B-2c host/kernel gaps remain open.

## Design-Step Verification

This step reads the repository contracts and writes only this design, its orchestration link and the backlog entry. It does not execute the proposed APIs, create a grant/oracle/key/signature/fixture, run native tests, change code or jobs, commit or push. Before reporting completion, check Markdown links, diff whitespace, the exact changed-file set, unchanged tracked code/tests, unchanged common JS/native builds and the unchanged PAUSED Dot configuration. This is document verification, not B3-B runtime qualification.
