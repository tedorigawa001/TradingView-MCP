# TradingView-MCP

**TradingView デスクトップアプリを AI に見せて、チャート分析を手伝ってもらうためのツールです。**

AI エージェント(Claude Code / Codex / Antigravity など)にこのサーバーを登録すると、AI が「あなたが今見ているチャート」をそのまま読めるようになります。ログイン済みのアカウント・保存したレイアウト・購入済みのカスタムインジケーターがそのまま使えます。

## できること

AI にこんなお願いができるようになります:

- 「**今のチャートを分析して**」 → チャート画像+ローソク足+インジケーター値を組み合わせて分析
- 「**このインジケーターのシグナルを読んで**」 → SELL/BUY ラベルやサポレジラインの数値を取得
- 「**日足と4時間足の両方で環境認識して**」 → チャートを動かさずに複数時間足の指標を一括取得
- 「**日本株で RSI が30以下の銘柄を探して**」 → スクリーナーで市場を検索
- 「**ウォッチリストの銘柄を全部チェックして**」 → リストの全銘柄のクォートを取得

## 仕組み(ざっくり)

TradingView のデスクトップアプリは中身がブラウザ(Electron)なので、デバッグ用の入り口を開けて起動すると、外部プログラムからチャートの中身を読み取れます。この MCP サーバーがその橋渡しをします。

```
AIエージェント ⇄ tradingview-mcp ⇄ TradingView デスクトップアプリ(あなたのチャート)
                                  ⇄ TradingView 公開API(クォート・スクリーナー)
```

## 必要なもの

