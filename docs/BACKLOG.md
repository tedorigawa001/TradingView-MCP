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
- **定期収集CLI・統合coverage(2026-07-26)**: `npm run collect:first-seen` は指定COT銘柄(既定EURUSD/XAUUSD、環境変数または反復`--cot-symbol`で明示)の直近52週と米10年実質金利を収集し、各first-seenログへ追記する。片方の外部取得が失敗しても他系列とcoverageを返し、終了状態を`partial`として監視側へ伝える。`npm run coverage:first-seen` はCOT・実質金利・先物OIを一つのJSONで集計し、日付数、改訂数、最初/最後の観測日を可視化する。OIはTradingViewチャートの明示したインジケーターだけから安全に取得できるため、CLIは蓄積済みOIのcoverage確認に限定する。初回実機ではCOT EURUSD/XAUUSD各250日、実質金利141日、GC合算OI249日で`complete`を確認した。
- **E2Eが収集の欠陥を検出(2026-07-25)**: 記録処理が `futures.observations` を読んでいたが、これは `observation_limit` で切り詰められた表示用配列だった。既定値では**直近20日しか永久に記録されず**、`observation_limit: 0` では**何も記録されないのに成功として報告**されていた。ユニットテストでは検出不能で(モックが返した件数だけ記録されれば通る)、実機E2Eで `observation_limit: 0` を渡して初めて `{recorded:0, unchanged:0, skipped:0}` の矛盾が表面化した。完全な観測列を収集側だけへ渡し応答へ混ぜる前に除去するよう是正。E2Eは収集先を一時ファイルへ切り替えて実運用ログを汚染せず、**建玉を取得できない設定は明示的に失敗**させる(静かにスキップする作りだったことが見逃しの原因だったため)。実機では `observation_limit: 0` でも230件記録、再実行で `unchanged: 230` かつ追記ゼロ、全件で `observation_date <= first_seen_at`・連番連続性・0600 を確認
- **蓄積の限界(明示)**: vintageは**前向きにしか貯まらず、収集開始前の日付は永久に復元できない**。また `get_futures_flow_context` を実行した日しか記録されないため系列に穴が空く。速報→確報の改訂を捉えるには同じ日付を複数回読む必要があり、1日1回の実行では確報しか見えない
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

## 運用メモ

- **MCP サーバーはビルド更新後に再接続が必要**: サーバープロセスは起動時の `build/` を使い続けるため、新ツールはセッション再接続まで見えない(実分析時に `get_indicator_graphics` が未露出で直接実行により回避)。README に記載する
- **ストラテジーテスターAPI移行**(2026-07-20訂正): 当初はアプリ再起動直後の`TradingViewApi.backtestingStrategyApi`不在を遅延初期化と判断していたが、Strategy Tester表示後も復活せず、現行版ではactive chart modelのstrategy sourceへ移行したことを実機確認した。旧APIがあれば優先し、現行APIをWatchedValue相当へ適応する互換層を追加。`set_indicator_input`のsettle、`get_strategy_report`、`get_strategy_trade_ledger`、`run_backtest`を両経路へ統一した
