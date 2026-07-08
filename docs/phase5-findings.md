# Phase 5 検証結果: グラフィックス・履歴ロード・アラート(2026-07-08)

残課題3件(描画専用スタディの読み取り / OHLCV 過去データ追加 / アラート連携)の調査と実装記録。

## 1. インジケーターの描画プリミティブ(`get_indicator_graphics`)

Pine の `label.new` / `line.new` / `box.new` で描かれたオブジェクトは
`source.graphics()._primitivesCollection` の `dwglabels` / `dwglines` / `dwgboxes` にある。

**重要: 格納場所が2形態ある**(両対応が必須):

| 形態 | 場所 | X座標の意味 | いつ |
|---|---|---|---|
| 生データ | `store._primitivesDataById`(プレーンオブジェクト) | グラフィック独自 index。`graphics()._indexes` 配列でモデル index に変換 | スタディ計算直後 |
| マテリアライズ済み | `store._primitiveById`(Map) | **モデル index 直接**(履歴ロード後は負値もある) | 再描画後(履歴追加ロード等で再構築されると生データ側は空になる) |

- フィールド名も異なる: 生 `{x, y, t, sz}` ↔ マテリアライズ `{x, y, text, size}`(lines は `ex/st/w` ↔ `extend/style/width`、boxes は `x1,x2,y1,y2` ↔ `left,right,top,bottom`)
- 時刻変換: モデル index → `mainSeries().bars()._items[idx - firstIndex].value[0]`。最終バーより未来(投影)は平均バー間隔で外挿し `timeEstimated: true` を付与
- `-2000000` は「履歴より前」のセンチネル → time は null
- 同一 (time, price, text) のラベル重複はスタディの描画テクニック由来 → 出力時に除去

実測: Elliott Wave のラベル `"(3)"@1.13246`(波動カウント+価格+日時)、Smart Money の `SELL`/`BUY`、BushidoScalp の `Strong High`/`BOS` が取得できた。

## 2. 履歴の追加ロード(`load_more_history`)

- `chart.setVisibleRange()` は **"Not implemented"**(exportData・watchlist と同様、デスクトップビルドで無効)
- `chart.scrollChartByBar()` はロードを発火しない(かつユーザーのビュー位置を動かしてしまう)
- **正解: `chart.chartModel().mainSeries().requestMoreData(n)`** — ビューを動かさずバックグラウンドでロードする。`requestMoreDataAvailable()` で残データ有無を確認可能
- ロードは非同期・チャンク単位なので、バー数の増加を250ms間隔でポーリングし「要求数に達した / 1.5秒成長が止まった / 15秒タイムアウト」で完了判定
- 実測: 300 → 852 → 1103 本(日足で2022年4月まで遡及)

## 3. アラート一覧(`list_alerts`)

- `TradingViewApi.alerts()` はほぼ空のオブジェクトを返すのみで使えない
- **正解: ページ内 `fetch("https://pricealerts.tradingview.com/list_alerts", { credentials: "include" })`** — 応答 `{s, id, r: [...]}` の `r` がアラート配列
- `symbol` フィールドは `"OANDA:EURUSD"` 形式のほか、`={"symbol":"OANDA:USDJPY","adjustment":"splits",...}` という式形式がある → パースして中の symbol を取り出す
- 取得できる主フィールド: alert_id, name, symbol, resolution, condition, message, active, type, create_time, last_fire_time, expiration, last_error
- **読み取り専用に限定**。作成・変更・削除 API は意図的に呼ばない(セキュリティ方針)

## 4. Pine テーブル(`get_indicator_tables`、バックログ #9 で追加)

- テーブル本体は `_primitivesCollection.dwgtables`、セルは `dwgtablecells` に分かれて格納される
  - テーブル: `{ id, position("top_right" 等), rows, columns, ...色情報 }`
  - セル: `{ tableId, row, column, text, tooltip, colSpan, rowSpan, ...スタイル }`。`cell.tableId` がテーブルの `id` に対応
- **ストアのネスト深さが種類によって異なる罠**: labels/lines/boxes/tables は `外側Map → 内側Mapライク → ストア` の3層だが、**dwgtablecells は `外側Map → ストア` の2層**(内側Mapライクを挟まない)。ストア判定は「`_primitiveById`(Map)か `_primitivesDataById` を持つか」で行い、両形状を受け付ける必要がある
  - 内側Mapライク(je)は `values()` のみ実装で `entries()` は "Not implemented" を投げる点にも注意
- 復元は `grid[row][column] = text` の行列。次元はテーブル宣言(rows/columns)とセル実座標の大きい方を採用。セル0件のテーブル(入力で非表示等)は宣言メタのみ返し grid を省略
- 制約: セルの色(トレンド方向を色だけで表すテーブル)は colorIndex のみでパレット解決が必要なため未対応。テキストが唯一の情報源

## 制約・注意

- グラフィックスの2形態はアプリ内部実装依存(`_` プレフィックス)。アプリ更新で壊れる可能性が最も高い箇所なので、抽出ロジックは `getIndicatorGraphics` / `getIndicatorTables` 内に隔離し、統合テストで検知する
- `load_more_history` はロード済みデータをページに蓄積する(ユーザーが左スクロールした場合と同じ挙動)
- ~~dwgtables(Smart Money の右上テーブル等)は未対応~~ → バックログ #9 で対応済み(上記セクション4)
