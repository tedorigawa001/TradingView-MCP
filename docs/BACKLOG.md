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

### #22 分析案の事前検証(`validate_trade_plan`)(優先度: P0・規模: 小〜中)

- **課題**: `apply_analysis_overlay`にも入力契約検証はあるが、重要イベント、データ鮮度、現在価格による水準通過、コスト控除後RRなど、反映可否に必要な判断が複数ツールとAI推論へ分散している
- **案**: チャートを書き換えない純粋な検証ツールを追加し、biasとConfirmation/Invalidation/Stop/Targetsの方向整合、Target単調性、分析時刻・期限、Entry通過状態、最低RR、spread/slippage/commission控除後RR、イベント停止時間、証拠鮮度を構造化検証する
- **出力**: `status: "valid" | "warning" | "blocked"`、正規化済み分析案、`qualityIssues`、計算前提、修正候補を返す。データ欠落をゼロや最新値で補完せず、必須証拠の欠落は`blocked`にする
- **受入条件**: bearishでStopがEntry下、非単調Target、期限切れ、重要指標停止時間内、コスト控除後RR不足を個別コードで検出する。検証処理はPine・チャート・ジャーナルへ書き込まない

### #23 トレード判断コンテキスト統合(`get_trade_decision_context`)(優先度: P1・規模: 中)

- **課題**: 1回の分析に`get_market_snapshot`、`get_key_levels`、`get_positioning_context`、`get_real_yield_context`、執行コスト関連を個別呼び出しし、取得時刻と欠落状態をAI側で突合する必要がある
- **案**: 対象チャートの確定足/形成中足、MTF、キーレベル、補助市場、経済イベント、COT、実質金利、執行条件を同一取得ウィンドウで束ねる読み取り専用ツールを追加する。既存`get_market_snapshot`を基盤とし、元レスポンスを失わず各証拠へ`observed_at`、`source`、`freshness`、`status`を付ける
- **判定境界**: MCPは決定論的な品質ゲートと事実の統合までを担当し、方向予測の最終判断はAI側に残す。出力は`trade_ready | wait | blocked`をデータ完全性・イベント・執行条件についてだけ表し、売買推奨そのものを意味しない
- **受入条件**: 一部データ源失敗時に全体を無言で成功扱いせず、必須度に応じて`partial`/`blocked`を返す。`snapshot_id`を分析オーバーレイとジャーナルへ引き継げる

### #24 ライブ執行条件スナップショット(`get_execution_snapshot`)(優先度: P1・規模: 中、データ源要調査)

- **課題**: `compute_round_trip_cost`はbid/askを呼び出し側が渡すため、実際のspread、取得時刻、取引セッション、価格刻みが欠けたままでも計算できる
- **案**: symbolごとにbid、ask、spread、pip/tick size、market/session状態、取得時刻、鮮度を取得し、必要なら`compute_round_trip_cost`へ直接渡せる正規化形式を返す。TradingView上で信頼できるbid/askを取得できない銘柄は推定せず`unsupported`または`unavailable`とする
- **受入条件**: `ask >= bid`、時刻、単位、データ源を検証し、stale値や市場休止時を`trade_ready`にしない。スキャナー値とチャート終値を同一価格として代用しない

### #25 リスク数量計算(`compute_position_size`)(優先度: P1・規模: 小〜中)

- **課題**: 分析水準とRRは出せるが、許容損失から数量へ変換する標準計算がなく、銘柄ごとのpip価値・換算通貨・コストをAIが都度計算する必要がある
- **案**: 呼び出し時だけ与えられる口座通貨、評価額、許容リスク率または金額、Entry、Stop、数量刻み、往復コストから、最大数量、Stop到達時損失、コスト込み損失、実効リスク率を計算する。換算レートが必要な場合は使用したsymbol・時刻を証拠として返す
- **安全性**: 口座番号、ブローカー認証情報、APIキーを受け取らず、入力値を永続化しない。計算結果は注文量の参考値であり、発注には接続しない
- **受入条件**: JPY建て口座のUSDJPY、EURUSD、XAUUSDで単位テストを用意し、換算レート欠落・ゼロStop幅・最小数量未満をfail-closedで扱う

