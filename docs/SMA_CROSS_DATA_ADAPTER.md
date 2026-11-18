# SMA-cross v2 pure frozen-data adapter

`src/smaCrossDataAdapter.ts` exports `adaptSmaCrossV2(package, trust)`. It validates
already supplied bytes in memory. It does not acquire data, inspect a chart, read
files, read the current clock, register research, invoke the measurement engine,
or write results. It has no server/CLI integration or production trust roots.
Existing STOP/no-retry and the protected unallocated 765 bytes are unchanged.
The existing measurement implementation and registration definitions are unchanged.

## Fixed study

- ID: `sma-cross-adj-30m60m-1y-20261114-v2`.
- Definition: `sha256:8dc5c2d46af53161f69fe8427403510b8bfb247e486fcccab152b27c6a5b3573`.
- Event-end window: `[2025-11-14T04:57:31Z, 2026-11-14T04:57:31Z)`.
- Exactly OANDA:EURUSD and OANDA:XAUUSD, native `30` and `60` minutes.
- No native-61 conversion, resampling, alternate feed, price coercion, rounding,
  SMA computation or modification of the four pairs / fixed 16-test family.

## Trust boundary and supported contract

`trust.approvedEvidence` is a **separate caller-owned configuration** containing
approved evidence-manifest `{id, sha256}` pins. Nothing in the package can create
approval. Only externally reviewed pins may be used in production. Hashes fix
bytes; they do not authenticate a provider, establish a writer identity, or prove
that acquisition receipts describe real calls. The trusted acquisition boundary
and the applicability of its documented semantics still require real evidence.
The tests approve deliberately fictional fixtures only.

This implementation supports one explicit JSON contract. It does not execute
free-form rules or infer provider behavior from nonempty reference strings.
Approval of this contract must establish the following meanings:

1. `native-sma-page-v1` contains actual native open/end UTC integer milliseconds,
   numeric binary64 closes and confirmation for measurement/warmup bars, native
   presence observations for audit witnesses, full before/after context, and a
   source history version. Unsupported approved contracts/units are held; a
   captured page whose format differs from this envelope stops the batch.
2. `series-history-v1` means the same snapshot ID fixes the entire requested
   history of that symbol/timeframe, not just a job or response. Unknown snapshot
   scope is held; changing IDs within a series stops the whole batch.
3. `explicit-native-calendar-v1` is a complete, approved partition of the full
   applicable range into expected native bar runs and proved omissions. Its
   bytes are separately pinned in the evidence manifest. It is not a caller's
   unverified list of convenient expected timestamps.
4. `native-or-successor-v1` specifies the native confirmation and successor
   meanings. The source evidence IDs `calendar-rule`, `native-confirmation` and
   `snapshot-rule` have explicit roles. Each has a pinned version and SHA-256.
   These role IDs are fixed by this first contract; arbitrary alternatives are
   unsupported until a further reviewed contract exists.

The evidence manifest (`sma-evidence-v1`) contains four `scopes`. Each scope binds
`key`, full `context`, traversal `order`, `calendarId`, inclusive applicability
boundaries `from`/`through`, the three contract identifiers above, `evidenceRefs`,
the approved UTC clock source and maximum precision, and `rules` identifying
session/DST/holiday/shortened/no-trade rules. Approving a scope attests that its
source evidence and complete calendar apply to the **whole** range, including
warmup and the witness. Descriptive rule IDs are not independently proved by this
adapter. No real OANDA/TradingView calendar or BVI/feed correspondence is supplied.

## Frozen package and receipts

`FrozenSmaPackage` contains:

- `evidence`: exact approved evidence-manifest UTF-8 bytes.
- `manifest` and `manifestHash`: exact frozen acquisition-manifest bytes and its
  separately supplied commitment.
- Ordered `pages` / `artifacts`: `{id, bytes}` arrays, exactly matching receipts.
- Optional `expectedProjection`: externally fixed normalized/mapping commitments
  for a later explicit recheck of the same frozen package.

The acquisition manifest (`sma-frozen-package-v1`) pins study ID/hash/window,
evidence ID/hash, and ordered `pages` / `artifacts` receipts. Every receipt includes
ID, body SHA-256, exact body `byteLength`, captured numeric HTTP-like status,
`internalQueries: 1` and `retries: 0`. Failed and empty receipts count too. Unknown
internal counts hold; extra queries/retries stop. An unknown count is recorded
without skipping later raw hashes, status/retry checks or page-integrity checks.
The pending count hold is returned only after those checks. Data receipts also contain the
series key, full request context, observation start/end UTC ms, and UTC clock
source / precision. Receipt arrays count **declared acquisition units**; they do
not prove the real internal call count. `acquisitionCountKnown` distinguishes
known declarations from an unverified count. No collector or automatic paging is
enabled, and the adapter makes zero acquisition requests.

