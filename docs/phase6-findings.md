# Phase 6 検証結果: バックテスト連携(2026-07-08)

バックログ #8(`get_strategy_report` / `run_backtest`)の内部 API 調査記録。

## 1. backtestingStrategyApi(ストラテジーテスター)

### 2026-07-20 現行TradingViewへの移行

- 現行アプリでは`TradingViewApi.backtestingStrategyApi`自体が存在しない。Strategy Testerを表示しても遅延初期化されるのではなく、active chart modelの`activeStrategySource().value()`がstrategy sourceを返し、その`reportData()`からレポートを取得する構造へ変わっていた
- MCPは旧`backtestingStrategyApi()`が存在すれば従来経路を優先し、存在しなければ現行chart modelを`activeStrategy` / `activeStrategyMetaInfo` / `activeStrategyReportData`のWatchedValue相当へ適応する。active sourceは呼び出しごとに解決し、`run_backtest`でstudyを追加した後のsource切替も追跡する
- 現行`trades[]`は短縮形式を返す。主な対応は`e`=entry、`x`=exit、`q`=quantity、`tp`=trade profit、`cp`=cumulative profit、`rn`=run-up、`dd`=drawdown、`cm`=commissionで、entry/exit内部は`c`=label、`p`=price、`tm`=time、`b`=bar index、`tp`=type。従来のverbose形式も後方互換として維持する
- 実機のUSDJPY 4Hで72取引を取得し、Strategy Tester summaryとの件数一致、ページ間ledger ID拘束、最終ページまでのindex連続性を確認した。現行形式にはtrade numberがないため推測せずnullとし、配列位置は別の`reportIndex`として返す

以下は旧APIで確認した契約であり、互換アダプターが同じ読み取り形状を提供する。

- `await TradingViewApi.backtestingStrategyApi()` — **Promise を返す**(replayApi も同様)
- 主要プロパティは **WatchedValue**(`.value()` で読む。関数呼び出しではない):
  - `activeStrategyReportData` → レポート本体 `{ currency, settings, performance, trades, filledOrders, ... }`
  - `activeStrategy` / `activeStrategyMetaInfo` / `activeStrategyStatus` / `allStrategies` / `isStrategyEmpty`
- `performance` の構造: `all` / `long` / `short`(netProfit, percentProfitable, profitFactor, avgTrade 等 50+ 指標)+ トップレベルに `sharpeRatio` / `sortinoRatio` / `maxStrategyDrawDown(Percent)` / `initialCapital` / `buyHoldReturn` 等
- `trades[]`: `{ entry: {id, price, time(ms), type: "le"|"se"|..., barIndex}, exit: {...}, profit: {value, percentValue}, cumulativeProfit, runup, drawdown, quantity, tradeNumber }`。percent 系は**小数(0.33 = 33%)**
- `settings.dateRange.backtest.{from,to}`(ms)

### 罠: 同名ストラテジーの再テストで前回レポートが返る(実運用で発覚・修正済み)

PDCA の実践(v1 計測 → v2 保存 → 再テスト)で、v2 のバックテストが v1 と**小数点以下まで完全一致**する事象が発生。原因は `activeStrategyReportData` の WatchedValue が前回実行のレポートを保持したまま、新バージョン適用直後のポーリングが「description 一致+非 null」で**ベースラインの残留レポートを受理**していたこと(保存し直しても strategy 名は同じなので description ゲートを素通りする)。対策: `createStudy` の**前に**レポートオブジェクトを覚えておき、**オブジェクト同一性**(`raw !== staleReport`)で置き換わったレポートのみ受理する。

なお調査過程の注意点2つ: (1) コンパイル済み metaInfo の入力 `id` は `in_N` 形式に変換されるため、新入力の存在確認は `name` で行う(id で探すと誤って「古い」と判定する)。(2) `studyMetaInfoRepository` のキャッシュは保存時の `onModifyScript` で更新されるので手動 evict は不要 — むしろ evict すると server 側 `translate/<id>/last` エイリアスの伝播遅延を直接踏む。

### 罠: レポートはストラテジー削除後も残留する

