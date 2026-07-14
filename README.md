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
- [Node.js](https://nodejs.org/) 20以上(`node --version` で確認)
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

## ツール一覧(全32種)

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
| `set_symbol` | シンボル切替(失敗時は自動で元に戻す) |
| `set_timeframe` | 時間足切替(同上) |
| `set_indicator_input` | インジケーター/ストラテジーの設定値を変更(何も保存しない一時的な変更。パラメータ比較検証に) |

**チャート外のデータ**

| ツール | 説明 |
|---|---|
| `get_quotes` | 任意シンボルのクォート+テクニカル(RSI・総合評価等) |
| `get_mtf_overview` | 複数シンボル・複数時間足のスナップショットを一括取得(チャート非干渉) |
| `scan_market` | 市場スクリーニング(例: 日本株で RSI<30 を出来高順) |
| `get_economic_events` | 経済指標カレンダー(CPI・雇用統計・中銀会合など。国・重要度で絞り込み) |
| `get_watchlist` | あなたのウォッチリスト |
| `list_alerts` | あなたの価格アラート一覧(読み取りのみ) |

**環境認識・評価補助**

| ツール | 説明 |
|---|---|
| `get_market_snapshot` | 複数市場・MTF・イベントを同一取得ウィンドウで統合し、欠落と品質状態を明示 |
| `get_aligned_history` | 複数チャートの確定足をUTCで厳密に整列。forward fillなし |
| `compute_market_features` | 整列済み履歴からリターン・ATR・ボラティリティ・相関を決定論的に計算 |
| `compute_round_trip_cost` | spread・slippage・commissionを明示した往復コスト計算 |
| `get_positioning_context` | CFTC COTの履歴・OI正規化・前回差・3年パーセンタイル |
| `get_real_yield_context` | 米財務省の10年Par Real CMT。`as_of`指定時はローカルでfirst-seen済みの版だけを返す |
| `audit_pine_indicator` | 自作Pineのリペイント要因を静的監査 |
| `compare_indicator_observations` | 再読込前後の同一バー値を比較し、変化を検出 |

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

これで「ソースを読む → AI が改修 → 保存 → バックテスト」の改善ループが回せます:

> BushidoScalp のソースを読んで、ダマシを減らす改良案を実装して。保存してUSDJPYの4時間足でバックテストし、改善したか元と比較して

**バックテスト**

| ツール | 説明 |
|---|---|
| `run_backtest` | 自作ストラテジーを今のチャートで検証。一時適用→成績取得→自動削除でチャートは元のまま |
| `get_strategy_report` | チャートに載っているストラテジーの成績(純利益・勝率・PF・DD・直近トレード) |

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
- このツールは**読み取り中心**です。唯一の書き込みは自作 Pine スクリプトの保存(`save_pine_script`)で、confirm 必須・上書きなし・旧バージョン復元可の設計です。注文・アラート作成・ウォッチリスト変更・スクリプト削除は意図的に実装していません
- `get_chart_screenshot` は画面に見えているものすべて(ウォッチリスト等)を AI に送信します

## 開発者向け

### テスト

```bash
npm test                   # ユニットテスト(アプリ不要。モックで検証)
npm run test:integration   # 統合テスト(デバッグモードのアプリが必要)
```

統合テストはシンボル・時間足を一時的に変更しますが、終了時に元へ復元します。

### フォルダ構成

- `src/` — TypeScript ソース
  - `cdp.ts` — CDP クライアント(接続・evaluate・スクリーンショット)
  - `tradingview.ts` — TradingView ページ内 API 層(チャート・インジケーター・ウォッチリスト)
  - `scanner.ts` — 公開スキャナー API クライアント(クォート・MTF・スクリーニング)
  - `server.ts` — MCP ツール定義(依存注入でテスト可能)
  - `index.ts` — stdio エントリポイント
- `test/unit/` — ユニットテスト(モック CDP / モックスキャナー)
- `test/smoke.mjs` — 実アプリに対する統合スモークテスト
- `build/` — tsc 出力(gitignore 済み)
- `docs/` — 設計・調査ドキュメント

### ドキュメント

- [docs/STRATEGY.md](docs/STRATEGY.md) — 全体戦略と進捗
- [docs/phase0-findings.md](docs/phase0-findings.md) / [phase3](docs/phase3-findings.md) / [phase4](docs/phase4-findings.md) / [phase5](docs/phase5-findings.md) — 内部API調査の記録
- [docs/security-review.md](docs/security-review.md) — セキュリティレビュー
- [docs/BACKLOG.md](docs/BACKLOG.md) — 今後の改善課題