For response quotas, size is the exact supplied body bytes plus the UTF-8 JSON
encoding of the captured numeric status (e.g. 3 bytes for `200`). Transport headers
are excluded. The supported capture boundary must preserve these values before
any transformation. These bytes are not claimed to be provider wire bytes.
The two local manifests each have a separate 256 KiB input bound; they are not
new source-acquisition receipts.

Pages contain `{format, before, after, snapshot, bars}`. Context includes provider,
full symbol, native timeframe, `native:true`, route/version, format, `utc_ms`, and
region; request/before/after must match the approved context exactly. Snapshots
contain `{id, scope:"series-history", evidenceRef:"snapshot-rule"}`. Each measurement/warmup bar has
`openAt`, `endAt`, positive finite number `close`, and
`confirmation:{kind, observedAt, evidenceRefs}`. Additional captured bar fields
remain part of duplicate equality checks. JSON must be strict UTF-8, without
duplicate object keys or nonfinite numbers. Shared buffers are rejected. Unknown
formats are not reparsed using another method. An audit-only witness may instead
have `witnessObservation:{observedAt,evidenceRefs}`; its price and own confirmation
may be absent or null because they never enter the measurement input. Existing
captures can reuse the observation fields of a `native`/`successor` confirmation
as the witness's presence observation, without proving its own close.

## Calendar, confirmation and boundaries

Each calendar artifact contains `{id,format,from,through,blocks}`. Blocks partition
the range without overlap or implicit gaps:

- Bar run: `{kind:"bars",from,through,duration,count,shortened,evidenceRefs}`.
  The duration must match the native timeframe or be explicitly shortened.
- Omission: `{kind:"closure",from,through,reason,evidenceRefs}`, with a proved
  `scheduled_closure` or `no_trade` classification.

Actual intervals must match every expected bar exactly, including native end.
Minimum/maximum timestamps, sample counts, and long gaps alone cannot demonstrate
coverage. Omitted bars, unknown classifications and incomplete partitions hold.
The adapter does not construct production sessions, holidays or DST calendars.

Native confirmation needs its approved evidence role and an integer observation
time within the acquisition window, whose earliest possible UTC value
(`observedAt - precisionMs`) is not before the native end. A successor must be in
the same versioned series, follow the preceding native interval, and have opened
by that earliest observation time. Its open never replaces the previous native
end. A native boolean or the current wall clock alone is insufficient.

Audit-only witnesses still require approved request/before/after context, the
same source snapshot, valid native interval/applicability/calendar, evidence role,
and a bounded observation time within their acquisition window. For presence,
`observedAt - precisionMs` must be at or after the witness's native **open**, not
its future close. They do not need a successor of their own. A presence assertion
on a measurement/warmup bar never substitutes for its closing confirmation.

At least 120 pre-window bars are needed; insufficient warmup holds. At most 8,311
distinct warmup bars and one distinct bar ending at/after the exclusive cutoff are
allowed. Those purpose maxima are inclusive and include their raw occurrences
in acquisition totals. The witness price is never returned in normalized data.
After-cutoff confirmation supports retrospective analysis only; no point-in-time
visibility or inference prerequisites are established.

## Normalization and result

Each series first inspects **all its pages** for context/version consistency,
native time validity, order/overlap, captured-field conflicts and numerical
thresholds. These checks precede clock/price/reference/coverage holds. A held
series cannot hide a later page's global-stop condition; other series are still
inspected until an actual stop. Earlier summaries remain available on stop.

Declared ascending traversal is preserved. Only an explicitly approved descending
traversal is reversed; data is never arbitrarily sorted to repair order. Identical
overlap is deduplicated only when every captured bar field agrees (including
numeric signed-zero distinctions). Any revision/conflict stops globally. All raw
occurrences retain a page/row-to-series-local-normalized-index mapping. Witness
rows have `normalized:null`.