`removeEntity` でストラテジーを外しても `activeStrategyReportData.value()` は**直前のレポートを保持し続ける**(`activeStrategy` は null になる)。ゲートなしで読むと「チャートにないストラテジーの成績」を現在の状態として返してしまう。対策:

- `formatReport` は `activeStrategy.value()` が null なら必ず null を返す
- `run_backtest` は `activeStrategyMetaInfo.value().description` が**自分が適用したスクリプトの description と一致**するまでレポートを受理しない(別のストラテジーがアクティブな場合はタイムアウトで失敗する方が誤帰属より良い)

## 2. Pine スクリプトのチャート適用(createStudy)

- `chart.createStudy(名前文字列)` は組み込みスタディのみ(メタリポジトリの名前解決)。ユーザースクリプト名では `unexpected study id` で失敗
- **正解は記述子オブジェクト**: `chart.createStudy({ type: "pine", pineId: "USER;<hash>", version: "last" })` → Promise<studyId>
  - 内部では `_createStudy(e)` → `chartWidget.insertStudy(e, [])`。メタ情報は `studyMetaInfoRepository().findById({type:'pine', pineId, version:'last'})` で事前検証できる(`isTVScriptStrategy` で strategy/study 判別)
- 削除は `chart.removeEntity(studyId)`
- この記述子ルートは **#11(改修スクリプトのチャート反映)にもそのまま使える**

## 3. 保存系 API(#11 で実装済み)

- `TradingViewApi.pineLibApi()` → `{ saveNew, saveNext, requestBuiltinScripts }`
  - `saveNew({scriptSource, scriptName})` → POST `pine-facade/save/new?name=...`(FormData `source`)。`allowOverwrite` は渡さない
  - `saveNext({scriptIdPart, scriptSource, isLegacyScript: false, scriptName?})` → POST `save/next/<pineId>`。新バージョンとして追記され、**旧バージョンは `get/<pineId>/<n>` で取得可能なまま残る**
  - 戻り値: `{ success, metaInfo, compileErrors: { errors, warnings } }`(エラーは `{start:{line,column}, message}`)
- **罠1: コンパイル失敗でもバージョンは保存される**(success:false でも source が新バージョンとして永続化)。ツールは compileOk / revertHint で正直に報告する
- **罠2: 改行の正規化**: 保存時に LF → CRLF に変換される。保存後の一致検証は改行正規化してから比較
- **罠3: 同名スクリプトの saveNew はプレーン文字列 `"Request error, try again or contact support."` で reject**(Error ではない)。事前に saved 一覧と名前照合して明確なエラーを出す
- **罠4: `studyMetaInfoRepository().findById` はキャッシュ**で、保存直後のスクリプトを知らないことがある。`createStudy` 自体は正しく解決するので、メタ取得失敗は致命傷にしない
- 削除は POST `pine-facade/delete/<pineId>`(→ `"ok"`)。**ツールとしては公開しない**(テストの後始末でのみ使用)

## 4. replayApi(2026-07-20に限定公開)

- `await TradingViewApi.replayApi()` で取得。メソッド: `selectDate` / `doStep` / `toggleAutoplay` / `stopReplay` / `goToRealtime` / `getReplayDepth` / `currentDate` / `leaveReplay` など
- 公開: 状態取得、期待symbol/timeframe+confirm付き`selectDate`、停止中の有限`doStep`、confirm付き`stopReplay`
- 非公開: `buy` / `sell` / `closePosition` / `realizedPL`(Replay Trading)、autoplay、random/first date、replay resolution変更
- TradingView公式仕様上、リプレイ中もserver-side alerts、orders、trading panel/quote listはリアルタイム側に残るため、`get_trade_decision_context`はリプレイ中をblockedにする

## 制約・注意

- レポートは「アクティブチャートのアクティブストラテジー」単位。チャート指定は不可(activeChart のみ)
- `run_backtest` は一時的にチャートへストラテジーを追加する(セルフクリーンアップ付き)。実行中は Strategy Tester パネルが一瞬表示される場合がある
- 計算完了は 400ms ポーリング・20秒タイムアウト(実測では数秒で完了)
