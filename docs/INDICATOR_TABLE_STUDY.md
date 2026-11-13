# インジケーターの表を銘柄ごとに取得する (106-2)

`run_indicator_table_study` は、自分の保存済みPineインジケーターの確定版を、明示した1枚のチャートで一時的に動かす。銘柄ごとに履歴を追加取得し、計算待ちの状態を確認した後、表を1回取得する。表・SHA-256・指定セルの照合結果・履歴の到達範囲・後片付けと復元の結果を返す。

既定はプレビュー。`confirm:true` を指定した呼出しでのみチャートを操作する。実装の追加は実チャート操作やDOT起動の承認を意味しない。既存STOPと監視への採用不可条件を維持する。

## 入力

説明用の例。Pine ID・版・現在のチャート・セルの期待値は実際の対象に置き換える。この例はプレビューだけを返す。

```json
{
  "pine_id": "USER;YOUR_SAVED_SCRIPT_ID",
  "pine_version": "7.0",
  "chart_index": 0,
  "expected_symbol": "OANDA:EURUSD",
  "expected_timeframe": "61",
  "timeframe": "61",
  "symbols": [
    {
      "symbol": "OANDA:EURUSD",
      "expected_cells": [{"table_index": 0, "row": 0, "column": 0, "text": "OANDA:EURUSD"}]
    },
    {
      "symbol": "OANDA:XAUUSD",
      "expected_cells": [{"table_index": 0, "row": 0, "column": 0, "text": "OANDA:XAUUSD"}]
    }
  ],
  "history_chunk": 5000,
  "max_history_attempts": 24,
  "confirm": false
}
```

- `chart_index` は必須。アクティブなチャートへの暗黙の切替はしない。`expected_symbol`・`expected_timeframe` は開始時と復元後の照合対象。
- `pine_id` は自分の保存済み `USER;…`、`pine_version` は番号で固定する。`last` は受け付けない。最新の保存版が別にあっても、指定版を追加する。
- `symbols` は重複なしの1〜12件。各銘柄を共通の `timeframe` で直列に取得する。
- `history_chunk` は1回の追加要求本数で1〜5,000、既定5,000。`max_history_attempts` は系列ごとの共通ローダー呼出し回数で1〜24、既定24。下位のネイティブ要求の総数を表すものではない。
- `expected_cells` は銘柄ごとの最大64件。`table_index`・`row`・`column` は0始まり。表の順序は `get_indicator_tables` が返す順序。文字列は最大200文字、空白や大文字小文字を含め完全一致で照合する。セルがない場合も不一致とする。
- 印の意味は呼出し側がPineソースに基づいて決める。取得先の銘柄・時間足・測定版などを区別できる印を指定する。期待値を取得結果から自動生成しない。照合指定がなければ `marker_checks_not_requested` として `partial` を返す。

プレビューは現在のチャート、Replay状態、保存済みスクリプトの所有情報、指定版のソースを読む。履歴取得・表読取り・指標追加・設定変更は行わない。

## 処理と終了条件

チャート操作の共有ロックをプレビュー開始から処理終了まで保持する。操作先には必ず指定したチャート番号を渡し、他のチャートには書き込まない。

1. 保存済みインジケーターであることと指定版のソースを照合し、ソースのSHA-256を記録する。ソース本文は返さない。
2. 対象銘柄・時間足へ一時変更し、106-1の共通ローダーで履歴を追加する。単発の追加0本や `moreAvailable:false` だけでは終了しない。各要求前にReplayとチャートの対応を確認する。
3. 空振り2回連続で取得を終了する。この判定は観測区間内の停止であり、配信元の全履歴を取得した証明ではない。試行上限の場合は `history_attempt_limit`、履歴0本の場合は `history_empty` とし、指標を追加せず残りの銘柄を停止する。
4. 指定版の指標を1つだけ追加する。実物の隠しPine ID・版・チャート・履歴本数・最古バー時刻を照合する。
5. 表を読まずに最大80回の状態観測を行う。各観測間の待機は250 ms。`loading:false` が9回連続した場合だけ先へ進む。読取り時間を除く待機上限は19.75秒。状態不明、版の相違、履歴窓の変化、待機上限はエラーとする。
6. 追加した指標の入力値を記録し、表を1回取得する。表の後にもPine ID・版・履歴範囲・計算状態・入力値を照合し、変化があれば表を返却対象から除外する。入力値は設定せず、作成された指標の実際の値を記録する。
7. 表のハッシュと印の照合結果を作り、追加した指標だけを削除する。元の銘柄・時間足へ戻し、元のスタディ一覧(IDと名前)を照合する。全体終了時にも最終状態を読み戻す。