### #26 分析監視アラート(`create_analysis_alerts`)(優先度: P2・規模: 中〜大、TradingView API要調査)

- **課題**: `list_alerts`は読み取り専用で、Confirmation、Invalidation、Target、期限の監視設定が手作業になる。分析後に画面を離れると、PDCAの観測開始が遅れる
- **案**: 所有する分析オーバーレイと`analysisId`を照合し、Confirmation、Invalidation、Target 1、期限の価格アラートをプレビュー後に冪等作成する。`confirm:true`を必須とし、作成したalert IDをジャーナルへ関連付ける
- **安全性**: Webhook、ブローカー、注文、Pineのstrategy entry/exitへ接続しない。既存ユーザーアラートを上書き・削除せず、MCP所有ラベルを持つものだけを管理対象にする
- **受入条件**: dry-run、重複作成防止、銘柄・価格・期限の読み戻し検証、部分失敗時の一覧化を備える。TradingView側APIが安定して識別・検証できない場合は実装を見送る

### #27 ジャーナル分析の一括事後評価(`evaluate_due_analyses`)(優先度: P2・規模: 大)

- **課題**: 現在の事後評価は配置中オーバーレイと対象チャートに依存し、過去・期限到来・ongoing分析を銘柄ごとに手動で再配置または切替する必要がある
- **案**: ジャーナルから評価対象を`analysisId`、symbol、期限、最新状態で抽出し、指定した評価用チャートでsymbol/timeframeを一時変更、必要履歴を取得、評価、復元まで直列実行する。結果は各分析ごとに独立して記録し、一件の失敗で他を失わない
- **安全性**: 実行前後のチャート状態を完全に記録し、復元不能時は以後の処理を停止する。処理対象件数、symbol、時間足、推定チャート変更をdry-runで提示してから`confirm:true`で実行する
- **受入条件**: 複数銘柄、履歴不足、暦月非対応、途中失敗、復元失敗の統合テストを用意し、同じ分析への再実行はジャーナル上で冪等になる

### #28 事後評価指標の拡張(`get_analysis_performance`)(優先度: P2・規模: 中)

- **課題**: 現在の較正はTarget 1先着を1、Stop先着を0とするBrier score中心で、分析中の最大有利変動(MFE)、最大不利変動(MAE)、到達時間、R倍数、コスト控除後成績が分からない
- **案**: 元の分析定義と確定OHLC証拠から、MFE/MAE、Entry/Confirmation/Terminalまでの時間、到達Target、gross/net R、銘柄・bias・時間足・戦略版・イベント近接度別の集計を返す。曖昧足、ギャップ、未発動、履歴不足は推定せず除外理由を保持する
- **受入条件**: 指標ごとに母集団と除外数を返し、価格単位の損益を口座収益率と表示しない。ライブ分析の観測とバックテスト結果を同じ集計へ混在させない

### #29 チャート指定操作の一般化(優先度: P2・規模: 中)

- **課題**: `set_symbol`と`set_timeframe`はアクティブチャート依存で、マルチチャートレイアウトでは意図しないペインを変更する可能性がある。事後評価だけが`chart_index`指定の一時切替・復元を独自実装している
- **案**: 両ツールへ`chart_index`を追加し、対象チャートの事前状態、変更結果、バー有無、復元情報を共通トランザクションヘルパーへ集約する。将来の#23/#27も同じ実装を利用する
- **受入条件**: 非アクティブチャートを指定しても他ペインを変更せず、無効symbol/timeframeでは対象ペインだけを元へ戻す。変更中は既存`SerialOperationQueue`で競合操作を遮断する

### 推奨実装順

1. **#21** 文脈取り違えをfail-closedにする
2. **#22** 分析案の品質ゲートを反映前に独立させる
3. **#23** 分析証拠を同一取得ウィンドウへ統合する
4. **#24・#25** 執行条件とリスク数量を明示する
5. **#29** マルチチャート操作の共通基盤を整える
6. **#26・#27・#28** 監視と事後評価の運用負荷を下げ、較正情報を増やす

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
