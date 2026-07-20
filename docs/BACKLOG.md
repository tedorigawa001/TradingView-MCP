# 改善バックログ

2026-07-08 の実分析(EURUSD 1D)で確認された課題と改善案。優先度順。

## 完了済み(2026-07-08)

- ✅ **#1 ISO時刻 + 未確定バーフラグ** — `timeIso` 併記、最終バーの `forming` ヒューリスティック(分/S/D/W/M対応)
- ✅ **#2 マルチタイムフレーム** — `get_mtf_overview`(案A採用: スキャナーの `FIELD|TIMEFRAME` サフィックス。チャート非干渉、最大50カラム)
- ✅ **#3 チャート単位スクリーンショット** — `get_chart_screenshot` に `chart_index` 追加(`.chart-container` の矩形 + CDP `clip`、devicePixelRatio でRetina解像度)
- ✅ **#4 set_symbol 後のデータ有無検証** — 切替後にバー0本なら reject、結果に `bars` 数を含める(set_timeframe も同様)
- ✅ **#5 キーレベル集約** — `get_key_levels`(現在価格±N%のプロット値・水平ライン・ボックス端・ラベルを出所付きで統合。`is_price_study` でオシレーターを除外し RSI 値等の誤検出を防止)
- ✅ **#6 経済カレンダー** — `get_economic_events`(economic-calendar.tradingview.com、認証不要 GET。国・重要度・期間フィルタ、comment 等の冗長フィールドは除去)
- ✅ **#9 インジケーター内テーブルの読み取り** — `get_indicator_tables`(dwgtables/dwgtablecells からセルテキストを `grid[row][column]` で復元。tablecells はストアのネストが他と異なる点に対応)
- ✅ **#10 Pine ソース読み取り** — `list_pine_scripts`(saved 一覧+チャート上スタディとの pineId 突合 `usedBy`)/ `get_pine_source`(`USER;` ID 限定でソース原文)。PDCA の Plan 工程
- ✅ **#8 バックテスト連携** — `run_backtest`(自作ストラテジーを一時適用→レポート取得→自動削除でチャート復元)/ `get_strategy_report`(チャート上のストラテジーのレポート読み取り。残留レポートの誤帰属ゲート付き)。PDCA の Check 工程。調査記録は [phase6-findings.md](phase6-findings.md)。リプレイ操作(replayApi)は未実装のまま将来課題
- ✅ **#11 Pine ソース保存+チャート反映** — `save_pine_script`(初の書き込み系。confirm なしはドライラン、新規 or 新バージョンのみの非破壊設計、旧バージョンは `get_pine_source(pine_id, version)` で復元可)/ `add_pine_to_chart`(追加のみ、削除はしない)。**PDCA の Act 工程 — ループ完成**
- ✅ **#15 分析結果のチャート反映** — `get_analysis_overlay_template`(固定・監査可能な汎用Pine)/`apply_analysis_overlay`(銘柄・時間足・専用入力契約を照合、confirm付き反映、入力+描画の読み戻し検証)。分析時刻・期限を固定し、期限切れは`EXPIRED`表示。注文・アラートとは非接続
- ✅ **#16 分析オーバーレイのライフサイクル管理** — `ensure_analysis_overlay`(現行版再利用/未配置追加/旧版の14入力移行→検証→旧版削除、失敗時ロールバック)/`remove_owned_study`(`USER;` Pine ID+hidden pineId+chart照合、confirm必須)。`list_pine_scripts.usedBy`へ配置版`version`を追加
- ✅ **#17 分析オーバーレイの状態確認** — `get_analysis_overlay_status`(配置・監査済みソース・14入力・期限・現在価格との位置関係・描画数を読み取り専用で検証)。現在値から過去の水準到達や到達順序は推定しない
- ✅ **#18 分析オーバーレイの事後評価** — `evaluate_analysis_overlay_outcome`(分析時刻後のロード済み確定OHLCだけを時系列評価。Entry→任意Confirmation後のTarget/Stop初回到達を判定し、同一足・ギャップ・履歴不足は`ambiguous`/`incomplete`)
- ✅ **#19 事後評価の評価用時間足分離** — `evaluation_timeframe`指定時に対象チャートだけを一時切替し、OHLC証拠のsymbol・resolution・バー有無を検証して元時間足へ復元。復元失敗は`chartState`へ明示し、競合するチャート操作を直列化
- ✅ **#20 分析ジャーナル** — apply確定時の分析定義と明示指定された事後評価を安全なローカルJSONLへ記録。ID/定義衝突と状態逆行を防ぎ、履歴参照・銘柄/bias別の確信度較正を提供
- ✅ **#21 分析オーバーレイの銘柄・時間足バインド** — 18入力版へ更新し、保存されたsymbol/timeframeと現在チャートの不一致をstatus・事後評価でfail-closedに検出
- ✅ **#22 トレード計画の事前検証** — `validate_trade_plan`で方向、水準、期限、証拠鮮度、イベント停止、コスト控除後RRを副作用なしで検証
- ✅ **#23 意思決定コンテキスト統合** — `get_trade_decision_context`でチャート、市場、マクロ、ポジショニング、執行証拠を同一snapshotへ拘束
- ✅ **#24 執行スナップショット** — `get_execution_snapshot`でbid/ask、spread、配信状態、価格更新を検証し、静止・遅延・crossed quoteをfail closed
- ✅ **#25 リスク基準ポジションサイズ** — `compute_position_size`でコスト・換算・数量刻みを含め、許容損失を超えないinstrument unitを切り下げ計算
- ✅ **#26 分析監視アラート** — `create_analysis_alerts`で監査済みオーバーレイから期限付き価格アラートをpreviewし、明示確認後に冪等作成・読み戻し検証・ジャーナル関連付け
- ✅ **#27 ジャーナル分析の一括事後評価** — `evaluate_due_analyses`で期限到来・非終端分析を選定し、指定チャートを分析ごとに切替・評価・記録・復元。個別失敗は継続し、復元失敗時だけ中止
- ✅ **#28 事後評価指標の拡張** — 評価時にentry midpoint基準の経路指標を保存し、`get_analysis_performance`で勝敗、gross/net R、MFE/MAE、到達時間を母集団・除外数付きで集計
- ✅ **#29 チャート指定操作の一般化** — `set_symbol`/`set_timeframe`へ`chart_index`を追加し、変更・読み戻し・ロールバックを共通トランザクションへ集約。#27の一時切替も同じ実装へ統一

