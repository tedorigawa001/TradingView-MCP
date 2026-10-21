# Closed Chart Snapshot

`get_closed_chart_snapshot` combines read-only evidence collection with explicitly approved temporary timeframe changes. It does not evaluate a strategy, place orders, deliver notifications, change indicators, load history or write journals. Existing `get_closed_mtf_summary` and `get_execution_snapshot` contracts are unchanged.

## Inputs

- `targets`: 1-4 unique `chart_index` values with exact exchange-qualified `symbol` and current `expected_timeframe`. A closed or changed target is refused, never reopened or switched to another symbol.
- `timeframes`: 1-6 distinct supported native timeframes, default `15`, `60`.
- `count`: 2-1000 already-loaded bars per read, default 300. No history-loading request is made.
- `recent_count`: 1-100 confirmed bars returned per series, default 40; must be less than `count`.
- `confirm`: must be true if any temporary timeframe change is required. Otherwise returns a preview with no OHLC or quote reads.

The selected pane must be included in targets when temporary changes are needed. This ensures selection restoration can use an approved 15/60-minute round trip on that pane rather than mutating an unrelated pane. Original timeframes must be supported by the native closed-bar calculator. No dedicated chart-selection API or symbol change is used.

## Evidence

One `as_of` is captured before OHLC acquisition. Each target returns its original timeframe plus requested `series`, computed using the existing successor-confirmed native-bar selection and seeded indicators. `recent_closed_bars` has bar-open and successor-confirmation times. The forming/unconfirmed tail and post-cutoff observations are excluded. `observed_at`, history counts and insufficient-history quality remain explicit. A repeated original/requested timeframe reuses that same read.

`execution` is a separate execution snapshot, collected after restoring charts while still holding the shared lock. Its own observation timestamps, quote quality, freshness and limitations apply. Execution evidence is not filtered to the OHLC cutoff and is never used to establish an OHLC close or price basis. `price_basis` remains `unknown`; no bid/ask/mid assumption is made. `ready` is not a fill guarantee.

The shared cutoff does not prove simultaneous acquisition or historical availability. Successor-open time is not exchange publication time, and `observed_at` is not a persisted first-seen vintage. A source may revise loaded history. Session gaps are not filled or reclassified as closures by this tool.

## Safety And Results

The MCP handler holds the existing shared chart-operation lock across the entire operation. It checks all panes' exact symbols, normalized timeframes, Study ID sets and selected pane before/after reads and changes. Only timeframe changes are permitted. The original timeframe is restored in a `finally` path, then original selection is restored and the complete layout is read again. A readiness timeout note is never accepted as successful acquisition/restoration.

- `complete`: all requested native evidence is complete, quotes are ready and full restoration verified.
- `partial`: a read/quote failed, history was insufficient or quotes are not ready, but restoration verified. No later native panes are collected after an acquisition failure; the result explicitly identifies incompleteness.
- `blocked`: observed manual layout drift, Replay becoming active/unverifiable, or failed restoration. Collected panes and quotes are discarded. Unexpected user changes are not overwritten to force restoration; before/after layouts remain visible.
- `confirmation_required`: preview only, restoration not attempted.

Malformed input, unavailable selection, initial Replay or mismatched targets are refused before mutations. Low-level timeframe changes may perform their existing rollback; this tool does not repair unrelated user changes. Layout checks are not an atomic guarantee against every transient manual action. If restoration cannot be verified, no additional analysis or quote acquisition is attempted.

A Replay status read exception during acquisition blocks the whole evidence bundle even if subsequent reads recover. Selection restoration uses its own `finally` path: a timeout entering the selection-only temporary timeframe still attempts to restore that owned timeframe, provided the layout has not drifted. The failed round trip remains blocked rather than claiming verified success solely from matching labels.

No stored scenario thresholds, notification rules, research journals or automation configuration are accessed. Tests use mocked charts; live validation is a separate step and requires chart-operation approval. Tool availability in a running MCP process requires loading the updated build; this implementation does not restart it.
