# Phase 6 検証結果: バックテスト連携(2026-07-08)

バックログ #8(`get_strategy_report` / `run_backtest`)の内部 API 調査記録。

## 1. backtestingStrategyApi(ストラテジーテスター)

- `await TradingViewApi.backtestingStrategyApi()` — **Promise を返す**(replayApi も同様)
- 主要プロパティは **WatchedValue**(`.value()` で読む。関数呼び出しではない):
  - `activeStrategyReportData` → レポート本体 `{ currency, settings, performance, trades, filledOrders, ... }`
  - `activeStrategy` / `activeStrategyMetaInfo` / `activeStrategyStatus` / `allStrategies` / `isStrategyEmpty`
- `performance` の構造: `all` / `long` / `short`(netProfit, percentProfitable, profitFactor, avgTrade 等 50+ 指標)+ トップレベルに `sharpeRatio` / `sortinoRatio` / `maxStrategyDrawDown(Percent)` / `initialCapital` / `buyHoldReturn` 等
- `trades[]`: `{ entry: {id, price, time(ms), type: "le"|"se"|..., barIndex}, exit: {...}, profit: {value, percentValue}, cumulativeProfit, runup, drawdown, quantity, tradeNumber }`。percent 系は**小数(0.33 = 33%)**
- `settings.dateRange.backtest.{from,to}`(ms)

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

## 4. replayApi(未実装・将来用)

- `await TradingViewApi.replayApi()` で取得。メソッド: `selectDate` / `doStep` / `toggleAutoplay` / `stopReplay` / `goToRealtime` / `getReplayDepth` / `currentDate` / `leaveReplay` など
- `buy` / `sell` / `closePosition` / `realizedPL` もあり(リプレイ内ペーパートレード)— **公開する場合は書き込み系扱いで要設計**。今回のスコープ外

## 制約・注意

- レポートは「アクティブチャートのアクティブストラテジー」単位。チャート指定は不可(activeChart のみ)
- `run_backtest` は一時的にチャートへストラテジーを追加する(セルフクリーンアップ付き)。実行中は Strategy Tester パネルが一瞬表示される場合がある
- 計算完了は 400ms ポーリング・20秒タイムアウト(実測では数秒で完了)
