# TradingView-MCP

TradingView デスクトップアプリ(macOS)に Chrome DevTools Protocol で接続し、AI がチャートを分析・操作できるようにする MCP サーバー。

## 仕組み

TradingView Desktop は Electron 製のため、デバッグポート付きで起動すると CDP でページ内部(`window.TradingViewApi`)にアクセスできる。ユーザーのログインセッション・レイアウト・カスタムインジケーターをそのまま利用できる。

```
Claude ⇄ (stdio) ⇄ tradingview-mcp ⇄ (CDP :9222) ⇄ TradingView.app
```

詳細は [docs/STRATEGY.md](docs/STRATEGY.md) と [docs/phase0-findings.md](docs/phase0-findings.md) を参照。

## セットアップ

```bash
npm install
npm run build
```

TradingView をデバッグポート付きで起動(通常起動中の場合は一度終了してから):

```bash
open -a TradingView --args --remote-debugging-port=9222
```

MCP サーバーの登録(Claude Code の場合はリポジトリ内の `.mcp.json` で自動登録される。手動なら):

```bash
claude mcp add tradingview -- node /path/to/TradingView-MCP/build/index.js
```

## ツール

| ツール | 説明 |
|---|---|
| `get_chart_screenshot` | 表示中のチャート画面を画像で取得(視覚分析用) |
| `get_chart_context` | 全チャートのシンボル・時間足・インジケーター一覧 |
| `get_ohlcv` | ロード済みローソク足データ(OHLCV) |
| `get_indicator_values` | インジケーターのプロット値(シグナルレベル・バンド等)。色・アラート系プロットはデフォルト除外 |
| `get_indicator_inputs` | インジケーターの入力パラメータ(名前・現在値・デフォルト値・説明) |
| `get_watchlist` | ウォッチリスト(セクション見出しでグループ化。ログインセッション利用) |
| `get_quotes` | 任意シンボルのクォート+テクニカルデータ(RSI・総合評価 `Recommend.All` 等。スキャナーAPI) |
| `scan_market` | 市場スクリーニング(例: 日本市場で RSI<30 を出来高順に検索) |
| `set_symbol` | アクティブチャートのシンボル変更 |
| `set_timeframe` | アクティブチャートの時間足変更 |

## テスト

```bash
npm test              # ユニットテスト(アプリ不要。モックCDPサーバーで検証)
npm run test:integration  # 統合テスト(デバッグポート付きでアプリ起動が必要)
```

統合テストはシンボル・時間足を一時的に変更するが、終了時に元の状態へ復元する。

## セキュリティ

[docs/security-review.md](docs/security-review.md) を参照。要点:

- デバッグポート開放中は同一マシンの任意プロセスが TradingView セッションを操作できるため、**MCP 利用時のみ**ポート付きで起動すること
- ページへ渡る入力はすべて `JSON.stringify` + バリデーションでインジェクション対策済み(テストで担保)
- `get_chart_screenshot` は画面に見えているものすべて(ウォッチリスト等)を AI に送信する

## フォルダ構成

- `src/` — TypeScript ソース(`cdp.ts`: CDP クライアント / `tradingview.ts`: TradingView API 層 / `index.ts`: MCP サーバー)
- `test/` — 実アプリに対する統合スモークテスト
- `build/` — tsc 出力(gitignore 済み)
- `docs/` — 戦略・調査ドキュメント