## 優先度: 高

### #1 OHLCV応答の可読性向上(ISO時刻 + 未確定バーのフラグ)✅ 完了

- **課題**: `get_ohlcv` / `get_indicator_values` の時刻が UNIX 秒のみで、AI が毎回変換を要する。また最終バーが形成途中(セッション開始直後で出来高極小など)でも確定足と区別できず、誤読リスクがある(実際に誤読しかけた)
- **案**: 各バーに `timeIso`(UTC ISO8601)を併記し、最終バーが未確定の場合 `forming: true` を付与。判定は「シンボルの取引セッション中かつ最新バー」または資産クラス別のバー間隔ヒューリスティック
- **規模**: 小(式の変更のみ)。既存テストの期待値更新が必要

### #2 マルチタイムフレーム分析(`get_mtf_overview`)✅ 完了

- **課題**: 「日足で環境認識 → 4H/1H でタイミング」という基本の型が実行できない。現状は `set_timeframe` でユーザーのチャートを実際に切り替えるしかなく、画面が動き、往復も遅い
- **案A(推奨・軽量)**: スキャナー API のカラム名は `RSI|240` / `EMA20|60` のように時間足サフィックスを受け付ける。これを使い、チャートに触れずに複数時間足の主要指標(RSI・MA・Recommend.All 等)を1回で返す `get_mtf_overview` を追加
- **案B(重量)**: 「時間足切替 → OHLCV取得 → 復元」を1ツールに固めた複合ツール。フル OHLCV が必要な場合のみ。ユーザーのチャートが一瞬動く副作用は残る
- **規模**: 案Aは中(scanner.ts 拡張+ツール1本)。案Bは中〜大(復元の堅牢性設計が必要)

### #3 チャート単位のスクリーンショット ✅ 完了

- **課題**: スクリーンショットが全ウィンドウ固定のため、マルチチャートレイアウトでは1チャートあたりの解像度が下がり、ウォッチリスト等の無関係な領域もトークンを消費する
- **案**: `get_chart_screenshot` に `chart_index` パラメータを追加。チャートペインの DOM 要素から `getBoundingClientRect` を取り、CDP `Page.captureScreenshot` の `clip` に渡す
- **規模**: 小〜中(ペイン矩形の特定がポイント)

### #4 `set_symbol` 後のデータ有無検証 ✅ 完了

- **課題**: 2026-07-08 の統合スモークで、存在しない想定の `ZZZINVALIDXYZ123` を `set_symbol` すると、`chart.symbol()` は `ZZZINVALIDXYZ123` へ変わり `changed: true` で返る一方、直後の `get_ohlcv(3)` は `count: 0` だった。現在の成功判定は「表示シンボル名が requested と一致するか」だけなので、データ未ロード/無効シンボル状態を成功扱いできる
- **案**: `set_symbol` の完了時に `mainSeries().bars()._items.length > 0` などを確認し、バーが 0 本なら reject または `{ changed: true, dataReady: false, bars: 0 }` を返す。`set_timeframe` も同様に切替後のバー有無を確認すると安全
- **規模**: 小〜中。TradingView 側が銘柄検索中/ロード中の一時状態を返す場合があるため、短いポーリングとエラー文言の調整が必要

## 優先度: 中

### #5 キーレベル集約(`get_key_levels`)✅ 完了

- **課題**: 実分析では SMC プロット値・BushidoScalp の S/R・描画ライン(3ツールの出力)を手動で統合してレベル表を作った。毎回同じ後処理になる
- **案**: 現在価格から ±N%(デフォルト 3% 程度)にある有効レベルを、出所(インジケーター名・プロット名/ラベルテキスト)付きで1つの表に統合して返す。`get_indicator_values` + `get_indicator_graphics` の内部合成
- **規模**: 中。「有効(未ブレイク)」判定の定義が論点

### #6 経済カレンダー(`get_economic_events`)✅ 完了

- **課題**: テクニカル分析の結論(例: サポート攻防)が直後の重要指標で無効化され得るが、ファンダメンタルズの文脈が一切見えない
- **案**: TradingView の経済カレンダー API(認証不要)から、通貨・重要度・期間でフィルタしたイベントを返す。scanner.ts と同様の Node 直叩き+スキーマ検証
- **規模**: 中。エンドポイントの仕様調査から

## 構想: Pine スクリプト改修 PDCA(2026-07-08 探索済み)

「AI がソースを読む → 改修する → 保存する → チャートに適用する → バックテストを流す → 結果を読んで再改修」のループ。実現可能性の探索結果:

- ✅ **ソース取得は可能と確認済み**: Pine Editor が使う `pine-facade.tradingview.com` REST(アプリのセッションで認証)。`/pine-facade/list/?filter=saved` で自作スクリプト一覧(study/strategy の別・バージョン付き)、`/pine-facade/get/<pineId>/last` で Pine ソース原文(`//@version=5 ...`)が取れる
- チャート上のスタディが持つ `pineId`(`USER;<hash>`)と saved 一覧を突合すれば「表示中インジケーターのソース」を特定できる
- ❌ チャート側の隠し入力 `text` はコンパイル済み IL(難読化)であり原文ではない。保護スクリプト対策のフィルタは現状のまま維持する

### #10 Pine ソース読み取り(`list_pine_scripts` / `get_pine_source`)✅ 完了

- **案**: 読み取り専用 GET のみ。対象は自作(saved)スクリプトに限定 — 他者の保護/招待制スクリプトのソースには触れない(現行のリーク防止方針を維持)
- **規模**: 小〜中。PDCA の起点であり単体でも「AI にインジケーターをレビューさせる」用途で有用
- **セキュリティ**: 読み取り専用だが、ソース全文が AI コンテキストに載る点を security-review に明記

### #11 Pine ソース保存・チャート反映(書き込み系・確認フロー前提)✅ 完了

