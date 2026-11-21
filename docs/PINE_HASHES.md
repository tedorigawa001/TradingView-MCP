# 表とPineソースのハッシュ (106-3)

`get_indicator_tables`・`get_pine_source`・`save_pine_script` の従来の応答にハッシュ情報を追加する。既存フィールドと配列構造は保持する。ハッシュのための追加取得・追加保存は行わない。106-2の一括取得も同じ共通実装を使う。

既存STOPと監視への採用不可条件を維持する。機能の実装は実チャート操作やソース保存の承認を意味しない。ここでの検証は単体テストと偽の取得・保存経路だけで行う。

## 応答フィールド

| ツール | 追加フィールド | 対象 |
|---|---|---|
| `get_indicator_tables` | 各表の `hashSchema`・`sha256` | その1回の応答で返された表 |
| `get_pine_source` | `sourceHashSchema`・`sourceSha256` | 返されたソース本文 |
| `save_pine_script` | `sourceHashSchema`・`submittedSourceSha256`・`sourceSha256` | 投入本文と、読戻し一致を確認した保存本文を区別 |

すべてSHA-256で、値は `sha256:` と小文字16進数64文字。ハッシュは内容照合のための値で、署名・保存時刻・第三者による証明ではない。ソースのコンパイル成功や測定結果の妥当性も意味しない。

## 表: indicator_table_v1

