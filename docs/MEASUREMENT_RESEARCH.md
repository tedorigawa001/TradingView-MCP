# 売買規則を持たない測定研究の登録 (106-4)

`register_measurement_hypothesis` は、売買規則を持たず検定族で判定する測定研究を、変更不能な定義としてローカルに追記する。初期の測定指標は `t_statistic`。取引件数・損益・profit factor・drawdown・ストラテジーの比較対象は要求しない。

`get_measurement_hypothesis` は `hypothesis_id` を指定して、定義・ハッシュ・記録日時・sequenceを含む記録1件を返す。未登録は `null`。どちらもチャート・Pine・ネットワークを利用しない。登録や照会は測定の実行・統計的な妥当性確認・売買への採用・DOT起動を伴わない。

## 入力と登録結果

登録入力は次の形式。例は説明用で、呼出しや登録は行っていない。

```json
{
  "hypothesis_id": "measurement-example-v1",
  "title": "四半期単位の測定",
  "thesis": "事前に固定した集計・t値計算方法で、測定量の平均がゼロと異なるかを調べる。計算式・標本除外条件は研究側で具体化する。",
  "evaluation_contract": {
    "population": "in_sample",
    "primary_metric": "t_statistic",
    "minimum_observations": 30,
    "observation_unit": "銘柄ごとの重複しない暦四半期1個を1観測とする。",
    "family_definition": "EURUSDとXAUUSDの2銘柄、各1検定、両側。ほかの候補・閾値は含めない。Holm補正を使う。",
    "decision_rule": "族の有意水準0.05。必要観測数未達・計算不能は判定保留とする。",
    "symbols": ["OANDA:EURUSD", "OANDA:XAUUSD"],
    "timeframes": ["61"]
  }
}
```

- IDは既存研究と同じ文字種・1〜80文字。titleは1〜120文字、thesisは1〜2,000文字。
- populationは既存の `in_sample` / `out_of_sample` / `walk_forward` / `stress` / `live`。`live` の登録も実行を開始しない。
- `minimum_observations` は1〜100,000の整数。取引件数とは区別する。
- `observation_unit` は1〜500文字。集約・重複・欠損の扱いを具体化する。
- `family_definition` と `decision_rule` は各1〜2,000文字。検定対象・派生候補・多重性の扱い、方向・閾値・不足時の扱いを具体化する。
- symbolsとtimeframesは各1〜20件。既存と同じ銘柄・時間足の構文を使う。数値61は不可、文字列 `"61"` を渡す。
- 文字列の空白だけの入力、未知の項目、売買用の項目、未対応のmetricは拒否する。必須項目は補完しない。保存クラスへ直接渡したsymbols・timeframesも全添字の存在と文字列の形式を確認し、疎配列を正規化・追記前に拒否する。

観測単位・検定族・判定規則は自由記述で、意味や数学的妥当性を機械検証しない。t値の計算式・集計方法・標本除外条件などもthesisや契約に記載して固定する。登録だけでは、独立性・十分な標本数・適切な多重性補正・事前登録時点・未使用データを証明しない。

成功応答は既存登録と同じ `{ recorded, idempotent, entry }`。新規登録は `recorded:true`、同じID・正規化後に同じ定義なら `recorded:false, idempotent:true` で元の記録を返し、追記しない。定義を変える場合は新しいIDが必要。同じIDで異なる定義はエラーとする。エラーを受けた窓口が自動的に再登録する処理はない。

## ハッシュと記録形式

新規のkindは `measurement_hypothesis_registered`、行の `schema_version` は既存と同じ `1.0`。`entity_id` はhypothesisId、`evidence_hash` は `null`。測定結果はこの機能では記録しない。

新しいpayloadの `definitionSchema` は固定値 `measurement_hypothesis_v1`。ハッシュは、次の順序で構成したpayloadを `JSON.stringify` した文字列のUTF-8バイト列に対するSHA-256、接頭辞は `sha256:`。改行・字下げは付けない。event_id・sequence・recorded_atは定義に含めない。