`coverage.tail` is derived from validated calendar blocks between the last
delivered native end and the exclusive cutoff. Any proved positive-length
closure/no-trade omission intersecting that range yields `scheduled_closure`,
including gaps shorter than the nominal timeframe. With no such omission it is
`continuous`, including a native witness interval spanning the cutoff. Omission
blocks starting at/after the cutoff do not change this classification. No nominal
timeframe/time-delta heuristic is used. The two-valued downstream representation
maps both proved omission kinds to `scheduled_closure`; the original calendar
retains their specific reasons and evidence.

Only four accepted series produce `series` and `mapping`. Results are deeply
frozen, with separate SHA-256 commitments for normalized JSON, mapping JSON and
the audit manifest. Raw and acquisition/evidence commitments are rechecked before
return. An optional pre-fixed projection commitment rejects resealed price or
mapping changes. The audit explicitly records separate per-series snapshots and
`globalAtomicity:false`; cross-asset atomicity is never implied.

`held` means evidence or quality is insufficient. `stopped` means an integrity,
ordering, retry, format or numerical safety failure. Both return `series:null`
and `mapping:null`; earlier accepted series summaries and metering remain.
Held series have `bars:null`, never an assertion of zero observations. Accepted
`bars` counts native input bars including warmup, not cross events or statistical
observations. No measurement is performed. `executionAllowed` and
`adoptionAllowed` remain false even on adapter acceptance.

Original buffers are not modified or silently replaced. `retention` explicitly
requires the caller to retain them, including quarantined originals; no disk
archive is created. A stopped invocation cannot resume or reset its budget. A
new explicit invocation is a new validation, not an automatic data retry.

## Fixed exclusive thresholds

Reaching any threshold stops; accepted values must be smaller. Subset thresholds
may make some aggregate thresholds unreachable; none are loosened.

| Area | Threshold |
|---|---:|
| Data receipts per series / total | 8 / 32 |
| Occurrences per page / series / total, including overlap and witness | 4,096 / 32,768 / 131,072 |
| One data response / all data responses | 1 MiB / 32 MiB |
| Evidence/context receipts / one response / total bytes | 8 / 64 KiB / 512 KiB |
| Combined receipts / response bytes | 40 / 32.5 MiB |
| Normalized bars / mapping rows | 131,072 / 131,072 |
| JSON nesting / object keys / UTF-8 reference bytes / evidence refs | 16 / 64 / 256 / 8 |
| Work units | 4,194,304 |
| Normalized JSON / mapping JSON | 32 MiB / 16 MiB |
| Audit manifest / terminal diagnostic | 256 KiB / 64 KiB |

Known-format strings are treated as references and limited to 255 UTF-8 bytes.
Calendar expansion is separately capped below 32,768 expected bars per series.
All structures are checked before expansion/appending. Output encoding is
incremental and counts escaped UTF-8 bytes. Work meters validation visits,
64-byte scan/hash blocks, mapping/calendar/bar processing, output tokens, and
freezing. These are algorithmic units, not CPU-instruction or elapsed-time claims.
Rejected charges do not advance used counters; the reason identifies the blocked
increment and remaining reports the balance before it. Diagnostics reserve 1,024
bytes and account for the terminal summary separately, without clearing a stop.
Oversized success output is never truncated into an accepted result.

## Verification and remaining gates

The synthetic tests exercise external pins, scope/calendar applicability, source
and context changes, snapshot semantics, exact overlap/conflicts, missing bars,
explicit gaps and shortened intervals, confirmation uncertainty, cutoff/warmup/
witness boundaries, receipt/no-retry rules, raw/projection tampering and fixed
budget boundaries. Numerical output/work thresholds are tested directly through
the same latched budget primitive; representative page/response/structure and
purpose boundaries are also tested through the adapter. This is not a production
capacity benchmark or a proof about external systems.

Regression cases also combine early quality holds with later snapshot/context/
format/time/conflict failures, unknown acquisition counts with a later raw hash
failure, successor-only histories with one open audit witness, missing/out-of-range
witness presence evidence, and calendar-based tail classification on both sides
of the exclusive cutoff. Witness relaxation never applies to measurement/warmup
prices or closing confirmation. Previously fixed projection commitments are not
silently refreshed when normalization changes; a mismatch still stops.

Real acquisition/capture authentication, real evidence approval, region/feed
mapping, production calendar completeness, frozen-data retention and later
measurement authorization remain separate gates. No production trust configuration
is populated by this change. There are no real observations, study registrations,
chart operations, DOT execution, external-model calls or backtests in these tests.