表の照合不一致、不完全な表、履歴上限では `partial` と残件数を返し、残りを停止する。照合指定なしだけの場合は各銘柄の取得を続け、全体を `partial` とする。操作・版・計算待ち・読取り・削除・復元のエラーでは `aborted` とし、既に完了した結果も保持する。トランザクション冒頭の状態読取りで失敗した銘柄は未処理として `remaining` に含め、先行する `jobs`・`processed` と停止理由 `abortReason` を返す。その後の独立した最終状態照合も失敗した場合、先行結果と元の停止理由は保持し、全体の `chartStateAfter:null`・`chartRestored:false` とする。開始前の入力・所有情報・版の不一致は書込み前に拒否する。

読取りや追加の例外は再試行しない。削除できるのは、追加応答から指定チャートの新規IDを受け取り、その追加操作との対応を確認できた指標だけ。追加応答が失われた場合は、新規スタディが1件だけでPine IDと版が一致していても、同時に行われた手動追加と区別できないため削除しない。対応不明の指標は残存として報告し、`unattributed_studies_remaining` を付けて停止する。既存の指標も削除しない。削除失敗時も削除を繰り返さず、残存するスタディと停止理由を返す。中断要求を確認した後は新たな測定を進めず、対応が確認できた指標の後片付けと復元を行う。

履歴キャッシュは追加取得によって増える。復元確認の対象は銘柄・時間足・スタディ一覧で、ロード済み履歴の巻戻しは行わない。

## 返却する証跡

- `pine`: Pine ID、指定版、名前、`sourceSha256`。ソースのCRLFをLFへ置換した文字列のUTF-8をSHA-256にする。その他の空白・Unicode・単独CRは変更しない。
- `jobs[].historyLoad`: 初回・最終本数、増加本数、最古時刻とISO表記、試行数、終了理由、最終応答のavailability。`requestedBars` はこの取得モードでは1要求の本数、`requestedCountReached` は `null`。本数にはネイティブ系列が保持する形成中の足も含まれる。
- `jobs[].inputs`: 追加した指標の入力IDと実値。最大256件。取得経路が省略・切断した文字列や未対応の値は受け入れない。
- `jobs[].tables`: 表のID・位置・寸法・セル数・文字列グリッド・tooltipと `hashSchema`・`sha256`。
- `jobs[].markerChecks`: 指定セル・期待値・実値・一致可否。欠落セルの実値は `null`。
- `jobs[].cleanup`、`chartRestored`、`studiesRestored`、`chartStateAfter`: 削除と復元の確認結果。`cleanup.removedStudyIds` は削除を確認したID、`cleanup.remainingStudies` は開始時の一覧にない残存指標のIDと名前、`cleanup.unattributedStudyIds` はそのうち追加操作との対応を確認できないID。残存確認の読取りに失敗した場合、後者2項目は `null` として不明を示す。銘柄・時間足だけが復元できても残存指標があれば `studiesRestored:false`、全体の `chartRestored:false` となる。全体にも開始時・終了時のチャート、停止理由、処理済み件数、残件数を返す。

`complete` はこの手順の取得・照合・復元が通ったことを表す。指標の統計式、確定足処理、形成中の足、repaintの有無は自作Pineの実装に依存する。計算待ちの観測は `isLoading` の状態に基づき、描画や計算内容の正しさを証明するものではない。監視への採用や統計的優位性の自動判定は行わない。

## 表ハッシュ v1

`hashSchema` は `indicator_table_v1`。以下のキー順のオブジェクトを `JSON.stringify` し、そのUTF-8バイト列をSHA-256にする。返却値は `sha256:` と小文字16進数64文字。

```text
{ id, position, rows, columns, cellCount, grid, tooltips }
```

`tooltips` がない場合は `[]`。各tooltipは `{row,column,tooltip}` のキー順で、行、列、tooltip文字列の順に整列する。文字列比較はJavaScriptのUTF-16コード単位順で、環境の言語設定を使用しない。グリッドは行優先の配列をそのまま使用する。空白・改行・Unicodeを正規化せず、数値IDと文字列IDを区別する。`hashSchema` と `sha256` 自体はハッシュ対象外。

各銘柄の返却上限は表32件・全表合計2,000セル。上限を超える応答はエラーとして表を採用せず `aborted` にする。上限内での空の表、表単位の読取りエラー、不正な寸法、省略されたグリッド、200文字を超えるセル・tooltipなど不完全な表は `sha256:null` とし、`table_snapshot_incomplete` を返す。ハッシュは返却された文字列の証跡で、描画画像のハッシュではない。

表ハッシュとソースハッシュは、106-3の `get_indicator_tables`・`get_pine_source`・`save_pine_script` と同じ共通実装を使う。[応答フィールドと保存時の確認条件](PINE_HASHES.md)を参照。`pine` には `sourceHashSchema:"pine_source_lf_v1"` も返す。

## 検証範囲

単体テストと偽のTradingView経路による確認を行う。実チャートでの確定版追加、内部状態の互換性、非同期描画と復元、接続の切断やアプリ終了を伴う後片付けは未検証。Strategy Tester・外部モデル・通知・注文を呼び出す経路は持たない。