106-2と同じ[表ハッシュv1](INDICATOR_TABLE_STUDY.md#表ハッシュ-v1)を使用する。`hashSchema:"indicator_table_v1"` とし、次のキー順のオブジェクトを `JSON.stringify` したUTF-8をハッシュする。

```text
{ id, position, rows, columns, cellCount, grid, tooltips }
```

tooltipは行・列・文字列のUTF-16コード単位順に整列し、各要素のキー順は `{row,column,tooltip}`。空白・改行・Unicodeを変更しない。`hashSchema` と `sha256` 自体は対象外。表IDも含むため、表示文字列が同じでも表IDが違えば値は変わる。

表のエラー、空の表、グリッド欠落、不正な寸法、200文字を超えるセルやtooltipなど、完全性を確認できない表は `sha256:null`。指標全体にエラーがある場合も、その指標の表のハッシュは `null` にする。既存のグリッドやエラー情報は返したままにする。表を読み直したり、欠落部分を取得し直したりしない。表が0件なら従来どおり空配列で返す。

## ソース: pine_source_lf_v1

`sourceHashSchema:"pine_source_lf_v1"` とし、ソース文字列のCRLFだけをLFへ置換して、そのUTF-8をハッシュする。

```text
SHA-256(UTF-8(source.replace(/\r\n/g, "\n")))
```

単独CR、BOM、末尾改行、空白、Unicodeは変更しない。LF版とCRLF版は同じハッシュになる。本文のトリムやUnicode正規化はしない。

`get_pine_source` の `source`・`sourceLength`・`version` は従来の値を保持し、ハッシュを計算するために再取得しない。ハッシュは正規化後の本文に対する値なので、CRLFを含む返却文字列をそのままハッシュした値とは異なる場合がある。既定の `version:"last"` と、番号で指定した版の取得方法も維持する。

## 保存の投入本文と読戻し

`save_pine_script` は引き続き既定でプレビュー。`confirm:true` の呼出しでだけ、従来どおり新規スクリプトまたは新バージョンを保存する。

- `submittedSourceSha256`: 投入する `source` の正規化後ハッシュ。プレビューでも返す。保存済みの証跡ではない。
- `sourceSha256`: 保存後の既存の読戻しで、所有ID・確定版・文字列本文と投入本文の正規化後一致を確認できた場合だけ返す。プレビュー、読戻し失敗、不一致、版不明などは `null`。
- `sourceHashSchema`: 両方とも `pine_source_lf_v1`。

保存側が `dryRun:false`・`saved:true`・`verified:true` を返し、有効な `USER;…` IDと番号の版を持つ場合だけ保存本文のハッシュを付ける。既存の `verified` はCRLF正規化後の本文一致を示すため、一致した投入本文から同じハッシュを計算できる。ハッシュ付与のための別のソース取得は行わない。

保存後の読戻しでは、新バージョン保存の応答IDが要求IDと異なる場合、または所有IDとして不正な場合は取得せず未確認とする。読戻し本文が文字列でない場合や、版が `null`・`last`・不正形式の場合も一致確認にしない。文字列への暗黙変換で欠落本文を一致扱いしない。

既存の読戻し先は `/last` のままで、`version` はその応答で観測した番号。ハッシュはその読戻し時点で一致した内容を示し、保存要求ごとの一意な版生成や他の同時保存との対応を新たに証明するものではない。

| 状態 | `submittedSourceSha256` | `sourceSha256` |
|---|---|---|
| プレビュー | 投入本文の値 | `null` |
| 保存後の読戻し一致 | 投入本文の値 | 一致した保存本文の値 |
| コンパイル失敗・読戻し一致 | 投入本文の値 | 一致した保存本文の値 |
| 読戻し失敗・不一致・IDや版が未確認 | 投入本文の値 | `null` |

コンパイルエラーでも本文が保存される既存の動作を保持する。`compileOk`・エラー・警告・復元案内は引き続き別に確認する。`saved:false`・`verified:false`・`sourceSha256:null` でも、保存要求が既に反映されている場合がある。確認失敗を理由に保存や読取りを自動で再試行しない。保存処理自体が例外になった場合のエラー応答形式は変更しない。

## 固定版の照合: pine_report_state_v1

台帳全体を読まずに、アクティブな戦略の固定版Pineソースを照合するための3段階。どの段階も読取り専用で、ソース本文は返さない。

1. 取得: `get_strategy_trade_ledger` に `capture_report_state:true` だけを渡す（任意で `expected_ledger_id`）。`ledgerId`・`studyId`・`pineId`・`pineVersion`・`reportStateSha256` と、ハッシュした状態そのもの `reportState`（`reportStateSchema:"pine_report_state_v1"`）を返す。応答は8 KiBまで。通常の台帳と同じくチャート操作ロックの下で読む。
2. 照合: 後で `identity_study_id`・`expected_ledger_id`・`expected_report_state_sha256` に取得値を渡す。同じ戦略・台帳・状態であることを確認できた場合だけ、`ledgerId`・`studyId`・`pineId`・`pineVersion`・`reportStateSha256` を返す。失敗した照合は、それ以前の照合結果も無効にする。
3. ハッシュ: `get_pine_source` に同じ `pine_id`・番号の `version`・`bounded_hash_ledger_id`・`bounded_hash_report_state_sha256` を渡す。直前の照合結果と一致する場合に1回だけ、`responseBytes`・`sourceBytes`・`rawSourceSha256`（本文そのまま）・`sourceSha256`（`pine_source_lf_v1`）・`scriptIdEvidence` を返す。応答本体は128 KiBまで。応答の版が要求と完全一致し、本文が文字列であることを必須とする。応答にスクリプトID（`scriptIdPart`）がない場合は要求URLのIDに依拠して `scriptIdEvidence:"request_url_only"`、あれば一致を確認して `"response_field"` とし、異なるIDなら拒否する。不一致は項目ごとの固定の理由で返す。

`reportState` のキー順は次のとおりで、ページ側でこのオブジェクトを `JSON.stringify` したUTF-8をハッシュする。返された `reportState` を同じ方法で直列化すれば `reportStateSha256` を再計算できる。

```text
{ schema, ledgerId, studyId, currency, metrics, openProfit, totalProfit }
```

`metrics` は純損益とその割合・最大ドローダウンとその割合・取引数・勝ち数・プロフィットファクター・勝率。`openProfit` は含み損益で、建玉がある場合は必須。`totalProfit` は読めなければ `null`。

初期資金・注文サイズ・手数料・スリッページ・ピラミッディング・約定条件・証拠金・バー拡大鏡・標準OHLCなどのストラテジー設定は、実機では戦略スタディ自身の入力値として現れ、レポートの `settings` には含まれない。入力値はすべて `ledgerId` の計算対象なので、設定の変更は `ledgerId` の変化として検出される。照合でも、読取り中に入力値が変わっていないことを確認する。

主要指標や通貨が読めない場合、ID付きの戦略スタディが確認できない場合、自分の `USER;…` スクリプトの番号付き版でない場合（`last` を含む）、扱えない入力値がある場合、取引数が要約と一致しない場合は、取得も照合も行わない。読取り中にチャート・戦略・レポート・銘柄・時間足・取引・Pine版・入力値が変わった場合も中止する。通常の台帳の `ledgerId` の計算方法は変更しない。

## 検証範囲

MCP応答の形と追加取得なし、LF/CRLFの一致、単独CR・BOM・Unicode・空白の区別、不完全な表のハッシュ抑止、プレビュー、正常保存、コンパイルエラー、読戻しの不一致・欠落・取得失敗、所有IDと版の確認を偽の取得・保存経路で検証する。106-2の表ハッシュと後片付け・証跡保持の回帰テストも維持する。固定版の照合は、取得したハッシュでの照合成功、拒否条件、読取り中の変化、応答上限、照合結果の消費と失効を偽のページと偽のサーバー依存で検証する。

実チャートや保存済みスクリプトへの操作は未実施。実機の保存応答・読戻し形式との対応は未確認。

`pine_report_state_v1` の項目は、2026-11-21に実機の1戦略（日足のEURUSD、`USER;…` の番号付き版）で、チャートを変えない読取りだけで確認した。主要指標・含み損益・通貨は実機で値を返した。レポートの `settings` にストラテジー設定はなく、`performance.initialCapital` は `null` だった。一方、ストラテジー設定は戦略スタディの入力値として読めた。同日、取得と照合は実機で通った（取得した状態を手元で直列化したハッシュも一致）。固定版ハッシュは、応答の識別確認で停止したため、上記の項目別の確認に改めた。固定版取得の応答形式と、改めた後の実機での動作は未確認。