- **案**: pine-facade の保存系エンドポイントを探索の上、**非破壊原則**を必須とする — 既存スクリプトの上書きではなく新バージョン/別名ドラフトとして保存し、元にいつでも戻せること。`confirm: true` + ドライラン(diff 表示)+ 保存後の検証、という #7 と同じ3点セット
- チャートへの適用方法(pineId 指定での study 追加 API)は要探索 → Phase 6 で解決済みの記述子ルートを流用
- **規模**: 中〜大+セキュリティレビュー必須(書き込み系の方針変更)→ [security-review.md](security-review.md) 追補に記載

## 優先度: 低(要設計)

### #7 アラート作成(書き込み系・確認フロー前提)

- **課題**: 分析の自然な帰結が「このレベルにアラートを張る」だが、書き込み系は方針として非公開
- **案**: `create_alert` を追加する場合は (1) `confirm: true` 必須、(2) 作成前に内容をドライラン表示、(3) 作成後に alert_id を返して `list_alerts` で検証可能に、という3点セットを最低条件とする。削除・変更は当面対象外
- **規模**: 中+セキュリティレビュー必須([security-review.md](security-review.md) の方針変更を伴う)

### #8 リプレイ/バックテスト連携 ✅ 完了(バックテスト部分)

- **課題**: 波動カウント等の分析を過去時点で検証する手段がない
- **実装(2026-07-08)**: `run_backtest` + `get_strategy_report`。`createStudy({type:'pine', pineId, version:'last'})` で一時適用し、`backtestingStrategyApi` のレポートを整形して返す(削除後の残留レポートを誤って返さないゲート付き)。詳細は [phase6-findings.md](phase6-findings.md)
- **残り(将来課題)**: リプレイ操作(`replayApi` の selectDate / doStep / スクリーンショットの組み合わせ)。replayApi には buy/sell 等のペーパートレード関数も含まれるため、公開時は書き込み系の設計が必要

### #9 インジケーター内テーブルの読み取り(`dwgtables`)✅ 完了

- **課題**: Smart Money の右上サマリーテーブル等が読めない(Phase 5 で意図的にスコープ外)
- **案**: `dwgtablecells` からセルテキストを行列で復元
- **規模**: 小〜中

## 構想: 実運用PDCA(2026-07-09、RSI2平均回帰の実戦検証で判明)

BushidoScalp・Smart Money・新規RSI2平均回帰の3ストラテジーで多銘柄・多時間足のA/Bチューニングを実践した結果、**同じボイラープレート(生CDPで `chart.getStudyById(id).setInputValues()` / `backtestingStrategyApi().setStrategyInput()` を直接叩く使い捨てNode.jsスクリプト)を6回書く**羽目になった。パラメータを1つ変えて再計測する、というツール不在が最大のボトルネックだった。

### #12 `set_indicator_input`(入力値の書き込みツール)✅ 完了

- **課題**: `get_indicator_inputs` は読み取り専用。パラメータチューニング(OFAT検証等)のたびに、ソースを保存し直すか生CDPを叩く必要があった
- **実装(2026-07-09)**: `set_indicator_input(study_id, inputs, chart_index?)`。内部は `chart.getStudyById(studyId).setInputValues([{id, value}, ...])` の単一実装で **strategy・plain indicator の両方に同一APIで動作する**ことを実機確認済み(当初は strategy 用に `backtestingStrategyApi().setStrategyInput` が別途必要と想定していたが、汎用の `setInputValues` だけで strategy のバックテストレポートも正しく再計算されることを検証し、分岐不要と判明)
- **安全性**: `save_pine_script` と異なり Pine ソース/ライブラリへの永続化はない。ただしチャート上のスタディインスタンスの入力値はライブ状態として残り、復元するまで変更されたまま(TradingView のレイアウト自動保存の対象にもなり得る)。`set_symbol`/`set_timeframe` と同じ「操作系・confirm不要」クラス。Pine内部入力(`text`/`pineId`等)は書き込み拒否
- **レポート再計算の検知**: strategyのレポートオブジェクト同一性 + `studyApi.isLoading()` の両方を監視するデバウンス方式(`run_backtest`の残留レポート対策と同じ設計思想)。plain indicatorはレポートが無いため`isLoading()`側のみで検知
- **規模**: 中。テスト: ユニット94件・統合28件(strategy/indicator双方の実機ラウンドトリップ含む)

### #13 スタディ削除ツール ✅ 完了(2026-07-15)

- **課題**: `add_pine_to_chart` は方針どおり追加専用。検証用に追加したスタディの後片付けに生CDPの `removeEntity` を直接叩く必要があった
- **実装**: `remove_owned_study(pine_id, study_id, expected_symbol, expected_timeframe, chart_index?, confirm?)`。`list_pine_scripts.usedBy`の対応とStudy内部のhidden `pineId`を二重照合し、confirm後に1インスタンスだけ削除。5秒以内の消滅を読み戻し確認
- **追加用途**: `ensure_analysis_overlay`のトランザクション内部でも利用。新バージョンの入力移行・settle・読み戻し・配置バージョン確認が完了するまで旧版を消さず、失敗時は新規側を削除して旧版を保持

### #17 分析オーバーレイ状態確認 ✅ 完了(2026-07-15)

- **課題**: 反映後の分析が有効期限内か、現在価格がエントリー帯や各水準に対してどこにあるか、Pine描画が欠落していないかを再確認するには複数ツールの手作業による突合が必要だった
- **実装**: `get_analysis_overlay_status(pine_id, expected_symbol, expected_timeframe, chart_index?)`。対象チャートと自作Pineの配置を照合し、配置版ソースが固定テンプレートと完全一致する場合だけ14入力を解析する。初期入力は`unconfigured`、手動編集等による契約違反は`blocked`として価格判定へ進めない。構成済み分析では`active`/`expired`/`future`、現在価格との位置関係、Risk/Reward、期待描画数との一致を返す
- **判定境界**: 現在価格には取得時点の最新バー終値を用い、形成中かどうかを明示する。現在値がTargetやStopを越えていても、過去の到達事実や到達順序を証明しない。履歴ベースの約定・勝敗判定は別機能とする

### #18 分析オーバーレイ事後評価 ✅ 完了(2026-07-15)

