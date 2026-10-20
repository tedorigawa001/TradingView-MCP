# Moving Average Context

`get_moving_average_context` is descriptive and read-only. It connects displayed settings to observed native study values; it does not infer trade signals, estimate an edge, or submit orders.

## Supported Adapter

V1 supports the observed **Simple Moving Averages** study with metadata ID `Script$PUB;kWRFasqqymAq56dUJNmDbMqN55wBFWPa@tv-scripting`. Ten line plots use `plot_0, plot_2, ..., plot_18`; each is paired with period `in_0, in_2, ..., in_18` and source `in_1, in_3, ..., in_19`. The twenty input IDs, unlocalized input names/types, twenty plot IDs/types and line titles must match the observed signature. Array ordering and display-name similarity are not used for mapping.

The adapter identifies these lines as SMA. Identity and metadata signature are not an audit of protected Pine source or an immutable script version. Both current and previous values are independently checked against native OHLC when the loaded window permits. A numeric mismatch suppresses the values and slope rather than silently replacing them with the recomputation.

Arbitrary Pine studies and built-in SMA/EMA/WMA variants are **not automatically supported**. They remain in `unmapped_studies`, even when named SMA or EMA. Extending this requires a separate identity/signature adapter and tests. `complete` describes the mapped rows, not universal discovery of every possible moving average in unrelated studies.

## Inputs and Binding

- Required `symbol` and `expected_timeframe`; optional `chart_index` defaults to the active pane.
- Supported timeframes: 1/5/15/30/60/120/240 minutes, daily and weekly.
- `count`: 3-1,000 loaded native and study rows, default 500. The tool never loads more history.
- A shared cross-process chart lock surrounds reads. The selected full provider symbol, timeframe, study IDs/names and settings must remain consistent before and after OHLC acquisition. Replay must be verified inactive.
- A definition SHA-256 records the bound snapshot's whitelisted metadata/settings, not the plot values or a historical vendor vintage.

## Values and Slope

The common acquisition-start cutoff excludes future observations. Completion is proven by a native successor, not elapsed wall time. The latest bar without a successor is excluded even during a closure. Values join by **exact bar-open timestamp and Plot ID**, never by nearest time, a title-keyed value, or forward filling.

`value` and `previous_value` refer to the last two successor-confirmed native bars. The slope is their price difference and relative change in basis points, with `elapsed_seconds` disclosed. It is not an angle or a per-hour rate; adjacent observations can span a closure. Native OHLC cadence is validated using the same guard as the closed-bar summary.

Allowed reference prices are `open`, `high`, `low`, `close`, `hl2`, `hlc3`, and `ohlc4`. Period must be a positive safe integer no larger than 1e12. External indicator sources and nonzero/unknown display offsets are not interpreted. Study health must explicitly be error-free. Missing/non-finite/nonpositive plot values remain null. `study_visible` is separate from `plot_visible`: the latter requires the plot's visible flag and the pane bit (1) in `display_mask`; a data-window-only plot is not a visible chart line. The combined state is not inferred from the existence of a calculated value. [TradingView display targets](https://www.tradingview.com/charting-library-docs/latest/api/enums/Charting_Library.StudyPlotDisplayTarget/).

Verification needs at least `period + 1` closed native bars to check both values. The tolerance is `1e-8 * max(1, abs(current expected), abs(previous expected))`. Without enough history, an observed native value may still be reported, but its verification and row remain partial. No result claims chart-native history is non-repainting or point-in-time evidence.

## Resource and Privacy Boundaries

Snapshots allow at most 64 study references and 16 mapped studies. Each mapped study scans at most 256 raw inputs, 128 non-internal inputs, 256 input descriptors, 128 plot descriptors and 1,000 plot rows. The accepted public input IDs are exclusively `in_0` through `in_19`. Any unknown non-internal ID stops that study before input values are serialized; the known Pine-internal IDs are ignored. Text fields are bounded to 200 characters. Only these allowlisted scalar settings and whitelisted plot/display fields cross CDP. Pine `text`, `pineId`, `pineVersion`, `pineFeatures`, `__profile`, raw property trees and source code are excluded.

The MCP response contains summaries and timestamps, not OHLC/plot history arrays. No scanner, network feed, private journal, account, order or alert data is read. There are no chart, indicator, timeframe, history or journal mutations. Pre/post checks detect observed changes but cannot make reads atomic against arbitrary manual UI changes.
