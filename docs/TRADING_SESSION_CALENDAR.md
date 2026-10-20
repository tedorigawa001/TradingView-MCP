# Provider-Bound Trading Session Calendar

`get_ohlcv_key_levels` rule `ohlcv_swing_levels_v1.2` distinguishes declared closures from missing expected bars. It does not infer a holiday from prices, a generic national holiday list, or a currency's country.

## Source And Binding

`TradingView.getTradingSessionMetadata(chartIndex)` reads only the current main series' `symbolInfo` calendar fields: full symbol, timezone, session, session holidays, corrections and selected subsession. No accounts, quotes, orders or network calendars are read. The full symbol including its provider, resolution and chart index must match the bound chart before OHLC acquisition. A second metadata read must match the first before any result is returned. Replay and pre/post chart checks remain required under the shared chart-operation lock.

The response records source, full symbol, session, timezone, subsession, metadata SHA-256, runtime tzdata version and whether holiday/correction fields were supplied. A hash identifies the snapshot; it does not prove that the provider's calendar is complete or historically immutable.

## Supported Session Rules

- Session times are in the supplied IANA timezone, with an exclusive end. Default trading days are Monday through Friday; weekday suffixes use Sunday=1 through Saturday=7.
- Supported forms include `24x7`, comma-separated intraday windows, overnight windows, explicit `F`/`Fn` offsets (up to six days), weekday overrides separated by `|`, and the first-weekday prefix/suffix. Overlapping windows are refused.
- `session_holidays` contains explicit `YYYYMMDD` trading dates. Overnight dates refer to the trading day, not necessarily the civil date on which the session opens.
- Date-specific `corrections` replace that date's normal hours and override its holiday entry. Multiple dates and shortened/reopened sessions are supported.
- Session-history syntax (`#.../...`), malformed/ambiguous rules, inconsistent selected subsessions and non-unique DST wall-time boundaries remain unsupported. They never authorize a closure.

Normative format references: [TradingView trading sessions](https://www.tradingview.com/charting-library-docs/latest/connecting_data/time-and-sessions/Trading-Sessions/) and [symbol information and corrections](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Symbology/).

## Expected Bars

Intraday opens are generated from each actual session window's start at the requested interval; a final shortened bar is retained if its opening precedes the session end. The provider's timezone controls DST, not a fixed UTC offset.

For native daily/weekly bars, every observed timestamp must match one consistent convention: actual first-session opens or UTC trading-date labels. Weekly groups use the declared first trading day, Monday by default. Unverified timestamp conventions are not guessed. Missing calendar bars are never synthesized.

Expansion is limited to 8,000 civil days, 20,000 dated session windows and 50,000 expected opens. The window budget is charged before boundary conversion, including optional default-window diagnostics; weekly aggregation cannot bypass it by collapsing many intraday windows. Diagnostic output is limited to 50 intervals and reports how many were omitted. Malformed or oversized calendar input falls back conservatively; OHLC reads themselves remain limited to 1,000 native bars.

Effective date overrides are resolved before unused default boundaries. If an unused default has a non-unique DST boundary, it cannot invalidate the holiday or valid corrected hours. `unresolved_default_exception_dates` records the dates for which a detailed default-versus-correction closure explanation was unavailable; the effective expected opens remain authoritative. `expanded_session_windows` counts charged expansion vectors, including unsuccessful diagnostic attempts, not just uniquely materialized windows. Budget errors are never suppressed.

## Interval Classes

| Class | Condition | Pivot Window |
|---|---|---|
| `scheduled_closure` | Both observed endpoints match the provider grid, with no expected open between them | Allowed |
| `missing_expected_trading_bars` | At least one expected open is absent between aligned endpoints | Excluded |
| `unverified_bar_alignment` / `unclassified_gap` | Source metadata, syntax, timezone or timestamp alignment cannot establish continuity | Excluded |

Ordinary adjacent bars need no diagnostic row. Without usable metadata, nominally large gaps remain unclassified; the old daily/weekly blanket exception is removed. Counts before exclusion and the excluded pivot-window count remain visible. Missing or unclassified intervals produce `partial`, including when they affect no currently reported pivot.

All touch episodes still reset at large wall-clock gaps, including scheduled closures, or at missing/unclassified intervals. Allowing a swing window across a declared closure does not imply continuous passive liquidity, intrabar touch ordering or a confirmed rejection across the closure.

## Trust Limits

`missing_expected_trading_bars` means missing relative to the supplied provider calendar. It can also mean an unreported holiday, a historical session change, no trades or incomplete calendar metadata; it is not proof of vendor data loss. An absent holiday field does not mean that no holidays exist. Unknown holidays must remain unresolved rather than being guessed from generic exchange schedules. A `complete` result describes the computation under that calendar, not verified full historical market coverage or a tradable edge.