- **実装**: `evaluate_analysis_overlay_outcome(pine_id, expected_symbol, expected_timeframe, chart_index?, count?)`。配置版Pineソースと14入力を再検証し、現在ロード済みOHLCを最大5,000本取得する。分析時刻を含む足と形成中足を除外し、Entryの後、設定時は後続足のConfirmationを待つ。確認前のInvalidationはシナリオ取消、有効化後はTarget 1対Stopの初回到達証拠を評価する。Targetはbullish厳密昇順/bearish厳密降順、StopはInvalidationより外側を入力契約で保証する
- **保守的ラベル**: TargetとStop、EntryとConfirmation、または有効化とTerminalが同一足なら順序を決めず`ambiguous`。直前終値から始値でTerminalを飛び越えた場合も約定を仮定せず`gap_across_terminal`。分析開始を履歴が覆わない場合、または分析時刻から期限までが除外対象の同一足内に収まり評価可能な確定足が0本の場合は`incomplete`とし、`load_more_history`または短い評価時間足を案内する
- **責務境界**: `evaluation_timeframe`未指定時は読み取り専用。指定時は対象チャートの時間足だけを一時変更して復元する。注文・約定・スリッページ・損益を計算せず、評価ログにも追記しない。必要な場合は既存Evaluation Pipelineが返却結果を明示的に記録する
- **時間足**: TradingViewの数字省略形式`D`/`W`を1日/1週として受理する。暦月`M`は月長が可変で期限境界を固定ミリ秒へ安全に変換できないため、30日近似せず`not_evaluable`を返す

## 構想: 分析オーバーレイの実運用改善(2026-07-16、#18の実機検証で判明)

USDJPY 4H の実分析(analyzedAt 12:35Z・期限 14:00Z)を `evaluate_analysis_overlay_outcome` で事後評価した際、分析窓85分に確定4H足が1本も入らず `incomplete` になった。正しい保守的挙動だが、実際の評価には手動で15分足へ切替→OHLCV取得→4Hへ復元の3ステップが必要だった。また、分析は上書き式のため過去分析(確信度の変遷・各シナリオの結末)がチャット履歴にしか残らず、事後評価を蓄積した検証ができない。

### #19 事後評価の評価用時間足分離 ✅ 完了(2026-07-16)

- **課題**: `evaluate_analysis_overlay_outcome` はオーバーレイが載っているチャートの時間足に縛られる。イベントドリブンな分析(期限が数時間先)では、チャート時間足より分析窓が短くなり、確定足ゼロで毎回 `incomplete` になる
- **実装**: `evaluation_timeframe`を追加し、指定時のみ「対象`chart_index`の時間足を一時切替→OHLCV取得→元の時間足へ復元」を1ツール内で行う。`expected_timeframe`はオーバーレイ検証対象、`evaluationTimeframe`は証拠解像度としてレスポンス上も分離した
- **安全性**: 切替後にチャートのsymbol/timeframeを再検証し、取得OHLCVについてもsymbol・resolution一致と1本以上のバーを要求する。失敗時も復元を試み、復元不能なら評価結果を保持したまま`chartState.restored: false`、現在時間足、エラー、`qualityIssues`を返す。主要チャート読み取り、`set_symbol`、`set_timeframe`、`run_backtest`、Pine追加、入力変更、分析オーバーレイ管理は同じプロセス内キューで直列化する

### #20 分析ジャーナル ✅ 完了(2026-07-16)

- **課題**: `apply_analysis_overlay` は上書き式で、過去の分析(確信度64%→55%への変遷等)とその結末が永続化されない。#18で結果(例: `expired_without_confirmation`)を判定できても、蓄積がなければ「確信度55%と言ったとき実際に何%当たるか」という較正検証ができない
- **実装**: `apply_analysis_overlay(confirm:true)`の入力読み戻し一致後に分析定義を専用JSONLへ自動記録。`evaluate_analysis_overlay_outcome(record:true)`でのみ評価結果を追記し、`get_analysis_journal`で分析別履歴、`get_analysis_calibration`で銘柄・bias別のBrier scoreと確信度帯別実現率を取得する
- **識別と単調性**: 人間可読な`analysisId`と内部UUIDの`event_id`を分離し、固定順序JSONのSHA-256で定義を拘束する。同じID・同じ定義は冪等、同じID・異なる定義は専用エラーで拒否して新しい`analysis_id`での再適用を案内する。評価は`evidenceThrough`を保持し、`complete`を後発の`ongoing`で置換しない。異なる`complete`ラベルは自動上書きせず衝突として拒否する
- **較正ラベル**: `target_before_stop`だけを正、`stop_before_target`だけを負とする。`ambiguous`、`incomplete`、未発動、確認前無効化、期限終了、neutral等は分母へ混ぜず、理由別の除外数を返す
- **保存と失敗分離**: 既定`~/.tradingview-mcp/analysis-journal.jsonl`、環境変数`TRADINGVIEW_MCP_ANALYSIS_JOURNAL_PATH`で変更可。ディレクトリ0700・ファイル0600、`O_NOFOLLOW`、所有者/サイズ/連番検証、fsync、プロセス間ロックを使用。60秒超かつ所有PID不在のstale lockだけをinode再照合後に回収し、その他のタイムアウトはロックパスを明示する。ジャーナル失敗で成功済みチャート反映をロールバックせず、`journal.recorded:false`と再試行情報を返す
- **見送り**: 複数シナリオ同時掲示(複数配置=ambiguous拒否の安全設計と衝突。両にらみは note と confidence で表現)、期限アラート・自動再評価(リクエスト駆動のMCPではなくエージェント側スケジュールの役割)

## 構想: AIのトレード判断支援を実運用化(2026-07-20、USDJPY実分析で判明)

USDJPY 4Hを実分析した際、チャート自体は`OANDA:USDJPY`だった一方、配置中の分析オーバーレイには過去のEURUSD分析IDとEURUSD価格水準が残っていた。呼び出し側で`expected_symbol`と`expected_timeframe`を指定しても、オーバーレイ入力自身が分析対象の銘柄・時間足を保持していないため、ソースと14入力の契約だけではこの取り違えを検出できない。また、MTF、キーレベル、イベント、COT、実質金利、執行コストを個別に取得・突合する手順と、反映前の分析案を売買ルールとして検証する手順がAI側に残っている。

