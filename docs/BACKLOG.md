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
- ✅ **#8 リプレイ/バックテスト連携** — `run_backtest`/`get_strategy_report`に加え、状態確認、confirm付き開始、有限ステップ、confirm付き終了を実装。Replay Tradingとautoplayは非公開。リプレイ中の`get_trade_decision_context`は過去チャートとリアルタイム執行証拠の混在を防いでfail closed
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
- ✅ **#30 CI品質・依存脆弱性ゲート** — GitHub Actionsでサポート中のNode 22/24をテストし、high以上の`npm audit`検出を拒否。ActionsはコミットSHA固定、権限はcontents read限定

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

### #7 アラート作成(書き込み系・確認フロー前提) ✅ #26で限定実装

- **課題**: 分析の自然な帰結が「このレベルにアラートを張る」だが、書き込み系は方針として非公開
- **実装**: #26 `create_analysis_alerts`として、監査済み分析オーバーレイ由来のConfirmation/Invalidation/Target 1だけを対象に、`confirm:true`、dry-run、作成後readback、所有名、冪等性を実装した。汎用アラート作成、変更、再開、削除、Webhookは引き続き非公開

### #8 リプレイ/バックテスト連携 ✅ 完了

- **課題**: 波動カウント等の分析を過去時点で検証する手段がない
- **実装(2026-07-08)**: `run_backtest` + `get_strategy_report`。`createStudy({type:'pine', pineId, version:'last'})` で一時適用し、`backtestingStrategyApi` のレポートを整形して返す(削除後の残留レポートを誤って返さないゲート付き)。詳細は [phase6-findings.md](phase6-findings.md)
- **リプレイ実装(2026-07-20)**: `get_replay_status`、`start_chart_replay`、`step_chart_replay`、`stop_chart_replay`を追加。開始は過去ISO日時、active chartの期待symbol/timeframe、利用可能状態、`confirm:true`を要求する。ステップはautoplay停止中だけ1〜100本を許可し、各ステップ後の時刻前進を検証する。終了もdry-run/confirmと停止後readbackを行う
- **失敗と競合**: 開始途中の`selectDate`失敗またはタイムアウトでは`stopReplay`を試み、元エラーとcleanupエラーを両方保持する。意思決定スナップショットはチャート証拠の取得前後でreplay状態を二重確認し、途中でreplayが始まった場合は取得済みOHLC/キーレベルを破棄する
- **公式仕様との整合**: [TradingView Bar Replay](https://www.tradingview.com/support/solutions/43000712747-bar-replay-how-and-why-to-test-a-strategy-in-the-past/)は過去バーの手動Forwardとリアルタイム復帰を提供する一方、server-side alerts、orders、trading panel/quote listはリプレイ中もリアルタイムと説明している。このため`get_trade_decision_context`はリプレイtoolbarまたはsession稼働中にチャートOHLC/キーレベルを取得せず、`chart_replay_active`でblockedにする
- **非公開境界**: 実機`replayApi`で`buy`/`sell`/`closePosition`、autoplay、random/first date、replay resolution変更も確認したが公開しない。Replay Tradingは[通常のPaper Tradingとは別の過去データ取引モード](https://www.tradingview.com/support/solutions/43000691889-learn-to-trade-on-historical-data/)であり、本MCPの分析支援・非注文境界から外す
- **検証**: 状態WatchedValue正規化、日時・文脈・ステップ境界、入力文字列のJSON化、注文系API非生成、dry-run、confirm、開始失敗cleanup、途中replay開始時の証拠破棄を固定した。全284テストとTypeScriptビルドが成功。実機read-only statusと開始/終了dry-runでは`OANDA:USDJPY/240`、replay非稼働、チャート無変更を確認した

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

### #26 分析監視アラート(`create_analysis_alerts`) ✅ 完了

- **課題**: `list_alerts`は読み取り専用で、Confirmation、Invalidation、Target、期限の監視設定が手作業になる。分析後に画面を離れると、PDCAの観測開始が遅れる
- **調査**: TradingView公式ヘルプで価格アラートのcrossing up/down、Only once、Expiration timerの意味を確認した。ログイン済みアプリの現行bundleと実アラート応答を読み取り調査し、`POST /create_alert`のpayloadと`GET /list_alerts`のcondition表現を特定した。公開API契約ではないため、変更時は読み戻し失敗として停止する
- **実装**: 所有する固定Pine、単一配置、配置版ソース、18入力、`analysisId`、symbol/timeframe、期限、現在価格を照合する。Confirmation未到達時、Invalidation、Target 1を方向別crossingへ変換し、`confirm:true`の前はpreviewのみ、確認後は不足分だけ直列作成する。作成後はactive、所有名、symbol、timeframe、演算子、価格、期限を再取得して完全一致を必須とする
- **冪等性とジャーナル**: `analysisId`のSHA-256短縮値を含む所有名で既存アラートを照合する。同名で定義が違う、停止済み、重複している場合は上書き・再開せず`blocked`とする。ConfirmationだけがなくTerminal監視が既存の場合も、到達済み省略か手動削除かを推測せず停止する。検証済みalert ID集合は分析定義hashへ拘束してJSONLへ追記し、同一集合だけを冪等再利用する
- **安全性**: Webhook、email、SMS、ブローカー、注文、Pine strategyへ接続せず、既存アラートを変更・再開・削除しない。期限は分析期限へ固定する。通知本文へ元の`analysisId`を含めず、部分失敗時は作成済み候補を削除せず一覧化して手動確認を促す
- **制約**: 価格アラートは作成後のcrossingだけを監視し、作成前の接触順序を証明しない。現在価格がTerminal側なら作成を拒否し、Confirmation側ならConfirmationだけを省略する。期限そのものを独立した価格アラートにはせず、TradingViewのexpirationとして適用する
- **検証**: dry-run、方向変換、所有名、既存完全一致、定義衝突、到達済みConfirmation省略、作成エラー時のpartial報告、作成payload、Webhook等の無効化、読み戻し、ジャーナル冪等性、MCP公開経路をユニットテストで固定した。さらに`test/e2e/analysis-alerts.test.mjs`（E2E）および`test/smoke.mjs`（CDP統合スモークテスト）を追加し、実機環境での動作検証経路を確立した。全413テストとTypeScriptビルドが成功。コードレビュー（サブエージェント）により7基準での安全性・正確性を検証した。

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

### #30 CI品質・依存脆弱性ゲート ✅ 完了

- **課題**: テストと`npm audit`がローカル手順だけで、Pull Requestやpush時に実行を強制できない。加えて`engines: >=20`は2026-03-24にEOLとなったNode 20を許容していた
- **実装**: `.github/workflows/ci.yml`を追加し、push/PRでNode 22・24の`npm ci --ignore-scripts`と`npm test`を実行する。依存監査はNode 24の独立ジョブで`npm audit --audit-level=high`を実行し、high/criticalをゲートする。Node要件を`>=22`へ更新し、ローカル`nodenv`用`.node-version`を検証済み24.18.0へ固定した
- **サプライチェーン境界**: workflow権限を`contents: read`だけにし、`actions/checkout`と`actions/setup-node`はv6タグの取得時コミットSHAへ固定する。依存インストールscriptはCIテストで無効化し、lockfileとnpm cache keyを利用する。auditはlockfileをregistry advisoryへ照合するためネットワーク障害時も成功扱いにしない
- **Node選定**: Node公式の2026-07-20時点の一覧で22/24がLTS、20がEOL、26がCurrentのため、最低サポートと最新LTSを22/24で固定した。Current 26は必須ゲートにせず、LTS化後に追加を再評価する
- **検証**: Node 24.18.0で`npm ci --ignore-scripts`と全284テストが成功し、`npm audit --audit-level=high`は0 vulnerabilities、workflow YAMLの構文検証も成功した。Node 22を含むGitHub Actions実runはworkflowのcommit/push後に確認する

## 構想: AIによる新手法研究基盤(2026-07-20)

現行MCPは、ライブ環境認識、仮説のチャート反映、監視、事後評価、単発バックテストまでを一連のPDCAとして実行できる。一方、新しい売買手法を発見するには、集計成績だけで候補を選ぶのではなく、全取引から効いた理由を診断し、同一条件で比較し、未使用期間・他銘柄・コスト悪化・パラメータ近傍で反証する研究基盤が必要になる。

### 設計原則

- **役割分離**: AIは仮説、特徴量候補、ルール案、結果の解釈を担当する。MCPはデータ取得、実験条件固定、決定論的計算、TradingView操作、証拠保存を担当し、ブラックボックスな「最適戦略」を返さない
- **事前固定**: 評価期間、主要評価指標、最低取引数、コスト、候補数、棄却条件を実験開始前に固定する。OOSを確認後に変更したルールは同じ実験の続きではなく、新しい仮説・実験として扱う
- **Point-in-time**: 確定足だけを使い、形成中足、リペイント、未来参照、後日改訂マクロ値を混入させない。symbol、timeframe、期間、タイムゾーン、データ源、取得時刻、Pine ID/版、入力、コスト、methodology versionを記録する
- **再現性**: 実験定義と結果をcanonical JSON化してhashを付ける。乱数を使う頑健性検証はseedを必須にし、同一入力は同一結果になるようにする
- **母集団分離**: Strategy Tester、Bar Replay、ライブ分析ジャーナルを別の証拠母集団として保持し、成績を暗黙に合算しない。既存`get_analysis_performance`はライブ分析専用のままとする
- **安全境界**: 注文、口座、認証情報へ接続しない。チャート変更を伴うバッチ処理はdry-run、明示確認、ジョブ上限、直列実行、各ジョブ後の復元検証を必須とし、復元失敗時は残件を停止する
- **採用基準**: in-sample最良値だけで採用しない。OOS/walk-forward、現実的な往復コスト、最低取引数、パラメータ近傍、複数銘柄または複数期間での安定性を確認する

### #31 Strategy Tester全取引台帳(`get_strategy_trade_ledger`) ✅ 実装・実機検証完了

- **課題**: 現在の`get_strategy_report`/`run_backtest`は直近最大500取引と集計値を返すため、古い取引を含む損失原因、時間帯依存、Exit理由、裾野リスクを完全には診断できない
- **案**: Strategy Testerから利用可能な全取引をページングまたはbounded chunkで取得し、Entry/Exit時刻・価格、方向、数量、gross/net損益、手数料、保有時間、Exit ID/理由、利用可能ならrun-up/drawdownを正規化する。取得不能な項目を推測やゼロで補完しない
- **契約**: report ID、symbol/timeframe、テスト期間、Pine ID/版、入力、通貨・数量単位、取得件数と総件数、truncated理由を返す。MAE/MFEがTradingView原値として存在しない場合は、別ツールでOHLCと約定時刻を拘束して算出する
- **完了条件**: 集計値と台帳再集計の照合、500件超の扱い、open trade、同時刻複数約定、部分決済、欠落値、stale report拒否を実機とテストで固定する
- **実装**: アクティブStrategy Testerの`report.trades`全件を正規化し、`offset`/`limit`で最大500件ずつ返す。全正規化取引、symbol/timeframe、Pine ID/版、公開入力、期間、通貨、初期資本からSHA-256 `ledgerId`を作り、2ページ目以降の`expected_ledger_id`不一致をfail closedにする。Entry/Exit、方向、数量、損益、累積損益、保有時間に加え、TradingView原値が存在する場合だけcommission/run-up/drawdownを返し、全件欠落は`unavailableFields`へ明示する
- **品質境界**: Strategy Testerの配列順を保持し、サマリー件数不一致と時刻逆行を`qualityIssues`へ載せる。アクティブストラテジーをチャート上の単一studyへ帰属できない場合はPine/入力を推測せず品質問題にする。ソース本文等のhidden入力は返さない。チャート、Pine、注文、口座、ジャーナルを変更しない
- **未決済行の正規化(2026-07-21)**: 実機のTurtleで、TradingViewがライブポジションを現在値の仮exit付き末尾行として`report.trades`へ含める一方、`performance.all.totalTrades`は決済済み件数だけを返すことを確認した。件数差がちょうど1、末尾exit IDが空、という実機形状に限って末尾を`status:open`、`exit:null`へ正規化し、サマリー件数はclosed行数と照合する。その他の件数差は従来どおり`report_trade_count_mismatch`でfail closedにする
- **互換性対応**: 2026-07-20時点のTradingViewでは従来の`TradingViewApi.backtestingStrategyApi()`が削除され、active chart modelの`activeStrategySource().value().reportData()`へ移行していた。旧APIを優先しつつ、現行chart modelを同じWatchedValue契約へ適応するfallbackを追加した。現行`trades[]`の短縮field(`e`/`x`/`q`/`tp`/`cp`/`rn`/`dd`/`cm`)と従来のverbose fieldを両方正規化する。存在しないtrade numberは配列位置と混同せず`number:null`、順序識別用にzero-based `reportIndex`を返す
- **検証状況**: 模擬レポートで旧・現行API、verbose・短縮取引形式、ページ境界、SHA-256、再計算ID拒否、方向、保有時間、Pine版・入力、欠落項目、stale active strategy拒否を固定した。実機の`Bushido Smart Money Strategy`(`OANDA:USDJPY` 4H、Pine v2.0)で72/72取引、summary件数一致、欠落field・品質問題なしを確認。20件ずつの後続ページと70件目からの最終2件を同じ`expected_ledger_id`で取得し、index 0〜71の連続性と`nextOffset:null`を確認した。2026-07-21にはXAUUSD 1H Turtleでsummary 196件、raw 197行、末尾mark-to-market行、`openPL`を実機確認し、open正規化の回帰テストを追加した。再起動後のregime matrixではopen 1件、closed 196件、join 195件、coverage 99.49%、台帳品質問題なし、評価`complete`、PF 1.552を確認した。500件超と部分決済は該当する実レポート入手時の継続確認事項とする

### #32 ベースライン対候補実験(`run_strategy_experiment`) ✅ 実装・実機検証完了

- **目的**: ベースラインと候補を同一symbol/timeframe/期間/コスト条件で連続実行し、成績差を再現可能な1実験として返す
- **案**: 実行前に両Pine版、入力、対象チャート、評価指標、最低取引数を固定し、各runのreport IDと取引台帳hashを保存する。純利益だけでなくPF、DD、Sortino、取引数、期待値、保有時間、MAE/MFEの差を返す
- **安全性**: dry-runで実験計画とチャート変更を提示し、`confirm:true`後だけ実行する。候補失敗時もベースライン結果を保持し、元チャートのsymbol/timeframe/studiesを復元・照合する
- **判定**: 単一の総合スコアへ早期集約せず、主要指標、guardrail、母集団不足、悪化項目を分ける。優劣の最終解釈はAIへ残す
- **実装(2026-07-20)**: baseline/candidateに自作strategy `pine_id`と最大20件の入力overrideを指定し、実行前の`list_pine_scripts`から`last`を具体的な保存版へ解決する。active chartの期待symbol/timeframeを拘束し、既定dry-runでexperiment SHA-256、具体的Pine版、入力、最低取引数、予定操作を返す。`confirm:true`後だけ各variantを直列に一時追加し、入力settle後のreportと全取引ledgerを500件ずつ同一`ledgerId`で収集してから所有確認付きで削除する
- **比較契約**: net profit/率、PF、最大DD/率、Sharpe、Sortino、取引数、1取引期待値、平均保有時間、平均run-up/drawdown、worst trade drawdownをbaseline/candidate/deltaで返す。TradingView原値や取引証拠がない指標はnullのままとし、総合スコアや採用判定を生成しない。commission、slippage、capital、currency、quantity、margin、fill設定、期間を条件証拠として比較し、差があれば`conditions_differ`、最低取引数不足なら`insufficient_sample`にする
- **失敗・復元**: baseline失敗時はcandidateを実行せず、candidate失敗時はbaselineのledger IDと集計を保持する。成功指定の`keepOnChart`でもレポート取得失敗時は一時Studyを削除するよう既存`run_backtest`を強化した。各variant後と実験終了後に元symbol/timeframe/study集合を照合し、cleanupまたは復元失敗を構造化して比較対象外にする
- **検証状況**: dry-run非書き込み、具体的Pine版照合、入力settle、全台帳集約、指標差、コスト条件差、最低取引数、候補失敗時のbaseline保持、両variant cleanup、最終chart復元、揮発するstudy IDをledger hashから除外する回帰を固定した
- **実機検証(2026-07-20)**: `Bushido Smart Money Strategy` v2.0、`OANDA:USDJPY` 4Hで、baseline=`Require Next-Bar Confirmation:false`、candidate=`true`、最低30取引のA/Bを実行。experiment IDは`sha256:54cc5480...e712c2`、両variantは期間・commission・slippage・資本・数量・fill条件が一致し、品質問題なし、比較適格となった。baselineは72取引、純利益8,286.61 JPY、PF 1.459、期待値115.09、最大DD 5,844.26。candidateは88取引、純損失5,137.97 JPY、PF 0.811、期待値-58.39、最大DD 6,098.77となり、この単独変更は棄却相当の明確な悪化を示した。両一時Study削除後、元3 Study、symbol/timeframe、既存Strategy Testerのbaseline ledger ID(`sha256:ef338863...b5b17`)と`in_20:false`まで復元確認した。全290テストとTypeScriptビルドが成功
- **ロジック追跡と再検証(2026-07-20)**: v2の「Next-Bar Confirmation」は`pre_buy[1]`/`pre_sell[1]`による1本遅延だけで、次足の方向確認をしていなかった。遅延によりTP/SL基準、反転、signal distanceの状態系列が変わり、フィルターONで取引数が増える別戦略になっていた。次足終値がsignal足high/lowを方向別に突破する明示確認へ修正したPine v3.0を非破壊保存し、コンパイル成功・読み戻し一致を確認。v3 A/BではOFFが72取引/PF1.459/期待値115.09/最大DD5,844.26、ONが37取引/PF1.021/期待値6.41/最大DD3,234.76となった。取引抑制とDD改善は意図どおりだが優位性をほぼ失うためON案は棄却し、既存チャートはv2/OFFへ完全復元した。v3は棄却仮説の再現証拠として保存版に残す

### #33 制限付き一括バックテスト(`run_backtest_matrix`) ✅ 実装・実機検証完了

- **目的**: 複数symbol、timeframe、Pine版、明示パラメータ集合を同じ実験契約で比較し、銘柄固有の偶然と再現する構造を分ける
- **制限**: 任意の無制限グリッドは受けず、ジョブ数、パラメータ数、履歴期間、総実行時間に上限を置く。dry-runで展開後ジョブ数と推定チャート変更を返し、明示確認後に直列実行する
- **結果**: 成功だけでなく、計算不能、取引不足、timeout、履歴不足、復元失敗を行単位で残す。上位結果だけを返さず全候補の結果と除外理由を保存する
- **過剰適合対策**: matrix順位は探索結果であって採用判定ではない。未使用期間を同じmatrixの選定に使わず、#34へ渡す候補数を事前固定する
- **実装(2026-07-20)**: 1〜24件の明示jobとしてsymbol、timeframe、自作strategy `pine_id`、最大20入力を受ける。実行前に保存済みstrategyと具体的Pine版へ解決し、正規化したjob定義とmatrix全体へSHA-256 IDを付ける。完全重複jobと同一job内の重複input IDを拒否し、文字列入力は256文字に制限する
- **実行境界**: 既定dry-runで全job、版、入力、件数、直列実行、soft deadlineを提示し、`confirm:true`後だけ対象chartを一時的にsymbol/timeframe切替する。各jobで一時Study追加、入力settle、reportと全ledger取得、所有確認付き削除、元chart復元を完結させる。最大実行予算は30〜1800秒で、進行中jobを危険に中断せず、期限後は新しいjobを開始しない
- **結果契約**: `complete`、`insufficient_sample`、`failed`、`cleanup_failed`、`restore_failed`、`skipped`を全job分、入力順のまま返す。成功行だけのランキングや総合スコアを作らず、ledger ID、期間、指標、品質問題、失敗理由を保持する。通常の計算失敗は次jobへ隔離し、chart復元失敗時だけ残件を中止する
- **検証状況**: dry-run非書き込み、3市場・時間足の直列実行、入力override、全ledger集約、途中計算失敗後の継続、毎回復元、復元失敗後の残件skip、24job上限、runtime上限、公開ツール完全一致をユニットテストで固定した
- **実機検証(2026-07-20)**: Smart Money Strategy v3.0をUSDJPY/EURUSD/XAUUSDの4Hへ3jobで実行し、7.4秒で全件完走した。各jobは30取引以上、ledger ID取得、cleanup成功、job後復元成功となり、終了時のUSDJPY 4Hと元3 StudyのID・名前は開始時と完全一致した。USDJPYは72取引/PF1.459/期待値115.09、EURUSDはreport 64件に対しledger 65件で`report_trade_count_mismatch`、PF0.823/期待値-50.59、XAUUSDは56取引/PF1.348/期待値285.12だった
- **実機後修正**: EURUSDの行内品質警告を検出できた一方、matrix最上位の`qualityIssues`が空だったため、`jobsWithQualityIssues`件数と`one_or_more_jobs_have_quality_issues`を集約して返すよう修正した。実行完了と証拠品質を別概念として維持し、64対65の原因はTradingView report/ledger不一致として継続観測する

### #34 Pine Strategy walk-forward(`run_strategy_walk_forward`) ✅ 実装・実機検証完了

- **課題**: 既存walk-forward CLIは評価ログの予測ラベルをfold別集計するもので、Pine Strategy Testerを期間分割して再実行する機能ではない
- **案**: 時系列順のtrain/test fold、anchored/rolling方式、embargo、最低取引数を事前指定し、選定はtrainだけ、最終指標はtestだけから算出する。fold別結果を保持し、全期間を再最適化した見かけの成績をOOSとして扱わない
- **境界**: TradingViewが任意日付範囲をStrategy Testerへ確実に適用できるかを先に実機調査する。Pine側の期間入力を使う場合は、監査済み入力契約と読み戻し検証を必須にする
- **完了条件**: 将来隣接データのembargo、期間境界、fold失敗、候補tie、選定不能、全fold OOS集計、再実行再現性を固定する
- **期間指定調査(2026-07-20)**: TradingView公式では、任意日付範囲を直接指定できるのは[Deep Backtesting](https://www.tradingview.com/support/solutions/43000666199-what-is-deep-backtesting/)で、通常Strategy Reportと結果が異なる。さらに[Premium以上](https://www.tradingview.com/support/solutions/43000666265-how-deep-backtesting-works/)で、選択期間でもintraday履歴や最大200万barの制約がある。Pine側の期間filterも[公式FAQ](https://www.tradingview.com/pine-script-docs/faq/strategies)で案内されるが、既存strategyすべてへ専用input追加を要求し、期間境界でのposition処理がstrategy実装依存になる
- **採用方式**: #31の完全ledgerを一候補につき一度だけ同一chart条件で取得し、closed tradeのentry/exit時刻がともに明示窓内の取引だけをtrain/testへ分割する`ledger_partition_v1`を採用した。期間をTradingViewやPineへ書き込まず、開始・終了境界を跨ぐtrade、open trade、時刻欠落tradeを除外件数として保持する。ledgerのdate rangeが全foldを覆わない場合は「取引なし」と推測せず評価不能にする
- **実装(2026-07-20)**: 2〜8候補、2〜12fold、anchored/rolling、1〜100bar embargo、train/test最低取引数、train選定metric(`expectancy`/`netProfit`/`profitFactor`)を事前固定する。候補は具体的Pine版・正規化入力・SHA-256 IDへ解決し、既定dry-run後の`confirm:true`でだけ直列収集する。候補収集失敗、cleanup/復元失敗、ledger品質問題、期間未coverage、コスト・資本・数量・fill・期間条件差が一つでもあれば候補集合を縮めず停止する
- **リーク防止**: 各foldはtrainだけで最大metric候補を選び、完全同点は`selection_tie`として選ばない。レスポンスは全候補のtrain証拠を返すが、testは選択候補1件だけを計算・公開し、非選択候補のOOS指標を返さない。test窓は非重複かつ時系列順を要求し、anchoredはtrain開始固定、rollingはtrain開始前進を検証する
- **OOS指標**: ledger原値から取引数、期待値、純損益、PF、勝率、平均保有時間、平均run-up/drawdown、closed-trade累積損益の最大DDを再計算する。TradingViewのbar内equity DD、Sharpe、Sortinoを期間按分して捏造せず、`maxClosedTradeEquityDrawdown`を別名で返す。最低test取引数と品質を満たしたfoldだけを全fold OOSへ集約する
- **検証状況**: train-only選定、非選択OOS非公開、anchored/rolling境界、embargo不足、test重複、候補tie、最低取引数、ledger品質・期間coverage、公開MCPのdry-run、候補直列収集、条件比較、cleanup、chart fingerprint復元をユニットテストで固定した
- **実機検証(2026-07-21)**: USDJPY 4HのSmart Money v3.0で`Next-Bar Confirmation` OFF/ONを2候補、anchored 2fold、1bar embargo、train期待値選定として実行した。Strategy Testerのreport期間は2020年開始でも実tradeは2025-03-19以降だったため、当初の2023/2024 testは正しく0件・選定不能となった。実trade範囲内の2025-Q4/2026-Q1 testへ事前契約を組み直した再実行では、両ledger完全・条件一致・品質問題なし・cleanup/復元成功となった
- **実機結果**: 両foldともOFF候補をtrainだけで選択した。OOSは2025-Q4が14取引/期待値270.13/PF2.722、2026-Q1が12取引/期待値207.96/PF2.220、非重複2fold集計が26取引/期待値241.44/PF2.480/勝率61.54%/closed-trade DD989.52だった。これは最低件数をtrain 5/test 3へ下げた機能検証であり、採用判定には#35と、より多いfold・取引数が必要
- **実機後修正**: foldごとの全`reportIndex`配列は大規模ledgerで応答を増幅するため、集計内部だけに保持し公開レスポンスから除外した。選定不能foldがある`partial`結果は最上位にも`one_or_more_folds_not_evaluable`を返す

### #35 研究プロトコル検証・頑健性試験(`validate_research_protocol` / `stress_test_strategy`) ✅ 完了(2026-07-21)

- **事前検証**: IS/OOS重複、未来時刻、形成中足、監査未済みPine、リペイント要因、少なすぎる取引数、未指定コスト、多すぎる候補、OOS閲覧後の同一実験変更をblockedまたはwarningへ分類する
- **ストレス**: spread/slippage/commission増加、Entryの1本遅延、Stop/Targetの微小変動、主要パラメータ近傍、期間開始点の移動、取引順序のseed付きbootstrap/Monte Carloを個別シナリオとして実行する
- **判定**: 最良値ではなく、シナリオ分布、worst case、中央値、破綻率、元候補からの劣化率を返す。パラメータ近傍の一点だけが突出する場合は`unstable`とする
- **注意**: OHLCだけでは足内約定順序や真の滑りを再現できない。モデル化したストレスと実約定証拠を区別する
- **事前ゲート実装(2026-07-21)**: `validate_research_protocol`は具体的な保存済みPine ID/版を読み取り、静的ソース監査を同時実行する。1〜24個のSHA-256候補ID、IS/OOS窓、最低/観測取引数、spread/slippage/commission仮定、確定足限定、restart差分確認、定義凍結・最終変更・OOS初回閲覧時刻を一つのprotocol定義へ固定し、決定論的protocol IDを返す。IS/OOS重複、OOS同士の重複、未来窓、形成中足、8候補超、コスト欠落、最低件数未達、凍結後またはOOS閲覧後の変更をblockedとし、30件未満、4候補超、全コスト0、restart未確認、Pineのrepaint候補構文をwarningとする
- **台帳ストレス実装(2026-07-21)**: `stress_test_strategy`はprotocol ID、具体的Pine版、入力、評価窓を既定dry-runで固定し、confirm後にStrategyを一度だけ一時適用して完全ledgerを取得・削除・chart復元する。`additional_cost_per_trade`(report通貨)、既存trade commissionの倍率、開始点1〜100barずらし、100〜10,000回のseed固定bootstrapを台帳へ適用し、baseline、全シナリオ、相対劣化、中央値/min/max、純損益0以下の破綻率、bootstrap p05/median/p95/worstを返す。ledger不完全、件数不一致、品質問題、期間非coverage、最低件数未達はfail-closedとする
- **Strategy再実行ストレス(2026-07-21)**: 任意の約定効果を台帳やOHLCから再構成せず、最大8件の`rerun_scenarios`でPine input IDと値を明示してStrategy Testerをbaseline後に直列再実行する。baseline入力へoverrideを決定論的にマージし、入力readback一致、再計算settle、Pine版・symbol/timeframe、完全ledger、最低件数を検証する。各回の所有確認付き削除とchart fingerprint復元を必須とし、復元不能時は後続を停止する。Entry遅延、Stop/Target変動、parameter近傍は対応入力を持つStrategyだけで評価でき、MCPが意味や値を推測しない
- **再実行実機検証(2026-07-21)**: USDJPY 4H、Smart Money Strategy v3.0、2025-03-19〜2026-07-21、最低30取引で`in_20`(Next-Bar Confirmation)をfalseからtrueへ変更した。baselineは72取引/期待値115.09/純利益8,286.61/PF1.459/closed-trade DD5,654.33、再実行は37取引/期待値6.41/純利益237.24/PF1.021/DD2,820.32となり、期待値94.4%、純利益97.1%、PF30.0%の劣化を計算した。両ledgerは完全・件数一致・品質問題なしで、各一時Strategy削除と元2 Studyを含むchart fingerprint復元に成功した
- **モデル境界**: spread/slippageをpipsからreport通貨へ一般変換せず、追加コストは明示的な`report currency / trade`として扱う。commission欠落時は該当シナリオだけ`not_evaluable`にする。bootstrapは取引結果の再標本化であり、市場経路、自己相関、約定順序を再現しない。再実行入力がStrategy内で何を意味するかはPine sourceの契約であり、同じ入力名でも異なるStrategy間で同一効果とみなさない
- **検証状況**: protocolのready/blocked/warning、ID決定性、未来・重複・OOS閲覧後変更、コスト/件数、Pine監査、台帳stressの決定性、コスト劣化、commission欠落、品質・coverage拒否、seed再現性、MCP dry-run/一時適用/cleanup/chart fingerprint復元をユニットテストで固定した

### #36 条件付きイベントスタディ(`run_market_event_study`) ✅ 完了 (v2複合条件DSL・否定・シーケンス・確定足レジームフィルタ全機能検証済み)

- **目的**: いきなり売買ストラテジーを作らず、「条件発生後に優位性があるか」を将来リターン、MFE、MAE、到達時間で調べる
- **入力**: point-in-timeで計算可能な条件、観測時刻、複数horizon、方向、セッション、コスト仮定、重複イベントの扱いを明示する。条件式は許可された特徴量DSLまたは構造化JSONとし、任意コードを実行しない
- **出力**: 発生数、欠落数、平均/中央値/分位点、勝率、信頼区間、時系列fold別結果を返す。複数条件探索時は試行数を記録し、多重比較を無視したp値だけで採用しない
- **初版実装(2026-07-21)**: `run_market_event_study`はアクティブchartのexact symbol/timeframeを拘束し、Bar Replay中を拒否して最大5,000本のロード済み確定OHLCだけを読む。`session_auction`条件はIANA timezone、同一local day内のrange start/endとauction end、range coverage、1〜4本のacceptance closes、0〜4本のfailure windowを構造化入力とする。各平日は最初の上下境界touchだけを対象に、両側sweepはambiguousとして除外し、外側終値の連続をaccepted、内側復帰をfailedへ排他的に分類する
- **結果契約**: signal確定足closeを約定価格ではなくevent referenceとし、1〜8個・最大96本のhorizonごとに方向調整return、positive rate、MFE、MAE、事前bps targetの到達率/本数を集計する。週末・休場等で連続barを欠くhorizonは利用不能にし、半開区間の非重複foldを最大12件集計する。イベント明細は最大200件、集計は全件を使用し、形成中足、range不足、無touch、両側sweep、未分類を別件数で返す
- **推論区間と試行追跡(2026-07-21)**: methodology v2で、全体branch×horizonの方向調整return平均へ90/95/99%正規近似区間、positive率・target到達率へ同水準のWilson score区間を追加した。2観測未満の平均区間は捏造せず`insufficient_sample`、比率は0観測だけ利用不能とする。`configuration_trials`で今回までに閲覧した関連設定数を任意申告でき、未申告を`not_declared`として返す。設定済み主要interval出力数、系列依存補正なし、多重比較補正なしを明示し、p値・有意判定・自動採用は生成しない。foldは件数、方向調整returnの平均/中央値、positive率、target到達率だけに圧縮し、区間・MFE/MAE・到達本数を重複展開せず最大fold×horizonでの応答増幅を抑える
- **v2実機検証(2026-07-21)**: EURUSD 15分足の確定5,000本(2026-05-08〜07-21)、UTC 00:00〜08:00 range、12:00 auction end、1/4/8/16本horizon、2fold、申告12 trialsで43イベントを取得した。形成中1本を除外し、52 eligible日のうちrange coverage不足1日を補完せず`partial`へ残した。全体branch×horizonの48主要区間を生成し、accepted-up 4本returnは8件、平均-0.0030%、95%区間-0.0440%〜+0.0381%でゼロを跨いだ。fold圧縮前後でイベント・全体推論値は不変のまま応答を約89KBから52KBへ41%削減した。検証後はUSDJPY 4H、元2 Study、active paneを復元した
- **CPI Aftershock用の長期15分履歴(2026-07-30)**: 月次CPIの最低10イベントを評価するには、5,000本(約2か月)では母数が不足する。`run_market_event_study`の明示ロード上限を30,000本へ拡張したが、実機のTradingViewは10,441本(2026-03-02以降)で履歴供給が打ち止めだった。CPI 5回の固定v1契約ではno breakout 1、boundary内close 3、検出1で最低10件に届かなかった。この容量拡張だけでは十分な母集団を得られないことが確定した。
- **次優先: 長期15分FX履歴の取得・出所保存(優先度: 高)**: TradingViewのロード済み履歴を唯一の研究母集団にしない。EURUSDを先行対象に、長期15分OHLCの取得器を追加し、`source`、一次URL/API識別子、取得時刻、対象時間帯、タイムゾーン、バー本数、raw content SHA-256、正規化後hash、欠損/重複/非連続区間、配信改訂の版を追記専用で保存する。取得元の利用条件を明示し、無許可のスクレイピングや出所不明の再配布データは使わない。研究ツールは保存済みの指定source/versionだけを明示入力で読み、TradingViewへ暗黙にfallbackせず、価格の出所混在・未来バー・欠損補完を拒否する。初回の受入条件は、少なくとも4年分のEURUSD 15分確定バー、UTC単調性、全週末ギャップと平日異常gapの区別、同一入力から同一正規化hash、既存`event_aftershock_retest`と同じclosed-bar/MFE/MAE契約での再実行可能性とする。
- **次段階: CPI/NFP/FOMC個別の60分検証(前提: 長期履歴sourceの保存・検証完了後)**: CPI、NFP、FOMCを一つのイベント集合へ混ぜない。各イベント型を別`hypothesis_id`で事前登録し、EURUSD 60分・canonical発表時刻・initial range/breakout/retestの固定パラメータ・分岐別最低件数・主horizon・target・fold境界・configuration trialを結果閲覧前に凍結する。まず各型のin-sample検出率と品質を測定し、最低件数・95%区間・fold方向一貫性を満たした型だけに未使用期間OOSを割り当てる。3型の結果を後から合算して採否を決めず、比較表は記述的な二次出力に留める。
- **公式イベント取得・60分足契約の実装開始(2026-08-01)**: `collect:macro-events`はCPI/NFPをBLS公式アーカイブ、FOMCを年別Fed公式履歴ページから取得し、原典URL・生HTML SHA-256・取得時刻をイベント成果物へ保存する。`study:macro-events-m60`は1成果物に1種類だけを許可し、3種類を混在させない。CPI/NFPの8:30 ETはUTC毎時バーへ完全一致しないため、発表を含む60分バーを使わず、**発表後に始まる最初の完全なUTC1時間バー**から初期レンジを作る。これにより発表前30分をOHLCレンジへ混入させないが、測る対象は「初動30分後のaftershock」であり、即時反応ではない。いずれも改訂済みの外部履歴を用いる探索であり、前向き/OOS/主採否根拠に昇格させない。
- **60分イベント契約の補正・coverage証跡(2026-08-01)**: FOMCの14:00 ETはUTC毎時境界に一致するため、同じ`at_or_after`アンカーでもCPI/NFPは+30分、FOMCは0分となる。揃っていると誤認させないため、各結果に`release_to_anchor_delay_minutes`のmin/max/distinctを出し、これは種類間で同一測定ではないと明記する。BLS成果物は要求年・年別件数・coverage issueを保存し、完了済み年のCPI/NFPが12件未満、FOMCが8件未満なら評価器が拒否する。FOMCは年別履歴を各要求年で試行し、現行calendarも併読してevent IDで重複排除するため、Fedの年移管境界を固定しない。14:00 ET契約の根拠が固定できる2013年以降だけを許可し、それ以前は拒否する。後半foldは固定2026-01-01で止めず、集約データの最終60分バー終端まで伸ばす。
- **BLS非公表の原典補完(2026-08-02)**: 2025年の予算失効により、BLSアーカイブが明示するCPI・Employment Situationの2025年10月reference periodは非公表だった。欠損イベント時刻を捏造せず、`non_publications`へreference month、理由、BLSアーカイブURL、生HTML SHA-256を保存する。年次coverageは実イベント数とこの明示的例外の合計で判定するが、studyへはeventを投入しない。原典から月を特定できない不足は従来どおりcoverage issueとして評価を停止する。改訂済み公式履歴の探索利用であり、前向き/OOS/主採否根拠に昇格させない。
- **NFP金曜短期aftershock契約(2026-08-02)**: 既存共通`us_macro_aftershock_m60_v1`では金曜NFPの遅いbreakout後に8本retest窓が週末休場を跨ぎ、連続足ガードが大半を正しく除外した。v1を変更せず、明示指定`nfp_short_friday_v2`だけが使う`us_nfp_short_friday_aftershock_m60_v2`を追加する。初期1本、breakout最大2本、retest最大3本、主horizon 1本へ縮め、通常の金曜セッション内で閉じた初動後反応だけを測る。休場を補完・跨越せず、不規則窓は引き続き除外する。v1結果を閲覧後に作った探索契約なので`configuration_trials:2`を固定し、改訂済み外部履歴による探索結果を前向き/OOS/主採否根拠にしない。
- **NFP金曜短期契約の10.5年探索(2026-08-02)**: 2016-01-03〜2026-06-30の保存済みM60履歴とBLS公式NFP 131件を用いた。週末跨ぎによる`irregular_retest_window`はEURUSD/USDJPYとも0件へ解消した。EURUSDはretest-up/down各8件で最低10件未達、1本後平均は-2.05bps (95% CI -4.54〜+0.44) / +1.89bps (-2.67〜+6.45)。USDJPYは11/15件で最低件数を満たすが、+0.58bps (-3.80〜+4.97) / -3.40bps (-7.61〜+0.81)と両区間がゼロを跨いだ。USDJPYには原集約でinitial range不足も残るため、いずれも`not_evaluable`・採用根拠なしとする。次に条件を緩めて再探索する前に、新たな仕様を別契約として事前登録する必要がある。
- **経済イベントM60セッション適合性プレフライト(2026-08-02)**: 読み取り専用`preflight:macro-events-m60`を追加した。価格条件・方向・将来リターンを使わず、指定契約のinitial/breakout/retest/最大horizonを連続した保存済みM60足だけで構成できるかを、anchor時刻・曜日・月別に集計する。最初の不連続境界も最大20件まで返し、実行前に実効母数と週末・休場の影響を確認できる。実測ではCPI共通v1は126件中106件が可能、19件は全て金曜から49時間の週末gap、1件はanchor足欠落だった。NFP共通v1は131件中5件だけ可能で、120件が金曜週末gap、6件がanchor欠落。NFP金曜短期v2は125件が可能、6件のanchor欠落だけとなった。従ってCPI/NFPの既知の大半は原データの平日欠損ではなく契約窓と金曜セッションの構造的な不適合であり、休場の補完や黙った窓短縮は行わない。
- **FOMC共通M60契約の10.5年探索(2026-08-02)**: Fed公式statement 91件に対し、共通v1のプレフライトはEURUSD/USDJPYとも87件を連続窓として観測可能と示し、CPI/NFPのような週末構造問題はない。固定契約でのretestはEURUSD up/down 8/9件、USDJPY 8/6件で、両市場とも最低10件/分岐および合計20件を満たさず`not_evaluable`。主要4時間方向調整平均はEURUSD +5.24bps (-5.15〜+15.63) / -6.84bps (-15.94〜+2.25)、USDJPY -1.66bps (-8.18〜+4.86) / +18.54bps (+4.40〜+32.68)だった。USDJPY downの正値は6件だけの探索結果であり、8時間も区間がゼロを跨ぐため採用根拠にしない。条件を後から緩めず、別契約の事前登録なしに追試しない。
- **regime時刻結合(2026-07-21)**: optional `regime`設定で既存の効率比/ATR方向・trailing volatility labelを同じ確定OHLCからpoint-in-time生成し、各eventを`regime bar start + nominal resolution <= signal bar start`を満たす最新labelだけへas-of joinする。signal足自身のregimeは同時確定でも意図的に除外し、最大age、join coverage、分類warmup欠落を別集計する。directional 4、volatility 3、combined 12の全19セルを返すが、最低event数未満はhorizonを計算せず`not_evaluable`とする。評価可能セルもreturn平均/区間、positive率/区間、target率/区間だけに制限し、MFE/MAEや自動ランキングを展開しない
- **regime結合実機検証(2026-07-21)**: 同じEURUSD 15分5,000本・43eventへ20本効率比、ATR14、volatility baseline 50、group最低3event、最大age 1本を適用し、43/43件(100%)を直前確定regimeへ結合した。全件age 0msは直前15分足の名目closeがsignal足startと一致することを示し、signal足自身は不使用。固定19セル中9セルが評価可能、108主要intervalを返した。4本後returnはrange-highが+0.0345%で最良に見えたが95%区間-0.0153%〜+0.0844%、transition-highは-0.0179%で区間-0.0491%〜+0.0134%となり、評価可能9セルすべてゼロを跨いだため採用根拠なし。応答はevent明細0で約106KB、生OHLC/label列なし。検証後は元chartを完全復元した
- **検証状況**: accepted-upとfailed-upの排他分類・方向反転、形成中足除外、両側sweep拒否、fold集計、London DST開始後もlocal 08:00をUTC 07:00として扱うこと、MCP chart binding/read-only履歴取得をユニットテストで固定した
- **Event Aftershock Retest初版(2026-07-22)**: `event_aftershock_retest`は1〜200件のcaller-supplied canonical UTC event時刻を受け、イベント時刻と正確に一致する確定足から初動レンジを形成する。レンジ外への最初の終値break後、最初の境界touchが外側で終値を維持した場合だけ継続方向eventとする。時刻を次の足へずらさず、形成中足、初動レンジ・breakout/retest窓の欠落や不規則timestamp、境界内終値を明示的に除外する。calendarの現在92日取得制約を歴史データへ暗黙補完せず、event sourceと時刻の妥当性はcaller側の研究契約に残す。これはsignal bar closeのevent studyであり、約定・PF・収益性を主張しない
- **重複窓ポリシー(2026-07-22)**: `overlap_policy: "exclude_later_event"`を既定かつ唯一の選択肢として追加した。canonical eventを時刻順に並べ、初動range + breakout window + retest window + 最大horizonの評価窓に入る後続eventを決定論的に除外する。返却する`eventContract`へ最大評価本数と最小分離時間を明示し、品質情報へポリシー適用後件数と除外件数を残す。同一UTC時刻の複数eventは、ID・経済的意味を推測して集約せず引き続き入力エラーとする
- **実機E2E(2026-07-22)**: EURUSD 15分足の確定5,000本(2026-05-11〜07-22)に、TradingView calendarの米国highイベントを適用した。2026-05-05〜07-22の74 raw eventから、同一UTC時刻はID昇順の先頭だけを残し、初動4本 + breakout/retest各16本 + 最大horizon 16本の評価窓(13時間)に近接する後続eventを呼び出し側で除外して30時刻を入力した。初期履歴外2件、breakoutなし7件、retestなし3件、境界内終値9件を除外し、retest-up 6件/retest-down 3件の計9 eventとなった。minimum 10に届かず`partial`であり、foldも少数かつ符号不安定のため採用根拠なし。実行後はEURUSD 60分足へ復元した。同時刻の集約だけはcaller側の意味論として残し、近接後続eventの除外は以後ツール契約として固定した
- **重複窓ポリシー実機E2E(2026-07-22)**: MCP再起動後、同じEURUSD 15分・確定5,000本へcalendarの62 raw eventを再取得した。同時刻をID昇順で代表化した37 canonical timestampを入力し、`exclude_later_event`が評価窓52本(13時間)内の後続7件を自動除外して30件へ縮約した。初回E2Eの手動近接除外後の件数と一致し、初期履歴外2件、breakoutなし7件、retestなし3件、境界内終値9件の内訳とretest-up 6/retest-down 3の検出件数も不変だった。9件でminimum 10未達、foldも7件/2件に偏るため、従来どおり採用根拠なし。検証後はactive第2ペインをXAUUSD 60分足へ復元し、既存StudyのID・名前を照合した
- **同時刻イベントポリシー(2026-07-24)**: 経済カレンダー等で同一UTC時刻に複数の重要イベントが重複して発生した場合に、`eventId` 昇順で決定論的に代表イベントを1件抽出し、後続を `duplicateTimestampEventsExcluded` カウントへ分類する `same_timestamp_policy: "represent_first"`(既定)および厳格エラー拒否する `"reject"` を追加した
- **多重比較補正(2026-07-24)**: `configuration_trials` 申告時に Bonferroni 補正後の調整済み有意水準 (`bonferroniAdjustedAlpha = (1 - confidenceLevel) / configurationTrials`) を推論契約へ自動付与し、過剰適合・Pハッキングの自己診断を支援する仕組みを追加した。実際の信頼区間自体は非調整のままであることを`inferenceWarnings`へ明示し、`bonferroniAdjustedAlpha`は参考値であって自動適用ではないことを contract 側でも区別する
- **Fair Value Gap Retestイベント(2026-07-25)**: `run_market_event_study` へ `fair_value_gap_retest` (`schemaVersion: "1.0"`, `methodologyVersion: "fvg_retest_event_study_v1"`) を追加した。3本足の価格ギャップ（強気: `bar[i-2].high < bar[i].low`、弱気: `bar[i-2].low > bar[i].high`）、最小幅 `minimum_gap_bps` (既定10bps)、モメンタム実体比率 `min_impulse_body_ratio` (既定0.5) を確定足のみで判定。形成後の指定窓 `retest_within_bars` (1〜96本) 内でゾーンへ進入した最初の足をシグナル参照足とし、`require_boundary_hold` でゾーン破断の有無を分離。方向調整 forward return, MFE, MAE, 信頼区間, 時系列 fold, および `register_event_study_hypothesis` 連携をサポート。単体テスト (`test/unit/fvgRetestStudy.test.mjs`) がパス。
- **FVG事前登録・市場横断OOS E2E(2026-07-26)**: 結果を見る前に60分仮説 `fvg-retest-cross-market-60m-20260726` (journal sequence 75) と15分仮説 `fvg-retest-cross-market-15m-20260726` (sequence 76) を別契約で登録した。共通条件は最小gap 3bps、impulse body比率0.60、far boundary保持、1 configuration、主要評価4時間、最低30 event、EURUSD/GBPUSD/XAUUSD横断。実時間を揃えるため、60分は12本以内retest・horizon 1/4/12、15分は48本以内retest・horizon 4/16/48とした。各5,000 closed barを固定3foldで評価し、証拠をsequence 77〜82へ`inconclusive`で自動記録した
- **FVG 60分結果(2026-07-26)**: event数はEURUSD 235、GBPUSD 296、XAUUSD 375で全市場が最低件数を満たした。主要4時間の方向調整平均は、EURUSD bullish +0.38bps / bearish +1.51bps、GBPUSD +0.75bps / -0.88bps、XAUUSD +4.28bps / +2.39bps。6分岐すべての95%区間がゼロを跨ぎ、fold符号も安定しなかった。特にXAUUSD bullishはfold +4.50/+10.86/-0.32bps、bearishは-6.24/-2.33/+14.30bpsで、全体平均だけを継続優位と解釈できない
- **FVG 15分結果(2026-07-26)**: event数はEURUSD 111、GBPUSD 157、XAUUSD 365で全市場が最低件数を満たした。主要16本(4時間)平均は、EURUSD bullish +0.18bps / bearish +2.52bps、GBPUSD -0.73bps / -2.12bps、XAUUSD -3.05bps / +6.55bps。ここでも6分岐すべての95%区間がゼロを跨いだ。EURUSD bearishはfold +2.90/+0.93/+5.32bpsと同符号だったが各13〜27件で区間は-1.53〜+6.57bps、GBPUSD bearishは全体で負、XAUUSD bearishもfold -2.93/+12.55/+9.04bpsと不安定だった。**固定FVG単独条件の市場横断・時間足横断優位は確認できず、Strategy化・PF/コスト評価へ進めない**。XAUUSD 15分bearishとEURUSD 15分bearishは結果閲覧後に見つかった探索候補にすぎず、追試する場合はsessionまたは事前regimeを1つだけ固定した新仮説として未使用期間を前向き収集する
- **FVG単一レジーム前向き仮説(登録済み・収集中、2026-07-26)**: 探索結果を閲覧した後の候補であることを明示し、`xauusd-15m-bearish-fvg-trend-down-forward-20260726`をevent-study journal sequence 83へ`2026-07-26T02:28:23.067Z`に登録した。対象はXAUUSD 15分のbearish FVGのみ、gap 3bps以上、impulse body比率0.60以上、48本以内のfirst retest、far boundary保持、シグナル開始前に閉じた最新レジームが`trend_down`、最大age 1本とする。volatilityとsessionは固定せず、後付けで追加しない。主要指標は16本後(4時間)のmean directional return、補助horizonは4/48本、target 10bps、最低50 event、configuration trial 1、population `live`。登録時刻以前のsignalは永久に不適格とし、15分境界へ切り上げた`signal_from: 2026-07-26T02:30:00.000Z`を固定する。主要horizonが確定したeventだけを前向き証拠として集計する
- **FVG前向き選択契約(2026-07-26)**: `fair_value_gap_retest`を`fvg_retest_event_study_v2`へ更新し、一次集計へ入る母集団を`signal_from` inclusive / `signal_to` exclusive、`direction` 1つ、`regime_filter.directional` 1つと任意の単一volatilityで固定できるようにした。レジームはシグナル足自身を使わず、シグナル開始前に名目close済みの最新分類だけをas-of結合する。期間外、反対方向、prior regimeなし、stale、regime不一致を別々に数え、`byBranch`と研究ジャーナルには選択済み分岐だけを渡す。これにより履歴を再取得しても登録前イベントが全体集計へ再混入しない。収集途中で閾値、方向、レジーム、主要horizonを変える場合は同じhypothesis IDを再利用せず、新仮説として登録する
- **FVGシグナル足の分岐別確保(2026-07-26)**: `usedSignals`が両分岐で共有された単一集合だったため、先に検出されたbullish FVGがbearish FVGのシグナル足を占有し、`direction`で凍結した一次母集団から他分岐由来の理由でeventが消えていた。しかもどちらが先に到達するかは読み込み窓の開始位置で変わり、`count`は`definitionHash`に入らないため同一定義ハッシュのまま標本が変わった。同一`signal_from`・`direction: bearish`で古いバーを3本減らすだけでbearish eventが1件から2件へ変わる再現を確認し、シグナル足の確保を分岐ごとに分離した。同一分岐内の競合は同じシグナル足を共有するため件数と測定値は履歴長に対して安定し、変わるのは由来FVGの表示だけになる。`quality.overlappingSignalsExcludedByBranch`で除外の帰属を分岐別に出す。sequence 83の前向き仮説はこの修正後の実装で収集する
- **FVG前向き初回実機確認(2026-07-26)**: XAUUSD 15分を一時選択し、上記の固定契約で初回read-only取得を実行後、60分へ復元した。TradingViewが返した300本の最新確定足は`2026-07-24T20:45:00.000Z`で、`signal_from`より前だった。検出済み22 FVG eventは全件`signalBeforeWindowExcluded`、選択母集団は0件、反対方向・regime不一致・stale結合は0件だった。週末のため期待どおり新規証拠はなく、journalには空の結果を追記しない。この確認は登録前履歴が前向き集計へ混入しないことだけを示す
- **日跨ぎセッション対応(2026-07-25)**: `session_auction` および `failed_breakout` 条件において、同一local day制限 (`on one local day`) を解除し、`range_start: "22:00"`, `range_end: "06:00"`, `auction_end: "12:00"` のような日付・日付境界を跨ぐセッションウィンドウ（Cross-Day Session Support）に対応した。相対分（`relativeMinute`）計算、24時間未満の厳格な合計スパン検証、およびアンカー日付（`anchorDate` / `anchorWeekday`）への決定論的マッピングを行う `localizeAnchor` (DST切り替え安全な24h減算 `barMs - 86_400_000` を使用) を導入し、Mapベースの $O(N)$ グルーピングを実装した。単体テスト (`sessionAuctionStudy.test.mjs`, `failedBreakoutStudy.test.mjs`) および MCP 統合テスト (`server.test.mjs`) がパス。
- **複合条件 DSL / 組み合わせ表現(2026-07-25)**: `run_market_event_study` へ `composite_condition` (`schemaVersion: "1.0"`, `methodologyVersion: "composite_condition_event_study_v1"`) を追加した。2〜4つの素条件（`session_auction`, `failed_breakout`, `fair_value_gap_retest`, `session_exhaustion_handoff`, `event_aftershock_retest`）を組み合わせる `intersection` (AND, 相互ペア近接 `pairwise_span`), `filter_gate` (Primary gated by secondary, `primary_anchored_lookback`), `union` (OR, 対立シグナル `ambiguousBothSides` 自動除外) 演算子を実装。アライメント時間窓 `max_alignment_bars` (0〜24本) と `require_same_direction` 方向整合制御を完全な確定足 Point-in-Time 保証のもとで評価。近接複合イベントの評価窓重複を防ぐ `overlap_policy: "exclude_later_event"` (既定, `quality.overlappingEventsExcluded` にカウント) と deduplication・時系列ソートを実施し、リサーチジャーナル連携およびサブエージェントレビュー（7基準パス）を完了。単体テスト (`compositeConditionStudy.test.mjs`: `overlap_policy` 除外テスト、3〜4条件 `pairwise_span` 境界テスト、`filter_gate` / `union` テスト) および MCP 統合テスト (`server.test.mjs`: `alignmentRule` / `overlapPolicy` 契約アサート) がパス (全441件パス)。
- **複合条件 DSL v2 否定・順序・レジームゲート拡張(2026-07-25)**: `run_market_event_study` へ複合条件 DSL v2 (`schemaVersion: "1.0"`, `methodologyVersion: "composite_condition_event_study_v2"`) を追加実装した。否定・排他条件 (`negation`, Primary条件発生時に近接時間窓 `[-lookback_bars, +lookahead_bars]` 内で Exclusion条件が非発生であることを要件化) および 時系列順序条件 (`sequence`, First条件発生後 `1`〜`sequence_window_bars` 以内に Second条件が発生した場合のみ後続シグナル化) 演算子を追加した。また、シグナル確定足直前までのPoint-in-Time判定に基づく確定足市場レジームフィルタ (`regime_gate`: `directional`, `volatility`) を複合条件節内に直接指定可能とした。旧 `v1` 仕様との完全な下位互換性を維持し、確定足依存性と過小評価/排除件数の決定論的集約を単体テスト (`compositeConditionStudyV2.test.mjs`) および MCP 統合テスト (`server.test.mjs`) で固定した (全448件テストパス)。
- **検証状況**: 代表化・除外カウント、同一時刻拒否、無効ポリシー値拒否、Bonferroni α計算(最大試行数10万件の精度含む)、FVG 検出・再テスト・境界保持判定、日跨ぎセッション評価、および複合条件 DSL (overlap_policy 除外、3〜4条件 pairwise_span 境界、filter_gate, union, MCP 配線) 評価を単体・MCP統合テストで固定した

### #37 市場レジーム分類(`compute_market_regimes`) 🟡 台帳・一括・session分解実装、他要因は継続

- **目的**: trend/range、低/高volatility、相関状態、session、重要イベント近接を決定論的に分類し、手法の適用環境と停止環境を発見する
- **契約**: 閾値、lookback、使用特徴量、版を明示し、各バーに当時利用可能だった証拠だけでlabelを付ける。未来全期間の分位点を過去labelへ遡及適用しない
- **評価**: Strategy Tester台帳と厳密時刻で結合し、regime別の取引数、期待値、PF、DD、MAE/MFEを返す。少数regimeを全体成績へ隠さない
- **初版実装(2026-07-21)**: `compute_market_regimes`はactive chartのexact symbol/timeframeを拘束し、Bar Replay中を拒否して最大5,000本のロード済み確定OHLCだけを読む。trend lookbackの効率比と現在ATR単位の方向移動から`trend_up`、`trend_down`、`range`、`transition`を分類し、現在ATR%をその時点までのtrailing ATR%中央値で割って`low`、`normal`、`high` volatilityを分類する。lookbackと全閾値は入力へ明示され、未来分位点や全期間fitを使用しない
- **結果契約**: current label、全分類barのdirectional/volatility/combined分布、combined label遷移回数、形成中足除外、非連続timestamp、minimum classified barsを返す。明細は直近最大500件に制限し、集計は全分類barを使用する。閾値探索、ランキング、予測、売買許可は返さない
- **検証状況**: trend/rangeの分離、trailing volatility expansion、将来bar追加前後で同一時刻labelが不変であること、形成中足除外、非連続timestamp報告、MCP chart binding/read-only履歴取得をユニットテストで固定した
- **台帳結合実装(2026-07-21)**: `run_strategy_regime_analysis`は既定dry-runでexact chart、保存済みPine ID/版、入力、regime閾値、coverage条件を固定する。confirm後に最大20,000本(既定20,000本)のロード済み確定OHLCから全regime labelを内部生成し、Strategyを一時追加、input settle、完全ledger収集、所有確認付き削除、元chart fingerprint照合を行う。各closed tradeはEntry時刻までに名目close済みの最新barだけへas-of joinし、Entry足の未確定OHLCを使わない。明示した最大regime ageを超える証拠とOHLC coverage外の取引は除外する
- **実機coverage修正(2026-07-21)**: USDJPY 4HのTurtle/RSI2完全台帳(2020年開始)に対し、当初の5,000本上限ではregime証拠が2023年以降に限られ、結合率が約49%となった。チャートに10,000本以上をロードしてもツール側が直近5,000本だけを読む問題だったため、専用上限と既定値を20,000本へ拡張した。通常の`compute_market_regimes`公開応答上限は5,000本のままとする
- **台帳結果契約**: joined coverageと除外理由を分母付きで返し、directional、volatility、combined regime別にTradingView台帳profitを用いたPF、期待値、勝率、closed-trade equity DD、run-up/drawdown coverage、commission coverageを集計する。raw ledger/OHLC、trade明細、regimeランキング、自動採用は返さない。完全ledgerでない、件数不一致、join 0件、cleanup/chart復元失敗はblockedとする
- **台帳結合検証**: 同一Entry足の終値を参照せず直前close済みlabelへ結合すること、regime別PF/期待値、古い証拠除外、不完全ledger拒否、dry-run境界、一時Strategy削除、chart fingerprint復元を単体・MCP統合テストで固定した
- **一括分析実装(2026-07-21)**: `run_strategy_regime_matrix`は最大12件の明示symbol/timeframe/Pine/input jobへ同一のregime・join契約を適用し、直列にOHLC取得、完全台帳収集、regime結合、Strategy削除、元chart復元を行う。900秒既定・最大1,800秒のsoft deadline後は新規jobを開始せず、個別計算失敗は行として継続し、復元失敗時だけ後続を停止する。各jobのledger ID、証拠品質、coverage、全体およびregime別指標を保持するが、異なるreport通貨を合算せず、ランキングや自動採用を返さない
- **一括履歴ロード(2026-07-21)**: 実機でsymbol/timeframe切替直後は要求20,000本に対して300本しかなく、2024年開始の台帳とのregime joinが0〜2.5%になったため、`load_more_bars`を追加した。job切替後・OHLC取得前に最大20,000本を下位API上限5,000本ずつ最大4回ロードし、要求数、試行数、実追加数、追加可否を各jobへ記録する。履歴ロードは対象jobのseries cacheを増やす操作としてdry-runへ明示し、途中で履歴終端なら追加0または`moreAvailable:false`で打ち切る。2026-07-21の実機再検証ではsymbol/timeframeを離れて戻ると300本へ戻る場合があり、別jobや後続呼び出しへのキャッシュ保持は保証しない。各job内でロード直後に取得・評価する契約とする
- **session分解(2026-07-21)**: 単体・一括regime分析へ任意の1〜8件のIANA timezone、開始・終了時刻を追加し、各closed tradeのEntry時刻を東京/London/New York等の窓へDST・日跨ぎ・session開始曜日込みで決定論的に分類する。既定の`all_matches_non_exclusive`は重複時間帯を全該当sessionへ含める。`first_match_exclusive`を明示した場合は入力配列順を優先順位として最初の一致だけへ割り当て、各取引を最大1sessionに固定する。非該当はどちらも`outside_defined_sessions`へ残す。policyと排他時のpriorityを定義・結果へ明示し、最良sessionの選択は行わない
- **重要event近接(2026-07-22)**: `run_strategy_regime_analysis`と`run_strategy_regime_matrix`へ任意の`event_proximity`を追加した。callerが1〜200件のcanonical UTC予定時刻、明示的なcalendar取得範囲`coverage_from`/`coverage_to`、前後0〜1,440分窓を渡し、各closed tradeのentry時刻を半開区間`[event_time - before, event_time + after)`で集計する。calendar範囲内は`near_scheduled_event`または`outside_scheduled_event_window`、範囲外は比較不能な`outside_event_calendar_coverage`として必ず分離する。初回XAUUSD実機で取得範囲外の1〜4月取引が窓外群へ混入したため、PFを採用せずこの契約へ是正した。同時刻、ID、非canonical時刻、範囲外eventは拒否し、calendarの実績値、将来のイベント、価格bar、過去の暦を暗黙取得・補完しない。定義hash、dry-run、結果契約へ件数・範囲・窓を残し、価格regime・session集計と別軸でPF等の記述統計を返す。回帰テスト後、MCP再起動済み実機で再検証する
- **実機E2E(2026-07-22、是正後)**: XAUUSD 60分足で3,000本(2026-01-19〜07-22)を使い、Session-Selective Turtle Router v1の完全台帳249 closed tradeのうち、同一時刻を代表化した米国high 38 scheduled timestamp(2026-05-01〜07-22)で検証した。前30分・後120分窓はnear 6件(PF 0.166)、同一calendar coverage内の窓外は10件(PF 1.086)、calendar coverage外は17件(PF 1.666)となり、初回の窓外29件が後2群へ正しく分離された。near対coverage内窓外は6対10と少なく、かつregime joinは33/249件で最低80%未達のため、event近接の有効性・PF差を採用根拠にしない。一時strategyを除去し、XAUUSD/60分足と既存3 Studyのfingerprint復元を確認した
- **相関状態初版(2026-07-23)**: 読み取り専用`compute_correlation_regimes`を追加した。primary/referenceの別ペインをsymbol・timeframeまで二重拘束し、各市場の形成中足を除外、exact UTC timestampで一致するclosed barだけを使う。対数close-to-close returnのrolling Pearson correlationを`strong_positive`/`positive`/`neutral`/`negative`/`strong_negative`へ分類し、期間window・閾値・alignment policy・coverageを明示する。欠損時刻はforward fillせず、相関が因果・安定関係・売買判断を意味しないことを契約へ残す。単体とMCP tool一覧を含む380テストで固定し、実機E2EはMCP再起動後に行う
- **相関状態実機E2E(2026-07-23)**: EURUSD/DXYを各60分足・直近300本へ一時配置し、primary 299/reference 299 closed barのうちexact UTC一致297本から20本rolling observation 277件を作成した。欠損2時刻は補完されず、quality issueなし。直近20本相関は-0.916で`strong_negative`となり、EURUSDとDXYの逆方向連動を記述的に確認した。第2ペインはXAUUSD 60分足と既存3 Studyへ復元し、全chart contextを照合した。この結果は因果・将来の持続・売買根拠を示さない
- **連続性品質修正(2026-07-23)**: exact timestampで整列した後にも、異なる市場の取引時間差で隣接returnの間隔が不揃いになり得る点を是正した。相関計算は観測値を暗黙に除外せず、名目時間足の1.5倍超の間隔を`irregularIntervals`として数え、`one_or_more_non_contiguous_bar_intervals`をquality issueへ残す。修正後の同一EURUSD/DXY 60分・300本E2Eでは、297 aligned bar/277 observationと直近-0.916は不変のまま、週末をまたぐ不連続2件を検出して`partial`を返した。第2ペインはXAUUSDと既存3 Studyへ復元済み
- **相関台帳as-of結合(2026-07-23)**: `run_strategy_regime_analysis`へ任意`correlation_regime`を追加した。参照chart index、symbol、同一timeframe、rolling window/threshold、最大証拠ageを明示し、参照chartと両OHLCを二重拘束して相関観測を生成する。各closed tradeはentry前に名目close済みの最新相関labelだけへ結合し、未取得・future・stale証拠は取引を落とさず`outside_correlation_evidence`へ分離する。相関結合率が既存minimum coverageを下回れば`partial`とし、相関計算の不連続品質も上位quality issueへ伝播する。単体、MCP一時Strategy追加・削除・chart復元を含む382テストで固定し、実機E2Eは再起動後に行う
- **相関台帳as-of実機E2E(2026-07-23)**: EURUSD 60分・Session-Selective RSI2 Router v1の97 closed tradeを、同じ60分のDXY 3,000本・20本rolling相関へ結合した。primary/reference各2,999 closed barから2,975 exact-aligned bar、2,955相関観測を生成し、regimeへ結合済みの16件のうち15件(93.75%)が`strong_negative`、1件が`outside_correlation_evidence`となった。strong-negativeのPF 1.295は、主regimeのOHLC coverageが16/97件(16.49%)で最低80%未達、かつ相関の不連続25件があるため、採用根拠にしない。一時Strategy削除とprimary fingerprint復元後、DXYをXAUUSDへ戻し、EURUSD/XAUUSDと全既存Study・active第2ペインを照合した
- **相関一括as-of結合(2026-07-23)**: `run_strategy_regime_matrix`にも同じ`correlation_regime`を追加した。参照ペインはjob実行中に変更せず、誤って異なる時計の観測を混在させないため、指定時は全jobのtimeframeが参照chartと一致しなければ開始前に拒否する。各jobは一時切替後の主chartと不変の参照chartを再拘束して相関を計算し、個別の`correlationEvidence`、as-of結合結果、連続性品質を返す。`load_more_bars`指定時は、参照ペインにも同じ本数をjob開始前に一度だけロードし、プレビュー・結果へ試行数と追加本数を残す。二画面・二jobの統合テストで、プレビュー契約、相関groupへの全取引結合、参照ペインの一回だけの履歴ロードと非変更、各job後と最終の主chart復元を固定した
- **相関一括as-of初回実機E2Eと是正(2026-07-23)**: EURUSD RSI2/XAUUSD Turtleの60分・各3,000本をDXY参照で実行した。主chartは3,000本ロードされた一方、旧実装では固定参照DXYが300本のままで、EURUSDは相関結合0/16件、XAUUSDは3/34件となった。両jobは`minimum_*_coverage_not_met`で`partial`となり、PFを誤って採用しなかった。これを受け、参照にも一回だけ同じ履歴ロードを行うよう是正した。是正後E2Eでは参照DXYへ3,000本を一回追加し、EURUSDは2,955相関観測・15/16件(93.75%)、XAUUSDは2,842観測・33/34件(97.06%)を結合した。EURUSDの`strong_negative`15件はPF 1.295、XAUUSDはnegative 19件PF 0.713/strong-negative 10件PF 0.990だったが、主regimeのOHLC coverageが各16/97件(16.49%)、34/250件(13.60%)で80%未達かつ不連続timestampも検出されたため、いずれも採用根拠にしない。一時Strategy削除、各job後の主chart fingerprint復元、最後のDXY→XAUUSD復元、EURUSD/XAUUSDの既存Studyとactive第2ペインを照合した
- **混在時間足の相関一括結合(2026-07-23)**: 既定の不変参照方式を維持したまま、`correlation_regime.allow_reference_timeframe_switch:true`を明示した場合だけ、参照ペインのsymbolを固定して各jobのtimeframeへ一時切替できるようにした。参照の履歴はjobごとにロードして相関捕捉後ただちに戻す。参照transaction失敗、主または参照fingerprint不一致は`restore_failed`として後続jobを停止し、最終応答にも両ペインの復元状態を残す。実装中の初回実機では、参照を4時間へ切り替えた後にStrategy Tester台帳を読む順序だったため、XAUUSD jobが参照DXYの台帳を読み `strategy ledger symbol changed` で失敗した。台帳収集を参照切替より先へ移し、この順序を統合テストで固定した。再起動後のE2EではEURUSD 60分 RSI2(97 trade)とXAUUSD 4時間 Turtle(154 trade)をDXY参照で完走し、各主/参照fingerprintと最終DXY 60分への復元を確認した。EURUSDの相関結合は15/16件(93.75%)、XAUUSDは18/46件(39.13%)だった。両jobとも主regime coverageが16.49%/30.07%で80%未達、XAUUSDは相関coverageも未達かつ非連続timestampを検出したため、PFを採用根拠にしない。終了後は利用レイアウトとして第2ペインをXAUUSD 60分へ戻し、既存Studyを照合した
- **実機E2E(2026-07-21)**: USDJPY 4H、2020-01-01〜2026-07-21の完全台帳でTurtle v4.0は182/183件(99.45%)を結合し、全体PF 1.253、transition PF 1.486(107件)、range PF 0.961(69件)。RSI2 v2.0は226/230件(98.26%)を結合し、全体PF 0.918、transition PF 1.156(99件)、range PF 0.769(126件)。両実行とも一時Strategy削除と元chart fingerprint復元を確認した。Forex週末等の非連続timestampは補間せず通知するため、評価本体はcompleteでもツール全体はpartialとなる
- **多重参照シンボル相関一括結合(2026-07-25)**: `run_strategy_regime_matrix`の各jobへ個別の`correlation_regime`オーバーライドを追加し、jobごとに異なる参照シンボル(例: EURUSDにはDXY、USDJPYにはUS10Yなど)を指定可能にした。参照シンボルが現在の参照チャートと異なる場合は`allow_reference_symbol_switch: true`を必須とし、各jobで一時的に参照チャートのシンボル/タイムフレームを安全に切り替えて相関証拠を収集後、確実に元のチャート状態へ復元する。マトリックス内に複数の参照シンボルが存在する場合は`definition`・`execution`へ`uniqueReferenceSymbols`と`referenceComparisonCount`を算出して記録し、多重比較の参考警告`multiple_reference_symbols_inspected_in_matrix`を`inferenceWarnings`へ付与する。全初期参照チャートの復元チェックとフェイルクローズな状態維持を単体テストで固定した
- **3ペイン以上の不変参照(2026-07-25)**: jobごとに異なる参照ペインを使う構成で、参照ペインの履歴が一度もロードされない欠陥を是正した。従来の一括事前ロードはmatrix直下の`correlation_regime`が指定された場合だけ動き、job個別の`correlation_regime`だけを使う構成では`onceBeforeJobs`が偽になり、かつ非切替経路が`loadMoreHistory`を呼ばないため、参照ペインは既定の約300本のまま相関計算に使われていた。是正後は、どのjobもsymbol/timeframeを切り替えないペインを不変参照と判定し、matrix開始前に各ペインへ一度だけ`load_more_bars`をロードする。切替を伴うペインは復元で追加本数が失われるため従来どおりjob内でロードする。`execution.invariantReferenceChartIndices`と結果の`invariantReferenceHistoryLoads`(ペインごとの試行数・追加本数・継続可否)を返す。3ペイン(EURUSD×DXY、XAUUSD×US10Y)の統合テストで、両参照ペインへの一度だけの履歴ロード、jobごとの相関証拠、全ペインの復元を固定した
- **残タスク**: より長いcalendar coverageと十分な取引数による重要event近接の再検証。3ペイン以上の実機E2E

### #38 特徴量と将来結果の関係(`compute_feature_outcome_relationships`、優先度: 中・規模: 中〜大)

- **目的**: RSI/MAだけでなく、ATR収縮率、実体・ヒゲ比率、連続性、ギャップ、相関変化、セッション位置などから次に検証すべき仮説候補を見つける
- **境界**: 売買判断や「最適閾値」を直接返さず、欠落率、分布、将来horizon別効果、fold安定性、多重試行数を返す。特徴量算出は確定足かつpoint-in-timeで決定論的に行う
- **リーク防止**: 正規化、閾値、特徴量選択を全期間でfitしない。trainで決めた変換をtestへ固定適用する
- **初版実装(2026-07-21)**: active chartのexact symbol/timeframeを拘束し、Bar Replay中を拒否して最大5,000本のロード済み確定OHLCだけを読む。`atr_compression`、`body_direction`、`wick_imbalance`、`directional_streak`、`range_position`、`gap_direction`を選択可能にし、ATR lookbackとそれ以前のATR中央値、直近range、直近close方向、当該確定足のOHLCだけでbucketを決める。全期間分位点、未来fit、forward fill、閾値探索、ランキングは使わない
- **結果契約**: signal足closeをevent referenceとして、後続の観測済み1〜250本のforward return、max upside、max downside、positive rateをfeature/bucket/horizon別に集計する。各barでの因果や売買方向を主張せず、intrabar ordering・fill・コスト・PFを扱わない。最大12件の非重複fold、最新最大500件のlabelled observation、形成中足・不規則timestamp・warmupを品質情報として返す
- **horizon時計(2026-07-21)**: horizonは`subsequent_observed_bars`であり、週末や休場をforward fillせず、その後に実際に観測されたN本を数える。calendar gapを跨いだreturnも市場再開時の価格変化として含め、`horizonClock: observed_market_bars`、`contiguousBarsRequired: false`、`calendarGapsIncluded: true`を返す。短期連続反応を測る#36の`contiguousBarsRequired: true`とは異なる母集団であり、無言で比較しない
- **研究ジャーナル連携(2026-07-24)**: `configuration_trials`と任意`journal`を追加し、既存のappend-onlyイベント研究ジャーナルへ`feature_outcome_relationships`証拠を直接記録できるようにした。feature/bucket/horizonごとの`meanForwardReturn`、`medianForwardReturn`、`positiveRate`、`meanMaxUpside`、`meanMaxDownside`を保存し、方向調整returnや約定結果へ変換しない。計算定義と取得範囲から`definitionHash`/`studyId`を決定論的に作り、試行構成数はevidence hashへ含める。旧イベント研究recordは省略フィールドのまま既存hashを維持し、記録失敗時も計算結果を保持して構造化エラーを返す
- **限定特徴量×レジーム条件(2026-07-24)**: `compute_feature_outcome_relationships`へ任意`regime` filterを追加した。呼出側はdirectional regimeと任意のvolatility regime、全レジーム閾値を事前固定し、一致する同じsignal足の確定レジームだけを残して特徴量結果を集計する。レジームは当該足までのOHLCだけで算出し、結果は後続観測足だけを用いるため未来情報をlabelへ混入させない。全組合せをランキングする機能は設けず、filter、除外数、未分類数、レジーム品質を定義・応答・研究証拠へ残す
- **前向き特徴量選択契約(2026-07-27)**: `feature_selection`は特徴量と有効bucketを1つに固定し、`features`との併用を拒否する。`signal_from` inclusive / `signal_to` exclusiveはsignal bar時刻にだけ適用し、登録前の特徴量イベントを再読み込み時に一次集計へ混入させない。窓前後・別bucketの除外数、固定selectionと窓を定義・journal evidenceへ残す。これにより特徴量×方向×レジームを、探索結果と分離した未使用期間で収集できる
- **XAUUSD日足のtransition特徴量探索(2026-07-27)**: 5,000本(2007-04-04〜2026-07-26)、ATR14/基準50、trend lookback20の`transition`だけを対象に、2010-15 / 2015-20 / 2020-26の3foldで5日後returnを閲覧した。ATR圧縮(試行9)は`compressed`が117件で全体+0.435%だったが、foldは+0.519% / +1.355% / -0.823%と反転した。連続3本(試行10)は`down_streak`が203件で全体+0.235%だが、foldは+0.118% / -0.079% / +0.543%で安定しない。`up_streak`も342件で全体+0.291%、全foldが正で、transition後の平均回帰という仮説に反した。金の長期上昇ドリフトと区別できず、どちらも前向き仮説へ登録しない
- **同一レジーム基準との差分(2026-07-27)**: `feature_selection`時は、同じsignal時刻窓・同じレジームを通過した全signal足を参照母集団として保持し、選択bucketのreturn/positive rateとの差分をhorizon・fold別に返す。選択母集団は参照母集団に含まれるため独立標本の検定ではなく、serial dependence・多重試行・コストも補正しない。この対照を必須にして、金の無条件上昇ドリフトを特徴量の情報と誤認しない
- **EURUSD 50分前向き候補の基準監査(2026-07-27)**: 前向き収集前の履歴だけを`signal_to`で固定し、`lower_wick_dominant × trend_down`を同一trend_down基準と比較した。選択12件の5本後平均は+2.01bp、基準51件は+4.85bpで差は**-2.83bp**、positive rate差も-5.88ptだった。fold差は初期+13.38bp / 中期-5.70bp / 直近-5.99bpで、選択条件の優位は再現しない。登録済み仮説は反証可能な前向き収集として残すが、採用候補へ昇格させない
- **EURUSD 50分の基準差分探索(2026-07-27)**: `upper_range × trend_up`(試行11)は選択67件に対して基準68件で、選択が基準のほぼ全体を占め差分+0.14bpも情報量がないため除外した。`bearish_body × transition`(試行12)は選択580件、基準2,421件で5本後差分-0.14bp、positive rate差+0.72ptだった。fold差は-1.19bp / +0.35bp / -0.11bpで実質ゼロかつ安定しない。単独の弱気実体は同一transition基準に追加情報を与えず、前向き仮説へ登録しない
- **合成シンボル対応とドリフト基準値(2026-07-27)**: `SYMBOL_SCHEMA`と研究ジャーナルの`SYMBOL_PATTERN`へ1つのスラッシュを許可し、`OANDA:XAUUSD/OANDA:XAGUSD`のようなTradingViewレシオスプレッドを既存の全研究ツールへ束縛できるようにした。各脚は従来どおり48文字までで、脚が空のものと2つ以上のスラッシュは拒否する。スプレッド専用の研究ツールは不要で、チャート側がスプレッドになるためfeature study・event study・regime分類がそのまま適用できることを実データで確認した(観測4,935、warmup 64、不規則timestamp 1,020を非補間)
- **無条件ドリフト実測(2026-07-27)**: 同一期間2007-04〜2026-07、同一設定、各4,930/4,914観測で5系列の無条件平均先行リターンを測った。5日先/21日先で、XAUUSD単体 +0.2152%/+0.8931%、XAU/XAG +0.0793%/+0.3252%、EUR/GBP +0.0305%/+0.1238%、AUD/NZD +0.0122%/+0.0474%、EURUSD単体 -0.0113%/-0.0443%。脚の性質が近いほどドリフトは相殺され、AUD/NZDは金単体の約18分の1まで落ちた。バケット別平均を件数で加重平均して復元した値であり、ペイロードを増やさずに厳密に出せる
- **スプレッド構成の結論(2026-07-27)**: **EURUSD単体のドリフトが既にAUD/NZDスプレッドと同水準**であり、FXにはそもそも金のような強い上昇ドリフトが存在しない。今セッションで全ての見かけの優位を偽装していたのは金のドリフトであって、スプレッド化はそれを避ける手段の1つにすぎず、優位そのものを生まない。FVG市場横断検証でEURUSD/GBPUSDが振るわなかったのも、ドリフトに助けられなかったためと整合する。XAU/XAGはレシオ自体が上昇トレンドを持ち金単体の3分の1までしか落ちないので中立ではない。**スプレッド構成へ移れば前進するという期待はこの測定では支持されない**。ただし5系列のドリフト基準値は、以後どの市場でも効果量がドリフトを超えているかを即座に判定する基準として残る
- **検証状況**: 上昇/下降系列でbucket化と将来分布、後続bar追加後も既存barのfeature labelが不変、形成中足除外、不規則timestamp非補間、公開MCPのchart拘束と応答上限を単体・統合テストで固定した。研究ジャーナル連携では新しい指標契約、冪等記録、試行数変更時のevidence hash差分、異種指標混入拒否、journal障害時の分析結果保持を単体・MCP統合テストで固定した。実機E2EはXAUUSD 4Hの300本で235観測、形成中1本除外、不規則timestamp 10件を非補間として確認した。これは探索用の短期窓であり、feature 6個×bucket×horizonを同時閲覧した結果を採用根拠にしない。十分な履歴を使う複数銘柄・fold検証と、事前登録した仮説によるout-of-sample証拠蓄積は次段

### #39 大口フロー代理証拠(`get_futures_flow_context`) ✅ 先物マッピング・ロール異常検出・Volume/OI比率拡張完了
- **目的**: 既存の週次COTに、利用可能ならCME/COMEX/CBOT/NYMEX通貨・金・銀・原油・株価指数先物の出来高、建玉、建玉変化、価格変化を加え、`price up + OI up`とshort covering等の候補を区別する
- **限界**: FX現物に集中取引所の完全な出来高や板は存在しない。先物出来高、TradingView tick volume、COTはいずれも大口動向の代理証拠であり、リアルタイム注文フローや主体別売買と断定しない
- **データ品質**: symbol mapping、取引所タイムゾーン、限月・ロール、公開遅延、改訂、first-seen時刻を保存し、将来公表されたOI/COTを過去判断へ混入させない
- **データ源調査(2026-07-21)**: CME公式のDaily Volume and Open Interest Reportは取引日終了時の速報で、確報は翌営業日のDaily Bulletinで公開される。無認証FTPには最新・日付別XLSXがあるが、速報/確報の版管理、公開時刻、schema安定性をAPI契約として保証しない。DataMine APIとリアルタイムmarket data APIは認証・entitlementを要求するため、資格情報なしのMCP初版で日次OIを推測取得しない
- **初版実装(2026-07-21)**: `OANDA:EURUSD→6E1!`、`USDJPY→6J1!`、`GBPJPY/GBPAUD→6B1!`、`XAUUSD→GC1!`の固定対応だけを受ける。TradingViewの配信契約に応じた`CME`/`CME_DL`、`COMEX`/`COMEX_DL` exchange aliasは同一rootに限って明示許可する。明示したchart indexのexact continuous futures symbolと日足をcontext/OHLCVで二重拘束し、最大5,000本のロード済み確定足を読む。Bar Replay中は現在COTとの時点混在を避けるため拒否し、chart、Pine、注文を変更しない
- **正規化**: 当日を含まない過去5〜250日volumeの平均・母標準偏差からZ-scoreと平均比を計算する。6JはUSDJPY方向へ符号反転し、6Bを使うcrossは`base_currency_single_leg`として保持する。elevated/subduedは参加活発度の記述であり、新規long/shortや主体を断定しない
- **日次OI・4象限拡張(2026-07-24)**: `schemaVersion: "1.1"` / `methodologyVersion: "futures_flow_context_v2"` へ更新。呼び出し元からの `open_interest_data` または対象チャート上にロードされた公式 Open Interest インジケーター (`Open Interest`, 厳格なタイトル/プロットID一致判定かつ arbitrary `plot_0` 誤判定防止策を適用) から日次OIを取得・自動結合。前日比建玉変化 (`openInterestChange`, `openInterestChangeRatio`) を計算し、先物変動 × 建玉変動の `long_build`, `short_build`, `long_unwinding`, `short_covering`, `neutral` 4象限分析を算出。対象銘柄方向の `targetOrientedQuadrant`（USDJPY / 6J1! の逆方向マルチプライヤー `-1` 対応）と原本 `futuresQuadrant` を両立出力し、標本期間全体の分布 (`distribution`) を算出。OI データ非供給/ミスマッチ時は従来どおり `status: "unavailable"` として完全な fail-closed 後方互換性を保持する。
- **マッピング拡張・ロール異常検出・Volume/OI比率(2026-07-25)**: 対象マッピングを FX 主要通貨ペア・クロス足（`AUDUSD→6A1!`, `USDCAD→6C1!`, `USDCHF→6S1!`, `NZDUSD→6N1!`, `EURJPY→6E1!`, `AUDJPY→6A1!`）、株価指数先物（`SPX500USD/US500→ES1!`, `NAS100USD/US100→NQ1!`, `US30USD/US30→YM1!`）、コモディティ先物（`XAGUSD→SI1!`, `WTICOUSD→CL1!`）へ拡張。連続繋ぎ足の限月乗り換えに伴う建玉の単日急変（`roll_anomaly_threshold` 既定20%）を自動検出し `quality.rollAnomalyBars` および `qualityIssues: ["contract_roll_anomaly_detected"]` へ記録。最新出来高と建玉の比率 `volumeOpenInterestRatio` を算出出力。単体テスト (`test/unit/futuresFlowContext.test.mjs`) および E2E テスト (`test/e2e/futures-flow-context.test.mjs`) がパス。
- **OI自動検出の不具合是正(2026-07-25)**: オンチャートOI自動検出が実装以来一度も機能していなかった。プロットはタイトルで一致判定される一方、値の取り出しが `bar.values[plot.id]` だったため、公式studyの `plot_0` / title `Open Interest` という実形では常に `undefined` となり、数値フィルタで全行が落ちて `unavailable` へ静かに縮退していた。既存テストはフィクスチャが `id: "open_interest"` を値キーにも使う実在しない形だったため素通りしていた。タイトル優先・idフォールバックへ修正し、実形(`plot_0` + タイトルキー)の回帰テストを追加。あわせて `limitations` が無条件に「日次OIは利用不可」と述べ、OI取得成功時に同一レスポンス内の象限ラベルと矛盾していた点を、実際の status に従う出力へ是正した
- **供給元の明示指定と深い履歴読み出し(2026-07-25)**: 集計OIインジケーターは公式名の厳格一致に該当せず、数百件のOI値を `open_interest_data` へ会話経由で渡すのも非現実的だったため、`open_interest_study_id` と任意の `open_interest_plot_title` を追加した。明示指定時は自動検出と異なり失敗を握り潰さず送出する(呼出側が選んだstudyなので沈黙は誤りを隠す)。あわせて `get_indicator_values` へ `plot_titles` を追加して上限を500→5,000本へ緩和し、500本超では `plot_titles` を必須化した(全プロット×数千本は利用不能な巨大応答になるため、深い読み出しは対象を明示させる)
- **期近OIは4象限に使用不可と判明(2026-07-25)**: `COMEX_DL:GC1!` 日足5,000本の実機検証で、期近単独OIの象限分布が `long_build` 23.1% / `short_build` 9.7% / `long_unwinding` 37.1% / `short_covering` 29.6% となり、**OI増加日32.8%に対し減少日66.7%**という約2:1の偏りを示した。20年間で建玉が3分の2の日に減り続けることは物理的にあり得ず、原因は期近が満期へ向かって建玉を減衰させるロール機構である(`rollAnomalyBars` 351件、観測の7.0%)。COT総建玉383,368に対し期近OIは193,009(約半分)で、総建玉ではないことも独立に裏付けられた。**期近OIによる象限ラベルは「手仕舞い」ではなくロールを測っている**
- **集計OIの入手と検証(2026-07-25)**: 全限月合算OIを返すコミュニティPine(QuantNomad系)を `open_interest_study_id` で読み、CFTC COT総建玉との独立照合で **383,317 対 383,368(差0.013%)** の一致を確認した。同窓でロール異常は**0件**(期近版351件)、日次増減は **48.8%/50.9%** と均衡し前後半でも安定。ただし**遡及可能な範囲は2022-12-12以降の906本(約3.6年)に限られる**。それ以前はゼロ2,094本や2015年の「1」など破綻値で、当該インジケーターが過去の限月構成を再構成できていない。SDF-Solutions系は330,714でCOT比−14%となり不採用
- **建玉4象限の優位性検証は不成立(2026-07-25)**: 事前登録 `gold-oi-quadrant-continuation-20260725`(sequence 61)。主要検定を「価格上昇日のうち `long_build` と `short_covering` の5日後リターン差、観測ラグ2営業日(CME確報基準)、デッドバンド `|ΔOI|/OI` 0.2%未満除外、最低100件、CIゼロ除外かつ3fold符号一貫」と凍結。結果は差 **+0.186%、95%CI[−0.331%, +0.704%]** でゼロを跨ぎ、fold符号も **+0.93%/−0.15%/−0.02%** と反転して**両基準とも不合格**。個別象限には信頼区間がゼロを除外するセルが多数現れたが、方向調整を戻した実リターンは4象限すべて **+0.35%〜+0.65%** で、同窓の**無条件5日ドリフト +0.486%(CI[0.312%, 0.660%])と区別できない**。金が1,798→4,070ドル(+126%)へ上昇した局面のドリフトを見ていたにすぎず、建玉方向は情報を持たなかった。同一価格方向のペアで差を取る設計が共通ドリフトを相殺して正体を露呈させた。単独セルだけを見ていれば優位性ありと誤認していた
- **建玉4象限の正式検証とジャーナル記録(2026-07-25)**: 手計算では証拠を記録できなかったため `run_external_label_study` を実装し、事前登録 `gold-oi-quadrant-continuation-20260725` に対して正式に流し直した(sequence 62、studyId `sha256:5f905489…`、evidence `sha256:0a1be356…`)。430観測すべてがバー時刻の完全一致で結合し、未一致・曖昧・重複はゼロ。観測ラグ2営業日、horizonは後続観測足(週末で窓が消えないこと)を実機で確認した。結果は主要比較 `long_build` h5 +0.537%(CI +0.236%〜+0.839%)対 `short_covering` h5 +0.351%(CI −0.070%〜+0.772%)、差 +0.186% でCIはゼロを跨ぐ。fold別の差は +0.924% / −0.212% / +0.037% と符号が安定しない。**事前登録の合格基準(CIゼロ除外かつ3fold符号一貫)を両方とも満たさず `inconclusive`**。なお `long_build` 単独のCIはゼロを除外するが、同窓の無条件5日ドリフト +0.486%(CI +0.312%〜+0.660%)と重なるため情報ではない。重複窓除外を適用すると430→82件(各32/17)となり事前登録の最低100件を満たせないため、重複を保持しCIが実効標本より狭いことを警告として明示した
- **日次建玉のfirst-seen蓄積(2026-07-25)**: 建玉は当該取引日の終了後に速報が出て確報へ改訂されるため、後からダウンロードした系列は当時見えていた値ではない。観測ラグで公表遅延は吸収できても改訂は補正できず、記録しておく以外に「その日に何が見えていたか」を復元する手段がない。実質金利で実証済みの追記専用ログ(所有者限定・0600・シンボリックリンク拒否・ロック所有権検証・連番連続性・**初回観測時刻の逆行拒否**)を `src/firstSeenStore.ts` へ抽出し、`realYieldHistory` を載せ替えた(既存7テストを安全網として維持、`acquireFileLock` を直接検証するテストのため委譲を残置)。その上に `src/futuresOpenInterestHistory.ts` を追加。**期近(`front_month`)と全限月合算(`all_months_aggregated`)を別系列として保持**する(同一銘柄でも別量であることが本調査で判明したため混同を構造的に防ぐ)。同一の銘柄・scope・日付について**値が変わった時だけ追記**し、無変更の再読み込みはログを太らせず速報→確報の改訂は残す。`getSeriesAsOf` は各日付について指定時点までに観測された最新値のみを返し、それ以降に初めて見た日付は埋めずに欠落させる。`coverage` で実際の蓄積状況(日数・改訂数・収集開始時刻)を返す。`get_futures_flow_context` が建玉を読むたびに自動記録し、**収集失敗はcontext取得を巻き込まない**(蓄積は副次的便益であり、失っても呼出側の結果を奪わない)
- **COTのfirst-seen蓄積(2026-07-26)**: `CotFirstSeenStore` を追加し、CFTC COTの銘柄・report date・正規化値ハッシュ・初回観測時刻を所有者限定の追記専用JSONLへ記録する。同一版は再読込しても追記せず、値が改訂された場合だけ新しい版を残す。`CotClient` は保存成功時にのみ`available_at`へローカルfirst-seenを返し、`point_in_time_status: observed_first_seen`を明示する。CFTCの公表時刻をreport dateから推測することはせず、収集開始前の履歴は引き続き過去検証に利用できない。保存障害はCOT取得自体を失敗させず、従来どおり`blocked`へ戻す。
- **COT公開スケジュールと観測証跡の分離(2026-07-30)**: `scheduled_available_at`はCFTC通常規則(火曜報告日に対応する金曜15:30 America/New_York)をDST対応で示す予定情報とし、祝日・公表延期・停止は将来、日付付きの公式CFTC通知を例外台帳へ保存してのみ補正する。これはローカルの`available_at`(first-seen)と別物であり、通常規則だけでは過去の公開事実を裏付けない。そのためpoint-in-time研究の適格性は引き続き`available_at`だけで判定し、収集開始前の履歴を遡及利用しない。
- **定期収集CLI・統合coverage(2026-07-26)**: `npm run collect:first-seen` は指定COT銘柄(既定EURUSD/XAUUSD、環境変数または反復`--cot-symbol`で明示)の直近52週と米10年実質金利を収集し、各first-seenログへ追記する。片方の外部取得が失敗しても他系列とcoverageを返し、終了状態を`partial`として監視側へ伝える。`npm run coverage:first-seen` はCOT・実質金利・先物OIを一つのJSONで集計し、日付数、改訂数、最初/最後の観測日を可視化する。OIはTradingViewチャートの明示したインジケーターだけから安全に取得できるため、CLIは蓄積済みOIのcoverage確認に限定する。初回実機ではCOT EURUSD/XAUUSD各250日、実質金利141日、GC合算OI249日で`complete`を確認した。
- **E2Eが収集の欠陥を検出(2026-07-25)**: 記録処理が `futures.observations` を読んでいたが、これは `observation_limit` で切り詰められた表示用配列だった。既定値では**直近20日しか永久に記録されず**、`observation_limit: 0` では**何も記録されないのに成功として報告**されていた。ユニットテストでは検出不能で(モックが返した件数だけ記録されれば通る)、実機E2Eで `observation_limit: 0` を渡して初めて `{recorded:0, unchanged:0, skipped:0}` の矛盾が表面化した。完全な観測列を収集側だけへ渡し応答へ混ぜる前に除去するよう是正。E2Eは収集先を一時ファイルへ切り替えて実運用ログを汚染せず、**建玉を取得できない設定は明示的に失敗**させる(静かにスキップする作りだったことが見逃しの原因だったため)。実機では `observation_limit: 0` でも230件記録、再実行で `unchanged: 230` かつ追記ゼロ、全件で `observation_date <= first_seen_at`・連番連続性・0600 を確認
- **蓄積の限界(明示)**: vintageは**前向きにしか貯まらず、収集開始前の日付は永久に復元できない**。また `get_futures_flow_context` を実行した日しか記録されないため系列に穴が空く。速報→確報の改訂を捉えるには同じ日付を複数回読む必要があり、1日1回の実行では確報しか見えない
- **速報→確報の観測窓(2026-07-31)**: 外部first-seen収集のlaunchd例を平日10:30/22:30 JSTの二回へ変更する。CMEの確報公開時刻を推測して保証するものではなく、同一取引日の値を少なくとも二つの時点で観測し、値が変われば既存の追記専用OIストアへ版として残すための運用上の対処である。heartbeat台帳も次回ジョブからrun間隔を記録する。
- **残タスク**: 認証済みCME日次統計provider (DataMine API / FTP Bulletin 自動取得。DataMineは認証が必要で、認証情報の投入と接続確認は利用者側の作業)、限月・expiry・roll calendar判定、先物現物スプレッド(Basis)追跡、CME確報Volumeとの独立検証、2022-12以前へ遡れる集計OI系列の入手、速報/確報を版として区別する取り込み(現在の記録は「観測した値」であって版の区別を持たない)、実機における複数銘柄（6E, 6J, 6B, 6A, 6C, 6S, 6N, ES, NQ, YM, GC, SI, CL）の継続実地検証。

### #40 セッションプロファイル(`compute_session_profile`) ✅ VWAP・PDH/PDL反動・品質拡張完了

- **目的**: 東京・ロンドン・NY別の高安、値幅、VWAP、出来高、前日高安からの反応を統一計算し、時間帯固有のEntry/Exit仮説を作る
- **契約**: DSTを含むIANA timezone、休日、session境界、volume種別を明示する。FXのtick volumeを取引所実出来高として表示しない
- **評価**: セッション開始からの経過時間、opening range、前sessionとの重なり、拡張率を#36/#37へ渡せる決定論的特徴量として返す
- **初版実装(2026-07-21)**: active chartのexact symbol/minute timeframeを拘束し、Bar Replay中を拒否して最大5,000本のロード済み確定OHLCを読む。1〜8件のIANA timezone sessionを受け、DSTと日跨ぎを現地時刻で処理する。曜日は各barの日付ではなくsession開始日で判定するため、金曜夜から土曜未明へ跨ぐsessionを分断しない
- **結果契約**: session-dayごとのOHLC、値幅、return、opening rangeと拡張率、高安到達分、coverage、volume coverageを集計する。直前sessionとのgapとrange overlapは、そのsessionが現在session開始前に確定済みの場合だけ結合する。形成中足は除外し、欠落足を補間せず、不完全日と不規則timestampを品質情報へ残す
- **volume境界**: `tickVolume`という項目名と`tradingview_bar_volume_unverified_tick_or_exchange_volume`種別を返し、symbolごとのTradingView volumeがFX tickか取引所出来高かを推測しない。全barにvolumeがあるsessionだけ合計し、部分欠落時はnullとcoverageを返す
- **拡張実装(2026-07-24)**: `schemaVersion: "1.1"` / `methodologyVersion: "session_profile_v2"` へ更新。セッション累計VWAP (`vwap`) と終値VWAP離脱率 (`vwapDistanceRatio`) を追加し、出来高欠落時は `null` 安全にフォールバック。前セッション高安 (`previousHigh`, `previousLow`, `previousClose`) と反動・テスト指標 (`testedPreviousHigh`, `testedPreviousLow`, `brokePreviousHigh`, `brokePreviousLow`, `failedPreviousHighBreak`, `failedPreviousLowBreak`) を各観察および `bySession` 出現率へ追加。網羅率低下 (`coverage < 0.5`) を `holidayOrEarlyCloseDetected` として検出・記録。全ユニットテストおよびMCP動作を固定済み

### #41 クロスアセット先行・遅行分析(`run_yield_price_nonconfirmation_study` / `compute_lead_lag_relationships`) ✅ Yield-Price event study・汎用lead/lag走査とも実装

- **目的**: FX、DXY、国債金利、実質金利、金、株価指数を厳密なUTC時刻で整列し、同時相関だけでなくlead/lag候補を検証する
- **安全性**: forward fillせず、休場・更新頻度・公表遅延が異なる系列を区別する。複数lag探索は試行数として記録し、全期間で最良lagを選んだ結果をOOS成績と呼ばない
- **出力**: overlap、欠落、lag別効果、fold安定性、符号反転、データ鮮度を返し、方向予測はAIが他証拠と統合する
- **Yield-Price初版(2026-07-21)**: 2つの明示`chart_index`をtarget/driverへ割り当て、両方のexact symbol/timeframeをchart contextと取得OHLCで二重拘束する読み取り専用event studyを実装した。driverのlookback変化が明示閾値を初めて超えたbarをimpulseとし、そのbarの名目close時刻より前に開始したtarget barを証拠へ使わない。targetとdriverの日足開始時刻が異なってもexact timestamp joinやforward fillを行わず、driver確定後に開始した最初のtarget barから評価する
- **非追随契約**: callerが`direct`/`inverse`関係、driver閾値(元系列のraw unit)、価格breakout lookback、非追随本数、逆方向close break条件、最大driver ageを事前指定する。期待方向のclose breakoutが非追随窓で成立した場合はeventを取消し、その後の限定窓で逆方向の構造close breakが成立した場合だけsignal eventとする。signal足closeは約定仮定ではなく参照価格であり、将来1〜250本の方向調整return/MFE/MAE/target到達を集計する
- **品質・境界**: 形成中足、prior不足、driver確定後のtarget欠落、stale driver、非追随窓不足、期待方向breakout、trigger不成立、重複signalを個別集計する。月足の可変期間は拒否し、Bar Replay中は実時間系列との混在を避けるため拒否する。最大5,000本/系列、event明細200件、fold 12件に制限し、生OHLCは応答しない。これはevent studyであり、コスト、fill、PF、収益性を証明しない
- **horizon時計(2026-07-21)**: 結果horizonは`subsequent_observed_target_bars`であり、calendar gap後の次のtarget足を次の1本として扱う。gapを補間も除外もせず、target/driver別の不規則timestamp件数と品質issueを返す。`horizonClock: observed_market_bars`、`contiguousBarsRequired: false`、`calendarGapsIncluded: true`、`forwardFill: false`を明示し、連続名目足を要求する#36と区別する
- **金利データ源の制約**: `get_real_yield_context`の米10年実質金利はローカルfirst-seenが2026-07-15以降しかなく、それ以前をpoint-in-time backfillできないため長期検証には使用しない。初回実機検証はTradingViewの日次`TVC:US10Y`を名目金利proxyとしてUSDJPYと組み合わせ、公式実質金利による検証とは別物として記録する
- **2ペインDXYゲート(2026-07-23)**: 3画面を作れない実運用環境向けに、固定Pine Study `Bushido DXY Context Gate v1`を追加した。`request.security("TVC:DXY", "D", ...)`内部で確定DXY closeの20日returnを計算し、`gaps_on`・`lookahead_off`で欠損を補完しない。`dxy_gate`は条件成立を`1`、不成立を`0`、未確定・データ不足を`na`として区別する。`run_yield_price_nonconfirmation_study`は任意`context_indicator`で対象USDJPYチャート上の正確なStudy名・plotを検証し、signal開始前に名目close済みの最新gateだけをas-of結合する。future、stale、棄却、利用不能を個別集計し、第3チャートOHLCの`context_regime`とは排他的に扱う。ゲート未指定時の既存2系列契約は維持する
- **2ペインDXYゲート実機E2E(2026-07-23)**: 固定Pineを新規保存・コンパイルし、USDJPY日足へ追加して`dxy_return_20`と`dxy_gate`の`1/0/na`を実値で確認した。USDJPY/US10Y日足2,000本、同一固定定義ではゲートなし111 eventに対し、ゲートあり48 eventとなり、DXY条件不成立66候補を`contextIndicatorRejected`へ分離した。ゲートありの金利上昇failure shortは16件で5本平均+0.073%、金利低下failure longは32件で5本平均-0.060%であり、サンプル・fold不足のため手法採用根拠にはしない。検証用Studyを削除し、EURUSD/XAUUSD 60分と既存5 Studyの復元を照合済み
- **DXY極性・3fold深掘り(2026-07-23)**: `context_indicator.accepted_gate_value`を追加し、既定`1`で互換性を保ちながらDXY 20日returnの上昇側`1`と低下側`0`を同じPine・as-of契約で対称評価できるようにした。固定3foldを2018-2020、2021-2023上期、2023下期-2026上期として比較した結果、唯一の継続候補は金利上昇failure shortの5本horizonだった。DXY上昇側16件は平均+0.073%、低下側24件は-0.305%、ゲートなし40件は-0.154%だったが、上昇側中央値は-0.181%、positive rateは31.3%に留まった。上昇側fold平均は+0.033% / -0.293% / +0.549%で符号不安定、20,000回bootstrapの上昇側平均95%区間は-0.359%〜+0.525%、上昇側−低下側の平均差+0.379%の95%区間も-0.237%〜+0.999%と0を跨いだ。long側も5本fold符号が負/正/負で、極性による安定化は確認できない。売買ルールとしては不採用とし、未使用期間で事前登録した前向き収集を行い、各方向・foldで十分な件数、コスト控除後の正期待、CI下限>0、パラメータ近傍安定性を満たした場合のみ再評価する
- **マルチラグLead/Lag拡張(2026-07-25)**: `schemaVersion: "1.1"` / `methodologyVersion: "yield_price_nonconfirmation_event_study_v2"` へ更新。ドライバーインパルス確定後のターゲット観察シフト幅 `driver_lag_bars` (0〜20) およびパラメーター・ラグ試行総数 `configuration_trials` を追加。点推定・信頼区間の無調整に対する警告 `inferenceWarnings` と、参照用Bonferroni補正アルファ `bonferroniAdjustedAlphaReference` (`0.05 / configuration_trials`) を決定論的に算出・出力。ドライバー鮮度 `driverAge` はラグシフト前の `baseTargetIndex` 起点で判定し、`driver_lag_bars` 増加による誤った `staleDriverEvidence` 棄却を排除。本機能は1回の呼び出しで1つのラグを指定する単一ラグ評価契約であり、複数ラグの横断探索は呼び出し側が `driver_lag_bars` を変えながら繰り返し実行し、その試行総数を `configuration_trials` に申告する運用を前提とする（自動クロス相関スキャンは対象外）。単体テスト（`test/unit/yieldPriceNonconfirmation.test.mjs`）およびMCPツール連携テスト（`test/unit/server.test.mjs`）がパス。
- **汎用lead/lag走査(2026-07-25)**: event studyとは別母集団の記述的分析として `compute_lead_lag_relationships` を追加した(`exact_timestamp_lead_lag_return_correlation_v1`)。2つの明示チャートの確定足close-to-close log returnを厳密なUTC時刻一致で結合し(forward fillなし、形成中足は除外)、`-max_lag_bars`〜`+max_lag_bars`の全ラグについて相関、Fisher z信頼区間、fold別相関と符号安定性(`foldStability.signStable`)を返す。ラグ符号の意味を契約として固定し、正のラグ(先行するreference returnと後続のprimary returnの対)だけを`tradableOnPrimary: true`とする。負のラグはprimary先行であり、primaryの売買には使えないことを明示する。**最良ラグの自動選択とランキングは実装しない**(`automaticLagSelection: false` / `ranking: false`)。走査したグリッドの極値を選んでその区間をOOS成績と呼ぶのは本契約が防ぐべき多重比較の誤りそのものであるため、全ラグを等しく返す。走査ラグ数×申告`configuration_trials`からBonferroni参考αを算出するが区間へは適用しない。完全共線のペアは`degenerate_correlation`として小標本と区別する。純関数テスト9件(planted lead検出、負ラグ非可用ラベル、全ラグ返却と最良ラグ非選択、Bonferroni参考α、exact join・非forward fill、形成中足除外、最小観測数、fold符号反転の検出、fold重複/範囲外拒否)とMCP統合テスト2件(束縛・生OHLC非返却、ペイン同一/銘柄不一致/Bar Replay拒否)で固定した
- **検証状況**: 日足開始時刻が22時間ずれたsynthetic系列でdirect yield-up failure、driver確定前target除外、期待方向breakout取消、inverse関係、MFE/MAEの0下限を純粋テストへ固定した。公開MCP経路でも2chart拘束、並列OHLC取得、as-of join、short eventを固定した。実機E2EはUSDJPY/US10Y日足を各約5,000本ロードし、固定定義で722 impulse、191 eventを取得した。金利上昇failureのshort 90件は1/5/10/20本の平均方向調整returnがすべて負で棄却。金利低下failureのlong 101件は全体5本平均+0.166%だったが、前半fold +0.056%に対して後半+0.362%、10/20本は前半負・後半正と不安定なため未採用とした。両ペインのsymbol/timeframe/Studyは元へ復元済み。

### #42 仮説・実験ジャーナル(`register_strategy_hypothesis` / `record_strategy_experiment` / `compare_strategy_experiments`) ✅ 実装・実機検証完了

- **目的**: 仮説、変更理由、ベースライン、事前評価契約、実験結果、採否、次の変更をappend-onlyで結び、同じデータを繰り返し見た研究者自由度を可視化する
- **識別**: hypothesis ID、experiment ID、親実験ID、definition hash、Pine版、dataset/evidence hash、methodology versionを保存する。同じIDへの異なる定義上書きやOOS結果の削除を拒否する
- **比較**: 同一契約の実験だけを自動比較し、IS、OOS、walk-forward、stress、liveを列として分離する。異なるコスト、期間、symbol/timeframe、methodologyを無言でランキングしない
- **保存境界**: 既存のライブ分析ジャーナルとは別のローカルJSONLを使い、OHLC原本、認証情報、口座情報を保存しない。ロック、stale lock回収、所有権、原子的追記は既存ジャーナル実装を流用する
- **実装(2026-07-20)**: `TRADINGVIEW_MCP_STRATEGY_RESEARCH_JOURNAL_PATH`または`~/.tradingview-mcp/strategy-research-journal.jsonl`へ、仮説登録と実験記録をsequence付きappend-only eventとして保存する。仮説は事前population、primary metric、最低取引数、対象symbol/timeframe、任意PF/DD guardrailを固定する。同一hypothesis IDの異定義上書きを拒否する
- **実験識別**: #32のdefinition hashである`experiment_id`と、両ledger ID、既知metrics、population、methodology、context、guardrailから計算する`evidence_hash`の組で一意化する。同じ定義を期間延長後に再実行した証拠は別eventとして残し、同じ証拠の異内容上書きを拒否する。親実験・親仮説は既に記録済みの場合だけ参照できる
- **比較**: 2〜20件の正確な`experiment_id + evidence_hash`参照だけを読み、同一hypothesis、population、symbol/timeframe、methodology、条件一致を比較契約とする。不一致をランキングせず`incompatibilities`へ返す。単一スコアを生成せず、保存したbaseline/candidate指標と採否をそのまま返す
- **保存安全性**: ディレクトリ0700、ファイル/lock 0600、owner・regular file・symlink拒否、64MiB/1行64KiB上限、fsync、プロセス内直列化、O_EXCL lock、60秒超かつowner PID不在時だけのstale回収を実装した。再読込時にevent ID、連番、親子順序、definition/evidence hashを再計算する。OHLC、Pine source、認証・口座情報、任意metric名は保存しない
- **検証状況**: 仮説の冪等登録と定義衝突、孤立実験拒否、同一実験の複数証拠、同一証拠の冪等性、未知metric拒否、symlink拒否、0600、比較互換性、3 MCPツールのチャート非アクセスを固定した
- **実機検証(2026-07-20)**: `next-bar-confirmation`仮説をsequence 1、方向確認になっていなかったSmart Money v2実験をsequence 2、シグナル足高安の外側で終値確定するよう直したv3実験を親子関係付きsequence 3として記録した。v2 evidenceは`sha256:82fcbd87e89914904150d2d7fc4adf51858608a294868ba1562446ed1823e943`、v3 evidenceは`sha256:4b78d80ae673ea122f3c20f1f6a8a310d1355081bbed233c069ed1ea36775b74`。正確な2参照による比較は`comparable: true`、不一致なしを返した
- **実機判断**: v3の確認ONは取引数を72から37へ減らし最大DDを約5844から約3235へ抑えたが、期待値は約115.09から約6.41、PFは約1.459から約1.021へ低下した。最低37取引は満たす一方、事前PF下限1.2を割ったため候補を`rejected`として保存した。APIのmetric名は保存契約どおり`totalTrades`、`averageDurationMilliseconds`、`averageRunUp`等のcamelCaseを使う
- **イベント研究ジャーナル(2026-07-23)**: Strategy Tester台帳のPF/expectancy契約へevent studyの方向調整returnを無理に格納せず、同じappend-only・owner-only JSONL内で種別を分離した。`register_event_study_hypothesis`は主指標(mean/median directional return、positive rate、target-hit rate)、horizon、最低event数、対象市場を凍結する。`run_market_event_study`の任意`journal`指定は、計算済みの条件定義hash、取得範囲、branch/horizon集計、品質問題、判断をサーバー側で自動追記する。`get_event_study_journal`は一覧または正確なstudy/evidence参照の比較を行い、仮説、population、市場、時間足、methodology、condition definitionが異なる記録を`comparable:false`として混在させない。GBPUSD 60分のSession Handoff Exhaustion実機で、19 event・minimum 20未達・`inconclusive`判断を定義hash/evidence hash付きで記録し、終了後はXAUUSD 60分へ復元した

### #43 セッション引き継ぎ失速イベント(`run_market_event_study` condition: `session_exhaustion_handoff`) ✅ 初版実装

- **目的**: 東京・Londonで出た方向性がNew York開始時に継続せず、失速・利食い・巻き戻しへ転じる候補を、売買Strategy化前のevent studyとして検証する。既存`session_auction`は単一session内のrange break/failed auction専用であり、先行sessionから後続sessionへの状態引き継ぎを直接表現できない
- **初版実装(2026-07-22)**: `run_market_event_study`へ`session_exhaustion_handoff`を追加。1〜4件の先行session、handoff session、先行方向判定(`session_return`、終値位置`close_location`、先頭先行session rangeを後続終値が抜く`range_break`)、初期窓1〜24本、順方向更新幅、range内回帰・逆方向bodyの要否、coverage、horizon、target bps、fold、configuration trialsを構造化JSONで受ける。任意コードや自由記述DSLは実行しない
- **point-in-time契約**: 先行session rangeと方向はhandoff session開始前に確定済みのclosed barsだけで計算する。設定したhandoff初期窓を最後まで観測して順方向更新なしを確定し、窓の最終確定足をevent referenceとする。約定fillとはみなさない。形成中足、coverage不足、順方向更新、同じ初期窓内の順方向更新+逆方向回帰は、明示的な品質理由として除外する。日跨ぎ先行sessionはhandoff日の前日開始としてDST対応IANA timezone上で結合する
- **出力**: `exhaustion_up`/`exhaustion_down`別・horizon別の反転方向調整return、MFE/MAE、positive rate、target到達率、fold別集計、coverage/除外理由、試行数、任意regime結合を返す。PF、ランキング、自動採用、売買推奨は返さない
- **実機E2E(2026-07-22)**: EURUSD 60分足へ5,000本(2025-10-01〜2026-07-22)を明示ロードし、`America/New_York`基準のTokyo 19:00〜00:00、London 03:00〜08:00、NY handoff 08:00〜11:00を固定した。両先行sessionのrange内終値位置75%以上を方向とし、handoff先頭3本でrange再進入かつ逆方向body、先行range方向の更新なしを反転条件にした。DST前のsignalはUTC 13:00、DST後はUTC 12:00となり、現地08:00の所有権を保った。EURUSDは20 event(先行down→long 15、先行up→short 5)を取得し、4時間後のdown→long平均は+0.0925%(95%区間+0.0036%〜+0.1813%)だったが、up→shortは区間がゼロを跨ぎ、分岐別標本も小さい。XAUUSDも60分足5,000本(2025-09-16〜2026-07-22)で同一契約を実行し32 event(先行up→short 20、先行down→long 12)を取得したが、4時間後の平均は各+0.0726%/+0.1499%、8時間後は各-0.1705%/+0.2307%で、全て95%区間がゼロを跨いだ。XAUUSDは16時間horizonが連続足契約を満たす観測0件となり、日中セッション不連続をまたぐ長いhorizonを暗黙評価しないことも確認した。両市場で先行/handoff coverage不足各1件を補間せず`partial`へ残した。設定探索、約定、PFの根拠にはしない
- **検証状況**: 先行closed-bar限定、反転方向、順方向更新+逆方向回帰のambiguous除外、日跨ぎ先行session、MCP chart binding、raw OHLC非返却を単体・MCP統合テストで固定した。EURUSD/XAUUSDでDST・不連続履歴を含む60分足E2Eを完了した
- **研究上の注意**: この条件はSession-Selective Dual Routerの排他session検証でNY単独の弱さを見た後に発案したため、discovery期間内の良好値を採用根拠にしない。仮説登録、configuration trials、OOS初回閲覧時刻を#42へ記録する
- **評価起点の訂正(2026-07-26)**: 初版v1は3本窓の全バーを見て順方向更新の有無を判定しながら、最初の反転バーをsignal時刻としてforward outcomeを測っていた。反転後のバーを除外条件に使うため短期結果へ未来情報が混入し得ることを実機の包含対照で検出した。v2はsignal時刻・参照価格を窓の最終確定足へ移し、`decisionTiming: "after_complete_handoff_window"`を返す。handoffを含む複合条件も旧結果と混在しないようmethodology v3へ分離した。研究系`studyId`にもmethodology version・symbol・timeframeを含め、新旧方法論や別市場が同一IDへ衝突しないようにした。旧v1のEURUSD/XAUUSD/GBPUSD/AUDUSD/NZDUSD結果は履歴として保持するが、採用・収益性・再現性の根拠には使用しない
- **訂正後の探索的再検証(2026-07-26)**: 将来情報を使わない1本窓を暫定対照としてEURUSD/NZDUSD 60分で再計算した。EURUSDの先行down→longは1時間後平均-0.37bps(n=22、95%区間-5.39〜+4.65bps)、NZDUSDは+2.70bps(n=18、95%区間-2.07〜+7.48bps)となり、いずれもゼロを跨いだ。NZDUSD最新foldは-2.34bps、EURUSD最新foldは-5.37bpsで、旧v1の短期優位は維持されなかった。追加探索であり採用判定には使わない
- **v2事前登録OOS・4市場実機検証(2026-07-26)**: `session-handoff-v2-cross-market-20260726`としてEURUSD/NZDUSD/GBPUSD/XAUUSDの60分足、各5,000本、Tokyo 19:00〜00:00 + London 03:00〜08:00、NY handoff 08:00〜11:00、3本窓、horizon 1/4/8、3つの時系列fold、10 trials、主要horizon 4本、最低20 eventを事前固定した。EURUSDは20 eventで、4本後平均は先行down→long -0.69bps(n=15)、先行up→short -1.29bps(n=5)となり、いずれも区間はゼロを跨いだ。NZDUSDは23 eventで、先行down→longが4本後 -14.11bps(n=13、95%区間 -23.34〜-4.87bps)、8本後 -19.59bps(n=11、-33.90〜-5.29bps)と仮説の反対方向へ偏り、4本foldも -2.51/-15.32/-27.53bpsだった。GBPUSDは19 eventで最低件数未達、4本後はdown→long -2.78bps(n=13)、up→short -4.95bps(n=6)で両区間がゼロを跨いだ。XAUUSDは30 eventで、up→short 4本後 +14.51bps(n=18、-9.09〜+38.11bps)、down→long -35.65bps(n=10、-106.92〜+35.62bps)と分岐が逆方向かつ不安定だった。4市場に共通する反転優位はなく、約定・コスト・PF評価へ進める採用根拠は形成されなかったため、全記録を`inconclusive`とした
- **研究ID訂正台帳(2026-07-26)**: append-only journalのsequence 68〜70は、当時の`studyId`がmethodology・symbol・timeframeを含まず、EURUSDとNZDUSDが同一IDへ衝突したため意思決定証拠から除外する。修正後に同一データ・同一定義を再実行したsequence 71〜74を権威レコードとする。対応する`studyId`はXAUUSD `sha256:1a9513e0…`、EURUSD `sha256:f1b18071…`、NZDUSD `sha256:8a415d58…`、GBPUSD `sha256:3ffb0aae…`で、全て銘柄別に分離された。旧レコードは監査履歴として削除しない

### #44 Price Action: Failed Breakoutイベント(`run_market_event_study` condition: `failed_breakout`) ✅ 初版実装

- **目的**: 主観的な「liquidity sweep」や「failed breakout」を、再現可能なclosed-barイベントとして反証可能にする。セッション範囲の外へ一度出た後に終値で範囲内へ戻る動きが、反対方向への短期継続を伴うかだけを測る。売買約定、SMCラベル、裁量判断は含めない
- **初版実装(2026-07-24)**: `run_market_event_study`へ`failed_breakout`を追加。IANA timezone、同一local dayの`range_start < range_end < failure_end`、range coverage、0〜4本の確認足、horizon、target bps、fold、configuration trials、任意regime splitを構造化入力で受ける。範囲完成後の最初の外側touchだけを評価し、上抜け後の内側終値はshort候補、下抜け後の内側終値はlong候補とする
- **point-in-time契約**: rangeはsignal前のclosed barsのみ。sweep足はrange外へtradeしたうえ同じ足の終値がrange内でなければならない。確認を有効にした場合、続く各closed barがsweepと反対方向に直前終値を更新した時だけ、その最後の確認足をsignal referenceにする。同じsweep足でrange上・下の両方を抜いた場合、一日内の二件目以降のsweep、coverage不足、形成中足は明示的に除外する
- **出力**: `failed_breakout_up`/`failed_breakout_down`別の方向調整forward return、MFE/MAE、target到達率、fold別集計、除外理由、任意のpoint-in-time regime結合を返す。signal bar closeは約定ではなくevent referenceであり、PF、最適化、採用判定、注文は返さない
- **検証状況**: 純関数テストで上抜け失敗→short、下抜け失敗→long、両側sweep除外、確認失敗除外、confirmation=0を固定。MCP統合テストでactive-chart bindingとraw OHLC非返却を確認。実機ではEURUSD/XAUUSDの十分な履歴を対象に、事前登録後の未使用foldで評価する
- **EURUSD実機初回(2026-07-24)**: `eurusd-ny-asia-failed-breakout-20260724`として、EURUSD 60分・`America/New_York`の00:00-05:00 range、05:00-12:00 sweep窓、確認1本、horizon 1/4/12を事前登録した。初回3,318本では38 eventで最低50未達。追加ロード後、直近5,000本(2025-10-03〜2026-07-24)では51 eventとなったが、4時間後は上抜け失敗→short 23件の平均+0.0197%(95%区間 -0.0724%〜+0.1118%)、下抜け失敗→long 28件の平均-0.0115%(-0.0528%〜+0.0298%)で、いずれもゼロをまたいだ。2026-03以降foldでも両分岐はマイナスであり、`inconclusive`としてappend-only journalへ記録した。コスト、約定、未使用OOS、銘柄横断の検証前に採用しない
- **XAUUSD横断検証(2026-07-24)**: 同じ凍結定義を`xauusd-ny-asia-failed-breakout-20260724`として別仮説に登録し、XAUUSD 60分・直近5,000本で実行した。59 event(上抜け失敗→short 29、下抜け失敗→long 30)を得たが、4時間後平均は順に+0.0288%(95%区間 -0.2866%〜+0.3443%)、-0.1125%(-0.5380%〜+0.3130%)で、ともにゼロをまたいだ。2025-11〜2026-03 foldでは両分岐がマイナス、直近foldは上抜け失敗のみ小幅プラスで一貫しない。range coverage不足1日を補間せず`partial`とし、ジャーナルへ`inconclusive`で記録。EURUSDと合わせても採用根拠なし
- **XAUUSD 30分初回(2026-07-24)**: 60分と区別した`xauusd-ny-asia-failed-breakout-30m-20260724`を事前登録し、同一時刻契約・確認1本で実行。5,000 closed-bar近傍(2026-02-12以降)では31 eventで最低50未達。4時間相当(8 bars)の上抜け失敗→shortは10件で平均+0.3132%(95%区間 -0.1005%〜+0.7269%)、下抜け失敗→longは20件で平均-0.1881%(-0.4644%〜+0.0881%)。後者は後半2 foldで連続マイナス、前者も標本不足。`configuration_trials: 2`を明示し、coverage不足1日を残したまま`inconclusive`で記録。検証後、チャートは60分へ復元した

### 新手法研究基盤の推奨実装順

1. **#31 全取引台帳**で集計値の内訳と失敗原因を観測可能にする
2. **#32 ベースライン対候補実験**で1回の改善を再現可能にする
3. **#42 仮説・実験ジャーナル**を早期に入れ、以後の探索回数と証拠を失わない
4. **#33 一括バックテスト**で複数市場・時間足へ反証範囲を広げる
5. **#34 walk-forward**と**#35 研究プロトコル・頑健性**を採用ゲートにする
6. **#36 イベントスタディ**、**#37 レジーム**、**#38 特徴量関係**で新しい仮説の探索力を増やす
7. **#39 大口フロー**、**#40 セッション**、**#41 クロスアセット**はデータ源とpoint-in-time品質を確認できたものから追加する

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

### #45 合成ヌルによる falsification audit(優先度: 最高)

- **課題**: 今セッションで判定した50件は inconclusive 43・rejected 7・adopted 0 だった。これが健全な除外の結果なのか、そもそも採用基準が緩すぎる/厳しすぎるのかを、実データだけでは判定できない。[Spurious Predictability in Financial Machine Learning (2026)](https://arxiv.org/html/2604.15531v1) は、予測可能性ゼロの白色ノイズに対して探索候補数Kを1〜1,000で振ると、K=100でin-sample t値2.79に対しwalk-forward 0.82、K=1,000で3.48に対し0.80、Backtest Inflation Factorが約3.3倍に達することを示した。**データリークが一切なくても選択バイアスだけで見かけの成績が2〜3倍に膨らむ**。この膨張が自分たちのパイプラインでどの程度起きるかを測っていない
- **設計**: 白色ノイズ、レジーム切替ボラティリティ、bid-askバウンス、ファクターヌルの4種で人工OHLCを生成し、既存の研究ツール(`run_market_event_study` 各条件、`compute_feature_outcome_relationships`、`compute_lead_lag_relationships`、`run_yield_price_nonconfirmation_study`)へ流す。**探索・fold分割・レジーム結合・信頼区間・多重度警告をすべて通した状態で**、無予測系列から「候補」が何件出るかを数える。名目αに対する実測の超過が、そのまま採用基準の校正値になる。合成データなのでチャートもTradingViewも不要で、`build/` へ直接流せる
- **判定**: 名目α通りの頻度に収まればツールチェーンは信用できる。超過するなら、超過分がどの段階(fold分割、レジーム結合、区間推定のいずれか)で生まれているかを切り分ける
- **規模**: 中。新規の合成データ生成モジュールとユニットテスト。実装コストは低く、以後すべての結論の土台になるため費用対効果が最も高い
- **実装(2026-07-27)**: `syntheticNullSeries.ts` に単一系列3模型とファクターペアを、`falsificationAudit.ts` に単一系列版・ペア版のランナーを実装した。判定規則は呼出側が渡す設計とした。監査対象は「区間」ではなく**探索・fold分割・レジーム結合・区間・符号規則を通した判定経路全体**だからである。観測率の区間はゼロ近傍で正規近似が崩れるため Wilson を用い、名目αが区間の下限を下回るときだけ超過と判定する。失敗した複製は「非候補」に数えず別途報告する(失敗は不在の証拠ではない)。生成条件は実効値で結果へ記録し、候補率が結果だけで再現できるようにした
- **ヌルの契約(2026-07-27)**: 監査対象の研究は `close_end / close_signal - 1` の**単純リターン**で結果を評価するため、ヌルも単純リターン基準で置き、**価格そのものをマルチンゲール**とした。当初これを対数リターン基準にしたところ、条件付き単純リターン平均が σ²/2 となり、レジーム切替下ではボラ状態が自己相関するため「過去の高ボラ」を検出する特徴量が正のリターンを予測できてしまった。実測で高ボラ五分位と低ボラ五分位の差が **+0.2492%**(5バー)に達し、これは実測XAUUSDの5日ドリフト +0.215% と同規模である。**ヌルの中に本物と同規模のedgeが入っていた**ため校正には使えず、伊藤補正を戻して解消した
- **実測: リード・ラグ(2026-07-27)**: ファクターヌル(ρ=0.33)5,000バー・400複製、maxLag 10・3fold・95%区間。判定規則ごとの候補発生率は、**区間のみ 40.3%**[35.6, 45.1]、**区間+fold符号一致 33.8%**[29.3, 38.5]、**Bonferroni参考α+fold符号一致 3.0%**[1.7, 5.2]。名目5%に対し **今日の判定規則は約6.8倍に膨張**する。21ラグ中ゼロを除外する本数は平均1.95本(名目5%なら期待1.05本)。銅/金でラグ6が事前基準3つを満たした際にノイズと判断したが、**同じ判定は無予測系列でも3回に1回発火する**ことが定量的に裏づけられた
- **実測: 特徴量研究(2026-07-27)**: レジーム切替ボラ4,000バー・200複製、3fold。`compute_feature_outcome_relationships` は信頼区間を返さないため「fold全てで符号一致」を判定に用いると、**特徴量1個で 63.0%**、**6個すべてで 97.0%**[93.6, 98.6]の候補率となる。効果量下限0.2%を課しても 93.5% にしか下がらない。6特徴量×約3バケット×2horizon=36通りを走査し、3fold符号一致の単発確率が約1/4であるため、ほぼ確実に当たる。**fold符号一致は単独では選別能力がほぼゼロ**である
- **処方(2026-07-27)**: (a) `compute_feature_outcome_relationships` に信頼区間を追加する。校正可能な判定規則を作る前提であり最優先。(b) スキャン系では Bonferroni 参考αを参考でなく**判定に用いる**。リード・ラグで 33.8% → 3.0% の実測がある。(c) **fold符号一致を単独の採用根拠にしない**。36通り走査時の発火率97%を基準として残す。なお (b) の実測は名目Bonferroniでちょうど名目α近傍へ着地しており、少なくともこの設定では #46 の K_eff による緩和は不要かごくわずかである
- **実装(2026-07-28)**: `compute_feature_outcome_relationships` は forward return の正規近似平均区間と陽性率の Wilson 区間を全体・bucket・選択コントラスト・foldへ返すようにした。`compute_lead_lag_relationships` は `全lag数 × configuration_trials` を Bonferroni family とし、Fisher z の両側 p 値から `passesBonferroni` を各lagへ返す。ジャーナルへ記録できるのは、正のlagかつこのゲートを通過したものだけとした。通過は前向き仮説化の統計的適格性に過ぎず、out-of-sample証拠や売買シグナルではない
- **実装(2026-07-28)**: FVG retest と session auction を `eventStudyFalsificationAudit.ts` で合成ヌルへ接続した。候補規約は対象branch・horizon・最小イベント数・fold数を記録し、**globalの平均信頼区間下限が0を上回ること**を主証拠、全foldの正符号を補強証拠とする。foldだけで採用しない。合成系列のfold境界は各複製の実バー時刻から等分して作るため、実データの特定日付を固定して監査を空振りさせない。現時点では純関数の監査アダプタであり、MCP公開や実行CLIは実測の標準設定を凍結してから追加する
- **実装(2026-07-28)**: 標準ランナーを `event_study_falsification_audit_standard_v1` として凍結し、既定を「3模型を別々に、各400複製・5,000本・名目α 5%・3fold」とした。`run_event_study_falsification_audit` はチャート非依存・読み取り専用で公開し、`npm run audit:event-studies -- --config FILE` は同じランナーをローカルJSON定義から実行する。模型は異なるヌル仮定なので候補率を合算しない。監査は研究定義と候補規約を記録するが、収益性・実運用優位・売買可否を判定しない
- **実装(2026-07-28)**: `event_aftershock_retest` を同じ監査へ接続した。実経済イベントの実日付を合成ヌルへ混ぜず、`firstBar`・`everyBars`・`maximumEvents`から各生成系列内の外生イベント時刻を決定する。この相対スケジュールも結果へ記録する。実イベント間隔の季節性、同時発表、ニュース内容はこのヌルが再現しないため、監査が校正するのは指定した検出・outcome・fold規約だけである
- **実装(2026-07-28)**: `failed_breakout`、`session_exhaustion_handoff`、`composite_condition` を同一系列3模型の監査へ接続した。Compositeは条件DSL全体を凍結定義として渡すため、監査後に条件・operator・alignmentを差し替えることはできない。`yield_price_nonconfirmation`はtarget/driverの同時相関だけを持ち、lagged predictabilityを含まないfactor pairで校正する。金利公表時刻・revision・carry・異なるtimeframeはこのpairが再現しないため、対象は検出/結合/outcome/fold判定経路に限定される。非追随のglobal directional returnにも他event studyと同じ平均CIを追加した
- **校正分母の訂正(2026-07-28)**: 合成系列の生成成功と、凍結した候補規約を評価できるだけのevent/品質が得られることは別である。従来はstudyが`partial`のdrawを候補falseへ畳み、候補率を過小評価していた。監査ランナーを`candidate`/`non_candidate`/`not_evaluable`の3値へ変更し、`notEvaluableSeeds`を明示、`evaluated`だけを候補率・Wilson区間の分母とした。生成例外は従来どおり`failed`であり、どちらも不正に棄却数へ数えない
- **Handoff監査の性能是正と校正(2026-07-28)**: `session_exhaustion_handoff`は各handoff日について全履歴を再走査しており、5,000本×400反復×3模型の監査を現実的に完走できなかった。local dateごとのMapを一度作り、handoff日と前日だけを候補集合にすることで日付走査をO(N)へ是正した。日跨ぎAsia・当日London・DSTの既存契約はテストで維持。EURUSD 60分の事前登録v2契約(Tokyo/London→NY、3本窓、主要horizon 4、minimum 20、3fold相当の研究定義)で400複製・5,000本を実行し、`exhaustion_down`候補率はwhite noise **1.75%** [0.85%, 3.57%]、regime-switching volatility **0.75%** [0.26%, 2.18%]、bid-ask bounce **0.75%** [0.26%, 2.18%]だった。全400 drawが評価可能・失敗0で、いずれも名目5%超過なし。これは規約の雑音耐性だけを示し、実データで優位性を示すものではない
- **Feature scanのBonferroni判定化(2026-07-28)**: `compute_feature_outcome_relationships`は、MCPで受けていたが純関数へ渡していなかった`configuration_trials`を定義・推論へ接続した。feature selectionなしでは固定bucket数×horizon×trial、selectionありでは1 bucket×horizon×trialをfamilyとし、各global forward returnに両側p値、調整p値、adjusted α、`passesBonferroni`を返す。foldと後付けselection contrastは独立検定ではないため通過判定を持たない。通過は前向き仮説化の統計的適格性に留まり、serial dependence、OOS、収益性を保証しない
- **Feature scanの系列相関対策・第1段階(2026-07-28)**: 各bucket/horizonへ、future-return窓が重ならない最古信号優先の系列を追加した。候補適格性はこの系列の`horizon=1`のみで、最小標本数とBonferroni通過を同時に満たす場合だけ`candidateEligible: true`とする。通常の全観測集計は探索証跡として残す。非重複化はoverlapping-returnを除くのみで、残余自己相関に頑健な標準誤差ではないため、Newey-West/HAC推論は別課題として残す
- **Feature scanの系列相関対策・第2段階(2026-07-28)**: 非重複系列にNewey-West/Bartlett HAC区間を追加し、ラグは探索入力にせず`floor(4(n/100)^(2/9))`を標本サイズから決定する。候補適格性は通常区間ではなく、このHAC推論の`horizon=1`で判定する。HACは有限標本・非定常性・レジーム変化を解決せず、OOS検証も別途必要
- **Feature scanのHAC合成ヌル監査(2026-07-28)**: `run_feature_outcome_falsification_audit`を追加した。凍結したfeature/bucket/horizon familyを白色雑音・レジーム転換ボラ・bid-ask bounceへ個別に適用し、`horizon=1`の非重複Newey-West+Bonferroni候補率を記録する。評価不能な複製は非候補扱いにせず分母から除外し、モデル別の率はpoolしない
- **Feature scan校正の実測(2026-07-28)**: 6特徴量・4,000バー・200複製・3foldで各段階を測った。**律速は多重度ではなく系列相関だった**。horizonを振って切り分けると、重複ありのBonferroni判定は horizon [1] 7.0%、[5] 61.5%、[21] 86.0%、[5,21] 87.5% と**horizonを伸ばすほど劣化**する。連続バーから測る21バー先リターンは20バーぶん重なり、独立を仮定した標準誤差を約√21≒4.6倍過小評価するためで、familyTests=36のBonferroniでは到底埋まらない。lead-lagで同じ補正が33.8%→3.0%と効いたのは1バーリターンで重複がなかったからであり、**同じ処方が同じように効くとは限らない**。非重複化+Newey-Westを入れると horizon [1] 14.0%、[5] 13.5%、[21] 12.0%、[5,21] 16.0% と**horizon依存が消える**。切り分けが正しかったことを示す
- **Feature scan採用ゲートの校正値(2026-07-28)**: 上記の12〜16%は`passesBonferroni`単体の率であり、実際の採用ゲート`candidateEligible`ではない。ゲートは非重複系列・Newey-West・Bonferroni通過に加えて`horizon=1`と最小標本数を要求する。horizons [1,5,21] を与えて`candidateEligible`を測ると、white noise **2.0%** [0.8, 5.0]、regime-switching volatility **1.5%** [0.5, 4.3]、bid-ask bounce **2.5%** [1.1, 5.7]。全600 drawが評価可能・失敗0で、**3模型とも名目5%を超えない**。当初の「fold符号一致のみ」97.0%から、同一の合成ヌル上で約40倍改善したことになる。これは規約の雑音耐性のみを示し、実データでの優位性・OOS・収益性は保証しない
- **Feature scan採用ゲートの再校正と保留化(2026-07-28)**: white noise 200複製・4,000バーの再計測では、`horizon=1`の非重複+Newey-Westが**14.0% [9.9, 19.5]**、`horizon=5/21`も12〜16%となり名目5%を上回った。異なるbar数・horizon family・decision rule間の数値は直接比較できず、先行する低率だけで一般的な校正済みとは言えない。このためHAC+Bonferroni通過は`exploratoryEligible`へ格下げし、`candidateEligible`は一致するempirical-null監査のレビューまで常にfalseとする。次段階は元バー時刻を保つblock bootstrapまたは対応する経験的ヌル分布を、凍結定義へ時点結合すること
- **Feature scan empirical-null block bootstrap(実装, 2026-07-29)**: `compute_feature_outcome_relationships`の明示的な`empirical_null_calibration: true`で、同じ確定OHLC・時刻窓・regime・feature定義に対する`feature_outcome_empirical_null_circular_moving_block_v2`を実行する。反復1,000、seed 20260729、block長`floor(cuberoot(reference eligible observations))`・最小2を固定し、呼出側の調整項目にしない。元バー時刻とfeature labelを固定したまま、horizon 1の将来returnを選択前の同一signal-window/regime母集団から循環moving blockで再標本化する。各反復では、最小標本数を満たし有限なstudentized meanを持つ観測済みbucketだけの最大絶対統計量を帰無分布とし、候補になれないbucketはfamily maximumから除外して件数を報告する。SE=0のbucketは無音の有限番兵へ置換せず`insufficient_sample`とする。`candidateEligible`は従来の非重複Newey-West・Bonferroni・最低件数に加え、このempirical p値が名目α以下の場合だけtrueとなる。OHLC内容hashと定義・固定校正契約から`calibrationId`を作るため、別期間・別閾値の校正を流用できない。単調な無条件ドリフトを候補化しない回帰テスト、特徴固有の強い関係を検出するテスト、選択前母集団を使うテスト、MCP配線を追加した。これは同じ標本内の校正であり、因果、収益性、執行可能性、未使用期間での再現を保証しない
- **Feature scan候補規則のfalsification audit再配線(2026-07-29)**: `run_feature_outcome_falsification_audit`をv2へ更新し、旧`exploratoryEligible`ではなく、各合成系列内で固定1,000反復のempirical-null校正まで実行した`candidateEligible`そのものを判定する。監査中の校正無効化は許さず、監査の名目alphaと候補規則の`1 - confidenceLevel`の不一致も拒否する。したがって旧v1で得た1.5〜2.5%は新規則の校正値として再利用せず、v2を3種の合成ヌルで再測定する。入れ子反復により計算量が大きいことはツール出力へ明示する
- **Feature scan候補規則v2の合成ヌル再校正(2026-07-29)**: 200複製・4,000バー・horizons `[1,5,21]`・6特徴で、empirical-nullまで通した`candidateEligible`そのものを判定した。white noiseは**0.0% (0/200), Wilson 95% [0.0, 1.9]**、regime-switching volatilityは**0.5% (1/200), [0.1, 2.8]**、bid-ask bounceは**1.0% (2/200), [0.3, 3.6]**。3模型とも区間上限が名目5%未満で、候補規則は測定した合成ヌルに対して保守的に校正された。これは雑音耐性の証拠であり、実データでの優位性や検出力を示さない。次は既知の特徴量効果を段階的に注入し、効果量別の検出率と見逃し率を測る
- **Feature scanの検出力監査基盤(実装, 2026-07-29)**: `run_feature_outcome_power_audit`を追加した。まずbody-directionの固定bucketだけを対象とし、一致するsignal barの次足以降へOHLC全体の累積倍率を掛けて符号付き効果を注入する。これによりsignal barのbody-direction形状を保持しつつ、次足returnへ既知効果を置く。検出は対象bucketの`candidateEligible`に加えて非重複平均の符号が注入方向と一致する場合だけとし、模型・効果量ごとに検出率、Wilson 95%区間、見逃し率、評価不能seedを分離して返す。経路依存の他feature labelは変わり得るため、現段階の結果はbody-direction検出力に限定する。各drawが1,000反復校正を含むため既定50複製、正式曲線は明示的な200複製で実行する
- **Feature scan候補規則v2の検出力曲線(2026-07-29)**: 200複製・4,000バー・`features=[body_direction]`の単一特徴family・horizons `[1,5,21]`で、`bullish_body`直後へ固定bps効果を注入して測定した。直前の6特徴スキャン偽陽性監査とはfamilyサイズが異なるため、数値を直接差し引かない。white noiseは2bps **1.5%** [0.5, 4.3]、5bps **10.5%** [7.0, 15.5]、10bps **68.5%** [61.8, 74.5]、15bps **98.5%** [95.7, 99.5]。bid-ask bounceは2bps **0.0%** [0.0, 1.9]、5bps **10.0%** [6.6, 14.9]、10bps **65.0%** [58.2, 71.3]、15bps **98.5%** [95.7, 99.5]。regime-switching volatilityは2bps **1.0%** [0.3, 3.6]、5bps **3.5%** [1.7, 7.0]、10bps **14.0%** [9.9, 19.5]、15bps **28.5%** [22.7, 35.1]、20bps **47.5%** [40.7, 54.4]、30bps **85.5%** [80.0, 89.7]、40bps **96.5%** [93.0, 98.3]。全runが評価可能・失敗0。80%検出力の目安は平坦ボラ系で10〜15bpsの間、クラスターボラでは約30bpsである。固定bps注入は高ボラ状態ほどsignal-to-noise比が下がるため、模型差は候補規則の不安定性だけを意味しない。2〜5bps級の短期効果をこの規則で不在と断定できず、10bpsでもクラスターボラ下の見逃しが多い
- **Feature scan運用構成の検出力曲線(2026-07-30)**: regime-switching volatility・200複製・4,000バー・6特徴の運用familyで再測定し、全点で評価不能0・失敗0・completeだった。20bps **23.5%** [18.2, 29.8]、30bps **52.0%** [45.1, 58.8]、40bps **78.5%** [72.3, 83.6]、45bps **84.0%** [78.3, 88.4]、50bps **88.0%** [82.8, 91.8]。単一特徴では30bpsで85.5%だったが、6特徴familyでは52.0%まで低下し、multiplicityの検出力コストが実測された。点推定で80%検出となる境界は40〜45bpsの間(線形補間の参考値約42bps)、Wilson 95%下限まで80%を超える保守的境界は45〜50bpsの間で、実測点としては50bpsで初めて満たす。したがって運用構成で候補が出ないことは、クラスターボラ下の40bps未満の次足効果を否定する証拠にはならない。限定仮説では事前登録した1特徴familyを使い、6特徴探索と検出力予算を混同しない
- **Feature scan運用構成の検出力曲線(平坦ボラ, 2026-07-30)**: white noise・200複製・4,000バー・6特徴の運用familyでも同様に測定し、全点で評価不能0・失敗0・completeだった。10bps **43.0%** [36.3, 49.9]、15bps **77.5%** [71.2, 82.7]、20bps **99.5%** [97.2, 99.9]。単一特徴では10bpsで68.5%、15bpsで98.5%だったため、**平坦ボラでもmultiplicityが検出力を同程度に削る**。点推定で80%検出となる境界は15〜20bpsの間で、1特徴エントリに記した「平坦ボラ系で10〜15bps」は運用構成には当てはまらない。クラスターボラ側の30bps→約42bpsとほぼ同じ後退倍率であり、特徴数の効果は模型に依らず一貫する。あわせて注入機構を独立検算し、10bps注入時の1足return差分は`bullish_body` n=681で平均10.001bps、`bearish_body`・`indecision`は0.000bpsで、全バーのbody-directionラベルが不変であることを確認した。累積倍率をOHLC全体へ一様に掛けるため`|close-open|/(high-low)`と`close>open`が保存される。`bid_ask_bounce`の6特徴曲線は未測定だが、1特徴曲線がwhite noiseとほぼ重なる(10bps 65.0%対68.5%、15bpsは両方98.5%)ため平坦ボラ側に近いと見込む
- **#45の戦略walk-forwardへの伝播(実装, 2026-07-30; v2規約)**: `run_strategy_walk_forward`へ任意の`falsification_audit`を追加した。Pineを合成OHLC上で再実行するのではなく、収集済みの完全な候補trade ledgerを入力に、候補ごとの損益平均を除去したうえで、**UTC calendar blockごとの共有符号反転**を行うledger-level empirical nullである。同一時刻ブロックの符号は候補間で共有するため、候補の取引時刻・件数・損益規模と同時ショックは保持しつつ、無条件edgeとtrain選択からOOS損益への結び付きを切る。各複製で既存と同じ train-only candidate selection、embargo、最低trade数、selected OOS集計を通す。候補には**全fold評価可能・aggregate net profit正・PF>1・選択後OOS純益の片側empirical p値が名目α以下**をすべて要求する。実データのp値は全ヌル複製、ヌル側の候補率は自己比較を避けたleave-one-out分布から算出する。partial/不十分な複製は`not_evaluable`、例外は`failed`として分母から除外し、Wilson区間で名目α超過を判定する。初回のTurtle 20/30/40監査で旧規約が49.0%発火したため、p値なしの旧v1を廃止した。これは候補選択の膨張を測る監査であり、Pine signal生成、チャート履歴、fill、cost、実運用優位を検証・採用するものではない
- **v2規約の実機確認(2026-07-30)**: USDJPY 60分 RSI2 v2、閾値候補`3/97`・`5/95`・`10/90`、2024-11〜2026-05のanchored 2 fold、各train/test最低10件、200複製・20日blockで実行した。`3/97`が両foldでtrain選択されたが、selected OOSは25 trade・net profit **328.01**・PF **1.174**、片側empirical p **0.3383**で候補外となった。null複製は評価可能200・失敗0で、leave-one-out候補数は**10/200 = 5.0%**、Wilson 95% **[2.74%, 8.96%]**、名目5%超過なしだった。履歴ロード制約による短期・事後的な実機パイプライン確認であり、戦略のOOS採否根拠ではない

### #49 Session routerのセッションゲートが日足で機能しない(優先度: 高、実装バグ)

- **課題**: `Bushido Session-Selective Turtle Router v1` と `RSI2 Router v1` のセッションゲートは、日足で「無効」か「全滅」の二択になり選択として成立しない。日足バーのタイムスタンプは `0000-0900 Asia/Tokyo` に入るため Tokyo は全通しになり、`0800-1700 Europe/London` と `0800-1700 America/New_York` には決して入らないため全遮断になる
- **実測(2026-07-30)**: ゲートON/OFFで PF が完全一致した。Turtle XAUUSD 1D 2.374/266トレード、Turtle USDJPY 1D 1.410/114、RSI2 XAUUSD 1D 1.349/305、RSI2 USDJPY 1D 1.313/145。いずれもON/OFFで同一値・同一トレード数。さらに RSI2 XAUUSD 1D を London のみ / NY のみにすると**どちらも0トレード**だった
- **対処**: 日足以上では時刻ベースのゲートを使わない。`timeframe.isintraday` で分岐してゲートを無効化するか、日足では `dayofweek` など別の切り口へ置き換える。現状の既定値は日足の記録済みチューニング結果(Turtle USDJPY 1D PF1.41 / XAUUSD 1D PF2.37)に影響していないが、ユーザーが日足で London/NY を選ぶと無音で0トレードになる
- **区分**: これは統計上の問題ではなく実装の欠陥であり、探索の多重度とは独立に修正できる
- **修正済み(2026-07-30, 両スクリプトv2.0)**: `sessionGateActive = useSessionGate and timeframe.isintraday` を挟み、ゲート判定をこれに差し替えた。両スクリプトともコンパイル通過・検証済み。回帰確認として11構成を再測定し、**日足のLondonのみ/NYのみが0トレードから既定と同値へ**変わった(RSI2 XAUUSD 1D は 0→305トレード/PF1.349、Turtle XAUUSD 1D の Londonのみは 266/PF2.374)。同時に**既存の全数値が完全一致**した — Turtle XAUUSD 1D 2.374/266、USDJPY 1D 1.410/114、XAUUSD 1H 既定 1.328/251、同ゲートOFF 1.464/277、RSI2 USDJPY 1D 1.313/145、USDJPY 1H 1.326/108、XAUUSD 1H 1.280/79。修正は無音の0トレードだけを除去し、記録済みの日足チューニング結果とwalk-forwardの結論に影響しない。`Restrict entry sessions` のツールチップにも日中足限定であることを明記した

### #50 Session router 2本のセッション次元 walk-forward 検証(2026-07-30)

- **経緯**: `Session-Selective` を名乗る2本のPineは、ヘッダのチューニング記録がすべてセッションルーター導入前(2026-07-10, OFAT, 日足)のものであり、セッション次元だけ検証記録が空だった。既定値(Turtle: Tokyo+London、RSI2: Tokyo のみ)は未検証のまま入っていた
- **段階1 通貨・時間足の再評価(18構成)**: ゲート有効下のPFは、Turtle XAUUSD 1H 1.328 / 4H 1.606 / 1D 2.374、USDJPY 1H 0.878 / 4H 1.323 / 1D 1.410、EURUSD 1D 1.066。**日足はヘッダ記録と完全一致、日中足は悪化**した。RSI2 は最良が XAUUSD 1D 1.349、USDJPY 1H 1.326、USDJPY 1D 1.313 で**どこもPF1.4に届かない**。XAUUSD 4H は 0.400(39トレード)で崩壊
- **段階2 セッションのアブレーション(21構成、同一銘柄・同一期間)**: 効果が2本で逆向きだった。**Turtle(ブレイクアウト)はゲートで悪化**する — XAUUSD 1H はゲートOFF 1.464 が Tokyo+London 1.328、Tokyo のみ 1.303、London のみ 1.280、NY のみ 1.146 のすべてを上回る。**RSI2(平均回帰)はゲートで大きく改善**する — XAUUSD 1H は 0.812→1.280、USDJPY 1H は 0.717→1.326。ソースが弱点として明記していた「強トレンドでの逆張り失敗」がセッション次元で実測された形で、London/NY はトレンドが出るセッションである
- **段階3 walk-forward(anchored、選択はtrain expectancyのみ、embargo 24〜30本)**: Turtle XAUUSD 1H(3 fold)OOS 129トレード PF **1.612**、Turtle XAUUSD 4H(5 fold)105トレード PF **1.838**、RSI2 XAUUSD 1H(3 fold)102トレード PF **0.983**、RSI2 USDJPY 1H(3 fold)64トレード PF **1.308**
- **~~唯一OOSで機構が再現した候補~~ → 順列検定で棄却(2026-07-31訂正)**: RSI2 × USDJPY × 1H × Tokyo のみは、3 fold すべてで Tokyo のみが選択され 3 fold すべてで test が黒字(1.276 / 1.107 / 2.036)、ゲートOFF の train expectancy は全fold負(−27.4 / −32.9 / −33.8)、Tokyo のみは全fold正(+19.3 / +24.3 / +20.4)だった。この符号の一貫性を根拠に当初「棄却されなかった唯一の候補」と記録したが、**これは誤りだった**。#45 の台帳レベル falsification 監査(500複製)で選択後 OOS 純益の片側経験的 p 値を測ると **p = 0.335**、判定は `non_candidate`。符号反転ヌルの3回に1回がこの純益(1,560.9)を上回る
- **誤読の内容(2026-07-31)**: 帰無モデルは**選択機構ごと保存する**。ゲートOFF側の台帳は178〜337トレード、Tokyo のみは41〜94トレードと大きく非対称で、この差はヌルでも変わらない。したがって「3 foldとも同じ候補が選択される」こと自体はヌルの下でも普通に起きる。**選択の安定性を収益性の証拠として扱っていた**のが誤りで、fold間の符号一致は事前に思っていたほどの情報量を持たない。3 fold一致を素朴に 1/8 = 12.5% と見積もったのも、foldが同一台帳のanchored分割で独立でないため妥当でなかった
- **今回のチューニングから生き残った候補はゼロ**: Turtle XAUUSD 1H/4H は判定不能、RSI2 XAUUSD 1H は棄却(OOS PF0.983)、RSI2 USDJPY 1H は順列検定で棄却(p=0.335)。39構成のin-sample探索・4本のwalk-forward・順列検定を通して採用可能なものは出なかった。通算50判定・採用0という記録とも、feature scanで測った検出力の乏しさとも整合する
- **Turtleは判定不能**: 1H は3 fold全てゲートOFFが選択されたが、4H では Tokyo+London が3/5で選択され、**ゲートOFFが選択された2 foldは両方OOS失敗**(PF 0.705 / 0.299)。4H の train expectancy 差は f4 で200.2対193.0(4%)、f5 で275.9対259.2(6%)と雑音の幅で候補が決まる。OOS PF1.838 は純益35,023のうち**24,712(71%)がf4の16トレードだけ**から出ており頑健でない
- **RSI2 XAUUSD 1H は棄却**: in-sample 1.280 が OOS 0.983 まで落ちた。f1 では Tokyo のみの train が26トレードで最低30に届かず、**train expectancy −45.8 のゲートOFFを「最良」として選ぶしかなくなり**、test も 0.737 で負けた。負けると分かっている候補を選択せざるを得ない状況が実際に発生する
- **多重度の実例**: 段階1〜2の39構成で最も魅力的だった Turtle XAUUSD 1H ゲートOFF(in-sample 1.464)は、4H で符号が反転した。#45 で測った膨張(K=100 で in-sample t 2.79 対 walk-forward 0.82)がそのまま現れている。**in-sample のPF差 1.464 対 1.328 は OOS で方向を保たない**
- **計測上の注意**: Strategy Tester の Sharpe/Sortino は `risk_free_rate=2` に対し1トレード10%資金の netProfitPercent を比較するため、PF2超の設定でも全件負値になり使用不可。判定はPFとexpectancyで行った。XAUUSD 日足の `reportDateRange` は 1833-01-06 開始という不正な値を返すため、同銘柄日足の集計は開始日を信用しない

### #51 戦略walk-forwardへの#45伝播と、その偽陽性率が恒等式になる件(2026-07-31)

- **実装**: `run_strategy_walk_forward` の任意 `falsification_audit` として、台帳レベルの経験的ヌルを追加した。各候補の確定トレード損益を中心化し、**UTC暦ブロック(既定5日)ごとの候補間共通ランダム符号**を掛けて、同じ候補選択とOOS判定を再実行する。タイムスタンプ・トレード数・損益の大きさ・候補間の同時性を保ったまま方向性だけを消す構成で、中心化により帰無の期待値は厳密にゼロになる。OHLCの再合成やPineの再実行はせず、収集後の選択インフレだけを校正する
- **v1の校正値(2026-07-30)**: 判定規則が「全fold評価可能 かつ 集計netProfit>0 かつ 集計PF>1」だったとき、RSI2 USDJPY 1Hの台帳に対し **260/500 = 52.0%** [47.6, 56.3]。符号反転ヌルでは集計損益の符号がコインフリップになるため理論値どおりで、**この規則は実質的に何も選別していない**ことが実測された
- **v2で片側経験的p値を条件に追加(2026-07-31)**: 選択後OOS純益の片側経験的p値が名目α以下であることを要求するようにした。observed側は `p = (1 + #{null >= observed}) / (N + 1)` で、片側順列p値の標準形かつゼロを返さない不偏形。**これは正しい構成で、今回いちばん価値のある出力**である
- **ただし偽陽性率の測定は恒等式になる**: null run側のp値は leave-one-out で `p = (1 + #{other >= self}) / N`。netProfit降順の順位を r とすると自分以上の他者は r−1 個なので **p = r/N** となり、pは {1/N, …, 1} を一様に取る。よって `p <= α` を満たすのは常に floor(αN) 本で、**候補率は構成上ぴったり α になる**。実測でも N=500・α=0.05 で `candidates: 25`、`observedRate: 0.05` ちょうど、区間 [3.4, 7.3] が α を跨ぎ `exceedsNominalAlpha: false` だった
- **解釈**: 順列p値は帰無仮説の下でサイズが厳密にαになる検定なので、同じ帰無分布に対して偽陽性率を測れば α が出るのは当然で円環である。監査の役割は**未校正の規則を校正すること**(v1の52%)にあり、規則を順列検定にした時点でその役割は果たされて不要になった。経験的にサイズを測るには入れ子ヌル(計算量 N²)が要るが、厳密性が証明できる以上やる価値は薄い
- **対応済み(2026-07-31)**: walk-forward falsification auditを`v3`へ上げ、`observedRate`・Wilson区間・`exceedsNominalAlpha`を出力から削除した。代わりに`leaveOneOutTailCalibration.status: not_measurable_structural_rank_uniformity`と、構成上の`nominalTailSlots`だけを返す。候補数自体は診断用に残すが、偽陽性率または校正の測定値として解釈しない。

### #52 #45の他系統への伝播と再校正(優先度: 高、2026-07-31)

- **問題**: feature scanの非重複+Newey-West+Bonferroniだけの候補規則は、white noiseで名目5%に対して14.0%を出した。経験的ヌルを追加したv2で初めて候補率が0.0〜1.0%へ収まった。このため、重複する将来リターン・複数horizon・複数lag・時系列依存を持つ他の探索結果を、CI/Fisher interval/Bonferroniだけで校正済みと扱えない。
- **対象A: event study群**: FVG、session auction、aftershock、failed breakout、session exhaustion handoff、composite、yield-priceには既存の合成ヌル監査がある。しかし候補規則のglobal mean CIはevent windowの重なりから生じる系列相関を補正しない。各採用候補について、branch・horizon・最小event数・fold・overlap policyを固定して、white noise / regime-switching volatility / bid-ask bounceの標準400複製へ再投入する。`partial`のイベント不足は非候補と合算せず別に報告する。候補率だけでなく、重複を除いた評価windowまたはevent-time block bootstrapのどちらを候補規則へ採るかを、結果を見る前に決める。
- **対象B: lead-lag**: 現行のFisher-z+Bonferroniは時系列自己相関と隣接lag間の依存を扱わない。primary/referenceの同時相関・exact timestamp欠損・各系列の自己相関を保存しつつ、片方をcircular block shiftして時差予測性だけを壊すpair empirical-null auditを追加する。候補は正lag、事前固定したlag family、fold符号、Bonferroniに加え、同一データ・同一lag gridから計算したfamily-maximum empirical p値が名目α以下の場合だけにする。既存のFisher値は説明用に残し、採用判定には使わない。
- **対象C: session handoff**: 対象Aのsession exhaustion handoff runとして扱い、直前session return・handoff窓・range re-entry・opposite body・forward update閾値を凍結する。London DSTとcross-midnight sessionを含むため、合成時刻列が実際のsession clockに適合することを事前テストし、UTC等間隔の合成系列を無条件に「同等の市場日」と主張しない。
- **段階(1)の入力証跡**: 監査CLIが受ける完全な条件JSONを、登録時の研究ジャーナルへcanonical JSONと定義hashの組として保存していない過去記録がある。`definitionHash`や自然言語thesisから入力を推測してはならない。したがって、既存の完全な実行入力がコード・E2E設定・監査ログに残る候補だけを段階(1)へ入れ、残りは「再実行不能な過去探索」と明示する。今後はevent hypothesis登録時に`audit_definition`を必須保存し、CLI入力と同じhashを検証する。これは7系統の候補率を比較する前提条件である。
- **既知の着手順**: `session_exhaustion_handoff`のEURUSD 60分v2契約は、既に3模型×400複製・5,000本で完走済み(候補率0.75〜1.75%、全draw評価可能)なので再実行しない。次は、完全なFVG 60分/15分契約を監査入力として固定し、続いてaftershock・failed breakout・session auction・composite・yield-priceの順に、完全入力の有無を確認してから実行する。aftershock CPI v1は現在5イベント・1検出で最低10イベントを満たさず、監査候補にはまだならない。
- **段階(1) 実測 2026-07-31 — FVG 15分 bearish**: 事前登録済みの `fvg-retest-cross-market-15m-20260726` から、bearish branch・16本(4時間)・最低30 event・3fold・gap 3bps・impulse body 0.60・48本以内first retest・far boundary hold・target 10bps・trial 1を再現した。標準3模型×400複製×5,000本はすべて評価可能・失敗0。候補率は white noise **4.75%** (19/400, 95% Wilson 3.06〜7.30%)、regime-switching volatility **7.25%** (29/400, 5.10〜10.22%)、bid-ask bounce **6.25%** (25/400, 4.27〜9.06%)。レジーム切替ボラは名目5%を上回るため、このbranch規約を校正済み候補として扱わない。模型率は合算しない。
- **段階(2) 実装・実測 2026-07-31 — 非重複FVG v3**: `fair_value_gap_retest`へ明示的`overlap_policy`を追加した。既存v2の既定は`allow_overlapping_windows`のまま保持し、`exclude_later_event`では採用済みシグナルの**最大**outcome horizonに重なる後続eventを除外する。この選択を`selectionContract`・quality counterへ出し、v3として識別する。同一FVG 15分 bearish規約へこのpolicyだけを追加して再校正した結果、white noise **2.50%** (10/400, 1.36〜4.54%)、regime-switching volatility **2.00%** (8/400, 1.02〜3.90%)、bid-ask bounce **1.75%** (7/400, 0.85〜3.57%)。全draw評価可能・失敗0で、いずれも名目5%を超えない。これは重複除外を含む新v3候補規約の校正値であり、実データ候補の再評価は段階(3)で行う。
- **段階(1) 残り5系統の棚卸し 2026-07-31**: 既存journal・コード・E2E設定を照合した。`session_auction`は候補branch/horizonを含む完全な監査入力が保存されていない過去探索であり、hashやthesisから再構成しない。`event_aftershock_retest`はCPI v1が5イベント・1検出で最低10検出を満たさず、合成側の外生event scheduleも未凍結である。`failed_breakout`は4記録のうちEURUSD 60分38件・XAUUSD 30分31件が最低50 event未達、EURUSD 60分51件・XAUUSD 60分59件は最低数を満たしたが全branchのCIが0を跨ぎ、いずれも`inconclusive`で候補なし。`composite_condition`も最低20/50 event未達またはCIが0を跨ぎ、候補なし。`yield_price_nonconfirmation`は前向き仮説が収集中で、候補branchの実測証跡がまだない。したがって、この5系統を後付けで監査入力へ変換して数値を作ることはしない。段階(1)の監査対象は、完全に復元できたFVG 15分 bearishと既済のsession handoffで完了とする。今後の新規候補は`audit_definition`付き登録後にのみ同じ監査へ進める。
- **対象B 監査入力の束縛と再測定 2026-07-31**: 上記の再現不能を受け、`runLeadLagFalsificationAudit`の戻り値へ`auditDefinition { runner, input, inputHash }`を追加した。`FalsificationAuditResult`は生成側(model・replications・firstSeed・bars・timeframeMinutes・実効volatility・実効rho)を既に固定していたが、**study側の契約、とりわけfold境界が呼び出し側にしか存在しなかった**。省略されたseedやrhoも監査自身の解決済み値からhashを作るため取りこぼさない。fold境界を1日動かすとhashが変わることを回帰テストで固定した。`canonicalDefinition.ts`をkey整列JSON+sha256の共通実装として新設したが、`strategyResearchJournal`のhashは追記済みjournalに永続化されており変更すると既存記録の検証が壊れるため移行しない。
- **対象B 再測定 2026-07-31(旧3.25%の検証ではなく別測定)**: 条件を先に固定して実行した。系列全期間の2分割fold(2006-01-02T00:00:00.000Z〜2006-04-16T04:00:00.000Z / 〜2006-07-29T07:00:00.000Z)、`firstSeed: 1`、`rho: 0.7`、5,000本・60分足・maxLag 10・最小30・信頼水準0.95・trial 1。400複製は**8/400 = 2.00%** [1.02, 3.90]、1,500複製は**22/1500 = 1.47%** Wilson 95% **[0.97, 2.21]**。いずれも失敗0・評価不能0・`status: complete`・`exceedsNominalAlpha: false`。**1,500複製で区間上限が2.21%となり名目5%を明確に下回った**。`inputHash: sha256:2b2bc61faa21521aa54fedfdc05f348318bc1a4c9f8faafe6640bc6228cc0c28`。旧400複製の3.25%とは出発点が異なるため、複製数を増やして締まったという読み方はできない。これはfactor-null(rho=0.7)1模型の結果であり、regime-switching volatility / bid-ask bounceを含むペアnullは未測定である
- **対象B MCPツール化と境界統一 2026-07-31**: `runLeadLagFalsificationAudit`は戻り値へ`auditDefinition`を持たせても、呼び出す手段が使い捨てスクリプトしかなく、条件が散文へ落ちる経路が残っていた。**束縛は入口を用意して初めて機能する**ため、`run_lead_lag_falsification_audit`を他2つの監査ツールと並べて露出した。`folds`は候補規則がfold符号安定を要求する以上評価不能になるので必須(2〜12)とした。あわせてMCPスキーマが純関数より緩かった箇所を揃えた — `max_lag_bars`は上限100→**50**(純関数は50超でthrow)、`minimum_observations`は下限2→**4**(純関数は4未満を拒否)。緩いスキーマは、実行不可能な設定を「試したが失敗した」記録として残しうるため、入口で弾く。MCP統合テストで`inputHash`形式・`study.folds`件数・`status: complete`を固定した。fold件数を検証対象に含めたのは、今回の再現不能の原因そのものが結果に載ることを保証するためである
- **対象B プロセス跨ぎの検証 2026-07-31**: 固定条件をMCP経由で再実行し、直接呼び出しと同一の`inputHash: sha256:2b2bc61faa21521aa54fedfdc05f348318bc1a4c9f8faafe6640bc6228cc0c28`、同一の**22/1500 = 1.47%** [0.97, 2.21]、失敗0・評価不能0・`complete`を得た。**独立した2経路が1つのhashへ到達したことが、この数値を引用可能にする根拠**である。以後この監査のrateは`inputHash`と対で記録する
- **対象B ペアnull拡張の事前決定・実装 2026-08-04**: 単系列3模型を独立な2脚へ載せるだけでは同時相関を持たず、旧`factor_null_pair`は同時相関を持つが定常白色雑音だけだった。両方を同時に満たす厳しいnullとして`factor_regime_switching_volatility_pair`と`factor_bid_ask_bounce_pair`を追加した。**結果を見る前の固定判断として、regime-switchingのボラティリティ状態は両脚で共有する**。独立状態は実際のクロスアセット系列より依存を弱め、監査を易しくするため採らない。bid-ask符号は相関mid pathの上で脚別に独立とする。全paired auditは`pairStructure { marginalModel, crossSeriesDependence, volatilityStateDependence }`を返し、lead-lagの`auditDefinition`とhashへ含める。旧v1 hashと新契約を混同しないためrunner/MCP methodologyはv2へ更新した。これは#52対象Bの合成null範囲を拡張したもので、実系列を片脚circular block shiftするpair empirical-nullの代替ではなく、対象B全体を完了扱いにしない
- **対象B ペアnull拡張の実測 2026-08-04**: 2026-07-31に固定した条件(firstSeed 1、5,000本・60分、maxLag 10、最低30、95%、trial 1、2fold)を変えず、新規5模型を各400複製で測定した。独立white noiseは**11/400=2.75%** [1.54,4.86] (`sha256:b24a92293977c1ae6e6f86931599a500c62454b8314a3d3103b37bf42c2ab8fa`)、独立regime-switchingは**16/400=4.00%** [2.48,6.40] (`sha256:24f73e53b9eb160c5ce1d368971bb126ea073844f58867f81489afb5b517e1b7`)、独立bid-askは**9/400=2.25%** [1.19,4.22] (`sha256:d4c763076b84472f9e883ccf6374e66fa15d84db95c494c19ded22a06b9ff0f1`)、共有regime-switching factor pairは**278/400=69.50%** [64.82,73.81] (`sha256:71039018658995f75b254acbd997befed22a320e43601d8974d15ea916458653`)、bid-ask factor pairは**10/400=2.50%** [1.36,4.54] (`sha256:197d42e0254993dc1ec304e77463ad0e9b44e0ff641bf262dedae4c2a764d553`)。全draw評価可能・失敗0。共有クラスタ模型の超過は、生成系列へ方向lagを植えた結果ではなく、現行のreference circular shiftが同時相関と共有ボラ状態を帰無反復から除去し、共通クラスタ下のFisher統計を校正できないためと診断した。従って現行lead-lag候補規約は**共有クラスタ・ボラを持つ相関ペアに対して未校正**であり、校正済み候補として使わない。次段階は、同時共分散と時変ボラを保ったまま時差方向だけを壊す帰無再標本化規則を結果を見る前に固定すること
- **yield-price 3模型配線 2026-08-04**: 標準event-study監査のyield-priceだけが無効な`model: white_noise`指定を内部で捨て、factor white 1模型に固定されていた。単系列modelを対応するfactor pairへ明示変換し、標準3模型をそれぞれ別runとして返すv2へ更新した。共有regime-switchingの設計判断も各runの`pairStructure`へ残る。現時点のyield-priceは候補branchの完全な前向き実測証跡がなく、後付け入力で率を作らないため、配線テストまでを完了とし実測校正は未着手のまま残す
- **対象B 処方(a)の事前固定・v3実装 2026-08-04**: 共有clustered factor pairで69.5%となった原因を、生成器ではなく同時相関と共有ボラ経路を破壊する循環シフト帰無の不整合と判断した。処方を比較した後、結果を見る前に(a)統計量段階の因果的ボラ標準化を選択した。各系列のlog returnを**現在returnを含まない直前20本のRMS**で割り、窓20・centeringなし・scale 0/非有限はfail-closedとして固定する。窓や推定法を入力で変更できない。旧raw-return経路は`returnStandardization: none`として再現専用に残し、MCPとfalsification auditの既定を`causal_prior_20_rms`へ変更、methodology/runner/hashをv3として分離した
- **対象B 処方(a)の6模型再校正 2026-08-04**: 同じ固定条件・各400複製でv3を測定した。独立white noise **12/400=3.00%** [1.72,5.17] (`sha256:a5f24ab285099171a815da80d753b297b62faa0f253591a31c3005637488352f`)、独立regime-switching **9/400=2.25%** [1.19,4.22] (`sha256:6909c5586588a3b17ee7e832f69e56874cc1c8a96dbbfc6643f396a52e42e367`)、独立bid-ask **9/400=2.25%** [1.19,4.22] (`sha256:6a78e5bc59472539ad7285cccdee5b5c6fa0c5c4983bec49fc175a1301e29d49`)、factor white **9/400=2.25%** [1.19,4.22] (`sha256:8a881ce1bf5c5ca84660f9128b30b997f6b584f8fed3db13669ff3d5cb836dba`)、共有regime-switching factor pair **30/400=7.50%** [5.30,10.50] (`sha256:ae4fd1d7eac65c22d4b95f6e48b496f74c5ffd6ef908cc8bf4d82cf9b42a8170`)、bid-ask factor pair **10/400=2.50%** [1.36,4.54] (`sha256:1fafc4c4e3e812926f19af8ff939b311ddc22331e5fd6579c8a7c4030c0daf7b`)。全draw評価可能・失敗0。処方(a)は問題模型を69.5%から7.5%へ大幅改善したが、Wilson下限5.30%で名目5%をなお上回る。事前固定した窓を結果後に調整せず、v3も**未校正**と判定する。統計ゲート通過は今後の監査用`statisticalGateEligible`へ残す一方、公開`candidateEligible`とjournal記録は`candidate_rule_not_calibrated_for_shared_clustered_volatility`でfail-closedとした。次の処方を新契約として事前固定・再校正するまで、実データ候補へ再適用しない
- **MCPスキーマと純関数の境界一致点検 2026-07-31(修正不要)**: lead-lagで見つかった「入口が実装より緩い」問題が他ツールにもあるかを全数点検した。`src/server.ts`のz.number境界と、`src/*.ts`側の検証throwを突き合わせ、疑わしい11件を実コードで確認した。**結果は全件一致で、修正すべきものはなかった**。自動抽出が挙げた11件はすべて偽陽性で、原因は(a)純関数が`!(x > 0 && x < 1)`の形で排他境界を書くため正規表現が下限と上限を反転して拾ったこと、(b)`minimum_observations`のように同一パラメタ名が5ツール・別々の純関数へ対応するのに1つへ紐付けたこと、の2点である。手で確認した対応: coverage系4件は純関数`> 0 && <= 1`に対しMCP`.gt(0).max(1)`、`directional_move_atr_threshold`は`> 0`に対し`.gt(0).max(100)`、`elevated_volume_z_score`は`> 0 && <= 10`に対し`.gt(0).max(10)`、`low_volatility_ratio`は`> 0 && < 1`に対し`.gt(0).lt(1)`、`high_volatility_ratio`は`> 1`に対し`.gt(1).max(100)`、`close_location_threshold`は`>= 0.5 && < 1`に対し`.min(0.5).lt(1)`。整数系も`max_lag_bars`以外の全件が一致していた。**つまり lead-lag の 100/50・2/4 が唯一の実例で、他所からの伝播ではなく既存ツールの数値を写し違えて作り込んだものだった**。逆向き(MCPが純関数より厳しい)は`configuration_trials`が1,000と100,000、`window`が250と500で併存するが、安全側であり実行時例外にはならない。意図的な使い分けか未確認のため、変更はしていない
- **段階(3) 実データ再評価 2026-07-31 — FVG v3**: 定期研究収集CLIを`fvg_retest_event_study_v3`へ切り替え、前向き登録済み`xauusd-15m-bearish-fvg-trend-down-forward-20260726`を再読した。5,000本(閉じた足4,999本、2026-05-15T14:15Z〜2026-07-31T09:15Z)を明示ロードし、登録後・bearish・prior `trend_down`・非重複windowまで適合したprimary 16本eventは**1件**で、最低50件に未達。従って候補・優位性・不採用のいずれも判定せず、前向き収集を継続する。同一runのEURUSD/US10Y非追随とEURUSD 50分lower-wickも最低event数未達であり、いずれも新しい候補を出さない。収集結果はchartを復元して終了し、既存最大値を上回らなかったためログ追記は0件だった。
- **対象B 実装(2026-07-31)**: `compute_lead_lag_relationships`へ任意の`empirical_null_calibration`を追加した。閉じたexact-timestamp joinで得たreturn列の一方を、走査した正lag familyの外側へ一様に循環シフトし、各系列の並び・自己相関・元の時刻欠損構造を保ったままreference-to-primaryの時差関係だけを切る。固定1,000反復・seed `20260731`・family maximum absolute Fisher-z statisticでlagごとの経験的p値を算出し、同じ証拠窓・同じlag gridに束縛した`calibrationId`を返す。既存のFisher/Bonferroni値は説明用に残すが、候補記録には使わない。候補には正lag、2つ以上の事前fold、fold符号安定、Bonferroni、経験的family-wise p値をすべて要求し、校正なし・不安定fold・負lagは`candidateBlockers`へ明示する。これは同一証拠窓の統計校正であり、因果・収益性・OOS再現を保証しない。
- **対象B factor-null監査(2026-07-31)**: `runLeadLagFalsificationAudit`を追加し、5,000本・60分足・正lag±10の正lag family・2 fold・最小30・400複製を実行した。各複製は固定1,000反復の循環シフト校正まで通し、400/400評価可能・失敗0。候補は**13/400 = 3.25%**、Wilson 95%区間は**[1.91%, 5.48%]**、`exceedsNominalAlpha: false`。**この数値は再現不能・未検証である(2026-07-31 追記)**: fold境界・`firstSeed`・`confidenceLevel`・`configurationTrials`が記録されておらず、fold境界・seed・rhoを8通り試した結果は0.75%/1.50%/2.00%/2.00%/2.00%/2.00%/2.25%/3.00%で、13/400に一致するものがなかった。fold境界だけで0.75%〜2.00%と3倍近く動くため、これらが未記録である限り引用できない。ただし`exceedsNominalAlpha: false`という結論の向きは試した8通りすべてで一貫していた。これは同時相関`rho=0.7`を含むfactor-null pairに対する結果であり、白色雑音・レジーム切替ボラ・bid-ask bounceの3単系列模型を測った結果ではない。Target Bの固定契約がこのnullに対して名目5%を明確に超過しないことを確認したが、実データの因果性・収益性・OOS再現は示さない。
- **実データ再測定 — USDJPY × THINKMARKETS:USDINDEX (2026-08-02)**: 比較チャートを従来の`TVC:DXY`から`THINKMARKETS:USDINDEX`へ差し替えた後、`OANDA:USDJPY`との60分足を同じ固定候補規約(`maxLag 10`、最低30、95%、trial 1、全期間二分fold、経験的ヌル1,000反復)で再測定した。TradingViewが返したのは各300本(2026-07-15T09:00Z〜2026-07-31T20:00Z)、exact一致264本・return 263本であり、週末等の不連続12本により`partial`となった。候補は**0件**。正lagで最大の`lag 5`は相関+0.110、Bonferroni p=1.000・経験的family-wise p=0.251で不通過。絶対値最大の`lag 8`は相関−0.160、通常p=0.011だがBonferroni p=0.221・経験的p=0.128で不通過し、さらにprimaryに対して非取引可能な符号である。供給元・指数定義が異なるため旧`TVC:DXY`結果との優劣比較はしない。これは短い表示履歴での**候補なし**という記述的結果であり、因果性・収益性・採用根拠を示さない。長期履歴が明示ロードできた場合に同一契約を再実行する。
- **異なるバー境界の安全な4時間結合(実装・実機, 2026-08-02)**: `OANDA:USDJPY`の既成4時間足は`21/01/05/... UTC`、`THINKMARKETS:USDINDEX`は`00/04/08/... UTC`に開始し、各バーは1時間しか重ならない。近い開始時刻を対応させると別の4時間returnを同一観測として扱うことになるため、`compute_lead_lag_relationships.alignment_mode: resample_closed_60m_to_utc_grid`を追加した。既定`exact_utc`は変えず、この明示モードだけが両チャートを一時的に60分足へ切り替え、閉じた60分足4本がすべて揃うUTC固定4時間バケットだけを再構成する。欠損・形成中・重複・格子外のsource barは補完せず拒否またはbucket除外し、応答には生OHLCを返さず件数だけを残す。内側reference→外側primaryの順で元状態へ復元し、復元不能なら結果を返さない。純関数の完全bucket/欠損bucket棄却とMCPの切替・復元・生バー非返却をテストで固定した。実機では60分足各1,204本からUSDJPY 290、USDINDEX 286の4時間gridを作り、exact一致247本・return 246本を得た(不連続49本で`partial`)。同期間二分fold、正lag 1〜10、95%、Bonferroni、経験的ヌル1,000反復で候補は**0件**。最大の正相関はlag 4の+0.148(通常p=0.021)だが補正p=0.449、経験的family-wise p=0.175、fold符号不安定で不通過。測定後に両チャートと既存Studyが`240`へ復元されたことを確認した。この4時間再集約契約は60分足・日足の既成バー結果と別の記述的仮説であり、因果性・収益性・採用根拠を示さない。
- **判定順序**: (1) 現行の固定候補契約を監査して数値を記録、(2) 偽陽性率が名目を超えるか、重複windowの推論不整合が確認された場合だけ経験的ヌル候補ゲートを実装、(3) 新ゲートを同一3模型で再校正、(4) 実データの候補を再評価する。候補規則と探索対象を同時に変えない。再校正完了までは各結果を`exploratory_only_not_calibrated`として扱う。

### #64 対象B完了 — リード・ラグ候補規則は現実的なヌルで名目水準を保てていなかった(2026-08-02)

- **経緯**: #52 対象B の「regime_switching_volatility / bid_ask_bounce を含むペアnullは未測定」を閉じるため、ペアnull生成器を6模型へ拡張した。**その拡張が候補規則の欠陥を露出させた。** 測定して初めて分かったことであり、模型を足さなければ永久に見えなかった
- **6模型の内訳**: `generateFactorNullPair`が3つの周辺分布を取れるようになり(同時相関あり)、`generateIndependentNullPair`が3つ(系列間依存なし)。因子ペアのクラスタボラは**状態を共有**する。独立な状態は「ボラティリティ・クラスタの最中にだけ依存を弱める」ため、実在する2資産より易しいヌルになるからである
- **設計判断を結果自身へ載せた**: #52 は「共有するか否かを事前に決めて記録する」と規定していたが、BACKLOGへ1行書くより強い形にした。`FalsificationAuditResult.pairStructure { marginalModel, crossSeriesDependence, volatilityStateDependence }`により、**率が必ず「周辺分布・系列間依存・ボラ状態の共有」と対で残る**
- **標準化なしの測定(400複製・rho 0.7・5,000本・60分足・maxLag 10・最小30・95%・trial 1・2分割fold)**:

  | ペアnull模型 | 系列間依存 | ボラ状態 | 候補率 |
  |---|---|---|---|
  | factor_null_pair | 同時相関 | 一定 | 8/400 = 2.00% |
  | **factor_regime_switching_volatility_pair** | **同時相関** | **共有** | **278/400 = 69.50%** |
  | factor_bid_ask_bounce_pair | 同時相関 | 一定 | 10/400 = 2.50% |
  | white_noise | 独立 | 一定 | 11/400 = 2.75% |
  | regime_switching_volatility | 独立 | 独立 | 16/400 = 4.00% |
  | bid_ask_bounce | 独立 | 一定 | 9/400 = 2.25% |

  全模型`complete`・失敗0。**6模型中5つは名目5%以下に収まり、「同時相関 かつ ボラ状態共有」という実在する2資産に最も近い1つだけが 69.50%** だった
- **同時相関は原因ではない**: rho を 0 / 0.3 / 0.7 と振ると共有ボラ模型は 75.50% / 73.00% / 69.50%。**rho=0(平均の相関ゼロ)でも 75.5%** で、むしろ rho が上がるとわずかに下がる。原因は**ボラティリティ状態の共有そのもの**である
- **機構 — 壊れていたのは生成器ではなく循環シフトのヌル**: 観測データでは σ_p(t) と σ_r(t−k) が同じ状態に駆動されるため積 r_p(t)·r_r(t−k) の分散が大きい。参照系列だけを循環シフトすると両者が独立になり分散が小さくなる。結果、観測統計量がヌル分位を過剰に超える。**このヌルは「同じデータ、時差関係なし」ではなく「同じデータ、時差関係なし かつ 同期ボラなし」という、より弱い帰無だった**。同じ周辺過程でも独立ペアなら 4.00% に収まることが、差が同期の有無だけであることを示す
- **候補規則は連言なので、69.5% が通ったことは経験的ヌルが7割方素通りさせていたことを意味する**。多重度補正としても機能していなかった
- **処方(a)を採用 — 統計量の段階で因果的に標準化**: `causalPriorRmsStandardizePair`。各系列の収益率を**直前20本のみ**のRMSで割ってから Fisher-z を取る(当該バーを含まないため先読みなし)。ウォームアップ20本は落とし`standardizationWarmupReturnsExcluded`で報告する。統計量の定義変更であるため方法論を分岐させた — study側 `lead_lag_relationships_v3_causal_prior_20_rms`、ヌル側 `lead_lag_empirical_null_circular_shift_causal_prior_20_rms_v2`。**どちらの統計量で出た数字かが結果自身から判別できる**
- **標準化後の測定(同条件・400複製)**: factor_null_pair 2.25%、**factor_regime_switching_volatility_pair 7.50%**、factor_bid_ask_bounce_pair 2.50%、white_noise 3.00%、regime_switching_volatility 2.25%、bid_ask_bounce 2.25%。**69.50% → 7.50% と9分の1**。他5模型は悪化せず、独立レジーム模型はむしろ 4.00% → 2.25% と改善した
- **残差の確定(1,500複製)**: **119/1500 = 7.93%** Wilson 95% **[6.67, 9.41]**、`complete`・失敗0。**区間下限 6.67% が名目5%を上回るため、超過は確立している**(ばらつきの範囲ではない)。`inputHash: sha256:dee9afe4ce56f82be2fd07feb5fe6d6f7ccde9330625d71ba5849099b2415b20`、`runner: lead_lag_falsification_audit_v3`
- **残差の理由**: 共有状態は対数分散に毎バー sd 0.15 の衝撃が入るため、20本RMSでは追随しきれない。残った同期ヘテロスケダスティシティがそのまま 7.93% に出ている
- **窓長を率に合わせて縮めてはならない**: 20本は測定前に決まった値であり、7.93% を見てから短くするのは #57(最小効果量)・#60(校正済み構成)で排除してきた研究者自由度そのものである。筋の通る道は3つ — **(i) 20本のまま 7.93% を校正値として記録する、(ii) 別の窓長を率とは独立な根拠で事前登録してから測り直す、(iii) 実現率が5%になるよう名目αを絞る(ただしこの特定のヌル模型への合わせ込みである旨を併記)**。現時点では **(i)** を採る
- **記録済み数値の再解釈**: `1.47%`(1,500複製)と `2.00%`(400複製)は **`factor_null_pair`、すなわちボラ状態を共有しないヌルの下でのみ成立する**。銅/金、EURUSD/US10Y をはじめ相関資産ペアはボラ・レジームを共有するため、これらを「リード・ラグ規則が名目を守る証拠」として引用してはならない。`8/400 = 2.00%` は今回のコードでも完全に再現し、white_noise ペアの生成出力が HEAD と一致することも確認済みで、**旧測定が誤っていたのではなく、ヌルが現実の一部を欠いていた**
- **ハッシュの取り扱い**: runner は v1 → v3(`pairStructure`と`returnStandardization`の definition 追加による)。旧 `inputHash: sha256:2b2bc61f...` は **v1 runner のもの**であり再現しない。同条件を v2 で回した際の値は `sha256:7b6e2483...`。「rateは`inputHash`と対で記録する」規則を守るには、**ハッシュがどの runner のものかを併記する**必要がある
- **運用への帰結**: リード・ラグを捨てる話ではない。**この経路から出た候補は、名目の約1.6倍という測定済みの偽陽性率と対で読む**。そしてその数字は今回初めて存在する
- **未了**: 処方(b)(ブロック符号反転。|r| を保存するのでボラ経路も同期も温存されるが、ラグ0の同時依存も壊すため factor null の設計意図と衝突する)は未実装・未測定。(a) との優劣は同じ6模型パネルで比較できる

### #53 1分足CSVからのM15集約と、その正しさの証明(実装, 2026-07-31)

- **動機**: feature scanの検出力は運用構成で平坦ボラ15〜20bps・クラスターボラ約42bpsの1足効果を要し、実市場にその大きさは無い。規則側は既に名目内へ校正済みで、**残る律速は標本数**である。手持ちのEURUSD 1分足CSV(2012-01-03〜2026-06-30、542万行、274MB)をM15へ集約すれば、現行4,000バーに対し65倍の標本になる
- **素材の欠陥1: タイムゾーン規約が2015年に切り替わっていた**: 曜日分布で検出した。2012-2014は土曜バーが年約19,200本・月曜00-06時が0本で、週が月07:00〜土06:49に走る**JST(UTC+9)**。2016年以降は土曜0本・月曜00-06時が年約21,300本で、月00:00〜金23:59の**NY+7時間**。2015年は両者が混在する移行年。一括変換すると前半3年が6〜7時間ずれるが、**ずれが時間単位なのでM15境界には乗り、見た目では壊れていることが分からない**
- **素材の欠陥2: 2025年4月と6月が丸ごと二重**: 重複61,561件、内容の矛盾は0件。ファイル結合時の事故であり元データの品質問題ではない。非隣接に現れるため隣接重複としてではなく順序異常として弾かれる
- **規約の確定は推測ではなく実測**: 金曜の最終バーがUS/EU夏時間の食い違う3月中旬〜下旬も含め**全年23:49固定**だった。EET(EU規則)なら該当週だけ22:49へ1時間早まるはずで、そうならないことがNY+7の証拠である
- **実装**: `fxCsvM1Aggregation.ts`(純関数)と`fxCsvM1AggregationCli.ts`。`start_from_broker_date`は既定値を持たず必須とし、規約切替を無言で跨がせない。バケットは絶対UTC境界なので週末は空バケットになり金曜と月曜が結合しない。同一内容の重複は除去、内容が異なる重複は`conflictingDuplicateTimestamps`として別計上。順序異常は件数と**範囲**を報告する
- **突き合わせによる証明(2026-07-31)**: TradingView OANDA:EURUSD 15分足と重複期間で照合し、**2,809件すべての時刻が一致**した。OHLC最大差は中央値0.20pips・90%点0.70pips。15分ずれや6〜7時間ずれがあれば一致0件になるため、**タイムゾーン規則・バー開始時刻規約・集約規則の3つが同時に実証された**。価格差はOANDAとCSVベンダーというデータ源の違いによる
- **実行結果**: 261,141本(2016-01-03T22:00Z〜2026-06-30T20:45Z)、不正行0、被覆率下限未達0。除外された順序異常61,559行の範囲は**2025-03-31〜2025-06-30**で、事前に特定した重複月と一致し、実データを取り違えて捨てていないことが範囲としても確認された。61,559 + 隣接重複2 = 61,561で事前カウントと完全一致
- **証拠階層と限界**: `official_revised_history`。前向き・OOS・主検定には使えない。volumeはtick数であり出来高ではない。**NYクローズ(21:00 UTC)のバーは他ソースとの乖離が最大**(5.7〜8.5pips)で、流動性が最も薄い時間帯に対応する。研究でこの時刻を扱う際は注意が要る
- **次段階**: この標本でfeature scanの検出力曲線を引き直す。標本65倍なら最小検出効果はおよそ1/8になり、平坦ボラで2〜3bps前後まで下がる見込みで、そこで初めて実市場にありうる効果量の範囲に入る

### #54 標本拡大による検出力曲線の実測(2026-08-01)

- **検証したかったこと**: 「候補規則は名目内に校正済みだが、規則が何かを見つけられるだけの標本がない」という診断と、「標本を増やす」という処方が正しいか。理論上は最小検出効果が1/√nで下がるが、feature scanの候補規則は非重複サンプリングをhorizonで割る構造を持つため、そこが律速なら標本を増やしても曲線は下がらない。**下がるかどうかは測らないと分からない**
- **測定**: 合成white noise・M15・6特徴の運用family・horizons [1,5,21]・`bullish_body`直後へ固定bps注入。20,000本と50,000本は60複製、全点で評価不能0・失敗0
- **結果 — 標本と80%点**: 4,000本で15〜20bps(既測)、20,000本は8bpsで**93.3%** [84.1, 97.4]、50,000本は5bpsで**98.3%** [91.1, 99.7]。50,000本での曲線は2.0bps **11.7%** [5.8, 22.2]、2.5bps **26.7%** [17.1, 39.0]、3.0bps **43.3%** [31.6, 55.9]、5.0bps 98.3%で、**80%点は3.5〜4bps**と読める
- **診断と処方の両方が実証された**: 標本12.5倍(4,000→50,000)で80%点が15〜20bpsから3.5〜4bpsへ**約5倍改善**し、理論値1/√12.5 = 1/3.5とよく一致する。1時間足4,000本でクラスターボラ42bps必要だった状態から、実市場にありうる効果量の範囲へ入った
- **実標本261,141本への外挿**: 50,000本からさらに1/√5.2 = 1/2.28で**1.5〜1.8bps**。ただし外挿であり実測ではない
- **検出可能になっても収益にはならない**: EURUSDのスプレッドは0.1〜0.5 pips(1〜5bps相当)で、**検出可能になった効果量が取引コストと同じ桁**である。統計的に検出できることと、執行後に残ることは別問題であり、この区別は従来どおり維持する
- **制約1: 合成ヌル生成器の上限**: `syntheticNullSeries.ts`の`MAX_BARS = 50000`により、実標本261,141本での検出力は**直接測れず外挿になる**。100,000本を指定すると全複製が例外になり`failed`へ入り、`evaluated = 0`・`detectionRateInterval = null`となる。上限引き上げは資源保護の設定変更であり未実施
- **制約2: 計算量**: 1複製あたり20,000本で4.6秒、50,000本で10.3秒、100,000本で約21秒。261,141本を60複製で測るなら1点1.5時間級になる
- **手順上の失敗(記録)**: 最初の段階測定スクリプトが`detectionRateInterval`のnullを想定しておらず、100,000本で全複製が失敗した際に例外で停止し、**先に完了していた2点は進捗ファイルに書き出していたため助かったが、書いていなければ約15分の測定を失っていた**。長時間の測定は点ごとに永続化し、集計値がnullになりうる分岐を必ず持つ

### #55 実データfeature scanで初の候補、ただし採用不能(2026-08-01)

- **結果**: EURUSD M15 261,141本(2016-01-03〜2026-06-30、`official_revised_history`)へ校正済みゲート付きでfeature scanを実行。18バケット中**5件が`candidateEligible`**となった。本プロジェクトで実データから候補が出たのは初めてである。`calibrationId: sha256:e9b48943...`、blockLength 63、family対象18・除外0、所要1.3分
- **候補5件**: `body_direction/bearish_body` n=60,535 mean **+0.173bps** empP=0.0010、`body_direction/bullish_body` n=61,242 **-0.167bps** empP=0.0010、`directional_streak/down_streak` n=28,472 **+0.196bps** empP=0.0010、`directional_streak/up_streak` n=28,993 **-0.125bps** empP=0.0010、`range_position/lower_range` n=88,031 **+0.080bps** empP=0.0010
- **採用不能の理由1 — 効果量が検出可能領域の一桁下**: 261,141本での80%検出力点は外挿で1.5〜1.8bpsだったが、検出された効果は0.08〜0.20bps。矛盾ではない。標本が巨大なら80%点より小さい効果もp値としては極端な値を出す。**`p=0`や`empP=0.0010`(1,000反復の下限)は効果の大きさではなく標本の大きさを示している**
- **採用不能の理由2 — 符号が完全対称で機構が既知**: bullish_body -0.167 / bearish_body +0.173、up_streak -0.125 / down_streak +0.196、upper_range -0.049 / lower_range +0.080。**すべて直前の動きと逆向き**で、1分足を15分足へ集約した系列に残る短期の負の自己相関、すなわちbid-ask bounceである。falsification auditの3模型の一つ`bid_ask_bounce`が想定していた構造がそのまま実データに現れた
- **採用不能の理由3 — スプレッドの20〜60分の1**: EURUSDのスプレッドは1〜5bps相当で、0.08〜0.20bpsは執行した瞬間に消える
- **ゲートは正常に動作した**: 18バケット中13件を落とした。`gap_direction/gap_down`はp=0.024で通常の基準なら有意だが、family-wise empirical p=0.2138で棄却された。**多重度補正が実データで効いた実例**である
- **判明した規則の欠落 — 最小効果量の事前登録がない**: 候補条件は非重複Newey-West・Bonferroni・最低件数・経験的ヌルp値で構成され、**効果量の下限を一切要求していない**。標本が十分大きければ0.08bpsでも候補になる。carry主検定には`minimum_annualized_effect: 0.027`があるが、feature scanには対応物がない。スプレッドを踏まえた下限(例: 10bps)を候補条件へ加えれば今回の5件はすべて落ちる。**「統計的有意性は効果の存在を示すが大きさを何も言わない」という限界が、候補が出て初めて可視化された**
- **次段階**: (1) 最小効果量を候補条件へ事前登録する、(2) USDJPY・EURGBP・GBPAUD・XAUUSDへ横展開する。横展開では**ブローカー時刻規約をファイルごとに検証する**こと。`fxCsvM1Aggregation.ts`の`brokerClockRule`は`new_york_wall_time_plus_seven_hours`固定であり、別ソースのファイルを無検証で通すと静かにずれる

### #56 M15採用の根拠欠如と、足の長さを跨いだ再評価(2026-08-01)

- **経緯の訂正**: M15は研究上の検討を経て選ばれたものではなく、**継承された**。OANDA収集器が`granularity: "M15"`をハードコードしており、標本拡大の処方をその語で書き、1分足CSVでもそのまま採用した。当時「30分足は全銘柄で崩壊、M15はそれより細かく実行足としては未検証領域」と自ら注記しながら、標本数の魅力だけで進めていた
- **理論的な誤り**: 「標本65倍」の内訳を分解していなかった。暦期間が約0.5年→10.5年で23倍(本物の改善)、残りは1時間足→15分足の細分化である。**一定の暦期間で足を細かくしても、時間比例の効果に対する検出力は上がらない** — バー数は1/Δt、1バーの効果量はΔt、雑音は√Δtなので、t統計量は μ√n/σ ∝ Δt^0 となり足の長さに依存しない。#54の検出力曲線は足を固定して暦期間を伸ばした測定であり、そちらは有効
- **同一素材から4足を作成して再評価**: 検証済みのタイムゾーン規則と集約規則をそのまま使い、`--bucket-minutes`のみ変えた。M15 261,141本、M60 65,293本、M120 33,010本、M240 16,884本。いずれも不正行0
- **候補数は足を長くするほど単調に減る**: M15 **5件**、M60 **1件**、M120 **0件**、M240 **0件**(各18バケット中)
- **効果量はバー数比例で増え、有意性は標本減少で相殺された**: `body_direction/bearish_body`は+0.173bps(empP 0.0010)→+0.296(0.0070)→+0.424(0.114)→+0.797(0.185)。16倍の足で効果量は約4.6倍、つまり**Δt比例(16倍)ではなく√Δt比例(4倍)に近い**。時間比例の効果ではなく**1バーごとに一定量の平均回帰が起きる**性質であり、単位時間あたりでは足を長くするほど薄まる
- **符号の反転パターンは全足で維持**: bullishが負、bearishが正、up_streakが負、down_streakが正。M240まで残るため、1〜2バーで減衰する純粋なbid-ask bounceだけでは説明できない。ただしM120以降は候補基準を通らない
- **結論 — 採用可能な手法は見つからなかった**: 4足すべてで候補基準を安定して通る構造はない。M15の5件は26万本の標本が生んだもので、M60では反対側の`bullish_body`がempP 0.2288で落ち対称性を欠く。**最大のM240 `bearish_body`でも0.797bpsで、EURUSDのスプレッド1〜5bpsの5分の1以下**。足を16倍にしてもコストを超えない
- **律速の再特定**: 足でも標本でもなく、**EURUSDの短期構造にスプレッドを超える大きさがない**こと。#54で標本を増やせば検出力が上がることは実証されたが、検出できる領域に採用可能なものが無かった。M15継承の指摘は正しかったが、「1時間足なら見つかる」という含みは外れた

### #57 最小効果量10bpsの事前登録(実装, 2026-08-01)

- **決定**: 全通貨共通で**10bps**を候補条件へ事前登録した。#55で判明した「候補規則が効果量の下限を一切要求していない」欠落への対処であり、EURUSDのスプレッド1〜5bpsを踏まえた値である
- **実装**: `FeatureOutcomeRelationshipsInput.minimumEffectBps`を**既定値なしの必須**とし、候補判定を`exploratoryEligible && empiricalPasses && meetsMinimumEffect`へ変更した。`meetsMinimumEffect`は`|mean| * 10000 >= minimumEffectBps`。不成立時は`candidateBlockers`へ`minimum_effect_size_not_met`を出し、`effectBps`は下限に関わらず常に報告する。`definition`へも含めたので**下限の違う結果は`definitionHash`が変わり、同じ契約として混同できない**
- **型だけでは足りなかった**: テストが`.mjs`のため、TypeScriptで必須にしても`undefined`が黙って通る。`validate()`へ実行時検証を入れたところ**22件のテストが落ち**、全呼び出し元が炙り出された。既存テストは下限なしの挙動を検証しているため`minimumEffectBps: 0`を明示させ意味を保存した。**沈黙が「下限なし」を意味しない**構造にした
- **配線時の事故**: 一括置換が`run_lead_lag_falsification_audit`と`carry_panel_preflight`にも`minimumEffectBps`を注入した。型エラーで検出・除去したが、**型検査がなければ静かに混入していた**
- **EURUSD 4足の再評価 — 全て候補ゼロ**: M15 261,141本 5件→**0件**、M60 65,293本 1件→**0件**、M120 33,010本 0件、M240 16,884本 0件。M15の5件(0.08〜0.20bps)とM60の1件(0.296bps)はいずれも10bpsに遠く及ばず落ちた。**統計的有意性だけで候補になっていたものが、効果量の要求で正しく排除された**
- **未了 — 校正値の再測定**: 下限は候補規則の変更であるため、#52の判定順序に従えば既存の校正値は無効である。合成ヌルでの偽陽性率(white noise 0.0% / regime-switching 0.5% / bid-ask bounce 1.0%)も、検出力曲線(50,000本で80%点3.5〜4bps)も、**下限のない規則に対する測定**だった。10bps下限では10bps未満の効果は構成上検出不能となり曲線の意味が変わる。**横展開の前に同一3模型で再校正する必要がある**
- **横展開への含意**: 下限がなければ、標本の大きい足で必ずbid-ask bounceが候補として出て「候補あり、ただし全部コスト以下」を4通貨×4足で繰り返すことになった。下限を先に決めたことで、**候補が出れば初めて意味を持つ**
- **指摘と修正 — 10bpsが固定されていなかった(2026-08-01)**: 初回実装は`minimum_effect_bps`を`.min(0)`の可変パラメタにしていたため、**呼び出し側が`0`を渡せば10bps未満の候補を再び記録できた**。事前登録ルールが呼び出しごとに緩められる状態は研究者自由度そのもので、#45/#52が排除しようとしてきたものである。凍結定数`FEATURE_OUTCOME_CANDIDATE_MINIMUM_EFFECT_BPS = 10`を導入し、純関数は等値でないものを全て拒否、MCPスキーマ3箇所は`z.literal`とした。マジックナンバーではなく名前付き定数から引くことで、将来v2で変える際に1箇所で済み変更が追跡できる
- **探索モードの分離は不要だった**: `exploratoryEligible`は元から下限を適用せず、`effectBps`は下限に関わらず常に報告される。**探索経路は既に候補記録から構造的に分離されている**ため、可変値を残す必要がない
- **迂回不能の実測**: `0` / `5` / `9.99` / `undefined` / `null` / 文字列`"10"`はすべて拒否され、数値`10`のみが通過する。回帰テストで`run(0)`と`run(5)`が例外になることを固定した

### #58 10bps下限での再校正(2026-08-01)

- **必要性**: 下限は候補規則の変更であり、#52の判定順序に従えば既存校正値は無効。偽陽性率(0.0/0.5/1.0%)も検出力曲線(50,000本で80%点3.5〜4bps)も下限のない規則に対する測定だった
- **偽陽性率 — 4,000本・200複製・6特徴(元の校正と同条件)**: white noise **0.00%** [0.00, 1.88]、regime-switching volatility **0.50%** [0.09, 2.78]、bid-ask bounce **0.50%** [0.09, 2.78]。全点で評価不能0・失敗0・`complete`。**下限なし(0.0/0.5/1.0%)からほぼ変わらない**。4,000本では下限なしの80%点が15〜20bpsであり10bps下限より高いため、**この標本では統計的検出力の方が先に効いていて下限がほとんど拘束していない**
- **検出力 — 50,000本・60複製・white noise**: 8bps **0.00%** [0.00, 6.02]、12bps **100.00%** [93.98, 100.00]、15bps **100.00%** [93.98, 100.00]。全点で評価不能0・失敗0
- **下限が機能している直接の証拠**: 8bpsは下限なしなら80%点3.5〜4bpsを大きく超えており統計的には確実に検出できるが、**0/60で全て落ちた**。構成上の拒否が実測された
- **規則はほぼ階段状になった**: 10bps未満は一切候補にならず、12bpsで既に完全検出。曖昧な中間帯がない。**50,000本以上の標本では、候補が出た時点でそれは10bps以上の効果である**
- **これは規則の性質であって市場の性質ではない**: EURUSDの実効果量は4足の最大でもM240の0.797bpsで、10bps下限の12分の1以下。今回の再校正が示すのは「もし12bpsの効果があれば確実に見つけられる」ことだけである
- **横展開の準備完了**: 候補規則は凍結され、迂回不能で、3模型に対する偽陽性率と下限を跨ぐ検出力の両方が測定済み。USDJPY・EURGBP・GBPAUD・XAUUSDへ進める状態になった

### #59 6通貨×4足の横展開 — 候補ゼロ、ただし規則の穴が一つ露出した(2026-08-01)

- **供給されたデータ**: 予告(ドル円・ユーロポンド・ポンドオージー・ゴールド)に対し実際は **AUDNZD・EURGBP・GBPUSD・USDJPY・XAUUSD** の5本。GBPAUDは無く、AUDNZDとGBPUSDが入っていた。全6本とも2012.01.03〜2026.06.30、約5.4M行・274MB
- **時刻規約はファイルごとに検証した(#55の指示どおり)。結果、FXとゴールドは別系統だった**:
  - FX5本: 2012〜2015は**固定UTC+9(東京、夏時間に追随しない)**、切替は**2015-06-27/28の週末**で5本とも同一、以降 NY+7。早期の週末クローズが冬06:49/夏05:49と季節で動くことが固定offsetの証拠
  - XAUUSD: 2012〜2018は**固定UTC+2**、切替は**2018年9月と10月の間**、以降 NY+7。日次休止(NY 17:00-18:00)が3〜10月はhour 23・11〜2月はhour 00と季節移動することが証拠
  - **同一ベンダーでも切替時期も早期規約も違った**。無検証で通していれば7時間ずれていた
- **後期regimeの検証**: post-2016のFX金曜2765本のうち時間単位で逸脱するものは**0本**(唯一の逸脱は2021-04-02 Good Fridayの10分早仕舞い)。固定UTC+2なら夏の金曜が22:49に出るはずで、出ていない
- **採用範囲**: FX 2016.01.01〜(M60で65,276本)、XAUUSD 2019.01.01〜(44,017本)。**ゴールドだけ暦期間が3年短く、検出力の条件が揃っていない**
- **結果 — 6通貨×4足=24走査すべて候補ゼロ**。432セル(24×18バケット)中の最大効果量は **+4.57bps**(EURUSD M240 gap_up, n=53, empP=0.3257で有意ですらない)。**10bps下限の半分にも届かない**
- **#55の教訓が別通貨で再現した**: AUDNZD M60 `gap_direction/gap_down` は empP=**0.0010** と極端な有意性を出しながら効果量は**+2.71bps**。標本の大きさがp値を作り、効果の大きさとは別物であることの再確認
- **一度は候補が出た — そしてそれは集約が作った人工物だった**: 被覆率下限なし(`minimum_minute_coverage: 1`)の初回走査で XAUUSD M15/M60 の `gap_direction/gap_down` が候補になった(+22.6bps / **+38.5bps**、empP=0.0010)。ゴールドのスプレッド約1bpsを大きく超え、一見採用可能に見えた
  - **診断**: gap_down 426件のうち **369件(87%)がUTC 21:00と22:00**、すなわち日次休止の時間帯に集中。**351件(82%)は信号バーか直前バーの被覆が半分未満**。その群は+46.8bps、両方が半分以上埋まった75件は**−3.6bpsと符号が逆**
  - **機構**: 休止中の散発的な数分の約定だけでバケットが1本作られ、それが「窓」を生み、通常取引の再開が「窓埋め」に見えていた
  - **感度測定で調整でないことを示した**: 被覆率下限を10%〜100%のどこに置いても平均は+37.9bps→−3〜−7bpsに変わる。**値の選び方が結論を左右しない**ため、これは閾値調整ではなく訂正である
  - **修正後**: 同バケットは M60 で **−2.50bps・empP=0.9970**、3条件すべてで棄却。符号ごと反転して有意性を失った
- **露出した規則の穴 — 候補規則にバーの被覆率に関する要求が一つもない**: この人工物は Newey-West・Bonferroni・経験的ヌル・10bps下限を**すべて通過した**。経験的ヌル(循環移動ブロックブートストラップ)は同じバーを再標本化するので、**人工物をそのまま保存する**。#57で最小効果量の欠落が候補が出て初めて可視化されたのと同じ構造で、**今回も候補が出て初めて可視化された**
- **今回は集約層で対処した**: 「バーはその区間の半分以上を占めていること」を全通貨・全足へ一律適用(M15→8分、M60→30分、M120→60分、M240→120分)。FXでの除去率は0.03%、ゴールドは2.47%。**FXに日次休止が無かったため今まで顕在化しなかっただけ**
- **規則側は検知できない、という結論**: 当初「候補条件へ被覆率を足す」を検討したが、**`OhlcvBar` は自分が何から作られたかを持たない**ため原理的に不可能。情報は集約マニフェストの `minimum_minute_coverage` にしかない。よって正しい境界は「規則へ条件を足す」ではなく**判定を出す側が渡された出自を検証する**ことであり、統計そのものは変わらないので**再校正は不要**

### #60 凍結規則が入口で緩む3箇所の封鎖(実装, 2026-08-01)

- **共通の型**: 10bpsの `.min(0)` 指摘と同じく、凍結したはずの規則が呼び出し口で緩む。#59で3箇所が同時に露出したためまとめて封鎖した
- **(1) 集約の被覆率が既定 `1`** → **必須引数化**。`--start-from-broker-date` と同じ扱いで、既定値を持たない。「バーが何から作られてよいか」は継承ではなく明示する
- **(2) 走査が出自を検証していなかった** → `assertAdmissibleAggregate` を追加。**バーはその区間の半分以上を占めていること**を要求し、満たさない集約は具体的な再集約コマンドを添えて拒否する。M15→8分、M60→30分、M120→60分、M240→120分と足に比例
- **(2の続き)最初の実装はラベルだけを見ていた**: 当初は `manifest.minimum_minute_coverage` のみを確認しており、**バー配列を一切見ていなかった**。マニフェストは「集約に何を要求したか」の記述であって、隣にあるバーがそれを守っている証拠ではない。両者は同じファイルに同居しており、部分編集や取り違えで容易に食い違う。**中身を信じてラベルを検証するのは、この検証が拒否するために存在するはずの種類の主張そのもの**だった。バー単位で `bar_count` 一致、時刻の狭義単調増加、バケット境界への整列、`minutesPresent` が下限以上かつ足以下、OHLCの有限性と蝋燭としての整合、`first_bar_at`/`last_bar_at` の一致を検査するよう修正
- **(2の続き2)構造検査だけでは同一性を保証できない**: 上記の検査は**すべて通る別系列**が存在する。件数・格子・被覆率・蝋燭の整合をすべて満たしたまま価格だけ差し替えれば素通りする。`manifest.normalized_sha256` を実バーから再計算して照合するよう追加した。**構造検査は「走査可能な系列の条件を満たすか」を、ダイジェストは「そもそもマニフェストが記述しているバーなのか」を答える別の問い**であり、前者は後者の代わりにならない。両方を残している。実測で16,208本中1本の終値を 1e-9 動かした改変を検出、本番24本は全て通過
- **(2の続き3)`bucket_minutes` の日次除算チェックが漏れていた**: 整数・範囲のみで `1440 % bucket_minutes === 0` を見ていなかった。絶対UTCスロットで刻む以上、日を割り切らない足はバケットとして意味を成さない。集約側と同じ条件を、**強制されたと仮定せず走査側でも明示的に再検査**するよう追加
- **(3) MCP既定閾値が校正済み構成と違った** → 既定を `FEATURE_OUTCOME_CALIBRATED_STUDY` へ向け、単一の凍結定数に統一。wick 0.2→0.6、ATR 0.75/1.5→0.8/1.2、gap 0.25→0.5、最低件数 100→30。**最低件数の差は特に危険で、大きくすると経験的ヌルの族が縮んで検定が緩む**方向に働いていた
- **設計上の誤りを一度作って直した — 純関数で拒否してはいけない**: 最初は `computeFeatureOutcomeRelationships` 内で未校正構成を例外にしたが、これは既存13テストを壊した。原因は表面的なテストの問題ではなく設計の誤りで、**反証監査・検出力監査の仕事は「与えられた任意の構成の誤り率を測る」こと**である。純関数がそこを塞ぐと**新しい構成を校正する手段そのものが失われる**
- **正しい境界**: 純関数は `inferenceContract.matchesCalibratedStudy` と `calibratedStudyDepartures` で**報告**するに留め、**実市場に対して判定を出す入口**(MCPツール `compute_feature_outcome_relationships` と `scan:fx-csv`)で**強制**する。監査は未校正構成を意図的に走らせられるまま
- **`configurationTrials` は敢えて拘束していない**: 試行数を多く申告するとBonferroni閾値が縮むだけで保守側に働く。少なくすることは下限1のため不可能
- **単一真実源**: 校正済み構成を `FEATURE_OUTCOME_CALIBRATED_STUDY` として定義し、MCPツール既定・CSV走査契約・境界検証がすべてこれを参照する。構成の書き換えはテストで検知される
- **(3の続き)最初は不一致の5個だけを定数化していた**: 一致していた `14, 50, 20, 3, 0.5, 0.33, 0.67, 0.95` は直書きのまま残しており、**導出されているように見えて実際は手で一致させているだけ**という中途半端な状態だった。定数が動けば既定値が黙って乖離し、今回のバグが再発する。feature scan系3ツール全ての既定値を定数から導出するよう修正
- **その修正で一度広げすぎた**: 一括置換が `run_market_event_study`・`compute_market_regimes`・`run_external_label_study`・`compute_lead_lag_relationships` など**無関係な9ツール**にも及び、それらを feature scan の校正定数へ結合させてしまった。`confidence_level ?? 0.95` や `atr_lookback ?? 14` は他系統でも使われる値であり、同じ数値であることと同じ意味であることは別。該当行を戻し、`compute_feature_outcome_relationships` / `run_feature_outcome_falsification_audit` / `run_feature_outcome_power_audit` の3ツールに限定した
- **走査の入口を作った**: `scan:fx-csv`(`fxCsvFeatureScanCli.ts`)。**校正済み閾値を定数として凍結しCLI引数にしていない** — 当て直せる走査は当たるまで当て直せるため。テストが構成の書き換えを検知する。EURUSD M15で#55の5件を n と効果量まで完全再現し、そのうえで候補0件・全件 `minimum_effect_size_not_met` で落ちることを確認した

### #46 実効多重度 K_eff の併記(実装, 2026-08-01)

- **実装**: `effectiveMultiplicity.ts`。経験的ヌルの反復から、族の依存構造と最小p値分布の両方を**同じ一組の反復**から導く。リード・ラグの経験的ヌルへ配線(隣接ラグ相関がこの課題の動機そのもの)。`configuration_trials` と Bonferroni は一切変更していない
- **設計判断の変更 — 主推定量を固有値系から測定型へ**: 記録済み設計は Li–Ji 等の固有値推定法から一つ選ぶ想定だったが、リード・ラグの族統計量は `|atanh(r)|·√(n−3)` で**折り返した**分布である。固有値系は符号付き統計量の相関行列を前提とするため、絶対値では依存を過小評価する。実測で確認: AR1 φ=0.9 の族で符号付き→絶対値にすると Li–Ji が 8.00→11.00、Galwey が 9.02→13.15 と動く。測定型は 9.58 で**両者で完全に同一**
- **事前登録した主推定量**: `empirical_null_minimum_p_value`。各検定を**自分自身のヌル列**に対する順位でp値化し、族の最小p値の α 分位から `K = ln(1−α)/ln(1−t_α)` を解く。分布形状に一切依存せず、完全依存なら1、独立なら名目数を返す
- **設計ミスを一つ作って直した — 最初の実装は標準正規を仮定していた**: 当初は族の最大統計量を標準正規の裾で逆算していた。合成データでは正しく動いたが、**実際のリード・ラグに通した瞬間に破綻**した。系列相関のある収益率では Fisher-z が標準正規から大きく外れるため、K_eff が 25検定の族で **2,375 / 23,779 / 1.75e11** と、名目数を原理的に超える値を返した。**測っていたのは族の多重度ではなく周辺分布の誤設定**であり、しかもそれが起きるのは系列相関のある場合、つまりこの課題の動機そのものの場面だった。順位ベースへ変更して解消。「名目数を超えない」ことを回帰テストで固定した
- **推定法どうしの一致(実測)**: リード・ラグ族で測定型 8.5 / 5.1 / 12.8 / 5.1 に対し Li–Ji 10.0 / 5.0 / 11.0 / 6.0、Galwey 10.0 / 5.6 / 13.4 / 5.3 とよく一致する。**Cheverud–Nyholt だけが外れ値**(帯状構造で 22.3 / 16.1)で、既知の不安定さがそのまま出た。推定法の選択が自由度になるという懸念に対し、**選ぶのではなく突き合わせる**形で答えている
- **点推定を裸で出さない**: 1,000反復(経験的ヌルの実運用値)では独立21検定の推定値が 17.4〜30.3 に散る。反復数由来の標本誤差だけを覆う95%区間を併記する。400,000反復まで上げると偏りは −0.01 に収束するので、これは偏りではなく分散
- **採用判定には一切使っていない**: `usage: "reported_only_never_used_in_any_eligibility_decision"` を結果に持たせ、テストで固定。**推定法の識別子のみ**を経験的ヌル契約へ入れて `calibrationId` に載せた(値そのものはデータ依存の出力なので契約に入れない)
- **定義域を外れる問題を後から塞いだ**: 経験的分位はp値の格子上にあるため、`[1, 族の大きさ]` を外れる。完全依存の4検定・100反復で **0.836**(R=20,000では0.999)、独立21検定・1,000反復では区間上限が **25.6** に達した。K_effは「独立検定何個分か」なので範囲外は推定ではなく数値ノイズであり、点推定・区間の両方を範囲内へ収めた。**ただし黙って丸めない** — 真の1と丸められた1が区別できなくなるため、`rawEffectiveTests` に生値を残し、丸めが効いた場合は `limitations` へ明示する。上限は `nominalTests` ではなく**測定した列数**とした。`nominalTests` は `configuration_trials` を含み得るが、ヌル反復はそれを知らないため、測定対象を束縛できるのは測定対象自身だけである
- **feature scan へも配線済み**: 18バケットは同一のバー列から切り出されており、リード・ラグの隣接ラグと同じ構図。既存のヌル反復からバケット別統計を保存して推定する(新しい乱数は引かない)
- **配線前後で判定が一切動かないことを実測で示した**: 配線**前**に固定シードの走査を実行して全バケットの `familyWisePValue` と候補数を記録し、配線後に再実行して差分を取った。変化したのは意図した2点のみ — `methodologyVersion`(v2→v3)と `calibrationId`(推定法識別子を契約へ入れたため)。**blockLength 10、familyEligibleBuckets 13、14バケットのp値すべて、候補数0が完全一致**。この記録済みの値をテストへ literal として固定した
- **バージョン方針**: 統計的な再校正は不要(判定が変わらないため #58 の偽陽性率・検出力はそのまま有効)だが、**出力契約が変わったため** `feature_outcome_empirical_null_circular_moving_block_v2` → `v3`
- **不変であることをテストで固定**: `familyTests` が 54(18バケット×3地平線×1試行)、`bonferroniAdjustedAlpha` が α/54 のまま、`inferenceContract` に `effectiveMultiplicity` も `effectiveTests` も**存在しない**ことを表明している
- **実データ測定で主推定量の解像度不足が判明した**: 6通貨×2足=12走査すべてで K_eff が **12.8 ちょうど**。偶然ではなく**量子化**である。1,000反復では最小p値が `k/1000` の格子にしか乗らないため、K の取り得る値は 51.3 / 25.6 / 17.1 / **12.8** / 10.2 / 8.5 ... と離散的で、**18検定の族が位置する 10〜18 の範囲には3つしか存在しない**
- **比較用推定量の方が解像していた**: 同じ12走査で Li–Ji は 14.0〜16.0、Galwey は 13.3〜16.2 と通貨ごとに変動し、両者はよく一致する(XAUUSD 14.0/13.3、EURUSD 16.0/16.1)。**通貨間に実際の差はあるのに、事前登録した主推定量がそれを分解できていない**
- **対処 — 反復数は上げず、粗さを明示した**: `EMPIRICAL_NULL_ITERATIONS` は校正契約の一部であり、上げれば family-wise p 値が変わって #58 の再校正が必要になる。**報告専用の診断量のために判定側の契約を動かすのは本末転倒**なので、`attainableNeighbours`(格子上の隣接値)を結果へ持たせ、`limitations` に量子化を明記した。実測例では K_eff=13.0 に対し隣接値が 10.3 と 17.4
- **読み方**: 現状 feature scan の K_eff は「12.8」という点ではなく「**10〜17のどこか、おそらく13〜16**」と読むべきで、Bonferroni が構成上 54 で割っていることに対し、バケット次元での過大評価はおよそ 1.1〜1.3 倍にとどまる。**基準を緩める根拠にはならない**

### #46 実効多重度 K_eff の併記(元の設計メモ)

- **課題**: `configuration_trials` は名目カウントで、Bonferroni参考αをそこから直接作っている。候補同士が相関している場合、名目Kは多重度を過大評価する。銅/金のラグスキャンは隣接ラグ同士が強く相関する典型で、21ラグを独立21試行として扱うのは保守的すぎる。逆に閾値を少しずつ変えた探索も同様
- **設計**: `configuration_trials`(名目K)は現状のまま残し、候補間相関を考慮した `effectiveTrials`(K_eff)を**参考値として併記**する。**自動採用の判定には一切使わない**。推定法の選択そのものが研究者自由度になるため、採用ロジックへ入れると新しい自由度を持ち込むことになる。どの推定法を使ったかを定義ハッシュへ含め、後から比較できるようにする
- **注意**: K_effが名目Kより小さく出ると基準が緩む方向に働く。緩める根拠として使えるのは、推定法を事前に固定した場合だけ
- **規模**: 小〜中。#45 の合成ヌル環境があれば、K_eff推定法自体の妥当性もそこで検証できるため、#45 の後に着手する

### #73 マクロイベント反応の母集団定義 — 事前登録(測定前に記録, 2026-08-05)

**本項は測定を実行する前に記録・コミットした。** #72 の「育成」で定めた順序(母集団定義 → 同一レジーム対照 → 経験的ヌル → 前向き/OOS)の**第1段階**であり、候補規約へは一切進めない。

**観測格子とアンカー**
- **M15**。この格子は内生的な価格特徴量ではなく、**公表時刻を漏れなく載せるための観測格子**として選ぶ
- **アンカー = 発表時刻ちょうどに始まるバー**。全343イベントで検証済み: 発表は例外なく15分境界に落ちる。CPI/NFP の252件は**一度も**60分境界に落ちない(12:30/13:30 UTC)ため、M60 では3種別すべてに正確なアンカーを置けない。M15 が唯一の格子である

**母集団は3つ、混ぜない**
- `us_cpi`(126件, 2016-01-20〜2026-07-14)、`us_nfp`(126件, 2016-01-08〜2026-07-02)、`fomc_statement`(91件, 2016-01-27〜2026-07-29)
- **プールしない**。CPI・NFP・FOMC それぞれに同じM15・同じ5点horizon・同じ手続きを適用する

**銘柄と、それぞれの役割**
- **USD直結3ペア**: EURUSD / USDJPY / GBPUSD
- **非USDクロス2ペア**: EURGBP / AUDNZD
- **XAUUSD**: 対照ではなく、米金利・実質金利に敏感な**独立した反応系列**
- **役割の訂正を明記する**: EURGBP と AUDNZD は「反応するはずがないゼロ対照」ではない。米国指標はリスクセンチメント、金利期待、各中央銀行の相対見通しを通じてクロスにも波及し得る。**USD直結3ペアより反応が弱いはずの比較対照**である。したがって事前固定する比較は `USD直結3ペア` 対 `非USDクロス2ペア` の**反応差**であって、有無ではない
- 期間: FX は 2016-01-03 から、XAUUSD は 2019-01-02 から(データ側の制約)
- `OANDA_EURUSD_M15` は7番目の構成銘柄ではなく、**別ブローカーによる EURUSD の再現確認用**に留める

**horizon**
- 全体は **`1 / 2 / 4 / 8 / 16` 本を固定して反応曲線として保存**する
- **主判定は4本後(60分)**。即時の板・約定処理だけに寄らず、FOMC なら会見開始も含む「政策発表パッケージ」への反応として読む
- `t+1, t+2` は初動の伝播確認。**候補選択には使わない**
- `t+8, t+16` は持続・反転・セッション移行の診断用。**候補化には使わない**
- 5点は上で凍結した。結果を見て主horizonを差し替えれば、それは事後選択である

**反応の測り方**
- コンセンサス(事前予想)を収集していないため**サプライズの符号が不明**であり、符号付き収益率には予測可能な向きが存在しない。したがって主指標は**大きさ**とする: `|log(close_{t+h} / close_t)|`(bps)
- 符号付き収益率も反応曲線に保存するが、**判定には使わない**
- **銘柄間の比較可能化**: 各銘柄・各horizonについて `反応比 = |収益率| / 同一時刻スロット非イベントバーの |収益率| 中央値` とする。ベースラインは当該イベントより**厳密に過去**の同一スロット観測 **52本**のみから作る(因果的)。52本に満たないイベントは除外する
- **非イベントバーの定義**: 3種別いずれのイベントからも前後16本以内にないバー
- **時刻の交絡は実在し、大きい**。EURUSD の CPI 発表バーの平均 |t+4 収益率| は 13.1bps だが、**同一時刻スロットの非イベント日**でも 10.3bps ある。全バー平均を分母に置けば比はもっと大きく出るが、その差の大半は「12:30 UTC は元々動く」でしかない。ベースラインを同一スロットに固定しない設計は誤りである

**欠損と重複の規則(実測に基づき事前固定)**
- **反応窓が他の発表に重なることは一度もない**。全343件で「あるイベントの t+16 終端」と「次のイベント開始」の最小ギャップは **90分**。CPI と FOMC の同日は7件あるが(2016-03-16 など)、CPI 12:30 の t+16 は 16:30 に終わり FOMC 18:00 に届かない。**除外は不要**とし、`same_day_other_event` フラグのみ記録して次段階の感度確認に使う
- **アンカー欠損**: FX5ペアすべてで `fomc_statement 2020-03-15T18:00Z` のアンカーが存在しない。**日曜の緊急利下げ**であり市場が開いていない。XAUUSD はさらに8件欠く(2020-04-10・2021-04-02・2023-04-07 の聖金曜日など、金の休場)
- **規則**: FX5ペアのいずれか1つでもアンカーを欠くイベントは、**5ペアすべてから除外**する(比較対照が同一イベント内の差である以上、パネルは均衡していなければならない)。XAUUSD は独立系列なので、**自身の欠損は自身だけを落とす**
- **有効アンカー数(データ終端まで)**: CPI 125 / NFP 125 / FOMC 89(FX5ペア)、CPI 86 / NFP 86 / FOMC 64(XAUUSD)。データ範囲内での欠損は上記の緊急FOMC1件のみであり、残りの差はすべてデータ終端(2026-06-30)による

**次段階へ進む入口条件(すべて満たすこと、3種別それぞれで)**
1. **反応が観測可能な大きさである**: USD直結3ペアの h=4 反応比の中央値が 1.0 を明確に超える
2. **対照が機能する**: USD直結3ペアの反応比が非USDクロス2ペアを上回る
3. **標本が足りる**: 有効イベント数が80件以上
- 満たさない種別は、その時点で打ち切る。3種別を平均して救済しない

**大きさは、それ自体では取引可能な優位性ではない**
- これは本項で最も誤りやすい点なので明記する。反応比が大きいことは**変動が大きい**ことしか意味せず、**向きを伴わない**。「13bps の反応は 1〜2bps のコストを超える」から利益が出る、という推論は**成立しない**
- 大きさが直接支える用途はボラティリティの見積りと**執行の回避**であり、方向性仮説の**代替ではなく前提**である。方向を測るにはコンセンサス系列(サプライズ)の収集が別途要る。#59 の律速(効果量がコストを超えない)は、この区別を飛ばした瞬間に別の形で戻ってくる

**凍結前に見てしまった数値の開示**
- 本項を書く前に、格子検証と交絡の大きさを確かめる過程で **EURUSD の h=4 反応**を見た: CPI 13.1bps 対 同一スロット非イベント 10.3bps(1.27倍)、NFP 15.5bps 対 10.3bps(1.51倍)。いずれも**全標本ベースライン**であり、上で凍結した因果的52本ベースラインとは別物である
- それでも露出は露出である。**USD直結側の1銘柄について、主horizonの反応がベースラインを上回ることを凍結前に見た**。非USDクロス2ペアと XAUUSD は見ていない。入口条件1は、この開示を前提に読むこと

**測定前に締めた点**: 入口条件1の「1.0 を明確に超える」には数値が入っていなかった。測定前に**区間下限で判定する**方式へ確定した(本プロジェクトの `exceedsNominalAlpha` と同じ)。緩める方向ではない。再標本の単位は**イベント**とする(同一イベント内の銘柄は相関するため、まずイベントごとに群値へ畳む)。

- **結果 — 入口条件の測定(2026-08-05)**

**プラセボが装置の欠陥を捕まえた**。非イベントバー(同一時刻スロット、全イベントから前後16本超)へ同じ手続きを掛けると、比は 1.0 に中心を持たなかった。切り分けると **per-symbol のプラセボは 0.98〜1.09 でベースライン自体は健全**であり、歪みは**群内集約**にあった。右に歪んだ比を USD直結3銘柄では中央値、非USDクロス2銘柄では実質平均で畳むため、**群サイズだけで系統差が出る**。差統計量の真のヌルは 0 ではなく **−0.120** である。

- **対処 — 推定量は変えず、誤っていた帰無点を置き換えた**。結果を見てから estimator を選び直せば、それは研究者自由度である。統計量は凍結どおり据え置き、参照分布のみ**イベントのスロット構成を一致させたプラセボ5000標本**へ差し替えた。#72 の「難所は経験的ヌルである」がそのまま当たった箇所であり、**プラセボがこの設計の経験的ヌルである**
- **ヌルの妥当性**: 水準統計量のヌル中央値は **0.999**(構成上の期待値 1.0)。装置が正しく較正されていることの確認になっている

| 種別 | 有効n | t+4 水準 (ヌル95%) | p | t+4 差 (ヌル95%) | p | 判定 |
|---|---|---|---|---|---|---|
| `us_cpi` | 122 | 1.287 (1.140) | 0.0018 | **0.004** (0.031) | **0.0804** | **打ち切り** |
| `us_nfp` | 122 | 1.669 (1.136) | 0.0002 | 0.147 (0.026) | 0.0018 | 次段階へ |
| `fomc_statement` | 87 | 4.843 (1.157) | 0.0002 | 3.001 (0.075) | 0.0002 | 次段階へ |

- **多重性**: 3種別 × 2条件 = 6検定。Bonferroni 参考 α = 0.0083 に対し、NFP の差 0.0018 と FOMC の両条件(5001分の1の下限)は通過する。CPI の差 0.0804 は補正前でも通らない
- **修正が NFP を有利にしたことを開示する**: 人工物は差を**下方**に偏らせていたため、ヌルを正すと NFP は「区間下限がかろうじて0を超える」から「明確に通過」へ動いた。CPI の判定は修正前後で変わらない。**装置の較正はプラセボだけで決めており結果は見ていない**が、動いた方向は記録しておく

**反応曲線 — 事前登録が実際に効いた箇所**

| 種別 | t+1 | t+2 | **t+4** | t+8 | t+16 |
|---|---|---|---|---|---|
| `us_cpi` 差 | **0.370** | 0.082 | **0.004** | -0.132 | -0.016 |
| `us_nfp` 差 | 0.313 | 0.341 | 0.147 | 0.168 | 0.009 |
| `fomc_statement` 差 | 0.643 | 2.092 | **3.001** | 2.761 | 1.511 |

- **CPI は t+1 でなら通っていた**。horizon が自由なら「CPI も通過」と書けた。#73 は主判定を t+4 に凍結しており、**この救済は禁じられている**。打ち切りが正しい。誘惑があったことをここに明記しておく
- **FOMC の曲線は事前登録の理由づけを裏づけた**。「即時の板・約定処理だけに寄らず、会見開始も含む政策発表パッケージへの反応として読む」ために t+4 を選んだが、実際の跳ねは **t+1 の 0.643 から t+2 の 2.092**、すなわち声明の30分後 = **記者会見の開始時刻**に起きている。理由が先にあり、曲線が後から一致した
  - ただし**2019年より前は会見が年8回中4回しかない**。これは検証可能な精緻化だが**事後の分割**であり、#71 の規定どおり**診断を継続の根拠にしない**。次段階の設計へ回す

- **大きさは依然として方向ではない**。FOMC の 4.8倍は「発表後60分の値動きが平常の約5倍」であって、**どちらへ動くかは何も言っていない**。次段階へ進むのは反応の測定であって、取引可能性ではない
- **次段階(同一レジーム対照)へ進むのは `us_nfp` と `fomc_statement` の2種別**。`us_cpi` は #73 の規定どおりここで打ち切る。3種別を平均しての救済はしない

- **手続きの実装と、そこで見つかった3つの欠陥(2026-08-06)**

上の測定はスクラッチパッドのスクリプトで実行しており、リポジトリから再現できなかった。凍結定義を `src/macroEventResponse.ts` として実装し、契約ハッシュ `sha256:c0502de8...` をテストへ固定した。**実装の過程で、上の数値を生んだ手続きに3つの欠陥が見つかった**。

1. **ガードが全3種別を確実に覆っていなかった**。ヌルの非イベント基準は「3種別いずれの発表からも前後16本超」と凍結してあるが、スクリプトは呼出側が渡した一覧を使うだけで、渡し忘れを検出できなかった。実装では**3つの公式artifactを受け取り、ガードを内部導出**する。ガードにしか使わない種別もカバレッジ証明を要求する
2. **欠損M15バーを跨いで horizon return を計算していた**。`position + horizon` は行数であって時間ではない。FX集約は週末と祝日を飛ばすため、`t+4` が60分ではなく週末を跨ぐ窓になり得た。実装では**両端がちょうど horizon 個分のバケット離れていること**を必須にする
3. **符号付き収益率を保存していなかった**。凍結文書は「符号付き収益率も反応曲線に保存するが、判定には使わない」と定めている。実装で保存するようにした

- **欠陥2は実測値を動かした**

| 種別 | 有効n | t+4 差 | p | 判定 |
|---|---|---|---|---|
| `us_cpi` | 122 → 122 | 0.004 → 0.004 | 0.0804 → 0.0756 | 打ち切り(不変) |
| `us_nfp` | 122 → 122 | 0.147 → 0.147 | 0.0018 → 0.0022 | 次段階へ(不変) |
| `fomc_statement` | 87 → **85** | 3.001 → **3.249** | 0.0002 (不変) | 次段階へ(不変) |

- FOMC は**2件が窓の不連続で除外**された。ベースライン側も FX 各通貨で約9,200〜9,400窓(全体の約3.6%)、XAUUSD で30,314窓(約17%、金は休場が多い)が除外対象だった。**いずれも週末やセッション境界を跨いで「t+4」と称していた窓**である
- **3種別とも判定は変わらない**。CPI は差がヌルを超えず打ち切り、NFP と FOMC は通過する

### #80 リスクオン/オフ・コモディティ因子 — 深追いの価値を先に測って打ち切り(2026-08-07)

**提案**: リスクオン/オフ因子(VIX・S&P500 対 クロス円)とコモディティ因子(WTI 対 CAD、金 対 AUD)の相関を掘る。

**着手前に、既存の障壁を2つ確認した**
- **リード・ラグの候補規約は封鎖されている**。[leadLagRelationships.ts:812](../src/leadLagRelationships.ts) で `candidateEligible` は `false` にハードコードされ、封鎖理由は `candidate_rule_not_calibrated_for_shared_clustered_volatility`。#64 が25,000複製で解除条件を測り、**4.924% [4.663, 5.199]** で上限が5%を超えて未達だった
- **封鎖理由がこの提案の急所である**。#64 を壊したのは2系列が共有するボラティリティ・クラスタリングであり、**VIX はボラティリティそのもの**なので緩和されない
- **同時相関は取引できない**。`compute_correlation_regimes` は移動窓の同時相関を出すが、因子の値を知った時点で為替は既に動いている。現象の実在と取引可能性は別である

**データが無いので、代理で決定的な問いを測った**
- AUDJPY / NZDJPY / USDCAD / AUDUSD / VIX / S&P500 / WTI はいずれも手元に無い
- 手元の **XAUUSD をリスク資産の代理**として使った。問うたのは「相関が実在するか」(実在する)ではなく、**同時相関だけなのか、先行成分があるのか**である
- ヌルは #64 が較正した**ブロック符号反転**(ブロック80本、2000複製)。ボラティリティ・クラスタリングを保存し、ラグ構造だけを壊す構成

**結果 — 相関は実在し、そして完全に同時である**

| 因子 → 対象 | 同時相関(lag 0) | 最強の先行(lag 1-8) | ヌル95%帯 | 判定 |
|---|---|---|---|---|
| XAUUSD → **USDJPY** | **-0.3106** | -0.0076 | ±0.0090 | 帯の内側 |
| XAUUSD → **EURUSD** | **+0.3385** | +0.0060 | ±0.0097 | 帯の内側 |
| XAUUSD → EURJPY | -0.0245 | -0.0067 | ±0.0087 | 帯の内側 |
| XAUUSD → GBPJPY | -0.0030 | -0.0068 | ±0.0089 | 帯の内側 |
| XAUUSD → AUDNZD | -0.0000 | -0.0026 | ±0.0087 | 帯の内側 |

- **現象は提案どおり実在する**。金高で USDJPY 安(円高)が -0.31、金高で EURUSD 高(ドル安)が +0.34。符号も大きさもリスクオン/オフの資金移動として整合する
- **先行成分は無い**。5ペア × 8ラグ = **40セルすべてがヌル帯の内側**。先行相関は 0.003〜0.008、帯は ±0.009
- **先行/同時の比は 2.4%(USDJPY) と 1.8%(EURUSD)**。関係はほぼ100%同時であり、金は次の15分〜2時間について何も語らない
- GBPJPY の 224%、AUDNZD の 10641% という比は**同時相関がほぼゼロの値で割った産物で意味を持たない**。AUDNZD が -0.0000 なのは豪ドルとNZドルが共に資源国通貨で金の影響が相殺されるためで、コモディティ因子の検証に AUDNZD は使えないことを示している

**VIX に差し替えても同じと考える理由**
- 金は USDJPY と -0.31 の強い同時結合を示しており、**リスクチャネルの代理として機能している**。その代理で先行成分がゼロなら、VIX に替えて現れる理由は乏しい
- 加えて VIX を使うことは、#64 が壊れた原因(共有ボラティリティ)にボラティリティ指数そのものを持ち込むことになる

**この測定が答えていないこと(留保)**
- 測ったのは**平均的な線形相関**である。「VIX急騰時だけ強い反応が出る」という**裾での効果は否定していない**。平均ゼロと裾での効果は両立する
- それを測るのは #73 のイベント枠組みだが、**引き金が内生的**(価格・変動から定義される)になる。#72 は外生時刻こそが育成3系統を良い賭けにしていると書いており、内生的引き金は price action で3構成・約30万イベントを費やして失敗した型である

**打ち切り**
- **相関/リード・ラグ経路は打ち切る**。同時相関は実在するが取引不能、先行成分は40セル全てヌル帯の内側、そして封鎖されたリード・ラグ機構の急所を突く構成である
- イベント枠組みは形式上は残るが、AUDJPY/NZDJPY と VIX・S&P500・WTI のデータ調達が前提であり、**内生的引き金という直近の失敗と同型の弱点を持つ**。着手するなら事前登録から

### #79 4本構造の時間足一般化 — 探索と宣言した掃引(測定前に記録, 2026-08-07)

**本項は測定を実行する前に記録・コミットした。** 見たのは**事象数のみ**で、収益率は1つも見ていない。

**#78 の恒久閉鎖を、利用者の明示的判断で一度だけ再開する**
- #78 は「構造の別、水準の別、**時間足の別を問わず**戻らない」と規定した。本項はその規定に**正面から反する**
- 再開は私の判断ではなく**利用者の明示的な許可による**。理由として述べられたのは「研究には厳格さも必要だが、水物的な要素も必要」である
- **この指摘自体は正しい**。探索は正当な営みであり、防ぐべきは探索そのものではなく、**探索を後から確認的検定として装うこと**である。したがって本項は**探索と宣言し、全セルを報告する**ことで両立させる

**探索であることの帰結を先に書く**
- 本項で仮に1セルが通っても、それは**仮説の生成**であって採用ではない。採用には別母集団での確認が要る
- **全24セルを必ず報告する**。通ったセルだけを示すことはしない

**掃引の範囲(測定前に全列挙、後から足さない)**
- 構造・方向・建玉・ヌル・コスト下限は **#78 のまま**。変えるのは時間足のみ
- 銘柄6(EURUSD/USDJPY/GBPUSD/EURGBP/AUDNZD/XAUUSD)、時間足4(M15/M60/M120/M240)、**計24セル**
- EURJPY/GBPJPY は M15 しか集約が無いため本項の対象外とする(後から足さない)

**判定対象は4セルに絞る**
- **主判定は時間足ごとの6銘柄プール、計4セル**。Bonferroni 参考 α = 0.05/4 = **0.0125**
- 24の銘柄別セルは**報告するが判定しない**。当初は24セルをα=0.0021で判定する案だったが、**銘柄別セルは100〜1,860件で大半が検出力不足**であり、統計的に何も言えないセルから通ったものを拾う面を作ることになる。αは緩むが摘み取れる面を消すほうが実質的に厳しい。**収益率を見る前の変更である**

**検出力を正直に書く(事象数は測定済み)**

| 時間足 | プール事象数 | 検出力 |
|---|---|---|
| M15 | 9,840 | 十分 |
| M60 | 2,453 | 要求2,000をわずかに超える |
| M120 | **1,343** | **不足** |
| M240 | **728** | **不足** |

- **M120 と M240 の失敗は「効果の不在」ではなく「判定不能」である**。この区別を結果の書き方で崩さない
- horizon は #78 のまま `1/2/4/8/16` **本**で固定する。したがって保有時間は時間足に比例し、M240 の t+16 は64時間になる。**規則を保つと時間が動く**という性質を明記しておく

**採用条件(#78 と同一)**
1. 平均がプラセボヌルの95%点を超える
2. 95%信頼区間の下限が 1.0bps を上回る
3. 有効イベント2,000件以上

**予測**
- **4セルとも通らないと予測する**。3構成・8銘柄・約29万イベントで効果が無かった直後であり、時間足を変えて現れる効果があるとは考えにくい

**凍結前に見たもの**
- **事象数のみ**(上表、および銘柄別100〜1,860件)。**収益率は1つも見ていない**

**失敗時**
- #78 の恒久閉鎖へ戻る。**本項が消費するのは「利用者の明示的判断による1回の再開」であり、次は無い**

- **結果 — 4セルとも通らず。ただし失敗の意味は一様ではない(2026-08-07)**

| 時間足 | n | t+4 | 95%区間 | ヌル95%点 | p | 判定の性質 |
|---|---|---|---|---|---|---|
| M15 | 9,269 | -0.119 | [-0.364, 0.126] | 0.224 | 0.8886 | **効果の不在** |
| M60 | **1,958** | -0.428 | [-1.376, 0.520] | 0.786 | 0.8354 | **判定不能** |
| M120 | 962 | 0.224 | [-2.002, 2.449] | 1.478 | 0.3067 | 判定不能 |
| M240 | 323 | -0.679 | [-5.455, 4.097] | 4.353 | 0.5619 | 判定不能 |

- **結論を出せたのは M15 だけである**。#79 は「M120 と M240 が判定不能」と書いたが、**M60 も判定不能だった**。事前登録時の見積もり2,453件に対し、窓が欠損バーを跨ぐ除外を掛けると1,958件となり、最低要件2,000をわずかに下回った
- **見積もりと実測が食い違った理由を記録する**: 検出力を測った段階では前向き窓の連続性検査を掛けていなかった。**事前登録の検出力表は、判定に使う手続きと同一の手続きで作るべきだった**。今回は結論を変えないが、境界付近では変え得る欠陥である
- 信頼区間は時間足とともに急速に広がる(M240 で ±4.8bps)。**規則を本数で固定すると、時間足を上げるほど事象が減り区間が広がる**という #79 で予告した性質がそのまま出た

**24の銘柄別セルは全て報告した(判定はしない)**
- 最大の正値は USDJPY の M120 で **+4.17 [-0.03, 8.38]、n=180**。区間の下限がかろうじてゼロを含む。**摘み取れば「発見」に見えるセル**であり、#79 が判定対象から外した理由がそのまま現れている
- 24セル中、区間がゼロを跨がないのは AUDNZD M15 の -0.53 [-0.87, -0.19] のみで、しかも負である

**予測は当たった。ただし当たったことに価値は無い**
- #79 に「4セルとも通らないと予測する」と書いたとおりになった。**外れるほうが情報量は大きかった**

**#78 の恒久閉鎖へ戻る**
- 利用者の明示的判断による1回の再開は消費された。**price action へは戻らない**
- 通算: 3構成(単一足・水準フィルタ・4本構造)、8銘柄、4時間足、延べ約30万イベント。**M15 では一貫して効果が無く、それ以外の時間足では判定できるだけの事象数が無い**
- **後者は「効果が無い」ではなく「この手法では測れない」である**。上位足で同じ規則を測りたければ、本数ではなく時間で horizon を定義し直し、標本を桁で増やす設計が要る。それは本項の延長ではなく別の研究になる

### #78 4本のトラップ構造(はらみ → 偽ブレイク → 逆包み足) — 事前登録(測定前に記録, 2026-08-07)

**本項は測定を実行する前に記録・コミットした。** 収益率は1つも見ていない。見たのは**発生頻度のみ**であり、それは検出力の設計事実である。

**#77 の打ち切り宣言との関係を先に定義する**
- #77 は「price action の系統をここで打ち切る。別のフィルタ変種、別の水準、別の horizon、別の時間足へは進まない」と規定した。**その規定はいま有効である**
- #77 が測ったのは**単一足の形を場所で絞る**という構成であり、打ち切りはその範囲に及ぶ。本項は**4本の連続構造**であり、条件付け変数を足すのではなく**事象そのものが別物**である
- **この区別を認めるのは1回だけとする**。本項が失敗した場合、price action は変種の別を問わず恒久に閉じる。「構造が違うから別」という論法を二度使えば、それは打ち切り規定を無効化する装置になる

**同時に、私の事前の見立ても記録する: 通らないと予想する**
- 同じ市場・同じ時間足で、8銘柄・約27万イベントにわたり効果が無かった直後である。**通れば説明を要する側**であり、失敗は驚きではない
- この予想を書き残すのは、結果を見てから「やはり思ったとおり」と言えないようにするためである

**機序の主張**
- 単なる形ではなく、**建玉が捕まった瞬間**を捉えるという主張である。はらみ足で溜めた後、その高値(安値)を一瞬抜いてブレイク参加者を誘い、即座に逆方向の包み足で引ける。損切り誘発と強制反対売買という具体的な機構がある
- **#77 で失敗した sweep の4本版ではない**。sweep は「20本高安を抜いて戻る」だけで、溜めも即時反転確認も持たない。本項は sweep の 165,647 件に対し 13,241 件、**8%まで絞られた別の事象**である

**構造の定義(すべて凍結、4本は連続し間に他の足を挟まない)**
1. **母足(Bar 1)**: 参照足。条件なし
2. **はらみ足(Bar 2)**: `high <= Bar1.high` かつ `low >= Bar1.low`(等号を含む)
3. **偽ブレイク(Bar 3)**: 上抜けは `high > Bar2.high` かつ `close < Bar2.high`、下抜けは `low < Bar2.low` かつ `close > Bar2.low`
   - **最小抜け幅は設けない(ゼロ)**。頻度を実測したのがこの定義であり、後から閾値を入れれば検証した頻度と別物になる
4. **逆方向の包み足(Bar 4)**: Bar 3 の**実体**を覆う(`bodyHigh >= Bar3.bodyHigh` かつ `bodyLow <= Bar3.bodyLow`)、かつ上抜け偽ブレイクには陰線、下抜けには陽線
   - **Bar 3 と Bar 4 は別の足**であり、Bar 4 は Bar 3 の直後でなければならない。遅延は認めない

**方向**: 上抜けの偽ブレイク → 売り、下抜け → 買い

**母集団と測定**
- M15、**8銘柄**(EURUSD/USDJPY/GBPUSD/EURGBP/AUDNZD/XAUUSD/EURJPY/GBPJPY)、既存集約の全期間
- 建玉は Bar 4 の終値で方向どおりに入り、h 本後の終値で出る。**逆指値も利食いも追加フィルタも置かない**
- horizon は `1/2/4/8/16` を曲線として保存し、**主判定は t+4**(#77 と同一にして比較可能にする)
- 窓が欠損バーを跨ぐ場合は除外する(両端が正確に h 本分離れていること)

**ヌル**
- **時刻(UTC)と曜日を一致させたプラセボ、5000複製、セルあたり最低52アンカー**。#75/#77 と同一
- プラセボ母集団は3パターン(pin/engulfing/sweep)および本構造のいずれも持たない普通のバーとする

**採用条件(すべて満たすこと)**
1. 平均がプラセボヌルの95%点を超える
2. 平均の95%信頼区間**下限が 1.0bps を上回る**(#77 と同一。EURUSD 片道1pip相当の**仮定**であり実測コストではない)
3. 有効イベント2,000件以上

**多重性**
- 主判定は **1セル**(1構造 × 1horizon × 8銘柄プール)。#77 の3セルより少ない。Bonferroni 参考 α = 0.05
- 銘柄別は報告するが判定に使わない

**検出力は測定済み**
- 8銘柄合計 **13,241件**(銘柄別 1,210〜1,860、年160回前後)。要求2,000件を大きく上回る
- したがって**失敗した場合、それは標本不足ではなく効果の不在**である

**禁止事項(後から動かさない)**
- 最小抜け幅を導入すること、はらみ足の等号条件を緩めること
- Bar 4 の遅延を認めること、Bar 3 と Bar 4 の同一化を認めること
- 曲線を見てから主horizonを差し替えること
- 銘柄別の良いセルを拾うこと、コスト下限を緩めること
- 母足に条件(実体比、方向、レンジ)を後付けすること

**実装上の注記**
- `compositeConditionStudy.ts` は `sequence` 演算子を持つが、プリミティブは `session_auction` などセッション系のみで、**はらみ足・偽ブレイクは実装されていない**。本項は合成ではなく新規プリミティブの実装を要する

**凍結前に見たものの開示**
- **発生頻度のみ**: 8銘柄13,241件、段階別(はらみ309,000 → 偽ブレイク141,660 → 逆包み足13,241)、年160回前後
- **収益率は1つも見ていない**
- 加えて #59/#76/#77 の全結果を知った上での設計である

**失敗時**
- **price action を恒久に閉じる**。構造の別、水準の別、時間足の別を問わず、この系統へは戻らない

- **結果 — 棄却(2026-08-07)**

| horizon | 平均 | 95%区間 |
|---|---|---|
| t+1 | -0.100 | [-0.205, 0.004] |
| t+2 | -0.123 | [-0.272, 0.026] |
| **t+4(主判定)** | **-0.103** | **[-0.313, 0.107]** |
| t+8 | -0.093 | [-0.386, 0.199] |
| t+16 | -0.106 | [-0.512, 0.301] |

- 主判定 t+4: 観測 -0.103bps、ヌル中央値 0.025、ヌル95%点 0.206、**p = 0.8702**。条件1・2を満たさず**棄却**
- **n = 12,547 で要求2,000を大きく超える。効果の不在である**
- 全horizonが -0.09〜-0.12bps に張り付き、区間はすべてゼロを跨ぐ。**溜め・偽ブレイク・即時反転という3段の絞り込みを掛けても、単一足のときと同じ場所に着地した**
- 銘柄別は AUDNZD が -0.530 [-0.874, -0.185] で区間全体が負、EURGBP +0.260 と GBPJPY +0.270 は正だがゼロを跨ぐ。#77 と同じく**「効かない」は安定し、順位は安定しない**

**事前の予想は当たった**
- #78 に「通らないと予想する」と書いたとおりになった。予想を先に書き残したので、これは後知恵ではない。**同時に、当たったこと自体は何の手柄でもない**。4系統・8銘柄で効果が無かった直後の予想であり、外れるほうが情報量が大きかった

**実装上の判断を1つ開示する**
- Bar 3 が**上下どちらも抜いて内側で引ける**場合(はらみ足309,000件中20,461件、約6.6%)、#78 の定義は方向を決めていない。実装は**上抜けを先に評価**して売り扱いとした
- これは頻度13,241件を検証したのと同一の分岐順序であり、母集団を後から変えてはいない。ただし**凍結文書に穴があった**ことは記録する
- 有効イベントが13,241件から12,547件へ減ったのは、窓が欠損バーを跨ぐ場合の除外による(頻度計測時は未適用)

**price action を恒久に閉じる(#78 の規定どおり)**
- 構造の別、水準の別、時間足の別を問わず、この系統へは戻らない。#78 が認めた「1回だけの例外」は消費された
- 通算: 単一足(#76 相当の無条件測定)、水準フィルタ(#77)、4本構造(#78)の3構成、8銘柄、延べ約29万イベントで一貫して効果が無い
- #59 の律速は、**場所を変えても、構造を複雑にしても回避できなかった**

**再現性監査(2026-08-08) — 元の数値は未検証、結論を再開の根拠にしない**
- #77/#78の結果コミットは本書への結果追記だけであり、当時の実行器、入力集約の内容ハッシュ、イベント台帳、プラセボ5,000本の分布をGitに残していなかった。従って元の `n=12,547`、`t+4=-0.103bps`、`p=0.8702` を**独立に再現・検証することはできない**
- `priceActionTrapReproduction.ts` とCLIを新設した。固定契約、8入力の正規化SHA-256、全イベント台帳、時刻・曜日一致の5,000本プラセボ分布、成果物ハッシュを単一JSONへ保存する。元の結果を上書きするものではない
- 現在残る8本のM15集約での独立再計算は、行隣接の4本構造・シグナル終値からの厳密な将来窓として `n=11,105`、t+4 `-0.161bps`、ヌル95%点 `+0.185bps`、`p=0.9068` となった。方向は元記録と同じ棄却側だが、イベント数が一致しないため**#78の再現確認とは呼ばない**
- 差の原因は、当時の入力データ版または未保存の検出実装に限られる。将来この系統を再評価する場合でも、元の結論を救済するための探索ではなく、この成果物契約を先に凍結した別研究として扱う

### #77 主要水準に接触した price action パターン — 事前登録(測定前に記録, 2026-08-07)

**本項は測定を実行する前に記録・コミットした。** 無条件のパターン測定(#76 の直後、`9f9f068`)は既に見ており、**組み合わせ探索はこの会話で3回失敗した道**であるため、収益率を1つも見ないうちに条件を凍結する。

**機序の主張を先に言葉にする**
- 「多くの参加者が見ている水準での反発は、どこで出た反発よりも情報量が多い」。この主張が正しいなら、**日足高安 > セッションPOC > 無条件**の順に効果が並ぶはずである。順序を予測として固定することで、単に最大値を拾う操作と区別する

**母集団**
- M15、6銘柄(EURUSD/USDJPY/GBPUSD/EURGBP/AUDNZD/XAUUSD)、既存集約の全期間
- イベント = `Bushido Price Action Context` の既定設定で発火した pin / engulfing / sweep(`sha256` 相当の凍結: wick 60%, body 40%, opposite 40%, engulf は逆方向前足必須・前足実体最小0, sweep は20本)
- **水準への接触**: そのバー自身の `[low, high]` が水準を含むこと
- **水準は2種類のみ**:
  1. **日足高安** — 直前に完了したブローカー営業日の高値・安値
  2. **セッションPOC** — 直前に完了した営業日の tick 加重プロファイル POC(行24、VA70%、#76 と同一構成)
- いずれも**完了した過去期間からのみ**作るので、構成上 point-in-time である

**4時間足高安は除外する**
- 除外は測定前の判断であり、理由は定義の重複である。sweep は「直前20本(=5時間)の高安を抜く」ものであり、**4時間ブロックの高安とほぼ同じ対象を見ている**。実測でも sweep の **52%**(165,647中85,619)が4H高安に接触し、絞り込みとして機能していない。日足高安は12%、POCは9%であり、こちらは本物の絞り込みである
- 一部のパターンにだけ4Hを残す扱いは非対称であり、選択の余地を作るので採らない

**主判定(1セルのみ)**
- **水準は日足高安**。最も広く見られ、引き金の定義と重複せず、絞り込みも最も強い
- **horizon は t+4(60分)**。反応の主張は近傍であり、#73 と同じ主horizonを使う。5点(`1/2/4/8/16`)は反応曲線として保存するが、**主判定に使えるのは t+4 だけ**
- **6銘柄をプールした1つの数字**を判定に使う。銘柄別も報告するが判定には使わない(銘柄別を判定に入れると36セルになる)
- 統計量は、パターンの方向どおりに入り h 本後に出た符号付き収益率の平均

**ヌル**
- **時刻(UTC)と曜日を一致させたプラセボ**。#75 で曜日一致が必要と分かっており、#73/#76 では時刻の交絡が見かけの効果を作った。パターンは曜日に偏らないと予想されるが、**予想を理由に条件を緩めない**
- セルあたり最低52アンカー(#73 と同じ理由: その曜日の1年分)

**採用条件(すべて満たすこと)**
1. **効果がヌルを超える**: 日足高安 × t+4 の平均が、プラセボヌルの95%点を超える
2. **効果がコストを超える**: 平均の95%信頼区間**下限が 1.0bps を上回る**
   - 1.0bps は EURUSD で片道1pip相当(1pip / 1.15 ≒ 0.87bps)の概算であり、**最も狭い主要通貨での下限**として置く。スプレッドの広い通貨で採用するには、その通貨の実コストで測り直すこと。この数値は仮定であって実測値ではない
3. **標本**: 各パターンで有効イベント2,000件以上(実測で18,000件以上残ることは確認済み)

**多重性**
- 主判定は 3パターン × 1水準 × 1horizon = **3セル**。Bonferroni 参考 α = 0.05/3 = 0.0167
- セッションPOC は順序予測の確認に使い、**採用判定には使わない**。使えば6セルになる

**順序予測の扱い**
- 日足高安 > セッションPOC > 無条件、の順序が成り立つかを記録する
- **順序が崩れても、条件1〜3を満たしたセルを棄却しない**。逆に、順序が成り立っても条件を満たさないセルを救済しない。順序は機序の主張に対する証拠であって、採用の門ではない

**禁止事項(後から動かさない)**
- 曲線を見てから主horizonを差し替えること(#73 の CPI で実際に誘惑があった)
- 水準種別を追加すること、4Hを復活させること
- 銘柄別の良いセルを拾うこと
- コスト下限を緩めること、あるいは「スプレッドの狭い口座なら」と条件を後付けすること

**凍結前に見たものの開示**
- **無条件の結果は見ている**: 6銘柄プールで pin が全horizonで −0.16〜−0.22bps、engulfing が −0.15〜−0.20bps、sweep がゼロを跨ぐ(`9f9f068`)。EURUSD 60分でも15セル全てが区間ゼロ跨ぎ(`2ee7617`)
- **フィルタ後の生存数は見ている**(上表)。**フィルタ後の収益率は1つも見ていない**
- したがって本項は「無条件では効かないことを知った上で、水準で絞れば効くか」を問う設計である。**無条件が負であった事実は、フィルタ後が正である見込みを高めない**

**失敗時**
- 条件を満たすパターンが1つも無ければ、**price action の系統をここで打ち切る**。別のフィルタ変種、別の水準、別の horizon へは進まない。#59 の律速がこの系統にも当てはまったと記録する

- **結果 — 3パターンとも棄却(2026-08-07)**

| パターン | n | t+4 平均 | 95%区間 | ヌル95%点 | p | 判定 |
|---|---|---|---|---|---|---|
| pin | 19,960 | **-0.147** | [-0.337, 0.042] | 0.164 | 0.9636 | 棄却 |
| engulfing | 17,461 | **-0.205** | [-0.426, 0.017] | 0.182 | 0.9866 | 棄却 |
| sweep | 18,872 | **-0.165** | [-0.368, 0.039] | 0.199 | 0.9792 | 棄却 |

- 条件1(ヌル95%点超え)と条件2(区間下限 > 1.0bps)を**3パターンとも満たさない**。条件3(n ≥ 2,000)は全て満たす
- **標本不足による失敗ではない**。事前に生存数を測ってから設計したとおり、有効イベントは17,000〜20,000件ある。**効果の不在である**
- **ヌルは正しく較正されている**。ヌル中央値は 0.011〜0.037 で、構成上の期待値ゼロに一致する。普通のバーに同じ向きの賭けを当てれば平均ゼロになる、という当たり前が出ている

**観測値はヌル中央値より下にある**
- p は 0.96〜0.99 であり、これは「ヌル抽選の96〜99%が観測値を上回った」という意味である。**日足高安に接触したパターンは、同じ時刻・曜日の普通のバーに同じ向きで賭けるより、わずかに悪い**
- ただし本項が事前登録したのは片側(効果が正である)の検定であり、「有意に悪い」と主張するには登録していない検定が要る。**記述として下側にあると記録するに留める**

**順序予測は成り立たなかった(機序の主張に証拠なし)**

| パターン | 日足高安 | セッションPOC | 無条件 | 順序 |
|---|---|---|---|---|
| pin | -0.147 | -0.252 | -0.180 | 不成立 |
| engulfing | -0.205 | -0.341 | -0.194 | 不成立 |
| sweep | -0.165 | -0.169 | +0.014 | 不成立 |

- 3パターンとも `日足高安 > POC > 無条件` にならない。POC は3つ中2つで最も悪い
- **「多くの参加者が見ている水準での反発は情報量が多い」という機序の主張は、この設計では支持されなかった**。順序を事前に固定していたので、後から「POCのほうが良かった」と読み替える余地はない

**打ち切り(#77 の規定どおり)**
- **price action の系統をここで終える**。別のフィルタ、別の水準、別の horizon、別の時間足へは進まない
- インジケーター `Bushido Price Action Context` と3つのMCPツールは**残す**。パターンを正しく標示し、正しく測る道具としては機能しており、**「単独でも水準併用でも優位性が無い」ことを再現できることに価値がある**
- #59 の律速(高流動性FXの短期価格構造にはコストを超える大きさがない)は、**条件付け変数を水準に変えても回避できなかった**。#72 が「条件付け変数を変えただけでは回避できない」と書いた予測が、4系統目で再び当たった

- **再現検証 — EURJPY / GBPJPY(2026-08-07)**

**救済ではなく再現として実施した**。3連続棄却の直後に銘柄を足すのは形として救済であり、#77 の禁止事項にも「銘柄別の良いセルを拾うこと」がある。したがって**測定前に予測を宣言した: JPYクロスでも効果なし**。通った場合こそ説明を要する側になる、という向きで実行している。手続き・条件・ヌルはすべて #77 のまま、変えたのは母集団だけである。

| パターン | n | t+4 | 95%区間 | ヌル95%点 | p | 判定 |
|---|---|---|---|---|---|---|
| pin | 7,263 | -0.238 | [-0.563, 0.087] | 0.275 | 0.9410 | 棄却 |
| engulfing | 6,376 | -0.288 | [-0.674, 0.098] | 0.292 | 0.9628 | 棄却 |
| sweep | 6,898 | **-0.597** | **[-0.942, -0.252]** | 0.276 | **1.0000** | 棄却 |

- **予測どおり3パターンとも棄却**。n は6,000〜7,300で最低要件2,000を上回るので、これも効果の不在である。順序予測も3つとも不成立
- **どのパターンが最もマシかは銘柄群を跨いで安定しない**。6銘柄では sweep だけがゼロ近傍(無条件 +0.014)だったが、JPYクロスでは sweep が最も悪く、区間全体がゼロより下にある(p = 1.0000 は5000複製すべてが観測値を上回ったという意味)。**「効かない」は安定し、「どれがマシか」は安定しない**。効果が実在しないことと整合する
- これで **8銘柄・約27万イベント**にわたり一貫して効果が無い

**ブローカー時計の検証で私が二度誤った経緯を記録する**
- EURJPY/GBPJPY の週境界(冬06:49・夏05:4x)と生CSVの活動ピーク(ブローカー23時)から **UTC+9 と二度断言し、二度とも誤っていた**
- 実際には**ファイルの途中で時計が変わっている**。測っていたのは2015年以前の旧時計であり、2016年以降のピークはブローカー17時 = UTC+2/+3 = NY+7 でラベルどおりである
- `start_from_broker_date: 2016.01.01` はまさにこの旧時計を除外するために設定されており、マニフェストの限定事項にも「this file ran on a different clock earlier in its history」と明記されていた。**私はそれを集約後に読んだ**
- **教訓**: 時系列の性質を1つの窓から推定するとき、その窓が系列全体を代表するかを先に確かめること。今回は既存の成果物が答えを持っていた

**データ品質(6銘柄と同等)**
- EURJPY 262,689本 / GBPJPY 262,664本、2016-01-03〜2026-07-31、不正行ゼロ、conflicting duplicate ゼロ
- `outOfOrderRows` は約61,600行だが、**6銘柄も同じ期間(2025-03-31〜2025-06-30)で約61,500行あり**、データ源の性質であって新ファイル固有ではない
- 集約の活動プロファイルは4銘柄とも UTC 14時ピーク・21時トラフで一致し、時計変換が効いたことを独立に確認できる

### #76 volume profile の効果量ゲート — 引き金がセッション境界に固定されている(2026-08-06)

#72 は育成3系統について「**育成の各段階で効果量がコストを超えるかを先に見る**」と定めた。macro event の次として volume profile と COT crowding のどちらを先にするかを決め、効果量ゲートを実行した。

**着手順の判断: volume profile が先**
- **COT の前向き証跡は実質1週間分しかない**。`cot-first-seen.jsonl` は753件あるが、初出日は 2026-07-26 に500件、07-30 に250件で、**収集開始時の一括バックフィル**である。観測日は2021-10-12〜2026-07-28 の251週分だが、真に前向きなのは08-02以降の3件だけ。台帳は「我々が最初に見た日」を正しく記録しており欠陥ではないが、**251週を前向き証跡と読んではならない**。値自体は保存されず CFTC への再取得を要する
- volume profile は手元の M15 集約(6銘柄・2016-2026、2721セッション)から**完全にオフラインで**構築できる。ネットワーク不要で標本も一桁大きい

**予備確認: FX の volume profile は時間帯価格プロファイルの言い換えではない**
- 集約が持つのは tick 数であって約定数量ではないため、重みがほぼ一定なら「出来高」は飾りになる。tick 加重と1バー1単位(時間加重)で同一セッションのプロファイルを作り比較した
- **一致しない**。POC の一致は51〜67%、VAH/VAL は30〜45%、3つ全部一致は6〜17%、POC の平均ずれは1.4〜3.0行(全24行)。**仮説は外れ**、tick 出来高は別物を作っている(その差が情報かノイズかは別問題)

**効果量ゲート: 前セッションの水準に触れた後の順方向収益率(bps、95%区間)**
- 最大は AUDNZD `val_rejection_long` の t+8 で **4.07 [3.54, 4.60]**、次が EURGBP の 2.13。他は概ね ±1bps 以内
- **ドリフトでは説明できない**。セッションごとに無作為の1バーから測ると AUDNZD の t+8 は +0.38 [-0.03, 0.79] にとどまる

**しかし4分岐すべてで価格が上昇していた**。方向を反転した short 側でも上昇する(AUDNZD: val_long +4.07 / poc_below_long +1.82 に対し vah_short -0.52 / poc_above_short -2.22 で、いずれも原系列は上昇)。水準効果ならこの対称性は出ない。共通項は「**セッション内で最初に水準へ到達したバー**」である。

- **引き金はセッション境界に固定されていた**。AUDNZD の `val_rejection_long` は **73.6% が 21〜22時 UTC** に発火する。ブローカー日は NY 17:00 に切り替わるので、これは**セッションの最初のバー**である。新セッションは前セッションの value area の近くで開くため、前日水準への最初の接触は**構成上ほぼ寄り付き**になる
- **その時刻は一日で最も薄い**。21時UTCの tick 出来高は AUDNZD 365 / EURGBP 363 / EURUSD 292 に対し、活動時間帯は 1026 / 1040 / 1057。分カバレッジも 14.33〜14.43/15 と不完全である
- **見かけの効果量の大半は水準ではなく時刻である**。発火時刻の構成で重み付けした**無条件**平均 t+8 は AUDNZD +2.36 / EURGBP +1.22(時刻一様なら +0.02 / +0.03)。測定値 4.07 / 2.13 の過半をこれが占める
- 残差は約1.7bps であり、**一日で最も薄く実効スプレッドが最も広い時間帯**でそれを取ることになる。#59 の律速はここでも解消していない

**測ったものの範囲を明示する**
- 本測定は**素の初回接触**であり、凍結済みの `VOLUME_PROFILE_REACTION_STUDY_V1`(`acceptanceCloses: 2` を要求する rejection/acceptance 分岐)ではない。**簡略版である**
- したがって「acceptance 型の引き金なら発火が遅れ、この固定を免れる」可能性は否定していない。**それは仮説であって結果ではない**

**この線を続けるなら、母集団定義の前に満たすべき2条件**
1. **引き金が寄り付きバーに機械的に固定されないこと**。セッション境界を除外して事後に測り直すのは #59/#70/#71 と同じ失敗であり、引き金の定義そのものを先に凍結してから測る
2. **ヌルを時刻一致にすること**。#73 で同じ交絡が出ており、時刻を揃えないプラセボはこの系統では機能しない

- **同型の失敗は3度目である**。feature scan の金候補 +38.5bps はセッション区切りのほぼ空のバケットだった。#73 では発表時刻の交絡が反応比の2割を占めた。**FXのセッション境界は、効果を作るのではなく効果に見えるものを作る**

### #75 同一レジーム対照 — 揃っていた軸と、揃っていなかった軸(2026-08-06)

#72 の育成順序の第2段階。#73 のプラセボヌルは**時刻を揃えているが、レジームは揃えていない**。反応比は直前52本のベースラインで割るため水準は構成上吸収されるが、「発表がボラティリティの上昇局面に偏って起きる」なら比は発表と無関係に上がる。2つの軸を測った。

**軸1 — スロットのボラティリティ趨勢: 揃っていた。対照は不要**
- 測度は**ベースライン窓の内側だけ**で作る: 同一スロット直近13本の中央値 ÷ その前39本の中央値。厳密に過去、幅は数週間あるので、**発表直前のポジション調整では動かせない**(直前バーで測ると、発表を織り込んだ静けさを条件付けることになり、悪い対照になる)
- 結果はイベント側とプラセボ側で四分位範囲がほぼ一致した。プラセボ中央値を超えた割合は CPI 52.5% / NFP 55.7% / FOMC 47.1%。n=122 なら二項の標準誤差は約4.5%であり、**いずれも誤差の範囲**。FOMC は逆向きですらある
- **必要のない対照は作らない**。この軸は記録して閉じる

**軸2 — 曜日: 揃っていなかった。ヌルの誤設定である**
- **発表種別は曜日に固定されている**。NFP は126件中120件が金曜、FOMC は91件中81件が水曜。一方プラセボは同一時刻の**全曜日**から引いていた
- プラセボの反応は曜日で平坦ではない。USD直結の水準比は **月曜 0.84 から木曜 1.12**まで動き、**この幅は入口条件が判定している差より大きい**。最多標本の月曜(n=1058)が最も静かなため、ヌルは下へ引かれ観測値を実際より極端に見せていた
- **修正**: ヌルの抽選単位を `(UTC時刻スロット, UTC曜日)` にした。統計量は凍結どおり据え置き、参照分布だけを直す — 群サイズの人工物のときと同じ扱いである
- **セルの最小本数は52**とした。その曜日の1年分であり、**季節がセルを支配しない**ことを担保する。満たないセルのイベントは判定せず除外する(実データでは除外ゼロ)

**結果 — 3種別とも判定は変わらない**

| 種別 | 差の p (時刻のみ → 時刻×曜日) | ヌル95%点 | 判定 |
|---|---|---|---|
| `us_cpi` | 0.0756 → **0.1100** | 0.025 → 0.042 | 打ち切り(不変) |
| `us_nfp` | 0.0022 → **0.0018** | 0.026 → 0.027 | 次段階へ(不変) |
| `fomc_statement` | 0.0002 → 0.0002 | 0.090 → **0.216** | 次段階へ(不変) |

- **FOMC の判定基準は2倍以上に厳しくなった**(水曜はプラセボでも荒い日である)。観測値 3.249 は依然その15倍上にある。CPI はさらに遠ざかった
- **動く向きは実行前に分かっていた**。曜日構成と曜日別プラセボを先に測っており、FOMC の基準が上がり CPI が不利になることは予測できた。**それでも適用した**。誤設定と分かったヌルを、結果に不利だからと据え置く理由はない
- **次段階は前向き/OOS**。ここまでは全て既存履歴の上での測定であり、point-in-time証跡ではない

### #74 免除された非公表と、暦の空き月の突き合わせ(2026-08-06、#73 の実装で判明)

- **症状**: `us_nfp` の成果物が `missing_official_monthly_release:2025-10` を報告し続けた。年次は `events_by_year 2025: 11` + 免除1 = 12 で合っており、`non_publications` にも `reference_month: 2025-10`(2025年の歳出失効)が記録されている
- **原因は M+1 という仮定だった**。免除は**データの月**を名乗り、公表は翌月に出るため、コードは参照月 M を公表月 M+1 に変換して突き合わせていた。**これは「公表が月境界を越えて遅延しない」ことを仮定しており、免除を生む歳出失効はまさにその遅延を起こす事象である**
- **同じ閉鎖が2つの系列に別々の形で現れた**(実データで確認):

  | | 暦の空き月 | 免除の参照月 | M+1 計算値 | 旧判定 |
  |---|---|---|---|---|
  | CPI | 2025-**11** | 2025-10 | 2025-11 | 一致し通過 |
  | NFP | 2025-**10** | 2025-10 | 2025-11 | 不一致で誤検出 |

  - CPI は遅延した公表が10月24日と月内に収まり11月が空いた。NFP は遅延が月境界を越え10月が空いた。**M+1 が当たったのは偶然である**
- **修正**: 免除は**参照月 M か翌月 M+1 のうち実際に空いている方**を1件だけ引き受ける。閉鎖は「M の統計が出ない」ことと「M に出るはずの公表がずれる」ことを同時に起こすため、どちらの現れ方も同じ免除で説明される。**離れた月の空きは引き受けない**し、免除が無ければ空きはそのまま残る(再発行が空き月を作る場合の検出は維持)
- **`computeOfficialMacroEventCoverage` を公開した**。保存済み成果物のカバレッジを、その成果物自身のイベントから再取得なしで検算できる

- **#73 は保存された coverage を信用しない**。`assertAdmissibleAggregate` がマニフェストを信じずバーを再ハッシュするのと同じ理由で、`runMacroEventResponseStudy` は**使うイベントそのものからカバレッジを再計算**する。保存ブロックは判断に使わず、食い違いを `coverage_recheck.stored_block_is_stale` として報告するだけにした。保存された結論は、その隣にあるイベントについての証拠ではなく、規則を直した瞬間に古くなる

### #72 研究ポートフォリオの4分割 — 規律ではなく対象を変える(2026-08-05)

- **判断の要旨**: 規律を緩めるのではなく、**規律が向く市場構造を変える**。#59 が「高流動性FXの短期価格構造にはコストを超える大きさがない」と結論し、#64/#70/#71 では欠陥が市場側ではなく**判定装置側**に3回連続で見つかった。装置は動いている。測る対象の選択が律速である

**維持** — carry と既存3仮説の前向き収集を継続する。**待機は失敗ではなく、point-in-time証跡を作る唯一の工程**である
- ただし**3つの仮説は等価ではない**(2026-08-05 実測):

  | 仮説 | 進捗 | 残り見込み |
  |---|---|---|
  | `xauusd-15m-bearish-fvg` | 1/50(収集10日) | 約490日 |
  | `eurusd-us10y-nonconfirmation` | 0/30(収集10日) | 速度不明 |
  | `eurusd-50m-lower-wick` | 0/50(収集9日) | **構造的に詰まっている** |

- **「約490日」の読み方を訂正する(2026-08-13)**: この数字は**1件の観測を線形外挿しただけ**であり、日程の見積もりとして読めるものではない。10日で1件から算出した点推定にすぎず、1件に対する厳密Poisson 95%区間(0.0253〜5.5716件/10日)を残り49件へ当てると、**88日から約19,400日**まで広がる。桁が2つ以上動くため、「約490日」と「速度不明」は実質的に同じ情報量しか持たない。収集を続ける判断自体は変わらないが、この表を進捗の予定表として引用しない

- 3つ目は `no_observations_match_regime` であり、**標本不足ではなくレジーム条件が何にも一致しない**。待っても埋まらない。**「維持」は無期限の同列保持ではなく、見直しの引き金を持つこと**とする。目安は収集90日時点で1件も出ない仮説を棚卸しする

**停止** — 高流動性FXの短期価格構造を、**同じ特徴量族の微調整で**掘り続ける探索
- 範囲を正確にする: 停止するのは**同一特徴量族の再チューニング**であって、短期FX全般ではない。異なる情報生成過程を持つ研究が短期足を使うことは妨げない

**育成** — volume profile / COT crowding / macro event を、候補規約へ進める前の**測定基盤**として完成させる。母集団定義 → 同一レジーム対照 → 経験的ヌル → 前向き/OOS の順
- **難所は経験的ヌルである**。#64 で、循環シフトのヌルが共有ボラを壊して偽陽性 69.5% を出した。3系統それぞれで「何を保存し何を壊すか」を設計しないと同じ穴に落ちる。**イベント時刻の入れ替えで済むと考えてはならない**
- **この3系統が良い賭けである理由は「別の情報生成過程」だけではない**。より具体的には**外生的な時刻**を持つ — COTは金曜15:30 ET公表、macro eventは公表時刻が固定、volume profileはセッション境界が固定。短期価格特徴量は**内生的**(信号が価格自身で定義される)であり、そこには選択の一群が入り込む。外生時刻はそれを構造的に排除し、**イベント時刻のヌルを正しく作ることを容易にする**
- **ただし3系統とも結果は価格反応で測る**。#59 の律速(効果量がコストを超えない)は条件付け変数を変えただけでは回避できない。macro event は数十bps規模の反応があり回避できる見込みが高いが、他2系統は自明ではない。**育成の各段階で効果量がコストを超えるかを先に見る**

**新規** — #71 を踏まえ、分類器を先に較正する独立研究を作る。入口条件はラベル占有率・順序性・安定性であり、予測性ではない
- **#71 は入口条件が必要だが十分でないことを示した**。分位点閾値でラベル占有率は解決したが(全通貨29-31/37-41/31-32%)、順序性は2通貨で崩れた。原因は閾値でも窓長でもなく**分類器の形** — `fast/slow` の比が水準を正規化で消し、ラベルの説明力は eta² 0.3〜3.6%、水準そのものは R² 15〜41%
- **したがって新規研究の核心は形の設計であり、その難所は比が解いていた問題**(水準の非定常性と通貨間比較不能性)**を別の方法で解くこと**である。これを避けて閾値だけ動かしても #70/#71 を繰り返す

### #71 M60レジーム分類器の因果的分位点閾値 — 事前登録(測定前に記録, 2026-08-05)

**本項は測定を実行する前に記録・コミットした。** #70 が「条件を通過したが識別力を測っていなかった」ため、比較の妥当性そのものを先に定義する。

- **#70 から持ち越す診断**: 固定比の閾値は窓長に対して移植できない。比の分散が窓長で変わるため、`14/50` 用の 0.75/1.5 を `120/480` へそのまま置くと tail ラベルが機械的に消える。既存分類器の M60 偏り(EURUSD 60% low、high 0〜7%)も、**閾値較正が一次問題**であることを支持する
- **交絡を断つ**: #70 は「窓長」と「閾値の妥当性」を同時に動かした。本項は**両方の分類器を同一の分位点方式にし、窓長だけを違える**。現行の固定閾値版は参考として並記するが、比較の主対象にしない
  - **A(短窓)**: fast 14 / slow 50
  - **B(長窓)**: fast 120 / slow 480
  - **参考**: 現行実装のまま(fast 14 / slow 50、固定閾値 0.75 / 1.5)
- **閾値の決め方(因果的分位点)**: 各アンカー `t` で、比 = fastRMS/slowRMS の**厳密に過去** `Q = 2000` 本ぶんの経験分位点を取り、`q30` 以下を low、`q70` 以上を high、間を normal とする。`t` 自身とそれ以降は一切使わない。分位点 0.30/0.70 は**tailを推定可能な大きさに保つために選んだ固定値**であり、市場ごとに調整しない
- **warm-up**: `slow + Q` 本。A と B で warm-up が異なると標本が揃わないため、**両者とも B の warm-up(480 + 2000 = 2480本)を使う**
- **外部指標**: 翌 `H = 24` 本の実現ボラティリティ(対数)。分類器の入力は厳密に過去のみなので、この量は構成上**外部**である
- **比較対象として有効になる条件(すべて満たすこと、6通貨すべてで)**:
  1. **ラベル利用**: 各ラベルが後方30%の未使用区間で **15%以上かつ100観測以上**
  2. **順序性**: 外部指標の群平均が **low < normal < high**
  - この2条件を満たさない分類器は、均質性や安定性の数値が良くても**比較に参加させない**。#70 の失敗を再現しないための門である
- **有効な分類器どうしで比較する2軸**: 群内均質性(外部指標の群内分散、小さいほど良い)と、ラベル安定性(隣接する非重複アンカー間のフリップ率)
- **判定**: B が A に対し群内均質性で **6通貨中5通貨以上**改善し、かつ安定性が悪化しないこと。**満たせば「長窓のほうが分類器として良い」までを認める**
- **採用しても移行は別の判断である**: #70 と同じく、`atrLookback` は feature scan の `regime`、carry preflight の `fixed_regime`、`VOLUME_PROFILE_SAME_REGIME_BASELINE_V1` が参照する。移行すれば #58 の偽陽性率と #60 の校正済み構成は測り直しになる。本項が認めるのは測定までである
- **後から市場別に調整しない**: 窓長・分位点・Q・warm-up・H はすべて上で凍結した。結果を見て通貨ごとに変えれば、#70 と同じ失敗を別の形で繰り返すことになる
- **失敗時**: A も B も有効条件を満たさない、または B が A を上回らない場合、既存分類を据え置き、包絡方向の研究を打ち切る

- **結果 — 比較は開かなかった(2026-08-05)**: 有効性の門は A が **4/6**、B が **4/6**。A は EURUSD が利用率(high 10% < 15%)、XAUUSD が順序で失格。B は GBPUSD と XAUUSD が順序で失格。**#71 の失敗時規定どおり、既存分類を据え置き、包絡方向の研究を打ち切る**
- **分位点方式そのものは機能した**: B のラベル利用は全通貨で 29-31 / 37-41 / 31-32% と設計どおり三分類が使われ、**#70 の「分類をやめる」抜け道は塞がった**。フリップ率も 24-29% で、現行実装の 34-52% より安定している。それでも順序が2通貨で崩れたのは、群平均の差が小さすぎるためである
- **診断 — 問題は窓長でも閾値でもなく、分類器の形だった**: ラベルが外部指標(翌24本の実現ボラティリティ)の変動をどれだけ説明するかを測ると、**A で 0.30〜0.68%、B で 0.37〜3.64%**(eta²)にすぎない。対照として、直近120〜240本の**水準そのもの**は同じ量を **R² 15〜41%** で説明する。**`fast / slow` の比は水準を正規化して消し去り、予測力を持っているのはその水準である**。窓長を変えても閾値を分位点にしても、消したものは戻らない。#70 と #71 が揃って失敗した理由はここにある
- **「水準を使えばよい」とは言えない**: 比の形が存在する理由も同時に見える。**水準は時間を通じて非定常で、通貨間でも比較できない**(EURUSD の log-vol −7.2 と XAUUSD の −6.2 を同じ閾値で切ることはできない)。比はその問題を解くために予測力を犠牲にしている。したがって水準ベースへの置換は自明な改善ではなく、非定常性と通貨間比較可能性の扱いを含めた**別の事前登録**を要する
- **診断は継続の根拠にしない**: #71 は失敗時に打ち切ると規定した。診断が有用であることは、事前登録した停止を回避する理由にならない。**将来の観測として記録するにとどめ、包絡方向はここで閉じる**

### #70 レジーム分類器の長窓変種 — 事前登録(測定前に記録, 2026-08-05)

**本項は測定を実行する前に記録・コミットした。**

- **きっかけ(探索、事前登録ではない)**: 音声特徴量の議論から、収益率のスペクトルは平坦(平坦比 0.90〜1.16)で構造は**ボラティリティ包絡**にしか無いことを実測した(絶対収益率の低域が EURUSD 2.74倍・XAUUSD 3.52倍)。続けて「翌24本の実現ボラティリティ」を対象に窓長を振ったところ、**既存分類が使う14本窓が試した中で最悪**だった:

  | 窓長(本) | EURUSD | XAUUSD |
  |---|---|---|
  | **14**(既存の `atrLookback`) | **0.0260** | **0.1528** |
  | 24 | 0.1101 | 0.2399 |
  | 48 | 0.1354 | 0.3558 |
  | 120 | 0.1513 | 0.4076 |
  | 240 | 0.1614 | 0.3990 |
  | 480 | 0.1598 | 0.3479 |
  | 6スケール併用 | 0.1982 | 0.4646 |

  単一の時系列7:3分割、交差検証なし、多重度補正なし。**余地の探りであって研究ではない**
- **一次の効きは窓長であって多重解像度ではない**: 最良単一スケールに対する6スケール併用の上積みは +23%(EURUSD)/ +14%(XAUUSD)にとどまる。14→120 の改善(5.8倍 / 2.7倍)のほうが遥かに大きい。**スペクトル特徴量一式を作る前に、窓長を直すのが先**である
- **凍結する変種**: 既存と同形(短窓ATRを長期ベースラインで割った比を低/通常/高へ分類)のまま、`atrLookback: 120`、`volatilityBaselineLookback: 480`。閾値 `highVolatilityRatio 1.5` / `lowVolatilityRatio 0.75` は既存のまま動かさない。ベースラインは分子の4倍とし、既存の 50/14 ≒ 3.6倍という比率設計を踏襲する
- **窓長120を選んだ経緯を明示する**: この値は上の探索から選んだ。**ただし選定の指標(将来ボラティリティのR²)と、本事前登録が判定する指標(群内均質性・ラベル安定性)は別物**である。同一指標で選び同一指標で判定すれば循環するが、そうしていない。それでも「探索を見て決めた値」であることは事実であり、隠さない
- **判定する2軸**(いずれも時系列後方30%の未使用区間、6通貨のM60集約):
  - **群内均質性**: 各ラベル内での「翌24本の実現ボラティリティ(対数)」の分散。分類器の仕事は、同一regime対照が like-for-like になるよう観測をまとめることなので、これが本来の目的量である。**小さいほど良い**
  - **ラベル安定性**: 隣接する非重複アンカー間でラベルが変わる割合。毎バー切り替わる分類器は、予測が良くても条件付けには使えない。**既存より悪化しないこと**
- **採用条件**: 群内均質性が**6通貨中5通貨以上**で改善し、かつラベル安定性が既存より悪化しないこと
- **採用しても移行は別の判断である**: `atrLookback` は feature scan の `regime`、carry preflight の `fixed_regime`、`VOLUME_PROFILE_SAME_REGIME_BASELINE_V1` が参照しており、変えれば **#58 の偽陽性率も #60 の校正済み構成も測り直し**になる。**本事前登録が認めるのは「変種のほうが分類器として良い」という測定までで、移行の是非はコストと併せて別に決める**
- **結果 — 条件は通過したが、比較として無効(2026-08-05)**: 群内均質性は6/6で改善(-0.8%〜-17.7%)、ラベル安定性も6/6で改善(既存のフリップ率18.7〜50.7%に対し変種1.0〜7.2%)。**事前登録した2軸は両方とも満たされた。しかし採用も棄却もしない**
- **無効と判断する理由**: 変種は5通貨で "low" へ **1〜6%** しか割り当てず(EURUSD l2%/n95%、GBPUSD l1%/n98%、EURGBP l1%/n97%、AUDNZD l2%/n97%)、外部指標(翌24本の実現ボラティリティ)に対する順序 low<normal<high が **1/6 通貨でしか成立しない**(既存は5/6)。**変種は「分類をやめること」で条件を通した**。均質性も安定性も、全部を一つのラベルへ入れれば改善する
- **事前登録の欠陥はこちらにある**: #70 の2軸は**ラベルが識別力を持つことを要求していなかった**。変種の性質ではなく、判定条件の設計不良である
- **技術的原因**: 閾値 1.5/0.75 を「既存のまま動かさない」ことを保守的な選択として凍結したが、これが逆だった。閾値は比に掛かるが、**比の分散は窓長に依存する**。120/480 の比は 14/50 より分散が小さく、同じ閾値ではtailラベルが機械的に消える。**窓長を変えるなら閾値も選び直さねばならず、片方だけ動かした比較は成立しない**
- **事後基準で失格にはしない**: 結果を見てから「順序性」を第3の基準に追加して変種を落とすのは、#69 で禁じたのと逆向きの同じ操作である。**「条件は通過したが、条件が測りたいものを測っていなかった無効な比較」**として記録し、行動の根拠にしない
- **副次的な観測(探索)**: 既存分類も M60 では較正が崩れている。EURUSD 60%・EURGBP 57% が "low"、"high" は 0〜7% しかなく、XAUUSD では順序も崩れる。**窓長より閾値較正が一次の問題である可能性を支持する**
- **失敗時**: 既存分類を据え置き、包絡方向の研究はここで打ち切る。多重解像度・ケプストラム等へ進む前に、まず窓長という一次の要因で改善しないなら、より複雑な記述で改善する見込みは薄い

### #69 事前登録の条件は満たされず、リード・ラグの封鎖を継続する(2026-08-05)

- **結果**: **1231/25000 = 4.924%**、Wilson 95% **[4.663, 5.199]**。上限が 5.199% で **条件(上限 < 5.000%)を満たさない**。#68 の事前登録どおり、`candidateEligible` は固定 false のまま、リード・ラグ候補規約は封鎖継続、別手法へ移る
- **実行方法**: 監査の `MAX_REPLICATIONS` は 2,000 であり、25,000 を単一呼出しでは回せない。**この上限は動かしていない** — 測定を通すために資源ガードを緩めるのは順序が逆で、しかも触らずに済む方法があった。各複製は `seed = firstSeed + index` で決まるため、種 1..25,000 を13バッチへタイル分割すれば単一実行と同じ複製集合になる。**被覆は隙間なく重複なく検証済み**(distinct 25,000、最小1、最大25,000)、13バッチすべて `complete`・失敗0
- **単一のハッシュは存在しない**: 単一実行ではないので、この率を1つの `inputHash` で引用することはできない。バッチ別ハッシュとタイル規則の両方が再現の条件である:
  - 種 1..2000: 88/2000, `sha256:b1e969e3d87887c955e91c33321223296eb414a6a91997c1360472b9d4647352`
  - 種 2001..4000: 110/2000, `sha256:0f474691936a938d68d03bba46501c9a4cb6a000601bcf1f21d45bbc099d1c82`
  - 種 4001..6000: 112/2000, `sha256:32985c3d8000d864c0e675664664f3bf713afa5ed3855a8cb8c763db17d19480`
  - 種 6001..8000: 97/2000, `sha256:6a4497f0f20ff346dccb9180261ad864adcd458f836cd6ef211a8accf5ea41e7`
  - 種 8001..10000: 114/2000, `sha256:786a9514a154b7ecd167fa83065636910809d220d2fc7d9a66b832b173e40b29`
  - 種 10001..12000: 93/2000, `sha256:1f6b14863ecd5d872468b3da6c5777d7a313b59e36439d82d86147330c4c2c09`
  - 種 12001..14000: 88/2000, `sha256:66d4e7103c867450165cd039a0072be101921d0f47bb166cadddcc1218c252e3`
  - 種 14001..16000: 110/2000, `sha256:e02a1dd23f7d1c5e2fd92b18649fed67d7153fb0c470172d565cbfcbd0b8a928`
  - 種 16001..18000: 98/2000, `sha256:81757a666dd10b2eab44b44a3216fddfbee23ada7f7ce16d830ac905199408c0`
  - 種 18001..20000: 93/2000, `sha256:878b607798027698c0a55ee53fbd125f93cd671abe7c8293c40a34a4ea2e2293`
  - 種 20001..22000: 81/2000, `sha256:e1fde802b2116843a7f07fde18fe906a27afcf35b4b4fcd137f17ba6ce89dcfd`
  - 種 22001..24000: 103/2000, `sha256:fa7ac8bce6002625d4fac01126cae865ed7e0e1a6a3e145687d382b89a81edc3`
  - 種 24001..25000: 44/1000, `sha256:7854ee8d313c18df00818c92e40c3cbbde2448ddaafbae6cd4a6c982cd606d8c`
- **点推定は名目を下回っている**: 4.924% は 5% 未満であり、条件を満たさないのは**区間が5%を跨ぐ**ためである。「率が名目を超えた」わけではない
- **先の1,500複製は低い側に振れていた**: 4.73% [3.77, 5.93] は種1..1500の値で、先頭2,000バッチでは 4.40%、25,000全体では 4.924% に落ち着いた。#68 で「4.73%は雑音を含む点推定」と記録したことの実例である
- **より大きな n の見通し(すべて「真の率が推定値どおりだと仮定した場合」)**: 4.924% は**推定値であって真値ではない**。その値を真と仮定したときの条件通過確率は n=25,000 で 7.6%、100,000 で 19.0%、300,000 で 48.0%、1,000,000 で **93.8%**。したがって #68 で n=100,000 を推した根拠(真の率 4.73% なら 97.7%)は、推定値 4.924% に対しては 19.0% にすぎない。**推奨自体は誤りではないが、それで決着したはずだという含みは誤りだった**
- **この失敗が意味すること**: 点推定が名目を下回りながら区間が5%を跨ぐ、という位置にある。**「偽陽性率が名目を超える」ことの証拠ではない。**ただし「どんな n でも判定不能」でもない — 真の率が推定値どおりなら100万複製で93.8%通る。真の率が5%に近ければどの n でも通らず、4.7%付近なら遥かに小さい n で通る。**区間 [4.663, 5.199] はその全域を許容する**ため、大標本の帰結は現時点で不明である。この但し書きなしに引用してはならない
- **より大きな n を今回さない理由はコストではない**: 実測 35.7ms/複製で、1,000,000 は単一スレッド9.9時間、4並列2.5時間。実行可能である。**理由は方法論**であり、事前登録した 25,000 が失敗した後に n を増やして再挑戦するのは、まさに事前登録が防ぐための逐次停止(optional stopping)にあたる。個々の検定が妥当でも、決定手続き全体の第一種の誤りが膨らむ。大標本で見るなら**別の事前登録**として、その理由を今回の率とは独立に述べてから凍結する必要がある
- **条件は緩めない**: 結果を見てから「上限 < 5.2%」などへ動かせば、事前登録の意味が消える。#57 の最小効果量、#60 の校正済み構成、#67 の窓長と同じ扱いとする
- **残る道(いずれも別の事前登録)**: (i) 判定量を上限ではなく点推定や下限に変える、(ii) 名目αを実測率へ合わせて絞る、(iii) 符号反転とは別の第3のヌルを設計する。いずれも**新しい研究者自由度**であり、実施するなら理由を率とは独立に述べてから凍結する必要がある
- **訂正(2026-08-05)**: 初版は「より大きな n でも結果は変わらなかった」「実行可能な n では満たせない」と書いていたが、**同じ項に載せた表が100万複製で93.8%と示しており内部矛盾していた**。実際 1,000,000 は4並列2.5時間で実行可能である。また 4.924% を真値のように扱っていた。大標本の帰結は真の率に依存し、その真の率は区間 [4.663, 5.199] の全域を許容するため不明である、が正しい記述である。封鎖継続という結論と、25,000での事前登録済み判定が失敗したという事実は変わらない
- **横並びの現状**: 循環シフト+標準化 7.93% [6.67, 9.41](超過確立)、符号反転+標準化 5.93% [4.85, 7.25]、**符号反転・生 4.924% [4.663, 5.199]**(25,000複製)。符号反転・生が最良であり、名目のすぐ下にあるが、事前登録した基準は満たさない

### #68 リード・ラグ封鎖解除の事前登録(測定前に記録, 2026-08-05)

**本項は測定を実行する前に記録・コミットした。** 後から書けば、結果を見て条件を書いたのと区別がつかない。

- **判断**: 現時点で `candidateEligible` は解除しない。#67 の最厳模型(共有ボラ因子ペア)で 95% 区間上限が 5.93% と 5% を超えているため
- **凍結する解除条件**:
  - **対象**: `factor_regime_switching_volatility_pair`(rho 0.7)**のみ**。最も厳しい1模型で決める
  - **手続き**: ブロック符号反転・**生収益率**。#67 で併用が単独より悪い(4.73% → 5.93%)ことが分かっているため、標準化は使わない
  - **反復数**: 合計 **25,000**、`firstSeed: 1`。既測の1,500複製が**先頭ブロックとして入れ子**になる純粋な延長であり、引き直しではない
  - **条件**: Wilson 95% **上限 < 5.00%**
  - **他5模型**: 現行1,500複製を保持し、**プールも平均化もしない**
  - **成功時**: `candidateEligible` の固定 false を解除し、実データへ再適用する
  - **失敗時**: リード・ラグ候補規約は封鎖継続、別手法へ移る
- **検出力を先に記録する(重要)**: n=25,000 は、観測率が 4.73% のままなら上限 4.998% と**5% をぎりぎり下回る点**である。しかし観測率自体が確率変数であり、**真の率が 4.73% のとき条件が通る確率は 49.4%** — ほぼコインフリップである。n=50,000 で 79.4%、n=100,000 で 97.7%。実行費用は 35.7ms/複製で、100,000 でも単一スレッド約60分と軽い
- **したがって失敗は「真の率が名目を超える」ことの証拠にならない**: 真の率が 4.5% なら 25,000 でも 95.9% で通り、4.73% なら半々、5.00% ならどの n でも 2.4%(第一種の誤りは名目のまま保たれ、n を増やしても判定は緩まない)。**失敗した場合、真の率が名目以下である可能性はおよそ半分残る**。この但し書きなしに失敗を引用してはならない
- **より大きな n を推したが採らなかった**: 失敗時の行動が恒久的(封鎖継続・別手法へ移行)である以上、誤って諦める代償が大きいため n=100,000 を推した。25,000 を採るのは記録された判断であり、上の但し書きはその判断と対で残る

### #67 処方(b)ブロック符号反転が、名目水準を保った唯一のヌルだった(2026-08-05)

- **経緯**: #64 で循環シフトのヌルが共有ボラのペアに対し 69.5% の偽陽性を出し、処方(a)因果的標準化で 7.93% [6.67, 9.41] まで下げたが**超過は確立したまま**だった。本項は残っていた処方(b)を実装し、同じ6模型パネルで (a) と突き合わせた測定である
- **実装**: 参照系列を固定長ブロックへ切り、各ブロックへ独立な乱数符号を掛ける。**`|r|` が一切動かない**ため、両系列のボラ経路と**その同期**が完全に保存され、69.5% を生んだ機構そのものが消える。ブロック長は `max(50, 10 × maxLagBars)` に凍結 — 走査ラグより十分長く取り、境界をまたぐ対だけが符号関係を失う
- **計算量の設計**: 符号はブロック定数なので、ラグ×ブロックの部分和を一度だけ前計算すれば、各反復は `Σ_b ε_b · C[k][b]` の O(ラグ×ブロック) で済む。二乗和は符号で不変なので一度きり。素朴な実装では監査(1,500複製×1,000反復)が回らない
- **1,500複製の確定値**(同一条件: 2分割fold、firstSeed 1、5,000本・60分足・maxLag 10・最小30・95%・trial 1、共有ボラ因子ペア rho 0.7):

  | 処方 | 率 | Wilson 95% | 名目5%の超過 |
  |---|---|---|---|
  | (a) 循環シフト + 標準化 | 7.93% | [6.67, 9.41] | **確立** |
  | (b) 符号反転 + 標準化 | 5.93% | [4.85, 7.25] | 未確立 |
  | **(b) 符号反転・生収益率** | **4.73%** | **[3.77, 5.93]** | **未確立** |

  すべて `complete`・失敗0。`inputHash` は (b)生 `sha256:fb336e7e...`、(b)+標準化 `sha256:d44e12c5...`
- **6模型パネル(400複製)では他5模型が3構成とも 2.00〜3.00%** で、どの処方も他模型を悪化させない
- **(a) と (b) は足し合わせるものではない**: 併用は (b) 単独より悪い(4.73% → 5.93%)。符号反転が既にボラ同期の問題を解いているため、標準化は情報を削るだけになり、20本窓の推定自体の雑音も乗る。**二つの処方は独立した改善ではなく、同じ病理への競合する処方だった**
- **事前に懸念した反保守性は出なかった**: 符号反転はラグ0の同時相関も壊すため、Bartlett の公式経由で逆向きに反保守的になる可能性を挙げていた。実測では `factor_null_pair` が (b)生 2.00% / (a) 2.25% とほぼ同一で、この設定では効いていない
- **識別子を4系統へ分けた**: 符号反転は循環シフトの設定違いではなく別のヌルなので、生・標準化それぞれに独自の方法論版を持たせた。あわせて **runner 版がヌル方式を符号化していなかった**問題を修正 — `v2`(シフト生)・`v3`(シフト標準化)・`v4`(符号反転生)・`v5`(符号反転標準化)。率を引用する読み手が最初に見るのは runner であり、2つの異なるヌルが同じ名前を共有する状態は、測定値が別の手続きへ帰属される経路そのものである。`nullPolicy` は `study` 内にあり `inputHash` も両者を区別する。**runner は hash 対象の外**にあるため、この改名で既存ハッシュは変わらない(上記の値は改名後も有効)
- **測っているのは統計ゲートであって候補ではない**: `candidateEligible` はリード・ラグでは現在 `false` 固定(fail-closed)であり、監査は下層の `statisticalGateEligible` を測る。この分離がないと、封鎖中は校正が構成上ゼロを報告し、**封鎖を解いてよいことを永久に示せなくなる**。本項の率はすべてこの統計ゲートのものである
- **未決 — 封鎖を解くかの判断**: (b)生で 4.73% [3.77, 5.93] と名目を跨ぐところまで来たが、区間上限は 5.93% で、名目ちょうどに載っているとは言えない。解除するなら (i) この水準を校正値として受け入れる、(ii) 反復数を上げて区間を締めてから判断する、(iii) 他5模型も (b)生で1,500複製へ揃えてからパネル全体で判断する、のいずれか。**#64 の残課題であった処方(b)の実装と比較は本項で完了**しており、残るのは解除の可否という研究判断のみ

### #66 横断次元は carry の律速ではなかった — #47 を待機へ降ろす(2026-08-05)

- **目的**: #65 で「2031年は報告開始であって予算どおりの検出力に届く日ではない」と分かったため、(b) 公式改訂履歴での探索と (c) 別事前登録の設計を進めた。(c) の想定した梃子は**短い horizon** と**拡張通貨パネル**の2つで、本項はその両方が効かないことの実測である
- **GBP公式取得器を追加(一次ソース)**: BoE Interactive Database の `IUDBEDR`(Bank Rate 日次)。**文書化された `/boeapps/iadb/` パスは302を返す**ため、収集器が設計上リダイレクトを追わない以上、転送先 `/boeapps/database/_iadb-FromShowColumns.asp` を正規URLとして固定した。両者の本文はSHA-256一致を確認済み。実応答は13,040行・1975-01-02〜2026-08-03、変更点259件、共通開始2009-04-21以降は25件。系列すり替え・不正日付・順序破れの拒否をテストで固定
- **NZDは見送り**: RBNZ は**ルートを含む全パスで403**を返し、プログラム的アクセスを一律遮断している。ボット検出の回避はしない。BIS の SDMX v2 `WS_CBPOL D.NZ` は取得でき `SOURCE_REF: Reserve Bank of New Zealand` を持つが、**二次編纂者**であり他6通貨(ECB/BoC/FRED/RBA/SNB/BoE)の一次ソースとは出自の質が違う。加えて `COMPILATION` が「1999-03-17以降=OCR、1985-01〜1999-03-16=翌日物現金金利」と**定義変更**を明記する。週末は `NaN` で埋まっており、素朴に変化点を取ると 1,321件の偽の変更が出る(NaN除去後の真の変更点は77件)。**推測パーサーを置かない規律が実際に効いた例**である
- **金利側の実測(2009-04-21〜2025-10-30、4,313営業日)**: ゼロ金利差は **USDCHF が870日(20.2%)**で、以前2011〜2014年に測った19.2%が全期間で追認された。#65 が「2031-04-01 は同値除外なしの下限」と書いたとおり、**実際の到達はさらに後ろへずれる**。符号反転は17年で EURUSD 1・USDJPY 0・AUDUSD 3・USDCHF 0 に対し **USDCAD 9・GBPUSD 10** と、金利差中央値が最小(ともに0.38pp)の2ペアで多い
- **horizon はアンカー数を買うが検出力を買わない**: 使用可アンカーは5営業日633本・10営業日317本・20営業日158本(使用可率はいずれも約73%で horizon に依らない)。しかし carry は金利差の**時間比例**の累積であり、1観測の効果 ∝ h、雑音 ∝ √h、観測数 ∝ 1/h で、総合の t 統計量は **h⁰**。#56 で足の長さについて確認したのと同一の論法であり、**horizon 短縮による改善はゼロ**である
- **拡張パネルの実測(同一シード `carry-panel-2026-08-05`、20営業日、3アンカーblock、2,000反復、探索用時変符号)**:

  | | 5ペア | 6ペア(GBPUSD追加) |
  |---|---|---|
  | 名目行 | 830 | 996(+20.0%) |
  | 平均ペア間相関 ρ̄ | 0.2858 | 0.2585 |
  | bootstrap design effect | 1.804 | **1.949** |
  | 実効行 | 460.1 | 511.1(+11.1%) |
  | 60アンカー時のMDE | 4.35%/年 | **4.13%/年** |

- **名目20%増が実効11%増にしかならない**: GBPUSD 自体は良い追加で、USDJPY と0.024・USDCAD と0.015 とほぼ無相関、ρ̄ はむしろ下がった。それでも design effect は上がる。**最小検出可能効果の改善は5.1%**にとどまる
- **拡張の上限**: 学術報告の下端2.4%/年に届くには実効547行が必要で、60アンカーのままなら**18ペア**、6ペアのままなら**178アンカー=14年**。G10に独立なcarryペアは18本存在しない。**横断次元は律速ではなく、律速は暦時間そのもの**である
- **判断 — #47 を待機へ降ろす**: (c) が想定した2つの梃子はどちらも効かないため、これ以上 carry へ投資しても得られるものが増えない。**収集は止めない**(止める理由がなく、判定は自動的に来る)。装置は完成しており、主検定・readiness・心臓部台帳・preflight・依存構造測定はすべて実装・検証済み。2031年に 4.13%/年 で報告が始まり、学術報告の上半分だけが射程に入る
- **降ろさなかった選択肢**: carry を**時間比例でない仮説**(政策変更前後の一過性リプライシング)として立て直せば horizon の梃子は復活する。ただし測る対象が carry そのものではなくなるため、名前・契約・母集団を分けた別研究になる。着手する場合は本項の測定を出発点にできる

### #65 carry主検定は「報告開始日」と「予算どおりの検出力に届く日」が別である(2026-08-05)

- **きっかけ**: 暦待ちの間に readiness を実測した。`first_eligible_anchor_date: 2026-08-25`、`estimated_earliest_complete_window_date: 2031-04-01`、`collection_continuity_status: collecting_within_gap_limit`、心拍遅延0営業日、6通貨すべて `first_usable_date: 2026-07-28`。**収集機構は健全に待機している**
- **見つけた不整合 — 最小効果量と停止規則が別々の標本サイズで作られている**: 事前登録の `minimum_annualized_effect: 0.027` は、時変符号パネルの実効456.4行を432行へ切下げた予算から導かれた。一方 `minimum_anchor_clusters: 60` は評価可能になる下限であり、**60アンカー × 5ペア = 名目300行、design effect 1.819 で実効164.9行**にしかならない
- **実測した対応表**(MDE は実効行数の平方根に反比例):

  | アンカー | 名目行 | 実効行 | 最小検出可能効果 | 収集年数 |
  |---|---|---|---|---|
  | **60**(評価可能になる点) | 300 | 164.9 | **4.37%/年** | 約4.8年 |
  | 100 | 500 | 274.9 | 3.38%/年 | 約7.9年 |
  | **157**(予算どおりの432行) | 785 | 431.6 | **2.70%/年** | 約12.5年 |
  | 249 | 1,245 | 684.4 | 2.15%/年 | 約19.8年 |

- **帰結**: 2031-04-01 は「主検定が最初に報告できる日」であって「予算どおりの検出力に届く日」ではない。後者は**約157アンカー、2038年前後**である。60アンカー時点では、契約が要求する2.7%と実際に検出できる4.37%の間に隙間があり、**3%程度の効果は採用条件を満たすのに4割ほどしか見つからない**
- **どちらの数字も誤りではない**: 60は循環移動blockが3アンカーであることから、20ブロック確保という**bootstrapの妥当性下限**として説明がつく。2.7%は**採用の床**であり、10bps下限(#57)と同じ役割である。両者は別の問いに答えており、それぞれ正しい。問題は**記録がその区別をしておらず、2031という日付が「問いに答えられる日」と読める**ことである
- **選択肢**: (i) 区別を明記して2031を「報告開始」と読み替える(最も安価で、契約を一切動かさない)、(ii) 最小効果量を60アンカー時点の4.4%へ引き上げる、(iii) 最小アンカー数を157へ引き上げる。**(i)を採る** — (ii)(iii)はいずれも凍結済み契約の変更であり、結果を見る前とはいえ動かす理由が「読みにくいから」では弱い
- **さらに悪化させる要因(既測)**: 2031-04-01 は readiness 自身が「金利差ゼロのアンカー除外がない」前提と明記する下限である。実測では2011〜2014年にUSD/CHFの同値で224アンカー中43本(19.2%)が失われた。同程度の同値が起きれば、60**使用可能**アンカーへ到達する暦日はさらに後ろへずれる
- **この期間にできること**: 主検定の暦は動かせない。動かせるのは、(a) 収集の連続性を切らさないこと(心拍台帳が5営業日規則で監視済み)、(b) 探索用の改訂履歴パスで機構を検証し続けること、(c) 検出力が足りる別の設計を**別の事前登録として**立てること。(c)は主検定へ合流させない

### #47 FX carry の研究基盤(優先度: 待機 — #66 で降格、収集は継続)

- **課題**: carry / momentum / value はFXの三大ファクターで、[200年超の検証](https://quantpedia.com/fx-carry-value-momentum-strategies-over-their-200-year-history/)があり、[2025年の研究](https://onlinelibrary.wiley.com/doi/10.1111/fire.70000)ではデータスヌーピング補正後も最適化ファクターが素朴なファクターを上回るとされる。このプロジェクトではmomentum系・FVG・特徴量を一通り検証して残らなかったが、**carryだけが本流のうち手つかず**で残っている
- **設計**: 既存の金利系列(`TVC:US10Y` 等)・レジーム分類・クロスアセット結合を流用し、金利差プロキシと通貨ペアの将来リターンをイベント研究として測る。**carryを短期シグナルへ直結させない**。まず中期の条件付きドリフトとして、金利差の水準・変化が将来リターンを分けるかを見る。前向き固定窓(`signal_from`)と同一レジーム基準差分(`selectionContrast`)を最初から適用し、探索段階から対照を持たせる
- **前提**: carryはクロスセクショナルな構成なので、2026-07-27に測った単体系列のドリフト問題とは性質が異なる。ただし金利差の高い通貨が構造的に減価する可能性(uncovered interest parity)は、それ自体がドリフトとして効くため、対照は同様に必須
- **規模**: 中。金利差プロキシの構成と point-in-time 性の担保が主な作業。金利系列の改訂・vintage は実質金利first-seenストアと同じ問題を持つため、そこの経験を流用できる
- **実装前のデータ契約(2026-07-28)**: イベント研究より先に、各金利観測へ`effective_at`(政策変更が効力を持つ時刻)、`available_at`(市場で利用可能と扱う時刻)、`observed_at`、source、vintage/first-seen状態を保存する。政策金利差をcarryの**主系列**とし、2年金利差は市場が織り込む政策経路の補助プロキシへ分離する。FRED通常値のように「今日わかる過去」は遡及研究専用として明示し、前向き/OOS判定にはfirst-seenまたは明示的なreal-time vintageだけを使う
- **標本予算(2026-07-28)**: 20年は平日概算5,217本であり、20営業日先リターンを非重複にすると日次・週次とも上限約260本、月次アンカーは約240本となる。したがって主検定は月次アンカー・20営業日先・単一の金利差定義とする。1つ固定したレジームへ絞ると概算60〜120本、さらに金利差方向で二分すると30〜60本へ落ちるため、主検定でレジーム以外の追加分割をしない。最後の5年を未使用OOSに取れば月次約60本なので、OOSは採否の確定ではなく前向き蓄積の起点として扱う
- **横断パネル設計(2026-07-28)**: 単一ペアの時系列だけではなく、各ペアをcarry方向へ正規化した通貨横断パネルを用いる。ただし`pairs × months`を独立観測数と数えない。同月の全ペアを一塊として再標本化する時間ブロック・クロスセクション・ブートストラップで、共通ドル要因と時系列依存を保持する。主モデルは`20営業日先リターン = ペア固定効果 + 金利差プロキシ + 固定済みレジーム条件`とし、通常のpair-clustered標準誤差だけで採否を決めない
- **可用性コホート**: `TVC:US02Y`(2005-03-15)、`TVC:AU02Y`(2006-01-03)、`TVC:JP02Y`(2006-07-20)を含む長期core panelは最遅開始日の2006-07-20以降で構成する。`TVC:NZ02Y`は2016-04-26以前へ遡れないため、NZを含むextended panelは2016-04-26以降の**再現確認**に限定し、core主検定と混ぜない。EUR・GBPを含める前に同じ開始日・vintage契約を満たす2年/政策金利系列を確認する
- **実装受入条件**: イベント研究を許可する前に、`carry_panel_preflight`が各コホートについて、共通利用可能開始日、月次アンカー数、20営業日非重複後の件数、pair別・固定レジーム別の件数、OOS期間に残る件数、欠損/改訂/vintage状態を返す。主セルの見込件数が事前最低値を満たさなければ`not_evaluable`とし、閾値・ペア集合・レジームを結果を見て差し替えない
- **TradingView政策金利系列の実機確認(2026-07-28)**: `ECONOMICS:USINTR`、`EUINTR`、`JPINTR`、`GBINTR`、`AUINTR`、`NZINTR`、`CAINTR`、`CHINTR`の8系列を日足で読み戻し、全て有効な値を返すことを確認した。直近300観測の最古日時は、US/CAが2003-10-01、EUが2003-03-06、JPが2002-06-28、GB/NZが2003-05-01、AUが2000-10-03、CHが2002-12-02であった。この範囲での8通貨共通開始候補は2003-10-01。ただしこれは読み込まれた300観測内の下限であり、最終的な開始日は各系列の追加履歴ロード後に固定する
- **政策金利の結合契約**: `ECONOMICS:*INTR`は毎営業日の連続値ではなく、政策変更日と月初・月末付近が混在するステップ観測として取得された。`policy_rate_asof`は、アンカー時刻以前の最新観測だけを採用する右連続(as-of)結合とし、最初の観測より前・観測間の未来値による後方補完・最も近い日付への丸めを禁止する。各採用値に`source_symbol`、`source_observed_at`、`source_value`、`age_days`を残し、最大許容ageを超えるものは`stale`として主検定から除外する
- **時刻とvintageの扱い**: `ECONOMICS:*INTR`のバー時刻は決定日の00:00 UTCであり、実際の公表時刻ではない。中銀ごとに公表時刻が1〜19時間程度異なり一律補正はできないため、`available_at`の既定は**決定日の翌UTC営業日00:00**(`next_utc_business_day_start`)とする。これは厳密なFXセッション始値を主張しない、会合時刻表なしで再現可能な保守的境界であり、当日リターンへのリークを防ぐ。TradingViewのバー時刻は`source_observed_at`としてだけ保存し、`effective_at`や真の`available_at`の証明には使わない。政策金利にも実質金利first-seenストアと同一の追記型ストアを設け、`source_symbol`、決定日、値、`first_seen_at`、revisionを保存する。前向き/OOS利用は`max(first_seen_at, available_at)`以後に限り、既存履歴を用いる遡及探索は`revised_history`と表示して同じ候補のOOS証拠と混在させない
- **実装開始(2026-07-28)**: `PolicyRateFirstSeenStore`、8通貨の`ECONOMICS:*INTR` mapping、翌UTC営業日境界、`collect:policy-rates` CLIを追加する。CLIは明示的な`--confirm-chart-switch`、既存のプロセス横断chart lock、通貨ごとの読み戻し検証・復元を必須とする。通常の`coverage:first-seen`にも政策金利ログの蓄積状況を表示する。次段階はMCPのas-of読出しとcarry panel preflightへの接続
- **as-of context・preflight実装(2026-07-28)**: `get_policy_rate_context`はfirst-seenかつ`available_at`到達済みの版だけを返し、現在値や履歴再取得値へフォールバックしない。`carry_panel_preflight`は固定pair・from/to・horizon・OOS境界から、各pairの`data_available_from`、完了済み非重複アンカー数、OOSアンカー数、rate difference、blockerを返す。収集開始直後は8通貨各1件でも長期標本は**0件・`not_evaluable`**であることを単体/MCP統合テストで固定した。次段階は、収集期間が育った後に同じpreflightへ価格・固定regimeの実測coverageを接続すること
- **価格・固定regime coverage接続(2026-07-28)**: `carry_panel_preflight`へ`price_evidence`と`fixed_regime`を追加する。各pairは既にロードされた**日足**chart index・symbolへ厳密に束縛し、確定OHLCだけから固定閾値のregimeを計算する。政策側の非重複アンカーを、実在する日足かつ指定directional/volatility regimeに一致した日だけへ縮小して`price_matched_anchors`と`fixed_regime_anchors`を返す。価格補完、形成中バー、Bar Replay、日足以外、pair不足、レジーム片指定は拒否する。これにより、政策金利の前向き蓄積が育っても、価格またはregime coverageの不足を件数へ偽装できない
- **OOS・コホート境界の確認(2026-07-28)**: `price_evidence`なしのpreflightで`oos_anchors`が全アンカーへ上書きされる不具合を、価格証拠あり・なしの両経路で分離するよう修正した。`from`/`oos_from`は1回のpreflightで共通であり、これは意図的なコホート境界である。NZを含まない2006年開始のcore panelと、NZを含む2016年開始のextended panelは**別のpreflight呼出し**として固定し、同じ結果表・同じ統計母集団へ混在させない
- **初期パネル**: 8通貨から、直接の主要FXペアを持つ USD/EUR/JPY/GBP/AUD/NZD/CAD/CHF を候補通貨集合とする。各ペアのリターンを「base policy rate - quote policy rate」が正となるcarry方向へ正規化する。主研究では政策金利差の水準を1定義に固定し、2年金利差は政策経路の補助説明変数として別の事前登録仮説に分離する
- **探索用の時変carry符号(実装, 2026-07-29)**: `measure_carry_panel_dependence`へ`use_exploratory_official_rate_signs`を追加する。各pairは`base_currency`/`quote_currency`を明示し、公式改訂履歴のアンカー日as-of値から `base - quote` の符号を再構成する。金利差ゼロ、片側履歴なし、BoJ等の`no_single_rate_target`状態は符号を作らず、非重複候補アンカーから除外数を返す。時変符号を使っても`evidence_tier: exploratory_revised_history`・`point_in_time_status: not_available`を返し、first-seenの`policy_rate_asof`、主検定、OOS採用根拠へ接続しない。目的は固定符号時のρ/design effect見積りを、過去の実際の金利差方向で再測定することだけである
- **時変符号の依存構造実測(2026-07-29)**: EURUSD/AUDUSD/USDJPY/USDCAD/USDCHFの5ペアを、公式改訂履歴からアンカー日ごとに再構成した `base policy rate - quote policy rate` の符号で正規化した。日足共通価格は2007-04-26〜2026-07-27の4,997本、20営業日horizon、3アンカー循環移動block、2,000反復。249本の非重複候補から、USDJPYの単一金利目標なし期間、USDCAD・USDCHF等の片側履歴不足、EURの不足により83本を除外し、**166アンカー・名目830行**となった。平均pairwise相関は **ρ̄=0.296**、等相関のcross-sectional design effectは**2.182**、同日5ペアを一塊にするbootstrap design effectは**1.819**、精度等価の実効標本は**456.4行**だった。20営業日平均のbootstrap 95%区間は -0.053%〜+0.382%でゼロを跨ぐが、これはcarry収益の採否ではなく依存構造の測定である。探索用公式履歴のため前向き/OOS根拠には使わない
- **検出力予算の更新(2026-07-29)**: 静的符号の実効1,245行・年率最小効果量約1.6%という予算は、時変符号の実効456.4行では同じボラティリティ・両側5%・80%検出力の前提で**約2.6%/年**へ悪化する。実装・データ更新による変動を吸収する主検定の保守的な事前登録値は、実効標本を**432行**へ切下げ、**約2.7%/年**とする。これは十分な効果しか識別できないという設計制約であり、結果を見てレジーム・ペア・horizonを選び直す理由にはしない
- **Carry主検定の固定契約と回帰基盤(実装, 2026-07-29)**: `run_carry_core_primary_test`は `carry_core_primary_v1` として、EURUSD/AUDUSD/USDJPY/USDCAD/USDCHF、開始日2026-07-28、20営業日先リターン、最低60アンカー日クラスタ、3アンカー循環移動block、2,000反復、年率2.7%/1 percentage point の最小効果を固定する。主モデルは `forward_pair_return = pair_fixed_effect + beta * policy_rate_differential + residual`、すなわち無条件の固定ペア・パネルをベースラインとし、レジーム分割はこの主検定へ加えない別の事前登録研究とする。各アンカーでは `available_at` と `first_seen_at` がアンカー日終値以前のfirst-seen版だけから金利差を右連続で再構成し、公式改訂履歴には接続しない。bootstrapは同一アンカー日の全ペアを一塊にして再標本化し、その都度pair固定効果を再推定する。first-seen履歴が60クラスタに届くまで、推定値を出さず `not_evaluable` を返す
- **主検定readiness表示・heartbeat結合(実装, 2026-07-29)**: `get_carry_core_primary_readiness`はチャートを触らず、core 6通貨のfirst-seen版とcomplete heartbeatを結合する。最初の両証拠利用可能日を、2026-07-28起点の固定20営業日アンカー格子へ切り上げ、その最初の有効アンカーから60×20営業日後を**最短**完了見込み日とする。最初のheartbeatが2026-07-30なら、7月28日の先頭アンカーは失われ、次は8月25日、最短完了日は2031-04-01となる。`collection_continuity_status`は `not_proven_no_collection_heartbeats`、`collecting_within_gap_limit`、`gap_exceeded` を実台帳から返す。これは将来のheartbeat・全pair確定日足が連続し、金利差ゼロ除外がない理想条件の下限であり、実際の評価可能性は引き続き主検定が判定する。heartbeat recordの実測最大サイズは1,043 bytesで、2,048-byte上限内に十分収まる
- **政策金利収集heartbeat(実装, 2026-07-29)**: 値が変わらない日の収集成功も証明するため、policy-rate value logとは別にowner-only追記型 `policy-rate-collection-heartbeats.jsonl` を追加した。8通貨の全取得、value logへの保存、各一時chart切替の復元がすべて成功したrunだけを、収集時刻・chart index・通貨別source/決定日/bar数とともに記録する。部分成功やvalue log保存失敗ではheartbeatを残さない。`coverage:first-seen`はheartbeatの件数・初回/最終時刻を統合表示する。次段階は主検定でこのrun列からアンカーまでの最大許容収集gapを固定し、gap超過アンカーを拒否すること
- **heartbeat coverageの連続性指標(実装, 2026-07-29)**: recordsは同日再実行で増えるため、`complete_currency_runs`というrecordsの言い換えは廃止した。coverageは`distinct_observation_dates`、`duplicate_run_dates`、連続する異なるrun日間の`maximum_business_day_age_between_runs`、主検定の5営業日上限を超えた`intervals_exceeding_primary_max_gap`、照会時点までの`latest_run_age_business_days`を返す。これによりlaunchd再試行と実際の収集停止を区別して監視できる
- **主検定のheartbeat gap拒否(実装, 2026-07-29)**: `carry_core_primary_v1`自身へliteral `max_heartbeat_gap_business_days: 5` を固定し、収集coverage側がこの凍結値を参照する。運用定数の変更で事前登録契約が黙って変わらない。各アンカー日終値以前の最新complete heartbeatが5営業日を超えて古い、または存在しない場合は、値のfirst-seen版があってもその日付クラスタ全体を `anchors_excluded_for_collection_gap` として除外する。heartbeatは後から追加したrunを過去アンカーへ使わず、`as_of`以下かつアンカー日終値以下だけを読む。健全な平日収集のageは通常1であり、固定値5は最大5営業日ぶん古い政策金利を使うこと、すなわち丸一週間程度の停止を許容する契約である。その間の変更は `first_seen_at > anchor` のため使われず、古い金利が残る。回帰・bootstrapはこのgate通過後のアンカーだけで実行する
- **パネル依存構造の実測(2026-07-29)**: `measure_carry_panel_dependence`でcore panelを実測した。EURUSD/AUDUSD/USDJPY/USDCAD/USDCHFの5ペア、2007-04-25〜2026-07-26、共通営業日4,997、20営業日の非重複アンカー249本。現在の政策金利(USD 3.75 / EUR 2.40 / JPY 1.00 / AUD 4.35 / CAD 2.25 / CHF 0.00)からcarry方向へ符号を固定した結果、**平均ペア間相関 ρ̄ = +0.049**、クロスセクション design effect 1.20、ブートストラップ design effect は raw 0.92 を上限で1へ丸め、名目1,245に対し実効1,245となった。GBPUSDは英米とも3.75%で符号が定まらないため除外した
- **想定との乖離と理由(2026-07-29)**: 事前に置いた ρ=0.6・design effect 3.75 という仮定は**大きく外れていた**。carry方向へ正規化するとドル要因がペアごとに逆向きに入り相殺されるためで、実測でも EURUSD-AUDUSD −0.62、AUDUSD-USDCAD −0.75 と強い負相関が残る。正規化前(全ペア return_sign=+1)では `XXXUSD` 群と `USDXXX` 群が ±0.6〜0.77 で二分し ρ̄ = −0.109 と打ち消し合う。**符号正規化を怠るとdesign effectが意味を失う**ことを実データで確認した
- **検出力の更新(2026-07-29)**: 実効1,245本での検出可能な最小効果量は年率約1.6%(80%検出力・両側5%・年率ボラ8%想定)。単一ペア249本の約3.5%から改善し、**学術報告のG10 carry(シャープ0.3〜0.6 = 年率2.4〜4.8%)が射程に入る**。ただし符号は現在の政策金利で固定した近似であり、実際のcarry符号は金利差の変動で反転する。時変符号のパネルでは相関構造が変わるため、この1,245は上限寄りの見積もりであり、政策金利履歴を揃えてから再測定する
- **定期収集開始(2026-07-28)**: `com.tradingview-mcp.policy-rate-collection`を平日10:45 JSTに登録した。画面を切り替えるCLIのため`RunAtLoad`は使わず、既存の外部first-seen収集(10:30)と分離する。chart-operation lockをMCPと共有し、衝突時は別プロセス間でも直列化する。パネル研究はfirst-seenの共通利用可能期間が育つまでpreflightの`not_evaluable`を正しい状態として保持する
- **ブートストラップ実効標本見積もり(2026-07-28)**: 主検定の前に、固定済みパネルの`anchor_date × pair_id × carry_return`を日付クラスタとして循環移動ブロックbootstrapする`estimate_carry_panel_effective_sample`を追加する。各ブロックでは同一日付の全ペアを必ず一緒に再標本化するため、共通ドル要因等のクロスセクション依存を壊さない。bootstrap平均との差分散を観測行IIDの平均との差分散で割ったdesign effectから、保守的に上限を名目行数へ切った`effective_observations`を返す。これは供給された**グランド平均**の精度等価件数であり、独立取引数、回帰の自由度、採用ルールではない。主検定のpair固定効果・時系列ブロックbootstrapとは別に、固定したペア集合・block length・seed・iterationsを事前登録して検出力予算を記録する
- **実測ρ preflight(2026-07-29)**: `measure_carry_panel_dependence`は、指定した日足FXペアを一時切替・復元して閉じた価格だけを読み、全ペアに共通する厳密な日付上でhorizon間隔の非重複リターンを構成する。明示した`return_sign`後の全pair組合せρ、平均ρ、等相関の参考design effect、同日全ペアを保持する循環移動ブロックbootstrapの実測design effectを返す。これは価格パネルの依存を主検定前に測るためだけのpreflightであり、政策金利のfirst-seen/vintage不足を補完せず、carry仮説の結果・採否・取引判断へ使わない
- **core価格パネルの実測(2026-07-29)**: EURUSD(-1)、AUDUSD(+1)、NZDUSD(-1)、USDJPY(+1)、USDCAD(+1)、USDCHF(+1)を、当日時点の政策金利差方向で固定して測定した。日足の共通日付は2018-11-13〜2026-07-26の1,996本、20営業日horizonの非重複アンカーは99本であった。平均pairwise ρは**0.188**、等相関の参考design effectは**1.940**、同日6ペアを一塊にする3アンカー循環移動block bootstrapのdesign effectは**1.515**で、名目594行は精度等価で**392.0行**となった。95% bootstrap平均区間は-0.161%〜+0.289%であり、これは価格依存の測定であってcarry収益の検定ではない。`return_sign`は時点固定の近似で過去の政策金利vintageを表さないため、主検定は政策金利first-seenの共通利用可能期間が育った後に、同じpair集合・horizon・block length・seedを固定して再測定する
- **公式履歴の探索専用隔離(2026-07-29)**: 公式配布元から後日ダウンロードする政策金利履歴は、前向きfirst-seenログとは別の`policy-rate-official-revised-history.jsonl`へ保存する。各行には`source_url`、`source_vintage_at`、`retrieved_at`、値と観測日を残すが、`evidence_tier: exploratory_revised_history`と`point_in_time_status: not_available`を固定する。`get_exploratory_policy_rate_history`はこのtierを明示して探索用途だけへ返し、`carry_panel_preflight`は`prospective_first_seen`以外のrate recordを拒否する。したがって公式履歴は仮説の方向・データ源比較・必要期間の見積りには使えても、前向き/OOS成績、採用根拠、主検定の金利符号には配線できない。公式ソースごとの取得器・生データの内容ハッシュ・会合時刻表の導入は次段階であり、そこでもこの隔離を解除しない
- **公式取得器と生データ版台帳(2026-07-29)**: 初期取得器はECB公式SDMXのDeposit Facility系列`FM.D.U2.EUR.4F.KR.DFR.LEV`、続いてBoC公式Valet APIの`V39079`(Target for the overnight rate)である。取得器は各ソース固有の列・series keyを検証し、日次のcarry-forwardを変更日だけへ縮約する。本文全体のSHA-256、URL、byte数、取得時刻は別のowner-only raw snapshot台帳へ追記し、日付別観測の**値改訂**とは分離する。これにより末尾の日付追加やCSVメタデータ変更を過去全行の改訂と誤記録しない。`npm run collect:official-policy-rates`は`--confirm-exploratory-import`を必要とし、チャート・first-seen・主研究ジャーナルへ触れない。Fed/BoE等は公式URLと系列定義を個別に固定・実CSV検証してから同じsource registryへ追加し、推測パーサーは置かない
- **raw本文アーカイブ(2026-07-29)**: hashだけでは後日に本文を再検証できないため、公式レスポンス本文を`policy-rate-official-raw/<digest>.raw`へcontent-addressed保存する。`O_EXCL|O_NOFOLLOW`、0600、fsync、親ディレクトリsync、owner/permission/regular-file検査を使い、既存digestは本文を再ハッシュして一致した場合だけ再利用する。digest不一致、symlink、短い書込み、過大な本文は失敗させ、snapshot台帳・観測行へ進まない。実機でEUR CSV 2,991,070 byteとCAD JSON 530,455 byteを保存し、既存の観測はそれぞれ63/33件ともunchangedであることを確認した
- **変化点とcoverageの分離(2026-07-29)**: 観測行は右連続as-of結合に必要な変更日だけへ縮約する一方、raw snapshotには`source_observation_count`、`source_first_observation_date`、`source_last_observation_date`を保存する。これで「値が据え置き」と「配信が欠けた」が同じ1本の変化点列へ潰れる問題を、元ソースの期間・密度として検出できる。旧snapshotは`unknown_legacy_snapshot`として安全に読取り、新しい同hash取得でcoverage付きsnapshotを追記する。実機coverageはECBが10,071行・1999-01-01〜2026-07-28、BoCが4,491行・2009-04-21〜2026-07-27である
- **ECBの応答vintage改訂誤認を修正(2026-07-29)**: ECBは同じ観測値でもレスポンス単位の`Last-Modified`が変わり得る。これを観測行の改訂条件に含めると、全63変更点が毎回`revisions`として追記される。`source_vintage_at`・raw hash・取得時刻はraw snapshotで保存し、観測改訂は値・政策状態・系列URLの差だけで判定する。既存の追記証跡は削除せず、coverageでは真の`revisions`と`metadata_only_versions`を分離する。修正後の実機再取得は63件すべて`unchanged`、改訂0件だった
- **USD政策目標取得器(2026-07-29)**: USDはFRED配布の旧単一目標`DFEDTAR`を2008-12-15まで、翌2008-12-16以降は`DFEDTARL`/`DFEDTARU`を必ず同一日付で対にした`(lower + upper) / 2`を、日付で排他的に接続する。`DFEDTAR`とレンジの同日併存、片側だけのレンジ、順序逆転、日付重複/逆行は失敗させる。既存のレンジ観測は従来のrange URLを保持し、旧期間だけを追記するため、接続によって既存観測を改訂扱いにしない。`DFF`(実効federal funds rate)は市場実現値であり政策目標とは違うため混在させない。これにより探索用のUSD系列は1982-09-27まで延長されるが、探索専用隔離・前向き/OOS不使用の契約は変わらない
- **JPY公式系列の制約(2026-07-29)**: BoJの公開時系列で直ちに取得できる無担保コールO/N物は実勢金利であり、政策誘導目標そのものではない。加えて2001-03〜2006-03は当座預金残高を操作目標とし、その後も量的・マイナス金利・レンジ目標を経たため、単一の数値系列へ推測で丸めない。公式の会合決定文書から誘導目標と有効日を構造化できる取得器を別途設計するまで、JPYの公式探索履歴は未導入とし、実勢コールレートを代用しない
- **JPY会合決定取得器(2026-07-29)**: BoJの実勢コールレートは使わず、レビュー済みの会合決定文書URL・決定日・政策状態を固定マニフェストとして取得する。PDFを含む原文は文字列化せずバイト列のままSHA-256・owner-only raw archiveへ保存する。全決定文書が取得・妥当性確認できてから派生履歴を書き、1件でも取得不能・Not Found・不正形式なら履歴を書かない。2006-03からの数値操作目標、2013-04の量的・質的緩和による**単一短期金利なし**、2016-01の-0.1%、2024年以降のO/N誘導目標を明示する。`value: null`の遮断レコードは古い0.05%等を右連続でcarryへ使う誤りを防ぐ。これはなお探索専用であり、前向き/OOSには接続しない
- **AUD Cash Rate Target取得器(2026-07-29)**: RBA公式F1の日次CSVで`FIRMMCRTD`が明示する`Cash Rate Target on date`だけを採用する。実勢の`FIRMMCRID`ではなく、日次値を変更日へ縮約する。F1のメタデータ行・series ID・日付順序を検証し、日次総行数と最初/最後の日付はraw snapshotへ保存する
- **AUD歴史F1接続(実装, 2026-07-29)**: 現行CSVは2011-01-04からだが、RBA公式の`f01dhist.xls`は1976年〜2010-12-31のF1で`FIRMMCRTD`を含む。RBA自身の注記に沿い、明示的Cash Rate Targetの実観測は`1990-08-02`からであることを実ファイルで確認した。既知の脆弱な汎用パーサーは追加せず、OLE/BIFF8のうち固定した`Data`シート・共有文字列の`FIRMMCRTD`列・NUMBER/RK/MULRKセルだけを読む限定読取器を追加した。`1990-08-02`開始、`2010-12-31`終了、日次5,000件以上、正確に1つのtarget列を必須とする。現行CSVとの境界は`2010-12-31 → 2011-01-04`に固定し、どちらかが変われば保存前に停止する。接続後も公式改訂済み探索データのままで、first-seen/OOSへ昇格させない
- **CHF公式系列取得器(2026-07-29)**: SNB公式`snboffzisa`キューブの`LZ`(2019-06以降のSNB policy rate)を採用し、それ以前は同じ公式表の`UG0`/`OG0`(3か月CHF Libor target range)の固定中央値を用いる。月次表なので観測日は月末へ保守的に置き、月内の決定日を推測しない。cube ID、列、3系列、レンジ両端、月順序を検証し、policy rateと旧レンジが同時にあるなら前者を優先する

### #48 order flow / 板情報は研究基盤の対象外(方針明文化)

- **判断**: 対象外を維持する。[限月板データによるクロス通貨予測](https://www.sciencedirect.com/science/article/pii/S0169207025001281)や order flow imbalance の研究は活発だが、予測可能性は**数分で減衰**し、取引コスト・約定レイテンシ・モデル不安定性に極めて脆いと報告されている。全体としては低い予測可能性で効率的市場仮説を支持する結果
- **理由**: TradingView経由では板情報もティックも約定品質も取得できない。取得できないものを研究対象として掲げると、検証不能な仮説が積み上がる。**範囲外であることを明文化するのが誠実**
- **再検討の条件**: 板・ティック・約定記録のいずれかに正規のデータ源が確保できた場合に限り再評価する。それまでは新規の探索を立てない

### #61 Volume Profile を活動密度コンテキストとして検証する(優先度: 高, 2026-08-02)

- **問いを分ける**: Volume Profile (VP) は、価格帯ごとの出来高から POC / VAH / VAL を作る価格水準コンテキストとしては検証価値がある。一方、これを「大口注文」「機関投資家の注文」「Bid/Ask の執行方向」の直接証拠とは呼ばない。TradingView の VP は下位足データから算出され、FX/CFD では取引所横断の約定量ではなく tick volume (価格更新回数) を用いるためである
- **最初の対象**: CME 通貨先物のセッション VP を基準にする。スポット FX へ結合する場合は `source_symbol`、取引所/配信元、volume 種別、profile session、timezone、value-area 比率、row 設定、下位足解像度を結果・definition hash に含め、銘柄横断の同一量とみなさない。スポット FX 単体の VP は provider-specific tick-volume context と明示する
- **MCP 機能 #61a**: `get_volume_profile_context` を追加する。前完結セッションの POC / VAH / VAL、profile の開始・終了、value-area 比率、volume source/type、計算版、利用可能性・品質問題を構造化して返す。未確定の developing POC / VA は研究シグナルに使わず、閉じた profile のみを返す。Native VP の数値を安定して読めない場合は、定義を固定した公開 Pine を保存して plot 契約を検証する
- **#61a 実装と実機コンパイル差戻し(2026-08-02)**: 最初の`Bushido Volume Profile Context v1.0`は`volume.profile_session`を使ったが、実機Pine compilerが当該namespaceを認識せず8行目でcompile errorとなった。保存済みの失敗版は採用しない。v2.0は、完結したexchange trading dayの各**chart bar**の出来高をその高安にまたがるrowへ均等配分する、定義が全文で監査可能な `chart_bar_volume_range_allocation_profile_proxy` へ変更した。したがってnative lower-timeframe VPとも注文フローとも同一視せず、#61bの採否根拠へ接続しない。prior POC / VAH / VAL、開始/終了/取引日、bar数、profile completeを明示plotし、容量超過・ゼロ幅・未完結profileは値を推測せず`unavailable`とする。`get_volume_profile_context_template` / `get_volume_profile_context` はsource全文、Pine ID、latest version、on-chart instance、symbol/timeframe、4入力契約を全て照合してから読む。`Volume Type`は利用者が `unknown` / `provider_tick_volume` / `exchange_reported_volume` を宣言し、unknownおよびtick volumeは品質問題として残す。v2の保存・コンパイル・チャート配置は追加承認後の実機確認待ち
- **#61a 実機確認完了(2026-08-02)**: 二重定義を除去した同一logical v2テンプレートをTradingView Pine version 3.0として保存し、compile warning/errorなしを確認した。`CME_DL:6E1!` 4時間足へstudy `6rw5Kh`を追加し、`Volume Type=exchange_reported_volume`のsettled/readbackを確認。直前完結profileは2026-07-29T22:00Z〜2026-07-30T22:00Z、6 chart bars、24 rows、VA 70%、POC 1.1546822917、VAH 1.15575、VAL 1.1501979167だった。MCPの厳格parserは`status: ready`、`qualityIssues: []`を返した。これは実機配線と不変条件の証拠であり、native lower-timeframe VPの再現性や価格反応の優位性を示さない
- **再接続後の配線バグ修正(2026-08-02)**: v2で`Profile Complete`と`Bars Included`をparserの必須契約へ追加した一方、server handlerの`plotTitles`が旧6本のままで、MCP経由だけ`no_completed_session_profile`になる不一致を実機で検出した。取得対象を単一の`VOLUME_PROFILE_CONTEXT_PLOTS`定数から導出し、統合テストで全plot指定を固定した。修正buildを新規stdio接続して再実行し、上記と同じprofileで`status: ready`、品質問題0を確認した
- **研究 #61b**: 事前登録する候補は、前セッションの POC / VAH / VAL への到達後に、(a) value area 内へ終値で再進入する rejection、(b) 境界の外で閉じて次の足でも維持する acceptance、(c) POC への回帰、のように価格だけで判定可能な分岐に限る。session、通貨、時間足、horizon、最小イベント数、コスト控除後の最小効果、同一レジームの無条件ベースラインを先に固定する
- **#61b 記述的反応研究の固定実装(2026-08-02)**: `run_volume_profile_reaction_study`を追加し、最初の対象を`CME_DL:6E1!`の4時間足、24 rows、VA 70%、exchange-reported volume宣言へ固定した。分岐は、前足終値がvalue area内にある状態からVAH/VALへ到達して終値で内側へ戻るrejection short/longと、VAH/VAL外で2本連続終値を維持するacceptance long/shortの4つ。水準が利用可能になる`Profile End`以降だけを使い、同じprofile・同じ分岐は最初の1件だけ、horizonは1/2/4/8本、targetは20bps、最低件数は各分岐30件、95%区間、非重複foldを固定した。OHLCと8 plotへ同じ要求件数を同時指定し、時刻一致する証拠だけを使い、Pine source/version/on-chart instance/input/symbol/timeframeを照合する。現段階ではPOC回帰、コスト控除、falsification audit、経験的ヌル、選択後OOSが未実装なので、`candidate_eligible`を常にfalseとし、記述統計を採用根拠へ昇格させない
- **#61b 実機記述結果(2026-08-02)**: TradingViewが返した`CME_DL:6E1!` 4時間足300本(2026-05-22〜07-31)とprofile plotを、期間前半/後半の2foldへ固定して評価した。実装と契約の照合時に、片側境界だけを見てvalue areaを反対側へ通過した足までrejectionに含める不一致を検出し、前足終値とsignal終値の両方へ`VAL <= close <= VAH`を要求して再測定した。修正後52イベントは各fold 26件。VAH rejection short 13件、VAL rejection long 21件、VAH acceptance long 6件、VAL acceptance short 12件で、全分岐が最低30件未達となり`partial`。4本後の平均方向調整return [95% CI] は順に +5.66bps [-7.68,+19.01]、-4.96bps [-17.48,+7.55]、+2.39bps [-21.07,+25.85]、-23.78bps [-41.46,-6.09]。最後の負値は固定したacceptance short方向と逆だが10観測しかなく、これを見て方向を反転・分岐を再定義しない。現契約は支持されず、proxy由来の短期記述結果に留める。長期履歴、同一regime対照、反証監査を事前登録どおり追加するまで候補判定は無効のまま
- **#61b 実機E2E(2026-08-02)**: `test/e2e/volume-profile-reaction-study.test.mjs`を追加し、再接続後のstdio MCPから実TradingViewへ接続して通過した。新ツールの露出、`CME_DL:6E1!`/240分/Pine ID/study IDの束縛、profile proxyの固定契約、4分岐、1/2/4/8本・20bps、候補判定無効、2fold ID、生OHLC非返却、実行前後のチャート状態不変を公開インターフェースだけで検証する。履歴ロード量で変わるイベント件数は合否へ固定せず診断へ出し、今回の実行では52件(13/21/6/12)を再現した
- **#61b 同一レジーム無条件対照(実装・実機, 2026-08-02)**: 同じOHLCから事前確定した20本効率比、ATR14、50本volatility baselineでdirectional×volatilityのcombined regimeを作り、signal足開始までに名目close済みの最新labelだけを使う。各分岐について全VP event signal足を除外した通常バーから同じcombined regimeの対照を取り、対照平均はイベントoutcomeのregime構成で重み付けする。差分は2,000回のregime層化bootstrap 95%区間を返すが、serial dependence・選択・多重性は未補正で候補判定には使わない。実機300本では52event中38件(73.1%)を結合し、初期warmup 12件・stale 2件を除外。4本後のイベント−対照差 [95% bootstrap CI] はVAH rejection short -5.92bps [-15.50,+4.63]、VAL rejection long -3.89bps [-17.21,+8.17]、VAH acceptance long +3.20bps [-2.07,+8.54]、VAL acceptance short -28.05bps [-37.61,-15.23]。最後は固定方向と逆だがevent outcome 9件で最低30件未達。全4分岐が`not_evaluable`、採用根拠なし。履歴を増やしてwarmup coverageとevent数を満たすまでは方向反転や条件変更をしない
- **#61b 60分長期証拠上限(実装, 2026-08-02)**: 60分専用の独立契約`chart_bar_volume_profile_reaction_event_study_1h_v1`だけは、明示ロード済みのOHLCと同一profile plotを最大15,000本まで同時取得できるようにする。4時間足v1の5,000本上限は維持し、両時間足の結果を同じ方法論・同じ標本として混在させない。15,000本を超える要求は入力段階で拒否し、4時間足へ15,000本を指定した場合もhandlerでfail-closedとする
- **#61b POC回帰の独立事前登録(実装, 2026-08-02)**: `run_volume_profile_poc_reversion_study`を追加する。対象は`CME_DL:6E1!`の60分足、24 rows、VA 70%、exchange-reported volume、最大15,000本。完結済みprior profileのPOCから20bps以上離れ、VAH上またはVAL下で閉じた最初の足だけをprofile・方向ごとに採用し、前者はPOCへshort、後者はPOCへlongとする。POCへ後続足が接触した率はイベント固有の記述値であり、優位性は全POC signal足を除いた同一prior directional×volatility regime通常足とのreturn差だけで測る。既存VAH/VAL reactionの4分岐とはmethodology ID・baseline ID・event populationを共有せず、POC接触を約定や注文フローの証拠と扱わない。経験的ヌル、コスト、選択後OOSが未実装のため候補判定は常に無効
- **#61b POC回帰の長期実測(2026-08-02)**: 60分足15,000本(2024-01-19〜2026-07-31)で603 event、同一regime結合568件(94.2%)、両分岐とも評価可能となった。POC到達率は上側short/下側longで、1/2/4/8時間後に各1.7/3.7/7.8/22.5%、2.0/5.8/11.5/23.5%だった。イベント−同一regime対照差は上側shortの全horizonでゼロを跨ぎ、下側longは2時間だけ+1.90bps [+0.26,+3.52]だが、1/4/8時間はゼロを跨ぐ。4時間後のfold平均は上側short -1.02/-3.87/+2.41bps、下側long -3.85/+6.00/+0.47bpsで不安定。固定契約を支持せず、選択的な2時間差分を候補化・反証監査へ進めない
- **検証規律**: 既存の event-study contract、fold、重複イベント除外、falsification audit、経験的ヌル候補ゲート、選択後 OOS を適用する。VP 水準を見てから session・閾値・horizon を選び直さない。採用は真の OFI の証明ではなく、固定した VP 文脈下の価格反応が再現することだけを根拠にする
- **Volume Delta / CVD は #61c の探索限定**: TradingView の Volume Delta は下位足の価格方向で volume を正負へ分類する推定値であり、成行買い/売りの約定データではない。CVD を使う場合も `intrabar_timeframe`、coverage、volume 種別、indicator version、閉じたバーのみを記録し、結果を "directional-volume proxy" と表記する。主研究の order-flow 根拠や大口動向の結論には使わない
- **コミュニティ指標の境界**: LuxAlgo 等の invite-only / 版固定不能な指標は研究へ接続しない。公開 Pine であってもソース、保存 hash、入力、plot の意味を監査できるものだけを検証対象にする。「liquidity pool」「institutional order block」は高安値・FVG 等から作られた価格行動仮説であり、注文や機関を観測した証拠ではない。既存 FVG / failed breakout の定義を同じ名前で重複実装しない
- **真の OFI との境界**: 板の全更新と aggressor-side 約定を持つ CME MBO / EBS 等の正規データ源、時刻同期、コスト・レイテンシを導入できた場合だけ #48 の再検討条件を満たす。その段階で VP/CVD の結果を流用せず、別データ契約・別の短期 horizon・別の反証監査として設計する

### #62 OANDA顧客注文・建玉偏りを探索用コンテキストとして収集する(優先度: 低, 保留, 2026-08-02)

- **意味論の固定**: OANDA Forex Labs の `orderbook_data` と `historical_position_ratios` は、OANDA顧客に限定されたpending order・open positionの**比率**である。市場全体の流動性、出来高、aggressor-side約定、真のorder-flow imbalance、大口投資家の行動を観測した証拠とは呼ばない。結果のevidence tierは `broker_retail_sentiment_history` とし、探索・文脈利用に限る
- **対象と履歴の限界**: 先行対象は `EUR_USD` と `USD_JPY`。公式仕様が許す最大過去1年は探索用に隔離し、長期検証用の母集団は今後の定期snapshot収集でのみ構築する。APIの短期取得では20分間隔snapshotを要求できるが、取得可能期間に応じて粒度が粗くなるため、返却されたtimestamp・件数・gapを信頼せず記録・検証する
- **最初に保存する証跡**: request URLからtokenを除いたsource識別子、instrument、requested period、HTTP response hash、取得時刻、provider timestamp、raw bytes、parser version、snapshot hashを追記専用で保存する。tokenはローカル環境変数だけから読み、ログ・成果物・MCP応答・definition hashへ含めない。リダイレクト先host、response size、content type、timestamp単調性、重複snapshot、価格帯の有限値をfail-closedで検証する
- **point-in-time契約(到達目標であり、現状ではない)**: 各snapshotは `provider_timestamp` と `first_seen_at` を分離し、価格研究では `first_seen_at <= signal_at` を満たす最後のsnapshotだけをas-of結合する。後からAPIが返す過去1年分を、当時利用可能だった情報としてバックテストへ混入させない。過去1年の一括取得は探索専用であり、前向き/OOS/採用根拠へ昇格させない
- **現状との差(2026-08-02)**: 上の `first_seen_at` は**まだ存在しない**。実装が持つのは `collectedAt` で、これは**その実行が取得した時刻**であり、追記専用台帳の初回観測記録ではない。両endpointは履歴を返すため、**同一provider snapshotを再取得すると毎回あとの時刻が刻まれる**(同一バイト列で2回収集し、生データはハッシュ一致で重複排除されながら `collectedAt` だけが動くことを実測で確認済み)。したがって `first_seen_at <= signal_at` のas-of結合は**現時点では実行できない**。当初この場は `firstSeenAt` という名だったが、`firstSeenStore` が保証する追記専用・単調性を提供しないまま名前だけがそれを約束していたため改名した。**as-of結合と前向き/OOS利用が可能になるのは段階(c)で first-seen 台帳を実装した後**であり、それまでこの系列は探索専用である
- **特徴量候補を先に限定**: (1) 現在値近傍のpending buy/sell imbalance、(2) long/short position imbalance、(3) 現在値の上側buy stop・下側sell stop集中、(4) 同一定義snapshot間の偏り変化だけを候補とする。価格帯を見てから距離・閾値・方向を選ばず、単位はprice-relative bps windowで明記する。個別price pointの生配列は研究応答へ返さない
- **段階**: (a) token設定の有無を返すreadinessとraw snapshot collector、(b) parser・coverage・as-of reader、(c) 一年探索データと前向きfirst-seenデータの厳格分離、(d) 同一regime無条件対照を持つ事前登録event study、(e) falsification/経験的ヌル/OOS。どの段階でも自動売買・注文送信は実装しない
- **段階(a)実装(2026-08-02)**: `collect:oanda-flow`は`EUR_USD`/`USD_JPY`だけを明示許可し、OANDA practice APIのorder-book(直近1時間要求)とposition-ratio(直近1日要求)をtoken非露出で取得する。レスポンスは8MiB上限、manual redirect・同一host照合、有限値/時刻/price point数検証を通してからSHA-256名のowner-only raw archiveへ保存する。`get_oanda_flow_collection_readiness`とCLI `--readiness`はtoken本体ではなく設定有無だけを返す。現環境ではtoken未設定のため`blocked`であり、実API収集・研究値の算出は未実行。時刻欄は `collectedAt` であって first-seen ではなく、`environment: "practice"` を成果物とreadinessへ載せる(練習環境の顧客層が本番と一致する必要はないため)。`limitations` は「collectedAtは取得時刻であり再収集で動く」「first-seen台帳が記録するまで探索専用」を明示する
- **完全性検査の追加(2026-08-02)**: order bookの `os`/`ol`/`ps`/`pl` は価格帯にまたがるシェアなので各系列は約100に合計されるはずだが、値ごとの0〜100検査だけでは**切り詰められた応答が素通り**していた。合計が100から大きく外れる応答を拒否する検査を足した。**帯は意図的に広く(±10)取っている** — この不変量はendpointの意味論から読んだものであり実応答に対して未検証で、狭くすると正当なデータで落ちる危険があるためである。実応答を確認した時点で締めるべき値である。副産物として、既存テストのフィクスチャが `os: 1, ol: 2, ps: 3, pl: 4` という**完全な応答からは出得ない値**だったことが判明し、修正した
- **優先度見直し(2026-08-02)**: 中期のポジショニング根拠はCFTC公式COTを主系列とする。OANDAは単一ブローカーのリテール顧客比率で、最大1年の返却履歴も後知恵混入を避けられないため、COTの代替・検証根拠・採用条件には使わない。#62はCOTで固定した仮説に対する短期文脈の補助比較が必要になった場合だけ再開する

### #63 COT Crowd-Unwind Proxy(前向き研究, 2026-08-02)

- **問い**: CFTC TFFのLeveraged Moneyが対象通貨方向で3年percentile 90以上のnet OI比率へ偏った後に、直前20確定日足の安値を終値で下抜けた局面は、ポジション解消を伴う下方向の継続を示すか。percentile 10以下と20日高値上抜けは対称なshort-unwind仮説とする。対象はまず`OANDA:EURUSD`と`OANDA:USDJPY`の日足のみ
- **非主張**: COTは週次・遅延した先物ポジショニングであり、pending buy/sell order、stop-lossの価格、注文執行、主体の個別行動を含まない。20日高安の抜けはstop集中の観測ではなく、片側集中の解消が起きうる価格構造proxyである。条件名も`crowded_*_unwind_proxy`とし、stop hunt・強制清算・機関注文とは表記しない
- **point-in-time**: `available_at`がlocal first-seenとして観測された最新COTだけをライブ文脈に使う。既存250週は2026年7月に一括first-seenされたため、過去時点の利用可能性を証明せず、歴史バックテスト・候補採用・OOS根拠には使わない。週次の前向き収集から新規signalを記録し、十分なsignal数が貯まるまで評価値を出さない
- **初期実装(2026-08-02)**: COT内部読み出し上限を250週へ拡張し、`get_cot_crowding_unwind_context`を追加した。active chartのexact `EURUSD`/`USDJPY`・`1D`を拘束し、3年percentileと20日support/resistance、終値breakを構造化して返す。candidateは常にfalseで、Bar Replayを拒否する。前向きhorizon、同一regime対照、empirical null、OOSは未実装であり、現段階のcontextを売買判断や成績主張へ昇格させない

### #79 外生情報・週次フローによる新規手法探索(優先度: 高, 2026-08-08)

- **背景**: #77/#78を含む短期Price Action、追加のセッション条件、VP proxyの価格反応は、固定契約・同一regime対照・経験的ヌルの下で候補へ進める根拠を残していない。価格足だけから派生する条件を増やして再開せず、価格形成の外側にある、時刻が固定された情報と低頻度ポジショニングへ探索空間を移す
- **優先1: マクロ・サプライズ後の方向性ドリフト**: 既存のM15 macro event studyでNFP/FOMCは反応**量**の評価を次段階へ進めたが、方向シグナルはまだ存在しない。発表時点で利用可能だった市場予想値、actual、revision、release timestamp、取得時刻・raw hashをfirst-seen契約で保存し、`surprise = actual - consensus`の符号を事前固定して、CPI/NFP/FOMCを混合せず別母集団として検証する。USD直結のEURUSD/USDJPY/GBPUSD、金(XAUUSD)、非USD対照のEURGBP/AUDNZDを同じ発表時刻・同じ手続きで比較し、対照まで同方向へ反応するなら指標固有の根拠と扱わない。M15のアンカーは発表時刻ちょうどに開始する確定バー、horizonは15分/30分/60分/120分/240分を事前固定する。市場予想のpoint-in-time証跡が整うまでは、既存の反応量結果を方向性・売買候補へ昇格させない
- **優先2: COT crowding change × price nonconfirmation**: #63の単発のabsolute percentile breakout contextをそのまま逆張り候補にしない。TFF Leveraged Moneyの対象通貨方向net OI ratioが極値にあること、直近4週の偏り変化が同方向へ加速していること、spotが同方向の20日breakoutを終値で確認できない、または反対方向へ戻ることを、週次で1つの新規仮説として固定する。COTのreport dateではなくlocal first-seenで記録した`available_at`以後だけを使い、週次の前向きsignal台帳、固定horizon、無条件かつ同一regime対照、経験的ヌル、OOSを必要条件にする。COTは公開先物ポジショニングであって注文板・stop-loss・大口個別注文の観測ではないため、名称と解釈は`crowding_unwind_proxy`に留める
- **優先3: 金融政策乖離の転換イベント**: #47の静的carry主検定はfirst-seen収集を継続し、最初の報告可能時点まで待機する。これとは別契約で、政策金利差または短期金利差の**変化**と、政策決定の利用可能時点以後のFX反応を研究する。予想済みの利上げ・利下げを後知恵でシグナル化しないため、開始前に市場予想または短期金利の高頻度変化をsurprise proxyとして保存できるかを調査する。実現できなければ記述研究に留め、carry主検定と混ぜない
- **優先4: XAUUSD price × futures open-interest phase**: CME Daily Bulletinのfirst-seen OIを用い、価格上昇/下落とOI増加/減少の4局面を日足または4時間足で固定して研究する。これはFX短期形状の代替ではなく、金先物の参加増減を表す低頻度proxyである。限月ロール、速報/確報vintage、OI公表時刻、spotと先物のbasis差を出力へ残し、単独の説明的相関を候補化しない
- **明示的に優先しないもの**: 裸のM15/M60ローソク足形状、閾値やセッションの追加探索、未校正のlead-lag、VP/CVDを真のorder flowとみなす手法。#77/#78の再現性監査は研究の再開理由ではなく、既存結論の監査証跡として完結させる
- **着手順**: (1) macro consensus/surpriseの長期・point-in-timeデータ契約とcoverage preflight、(2) NFP/FOMCを別々に方向別・対照付きで事前登録、(3) COT週次変化×非追随の前向きsignal台帳と候補契約、(4) CME OI 4局面のデータ契約。この順序では、各段階で候補が出なくても次の閾値を探索して救済しない
- **macro surprise evidence契約の実装(2026-08-09)**: `macroSurpriseEvidence.ts`はCPI=all-items前年比、NFP=total nonfarm payroll change(千人)、FOMC=FF target range midpointという**各種別1指標**だけを受理する。consensusはrelease instantより厳密に前、actualはreleaseから15分以内に、ストア自身が刻むlocal `first_seen_at`で観測されなければならない。呼出側が過去の`observed_at`を渡せないため、後から得たconsensus履歴を前向き証拠へ偽装できない。値はsource ID/HTTPS URL/raw SHA-256と不可分で、raw bytesをowner-only archiveへ保存できた場合だけ正規化値を追記する。実績−予想は同一固定単位でだけ計算する。**予想ベンダー取得器・定期収集・coverage preflightは未実装**であり、保存済みの歴史的イベントや手入力値をこのストアへbackfillしない。次段階は利用規約を満たす予想sourceを選定し、発表前snapshotと公式release document parserをこの契約へ接続すること
- **Trading Economics consensus snapshot取得器(実装, 2026-08-09)**: `collect:macro-consensus`はTrading Economics calendarの`Forecast`だけを、公式artifactに保存された将来release時刻と、設定で固定した`CalendarId`・単位の三重一致で収集する。応答に`Actual`が既にある行、時刻不一致・重複・単位不一致は保存しない。keyは`TRADINGVIEW_MCP_TRADING_ECONOMICS_API_KEY`だけから読み、mapping JSONはkeyを持たず、成果物へはqueryを除いたcanonical source URLだけを保存する。**calendar IDは推測しない**ため、利用開始前にライセンス済みAPIでCPI/NFP/FOMC各ID・UTC時刻・単位を一度実測し、private mapping JSONへ固定する必要がある。現時点でactualの公式document parser、定期起動、coverage preflightは未実装であり、方向別studyはまだ開始しない
- **公式actual取得器(実装, 2026-08-09)**: `collect:macro-actual`は、3つの公式event artifact内で発表時刻から15分以内のeventだけを対象に、BLS/Fedのsource documentをmanual redirect・host照合・8MiB上限付きで取得する。CPIはall-items前年比、NFPはtotal nonfarm payroll changeを**千人へ換算**、FOMCは明示target rangeのmidpointだけを抽出する。本文が曖昧・単位不明・range逆転なら推測せず失敗する。成功時もsource document rawのowner-only archive保存後にだけactualを追記する。過去のofficial documentを後から取り込む経路はなく、定期起動とcoverage preflightまでは前向き方向studyを開始しない
- **actual source・ロック回復の境界強化(2026-08-09)**: actualはevent種別ごとに固定したsource IDとBLS/Fedの**完全な公式document URL**だけを受理し、artifactが別host/pathを指す場合は外部fetch前に拒否する。first-seen storeのlockは、所有者専用のregular fileであり、inode/mtime照合後も60秒超のものだけを回収する。クラッシュ後にactual capture windowが恒久停止することを避けつつ、別プロセスのlockを削除しない。任意source、偽artifact、stale lockをそれぞれ回帰テストで固定した
- **forward coverage・定期収集例(実装, 2026-08-09)**: `coverage:macro-surprise`は3種のofficial artifactとfirst-seen記録を照合し、収集開始前のreleaseを欠損と混同せず、開始後のconsensus/actual取り逃しだけをblockerとして数える。artifactが更新されずpastになった`scheduled_future_releases`も同じ母集団へ残すため、更新遅延がcapture欠損を隠さない。actualは15分windowのため5分間隔、consensusとcoverageは日次のlaunchd例を分離して示す。calendar mapping/API key/年次artifact集合を実測・設定するまでは、方向性studyを開始しない
- **凍結: Trading Economics consensus前提のforward macro surprise (2026-08-09)**: 利用可能時点を証明できるconsensus snapshotには有償APIが必要であり、現時点では費用を負担しない。`TRADINGVIEW_MCP_TRADING_ECONOMICS_API_KEY`、private mapping、macro consensus/actual/coverageのlaunchdジョブは設定しない。したがって本系統は`not_collecting_no_forward_evidence`のまま、方向性study・候補化・OOS根拠へ進めない。公式release artifact、first-seen契約、parser、coverage実装は保全する。将来コスト・ライセンス条件が変わる場合だけ、CalendarId・UTC時刻・単位を実測してから**新しい収集開始日以後だけ**再開する

### #81 4本足トラップの再現検証(結論: 再現せず, 2026-08-09)

`src/priceActionTrapReproduction.ts` に凍結契約として実装。M15・8銘柄(EURUSD, USDJPY, GBPUSD,
EURGBP, AUDNZD, XAUUSD, EURJPY, GBPJPY)、内包足→片側フェイクブレイク→即時包み足の4本構造。

**結果: 11,105イベント、観測 -0.161bps、経験的ヌル中央値 -0.004bps、p = 0.9068。再現しない。**
主horizon t+4 での符号付き平均がヌルのほぼ中央に乗っており、方向性の優位は検出されなかった。

限界として成果物に記録済み:

- iid正規区間は記述のみ。前向き窓は重複しており区間は実際より狭い
- プラセボセルは時刻スロットと曜日で一致させるが**銘柄では一致させない**。XAUUSD は最も静かな
  クロスの約2.4倍動く(8.91 対 3.67 bps)。ただし実測ではイベント構成比とバー構成比が全銘柄で
  1ポイント以内に一致しており、このパネルでは効いていない
- プールは pin/engulfing/sweep を全て除外するため、比較対象は「無形の足」であって「トラップを
  完成させない包み足」ではない。トラップの4本目は構造上つねに包み足なので、この帰無仮説は
  構造と包み足を分離できない(両者まとめて保守的に扱うのみ)

### #82 クロスアセット同時ショック分類器(構想: 事前登録前, 2026-08-09)

- **目的**: 単一FXペアのローソク足形状からの予測を再開せず、急変後にドル・金利・金がどこまで同時に再価格付けしているかを分類する。これは発火前の方向予測ではなく、観測済みショックの`continuation`/`failed_impulse`/`cross_asset_conflict`の識別器として始める
- **最小母集団**: EURUSD・USDJPY、DXY、米2年または10年金利、XAUUSD。M5またはM15で、各系列の確定バー・timestamp連続性・point-in-time sourceを固定する。急変の判定は同時刻・同曜日の分布に対する異常リターンで定義し、単純ATR閾値の後付け探索をしない
- **測定順**: (1) price/yield/DXY/XAUの同方向・逆方向・単独の状態ラベルを、値動きを見ずに固定、(2) 15/30/60/120分の持続率・MFE/MAEを状態別に記述、(3) 同一時刻・同一regimeの無条件対照、曜日・セッション一致プラセボ、経験的ヌル、未使用期間を通す。どれかが不足ならcandidate化しない
- **利用可能なflow proxyの境界**: Exocharts/Bookmapの表示は、接続した取引所・データフィードのDOM/MBO/約定情報としては有用になり得る。ただしFX spotはOTC分散市場であり、いずれも市場全体のspot order flow、pending stop、機関投資家の注文を観測しない。採用する場合はCME通貨先物(例: 6E/6J)またはCOMEX金先物の**単一集中市場proxy**として、spotとのbasis・時差・feed名・depth種別(MBO/価格帯depth)を証跡に残す。暗号資産中心のExochartsをFX spot proxyへ転用しない
- **着手条件**: 現在のTradingView基盤で確定バーを十分量・同時に取得できるかをpreflightする。Bookmap/Exochartsの有償feed・API/履歴exportの利用規約、timestamp精度、利用可能なdepth履歴を確認できない限り、画面の目視を研究証拠やMCP入力にしない
- **実機preflight (2026-08-09)**: EURUSD M15とDXY・US10Y・XAUUSDを、各1,000本の追加履歴ロード後に検査。各系列1,200本、厳密一致の確定バーは1,056本で最低500本を満たした。DXY 65本・US10Y 124本・XAUUSD 48本のFX時刻に未一致があり、共通列には12の非連続区間がある。これは補完しない。後続の状態別評価は、各イベントの必要ホライズンが同一の連続区間に収まる場合だけ測定する
- **状態分類契約 v1 (2026-08-09, 実データ適用前に凍結)**: 各確定M5/M15バーのリターンを、同じUTC曜日・同じ時刻スロットにおける直近12週の確定リターンRMSで割る。対象FXの絶対scoreが2.5以上のときだけ状態を付与する。EURUSDはDXY/US10Yを逆、XAUUSDを同方向、USDJPYはDXY/US10Yを同、XAUUSDを逆のproxyとして扱う。文脈側も絶対score 2.5以上で、矛盾が1つでもあれば`cross_asset_conflict`、矛盾なしで確認が2つ以上なら`cross_asset_confirmed`、1つなら`partial_confirmation`、0なら`target_only`。これは観測済みの状態であり、継続・反転など将来結果をラベルへ混入させない。欠損区間をまたぐリターン、基準不足、ゼロRMSは評価不能のままとする
- **実装 (2026-08-09)**: `classify_cross_asset_shocks` はpreflightと同じ厳密時刻結合・補助チャート復元を共用し、分類済み状態だけを返す。M15/M5の12週基準に必要な履歴は、TradingViewの1回5,000本制約に合わせて明示指定分を分割ロードする。実データで状態件数を見た後に初めて、別の凍結契約として15/30/60/120分の結果を測る
- **実機状態測定 (2026-08-09, EURUSD M15)**: 単一実行で各系列へ12,000本のロードを要求し、共通確定バー9,125本(2026-03-01〜08-07)、連続リターン8,976本を得た。12週基準不足5,000本を除いた後、状態は`cross_asset_confirmed` 35、`partial_confirmation` 61、`target_only` 18、`cross_asset_conflict` 3、非shock 3,859。これは頻度のみで優位性を意味しない。補助チャートの履歴は銘柄切替をまたいで蓄積しない実機挙動を確認したため、必要履歴は必ず同一の収集実行内で全量ロードする
- **結果契約 v1 (2026-08-09, 実データ適用前に凍結)**: 状態バー終値を参照価格とし、発生時のFXショック方向へ1/2/4/8本(15/30/60/120分)先の方向性リターン、MFE、MAEを測る。未来側も厳密一致した共通列の連続バーに限る。最大8本の評価窓内で後発した状態は除外する。状態ごとの最小イベント数は20。区間は記述的で、イベント依存・複数比較を調整しないためcandidate化や採用判断に使わない
- **実機結果測定 (2026-08-09, EURUSD M15)**: 117状態のうち、8本窓の後発36件を除外して81イベントを評価した。最小20件を満たすのは`cross_asset_confirmed` 22件と`partial_confirmation` 41件のみ。完全確認の方向別平均リターンは15/30/60/120分で-1.81/-2.91/+0.06/+3.49 bps、部分確認は+0.08/+0.10/-0.50/-0.39 bpsで、全ての95%記述区間がゼロを含む。`target_only` 16件、`cross_asset_conflict` 2件は最小件数未達であり、数値比較や候補化をしない。したがってv1は持続優位を示さず、次段階の同時刻・同一regime対照、曜日・セッション一致プラセボ、経験的ヌルには進まない

### #83 Bookmap flow-to-price 結合 preflight (契約 v1, 2026-08-10)

- **目的と境界**: Bookmap Collector の CME 通貨先物イベントを、EURUSD の spot 市場全体の order flow と呼ばず、`6E` の単一集中市場 proxy としてのみ扱う。最初の実装は候補・売買判断・将来リターンを一切出さず、価格との結合に必要な証跡・時計・coverage だけを確認する
- **時計**: Bookmap の `bookmap_time_ns` は `TimeListener` の直近値であり、イベント個別の exchange timestamp ではない。さらに旧 Collector v1.0 の JSON number は JavaScript で精度を検証できない。したがって結合時計は Collector が実際に受け取った canonical ISO `received_at` とする。v1.1 は 64bit Bookmap timestamp を decimal string として保存するが、結合には使わない
- **結合規則**: M1 は60秒、M5は300秒の UTC receipt interval `[T,T+Δ)` に depth/BBO/trade 更新数を集約する。特徴量は interval end で初めて利用可能とし、その end 時刻と**厳密一致**する確定EURUSDバーにのみ対応付ける。前方補完・近傍時刻への丸めはしない。将来の outcome 評価を行う場合も、この observation から最低1本遅らせる
- **初期特徴量**: depth更新数、BBO更新数、trade数だけを品質確認対象とする。aggressor が全件既知の場合だけ buy/sell size と trade delta を計算し、`unknown` を売買いずれにも補完しない。板残高/imbalance は `snapshot_end` が記録された session に限るが、v1では未実装
- **必要証跡**: Collector schema version、CME symbol/exchange、full-depth/MBO/crypto/OTC/delay metadata、sessionの開始/終了receipt時刻、event counts、snapshot完了を返す。crypto、full depth未確認、snapshot未完了、trade未取得、旧時刻精度、必要interval不足は `partial` とし、研究候補化を拒む

### #84 Bookmap display-only flow research (構想: 事前実装検証, 2026-08-11)

- **契約境界**: BookmapData realtime は市場データ、派生値、外部シグナルをアプリ外へ露出するcustom add-onを現時点で許可しない。JSONL Collectorは遅延BookmapData／Replay専用とする。realtime add-onはBookmapのチャートまたはindicator paneへの描画だけで完結し、ファイル、ネットワーク、MCP、外部通知、clipboardへの出力を一切行わない。BookmapのDeveloper Agreement、`@UnrestrictedData`、一意なJAR名、サーバー側承認を得た**別JAR**としてのみ作る
- **研究の往復**: 遅延／ReplayでCollectorの監査可能な観察から条件・閾値・除外規則を固定し、そのロジックだけをdisplay-only add-onへ移す。realtimeの表示結果は外へ回収せず、次の変更候補は再び遅延／Replayで検証する
- **v1対象: trade-flow pressure / CVD**: known aggressor tradeだけを一定セッションで累積し、unknown aggressorが混じる区間は値を更新せず`unavailable`として描画する。aggressorのbuy/sell極性は、BookmapのReplayでbubble表示と突合してから固定する。これは成行約定方向の集計であり、spot FX全体の売買圧力ではない
- **v1対象: possible absorption**: price levelでknown aggressor tradeが短い**約定数窓**の間に閾値以上積み上がり、同価格近傍のaggregate depthが枯渇しない場合に表示する。depth/BBO callbackはこの窓を進めない。窓切れ、価格帯の消滅、または観測できる板の再補充で新しいepisodeとして再アームする。`absorption`や機関投資家の存在を断定せず、表示名は`possible_passive_absorption`とする。初期snapshot完了前、unknown aggressor、depth欠損では表示しない
- **v1対象: possible liquidity withdrawal**: BBOまたは近傍価格帯のaggregate depthが減少し、その後の短い**約定数窓**で同方向のknown tradeが続くときに表示する。depth/BBO callbackはこの窓を進めない。cancel/replenishは観測するが、意図・不正行為・spoofingを推定しない。表示名は`possible_liquidity_withdrawal`とする
- **v1対象: trade sweep**: 既知方向のtradeが短いcallback窓で連続し、複数price levelを単調に通過した場合に`trade_sweep`を表示する。これは約定の価格通過を表すだけで、stop-loss clusterや大口の意図は主張しない
- **v1対象外: iceberg / stop hunting / spoofing**: price-level aggregate depthだけでは注文ID単位のreplenishmentを識別できず、icebergの断定はしない。MBO listenerが利用可能でも、MBO callbackのReplay検証と別の固定契約なしには対象に加えない。stopの所在とspoofingの意図はデータから直接観測できない
- **実装順**: (1) delayed/Replay専用の純粋なsignal engineを作り、callback順・snapshot・unknown trade・session resetをunit testで固定、(2) Bookmap内indicator描画を付け、Replayで表示の意味を人手照合、(3) Bookmapのrealtime approvalを得た後だけ、同一ロジックを外部I/Oなしの一意JARへパッケージする。価格結果との統計評価はCollector側の遅延／Replay研究でのみ行う
- **チャートマーカー契約 v1 (2026-08-13、同日訂正)**: delayed/Replay研究JARで`FlowSignalEngine`が返したものと同じ単一シグナルを、Bookmap PRIMARY indicatorの時刻・価格座標へ表示する。初版は全種別の`direction`を価格含意と誤読して`FLOW BUY/SELL`へ写したため撤回した。訂正版は、sweepだけを観測された攻撃側として緑の`BUY SWEEP`／赤の`SELL SWEEP`とする。absorptionは攻撃側が受け止められた観測なので、中立色の`BUY ABSORBED`／`SELL ABSORBED`と`POSSIBLE ABSORPTION`を表示し、反対方向の予測へ変換しない。withdrawalは中立色の`ASK WITHDRAWAL`／`BID WITHDRAWAL`と`POSSIBLE`を表示する。いずれも売買推奨・注文・約定を意味しない。マーカー価格はBookmapの整数price levelを使い、Replay時計は既存どおり`TimeListener`値を使う。JSONL記録の成否は表示可否へ影響させず、表示の成否も研究証跡を書き換えない
- **表示の安全境界**: 設定はBookmapが許可する`Boolean`の`Show chart markers`とし、既定は有効。無効時はJSONL記録だけを継続する。マーカーは外部通知、clipboard、ネットワーク、MCP、注文APIを呼ばない。リアルタイム承認版へ移すときは同じ純粋engineと表示部だけを別の`@UnrestrictedData` JARへ含め、writer・出力ディレクトリ・Collectorクラスを含めない。Bookmapサーバー承認前にrealtimeへ導入しない
- **検証条件**: SDKなしCIでも、種別ごとの観測意味、表示文言、方向色を使う範囲、中立色、上下オフセットを純粋Java unit testで固定する。SDKありビルドではPRIMARY indicator登録とシグナル発火時の`addIcon`接続を確認し、最後にReplayで同一記録と同一時刻・価格へ1個だけ表示されることを目視確認する。アイコンは価格・時刻座標であり画面固定座標ではないため、ズームやスクロールで位置が変わることを許容する
- **実装 (2026-08-13)**: delayed/Replay研究JARへSDK-freeの`FlowSignalMarker`とPRIMARY indicator接続を追加した。初版v1.1の吸収表示は攻撃側を価格含意へ誤変換したため使用禁止とし、観測事実表示へ直したv1.2へ更新した。種別別の意味・文言・色・上下位置、同一callbackで1個だけの描画、設定OFF時の証跡継続、描画例外時の証跡継続をunit testで固定し、旧v1.0/v1.1 JARはビルド時に削除する。`npm test`とSDKありJava 4スイートは通過。残る作業はBookmap Replayでの実表示位置・可読性・JSONLとの1対1対応の目視確認であり、realtime display-only JARの作成・承認は未着手
- **表示レーン訂正 (2026-08-13)**: 方向中立のabsorptionとwithdrawalをともに上側へ置く方針は維持するが、初版はsell sweepを含む3種が同じ`-46px`で重なり得た。v1.2ではbuy sweepを`+8px`、sell sweepを`-46px`、absorptionを`-88px`、withdrawalを`-130px`の別レーンへ固定した。同種のシグナルがほぼ同時刻・同価格で再発した場合の重なりは残余の表示制約とし、観測を間引いて解消しない
- **実機E2E (2026-08-13)**: delayed BookmapDataのM6Eチャートでv1.2を確認し、中立色の`BID WITHDRAWAL`／`ASK WITHDRAWAL`、`POSSIBLE`副表示、上側withdrawalレーンへの描画が契約どおり動作した。同時に、同種withdrawalが近い時刻・価格で連続すると同一レーン上で重なる残余制約も再現した。研究JSONLは間引かず、将来の表示改善を行う場合は証跡と独立した表示専用cooldown／集約として別契約にする

### #84 重複する前向き窓へiid区間を当てている件(留保として記録, 2026-08-13)

- **内容**: price action 系(#77〜#80)および event study 群が報告する方向調整returnの95%区間は、iid正規近似である。しかしイベント間隔はhorizonより短くなり得るため、**前向き窓は重なる**。重なった観測は独立ではないので、報告している区間は**本来より狭い**
- **結論への影響はない**: これまでの判定はすべて「区間がゼロを跨ぐ→採用しない」である。区間を正しく広げても**跨いだままになる**ため、既存の結論は一つも覆らない。#81(4本足トラップ, p=0.9068)のように経験的ヌルで判定したものは、そもそもiid仮定に依存していない
- **効くのは正の結果が出たときだけである**: 区間がゼロを外れる候補が現れた時点で、この補正なしに採用してはならない。系列依存を扱う手段は既にこのリポジトリにある(`sessionAuctionStudy` の層別ブートストラップ、`featureOutcomeRelationships` の循環移動ブロック・ヌルとNewey-West、`macroEventResponse` のプラセボ抽選)。新規実装ではなく既存手段の適用で足りる
- **いま直さない理由**: 直しても現在の結論は変わらず、変えるのは将来の候補の採否だけである。候補が出るまで留保として置き、出た時点で該当契約に補正を組み込む。#81 は既に `iid_normal_intervals_are_descriptive_only` を成果物の limitations に記録済みである。#83 は coverage と証跡だけを返し**収益率を一つも計算しない**ため、そもそも該当しない

### #85 Bookmap API保護の境界を切り分けた(結論: モジュール自体が境界, 2026-08-14)

- **事象**: 銘柄を Trading モードにした時点で、`FlowCollector` と `FlowSignalResearch` の両方が "Most of the API modules are not allowed for this instrument" で拒否された。Bookmap の javadoc に機序が明記されている — `InstrumentInfo.isApiProtected` は「遅延データ銘柄に制限を適用するため」のフラグで、`UnrestrictedData` は「データ制限を解除する例外」である
- **切り分け**: 既存2モジュールはどちらも JSONL を書くため、「出力するモジュールが止まる」のか「サードパーティのモジュールが一律止まる」のかを区別できなかった。そこで**何も保存しないモジュール**(`FlowSignalDisplay`、ファイル・ソケット・クリップボード・プロセスAPIへの参照が無いことを定数プールで検査)を作り、同じ銘柄に付けた
- **結論**: **同じく拒否された。境界はモジュール自体であり、出力ではない。** アドオン側で何を我慢しても保護対象の銘柄では動かない
- **否定された仮説3つ**: JAR ファイル名の変更(v1_0→v1_2)、Indicator API の使用、外部出力の有無。いずれも原因ではなかった
- **残る道**: `@UnrestrictedData` と Bookmap の承認を得るか、保護対象の銘柄でアドオンを使わないか。前者は Developer Agreement を要し、承認なしに自分で注釈を付けるのは例外の目的から外れる
- **実務上の影響は限定的**: Trading を有効にしていない遅延銘柄では3モジュールとも動く。閾値決定と episode の作業はそのまま継続できる
- **未解決**: ライセンスされたフィードをディスクに記録してよいかは購読条件の問題であり、この切り分けでは答えが出ない

## 運用メモ

- **MCP サーバーはビルド更新後に再接続が必要**: サーバープロセスは起動時の `build/` を使い続けるため、新ツールはセッション再接続まで見えない(実分析時に `get_indicator_graphics` が未露出で直接実行により回避)。README に記載する
- **ストラテジーテスターAPI移行**(2026-07-20訂正): 当初はアプリ再起動直後の`TradingViewApi.backtestingStrategyApi`不在を遅延初期化と判断していたが、Strategy Tester表示後も復活せず、現行版ではactive chart modelのstrategy sourceへ移行したことを実機確認した。旧APIがあれば優先し、現行APIをWatchedValue相当へ適応する互換層を追加。`set_indicator_input`のsettle、`get_strategy_report`、`get_strategy_trade_ledger`、`run_backtest`を両経路へ統一した