1. payload: `definitionSchema`, `hypothesisId`, `title`, `thesis`, `evaluationContract`
2. evaluationContract: `population`, `primaryMetric`, `minimumObservations`, `observationUnit`, `familyDefinition`, `decisionRule`, `symbols`, `timeframes`

公開入力のsnake_caseを上記camelCaseへ対応付ける。symbolsとtimeframesは大文字化・重複除去・文字列の昇順ソートを行う。入力オブジェクトのキー順や対象リストの順序だけでは定義を変えない。ほかの文字列は原文を保持し、空白・改行・Unicodeを正規化しない。新しいschemaの全項目がハッシュの対象。読取りではハッシュ・ID・連番・重複などを照合し、不正な記録があれば停止する。

## 保存先と既存記録との互換性

既定の保存先は `~/.tradingview-mcp/measurement-research-journal.jsonl`。専用の環境変数 `TRADINGVIEW_MCP_MEASUREMENT_RESEARCH_JOURNAL_PATH` で変更できる。既存の `TRADINGVIEW_MCP_STRATEGY_RESEARCH_JOURNAL_PATH` と戦略・イベント研究の既定ファイルは変更しない。サーバー生成時は保存ファイルを作成せず、登録・照会時に既存ストアと共通のファイル処理を使う。

既存の戦略・イベントのvalidator、payloadキー順、ハッシュ計算、metricの集合、記録のkindは維持する。旧イベント形式のauditDefinition欠落も引き続き読める。旧行の書換え・移行は行わず、新しい必須項目や既定値を既存payloadに付け足さない。

共通ストアの新しいreaderは測定行も理解するが、旧版readerは新しいkindを理解しない。旧版との併用時は専用ファイルを維持し、設定で既存ファイルへ合流させない。明示的に混在させたファイルは新しいreaderで読めるが、旧版readerとの互換性はない。IDの名前空間もkindごとに独立する。

ストアは既存の所有者・通常ファイル・symlink・サイズ・追記・fsync・ロックの仕組みを再利用する。照会も一時的なロックファイルや保存先ディレクトリを作り得るため、ファイルシステムの副作用が全くない照会ではない。ロック取得には従来の待機・再試行・古いロックの検査がある。登録本体の自動再実行がないことと、これらの再試行を区別する。

## 範囲と未確認事項

この登録はstrategy/eventの `findHypothesis`、実験記録、イベント収集・監査runner、forward-periodのstrategy/event参照へ自動的に取り込まれない。既存の研究期間利用・試行数の記録も代行しない。測定結果の格納、結果に基づく判定、統計量の計算、研究ごとの実行器の追加は対象外。

単体テストは一時ディレクトリの架空記録とインメモリMCPだけを使う。修正前に取得した戦略仮説・実験・旧イベント仮説・イベント結果・audit付きイベント仮説の5行をfixtureとして固定し、定義/証拠ハッシュ、再登録時の元の行、保存済みバイト列、新規に同じpayloadを登録した場合のハッシュを確認する。実際の保存済み研究の移行・本番登録・稼働版への反映は行っていない。

測定のv1定義も `test/fixtures/measurement-research-v1.jsonl` の保存済み1行と、独立に計算した期待ハッシュ `sha256:0c94aab4690577ab90ce939741f77e495c1d3194e728939eb04b1d1ec099615e` を固定する。読取り・再登録で元の行とバイト列を保持し、新規登録でも同じハッシュになることを確認する。fixtureを試験対象の実装から自動再生成しない。キー順だけを変えた一時的な変異実装では、期待ハッシュと保存済み行の読取りの両試験が失敗することを確認済み。疎配列は全要素未設定・一部未設定について、新規ファイルを作成せず、既存行に追記せず、元の行を引き続き読めることを検証する。

既存STOPと監視への採用不可条件を維持する。この実装はコミット・実チャート操作・DOT起動・外部モデル実行・実データのバックテストを承認しない。