安全境界として、以下は分析・監視・評価・計算に限定する。注文API、口座識別子、認証情報を取得・保存せず、発注・変更・決済を行わない。ライブ観測、過去のバックテスト、事後評価は出所と時点を分離し、過去成績を現在相場の証拠として扱わない。

### #21 分析オーバーレイの銘柄・時間足バインド ✅ 完了(2026-07-20)

- **課題**: オーバーレイ入力に分析対象symbol/timeframeがないため、EURUSD分析をUSDJPYチャートへ残した状態でも、固定Pineソースと既存入力が妥当なら`ready`/`trusted:true`になり得る。価格水準の桁や範囲による推測は銘柄横断で安全ではない
- **実装**: Pine入力契約の末尾へ`analysisSymbol`、`analysisTimeframe`、`snapshotId`、`strategyVersion`を追加して論理テンプレート版を`2.0`へ更新。`apply_analysis_overlay`で実チャートのsymbol/timeframeを保存し、任意のsnapshot ID・strategy versionとともに全18入力を読み戻す。`get_analysis_overlay_status`と`evaluate_analysis_overlay_outcome`は保存文脈を現在チャートと再照合し、不一致を`status: "stale_context"`、`trusted:false`として市場読取り・時間足切替・評価・記録へ進めない
- **移行**: 旧`in_0`〜`in_13`のIDを維持したまま4入力を末尾追加。旧14入力版の`ensure_analysis_overlay`プレビューは`contextBindingRequired:true`と警告を返し、`confirm:true`後だけ旧分析を現在の検証済みsymbol/timeframeへ拘束する。追加・18入力移行・settle・読み戻し・配置版確認が成功してから旧Studyを削除し、失敗時は従来どおり新規側をロールバックする
- **検証**: EURUSDに拘束された分析をUSDJPYチャートでstatus確認・事後評価する公開MCPテストを追加し、いずれも市場データを読まずfail-closedになることを固定。`4H`と`240`は同一時間足として受理し、snapshot ID・strategy versionはジャーナルの定義hashへ含める
- **実機検証(2026-07-20)**: 監査済みテンプレートをTradingView Pine保存版`3.0`としてコンパイル警告なしで非破壊保存し、USDJPY 4Hへ新版Studyを追加。18入力の読み戻し、再計算settle、描画数、ジャーナル記録を確認してから旧`2.0` Studyだけを削除した。USDJPYでは`ready`/`trusted:true`、一時的にEURUSDへ切り替えるとstatusは`stale_context`/`trusted:false`、事後評価は`not_evaluable`となり、OHLC取得・評価時間足切替へ進まないことを確認後、USDJPY 4Hへ復元した

### #22 分析案の事前検証(`validate_trade_plan`) ✅ 完了(2026-07-20)

- **課題**: `apply_analysis_overlay`にも入力契約検証はあるが、重要イベント、データ鮮度、現在価格による水準通過、コスト控除後RRなど、反映可否に必要な判断が複数ツールとAI推論へ分散している
- **実装**: チャートを書き換えない純粋な検証ツールを追加。既存オーバーレイ契約を再利用してbiasとConfirmation/Invalidation/Stop/Targetsの方向整合、Target単調性、分析時刻・期限を検証し、契約違反もMCPエラーではなく構造化された`blocked`へ変換する
- **鮮度と水準**: 必須の`current_price`と`market_observed_at`を受け取り、既定60秒を超えた証拠、未来時刻、観測時点ですでにConfirmation/Invalidation/Stopへ到達済みの案を拒否する。Entry通過後かつConfirmation前は履歴上の通過を推測せず`warning`に留める
- **コストとイベント**: `estimated_round_trip_cost_price`を銘柄価格単位の往復コストとして、Target 1の純報酬から控除しStopリスクへ加算したnet RRを算出する。重要度閾値と前後の停止分数を指定できるイベント配列を検査し、該当時間内は`event_blackout_active`で拒否する
- **出力と安全境界**: `status: "valid" | "warning" | "blocked"`、個別コード・修正候補付き`issues`、gross/net RR、使用証拠と計算前提を返す。渡された証拠を現在値で補完せず、TradingView、Pine、アラート、注文、ジャーナルへアクセスも書き込みもしない
- **検証**: 公開MCP経路で正常案、bearishのStop方向違反、非単調Target、期限切れ、stale証拠、重要指標停止時間、Confirmation通過、コスト控除後RR不足、Entry通過warningを固定。ツール総数を41として完全一致テストへ追加した

### #23 トレード判断コンテキスト統合(`get_trade_decision_context`) ✅ 完了(2026-07-20)

- **課題**: 1回の分析に`get_market_snapshot`、`get_key_levels`、`get_positioning_context`、`get_real_yield_context`、執行コスト関連を個別呼び出しし、取得時刻と欠落状態をAI側で突合する必要がある
- **実装**: 既存`get_market_snapshot`の生成処理を再利用可能な`marketSnapshot.ts`へ抽出し、従来レスポンスを維持したまま統合ツールの基盤にした。対象チャートのsymbol/timeframeを拘束し、確定足と形成中足、キーレベル、元市場スナップショット、COT、米実質金利、bid/askを同じUUID `snapshot_id`へ束ねる
- **証拠契約**: 各証拠へ`required`、`status`、`source`、`observed_at`、`source_at`、`freshness`、元`data`を付与する。COTと実質金利は既定で取得するが任意証拠とし、`require_positioning`/`require_real_yield`指定時だけ取得失敗を`blocked`に昇格する。キーレベル失敗は推測で補わず`partial`とする
- **品質ゲート**: 全体完全性は`complete | partial | blocked`、判断ゲートは`trade_ready | wait | blocked`へ分離する。チャート不在・symbol/timeframe不一致・OHLC欠落・必須ソース失敗は`blocked`、設定した重要イベント停止時間と執行証拠不足は`wait`にする。`directional_recommendation`は常に`null`で、方向予測はAI側に残す
- **執行境界**: 初期実装ではscannerのbid/askが揃っても市場側timestampがないため`execution.status: partial`かつ`decision_status: wait`としていた。#24完了後は同一`snapshot_id`の執行スナップショットがリクエスト後のstreaming quote更新を確認した場合だけ`execution.status: available`となり、他の必須ゲートも満たす場合に`trade_ready`へ進める
- **検証**: 公開MCP経路で全証拠の統合と`snapshot_id`共有、チャート取り違え時のOHLC非取得、重要イベント停止、必須COT失敗、chart context失敗時の他証拠保持を固定。#24接続後はライブ更新確認による`trade_ready`も固定し、ツール総数を43として完全一致テストへ追加した