- macOS + [TradingView デスクトップアプリ](https://www.tradingview.com/desktop/)(無料プランでOK)
- [Node.js](https://nodejs.org/) 22以上(`node --version` で確認。Node 20はEOL)
- AI エージェントいずれか: [Claude Code](https://claude.com/claude-code) / [Codex](https://developers.openai.com/codex) / [Antigravity](https://antigravity.google/) など

## セットアップ(3ステップ)

### ステップ1: このツールをインストール

ターミナルで:

```bash
git clone https://github.com/tedorigawa001/TradingView-MCP.git
cd TradingView-MCP
npm install
npm run build
```

### ステップ2: TradingView をデバッグモードで起動

**重要**: 普通にアイコンから起動しても AI からは見えません。TradingView が起動中なら一度終了(Cmd+Q)してから、ターミナルで:

```bash
open -a TradingView --args --remote-debugging-port=9222
```

毎回このコマンドで起動するのが面倒な場合は、エイリアスを登録しておくと `tv` だけで起動できます:

```bash
echo 'alias tv="open -a TradingView --args --remote-debugging-port=9222"' >> ~/.zshrc
source ~/.zshrc
```

### ステップ3: AI エージェントに登録

お使いのエージェントに合わせて設定してください。`/path/to/TradingView-MCP` は実際にcloneした場所に置き換えます(このリポジトリ内で `pwd` すると確認できます)。

<details>
<summary><b>Claude Code の場合</b></summary>

ターミナルで1コマンド:

```bash
claude mcp add tradingview -- node /path/to/TradingView-MCP/build/index.js
```

または、このリポジトリのフォルダで Claude Code を開けば、同梱の `.mcp.json` により自動で登録されます。

確認: Claude Code で `/mcp` を実行し、`tradingview` が表示されればOK。

</details>

<details>
<summary><b>Codex(OpenAI)の場合</b></summary>

方法1 — CLI で追加:

```bash
codex mcp add tradingview -- node /path/to/TradingView-MCP/build/index.js
```

方法2 — 設定ファイル `~/.codex/config.toml` に直接追記:

```toml
[mcp_servers.tradingview]
command = "node"
args = ["/path/to/TradingView-MCP/build/index.js"]
```

確認: Codex の画面で `/mcp` を実行し、`tradingview` が表示されればOK。

</details>

<details>
<summary><b>Antigravity(Google)の場合</b></summary>

設定ファイル `~/.gemini/config/mcp_config.json` を作成(または追記):

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "node",
      "args": ["/path/to/TradingView-MCP/build/index.js"]
    }
  }
}
```

IDE から編集する場合は、エージェントパネル右上の「...」→「MCP Servers」→「Manage MCP Servers」→「View raw config」で同じファイルが開きます。保存すると自動で再読み込みされます。

</details>

## 使ってみる

TradingView をデバッグモードで起動した状態で、AI エージェントにこう話しかけてみてください:

> 今のチャートを分析して

AI が自動で `get_chart_context`(何が表示されているか)→ `get_chart_screenshot`(見た目)→ `get_ohlcv`(数値)などのツールを組み合わせて分析します。

## ツール一覧(全67種)

AI が状況に応じて自動で使い分けます。手動で覚える必要はありません。

**チャートを読む**

| ツール | 説明 |
|---|---|
| `get_chart_context` | 表示中の全チャートのシンボル・時間足・インジケーター一覧 |
| `get_chart_screenshot` | チャート画面を画像で取得。`chart_index` 指定で1チャートのみ高解像度切り出し |
| `get_ohlcv` | ローソク足データ(ISO時刻付き。形成中の足には `forming` フラグ) |
| `get_indicator_values` | インジケーターのプロット値(シグナルレベル・バンド等) |
| `get_indicator_inputs` | インジケーターの設定パラメータ(名前・現在値・デフォルト値) |
| `get_indicator_graphics` | 描画系インジケーターのラベル・ライン・ボックス(Elliott Wave のカウント等) |
| `get_indicator_tables` | インジケーターが描くテーブル(MTFトレンド表等)をセルの行列で取得 |
| `get_key_levels` | 現在価格±N%のサポレジを全インジケーターから出所付きで1つの表に集約 |
| `load_more_history` | 過去のローソク足を追加ロード(画面は動かさない) |

**チャートを操作する**

| ツール | 説明 |
|---|---|
| `set_symbol` | `chart_index`で指定したペインのシンボル切替(省略時はアクティブ。失敗時は自動で元に戻す) |
| `set_timeframe` | `chart_index`で指定したペインの時間足切替(省略時はアクティブ。同上) |
| `set_indicator_input` | インジケーター/ストラテジーの設定値を変更(何も保存しない一時的な変更。パラメータ比較検証に) |
| `get_replay_status` | Bar Replayの利用可否・開始状態・過去カーソル時刻を読み取り |
| `start_chart_replay` | 期待symbol/timeframeを照合し、dry-runと明示確認後に過去日時からBar Replayを開始 |
| `step_chart_replay` | 停止中のBar Replayを1〜100本だけ進め、時刻前進を読み戻し検証 |
| `stop_chart_replay` | dry-runと明示確認後にBar Replayを終了してリアルタイム表示へ復帰 |

**チャート外のデータ**

| ツール | 説明 |
|---|---|
| `get_quotes` | 任意シンボルのクォート+テクニカル(RSI・総合評価等) |
| `get_mtf_overview` | 複数シンボル・複数時間足のスナップショットを一括取得(チャート非干渉) |
| `scan_market` | 市場スクリーニング(例: 日本株で RSI<30 を出来高順) |
| `get_economic_events` | 経済指標カレンダー(CPI・雇用統計・中銀会合など。国・重要度で絞り込み) |
| `get_watchlist` | あなたのウォッチリスト |
| `list_alerts` | あなたの価格アラート一覧(読み取りのみ) |
| `create_analysis_alerts` | 監査済み分析オーバーレイから期限付きConfirmation/Invalidation/Target 1アラートをpreviewし、明示確認後に冪等作成 |

**環境認識・評価補助**

| ツール | 説明 |
|---|---|
| `get_market_snapshot` | 複数市場・MTF・イベントを同一取得ウィンドウで統合し、欠落と品質状態を明示 |
| `get_execution_snapshot` | 複数銘柄のbid/ask・spread・pip/tick・配信モードを正規化。リクエスト後の価格更新を観測できた場合だけライブ状態をreadyとする |
| `get_trade_decision_context` | 対象チャート、OHLC、キーレベル、MTF、イベント、COT、実質金利、bid/askを1つの`snapshot_id`へ統合。リプレイ中は過去チャートとリアルタイム執行証拠の混在を防ぐためblocked |
| `get_aligned_history` | 複数チャートの確定足をUTCで厳密に整列。forward fillなし |
| `compute_market_features` | 整列済み履歴からリターン・ATR・ボラティリティ・相関を決定論的に計算 |
| `compute_market_regimes` | アクティブチャートの確定OHLCを、明示閾値と各バー以前の証拠だけでtrend/range/transitionおよびlow/normal/high volatilityへ分類。分布・遷移・品質を返し、最適化や売買推奨は行わない |
| `run_strategy_regime_analysis` | 正確な保存済みStrategyを一時実行して完全台帳を取得し、Entry時点までにclose済みのregime labelと結合。方向・volatility・複合regime別のPF、期待値、勝率、DD、run-up/drawdown、coverageを返し、Strategy削除とchart復元を検証 |
| `run_market_event_study` | アクティブチャートの確定OHLCで条件付きイベントスタディを実行。初版はIANA timezone対応のsession auctionを受容/失敗へ排他分類し、複数horizonの方向調整return・MFE・MAE・target到達時間・fold別結果を返す |
| `run_yield_price_nonconfirmation_study` | 2つの正確なチャートを使い、driver(金利等)の確定後もtarget価格が期待方向へ追随せず逆方向の構造breakを確定したeventを検出。時刻の完全一致やforward fillを使わず、複数horizon・fold別のreturn/MFE/MAEを返す |
| `compute_feature_outcome_relationships` | 確定OHLCからATR圧縮、実体方向、ヒゲ不均衡、連続方向、レンジ内位置、gapをその時点までの証拠だけで分類し、各bucketの将来return・upside/downside・fold別分布を返す。閾値の最適化や売買推奨は行わない |
| `compute_session_profile` | IANA timezoneとDST・日跨ぎに対応して、セッション別の値幅、return、opening range拡張、高安時刻、直前確定セッションとのgap・重なり、volume coverageを集計。TradingView volumeは未検証のtick/取引所volumeとして明示 |
| `compute_round_trip_cost` | spread・slippage・commissionを明示した往復コスト計算 |
| `compute_position_size` | 許容損失、Entry/Stop、コスト、数量制約、通貨換算証拠から、リスク上限を超えない数量を切り下げ計算 |
| `evaluate_due_analyses` | ジャーナル上の期限到来・非終端分析をpreviewし、確認後に指定チャートで銘柄/証拠時間足を一時切替、評価・記録・復元 |
| `get_analysis_performance` | ライブ分析ジャーナルを勝敗、gross/net R、MFE/MAE、到達時間へ集計。指標ごとの母集団と除外数を明示 |
| `validate_trade_plan` | 反映前の分析案を方向・期限・現在価格・証拠鮮度・イベント停止時間・コスト控除後RRで検証(チャート非干渉) |
| `get_positioning_context` | CFTC COTの履歴・OI正規化・前回差・3年パーセンタイル |
| `get_futures_flow_context` | 明示したCME/COMEX連続先物日足の価格変化・volume Z-scoreを対象方向へ変換し、週次COTと統合。日次OIと価格×OI四象限は認証済みfirst-seenデータ源がない限りunavailableとして返す |
| `get_real_yield_context` | 米財務省の10年Par Real CMT。`as_of`指定時はローカルでfirst-seen済みの版だけを返す |
| `audit_pine_indicator` | 自作Pineのリペイント要因を静的監査 |
| `compare_indicator_observations` | 再読込前後の同一バー値を比較し、変化を検出 |

`get_execution_snapshot`は開いているTradingViewチャートの`bid`、`ask`、`lp_time`、session状態、realtime-load状態、価格刻みを最優先で読み取ります。`lp_time`は同じquote snapshot内のlast-price時刻でありbid/ask個別のexchange timestampではありませんが、その時刻が既定5秒以内、streaming、active session、realtime loadedをすべて満たす場合だけ`ready`です。対象銘柄がチャートにない場合はscannerへフォールバックしますが、scannerはbid/askの市場側timestampとsession calendarを返さないため、受信時刻を市場時刻へ置き換えません。フォールバックでは既定最大1.2秒間にbid/ask変化を観測できた場合だけreadyとし、価格が動かなければ`wait`です。これは約定可能性や流動性を保証せず、口座・注文・チャートを変更しません。

`compute_position_size`は数量をブローカー固有のlotではなくinstrument unitとして返します。`quantity_step`、`minimum_quantity`、必要なら`maximum_quantity`と`contract_multiplier`を利用する取引環境の仕様に合わせて明示してください。損失はEntryからStopまでの値幅に`compute_round_trip_cost.total_price_per_unit`等の往復コストを加え、口座通貨へ換算して計算します。quote通貨と口座通貨が異なる場合は、口座通貨/quote通貨のレート、symbol、観測時刻がすべて新鮮な場合だけ数量を返します。口座接続、残高取得、発注、永続化は行いません。

実質金利のfirst-seen履歴は既定で`~/.tradingview-mcp/real-yield-first-seen.jsonl`へ追記されます。保存先はMCPプロセスの環境変数`TRADINGVIEW_MCP_REAL_YIELD_HISTORY_PATH`で変更できます。初回起動時に取得した過去行は過去の公表時刻へ遡及せず、その起動で実際に保存できた時刻以後だけバックテストに利用されます。

履歴書込み中にプロセスが異常終了して`.lock`が残った場合、安全のため自動削除せず履歴照会を停止します。他のTradingView-MCPプロセスが動作していないことを確認してから、履歴ファイルと同じ場所の`.lock`だけを削除してください。

評価CLIはスナップショットの`request_completed_at`を評価時点として、同時点までにfirst-seen済みの実質金利を`evaluation_context.real_yield_10y`へ自動固定します。現在値や後日の改訂値へフォールバックしません。

```bash
npm run evaluate -- --log evaluation.jsonl --snapshot snapshot.json
```

履歴を分離する場合は`--real-yield-history PATH`、スナップショットに取得完了時刻がない場合はcanonical UTC形式の`--as-of 2026-07-01T12:00:00.000Z`を指定します。`--as-of`がスナップショットの`request_completed_at`より後なら、先読み防止のため拒否されます。履歴不在時は値を補完せず`point_in_time_status=blocked`として記録し、履歴破損やロック失敗時はスナップショット自体を追記しません。

**Pine スクリプト(自作のみ)**

| ツール | 説明 |
|---|---|
| `list_pine_scripts` | 保存済みの自作 Pine スクリプト一覧。どのチャート上インジケーターに使われているかも表示 |
| `get_pine_source` | 自作スクリプトのソースコード全文(バージョン指定可 = 復元手段) |
| `save_pine_script` | AI が改修したソースを保存。**confirm なしはドライラン**。新規 or 新バージョンのみで上書きなし、旧バージョンはいつでも取得可能 |
| `add_pine_to_chart` | 自作スクリプトをチャートに追加(追加のみ。外すのは画面から) |
| `remove_owned_study` | `USER;` Pine ID・対象チャート・Study内部IDを照合して1インスタンスだけ削除。**confirm なしはドライラン** |
| `evaluate_analysis_overlay_outcome` | 監査済み分析を、分析後のロード済み確定足で事後評価。`evaluation_timeframe`指定時は対象チャートだけを一時切替して証拠を取得後に復元。`record:true`指定時だけ結果を分析ジャーナルへ追記 |
| `get_analysis_journal` | ローカル分析ジャーナルから分析定義と最新評価を取得。完了済み結果を後発の古い`ongoing`で逆戻りさせない |
| `get_analysis_calibration` | Target先着を正、Stop先着を負とした確信度較正(Brier score・確信度帯別実現率)。曖昧・未完了・取消等は除外数を返す |
| `get_analysis_overlay_status` | 配置中の監査済みオーバーレイを読み取り、分析期限・現在価格と各水準の位置関係・描画数の整合性を確認。未設定は`unconfigured`、入力矛盾は`blocked`として返し、チャートは変更しない |
| `get_analysis_overlay_template` | エントリー帯・無効化・Stop・Target・分析時刻を描く固定Pineテンプレートを取得(読み取り専用) |
| `ensure_analysis_overlay` | オーバーレイを冪等に準備。現行版は再利用、未配置なら追加、旧14入力版は確認後に銘柄・時間足を拘束した18入力版へ移行。**confirm なしはドライラン** |
| `apply_analysis_overlay` | 専用オーバーレイへ構造化分析を反映。銘柄・時間足を入力へ保存し、任意のsnapshot ID・戦略版とともにfail-closedで検証。**confirm なしはドライラン**。入力読み戻し成功後は分析ジャーナルへ自動記録 |

分析結果をチャートへ重ねる場合は、テンプレートを一度だけ`save_pine_script`で保存し、以後は`ensure_analysis_overlay`で配置・更新・`study_id`取得を行います。同じ現行版があれば書き込みなしで再利用されるため、分析ごとにPineスクリプトやスタディを増やす必要はありません。旧14入力版からの移行プレビューが`contextBindingRequired:true`を返した場合、confirm後に旧分析を現在の検証済みsymbol/timeframeへ拘束します。期限切れの分析は拒否せず、チャート上で`EXPIRED`表示になります。反映前の初期値は実分析として扱わず、`get_analysis_overlay_status`が`unconfigured`を返します。反映後は同ツールで入力・現在価格・描画の整合性を再確認でき、保存されたsymbol/timeframeと現在チャートが違う場合は`stale_context`、`trusted:false`を返して市場判定へ進みません。現在値判定は過去の到達順序を示しません。到達順序は`evaluate_analysis_overlay_outcome`が、分析時刻を含む足と形成中足を除外した確定OHLCで評価します。Entry後、Confirmation設定時は後続足での確認を待ち、それ以前のInvalidation接触はシナリオ取消として扱います。有効化後はTarget 1対Stopのfirst-hitを評価します。これは約定や損益を証明するものではなく、同一足で相反水準へ触れた場合や始値ギャップでは`ambiguous`を返します。履歴が不足する場合は`load_more_history`後に再評価するか、`evaluation_timeframe`に短い時間足を指定します。後者は`expected_timeframe`のオーバーレイを検証したまま、指定した`chart_index`だけを一時切替し、取得OHLCのsymbol・resolution・バー有無を確認してから元へ復元します。レスポンスの`chartState.restored`が`false`の場合は、`currentTimeframe`を確認して手動復元してください。`D`/`W`は対応し、暦月`M`は期間が可変なため`not_evaluable`です。

分析ジャーナルは既定で`~/.tradingview-mcp/analysis-journal.jsonl`へ保存され、`TRADINGVIEW_MCP_ANALYSIS_JOURNAL_PATH`で変更できます。`apply_analysis_overlay(confirm:true)`は入力読み戻し一致後に分析定義を自動記録し、事後評価は`record:true`を明示した場合だけ追記します。同じ`analysis_id`と同じ定義は冪等、異なる定義へのID再利用と異なる完了ラベルは拒否します。定義衝突時は再試行では解消しないため、新しい`analysis_id`を割り当てて再適用してください。ジャーナル書き込みだけが失敗しても反映・評価結果は維持され、レスポンスの`journal.recorded:false`と警告で再試行を促します。較正は`target_before_stop=1`と`stop_before_target=0`だけを母集団にし、その他は理由別の除外数として返します。

ジャーナルの`.lock`が60秒を超えて古く、記録された所有PIDが存在しない場合だけ自動回収します。所有PIDが生存中、確認不能、またはロックが新しい場合は奪取せず、タイムアウトエラーに対象パスを表示します。表示されたロックを手動削除する場合は、他のTradingView-MCPプロセスが利用していないことを先に確認してください。

これで「ソースを読む → AI が改修 → 保存 → バックテスト」の改善ループが回せます:

> BushidoScalp のソースを読んで、ダマシを減らす改良案を実装して。保存してUSDJPYの4時間足でバックテストし、改善したか元と比較して

**バックテスト**

| ツール | 説明 |
|---|---|
| `run_backtest` | 自作ストラテジーを今のチャートで検証。一時適用→成績取得→自動削除でチャートは元のまま |
| `get_strategy_report` | チャートに載っているストラテジーの成績(純利益・勝率・PF・DD・直近トレード) |
| `get_strategy_trade_ledger` | アクティブなStrategy Testerの全取引を最大500件ずつ取得。全件SHA-256 IDでページ間の再計算混入を拒否し、利用可能な手数料・run-up/drawdown・入力・Pine版を明示 |
| `run_strategy_experiment` | ベースラインと候補を同じチャートで直列比較。既定dry-run、confirm後だけ一時適用し、具体的Pine版・全取引台帳ID・入力・最低取引数・条件一致・指標差を返して両方を自動削除 |
| `run_backtest_matrix` | 最大24件の明示的なsymbol/timeframe/Pine入力組合せを直列実行。既定dry-run、最大30分のsoft deadline、各行の全取引台帳ID・不足/失敗理由・毎回のチャート復元を返し、結果を順位付けしない |
| `run_strategy_walk_forward` | 2〜8候補の全取引台帳を2〜12個の明示train/embargo/test窓へ分割。trainだけで候補選定し、選択候補のOOSだけを返す。anchored/rolling、同点拒否、最低取引数、条件・品質・期間coverageを検証 |
| `validate_research_protocol` | 具体的Pine版と凍結済み研究契約を読み取り検証。IS/OOS重複、未来期間、形成中足、候補数、最低取引数、コスト未指定、Pine静的リスク、OOS閲覧後の変更をblocked/warningへ分類 |
| `stress_test_strategy` | 凍結済みprotocol IDに紐づけ、完全台帳へのコスト・期間・bootstrapモデルに加え、最大8件の明示Pine入力上書きをStrategy Testerで直列再実行。Entry遅延・Stop/Target・近傍parameterをStrategy自身のロジックで評価し、各回削除・復元、失敗、劣化率を返す |
| `register_strategy_hypothesis` | 仮説と事前評価契約を、ライブ分析とは別のローカルappend-only研究ジャーナルへ登録 |
| `record_strategy_experiment` | 実験ID、Pine版、台帳ID、既知指標、guardrail、採否を仮説へ拘束して記録 |
| `compare_strategy_experiments` | 正確な実験ID+証拠hashを比較し、母集団・銘柄・時間足・methodology不一致を拒否 |

## よくあるトラブル

| 症状 | 原因と対処 |
|---|---|
| 「TradingView desktop app is not reachable」エラー | TradingView がデバッグモードで起動していない。一度終了して**ステップ2のコマンドで**起動し直す |
| ツールが AI に表示されない | エージェントの再起動(再接続)が必要。また `npm run build` を忘れていないか確認 |
| ビルドし直したのに動作が変わらない | MCP サーバーは起動時のビルドを使い続けるため、**エージェントのセッションを再接続**する |
| `no tradingview.com/chart page found` | TradingView でチャート画面を開いていない。チャートタブを開く |

## セキュリティについて

詳細は [docs/security-review.md](docs/security-review.md) を参照。最低限知っておくべきこと:

- デバッグポート開放中は、同じPC上のプログラムから TradingView のログインセッションを操作できる状態になります。**AI と使う時だけ**デバッグモードで起動し、普段は通常起動にしてください。共有PCでは使わないでください
- このツールは**読み取り中心**です。書き込みは自作Pineの非破壊保存、チャート上の自作Pine追加・入力変更・所有確認付き削除、監査済み分析からの期限付き価格アラート作成、Bar Replayの開始・ステップ・終了に限定しています。`save_pine_script`、`apply_analysis_overlay`、`ensure_analysis_overlay`、`remove_owned_study`、`create_analysis_alerts`、リプレイ開始・終了はconfirmフローを持ちます。注文、Replay Trading、リプレイautoplay、既存アラートの変更・再開・削除、Webhook、ウォッチリスト変更、Pineライブラリのスクリプト削除は意図的に実装していません
- `get_chart_screenshot` は画面に見えているものすべて(ウォッチリスト等)を AI に送信します

## 開発者向け

### テスト

```bash
npm test                   # ユニットテスト(アプリ不要。モックで検証)
npm run test:integration   # 統合テスト(デバッグモードのアプリが必要)
npm run test:e2e           # MCP stdio経由の実機E2E(下記設定が必要)
```

Pull RequestとpushではGitHub ActionsがNode.js 22/24の`npm test`と、high以上を拒否する`npm audit`を実行します。

統合テストはシンボル・時間足を一時的に変更しますが、終了時に元へ復元します。

Walk-forward E2Eは、現在のチャートと保存済みStrategyに合うツール引数を
`TRADINGVIEW_WALK_FORWARD_E2E_CONFIG`へJSONで設定して実行します。`confirm`はテスト側が管理するため含めません。

```bash
TRADINGVIEW_WALK_FORWARD_E2E_CONFIG='{"expected_symbol":"OANDA:USDJPY","expected_timeframe":"240","candidates":[{"pine_id":"USER;YOUR_PINE_ID","inputs":[{"id":"in_20","value":false}]},{"pine_id":"USER;YOUR_PINE_ID","inputs":[{"id":"in_20","value":true}]}],"folds":[{"fold_id":"f1","train_from":"2025-03-01T00:00:00.000Z","train_to":"2025-09-01T00:00:00.000Z","test_from":"2025-09-02T00:00:00.000Z","test_to":"2025-12-01T00:00:00.000Z"},{"fold_id":"f2","train_from":"2025-03-01T00:00:00.000Z","train_to":"2025-12-01T00:00:00.000Z","test_from":"2025-12-02T00:00:00.000Z","test_to":"2026-03-01T00:00:00.000Z"}],"mode":"anchored","embargo_bars":1,"minimum_train_trades":5,"minimum_test_trades":3,"selection_metric":"expectancy","max_runtime_seconds":180}' npm run test:e2e
```

E2Eは誤ったチャート束縛の拒否、dry-runの決定性、train-only選定、非選択候補OOSの非公開に加え、研究protocol検証、ledger stress、seed固定bootstrap、レスポンス非増幅、実行後のチャート完全復元を検証します。設定がない場合はskipします。

### フォルダ構成

- `src/` — TypeScript ソース
  - `cdp.ts` — CDP クライアント(接続・evaluate・スクリーンショット)
  - `tradingview.ts` — TradingView ページ内 API 層(チャート・インジケーター・ウォッチリスト)
  - `scanner.ts` — 公開スキャナー API クライアント(クォート・MTF・スクリーニング)
  - `server.ts` — MCP ツール定義(依存注入でテスト可能)
  - `index.ts` — stdio エントリポイント
- `test/unit/` — ユニットテスト(モック CDP / モックスキャナー)
- `test/e2e/` — MCP stdioから実アプリまで通す設定駆動E2Eテスト
- `test/smoke.mjs` — 実アプリに対する統合スモークテスト
- `build/` — tsc 出力(gitignore 済み)
- `docs/` — 設計・調査ドキュメント

### ドキュメント

- [docs/STRATEGY.md](docs/STRATEGY.md) — 全体戦略と進捗
- [docs/phase0-findings.md](docs/phase0-findings.md) / [phase3](docs/phase3-findings.md) / [phase4](docs/phase4-findings.md) / [phase5](docs/phase5-findings.md) — 内部API調査の記録
- [docs/security-review.md](docs/security-review.md) — セキュリティレビュー
- [docs/BACKLOG.md](docs/BACKLOG.md) — 今後の改善課題