### #24 ライブ執行条件スナップショット(`get_execution_snapshot`) ✅ 完了(2026-07-20)

- **課題**: `compute_round_trip_cost`はbid/askを呼び出し側が渡すため、実際のspread、取得時刻、取引セッション、価格刻みが欠けたままでも計算できる
- **調査結果**: TradingView公式Charting Libraryの[quote契約](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Charting_Library.DatafeedQuoteValues/)は`bid`/`ask`/`spread`を定義する一方、通常quoteの更新時刻は定義せず、`rtc_time`はpre/post-market価格用である。[symbol契約](https://www.tradingview.com/charting-library-docs/latest/api/interfaces/Datafeed.LibrarySymbolInfo/)と[session仕様](https://www.tradingview.com/charting-library-docs/latest/connecting_data/Trading-Sessions/)では`data_status`/`delay`/`session`/`timezone`を別管理する。実際のscannerはOANDA FX/CFDで`bid`、`ask`、`update_mode=streaming`、価格刻みを返したが`lp_time`/`rtc_time`/`session`はnull、NASDAQ株では`delayed_streaming_900`かつbid/ask欠落だった。一方、開いているチャートのmain series quoteには`lp_time`、`current_session`、`hub_rt_loaded`、`trade_loaded`、session、bid/askが同居することを実機確認した
- **実装**: 開いているチャートのquoteを優先し、spread、mid、pip/tick、instrument、配信モードを正規化する`get_execution_snapshot`を追加。chart quoteは`lp_time`が既定5秒以内、streaming、active session、realtime loadedの全条件でのみ`ready`/`market_state: active`とする。チャート未配置銘柄はscannerへフォールバックし、リクエスト開始後のbid/ask変化を観測できた場合だけreadyとする。`ask < bid`は`blocked`、欠落・未知モード・delayed/end-of-day・stale・更新未観測は`wait`または`unavailable`とし、scanner受信時刻をsource timeへ昇格しない
- **統合**: `get_trade_decision_context`へ同じUUIDを使う執行スナップショットを接続。重要イベント、チャート拘束、必須ソースに問題がなく、執行スナップショットがreadyの場合だけ`decision_status: trade_ready`へ進む。チャート終値をbid/askへ代用せず、執行取得失敗も生エラーではなく構造化された品質問題へ畳む
- **制約**: chartの`lp_time`は同じquote snapshot内のlast-price時刻であり、bid/ask個別のexchange timestampではない。active session・realtime loaded・streamingとの複合ゲートで利用するが、exchange sequencing、流動性、約定を証明するものではない
- **検証**: ready、価格静止、900秒遅延、crossed quote、symbol欠落、公開MCP経路、統合コンテキストの`trade_ready`を固定。全245テストとTypeScriptビルドが成功し、ツール総数は43。実機ではUSDJPY/XAUUSDがsource時刻2秒以内・active・streaming・realtime loadedで`ready`、USDJPY 4H統合コンテキストが`trade_ready`となることを確認した

### #25 リスク数量計算(`compute_position_size`) ✅ 完了(2026-07-20)

- **課題**: 分析水準とRRは出せるが、許容損失から数量へ変換する標準計算がなく、銘柄ごとのpip価値・換算通貨・コストをAIが都度計算する必要がある
- **調査結果**: OANDAの[損益計算式](https://help.oanda.com/us/en/faqs/account-statement.htm)は価格差×position units×quote-to-home換算率を用い、[FXのunits仕様](https://help.oanda.com/uk/en/faqs/micro-lots.htm)は1 unitをbase currency 1単位とする。一方、[最小取引数量](https://help.oanda.com/ca/en/faqs/minimum-trade-size.htm)は商品・口座環境で異なり、v20 APIも[`tradeUnitsPrecision`と`minimumTradeSize`](https://developer.oanda.com/rest-live-v20/primitives-df/)をinstrument属性として持つ。このためlotや最小値をMCP内で普遍値として決めず、数量刻み・最小/最大数量・contract multiplierを呼び出し側の明示証拠とする
- **実装**: 呼び出し時だけ与えられる口座通貨、評価額、許容リスク率または金額、Entry、Stop、数量刻み、往復コストから、Stop値幅とコストを含む推定損失が許容額を超えないinstrument unit数量を必ず切り下げる。必要に応じて最大数量でcapし、Stop到達時損失、実効リスク率、未使用リスク予算を返す
- **換算契約**: quote通貨と口座通貨が異なる場合は、`quote_to_account_rate`を「quote通貨1単位あたりの口座通貨」と定義し、使用symbol・観測時刻・最大鮮度を必須にする。欠落、期限切れ、未来時刻、未知quote通貨では数量をnullにして`blocked`とする
- **安全性**: 口座番号、ブローカー認証情報、APIキーを受け取らず、入力値を永続化しない。計算結果は注文量の参考値であり、発注には接続しない
- **検証**: JPY建て口座のUSDJPY、EURUSD、XAUUSD、換算レート欠落/期限切れ/未来時刻、ゼロStop幅、最小数量未満、最大数量cap、公開MCP経路を固定。全252テストとTypeScriptビルドが成功し、ツール総数は44。ビルド済みMCPへのEURUSD呼び出しで19,237 units、コスト込み推定損失9,999.546496 JPYがリスク予算10,000 JPY以内となることを確認した

### #26 分析監視アラート(`create_analysis_alerts`) ✅ 実装完了(実作成確認待ち)

- **課題**: `list_alerts`は読み取り専用で、Confirmation、Invalidation、Target、期限の監視設定が手作業になる。分析後に画面を離れると、PDCAの観測開始が遅れる
- **調査**: TradingView公式ヘルプで価格アラートのcrossing up/down、Only once、Expiration timerの意味を確認した。ログイン済みアプリの現行bundleと実アラート応答を読み取り調査し、`POST /create_alert`のpayloadと`GET /list_alerts`のcondition表現を特定した。公開API契約ではないため、変更時は読み戻し失敗として停止する
- **実装**: 所有する固定Pine、単一配置、配置版ソース、18入力、`analysisId`、symbol/timeframe、期限、現在価格を照合する。Confirmation未到達時、Invalidation、Target 1を方向別crossingへ変換し、`confirm:true`の前はpreviewのみ、確認後は不足分だけ直列作成する。作成後はactive、所有名、symbol、timeframe、演算子、価格、期限を再取得して完全一致を必須とする
- **冪等性とジャーナル**: `analysisId`のSHA-256短縮値を含む所有名で既存アラートを照合する。同名で定義が違う、停止済み、重複している場合は上書き・再開せず`blocked`とする。ConfirmationだけがなくTerminal監視が既存の場合も、到達済み省略か手動削除かを推測せず停止する。検証済みalert ID集合は分析定義hashへ拘束してJSONLへ追記し、同一集合だけを冪等再利用する
- **安全性**: Webhook、email、SMS、ブローカー、注文、Pine strategyへ接続せず、既存アラートを変更・再開・削除しない。期限は分析期限へ固定する。通知本文へ元の`analysisId`を含めず、部分失敗時は作成済み候補を削除せず一覧化して手動確認を促す
- **制約**: 価格アラートは作成後のcrossingだけを監視し、作成前の接触順序を証明しない。現在価格がTerminal側なら作成を拒否し、Confirmation側ならConfirmationだけを省略する。期限そのものを独立した価格アラートにはせず、TradingViewのexpirationとして適用する
- **検証**: dry-run、方向変換、所有名、既存完全一致、定義衝突、曖昧なConfirmation欠落、作成payload、Webhook等の無効化、読み戻し、ジャーナル冪等性、MCP公開経路をユニットテストで固定した。全260テストとTypeScriptビルドが成功。実機では期限切れUSDJPY分析が`analysis_not_alertable`で停止することを確認した。実アラートを作る`confirm:true`はユーザー承認をまだ受けていないため未実施

### #27 ジャーナル分析の一括事後評価(`evaluate_due_analyses`) ✅ 完了

- **課題**: 現在の事後評価は配置中オーバーレイと対象チャートに依存し、過去・期限到来・ongoing分析を銘柄ごとに手動で再配置または切替する必要がある
- **対象選定**: 最大500件のジャーナル定義からneutralと終端`complete`を除外し、期限到来未評価と最新状態がongoing/incomplete/ambiguous等の非終端分析を期限順に選ぶ。未評価の有効分析は`include_active:true`時だけ含める。取得上限到達は`journalScanTruncated`へ明示する
- **dry-run**: `confirm:true`なしではジャーナルとチャート状態を読むだけで、対象、最新評価、分析時間足と証拠時間足、symbol/timeframe変更要否、永続的な履歴追加の有無をpreviewする
- **実行と復元**: 指定`chart_index`だけを分析symbolと共通指定または分析ごとの証拠時間足へ切り替え、OHLCVのsymbol/timeframe/バー有無を再検証して既存first-hit evaluatorへ渡す。各分析の後に元symbol/timeframeへ戻して完全一致を確認する。個別の切替・取得・評価・記録失敗は結果へ隔離して次へ進み、復元失敗時だけ残件を中止する
- **履歴と記録**: 既定ではロード済み最大1000本だけを使い、履歴不足を推測で補わない。`load_more_bars`を明示した場合だけ履歴を追加し、これはアンロードできない永続的データロードとしてpreviewへ表示する。評価は元のjournal definition hashへ直接拘束して追記し、同じstatus/outcome/timeframe/evidenceThroughは冪等になる
- **月足**: 証拠時間足が暦月`M`の場合は既存評価契約どおり30日近似せず`calendar_month_resolution_unsupported`を記録する。短い`evaluation_timeframe`を指定すれば分析時間足が月足でも別解像度で評価できる
- **検証**: 複数symbolの逐次切替・毎回復元、履歴不足、暦月、個別取得失敗後の継続、復元失敗時の中止、冪等再実行、dry-run、対象選定、非アクティブチャート用`setSymbol(chartIndex)`を固定した。全266テストとTypeScriptビルドが成功。実機dry-runでは4分析中、終端済み2件を除外し、USDJPYの非終端1件と期限到来未評価1件を15分足評価候補として抽出し、チャート無変更を確認した

### #28 事後評価指標の拡張(`get_analysis_performance`) ✅ 完了

- **課題**: 現在の較正はTarget 1先着を1、Stop先着を0とするBrier score中心で、分析中の最大有利変動(MFE)、最大不利変動(MAE)、到達時間、R倍数、コスト控除後成績が分からない
- **保存指標**: 単独評価と#27一括評価の双方で、Entry帯midpointを幾何学的な参照値、midpoint-to-Stopを1Rとして、MFE/MAE、gross realized R、分析→Entry、Entry→Confirmation、Activation→Terminal時間を評価結果へ保存する。OHLC原本はジャーナルへ複製しない。算出契約を`methodologyVersion: "1.0"`へ固定し、異なる版を同じ集計へ混在させない
- **足内順序への対処**: Entry/Confirmationが起きたactivation足とTerminal足のHigh/Lowは、その足内でイベント前後を分離できないためexcursionから除外する。Terminal価格だけを一点として追加し、その間に完全に挟まる確定足だけからMFE/MAEを計算する。これにより過大評価を抑えるが、activation/terminal足内の真のexcursionは計測しない
- **Rの意味**: `grossRealizedR`はTargetまたはStop水準とEntry midpointの幾何学的距離であり、約定、滑り、部分利確、ギャップ損失、口座収益率ではない。`netRealizedR`は呼び出し時に銘柄別`total_price_per_unit`が明示された場合だけ、gross Rからcost/structural riskを控除する。コスト欠落を0とみなさない
- **集計**: 最新の単調評価をsymbol、bias、timeframe、strategy versionまたはoverallで集計する。勝敗はTarget 1先着/Stop先着だけ、実現Rは経路指標付きterminalだけ、MFE/MAEはactivation済み経路だけ、各時間指標は時刻が存在する行だけを母集団にし、件数と除外理由を並記する
- **後方互換性**: #28以前の評価には経路指標がないため`path_metrics_unavailable`として除外する。過去OHLCを現在ロードして暗黙補完しない。明示再評価でstatus/outcome/timeframe/evidenceThroughが同一でも、旧イベントにpath metricsがなく新結果にある場合だけ一度の拡充追記を許し、以後は冪等にする
- **分離境界**: 対象はライブ分析ジャーナルだけで、Strategy Testerやwalk-forwardのバックテストを混在させない。価格Rを金額、lot、口座収益率へ変換しない。イベント近接度は過去定義に固定証拠がないため今回の集計軸から除外した
- **検証**: bullish経路のactivation/terminal足除外、Target点追加、gross R、MFE/MAE、到達時間、旧レコード欠落、同一証拠への一度限りのmetrics拡充、非二値除外、銘柄別net cost、strategy version分離、重複コスト拒否、MCPのチャート非アクセスを固定した。全272テストとTypeScriptビルドが成功。実機の既存4分析は評価あり3件・二値0件・path metrics付き0件として、欠落をゼロ埋めせず明示した

### #29 チャート指定操作の一般化 ✅ 完了

- **課題**: `set_symbol`と`set_timeframe`はアクティブチャート依存で、マルチチャートレイアウトでは意図しないペインを変更する可能性がある。事後評価だけが`chart_index`指定の一時切替・復元を独自実装している
- **実装**: 両ツールへ任意の`chart_index`を追加し、省略時だけアクティブチャートを選ぶ。共通`chartTransaction`が対象ペインのsymbol/timeframeを不変スナップショットとして保持し、symbol、timeframeの順で変更、各段階のchart context読み戻し、最終一致確認、失敗時ロールバックを行う。元エラーとロールバックエラーが重なった場合も両方を保持する
- **共通化**: #27 `evaluate_due_analyses`の分析ごとのsymbol/timeframe切替・復元を同じヘルパーへ移行した。各候補の開始前にバッチ開始時の状態を再照合するため、TradingView UIや別プロセスによる途中変更を新しい正常状態として採用しない
- **検証**: 非アクティブなペイン1だけの変更、ペイン0不変、部分変更失敗からの復元、一時処理失敗後の復元、復元失敗の構造化、負の`chart_index`拒否、公開MCPツールからのindex転送を固定した。全275テストとTypeScriptビルドが成功。実機ではペイン1の現在値`OANDA:XAUUSD/240`を両ツールへ明示指定し、`changed:false`、操作列空、ペイン0の`OANDA:USDJPY/240`を含む全状態不変を確認した

### 推奨実装順

1. **#21** 文脈取り違えをfail-closedにする
2. **#22** 分析案の品質ゲートを反映前に独立させる
3. **#23** 分析証拠を同一取得ウィンドウへ統合する
4. **#24・#25** 執行条件とリスク数量を明示する
5. **#29** マルチチャート操作の共通基盤を整える(完了)

## 構想: 為替全体の環境認識(2026-07-09、実際の為替分析で判明)

「為替の動向を分析して」という広い依頼に対し、`get_mtf_overview` がシンボル単数のみ対応のため USDJPY・GBPAUD を別々に2回呼び、EURUSD/GBPUSD/AUDUSD のMTFは省略せざるを得なかった。`get_quotes` は既に複数シンボル対応なのに非対称。

### #14 `get_mtf_overview` の複数シンボル対応(優先度: 中〜高)✅ 完了

- **課題**: 上記のとおり。主要通貨ペアを横断してMTFで環境認識する、という自然な使い方が1コールで完結しない
- **実装(2026-07-09)**: `symbol: string` → `symbols: string[]`(`get_quotes` と同じ `TICKER_PATTERN`、上限20件 `MAX_MTF_SYMBOLS`)。スキャナーAPIの1リクエストで全シンボルの行を取得し `MtfOverview[]` を返す。**スキャナーAPIの行順はリクエスト順と一致する保証がない**ため、`symbol → row` のMapを作ってリクエスト順に並べ直す設計に(実機でも確認: 逆順応答でもリクエスト順を維持することをユニットテストで固定)。一部シンボルに該当行が無い場合は該当ティッカーを明示してエラー(部分的な無言欠落を許さない)
- **規模**: 小〜中。テスト: ユニット97件・統合28件(実機で4銘柄一括取得+無効ティッカーのエラーメッセージを確認)

### #15 `get_indicator_values` のOHLCミラープロット除外(優先度: 低〜中)✅ 完了

- **課題**: `plotcandle()` で色付きローソクを描くインジケーター(BushidoScalp等)は、内部的にOHLC値を複製したプロット(`plot_0`〜`plot_3`、type: `ohlc_open`/`ohlc_high`/`ohlc_low`/`ohlc_close`)を持つ。これは `get_ohlcv` と完全に同じ情報でありノイズにしかならないが、現行のノイズフィルタ(`colorer`/`alertcondition`/`textcolor` type のみ対象)は素通ししてしまう
- **実装(2026-07-09)**: `isNoisePlot` の対象に `/^ohlc_/` type を追加。`include_all_plots: true` で従来どおり全プロットを見られる点は維持(実機でBushidoScalpの `plot_0`〜`plot_3` がデフォルトで消え、`includeAllPlots:true` で復活することを確認)
- **規模**: 小。テスト: ユニット96件・統合28件

## 運用メモ

- **MCP サーバーはビルド更新後に再接続が必要**: サーバープロセスは起動時の `build/` を使い続けるため、新ツールはセッション再接続まで見えない(実分析時に `get_indicator_graphics` が未露出で直接実行により回避)。README に記載する
- **ストラテジーテスターAPIは遅延初期化**(2026-07-16実機で発見): TradingViewアプリ再起動直後は `TradingViewApi.backtestingStrategyApi` が存在せず、settle検知でこれを無条件に呼んでいた `set_indicator_input` 系の全書き込みが失敗していた(書き込み前に失敗するためチャートは無傷)。ガードを追加し、API不在時はプレーンインジケーターと同じ `isLoading` のみのsettle判定へフォールバック。`get_strategy_report` / `run_backtest` はAPI不在時に明確なエラーを返す
